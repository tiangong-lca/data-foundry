import { scopeKey } from "./scope-selection.ts";

export type JsonRecord = Record<string, unknown>;

export interface UniverseCoveragePathAdapter {
  readonly join: (...parts: string[]) => string;
  readonly dirname: (filePath: string) => string;
  readonly basename: (filePath: string, suffix?: string) => string;
  readonly isAbsolute: (filePath: string) => boolean;
  readonly resolve: (filePath: string) => string;
}

export interface UniverseCoverageRuntimeAdapter {
  readonly nowIso: () => string;
  readonly resolveRepoPath: (value: unknown) => string | null;
  readonly repoRelative: (filePath: string | null | undefined) => string | null;
  readonly fileExists: (filePath: string | null | undefined) => boolean;
  readonly directoryExists: (filePath: string | null | undefined) => boolean;
  readonly readJson: (filePath: string) => unknown;
  readonly readJsonLines: (filePath: string) => unknown[];
  readonly writeJson: (filePath: string, value: unknown) => void;
  readonly writeJsonLines: (filePath: string, rows: readonly unknown[]) => void;
  readonly ensureDirectory: (directory: string) => unknown;
  readonly normalizedList: (value: unknown) => string[];
  readonly asText: (value: unknown) => string;
  readonly datasetIdentity: (
    row: unknown,
    type: string,
  ) => { readonly id?: string | null; readonly version?: string | null };
  readonly path: UniverseCoveragePathAdapter;
  readonly walkFiles: (rootDir: unknown, predicate: (filePath: string) => boolean) => string[];
}

export interface UniverseCoverageRunConfig {
  readonly commandName: string;
  readonly defaultInputDir: string;
}

export interface UniverseCoverageService {
  readonly resolveLedgerSourceDirs: (value: unknown) => string[];
  readonly ledgerFiles: (sourceDirs: readonly string[], name: string) => string[];
  readonly summarizeLedgerSources: (sourceDirs: readonly string[]) => JsonRecord[];
  readonly sumLedgerSourceRows: (summary: readonly JsonRecord[], field: string) => number;
  readonly runReport: (
    options: JsonRecord | undefined,
    config: UniverseCoverageRunConfig,
  ) => JsonRecord;
}

interface DatasetIdentity {
  readonly id: string | null;
  readonly version: string;
}

function isJsonRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function jsonRecord(value: unknown): JsonRecord {
  return isJsonRecord(value) ? value : {};
}

function assertRuntimeAdapter(
  adapter: UniverseCoverageRuntimeAdapter,
): UniverseCoverageRuntimeAdapter {
  const functionKeys = [
    "nowIso",
    "resolveRepoPath",
    "repoRelative",
    "fileExists",
    "directoryExists",
    "readJson",
    "readJsonLines",
    "writeJson",
    "writeJsonLines",
    "ensureDirectory",
    "normalizedList",
    "asText",
    "datasetIdentity",
    "walkFiles",
  ] as const satisfies readonly (keyof UniverseCoverageRuntimeAdapter)[];
  const pathFunctionKeys = [
    "join",
    "dirname",
    "basename",
    "isAbsolute",
    "resolve",
  ] as const satisfies readonly (keyof UniverseCoveragePathAdapter)[];
  const missing = functionKeys.filter((key) => typeof adapter?.[key] !== "function");
  const missingPath = pathFunctionKeys
    .filter((key) => typeof adapter?.path?.[key] !== "function")
    .map((key) => `path.${key}`);
  if (missing.length > 0 || missingPath.length > 0) {
    throw new Error(
      `createUniverseCoverageService missing dependencies: ${[...missing, ...missingPath].join(", ")}`,
    );
  }
  return Object.freeze({
    ...adapter,
    path: Object.freeze({ ...adapter.path }),
  });
}

export function createUniverseCoverageService(
  runtimeAdapter: UniverseCoverageRuntimeAdapter,
): UniverseCoverageService {
  const runtime = assertRuntimeAdapter(runtimeAdapter);
  const { path } = runtime;

  function readJsonLinesIfExists(filePath: string | null | undefined): JsonRecord[] {
    if (!runtime.fileExists(filePath)) return [];
    return runtime.readJsonLines(filePath!) as JsonRecord[];
  }

  function ledgerDirCandidate(sourcePath: unknown): string | null {
    if (!sourcePath) return null;
    const source = runtime.asText(sourcePath);
    if (runtime.directoryExists(path.join(source, "import-ledger"))) {
      return path.join(source, "import-ledger");
    }
    if (!runtime.directoryExists(source)) return null;
    if (path.basename(source) === "import-ledger") return source;
    const knownLedgerFiles = [
      "ok.scopes.verified.jsonl",
      "ok.flows.verified.jsonl",
      "blocked.scopes.human-review.jsonl",
      "verified-support-identities.jsonl",
    ];
    if (knownLedgerFiles.some((name) => runtime.fileExists(path.join(source, name)))) {
      return source;
    }
    return null;
  }

  function resolveLedgerSourceDirs(value: unknown): string[] {
    const seen = new Set<string>();
    const dirs: string[] = [];
    for (const entry of runtime.normalizedList(value)) {
      const resolved = runtime.resolveRepoPath(entry);
      const ledgerDir = ledgerDirCandidate(resolved);
      if (!ledgerDir) {
        throw new Error(
          `--ledger-source-dir must point to a batch directory or import-ledger directory: ${entry}`,
        );
      }
      const key = path.resolve(ledgerDir);
      if (seen.has(key)) continue;
      seen.add(key);
      dirs.push(ledgerDir);
    }
    return dirs;
  }

  function ledgerFiles(sourceDirs: readonly string[], name: string): string[] {
    return sourceDirs.map((dir) => path.join(dir, name));
  }

  function summarizeLedgerSources(sourceDirs: readonly string[]): JsonRecord[] {
    return sourceDirs.map((dir) => ({
      ledger_dir: runtime.repoRelative(dir),
      ok_scope_rows: readJsonLinesIfExists(path.join(dir, "ok.scopes.verified.jsonl")).length,
      ok_flow_rows: readJsonLinesIfExists(path.join(dir, "ok.flows.verified.jsonl")).length,
      blocked_scope_rows: readJsonLinesIfExists(path.join(dir, "blocked.scopes.human-review.jsonl"))
        .length,
      verified_support_identity_rows: readJsonLinesIfExists(
        path.join(dir, "verified-support-identities.jsonl"),
      ).length,
    }));
  }

  function sumLedgerSourceRows(summary: readonly JsonRecord[], field: string): number {
    return summary.reduce((sum, row) => sum + (Number(row[field]) || 0), 0);
  }

  function sortedSet(values: Iterable<string>): string[] {
    return [...values].sort();
  }

  function setDifference(left: ReadonlySet<string>, right: ReadonlySet<string>): Set<string> {
    return new Set([...left].filter((value) => !right.has(value)));
  }

  function setIntersection(left: ReadonlySet<string>, right: ReadonlySet<string>): Set<string> {
    return new Set([...left].filter((value) => right.has(value)));
  }

  function datasetKeyFromParts(id: unknown, version: unknown): string | null {
    return id ? `${id}@${version || "00.00.001"}` : null;
  }

  function datasetKeyFromRow(row: JsonRecord, type: string): string | null {
    const id = row?.dataset_id || row?.id || row?.[`${type}_id`] || row?.process_id || row?.flow_id;
    const version =
      row?.dataset_version ||
      row?.version ||
      row?.[`${type}_version`] ||
      row?.process_version ||
      row?.flow_version ||
      "00.00.001";
    return datasetKeyFromParts(id, version);
  }

  function identityFromTidasRow(
    row: JsonRecord,
    type: string,
    fallbackId: string | null = null,
  ): DatasetIdentity {
    const identity = runtime.datasetIdentity(row, type) ?? {};
    const root = jsonRecord(row[`${type}DataSet`]);
    const typeInformation = jsonRecord(root[`${type}Information`]);
    const info =
      typeInformation.dataSetInformation ?? typeInformation["common:dataSetInformation"] ?? {};
    const information = jsonRecord(info);
    const publication =
      jsonRecord(root.administrativeInformation).publicationAndOwnership ??
      jsonRecord(root.administrativeInformation)["common:publicationAndOwnership"] ??
      {};
    const publicationRecord = jsonRecord(publication);
    return {
      id:
        identity.id || runtime.asText(information["common:UUID"] ?? information.UUID) || fallbackId,
      version:
        identity.version ||
        runtime.asText(
          publicationRecord["common:dataSetVersion"] ?? publicationRecord.dataSetVersion,
        ) ||
        "00.00.001",
    };
  }

  function readJsonIfExists(filePath: string | null | undefined): unknown {
    return runtime.fileExists(filePath) ? runtime.readJson(filePath!) : null;
  }

  function bundleIndexRows(processBundlesDir: string): JsonRecord[] {
    const indexFile = path.join(processBundlesDir, "index.json");
    const indexDir = path.dirname(indexFile);
    const index: unknown = readJsonIfExists(indexFile);
    let entries: JsonRecord[] = [];
    if (Array.isArray(index)) {
      entries = index.map(jsonRecord);
    } else if (Array.isArray(jsonRecord(index).bundles)) {
      entries = (jsonRecord(index).bundles as unknown[]).map(jsonRecord);
    } else if (Array.isArray(jsonRecord(index).process_bundles)) {
      entries = (jsonRecord(index).process_bundles as unknown[]).map(jsonRecord);
    } else if (index && typeof index === "object") {
      entries = (Object.values(index).find(Array.isArray) ?? []).map(jsonRecord);
    }
    return entries.map((entry) => {
      const processId = runtime.asText(
        entry.process_id || entry.id || entry.dataset_id || jsonRecord(entry.process).id,
      );
      const processVersion = runtime.asText(
        entry.process_version ||
          entry.version ||
          entry.dataset_version ||
          jsonRecord(entry.process).version,
      );
      const bundleDir = processId ? path.join(processBundlesDir, processId) : null;
      const manifestValue = runtime.asText(entry.manifest);
      const manifest = manifestValue
        ? runtime.resolveRepoPath(
            path.isAbsolute(manifestValue) ? manifestValue : path.join(indexDir, manifestValue),
          )
        : bundleDir
          ? path.join(bundleDir, "manifest.json")
          : null;
      const tidasDirValue = runtime.asText(entry.tidas_dir);
      const tidasDir = tidasDirValue
        ? runtime.resolveRepoPath(
            path.isAbsolute(tidasDirValue) ? tidasDirValue : path.join(indexDir, tidasDirValue),
          )
        : bundleDir
          ? path.join(bundleDir, "tidas")
          : null;
      return {
        process_id: processId,
        process_version: processVersion || "00.00.001",
        process_key: datasetKeyFromParts(processId, processVersion || "00.00.001"),
        manifest,
        tidas_dir: tidasDir,
      };
    });
  }

  function processFileRows(processesDir: string): JsonRecord[] {
    return runtime
      .walkFiles(processesDir, (filePath) => filePath.endsWith(".json"))
      .map((filePath) => {
        const row = runtime.readJson(filePath) as JsonRecord;
        const fallbackId = path.basename(filePath, ".json");
        const identity = identityFromTidasRow(row, "process", fallbackId);
        return {
          process_id: identity.id,
          process_version: identity.version,
          process_key: datasetKeyFromParts(identity.id, identity.version),
          file: filePath,
          row,
        };
      });
  }

  function textAt(value: unknown): string {
    if (value == null) return "";
    if (typeof value === "string" || typeof value === "number") return String(value);
    if (Array.isArray(value)) return value.map(textAt).filter(Boolean).join("; ");
    if (typeof value === "object") {
      const record = jsonRecord(value);
      return textAt(record["#text"] ?? record.value ?? record.id);
    }
    return "";
  }

  function collectFlowReferences(value: unknown, refs: JsonRecord[] = []): JsonRecord[] {
    if (!value || typeof value !== "object") return refs;
    if (Array.isArray(value)) {
      for (const entry of value) collectFlowReferences(entry, refs);
      return refs;
    }
    const record = jsonRecord(value);
    const ref = jsonRecord(record.referenceToFlowDataSet);
    if (Object.keys(ref).length > 0) {
      const flowId = runtime.asText(ref["@refObjectId"] ?? ref.refObjectId ?? ref.id);
      const flowVersion = runtime.asText(ref["@version"] ?? ref.version) || "00.00.001";
      if (flowId) {
        refs.push({
          flow_id: flowId,
          flow_version: flowVersion,
          flow_key: datasetKeyFromParts(flowId, flowVersion),
          short_description: textAt(ref["common:shortDescription"] ?? ref.shortDescription),
        });
      }
    }
    for (const entry of Object.values(record)) collectFlowReferences(entry, refs);
    return refs;
  }

  function flowTypeOfRow(row: JsonRecord): string {
    const flowInformation = jsonRecord(jsonRecord(row.flowDataSet).flowInformation);
    const info =
      flowInformation.dataSetInformation ?? flowInformation["common:dataSetInformation"] ?? {};
    const information = jsonRecord(info);
    return runtime.asText(
      information.typeOfDataSet ?? information["common:typeOfDataSet"] ?? row.typeOfDataSet,
    );
  }

  function flowRowsByKey(flowsDir: string): Map<string, JsonRecord> {
    const rowsByKey = new Map<string, JsonRecord>();
    for (const filePath of runtime.walkFiles(flowsDir, (entry) => entry.endsWith(".json"))) {
      const row = runtime.readJson(filePath) as JsonRecord;
      const fallbackId = path.basename(filePath, ".json");
      const identity = identityFromTidasRow(row, "flow", fallbackId);
      const key = datasetKeyFromParts(identity.id, identity.version);
      if (!key) continue;
      rowsByKey.set(key, {
        flow_id: identity.id,
        flow_version: identity.version,
        flow_key: key,
        flow_type: flowTypeOfRow(row),
        file: filePath,
      });
    }
    return rowsByKey;
  }

  function uniqueExistingPaths(values: readonly unknown[]): string[] {
    return [
      ...new Set(
        values
          .map(runtime.resolveRepoPath)
          .filter((filePath): filePath is string =>
            Boolean(filePath && runtime.fileExists(filePath)),
          ),
      ),
    ];
  }

  function scopeFilesForCoverage(options: JsonRecord, runDir: string): string[] {
    const explicit = runtime.normalizedList(options.scopeFile || options.scopeFiles);
    if (explicit.length > 0) return uniqueExistingPaths(explicit);
    return runtime.walkFiles(
      runDir,
      (filePath) => path.basename(filePath) === "ready-scopes.jsonl",
    );
  }

  function scopeKeyRowsFromFiles(files: readonly string[]): JsonRecord[] {
    const rows: JsonRecord[] = [];
    for (const filePath of files) {
      for (const row of readJsonLinesIfExists(filePath)) {
        const key = scopeKey(row);
        if (!key) continue;
        rows.push({
          process_id: row.process_id || row.id,
          process_version: row.process_version || row.version || "00.00.001",
          process_key: key,
          closure_status: row.closure_status ?? row.status ?? null,
          source_file: filePath,
        });
      }
    }
    return rows;
  }

  function keySetFromRows(rows: readonly JsonRecord[], type: string): Set<string> {
    return new Set(
      rows.map((row) => datasetKeyFromRow(row, type)).filter((key): key is string => Boolean(key)),
    );
  }

  function keySetFromFiles(files: readonly string[], type: string): Set<string> {
    return keySetFromRows(
      files.flatMap((filePath) => readJsonLinesIfExists(filePath)),
      type,
    );
  }

  function runReport(options: JsonRecord = {}, config: UniverseCoverageRunConfig): JsonRecord {
    const inputDir = runtime.resolveRepoPath(options.inputDir || config.defaultInputDir)!;
    const processBundlesDir = runtime.resolveRepoPath(
      options.processBundlesDir || options.bundlesDir || path.join(inputDir, "process-bundles"),
    )!;
    const processesDir = runtime.resolveRepoPath(
      options.processesDir || path.join(inputDir, "tidas", "processes"),
    )!;
    const flowsDir = runtime.resolveRepoPath(
      options.flowsDir || path.join(inputDir, "tidas", "flows"),
    )!;
    const runDir = runtime.resolveRepoPath(options.runDir || path.dirname(processBundlesDir))!;
    const outDir = runtime.resolveRepoPath(
      options.outDir || path.join(runDir, "bafu-universe-coverage-report"),
    )!;
    if (!runtime.directoryExists(processBundlesDir)) {
      throw new Error("--process-bundles-dir is required and must point to process-bundles.");
    }
    if (!runtime.directoryExists(processesDir)) {
      throw new Error("--processes-dir is required and must point to tidas/processes.");
    }
    runtime.ensureDirectory(outDir);

    const ledgerSourceDirs = resolveLedgerSourceDirs(
      options.ledgerSourceDir ||
        options.ledgerSourceDirs ||
        options.carryForwardLedgerDir ||
        options.carryForwardLedgerDirs,
    );
    const ledgerSourceSummary = summarizeLedgerSources(ledgerSourceDirs);
    const scopeFiles = scopeFilesForCoverage(options, runDir);
    const scopeRows = scopeKeyRowsFromFiles(scopeFiles);
    const readyScopeSet = new Set(
      scopeRows.map((row) => runtime.asText(row.process_key)).filter(Boolean),
    );
    const bundleRows = bundleIndexRows(processBundlesDir);
    const processRows = processFileRows(processesDir);
    const processByKey = new Map<string, JsonRecord>();
    for (const row of bundleRows) {
      if (!row.process_key) continue;
      processByKey.set(runtime.asText(row.process_key), {
        process_id: row.process_id,
        process_version: row.process_version,
        process_key: row.process_key,
        in_process_bundles: true,
        in_tidas_processes: false,
        bundle_manifest: runtime.repoRelative(runtime.asText(row.manifest)),
      });
    }
    for (const row of processRows) {
      if (!row.process_key) continue;
      const rowKey = runtime.asText(row.process_key);
      const current = processByKey.get(rowKey) ?? {
        process_id: row.process_id,
        process_version: row.process_version,
        process_key: row.process_key,
        in_process_bundles: false,
        in_tidas_processes: false,
      };
      current.in_tidas_processes = true;
      current.process_file = runtime.repoRelative(runtime.asText(row.file));
      processByKey.set(rowKey, current);
    }
    const processUniverseSet = new Set(processByKey.keys());

    const verifiedScopes = keySetFromFiles(
      ledgerFiles(ledgerSourceDirs, "ok.scopes.verified.jsonl"),
      "scope",
    );
    const verifiedFlows = keySetFromFiles(
      ledgerFiles(ledgerSourceDirs, "ok.flows.verified.jsonl"),
      "flow",
    );
    const blockedScopeRows = ledgerFiles(
      ledgerSourceDirs,
      "blocked.scopes.human-review.jsonl",
    ).flatMap((filePath) => readJsonLinesIfExists(filePath));
    const activeBlockedScopes = setDifference(
      keySetFromRows(blockedScopeRows, "scope"),
      verifiedScopes,
    );
    const retryScopeRows = [
      ...ledgerFiles(ledgerSourceDirs, "failed.scopes.retry.jsonl"),
      ...ledgerFiles(ledgerSourceDirs, "retry.scopes.jsonl"),
    ].flatMap((filePath) => readJsonLinesIfExists(filePath));
    const retryScopes = setDifference(keySetFromRows(retryScopeRows, "scope"), verifiedScopes);
    const nonImportableScopes = keySetFromFiles(
      runtime
        .normalizedList(options.nonImportableScopesFile || options.nonImportableScopesFiles)
        .map(runtime.resolveRepoPath)
        .filter((filePath): filePath is string => Boolean(filePath)),
      "scope",
    );

    const readyUniverseSet = setIntersection(processUniverseSet, readyScopeSet);
    const missingReadySet = setDifference(processUniverseSet, readyScopeSet);
    const verifiedUniverseSet = setIntersection(processUniverseSet, verifiedScopes);
    const flowIndex = flowRowsByKey(flowsDir);
    const referencedFlows = new Map<string, JsonRecord & { referencing_processes: Set<string> }>();
    for (const row of processRows) {
      for (const ref of collectFlowReferences(jsonRecord(row.row))) {
        const flowKey = runtime.asText(ref.flow_key);
        if (!flowKey) continue;
        const current = referencedFlows.get(flowKey) ?? {
          ...ref,
          referencing_processes: new Set<string>(),
        };
        current.referencing_processes.add(runtime.asText(row.process_key));
        referencedFlows.set(flowKey, current);
      }
    }
    const productOrUnknownFlowKeys = new Set<string>();
    const referencedFlowRows: JsonRecord[] = [];
    for (const [flowKey, ref] of referencedFlows.entries()) {
      const indexed = flowIndex.get(flowKey);
      const flowType = runtime.asText(indexed?.flow_type) || "unknown";
      const isElementary = /elementary/u.test(flowType.toLowerCase());
      if (!isElementary) productOrUnknownFlowKeys.add(flowKey);
      referencedFlowRows.push({
        schema_version: 1,
        flow_id: ref.flow_id,
        flow_version: ref.flow_version,
        flow_key: flowKey,
        flow_type: flowType,
        flow_file: runtime.repoRelative(runtime.asText(indexed?.file)),
        reference_kind: isElementary
          ? "elementary"
          : flowType === "unknown"
            ? "unknown"
            : "product_or_waste",
        verified: verifiedFlows.has(flowKey),
        referencing_process_count: ref.referencing_processes.size,
        sample_referencing_processes: sortedSet(ref.referencing_processes).slice(0, 20),
      });
    }
    const unverifiedProductOrUnknownFlows = setDifference(productOrUnknownFlowKeys, verifiedFlows);

    const processCoverageRows: JsonRecord[] = sortedSet(processUniverseSet).map((key) => {
      const processRow = processByKey.get(key) ?? {};
      const verified = verifiedScopes.has(key);
      const nonImportable = nonImportableScopes.has(key);
      const activeBlocked = activeBlockedScopes.has(key);
      const retry = retryScopes.has(key);
      const ready = readyScopeSet.has(key);
      const coverageStatus = verified
        ? "verified"
        : nonImportable
          ? "non_importable"
          : retry
            ? "retry"
            : activeBlocked
              ? "active_human_review"
              : ready
                ? "pending_ready_scope"
                : "missing_ready_scope";
      return {
        schema_version: 1,
        ...processRow,
        ready_scope: ready,
        verified,
        non_importable: nonImportable,
        active_human_review: activeBlocked,
        retry,
        coverage_status: coverageStatus,
      };
    });
    const processCoverageStatusCounts = processCoverageRows.reduce<Record<string, number>>(
      (counts, row) => {
        const status = runtime.asText(row.coverage_status);
        counts[status] = (counts[status] ?? 0) + 1;
        return counts;
      },
      {},
    );
    const processGapRows = processCoverageRows.filter(
      (row) => !["verified", "non_importable"].includes(runtime.asText(row.coverage_status)),
    );
    const flowGapRows = referencedFlowRows.filter(
      (row) => row.reference_kind !== "elementary" && !row.verified,
    );

    const processUniversePath = path.join(outDir, "bafu-process-universe.coverage.jsonl");
    const processGapPath = path.join(outDir, "bafu-process-coverage-gaps.jsonl");
    const flowReferencePath = path.join(outDir, "bafu-flow-reference-coverage.jsonl");
    const flowGapPath = path.join(outDir, "bafu-flow-reference-coverage-gaps.jsonl");
    const reportPath = path.join(outDir, "bafu-universe-coverage-report.json");
    runtime.writeJsonLines(processUniversePath, processCoverageRows);
    runtime.writeJsonLines(processGapPath, processGapRows);
    runtime.writeJsonLines(flowReferencePath, referencedFlowRows);
    runtime.writeJsonLines(flowGapPath, flowGapRows);

    const report = {
      schema_version: 1,
      generated_at_utc: runtime.nowIso(),
      status:
        processGapRows.length === 0 && flowGapRows.length === 0
          ? "completed"
          : "completed_with_coverage_gaps",
      command: config.commandName,
      remote_write_mode: "read-only",
      inputs: {
        input_dir: runtime.repoRelative(inputDir),
        process_bundles_dir: runtime.repoRelative(processBundlesDir),
        processes_dir: runtime.repoRelative(processesDir),
        flows_dir: runtime.repoRelative(flowsDir),
        run_dir: runtime.repoRelative(runDir),
        scope_files: scopeFiles.map(runtime.repoRelative),
        ledger_source_dirs: ledgerSourceDirs.map(runtime.repoRelative),
        non_importable_scope_files: runtime
          .normalizedList(options.nonImportableScopesFile || options.nonImportableScopesFiles)
          .map((entry) => runtime.repoRelative(runtime.resolveRepoPath(entry))),
      },
      counts: {
        process_bundle_entries: bundleRows.length,
        process_bundle_unique: new Set(
          bundleRows.map((row) => runtime.asText(row.process_key)).filter(Boolean),
        ).size,
        tidas_process_files: processRows.length,
        tidas_process_unique: new Set(
          processRows.map((row) => runtime.asText(row.process_key)).filter(Boolean),
        ).size,
        process_universe: processUniverseSet.size,
        ready_scope_files: scopeFiles.length,
        ready_scope_rows: scopeRows.length,
        ready_scope_unique: readyScopeSet.size,
        ready_scopes_in_universe: readyUniverseSet.size,
        missing_ready_scopes: missingReadySet.size,
        verified_process_scopes: processCoverageStatusCounts.verified ?? 0,
        non_importable_process_scopes: processCoverageStatusCounts.non_importable ?? 0,
        active_human_review_scopes: processCoverageStatusCounts.active_human_review ?? 0,
        retry_scopes: processCoverageStatusCounts.retry ?? 0,
        pending_ready_scopes: processCoverageStatusCounts.pending_ready_scope ?? 0,
        process_coverage_gap_rows: processGapRows.length,
        referenced_flow_rows: referencedFlows.size,
        product_or_unknown_flow_references: productOrUnknownFlowKeys.size,
        verified_product_or_unknown_flow_references: setIntersection(
          productOrUnknownFlowKeys,
          verifiedFlows,
        ).size,
        unverified_product_or_unknown_flow_references: unverifiedProductOrUnknownFlows.size,
        flow_coverage_gap_rows: flowGapRows.length,
        ledger_source_dirs: ledgerSourceSummary.length,
        ledger_source_ok_scope_rows: sumLedgerSourceRows(ledgerSourceSummary, "ok_scope_rows"),
        ledger_source_ok_scope_unique: verifiedScopes.size,
        ledger_source_ok_scope_unique_in_universe: verifiedUniverseSet.size,
        ledger_source_ok_flow_rows: sumLedgerSourceRows(ledgerSourceSummary, "ok_flow_rows"),
        ledger_source_ok_flow_unique: verifiedFlows.size,
        ledger_source_ok_flow_unique_product_or_unknown_references: setIntersection(
          productOrUnknownFlowKeys,
          verifiedFlows,
        ).size,
        ledger_source_blocked_scope_rows: sumLedgerSourceRows(
          ledgerSourceSummary,
          "blocked_scope_rows",
        ),
      },
      ledger_sources: ledgerSourceSummary,
      files: {
        report: runtime.repoRelative(reportPath),
        process_universe: runtime.repoRelative(processUniversePath),
        process_coverage_gaps: runtime.repoRelative(processGapPath),
        flow_reference_coverage: runtime.repoRelative(flowReferencePath),
        flow_reference_coverage_gaps: runtime.repoRelative(flowGapPath),
      },
      policy: {
        ledger_sources_are_explicit:
          "Coverage is computed only from the explicit --ledger-source-dir inputs. Root import-ledger is not assumed to aggregate prior batches.",
        v8_ready_scope_is_not_full_universe:
          "Ready scope files are treated as closure snapshots, not as the full input process universe.",
        read_only: true,
      },
    };
    runtime.writeJson(reportPath, report);
    return report;
  }

  return Object.freeze({
    resolveLedgerSourceDirs,
    ledgerFiles,
    summarizeLedgerSources,
    sumLedgerSourceRows,
    runReport,
  });
}

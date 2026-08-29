import { canonicalDescriptionPair as descriptionPair } from "../canonical-description.ts";

export type JsonRecord = Record<string, unknown>;

export interface IdentityDecisionDirectoryEntry {
  readonly name: string;
  readonly isDirectory: boolean;
}

export interface IdentityDecisionFileSystemAdapter {
  readonly fileExists: (filePath: string | null | undefined) => boolean;
  readonly directoryExists: (filePath: string | null | undefined) => boolean;
  readonly readDirectory: (directory: string) => readonly IdentityDecisionDirectoryEntry[];
  readonly readJson: (filePath: string) => unknown;
  readonly readJsonLines: (filePath: string) => unknown[];
  readonly writeJson: (filePath: string, value: unknown) => void;
  readonly writeJsonLines: (filePath: string, rows: readonly unknown[]) => void;
  readonly ensureDirectory: (directory: string) => void;
  readonly copyFile: (source: string, destination: string) => void;
  readonly readText: (filePath: string) => string;
  readonly removeDirectory: (directory: string) => void;
}

export interface IdentityDecisionPathAdapter {
  readonly join: (...parts: string[]) => string;
  readonly basename: (filePath: string) => string;
  readonly parse: (filePath: string) => { readonly name: string; readonly ext: string };
}

export interface IdentityDecisionHashAdapter {
  readonly sha256File: (filePath: string) => string;
}

export interface IdentityDecisionCarryForwardRuntimeAdapter {
  readonly nowIso: () => string;
  readonly repoRelative: (filePath: string | null | undefined) => string | null;
  readonly resolveRepoPath: (value: unknown) => string | null;
  readonly datasetIdentity: (
    row: unknown,
    datasetType: string,
  ) => { readonly id?: string | null; readonly version?: string | null };
  readonly resultCacheDirectory: () => string | null;
  readonly fs: IdentityDecisionFileSystemAdapter;
  readonly path: IdentityDecisionPathAdapter;
  readonly hash: IdentityDecisionHashAdapter;
}

export interface ReusableDecisionIndex {
  readonly files: string[];
  readonly byKey: Map<string, { row: JsonRecord; source_file: string }>;
  readonly conflicts: JsonRecord[];
}

export interface CarryForwardReport extends JsonRecord {
  readonly status: string;
  readonly counts: {
    readonly input_decisions: number;
    readonly source_decision_files: number;
    readonly reusable_decisions: number;
    readonly replacements: number;
    readonly additions: number;
    readonly conflicts: number;
  };
  readonly replacements: JsonRecord[];
  readonly additions: JsonRecord[];
  readonly conflicts: JsonRecord[];
}

export interface CarryForwardResult {
  readonly report: CarryForwardReport;
  readonly reportPath: string;
  readonly outputFile: string;
}

export interface MergeCompletedReusableIdentityDecisionsInput {
  readonly runDir: string;
  readonly decisionsFile: string;
  readonly outDir: string;
  readonly datasetType: string;
  readonly rowsFile?: string | null;
  readonly curationGateReport?: string | null;
}

export interface BafuIdentityDecisionCarryForwardService {
  readonly identityDecisionDatasetKey: (
    row: JsonRecord,
    fallbackType?: string | null,
  ) => string | null;
  readonly identityDecisionValue: (row: JsonRecord) => string;
  readonly identityDecisionCanonical: (row: JsonRecord) => JsonRecord | null;
  readonly completedReusableIdentityDecision: (row: JsonRecord) => boolean;
  readonly invalidateIdentityPreflightResultCacheEntry: (identityKey: string) => boolean;
  readonly identityDecisionSourceFiles: (runDir: string) => string[];
  readonly loadCompletedReusableIdentityDecisions: (runDir: string) => ReusableDecisionIndex;
  readonly loadResolutionRewritesByProcess: (resolutionDir: string) => Map<string, JsonRecord[]>;
  readonly mergeCompletedReusableIdentityDecisions: (
    input: MergeCompletedReusableIdentityDecisionsInput,
  ) => CarryForwardResult;
}

function isJsonRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function jsonRecord(value: unknown): JsonRecord {
  return isJsonRecord(value) ? value : {};
}

function recordArray(value: unknown): JsonRecord[] {
  return Array.isArray(value) ? value.map(jsonRecord) : [];
}

function asText(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

function normalizedList(value: unknown): string[] {
  const values = value === undefined || value === null || value === "" ? [] : [value].flat();
  return values
    .flatMap((item) => String(item).split(","))
    .map((item) => item.trim())
    .filter(Boolean);
}

function uniqueValues<T>(values: readonly T[]): T[] {
  return [...new Set(values.filter((value) => value != null && value !== ""))];
}

function assertAdapter(
  adapter: IdentityDecisionCarryForwardRuntimeAdapter,
): IdentityDecisionCarryForwardRuntimeAdapter {
  const rootFunctionKeys = [
    "nowIso",
    "repoRelative",
    "resolveRepoPath",
    "datasetIdentity",
    "resultCacheDirectory",
  ] as const satisfies readonly (keyof IdentityDecisionCarryForwardRuntimeAdapter)[];
  const fsFunctionKeys = [
    "fileExists",
    "directoryExists",
    "readDirectory",
    "readJson",
    "readJsonLines",
    "writeJson",
    "writeJsonLines",
    "ensureDirectory",
    "copyFile",
    "readText",
    "removeDirectory",
  ] as const satisfies readonly (keyof IdentityDecisionFileSystemAdapter)[];
  const pathFunctionKeys = [
    "join",
    "basename",
    "parse",
  ] as const satisfies readonly (keyof IdentityDecisionPathAdapter)[];
  const hashFunctionKeys = [
    "sha256File",
  ] as const satisfies readonly (keyof IdentityDecisionHashAdapter)[];
  const missing = rootFunctionKeys.filter((key) => typeof adapter?.[key] !== "function");
  const missingFs = fsFunctionKeys
    .filter((key) => typeof adapter?.fs?.[key] !== "function")
    .map((key) => `fs.${key}`);
  const missingPath = pathFunctionKeys
    .filter((key) => typeof adapter?.path?.[key] !== "function")
    .map((key) => `path.${key}`);
  const missingHash = hashFunctionKeys
    .filter((key) => typeof adapter?.hash?.[key] !== "function")
    .map((key) => `hash.${key}`);
  const missingDependencies = [...missing, ...missingFs, ...missingPath, ...missingHash];
  if (missingDependencies.length > 0) {
    throw new Error(
      `createBafuIdentityDecisionCarryForwardService missing dependencies: ${missingDependencies.join(
        ", ",
      )}`,
    );
  }
  return Object.freeze({
    ...adapter,
    fs: Object.freeze({ ...adapter.fs }),
    path: Object.freeze({ ...adapter.path }),
    hash: Object.freeze({ ...adapter.hash }),
  });
}

export function createBafuIdentityDecisionCarryForwardService(
  runtimeAdapter: IdentityDecisionCarryForwardRuntimeAdapter,
): BafuIdentityDecisionCarryForwardService {
  const runtime = assertAdapter(runtimeAdapter);
  const { fs, hash, path } = runtime;

  function identityDecisionDatasetKey(
    row: JsonRecord,
    fallbackType: string | null = null,
  ): string | null {
    const datasetType = asText(row.dataset_type ?? row.datasetType ?? row.type ?? fallbackType);
    const datasetId = asText(
      row.dataset_id ??
        row.datasetId ??
        row.source_dataset_id ??
        row.sourceDatasetId ??
        row.entity_id ??
        row.entityId,
    );
    if (!datasetType || !datasetId) return null;
    const datasetVersion =
      asText(
        row.dataset_version ??
          row.datasetVersion ??
          row.source_dataset_version ??
          row.sourceDatasetVersion ??
          row.version,
      ) || "00.00.001";
    return `${datasetType.toLowerCase()}:${datasetId}@${datasetVersion}`;
  }

  function identityDecisionValue(row: JsonRecord): string {
    const value = asText(row.identity_decision ?? row.identityDecision ?? row.decision);
    if (["reuse", "reuse_existing", "reference_reuse"].includes(value)) {
      return "reuse_existing_reference";
    }
    if (["block", "blocked", "unresolved"].includes(value)) return "block_unresolved";
    return value;
  }

  function identityDecisionCanonical(row: JsonRecord): JsonRecord | null {
    const canonical = jsonRecord(row.canonical ?? row.selected_reference ?? row.selectedReference);
    if (Object.keys(canonical).length === 0) return null;
    const id = asText(
      canonical.ref_object_id ?? canonical.refObjectId ?? canonical.id ?? canonical["@refObjectId"],
    );
    if (!id) return null;
    const sourceDescription = canonical.short_description ?? canonical.shortDescription;
    const description = descriptionPair(sourceDescription, asText).ledger;
    return {
      table: asText(canonical.table) || "flows",
      ref_object_id: id,
      version:
        asText(canonical.version ?? canonical.ref_version ?? canonical["@version"]) || "00.00.001",
      short_description:
        description || asText(jsonRecord(canonical["common:shortDescription"])["#text"]) || id,
    };
  }

  function canonicalDecisionKey(canonical: JsonRecord | null): string {
    if (!canonical) return "";
    return `${canonical.table}:${canonical.ref_object_id}@${canonical.version}`;
  }

  function completedReusableIdentityDecision(row: JsonRecord): boolean {
    return (
      asText(row.decision_status ?? row.decisionStatus ?? row.status) === "completed" &&
      identityDecisionValue(row) === "reuse_existing_reference" &&
      Boolean(identityDecisionCanonical(row)) &&
      Boolean(row.evidence && typeof row.evidence === "object") &&
      Boolean(asText(row.basis ?? row.reason))
    );
  }

  // Minted/committed flows must not restore a stale pre-mint search result on a later scope.
  // This cache is only an optimization, so invalidation intentionally stays best-effort.
  function invalidateIdentityPreflightResultCacheEntry(identityKey: string): boolean {
    const raw = runtime.resultCacheDirectory();
    if (!raw || !identityKey) return false;
    const cacheDir = runtime.resolveRepoPath(raw);
    const match = String(identityKey).match(/^([^:]+):(.+)@([^@]+)$/u);
    if (!cacheDir || !match || !fs.directoryExists(cacheDir)) return false;
    const [, datasetType, datasetId, datasetVersion] = match;
    let removed = 0;
    try {
      for (const entry of fs.readDirectory(cacheDir)) {
        if (!entry.isDirectory) continue;
        const entryDir = path.join(cacheDir, entry.name);
        const manifestPath = path.join(entryDir, "foundry-identity-preflight-execution.json");
        if (!fs.fileExists(manifestPath)) continue;
        let manifest: JsonRecord;
        try {
          manifest = jsonRecord(JSON.parse(fs.readText(manifestPath)));
        } catch {
          continue;
        }
        const dataset = jsonRecord(jsonRecord(manifest.binding).dataset);
        if (
          dataset.type === datasetType &&
          dataset.id === datasetId &&
          String(dataset.version || "00.00.001") === datasetVersion
        ) {
          fs.removeDirectory(entryDir);
          removed += 1;
        }
      }
    } catch {
      // Cache invalidation remains deliberately best-effort.
    }
    return removed > 0;
  }

  function identityDecisionSourceFiles(runDir: string): string[] {
    if (!fs.directoryExists(runDir)) return [];
    return fs
      .readDirectory(runDir)
      .filter((entry) => entry.isDirectory && /^decisions(?:-|$)/u.test(entry.name))
      .map((entry) => path.join(runDir, entry.name, "identity-decisions.jsonl"))
      .filter(fs.fileExists)
      .sort();
  }

  function loadCompletedReusableIdentityDecisions(runDir: string): ReusableDecisionIndex {
    const byKey = new Map<string, { row: JsonRecord; source_file: string }>();
    const conflicts: JsonRecord[] = [];
    const files = identityDecisionSourceFiles(runDir);
    for (const filePath of files) {
      for (const value of fs.readJsonLines(filePath)) {
        const row = jsonRecord(value);
        if (!completedReusableIdentityDecision(row)) continue;
        const key = identityDecisionDatasetKey(row);
        if (!key) continue;
        const canonical = identityDecisionCanonical(row);
        const existing = byKey.get(key);
        if (existing) {
          const existingCanonicalKey = canonicalDecisionKey(
            identityDecisionCanonical(existing.row),
          );
          const currentCanonicalKey = canonicalDecisionKey(canonical);
          if (existingCanonicalKey !== currentCanonicalKey) {
            conflicts.push({
              key,
              existing_source_file: runtime.repoRelative(existing.source_file),
              existing_canonical: existingCanonicalKey,
              source_file: runtime.repoRelative(filePath),
              canonical: currentCanonicalKey,
            });
            byKey.delete(key);
          }
          continue;
        }
        byKey.set(key, { row, source_file: filePath });
      }
    }
    return { files, byKey, conflicts };
  }

  // Library resolution proves per-process exchange reference reuse. Preserve file and
  // encounter order so the batch owner can apply the same deterministic rewrite sequence.
  function loadResolutionRewritesByProcess(resolutionDir: string): Map<string, JsonRecord[]> {
    const byProcess = new Map<string, JsonRecord[]>();
    if (!resolutionDir) return byProcess;
    const rewritesFile = path.join(
      runtime.resolveRepoPath(resolutionDir)!,
      "exchange-reference-rewrites.jsonl",
    );
    if (!fs.fileExists(rewritesFile)) {
      throw new Error(
        `--library-resolution directory does not contain exchange-reference-rewrites.jsonl: ${runtime.repoRelative(
          rewritesFile,
        )}`,
      );
    }
    for (const value of fs.readJsonLines(rewritesFile)) {
      const row = jsonRecord(value);
      const processId = asText(row.process_id);
      if (!processId) continue;
      if (!byProcess.has(processId)) byProcess.set(processId, []);
      byProcess.get(processId)!.push(row);
    }
    return byProcess;
  }

  function curationGateAuthoringPackagesById(
    curationGateReport: string | null,
  ): Map<string, JsonRecord> {
    const byId = new Map<string, JsonRecord>();
    if (!curationGateReport || !fs.fileExists(curationGateReport)) return byId;
    let report: JsonRecord;
    try {
      report = jsonRecord(fs.readJson(curationGateReport));
    } catch {
      return byId;
    }
    const entities = [report.entities, report.processes, report.flows, report.items].find(
      Array.isArray,
    );
    for (const entity of (entities ?? []).map(jsonRecord)) {
      const id = asText(entity.entity_id ?? entity.dataset_id);
      const packageRef = asText(entity.authoring_package);
      if (!id || !packageRef) continue;
      byId.set(id, {
        package_ref: packageRef,
        sha256: asText(entity.authoring_package_sha256) || null,
      });
    }
    return byId;
  }

  function snapshotGateAuthoringPackage({
    gatePackage,
    outDir,
  }: {
    gatePackage: JsonRecord;
    outDir: string;
  }): {
    authoring_package: string | null;
    authoring_package_sha256: string;
    contractContextKinds: string[];
  } | null {
    const packagePath = runtime.resolveRepoPath(gatePackage.package_ref);
    if (!packagePath || !fs.fileExists(packagePath)) return null;
    const sha = asText(gatePackage.sha256) || hash.sha256File(packagePath);
    const parsed = path.parse(path.basename(packagePath));
    const snapshotPath = path.join(
      outDir,
      "authoring-package-snapshots",
      `${parsed.name}.${sha}.snapshot${parsed.ext || ".json"}`,
    );
    fs.ensureDirectory(path.join(outDir, "authoring-package-snapshots"));
    if (!fs.fileExists(snapshotPath)) fs.copyFile(packagePath, snapshotPath);
    let contractContextKinds: string[] = [];
    try {
      const snapshot = jsonRecord(fs.readJson(snapshotPath));
      contractContextKinds = uniqueValues(
        recordArray(snapshot.contract_context_files)
          .filter((file) => asText(file.kind) && asText(file.text))
          .map((file) => asText(file.kind)),
      );
    } catch {
      contractContextKinds = [];
    }
    return {
      authoring_package: runtime.repoRelative(snapshotPath),
      authoring_package_sha256: sha,
      contractContextKinds,
    };
  }

  function mergeCompletedReusableIdentityDecisions({
    runDir,
    decisionsFile,
    outDir,
    datasetType,
    rowsFile = null,
    curationGateReport = null,
  }: MergeCompletedReusableIdentityDecisionsInput): CarryForwardResult {
    const currentRows = fs.fileExists(decisionsFile) ? fs.readJsonLines(decisionsFile) : [];
    const reusable = loadCompletedReusableIdentityDecisions(runDir);
    const replacements: JsonRecord[] = [];
    const additions: JsonRecord[] = [];
    const mergedRows = currentRows.map((value) => {
      const row = jsonRecord(value);
      const key = identityDecisionDatasetKey(row, datasetType);
      const reusableDecision = key ? reusable.byKey.get(key) : null;
      if (!reusableDecision || identityDecisionValue(row) !== "block_unresolved") return value;
      replacements.push({
        key,
        source_file: runtime.repoRelative(reusableDecision.source_file),
        previous_decision: identityDecisionValue(row),
        replacement_decision: "reuse_existing_reference",
        canonical: identityDecisionCanonical(reusableDecision.row),
      });
      return {
        ...reusableDecision.row,
        dataset_type: row.dataset_type ?? reusableDecision.row.dataset_type ?? datasetType,
        dataset_id:
          row.dataset_id ?? row.source_dataset_id ?? reusableDecision.row.dataset_id ?? null,
        dataset_version:
          row.dataset_version ??
          row.source_dataset_version ??
          reusableDecision.row.dataset_version ??
          "00.00.001",
        authoring_package: reusableDecision.row.authoring_package ?? row.authoring_package ?? null,
        authoring_package_sha256:
          reusableDecision.row.authoring_package_sha256 ?? row.authoring_package_sha256 ?? null,
        used_context_kinds: uniqueValues([
          ...normalizedList(reusableDecision.row.used_context_kinds),
          ...normalizedList(row.used_context_kinds),
        ]),
        closes_action_items: uniqueValues([
          ...normalizedList(reusableDecision.row.closes_action_items),
          ...normalizedList(row.closes_action_items),
        ]),
      };
    });
    if (rowsFile && fs.fileExists(rowsFile)) {
      const gatePackagesById = curationGateAuthoringPackagesById(curationGateReport);
      const decidedKeys = new Set<string>(
        mergedRows
          .map((row) => identityDecisionDatasetKey(jsonRecord(row), datasetType))
          .filter((key): key is string => Boolean(key)),
      );
      for (const payloadRow of fs.readJsonLines(rowsFile)) {
        const identity = runtime.datasetIdentity(payloadRow, datasetType);
        if (!identity?.id) continue;
        const key = identityDecisionDatasetKey(
          {
            dataset_type: datasetType,
            dataset_id: identity.id,
            dataset_version: identity.version,
          },
          datasetType,
        );
        if (!key || decidedKeys.has(key)) continue;
        const reusableDecision = reusable.byKey.get(key);
        if (!reusableDecision) continue;
        decidedKeys.add(key);
        const gatePackage = gatePackagesById.get(identity.id);
        const packageBinding = gatePackage
          ? snapshotGateAuthoringPackage({ gatePackage, outDir })
          : null;
        additions.push({
          key,
          source_file: runtime.repoRelative(reusableDecision.source_file),
          replacement_decision: "reuse_existing_reference",
          canonical: identityDecisionCanonical(reusableDecision.row),
          authoring_package: packageBinding?.authoring_package ?? null,
        });
        mergedRows.push({
          ...reusableDecision.row,
          dataset_type: datasetType,
          dataset_id: identity.id,
          dataset_version: identity.version || reusableDecision.row.dataset_version || "00.00.001",
          ...(packageBinding
            ? {
                authoring_package: packageBinding.authoring_package,
                authoring_package_sha256: packageBinding.authoring_package_sha256,
              }
            : {}),
          used_context_kinds: uniqueValues([
            ...normalizedList(reusableDecision.row.used_context_kinds),
            "schema",
            "methodology_yaml",
            "ruleset",
            ...(packageBinding?.contractContextKinds ?? []),
          ]),
        });
      }
    }
    fs.ensureDirectory(outDir);
    const changed = replacements.length > 0 || additions.length > 0;
    const outputFile = changed
      ? path.join(outDir, "identity-decisions.with-carry-forward.jsonl")
      : decisionsFile;
    if (changed) fs.writeJsonLines(outputFile, mergedRows);
    const reportPath = path.join(outDir, "identity-decision-carry-forward-report.json");
    const report: CarryForwardReport = {
      schema_version: 1,
      generated_at_utc: runtime.nowIso(),
      command: "dataset-bafu-identity-decision-carry-forward",
      status: changed ? "completed" : "completed_noop",
      remote_write_mode: "read-only",
      dataset_type: datasetType,
      files: {
        report: runtime.repoRelative(reportPath),
        input_decisions: runtime.repoRelative(decisionsFile),
        output_decisions: runtime.repoRelative(outputFile),
        source_decision_files: reusable.files.map(runtime.repoRelative),
      },
      counts: {
        input_decisions: currentRows.length,
        source_decision_files: reusable.files.length,
        reusable_decisions: reusable.byKey.size,
        replacements: replacements.length,
        additions: additions.length,
        conflicts: reusable.conflicts.length,
      },
      replacements,
      additions,
      conflicts: reusable.conflicts,
    };
    fs.writeJson(reportPath, report);
    return { report, reportPath, outputFile };
  }

  return Object.freeze({
    identityDecisionDatasetKey,
    identityDecisionValue,
    identityDecisionCanonical,
    completedReusableIdentityDecision,
    invalidateIdentityPreflightResultCacheEntry,
    identityDecisionSourceFiles,
    loadCompletedReusableIdentityDecisions,
    loadResolutionRewritesByProcess,
    mergeCompletedReusableIdentityDecisions,
  });
}

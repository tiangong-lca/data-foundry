import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { sha256Json } from "./import-curation/internal/hash-utils.ts";

type JsonRecord = Record<string, unknown>;

type FinalizeOptions = Record<string, unknown>;

type StageReport = JsonRecord & {
  status?: unknown;
  files?: JsonRecord;
  rewrite_rows?: unknown;
};

type IdentityPreflightCommands = {
  identityPreflightRunIndexPath: (options: FinalizeOptions) => string | null;
  runDatasetIdentityPreflightRequestsBuild: (options: FinalizeOptions) => StageReport;
  runDatasetIdentityPreflightIndexMerge: (options: FinalizeOptions) => StageReport;
  runDatasetIdentityPreflightRun: (options: FinalizeOptions) => StageReport;
};

type FinalizeFactoryDependencies = {
  asText: (value: unknown) => string;
  booleanOption: (value: unknown) => boolean;
  cliWrapperCommands: {
    runDatasetCurationQueueBuild: (options: FinalizeOptions) => StageReport;
  };
  countRowsFile: (filePath: string) => number;
  datasetIdentity: (row: JsonRecord, datasetType: string) => { id: string; version: string };
  ensureArray: <T>(value: T | T[] | null | undefined) => T[];
  fileExists: (filePath: string | null) => boolean;
  identityPreflightCommands: IdentityPreflightCommands;
  identityReferenceRewriteIndexPath: (options: FinalizeOptions, rowsFile: string) => string | null;
  normalizedList: (value: unknown) => string[];
  readRowsFile: (filePath: string | null) => JsonRecord[];
  referenceShortDescription: (reference: JsonRecord) => string;
  repoRelativeMaybe: (filePath: string | null) => string | null;
  resolveRepoPath: (value: unknown) => string | null;
  unique: <T>(values: T[]) => T[];
  writeJsonLines: (filePath: string, rows: JsonRecord[]) => unknown;
};

type ExternalReferenceRow = JsonRecord & {
  id: string;
  dataset_id: string;
  version: string;
  dataset_version: string;
  references: JsonRecord[];
};

function record(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : null;
}

export function createPostAuthoringFinalizeUtils({
  asText,
  booleanOption,
  cliWrapperCommands,
  countRowsFile,
  datasetIdentity,
  ensureArray,
  fileExists,
  identityPreflightCommands,
  identityReferenceRewriteIndexPath,
  normalizedList,
  readRowsFile,
  referenceShortDescription,
  repoRelativeMaybe,
  resolveRepoPath,
  unique,
  writeJsonLines,
}: FinalizeFactoryDependencies) {
  function sourceReferenceRewritesFileForRowsFile(
    rowsFile: string | null,
    options: FinalizeOptions = {},
  ): string | null {
    const configured = resolveRepoPath(
      options.sourceReferenceRewrites ||
        options.sourceReferenceRewritesFile ||
        options.sourceReferenceRewriteFile ||
        options.referenceRewrites ||
        options.referenceRewritesFile,
    );
    if (configured && fileExists(configured)) return configured;
    if (!rowsFile) return null;
    const rowsDir = path.dirname(rowsFile);
    const candidates = [
      path.join(rowsDir, "source-reference-rewrites.jsonl"),
      path.join(path.dirname(rowsDir), "source-reference-rewrites.jsonl"),
    ];
    return candidates.find((candidate) => fileExists(candidate)) ?? null;
  }

  function identityReferenceRewritesFileForRowsFile(
    rowsFile: string | null,
    options: FinalizeOptions = {},
  ): string | null {
    const configured = resolveRepoPath(
      options.identityReferenceRewrites ||
        options.identityReferenceRewritesFile ||
        options.identityFlowReferenceRewrites ||
        options.identityFlowReferenceRewritesFile,
    );
    if (configured && fileExists(configured)) return configured;
    if (!rowsFile) return null;
    const rowsDir = path.dirname(rowsFile);
    const candidates = [
      path.join(rowsDir, "identity-reference-rewrites.jsonl"),
      path.join(rowsDir, "identity-flow-reference-rewrites.jsonl"),
      path.join(path.dirname(rowsDir), "identity-reference-rewrites.jsonl"),
      path.join(path.dirname(rowsDir), "identity-flow-reference-rewrites.jsonl"),
    ];
    return candidates.find((candidate) => fileExists(candidate)) ?? null;
  }

  function existingSiblingRowsFile(rowsFile: string | null, fileName: string): string | null {
    if (!rowsFile) return null;
    const candidate = path.join(path.dirname(rowsFile), fileName);
    return fileExists(candidate) && countRowsFile(candidate) > 0 ? candidate : null;
  }

  function defaultFinalizeSupportRowsFiles(rowsFile: string): string[] {
    const support = existingSiblingRowsFile(rowsFile, "support.jsonl");
    if (support) return [support];
    return [
      existingSiblingRowsFile(rowsFile, "contacts.jsonl"),
      existingSiblingRowsFile(rowsFile, "sources.jsonl"),
    ].filter((filePath): filePath is string => Boolean(filePath));
  }

  function identityRewriteExternalFlowRefRows(
    identityReferenceRewriteStage: StageReport | null,
  ): JsonRecord[] {
    const seen = new Set<string>();
    const rows: JsonRecord[] = [];
    for (const rewrite of ensureArray<JsonRecord>(
      identityReferenceRewriteStage?.rewrite_rows as JsonRecord | JsonRecord[],
    )) {
      const canonical = record(rewrite.canonical) ?? {};
      const id = asText(canonical.ref_object_id ?? canonical.refObjectId ?? canonical.id);
      if (!id) continue;
      const version = asText(canonical.version) || "00.00.001";
      const key = `${id}@@${version}`;
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push({
        id,
        dataset_id: id,
        version,
        dataset_version: version,
        source: "identity_reference_rewrite",
        reason:
          "Existing database flow selected by CLI identity-preflight and used as an external flow reference for curation queue dependency closure.",
      });
    }
    return rows;
  }

  function writeIdentityRewriteExternalFlowRefs({
    outDir,
    identityReferenceRewriteStage,
  }: {
    outDir: string;
    identityReferenceRewriteStage: StageReport | null;
  }): string | null {
    const rows = identityRewriteExternalFlowRefRows(identityReferenceRewriteStage);
    if (rows.length === 0) return null;
    const filePath = path.join(outDir, "identity-reference-rewrite-external-flow-refs.jsonl");
    writeJsonLines(filePath, rows);
    return filePath;
  }

  function existingOptionFile(value: unknown, label: string): string | null {
    const files = existingOptionFiles(value, label);
    if (files.length > 1) {
      throw new Error(`${label} accepts one file, received ${files.length}.`);
    }
    return files[0] ?? null;
  }

  function existingOptionFiles(value: unknown, label: string): string[] {
    return normalizedList(value).map((input) => {
      const resolved = resolveRepoPath(input);
      if (!fileExists(resolved)) {
        throw new Error(`${label} must point to an existing file: ${input}`);
      }
      return resolved!;
    });
  }

  function curationQueueManifestFile(queueDir: string | null): string | null {
    if (!queueDir) return null;
    const manifest = path.join(queueDir, "outputs", "curation-queue-manifest.json");
    return fileExists(manifest) ? manifest : null;
  }

  function writeProcessReferenceExternalFlowRefs({
    outDir,
    processRowsFile,
    flowRowsFile,
  }: {
    outDir: string;
    processRowsFile: string | null;
    flowRowsFile: string | null;
  }): string | null {
    if (!processRowsFile || !fileExists(processRowsFile)) return null;
    const localFlowKeys = new Set<string>();
    for (const row of readRowsFile(flowRowsFile)) {
      const identity = datasetIdentity(row, "flow");
      if (!identity.id) continue;
      localFlowKeys.add(identity.id);
      localFlowKeys.add(`${identity.id}@@${identity.version || "00.00.001"}`);
    }

    const refs = new Map<string, ExternalReferenceRow>();
    for (const [rowIndex, row] of readRowsFile(processRowsFile).entries()) {
      const processIdentity = datasetIdentity(row, "process");
      const processDataSet = record(row.processDataSet);
      const exchanges = ensureArray<JsonRecord>(
        record(processDataSet?.exchanges)?.exchange as JsonRecord | JsonRecord[],
      );
      for (const [exchangeIndex, exchange] of exchanges.entries()) {
        const reference = record(exchange.referenceToFlowDataSet);
        if (!reference) continue;
        const id = asText(reference["@refObjectId"]);
        if (!id) continue;
        const version = asText(reference["@version"]) || "00.00.001";
        if (localFlowKeys.has(id) || localFlowKeys.has(`${id}@@${version}`)) {
          continue;
        }
        const key = `${id}@@${version}`;
        const existing = refs.get(key) ?? {
          id,
          dataset_id: id,
          version,
          dataset_version: version,
          table: "flows",
          source: "process_reference_remote_verify_required",
          short_description: referenceShortDescription(reference) || id,
          reason:
            "Process references this flow outside the current local flow write scope. Foundry declares it as an external flow reference for curation queue closure; mutation manifest and remote verification must prove it exists before commit.",
          references: [],
        };
        existing.references.push({
          process_id: processIdentity.id,
          process_version: processIdentity.version || "00.00.001",
          row_index: rowIndex,
          path: `processDataSet.exchanges.exchange.${exchangeIndex}.referenceToFlowDataSet`,
        });
        refs.set(key, existing);
      }
    }

    const rows = [...refs.values()];
    const outFile = path.join(outDir, "process-reference-external-flow-refs.jsonl");
    writeJsonLines(outFile, rows);
    return rows.length > 0 ? outFile : null;
  }

  function readJsonIfExists(filePath: string | null): JsonRecord | null {
    if (!filePath || !fileExists(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as JsonRecord;
  }

  function resolveIndexArtifact(indexPath: string, artifactPath: unknown): string | null {
    const text = asText(artifactPath);
    if (!text) return null;
    if (path.isAbsolute(text)) return text;
    const repoPath = resolveRepoPath(text);
    if (fileExists(repoPath)) return repoPath;
    return path.resolve(path.dirname(indexPath), text);
  }

  function identityPreflightIndexTargetSha(indexPath: string, row: JsonRecord): string | null {
    const direct = asText(row?.target_sha256 ?? row?.targetSha256);
    if (direct) return direct;
    const requestPath = resolveIndexArtifact(indexPath, row?.request_file ?? row?.requestFile);
    const request = readJsonIfExists(requestPath);
    return request?.target ? sha256Json(request.target) : null;
  }

  function currentScopeIdentityPreflightRefreshPlan({
    datasetType,
    rowsFile,
    indexPath,
  }: {
    datasetType: unknown;
    rowsFile: string;
    indexPath: string;
  }) {
    const normalizedType = String(datasetType || "").toLowerCase();
    if (!["flow", "process"].includes(normalizedType)) {
      return {
        required: false,
        reason: "dataset_type_not_identity_preflight_refreshable",
        current_rows: 0,
        index_rows: 0,
        stale_rows: 0,
        missing_rows: 0,
        missing_target_hash_rows: 0,
      };
    }
    const currentRows = readRowsFile(rowsFile);
    const indexRows = readRowsFile(indexPath);
    const indexByKey = new Map<string, JsonRecord>();
    for (const row of indexRows) {
      const type = String(row?.dataset_type ?? row?.type ?? "").toLowerCase();
      const id = asText(row?.dataset_id ?? row?.entity_id ?? row?.id);
      const version = asText(row?.dataset_version ?? row?.version) || "00.00.001";
      if (!type || !id) continue;
      indexByKey.set(`${type}:${id}@@${version}`, row);
      if (!indexByKey.has(`${type}:${id}`)) {
        indexByKey.set(`${type}:${id}`, row);
      }
    }

    const staleRows: JsonRecord[] = [];
    const missingRows: JsonRecord[] = [];
    const missingTargetHashRows: JsonRecord[] = [];
    for (const payload of currentRows) {
      const identity = datasetIdentity(payload, normalizedType);
      if (!identity.id) continue;
      const version = identity.version || "00.00.001";
      const row =
        indexByKey.get(`${normalizedType}:${identity.id}@@${version}`) ??
        indexByKey.get(`${normalizedType}:${identity.id}`);
      if (!row) {
        missingRows.push({ id: identity.id, version });
        continue;
      }
      const targetSha = identityPreflightIndexTargetSha(indexPath, row);
      if (!targetSha) {
        missingTargetHashRows.push({ id: identity.id, version });
        continue;
      }
      const currentSha = sha256Json(payload);
      if (targetSha !== currentSha) {
        staleRows.push({
          id: identity.id,
          version,
          request_target_sha256: targetSha,
          current_payload_sha256: currentSha,
        });
      }
    }
    const required =
      missingRows.length > 0 || missingTargetHashRows.length > 0 || staleRows.length > 0;
    return {
      required,
      reason: required ? "current_scope_index_not_exact" : "current_scope_index_exact",
      current_rows: currentRows.length,
      index_rows: indexRows.length,
      stale_rows: staleRows.length,
      missing_rows: missingRows.length,
      missing_target_hash_rows: missingTargetHashRows.length,
      examples: [...missingRows, ...missingTargetHashRows, ...staleRows].slice(0, 5),
    };
  }

  function runFinalizeAutoCurationQueue({
    datasetType,
    rowsFile,
    cleanedRowsFile,
    outDir,
    options,
    fullContextRequirement,
    identityReferenceRewriteStage,
  }: {
    datasetType: string;
    rowsFile: string;
    cleanedRowsFile: string;
    outDir: string;
    options: FinalizeOptions;
    fullContextRequirement: unknown;
    identityReferenceRewriteStage: StageReport | null;
  }) {
    const providedQueueDir = resolveRepoPath(options.queueDir || options.curationQueueDir);
    if (providedQueueDir) {
      return {
        stage: "curation_queue",
        status: "provided",
        queue_dir: providedQueueDir,
        report_file: curationQueueManifestFile(providedQueueDir),
        report: null,
        files: {},
      };
    }
    if (!(Boolean(fullContextRequirement) && datasetType === "process")) {
      return {
        stage: "curation_queue",
        status: "not_required",
        queue_dir: null,
        report_file: null,
        report: null,
        files: {},
      };
    }

    const queueDir = path.join(outDir, "curation-queue");
    const queueInputsDir = path.join(outDir, "curation-queue-inputs");
    const flowsFile =
      existingOptionFile(options.flows || options.flowsFile || options.flowRows, "--flows") ??
      existingSiblingRowsFile(rowsFile, "flows.jsonl");
    const explicitSupportFiles = existingOptionFiles(
      options.support || options.supportFile || options.supportRows,
      "--support",
    );
    const supportFiles =
      explicitSupportFiles.length > 0
        ? explicitSupportFiles
        : defaultFinalizeSupportRowsFiles(rowsFile);
    const explicitExternalFlowRefs = existingOptionFiles(
      options.externalFlowRef ||
        options.externalFlowRefs ||
        options.externalFlowRefFile ||
        options.externalFlowRefRows,
      "--external-flow-ref",
    );
    const identityExternalRefs = writeIdentityRewriteExternalFlowRefs({
      outDir: queueInputsDir,
      identityReferenceRewriteStage,
    });
    const processReferenceExternalRefs = writeProcessReferenceExternalFlowRefs({
      outDir: queueInputsDir,
      processRowsFile: cleanedRowsFile,
      flowRowsFile: flowsFile,
    });
    const externalFlowRefFiles = unique([
      ...explicitExternalFlowRefs,
      identityExternalRefs,
      processReferenceExternalRefs,
    ]).filter((filePath): filePath is string => Boolean(filePath));

    const report = cliWrapperCommands.runDatasetCurationQueueBuild({
      processes: cleanedRowsFile,
      flows: flowsFile,
      support: supportFiles,
      externalFlowRef: externalFlowRefFiles,
      outDir: queueDir,
    });
    return {
      stage: "curation_queue",
      status: report.status,
      queue_dir: queueDir,
      report_file: resolveRepoPath(record(report.files)?.manifest),
      report,
      files: {
        manifest: record(report.files)?.manifest ?? null,
        identity_external_flow_refs: repoRelativeMaybe(identityExternalRefs),
        process_reference_external_flow_refs: repoRelativeMaybe(processReferenceExternalRefs),
      },
    };
  }

  // Mega-scope speedup (opt-in via IDENTITY_PREFLIGHT_CONCURRENCY): the per-flow identity
  // preflight remote search is independent per flow and the remote scales with concurrency,
  // but the in-process run loop is serial — the dominant cost on ~2000-flow mega-scopes. When
  // enabled, pre-populate the per-flow identity-decision.json artifacts by running N shard
  // processes of the SAME index over disjoint --offset/--limit slices in parallel; the
  // subsequent in-process run (onlyPending) then sees those flows as completed and skips their
  // remote search. Any shard that fails simply leaves its flows pending, so the in-process run
  // completes them serially — this is a best-effort accelerator that NEVER changes the result.
  // Default 1 → no sharding → the existing serial path runs unchanged (BAFU byte-identical).
  // Applies to every profile (BAFU/USLCI/future) whenever the env var is set.
  function runIdentityPreflightShardsInParallel({
    index,
    outDir,
    options,
  }: {
    index: string | null;
    outDir: string;
    options: FinalizeOptions;
  }): JsonRecord {
    const concurrency = Math.max(
      1,
      Number.parseInt(
        process.env.IDENTITY_PREFLIGHT_CONCURRENCY ??
          String(options.identityPreflightConcurrency ?? "1"),
        10,
      ) || 1,
    );
    if (concurrency <= 1 || !index || !fileExists(index)) {
      return { sharded: false, concurrency: 1 };
    }
    const total = countRowsFile(index);
    if (!total || total <= concurrency) {
      return { sharded: false, concurrency, total: total ?? 0 };
    }
    const chunk = Math.ceil(total / concurrency);
    const foundry = resolveRepoPath("scripts/foundry.mjs")!;
    const repoRoot = path.dirname(resolveRepoPath("package.json")!);
    const timeoutMs =
      options.identityPreflightTimeoutMs ||
      options.identityPreflightTimeout ||
      options.timeoutMs ||
      options.timeout;
    const maxAttempts =
      options.identityPreflightMaxAttempts || options.identityPreflightRetryAttempts || 3;
    const commands: string[][] = [];
    for (let i = 0; i < concurrency; i += 1) {
      const offset = i * chunk;
      if (offset >= total) break;
      const args = [
        foundry,
        "dataset-identity-preflight-run",
        "--index",
        index,
        "--out-dir",
        path.join(outDir, "identity-preflight-run-parallel", `shard-${i}`),
        "--offset",
        String(offset),
        "--limit",
        String(chunk),
        "--only-pending",
      ];
      if (timeoutMs) args.push("--timeout-ms", String(timeoutMs));
      if (maxAttempts) args.push("--max-attempts", String(maxAttempts));
      commands.push([process.execPath, ...args]);
    }
    const listFile = path.join(outDir, "identity-preflight-run-parallel", "shard-commands.json");
    fs.mkdirSync(path.dirname(listFile), { recursive: true });
    fs.writeFileSync(listFile, JSON.stringify(commands));
    // Spawn all shards concurrently from a one-shot node worker (args passed as arrays, no
    // shell quoting), wait for every shard, and surface a non-zero exit if any shard failed.
    const worker =
      "const fs=require('fs'),cp=require('child_process');" +
      "const cmds=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));let fail=0;" +
      "Promise.all(cmds.map(c=>new Promise(r=>{" +
      `const p=cp.spawn(c[0],c.slice(1),{cwd:${JSON.stringify(repoRoot)},env:process.env,stdio:"ignore"});` +
      "p.on('close',code=>{if(code!==0)fail=1;r();});p.on('error',()=>{fail=1;r();});" +
      "}))).then(()=>process.exit(fail));";
    const result = spawnSync(process.execPath, ["-e", worker, listFile], {
      cwd: repoRoot,
      env: process.env,
      encoding: "utf8",
    });
    return {
      sharded: true,
      concurrency,
      shards: commands.length,
      total,
      chunk,
      exit_code: typeof result.status === "number" ? result.status : null,
    };
  }

  function preseedResolutionReuseDecisions({ index }: { index: string | null }): JsonRecord {
    const mapFile = resolveRepoPath(process.env.IDENTITY_PREFLIGHT_REUSE_MAP);
    if (!mapFile || !fileExists(mapFile) || !index || !fileExists(index)) {
      return { enabled: false, seeded: 0 };
    }
    return {
      enabled: false,
      seeded: 0,
      reason: "bound_library_resolution_seed_manifest_required",
    };
  }

  function runFinalizeIdentityPreflightStage({
    rowsFile,
    outDir,
    options,
  }: {
    rowsFile: string;
    outDir: string;
    options: FinalizeOptions;
  }): JsonRecord {
    if (!booleanOption(options.runIdentityPreflight)) {
      return {
        stage: "identity_preflight_run",
        status: "not_requested",
        report: null,
        report_file: null,
      };
    }
    const baseIndexPath =
      identityPreflightCommands.identityPreflightRunIndexPath(options) ||
      identityReferenceRewriteIndexPath(options, rowsFile);
    if (!baseIndexPath || !fileExists(baseIndexPath)) {
      throw new Error(
        "--run-identity-preflight requires --identity-preflight-index, --index, or a sibling identity-preflight-requests/identity-preflight-requests.jsonl.",
      );
    }
    const refreshRequested =
      options.refreshIdentityPreflight === undefined
        ? false
        : booleanOption(options.refreshIdentityPreflight);
    const allowStaleIdentityPreflight = booleanOption(
      options.allowStaleIdentityPreflight || options.allowStaleIdentityPreflightIndex,
    );
    const refreshPlan = currentScopeIdentityPreflightRefreshPlan({
      datasetType: options.type,
      rowsFile,
      indexPath: baseIndexPath,
    });
    let indexPath = baseIndexPath;
    let refreshReport: StageReport | null = null;
    let mergeReport: StageReport | null = null;
    const refreshForcedButExact = Boolean(
      !allowStaleIdentityPreflight && refreshRequested && !refreshPlan.required,
    );
    if (
      !allowStaleIdentityPreflight &&
      refreshPlan.required &&
      ["flow", "process"].includes(String(options.type || "").toLowerCase())
    ) {
      const baseIndexHasSourceContext = readRowsFile(baseIndexPath).some((row) =>
        asText(row?.source_file ?? row?.sourceFile),
      );
      refreshReport = identityPreflightCommands.runDatasetIdentityPreflightRequestsBuild({
        type: options.type,
        rowsFile,
        ...(baseIndexHasSourceContext ? { sourceIndex: baseIndexPath } : {}),
        outDir: path.join(outDir, "identity-preflight-current-scope", "requests"),
      });
      const refreshIndex = resolveRepoPath(
        record(refreshReport.files)?.identity_preflight_requests,
      );
      if (refreshReport.status === "ready" && refreshIndex && fileExists(refreshIndex)) {
        mergeReport = identityPreflightCommands.runDatasetIdentityPreflightIndexMerge({
          baseIndex: baseIndexPath,
          updateIndex: refreshIndex,
          outDir: path.join(outDir, "identity-preflight-current-scope", "merge"),
        });
        const mergedIndex = resolveRepoPath(record(mergeReport.files)?.merged_index);
        if (mergeReport.status === "ready" && mergedIndex && fileExists(mergedIndex)) {
          indexPath = mergedIndex;
        }
      }
    }
    if (refreshReport && refreshReport.status !== "ready") {
      return {
        stage: "identity_preflight_run",
        status: "blocked_current_scope_refresh",
        report: refreshReport,
        report_file: resolveRepoPath(record(refreshReport.files)?.report),
        index_file: repoRelativeMaybe(indexPath),
        refresh_report_file: repoRelativeMaybe(
          resolveRepoPath(record(refreshReport.files)?.report),
        ),
        merge_report_file: null,
      };
    }
    if (mergeReport && mergeReport.status !== "ready") {
      return {
        stage: "identity_preflight_run",
        status: "blocked_current_scope_merge",
        report: mergeReport,
        report_file: resolveRepoPath(record(mergeReport.files)?.report),
        index_file: repoRelativeMaybe(indexPath),
        refresh_report_file: repoRelativeMaybe(
          resolveRepoPath(record(refreshReport?.files)?.report),
        ),
        merge_report_file: repoRelativeMaybe(resolveRepoPath(record(mergeReport.files)?.report)),
      };
    }
    // Unbound synthetic reports are intentionally disabled. A future optimization must bind the
    // request, library-resolution bytes, canonical target, and producer provenance in a dedicated
    // seed manifest before onlyPending may skip the live identity search.
    const reuseSeed = preseedResolutionReuseDecisions({ index: indexPath });
    // Best-effort parallel pre-pass (opt-in): populate the REMAINING per-flow decisions concurrently
    // so the in-process run below skips them via onlyPending. No-op when IDENTITY_PREFLIGHT_CONCURRENCY
    // is unset/1, so BAFU and any non-opted run are byte-identical to before.
    const parallelShards = runIdentityPreflightShardsInParallel({
      index: indexPath,
      outDir,
      options,
    });
    const report = identityPreflightCommands.runDatasetIdentityPreflightRun({
      index: indexPath,
      outDir: path.join(outDir, "identity-preflight-run"),
      onlyPending: options.onlyPending === undefined ? true : booleanOption(options.onlyPending),
      timeoutMs:
        options.identityPreflightTimeoutMs ||
        options.identityPreflightTimeout ||
        options.timeoutMs ||
        options.timeout,
      // Transient CLI/remote failures (timeout, missing JSON report) are retriable per
      // identity-preflight-run; without this a single remote blip blocks the curation gate.
      maxAttempts:
        options.identityPreflightMaxAttempts || options.identityPreflightRetryAttempts || 3,
      dryRun: options.identityPreflightDryRun || options.dryRunIdentityPreflight,
      authReceipt:
        options.identityPreflightAuthReceipt ||
        options.authReceipt ||
        options.authIdentityReceipt ||
        options.accountReceipt,
      expectedProjectRef:
        options.identityPreflightExpectedProjectRef ||
        options.expectedProjectRef ||
        options.expectedProject ||
        options.projectRef,
      expectedUserId:
        options.identityPreflightExpectedUserId || options.expectedUserId || options.targetUserId,
      authReceiptMaxAgeMs:
        options.identityPreflightAuthReceiptMaxAgeMs || options.authReceiptMaxAgeMs,
    });
    return {
      stage: "identity_preflight_run",
      status: report.status,
      report,
      report_file: resolveRepoPath(record(report.files)?.report),
      index_file: repoRelativeMaybe(indexPath),
      base_index_file: repoRelativeMaybe(baseIndexPath),
      refresh_required: Boolean(!allowStaleIdentityPreflight && refreshPlan.required),
      refresh_forced: Boolean(
        !allowStaleIdentityPreflight && refreshRequested && refreshPlan.required,
      ),
      refresh_force_skipped_exact: refreshForcedButExact,
      refresh_plan: refreshPlan,
      refresh_report_file: repoRelativeMaybe(resolveRepoPath(record(refreshReport?.files)?.report)),
      merge_report_file: repoRelativeMaybe(resolveRepoPath(record(mergeReport?.files)?.report)),
      refresh_report: refreshReport,
      merge_report: mergeReport,
      parallel_shards: parallelShards,
      reuse_seed: reuseSeed,
    };
  }

  return {
    identityReferenceRewritesFileForRowsFile,
    preseedResolutionReuseDecisions,
    runFinalizeAutoCurationQueue,
    runFinalizeIdentityPreflightStage,
    sourceReferenceRewritesFileForRowsFile,
  };
}

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { readOnlyStageContract } from "../lib/stage-contract.ts";

// Run-level identity-preflight RESULT cache (env-gated; off unless
// BAFU_IDENTITY_PREFLIGHT_RESULT_CACHE points at a directory). The remote
// candidate search is a pure function of the flow's IDENTITY, so the same flow
// referenced by many scopes need only be searched once. The cache is keyed by
// dataset identity (type:id@version) — NOT by full content hash: the same flow id
// carries identical identity fields across scopes (only provenance/sourceTrace
// metadata varies), so content hashing would miss every cross-scope hit. The batch
// runner invalidates a flow's entry the moment that flow is minted/committed, so a
// later scope re-searches and reuses the freshly minted flow instead of duplicating it.
function identityPreflightResultCacheDir(resolveRepoPath) {
  const raw = process.env.BAFU_IDENTITY_PREFLIGHT_RESULT_CACHE;
  return raw ? resolveRepoPath(raw) : null;
}
function identityPreflightResultCacheEntryDir(cacheDir, datasetType, datasetId, datasetVersion) {
  if (!cacheDir || !datasetId) return null;
  const key = `${datasetType || "flow"}:${datasetId}@${datasetVersion || "00.00.001"}`;
  return path.join(cacheDir, key.replace(/[^A-Za-z0-9_.@-]+/gu, "-"));
}

const identityPreflightRunStageContract = readOnlyStageContract([
  {
    stage: "load_index",
    phase: "prepare",
    purpose: "Read and select rows from a Foundry identity-preflight request index.",
    inputs: ["identity-preflight-requests.jsonl", "dataset type/id/offset/limit options"],
    outputs: ["selected request rows"],
    side_effects: [],
  },
  {
    stage: "normalize_requests",
    phase: "rewrite_cleanup",
    purpose:
      "Resolve request files, output directories, row keys, retry settings, and timeout settings before invoking the published CLI.",
    inputs: ["selected request rows", "runner options"],
    outputs: ["normalized executable request descriptors"],
    side_effects: [],
  },
  {
    stage: "execute_cli_preflight",
    phase: "gate_validate",
    purpose:
      "Execute the published tiangong-lca flow/process identity-preflight command for each selected request.",
    inputs: ["selected request rows", "request JSON files"],
    outputs: ["identity-decision.json", "identity candidate artifacts", "stdout/stderr logs"],
    side_effects: ["runs published CLI read-only search", "writes local .foundry artifacts"],
  },
  {
    stage: "collect_evidence",
    phase: "report",
    purpose:
      "Normalize CLI results so blocked/needs-review identity findings remain evidence rather than runner failures.",
    inputs: ["CLI stdout", "identity-decision report files"],
    outputs: ["identity-preflight-run-results.jsonl"],
    side_effects: ["writes local .foundry artifacts"],
  },
  {
    stage: "report",
    phase: "report",
    purpose: "Emit selected counts, failures, identity findings, and artifact paths.",
    inputs: ["normalized run results"],
    outputs: ["dataset-identity-preflight-run-report.json"],
    side_effects: ["writes local .foundry artifacts"],
  },
]);

export function createIdentityPreflightRunCommands({
  asText,
  booleanOption,
  buildIdentityPreflightArtifacts,
  datasetIdentity,
  ensureArray,
  fileExists,
  identityPreflightSourceIndexPaths,
  integerOption,
  jsonSha256,
  loadIdentityPreflightSourceFileMap,
  normalizedList,
  nowIso,
  positiveIntegerOption,
  readJson,
  readJsonLines,
  readRowsFile,
  repoRelativeMaybe,
  repoRelativePath,
  repoRoot,
  resolveRepoPath,
  resolveTiangongLcaCliCommand,
  resolveTiangongLcaCliCommandPrefix,
  resolveTiangongLcaCliBin,
  safeFileToken,
  sha256Text,
  shellQuote,
  writeJson,
  writeJsonLines,
  writeText,
}) {
  function identityPreflightRunIndexPath(options) {
    return resolveRepoPath(
      options.index ||
        options.input ||
        options.identityPreflightIndex ||
        options.identityPreflightRequests,
    );
  }

  function identityPreflightSpawnTimeoutMs(timeoutMs) {
    const graceMs = Math.min(5_000, Math.max(250, Math.ceil(timeoutMs * 0.1)));
    return timeoutMs + graceMs;
  }

  function identityPreflightRunReportFile(row) {
    const explicit =
      row.expected_report_file ||
      row.identity_decision_file ||
      row.identityDecisionFile ||
      row.report_file ||
      row.reportFile;
    if (explicit) return resolveRepoPath(explicit);
    const outputDir = row.output_dir || row.outputDir;
    return outputDir
      ? path.join(resolveRepoPath(outputDir), "outputs", "identity-decision.json")
      : null;
  }

  function identityPreflightRunOutputDir(row) {
    const outputDir = row.output_dir || row.outputDir;
    if (outputDir) return resolveRepoPath(outputDir);
    const reportFile = identityPreflightRunReportFile(row);
    return reportFile ? path.dirname(path.dirname(reportFile)) : null;
  }

  function identityPreflightRunRequestFile(row) {
    return resolveRepoPath(row.request_file || row.requestFile || row.input);
  }

  function identityPreflightRunRowKey(row, index) {
    return [
      row.dataset_type || row.type || "dataset",
      row.dataset_id || row.entity_id || row.id || `row-${index}`,
      row.dataset_version || row.version || "00.00.001",
    ].join(":");
  }

  function selectIdentityPreflightRunRows(rows, options) {
    const datasetTypes = new Set(
      normalizedList(options.datasetType || options.datasetTypes || options.type),
    );
    const ids = new Set(normalizedList(options.id || options.ids || options.datasetId));
    const offset = Math.max(0, integerOption(options.offset, 0) ?? 0);
    const limit = positiveIntegerOption(options.limit || options.count, null);
    const filtered = rows.filter((row) => {
      const datasetType = asText(row.dataset_type || row.type);
      const id = asText(row.dataset_id || row.entity_id || row.id);
      if (datasetTypes.size > 0 && !datasetTypes.has(datasetType)) return false;
      if (ids.size > 0 && !ids.has(id)) return false;
      return true;
    });
    return filtered.slice(offset, limit ? offset + limit : undefined);
  }

  function identityPreflightRunIdentityKey(row) {
    return [
      asText(row?.dataset_type || row?.type),
      asText(row?.dataset_id || row?.entity_id || row?.id),
      asText(row?.dataset_version || row?.version) || "00.00.001",
    ].join(":");
  }

  function parseJsonMaybe(text) {
    try {
      return text ? JSON.parse(text) : null;
    } catch {
      return null;
    }
  }

  function retryFailedRowsFromArtifact(value) {
    if (!value) return [];
    if (Array.isArray(value)) return value.flatMap(retryFailedRowsFromArtifact);
    if (typeof value !== "object") return [];
    const directStatus = asText(value.status);
    const hasFailure =
      directStatus === "failed" || Boolean(value.failure_code) || Boolean(value.failed === true);
    const nested = [value.results, value.rows, value.items, value.blockers, value.failures].flatMap(
      retryFailedRowsFromArtifact,
    );
    return hasFailure ? [value, ...nested] : nested;
  }

  function retryFailedKeysFromArtifact(retryFailedPath) {
    if (!retryFailedPath || !fileExists(retryFailedPath)) return new Set();
    const value = retryFailedPath.toLowerCase().endsWith(".jsonl")
      ? readJsonLines(retryFailedPath)
      : readJson(retryFailedPath);
    const keys = retryFailedRowsFromArtifact(value)
      .map(identityPreflightRunIdentityKey)
      .filter((key) => !key.startsWith(":"));
    return new Set(keys);
  }

  function retriableIdentityPreflightFailure(row) {
    return ["identity_preflight_timeout", "identity_preflight_report_missing_or_non_json"].includes(
      row?.failure_code,
    );
  }

  function runDatasetIdentityPreflightRun(options) {
    if (options.help) {
      return {
        schema_version: 1,
        status: "help",
        command: "dataset-identity-preflight-run",
        purpose:
          "Execute Foundry-generated process/flow identity-preflight request indexes through the CLI without writing the database.",
        usage: [
          "node scripts/foundry.mjs dataset-identity-preflight-run --index <identity-preflight-requests.jsonl> --out-dir <run-dir> --timeout-ms 60000",
          "node scripts/foundry.mjs dataset-identity-preflight-run --index ./identity-preflight-requests/identity-preflight-requests.jsonl --only-pending --timeout-ms 60000",
          "node scripts/foundry.mjs dataset-identity-preflight-run --index ./identity-preflight-requests/identity-preflight-requests.jsonl --retry-failed ./identity-preflight-run/dataset-identity-preflight-run-report.json --max-attempts 3",
        ],
        ...identityPreflightRunStageContract,
      };
    }
    const indexPath = identityPreflightRunIndexPath(options);
    if (!indexPath || !fileExists(indexPath)) {
      throw new Error("--index is required and must point to identity-preflight-requests.jsonl.");
    }
    const outDir = resolveRepoPath(
      options.outDir || path.join(path.dirname(path.dirname(indexPath)), "identity-preflight-run"),
    );
    const rows = readJsonLines(indexPath);
    const retryFailedPath = resolveRepoPath(
      options.retryFailed || options.retryFailedReport || options.retryLedger,
    );
    const retryFailedKeys = retryFailedPath ? retryFailedKeysFromArtifact(retryFailedPath) : null;
    const initiallySelectedRows = selectIdentityPreflightRunRows(rows, options);
    const selectedRows = retryFailedKeys
      ? initiallySelectedRows.filter((row) =>
          retryFailedKeys.has(identityPreflightRunIdentityKey(row)),
        )
      : initiallySelectedRows;
    const onlyPending = booleanOption(options.onlyPending);
    const dryRun = booleanOption(options.dryRun);
    const maxAttempts = positiveIntegerOption(
      options.maxAttempts || options.retryMaxAttempts,
      retryFailedKeys ? 3 : 1,
    );
    const timeoutMs = positiveIntegerOption(
      options.timeoutMs || options.timeout || options.identityPreflightTimeoutMs,
      60_000,
    );
    const spawnTimeoutMs = identityPreflightSpawnTimeoutMs(timeoutMs);
    const cli = resolveTiangongLcaCliCommand
      ? resolveTiangongLcaCliCommand()
      : {
          command: resolveTiangongLcaCliBin(),
          args: [],
          display: resolveTiangongLcaCliBin(),
          package: null,
        };
    const logDir = path.join(outDir, "logs");
    const resultRows = [];
    const resultCacheDir = identityPreflightResultCacheDir(resolveRepoPath);

    selectedRows.forEach((row, selectedIndex) => {
      const datasetType = asText(row.dataset_type || row.type);
      const datasetId = asText(row.dataset_id || row.entity_id || row.id);
      const datasetVersion = asText(row.dataset_version || row.version) || "00.00.001";
      const requestFile = identityPreflightRunRequestFile(row);
      const outputDir = identityPreflightRunOutputDir(row);
      const reportFile = identityPreflightRunReportFile(row);
      const key = identityPreflightRunRowKey(row, selectedIndex);
      const logToken = safeFileToken(key, `row-${selectedIndex}`);
      const stdoutLog = path.join(logDir, `${logToken}.stdout.json`);
      const stderrLog = path.join(logDir, `${logToken}.stderr.log`);

      // Restore a cached search result for this flow identity (skips the remote search).
      const resultCacheEntryDir = identityPreflightResultCacheEntryDir(
        resultCacheDir,
        datasetType,
        datasetId,
        datasetVersion,
      );
      if (resultCacheEntryDir && reportFile && outputDir && !fileExists(reportFile)) {
        const cachedReport = path.join(resultCacheEntryDir, "identity-decision.json");
        let restoredReport = null;
        if (fileExists(cachedReport)) {
          try {
            // Best-effort restore. A racing/partial cache entry (a concurrent writer
            // mid-publish) must never crash the stage — fall through to a fresh search.
            fs.mkdirSync(outputDir, { recursive: true });
            fs.cpSync(resultCacheEntryDir, path.join(outputDir, "outputs"), { recursive: true });
            if (fileExists(reportFile)) {
              restoredReport = readJson(reportFile);
            }
          } catch {
            restoredReport = null;
          }
          if (!restoredReport) {
            // The cache entry was unusable (racing/partial/truncated JSON). Remove the
            // half-copied outputs so a stale, corrupt reportFile cannot poison the
            // onlyPending short-circuit below; fall through to a fresh search instead.
            try {
              fs.rmSync(path.join(outputDir, "outputs"), { recursive: true, force: true });
            } catch {
              /* best-effort cleanup */
            }
          }
        }
        if (restoredReport) {
          resultRows.push({
            selected_index: selectedIndex,
            dataset_type: datasetType,
            dataset_id: datasetId,
            dataset_version: datasetVersion,
            status: "restored_from_result_cache",
            cli_exit_code: null,
            report_status: restoredReport.status ?? null,
            decision: restoredReport.decision ?? null,
            request_file: repoRelativeMaybe(requestFile),
            output_dir: repoRelativeMaybe(outputDir),
            report_file: repoRelativeMaybe(reportFile),
            result_cache_entry: repoRelativeMaybe(resultCacheEntryDir),
          });
          return;
        }
      }

      if (onlyPending && reportFile && fileExists(reportFile)) {
        const existingReport = readJson(reportFile);
        resultRows.push({
          selected_index: selectedIndex,
          dataset_type: datasetType,
          dataset_id: datasetId,
          dataset_version: datasetVersion,
          status: "skipped_existing_report",
          cli_exit_code: null,
          report_status: existingReport.status ?? null,
          decision: existingReport.decision ?? null,
          request_file: repoRelativeMaybe(requestFile),
          output_dir: repoRelativeMaybe(outputDir),
          report_file: repoRelativeMaybe(reportFile),
        });
        return;
      }

      const cliArgs = [
        datasetType,
        "identity-preflight",
        "--input",
        requestFile,
        "--out-dir",
        outputDir,
        "--json",
        "--timeout-ms",
        String(timeoutMs),
      ];
      const baseRow = {
        selected_index: selectedIndex,
        dataset_type: datasetType,
        dataset_id: datasetId,
        dataset_version: datasetVersion,
        request_file: repoRelativeMaybe(requestFile),
        output_dir: repoRelativeMaybe(outputDir),
        report_file: repoRelativeMaybe(reportFile),
        command: [cli.command, ...cli.args, ...cliArgs].map(shellQuote).join(" "),
        executable: cli.command,
        cli_package: cli.package,
        cli_args: cliArgs,
        stdout_log: repoRelativePath(stdoutLog),
        stderr_log: repoRelativePath(stderrLog),
      };

      if (!datasetType || !["flow", "process"].includes(datasetType)) {
        resultRows.push({
          ...baseRow,
          status: "failed",
          failure_code: "identity_preflight_dataset_type_invalid",
          cli_exit_code: null,
          report_status: null,
          decision: null,
        });
        return;
      }
      if (!requestFile || !fileExists(requestFile)) {
        resultRows.push({
          ...baseRow,
          status: "failed",
          failure_code: "identity_preflight_request_missing",
          cli_exit_code: null,
          report_status: null,
          decision: null,
        });
        return;
      }
      if (!outputDir) {
        resultRows.push({
          ...baseRow,
          status: "failed",
          failure_code: "identity_preflight_output_dir_missing",
          cli_exit_code: null,
          report_status: null,
          decision: null,
        });
        return;
      }
      if (dryRun) {
        resultRows.push({
          ...baseRow,
          status: "planned",
          attempts: 0,
          cli_exit_code: null,
          report_status: null,
          decision: null,
        });
        return;
      }

      const attemptRows = [];
      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        const attemptSuffix = maxAttempts > 1 ? `.attempt-${attempt}` : "";
        const attemptStdoutLog =
          maxAttempts > 1
            ? path.join(logDir, `${logToken}${attemptSuffix}.stdout.json`)
            : stdoutLog;
        const attemptStderrLog =
          maxAttempts > 1 ? path.join(logDir, `${logToken}${attemptSuffix}.stderr.log`) : stderrLog;
        const spawnArgs = [...cli.args, ...cliArgs];
        const result = spawnSync(cli.command, spawnArgs, {
          cwd: repoRoot,
          env: process.env,
          encoding: "utf8",
          // Mega-scope flows return large preflight payloads on stdout; the 1MB
          // spawnSync default overflows with ENOBUFS. Cap below V8's max string length.
          maxBuffer: 512 * 1024 * 1024,
          timeout: spawnTimeoutMs,
          killSignal: "SIGTERM",
        });
        writeText(attemptStdoutLog, result.stdout || "");
        writeText(attemptStderrLog, result.stderr || "");
        const timedOut = result.error?.code === "ETIMEDOUT" || result.signal === "SIGTERM";
        if (result.error && !timedOut) throw result.error;
        const cliExitCode = typeof result.status === "number" ? result.status : 1;
        const stdoutReport = parseJsonMaybe(result.stdout);
        const diskReport = reportFile && fileExists(reportFile) ? readJson(reportFile) : null;
        const report = stdoutReport || diskReport;
        const attemptRow = timedOut
          ? {
              ...baseRow,
              attempt,
              attempts: attempt,
              stdout_log: repoRelativePath(attemptStdoutLog),
              stderr_log: repoRelativePath(attemptStderrLog),
              status: "failed",
              failure_code: "identity_preflight_timeout",
              cli_exit_code: null,
              report_status: report?.status ?? null,
              decision: report?.decision ?? null,
              confidence: report?.confidence ?? null,
              next_action: report?.next_action ?? null,
              blocker_count: ensureArray(report?.blockers).length,
              candidate_count: ensureArray(report?.candidates).length,
              candidate_source_count: ensureArray(report?.candidate_sources).length,
              signal: result.signal ?? null,
              timeout_ms: timeoutMs,
              spawn_timeout_ms: spawnTimeoutMs,
            }
          : {
              ...baseRow,
              attempt,
              attempts: attempt,
              stdout_log: repoRelativePath(attemptStdoutLog),
              stderr_log: repoRelativePath(attemptStderrLog),
              status: report ? "completed" : "failed",
              failure_code: report ? null : "identity_preflight_report_missing_or_non_json",
              cli_exit_code: cliExitCode,
              report_status: report?.status ?? null,
              decision: report?.decision ?? null,
              confidence: report?.confidence ?? null,
              next_action: report?.next_action ?? null,
              blocker_count: ensureArray(report?.blockers).length,
              candidate_count: ensureArray(report?.candidates).length,
              candidate_source_count: ensureArray(report?.candidate_sources).length,
            };
        attemptRows.push(attemptRow);
        if (!retriableIdentityPreflightFailure(attemptRow)) break;
      }
      const finalAttempt = attemptRows.at(-1);
      // Persist a freshly produced result into the run-level cache (keyed by flow
      // identity) so other scopes referencing the same flow restore it instead of re-searching.
      if (
        resultCacheEntryDir &&
        finalAttempt?.status === "completed" &&
        outputDir &&
        reportFile &&
        fileExists(reportFile) &&
        fileExists(path.join(outputDir, "outputs"))
      ) {
        try {
          fs.mkdirSync(path.dirname(resultCacheEntryDir), { recursive: true });
          // Publish atomically: copy into a process-unique temp dir on the same
          // filesystem, then rename into place. Parallel scope workers share this
          // cache dir and reference the same flows (high cross-scope overlap), so a
          // non-atomic rm+cp races — one worker's rmSync deletes a subtree another
          // is mid-copy on, throwing EINVAL and aborting the whole stage. rename is
          // atomic; if another worker already published this identity, keep theirs
          // (same flow identity => equivalent result). Cache writes are best-effort
          // and must never fail the import.
          const tmpDir = `${resultCacheEntryDir}.tmp-${process.pid}-${selectedIndex}`;
          fs.rmSync(tmpDir, { recursive: true, force: true });
          fs.cpSync(path.join(outputDir, "outputs"), tmpDir, { recursive: true });
          if (fileExists(resultCacheEntryDir)) {
            fs.rmSync(tmpDir, { recursive: true, force: true });
          } else {
            try {
              fs.renameSync(tmpDir, resultCacheEntryDir);
            } catch {
              fs.rmSync(tmpDir, { recursive: true, force: true });
            }
          }
        } catch {
          // Cache persistence is best-effort; never fail the import because of it.
        }
      }
      resultRows.push({
        ...finalAttempt,
        retry_attempts: attemptRows.map((attemptRow) => ({
          attempt: attemptRow.attempt,
          status: attemptRow.status,
          failure_code: attemptRow.failure_code ?? null,
          cli_exit_code: attemptRow.cli_exit_code,
          stdout_log: attemptRow.stdout_log,
          stderr_log: attemptRow.stderr_log,
        })),
      });
    });

    const failedRows = resultRows.filter((row) => row.status === "failed");
    const identityFindingRows = resultRows.filter((row) =>
      ["blocked", "needs_review"].includes(row.report_status),
    );
    const blockers = failedRows.map((row) => ({
      code: row.failure_code || "identity_preflight_run_failed",
      message: "Identity-preflight runner could not produce usable evidence for a selected row.",
      dataset_type: row.dataset_type || null,
      dataset_id: row.dataset_id || null,
      dataset_version: row.dataset_version || null,
      request_file: row.request_file || null,
      report_file: row.report_file || null,
      stdout_log: row.stdout_log || null,
      stderr_log: row.stderr_log || null,
    }));
    const status = dryRun
      ? "planned"
      : failedRows.length > 0
        ? "failed"
        : identityFindingRows.length > 0
          ? "completed_with_identity_findings"
          : "completed";
    const resultsPath = path.join(outDir, "identity-preflight-run-results.jsonl");
    const reportPath = path.join(outDir, "dataset-identity-preflight-run-report.json");
    writeJsonLines(resultsPath, resultRows);
    const report = {
      schema_version: 1,
      generated_at_utc: nowIso(),
      status,
      command: "dataset-identity-preflight-run",
      index_file: repoRelativePath(indexPath),
      ...identityPreflightRunStageContract,
      runtime_options: {
        timeout_ms: timeoutMs,
        spawn_timeout_ms: spawnTimeoutMs,
        max_attempts: maxAttempts,
        retry_failed:
          retryFailedPath && fileExists(retryFailedPath) ? repoRelativePath(retryFailedPath) : null,
        cli: {
          command: cli.display,
          executable: cli.command,
          args_prefix: cli.args,
          package: cli.package,
          source: cli.source,
        },
      },
      counts: {
        index_rows: rows.length,
        initially_selected_rows: initiallySelectedRows.length,
        retry_failed_input_rows: retryFailedKeys ? retryFailedKeys.size : 0,
        selected_rows: selectedRows.length,
        attempts: resultRows.reduce((total, row) => total + Number(row.attempts ?? 0), 0),
        planned: resultRows.filter((row) => row.status === "planned").length,
        completed: resultRows.filter((row) => row.status === "completed").length,
        skipped_existing_report: resultRows.filter(
          (row) => row.status === "skipped_existing_report",
        ).length,
        failed: failedRows.length,
        identity_blocked: resultRows.filter((row) => row.report_status === "blocked").length,
        identity_needs_review: resultRows.filter((row) => row.report_status === "needs_review")
          .length,
        cli_exit_nonzero: resultRows.filter(
          (row) => Number.isInteger(row.cli_exit_code) && row.cli_exit_code !== 0,
        ).length,
        blockers: blockers.length,
      },
      policy: {
        valid_identity_findings_are_not_tool_failures:
          "CLI identity-preflight status blocked/needs_review is retained as evidence for Foundry AI authoring and does not fail this batch runner.",
        curation_gate_usage:
          "Pass this same index to dataset-curation-gate with --identity-preflight-index so authoring packages include current and dependency identity-preflight context.",
      },
      files: {
        report: repoRelativePath(reportPath),
        results: repoRelativePath(resultsPath),
      },
      blockers,
      results: resultRows,
    };
    writeJson(reportPath, report);
    return report;
  }

  function identityPreflightIndexMergeKey(row) {
    const datasetType = asText(row?.dataset_type || row?.type);
    const datasetId = asText(row?.dataset_id || row?.entity_id || row?.id);
    const datasetVersion = asText(row?.dataset_version || row?.version) || "00.00.001";
    if (!datasetType || !datasetId || !datasetVersion) return null;
    return `${datasetType}::${datasetId}::${datasetVersion}`;
  }

  function runDatasetIdentityPreflightIndexMerge(options) {
    if (options.help) {
      return {
        schema_version: 1,
        status: "help",
        command: "dataset-identity-preflight-index-merge",
        purpose:
          "Merge refreshed current-scope identity-preflight request rows into an existing index while preserving dependency preflight evidence. This command is local-only and never writes the database.",
        usage: [
          "node scripts/foundry.mjs dataset-identity-preflight-index-merge --base-index <old identity-preflight-requests.jsonl> --update-index <fresh current identity-preflight-requests.jsonl> --out-dir <merge-dir>",
          "node scripts/foundry.mjs dataset-identity-preflight-index-merge --base-index ./identity-preflight-requests.jsonl --update-index ./fresh/identity-preflight-requests.jsonl",
        ],
        remote_write_mode: "read-only",
      };
    }
    const baseIndex = resolveRepoPath(options.baseIndex || options.base || options.index);
    if (!baseIndex || !fileExists(baseIndex)) {
      throw new Error(
        "--base-index is required and must point to identity-preflight-requests.jsonl.",
      );
    }
    const updateIndexes = normalizedList(
      options.updateIndex ||
        options.updateIndexes ||
        options.refreshIndex ||
        options.refreshIndexes,
    ).map(resolveRepoPath);
    if (updateIndexes.length === 0 || updateIndexes.some((file) => !fileExists(file))) {
      throw new Error("--update-index is required and every update index must be readable.");
    }
    const outDir = resolveRepoPath(
      options.outDir ||
        path.join(path.dirname(path.dirname(baseIndex)), "identity-preflight-index-merge"),
    );
    const outPath = resolveRepoPath(
      options.out || options.output || path.join(outDir, "identity-preflight-requests.jsonl"),
    );
    const reportPath = path.join(outDir, "dataset-identity-preflight-index-merge-report.json");
    const blockers = [];
    const mergedRows = [];
    const rowIndexByKey = new Map();
    const stats = {
      base_rows: 0,
      update_indexes: updateIndexes.length,
      update_rows: 0,
      replaced_rows: 0,
      added_rows: 0,
      duplicate_update_rows: 0,
    };

    const addRow = (row, sourceFile, sourceIndex, mode) => {
      const key = identityPreflightIndexMergeKey(row);
      if (!key) {
        blockers.push({
          code: "identity_preflight_index_row_key_missing",
          message:
            "Identity preflight index rows must include dataset_type, dataset_id, and dataset_version.",
          source_file: repoRelativeMaybe(sourceFile),
          source_index: sourceIndex,
          mode,
        });
        return;
      }
      const nextRow = {
        ...row,
        merge_source: mode,
        merge_source_file: repoRelativeMaybe(sourceFile),
      };
      if (!rowIndexByKey.has(key)) {
        rowIndexByKey.set(key, mergedRows.length);
        mergedRows.push(nextRow);
        if (mode === "update") stats.added_rows += 1;
        return;
      }
      const existingIndex = rowIndexByKey.get(key);
      if (mode === "base") {
        blockers.push({
          code: "identity_preflight_index_base_duplicate_key",
          message: "Base identity preflight index contains duplicate dataset identity rows.",
          key,
          source_file: repoRelativeMaybe(sourceFile),
          source_index: sourceIndex,
        });
        return;
      }
      if (mergedRows[existingIndex]?.merge_source === "update") {
        stats.duplicate_update_rows += 1;
      } else {
        stats.replaced_rows += 1;
      }
      mergedRows[existingIndex] = nextRow;
    };

    const baseRows = readJsonLines(baseIndex);
    stats.base_rows = baseRows.length;
    baseRows.forEach((row, index) => addRow(row, baseIndex, index, "base"));
    for (const updateIndex of updateIndexes) {
      const updateRows = readJsonLines(updateIndex);
      stats.update_rows += updateRows.length;
      updateRows.forEach((row, index) => addRow(row, updateIndex, index, "update"));
    }

    if (blockers.length === 0) writeJsonLines(outPath, mergedRows);
    const report = {
      schema_version: 1,
      generated_at_utc: nowIso(),
      status: blockers.length === 0 ? "ready" : "blocked",
      command: "dataset-identity-preflight-index-merge",
      remote_write_mode: "read-only",
      policy: {
        exact_rows_scope:
          "Updated rows replace base rows by dataset_type + dataset_id + dataset_version, preserving dependency preflight rows that were not refreshed.",
        post_patch_usage:
          "Use this after field patch apply plus current-scope identity-preflight refresh, then pass the merged index to dataset-curation-gate.",
      },
      inputs: {
        base_index: repoRelativePath(baseIndex),
        update_indexes: updateIndexes.map(repoRelativePath),
      },
      counts: {
        ...stats,
        output_rows: blockers.length === 0 ? mergedRows.length : 0,
        blockers: blockers.length,
      },
      files: {
        report: repoRelativePath(reportPath),
        merged_index: blockers.length === 0 ? repoRelativePath(outPath) : null,
      },
      blockers,
    };
    writeJson(reportPath, report);
    return report;
  }

  function runDatasetIdentityPreflightRequestsBuild(options) {
    if (options.help) {
      return {
        schema_version: 1,
        status: "help",
        command: "dataset-identity-preflight-requests-build",
        usage: [
          "node scripts/foundry.mjs dataset-identity-preflight-requests-build --type process --rows-file ./rows/processes.jsonl --out-dir ./.foundry/workspaces/task/identity-preflight-refresh",
          "node scripts/foundry.mjs dataset-identity-preflight-requests-build --type flow --rows-file ./rows/flows.jsonl --out-dir ./.foundry/workspaces/task/identity-preflight-refresh",
          "node scripts/foundry.mjs dataset-identity-preflight-requests-build --type process --rows-file ./rows/patched-processes.jsonl --source-index ./identity-preflight-requests/identity-preflight-requests.jsonl --out-dir ./identity-preflight-refresh",
        ],
        purpose:
          "Build a fresh CLI identity-preflight request index from the exact current process or flow rows file.",
        remote_write_mode: "read-only",
      };
    }

    const datasetType = asText(options.type || options.datasetType).toLowerCase();
    if (!["flow", "process"].includes(datasetType)) {
      throw new Error("--type must be flow or process.");
    }
    const rowsFile = resolveRepoPath(options.rowsFile || options.input || options.inputRows);
    if (!rowsFile || !fileExists(rowsFile)) {
      throw new Error("--rows-file must point to a readable process/flow rows file.");
    }
    const outDir = resolveRepoPath(
      options.outDir ||
        path.join(path.dirname(path.dirname(rowsFile)), "identity-preflight-refresh"),
    );
    const cliBin = resolveTiangongLcaCliCommandPrefix
      ? resolveTiangongLcaCliCommandPrefix()
      : [resolveTiangongLcaCliBin()];
    const rows = readRowsFile(rowsFile);
    const sourceIndexPaths = identityPreflightSourceIndexPaths(options);
    const sourceContext = loadIdentityPreflightSourceFileMap(sourceIndexPaths);
    const rowsByType = {
      flow: new Map(),
      process: new Map(),
    };
    const sourceByType = {
      flow: new Map(),
      process: new Map(),
    };
    const blockers = [];
    blockers.push(...sourceContext.blockers);
    let sourceContextMatches = 0;
    let sourceContextMissingMatches = 0;
    rows.forEach((row, index) => {
      const identity = datasetIdentity(row, datasetType);
      if (!identity.id || !identity.version) {
        blockers.push({
          code: "identity_preflight_request_identity_missing",
          row_index: index,
          dataset_type: datasetType,
          message:
            "Rows used to build identity-preflight requests must include common:UUID and common:dataSetVersion.",
        });
        return;
      }
      const key = `${identity.id}::${identity.version}`;
      const sourceIndexKey = `${datasetType}:${identity.id}:${identity.version}`;
      const inheritedSourceFile = sourceContext.sourceFilesByIdentity.get(sourceIndexKey) ?? null;
      if (sourceIndexPaths.length > 0) {
        if (inheritedSourceFile) {
          sourceByType[datasetType].set(key, inheritedSourceFile);
          sourceContextMatches += 1;
        } else {
          sourceContextMissingMatches += 1;
          blockers.push({
            code: "identity_preflight_source_context_match_missing",
            row_index: index,
            dataset_type: datasetType,
            dataset_id: identity.id,
            dataset_version: identity.version,
            message:
              "The supplied --source-index does not contain source_file context for this current row.",
          });
        }
      }
      const existing = rowsByType[datasetType].get(key);
      if (existing && jsonSha256(existing) !== jsonSha256(row)) {
        blockers.push({
          code: "identity_preflight_request_duplicate_payload_conflict",
          row_index: index,
          dataset_type: datasetType,
          dataset_id: identity.id,
          dataset_version: identity.version,
          message: "The rows file contains duplicate identity keys with different payloads.",
        });
        return;
      }
      rowsByType[datasetType].set(key, row);
    });

    const artifacts = buildIdentityPreflightArtifacts({
      rowsByType,
      sourceByType,
      outDir,
      cliBin,
    });
    const reportPath = path.join(outDir, "dataset-identity-preflight-requests-build-report.json");
    const report = {
      schema_version: 1,
      generated_at_utc: nowIso(),
      status: blockers.length > 0 ? "blocked" : "ready",
      command: "dataset-identity-preflight-requests-build",
      dataset_type: datasetType,
      rows_file: repoRelativePath(rowsFile),
      remote_write_mode: "read-only",
      policy: {
        exact_rows_scope:
          "Each request target is the exact row payload from rows_file, and each index row records target_sha256 so curation can reject stale preflight evidence.",
        edge_search_payload:
          "The generated request carries a compact fielded query plus supported filter/data_source/match parameters for flow_hybrid_search or process_hybrid_search.",
        source_context_refresh:
          "When --source-index is supplied, refreshed requests inherit the original source_file trace context for the same dataset identity so post-patch search queries do not lose source-package evidence.",
      },
      counts: {
        input_rows: rows.length,
        request_rows: artifacts.rows.length,
        source_index_files: sourceIndexPaths.length,
        source_index_rows: sourceContext.rowCount,
        source_context_matches: sourceContextMatches,
        source_context_missing_matches: sourceContextMissingMatches,
        blockers: blockers.length,
      },
      files: {
        report: repoRelativePath(reportPath),
        identity_preflight_requests: repoRelativePath(artifacts.indexPath),
        requests_root: repoRelativePath(artifacts.root),
        source_indexes: sourceIndexPaths.map(repoRelativePath),
      },
      blockers,
    };
    writeJson(reportPath, report);
    return report;
  }

  const identityPreflightQueryNoisePatterns = [
    {
      code: "not_specified_source_phrase",
      pattern: /\bNot specified by the .* source\.?\b/iu,
    },
    {
      code: "ilcd_format_noise",
      pattern: /\bILCD format\b/iu,
    },
    {
      code: "generic_not_specified",
      pattern: /(?:^|[:;\n]\s*)Not specified(?:[.;\n]|$)/iu,
    },
    {
      code: "ecospold_location_in_name",
      pattern: /\{[A-Z][A-Z0-9_-]{1,12}\}/u,
    },
    {
      code: "leading_xx_name_placeholder",
      pattern: /(?:^|\n)(?:process|flow) name:\s*x{2,}\b/iu,
    },
  ];

  function identityPreflightQueryForAudit(row) {
    return (
      asText(row?.remote_search?.edge_request?.body?.query) ||
      asText(row?.remote_search?.query) ||
      asText(row?.remote_candidate_search?.query) ||
      asText(row?.request?.remote_candidate_search?.query)
    );
  }

  function identityPreflightEdgeBodyForAudit(row) {
    const body = row?.remote_search?.edge_request?.body;
    if (body && typeof body === "object" && !Array.isArray(body)) return body;
    const request = row?.remote_candidate_search ?? row?.request?.remote_candidate_search;
    if (request && typeof request === "object" && !Array.isArray(request)) {
      return {
        query: request.query,
        ...(request.filter ? { filter: request.filter } : {}),
        ...(request.limit ? { match_count: request.limit, page_size: request.limit } : {}),
        ...(request.data_source ? { data_source: request.data_source } : {}),
        ...(request.match_threshold ? { match_threshold: request.match_threshold } : {}),
        ...(request.lexical_weight ? { lexical_weight: request.lexical_weight } : {}),
        ...(request.semantic_weight ? { semantic_weight: request.semantic_weight } : {}),
        ...(request.rrf_k ? { rrf_k: request.rrf_k } : {}),
      };
    }
    return {};
  }

  function identityPreflightRequestForAudit(indexPath, row) {
    const requestFile = resolveRepoPath(row?.request_file);
    if (!requestFile || !fileExists(requestFile)) return null;
    try {
      return readJson(requestFile);
    } catch (error) {
      throw new Error(
        `Could not read identity-preflight request file from ${repoRelativePath(indexPath)}: ${repoRelativePath(requestFile)}: ${error}`,
      );
    }
  }

  function hasQueryLabel(query, label) {
    return new RegExp(`(?:^|\\n)${label.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}:`, "iu").test(
      query,
    );
  }

  function flowTypeFromQuery(query) {
    const match = query.match(/(?:^|\n)flow type:\s*([^\n;]+)/iu);
    return asText(match?.[1]);
  }

  function identityPreflightRequiredQueryLabels(row, query) {
    const datasetType = asText(row?.dataset_type ?? row?.datasetType).toLowerCase();
    if (datasetType === "process") {
      return [
        "process name",
        "reference flow",
        "geography",
        "classification or sector",
        "exchange flow refs",
      ];
    }
    if (datasetType === "flow") {
      const labels = ["flow name", "flow type", "reference property", "category or compartment"];
      if (/^elementary flow$/iu.test(flowTypeFromQuery(query))) {
        labels.push("compartment aliases");
        if (row?.source_file) labels.push("source classification or compartment");
      } else {
        labels.push("geography or market");
      }
      return labels;
    }
    return ["query"];
  }

  function identityPreflightSearchEndpointForType(datasetType) {
    if (datasetType === "process") return "process_hybrid_search";
    if (datasetType === "flow") return "flow_hybrid_search";
    return null;
  }

  function auditIdentityPreflightQueryRow({ row, index, indexPath }) {
    const blockers = [];
    const warnings = [];
    const datasetType = asText(row?.dataset_type ?? row?.datasetType).toLowerCase();
    const datasetId = asText(row?.dataset_id ?? row?.datasetId ?? row?.id);
    const datasetVersion = asText(row?.dataset_version ?? row?.datasetVersion ?? row?.version);
    const request = identityPreflightRequestForAudit(indexPath, row);
    const mergedRow = request
      ? {
          ...row,
          request,
          remote_candidate_search: row?.remote_candidate_search ?? request.remote_candidate_search,
        }
      : row;
    const query = identityPreflightQueryForAudit(mergedRow);
    const edgeBody = identityPreflightEdgeBodyForAudit(mergedRow);
    const expectedEndpoint = identityPreflightSearchEndpointForType(datasetType);
    const actualEndpoint = asText(row?.remote_search?.edge_request?.endpoint);

    const base = {
      row_index: index,
      dataset_type: datasetType || null,
      dataset_id: datasetId || null,
      dataset_version: datasetVersion || null,
      request_file: row?.request_file ?? null,
    };
    if (!["flow", "process"].includes(datasetType)) {
      blockers.push({
        ...base,
        code: "identity_preflight_query_dataset_type_invalid",
        message: "Identity-preflight query audit only supports process and flow rows.",
      });
    }
    if (!query) {
      blockers.push({
        ...base,
        code: "identity_preflight_query_missing",
        message: "Identity-preflight row must send a non-empty query to hybrid search.",
      });
    }
    if (query.length > 1800) {
      blockers.push({
        ...base,
        code: "identity_preflight_query_too_long",
        query_length: query.length,
        message: "Hybrid search query must stay within the Foundry compact query limit.",
      });
    }
    if (expectedEndpoint && actualEndpoint && actualEndpoint !== expectedEndpoint) {
      blockers.push({
        ...base,
        code: "identity_preflight_query_endpoint_mismatch",
        expected_endpoint: expectedEndpoint,
        actual_endpoint: actualEndpoint,
        message: "Identity-preflight edge request endpoint does not match the dataset type.",
      });
    }
    for (const label of identityPreflightRequiredQueryLabels(row, query)) {
      if (label === "query") continue;
      if (!hasQueryLabel(query, label)) {
        blockers.push({
          ...base,
          code: "identity_preflight_query_required_label_missing",
          label,
          message: `Hybrid search query is missing required fielded label: ${label}.`,
        });
      }
    }
    for (const { code, pattern } of identityPreflightQueryNoisePatterns) {
      const match = query.match(pattern);
      if (match) {
        blockers.push({
          ...base,
          code: "identity_preflight_query_noise",
          noise_code: code,
          matched_text: match[0],
          message:
            "Hybrid search query contains placeholder or converted-format noise that should be repaired before remote candidate search.",
        });
      }
    }
    const edgeQuery = asText(edgeBody.query);
    if (query && edgeQuery && edgeQuery !== query) {
      blockers.push({
        ...base,
        code: "identity_preflight_query_edge_body_mismatch",
        message:
          "Index remote_search.query and edge_request.body.query differ; audit cannot prove what Edge receives.",
      });
    }
    if (datasetType === "flow") {
      const flowType = flowTypeFromQuery(query);
      const filterFlowType = asText(edgeBody?.filter?.flowType);
      if (flowType && !filterFlowType) {
        blockers.push({
          ...base,
          code: "identity_preflight_query_flow_type_filter_missing",
          flow_type: flowType,
          message:
            "Flow hybrid search should include a flowType filter matching the query flow type.",
        });
      } else if (flowType && filterFlowType && filterFlowType !== flowType) {
        blockers.push({
          ...base,
          code: "identity_preflight_query_flow_type_filter_mismatch",
          flow_type: flowType,
          filter_flow_type: filterFlowType,
          message: "Flow hybrid search flowType filter does not match the query flow type.",
        });
      }
    }
    if (!edgeBody.data_source) {
      warnings.push({
        ...base,
        code: "identity_preflight_query_data_source_missing",
        message: "Hybrid search data_source is not explicit; Edge will use its default.",
      });
    }
    if (!edgeBody.match_count || !edgeBody.page_size) {
      warnings.push({
        ...base,
        code: "identity_preflight_query_result_limit_missing",
        message: "Hybrid search match_count/page_size is not explicit; Edge will use its default.",
      });
    }
    return {
      ...base,
      status: blockers.length > 0 ? "blocked" : "passed",
      query_sha256: query ? sha256Text(query) : null,
      query_length: query.length,
      labels: query
        .split(/\n/u)
        .map((line) => line.match(/^([^:]+):/u)?.[1])
        .filter(Boolean),
      edge_request: {
        endpoint: actualEndpoint || expectedEndpoint,
        data_source: edgeBody.data_source ?? null,
        match_count: edgeBody.match_count ?? null,
        page_size: edgeBody.page_size ?? null,
        filter: edgeBody.filter ?? null,
      },
      blockers,
      warnings,
    };
  }

  function runDatasetIdentityPreflightQueryAudit(options) {
    if (options.help) {
      return {
        schema_version: 1,
        status: "help",
        command: "dataset-identity-preflight-query-audit",
        usage: [
          "node scripts/foundry.mjs dataset-identity-preflight-query-audit --index ./identity-preflight-requests/identity-preflight-requests.jsonl --out-dir ./identity-preflight-query-audit",
        ],
        purpose:
          "Audit generated process/flow identity-preflight hybrid-search queries before remote candidate search.",
        remote_write_mode: "read-only",
      };
    }
    const indexPath = resolveRepoPath(
      options.index ||
        options.identityPreflightIndex ||
        options.identityPreflightRequests ||
        options.identityPreflightRequestsIndex,
    );
    if (!indexPath || !fileExists(indexPath)) {
      throw new Error("--index must point to a readable identity-preflight index.");
    }
    const outDir = resolveRepoPath(
      options.outDir ||
        path.join(path.dirname(path.dirname(indexPath)), "identity-preflight-query-audit"),
    );
    const rows = readJsonLines(indexPath);
    const auditedRows = rows.map((row, index) =>
      auditIdentityPreflightQueryRow({ row, index, indexPath }),
    );
    const blockers = auditedRows.flatMap((row) => row.blockers);
    const warnings = auditedRows.flatMap((row) => row.warnings);
    const reportPath = path.join(outDir, "dataset-identity-preflight-query-audit-report.json");
    const rowsPath = path.join(outDir, "identity-preflight-query-audit.jsonl");
    writeJsonLines(rowsPath, auditedRows);
    const report = {
      schema_version: 1,
      generated_at_utc: nowIso(),
      status: blockers.length > 0 ? "blocked" : "passed",
      command: "dataset-identity-preflight-query-audit",
      index_file: repoRelativePath(indexPath),
      remote_write_mode: "read-only",
      policy: {
        edge_body_contract:
          "flow_hybrid_search/process_hybrid_search only parse query, filter/filter_condition, match options, and data_source; complete identity and source evidence must be present in query.",
        profile_hints_contract:
          "remote_candidate_search.profile_hints are retained for local CLI/AI identity decisions but are not sent in the Edge request body.",
        noise_policy:
          "Queries must not carry converted placeholder/source-format strings such as ILCD format, Not specified by the source, EcoSpold-style {GLO} name suffixes, or leading xx placeholders.",
      },
      counts: {
        rows: rows.length,
        passed_rows: auditedRows.filter((row) => row.status === "passed").length,
        blocked_rows: auditedRows.filter((row) => row.status === "blocked").length,
        process_rows: rows.filter(
          (row) => asText(row?.dataset_type ?? row?.datasetType).toLowerCase() === "process",
        ).length,
        flow_rows: rows.filter(
          (row) => asText(row?.dataset_type ?? row?.datasetType).toLowerCase() === "flow",
        ).length,
        blockers: blockers.length,
        warnings: warnings.length,
      },
      files: {
        report: repoRelativePath(reportPath),
        rows: repoRelativePath(rowsPath),
      },
      blockers,
      warnings,
    };
    writeJson(reportPath, report);
    return report;
  }

  return {
    identityPreflightRunIndexPath,
    identityPreflightRunReportFile,
    runDatasetIdentityPreflightIndexMerge,
    runDatasetIdentityPreflightQueryAudit,
    runDatasetIdentityPreflightRequestsBuild,
    runDatasetIdentityPreflightRun,
  };
}

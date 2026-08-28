import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import type { BlockedScopeReportInput, LibraryDecisionApply } from "./decision-apply.ts";
import type { JsonRecord } from "./entity-projection.ts";

interface SelectedScope extends JsonRecord {
  process_id: string;
  process_version: string;
  state: string;
  bundle_dir: unknown;
  rewritten_process_file: unknown;
  commit_command: string[];
  verify_command: string[];
}

export interface ScopeCommandSpawnOptions extends JsonRecord {
  cwd: string;
  env: NodeJS.ProcessEnv;
  encoding: "utf8";
}

export interface ScopeCommandSpawnResult {
  status: number | null;
  stdout: string | null;
  stderr: string | null;
  error?: Error;
}

export type ScopeCommandSpawn = (
  executable: string,
  argv: readonly string[],
  options: ScopeCommandSpawnOptions,
) => ScopeCommandSpawnResult;

interface ReadyProcessScopeRunnerDependencies {
  asText: (value: unknown) => string;
  ensureArray: <T>(value: T | readonly T[] | null | undefined) => T[];
  fileExists: (filePath: string | null | undefined) => boolean;
  nowIso: () => string;
  readJson: (filePath: string) => JsonRecord;
  readJsonLines: (filePath: string) => JsonRecord[];
  repoRelativeMaybe: (filePath: string | null | undefined) => string | null;
  repoRelativePath: (filePath: string) => string;
  writeJson: (filePath: string, value: unknown) => void;
  writeJsonLines: (filePath: string, rows: readonly unknown[]) => void;
  blockRow: LibraryDecisionApply["blockRow"];
  buildBlockedScopeReport: (input: BlockedScopeReportInput) => JsonRecord;
  spawnCommand?: ScopeCommandSpawn;
}

export interface ReadyProcessScopeRunInput {
  processBundlesDir: string;
  libraryResolutionPath: string;
  resolution: JsonRecord;
  scopeFile: string | null;
  outDir: string;
  parallel: number;
  commit: boolean;
  dryRun: boolean;
  commandCwd: string;
  commandEnvironment: NodeJS.ProcessEnv;
}

function isJsonRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function jsonRecord(value: unknown): JsonRecord {
  return isJsonRecord(value) ? value : {};
}

export function createReadyProcessScopeRunner({
  asText,
  ensureArray,
  fileExists,
  nowIso,
  readJson,
  readJsonLines,
  repoRelativeMaybe,
  repoRelativePath,
  writeJson,
  writeJsonLines,
  blockRow,
  buildBlockedScopeReport,
  spawnCommand = (executable, argv, options) => spawnSync(executable, [...argv], options),
}: ReadyProcessScopeRunnerDependencies) {
  function scopeRowsFromFile(scopeFile: string | null): JsonRecord[] {
    if (!scopeFile || !fileExists(scopeFile)) return [];
    if (scopeFile.toLowerCase().endsWith(".jsonl")) return readJsonLines(scopeFile);
    const value: unknown = readJson(scopeFile);
    if (Array.isArray(value)) return value;
    const record = jsonRecord(value);
    if (Array.isArray(record.rows)) return record.rows.map(jsonRecord);
    if (Array.isArray(record.scopes)) return record.scopes.map(jsonRecord);
    return [record];
  }

  function commandArrayFromScope(scope: JsonRecord, key: string): string[] {
    const value =
      scope[key] ||
      jsonRecord(scope.checkpoint)[key] ||
      jsonRecord(scope.handoff)[key] ||
      jsonRecord(scope.commit_handoff)[key];
    if (Array.isArray(value)) return value.map(String).filter(Boolean);
    return [];
  }

  function runScopeHandoffCommand(
    argv: string[],
    {
      cwd,
      logDir,
      token,
      stage,
      environment,
    }: {
      cwd: string;
      logDir: string;
      token: string;
      stage: string;
      environment: NodeJS.ProcessEnv;
    },
  ): JsonRecord | null {
    if (!Array.isArray(argv) || argv.length === 0) return null;
    const stdoutLog = path.join(logDir, `${token}.${stage}.stdout.log`);
    const stderrLog = path.join(logDir, `${token}.${stage}.stderr.log`);
    const result = spawnCommand(argv[0], argv.slice(1), {
      cwd,
      env: environment,
      encoding: "utf8",
    });
    fs.mkdirSync(logDir, { recursive: true });
    fs.writeFileSync(stdoutLog, result.stdout || "");
    fs.writeFileSync(stderrLog, result.stderr || "");
    const exitCode = typeof result.status === "number" ? result.status : 1;
    if (result.error) {
      return {
        stage,
        command: argv,
        exit_code: exitCode,
        error: String(result.error?.message || result.error),
        stdout_log: repoRelativePath(stdoutLog),
        stderr_log: repoRelativePath(stderrLog),
      };
    }
    return {
      stage,
      command: argv,
      exit_code: exitCode,
      stdout_log: repoRelativePath(stdoutLog),
      stderr_log: repoRelativePath(stderrLog),
    };
  }

  function run({
    processBundlesDir,
    libraryResolutionPath,
    resolution,
    scopeFile,
    outDir,
    parallel,
    commit,
    dryRun,
    commandCwd,
    commandEnvironment,
  }: ReadyProcessScopeRunInput): JsonRecord {
    const scopeRows = scopeRowsFromFile(scopeFile);
    const readyIds = new Set(ensureArray(resolution.ready_scope_ids).map(asText));
    const checkpoints: JsonRecord[] = [];
    const blocked: JsonRecord[] = [];
    const selectedScopes: SelectedScope[] = scopeRows.map((scope) => ({
      process_id: asText(scope.process_id || scope.id),
      process_version: asText(scope.process_version || scope.version) || "00.00.001",
      state: asText(scope.state || scope.closure_status || jsonRecord(scope.checkpoint).state),
      bundle_dir: scope.bundle_dir,
      rewritten_process_file:
        scope.rewritten_process_file || jsonRecord(scope.checkpoint).rewritten_process_file,
      commit_command: commandArrayFromScope(scope, "commit_command"),
      verify_command: commandArrayFromScope(scope, "verify_command"),
    }));
    const logDir = path.join(outDir, "logs");
    for (const scope of selectedScopes) {
      const isReady =
        readyIds.has(scope.process_id) || scope.state === "ready" || scope.state === "";
      if (!isReady) {
        const row = blockRow(
          scope,
          { dataset_type: "process", id: scope.process_id, version: scope.process_version },
          "scope_not_ready",
          "Only dependency-closed ready scopes can enter dry-run/write/verify queues.",
          "Resolve this scope in dataset-library-decisions-apply and rerun with the ready scope file.",
        );
        blocked.push(row);
        checkpoints.push({
          schema_version: 1,
          process_id: scope.process_id,
          process_version: scope.process_version,
          state: "blocked_deferred",
          reason: "scope_not_ready",
        });
        continue;
      }
      const commandStages: Array<JsonRecord | null> = [];
      let state = dryRun ? "dry_run_planned" : "commit_handoff_planned";
      if (commit && scope.commit_command.length > 0) {
        const token = `${scope.process_id}-${scope.process_version}`.replace(
          /[^A-Za-z0-9_.-]+/gu,
          "-",
        );
        const commitStage = runScopeHandoffCommand(scope.commit_command, {
          cwd: commandCwd,
          logDir,
          token,
          stage: "commit",
          environment: commandEnvironment,
        });
        commandStages.push(commitStage);
        if (commitStage?.exit_code === 0 && scope.verify_command.length > 0) {
          const verifyStage = runScopeHandoffCommand(scope.verify_command, {
            cwd: commandCwd,
            logDir,
            token,
            stage: "verify",
            environment: commandEnvironment,
          });
          commandStages.push(verifyStage);
          state = verifyStage?.exit_code === 0 ? "verified" : "verify_failed";
        } else {
          state = commitStage?.exit_code === 0 ? "committed" : "commit_failed";
        }
      }
      checkpoints.push({
        schema_version: 1,
        process_id: scope.process_id,
        process_version: scope.process_version,
        state,
        scope_lock: `process:${scope.process_id}:${scope.process_version}`,
        parallel,
        bundle_dir: scope.bundle_dir,
        rewritten_process_file: scope.rewritten_process_file,
        remote_write_mode: commit ? "commit_handoff_required" : "read-only",
        command_stages: commandStages.filter(Boolean),
      });
    }
    const checkpointPath = path.join(outDir, "scope-checkpoints.jsonl");
    const blockedPath = path.join(outDir, "blocked-scope-ledger.jsonl");
    const blockedReportPath = path.join(outDir, "blocked-scope-report.json");
    const reportPath = path.join(outDir, "dataset-process-scope-run-report.json");
    writeJsonLines(checkpointPath, checkpoints);
    writeJsonLines(blockedPath, blocked);
    const blockedReport = buildBlockedScopeReport({
      command: "dataset-process-scope-run",
      blockedRows: blocked,
      blockedLedgerPath: blockedPath,
      reportPath: blockedReportPath,
    });
    writeJson(blockedReportPath, blockedReport);
    const commandFailures = checkpoints.filter((row) =>
      ["commit_failed", "verify_failed"].includes(asText(row.state)),
    );
    const report = {
      schema_version: 1,
      generated_at_utc: nowIso(),
      status:
        commandFailures.length > 0
          ? "failed"
          : blocked.length > 0
            ? "completed_with_deferred_scopes"
            : "completed",
      command: "dataset-process-scope-run",
      process_bundles_dir: repoRelativePath(processBundlesDir),
      library_resolution: repoRelativePath(libraryResolutionPath),
      scope_file: repoRelativeMaybe(scopeFile),
      mode: commit ? "commit" : "dry-run",
      parallel,
      counts: {
        selected_scopes: selectedScopes.length,
        ready_scopes_planned: checkpoints.filter((row) =>
          ["dry_run_planned", "commit_handoff_planned"].includes(asText(row.state)),
        ).length,
        committed: checkpoints.filter((row) => row.state === "committed").length,
        verified: checkpoints.filter((row) => row.state === "verified").length,
        command_failures: commandFailures.length,
        blocked_scopes_deferred: blocked.length,
      },
      files: {
        report: repoRelativePath(reportPath),
        scope_checkpoints: repoRelativePath(checkpointPath),
        blocked_scope_ledger: repoRelativePath(blockedPath),
        blocked_scope_report: repoRelativePath(blockedReportPath),
      },
      policy: {
        ready_only_commit: true,
        blocked_scopes_do_not_enter_write_queue: true,
        process_scope_locking: true,
        commit_mode_requires_existing_finalize_mutation_handoff_verify_chain:
          "This command executes scope-provided commit/verify handoff commands only after the existing finalize/mutation-manifest/commit-handoff/post-write-verify chain has produced them. Without handoff commands, it creates scope-locked commit_handoff_planned checkpoints.",
      },
      blockers: commandFailures.map((row) => ({
        code: row.state,
        message: "Scope handoff command failed; inspect command stage logs.",
        process_id: row.process_id,
        process_version: row.process_version,
        command_stages: row.command_stages,
      })),
    };
    writeJson(reportPath, report);
    return report;
  }

  return { run };
}

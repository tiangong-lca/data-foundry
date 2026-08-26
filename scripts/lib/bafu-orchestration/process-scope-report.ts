import {
  curationGateBlockers,
  finalizeBlockers,
  type JsonRecord,
} from "./finalize-recovery-policy.ts";

export interface BafuProcessScopeFinalizeReportPaths {
  report: string | null;
  runLedger: string | null;
  finalizeReport: string | null;
  sourceSupportRowsFile: string | null;
  sourceRowsFile: string | null;
}

export interface BafuProcessScopeFinalizeReportInput {
  generatedAtUtc: string;
  processScope: JsonRecord;
  mode: string;
  finalizeReport: JsonRecord;
  gateReport: JsonRecord | null;
  finalizeCommand: string;
  rerunCommand: string;
  paths: BafuProcessScopeFinalizeReportPaths;
}

export interface BafuProcessScopeReportPolicy extends JsonRecord {
  remote_commit_executed: boolean;
}

export interface BafuProcessScopeReportCounts extends JsonRecord {
  blockers: number;
}

export interface BafuProcessScopeReportResume extends JsonRecord {
  rerun_command: string;
  reused_existing_finalize_report: boolean;
}

export interface BafuProcessScopeFinalizeReport extends JsonRecord {
  generated_at_utc: string;
  status: string;
  policy: BafuProcessScopeReportPolicy;
  counts: BafuProcessScopeReportCounts;
  blockers: JsonRecord[];
  files: JsonRecord;
  resume: BafuProcessScopeReportResume;
  handoff_stages?: JsonRecord[];
}

export interface BafuProcessScopeHandoffSummaryInput {
  report: BafuProcessScopeFinalizeReport;
  stages: JsonRecord[];
  blockers: JsonRecord[];
  supportCommitted: boolean;
  supportReused: boolean;
}

export interface CompactCommandStageResult {
  status: number | null;
  signal?: string | null;
  error?: Error;
}

export interface CompactCommandStageInput {
  stage: string;
  command: unknown;
  result: CompactCommandStageResult;
  stdoutLog: string | null;
  stderrLog: string | null;
  report: string | null;
  attempt?: number;
  maxAttempts?: number;
  retryReason?: string;
  retryNextDelayMs?: number;
}

export interface CompactCommandStage extends JsonRecord {
  stage: string;
  command: unknown;
  exit_code: number;
  signal: string | null;
  error: string | null;
  stdout_log: string | null;
  stderr_log: string | null;
  report: string | null;
  attempt?: number;
  max_attempts?: number;
  retry_reason?: string;
  retry_next_delay_ms?: number;
}

function isJsonRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function jsonRecord(value: unknown): JsonRecord {
  return isJsonRecord(value) ? value : {};
}

export function projectBafuProcessScopeFinalizeReport({
  generatedAtUtc,
  processScope,
  mode,
  finalizeReport,
  gateReport,
  finalizeCommand,
  rerunCommand,
  paths,
}: BafuProcessScopeFinalizeReportInput): BafuProcessScopeFinalizeReport {
  const { gateReport: resolvedGateReport, blockers: gateBlockers } = curationGateBlockers({
    finalizeReport,
    gateReport,
  });
  const blockers = [...gateBlockers, ...finalizeBlockers(finalizeReport)];
  const gateCounts = jsonRecord(resolvedGateReport?.counts);
  const finalizeCounts = jsonRecord(finalizeReport.counts);
  const commitHandoff = jsonRecord(finalizeReport.commit_handoff);
  const finalizeFiles = jsonRecord(finalizeReport.files);
  const unresolvedAi = gateBlockers.some(
    (blocker) => blocker.code === "unresolved_ai_curation_items",
  );
  const status =
    blockers.length === 0
      ? "ready_for_explicit_commit"
      : unresolvedAi
        ? "blocked_unresolved_ai_curation"
        : "blocked";

  return {
    schema_version: 1,
    generated_at_utc: generatedAtUtc,
    command: "dataset-bafu-process-scope-e2e",
    status,
    mode,
    profile: "bafu",
    process_scope: processScope,
    policy: {
      uses_existing_foundry_commands: true,
      existing_command: "dataset-post-authoring-finalize",
      remote_commit_executed: false,
      remote_commit_boundary:
        "This helper executes emitted commit handoff commands only when --commit is explicit and finalize is ready; otherwise it is read-only.",
      unresolved_ai_curation_items_hard_block: true,
      one_process_scope_only: true,
    },
    counts: {
      blockers: blockers.length,
      ai_action_items: Number(gateCounts.action_items ?? 0),
      deterministic_cleanup_items: Number(gateCounts.deterministic_cleanup_items ?? 0),
      finalize_blockers: Number(finalizeCounts.blockers ?? 0),
      commit_handoff_blockers: Number(finalizeCounts.commit_handoff_blockers ?? 0),
    },
    blockers,
    commands: {
      post_authoring_finalize: finalizeCommand,
      commit_handoff: commitHandoff.command ?? null,
      post_write_verify: commitHandoff.post_write_verify_command ?? null,
    },
    inputs: {
      source_support_rows_file: paths.sourceSupportRowsFile,
      source_rows_file: paths.sourceRowsFile,
    },
    files: {
      report: paths.report,
      run_ledger: paths.runLedger,
      finalize_report: paths.finalizeReport,
      curation_gate_report: finalizeFiles.curation_gate_report ?? null,
      mutation_manifest: finalizeFiles.mutation_manifest ?? null,
      commit_handoff_plan: finalizeFiles.commit_handoff_plan ?? null,
      import_ledger: finalizeFiles.import_ledger ?? null,
    },
    resume: {
      rerun_command: rerunCommand,
      reused_existing_finalize_report: mode === "resume",
    },
  };
}

export function applyBafuProcessScopeHandoffSummary({
  report,
  stages,
  blockers: handoffBlockers,
  supportCommitted,
  supportReused,
}: BafuProcessScopeHandoffSummaryInput): BafuProcessScopeFinalizeReport {
  if (stages.length === 0 && handoffBlockers.length === 0) return report;
  const blockers = [...handoffBlockers, ...report.blockers];
  return {
    ...report,
    handoff_stages: stages,
    support_handoff: {
      requested: true,
      completed: supportCommitted,
      reused_verified_identities: supportReused,
    },
    blockers,
    counts: {
      ...report.counts,
      blockers: blockers.length,
    },
    status: handoffBlockers.length > 0 ? "failed" : report.status,
  };
}

export function compactCommandStage({
  stage,
  command,
  result,
  stdoutLog,
  stderrLog,
  report,
  attempt,
  maxAttempts,
  retryReason,
  retryNextDelayMs,
}: CompactCommandStageInput): CompactCommandStage {
  const compact: CompactCommandStage = {
    stage,
    command,
    exit_code: typeof result.status === "number" ? result.status : 1,
    signal: result.signal ?? null,
    error: result.error ? String(result.error.message || result.error) : null,
    stdout_log: stdoutLog,
    stderr_log: stderrLog,
    report,
  };
  if (attempt !== undefined) compact.attempt = attempt;
  if (maxAttempts !== undefined) compact.max_attempts = maxAttempts;
  if (retryReason !== undefined) compact.retry_reason = retryReason;
  if (retryNextDelayMs !== undefined) compact.retry_next_delay_ms = retryNextDelayMs;
  return compact;
}

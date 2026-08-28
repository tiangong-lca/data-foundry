import type { FoundryArtifactFact, FoundryCommandSpec } from "../foundry-command-spec.ts";
import {
  summarizeSameIdentityCommitFailures,
  type SameIdentityCommitFailureSummary,
} from "../same-identity-commit-recovery.ts";

export interface BatchPostWriteHandoffJsonRecord {
  [key: string]: unknown;
}

export interface BatchPostWriteHandoffStageResult extends BatchPostWriteHandoffJsonRecord {
  stage: string;
  exit_code: number;
}

export type BatchPostWriteAcceptedDiffResult =
  | { accepted: false; [key: string]: unknown }
  | {
      accepted: true;
      verifyReportPath: string;
      acceptanceReportPath: string;
      evidence: BatchPostWriteHandoffJsonRecord[];
    };

export interface BatchPostWriteHandoffAdapter {
  processExecutable: string;
  foundryEntryPath: string;
  repoRoot: string;
  environment: NodeJS.ProcessEnv;
  resolveRepoPath: (value: unknown) => string | null;
  repoRelative: (filePath: string | null | undefined) => string | null;
  fileExists: (filePath: string | null | undefined) => boolean;
  readJson: (filePath: string) => BatchPostWriteHandoffJsonRecord;
  findFiles: (rootDir: unknown, predicate: (filePath: string) => boolean) => string[];
  joinPath: (...parts: string[]) => string;
  basename: (filePath: string) => string;
  asText: (value: unknown) => string;
  integerOption: (value: unknown, fallback?: number | null) => number | null;
  assertReceiptBoundHandoffAccount: (
    handoffPlan: BatchPostWriteHandoffJsonRecord,
    environment: NodeJS.ProcessEnv,
  ) => void;
  assertCommandSpecBindsArtifact: (
    value: unknown,
    requiredArtifact: FoundryArtifactFact,
  ) => FoundryCommandSpec;
  assertCommandSpecArtifactsCurrent: (commandSpec: FoundryCommandSpec) => FoundryCommandSpec;
  runStage: (input: {
    stage: string;
    command: string[];
    logDir: string;
  }) => Promise<BatchPostWriteHandoffStageResult>;
  sleep: (delayMs: number) => Promise<void>;
  traceHashNormalizationAllowed: (handoffPlan: BatchPostWriteHandoffJsonRecord) => boolean;
  acceptTraceHashOnlyRemoteVerificationMismatch: (input: {
    verifyReportPath: string;
    outDir: string;
    repoRoot: string;
  }) => BatchPostWriteAcceptedDiffResult;
}

export interface BatchPostWriteHandoffInput {
  handoffPlanPath: string;
  ledgerDir: string;
  outDir: string;
  logDir: string;
  label: string;
}

export interface BatchPostWriteHandoffResult extends BatchPostWriteHandoffJsonRecord {
  status: string;
  blockers: BatchPostWriteHandoffJsonRecord[];
  stages: BatchPostWriteHandoffJsonRecord[];
  handoffPlan?: BatchPostWriteHandoffJsonRecord;
  closeoutReport?: BatchPostWriteHandoffJsonRecord | null;
  commitReportPath?: string | null;
  verifyReportPath?: string | null;
  closeoutReportPath?: string | null;
}

export type BatchPostWriteCommitFailureSummary = SameIdentityCommitFailureSummary;

export interface BatchPostWriteHandoffService {
  execute: (input: BatchPostWriteHandoffInput) => Promise<BatchPostWriteHandoffResult>;
  commitFailuresAllAlreadyExist: (
    handoffPlan: BatchPostWriteHandoffJsonRecord,
  ) => BatchPostWriteCommitFailureSummary;
  postWriteVerifyRetryReason: (verifyReportPath: string | null) => string | null;
}

function isJsonRecord(value: unknown): value is BatchPostWriteHandoffJsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function jsonRecord(value: unknown): BatchPostWriteHandoffJsonRecord {
  return isJsonRecord(value) ? value : {};
}

const postWriteVerifyRetryableCodes = [
  "lookup_failed",
  "remote_lookup_failed",
  "readback_failed",
  "remote_readback_failed",
  "remote_readback_missing",
  "root_readback_incomplete",
  "post_write_verify_root_readback_incomplete",
  "verify_report_missing",
] as const;

function collectReportCodes(
  value: unknown,
  adapter: BatchPostWriteHandoffAdapter,
  codes: Set<string> = new Set(),
  depth = 0,
): Set<string> {
  if (value == null || depth > 6) return codes;
  if (Array.isArray(value)) {
    for (const entry of value) collectReportCodes(entry, adapter, codes, depth + 1);
    return codes;
  }
  if (!isJsonRecord(value)) return codes;
  for (const key of ["code", "failure_code", "status_code", "readback_status"]) {
    const text = adapter.asText(value[key]);
    if (text) codes.add(text);
  }
  for (const key of ["blockers", "findings", "checks", "results", "rows", "items"]) {
    collectReportCodes(value[key], adapter, codes, depth + 1);
  }
  return codes;
}

function firstExistingPath(
  candidates: unknown[],
  adapter: BatchPostWriteHandoffAdapter,
): string | null {
  return candidates.map(adapter.resolveRepoPath).find(adapter.fileExists) ?? null;
}

function findReportFile(
  rootDir: unknown,
  predicate: (filePath: string) => boolean,
  adapter: BatchPostWriteHandoffAdapter,
): string | null {
  return adapter.findFiles(rootDir, predicate)[0] ?? null;
}

function commitReportForHandoffPlan(
  handoffPlan: BatchPostWriteHandoffJsonRecord,
  adapter: BatchPostWriteHandoffAdapter,
): string | null {
  const expectedDir = adapter.resolveRepoPath(
    jsonRecord(handoffPlan.files).expected_commit_report_dir,
  );
  return (
    firstExistingPath(
      [
        adapter.joinPath(
          expectedDir || "",
          "process-save-draft",
          "outputs",
          "save-draft-rpc",
          "summary.json",
        ),
        adapter.joinPath(
          expectedDir || "",
          "support-save-draft",
          "outputs",
          "dataset-save-draft",
          "summary.json",
        ),
        adapter.joinPath(
          expectedDir || "",
          "contact-save-draft",
          "outputs",
          "dataset-save-draft",
          "summary.json",
        ),
        adapter.joinPath(
          expectedDir || "",
          "source-save-draft",
          "outputs",
          "dataset-save-draft",
          "summary.json",
        ),
        adapter.joinPath(expectedDir || "", "flow-publish-version", "outputs", "summary.json"),
      ],
      adapter,
    ) ??
    findReportFile(
      expectedDir,
      (filePath) => /(?:summary|sync_report)\.json$/u.test(adapter.basename(filePath)),
      adapter,
    )
  );
}

function verifyReportForHandoffPlan(
  handoffPlan: BatchPostWriteHandoffJsonRecord,
  adapter: BatchPostWriteHandoffAdapter,
): string | null {
  const expectedDir = adapter.resolveRepoPath(
    jsonRecord(handoffPlan.files).expected_post_write_verify_dir,
  );
  return (
    firstExistingPath(
      [adapter.joinPath(expectedDir || "", "outputs", "remote-verification-report.json")],
      adapter,
    ) ??
    findReportFile(
      expectedDir,
      (filePath) => adapter.basename(filePath) === "remote-verification-report.json",
      adapter,
    )
  );
}

export function createBatchPostWriteHandoffService(
  adapter: BatchPostWriteHandoffAdapter,
): BatchPostWriteHandoffService {
  function retryAttempts(): number {
    const parsed = adapter.integerOption(adapter.environment.BAFU_POST_WRITE_VERIFY_ATTEMPTS, 3);
    return Math.max(1, Math.min(8, parsed || 3));
  }

  function retryDelayMs(attemptIndex: number): number {
    const base = adapter.integerOption(
      adapter.environment.BAFU_POST_WRITE_VERIFY_RETRY_DELAY_MS,
      2_000,
    );
    return Math.max(0, Math.min(60_000, (base || 2_000) * 2 ** attemptIndex));
  }

  function postWriteVerifyRetryReason(verifyReportPath: string | null): string | null {
    if (!verifyReportPath || !adapter.fileExists(verifyReportPath)) {
      return "verify_report_missing";
    }
    const report = adapter.readJson(verifyReportPath);
    const codes = collectReportCodes(report, adapter);
    for (const code of codes) {
      if (
        postWriteVerifyRetryableCodes.includes(
          code as (typeof postWriteVerifyRetryableCodes)[number],
        )
      ) {
        return code;
      }
    }
    const counts = jsonRecord(report.counts);
    const byStatus = jsonRecord(counts.by_status || counts.statuses);
    for (const code of postWriteVerifyRetryableCodes) {
      if (Number(byStatus[code] ?? 0) > 0) return code;
    }
    return null;
  }

  function commitFailuresAllAlreadyExist(
    handoffPlan: BatchPostWriteHandoffJsonRecord,
  ): BatchPostWriteCommitFailureSummary {
    const expectedDir = adapter.resolveRepoPath(
      jsonRecord(handoffPlan.files).expected_commit_report_dir,
    );
    if (!expectedDir) return { accepted: false, alreadyExists: 0, otherFailures: 0 };
    const summaries = adapter.findFiles(expectedDir, (filePath) =>
      /(?:summary|sync_report)\.json$/u.test(adapter.basename(filePath)),
    );
    const reports: BatchPostWriteHandoffJsonRecord[] = [];
    for (const summaryPath of summaries) {
      try {
        reports.push(adapter.readJson(summaryPath));
      } catch {
        continue;
      }
    }
    return summarizeSameIdentityCommitFailures(reports);
  }

  async function runCommandSpecStage(
    stage: string,
    commandSpec: FoundryCommandSpec,
    logDir: string,
  ): Promise<BatchPostWriteHandoffStageResult> {
    const spec = adapter.assertCommandSpecArtifactsCurrent(commandSpec);
    return adapter.runStage({
      stage,
      logDir,
      command: [spec.executable, ...spec.argv],
    });
  }

  async function execute({
    handoffPlanPath,
    ledgerDir,
    outDir,
    logDir,
    label,
  }: BatchPostWriteHandoffInput): Promise<BatchPostWriteHandoffResult> {
    if (!adapter.fileExists(handoffPlanPath)) {
      return {
        status: "blocked",
        blockers: [{ code: "handoff_plan_missing", message: `${label} handoff plan is missing.` }],
        stages: [],
      };
    }
    const handoffPlan = adapter.readJson(handoffPlanPath);
    const blockers: BatchPostWriteHandoffJsonRecord[] = [];
    const stages: BatchPostWriteHandoffJsonRecord[] = [];
    if (handoffPlan.status !== "ready_for_explicit_commit") {
      return {
        status: "blocked",
        blockers: [
          {
            code: "handoff_plan_not_ready",
            message: `${label} handoff plan status is ${handoffPlan.status || "missing"}.`,
            handoff_plan: adapter.repoRelative(handoffPlanPath),
          },
        ],
        stages,
        handoffPlan,
      };
    }
    try {
      adapter.assertReceiptBoundHandoffAccount(handoffPlan, adapter.environment);
    } catch (error) {
      return {
        status: "blocked",
        blockers: [
          {
            code: "handoff_account_evidence_mismatch",
            message: String(error instanceof Error ? error.message : error),
            handoff_plan: adapter.repoRelative(handoffPlanPath),
          },
        ],
        stages,
        handoffPlan,
      };
    }

    let commitSpec: FoundryCommandSpec;
    let verifySpec: FoundryCommandSpec;
    try {
      const commands = jsonRecord(handoffPlan.commands);
      const artifact = jsonRecord(handoffPlan.final_rows_artifact);
      const requiredFinalRowsArtifact: FoundryArtifactFact = {
        role: "final_rows",
        path: adapter.asText(artifact.path),
        bytes: Number(artifact.bytes),
        sha256: adapter.asText(artifact.sha256),
      };
      commitSpec = adapter.assertCommandSpecBindsArtifact(
        commands.commit,
        requiredFinalRowsArtifact,
      );
      verifySpec = adapter.assertCommandSpecBindsArtifact(
        commands.post_write_verify,
        requiredFinalRowsArtifact,
      );
    } catch (error) {
      return {
        status: "blocked",
        blockers: [
          {
            code: "handoff_command_spec_invalid",
            message: `${label} handoff plan must include valid authoritative commit and post_write_verify CommandSpecs: ${String(error instanceof Error ? error.message : error)}`,
            handoff_plan: adapter.repoRelative(handoffPlanPath),
          },
        ],
        stages,
        handoffPlan,
      };
    }

    let commitStage: BatchPostWriteHandoffStageResult;
    try {
      commitStage = await runCommandSpecStage(`${label}.commit`, commitSpec, logDir);
    } catch (error) {
      blockers.push({
        code: "commit_handoff_artifact_binding_failed",
        message: `${label} commit CommandSpec artifact binding failed before spawn: ${String(error instanceof Error ? error.message : error)}`,
        handoff_plan: adapter.repoRelative(handoffPlanPath),
      });
      return { status: "failed", blockers, stages, handoffPlan };
    }
    const commitReportPath = commitReportForHandoffPlan(handoffPlan, adapter);
    stages.push({ ...commitStage, report: adapter.repoRelative(commitReportPath) });
    if (commitStage.exit_code !== 0 || !commitReportPath) {
      const idempotent = commitReportPath ? commitFailuresAllAlreadyExist(handoffPlan) : null;
      if (!idempotent?.accepted) {
        blockers.push({
          code: "commit_handoff_command_failed",
          message: `${label} commit handoff failed or did not emit the expected commit report.`,
          handoff_plan: adapter.repoRelative(handoffPlanPath),
          exit_code: commitStage.exit_code,
          commit_report: adapter.repoRelative(commitReportPath),
        });
        return { status: "failed", blockers, stages, handoffPlan };
      }
      stages.push({
        stage: `${label}.commit.accepted_existing_support`,
        status: "accepted",
        report: adapter.repoRelative(commitReportPath),
        reused_existing_rows: idempotent.alreadyExists,
        message: `${label} commit reused ${idempotent.alreadyExists} support row(s) that already exist with the same id and version; references resolve to the present datasets and are confirmed by post-write verification.`,
      });
    }

    let verifyReportPath: string | null = null;
    let verifyAccepted = false;
    let verifyExitCode = 1;
    let verifyAttempts = 0;
    let verifyRetryReason: string | null = null;
    const maxVerifyAttempts = retryAttempts();
    for (let attempt = 1; attempt <= maxVerifyAttempts; attempt += 1) {
      const verifyStageName =
        attempt === 1
          ? `${label}.post_write_verify`
          : `${label}.post_write_verify.retry_${attempt}`;
      let verifyStage: BatchPostWriteHandoffStageResult;
      try {
        verifyStage = await runCommandSpecStage(verifyStageName, verifySpec, logDir);
      } catch (error) {
        blockers.push({
          code: "post_write_verify_artifact_binding_failed",
          message: `${label} verify CommandSpec artifact binding failed before spawn: ${String(error instanceof Error ? error.message : error)}`,
          handoff_plan: adapter.repoRelative(handoffPlanPath),
        });
        return { status: "failed", blockers, stages, handoffPlan };
      }
      verifyReportPath = verifyReportForHandoffPlan(handoffPlan, adapter);
      verifyExitCode = verifyStage.exit_code;
      verifyAttempts = attempt;
      const stageRecord: BatchPostWriteHandoffStageResult = {
        ...verifyStage,
        report: adapter.repoRelative(verifyReportPath),
        attempt,
        max_attempts: maxVerifyAttempts,
      };
      stages.push(stageRecord);
      verifyAccepted = verifyStage.exit_code === 0 && Boolean(verifyReportPath);
      if (
        verifyStage.exit_code !== 0 &&
        verifyReportPath &&
        adapter.traceHashNormalizationAllowed(handoffPlan)
      ) {
        const acceptedVerify = adapter.acceptTraceHashOnlyRemoteVerificationMismatch({
          verifyReportPath,
          outDir,
          repoRoot: adapter.repoRoot,
        });
        if (acceptedVerify.accepted) {
          verifyReportPath = acceptedVerify.verifyReportPath;
          verifyAccepted = true;
          stages.push({
            stage: `${label}.post_write_verify.accepted_diff`,
            status: "accepted",
            report: adapter.repoRelative(acceptedVerify.acceptanceReportPath),
            accepted_differences: acceptedVerify.evidence.length,
          });
        }
      }
      if (verifyAccepted) break;
      verifyRetryReason = postWriteVerifyRetryReason(verifyReportPath);
      if (!verifyRetryReason || attempt >= maxVerifyAttempts) break;
      const delayMs = retryDelayMs(attempt - 1);
      stageRecord.retry_reason = verifyRetryReason;
      stageRecord.retry_next_delay_ms = delayMs;
      await adapter.sleep(delayMs);
    }
    if (!verifyAccepted || !verifyReportPath) {
      blockers.push({
        code: "post_write_verify_command_failed",
        message: `${label} post-write verification failed or did not emit the expected remote verification report.`,
        handoff_plan: adapter.repoRelative(handoffPlanPath),
        exit_code: verifyExitCode,
        post_write_verify_report: adapter.repoRelative(verifyReportPath),
        post_write_verify_attempts: verifyAttempts,
        retry_reason: verifyRetryReason,
      });
      return { status: "failed", blockers, stages, handoffPlan };
    }

    const closeoutDir = adapter.joinPath(outDir, "closeout");
    const closeoutArgv = [
      adapter.processExecutable,
      adapter.foundryEntryPath,
      "dataset-post-write-closeout",
      "--handoff-plan",
      adapter.repoRelative(handoffPlanPath) || "",
      "--commit-report",
      adapter.repoRelative(commitReportPath) || "",
      "--post-write-verify-report",
      adapter.repoRelative(verifyReportPath) || "",
      "--out-dir",
      adapter.repoRelative(closeoutDir) || "",
      "--ledger-dir",
      adapter.repoRelative(ledgerDir) || "",
    ];
    const closeoutStage = await adapter.runStage({
      stage: `${label}.closeout`,
      command: closeoutArgv,
      logDir,
    });
    const closeoutReportPath = adapter.joinPath(
      closeoutDir,
      "dataset-post-write-closeout-report.json",
    );
    const closeoutReport = adapter.fileExists(closeoutReportPath)
      ? adapter.readJson(closeoutReportPath)
      : null;
    stages.push({ ...closeoutStage, report: adapter.repoRelative(closeoutReportPath) });
    if (closeoutStage.exit_code !== 0 || closeoutReport?.status !== "completed") {
      blockers.push({
        code: "post_write_closeout_failed",
        message: `${label} post-write closeout status is ${closeoutReport?.status || "missing"}.`,
        handoff_plan: adapter.repoRelative(handoffPlanPath),
        closeout_report: adapter.repoRelative(closeoutReportPath),
        closeout_blockers: closeoutReport?.blockers ?? [],
      });
      return { status: "failed", blockers, stages, handoffPlan, closeoutReport };
    }

    return {
      status: "completed",
      blockers,
      stages,
      handoffPlan,
      closeoutReport,
      commitReportPath,
      verifyReportPath,
      closeoutReportPath,
    };
  }

  return { execute, commitFailuresAllAlreadyExist, postWriteVerifyRetryReason };
}

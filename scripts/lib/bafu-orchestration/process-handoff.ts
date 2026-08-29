import type { FoundryArtifactFact, FoundryCommandSpec } from "../foundry-command-spec.ts";
import { summarizeSameIdentityCommitFailures } from "../same-identity-commit-recovery.ts";
import { closeoutCommand } from "./process-handoff-closeout.ts";

export interface JsonRecord {
  [key: string]: unknown;
}

export interface ProcessHandoffCommandResult {
  status: number | null;
  signal?: string | null;
  error?: Error;
  stdout?: string | Uint8Array | null;
  stderr?: string | Uint8Array | null;
}

export interface ProcessHandoffCommandSpecStageInput {
  stage: string;
  commandSpec: FoundryCommandSpec;
  cwd: string;
  logDir: string;
}

export interface ProcessHandoffArgvStageInput {
  stage: string;
  argv: string[];
  logDir: string;
}

export interface ProcessHandoffStageRunResult {
  result: ProcessHandoffCommandResult;
  stdoutLog: string;
  stderrLog: string;
}

export interface ProcessHandoffStageProjectionInput {
  stage: string;
  command: unknown;
  result: ProcessHandoffCommandResult;
  stdoutLog: string;
  stderrLog: string;
  reportPath: string | null;
}

export type ProcessHandoffAcceptedDiffResult =
  | {
      accepted: false;
      reason?: string;
      [key: string]: unknown;
    }
  | {
      accepted: true;
      verifyReportPath: string;
      acceptanceReportPath: string;
      evidence: JsonRecord[];
    };

export interface ProcessHandoffAcceptedDiffInput {
  verifyReportPath: string;
  outDir: string;
  repoRoot: string;
}

export interface ProcessHandoffAdapter {
  processExecutable: string;
  foundryEntryPath: string;
  repoRoot: string;
  environment: NodeJS.ProcessEnv;
  resolveRepoPath: (value: unknown) => string | null;
  repoRelative: (filePath: string | null | undefined) => string;
  fileExists: (filePath: string | null | undefined) => boolean;
  readJson: (filePath: string) => JsonRecord;
  textValue: (value: unknown) => string;
  joinPath: (...parts: string[]) => string;
  basename: (filePath: string) => string;
  listFilesRecursively: (rootDir: string | null) => string[];
  assertReceiptBoundHandoffAccount: (
    handoffPlan: JsonRecord,
    environment: NodeJS.ProcessEnv,
  ) => void;
  assertCommandSpecBindsArtifact: (
    value: unknown,
    requiredArtifact: FoundryArtifactFact,
  ) => FoundryCommandSpec;
  assertCommandSpecArtifactsCurrent: (commandSpec: FoundryCommandSpec) => void;
  runCommandSpecStage: (input: ProcessHandoffCommandSpecStageInput) => ProcessHandoffStageRunResult;
  runArgvStage: (input: ProcessHandoffArgvStageInput) => ProcessHandoffStageRunResult;
  projectCommandStage: (input: ProcessHandoffStageProjectionInput) => JsonRecord;
  commandString: (argv: string[]) => string;
  retryAttempts: () => number;
  retryDelayMs: (attemptIndex: number) => number;
  retryReason: (verifyReportPath: string | null) => string | null;
  sleep: (delayMs: number) => void;
  traceHashNormalizationAllowed: (handoffPlan: JsonRecord) => boolean;
  acceptTraceHashOnlyRemoteVerificationMismatch: (
    input: ProcessHandoffAcceptedDiffInput,
  ) => ProcessHandoffAcceptedDiffResult;
}

export interface ProcessHandoffInput {
  handoffPlanPath: string;
  ledgerDir: string;
  outDir: string;
  logDir: string;
  label: string;
}

export interface ProcessHandoffResult extends JsonRecord {
  status: string;
  blockers: JsonRecord[];
  stages: JsonRecord[];
  handoffPlan: JsonRecord;
  closeoutReport?: JsonRecord | null;
  commitReportPath?: string;
  verifyReportPath?: string;
  closeoutReportPath?: string;
}

function isJsonRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function jsonRecord(value: unknown): JsonRecord {
  return isJsonRecord(value) ? value : {};
}

function firstExistingPath(candidates: string[], adapter: ProcessHandoffAdapter): string | null {
  return (
    candidates
      .map(adapter.resolveRepoPath)
      .find((filePath): filePath is string => Boolean(filePath && adapter.fileExists(filePath))) ??
    null
  );
}

function findReportFile(
  rootDir: string | null,
  predicate: (filePath: string) => boolean,
  adapter: ProcessHandoffAdapter,
): string | null {
  return adapter.listFilesRecursively(rootDir).filter(predicate).sort()[0] ?? null;
}

export function commitReportForHandoffPlan(
  handoffPlan: JsonRecord,
  adapter: ProcessHandoffAdapter,
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
        adapter.joinPath(
          expectedDir || "",
          "lifecyclemodel-save-draft",
          "outputs",
          "save-draft-bundle",
          "summary.json",
        ),
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

export function verifyReportForHandoffPlan(
  handoffPlan: JsonRecord,
  adapter: ProcessHandoffAdapter,
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

export function executeHandoff(
  { handoffPlanPath, ledgerDir, outDir, logDir, label }: ProcessHandoffInput,
  adapter: ProcessHandoffAdapter,
): ProcessHandoffResult {
  const handoffPlan = adapter.readJson(handoffPlanPath);
  const blockers: JsonRecord[] = [];
  const stages: JsonRecord[] = [];
  if (handoffPlan.status !== "ready_for_explicit_commit") {
    blockers.push({
      code: "handoff_plan_not_ready",
      message: `Handoff plan status is ${handoffPlan.status || "missing"}.`,
      handoff_plan: adapter.repoRelative(handoffPlanPath),
    });
    return { status: "blocked", blockers, stages, handoffPlan };
  }
  try {
    adapter.assertReceiptBoundHandoffAccount(handoffPlan, adapter.environment);
  } catch (error) {
    blockers.push({
      code: "handoff_account_evidence_mismatch",
      message: String(error instanceof Error ? error.message : error),
      handoff_plan: adapter.repoRelative(handoffPlanPath),
    });
    return { status: "blocked", blockers, stages, handoffPlan };
  }

  let commitSpec: FoundryCommandSpec;
  let verifySpec: FoundryCommandSpec;
  try {
    const commands = jsonRecord(handoffPlan.commands);
    const finalRowsArtifact = jsonRecord(handoffPlan.final_rows_artifact);
    const requiredFinalRowsArtifact: FoundryArtifactFact = {
      role: "final_rows",
      path: adapter.textValue(finalRowsArtifact.path),
      bytes: Number(finalRowsArtifact.bytes),
      sha256: adapter.textValue(finalRowsArtifact.sha256),
    };
    commitSpec = adapter.assertCommandSpecBindsArtifact(commands.commit, requiredFinalRowsArtifact);
    verifySpec = adapter.assertCommandSpecBindsArtifact(
      commands.post_write_verify,
      requiredFinalRowsArtifact,
    );
  } catch (error) {
    blockers.push({
      code: "handoff_command_spec_invalid",
      message: `Handoff plan must include valid authoritative commit and post_write_verify CommandSpecs: ${String(error instanceof Error ? error.message : error)}`,
      handoff_plan: adapter.repoRelative(handoffPlanPath),
    });
    return { status: "blocked", blockers, stages, handoffPlan };
  }

  let commitStage: ProcessHandoffStageRunResult;
  try {
    adapter.assertCommandSpecArtifactsCurrent(commitSpec);
    commitStage = adapter.runCommandSpecStage({
      stage: `${label}.commit`,
      commandSpec: commitSpec,
      cwd: adapter.repoRoot,
      logDir,
    });
  } catch (error) {
    blockers.push({
      code: "commit_handoff_artifact_binding_failed",
      message: `Commit CommandSpec artifact binding failed before spawn: ${String(error instanceof Error ? error.message : error)}`,
      handoff_plan: adapter.repoRelative(handoffPlanPath),
    });
    return { status: "failed", blockers, stages, handoffPlan };
  }
  const commitReportPath = commitReportForHandoffPlan(handoffPlan, adapter);
  stages.push(
    adapter.projectCommandStage({
      stage: `${label}.commit`,
      command: commitSpec.display,
      result: commitStage.result,
      stdoutLog: commitStage.stdoutLog,
      stderrLog: commitStage.stderrLog,
      reportPath: commitReportPath,
    }),
  );
  let recoveryStage: JsonRecord | null = null;
  if (commitStage.result.status !== 0 || !commitReportPath) {
    let recovery = null;
    try {
      recovery = commitReportPath
        ? summarizeSameIdentityCommitFailures([adapter.readJson(commitReportPath)])
        : null;
    } catch {
      recovery = null;
    }
    if (!recovery?.accepted) {
      blockers.push({
        code: "commit_handoff_command_failed",
        message: "CLI commit handoff failed or did not emit strict same-id/version evidence.",
        handoff_plan: adapter.repoRelative(handoffPlanPath),
        exit_code: commitStage.result.status ?? 1,
        commit_report: adapter.repoRelative(commitReportPath),
      });
      return { status: "failed", blockers, stages, handoffPlan };
    }
    recoveryStage = {
      stage: `${label}.commit.readback_recovery_pending`,
      status: "pending_exact_readback",
      commit_report: adapter.repoRelative(commitReportPath),
      same_identity_conflicts: recovery.alreadyExists,
      message:
        "Commit returned explicit 23505 same-id/version evidence; the mutation is not replayed and remains unaccepted until exact post-write readback succeeds.",
    };
    stages.push(recoveryStage);
  }
  if (!commitReportPath) {
    blockers.push({
      code: "commit_handoff_report_missing",
      message: "Commit recovery cannot continue without an exact commit report.",
      handoff_plan: adapter.repoRelative(handoffPlanPath),
    });
    return { status: "failed", blockers, stages, handoffPlan };
  }

  let verifyReportPath: string | null = null;
  let verifyAccepted = false;
  let verifyExitCode = 1;
  let verifyAttempts = 0;
  let verifyRetryReason: string | null = null;
  const maxVerifyAttempts = adapter.retryAttempts();
  for (let attempt = 1; attempt <= maxVerifyAttempts; attempt += 1) {
    const verifyStageName =
      attempt === 1 ? `${label}.post_write_verify` : `${label}.post_write_verify.retry_${attempt}`;
    let verifyStage: ProcessHandoffStageRunResult;
    try {
      verifyStage = adapter.runCommandSpecStage({
        stage: verifyStageName,
        commandSpec: verifySpec,
        cwd: adapter.repoRoot,
        logDir,
      });
    } catch (error) {
      blockers.push({
        code: "post_write_verify_artifact_binding_failed",
        message: `Verify CommandSpec artifact binding failed before spawn: ${String(error instanceof Error ? error.message : error)}`,
        handoff_plan: adapter.repoRelative(handoffPlanPath),
      });
      return { status: "failed", blockers, stages, handoffPlan };
    }
    verifyReportPath = verifyReportForHandoffPlan(handoffPlan, adapter);
    verifyExitCode = verifyStage.result.status ?? 1;
    verifyAttempts = attempt;
    const stageReport = adapter.projectCommandStage({
      stage: verifyStageName,
      command: verifySpec.display,
      result: verifyStage.result,
      stdoutLog: verifyStage.stdoutLog,
      stderrLog: verifyStage.stderrLog,
      reportPath: verifyReportPath,
    });
    stageReport.attempt = attempt;
    stageReport.max_attempts = maxVerifyAttempts;
    stages.push(stageReport);
    verifyAccepted = verifyStage.result.status === 0 && Boolean(verifyReportPath);
    if (
      verifyStage.result.status !== 0 &&
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
    verifyRetryReason = adapter.retryReason(verifyReportPath);
    if (!verifyRetryReason || attempt >= maxVerifyAttempts) break;
    const retryDelayMs = adapter.retryDelayMs(attempt - 1);
    stageReport.retry_reason = verifyRetryReason;
    stageReport.retry_next_delay_ms = retryDelayMs;
    adapter.sleep(retryDelayMs);
  }
  if (!verifyAccepted || !verifyReportPath) {
    blockers.push({
      code: "post_write_verify_command_failed",
      message:
        "CLI post-write verification failed or did not emit the expected remote verification report.",
      handoff_plan: adapter.repoRelative(handoffPlanPath),
      exit_code: verifyExitCode,
      post_write_verify_report: adapter.repoRelative(verifyReportPath),
      post_write_verify_attempts: verifyAttempts,
      retry_reason: verifyRetryReason,
    });
    return { status: "failed", blockers, stages, handoffPlan };
  }
  if (recoveryStage) {
    recoveryStage.status = "confirmed_by_exact_readback";
    recoveryStage.post_write_verify_report = adapter.repoRelative(verifyReportPath);
  }

  const closeoutDir = adapter.joinPath(outDir, "closeout");
  const closeoutArgv = closeoutCommand(
    {
      handoffPlanPath,
      commitReportPath,
      verifyReportPath,
      outDir: closeoutDir,
      ledgerDir,
    },
    adapter,
  );
  const closeoutStage = adapter.runArgvStage({
    stage: `${label}.closeout`,
    argv: closeoutArgv,
    logDir,
  });
  const closeoutReportPath = adapter.joinPath(
    closeoutDir,
    "dataset-post-write-closeout-report.json",
  );
  stages.push(
    adapter.projectCommandStage({
      stage: `${label}.closeout`,
      command: adapter.commandString(closeoutArgv),
      result: closeoutStage.result,
      stdoutLog: closeoutStage.stdoutLog,
      stderrLog: closeoutStage.stderrLog,
      reportPath: closeoutReportPath,
    }),
  );
  const closeoutReport = adapter.fileExists(closeoutReportPath)
    ? adapter.readJson(closeoutReportPath)
    : null;
  if (closeoutStage.result.status !== 0 || closeoutReport?.status !== "completed") {
    blockers.push({
      code: "post_write_closeout_failed",
      message: `Post-write closeout status is ${closeoutReport?.status || "missing"}.`,
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

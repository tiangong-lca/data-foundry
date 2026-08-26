export type BatchFinalizeJsonRecord = Record<string, unknown>;

export interface BatchFinalizeContextPaths {
  readonly schemaFile: string;
  readonly yamlFile: string;
  readonly rulesetFile: string;
}

export interface BatchFinalizeArgsInput {
  readonly type: string;
  readonly rowsFile: string;
  readonly outDir: string;
  readonly ledgerDir: string;
  readonly sourceSupportRowsFile?: string | null;
  readonly sourceRowsFile?: string | null;
  readonly flowpropertyRowsFile?: string | null;
  readonly unitgroupRowsFile?: string | null;
  readonly identityPreflightIndex?: string | null;
  readonly context: BatchFinalizeContextPaths;
  readonly classificationQueue?: string | null;
  readonly locationQueue?: string | null;
  readonly classificationApplyReport?: string | null;
  readonly locationApplyReport?: string | null;
  readonly identityApplyReports: readonly string[];
  readonly patchCollectReport?: string | null;
  readonly patchApplyReport?: string | null;
  readonly targetUserId: string;
  readonly stateCode: number;
}

export interface BatchFinalizeStageResult extends BatchFinalizeJsonRecord {
  stage: string;
  command: string;
  exit_code: number;
  signal: NodeJS.Signals | null;
  timed_out: boolean;
  timeout_ms: number;
  started_at_utc: string;
  finished_at_utc: string;
  stdout_log: string;
  stderr_log: string;
  json: BatchFinalizeJsonRecord | null;
  report?: string;
  attempt?: number;
  max_attempts?: number;
  retry_reason?: string;
  retry_next_delay_ms?: number;
}

export interface BatchFinalizeFileSystemAdapter {
  readonly fileExists: (filePath: string | null | undefined) => boolean;
  readonly readJson: (filePath: string) => BatchFinalizeJsonRecord;
}

export interface BatchFinalizePathAdapter {
  readonly repoRelative: (filePath: string) => string | null;
  readonly resolveRepoPath: (value: unknown) => string | null;
}

export interface BatchFinalizeArgvStageInput {
  readonly stage: string;
  readonly argv: string[];
  readonly logDir: string;
}

export interface BatchFinalizeArgvStageAdapter {
  readonly runArgvStage: (input: BatchFinalizeArgvStageInput) => Promise<BatchFinalizeStageResult>;
}

export interface BatchFinalizeStageAdapter
  extends BatchFinalizeFileSystemAdapter, BatchFinalizePathAdapter, BatchFinalizeArgvStageAdapter {
  readonly processExecPath: string;
  readonly foundryEntryPath: string;
  readonly activeProfile: () => string;
  readonly libraryContact: () => BatchFinalizeJsonRecord;
  readonly mintUnmatchedFpUgSupport: () => boolean;
  readonly nowIso: () => string;
  readonly normalizedList: (value: unknown) => string[];
}

export interface RetryableStageFailureInput {
  readonly stage: string;
  readonly blocker: BatchFinalizeJsonRecord;
  readonly report: string | null;
}

export interface RunFinalizeStageInput {
  readonly stage: string;
  readonly args: string[];
  readonly reportPath: string;
  readonly logDir: string;
}

export interface BatchFinalizeStageService {
  readonly buildFinalizeArgs: (input: BatchFinalizeArgsInput) => string[];
  readonly retryableStageFailure: (
    input: RetryableStageFailureInput,
  ) => BatchFinalizeJsonRecord | null;
  readonly runFinalizeStage: (input: RunFinalizeStageInput) => Promise<BatchFinalizeStageResult>;
}

function isJsonRecord(value: unknown): value is BatchFinalizeJsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function jsonRecord(value: unknown): BatchFinalizeJsonRecord {
  return isJsonRecord(value) ? value : {};
}

function recordArray(value: unknown): BatchFinalizeJsonRecord[] {
  return Array.isArray(value) ? value.map(jsonRecord) : [];
}

function appendOption(args: string[], name: string, value: unknown): void {
  if (value == null || value === "") return;
  if (value === true) {
    args.push(name);
    return;
  }
  args.push(name, String(value));
}

const retryableStageFailurePattern =
  /\b(?:ENOTFOUND|EAI_AGAIN|ETIMEDOUT|ECONNRESET|ECONNREFUSED|ECONNABORTED|EHOSTUNREACH|ENETUNREACH|ESOCKETTIMEDOUT)\b|npm error network|registry\.npmjs\.org|network connectivity|timed out after|lookup_failed after insert|identity_preflight_report_missing_or_non_json|identity_preflight_timeout|REMOTE_REQUEST_FAILED|Auth session missing/u;

export function createBatchFinalizeStageService(
  adapter: BatchFinalizeStageAdapter,
): BatchFinalizeStageService {
  function appendPathOption(args: string[], name: string, value: unknown): void {
    if (!value) return;
    const resolved = adapter.resolveRepoPath(value);
    if (!resolved) return;
    appendOption(args, name, adapter.repoRelative(resolved));
  }

  function appendPathOptions(args: string[], name: string, values: unknown): void {
    for (const value of adapter.normalizedList(values)) appendPathOption(args, name, value);
  }

  function failedStageNestedReportText(stageEntry: BatchFinalizeJsonRecord): unknown[] {
    if (stageEntry.exit_code === 0) return [];
    const nestedPath = adapter.resolveRepoPath(stageEntry.report_file);
    if (!nestedPath || !adapter.fileExists(nestedPath)) return [];
    let nested: BatchFinalizeJsonRecord;
    try {
      nested = adapter.readJson(nestedPath);
    } catch {
      return [];
    }
    const nestedBlockers = Array.isArray(nested.blockers) ? nested.blockers : [];
    return [nested.status, ...nestedBlockers.map((entry) => JSON.stringify(entry))].filter(Boolean);
  }

  function retryableStageFailureText({ blocker, report }: RetryableStageFailureInput): string {
    const blockerStage = jsonRecord(blocker.stage);
    const parts: unknown[] = [
      blocker.code,
      blocker.message,
      blocker.stderr,
      blockerStage.stderr,
      blockerStage.command,
    ];
    const reportPath = adapter.resolveRepoPath(report);
    if (adapter.fileExists(reportPath) && reportPath) {
      const reportJson = adapter.readJson(reportPath);
      const blockers = recordArray(reportJson.blockers);
      const reportStages = recordArray(reportJson.stages);
      parts.push(
        reportJson.status,
        ...blockers.map((entry) => JSON.stringify(entry)),
        ...reportStages.map((entry) =>
          [entry.stage, entry.status, entry.exit_code, entry.stderr, entry.command]
            .filter((value) => value != null && value !== "")
            .join("\n"),
        ),
        ...reportStages.flatMap((entry) => failedStageNestedReportText(entry)),
      );
    }
    return parts.filter(Boolean).join("\n");
  }

  function retryableStageFailure(
    input: RetryableStageFailureInput,
  ): BatchFinalizeJsonRecord | null {
    const code = String(input.blocker.code ?? "");
    const stageName = String(input.stage ?? "");
    if (
      !/(?:_stage_failed|_command_failed|_timeout|_report_missing|not_completed|not_ready|handoff_failed)$/u.test(
        code,
      ) &&
      !/(?:commit|verify|finalize|apply|materialize|preflight)/u.test(stageName)
    ) {
      return null;
    }
    const text = retryableStageFailureText(input);
    if (!retryableStageFailurePattern.test(text)) return null;
    const match = text.match(retryableStageFailurePattern);
    return {
      code: match?.[0] ?? "retryable_stage_failure",
      message:
        "Stage failed for a retryable tool, network, or eventual-consistency reason; rerun the same scope instead of sending it to human review.",
    };
  }

  function buildFinalizeArgs({
    type,
    rowsFile,
    outDir,
    ledgerDir,
    sourceSupportRowsFile,
    sourceRowsFile,
    flowpropertyRowsFile,
    unitgroupRowsFile,
    identityPreflightIndex,
    context,
    classificationQueue,
    locationQueue,
    classificationApplyReport,
    locationApplyReport,
    identityApplyReports,
    patchCollectReport,
    patchApplyReport,
    targetUserId,
    stateCode,
  }: BatchFinalizeArgsInput): string[] {
    const args = [
      adapter.processExecPath,
      adapter.foundryEntryPath,
      "dataset-post-authoring-finalize",
      "--type",
      type,
      "--profile",
      adapter.activeProfile(),
      "--rows-file",
      adapter.repoRelative(rowsFile),
      "--out-dir",
      adapter.repoRelative(outDir),
      "--ledger-dir",
      adapter.repoRelative(ledgerDir),
    ].filter((value): value is string => value !== null);
    appendPathOption(args, "--source-support-rows-file", sourceSupportRowsFile);
    appendPathOption(args, "--source-rows-file", sourceRowsFile);
    appendPathOption(args, "--identity-preflight-index", identityPreflightIndex);
    appendPathOption(args, "--schema-file", context.schemaFile);
    appendPathOption(args, "--yaml-file", context.yamlFile);
    appendPathOption(args, "--ruleset-file", context.rulesetFile);
    appendPathOption(args, "--classification-queue", classificationQueue);
    appendPathOption(args, "--location-queue", locationQueue);
    appendPathOption(args, "--classification-decision-apply-report", classificationApplyReport);
    appendPathOption(args, "--location-decision-apply-report", locationApplyReport);
    appendPathOptions(args, "--identity-decision-apply-report", identityApplyReports);
    appendPathOption(args, "--patch-collect-report", patchCollectReport);
    appendPathOption(args, "--patch-apply-report", patchApplyReport);
    appendOption(args, "--target-user-id", targetUserId);
    appendOption(args, "--state-code", stateCode);
    appendOption(args, "--root-policy", "candidate");
    args.push(
      "--finalize-source-contact-support",
      "--verify-remote",
      "--run-identity-preflight",
      "--refresh-identity-preflight",
    );
    const libraryContact = adapter.libraryContact();
    if (Object.keys(libraryContact).length > 0) {
      appendOption(args, "--library-name", libraryContact.libraryName);
      appendOption(args, "--library-short-name", libraryContact.shortName);
      appendOption(args, "--library-website", libraryContact.website);
      appendOption(args, "--library-email", libraryContact.email);
      appendOption(args, "--library-telephone", libraryContact.telephone);
      appendOption(args, "--library-contact-address", libraryContact.contactAddress);
      appendOption(args, "--library-central-contact-point", libraryContact.centralContactPoint);
      appendOption(args, "--library-description", libraryContact.description);
      appendOption(args, "--library-contact-id", libraryContact.contactId);
      appendOption(args, "--library-contact-version", libraryContact.contactVersion);
    }
    if (adapter.mintUnmatchedFpUgSupport()) {
      args.push("--mint-unmatched-fp-ug-support");
      appendPathOption(args, "--support-flowproperty-rows-file", flowpropertyRowsFile);
      appendPathOption(args, "--support-unitgroup-rows-file", unitgroupRowsFile);
    }
    if (patchCollectReport) args.push("--require-patch-collect-report");
    return args;
  }

  async function runFinalizeStage({
    stage,
    args,
    reportPath,
    logDir,
  }: RunFinalizeStageInput): Promise<BatchFinalizeStageResult> {
    const result = await adapter.runArgvStage({ stage, argv: args, logDir });
    const reportExists = adapter.fileExists(reportPath);
    const report = reportExists
      ? adapter.readJson(reportPath)
      : {
          schema_version: 1,
          generated_at_utc: adapter.nowIso(),
          status: "failed_retryable",
          blockers: [
            {
              code: result.timed_out ? "finalize_stage_timeout" : "finalize_report_missing",
              message: result.timed_out
                ? `${stage} timed out before writing the expected finalize report.`
                : `${stage} did not write the expected finalize report.`,
              stage,
              expected_report: adapter.repoRelative(reportPath),
              exit_code: result.exit_code,
              timed_out: Boolean(result.timed_out),
              stdout_log: result.stdout_log,
              stderr_log: result.stderr_log,
              stdout_report_status: result.json?.status ?? null,
              stdout_report_dataset_type: result.json?.dataset_type ?? null,
            },
          ],
          files: {
            expected_report: adapter.repoRelative(reportPath),
            stdout_log: result.stdout_log,
            stderr_log: result.stderr_log,
          },
        };
    result.finalize_report_missing = !reportExists;
    const relativeReportPath = adapter.repoRelative(reportPath);
    if (relativeReportPath) result.report = relativeReportPath;
    result.json = report;
    return result;
  }

  return { buildFinalizeArgs, retryableStageFailure, runFinalizeStage };
}

import type { JsonRecord } from "./finalize-recovery-policy.ts";
import type {
  BafuProcessScopeFinalizeReport,
  BafuProcessScopeHandoffSummaryInput,
  CompactCommandStage,
  CompactCommandStageInput,
  CompactCommandStageResult,
} from "./process-scope-report.ts";
import { resolveProcessScopeResume } from "./process-scope-resume.ts";

export interface ProcessScopeFinalizePlan {
  argv: string[];
  finalizeDir: string;
  finalizeReportPath: string;
}

export interface ProcessScopeFinalizeStageResult {
  result: CompactCommandStageResult;
  stdoutLog: string;
  stderrLog: string;
}

export interface ProcessScopeHandoffPlan {
  path: string | null;
  value: JsonRecord | null;
}

export interface ProcessScopeHandoffInput {
  handoffPlanPath: string;
  ledgerDir: string;
  outDir: string;
  logDir: string;
  label: string;
}

export interface ProcessScopeHandoffRunResult {
  status: string;
  stages: JsonRecord[];
  blockers: JsonRecord[];
  commitReportPath?: string | null;
  verifyReportPath?: string | null;
  closeoutReportPath?: string | null;
}

export interface ProcessScopeRecoveryInput {
  finalizeReport: JsonRecord;
  currentRowsFile: string;
  outDir: string;
  logDir: string;
  attempt: number;
}

export interface ProcessScopeRecoveryResult extends JsonRecord {
  status: string;
  stages?: JsonRecord[];
  blocker?: JsonRecord;
  rowsFile?: string;
  identityApplyReport?: string | null;
  patchCollectReport?: string | null;
  patchApplyReport?: string | null;
}

export interface ProcessScopeFinalizeProjectionInput {
  processScope: JsonRecord;
  outDir: string;
  reportPath: string;
  ledgerPath: string;
  finalizeReport: JsonRecord;
  finalizeReportPath: string;
  finalizeCommand: string[];
  mode: string;
  sourceSupportRowsFile: string | null;
  sourceRowsFile: string | null;
}

export interface ProcessScopeRerunCommandInput {
  rowsFile: string;
  outDir: string;
  sourceSupportRowsFile?: string | null;
  sourceRowsFile?: string | null;
}

export interface ProcessScopeFinalizeBuildInput {
  options: JsonRecord;
  rowsFile: string;
  outDir: string;
  importLedgerDir: string;
}

export interface ProcessScopeVerifiedSupportInput {
  cacheFile: unknown;
  identityKeys: string[];
  source: string;
  report: string;
}

export interface BafuProcessScopeRunAdapter {
  clock: {
    nowIso: () => string;
  };
  fs: {
    exists: (filePath: string | null | undefined) => boolean;
    mkdir: (directory: string) => void;
    readJson: (filePath: string) => JsonRecord;
    readJsonLines: (filePath: string) => JsonRecord[];
    readRowsFile: (filePath: string) => JsonRecord[];
  };
  path: {
    join: (...parts: string[]) => string;
    relative: (filePath: string | null | undefined) => string | null;
    resolve: (value: unknown) => string | null;
  };
  hash: {
    fileSha256: (filePath: string) => string;
    cliPackage: string;
  };
  options: {
    boolean: (value: unknown) => boolean;
    identityReports: (options: JsonRecord) => string[];
    processIdentity: (row: JsonRecord) => JsonRecord;
  };
  ledger: {
    append: (filePath: string, row: JsonRecord) => void;
  };
  stage: {
    project: (input: CompactCommandStageInput) => CompactCommandStage;
    runFinalize: (input: {
      command: string[];
      logDir: string;
      label: string;
    }) => ProcessScopeFinalizeStageResult;
  };
  finalize: {
    build: (input: ProcessScopeFinalizeBuildInput) => ProcessScopeFinalizePlan;
    project: (input: ProcessScopeFinalizeProjectionInput) => BafuProcessScopeFinalizeReport;
    readGate: (finalizeReport: JsonRecord) => JsonRecord | null;
  };
  handoff: {
    appendVerifiedSupportIdentities: (input: ProcessScopeVerifiedSupportInput) => void;
    applySummary: (input: BafuProcessScopeHandoffSummaryInput) => BafuProcessScopeFinalizeReport;
    execute: (input: ProcessScopeHandoffInput) => ProcessScopeHandoffRunResult;
    loadVerifiedSupportIdentities: (cacheFile: unknown) => Set<string>;
    readPlan: (finalizeReport: JsonRecord, key: string) => ProcessScopeHandoffPlan;
    supportIdentityKeys: (handoffPlan: JsonRecord) => string[];
  };
  recovery: {
    canRunIdentity: (gateReport: JsonRecord | null) => boolean;
    canRunSemantic: (gateReport: JsonRecord | null) => boolean;
    runIdentity: (input: ProcessScopeRecoveryInput) => ProcessScopeRecoveryResult;
    runSemantic: (input: ProcessScopeRecoveryInput) => ProcessScopeRecoveryResult;
  };
  report: {
    commandString: (argv: readonly string[]) => string;
    rerunCommand: (input: ProcessScopeRerunCommandInput) => string;
    writeJson: (filePath: string, value: JsonRecord) => void;
  };
}

export interface BafuProcessScopeRunFactoryInput {
  commandName: string;
  reportFileName: string;
  ledgerFileName: string;
  adapter: BafuProcessScopeRunAdapter;
}

function jsonRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : {};
}

function failedFinalizeReport({
  commandName,
  processScope,
  reportPath,
  ledgerPath,
  finalizeCommand,
  finalizeStage,
  adapter,
}: {
  commandName: string;
  processScope: JsonRecord;
  reportPath: string;
  ledgerPath: string;
  finalizeCommand: string[];
  finalizeStage: ProcessScopeFinalizeStageResult;
  adapter: BafuProcessScopeRunAdapter;
}): JsonRecord {
  return {
    schema_version: 1,
    generated_at_utc: adapter.clock.nowIso(),
    command: commandName,
    status: "failed",
    profile: "bafu",
    process_scope: processScope,
    counts: { blockers: 1 },
    blockers: [
      {
        code: "post_authoring_finalize_failed_without_report",
        severity: "error",
        message: "Existing Foundry finalize command failed before writing its report.",
        exit_code: finalizeStage.result.status ?? 1,
        error: finalizeStage.result.error
          ? String(finalizeStage.result.error.message || finalizeStage.result.error)
          : null,
      },
    ],
    commands: { post_authoring_finalize: adapter.report.commandString(finalizeCommand) },
    files: {
      report: adapter.path.relative(reportPath),
      run_ledger: adapter.path.relative(ledgerPath),
      stdout_log: adapter.path.relative(finalizeStage.stdoutLog),
      stderr_log: adapter.path.relative(finalizeStage.stderrLog),
    },
  };
}

export function createBafuProcessScopeRun({
  commandName,
  reportFileName,
  ledgerFileName,
  adapter,
}: BafuProcessScopeRunFactoryInput): { run: (options?: JsonRecord) => JsonRecord } {
  function run(options: JsonRecord = {}): JsonRecord {
    const profile = String(options.profile || "bafu")
      .trim()
      .toLowerCase();
    if (profile !== "bafu") {
      throw new Error(`${commandName} is intentionally scoped to --profile bafu.`);
    }
    const rowsFile = adapter.path.resolve(options.rowsFile || options.rows || options.input);
    if (!adapter.fs.exists(rowsFile)) {
      throw new Error("--rows-file is required and must point to one process row file.");
    }
    const rows = adapter.fs.readRowsFile(rowsFile!);
    if (rows.length !== 1) {
      throw new Error(`--rows-file must contain exactly one process row; found ${rows.length}.`);
    }
    const processScope = adapter.options.processIdentity(rows[0]);
    if (!processScope.id) {
      throw new Error("--rows-file must contain a process UUID or dataset_id.");
    }
    const outDir = adapter.path.resolve(
      options.outDir ||
        adapter.path.join(
          ".foundry",
          "workspaces",
          "bafu-process-scope-e2e",
          String(processScope.id),
        ),
    )!;
    adapter.fs.mkdir(outDir);
    const reportPath = adapter.path.join(outDir, reportFileName);
    const ledgerPath = adapter.path.join(outDir, ledgerFileName);
    const importLedgerDir = adapter.path.resolve(
      options.ledgerDir || options.importLedgerDir || adapter.path.join(outDir, "import-ledger"),
    )!;
    const sourceSupportRowsFile = adapter.path.resolve(options.sourceSupportRowsFile);
    if (options.sourceSupportRowsFile && !adapter.fs.exists(sourceSupportRowsFile)) {
      throw new Error("--source-support-rows-file must point to a readable rows file.");
    }
    const sourceRowsFile = adapter.path.resolve(options.sourceRowsFile || options.originalRowsFile);
    if (
      (options.sourceRowsFile || options.originalRowsFile) &&
      !adapter.fs.exists(sourceRowsFile)
    ) {
      throw new Error("--source-rows-file must point to a readable rows file when provided.");
    }
    const inputHashes: JsonRecord = {
      rows_file_sha256: adapter.hash.fileSha256(rowsFile!),
      source_support_rows_file_sha256: sourceSupportRowsFile
        ? adapter.hash.fileSha256(sourceSupportRowsFile)
        : null,
      source_rows_file_sha256: sourceRowsFile ? adapter.hash.fileSha256(sourceRowsFile) : null,
    };
    let currentRowsFile = rowsFile!;
    let currentIdentityReports = adapter.options.identityReports(options);
    let currentPatchCollectReport = adapter.path.resolve(
      options.patchCollectReport || options.authoringPatchCollectReport,
    );
    let currentPatchApplyReport = adapter.path.resolve(options.patchApplyReport);
    let finalizePlan = adapter.finalize.build({
      options,
      rowsFile: currentRowsFile,
      outDir,
      importLedgerDir,
    });
    const explicitFinalizeReportPath = adapter.path.resolve(options.finalizeReport);
    let finalizeReportPath = explicitFinalizeReportPath || finalizePlan.finalizeReportPath;
    let finalizeCommand = finalizePlan.argv;
    const resume = !Object.hasOwn(options, "resume") || adapter.options.boolean(options.resume);
    const { contract: resumeContract, checkpoint: previous } = resolveProcessScopeResume({
      enabled: resume,
      ledgerPath,
      contractInput: {
        commandName,
        processScope,
        inputHashes,
        options,
        finalizeCommand,
        cliPackage: adapter.hash.cliPackage,
      },
      adapter: {
        exists: adapter.fs.exists,
        readJsonLines: adapter.fs.readJsonLines,
        resolve: adapter.path.resolve,
        fileSha256: adapter.hash.fileSha256,
      },
    });
    const existingFinalizeReportPath = previous
      ? adapter.path.resolve(jsonRecord(previous.files).finalize_report)
      : null;

    if (existingFinalizeReportPath && !adapter.options.boolean(options.force)) {
      const finalizeReport = adapter.fs.readJson(existingFinalizeReportPath);
      const report = adapter.finalize.project({
        processScope,
        outDir,
        reportPath,
        ledgerPath,
        finalizeReport,
        finalizeReportPath: existingFinalizeReportPath,
        finalizeCommand,
        mode: previous ? "resume" : "existing-report",
        sourceSupportRowsFile,
        sourceRowsFile,
      });
      adapter.ledger.append(ledgerPath, {
        schema_version: 1,
        generated_at_utc: report.generated_at_utc,
        command: commandName,
        stage: "resume",
        state: report.status,
        process_scope: processScope,
        input_hashes: inputHashes,
        resume_contract: resumeContract,
        finalize_report_sha256: adapter.hash.fileSha256(existingFinalizeReportPath),
        files: {
          report: adapter.path.relative(reportPath),
          finalize_report: adapter.path.relative(existingFinalizeReportPath),
        },
        blockers: report.blockers,
      });
      adapter.report.writeJson(reportPath, report);
      return report;
    }

    if (!adapter.options.boolean(options.execute)) {
      const report: JsonRecord = {
        schema_version: 1,
        generated_at_utc: adapter.clock.nowIso(),
        command: commandName,
        status: "planned",
        profile: "bafu",
        process_scope: processScope,
        policy: {
          uses_existing_foundry_commands: true,
          existing_command: "dataset-post-authoring-finalize",
          remote_commit_executed: false,
          unresolved_ai_curation_items_hard_block: true,
          one_process_scope_only: true,
        },
        counts: { blockers: 0 },
        blockers: [],
        commands: {
          post_authoring_finalize: adapter.report.commandString(finalizeCommand),
        },
        inputs: {
          rows_file: adapter.path.relative(rowsFile),
          source_support_rows_file: adapter.path.relative(sourceSupportRowsFile),
          source_rows_file: adapter.path.relative(sourceRowsFile),
        },
        files: {
          report: adapter.path.relative(reportPath),
          run_ledger: adapter.path.relative(ledgerPath),
          expected_finalize_report: adapter.path.relative(finalizeReportPath),
          import_ledger_dir: adapter.path.relative(importLedgerDir),
        },
        resume: {
          rerun_command: adapter.report.rerunCommand({
            rowsFile: rowsFile!,
            outDir,
            sourceSupportRowsFile,
            sourceRowsFile,
          }),
        },
      };
      adapter.ledger.append(ledgerPath, {
        schema_version: 1,
        generated_at_utc: report.generated_at_utc,
        command: commandName,
        stage: "plan",
        state: "planned",
        process_scope: processScope,
        input_hashes: inputHashes,
        files: {
          report: adapter.path.relative(reportPath),
          expected_finalize_report: adapter.path.relative(finalizeReportPath),
        },
      });
      adapter.report.writeJson(reportPath, report);
      return report;
    }

    const logDir = adapter.path.join(outDir, "logs");
    adapter.fs.mkdir(logDir);
    let finalizeStage = adapter.stage.runFinalize({
      command: finalizeCommand,
      logDir,
      label: "post-authoring-finalize",
    });
    const initialFinalizeStdoutLog = finalizeStage.stdoutLog;
    const initialFinalizeStderrLog = finalizeStage.stderrLog;
    if (!adapter.fs.exists(finalizeReportPath)) {
      const report = failedFinalizeReport({
        commandName,
        processScope,
        reportPath,
        ledgerPath,
        finalizeCommand,
        finalizeStage,
        adapter,
      });
      adapter.ledger.append(ledgerPath, {
        schema_version: 1,
        generated_at_utc: report.generated_at_utc,
        command: commandName,
        stage: "post_authoring_finalize",
        state: "failed",
        process_scope: processScope,
        input_hashes: inputHashes,
        exit_code: finalizeStage.result.status ?? 1,
        files: report.files,
        blockers: report.blockers,
      });
      adapter.report.writeJson(reportPath, report);
      return report;
    }

    let finalizeReport = adapter.fs.readJson(finalizeReportPath);
    const handoffStages: JsonRecord[] = [];
    const handoffBlockers: JsonRecord[] = [];
    let supportCommitted = false;
    let supportReused = false;
    if (adapter.options.boolean(options.commitSupport)) {
      const supportHandoff = adapter.handoff.readPlan(
        finalizeReport,
        "source_contact_support_commit_handoff_plan",
      );
      if (supportHandoff.path) {
        const supportIdentityKeys = adapter.handoff.supportIdentityKeys(
          jsonRecord(supportHandoff.value),
        );
        const supportCacheFile =
          options.verifiedSupportIdentitiesFile || options.supportIdentityCache || null;
        const cachedSupportIdentities =
          adapter.handoff.loadVerifiedSupportIdentities(supportCacheFile);
        const canReuseSupport =
          supportIdentityKeys.length > 0 &&
          supportIdentityKeys.every((identityKey) => cachedSupportIdentities.has(identityKey));
        if (canReuseSupport) {
          supportReused = true;
          supportCommitted = true;
          const reuseReportPath = adapter.path.join(
            outDir,
            "source-contact-support-handoff",
            "reused-support-identities.json",
          );
          adapter.report.writeJson(reuseReportPath, {
            schema_version: 1,
            generated_at_utc: adapter.clock.nowIso(),
            status: "reused_verified_support_identities",
            handoff_plan: adapter.path.relative(supportHandoff.path),
            support_identity_cache: adapter.path.relative(adapter.path.resolve(supportCacheFile)),
            support_identities: supportIdentityKeys,
          });
          handoffStages.push({
            stage: "support.reuse_verified",
            status: "skipped",
            report: adapter.path.relative(reuseReportPath),
            support_identities: supportIdentityKeys,
          });
        } else {
          const supportResult = adapter.handoff.execute({
            handoffPlanPath: supportHandoff.path,
            ledgerDir: importLedgerDir,
            outDir: adapter.path.join(outDir, "source-contact-support-handoff"),
            logDir,
            label: "support",
          });
          handoffStages.push(...supportResult.stages);
          handoffBlockers.push(...supportResult.blockers);
          supportCommitted = supportResult.status === "completed";
          if (supportCommitted && handoffBlockers.length === 0) {
            adapter.handoff.appendVerifiedSupportIdentities({
              cacheFile: supportCacheFile,
              identityKeys: supportIdentityKeys,
              source: "process_scope_e2e.support_handoff",
              report: supportResult.closeoutReportPath!,
            });
          }
        }
        if (supportCommitted && handoffBlockers.length === 0) {
          const rerun = adapter.stage.runFinalize({
            command: finalizeCommand,
            logDir,
            label: "post-authoring-finalize-after-support",
          });
          handoffStages.push(
            adapter.stage.project({
              stage: "process.finalize_after_support",
              command: adapter.report.commandString(finalizeCommand),
              result: rerun.result,
              stdoutLog: adapter.path.relative(rerun.stdoutLog),
              stderrLog: adapter.path.relative(rerun.stderrLog),
              report: adapter.path.relative(finalizeReportPath),
            }),
          );
          if (adapter.fs.exists(finalizeReportPath)) {
            finalizeReport = adapter.fs.readJson(finalizeReportPath);
          }
        }
      }
    }

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      if (finalizeReport.status === "ready_for_remote_write") break;
      const gateReport = adapter.finalize.readGate(finalizeReport);
      let recoveryKind: "identity" | "semantic" | null = null;
      let recovery: ProcessScopeRecoveryResult | null = null;
      if (adapter.recovery.canRunIdentity(gateReport)) {
        recoveryKind = "identity";
        recovery = adapter.recovery.runIdentity({
          finalizeReport,
          currentRowsFile,
          outDir,
          logDir,
          attempt,
        });
      } else if (adapter.recovery.canRunSemantic(gateReport)) {
        recoveryKind = "semantic";
        recovery = adapter.recovery.runSemantic({
          finalizeReport,
          currentRowsFile,
          outDir,
          logDir,
          attempt,
        });
      } else {
        break;
      }
      handoffStages.push(...(recovery.stages ?? []));
      if (!["completed", "completed_noop"].includes(recovery.status)) {
        handoffBlockers.push(
          recovery.blocker ?? {
            code: `post_finalize_${recoveryKind}_recovery_failed`,
            message: `Post-finalize ${recoveryKind} recovery did not complete.`,
          },
        );
        break;
      }
      currentRowsFile = recovery.rowsFile || currentRowsFile;
      if (recovery.identityApplyReport) {
        currentIdentityReports.push(recovery.identityApplyReport);
      }
      if (recovery.patchCollectReport) currentPatchCollectReport = recovery.patchCollectReport;
      if (recovery.patchApplyReport) currentPatchApplyReport = recovery.patchApplyReport;
      finalizePlan = adapter.finalize.build({
        options: {
          ...options,
          identityDecisionApplyReports: currentIdentityReports,
          patchCollectReport: currentPatchCollectReport,
          patchApplyReport: currentPatchApplyReport,
        },
        rowsFile: currentRowsFile,
        outDir,
        importLedgerDir,
      });
      finalizeReportPath = explicitFinalizeReportPath || finalizePlan.finalizeReportPath;
      finalizeCommand = finalizePlan.argv;
      finalizeStage = adapter.stage.runFinalize({
        command: finalizeCommand,
        logDir,
        label: `post-authoring-finalize-after-${recoveryKind}-${attempt}`,
      });
      handoffStages.push(
        adapter.stage.project({
          stage: `process.finalize_after_${recoveryKind}_${attempt}`,
          command: adapter.report.commandString(finalizeCommand),
          result: finalizeStage.result,
          stdoutLog: adapter.path.relative(finalizeStage.stdoutLog),
          stderrLog: adapter.path.relative(finalizeStage.stderrLog),
          report: adapter.path.relative(finalizeReportPath),
        }),
      );
      if (!adapter.fs.exists(finalizeReportPath)) break;
      finalizeReport = adapter.fs.readJson(finalizeReportPath);
    }

    let report = adapter.finalize.project({
      processScope,
      outDir,
      reportPath,
      ledgerPath,
      finalizeReport,
      finalizeReportPath,
      finalizeCommand,
      mode: "execute",
      sourceSupportRowsFile,
      sourceRowsFile,
    });
    report = adapter.handoff.applySummary({
      report,
      stages: handoffStages,
      blockers: handoffBlockers,
      supportCommitted,
      supportReused,
    });

    if (adapter.options.boolean(options.commit) && report.status === "ready_for_explicit_commit") {
      const processHandoff = adapter.handoff.readPlan(finalizeReport, "commit_handoff_plan");
      if (!processHandoff.path) {
        report.blockers = [
          ...report.blockers,
          {
            code: "process_commit_handoff_plan_missing",
            message: "Ready process scope is missing dataset-commit-handoff-plan.json.",
          },
        ];
        report.counts.blockers = report.blockers.length;
        report.status = "blocked";
      } else {
        const processResult = adapter.handoff.execute({
          handoffPlanPath: processHandoff.path,
          ledgerDir: importLedgerDir,
          outDir: adapter.path.join(outDir, "process-handoff"),
          logDir,
          label: "process",
        });
        report.handoff_stages = [...(report.handoff_stages ?? []), ...processResult.stages];
        report.blockers = [...report.blockers, ...processResult.blockers];
        report.counts.blockers = report.blockers.length;
        report.files.process_commit_report = adapter.path.relative(processResult.commitReportPath);
        report.files.process_post_write_verify_report = adapter.path.relative(
          processResult.verifyReportPath,
        );
        report.files.process_closeout_report = adapter.path.relative(
          processResult.closeoutReportPath,
        );
        report.status = processResult.status === "completed" ? "completed" : "failed";
        report.policy.remote_commit_executed = processResult.status === "completed";
      }
    }
    adapter.ledger.append(ledgerPath, {
      schema_version: 1,
      generated_at_utc: report.generated_at_utc,
      command: commandName,
      stage: "post_authoring_finalize",
      state: report.status,
      process_scope: processScope,
      input_hashes: inputHashes,
      resume_contract: resumeContract,
      finalize_report_sha256: adapter.hash.fileSha256(finalizeReportPath),
      exit_code: finalizeStage.result.status ?? 0,
      files: {
        report: adapter.path.relative(reportPath),
        finalize_report: adapter.path.relative(finalizeReportPath),
        stdout_log: adapter.path.relative(initialFinalizeStdoutLog),
        stderr_log: adapter.path.relative(initialFinalizeStderrLog),
      },
      blockers: report.blockers,
    });
    adapter.report.writeJson(reportPath, report);
    return report;
  }

  return { run };
}

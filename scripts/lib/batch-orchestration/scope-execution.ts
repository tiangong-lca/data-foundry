import type {
  BatchScopeActionInput as ScopeActionInput,
  BatchScopeExecutionAdapter,
  BatchScopeExecutionService,
  BatchScopeJsonRecord as JsonRecord,
  RunBatchScopeInput,
} from "./scope-execution-contract.ts";

export type { BatchScopeExecutionPaths } from "./scope-execution-contract.ts";

function jsonRecord(value: unknown): JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

export function createBatchScopeExecutionService(
  adapter: BatchScopeExecutionAdapter,
): BatchScopeExecutionService {
  const { io, operations } = adapter;

  async function runOneScope({
    scope,
    familySignature,
    options,
    paths,
    schemas,
    verifiedScopes,
    verifiedFlows,
    verifiedFlowRowsByKey,
    blockedScopes,
  }: RunBatchScopeInput): Promise<JsonRecord> {
    const processId = io.asText(scope.process_id || scope.id);
    const processVersion = io.asText(scope.process_version || scope.version) || "00.00.001";
    const targetUserId = io.asText(options.targetUserId);
    const stateCode = io.integerOption(options.stateCode, 0) ?? 0;
    const scopeDir = io.joinPath(paths.outDir, "scopes", processId);
    const logDir = io.joinPath(scopeDir, "logs");
    const ledgerDir = io.joinPath(scopeDir, "import-ledger");
    const stages: JsonRecord[] = [];
    const checkpointBase = {
      schema_version: 1,
      generated_at_utc: io.nowIso(),
      process_id: processId,
      process_version: processVersion,
      scope_lock: `process:${processId}:${processVersion}`,
      ...operations.familyPlanFields(familySignature),
    };
    const rerunCommand = operations.commandString([
      io.processExecPath,
      io.foundryEntryPath,
      io.rerunCommandName,
      "--scope-file",
      io.repoRelative(paths.scopeFile),
      "--process-bundles-dir",
      io.repoRelative(paths.processBundlesDir),
      "--run-dir",
      io.repoRelative(paths.runDir),
      "--out-dir",
      io.repoRelative(paths.outDir),
      "--process-id",
      processId,
      "--commit",
      "--parallel",
      "1",
    ]);

    io.ensureDirectory(scopeDir);
    if (verifiedScopes.has(`${processId}@${processVersion}`) && !io.booleanOption(options.force)) {
      const checkpoint = { ...checkpointBase, state: "skipped_already_verified" };
      io.appendJsonLine(paths.scopeCheckpoints, checkpoint);
      return { status: "skipped", checkpoint, stages };
    }
    const explicitProcessIds = new Set(operations.requestedProcessIdValues(options));
    if (
      blockedScopes.has(`${processId}@${processVersion}`) &&
      !io.booleanOption(options.force) &&
      !explicitProcessIds.has(processId)
    ) {
      const checkpoint = { ...checkpointBase, state: "skipped_blocked_deferred" };
      io.appendJsonLine(paths.scopeCheckpoints, checkpoint);
      return { status: "skipped_blocked", checkpoint, stages };
    }

    io.appendJsonLine(paths.scopeCheckpoints, { ...checkpointBase, state: "started" });

    const block = ({ stage, blocker, report }: ScopeActionInput): JsonRecord => {
      const row = operations.blockRow({ scope, stage, blocker, report, rerunCommand });
      io.appendJsonLine(paths.blockedHumanReview, row);
      const categoryPath =
        paths[`blocked_${operations.categoryForBlocker(row.code).replace(/-/gu, "_")}`];
      io.appendJsonLine(io.asText(categoryPath) || paths.blockedOther, row);
      io.appendJsonLine(paths.scopeCheckpoints, {
        ...checkpointBase,
        state: "blocked_deferred",
        stage,
        code: row.code,
      });
      return {
        status: "blocked",
        checkpoint: { ...checkpointBase, state: "blocked_deferred" },
        block: row,
        stages,
      };
    };

    const fail = ({ stage, blocker, report }: ScopeActionInput): JsonRecord => {
      const row = operations.blockRow({ scope, stage, blocker, report, rerunCommand });
      io.appendJsonLine(paths.failedRetry, row);
      io.appendJsonLine(paths.blocked_remote_write, row);
      io.appendJsonLine(paths.scopeCheckpoints, {
        ...checkpointBase,
        state: "failed_retryable",
        stage,
        code: row.code,
      });
      return {
        status: "failed",
        checkpoint: { ...checkpointBase, state: "failed_retryable" },
        block: row,
        stages,
      };
    };

    const defer = ({ stage, blocker, report }: ScopeActionInput): JsonRecord => {
      const retryable = operations.retryableStageFailure({ stage, blocker, report });
      if (!retryable) return block({ stage, blocker, report });
      return fail({
        stage,
        blocker: {
          ...blocker,
          retryable: true,
          retryable_reason_code: retryable.code,
          retryable_reason: retryable.message,
          required_human_action:
            "Do not manually curate this scope for the recorded stage failure. Restore CLI/npm/network availability or wait for remote consistency, then rerun the exact scope command.",
        },
        report,
      });
    };

    const prepared = await operations.prepareScope({
      processId,
      scopeDir,
      logDir,
      stages,
      paths,
      schemas,
    });
    if (prepared.status !== "completed") {
      return defer(prepared);
    }
    const { materialized, processClassifiedRows, classificationApplyReport, locationApplyReport } =
      prepared;
    let flowRowsForFinalize = prepared.flowRowsForFinalize;

    const flowRows = io.readRows(flowRowsForFinalize);
    const flowIds = flowRows
      .map((row) => operations.datasetIdentity(row, "flow"))
      .filter((identity) => identity.id);
    const flowVerificationPlan = operations.flowRowsPendingVerification(
      flowRows,
      verifiedFlows,
      verifiedFlowRowsByKey,
    );
    const unverifiedFlowIds = flowVerificationPlan.pendingIdentities;
    const carriedForwardFlows = operations.writeScopeCarriedForwardVerifiedFlowRows({
      ledgerDir,
      processId,
      verifiedIdentities: flowVerificationPlan.verifiedIdentities,
      verifiedFlowRowsByKey,
    });
    if (carriedForwardFlows.count > 0) {
      stages.push({
        stage: "flow.carry_forward_verified",
        status: "completed",
        exit_code: 0,
        report: null,
        counts: { carried_forward_verified_flows: carriedForwardFlows.count },
        carried_forward_verified_identities: carriedForwardFlows.rows,
        ledger: io.repoRelative(carriedForwardFlows.ledger),
      });
    }
    if (
      flowRows.length > 0 &&
      flowVerificationPlan.pendingRows.length > 0 &&
      flowVerificationPlan.pendingRows.length < flowRows.length
    ) {
      const flowFilterDir = io.joinPath(scopeDir, "flow-filter-verified");
      const pendingRowsFile = io.joinPath(flowFilterDir, "flows.unverified.jsonl");
      const filterReportPath = io.joinPath(flowFilterDir, "flow-filter-verified-report.json");
      io.writeJsonLines(pendingRowsFile, flowVerificationPlan.pendingRows);
      io.writeJson(filterReportPath, {
        schema_version: 1,
        generated_at_utc: io.nowIso(),
        status: "completed",
        input_rows_file: io.repoRelative(flowRowsForFinalize),
        output_rows_file: io.repoRelative(pendingRowsFile),
        policy:
          "Only flow rows not present in ok.flows.verified are passed to flow finalize/commit. Already verified flows remain remote dependencies for the process scope.",
        counts: {
          input_rows: flowRows.length,
          output_rows: flowVerificationPlan.pendingRows.length,
          skipped_verified_rows: flowVerificationPlan.verifiedRows.length,
        },
        pending_identities: flowVerificationPlan.pendingIdentities,
        skipped_verified_identities: flowVerificationPlan.verifiedIdentities,
        files: {
          input_rows: io.repoRelative(flowRowsForFinalize),
          output_rows: io.repoRelative(pendingRowsFile),
          report: io.repoRelative(filterReportPath),
        },
      });
      stages.push({
        stage: "flow.filter_verified",
        status: "completed",
        exit_code: 0,
        report: io.repoRelative(filterReportPath),
        counts: {
          input_rows: flowRows.length,
          output_rows: flowVerificationPlan.pendingRows.length,
          skipped_verified_rows: flowVerificationPlan.verifiedRows.length,
        },
      });
      flowRowsForFinalize = pendingRowsFile;
    }

    let flowIdentityReport: string | null = null;
    let flowIdentityReportsForProcess =
      operations.existingIdentityApplyReportsWithReferenceRewrites(scopeDir, "flow");
    if (flowRows.length > 0 && unverifiedFlowIds.length > 0) {
      const flowPreDir = io.joinPath(scopeDir, "flow-pre-finalize");
      const flowPreReportPath = io.joinPath(
        flowPreDir,
        "dataset-post-authoring-finalize-report.json",
      );
      const flowPreArgs = operations.buildFinalizeArgs({
        type: "flow",
        rowsFile: flowRowsForFinalize!,
        outDir: flowPreDir,
        ledgerDir,
        sourceSupportRowsFile: materialized.supportRowsFile,
        sourceRowsFile: materialized.sourceRowsFile,
        flowpropertyRowsFile: materialized.flowpropertyRowsFile,
        unitgroupRowsFile: materialized.unitgroupRowsFile,
        identityPreflightIndex: materialized.identityPreflightIndex,
        context: operations.defaultContext(paths.runDir, "flow"),
        classificationQueue: materialized.classificationQueue,
        locationQueue: materialized.locationQueue,
        classificationApplyReport,
        locationApplyReport,
        identityApplyReports: [],
        targetUserId,
        stateCode,
      });
      const flowPre = await operations.runFinalizeStage({
        stage: "flow.pre_finalize",
        args: flowPreArgs,
        reportPath: flowPreReportPath,
        logDir,
      });
      stages.push(flowPre);
      if (flowPre.finalize_report_missing) {
        return fail({
          stage: "flow.pre_finalize",
          blocker: operations.firstBlocker(
            flowPre.json,
            "finalize_report_missing",
            "Flow pre-finalize did not write the expected report.",
          ),
          report: flowPreReportPath,
        });
      }
      if (operations.commitFlowSupportInline()) {
        flowPre.json = await operations.maybeCommitSupportThenRerunFinalize({
          type: "flow",
          finalizeReport: flowPre.json!,
          finalizeReportPath: flowPreReportPath,
          finalizeArgs: flowPreArgs,
          ledgerDir,
          scopeDir,
          logDir,
          stages,
          supportIdentityCacheFile: paths.supportIdentityCache,
        });
      }
      const flowPreFiles = jsonRecord(flowPre.json?.files);
      let flowReadyRows = io.resolveRepoPath(flowPreFiles.final_rows) || flowRowsForFinalize!;
      let flowPatchCollectReport: string | null = null;
      let flowPatchApplyReport: string | null = null;
      const deterministicFlowReuse =
        paths.applyResolutionRewritesMode &&
        (paths.resolutionRewritesByProcess.get(processId)?.length || 0) > 0;
      if (flowPre.json?.status !== "ready_for_remote_write" || deterministicFlowReuse) {
        const flowAuthoring = await operations.runIdentityAndPatch({
          type: "flow",
          inputRowsFile: flowReadyRows,
          preFinalizeReport: flowPre.json!,
          scopeDir,
          runDir: paths.runDir,
          logDir,
          stages,
          resolutionRewriteRows: paths.resolutionRewritesByProcess.get(processId),
          applyResolutionRewritesMode: paths.applyResolutionRewritesMode,
        });
        if (flowAuthoring.status !== "completed") {
          return defer({
            stage: "flow.authoring",
            blocker: flowAuthoring.blocker,
            report: flowAuthoring.report ?? null,
          });
        }
        flowReadyRows = flowAuthoring.rowsFile;
        flowIdentityReport = flowAuthoring.identityApplyReport;
        flowIdentityReportsForProcess = operations.uniqueExistingPaths([
          ...flowIdentityReportsForProcess,
          flowIdentityReport,
        ]);
        flowPatchCollectReport = flowAuthoring.patchCollectReport;
        flowPatchApplyReport = flowAuthoring.patchApplyReport;
        const recoveryBlocker = operations.preFinalizeRecoveryBlocker({
          type: "flow",
          finalizeReport: flowPre.json!,
          recovery: flowAuthoring,
        });
        if (recoveryBlocker) {
          return defer({
            stage: "flow.finalize",
            blocker: recoveryBlocker,
            report: flowPreReportPath,
          });
        }
      }
      if (io.readRows(flowReadyRows).length === 0) {
        stages.push({
          stage: "flow.finalize",
          status: "skipped_no_write_rows_after_identity_reuse",
          exit_code: 0,
          rows_file: io.repoRelative(flowReadyRows),
          identity_decision_apply_report: flowIdentityReport
            ? io.repoRelative(flowIdentityReport)
            : null,
        });
      } else {
        const flowCommit = await operations.finalizeAndCommitDataset({
          type: "flow",
          rowsFile: flowReadyRows,
          scopeDir,
          runDir: paths.runDir,
          materialized,
          classificationApplyReport,
          locationApplyReport,
          identityApplyReports: flowIdentityReport ? [flowIdentityReport] : [],
          patchCollectReport: flowPatchCollectReport,
          patchApplyReport: flowPatchApplyReport,
          targetUserId,
          stateCode,
          logDir,
          ledgerDir,
          stages,
          supportIdentityCacheFile: paths.supportIdentityCache,
        });
        if (flowCommit.status === "failed") {
          return fail({
            stage: "flow.commit",
            blocker: flowCommit.blocker,
            report: flowCommit.report,
          });
        }
        if (flowCommit.status !== "completed") {
          const action =
            operations.categoryForBlocker(flowCommit.blocker.code) === "remote-write"
              ? fail
              : defer;
          return action({
            stage: "flow.finalize",
            blocker: flowCommit.blocker,
            report: flowCommit.report,
          });
        }
        const committedFinalRows = io.resolveRepoPath(
          jsonRecord(flowCommit.finalizeReport.files).final_rows,
        );
        const finalRows = io.readRows(committedFinalRows);
        const committedFlowRows = finalRows.length > 0 ? finalRows : io.readRows(flowReadyRows);
        operations.recordVerifiedFlowRows({
          rows: committedFlowRows,
          processId,
          report: flowCommit.report,
          closeoutReportPath: flowCommit.handoff.closeoutReportPath,
          ledgerPath: paths.okFlows,
          verifiedFlows,
          verifiedRowsByKey: verifiedFlowRowsByKey,
        });
      }
    }

    const processPreDir = io.joinPath(scopeDir, "process-pre-finalize");
    const processPreReportPath = io.joinPath(
      processPreDir,
      "dataset-post-authoring-finalize-report.json",
    );
    const processPreArgs = operations.buildFinalizeArgs({
      type: "process",
      rowsFile: processClassifiedRows,
      outDir: processPreDir,
      ledgerDir,
      sourceSupportRowsFile: materialized.supportRowsFile,
      sourceRowsFile: materialized.sourceRowsFile,
      flowpropertyRowsFile: materialized.flowpropertyRowsFile,
      unitgroupRowsFile: materialized.unitgroupRowsFile,
      identityPreflightIndex: materialized.identityPreflightIndex,
      context: operations.defaultContext(paths.runDir, "process"),
      classificationQueue: materialized.classificationQueue,
      locationQueue: materialized.locationQueue,
      classificationApplyReport,
      locationApplyReport,
      identityApplyReports: flowIdentityReportsForProcess,
      targetUserId,
      stateCode,
    });
    const processPre = await operations.runFinalizeStage({
      stage: "process.pre_finalize",
      args: processPreArgs,
      reportPath: processPreReportPath,
      logDir,
    });
    stages.push(processPre);
    if (processPre.finalize_report_missing) {
      return fail({
        stage: "process.pre_finalize",
        blocker: operations.firstBlocker(
          processPre.json,
          "finalize_report_missing",
          "Process pre-finalize did not write the expected report.",
        ),
        report: processPreReportPath,
      });
    }
    const processPreReport = await operations.maybeCommitSupportThenRerunFinalize({
      type: "process",
      finalizeReport: processPre.json!,
      finalizeReportPath: processPreReportPath,
      finalizeArgs: processPreArgs,
      ledgerDir,
      scopeDir,
      logDir,
      stages,
      supportIdentityCacheFile: paths.supportIdentityCache,
    });
    let processRowsForE2e =
      io.resolveRepoPath(jsonRecord(processPreReport.files).final_rows) || processClassifiedRows;
    let processIdentityReport: string | null = null;
    let processPatchCollectReport: string | null = null;
    let processPatchApplyReport: string | null = null;
    if (processPreReport.status !== "ready_for_remote_write") {
      const processAuthoring = await operations.runIdentityAndPatch({
        type: "process",
        inputRowsFile: processRowsForE2e,
        preFinalizeReport: processPreReport,
        scopeDir,
        runDir: paths.runDir,
        logDir,
        stages,
      });
      if (processAuthoring.status !== "completed") {
        return defer({
          stage: "process.authoring",
          blocker: processAuthoring.blocker,
          report: processAuthoring.report ?? null,
        });
      }
      processRowsForE2e = processAuthoring.rowsFile;
      processIdentityReport = processAuthoring.identityApplyReport;
      processPatchCollectReport = processAuthoring.patchCollectReport;
      processPatchApplyReport = processAuthoring.patchApplyReport;
      const recoveryBlocker = operations.preFinalizeRecoveryBlocker({
        type: "process",
        finalizeReport: processPreReport,
        recovery: processAuthoring,
      });
      if (recoveryBlocker) {
        return defer({
          stage: "process.finalize",
          blocker: recoveryBlocker,
          report: processPreReportPath,
        });
      }
    }
    let processScopeReport = processPreReportPath;
    let processCloseoutReport: string | null = null;
    if (processPreReport.status === "ready_for_remote_write" && !processPatchApplyReport) {
      const handoffPlan = io.resolveRepoPath(
        jsonRecord(processPreReport.files).commit_handoff_plan,
      );
      const handoff = await operations.executeHandoff({
        handoffPlanPath: handoffPlan!,
        ledgerDir,
        outDir: io.joinPath(scopeDir, "process-handoff"),
        logDir,
        label: "process",
      });
      stages.push(...handoff.stages);
      if (handoff.status !== "completed") {
        return fail({
          stage: "process.commit",
          blocker: handoff.blockers[0] ?? {
            code: "process_handoff_failed",
            message: "Process commit/verify handoff failed.",
          },
          report: processPreReportPath,
        });
      }
      processCloseoutReport = handoff.closeoutReportPath ?? null;
    } else {
      const processCommit = await operations.finalizeAndCommitDataset({
        type: "process",
        rowsFile: processRowsForE2e,
        scopeDir,
        runDir: paths.runDir,
        materialized,
        classificationApplyReport,
        locationApplyReport,
        identityApplyReports: [...flowIdentityReportsForProcess, processIdentityReport].filter(
          (report): report is string => Boolean(report),
        ),
        patchCollectReport: processPatchCollectReport,
        patchApplyReport: processPatchApplyReport,
        targetUserId,
        stateCode,
        logDir,
        ledgerDir,
        stages,
        supportIdentityCacheFile: paths.supportIdentityCache,
      });
      if (processCommit.status === "failed") {
        return fail({
          stage: "process.commit",
          blocker: processCommit.blocker,
          report: processCommit.report,
        });
      }
      if (processCommit.status !== "completed") {
        const action =
          operations.categoryForBlocker(processCommit.blocker.code) === "remote-write"
            ? fail
            : defer;
        return action({
          stage: "process.finalize",
          blocker: processCommit.blocker,
          report: processCommit.report,
        });
      }
      processScopeReport = processCommit.report;
      processCloseoutReport = processCommit.handoff.closeoutReportPath ?? null;
    }
    const resumeContract = paths.resumeContractsByScopeKey.get(`${processId}@${processVersion}`);
    verifiedScopes.add(`${processId}@${processVersion}`);
    io.appendJsonLine(paths.okProcesses, {
      ...operations.okDatasetRow({
        type: "process",
        id: processId,
        version: processVersion,
        processId,
        report: processScopeReport,
        files: {
          process_finalize_report: io.repoRelative(processScopeReport),
          process_closeout_report: io.repoRelative(processCloseoutReport),
        },
      }),
      resume_contract: resumeContract ?? null,
    });
    io.appendJsonLine(paths.okScopes, {
      schema_version: 1,
      generated_at_utc: io.nowIso(),
      process_id: processId,
      process_version: processVersion,
      status: "verified",
      report: io.repoRelative(processScopeReport),
      rows: { flows: flowIds.length, processes: 1 },
      resume_contract: resumeContract ?? null,
    });
    io.appendJsonLine(paths.scopeCheckpoints, {
      ...checkpointBase,
      state: "verified",
      stages: stages.map((stage) => ({
        stage: stage.stage,
        exit_code: stage.exit_code,
        report: stage.report,
        stdout_log: stage.stdout_log,
        stderr_log: stage.stderr_log,
      })),
    });
    io.writeJson(io.joinPath(scopeDir, "scope-run-report.json"), {
      schema_version: 1,
      generated_at_utc: io.nowIso(),
      status: "verified",
      process_id: processId,
      process_version: processVersion,
      bafu_family_signature: operations.compactFamilySignature(familySignature, io.repoRelative),
      stages,
      files: {
        process_finalize_report: io.repoRelative(processScopeReport),
        process_closeout_report: io.repoRelative(processCloseoutReport),
      },
    });
    operations.trimVerifiedScopeScratch(scopeDir, options);
    return { status: "verified", stages };
  }

  return { runOneScope };
}

import type {
  BatchFinalizeArgsInput,
  BatchFinalizeContextPaths,
} from "../bafu-orchestration/batch-finalize-stage.ts";
import type { BatchPostWriteHandoffResult } from "./post-write-handoff.ts";
import type { IdentityPatchResult, RunIdentityAndPatchInput } from "./identity-patch-stage.ts";
import type { BatchScopeMaterializedRows } from "./scope-preparation.ts";

export interface BatchScopeFinalizeJsonRecord {
  [key: string]: unknown;
}

export interface BatchScopeFinalizeStageResult extends BatchScopeFinalizeJsonRecord {
  stage: string;
  json: BatchScopeFinalizeJsonRecord | null;
  finalize_report_missing?: unknown;
}

export interface BatchScopeFinalizeCommitInput {
  type: string;
  rowsFile: string;
  scopeDir: string;
  runDir: string;
  materialized: BatchScopeMaterializedRows;
  classificationApplyReport: string | null;
  locationApplyReport: string | null;
  identityApplyReports: string[];
  patchCollectReport: string | null;
  patchApplyReport: string | null;
  targetUserId: string;
  stateCode: number;
  logDir: string;
  ledgerDir: string;
  stages: BatchScopeFinalizeJsonRecord[];
  supportIdentityCacheFile: string;
}

export interface BatchScopeSupportFinalizeInput {
  type: string;
  finalizeReport: BatchScopeFinalizeJsonRecord;
  finalizeReportPath: string;
  finalizeArgs: string[];
  ledgerDir: string;
  scopeDir: string;
  logDir: string;
  stages: BatchScopeFinalizeJsonRecord[];
  supportIdentityCacheFile: string;
}

export interface BatchScopeCommitCompleted extends BatchScopeFinalizeJsonRecord {
  status: "completed";
  report: string;
  finalizeReport: BatchScopeFinalizeJsonRecord;
  handoff: BatchPostWriteHandoffResult;
}

export interface BatchScopeCommitBlocked extends BatchScopeFinalizeJsonRecord {
  status: "failed" | "blocked";
  blocker: BatchScopeFinalizeJsonRecord;
  report: string;
  finalizeReport: BatchScopeFinalizeJsonRecord | null;
  handoff?: BatchPostWriteHandoffResult;
}

export type BatchScopeCommitResult = BatchScopeCommitCompleted | BatchScopeCommitBlocked;

export interface BatchScopeFinalizeCommitAdapter {
  joinPath: (...parts: string[]) => string;
  nowIso: () => string;
  repoRelative: (filePath: string | null | undefined) => string | null;
  resolveRepoPath: (value: unknown) => string | null;
  fileExists: (filePath: string | null | undefined) => boolean;
  readJson: (filePath: string) => BatchScopeFinalizeJsonRecord;
  writeJson: (filePath: string, value: unknown) => void;
  buildFinalizeArgs: (input: BatchFinalizeArgsInput) => string[];
  runFinalizeStage: (input: {
    stage: string;
    args: string[];
    reportPath: string;
    logDir: string;
  }) => Promise<BatchScopeFinalizeStageResult>;
  executeHandoff: (input: {
    handoffPlanPath: string;
    ledgerDir: string;
    outDir: string;
    logDir: string;
    label: string;
  }) => Promise<BatchPostWriteHandoffResult>;
  runIdentityAndPatch: (input: RunIdentityAndPatchInput) => Promise<IdentityPatchResult>;
  supportIdentityKeysFromHandoffPlan: (handoffPlan: BatchScopeFinalizeJsonRecord) => string[];
  verifiedSupportIdentities: Set<string>;
  staleReusedSupportIdentityKeys: (
    finalizeReport: BatchScopeFinalizeJsonRecord,
    identityKeys: string[],
  ) => string[];
  appendSupportIdentityInvalidationRows: (input: {
    cacheFile: string;
    identityKeys: readonly string[];
    source: string;
    report: string;
  }) => unknown;
  appendSupportIdentityCacheRows: (input: {
    cacheFile: string;
    identityKeys: readonly string[];
    source: string;
    report: string | null;
  }) => unknown;
  firstBlocker: (
    report: BatchScopeFinalizeJsonRecord | null,
    fallbackCode: string,
    fallbackMessage: string,
  ) => BatchScopeFinalizeJsonRecord;
}

export interface BatchScopeFinalizeCommitService {
  maybeCommitSupportThenRerunFinalize: (
    input: BatchScopeSupportFinalizeInput,
  ) => Promise<BatchScopeFinalizeJsonRecord>;
  finalizeAndCommit: (input: BatchScopeFinalizeCommitInput) => Promise<BatchScopeCommitResult>;
  defaultContext: (runDir: string, type: string) => BatchFinalizeContextPaths;
}

function isJsonRecord(value: unknown): value is BatchScopeFinalizeJsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function jsonRecord(value: unknown): BatchScopeFinalizeJsonRecord {
  return isJsonRecord(value) ? value : {};
}

function recordArray(value: unknown): BatchScopeFinalizeJsonRecord[] {
  return Array.isArray(value) ? value.map(jsonRecord) : [];
}

export function createBatchScopeFinalizeCommitService(
  adapter: BatchScopeFinalizeCommitAdapter,
): BatchScopeFinalizeCommitService {
  let supportCommitQueue: Promise<unknown> = Promise.resolve();

  function defaultContext(runDir: string, type: string): BatchFinalizeContextPaths {
    return {
      schemaFile: adapter.joinPath(runDir, "context", type, "outputs", "schema.json"),
      yamlFile: adapter.joinPath(runDir, "context", type, "outputs", "methodology.yaml"),
      rulesetFile: adapter.joinPath(runDir, "context", type, "outputs", "runtime-ruleset.json"),
    };
  }

  async function maybeCommitSupportThenRerunFinalize({
    type,
    finalizeReport,
    finalizeReportPath,
    finalizeArgs,
    ledgerDir,
    scopeDir,
    logDir,
    stages,
    supportIdentityCacheFile,
  }: BatchScopeSupportFinalizeInput): Promise<BatchScopeFinalizeJsonRecord> {
    const supportPlan = adapter.resolveRepoPath(
      jsonRecord(finalizeReport.files).source_contact_support_commit_handoff_plan,
    );
    if (!adapter.fileExists(supportPlan)) return finalizeReport;
    const handoffPlan = adapter.readJson(supportPlan!);
    const supportIdentityKeys = adapter.supportIdentityKeysFromHandoffPlan(handoffPlan);
    const previousSupportCommit = supportCommitQueue;
    let releaseSupportCommit: () => void = () => {};
    supportCommitQueue = new Promise<void>((resolve) => {
      releaseSupportCommit = resolve;
    });
    await previousSupportCommit;
    let supportResult: BatchPostWriteHandoffResult | null = null;
    try {
      if (
        supportIdentityKeys.length > 0 &&
        supportIdentityKeys.every((identityKey) =>
          adapter.verifiedSupportIdentities.has(identityKey),
        )
      ) {
        const reuseDir = adapter.joinPath(scopeDir, `${type}-source-contact-support-handoff`);
        const reuseReportPath = adapter.joinPath(reuseDir, "reused-support-identities.json");
        adapter.writeJson(reuseReportPath, {
          schema_version: 1,
          generated_at_utc: adapter.nowIso(),
          status: "reused_verified_support_identities",
          handoff_plan: adapter.repoRelative(supportPlan),
          support_identity_cache: adapter.repoRelative(supportIdentityCacheFile),
          support_identities: supportIdentityKeys,
        });
        stages.push({
          stage: `${type}.support.reuse_verified`,
          status: "skipped",
          report: adapter.repoRelative(reuseReportPath),
          support_identities: supportIdentityKeys,
        });
        const rerun = await adapter.runFinalizeStage({
          stage: `${type}.finalize_after_support_reuse`,
          args: finalizeArgs,
          reportPath: finalizeReportPath,
          logDir,
        });
        stages.push(rerun);
        const staleKeys = adapter.staleReusedSupportIdentityKeys(rerun.json!, supportIdentityKeys);
        if (staleKeys.length === 0) return rerun.json!;
        for (const identityKey of staleKeys) {
          adapter.verifiedSupportIdentities.delete(identityKey);
        }
        adapter.appendSupportIdentityInvalidationRows({
          cacheFile: supportIdentityCacheFile,
          identityKeys: staleKeys,
          source: `${type}.support.reuse_invalidated`,
          report: finalizeReportPath,
        });
        stages.push({
          stage: `${type}.support.reuse_invalidated`,
          status: "invalidated_stale_support_identities",
          support_identities: staleKeys,
          report: adapter.repoRelative(finalizeReportPath),
        });
      }
      supportResult = await adapter.executeHandoff({
        handoffPlanPath: supportPlan!,
        ledgerDir,
        outDir: adapter.joinPath(scopeDir, `${type}-source-contact-support-handoff`),
        logDir,
        label: `${type}.support`,
      });
    } finally {
      releaseSupportCommit();
    }
    if (!supportResult) return finalizeReport;
    stages.push(...supportResult.stages);
    if (supportResult.status !== "completed") {
      return {
        ...finalizeReport,
        status: "blocked",
        blockers: [...supportResult.blockers, ...recordArray(finalizeReport.blockers)],
      };
    }
    for (const identityKey of supportIdentityKeys) {
      adapter.verifiedSupportIdentities.add(identityKey);
    }
    adapter.appendSupportIdentityCacheRows({
      cacheFile: supportIdentityCacheFile,
      identityKeys: supportIdentityKeys,
      source: `${type}.support_handoff`,
      report: supportResult.closeoutReportPath ?? null,
    });
    const rerun = await adapter.runFinalizeStage({
      stage: `${type}.finalize_after_support`,
      args: finalizeArgs,
      reportPath: finalizeReportPath,
      logDir,
    });
    stages.push(rerun);
    return rerun.json!;
  }

  async function finalizeAndCommit({
    type,
    rowsFile,
    scopeDir,
    runDir,
    materialized,
    classificationApplyReport,
    locationApplyReport,
    identityApplyReports,
    patchCollectReport,
    patchApplyReport,
    targetUserId,
    stateCode,
    logDir,
    ledgerDir,
    stages,
    supportIdentityCacheFile,
  }: BatchScopeFinalizeCommitInput): Promise<BatchScopeCommitResult> {
    const context = defaultContext(runDir, type);
    const finalizeDir = adapter.joinPath(scopeDir, `finalize-${type}-ready`);
    const finalizeReportPath = adapter.joinPath(
      finalizeDir,
      "dataset-post-authoring-finalize-report.json",
    );
    let currentRowsFile = rowsFile;
    const currentIdentityApplyReports = [...identityApplyReports];
    let currentPatchCollectReport = patchCollectReport;
    let currentPatchApplyReport = patchApplyReport;
    let finalizeReport: BatchScopeFinalizeJsonRecord | null = null;

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const finalizeArgs = adapter.buildFinalizeArgs({
        type,
        rowsFile: currentRowsFile,
        outDir: finalizeDir,
        ledgerDir,
        sourceSupportRowsFile: materialized.supportRowsFile,
        sourceRowsFile: materialized.sourceRowsFile,
        flowpropertyRowsFile: materialized.flowpropertyRowsFile,
        unitgroupRowsFile: materialized.unitgroupRowsFile,
        identityPreflightIndex: materialized.identityPreflightIndex,
        context,
        classificationQueue: materialized.classificationQueue,
        locationQueue: materialized.locationQueue,
        classificationApplyReport,
        locationApplyReport,
        identityApplyReports: currentIdentityApplyReports,
        patchCollectReport: currentPatchCollectReport,
        patchApplyReport: currentPatchApplyReport,
        targetUserId,
        stateCode,
      });
      const finalize = await adapter.runFinalizeStage({
        stage:
          attempt === 0
            ? `${type}.finalize_ready`
            : `${type}.finalize_ready_after_authoring_${attempt}`,
        args: finalizeArgs,
        reportPath: finalizeReportPath,
        logDir,
      });
      stages.push(finalize);
      if (finalize.finalize_report_missing) {
        finalizeReport = finalize.json!;
        return {
          status: "failed",
          blocker: adapter.firstBlocker(
            finalizeReport,
            "finalize_report_missing",
            `${type} finalize did not write the expected report.`,
          ),
          report: finalizeReportPath,
          finalizeReport,
        };
      }
      finalizeReport = await maybeCommitSupportThenRerunFinalize({
        type,
        finalizeReport: finalize.json!,
        finalizeReportPath,
        finalizeArgs,
        ledgerDir,
        scopeDir,
        logDir,
        stages,
        supportIdentityCacheFile,
      });
      if (finalizeReport.status === "ready_for_remote_write") break;
      const gateReport = adapter.resolveRepoPath(
        jsonRecord(finalizeReport.files).curation_gate_report,
      );
      if (!adapter.fileExists(gateReport)) break;
      const recovery = await adapter.runIdentityAndPatch({
        type,
        inputRowsFile: currentRowsFile,
        preFinalizeReport: finalizeReport,
        scopeDir,
        runDir,
        logDir,
        stages,
        label: `${type}-post-finalize-${attempt + 1}`,
        stagePrefix: `${type}.post_finalize_${attempt + 1}`,
      });
      if (recovery.status !== "completed") {
        return {
          status: "blocked",
          blocker: recovery.blocker,
          report: recovery.report ?? finalizeReportPath,
          finalizeReport,
        };
      }
      const producedEvidence =
        recovery.identityApplyReport || recovery.patchCollectReport || recovery.patchApplyReport;
      if (!producedEvidence) break;
      currentRowsFile = recovery.rowsFile;
      if (recovery.identityApplyReport) {
        currentIdentityApplyReports.push(recovery.identityApplyReport);
      }
      if (recovery.patchCollectReport) {
        currentPatchCollectReport = recovery.patchCollectReport;
      }
      if (recovery.patchApplyReport) currentPatchApplyReport = recovery.patchApplyReport;
    }

    if (finalizeReport?.status !== "ready_for_remote_write") {
      return {
        status: "blocked",
        blocker: adapter.firstBlocker(
          finalizeReport,
          `${type}_finalize_not_ready`,
          `${type} finalize status is ${finalizeReport?.status || "missing"}.`,
        ),
        report: finalizeReportPath,
        finalizeReport,
      };
    }
    const handoffPlan = adapter.resolveRepoPath(
      jsonRecord(finalizeReport.files).commit_handoff_plan,
    );
    const handoff = await adapter.executeHandoff({
      handoffPlanPath: handoffPlan!,
      ledgerDir,
      outDir: adapter.joinPath(scopeDir, `${type}-handoff`),
      logDir,
      label: type,
    });
    stages.push(...handoff.stages);
    if (handoff.status !== "completed") {
      return {
        status: "failed",
        blocker: handoff.blockers[0] ?? {
          code: `${type}_handoff_failed`,
          message: `${type} commit/verify handoff failed.`,
        },
        report: finalizeReportPath,
        finalizeReport,
        handoff,
      };
    }
    return {
      status: "completed",
      report: finalizeReportPath,
      finalizeReport,
      handoff,
    };
  }

  return { maybeCommitSupportThenRerunFinalize, finalizeAndCommit, defaultContext };
}

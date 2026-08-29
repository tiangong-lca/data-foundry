import path from "node:path";

import { canonicalDescriptionPair as descriptionPair } from "../canonical-description.ts";
import type {
  CarryForwardResult,
  MergeCompletedReusableIdentityDecisionsInput,
} from "../bafu-orchestration/identity-decision-carry-forward.ts";

export type IdentityPatchJsonRecord = Record<string, unknown>;
export type IdentityPatchCarryForwardResult = CarryForwardResult;
export interface IdentityPatchStageResult extends IdentityPatchJsonRecord {
  readonly stage: string;
  readonly json: IdentityPatchJsonRecord | null;
}

export interface IdentityPatchRunArgvStageInput {
  readonly stage: string;
  readonly argv: string[];
  readonly logDir: string;
  readonly reportPath?: unknown;
}

export interface IdentityPatchTaskFilterInput {
  readonly taskManifest: unknown;
  readonly rowsFile: unknown;
  readonly type: string;
  readonly reportPath?: unknown;
}

export interface IdentityPatchUnresolvedReferenceInput {
  readonly type: string;
  readonly report: IdentityPatchJsonRecord;
}

export interface IdentityPatchStageAdapter {
  readonly processExecPath: string;
  readonly foundryEntryPath: string;
  readonly activeProfile: () => string;
  readonly bafuAutofillEnabled: () => boolean;
  readonly resolveRepoPath: (value: unknown) => string | null;
  readonly repoRelative: (filePath: string) => string;
  readonly fileExists: (filePath: string | null | undefined) => boolean;
  readonly foundryCommand: (command: string, options?: IdentityPatchJsonRecord) => string[];
  readonly runArgvStage: (
    input: IdentityPatchRunArgvStageInput,
  ) => Promise<IdentityPatchStageResult>;
  readonly statusIs: (report: IdentityPatchJsonRecord | null, values: string[]) => boolean;
  readonly firstBlocker: (
    report: IdentityPatchJsonRecord | null,
    fallbackCode: string,
    fallbackMessage: string,
  ) => IdentityPatchJsonRecord;
  readonly reportFile: (
    stageJson: IdentityPatchJsonRecord | null,
    fallback: string,
  ) => string | null;
  readonly mergeCompletedReusableIdentityDecisions: (
    input: MergeCompletedReusableIdentityDecisionsInput,
  ) => CarryForwardResult;
  readonly identityUnresolvedReferenceBlocker: (
    input: IdentityPatchUnresolvedReferenceInput,
  ) => IdentityPatchJsonRecord | null;
  readonly filterAuthoringTaskManifestToRows: (
    input: IdentityPatchTaskFilterInput,
  ) => IdentityPatchJsonRecord;
  readonly writeJsonLines: (filePath: string, rows: readonly unknown[]) => void;
}

export interface RunIdentityAndPatchInput {
  readonly type: string;
  readonly inputRowsFile: string;
  readonly preFinalizeReport: IdentityPatchJsonRecord;
  readonly scopeDir: string;
  readonly runDir: string;
  readonly logDir: string;
  readonly stages: IdentityPatchJsonRecord[];
  readonly label?: string;
  readonly stagePrefix?: string;
  readonly resolutionRewriteRows?: IdentityPatchJsonRecord[];
  readonly applyResolutionRewritesMode?: boolean;
}

export interface IdentityPatchCompleted extends IdentityPatchJsonRecord {
  readonly status: "completed";
  readonly rowsFile: string;
  readonly identityApplyReport: string | null;
  readonly patchCollectReport: string | null;
  readonly patchApplyReport: string | null;
}

export interface IdentityPatchBlocked extends IdentityPatchJsonRecord {
  readonly status: "blocked";
  readonly blocker: IdentityPatchJsonRecord;
  readonly report?: string | null;
}

export type IdentityPatchResult = IdentityPatchCompleted | IdentityPatchBlocked;

export interface IdentityPatchStageService {
  readonly runIdentityAndPatch: (input: RunIdentityAndPatchInput) => Promise<IdentityPatchResult>;
}

function isJsonRecord(value: unknown): value is IdentityPatchJsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function jsonRecord(value: unknown): IdentityPatchJsonRecord {
  return isJsonRecord(value) ? value : {};
}

function asText(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

export function createIdentityPatchStageService(
  adapter: IdentityPatchStageAdapter,
): IdentityPatchStageService {
  async function runIdentityAndPatch({
    type,
    inputRowsFile,
    preFinalizeReport,
    scopeDir,
    runDir,
    logDir,
    stages,
    label = type,
    stagePrefix = type,
    resolutionRewriteRows = undefined,
    applyResolutionRewritesMode = false,
  }: RunIdentityAndPatchInput): Promise<IdentityPatchResult> {
    const gateReport = adapter.resolveRepoPath(
      jsonRecord(preFinalizeReport.files).curation_gate_report,
    );
    if (!adapter.fileExists(gateReport)) {
      return {
        status: "blocked",
        blocker: {
          code: `${type}_curation_gate_report_missing`,
          message: `${type} curation gate report is required for identity and patch authoring.`,
        },
      };
    }

    const identityTaskDir = path.join(scopeDir, `${label}-identity-task`);
    const identityTask = await adapter.runArgvStage({
      stage: `${stagePrefix}.identity_task`,
      argv: adapter.foundryCommand("dataset-identity-decision-task-build", {
        curationGateReport: adapter.repoRelative(gateReport!),
        outDir: adapter.repoRelative(identityTaskDir),
        sharedContextCacheDir: adapter.repoRelative(path.join(runDir, "shared-context-cache")),
      }),
      logDir,
      reportPath: path.join(identityTaskDir, "identity-decision-task-report.json"),
    });
    stages.push(identityTask);
    if (
      !adapter.statusIs(identityTask.json, [
        "ready_for_ai_identity_decisions",
        "ready_no_identity_actions",
      ])
    ) {
      return {
        status: "blocked",
        blocker: adapter.firstBlocker(
          identityTask.json,
          `${type}_identity_task_not_ready`,
          `${type} identity task did not become ready.`,
        ),
        report: adapter.reportFile(
          identityTask.json,
          path.join(identityTaskDir, "identity-decision-task-report.json"),
        ),
      };
    }

    let identityApplyReport = null;
    let identityOutputRows = inputRowsFile;
    const identityDecisions = path.join(identityTaskDir, "identity-decisions.jsonl");
    if (
      adapter.bafuAutofillEnabled() &&
      adapter.statusIs(identityTask.json, ["ready_for_ai_identity_decisions"])
    ) {
      const identityAutofill = await adapter.runArgvStage({
        stage: `${stagePrefix}.identity_autofill`,
        argv: adapter.foundryCommand("dataset-bafu-identity-decisions-autofill", {
          identityDecisionTask: adapter.repoRelative(
            path.join(identityTaskDir, "identity-decision-task.json"),
          ),
        }),
        logDir,
        reportPath: path.join(identityTaskDir, "bafu-identity-decisions-autofill-report.json"),
      });
      stages.push(identityAutofill);
      if (!adapter.statusIs(identityAutofill.json, ["completed", "completed_with_manual_review"])) {
        return {
          status: "blocked",
          blocker: adapter.firstBlocker(
            identityAutofill.json,
            `${type}_identity_autofill_not_completed`,
            `${type} identity autofill did not complete.`,
          ),
          report: adapter.reportFile(
            identityAutofill.json,
            path.join(identityTaskDir, "bafu-identity-decisions-autofill-report.json"),
          ),
        };
      }
      const carryForward = adapter.mergeCompletedReusableIdentityDecisions({
        runDir,
        decisionsFile: identityDecisions,
        outDir: identityTaskDir,
        datasetType: type,
        rowsFile: inputRowsFile,
        curationGateReport: gateReport,
      });
      stages.push({
        stage: `${stagePrefix}.identity_decision_carry_forward`,
        status: carryForward.report.status,
        report: adapter.repoRelative(carryForward.reportPath),
        replacements: carryForward.report.counts.replacements,
        additions: carryForward.report.counts.additions,
        conflicts: carryForward.report.counts.conflicts,
      });
      const identityApplyDir = path.join(scopeDir, `${label}-identity-apply`);
      const identityApply = await adapter.runArgvStage({
        stage: `${stagePrefix}.identity_apply`,
        argv: adapter.foundryCommand("dataset-identity-decisions-apply", {
          type,
          profile: adapter.activeProfile(),
          rowsFile: adapter.repoRelative(inputRowsFile),
          decisions: adapter.repoRelative(carryForward.outputFile),
          outDir: adapter.repoRelative(identityApplyDir),
          authoringPackageDir: adapter.repoRelative(
            path.join(identityTaskDir, "authoring-package-snapshots"),
          ),
        }),
        logDir,
        reportPath: path.join(identityApplyDir, "identity-decisions-apply-report.json"),
      });
      stages.push(identityApply);
      identityApplyReport = adapter.reportFile(
        identityApply.json,
        path.join(identityApplyDir, "identity-decisions-apply-report.json"),
      );
      if (!adapter.statusIs(identityApply.json, ["completed"])) {
        return {
          status: "blocked",
          blocker: adapter.firstBlocker(
            identityApply.json,
            `${type}_identity_apply_not_completed`,
            `${type} identity decisions did not apply cleanly.`,
          ),
          report: identityApplyReport,
        };
      }
      const unresolvedReferenceBlocker = adapter.identityUnresolvedReferenceBlocker({
        type,
        report: identityApply.json!,
      });
      if (unresolvedReferenceBlocker) {
        return {
          status: "blocked",
          blocker: unresolvedReferenceBlocker,
          report: identityApplyReport,
        };
      }
      identityOutputRows =
        adapter.resolveRepoPath(jsonRecord(identityApply.json?.files).output_rows) ??
        identityOutputRows;
    } else if (
      applyResolutionRewritesMode &&
      type === "flow" &&
      resolutionRewriteRows &&
      resolutionRewriteRows.length > 0
    ) {
      const distinctBySourceFlow = new Map<string, IdentityPatchJsonRecord>();
      for (const rewrite of resolutionRewriteRows) {
        const sourceFlowId = asText(rewrite.source_flow_id);
        if (!sourceFlowId) continue;
        const sourceFlowVersion = asText(rewrite.source_flow_version) || "00.00.001";
        const key = `${sourceFlowId}@@${sourceFlowVersion}`;
        if (distinctBySourceFlow.has(key)) continue;
        const description = descriptionPair(rewrite.canonical_short_description, asText).ledger;
        distinctBySourceFlow.set(key, {
          schema_version: 1,
          dataset_type: "flow",
          dataset_id: sourceFlowId,
          dataset_version: sourceFlowVersion,
          decision: "reuse_existing_reference",
          identity_decision: "reuse_existing_reference",
          decision_status: "completed",
          canonical: {
            table: "flows",
            ref_object_id: asText(rewrite.canonical_flow_id),
            version: asText(rewrite.canonical_flow_version) || "00.00.001",
            short_description: description || undefined,
          },
          canonical_flow_id: asText(rewrite.canonical_flow_id),
          canonical_flow_version: asText(rewrite.canonical_flow_version) || "00.00.001",
          canonical_short_description: description || undefined,
          basis:
            "Applied from library-resolution exchange-reference-rewrites (deterministic physical-equivalence reuse).",
          evidence: {
            source: "library-resolution",
            artifact: "exchange-reference-rewrites.jsonl",
            process_id: asText(rewrite.process_id),
            exchange_index: rewrite.exchange_index ?? null,
          },
          used_context_kinds: ["schema", "methodology_yaml", "ruleset", "library_resolution"],
          closes_action_items: [
            "identity_preflight_manual_review",
            "elementary_flow_identity_manual_review",
          ],
          confidence: "high",
        });
      }
      const resolutionDecisions = [...distinctBySourceFlow.values()];
      const resolutionDecisionsFile = path.join(
        identityTaskDir,
        "identity-decisions.resolution.jsonl",
      );
      adapter.writeJsonLines(resolutionDecisionsFile, resolutionDecisions);
      stages.push({
        stage: `${stagePrefix}.identity_resolution_rewrites`,
        status: "completed",
        reuse_count: resolutionDecisions.length,
        report: adapter.repoRelative(resolutionDecisionsFile),
      });
      const identityApplyDir = path.join(scopeDir, `${label}-identity-apply`);
      const identityApply = await adapter.runArgvStage({
        stage: `${stagePrefix}.identity_apply`,
        argv: adapter.foundryCommand("dataset-identity-decisions-apply", {
          type,
          profile: adapter.activeProfile(),
          rowsFile: adapter.repoRelative(inputRowsFile),
          decisions: adapter.repoRelative(resolutionDecisionsFile),
          outDir: adapter.repoRelative(identityApplyDir),
        }),
        logDir,
        reportPath: path.join(identityApplyDir, "identity-decisions-apply-report.json"),
      });
      stages.push(identityApply);
      identityApplyReport = adapter.reportFile(
        identityApply.json,
        path.join(identityApplyDir, "identity-decisions-apply-report.json"),
      );
      if (!adapter.statusIs(identityApply.json, ["completed"])) {
        return {
          status: "blocked",
          blocker: adapter.firstBlocker(
            identityApply.json,
            `${type}_identity_apply_not_completed`,
            `${type} identity decisions did not apply cleanly.`,
          ),
          report: identityApplyReport,
        };
      }
      const unresolvedReferenceBlocker = adapter.identityUnresolvedReferenceBlocker({
        type,
        report: identityApply.json!,
      });
      if (unresolvedReferenceBlocker) {
        return {
          status: "blocked",
          blocker: unresolvedReferenceBlocker,
          report: identityApplyReport,
        };
      }
      identityOutputRows =
        adapter.resolveRepoPath(jsonRecord(identityApply.json?.files).output_rows) ??
        identityOutputRows;
    } else {
      const carryForward = adapter.mergeCompletedReusableIdentityDecisions({
        runDir,
        decisionsFile: identityDecisions,
        outDir: identityTaskDir,
        datasetType: type,
        rowsFile: inputRowsFile,
        curationGateReport: gateReport,
      });
      stages.push({
        stage: `${stagePrefix}.identity_decision_carry_forward`,
        status: carryForward.report.status,
        report: adapter.repoRelative(carryForward.reportPath),
        replacements: carryForward.report.counts.replacements,
        additions: carryForward.report.counts.additions,
        conflicts: carryForward.report.counts.conflicts,
      });
      if (carryForward.report.counts.additions > 0 || carryForward.report.counts.replacements > 0) {
        const identityApplyDir = path.join(scopeDir, `${label}-identity-apply`);
        const identityApply = await adapter.runArgvStage({
          stage: `${stagePrefix}.identity_apply`,
          argv: adapter.foundryCommand("dataset-identity-decisions-apply", {
            type,
            profile: adapter.activeProfile(),
            rowsFile: adapter.repoRelative(inputRowsFile),
            decisions: adapter.repoRelative(carryForward.outputFile),
            outDir: adapter.repoRelative(identityApplyDir),
          }),
          logDir,
          reportPath: path.join(identityApplyDir, "identity-decisions-apply-report.json"),
        });
        stages.push(identityApply);
        identityApplyReport = adapter.reportFile(
          identityApply.json,
          path.join(identityApplyDir, "identity-decisions-apply-report.json"),
        );
        if (!adapter.statusIs(identityApply.json, ["completed"])) {
          return {
            status: "blocked",
            blocker: adapter.firstBlocker(
              identityApply.json,
              `${type}_identity_apply_not_completed`,
              `${type} identity decisions did not apply cleanly.`,
            ),
            report: identityApplyReport,
          };
        }
        const unresolvedReferenceBlocker = adapter.identityUnresolvedReferenceBlocker({
          type,
          report: identityApply.json!,
        });
        if (unresolvedReferenceBlocker) {
          return {
            status: "blocked",
            blocker: unresolvedReferenceBlocker,
            report: identityApplyReport,
          };
        }
        identityOutputRows =
          adapter.resolveRepoPath(jsonRecord(identityApply.json?.files).output_rows) ??
          identityOutputRows;
      }
    }

    const authoringDir = path.join(scopeDir, `${label}-authoring-tasks`);
    const taskManifest = path.join(authoringDir, "authoring-task-manifest.json");
    const taskBuild = await adapter.runArgvStage({
      stage: `${stagePrefix}.authoring_task`,
      argv: adapter.foundryCommand("dataset-authoring-task-build", {
        curationGateReport: adapter.repoRelative(gateReport!),
        outDir: adapter.repoRelative(authoringDir),
        sharedContextCacheDir: adapter.repoRelative(path.join(runDir, "shared-context-cache")),
      }),
      logDir,
      reportPath: taskManifest,
    });
    stages.push(taskBuild);
    if (
      !adapter.statusIs(taskBuild.json, ["ready_for_ai_authoring_batch", "ready_no_action_items"])
    ) {
      return {
        status: "blocked",
        blocker: adapter.firstBlocker(
          taskBuild.json,
          `${type}_authoring_task_not_ready`,
          `${type} authoring task did not become ready.`,
        ),
        report: adapter.reportFile(taskBuild.json, taskManifest),
      };
    }
    if (adapter.statusIs(taskBuild.json, ["ready_no_action_items"])) {
      return {
        status: "completed",
        rowsFile: identityOutputRows,
        identityApplyReport,
        patchCollectReport: null,
        patchApplyReport: null,
      };
    }

    const taskFilter = adapter.filterAuthoringTaskManifestToRows({
      taskManifest,
      rowsFile: identityOutputRows,
      type,
      reportPath: path.join(authoringDir, "authoring-task-filter-report.json"),
    });
    const activeTaskManifest = asText(taskFilter.taskManifest);
    if (taskFilter.status === "ready_no_action_items") {
      return {
        status: "completed",
        rowsFile: identityOutputRows,
        identityApplyReport,
        patchCollectReport: null,
        patchApplyReport: null,
      };
    }

    if (!adapter.bafuAutofillEnabled()) {
      return {
        status: "blocked",
        blocker: {
          code: `${type}_authoring_action_items_require_authoring`,
          message: `${type} scope has authoring action items but BAFU patch autofill is disabled for this profile; author the fields explicitly before commit.`,
        },
        report: adapter.reportFile(taskBuild.json, taskManifest),
      };
    }
    const patchAutofill = await adapter.runArgvStage({
      stage: `${stagePrefix}.patch_autofill`,
      argv: adapter.foundryCommand("dataset-bafu-authoring-patches-autofill", {
        taskManifest: adapter.repoRelative(activeTaskManifest),
      }),
      logDir,
      reportPath: path.join(authoringDir, "bafu-authoring-patches-autofill-report.json"),
    });
    stages.push(patchAutofill);
    if (!adapter.statusIs(patchAutofill.json, ["completed", "completed_no_supported_patches"])) {
      return {
        status: "blocked",
        blocker: adapter.firstBlocker(
          patchAutofill.json,
          `${type}_patch_autofill_not_completed`,
          `${type} patch autofill did not complete.`,
        ),
        report: adapter.reportFile(
          patchAutofill.json,
          path.join(authoringDir, "bafu-authoring-patches-autofill-report.json"),
        ),
      };
    }

    const patchCollect = await adapter.runArgvStage({
      stage: `${stagePrefix}.patch_collect`,
      argv: adapter.foundryCommand("dataset-authoring-patch-collect", {
        taskManifest: adapter.repoRelative(activeTaskManifest),
      }),
      logDir,
      reportPath: path.join(authoringDir, "authoring-patch-collect-report.json"),
    });
    stages.push(patchCollect);
    const patchCollectReport = adapter.reportFile(
      patchCollect.json,
      path.join(authoringDir, "authoring-patch-collect-report.json"),
    );
    if (
      !adapter.statusIs(patchCollect.json, ["ready_for_patch_apply", "ready_no_patch_required"])
    ) {
      return {
        status: "blocked",
        blocker: adapter.firstBlocker(
          patchCollect.json,
          `${type}_patch_collect_not_ready`,
          `${type} patch collection did not become ready.`,
        ),
        report: patchCollectReport,
      };
    }
    if (adapter.statusIs(patchCollect.json, ["ready_no_patch_required"])) {
      return {
        status: "completed",
        rowsFile: identityOutputRows,
        identityApplyReport,
        patchCollectReport,
        patchApplyReport: null,
      };
    }

    const patchedRowsFile = path.join(
      authoringDir,
      `${type === "flow" ? "flows" : "processes"}.patched.jsonl`,
    );
    const patchApplyDir = path.join(authoringDir, "patch-apply");
    const patchApply = await adapter.runArgvStage({
      stage: `${stagePrefix}.patch_apply`,
      argv: [
        adapter.processExecPath,
        adapter.foundryEntryPath,
        "dataset-patch-apply",
        "--input",
        adapter.repoRelative(identityOutputRows),
        "--patch",
        adapter.repoRelative(
          asText(jsonRecord(patchCollect.json?.files).batch_patch) ||
            path.join(authoringDir, "ai-patches.batch.json"),
        ),
        "--out",
        adapter.repoRelative(patchedRowsFile),
        "--out-dir",
        adapter.repoRelative(patchApplyDir),
        "--authoring-package-dir",
        adapter.repoRelative(path.join(authoringDir, "authoring-package-snapshots")),
        "--require-authoring-package",
        "--require-action-item-closure",
      ],
      logDir,
      reportPath: path.join(patchApplyDir, "outputs", "dataset-patch-apply-report.json"),
    });
    stages.push(patchApply);
    const patchApplyReport = adapter.reportFile(
      patchApply.json,
      path.join(patchApplyDir, "outputs", "dataset-patch-apply-report.json"),
    );
    if (!adapter.statusIs(patchApply.json, ["completed"])) {
      return {
        status: "blocked",
        blocker: adapter.firstBlocker(
          patchApply.json,
          `${type}_patch_apply_not_completed`,
          `${type} patch apply did not complete.`,
        ),
        report: patchApplyReport,
      };
    }
    return {
      status: "completed",
      rowsFile:
        adapter.resolveRepoPath(jsonRecord(patchApply.json?.files).patched_rows) ?? patchedRowsFile,
      identityApplyReport,
      patchCollectReport,
      patchApplyReport,
    };
  }

  return { runIdentityAndPatch };
}

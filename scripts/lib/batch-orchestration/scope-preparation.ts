import type { SchemaPaths } from "../bafu-classification/schema-repair.ts";
import type { BatchFinalizeContextPaths } from "../bafu-orchestration/batch-finalize-stage.ts";

type JsonRecord = Record<string, unknown>;

export interface BatchScopeMaterializedRows {
  flowRowsFile: string | null;
  processRowsFile: string | null;
  sourceRowsFile: string | null;
  supportRowsFile: string | null;
  flowpropertyRowsFile: string | null;
  unitgroupRowsFile: string | null;
  classificationQueue: string | null;
  locationQueue: string | null;
  identityPreflightIndex: string | null;
}

export interface BatchScopePreparationPaths {
  runDir: string;
  processBundlesDir: string;
  libraryClassificationDecisions: string | null;
}

export interface BatchScopePreparationInput {
  processId: string;
  scopeDir: string;
  logDir: string;
  stages: JsonRecord[];
  paths: BatchScopePreparationPaths;
  schemas: SchemaPaths;
}

export interface BatchScopePreparationCompleted {
  status: "completed";
  materialized: BatchScopeMaterializedRows;
  processClassifiedRows: string;
  flowRowsForFinalize: string | null;
  classificationApplyReport: string | null;
  locationApplyReport: string | null;
}

export interface BatchScopePreparationDeferred {
  status: "deferred";
  stage: string;
  blocker: JsonRecord;
  report: string | null;
}

export type BatchScopePreparationResult =
  BatchScopePreparationCompleted | BatchScopePreparationDeferred;

interface BatchScopeStageResult extends JsonRecord {
  json: JsonRecord | null;
}

interface ClassificationSchemaRepairResult {
  unresolved: unknown[];
  unresolvedPath: string;
}

export interface BatchScopePreparationIoAdapter {
  processExecPath: string;
  foundryEntryPath: string;
  joinPath: (...parts: string[]) => string;
  repoRelative: (filePath: string | null | undefined) => string;
  resolveRepoPath: (value: unknown) => string | null;
  fileExists: (filePath: string | null | undefined) => boolean;
  readJsonLines: (filePath: string | null | undefined) => JsonRecord[];
}

export interface BatchScopePreparationOperationAdapter {
  runArgvStage: (input: {
    stage: string;
    argv: string[];
    logDir: string;
    reportPath?: unknown;
  }) => Promise<BatchScopeStageResult>;
  foundryCommand: (command: string, options?: JsonRecord) => string[];
  activeProfile: () => string;
  libraryContact: () => JsonRecord;
  firstBlocker: (
    report: JsonRecord | null,
    fallbackCode: string,
    fallbackMessage: string,
  ) => JsonRecord;
  repairClassificationDecisionCodes: (input: {
    decisionsFile: string;
    schemas: SchemaPaths;
    outDir: string;
  }) => ClassificationSchemaRepairResult;
  defaultContext: (runDir: string, type: string) => BatchFinalizeContextPaths;
  reportFile: (stageJson: JsonRecord | null, fallback: string) => string | null;
  outputRowsByStem: (report: JsonRecord | null, stem: string) => string | null;
  findOneFile: (rootDir: unknown, pattern: RegExp) => string | null;
}

export interface BatchScopePreparationAdapter {
  io: BatchScopePreparationIoAdapter;
  operations: BatchScopePreparationOperationAdapter;
}

export interface BatchScopePreparationService {
  prepareScope: (input: BatchScopePreparationInput) => Promise<BatchScopePreparationResult>;
}

function isJsonRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function jsonRecord(value: unknown): JsonRecord {
  return isJsonRecord(value) ? value : {};
}

function recordArray(value: unknown): JsonRecord[] {
  return Array.isArray(value) ? value.map(jsonRecord) : [];
}

function statusIs(report: JsonRecord | null, values: string[]): boolean {
  return values.includes(String(report?.status || ""));
}

export function createBatchScopePreparationService(
  adapter: BatchScopePreparationAdapter,
): BatchScopePreparationService {
  const { io, operations } = adapter;

  async function prepareScope({
    processId,
    scopeDir,
    logDir,
    stages,
    paths,
    schemas,
  }: BatchScopePreparationInput): Promise<BatchScopePreparationResult> {
    const materializedDir = io.joinPath(scopeDir, "materialized");
    const materializeReportPath = io.joinPath(
      materializedDir,
      "dataset-bundle-sample-rows-report.json",
    );
    const materialize = await operations.runArgvStage({
      stage: "materialize",
      argv: operations.foundryCommand("dataset-bundle-sample-rows", {
        bundlesDir: io.repoRelative(paths.processBundlesDir),
        processId,
        outDir: io.repoRelative(materializedDir),
        profile: operations.activeProfile(),
        ...operations.libraryContact(),
      }),
      logDir,
      reportPath: materializeReportPath,
    });
    stages.push(materialize);
    const materializedReport = materialize.json;
    const fatalMaterializeBlocker = recordArray(materializedReport?.blockers).find((blocker) =>
      [
        "requested_process_bundle_missing",
        "bundle_row_identity_missing",
        "process_scope_dependency_unresolved",
      ].includes(String(blocker.code || "")),
    );
    if (!materializedReport || fatalMaterializeBlocker) {
      return {
        status: "deferred",
        stage: "materialize",
        blocker:
          fatalMaterializeBlocker ??
          operations.firstBlocker(
            materializedReport,
            "materialize_not_ready",
            "Bundle materialization failed.",
          ),
        report: materializeReportPath,
      };
    }

    const materializedFiles = jsonRecord(materializedReport.files);
    const materializedRowFiles = jsonRecord(materializedFiles.rows);
    const materialized: BatchScopeMaterializedRows = {
      flowRowsFile: io.resolveRepoPath(materializedRowFiles.flow),
      processRowsFile: io.resolveRepoPath(materializedRowFiles.process),
      sourceRowsFile: io.resolveRepoPath(materializedRowFiles.source),
      supportRowsFile: io.resolveRepoPath(materializedRowFiles.support),
      flowpropertyRowsFile: io.resolveRepoPath(materializedRowFiles.flowproperty),
      unitgroupRowsFile: io.resolveRepoPath(materializedRowFiles.unitgroup),
      classificationQueue: io.resolveRepoPath(materializedFiles.classification_authoring_queue),
      locationQueue: io.resolveRepoPath(materializedFiles.location_authoring_queue),
      identityPreflightIndex: io.resolveRepoPath(materializedFiles.identity_preflight_requests),
    };
    const materializedProcessRowsFile = materialized.processRowsFile;
    if (!materializedProcessRowsFile || !io.fileExists(materializedProcessRowsFile)) {
      return {
        status: "deferred",
        stage: "materialize",
        blocker: {
          code: "materialized_process_rows_missing",
          message: "Materialized process rows are missing.",
        },
        report: materializeReportPath,
      };
    }

    const classificationTaskDir = io.joinPath(scopeDir, "classification-task");
    const classificationTaskReportPath = io.joinPath(
      classificationTaskDir,
      "classification-decision-task-report.json",
    );
    const processContext = operations.defaultContext(paths.runDir, "process");
    const classificationTask = await operations.runArgvStage({
      stage: "classification.task",
      argv: [
        io.processExecPath,
        io.foundryEntryPath,
        "dataset-classification-decision-task-build",
        "--classification-queue",
        io.repoRelative(materialized.classificationQueue),
        "--schema-file",
        io.repoRelative(processContext.schemaFile),
        "--yaml-file",
        io.repoRelative(processContext.yamlFile),
        "--ruleset-file",
        io.repoRelative(processContext.rulesetFile),
        "--classification-schema",
        schemas.allClassification.map(io.repoRelative).join(","),
        "--location-schema",
        io.repoRelative(schemas.location),
        "--out-dir",
        io.repoRelative(classificationTaskDir),
        "--shared-context-cache-dir",
        io.repoRelative(io.joinPath(paths.runDir, "shared-context-cache")),
      ],
      logDir,
      reportPath: classificationTaskReportPath,
    });
    stages.push(classificationTask);
    if (
      !statusIs(classificationTask.json, [
        "ready_for_ai_classification_decisions",
        "ready_no_classification_actions",
      ])
    ) {
      return {
        status: "deferred",
        stage: "classification.task",
        blocker: operations.firstBlocker(
          classificationTask.json,
          "classification_task_not_ready",
          "Classification decision task did not become ready.",
        ),
        report: classificationTaskReportPath,
      };
    }

    let classificationApplyReport: string | null = null;
    let flowClassifiedRows = materialized.flowRowsFile;
    let processClassifiedRows = materializedProcessRowsFile;
    if (statusIs(classificationTask.json, ["ready_for_ai_classification_decisions"])) {
      const classificationProjectionDir = io.joinPath(scopeDir, "classification-projection");
      const projectionReportPath = io.joinPath(
        classificationProjectionDir,
        "dataset-library-classification-decisions-project-report.json",
      );
      const classificationProjection = await operations.runArgvStage({
        stage: "classification.project",
        argv: operations.foundryCommand("dataset-library-classification-decisions-project", {
          classificationQueue: io.repoRelative(materialized.classificationQueue),
          libraryDecisions: io.repoRelative(paths.libraryClassificationDecisions),
          decisionTask: io.repoRelative(
            io.joinPath(classificationTaskDir, "classification-decision-task.json"),
          ),
          outDir: io.repoRelative(classificationProjectionDir),
        }),
        logDir,
        reportPath: projectionReportPath,
      });
      stages.push(classificationProjection);
      if (!statusIs(classificationProjection.json, ["completed", "completed_with_manual_review"])) {
        return {
          status: "deferred",
          stage: "classification.project",
          blocker: operations.firstBlocker(
            classificationProjection.json,
            "classification_projection_not_completed",
            "Library classification decisions could not be projected to this scope.",
          ),
          report: projectionReportPath,
        };
      }
      const schemaRepair = operations.repairClassificationDecisionCodes({
        decisionsFile: io.joinPath(classificationProjectionDir, "classification-decisions.jsonl"),
        schemas,
        outDir: classificationProjectionDir,
      });
      if (schemaRepair.unresolved.length > 0) {
        return {
          status: "deferred",
          stage: "classification.schema_repair",
          blocker: {
            code: "classification_decision_code_invalid",
            message:
              "Projected classification decisions contain codes that are not valid in the bundled TIDAS category schema.",
            manual_review_rows: io.repoRelative(schemaRepair.unresolvedPath),
          },
          report: projectionReportPath,
        };
      }
      const manualRows = io.joinPath(
        classificationProjectionDir,
        "classification-decisions.manual-review.jsonl",
      );
      if (io.readJsonLines(manualRows).length > 0) {
        return {
          status: "deferred",
          stage: "classification.project",
          blocker: {
            code: "classification_requires_human_review",
            message:
              "This scope still has classification decisions without a completed library-level decision.",
            manual_review_rows: io.repoRelative(manualRows),
          },
          report: projectionReportPath,
        };
      }

      const classificationApplyDir = io.joinPath(scopeDir, "classification-apply");
      const classificationApplyReportPath = io.joinPath(
        classificationApplyDir,
        "classification-decisions-apply-report.json",
      );
      const classificationApply = await operations.runArgvStage({
        stage: "classification.apply",
        argv: operations.foundryCommand("dataset-classification-decisions-apply", {
          classificationQueue: io.repoRelative(materialized.classificationQueue),
          decisions: io.repoRelative(
            io.joinPath(classificationProjectionDir, "classification-decisions.jsonl"),
          ),
          decisionTask: io.repoRelative(
            io.joinPath(classificationTaskDir, "classification-decision-task.json"),
          ),
          outDir: io.repoRelative(classificationApplyDir),
        }),
        logDir,
        reportPath: classificationApplyReportPath,
      });
      stages.push(classificationApply);
      classificationApplyReport = operations.reportFile(
        classificationApply.json,
        classificationApplyReportPath,
      );
      if (!statusIs(classificationApply.json, ["completed"])) {
        return {
          status: "deferred",
          stage: "classification.apply",
          blocker: operations.firstBlocker(
            classificationApply.json,
            "classification_apply_not_completed",
            "Classification decisions did not apply cleanly.",
          ),
          report: classificationApplyReport,
        };
      }
      flowClassifiedRows =
        operations.outputRowsByStem(classificationApply.json, "flows.") || flowClassifiedRows;
      processClassifiedRows =
        operations.outputRowsByStem(classificationApply.json, "processes.") ||
        processClassifiedRows;
    }

    let flowRowsForFinalize = flowClassifiedRows;
    let locationApplyReport: string | null = null;
    if (
      io.fileExists(materialized.locationQueue) &&
      io.readJsonLines(materialized.locationQueue).length > 0 &&
      io.fileExists(flowClassifiedRows)
    ) {
      const locationTaskDir = io.joinPath(scopeDir, "location-task");
      const locationTaskReportPath = io.joinPath(
        locationTaskDir,
        "location-decision-task-report.json",
      );
      const flowContext = operations.defaultContext(paths.runDir, "flow");
      const locationTask = await operations.runArgvStage({
        stage: "location.task",
        argv: [
          io.processExecPath,
          io.foundryEntryPath,
          "dataset-location-decision-task-build",
          "--location-queue",
          io.repoRelative(materialized.locationQueue),
          "--rows-file",
          io.repoRelative(flowClassifiedRows),
          "--schema-file",
          io.repoRelative(flowContext.schemaFile),
          "--yaml-file",
          io.repoRelative(flowContext.yamlFile),
          "--ruleset-file",
          io.repoRelative(flowContext.rulesetFile),
          "--classification-schema",
          io.repoRelative(schemas.flowProductCategory),
          "--location-schema",
          io.repoRelative(schemas.location),
          "--out-dir",
          io.repoRelative(locationTaskDir),
          "--shared-context-cache-dir",
          io.repoRelative(io.joinPath(paths.runDir, "shared-context-cache")),
        ],
        logDir,
        reportPath: locationTaskReportPath,
      });
      stages.push(locationTask);
      if (
        !statusIs(locationTask.json, [
          "ready_for_ai_location_decisions",
          "ready_no_location_actions",
        ])
      ) {
        return {
          status: "deferred",
          stage: "location.task",
          blocker: operations.firstBlocker(
            locationTask.json,
            "location_task_not_ready",
            "Location task did not become ready.",
          ),
          report: locationTaskReportPath,
        };
      }
      if (statusIs(locationTask.json, ["ready_for_ai_location_decisions"])) {
        const locationDecisionDir = io.joinPath(scopeDir, "location-decisions");
        const suggestReportPath = io.joinPath(
          locationDecisionDir,
          "dataset-location-decisions-suggest-report.json",
        );
        const suggestTaskQueue =
          operations.findOneFile(locationTaskDir, /^location-authoring-queue\..*\.jsonl$/u) ||
          materialized.locationQueue;
        const locationSuggest = await operations.runArgvStage({
          stage: "location.suggest",
          argv: operations.foundryCommand("dataset-location-decisions-suggest", {
            locationQueue: io.repoRelative(suggestTaskQueue),
            decisionTask: io.repoRelative(
              io.joinPath(locationTaskDir, "location-decision-task.json"),
            ),
            locationSchema: io.repoRelative(schemas.location),
            outDir: io.repoRelative(locationDecisionDir),
          }),
          logDir,
          reportPath: suggestReportPath,
        });
        stages.push(locationSuggest);
        if (!statusIs(locationSuggest.json, ["completed", "completed_with_manual_review"])) {
          return {
            status: "deferred",
            stage: "location.suggest",
            blocker: operations.firstBlocker(
              locationSuggest.json,
              "location_suggest_not_completed",
              "Location decisions could not be suggested.",
            ),
            report: suggestReportPath,
          };
        }
        const manualRows = io.joinPath(
          locationDecisionDir,
          "location-decisions.manual-review.jsonl",
        );
        if (io.readJsonLines(manualRows).length > 0) {
          return {
            status: "deferred",
            stage: "location.suggest",
            blocker: {
              code: "location_requires_human_review",
              message:
                "This scope still has location decisions without one provable TIDAS location code.",
              manual_review_rows: io.repoRelative(manualRows),
            },
            report: suggestReportPath,
          };
        }
        const taskQueue =
          operations.findOneFile(locationTaskDir, /^location-authoring-queue\..*\.jsonl$/u) ||
          materialized.locationQueue;
        const locationApplyDir = io.joinPath(scopeDir, "location-apply");
        const locationApplyReportPath = io.joinPath(
          locationApplyDir,
          "location-decisions-apply-report.json",
        );
        const locationApply = await operations.runArgvStage({
          stage: "location.apply",
          argv: operations.foundryCommand("dataset-location-decisions-apply", {
            locationQueue: io.repoRelative(taskQueue),
            decisions: io.repoRelative(
              io.joinPath(locationDecisionDir, "location-decisions.jsonl"),
            ),
            decisionTask: io.repoRelative(
              io.joinPath(locationTaskDir, "location-decision-task.json"),
            ),
            outDir: io.repoRelative(locationApplyDir),
          }),
          logDir,
          reportPath: locationApplyReportPath,
        });
        stages.push(locationApply);
        locationApplyReport = operations.reportFile(locationApply.json, locationApplyReportPath);
        if (!statusIs(locationApply.json, ["completed"])) {
          return {
            status: "deferred",
            stage: "location.apply",
            blocker: operations.firstBlocker(
              locationApply.json,
              "location_apply_not_completed",
              "Location decisions did not apply cleanly.",
            ),
            report: locationApplyReport,
          };
        }
        flowRowsForFinalize =
          operations.outputRowsByStem(locationApply.json, "flows.") || flowRowsForFinalize;
      }
    }

    return {
      status: "completed",
      materialized,
      processClassifiedRows,
      flowRowsForFinalize,
      classificationApplyReport,
      locationApplyReport,
    };
  }

  return { prepareScope };
}

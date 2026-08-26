import path from "node:path";

import type { EntityRow, JsonRecord, ScopeProjection } from "./entity-projection.ts";

export interface LibraryAuthoringPlanInput {
  indexDir: string;
  outDir: string;
  chunkSize: number;
}

export interface LibraryAuthoringPlanFileAdapters {
  fileExists: (filePath: string | null | undefined) => boolean;
  readJsonLines: (filePath: string) => JsonRecord[];
  writeJson: (filePath: string, value: unknown) => void;
  writeJsonLines: (filePath: string, rows: readonly unknown[]) => void;
}

export interface LibraryAuthoringPlanDependencies {
  ensureArray: <T>(value: T | readonly T[] | null | undefined) => T[];
  nowIso: () => string;
  repoRelativePath: (filePath: string) => string;
  files: LibraryAuthoringPlanFileAdapters;
}

export interface LibraryAuthoringPlan {
  chunkRows: <T>(rows: T[], chunkSize: number) => T[][];
  writeChunkFiles: <T>(outDir: string, stem: string, rows: T[], chunkSize: number) => string[];
  run: (input: LibraryAuthoringPlanInput) => JsonRecord;
}

export function createLibraryAuthoringPlan({
  ensureArray,
  nowIso,
  repoRelativePath,
  files,
}: LibraryAuthoringPlanDependencies): LibraryAuthoringPlan {
  function chunkRows<T>(rows: T[], chunkSize: number): T[][] {
    const chunks: T[][] = [];
    for (let index = 0; index < rows.length; index += chunkSize) {
      chunks.push(rows.slice(index, index + chunkSize));
    }
    return chunks;
  }

  function writeChunkFiles<T>(
    outDir: string,
    stem: string,
    rows: T[],
    chunkSize: number,
  ): string[] {
    const chunksDir = path.join(outDir, "chunks");
    return chunkRows(rows, chunkSize).map((chunk, index) => {
      const filePath = path.join(
        chunksDir,
        `${stem}.chunk-${String(index + 1).padStart(4, "0")}.jsonl`,
      );
      files.writeJsonLines(filePath, chunk);
      return repoRelativePath(filePath);
    });
  }

  function run({ indexDir, outDir, chunkSize }: LibraryAuthoringPlanInput): JsonRecord {
    const entityIndexPath = path.join(indexDir, "library-entity-index.jsonl");
    const scopeProjectionPath = path.join(indexDir, "scope-projection.jsonl");
    if (!files.fileExists(entityIndexPath) || !files.fileExists(scopeProjectionPath)) {
      throw new Error(
        "--library-index must contain library-entity-index.jsonl and scope-projection.jsonl.",
      );
    }
    const entityRows = files.readJsonLines(entityIndexPath) as EntityRow[];
    const projectionRows = files.readJsonLines(scopeProjectionPath) as ScopeProjection[];
    const usedEntityKeys = new Set(
      projectionRows.flatMap((scope) => [
        scope.process_entity_key,
        ...ensureArray(scope.dependency_ids?.flows).map((dependency) => dependency.entity_key),
        ...ensureArray(scope.dependency_ids?.flowproperties).map(
          (dependency) => dependency.entity_key,
        ),
        ...ensureArray(scope.dependency_ids?.unitgroups).map((dependency) => dependency.entity_key),
      ]),
    );
    const identityTemplateRows = entityRows
      .filter(
        (row) =>
          row.dataset_type === "flow" &&
          /^elementary flow$/iu.test(row.flow_type ?? "") &&
          usedEntityKeys.has(row.entity_key),
      )
      .map((row) => ({
        schema_version: 1,
        decision: "__AI_DECIDE_REUSE_EXISTING_REFERENCE_OR_BLOCK__",
        dataset_type: "flow",
        source_dataset_id: row.dataset_id,
        source_dataset_version: row.dataset_version,
        source_entity_key: row.entity_key,
        source_name: row.name,
        flow_type: row.flow_type,
        classification_path: row.classification_path,
        required_resolution:
          "If physically identity-equivalent to an existing TianGong elementary flow, return reuse_existing_reference with canonical_flow_id/version and evidence. Otherwise return manual_review/block_unresolved.",
      }));
    const classificationTemplateRows = entityRows
      .filter(
        (row) =>
          usedEntityKeys.has(row.entity_key) &&
          (row.dataset_type === "process" ||
            (row.dataset_type === "flow" && !/^elementary flow$/iu.test(row.flow_type ?? ""))),
      )
      .map((row) => ({
        schema_version: 1,
        dataset_type: row.dataset_type,
        dataset_id: row.dataset_id,
        dataset_version: row.dataset_version,
        entity_key: row.entity_key,
        category_type: row.dataset_type === "process" ? "process" : "flow-product",
        selected_code: "__AI_SELECT_CLASSIFICATION_CODE__",
        basis: "__AI_WRITE_MEANING_BASED_BASIS__",
        confidence: "__AI_CONFIDENCE__",
        source_name: row.name,
        converted_classification_reference: row.classification_path,
        required_resolution:
          "Classify from the real meaning of the process/flow. Converter classification is weak reference only.",
      }));
    const supportTemplateRows = entityRows
      .filter(
        (row) =>
          usedEntityKeys.has(row.entity_key) &&
          ["flowproperty", "unitgroup"].includes(row.dataset_type),
      )
      .map((row) => ({
        schema_version: 1,
        support_type: row.dataset_type,
        source_support_id: row.dataset_id,
        source_support_version: row.dataset_version,
        source_entity_key: row.entity_key,
        source_name: row.name,
        source_units: row.units ?? null,
        source_reference_unit_group: row.reference_unit_group ?? null,
        canonical_support_id: "__AI_OR_HUMAN_SELECT_CANONICAL_SUPPORT_ID__",
        canonical_support_version: "__AI_OR_HUMAN_SELECT_CANONICAL_SUPPORT_VERSION__",
        physical_dimension_evidence: "__REQUIRED_FOR_AUTOMATIC_MAPPING_OR_LEAVE_BLOCKED__",
        required_resolution:
          "Map generated support to public canonical support only when unit/physical dimension equivalence is proven; otherwise leave blocked for human support authoring.",
      }));

    const identityPath = path.join(outDir, "identity-decisions.template.jsonl");
    const classificationPath = path.join(outDir, "classification-decisions.template.jsonl");
    const supportPath = path.join(outDir, "canonical-support-mappings.template.jsonl");
    files.writeJsonLines(identityPath, identityTemplateRows);
    files.writeJsonLines(classificationPath, classificationTemplateRows);
    files.writeJsonLines(supportPath, supportTemplateRows);
    const chunkFiles = [
      ...writeChunkFiles(outDir, "identity-decisions", identityTemplateRows, chunkSize),
      ...writeChunkFiles(outDir, "classification-decisions", classificationTemplateRows, chunkSize),
      ...writeChunkFiles(outDir, "canonical-support-mappings", supportTemplateRows, chunkSize),
    ];
    const reportPath = path.join(outDir, "dataset-library-authoring-plan-report.json");
    const actionItems =
      identityTemplateRows.length + classificationTemplateRows.length + supportTemplateRows.length;
    const report = {
      schema_version: 1,
      generated_at_utc: nowIso(),
      status: actionItems > 0 ? "ready_for_ai_library_decisions" : "ready_no_action_items",
      command: "dataset-library-authoring-plan",
      library_index: repoRelativePath(indexDir),
      counts: {
        identity_decisions: identityTemplateRows.length,
        classification_decisions: classificationTemplateRows.length,
        canonical_support_mappings: supportTemplateRows.length,
        action_items: actionItems,
        chunks: chunkFiles.length,
      },
      files: {
        report: repoRelativePath(reportPath),
        identity_decisions_template: repoRelativePath(identityPath),
        classification_decisions_template: repoRelativePath(classificationPath),
        canonical_support_mappings_template: repoRelativePath(supportPath),
        chunks: chunkFiles,
      },
      blockers: [],
    };
    files.writeJson(reportPath, report);
    return report;
  }

  return { chunkRows, writeChunkFiles, run };
}

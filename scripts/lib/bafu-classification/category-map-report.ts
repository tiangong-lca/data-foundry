import type {
  BafuLeafCategoryMapProjection,
  BafuLeafCategoryMapReportInput,
} from "./category-map-projection.ts";
import type { JsonRecord } from "./leaf-repair.ts";

export function buildBafuLeafCategoryMapProjectReport(
  projection: BafuLeafCategoryMapProjection,
  input: BafuLeafCategoryMapReportInput,
): JsonRecord {
  const blockers: JsonRecord[] = [
    ...projection.categoryMap.manualReview.map((row) => ({
      schema_version: 1,
      code: "category_map_manual_review_required",
      source: "category_map_decisions",
      reason: row.reason ?? null,
      category_key: row.category_key ?? null,
      manual_review_file: input.files.categoryManualReview,
      decision_rows: row.decision_rows ?? [],
      required_human_action: row.required_human_action ?? null,
    })),
    ...projection.projectionManualReview.map((row) => ({
      schema_version: 1,
      code: "process_classification_projection_manual_review_required",
      source: "process_classification_projection",
      reason: row.reason ?? null,
      category_key: row.category_key ?? null,
      dataset_type: row.dataset_type ?? null,
      dataset_id: row.dataset_id ?? null,
      dataset_version: row.dataset_version ?? null,
      manual_review_file: input.files.projectionManualReview,
      required_human_action: row.required_human_action ?? null,
    })),
    ...projection.flowProductManualReview.map((row) => ({
      schema_version: 1,
      code: "flow_product_classification_manual_review_required",
      source: "flow_product_classification_projection",
      reason: row.reason ?? null,
      decision_key: row.decision_key ?? null,
      dataset_type: row.dataset_type ?? null,
      dataset_id: row.dataset_id ?? null,
      dataset_version: row.dataset_version ?? null,
      manual_review_file: input.files.projectionManualReview,
      required_human_action: row.required_human_action ?? null,
    })),
  ];
  return {
    schema_version: 1,
    generated_at_utc: input.generatedAtUtc,
    status: blockers.length > 0 ? "completed_with_manual_review" : "completed",
    command: input.command,
    inputs: input.inputs,
    input_hashes: input.inputHashes,
    counts: {
      tasks: projection.taskCount,
      task_categories: projection.taskCategoryCount,
      process_category_schema_entries: projection.processSchemaEntryCount,
      process_category_leaf_codes: projection.processSchemaLeafCount,
      flow_product_category_schema_entries: projection.flowProductSchemaEntryCount,
      flow_product_category_leaf_codes: projection.flowProductSchemaLeafCount,
      original_classification_decisions: projection.originalClassificationCount,
      category_map_decision_rows: projection.categoryMap.rows.length,
      category_map_resolved: projection.categoryMap.resolved.size,
      category_map_manual_review: projection.categoryMap.manualReview.length,
      projected_process_decisions: projection.projectedRows.length,
      process_leaf_classification_candidates: projection.processLeafCandidates.length,
      flow_product_classification_candidates: projection.flowProductCandidates.length,
      classification_decisions_out: projection.classificationRows.length,
      projection_manual_review_rows:
        projection.projectionManualReview.length + projection.flowProductManualReview.length,
      flow_product_manual_review_rows: projection.flowProductManualReview.length,
      category_manual_review_rows: projection.categoryManualReview.length,
    },
    ...(blockers.length > 0 ? { blockers } : {}),
    copied_decision_files: [...input.copiedDecisionFiles],
    policy: {
      tidas_tools_classification_policy: "weak_hint_only",
      ai_decision_boundary:
        "Category-map decisions are semantic AI choices. This command validates task-bound leaf codes and deterministically projects only those choices; BAFU repair rules are emitted as non-authoritative candidates.",
      manual_review_policy:
        "Unresolved, missing, conflicting, invalid, unbound, or rule-candidate-only category decisions are not projected; affected process scopes remain blocked_deferred on the next library decisions apply.",
    },
    files: {
      report: input.files.report,
      classification_decisions: input.files.classificationDecisions,
      projection_manual_review: input.files.projectionManualReview,
      process_leaf_classification_candidates: input.files.processLeafCandidates,
      flow_product_classification_candidates: input.files.flowProductCandidates,
      category_manual_review: input.files.categoryManualReview,
      copied_decision_files: [...input.files.copiedDecisionFiles],
    },
    next_step: input.nextStep,
  };
}

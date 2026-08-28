import {
  categoryKeyForLeafTask,
  categoryKeyForMapDecision,
  classificationDecisionIsBroadFlowProduct,
  classificationRepairCandidate,
  compactExistingDecision,
  repairBroadFlowProductDecision,
  repairProcessLeafDecision,
  sourceClassificationFromTask,
  type JsonRecord,
  type LeafCategoryEntry,
  type LeafCategorySchema,
} from "./leaf-repair.ts";

export interface BafuLeafCategorySchema extends LeafCategorySchema {
  path: string;
  entries: LeafCategoryEntry[];
  byCode: Map<string, LeafCategoryEntry>;
  leafCodes: Set<string>;
}

export interface BafuLeafCategoryMapHelpers {
  textValue: (value: unknown) => string;
  ensureArray: (value: unknown) => unknown[];
  reportPath: (filePath: string) => string | null;
}

export interface BafuLeafCategoryDecisionSource {
  file: string;
  rows: readonly JsonRecord[];
}

export interface EnrichedBafuLeafCategoryDecision {
  row: JsonRecord;
  categoryKey: string;
  file: string;
  lineIndex: number;
}

export interface ResolvedBafuLeafCategoryDecision {
  categoryKey: string;
  code: string;
  label: string | null;
  schemaLevel: string | null;
  row: JsonRecord;
  file: string;
  lineIndex: number;
}

export interface BafuLeafCategoryMapDecisionResult {
  files: string[];
  rows: EnrichedBafuLeafCategoryDecision[];
  resolved: Map<string, ResolvedBafuLeafCategoryDecision>;
  manualReview: JsonRecord[];
}

export interface BafuLeafCategoryMapProjectionInput {
  tasks: readonly JsonRecord[];
  originalClassificationRows: readonly JsonRecord[];
  categoryDecisionSources: readonly BafuLeafCategoryDecisionSource[];
  processSchema: BafuLeafCategorySchema;
  flowProductSchema: BafuLeafCategorySchema;
  helpers: BafuLeafCategoryMapHelpers;
}

export interface BafuLeafCategoryMapProjection {
  categoryMap: BafuLeafCategoryMapDecisionResult;
  classificationRows: JsonRecord[];
  projectedRows: JsonRecord[];
  projectionManualReview: JsonRecord[];
  processLeafCandidates: JsonRecord[];
  flowProductCandidates: JsonRecord[];
  flowProductManualReview: JsonRecord[];
  categoryManualReview: JsonRecord[];
  taskCount: number;
  taskCategoryCount: number;
  processSchemaEntryCount: number;
  processSchemaLeafCount: number;
  flowProductSchemaEntryCount: number;
  flowProductSchemaLeafCount: number;
  originalClassificationCount: number;
}

export interface BafuLeafCategoryMapReportInput {
  generatedAtUtc: string;
  command: string;
  inputs: JsonRecord;
  inputHashes: JsonRecord;
  copiedDecisionFiles: readonly string[];
  files: {
    report: string | null;
    classificationDecisions: string | null;
    projectionManualReview: string | null;
    processLeafCandidates: string | null;
    flowProductCandidates: string | null;
    categoryManualReview: string | null;
    copiedDecisionFiles: readonly (string | null)[];
  };
  nextStep: string;
}

const DEFAULT_TEXT_LIMIT = 2400;

function isJsonRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function jsonRecord(value: unknown): JsonRecord {
  return isJsonRecord(value) ? value : {};
}

function truncateText(
  value: unknown,
  helpers: BafuLeafCategoryMapHelpers,
  maxLength = DEFAULT_TEXT_LIMIT,
): string | null {
  const text = helpers.textValue(value);
  if (!text || text.length <= maxLength) return text || null;
  return `${text.slice(0, maxLength)}...`;
}

function entityKey(type: string, id: string, version: string): string {
  return `${type}:${id}:${version}`;
}

function classificationLibraryKey(row: JsonRecord, helpers: BafuLeafCategoryMapHelpers): string {
  const categoryType = helpers.textValue(row.category_type ?? row.schema_type);
  const datasetType =
    helpers.textValue(row.dataset_type ?? row.type) ||
    (categoryType === "process"
      ? "process"
      : categoryType === "flow-product" || categoryType === "flow-elementary"
        ? "flow"
        : categoryType);
  return [
    datasetType,
    helpers.textValue(row.dataset_id ?? row.datasetId ?? row.id ?? row.uuid),
    helpers.textValue(row.dataset_version ?? row.datasetVersion ?? row.version) || "00.00.001",
  ].join(":");
}

function collectCategorySchemaEntries(
  schema: JsonRecord,
  helpers: BafuLeafCategoryMapHelpers,
): LeafCategoryEntry[] {
  const byCode = new Map<string, LeafCategoryEntry>();
  const visit = (value: unknown): void => {
    if (!value || typeof value !== "object") return;
    const record = jsonRecord(value);
    const properties = jsonRecord(record.properties);
    const code = helpers.textValue(jsonRecord(properties["@classId"]).const);
    if (code && !byCode.has(code)) {
      byCode.set(code, {
        code,
        level: helpers.textValue(jsonRecord(properties["@level"]).const) || null,
        label: helpers.textValue(jsonRecord(properties["#text"]).const) || null,
      });
    }
    for (const child of Object.values(value)) visit(child);
  };
  visit(schema);
  return [...byCode.values()];
}

export function parseBafuProcessCategorySchema({
  path,
  schema,
  helpers,
}: {
  path: string;
  schema: JsonRecord;
  helpers: BafuLeafCategoryMapHelpers;
}): BafuLeafCategorySchema {
  const entries = helpers
    .ensureArray(schema.oneOf ?? schema.anyOf)
    .map(jsonRecord)
    .map((entry): LeafCategoryEntry | null => {
      const properties = jsonRecord(entry.properties);
      const code = helpers.textValue(jsonRecord(properties["@classId"]).const);
      if (!code) return null;
      return {
        code,
        level: helpers.textValue(jsonRecord(properties["@level"]).const) || null,
        label: helpers.textValue(jsonRecord(properties["#text"]).const) || null,
      };
    })
    .filter((entry): entry is LeafCategoryEntry => Boolean(entry));
  const byCode = new Map(entries.map((entry) => [entry.code, entry]));
  const leafCodes = new Set(
    entries
      .filter((entry) => /^\d{4}$/u.test(entry.code) || entry.level === "3")
      .map((entry) => entry.code),
  );
  return { path, entries, byCode, leafCodes };
}

export function parseBafuFlowProductCategorySchema({
  path,
  schema,
  helpers,
}: {
  path: string;
  schema: JsonRecord;
  helpers: BafuLeafCategoryMapHelpers;
}): BafuLeafCategorySchema {
  const entries = collectCategorySchemaEntries(schema, helpers);
  const byCode = new Map(entries.map((entry) => [entry.code, entry]));
  const leafCodes = new Set(
    entries
      .filter(
        (entry) =>
          !entries.some(
            (candidate) =>
              candidate.code !== entry.code &&
              candidate.code.startsWith(entry.code) &&
              Number(candidate.level) > Number(entry.level),
          ),
      )
      .map((entry) => entry.code),
  );
  return { path, entries, byCode, leafCodes };
}

function categoryMapDecisionCode(row: JsonRecord, helpers: BafuLeafCategoryMapHelpers): string {
  return helpers.textValue(row.selected_code ?? row.selectedCode ?? row.code);
}

function readCategoryMapDecisions(
  sources: readonly BafuLeafCategoryDecisionSource[],
  processSchema: BafuLeafCategorySchema,
  helpers: BafuLeafCategoryMapHelpers,
): BafuLeafCategoryMapDecisionResult {
  const byCategory = new Map<string, EnrichedBafuLeafCategoryDecision[]>();
  const rows: EnrichedBafuLeafCategoryDecision[] = [];
  for (const source of sources) {
    for (const [lineIndex, row] of source.rows.entries()) {
      const categoryKey = categoryKeyForMapDecision(row);
      const enriched = { row, categoryKey, file: source.file, lineIndex: lineIndex + 1 };
      rows.push(enriched);
      if (!categoryKey) continue;
      const entry = byCategory.get(categoryKey) ?? [];
      entry.push(enriched);
      byCategory.set(categoryKey, entry);
    }
  }

  const resolved = new Map<string, ResolvedBafuLeafCategoryDecision>();
  const manualReview: JsonRecord[] = [];
  for (const [categoryKey, decisionRows] of byCategory.entries()) {
    const completedRows = decisionRows.filter(
      ({ row }) =>
        helpers.textValue(row.decision_status ?? row.decisionStatus ?? row.status) === "completed",
    );
    if (completedRows.length === 0) {
      manualReview.push({
        schema_version: 1,
        category_key: categoryKey,
        status: "manual_review",
        reason: "category_map_decision_not_completed",
        decision_rows: decisionRows.map(({ file, lineIndex, row }) => ({
          file: helpers.reportPath(file),
          line: lineIndex,
          decision_status: helpers.textValue(row.decision_status ?? row.status) || null,
          basis: truncateText(row.basis, helpers),
        })),
        required_human_action:
          "Provide a completed category-map decision with a valid TIDAS process leaf code.",
      });
      continue;
    }
    const uniqueCodes = [
      ...new Set(completedRows.map(({ row }) => categoryMapDecisionCode(row, helpers))),
    ];
    if (uniqueCodes.length !== 1) {
      manualReview.push({
        schema_version: 1,
        category_key: categoryKey,
        status: "manual_review",
        reason: "category_map_decision_conflict",
        selected_codes: uniqueCodes,
        decision_rows: completedRows.map(({ file, lineIndex, row }) => ({
          file: helpers.reportPath(file),
          line: lineIndex,
          selected_code: categoryMapDecisionCode(row, helpers) || null,
          basis: truncateText(row.basis, helpers),
        })),
        required_human_action:
          "Resolve conflicting category-map decisions to one TIDAS process leaf code.",
      });
      continue;
    }
    const code = uniqueCodes[0] ?? "";
    const schemaEntry = processSchema.byCode.get(code);
    if (!code || !processSchema.leafCodes.has(code) || !schemaEntry) {
      manualReview.push({
        schema_version: 1,
        category_key: categoryKey,
        status: "manual_review",
        reason: "category_map_decision_code_invalid",
        selected_code: code || null,
        decision_rows: completedRows.map(({ file, lineIndex }) => ({
          file: helpers.reportPath(file),
          line: lineIndex,
        })),
        required_human_action:
          "Replace the selected code with a valid TIDAS process leaf code from the process category schema.",
      });
      continue;
    }
    const chosen = completedRows[0];
    const contextBundleSha256 = helpers.textValue(
      jsonRecord(chosen.row.authoring_context).context_bundle_sha256,
    );
    if (!contextBundleSha256) {
      manualReview.push({
        schema_version: 1,
        category_key: categoryKey,
        status: "manual_review",
        reason: "category_map_decision_context_bundle_missing",
        selected_code: code,
        decision_rows: completedRows.map(({ file, lineIndex }) => ({
          file: helpers.reportPath(file),
          line: lineIndex,
        })),
        required_human_action:
          "Regenerate this category-map decision from an exact AI task bundle and include authoring_context.context_bundle_sha256 before projection.",
      });
      continue;
    }
    resolved.set(categoryKey, {
      categoryKey,
      code,
      label: schemaEntry.label,
      schemaLevel: schemaEntry.level,
      row: chosen.row,
      file: chosen.file,
      lineIndex: chosen.lineIndex,
    });
  }
  return {
    files: sources.map(({ file }) => file),
    rows,
    resolved,
    manualReview,
  };
}

function projectedClassificationDecision({
  task,
  categoryKey,
  decision,
  helpers,
}: {
  task: JsonRecord;
  categoryKey: string;
  decision: ResolvedBafuLeafCategoryDecision;
  helpers: BafuLeafCategoryMapHelpers;
}): JsonRecord {
  const processId = helpers.textValue(task.dataset_id);
  const processVersion = helpers.textValue(task.dataset_version) || "00.00.001";
  const decisionRow = decision.row;
  const decisionEvidence = jsonRecord(decisionRow.evidence);
  const processContext = jsonRecord(task.process_context);
  const libraryIndexContext = jsonRecord(task.library_index_context);
  const exchangeContext = jsonRecord(task.exchange_context);
  const templateEvidence = jsonRecord(jsonRecord(task.decision_template).evidence);
  return {
    schema_version: 1,
    dataset_type: "process",
    dataset_id: processId,
    dataset_version: processVersion,
    entity_key: task.entity_key ?? entityKey("process", processId, processVersion),
    category_type: "process",
    decision_status: "completed",
    selected_code: decision.code,
    code: decision.code,
    selected_label: decision.label ?? (helpers.textValue(decisionRow.selected_label) || null),
    basis:
      helpers.textValue(decisionRow.basis) ||
      `Projected from completed BAFU source category mapping ${categoryKey}.`,
    confidence: helpers.textValue(decisionRow.confidence) || null,
    authoring_context: decisionRow.authoring_context ?? null,
    classification_decision_level: "leaf",
    source_name: processContext.name ?? null,
    converted_classification_reference: processContext.converted_classification_path ?? null,
    converted_classification_reference_policy: "weak_hint_only",
    used_context_kinds: [
      ...new Set([
        ...helpers.ensureArray(decisionRow.used_context_kinds),
        "library_entity_index",
        "scope_projection",
        "blocked_scope_ledger",
        "process_payload_context",
        "process_exchange_context",
        "bafu_category_map_decision",
        "tidas_process_category_schema",
      ]),
    ],
    evidence: {
      source: "bafu_process_leaf_category_map_projection",
      category_key: categoryKey,
      category_decision: {
        file: helpers.reportPath(decision.file),
        line: decision.lineIndex,
        selected_code: decision.code,
        selected_label: decision.label ?? (helpers.textValue(decisionRow.selected_label) || null),
        basis: truncateText(decisionRow.basis, helpers),
        confidence: helpers.textValue(decisionRow.confidence) || null,
        category_semantics: truncateText(decisionEvidence.category_semantics, helpers),
        examples_used: helpers.ensureArray(decisionEvidence.examples_used),
      },
      task: {
        task_id: task.task_id ?? null,
        process_id: processId,
        process_version: processVersion,
        source_file: libraryIndexContext.root_process_file ?? null,
        bundle_process_file: libraryIndexContext.bundle_process_file ?? null,
        payload_sha256: libraryIndexContext.payload_sha256 ?? null,
        name_parts: processContext.name_parts ?? null,
        source_classification: sourceClassificationFromTask(task),
        output_flows: exchangeContext.output_flows ?? null,
      },
      broad_decision_replaced:
        templateEvidence.broad_decision_replaced ?? task.existing_library_decision ?? null,
    },
  };
}

export function projectBafuLeafCategoryMapArtifacts({
  tasks,
  originalClassificationRows,
  categoryDecisionSources,
  processSchema,
  flowProductSchema,
  helpers,
}: BafuLeafCategoryMapProjectionInput): BafuLeafCategoryMapProjection {
  const categoryMap = readCategoryMapDecisions(categoryDecisionSources, processSchema, helpers);
  const originalByKey = new Map<string, JsonRecord>(
    originalClassificationRows.map((row) => [classificationLibraryKey(row, helpers), row]),
  );
  const projectedRows: JsonRecord[] = [];
  const projectionManualReview: JsonRecord[] = [];
  const processLeafCandidates: JsonRecord[] = [];
  const flowProductCandidates: JsonRecord[] = [];
  const flowProductManualReview: JsonRecord[] = [];
  const categoriesSeenByTasks = new Map<
    string,
    { category_key: string | null; affected_process_count: number; examples: JsonRecord[] }
  >();

  for (const task of tasks) {
    const categoryKey = categoryKeyForLeafTask(task);
    if (!categoriesSeenByTasks.has(categoryKey)) {
      categoriesSeenByTasks.set(categoryKey, {
        category_key: categoryKey || null,
        affected_process_count: 0,
        examples: [],
      });
    }
    const categorySummary = categoriesSeenByTasks.get(categoryKey)!;
    categorySummary.affected_process_count += 1;
    if (categorySummary.examples.length < 8) {
      categorySummary.examples.push({
        dataset_id: task.dataset_id,
        dataset_version: task.dataset_version,
        name: jsonRecord(task.process_context).name ?? null,
      });
    }

    const processKey = classificationLibraryKey(
      {
        dataset_type: "process",
        dataset_id: task.dataset_id,
        dataset_version: task.dataset_version,
        category_type: "process",
      },
      helpers,
    );
    const decision = categoryMap.resolved.get(categoryKey);
    if (!decision) {
      const repaired = repairProcessLeafDecision({
        task,
        categoryKey,
        existingDecision: compactExistingDecision(originalByKey.get(processKey)),
        processSchema,
      });
      if (repaired) {
        processLeafCandidates.push(
          classificationRepairCandidate(repaired, {
            candidateType: "process_leaf",
            ruleSource: "bafu_process_leaf_repair",
          }),
        );
      }
      projectionManualReview.push({
        schema_version: 1,
        status: "manual_review",
        reason: repaired
          ? "category_map_decision_missing_with_rule_candidate"
          : categoryKey
            ? "category_map_decision_missing_or_unresolved"
            : "task_source_category_key_missing",
        category_key: categoryKey || null,
        dataset_type: "process",
        dataset_id: task.dataset_id,
        dataset_version: task.dataset_version,
        source_classification: sourceClassificationFromTask(task),
        existing_decision: compactExistingDecision(originalByKey.get(processKey)),
        candidate_decision: repaired
          ? {
              selected_code: repaired.selected_code,
              selected_label: repaired.selected_label,
              repair_rule: jsonRecord(repaired.evidence).repair_rule ?? null,
              candidate_file: "process-leaf-classification-candidates.jsonl",
            }
          : null,
        required_human_action:
          "Provide a completed task-bound category-map/process leaf decision with authoring_context.context_bundle_sha256, then rerun projection and library decisions apply.",
      });
      continue;
    }
    const projected = projectedClassificationDecision({ task, categoryKey, decision, helpers });
    originalByKey.set(processKey, projected);
    projectedRows.push(projected);
  }

  for (const [decisionKey, decision] of [...originalByKey.entries()]) {
    if (!classificationDecisionIsBroadFlowProduct(decision)) continue;
    const repaired = repairBroadFlowProductDecision(decision, flowProductSchema);
    if (repaired) {
      flowProductCandidates.push(
        classificationRepairCandidate(repaired, {
          candidateType: "flow_product_leaf",
          ruleSource: "bafu_flow_product_leaf_repair",
        }),
      );
    }
    flowProductManualReview.push({
      schema_version: 1,
      status: "manual_review",
      reason: repaired
        ? "flow_product_classification_decision_not_leaf_with_rule_candidate"
        : "flow_product_classification_decision_not_leaf",
      decision_key: decisionKey,
      dataset_type: decision.dataset_type ?? "flow",
      dataset_id: decision.dataset_id ?? null,
      dataset_version: decision.dataset_version ?? null,
      category_type: decision.category_type ?? "flow-product",
      selected_code: decision.selected_code ?? decision.code ?? null,
      existing_decision: compactExistingDecision(decision),
      candidate_decision: repaired
        ? {
            selected_code: repaired.selected_code,
            selected_label: repaired.selected_label,
            repair_rule: jsonRecord(repaired.evidence).repair_rule ?? null,
            candidate_file: "flow-product-classification-candidates.jsonl",
          }
        : null,
      required_human_action:
        "Replace the broad flow-product classification with a full TIDAS flow-product leaf code selected through dataset classification children/path, include authoring_context.context_bundle_sha256, then rerun this projection.",
    });
    originalByKey.delete(decisionKey);
  }

  const classificationRows = [...originalByKey.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, row]) => row);
  const categoryManualReview = [
    ...categoryMap.manualReview,
    ...[...categoriesSeenByTasks.values()]
      .filter(
        (category) => category.category_key && !categoryMap.resolved.has(category.category_key),
      )
      .map((category) => ({
        schema_version: 1,
        status: "manual_review",
        reason: "category_map_decision_missing_or_unresolved",
        ...category,
        required_human_action:
          "Provide a completed task-bound category-map process leaf decision for this BAFU source category.",
      })),
  ];

  return {
    categoryMap,
    classificationRows,
    projectedRows,
    projectionManualReview,
    processLeafCandidates,
    flowProductCandidates,
    flowProductManualReview,
    categoryManualReview,
    taskCount: tasks.length,
    taskCategoryCount: categoriesSeenByTasks.size,
    processSchemaEntryCount: processSchema.entries.length,
    processSchemaLeafCount: processSchema.leafCodes.size,
    flowProductSchemaEntryCount: flowProductSchema.entries.length,
    flowProductSchemaLeafCount: flowProductSchema.leafCodes.size,
    originalClassificationCount: originalClassificationRows.length,
  };
}

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

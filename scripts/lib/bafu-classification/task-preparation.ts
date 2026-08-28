import { compactExistingDecision } from "./leaf-repair.ts";

export type JsonRecord = Record<string, unknown>;

export interface BafuLeafTaskProjectionHelpers {
  textValue: (value: unknown) => string;
  ensureArray: (value: unknown) => unknown[];
}

export interface BafuLeafTaskSelection {
  offset: number;
  limit: number | null;
  shardSize: number;
  maxExchangeRefs: number;
  maxReferences: number;
}

export interface BafuLeafTaskReportFiles {
  report: string | null;
  tasks: string | null;
  template: string | null;
  shardTasks: (shardId: string) => string | null;
  shardTemplate: (shardId: string) => string | null;
}

export interface BafuLeafTaskReportInput {
  generatedAtUtc: string;
  command: string;
  inputs: JsonRecord;
  inputHashes: JsonRecord;
  files: BafuLeafTaskReportFiles;
}

export interface BafuLeafTaskProjectionInput {
  entityRows: readonly JsonRecord[];
  scopeRows: readonly JsonRecord[];
  blockedRows: readonly JsonRecord[];
  decisionRows: readonly JsonRecord[];
  helpers: BafuLeafTaskProjectionHelpers;
  readProcessContext: (filePath: unknown) => JsonRecord | null;
  selection: BafuLeafTaskSelection;
  report: BafuLeafTaskReportInput;
}

export interface BafuLeafTaskShard {
  shardId: string;
  tasks: JsonRecord[];
  templates: JsonRecord[];
}

export interface BafuLeafTaskProjection {
  tasks: JsonRecord[];
  templates: JsonRecord[];
  shards: BafuLeafTaskShard[];
  contextGaps: {
    missingLibraryEntityRows: number;
    missingScopeProjectionRows: number;
  };
  report: JsonRecord;
}

interface DecisionTemplateInput {
  processId: string;
  processVersion: string;
  key: string;
  entityRow?: JsonRecord;
  existingDecision: JsonRecord | null | undefined;
  taskId: string;
  helpers: BafuLeafTaskProjectionHelpers;
}

interface TaskRowInput {
  ledgerRow: JsonRecord;
  entityRow?: JsonRecord;
  scopeRow?: JsonRecord;
  existingDecision: JsonRecord | null | undefined;
  helpers: BafuLeafTaskProjectionHelpers;
  readProcessContext: (filePath: unknown) => JsonRecord | null;
  options: { maxExchangeRefs: number; maxReferences: number };
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
  helpers: BafuLeafTaskProjectionHelpers,
  maxLength = DEFAULT_TEXT_LIMIT,
): string | null {
  const text = helpers.textValue(value);
  if (!text || text.length <= maxLength) return text || null;
  return `${text.slice(0, maxLength)}...`;
}

function trimObjectStrings(
  value: unknown,
  helpers: BafuLeafTaskProjectionHelpers,
  maxLength = 800,
): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => trimObjectStrings(item, helpers, maxLength));
  }
  if (!value || typeof value !== "object") {
    return typeof value === "string" ? truncateText(value, helpers, maxLength) : value;
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      trimObjectStrings(entry, helpers, maxLength),
    ]),
  );
}

function findNamedNode(
  node: unknown,
  wantedName: string,
  helpers: BafuLeafTaskProjectionHelpers,
  seen: Set<object> = new Set(),
): JsonRecord | null {
  if (!node || typeof node !== "object") return null;
  if (seen.has(node)) return null;
  seen.add(node);
  const record = jsonRecord(node);
  if (record.name === wantedName) return record;
  for (const child of helpers.ensureArray(record.children)) {
    const found = findNamedNode(child, wantedName, helpers, seen);
    if (found) return found;
  }
  for (const [key, value] of Object.entries(record)) {
    if (key === "attributes" || key === "children") continue;
    if (!value || typeof value !== "object") continue;
    const found = findNamedNode(value, wantedName, helpers, seen);
    if (found) return found;
  }
  return null;
}

function attributesObject(
  node: JsonRecord | null,
  helpers: BafuLeafTaskProjectionHelpers,
): Record<string, string> {
  if (!node || typeof node !== "object") return {};
  return Object.fromEntries(
    helpers
      .ensureArray(node.attributes)
      .map(jsonRecord)
      .map(
        (attribute) =>
          [helpers.textValue(attribute.name), helpers.textValue(attribute.value)] as const,
      )
      .filter(([key]) => key),
  );
}

function classificationRows(row: JsonRecord, helpers: BafuLeafTaskProjectionHelpers): JsonRecord[] {
  const dataSetInformation = jsonRecord(
    jsonRecord(jsonRecord(row.processDataSet).processInformation).dataSetInformation,
  );
  const classification = jsonRecord(
    jsonRecord(dataSetInformation.classificationInformation)["common:classification"],
  );
  return helpers
    .ensureArray(classification["common:class"])
    .map(jsonRecord)
    .map((item) => ({
      level: helpers.textValue(item["@level"]) || null,
      code: helpers.textValue(item["@classId"]) || null,
      label: helpers.textValue(item) || null,
    }));
}

export function extractBafuLeafProcessPayloadContext(
  row: JsonRecord,
  helpers: BafuLeafTaskProjectionHelpers,
): JsonRecord {
  const dataSetInformation = jsonRecord(
    jsonRecord(jsonRecord(row.processDataSet).processInformation).dataSetInformation,
  );
  const name = jsonRecord(dataSetInformation.name);
  const other = jsonRecord(dataSetInformation["common:other"]);
  const sourceTracePayload = jsonRecord(jsonRecord(other["tidasimport:sourceTrace"]).payload);
  const referenceFunction = findNamedNode(sourceTracePayload, "referenceFunction", helpers);
  const sourceGeography = findNamedNode(sourceTracePayload, "geography", helpers);
  const sourceTechnology = findNamedNode(sourceTracePayload, "technology", helpers);
  const sourceTimePeriod = findNamedNode(sourceTracePayload, "timePeriod", helpers);
  const classRows = classificationRows(row, helpers);

  return {
    name_parts: {
      base_name: truncateText(name.baseName, helpers),
      treatment_standards_routes: truncateText(name.treatmentStandardsRoutes, helpers),
      mix_and_location_types: truncateText(name.mixAndLocationTypes, helpers),
      functional_unit_flow_properties: truncateText(name.functionalUnitFlowProperties, helpers),
    },
    converted_classification_path: classRows
      .map((item) => item.label)
      .filter(Boolean)
      .join(" > "),
    converted_classification_classes: classRows,
    general_comment: truncateText(dataSetInformation["common:generalComment"], helpers),
    source_trace:
      Object.keys(sourceTracePayload).length > 0
        ? {
            source_object: truncateText(sourceTracePayload.sourceObject, helpers),
            source_classification: trimObjectStrings(
              sourceTracePayload.sourceClassification,
              helpers,
            ),
            reference_function_attributes: trimObjectStrings(
              attributesObject(referenceFunction, helpers),
              helpers,
            ),
            geography_attributes: trimObjectStrings(
              attributesObject(sourceGeography, helpers),
              helpers,
            ),
            technology_attributes: trimObjectStrings(
              attributesObject(sourceTechnology, helpers),
              helpers,
            ),
            time_period_attributes: trimObjectStrings(
              attributesObject(sourceTimePeriod, helpers),
              helpers,
            ),
          }
        : null,
  };
}

function entityKey(type: string, id: string, version: string): string {
  return `${type}:${id}:${version}`;
}

function decisionKey(type: string, id: string, version: string): string {
  return `${type}::${id}::${version}`;
}

function dependencyCounts(
  scopeRow: JsonRecord | undefined,
  helpers: BafuLeafTaskProjectionHelpers,
): Record<string, number> {
  const dependencies = jsonRecord(scopeRow?.dependency_ids);
  return Object.fromEntries(
    Object.entries(dependencies).map(([key, value]) => [key, helpers.ensureArray(value).length]),
  );
}

function limitRows(
  rows: unknown,
  limit: number,
  helpers: BafuLeafTaskProjectionHelpers,
): JsonRecord {
  const safeRows = helpers.ensureArray(rows);
  return {
    rows: safeRows.slice(0, limit),
    total_rows: safeRows.length,
    truncated: safeRows.length > limit,
  };
}

function processReferences(
  entityRow: JsonRecord | undefined,
  maxReferences: number,
  helpers: BafuLeafTaskProjectionHelpers,
): JsonRecord {
  const references = helpers.ensureArray(entityRow?.references).map(jsonRecord);
  const sourceReferences = references.filter(
    (item) => helpers.textValue(item.type) === "source data set",
  );
  const contactReferences = references.filter(
    (item) => helpers.textValue(item.type) === "contact data set",
  );
  const flowReferences = references.filter(
    (item) => helpers.textValue(item.type) === "flow data set",
  );
  return {
    source_references: limitRows(sourceReferences, maxReferences, helpers),
    contact_references: limitRows(contactReferences, maxReferences, helpers),
    flow_references: limitRows(flowReferences, maxReferences, helpers),
  };
}

function buildDecisionTemplate({
  processId,
  processVersion,
  key,
  entityRow,
  existingDecision,
  taskId,
  helpers,
}: DecisionTemplateInput): JsonRecord {
  return {
    schema_version: 1,
    dataset_type: "process",
    dataset_id: processId,
    dataset_version: processVersion,
    entity_key: key,
    category_type: "process",
    decision_status: "completed",
    selected_code: "__AI_SELECT_TIDAS_PROCESS_LEAF_CODE__",
    basis: "__AI_FILL_PROCESS_LEAF_CLASSIFICATION_BASIS__",
    confidence: "__AI_FILL_CONFIDENCE_high_medium_low__",
    classification_decision_level: "leaf",
    source_name: entityRow?.name ?? existingDecision?.source_name ?? null,
    converted_classification_reference:
      entityRow?.classification_path ??
      existingDecision?.converted_classification_reference ??
      null,
    required_resolution:
      "Select a full TIDAS process leaf code from process category context. Converted classifications and broad section decisions are weak hints only.",
    used_context_kinds: [
      "library_entity_index",
      "scope_projection",
      "blocked_scope_ledger",
      "process_payload_context",
      "process_exchange_context",
      "tidas_process_category_schema",
    ],
    evidence: {
      source: "bafu_process_leaf_classification_authoring_task",
      task_id: taskId,
      broad_decision_replaced: compactExistingDecision(existingDecision),
      source_file: entityRow?.source_file ?? null,
      source_files: helpers.ensureArray(entityRow?.source_files),
      payload_sha256: entityRow?.payload_sha256 ?? null,
      semantic_key: entityRow?.semantic_key ?? null,
    },
  };
}

function buildTaskRow({
  ledgerRow,
  entityRow,
  scopeRow,
  existingDecision,
  helpers,
  readProcessContext,
  options,
}: TaskRowInput): JsonRecord {
  const blockingDependency = jsonRecord(ledgerRow.blocking_dependency);
  const processId = helpers.textValue(ledgerRow.blocked_process_id ?? blockingDependency.id);
  const processVersion = helpers.textValue(
    ledgerRow.blocked_process_version ?? blockingDependency.version,
  );
  const key = entityKey("process", processId, processVersion);
  const processContext =
    readProcessContext(scopeRow?.process_file) ?? readProcessContext(entityRow?.source_file) ?? {};
  const usageRefs = jsonRecord(scopeRow?.usage_refs);
  const exchangeRefs = helpers.ensureArray(usageRefs.process_exchange_flow_refs).map(jsonRecord);
  const outputRefs = exchangeRefs.filter(
    (item) => helpers.textValue(item.direction).toLowerCase() === "output",
  );
  const nameParts = jsonRecord(processContext.name_parts);
  const taskId = key;

  return {
    schema_version: 1,
    task_kind: "bafu_process_leaf_classification_authoring",
    task_id: taskId,
    status: "needs_leaf_classification_decision",
    dataset_type: "process",
    dataset_id: processId,
    dataset_version: processVersion,
    entity_key: key,
    blocked_scope: {
      blocked_process_id: processId,
      blocked_process_version: processVersion,
      reason: ledgerRow.reason ?? null,
      message: ledgerRow.message ?? null,
      required_human_action: ledgerRow.required_human_action ?? null,
      rerun_command: ledgerRow.rerun_command ?? null,
    },
    library_index_context: {
      entity_row_found: Boolean(entityRow),
      scope_projection_found: Boolean(scopeRow),
      root_process_file: entityRow?.source_file ?? null,
      bundle_process_file: scopeRow?.process_file ?? null,
      bundle_dir: scopeRow?.bundle_dir ?? null,
      manifest: scopeRow?.manifest ?? null,
      tidas_dir: scopeRow?.tidas_dir ?? null,
      payload_sha256: entityRow?.payload_sha256 ?? null,
      semantic_key: entityRow?.semantic_key ?? null,
      semantic_hash: entityRow?.semantic_hash ?? null,
      estimated_weight: scopeRow?.estimated_weight ?? null,
      dependency_counts: dependencyCounts(scopeRow, helpers),
    },
    process_context: {
      name: entityRow?.name ?? nameParts.base_name ?? null,
      name_parts: processContext.name_parts ?? null,
      converted_classification_path:
        entityRow?.classification_path ?? processContext.converted_classification_path ?? null,
      converted_classification_classes: processContext.converted_classification_classes ?? [],
      converted_classification_policy: "weak_hint_only",
      general_comment: processContext.general_comment ?? null,
      source_trace: processContext.source_trace ?? null,
    },
    reference_context: processReferences(entityRow, options.maxReferences, helpers),
    exchange_context: {
      output_flows: limitRows(outputRefs, options.maxExchangeRefs, helpers),
      exchange_flow_refs: limitRows(exchangeRefs, options.maxExchangeRefs, helpers),
    },
    existing_library_decision: compactExistingDecision(existingDecision),
    authoring_requirement: {
      output_jsonl: "classification-decisions.jsonl",
      category_type: "process",
      required_decision_status: "completed",
      required_leaf_code: true,
      broad_code_policy:
        "Reject single-letter section codes and short process section/division/group codes.",
      preserve_source_classification_as_evidence: true,
      do_not_edit_rows_directly: true,
      deterministic_rerun:
        "node scripts/foundry.ts dataset-library-decisions-apply --library-index <library-index> --decisions-dir <decisions-dir> --out-dir <library-resolution>",
    },
    decision_template: buildDecisionTemplate({
      processId,
      processVersion,
      key,
      entityRow,
      existingDecision,
      taskId,
      helpers,
    }),
  };
}

export function projectBafuLeafClassificationTaskArtifacts({
  entityRows,
  scopeRows,
  blockedRows,
  decisionRows,
  helpers,
  readProcessContext,
  selection,
  report,
}: BafuLeafTaskProjectionInput): BafuLeafTaskProjection {
  const processEntities = new Map<string, JsonRecord>(
    entityRows
      .filter((row) => row.dataset_type === "process")
      .map((row) => [
        entityKey(
          "process",
          helpers.textValue(row.dataset_id),
          helpers.textValue(row.dataset_version),
        ),
        row,
      ]),
  );
  const scopes = new Map<string, JsonRecord>(
    scopeRows.map((row) => [
      entityKey(
        "process",
        helpers.textValue(row.process_id),
        helpers.textValue(row.process_version) || "00.00.001",
      ),
      row,
    ]),
  );
  const decisions = new Map<string, JsonRecord>(
    decisionRows
      .filter((row) => row.dataset_type === "process" || row.category_type === "process")
      .map((row) => [
        decisionKey(
          "process",
          helpers.textValue(row.dataset_id ?? row.id),
          helpers.textValue(row.dataset_version ?? row.version) || "00.00.001",
        ),
        row,
      ]),
  );
  const blockedByProcess = new Map<string, JsonRecord>();
  for (const row of blockedRows) {
    if (row.reason !== "process_classification_requires_leaf_authoring") continue;
    const dependency = jsonRecord(row.blocking_dependency);
    const processId = helpers.textValue(row.blocked_process_id ?? dependency.id);
    const processVersion = helpers.textValue(
      row.blocked_process_version ?? dependency.version ?? "00.00.001",
    );
    if (!processId) continue;
    const key = entityKey("process", processId, processVersion);
    if (!blockedByProcess.has(key)) blockedByProcess.set(key, row);
  }

  const selectedBlocked = [...blockedByProcess.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .slice(
      selection.offset,
      selection.limit === null ? undefined : selection.offset + Math.max(0, selection.limit),
    );
  const tasks = selectedBlocked.map(([key, ledgerRow]) => {
    const dependency = jsonRecord(ledgerRow.blocking_dependency);
    const processId = helpers.textValue(ledgerRow.blocked_process_id ?? dependency.id);
    const processVersion = helpers.textValue(
      ledgerRow.blocked_process_version ?? dependency.version ?? "00.00.001",
    );
    return buildTaskRow({
      ledgerRow,
      entityRow: processEntities.get(key),
      scopeRow: scopes.get(key),
      existingDecision: decisions.get(decisionKey("process", processId, processVersion)),
      helpers,
      readProcessContext,
      options: {
        maxExchangeRefs: selection.maxExchangeRefs,
        maxReferences: selection.maxReferences,
      },
    });
  });
  const templates = tasks.map((task) => jsonRecord(task.decision_template));
  const shards: BafuLeafTaskShard[] = [];
  for (let start = 0; start < tasks.length; start += selection.shardSize) {
    const shardIndex = Math.floor(start / selection.shardSize);
    const shardId = String(shardIndex).padStart(4, "0");
    const shardTasks = tasks.slice(start, start + selection.shardSize);
    shards.push({
      shardId,
      tasks: shardTasks,
      templates: shardTasks.map((task) => jsonRecord(task.decision_template)),
    });
  }

  const missingLibraryEntityRows = tasks.filter(
    (task) => !jsonRecord(task.library_index_context).entity_row_found,
  ).length;
  const missingScopeProjectionRows = tasks.filter(
    (task) => !jsonRecord(task.library_index_context).scope_projection_found,
  ).length;
  const resultReport = {
    schema_version: 1,
    generated_at_utc: report.generatedAtUtc,
    status:
      tasks.length === 0
        ? "ready_no_leaf_classification_blockers"
        : missingLibraryEntityRows || missingScopeProjectionRows
          ? "completed_with_context_gaps"
          : "completed",
    command: report.command,
    inputs: report.inputs,
    input_hashes: report.inputHashes,
    counts: {
      blocked_ledger_rows: blockedRows.length,
      unique_leaf_classification_blocked_processes: blockedByProcess.size,
      selected_tasks: tasks.length,
      shards: shards.length,
      missing_library_entity_rows: missingLibraryEntityRows,
      missing_scope_projection_rows: missingScopeProjectionRows,
      attached_existing_library_decisions: tasks.filter((task) => task.existing_library_decision)
        .length,
    },
    selection: {
      offset: selection.offset,
      limit: selection.limit,
      shard_size: selection.shardSize,
      max_exchange_refs_per_task: selection.maxExchangeRefs,
      max_references_per_task: selection.maxReferences,
    },
    files: {
      report: report.files.report,
      tasks: report.files.tasks,
      template: report.files.template,
      shards: shards.map((shard) => ({
        shard_id: shard.shardId,
        task_count: shard.tasks.length,
        tasks: report.files.shardTasks(shard.shardId),
        template: report.files.shardTemplate(shard.shardId),
      })),
    },
    expected_ai_output: {
      file: "classification-decisions.jsonl",
      row_contract:
        "One completed process decision per task with dataset_type, dataset_id, dataset_version, category_type=process, selected_code=<TIDAS process leaf code>, basis, confidence, classification_decision_level=leaf, authoring_context.context_bundle_sha256, used_context_kinds, and structured evidence.",
      broad_codes_rejected: true,
    },
    next_step:
      "Merge completed shard decisions into the library decisions directory, rerun dataset-library-decisions-apply, then continue only ready scopes.",
  };

  return {
    tasks,
    templates,
    shards,
    contextGaps: {
      missingLibraryEntityRows,
      missingScopeProjectionRows,
    },
    report: resultReport,
  };
}

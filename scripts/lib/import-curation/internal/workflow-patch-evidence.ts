import path from "node:path";
import { loadTidasSchema } from "./context-inputs.ts";
import { asText, ensureArray, resolveRepoPath } from "./runtime-io.ts";
import {
  evidenceEntries,
  evidenceSourceKeys,
  evidenceTraceKeys,
  firstNonEmptyEvidenceValue,
  hasNonEmptyTraceEvidence,
} from "./workflow-authoring-tasks.ts";
import { isAnnualSupplyTarget } from "./workflow-queue-context.ts";

interface JsonRecord {
  [key: string]: unknown;
}

interface PatchOperation extends JsonRecord {
  path?: unknown;
  value?: unknown;
  closes?: unknown;
  closes_action_items?: unknown;
  closesActionItems?: unknown;
  action_items?: unknown;
  actionItems?: unknown;
}

interface ActionItem extends JsonRecord {
  code?: unknown;
  rule_id?: unknown;
  ruleId?: unknown;
  path?: unknown;
}

interface AuthoringTask extends JsonRecord {
  entity?: JsonRecord;
  action_items?: unknown;
  files?: JsonRecord;
}

interface CategoryEntry {
  level: number;
  code: string;
  text: string;
}

interface DeferredTraceOptions {
  operation: unknown;
  actionItems: unknown;
}

interface ClassificationDecisionOptions {
  repoRoot: string;
  operation: unknown;
  schemaFile: string;
  codeAttribute: string;
  datasetLabel: string;
  itemLabel: string;
}

interface TaskOperationOptions {
  repoRoot: string;
  task: unknown;
  operation: unknown;
}

interface LocationDecisionOptions {
  repoRoot: string;
  operation: unknown;
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asOperation(value: unknown): PatchOperation {
  return isRecord(value) ? value : {};
}

function asTask(value: unknown): AuthoringTask {
  return isRecord(value) ? value : {};
}

function asActionItem(value: unknown): ActionItem {
  return isRecord(value) ? value : {};
}

// part-04.mjs
export function hasStructuredTraceEvidence(value: unknown): boolean {
  return evidenceEntries(value)
    .filter((entry) => entry && typeof entry === "object" && !Array.isArray(entry))
    .some(
      (entry) =>
        firstNonEmptyEvidenceValue(entry, evidenceSourceKeys) &&
        firstNonEmptyEvidenceValue(entry, evidenceTraceKeys),
    );
}

export function objectTraceEntries(value: unknown, traceKey: string): unknown[] {
  const entries: unknown[] = [];
  const visit = (node: unknown): void => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    const record = node as JsonRecord;
    if (Object.hasOwn(record, traceKey)) {
      entries.push(...ensureArray(record[traceKey]));
    }
    const commonOther = record["common:other"];
    if (commonOther && typeof commonOther === "object" && !Array.isArray(commonOther)) {
      const commonOtherRecord = commonOther as JsonRecord;
      if (Object.hasOwn(commonOtherRecord, traceKey)) {
        entries.push(...ensureArray(commonOtherRecord[traceKey]));
      }
    }
    for (const child of Object.values(record)) visit(child);
  };
  visit(value);
  return entries;
}

export function operationTraceEntries(operation: unknown, traceKey: string): unknown[] {
  const typedOperation = asOperation(operation);
  const pointer = asText(typedOperation.path);
  const value = typedOperation.value;
  if (pointer.includes(`/${traceKey}`)) return ensureArray(value);
  if (pointer.includes("/common:other")) return objectTraceEntries(value, traceKey);
  return objectTraceEntries(value, traceKey);
}

export function validateDeferredCommonOtherTrace({
  operation,
  actionItems,
}: DeferredTraceOptions): JsonRecord[] {
  const traceEntries = operationTraceEntries(operation, "tiangongfoundry:unresolvedTrace");
  const closureCodes = new Set(operationClosureCodes(operation));
  const actionCodes = new Set(
    ensureArray(actionItems)
      .map((item) => {
        const typedItem = asActionItem(item);
        return asText(typedItem.code ?? typedItem.rule_id ?? typedItem.ruleId);
      })
      .filter(Boolean),
  );
  const acceptedCodes = closureCodes.size > 0 ? closureCodes : actionCodes;
  const blockers: JsonRecord[] = [];
  if (traceEntries.length === 0) {
    blockers.push({
      code: "patch_deferred_trace_missing",
      message:
        "resolution.mode=deferred_to_common_other must add tiangongfoundry:unresolvedTrace under common:other.",
    });
    return blockers;
  }
  const closureCodesOnly = new Set([...closureCodes].filter(Boolean));
  const tracedActionCodes = new Set(
    traceEntries
      .map((entry) => {
        const record = isRecord(entry) ? entry : {};
        return asText(record.action_item_code ?? record.actionItemCode ?? record.code);
      })
      .filter(Boolean),
  );
  for (const closureCode of closureCodesOnly) {
    if (!tracedActionCodes.has(closureCode)) {
      blockers.push({
        code: "patch_deferred_trace_action_item_untraced",
        message:
          "Each action item closed by a deferred_to_common_other operation must have a matching tiangongfoundry:unresolvedTrace.action_item_code entry.",
        action_item_code: closureCode,
      });
    }
  }
  traceEntries.forEach((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      blockers.push({
        code: "patch_deferred_trace_invalid",
        message: "tiangongfoundry:unresolvedTrace entries must be JSON objects.",
        trace_index: index,
      });
      return;
    }
    const typedEntry = entry as JsonRecord;
    const status = asText(
      typedEntry.status ?? typedEntry.decision_status ?? typedEntry.decisionStatus,
    );
    const actionCode = asText(
      typedEntry.action_item_code ?? typedEntry.actionItemCode ?? typedEntry.code,
    );
    const blockedPath = asText(
      typedEntry.blocked_path ??
        typedEntry.blockedPath ??
        typedEntry.field_path ??
        typedEntry.fieldPath ??
        typedEntry.path,
    );
    const reason = asText(
      typedEntry.reason ?? typedEntry.deferred_reason ?? typedEntry.deferredReason,
    );
    const nextAction = asText(
      typedEntry.next_action ??
        typedEntry.nextAction ??
        typedEntry.follow_up ??
        typedEntry.followUp,
    );
    if (!["unresolved_deferred", "deferred_to_common_other", "needs_followup"].includes(status)) {
      blockers.push({
        code: "patch_deferred_trace_status_invalid",
        message:
          "tiangongfoundry:unresolvedTrace.status must be unresolved_deferred, deferred_to_common_other, or needs_followup.",
        trace_index: index,
      });
    }
    if (!actionCode || (acceptedCodes.size > 0 && !acceptedCodes.has(actionCode))) {
      blockers.push({
        code: "patch_deferred_trace_action_item_missing",
        message:
          "tiangongfoundry:unresolvedTrace must identify the deferred action item code closed by this operation.",
        trace_index: index,
      });
    }
    if (!blockedPath) {
      blockers.push({
        code: "patch_deferred_trace_path_missing",
        message: "tiangongfoundry:unresolvedTrace must record the blocked field/path.",
        trace_index: index,
      });
    }
    if (!reason) {
      blockers.push({
        code: "patch_deferred_trace_reason_missing",
        message:
          "tiangongfoundry:unresolvedTrace must record why the value could not be safely inferred.",
        trace_index: index,
      });
    }
    const evidence = typedEntry.evidence ?? typedEntry.source_evidence ?? typedEntry.sourceEvidence;
    if (!hasNonEmptyTraceEvidence(evidence)) {
      blockers.push({
        code: "patch_deferred_trace_evidence_missing",
        message:
          "tiangongfoundry:unresolvedTrace must preserve source/context evidence for later database-side repair.",
        trace_index: index,
      });
    } else if (!hasStructuredTraceEvidence(evidence)) {
      blockers.push({
        code: "patch_deferred_trace_evidence_incomplete",
        message:
          "tiangongfoundry:unresolvedTrace evidence must include both a source/context identifier and a quote, trace, field path, citation, or equivalent pointer.",
        trace_index: index,
      });
    }
    if (!nextAction) {
      blockers.push({
        code: "patch_deferred_trace_next_action_missing",
        message: "tiangongfoundry:unresolvedTrace must record a concrete next_action/follow_up.",
        trace_index: index,
      });
    }
  });
  return blockers;
}

export function validateSourceExchangeCompletenessTrace(operation: unknown): JsonRecord[] {
  const traceEntries = operationTraceEntries(
    operation,
    "tiangongfoundry:sourceExchangeCompleteness",
  );
  const blockers: JsonRecord[] = [];
  if (traceEntries.length === 0) {
    blockers.push({
      code: "patch_source_exchange_trace_missing",
      message:
        "resolution.mode=source_trace_verified must add tiangongfoundry:sourceExchangeCompleteness under common:other.",
    });
    return blockers;
  }
  traceEntries.forEach((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      blockers.push({
        code: "patch_source_exchange_trace_invalid",
        message: "tiangongfoundry:sourceExchangeCompleteness entries must be JSON objects.",
        trace_index: index,
      });
      return;
    }
    const typedEntry = entry as JsonRecord;
    const status = asText(
      typedEntry.status ?? typedEntry.decision_status ?? typedEntry.decisionStatus,
    );
    if (
      !["source_only_output_exchange_verified", "accepted_source_only_output", "verified"].includes(
        status,
      )
    ) {
      blockers.push({
        code: "patch_source_exchange_trace_status_invalid",
        message:
          "tiangongfoundry:sourceExchangeCompleteness.status must prove source-only-output verification.",
        trace_index: index,
      });
    }
    const evidence =
      typedEntry.evidence ??
      typedEntry.source_evidence ??
      typedEntry.sourceEvidence ??
      typedEntry.trace;
    if (!hasNonEmptyTraceEvidence(evidence)) {
      blockers.push({
        code: "patch_source_exchange_trace_evidence_missing",
        message:
          "tiangongfoundry:sourceExchangeCompleteness must include source trace evidence used for verification.",
        trace_index: index,
      });
    } else if (!hasStructuredTraceEvidence(evidence)) {
      blockers.push({
        code: "patch_source_exchange_trace_evidence_incomplete",
        message:
          "tiangongfoundry:sourceExchangeCompleteness evidence must include both a source/context identifier and a quote, trace, field path, citation, or equivalent pointer.",
        trace_index: index,
      });
    }
  });
  return blockers;
}

export function operationClosureCodes(operation: unknown): string[] {
  return operationClosureKeys(operation)
    .map((key) => key.split("\u0000")[0])
    .filter(Boolean);
}

export function containsAiTemplatePlaceholder(value: unknown): boolean {
  if (typeof value === "string") {
    return /__AI_FILL_[A-Z0-9_]*__|\/__AI_FILL_JSON_POINTER__/u.test(value);
  }
  if (Array.isArray(value)) return value.some((item) => containsAiTemplatePlaceholder(item));
  if (value && typeof value === "object") {
    return Object.values(value).some((item) => containsAiTemplatePlaceholder(item));
  }
  return false;
}

export function operationClosureKeys(operation: unknown): string[] {
  const typedOperation = asOperation(operation);
  const raw =
    typedOperation.closes ??
    typedOperation.closes_action_items ??
    typedOperation.closesActionItems ??
    typedOperation.action_items ??
    typedOperation.actionItems;
  return ensureArray(raw)
    .map((item) => {
      if (typeof item === "string") return `${item}\u0000`;
      const record = isRecord(item) ? item : {};
      const code = asText(
        record.code ??
          record.action_item_code ??
          record.actionItemCode ??
          record.rule_id ??
          record.ruleId,
      );
      const itemPath = asText(record.path ?? record.json_path ?? record.jsonPath);
      return code ? `${code}\u0000${itemPath}` : "";
    })
    .filter(Boolean);
}

export function operationClosesAnnualSupplyTarget(operation: unknown): boolean {
  return operationClosureKeys(operation).some((key) => {
    const [code, itemPath] = key.split("\u0000");
    return isAnnualSupplyTarget(code, itemPath);
  });
}

export function categoryEntries(
  repoRoot: string,
  schemaFile: string,
): { byCode: Map<string, CategoryEntry>; parentByCode: Map<string, CategoryEntry | null> } {
  const schema = loadTidasSchema(repoRoot, schemaFile) as JsonRecord;
  const entries = ensureArray(schema.oneOf)
    .map((entry) => {
      const properties = isRecord(entry) && isRecord(entry.properties) ? entry.properties : {};
      const levelProperty = isRecord(properties["@level"]) ? properties["@level"] : {};
      const classProperty = isRecord(properties["@classId"]) ? properties["@classId"] : {};
      const categoryProperty = isRecord(properties["@catId"]) ? properties["@catId"] : {};
      const codeProperty = isRecord(properties["@code"]) ? properties["@code"] : {};
      const textProperty = isRecord(properties["#text"]) ? properties["#text"] : {};
      const levelText = asText(levelProperty.const);
      const code = asText(classProperty.const ?? categoryProperty.const ?? codeProperty.const);
      const text = asText(textProperty.const);
      const level = levelText === "" ? Number.NaN : Number(levelText);
      return Number.isInteger(level) && code && text ? { level, code, text } : null;
    })
    .filter((entry): entry is CategoryEntry => entry !== null);
  const byCode = new Map(entries.map((entry) => [entry.code, entry]));
  const parentByCode = new Map<string, CategoryEntry | null>();
  const lastPerLevel = new Map<number, CategoryEntry>();
  for (const entry of entries) {
    if (entry.level === 0) {
      parentByCode.set(entry.code, null);
    } else {
      let parent = null;
      for (let level = entry.level - 1; level >= 0; level -= 1) {
        parent = lastPerLevel.get(level) ?? null;
        if (parent) break;
      }
      parentByCode.set(entry.code, parent);
    }
    lastPerLevel.set(entry.level, entry);
  }
  return { byCode, parentByCode };
}

export function categoryPathForCode(
  repoRoot: string,
  schemaFile: string,
  code: unknown,
): CategoryEntry[] {
  const { byCode, parentByCode } = categoryEntries(repoRoot, schemaFile);
  const entry = byCode.get(asText(code));
  if (!entry) return [];
  const pathEntries = [entry];
  let current = entry;
  while (true) {
    const parent = parentByCode.get(current.code);
    if (!parent) break;
    pathEntries.push(parent);
    current = parent;
  }
  return pathEntries.reverse();
}

export function processCategoryPathForCode(repoRoot: string, code: unknown): CategoryEntry[] {
  return categoryPathForCode(repoRoot, "tidas_processes_category.json", code);
}

export function classCode(value: unknown): string {
  const record = isRecord(value) ? value : {};
  return asText(
    record["@classId"] ??
      record.classId ??
      record.class_id ??
      record["@catId"] ??
      record.catId ??
      record.cat_id,
  );
}

export function classText(value: unknown): string {
  const record = isRecord(value) ? value : {};
  return asText(record["#text"] ?? record.text ?? record.label ?? record.name);
}

export function classLevel(value: unknown): number | null {
  const record = isRecord(value) ? value : {};
  const text = asText(record["@level"] ?? record.level);
  return text === "" ? null : Number(text);
}

export function classificationItemsFromOperation(operation: unknown): unknown[] {
  const value = asOperation(operation).value;
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const record = value as JsonRecord;
  const commonClass = record["common:class"];
  if (Array.isArray(commonClass)) return commonClass;
  if (commonClass && typeof commonClass === "object") return [commonClass];
  const commonCategory = record["common:category"];
  if (Array.isArray(commonCategory)) return commonCategory;
  if (commonCategory && typeof commonCategory === "object") return [commonCategory];
  const wrappedClassification = record["common:classification"];
  if (
    wrappedClassification &&
    typeof wrappedClassification === "object" &&
    !Array.isArray(wrappedClassification)
  ) {
    const wrappedClass = (wrappedClassification as JsonRecord)["common:class"];
    if (Array.isArray(wrappedClass)) return wrappedClass;
    if (wrappedClass && typeof wrappedClass === "object") return [wrappedClass];
  }
  const wrappedElementary = record["common:elementaryFlowCategorization"];
  if (
    wrappedElementary &&
    typeof wrappedElementary === "object" &&
    !Array.isArray(wrappedElementary)
  ) {
    const wrappedCategory = (wrappedElementary as JsonRecord)["common:category"];
    if (Array.isArray(wrappedCategory)) return wrappedCategory;
    if (wrappedCategory && typeof wrappedCategory === "object") return [wrappedCategory];
  }
  const classes = record.classes ?? record.classification_classes;
  if (Array.isArray(classes)) return classes;
  const categories = record.categories ?? record.category;
  if (Array.isArray(categories)) return categories;
  return [];
}

export function validateClassificationDecisionOperation({
  repoRoot,
  operation,
  schemaFile,
  codeAttribute,
  datasetLabel,
  itemLabel,
}: ClassificationDecisionOptions): JsonRecord[] {
  const items = classificationItemsFromOperation(operation);
  if (items.length === 0) {
    return [
      {
        code: "patch_classification_decision_value_missing",
        message: `${datasetLabel} classification_decision operations must write ${itemLabel} from the bundled TIDAS category schema.`,
      },
    ];
  }
  const rawCodes = items.map(classCode).filter(Boolean);
  const leafCode = rawCodes.at(-1);
  const canonical = categoryPathForCode(repoRoot, schemaFile, leafCode);
  if (!leafCode || canonical.length === 0) {
    return [
      {
        code: "patch_classification_decision_code_invalid",
        message: `${datasetLabel} classification_decision leaf code is not present in ${schemaFile}.`,
        leaf_code: leafCode || null,
      },
    ];
  }
  const canonicalPrefix = canonical.slice(0, rawCodes.length);
  const canonicalCodes = canonicalPrefix.map((entry) => entry.code);
  if (rawCodes.join("/") !== canonicalCodes.join("/")) {
    return [
      {
        code: "patch_classification_decision_path_invalid",
        message: `${datasetLabel} classification_decision path does not match the canonical TIDAS category path.`,
        expected_codes: canonical.map((entry) => entry.code),
        actual_codes: rawCodes,
      },
    ];
  }
  const invalidEntries = items
    .map((item, index) => {
      const expected = canonicalPrefix[index];
      if (!expected) return null;
      const level = classLevel(item);
      const text = classText(item);
      const problems: string[] = [];
      if (level !== null && level !== expected.level) problems.push("level");
      if (text && text !== expected.text) problems.push("text");
      const itemCode = asText(isRecord(item) ? item[codeAttribute] : undefined);
      if (itemCode && itemCode !== expected.code) problems.push(codeAttribute);
      return problems.length > 0
        ? {
            index,
            code: expected.code,
            expected_level: expected.level,
            actual_level: level,
            expected_text: expected.text,
            actual_text: text || null,
            expected_code_attribute: codeAttribute,
            actual_code: itemCode || null,
            problems,
          }
        : null;
    })
    .filter(Boolean);
  return invalidEntries.length > 0
    ? [
        {
          code: "patch_classification_decision_entry_invalid",
          message: `${datasetLabel} classification_decision entries must use canonical @level/${codeAttribute}/#text values from ${schemaFile}.`,
          invalid_entries: invalidEntries,
        },
      ]
    : [];
}

export function validateProcessClassificationDecisionOperation({
  repoRoot,
  task,
  operation,
}: TaskOperationOptions): JsonRecord[] {
  const typedTask = asTask(task);
  const entity = isRecord(typedTask.entity) ? typedTask.entity : {};
  if (asText(entity.dataset_type) !== "process") return [];
  return validateClassificationDecisionOperation({
    repoRoot,
    operation,
    schemaFile: "tidas_processes_category.json",
    codeAttribute: "@classId",
    datasetLabel: "Process",
    itemLabel: "common:classification.common:class",
  });
}

export function validateFlowClassificationDecisionOperation({
  repoRoot,
  task,
  operation,
}: TaskOperationOptions): JsonRecord[] {
  const typedTask = asTask(task);
  const entity = isRecord(typedTask.entity) ? typedTask.entity : {};
  if (asText(entity.dataset_type) !== "flow") return [];
  const actionPaths = ensureArray(typedTask.action_items)
    .map((item) => asText(asActionItem(item).path))
    .filter(Boolean);
  const operationPath = asText(asOperation(operation).path);
  const isElementary =
    operationPath.includes("elementaryFlowCategorization") ||
    actionPaths.some((itemPath) => itemPath.includes("elementaryFlowCategorization"));
  return validateClassificationDecisionOperation({
    repoRoot,
    operation,
    schemaFile: isElementary
      ? "tidas_flows_elementary_category.json"
      : "tidas_flows_product_category.json",
    codeAttribute: isElementary ? "@catId" : "@classId",
    datasetLabel: isElementary ? "Elementary flow" : "Product/waste flow",
    itemLabel: isElementary
      ? "common:elementaryFlowCategorization.common:category"
      : "common:classification.common:class",
  });
}

export function locationCodeMapForPatch(repoRoot: string): Map<string, string> {
  const schema = loadTidasSchema(repoRoot, "tidas_locations_category.json") as JsonRecord;
  return new Map(
    ensureArray(schema.oneOf)
      .map((entry): [string, string] => {
        const record = isRecord(entry) ? entry : {};
        return [asText(record.const), asText(record.description)];
      })
      .filter(([code]) => Boolean(code)),
  );
}

export function locationCodeFromOperation(operation: unknown): string {
  const value = asOperation(operation).value;
  if (typeof value === "string") return value.trim();
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const record = value as JsonRecord;
    return asText(
      record.code ??
        record.location ??
        record["@location"] ??
        record["@subLocation"] ??
        record["#text"] ??
        record.impactLocation ??
        record.interventionLocation ??
        record.intervensionSubLocation ??
        record.locationOfSupply,
    );
  }
  return "";
}

export function operationTargetsLocationCode(operation: unknown): boolean {
  const typedOperation = asOperation(operation);
  const pointer = asText(typedOperation.path);
  if (pointer.includes("/name/")) return false;
  const pointerSegments = pointer
    .split("/")
    .filter(Boolean)
    .map((segment) => segment.replace(/~1/g, "/").replace(/~0/g, "~"));
  const codeFields = new Set([
    "location",
    "subLocation",
    "locationOfSupply",
    "locationOfOperationSupplyOrProduction",
    "impactLocation",
    "interventionLocation",
    "intervensionSubLocation",
  ]);
  if (pointerSegments.some((segment) => codeFields.has(segment))) return true;
  const value = typedOperation.value;
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return [...codeFields].some((field) => Object.hasOwn(value, field));
}

export function validateLocationDecisionOperation({
  repoRoot,
  operation,
}: LocationDecisionOptions): JsonRecord[] {
  const code = locationCodeFromOperation(operation);
  if (!code) {
    return [
      {
        code: "patch_location_decision_value_missing",
        message:
          "location_decision operations must write a location code from tidas_locations_category.json.",
      },
    ];
  }
  if (!locationCodeMapForPatch(repoRoot).has(code)) {
    return [
      {
        code: "patch_location_decision_code_invalid",
        message: "location_decision code is not present in tidas_locations_category.json.",
        location_code: code,
      },
    ];
  }
  return [];
}

export function taskActionItemKeys(task: unknown): string[] {
  return ensureArray(asTask(task).action_items)
    .map((item) => {
      const typedItem = asActionItem(item);
      const code = asText(typedItem.code ?? typedItem.rule_id ?? typedItem.ruleId);
      const itemPath = asText(typedItem.path);
      return code ? `${code}\u0000${itemPath}` : "";
    })
    .filter(Boolean);
}

export function taskActionItemsForOperation(task: unknown, operation: unknown): unknown[] {
  const closures = operationClosureKeys(operation).map((key) => {
    const [code, itemPath] = key.split("\u0000");
    return { code, path: itemPath || null };
  });
  return ensureArray(asTask(task).action_items).filter((item) => {
    const typedItem = asActionItem(item);
    const code = asText(typedItem.code ?? typedItem.rule_id ?? typedItem.ruleId);
    const itemPath = asText(typedItem.path) || null;
    return closures.some(
      (closure) =>
        closure.code === code && (!closure.path || !itemPath || closure.path === itemPath),
    );
  });
}

export function taskAuthoringPackageName(repoRoot: string, task: unknown): string {
  const files = asTask(task).files;
  const resolved = resolveRepoPath(
    repoRoot,
    isRecord(files) ? asText(files.authoring_package) : "",
  );
  return resolved ? path.basename(resolved) : "";
}

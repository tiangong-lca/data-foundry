import path from "node:path";
import { loadTidasSchema } from "./context-inputs.mjs";
import { asText, ensureArray, resolveRepoPath } from "./runtime-io.ts";
import {
  evidenceEntries,
  evidenceSourceKeys,
  evidenceTraceKeys,
  firstNonEmptyEvidenceValue,
  hasNonEmptyTraceEvidence,
} from "./workflow-authoring-tasks.mjs";
import { isAnnualSupplyTarget } from "./workflow-queue-context.mjs";

// part-04.mjs
export function hasStructuredTraceEvidence(value) {
  return evidenceEntries(value)
    .filter((entry) => entry && typeof entry === "object" && !Array.isArray(entry))
    .some(
      (entry) =>
        firstNonEmptyEvidenceValue(entry, evidenceSourceKeys) &&
        firstNonEmptyEvidenceValue(entry, evidenceTraceKeys),
    );
}

export function objectTraceEntries(value, traceKey) {
  const entries = [];
  const visit = (node) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (Object.hasOwn(node, traceKey)) {
      entries.push(...ensureArray(node[traceKey]));
    }
    const commonOther = node["common:other"];
    if (commonOther && typeof commonOther === "object" && !Array.isArray(commonOther)) {
      if (Object.hasOwn(commonOther, traceKey)) {
        entries.push(...ensureArray(commonOther[traceKey]));
      }
    }
    for (const child of Object.values(node)) visit(child);
  };
  visit(value);
  return entries;
}

export function operationTraceEntries(operation, traceKey) {
  const pointer = asText(operation?.path);
  const value = operation?.value;
  if (pointer.includes(`/${traceKey}`)) return ensureArray(value);
  if (pointer.includes("/common:other")) return objectTraceEntries(value, traceKey);
  return objectTraceEntries(value, traceKey);
}

export function validateDeferredCommonOtherTrace({ operation, actionItems }) {
  const traceEntries = operationTraceEntries(operation, "tiangongfoundry:unresolvedTrace");
  const closureCodes = new Set(operationClosureCodes(operation));
  const actionCodes = new Set(
    ensureArray(actionItems)
      .map((item) => asText(item?.code ?? item?.rule_id ?? item?.ruleId))
      .filter(Boolean),
  );
  const acceptedCodes = closureCodes.size > 0 ? closureCodes : actionCodes;
  const blockers = [];
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
      .map((entry) => asText(entry?.action_item_code ?? entry?.actionItemCode ?? entry?.code))
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
    const status = asText(entry.status ?? entry.decision_status ?? entry.decisionStatus);
    const actionCode = asText(entry.action_item_code ?? entry.actionItemCode ?? entry.code);
    const blockedPath = asText(
      entry.blocked_path ?? entry.blockedPath ?? entry.field_path ?? entry.fieldPath ?? entry.path,
    );
    const reason = asText(entry.reason ?? entry.deferred_reason ?? entry.deferredReason);
    const nextAction = asText(
      entry.next_action ?? entry.nextAction ?? entry.follow_up ?? entry.followUp,
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
    const evidence = entry.evidence ?? entry.source_evidence ?? entry.sourceEvidence;
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

export function validateSourceExchangeCompletenessTrace(operation) {
  const traceEntries = operationTraceEntries(
    operation,
    "tiangongfoundry:sourceExchangeCompleteness",
  );
  const blockers = [];
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
    const status = asText(entry.status ?? entry.decision_status ?? entry.decisionStatus);
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
    const evidence = entry.evidence ?? entry.source_evidence ?? entry.sourceEvidence ?? entry.trace;
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

export function operationClosureCodes(operation) {
  return operationClosureKeys(operation)
    .map((key) => key.split("\u0000")[0])
    .filter(Boolean);
}

export function containsAiTemplatePlaceholder(value) {
  if (typeof value === "string") {
    return /__AI_FILL_[A-Z0-9_]*__|\/__AI_FILL_JSON_POINTER__/u.test(value);
  }
  if (Array.isArray(value)) return value.some((item) => containsAiTemplatePlaceholder(item));
  if (value && typeof value === "object") {
    return Object.values(value).some((item) => containsAiTemplatePlaceholder(item));
  }
  return false;
}

export function operationClosureKeys(operation) {
  const raw =
    operation?.closes ??
    operation?.closes_action_items ??
    operation?.closesActionItems ??
    operation?.action_items ??
    operation?.actionItems;
  return ensureArray(raw)
    .map((item) => {
      if (typeof item === "string") return `${item}\u0000`;
      const code = asText(
        item?.code ??
          item?.action_item_code ??
          item?.actionItemCode ??
          item?.rule_id ??
          item?.ruleId,
      );
      const itemPath = asText(item?.path ?? item?.json_path ?? item?.jsonPath);
      return code ? `${code}\u0000${itemPath}` : "";
    })
    .filter(Boolean);
}

export function operationClosesAnnualSupplyTarget(operation) {
  return operationClosureKeys(operation).some((key) => {
    const [code, itemPath] = key.split("\u0000");
    return isAnnualSupplyTarget(code, itemPath);
  });
}

export function categoryEntries(repoRoot, schemaFile) {
  const schema = loadTidasSchema(repoRoot, schemaFile);
  const entries = ensureArray(schema?.oneOf)
    .map((entry) => {
      const properties = entry?.properties ?? {};
      const levelText = asText(properties?.["@level"]?.const);
      const code = asText(
        properties?.["@classId"]?.const ??
          properties?.["@catId"]?.const ??
          properties?.["@code"]?.const,
      );
      const text = asText(properties?.["#text"]?.const);
      const level = levelText === "" ? Number.NaN : Number(levelText);
      return Number.isInteger(level) && code && text ? { level, code, text } : null;
    })
    .filter(Boolean);
  const byCode = new Map(entries.map((entry) => [entry.code, entry]));
  const parentByCode = new Map();
  const lastPerLevel = new Map();
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

export function categoryPathForCode(repoRoot, schemaFile, code) {
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

export function processCategoryPathForCode(repoRoot, code) {
  return categoryPathForCode(repoRoot, "tidas_processes_category.json", code);
}

export function classCode(value) {
  return asText(
    value?.["@classId"] ??
      value?.classId ??
      value?.class_id ??
      value?.["@catId"] ??
      value?.catId ??
      value?.cat_id,
  );
}

export function classText(value) {
  return asText(value?.["#text"] ?? value?.text ?? value?.label ?? value?.name);
}

export function classLevel(value) {
  const text = asText(value?.["@level"] ?? value?.level);
  return text === "" ? null : Number(text);
}

export function classificationItemsFromOperation(operation) {
  const value = operation?.value;
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const commonClass = value["common:class"];
  if (Array.isArray(commonClass)) return commonClass;
  if (commonClass && typeof commonClass === "object") return [commonClass];
  const commonCategory = value["common:category"];
  if (Array.isArray(commonCategory)) return commonCategory;
  if (commonCategory && typeof commonCategory === "object") return [commonCategory];
  const wrappedClassification = value["common:classification"];
  if (
    wrappedClassification &&
    typeof wrappedClassification === "object" &&
    !Array.isArray(wrappedClassification)
  ) {
    const wrappedClass = wrappedClassification["common:class"];
    if (Array.isArray(wrappedClass)) return wrappedClass;
    if (wrappedClass && typeof wrappedClass === "object") return [wrappedClass];
  }
  const wrappedElementary = value["common:elementaryFlowCategorization"];
  if (
    wrappedElementary &&
    typeof wrappedElementary === "object" &&
    !Array.isArray(wrappedElementary)
  ) {
    const wrappedCategory = wrappedElementary["common:category"];
    if (Array.isArray(wrappedCategory)) return wrappedCategory;
    if (wrappedCategory && typeof wrappedCategory === "object") return [wrappedCategory];
  }
  const classes = value.classes ?? value.classification_classes;
  if (Array.isArray(classes)) return classes;
  const categories = value.categories ?? value.category;
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
}) {
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
      const problems = [];
      if (level !== null && level !== expected.level) problems.push("level");
      if (text && text !== expected.text) problems.push("text");
      const itemCode = asText(item?.[codeAttribute]);
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

export function validateProcessClassificationDecisionOperation({ repoRoot, task, operation }) {
  if (asText(task?.entity?.dataset_type) !== "process") return [];
  return validateClassificationDecisionOperation({
    repoRoot,
    operation,
    schemaFile: "tidas_processes_category.json",
    codeAttribute: "@classId",
    datasetLabel: "Process",
    itemLabel: "common:classification.common:class",
  });
}

export function validateFlowClassificationDecisionOperation({ repoRoot, task, operation }) {
  if (asText(task?.entity?.dataset_type) !== "flow") return [];
  const actionPaths = ensureArray(task?.action_items)
    .map((item) => asText(item?.path))
    .filter(Boolean);
  const operationPath = asText(operation?.path);
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

export function locationCodeMapForPatch(repoRoot) {
  const schema = loadTidasSchema(repoRoot, "tidas_locations_category.json");
  return new Map(
    ensureArray(schema?.oneOf)
      .map((entry) => [asText(entry?.const), asText(entry?.description)])
      .filter(([code]) => code),
  );
}

export function locationCodeFromOperation(operation) {
  const value = operation?.value;
  if (typeof value === "string") return value.trim();
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return asText(
      value.code ??
        value.location ??
        value["@location"] ??
        value["@subLocation"] ??
        value["#text"] ??
        value.impactLocation ??
        value.interventionLocation ??
        value.intervensionSubLocation ??
        value.locationOfSupply,
    );
  }
  return "";
}

export function operationTargetsLocationCode(operation) {
  const pointer = asText(operation?.path);
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
  const value = operation?.value;
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return [...codeFields].some((field) => Object.hasOwn(value, field));
}

export function validateLocationDecisionOperation({ repoRoot, operation }) {
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

export function taskActionItemKeys(task) {
  return ensureArray(task?.action_items)
    .map((item) => {
      const code = asText(item?.code ?? item?.rule_id ?? item?.ruleId);
      const itemPath = asText(item?.path);
      return code ? `${code}\u0000${itemPath}` : "";
    })
    .filter(Boolean);
}

export function taskActionItemsForOperation(task, operation) {
  const closures = operationClosureKeys(operation).map((key) => {
    const [code, itemPath] = key.split("\u0000");
    return { code, path: itemPath || null };
  });
  return ensureArray(task?.action_items).filter((item) => {
    const code = asText(item?.code ?? item?.rule_id ?? item?.ruleId);
    const itemPath = asText(item?.path) || null;
    return closures.some(
      (closure) =>
        closure.code === code && (!closure.path || !itemPath || closure.path === itemPath),
    );
  });
}

export function taskAuthoringPackageName(repoRoot, task) {
  const resolved = resolveRepoPath(repoRoot, task?.files?.authoring_package);
  return resolved ? path.basename(resolved) : "";
}

import path from "node:path";
import { normalizeTidasLanguageCode } from "../../tidas-language-utils.ts";
import { fullContextAiCompletionRequirement } from "./context-inputs.ts";
import { dataSetInformation, datasetRoot } from "./dataset-payload.ts";
import { sha256Text } from "./hash-utils.ts";
import { annualSupplyMissingDataSentinelText } from "./prewrite-cleanup.ts";
import {
  asText,
  ensureArray,
  fileExists,
  readJson,
  repoRelativeArtifactPath,
  repoRelativePath,
  resolveRepoPath,
} from "./runtime-io.ts";
import { collectCommonOtherTraceEntries } from "./trace-summary.ts";
import { hasNonEmptyTraceEvidence } from "./workflow-authoring-tasks.ts";
import { hasStructuredTraceEvidence } from "./workflow-patch-evidence.ts";
import { isAnnualSupplyTarget } from "./workflow-queue-context.ts";

interface JsonRecord {
  [key: string]: unknown;
}

interface TextEntry {
  path: string;
  text: string;
}

interface SemanticActionOptions {
  code: string;
  path?: string | null;
  message: string;
  evidence?: unknown;
  instruction: string;
  common_other_deferral_allowed?: boolean;
  action_kind?: string;
}

interface SemanticAction extends JsonRecord {
  code: string;
  path: string | null;
  message: string;
  evidence: unknown;
  instruction: string;
}

interface PlaceholderOptions {
  allowNone?: boolean;
}

interface TraceObject {
  node: JsonRecord;
  trace_path: string;
}

interface TraceAttribute {
  object_name: string;
  attribute_name: string;
  value: string;
  trace_path: string;
}

interface ActionItem extends JsonRecord {
  source?: unknown;
  code?: unknown;
  rule_id?: unknown;
  ruleId?: unknown;
  path?: unknown;
  message?: unknown;
  evidence?: unknown;
  instruction?: unknown;
  action_kind?: unknown;
  required_owner?: unknown;
  ai_required?: unknown;
  common_other_deferral_allowed?: unknown;
  commonOtherDeferralAllowed?: unknown;
  deferral_cleanup_path?: unknown;
  deferral_trace_path?: unknown;
}

interface CompactActionItem extends JsonRecord {
  index: number;
  source: string | null;
  code: string;
  path: string | null;
  json_pointer: string;
  message: string | null;
  evidence: unknown;
  instruction: string | null;
  allowed_resolution_modes: string[];
  action_kind: string;
  required_owner: string;
  ai_required: boolean;
  common_other_deferral_allowed: boolean;
  deferral_cleanup_path: string | null;
  deferral_trace_path: string | null;
}

interface ProfileOptions {
  profile?: JsonRecord | null;
}

interface ClassificationOptions extends ProfileOptions {
  hasClassificationQueueContext?: boolean;
}

interface ProfileActionOptions extends ClassificationOptions {
  datasetType: string;
  payload: unknown;
  profile: JsonRecord | null | undefined;
}

interface ContentSaturationOptions extends SemanticActionOptions {
  datasetType: string;
}

interface SharedContextOptions {
  repoRoot: string;
  sharedContextBundle: unknown;
  sourceKind: string;
  sourcePath?: string | null;
}

interface NameFinding extends JsonRecord {
  code: string;
  path_field: string;
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asRecord(value: unknown): JsonRecord {
  return isRecord(value) ? value : {};
}

function asActionItem(value: unknown): ActionItem {
  return isRecord(value) ? value : {};
}

// part-02.mjs
export function collectTextEntries(value: unknown, pathName = ""): TextEntry[] {
  const entries: TextEntry[] = [];
  const visit = (node: unknown, currentPath: string): void => {
    if (typeof node === "string") {
      entries.push({ path: currentPath, text: node });
      return;
    }
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      node.forEach((item, index) => visit(item, `${currentPath}[${index}]`));
      return;
    }
    for (const [key, child] of Object.entries(node)) {
      if (key.startsWith("@")) continue;
      visit(child, currentPath ? `${currentPath}.${key}` : key);
    }
  };
  visit(value, pathName);
  return entries;
}

export function nameCarrier(root: unknown, datasetType: string): JsonRecord {
  const info = dataSetInformation(root, datasetType);
  return info?.name && typeof info.name === "object" ? info.name : {};
}

export function nameTextForPayload(payload: unknown, datasetType: string): string {
  const root = datasetRoot(payload, datasetType);
  return collectTextEntries(nameCarrier(root, datasetType))
    .map((entry) => entry.text)
    .join(" ");
}

export function flowTypeForPayload(payload: unknown): string {
  const root = datasetRoot(payload, "flow");
  return asText(
    root?.modellingAndValidation?.LCIMethod?.typeOfDataSet ??
      root?.modellingAndValidation?.LCIMethodAndAllocation?.typeOfDataSet,
  );
}

export function flowUsesElementaryClassification(payload: unknown): boolean {
  return /^elementary flow$/iu.test(flowTypeForPayload(payload));
}

export function flowUsesProductClassification(payload: unknown): boolean {
  const type = flowTypeForPayload(payload);
  return /^product flow$/iu.test(type) || /^waste flow$/iu.test(type);
}

export function classificationActionPathForPayload(payload: unknown, datasetType: string): string {
  if (datasetType === "flow") {
    return flowUsesElementaryClassification(payload)
      ? "flowDataSet.flowInformation.dataSetInformation.classificationInformation.common:elementaryFlowCategorization"
      : "flowDataSet.flowInformation.dataSetInformation.classificationInformation.common:classification";
  }
  return "processDataSet.processInformation.dataSetInformation.classificationInformation.common:classification";
}

export function classificationEntriesForPayload(
  payload: unknown,
  datasetType: string,
): Array<{ index: number; level: string; class_id: string; text: string }> {
  const root = datasetRoot(payload, datasetType);
  const info = dataSetInformation(root, datasetType);
  if (datasetType === "flow") {
    const classificationInformation = info?.classificationInformation ?? {};
    const categories =
      classificationInformation?.["common:elementaryFlowCategorization"]?.["common:category"] ??
      classificationInformation?.elementaryFlowCategorization?.category ??
      [];
    const classes =
      classificationInformation?.["common:classification"]?.["common:class"] ??
      classificationInformation?.classification?.class ??
      [];
    const items = flowUsesElementaryClassification(payload) ? categories : classes;
    return ensureArray(items)
      .filter((entry) => entry && typeof entry === "object")
      .map((entry, index) => ({
        index,
        level: asText(entry["@level"]),
        class_id: asText(entry["@classId"] ?? entry["@catId"]),
        text: asText(entry["#text"]),
      }));
  }
  const classes =
    info?.classificationInformation?.["common:classification"]?.["common:class"] ??
    info?.classificationInformation?.classification?.class ??
    [];
  return ensureArray(classes)
    .filter((entry) => entry && typeof entry === "object")
    .map((entry, index) => ({
      index,
      level: asText(entry["@level"]),
      class_id: asText(entry["@classId"] ?? entry["@catId"]),
      text: asText(entry["#text"]),
    }));
}

export function classificationPathForPayload(payload: unknown, datasetType: string): string {
  return classificationEntriesForPayload(payload, datasetType)
    .map((entry) => entry.text)
    .filter(Boolean)
    .join(" > ");
}

export function processExchangeList(payload: unknown): JsonRecord[] {
  const root = datasetRoot(payload, "process");
  return ensureArray(root?.exchanges?.exchange).filter(isRecord);
}

export function hasFoundryOtherEvidence(
  value: unknown,
  evidenceKey: string,
  acceptedStatuses: string[] = [],
): boolean {
  let found = false;
  const accepted = new Set(acceptedStatuses.map((status) => String(status).toLowerCase()));
  const visit = (node: unknown): void => {
    if (found || !node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }
    const record = node as JsonRecord;
    const other = record["common:other"];
    if (other && typeof other === "object" && !Array.isArray(other)) {
      const evidence = (other as JsonRecord)[evidenceKey];
      if (evidence !== undefined) {
        if (accepted.size === 0) {
          found = true;
          return;
        }
        for (const item of ensureArray(evidence)) {
          const typedItem = asRecord(item);
          const status = asText(
            typedItem.status ?? typedItem.decision_status ?? typedItem.decisionStatus,
          );
          if (status && accepted.has(status.toLowerCase())) {
            found = true;
            return;
          }
        }
      }
    }
    for (const child of Object.values(record)) visit(child);
  };
  visit(value);
  return found;
}

export function semanticActionItem({
  code,
  path: itemPath,
  message,
  evidence,
  instruction,
  common_other_deferral_allowed = false,
  action_kind = "ai_authoring",
}: SemanticActionOptions): SemanticAction {
  return {
    source: "profile_semantic_gate",
    code,
    path: itemPath ?? null,
    message,
    evidence: evidence ?? null,
    instruction,
    action_kind,
    required_owner: "foundry_ai_authoring",
    ai_required: true,
    common_other_deferral_allowed,
  };
}

export function textValue(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map(textValue).filter(Boolean).join(" | ");
  if (typeof value !== "object") return "";
  const record = value as JsonRecord;
  const direct = record["#text"] ?? record.text ?? record.value;
  if (direct !== undefined && direct !== value) return textValue(direct);
  return Object.entries(record)
    .filter(([key]) => !key.startsWith("@"))
    .map(([, child]) => textValue(child))
    .filter(Boolean)
    .join(" | ");
}

export function isPlaceholderishText(
  value: unknown,
  { allowNone = false }: PlaceholderOptions = {},
): boolean {
  const text = textValue(value);
  if (!text) return true;
  if (allowNone && /^none$/iu.test(text)) return false;
  return /^(na|n\/a|not specified|not declared|unspecified|undefined|-|--|unknown)$/iu.test(text);
}

export function hasMeaningfulFieldValue(value: unknown): boolean {
  return !isPlaceholderishText(value);
}

export function sourceTracePayloads(value: unknown): unknown[] {
  const payloads: unknown[] = [];
  const visit = (node: unknown): void => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }
    const record = node as JsonRecord;
    const trace = record["tidasimport:sourceTrace"];
    if (isRecord(trace) && trace.payload) {
      payloads.push(trace.payload);
    }
    for (const child of Object.values(record)) visit(child);
  };
  visit(value);
  return payloads;
}

export function traceObjectsNamed(value: unknown, names: unknown): TraceObject[] {
  const wanted = new Set(
    ensureArray(names)
      .map((name) => asText(name))
      .filter(Boolean),
  );
  const found: TraceObject[] = [];
  const visit = (node: unknown, pathParts: string[] = []): void => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      node.forEach((item, index) => visit(item, [...pathParts, String(index)]));
      return;
    }
    const record = node as JsonRecord;
    const name = asText(record.name);
    if (wanted.has(name) && Array.isArray(record.attributes)) {
      found.push({ node: record, trace_path: pathParts.join(".") || "<root>" });
    }
    for (const [key, child] of Object.entries(record)) visit(child, [...pathParts, key]);
  };
  for (const payload of ensureArray(value)) visit(payload);
  return found;
}

export function traceAttributeMap(traceObject: unknown): Map<string, string> {
  const record = asRecord(traceObject);
  return new Map(
    ensureArray(record.attributes)
      .map((attribute): [string, string] => {
        const typedAttribute = asRecord(attribute);
        return [asText(typedAttribute.name), textValue(typedAttribute.value)];
      })
      .filter(([name, value]) => Boolean(name && value)),
  );
}

export function firstTraceAttribute(
  payloads: unknown,
  objectNames: unknown,
  attributeNames: unknown,
  options: PlaceholderOptions = {},
): TraceAttribute | null {
  const names = ensureArray(attributeNames)
    .map((name) => asText(name))
    .filter(Boolean);
  for (const traceObject of traceObjectsNamed(payloads, objectNames)) {
    const attributes = traceAttributeMap(traceObject.node);
    for (const name of names) {
      const value = attributes.get(name);
      if (value && !isPlaceholderishText(value, options)) {
        return {
          object_name: asText(traceObject.node.name),
          attribute_name: name,
          value,
          trace_path: traceObject.trace_path,
        };
      }
    }
  }
  return null;
}

export function sourceTraceLanguage(payloads: unknown, fallback = "en"): string {
  const rawLanguage = (
    firstTraceAttribute(payloads, "dataSetInformation", "localLanguageCode")?.value ||
    firstTraceAttribute(payloads, "dataSetInformation", "languageCode")?.value ||
    fallback
  )
    .slice(0, 8)
    .toLowerCase();
  return normalizeTidasLanguageCode(rawLanguage, { field: "source trace language" });
}

export function multiLangSuggestion(value: unknown, language = "en"): JsonRecord {
  return {
    "@xml:lang": normalizeTidasLanguageCode(language),
    "#text": textValue(value),
  };
}

export function sourceTraceEvidence(
  attribute: TraceAttribute | null | undefined,
  extra: JsonRecord = {},
): JsonRecord {
  return {
    source: "tidasimport:sourceTrace",
    trace_path: attribute?.trace_path ?? null,
    object_name: attribute?.object_name ?? null,
    attribute_name: attribute?.attribute_name ?? null,
    value: attribute?.value ?? null,
    ...extra,
  };
}

export function locationCodeCandidate(value: unknown): string | null {
  const text = textValue(value);
  if (!text) return null;
  const normalized = text.replace(/[{}]/gu, "").trim();
  if (/^RoW$/u.test(normalized)) return normalized;
  if (/^[A-Z0-9]{2,}(?:[-+&][A-Z0-9]{2,})*$/u.test(normalized)) {
    return normalized;
  }
  return null;
}

export function flowNameLocationEvidence(root: JsonRecord): JsonRecord | null {
  const flowInformation = asRecord(root.flowInformation);
  const dataSetInfo = asRecord(flowInformation.dataSetInformation);
  const name = asRecord(dataSetInfo.name);
  const value = name.mixAndLocationTypes;
  const code = locationCodeCandidate(value);
  if (!code) return null;
  return {
    source: "flowDataSet.flowInformation.dataSetInformation.name.mixAndLocationTypes",
    source_kind: "flow_name_mix_and_location_types",
    value: textValue(value),
    suggested_value: code,
  };
}

export function nameFieldPath(datasetType: string, field: string): string {
  const prefix =
    datasetType === "flow"
      ? "flowDataSet.flowInformation.dataSetInformation.name"
      : datasetType === "lifecyclemodel"
        ? "lifeCycleModelDataSet.lifeCycleModelInformation.dataSetInformation.name"
        : "processDataSet.processInformation.dataSetInformation.name";
  return `${prefix}.${field}`;
}

// A trailing "{LOC}" brace in baseName that merely restates the dataset location
// (mixAndLocationTypes) is redundant, not an unsplit qualifier. Strip it before the
// base-segment scan so it does not raise a false
// `semantic_name_base_contains_unsplit_segments` finding (which would otherwise force an
// unsupported name split, e.g. "Tyre wear emissions, passenger car {RER}" with
// mixAndLocationTypes "RER"). Genuine qualifier braces, or location braces that do NOT
// match the dataset location, are left in place and still flagged.
function stripRedundantTrailingLocationBrace(baseName: unknown, mix: unknown): string {
  const text = String(baseName ?? "").trim();
  const match = /\{(?<code>[A-Z0-9][A-Z0-9+&-]*)\}\s*$/u.exec(text);
  if (!match?.groups?.code) return text;
  const mixCode = locationCodeCandidate(mix);
  if (!mixCode) return text;
  const braceCode = locationCodeCandidate(match.groups.code);
  if (!braceCode || braceCode !== mixCode) return text;
  return text.slice(0, match.index).trim();
}

export function namePlanQualityFindings(name: unknown): NameFinding[] {
  const typedName = asRecord(name);
  const baseName = textValue(typedName.baseName);
  const treatment = textValue(typedName.treatmentStandardsRoutes);
  const mix = textValue(typedName.mixAndLocationTypes);
  const quantitative =
    textValue(typedName.functionalUnitFlowProperties) || textValue(typedName.flowProperties);
  const findings: NameFinding[] = [];
  const sourceLocatorPatterns = [
    {
      kind: "latin-author-year",
      // Season/period qualifiers ("summer 2018") are temporal scope, not citations.
      regex:
        /\b(?!(?:summer|winter|spring|autumn|fall)\s)[A-Z][A-Za-z]+(?:\s+et\s+al\.)?\s+(?:19|20)\d{2}\b/iu,
    },
    {
      kind: "cjk-author-year",
      regex: /[\p{Script=Han}·]{2,12}\s*(?:19|20)\d{2}/u,
    },
    {
      kind: "numbered-table",
      regex: /\b(?:Table|Tbl\.)\s*\d+[A-Za-z]?\b/iu,
    },
    {
      kind: "numbered-table-cjk",
      regex: /表\s*\d+/u,
    },
    {
      kind: "numbered-figure",
      regex: /\b(?:Figure|Fig\.)\s*\d+[A-Za-z]?\b/iu,
    },
    {
      kind: "numbered-figure-cjk",
      regex: /图\s*\d+/u,
    },
  ];
  for (const field of [
    ["baseName", baseName],
    ["treatmentStandardsRoutes", treatment],
    ["mixAndLocationTypes", mix],
    ["functionalUnitFlowProperties", quantitative],
  ]) {
    const [fieldName, text] = field;
    if (!text) continue;
    const matches = sourceLocatorPatterns
      .filter((pattern) => pattern.regex.test(text))
      .map((pattern) => pattern.kind);
    if (matches.length === 0) continue;
    findings.push({
      code: "semantic_name_source_locator_in_name",
      field: fieldName,
      path_field: fieldName,
      text,
      evidence_kind: "name_plan_source_locator_scan",
      detected_segments: matches,
    });
  }

  const basePatterns = [
    {
      kind: "availability_or_location_phrase",
      regex:
        /\b(?:at|to)\s+(?:freight ship|ship|plant|user|grid|market|sawmill|refinery|warehouse|consumer|regional storage|power plant|feed mill)\b/iu,
    },
    {
      kind: "mix_phrase",
      regex: /\b(?:production|market|consumption)\s+mix\b/iu,
    },
    {
      kind: "source_location_after_production",
      regex: /\bproduction\s+[A-Z]{2,3}\b/u,
    },
    {
      kind: "braced_location_or_qualifier",
      regex: /\{[A-Z0-9][A-Z0-9+&-]*\}/u,
    },
  ];
  const baseNameForBaseScan = stripRedundantTrailingLocationBrace(baseName, mix);
  const baseMatches = basePatterns
    .filter((pattern) => pattern.regex.test(baseNameForBaseScan))
    .map((pattern) => pattern.kind);
  if (baseMatches.length > 0) {
    findings.push({
      code: "semantic_name_base_contains_unsplit_segments",
      field: "baseName",
      path_field: "baseName",
      text: baseName,
      evidence_kind: "name_plan_base_segment_scan",
      detected_segments: baseMatches,
    });
  }

  const quantitativeBaseMatches = [
    // "wet & dry processes" is a manufacturing-route phrase (fibreboard), not a moisture state.
    /\b(?:wet(?!\s*&\s*dry|\s+and\s+dry)|dry mass|measured as dry mass|moisture|water content|allocation exergy)\b/iu,
    /\b(?:net calorific value|gross calorific value|lower heating value|upper heating value)\b/iu,
  ]
    .filter((regex) => regex.test(baseName))
    .map((regex) => regex.source);
  const quantitativeContainsSpecificQualifier =
    /\b(?:wet(?!\s*&\s*dry|\s+and\s+dry)|dry mass|measured as dry mass|moisture|water content|allocation exergy|net calorific value|gross calorific value|lower heating value|upper heating value)\b/iu.test(
      quantitative,
    );
  if (quantitativeBaseMatches.length > 0 && !quantitativeContainsSpecificQualifier) {
    findings.push({
      code: "semantic_name_quantitative_property_not_split",
      field: "baseName",
      path_field: "baseName",
      text: baseName,
      evidence_kind: "name_plan_quantitative_segment_scan",
      detected_segments: quantitativeBaseMatches,
    });
  }

  if (/^source-described route$/iu.test(treatment)) {
    findings.push({
      code: "semantic_name_treatment_placeholder",
      field: "treatmentStandardsRoutes",
      path_field: "treatmentStandardsRoutes",
      text: treatment,
      evidence_kind: "name_plan_placeholder_scan",
    });
  }

  const mixCode = locationCodeCandidate(mix);
  if (mixCode && mix === mixCode) {
    findings.push({
      code: "semantic_name_mix_location_too_bare",
      field: "mixAndLocationTypes",
      path_field: "mixAndLocationTypes",
      text: mix,
      evidence_kind: "name_plan_mix_location_scan",
      location_code_candidate: mixCode,
    });
  }

  return findings;
}

export function collectNamePlanQualitySemanticActions(
  payload: unknown,
  datasetType: string,
): SemanticAction[] {
  if (!["flow", "process", "lifecyclemodel"].includes(datasetType)) return [];
  const root = datasetRoot(payload, datasetType);
  const name = nameCarrier(root, datasetType);
  const findings = namePlanQualityFindings(name);
  return findings.map((finding) =>
    semanticActionItem({
      code: finding.code,
      path: nameFieldPath(datasetType, finding.path_field),
      message:
        finding.code === "semantic_name_treatment_placeholder"
          ? "name.treatmentStandardsRoutes still contains the generated placeholder source-described route."
          : finding.code === "semantic_name_mix_location_too_bare"
            ? "name.mixAndLocationTypes contains only a bare location code; the name plan should include the availability/mix/location-type phrase and keep the code in the formal geography/location field."
            : finding.code === "semantic_name_source_locator_in_name"
              ? "name contains source citation or source-locator text that belongs in provenance, source references, or source-backed property evidence rather than the dataset name."
              : finding.code === "semantic_name_quantitative_property_not_split"
                ? "name.baseName contains quantitative or allocation qualifiers that should be split into the formal name property field when source-backed."
                : "name.baseName contains route, mix, availability, or location segments that should be split into the structured TIDAS name fields.",
      evidence: {
        ...finding,
        current_name: {
          baseName: textValue(name?.baseName) || null,
          treatmentStandardsRoutes: textValue(name?.treatmentStandardsRoutes) || null,
          mixAndLocationTypes: textValue(name?.mixAndLocationTypes) || null,
          functionalUnitFlowProperties:
            textValue(name?.functionalUnitFlowProperties) ||
            textValue(name?.flowProperties) ||
            null,
        },
      },
      instruction:
        "Use the source-language name-plan workflow and full source context to split the name once: baseName keeps only the core product/process/service name; treatmentStandardsRoutes receives production/treatment/route qualifiers; mixAndLocationTypes receives availability, mix, and location-type phrases such as at plant {CH}; functionalUnitFlowProperties or flowProperties receives quantitative qualifiers. Preserve the original full source name in provenance/mapping, not in baseName.",
    }),
  );
}

export function sourceTraceLocationEvidence(traces: unknown): JsonRecord | null {
  const candidates = [
    firstTraceAttribute(traces, "exchange", "location"),
    firstTraceAttribute(
      traces,
      ["flow", "flowInformation", "dataSetInformation"],
      ["locationOfSupply", "mixAndLocationTypes", "location"],
    ),
    firstTraceAttribute(
      traces,
      ["process", "processInformation", "geography"],
      ["locationOfOperationSupplyOrProduction", "@location", "location"],
    ),
  ].filter((candidate): candidate is TraceAttribute => candidate !== null);
  if (candidates.length === 0) return null;
  const primary = candidates[0];
  return sourceTraceEvidence(primary, {
    suggested_value: locationCodeCandidate(primary.value) ?? primary.value,
    candidate_sources: candidates.map((candidate) => ({
      object_name: candidate.object_name,
      attribute_name: candidate.attribute_name,
      value: candidate.value,
      trace_path: candidate.trace_path,
      location_code_candidate: locationCodeCandidate(candidate.value),
    })),
  });
}

export function collectTextQualitySemanticActions(
  payload: unknown,
  datasetType: string,
): SemanticAction[] {
  const entries = collectTextEntries(payload);
  const actions: SemanticAction[] = [];
  const seen = new Set<string>();
  const add = (item: SemanticAction): void => {
    const key = JSON.stringify([item.code, item.path, item.message]);
    if (seen.has(key)) return;
    seen.add(key);
    actions.push(item);
  };
  for (const entry of entries) {
    const text = entry.text.trim();
    if (!text) continue;
    const pathLower = entry.path.toLowerCase();
    const isNameLike =
      pathLower.includes(".name.") ||
      pathLower.endsWith(".common:shortdescription.#text") ||
      pathLower.endsWith(".common:shortname.#text") ||
      pathLower.endsWith(".common:name.#text") ||
      pathLower.includes("functionalunitorother");
    if (
      /__AI_FILL_[A-Z0-9_]*__|TIDAS_IMPORT_PLACEHOLDER|UNSPECIFIED_TEXT|Not declared in source package|placeholder\.example|pending-confirmation/iu.test(
        text,
      )
    ) {
      add(
        semanticActionItem({
          code: "semantic_placeholder_text",
          path: entry.path,
          message:
            "Payload contains placeholder or unresolved import text that schema validation alone cannot accept.",
          evidence: { text },
          instruction:
            "Use the full schema/YAML/context authoring package to replace this with source-language content, or move unresolved provenance into common:other when schema permits.",
        }),
      );
    }
    if (/\bxx\b/iu.test(text) && isNameLike) {
      add(
        semanticActionItem({
          code: "semantic_name_placeholder_token",
          path: entry.path,
          message: 'Name-like text contains the placeholder token "xx".',
          evidence: { text },
          instruction:
            "Derive a source-language name plan from source evidence and TIDAS name YAML semantics; do not keep placeholder tokens in final name fields.",
        }),
      );
    }
    if (/\{[A-Z]{2,3}\}/u.test(text) && isNameLike) {
      add(
        semanticActionItem({
          code: "semantic_geography_token_in_name",
          path: entry.path,
          message:
            "Name-like text contains a geography token such as {GLO}; geography belongs in the geography/location fields or name-plan mix/location segment as defined by the contract.",
          evidence: { text },
          instruction:
            "Use the full schema/YAML/context authoring package to split geography out of base names and materialize display names from proper fields.",
        }),
      );
    }
    if (
      /\bBAFU ecoSpold1 source\b/iu.test(text) &&
      /\b(Not specified|No |not declared|is specified)\b/iu.test(text)
    ) {
      add(
        semanticActionItem({
          code: "semantic_source_system_boilerplate_visible",
          path: entry.path,
          message:
            "User-facing text contains source-system boilerplate. Source-system details should be evidence/provenance, not visible filler.",
          evidence: { text },
          instruction:
            'Use neutral source-language text such as "Not specified" when the schema requires content; preserve BAFU/ecoSpold provenance in evidence or common:other.',
          common_other_deferral_allowed: true,
        }),
      );
    }
    if (/\/Users\/|\.zip:|LCI ecoSpold version2 Files/iu.test(text)) {
      add(
        semanticActionItem({
          code: "semantic_local_source_path_visible",
          path: entry.path,
          message: "Payload contains local source path or package trace text in a visible field.",
          evidence: { text },
          instruction:
            "Move local/package trace to authoring evidence or safe common:other provenance before remote write.",
          common_other_deferral_allowed: true,
        }),
      );
    }
  }
  return actions.map((item) => ({ ...item, dataset_type: datasetType }));
}

export function isBafuConvertedDefaultProcessClassification(classificationPath: string): boolean {
  return /Other service activities\s*>\s*Activities of membership organizations\s*>\s*Activities of other membership organizations\s*>\s*Activities of other membership organizations n\.e\.c\.|Community,\s*social and personal services\s*>\s*Sewage and waste collection,\s*treatment and disposal and other environmental protection services\s*>\s*Other environmental protection services n\.e\.c\./iu.test(
    classificationPath,
  );
}

export function collectClassificationSemanticActions(
  payload: unknown,
  datasetType: string,
  { profile = null, hasClassificationQueueContext = false }: ClassificationOptions = {},
): SemanticAction[] {
  if (!["flow", "process"].includes(datasetType)) return [];
  const classes = classificationEntriesForPayload(payload, datasetType);
  const classificationPath = classificationPathForPayload(payload, datasetType);
  const nameText = nameTextForPayload(payload, datasetType);
  const actions: SemanticAction[] = [];
  if (classes.length === 0) {
    actions.push(
      semanticActionItem({
        code: "semantic_classification_missing",
        path: classificationActionPathForPayload(payload, datasetType),
        message: "Dataset is missing target classification information.",
        instruction:
          "Select the target TianGong/TIDAS classification from full source context and record the decision basis.",
      }),
    );
    return actions;
  }
  const sourceLooksIndustrial =
    /\b(hydrometallurgical|Li-ion|battery|batteries|Li salt|lithium|processing)\b/iu.test(nameText);
  const sourceLooksWasteTreatment =
    /\b(disposal|waste treatment|treatment of|treatment,? (?:of )?.*batteries)\b/iu.test(nameText);
  const classificationLooksService =
    /membership organizations|community, social and personal services|environmental protection services|other service activities/iu.test(
      classificationPath,
    );
  const classificationLooksWasteTreatment =
    /waste (?:collection,\s*)?treatment and disposal|waste treatment|hazardous waste treatment|waste treatment services/iu.test(
      classificationPath,
    );
  if (
    !hasClassificationQueueContext &&
    (datasetType === "process" ||
      (datasetType === "flow" && flowUsesProductClassification(payload))) &&
    asText(profile?.id).toLowerCase() === "bafu" &&
    isBafuConvertedDefaultProcessClassification(classificationPath)
  ) {
    actions.push(
      semanticActionItem({
        code: "semantic_classification_converted_default",
        path: classificationActionPathForPayload(payload, datasetType),
        message: `BAFU ${datasetType} classification still has the converter default service path and must be replaced with a target TIDAS classification.`,
        evidence: {
          name_text: nameText,
          classification_path: classificationPath,
        },
        instruction: `Use the BAFU source context, classification queue/candidates when available, and the full schema/YAML/context package to choose the target TianGong/TIDAS ${datasetType} classification.`,
      }),
    );
  }
  if (
    sourceLooksIndustrial &&
    classificationLooksService &&
    !(sourceLooksWasteTreatment && classificationLooksWasteTreatment)
  ) {
    actions.push(
      semanticActionItem({
        code: "semantic_classification_mismatch",
        path:
          datasetType === "flow"
            ? "flowDataSet.flowInformation.dataSetInformation.classificationInformation.common:classification"
            : "processDataSet.processInformation.dataSetInformation.classificationInformation.common:classification",
        message:
          "The selected classification appears to be copied from source/converted data and does not match the dataset semantics.",
        evidence: {
          name_text: nameText,
          classification_path: classificationPath,
        },
        instruction:
          "Use the classification command/candidates and full schema/YAML/context package to choose a target TianGong/TIDAS classification, and keep source classification only as provenance.",
      }),
    );
  }
  return actions;
}

export function effectiveContentDatasetType(payload: unknown, datasetType: string): string {
  const record = asRecord(payload);
  if (record.processDataSet) return "process";
  if (record.flowDataSet) return "flow";
  if (record.sourceDataSet) return "source";
  if (record.contactDataSet) return "contact";
  return datasetType;
}

export function contentSaturationAction({
  datasetType,
  code,
  path: itemPath,
  message,
  evidence,
  instruction,
  common_other_deferral_allowed = false,
}: ContentSaturationOptions): SemanticAction {
  return {
    ...semanticActionItem({
      code,
      path: itemPath,
      message,
      evidence,
      instruction,
      common_other_deferral_allowed,
    }),
    dataset_type: datasetType,
    saturation_gate: true,
  };
}

export function collectProcessContentSaturationActions(payload: unknown): SemanticAction[] {
  const root = datasetRoot(payload, "process");
  const info = root?.processInformation?.dataSetInformation ?? {};
  const representativeness =
    root?.modellingAndValidation?.dataSourcesTreatmentAndRepresentativeness ?? {};
  const traces = sourceTracePayloads(payload);
  if (traces.length === 0) return [];

  const actions: SemanticAction[] = [];
  const localName = firstTraceAttribute(traces, "referenceFunction", "localName");
  if (localName && !hasMeaningfulFieldValue(info["common:synonyms"])) {
    const language = sourceTraceLanguage(traces, "de");
    actions.push(
      contentSaturationAction({
        datasetType: "process",
        code: "semantic_content_saturation_process_synonyms_missing",
        path: "processDataSet.processInformation.dataSetInformation.common:synonyms",
        message:
          "Source trace contains a local/alternative process name, but process synonyms are empty.",
        evidence: sourceTraceEvidence(localName, {
          suggested_value: multiLangSuggestion(localName.value, language),
        }),
        instruction:
          "Use source trace and TIDAS process schema semantics to add the source-local process name as common:synonyms. Preserve the source language; do not invent translations.",
      }),
    );
  }

  const percent = firstTraceAttribute(traces, "representativeness", "percent");
  if (percent && !hasMeaningfulFieldValue(representativeness.percentageSupplyOrProductionCovered)) {
    actions.push(
      contentSaturationAction({
        datasetType: "process",
        code: "semantic_content_saturation_process_percentage_missing",
        path: "processDataSet.modellingAndValidation.dataSourcesTreatmentAndRepresentativeness.percentageSupplyOrProductionCovered",
        message:
          "Source trace contains representativeness.percent, but percentageSupplyOrProductionCovered is empty.",
        evidence: sourceTraceEvidence(percent, { suggested_value: percent.value }),
        instruction:
          "Fill percentageSupplyOrProductionCovered from representativeness.percent when the value is physically meaningful for the represented market/location.",
      }),
    );
  }

  const uncertaintyAdjustments = firstTraceAttribute(
    traces,
    "representativeness",
    "uncertaintyAdjustments",
    { allowNone: true },
  );
  if (
    uncertaintyAdjustments &&
    !hasMeaningfulFieldValue(representativeness.uncertaintyAdjustments)
  ) {
    actions.push(
      contentSaturationAction({
        datasetType: "process",
        code: "semantic_content_saturation_process_uncertainty_adjustments_missing",
        path: "processDataSet.modellingAndValidation.dataSourcesTreatmentAndRepresentativeness.uncertaintyAdjustments",
        message:
          "Source trace contains uncertainty adjustment information, but uncertaintyAdjustments is empty.",
        evidence: sourceTraceEvidence(uncertaintyAdjustments, {
          suggested_value: multiLangSuggestion(uncertaintyAdjustments.value, "en"),
        }),
        instruction:
          "Fill uncertaintyAdjustments from source trace when the source explicitly states a value such as none; preserve source wording.",
      }),
    );
  }
  return actions;
}

export function flowReferencePropertyNames(root: JsonRecord): string[] {
  const flowProperties = asRecord(root.flowProperties);
  return ensureArray(flowProperties.flowProperty)
    .map((property) => {
      const reference = asRecord(asRecord(property).referenceToFlowPropertyDataSet);
      return textValue(reference["common:shortDescription"] ?? reference.shortDescription);
    })
    .filter(Boolean);
}

export function collectFlowContentSaturationActions(payload: unknown): SemanticAction[] {
  const root = datasetRoot(payload, "flow");
  const info = root?.flowInformation?.dataSetInformation ?? {};
  const traces = sourceTracePayloads(payload);
  const actions: SemanticAction[] = [];
  const locationEvidence = sourceTraceLocationEvidence(traces) ?? flowNameLocationEvidence(root);
  if (
    locationEvidence &&
    !hasMeaningfulFieldValue(root?.flowInformation?.geography?.locationOfSupply)
  ) {
    actions.push(
      contentSaturationAction({
        datasetType: "flow",
        code: "semantic_content_saturation_flow_location_of_supply_missing",
        path: "flowDataSet.flowInformation.geography.locationOfSupply",
        message:
          "Flow context contains a location-of-supply candidate, but flow locationOfSupply is empty.",
        evidence: locationEvidence,
        instruction:
          "Fill locationOfSupply with the source-backed TIDAS/ILCD location code when the candidate is valid. If the candidate is not a valid code or conflicts with process/exchange geography, keep the scope blocked for location authoring.",
      }),
    );
  }

  const propertyNames = flowReferencePropertyNames(root);
  if (propertyNames.length > 0 && !hasMeaningfulFieldValue(info.name?.flowProperties)) {
    actions.push(
      contentSaturationAction({
        datasetType: "flow",
        code: "semantic_content_saturation_flow_quantitative_properties_missing",
        path: "flowDataSet.flowInformation.dataSetInformation.name.flowProperties",
        message:
          "Flow reference property evidence exists, but the name.flowProperties descriptor is empty.",
        evidence: {
          source: "flowDataSet.flowProperties.flowProperty.referenceToFlowPropertyDataSet",
          reference_flow_properties: propertyNames,
          suggested_value: multiLangSuggestion(propertyNames.join(", "), "en"),
        },
        instruction:
          "Fill the TIDAS flow name.flowProperties descriptor from the referenced quantitative flow property names when the values are not redundant with the base name.",
      }),
    );
  }

  const generalComment = firstTraceAttribute(traces, "exchange", "generalComment", {
    allowNone: true,
  });
  if (generalComment && !hasMeaningfulFieldValue(info["common:generalComment"])) {
    actions.push(
      contentSaturationAction({
        datasetType: "flow",
        code: "semantic_content_saturation_flow_general_comment_missing",
        path: "flowDataSet.flowInformation.dataSetInformation.common:generalComment",
        message: "Source trace contains exchange.generalComment, but flow generalComment is empty.",
        evidence: sourceTraceEvidence(generalComment, {
          suggested_value: multiLangSuggestion(generalComment.value, "en"),
        }),
        instruction:
          "Promote source-backed exchange generalComment into the product/waste flow comment when it describes the flow meaning, assumptions, or geography; otherwise preserve a structured reason in patch evidence.",
      }),
    );
  }
  return actions;
}

export function collectSourceContentSaturationActions(payload: unknown): SemanticAction[] {
  const root = datasetRoot(payload, "source");
  const info = root?.sourceInformation?.dataSetInformation ?? {};
  const traces = sourceTracePayloads(payload);
  if (traces.length === 0) return [];
  const sourceObjects = traceObjectsNamed(traces, "source");
  if (sourceObjects.length === 0) return [];
  const description = textValue(info.sourceDescriptionOrComment);
  const requiredAttributes = [
    "firstAuthor",
    "additionalAuthors",
    "year",
    "title",
    "titleOfAnthology",
    "placeOfPublications",
    "publisher",
    "volumeNo",
  ];
  const missing: JsonRecord[] = [];
  for (const traceObject of sourceObjects) {
    const attributes = traceAttributeMap(traceObject.node);
    for (const attributeName of requiredAttributes) {
      const value = attributes.get(attributeName);
      if (!value || isPlaceholderishText(value)) continue;
      if (!description.toLowerCase().includes(value.toLowerCase())) {
        missing.push({
          object_name: asText(traceObject.node.name),
          attribute_name: attributeName,
          value,
          trace_path: traceObject.trace_path,
        });
      }
    }
  }
  if (missing.length === 0) return [];
  return [
    contentSaturationAction({
      datasetType: "source",
      code: "semantic_content_saturation_source_description_incomplete",
      path: "sourceDataSet.sourceInformation.dataSetInformation.sourceDescriptionOrComment",
      message:
        "Source trace contains bibliographic fields that are not represented in sourceDescriptionOrComment.",
      evidence: {
        source: "tidasimport:sourceTrace",
        missing_bibliographic_fields: missing,
        current_description: description || null,
      },
      instruction:
        "Expand sourceDescriptionOrComment from the trace-backed bibliographic fields in one evidence-backed patch. Preserve source wording and do not invent DOI/URL values that are absent from context.",
    }),
  ];
}

export function collectContactContentSaturationActions(
  payload: unknown,
  { profile = null }: ProfileOptions = {},
): SemanticAction[] {
  const root = datasetRoot(payload, "contact");
  const info = root?.contactInformation?.dataSetInformation ?? {};
  if (asText(profile?.id).toLowerCase() !== "bafu") return [];
  const name = textValue(info["common:name"] ?? info["common:shortName"]);
  if (!/\b(BAFU|FOEN|Federal Office for the Environment)\b/iu.test(name)) return [];
  const required = [
    ["WWWAddress", "contactDataSet.contactInformation.dataSetInformation.WWWAddress"],
    ["email", "contactDataSet.contactInformation.dataSetInformation.email"],
    ["telephone", "contactDataSet.contactInformation.dataSetInformation.telephone"],
    ["contactAddress", "contactDataSet.contactInformation.dataSetInformation.contactAddress"],
    [
      "centralContactPoint",
      "contactDataSet.contactInformation.dataSetInformation.centralContactPoint",
    ],
  ].filter(([field]) => !hasMeaningfulFieldValue(info[field]));
  if (required.length === 0) return [];
  return [
    contentSaturationAction({
      datasetType: "contact",
      code: "semantic_content_saturation_bafu_contact_incomplete",
      path: "contactDataSet.contactInformation.dataSetInformation",
      message:
        "BAFU/FOEN library contact is missing one or more official contact fields required by the BAFU import profile.",
      evidence: {
        contact_name: name,
        missing_fields: required.map(([field, itemPath]) => ({ field, path: itemPath })),
        profile_source: "docs/import-profiles/bafu/constraints.md",
      },
      instruction:
        "Fill the shared BAFU/FOEN contact fields from the profile-approved official contact evidence: website, email, telephone, postal address, and central contact point.",
    }),
  ];
}

export function collectContentSaturationSemanticActions(
  payload: unknown,
  datasetType: string,
  { profile = null }: ProfileOptions = {},
): SemanticAction[] {
  const effectiveDatasetType = effectiveContentDatasetType(payload, datasetType);
  if (effectiveDatasetType === "process") return collectProcessContentSaturationActions(payload);
  if (effectiveDatasetType === "flow") return collectFlowContentSaturationActions(payload);
  if (effectiveDatasetType === "source") return collectSourceContentSaturationActions(payload);
  if (effectiveDatasetType === "contact") {
    return collectContactContentSaturationActions(payload, { profile });
  }
  return [];
}

export function collectProcessExchangeSemanticActions(payload: unknown): SemanticAction[] {
  const exchanges = processExchangeList(payload);
  if (exchanges.length === 0) return [];
  const directions = exchanges.map((exchange) => asText(exchange.exchangeDirection));
  const hasInput = directions.some((direction) => /^input$/iu.test(direction));
  const hasOnlyOutput =
    directions.length > 0 && directions.every((direction) => /^output$/iu.test(direction));
  if (
    !hasInput &&
    hasOnlyOutput &&
    !hasFoundryOtherEvidence(payload, "tiangongfoundry:sourceExchangeCompleteness", [
      "source_only_output_exchange_verified",
      "accepted_source_only_output",
      "verified",
    ])
  ) {
    return [
      semanticActionItem({
        code: "semantic_process_only_output_exchange_requires_review",
        path: "processDataSet.exchanges.exchange",
        message:
          "Process exchanges contain outputs only. This may be source-faithful, but it must be explicitly verified against the source package before remote write.",
        evidence: { exchange_count: exchanges.length, directions },
        instruction:
          "Analyze source EcoSpold/TIDAS trace in the full authoring package. If source really has only outputs, add evidence under common:other.tiangongfoundry:sourceExchangeCompleteness; otherwise repair the exchange set.",
      }),
    ];
  }
  return [];
}

export function collectFoundryTraceSemanticActions(
  payload: unknown,
  datasetType: string,
): SemanticAction[] {
  const actions: SemanticAction[] = [];
  const add = (item: SemanticAction): number =>
    actions.push({ ...item, dataset_type: datasetType });
  for (const trace of collectCommonOtherTraceEntries(payload, "tiangongfoundry:unresolvedTrace")) {
    const entry = trace.entry;
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      add(
        semanticActionItem({
          code: "semantic_unresolved_trace_invalid",
          path: trace.path,
          message:
            "common:other.tiangongfoundry:unresolvedTrace entries must be structured JSON objects.",
          evidence: { trace: entry ?? null },
          instruction:
            "Rewrite the unresolved trace with status, action_item_code, blocked_path, reason, evidence, and next_action.",
          common_other_deferral_allowed: true,
        }),
      );
      continue;
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
    const evidence = typedEntry.evidence ?? typedEntry.source_evidence ?? typedEntry.sourceEvidence;
    const invalidReasons: string[] = [];
    if (!["unresolved_deferred", "deferred_to_common_other", "needs_followup"].includes(status)) {
      invalidReasons.push("status");
    }
    if (!actionCode) invalidReasons.push("action_item_code");
    if (!blockedPath) invalidReasons.push("blocked_path");
    if (!reason) invalidReasons.push("reason");
    if (!hasNonEmptyTraceEvidence(evidence)) {
      invalidReasons.push("evidence");
    } else if (!hasStructuredTraceEvidence(evidence)) {
      invalidReasons.push("evidence_pointer");
    }
    if (!nextAction) invalidReasons.push("next_action");
    if (invalidReasons.length > 0) {
      add(
        semanticActionItem({
          code: "semantic_unresolved_trace_invalid",
          path: trace.path,
          message: `common:other.tiangongfoundry:unresolvedTrace is missing or has invalid fields: ${invalidReasons.join(", ")}.`,
          evidence: { invalid_fields: invalidReasons, trace: typedEntry },
          instruction:
            "Rewrite the unresolved trace with status, action_item_code, blocked_path, reason, evidence, and next_action.",
          common_other_deferral_allowed: true,
        }),
      );
    }
  }

  for (const trace of collectCommonOtherTraceEntries(
    payload,
    "tiangongfoundry:sourceExchangeCompleteness",
  )) {
    const entry = trace.entry;
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      add(
        semanticActionItem({
          code: "semantic_source_exchange_trace_invalid",
          path: trace.path,
          message:
            "common:other.tiangongfoundry:sourceExchangeCompleteness entries must be structured JSON objects.",
          evidence: { trace: entry ?? null },
          instruction:
            "Rewrite source exchange completeness evidence with accepted status and source trace evidence.",
          common_other_deferral_allowed: true,
        }),
      );
      continue;
    }
    const typedEntry = entry as JsonRecord;
    const status = asText(
      typedEntry.status ?? typedEntry.decision_status ?? typedEntry.decisionStatus,
    );
    const evidence =
      typedEntry.evidence ??
      typedEntry.source_evidence ??
      typedEntry.sourceEvidence ??
      typedEntry.trace;
    const invalidReasons: string[] = [];
    if (
      !["source_only_output_exchange_verified", "accepted_source_only_output", "verified"].includes(
        status,
      )
    ) {
      invalidReasons.push("status");
    }
    if (!hasNonEmptyTraceEvidence(evidence)) {
      invalidReasons.push("evidence");
    } else if (!hasStructuredTraceEvidence(evidence)) {
      invalidReasons.push("evidence_pointer");
    }
    if (invalidReasons.length > 0) {
      add(
        semanticActionItem({
          code: "semantic_source_exchange_trace_invalid",
          path: trace.path,
          message: `common:other.tiangongfoundry:sourceExchangeCompleteness is missing or has invalid fields: ${invalidReasons.join(", ")}.`,
          evidence: { invalid_fields: invalidReasons, trace: typedEntry },
          instruction:
            "Rewrite source exchange completeness evidence with accepted status and source trace evidence.",
          common_other_deferral_allowed: true,
        }),
      );
    }
  }
  return actions;
}

export function collectFlowReuseSemanticActions(
  payload: unknown,
  datasetType: string,
): SemanticAction[] {
  if (datasetType !== "flow") return [];
  if (!flowUsesElementaryClassification(payload)) return [];
  const classification = classificationEntriesForPayload(payload, "flow")
    .map((entry) => entry.text)
    .filter(Boolean)
    .join(" > ");
  return [
    semanticActionItem({
      code: "elementary_flow_requires_existing_database_match",
      path: "flowDataSet.flowInformation.dataSetInformation",
      message:
        "Elementary flow rows cannot be published as BAFU-owned flows. They must be resolved to an existing TianGong database elementary flow before any process that references them can be written.",
      evidence: {
        flow_type: flowTypeForPayload(payload) || null,
        source_flow_name: nameTextForPayload(payload, "flow") || null,
        source_classification: classification || null,
      },
      instruction:
        "Search TianGong existing elementary flows by UUID/version first, then CAS/name/category/synonyms and structured semantic candidates. Output a mapping to the selected existing flow and rewrite process exchange references. If no defensible existing flow exists, keep the flow unresolved in the mapping queue and block the referencing process write.",
      action_kind: "identity_decision_authoring",
    }),
  ];
}

export function collectProfileSemanticActionItems({
  profile,
  datasetType,
  payload,
  hasClassificationQueueContext = false,
}: ProfileActionOptions): SemanticAction[] {
  const requirement = fullContextAiCompletionRequirement(profile, datasetType);
  const profileId = asText(profile?.id).toLowerCase();
  const requiresBafuSupportSemanticGate =
    profileId === "bafu" && ["support", "contact", "source"].includes(datasetType);
  if (!requirement && !requiresBafuSupportSemanticGate) return [];
  return [
    ...collectTextQualitySemanticActions(payload, datasetType),
    ...collectNamePlanQualitySemanticActions(payload, datasetType),
    ...collectClassificationSemanticActions(payload, datasetType, {
      profile,
      hasClassificationQueueContext,
    }),
    ...collectContentSaturationSemanticActions(payload, datasetType, { profile }),
    ...collectFlowReuseSemanticActions(payload, datasetType),
    ...(datasetType === "process" ? collectProcessExchangeSemanticActions(payload) : []),
    ...collectFoundryTraceSemanticActions(payload, datasetType),
  ];
}

export function jsonPointerToken(value: unknown): string {
  return String(value).replace(/~/gu, "~0").replace(/\//gu, "~1");
}

export function dotPathToJsonPointer(value: unknown): string {
  const text = asText(value);
  if (!text || text === "<root>") return "/__AI_FILL_JSON_POINTER__";
  if (text.startsWith("/")) return text;
  const normalized = text.replace(/\[(\d+)\]/gu, ".$1").replace(/^\.+|\.+$/gu, "");
  const tokens = normalized
    .split(".")
    .map((token) => token.trim())
    .filter(Boolean);
  if (tokens.length === 0) return "/__AI_FILL_JSON_POINTER__";
  return `/${tokens.map(jsonPointerToken).join("/")}`;
}

export function actionItemClosure(item: unknown): { code: string; path?: string } {
  const typedItem = asActionItem(item);
  const code = asText(typedItem.code ?? typedItem.rule_id ?? typedItem.ruleId) || "action_item";
  const itemPath = asText(typedItem.path) || null;
  return {
    code,
    ...(itemPath ? { path: itemPath } : {}),
  };
}

export const allowedPatchResolutionModes = new Set([
  "evidence_backed_completion",
  "source_language_normalization",
  "classification_decision",
  "location_decision",
  "exchange_set_repaired",
  "source_trace_verified",
  "deferred_to_common_other",
]);

export function actionItemAllowsCommonOtherDeferral(item: unknown): boolean {
  const typedItem = asActionItem(item);
  if (
    typedItem.common_other_deferral_allowed === true ||
    typedItem.commonOtherDeferralAllowed === true
  ) {
    return true;
  }
  const code = asText(typedItem.code ?? typedItem.rule_id ?? typedItem.ruleId);
  const itemPath = asText(typedItem.path);
  if (isAnnualSupplyTarget(code, itemPath)) return true;
  return [
    "source_system_boilerplate",
    "local_source_path_visible",
    "trace_visible",
    "provenance_visible",
  ].some((token) => code.includes(token));
}

export function actionItemResolutionModes(item: unknown): string[] {
  const typedItem = asActionItem(item);
  const code = asText(typedItem.code ?? typedItem.rule_id ?? typedItem.ruleId);
  const itemPath = asText(typedItem.path);
  if (code.includes("classification")) return ["classification_decision"];
  if (code.includes("location")) return ["location_decision"];
  if (isAnnualSupplyTarget(code, itemPath)) {
    return ["evidence_backed_completion", "deferred_to_common_other"];
  }
  if (code.includes("only_output_exchange"))
    return ["source_trace_verified", "exchange_set_repaired"];
  if (actionItemAllowsCommonOtherDeferral(item)) {
    return ["source_language_normalization", "deferred_to_common_other"];
  }
  if (code.includes("placeholder") || code.includes("geography_token") || code.includes("name")) {
    return ["evidence_backed_completion", "source_language_normalization"];
  }
  return ["evidence_backed_completion"];
}

export function compactActionItemForAuthoring(item: unknown, index: number): CompactActionItem {
  const typedItem = asActionItem(item);
  const itemPath = asText(typedItem.path) || null;
  return {
    index,
    source: asText(typedItem.source) || null,
    code: asText(typedItem.code ?? typedItem.rule_id ?? typedItem.ruleId) || "action_item",
    path: itemPath,
    json_pointer: dotPathToJsonPointer(itemPath),
    message: asText(typedItem.message) || null,
    evidence: typedItem.evidence ?? null,
    instruction: asText(typedItem.instruction) || null,
    allowed_resolution_modes: actionItemResolutionModes(item),
    action_kind: asText(typedItem.action_kind) || "ai_authoring",
    required_owner: asText(typedItem.required_owner) || "foundry_ai_authoring",
    ai_required: typedItem.ai_required !== false,
    common_other_deferral_allowed: actionItemAllowsCommonOtherDeferral(item),
    deferral_cleanup_path: asText(typedItem.deferral_cleanup_path) || null,
    deferral_trace_path: asText(typedItem.deferral_trace_path) || null,
  };
}

export function markdownList(values: unknown, fallback = "- none"): string {
  const rows = ensureArray(values).filter(
    (value) => value !== undefined && value !== null && value !== "",
  );
  if (rows.length === 0) return fallback;
  return rows.map((value) => `- ${String(value)}`).join("\n");
}

export function relOrNull(repoRoot: string, filePath: string | null | undefined): string | null {
  return filePath ? repoRelativePath(repoRoot, filePath) : null;
}

export function packageContextFileSummary(contextFiles: unknown): JsonRecord[] {
  return ensureArray(contextFiles).map((file) => {
    const typedFile = asRecord(file);
    return {
      kind: asText(typedFile.kind) || "context",
      path: asText(typedFile.path) || null,
      sha256: sha256Text(typedFile.text ?? ""),
      bytes: Buffer.byteLength(String(typedFile.text ?? ""), "utf8"),
    };
  });
}

export const decisionOnlyActionKinds = new Set([
  "identity_decision_authoring",
  "classification_decision_authoring",
  "location_decision_authoring",
]);

export function isPatchAuthoringActionItem(item: unknown): boolean {
  const typedItem = asActionItem(item);
  if (!item || typedItem.ai_required === false) return false;
  return !decisionOnlyActionKinds.has(asText(typedItem.action_kind));
}

export function patchAuthoringActionItems(packagePayload: unknown): CompactActionItem[] {
  return ensureArray(asRecord(packagePayload).action_items)
    .filter(isPatchAuthoringActionItem)
    .map(compactActionItemForAuthoring);
}

export function decisionOnlyActionItems(packagePayload: unknown): CompactActionItem[] {
  return ensureArray(asRecord(packagePayload).action_items)
    .filter((item) => asActionItem(item).ai_required !== false && !isPatchAuthoringActionItem(item))
    .map(compactActionItemForAuthoring);
}

export function buildPatchTemplate(packagePayload: unknown, packagePath: string): JsonRecord {
  const typedPackage = asRecord(packagePayload);
  const actionItems = patchAuthoringActionItems(packagePayload);
  const packageRef = path.basename(packagePath);
  const requiredContextKinds = ensureArray(
    asRecord(typedPackage.full_context_ai_completion).required_context_kinds ??
      asRecord(typedPackage.full_context_ai_completion).requiredContextKinds,
  )
    .map((kind) => asText(kind))
    .filter(Boolean);
  const templateContextKinds =
    requiredContextKinds.length > 0
      ? requiredContextKinds
      : ["schema", "methodology_yaml", "ruleset"];
  return {
    schema_version: 1,
    kind: "tiangong_foundry_dataset_patch_template",
    template_status: "requires_ai_completion",
    instructions: [
      "Replace __AI_FILL_VALUE__ with the final JSON value and fill basis or evidence before applying.",
      "For full-context import profiles, every non-test operation must include both basis and structured evidence with source plus quote_or_trace/source_path/field_path/citation.",
      "Use test operations before replace/add/remove when preserving an existing value matters.",
      "Treat generated paths as suggestions. Adjust JSON Pointers when a field is an array or the authoring package shows a different concrete structure.",
      "Keep closes_action_items aligned with the authoring package action_items resolved by each operation.",
      "For full-context import profiles, every non-test operation must close at least one authoring action item; supporting cleanup operations should close the same item they are needed to resolve.",
      "Do not remove authoring_package; strict Foundry apply uses it for package lineage and action-item closure.",
      "Do not use common:other as a substitute for mandatory schema fields. Only action items whose allowed_resolution_modes include deferred_to_common_other may be deferred.",
      "For deferred_to_common_other, add tiangongfoundry:unresolvedTrace under common:other with status, action_item_code, blocked_path, reason, structured evidence, and next_action. Evidence must include source plus quote_or_trace/source_path/field_path/citation.",
      `Do not defer annualSupplyOrProductionVolume to common:other. When source annual volume evidence is missing, Foundry deterministic cleanup writes '${annualSupplyMissingDataSentinelText}' so the required schema field remains present and later database-side curation can bulk-locate it.`,
      "For source_trace_verified, add tiangongfoundry:sourceExchangeCompleteness under common:other with accepted status and structured source trace evidence. Evidence must include source plus quote_or_trace/source_path/field_path/citation.",
    ],
    patch_sets: [
      {
        dataset_id: typedPackage.entity_id ?? typedPackage.process_id ?? null,
        version: typedPackage.version ?? "00.00.001",
        authoring_package: packageRef,
        operations: actionItems.map((item) => ({
          op: "replace",
          path: item.json_pointer,
          value: "__AI_FILL_VALUE__",
          basis: "",
          evidence: {
            source: "",
            quote_or_trace: "",
          },
          resolution: {
            mode: "__AI_FILL_RESOLUTION_MODE__",
            allowed_modes: item.allowed_resolution_modes,
            used_context_kinds: templateContextKinds,
            summary: "",
            deferred_reason: null,
          },
          closes_action_items: [actionItemClosure(item)],
        })),
      },
    ],
  };
}

export function fullContextAiConfigRequiresAuthoring(value: unknown): boolean {
  const record = asRecord(value);
  return record.required === true || record.required === "true";
}

export function requiredFullContextKinds(value: unknown): string[] {
  const record = asRecord(value);
  const kinds = ensureArray(record.required_context_kinds ?? record.requiredContextKinds)
    .map((kind) => asText(kind))
    .filter(Boolean);
  return kinds.length > 0
    ? kinds
    : ["schema", "methodology_yaml", "ruleset", "classification_schema", "location_schema"];
}

export function requiredFullContextFilePatterns(value: unknown): string[] {
  const record = asRecord(value);
  return ensureArray(record.required_context_file_patterns ?? record.requiredContextFilePatterns)
    .map((pattern) => asText(pattern))
    .filter(Boolean);
}

export function contextSummaryHasNonEmptyPayload(file: unknown): boolean {
  const record = asRecord(file);
  if (Number(record.bytes ?? 0) > 0) return true;
  return Buffer.byteLength(String(record.text ?? ""), "utf8") > 0;
}

export function contextSummaryHasKind(files: unknown, kind: string): boolean {
  return ensureArray(files).some(
    (file) => asText(asRecord(file).kind) === kind && contextSummaryHasNonEmptyPayload(file),
  );
}

export function contextSummaryHasPattern(files: unknown, pattern: unknown): boolean {
  const needle = String(pattern).toLowerCase();
  return ensureArray(files).some(
    (file) =>
      String(asRecord(file).path ?? "")
        .toLowerCase()
        .includes(needle) && contextSummaryHasNonEmptyPayload(file),
  );
}

export function stableSharedContextBundleSha256(bundle: unknown): string | null {
  if (!bundle || typeof bundle !== "object" || Array.isArray(bundle)) {
    return null;
  }
  const {
    generated_at_utc: _generatedAtUtc,
    generatedAtUtc: _generatedAtUtcCamel,
    hash_scope: _hashScope,
    hashScope: _hashScopeCamel,
    sha256: _sha256,
    ...stablePayload
  } = bundle as JsonRecord;
  return sha256Text(JSON.stringify(stablePayload));
}

export function sharedContextBundleReadinessBlockers({
  repoRoot,
  sharedContextBundle,
  sourceKind,
  sourcePath = null,
}: SharedContextOptions): JsonRecord[] {
  const sharedContext = asRecord(sharedContextBundle);
  const sharedPath = asText(sharedContext.path);
  if (!sharedPath) return [];
  const expectedSha256 = asText(sharedContext.sha256);
  const prefix =
    sourceKind === "manifest"
      ? "authoring_manifest_shared_context_bundle"
      : "authoring_task_shared_context_bundle";
  const sourceField = sourceKind === "manifest" ? "task_manifest" : "authoring_task";
  const sourceValue = sourcePath ? repoRelativeArtifactPath(repoRoot, sourcePath) : null;
  const base = {
    stage: "ai_patch_collect",
    shared_context_bundle: repoRelativeArtifactPath(repoRoot, sharedPath),
    ...(sourceValue ? { [sourceField]: sourceValue } : {}),
  };
  const bundlePath = resolveRepoPath(repoRoot, sharedPath);
  if (!bundlePath || !fileExists(bundlePath)) {
    return [
      {
        ...base,
        code: `${prefix}_missing`,
        message:
          "AI patch collect cannot verify a referenced shared full-context bundle because it is unreadable.",
        expected_sha256: expectedSha256 || null,
      },
    ];
  }
  if (!expectedSha256) {
    return [
      {
        ...base,
        code: `${prefix}_hash_missing`,
        message:
          "AI patch collect requires shared full-context bundle references to be hash-bound.",
      },
    ];
  }
  try {
    const bundle = readJson<JsonRecord>(bundlePath);
    const actualSha256 = asText(bundle.sha256);
    const computedSha256 = stableSharedContextBundleSha256(bundle);
    const blockers: JsonRecord[] = [];
    if (actualSha256 !== expectedSha256) {
      blockers.push({
        ...base,
        code: `${prefix}_hash_mismatch`,
        message:
          "Shared full-context bundle sha256 no longer matches the task or manifest reference.",
        expected_sha256: expectedSha256,
        actual_sha256: actualSha256 || null,
      });
    }
    if (actualSha256 && computedSha256 && actualSha256 !== computedSha256) {
      blockers.push({
        ...base,
        code: `${prefix}_content_hash_mismatch`,
        message: "Shared full-context bundle content no longer matches its recorded stable sha256.",
        expected_sha256: actualSha256,
        actual_sha256: computedSha256,
      });
    }
    if (!Array.isArray(bundle.files)) {
      blockers.push({
        ...base,
        code: `${prefix}_invalid`,
        message: "Shared full-context bundle must be a JSON object with files[].",
      });
    }
    return blockers;
  } catch (error) {
    return [
      {
        ...base,
        code: `${prefix}_invalid`,
        message: error instanceof Error ? error.message : String(error),
        expected_sha256: expectedSha256,
      },
    ];
  }
}

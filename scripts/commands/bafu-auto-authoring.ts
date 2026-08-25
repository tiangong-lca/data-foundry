import fs from "node:fs";
import path from "node:path";
import {
  type BafuNamePlan,
  cleanProcessFunctionalUnitText,
  englishText,
  mergeExistingTreatmentRoute,
  normalizeIdentityText,
  normalizeLocationTokenCode,
  removeTrailingLocationToken,
  splitBafuNamePlan,
  splitBafuNamePlanFromNameParts,
  stripGeneratedPrefixText,
  stripSourceLocatorSuffix,
  stripTrailingLocationTokenText,
  textFromMultilang,
} from "../lib/bafu-authoring/name-plan.ts";
import { resolveInstalledTiangongLcaCliPackage } from "../lib/foundry-runtime-utils.ts";

interface JsonRecord {
  [key: string]: unknown;
}

interface BafuAutoAuthoringDependencies {
  ensureArray: (value: unknown) => unknown[];
  fileExists: (filePath: string | null | undefined) => boolean;
  nowIso: () => string;
  readJson: (filePath: string) => JsonRecord;
  readText: (filePath: string) => string;
  repoRelativePath: (filePath: string) => string;
  resolveRepoPath: (filePath: unknown) => string | null;
  writeJson: (filePath: string, value: unknown) => void;
  writeJsonLines: (filePath: string, rows: readonly unknown[]) => void;
}

interface ReuseCandidateResult {
  ok: boolean;
  reason?: string;
  reuse?: JsonRecord;
  reviewed?: JsonRecord[];
}

interface MixLocationInput {
  isProcess: boolean;
  name: unknown;
  locationCode: unknown;
}

interface PackageNameInput {
  name: unknown;
  packagePayload: JsonRecord;
}

function isJsonRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function jsonRecord(value: unknown): JsonRecord {
  return isJsonRecord(value) ? value : {};
}

const fullContextKinds = [
  "schema",
  "methodology_yaml",
  "ruleset",
  "classification_schema",
  "location_schema",
];

function ensureDirFor(filePath: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function lowerText(value: unknown): string {
  return String(value ?? "").toLowerCase();
}

function arrayValues(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  return value == null ? [] : [value];
}

function actionCode(item: JsonRecord): string {
  return String(item.code ?? item.action_item_code ?? item.rule_id ?? "");
}

function actionPath(item: JsonRecord): string {
  return String(item.path ?? item.json_path ?? "");
}

function closureFor(item: JsonRecord): JsonRecord {
  return { code: actionCode(item), path: actionPath(item) };
}

function evidenceObject(
  kind: string,
  task: JsonRecord,
  actionItem: JsonRecord,
  extra: JsonRecord = {},
): JsonRecord {
  const itemPath = actionPath(actionItem);
  const actionEvidence = jsonRecord(actionItem.evidence);
  const currentName = jsonRecord(actionEvidence.current_name);
  const entity = jsonRecord(task.entity);
  return {
    source: "dataset-bafu-auto-authoring",
    field_path: itemPath || null,
    quote_or_trace:
      actionEvidence.text ??
      currentName.baseName ??
      (Array.isArray(actionEvidence.reference_flow_properties)
        ? actionEvidence.reference_flow_properties.join(", ")
        : null) ??
      itemPath ??
      kind,
    kind,
    dataset_type: entity.dataset_type ?? null,
    dataset_id: entity.entity_id ?? null,
    dataset_version: entity.version ?? null,
    action_item: {
      code: actionCode(actionItem),
      path: actionPath(actionItem) || null,
      evidence: actionItem.evidence ?? null,
    },
    ...extra,
  };
}

function resolution(mode: string, summary: string, extra: JsonRecord = {}): JsonRecord {
  return {
    mode,
    used_context_kinds: fullContextKinds,
    summary,
    deferred_reason: null,
    ...extra,
  };
}

function flowReferencePropertyActionValue(actionItem: JsonRecord): JsonRecord | null {
  const evidence = jsonRecord(actionItem.evidence);
  const suggested = evidence.suggested_value;
  if (suggested && typeof suggested === "object" && !Array.isArray(suggested)) {
    const text = textFromMultilang(suggested).trim();
    if (text) return englishText(text);
  }
  const reference = arrayValues(evidence.reference_flow_properties).find((item) =>
    String(item ?? "").trim(),
  );
  return reference ? englishText(String(reference).trim()) : null;
}

const identityStopWords = new Set([
  "a",
  "an",
  "and",
  "as",
  "at",
  "by",
  "for",
  "from",
  "in",
  "of",
  "on",
  "or",
  "source",
  "the",
  "to",
  "with",
]);

function identityTokens(value: unknown): Set<string> {
  const tokens = normalizeIdentityText(value)
    .split(" ")
    .filter((token) => token.length > 1 && !identityStopWords.has(token));
  return new Set(tokens);
}

function identityTextFromParts(parts: unknown): string {
  return arrayValues(parts)
    .map((part) => String(part ?? ""))
    .filter(Boolean)
    .join(" ");
}

function tokenOverlapRatio(left: unknown, right: unknown): number {
  const leftTokens = identityTokens(left);
  const rightTokens = identityTokens(right);
  if (leftTokens.size === 0 || rightTokens.size === 0) return 0;
  let overlap = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) overlap += 1;
  }
  return overlap / Math.min(leftTokens.size, rightTokens.size);
}

function categoriesOverlap(left: unknown, right: unknown): boolean {
  const leftTokens = identityTokens(identityTextFromParts(left));
  const rightTokens = identityTokens(identityTextFromParts(right));
  for (const token of leftTokens) {
    if (rightTokens.has(token)) return true;
  }
  return false;
}

function namesAreExactIdentityMatch(targetNames: unknown, candidateNames: unknown): boolean {
  const target = normalizeIdentityText(identityTextFromParts(targetNames));
  const candidate = normalizeIdentityText(identityTextFromParts(candidateNames));
  return Boolean(target && target === candidate);
}

const NAME_MEANING_STOP_TOKENS = new Set([
  "at",
  "plant",
  "production",
  "mix",
  "market",
  "supply",
  "grid",
  "regional",
  "storage",
  "storehouse",
  "works",
  "rer",
  "glo",
  "row",
  "ucte",
  "entso",
]);

function substanceMeaningText(names: unknown): string {
  return normalizeIdentityText(identityTextFromParts(names))
    .split(/\s+/u)
    .filter((token) => token.length >= 2 && !NAME_MEANING_STOP_TOKENS.has(token))
    .filter((token) => !/^[a-z]{2}$/u.test(token))
    .join(" ");
}

function strongNameMeaningDiffers(targetNames: unknown, candidateNames: unknown): boolean {
  const targetText = identityTextFromParts(targetNames);
  const candidateText = identityTextFromParts(candidateNames);
  const target = normalizeIdentityText(targetText);
  const candidate = normalizeIdentityText(candidateText);
  if (!target || !candidate || target === candidate) return false;
  // Route/mix/geography words ("at plant", "RER") are not substance identity; comparing
  // them inflates overlap and lets a different polymer pass as possibly equivalent.
  const targetSubstance = substanceMeaningText(targetNames);
  const candidateSubstance = substanceMeaningText(candidateNames);
  if (targetSubstance && candidateSubstance) {
    return tokenOverlapRatio(targetSubstance, candidateSubstance) < 0.45;
  }
  return tokenOverlapRatio(targetText, candidateText) < 0.45;
}

function routeOrTechnologyDiffers(targetNames: unknown, candidateNames: unknown): boolean {
  const target = normalizeIdentityText(identityTextFromParts(targetNames));
  const candidate = normalizeIdentityText(identityTextFromParts(candidateNames));
  const routeTokens = [
    "allocation",
    "cogen",
    "cogeneration",
    "consumption",
    "disposal",
    "exergy",
    "grid",
    "low",
    "market",
    "medium",
    "mix",
    "plant",
    "production",
    "route",
    "ship",
    "supply",
    "voltage",
    "waste",
  ];
  const targetRoutes = routeTokens.filter((token) => target.includes(token));
  const candidateRoutes = routeTokens.filter((token) => candidate.includes(token));
  if (targetRoutes.length === 0 && candidateRoutes.length === 0) return false;
  return !sameList(targetRoutes, candidateRoutes);
}

function candidateHasClearNonEquivalence(reviewedCandidate: JsonRecord): boolean {
  return arrayValues(reviewedCandidate.non_equivalence_reasons).length > 0;
}

function reusableEquivalentCandidate(
  target: JsonRecord,
  reviewedCandidates: JsonRecord[],
): JsonRecord | undefined {
  const targetNames = target.names ?? [];
  const targetGeography = lowerText(jsonRecord(target.fields).geography);
  return reviewedCandidates.find((candidate) => {
    if (!candidate.id || !candidate.version) return false;
    if (candidateHasClearNonEquivalence(candidate)) return false;
    if (
      tokenOverlapRatio(
        identityTextFromParts(targetNames),
        identityTextFromParts(candidate.names),
      ) < 0.8
    ) {
      return false;
    }
    const candidateGeography = lowerText(jsonRecord(candidate.fields).geography);
    if (targetGeography && candidateGeography && targetGeography !== candidateGeography)
      return false;
    return true;
  });
}

function normalizedCategoryText(fields: JsonRecord): string {
  return normalizeIdentityText(arrayValues(fields.categories).join(" "));
}

function reusableBafuElementaryFlowCandidate(
  target: JsonRecord,
  candidates: JsonRecord[],
): JsonRecord | null {
  const targetFields = jsonRecord(target.fields);
  const targetType = lowerText(targetFields.type_of_dataset);
  if (targetType !== "elementary flow") return null;
  const targetNamesText = normalizeIdentityText(identityTextFromParts(target.names ?? []));
  const targetProperty = normalizeIdentityText(targetFields.flow_property);
  const targetCategories = normalizedCategoryText(targetFields);
  const isIndustrialOccupation =
    targetProperty === "area time" &&
    targetNamesText.includes("occupation industrial area") &&
    targetCategories.includes("land");
  const isIndustrialTransformationTo =
    targetProperty === "area" &&
    targetNamesText.includes("transformation to industrial area") &&
    targetCategories.includes("land");
  if (!isIndustrialOccupation && !isIndustrialTransformationTo) return null;

  for (const candidate of candidates) {
    const fields = jsonRecord(candidate.fields);
    if (lowerText(fields.type_of_dataset) !== "elementary flow") continue;
    const candidateProperty = normalizeIdentityText(fields.flow_property);
    const candidateNamesText = normalizeIdentityText(identityTextFromParts(candidate.names ?? []));
    const candidateCategories = normalizedCategoryText(fields);
    if (isIndustrialOccupation) {
      if (candidateProperty !== "area time") continue;
      if (!candidateNamesText.includes("industrial area")) continue;
      if (!candidateCategories.includes("land occupation")) continue;
      return {
        ...candidate,
        equivalence_basis:
          "BAFU land occupation flow uses the industrial-area land-use meaning with Area*time; the canonical candidate is the matching public TianGong land occupation elementary flow.",
      };
    }
    if (isIndustrialTransformationTo) {
      if (candidateProperty !== "area") continue;
      if (!candidateNamesText.includes("to industrial area")) continue;
      if (candidateNamesText.includes("from industrial area")) continue;
      if (!candidateCategories.includes("land transformation")) continue;
      return {
        ...candidate,
        equivalence_basis:
          "BAFU land transformation flow is a transformation to industrial area with Area; the canonical candidate is the matching public TianGong land transformation elementary flow.",
      };
    }
  }
  return null;
}

function nonEquivalentFlowCandidateReasons(
  target: JsonRecord,
  candidates: JsonRecord[],
): { exactEquivalentCandidate: JsonRecord | null; reviewed: JsonRecord[] } {
  const targetNames = target.names ?? [];
  const targetFields = jsonRecord(target.fields);
  const targetProperty = lowerText(targetFields.flow_property);
  const targetUnit = lowerText(targetFields.reference_unit);
  const targetGeography = lowerText(targetFields.geography);
  const targetCategories = arrayValues(targetFields.categories);
  const reviewed: JsonRecord[] = [];
  let exactEquivalentCandidate: JsonRecord | null = null;

  for (const candidate of candidates) {
    const candidateNames = candidate.names ?? [];
    const candidateFields = jsonRecord(candidate.fields);
    const candidateProperty = lowerText(candidateFields.flow_property);
    const candidateUnit = lowerText(candidateFields.reference_unit);
    const candidateGeography = lowerText(candidateFields.geography);
    const candidateCategories = arrayValues(candidateFields.categories);
    const reasons = [];
    if (targetProperty && candidateProperty && targetProperty !== candidateProperty) {
      reasons.push("flow property differs");
    }
    if (targetUnit && candidateUnit && targetUnit !== candidateUnit) {
      reasons.push("reference unit differs");
    }
    if (targetGeography && candidateGeography && targetGeography !== candidateGeography) {
      reasons.push("geography/market context differs");
    }
    if (
      targetCategories.length > 0 &&
      candidateCategories.length > 0 &&
      !categoriesOverlap(targetCategories, candidateCategories)
    ) {
      reasons.push("source category/route differs");
    }
    if (strongNameMeaningDiffers(targetNames, candidateNames)) {
      reasons.push("flow name/physical service meaning differs");
    }
    if (routeOrTechnologyDiffers(targetNames, candidateNames)) {
      reasons.push("technology/route qualifier differs");
    }
    if (namesAreExactIdentityMatch(targetNames, candidateNames)) {
      exactEquivalentCandidate = candidate;
    }
    reviewed.push({
      id: candidate?.id ?? null,
      version: candidate?.version ?? null,
      names: candidate?.names ?? [],
      fields: candidateFields,
      non_equivalence_reasons: reasons,
    });
  }

  return { exactEquivalentCandidate, reviewed };
}

function sameList(left: unknown, right: unknown): boolean {
  const leftSet = new Set(arrayValues(left).map(lowerText).filter(Boolean));
  const rightSet = new Set(arrayValues(right).map(lowerText).filter(Boolean));
  if (leftSet.size !== rightSet.size) return false;
  for (const item of leftSet) {
    if (!rightSet.has(item)) return false;
  }
  return leftSet.size > 0;
}

function nonEquivalentProcessCandidateReasons(
  target: JsonRecord,
  candidates: JsonRecord[],
): { exactEquivalentCandidate: JsonRecord | null; reviewed: JsonRecord[] } {
  const targetNames = target.names ?? [];
  const targetFields = jsonRecord(target.fields);
  const targetGeography = lowerText(targetFields.geography);
  const targetReferenceFlowIds = arrayValues(targetFields.reference_flow_ids);
  const targetReferenceFlowNames = arrayValues(targetFields.reference_flow_names);
  const targetCategories = arrayValues(targetFields.categories);
  const targetExchangeSignature = arrayValues(target.exchange_signature);
  const reviewed: JsonRecord[] = [];
  let exactEquivalentCandidate: JsonRecord | null = null;

  for (const candidate of candidates) {
    const candidateNames = candidate.names ?? [];
    const candidateFields = jsonRecord(candidate.fields);
    const candidateGeography = lowerText(candidateFields.geography);
    const candidateReferenceFlowIds = arrayValues(candidateFields.reference_flow_ids);
    const candidateReferenceFlowNames = arrayValues(candidateFields.reference_flow_names);
    const candidateCategories = arrayValues(candidateFields.categories);
    const candidateExchangeSignature = arrayValues(candidate.exchange_signature);
    const reasons: string[] = [];
    if (targetGeography && candidateGeography && targetGeography !== candidateGeography) {
      reasons.push("geography differs");
    }
    if (
      targetReferenceFlowIds.length > 0 &&
      candidateReferenceFlowIds.length > 0 &&
      !sameList(targetReferenceFlowIds, candidateReferenceFlowIds)
    ) {
      reasons.push("reference flow differs");
    }
    if (
      targetReferenceFlowNames.length > 0 &&
      candidateReferenceFlowNames.length > 0 &&
      !sameList(targetReferenceFlowNames, candidateReferenceFlowNames)
    ) {
      reasons.push("reference flow meaning differs");
    }
    if (
      targetExchangeSignature.length > 0 &&
      candidateExchangeSignature.length > 0 &&
      !sameList(targetExchangeSignature, candidateExchangeSignature)
    ) {
      reasons.push("exchange signature differs");
    }
    if (
      targetCategories.length > 0 &&
      candidateCategories.length > 0 &&
      !categoriesOverlap(targetCategories, candidateCategories)
    ) {
      reasons.push("process classification/route differs");
    }
    if (strongNameMeaningDiffers(targetNames, candidateNames)) {
      reasons.push("process name/technology meaning differs");
    }
    if (routeOrTechnologyDiffers(targetNames, candidateNames)) {
      reasons.push("process technology/route qualifier differs");
    }
    if (namesAreExactIdentityMatch(targetNames, candidateNames)) {
      exactEquivalentCandidate = candidate;
    }
    reviewed.push({
      id: candidate?.id ?? null,
      version: candidate?.version ?? null,
      names: candidate?.names ?? [],
      fields: candidateFields,
      exchange_signature: candidateExchangeSignature,
      non_equivalence_reasons: reasons,
    });
  }

  return { exactEquivalentCandidate, reviewed };
}

function canCreateBafuProductFlow(actionItem: JsonRecord): ReuseCandidateResult {
  const evidence = jsonRecord(actionItem.evidence);
  const target = jsonRecord(evidence.target);
  const targetType = lowerText(jsonRecord(target.fields).type_of_dataset);
  const elementaryReuse = reusableBafuElementaryFlowCandidate(
    target,
    arrayValues(evidence.top_candidates).map(jsonRecord),
  );
  if (elementaryReuse) {
    return {
      ok: false,
      reuse: elementaryReuse,
      reason:
        "A public TianGong elementary land-use flow candidate is physically identity-equivalent and should be reused.",
      reviewed: [
        {
          id: elementaryReuse.id ?? null,
          version: elementaryReuse.version ?? null,
          names: elementaryReuse.names ?? [],
          fields: elementaryReuse.fields ?? {},
          non_equivalence_reasons: [],
          equivalence_basis: elementaryReuse.equivalence_basis ?? null,
        },
      ],
    };
  }
  if (!["product flow", "waste flow"].includes(targetType)) {
    return {
      ok: false,
      reason: "Only product/waste flow identity decisions may be autofilled as create_new.",
    };
  }
  const targetNames = target.names ?? [];
  if (!normalizeIdentityText(identityTextFromParts(targetNames))) {
    return {
      ok: false,
      reason: "Target flow lacks enough name evidence for an automatic identity decision.",
    };
  }
  const { exactEquivalentCandidate, reviewed } = nonEquivalentFlowCandidateReasons(
    target,
    arrayValues(evidence.top_candidates).map(jsonRecord),
  );
  const reuseCandidate = exactEquivalentCandidate ?? reusableEquivalentCandidate(target, reviewed);
  if (reuseCandidate) {
    return {
      ok: false,
      reuse: reuseCandidate,
      reason: "A remote candidate is physically identity-equivalent and should be reused.",
      reviewed,
    };
  }
  const equivalentRisk = reviewed.some((candidate) => !candidateHasClearNonEquivalence(candidate));
  if (equivalentRisk) {
    return {
      ok: false,
      reason: "At least one candidate lacks clear non-equivalence reasons.",
      reviewed,
    };
  }
  return { ok: true, reviewed };
}

function canCreateBafuProcess(actionItem: JsonRecord): ReuseCandidateResult {
  const evidence = jsonRecord(actionItem.evidence);
  const target = jsonRecord(evidence.target);
  const targetNames = target.names ?? [];
  if (!normalizeIdentityText(identityTextFromParts(targetNames))) {
    return {
      ok: false,
      reason: "Target process lacks enough name evidence for an automatic identity decision.",
    };
  }
  const { exactEquivalentCandidate, reviewed } = nonEquivalentProcessCandidateReasons(
    target,
    arrayValues(evidence.top_candidates).map(jsonRecord),
  );
  if (exactEquivalentCandidate) {
    return {
      ok: false,
      reason: "A process candidate has an exact name match and requires explicit reuse/new review.",
      reviewed,
    };
  }
  const equivalentRisk = reviewed.some((candidate) => !candidateHasClearNonEquivalence(candidate));
  if (equivalentRisk) {
    return {
      ok: false,
      reason: "At least one process candidate lacks clear non-equivalence reasons.",
      reviewed,
    };
  }
  return { ok: true, reviewed };
}

function identityDecisionRow(actionItem: JsonRecord, _task: JsonRecord): JsonRecord {
  const evidence = jsonRecord(actionItem.evidence);
  const target = jsonRecord(evidence.target);
  const datasetType = String(
    actionItem?.dataset_type ?? target.dataset_type ?? "flow",
  ).toLowerCase();
  const createNew =
    datasetType === "process"
      ? canCreateBafuProcess(actionItem)
      : canCreateBafuProductFlow(actionItem);
  const datasetId = String(actionItem?.dataset_id ?? target.id ?? "");
  const datasetVersion = String(actionItem?.dataset_version ?? target.version ?? "00.00.001");
  const base = {
    schema_version: 1,
    dataset_type: datasetType,
    dataset_id: datasetId,
    dataset_version: datasetVersion,
    decision_status: "completed",
    authoring_package: actionItem?.authoring_package ?? null,
    authoring_package_sha256: actionItem?.authoring_package_sha256 ?? null,
    used_context_kinds: fullContextKinds,
    closes_action_items: ["identity_preflight_manual_review"],
  };
  if (!createNew.ok && createNew.reuse) {
    return {
      ...base,
      identity_decision: "reuse_existing_reference",
      canonical: {
        table: datasetType === "process" ? "processes" : "flows",
        ref_object_id: createNew.reuse.id,
        version: createNew.reuse.version,
        short_description: identityTextFromParts(createNew.reuse.names) || createNew.reuse.id,
      },
      basis:
        "A remote candidate was reviewed as physically identity-equivalent to the BAFU target by name, route, geography, flow property, and reference unit evidence, so the existing row is reused.",
      evidence: {
        source: "dataset-bafu-identity-decisions-autofill",
        policy: `reuse_existing_reference_when_${datasetType}_identity_equivalence_is_proven`,
        target,
        remote_search: evidence.remote_search ?? null,
        selected_candidate: createNew.reuse,
        reviewed_top_candidates: createNew.reviewed ?? [],
        physical_equivalence_decision: "identity_equivalent_to_existing_candidate",
      },
    };
  }
  if (!createNew.ok) {
    return {
      ...base,
      identity_decision: "block_unresolved",
      canonical: null,
      basis: createNew.reason,
      evidence: {
        source: "dataset-bafu-identity-decisions-autofill",
        policy: `blocked_when_${datasetType}_identity_equivalence_is_not_proven_safe`,
        target,
        reviewed_top_candidates: createNew.reviewed ?? [],
      },
    };
  }
  return {
    ...base,
    identity_decision: "create_new",
    canonical: null,
    basis:
      datasetType === "process"
        ? "BAFU source process was reviewed against the remote candidates; each candidate differs by reference flow, exchange signature, geography, classification/route, or process meaning, so no identity-equivalent process was found."
        : "BAFU source flow was reviewed against the remote candidates; each candidate differs by physical property, reference unit, geography/market, classification/route, technology, or flow meaning, so no identity-equivalent product/waste flow was found.",
    evidence: {
      source: "dataset-bafu-identity-decisions-autofill",
      policy:
        datasetType === "process"
          ? "create_new_allowed_for_process_when_candidates_are_not_identity_equivalent"
          : "create_new_allowed_for_non_elementary_product_flow_when_candidates_are_not_identity_equivalent",
      target,
      remote_search: evidence.remote_search ?? null,
      reviewed_top_candidates: createNew.reviewed,
      physical_equivalence_decision: "not_identity_equivalent_to_existing_candidates",
    },
  };
}

let locationLabelCache: Map<string, string> | null = null;

function loadLocationLabels(): Map<string, string> {
  if (locationLabelCache) return locationLabelCache;
  const labels = new Map([
    ["CH", "Switzerland"],
    ["BR", "Brazil"],
    ["CN", "China"],
    ["CY", "Cyprus"],
    ["DE", "Germany"],
    ["EU", "Europe"],
    ["GLO", "global"],
    ["IN", "India"],
    ["JP", "Japan"],
    ["LU", "Luxembourg"],
    ["MX", "Mexico"],
    ["PE", "Peru"],
    ["RLA", "Latin America"],
    ["RER", "Europe"],
    ["UCTE", "UCTE"],
    ["US", "United States"],
    ["WEU", "Western Europe"],
  ]);
  const schemaPath = path.join(
    resolveInstalledTiangongLcaCliPackage().schemaDir,
    "tidas_locations_category.json",
  );
  try {
    const schema = jsonRecord(JSON.parse(fs.readFileSync(schemaPath, "utf8")));
    for (const item of arrayValues(schema.oneOf).map(jsonRecord)) {
      if (!item.const || !item.description) continue;
      labels.set(String(item.const).toUpperCase(), String(item.description));
    }
  } catch {
    // The stable fallback labels keep suggestions deterministic if an asset is malformed.
  }
  labels.set("GLO", "global");
  locationLabelCache = labels;
  return labels;
}

function locationNameLabel(locationCode: unknown): string {
  const code = String(locationCode ?? "").toUpperCase();
  return loadLocationLabels().get(code) ?? code;
}

function inferMixLocationPhrase({ isProcess, name, locationCode }: MixLocationInput): string {
  const nameRecord = jsonRecord(name);
  const locationLabel = locationNameLabel(locationCode);
  const nameText = normalizeIdentityText(
    [
      textFromMultilang(nameRecord.baseName),
      textFromMultilang(nameRecord.treatmentStandardsRoutes),
      textFromMultilang(nameRecord.mixAndLocationTypes),
    ].join(" "),
  );
  if (/\b(?:mounting|surface mount|through hole|solder|assembly)\b/u.test(nameText)) {
    return isProcess ? `assembly process, ${locationLabel}` : `assembly service, ${locationLabel}`;
  }
  if (/\b(?:track bed|rail infrastructure)\b/u.test(nameText)) {
    return isProcess
      ? `rail infrastructure process, ${locationLabel}`
      : `rail infrastructure, ${locationLabel}`;
  }
  if (/\b(?:excavation|hydraulic digger|pushed pile|pile)\b/u.test(nameText)) {
    return isProcess
      ? `construction process, ${locationLabel}`
      : `construction service, ${locationLabel}`;
  }
  if (
    /\b(?:welding|rolling|hot rolling|metal working|machining|manufacturing|extrusion|injection|moulding|molding|powder coating|anodi[sz]ing|wire drawing|section bar rolling|section bar extrusion|zinc coating|tin plating|coating|tempering|casting|sputtering|thermoforming|foaming|we+ving)\b/u.test(
      nameText,
    )
  ) {
    return isProcess
      ? `manufacturing process, ${locationLabel}`
      : `manufacturing service, ${locationLabel}`;
  }
  if (
    /\b(?:shredding|dismantling|sorting)\b/u.test(nameText) ||
    /\bto\b.*\btreatment\b/u.test(nameText)
  ) {
    return isProcess
      ? `treatment process, ${locationLabel}`
      : `treatment service, ${locationLabel}`;
  }
  if (/\b(?:deconstruction|demolition)\b/u.test(nameText)) {
    return isProcess
      ? `deconstruction process, ${locationLabel}`
      : `deconstruction service, ${locationLabel}`;
  }
  if (
    /\b(?:recovered|recycling|module treatment|refined waste cooking oil|waste cooking oil)\b/u.test(
      nameText,
    )
  ) {
    return isProcess
      ? `recovery process, ${locationLabel}`
      : `recovered material, ${locationLabel}`;
  }
  if (/\b(?:transport|freight|lorry|truck|rail|ship|barge)\b/u.test(nameText)) {
    return isProcess
      ? `transport process, ${locationLabel}`
      : `transport service, ${locationLabel}`;
  }
  if (/\b(?:disposal|waste|treatment|mswi|combustible)\b/u.test(nameText)) {
    return isProcess ? `disposal process, ${locationLabel}` : `disposal service, ${locationLabel}`;
  }
  if (
    /\b(?:production|producer|power|plant|primary|refinery|current collector|electrode material|electrolyte|separator|cathode|anode|paste|cogen|cogeneration|wind|hydropower|nuclear|reactor|boiler|burned|heat|mine|quarry|mill|sawmill|kiln dried|industrial wood|roundwood|round wood|bark chips|forest road|wood chips|at forest|component|components|radiator|tube|tubes|panel|panels|module|modules|machine|machines|equipment|system|systems)\b/u.test(
      nameText,
    )
  ) {
    return isProcess ? `production process, ${locationLabel}` : `production mix, ${locationLabel}`;
  }
  if (/\b(?:consumption|consumer|market|supply|grid)\b/u.test(nameText)) {
    return isProcess ? `supply process, ${locationLabel}` : `supply mix, ${locationLabel}`;
  }
  return isProcess ? `process, ${locationLabel}` : `supply mix, ${locationLabel}`;
}

function inferBareProductNamePlan({ name, packagePayload }: PackageNameInput): BafuNamePlan | null {
  const nameRecord = jsonRecord(name);
  const locationCode = datasetLocationCode({ isProcess: false, packagePayload });
  const source = stripSourceLocatorSuffix(
    stripGeneratedPrefixText(
      stripTrailingLocationTokenText(textFromMultilang(nameRecord.baseName).trim(), locationCode),
    ),
  );
  // Comma-containing names are accepted as a whole-name base name (see the matching
  // note in inferBareProcessNamePlan). This fallback runs only after every
  // splitBafuNamePlan matcher returned null, so it never overrides a recognised
  // base+treatment split; what remains are intrinsic compound product names
  // (e.g. "Fuel in transport, aircraft, passenger"). The product-flow type guard
  // below still restricts this to actual product flows.
  if (!source) return null;
  const sourceRow = jsonRecord(packagePayload.source_row);
  const entityPayload = jsonRecord(packagePayload.entity_payload);
  const flow = jsonRecord(
    jsonRecord(sourceRow.flowDataSet).flowInformation
      ? sourceRow.flowDataSet
      : entityPayload.flowDataSet,
  );
  const typeOfDataSet = lowerText(
    jsonRecord(jsonRecord(flow.modellingAndValidation).LCIMethod).typeOfDataSet,
  );
  if (typeOfDataSet !== "product flow") return null;

  const normalized = normalizeIdentityText(source);
  if (!/[a-z0-9]/u.test(normalized)) return null;
  const treatment = /\b(?:consumption|consumer|market|supply|imports?|grid)\b/u.test(normalized)
    ? "supply"
    : "production";
  const locationLabel = locationCode ? locationNameLabel(locationCode) : null;
  const mixKind = treatment === "supply" ? "supply mix" : "production mix";
  return {
    source,
    base_name: source,
    treatment,
    mix_location: locationLabel ? `${mixKind}, ${locationLabel}` : mixKind,
  };
}

function inferBareProcessNamePlan({ name, packagePayload }: PackageNameInput): BafuNamePlan | null {
  const nameRecord = jsonRecord(name);
  const locationCode = datasetLocationCode({ isProcess: true, packagePayload });
  const source = stripSourceLocatorSuffix(
    stripGeneratedPrefixText(
      stripTrailingLocationTokenText(textFromMultilang(nameRecord.baseName).trim(), locationCode),
    ),
  );
  // Comma-containing names are accepted here as a whole-name base name. This fallback
  // is reached ONLY after every splitBafuNamePlan / splitBafuNamePlanFromNameParts
  // matcher returned null, so a name that any matcher would have split into a
  // base + treatment/route never arrives here. What remains are intrinsic compound
  // product/service names whose comma is part of the name itself (e.g. "Road,
  // trolleybus", "Videoconference, laptop, participant", "Transport, high speed
  // train, Infrastruktur"); treating the whole geography-stripped name as the base
  // name is the correct authoring outcome. The production-context guard below still
  // requires a real reference-product output (or production classification) before
  // emitting a plan, so non-product rows are not mislabelled.
  if (!source) return null;
  const sourceRow = jsonRecord(packagePayload.source_row);
  const entityPayload = jsonRecord(packagePayload.entity_payload);
  const process = jsonRecord(sourceRow.processDataSet || entityPayload.processDataSet);
  if (Object.keys(process).length === 0) return null;

  const normalized = normalizeIdentityText(source);
  if (!/[a-z0-9]/u.test(normalized)) return null;

  const exchanges = arrayValues(jsonRecord(process.exchanges).exchange).map(jsonRecord);
  const outputNames = exchanges
    .filter((exchange) => lowerText(exchange.exchangeDirection) === "output")
    .map((exchange) =>
      textFromMultilang(jsonRecord(exchange.referenceToFlowDataSet)["common:shortDescription"]),
    )
    .filter(Boolean);
  const hasMatchingOutput = outputNames.some((outputName) => {
    const outputText = normalizeIdentityText(outputName);
    return (
      outputText === normalized ||
      outputText.includes(normalized) ||
      normalized.includes(outputText)
    );
  });
  const classificationText = lowerText(
    JSON.stringify(
      jsonRecord(jsonRecord(process.processInformation).dataSetInformation)
        .classificationInformation ?? {},
    ),
  );
  const hasProductionContext =
    hasMatchingOutput ||
    /\b(?:manufactur|production|producer|basic chemicals|chemical products)\b/u.test(
      classificationText,
    );
  if (!hasProductionContext) return null;

  let treatment = "production";
  let mixKind = "production process";
  if (/\b(?:consumption|consumer|market|supply|imports?|grid)\b/u.test(normalized)) {
    treatment = "supply";
    mixKind = "supply process";
  } else if (/\b(?:disposal|waste|treatment|mswi|combustible)\b/u.test(normalized)) {
    treatment = "treatment";
    mixKind = "treatment process";
  }

  const locationLabel = locationCode ? locationNameLabel(locationCode) : null;
  return {
    source,
    base_name: source,
    treatment,
    mix_location: locationLabel ? `${mixKind}, ${locationLabel}` : mixKind,
  };
}

function datasetLocationCode({
  isProcess,
  packagePayload,
}: {
  isProcess: boolean;
  packagePayload: JsonRecord;
}): string {
  const sourceRow = jsonRecord(packagePayload.source_row);
  const entityPayload = jsonRecord(packagePayload.entity_payload);
  if (isProcess) {
    const process = jsonRecord(sourceRow.processDataSet || entityPayload.processDataSet);
    const location = jsonRecord(
      jsonRecord(process.processInformation).geography,
    ).locationOfOperationSupplyOrProduction;
    if (typeof location === "string") return location.toUpperCase();
    return String(jsonRecord(location)["@location"] ?? "").toUpperCase();
  }
  const flow = jsonRecord(sourceRow.flowDataSet || entityPayload.flowDataSet);
  return String(
    jsonRecord(jsonRecord(flow.flowInformation).geography).locationOfSupply ?? "",
  ).toUpperCase();
}

function completeNameSplitMixLocationPhrase(
  mixLocation: unknown,
  locationCode: unknown,
): string | null {
  const phrase = String(mixLocation ?? "").trim();
  if (!phrase) return null;
  if (/^(?:market|production|supply)\s+mix$/iu.test(phrase) && locationCode) {
    return `${phrase}, ${locationNameLabel(locationCode)}`;
  }
  if (
    /^at\s+(?:plant|user|grid|consumer|market|sawmill|warehouse|regional storage)$/iu.test(
      phrase,
    ) &&
    locationCode
  ) {
    return `${phrase}, ${locationNameLabel(locationCode)}`;
  }
  return phrase;
}

function buildNamePatchOperations(task: JsonRecord): JsonRecord[] {
  const operations: JsonRecord[] = [];
  const actionItems = arrayValues(task.action_items).map(jsonRecord);
  const packagePayload = jsonRecord(task.authoring_package_payload);
  const entity = jsonRecord(task.entity);
  const entityId = entity.entity_id ?? null;
  const sourceRow = jsonRecord(packagePayload.source_row);
  const entityPayload = jsonRecord(packagePayload.entity_payload);
  const sourceProcess = jsonRecord(sourceRow.processDataSet);
  const entityProcess = jsonRecord(entityPayload.processDataSet);
  const sourceFlow = jsonRecord(sourceRow.flowDataSet);
  const entityFlow = jsonRecord(entityPayload.flowDataSet);
  const datasetType = String(entity.dataset_type ?? "").toLowerCase();
  const isProcess = datasetType === "process";
  const namePathPrefix = isProcess
    ? "/processDataSet/processInformation/dataSetInformation/name"
    : "/flowDataSet/flowInformation/dataSetInformation/name";
  const formalLocationField = isProcess
    ? "processDataSet.processInformation.geography.locationOfOperationSupplyOrProduction"
    : "flowDataSet.flowInformation.geography.locationOfSupply";
  const sourceProcessInformation = jsonRecord(sourceProcess.processInformation);
  const entityProcessInformation = jsonRecord(entityProcess.processInformation);
  const sourceFlowInformation = jsonRecord(sourceFlow.flowInformation);
  const entityFlowInformation = jsonRecord(entityFlow.flowInformation);
  const name = jsonRecord(
    isProcess
      ? (jsonRecord(sourceProcessInformation.dataSetInformation).name ??
          jsonRecord(entityProcessInformation.dataSetInformation).name)
      : (jsonRecord(sourceFlowInformation.dataSetInformation).name ??
          jsonRecord(entityFlowInformation.dataSetInformation).name),
  );
  const functionalUnit = isProcess
    ? (jsonRecord(sourceProcessInformation.quantitativeReference).functionalUnitOrOther ??
      jsonRecord(entityProcessInformation.quantitativeReference).functionalUnitOrOther)
    : null;
  const functionalUnitActionItems = actionItems.filter((item) => {
    const code = actionCode(item);
    return (
      isProcess &&
      actionPath(item).includes("functionalUnitOrOther") &&
      ["semantic_geography_token_in_name", "semantic_name_placeholder_token"].includes(code)
    );
  });
  const locationCode = datasetLocationCode({ isProcess, packagePayload });
  const nameSplit = mergeExistingTreatmentRoute(
    splitBafuNamePlanFromNameParts(name, locationCode) ??
      splitBafuNamePlan(name.baseName, locationCode) ??
      (isProcess
        ? inferBareProcessNamePlan({ name, packagePayload })
        : inferBareProductNamePlan({ name, packagePayload })),
    name,
  );
  const nameSplitMixLocation = completeNameSplitMixLocationPhrase(
    nameSplit?.mix_location,
    locationCode,
  );
  const nameSplitActionItems = actionItems.filter((item) =>
    [
      "semantic_name_base_contains_unsplit_segments",
      "semantic_name_treatment_placeholder",
      "semantic_name_quantitative_property_not_split",
      "semantic_name_source_locator_in_name",
    ].includes(actionCode(item)),
  );
  const mixLocationActionItems = actionItems.filter(
    (item) => actionCode(item) === "semantic_name_mix_location_too_bare",
  );
  let emittedNameSplit = false;
  let emittedFunctionalUnitClean = false;
  let emittedMixLocation = false;

  for (const item of actionItems) {
    const code = actionCode(item);
    const itemEvidence = jsonRecord(item.evidence);
    if (code === "semantic_content_saturation_flow_location_of_supply_missing" && !isProcess) {
      const mixText = normalizeLocationTokenCode(
        textFromMultilang(name.mixAndLocationTypes).trim(),
      );
      const codeToken = /^[A-Z0-9][A-Z0-9+&-]{1,30}$/u.test(mixText) ? mixText : null;
      if (!codeToken) {
        operations.push({
          blocker: {
            code: "bafu_flow_location_of_supply_unresolvable",
            dataset_id: entityId,
            action_item: closureFor(item),
            message:
              "Flow locationOfSupply is missing and the name mixAndLocationTypes does not carry a usable location code.",
          },
        });
        continue;
      }
      operations.push({
        op: "add",
        path: "/flowDataSet/flowInformation/geography",
        value: { locationOfSupply: codeToken },
        basis:
          "The flow geography block is missing while the source name's mixAndLocationTypes segment carries the formal location code.",
        evidence: evidenceObject("flow_location_of_supply_from_mix", task, item, {
          source_value: null,
          selected_value: codeToken,
          mix_and_location_types: mixText,
        }),
        // The action item only allows the location_decision resolution mode.
        resolution: resolution(
          "location_decision",
          "Materialized geography.locationOfSupply from the source-backed location code in the name's mixAndLocationTypes segment.",
        ),
        closes_action_items: [closureFor(item)],
      });
      continue;
    }
    if (code === "semantic_local_source_path_visible") {
      const itemPath = actionPath(item);
      if (!itemPath) continue;
      const pointer = `/${itemPath.split(".").join("/")}`;
      const original = String(itemEvidence.text ?? "");
      const sanitized =
        original
          .replace(/\bsource\b[\s\S]*?\.xml\b\.?/iu, "source.")
          .replace(/\s+/gu, " ")
          .trim() || "Imported from EcoSpold 1 source.";
      operations.push({
        op: "replace",
        path: pointer,
        value: sanitized,
        basis:
          "Local package paths are import-time provenance, not user-facing payload text; the conversion trace already records the source file.",
        evidence: evidenceObject("local_source_path_removed", task, item, {
          source_value: original,
          selected_value: sanitized,
        }),
        resolution: resolution(
          "source_language_normalization",
          "Removed the local source package path from the visible comment; conversion provenance remains in the tidasimport:sourceTrace block.",
        ),
        closes_action_items: [closureFor(item)],
      });
      continue;
    }
    if (
      isProcess &&
      actionPath(item).includes("functionalUnitOrOther") &&
      ["semantic_geography_token_in_name", "semantic_name_placeholder_token"].includes(code)
    ) {
      if (emittedFunctionalUnitClean) continue;
      emittedFunctionalUnitClean = true;
      const nameMixLocationText = normalizeLocationTokenCode(
        textFromMultilang(name.mixAndLocationTypes).trim(),
      );
      const nameMixLocationCode = /^[A-Z0-9][A-Z0-9+&-]{1,30}$/u.test(nameMixLocationText)
        ? nameMixLocationText
        : null;
      const value =
        cleanProcessFunctionalUnitText(functionalUnit, locationCode) ??
        removeTrailingLocationToken(functionalUnit, locationCode) ??
        (nameMixLocationCode && nameMixLocationCode !== locationCode
          ? (cleanProcessFunctionalUnitText(functionalUnit, nameMixLocationCode) ??
            removeTrailingLocationToken(functionalUnit, nameMixLocationCode))
          : null);
      if (!value) {
        operations.push({
          blocker: {
            code: "bafu_process_functional_unit_location_token_unsupported",
            dataset_id: entityId,
            action_item: closureFor(item),
            message:
              "BAFU auto patch only removes generated placeholder tokens and trailing formal location suffixes when they match the dataset geography field.",
          },
        });
        continue;
      }
      const closes = (
        functionalUnitActionItems.length > 0 ? functionalUnitActionItems : [item]
      ).map(closureFor);
      operations.push({
        op: "replace",
        path: "/processDataSet/processInformation/quantitativeReference/functionalUnitOrOther",
        value,
        basis:
          "The formal geography code belongs in processInformation.geography, and generated placeholder tokens such as 'xx' must not remain in the quantitative reference text.",
        evidence: evidenceObject("functional_unit_location_token_removed", task, item, {
          source_value: functionalUnit,
          selected_value: value,
          formal_location_field: formalLocationField,
        }),
        resolution: resolution(
          "source_language_normalization",
          "Removed generated placeholder and trailing location tokens from the process quantitative reference while preserving the formal geography field.",
        ),
        closes_action_items: closes,
      });
    }

    if (
      code === "semantic_name_base_contains_unsplit_segments" ||
      code === "semantic_name_treatment_placeholder" ||
      code === "semantic_name_quantitative_property_not_split" ||
      code === "semantic_name_source_locator_in_name"
    ) {
      if (emittedNameSplit) continue;
      emittedNameSplit = true;
      const closes = (nameSplitActionItems.length > 0 ? nameSplitActionItems : [item]).map(
        closureFor,
      );
      if (!nameSplit) {
        operations.push({
          blocker: {
            code: "bafu_name_split_unsupported",
            dataset_id: entityId,
            action_item: closureFor(item),
            message:
              "BAFU auto patch could not split the source name into a core baseName and source-backed treatment/route qualifier.",
          },
        });
        continue;
      }
      operations.push({
        op: "replace",
        path: `${namePathPrefix}/baseName`,
        value: englishText(nameSplit.base_name),
        basis:
          "The source base name embeds route, technology, allocation, or treatment qualifiers; TIDAS name-plan stores the core flow/process name separately from treatment/route qualifiers.",
        evidence: evidenceObject("name_plan_split", task, item, {
          source_name: nameSplit.source,
          extracted_base_name: nameSplit.base_name,
          extracted_treatment: nameSplit.treatment,
        }),
        resolution: resolution(
          "source_language_normalization",
          "Split BAFU source-language name into core baseName and treatment/route qualifiers.",
        ),
        closes_action_items: closes,
      });
      operations.push({
        op: "replace",
        path: `${namePathPrefix}/treatmentStandardsRoutes`,
        value: englishText(nameSplit.treatment),
        basis:
          "The extracted source-language phrase is a treatment, route, technology, or allocation qualifier, not part of the core flow/process name.",
        evidence: evidenceObject("name_plan_treatment_route", task, item, {
          source_name: nameSplit.source,
          extracted_treatment: nameSplit.treatment,
        }),
        resolution: resolution(
          "source_language_normalization",
          "Moved the source treatment/route qualifier from baseName into treatmentStandardsRoutes.",
        ),
        closes_action_items: closes,
      });
      if (nameSplitMixLocation && !emittedMixLocation) {
        emittedMixLocation = true;
        const hasExplicitMixAction = mixLocationActionItems.length > 0;
        const mixCloses = hasExplicitMixAction ? mixLocationActionItems.map(closureFor) : closes;
        operations.push({
          op: "replace",
          path: `${namePathPrefix}/mixAndLocationTypes`,
          value: englishText(nameSplitMixLocation),
          basis:
            "The source name embeds a mix or availability phrase; TIDAS name-plan stores it in mixAndLocationTypes rather than baseName.",
          evidence: evidenceObject("name_plan_mix_location", task, item, {
            source_name: nameSplit.source,
            extracted_mix_location: nameSplitMixLocation,
          }),
          resolution: resolution(
            hasExplicitMixAction ? "location_decision" : "source_language_normalization",
            "Moved the source mix/location phrase from baseName into mixAndLocationTypes.",
          ),
          closes_action_items: mixCloses,
        });
      }
      if (nameSplit.flow_property) {
        const flowPropertyExists = Boolean(
          textFromMultilang(name.functionalUnitFlowProperties).trim(),
        );
        operations.push({
          op: flowPropertyExists ? "replace" : "add",
          path: `${namePathPrefix}/functionalUnitFlowProperties`,
          value: englishText(nameSplit.flow_property),
          basis:
            "The source name embeds a quantitative flow-property qualifier; TIDAS name-plan stores it in functionalUnitFlowProperties rather than baseName or treatmentStandardsRoutes.",
          evidence: evidenceObject("name_plan_flow_property", task, item, {
            source_name: nameSplit.source,
            extracted_flow_property: nameSplit.flow_property,
          }),
          resolution: resolution(
            "source_language_normalization",
            "Moved the source-backed quantitative qualifier from the dataset name into functionalUnitFlowProperties.",
          ),
          closes_action_items: closes,
        });
      }
    }

    if (code === "semantic_name_mix_location_too_bare") {
      if (emittedMixLocation) continue;
      emittedMixLocation = true;
      const locationCode = String(itemEvidence.location_code_candidate ?? "").toUpperCase();
      const locationPhrase =
        nameSplitMixLocation ?? inferMixLocationPhrase({ isProcess, name, locationCode });
      operations.push({
        op: "replace",
        path: `${namePathPrefix}/mixAndLocationTypes`,
        value: englishText(locationPhrase),
        basis:
          "The field contains only a bare location code; the completed location decision places the formal code in locationOfSupply, while the required name-plan field should carry a human-readable availability/location-type phrase.",
        evidence: evidenceObject("bare_location_name_part_replaced", task, item, {
          removed_value: itemEvidence.text ?? null,
          formal_location_field: formalLocationField,
          formal_location_code: locationCode || null,
          selected_name_phrase: locationPhrase,
        }),
        resolution: resolution(
          "location_decision",
          "Replaced a bare location code with a source-language location-type phrase while locationOfSupply carries the formal TIDAS code.",
        ),
        closes_action_items: [closureFor(item)],
      });
    }

    if (code === "semantic_content_saturation_flow_quantitative_properties_missing" && !isProcess) {
      const value = flowReferencePropertyActionValue(item);
      if (!value) {
        operations.push({
          blocker: {
            code: "bafu_flow_property_descriptor_missing",
            dataset_id: entityId,
            action_item: closureFor(item),
            message: "No reference flow-property descriptor was available for autofill.",
          },
        });
        continue;
      }
      operations.push({
        op: "add",
        path: "/flowDataSet/flowInformation/dataSetInformation/name/flowProperties",
        value,
        basis:
          "The referenced quantitative flow property is explicit evidence for the TIDAS name.flowProperties descriptor and is not redundant with the base flow name.",
        evidence: evidenceObject("flow_property_descriptor_from_reference", task, item, {
          reference_flow_properties: itemEvidence.reference_flow_properties ?? [],
          selected_value: value,
        }),
        resolution: resolution(
          "evidence_backed_completion",
          "Filled flowProperties from the referenced quantitative flow property evidence.",
        ),
        closes_action_items: [closureFor(item)],
      });
    }

    if (code === "semantic_process_only_output_exchange_requires_review" && isProcess) {
      operations.push(buildSourceOnlyOutputExchangeTraceOperation(task, item));
    }
  }
  return operations;
}

function processSourceTraceObject(task: JsonRecord): JsonRecord | null {
  const packagePayload = jsonRecord(task.authoring_package_payload);
  const sourceProcess = jsonRecord(jsonRecord(packagePayload.source_row).processDataSet);
  const entityProcess = jsonRecord(jsonRecord(packagePayload.entity_payload).processDataSet);
  const info = jsonRecord(
    jsonRecord(sourceProcess.processInformation).dataSetInformation ??
      jsonRecord(entityProcess.processInformation).dataSetInformation,
  );
  const sourceTrace = jsonRecord(jsonRecord(info["common:other"])["tidasimport:sourceTrace"]);
  const payload = jsonRecord(sourceTrace.payload);
  return Object.keys(payload).length > 0 ? payload : null;
}

function processSourceExchangeCompletenessEvidence(
  task: JsonRecord,
  actionItem: JsonRecord,
): JsonRecord {
  const sourceTrace = processSourceTraceObject(task);
  const sourceObject =
    sourceTrace?.sourceObject ?? jsonRecord(task.context).source_rows_file ?? null;
  const actionEvidence = jsonRecord(actionItem.evidence);
  const exchangeCount = actionEvidence.exchange_count ?? null;
  const directions = actionEvidence.directions ?? [];
  return {
    source: "dataset-bafu-auto-authoring",
    source_file: sourceObject,
    field_path: "processDataSet.exchanges.exchange",
    quote_or_trace:
      "Source TIDAS process row contains only Output exchanges; Foundry preserves the source exchange set and requires an explicit source-trace acceptance record before remote write.",
    source_trace: sourceTrace
      ? {
          format: sourceTrace.format ?? null,
          sourceObject,
          sourceClassification: sourceTrace.sourceClassification ?? null,
        }
      : null,
    exchange_count: exchangeCount,
    directions,
  };
}

function buildSourceOnlyOutputExchangeTraceOperation(
  task: JsonRecord,
  actionItem: JsonRecord,
): JsonRecord {
  const trace = {
    status: "source_only_output_exchange_verified",
    action_item_code: "semantic_process_only_output_exchange_requires_review",
    source: "dataset-bafu-auto-authoring",
    summary:
      "Foundry verified from the BAFU/TIDAS source row that this process scope is output-only in the source package; no synthetic input exchange is created.",
    evidence: processSourceExchangeCompletenessEvidence(task, actionItem),
  };
  return {
    op: "add",
    path: "/processDataSet/processInformation/dataSetInformation/common:other",
    value: {
      "@xmlns:tiangongfoundry": "https://tiangong.earth/foundry/curation/1.0",
      "tiangongfoundry:sourceExchangeCompleteness": [trace],
    },
    basis:
      "The source BAFU/TIDAS process row itself is output-only, and the import must preserve source exchange semantics rather than manufacturing missing inputs.",
    evidence: evidenceObject("source_only_output_exchange_verified", task, actionItem, {
      trace,
    }),
    resolution: resolution(
      "source_trace_verified",
      "Closed the output-only exchange action item with structured source trace evidence from the BAFU/TIDAS authoring package.",
    ),
    closes_action_items: [closureFor(actionItem)],
  };
}

export const bafuAutoAuthoringTestHooks = {
  splitBafuNamePlan,
  splitBafuNamePlanFromNameParts,
  cleanProcessFunctionalUnitText,
  removeTrailingLocationToken,
  nonEquivalentFlowCandidateReasons,
  strongNameMeaningDiffers,
  routeOrTechnologyDiffers,
};

export function createBafuAutoAuthoringCommands({
  ensureArray,
  fileExists,
  nowIso,
  readJson,
  repoRelativePath,
  resolveRepoPath,
  writeJson,
  writeJsonLines,
}: BafuAutoAuthoringDependencies): {
  runDatasetBafuAuthoringPatchesAutofill: (options?: JsonRecord) => JsonRecord;
  runDatasetBafuIdentityDecisionsAutofill: (options?: JsonRecord) => JsonRecord;
} {
  function runDatasetBafuIdentityDecisionsAutofill(options: JsonRecord = {}): JsonRecord {
    if (options.help) {
      return {
        schema_version: 1,
        status: "help",
        command: "dataset-bafu-identity-decisions-autofill",
        usage: [
          "node scripts/foundry.ts dataset-bafu-identity-decisions-autofill --identity-decision-task <identity-decision-task.json>",
        ],
        purpose:
          "Write BAFU-specific identity-decisions.jsonl for safe, auditable product-flow create_new cases. This command never writes the remote database.",
      };
    }
    const taskPath = resolveRepoPath(options.identityDecisionTask ?? options.task ?? options.input);
    if (!taskPath || !fileExists(taskPath)) {
      throw new Error("--identity-decision-task is required.");
    }
    const task = readJson(taskPath);
    const taskFiles = jsonRecord(task.files);
    const outFile = resolveRepoPath(
      options.out ||
        options.decisions ||
        taskFiles.expected_decisions ||
        path.join(path.dirname(taskPath), "identity-decisions.jsonl"),
    )!;
    const outDir = resolveRepoPath(options.outDir || path.dirname(outFile))!;
    const reportFile = path.join(outDir, "bafu-identity-decisions-autofill-report.json");
    const rows = ensureArray(task.identity_action_items)
      .map(jsonRecord)
      .map((item) => identityDecisionRow(item, task));
    const blockedRows = rows.filter((row) => row.identity_decision === "block_unresolved");
    fs.mkdirSync(outDir, { recursive: true });
    writeJsonLines(outFile, rows);
    const report = {
      schema_version: 1,
      generated_at_utc: nowIso(),
      status: blockedRows.length > 0 ? "completed_with_manual_review" : "completed",
      command: "dataset-bafu-identity-decisions-autofill",
      identity_decision_task: repoRelativePath(taskPath),
      counts: {
        identity_action_items: ensureArray(task.identity_action_items).length,
        decisions: rows.length,
        create_new: rows.filter((row) => row.identity_decision === "create_new").length,
        blocked_unresolved: blockedRows.length,
      },
      blocked: blockedRows.map((row) => ({
        dataset_id: row.dataset_id,
        dataset_version: row.dataset_version,
        reason: row.basis,
      })),
      files: {
        report: repoRelativePath(reportFile),
        decisions: repoRelativePath(outFile),
      },
    };
    writeJson(reportFile, report);
    return report;
  }

  function runDatasetBafuAuthoringPatchesAutofill(options: JsonRecord = {}): JsonRecord {
    if (options.help) {
      return {
        schema_version: 1,
        status: "help",
        command: "dataset-bafu-authoring-patches-autofill",
        usage: [
          "node scripts/foundry.ts dataset-bafu-authoring-patches-autofill --task-manifest <authoring-task-manifest.json>",
        ],
        purpose:
          "Write per-task BAFU AI patch artifacts for supported high-confidence name-plan and flow-property saturation action items. This command never writes the remote database.",
      };
    }
    const manifestPath = resolveRepoPath(options.taskManifest ?? options.manifest ?? options.input);
    if (!manifestPath || !fileExists(manifestPath)) {
      throw new Error("--task-manifest is required.");
    }
    const manifest = readJson(manifestPath);
    const outDir = resolveRepoPath(options.outDir || path.dirname(manifestPath))!;
    const reportFile = path.join(outDir, "bafu-authoring-patches-autofill-report.json");
    const blockers: JsonRecord[] = [];
    const patchFiles: string[] = [];

    for (const task of ensureArray(manifest.tasks).map(jsonRecord)) {
      if (task.status !== "ready_for_ai_authoring") continue;
      const taskFiles = jsonRecord(task.files);
      const taskEntity = jsonRecord(task.entity);
      const taskContext = jsonRecord(task.context);
      const packagePath = resolveRepoPath(taskFiles.authoring_package);
      if (!packagePath || !fileExists(packagePath)) {
        blockers.push({
          code: "authoring_package_missing",
          dataset_id: taskEntity.entity_id ?? null,
          authoring_package: taskFiles.authoring_package ?? null,
        });
        continue;
      }
      const enrichedTask = {
        ...task,
        authoring_package_payload: readJson(packagePath),
      };
      const operations = buildNamePatchOperations(enrichedTask);
      const operationBlockers = operations.filter((operation) => operation.blocker);
      if (operationBlockers.length > 0) {
        blockers.push(...operationBlockers.map((operation) => jsonRecord(operation.blocker)));
        continue;
      }
      const patchPath = resolveRepoPath(taskFiles.output_patch_file);
      if (!patchPath) {
        blockers.push({
          code: "output_patch_file_missing",
          dataset_id: taskEntity.entity_id ?? null,
        });
        continue;
      }
      const payload = {
        schema_version: 1,
        kind: "tiangong_foundry_dataset_patch",
        patch_status: "completed",
        generated_at_utc: nowIso(),
        task_manifest: repoRelativePath(manifestPath),
        patch_sets: [
          {
            dataset_type: taskEntity.dataset_type,
            dataset_id: taskEntity.entity_id,
            version: taskEntity.version,
            authoring_package: path.basename(packagePath),
            authoring_package_sha256: taskContext.authoring_package_sha256 ?? null,
            operations,
          },
        ],
      };
      ensureDirFor(patchPath);
      writeJson(patchPath, payload);
      patchFiles.push(repoRelativePath(patchPath));
    }

    const report = {
      schema_version: 1,
      generated_at_utc: nowIso(),
      status: blockers.length > 0 ? "completed_with_manual_review" : "completed",
      command: "dataset-bafu-authoring-patches-autofill",
      task_manifest: repoRelativePath(manifestPath),
      counts: {
        tasks: ensureArray(manifest.tasks).length,
        patch_files: patchFiles.length,
        blockers: blockers.length,
      },
      blockers,
      files: {
        report: repoRelativePath(reportFile),
        patch_files: patchFiles,
      },
    };
    fs.mkdirSync(outDir, { recursive: true });
    writeJson(reportFile, report);
    return report;
  }

  return {
    runDatasetBafuAuthoringPatchesAutofill,
    runDatasetBafuIdentityDecisionsAutofill,
  };
}

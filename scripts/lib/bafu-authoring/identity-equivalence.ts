import { englishText, normalizeIdentityText, textFromMultilang } from "./name-plan.ts";

export type JsonRecord = Record<string, unknown>;

export interface ReuseCandidateResult {
  ok: boolean;
  reason?: string;
  reuse?: JsonRecord;
  reviewed?: JsonRecord[];
}

export interface CandidateReviewResult {
  exactEquivalentCandidate: JsonRecord | null;
  reviewed: JsonRecord[];
}

function isJsonRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function jsonRecord(value: unknown): JsonRecord {
  return isJsonRecord(value) ? value : {};
}

function lowerText(value: unknown): string {
  return String(value ?? "").toLowerCase();
}

function arrayValues(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  return value == null ? [] : [value];
}

export function flowReferencePropertyActionValue(actionItem: JsonRecord): JsonRecord | null {
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

export function identityTextFromParts(parts: unknown): string {
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

export function strongNameMeaningDiffers(targetNames: unknown, candidateNames: unknown): boolean {
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

export function routeOrTechnologyDiffers(targetNames: unknown, candidateNames: unknown): boolean {
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
  reviewedCandidates: readonly JsonRecord[],
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
  candidates: readonly JsonRecord[],
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

export function nonEquivalentFlowCandidateReasons(
  target: JsonRecord,
  candidates: readonly JsonRecord[],
): CandidateReviewResult {
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
    const reasons: string[] = [];
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

export function nonEquivalentProcessCandidateReasons(
  target: JsonRecord,
  candidates: readonly JsonRecord[],
): CandidateReviewResult {
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

export function canCreateBafuProductFlow(actionItem: JsonRecord): ReuseCandidateResult {
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

export function canCreateBafuProcess(actionItem: JsonRecord): ReuseCandidateResult {
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

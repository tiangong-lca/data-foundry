import type { EntityRow, JsonRecord } from "./entity-projection.ts";

export interface UsageStats {
  input: number;
  output: number;
  other: number;
  process_ids: string[];
}

export interface SourceClassification {
  category: string;
  subCategory: string;
}

interface TargetCategoryInput {
  targetNames: unknown[];
  targetCategories: unknown[];
  usage?: UsageStats | null;
}

interface TraceCompartment {
  kind: string;
  longTerm: boolean;
  subCategory: string;
  pattern: RegExp | null;
  fallbackPattern: RegExp | null;
}

interface ScoredCandidate {
  candidate: JsonRecord;
  index: number;
  fields: JsonRecord;
  candidateNames: unknown[];
  candidateCas: string;
  candidateCategories: unknown[];
  nameScore: number;
  nameTier: number;
  exactCompartmentMatched: boolean;
  fallbackCompartmentMatched: boolean;
  compartmentMatched: boolean;
  dimensionLabelOverridden: boolean;
  sameCas: boolean;
  score: number;
  blockerCodes: string[];
}

export interface ElementaryIdentityEvaluationInput {
  entity: EntityRow;
  report: JsonRecord | null;
  usage?: UsageStats | null;
  sourceClassification?: SourceClassification | null;
}

export interface ElementaryIdentityEvaluation extends JsonRecord {
  decision: string;
  reason: string;
  candidate?: JsonRecord;
  evidence: JsonRecord;
}

function isJsonRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function jsonRecord(value: unknown): JsonRecord {
  return isJsonRecord(value) ? value : {};
}

function ensureArray<T>(value: T | readonly T[] | null | undefined): T[] {
  if (Array.isArray(value)) return [...value] as T[];
  return value == null ? [] : [value as T];
}

function normalizedText(value: unknown): string {
  return String(value ?? "")
    .trim()
    .replace(/\s+/gu, " ")
    .toLowerCase();
}

function compactIdentityText(value: unknown): string {
  return normalizedText(value)
    .replace(/[^a-z0-9]+/gu, "")
    .trim();
}

function identityTokens(value: unknown): string[] {
  return normalizedText(value)
    .replace(/[^a-z0-9]+/gu, " ")
    .split(/\s+/u)
    .filter((token) => token.length >= 2 && !["the", "and", "with"].includes(token));
}

function normalizedCas(value: unknown): string {
  // BAFU/ecoinvent zero-pads CAS numbers ("000124-38-9"); the remote library stores the
  // canonical unpadded form ("124-38-9"). Compare without leading zeros.
  return String(value ?? "")
    .trim()
    .replace(/[^0-9-]+/gu, "")
    .replace(/^0+(?=\d)/u, "");
}

function flowPropertyDimension(value: unknown): string {
  const normalized = normalizedText(value);
  if (/\bkg\b|mass/u.test(normalized)) return "mass";
  if (/\b(kwh|mj)\b|energy|calorific/u.test(normalized)) return "energy";
  if (/\b(k?bq)\b|radioactiv/u.test(normalized)) return "radioactivity";
  if (/\b(n?m3|m\^?3)\b|volume/u.test(normalized)) return "volume";
  if (/\bm2a\b|area.*time|occupation/u.test(normalized)) return "area_time";
  if (/\b(ha|m2|m\^?2)\b|area/u.test(normalized)) return "area";
  if (/\b(tkm|personkm)\b|transport/u.test(normalized)) return "transport";
  if (/\b(km|m)\b|length|distance/u.test(normalized)) return "length";
  if (/\b(unit|p|person|item)\b/u.test(normalized)) return "count";
  return normalized || "unknown";
}

function categoryKind(categories: unknown): string | null {
  const text = normalizedText(ensureArray(categories).join(" > "));
  if (!text) return null;
  if (/resource|resources|from ground|in ground|water resource|biotic|land/u.test(text)) {
    if (/occupation/u.test(text)) return "land_occupation";
    if (/transformation/u.test(text)) return "land_transformation";
    return "resource";
  }
  if (/emission|emissions/u.test(text)) {
    if (/air/u.test(text)) return "emission_air";
    if (/water|river|lake|sea|ocean/u.test(text)) return "emission_water";
    if (/soil/u.test(text)) return "emission_soil";
    return "emission";
  }
  return null;
}

function inferTargetCategoryKind({
  targetNames,
  targetCategories,
  usage,
}: TargetCategoryInput): string | null {
  const nameText = normalizedText(targetNames.join(" "));
  if (
    /^energy\b|energy from|crude oil|natural gas|coal|lignite|peat|uranium|ore|resource/u.test(
      nameText,
    )
  ) {
    return "resource";
  }
  if (/^occupation\b|land occupation/u.test(nameText)) return "land_occupation";
  if (/^transformation\b|land transformation/u.test(nameText)) return "land_transformation";
  if (/^water\b|water river|water lake|water ocean|groundwater/u.test(nameText)) {
    if ((usage?.input ?? 0) >= (usage?.output ?? 0)) return "resource";
  }
  const convertedKind = categoryKind(targetCategories);
  if (convertedKind) return convertedKind;
  if ((usage?.input ?? 0) > 0 && (usage?.output ?? 0) === 0) return "resource";
  if ((usage?.output ?? 0) > 0 && (usage?.input ?? 0) === 0) return "emission";
  return null;
}

function categoryCompatible(inferredKind: string | null, candidateKind: string | null): boolean {
  if (!inferredKind || !candidateKind) return true;
  if (inferredKind === candidateKind) return true;
  if (inferredKind === "emission" && candidateKind.startsWith("emission")) return true;
  if (inferredKind.startsWith("emission") && candidateKind === "emission") return true;
  if (inferredKind === "resource" && candidateKind.startsWith("land_")) return true;
  return false;
}

function hasLongTermCategory(categories: unknown): boolean {
  return /\blong\s*term\b|long-term/u.test(normalizedText(ensureArray(categories).join(" ")));
}

function overlapScore(leftNames: unknown[], rightNames: unknown[]): number {
  let best = 0;
  for (const left of leftNames) {
    const leftNormalized = normalizedText(left);
    const leftCompact = compactIdentityText(left);
    if (!leftCompact) continue;
    const leftTokens = new Set(identityTokens(left));
    for (const right of rightNames) {
      const rightNormalized = normalizedText(right);
      const rightCompact = compactIdentityText(right);
      if (!rightCompact) continue;
      if (leftCompact === rightCompact || leftNormalized === rightNormalized) {
        best = Math.max(best, 45);
        continue;
      }
      if (leftCompact.includes(rightCompact) || rightCompact.includes(leftCompact)) {
        best = Math.max(best, 32);
      }
      const rightTokens = new Set(identityTokens(right));
      const overlap = [...leftTokens].filter((token) => rightTokens.has(token)).length;
      const denominator = Math.max(1, Math.min(leftTokens.size, rightTokens.size));
      best = Math.max(best, Math.round((overlap / denominator) * 24));
    }
  }
  return best;
}

export function openLcaCompartmentClassification(
  categoryPath: unknown,
): SourceClassification | null {
  // Translate the FEDEFL "/"-delimited compartment path into the ecoinvent-style
  // {category, subCategory} shape that traceCompartment already maps onto remote ILCD
  // category patterns, so the openLCA lane reuses the BAFU-tested compartment tiering.
  const segments = String(categoryPath ?? "")
    .split("/")
    .map((segment) => normalizedText(segment))
    .filter((segment) => segment && segment !== "elementary flows" && segment !== "non-fedefl");
  if (segments.length === 0) return null;
  const direction = segments[0];
  const compartment = segments[1] ?? "";
  const subText = segments.slice(2).join(" ");
  if (direction === "resource") {
    return { category: `resource, ${compartment || "unspecified"}`, subCategory: "" };
  }
  if (direction !== "emission") return null;
  if (compartment === "air") {
    let subCategory = "";
    if (/indoor/u.test(subText)) subCategory = "indoor";
    else if (/stratosphere/u.test(subText)) subCategory = "stratosphere";
    else if (/urban/u.test(subText)) subCategory = "high. pop.";
    else if (/rural|troposphere|high/u.test(subText)) subCategory = "low. pop.";
    return { category: "emissions to air", subCategory };
  }
  if (compartment === "water") {
    let subCategory = "";
    if (/saline|ocean|sea/u.test(subText)) subCategory = "ocean";
    else if (/subterranean|ground/u.test(subText)) subCategory = "ground water";
    else if (/fresh|river|lake/u.test(subText)) subCategory = "river";
    return { category: "emissions to water", subCategory };
  }
  if (compartment === "ground") {
    let subCategory = "";
    if (/agricultur/u.test(subText)) subCategory = "agricultural";
    else if (/industri/u.test(subText)) subCategory = "industrial";
    else if (/forest/u.test(subText)) subCategory = "forest";
    return { category: "emissions to soil", subCategory };
  }
  return null;
}

export function traceCompartment(
  sourceClassification: SourceClassification | null,
): TraceCompartment | null {
  if (!sourceClassification) return null;
  const { category, subCategory } = sourceClassification;
  let kind = null;
  if (/emissions? to air/u.test(category)) kind = "emission_air";
  else if (/emissions? to water/u.test(category)) kind = "emission_water";
  else if (/emissions? to soil/u.test(category)) kind = "emission_soil";
  else if (/resource/u.test(category)) kind = "resource";
  if (!kind) return null;
  const longTerm = /long[\s-]*term/u.test(subCategory);
  const base = subCategory.replace(/,?\s*long[\s-]*term/u, "").trim();
  // ecoinvent sub-compartment → remote (ILCD-style) third-level category pattern
  let pattern = null;
  if (kind === "emission_air") {
    if (/^low\.? ?pop\.?$/u.test(base)) pattern = /non-urban air|from high stacks/u;
    else if (/^high\.? ?pop\.?$/u.test(base)) pattern = /urban air close to ground/u;
    else if (/stratosphere/u.test(base)) pattern = /stratosphere/u;
    else if (/indoor/u.test(base)) pattern = /indoor/u;
    else if (!base || /unspecified/u.test(base)) pattern = /air, unspecified$/u;
  } else if (kind === "emission_water") {
    if (/^(river|lake)$/u.test(base)) pattern = /fresh water/u;
    else if (/ocean|sea/u.test(base)) pattern = /sea water/u;
    else if (/ground ?water/u.test(base)) pattern = /ground water|fresh water|water, unspecified/u;
    else if (!base || /unspecified/u.test(base)) pattern = /water, unspecified$/u;
  } else if (kind === "emission_soil") {
    if (/agricultur/u.test(base)) pattern = /to agricultural soil/u;
    else if (/industri/u.test(base)) pattern = /industrial soil/u;
    else if (/forest/u.test(base)) pattern = /non-agricultural soil|soil, unspecified/u;
    else if (!base || /unspecified/u.test(base)) pattern = /soil, unspecified$/u;
  }
  // When the mapped sub-compartment has no remote candidate, the standard fallback is the
  // compartment's "unspecified" variant (long-term form when the source is long-term).
  const compartmentWord =
    kind === "emission_air" ? "air" : kind === "emission_water" ? "water" : "soil";
  const fallbackPattern =
    kind === "resource"
      ? null
      : longTerm
        ? new RegExp(`${compartmentWord}, unspecified \\(long-term\\)$`, "u")
        : new RegExp(`${compartmentWord}, unspecified$`, "u");
  return { kind, longTerm, subCategory: base, pattern, fallbackPattern };
}

export function evaluateElementaryIdentityDecision({
  entity,
  report,
  usage,
  sourceClassification = null,
}: ElementaryIdentityEvaluationInput): ElementaryIdentityEvaluation {
  const reportRecord = report ?? {};
  const target = jsonRecord(reportRecord.target);
  const targetFields = jsonRecord(target.fields);
  const targetNames = [
    ...ensureArray(target.names),
    entity.name,
    targetFields.name,
    target.identity_key,
  ].filter(Boolean);
  const targetCas = normalizedCas(targetFields.cas);
  const targetDimension = flowPropertyDimension(
    targetFields.flow_property || entity.flow_property_refs?.[0]?.short_description,
  );
  const targetCategories = ensureArray(targetFields.categories);
  const trace = traceCompartment(sourceClassification);
  const inferredKind =
    trace?.kind ??
    inferTargetCategoryKind({
      targetNames,
      targetCategories,
      usage,
    });
  const targetHasLongTerm = trace ? trace.longTerm : hasLongTermCategory(targetCategories);
  const rawCandidates = ensureArray(reportRecord.candidates).map(jsonRecord);

  if (!report || typeof report !== "object") {
    return {
      decision: "block_unresolved",
      reason: "identity_preflight_report_missing_or_invalid",
      evidence: { target_dimension: targetDimension, inferred_category_kind: inferredKind },
    };
  }
  // A preflight "create_new" is a candidate suggestion, not an authoritative decision;
  // elementary flows may still match an existing remote flow, so evaluate candidates anyway.
  const preflightSuggestedCreateNew = reportRecord.decision === "create_new";

  const targetCompacts = targetNames.map((name) => compactIdentityText(name)).filter(Boolean);
  const BAFU_DEFAULT_ELEMENTARY_PATH =
    "emissions > emissions to air > emissions to air, unspecified";
  const targetCategoryText = normalizedText(targetCategories.join(" > "));
  // The converter writes this exact path as a default on most elementary flows; only treat
  // converted categories as evidence when they differ from the default.
  const targetCategoriesReliable =
    Boolean(targetCategoryText) && targetCategoryText !== BAFU_DEFAULT_ELEMENTARY_PATH;
  const scoredCandidates: ScoredCandidate[] = rawCandidates.map((candidate, index) => {
    const fields = jsonRecord(candidate.fields);
    const candidateType = normalizedText(fields.type_of_dataset);
    const candidateNames = ensureArray(candidate.names);
    const candidateCas = normalizedCas(fields.cas);
    const candidateDimension = flowPropertyDimension(fields.flow_property);
    const candidateCategories = ensureArray(fields.categories);
    const candidateCategoryText = normalizedText(candidateCategories.join(" > "));
    const candidateKind = categoryKind(candidateCategories);
    const nameScore = overlapScore(targetNames, candidateNames);
    const candidateCompacts = candidateNames
      .map((name) => compactIdentityText(name))
      .filter(Boolean);
    // Token-set equality covers word-order variants ("Heat, waste" ↔ "waste heat").
    const targetTokenSets = targetNames
      .map((name) => new Set(identityTokens(name)))
      .filter((tokens) => tokens.size >= 2);
    const tokenSetEqual = candidateNames.some((name) => {
      const candidateTokens = new Set(identityTokens(name));
      return (
        candidateTokens.size >= 2 &&
        targetTokenSets.some(
          (targetTokens) =>
            targetTokens.size === candidateTokens.size &&
            [...targetTokens].every((token) => candidateTokens.has(token)),
        )
      );
    });
    // Chemical-name inversion ("Ethane, 1,1,2,2-tetrachloro-" ↔ "1,1,2,2-tetrachloroethane"):
    // after separating digit locants, some permutation of the target's word tokens
    // concatenates to the candidate's word part and the digit multisets agree.
    const digitsOf = (value: unknown): string =>
      Array.from(String(value).replace(/[^0-9]+/gu, ""))
        .sort()
        .join("");
    const wordPartOf = (value: unknown): string => String(value).replace(/[0-9]+/gu, "");
    const permutationCompactEqual = candidateCompacts.some((cn) => {
      const candidateWord = wordPartOf(cn);
      if (candidateWord.length < 6) return false;
      const candidateDigits = digitsOf(cn);
      return targetNames.some((name) => {
        if (typeof name !== "string" || name.includes("|")) return false;
        if (digitsOf(compactIdentityText(name)) !== candidateDigits) return false;
        const tokens = identityTokens(name)
          .map((token) => wordPartOf(token))
          .filter((token) => token.length >= 2);
        if (tokens.length < 2 || tokens.length > 4) return false;
        if (tokens.join("").length !== candidateWord.length) return false;
        const permute = (rest: string[], acc: string): boolean => {
          if (rest.length === 0) return acc === candidateWord;
          if (!candidateWord.startsWith(acc)) return false;
          return rest.some((token, i) =>
            permute([...rest.slice(0, i), ...rest.slice(i + 1)], acc + token),
          );
        };
        return permute(tokens, "");
      });
    });
    // Minimum lengths guard against degenerate compacts (e.g. a non-Latin name whose
    // compact collapses to a single character) producing false equality/containment.
    const exactName =
      candidateCompacts.some((cn) => cn.length >= 3 && targetCompacts.includes(cn)) ||
      tokenSetEqual ||
      permutationCompactEqual;
    // Direction matters for containment: a candidate that extends the target name
    // ("ethane" → "1,2-dibromoethane") names a different substance. A candidate whose
    // tokens form a contiguous prefix or suffix run of the target name is the same
    // substance minus a qualifier/abbreviation ("CFC-12" suffix of "Methane,
    // dichlorodifluoro-, CFC-12"; "ammonium" prefix of "Ammonium, ion"; "chemical
    // oxygen demand" suffix of "COD, Chemical Oxygen Demand"), while mid-name runs
    // ("dump site" inside "Occupation, dump site, benthos") stay manual.
    const targetTokenLists = targetNames
      .filter((name) => typeof name === "string" && !name.includes("|"))
      .map((name) => identityTokens(name))
      .filter((tokens) => tokens.length >= 1);
    const candidateInTarget = candidateNames.some((name) => {
      const candidateTokens = identityTokens(name);
      if (candidateTokens.length < 1) return false;
      const candidateCompact = compactIdentityText(name);
      if (candidateCompact.length < 4) return false;
      const candidateDigits = digitsOf(candidateCompact);
      const joined = candidateTokens.join(" ");
      return targetTokenLists.some((targetTokens) => {
        if (targetTokens.length < candidateTokens.length) return false;
        // Digit locants are substance identity ("1-Butanol" ≠ "2-butanol"): a digit-
        // bearing candidate must carry the same digits; a digit-free candidate is the
        // generic form and may stand for the locant-specified target.
        if (candidateDigits && candidateDigits !== digitsOf(targetTokens.join(""))) return false;
        const prefix = targetTokens.slice(0, candidateTokens.length).join(" ");
        const suffix = targetTokens.slice(-candidateTokens.length).join(" ");
        return prefix === joined || suffix === joined;
      });
    });
    const nameTier = exactName ? 3 : candidateInTarget ? 2 : nameScore >= 24 ? 1 : 0;
    // Tier evidence (exact/permuted equality, prefix/suffix runs) earns at least the
    // corresponding overlap score even when raw compact/token overlap misses it.
    const effectiveNameScore =
      nameTier === 3
        ? Math.max(nameScore, 45)
        : nameTier === 2
          ? Math.max(nameScore, 32)
          : nameScore;
    const sameCas = Boolean(targetCas && candidateCas && targetCas === candidateCas);
    const casConflict = Boolean(targetCas && candidateCas && targetCas !== candidateCas);
    const exactCompartmentMatched = Boolean(trace?.pattern?.test(candidateCategoryText));
    const fallbackCompartmentMatched = Boolean(trace?.fallbackPattern?.test(candidateCategoryText));
    const compartmentFamilyMatched = exactCompartmentMatched || fallbackCompartmentMatched;
    const categoryOk = categoryCompatible(inferredKind, candidateKind);
    let dimensionCompatible =
      targetDimension === "unknown" ||
      candidateDimension === "unknown" ||
      targetDimension === candidateDimension;
    let dimensionLabelOverridden = false;
    // The candidate category naming the target's dimension family ("Renewable energy
    // resources …" for an energy target) contradicts the conflicting property label and
    // marks the label as unreliable for that row.
    const categoryIndicatesTargetDimension =
      (targetDimension === "energy" && /energy resources/u.test(candidateCategoryText)) ||
      (targetDimension === "mass" && /(?:material|element) resources/u.test(candidateCategoryText));
    if (
      !dimensionCompatible &&
      !casConflict &&
      ((exactName && compartmentFamilyMatched) ||
        (nameTier >= 2 && categoryOk && categoryIndicatesTargetDimension))
    ) {
      // The remote search response carries the flow-property *label* text, which is
      // mislabeled on some remote rows (verified: ILCD "waste heat" references
      // 93a60a56-a3c8-11da-a746-0800200c9a66 = Net calorific value, but its embedded
      // shortDescription reads "Radioactivity"). With an exact name and matching
      // compartment — or a near-exact name whose category names the target dimension —
      // treat the label conflict as extraction noise instead of a veto.
      dimensionCompatible = true;
      dimensionLabelOverridden = true;
    }
    const candidateLongTerm = hasLongTermCategory(candidateCategories);
    const longTermPenalty = targetHasLongTerm
      ? candidateLongTerm
        ? 0
        : 8
      : candidateLongTerm
        ? 8
        : 0;
    const sameCategoryPath = targetCategoriesReliable
      ? candidateCategoryText === targetCategoryText
      : false;
    const legacyAirUnspecifiedBonus =
      !trace &&
      inferredKind === "emission_air" &&
      /emissions to air.*unspecified/u.test(candidateCategoryText)
        ? 14
        : 0;
    const baseScore =
      (sameCas ? 50 : 0) +
      effectiveNameScore +
      (dimensionCompatible ? 20 : -40) +
      (categoryOk ? 20 : -35) +
      (sameCategoryPath ? 14 : 0) +
      legacyAirUnspecifiedBonus -
      longTermPenalty;
    const blockerCodes: string[] = [];
    if (candidateType !== "elementary flow") blockerCodes.push("candidate_not_elementary_flow");
    if (casConflict) blockerCodes.push("cas_conflict");
    if (!dimensionCompatible) blockerCodes.push("flow_property_dimension_conflict");
    if (!categoryOk) blockerCodes.push("category_or_compartment_conflict");
    if (!sameCas && effectiveNameScore < 24) blockerCodes.push("insufficient_name_or_cas_overlap");
    // Without a CAS anchor, a candidate whose name merely extends or loosely overlaps
    // the target is not auto-acceptable evidence of the same substance.
    if (!sameCas && nameTier < 2) blockerCodes.push("name_tier_insufficient_without_cas");
    return {
      candidate,
      index,
      fields,
      candidateNames,
      candidateCas,
      candidateCategories,
      nameScore,
      nameTier,
      exactCompartmentMatched,
      fallbackCompartmentMatched,
      compartmentMatched: false,
      dimensionLabelOverridden,
      sameCas,
      score: baseScore,
      blockerCodes,
    };
  });
  const passingCandidates = scoredCandidates.filter(
    (candidate) => candidate.blockerCodes.length === 0,
  );
  // Decide the sub-compartment tier from candidates that actually pass the guardrails so a
  // cas-conflicted other substance with the mapped sub-compartment cannot mask the fallback.
  const useExactCompartment = passingCandidates.some(
    (candidate) => candidate.exactCompartmentMatched,
  );
  for (const candidate of passingCandidates) {
    candidate.compartmentMatched = trace
      ? useExactCompartment
        ? candidate.exactCompartmentMatched
        : candidate.fallbackCompartmentMatched
      : false;
    if (trace && candidate.compartmentMatched) candidate.score += 14;
  }
  const candidates = passingCandidates.sort(
    (left, right) =>
      right.score - left.score ||
      right.nameTier - left.nameTier ||
      right.nameScore - left.nameScore ||
      left.index - right.index,
  );

  if (candidates.length === 0) {
    return {
      decision: "block_unresolved",
      reason:
        rawCandidates.length === 0
          ? preflightSuggestedCreateNew
            ? "elementary_flow_create_new_forbidden"
            : "no_candidates"
          : preflightSuggestedCreateNew
            ? "elementary_flow_create_new_forbidden"
            : "no_candidate_passed_guardrails",
      evidence: {
        preflight_status: reportRecord.status ?? null,
        preflight_decision: reportRecord.decision ?? null,
        target_dimension: targetDimension,
        inferred_category_kind: inferredKind,
        source_trace_compartment: trace
          ? { kind: trace.kind, sub_category: trace.subCategory, long_term: trace.longTerm }
          : null,
        candidate_count: rawCandidates.length,
        rejected_candidate_examples: scoredCandidates.slice(0, 8).map((scored) => ({
          index: scored.index,
          id: scored.candidate?.id ?? null,
          version: scored.candidate?.version ?? null,
          names: scored.candidateNames.slice(0, 3),
          fields: scored.candidate?.fields ?? null,
          blocker_codes: scored.blockerCodes,
          name_tier: scored.nameTier,
          same_cas: scored.sameCas,
          score: scored.score,
        })),
      },
    };
  }

  const bestTier = Math.max(...candidates.map((candidate) => candidate.nameTier));
  const tieredCandidates =
    bestTier >= 2
      ? candidates.filter((candidate) => candidate.nameTier >= 2 || candidate.sameCas)
      : candidates;
  const top = tieredCandidates[0];
  const competing = tieredCandidates.slice(1).filter(
    (candidate) =>
      top.score - candidate.score < 10 &&
      normalizedText(candidate.candidateCategories.join(" > ")) !==
        normalizedText(top.candidateCategories.join(" > ")) &&
      // A candidate that misses the source-trace compartment pattern does not compete
      // with one that hits it (e.g. "(long-term)" variants against a non-long-term target).
      !(top.compartmentMatched && !candidate.compartmentMatched),
  );
  if (top.score < 72 || competing.length > 0) {
    return {
      decision: "block_unresolved",
      reason: competing.length > 0 ? "multiple_plausible_candidates" : "candidate_score_too_low",
      evidence: {
        preflight_status: reportRecord.status ?? null,
        preflight_decision: reportRecord.decision ?? null,
        target_dimension: targetDimension,
        inferred_category_kind: inferredKind,
        source_trace_compartment: trace
          ? { kind: trace.kind, sub_category: trace.subCategory, long_term: trace.longTerm }
          : null,
        best_score: top.score,
        best_candidate: {
          id: top.candidate.id,
          version: top.candidate.version,
          names: top.candidateNames,
          categories: top.candidateCategories,
          flow_property: top.fields.flow_property ?? null,
        },
        competing_candidates: competing.slice(0, 5).map((candidate) => ({
          id: candidate.candidate.id,
          version: candidate.candidate.version,
          names: candidate.candidateNames,
          categories: candidate.candidateCategories,
          score: candidate.score,
        })),
      },
    };
  }

  return {
    decision: "reuse_existing_reference",
    reason: "single_candidate_passed_physical_guardrails",
    candidate: top.candidate,
    evidence: {
      preflight_status: reportRecord.status ?? null,
      preflight_decision: reportRecord.decision ?? null,
      target_names: targetNames.slice(0, 6),
      target_cas: targetCas || null,
      target_dimension: targetDimension,
      target_categories: targetCategories,
      inferred_category_kind: inferredKind,
      source_trace_compartment: trace
        ? { kind: trace.kind, sub_category: trace.subCategory, long_term: trace.longTerm }
        : null,
      preflight_suggested_create_new: preflightSuggestedCreateNew || undefined,
      usage: usage
        ? {
            input: usage.input,
            output: usage.output,
            other: usage.other,
            process_count: usage.process_ids.length,
          }
        : null,
      selected_candidate: {
        id: top.candidate.id,
        version: top.candidate.version,
        names: top.candidateNames,
        cas: top.candidateCas || null,
        flow_property: top.fields.flow_property ?? null,
        categories: top.candidateCategories,
        score: top.score,
        name_tier: top.nameTier,
        compartment_matched: top.compartmentMatched,
        flow_property_label_overridden: top.dimensionLabelOverridden || undefined,
      },
      guardrails: [
        "same elementary flow type",
        "compatible flow property dimension",
        "compatible compartment/resource meaning",
        top.sameCas ? "same CAS" : "sufficient name/synonym overlap",
      ],
    },
  };
}

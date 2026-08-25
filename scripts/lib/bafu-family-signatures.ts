import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

function textValue(value: any): string {
  if (value == null) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value).trim();
  }
  if (Array.isArray(value)) return value.map(textValue).filter(Boolean).join("; ");
  if (typeof value === "object") {
    return textValue(
      value["#text"] ??
        value.value ??
        value.id ??
        value["@refObjectId"] ??
        value.shortDescription ??
        value["common:shortDescription"],
    );
  }
  return "";
}

function ensureArray(value: any): any[] {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function stableValue(value: any): any {
  if (value == null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(stableValue);
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, stableValue(entry)]),
  );
}

function hashJson(value: any): string {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(stableValue(value)))
    .digest("hex");
}

function normalizeText(value: any): string {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/\s+/gu, " ")
    .trim();
}

function normalizeAmount(value: any): string | number {
  const text = normalizeText(value);
  if (!text) return "";
  const parsed = Number(text);
  if (!Number.isFinite(parsed)) return text;
  return Number(parsed.toPrecision(15));
}

function processIdentity(row: any) {
  const dataSetInformation = row?.processDataSet?.processInformation?.dataSetInformation ?? {};
  const publication = row?.processDataSet?.administrativeInformation?.publicationAndOwnership ?? {};
  return {
    id: textValue(dataSetInformation["common:UUID"] ?? dataSetInformation.UUID),
    version:
      textValue(publication["common:dataSetVersion"] ?? publication.dataSetVersion) || "00.00.001",
  };
}

function processName(row: any): string {
  return textValue(row?.processDataSet?.processInformation?.dataSetInformation?.name?.baseName);
}

function processLocation(row: any): string {
  const process = row?.processDataSet ?? {};
  const location =
    process?.processInformation?.geography?.locationOfOperationSupplyOrProduction?.["@location"] ??
    process?.processInformation?.geography?.locationOfOperationSupplyOrProduction?.location ??
    process?.processInformation?.dataSetInformation?.name?.mixAndLocationTypes;
  return textValue(location);
}

function escapeRegExp(value: any): string {
  return String(value).replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

const contextualLocationPattern =
  "(?:[A-Z]{2,3}|RoW|RoE|RER|GLO|RNA|RAF|RAS|RLA|RME|Europe without Switzerland)";

function isBafuLocationToken(token: any): boolean {
  const text = normalizeText(token);
  if (text.length < 2 || text.length > 40) return false;
  if (/^\d+(?:\.\d+)?$/u.test(text)) return false;
  if (/^[a-z]+$/u.test(text)) return false;
  if (/^[A-Z0-9][A-Z0-9+&-]{1,12}$/u.test(text)) return true;
  return /^(?:Europe without Switzerland|[A-Z][A-Za-z]+(?:\s+[A-Za-z]+){1,4})$/u.test(text);
}

function locationTokensFromText(value: any): string[] {
  return [...String(value ?? "").matchAll(/\{([^}]+)\}/gu)]
    .map((match) => normalizeText(match[1]))
    .filter(isBafuLocationToken);
}

const locationTokenRegexCache = new WeakMap<any[], RegExp | null>();

function knownLocationTokensRegex(locationTokens: any): RegExp | null {
  if (!Array.isArray(locationTokens) || locationTokens.length === 0) return null;
  const cached = locationTokenRegexCache.get(locationTokens);
  if (cached !== undefined) return cached;
  const tokens = [...new Set(locationTokens ?? [])]
    .map(normalizeText)
    .filter(isBafuLocationToken)
    .sort((left, right) => right.length - left.length)
    .map(escapeRegExp);
  const regex =
    tokens.length > 0
      ? new RegExp(`(^|[^A-Za-z0-9])(?:${tokens.join("|")})([^A-Za-z0-9]|$)`, "gu")
      : null;
  locationTokenRegexCache.set(locationTokens, regex);
  return regex;
}

export function normalizeBafuFamilyName(
  name: any,
  location: any,
  { locationTokens = [] }: any = {},
): string {
  let normalized = normalizeText(name).replace(/\{[^}]+\}/gu, "{<LOC>}");
  const locationText = normalizeText(location);
  if (locationText) {
    normalized = normalized.replace(
      new RegExp(`(^|[^A-Za-z0-9])${escapeRegExp(locationText)}([^A-Za-z0-9]|$)`, "giu"),
      "$1<LOC>$2",
    );
  }
  const tokenRegex = knownLocationTokensRegex(locationTokens);
  if (tokenRegex) normalized = normalized.replace(tokenRegex, "$1<LOC>$2");
  normalized = normalized.replace(
    new RegExp(
      `\\b(production|imports?|exports?|from|to|market(?:\\s+for)?|supply(?:\\s+of)?)\\s+${contextualLocationPattern}\\b`,
      "giu",
    ),
    "$1 <LOC>",
  );
  return normalized.replace(/\s+/gu, " ").trim();
}

function flowShortDescription(
  referenceToFlowDataSet: any,
  location: any,
  locationTokens: any[],
): string {
  const shortDescription =
    textValue(referenceToFlowDataSet?.["common:shortDescription"]) ||
    textValue(referenceToFlowDataSet?.shortDescription);
  if (shortDescription)
    return normalizeBafuFamilyName(shortDescription, location, { locationTokens });
  return textValue(referenceToFlowDataSet?.["@refObjectId"]);
}

function exchangeRows(row: any): any[] {
  return ensureArray(row?.processDataSet?.exchanges?.exchange);
}

function exchangeSkeleton(exchange: any) {
  return {
    direction: textValue(exchange?.exchangeDirection),
    has_mean_amount: exchange?.meanAmount != null,
    has_resulting_amount: exchange?.resultingAmount != null,
    uncertainty_distribution_type: textValue(exchange?.uncertaintyDistributionType),
    data_derivation_type_status: textValue(exchange?.dataDerivationTypeStatus),
  };
}

function exchangeFlowTemplate(exchange: any, location: any, locationTokens: any[]) {
  const flowRef = exchange?.referenceToFlowDataSet ?? {};
  return {
    ...exchangeSkeleton(exchange),
    flow: flowShortDescription(flowRef, location, locationTokens),
  };
}

function exchangeAmount(exchange: any) {
  return {
    ...exchangeSkeleton(exchange),
    mean_amount: normalizeAmount(exchange?.meanAmount),
    resulting_amount: normalizeAmount(exchange?.resultingAmount),
  };
}

function groupBy(entries: any[], keyFn: (entry: any) => string | null): Map<string, any[]> {
  const groups = new Map<string, any[]>();
  for (const entry of entries) {
    const key = keyFn(entry);
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(entry);
  }
  return groups;
}

function stableEntrySort(left: any, right: any): number {
  if (left.scope_index !== right.scope_index) return left.scope_index - right.scope_index;
  return String(left.process_id).localeCompare(String(right.process_id));
}

function classifyEntries(entries: any[]): any[] {
  const amountGroups = groupBy(
    entries,
    (entry) => `${entry.family_hash}:${entry.exchange_amount_vector_hash}`,
  );
  const skeletonGroups = groupBy(
    entries,
    (entry) => `${entry.family_hash}:${entry.exchange_skeleton_hash}`,
  );
  for (const group of [...amountGroups.values(), ...skeletonGroups.values()]) {
    group.sort(stableEntrySort);
  }

  return entries.map((entry) => {
    const amountGroupKey = `${entry.family_hash}:${entry.exchange_amount_vector_hash}`;
    const skeletonGroupKey = `${entry.family_hash}:${entry.exchange_skeleton_hash}`;
    const amountGroup = amountGroups.get(amountGroupKey) ?? [];
    const skeletonGroup = skeletonGroups.get(skeletonGroupKey) ?? [];
    if (amountGroup.length > 1) {
      const master = amountGroup[0];
      const isMaster = master.process_id === entry.process_id;
      return {
        ...entry,
        family_group_key: amountGroupKey,
        optimization_kind: "same_amount_vector",
        optimization_role: isMaster ? "same_amount_master" : "same_amount_variant",
        master_process_id: master.process_id,
        family_group_size: amountGroup.length,
        skeleton_group_size: skeletonGroup.length,
        reuse_policy:
          "Generate from a reviewed master plus parameterized variants, while still running schema, QA, remote write, and readback verification per scope.",
      };
    }
    if (skeletonGroup.length > 1) {
      const master = skeletonGroup[0];
      const isMaster = master.process_id === entry.process_id;
      return {
        ...entry,
        family_group_key: skeletonGroupKey,
        optimization_kind: "same_skeleton",
        optimization_role: isMaster ? "same_skeleton_master" : "same_skeleton_variant",
        master_process_id: master.process_id,
        family_group_size: skeletonGroup.length,
        skeleton_group_size: skeletonGroup.length,
        reuse_policy:
          "Reuse authoring, curation, and identity decision templates; parameterize amount, location, and source-specific text per scope.",
      };
    }
    return {
      ...entry,
      family_group_key: entry.family_hash,
      optimization_kind: "standard",
      optimization_role: "standard",
      master_process_id: entry.process_id,
      family_group_size: 1,
      skeleton_group_size: 1,
      reuse_policy: "Run the ordinary process-scope import flow.",
    };
  });
}

function groupCount(entries: any[], predicate: (entry: any) => boolean, key: string): number {
  return new Set(entries.filter(predicate).map((entry) => entry[key])).size;
}

export function summarizeBafuFamilySignatures(entries: any[], missingEntries: any[] = []) {
  const sameAmountEntries = entries.filter(
    (entry) => entry.optimization_kind === "same_amount_vector",
  );
  const sameSkeletonEntries = entries.filter((entry) => entry.skeleton_group_size > 1);
  const sameSkeletonOnlyEntries = entries.filter(
    (entry) => entry.optimization_kind === "same_skeleton",
  );
  const standardEntries = entries.filter((entry) => entry.optimization_kind === "standard");
  const skeletonGroupKey = (entry: any) => `${entry.family_hash}:${entry.exchange_skeleton_hash}`;
  const skeletonGroupKeys = new Set(sameSkeletonEntries.map(skeletonGroupKey));
  return {
    schema_version: 1,
    scoped_processes: entries.length + missingEntries.length,
    usable_signatures: entries.length,
    missing_signatures: missingEntries.length,
    families: new Set(entries.map((entry) => entry.family_hash)).size,
    same_amount_vector_groups: groupCount(sameAmountEntries, () => true, "family_group_key"),
    same_amount_vector_scopes: sameAmountEntries.length,
    same_amount_vector_variant_scopes: sameAmountEntries.filter((entry) =>
      entry.optimization_role.endsWith("_variant"),
    ).length,
    same_skeleton_groups: skeletonGroupKeys.size,
    same_skeleton_scopes: sameSkeletonEntries.length,
    same_skeleton_variant_scopes: sameSkeletonEntries.length - skeletonGroupKeys.size,
    same_skeleton_only_groups: groupCount(sameSkeletonOnlyEntries, () => true, "family_group_key"),
    same_skeleton_only_scopes: sameSkeletonOnlyEntries.length,
    same_skeleton_only_variant_scopes: sameSkeletonOnlyEntries.filter((entry) =>
      entry.optimization_role.endsWith("_variant"),
    ).length,
    standard_scopes: standardEntries.length,
  };
}

function processLocationTokens(row: any): string[] {
  const name = processName(row);
  const location = processLocation(row);
  const exchangeTexts = exchangeRows(row).map((exchange) =>
    textValue(exchange?.referenceToFlowDataSet?.["common:shortDescription"]),
  );
  return [
    location,
    ...locationTokensFromText(name),
    ...exchangeTexts.flatMap(locationTokensFromText),
  ]
    .map(normalizeText)
    .filter(Boolean);
}

export function bafuFamilyEntryFromProcess(
  row: any,
  {
    filePath = null,
    processId = null,
    version = null,
    scopeIndex = 0,
    locationTokens = [],
  }: any = {},
) {
  const identity = processIdentity(row);
  const id = processId || identity.id;
  const processVersion = version || identity.version || "00.00.001";
  const location = processLocation(row);
  const name = processName(row);
  const familyName = normalizeBafuFamilyName(name, location, { locationTokens });
  const skeleton = exchangeRows(row).map((exchange) => exchangeSkeleton(exchange));
  const flowTemplate = exchangeRows(row).map((exchange) =>
    exchangeFlowTemplate(exchange, location, locationTokens),
  );
  const amountVector = exchangeRows(row).map((exchange) => exchangeAmount(exchange));
  return {
    schema_version: 1,
    process_id: id,
    process_version: processVersion,
    scope_index: scopeIndex,
    source_file: filePath,
    process_name: name,
    location,
    family_name: familyName,
    family_hash: hashJson(familyName),
    exchange_count: skeleton.length,
    exchange_skeleton_hash: hashJson(skeleton),
    exchange_flow_template_hash: hashJson(flowTemplate),
    exchange_amount_vector_hash: hashJson(amountVector),
  };
}

function processFileCandidates({
  processId,
  processBundlesDir = null,
  processesDir = null,
}: any): string[] {
  const candidates: string[] = [];
  if (processesDir) candidates.push(path.join(processesDir, `${processId}.json`));
  if (processBundlesDir) {
    candidates.push(
      path.join(processBundlesDir, processId, "tidas", "processes", `${processId}.json`),
    );
    candidates.push(path.join(processBundlesDir, processId, "processes", `${processId}.json`));
  }
  return candidates;
}

function firstExistingFile(candidates: Array<string | null | undefined>): string | null {
  return (
    candidates.find(
      (candidate) => candidate && fs.existsSync(candidate) && fs.statSync(candidate).isFile(),
    ) ?? null
  );
}

function scopeIdentity(scope: any) {
  return {
    id: textValue(scope?.process_id ?? scope?.id),
    version: textValue(scope?.process_version ?? scope?.version) || "00.00.001",
  };
}

export function bafuScopeKey(scope: any): string | null {
  const identity = scopeIdentity(scope);
  return identity.id ? `${identity.id}@${identity.version}` : null;
}

export function buildBafuFamilySignatureIndex({
  scopes,
  processBundlesDir = null,
  processesDir = null,
  readJson = (filePath: string) => JSON.parse(fs.readFileSync(filePath, "utf8")),
}: any = {}) {
  const entries: any[] = [];
  const missing: any[] = [];
  const loaded: any[] = [];
  for (const [scopeIndex, scope] of ensureArray(scopes).entries()) {
    const identity = scopeIdentity(scope);
    if (!identity.id) continue;
    const filePath = firstExistingFile(
      processFileCandidates({
        processId: identity.id,
        processBundlesDir,
        processesDir,
      }),
    );
    if (!filePath) {
      missing.push({
        schema_version: 1,
        process_id: identity.id,
        process_version: identity.version,
        reason: "bafu_process_json_missing",
      });
      continue;
    }
    loaded.push({
      row: readJson(filePath),
      filePath,
      identity,
      scopeIndex,
    });
  }
  const locationTokens = loaded.flatMap((entry) => processLocationTokens(entry.row));
  for (const entry of loaded) {
    entries.push(
      bafuFamilyEntryFromProcess(entry.row, {
        filePath: entry.filePath,
        processId: entry.identity.id,
        version: entry.identity.version,
        scopeIndex: entry.scopeIndex,
        locationTokens,
      }),
    );
  }
  const classifiedEntries = classifyEntries(entries);
  const byScopeKey = new Map(
    classifiedEntries.map((entry) => [`${entry.process_id}@${entry.process_version}`, entry]),
  );
  return {
    schema_version: 1,
    entries: classifiedEntries,
    missing,
    byScopeKey,
    summary: summarizeBafuFamilySignatures(classifiedEntries, missing),
  };
}

export function bafuFamilySignatureForScope(index: any, scope: any): any {
  const key = bafuScopeKey(scope);
  return key ? (index?.byScopeKey?.get(key) ?? null) : null;
}

export function compactBafuFamilySignature(
  entry: any,
  repoRelative: (value: any) => any = (value) => value,
) {
  if (!entry) return null;
  return {
    schema_version: 1,
    process_id: entry.process_id,
    process_version: entry.process_version,
    process_name: entry.process_name,
    location: entry.location,
    family_name: entry.family_name,
    family_hash: entry.family_hash,
    exchange_count: entry.exchange_count,
    exchange_skeleton_hash: entry.exchange_skeleton_hash,
    exchange_flow_template_hash: entry.exchange_flow_template_hash,
    exchange_amount_vector_hash: entry.exchange_amount_vector_hash,
    optimization_kind: entry.optimization_kind,
    optimization_role: entry.optimization_role,
    master_process_id: entry.master_process_id,
    family_group_size: entry.family_group_size,
    skeleton_group_size: entry.skeleton_group_size,
    reuse_policy: entry.reuse_policy,
    source_file: repoRelative(entry.source_file),
  };
}

export function bafuFamilyPlanFields(entry: any) {
  if (!entry) {
    return {
      bafu_family_optimization_kind: "unknown",
      bafu_family_optimization_role: "unknown",
      bafu_family_master_process_id: null,
      bafu_family_group_size: null,
    };
  }
  return {
    bafu_family_optimization_kind: entry.optimization_kind,
    bafu_family_optimization_role: entry.optimization_role,
    bafu_family_master_process_id: entry.master_process_id,
    bafu_family_group_size: entry.family_group_size,
    bafu_family_hash: entry.family_hash,
    bafu_family_skeleton_hash: entry.exchange_skeleton_hash,
    bafu_family_amount_vector_hash: entry.exchange_amount_vector_hash,
  };
}

export function bafuFamilySelectionRank(entry: any): number {
  switch (entry?.optimization_role) {
    case "same_amount_master":
      return 0;
    case "same_skeleton_master":
      return 1;
    case "standard":
      return 2;
    case "same_amount_variant":
      return 3;
    case "same_skeleton_variant":
      return 4;
    default:
      return 5;
  }
}

export function summarizeBafuFamilyScopes(scopes: any, index: any) {
  const entries = ensureArray(scopes)
    .map((scope) => bafuFamilySignatureForScope(index, scope))
    .filter(Boolean);
  const missing = ensureArray(scopes)
    .filter((scope) => !bafuFamilySignatureForScope(index, scope))
    .map((scope) => {
      const identity = scopeIdentity(scope);
      return {
        schema_version: 1,
        process_id: identity.id,
        process_version: identity.version,
        reason: "bafu_family_signature_not_available",
      };
    });
  return summarizeBafuFamilySignatures(entries, missing);
}

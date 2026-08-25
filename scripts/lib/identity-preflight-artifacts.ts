import fs from "node:fs";
import path from "node:path";
import { createFileArtifactFact, createFoundryCommandSpec } from "./foundry-command-spec.ts";
import type { FoundryCommandSpec } from "./foundry-command-spec.ts";

type UnknownRecord = Record<string, unknown>;

interface TextNode extends UnknownRecord {
  "#text"?: unknown;
}

interface NamedReference extends UnknownRecord {
  "common:shortDescription"?: unknown;
  shortDescription?: unknown;
  "@refObjectId"?: unknown;
}

interface FlowPropertyRecord extends UnknownRecord {
  referenceToFlowPropertyDataSet?: NamedReference;
}

interface ExchangeRecord extends UnknownRecord {
  "@dataSetInternalID"?: unknown;
  referenceToFlowDataSet?: NamedReference;
  exchangeDirection?: unknown;
  inputGroup?: unknown;
  outputGroup?: unknown;
  meanAmount?: unknown;
  resultingAmount?: unknown;
  amount?: unknown;
  meanValue?: unknown;
}

interface ProcessDataSetRecord extends UnknownRecord {
  processInformation?: {
    dataSetInformation?: UnknownRecord & {
      name?: {
        baseName?: TextNode;
        treatmentStandardsRoutes?: TextNode;
        mixAndLocationTypes?: TextNode;
        functionalUnitFlowProperties?: TextNode;
      };
    };
    quantitativeReference?: { referenceToReferenceFlow?: unknown };
    geography?: {
      locationOfOperationSupplyOrProduction?: {
        "@location"?: unknown;
        location?: unknown;
      };
    };
  };
  exchanges?: { exchange?: ExchangeRecord | ExchangeRecord[] };
}

interface FlowDataSetRecord extends UnknownRecord {
  flowInformation?: {
    dataSetInformation?: UnknownRecord & {
      classificationInformation?: {
        "common:elementaryFlowCategorization"?: {
          "common:category"?: unknown;
        };
      };
    };
  };
  flowProperties?: { flowProperty?: FlowPropertyRecord | FlowPropertyRecord[] };
}

interface DatasetPayload extends UnknownRecord {
  processDataSet?: ProcessDataSetRecord;
  flowDataSet?: FlowDataSetRecord;
}

interface SourceClassification extends UnknownRecord {
  category?: unknown;
  subCategory?: unknown;
  localCategory?: unknown;
  localSubCategory?: unknown;
}

interface AuthoringContext extends UnknownRecord {
  source_unit?: unknown;
  source_location?: unknown;
  source_name?: unknown;
  source_local_name?: unknown;
  technology?: unknown;
  included_processes?: unknown;
}

interface NameParts extends UnknownRecord {
  base_name?: unknown;
  treatment_standards_routes?: unknown;
  mix_and_location_types?: unknown;
  functional_unit_flow_properties?: unknown;
}

interface RemoteSearch extends UnknownRecord {
  query: string;
  data_source: string;
  limit: number;
  filter?: UnknownRecord | null;
}

interface EdgeSearchRequest extends UnknownRecord {
  endpoint: string;
  body: UnknownRecord;
}

interface IdentityIndexRemoteSearch extends UnknownRecord {
  data_source: string;
  limit: number;
  filter: UnknownRecord | null;
  query: string;
  edge_request: EdgeSearchRequest;
}

interface IdentityIndexRow extends UnknownRecord {
  request_file: string;
  command: string;
  command_spec: FoundryCommandSpec;
  remote_search: IdentityIndexRemoteSearch;
}

interface IdentityArtifactIndex {
  byIdentity: Map<string, IdentityIndexRow>;
}

interface IdentityQueueRow extends UnknownRecord {
  dataset_type?: unknown;
  dataset_id?: unknown;
  dataset_version?: unknown;
  identity_preflight_request_file?: string;
  identity_preflight_command?: string;
  remote_search?: UnknownRecord;
}

interface SourceIndexRow extends UnknownRecord {
  dataset_type?: unknown;
  type?: unknown;
  dataset_id?: unknown;
  entity_id?: unknown;
  id?: unknown;
  dataset_version?: unknown;
  version?: unknown;
  source_file?: unknown;
  sourceFile?: unknown;
}

interface SourceIndexOptions extends UnknownRecord {
  sourceIndex?: unknown;
  sourceIndexes?: unknown;
  sourceContextIndex?: unknown;
  sourceContextIndexes?: unknown;
}

interface IdentityPreflightArtifactDependencies {
  asText: (value: unknown) => string;
  bundleClassificationPath: (payload: DatasetPayload, type: string) => string;
  cleanEcoSpoldNameText: (value: unknown) => string;
  collectSourceTracePayloads: (value: unknown) => unknown[];
  datasetIdentity: (payload: DatasetPayload, type: string) => { id: string; version: string };
  ensureArray: <Value>(value: Value | Value[] | null | undefined) => Value[];
  fileExists: (filePath: string | null) => boolean;
  flowNameParts: (payload: DatasetPayload) => NameParts;
  flowTypeOfDataSet: (payload: DatasetPayload) => string;
  isConvertedDefaultClassification: (classificationPath: string) => boolean;
  jsonSha256: (value: unknown) => string;
  normalizedList: (value: unknown) => string[];
  processAuthoringContextFromTrace: (sourceTraces: unknown[]) => AuthoringContext;
  processSourceClassificationSummary: (sourceTraces: unknown[]) => SourceClassification;
  readJson: (filePath: string) => unknown;
  readJsonLines: (filePath: string) => SourceIndexRow[];
  repoRelativeMaybe: (filePath: unknown) => string | null;
  repoRelativePath: (filePath: string) => string;
  resolveRepoPath: (filePath: unknown) => string | null;
  safeFileToken: (value: unknown, fallback: string) => string;
  sha256Text: (value: unknown) => string;
  shellQuote: (value: string) => string;
  sourceTraceLocationCode: (sourceTraces: unknown[]) => unknown;
  textValue: (value: unknown) => string;
  writeJson: (filePath: string, value: unknown) => void;
  writeJsonLines: (filePath: string, rows: UnknownRecord[]) => void;
}

function isUnknownRecord(value: unknown): value is UnknownRecord {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function createIdentityPreflightArtifactUtils({
  asText,
  bundleClassificationPath,
  cleanEcoSpoldNameText,
  collectSourceTracePayloads,
  datasetIdentity,
  ensureArray,
  fileExists,
  flowNameParts,
  flowTypeOfDataSet,
  isConvertedDefaultClassification,
  jsonSha256,
  normalizedList,
  processAuthoringContextFromTrace,
  processSourceClassificationSummary,
  readJson,
  readJsonLines,
  repoRelativeMaybe,
  repoRelativePath,
  resolveRepoPath,
  safeFileToken,
  sha256Text,
  shellQuote,
  sourceTraceLocationCode,
  textValue,
  writeJson,
  writeJsonLines,
}: IdentityPreflightArtifactDependencies) {
  function normalizedLookupKey(key: unknown) {
    return String(key ?? "")
      .split(":")
      .pop()!
      .replace(/[^A-Za-z0-9]+/gu, "")
      .toLowerCase();
  }

  function collectValuesByNormalizedKey(
    value: unknown,
    wantedKeys: Set<string>,
    output: unknown[] = [],
  ) {
    if (!value || typeof value !== "object") return output;
    if (Array.isArray(value)) {
      for (const item of value) collectValuesByNormalizedKey(item, wantedKeys, output);
      return output;
    }
    for (const [key, child] of Object.entries(value)) {
      if (wantedKeys.has(normalizedLookupKey(key))) output.push(child);
      collectValuesByNormalizedKey(child, wantedKeys, output);
    }
    return output;
  }

  function collectTextsFromValue(value: unknown, output: string[] = []) {
    const direct = textValue(value);
    if (direct) {
      output.push(direct);
      return output;
    }
    if (Array.isArray(value)) {
      for (const item of value) collectTextsFromValue(item, output);
      return output;
    }
    if (value && typeof value === "object") {
      for (const [key, child] of Object.entries(value)) {
        if (key.startsWith("@")) continue;
        collectTextsFromValue(child, output);
      }
    }
    return output;
  }

  function isSearchNoiseText(value: unknown) {
    const text = asText(value).normalize("NFKC").replace(/\s+/gu, " ").trim();
    if (!text) return true;
    if (
      /^(?:<null>|not specified|not declared|not known|unspecified|n\/a|none|null)$/iu.test(text)
    ) {
      return true;
    }
    if (/^not specified by the .* source\.?$/iu.test(text)) return true;
    if (/^dataValidForEntirePeriod\s*=\s*true$/iu.test(text)) return true;
    if (/^ilcd format$/iu.test(text)) return true;
    if (/^ilcd data network\s*-\s*entry-level$/iu.test(text)) return true;
    return false;
  }

  function sanitizeSearchText(value: unknown) {
    return cleanEcoSpoldNameText(value)
      .replace(/\bGeography:\s*(?:Unspecified|Not specified|Not known)\b\.?/giu, "")
      .replace(/<null>/giu, "")
      .replace(/\bnot known\b/giu, "")
      .replace(/\s*\/\s*;?\s*$/u, "")
      .replace(/\s*;\s*$/u, "")
      .replace(/\s{2,}/gu, " ")
      .trim();
  }

  function normalizeSearchText(value: unknown) {
    return asText(value)
      .normalize("NFKC")
      .toLowerCase()
      .replace(/[^\p{Letter}\p{Number}]+/gu, " ")
      .replace(/\s+/gu, " ")
      .trim();
  }

  function uniqueSearchTexts(values: unknown[], limit = 6) {
    const byKey = new Map<string, string>();
    for (const value of values.flat()) {
      for (const text of collectTextsFromValue(value)) {
        const cleaned = sanitizeSearchText(text);
        if (isSearchNoiseText(cleaned)) continue;
        const normalized = normalizeSearchText(cleaned);
        if (normalized && !byKey.has(normalized)) byKey.set(normalized, cleaned);
      }
    }
    return [...byKey.values()].slice(0, limit);
  }

  function truncateSearchText(value: unknown, maxChars = 240) {
    const text = asText(value).replace(/\s+/gu, " ").trim();
    if (!text || text.length <= maxChars) return text;
    return `${text.slice(0, Math.max(0, maxChars - 1)).trim()}…`;
  }

  function appendSearchBriefLine(
    lines: string[],
    label: string,
    values: unknown,
    limit = 6,
    maxChars = 240,
  ) {
    const texts = uniqueSearchTexts(ensureArray(values), limit).map((text) =>
      truncateSearchText(text, maxChars),
    );
    if (texts.length > 0) lines.push(`${label}: ${texts.join("; ")}`);
  }

  function bundleClassificationPathForSearch(payload: DatasetPayload, type: string) {
    const classificationPath = bundleClassificationPath(payload, type);
    return isConvertedDefaultClassification(classificationPath) ? "" : classificationPath;
  }

  function sourceClassificationTextsForSearch(sourceClassification: SourceClassification) {
    return [
      sourceClassification.category,
      sourceClassification.subCategory,
      sourceClassification.localCategory,
      sourceClassification.localSubCategory,
    ];
  }

  function processNameParts(payload: DatasetPayload) {
    const name = payload?.processDataSet?.processInformation?.dataSetInformation?.name ?? {};
    return {
      base_name: asText(name.baseName?.["#text"] ?? name.baseName),
      treatment_standards_routes: asText(
        name.treatmentStandardsRoutes?.["#text"] ?? name.treatmentStandardsRoutes,
      ),
      mix_and_location_types: asText(
        name.mixAndLocationTypes?.["#text"] ?? name.mixAndLocationTypes,
      ),
      functional_unit_flow_properties: asText(
        name.functionalUnitFlowProperties?.["#text"] ?? name.functionalUnitFlowProperties,
      ),
    };
  }

  function valuesByKeys(payload: DatasetPayload, keys: string[], limit = 6) {
    const wanted = new Set(keys.map(normalizedLookupKey));
    return uniqueSearchTexts(collectValuesByNormalizedKey(payload, wanted), limit);
  }

  function isLikelyLocationCodeText(value: unknown) {
    const text = asText(value).trim();
    if (!text || /\s/u.test(text) || text.length > 24) return false;
    return /^[A-Za-z]{2,5}(?:-[A-Za-z0-9]{1,8})*$/u.test(text);
  }

  function locationCodeSearchTexts(values: unknown[], limit = 4) {
    return uniqueSearchTexts(values, limit).filter(isLikelyLocationCodeText);
  }

  function processGeographySearchTexts(payload: DatasetPayload, sourceTraces: unknown[] = []) {
    const location =
      payload?.processDataSet?.processInformation?.geography?.locationOfOperationSupplyOrProduction;
    return locationCodeSearchTexts([
      location?.["@location"],
      location?.location,
      sourceTraceLocationCode(sourceTraces),
    ]);
  }

  function elementaryFlowCategoryPath(payload: DatasetPayload) {
    const categories =
      payload?.flowDataSet?.flowInformation?.dataSetInformation?.classificationInformation?.[
        "common:elementaryFlowCategorization"
      ]?.["common:category"];
    return ensureArray(categories)
      .map((entry) => textValue(entry))
      .filter(Boolean)
      .join(" > ");
  }

  function elementaryFlowCategoryPathForSearch(
    payload: DatasetPayload,
    sourceClassification: SourceClassification,
  ) {
    const categoryPath = elementaryFlowCategoryPath(payload);
    if (!categoryPath) return "";
    const sourceText = sourceClassificationTextsForSearch(sourceClassification)
      .join(" ")
      .toLowerCase();
    if (
      sourceText &&
      /(?:resources?|land)/iu.test(sourceText) &&
      /emissions?\s*>\s*emissions?\s+to\s+air/iu.test(categoryPath)
    ) {
      return "";
    }
    return categoryPath;
  }

  function elementaryFlowCompartmentAliasesForSearch(
    payload: DatasetPayload,
    sourceClassification: SourceClassification,
  ) {
    const categoryText = uniqueSearchTexts(
      [
        elementaryFlowCategoryPath(payload),
        ...sourceClassificationTextsForSearch(sourceClassification),
      ],
      12,
    )
      .join(" ")
      .toLowerCase();
    if (!categoryText) return [];
    const aliases: string[] = [];
    const isAir = /emissions?\s+to\s+air|air emissions?/iu.test(categoryText);
    if (
      isAir &&
      (/\blow\.?\s*pop\.?\b/iu.test(categoryText) ||
        /low\s+population/iu.test(categoryText) ||
        /non[-\s]?urban/iu.test(categoryText) ||
        /high\s+stacks?/iu.test(categoryText))
    ) {
      aliases.push(
        "Emissions to non-urban air or from high stacks",
        "non-urban air or from high stacks",
        "low population air emissions",
      );
    }
    if (
      isAir &&
      (/\bhigh\.?\s*pop\.?\b/iu.test(categoryText) ||
        /high\s+population/iu.test(categoryText) ||
        /urban\s+air\s+close\s+to\s+ground/iu.test(categoryText))
    ) {
      aliases.push(
        "Emissions to urban air close to ground",
        "urban air close to ground",
        "high population air emissions",
      );
    }
    if (isAir && /unspecified/iu.test(categoryText)) {
      aliases.push("Emissions to air, unspecified");
    }
    if (/fresh\s+water/iu.test(categoryText)) {
      aliases.push("Emissions to fresh water");
    }
    if (/sea\s+water|ocean/iu.test(categoryText)) {
      aliases.push("Emissions to sea water");
    }
    if (/water/iu.test(categoryText) && /unspecified/iu.test(categoryText)) {
      aliases.push("Emissions to water, unspecified");
    }
    if (/non[-\s]?agricultural\s+soil/iu.test(categoryText)) {
      aliases.push("Emissions to non-agricultural soil");
    } else if (/agricultural\s+soil/iu.test(categoryText)) {
      aliases.push("Emissions to agricultural soil");
    } else if (/soil/iu.test(categoryText) && /unspecified/iu.test(categoryText)) {
      aliases.push("Emissions to soil, unspecified");
    }
    return uniqueSearchTexts(aliases, 8);
  }

  function flowReferencePropertyTexts(payload: DatasetPayload) {
    const flowProperties = ensureArray(payload?.flowDataSet?.flowProperties?.flowProperty);
    return uniqueSearchTexts(
      flowProperties.map(
        (property) =>
          property?.referenceToFlowPropertyDataSet?.["common:shortDescription"] ??
          property?.referenceToFlowPropertyDataSet,
      ),
      4,
    );
  }

  function referenceDescriptionTexts(
    payload: DatasetPayload,
    keyNames: string[],
    limit = 8,
    { includeIds = true }: { includeIds?: boolean } = {},
  ) {
    const wanted = new Set(keyNames.map(normalizedLookupKey));
    return uniqueSearchTexts(
      collectValuesByNormalizedKey(payload, wanted).map((reference) => {
        if (isUnknownRecord(reference)) {
          const descriptions = [reference["common:shortDescription"], reference.shortDescription];
          const descriptionTexts = uniqueSearchTexts(descriptions, 4);
          if (descriptionTexts.length > 0 || !includeIds) {
            return descriptionTexts;
          }
          return reference["@refObjectId"];
        }
        return reference;
      }),
      limit,
    );
  }

  function processReferenceFlowSearchTexts(payload: DatasetPayload, limit = 4) {
    const processDataSet = payload?.processDataSet ?? {};
    const referenceInternalIds = uniqueSearchTexts(
      ensureArray(
        processDataSet?.processInformation?.quantitativeReference?.referenceToReferenceFlow,
      ),
      4,
    );
    const internalIdSet = new Set(referenceInternalIds.map((id) => normalizeSearchText(id)));
    const exchanges = ensureArray(processDataSet?.exchanges?.exchange).filter(
      (exchange) => exchange && typeof exchange === "object",
    );
    const referenceExchanges =
      internalIdSet.size > 0
        ? exchanges.filter((exchange) =>
            internalIdSet.has(normalizeSearchText(exchange?.["@dataSetInternalID"])),
          )
        : [];
    const selected = referenceExchanges.length > 0 ? referenceExchanges : exchanges.slice(0, 1);
    return uniqueSearchTexts(
      selected.flatMap((exchange) => {
        const reference = exchange?.referenceToFlowDataSet ?? {};
        const descriptions = [reference?.["common:shortDescription"], reference?.shortDescription];
        const descriptionTexts = uniqueSearchTexts(descriptions, limit);
        return descriptionTexts.length > 0 ? descriptionTexts : [reference?.["@refObjectId"]];
      }),
      limit,
    );
  }

  function processExchangeSearchSignature(payload: DatasetPayload, limit = 12) {
    const exchanges = ensureArray(payload?.processDataSet?.exchanges?.exchange);
    return uniqueSearchTexts(
      exchanges.map((exchange) => {
        const reference = exchange?.referenceToFlowDataSet ?? {};
        const referenceText =
          textValue(reference?.["common:shortDescription"]) ||
          textValue(reference?.shortDescription) ||
          textValue(reference?.["@refObjectId"]) ||
          textValue(reference);
        const direction = textValue(
          exchange?.exchangeDirection ?? exchange?.inputGroup ?? exchange?.outputGroup,
        );
        const amount = textValue(
          exchange?.meanAmount ??
            exchange?.resultingAmount ??
            exchange?.amount ??
            exchange?.meanValue,
        );
        return [direction, referenceText, amount].filter(Boolean).join(" ");
      }),
      limit,
    );
  }

  function compactSearchBrief(lines: string[]) {
    return lines
      .map((line) => line.replace(/\s+/gu, " ").trim())
      .filter(Boolean)
      .join("\n")
      .slice(0, 1800)
      .trim();
  }

  function identityPreflightHybridSearchOptions() {
    return {
      match_threshold: 0.15,
      lexical_weight: 0.8,
      semantic_weight: 0.2,
      rrf_k: 30,
    };
  }

  function flowHybridSearchBrief(payload: DatasetPayload, sourceTraces: unknown[] = []) {
    const authoringContext = processAuthoringContextFromTrace(sourceTraces);
    const sourceClassification = processSourceClassificationSummary(sourceTraces);
    const nameParts = flowNameParts(payload);
    const lines: string[] = [];
    appendSearchBriefLine(
      lines,
      "flow name",
      [
        nameParts.base_name,
        nameParts.treatment_standards_routes,
        nameParts.mix_and_location_types,
        nameParts.functional_unit_flow_properties,
      ],
      4,
      180,
    );
    appendSearchBriefLine(lines, "flow type", flowTypeOfDataSet(payload), 1);
    appendSearchBriefLine(lines, "CAS", valuesByKeys(payload, ["CASNumber", "cas"]));
    appendSearchBriefLine(lines, "reference property", flowReferencePropertyTexts(payload));
    appendSearchBriefLine(lines, "reference unit", authoringContext.source_unit, 1);
    appendSearchBriefLine(lines, "category or compartment", [
      bundleClassificationPathForSearch(payload, "flow"),
      elementaryFlowCategoryPathForSearch(payload, sourceClassification),
      ...sourceClassificationTextsForSearch(sourceClassification),
    ]);
    appendSearchBriefLine(
      lines,
      "compartment aliases",
      elementaryFlowCompartmentAliasesForSearch(payload, sourceClassification),
    );
    appendSearchBriefLine(
      lines,
      "target classification candidate",
      bundleClassificationPathForSearch(payload, "flow"),
    );
    appendSearchBriefLine(
      lines,
      "source classification or compartment",
      sourceClassificationTextsForSearch(sourceClassification),
    );
    appendSearchBriefLine(lines, "geography or market", [
      ...valuesByKeys(payload, ["geography", "location", "market", "mixAndLocationTypes"]),
      authoringContext.source_location,
    ]);
    appendSearchBriefLine(lines, "source location", authoringContext.source_location);
    return compactSearchBrief(lines);
  }

  function processHybridSearchBrief(payload: DatasetPayload, sourceTraces: unknown[] = []) {
    const authoringContext = processAuthoringContextFromTrace(sourceTraces);
    const nameParts = processNameParts(payload);
    const lines: string[] = [];
    appendSearchBriefLine(
      lines,
      "process name",
      [
        nameParts.base_name,
        nameParts.treatment_standards_routes,
        nameParts.mix_and_location_types,
        nameParts.functional_unit_flow_properties,
        authoringContext.source_name,
        authoringContext.source_local_name,
      ],
      4,
      220,
    );
    appendSearchBriefLine(lines, "reference flow", processReferenceFlowSearchTexts(payload, 4));
    appendSearchBriefLine(
      lines,
      "quantitative reference",
      valuesByKeys(payload, ["functionalUnitOrOther"]),
    );
    appendSearchBriefLine(lines, "geography", processGeographySearchTexts(payload, sourceTraces));
    appendSearchBriefLine(
      lines,
      "time",
      valuesByKeys(payload, ["time", "referenceYear", "timePeriod"]),
    );
    appendSearchBriefLine(lines, "classification or sector", [
      bundleClassificationPathForSearch(payload, "process"),
      ...sourceClassificationTextsForSearch(processSourceClassificationSummary(sourceTraces)),
    ]);
    appendSearchBriefLine(
      lines,
      "target classification candidate",
      bundleClassificationPathForSearch(payload, "process"),
    );
    appendSearchBriefLine(
      lines,
      "source classification or sector",
      sourceClassificationTextsForSearch(processSourceClassificationSummary(sourceTraces)),
    );
    appendSearchBriefLine(
      lines,
      "technology route",
      [
        ...valuesByKeys(payload, [
          "technologyDescriptionAndIncludedProcesses",
          "treatmentStandardsRoutes",
        ]),
        authoringContext.technology,
      ],
      2,
      320,
    );
    appendSearchBriefLine(lines, "system boundary", [authoringContext.included_processes], 2, 220);
    appendSearchBriefLine(
      lines,
      "exchange flow refs",
      referenceDescriptionTexts(payload, ["referenceToFlowDataSet"], 6, {
        includeIds: false,
      }),
      6,
      160,
    );
    appendSearchBriefLine(
      lines,
      "exchange signature",
      processExchangeSearchSignature(payload, 6),
      6,
      160,
    );
    return compactSearchBrief(lines);
  }

  function identityPreflightRemoteSearchRequest(
    type: string,
    payload: DatasetPayload,
    sourceTraces: unknown[] = [],
  ): RemoteSearch {
    const query =
      type === "process"
        ? processHybridSearchBrief(payload, sourceTraces)
        : flowHybridSearchBrief(payload, sourceTraces);
    const isElementaryFlow =
      type === "flow" && /^elementary flow$/iu.test(flowTypeOfDataSet(payload));
    const filter =
      type === "flow" && flowTypeOfDataSet(payload)
        ? { flowType: flowTypeOfDataSet(payload) }
        : null;
    const profileHints = identityPreflightProfileHints(type, payload, sourceTraces);
    return {
      enabled: true,
      query,
      ...(Object.keys(profileHints).length > 0 ? { profile_hints: profileHints } : {}),
      data_source: "tg",
      limit: isElementaryFlow ? 80 : 20,
      ...identityPreflightHybridSearchOptions(),
      ...(filter ? { filter } : {}),
    };
  }

  function edgeSearchRequestPreview(type: string, remoteSearch: RemoteSearch) {
    return {
      endpoint: type === "process" ? "process_hybrid_search" : "flow_hybrid_search",
      body: {
        query: remoteSearch.query,
        ...(remoteSearch.filter ? { filter: remoteSearch.filter } : {}),
        match_count: remoteSearch.limit,
        page_size: remoteSearch.limit,
        data_source: remoteSearch.data_source,
        ...identityPreflightHybridSearchOptions(),
      },
    };
  }

  function identityPreflightProfileHints(
    type: string,
    payload: DatasetPayload,
    sourceTraces: unknown[] = [],
  ) {
    const authoringContext = processAuthoringContextFromTrace(sourceTraces);
    const sourceClassification = processSourceClassificationSummary(sourceTraces);
    if (type === "flow") {
      const sourceCategories = uniqueSearchTexts(
        sourceClassificationTextsForSearch(sourceClassification),
        8,
      );
      const hints = {
        type_of_dataset: flowTypeOfDataSet(payload),
        flow_property: flowReferencePropertyTexts(payload),
        reference_unit: authoringContext.source_unit,
        categories: sourceCategories,
        geography: authoringContext.source_location,
      };
      return Object.fromEntries(
        Object.entries(hints).filter(([, value]) =>
          Array.isArray(value) ? value.length > 0 : Boolean(asText(value)),
        ),
      );
    }

    const hints = {
      reference_flow_names: processReferenceFlowSearchTexts(payload, 4),
      quantitative_reference: valuesByKeys(payload, ["functionalUnitOrOther"], 2),
      geography: authoringContext.source_location,
      technology_route: authoringContext.technology,
      system_boundary: authoringContext.included_processes,
      categories: uniqueSearchTexts(sourceClassificationTextsForSearch(sourceClassification), 8),
    };
    return Object.fromEntries(
      Object.entries(hints).filter(([, value]) =>
        Array.isArray(value) ? value.length > 0 : Boolean(asText(value)),
      ),
    );
  }

  function readSourceTracesFromFile(sourceFile: string | null | undefined) {
    if (!sourceFile || !fileExists(sourceFile)) return [];
    return collectSourceTracePayloads(readJson(sourceFile));
  }

  function buildIdentityPreflightArtifacts({
    rowsByType,
    sourceByType,
    outDir,
    cliBin,
  }: {
    rowsByType: Record<"flow" | "process", Map<string, DatasetPayload>>;
    sourceByType: Record<"flow" | "process", Map<string, string | null | undefined>>;
    outDir: string;
    cliBin: string | string[];
  }) {
    const cliPrefix = Array.isArray(cliBin) ? cliBin : [cliBin];
    const requestsRoot = path.join(outDir, "identity-preflight-requests");
    const indexRows: IdentityIndexRow[] = [];
    const byIdentity = new Map<string, IdentityIndexRow>();
    for (const type of ["flow", "process"] as const) {
      const plural = type === "flow" ? "flows" : "processes";
      const requestDir = path.join(requestsRoot, plural);
      for (const [key, payload] of rowsByType[type].entries()) {
        const identity = datasetIdentity(payload, type);
        if (!identity.id || !identity.version) continue;
        const sourceFile = sourceByType[type].get(key);
        const sourceTraces = readSourceTracesFromFile(sourceFile);
        const remoteSearch = identityPreflightRemoteSearchRequest(type, payload, sourceTraces);
        const request = {
          schema_version: 1,
          target: payload,
          remote_candidate_search: remoteSearch,
        };
        const requestPath = path.join(requestDir, `${safeFileToken(identity.id, "missing")}.json`);
        writeJson(requestPath, request);
        const outputDir = path.join(
          outDir,
          "identity-preflight",
          plural,
          safeFileToken(identity.id, "missing"),
        );
        const expectedReportFile = path.join(outputDir, "outputs", "identity-decision.json");
        const expectedCandidatesFile = path.join(outputDir, "outputs", "identity-candidates.jsonl");
        const expectedCandidateSourcesFile = path.join(
          outputDir,
          "outputs",
          "identity-candidate-sources.json",
        );
        const commandTokens = [
          ...cliPrefix,
          type,
          "identity-preflight",
          "--input",
          requestPath,
          "--out-dir",
          outputDir,
          "--json",
        ];
        const command = commandTokens.map(shellQuote).join(" ");
        const requestText = fs.readFileSync(requestPath, "utf8");
        const indexRow = {
          dataset_type: type,
          dataset_id: identity.id,
          dataset_version: identity.version,
          target_sha256: jsonSha256(payload),
          request_bytes_sha256: sha256Text(requestText),
          request_json_sha256: jsonSha256(request),
          source_file: repoRelativeMaybe(sourceFile),
          request_file: repoRelativePath(requestPath),
          output_dir: repoRelativePath(outputDir),
          expected_report_file: repoRelativePath(expectedReportFile),
          expected_candidates_file: repoRelativePath(expectedCandidatesFile),
          expected_candidate_sources_file: repoRelativePath(expectedCandidateSourcesFile),
          command,
          command_spec: createFoundryCommandSpec({
            executable: commandTokens[0],
            argv: commandTokens.slice(1),
            binding: {
              artifacts: [
                createFileArtifactFact({
                  role: "identity_preflight_request",
                  path: repoRelativePath(requestPath),
                  filePath: requestPath,
                }),
              ],
            },
          }),
          remote_search: {
            data_source: remoteSearch.data_source,
            limit: remoteSearch.limit,
            filter: remoteSearch.filter ?? null,
            query: remoteSearch.query,
            edge_request: edgeSearchRequestPreview(type, remoteSearch),
          },
        };
        indexRows.push(indexRow);
        byIdentity.set(`${type}:${identity.id}:${identity.version}`, indexRow);
      }
    }
    const indexPath = path.join(requestsRoot, "identity-preflight-requests.jsonl");
    writeJsonLines(indexPath, indexRows);
    return {
      root: requestsRoot,
      indexPath,
      rows: indexRows,
      byIdentity,
    };
  }

  function identityPreflightSourceIndexPaths(options: SourceIndexOptions) {
    return normalizedList(
      options.sourceIndex ||
        options.sourceIndexes ||
        options.sourceContextIndex ||
        options.sourceContextIndexes,
    ).map(resolveRepoPath);
  }

  function identityPreflightSourceIndexKey(row: SourceIndexRow) {
    return [
      asText(row?.dataset_type || row?.type),
      asText(row?.dataset_id || row?.entity_id || row?.id),
      asText(row?.dataset_version || row?.version) || "00.00.001",
    ].join(":");
  }

  function loadIdentityPreflightSourceFileMap(indexPaths: Array<string | null>) {
    const sourceFilesByIdentity = new Map<string, string>();
    const blockers: UnknownRecord[] = [];
    let rowCount = 0;
    for (const indexPath of indexPaths) {
      if (!indexPath || !fileExists(indexPath)) {
        blockers.push({
          code: "identity_preflight_source_index_missing",
          message: "--source-index must point to a readable identity-preflight index.",
          source_index: repoRelativeMaybe(indexPath),
        });
        continue;
      }
      for (const row of readJsonLines(indexPath)) {
        rowCount += 1;
        const key = identityPreflightSourceIndexKey(row);
        if (!key.startsWith("flow:") && !key.startsWith("process:")) continue;
        const sourceFile = asText(row.source_file || row.sourceFile);
        if (!sourceFile) continue;
        const resolvedSourceFile = resolveRepoPath(sourceFile);
        if (!fileExists(resolvedSourceFile)) {
          blockers.push({
            code: "identity_preflight_source_context_file_missing",
            message: "A matching source-index row points to a source_file that no longer exists.",
            source_index: repoRelativePath(indexPath),
            source_file: repoRelativeMaybe(resolvedSourceFile),
            dataset_key: key,
          });
          continue;
        }
        if (!sourceFilesByIdentity.has(key)) {
          sourceFilesByIdentity.set(key, resolvedSourceFile as string);
        }
      }
    }
    return {
      sourceFilesByIdentity,
      rowCount,
      blockers,
    };
  }

  function attachIdentityPreflightRows(
    queueRows: IdentityQueueRow[],
    identityArtifacts: IdentityArtifactIndex,
  ) {
    for (const row of queueRows) {
      const match = identityArtifacts.byIdentity.get(
        `${row.dataset_type}:${row.dataset_id}:${row.dataset_version}`,
      );
      if (!match) continue;
      row.identity_preflight_request_file = match.request_file;
      row.identity_preflight_command = match.command;
      row.remote_search = match.remote_search;
    }
  }

  return {
    attachIdentityPreflightRows,
    buildIdentityPreflightArtifacts,
    identityPreflightSourceIndexPaths,
    isLikelyLocationCodeText,
    loadIdentityPreflightSourceFileMap,
  };
}

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

type JsonRecord = Record<string, unknown>;

function isJsonRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asJsonRecord(value: unknown): JsonRecord {
  return isJsonRecord(value) ? value : {};
}

function nestedValue(value: unknown, ...keys: string[]): unknown {
  let current = value;
  for (const key of keys) {
    if (!isJsonRecord(current)) return undefined;
    current = current[key];
  }
  return current;
}

type DatasetIdentity = {
  id: string | null;
  version: string | null;
};

type MutableStats = Record<string, number>;

type SourceReferenceSnapshot = {
  ref_object_id: string | null;
  version: string | null;
  short_description: string | null;
};

type BundleSampleDependencies = {
  asText: (value: unknown) => string;
  bundleClassificationPath: (payload: JsonRecord, type: string) => unknown;
  canonicalSourceReferenceForRelation: (relation: string) => JsonRecord | null;
  cloneJson: <T>(value: T) => T;
  contactGlobalReference: (options: JsonRecord) => JsonRecord;
  datasetIdentity: (payload: JsonRecord | null, type: string) => DatasetIdentity;
  deterministicUuid: (seed: string) => string;
  directoryExists: (directory: string) => boolean;
  ensureArray: (value: unknown) => unknown[];
  fileExists: (filePath: string) => boolean;
  flowClassificationSchemaType: (payload: JsonRecord) => string;
  flowTypeOfDataSet: (payload: JsonRecord) => string;
  isConvertedDefaultClassification: (classification: unknown) => boolean;
  isObjectEmpty: (value: unknown) => boolean;
  jsonSha256: (value: unknown) => string;
  languageForText: (value: unknown) => string;
  multiLang: (text: string, language?: string) => JsonRecord;
  normalizeUtcDateTimeString: (value: unknown) => string | null;
  normalizedList: (value: unknown) => string[];
  nowIso: () => string;
  pathExpression: (parts: Array<string | number>) => string;
  readJson: (filePath: string) => JsonRecord;
  repoRelativeMaybe: (filePath: string | null) => string | null;
  repoRelativePath: (filePath: string) => string;
  resolveRepoPath: (filePath: unknown) => string | null;
  sanitizePlaceholderText: (
    text: string,
    pathSegments: Array<string | number>,
    stats: MutableStats,
  ) => string;
  sourceReferenceSnapshot: (reference: JsonRecord) => SourceReferenceSnapshot;
  textValue: (value: unknown) => string;
};

type QualityFindingOptions = {
  payload: JsonRecord;
  type: string;
  sourceFile: string;
  sourceTraces: JsonRecord[];
  blockers: JsonRecord[];
  stats: MutableStats;
  classificationQueueRows: JsonRecord[];
  classificationCommandsByType: Record<string, unknown>;
};

type ElementaryReuseOptions = {
  payload: JsonRecord;
  type: string;
  sourceFile: string;
  sourceTraces: JsonRecord[];
  blockers: JsonRecord[];
  stats: MutableStats;
  elementaryFlowReuseRows: JsonRecord[];
  allowAccountLocalSupportAndElementary?: boolean;
};

type SanitizeContext = {
  type: string;
  identity: DatasetIdentity;
  sourceFile: string;
};

type RewriteContext = {
  rewriteRows?: JsonRecord[];
  stats?: MutableStats;
};

type BundleSelection = {
  seed: string | null;
  selected: string[];
  missing_process_ids: string[];
};

export function createBundleSampleUtils({
  asText,
  bundleClassificationPath,
  canonicalSourceReferenceForRelation,
  cloneJson,
  contactGlobalReference,
  datasetIdentity,
  deterministicUuid,
  directoryExists,
  ensureArray: _ensureArray,
  fileExists,
  flowClassificationSchemaType,
  flowTypeOfDataSet,
  isConvertedDefaultClassification,
  isObjectEmpty,
  jsonSha256,
  languageForText: _languageForText,
  multiLang,
  normalizeUtcDateTimeString,
  normalizedList,
  nowIso,
  pathExpression,
  readJson,
  repoRelativeMaybe,
  repoRelativePath: _repoRelativePath,
  resolveRepoPath,
  sanitizePlaceholderText,
  sourceReferenceSnapshot,
  textValue: _textValue,
}: BundleSampleDependencies) {
  function isLikelyLocationCodeText(value: unknown): boolean {
    const text = asText(value).trim();
    if (!text || /\s/u.test(text) || text.length > 24) return false;
    return /^[A-Za-z]{2,5}(?:-[A-Za-z0-9]{1,8})*$/u.test(text);
  }

  function collectBundleQualityFindings({
    payload,
    type,
    sourceFile,
    sourceTraces,
    blockers,
    stats,
    classificationQueueRows,
    classificationCommandsByType,
  }: QualityFindingOptions): void {
    if (type !== "process" && type !== "flow") return;
    if (type === "flow" && flowClassificationSchemaType(payload) !== "flow-product") return;
    const identity = datasetIdentity(payload, type);
    const currentClassification = bundleClassificationPath(payload, type);
    if (!isConvertedDefaultClassification(currentClassification)) return;

    if (type === "process") {
      stats.default_process_classification_blockers += 1;
    } else {
      stats.default_flow_classification_blockers += 1;
    }
    const schemaType = type === "flow" ? flowClassificationSchemaType(payload) : "process";
    const code = `${type}_classification_requires_authoring`;
    const sourceClassification = processSourceClassificationSummary(sourceTraces);
    const authoringContext = processAuthoringContextFromTrace(sourceTraces);
    const queueRow = {
      dataset_type: type,
      dataset_id: identity.id,
      dataset_version: identity.version,
      source_file: repoRelativeMaybe(sourceFile),
      code,
      current_classification: currentClassification,
      source_classification: sourceClassification,
      authoring_context: authoringContext,
      classification_workflow: {
        schema_type: schemaType,
        row_type: type,
        commands: classificationCommandsByType[schemaType],
        decision_contract: {
          required_selector: "row_index or dataset_id",
          required_classification: "code, leaf_code, class_id, cat_id, or classes[]",
          optional_fields: ["basis", "evidence"],
        },
      },
      required_resolution:
        "Use the Foundry AI authoring/classification gate with full TIDAS schema/YAML/context to replace the converted default classification before remote write.",
    };
    classificationQueueRows.push(queueRow);
    blockers.push({
      code,
      message: `${type} classification is the converter default path and must be resolved by AI/classification authoring before commit.`,
      dataset_type: type,
      dataset_id: identity.id,
      dataset_version: identity.version,
      source_file: repoRelativeMaybe(sourceFile),
      current_classification: currentClassification,
      source_classification: sourceClassification,
      schema_type: schemaType,
      queue: "classification-authoring-queue.jsonl",
    });
  }

  function flowNameParts(payload: JsonRecord | null) {
    const name = asJsonRecord(
      nestedValue(payload, "flowDataSet", "flowInformation", "dataSetInformation", "name"),
    );
    const baseName = asJsonRecord(name.baseName);
    const treatmentStandardsRoutes = asJsonRecord(name.treatmentStandardsRoutes);
    const mixAndLocationTypes = asJsonRecord(name.mixAndLocationTypes);
    const functionalUnitFlowProperties = asJsonRecord(name.functionalUnitFlowProperties);
    return {
      base_name: asText(baseName["#text"] ?? name.baseName),
      treatment_standards_routes: asText(
        treatmentStandardsRoutes["#text"] ?? name.treatmentStandardsRoutes,
      ),
      mix_and_location_types: asText(mixAndLocationTypes["#text"] ?? name.mixAndLocationTypes),
      functional_unit_flow_properties: asText(
        functionalUnitFlowProperties["#text"] ?? name.functionalUnitFlowProperties,
      ),
    };
  }

  function collectElementaryFlowReuseFindings({
    payload,
    type,
    sourceFile,
    sourceTraces,
    blockers,
    stats,
    elementaryFlowReuseRows,
    allowAccountLocalSupportAndElementary = false,
  }: ElementaryReuseOptions): void {
    if (type !== "flow") return;
    // Override: BAFU profile may mint account-local (My Data, state_code=0) elementary
    // flows; do not require reuse-from-existing or block the bundle.
    if (allowAccountLocalSupportAndElementary) return;
    if (flowClassificationSchemaType(payload) !== "flow-elementary") return;
    const identity = datasetIdentity(payload, type);
    const sourceClassification = processSourceClassificationSummary(sourceTraces);
    const authoringContext = processAuthoringContextFromTrace(sourceTraces);
    stats.elementary_flow_reuse_blockers += 1;
    elementaryFlowReuseRows.push({
      dataset_type: "flow",
      dataset_id: identity.id,
      dataset_version: identity.version,
      source_file: repoRelativeMaybe(sourceFile),
      code: "elementary_flow_requires_existing_database_match",
      flow_type: flowTypeOfDataSet(payload),
      source_name_fields: flowNameParts(payload),
      source_classification: sourceClassification,
      authoring_context: authoringContext,
      required_resolution:
        "Search the existing TianGong elementary flow library by UUID/version, CAS/name/category/synonyms, and structured semantic candidates. Rewrite process exchanges to the selected existing flow. If no defensible match exists, keep this as an unresolved mapping blocker; do not write a BAFU-owned elementary flow.",
    });
    blockers.push({
      code: "elementary_flow_requires_existing_database_match",
      message:
        "Elementary flow must be selected from existing TianGong database flows before commit; Foundry must not publish BAFU-owned elementary flows.",
      dataset_type: type,
      dataset_id: identity.id,
      dataset_version: identity.version,
      source_file: repoRelativeMaybe(sourceFile),
      flow_type: flowTypeOfDataSet(payload),
      source_name_fields: flowNameParts(payload),
      source_classification: sourceClassification,
      queue: "elementary-flow-reuse-queue.jsonl",
    });
  }

  function normalizeTimestampText(
    text: unknown,
    pathSegments: Array<string | number>,
    stats: MutableStats,
  ): unknown {
    if (pathSegments.at(-1) !== "common:timeStamp") return text;
    const value = String(text ?? "").trim();
    if (!value) return text;
    let normalized = value;
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?[+-]\d{2}:\d{2}$/u.test(value)) {
      normalized = normalizeUtcDateTimeString(value) ?? value;
    } else if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?$/u.test(value)) {
      normalized = `${value}Z`;
    }
    if (normalized !== value) {
      stats.timestamp_normalizations += 1;
    }
    return normalized;
  }

  function collectSourceTracePayloads(value: unknown, traces: JsonRecord[] = []): JsonRecord[] {
    if (!value || typeof value !== "object") return traces;
    if (Array.isArray(value)) {
      for (const item of value) collectSourceTracePayloads(item, traces);
      return traces;
    }
    const record = value as JsonRecord;
    const sourceTrace = record["tidasimport:sourceTrace"];
    if (isJsonRecord(sourceTrace)) {
      traces.push(asJsonRecord(sourceTrace.payload ?? sourceTrace));
    }
    for (const child of Object.values(record)) collectSourceTracePayloads(child, traces);
    return traces;
  }

  function walkSourceTraceNode(node: unknown, visitor: (node: JsonRecord) => void): void {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const item of node) walkSourceTraceNode(item, visitor);
      return;
    }
    const record = node as JsonRecord;
    visitor(record);
    for (const child of Object.values(record)) {
      walkSourceTraceNode(child, visitor);
    }
  }

  function sourceTraceAttribute(sourceTraces: JsonRecord[], attributeName: string): string | null {
    for (const trace of sourceTraces) {
      let found: string | null = null;
      walkSourceTraceNode(trace, (node) => {
        if (found) return;
        const attributes = Array.isArray(node.attributes) ? node.attributes : [];
        const attribute = attributes.find((item) => item?.name === attributeName);
        if (attribute?.value !== undefined && attribute?.value !== null) {
          found = String(attribute.value).trim();
        }
      });
      if (found) return found;
    }
    return null;
  }

  function sourceTraceLocationCode(sourceTraces: JsonRecord[]): string | null {
    const location = sourceTraceAttribute(sourceTraces, "location");
    return isLikelyLocationCodeText(location) ? location : null;
  }

  function sourceTraceChildText(sourceTraces: JsonRecord[], childName: string): string | null {
    for (const trace of sourceTraces) {
      let found: string | null = null;
      walkSourceTraceNode(trace, (node) => {
        if (found || node?.name !== childName) return;
        if (node.text !== undefined && node.text !== null) {
          found = String(node.text).trim();
        }
      });
      if (found) return found;
    }
    return null;
  }

  function processSourceClassificationSummary(sourceTraces: JsonRecord[]) {
    for (const trace of sourceTraces) {
      const sourceClassification = trace?.sourceClassification;
      if (isJsonRecord(sourceClassification)) {
        return {
          category: asText(sourceClassification.category),
          subCategory: asText(sourceClassification.subCategory),
          localCategory: asText(sourceClassification.localCategory),
          localSubCategory: asText(sourceClassification.localSubCategory),
        };
      }
    }
    return {
      category: sourceTraceAttribute(sourceTraces, "category"),
      subCategory: sourceTraceAttribute(sourceTraces, "subCategory"),
      localCategory: sourceTraceAttribute(sourceTraces, "localCategory"),
      localSubCategory: sourceTraceAttribute(sourceTraces, "localSubCategory"),
    };
  }

  function processAuthoringContextFromTrace(sourceTraces: JsonRecord[]) {
    return {
      source_name: sourceTraceAttribute(sourceTraces, "name"),
      source_local_name: sourceTraceAttribute(sourceTraces, "localName"),
      source_location: sourceTraceLocationCode(sourceTraces),
      source_unit: sourceTraceAttribute(sourceTraces, "unit"),
      general_comment: sourceTraceAttribute(sourceTraces, "generalComment"),
      included_processes: sourceTraceAttribute(sourceTraces, "includedProcesses"),
      technology: sourceTraceAttribute(sourceTraces, "text"),
    };
  }

  function textItem(value: unknown): JsonRecord | null {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const record = value as JsonRecord;
      return typeof record["#text"] === "string" ? record : null;
    }
    if (Array.isArray(value)) {
      return (
        value.find(
          (item) => item && typeof item === "object" && typeof item["#text"] === "string",
        ) ?? null
      );
    }
    return null;
  }

  function productionVolumeToAnnualText(value: unknown): string | null {
    const text = asText(value);
    if (!text) return null;
    let match = text.match(
      /^\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[Ee][+-]?\d+)?)\s+(.+?)\s+per\s+year\b/iu,
    );
    if (!match) {
      match = text.match(
        /([+-]?(?:\d[\d'.,]*(?:\.\d*)?|\.\d+)(?:[Ee][+-]?\d+)?)\s+([^\s,.;()]+)\s*\/\s*(?:year|yr|a)\b/iu,
      );
    }
    if (!match) return null;
    const amount = match[1].replace(/[',]/gu, "");
    const unit = match[2].replace(/[.。]\s*$/u, "").trim();
    return `${amount} ${unit}/year`;
  }

  function sourceTraceYear(sourceTraces: JsonRecord[]): number | null {
    for (const candidate of [
      sourceTraceChildText(sourceTraces, "endYear"),
      sourceTraceChildText(sourceTraces, "startYear"),
      sourceTraceAttribute(sourceTraces, "version"),
      sourceTraceAttribute(sourceTraces, "timestamp"),
    ]) {
      const match = asText(candidate).match(/\b(19|20)\d{2}\b/u);
      if (match) return Number(match[0]);
    }
    return null;
  }

  function repairProcessFieldsFromSourceTrace(
    payload: JsonRecord,
    sourceTraces: JsonRecord[],
    stats: MutableStats,
  ): void {
    if (!isJsonRecord(payload)) return;
    const root = asJsonRecord(payload.processDataSet);
    if (!isJsonRecord(payload.processDataSet)) return;
    const processInformation = asJsonRecord(root.processInformation);
    const time = isJsonRecord(processInformation.time) ? processInformation.time : null;
    if (time && time["common:referenceYear"] === 9999) {
      const year = sourceTraceYear(sourceTraces);
      if (year !== null && Number.isInteger(year) && year > 0 && year < 9999) {
        time["common:referenceYear"] = year;
        stats.reference_year_repairs += 1;
      }
    }

    const modelling = asJsonRecord(root.modellingAndValidation);
    const dataSources = isJsonRecord(modelling.dataSourcesTreatmentAndRepresentativeness)
      ? modelling.dataSourcesTreatmentAndRepresentativeness
      : null;
    if (!dataSources) return;

    const annualText = textItem(dataSources.annualSupplyOrProductionVolume);
    if (!annualText) return;
    const current = asText(annualText["#text"]);
    if (
      !current ||
      current.toLowerCase().includes("not declared in source package") ||
      !/(?:\/\s*(?:year|yr|a)\b|\bper\s+(?:year|annum)\b|\/\s*年|每年|年度|年供应|年产)/iu.test(
        current,
      )
    ) {
      const repaired = productionVolumeToAnnualText(
        sourceTraceAttribute(sourceTraces, "productionVolume"),
      );
      if (repaired) {
        annualText["#text"] = repaired;
        stats.annual_supply_repairs += 1;
      }
    }
  }

  function sanitizeImportContent(
    value: unknown,
    stats: MutableStats,
    traceRows: JsonRecord[],
    context: SanitizeContext,
    pathSegments: Array<string | number> = [],
  ): boolean {
    if (!value || typeof value !== "object") return false;
    if (Array.isArray(value)) {
      for (let index = value.length - 1; index >= 0; index -= 1) {
        const child = value[index];
        if (typeof child === "string") {
          value[index] = normalizeTimestampText(
            sanitizePlaceholderText(child, [...pathSegments, index], stats),
            [...pathSegments, index],
            stats,
          );
        } else if (
          sanitizeImportContent(child, stats, traceRows, context, [...pathSegments, index])
        ) {
          value.splice(index, 1);
        }
      }
      return false;
    }

    const record = value as JsonRecord;
    if (record["tidasimport:sourceTrace"]) {
      traceRows.push({
        dataset_type: context.type,
        dataset_id: context.identity.id,
        dataset_version: context.identity.version,
        source_file: repoRelativeMaybe(context.sourceFile),
        path: pathExpression([...pathSegments, "tidasimport:sourceTrace"]),
        trace: cloneJson(record["tidasimport:sourceTrace"]),
      });
      delete record["tidasimport:sourceTrace"];
      stats.removed_import_traces += 1;
    }
    if (record["@xmlns:tidasimport"]) {
      delete record["@xmlns:tidasimport"];
      stats.removed_import_trace_namespaces += 1;
    }

    for (const [key, child] of Object.entries(record)) {
      const childPath = [...pathSegments, key];
      if (typeof child === "string") {
        record[key] = normalizeTimestampText(
          sanitizePlaceholderText(child, childPath, stats),
          childPath,
          stats,
        );
        continue;
      }
      if (typeof child === "number" && key === "common:referenceYear" && child === 9999) {
        continue;
      }
      if (sanitizeImportContent(child, stats, traceRows, context, childPath)) {
        delete record[key];
      }
    }

    return pathSegments.at(-1) === "common:other" && isObjectEmpty(record);
  }

  function sanitizeBundlePayload(
    payload: JsonRecord | null,
    type: string,
    sourceFile: string,
    stats: MutableStats,
    traceRows: JsonRecord[],
    sourceTraces: JsonRecord[] | null = null,
  ): JsonRecord | null {
    sourceTraces ??= collectSourceTracePayloads(payload);
    if (type === "process") {
      repairProcessFieldsFromSourceTrace(payload!, sourceTraces, stats);
    }
    const identity = datasetIdentity(payload, type);
    sanitizeImportContent(payload, stats, traceRows, {
      type,
      identity,
      sourceFile,
    });
    return payload;
  }

  function findFirstBundleContactTemplate(bundleDirs: string[]): JsonRecord | null {
    for (const bundleDir of bundleDirs) {
      const contactsDir = path.join(bundleDir, "tidas", "contacts");
      if (!directoryExists(contactsDir)) continue;
      for (const name of fs.readdirSync(contactsDir).sort()) {
        if (name.endsWith(".json")) {
          return readJson(path.join(contactsDir, name));
        }
      }
    }
    return null;
  }

  function buildLibraryContactPayload(
    options: JsonRecord,
    templateContact: JsonRecord | null = null,
    rewriteContext: RewriteContext = {},
  ) {
    const language = asText(options.language || options.lang || "en") || "en";
    const profile = asText(options.profile || "bafu");
    // The FOEN/BAFU contact strings are fallbacks ONLY for the BAFU profile. Other import
    // profiles (e.g. worldsteel) MUST supply their own organisation's real identity — the
    // caller passes libraryName/shortName/website/email/telephone/contactAddress/... from
    // the package metadata + research, so no BAFU contact detail (email, phone, address,
    // organisation category) can leak into a different organisation's minted contact.
    const bafuDefault = (value: string): string => (profile === "bafu" ? value : "");
    const libraryName = asText(
      options.libraryName ||
        options.name ||
        bafuDefault("Swiss Federal Administration - Federal Office for the Environment (FOEN)"),
    );
    // `library*`-prefixed alternates let cross-process callers (the finalize CLI
    // subprocess) pass library contact fields via collision-free flags
    // (`--library-short-name`, `--library-website`, …) instead of generic option
    // names. In-process callers (materialize) keep using the plain fields.
    const shortName = asText(
      options.libraryShortName ||
        options.shortName ||
        bafuDefault("Federal Office for the Environment FOEN (BAFU)"),
    );
    const website = asText(
      options.libraryWebsite ||
        options.website ||
        options.url ||
        bafuDefault("https://www.bafu.admin.ch/en/contact-en"),
    );
    const email = asText(
      options.libraryEmail || options.email || bafuDefault("info@bafu.admin.ch"),
    );
    const telephone = asText(
      options.libraryTelephone ||
        options.telephone ||
        options.phone ||
        bafuDefault("+41 58 462 93 11"),
    );
    const contactAddress = asText(
      options.libraryContactAddress ||
        options.contactAddress ||
        options.address ||
        bafuDefault("Federal Office for the Environment FOEN, 3003 Bern, Switzerland"),
    );
    const centralContactPoint = asText(
      options.libraryCentralContactPoint ||
        options.centralContactPoint ||
        bafuDefault(
          "Federal Office for the Environment FOEN, 3003 Bern, Switzerland; info@bafu.admin.ch; +41 58 462 93 11",
        ),
    );
    const description = asText(
      options.libraryDescription ||
        options.description ||
        bafuDefault("Library-level contact for the BAFU 2025 Version 2 LCA data package."),
    );
    // `library*`-prefixed alternates (libraryContactId/libraryContactVersion) let the
    // cross-process finalize CLI pass an explicit visible contact identity to reuse
    // instead of deriving a deterministic owner-draft contact. Worldsteel omits these
    // alternates because its packaged contact id is foreign/private.
    const version = asText(
      options.libraryContactVersion || options.contactVersion || options.version || "00.00.001",
    );
    const id =
      asText(options.libraryContactId || options.contactId || options.id) ||
      (profile === "bafu"
        ? "a6db11f5-1cb4-579a-b503-bd17c361b8c2"
        : deterministicUuid(
            `tiangong-lca-foundry:library-contact:${profile}:${libraryName}:${website}`,
          ));
    const stableTimestamp =
      asText(options.timestamp || options.timeStamp || options.generatedAt) ||
      (profile === "bafu" ? "2025-01-01T00:00:00.000Z" : nowIso());
    const templateRoot = asJsonRecord(templateContact?.contactDataSet);
    const templateDataEntryBy = asJsonRecord(
      nestedValue(templateRoot, "administrativeInformation", "dataEntryBy"),
    );
    const originalReferenceToDataSetFormat = asJsonRecord(
      cloneJson(
        templateDataEntryBy["common:referenceToDataSetFormat"] ?? {
          "@type": "source data set",
          "@refObjectId": "16938856-0a35-5654-8aff-56c17e61da4d",
          "@version": "00.00.001",
          "@uri": "../sources/16938856-0a35-5654-8aff-56c17e61da4d.json",
          "common:shortDescription": multiLang("ILCD format", language),
        },
      ),
    );
    const referenceToDataSetFormat =
      canonicalSourceReferenceForRelation("dataset_format_source") ??
      originalReferenceToDataSetFormat;
    const originalFormatSnapshot = sourceReferenceSnapshot(originalReferenceToDataSetFormat);
    const canonicalFormatSnapshot = sourceReferenceSnapshot(referenceToDataSetFormat);
    if (
      rewriteContext?.rewriteRows &&
      (originalFormatSnapshot.ref_object_id !== canonicalFormatSnapshot.ref_object_id ||
        originalFormatSnapshot.version !== canonicalFormatSnapshot.version ||
        originalFormatSnapshot.short_description !== canonicalFormatSnapshot.short_description)
    ) {
      rewriteContext.rewriteRows.push({
        dataset_type: "contact",
        dataset_id: id,
        dataset_version: version,
        source_file: "foundry:library-contact",
        path: "contactDataSet.administrativeInformation.dataEntryBy.common:referenceToDataSetFormat",
        relation: "dataset_format_source",
        original: originalFormatSnapshot,
        canonical: canonicalFormatSnapshot,
        reason:
          "Library contact data set format uses the public canonical ILCD format source instead of a converted package-local support source.",
      });
      if (rewriteContext.stats) {
        rewriteContext.stats.source_reference_rewrites =
          Number(rewriteContext.stats.source_reference_rewrites ?? 0) + 1;
      }
    }
    const selfRef = contactGlobalReference({
      id,
      version,
      shortDescription: libraryName,
      language,
    });

    // Organisation category (组织类别) must reflect THIS organisation, not BAFU's. The
    // caller passes options.contactClassification (a [{@level,@classId,#text}, ...] array)
    // derived from the package's own contact metadata / research. Fall back to the FOEN
    // category only for the BAFU profile; for any other profile default to the generic
    // "Organisations > Other organisations" (2 / 2.4) rather than BAFU's "Governmental
    // organisations" (2.2). classIds follow tidas_contacts_category.json.
    const contactClass =
      Array.isArray(options.contactClassification) && options.contactClassification.length > 0
        ? options.contactClassification
        : profile === "bafu"
          ? [
              { "@level": "0", "@classId": "2", "#text": "Organisations" },
              { "@level": "1", "@classId": "2.2", "#text": "Governmental organisations" },
            ]
          : [
              { "@level": "0", "@classId": "2", "#text": "Organisations" },
              { "@level": "1", "@classId": "2.4", "#text": "Other organisations" },
            ];
    const dataSetInformation = {
      "common:UUID": id,
      "common:shortName": multiLang(shortName, language),
      "common:name": multiLang(libraryName, language),
      classificationInformation: {
        "common:classification": {
          "common:class": contactClass,
        },
      },
      WWWAddress: website,
      email,
      telephone,
      contactAddress: multiLang(contactAddress, language),
      centralContactPoint: multiLang(centralContactPoint, language),
      contactDescriptionOrComment: multiLang(description, language),
      "common:other": {
        "@xmlns:foundry": "https://tiangong.earth/tidas/foundry/1.0",
        "foundry:libraryContactPolicy": {
          "@marker": "FOUNDRY_LIBRARY_CONTACT_POLICY_V1",
          profile,
          libraryName,
          sourceLanguage: language,
          policy:
            "One shared library contact is used for every dataset row imported from this source library.",
          evidence: {
            source: "Foundry BAFU import profile/library-level source attribution",
            website,
            email,
            telephone,
            contactAddress,
          },
        },
      },
    };

    return {
      contactDataSet: {
        "@version": templateRoot?.["@version"] ?? "1.1",
        "@xmlns": templateRoot?.["@xmlns"] ?? "http://lca.jrc.it/ILCD/Contact",
        "@xmlns:common": templateRoot?.["@xmlns:common"] ?? "http://lca.jrc.it/ILCD/Common",
        "@xmlns:xsi": templateRoot?.["@xmlns:xsi"] ?? "http://www.w3.org/2001/XMLSchema-instance",
        "@xsi:schemaLocation":
          templateRoot?.["@xsi:schemaLocation"] ??
          "http://lca.jrc.it/ILCD/Contact ../../schemas/ILCD_ContactDataSet.xsd",
        contactInformation: {
          dataSetInformation,
        },
        administrativeInformation: {
          dataEntryBy: {
            "common:timeStamp": stableTimestamp,
            "common:referenceToDataSetFormat": referenceToDataSetFormat,
          },
          publicationAndOwnership: {
            "common:dataSetVersion": version,
            "common:permanentDataSetURI": `https://lcdn.tiangong.earth/datasetdetail/contact.xhtml?uuid=${id}&version=${version}`,
            "common:referenceToOwnershipOfDataSet": selfRef,
          },
        },
      },
    };
  }

  function listProcessBundleDirs(bundlesDir: unknown): string[] {
    const root = resolveRepoPath(bundlesDir);
    if (!root || !directoryExists(root)) {
      throw new Error("--bundles-dir is required and must point to a process-bundles directory.");
    }
    return fs
      .readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(root, entry.name))
      .filter(
        (dir) =>
          fileExists(path.join(dir, "manifest.json")) && directoryExists(path.join(dir, "tidas")),
      )
      .sort();
  }

  function selectProcessBundleDirs(allBundleDirs: string[], options: JsonRecord): BundleSelection {
    const requestedProcessIds = normalizedList(options.processId || options.processIds);
    if (requestedProcessIds.length > 0) {
      const byName = new Map(allBundleDirs.map((dir) => [path.basename(dir), dir]));
      const selected = requestedProcessIds
        .map((id) => byName.get(id))
        .filter((directory): directory is string => Boolean(directory));
      return {
        seed: null,
        selected,
        missing_process_ids: requestedProcessIds.filter((id) => !byName.has(id)),
      };
    }

    const seed = asText(options.seed) || `sample-${Date.now()}`;
    const sampleSizeText = asText(options.sampleSize || options.limit || options.count || 3);
    const sampleSize =
      sampleSizeText.toLowerCase() === "all"
        ? allBundleDirs.length
        : Math.max(1, Number(sampleSizeText));
    if (!Number.isFinite(sampleSize)) {
      throw new Error("--sample-size must be a positive number or all.");
    }
    const selected = [...allBundleDirs]
      .sort((left, right) =>
        createHash("sha256")
          .update(`${seed}:${path.basename(left)}`)
          .digest("hex")
          .localeCompare(
            createHash("sha256")
              .update(`${seed}:${path.basename(right)}`)
              .digest("hex"),
          ),
      )
      .slice(0, Math.min(sampleSize, allBundleDirs.length));
    return { seed, selected, missing_process_ids: [] };
  }

  function addDedupedBundleRow({
    rowsByType,
    sourceByType,
    blockers,
    type,
    payload,
    sourceFile,
  }: {
    rowsByType: Record<string, Map<string, JsonRecord>>;
    sourceByType: Record<string, Map<string, string>>;
    blockers: JsonRecord[];
    type: string;
    payload: JsonRecord;
    sourceFile: string;
  }): boolean {
    const identity = datasetIdentity(payload, type);
    const key = `${identity.id || path.basename(sourceFile)}::${identity.version || ""}`;
    if (!identity.id || !identity.version) {
      blockers.push({
        code: "bundle_row_identity_missing",
        message: `${type} row is missing common:UUID or common:dataSetVersion.`,
        source_file: repoRelativeMaybe(sourceFile),
        id: identity.id,
        version: identity.version,
      });
      return false;
    }
    if (!rowsByType[type].has(key)) {
      rowsByType[type].set(key, payload);
      sourceByType[type].set(key, sourceFile);
      return true;
    }
    const existing = rowsByType[type].get(key);
    if (jsonSha256(existing) !== jsonSha256(payload)) {
      blockers.push({
        code: "bundle_row_duplicate_payload_conflict",
        message: `${type} ${identity.id}@${identity.version} appears with different payloads in sampled bundles.`,
        kept_source_file: repoRelativeMaybe(sourceByType[type].get(key) ?? null),
        conflicting_source_file: repoRelativeMaybe(sourceFile),
      });
    }
    return false;
  }

  return {
    addDedupedBundleRow,
    buildLibraryContactPayload,
    collectBundleQualityFindings,
    collectElementaryFlowReuseFindings,
    collectSourceTracePayloads,
    findFirstBundleContactTemplate,
    flowNameParts,
    listProcessBundleDirs,
    processAuthoringContextFromTrace,
    processSourceClassificationSummary,
    sanitizeBundlePayload,
    selectProcessBundleDirs,
    sourceTraceAttribute,
    sourceTraceChildText,
    sourceTraceLocationCode,
  };
}

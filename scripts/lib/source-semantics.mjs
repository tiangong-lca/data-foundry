export function createSourceSemanticUtils({
  asText,
  bundleClassificationPath,
  cloneJson,
  datasetIdentity,
  deterministicUuid,
  languageForText,
  multiLang,
  pathExpression,
  repoRelativeMaybe,
  textValue,
}) {
  function sourceDataSetInformation(payload) {
    return payload?.sourceDataSet?.sourceInformation?.dataSetInformation &&
      typeof payload.sourceDataSet.sourceInformation.dataSetInformation === "object"
      ? payload.sourceDataSet.sourceInformation.dataSetInformation
      : {};
  }

  function sourceShortName(payload) {
    const dataSetInformation = sourceDataSetInformation(payload);
    return (
      textValue(dataSetInformation["common:shortName"]) ||
      textValue(dataSetInformation.shortName) ||
      textValue(dataSetInformation.name)
    );
  }

  function sourceCitationText(payload) {
    const dataSetInformation = sourceDataSetInformation(payload);
    return textValue(dataSetInformation.sourceCitation);
  }

  function sourceDescriptionText(payload) {
    const dataSetInformation = sourceDataSetInformation(payload);
    return textValue(dataSetInformation.sourceDescriptionOrComment);
  }

  function isBareSourceDescriptionText(value) {
    const text = asText(value).trim();
    return text === "" || /^(Report|Publication|Source)$/iu.test(text);
  }

  function isGenericEcoSpoldCompatibilitySourceText(value) {
    return /^Created for EcoSpold 1 compatibility$/iu.test(asText(value));
  }

  function isPlaceholderSourceIdentityText(value) {
    return /^(Not specified|Not declared|Unspecified)$/iu.test(asText(value));
  }

  function sourceMetadataFromDescription(description) {
    const text = asText(description).replace(/\\n/gu, "\n");
    if (!text) return null;
    const originalTitle = text.match(/^Original title:\s*(.+)$/imu)?.[1]?.trim();
    const year = text.match(/^Year:\s*(\d{4})$/imu)?.[1] ?? text.match(/\((\d{4})\)/u)?.[1] ?? null;
    const firstAuthor =
      text.match(/^First author:\s*(.+)$/imu)?.[1]?.trim() ??
      text.match(/^([^(\n]+?)\s*\(\d{4}\)/u)?.[1]?.trim() ??
      null;
    const title =
      originalTitle ?? text.match(/\(\d{4}\)\s*([^.\n]+(?:\.[^.\n]+)*)/u)?.[1]?.trim() ?? null;
    if (!title || !year) return null;
    const firstAuthorLastName =
      firstAuthor?.split(",")[0]?.trim() || firstAuthor?.split(/\s+/u)[0] || null;
    const shortName = [year, title, firstAuthorLastName].filter(Boolean).join(" - ");
    const firstLine = text.split(/\r?\n/u)[0]?.trim();
    return {
      shortName,
      citation:
        firstLine && !isGenericEcoSpoldCompatibilitySourceText(firstLine) ? firstLine : shortName,
    };
  }

  function normalizeDoi(value) {
    const text = asText(value);
    const doi = text.match(/\b10\.\d{4,9}\/[-._;()/:A-Z0-9]+/iu)?.[0];
    return doi ? doi.replace(/[),.;\s]+$/u, "") : "";
  }

  function cleanOriginalSourceText(value) {
    return asText(value)
      .replace(/\s+/gu, " ")
      .replace(/\s*UUID:\s*[0-9a-f-]{36}\b.*$/iu, "")
      .replace(/\s*$/u, "")
      .trim();
  }

  function processSourceContextTexts(payload) {
    const process = payload?.processDataSet ?? payload;
    const dataSetInformation = process?.processInformation?.dataSetInformation ?? {};
    const treatment =
      process?.modellingAndValidation?.dataSourcesTreatmentAndRepresentativeness ?? {};
    return [
      textValue(dataSetInformation["common:generalComment"]),
      textValue(process?.processInformation?.technology?.technologyDescriptionAndIncludedProcesses),
      textValue(treatment.dataCutOffAndCompletenessPrinciples),
      textValue(treatment.useAdviceForDataSet),
    ]
      .map(cleanOriginalSourceText)
      .filter((text) => text && !/^(Unspecified|Not specified|Not declared)$/iu.test(text));
  }

  function authorLastName(value) {
    const firstAuthor = asText(value)
      .split(/\s*(?:,| and )\s*/u)
      .find(Boolean);
    if (!firstAuthor) return "";
    const particles = new Set(["de", "del", "der", "di", "dos", "du", "la", "le", "van", "von"]);
    const tokens = firstAuthor
      .replace(/\b[A-Z]\./gu, "")
      .trim()
      .split(/\s+/u)
      .filter(Boolean);
    if (tokens.length === 0) return "";
    const last = tokens[tokens.length - 1];
    if (particles.has(last.toLowerCase()) && tokens.length > 1) return tokens[tokens.length - 2];
    return last;
  }

  function originalSourceMetadataFromText(value) {
    const text = cleanOriginalSourceText(value);
    if (!text) return null;
    const markerMatch = text.match(/Original source:\s*(.+)$/isu);
    const sourceText = cleanOriginalSourceText(markerMatch?.[1] ?? text);
    if (!markerMatch && !/\bdoi\s*:/iu.test(sourceText)) return null;
    const doi = normalizeDoi(sourceText);
    const withoutDoi = cleanOriginalSourceText(
      sourceText.replace(/\s*,?\s*doi\s*:\s*10\.\d{4,9}\/[-._;()/:A-Z0-9]+/iu, ""),
    );
    const sourcePattern =
      /^(?<authors>.+),\s*(?<title>[^,]+),\s*(?<container>.+?)\s+(?<year>(?:19|20)\d{2})\s*(?<details>.*)$/u;
    const match = withoutDoi.match(sourcePattern);
    const year = match?.groups?.year ?? withoutDoi.match(/\b((?:19|20)\d{2})\b/u)?.[1] ?? "";
    const title = cleanOriginalSourceText(match?.groups?.title ?? "");
    const authors = cleanOriginalSourceText(match?.groups?.authors ?? "");
    const container = cleanOriginalSourceText(match?.groups?.container ?? "");
    const details = cleanOriginalSourceText(match?.groups?.details ?? "");
    if (!doi || !year || !title || !authors) return null;
    const firstAuthorLastName = authorLastName(authors);
    return {
      shortName: [year, title, firstAuthorLastName].filter(Boolean).join(" - "),
      citation: sourceText,
      description: [container || null, year || null, details || null, doi ? `DOI: ${doi}` : null]
        .filter(Boolean)
        .join("; "),
      doi,
      title,
      year,
      authors,
      container: container || null,
      details: details || null,
    };
  }

  function processOriginalSourceMetadata(payload) {
    for (const text of processSourceContextTexts(payload)) {
      const metadata = originalSourceMetadataFromText(text);
      if (metadata) return metadata;
    }
    return null;
  }

  function sourceSummaryMatchesOriginalMetadata(source, metadata) {
    if (!source?.dataset_id || !metadata) return false;
    const haystack = [
      source.short_name,
      source.source_citation,
      source.source_description,
      source.classification_path,
    ]
      .map(asText)
      .join(" ")
      .toLowerCase();
    const doi = normalizeDoi(metadata.doi).toLowerCase();
    if (doi && haystack.includes(doi)) return true;
    const title = asText(metadata.title).toLowerCase();
    return Boolean(title && haystack.includes(title));
  }

  function repairTrueSourceIdentity(payload, { sourceFile, stats, repairRows }) {
    if (sourceSemanticKind(payload) !== "true_source") return;
    const dataSetInformation = sourceDataSetInformation(payload);
    if (!dataSetInformation || typeof dataSetInformation !== "object") return;
    const originalShortName = sourceShortName(payload);
    const originalCitation = sourceCitationText(payload);
    if (
      !isGenericEcoSpoldCompatibilitySourceText(originalShortName) &&
      !isGenericEcoSpoldCompatibilitySourceText(originalCitation)
    ) {
      return;
    }
    const repaired = sourceMetadataFromDescription(sourceDescriptionText(payload));
    if (!repaired?.shortName) return;
    dataSetInformation["common:shortName"] = multiLang(repaired.shortName, "en");
    dataSetInformation.sourceCitation = repaired.citation;
    const identity = datasetIdentity(payload, "source");
    stats.true_source_identity_repairs += 1;
    repairRows.push({
      dataset_id: identity.id,
      dataset_version: identity.version,
      source_file: repoRelativeMaybe(sourceFile),
      relation: "true_source_identity_from_description",
      original_short_name: originalShortName || null,
      original_source_citation: originalCitation || null,
      repaired_short_name: repaired.shortName,
      repaired_source_citation: repaired.citation,
      basis:
        "Converted EcoSpold compatibility source name was generic; sourceDescriptionOrComment contains report metadata with title, year, and author.",
    });
  }

  function repairTrueSourceDescription(payload, { sourceFile, stats, repairRows }) {
    if (sourceSemanticKind(payload) !== "true_source") return;
    const dataSetInformation = sourceDataSetInformation(payload);
    if (!dataSetInformation || typeof dataSetInformation !== "object") return;
    const originalDescription = sourceDescriptionText(payload);
    if (!isBareSourceDescriptionText(originalDescription)) return;
    const citation = sourceCitationText(payload);
    const shortName = sourceShortName(payload);
    const evidence = citation || shortName;
    if (!evidence) return;
    const repairedDescription = `Report/publication: ${evidence}.`;
    dataSetInformation.sourceDescriptionOrComment = multiLang(repairedDescription, "en");
    const identity = datasetIdentity(payload, "source");
    stats.true_source_description_repairs += 1;
    repairRows.push({
      dataset_id: identity.id,
      dataset_version: identity.version,
      source_file: repoRelativeMaybe(sourceFile),
      relation: "true_source_description_from_citation",
      original_description: originalDescription || null,
      repaired_description: repairedDescription,
      basis:
        "Converted sourceDescriptionOrComment was empty or only a generic type word; citation/shortName identifies the report or publication source.",
    });
  }

  function sourceSemanticKind(payload) {
    // A reference to a known public canonical support source — the ILCD format spec
    // (a97a0155) or the ILCD Data Network compliance system (d92a1a12) — IS that canonical
    // dataset by identity, regardless of how a converted package classifies or names it.
    // Some packages (e.g. USLCI) ship "ILCD format" classified as "Publications and
    // communications" or list it under referenceToDataSource; without this it reads as a
    // placeholder/true_source and is minted at the package version instead of reused, which
    // trips the source-identity prewrite gate and would version_outdated against the
    // published canonical. Recognize it by UUID so the canonical reference rewrite and the
    // reference-only write exclusion both fire (matching its classified-as-format peers).
    const canonicalSupportKind = canonicalSupportSourceKindForId(
      datasetIdentity(payload, "source")?.id,
    );
    if (canonicalSupportKind) return canonicalSupportKind;
    const classificationPath = bundleClassificationPath(payload, "source");
    const classification = classificationPath.toLowerCase();
    const citation = sourceCitationText(payload);
    const shortNameText = sourceShortName(payload);
    const shortName = shortNameText.toLowerCase();
    if (classification.includes("data set formats")) return "format_support_source";
    if (classification.includes("compliance systems")) return "compliance_support_source";
    if (
      isPlaceholderSourceIdentityText(shortNameText) ||
      isPlaceholderSourceIdentityText(citation)
    ) {
      return "placeholder_or_unspecified_source";
    }
    if (
      isGenericEcoSpoldCompatibilitySourceText(shortNameText) ||
      isGenericEcoSpoldCompatibilitySourceText(citation)
    ) {
      const repaired = sourceMetadataFromDescription(sourceDescriptionText(payload));
      return repaired?.shortName ? "true_source" : "unresolved_source_semantics";
    }
    if (citation) return "true_source";
    if (
      shortName.includes("not specified") ||
      shortName.includes("not declared") ||
      shortName === "unspecified"
    ) {
      return "placeholder_or_unspecified_source";
    }
    return "unresolved_source_semantics";
  }

  function repairTrueSourceClassification(payload, { sourceFile, stats, repairRows }) {
    if (sourceSemanticKind(payload) !== "true_source") return;
    const currentClassification = bundleClassificationPath(payload, "source");
    if (currentClassification && !/^Other source types$/iu.test(currentClassification)) {
      return;
    }
    const dataSetInformation = sourceDataSetInformation(payload);
    if (!dataSetInformation || typeof dataSetInformation !== "object") return;
    dataSetInformation.classificationInformation ??= {};
    dataSetInformation.classificationInformation["common:classification"] ??= {};
    dataSetInformation.classificationInformation["common:classification"]["common:class"] = {
      "@level": "0",
      "@classId": "5",
      "#text": "Publications and communications",
    };
    const identity = datasetIdentity(payload, "source");
    const alreadyReported = repairRows.some(
      (row) =>
        row.dataset_id === identity.id &&
        row.dataset_version === identity.version &&
        row.relation === "true_source_publication_classification",
    );
    if (alreadyReported) return;
    stats.true_source_classification_repairs += 1;
    repairRows.push({
      dataset_id: identity.id,
      dataset_version: identity.version,
      source_file: repoRelativeMaybe(sourceFile),
      relation: "true_source_publication_classification",
      original_classification: currentClassification || null,
      repaired_classification: "Publications and communications",
      basis:
        "sourceCitation is present and the converted source category was generic Other source types.",
    });
  }

  function sourceSemanticSummary(payload, sourceFile) {
    const identity = datasetIdentity(payload, "source");
    const kind = sourceSemanticKind(payload);
    return {
      dataset_id: identity.id,
      dataset_version: identity.version,
      source_file: repoRelativeMaybe(sourceFile),
      kind,
      materialized_as_source_row: kind === "true_source",
      short_name: sourceShortName(payload),
      source_citation: sourceCitationText(payload) || null,
      source_description: sourceDescriptionText(payload) || null,
      classification_path: bundleClassificationPath(payload, "source") || null,
    };
  }

  function bafuFallbackSourceId() {
    if (typeof deterministicUuid === "function") {
      return deterministicUuid("tiangong-lca-foundry:bafu:database-source:BAFU 2025 Version 2");
    }
    return "7d6cb661-93f8-5c42-b23f-c3b73f8a6f97";
  }

  function processContextSourceId(metadata) {
    const identityText =
      normalizeDoi(metadata?.doi) || asText(metadata?.citation) || asText(metadata?.shortName);
    if (typeof deterministicUuid === "function") {
      return deterministicUuid(`tiangong-lca-foundry:bafu:process-context-source:${identityText}`);
    }
    return identityText;
  }

  function buildBafuProcessContextSourcePayload({
    metadata,
    contactReference,
    id = null,
    version = "00.00.001",
    language = "en",
    timestamp = null,
  } = {}) {
    if (!metadata?.shortName || !metadata?.citation) return null;
    const sourceId = asText(id) || processContextSourceId(metadata);
    const dataEntryBy = {
      "common:referenceToDataSetFormat":
        canonicalSourceReferenceForRelation("dataset_format_source"),
    };
    if (timestamp) {
      dataEntryBy["common:timeStamp"] = timestamp;
    }
    const publicationAndOwnership = {
      "common:dataSetVersion": version,
      "common:permanentDataSetURI": `https://www.bafu.admin.ch/bafu-2025-v2/sources/${sourceId}`,
    };
    if (contactReference) {
      publicationAndOwnership["common:referenceToOwnershipOfDataSet"] = cloneJson(contactReference);
    }
    return {
      sourceDataSet: {
        "@xmlns": "http://lca.jrc.it/ILCD/Source",
        "@xmlns:common": "http://lca.jrc.it/ILCD/Common",
        "@xmlns:xsi": "http://www.w3.org/2001/XMLSchema-instance",
        "@version": "1.1",
        "@xsi:schemaLocation": "http://lca.jrc.it/ILCD/Source ../../schemas/ILCD_SourceDataSet.xsd",
        sourceInformation: {
          dataSetInformation: {
            "common:UUID": sourceId,
            "common:shortName": multiLang(metadata.shortName, language),
            classificationInformation: {
              "common:classification": {
                "common:class": {
                  "@level": "0",
                  "@classId": "5",
                  "#text": "Publications and communications",
                },
              },
            },
            sourceCitation: metadata.citation,
            sourceDescriptionOrComment: multiLang(
              metadata.description || `Report/publication: ${metadata.citation}.`,
              language,
            ),
          },
        },
        administrativeInformation: {
          dataEntryBy,
          publicationAndOwnership,
        },
      },
    };
  }

  // Database-level fallback source identity is profile-specific. A converted
  // package whose process data source points at a non-source placeholder (and
  // that has no unambiguous process-specific report/publication source) is
  // rewritten to cite the package's own database-level source. That source must
  // belong to the package being imported — a USLCI process must cite the USLCI
  // database, never BAFU's. The BAFU branch is kept byte-identical to the
  // original so already-imported BAFU rows are unaffected.
  function databaseFallbackSourceConfig(profile) {
    const key = asText(profile).toLowerCase();
    if (key === "uslci") {
      return {
        id: deterministicUuid(
          "tiangong-lca-foundry:uslci:database-source:U.S. Life Cycle Inventory Database (USLCI)",
        ),
        shortName: "U.S. Life Cycle Inventory Database (USLCI)",
        citation:
          "U.S. Life Cycle Inventory Database (USLCI), National Renewable Energy Laboratory (NREL), U.S. Federal LCA Commons, 2025.",
        description:
          "Database-level fallback source used when the converted USLCI package has no more specific report, publication, or data-source evidence for the process scope.",
        permanentDataSetUri: (sourceId) => `https://www.lcacommons.gov/uslci/${sourceId}`,
      };
    }
    // Default (BAFU and any unspecified profile): preserve the original behavior.
    return {
      id: bafuFallbackSourceId(),
      shortName: "BAFU 2025 Version 2 LCA database",
      citation:
        "BAFU 2025 Version 2 LCA database, Federal Office for the Environment (FOEN), 2025.",
      description:
        "Database-level fallback source used when the converted BAFU package has no more specific report, publication, or data-source evidence for the process scope.",
      permanentDataSetUri: (sourceId) => `https://www.bafu.admin.ch/bafu-2025-v2/${sourceId}`,
    };
  }

  function buildDatabaseFallbackSourcePayload({
    profile = "bafu",
    contactReference,
    id = null,
    version = "00.00.001",
    language = "en",
    timestamp = null,
  } = {}) {
    const config = databaseFallbackSourceConfig(profile);
    const sourceId = asText(id) || config.id;
    const shortName = config.shortName;
    const citation = config.citation;
    const description = config.description;
    const dataFormatReference = canonicalSourceReferenceForRelation("dataset_format_source");
    // ILCD expects the format reference inside dataEntryBy (see
    // buildBafuProcessContextSourcePayload); at the administrativeInformation
    // root it fails schema validation as an unknown member.
    const dataEntryBy = {
      "common:referenceToDataSetFormat": dataFormatReference,
    };
    if (timestamp) {
      dataEntryBy["common:timeStamp"] = timestamp;
    }
    const admin = {
      dataEntryBy,
      publicationAndOwnership: {
        "common:dataSetVersion": version,
        "common:permanentDataSetURI": config.permanentDataSetUri(sourceId),
      },
    };
    if (contactReference) {
      admin.publicationAndOwnership["common:referenceToOwnershipOfDataSet"] =
        cloneJson(contactReference);
    }
    return {
      sourceDataSet: {
        "@xmlns": "http://lca.jrc.it/ILCD/Source",
        "@xmlns:common": "http://lca.jrc.it/ILCD/Common",
        "@xmlns:xsi": "http://www.w3.org/2001/XMLSchema-instance",
        "@version": "1.1",
        "@xsi:schemaLocation": "http://lca.jrc.it/ILCD/Source ../../schemas/ILCD_SourceDataSet.xsd",
        sourceInformation: {
          dataSetInformation: {
            "common:UUID": sourceId,
            "common:shortName": multiLang(shortName, language),
            classificationInformation: {
              "common:classification": {
                "common:class": {
                  "@level": "0",
                  "@classId": "2",
                  "#text": "Databases",
                },
              },
            },
            sourceCitation: citation,
            sourceDescriptionOrComment: multiLang(description, language),
          },
        },
        administrativeInformation: admin,
      },
    };
  }

  // Backward-compatible alias: existing callers that explicitly want the BAFU
  // database-level fallback source. New callers should use
  // buildDatabaseFallbackSourcePayload({ profile }).
  function buildBafuFallbackSourcePayload(options = {}) {
    return buildDatabaseFallbackSourcePayload({ ...options, profile: "bafu" });
  }

  function sourceReferenceFromSummary(source, language = "en") {
    const id = asText(source?.dataset_id);
    if (!id) return null;
    const version = asText(source?.dataset_version) || "00.00.001";
    const shortName = asText(source?.short_name) || "BAFU 2025 Version 2 LCA database";
    return {
      "@type": "source data set",
      "@refObjectId": id,
      "@version": version,
      "@uri": `../sources/${id}_${version}.xml`,
      "common:shortDescription": multiLang(shortName, language),
    };
  }

  function sourceReferenceKind(pathSegments) {
    const pathText = pathSegments.join(".");
    if (pathText.includes("referenceToDataSource")) return "process_data_source";
    if (pathText.includes("referenceToDataSetFormat")) return "dataset_format_source";
    if (pathText.includes("referenceToComplianceSystem")) return "compliance_system_source";
    return "other_source_reference";
  }

  const canonicalSourceReferences = {
    dataset_format_source: {
      "@type": "source data set",
      "@refObjectId": "a97a0155-0234-4b87-b4ce-a45da52f2a40",
      "@version": "03.00.003",
      "@uri": "../sources/a97a0155-0234-4b87-b4ce-a45da52f2a40_03.00.003.xml",
      "common:shortDescription": multiLang("ILCD format", "en"),
    },
    compliance_system_source: {
      "@type": "source data set",
      "@refObjectId": "d92a1a12-2545-49e2-a585-55c259997756",
      "@version": "20.20.002",
      "@uri": "../sources/d92a1a12-2545-49e2-a585-55c259997756_20.20.002.xml",
      "common:shortDescription": multiLang("ILCD Data Network - Entry-level", "en"),
    },
  };

  function canonicalSourceReferenceForRelation(relation) {
    const reference = canonicalSourceReferences[relation];
    return reference ? cloneJson(reference) : null;
  }

  // A format/compliance support source is the same public canonical dataset no matter
  // which slot references it. The path-relation maps a format/compliance slot to its
  // canonical; this maps the source's own semantic KIND to the same canonical, so a
  // format/compliance source landing in a non-format/compliance slot (e.g.
  // modellingAndValidation/validation/review/common:referenceToCompleteReviewReport)
  // is rewritten to the same public canonical source it would get on its format slot.
  const canonicalSourceReferenceByKind = {
    format_support_source: "dataset_format_source",
    compliance_support_source: "compliance_system_source",
  };

  function canonicalSourceReferenceForSourceKind(kind) {
    const relation = canonicalSourceReferenceByKind[asText(kind)];
    return relation ? canonicalSourceReferenceForRelation(relation) : null;
  }

  // Inverse of canonicalSourceReferenceByKind + canonicalSourceReferences: map a source's
  // own UUID to its canonical support KIND, so a public canonical support source is
  // recognized by identity even when its converted classification/shortName would not
  // otherwise resolve to format_support_source / compliance_support_source.
  function canonicalSupportSourceKindForId(refObjectId) {
    const id = asText(refObjectId);
    if (!id) return null;
    for (const [kind, relation] of Object.entries(canonicalSourceReferenceByKind)) {
      if (asText(canonicalSourceReferences[relation]?.["@refObjectId"]) === id) {
        return kind;
      }
    }
    return null;
  }

  function sourceReferenceSnapshot(reference) {
    return {
      ref_object_id: asText(reference?.["@refObjectId"]) || null,
      version: asText(reference?.["@version"]) || null,
      uri: asText(reference?.["@uri"]) || null,
      short_description: textValue(reference?.["common:shortDescription"]) || null,
    };
  }

  function rewriteCanonicalSourceReferences(
    value,
    {
      datasetType,
      sourceFile,
      stats,
      rewriteRows,
      pathSegments = [],
      datasetIdentityCache = null,
      sourceLookup = null,
    },
  ) {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      value.forEach((item, index) =>
        rewriteCanonicalSourceReferences(item, {
          datasetType,
          sourceFile,
          stats,
          rewriteRows,
          pathSegments: [...pathSegments, index],
          datasetIdentityCache,
          sourceLookup,
        }),
      );
      return;
    }

    const relation = sourceReferenceKind(pathSegments);
    const refType = asText(value["@type"]).toLowerCase();
    const refObjectId = asText(value["@refObjectId"]);
    // The canonical target is fixed first by the reference path-relation (format /
    // compliance slots), then — for any other slot, e.g. referenceToCompleteReviewReport
    // — by the referenced source's own semantic KIND when a sourceLookup is supplied. A
    // format/compliance support source ("ILCD format"/"Data set formats",
    // "...compliance systems") is the same public canonical dataset wherever it is
    // referenced, so it must be rewritten on every path; a true source has no kind-based
    // canonical and is never touched here.
    let canonical = canonicalSourceReferenceForRelation(relation);
    // effectiveRelation records WHY the rewrite happened: a path-relation rewrite keeps
    // its slot relation; a kind-based rewrite on an otherwise-unmapped slot records the
    // referenced source's support kind so the rewrite row is traceable.
    let effectiveRelation = relation;
    let kindBasedRewrite = false;
    if (!canonical && sourceLookup && refObjectId && refType.includes("source")) {
      const referencedKind = sourceLookup.get(refObjectId)?.kind;
      canonical = canonicalSourceReferenceForSourceKind(referencedKind);
      if (canonical) {
        effectiveRelation = asText(referencedKind) || relation;
        kindBasedRewrite = true;
      }
    }
    if (canonical && refObjectId && refType.includes("source")) {
      const before = sourceReferenceSnapshot(value);
      const after = sourceReferenceSnapshot(canonical);
      if (
        before.ref_object_id !== after.ref_object_id ||
        before.version !== after.version ||
        before.short_description !== after.short_description
      ) {
        const identity =
          datasetIdentityCache && datasetIdentityCache.id
            ? datasetIdentityCache
            : datasetIdentity(value, datasetType);
        stats.source_reference_rewrites += 1;
        rewriteRows.push({
          dataset_type: datasetType,
          dataset_id: identity.id,
          dataset_version: identity.version,
          source_file: repoRelativeMaybe(sourceFile),
          path: pathExpression(pathSegments),
          relation: effectiveRelation,
          original: before,
          canonical: after,
          reason: kindBasedRewrite
            ? "A format/compliance support source referenced outside its format/compliance slot (e.g. a review report reference) is rewritten to the same public canonical source it uses on its format/compliance slot, so reference closure proves it as a reusable public dataset."
            : relation === "dataset_format_source"
              ? "Data set format uses the public canonical ILCD format source instead of a converted package-local support source."
              : "Compliance declaration uses the public canonical ILCD Data Network Entry-level source instead of a converted placeholder support source.",
        });
      }
      Object.keys(value).forEach((key) => {
        delete value[key];
      });
      Object.assign(value, cloneJson(canonical));
    }

    for (const [key, child] of Object.entries(value)) {
      rewriteCanonicalSourceReferences(child, {
        datasetType,
        sourceFile,
        stats,
        rewriteRows,
        pathSegments: [...pathSegments, key],
        datasetIdentityCache,
        sourceLookup,
      });
    }
  }

  function rewriteTrueSourceReferenceDescriptions(
    value,
    {
      sourceLookup,
      sourceFile,
      stats,
      rewriteRows,
      pathSegments = [],
      datasetIdentityCache = null,
    },
  ) {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      value.forEach((item, index) =>
        rewriteTrueSourceReferenceDescriptions(item, {
          sourceLookup,
          sourceFile,
          stats,
          rewriteRows,
          pathSegments: [...pathSegments, index],
          datasetIdentityCache,
        }),
      );
      return;
    }

    const relation = sourceReferenceKind(pathSegments);
    const refType = asText(value["@type"]).toLowerCase();
    const refObjectId = asText(value["@refObjectId"]);
    if (relation === "process_data_source" && refObjectId && refType.includes("source")) {
      const source = sourceLookup.get(refObjectId);
      const canonicalShortName = asText(source?.short_name);
      const currentShortName = textValue(value["common:shortDescription"]);
      if (
        source?.kind === "true_source" &&
        canonicalShortName &&
        currentShortName !== canonicalShortName
      ) {
        const before = sourceReferenceSnapshot(value);
        value["common:shortDescription"] = multiLang(
          canonicalShortName,
          languageForText(canonicalShortName),
        );
        const after = sourceReferenceSnapshot(value);
        stats.true_source_reference_description_repairs += 1;
        const identity =
          datasetIdentityCache && datasetIdentityCache.id
            ? datasetIdentityCache
            : { id: null, version: null };
        rewriteRows.push({
          dataset_type: "process",
          dataset_id: identity.id,
          dataset_version: identity.version,
          source_file: repoRelativeMaybe(sourceFile),
          path: pathExpression(pathSegments),
          relation: "process_data_source_short_description",
          original: before,
          canonical: after,
          reason:
            "Process data source reference shortDescription is synchronized to the curated true source row name.",
        });
      }
    }

    for (const [key, child] of Object.entries(value)) {
      rewriteTrueSourceReferenceDescriptions(child, {
        sourceLookup,
        sourceFile,
        stats,
        rewriteRows,
        pathSegments: [...pathSegments, key],
        datasetIdentityCache,
      });
    }
  }

  function rewriteProcessDataSourceReferences(
    value,
    {
      sourceLookup,
      replacementSource = null,
      forceReplacementSource = false,
      replacementRelation = null,
      replacementReason = null,
      sourceFile,
      stats,
      rewriteRows,
      pathSegments = [],
      datasetIdentityCache = null,
      language = "en",
    },
  ) {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      value.forEach((item, index) =>
        rewriteProcessDataSourceReferences(item, {
          sourceLookup,
          replacementSource,
          forceReplacementSource,
          replacementRelation,
          replacementReason,
          sourceFile,
          stats,
          rewriteRows,
          pathSegments: [...pathSegments, index],
          datasetIdentityCache,
          language,
        }),
      );
      return;
    }

    const relation = sourceReferenceKind(pathSegments);
    const refType = asText(value["@type"]).toLowerCase();
    const refObjectId = asText(value["@refObjectId"]);
    if (relation === "process_data_source" && refObjectId && refType.includes("source")) {
      const referencedSource = sourceLookup.get(refObjectId);
      const currentShortName = textValue(value["common:shortDescription"]);
      let targetSource = null;
      let rewriteRelation = null;
      let reason = null;

      if (forceReplacementSource && replacementSource?.dataset_id) {
        targetSource = replacementSource;
        rewriteRelation = replacementRelation || "process_data_source_context_source";
        reason =
          replacementReason ||
          "Process context identifies a more specific original report/publication source than the converted process data source reference.";
      } else if (referencedSource?.kind === "true_source") {
        const canonicalShortName = asText(referencedSource.short_name);
        if (canonicalShortName && currentShortName !== canonicalShortName) {
          targetSource = referencedSource;
          rewriteRelation = "process_data_source_short_description";
          reason =
            "Process data source reference shortDescription is synchronized to the curated true source row name.";
        }
      } else if (replacementSource?.dataset_id) {
        targetSource = replacementSource;
        rewriteRelation = replacementSource.fallback_database_source
          ? "process_data_source_fallback_database"
          : "process_data_source_true_source";
        reason = replacementSource.fallback_database_source
          ? "Converted process data source pointed to a non-source support placeholder and no unambiguous process-specific report/publication source was available; the reference is rewritten to the imported package's database-level fallback source."
          : "Converted process data source pointed to a non-source support placeholder; the bundle contains one unambiguous true source, so the reference is rewritten to that curated source row.";
      }

      const canonical = sourceReferenceFromSummary(targetSource, language);
      if (canonical) {
        const before = sourceReferenceSnapshot(value);
        const after = sourceReferenceSnapshot(canonical);
        if (
          before.ref_object_id !== after.ref_object_id ||
          before.version !== after.version ||
          before.short_description !== after.short_description
        ) {
          Object.keys(value).forEach((key) => {
            delete value[key];
          });
          Object.assign(value, cloneJson(canonical));
          const identity =
            datasetIdentityCache && datasetIdentityCache.id
              ? datasetIdentityCache
              : { id: null, version: null };
          if (rewriteRelation === "process_data_source_short_description") {
            stats.true_source_reference_description_repairs += 1;
          } else {
            stats.process_source_reference_rewrites =
              Number(stats.process_source_reference_rewrites ?? 0) + 1;
            if (rewriteRelation === "process_data_source_context_source") {
              stats.process_source_context_rewrites =
                Number(stats.process_source_context_rewrites ?? 0) + 1;
            }
            if (targetSource.fallback_database_source) {
              stats.process_source_reference_fallback_rewrites =
                Number(stats.process_source_reference_fallback_rewrites ?? 0) + 1;
            }
          }
          rewriteRows.push({
            dataset_type: "process",
            dataset_id: identity.id,
            dataset_version: identity.version,
            source_file: repoRelativeMaybe(sourceFile),
            path: pathExpression(pathSegments),
            relation: rewriteRelation,
            original: before,
            canonical: after,
            referenced_source_kind: referencedSource?.kind ?? null,
            replacement_source_kind: targetSource.kind ?? null,
            reason,
          });
        }
      }
    }

    for (const [key, child] of Object.entries(value)) {
      rewriteProcessDataSourceReferences(child, {
        sourceLookup,
        replacementSource,
        forceReplacementSource,
        replacementRelation,
        replacementReason,
        sourceFile,
        stats,
        rewriteRows,
        pathSegments: [...pathSegments, key],
        datasetIdentityCache,
        language,
      });
    }
  }

  function collectSourceReferences(value, pathSegments = [], refs = []) {
    if (!value || typeof value !== "object") return refs;
    if (Array.isArray(value)) {
      value.forEach((item, index) => collectSourceReferences(item, [...pathSegments, index], refs));
      return refs;
    }
    const refType = asText(value["@type"]).toLowerCase();
    const refObjectId = asText(value["@refObjectId"]);
    if (refObjectId && refType.includes("source")) {
      refs.push({
        path: pathExpression(pathSegments),
        relation: sourceReferenceKind(pathSegments),
        ref_object_id: refObjectId,
        version: asText(value["@version"]) || null,
        short_description: textValue(value["common:shortDescription"]) || null,
      });
    }
    for (const [key, child] of Object.entries(value)) {
      collectSourceReferences(child, [...pathSegments, key], refs);
    }
    return refs;
  }

  function processSourceReferenceRows(payload, sourceLookup, sourceFile) {
    if (!payload?.processDataSet) return [];
    const identity = datasetIdentity(payload, "process");
    return collectSourceReferences(payload.processDataSet).map((ref) => ({
      dataset_type: "process",
      dataset_id: identity.id,
      dataset_version: identity.version,
      source_file: repoRelativeMaybe(sourceFile),
      ...ref,
      referenced_source_kind: sourceLookup.get(ref.ref_object_id)?.kind ?? null,
      referenced_source_classification:
        sourceLookup.get(ref.ref_object_id)?.classification_path ?? null,
      referenced_source_citation: sourceLookup.get(ref.ref_object_id)?.source_citation ?? null,
    }));
  }

  function sourceReferenceSemanticBlockers(processSourceReferenceRows) {
    return processSourceReferenceRows
      .filter(
        (row) =>
          row.relation === "process_data_source" &&
          row.referenced_source_kind &&
          row.referenced_source_kind !== "true_source",
      )
      .map((row) => ({
        code: "process_data_source_not_true_source",
        message:
          "Process referenceToDataSource must point to a true report/publication/source row, not a format or compliance support source.",
        dataset_id: row.dataset_id,
        dataset_version: row.dataset_version,
        ref_object_id: row.ref_object_id,
        referenced_source_kind: row.referenced_source_kind,
        referenced_source_classification: row.referenced_source_classification,
        source_file: row.source_file,
        path: row.path,
      }));
  }

  return {
    buildBafuFallbackSourcePayload,
    buildDatabaseFallbackSourcePayload,
    buildBafuProcessContextSourcePayload,
    canonicalSourceReferenceForRelation,
    processSourceReferenceRows,
    processOriginalSourceMetadata,
    repairTrueSourceClassification,
    repairTrueSourceDescription,
    repairTrueSourceIdentity,
    rewriteCanonicalSourceReferences,
    rewriteProcessDataSourceReferences,
    rewriteTrueSourceReferenceDescriptions,
    sourceReferenceSemanticBlockers,
    sourceReferenceSnapshot,
    sourceSummaryMatchesOriginalMetadata,
    sourceSemanticSummary,
  };
}

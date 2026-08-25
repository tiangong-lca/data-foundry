import { normalizeTidasLanguageCode, tidasLanguageForText } from "./tidas-language-utils.ts";

export type TidasRowUtilsDependencies = {
  asText: (value: unknown) => string;
  bundleRowTypes: Record<string, { plural: string; rootKey: string; informationKey: string }>;
  cloneJson: <T>(value: T) => T;
  ensureArray: (value: unknown) => unknown[];
  writeText: (filePath: string, text: string) => unknown;
};

type UnknownRecord = Record<string, unknown>;

type ContactReference = UnknownRecord & {
  "@type"?: unknown;
  "@refObjectId"?: unknown;
  "@version"?: unknown;
  "@uri"?: unknown;
  "common:shortDescription"?: unknown;
};

type ContactRewriteStats = {
  rewritten: number;
  previous_ids: Set<string>;
  previous_descriptions: Set<string>;
};

type PlaceholderTextStats = {
  placeholder_text_replacements: number;
};

export function createTidasRowUtils({
  asText,
  bundleRowTypes,
  cloneJson,
  ensureArray,
  writeText,
}: TidasRowUtilsDependencies) {
  function datasetRowsFileStem(datasetType: unknown) {
    return (
      {
        contact: "contacts",
        flow: "flows",
        flowproperty: "flowproperties",
        lifecyclemodel: "lifecyclemodels",
        process: "processes",
        source: "sources",
        support: "support",
        unitgroup: "unitgroups",
      }[asText(datasetType).toLowerCase()] || `${datasetType}s`
    );
  }

  function multiLang(text: unknown, language: unknown = "en") {
    return {
      "@xml:lang": normalizeTidasLanguageCode(language),
      "#text": String(text ?? "").trim(),
    };
  }

  function containsCjk(text: unknown) {
    return /[\u3400-\u9fff\uf900-\ufaff]/u.test(String(text ?? ""));
  }

  function languageForText(text: unknown, fallback: unknown = "en") {
    const value = String(text ?? "").trim();
    if (!value) return normalizeTidasLanguageCode(fallback);
    return containsCjk(value) ? "zh" : tidasLanguageForText(value, fallback);
  }

  function preferredSourceLanguageText(values: unknown) {
    const texts = ensureArray(values).map(asText).filter(Boolean);
    return texts.find((text) => !containsCjk(text)) || texts[0] || "";
  }

  function contactGlobalReference({
    id,
    version,
    shortDescription,
    language = "en",
  }: {
    id: unknown;
    version: unknown;
    shortDescription: unknown;
    language?: unknown;
  }) {
    return {
      "@type": "contact data set",
      "@refObjectId": id,
      "@version": version,
      "@uri": `../contacts/${id}.json`,
      "common:shortDescription": multiLang(shortDescription, language),
    };
  }

  function datasetIdentity(payload: unknown, type: string) {
    const config = bundleRowTypes[type];
    if (!config || !payload || typeof payload !== "object" || Array.isArray(payload)) {
      return { id: null, version: null };
    }
    const payloadRecord = payload as UnknownRecord;
    const rootValue = payloadRecord[config.rootKey];
    const root = rootValue && typeof rootValue === "object" ? (rootValue as UnknownRecord) : {};
    const informationValue = root[config.informationKey];
    const information =
      informationValue && typeof informationValue === "object"
        ? (informationValue as UnknownRecord)
        : {};
    const dataSetInformationValue = information.dataSetInformation;
    const dataSetInformation =
      dataSetInformationValue && typeof dataSetInformationValue === "object"
        ? (dataSetInformationValue as UnknownRecord)
        : {};
    const administrativeInformationValue = root.administrativeInformation;
    const administrativeInformation =
      administrativeInformationValue && typeof administrativeInformationValue === "object"
        ? (administrativeInformationValue as UnknownRecord)
        : {};
    const publicationAndOwnershipValue = administrativeInformation.publicationAndOwnership;
    const publicationAndOwnership =
      publicationAndOwnershipValue && typeof publicationAndOwnershipValue === "object"
        ? (publicationAndOwnershipValue as UnknownRecord)
        : {};
    return {
      id: asText(dataSetInformation["common:UUID"]) || null,
      version: asText(publicationAndOwnership["common:dataSetVersion"]) || null,
    };
  }

  function contactDescriptionText(reference: unknown) {
    const description = (reference as ContactReference | null | undefined)?.[
      "common:shortDescription"
    ];
    if (typeof description === "string") return description;
    if (description && typeof description === "object" && !Array.isArray(description)) {
      const descriptionRecord = description as UnknownRecord;
      return asText(descriptionRecord["#text"]) || asText(descriptionRecord.value);
    }
    return "";
  }

  function rewriteContactReferences(
    value: unknown,
    contactRef: ContactReference,
    stats: ContactRewriteStats,
  ): void {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      for (const item of value) rewriteContactReferences(item, contactRef, stats);
      return;
    }

    const valueRecord = value as UnknownRecord;
    const refType = asText(valueRecord["@type"]).toLowerCase();
    const refObjectId = asText(valueRecord["@refObjectId"]);
    if (refObjectId && refType.includes("contact")) {
      stats.rewritten += 1;
      stats.previous_ids.add(refObjectId);
      const previousDescription = contactDescriptionText(value);
      if (previousDescription) stats.previous_descriptions.add(previousDescription);
      valueRecord["@type"] = contactRef["@type"];
      valueRecord["@refObjectId"] = contactRef["@refObjectId"];
      valueRecord["@version"] = contactRef["@version"];
      valueRecord["@uri"] = contactRef["@uri"];
      valueRecord["common:shortDescription"] = cloneJson(contactRef["common:shortDescription"]);
    }

    for (const child of Object.values(valueRecord)) {
      rewriteContactReferences(child, contactRef, stats);
    }
  }

  function isObjectEmpty(value: unknown) {
    return (
      value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === 0
    );
  }

  function pathExpression(pathSegments: unknown[]) {
    return pathSegments.map(String).join(".");
  }

  function cleanEcoSpoldNameText(text: unknown) {
    return String(text ?? "")
      .replace(/^\s*x+\s+/iu, "")
      .replace(/\s*\{[A-Za-z][A-Za-z0-9_-]*\}/gu, "")
      .replace(/\s{2,}/gu, " ")
      .trim();
  }

  function sanitizePlaceholderText(
    text: unknown,
    pathSegments: unknown[],
    stats: PlaceholderTextStats,
  ) {
    const original = String(text ?? "");
    let next = original;
    if (/^\s*0\s+Not declared in source package\s*$/iu.test(next)) {
      next = "Not specified";
    }
    if (
      next.trim().toLowerCase().includes("not declared in source package") ||
      next.trim().toLowerCase().includes("source package metadata not declared") ||
      next.trim() === "<null>" ||
      next.trim() === "Not specified by the BAFU ecoSpold1 source."
    ) {
      next = "Not specified";
    }
    if (pathSegments.includes("baseName") || pathSegments.includes("common:shortDescription")) {
      next = cleanEcoSpoldNameText(next);
    }
    if (next !== original) {
      stats.placeholder_text_replacements += 1;
    }
    return next;
  }

  function bundleClassificationEntries(payload: unknown, type: string) {
    const config = bundleRowTypes[type];
    const payloadRecord = payload as UnknownRecord | null | undefined;
    const root = payloadRecord?.[config?.rootKey] as UnknownRecord | undefined;
    const information = root?.[config?.informationKey] as UnknownRecord | undefined;
    const dataSetInformation = information?.dataSetInformation as UnknownRecord | undefined;
    const classificationInformation = dataSetInformation?.classificationInformation as
      UnknownRecord | undefined;
    const classification = classificationInformation?.["common:classification"] as
      UnknownRecord | undefined;
    const classes = classification?.["common:class"];
    return ensureArray(classes)
      .filter((item): item is UnknownRecord =>
        Boolean(item && typeof item === "object" && !Array.isArray(item)),
      )
      .map((item) => ({
        level: asText(item["@level"]),
        class_id: asText(item["@classId"]),
        text: asText(item["#text"]),
      }))
      .filter((item) => item.text);
  }

  function bundleClassificationPath(payload: unknown, type: string) {
    return bundleClassificationEntries(payload, type)
      .map((entry) => entry.text)
      .join(" > ");
  }

  function isConvertedDefaultClassification(classificationPath: string) {
    return /Other service activities\s*>\s*Activities of membership organizations\s*>\s*Activities of other membership organizations\s*>\s*Activities of other membership organizations n\.e\.c\.|Community,\s*social and personal services\s*>\s*Sewage and waste collection,\s*treatment and disposal and other environmental protection services\s*>\s*Other environmental protection services n\.e\.c\./iu.test(
      classificationPath,
    );
  }

  function flowTypeOfDataSet(payload: unknown) {
    const payloadRecord = payload as UnknownRecord | null | undefined;
    const flowDataSet = payloadRecord?.flowDataSet as UnknownRecord | undefined;
    const modellingAndValidation = flowDataSet?.modellingAndValidation as UnknownRecord | undefined;
    const lciMethod = modellingAndValidation?.LCIMethod as UnknownRecord | undefined;
    const flowInformation = flowDataSet?.flowInformation as UnknownRecord | undefined;
    const dataSetInformation = flowInformation?.dataSetInformation as UnknownRecord | undefined;
    return asText(lciMethod?.typeOfDataSet ?? dataSetInformation?.typeOfDataSet);
  }

  function flowClassificationSchemaType(payload: unknown) {
    return /^elementary flow$/iu.test(flowTypeOfDataSet(payload))
      ? "flow-elementary"
      : "flow-product";
  }

  function textValue(value: unknown): string {
    if (typeof value === "string") return value.trim();
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const valueRecord = value as UnknownRecord;
      return asText(valueRecord["#text"]) || asText(valueRecord.value);
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        const text = textValue(item);
        if (text) return text;
      }
    }
    return "";
  }

  function writeJsonLines(filePath: string, rows: unknown[]) {
    writeText(
      filePath,
      rows.map((row) => JSON.stringify(row)).join("\n") + (rows.length ? "\n" : ""),
    );
  }

  function printJson(value: unknown) {
    console.log(JSON.stringify(value, null, 2));
  }

  return {
    bundleClassificationPath,
    cleanEcoSpoldNameText,
    contactGlobalReference,
    datasetIdentity,
    datasetRowsFileStem,
    flowClassificationSchemaType,
    flowTypeOfDataSet,
    isConvertedDefaultClassification,
    isObjectEmpty,
    languageForText,
    multiLang,
    normalizeTidasLanguageCode,
    pathExpression,
    preferredSourceLanguageText,
    printJson,
    rewriteContactReferences,
    sanitizePlaceholderText,
    textValue,
    writeJsonLines,
  };
}

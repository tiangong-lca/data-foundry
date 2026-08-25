import { normalizeTidasLanguageCode, tidasLanguageForText } from "./tidas-language-utils.ts";

export function createTidasRowUtils({ asText, bundleRowTypes, cloneJson, ensureArray, writeText }) {
  function datasetRowsFileStem(datasetType) {
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

  function multiLang(text, language = "en") {
    return {
      "@xml:lang": normalizeTidasLanguageCode(language),
      "#text": String(text ?? "").trim(),
    };
  }

  function containsCjk(text) {
    return /[\u3400-\u9fff\uf900-\ufaff]/u.test(String(text ?? ""));
  }

  function languageForText(text, fallback = "en") {
    const value = String(text ?? "").trim();
    if (!value) return normalizeTidasLanguageCode(fallback);
    return containsCjk(value) ? "zh" : tidasLanguageForText(value, fallback);
  }

  function preferredSourceLanguageText(values) {
    const texts = ensureArray(values).map(asText).filter(Boolean);
    return texts.find((text) => !containsCjk(text)) || texts[0] || "";
  }

  function contactGlobalReference({ id, version, shortDescription, language = "en" }) {
    return {
      "@type": "contact data set",
      "@refObjectId": id,
      "@version": version,
      "@uri": `../contacts/${id}.json`,
      "common:shortDescription": multiLang(shortDescription, language),
    };
  }

  function datasetIdentity(payload, type) {
    const config = bundleRowTypes[type];
    if (!config || !payload || typeof payload !== "object" || Array.isArray(payload)) {
      return { id: null, version: null };
    }
    const root =
      payload[config.rootKey] && typeof payload[config.rootKey] === "object"
        ? payload[config.rootKey]
        : {};
    const information =
      root[config.informationKey] && typeof root[config.informationKey] === "object"
        ? root[config.informationKey]
        : {};
    const dataSetInformation =
      information.dataSetInformation && typeof information.dataSetInformation === "object"
        ? information.dataSetInformation
        : {};
    const administrativeInformation =
      root.administrativeInformation && typeof root.administrativeInformation === "object"
        ? root.administrativeInformation
        : {};
    const publicationAndOwnership =
      administrativeInformation.publicationAndOwnership &&
      typeof administrativeInformation.publicationAndOwnership === "object"
        ? administrativeInformation.publicationAndOwnership
        : {};
    return {
      id: asText(dataSetInformation["common:UUID"]) || null,
      version: asText(publicationAndOwnership["common:dataSetVersion"]) || null,
    };
  }

  function contactDescriptionText(reference) {
    const description = reference?.["common:shortDescription"];
    if (typeof description === "string") return description;
    if (description && typeof description === "object" && !Array.isArray(description)) {
      return asText(description["#text"]) || asText(description.value);
    }
    return "";
  }

  function rewriteContactReferences(value, contactRef, stats) {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      for (const item of value) rewriteContactReferences(item, contactRef, stats);
      return;
    }

    const refType = asText(value["@type"]).toLowerCase();
    const refObjectId = asText(value["@refObjectId"]);
    if (refObjectId && refType.includes("contact")) {
      stats.rewritten += 1;
      stats.previous_ids.add(refObjectId);
      const previousDescription = contactDescriptionText(value);
      if (previousDescription) stats.previous_descriptions.add(previousDescription);
      value["@type"] = contactRef["@type"];
      value["@refObjectId"] = contactRef["@refObjectId"];
      value["@version"] = contactRef["@version"];
      value["@uri"] = contactRef["@uri"];
      value["common:shortDescription"] = cloneJson(contactRef["common:shortDescription"]);
    }

    for (const child of Object.values(value)) {
      rewriteContactReferences(child, contactRef, stats);
    }
  }

  function isObjectEmpty(value) {
    return (
      value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === 0
    );
  }

  function pathExpression(pathSegments) {
    return pathSegments.map(String).join(".");
  }

  function cleanEcoSpoldNameText(text) {
    return String(text ?? "")
      .replace(/^\s*x+\s+/iu, "")
      .replace(/\s*\{[A-Za-z][A-Za-z0-9_-]*\}/gu, "")
      .replace(/\s{2,}/gu, " ")
      .trim();
  }

  function sanitizePlaceholderText(text, pathSegments, stats) {
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

  function bundleClassificationEntries(payload, type) {
    const config = bundleRowTypes[type];
    const root = payload?.[config?.rootKey];
    const information = root?.[config?.informationKey];
    const dataSetInformation = information?.dataSetInformation;
    const classes =
      dataSetInformation?.classificationInformation?.["common:classification"]?.["common:class"];
    return ensureArray(classes)
      .filter((item) => item && typeof item === "object")
      .map((item) => ({
        level: asText(item["@level"]),
        class_id: asText(item["@classId"]),
        text: asText(item["#text"]),
      }))
      .filter((item) => item.text);
  }

  function bundleClassificationPath(payload, type) {
    return bundleClassificationEntries(payload, type)
      .map((entry) => entry.text)
      .join(" > ");
  }

  function isConvertedDefaultClassification(classificationPath) {
    return /Other service activities\s*>\s*Activities of membership organizations\s*>\s*Activities of other membership organizations\s*>\s*Activities of other membership organizations n\.e\.c\.|Community,\s*social and personal services\s*>\s*Sewage and waste collection,\s*treatment and disposal and other environmental protection services\s*>\s*Other environmental protection services n\.e\.c\./iu.test(
      classificationPath,
    );
  }

  function flowTypeOfDataSet(payload) {
    return asText(
      payload?.flowDataSet?.modellingAndValidation?.LCIMethod?.typeOfDataSet ??
        payload?.flowDataSet?.flowInformation?.dataSetInformation?.typeOfDataSet,
    );
  }

  function flowClassificationSchemaType(payload) {
    return /^elementary flow$/iu.test(flowTypeOfDataSet(payload))
      ? "flow-elementary"
      : "flow-product";
  }

  function textValue(value) {
    if (typeof value === "string") return value.trim();
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return asText(value["#text"]) || asText(value.value);
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        const text = textValue(item);
        if (text) return text;
      }
    }
    return "";
  }

  function writeJsonLines(filePath, rows) {
    writeText(
      filePath,
      rows.map((row) => JSON.stringify(row)).join("\n") + (rows.length ? "\n" : ""),
    );
  }

  function printJson(value) {
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

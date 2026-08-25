import assert from "node:assert/strict";
import test from "node:test";

import { createSourceSemanticUtils } from "../../scripts/lib/source-semantics.mjs";

function asText(value: any): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value).trim();
  }
  if (Array.isArray(value)) return value.map(asText).filter(Boolean).join("; ");
  if (typeof value === "object") return asText(value["#text"] ?? value.value ?? value.id);
  return "";
}

function classificationPath(payload: any, type: string): string {
  const information =
    type === "source" ? payload?.sourceDataSet?.sourceInformation?.dataSetInformation : null;
  const classes =
    information?.classificationInformation?.["common:classification"]?.["common:class"];
  const list = Array.isArray(classes) ? classes : classes ? [classes] : [];
  return list
    .map((entry) => asText(entry?.["#text"] ?? entry))
    .filter(Boolean)
    .join(" > ");
}

function datasetIdentity(payload: any, type: string) {
  const root =
    type === "process"
      ? payload?.processDataSet?.processInformation?.dataSetInformation
      : payload?.sourceDataSet?.sourceInformation?.dataSetInformation;
  return {
    id: asText(root?.["common:UUID"]) || null,
    version:
      asText(
        (type === "process" ? payload?.processDataSet : payload?.sourceDataSet)
          ?.administrativeInformation?.publicationAndOwnership?.["common:dataSetVersion"],
      ) || "00.00.001",
  };
}

function createUtils(): any {
  return createSourceSemanticUtils({
    asText,
    bundleClassificationPath: classificationPath,
    cloneJson: <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T,
    datasetIdentity,
    deterministicUuid: (seed: string) => `uuid:${seed}`,
    languageForText: () => "en",
    multiLang: (text: unknown, language = "en") => ({
      "@xml:lang": language,
      "#text": String(text ?? "").trim(),
    }),
    pathExpression: (parts: Array<string | number>) => parts.join("."),
    repoRelativeMaybe: (value: unknown) => value,
    textValue: asText,
  });
}

function sourcePayload({
  id = "source-id",
  shortName = "Source",
  citation = null,
  description = null,
  classification = null,
}: {
  id?: string;
  shortName?: string;
  citation?: string | null;
  description?: string | null;
  classification?: string | null;
} = {}) {
  return {
    sourceDataSet: {
      sourceInformation: {
        dataSetInformation: {
          "common:UUID": id,
          "common:shortName": { "#text": shortName },
          ...(citation ? { sourceCitation: citation } : {}),
          ...(description ? { sourceDescriptionOrComment: description } : {}),
          ...(classification
            ? {
                classificationInformation: {
                  "common:classification": {
                    "common:class": { "#text": classification },
                  },
                },
              }
            : {}),
        },
      },
      administrativeInformation: {
        publicationAndOwnership: { "common:dataSetVersion": "01.00.000" },
      },
    },
  };
}

test("source semantic factory preserves its complete helper surface", () => {
  assert.deepEqual(Object.keys(createUtils()).sort(), [
    "buildBafuFallbackSourcePayload",
    "buildBafuProcessContextSourcePayload",
    "buildDatabaseFallbackSourcePayload",
    "canonicalSourceReferenceForRelation",
    "processOriginalSourceMetadata",
    "processSourceReferenceRows",
    "repairTrueSourceClassification",
    "repairTrueSourceDescription",
    "repairTrueSourceIdentity",
    "rewriteCanonicalSourceReferences",
    "rewriteProcessDataSourceReferences",
    "rewriteTrueSourceReferenceDescriptions",
    "sourceReferenceSemanticBlockers",
    "sourceReferenceSnapshot",
    "sourceSemanticSummary",
    "sourceSummaryMatchesOriginalMetadata",
  ]);
});

test("profile-aware source kinds preserve canonical identity, classification, placeholder, true, and unresolved defaults", () => {
  const utils = createUtils();
  assert.equal(
    utils.sourceSemanticSummary(
      sourcePayload({ classification: "Data set formats" }),
      "source.json",
    ).kind,
    "format_support_source",
  );
  assert.equal(
    utils.sourceSemanticSummary(
      sourcePayload({ classification: "Compliance systems" }),
      "source.json",
    ).kind,
    "compliance_support_source",
  );
  assert.equal(
    utils.sourceSemanticSummary(sourcePayload({ shortName: "Not specified" }), "source.json").kind,
    "placeholder_or_unspecified_source",
  );
  assert.equal(
    utils.sourceSemanticSummary(sourcePayload({ citation: "Author (2025) Report" }), "source.json")
      .kind,
    "true_source",
  );
  assert.equal(
    utils.sourceSemanticSummary(
      sourcePayload({
        shortName: "Created for EcoSpold 1 compatibility",
        description: "Original title: Exact report\\nYear: 2024\\nFirst author: Example, A.",
      }),
      "source.json",
    ).kind,
    "true_source",
  );
  assert.equal(
    utils.sourceSemanticSummary(
      sourcePayload({ shortName: "Created for EcoSpold 1 compatibility" }),
      "source.json",
    ).kind,
    "unresolved_source_semantics",
  );
  assert.equal(
    utils.sourceSemanticSummary(sourcePayload({ shortName: "Unknown" }), "source.json").kind,
    "unresolved_source_semantics",
  );
  assert.equal(
    utils.sourceSemanticSummary(
      sourcePayload({
        id: "a97a0155-0234-4b87-b4ce-a45da52f2a40",
        classification: "Publications and communications",
        citation: "ILCD publication",
      }),
      "source.json",
    ).kind,
    "format_support_source",
  );
});

test("canonical source references preserve exact ids, versions, clone isolation, and unknown relation", () => {
  const utils = createUtils();
  const format = utils.canonicalSourceReferenceForRelation("dataset_format_source");
  const compliance = utils.canonicalSourceReferenceForRelation("compliance_system_source");
  assert.deepEqual(format, {
    "@type": "source data set",
    "@refObjectId": "a97a0155-0234-4b87-b4ce-a45da52f2a40",
    "@version": "03.00.003",
    "@uri": "../sources/a97a0155-0234-4b87-b4ce-a45da52f2a40_03.00.003.xml",
    "common:shortDescription": { "@xml:lang": "en", "#text": "ILCD format" },
  });
  assert.equal(compliance["@refObjectId"], "d92a1a12-2545-49e2-a585-55c259997756");
  assert.equal(compliance["@version"], "20.20.002");
  assert.equal(utils.canonicalSourceReferenceForRelation("unknown"), null);
  format["@version"] = "mutated";
  assert.equal(
    utils.canonicalSourceReferenceForRelation("dataset_format_source")["@version"],
    "03.00.003",
  );
});

test("database fallback profiles preserve ids, citations, URIs, defaults, contact clone, and timestamp", () => {
  const utils = createUtils();
  const contact = { "@refObjectId": "contact-id", nested: { value: 1 } };
  const bafu = utils.buildDatabaseFallbackSourcePayload({
    profile: "unknown-profile",
    contactReference: contact,
    timestamp: "2025-01-01T00:00:00.000Z",
  });
  const bafuInfo = bafu.sourceDataSet.sourceInformation.dataSetInformation;
  assert.equal(bafuInfo["common:shortName"]["#text"], "BAFU 2025 Version 2 LCA database");
  assert.match(bafuInfo.sourceCitation, /BAFU/u);
  assert.match(
    bafu.sourceDataSet.administrativeInformation.publicationAndOwnership[
      "common:permanentDataSetURI"
    ],
    /bafu-2025-v2/u,
  );
  assert.equal(
    bafu.sourceDataSet.administrativeInformation.dataEntryBy["common:timeStamp"],
    "2025-01-01T00:00:00.000Z",
  );
  assert.notStrictEqual(
    bafu.sourceDataSet.administrativeInformation.publicationAndOwnership[
      "common:referenceToOwnershipOfDataSet"
    ],
    contact,
  );
  const uslci = utils.buildDatabaseFallbackSourcePayload({ profile: " USLCI " });
  const worldsteel = utils.buildDatabaseFallbackSourcePayload({ profile: "WORLDSTEEL" });
  assert.match(
    uslci.sourceDataSet.administrativeInformation.publicationAndOwnership[
      "common:permanentDataSetURI"
    ],
    /lcacommons\.gov\/uslci/u,
  );
  assert.match(
    worldsteel.sourceDataSet.administrativeInformation.publicationAndOwnership[
      "common:permanentDataSetURI"
    ],
    /worldsteel\.org\/lci/u,
  );
  assert.deepEqual(
    utils.buildBafuFallbackSourcePayload({}),
    utils.buildDatabaseFallbackSourcePayload({ profile: "bafu" }),
  );
});

test("process-context sources and source snapshots preserve invalids and exact reference facts", () => {
  const utils = createUtils();
  assert.equal(utils.buildBafuProcessContextSourcePayload({}), null);
  const payload = utils.buildBafuProcessContextSourcePayload({
    metadata: {
      shortName: "2024 - Report - Author",
      citation: "Author (2024) Report",
      description: "Description",
      doi: "10.1000/example",
    },
    id: "source-id",
    version: "02.00.000",
    language: "de",
  });
  assert.equal(
    payload.sourceDataSet.sourceInformation.dataSetInformation["common:UUID"],
    "source-id",
  );
  assert.equal(
    payload.sourceDataSet.sourceInformation.dataSetInformation["common:shortName"]["@xml:lang"],
    "de",
  );
  assert.deepEqual(
    utils.sourceReferenceSnapshot({
      "@refObjectId": " id ",
      "@version": " 01.00.000 ",
      "@uri": " uri ",
      "common:shortDescription": { "#text": " Name " },
    }),
    {
      ref_object_id: "id",
      version: "01.00.000",
      uri: "uri",
      short_description: "Name",
    },
  );
  assert.deepEqual(utils.sourceReferenceSnapshot(null), {
    ref_object_id: null,
    version: null,
    uri: null,
    short_description: null,
  });
});

test("process source rows preserve path order and semantic blockers only for non-true data sources", () => {
  const utils = createUtils();
  const payload = {
    processDataSet: {
      processInformation: { dataSetInformation: { "common:UUID": "process-id" } },
      modellingAndValidation: {
        dataSourcesTreatmentAndRepresentativeness: {
          referenceToDataSource: {
            "@type": "source data set",
            "@refObjectId": "format-id",
            "@version": "01.00.000",
            "common:shortDescription": { "#text": "Format" },
          },
        },
      },
      administrativeInformation: {
        dataEntryBy: {
          "common:referenceToDataSetFormat": {
            "@type": "source data set",
            "@refObjectId": "canonical-format",
          },
        },
      },
    },
  };
  const lookup = new Map([
    [
      "format-id",
      {
        kind: "format_support_source",
        classification_path: "Data set formats",
        source_citation: null,
      },
    ],
  ]);
  const rows = utils.processSourceReferenceRows(payload, lookup, "process.json");
  assert.deepEqual(
    rows.map((row: any) => [row.relation, row.ref_object_id]),
    [
      ["process_data_source", "format-id"],
      ["dataset_format_source", "canonical-format"],
    ],
  );
  assert.deepEqual(utils.sourceReferenceSemanticBlockers(rows), [
    {
      code: "process_data_source_not_true_source",
      message:
        "Process referenceToDataSource must point to a true report/publication/source row, not a format or compliance support source.",
      dataset_id: "process-id",
      dataset_version: "00.00.001",
      ref_object_id: "format-id",
      referenced_source_kind: "format_support_source",
      referenced_source_classification: "Data set formats",
      source_file: "process.json",
      path: "modellingAndValidation.dataSourcesTreatmentAndRepresentativeness.referenceToDataSource",
    },
  ]);
  rows[0].referenced_source_kind = "true_source";
  assert.deepEqual(utils.sourceReferenceSemanticBlockers(rows), []);
  assert.deepEqual(utils.processSourceReferenceRows({}, lookup, "process.json"), []);
});

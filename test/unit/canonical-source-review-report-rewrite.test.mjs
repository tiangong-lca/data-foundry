import test from "node:test";
import { createSourceSemanticUtils } from "../../scripts/lib/source-semantics.ts";
import { assert } from "../fixtures/foundry-core.ts";

// Minimal-but-faithful dependency injection for the source-semantics factory. These match
// the runtime utilities foundry.mjs wires in (asText/textValue/multiLang/pathExpression/
// datasetIdentity/bundleClassificationPath) closely enough to exercise the real
// rewriteCanonicalSourceReferences + sourceSemanticKind logic.
function asText(value) {
  if (value === undefined || value === null) return "";
  if (typeof value === "string" || typeof value === "number") return String(value).trim();
  if (Array.isArray(value)) return asText(value[0]);
  if (typeof value === "object") return asText(value["#text"] ?? value.value ?? "");
  return "";
}

function textValue(value) {
  return asText(value);
}

function bundleClassificationPath(payload, type) {
  const dataSetInformation =
    type === "source" ? payload?.sourceDataSet?.sourceInformation?.dataSetInformation : null;
  const classes =
    dataSetInformation?.classificationInformation?.["common:classification"]?.["common:class"];
  const list = Array.isArray(classes) ? classes : classes ? [classes] : [];
  return list
    .map((entry) => asText(entry?.["#text"] ?? entry))
    .filter(Boolean)
    .join(" / ");
}

function datasetIdentity(payload, type) {
  if (type === "source" || payload?.sourceDataSet) {
    const ds = payload?.sourceDataSet?.sourceInformation?.dataSetInformation ?? {};
    return { id: asText(ds["common:UUID"]) || null, version: "00.00.001" };
  }
  if (type === "process" || payload?.processDataSet) {
    const ds = payload?.processDataSet?.processInformation?.dataSetInformation ?? {};
    return { id: asText(ds["common:UUID"]) || null, version: "00.00.001" };
  }
  return { id: null, version: "00.00.001" };
}

function makeUtils() {
  return createSourceSemanticUtils({
    asText,
    bundleClassificationPath,
    cloneJson: (value) => JSON.parse(JSON.stringify(value)),
    datasetIdentity,
    deterministicUuid: (seed) => `det-${seed}`,
    languageForText: () => "en",
    multiLang: (text, lang = "en") => ({ "@xml:lang": lang, "#text": text }),
    pathExpression: (parts) => parts.join("."),
    repoRelativeMaybe: (value) => value,
    textValue,
  });
}

const FORMAT_SOURCE_ID = "16938856-0a35-5654-8aff-56c17e61da4d";
const CANONICAL_FORMAT_ID = "a97a0155-0234-4b87-b4ce-a45da52f2a40";
const CANONICAL_FORMAT_VERSION = "03.00.003";
const TRUE_SOURCE_ID = "94b3d910-206d-4478-9d5c-841ce336043b";

function formatSupportSourcePayload() {
  return {
    sourceDataSet: {
      sourceInformation: {
        dataSetInformation: {
          "common:UUID": FORMAT_SOURCE_ID,
          "common:shortName": { "@xml:lang": "en", "#text": "ILCD format" },
          classificationInformation: {
            "common:classification": {
              "common:class": { "@level": "0", "@classId": "0", "#text": "Data set formats" },
            },
          },
        },
      },
    },
  };
}

// A process whose validation/review references the format support source via
// common:referenceToCompleteReviewReport — exactly the CLASS 2 failing shape.
function processWithReviewReportReference(sourceId) {
  return {
    processDataSet: {
      processInformation: {
        dataSetInformation: { "common:UUID": "0247a4ba-9f1d-427f-b003-2718472154da" },
      },
      modellingAndValidation: {
        validation: {
          review: {
            "common:referenceToCompleteReviewReport": {
              "@type": "source data set",
              "@refObjectId": sourceId,
              "@version": "00.00.001",
              "@uri": `../sources/${sourceId}_00.00.001.xml`,
              "common:shortDescription": { "@xml:lang": "en", "#text": "ILCD format" },
            },
          },
        },
      },
    },
  };
}

function reviewReportReference(payload) {
  return payload.processDataSet.modellingAndValidation.validation.review[
    "common:referenceToCompleteReviewReport"
  ];
}

// CLASS 2: a format support source referenced on the review-report path is rewritten to the
// public canonical source when a sourceLookup is supplied (USLCI override on).
test("review-report format source is rewritten to canonical when sourceLookup is supplied", () => {
  const utils = makeUtils();
  const summary = utils.sourceSemanticSummary(formatSupportSourcePayload(), "support.jsonl");
  assert.equal(summary.kind, "format_support_source");
  const sourceLookup = new Map([[summary.dataset_id, summary]]);

  const payload = processWithReviewReportReference(FORMAT_SOURCE_ID);
  const stats = { source_reference_rewrites: 0 };
  const rewriteRows = [];
  utils.rewriteCanonicalSourceReferences(payload, {
    datasetType: "process",
    sourceFile: "processes.jsonl",
    stats,
    rewriteRows,
    datasetIdentityCache: datasetIdentity(payload, "process"),
    sourceLookup,
  });

  const ref = reviewReportReference(payload);
  assert.equal(
    ref["@refObjectId"],
    CANONICAL_FORMAT_ID,
    "rewritten to public canonical ILCD format source",
  );
  assert.equal(ref["@version"], CANONICAL_FORMAT_VERSION, "uses the canonical published version");
  assert.equal(stats.source_reference_rewrites, 1);
  assert.equal(rewriteRows.length, 1);
  assert.equal(rewriteRows[0].relation, "format_support_source");
});

// BAFU path: no sourceLookup => the review-report reference is left byte-identical (the gate).
test("review-report format source is left unchanged when no sourceLookup is supplied", () => {
  const utils = makeUtils();
  const payload = processWithReviewReportReference(FORMAT_SOURCE_ID);
  const before = JSON.stringify(payload);
  const stats = { source_reference_rewrites: 0 };
  const rewriteRows = [];
  utils.rewriteCanonicalSourceReferences(payload, {
    datasetType: "process",
    sourceFile: "processes.jsonl",
    stats,
    rewriteRows,
    datasetIdentityCache: datasetIdentity(payload, "process"),
    // sourceLookup omitted == null (BAFU passes null)
  });
  assert.equal(JSON.stringify(payload), before, "payload is byte-identical without the lookup");
  assert.equal(stats.source_reference_rewrites, 0);
  assert.equal(rewriteRows.length, 0);
});

// USLCI mega regression: the public canonical ILCD-format source (a97a0155) shipped by a
// package with a NON-format classification ("Publications and communications") + a real
// citation is still recognized as format_support_source BY UUID — so it is reused
// (referenced at the canonical version) instead of minted at the package version (which
// would trip the source-identity prewrite gate and version_outdated the canonical).
function canonicalFormatSourceWithPublicationClassification(uuid = CANONICAL_FORMAT_ID) {
  return {
    sourceDataSet: {
      sourceInformation: {
        dataSetInformation: {
          "common:UUID": uuid,
          "common:shortName": { "@xml:lang": "en", "#text": "ILCD format" },
          sourceCitation:
            "European Commission, Joint Research Centre (2009): International Reference Life Cycle Data System (ILCD) data set format.",
          classificationInformation: {
            "common:classification": {
              "common:class": {
                "@level": "0",
                "@classId": "0",
                "#text": "Publications and communications",
              },
            },
          },
        },
      },
    },
  };
}

test("canonical ILCD-format source is recognized as format support BY UUID despite a publication classification", () => {
  const utils = makeUtils();
  const summary = utils.sourceSemanticSummary(
    canonicalFormatSourceWithPublicationClassification(),
    "support.jsonl",
  );
  assert.equal(
    summary.kind,
    "format_support_source",
    "the canonical UUID overrides the converted publication classification",
  );

  // UUID-specificity (BAFU-safe): an identical payload at a NON-canonical UUID is NOT
  // forced to format support — it falls through to the citation-based true_source path.
  const nonCanonical = utils.sourceSemanticSummary(
    canonicalFormatSourceWithPublicationClassification(TRUE_SOURCE_ID),
    "support.jsonl",
  );
  assert.notEqual(
    nonCanonical.kind,
    "format_support_source",
    "only the known canonical support UUIDs get the override",
  );
});

// End-to-end: a process listing the canonical ILCD-format source under referenceToDataSource
// (the USLCI mega blocker shape) is rewritten to the canonical @03.00.003 rather than left at
// the package's @00.00.001 — driven entirely by the UUID-based kind recognition above.
test("canonical format source on a referenceToDataSource slot is rewritten to canonical", () => {
  const utils = makeUtils();
  const summary = utils.sourceSemanticSummary(
    canonicalFormatSourceWithPublicationClassification(),
    "support.jsonl",
  );
  const sourceLookup = new Map([[summary.dataset_id, summary]]);
  const payload = {
    processDataSet: {
      processInformation: {
        dataSetInformation: { "common:UUID": "0247a4ba-9f1d-427f-b003-2718472154da" },
      },
      modellingAndValidation: {
        dataSourcesTreatmentAndRepresentativeness: {
          referenceToDataSource: {
            "@type": "source data set",
            "@refObjectId": CANONICAL_FORMAT_ID,
            "@version": "00.00.001",
            "@uri": `../sources/${CANONICAL_FORMAT_ID}_00.00.001.xml`,
            "common:shortDescription": { "@xml:lang": "en", "#text": "ILCD format" },
          },
        },
      },
    },
  };
  const stats = { source_reference_rewrites: 0 };
  const rewriteRows = [];
  utils.rewriteCanonicalSourceReferences(payload, {
    datasetType: "process",
    sourceFile: "processes.jsonl",
    stats,
    rewriteRows,
    datasetIdentityCache: datasetIdentity(payload, "process"),
    sourceLookup,
  });
  const ref =
    payload.processDataSet.modellingAndValidation.dataSourcesTreatmentAndRepresentativeness
      .referenceToDataSource;
  assert.equal(ref["@refObjectId"], CANONICAL_FORMAT_ID);
  assert.equal(ref["@version"], CANONICAL_FORMAT_VERSION, "package @00.00.001 lifted to canonical");
  assert.equal(stats.source_reference_rewrites, 1);
  assert.equal(rewriteRows[0].relation, "format_support_source");
});

// A true source on the review-report path is NEVER rewritten — only format/compliance
// support kinds have a kind-based canonical target.
test("review-report true source is never rewritten by the kind-based canonical mapping", () => {
  const utils = makeUtils();
  const trueSourceSummary = {
    dataset_id: TRUE_SOURCE_ID,
    dataset_version: "00.00.001",
    kind: "true_source",
  };
  const sourceLookup = new Map([[TRUE_SOURCE_ID, trueSourceSummary]]);
  const payload = processWithReviewReportReference(TRUE_SOURCE_ID);
  const before = JSON.stringify(payload);
  const stats = { source_reference_rewrites: 0 };
  const rewriteRows = [];
  utils.rewriteCanonicalSourceReferences(payload, {
    datasetType: "process",
    sourceFile: "processes.jsonl",
    stats,
    rewriteRows,
    datasetIdentityCache: datasetIdentity(payload, "process"),
    sourceLookup,
  });
  assert.equal(JSON.stringify(payload), before, "true source review-report reference is untouched");
  assert.equal(stats.source_reference_rewrites, 0);
});

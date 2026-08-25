import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import * as cleanup from "../../scripts/lib/import-curation/internal/prewrite-cleanup.ts";

type JsonObject = Record<string, any>;

function sha256Text(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function processRow({
  id = "process-1",
  version = "00.00.001",
  exchanges = [],
  annualSupply,
  commonOther,
}: {
  id?: string;
  version?: string;
  exchanges?: JsonObject[];
  annualSupply?: unknown;
  commonOther?: JsonObject;
} = {}): JsonObject {
  const dataSetInformation: JsonObject = { "common:UUID": id };
  if (commonOther !== undefined) dataSetInformation["common:other"] = commonOther;
  const dataSources: JsonObject = {};
  if (annualSupply !== undefined) {
    dataSources.annualSupplyOrProductionVolume = annualSupply;
  }
  return {
    processDataSet: {
      processInformation: { dataSetInformation },
      modellingAndValidation: {
        dataSourcesTreatmentAndRepresentativeness: dataSources,
      },
      exchanges: { exchange: exchanges },
      administrativeInformation: {
        publicationAndOwnership: { "common:dataSetVersion": version },
      },
    },
  };
}

function outputExchange(amount: string, flowId: string, extra: JsonObject = {}): JsonObject {
  return {
    exchangeDirection: "Output",
    meanAmount: amount,
    referenceToFlowDataSet: { "@refObjectId": flowId, "@version": "00.00.001" },
    ...extra,
  };
}

test("datetime normalization preserves accepted syntax, exact UTC bytes, recursion order, arrays, and invalids", () => {
  assert.equal(cleanup.normalizeUtcDateTimeString(null), null);
  assert.equal(cleanup.normalizeUtcDateTimeString("not-a-date"), null);
  assert.equal(
    cleanup.normalizeUtcDateTimeString("2025-02-30T00:00:00Z"),
    "2025-03-02T00:00:00.000Z",
  );
  assert.equal(cleanup.normalizeUtcDateTimeString("2025-13-01T00:00:00Z"), null);
  assert.equal(cleanup.normalizeUtcDateTimeString("2025-01-02T03:04:05.000Z"), null);
  assert.equal(
    cleanup.normalizeUtcDateTimeString("2025-01-02T03:04:05+02:00"),
    "2025-01-02T01:04:05.000Z",
  );
  assert.equal(
    cleanup.normalizeUtcDateTimeString(" 2025-01-02T03:04:05Z "),
    "2025-01-02T03:04:05.000Z",
  );

  const value: JsonObject = {
    "common:timeStamp": "2025-01-02T03:04:05+02:00",
    nested: [
      { "common:dateOfLastRevision": "2025-01-02T03:04:05Z" },
      { "common:timeStamp": "invalid" },
      { other: { "common:timeStamp": 7 } },
    ],
  };
  assert.equal(cleanup.normalizeDateTimeMetadata(value), 2);
  assert.deepEqual(value, {
    "common:timeStamp": "2025-01-02T01:04:05.000Z",
    nested: [
      { "common:dateOfLastRevision": "2025-01-02T03:04:05.000Z" },
      { "common:timeStamp": "invalid" },
      { other: { "common:timeStamp": 7 } },
    ],
  });
  assert.equal(cleanup.normalizeDateTimeMetadata(null), 0);
});

test("annual supply sentinel preserves process-only, real-value, wrapper, placeholder, and missing-container behavior", () => {
  assert.equal(cleanup.annualSupplyMissingDataSentinelText, "9999 missing-data-sentinel/year");
  const nonProcess = processRow({ annualSupply: "Not specified" });
  assert.equal(cleanup.applyAnnualSupplyMissingDataSentinel(nonProcess, "flow"), false);

  const noContainer = { processDataSet: { processInformation: { dataSetInformation: {} } } };
  assert.equal(cleanup.applyAnnualSupplyMissingDataSentinel(noContainer, "process"), false);

  for (const placeholder of [
    undefined,
    "",
    "9999",
    "Not specified.",
    { "#text": "Not declared in source package" },
    { value: "Source production volume unavailable" },
    ["array-is-not-a-supported-real-value"],
  ]) {
    const row = processRow({ annualSupply: placeholder });
    assert.equal(cleanup.applyAnnualSupplyMissingDataSentinel(row, "process"), true);
    assert.deepEqual(
      row.processDataSet.modellingAndValidation.dataSourcesTreatmentAndRepresentativeness
        .annualSupplyOrProductionVolume,
      { "@xml:lang": "en", "#text": "9999 missing-data-sentinel/year" },
    );
  }

  const wrapped = { process: processRow({ annualSupply: "source evidence unavailable" }) };
  assert.equal(cleanup.applyAnnualSupplyMissingDataSentinel(wrapped, "process"), true);
  const real = processRow({ annualSupply: { "#text": "125 kg/year" } });
  assert.equal(cleanup.applyAnnualSupplyMissingDataSentinel(real, "process"), false);
  assert.equal(
    real.processDataSet.modellingAndValidation.dataSourcesTreatmentAndRepresentativeness
      .annualSupplyOrProductionVolume["#text"],
    "125 kg/year",
  );
});

test("source row index preserves exact-version last-write and bare-id first-write precedence", () => {
  const firstV1 = processRow({ id: "shared", version: "01.00.000" });
  const secondV1 = processRow({ id: "shared", version: "01.00.000" });
  secondV1.marker = "second-v1";
  const v2 = processRow({ id: "shared", version: "02.00.000" });
  const index = cleanup.buildSourceRowsByIdentity([firstV1, secondV1, v2]);

  assert.equal(index.get("shared@@01.00.000")!.row, secondV1);
  assert.equal(index.get("shared@@01.00.000")!.index, 1);
  assert.equal(index.get("shared@@02.00.000")!.row, v2);
  assert.equal(index.get("shared")!.row, firstV1);
  assert.equal(index.get("shared")!.index, 0);
});

test("deterministic source-exchange proof preserves output-only, array/object order, reference exclusion, hashes, and duplicate guard", () => {
  const source = processRow({
    exchanges: [
      outputExchange("1", "source-flow-a", { comment: { a: 1, b: 2 } }),
      outputExchange("2", "source-flow-b"),
    ],
  });
  const final = processRow({
    exchanges: [
      outputExchange("1", "canonical-flow-a", { comment: { a: 1, b: 2 } }),
      outputExchange("2", "canonical-flow-b"),
    ],
  });
  const sourceRowsByKey = cleanup.buildSourceRowsByIdentity([source]);
  const proofRows: JsonObject[] = [];
  assert.equal(
    cleanup.applyDeterministicSourceExchangeCompletenessProofs(final, "process", {
      rowIndex: 4,
      sourceRowsByKey,
      sourceRowsFile: "source.jsonl",
      rowsFile: "final.jsonl",
      proofRows,
    }),
    true,
  );
  const trace =
    final.processDataSet.processInformation.dataSetInformation["common:other"][
      "tiangongfoundry:sourceExchangeCompleteness"
    ][0];
  assert.equal(trace.status, "source_only_output_exchange_verified");
  assert.equal(trace.evidence.exchange_count, 2);
  assert.deepEqual(trace.evidence.directions, ["output", "output"]);
  assert.equal(
    trace.evidence.source_exchange_signature_hash,
    trace.evidence.final_exchange_signature_hash,
  );
  assert.equal(
    final.processDataSet.processInformation.dataSetInformation["common:other"][
      "@xmlns:tiangongfoundry"
    ],
    cleanup.foundryTraceNamespace,
  );
  assert.deepEqual(proofRows[0], {
    dataset_type: "process",
    dataset_id: "process-1",
    version: "00.00.001",
    row_index: 4,
    source_row_index: 0,
    status: "source_only_output_exchange_verified",
    trace_hash: sha256Text(JSON.stringify(trace)),
    source_rows_file: "source.jsonl",
    rows_file: "final.jsonl",
    source_exchange_signature_hash: trace.evidence.source_exchange_signature_hash,
    final_exchange_signature_hash: trace.evidence.final_exchange_signature_hash,
    exchange_count: 2,
    directions: ["output", "output"],
  });
  assert.equal(
    cleanup.applyDeterministicSourceExchangeCompletenessProofs(final, "process", {
      rowIndex: 4,
      sourceRowsByKey,
      proofRows,
    }),
    false,
  );

  const reversed = processRow({
    exchanges: [outputExchange("2", "x"), outputExchange("1", "y")],
  });
  assert.equal(
    cleanup.applyDeterministicSourceExchangeCompletenessProofs(reversed, "process", {
      rowIndex: 0,
      sourceRowsByKey,
    }),
    false,
  );
  const reorderedObject = processRow({
    exchanges: [
      {
        meanAmount: "1",
        exchangeDirection: "Output",
        comment: { b: 2, a: 1 },
        referenceToFlowDataSet: { "@refObjectId": "canonical" },
      },
      outputExchange("2", "canonical-b"),
    ],
  });
  assert.equal(
    cleanup.applyDeterministicSourceExchangeCompletenessProofs(reorderedObject, "process", {
      rowIndex: 0,
      sourceRowsByKey,
    }),
    false,
  );
  const inputDirection = processRow({
    exchanges: [{ ...outputExchange("1", "x"), exchangeDirection: "Input" }],
  });
  assert.equal(
    cleanup.applyDeterministicSourceExchangeCompletenessProofs(inputDirection, "process", {
      rowIndex: 0,
      sourceRowsByKey,
    }),
    false,
  );
  assert.equal(
    cleanup.applyDeterministicSourceExchangeCompletenessProofs(final, "flow", {
      rowIndex: 0,
      sourceRowsByKey,
    }),
    false,
  );
});

test("import trace externalization preserves DFS order, existing summary shape, exact hashes, namespaces, and serialization errors", () => {
  const traceA = { source: "a", rows: [1, 2] };
  const traceB = { source: "b", nested: { value: true } };
  const value: JsonObject = {
    first: {
      "common:other": {
        "@xmlns:tidasimport": "legacy",
        "tidasimport:sourceTrace": traceA,
        "tiangongfoundry:importTraceSummary": { existing: true },
      },
    },
    list: [{ "common:other": { "tidasimport:sourceTrace": traceB } }],
  };
  assert.deepEqual(cleanup.externalizeImportTraceMetadata(value), { removed: 2, summaries: 2 });
  const firstOther = value.first["common:other"];
  assert.equal(firstOther["tidasimport:sourceTrace"], undefined);
  assert.equal(firstOther["@xmlns:tidasimport"], undefined);
  assert.equal(firstOther["@xmlns:tiangongfoundry"], cleanup.foundryTraceNamespace);
  assert.deepEqual(firstOther["tiangongfoundry:importTraceSummary"], [
    { existing: true },
    {
      "@sourceExtension": "tidasimport:sourceTrace",
      "@status": "externalized_before_remote_write",
      traceHash: createHash("sha256").update(JSON.stringify(traceA)).digest("hex"),
      note: "Original import trace was captured in the Foundry AI authoring package and removed from the write payload.",
    },
  ]);
  assert.equal(
    value.list[0]["common:other"]["tiangongfoundry:importTraceSummary"].traceHash,
    createHash("sha256").update(JSON.stringify(traceB)).digest("hex"),
  );

  const circular: JsonObject = {};
  circular.self = circular;
  const invalid = { "common:other": { "tidasimport:sourceTrace": circular } };
  assert.throws(
    () => cleanup.externalizeImportTraceMetadata(invalid),
    (error: unknown) => error instanceof TypeError,
  );
  assert.equal(invalid["common:other"]["tidasimport:sourceTrace"], circular);
});

test("Foundry namespace repair preserves existing namespaces and recursively counts only missing extension owners", () => {
  const value: JsonObject = {
    first: { "common:other": { "tiangongfoundry:unresolvedTrace": [] } },
    list: [
      {
        "common:other": {
          "@xmlns:tiangongfoundry": "custom",
          "tiangongfoundry:sourceExchangeCompleteness": {},
        },
      },
      { "common:other": { unrelated: true } },
    ],
  };
  assert.equal(cleanup.ensureFoundryTraceNamespaces(value), 1);
  assert.equal(
    value.first["common:other"]["@xmlns:tiangongfoundry"],
    cleanup.foundryTraceNamespace,
  );
  assert.equal(value.list[0]["common:other"]["@xmlns:tiangongfoundry"], "custom");
  assert.equal(value.list[1]["common:other"]["@xmlns:tiangongfoundry"], undefined);
  assert.equal(cleanup.ensureFoundryTraceNamespaces(value), 0);
});

test("trace evidence locator sanitization preserves trace order, deletes locator keys, redacts embedded paths, and binds exact hashes", () => {
  const sourcePath = "/Users/example/source.zip:file.xml";
  const quotePath = "Evidence at file:///tmp/source.xml";
  const windowsPath = "C:\\datasets\\source.xml";
  const value: JsonObject = {
    processDataSet: {
      processInformation: {
        dataSetInformation: {
          "common:other": {
            "tiangongfoundry:unresolvedTrace": {
              evidence: {
                source_path: sourcePath,
                quote: quotePath,
                safe: "published source DOI 10.1000/example",
              },
            },
            "tiangongfoundry:sourceExchangeCompleteness": [
              {
                source_evidence: [{ packagePath: windowsPath }],
              },
            ],
          },
        },
      },
    },
  };
  assert.equal(cleanup.sanitizeFoundryTraceEvidenceLocators(value), 3);
  const other = value.processDataSet.processInformation.dataSetInformation["common:other"];
  const evidence = other["tiangongfoundry:unresolvedTrace"].evidence;
  assert.equal(evidence.source_path, undefined);
  assert.equal(evidence.quote, `redacted local source locator sha256:${sha256Text(quotePath)}`);
  assert.equal(evidence.safe, "published source DOI 10.1000/example");
  assert.equal(evidence.source_locator_sha256, sha256Text(sourcePath));
  assert.equal(evidence.source_locator_status, "redacted_before_remote_write");
  const sourceEvidence = other["tiangongfoundry:sourceExchangeCompleteness"][0].source_evidence[0];
  assert.equal(sourceEvidence.packagePath, undefined);
  assert.equal(sourceEvidence.source_locator_sha256, sha256Text(windowsPath));
  assert.equal(sourceEvidence.source_locator_status, "redacted_before_remote_write");
  assert.equal(cleanup.sanitizeFoundryTraceEvidenceLocators({ unrelated: true }), 0);
});

test("prewrite cleanup module retains its exact export surface", () => {
  assert.deepEqual(Object.keys(cleanup).sort(), [
    "annualSupplyMissingDataSentinelText",
    "applyAnnualSupplyMissingDataSentinel",
    "applyDeterministicSourceExchangeCompletenessProofs",
    "buildSourceRowsByIdentity",
    "ensureFoundryTraceNamespaces",
    "externalizeImportTraceMetadata",
    "foundryTraceNamespace",
    "normalizeDateTimeMetadata",
    "normalizeUtcDateTimeString",
    "sanitizeFoundryTraceEvidenceLocators",
  ]);
});

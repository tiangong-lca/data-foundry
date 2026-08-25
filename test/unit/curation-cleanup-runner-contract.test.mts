import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { runDatasetCurationCleanup } from "../../scripts/lib/import-curation/curation-cleanup.mjs";

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord {
  assert.ok(value && typeof value === "object" && !Array.isArray(value));
  return value as JsonRecord;
}

function records(value: unknown): JsonRecord[] {
  assert.ok(Array.isArray(value));
  return value.map(record);
}

function writeJsonLines(filePath: string, rows: unknown[]): string {
  const text = rows.map((row) => JSON.stringify(row)).join("\n") + "\n";
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, text);
  return text;
}

function processRow({
  id,
  referenceId,
  annualSupply,
  trace,
  timestamp,
}: {
  id: string;
  referenceId: string;
  annualSupply: unknown;
  trace?: boolean;
  timestamp: string;
}): JsonRecord {
  const commonOther: JsonRecord = trace
    ? {
        "@xmlns:tidasimport": "https://example.invalid/tidas-import",
        "tidasimport:sourceTrace": {
          source: "fixture",
          rows: [1, 2],
        },
        "tiangongfoundry:unresolvedTrace": [
          {
            status: "unresolved_deferred",
            evidence: {
              source_path: "/tmp/private/source-package.zip",
              quote_or_trace: "fixture evidence",
            },
          },
        ],
      }
    : {};
  return {
    id,
    version: "00.00.001",
    process: {
      processDataSet: {
        processInformation: {
          dataSetInformation: {
            "common:UUID": id,
            name: {
              baseName: [{ "@xml:lang": "en", "#text": `Process ${id}` }],
            },
            ...(trace ? { "common:other": commonOther } : {}),
          },
        },
        modellingAndValidation: {
          dataSourcesTreatmentAndRepresentativeness: {
            annualSupplyOrProductionVolume: annualSupply,
          },
        },
        exchanges: {
          exchange: [
            {
              exchangeDirection: "Output",
              meanAmount: 1,
              resultingAmount: 1,
              referenceToFlowDataSet: {
                "@refObjectId": referenceId,
                "@version": "00.00.001",
              },
            },
          ],
        },
        administrativeInformation: {
          dataEntryBy: {
            "common:timeStamp": timestamp,
          },
          publicationAndOwnership: {
            "common:dataSetVersion": "00.00.001",
          },
        },
      },
    },
  };
}

function withoutFlowReference(
  row: JsonRecord,
  replacementReferenceId: string,
  direction = "Output",
): JsonRecord {
  const cloned = structuredClone(row);
  const process = record(cloned.process);
  const root = record(process.processDataSet);
  const exchanges = record(root.exchanges);
  const exchange = records(exchanges.exchange)[0];
  exchange.exchangeDirection = direction;
  exchange.referenceToFlowDataSet = {
    "@refObjectId": replacementReferenceId,
    "@version": "99.99.999",
  };
  return cloned;
}

test("process cleanup preserves deep-clone order, bytes, proofs, traces, and counts", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "foundry-curation-cleanup-contract-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const processB = "22222222-2222-4222-8222-222222222222";
  const processA = "11111111-1111-4111-8111-111111111111";
  const finalB = processRow({
    id: processB,
    referenceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    annualSupply: "Not specified",
    trace: true,
    timestamp: "2025-03-01T08:00:00+08:00",
  });
  const finalA = processRow({
    id: processA,
    referenceId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    annualSupply: { "@xml:lang": "en", "#text": "42 kg/year" },
    timestamp: "2025-03-01T00:00:00.000Z",
  });
  const sourceA = withoutFlowReference(finalA, "source-flow-a", "Input");
  const sourceB = withoutFlowReference(finalB, "source-flow-b");
  const rowsFile = path.join(root, "rows", "processes.jsonl");
  const sourceRowsFile = path.join(root, "source", "processes.jsonl");
  const originalRowsText = writeJsonLines(rowsFile, [finalB, finalA]);
  writeJsonLines(sourceRowsFile, [sourceA, sourceB]);

  const result = record(
    runDatasetCurationCleanup({
      repoRoot: root,
      options: {
        type: "process",
        rowsFile: "rows/processes.jsonl",
        sourceRowsFile: "source/processes.jsonl",
        outDir: "cleanup",
      },
    }),
  );

  assert.equal(fs.readFileSync(rowsFile, "utf8"), originalRowsText);
  assert.equal(result.status, "completed");
  const files = record(result.files);
  const cleanedText = fs.readFileSync(path.join(root, String(files.cleaned_rows)), "utf8");
  const cleanedRows = cleanedText
    .trimEnd()
    .split("\n")
    .map((line) => record(JSON.parse(line)));
  assert.equal(cleanedText, cleanedRows.map((row) => JSON.stringify(row)).join("\n") + "\n");
  assert.deepEqual(
    cleanedRows.map((row) => row.id),
    [processB, processA],
  );

  const cleanedBProcess = record(cleanedRows[0]?.process);
  const cleanedBRoot = record(cleanedBProcess.processDataSet);
  const cleanedBInfo = record(record(cleanedBRoot.processInformation).dataSetInformation);
  const cleanedBOther = record(cleanedBInfo["common:other"]);
  const cleanedBModelling = record(cleanedBRoot.modellingAndValidation);
  const cleanedBSources = record(cleanedBModelling.dataSourcesTreatmentAndRepresentativeness);
  assert.deepEqual(cleanedBSources.annualSupplyOrProductionVolume, {
    "@xml:lang": "en",
    "#text": "9999 missing-data-sentinel/year",
  });
  assert.equal(cleanedBOther["tidasimport:sourceTrace"], undefined);
  assert.equal(cleanedBOther["@xmlns:tidasimport"], undefined);
  assert.equal(
    record(cleanedBOther["tiangongfoundry:importTraceSummary"])["@status"],
    "externalized_before_remote_write",
  );
  const sourceProof = records(cleanedBOther["tiangongfoundry:sourceExchangeCompleteness"])[0];
  assert.equal(sourceProof.status, "source_only_output_exchange_verified");
  const unresolved = records(cleanedBOther["tiangongfoundry:unresolvedTrace"])[0];
  const unresolvedEvidence = record(unresolved.evidence);
  assert.equal(unresolvedEvidence.source_path, undefined);
  assert.equal(unresolvedEvidence.source_locator_status, "redacted_before_remote_write");
  assert.match(String(unresolvedEvidence.source_locator_sha256), /^[a-f0-9]{64}$/u);
  assert.equal(
    record(record(cleanedBRoot.administrativeInformation).dataEntryBy)["common:timeStamp"],
    "2025-03-01T00:00:00.000Z",
  );

  const counts = record(result.counts);
  assert.deepEqual(
    {
      rows: counts.rows,
      removed_source_trace_blocks: counts.removed_source_trace_blocks,
      externalized_source_trace_summaries: counts.externalized_source_trace_summaries,
      redacted_foundry_trace_evidence_locators: counts.redacted_foundry_trace_evidence_locators,
      normalized_datetime_values: counts.normalized_datetime_values,
      annual_supply_missing_data_sentinels: counts.annual_supply_missing_data_sentinels,
      source_exchange_completeness_proofs: counts.source_exchange_completeness_proofs,
    },
    {
      rows: 2,
      removed_source_trace_blocks: 1,
      externalized_source_trace_summaries: 1,
      redacted_foundry_trace_evidence_locators: 1,
      normalized_datetime_values: 1,
      annual_supply_missing_data_sentinels: 1,
      source_exchange_completeness_proofs: 1,
    },
  );
  const proofRows = records(result.source_exchange_completeness_proofs);
  assert.equal(proofRows.length, 1);
  assert.deepEqual(
    {
      dataset_id: proofRows[0]?.dataset_id,
      row_index: proofRows[0]?.row_index,
      source_row_index: proofRows[0]?.source_row_index,
      exchange_count: proofRows[0]?.exchange_count,
      directions: proofRows[0]?.directions,
    },
    {
      dataset_id: processB,
      row_index: 0,
      source_row_index: 1,
      exchange_count: 1,
      directions: ["output"],
    },
  );
  assert.equal(
    fs.readFileSync(path.join(root, String(files.report)), "utf8"),
    `${JSON.stringify(result, null, 2)}\n`,
  );
});

test("malformed readable rows retain native SyntaxError before output", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "foundry-curation-cleanup-error-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, "rows.json"), "{");
  assert.throws(
    () =>
      runDatasetCurationCleanup({
        repoRoot: root,
        options: { type: "process", rowsFile: "rows.json", outDir: "cleanup" },
      }),
    SyntaxError,
  );
  assert.equal(fs.existsSync(path.join(root, "cleanup")), false);
});

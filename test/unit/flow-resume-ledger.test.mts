import assert from "node:assert/strict";
import test from "node:test";

import { createFlowResumeLedgerService } from "../../scripts/lib/batch-orchestration/flow-resume-ledger.ts";
import { createVerifiedFlowWriteService } from "../../scripts/lib/batch-orchestration/verified-flow-write.ts";

type JsonRecord = Record<string, unknown>;

const flowA = { id: "flow-a", version: "00.00.001", value: { amount: 1 } };
const flowB = { id: "flow-b", version: "00.00.001", value: { amount: 2 } };

test("flow resume requires exact canonical payload SHA and distrusts legacy rows", () => {
  const service = createFlowResumeLedgerService({
    asText: (value) => String(value ?? ""),
    datasetIdentity: (row) => ({ id: String(row.id), version: String(row.version) }),
    readJsonLines: () => [],
    repoRelative: (filePath) => filePath,
  });
  const exactSha = service.payloadSha256(flowA);
  const verifiedRows = new Map<string, JsonRecord>([
    ["flow-a@00.00.001", { payload_sha256: exactSha }],
    ["flow-b@00.00.001", { status: "verified" }],
  ]);
  const exact = service.partitionRows(
    [flowA, flowB],
    new Set(["flow-a@00.00.001", "flow-b@00.00.001"]),
    verifiedRows,
  );
  assert.deepEqual(exact.verifiedRows, [flowA]);
  assert.deepEqual(exact.pendingRows, [flowB]);
  assert.equal(exact.invalidatedIdentities[0].reason, "legacy_flow_payload_digest_missing");

  const changedA = { ...flowA, value: { amount: 3 } };
  const drift = service.partitionRows([changedA], new Set(["flow-a@00.00.001"]), verifiedRows);
  assert.deepEqual(drift.verifiedRows, []);
  assert.deepEqual(drift.pendingRows, [changedA]);
  assert.equal(drift.invalidatedIdentities[0].reason, "flow_payload_drift");
});

test("flow resume loader gives the latest ledger row precedence", () => {
  const service = createFlowResumeLedgerService({
    asText: (value) => String(value ?? ""),
    datasetIdentity: (row) => ({ id: String(row.id), version: String(row.version) }),
    readJsonLines: (filePath) =>
      filePath === "prior"
        ? [{ dataset_id: "flow-a", dataset_version: "00.00.001", payload_sha256: "prior" }]
        : [{ dataset_id: "flow-a", dataset_version: "00.00.001", payload_sha256: "local" }],
    repoRelative: (filePath) => `ledger/${filePath}`,
  });
  const rows = service.loadRowsByKey(["prior", "local"]);
  assert.equal(rows.get("flow-a@00.00.001")?.payload_sha256, "local");
  assert.equal(rows.get("flow-a@00.00.001")?.source_ledger_file, "ledger/local");
});

test("verified flow writer records payload authority once per exact payload", () => {
  const appended: JsonRecord[] = [];
  const verifiedRowsByKey = new Map<string, JsonRecord>();
  const verifiedFlows = new Set<string>();
  const payloadSha256 = (row: JsonRecord) => JSON.stringify(row);
  const service = createVerifiedFlowWriteService({
    asText: (value) => String(value ?? ""),
    datasetIdentity: (row) => ({ id: String(row.id), version: String(row.version) }),
    datasetIdentityKey: (identity) => `${identity.id}@${identity.version}`,
    payloadSha256,
    repoRelative: (filePath) => String(filePath ?? ""),
    invalidateIdentityPreflightResultCacheEntry: () => undefined,
    okDatasetRow: (input) => ({ dataset_id: input.id, dataset_version: input.version }),
    appendJsonLine: (_filePath, row) => appended.push(row),
  });
  const input = {
    rows: [flowA],
    processId: "process-a",
    report: "finalize.json",
    closeoutReportPath: "closeout.json",
    ledgerPath: "ok.flows.jsonl",
    verifiedFlows,
    verifiedRowsByKey,
  };
  service.record(input);
  service.record(input);
  assert.equal(appended.length, 1);
  assert.equal(appended[0].payload_sha256, payloadSha256(flowA));
  assert.equal(verifiedRowsByKey.get("flow-a@00.00.001")?.payload_sha256, payloadSha256(flowA));
});

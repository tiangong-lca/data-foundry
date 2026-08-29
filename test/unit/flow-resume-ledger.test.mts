import assert from "node:assert/strict";
import test from "node:test";

import { createFlowResumeLedgerService } from "../../scripts/lib/batch-orchestration/flow-resume-ledger.ts";

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
  const drift = service.partitionRows(
    [changedA],
    new Set(["flow-a@00.00.001"]),
    verifiedRows,
  );
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

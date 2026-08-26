import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

interface JsonRecord {
  [key: string]: unknown;
}

const fixedNow = "2026-08-26T02:03:04.000Z";
const flowA = "11111111-2222-4333-8444-555555555551";
const flowB = "11111111-2222-4333-8444-555555555552";
const flowPending = "11111111-2222-4333-8444-555555555553";
const processA = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeee1";
const processB = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeee2";
const processC = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeee3";
const processD = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeee4";

test("verified-ledger projection preserves prior-file first rows, BAFU flow order, exact carry-forward bytes and SHA", async () => {
  const priorA = "/case/prior-a/import-ledger/ok.flows.verified.jsonl";
  const priorB = "/case/prior-b/import-ledger/ok.flows.verified.jsonl";
  const scopeLedger = "/case/current/scopes/process/import-ledger/ok.flows.verified.jsonl";
  const firstFlowRow = {
    schema_version: 1,
    dataset_type: "flow",
    dataset_id: flowA,
    dataset_version: "01.00.000",
    status: "verified",
    report: "prior-a/flow-a.json",
    marker: "first-row-wins",
  };
  const firstFlowBRow = {
    schema_version: 1,
    dataset_type: "flow",
    flow_id: flowB,
    flow_version: "02.00.000",
    status: "verified",
    report: "prior-a/flow-b.json",
    marker: "first-flow-b",
  };
  const localFlowA = {
    schema_version: 1,
    dataset_type: "flow",
    dataset_id: flowA,
    dataset_version: "01.00.000",
    status: "verified",
    marker: "already-local",
  };
  const files = new Map<string, string>([
    [
      priorA,
      jsonLines([
        firstFlowRow,
        { ...firstFlowRow, marker: "duplicate-in-first-file" },
        firstFlowBRow,
        { schema_version: 1, status: "verified", marker: "missing-identity" },
      ]),
    ],
    [
      priorB,
      jsonLines([
        { ...firstFlowRow, marker: "duplicate-in-later-file" },
        { ...firstFlowBRow, marker: "duplicate-flow-b-later" },
      ]),
    ],
    [scopeLedger, jsonLines([localFlowA])],
  ]);
  const { createVerifiedLedgerProjectionService } =
    await import("../../scripts/lib/batch-orchestration/verified-ledger-projection.ts");
  const service = createVerifiedLedgerProjectionService(runtimeFor(files));

  assert.deepEqual(
    [...service.loadVerifiedSetFromFiles([priorA, priorB], "flow")],
    [`${flowA}@01.00.000`, `${flowB}@02.00.000`],
  );
  const firstRows = service.loadVerifiedRowsByKeyFromFiles([priorA, priorB], "flow");
  assert.equal(firstRows.get(`${flowA}@01.00.000`)?.marker, "first-row-wins");
  assert.equal(firstRows.get(`${flowB}@02.00.000`)?.marker, "first-flow-b");
  assert.equal(firstRows.get(`${flowA}@01.00.000`)?.source_ledger_file, rel(priorA));

  const verifiedA = flowRow(flowA, "01.00.000", "verified-a");
  const pending = flowRow(flowPending, "00.00.001", "pending");
  const verifiedB = flowRow(flowB, "02.00.000", "verified-b");
  const missingIdentity = { flowDataSet: { flowInformation: { dataSetInformation: {} } } };
  const partition = service.flowRowsPendingVerification(
    [verifiedA, pending, verifiedB, missingIdentity],
    service.loadVerifiedSetFromFiles([priorA, priorB], "flow"),
  );
  assert.deepEqual(partition.pendingRows, [pending]);
  assert.deepEqual(partition.verifiedRows, [verifiedA, verifiedB]);
  assert.deepEqual(partition.pendingIdentities, [
    {
      id: flowPending,
      version: "00.00.001",
      identity_key: `${flowPending}@00.00.001`,
    },
  ]);
  assert.deepEqual(
    partition.verifiedIdentities.map((row) => row.identity_key),
    [`${flowA}@01.00.000`, `${flowB}@02.00.000`],
  );

  const carried = service.writeScopeCarriedForwardVerifiedFlowRows({
    ledgerDir: "/case/current/scopes/process/import-ledger",
    processId: processA,
    verifiedIdentities: partition.verifiedIdentities,
    verifiedFlowRowsByKey: firstRows,
  });
  assert.deepEqual(carried, {
    count: 1,
    rows: [
      {
        id: flowB,
        version: "02.00.000",
        identity_key: `${flowB}@02.00.000`,
        source_ledger_file: rel(priorA),
      },
    ],
    ledger: scopeLedger,
  });
  assert.equal(files.get(scopeLedger), expectedCarryForwardBytes);
  assert.equal(sha(files.get(scopeLedger) ?? ""), expectedCarryForwardSha256);

  const repeated = service.writeScopeCarriedForwardVerifiedFlowRows({
    ledgerDir: "/case/current/scopes/process/import-ledger",
    processId: processA,
    verifiedIdentities: partition.verifiedIdentities,
    verifiedFlowRowsByKey: firstRows,
  });
  assert.equal(repeated.count, 0);
  assert.equal(files.get(scopeLedger), expectedCarryForwardBytes);
});

test("blocked-ledger projection preserves historical order, active/resolved views, exact bytes and SHA", async () => {
  const okScopes = "/case/current/import-ledger/ok.scopes.verified.jsonl";
  const historical = "/case/current/import-ledger/blocked.scopes.human-review.jsonl";
  const active = "/case/current/import-ledger/blocked.scopes.human-review.active.jsonl";
  const resolved = "/case/current/import-ledger/blocked.scopes.human-review.resolved.jsonl";
  const otherHistorical = "/case/prior/import-ledger/blocked.scopes.human-review.jsonl";
  const files = new Map<string, string>([
    [
      okScopes,
      jsonLines([
        {
          process_id: processA,
          process_version: "01.00.000",
          generated_at_utc: "2026-08-25T00:00:00.000Z",
          report: "first-a.json",
        },
        {
          dataset_id: processA,
          dataset_version: "01.00.000",
          generated_at_utc: "2026-08-26T01:00:00.000Z",
          report: "latest-a.json",
        },
        {
          process_id: processC,
          process_version: "00.00.001",
          generated_at_utc: "2026-08-26T01:30:00.000Z",
          report: "verified-c.json",
        },
      ]),
    ],
    [
      historical,
      jsonLines([
        blocker(processA, "01.00.000", "classification_missing"),
        blocker(processB, undefined, "source_missing"),
        blocker(processA, "01.00.000", "location_missing"),
        { id: processC, version: "00.00.001", stage: "flow", code: "flow_missing" },
      ]),
    ],
    [
      otherHistorical,
      jsonLines([
        blocker(processD, "03.00.000", "prior-only"),
        blocker(processA, "01.00.000", "already-verified"),
        blocker(processB, undefined, "duplicate-active"),
      ]),
    ],
  ]);
  const { createVerifiedLedgerProjectionService } =
    await import("../../scripts/lib/batch-orchestration/verified-ledger-projection.ts");
  const service = createVerifiedLedgerProjectionService(runtimeFor(files));

  assert.deepEqual(
    service.writeBlockedScopeViews({
      okScopes,
      blockedHumanReview: historical,
      blockedHumanReviewActive: active,
      blockedHumanReviewResolved: resolved,
    }),
    { historical: 4, active: 1, resolved: 3 },
  );
  assert.equal(files.get(active), expectedActiveBytes);
  assert.equal(files.get(resolved), expectedResolvedBytes);
  assert.equal(sha(files.get(active) ?? ""), expectedActiveSha256);
  assert.equal(sha(files.get(resolved) ?? ""), expectedResolvedSha256);

  const verified = service.loadVerifiedSetFromFiles([okScopes], "scope");
  assert.deepEqual(
    [...service.loadActiveBlockedScopeSetFromFiles([historical, otherHistorical], verified)],
    [`${processB}@00.00.001`, `${processD}@03.00.000`],
  );
});

test("verified-ledger row projections and batch status matrix remain byte-stable", async () => {
  const { createVerifiedLedgerProjectionService } =
    await import("../../scripts/lib/batch-orchestration/verified-ledger-projection.ts");
  const service = createVerifiedLedgerProjectionService(runtimeFor(new Map<string, string>()));

  const ok = service.okDatasetRow({
    type: "flow",
    id: flowA,
    version: "",
    processId: processA,
    report: "/case/current/finalize/report.json",
    files: { rows: "current/final.jsonl" },
  });
  const blocked = service.blockRow({
    scope: { process_id: processB },
    stage: "flow.authoring",
    blocker: {
      code: "bafu_name_split_unsupported",
      message: "Name-plan evidence is incomplete.",
      required_human_action: "Complete the exact BAFU authoring task.",
    },
    report: "/case/current/authoring/report.json",
    rerunCommand: "node scripts/foundry.ts dataset-bafu-batch-import-run --process-id process-b",
  });
  const projectedBytes = `${JSON.stringify(ok)}\n${JSON.stringify(blocked)}\n`;
  assert.equal(projectedBytes, expectedProjectedRowsBytes);
  assert.equal(sha(projectedBytes), expectedProjectedRowsSha256);

  const matrix: Array<{
    results: JsonRecord[];
    options?: { paused?: boolean; stoppedAfterBlocked?: boolean };
    expected: string;
  }> = [
    { results: [], expected: "completed" },
    { results: [{ status: "verified" }], expected: "completed" },
    { results: [{ status: "blocked" }], expected: "completed_with_deferred_scopes" },
    { results: [{ status: "failed" }], expected: "completed_with_retryable_failures" },
    {
      results: [{ status: "blocked" }, { status: "failed" }],
      expected: "completed_with_retryable_failures",
    },
    { results: [], options: { paused: true }, expected: "paused" },
    {
      results: [{ status: "blocked" }],
      options: { paused: true },
      expected: "paused_with_deferred_scopes",
    },
    {
      results: [{ status: "failed" }, { status: "blocked" }],
      options: { paused: true },
      expected: "paused_with_retryable_failures",
    },
    {
      results: [{ status: "blocked" }],
      options: { stoppedAfterBlocked: true },
      expected: "stopped_after_blocked",
    },
    {
      results: [{ status: "failed" }],
      options: { stoppedAfterBlocked: true },
      expected: "stopped_after_blocked_with_retryable_failures",
    },
  ];
  for (const entry of matrix) {
    assert.equal(service.batchRunStatus(entry.results, entry.options), entry.expected);
  }

  assert.equal(Object.isFrozen(service), true);
  const brokenRuntime = {
    ...runtimeFor(new Map<string, string>()),
    writeJsonLines: undefined,
  };
  assert.throws(
    () => Reflect.apply(createVerifiedLedgerProjectionService, undefined, [brokenRuntime]),
    /createVerifiedLedgerProjectionService missing dependencies: writeJsonLines/u,
  );
});

function runtimeFor(files: Map<string, string>) {
  return {
    nowIso: () => fixedNow,
    asText: textValue,
    datasetIdentity,
    readJsonLines: (filePath: string): unknown[] => parseJsonLines(files.get(filePath) ?? ""),
    writeJsonLines: (filePath: string, rows: readonly unknown[]): void => {
      files.set(filePath, jsonLines(rows));
    },
    appendJsonLine: (filePath: string, row: unknown): void => {
      files.set(filePath, `${files.get(filePath) ?? ""}${JSON.stringify(row)}\n`);
    },
    repoRelative: (filePath: string | null | undefined) => (filePath ? rel(filePath) : ""),
    pathJoin: (...parts: string[]) => parts.join("/").replace(/\/{2,}/gu, "/"),
  };
}

function rel(filePath: string): string {
  return filePath.replace(/^\/case\//u, "");
}

function parseJsonLines(text: string): unknown[] {
  return text
    .split(/\r?\n/u)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function jsonLines(rows: readonly unknown[]): string {
  return rows.length === 0 ? "" : `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`;
}

function sha(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function record(value: unknown): JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function textValue(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string" || typeof value === "number") return String(value).trim();
  if (Array.isArray(value)) return value.map(textValue).filter(Boolean).join("; ");
  const row = record(value);
  return textValue(row["#text"] ?? row.value ?? row.id);
}

function datasetIdentity(rowValue: unknown, type: string): { id: string | null; version: string } {
  const row = record(rowValue);
  if (type !== "flow") {
    return {
      id: textValue(row.dataset_id ?? row.id) || null,
      version: textValue(row.dataset_version ?? row.version) || "00.00.001",
    };
  }
  const root = record(row.flowDataSet);
  const information = record(root.flowInformation);
  const dataSetInformation = record(information.dataSetInformation);
  const administrative = record(root.administrativeInformation);
  const publication = record(administrative.publicationAndOwnership);
  return {
    id: textValue(dataSetInformation["common:UUID"]) || null,
    version: textValue(publication["common:dataSetVersion"]) || "00.00.001",
  };
}

function flowRow(id: string, version: string, marker: string): JsonRecord {
  return {
    flowDataSet: {
      flowInformation: {
        dataSetInformation: {
          "common:UUID": id,
          name: {
            baseName: { "@xml:lang": "en", "#text": `BAFU ${marker}` },
            mixAndLocationTypes: { "@xml:lang": "en", "#text": "Swiss production mix" },
          },
        },
      },
      administrativeInformation: {
        publicationAndOwnership: { "common:dataSetVersion": version },
      },
    },
    marker,
  };
}

function blocker(processId: string, version: string | undefined, code: string): JsonRecord {
  return {
    process_id: processId,
    ...(version ? { process_version: version } : {}),
    stage: "authoring",
    code,
  };
}

const expectedCarryForwardBytes =
  '{"schema_version":1,"dataset_type":"flow","dataset_id":"11111111-2222-4333-8444-555555555551","dataset_version":"01.00.000","status":"verified","marker":"already-local"}\n' +
  '{"schema_version":1,"dataset_type":"flow","flow_id":"11111111-2222-4333-8444-555555555552","flow_version":"02.00.000","status":"verified","report":"prior-a/flow-b.json","marker":"first-flow-b","source_ledger_file":"prior-a/import-ledger/ok.flows.verified.jsonl","carried_forward":true,"carried_forward_at_utc":"2026-08-26T02:03:04.000Z","carried_forward_for_process_id":"aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeee1"}\n';
const expectedCarryForwardSha256 =
  "fd351b7baa3560f5e99db5e73039ac8d4d69857f87d99d9008eae0ddc621dc60";
const expectedActiveBytes =
  '{"process_id":"aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeee2","stage":"authoring","code":"source_missing"}\n';
const expectedResolvedBytes =
  '{"process_id":"aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeee1","process_version":"01.00.000","stage":"authoring","code":"classification_missing","resolution_status":"resolved_by_verified_scope","resolved_at_utc":"2026-08-26T01:00:00.000Z","resolved_report":"latest-a.json"}\n' +
  '{"process_id":"aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeee1","process_version":"01.00.000","stage":"authoring","code":"location_missing","resolution_status":"resolved_by_verified_scope","resolved_at_utc":"2026-08-26T01:00:00.000Z","resolved_report":"latest-a.json"}\n' +
  '{"id":"aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeee3","version":"00.00.001","stage":"flow","code":"flow_missing","resolution_status":"resolved_by_verified_scope","resolved_at_utc":"2026-08-26T01:30:00.000Z","resolved_report":"verified-c.json"}\n';
const expectedActiveSha256 = "c868ef91e6657f61072a6dcce3a711e0b9bc151acd99993fa8a1236107be8ea9";
const expectedResolvedSha256 = "f343b550837d22ea94ccf163345239a20b584eaa1ec9576c0eea7cef70ca5966";
const expectedProjectedRowsBytes =
  '{"schema_version":1,"generated_at_utc":"2026-08-26T02:03:04.000Z","dataset_type":"flow","dataset_id":"11111111-2222-4333-8444-555555555551","dataset_version":"00.00.001","process_id":"aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeee1","status":"verified","report":"current/finalize/report.json","files":{"rows":"current/final.jsonl"}}\n' +
  '{"schema_version":1,"generated_at_utc":"2026-08-26T02:03:04.000Z","process_id":"aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeee2","process_version":"00.00.001","stage":"flow.authoring","code":"bafu_name_split_unsupported","message":"Name-plan evidence is incomplete.","blocker":{"code":"bafu_name_split_unsupported","message":"Name-plan evidence is incomplete.","required_human_action":"Complete the exact BAFU authoring task."},"report":"current/authoring/report.json","required_human_action":"Complete the exact BAFU authoring task.","rerun_command":"node scripts/foundry.ts dataset-bafu-batch-import-run --process-id process-b"}\n';
const expectedProjectedRowsSha256 =
  "d49ada76420417e6af9a87b04acb8e54b93a701b5794d42b5148a5fb056d623c";

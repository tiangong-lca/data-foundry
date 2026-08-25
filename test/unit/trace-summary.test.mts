import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";

import {
  collectCommonOtherTraceEntries,
  compactFoundryTraceEntry,
  foundryTraceSummary,
  traceSummaryCount,
} from "../../scripts/lib/import-curation/internal/trace-summary.ts";

test("trace summary count traverses objects and arrays while counting scalar and array summaries", () => {
  const row = {
    root: {
      "common:other": {
        "tiangongfoundry:importTraceSummary": [{ id: 1 }, { id: 2 }],
      },
    },
    children: [
      {
        nested: {
          "common:other": {
            "tiangongfoundry:importTraceSummary": { id: 3 },
          },
        },
      },
      null,
    ],
  };
  assert.equal(traceSummaryCount(row), 3);
  assert.equal(traceSummaryCount(null), 0);
  assert.equal(traceSummaryCount("scalar"), 0);
});

test("trace collection preserves DFS order, exact paths, array suffixes, and base path", () => {
  const row = {
    first: {
      "common:other": {
        "tiangongfoundry:unresolvedTrace": [{ code: "a" }, { code: "b" }],
      },
    },
    list: [
      {
        child: {
          "common:other": {
            "tiangongfoundry:unresolvedTrace": { code: "c" },
          },
        },
      },
    ],
    last: {
      "common:other": {
        "tiangongfoundry:unresolvedTrace": null,
      },
    },
  };
  assert.deepEqual(collectCommonOtherTraceEntries(row, "tiangongfoundry:unresolvedTrace", "row"), [
    {
      path: "row.first.common:other.tiangongfoundry:unresolvedTrace[0]",
      entry: { code: "a" },
    },
    {
      path: "row.first.common:other.tiangongfoundry:unresolvedTrace[1]",
      entry: { code: "b" },
    },
    {
      path: "row.list[0].child.common:other.tiangongfoundry:unresolvedTrace",
      entry: { code: "c" },
    },
  ]);
});

test("compact trace entries preserve aliases, evidence, path, row binding, and JSON hash bytes", () => {
  const entry = {
    decisionStatus: " accepted ",
    actionItemCode: " action ",
    refObjectId: " ref-id ",
    refVersion: " 01.00.000 ",
    fieldPath: " root.field ",
    deferredReason: " reason ",
    followUp: " next ",
    sourceEvidence: { source: "fixture" },
  };
  const compact = compactFoundryTraceEntry({
    datasetType: "flow",
    identity: { id: "flow-id", version: "02.00.000" },
    rowIndex: 3,
    traceKind: "unresolved_trace",
    trace: { path: "$.flow", entry },
  });
  assert.deepEqual(compact, {
    dataset_type: "flow",
    entity_id: "flow-id",
    version: "02.00.000",
    row_index: 3,
    trace_kind: "unresolved_trace",
    path: "$.flow",
    status: "accepted",
    action_item_code: "action",
    reference_id: "ref-id",
    reference_version: "01.00.000",
    blocked_path: "root.field",
    reason: "reason",
    next_action: "next",
    evidence: { source: "fixture" },
    trace_sha256: crypto.createHash("sha256").update(JSON.stringify(entry)).digest("hex"),
  });

  const primitive = compactFoundryTraceEntry({
    datasetType: "process",
    identity: { id: "p", version: "v" },
    rowIndex: 0,
    traceKind: "primitive",
    trace: { entry: "raw" },
  });
  assert.equal(primitive.path, null);
  assert.equal(
    primitive.trace_sha256,
    crypto
      .createHash("sha256")
      .update(JSON.stringify({ value: "raw" }))
      .digest("hex"),
  );
});

test("foundry trace summary preserves grouped counts and per-group ordering", () => {
  const row = {
    "common:other": {
      "tiangongfoundry:importTraceSummary": [{ id: 1 }],
      "tiangongfoundry:unresolvedTrace": [
        { status: "blocked", code: "u1" },
        { status: "blocked", code: "u2" },
      ],
      "tiangongfoundry:sourceExchangeCompleteness": { status: "accepted", code: "s1" },
      "tiangongfoundry:unresolvedExchangeTrace": { status: "blocked", code: "e1" },
    },
  };
  const summary = foundryTraceSummary({
    datasetType: "process",
    identity: { id: "p", version: "01.00.000" },
    row,
    rowIndex: 7,
  });
  assert.equal(summary.import_trace_summary_count, 1);
  assert.equal(summary.unresolved_trace_count, 2);
  assert.equal(summary.unresolved_exchange_trace_count, 1);
  assert.equal(summary.source_exchange_completeness_count, 1);
  assert.deepEqual(
    summary.unresolved_traces.map((entry) => entry.action_item_code),
    ["u1", "u2"],
  );
  assert.deepEqual(
    summary.unresolved_exchange_traces.map((entry) => entry.action_item_code),
    ["e1"],
  );
  assert.deepEqual(
    summary.source_exchange_completeness.map((entry) => entry.action_item_code),
    ["s1"],
  );
});

test("trace compaction retains native JSON serialization errors", () => {
  assert.throws(
    () =>
      compactFoundryTraceEntry({
        datasetType: "flow",
        identity: { id: "f", version: "v" },
        rowIndex: 0,
        traceKind: "invalid",
        trace: { entry: { value: 1n } },
      }),
    TypeError,
  );
});

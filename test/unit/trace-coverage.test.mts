import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createTraceCoverageUtils } from "../../scripts/lib/trace-coverage.ts";

type TraceRow = Record<string, unknown>;

function withFixture<T>(callback: (root: string) => T): T {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "foundry-trace-coverage-"));
  try {
    return callback(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function writeJsonLines(filePath: string, rows: TraceRow[]): void {
  fs.writeFileSync(filePath, rows.map((row) => JSON.stringify(row)).join("\n") + "\n");
}

function fixtureTrace(overrides: TraceRow = {}): TraceRow {
  return {
    dataset_type: "flow",
    entity_id: "flow-id",
    version: "01.00.000",
    row_index: 0,
    trace_kind: "unresolved_trace",
    path: "$.common:other.tiangongfoundry:unresolvedTrace",
    status: "blocked",
    action_item_code: "missing_source",
    blocked_path: "flowDataSet.flowInformation",
    trace_sha256: "a".repeat(64),
    evidence: { source: "fixture" },
    ...overrides,
  };
}

function createUtils(rows: TraceRow[], observedTypes: string[] = []) {
  return createTraceCoverageUtils({
    asText: (value: unknown) => (value === undefined || value === null ? "" : String(value).trim()),
    datasetIdentity: (row: TraceRow, datasetType: string) => {
      observedTypes.push(datasetType);
      return { id: row.identity_id ?? null, version: row.identity_version ?? null };
    },
    fileExists: (filePath: string) => fs.existsSync(filePath),
    foundryTraceSummary: ({ row }: { row: TraceRow }) => ({
      unresolved_traces: Array.isArray(row.unresolved_traces) ? row.unresolved_traces : [],
      source_exchange_completeness: Array.isArray(row.source_exchange_completeness)
        ? row.source_exchange_completeness
        : [],
    }),
    readJsonLines: (filePath: string) =>
      fs
        .readFileSync(filePath, "utf8")
        .trim()
        .split(/\r?\n/u)
        .filter(Boolean)
        .map((line) => JSON.parse(line)),
    readRowsFile: () => rows,
    repoRelativePath: (filePath: string) => path.basename(filePath),
    resolveRepoPath: (filePath: string | null | undefined) => filePath ?? null,
  });
}

test("trace coverage factory exposes one stable validation surface", () => {
  assert.deepEqual(Object.keys(createUtils([])), ["validateTraceQueueCoverageForRows"]);
});

test("exact unresolved and source-completeness queues produce no blockers", () => {
  withFixture((root) => {
    const unresolved = fixtureTrace();
    const completeness = fixtureTrace({
      trace_kind: "source_exchange_completeness",
      action_item_code: "source_complete",
      status: "accepted",
      trace_sha256: "b".repeat(64),
    });
    const unresolvedFile = path.join(root, "unresolved.jsonl");
    const completenessFile = path.join(root, "complete.jsonl");
    writeJsonLines(unresolvedFile, [unresolved]);
    writeJsonLines(completenessFile, [completeness]);
    const blockers: TraceRow[] = [];
    createUtils([
      { unresolved_traces: [unresolved], source_exchange_completeness: [completeness] },
    ]).validateTraceQueueCoverageForRows({
      datasetType: "flow",
      finalRowsFile: "final.jsonl",
      traceQueues: {
        unresolved_traces: unresolvedFile,
        source_exchange_completeness_traces: completenessFile,
      },
      counts: {
        unresolved_trace_entries: 1,
        source_exchange_completeness_entries: 1,
      },
      blockers,
    });
    assert.deepEqual(blockers, []);
  });
});

test("manifest count, missing, stale, deferred/action, and hash drift emit stable blockers", () => {
  withFixture((root) => {
    const expected = fixtureTrace();
    const drifted = fixtureTrace({
      status: "deferred",
      action_item_code: "different_action",
      blocked_path: "different.path",
      trace_sha256: "c".repeat(64),
    });
    const queue = path.join(root, "unresolved.jsonl");
    writeJsonLines(queue, [drifted]);
    const blockers: TraceRow[] = [];
    createUtils([
      { unresolved_traces: [expected], source_exchange_completeness: [] },
    ]).validateTraceQueueCoverageForRows({
      datasetType: "flow",
      finalRowsFile: path.join(root, "final.jsonl"),
      traceQueues: {
        unresolved_traces: queue,
        source_exchange_completeness_traces: path.join(root, "missing.jsonl"),
      },
      counts: {
        unresolved_trace_entries: 0,
        source_exchange_completeness_entries: 1,
      },
      blockers,
    });
    assert.deepEqual(
      blockers.map((blocker) => blocker.code),
      [
        "trace_queue_manifest_count_not_final_rows",
        "trace_queue_manifest_count_not_final_rows",
        "trace_queue_final_rows_entry_missing",
        "trace_queue_stale_or_extra_entry",
      ],
    );
    assert.equal(blockers[0].trace_queue, "unresolved_traces");
    assert.equal(blockers[0].expected_count, 1);
    assert.equal(blockers[0].recorded_count, 0);
    assert.equal(blockers[2].action_item_code, undefined);
    assert.equal(blockers[2].trace_sha256, expected.trace_sha256);
    assert.equal(blockers[3].trace_sha256, drifted.trace_sha256);
  });
});

test("duplicate exact queue rows preserve count-only mismatch behavior", () => {
  withFixture((root) => {
    const expected = fixtureTrace();
    const queue = path.join(root, "unresolved.jsonl");
    writeJsonLines(queue, [expected, expected]);
    const blockers: TraceRow[] = [];
    createUtils([
      { unresolved_traces: [expected], source_exchange_completeness: [] },
    ]).validateTraceQueueCoverageForRows({
      datasetType: "flow",
      finalRowsFile: "final.jsonl",
      traceQueues: {
        unresolved_traces: queue,
        source_exchange_completeness_traces: null,
      },
      counts: {
        unresolved_trace_entries: 1,
        source_exchange_completeness_entries: 0,
      },
      blockers,
    });
    assert.deepEqual(
      blockers.map((blocker) => blocker.code),
      ["trace_queue_final_rows_count_mismatch"],
    );
    assert.equal(blockers[0].actual_count, 2);
  });
});

test("support rows derive concrete types and fallback identities in final-row order", () => {
  const observedTypes: string[] = [];
  const rows = [
    { contactDataSet: {}, dataset_id: "contact-fallback", unresolved_traces: [] },
    { sourceDataSet: {}, entity_id: "source-fallback", unresolved_traces: [] },
    { value: true, id: "support-fallback", unresolved_traces: [] },
  ];
  const blockers: TraceRow[] = [];
  createUtils(rows, observedTypes).validateTraceQueueCoverageForRows({
    datasetType: "support",
    finalRowsFile: "final.jsonl",
    traceQueues: { unresolved_traces: null, source_exchange_completeness_traces: null },
    counts: { unresolved_trace_entries: 0, source_exchange_completeness_entries: 0 },
    blockers,
  });
  assert.deepEqual(observedTypes, ["contact", "source", "support"]);
  assert.deepEqual(blockers, []);
});

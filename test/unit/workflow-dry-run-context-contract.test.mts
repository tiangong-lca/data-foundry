import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import * as dryRun from "../../scripts/lib/import-curation/internal/workflow-dry-run-context.mjs";

type JsonRecord = Record<string, unknown>;

function writeText(filePath: string, text: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, text);
}

function writeJson(filePath: string, value: unknown): void {
  writeText(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function writeJsonLines(filePath: string, rows: unknown[]): void {
  writeText(
    filePath,
    rows.map((row) => JSON.stringify(row)).join("\n") + (rows.length ? "\n" : ""),
  );
}

function withTempRoot(name: string, body: (root: string) => void): void {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `${name}-`));
  try {
    body(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test("schema and curation maps preserve filtering, exact last-write, bare first-write, aliases, and fallback", () => {
  const first = { id: "id", version: "01.00.000", marker: "first" };
  const replacement = { dataset_id: "id", version: "01.00.000", marker: "replacement" };
  const otherVersion = { id: "id", version: "02.00.000", marker: "other-version" };
  const schema = dryRun.mapSchemaRows({
    rows: [null, { marker: "missing" }, first, replacement, otherVersion],
  });
  assert.deepEqual([...schema.keys()], ["id@@01.00.000", "id", "id@@02.00.000"]);
  assert.equal(schema.get("id@@01.00.000"), replacement);
  assert.equal(schema.get("id"), first);
  assert.equal(schema.get("id@@02.00.000"), otherVersion);

  const entityFirst = { entity_id: "entity", version: "01.00.000", marker: "first" };
  const entityReplacement = { id: "entity", version: "01.00.000", marker: "replacement" };
  const curation = dryRun.mapCurationEntities({
    entities: [entityFirst, entityReplacement],
    processes: [{ entity_id: "ignored" }],
  });
  assert.equal(curation.get("entity@@01.00.000"), entityReplacement);
  assert.equal(curation.get("entity"), entityFirst);
  assert.equal(
    dryRun.mapCurationEntities({ entities: [], processes: [{ entity_id: "ignored" }] }).size,
    0,
  );
  assert.equal(
    dryRun
      .mapCurationEntities({ processes: [{ entity_id: "process", version: null }] })
      .has("process@@00.00.001"),
    true,
  );
});

test("dry-run operation normalization preserves known mappings and passthrough coercion", () => {
  assert.equal(dryRun.normalizeDryRunOperation("would_update_existing"), "update_existing");
  assert.equal(dryRun.normalizeDryRunOperation("would_insert"), "insert");
  assert.equal(dryRun.normalizeDryRunOperation("would_skip"), "skip");
  assert.equal(dryRun.normalizeDryRunOperation("custom"), "custom");
  assert.equal(dryRun.normalizeDryRunOperation(""), null);
  assert.equal(dryRun.normalizeDryRunOperation(0), null);
  assert.equal(dryRun.normalizeDryRunOperation(7), 7);
});

test("flow dry-run artifacts preserve success/failure aliases, order, duplicate replacement, missing files, and parse errors", () => {
  withTempRoot("dry-run-flow", (root) => {
    writeJson(path.join(root, "success.json"), {
      rows: [
        { id: "flow", version: "01.00.000", marker: "first" },
        { id: "flow", version: "01.00.000", marker: "replacement" },
        { marker: "missing-id" },
      ],
    });
    const failurePayload = {
      flowDataSet: {
        flowInformation: { dataSetInformation: { "common:UUID": "failed-flow" } },
      },
    };
    writeJsonLines(path.join(root, "failures.jsonl"), [
      { jsonOrdered: failurePayload, marker: "alias" },
      { payload: { id: "direct-flow", version: "02.00.000" }, marker: "payload" },
    ]);
    const result = dryRun.readFlowDryRunArtifacts(root, {
      files: { success_list: "success.json", remote_failed: "failures.jsonl" },
    });
    assert.deepEqual([...result.success.keys()], ["flow@@01.00.000"]);
    assert.equal((result.success.get("flow@@01.00.000") as JsonRecord).marker, "replacement");
    assert.deepEqual(
      [...result.failures.keys()],
      ["failed-flow@@00.00.001", "direct-flow@@02.00.000"],
    );
    assert.deepEqual(dryRun.readFlowDryRunArtifacts(root, { files: {} }), {
      success: new Map(),
      failures: new Map(),
    });
    writeText(path.join(root, "failures.jsonl"), "{bad}\n");
    assert.throws(
      () =>
        dryRun.readFlowDryRunArtifacts(root, {
          files: { remote_failed: "failures.jsonl" },
        }),
      (error: unknown) => error instanceof SyntaxError,
    );
  });
});

test("process, lifecyclemodel, and save-draft readers preserve prepared/failure overwrite order and aliases", () => {
  withTempRoot("dry-run-progress", (root) => {
    writeJsonLines(path.join(root, "progress.jsonl"), [
      { id: "id", version: "01.00.000", status: "prepared", marker: "prepared" },
      { id: "id", version: "01.00.000", status: "blocked", marker: "progress-failure" },
      { id: "other", status: "prepared", marker: "other" },
      { status: "prepared", marker: "missing-id" },
    ]);
    writeJsonLines(path.join(root, "failures.jsonl"), [
      { id: "id", version: "01.00.000", marker: "failure-file" },
      { id: "third", marker: "third" },
    ]);
    for (const reader of [
      dryRun.readProcessDryRunArtifacts,
      dryRun.readLifecyclemodelDryRunArtifacts,
      dryRun.readDatasetSaveDraftDryRunArtifacts,
    ]) {
      const result = reader(root, {
        files: { progress_jsonl: "progress.jsonl", failures_jsonl: "failures.jsonl" },
      });
      assert.deepEqual([...result.prepared.keys()], ["id@@01.00.000", "other@@00.00.001"]);
      assert.deepEqual([...result.failures.keys()], ["id@@01.00.000", "third@@00.00.001"]);
      assert.equal((result.failures.get("id@@01.00.000") as JsonRecord).marker, "failure-file");
    }
  });
});

test("remote verify blockers preserve alias order, first-seen Set order, and planned-root reference suppression", () => {
  const plannedRootKeys = new Set(["flows\u0000planned-exact\u000001.00.000"]);
  const plannedRootIds = new Set(["planned-id"]);
  const keys = dryRun.remoteVerifyBlockerKeys(
    {
      blockers: [
        {
          role: "reference",
          table: "flows",
          version: "01.00.000",
          root_id: "planned-exact",
          dataset_id: "first",
          id: "second",
          refObjectId: "planned-id",
          ref_object_id: "third",
          reference_id: "first",
        },
        { role: "root", table: "flows", id: "planned-id" },
        { role: "reference", table: "flows", id: "planned-exact", version: "02.00.000" },
      ],
    },
    { plannedRootKeys, plannedRootIds },
  );
  assert.deepEqual([...keys], ["first", "second", "third", "planned-id", "planned-exact"]);
  assert.deepEqual([...dryRun.remoteVerifyBlockerKeys(null)], []);
});

test("dry-run context retains its exact export surface", () => {
  assert.deepEqual(Object.keys(dryRun), [
    "mapCurationEntities",
    "mapSchemaRows",
    "normalizeDryRunOperation",
    "readDatasetSaveDraftDryRunArtifacts",
    "readFlowDryRunArtifacts",
    "readLifecyclemodelDryRunArtifacts",
    "readProcessDryRunArtifacts",
    "remoteVerifyBlockerKeys",
  ]);
});

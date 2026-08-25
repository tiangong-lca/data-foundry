import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import * as queueModule from "../../scripts/lib/import-curation/internal/workflow-queue-context.mjs";

type JsonObject = Record<string, any>;

const queue = queueModule as any;

function writeJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function writeJsonLines(filePath: string, rows: unknown[]): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(
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

function createQueueFixture(root: string) {
  const queueDir = path.join(root, "queue");
  const supportRows = path.join(queueDir, "tasks", "support", "input.jsonl");
  const dependencyRows = path.join(queueDir, "tasks", "flow-dependency", "input.jsonl");
  const processRows = path.join(queueDir, "tasks", "process-main", "input.jsonl");
  const closureFile = path.join(queueDir, "tasks", "process-main", "closure.json");
  writeJsonLines(supportRows, [{ sourceDataSet: { id: "support-source" } }]);
  writeJsonLines(dependencyRows, [{ flowDataSet: { id: "dependency-flow" } }]);
  writeJsonLines(processRows, [{ processDataSet: { id: "process-main" } }]);
  writeJson(closureFile, {
    dependencies: {
      local_tasks: [
        { task_id: "flow-dependency", ref: "flow-ref", ref_path: "exchanges.0" },
        { task_id: "missing-task", ref: "missing-ref", ref_path: "exchanges.1" },
      ],
    },
  });
  const tasks = [
    {
      schema_version: 2,
      task_id: "support",
      entity_type: "support",
      entity_id: "support-id",
      version: "00.00.001",
      lock_key: "support-lock",
      depends_on: [],
      input_rows_file: "tasks/support/input.jsonl",
    },
    {
      schema_version: 2,
      task_id: "flow-dependency",
      entity_type: "flow",
      entity_id: "flow-id",
      version: "00.00.001",
      lock_key: "flow-lock",
      depends_on: ["support"],
      input_rows_file: "tasks/flow-dependency/input.jsonl",
    },
    {
      schema_version: 2,
      task_id: "process-main",
      entity_type: "process",
      entity_id: "process-id",
      version: "01.00.000",
      lock_key: "process-lock",
      depends_on: ["flow-dependency", "support"],
      input_rows_file: "tasks/process-main/input.jsonl",
      closure_file: "tasks/process-main/closure.json",
      run_plan_file: "tasks/process-main/run-plan.json",
    },
    {
      task_id: "process-fallback",
      entity_type: "process",
      entity_id: "process-id",
      version: "02.00.000",
      input_rows_file: "tasks/process-fallback/missing.jsonl",
    },
  ];
  writeJson(path.join(queueDir, "outputs", "curation-queue-manifest.json"), {
    schema_version: 2,
    status: "ready",
    counts: { tasks: tasks.length },
    blockers: [{ code: "queue-warning" }],
    tasks: [null, "ignored", ...tasks],
  });
  return { queueDir, tasks };
}

test("annual-supply schema actions preserve coercion, sentinel policy, deterministic branches, and generic AI fallback", () => {
  assert.equal(
    queue.annualSupplyFieldPath,
    "processDataSet.modellingAndValidation.dataSourcesTreatmentAndRepresentativeness.annualSupplyOrProductionVolume",
  );
  assert.equal(queue.isAnnualSupplyTarget("annual_supply_or_production_volume_missing", ""), true);
  assert.equal(queue.isAnnualSupplyTarget(null, queue.annualSupplyFieldPath), true);
  assert.equal(queue.isAnnualSupplyTarget("other", "other.path"), false);
  assert.equal(
    queue.schemaIssueInstruction({ code: "annual_supply_or_production_volume_missing" }),
    "Use source evidence or an explicitly documented profile fallback to write annualSupplyOrProductionVolume as a real annualized quantity with unit, for example '<number> <unit>/year'. If no annualized source evidence exists, Foundry deterministic cleanup must write the intentionally non-physical sentinel '9999 missing-data-sentinel/year' so database-side follow-up can bulk-locate and replace it later.",
  );
  assert.equal(
    queue.schemaIssueInstruction({ code: "invalid_format", path: "field" }),
    "Use the SDK schema and methodology YAML for this field to replace the invalid value with a schema-valid source-backed value.",
  );
  assert.equal(queue.schemaIssueInstruction({ code: "other" }), null);

  const annual = queue.schemaIssueCurationAction({
    code: "annual_supply_or_production_volume_missing",
    path: queue.annualSupplyFieldPath,
    message: "missing",
  });
  assert.equal(annual.action_kind, "annual_supply_sentinel_completion");
  assert.equal(annual.required_owner, "foundry_deterministic_cleanup");
  assert.equal(annual.ai_required, false);
  assert.equal(annual.sentinel_value, "9999 missing-data-sentinel/year");
  assert.equal(annual.sentinel_cleanup_path, queue.annualSupplyFieldPath);

  assert.deepEqual(
    queue.schemaIssueCurationAction({
      code: "unsupported_extension",
      path: "common:other.tidasimport:sourceTrace",
      message: "trace",
    }),
    {
      source: "schema",
      code: "unsupported_extension",
      path: "common:other.tidasimport:sourceTrace",
      message: "trace",
      instruction:
        "Preserve sourceTrace in the authoring package context, then remove or externalize it before remote write.",
      action_kind: "source_trace_externalization",
      required_owner: "foundry_deterministic_cleanup",
      ai_required: false,
    },
  );
  const timestamp = queue.schemaIssueCurationAction({
    code: "invalid_format",
    path: "administrativeInformation.common:timeStamp",
  });
  assert.equal(timestamp.action_kind, "timestamp_normalization");
  assert.equal(timestamp.ai_required, false);
  const generic = queue.schemaIssueCurationAction({ code: "required", path: "name.baseName" });
  assert.equal(generic.action_kind, "ai_authoring");
  assert.equal(generic.required_owner, "foundry_ai_authoring");
  assert.equal(generic.ai_required, true);
});

test("curation queue loading preserves task order, filtering, duplicate-map behavior, and native path errors", () => {
  withTempRoot("queue-context-load", (root) => {
    assert.equal(queue.readCurationQueueContext(root, {}), null);
    assert.throws(
      () => queue.readCurationQueueContext(root, { queueDir: "missing" }),
      new Error("--queue-dir must point to an existing curation queue directory: missing"),
    );
    fs.mkdirSync(path.join(root, "empty-queue"), { recursive: true });
    assert.throws(
      () => queue.readCurationQueueContext(root, { queueDir: "empty-queue" }),
      new Error("--queue-dir is missing outputs/curation-queue-manifest.json: empty-queue"),
    );

    const { queueDir, tasks } = createQueueFixture(root);
    const context = queue.readCurationQueueContext(root, { queueDir: "queue" });
    assert.equal(context.queueDir, queueDir);
    assert.equal(context.tasks.length, 4);
    assert.deepEqual(
      context.tasks.map((task: JsonObject) => task.task_id),
      tasks.map((task) => task.task_id),
    );
    assert.equal(context.tasksById.get("process-main"), context.tasks[2]);
    assert.equal(context.tasksById.has(""), false);
  });
});

test("queue task paths, summaries, rows, exact identity preference, and id fallback stay stable", () => {
  withTempRoot("queue-context-task", (root) => {
    createQueueFixture(root);
    const context = queue.readCurationQueueContext(root, { queueDir: "queue" });
    const task = context.tasksById.get("process-main");
    assert.equal(
      queue.queueFilePath(root, context, task.input_rows_file),
      path.join(root, "queue", "tasks", "process-main", "input.jsonl"),
    );
    assert.equal(
      queue.queueFileRelativePath(root, context, task.run_plan_file),
      "tasks/process-main/run-plan.json",
      "missing base-relative files fall back to the repository root",
    );
    assert.deepEqual(queue.summarizeQueueTask(root, context, task), {
      schema_version: 2,
      entity_type: "process",
      task_id: "process-main",
      entity_id: "process-id",
      version: "01.00.000",
      lock_key: "process-lock",
      depends_on: ["flow-dependency", "support"],
      input_rows_file: "queue/tasks/process-main/input.jsonl",
      closure_file: "queue/tasks/process-main/closure.json",
      run_plan_file: "tasks/process-main/run-plan.json",
    });
    assert.equal(queue.summarizeQueueTask(root, context, null), null);
    assert.deepEqual(queue.readQueueTaskRows(root, context, task), [
      { processDataSet: { id: "process-main" } },
    ]);
    assert.deepEqual(
      queue.readQueueTaskRows(root, context, context.tasksById.get("process-fallback")),
      [],
    );

    assert.equal(
      queue.findQueueTask(context, "process", { id: "process-id", version: "01.00.000" }),
      task,
    );
    assert.equal(
      queue.findQueueTask(context, "process", { id: "process-id", version: "missing" }),
      task,
      "id-only fallback keeps first manifest order",
    );
    assert.equal(queue.findQueueTask(context, "lifecyclemodel", { id: "x", version: "1" }), null);
    assert.equal(queue.findQueueTask(null, "process", { id: "x", version: "1" }), null);
  });
});

test("queue authoring context preserves not-applicable, missing, closure dependency, support and note order", () => {
  withTempRoot("queue-context-authoring", (root) => {
    createQueueFixture(root);
    const context = queue.readCurationQueueContext(root, { queueDir: "queue" });
    assert.equal(queue.buildQueueAuthoringContext(root, null, "process", { id: "x" }), null);
    const lifecycle = queue.buildQueueAuthoringContext(root, context, "lifecyclemodel", {
      id: "model",
      version: "1",
    });
    assert.equal(lifecycle.status, "not_applicable");
    assert.equal(
      lifecycle.reason,
      "curation queue currently attaches entity closure for flow and process rows.",
    );
    const missing = queue.buildQueueAuthoringContext(root, context, "flow", {
      id: "missing",
      version: "1",
    });
    assert.deepEqual(
      {
        status: missing.status,
        entity_type: missing.entity_type,
        entity_id: missing.entity_id,
        version: missing.version,
      },
      { status: "missing_task", entity_type: "flow", entity_id: "missing", version: "1" },
    );

    const attached = queue.buildQueueAuthoringContext(root, context, "process", {
      id: "process-id",
      version: "01.00.000",
    });
    assert.equal(attached.status, "attached");
    assert.equal(attached.queue_dir, "queue");
    assert.equal(attached.manifest_file, "queue/outputs/curation-queue-manifest.json");
    assert.deepEqual(attached.queue_counts, { tasks: 4 });
    assert.deepEqual(attached.queue_blockers, [{ code: "queue-warning" }]);
    assert.equal(attached.closure_file, "queue/tasks/process-main/closure.json");
    assert.deepEqual(
      attached.dependency_rows.map((row: JsonObject) => ({
        ref: row.ref,
        task_id: row.task?.task_id ?? null,
        input_rows: row.input_rows,
      })),
      [
        {
          ref: "flow-ref",
          task_id: "flow-dependency",
          input_rows: [{ flowDataSet: { id: "dependency-flow" } }],
        },
        { ref: "missing-ref", task_id: null, input_rows: [] },
      ],
    );
    assert.deepEqual(
      attached.support_rows.map((row: JsonObject) => ({
        task_id: row.task.task_id,
        input_rows: row.input_rows,
      })),
      [
        {
          task_id: "support",
          input_rows: [{ sourceDataSet: { id: "support-source" } }],
        },
      ],
    );
    assert.deepEqual(attached.notes, [
      "dependency_rows are local flow/support closure inputs for this entity task.",
      "AI output must still be a structured patch or build plan; database writes are not allowed from this package.",
    ]);
  });
});

test("authoring queue context preserves JSONL order, object filtering, last exact identity, id fallback, and errors", () => {
  withTempRoot("authoring-queue-context", (root) => {
    assert.equal(queue.readAuthoringQueueContext(root, null, "classification"), null);
    assert.throws(
      () => queue.readAuthoringQueueContext(root, "missing.jsonl", "classification"),
      new Error("--classification-queue must point to a readable JSONL queue file: missing.jsonl"),
    );
    const queuePath = path.join(root, "classification.jsonl");
    writeJsonLines(queuePath, [
      null,
      "ignored",
      { dataset_id: "entity", dataset_version: "01.00.000", marker: "first" },
      { entity_id: "entity", version: "02.00.000", marker: "second-version" },
      { dataset_id: "entity", dataset_version: "01.00.000", marker: "last-exact" },
      { process_id: "other", marker: "default-version" },
      { id: "", marker: "missing-id" },
    ]);
    const context = queue.readAuthoringQueueContext(root, "classification.jsonl", "classification");
    assert.equal(context.kind, "classification");
    assert.equal(context.path, queuePath);
    assert.deepEqual(
      context.rows.map((row: JsonObject) => row.marker),
      ["first", "second-version", "last-exact", "default-version", "missing-id"],
    );
    assert.equal(context.rowsByIdentity.get("entity@@01.00.000").marker, "last-exact");
    assert.equal(context.rowsByIdentity.get("other@@00.00.001").marker, "default-version");
    assert.equal(context.rowsByIdentity.has("@@00.00.001"), false);
    assert.deepEqual(
      queue
        .authoringQueueRowsForIdentity(context, {
          id: "entity",
          version: "01.00.000",
        })
        .map((row: JsonObject) => row.marker),
      ["last-exact"],
    );
    assert.deepEqual(
      queue
        .authoringQueueRowsForIdentity(context, { id: "entity", version: "missing" })
        .map((row: JsonObject) => row.marker),
      ["first", "second-version", "last-exact"],
    );
    assert.deepEqual(queue.authoringQueueRowsForIdentity(null, { id: "entity" }), []);

    const invalidPath = path.join(root, "invalid.jsonl");
    fs.writeFileSync(invalidPath, '{"ok":true}\n{bad}\n');
    assert.throws(
      () => queue.readAuthoringQueueContext(root, "invalid.jsonl", "classification"),
      (error: unknown) => error instanceof SyntaxError,
    );
  });
});

test("identity preflight path preserves explicit precedence, default topology, existence guard, and null inputs", () => {
  withTempRoot("identity-preflight-path", (root) => {
    assert.equal(
      queue.identityPreflightIndexPath(
        root,
        { identityPreflightIndex: "explicit/index.jsonl" },
        path.join(root, "scope", "rows", "processes.jsonl"),
      ),
      path.join(root, "explicit", "index.jsonl"),
    );
    assert.equal(queue.identityPreflightIndexPath(root, {}, null), null);
    const rowsFile = path.join(root, "scope", "rows", "processes.jsonl");
    const defaultPath = path.join(
      root,
      "scope",
      "identity-preflight-requests",
      "identity-preflight-requests.jsonl",
    );
    assert.equal(queue.identityPreflightIndexPath(root, {}, rowsFile), null);
    writeJsonLines(defaultPath, []);
    assert.equal(queue.identityPreflightIndexPath(root, {}, rowsFile), defaultPath);
  });
});

test("workflow queue context retains its exact export surface", () => {
  assert.deepEqual(Object.keys(queue).sort(), [
    "annualSupplyFieldPath",
    "authoringQueueRowsForIdentity",
    "buildQueueAuthoringContext",
    "findQueueTask",
    "identityPreflightIndexPath",
    "isAnnualSupplySchemaIssue",
    "isAnnualSupplyTarget",
    "queueFilePath",
    "queueFileRelativePath",
    "readAuthoringQueueContext",
    "readCurationQueueContext",
    "readQueueTaskRows",
    "schemaIssueCurationAction",
    "schemaIssueInstruction",
    "summarizeQueueTask",
  ]);
});

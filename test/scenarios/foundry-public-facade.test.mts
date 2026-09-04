import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { runFoundryRuntimeCommand } from "../../scripts/runtime-entry.ts";

const repoRoot = path.resolve(import.meta.dirname, "../..");
const entry = path.join(repoRoot, "scripts/foundry.ts");

function run(cwd: string, args: string[]) {
  const result = spawnSync(process.execPath, [entry, ...args], {
    cwd,
    env: {
      PATH: process.env.PATH,
      HOME: cwd,
      USERPROFILE: cwd,
      FOUNDRY_CLI_EXPECTATION: "/task/input/cannot-select-runtime.json",
      TIDAS_BIN: "/task/input/cannot-select-tidas",
    },
    encoding: "utf8",
    timeout: 30_000,
  });
  assert.equal(result.signal, null);
  assert.equal(result.stderr, "");
  const lines = result.stdout.trimEnd().split("\n");
  assert.equal(lines.length, 1, result.stdout);
  return { exit: result.status, json: JSON.parse(lines[0]) as Record<string, unknown> };
}

function writeSpec(file: string, input: string) {
  fs.writeFileSync(
    file,
    `${JSON.stringify({
      schema: "tiangong-foundry.task-start.v1",
      request_id: "public-case",
      actor_id: "public-test-actor",
      lane: "external-dataset-curated-import",
      profile_id: "generic",
      target_entities: ["flow"],
      sources: [{ path: input }],
      seed: null,
      account_intent: null,
      preparation: {
        operation: "dataset-curation-cleanup",
        type: "flow",
        input,
        source_input: null,
        output_directory: "outputs/cleanup",
      },
    })}\n`,
  );
}

test("hierarchical facade emits one JSON envelope and resumes only registered local work", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "foundry-public-facade-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const cwd = path.join(root, "unrelated cwd");
  const workspace = path.join(root, "项目 workspace");
  fs.mkdirSync(cwd);
  const input = path.join(root, "flow.jsonl");
  const spec = path.join(root, "task.json");
  fs.writeFileSync(input, '{"flowDataSet":{}}\n');
  writeSpec(spec, input);

  const unknown = run(cwd, ["workspace", "explode", "--json"]);
  assert.equal(unknown.exit, 2);
  assert.equal(unknown.json.operation, "unknown");
  assert.equal(
    (unknown.json.blockers as Array<{ code: string }>)[0]?.code,
    "unknown_public_operation",
  );

  const missingJson = run(cwd, ["workspace", "init", "--workspace", workspace]);
  assert.equal(missingJson.exit, 2);
  assert.equal(missingJson.json.status, "needs_input");
  assert.equal(fs.existsSync(workspace), false);

  const initialized = run(cwd, ["workspace", "init", "--workspace", workspace, "--json"]);
  assert.equal(initialized.exit, 0);
  assert.equal(initialized.json.schema, "tiangong-foundry.operation-result.v1");
  assert.equal(initialized.json.operation, "workspace.init");
  assert.equal(initialized.json.status, "ready");

  const doctor = run(cwd, ["doctor", "--workspace", workspace, "--json"]);
  assert.equal(doctor.exit, 0);
  assert.equal(doctor.json.operation, "doctor");
  assert.equal(
    (doctor.json.runtime_identity as { qualification: { status: string } }).qualification.status,
    "required",
  );
  assert.ok(
    (doctor.json.next_actions as Array<{ code: string }>).some(
      (action) => action.code === "provide_qualified_runtime",
    ),
  );

  const started = run(cwd, ["task", "start", "--workspace", workspace, "--spec", spec, "--json"]);
  assert.equal(started.exit, 0);
  const taskId = String(started.json.task_id);
  assert.match(taskId, /^task-[0-9a-f]{16}-r0001$/u);
  const resumeAction = (started.json.next_actions as Array<Record<string, unknown>>)[0];
  assert.equal(resumeAction.kind, "command");
  assert.equal(resumeAction.cwd, fs.realpathSync(workspace));
  assert.equal(Object.hasOwn(resumeAction, "display"), false);
  assert.ok(Array.isArray(resumeAction.argv));

  const wrongActor = run(cwd, [
    "task",
    "status",
    "--workspace",
    workspace,
    "--task",
    taskId,
    "--actor",
    "another-actor",
    "--json",
  ]);
  assert.equal(wrongActor.exit, 4);
  assert.equal(wrongActor.json.status, "blocked");
  assert.deepEqual(wrongActor.json.artifacts, []);

  const missingTask = run(cwd, [
    "task",
    "status",
    "--workspace",
    workspace,
    "--task",
    "task-0000000000000000-r0001",
    "--actor",
    "public-test-actor",
    "--json",
  ]);
  assert.equal(missingTask.exit, 2);
  assert.equal(missingTask.json.status, "needs_input");
  assert.equal((missingTask.json.blockers as Array<{ code: string }>)[0]?.code, "task_not_found");

  const resumed = run(cwd, [
    "task",
    "resume",
    "--workspace",
    workspace,
    "--task",
    taskId,
    "--actor",
    "public-test-actor",
    "--json",
  ]);
  assert.equal(resumed.exit, 0);
  assert.equal(resumed.json.status, "ready");
  assert.ok(
    (resumed.json.artifacts as Array<{ role: string }>).some(
      (artifact) => artifact.role === "cleaned_rows",
    ),
  );

  const status = run(cwd, [
    "task",
    "status",
    "--workspace",
    workspace,
    "--task",
    taskId,
    "--actor",
    "public-test-actor",
    "--json",
  ]);
  assert.equal(status.exit, 0);
  assert.equal(status.json.status, "ready");
  assert.equal(
    status.json.permissions && (status.json.permissions as { state: string }).state,
    "not_required",
  );
});

test("migration dry-run classifies legacy attempts without modifying their bytes", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "foundry-public-migration-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const workspace = path.join(root, "legacy");
  const attempt = path.join(workspace, ".foundry", "attempts", "unknown.json");
  fs.mkdirSync(path.dirname(attempt), { recursive: true });
  fs.writeFileSync(attempt, '{"status":"UNKNOWN_DO_NOT_REPLAY"}\n');
  const before = fs.readFileSync(attempt);
  const entriesBefore = fs.readdirSync(path.dirname(attempt));

  const result = run(root, [
    "workspace",
    "migrate",
    "--workspace",
    workspace,
    "--dry-run",
    "--json",
  ]);
  assert.equal(result.exit, 0);
  assert.equal(result.json.operation, "workspace.migrate");
  const artifact = (result.json.artifacts as Array<{ value: Record<string, unknown> }>)[0];
  assert.equal(artifact.value.disposition, "explicit_migration_required");
  assert.ok(
    (artifact.value.entries as Array<{ path: string; state_class: string }>).some(
      (entry) =>
        entry.path === "attempts/unknown.json" && entry.state_class === "attempted-or-unknown",
    ),
  );
  assert.deepEqual(fs.readFileSync(attempt), before);
  assert.deepEqual(fs.readdirSync(path.dirname(attempt)), entriesBefore);
  assert.equal(fs.existsSync(path.join(workspace, ".foundry", "workspace.json")), false);
});

test("an already-aborted host returns exit 130 without creating workspace state", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "foundry-public-abort-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const workspace = path.join(root, "workspace");
  const controller = new AbortController();
  controller.abort("fixture");
  let stdout = "";
  let exit = -1;
  await runFoundryRuntimeCommand(
    [process.execPath, "runtime-entry", "workspace", "init", "--workspace", workspace, "--json"],
    {
      signal: controller.signal,
      writeStdout: (text) => {
        stdout += text;
      },
      setExitCode: (code) => {
        exit = code;
      },
    },
  );
  assert.equal(exit, 130);
  assert.equal(JSON.parse(stdout).blockers[0].code, "operation_interrupted");
  assert.equal(fs.existsSync(workspace), false);
});

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { runFoundryRuntimeCommand } from "../../scripts/runtime-entry.ts";
import {
  commandNextActionBindingSha256,
  exitCodeForFoundryOperationResult,
} from "../../scripts/lib/foundry-operation-result.ts";
import { createFoundryFacade } from "../../scripts/foundry-facade.ts";

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
  const injectedRuntime = run(cwd, [
    "workspace",
    "init",
    "--workspace",
    workspace,
    "--runtime-expectation",
    "/task/input.json",
    "--json",
  ]);
  assert.equal(injectedRuntime.exit, 2);
  assert.equal(
    (injectedRuntime.json.blockers as Array<{ code: string }>)[0]?.code,
    "argument_option_unsupported",
  );
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
  const accountArgs = [
    "--expected-project-ref",
    "aaaaaaaaaaaaaaaaaaaa",
    "--expected-user-id",
    "11111111-1111-4111-8111-111111111111",
  ];
  const needsAuth = run(cwd, ["doctor", "--workspace", workspace, ...accountArgs, "--json"]);
  assert.equal(needsAuth.exit, 3);
  assert.equal(needsAuth.json.status, "needs_auth");
  const sessionReference = path.join(root, "private-session.json");
  fs.writeFileSync(sessionReference, '{"opaque":"unchanged"}\n', { mode: 0o600 });
  const sessionBefore = fs.readFileSync(sessionReference);
  const accountReady = run(cwd, [
    "doctor",
    "--workspace",
    workspace,
    ...accountArgs,
    "--session-reference",
    sessionReference,
    "--json",
  ]);
  assert.equal(accountReady.exit, 0);
  assert.equal(
    (accountReady.json.runtime_identity as { account_readiness: { status: string } })
      .account_readiness.status,
    "configured_unverified",
  );
  assert.deepEqual(fs.readFileSync(sessionReference), sessionBefore);

  const started = run(cwd, ["task", "start", "--workspace", workspace, "--spec", spec, "--json"]);
  assert.equal(started.exit, 0);
  const taskId = String(started.json.task_id);
  assert.match(taskId, /^task-[0-9a-f]{64}-r0001$/u);
  const resumeAction = (started.json.next_actions as Array<Record<string, unknown>>)[0];
  assert.equal(resumeAction.kind, "command");
  assert.equal(resumeAction.cwd, fs.realpathSync(workspace));
  assert.equal(Object.hasOwn(resumeAction, "display"), false);
  assert.ok(Array.isArray(resumeAction.argv));
  const { binding_sha256: bindingSha256, ...boundAction } = resumeAction;
  assert.equal(bindingSha256, commandNextActionBindingSha256(boundAction));
  assert.notEqual(
    bindingSha256,
    commandNextActionBindingSha256({
      ...boundAction,
      argv: [...(boundAction.argv as string[]), "--different-task"],
    }),
  );

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
    `task-${"0".repeat(64)}-r0001`,
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

test("credential-like or linked task specs are stable needs-input errors", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "foundry-public-input-errors-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const workspace = path.join(root, "workspace");
  assert.equal(run(root, ["workspace", "init", "--workspace", workspace, "--json"]).exit, 0);
  const credential = path.join(root, ".env");
  fs.writeFileSync(credential, "PRIVATE=unchanged\n", { mode: 0o600 });
  const credentialBefore = fs.readFileSync(credential);
  const credentialResult = run(root, [
    "task",
    "start",
    "--workspace",
    workspace,
    "--spec",
    credential,
    "--json",
  ]);
  assert.equal(credentialResult.exit, 2);
  assert.equal(credentialResult.json.status, "needs_input");
  assert.equal(
    (credentialResult.json.blockers as Array<{ code: string }>)[0]?.code,
    "credential_input_forbidden",
  );
  assert.deepEqual(fs.readFileSync(credential), credentialBefore);

  const target = path.join(root, "target.json");
  const linked = path.join(root, "linked.json");
  fs.writeFileSync(target, "{}\n");
  fs.symlinkSync(target, linked);
  const linkedResult = run(root, [
    "task",
    "start",
    "--workspace",
    workspace,
    "--spec",
    linked,
    "--json",
  ]);
  assert.equal(linkedResult.exit, 2);
  assert.equal(linkedResult.json.status, "needs_input");
  assert.equal(
    (linkedResult.json.blockers as Array<{ code: string }>)[0]?.code,
    "regular_file_required",
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

test("migration dry-run bounds envelope size and inventories credential or oversized files without reading them", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "foundry-public-migration-bounds-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const workspace = path.join(root, "legacy");
  const legacy = path.join(workspace, ".foundry", "legacy");
  fs.mkdirSync(legacy, { recursive: true });
  const credential = path.join(legacy, ".env.production");
  fs.writeFileSync(credential, "PRIVATE=unchanged\n", { mode: 0o600 });
  const credentialBefore = fs.readFileSync(credential);
  const oversized = path.join(legacy, "large.bin");
  fs.writeFileSync(oversized, "");
  fs.truncateSync(oversized, 64 * 1024 * 1024 + 1);

  const bounded = run(root, [
    "workspace",
    "migrate",
    "--workspace",
    workspace,
    "--dry-run",
    "--json",
  ]);
  assert.equal(bounded.exit, 0);
  const plan = (
    bounded.json.artifacts as Array<{ value: { entries: Array<Record<string, unknown>> } }>
  )[0].value;
  const credentialEntry = plan.entries.find((entry) => entry.path === "legacy/.env.production");
  assert.equal(credentialEntry?.state_class, "authorization-or-account");
  assert.equal(credentialEntry?.sha256, null);
  const oversizedEntry = plan.entries.find((entry) => entry.path === "legacy/large.bin");
  assert.equal(oversizedEntry?.bytes, 64 * 1024 * 1024 + 1);
  assert.equal(oversizedEntry?.sha256, null);
  assert.deepEqual(fs.readFileSync(credential), credentialBefore);

  for (let index = 0; index < 10_000; index += 1)
    fs.writeFileSync(path.join(legacy, `entry-${String(index).padStart(5, "0")}`), "");
  const overLimit = run(root, [
    "workspace",
    "migrate",
    "--workspace",
    workspace,
    "--dry-run",
    "--json",
  ]);
  assert.equal(overLimit.exit, 4);
  assert.equal(overLimit.json.status, "blocked");
  assert.equal(
    (overLimit.json.blockers as Array<{ code: string }>)[0]?.code,
    "migration_inventory_limit",
  );
  assert.deepEqual(fs.readFileSync(credential), credentialBefore);
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

  const signalCounts = [process.listenerCount("SIGINT"), process.listenerCount("SIGTERM")];
  const initializedWorkspace = path.join(root, "initialized");
  await runFoundryRuntimeCommand(
    [
      process.execPath,
      "runtime-entry",
      "workspace",
      "init",
      "--workspace",
      initializedWorkspace,
      "--json",
    ],
    { writeStdout: () => undefined, setExitCode: () => undefined },
  );
  assert.deepEqual(
    [process.listenerCount("SIGINT"), process.listenerCount("SIGTERM")],
    signalCounts,
  );
});

test("cooperative interruption after an atomic mutation reports exit 130 and retains evidence", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "foundry-public-midflight-abort-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const workspace = path.join(root, "workspace");
  let reads = 0;
  const signal = {
    get aborted() {
      reads += 1;
      return reads >= 3;
    },
  } as AbortSignal;
  const result = createFoundryFacade({
    moduleUrl: new URL("../../scripts/runtime-entry.ts", import.meta.url).href,
    workspace,
    signal,
  }).initialize();
  assert.equal(result.status, "failed");
  assert.equal(result.blockers[0]?.code, "operation_interrupted");
  assert.equal(exitCodeForFoundryOperationResult(result), 130);
  assert.equal(fs.existsSync(path.join(workspace, ".foundry", "workspace.json")), true);
});

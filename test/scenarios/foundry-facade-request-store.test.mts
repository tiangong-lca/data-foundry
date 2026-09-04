import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createFoundryFacade } from "../../scripts/foundry-facade.ts";
import { sha256Json } from "../../scripts/lib/identity-preflight-proof.ts";

const moduleUrl = new URL("../../scripts/runtime-entry.ts", import.meta.url).href;

function writeSpec(file: string, input: string) {
  fs.writeFileSync(
    file,
    `${JSON.stringify({
      schema: "tiangong-foundry.task-start.v1",
      request_id: "request-001",
      actor_id: "agent/session-001",
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

test("facade request revisions are deterministic, idempotent and preserve predecessor tasks", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "foundry-facade-request-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const workspace = path.join(root, "用户 project");
  const cacheBase = path.join(root, "cache");
  const input = path.join(root, "flow.jsonl");
  const spec = path.join(root, "task.json");
  fs.writeFileSync(
    input,
    `${JSON.stringify({
      flowDataSet: {
        administrativeInformation: {
          dataEntryBy: { "common:timeStamp": "2026-08-01T12:30:00+08:00" },
        },
      },
    })}\n`,
  );
  writeSpec(spec, input);
  const facade = createFoundryFacade({ moduleUrl, workspace, cacheBase });
  assert.equal(facade.initialize().status, "ready");

  const [first, concurrent] = await Promise.all([
    facade.start({ specFile: spec }),
    facade.start({ specFile: spec }),
  ]);
  assert.deepEqual(concurrent, first);
  assert.equal(first.operation, "task.start");
  assert.equal(first.status, "ready");
  assert.match(first.task_id ?? "", /^task-[0-9a-f]{64}-r0001$/u);
  const firstTaskId = String(first.task_id);
  const requestFiles = fs
    .readdirSync(path.join(workspace, ".foundry/state/facade-requests"))
    .filter((name) => name.endsWith(".json"));
  assert.equal(requestFiles.length, 1);
  const requestIndex = path.join(workspace, ".foundry/state/facade-requests", requestFiles[0]);
  const indexBefore = fs.readFileSync(requestIndex);
  const jobBefore = fs.readFileSync(
    path.join(workspace, ".foundry/workspaces", firstTaskId, "foundry-job.json"),
  );
  assert.deepEqual(await facade.start({ specFile: spec }), first);
  assert.deepEqual(fs.readFileSync(requestIndex), indexBefore);
  assert.deepEqual(
    fs.readFileSync(path.join(workspace, ".foundry/workspaces", firstTaskId, "foundry-job.json")),
    jobBefore,
  );

  const resumed = await facade.resume({ taskId: firstTaskId, actorId: "agent/session-001" });
  assert.equal(resumed.operation, "task.resume");
  assert.equal(resumed.status, "ready");
  assert.ok(
    resumed.artifacts.some((artifact: { role: string }) => artifact.role === "cleaned_rows"),
  );
  const artifactIndex = path.join(
    workspace,
    ".foundry/workspaces",
    firstTaskId,
    "artifact-index.jsonl",
  );
  const artifactsBefore = fs.readFileSync(artifactIndex);
  assert.deepEqual(
    await facade.resume({ taskId: firstTaskId, actorId: "agent/session-001" }),
    resumed,
  );
  assert.deepEqual(fs.readFileSync(artifactIndex), artifactsBefore);

  const attempt = path.join(
    workspace,
    ".foundry/workspaces",
    firstTaskId,
    "attempts",
    "unknown.json",
  );
  fs.mkdirSync(path.dirname(attempt), { recursive: true });
  fs.writeFileSync(attempt, '{"status":"UNKNOWN_DO_NOT_REPLAY"}\n');
  const readbackOnly = await facade.resume({
    taskId: firstTaskId,
    actorId: "agent/session-001",
  });
  assert.equal(readbackOnly.status, "blocked");
  assert.equal(readbackOnly.blockers[0]?.code, "mutation_readback_required");
  assert.deepEqual(fs.readFileSync(artifactIndex), artifactsBefore);

  fs.appendFileSync(input, '{"flowDataSet":{}}\n');
  const second = await facade.start({ specFile: spec });
  assert.equal(second.status, "ready");
  assert.match(second.task_id ?? "", /^task-[0-9a-f]{64}-r0002$/u);
  const secondTaskId = String(second.task_id);
  assert.notEqual(second.task_id, first.task_id);
  const request = JSON.parse(fs.readFileSync(requestIndex, "utf8"));
  assert.equal(request.revisions.length, 2);
  assert.equal(request.revisions[1].predecessor_task_id, first.task_id);
  assert.equal(fs.existsSync(path.join(workspace, ".foundry/workspaces", firstTaskId)), true);
  assert.equal(fs.existsSync(path.join(workspace, ".foundry/workspaces", secondTaskId)), true);
  const fakeCompletion = path.join(
    workspace,
    ".foundry/workspaces",
    secondTaskId,
    "outputs",
    "dataset-import-completion-report.json",
  );
  fs.mkdirSync(path.dirname(fakeCompletion), { recursive: true });
  fs.writeFileSync(
    fakeCompletion,
    `${JSON.stringify({ status: "completed", task_id: secondTaskId, blockers: [] })}\n`,
  );
  assert.equal(
    (await facade.status({ taskId: secondTaskId, actorId: "agent/session-001" })).status,
    "ready",
  );

  const movedInput = path.join(root, "moved-flow.jsonl");
  fs.copyFileSync(input, movedInput);
  writeSpec(spec, movedInput);
  const third = await facade.start({ specFile: spec });
  assert.match(third.task_id ?? "", /^task-[0-9a-f]{64}-r0003$/u);
  assert.notEqual(third.task_id, second.task_id);
  assert.equal(
    JSON.parse(fs.readFileSync(requestIndex, "utf8")).revisions[2].predecessor_task_id,
    second.task_id,
  );

  const wrongActor = await facade.status({
    taskId: secondTaskId,
    actorId: "different-agent",
  });
  assert.equal(wrongActor.status, "blocked");
  assert.deepEqual(wrongActor.artifacts, []);
  assert.equal(wrongActor.blockers[0]?.code, "task_actor_mismatch");

  const authorization = path.join(
    workspace,
    ".foundry/workspaces",
    secondTaskId,
    "authorization.json",
  );
  fs.symlinkSync(input, authorization);
  const linkedAuthorization = await facade.status({
    taskId: secondTaskId,
    actorId: "agent/session-001",
  });
  assert.equal(linkedAuthorization.status, "blocked");
  assert.equal(linkedAuthorization.blockers[0]?.code, "task_authorization_state_invalid");
  assert.deepEqual(linkedAuthorization.artifacts, []);
});

test("resume preserves an indexed completed projection", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "foundry-facade-completed-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const workspace = path.join(root, "project");
  const input = path.join(root, "flow.jsonl");
  const spec = path.join(root, "task.json");
  fs.writeFileSync(input, '{"flowDataSet":{}}\n');
  writeSpec(spec, input);
  const facade = createFoundryFacade({ moduleUrl, workspace, cacheBase: path.join(root, "cache") });
  facade.initialize();
  const started = await facade.start({ specFile: spec });
  const taskId = String(started.task_id);
  await facade.resume({ taskId, actorId: "agent/session-001" });
  const taskRoot = path.join(workspace, ".foundry", "workspaces", taskId);
  const completionPath = "outputs/completion/dataset-import-completion-report.json";
  const completionFile = path.join(taskRoot, completionPath);
  fs.mkdirSync(path.dirname(completionFile), { recursive: true });
  const completionBytes = Buffer.from(
    `${JSON.stringify({ status: "completed", task_id: taskId, blockers: [] })}\n`,
  );
  fs.writeFileSync(completionFile, completionBytes);
  const indexFile = path.join(taskRoot, "artifact-index.jsonl");
  const entries = fs
    .readFileSync(indexFile, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as Record<string, unknown>);
  const previous = entries.at(-1)!;
  const unsigned = {
    schema: "tiangong-foundry.artifact-index.v2",
    sequence: entries.length + 1,
    previous_sha256: previous.record_sha256,
    operation_id: previous.operation_id,
    command: "dataset-import-completion-report",
    input_scope_sha256: previous.input_scope_sha256,
    receipt: previous.receipt,
    path: completionPath,
    bytes: completionBytes.length,
    sha256: createHash("sha256").update(completionBytes).digest("hex"),
  };
  fs.appendFileSync(
    indexFile,
    `${JSON.stringify({ ...unsigned, record_sha256: sha256Json(unsigned) })}\n`,
  );

  assert.equal((await facade.status({ taskId, actorId: "agent/session-001" })).status, "completed");
  assert.equal((await facade.resume({ taskId, actorId: "agent/session-001" })).status, "completed");
});

test("an interrupted unindexed revision reports an actionable recovery conflict", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "foundry-facade-crash-recovery-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const workspace = path.join(root, "project");
  const input = path.join(root, "flow.jsonl");
  const spec = path.join(root, "task.json");
  fs.writeFileSync(input, '{"flowDataSet":{}}\n');
  const originalInput = fs.readFileSync(input);
  writeSpec(spec, input);
  const facade = createFoundryFacade({ moduleUrl, workspace, cacheBase: path.join(root, "cache") });
  facade.initialize();
  const invalidProfile = JSON.parse(fs.readFileSync(spec, "utf8"));
  invalidProfile.profile_id = "missing-profile";
  fs.writeFileSync(spec, `${JSON.stringify(invalidProfile)}\n`);
  const invalid = await facade.start({ specFile: spec });
  assert.equal(invalid.status, "needs_input");
  assert.equal(invalid.blockers[0]?.code, "task_profile_unknown");
  writeSpec(spec, input);
  const first = await facade.start({ specFile: spec });
  const taskId = String(first.task_id);
  const requestDir = path.join(workspace, ".foundry", "state", "facade-requests");
  const requestFile = path.join(requestDir, fs.readdirSync(requestDir)[0]);
  fs.unlinkSync(requestFile);
  fs.unlinkSync(path.join(workspace, ".foundry", "state", "facade-tasks", `${taskId}.json`));
  fs.appendFileSync(input, '{"flowDataSet":{"changed":true}}\n');
  const conflict = await facade.start({ specFile: spec });
  assert.equal(conflict.status, "blocked");
  assert.equal(conflict.blockers[0]?.code, "facade_crash_recovery_conflict");
  assert.match(conflict.blockers[0]?.message ?? "", /retry the original task-start spec/iu);

  fs.writeFileSync(input, originalInput);
  const recovered = await facade.start({ specFile: spec });
  assert.equal(recovered.task_id, taskId);
  assert.equal(recovered.status, "ready");
});

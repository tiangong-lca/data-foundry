import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createFoundryFacade } from "../../scripts/foundry-facade.ts";

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

  const first = await facade.start({ specFile: spec });
  assert.equal(first.operation, "task.start");
  assert.equal(first.status, "ready");
  assert.match(first.task_id ?? "", /^task-[0-9a-f]{16}-r0001$/u);
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

  fs.appendFileSync(input, '{"flowDataSet":{}}\n');
  const second = await facade.start({ specFile: spec });
  assert.equal(second.status, "ready");
  assert.match(second.task_id ?? "", /^task-[0-9a-f]{16}-r0002$/u);
  const secondTaskId = String(second.task_id);
  assert.notEqual(second.task_id, first.task_id);
  const request = JSON.parse(fs.readFileSync(requestIndex, "utf8"));
  assert.equal(request.revisions.length, 2);
  assert.equal(request.revisions[1].predecessor_task_id, first.task_id);
  assert.equal(fs.existsSync(path.join(workspace, ".foundry/workspaces", firstTaskId)), true);
  assert.equal(fs.existsSync(path.join(workspace, ".foundry/workspaces", secondTaskId)), true);

  const wrongActor = await facade.status({
    taskId: secondTaskId,
    actorId: "different-agent",
  });
  assert.equal(wrongActor.status, "blocked");
  assert.deepEqual(wrongActor.artifacts, []);
  assert.equal(wrongActor.blockers[0]?.code, "task_actor_mismatch");
});

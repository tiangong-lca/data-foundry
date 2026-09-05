import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import test from "node:test";
import { createFoundryFacade } from "../../scripts/public-api.ts";
import {
  captureFoundryInput,
  createFoundryRuntimeContext,
  writeFoundryArtifact,
} from "../../scripts/lib/foundry-runtime-context.ts";
import { workspaceManifestFixture } from "../helpers/foundry-runtime-manifest.mts";

const moduleUrl = new URL("../../scripts/public-api.ts", import.meta.url).href;

test("trusted read compatibility permits diagnostics and rejects every local mutation boundary", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "foundry-workspace-read-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const workspace = path.join(root, "project"),
    input = path.join(root, "flow.json"),
    spec = path.join(root, "task.json");
  fs.writeFileSync(input, '{"flowDataSet":{}}\n');
  fs.writeFileSync(
    spec,
    JSON.stringify({
      schema: "tiangong-foundry.task-start.v1",
      request_id: "request",
      actor_id: "actor",
      lane: "external-dataset-curated-import",
      profile_id: "generic",
      target_entities: ["flow"],
      sources: [{ path: input }],
      seed: null,
      account_intent: null,
      preparation: null,
    }),
  );
  const options = { workspace, cacheBase: path.join(root, "cache") };
  const writer = createFoundryFacade(options);
  writer.initialize();
  const started = await writer.start({ specFile: spec });
  assert.equal(started.status, "ready");
  const taskId = String(started.task_id),
    manifest = workspaceManifestFixture();
  const workspaceAccess = { manifest, access: "read" as const };
  const reader = createFoundryFacade({ ...options, workspaceAccess });
  assert.equal(reader.doctor().status, "ready");
  assert.equal((await reader.status({ taskId, actorId: "actor" })).status, "ready");
  for (const result of [
    reader.initialize(),
    await reader.start({ specFile: spec }),
    await reader.resume({ taskId, actorId: "actor" }),
  ]) {
    assert.equal(result.status, "blocked");
    assert.equal(result.blockers[0]?.code, "workspace_read_only");
  }
  const context = createFoundryRuntimeContext({
    moduleUrl,
    ...options,
    taskId,
    actorId: "actor",
    inputs: [captureFoundryInput(input)],
    workspaceAccess,
  });
  assert.throws(
    () => writeFoundryArtifact(context, "outputs/forbidden.json", "{}"),
    (error: unknown) =>
      error instanceof Error && "code" in error && error.code === "workspace_read_only",
  );
  assert.equal(fs.existsSync(path.join(context.taskRoot!, "outputs")), false);
});

test("read support, untrusted copies and another runtime version cannot enable writes", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "foundry-workspace-access-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const options = { workspace: path.join(root, "project"), cacheBase: path.join(root, "cache") };
  for (const manifest of [
    workspaceManifestFixture(),
    workspaceManifestFixture({ write: ["registered-tasks-v2"], version: "0.0.9" }),
    JSON.parse(JSON.stringify(workspaceManifestFixture({ write: ["registered-tasks-v2"] }))),
  ]) {
    const result = createFoundryFacade({
      ...options,
      workspaceAccess: { manifest, access: "write" },
    }).initialize();
    assert.equal(result.status, "blocked");
    assert.equal(fs.existsSync(options.workspace), false);
  }
  const qualified = createFoundryFacade({
    ...options,
    workspaceAccess: {
      manifest: workspaceManifestFixture({ write: ["registered-tasks-v2"] }),
      access: "write",
    },
  });
  assert.equal(qualified.initialize().status, "ready");
});

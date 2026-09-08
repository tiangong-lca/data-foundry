import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  createFoundryRuntimeContext,
  initializeFoundryWorkspace,
} from "../../scripts/lib/foundry-runtime-context.ts";
import { createWorkflowDirectory } from "../../scripts/lib/foundry-workflow-io.ts";

test("workflow generations remain exclusive and confined beyond the Windows mkdtemp limit", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "foundry-long-workflow-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const options = {
    moduleUrl: new URL("../../scripts/runtime-entry.ts", import.meta.url).href,
    workspace: path.join(root, "项目 workspace"),
    cacheBase: path.join(root, "cache"),
  };
  initializeFoundryWorkspace(createFoundryRuntimeContext(options));
  const context = createFoundryRuntimeContext({
    ...options,
    taskId: `task-${"a".repeat(64)}-r0001`,
    actorId: "actor",
  });
  const prefix = `outputs/context/${"b".repeat(64)}/${"c".repeat(64)}/run-`;
  assert.ok(path.join(context.taskRoot!, prefix).length > 260);
  t.mock.method(fs, "mkdtempSync", () => {
    throw Object.assign(new Error("Windows long-prefix mkdtemp"), { code: "ENOENT" });
  });
  const first = createWorkflowDirectory(context, prefix);
  fs.writeFileSync(path.join(first, "evidence.json"), '{"original":true}');
  const second = createWorkflowDirectory(context, prefix);
  assert.notEqual(first, second);
  assert.equal(fs.readFileSync(path.join(first, "evidence.json"), "utf8"), '{"original":true}');
  assert.deepEqual(fs.readdirSync(second), []);
  assert.ok(first.startsWith(context.taskRoot! + path.sep));
  assert.throws(() => createWorkflowDirectory(context, path.join(root, "outside-")));
  assert.equal(
    fs.readdirSync(root).some((name) => name.startsWith("outside-")),
    false,
  );
});

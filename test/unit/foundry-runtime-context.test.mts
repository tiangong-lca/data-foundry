import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  captureFoundryInput,
  createFoundryRuntimeContext,
  initializeFoundryWorkspace,
  readFoundryInput,
  resolveFoundryOutput,
  resolveFoundryAsset,
  writeFoundryArtifact,
} from "../../scripts/lib/foundry-runtime-context.ts";

const moduleUrl = new URL("../../scripts/foundry.ts", import.meta.url).href;
const code = (expected: string) => (error: unknown) =>
  Boolean(error && typeof error === "object" && "code" in error && error.code === expected);

test("runtime context construction is read-only and workspace initialization is idempotent", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "foundry-context-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const options = {
    moduleUrl,
    workspace: path.join(root, "project with spaces"),
    cacheBase: path.join(root, "cache"),
  };
  const context = createFoundryRuntimeContext(options);
  assert.deepEqual(fs.readdirSync(root), []);
  assert.equal(context.workspaceId, null);
  assert.equal(Object.isFrozen(context), true);
  const initialized = initializeFoundryWorkspace(context);
  assert.equal(initialized.status, "created");
  const marker = path.join(context.controlRoot, "workspace.json");
  const bytes = fs.readFileSync(marker);
  const second = initializeFoundryWorkspace(createFoundryRuntimeContext(options));
  assert.equal(second.status, "existing");
  assert.equal(second.workspace_id, initialized.workspace_id);
  assert.deepEqual(fs.readFileSync(marker), bytes);
  const nested = path.join(context.controlRoot, "workspaces");
  assert.equal(
    createFoundryRuntimeContext({ moduleUrl, cwd: nested, cacheBase: options.cacheBase })
      .workspaceId,
    initialized.workspace_id,
  );
  assert.equal(fs.existsSync(options.cacheBase), false);
});

test("two contexts isolate task outputs, selected inputs and cache without changing CWD", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "foundry-context-pair-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const cwd = process.cwd();
  const source = path.join(root, "selected.jsonl");
  fs.writeFileSync(source, '{"fixture":"frozen"}\n');
  const input = captureFoundryInput(source);
  const contexts = ["one", "two"].map((name) => {
    const options = {
      moduleUrl,
      workspace: path.join(root, name),
      cacheBase: path.join(root, "cache"),
    };
    initializeFoundryWorkspace(createFoundryRuntimeContext(options));
    return createFoundryRuntimeContext({
      ...options,
      taskId: "same-task-id",
      actorId: "agent:fixture",
      inputs: [input],
    });
  });
  const [first, second] = contexts;
  assert.throws(() => resolveFoundryAsset(first, "docs/../.env"), code("asset_not_registered"));
  assert.throws(() => writeFoundryArtifact(first, ".", "wrong"), code("output_file_required"));
  assert.notEqual(first.workspaceId, second.workspaceId);
  assert.notEqual(first.cacheRoot, second.cacheRoot);
  assert.equal(readFoundryInput(first, input.path).toString(), '{"fixture":"frozen"}\n');
  writeFoundryArtifact(first, "outputs/ready.json", "first");
  writeFoundryArtifact(second, "outputs/ready.json", "second");
  assert.equal(fs.readFileSync(resolveFoundryOutput(first, "outputs/ready.json"), "utf8"), "first");
  assert.throws(
    () => writeFoundryArtifact(first, "outputs/ready.json", "changed"),
    code("artifact_exists"),
  );
  assert.throws(
    () => writeFoundryArtifact(first, resolveFoundryOutput(second, "outputs/other.json"), "wrong"),
    code("path_outside_root"),
  );
  assert.throws(
    () => writeFoundryArtifact(first, path.join(first.runtimeRoot, "forbidden.txt"), "wrong"),
    code("path_outside_root"),
  );
  assert.throws(
    () => readFoundryInput(first, path.join(root, "not-selected.json")),
    code("input_not_selected"),
  );
  fs.writeFileSync(source, '{"fixture":"drifted"}\n');
  assert.throws(() => readFoundryInput(first, input.path), code("input_changed"));
  assert.throws(
    () => writeFoundryArtifact(JSON.parse(JSON.stringify(first)), "outputs/no.json", "wrong"),
    code("runtime_context_unverified"),
  );
  assert.throws(
    () => readFoundryInput(second, input.path, Number.NaN),
    code("input_limit_invalid"),
  );
  const marker = path.join(first.controlRoot, "workspace.json");
  const changed = JSON.parse(fs.readFileSync(marker, "utf8"));
  changed.workspace_id = second.workspaceId;
  fs.writeFileSync(marker, JSON.stringify(changed));
  assert.throws(
    () => writeFoundryArtifact(first, "outputs/stale.json", "stale"),
    code("workspace_changed"),
  );
  assert.equal(process.cwd(), cwd);
});

test("legacy state, unsupported platforms and symlink escapes cannot initialize or write", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "foundry-context-guards-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const workspace = path.join(root, "project");
  const options = { moduleUrl, workspace, cacheBase: path.join(root, "cache") };
  assert.throws(
    () =>
      createFoundryRuntimeContext({
        ...options,
        accountIntent: { projectRef: "invalid", userId: "invalid" },
      }),
    code("account_intent_invalid"),
  );
  assert.throws(
    () => createFoundryRuntimeContext({ ...options, platform: "darwin", arch: "x64" }),
    code("platform_unsupported"),
  );
  assert.equal(fs.existsSync(workspace), false);
  fs.mkdirSync(path.join(workspace, ".foundry", "attempts"), { recursive: true });
  const old = path.join(workspace, ".foundry", "attempts", "sealed.json");
  fs.writeFileSync(old, '{"consumed":true}\n');
  assert.throws(
    () => initializeFoundryWorkspace(createFoundryRuntimeContext(options)),
    code("legacy_workspace_requires_migration"),
  );
  assert.equal(fs.readFileSync(old, "utf8"), '{"consumed":true}\n');
  const clean = { ...options, workspace: path.join(root, "clean") };
  initializeFoundryWorkspace(createFoundryRuntimeContext(clean));
  const context = createFoundryRuntimeContext({ ...clean, taskId: "task", actorId: "agent" });
  const outside = path.join(root, "outside");
  fs.mkdirSync(outside);
  fs.rmdirSync(path.join(context.controlRoot, "workspaces"));
  fs.symlinkSync(
    outside,
    path.join(context.controlRoot, "workspaces"),
    process.platform === "win32" ? "junction" : "dir",
  );
  assert.throws(
    () => writeFoundryArtifact(context, "outputs/escape.json", "wrong"),
    code("symlink_not_allowed"),
  );
  assert.deepEqual(fs.readdirSync(outside), []);
});

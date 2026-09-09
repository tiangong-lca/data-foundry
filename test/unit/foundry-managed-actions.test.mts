import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import {
  copyTrustedRuntimeManifestBytes,
  describeCliRuntime,
  type RuntimeHostContext,
} from "@tiangong-lca/cli/runtime";
import { createManagedFoundryActionProjector } from "../../scripts/lib/foundry-managed-actions.ts";
import {
  commandNextActionBindingSha256,
  createFoundryOperationResult,
} from "../../scripts/lib/foundry-operation-result.ts";
import { workspaceManifestFixture } from "../helpers/foundry-runtime-manifest.mts";

function fixture(t: TestContext) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "managed-foundry-actions-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const entry = path.join(root, "package entry.js");
  fs.writeFileSync(entry, "// selected package entry\n");
  const manifest = workspaceManifestFixture();
  const context: RuntimeHostContext = {
    manifest,
    cacheDir: root,
    cwd: root,
    entry: "tool",
    host: {
      platform: `${process.platform}-${process.arch}` as RuntimeHostContext["host"]["platform"],
      osRelease: os.release(),
      glibc: null,
    },
  };
  const selected = {
    kind: "command" as const,
    code: "resume_local_preparation",
    executable: process.execPath,
    argv: [entry, "task", "resume", "--workspace", root, "--task", "task-fixture", "--json"],
    cwd: root,
    purpose: "Continue the selected task.",
  };
  const action = { ...selected, binding_sha256: commandNextActionBindingSha256(selected) };
  const result = createFoundryOperationResult({
    operation: "task.resume",
    status: "ready",
    taskId: "task-fixture",
    artifacts: [],
    blockers: [],
    nextActions: [action],
    runtimeIdentity: null,
    permissions: { state: "not_required", requested_actions: [], approval_reference: null },
  });
  const cli = describeCliRuntime();
  const project = createManagedFoundryActionProjector(context, cli, fs.realpathSync(entry));
  return { root, context, result, project, cli, manifest, entry };
}

test("managed actions keep the exact manager policy and unchanged application arguments", (t) => {
  const { root, context, result, project, cli, manifest } = fixture(t);
  const projected = project(result),
    action = projected.next_actions[0];
  assert.equal(action.kind, "command");
  if (action.kind !== "command") return;
  const original = result.next_actions[0];
  assert.equal(original.kind, "command");
  if (original.kind !== "command") return;
  const selectedManifest = path.join(root, "foundry-manifests", `${manifest.sha256}.json`);
  assert.deepEqual(
    fs.readFileSync(selectedManifest),
    Buffer.from(copyTrustedRuntimeManifestBytes(manifest)),
  );
  assert.equal(action.executable, cli.command.executable);
  assert.deepEqual(action.argv, [
    ...cli.command.argv,
    "runtime",
    "exec",
    "--manifest",
    selectedManifest,
    "--manifest-sha256",
    manifest.sha256,
    "--cache-dir",
    context.cacheDir,
    "--entry",
    context.entry,
    "--cwd",
    original.cwd,
    "--",
    ...original.argv.slice(1),
  ]);
  assert.equal(action.cwd, original.cwd);
  assert.equal(action.purpose, original.purpose);
  const { binding_sha256: projectedHash, ...projection } = action;
  assert.equal(projectedHash, commandNextActionBindingSha256(projection));
  assert.notEqual(action.binding_sha256, original.binding_sha256);
  assert.deepEqual(project(result), projected);
  assert.deepEqual(result.next_actions[0], original);
});

test("changed action bindings and foreign package entries are rejected before cache writes", (t) => {
  const { root, result, project } = fixture(t);
  const action = result.next_actions[0];
  assert.equal(action.kind, "command");
  if (action.kind !== "command") return;
  assert.throws(() =>
    project({ ...result, next_actions: [{ ...action, cwd: path.join(root, "other") }] }),
  );
  const foreign = path.join(root, "foreign.js");
  fs.writeFileSync(foreign, "// foreign\n");
  const changed = {
    kind: action.kind,
    code: action.code,
    executable: action.executable,
    argv: [foreign, ...action.argv.slice(1)],
    cwd: action.cwd,
    purpose: action.purpose,
  };
  assert.throws(
    () =>
      project({
        ...result,
        next_actions: [{ ...changed, binding_sha256: commandNextActionBindingSha256(changed) }],
      }),
    /verified Foundry package entry/u,
  );
  assert.equal(fs.existsSync(path.join(root, "foundry-manifests")), false);
});

test("cached manifest conflicts stay rejected and do not replace existing bytes", (t) => {
  const { root, manifest, result, project } = fixture(t);
  const directory = path.join(root, "foundry-manifests");
  fs.mkdirSync(directory);
  const file = path.join(directory, `${manifest.sha256}.json`);
  fs.writeFileSync(file, "changed\n");
  assert.throws(() => project(result), /different bytes/u);
  assert.equal(fs.readFileSync(file, "utf8"), "changed\n");
});

test("results without executable actions do not create a cache snapshot", (t) => {
  const { root, result, project } = fixture(t);
  const human = {
    ...result,
    next_actions: [
      { kind: "human" as const, code: "review", instructions: "Review the current evidence." },
    ],
  };
  assert.equal(project(human), human);
  assert.equal(fs.existsSync(path.join(root, "foundry-manifests")), false);
});

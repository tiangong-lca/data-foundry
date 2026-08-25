import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { isTrustedManagedWorkspaceDescendant } from "../../scripts/lib/managed-output-safety.ts";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, "..", "..");

test("trusted managed output requires the physical repository root and a strict task descendant", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "foundry-managed-output-root-"));
  const managedRoot = path.join(root, ".foundry", "workspaces");
  const taskRoot = path.join(managedRoot, "task");
  const taskFile = path.join(taskRoot, "artifact.json");
  const outside = path.join(root, "outside");
  fs.mkdirSync(taskRoot, { recursive: true });
  fs.mkdirSync(outside, { recursive: true });
  fs.writeFileSync(taskFile, "{}\n");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  assert.equal(isTrustedManagedWorkspaceDescendant(root, taskRoot), true);
  assert.equal(isTrustedManagedWorkspaceDescendant(root, taskFile), true);
  assert.equal(isTrustedManagedWorkspaceDescendant(root, managedRoot), false);
  assert.equal(isTrustedManagedWorkspaceDescendant(root, outside), false);
  assert.equal(isTrustedManagedWorkspaceDescendant(root, path.join(taskRoot, "missing")), false);
});

test("managed-root, .foundry, and task symlinks cannot expand deletion authority", (t) => {
  if (process.platform === "win32") {
    t.skip("Windows symlink creation requires privileges not guaranteed by the test contract.");
    return;
  }

  for (const symlinkAt of ["workspaces", ".foundry", "task"] as const) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), `foundry-managed-${symlinkAt}-root-`));
    const external = fs.mkdtempSync(
      path.join(os.tmpdir(), `foundry-managed-${symlinkAt}-external-`),
    );
    t.after(() => {
      fs.rmSync(root, { recursive: true, force: true });
      fs.rmSync(external, { recursive: true, force: true });
    });

    let target: string;
    if (symlinkAt === "workspaces") {
      fs.mkdirSync(path.join(root, ".foundry"), { recursive: true });
      fs.mkdirSync(path.join(external, "task"), { recursive: true });
      fs.symlinkSync(external, path.join(root, ".foundry", "workspaces"), "dir");
      target = path.join(root, ".foundry", "workspaces", "task");
    } else if (symlinkAt === ".foundry") {
      fs.mkdirSync(path.join(external, "workspaces", "task"), { recursive: true });
      fs.symlinkSync(external, path.join(root, ".foundry"), "dir");
      target = path.join(root, ".foundry", "workspaces", "task");
    } else {
      fs.mkdirSync(path.join(root, ".foundry", "workspaces"), { recursive: true });
      fs.symlinkSync(external, path.join(root, ".foundry", "workspaces", "task"), "dir");
      target = path.join(root, ".foundry", "workspaces", "task");
    }

    assert.equal(isTrustedManagedWorkspaceDescendant(root, target), false, symlinkAt);
  }
});

test("a symlink cannot redirect one managed task path into another managed task", (t) => {
  if (process.platform === "win32") {
    t.skip("Windows symlink creation requires privileges not guaranteed by the test contract.");
    return;
  }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "foundry-managed-cross-task-root-"));
  const managedRoot = path.join(root, ".foundry", "workspaces");
  const actualTask = path.join(managedRoot, "actual-task");
  const aliasTask = path.join(managedRoot, "alias-task");
  fs.mkdirSync(actualTask, { recursive: true });
  fs.symlinkSync(actualTask, aliasTask, "dir");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  assert.equal(isTrustedManagedWorkspaceDescendant(root, aliasTask), false);
});

test("cleanup and finalize share the strict helper and ignore path-only ownership markers", () => {
  for (const relativePath of [
    "scripts/lib/import-curation/curation-cleanup.ts",
    "scripts/commands/post-authoring-finalize.ts",
  ]) {
    const source = fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
    assert.match(source, /isTrustedManagedWorkspaceDescendant/u, relativePath);
    assert.doesNotMatch(source, /tiangong-foundry-(?:finalize-)?output\.json/u, relativePath);
  }
});

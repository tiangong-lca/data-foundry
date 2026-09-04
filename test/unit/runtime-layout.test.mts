import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { resolveFoundryRuntimePaths } from "../../scripts/lib/foundry-runtime-paths.ts";

function fixture(root: string) {
  const entry = path.join(root, "dist/scripts/foundry.js");
  const module = path.join(root, "dist/scripts/lib/runtime.js");
  fs.mkdirSync(path.dirname(module), { recursive: true });
  fs.writeFileSync(entry, "export {};\n");
  fs.writeFileSync(module, "export {};\n");
  const manifest = {
    name: "tiangong-lca-data-foundry",
    version: "0.1.0",
    type: "module",
    foundryRuntime: {
      schema: "tiangong-foundry.runtime-layout.v1",
      asset_root: ".",
      source_entry: "scripts/foundry.ts",
      emitted_entry: "dist/scripts/foundry.js",
    },
  };
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify(manifest));
  return { entry, module, manifest };
}

test("emitted runtime layout resolves without source TypeScript, Git, or a workspace", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "foundry-layout-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const { entry, module } = fixture(root);
  const resolved = resolveFoundryRuntimePaths(pathToFileURL(module).href);
  assert.equal(resolved.repoRoot, fs.realpathSync(root));
  assert.equal(resolved.entryPath, fs.realpathSync(entry));
  assert.equal(resolved.entryRepoRelativePath, "dist/scripts/foundry.js");
  assert.equal(fs.existsSync(path.join(root, "scripts/foundry.ts")), false);
  assert.equal(fs.existsSync(path.join(root, ".git")), false);
  assert.deepEqual(fs.readdirSync(root).sort(), ["dist", "package.json"]);
});

test("layout identity cannot redirect code outside the declared runtime tree", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "foundry-layout-guard-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const { module, manifest } = fixture(root);
  for (const override of [
    { emitted_entry: "../elsewhere.js" },
    { emitted_entry: "dist/../outside/foundry.js" },
    { asset_root: "../workspace" },
    { schema: "tiangong-foundry.runtime-layout.v999" },
  ]) {
    fs.writeFileSync(
      path.join(root, "package.json"),
      JSON.stringify({ ...manifest, foundryRuntime: { ...manifest.foundryRuntime, ...override } }),
    );
    assert.throws(() => resolveFoundryRuntimePaths(pathToFileURL(module).href));
  }
});

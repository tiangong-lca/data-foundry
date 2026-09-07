import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "../..");
test("runtime assembly exposes only fresh output and verified publication input selection", () => {
  const run = (args: string[]) =>
    spawnSync(process.execPath, [path.join(root, "scripts/release-prepare-runtime.ts"), ...args], {
      cwd: os.tmpdir(),
      encoding: "utf8",
      timeout: 30_000,
    });
  const help = run(["--help"]);
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /--output.*--published/u);
  for (const args of [
    [],
    ["--output", "."],
    ["--root", root],
    ["--platform", "darwin-x64"],
    ["--version", "9.9.9"],
    ["--publish", "true"],
    ["--manifest", "/untrusted.json"],
  ]) {
    const result = run(args);
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /Usage|absolute/u);
  }
  const existing = run(["--output", root]);
  assert.equal(existing.status, 1);
  assert.match(existing.stderr, /existing/u);
});

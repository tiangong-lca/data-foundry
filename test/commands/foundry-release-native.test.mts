import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "../..");
test("native input command accepts only a fresh output and cannot override target or source", () => {
  const run = (args: string[]) =>
    spawnSync(process.execPath, [path.join(root, "scripts/release-prepare-native.ts"), ...args], {
      cwd: os.tmpdir(),
      encoding: "utf8",
      timeout: 30000,
    });
  assert.equal(run(["--help"]).status, 0);
  for (const args of [
    [],
    ["--platform", "darwin-x64"],
    ["--url", "https://elsewhere.invalid"],
    ["--output", "."],
  ]) {
    const result = run(args);
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /Usage|absolute/u);
  }
  const existing = run(["--output", root]);
  assert.equal(existing.status, 1);
  assert.match(existing.stderr, /existing/u);
});

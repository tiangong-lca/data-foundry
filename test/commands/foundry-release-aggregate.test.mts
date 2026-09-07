import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const entry = path.resolve(import.meta.dirname, "../../scripts/release-aggregate-runtime.ts");
test("runtime aggregation exposes bounded inputs without source or publication overrides", () => {
  const run = (args: string[]) =>
    spawnSync(process.execPath, [entry, ...args], {
      cwd: os.tmpdir(),
      encoding: "utf8",
      timeout: 30_000,
    });
  const help = run(["--help"]);
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /--input.*--output.*--candidate/u);
  for (const args of [
    [],
    ["--publish"],
    ["--source", "a".repeat(40)],
    ["--version", "9.9.9"],
    ["--input", ".", "--output", "/tmp/unused"],
  ]) {
    const result = run(args);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Usage|absolute/u);
  }
});

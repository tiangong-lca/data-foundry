import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const source = path.resolve(import.meta.dirname, "../..");
test("production-input command requires a fresh explicit output and offers no source or publication override", () => {
  const run = (args: string[]) =>
    spawnSync(
      process.execPath,
      [path.join(source, "scripts/release-prepare-production.ts"), ...args],
      {
        cwd: os.tmpdir(),
        encoding: "utf8",
        timeout: 30000,
      },
    );
  const help = run(["--help"]);
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /--output/u);
  for (const args of [
    [],
    ["--output", "."],
    ["--root", source],
    ["--publish", "true"],
    ["--version", "0.1.1"],
  ]) {
    const result = run(args);
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /Usage|absolute/u);
  }
  const exists = run(["--output", source]);
  assert.equal(exists.status, 1, exists.stderr);
  assert.match(exists.stderr, /existing/u);
});

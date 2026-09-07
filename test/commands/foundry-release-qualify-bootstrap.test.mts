import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";
test("bootstrap qualification requires an independent digest and explicit bounded mode", () => {
  const entry = path.resolve(import.meta.dirname, "../../scripts/release-qualify-bootstrap.ts");
  const run = (args: string[]) =>
    spawnSync(process.execPath, [entry, ...args], { encoding: "utf8", timeout: 30_000 });
  assert.equal(run(["--help"]).status, 0);
  for (const args of [
    [],
    ["--manifest", "/tmp/untrusted"],
    ["--input", "/tmp/input", "--output", "/tmp/output"],
    ["--input", ".", "--manifest-sha256", "a".repeat(64), "--output", "/tmp/output", "--public"],
  ]) {
    const result = run(args);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Usage|absolute/u);
  }
});

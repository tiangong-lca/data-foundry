import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";

test("component publication refuses local or caller-selected release inputs before network access", () => {
  const entry = path.resolve(import.meta.dirname, "../../scripts/release-publish-components.ts");
  for (const args of [
    [],
    ["--source", "a".repeat(40)],
    ["--input", "/tmp/untrusted"],
    ["--version", "9.9.9"],
  ]) {
    const result = spawnSync(process.execPath, [entry, ...args], {
      encoding: "utf8",
      timeout: 30_000,
      env: { ...process.env, GITHUB_JOB: "ordinary-local-call" },
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /owning.*job|Usage/u);
  }
});

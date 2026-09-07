import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";
test("final manifest publication refuses ordinary execution and source overrides", () => {
  const entry = path.resolve(
    import.meta.dirname,
    "../../scripts/release-publish-runtime-manifest.ts",
  );
  for (const args of [[], ["--source", "a".repeat(40)], ["--manifest", "/tmp/untrusted"]]) {
    const result = spawnSync(process.execPath, [entry, ...args], {
      encoding: "utf8",
      timeout: 30_000,
      env: { ...process.env, GITHUB_JOB: "ordinary" },
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /owning.*job|Usage/u);
  }
});

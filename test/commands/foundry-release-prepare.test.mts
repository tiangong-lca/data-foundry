import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const source = path.resolve(import.meta.dirname, "../..");

test("package preparation rejects other jobs and caller arguments before inspecting source", () => {
  for (const script of ["release-prepare-package.ts", "release-publish-package.ts"])
    for (const [job, args] of [
      ["release-qualification", []],
      ["npm-package", ["--version", "0.1.1"]],
    ] as const) {
      const result = spawnSync(process.execPath, [path.join(source, "scripts", script), ...args], {
        cwd: os.tmpdir(),
        encoding: "utf8",
        timeout: 30_000,
        env: { ...process.env, GITHUB_JOB: job, GITHUB_EVENT_PATH: "missing-event.json" },
      });
      assert.equal(result.status, 1, result.stderr);
      assert.match(result.stderr, /owning npm-package workflow job/u);
      assert.equal(result.stdout, "");
    }
});

test("download verification has a read-only command with explicit source and version", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "foundry-prepared-cli-"));
  try {
    const run = (args: string[]) =>
      spawnSync(
        process.execPath,
        [path.join(source, "scripts/release-verify-prepared.ts"), ...args],
        { cwd: root, encoding: "utf8", timeout: 30_000 },
      );
    const help = run(["--help"]);
    assert.equal(help.status, 0, help.stderr);
    assert.match(help.stdout, /--expected-git-head/u);
    for (const args of [[], ["--directory", root], ["--package", "cli"], ["--publish", "true"]]) {
      const result = run(args);
      assert.equal(result.status, 1, result.stderr);
      assert.match(result.stderr, /Usage:/u);
    }
    const invalid = run(["--directory", root, "--version", "0.1.1", "--expected-git-head", "main"]);
    assert.equal(invalid.status, 1, invalid.stderr);
    assert.match(invalid.stderr, /exact source/u);
    assert.deepEqual(fs.readdirSync(root), []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

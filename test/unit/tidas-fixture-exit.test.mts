import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

test("TIDAS fixture drains queued work before preserving its nonzero protocol exit", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tidas-fixture-exit-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const marker = path.join(root, "drained.txt");
  const fixture = path.join(root, "fixture.ts");
  const source = fs
    .readFileSync(new URL("../fixtures/fake-tidas.ts", import.meta.url), "utf8")
    .replace(
      "const args = process.argv.slice(2);",
      `setImmediate(() => fs.writeFileSync(${JSON.stringify(marker)}, "drained"));\nconst args = process.argv.slice(2);`,
    );
  fs.writeFileSync(fixture, source);
  const environment: NodeJS.ProcessEnv = { FAKE_TIDAS_EXIT_CLASS: "cancelled" };
  for (const key of ["PATH", "Path", "SystemRoot", "WINDIR", "PATHEXT", "TEMP", "TMP", "TMPDIR"])
    if (process.env[key] !== undefined) environment[key] = process.env[key];
  const result = spawnSync(process.execPath, [fixture, "validate"], {
    cwd: root,
    env: environment,
    shell: false,
    encoding: "utf8",
    timeout: 30_000,
  });
  assert.equal(result.status, 130, result.stderr);
  assert.equal(result.signal, null);
  assert.equal(result.stderr, "");
  const lines = result.stdout.trimEnd().split("\n");
  assert.equal(lines.length, 1);
  assert.equal(JSON.parse(lines[0]).exit_class, "cancelled");
  assert.equal(fs.readFileSync(marker, "utf8"), "drained");
});

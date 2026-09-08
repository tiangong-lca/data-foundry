import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import report, { foundryCiReporterUrl } from "../../scripts/ci-test-reporter.ts";

async function collect(items: unknown[]): Promise<unknown[]> {
  async function* events() {
    yield* items;
  }
  const output: unknown[] = [];
  for await (const row of report(events())) output.push(JSON.parse(row));
  return output;
}

test("CI reporter retains native runner counters and excludes arbitrary test output", async () => {
  const items = await collect([
    { type: "test:stdout", data: { message: "must-not-copy-raw-output" } },
    {
      type: "test:fail",
      data: {
        name: "failure",
        file: "/test/file.test.mts",
        nesting: 0,
        details: {
          type: "test",
          duration_ms: 3,
          error: { message: "must-not-copy-error-payload" },
        },
      },
    },
    {
      type: "test:summary",
      data: {
        success: false,
        duration_ms: 5,
        counts: { tests: 2, passed: 0, failed: 1, cancelled: 0, skipped: 1, todo: 0, suites: 0 },
      },
    },
  ]);
  assert.equal(items.length, 2);
  assert.equal(JSON.stringify(items).includes("must-not-copy"), false);
  assert.deepEqual((items[1] as { counts: unknown }).counts, {
    tests: 2,
    passed: 0,
    failed: 1,
    cancelled: 0,
    skipped: 1,
    todo: 0,
    suites: 0,
  });
  await assert.rejects(
    collect([
      { type: "test:summary", data: { success: true, duration_ms: 1, counts: { tests: "2" } } },
    ]),
    /measurement/,
  );
});

test("actual Node reporter integration preserves passed and platform-skipped cases", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "foundry-ci-report-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const fixture = path.join(directory, "fixture.test.mjs");
  fs.writeFileSync(
    fixture,
    'import test from "node:test"; test("retained pass", () => {}); test("platform skip", {skip: true}, () => {});\n',
  );
  const environment = { ...process.env };
  delete environment.NODE_TEST_CONTEXT;
  delete environment.NODE_OPTIONS;
  const result = spawnSync(
    process.execPath,
    ["--test", `--test-reporter=${foundryCiReporterUrl}`, fixture],
    {
      env: environment,
      encoding: "utf8",
      timeout: 30000,
    },
  );
  assert.equal(result.status, 0, result.stderr);
  const records = result.stdout
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as Record<string, unknown>);
  const summary = records.findLast((row) => row.type === "summary" && row.file === undefined);
  assert.equal(summary?.success, true);
  assert.deepEqual(summary?.counts, {
    tests: 2,
    passed: 1,
    failed: 0,
    cancelled: 0,
    skipped: 1,
    todo: 0,
    suites: 0,
  });
  assert.equal(records.filter((row) => row.type === "case").length, 2);
});

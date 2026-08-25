import test from "node:test";
import { assert, path, readJson, rel, runFoundry } from "../fixtures/foundry-core.ts";
import { createIncrementalChangeSetFixture } from "../fixtures/incremental-change-set-fixtures.mjs";

test("incremental change-set remains an offline candidate pending fresh reconciliation and capsule admission", () => {
  const fixture = createIncrementalChangeSetFixture("handoff");
  const result = runFoundry([
    "dataset-incremental-change-set-compose",
    "--request",
    rel(fixture.requestPath),
    "--out-dir",
    rel(fixture.outDir),
  ]);
  assert.equal(result.code, 0);
  const report = readJson(path.join(fixture.outDir, "incremental-change-set-report.json"));
  const manifest = readJson(path.join(fixture.outDir, "incremental-change-set-manifest.json"));
  assert.equal(report.production_authority, false);
  assert.equal(manifest.production_authority, false);
  assert.match(report.next_gate, /Fresh SELECT-only reconciliation/u);
  assert.match(report.next_gate, /execution-capsule admission/u);
  assert.deepEqual(report.dispatch_counts, { network: 0, database: 0, cli: 0, dml: 0 });
});

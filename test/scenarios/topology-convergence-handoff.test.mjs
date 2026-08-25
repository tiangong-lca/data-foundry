import test from "node:test";
import { assert, path, readJson, rel, runFoundry } from "../fixtures/foundry-core.ts";
import { createTopologyConvergenceFixture } from "../fixtures/topology-convergence-fixtures.mjs";

test("topology package remains offline and requires capsule admission before F/P/D dispatch", () => {
  const fixture = createTopologyConvergenceFixture("handoff");
  const result = runFoundry([
    "dataset-topology-convergence-compose",
    "--request",
    rel(fixture.requestPath),
    "--out-dir",
    rel(fixture.outDir),
  ]);
  assert.equal(result.code, 0);
  const report = readJson(path.join(fixture.outDir, "topology-report.json"));
  const manifest = readJson(path.join(fixture.outDir, "topology-manifest.json"));
  assert.equal(report.production_authority, false);
  assert.equal(manifest.production_authority, false);
  assert.match(report.next_gate, /execution-capsule admission/u);
  assert.match(report.delete_gate, /zero-inbound/u);
  assert.deepEqual(report.dispatch_counts, { network: 0, database: 0, cli: 0, dml: 0 });
});

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, "..", "..");
const typedPath = path.join(repoRoot, "test/fixtures/topology-convergence-fixtures.ts");
const legacyPath = path.join(repoRoot, "test/fixtures/topology-convergence-fixtures.mjs");
const fixture = await import(pathToFileURL(fs.existsSync(typedPath) ? typedPath : legacyPath).href);

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

test("topology fixture exists only as native TypeScript", () => {
  assert.equal(fs.existsSync(typedPath), true);
  assert.equal(fs.existsSync(legacyPath), false);
  const source = fs.readFileSync(typedPath, "utf8");
  assert.doesNotMatch(source, /(?:[:<>,(|]\s*any\b|\bas\s+any\b)/u);
  assert.doesNotMatch(source, /@ts-(?:ignore|nocheck|expect-error)/u);
});

test("topology fixture namespace, ids, and canonical hashing remain exact", () => {
  assert.deepEqual(Object.keys(fixture).sort(), [
    "createTopologyConvergenceFixture",
    "fixtureSha",
    "topologyIds",
  ]);
  assert.deepEqual(Object.keys(fixture.topologyIds), [
    "flows",
    "oldFlows",
    "processes",
    "source",
    "flowproperty",
    "owner",
  ]);
  assert.equal(
    fixture.fixtureSha({ b: 2, a: 1 }),
    "43258cff783fe7036d8a43033f830adfc60ec037382473548ac742b888292777",
  );
});

test("topology fixture preserves graph order and stable artifact bytes", () => {
  const result = fixture.createTopologyConvergenceFixture("migration-characterization");
  try {
    assert.deepEqual(Object.keys(result), [
      "root",
      "flowPayloads",
      "candidateProcessPayloads",
      "currentProcessA",
      "germanRows",
      "ownerFlowRows",
      "publicFlowRows",
      "foreignFlowRows",
      "ownerProcessRows",
      "classificationRows",
      "mappingRows",
      "protectedRows",
      "candidateFlows",
      "candidateProcesses",
      "ownerFlows",
      "publicFlows",
      "foreignFlows",
      "ownerProcesses",
      "mappings",
      "classifications",
      "german",
      "protected",
      "candidatePackage",
      "admission",
      "request",
      "requestPath",
      "requestValue",
      "outDir",
    ]);
    assert.equal(result.root.startsWith(path.join(repoRoot, "tmp")), true);
    assert.deepEqual(
      result.mappingRows.map(
        (row: { old_flow_id: string; new_flow_id: string; mapping_kind: string }) => [
          row.old_flow_id,
          row.new_flow_id,
          row.mapping_kind,
        ],
      ),
      [
        [fixture.topologyIds.oldFlows[0], fixture.topologyIds.flows[0], "1:1"],
        [fixture.topologyIds.oldFlows[1], fixture.topologyIds.flows[1], "many-to-one"],
        [fixture.topologyIds.oldFlows[2], fixture.topologyIds.flows[1], "many-to-one"],
        [fixture.topologyIds.oldFlows[3], fixture.topologyIds.flows[2], "one-to-many"],
        [fixture.topologyIds.oldFlows[3], fixture.topologyIds.flows[3], "one-to-many"],
      ],
    );
    const expected = [
      [result.mappings, 1102, "4458beb22584312608f90212bfbd59cf7a9c144c2a3059e46761d16002ffbdae"],
      [
        result.classifications,
        1848,
        "65bc95210b105664bfc521b1948c34d2100377cb063986fec0803b0a8a8fe0de",
      ],
      [result.ownerFlows, 5004, "642db4560829d6d1a56ad73368b8e4aaa3f03cd649c4972fa6eb2b2457627676"],
      [
        result.candidatePackage,
        26,
        "7bd41788882b45b80fd1e9547851d8a045bb9cb5febe17796e8dd7f717f34c6c",
      ],
    ] as const;
    for (const [filePath, bytes, hash] of expected) {
      const text = fs.readFileSync(filePath, "utf8");
      assert.equal(Buffer.byteLength(text, "utf8"), bytes);
      assert.equal(sha256(text), hash);
    }
  } finally {
    fs.rmSync(result.root, { recursive: true, force: true });
  }
});

test("topology fixture canonical hashing retains native undefined failure", () => {
  assert.throws(() => fixture.fixtureSha(undefined), TypeError);
});

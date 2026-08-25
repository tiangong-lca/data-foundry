import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, "..", "..");
const typedPath = path.join(repoRoot, "test/fixtures/incremental-change-set-fixtures.ts");
const legacyPath = path.join(repoRoot, "test/fixtures/incremental-change-set-fixtures.mjs");
const fixture = await import(pathToFileURL(fs.existsSync(typedPath) ? typedPath : legacyPath).href);

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

test("incremental fixture exists only as native TypeScript", () => {
  assert.equal(fs.existsSync(typedPath), true);
  assert.equal(fs.existsSync(legacyPath), false);
  const source = fs.readFileSync(typedPath, "utf8");
  assert.doesNotMatch(source, /(?:[:<>,(|]\s*any\b|\bas\s+any\b)/u);
  assert.doesNotMatch(source, /@ts-(?:ignore|nocheck|expect-error)/u);
});

test("incremental fixture namespace and policy constants remain exact", () => {
  assert.deepEqual(Object.keys(fixture).sort(), [
    "createIncrementalChangeSetFixture",
    "fixtureBoundRule",
    "fixtureComparison",
    "fixtureEntityKey",
    "fixtureOwnerRow",
    "fixturePayload",
    "fixtureSha256Json",
    "fixtureTables",
    "fixtureUpdatePointer",
    "fixtureValueSha256",
    "fixtureVersion",
  ]);
  assert.deepEqual(fixture.fixtureTables, [
    "contacts",
    "unitgroups",
    "flowproperties",
    "sources",
    "flows",
    "processes",
  ]);
  assert.equal(fixture.fixtureVersion, "01.00.000");
  assert.equal(
    fixture.fixtureUpdatePointer("flows"),
    "/flowDataSet/flowInformation/dataSetInformation",
  );
  assert.equal(
    fixture.fixtureValueSha256(undefined),
    "d90a8c90ddb85bd1b476e81be326a08dd51a9dd389f1f749eff33541242847f5",
  );
});

test("incremental fixture preserves comparison/owner/policy bytes and order", () => {
  const result = fixture.createIncrementalChangeSetFixture("migration-characterization");
  try {
    assert.deepEqual(Object.keys(result), [
      "comparisons",
      "comparisonsPath",
      "ids",
      "outDir",
      "owner",
      "ownerPath",
      "ownerRows",
      "policy",
      "policyPath",
      "projectRef",
      "receipt",
      "receiptPath",
      "request",
      "requestPath",
      "root",
    ]);
    assert.equal(result.root.startsWith(path.join(repoRoot, "tmp")), true);
    const expected = [
      [
        result.comparisonsPath,
        6545,
        "dbefd6c8cb7371aabb08df8806e82a731e08681a86e5e8d0c09510fa0ecdf8c9",
      ],
      [result.ownerPath, 4073, "ea277d6b047dd8efcff5b6b209c36e3b4bb7b1337313959fcfcb58a3d8403904"],
      [result.policyPath, 2222, "9b8ff125fcb948619b8dd49f31216b6ca244b04580679f6bc3b0c3ef5e5f518f"],
    ] as const;
    for (const [filePath, bytes, hash] of expected) {
      const text = fs.readFileSync(filePath, "utf8");
      assert.equal(Buffer.byteLength(text, "utf8"), bytes);
      assert.equal(sha256(text), hash);
    }
    assert.deepEqual(
      result.comparisons.map((row: { conversion_id: string }) => row.conversion_id),
      [
        "ug-exact",
        "flow-create",
        "process-create",
        "source-noise",
        "process-numeric-update",
        "source-curated",
        "source-delete",
        "process-independent-update",
      ],
    );
  } finally {
    fs.rmSync(result.root, { recursive: true, force: true });
  }
});

test("incremental fixture keeps native invalid-table errors", () => {
  assert.throws(() => fixture.fixturePayload("invalid", "id"), TypeError);
});

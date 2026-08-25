import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, "..", "..");
const typedPath = path.join(repoRoot, "test/fixtures/row-builders.ts");
const legacyPath = path.join(repoRoot, "test/fixtures/row-builders.mjs");
const builders = await import(
  pathToFileURL(fs.existsSync(typedPath) ? typedPath : legacyPath).href
);

test("row builders exist only as native TypeScript", () => {
  assert.equal(fs.existsSync(typedPath), true);
  assert.equal(fs.existsSync(legacyPath), false);
  const source = fs.readFileSync(typedPath, "utf8");
  assert.doesNotMatch(source, /(?:[:<>,(|]\s*any\b|\bas\s+any\b)/u);
  assert.doesNotMatch(source, /@ts-(?:ignore|nocheck|expect-error)/u);
});

test("row builder namespace remains exact", () => {
  assert.deepEqual(Object.keys(builders).sort(), [
    "flowRow",
    "flowRowWithClassification",
    "processRowWithDefaultClassification",
    "processRowWithDeferredTrace",
    "processRowWithFlowRef",
    "processRowWithInvalidAnnualSupply",
    "processRowWithInvalidLocation",
    "processRowWithOnlyOutputExchange",
    "sourceRow",
  ]);
});

test("representative row bytes, family order, and hashes remain exact", () => {
  const fixtures = {
    deferred: builders.processRowWithDeferredTrace("p1"),
    classified: builders.processRowWithDefaultClassification("p2"),
    flowClass: builders.flowRowWithClassification({
      flowId: "f1",
      typeOfDataSet: "Product flow",
      classification: {
        "common:classification": {
          "common:class": [{ "@level": "0", "@classId": "A", "#text": "Agriculture" }],
        },
      },
    }),
    invalidLocation: builders.processRowWithInvalidLocation("p3"),
    invalidAnnual: builders.processRowWithInvalidAnnualSupply("p4"),
    flowRef: builders.processRowWithFlowRef("p5", "f2"),
    output: builders.processRowWithOnlyOutputExchange("p6"),
    flow: builders.flowRow("f3"),
    source: builders.sourceRow("s1"),
  };
  assert.deepEqual(Object.keys(fixtures), [
    "deferred",
    "classified",
    "flowClass",
    "invalidLocation",
    "invalidAnnual",
    "flowRef",
    "output",
    "flow",
    "source",
  ]);
  const text = JSON.stringify(fixtures);
  assert.equal(Buffer.byteLength(text, "utf8"), 4941);
  assert.equal(
    createHash("sha256").update(text).digest("hex"),
    "34f0d6c1a96301756650f69040292345faec6dd563aafd522b7636e64de65273",
  );
});

test("flow classification destructuring retains the native TypeError", () => {
  assert.throws(() => builders.flowRowWithClassification(null), TypeError);
});

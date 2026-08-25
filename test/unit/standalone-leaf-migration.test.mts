import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import * as canonicalMappings from "../../scripts/lib/canonical-support-mappings.ts";
import * as sourceSemantics from "../../scripts/lib/source-semantics.ts";
import * as tidasRows from "../../scripts/lib/tidas-row-utils.ts";
import * as traceCoverage from "../../scripts/lib/trace-coverage.ts";

const repoRoot = path.resolve(import.meta.dirname, "..", "..");

test("four standalone leaves preserve their complete export surfaces", () => {
  assert.deepEqual(Object.keys(canonicalMappings), ["defaultCanonicalFlowPropertyMappings"]);
  assert.deepEqual(Object.keys(sourceSemantics), ["createSourceSemanticUtils"]);
  assert.deepEqual(Object.keys(traceCoverage), ["createTraceCoverageUtils"]);
  assert.deepEqual(Object.keys(tidasRows), ["createTidasRowUtils"]);
});

test("four standalone leaves are native TypeScript with updated consumers", () => {
  for (const stem of [
    "canonical-support-mappings",
    "source-semantics",
    "trace-coverage",
    "tidas-row-utils",
  ]) {
    const typedPath = path.join(repoRoot, `scripts/lib/${stem}.ts`);
    assert.equal(fs.existsSync(typedPath), true, `${stem}.ts must exist`);
    assert.equal(fs.existsSync(typedPath.replace(/\.ts$/u, ".mjs")), false);
  }
  const expectedConsumers = [
    ["scripts/commands/support-cache.ts", "../lib/canonical-support-mappings.ts"],
    ["scripts/foundry.mjs", "./lib/source-semantics.ts"],
    ["scripts/foundry.mjs", "./lib/trace-coverage.ts"],
    ["scripts/foundry.mjs", "./lib/tidas-row-utils.ts"],
    ["test/unit/source-semantics.test.mjs", "../../scripts/lib/source-semantics.ts"],
  ] as const;
  for (const [consumer, specifier] of expectedConsumers) {
    assert.match(
      fs.readFileSync(path.join(repoRoot, consumer), "utf8"),
      new RegExp(`from ["']${specifier.replaceAll(".", "\\.")}["']`, "u"),
    );
  }
});

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, "..", "..");

function readRepoFile(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

test("row transform context exists only as native TypeScript", () => {
  const typedPath = path.join(
    repoRoot,
    "scripts/lib/import-curation/internal/workflow-row-transform-context.ts",
  );
  assert.equal(fs.existsSync(typedPath), true);
  assert.equal(fs.existsSync(typedPath.replace(/\.ts$/u, ".mjs")), false);
});

test("every static row transform context consumer targets the typed module", () => {
  const consumers = [
    "scripts/lib/import-curation/internal/curation-gate-workflow.ts",
    "scripts/lib/import-curation/internal/mutation-manifest-workflow.mjs",
    "scripts/lib/import-curation/internal/workflow-decision-full-context.ts",
    "scripts/lib/import-curation/internal/workflow-evidence-scope.ts",
    "scripts/lib/import-curation/internal/workflow-identity-preflight.ts",
    "scripts/lib/import-curation/internal/workflow-reference-closure.mjs",
    "test/scenarios/mutation-lineage-helpers.test.mjs",
    "test/unit/workflow-row-transform-context-contract.test.mts",
  ];
  for (const consumer of consumers) {
    const source = readRepoFile(consumer);
    assert.match(source, /from ["'][^"']*workflow-row-transform-context\.ts["']/u);
    assert.doesNotMatch(source, /workflow-row-transform-context\.mjs/u);
  }
});

test("typed row transform context retains thirty-one zero-any exports", () => {
  const source = readRepoFile(
    "scripts/lib/import-curation/internal/workflow-row-transform-context.ts",
  );
  assert.doesNotMatch(source, /\bany\b/u);
  assert.equal([...source.matchAll(/export function\s+([A-Za-z0-9_]+)/gu)].length, 31);
});

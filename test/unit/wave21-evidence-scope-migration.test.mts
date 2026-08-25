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

test("evidence scope exists only as native TypeScript", () => {
  const typedPath = path.join(
    repoRoot,
    "scripts/lib/import-curation/internal/workflow-evidence-scope.ts",
  );
  assert.equal(fs.existsSync(typedPath), true);
  assert.equal(fs.existsSync(typedPath.replace(/\.ts$/u, ".mjs")), false);
});

test("every static evidence scope consumer targets the typed module", () => {
  const consumers = [
    "scripts/lib/import-curation/internal/mutation-manifest-workflow.mjs",
    "test/unit/workflow-evidence-scope-contract.test.mts",
  ];
  for (const consumer of consumers) {
    const source = readRepoFile(consumer);
    assert.match(source, /from ["'][^"']*workflow-evidence-scope\.ts["']/u);
    assert.doesNotMatch(source, /workflow-evidence-scope\.mjs/u);
  }
});

test("typed evidence scope retains three zero-any exports", () => {
  const source = readRepoFile("scripts/lib/import-curation/internal/workflow-evidence-scope.ts");
  assert.doesNotMatch(source, /\bany\b/u);
  assert.equal([...source.matchAll(/export function\s+([A-Za-z0-9_]+)/gu)].length, 3);
});

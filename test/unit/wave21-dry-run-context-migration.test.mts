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

test("dry-run context exists only as native TypeScript", () => {
  const typedPath = path.join(
    repoRoot,
    "scripts/lib/import-curation/internal/workflow-dry-run-context.ts",
  );
  assert.equal(fs.existsSync(typedPath), true);
  assert.equal(fs.existsSync(typedPath.replace(/\.ts$/u, ".mjs")), false);
});

test("every static dry-run context consumer targets the typed module", () => {
  const consumers = [
    "scripts/lib/import-curation/internal/mutation-manifest-workflow.mjs",
    "scripts/lib/import-curation/internal/workflow-reference-closure.mjs",
    "test/unit/workflow-dry-run-context-contract.test.mts",
  ];
  for (const consumer of consumers) {
    const source = readRepoFile(consumer);
    assert.match(source, /from ["'][^"']*workflow-dry-run-context\.ts["']/u);
    assert.doesNotMatch(source, /workflow-dry-run-context\.mjs/u);
  }
});

test("typed dry-run context retains eight zero-any exports", () => {
  const source = readRepoFile("scripts/lib/import-curation/internal/workflow-dry-run-context.ts");
  assert.doesNotMatch(source, /\bany\b/u);
  assert.equal([...source.matchAll(/export function\s+([A-Za-z0-9_]+)/gu)].length, 8);
});

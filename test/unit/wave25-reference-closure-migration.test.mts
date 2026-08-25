import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, "..", "..");
const internalRoot = path.join(repoRoot, "scripts/lib/import-curation/internal");

function readRepoFile(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

test("reference closure exists only as native TypeScript", () => {
  assert.equal(fs.existsSync(path.join(internalRoot, "workflow-reference-closure.ts")), true);
  assert.equal(fs.existsSync(path.join(internalRoot, "workflow-reference-closure.mjs")), false);
});

test("typed reference closure has no explicit type escape or suppression", () => {
  const source = readRepoFile("scripts/lib/import-curation/internal/workflow-reference-closure.ts");
  assert.doesNotMatch(source, /\bas\s+any\b|:\s*any\b|\bany\s*\[\]|<\s*any\b|,\s*any\s*>/u);
  assert.doesNotMatch(source, /@ts-(?:no)?check|@ts-ignore|@ts-expect-error/u);
});

test("reference closure consumers target the typed module", () => {
  for (const consumer of [
    "scripts/lib/import-curation/internal/mutation-manifest-workflow.mjs",
    "scripts/lib/import-curation/internal/workflow-source-reference-context.mjs",
  ]) {
    const source = readRepoFile(consumer);
    assert.match(source, /\.\/workflow-reference-closure\.ts/u);
    assert.doesNotMatch(source, /workflow-reference-closure\.mjs/u);
  }
});

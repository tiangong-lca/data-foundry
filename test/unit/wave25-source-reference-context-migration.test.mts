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

test("source reference context exists only as native TypeScript", () => {
  assert.equal(
    fs.existsSync(path.join(internalRoot, "workflow-source-reference-context.ts")),
    true,
  );
  assert.equal(
    fs.existsSync(path.join(internalRoot, "workflow-source-reference-context.mjs")),
    false,
  );
});

test("typed source context binds typed closure without explicit escape or suppression", () => {
  const source = readRepoFile(
    "scripts/lib/import-curation/internal/workflow-source-reference-context.ts",
  );
  assert.match(source, /\.\/workflow-reference-closure\.ts/u);
  assert.doesNotMatch(source, /workflow-reference-closure\.mjs/u);
  assert.doesNotMatch(source, /\bas\s+any\b|:\s*any\b|\bany\s*\[\]|<\s*any\b|,\s*any\s*>/u);
  assert.doesNotMatch(source, /@ts-(?:no)?check|@ts-ignore|@ts-expect-error/u);
});

test("mutation workflow facade targets the typed source context", () => {
  const source = readRepoFile(
    "scripts/lib/import-curation/internal/mutation-manifest-workflow.mjs",
  );
  assert.match(source, /\.\/workflow-source-reference-context\.ts/u);
  assert.doesNotMatch(source, /workflow-source-reference-context\.mjs/u);
});

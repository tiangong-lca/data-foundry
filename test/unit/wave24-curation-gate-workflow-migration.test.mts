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

test("curation gate workflow facade exists only as native TypeScript", () => {
  assert.equal(fs.existsSync(path.join(internalRoot, "curation-gate-workflow.ts")), true);
  assert.equal(fs.existsSync(path.join(internalRoot, "curation-gate-workflow.mjs")), false);
});

test("typed curation gate facade is a zero-escape aggregate over typed owners", () => {
  const source = readRepoFile("scripts/lib/import-curation/internal/curation-gate-workflow.ts");
  assert.match(source, /from ["']\.\/artifact-inputs\.ts["']/u);
  assert.match(source, /from ["']\.\/workflow-identity-preflight\.ts["']/u);
  assert.match(source, /from ["']\.\/workflow-row-transform-context\.ts["']/u);
  assert.doesNotMatch(source, /\.mjs["']/u);
  assert.doesNotMatch(source, /\bas\s+any\b|:\s*any\b|\bany\s*\[\]|<\s*any\b|,\s*any\s*>/u);
  assert.doesNotMatch(source, /@ts-(?:no)?check|@ts-ignore|@ts-expect-error/u);
});

test("curation gate runner imports the typed facade", () => {
  const source = readRepoFile("scripts/lib/import-curation/curation-gate.ts");
  assert.match(source, /\.\/internal\/curation-gate-workflow\.ts/u);
  assert.doesNotMatch(source, /curation-gate-workflow\.mjs/u);
});

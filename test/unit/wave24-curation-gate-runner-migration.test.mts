import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, "..", "..");
const moduleRoot = path.join(repoRoot, "scripts/lib/import-curation");

function readRepoFile(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

test("curation gate runner exists only as native TypeScript", () => {
  assert.equal(fs.existsSync(path.join(moduleRoot, "curation-gate.ts")), true);
  assert.equal(fs.existsSync(path.join(moduleRoot, "curation-gate.mjs")), false);
});

test("typed curation gate runner keeps one zero-escape export and typed facade import", () => {
  const source = readRepoFile("scripts/lib/import-curation/curation-gate.ts");
  assert.match(source, /export function runDatasetCurationGate\b/u);
  assert.match(source, /\.\/internal\/curation-gate-workflow\.ts/u);
  assert.doesNotMatch(source, /curation-gate-workflow\.mjs/u);
  assert.doesNotMatch(source, /\bas\s+any\b|:\s*any\b|\bany\s*\[\]|<\s*any\b|,\s*any\s*>/u);
  assert.doesNotMatch(source, /@ts-(?:no)?check|@ts-ignore|@ts-expect-error/u);
});

test("curation gate consumers and navigation target the typed runner", () => {
  const indexSource = readRepoFile("scripts/lib/import-curation/index.mjs");
  const metadataSource = readRepoFile("scripts/lib/foundry-command-metadata.ts");
  assert.match(indexSource, /curation-gate\.ts/u);
  assert.doesNotMatch(indexSource, /curation-gate\.mjs/u);
  assert.match(metadataSource, /typedImportOwner\("curation-gate"\)/u);
  assert.doesNotMatch(metadataSource, /importOwner\("curation-gate"\)/u);
});

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

test("curation cleanup runner exists only as native TypeScript", () => {
  assert.equal(fs.existsSync(path.join(moduleRoot, "curation-cleanup.ts")), true);
  assert.equal(fs.existsSync(path.join(moduleRoot, "curation-cleanup.mjs")), false);
});

test("typed cleanup runner keeps one zero-escape export and typed cleanup imports", () => {
  const source = readRepoFile("scripts/lib/import-curation/curation-cleanup.ts");
  assert.match(source, /export function runDatasetCurationCleanup\b/u);
  assert.match(source, /\.\/internal\/prewrite-cleanup\.ts/u);
  assert.match(source, /\.\/internal\/runtime-io\.ts/u);
  assert.doesNotMatch(source, /\bas\s+any\b|:\s*any\b|\bany\s*\[\]|<\s*any\b|,\s*any\s*>/u);
  assert.doesNotMatch(source, /@ts-(?:no)?check|@ts-ignore|@ts-expect-error/u);
});

test("curation cleanup consumers and navigation target the typed runner", () => {
  const indexSource = readRepoFile("scripts/lib/import-curation/index.ts");
  const metadataSource = readRepoFile("scripts/lib/foundry-command-metadata.ts");
  assert.match(indexSource, /curation-cleanup\.ts/u);
  assert.doesNotMatch(indexSource, /curation-cleanup\.mjs/u);
  assert.match(metadataSource, /typedImportOwner\("curation-cleanup"\)/u);
  assert.doesNotMatch(metadataSource, /importOwner\("curation-cleanup"\)/u);
});

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as profilesOwner from "../../scripts/lib/import-curation/internal/profiles-config.ts";
import * as traceOwner from "../../scripts/lib/import-curation/internal/trace-summary.ts";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, "..", "..");

async function loadCurrentBarrel(stem: string): Promise<Record<string, unknown>> {
  const typedPath = path.join(repoRoot, `scripts/lib/import-curation/${stem}.ts`);
  const legacyPath = path.join(repoRoot, `scripts/lib/import-curation/${stem}.mjs`);
  return import(pathToFileURL(fs.existsSync(typedPath) ? typedPath : legacyPath).href) as Promise<
    Record<string, unknown>
  >;
}

function readRepoFile(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

test("profile and trace barrels exist only as native TypeScript", () => {
  for (const stem of ["profiles", "trace-summary"]) {
    const typedPath = path.join(repoRoot, `scripts/lib/import-curation/${stem}.ts`);
    assert.equal(fs.existsSync(typedPath), true, stem);
    assert.equal(fs.existsSync(typedPath.replace(/\.ts$/u, ".mjs")), false, stem);
    const source = fs.readFileSync(typedPath, "utf8");
    assert.doesNotMatch(source, /\bany\b/u, stem);
    assert.doesNotMatch(source, /@ts-(?:ignore|nocheck|expect-error)/u, stem);
  }
});

test("profile barrel preserves the exact namespace and live owner references", async () => {
  const barrel = await loadCurrentBarrel("profiles");
  assert.deepEqual(Object.keys(barrel), ["listImportProfiles", "profileFor"]);
  assert.equal(barrel.listImportProfiles, profilesOwner.listImportProfiles);
  assert.equal(barrel.profileFor, profilesOwner.profileFor);
});

test("trace barrel preserves the exact namespace and live owner reference", async () => {
  const barrel = await loadCurrentBarrel("trace-summary");
  assert.deepEqual(Object.keys(barrel), ["foundryTraceSummary"]);
  assert.equal(barrel.foundryTraceSummary, traceOwner.foundryTraceSummary);
});

test("every active leaf-barrel consumer targets the typed module", () => {
  const indexSource = readRepoFile("scripts/lib/import-curation/index.mjs");
  assert.match(indexSource, /from "\.\/profiles\.ts"/u);
  assert.match(indexSource, /from "\.\/trace-summary\.ts"/u);
  assert.doesNotMatch(indexSource, /from "\.\/(?:profiles|trace-summary)\.mjs"/u);

  const profileMigration = readRepoFile("test/unit/wave16-profiles-config-migration.test.mts");
  assert.match(profileMigration, /scripts\/lib\/import-curation\/profiles\.ts/u);
  assert.doesNotMatch(profileMigration, /scripts\/lib\/import-curation\/profiles\.mjs/u);
});

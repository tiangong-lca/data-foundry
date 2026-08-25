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

test("profiles config exists only as native TypeScript", () => {
  const typedPath = path.join(repoRoot, "scripts/lib/import-curation/internal/profiles-config.ts");
  assert.equal(fs.existsSync(typedPath), true);
  assert.equal(fs.existsSync(typedPath.replace(/\.ts$/u, ".mjs")), false);
});

test("every static profiles config consumer targets the typed module", () => {
  const consumers = [
    "scripts/lib/import-curation/profiles.ts",
    "scripts/lib/import-curation/internal/curation-gate-workflow.ts",
    "scripts/lib/import-curation/internal/mutation-manifest-workflow.mjs",
    "test/scenarios/bafu-mydata-override.test.mjs",
    "test/unit/content-policy-profile-waiver.test.mjs",
    "test/unit/profiles-config-contract.test.mts",
  ];
  for (const consumer of consumers) {
    const source = readRepoFile(consumer);
    assert.match(source, /from ["'][^"']*profiles-config\.ts["']/u);
    assert.doesNotMatch(source, /profiles-config\.mjs/u);
  }
});

test("typed profiles config retains four zero-any exports", () => {
  const source = readRepoFile("scripts/lib/import-curation/internal/profiles-config.ts");
  assert.doesNotMatch(source, /\bany\b/u);
  assert.deepEqual(
    [...source.matchAll(/export function\s+([A-Za-z0-9_]+)/gu)].map((match) => match[1]),
    ["normalizeProfile", "readProfilesConfig", "profileFor", "listImportProfiles"],
  );
});

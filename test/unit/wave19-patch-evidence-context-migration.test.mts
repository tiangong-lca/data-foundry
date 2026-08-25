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

test("patch evidence context exists only as native TypeScript", () => {
  const typedPath = path.join(
    repoRoot,
    "scripts/lib/import-curation/internal/workflow-patch-evidence-context.ts",
  );
  assert.equal(fs.existsSync(typedPath), true);
  assert.equal(fs.existsSync(typedPath.replace(/\.ts$/u, ".mjs")), false);
});

test("every static patch evidence context consumer targets the typed module", () => {
  const consumers = [
    "scripts/lib/import-curation/internal/mutation-manifest-workflow.mjs",
    "scripts/lib/import-curation/internal/workflow-reference-closure.mjs",
    "test/unit/workflow-patch-evidence-context-contract.test.mts",
  ];
  for (const consumer of consumers) {
    const source = readRepoFile(consumer);
    assert.match(source, /from ["'][^"']*workflow-patch-evidence-context\.ts["']/u);
    assert.doesNotMatch(source, /workflow-patch-evidence-context\.mjs/u);
  }
});

test("typed patch evidence context retains ten zero-any exports", () => {
  const source = readRepoFile(
    "scripts/lib/import-curation/internal/workflow-patch-evidence-context.ts",
  );
  assert.doesNotMatch(source, /\bany\b/u);
  assert.deepEqual(
    [...source.matchAll(/export function\s+([A-Za-z0-9_]+)/gu)].map((match) => match[1]),
    [
      "patchEvidenceIdentityKey",
      "compactPatchEvidenceEntry",
      "readPatchApplyContext",
      "patchEvidenceForRow",
      "patchEvidenceClosureCodes",
      "isDeterministicAnnualSupplyCleanupTrace",
      "isDeterministicSourceExchangeCleanupTrace",
      "tracePatchEvidenceBlockers",
      "readPolicySnapshots",
      "hasImportOnlyTrace",
    ],
  );
});

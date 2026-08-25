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

test("identity decision context exists only as native TypeScript", () => {
  const typedPath = path.join(
    repoRoot,
    "scripts/lib/import-curation/internal/workflow-identity-decision-context.ts",
  );
  assert.equal(fs.existsSync(typedPath), true);
  assert.equal(fs.existsSync(typedPath.replace(/\.ts$/u, ".mjs")), false);
});

test("every static identity decision context consumer targets the typed module", () => {
  const consumers = [
    "scripts/lib/import-curation/internal/curation-gate-workflow.mjs",
    "scripts/lib/import-curation/internal/mutation-manifest-workflow.mjs",
    "scripts/lib/import-curation/internal/workflow-decision-full-context.mjs",
    "scripts/lib/import-curation/internal/workflow-identity-preflight.mjs",
    "scripts/lib/import-curation/internal/workflow-patch-evidence-context.ts",
    "test/unit/workflow-identity-decision-context-contract.test.mts",
  ];
  for (const consumer of consumers) {
    const source = readRepoFile(consumer);
    assert.match(source, /from ["'][^"']*workflow-identity-decision-context\.ts["']/u);
    assert.doesNotMatch(source, /workflow-identity-decision-context\.mjs/u);
  }
});

test("typed identity decision context retains nineteen zero-any exports", () => {
  const source = readRepoFile(
    "scripts/lib/import-curation/internal/workflow-identity-decision-context.ts",
  );
  assert.doesNotMatch(source, /\bany\b/u);
  assert.deepEqual(
    [...source.matchAll(/export function\s+([A-Za-z0-9_]+)/gu)].map((match) => match[1]),
    [
      "defaultIdentityReferenceRewriteFile",
      "normalizeIdentityReferenceRewriteRow",
      "readIdentityReferenceRewriteContext",
      "identityDecisionDatasetType",
      "identityDecisionDatasetId",
      "identityDecisionDatasetVersion",
      "identityDecisionIdentityKeys",
      "identityDecisionClosesAction",
      "identityDecisionValue",
      "identityDecisionCanonical",
      "identityDecisionPackageReference",
      "identityDecisionPackageSha",
      "readIdentityDecisionApplyContext",
      "mergeIdentityDecisionApplyContexts",
      "readIdentityDecisionApplyContexts",
      "identityDecisionApplyContextDecisionsForIdentity",
      "identityDecisionApplyContextClosesAction",
      "identityDecisionApplyContextHasDecision",
      "identityDecisionUnresolvedReferenceKeys",
    ],
  );
});

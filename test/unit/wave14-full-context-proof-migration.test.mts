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

test("internal full-context proof exists only as native TypeScript", () => {
  const typedPath = path.join(
    repoRoot,
    "scripts/lib/import-curation/internal/full-context-proof.ts",
  );
  assert.equal(fs.existsSync(typedPath), true);
  assert.equal(fs.existsSync(typedPath.replace(/\.ts$/u, ".mjs")), false);
});

test("every static internal full-context proof consumer targets the typed module", () => {
  const consumers = [
    "scripts/lib/import-curation/internal/workflow-decision-apply-context.ts",
    "scripts/lib/import-curation/internal/workflow-decision-full-context.mjs",
    "scripts/lib/import-curation/internal/workflow-identity-decision-context.ts",
    "scripts/lib/import-curation/internal/workflow-patch-evidence-context.ts",
    "scripts/lib/import-curation/internal/workflow-reference-closure.mjs",
    "scripts/lib/import-curation/internal/workflow-row-transform-context.mjs",
    "test/unit/full-context-proof-contract.test.mts",
  ];
  for (const consumer of consumers) {
    const source = readRepoFile(consumer);
    assert.match(source, /from ["'][^"']*full-context-proof\.ts["']/u);
    assert.doesNotMatch(source, /from ["'][^"']*full-context-proof\.mjs["']/u);
  }
});

test("typed internal full-context proof retains its exact zero-any export surface", () => {
  const source = readRepoFile("scripts/lib/import-curation/internal/full-context-proof.ts");
  assert.doesNotMatch(source, /\bany\b/u);
  assert.deepEqual(
    [...source.matchAll(/export function\s+([A-Za-z0-9_]+)/gu)].map((match) => match[1]),
    [
      "curationGateContextHasKind",
      "curationGateContextHasPattern",
      "evidenceResolution",
      "evidenceResolutionMode",
      "evidenceResolutionContextKinds",
      "contextFileHasNonEmptyText",
      "contextFilesHaveKind",
      "contextFilesHavePattern",
      "readAuthoringPackageProof",
      "authoringPackageProofsFromCurationGate",
      "authoringPackageProofsFromPatchCollect",
      "fullContextPackageProofBlockers",
      "normalizeClassificationDecisionRows",
      "readDecisionTaskProof",
      "decisionTaskProofFromApplyReport",
      "readDecisionTaskSharedContextBundleProof",
      "decisionTaskProofsFromApplyReport",
      "payloadSha256ByIdentityForRows",
      "fullContextDecisionTaskProofBlockers",
      "decisionTaskRequiredContextFilePatterns",
    ],
  );
});

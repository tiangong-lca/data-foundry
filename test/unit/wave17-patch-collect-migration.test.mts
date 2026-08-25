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

test("patch collect helper exists only as native TypeScript", () => {
  const typedPath = path.join(
    repoRoot,
    "scripts/lib/import-curation/internal/workflow-patch-collect.ts",
  );
  assert.equal(fs.existsSync(typedPath), true);
  assert.equal(fs.existsSync(typedPath.replace(/\.ts$/u, ".mjs")), false);
});

test("every static patch collect helper consumer targets the typed module", () => {
  const consumers = [
    "scripts/lib/import-curation/internal/authoring-patch-workflow.ts",
    "scripts/lib/import-curation/internal/curation-gate-workflow.mjs",
    "scripts/lib/import-curation/internal/mutation-manifest-workflow.mjs",
    "scripts/lib/import-curation/internal/workflow-dry-run-context.ts",
    "scripts/lib/import-curation/internal/workflow-identity-decision-context.ts",
    "scripts/lib/import-curation/internal/workflow-patch-evidence-context.ts",
    "scripts/lib/import-curation/internal/workflow-reference-closure.mjs",
    "scripts/lib/import-curation/internal/workflow-row-transform-context.ts",
    "scripts/lib/import-curation/internal/workflow-source-reference-context.mjs",
    "test/unit/workflow-patch-collect-contract.test.mts",
  ];
  for (const consumer of consumers) {
    const source = readRepoFile(consumer);
    assert.match(source, /from ["'][^"']*workflow-patch-collect\.ts["']/u);
    assert.doesNotMatch(source, /workflow-patch-collect\.mjs/u);
  }
});

test("typed patch collect helper retains nine zero-any exports", () => {
  const source = readRepoFile("scripts/lib/import-curation/internal/workflow-patch-collect.ts");
  assert.doesNotMatch(source, /\bany\b/u);
  assert.deepEqual(
    [...source.matchAll(/export function\s+([A-Za-z0-9_]+)/gu)].map((match) => match[1]),
    [
      "validateCollectedPatchSet",
      "readJsonLines",
      "readRowsIfExists",
      "readJsonIfOption",
      "readJsonArtifactsIfOption",
      "identityDecisionApplyReportOptionValues",
      "readFileArtifactIfOption",
      "defaultSourceReferenceRewriteFile",
      "normalizeSourceReferenceRewriteRow",
    ],
  );
});

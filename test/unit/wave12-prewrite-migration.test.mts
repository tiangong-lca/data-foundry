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

test("prewrite cleanup exists only as native TypeScript", () => {
  assert.equal(
    fs.existsSync(path.join(repoRoot, "scripts/lib/import-curation/internal/prewrite-cleanup.ts")),
    true,
  );
  assert.equal(
    fs.existsSync(path.join(repoRoot, "scripts/lib/import-curation/internal/prewrite-cleanup.mjs")),
    false,
  );
});

test("every static prewrite cleanup consumer targets the typed module", () => {
  const consumers = [
    "scripts/lib/import-curation/curation-cleanup.mjs",
    "scripts/lib/import-curation/internal/workflow-authoring-tasks.ts",
    "scripts/lib/import-curation/internal/workflow-patch-collect.ts",
    "scripts/lib/import-curation/internal/workflow-queue-context.ts",
    "scripts/lib/import-curation/internal/workflow-reference-closure.mjs",
    "scripts/lib/import-curation/internal/workflow-semantic-actions.ts",
    "test/unit/prewrite-cleanup-contract.test.mts",
  ];
  for (const consumer of consumers) {
    assert.match(
      readRepoFile(consumer),
      /from ["'][^"']*prewrite-cleanup\.ts["']/u,
      `${consumer} must import prewrite-cleanup.ts`,
    );
    assert.doesNotMatch(readRepoFile(consumer), /prewrite-cleanup\.mjs/u);
  }
});

test("typed prewrite cleanup retains its exact zero-any export surface", () => {
  const source = readRepoFile("scripts/lib/import-curation/internal/prewrite-cleanup.ts");
  assert.doesNotMatch(source, /\bany\b/u);
  assert.deepEqual(
    [...source.matchAll(/export (?:const|function)\s+([A-Za-z0-9_]+)/gu)].map((match) => match[1]),
    [
      "annualSupplyMissingDataSentinelText",
      "foundryTraceNamespace",
      "normalizeUtcDateTimeString",
      "normalizeDateTimeMetadata",
      "applyAnnualSupplyMissingDataSentinel",
      "applyDeterministicSourceExchangeCompletenessProofs",
      "buildSourceRowsByIdentity",
      "externalizeImportTraceMetadata",
      "ensureFoundryTraceNamespaces",
      "sanitizeFoundryTraceEvidenceLocators",
    ],
  );
});

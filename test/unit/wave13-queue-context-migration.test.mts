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

test("workflow queue context exists only as native TypeScript", () => {
  const typedPath = path.join(
    repoRoot,
    "scripts/lib/import-curation/internal/workflow-queue-context.ts",
  );
  assert.equal(fs.existsSync(typedPath), true);
  assert.equal(fs.existsSync(typedPath.replace(/\.ts$/u, ".mjs")), false);
});

test("every static workflow queue consumer targets the typed module", () => {
  const consumers = [
    "scripts/lib/import-curation/internal/curation-gate-workflow.ts",
    "scripts/lib/import-curation/internal/workflow-identity-preflight.ts",
    "scripts/lib/import-curation/internal/workflow-patch-evidence.ts",
    "scripts/lib/import-curation/internal/workflow-patch-evidence-context.ts",
    "scripts/lib/import-curation/internal/workflow-semantic-actions.ts",
    "test/unit/workflow-queue-context-contract.test.mts",
    "test/unit/workflow-queue-context-native-errors.test.mts",
  ];
  for (const consumer of consumers) {
    const source = readRepoFile(consumer);
    assert.match(source, /from ["'][^"']*workflow-queue-context\.ts["']/u);
    assert.doesNotMatch(source, /workflow-queue-context\.mjs/u);
  }
});

test("typed workflow queue context retains its exact zero-any export surface", () => {
  const source = readRepoFile("scripts/lib/import-curation/internal/workflow-queue-context.ts");
  assert.doesNotMatch(source, /\bany\b/u);
  assert.deepEqual(
    [...source.matchAll(/export (?:const|function)\s+([A-Za-z0-9_]+)/gu)].map((match) => match[1]),
    [
      "annualSupplyFieldPath",
      "isAnnualSupplyTarget",
      "isAnnualSupplySchemaIssue",
      "schemaIssueInstruction",
      "schemaIssueCurationAction",
      "readCurationQueueContext",
      "queueFilePath",
      "queueFileRelativePath",
      "summarizeQueueTask",
      "readQueueTaskRows",
      "findQueueTask",
      "buildQueueAuthoringContext",
      "readAuthoringQueueContext",
      "authoringQueueRowsForIdentity",
      "identityPreflightIndexPath",
    ],
  );
});

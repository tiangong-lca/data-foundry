import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, "..", "..");
const moduleRoot = path.join(repoRoot, "scripts/lib/import-curation/internal");

function readRepoFile(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

test("identity preflight exists only as native TypeScript", () => {
  assert.equal(fs.existsSync(path.join(moduleRoot, "workflow-identity-preflight.ts")), true);
  assert.equal(fs.existsSync(path.join(moduleRoot, "workflow-identity-preflight.mjs")), false);
});

test("every static identity-preflight consumer targets the typed module", () => {
  const consumers = [
    "docs/foundry-ai-navigation.md",
    "scripts/lib/import-curation/internal/curation-gate-workflow.ts",
    "scripts/lib/import-curation/internal/workflow-reference-closure.ts",
    "test/scenarios/bafu-mydata-override.test.mts",
    "test/scenarios/identity-curation-context.test.mts",
    "test/scenarios/mutation-lineage-helpers.test.mjs",
    "test/unit/content-policy-profile-waiver.test.mts",
    "test/unit/wave13-queue-context-migration.test.mts",
    "test/unit/wave18-identity-decision-context-migration.test.mts",
    "test/unit/wave20-row-transform-context-migration.test.mts",
    "test/unit/workflow-identity-preflight-contract.test.mts",
  ];
  for (const consumer of consumers) {
    const source = readRepoFile(consumer);
    assert.match(source, /workflow-identity-preflight\.ts/u, `${consumer} must use the TS module`);
    assert.doesNotMatch(source, /workflow-identity-preflight\.mjs/u);
  }
});

test("typed identity preflight retains its exact zero-escape export surface", () => {
  const source = readRepoFile(
    "scripts/lib/import-curation/internal/workflow-identity-preflight.ts",
  );
  const functions = [...source.matchAll(/export function\s+([A-Za-z0-9_]+)/gu)].length;
  const constants = [...source.matchAll(/export const\s+([A-Za-z0-9_]+)/gu)].length;
  assert.equal(functions + constants, 33);
  assert.doesNotMatch(source, /\bas\s+any\b|:\s*any\b|\bany\s*\[\]|<\s*any\b|,\s*any\s*>/u);
  assert.doesNotMatch(source, /@ts-(?:no)?check|@ts-ignore/u);
});

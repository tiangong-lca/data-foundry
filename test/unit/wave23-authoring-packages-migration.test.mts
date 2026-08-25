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

test("authoring packages runner exists only as native TypeScript", () => {
  assert.equal(fs.existsSync(path.join(moduleRoot, "authoring-packages.ts")), true);
  assert.equal(fs.existsSync(path.join(moduleRoot, "authoring-packages.mjs")), false);
});

test("typed authoring packages runner keeps one zero-escape export and typed facade import", () => {
  const source = readRepoFile("scripts/lib/import-curation/authoring-packages.ts");
  assert.match(source, /from ["']\.\/internal\/authoring-task-workflow\.ts["']/u);
  assert.deepEqual(
    [...source.matchAll(/export function\s+([A-Za-z0-9_]+)/gu)].map((match) => match[1]),
    ["runDatasetAuthoringTaskBuild"],
  );
  assert.doesNotMatch(source, /\bas\s+any\b|:\s*any\b|\bany\s*\[\]|<\s*any\b|,\s*any\s*>/u);
  assert.doesNotMatch(source, /@ts-(?:no)?check|@ts-ignore/u);
});

test("authoring packages consumers and navigation target the typed runner", () => {
  for (const consumer of [
    "scripts/lib/import-curation/index.ts",
    "docs/foundry-ai-navigation.md",
    "docs/foundry-command-surface.md",
    "test/unit/authoring-packages-runner-contract.test.mts",
  ]) {
    const source = readRepoFile(consumer);
    assert.match(source, /authoring-packages\.ts/u, `${consumer} must reference the typed runner`);
    assert.doesNotMatch(source, /authoring-packages\.mjs/u);
  }
});

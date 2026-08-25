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

test("patch collect runner exists only as native TypeScript", () => {
  assert.equal(fs.existsSync(path.join(moduleRoot, "patch-collect.ts")), true);
  assert.equal(fs.existsSync(path.join(moduleRoot, "patch-collect.mjs")), false);
});

test("typed patch collect keeps one zero-escape export and typed facade import", () => {
  const source = readRepoFile("scripts/lib/import-curation/patch-collect.ts");
  assert.match(source, /from ["']\.\/internal\/authoring-patch-workflow\.ts["']/u);
  assert.deepEqual(
    [...source.matchAll(/export function\s+([A-Za-z0-9_]+)/gu)].map((match) => match[1]),
    ["runDatasetAuthoringPatchCollect"],
  );
  assert.doesNotMatch(source, /\bas\s+any\b|:\s*any\b|\bany\s*\[\]|<\s*any\b|,\s*any\s*>/u);
  assert.doesNotMatch(source, /@ts-(?:no)?check|@ts-ignore/u);
});

test("patch collect consumers and navigation target the typed runner", () => {
  for (const consumer of [
    "scripts/lib/import-curation/index.ts",
    "docs/foundry-ai-navigation.md",
    "docs/foundry-command-surface.md",
    "test/unit/patch-collect-runner-contract.test.mts",
  ]) {
    const source = readRepoFile(consumer);
    assert.match(source, /patch-collect\.ts/u, `${consumer} must reference the typed runner`);
    assert.doesNotMatch(source, /patch-collect\.mjs/u);
  }
});

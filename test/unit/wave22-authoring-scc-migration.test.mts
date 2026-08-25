import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, "..", "..");
const internalRoot = path.join(repoRoot, "scripts/lib/import-curation/internal");

function readRepoFile(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

test("authoring SCC exists atomically only as native TypeScript", () => {
  for (const base of [
    "workflow-authoring-tasks",
    "workflow-semantic-actions",
    "workflow-patch-evidence",
  ]) {
    assert.equal(fs.existsSync(path.join(internalRoot, `${base}.ts`)), true);
    assert.equal(fs.existsSync(path.join(internalRoot, `${base}.mjs`)), false);
  }
});

test("authoring SCC cycle closes entirely over typed imports", () => {
  const authoring = readRepoFile(
    "scripts/lib/import-curation/internal/workflow-authoring-tasks.ts",
  );
  const semantic = readRepoFile(
    "scripts/lib/import-curation/internal/workflow-semantic-actions.ts",
  );
  const evidence = readRepoFile("scripts/lib/import-curation/internal/workflow-patch-evidence.ts");
  const explicitAny = /\bas\s+any\b|:\s*any\b|\bany\s*\[\]|<\s*any\b|,\s*any\s*>/u;
  assert.match(authoring, /from ["']\.\/workflow-semantic-actions\.ts["']/u);
  assert.match(semantic, /from ["']\.\/workflow-authoring-tasks\.ts["']/u);
  assert.match(semantic, /from ["']\.\/workflow-patch-evidence\.ts["']/u);
  assert.match(evidence, /from ["']\.\/workflow-authoring-tasks\.ts["']/u);
  for (const source of [authoring, semantic, evidence]) {
    assert.doesNotMatch(
      source,
      /from ["']\.\/workflow-(?:authoring-tasks|semantic-actions|patch-evidence)\.mjs["']/u,
    );
    assert.doesNotMatch(source, explicitAny);
    assert.doesNotMatch(source, /@ts-(?:no)?check|@ts-ignore/u);
  }
});

test("typed authoring SCC retains exact export counts", () => {
  const expected = new Map([
    ["workflow-authoring-tasks.ts", 29],
    ["workflow-semantic-actions.ts", 66],
    ["workflow-patch-evidence.ts", 26],
  ]);
  for (const [fileName, count] of expected) {
    const source = fs.readFileSync(path.join(internalRoot, fileName), "utf8");
    const functions = [...source.matchAll(/export function\s+([A-Za-z0-9_]+)/gu)].length;
    const constants = [...source.matchAll(/export const\s+([A-Za-z0-9_]+)/gu)].length;
    assert.equal(functions + constants, count);
  }
});

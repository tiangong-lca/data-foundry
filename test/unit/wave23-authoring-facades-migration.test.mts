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

test("authoring workflow facades exist atomically only as native TypeScript", () => {
  for (const stem of ["authoring-task-workflow", "authoring-patch-workflow"]) {
    assert.equal(fs.existsSync(path.join(internalRoot, `${stem}.ts`)), true);
    assert.equal(fs.existsSync(path.join(internalRoot, `${stem}.mjs`)), false);
  }
});

test("typed facade exports remain direct references to typed workflow owners", () => {
  const taskSource = readRepoFile(
    "scripts/lib/import-curation/internal/authoring-task-workflow.ts",
  );
  const patchSource = readRepoFile(
    "scripts/lib/import-curation/internal/authoring-patch-workflow.ts",
  );
  assert.match(taskSource, /from ["']\.\/workflow-authoring-tasks\.ts["']/u);
  assert.match(patchSource, /from ["']\.\/workflow-authoring-tasks\.ts["']/u);
  assert.match(patchSource, /from ["']\.\/workflow-patch-collect\.ts["']/u);
  assert.match(patchSource, /from ["']\.\/workflow-semantic-actions\.ts["']/u);
  for (const source of [taskSource, patchSource]) {
    assert.doesNotMatch(source, /\bas\s+any\b|:\s*any\b|\bany\s*\[\]|<\s*any\b|,\s*any\s*>/u);
    assert.doesNotMatch(source, /@ts-(?:no)?check|@ts-ignore/u);
  }
});

test("authoring facade consumers target the typed modules", () => {
  const consumers = [
    ["scripts/lib/import-curation/authoring-packages.ts", "./internal/authoring-task-workflow.ts"],
    ["scripts/lib/import-curation/patch-collect.ts", "./internal/authoring-patch-workflow.ts"],
  ] as const;
  for (const [consumer, specifier] of consumers) {
    const source = readRepoFile(consumer);
    assert.match(source, new RegExp(specifier.replaceAll(".", "\\."), "u"));
    assert.doesNotMatch(source, /authoring-(?:task|patch)-workflow\.mjs/u);
  }
});

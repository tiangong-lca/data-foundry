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

test("mutation manifest facade and runner migrate atomically to TypeScript", () => {
  for (const relativePath of ["internal/mutation-manifest-workflow", "mutation-manifest"]) {
    assert.equal(fs.existsSync(path.join(moduleRoot, `${relativePath}.ts`)), true);
    assert.equal(fs.existsSync(path.join(moduleRoot, `${relativePath}.mjs`)), false);
  }
});

test("typed mutation sources retain zero-escape owner and facade boundaries", () => {
  const facade = readRepoFile("scripts/lib/import-curation/internal/mutation-manifest-workflow.ts");
  const runner = readRepoFile("scripts/lib/import-curation/mutation-manifest.ts");
  assert.match(facade, /\.\/workflow-reference-closure\.ts/u);
  assert.match(facade, /\.\/workflow-source-reference-context\.ts/u);
  assert.match(runner, /\.\/internal\/mutation-manifest-workflow\.ts/u);
  for (const source of [facade, runner]) {
    assert.doesNotMatch(source, /\bas\s+any\b|:\s*any\b|\bany\s*\[\]|<\s*any\b|,\s*any\s*>/u);
    assert.doesNotMatch(source, /@ts-(?:no)?check|@ts-ignore|@ts-expect-error/u);
  }
});

test("mutation manifest consumers and navigation target the typed runner", () => {
  const indexSource = readRepoFile("scripts/lib/import-curation/index.ts");
  const metadataSource = readRepoFile("scripts/lib/foundry-command-metadata.ts");
  assert.match(indexSource, /mutation-manifest\.ts/u);
  assert.doesNotMatch(indexSource, /mutation-manifest\.mjs/u);
  assert.match(metadataSource, /typedImportOwner\("mutation-manifest"\)/u);
  assert.doesNotMatch(metadataSource, /importOwner\("mutation-manifest"\)/u);
});

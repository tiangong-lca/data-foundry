import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, "..", "..");
const commandTests = [
  "bundle-sample-rows",
  "canonical-support-rewrites",
  "import-ledger",
  "support-cache",
];

test("core ledger and support command tests exist only as native TypeScript", () => {
  for (const name of commandTests) {
    const typedPath = path.join(repoRoot, "test/commands", `${name}.test.mts`);
    const legacyPath = path.join(repoRoot, "test/commands", `${name}.test.mjs`);
    assert.equal(fs.existsSync(typedPath), true, typedPath);
    assert.equal(fs.existsSync(legacyPath), false, legacyPath);
    const source = fs.readFileSync(typedPath, "utf8");
    assert.doesNotMatch(source, /\bas\s+any\b|:\s*any\b|\bany\s*\[\]|<\s*any\b|,\s*any\s*>/u, name);
    assert.doesNotMatch(source, /@ts-(?:no)?check|@ts-ignore/u, name);
  }
});

test("metadata and migration consumers target the typed command tests", () => {
  for (const consumer of [
    "scripts/lib/foundry-command-metadata.ts",
    "test/unit/wave9-canonical-bundle-migration.test.mts",
    "docs/import-profiles/bafu/fp-ug-canonical-support-governance.md",
  ]) {
    const source = fs.readFileSync(path.join(repoRoot, consumer), "utf8");
    for (const name of commandTests.filter((candidate) => source.includes(candidate))) {
      assert.match(source, new RegExp(`test/commands/${name}\\.test\\.mts`, "u"), consumer);
      assert.doesNotMatch(source, new RegExp(`test/commands/${name}\\.test\\.mjs`, "u"), consumer);
    }
  }
});

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const commandTests = [
  "authoring-plan",
  "authoring-task-context",
  "classification-decisions",
  "location-decisions",
];

test("authoring and decision command tests exist only as zero-escape TypeScript", () => {
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

test("metadata and test layout target typed authoring and decision tests", () => {
  for (const consumer of ["scripts/lib/foundry-command-metadata.ts", "test/README.md"]) {
    const source = fs.readFileSync(path.join(repoRoot, consumer), "utf8");
    for (const name of commandTests.filter((candidate) => source.includes(`${candidate}.test.`))) {
      assert.match(source, new RegExp(`test/commands/${name}\\.test\\.mts`, "u"), consumer);
      assert.doesNotMatch(source, new RegExp(`test/commands/${name}\\.test\\.mjs`, "u"), consumer);
    }
  }
});

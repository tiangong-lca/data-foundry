import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const commandTests = [
  "bafu-auto-authoring",
  "bafu-batch-import-run",
  "bafu-leaf-classification-tasks",
  "bafu-process-scope-e2e",
  "library-scope-workflow-elementary-identity",
];

test("BAFU and library command tests exist only as zero-escape TypeScript", () => {
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

test("command metadata targets typed BAFU tests", () => {
  const metadata = fs.readFileSync(
    path.join(repoRoot, "scripts/lib/foundry-command-metadata.ts"),
    "utf8",
  );
  for (const name of commandTests.filter((candidate) => metadata.includes(candidate))) {
    assert.match(metadata, new RegExp(`test/commands/${name}\\.test\\.mts`, "u"), name);
    assert.doesNotMatch(metadata, new RegExp(`test/commands/${name}\\.test\\.mjs`, "u"), name);
  }
});

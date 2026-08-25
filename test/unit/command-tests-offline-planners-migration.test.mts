import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const commandTests = ["incremental-change-set", "topology-convergence", "execution-capsule"];

test("offline planner command tests exist only as zero-escape TypeScript", () => {
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

test("contracts metadata registry and migration tests target typed planner tests", () => {
  const consumers = [
    "scripts/lib/foundry-command-metadata.ts",
    "docs/execution-capsule-contract.md",
    "docs/incremental-change-set-contract.md",
    "docs/topology-convergence-contract.md",
    "docs/file-location-registry.json",
    "test/unit/execution-capsule-command-factory.test.mts",
  ];
  for (const consumer of consumers) {
    const source = fs.readFileSync(path.join(repoRoot, consumer), "utf8");
    for (const name of commandTests.filter((candidate) => source.includes(`${candidate}.test.`))) {
      assert.match(source, new RegExp(`test/commands/${name}\\.test\\.mts`, "u"), consumer);
      assert.doesNotMatch(source, new RegExp(`test/commands/${name}\\.test\\.mjs`, "u"), consumer);
    }
  }
});

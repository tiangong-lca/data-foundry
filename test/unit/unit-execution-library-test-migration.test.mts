import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, "..", "..");
const stems = [
  "execution-capsule-attempt-state",
  "finalize-resolution-reuse-seed",
  "library-contact-reuse",
] as const;
const governedPaths = [
  "AGENTS.md",
  "README.md",
  "WORKFLOW.md",
  "docs/architecture.md",
  "docs/execution-capsule-contract.md",
  "docs/foundry-ai-navigation.md",
  "docs/foundry-command-surface.md",
  "test/README.md",
] as const;

test("execution, finalize, and library unit tests exist only as native TypeScript", () => {
  for (const stem of stems) {
    const typedPath = path.join(repoRoot, "test/unit", `${stem}.test.mts`);
    const legacyPath = path.join(repoRoot, "test/unit", `${stem}.test.mjs`);
    assert.equal(fs.existsSync(typedPath), true, stem);
    assert.equal(fs.existsSync(legacyPath), false, stem);
    const source = fs.readFileSync(typedPath, "utf8");
    assert.match(source, /from ["']node:test["']/u, stem);
    assert.doesNotMatch(source, /(?:[:<>,(|]\s*any\b|\bas\s+any\b)/u, stem);
    assert.doesNotMatch(source, /@ts-(?:ignore|nocheck|expect-error)/u, stem);
  }
});

test("governed docs do not retain execution/finalize/library legacy test paths", () => {
  const activeText = governedPaths
    .map((relativePath) => fs.readFileSync(path.join(repoRoot, relativePath), "utf8"))
    .join("\n");
  for (const stem of stems) {
    assert.doesNotMatch(activeText, new RegExp(`test/unit/${stem}\\.test\\.mjs`, "u"), stem);
  }
});

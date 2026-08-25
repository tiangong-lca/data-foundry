import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, "..", "..");

function readRepoFile(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

test("Foundry runtime utilities exist only as native TypeScript", () => {
  assert.equal(fs.existsSync(path.join(repoRoot, "scripts/lib/foundry-runtime-utils.ts")), true);
  assert.equal(fs.existsSync(path.join(repoRoot, "scripts/lib/foundry-runtime-utils.mjs")), false);
});

test("every static Foundry runtime consumer targets the typed module explicitly", () => {
  const expectedImports = [
    ["scripts/foundry.mjs", "./lib/foundry-runtime-utils.ts"],
    ["scripts/with-lca-account.ts", "./lib/foundry-runtime-utils.ts"],
    ["scripts/commands/bafu-auto-authoring.mjs", "../lib/foundry-runtime-utils.ts"],
    ["scripts/commands/bafu-batch-import-run.mjs", "../lib/foundry-runtime-utils.ts"],
    ["scripts/commands/bafu-leaf-classification-tasks.mjs", "../lib/foundry-runtime-utils.ts"],
    ["scripts/lib/location-quality-utils.mjs", "./foundry-runtime-utils.ts"],
    ["scripts/lib/remote-verification-accepted-diff.ts", "./foundry-runtime-utils.ts"],
    ["scripts/lib/import-curation/internal/context-inputs.ts", "../../foundry-runtime-utils.ts"],
    ["test/fixtures/foundry-core.mjs", "../../scripts/lib/foundry-runtime-utils.ts"],
    [
      "test/scenarios/library-scope-workflow.test.mjs",
      "../../scripts/lib/foundry-runtime-utils.ts",
    ],
    [
      "test/unit/foundry-runtime-utils-contract.test.mts",
      "../../scripts/lib/foundry-runtime-utils.ts",
    ],
  ] as const;
  for (const [consumer, specifier] of expectedImports) {
    assert.match(
      readRepoFile(consumer),
      new RegExp(`from ["']${specifier.replaceAll(".", "\\.")}["']`, "u"),
      `${consumer} must import ${specifier}`,
    );
  }
  assert.match(
    readRepoFile("test/unit/toolchain-contract.test.mts"),
    /readText\("scripts\/lib\/foundry-runtime-utils\.ts"\)/u,
  );
});

test("typed Foundry runtime retains its exact named export surface", () => {
  const source = readRepoFile("scripts/lib/foundry-runtime-utils.ts");
  assert.doesNotMatch(source, /\bany\b/u);
  assert.deepEqual(
    [...source.matchAll(/export function\s+([A-Za-z0-9_]+)/gu)].map((match) => match[1]),
    [
      "resolveInstalledTiangongLcaCliPackage",
      "resolveTiangongLcaCliRuntimeCommand",
      "createFoundryRuntimeUtils",
    ],
  );
});

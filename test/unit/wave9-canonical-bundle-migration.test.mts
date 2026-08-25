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

function assertTypedLeaf(stem: string): void {
  assert.equal(
    fs.existsSync(path.join(repoRoot, `scripts/lib/${stem}.ts`)),
    true,
    `${stem}.ts must exist`,
  );
  assert.equal(
    fs.existsSync(path.join(repoRoot, `scripts/lib/${stem}.mjs`)),
    false,
    `${stem}.mjs must be removed`,
  );
}

function assertStaticImports(expectedImports: ReadonlyArray<readonly [string, string]>): void {
  for (const [consumer, specifier] of expectedImports) {
    assert.match(
      readRepoFile(consumer),
      new RegExp(`from ["']${specifier.replaceAll(".", "\\.")}["']`, "u"),
      `${consumer} must import ${specifier}`,
    );
  }
}

function exportedFunctions(relativePath: string): string[] {
  return [...readRepoFile(relativePath).matchAll(/export function\s+([A-Za-z0-9_]+)/gu)].map(
    (match) => match[1],
  );
}

test("canonical support rewrites exist only as native TypeScript", () => {
  assertTypedLeaf("canonical-support-rewrites");
});

test("bundle sample utilities exist only as native TypeScript", () => {
  assertTypedLeaf("bundle-sample-utils");
});

test("canonical support rewrite consumers target the typed module explicitly", () => {
  assertStaticImports([
    ["scripts/foundry.ts", "./lib/canonical-support-rewrites.ts"],
    [
      "test/commands/canonical-support-rewrites.test.mjs",
      "../../scripts/lib/canonical-support-rewrites.ts",
    ],
    [
      "test/unit/canonical-support-rewrites-contract.test.mts",
      "../../scripts/lib/canonical-support-rewrites.ts",
    ],
  ]);
});

test("bundle sample consumers target the typed module explicitly", () => {
  assertStaticImports([
    ["scripts/foundry.ts", "./lib/bundle-sample-utils.ts"],
    ["test/unit/library-contact-reuse.test.mjs", "../../scripts/lib/bundle-sample-utils.ts"],
    ["test/unit/bundle-sample-utils-contract.test.mts", "../../scripts/lib/bundle-sample-utils.ts"],
  ]);
});

test("typed canonical rewrite factory retains its exact named export surface", () => {
  assert.deepEqual(exportedFunctions("scripts/lib/canonical-support-rewrites.ts"), [
    "createCanonicalSupportRewriteUtils",
  ]);
});

test("typed bundle sample factory retains its exact named export surface", () => {
  assert.deepEqual(exportedFunctions("scripts/lib/bundle-sample-utils.ts"), [
    "createBundleSampleUtils",
  ]);
});

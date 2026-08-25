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

test("BAFU family signatures exist only as native TypeScript", () => {
  assertTypedLeaf("bafu-family-signatures");
});

test("import ledger exists only as native TypeScript", () => {
  assertTypedLeaf("import-ledger");
});

test("BAFU family signature consumers target the typed module explicitly", () => {
  assertStaticImports([
    ["scripts/commands/bafu-batch-import-run.mjs", "../lib/bafu-family-signatures.ts"],
    ["test/unit/bafu-family-signatures.test.mjs", "../../scripts/lib/bafu-family-signatures.ts"],
    [
      "test/unit/bafu-family-signatures-contract.test.mts",
      "../../scripts/lib/bafu-family-signatures.ts",
    ],
  ]);
});

test("import ledger consumers target the typed module explicitly", () => {
  assertStaticImports([
    ["scripts/foundry.mjs", "./lib/import-ledger.ts"],
    ["test/unit/import-ledger-utils.test.mjs", "../../scripts/lib/import-ledger.ts"],
    ["test/unit/import-ledger-contract.test.mts", "../../scripts/lib/import-ledger.ts"],
  ]);
});

test("typed BAFU family signatures retain their exact named export surface", () => {
  assert.deepEqual(exportedFunctions("scripts/lib/bafu-family-signatures.ts"), [
    "normalizeBafuFamilyName",
    "summarizeBafuFamilySignatures",
    "bafuFamilyEntryFromProcess",
    "bafuScopeKey",
    "buildBafuFamilySignatureIndex",
    "bafuFamilySignatureForScope",
    "compactBafuFamilySignature",
    "bafuFamilyPlanFields",
    "bafuFamilySelectionRank",
    "summarizeBafuFamilyScopes",
  ]);
});

test("typed import ledger retains its exact named export surface", () => {
  assert.deepEqual(exportedFunctions("scripts/lib/import-ledger.ts"), ["createImportLedgerUtils"]);
});

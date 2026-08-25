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

test("Wave 8 large leaves exist only as native TypeScript", () => {
  for (const stem of ["bafu-family-signatures", "import-ledger"]) {
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
});

test("Wave 8 static consumers target the typed modules explicitly", () => {
  const expectedImports = [
    ["scripts/commands/bafu-batch-import-run.mjs", "../lib/bafu-family-signatures.ts"],
    ["scripts/foundry.mjs", "./lib/import-ledger.ts"],
    ["test/unit/bafu-family-signatures.test.mjs", "../../scripts/lib/bafu-family-signatures.ts"],
    [
      "test/unit/bafu-family-signatures-contract.test.mts",
      "../../scripts/lib/bafu-family-signatures.ts",
    ],
    ["test/unit/import-ledger-utils.test.mjs", "../../scripts/lib/import-ledger.ts"],
    ["test/unit/import-ledger-contract.test.mts", "../../scripts/lib/import-ledger.ts"],
  ] as const;
  for (const [consumer, specifier] of expectedImports) {
    assert.match(
      readRepoFile(consumer),
      new RegExp(`from ["']${specifier.replaceAll(".", "\\.")}["']`, "u"),
      `${consumer} must import ${specifier}`,
    );
  }
});

test("Wave 8 typed leaves retain their exact named export surfaces", () => {
  const exportedFunctions = (relativePath: string): string[] =>
    [...readRepoFile(relativePath).matchAll(/export function\s+([A-Za-z0-9_]+)/gu)].map(
      (match) => match[1],
    );

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
  assert.deepEqual(exportedFunctions("scripts/lib/import-ledger.ts"), ["createImportLedgerUtils"]);
});

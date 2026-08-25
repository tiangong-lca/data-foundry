import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createImportLedgerCommands } from "../../scripts/commands/import-ledger.ts";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, "..", "..");

function readRepoFile(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

test("import-ledger command factory preserves the injected runner without invoking it", () => {
  const calls: unknown[][] = [];
  const runner = (...args: unknown[]): { args: unknown[] } => {
    calls.push(args);
    return { args };
  };

  const commands = createImportLedgerCommands({ runDatasetImportLedgerReport: runner });

  assert.deepEqual(Object.keys(commands), ["runDatasetImportLedgerReport"]);
  assert.equal(commands.runDatasetImportLedgerReport, runner);
  assert.deepEqual(calls, []);
  assert.deepEqual(commands.runDatasetImportLedgerReport("ledger", { dryRun: true }), {
    args: ["ledger", { dryRun: true }],
  });
  assert.deepEqual(calls, [["ledger", { dryRun: true }]]);
});

test("import-ledger command factory exists only as zero-any native TypeScript", () => {
  const typedPath = path.join(repoRoot, "scripts/commands/import-ledger.ts");
  assert.equal(fs.existsSync(typedPath), true);
  assert.equal(fs.existsSync(typedPath.replace(/\.ts$/u, ".mjs")), false);
  const source = readRepoFile("scripts/commands/import-ledger.ts");
  assert.doesNotMatch(source, /\bany\b/u);
  assert.deepEqual(
    [...source.matchAll(/export function\s+([A-Za-z0-9_]+)/gu)].map((match) => match[1]),
    ["createImportLedgerCommands"],
  );
});

test("all active import-ledger owner consumers target the typed command factory", () => {
  for (const consumer of [
    "scripts/foundry.mjs",
    "scripts/lib/foundry-command-metadata.ts",
    "test/unit/import-ledger-command-factory.test.mts",
  ]) {
    const source = readRepoFile(consumer);
    assert.match(source, /(?:commands\/|\.\.\/\.\.\/scripts\/commands\/)import-ledger\.ts/u);
    assert.doesNotMatch(source, /commands\/import-ledger\.mjs/u);
  }
});

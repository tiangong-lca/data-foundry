import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, "..", "..");
const typedPath = path.join(repoRoot, "scripts/commands/identity-preflight-run.ts");
const legacyPath = path.join(repoRoot, "scripts/commands/identity-preflight-run.mjs");

function readRepoFile(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

test("identity-preflight command help bytes remain exact for all four exports", () => {
  const expected = [
    {
      command: "dataset-identity-preflight-requests-build",
      bytes: 893,
      sha256: "e2940e4d2be9bc7d256c89ca85894f7fe955b899868a4ce4caf865757b524c71",
    },
    {
      command: "dataset-identity-preflight-query-audit",
      bytes: 458,
      sha256: "7f90e3e7393fec5cb845448e80861cff98d4fb04fdda3dabc2a63049e1671ea5",
    },
    {
      command: "dataset-identity-preflight-run",
      bytes: 4534,
      sha256: "70ef0d4681efc448f3fa5597730d06037d0ef5f6f2c0a2a6f9bf485d364ed3be",
    },
    {
      command: "dataset-identity-preflight-index-merge",
      bytes: 749,
      sha256: "1496914f7246be1d52e18288c48f92f00f3444041117ed719ad6205a34b89b3e",
    },
  ];
  for (const contract of expected) {
    const result = spawnSync(
      process.execPath,
      ["scripts/foundry.mjs", contract.command, "--help"],
      {
        cwd: repoRoot,
        encoding: null,
      },
    );
    assert.equal(result.status, 0, contract.command);
    assert.equal(result.stderr.length, 0, contract.command);
    assert.equal(result.stdout.length, contract.bytes, contract.command);
    assert.equal(
      createHash("sha256").update(result.stdout).digest("hex"),
      contract.sha256,
      contract.command,
    );
  }
});

test("identity-preflight runner retains receipt, binding, cache, disk, and fail-closed codes", () => {
  const source = fs.readFileSync(fs.existsSync(typedPath) ? typedPath : legacyPath, "utf8");
  for (const contract of [
    "parseFreshIntentBoundAuthReceipt",
    "validateBoundExecutionManifest",
    "validateIdentityPreflightExecution",
    "identity_preflight_request_hash_drift",
    "identity_preflight_request_json_hash_drift",
    "identity_preflight_target_hash_drift",
    "identity_preflight_execution_binding_invalid",
    "restored_from_bound_cache",
    "skipped_bound_execution",
    "identity_preflight_timeout",
    "identity_preflight_execution_invalid",
    "stdout/disk mismatch",
    "stale disk report",
    "Every nonzero CLI exit",
  ]) {
    assert.match(source, new RegExp(contract.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"));
  }
  assert.match(source, /spawnSync\(cli\.command, receiptArgs/u);
  assert.match(source, /spawnSync\(cli\.command, spawnArgs/u);
  assert.match(source, /shell:\s*false/u);
  assert.doesNotMatch(source, /execSync|execFileSync|shell:\s*true/u);
});

test("identity-preflight command owner exists only as zero-escape native TypeScript", () => {
  assert.equal(fs.existsSync(typedPath), true);
  assert.equal(fs.existsSync(legacyPath), false);
  const source = fs.readFileSync(typedPath, "utf8");
  assert.doesNotMatch(source, /\bas\s+any\b|:\s*any\b|\bany\s*\[\]|<\s*any\b|,\s*any\s*>/u);
  assert.doesNotMatch(source, /@ts-(?:no)?check|@ts-ignore/u);
  assert.deepEqual(
    [...source.matchAll(/export function\s+([A-Za-z0-9_]+)/gu)].map((match) => match[1]),
    ["createIdentityPreflightRunCommands"],
  );
});

test("identity-preflight consumers and metadata target the typed owner", () => {
  for (const consumer of [
    "scripts/foundry.mjs",
    "scripts/lib/foundry-command-metadata.ts",
    "scripts/commands/bafu-batch-import-run.mjs",
  ]) {
    const source = readRepoFile(consumer);
    assert.match(source, /(?:commands\/|scripts\/commands\/)identity-preflight-run\.ts/u, consumer);
    assert.doesNotMatch(
      source,
      /(?:commands\/|scripts\/commands\/)identity-preflight-run\.mjs/u,
      consumer,
    );
  }
});

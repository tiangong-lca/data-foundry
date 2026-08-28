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
      bytes: 890,
      sha256: "918dcb2f34a0a54fab5684fa722348c1291b93f8d86c882c4c79e146e8875012",
    },
    {
      command: "dataset-identity-preflight-query-audit",
      bytes: 457,
      sha256: "0a22ecb83e482ceac6fc84b17f4ffa4b6ef56d323cfb865bb0faf9f8d9b15b27",
    },
    {
      command: "dataset-identity-preflight-run",
      bytes: 4531,
      sha256: "918bd3aff37a471a01ce9ec9715ef93fc5f6de05b3643d139b8ce1f23542a685",
    },
    {
      command: "dataset-identity-preflight-index-merge",
      bytes: 747,
      sha256: "8b60ceb7d6a69f5cc87a4da5ecf0b52afadc8bade3c74c4174926b474ea294e7",
    },
  ];
  for (const contract of expected) {
    const result = spawnSync(process.execPath, ["scripts/foundry.ts", contract.command, "--help"], {
      cwd: repoRoot,
      encoding: null,
    });
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
    "scripts/foundry.ts",
    "scripts/lib/foundry-command-metadata.ts",
    "scripts/lib/batch-orchestration/bafu-batch-command-runtime.ts",
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

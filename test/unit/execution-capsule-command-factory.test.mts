import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  createExecutionCapsuleCommands,
  modelExecutionAttemptDisposition,
} from "../../scripts/commands/execution-capsule.ts";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, "..", "..");

function readRepoFile(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

test("execution capsule help is exact and does not touch the filesystem", () => {
  const commands = createExecutionCapsuleCommands({ repoRoot: "/path/that/does/not/exist" });
  assert.deepEqual(commands.runExecutionCapsuleAdmit({ help: true }), {
    status: "help",
    command: "execution-capsule-admit",
    usage:
      "node scripts/foundry.ts execution-capsule-admit --stage-manifest <revision.json> [--predecessor-stage-manifest <previous-revision.json>] --out-dir <fresh-dir>",
    effects: "local evidence files only; zero network, database, CLI dispatch, and mutation",
  });
});

test("attempt disposition matrix consumes dispatch exactly once and only exact readback is terminal", () => {
  const cases = [
    {
      input: { dispatch_state: "NOT_DISPATCHED", readback_state: "NOT_STARTED" },
      expected: {
        disposition: "UNATTEMPTED",
        attempt_consumed: false,
        replay_allowed: true,
        terminal: false,
      },
    },
    {
      input: { dispatch_state: "DISPATCH_CONFIRMED", readback_state: "EXACT_DESIRED" },
      expected: {
        disposition: "SUCCEEDED_EXACT_READBACK",
        attempt_consumed: true,
        replay_allowed: false,
        terminal: true,
      },
    },
    {
      input: { dispatch_state: "DISPATCH_UNKNOWN", readback_state: "EXACT_DESIRED" },
      expected: {
        disposition: "SUCCEEDED_RECOVERED_EXACT_READBACK",
        attempt_consumed: true,
        replay_allowed: false,
        terminal: true,
      },
    },
    {
      input: { dispatch_state: "DISPATCH_CONFIRMED", readback_state: "MISSING" },
      expected: {
        disposition: "UNKNOWN_DO_NOT_REPLAY",
        attempt_consumed: true,
        replay_allowed: false,
        terminal: false,
      },
    },
    {
      input: { dispatch_state: "DISPATCH_UNKNOWN", readback_state: "MISMATCH" },
      expected: {
        disposition: "UNKNOWN_DO_NOT_REPLAY",
        attempt_consumed: true,
        replay_allowed: false,
        terminal: false,
      },
    },
    {
      input: { dispatch_state: "UNRECOGNIZED", readback_state: "EXACT_DESIRED" },
      expected: {
        disposition: "UNKNOWN_DO_NOT_REPLAY",
        attempt_consumed: true,
        replay_allowed: false,
        terminal: false,
      },
    },
  ];
  for (const entry of cases) {
    assert.deepEqual(modelExecutionAttemptDisposition(entry.input), entry.expected);
  }
});

test("execution capsule source remains offline, exclusive, hash-bound, and zero-authority", () => {
  const source = readRepoFile("scripts/commands/execution-capsule.ts");
  for (const forbidden of [
    "node:child_process",
    "node:http",
    "node:https",
    "node:net",
    "fetch(",
    "spawn(",
    "exec(",
  ]) {
    assert.equal(source.includes(forbidden), false, forbidden);
  }
  assert.match(source, /flag:\s*["']wx["']/u);
  assert.match(source, /production_authority:\s*false/u);
  assert.match(source, /primary_attempt_count:\s*0/u);
  assert.match(source, /seal_payload_sha256:\s*sha256\(stableJson\(sealPayload\)\)/u);
});

test("execution capsule exists only as zero-escape native TypeScript", () => {
  const typedPath = path.join(repoRoot, "scripts/commands/execution-capsule.ts");
  assert.equal(fs.existsSync(typedPath), true);
  assert.equal(fs.existsSync(typedPath.replace(/\.ts$/u, ".mjs")), false);
  const source = fs.readFileSync(typedPath, "utf8");
  assert.doesNotMatch(source, /\bas\s+any\b|:\s*any\b|\bany\s*\[\]|<\s*any\b|,\s*any\s*>/u);
  assert.doesNotMatch(source, /@ts-(?:no)?check|@ts-ignore/u);
});

test("execution capsule consumers and contract target the typed command owner", () => {
  for (const consumer of [
    "scripts/foundry.ts",
    "scripts/lib/foundry-command-metadata.ts",
    "test/commands/execution-capsule.test.mjs",
    "test/unit/execution-capsule-attempt-state.test.mjs",
    "test/unit/execution-capsule-command-factory.test.mts",
    "docs/execution-capsule-contract.md",
  ]) {
    const source = readRepoFile(consumer);
    assert.match(
      source,
      consumer === "test/commands/execution-capsule.test.mjs"
        ? /["']execution-capsule\.ts["']/u
        : /(?:commands\/|scripts\/commands\/)execution-capsule\.ts/u,
    );
    assert.doesNotMatch(source, /(?:commands\/|scripts\/commands\/)execution-capsule\.mjs/u);
  }
});

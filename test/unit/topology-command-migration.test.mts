import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, "..", "..");
const typedPath = path.join(repoRoot, "scripts/commands/topology-convergence.ts");
const legacyPath = path.join(repoRoot, "scripts/commands/topology-convergence.mjs");

function readRepoFile(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

test("topology command exists only as native TypeScript", () => {
  assert.equal(fs.existsSync(typedPath), true);
  assert.equal(fs.existsSync(legacyPath), false);
  const source = fs.readFileSync(typedPath, "utf8");
  assert.doesNotMatch(source, /(?:[:<>,(|]\s*any\b|\bas\s+any\b)/u);
  assert.doesNotMatch(source, /@ts-(?:ignore|nocheck|expect-error)/u);
  assert.deepEqual(
    [...source.matchAll(/export function\s+([A-Za-z0-9_]+)/gu)].map((match) => match[1]),
    [
      "stableValue",
      "stableJson",
      "sha256Json",
      "occurrenceKeyedExchanges",
      "admissionRequestBinding",
      "createTopologyConvergenceCommands",
    ],
  );
});

test("topology consumers and metadata target the typed module", () => {
  for (const consumer of ["scripts/foundry.mjs", "scripts/lib/foundry-command-metadata.ts"]) {
    const source = readRepoFile(consumer);
    assert.match(source, /topology-convergence\.ts/u, consumer);
    assert.doesNotMatch(source, /topology-convergence\.mjs/u, consumer);
  }
  const unitSource = readRepoFile("test/unit/topology-convergence.test.mjs");
  assert.match(unitSource, /topology-convergence\.ts/u);
});

test("topology help report retains exact bytes", () => {
  const output = execFileSync(
    process.execPath,
    ["scripts/foundry.mjs", "dataset-topology-convergence-compose", "--help"],
    { cwd: repoRoot, encoding: "utf8" },
  );
  assert.equal(Buffer.byteLength(output, "utf8"), 3346);
  assert.equal(
    createHash("sha256").update(output).digest("hex"),
    "947a23bc545962008276cf0b24f3e301f3c45787fc311735519139bf651533be",
  );
});

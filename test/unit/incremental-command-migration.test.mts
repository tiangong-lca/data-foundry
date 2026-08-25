import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, "..", "..");
const typedPath = path.join(repoRoot, "scripts/commands/incremental-change-set.ts");
const legacyPath = path.join(repoRoot, "scripts/commands/incremental-change-set.mjs");

function readRepoFile(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

test("incremental command exists only as native TypeScript", () => {
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
      "valueSha256",
      "conversionHashSets",
      "mergeThreeWay",
      "readJsonLinesWithMeta",
      "createIncrementalChangeSetCommands",
    ],
  );
});

test("incremental consumers and metadata target the typed module", () => {
  for (const consumer of ["scripts/foundry.ts", "scripts/lib/foundry-command-metadata.ts"]) {
    const source = readRepoFile(consumer);
    assert.match(source, /incremental-change-set\.ts/u, consumer);
    assert.doesNotMatch(source, /incremental-change-set\.mjs/u, consumer);
  }
  const unitSource = readRepoFile("test/unit/incremental-change-set.test.mjs");
  assert.match(unitSource, /incremental-change-set\.ts/u);
});

test("incremental help report retains exact bytes", () => {
  const output = execFileSync(
    process.execPath,
    ["scripts/foundry.ts", "dataset-incremental-change-set-compose", "--help"],
    { cwd: repoRoot, encoding: "utf8" },
  );
  assert.equal(Buffer.byteLength(output, "utf8"), 3555);
  assert.equal(
    createHash("sha256").update(output).digest("hex"),
    "783e6215a103d7e4c489ebbc54a8bb5384ffbeac1da2a6981da2ce14435045a8",
  );
});

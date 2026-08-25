import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, "..", "..");
const typedPath = path.join(repoRoot, "scripts/commands/bafu-batch-import-run.ts");
const legacyPath = path.join(repoRoot, "scripts/commands/bafu-batch-import-run.mjs");

function readRepoFile(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

const helpContracts = [
  [
    "dataset-bafu-batch-import-run",
    5750,
    "fb1fc712fe3b101e49fe9cbfb2f112eef79babdbf340acc9864a691a7e4c442f",
  ],
  [
    "dataset-bafu-universe-coverage-report",
    686,
    "d2b258d312c6e93f4b609abdc39130c06b3f610ef850d4fa3917e95a7a59492e",
  ],
] as const;

test("BAFU batch owner exists only as zero-escape native TypeScript", async () => {
  assert.equal(fs.existsSync(typedPath), true);
  assert.equal(fs.existsSync(legacyPath), false);
  const source = fs.readFileSync(typedPath, "utf8");
  assert.doesNotMatch(source, /\bas\s+any\b|:\s*any\b|\bany\s*\[\]|<\s*any\b|,\s*any\s*>/u);
  assert.doesNotMatch(source, /@ts-(?:no)?check|@ts-ignore|@ts-expect-error/u);
  const module = (await import(pathToFileURL(typedPath).href)) as Record<string, unknown>;
  assert.deepEqual(Object.keys(module), [
    "bafuBatchImportRunTestHooks",
    "createBafuBatchImportRunCommands",
    "filterAuthoringTaskManifestToRows",
  ]);
});

test("BAFU/USLCI/Worldsteel consumers and metadata target one typed batch owner", () => {
  const entrySource = readRepoFile("scripts/foundry.ts");
  const metadataSource = readRepoFile("scripts/lib/foundry-command-metadata.ts");
  const uslciSource = readRepoFile("scripts/commands/uslci-batch-import-run.ts");
  const worldsteelSource = readRepoFile("scripts/commands/worldsteel-batch-import-run.ts");
  assert.match(entrySource, /from "\.\/commands\/bafu-batch-import-run\.ts"/u);
  assert.doesNotMatch(entrySource, /bafu-batch-import-run\.mjs/u);
  assert.match(metadataSource, /ownerModule: "scripts\/commands\/bafu-batch-import-run\.ts"/u);
  assert.doesNotMatch(metadataSource, /bafu-batch-import-run\.mjs/u);
  assert.match(metadataSource, /test\/commands\/bafu-batch-import-run\.test\.mjs/u);
  for (const source of [uslciSource, worldsteelSource]) {
    assert.match(source, /from "\.\/bafu-batch-import-run\.ts"/u);
    assert.doesNotMatch(source, /bafu-batch-import-run\.mjs/u);
  }
});

test("BAFU batch and coverage help retain exact serialized bytes", () => {
  for (const [command, bytes, sha256] of helpContracts) {
    const result = spawnSync(process.execPath, ["scripts/foundry.ts", command, "--help"], {
      cwd: repoRoot,
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(Buffer.byteLength(result.stdout), bytes, command);
    assert.equal(createHash("sha256").update(result.stdout).digest("hex"), sha256, command);
  }
});

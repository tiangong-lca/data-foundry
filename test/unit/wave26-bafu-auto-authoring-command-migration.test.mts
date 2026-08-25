import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, "..", "..");
const typedPath = path.join(repoRoot, "scripts/commands/bafu-auto-authoring.ts");
const legacyPath = path.join(repoRoot, "scripts/commands/bafu-auto-authoring.mjs");

function readRepoFile(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

const helpContracts = [
  [
    "dataset-bafu-identity-decisions-autofill",
    406,
    "9ce97fe0eff54e564b6180b6515a468ba3cba71e0b184b3fe855ad284a522baa",
  ],
  [
    "dataset-bafu-authoring-patches-autofill",
    422,
    "1d97b21eb4921b6b16d5fdbcad7354c065f1d050301872108fb9f73928e2e233",
  ],
] as const;

test("BAFU auto-authoring owner exists only as zero-escape native TypeScript", async () => {
  assert.equal(fs.existsSync(typedPath), true);
  assert.equal(fs.existsSync(legacyPath), false);
  const source = fs.readFileSync(typedPath, "utf8");
  assert.doesNotMatch(source, /\bas\s+any\b|:\s*any\b|\bany\s*\[\]|<\s*any\b|,\s*any\s*>/u);
  assert.doesNotMatch(source, /@ts-(?:no)?check|@ts-ignore|@ts-expect-error/u);
  const module = (await import(pathToFileURL(typedPath).href)) as Record<string, unknown>;
  assert.deepEqual(Object.keys(module), [
    "bafuAutoAuthoringTestHooks",
    "createBafuAutoAuthoringCommands",
  ]);
});

test("BAFU auto-authoring consumers and metadata target typed local fixtures", () => {
  const entrySource = readRepoFile("scripts/foundry.ts");
  const metadataSource = readRepoFile("scripts/lib/foundry-command-metadata.ts");
  assert.match(entrySource, /from "\.\/commands\/bafu-auto-authoring\.ts"/u);
  assert.doesNotMatch(entrySource, /bafu-auto-authoring\.mjs/u);
  assert.match(metadataSource, /ownerModule: "scripts\/commands\/bafu-auto-authoring\.ts"/u);
  assert.doesNotMatch(metadataSource, /bafu-auto-authoring\.mjs/u);
  assert.match(metadataSource, /test\/commands\/bafu-auto-authoring\.test\.mts/u);
});

test("BAFU auto-authoring help retains exact serialized bytes", () => {
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

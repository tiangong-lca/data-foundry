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
    407,
    "6c9a528cd1250cf1e8c455f4520050074600ace38fb624b00be7d59c6b538a8f",
  ],
  [
    "dataset-bafu-authoring-patches-autofill",
    423,
    "19a6ce0f5626c486a77284d19607eec283fa942108470f2f5a08e37ab0ea5e37",
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
  const entrySource = readRepoFile("scripts/foundry.mjs");
  const metadataSource = readRepoFile("scripts/lib/foundry-command-metadata.ts");
  assert.match(entrySource, /from "\.\/commands\/bafu-auto-authoring\.ts"/u);
  assert.doesNotMatch(entrySource, /bafu-auto-authoring\.mjs/u);
  assert.match(metadataSource, /ownerModule: "scripts\/commands\/bafu-auto-authoring\.ts"/u);
  assert.doesNotMatch(metadataSource, /bafu-auto-authoring\.mjs/u);
  assert.match(metadataSource, /test\/commands\/bafu-auto-authoring\.test\.mjs/u);
});

test("BAFU auto-authoring help retains exact serialized bytes", () => {
  for (const [command, bytes, sha256] of helpContracts) {
    const result = spawnSync(process.execPath, ["scripts/foundry.mjs", command, "--help"], {
      cwd: repoRoot,
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(Buffer.byteLength(result.stdout), bytes, command);
    assert.equal(createHash("sha256").update(result.stdout).digest("hex"), sha256, command);
  }
});

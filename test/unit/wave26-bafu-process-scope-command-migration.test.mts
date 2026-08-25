import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, "..", "..");
const typedPath = path.join(repoRoot, "scripts/commands/bafu-process-scope-e2e.ts");
const legacyPath = path.join(repoRoot, "scripts/commands/bafu-process-scope-e2e.mjs");

function readRepoFile(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

test("BAFU process-scope owner exists only as zero-escape native TypeScript", async () => {
  assert.equal(fs.existsSync(typedPath), true);
  assert.equal(fs.existsSync(legacyPath), false);
  const source = fs.readFileSync(typedPath, "utf8");
  assert.doesNotMatch(source, /\bas\s+any\b|:\s*any\b|\bany\s*\[\]|<\s*any\b|,\s*any\s*>/u);
  assert.doesNotMatch(source, /@ts-(?:no)?check|@ts-ignore|@ts-expect-error/u);
  const module = (await import(pathToFileURL(typedPath).href)) as Record<string, unknown>;
  assert.deepEqual(Object.keys(module), [
    "bafuProcessScopeE2eTestHooks",
    "createBafuProcessScopeE2eCommands",
  ]);
});

test("BAFU process-scope entry and metadata target typed realistic fixtures", () => {
  const entrySource = readRepoFile("scripts/foundry.mjs");
  const metadataSource = readRepoFile("scripts/lib/foundry-command-metadata.ts");
  assert.match(entrySource, /from "\.\/commands\/bafu-process-scope-e2e\.ts"/u);
  assert.doesNotMatch(entrySource, /bafu-process-scope-e2e\.mjs/u);
  assert.match(metadataSource, /ownerModule: "scripts\/commands\/bafu-process-scope-e2e\.ts"/u);
  assert.doesNotMatch(metadataSource, /bafu-process-scope-e2e\.mjs/u);
  assert.match(metadataSource, /test\/commands\/bafu-process-scope-e2e\.test\.mjs/u);
});

test("BAFU process-scope help retains exact serialized bytes", () => {
  const result = spawnSync(
    process.execPath,
    ["scripts/foundry.mjs", "dataset-bafu-process-scope-e2e", "--help"],
    { cwd: repoRoot, encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(Buffer.byteLength(result.stdout), 992);
  assert.equal(
    createHash("sha256").update(result.stdout).digest("hex"),
    "66e2a0a3c368a34aba860d7307f2323a85aa14d4bad6070bd797c252e3f63182",
  );
});

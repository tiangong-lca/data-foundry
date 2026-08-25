import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, "..", "..");
const typedPath = path.join(repoRoot, "scripts/commands/library-scope-workflow.ts");
const legacyPath = path.join(repoRoot, "scripts/commands/library-scope-workflow.mjs");

function readRepoFile(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

const helpContracts = [
  [
    "dataset-library-index-build",
    3650,
    "dfca6ccba490158bf25162098b5fc991e57f76475f46673220ab2421473a9408",
  ],
  [
    "dataset-library-authoring-plan",
    3638,
    "7bb46790b910e58e36e9dab27764cb2a74ef9956b51b30027633611649cd8b11",
  ],
  [
    "dataset-library-identity-decisions-from-preflight",
    3729,
    "f9e597e81354ecfaf3f053e083e5430ac7aa8cb2343477a1ce6a6ee57674ddeb",
  ],
  [
    "dataset-library-decisions-apply",
    3655,
    "3d0dbc3aab91b73c1165f6f15d41ead80899627e08b31eef11b481617cc73f54",
  ],
  [
    "dataset-process-scope-run",
    3879,
    "02356f508f23d9fae4bfe1a420ed7bb25a760a1b5c6197c940f497e77d95d693",
  ],
] as const;

test("library-scope orchestration exists only as native zero-escape TypeScript", async () => {
  assert.equal(fs.existsSync(typedPath), true);
  assert.equal(fs.existsSync(legacyPath), false);
  const source = fs.readFileSync(typedPath, "utf8");
  assert.doesNotMatch(source, /\bas\s+any\b|:\s*any\b|\bany\s*\[\]|<\s*any\b|,\s*any\s*>/u);
  assert.doesNotMatch(source, /@ts-(?:no)?check|@ts-ignore|@ts-expect-error/u);
  const module = (await import(pathToFileURL(typedPath).href)) as Record<string, unknown>;
  assert.deepEqual(Object.keys(module), ["createLibraryScopeWorkflowCommands"]);
});

test("library-scope entry and metadata target the typed semantic owner", () => {
  const entrySource = readRepoFile("scripts/foundry.ts");
  const metadataSource = readRepoFile("scripts/lib/foundry-command-metadata.ts");
  assert.match(entrySource, /from "\.\/commands\/library-scope-workflow\.ts"/u);
  assert.doesNotMatch(entrySource, /library-scope-workflow\.mjs/u);
  assert.match(metadataSource, /ownerModule: "scripts\/commands\/library-scope-workflow\.ts"/u);
  assert.doesNotMatch(metadataSource, /library-scope-workflow\.mjs/u);
  assert.match(metadataSource, /test\/scenarios\/library-scope-workflow\.test\.mts/u);
  assert.match(
    metadataSource,
    /test\/commands\/library-scope-workflow-elementary-identity\.test\.mts/u,
  );
});

test("library-scope help reports retain exact serialized bytes", () => {
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

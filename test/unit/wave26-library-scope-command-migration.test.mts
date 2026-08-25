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
    3651,
    "0c04ecad33546dd354d1ec890d77c235827c71c208c92c475b43ef0eeb3b398f",
  ],
  [
    "dataset-library-authoring-plan",
    3639,
    "78de4ed6925fcf2f6acd31488ea1011429fc8b678a062a0ff79ee8652c2b6205",
  ],
  [
    "dataset-library-identity-decisions-from-preflight",
    3730,
    "69bcfa9119acefc2a72e02af10f76b91d69b34ae9abadfdc51bb071ba51b419e",
  ],
  [
    "dataset-library-decisions-apply",
    3656,
    "511b255464b764ac371af3062bd3bb3310c4a559083c757244dd2c5f09cfb958",
  ],
  [
    "dataset-process-scope-run",
    3881,
    "5b0d517c432bc17d99850e04b9f909514d82a47376ba8079f796351373bccea2",
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
  const entrySource = readRepoFile("scripts/foundry.mjs");
  const metadataSource = readRepoFile("scripts/lib/foundry-command-metadata.ts");
  assert.match(entrySource, /from "\.\/commands\/library-scope-workflow\.ts"/u);
  assert.doesNotMatch(entrySource, /library-scope-workflow\.mjs/u);
  assert.match(metadataSource, /ownerModule: "scripts\/commands\/library-scope-workflow\.ts"/u);
  assert.doesNotMatch(metadataSource, /library-scope-workflow\.mjs/u);
  assert.match(metadataSource, /test\/scenarios\/library-scope-workflow\.test\.mjs/u);
  assert.match(
    metadataSource,
    /test\/commands\/library-scope-workflow-elementary-identity\.test\.mjs/u,
  );
});

test("library-scope help reports retain exact serialized bytes", () => {
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

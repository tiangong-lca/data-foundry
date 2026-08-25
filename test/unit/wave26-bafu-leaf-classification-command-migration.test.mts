import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, "..", "..");
const typedPath = path.join(repoRoot, "scripts/commands/bafu-leaf-classification-tasks.ts");
const legacyPath = path.join(repoRoot, "scripts/commands/bafu-leaf-classification-tasks.mjs");

function readRepoFile(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

const helpContracts = [
  [
    "dataset-bafu-leaf-classification-tasks-prepare",
    489,
    "379e65ae514fa0df3cc3f29a872a1be13ae198b197eaf4e6c78a0e2c8ade43f9",
  ],
  [
    "dataset-bafu-leaf-classification-category-map-project",
    741,
    "2aec46c9e85226488d42f32908f4cfad389d2e6e1d07add726192d08366d9897",
  ],
] as const;

test("BAFU leaf classification owner exists only as zero-escape native TypeScript", async () => {
  assert.equal(fs.existsSync(typedPath), true);
  assert.equal(fs.existsSync(legacyPath), false);
  const source = fs.readFileSync(typedPath, "utf8");
  assert.doesNotMatch(source, /\bas\s+any\b|:\s*any\b|\bany\s*\[\]|<\s*any\b|,\s*any\s*>/u);
  assert.doesNotMatch(source, /@ts-(?:no)?check|@ts-ignore|@ts-expect-error/u);
  const module = (await import(pathToFileURL(typedPath).href)) as Record<string, unknown>;
  assert.deepEqual(Object.keys(module), [
    "createBafuLeafClassificationTaskCommands",
    "prepareBafuLeafClassificationTasks",
    "projectBafuLeafCategoryMapDecisions",
  ]);
});

test("BAFU leaf consumers and metadata target the typed owner and real fixture", () => {
  const entrySource = readRepoFile("scripts/foundry.ts");
  const metadataSource = readRepoFile("scripts/lib/foundry-command-metadata.ts");
  assert.match(entrySource, /from "\.\/commands\/bafu-leaf-classification-tasks\.ts"/u);
  assert.doesNotMatch(entrySource, /bafu-leaf-classification-tasks\.mjs/u);
  assert.match(
    metadataSource,
    /ownerModule: "scripts\/commands\/bafu-leaf-classification-tasks\.ts"/u,
  );
  assert.doesNotMatch(metadataSource, /bafu-leaf-classification-tasks\.mjs/u);
  assert.match(metadataSource, /test\/commands\/bafu-leaf-classification-tasks\.test\.mjs/u);
});

test("BAFU leaf classification help retains exact serialized bytes", () => {
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

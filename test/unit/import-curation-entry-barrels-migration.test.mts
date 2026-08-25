import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as authoringPackagesOwner from "../../scripts/lib/import-curation/authoring-packages.ts";
import * as cleanupOwner from "../../scripts/lib/import-curation/curation-cleanup.ts";
import * as gateOwner from "../../scripts/lib/import-curation/curation-gate.ts";
import * as mutationOwner from "../../scripts/lib/import-curation/mutation-manifest.ts";
import * as patchCollectOwner from "../../scripts/lib/import-curation/patch-collect.ts";
import * as profilesOwner from "../../scripts/lib/import-curation/profiles.ts";
import * as traceOwner from "../../scripts/lib/import-curation/trace-summary.ts";
import { commandMetadata } from "../../scripts/lib/foundry-command-metadata.ts";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, "..", "..");
const exportNames = [
  "foundryTraceSummary",
  "listImportProfiles",
  "profileFor",
  "runDatasetAuthoringPatchCollect",
  "runDatasetAuthoringTaskBuild",
  "runDatasetCurationCleanup",
  "runDatasetCurationGate",
  "runDatasetMutationManifest",
] as const;

type ImportCurationNamespace = Record<(typeof exportNames)[number], unknown>;

async function loadCurrent(relativeStem: string): Promise<ImportCurationNamespace> {
  const typedPath = path.join(repoRoot, `${relativeStem}.ts`);
  const legacyPath = path.join(repoRoot, `${relativeStem}.mjs`);
  return import(
    pathToFileURL(fs.existsSync(typedPath) ? typedPath : legacyPath).href
  ) as Promise<ImportCurationNamespace>;
}

function readRepoFile(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

function assertExactNamespace(module: ImportCurationNamespace): void {
  assert.deepEqual(Object.keys(module), exportNames);
}

function assertSourceOwnerIdentity(module: ImportCurationNamespace): void {
  assert.equal(module.foundryTraceSummary, traceOwner.foundryTraceSummary);
  assert.equal(module.listImportProfiles, profilesOwner.listImportProfiles);
  assert.equal(module.profileFor, profilesOwner.profileFor);
  assert.equal(
    module.runDatasetAuthoringPatchCollect,
    patchCollectOwner.runDatasetAuthoringPatchCollect,
  );
  assert.equal(
    module.runDatasetAuthoringTaskBuild,
    authoringPackagesOwner.runDatasetAuthoringTaskBuild,
  );
  assert.equal(module.runDatasetCurationCleanup, cleanupOwner.runDatasetCurationCleanup);
  assert.equal(module.runDatasetCurationGate, gateOwner.runDatasetCurationGate);
  assert.equal(module.runDatasetMutationManifest, mutationOwner.runDatasetMutationManifest);
}

test("import-curation index and public entry exist atomically only as native TypeScript", () => {
  for (const relativeStem of ["scripts/lib/import-curation/index", "scripts/lib/import-curation"]) {
    const typedPath = path.join(repoRoot, `${relativeStem}.ts`);
    assert.equal(fs.existsSync(typedPath), true, relativeStem);
    assert.equal(fs.existsSync(typedPath.replace(/\.ts$/u, ".mjs")), false, relativeStem);
    const source = fs.readFileSync(typedPath, "utf8");
    assert.doesNotMatch(source, /\bany\b/u, relativeStem);
    assert.doesNotMatch(source, /@ts-(?:ignore|nocheck|expect-error)/u, relativeStem);
  }
});

test("source index and public entry preserve the complete namespace and live references", async () => {
  const indexModule = await loadCurrent("scripts/lib/import-curation/index");
  const entryModule = await loadCurrent("scripts/lib/import-curation");
  assertExactNamespace(indexModule);
  assertExactNamespace(entryModule);
  assertSourceOwnerIdentity(indexModule);
  for (const name of exportNames) assert.equal(entryModule[name], indexModule[name], name);
});

test("entry consumers and command metadata retain the complete owner contract", () => {
  const foundrySource = readRepoFile("scripts/foundry.mjs");
  assert.match(foundrySource, /from "\.\/lib\/import-curation\.ts"/u);
  assert.doesNotMatch(foundrySource, /from "\.\/lib\/import-curation\.mjs"/u);

  const cliSource = readRepoFile("scripts/lib/foundry-cli.mjs");
  for (const name of [
    "listImportProfiles",
    "runDatasetAuthoringPatchCollect",
    "runDatasetAuthoringTaskBuild",
    "runDatasetCurationCleanup",
    "runDatasetCurationGate",
    "runDatasetMutationManifest",
  ]) {
    assert.match(cliSource, new RegExp(`\\b${name}\\b`, "u"), name);
  }

  assert.deepEqual(
    [
      "dataset-authoring-task-build",
      "dataset-authoring-patch-collect",
      "dataset-curation-cleanup",
      "dataset-curation-gate",
      "dataset-mutation-manifest",
    ].map((command) => [
      command,
      commandMetadata[command]?.ownerModule,
      commandMetadata[command]?.ownerExport,
    ]),
    [
      [
        "dataset-authoring-task-build",
        "scripts/lib/import-curation/authoring-packages.ts",
        "runDatasetAuthoringTaskBuild",
      ],
      [
        "dataset-authoring-patch-collect",
        "scripts/lib/import-curation/patch-collect.ts",
        "runDatasetAuthoringPatchCollect",
      ],
      [
        "dataset-curation-cleanup",
        "scripts/lib/import-curation/curation-cleanup.ts",
        "runDatasetCurationCleanup",
      ],
      [
        "dataset-curation-gate",
        "scripts/lib/import-curation/curation-gate.ts",
        "runDatasetCurationGate",
      ],
      [
        "dataset-mutation-manifest",
        "scripts/lib/import-curation/mutation-manifest.ts",
        "runDatasetMutationManifest",
      ],
    ],
  );
});

test("Node 24 loads the emitted entry and index with the same complete live namespace", async () => {
  const buildRoot = path.join(repoRoot, "tmp", `import-curation-entry-build-${process.pid}`);
  fs.rmSync(buildRoot, { recursive: true, force: true });
  try {
    execFileSync(
      process.execPath,
      [
        path.join(repoRoot, "node_modules", "typescript", "bin", "tsc"),
        "-p",
        "tsconfig.build.json",
        "--outDir",
        buildRoot,
        "--sourceMap",
        "false",
        "--inlineSources",
        "false",
      ],
      { cwd: repoRoot, encoding: "utf8", stdio: "pipe" },
    );

    const entryPath = path.join(buildRoot, "scripts", "lib", "import-curation.js");
    const indexPath = path.join(buildRoot, "scripts", "lib", "import-curation", "index.js");
    assert.equal(fs.existsSync(entryPath), true);
    assert.equal(fs.existsSync(indexPath), true);
    const entryModule = (await import(pathToFileURL(entryPath).href)) as ImportCurationNamespace;
    const indexModule = (await import(pathToFileURL(indexPath).href)) as ImportCurationNamespace;
    assertExactNamespace(entryModule);
    assertExactNamespace(indexModule);
    for (const name of exportNames) assert.equal(entryModule[name], indexModule[name], name);
  } finally {
    fs.rmSync(buildRoot, { recursive: true, force: true });
  }
});

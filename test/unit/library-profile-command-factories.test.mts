import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createUslciBatchImportRunCommands } from "../../scripts/commands/uslci-batch-import-run.ts";
import { createWorldsteelBatchImportRunCommands } from "../../scripts/commands/worldsteel-batch-import-run.ts";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, "..", "..");

function readRepoFile(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

function typedPath(profile: "uslci" | "worldsteel"): string {
  return path.join(repoRoot, `scripts/commands/${profile}-batch-import-run.ts`);
}

test("USLCI wrapper delegates once with the exact frozen profile and never invokes the runner", () => {
  assert.equal(fs.existsSync(typedPath("uslci")), true);
  const deps = { marker: "uslci-deps" };
  const runnerCalls: unknown[][] = [];
  const runner = (...args: unknown[]) => runnerCalls.push(args);
  const factoryCalls: Array<{ deps: unknown; config: unknown }> = [];

  const commands = createUslciBatchImportRunCommands(deps, {
    createBafuBatchImportRunCommands(observedDeps, config) {
      factoryCalls.push({ deps: observedDeps, config });
      return { runDatasetBafuBatchImportRun: runner };
    },
  });

  assert.equal(commands.runDatasetUslciBatchImportRun, runner);
  assert.deepEqual(runnerCalls, []);
  assert.deepEqual(factoryCalls, [
    {
      deps,
      config: {
        profile: "uslci",
        commandName: "dataset-uslci-batch-import-run",
        enableBafuAutofill: false,
        enableFamilySignatures: false,
        commitFlowSupportInline: true,
        mintUnmatchedFpUgSupport: true,
        applyResolutionRewrites: true,
        libraryContact: {
          libraryName: "National Renewable Energy Laboratory (NREL)",
          shortName: "NREL",
          website: "https://www.lcacommons.gov",
          email: "lci@nrel.gov",
          telephone: "+1 303-275-3000",
          contactAddress:
            "National Renewable Energy Laboratory, 15013 Denver West Parkway, Golden, CO 80401, USA",
          centralContactPoint:
            "U.S. Federal LCA Commons (https://www.lcacommons.gov); lci@nrel.gov",
          description:
            "Library-level contact for the USLCI Database Public package, published by the National Renewable Energy Laboratory (NREL) on the U.S. Federal LCA Commons.",
        },
      },
    },
  ]);
});

test("worldsteel wrapper delegates once with the exact frozen profile and never invokes the runner", () => {
  assert.equal(fs.existsSync(typedPath("worldsteel")), true);
  const deps = { marker: "worldsteel-deps" };
  const runnerCalls: unknown[][] = [];
  const runner = (...args: unknown[]) => runnerCalls.push(args);
  const factoryCalls: Array<{ deps: unknown; config: unknown }> = [];

  const commands = createWorldsteelBatchImportRunCommands(deps, {
    createBafuBatchImportRunCommands(observedDeps, config) {
      factoryCalls.push({ deps: observedDeps, config });
      return { runDatasetBafuBatchImportRun: runner };
    },
  });

  assert.equal(commands.runDatasetWorldsteelBatchImportRun, runner);
  assert.deepEqual(runnerCalls, []);
  assert.deepEqual(factoryCalls, [
    {
      deps,
      config: {
        profile: "worldsteel",
        commandName: "dataset-worldsteel-batch-import-run",
        enableBafuAutofill: false,
        enableFamilySignatures: false,
        commitFlowSupportInline: true,
        mintUnmatchedFpUgSupport: true,
        applyResolutionRewrites: true,
        libraryContact: {
          libraryName: "World Steel Association",
          shortName: "worldsteel",
          website: "https://www.worldsteel.org",
          email: "steel@worldsteel.org",
          contactClassification: [
            { "@level": "0", "@classId": "2", "#text": "Organisations" },
            { "@level": "1", "@classId": "2.4", "#text": "Other organisations" },
          ],
          contactAddress: "worldsteel, Avenue de Tervueren 270, 1150 Brussels, Belgium",
          telephone: "+32 (0) 2 702 8900",
          centralContactPoint:
            "worldsteel, Avenue de Tervueren 270, 1150 Brussels, Belgium; steel@worldsteel.org; +32 (0) 2 702 8900",
          description:
            "Library-level contact for the worldsteel EF3.1 LCI data package, the World Steel Association (worldsteel) — a non-profit international steel industry association.",
        },
      },
    },
  ]);
});

test("library profile wrappers exist only as zero-any native TypeScript", () => {
  for (const profile of ["uslci", "worldsteel"] as const) {
    const sourcePath = typedPath(profile);
    assert.equal(fs.existsSync(sourcePath), true);
    assert.equal(fs.existsSync(sourcePath.replace(/\.ts$/u, ".mjs")), false);
    const source = fs.readFileSync(sourcePath, "utf8");
    assert.doesNotMatch(source, /\bany\b/u);
    assert.equal([...source.matchAll(/export function\s+([A-Za-z0-9_]+)/gu)].length, 1);
  }
});

test("all active library profile wrapper consumers target native TypeScript", () => {
  const expected = [
    ["uslci-batch-import-run", "createUslciBatchImportRunCommands"],
    ["worldsteel-batch-import-run", "createWorldsteelBatchImportRunCommands"],
  ] as const;
  const consumers = [
    "scripts/foundry.mjs",
    "scripts/lib/foundry-command-metadata.ts",
    "docs/uslci-import-plan.md",
    "docs/import-profiles/worldsteel/profile.md",
    "docs/import-profiles/worldsteel/import-plan.md",
    "test/unit/library-profile-command-factories.test.mts",
  ];
  for (const [moduleName] of expected) {
    for (const consumer of consumers) {
      const source = readRepoFile(consumer);
      if (!source.includes(moduleName)) continue;
      assert.match(source, new RegExp(`${moduleName}\\.ts`, "u"), consumer);
      assert.doesNotMatch(source, new RegExp(`${moduleName}\\.mjs`, "u"), consumer);
    }
  }
  const remoteVerification = readRepoFile("test/unit/remote-verification-accepted-diff.test.mts");
  assert.match(remoteVerification, /worldsteel-batch-import-run\.ts/u);
  assert.doesNotMatch(remoteVerification, /worldsteel-batch-import-run\.mjs/u);
});

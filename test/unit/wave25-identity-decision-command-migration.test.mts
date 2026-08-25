import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { fileURLToPath } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, "..", "..");
const typedPath = path.join(repoRoot, "scripts/commands/identity-decisions.ts");
const legacyPath = path.join(repoRoot, "scripts/commands/identity-decisions.mjs");

type IdentityFactory = (dependencies: never) => {
  runDatasetIdentityDecisionsApply(options: { help: true }): unknown;
};

async function loadFactory(): Promise<IdentityFactory> {
  const implementation = fs.existsSync(typedPath) ? typedPath : legacyPath;
  const module = (await import(pathToFileURL(implementation).href)) as {
    createIdentityDecisionCommands: IdentityFactory;
  };
  return module.createIdentityDecisionCommands;
}

function readRepoFile(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

test("identity decision command exists only as native TypeScript", () => {
  assert.equal(fs.existsSync(typedPath), true);
  assert.equal(fs.existsSync(legacyPath), false);
});

test("identity decision static consumers and metadata target the typed factory", () => {
  for (const consumer of ["scripts/foundry.ts", "scripts/lib/foundry-command-metadata.ts"]) {
    const source = readRepoFile(consumer);
    assert.match(source, /identity-decisions\.ts/u, consumer);
    assert.doesNotMatch(source, /identity-decisions\.mjs/u, consumer);
  }
});

test("identity decision factory retains one zero-escape export", () => {
  const source = readRepoFile("scripts/commands/identity-decisions.ts");
  assert.doesNotMatch(source, /\bany\b/u);
  assert.doesNotMatch(source, /@ts-(?:ignore|nocheck|expect-error)/u);
  assert.deepEqual(
    [...source.matchAll(/export function\s+([A-Za-z0-9_]+)/gu)].map((match) => match[1]),
    ["createIdentityDecisionCommands"],
  );
});

test("identity decision help report retains exact serialized bytes", async () => {
  const createIdentityDecisionCommands = await loadFactory();
  const help = createIdentityDecisionCommands({} as never).runDatasetIdentityDecisionsApply({
    help: true,
  });
  assert.equal(
    `${JSON.stringify(help, null, 2)}\n`,
    `${JSON.stringify(
      {
        schema_version: 1,
        status: "help",
        command: "dataset-identity-decisions-apply",
        usage: [
          "node scripts/foundry.ts dataset-identity-decisions-apply --type flow --rows-file <flows.jsonl> --decisions <identity-decisions.jsonl> --out-dir <apply-dir> --authoring-package-dir <ai-authoring-packages>",
        ],
        purpose:
          "Validate AI-authored identity decisions and deterministically split rows into write candidates and reference-reuse rows before post-authoring finalize.",
      },
      null,
      2,
    )}\n`,
  );
});

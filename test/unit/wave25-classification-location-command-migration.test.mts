import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, "..", "..");

type Options = { help: true };
type DecisionCommands = Record<string, (options: Options) => unknown>;
type DecisionFactory = (dependencies: never) => DecisionCommands;

async function loadFactory(stem: string, exportName: string): Promise<DecisionFactory> {
  const typedPath = path.join(repoRoot, `scripts/commands/${stem}.ts`);
  const legacyPath = path.join(repoRoot, `scripts/commands/${stem}.mjs`);
  const implementation = fs.existsSync(typedPath) ? typedPath : legacyPath;
  const module = (await import(pathToFileURL(implementation).href)) as Record<string, unknown>;
  return module[exportName] as DecisionFactory;
}

function readRepoFile(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

test("classification and location decision factories exist only as native TypeScript", () => {
  for (const stem of ["classification-decisions", "location-decisions"]) {
    assert.equal(fs.existsSync(path.join(repoRoot, `scripts/commands/${stem}.ts`)), true, stem);
    assert.equal(fs.existsSync(path.join(repoRoot, `scripts/commands/${stem}.mjs`)), false, stem);
  }
});

test("decision dispatcher and metadata target both typed factories", () => {
  for (const consumer of [
    "scripts/lib/foundry-cli.mjs",
    "scripts/lib/foundry-command-metadata.ts",
  ]) {
    const source = readRepoFile(consumer);
    for (const stem of ["classification-decisions", "location-decisions"]) {
      assert.match(source, new RegExp(`${stem}\\.ts`, "u"), `${consumer}: ${stem}`);
      assert.doesNotMatch(source, new RegExp(`${stem}\\.mjs`, "u"), `${consumer}: ${stem}`);
    }
  }
});

test("both decision factories retain their exact zero-escape export identity", () => {
  const expected = {
    "classification-decisions": "createClassificationDecisionCommands",
    "location-decisions": "createLocationDecisionCommands",
  } as const;
  for (const [stem, exportName] of Object.entries(expected)) {
    const source = readRepoFile(`scripts/commands/${stem}.ts`);
    assert.doesNotMatch(source, /\bany\b/u, stem);
    assert.doesNotMatch(source, /@ts-(?:ignore|nocheck|expect-error)/u, stem);
    assert.deepEqual(
      [...source.matchAll(/export function\s+([A-Za-z0-9_]+)/gu)].map((match) => match[1]),
      [exportName],
      stem,
    );
  }
});

test("classification and location help reports retain exact serialized bytes", async () => {
  const createClassification = await loadFactory(
    "classification-decisions",
    "createClassificationDecisionCommands",
  );
  const createLocation = await loadFactory("location-decisions", "createLocationDecisionCommands");
  const classification = createClassification({} as never);
  const location = createLocation({} as never);
  const reports = [
    classification.runDatasetClassificationDecisionTaskBuild({ help: true }),
    classification.runDatasetLibraryClassificationDecisionsProject({ help: true }),
    classification.runDatasetClassificationDecisionsApply({ help: true }),
    location.runDatasetLocationDecisionTaskBuild({ help: true }),
    location.runDatasetLocationDecisionsSuggest({ help: true }),
    location.runDatasetLocationDecisionsApply({ help: true }),
  ];
  assert.equal(
    `${JSON.stringify(reports, null, 2)}\n`,
    `${JSON.stringify(
      [
        {
          schema_version: 1,
          status: "help",
          command: "dataset-classification-decision-task-build",
          usage: [
            "node scripts/foundry.mjs dataset-classification-decision-task-build --classification-queue <classification-authoring-queue.jsonl> --rows-file <current-rows.jsonl> --schema-file <schema.json> --yaml-file <methodology.yaml> --ruleset-file <runtime-ruleset.json> --classification-schema <tidas_*_category.json> --location-schema <tidas_locations_category.json> --out-dir <task-dir> [--shared-context-cache-dir <cache-dir>]",
          ],
          purpose:
            "Build an AI-facing classification decision task from Foundry classification queue rows. AI fills TIDAS category codes; deterministic apply is handled by dataset-classification-decisions-apply.",
        },
        {
          schema_version: 1,
          status: "help",
          command: "dataset-library-classification-decisions-project",
          usage: [
            "node scripts/foundry.mjs dataset-library-classification-decisions-project --classification-queue <classification-authoring-queue.jsonl> --library-decisions <run-dir>/decisions/classification-decisions.jsonl --decision-task <classification-decision-task.json> --out-dir <projection-dir>",
          ],
          purpose:
            "Project library-level semantic classification decisions into a scope-local decision file bound to an exact classification decision task before deterministic apply.",
        },
        {
          schema_version: 1,
          status: "help",
          command: "dataset-classification-decisions-apply",
          wraps: "tiangong-lca dataset classification apply",
          usage: [
            "node scripts/foundry.mjs dataset-classification-decisions-apply --classification-queue <classification-authoring-queue.jsonl> --decisions <classification-decisions.jsonl> --decision-task <classification-decision-task.json> --out-dir <apply-dir>",
          ],
          purpose:
            "Validate AI-authored classification decisions against the Foundry queue and AI context task, then call the CLI classification apply command for each required schema type and row file.",
        },
        {
          schema_version: 1,
          status: "help",
          command: "dataset-location-decision-task-build",
          usage: [
            "node scripts/foundry.mjs dataset-location-decision-task-build --location-queue <location-authoring-queue.jsonl> --rows-file <current-rows.jsonl> --schema-file <schema.json> --yaml-file <methodology.yaml> --ruleset-file <runtime-ruleset.json> --classification-schema <tidas_*_category.json> --location-schema <tidas_locations_category.json> --out-dir <task-dir> [--shared-context-cache-dir <cache-dir>]",
          ],
          purpose:
            "Build an AI-facing location coding task from Foundry location queue rows. AI fills TIDAS location codes; deterministic apply is handled by dataset-location-decisions-apply.",
        },
        {
          schema_version: 1,
          status: "help",
          command: "dataset-location-decisions-suggest",
          usage: [
            "node scripts/foundry.mjs dataset-location-decisions-suggest --location-queue <location-authoring-queue.jsonl> --decision-task <location-decision-task.json> --location-schema <tidas_locations_category.json> --out-dir <decisions-dir>",
          ],
          purpose:
            "Generate completed location decisions only for queue rows that already contain one provable TIDAS location code candidate, binding each decision to the exact location decision task context bundle.",
        },
        {
          schema_version: 1,
          status: "help",
          command: "dataset-location-decisions-apply",
          wraps: "tiangong-lca dataset classification apply --type location",
          usage: [
            "node scripts/foundry.mjs dataset-location-decisions-apply --location-queue <location-authoring-queue.jsonl> --decisions <location-decisions.jsonl> --decision-task <location-decision-task.json> --out-dir <apply-dir>",
          ],
          purpose:
            "Validate AI-authored location decisions against the Foundry queue and AI context task, then call the CLI location classification apply command for each required row file.",
        },
      ],
      null,
      2,
    )}\n`,
  );
});

import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { profileFor } from "../../scripts/lib/import-curation/internal/profiles-config.ts";
import { prewriteContentQualityBlockers } from "../../scripts/lib/import-curation/internal/workflow-identity-preflight.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function processPayload(baseName: string) {
  return {
    processDataSet: {
      processInformation: {
        dataSetInformation: {
          name: { baseName: { "@xml:lang": "en", "#text": baseName } },
        },
      },
    },
  };
}

function flowPayload(baseName: string) {
  return {
    flowDataSet: {
      flowInformation: {
        dataSetInformation: {
          name: { baseName: { "@xml:lang": "en", "#text": baseName } },
        },
      },
    },
  };
}

const codesFor = (blockers: Array<Record<string, unknown>>): unknown[] =>
  blockers.map((blocker) => blocker.code);

// The prewrite-content-policy `source_locator_in_dataset_name` rule (latin-author-year marker)
// flags "<Word> <YYYY>" — a false positive for worldsteel process names like
// "Steel rebar Global 2022" (product + geography + data-year). The worldsteel profile waives
// it ONLY for process names; BAFU/USLCI and worldsteel flows/lifecyclemodels stay enforced.
test("worldsteel profile waives source_locator_in_dataset_name for process names", () => {
  const ws = profileFor(repoRoot, "worldsteel", {});
  const blockers = prewriteContentQualityBlockers({
    repoRoot,
    payload: processPayload("Steel rebar Global 2022"),
    datasetType: "process",
    profile: ws as unknown as Record<string, unknown>,
  });
  assert.equal(codesFor(blockers).includes("source_locator_in_dataset_name"), false);
});

test("no profile (baseline) still blocks the source-locator name", () => {
  const blockers = prewriteContentQualityBlockers({
    repoRoot,
    payload: processPayload("Steel rebar Global 2022"),
    datasetType: "process",
  });
  assert.equal(codesFor(blockers).includes("source_locator_in_dataset_name"), true);
});

test("BAFU profile still enforces the source-locator rule (no leak)", () => {
  const bafu = profileFor(repoRoot, "bafu", {});
  const blockers = prewriteContentQualityBlockers({
    repoRoot,
    payload: processPayload("Steel rebar Global 2022"),
    datasetType: "process",
    profile: bafu as unknown as Record<string, unknown>,
  });
  assert.equal(codesFor(blockers).includes("source_locator_in_dataset_name"), true);
});

test("worldsteel waiver is scoped to process type — flows still enforce citations", () => {
  const ws = profileFor(repoRoot, "worldsteel", {});
  const blockers = prewriteContentQualityBlockers({
    repoRoot,
    payload: flowPayload("Emissions per Smith et al. 2019"),
    datasetType: "flow",
    profile: ws as unknown as Record<string, unknown>,
  });
  assert.equal(codesFor(blockers).includes("source_locator_in_dataset_name"), true);
});

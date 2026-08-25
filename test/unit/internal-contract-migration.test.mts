import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import * as artifactInputs from "../../scripts/lib/import-curation/internal/artifact-inputs.ts";
import * as contextInputs from "../../scripts/lib/import-curation/internal/context-inputs.ts";
import * as datasetPayload from "../../scripts/lib/import-curation/internal/dataset-payload.ts";
import * as traceSummary from "../../scripts/lib/import-curation/internal/trace-summary.ts";

const repoRoot = path.resolve(import.meta.dirname, "..", "..");

test("four internal contracts preserve their complete export surfaces", () => {
  assert.deepEqual(Object.keys(artifactInputs).sort(), [
    "entityIdFromFinding",
    "idFromArtifactFile",
    "qaFindingCode",
    "qaFindingCurationAction",
    "qaFindingInstruction",
    "qaFindingPath",
    "qaFindingPathDefaults",
    "readJsonLinesIfExists",
    "readQaFindings",
    "resolveArtifactPath",
  ]);
  assert.deepEqual(Object.keys(datasetPayload).sort(), [
    "curationEntityId",
    "dataSetInformation",
    "datasetIdentity",
    "datasetRoot",
    "detectDatasetType",
    "detectSupportDatasetType",
    "identityFreshnessIdentityKey",
    "identityKey",
    "mapRowsByIdentity",
    "unwrapDatasetPayload",
  ]);
  assert.deepEqual(Object.keys(traceSummary).sort(), [
    "collectCommonOtherTraceEntries",
    "compactFoundryTraceEntry",
    "foundryTraceSummary",
    "traceSummaryCount",
  ]);
  assert.deepEqual(Object.keys(contextInputs).sort(), [
    "bundledCategorySchemaFileNames",
    "collectBundledSchemaContextFiles",
    "collectContextDirFiles",
    "collectExplicitContextFiles",
    "contextFileDetails",
    "contextHasFilePattern",
    "firstTidasSchemaDir",
    "fullContextAiCompletionRequirement",
    "fullContextGateItems",
    "loadTidasSchema",
    "normalizeFullContextAiCompletion",
    "readContextFiles",
    "tidasSchemaPath",
    "tidasSchemaSearchRoots",
  ]);
});

test("four internal contracts are native TypeScript with updated static consumers", () => {
  for (const stem of ["artifact-inputs", "context-inputs", "dataset-payload", "trace-summary"]) {
    const typedPath = path.join(repoRoot, `scripts/lib/import-curation/internal/${stem}.ts`);
    assert.equal(fs.existsSync(typedPath), true, `${stem}.ts must exist`);
    assert.equal(fs.existsSync(typedPath.replace(/\.ts$/u, ".mjs")), false);
  }
  const expectedConsumers = [
    ["scripts/lib/import-curation/internal/curation-gate-workflow.ts", "./artifact-inputs.ts"],
    ["scripts/lib/import-curation/internal/prewrite-cleanup.ts", "./dataset-payload.ts"],
    ["scripts/lib/import-curation/internal/workflow-reference-closure.mjs", "./trace-summary.ts"],
    ["scripts/lib/import-curation/internal/full-context-proof.ts", "./context-inputs.ts"],
    [
      "test/scenarios/library-scope-workflow.test.mjs",
      "../../scripts/lib/import-curation/internal/context-inputs.ts",
    ],
  ] as const;
  for (const [consumer, specifier] of expectedConsumers) {
    assert.match(
      fs.readFileSync(path.join(repoRoot, consumer), "utf8"),
      new RegExp(`from ["']${specifier.replaceAll(".", "\\.")}["']`, "u"),
    );
  }
});

import assert from "node:assert/strict";
import test from "node:test";
import * as patchFacade from "../../scripts/lib/import-curation/internal/authoring-patch-workflow.ts";
import * as taskFacade from "../../scripts/lib/import-curation/internal/authoring-task-workflow.ts";
import * as authoringTasks from "../../scripts/lib/import-curation/internal/workflow-authoring-tasks.ts";
import * as patchCollect from "../../scripts/lib/import-curation/internal/workflow-patch-collect.ts";
import * as semanticActions from "../../scripts/lib/import-curation/internal/workflow-semantic-actions.ts";

test("authoring task facade preserves its exact namespace and live references", () => {
  assert.deepEqual(Object.keys(taskFacade), [
    "authoringPackageEntriesFromGate",
    "buildDatasetAuthoringTaskFromPackage",
    "writeAuthoringTaskBatchManifest",
  ]);
  assert.equal(
    taskFacade.authoringPackageEntriesFromGate,
    authoringTasks.authoringPackageEntriesFromGate,
  );
  assert.equal(
    taskFacade.buildDatasetAuthoringTaskFromPackage,
    authoringTasks.buildDatasetAuthoringTaskFromPackage,
  );
  assert.equal(
    taskFacade.writeAuthoringTaskBatchManifest,
    authoringTasks.writeAuthoringTaskBatchManifest,
  );
});

test("authoring patch facade preserves its exact namespace and live references", () => {
  assert.deepEqual(Object.keys(patchFacade), [
    "authoringTaskFullContextReadinessBlockers",
    "patchPayloadPatchSets",
    "patchSetOperations",
    "sharedContextBundleReadinessBlockers",
    "validateCollectedPatchSet",
  ]);
  assert.equal(
    patchFacade.authoringTaskFullContextReadinessBlockers,
    authoringTasks.authoringTaskFullContextReadinessBlockers,
  );
  assert.equal(patchFacade.patchPayloadPatchSets, authoringTasks.patchPayloadPatchSets);
  assert.equal(patchFacade.patchSetOperations, authoringTasks.patchSetOperations);
  assert.equal(
    patchFacade.sharedContextBundleReadinessBlockers,
    semanticActions.sharedContextBundleReadinessBlockers,
  );
  assert.equal(patchFacade.validateCollectedPatchSet, patchCollect.validateCollectedPatchSet);
});

test("facade references retain representative alias and fail-closed behavior", () => {
  const operations = [{ op: "replace", path: "/field" }];
  assert.equal(patchFacade.patchSetOperations({ patches: operations }), operations);
  assert.deepEqual(patchFacade.patchPayloadPatchSets({ patchSets: [{ id: "one" }] }), [
    { id: "one" },
  ]);
  assert.deepEqual(
    patchFacade.authoringTaskFullContextReadinessBlockers({
      repoRoot: "/unused",
      task: { action_items: [] },
    }),
    [],
  );
});

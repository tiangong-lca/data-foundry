import assert from "node:assert/strict";
import test from "node:test";
import * as facadeModule from "../../scripts/lib/import-curation/internal/curation-gate-workflow.mjs";
import * as artifactInputs from "../../scripts/lib/import-curation/internal/artifact-inputs.ts";
import * as contextInputs from "../../scripts/lib/import-curation/internal/context-inputs.ts";
import * as datasetPayload from "../../scripts/lib/import-curation/internal/dataset-payload.ts";
import * as datasetTypes from "../../scripts/lib/import-curation/internal/dataset-types.ts";
import * as hashUtils from "../../scripts/lib/import-curation/internal/hash-utils.ts";
import * as profilesConfig from "../../scripts/lib/import-curation/internal/profiles-config.ts";
import * as runtimeIo from "../../scripts/lib/import-curation/internal/runtime-io.ts";
import * as decisionApply from "../../scripts/lib/import-curation/internal/workflow-decision-apply-context.ts";
import * as identityDecision from "../../scripts/lib/import-curation/internal/workflow-identity-decision-context.ts";
import * as identityPreflight from "../../scripts/lib/import-curation/internal/workflow-identity-preflight.ts";
import * as patchCollect from "../../scripts/lib/import-curation/internal/workflow-patch-collect.ts";
import * as queueContext from "../../scripts/lib/import-curation/internal/workflow-queue-context.ts";
import * as rowTransform from "../../scripts/lib/import-curation/internal/workflow-row-transform-context.ts";
import * as semanticActions from "../../scripts/lib/import-curation/internal/workflow-semantic-actions.ts";

type ModuleNamespace = Record<string, unknown>;

const facade = facadeModule as unknown as ModuleNamespace;
const ownerBindings: Array<readonly [ModuleNamespace, readonly string[]]> = [
  [
    artifactInputs,
    ["entityIdFromFinding", "qaFindingCode", "qaFindingCurationAction", "readQaFindings"],
  ],
  [
    contextInputs,
    [
      "collectBundledSchemaContextFiles",
      "collectContextDirFiles",
      "collectExplicitContextFiles",
      "contextFileDetails",
      "fullContextAiCompletionRequirement",
      "fullContextGateItems",
      "readContextFiles",
    ],
  ],
  [datasetPayload, ["datasetIdentity", "identityKey", "mapRowsByIdentity"]],
  [datasetTypes, ["datasetTypeFromOptions", "datasetTypePlural"]],
  [hashUtils, ["sha256Text"]],
  [profilesConfig, ["profileFor"]],
  [
    runtimeIo,
    [
      "ensureArray",
      "fileExists",
      "jsonLines",
      "nowIso",
      "readJson",
      "readRows",
      "readText",
      "repoRelativePath",
      "resolveRepoPath",
      "sanitizeFileName",
      "writeJson",
      "writeText",
    ],
  ],
  [decisionApply, ["readClassificationDecisionApplyContext"]],
  [
    identityDecision,
    [
      "identityDecisionApplyContextDecisionsForIdentity",
      "readIdentityDecisionApplyContexts",
      "readIdentityReferenceRewriteContext",
    ],
  ],
  [
    identityPreflight,
    [
      "buildIdentityPreflightAuthoringContext",
      "classificationQueueActionItem",
      "classificationQueueRowStillNeedsAuthoring",
      "identityPreflightAuthoringActionItems",
      "identityPreflightGateItems",
      "locationQueueActionItem",
      "locationQueueRowStillNeedsAuthoring",
      "readIdentityPreflightContext",
    ],
  ],
  [
    patchCollect,
    ["identityDecisionApplyReportOptionValues", "readJsonArtifactsIfOption", "readJsonIfOption"],
  ],
  [
    queueContext,
    [
      "authoringQueueRowsForIdentity",
      "buildQueueAuthoringContext",
      "readAuthoringQueueContext",
      "readCurationQueueContext",
      "schemaIssueCurationAction",
    ],
  ],
  [
    rowTransform,
    [
      "readCanonicalSupportRewriteContext",
      "readCleanupTransformContext",
      "readSourceContactRewriteContext",
      "readUnresolvedExchangeExternalizationContext",
      "unresolvedExchangeExternalizationRowsForIdentity",
    ],
  ],
  [semanticActions, ["collectProfileSemanticActionItems"]],
];

test("curation gate workflow facade preserves its exact live export closure", () => {
  const expectedNames = ownerBindings.flatMap(([, names]) => names).sort();
  assert.deepEqual(Object.keys(facade), expectedNames);
  for (const [owner, names] of ownerBindings) {
    for (const name of names) {
      assert.strictEqual(facade[name], owner[name], `${name} must remain a live owner reference`);
    }
  }
});

test("facade references retain representative ordering and fail-closed behavior", () => {
  assert.deepEqual(
    (facade.collectExplicitContextFiles as typeof contextInputs.collectExplicitContextFiles)({
      contractContext: "contract.json",
      schemaFile: "schema.json",
      yamlFile: "methodology.yaml",
      rulesetFile: "runtime-ruleset.json",
      contractFile: "contract.md",
    }),
    [
      ["contract_context", "contract.json"],
      ["schema", "schema.json"],
      ["methodology_yaml", "methodology.yaml"],
      ["ruleset", "runtime-ruleset.json"],
      ["contract", "contract.md"],
    ],
  );
  assert.throws(
    () =>
      (facade.datasetTypeFromOptions as typeof datasetTypes.datasetTypeFromOptions)({
        type: "unsupported",
      }),
    /Unsupported dataset type: unsupported/u,
  );
});

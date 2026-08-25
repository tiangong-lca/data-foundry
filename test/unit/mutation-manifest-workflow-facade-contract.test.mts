import assert from "node:assert/strict";
import test from "node:test";
import * as facadeModule from "../../scripts/lib/import-curation/internal/mutation-manifest-workflow.mjs";
import * as contextInputs from "../../scripts/lib/import-curation/internal/context-inputs.ts";
import * as datasetPayload from "../../scripts/lib/import-curation/internal/dataset-payload.ts";
import * as datasetTypes from "../../scripts/lib/import-curation/internal/dataset-types.ts";
import * as profilesConfig from "../../scripts/lib/import-curation/internal/profiles-config.ts";
import * as runtimeIo from "../../scripts/lib/import-curation/internal/runtime-io.ts";
import * as decisionApply from "../../scripts/lib/import-curation/internal/workflow-decision-apply-context.ts";
import * as decisionFullContext from "../../scripts/lib/import-curation/internal/workflow-decision-full-context.ts";
import * as dryRunContext from "../../scripts/lib/import-curation/internal/workflow-dry-run-context.ts";
import * as evidenceScope from "../../scripts/lib/import-curation/internal/workflow-evidence-scope.ts";
import * as identityDecision from "../../scripts/lib/import-curation/internal/workflow-identity-decision-context.ts";
import * as patchCollect from "../../scripts/lib/import-curation/internal/workflow-patch-collect.ts";
import * as patchEvidence from "../../scripts/lib/import-curation/internal/workflow-patch-evidence-context.ts";
import * as referenceClosure from "../../scripts/lib/import-curation/internal/workflow-reference-closure.ts";
import * as rowTransform from "../../scripts/lib/import-curation/internal/workflow-row-transform-context.ts";
import * as sourceReference from "../../scripts/lib/import-curation/internal/workflow-source-reference-context.ts";

type ModuleNamespace = Record<string, unknown>;

const facade = facadeModule as unknown as ModuleNamespace;
const ownerBindings: Array<readonly [ModuleNamespace, readonly string[]]> = [
  [contextInputs, ["fullContextAiCompletionRequirement"]],
  [datasetPayload, ["identityKey", "mapRowsByIdentity"]],
  [datasetTypes, ["datasetTypeFromOptions", "datasetTypePlural", "supportDatasetTypes"]],
  [profilesConfig, ["profileFor"]],
  [
    runtimeIo,
    [
      "asText",
      "ensureArray",
      "fileExists",
      "jsonLines",
      "nowIso",
      "readRows",
      "repoRelativePath",
      "resolveRepoPath",
      "writeJson",
      "writeJsonLines",
      "writeText",
    ],
  ],
  [decisionApply, ["readClassificationDecisionApplyContext"]],
  [
    decisionFullContext,
    [
      "decisionApplyContextRelevantToRowsFile",
      "decisionTaskContextBundleHashesFromContext",
      "readLocationDecisionApplyContext",
    ],
  ],
  [
    dryRunContext,
    [
      "mapCurationEntities",
      "mapSchemaRows",
      "readDatasetSaveDraftDryRunArtifacts",
      "readFlowDryRunArtifacts",
      "readLifecyclemodelDryRunArtifacts",
      "readProcessDryRunArtifacts",
      "remoteVerifyBlockerKeys",
    ],
  ],
  [evidenceScope, ["buildEvidenceScopeBlockers", "evidenceScopeBlocker"]],
  [
    identityDecision,
    [
      "identityDecisionUnresolvedReferenceKeys",
      "readIdentityDecisionApplyContexts",
      "readIdentityReferenceRewriteContext",
    ],
  ],
  [
    patchCollect,
    [
      "identityDecisionApplyReportOptionValues",
      "readFileArtifactIfOption",
      "readJsonArtifactsIfOption",
      "readJsonIfOption",
      "readRowsIfExists",
    ],
  ],
  [patchEvidence, ["readPatchApplyContext", "readPolicySnapshots"]],
  [
    referenceClosure,
    [
      "buildFullContextAiCompletionBlockers",
      "buildReferenceClosureBlockers",
      "buildReferenceReuseItems",
      "buildWriteCandidateItem",
      "decisionCounts",
      "identityReferenceRewriteProofKeys",
      "operationCounts",
      "plannedRootReferenceIds",
      "plannedRootReferenceKeys",
      "referenceKey",
      "sourceContactRewriteSemanticEvidenceCount",
    ],
  ],
  [
    rowTransform,
    [
      "readCanonicalSupportRewriteContext",
      "readCleanupTransformContext",
      "readSourceContactRewriteContext",
      "readUnresolvedExchangeExternalizationContext",
    ],
  ],
  [
    sourceReference,
    [
      "publicCanonicalSourceReferenceKeys",
      "readSourceReferenceRewriteContext",
      "sourceContactSupportCanonicalUnitGroupProofKeys",
      "sourceContactSupportTrueSourceProofKeys",
      "sourceReferenceRewriteProofKeys",
    ],
  ],
];

test("mutation workflow facade preserves its exact live owner closure", () => {
  const expectedNames = ownerBindings.flatMap(([, names]) => names).sort();
  assert.deepEqual(Object.keys(facade), expectedNames);
  for (const [owner, names] of ownerBindings) {
    for (const name of names) {
      assert.strictEqual(facade[name], owner[name], `${name} must remain a live owner reference`);
    }
  }
});

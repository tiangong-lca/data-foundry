import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  buildClassificationDecisionIndex,
  preflightPlanRows,
  scopeClassificationPreflight,
  scopeClassificationRequirements,
  scopeEstimatedWeight,
  scopeKey,
  selectScopesForRun,
  selectionOrderOption,
  type JsonRecord,
  type ScopeFamilySignature,
  type ScopeSelectionInput,
  type ScopeSelectionResult,
} from "../../scripts/lib/batch-orchestration/scope-selection.ts";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, "..", "..");
const modulePath = path.join(
  repoRoot,
  "scripts",
  "lib",
  "batch-orchestration",
  "scope-selection.ts",
);

const version = "00.00.001";

function scope(
  id: string,
  {
    weight,
    flows = [],
    closureStatus = "ready",
  }: {
    weight?: number;
    flows?: JsonRecord[];
    closureStatus?: string;
  } = {},
): JsonRecord {
  return {
    schema_version: 1,
    process_id: id,
    process_version: version,
    closure_status: closureStatus,
    ...(weight == null ? {} : { estimated_weight: weight }),
    ...(flows.length === 0 ? {} : { dependency_ids: { flows } }),
  };
}

function leafDecision(
  datasetType: "process" | "flow",
  datasetId: string,
  categoryType: "process" | "flow-product",
): JsonRecord {
  return {
    dataset_type: datasetType,
    dataset_id: datasetId,
    dataset_version: version,
    category_type: categoryType,
    decision_status: "completed",
    classification_decision_level: "leaf",
    selected_code: datasetType === "process" ? "35101" : "17100",
  };
}

function familySignature({
  id,
  group,
  role,
  kind = "same_skeleton",
}: {
  id: string;
  group: string;
  role: ScopeFamilySignature["optimization_role"];
  kind?: ScopeFamilySignature["optimization_kind"];
}): ScopeFamilySignature {
  return {
    family_group_key: group,
    optimization_kind: kind,
    optimization_role: role,
    master_process_id: id,
    family_group_size: 2,
    family_hash: `family-${group}`,
    exchange_skeleton_hash: `skeleton-${group}`,
    exchange_amount_vector_hash: `amount-${group}`,
  };
}

function select(
  overrides: Partial<ScopeSelectionInput> & Pick<ScopeSelectionInput, "allScopes">,
): ScopeSelectionResult {
  return selectScopesForRun({
    requestedProcessIds: new Set(),
    verifiedScopes: new Set(),
    blockedScopes: new Set(),
    pendingOnly: false,
    force: false,
    selectionOrder: "input",
    limit: null,
    familySignaturesByScopeKey: new Map(),
    classificationDecisionIndex: buildClassificationDecisionIndex([]),
    requireLeafClassification: false,
    ...overrides,
  });
}

test("scope-selection is a pure typed module with no owner runtime or I/O dependencies", () => {
  const source = fs.readFileSync(modulePath, "utf8");
  assert.doesNotMatch(source, /node:(?:fs|process|child_process)|\bprocess\.|\bspawn\b|\benv\b/u);
  assert.doesNotMatch(source, /^let\s+/mu);
  assert.doesNotMatch(source, /install\w*Runtime|moduleRuntime|runtime\(\)/u);
});

test("pending-only filters verified and active-blocked scopes before ordering and limit", () => {
  const verifiedId = "process-verified";
  const blockedId = "process-blocked";
  const pendingLightId = "process-pending-light";
  const pendingHeavyId = "process-pending-heavy";
  const result = select({
    allScopes: [
      scope(verifiedId, { weight: 1 }),
      scope(blockedId, { weight: 2 }),
      scope(pendingHeavyId, { weight: 20 }),
      scope(pendingLightId, { weight: 10 }),
    ],
    verifiedScopes: new Set([`${verifiedId}@${version}`]),
    blockedScopes: new Set([`${blockedId}@${version}`]),
    pendingOnly: true,
    selectionOrder: "estimated-weight-asc",
    limit: 1,
  });

  assert.deepEqual(result.scopes, [scope(pendingLightId, { weight: 10 })]);
  assert.deepEqual(result.stats, {
    input_scopes: 4,
    matched_scopes: 4,
    filtered_already_verified: 1,
    filtered_already_blocked: 1,
    filtered_classification_missing: 0,
    filtered_classification_not_leaf: 0,
    candidate_scopes_before_limit: 2,
    selected_scopes: 1,
  });
});

test("an explicit process id retries an active-blocked scope but not a verified scope without force", () => {
  const verifiedId = "process-verified";
  const blockedId = "process-blocked";
  const allScopes = [scope(verifiedId), scope(blockedId)];
  const ledgers = {
    verifiedScopes: new Set([`${verifiedId}@${version}`]),
    blockedScopes: new Set([`${blockedId}@${version}`]),
    pendingOnly: true,
  } as const;

  const blockedRetry = select({
    allScopes,
    ...ledgers,
    requestedProcessIds: new Set([blockedId]),
  });
  assert.deepEqual(
    blockedRetry.scopes.map((row) => row.process_id),
    [blockedId],
  );
  assert.equal(blockedRetry.stats.filtered_already_blocked, 0);

  const verifiedRetry = select({
    allScopes,
    ...ledgers,
    requestedProcessIds: new Set([verifiedId]),
  });
  assert.deepEqual(verifiedRetry.scopes, []);
  assert.equal(verifiedRetry.stats.filtered_already_verified, 1);

  const forcedVerifiedRetry = select({
    allScopes,
    ...ledgers,
    requestedProcessIds: new Set([verifiedId]),
    force: true,
  });
  assert.deepEqual(
    forcedVerifiedRetry.scopes.map((row) => row.process_id),
    [verifiedId],
  );
});

test("estimated weight preserves precedence, ties, and unknown-last ordering", () => {
  const scopes = [
    scope("direct", { weight: 5 }),
    {
      ...scope("checkpoint"),
      checkpoint: { estimatedWeight: 2 },
    },
    {
      ...scope("derived-first"),
      dependency_counts: { flows: 2, support_rows: 1, processes: 1 },
    },
    {
      ...scope("derived-tie"),
      dependency_counts: { flow_count: 1, support: 2, process_count: 1 },
    },
    scope("unknown"),
  ];

  assert.deepEqual(scopes.map(scopeEstimatedWeight), [5, 2, 4, 4, 1]);
  const unknownScope = {
    ...scope("actually-unknown"),
    dependency_counts: {},
    checkpoint: {},
  };
  delete unknownScope.dependency_counts;
  assert.equal(scopeEstimatedWeight(unknownScope), 1);

  const noCounts = { process_id: "no-counts", process_version: version };
  assert.equal(scopeEstimatedWeight(noCounts), 1);

  const invalidCounts = {
    process_id: "invalid-counts",
    process_version: version,
    dependency_counts: { processes: "not-a-number" },
  };
  assert.equal(scopeEstimatedWeight(invalidCounts), null);

  const ordered = select({
    allScopes: [...scopes, invalidCounts],
    selectionOrder: "estimated-weight-asc",
  });
  assert.deepEqual(
    ordered.scopes.map((row) => row.process_id),
    ["checkpoint", "derived-first", "derived-tie", "direct", "unknown", "invalid-counts"],
  );
  assert.equal(selectionOrderOption("weight-desc"), "estimated-weight-desc");
  assert.throws(() => selectionOrderOption("random"), /Unsupported --selection-order "random"/u);
});

test("family-master ordering ranks masters before standard, variants, and unknown scopes", () => {
  const ids = ["variant", "standard", "skeleton-master", "unknown", "amount-master"];
  const byScope = new Map<string, ScopeFamilySignature>([
    [
      `${ids[0]}@${version}`,
      familySignature({ id: "amount-master", group: "a", role: "same_amount_variant" }),
    ],
    [
      `${ids[1]}@${version}`,
      familySignature({ id: ids[1], group: "z", role: "standard", kind: "standard" }),
    ],
    [
      `${ids[2]}@${version}`,
      familySignature({ id: ids[2], group: "b", role: "same_skeleton_master" }),
    ],
    [
      `${ids[4]}@${version}`,
      familySignature({
        id: ids[4],
        group: "a",
        role: "same_amount_master",
        kind: "same_amount_vector",
      }),
    ],
  ]);

  const result = select({
    allScopes: ids.map((id) => scope(id)),
    familySignaturesByScopeKey: byScope,
    selectionOrder: "family-master-first",
  });
  assert.deepEqual(
    result.scopes.map((row) => row.process_id),
    ["amount-master", "skeleton-master", "standard", "variant", "unknown"],
  );
});

test("classification requirements and preflight preserve process-first product-flow order and counts", () => {
  const processId = "process-classification";
  const broadFlowId = "flow-broad";
  const missingFlowId = "flow-missing";
  const elementaryFlowId = "flow-elementary";
  const inputScope = scope(processId, {
    flows: [
      { id: broadFlowId, version, flow_type: "Product flow" },
      { id: elementaryFlowId, version, flow_type: "Elementary flow" },
      { id: missingFlowId, dataset_version: version },
    ],
  });
  const requirements = scopeClassificationRequirements(inputScope);
  assert.deepEqual(requirements, [
    {
      dataset_type: "process",
      dataset_id: processId,
      dataset_version: version,
      category_type: "process",
    },
    {
      dataset_type: "flow",
      dataset_id: broadFlowId,
      dataset_version: version,
      category_type: "flow-product",
    },
    {
      dataset_type: "flow",
      dataset_id: missingFlowId,
      dataset_version: version,
      category_type: "flow-product",
    },
  ]);

  const index = buildClassificationDecisionIndex([
    leafDecision("process", processId, "process"),
    {
      ...leafDecision("flow", broadFlowId, "flow-product"),
      classification_decision_level: "broad_section",
      selected_code: "D",
    },
    { malformed: true },
  ]);
  assert.equal(index.row_count, 3);
  assert.equal(index.indexed_decisions, 2);
  assert.deepEqual(scopeClassificationPreflight(inputScope, index), {
    status: "missing",
    checked_decisions: 3,
    missing_decisions: 1,
    not_leaf_decisions: 1,
    first_missing: requirements[2],
    first_not_leaf: {
      ...requirements[1],
      selected_code: "D",
      classification_decision_level: "broad_section",
      decision_status: "completed",
    },
  });

  const notLeafOnly = scope(processId, {
    flows: [{ id: broadFlowId, version, flow_type: "Product flow" }],
  });
  assert.equal(scopeClassificationPreflight(notLeafOnly, index).status, "not_leaf");
});

test("leaf filtering reports missing and not-leaf scope counts independently", () => {
  const leafProcess = "process-leaf";
  const broadProcess = "process-broad";
  const missingProcess = "process-missing";
  const index = buildClassificationDecisionIndex([
    leafDecision("process", leafProcess, "process"),
    {
      ...leafDecision("process", broadProcess, "process"),
      classification_decision_level: "broad_section",
    },
  ]);
  const result = select({
    allScopes: [scope(leafProcess), scope(broadProcess), scope(missingProcess)],
    classificationDecisionIndex: index,
    requireLeafClassification: true,
  });

  assert.deepEqual(
    result.scopes.map((row) => row.process_id),
    [leafProcess],
  );
  assert.equal(result.stats.filtered_classification_missing, 1);
  assert.equal(result.stats.filtered_classification_not_leaf, 1);
});

test("preflight plan preserves exact object and JSONL key order", () => {
  const processId = "process-plan";
  const inputScope = scope(processId, { weight: 3, closureStatus: "ready" });
  const index = buildClassificationDecisionIndex([leafDecision("process", processId, "process")]);
  const rows = preflightPlanRows({
    scopes: [inputScope],
    verifiedScopes: new Set([`${processId}@${version}`]),
    blockedScopes: new Set([`${processId}@${version}`]),
    familySignaturesByScopeKey: new Map(),
    classificationDecisionIndex: index,
  });

  assert.deepEqual(Object.keys(rows[0]), [
    "schema_version",
    "index",
    "process_id",
    "process_version",
    "scope_key",
    "estimated_weight",
    "already_verified",
    "already_blocked",
    "closure_status",
    "classification_preflight_status",
    "classification_preflight_checked_decisions",
    "classification_preflight_missing_decisions",
    "classification_preflight_not_leaf_decisions",
    "classification_preflight_first_missing",
    "classification_preflight_first_not_leaf",
    "bafu_family_optimization_kind",
    "bafu_family_optimization_role",
    "bafu_family_master_process_id",
    "bafu_family_group_size",
  ]);
  assert.equal(
    `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`,
    `{"schema_version":1,"index":0,"process_id":"${processId}","process_version":"${version}","scope_key":"${scopeKey(inputScope)}","estimated_weight":3,"already_verified":true,"already_blocked":true,"closure_status":"ready","classification_preflight_status":"leaf","classification_preflight_checked_decisions":1,"classification_preflight_missing_decisions":0,"classification_preflight_not_leaf_decisions":0,"classification_preflight_first_missing":null,"classification_preflight_first_not_leaf":null,"bafu_family_optimization_kind":"unknown","bafu_family_optimization_role":"unknown","bafu_family_master_process_id":null,"bafu_family_group_size":null}\n`,
  );
});

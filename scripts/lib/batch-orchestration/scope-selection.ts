export type JsonRecord = Record<string, unknown>;

export type ClassificationDatasetType = "process" | "flow";
export type ClassificationCategoryType = "process" | "flow-product";
export type ClassificationPreflightStatus = "missing" | "not_leaf" | "leaf";
export type SelectionOrder =
  | "input"
  | "estimated-weight-asc"
  | "estimated-weight-desc"
  | "family-master-first"
  | "family-master-first-weight-asc";

export interface ClassificationRequirement extends JsonRecord {
  dataset_type: ClassificationDatasetType;
  dataset_id: string;
  dataset_version: string;
  category_type: ClassificationCategoryType;
}

export interface ClassificationDecisionIndex {
  row_count: number;
  indexed_decisions: number;
  byKey: Map<string, JsonRecord>;
}

export interface ClassificationNotLeafRequirement extends ClassificationRequirement {
  selected_code: string | null;
  classification_decision_level: string | null;
  decision_status: string | null;
}

export interface ClassificationPreflight extends JsonRecord {
  status: ClassificationPreflightStatus;
  checked_decisions: number;
  missing_decisions: number;
  not_leaf_decisions: number;
  first_missing: ClassificationRequirement | null;
  first_not_leaf: ClassificationNotLeafRequirement | null;
}

export interface ScopeFamilySignature extends JsonRecord {
  family_group_key: string;
  optimization_kind: "same_amount_vector" | "same_skeleton" | "standard";
  optimization_role:
    | "same_amount_master"
    | "same_amount_variant"
    | "same_skeleton_master"
    | "same_skeleton_variant"
    | "standard";
  master_process_id: string;
  family_group_size: number;
  family_hash: string;
  exchange_skeleton_hash: string;
  exchange_amount_vector_hash: string;
}

export interface ScopeSelectionCandidate {
  scope: JsonRecord;
  index: number;
  weight: number | null;
  familySignature: ScopeFamilySignature | null;
  classificationPreflight: ClassificationPreflight;
}

export interface ScopeSelectionStats extends JsonRecord {
  input_scopes: number;
  matched_scopes: number;
  filtered_already_verified: number;
  filtered_already_blocked: number;
  filtered_classification_missing: number;
  filtered_classification_not_leaf: number;
  candidate_scopes_before_limit: number;
  selected_scopes: number;
}

export interface ScopeSelectionInput {
  allScopes: readonly JsonRecord[];
  requestedProcessIds: ReadonlySet<string>;
  verifiedScopes: ReadonlySet<string>;
  blockedScopes: ReadonlySet<string>;
  pendingOnly: boolean;
  force: boolean;
  selectionOrder: SelectionOrder;
  limit: number | null;
  familySignaturesByScopeKey: ReadonlyMap<string, ScopeFamilySignature>;
  classificationDecisionIndex: ClassificationDecisionIndex;
  requireLeafClassification: boolean;
}

export interface ScopeSelectionResult {
  scopes: JsonRecord[];
  stats: ScopeSelectionStats;
}

export interface PreflightPlanInput {
  scopes: readonly JsonRecord[];
  verifiedScopes: ReadonlySet<string>;
  blockedScopes: ReadonlySet<string>;
  familySignaturesByScopeKey: ReadonlyMap<string, ScopeFamilySignature>;
  classificationDecisionIndex: ClassificationDecisionIndex;
}

export interface PreflightPlanRow extends JsonRecord {
  schema_version: 1;
  index: number;
  process_id: unknown;
  process_version: unknown;
  scope_key: string;
  estimated_weight: number | null;
  already_verified: boolean;
  already_blocked: boolean;
  closure_status: unknown;
  classification_preflight_status: ClassificationPreflightStatus;
  classification_preflight_checked_decisions: number;
  classification_preflight_missing_decisions: number;
  classification_preflight_not_leaf_decisions: number;
  classification_preflight_first_missing: ClassificationRequirement | null;
  classification_preflight_first_not_leaf: ClassificationNotLeafRequirement | null;
}

function isJsonRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function jsonRecord(value: unknown): JsonRecord {
  return isJsonRecord(value) ? value : {};
}

function asText(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

function familyIdentityText(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value).trim();
  }
  if (Array.isArray(value)) return value.map(familyIdentityText).filter(Boolean).join("; ");
  if (isJsonRecord(value)) {
    return familyIdentityText(
      value["#text"] ??
        value.value ??
        value.id ??
        value["@refObjectId"] ??
        value.shortDescription ??
        value["common:shortDescription"],
    );
  }
  return "";
}

function asArray(value: unknown): unknown[] {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function finiteNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function familySignatureForScope(
  familySignaturesByScopeKey: ReadonlyMap<string, ScopeFamilySignature>,
  scope: JsonRecord,
): ScopeFamilySignature | null {
  const processId = familyIdentityText(scope.process_id ?? scope.id);
  if (!processId) return null;
  const processVersion = familyIdentityText(scope.process_version ?? scope.version) || "00.00.001";
  return familySignaturesByScopeKey.get(`${processId}@${processVersion}`) ?? null;
}

function familySelectionRank(entry: ScopeFamilySignature | null): number {
  switch (entry?.optimization_role) {
    case "same_amount_master":
      return 0;
    case "same_skeleton_master":
      return 1;
    case "standard":
      return 2;
    case "same_amount_variant":
      return 3;
    case "same_skeleton_variant":
      return 4;
    default:
      return 5;
  }
}

function familyPlanFields(entry: ScopeFamilySignature | null): JsonRecord {
  if (!entry) {
    return {
      bafu_family_optimization_kind: "unknown",
      bafu_family_optimization_role: "unknown",
      bafu_family_master_process_id: null,
      bafu_family_group_size: null,
    };
  }
  return {
    bafu_family_optimization_kind: entry.optimization_kind,
    bafu_family_optimization_role: entry.optimization_role,
    bafu_family_master_process_id: entry.master_process_id,
    bafu_family_group_size: entry.family_group_size,
    bafu_family_hash: entry.family_hash,
    bafu_family_skeleton_hash: entry.exchange_skeleton_hash,
    bafu_family_amount_vector_hash: entry.exchange_amount_vector_hash,
  };
}

export function scopeKey(scope: JsonRecord): string {
  return `${scope.process_id || scope.id}@${scope.process_version || scope.version || "00.00.001"}`;
}

export function scopeEstimatedWeight(scope: JsonRecord): number | null {
  const checkpoint = jsonRecord(scope.checkpoint);
  const direct = [
    scope.estimated_weight,
    scope.estimatedWeight,
    scope.weight,
    checkpoint.estimated_weight,
    checkpoint.estimatedWeight,
    checkpoint.weight,
  ];
  for (const value of direct) {
    const parsed = finiteNumber(value);
    if (parsed != null) return parsed;
  }
  const counts = jsonRecord(scope.dependency_counts ?? checkpoint.dependency_counts);
  const flowCount = finiteNumber(counts.flows ?? counts.flow_count ?? scope.flow_count);
  const supportCount = finiteNumber(
    counts.support_rows ?? counts.support ?? counts.sources ?? scope.support_count,
  );
  const processCount = finiteNumber(counts.processes ?? counts.process_count ?? 1);
  if (flowCount != null || supportCount != null || processCount != null) {
    return (flowCount ?? 0) + (supportCount ?? 0) + (processCount ?? 0);
  }
  return null;
}

export function classificationDecisionKey({
  datasetType,
  datasetId,
  datasetVersion,
  categoryType,
}: {
  datasetType: unknown;
  datasetId: unknown;
  datasetVersion: unknown;
  categoryType: unknown;
}): string | null {
  const type = asText(datasetType);
  const id = asText(datasetId);
  const version = asText(datasetVersion) || "00.00.001";
  const category = asText(categoryType);
  return type && id && category ? `${type}:${id}@${version}:${category}` : null;
}

export function buildClassificationDecisionIndex(
  decisionRows: readonly unknown[],
): ClassificationDecisionIndex {
  const byKey = new Map<string, JsonRecord>();
  for (const value of decisionRows) {
    const row = jsonRecord(value);
    const key = classificationDecisionKey({
      datasetType: row.dataset_type,
      datasetId: row.dataset_id,
      datasetVersion: row.dataset_version,
      categoryType: row.category_type,
    });
    if (key) byKey.set(key, row);
  }
  return {
    row_count: decisionRows.length,
    indexed_decisions: byKey.size,
    byKey,
  };
}

export function isLeafClassificationDecision(row: JsonRecord | null | undefined): boolean {
  return Boolean(
    row &&
    asText(row.decision_status || "completed") === "completed" &&
    asText(row.classification_decision_level) === "leaf" &&
    Boolean(asText(row.selected_code ?? row.code)),
  );
}

export function scopeClassificationRequirements(scope: JsonRecord): ClassificationRequirement[] {
  const processId = asText(scope.process_id ?? scope.id);
  const processVersion = asText(scope.process_version ?? scope.version) || "00.00.001";
  const requirements: ClassificationRequirement[] = [];
  if (processId) {
    requirements.push({
      dataset_type: "process",
      dataset_id: processId,
      dataset_version: processVersion,
      category_type: "process",
    });
  }
  const dependencies = jsonRecord(scope.dependency_ids);
  for (const flow of asArray(dependencies.flows).map(jsonRecord)) {
    const flowType = asText(flow.flow_type);
    if (flowType && flowType !== "Product flow") continue;
    const flowId = asText(flow.id ?? flow.dataset_id);
    if (!flowId) continue;
    requirements.push({
      dataset_type: "flow",
      dataset_id: flowId,
      dataset_version: asText(flow.version ?? flow.dataset_version) || "00.00.001",
      category_type: "flow-product",
    });
  }
  return requirements;
}

export function scopeClassificationPreflight(
  scope: JsonRecord,
  classificationDecisionIndex: ClassificationDecisionIndex,
): ClassificationPreflight {
  const requirements = scopeClassificationRequirements(scope);
  const missing: ClassificationRequirement[] = [];
  const notLeaf: ClassificationNotLeafRequirement[] = [];
  for (const requirement of requirements) {
    const key = classificationDecisionKey({
      datasetType: requirement.dataset_type,
      datasetId: requirement.dataset_id,
      datasetVersion: requirement.dataset_version,
      categoryType: requirement.category_type,
    });
    const decision = key ? classificationDecisionIndex.byKey.get(key) : null;
    if (!decision) {
      missing.push(requirement);
      continue;
    }
    if (!isLeafClassificationDecision(decision)) {
      notLeaf.push({
        ...requirement,
        selected_code: asText(decision.selected_code ?? decision.code) || null,
        classification_decision_level: asText(decision.classification_decision_level) || null,
        decision_status: asText(decision.decision_status) || null,
      });
    }
  }
  const status: ClassificationPreflightStatus =
    missing.length > 0 ? "missing" : notLeaf.length > 0 ? "not_leaf" : "leaf";
  return {
    status,
    checked_decisions: requirements.length,
    missing_decisions: missing.length,
    not_leaf_decisions: notLeaf.length,
    first_missing: missing[0] ?? null,
    first_not_leaf: notLeaf[0] ?? null,
  };
}

export function selectionOrderOption(value: unknown): SelectionOrder {
  const normalized = asText(value || "input");
  const aliases: Record<string, SelectionOrder> = {
    family: "family-master-first",
    "family-master": "family-master-first",
    weight: "estimated-weight-asc",
    "weight-asc": "estimated-weight-asc",
    "weight-desc": "estimated-weight-desc",
    estimated_weight_asc: "estimated-weight-asc",
    estimated_weight_desc: "estimated-weight-desc",
  };
  const order = aliases[normalized] ?? normalized;
  if (
    ![
      "input",
      "estimated-weight-asc",
      "estimated-weight-desc",
      "family-master-first",
      "family-master-first-weight-asc",
    ].includes(order)
  ) {
    throw new Error(
      `Unsupported --selection-order ${JSON.stringify(normalized)}. Use input, estimated-weight-asc, estimated-weight-desc, family-master-first, or family-master-first-weight-asc.`,
    );
  }
  return order;
}

export function compareSelectionRows(
  left: ScopeSelectionCandidate,
  right: ScopeSelectionCandidate,
  selectionOrder: SelectionOrder,
): number {
  if (selectionOrder.startsWith("family-master-first")) {
    const leftRank = familySelectionRank(left.familySignature);
    const rightRank = familySelectionRank(right.familySignature);
    if (leftRank !== rightRank) return leftRank - rightRank;
    const leftGroup = asText(left.familySignature?.family_group_key);
    const rightGroup = asText(right.familySignature?.family_group_key);
    if (leftGroup !== rightGroup) return leftGroup.localeCompare(rightGroup);
    if (selectionOrder === "family-master-first-weight-asc") {
      const leftWeight = left.weight;
      const rightWeight = right.weight;
      const leftUnknown = leftWeight == null;
      const rightUnknown = rightWeight == null;
      if (leftUnknown !== rightUnknown) return leftUnknown ? 1 : -1;
      if (leftWeight != null && rightWeight != null && leftWeight !== rightWeight) {
        return leftWeight - rightWeight;
      }
    }
    return left.index - right.index;
  }
  if (selectionOrder === "input") return left.index - right.index;
  const leftWeight = left.weight;
  const rightWeight = right.weight;
  const leftUnknown = leftWeight == null;
  const rightUnknown = rightWeight == null;
  if (leftUnknown !== rightUnknown) return leftUnknown ? 1 : -1;
  if (leftWeight != null && rightWeight != null && leftWeight !== rightWeight) {
    return selectionOrder === "estimated-weight-desc"
      ? rightWeight - leftWeight
      : leftWeight - rightWeight;
  }
  return left.index - right.index;
}

export function selectScopesForRun({
  allScopes,
  requestedProcessIds,
  verifiedScopes,
  blockedScopes,
  pendingOnly,
  force,
  selectionOrder,
  limit,
  familySignaturesByScopeKey,
  classificationDecisionIndex,
  requireLeafClassification,
}: ScopeSelectionInput): ScopeSelectionResult {
  const explicit = requestedProcessIds.size > 0;
  const stats: ScopeSelectionStats = {
    input_scopes: allScopes.length,
    matched_scopes: 0,
    filtered_already_verified: 0,
    filtered_already_blocked: 0,
    filtered_classification_missing: 0,
    filtered_classification_not_leaf: 0,
    candidate_scopes_before_limit: 0,
    selected_scopes: 0,
  };
  const candidates: ScopeSelectionCandidate[] = [];
  for (const [index, scope] of allScopes.entries()) {
    const processId = asText(scope.process_id || scope.id);
    if (explicit && !requestedProcessIds.has(processId)) continue;
    stats.matched_scopes += 1;
    const key = scopeKey(scope);
    if (pendingOnly && !force && verifiedScopes.has(key)) {
      stats.filtered_already_verified += 1;
      continue;
    }
    if (pendingOnly && !force && !explicit && blockedScopes.has(key)) {
      stats.filtered_already_blocked += 1;
      continue;
    }
    const classificationPreflight = scopeClassificationPreflight(
      scope,
      classificationDecisionIndex,
    );
    if (requireLeafClassification && classificationPreflight.status !== "leaf") {
      if (classificationPreflight.status === "missing") {
        stats.filtered_classification_missing += 1;
      } else {
        stats.filtered_classification_not_leaf += 1;
      }
      continue;
    }
    candidates.push({
      scope,
      index,
      weight: scopeEstimatedWeight(scope),
      familySignature: familySignatureForScope(familySignaturesByScopeKey, scope),
      classificationPreflight,
    });
  }
  candidates.sort((left, right) => compareSelectionRows(left, right, selectionOrder));
  stats.candidate_scopes_before_limit = candidates.length;
  const limited = limit == null ? candidates : candidates.slice(0, limit);
  stats.selected_scopes = limited.length;
  return {
    scopes: limited.map((entry) => entry.scope),
    stats,
  };
}

export function preflightPlanRows({
  scopes,
  verifiedScopes,
  blockedScopes,
  familySignaturesByScopeKey,
  classificationDecisionIndex,
}: PreflightPlanInput): PreflightPlanRow[] {
  return scopes.map((scope, index) => {
    const key = scopeKey(scope);
    const familySignature = familySignatureForScope(familySignaturesByScopeKey, scope);
    const classificationPreflight = scopeClassificationPreflight(
      scope,
      classificationDecisionIndex,
    );
    return {
      schema_version: 1,
      index,
      process_id: scope.process_id || scope.id,
      process_version: scope.process_version || scope.version || "00.00.001",
      scope_key: key,
      estimated_weight: scopeEstimatedWeight(scope),
      already_verified: verifiedScopes.has(key),
      already_blocked: blockedScopes.has(key),
      closure_status: scope.closure_status ?? scope.status ?? null,
      classification_preflight_status: classificationPreflight.status,
      classification_preflight_checked_decisions: classificationPreflight.checked_decisions,
      classification_preflight_missing_decisions: classificationPreflight.missing_decisions,
      classification_preflight_not_leaf_decisions: classificationPreflight.not_leaf_decisions,
      classification_preflight_first_missing: classificationPreflight.first_missing,
      classification_preflight_first_not_leaf: classificationPreflight.first_not_leaf,
      ...familyPlanFields(familySignature),
    };
  });
}

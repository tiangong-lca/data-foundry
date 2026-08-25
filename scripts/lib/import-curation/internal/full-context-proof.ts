import { contextFileDetails } from "./context-inputs.ts";
import {
  datasetIdentity,
  detectDatasetType,
  identityFreshnessIdentityKey,
} from "./dataset-payload.ts";
import { sha256Json, sha256Text } from "./hash-utils.ts";
import {
  asText,
  ensureArray,
  fileExists,
  readJson,
  readRows,
  readText,
  repoRelativeArtifactPath,
  repoRelativePath,
  resolveRepoPath,
} from "./runtime-io.ts";

interface JsonRecord {
  [key: string]: unknown;
}

interface ContextFile extends JsonRecord {
  kind?: unknown;
  path?: unknown;
  text?: unknown;
}

interface ContextFileDetail extends JsonRecord {
  kind: string;
  path: string | null;
  sha256: string;
  bytes: number;
}

interface ProofBlocker extends JsonRecord {
  code: string;
  stage: string;
  message: string;
}

interface ArtifactEnvelope<TValue extends JsonRecord = JsonRecord> {
  path?: unknown;
  value?: TValue | null;
}

interface CurationGateContextValue extends JsonRecord {
  context?: {
    contract_context_file_details?: unknown;
    contract_context_files?: unknown;
  } | null;
  entities?: unknown;
  processes?: unknown;
  flows?: unknown;
  items?: unknown;
}

interface AuthoringPackagePayload extends JsonRecord {
  contract_context_files?: unknown;
  missing_context_files?: unknown;
}

interface AuthoringPackageEntity extends JsonRecord {
  authoring_package?: unknown;
  authoringPackage?: unknown;
  authoring_package_sha256?: unknown;
}

interface PatchCollectTask extends JsonRecord {
  files?: {
    authoring_package?: unknown;
    authoringPackage?: unknown;
  } | null;
  context?: {
    authoring_package_sha256?: unknown;
  } | null;
}

export interface AuthoringPackageProof {
  source: unknown;
  path: string | null;
  exists: boolean;
  sha256: string | null;
  expected_sha256: string | null;
  payload: AuthoringPackagePayload | null;
  contract_context_files: ContextFile[];
  contract_context_file_details: ContextFileDetail[];
  blockers: ProofBlocker[];
}

interface DecisionTaskReference extends JsonRecord {
  path?: unknown;
  task?: unknown;
  decision_task?: unknown;
  decisionTask?: unknown;
  sha256?: unknown;
  context_bundle_sha256?: unknown;
  contextBundleSha256?: unknown;
}

interface DecisionTaskPayload extends JsonRecord {
  status?: unknown;
  task_kind?: unknown;
  context_bundle?: unknown;
  authoring_context?: unknown;
  shared_context_bundle?: unknown;
  contract_context_files?: unknown;
  missing_context_files?: unknown;
  schema_types?: unknown;
  schemaTypes?: unknown;
  row_types?: unknown;
  rowTypes?: unknown;
  files?: unknown;
}

export interface SharedContextBundleProof {
  path: string | null;
  sha256: string | null;
  expected_sha256: string | null;
  files: ContextFile[];
  blockers: ProofBlocker[];
}

export interface DecisionTaskProof {
  source: unknown;
  path: string | null;
  exists: boolean;
  sha256: string | null;
  expected_sha256: string | null;
  expected_context_bundle_sha256: string | null;
  payload: DecisionTaskPayload | null;
  status: string | null;
  task_kind: string | null;
  context_bundle_sha256: string | null;
  contract_context_files: ContextFile[];
  contract_context_file_details: ContextFileDetail[];
  missing_context_files: unknown[];
  shared_context_bundle: SharedContextBundleProof | null;
  blockers: ProofBlocker[];
}

export interface FullContextRequirement {
  requiredContextKinds: string[];
  requiredContextFilePatterns: string[];
}

interface FullContextBlockerOptions<TProof> {
  requirement: FullContextRequirement;
  proof: TProof;
}

interface DecisionTaskEvidence {
  blockers: JsonRecord[];
  payload: DecisionTaskPayload | null;
  path?: unknown;
  source?: unknown;
  task_kind?: unknown;
  status?: unknown;
  contract_context_files?: unknown;
  missing_context_files: unknown[];
  context_bundle_sha256?: unknown;
}

interface DecisionTaskBlockerOptions extends FullContextBlockerOptions<DecisionTaskEvidence | null> {
  label: string;
}

function contextFileArray(value: unknown): ContextFile[] {
  return ensureArray(value) as ContextFile[];
}

export function curationGateContextHasKind(
  curationGateArtifact: ArtifactEnvelope<CurationGateContextValue> | null | undefined,
  kind: unknown,
): boolean {
  const details = contextFileArray(
    curationGateArtifact?.value?.context?.contract_context_file_details,
  );
  if (details.some((file) => asText(file?.kind) === kind)) return true;
  const contextPaths = ensureArray(curationGateArtifact?.value?.context?.contract_context_files);
  const expectedFileByKind: Record<PropertyKey, string> = {
    schema: "schema.json",
    methodology_yaml: "methodology.yaml",
    ruleset: "runtime-ruleset.json",
  };
  const expected = expectedFileByKind[kind as PropertyKey];
  return Boolean(
    expected &&
    contextPaths.some((filePath) =>
      String(filePath ?? "")
        .toLowerCase()
        .includes(expected),
    ),
  );
}

export function curationGateContextHasPattern(
  curationGateArtifact: ArtifactEnvelope<CurationGateContextValue> | null | undefined,
  pattern: unknown,
): boolean {
  const details = contextFileArray(
    curationGateArtifact?.value?.context?.contract_context_file_details,
  );
  if (
    details.some((file) =>
      String(file?.path ?? "")
        .toLowerCase()
        .includes((pattern as string).toLowerCase()),
    )
  ) {
    return true;
  }
  const contextPaths = ensureArray(curationGateArtifact?.value?.context?.contract_context_files);
  return contextPaths.some((filePath) =>
    String(filePath ?? "")
      .toLowerCase()
      .includes((pattern as string).toLowerCase()),
  );
}

export function evidenceResolution(entry: unknown): JsonRecord | null {
  const typedEntry = entry as { resolution?: unknown } | null | undefined;
  return typedEntry?.resolution &&
    typeof typedEntry.resolution === "object" &&
    !Array.isArray(typedEntry.resolution)
    ? (typedEntry.resolution as JsonRecord)
    : null;
}

export function evidenceResolutionMode(entry: unknown): string {
  return asText(evidenceResolution(entry)?.mode);
}

export function evidenceResolutionContextKinds(entry: unknown): string[] {
  return ensureArray(
    evidenceResolution(entry)?.used_context_kinds ?? evidenceResolution(entry)?.usedContextKinds,
  )
    .map((kind) => asText(kind))
    .filter(Boolean);
}

export function contextFileHasNonEmptyText(file: ContextFile | null | undefined): boolean {
  return Buffer.byteLength(String(file?.text ?? ""), "utf8") > 0;
}

export function contextFilesHaveKind(files: unknown, kind: unknown): boolean {
  return contextFileArray(files).some(
    (file) => asText(file?.kind) === kind && contextFileHasNonEmptyText(file),
  );
}

export function contextFilesHavePattern(files: unknown, pattern: unknown): boolean {
  const needle = String(pattern).toLowerCase();
  return contextFileArray(files).some(
    (file) =>
      String(file?.path ?? "")
        .toLowerCase()
        .includes(needle) && contextFileHasNonEmptyText(file),
  );
}

export function readAuthoringPackageProof(
  repoRoot: string,
  packageRef: unknown,
  expectedSha256: unknown = null,
  source: unknown = null,
): AuthoringPackageProof {
  const packagePath = resolveRepoPath(repoRoot, packageRef as string | null | undefined);
  const proof: AuthoringPackageProof = {
    source,
    path: packageRef ? repoRelativeArtifactPath(repoRoot, packageRef) : null,
    exists: false,
    sha256: null,
    expected_sha256: asText(expectedSha256) || null,
    payload: null,
    contract_context_files: [],
    contract_context_file_details: [],
    blockers: [],
  };
  if (!packageRef || !packagePath || !fileExists(packagePath)) {
    proof.blockers.push({
      code: "full_context_authoring_package_missing",
      stage: "full_context_ai_completion",
      message: "Full-context AI completion evidence references an unreadable authoring package.",
      authoring_package: proof.path,
      source,
    });
    return proof;
  }
  proof.exists = true;
  proof.path = repoRelativePath(repoRoot, packagePath);
  let rawText = "";
  try {
    rawText = readText(packagePath);
    proof.sha256 = sha256Text(rawText);
    proof.payload = JSON.parse(rawText) as AuthoringPackagePayload;
  } catch (error) {
    proof.blockers.push({
      code: "full_context_authoring_package_invalid",
      stage: "full_context_ai_completion",
      message: error instanceof Error ? error.message : String(error),
      authoring_package: proof.path,
      source,
    });
    return proof;
  }
  if (!proof.payload || typeof proof.payload !== "object" || Array.isArray(proof.payload)) {
    proof.blockers.push({
      code: "full_context_authoring_package_invalid",
      stage: "full_context_ai_completion",
      message: "Authoring package must be a JSON object.",
      authoring_package: proof.path,
      source,
    });
    return proof;
  }
  proof.contract_context_files = contextFileArray(proof.payload.contract_context_files);
  proof.contract_context_file_details = contextFileDetails(proof.contract_context_files);
  if (proof.expected_sha256 && proof.sha256 && proof.expected_sha256 !== proof.sha256) {
    proof.blockers.push({
      code: "full_context_authoring_package_hash_mismatch",
      stage: "full_context_ai_completion",
      message:
        "Recorded authoring_package_sha256 does not match the current authoring package content.",
      authoring_package: proof.path,
      expected_sha256: proof.expected_sha256,
      actual_sha256: proof.sha256,
      source,
    });
  }
  return proof;
}

export function authoringPackageProofsFromCurationGate(
  repoRoot: string,
  curationGateArtifact: ArtifactEnvelope<CurationGateContextValue> | null | undefined,
): AuthoringPackageProof[] {
  const entities = ensureArray(
    curationGateArtifact?.value?.entities ??
      curationGateArtifact?.value?.processes ??
      curationGateArtifact?.value?.flows ??
      curationGateArtifact?.value?.items,
  ) as Array<AuthoringPackageEntity | null | undefined>;
  return entities
    .map((entity) => {
      const packageRef = asText(entity?.authoring_package ?? entity?.authoringPackage);
      if (!packageRef) return null;
      return readAuthoringPackageProof(
        repoRoot,
        packageRef,
        entity?.authoring_package_sha256,
        "curation_gate",
      );
    })
    .filter(Boolean) as AuthoringPackageProof[];
}

// part-09.mjs
export function authoringPackageProofsFromPatchCollect(
  repoRoot: string,
  patchCollectArtifact: ArtifactEnvelope | null | undefined,
): AuthoringPackageProof[] {
  const manifestRef = patchCollectArtifact?.value?.task_manifest;
  const manifestPath = resolveRepoPath(repoRoot, manifestRef as string | null | undefined);
  if (!manifestRef || !manifestPath || !fileExists(manifestPath)) return [];
  let manifest: JsonRecord;
  try {
    manifest = readJson<JsonRecord>(manifestPath);
  } catch {
    return [];
  }
  return (ensureArray(manifest.tasks) as Array<PatchCollectTask | null | undefined>)
    .map((task) => {
      const packageRef = asText(task?.files?.authoring_package ?? task?.files?.authoringPackage);
      if (!packageRef) return null;
      return readAuthoringPackageProof(
        repoRoot,
        packageRef,
        task?.context?.authoring_package_sha256,
        "patch_collect_task_manifest",
      );
    })
    .filter(Boolean) as AuthoringPackageProof[];
}

export function fullContextPackageProofBlockers({
  requirement,
  proof,
}: FullContextBlockerOptions<AuthoringPackageProof>): ProofBlocker[] {
  const blockers = [...proof.blockers];
  if (blockers.length > 0 || !proof.payload) return blockers;
  for (const kind of requirement.requiredContextKinds) {
    if (!contextFilesHaveKind(proof.contract_context_files, kind)) {
      blockers.push({
        code: "full_context_authoring_package_context_kind_missing",
        stage: "full_context_ai_completion",
        message: `Authoring package does not contain full non-empty context text for '${kind}'.`,
        required_kind: kind,
        authoring_package: proof.path,
        source: proof.source,
      });
    }
  }
  for (const pattern of requirement.requiredContextFilePatterns) {
    if (!contextFilesHavePattern(proof.contract_context_files, pattern)) {
      blockers.push({
        code: "full_context_authoring_package_context_file_missing",
        stage: "full_context_ai_completion",
        message: `Authoring package does not contain full non-empty context text for a file matching '${pattern}'.`,
        required_file_pattern: pattern,
        authoring_package: proof.path,
        source: proof.source,
      });
    }
  }
  if (ensureArray(proof.payload.missing_context_files).length > 0) {
    blockers.push({
      code: "full_context_authoring_package_missing_context_files",
      stage: "full_context_ai_completion",
      message:
        "Authoring package records missing context files and cannot prove full-context AI completion.",
      authoring_package: proof.path,
      missing_context_files: ensureArray(proof.payload.missing_context_files),
      source: proof.source,
    });
  }
  return blockers;
}

export function normalizeClassificationDecisionRows(value: unknown): unknown[] {
  const record = value as { decisions?: unknown; rows?: unknown } | null | undefined;
  if (Array.isArray(value)) return value.filter(Boolean);
  if (Array.isArray(record?.decisions)) return record.decisions.filter(Boolean);
  if (Array.isArray(record?.rows)) return record.rows.filter(Boolean);
  return value && typeof value === "object" ? [value] : [];
}

export function readDecisionTaskProof(
  repoRoot: string,
  taskRef: unknown,
  expectedSha256: unknown = null,
  expectedContextBundleSha256: unknown = null,
  source: unknown = null,
): DecisionTaskProof {
  const taskPath = resolveRepoPath(repoRoot, taskRef as string | null | undefined);
  const proof: DecisionTaskProof = {
    source,
    path: taskRef ? repoRelativeArtifactPath(repoRoot, taskRef) : null,
    exists: false,
    sha256: null,
    expected_sha256: asText(expectedSha256) || null,
    expected_context_bundle_sha256: asText(expectedContextBundleSha256) || null,
    payload: null,
    status: null,
    task_kind: null,
    context_bundle_sha256: null,
    contract_context_files: [],
    contract_context_file_details: [],
    missing_context_files: [],
    shared_context_bundle: null,
    blockers: [],
  };
  if (!taskRef || !taskPath || !fileExists(taskPath)) {
    proof.blockers.push({
      code: "full_context_decision_task_missing",
      stage: "full_context_ai_completion",
      message: "Full-context decision evidence references an unreadable AI decision task.",
      decision_task: proof.path,
      source,
    });
    return proof;
  }
  proof.exists = true;
  proof.path = repoRelativePath(repoRoot, taskPath);
  let rawText = "";
  try {
    rawText = readText(taskPath);
    proof.sha256 = sha256Text(rawText);
    proof.payload = JSON.parse(rawText) as DecisionTaskPayload;
  } catch (error) {
    proof.blockers.push({
      code: "full_context_decision_task_invalid",
      stage: "full_context_ai_completion",
      message: error instanceof Error ? error.message : String(error),
      decision_task: proof.path,
      source,
    });
    return proof;
  }
  if (!proof.payload || typeof proof.payload !== "object" || Array.isArray(proof.payload)) {
    proof.blockers.push({
      code: "full_context_decision_task_invalid",
      stage: "full_context_ai_completion",
      message: "Decision task must be a JSON object.",
      decision_task: proof.path,
      source,
    });
    return proof;
  }
  const contextBundle = (proof.payload.context_bundle ??
    proof.payload.authoring_context ??
    {}) as JsonRecord;
  proof.status = asText(proof.payload.status);
  proof.task_kind = asText(proof.payload.task_kind);
  proof.context_bundle_sha256 = asText(contextBundle.sha256 ?? contextBundle.context_bundle_sha256);
  proof.shared_context_bundle = readDecisionTaskSharedContextBundleProof(
    repoRoot,
    proof.payload,
    proof.path,
  );
  proof.blockers.push(...proof.shared_context_bundle.blockers);
  proof.contract_context_files = [
    ...contextFileArray(proof.payload.contract_context_files),
    ...proof.shared_context_bundle.files,
  ];
  proof.contract_context_file_details = contextFileDetails(proof.contract_context_files);
  proof.missing_context_files = ensureArray(proof.payload.missing_context_files);
  if (proof.expected_sha256 && proof.expected_sha256 !== proof.sha256) {
    proof.blockers.push({
      code: "full_context_decision_task_hash_mismatch",
      stage: "full_context_ai_completion",
      message: "Recorded decision task sha256 does not match the current decision task content.",
      decision_task: proof.path,
      expected_sha256: proof.expected_sha256,
      actual_sha256: proof.sha256,
      source,
    });
  }
  if (
    proof.expected_context_bundle_sha256 &&
    proof.context_bundle_sha256 &&
    proof.expected_context_bundle_sha256 !== proof.context_bundle_sha256
  ) {
    proof.blockers.push({
      code: "full_context_decision_task_context_hash_mismatch",
      stage: "full_context_ai_completion",
      message: "Recorded decision task context bundle hash does not match the decision task.",
      decision_task: proof.path,
      expected_context_bundle_sha256: proof.expected_context_bundle_sha256,
      actual_context_bundle_sha256: proof.context_bundle_sha256,
      source,
    });
  }
  return proof;
}

export function decisionTaskProofFromApplyReport(
  repoRoot: string,
  report: JsonRecord | null | undefined,
  source: unknown,
): DecisionTaskProof | null {
  const task = (report?.decision_task ?? report?.decisionTask) as
    DecisionTaskReference | null | undefined;
  const taskRef = asText(task?.path ?? task?.task ?? task?.decision_task ?? task?.decisionTask);
  if (!taskRef) return null;
  return readDecisionTaskProof(
    repoRoot,
    taskRef,
    task?.sha256,
    task?.context_bundle_sha256 ?? task?.contextBundleSha256,
    source,
  );
}

export function readDecisionTaskSharedContextBundleProof(
  repoRoot: string,
  payload: DecisionTaskPayload | null | undefined,
  taskPath: unknown,
): SharedContextBundleProof {
  const contextBundle = (payload?.context_bundle ?? payload?.authoring_context ?? {}) as JsonRecord;
  const sharedContext = (payload?.shared_context_bundle ??
    contextBundle.shared_context_bundle ??
    {}) as JsonRecord;
  const payloadFiles = payload?.files as JsonRecord | null | undefined;
  const sharedPath = asText(sharedContext?.path ?? payloadFiles?.shared_context_bundle);
  const expectedSha256 = asText(
    sharedContext?.sha256 ?? contextBundle?.shared_context_bundle_sha256,
  );
  const proof: SharedContextBundleProof = {
    path: sharedPath ? repoRelativeArtifactPath(repoRoot, sharedPath) : null,
    sha256: null,
    expected_sha256: expectedSha256 || null,
    files: [],
    blockers: [],
  };
  if (!sharedPath) return proof;
  const bundlePath = resolveRepoPath(repoRoot, sharedPath);
  if (!bundlePath || !fileExists(bundlePath)) {
    proof.blockers.push({
      code: "full_context_decision_task_shared_context_bundle_missing",
      stage: "full_context_ai_completion",
      message: "Decision task references an unreadable shared full-context bundle.",
      decision_task: taskPath,
      shared_context_bundle: proof.path,
    });
    return proof;
  }
  try {
    const bundle = readJson<JsonRecord | null>(bundlePath);
    proof.sha256 = asText(bundle?.sha256);
    proof.files = contextFileArray(bundle?.files);
    if (expectedSha256 && proof.sha256 !== expectedSha256) {
      proof.blockers.push({
        code: "full_context_decision_task_shared_context_bundle_hash_mismatch",
        stage: "full_context_ai_completion",
        message: "Decision task shared context bundle sha256 no longer matches the task reference.",
        decision_task: taskPath,
        shared_context_bundle: proof.path,
        expected_sha256: expectedSha256,
        actual_sha256: proof.sha256 || null,
      });
    }
  } catch (error) {
    proof.blockers.push({
      code: "full_context_decision_task_shared_context_bundle_invalid",
      stage: "full_context_ai_completion",
      message: error instanceof Error ? error.message : String(error),
      decision_task: taskPath,
      shared_context_bundle: proof.path,
    });
  }
  return proof;
}

export function decisionTaskProofsFromApplyReport(
  repoRoot: string,
  report: JsonRecord | null | undefined,
  source: unknown,
): DecisionTaskProof[] {
  const tasks = ensureArray(
    report?.decision_tasks ?? report?.decisionTasks,
  ) as DecisionTaskReference[];
  if (tasks.length === 0) {
    const single = decisionTaskProofFromApplyReport(repoRoot, report, source);
    return single ? [single] : [];
  }
  return tasks
    .map((task) => {
      const taskRef = asText(task?.path ?? task?.task ?? task?.decision_task ?? task?.decisionTask);
      if (!taskRef) return null;
      return readDecisionTaskProof(
        repoRoot,
        taskRef,
        task?.sha256,
        task?.context_bundle_sha256 ?? task?.contextBundleSha256,
        source,
      );
    })
    .filter(Boolean) as DecisionTaskProof[];
}

export function payloadSha256ByIdentityForRows(
  repoRoot: string,
  rowFiles: unknown,
  fallbackDatasetType: string | null = null,
): Map<string, string> {
  const map = new Map<string, string>();
  for (const rowFile of ensureArray(rowFiles)) {
    const resolved = resolveRepoPath(repoRoot, rowFile as string | null | undefined);
    if (!resolved || !fileExists(resolved)) continue;
    readRows(resolved).forEach((row, index) => {
      const datasetType = detectDatasetType(row, fallbackDatasetType);
      if (!datasetType) return;
      const identity = datasetIdentity(row, index, datasetType);
      const key = identityFreshnessIdentityKey({ datasetType, identity });
      if (key) map.set(key, sha256Json(identity.payload));
    });
  }
  return map;
}

export function fullContextDecisionTaskProofBlockers({
  requirement,
  proof,
  label,
}: DecisionTaskBlockerOptions): JsonRecord[] {
  if (!proof) {
    return [
      {
        code: `full_context_ai_${label}_decision_task_required`,
        stage: "full_context_ai_completion",
        message:
          "Decision apply report must bind to the AI decision task that carried the full schema/YAML/context bundle.",
      },
    ];
  }
  const blockers = [...proof.blockers];
  if (blockers.length > 0 || !proof.payload) return blockers;
  const expectedTaskKind =
    label === "location" ? "location_decision_authoring" : "classification_decision_authoring";
  const expectedStatus =
    label === "location"
      ? "ready_for_ai_location_decisions"
      : "ready_for_ai_classification_decisions";
  if (proof.task_kind !== expectedTaskKind) {
    blockers.push({
      code: `full_context_ai_${label}_decision_task_kind_invalid`,
      stage: "full_context_ai_completion",
      message:
        "Decision apply report must reference the matching full-context AI decision task kind.",
      decision_task: proof.path,
      expected_task_kind: expectedTaskKind,
      actual_task_kind: proof.task_kind || null,
      source: proof.source,
    });
  }
  if (proof.status !== expectedStatus) {
    blockers.push({
      code: `full_context_ai_${label}_decision_task_status_invalid`,
      stage: "full_context_ai_completion",
      message: "Decision apply report must reference a ready full-context AI decision task.",
      decision_task: proof.path,
      expected_status: expectedStatus,
      actual_status: proof.status || null,
      source: proof.source,
    });
  }
  for (const kind of requirement.requiredContextKinds) {
    if (!contextFilesHaveKind(proof.contract_context_files, kind)) {
      blockers.push({
        code: `full_context_ai_${label}_decision_task_context_kind_missing`,
        stage: "full_context_ai_completion",
        message: `Decision task does not contain full non-empty context text for '${kind}'.`,
        required_kind: kind,
        decision_task: proof.path,
        source: proof.source,
      });
    }
  }
  for (const pattern of decisionTaskRequiredContextFilePatterns({
    requirement,
    proof,
    label,
  })) {
    if (!contextFilesHavePattern(proof.contract_context_files, pattern)) {
      blockers.push({
        code: `full_context_ai_${label}_decision_task_context_file_missing`,
        stage: "full_context_ai_completion",
        message: `Decision task does not contain full non-empty context text for a file matching '${pattern}'.`,
        required_file_pattern: pattern,
        decision_task: proof.path,
        source: proof.source,
      });
    }
  }
  if (proof.missing_context_files.length > 0) {
    blockers.push({
      code: `full_context_ai_${label}_decision_task_missing_context_files`,
      stage: "full_context_ai_completion",
      message:
        "Decision task records missing context files and cannot prove full-context AI completion.",
      decision_task: proof.path,
      missing_context_files: proof.missing_context_files,
      source: proof.source,
    });
  }
  if (!proof.context_bundle_sha256) {
    blockers.push({
      code: `full_context_ai_${label}_decision_task_context_hash_missing`,
      stage: "full_context_ai_completion",
      message:
        "Decision task must include context_bundle.sha256 so decisions can be tied to the exact context bundle.",
      decision_task: proof.path,
      source: proof.source,
    });
  }
  return blockers;
}

export function decisionTaskRequiredContextFilePatterns({
  requirement,
  proof,
  label,
}: DecisionTaskBlockerOptions): string[] {
  const profilePatterns = ensureArray(requirement.requiredContextFilePatterns);
  if (label === "location") {
    return profilePatterns.filter((pattern) =>
      [
        "schema.json",
        "methodology.yaml",
        "runtime-ruleset.json",
        "tidas_locations_category.json",
      ].includes(String(pattern).toLowerCase()),
    );
  }
  if (label !== "classification") return profilePatterns;

  const schemaTypeToFile: Record<string, string> = {
    contact: "tidas_contacts_category.json",
    contacts: "tidas_contacts_category.json",
    flowproperty: "tidas_flowproperties_category.json",
    flowproperties: "tidas_flowproperties_category.json",
    "flow-elementary": "tidas_flows_elementary_category.json",
    elementary: "tidas_flows_elementary_category.json",
    "flow-product": "tidas_flows_product_category.json",
    flow: "tidas_flows_product_category.json",
    lciamethod: "tidas_lciamethods_category.json",
    lciamethods: "tidas_lciamethods_category.json",
    process: "tidas_processes_category.json",
    processes: "tidas_processes_category.json",
    source: "tidas_sources_category.json",
    sources: "tidas_sources_category.json",
    unitgroup: "tidas_unitgroups_category.json",
    unitgroups: "tidas_unitgroups_category.json",
  };
  const payload = proof?.payload ?? {};
  const schemaTypes = [
    ...ensureArray(payload.schema_types ?? payload.schemaTypes),
    ...ensureArray(payload.row_types ?? payload.rowTypes),
  ]
    .map((value) => asText(value).toLowerCase())
    .filter(Boolean);
  const required = new Set([
    "schema.json",
    "methodology.yaml",
    "runtime-ruleset.json",
    "tidas_locations_category.json",
  ]);
  for (const schemaType of schemaTypes) {
    const fileName = schemaTypeToFile[schemaType];
    if (fileName) required.add(fileName);
  }
  if (schemaTypes.length === 0) {
    for (const pattern of profilePatterns) {
      if (contextFilesHavePattern(proof?.contract_context_files, pattern)) {
        required.add(String(pattern).toLowerCase());
      }
    }
  }
  return profilePatterns.filter((pattern) => required.has(String(pattern).toLowerCase()));
}

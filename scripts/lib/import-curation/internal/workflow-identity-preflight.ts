import path from "node:path";
import { validateIdentityPreflightEvidence } from "../../identity-preflight-proof.ts";
import { readJsonLinesIfExists, resolveArtifactPath } from "./artifact-inputs.ts";
import {
  dataSetInformation,
  datasetRoot,
  identityFreshnessIdentityKey,
} from "./dataset-payload.ts";
import { sha256Json } from "./hash-utils.ts";
import {
  asText,
  ensureArray,
  fileExists,
  readJson,
  readJsonIfExists,
  readText,
  repoRelativePath,
  resolveRepoPath,
} from "./runtime-io.ts";
import {
  type IdentityDecisionApplyContext,
  identityDecisionApplyContextClosesAction,
} from "./workflow-identity-decision-context.ts";
import {
  classCode,
  classLevel,
  classText,
  locationCodeMapForPatch,
  processCategoryPathForCode,
} from "./workflow-patch-evidence.ts";
import { identityPreflightIndexPath } from "./workflow-queue-context.ts";
import { deterministicRowsFileTransformEntries } from "./workflow-row-transform-context.ts";
import {
  classificationEntriesForPayload,
  flowTypeForPayload,
  flowUsesElementaryClassification,
  jsonPointerToken,
  nameTextForPayload,
} from "./workflow-semantic-actions.ts";

interface JsonRecord {
  [key: string]: unknown;
}

interface DatasetIdentity extends JsonRecord {
  id?: unknown;
  version?: unknown;
  payload?: unknown;
}

interface IdentityPreflightFreshness extends JsonRecord {
  current_payload_sha256: string | null;
  request_target_sha256: string | null;
  current_payload_matches_request: unknown;
  current_payload_scope_accepted?: unknown;
}

interface IdentityPreflightResult extends JsonRecord {
  status?: unknown;
  decision?: unknown;
  confidence?: unknown;
  next_action?: unknown;
  target?: unknown;
  candidates?: unknown;
  candidate_sources?: unknown;
  findings?: unknown;
  blockers?: unknown;
  files?: unknown;
  out_dir?: unknown;
}

interface IdentityPreflightRow extends JsonRecord {
  dataset_type: string;
  dataset_id: string;
  dataset_version: string;
  source_file?: unknown;
  request_file?: string | null;
  output_dir?: string | null;
  remote_search?: unknown;
  request?: JsonRecord | null;
  result?: IdentityPreflightResult | null;
  status: string;
  freshness?: IdentityPreflightFreshness;
}

interface IdentityPreflightContext {
  indexPath: string;
  rows: IdentityPreflightRow[];
  rowsByIdentity: Map<string, IdentityPreflightRow>;
  completed: number;
  pending: number;
}

interface TransformContextLike extends JsonRecord {
  status?: unknown;
  inputRowsFile?: string | null;
  outputRowsFile?: string | null;
  inputRows?: string[];
  outputRows?: string[];
  inputPayloadSha256ByIdentity?: Map<string, string>;
  outputPayloadSha256ByIdentity?: Map<string, string>;
}

interface DecisionApplyContext extends TransformContextLike {
  reportPath?: string | null;
  inputRows: string[];
  outputRows: string[];
}

interface ExternalizationContext extends TransformContextLike {
  affectedKeys: Set<string>;
  externalizedExchangeCountByIdentity: Map<string, number>;
  outputPayloadSha256ByIdentity: Map<string, string>;
  reportPathRelative: string | null;
  inputRowsFileRelative: string | null;
  outputRowsFileRelative: string | null;
  tracesFileRelative: string | null;
}

interface TransformOptions {
  patchApplyContext?: TransformContextLike | null;
  classificationDecisionApplyContext?: DecisionApplyContext | null;
  locationDecisionApplyContext?: TransformContextLike | null;
  identityDecisionApplyContext?: TransformContextLike | null;
  identityReferenceRewriteContext?: TransformContextLike | null;
  unresolvedExchangeExternalizationContext?: ExternalizationContext | null;
  sourceContactRewriteContext?: TransformContextLike | null;
  canonicalSupportRewriteContext?: TransformContextLike | null;
  cleanupContext?: TransformContextLike | null;
}

interface ClassificationFreshnessOptions {
  repoRoot: string;
  freshness: IdentityPreflightFreshness;
  datasetType: string;
  identity: DatasetIdentity;
  classificationDecisionApplyContext?: DecisionApplyContext | null;
}

interface DeterministicFreshnessOptions extends TransformOptions {
  repoRoot: string;
  freshness: IdentityPreflightFreshness;
  datasetType: string;
  identity: DatasetIdentity;
}

interface ExternalizationFreshnessOptions {
  freshness: IdentityPreflightFreshness;
  datasetType: string;
  identity: DatasetIdentity;
  unresolvedExchangeExternalizationContext?: ExternalizationContext | null;
}

interface AttachFreshnessOptions extends TransformOptions {
  repoRoot?: string;
  datasetType?: string;
  identity?: DatasetIdentity;
}

interface SourceContextOptions {
  profile?: JsonRecord | null;
  datasetType: string;
  curationQueueContext?: JsonRecord | null;
  context?: { rows?: unknown } | null;
}

interface IdentityLookupContext {
  rowsByIdentity: ReadonlyMap<string, unknown>;
}

interface DependencyPreflightRow extends JsonRecord {
  relation: string;
  ref: unknown;
  ref_path: unknown;
  identity_preflight: IdentityPreflightRow | null;
}

interface BuildAuthoringContextOptions extends TransformOptions {
  context?: IdentityPreflightContext | null;
  datasetType: string;
  identity: DatasetIdentity;
  curationQueueContext?: JsonRecord | null;
  repoRoot: string;
}

interface IdentityPreflightAuthoringContext extends JsonRecord {
  current: IdentityPreflightRow | null;
  dependencies: DependencyPreflightRow[];
}

interface IdentityGateOptions {
  required: boolean;
  context?: IdentityPreflightContext | null;
  authoringContext?: IdentityPreflightAuthoringContext | null;
  datasetType: string;
  identity: DatasetIdentity;
  curationQueueContext?: JsonRecord | null;
  profile?: JsonRecord | null;
}

interface AiDecisionActionOptions {
  datasetType: string;
  identity: DatasetIdentity;
  row: unknown;
  relation?: string;
  path?: unknown;
  dependencyType?: string | null;
  dependencyId?: string | null;
  dependencyVersion?: string | null;
}

interface IdentityDecisionActionItem extends JsonRecord {
  code: string;
  evidence: JsonRecord & { candidate_count: number; top_candidates: unknown[] };
}

interface AuthoringActionOptions {
  required: boolean;
  authoringContext?: IdentityPreflightAuthoringContext | null;
  datasetType: string;
  identity: DatasetIdentity;
  identityDecisionApplyContext?: IdentityDecisionApplyContext | null;
}

interface TextLeaf {
  path: string;
  path_segments: string[];
  text: string;
}

interface PrewriteContentPolicy {
  path: string;
  relative_path: string;
  value: JsonRecord;
}

interface ContentQualityOptions {
  repoRoot: string | null;
  payload: unknown;
  datasetType: string;
  profile?: JsonRecord | null;
}

interface PrewriteIdentityOptions {
  allowAccountLocalSupportAndElementary?: boolean;
  profile?: JsonRecord | null;
}

interface QueueAuthoringOptions {
  repoRoot: string;
  datasetType?: string;
  payload: unknown;
  row: unknown;
}

interface QueueActionItem extends JsonRecord {
  code: string;
  path: string | null;
  instruction: string;
  evidence: JsonRecord;
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asRecord(value: unknown): JsonRecord {
  return isRecord(value) ? value : {};
}

// part-01.mjs
export function identityPreflightResultFile(
  repoRoot: string,
  indexPath: string,
  row: unknown,
): string | null {
  const typedRow = asRecord(row);
  const baseDir = path.dirname(indexPath);
  const explicit =
    typedRow.expected_report_file ??
    typedRow.identity_decision_file ??
    typedRow.identityDecisionFile ??
    typedRow.report_file ??
    typedRow.reportFile;
  if (explicit) return resolveArtifactPath(repoRoot, asText(explicit), baseDir);
  const outputDir = asText(typedRow.output_dir ?? typedRow.outputDir);
  if (!outputDir) return null;
  const resolvedOutputDir = path.isAbsolute(outputDir)
    ? outputDir
    : path.resolve(baseDir, outputDir);
  const fromIndexBase = path.join(resolvedOutputDir, "outputs", "identity-decision.json");
  if (fileExists(fromIndexBase)) return fromIndexBase;
  return resolveRepoPath(repoRoot, path.join(outputDir, "outputs", "identity-decision.json"));
}

export function readIdentityPreflightIndexRow(
  repoRoot: string,
  indexPath: string,
  row: unknown,
): IdentityPreflightRow | null {
  const typedRow = asRecord(row);
  const baseDir = path.dirname(indexPath);
  const datasetType = asText(typedRow.dataset_type ?? typedRow.type);
  const datasetId = asText(typedRow.dataset_id ?? typedRow.entity_id ?? typedRow.id);
  const datasetVersion = asText(typedRow.dataset_version ?? typedRow.version) || "00.00.001";
  if (!datasetType || !datasetId) return null;
  const requestPath = resolveArtifactPath(repoRoot, asText(typedRow.request_file), baseDir);
  const request = requestPath ? readJsonIfExists<JsonRecord>(requestPath) : null;
  const requestText = requestPath && fileExists(requestPath) ? readText(requestPath) : null;
  const resultPath = identityPreflightResultFile(repoRoot, indexPath, row);
  const result = resultPath ? readJsonIfExists<IdentityPreflightResult>(resultPath) : null;
  const resultText = resultPath && fileExists(resultPath) ? readText(resultPath) : null;
  const executionManifestPath =
    resolveArtifactPath(
      repoRoot,
      asText(typedRow.execution_manifest_file ?? typedRow.executionManifestFile),
      baseDir,
    ) ??
    (resultPath
      ? path.join(path.dirname(resultPath), "foundry-identity-preflight-execution.json")
      : null);
  const executionManifest = executionManifestPath
    ? readJsonIfExists<JsonRecord>(executionManifestPath)
    : null;
  const targetSha256 =
    typedRow.target_sha256 ??
    typedRow.targetSha256 ??
    (request ? sha256Json(request.target ?? null) : null);
  const executionEvidence = validateIdentityPreflightEvidence(executionManifest, {
    requestText,
    reportText: resultText,
    datasetType,
    datasetId,
    datasetVersion,
    targetSha256: asText(targetSha256),
    expectedProjectRef:
      asText(typedRow.expected_project_ref ?? typedRow.expectedProjectRef) || null,
    expectedUserId: asText(typedRow.expected_user_id ?? typedRow.expectedUserId) || null,
  });
  const completedResult = result && executionEvidence.ok ? result : null;
  // Candidate files are convenience exports and are not covered by the bound
  // execution manifest. Downstream semantic evidence comes only from the
  // manifest-bound identity-decision report.
  const rowOutputDir = asText(typedRow.output_dir);
  const resultOutputDir = asText(result?.out_dir);
  const outputDir = rowOutputDir
    ? (resolveArtifactPath(repoRoot, rowOutputDir, baseDir) ??
      resolveRepoPath(repoRoot, rowOutputDir))
    : resultOutputDir || null;
  return {
    dataset_type: datasetType,
    dataset_id: datasetId,
    dataset_version: datasetVersion,
    source_file: typedRow.source_file ?? null,
    request_file: requestPath ? repoRelativePath(repoRoot, requestPath) : null,
    output_dir: outputDir ? repoRelativePath(repoRoot, outputDir) : null,
    command: typedRow.command ?? null,
    remote_search: typedRow.remote_search ?? request?.remote_candidate_search ?? null,
    request: request
      ? {
          schema_version: request.schema_version ?? null,
          remote_candidate_search: request.remote_candidate_search ?? null,
          target_sha256: targetSha256,
        }
      : typedRow.target_sha256 || typedRow.targetSha256
        ? {
            schema_version: null,
            remote_candidate_search: null,
            target_sha256: typedRow.target_sha256 ?? typedRow.targetSha256,
          }
        : null,
    result: completedResult
      ? {
          status: completedResult.status ?? null,
          decision: completedResult.decision ?? null,
          confidence: completedResult.confidence ?? null,
          next_action: completedResult.next_action ?? null,
          target: completedResult.target ?? null,
          candidates: ensureArray(completedResult.candidates),
          candidate_sources: completedResult.candidate_sources ?? null,
          findings: completedResult.findings ?? [],
          blockers: completedResult.blockers ?? [],
          files: completedResult.files ?? null,
        }
      : null,
    execution_evidence: {
      status: executionEvidence.ok ? "verified" : "invalid_or_missing",
      code: executionEvidence.code ?? null,
      manifest_file:
        executionManifestPath && fileExists(executionManifestPath)
          ? repoRelativePath(repoRoot, executionManifestPath)
          : null,
    },
    status: completedResult ? "completed" : "pending_execution",
  };
}

export function readIdentityPreflightContext(
  repoRoot: string,
  options: JsonRecord,
  rowsFile: string | null | undefined,
): IdentityPreflightContext | null {
  const indexPath = identityPreflightIndexPath(repoRoot, options, rowsFile);
  if (!indexPath) return null;
  if (!fileExists(indexPath)) {
    throw new Error(`--identity-preflight-index must point to a readable JSONL file: ${indexPath}`);
  }
  const rows = readJsonLinesIfExists(indexPath)
    .map((row) => readIdentityPreflightIndexRow(repoRoot, indexPath, row))
    .filter((row): row is IdentityPreflightRow => row !== null);
  const rowsByIdentity = new Map<string, IdentityPreflightRow>();
  for (const row of rows) {
    const key = `${row.dataset_type}:${row.dataset_id}@@${row.dataset_version}`;
    rowsByIdentity.set(key, row);
    if (!rowsByIdentity.has(`${row.dataset_type}:${row.dataset_id}`)) {
      rowsByIdentity.set(`${row.dataset_type}:${row.dataset_id}`, row);
    }
  }
  return {
    indexPath,
    rows,
    rowsByIdentity,
    completed: rows.filter((row) => row.status === "completed").length,
    pending: rows.filter((row) => row.status !== "completed").length,
  };
}

export function identityPreflightRowForIdentity(
  context: IdentityLookupContext | null | undefined,
  datasetType: string,
  identity: DatasetIdentity | null | undefined,
): IdentityPreflightRow | null {
  if (!context || !identity?.id) return null;
  return (context.rowsByIdentity.get(
    `${datasetType}:${identity.id}@@${identity.version || "00.00.001"}`,
  ) ??
    context.rowsByIdentity.get(`${datasetType}:${identity.id}`) ??
    null) as IdentityPreflightRow | null;
}

export function identityPreflightFreshness(
  row: unknown,
  payload: unknown,
): IdentityPreflightFreshness {
  const request = asRecord(asRecord(row).request);
  const currentPayloadSha256 = payload ? sha256Json(payload) : null;
  const requestTargetSha256 = asText(request.target_sha256) || null;
  return {
    current_payload_sha256: currentPayloadSha256,
    request_target_sha256: requestTargetSha256,
    current_payload_matches_request: Boolean(
      currentPayloadSha256 && requestTargetSha256 && currentPayloadSha256 === requestTargetSha256,
    ),
  };
}

export function classificationFreshnessAllowance({
  repoRoot,
  freshness,
  datasetType,
  identity,
  classificationDecisionApplyContext,
}: ClassificationFreshnessOptions): JsonRecord | null {
  if (
    freshness?.current_payload_matches_request === true ||
    classificationDecisionApplyContext?.status !== "completed"
  ) {
    return null;
  }
  const key = identityFreshnessIdentityKey({ datasetType, identity });
  if (!key) return null;
  const classificationInputPayloadSha256 =
    classificationDecisionApplyContext.inputPayloadSha256ByIdentity?.get(key) ?? null;
  const classificationOutputPayloadSha256 =
    classificationDecisionApplyContext.outputPayloadSha256ByIdentity?.get(key) ?? null;
  const requestMatchesClassificationInput = Boolean(
    freshness?.request_target_sha256 &&
    classificationInputPayloadSha256 &&
    freshness.request_target_sha256 === classificationInputPayloadSha256,
  );
  const currentMatchesClassificationOutput = Boolean(
    freshness?.current_payload_sha256 &&
    classificationOutputPayloadSha256 &&
    freshness.current_payload_sha256 === classificationOutputPayloadSha256,
  );
  if (!requestMatchesClassificationInput || !currentMatchesClassificationOutput) {
    return null;
  }
  return {
    reason: "classification_decision_apply",
    report: classificationDecisionApplyContext.reportPath
      ? repoRelativePath(repoRoot, classificationDecisionApplyContext.reportPath)
      : null,
    input_rows_files: classificationDecisionApplyContext.inputRows.map((file) =>
      repoRelativePath(repoRoot, file),
    ),
    output_rows_files: classificationDecisionApplyContext.outputRows.map((file) =>
      repoRelativePath(repoRoot, file),
    ),
    request_payload_matches_classification_input: requestMatchesClassificationInput,
    current_payload_matches_classification_output: currentMatchesClassificationOutput,
    classification_input_payload_sha256: classificationInputPayloadSha256,
    classification_output_payload_sha256: classificationOutputPayloadSha256,
  };
}

export function deterministicTransformFreshnessAllowance({
  repoRoot,
  freshness,
  datasetType,
  identity,
  patchApplyContext,
  classificationDecisionApplyContext,
  locationDecisionApplyContext,
  identityDecisionApplyContext,
  identityReferenceRewriteContext,
  unresolvedExchangeExternalizationContext,
  sourceContactRewriteContext,
  canonicalSupportRewriteContext,
  cleanupContext,
}: DeterministicFreshnessOptions): JsonRecord | null {
  if (
    freshness?.current_payload_matches_request === true ||
    !freshness?.request_target_sha256 ||
    !freshness?.current_payload_sha256
  ) {
    return null;
  }
  const key = identityFreshnessIdentityKey({ datasetType, identity });
  if (!key) return null;
  const transforms = deterministicRowsFileTransformEntries({
    patchApplyContext,
    classificationDecisionApplyContext,
    locationDecisionApplyContext,
    identityDecisionApplyContext,
    identityReferenceRewriteContext,
    unresolvedExchangeExternalizationContext,
    sourceContactRewriteContext,
    canonicalSupportRewriteContext,
    cleanupContext,
  });
  const reachable = new Set([freshness.request_target_sha256]);
  const applied: JsonRecord[] = [];
  for (let pass = 0; pass <= transforms.length; pass += 1) {
    let changed = false;
    for (const transform of transforms) {
      const inputPayloadSha256 = transform.inputPayloadSha256ByIdentity?.get(key) ?? null;
      const outputPayloadSha256 = transform.outputPayloadSha256ByIdentity?.get(key) ?? null;
      if (!inputPayloadSha256 || !outputPayloadSha256 || !reachable.has(inputPayloadSha256)) {
        continue;
      }
      if (!reachable.has(outputPayloadSha256)) {
        reachable.add(outputPayloadSha256);
        applied.push({
          kind: transform.kind,
          input_payload_sha256: inputPayloadSha256,
          output_payload_sha256: outputPayloadSha256,
          input_rows_file: transform.inputRowsFile
            ? repoRelativePath(repoRoot, transform.inputRowsFile)
            : null,
          output_rows_file: transform.outputRowsFile
            ? repoRelativePath(repoRoot, transform.outputRowsFile)
            : null,
        });
        changed = true;
      }
      if (reachable.has(freshness.current_payload_sha256)) {
        return {
          reason: "deterministic_rows_file_transform_chain",
          request_payload_sha256: freshness.request_target_sha256,
          current_payload_sha256: freshness.current_payload_sha256,
          accepted_payload_sha256: freshness.current_payload_sha256,
          transforms: applied,
        };
      }
    }
    if (reachable.has(freshness.current_payload_sha256)) {
      return {
        reason: "deterministic_rows_file_transform_chain",
        request_payload_sha256: freshness.request_target_sha256,
        current_payload_sha256: freshness.current_payload_sha256,
        accepted_payload_sha256: freshness.current_payload_sha256,
        transforms: applied,
      };
    }
    if (!changed) break;
  }
  return null;
}

export function externalizationFreshnessAllowance({
  freshness,
  datasetType,
  identity,
  unresolvedExchangeExternalizationContext,
}: ExternalizationFreshnessOptions): JsonRecord | null {
  if (
    datasetType !== "process" ||
    freshness?.current_payload_matches_request === true ||
    unresolvedExchangeExternalizationContext?.status !== "completed"
  ) {
    return null;
  }
  const key = identityFreshnessIdentityKey({ datasetType, identity });
  if (!key || !unresolvedExchangeExternalizationContext.affectedKeys.has(key)) {
    return null;
  }
  const externalizedPayloadSha256 =
    unresolvedExchangeExternalizationContext.outputPayloadSha256ByIdentity.get(key) ?? null;
  return {
    reason: "unresolved_exchange_externalization",
    report: unresolvedExchangeExternalizationContext.reportPathRelative,
    input_rows_file: unresolvedExchangeExternalizationContext.inputRowsFileRelative,
    output_rows_file: unresolvedExchangeExternalizationContext.outputRowsFileRelative,
    traces_file: unresolvedExchangeExternalizationContext.tracesFileRelative,
    externalized_exchange_count:
      unresolvedExchangeExternalizationContext.externalizedExchangeCountByIdentity.get(key) ?? 0,
    current_payload_matches_externalized_output: Boolean(
      freshness?.current_payload_sha256 &&
      externalizedPayloadSha256 &&
      freshness.current_payload_sha256 === externalizedPayloadSha256,
    ),
    externalized_payload_sha256: externalizedPayloadSha256,
  };
}

export function attachIdentityPreflightFreshness(
  row: IdentityPreflightRow | null | undefined,
  payload: unknown,
  options: AttachFreshnessOptions = {},
): IdentityPreflightRow | null {
  if (!row) return null;
  const freshness = identityPreflightFreshness(row, payload);
  const deterministicAllowances = [
    classificationFreshnessAllowance({
      repoRoot: options.repoRoot!,
      freshness,
      datasetType: options.datasetType!,
      identity: options.identity!,
      classificationDecisionApplyContext: options.classificationDecisionApplyContext,
    }),
    externalizationFreshnessAllowance({
      freshness,
      datasetType: options.datasetType!,
      identity: options.identity!,
      unresolvedExchangeExternalizationContext: options.unresolvedExchangeExternalizationContext,
    }),
    deterministicTransformFreshnessAllowance({
      repoRoot: options.repoRoot!,
      freshness,
      datasetType: options.datasetType!,
      identity: options.identity!,
      patchApplyContext: options.patchApplyContext,
      classificationDecisionApplyContext: options.classificationDecisionApplyContext,
      locationDecisionApplyContext: options.locationDecisionApplyContext,
      identityDecisionApplyContext: options.identityDecisionApplyContext,
      identityReferenceRewriteContext: options.identityReferenceRewriteContext,
      unresolvedExchangeExternalizationContext: options.unresolvedExchangeExternalizationContext,
      sourceContactRewriteContext: options.sourceContactRewriteContext,
      canonicalSupportRewriteContext: options.canonicalSupportRewriteContext,
      cleanupContext: options.cleanupContext,
    }),
  ].filter(Boolean);
  return {
    ...row,
    freshness: {
      ...freshness,
      deterministic_transform_allowance: deterministicAllowances[0] ?? null,
      deterministic_transform_allowances: deterministicAllowances,
      current_payload_scope_accepted: Boolean(
        freshness.current_payload_matches_request || deterministicAllowances.length > 0,
      ),
    },
  };
}

export function identityPreflightFreshnessAccepted(freshness: unknown): boolean {
  const typedFreshness = asRecord(freshness);
  return Boolean(
    typedFreshness.current_payload_matches_request === true ||
    typedFreshness.current_payload_scope_accepted === true,
  );
}

export function identityPreflightSourceContextRequired({
  profile,
  datasetType,
  curationQueueContext,
  context,
}: SourceContextOptions): boolean {
  return Boolean(
    asText(profile?.id).toLowerCase() === "bafu" &&
    ["flow", "process"].includes(datasetType) &&
    curationQueueContext?.status === "attached" &&
    ensureArray(context?.rows).some((row) => asText(asRecord(row).source_file)),
  );
}

export function identityPreflightHasSourceContext(row: unknown): boolean {
  return Boolean(asText(asRecord(row).source_file));
}

export function dependencyPayloadForFreshness(dependency: unknown): unknown {
  const typedDependency = asRecord(dependency);
  const rows = ensureArray(
    typedDependency.input_rows ??
      typedDependency.rows ??
      typedDependency.payload_rows ??
      typedDependency.payloadRows,
  ).filter(Boolean);
  return rows[0] ?? typedDependency.payload ?? null;
}

export function dependencyIdentityPreflightRows(
  context: IdentityPreflightContext | null | undefined,
  curationQueueContext: JsonRecord | null | undefined,
  options: AttachFreshnessOptions = {},
): DependencyPreflightRow[] {
  if (!context || !curationQueueContext) return [];
  const rows: DependencyPreflightRow[] = [];
  const seen = new Set<string>();
  for (const dependency of ensureArray(curationQueueContext.dependency_rows)) {
    const typedDependency = asRecord(dependency);
    const task = asRecord(typedDependency.task);
    const datasetType = asText(task.entity_type);
    const identity = {
      id: asText(task.entity_id),
      version: asText(task.version) || "00.00.001",
    };
    const row = identityPreflightRowForIdentity(context, datasetType, identity);
    if (!row) continue;
    const key = `${row.dataset_type}:${row.dataset_id}@@${row.dataset_version}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({
      relation: "dependency",
      ref: typedDependency.ref ?? null,
      ref_path: typedDependency.ref_path ?? null,
      identity_preflight: attachIdentityPreflightFreshness(
        row,
        dependencyPayloadForFreshness(dependency),
        {
          datasetType,
          identity,
          repoRoot: options.repoRoot,
          classificationDecisionApplyContext: options.classificationDecisionApplyContext,
          locationDecisionApplyContext: options.locationDecisionApplyContext,
          identityDecisionApplyContext: options.identityDecisionApplyContext,
          identityReferenceRewriteContext: options.identityReferenceRewriteContext,
          unresolvedExchangeExternalizationContext:
            options.unresolvedExchangeExternalizationContext,
          sourceContactRewriteContext: options.sourceContactRewriteContext,
          canonicalSupportRewriteContext: options.canonicalSupportRewriteContext,
          cleanupContext: options.cleanupContext,
        },
      ),
    });
  }
  return rows;
}

export function buildIdentityPreflightAuthoringContext({
  context,
  datasetType,
  identity,
  curationQueueContext,
  repoRoot,
  unresolvedExchangeExternalizationContext,
  classificationDecisionApplyContext,
  locationDecisionApplyContext,
  identityDecisionApplyContext,
  identityReferenceRewriteContext,
  sourceContactRewriteContext,
  canonicalSupportRewriteContext,
  cleanupContext,
}: BuildAuthoringContextOptions): IdentityPreflightAuthoringContext | null {
  if (!context) return null;
  const current = attachIdentityPreflightFreshness(
    identityPreflightRowForIdentity(context, datasetType, identity),
    identity.payload,
    {
      datasetType,
      identity,
      repoRoot,
      classificationDecisionApplyContext,
      locationDecisionApplyContext,
      identityDecisionApplyContext,
      identityReferenceRewriteContext,
      unresolvedExchangeExternalizationContext,
      sourceContactRewriteContext,
      canonicalSupportRewriteContext,
      cleanupContext,
    },
  );
  const dependencies = dependencyIdentityPreflightRows(context, curationQueueContext, {
    repoRoot,
    classificationDecisionApplyContext,
    locationDecisionApplyContext,
    identityDecisionApplyContext,
    identityReferenceRewriteContext,
    unresolvedExchangeExternalizationContext,
    sourceContactRewriteContext,
    canonicalSupportRewriteContext,
    cleanupContext,
  });
  return {
    index_file: repoRelativePath(repoRoot, context.indexPath),
    status:
      current?.status === "completed" &&
      dependencies.every((row) => row.identity_preflight?.status === "completed")
        ? "completed"
        : "pending_or_partial",
    current,
    dependencies,
    counts: {
      index_rows: context.rows.length,
      completed: context.completed,
      pending: context.pending,
      dependency_rows: dependencies.length,
    },
    policy:
      "Identity preflight is a read-only database candidate recall and deterministic identity decision artifact. AI may use it as evidence, but database writes still require Foundry finalize and CLI commit handoff gates.",
  };
}

export function identityPreflightGateItems({
  required,
  context,
  authoringContext,
  datasetType,
  identity,
  curationQueueContext,
  profile,
}: IdentityGateOptions): JsonRecord[] {
  if (!required || !["flow", "process"].includes(datasetType)) return [];
  const items: JsonRecord[] = [];
  const baseInstruction =
    "Run dataset-identity-preflight-run for the generated identity-preflight-requests index before AI authoring, then pass the same index to dataset-curation-gate with --identity-preflight-index.";
  if (!context) {
    return [
      {
        source: "identity_preflight",
        code: "identity_preflight_index_required",
        path: null,
        message:
          "Full-context AI authoring requires read-only database identity-preflight request/result context.",
        action_kind: "identity_preflight_required",
        required_owner: "foundry_identity_preflight_run",
        ai_required: false,
        instruction: baseInstruction,
      },
    ];
  }

  const current = authoringContext?.current ?? null;
  const staleInstruction =
    "Regenerate identity-preflight requests from the exact current rows file, rerun dataset-identity-preflight-run, and pass that same fresh index to the curation gate.";
  const sourceContextInstruction =
    "Regenerate identity-preflight requests from the exact current rows file with dataset-identity-preflight-requests-build --source-index <original-full-identity-preflight-requests.jsonl>, rerun dataset-identity-preflight-run, merge the refreshed current rows back into the original full index, and pass that merged index to the curation gate.";
  const requiresSourceContext = identityPreflightSourceContextRequired({
    profile,
    datasetType,
    curationQueueContext,
    context,
  });
  if (!current) {
    items.push({
      source: "identity_preflight",
      code: "identity_preflight_current_result_missing",
      path: null,
      message: "No identity-preflight result is attached for the current entity.",
      action_kind: "identity_preflight_required",
      required_owner: "foundry_identity_preflight_run",
      ai_required: false,
      dataset_type: datasetType,
      dataset_id: identity.id,
      dataset_version: identity.version,
      instruction: baseInstruction,
    });
  } else if (current.status !== "completed") {
    items.push({
      source: "identity_preflight",
      code: "identity_preflight_current_result_pending",
      path: null,
      message: `Current entity identity-preflight status is ${current.status}.`,
      action_kind: "identity_preflight_required",
      required_owner: "foundry_identity_preflight_run",
      ai_required: false,
      dataset_type: datasetType,
      dataset_id: identity.id,
      dataset_version: identity.version,
      instruction: baseInstruction,
    });
  } else if (!identityPreflightFreshnessAccepted(current.freshness)) {
    items.push({
      source: "identity_preflight",
      code: "identity_preflight_current_scope_stale",
      path: null,
      message:
        "Current entity identity-preflight result was generated from a different target payload than the rows file currently being curated.",
      action_kind: "identity_preflight_required",
      required_owner: "foundry_identity_preflight_run",
      ai_required: false,
      dataset_type: datasetType,
      dataset_id: identity.id,
      dataset_version: identity.version,
      instruction: staleInstruction,
      evidence: current.freshness ?? null,
    });
  } else if (requiresSourceContext && !identityPreflightHasSourceContext(current)) {
    items.push({
      source: "identity_preflight",
      code: "identity_preflight_current_source_context_missing",
      path: null,
      message:
        "Current entity identity-preflight was refreshed without source_file trace context, so hybrid search and AI authoring may lose source-package evidence.",
      action_kind: "identity_preflight_required",
      required_owner: "foundry_identity_preflight_run",
      ai_required: false,
      dataset_type: datasetType,
      dataset_id: identity.id,
      dataset_version: identity.version,
      instruction: sourceContextInstruction,
      evidence: {
        remote_search: current.remote_search ?? null,
        request_file: current.request_file ?? null,
      },
    });
  }

  if (datasetType === "process" && curationQueueContext?.status === "attached") {
    const dependencyPreflightRows = ensureArray(authoringContext?.dependencies).map(
      (dependency) => dependency?.identity_preflight,
    );
    const dependencyRows = ensureArray(curationQueueContext.dependency_rows);
    for (const dependency of dependencyRows) {
      const typedDependency = asRecord(dependency);
      const task = asRecord(typedDependency.task);
      const dependencyType = asText(task.entity_type);
      if (!["flow", "process"].includes(dependencyType)) continue;
      const dependencyIdentity = {
        id: asText(task.entity_id),
        version: asText(task.version) || "00.00.001",
      };
      if (!dependencyIdentity.id) continue;
      const dependencyPreflight = identityPreflightRowForIdentity(
        context,
        dependencyType,
        dependencyIdentity,
      );
      const dependencyPreflightWithFreshness =
        dependencyPreflightRows.find(
          (row) =>
            row?.dataset_type === dependencyType &&
            row?.dataset_id === dependencyIdentity.id &&
            row?.dataset_version === dependencyIdentity.version,
        ) ?? dependencyPreflight;
      if (!dependencyPreflight) {
        items.push({
          source: "identity_preflight",
          code: "identity_preflight_dependency_result_missing",
          path: typedDependency.ref_path ?? null,
          message: "No identity-preflight result is attached for a referenced dependency entity.",
          action_kind: "identity_preflight_required",
          required_owner: "foundry_identity_preflight_run",
          ai_required: false,
          dependency_type: dependencyType,
          dependency_id: dependencyIdentity.id,
          dependency_version: dependencyIdentity.version,
          instruction: baseInstruction,
        });
        continue;
      }
      const evaluatedPreflight = dependencyPreflightWithFreshness ?? dependencyPreflight;
      if (evaluatedPreflight.status !== "completed") {
        items.push({
          source: "identity_preflight",
          code: "identity_preflight_dependency_result_pending",
          path: typedDependency.ref_path ?? null,
          message: `Referenced dependency identity-preflight status is ${evaluatedPreflight.status}.`,
          action_kind: "identity_preflight_required",
          required_owner: "foundry_identity_preflight_run",
          ai_required: false,
          dependency_type: dependencyType,
          dependency_id: dependencyIdentity.id,
          dependency_version: dependencyIdentity.version,
          instruction: baseInstruction,
        });
      } else if (
        evaluatedPreflight.freshness &&
        !identityPreflightFreshnessAccepted(evaluatedPreflight.freshness)
      ) {
        items.push({
          source: "identity_preflight",
          code: "identity_preflight_dependency_scope_stale",
          path: typedDependency.ref_path ?? null,
          message:
            "Referenced dependency identity-preflight result was generated from a different dependency payload than the current curation queue context.",
          action_kind: "identity_preflight_required",
          required_owner: "foundry_identity_preflight_run",
          ai_required: false,
          dependency_type: dependencyType,
          dependency_id: dependencyIdentity.id,
          dependency_version: dependencyIdentity.version,
          instruction: staleInstruction,
          evidence: evaluatedPreflight.freshness,
        });
      } else if (requiresSourceContext && !identityPreflightHasSourceContext(evaluatedPreflight)) {
        items.push({
          source: "identity_preflight",
          code: "identity_preflight_dependency_source_context_missing",
          path: typedDependency.ref_path ?? null,
          message:
            "Referenced dependency identity-preflight is missing source_file trace context, so hybrid search and AI authoring may lose source-package evidence.",
          action_kind: "identity_preflight_required",
          required_owner: "foundry_identity_preflight_run",
          ai_required: false,
          dependency_type: dependencyType,
          dependency_id: dependencyIdentity.id,
          dependency_version: dependencyIdentity.version,
          instruction: sourceContextInstruction,
          evidence: {
            remote_search: evaluatedPreflight.remote_search ?? null,
            request_file: evaluatedPreflight.request_file ?? null,
          },
        });
      }
    }
  }
  return items;
}

export function identityPreflightNeedsAiDecision(row: unknown): boolean {
  const result = asRecord(row).result;
  if (!result) return false;
  const typedResult = asRecord(result);
  const status = asText(typedResult.status);
  const decision = asText(typedResult.decision);
  return status === "needs_review" || decision === "manual_review";
}

export function identityPreflightAiDecisionActionItem({
  datasetType,
  identity,
  row,
  relation = "current",
  path = null,
  dependencyType = null,
  dependencyId = null,
  dependencyVersion = null,
}: AiDecisionActionOptions): IdentityDecisionActionItem {
  const typedRow = asRecord(row);
  const result = asRecord(typedRow.result);
  const candidates = ensureArray(result.candidates);
  const resultFlowType = asText(asRecord(asRecord(result.target).fields).type_of_dataset);
  const isElementaryFlow =
    (dependencyType || datasetType) === "flow" &&
    (flowUsesElementaryClassification(identity.payload) || resultFlowType === "Elementary flow");
  return {
    source: "identity_preflight",
    code: isElementaryFlow
      ? "elementary_flow_identity_manual_review"
      : "identity_preflight_manual_review",
    path,
    message: isElementaryFlow
      ? "Elementary flow identity-preflight needs AI review. Elementary flows are reference-only and must select an existing TianGong flow before write planning."
      : "Identity-preflight returned manual_review/needs_review and requires AI to decide whether to reuse an existing database row or continue as a new write candidate.",
    action_kind: "identity_decision_authoring",
    required_owner: "foundry_ai_authoring",
    ai_required: true,
    dataset_type: datasetType,
    dataset_id: identity.id,
    dataset_version: identity.version,
    relation,
    dependency_type: dependencyType,
    dependency_id: dependencyId,
    dependency_version: dependencyVersion,
    common_other_deferral_allowed: false,
    evidence: {
      identity_preflight_status: result.status ?? null,
      identity_preflight_decision: result.decision ?? null,
      confidence: result.confidence ?? null,
      next_action: result.next_action ?? null,
      candidate_count: candidates.length,
      remote_search: typedRow.remote_search ?? null,
      target: result.target ?? null,
      top_candidates: candidates.slice(0, 10),
    },
    instruction: isElementaryFlow
      ? "Use the full schema/YAML/context package plus flow_hybrid_search candidates to choose the existing TianGong elementary flow reference. Do not create or write a BAFU-owned elementary flow. If no candidate is sufficient, return an unresolved identity blocker with the searched query and candidate evidence."
      : "Use the full schema/YAML/context package plus identity-preflight candidates to decide reuse_existing_reference versus create_new. If reusing, output a structured identity reference rewrite with canonical id/version and evidence. If creating new, include evidence explaining why candidates are not identity-equivalent.",
  };
}

export function identityPreflightAuthoringActionItems({
  required,
  authoringContext,
  datasetType,
  identity,
  identityDecisionApplyContext = null,
}: AuthoringActionOptions): IdentityDecisionActionItem[] {
  if (!required || !authoringContext) return [];
  const items: IdentityDecisionActionItem[] = [];
  const current = authoringContext.current;
  if (identityPreflightNeedsAiDecision(current)) {
    const item = identityPreflightAiDecisionActionItem({
      datasetType,
      identity,
      row: current,
    });
    if (
      !identityDecisionApplyContextClosesAction({
        context: identityDecisionApplyContext,
        datasetType,
        id: current?.dataset_id ?? identity.id,
        version: current?.dataset_version ?? identity.version,
        code: item.code,
      })
    ) {
      items.push(item);
    }
  }
  if (datasetType === "process") {
    for (const dependency of ensureArray(authoringContext.dependencies)) {
      const dependencyPreflight = dependency?.identity_preflight;
      if (!identityPreflightNeedsAiDecision(dependencyPreflight)) continue;
      const item = identityPreflightAiDecisionActionItem({
        datasetType,
        identity,
        row: dependencyPreflight,
        relation: "dependency",
        path: dependency?.ref_path ?? null,
        dependencyType: dependencyPreflight?.dataset_type ?? null,
        dependencyId: dependencyPreflight?.dataset_id ?? null,
        dependencyVersion: dependencyPreflight?.dataset_version ?? null,
      });
      if (
        !identityDecisionApplyContextClosesAction({
          context: identityDecisionApplyContext,
          datasetType: dependencyPreflight?.dataset_type ?? null,
          id: dependencyPreflight?.dataset_id ?? null,
          version: dependencyPreflight?.dataset_version ?? null,
          code: item.code,
        })
      ) {
        items.push(item);
      }
    }
  }
  return items;
}

export function comparableText(value: unknown): string {
  return asText(value).replace(/\s+/gu, " ").trim().toLowerCase();
}

export function classificationClassesForPayload(
  payload: unknown,
  datasetType: string,
): JsonRecord[] {
  const root = datasetRoot(payload, datasetType);
  const info = dataSetInformation(root, datasetType);
  const classification = info?.classificationInformation?.["common:classification"] ?? null;
  const classes = classification?.["common:class"] ?? classification?.["common:category"] ?? null;
  return ensureArray(classes).filter(isRecord);
}

export function classificationDisplayForPayload(payload: unknown, datasetType: string): string {
  return classificationClassesForPayload(payload, datasetType)
    .map((item) => asText(item?.["#text"] ?? item?.text ?? item?.label))
    .filter(Boolean)
    .join(" > ");
}

export function textContent(value: unknown): string {
  if (Array.isArray(value)) {
    return value.map(textContent).filter(Boolean).join(" ");
  }
  if (value && typeof value === "object") {
    const record = value as JsonRecord;
    return asText(record["#text"] ?? record.text ?? record.label ?? record.name);
  }
  return asText(value);
}

export function sourcePrewriteIdentityBlockers(
  payload: unknown,
  datasetType: string,
): JsonRecord[] {
  if (datasetType !== "source") return [];
  const root = datasetRoot(payload, "source");
  const info = dataSetInformation(root, "source");
  const shortName = textContent(info?.["common:shortName"] ?? info?.shortName);
  const sourceCitation = textContent(info?.sourceCitation ?? info?.["common:sourceCitation"]);
  const classification = classificationDisplayForPayload(payload, "source");
  const blockers: JsonRecord[] = [];
  if (/^(ILCD format|Not specified|Not declared|Unspecified)$/iu.test(shortName)) {
    blockers.push({
      code: "source_identity_not_true_source",
      stage: "source_semantics",
      message:
        "Source shortName is a format/compliance/placeholder identity, not a true report, publication, or traceable source record.",
      short_name: shortName,
      source_citation: sourceCitation || null,
      classification: classification || null,
    });
  }
  if (/^(ILCD format|Not specified|Not declared|Unspecified)$/iu.test(sourceCitation)) {
    blockers.push({
      code: "source_citation_not_true_source",
      stage: "source_semantics",
      message:
        "Source citation is a format/compliance/placeholder identity, not bibliographic or report evidence.",
      short_name: shortName || null,
      source_citation: sourceCitation,
      classification: classification || null,
    });
  }
  if (/\b(Data set formats|Compliance systems)\b/iu.test(classification)) {
    blockers.push({
      code: "source_classification_not_true_source",
      stage: "source_semantics",
      message:
        "Source classification identifies a data format or compliance system. BAFU-owned source rows must be reports, publications, or traceable source records.",
      short_name: shortName || null,
      source_citation: sourceCitation || null,
      classification,
    });
  }
  return blockers;
}

export function flowPrewriteIdentityBlockers(
  payload: unknown,
  datasetType: string,
  allowAccountLocalSupportAndElementary = false,
): JsonRecord[] {
  if (datasetType !== "flow") return [];
  if (allowAccountLocalSupportAndElementary) return [];
  if (!flowUsesElementaryClassification(payload)) return [];
  const root = datasetRoot(payload, "flow");
  const info = dataSetInformation(root, "flow");
  const name = nameTextForPayload(payload, "flow");
  const classification = classificationEntriesForPayload(payload, "flow")
    .map((entry) => entry.text)
    .filter(Boolean)
    .join(" > ");
  return [
    {
      code: "elementary_flow_write_blocked",
      stage: "flow_identity_reuse_policy",
      message:
        "Elementary flows are reference-only for Foundry imports. Select an existing TianGong database elementary flow and rewrite references instead of writing a BAFU-owned elementary flow.",
      flow_name: name || null,
      flow_type: flowTypeForPayload(payload) || null,
      flow_uuid: asText(info?.["common:UUID"] ?? info?.UUID) || null,
      classification: classification || null,
    },
  ];
}

const defaultPrewriteContentPolicyFile = "specs/prewrite-content-policy.json";

function readPrewriteContentPolicy(repoRoot: string | null): PrewriteContentPolicy | null {
  const policyPath = resolveRepoPath(repoRoot!, defaultPrewriteContentPolicyFile);
  if (!policyPath || !fileExists(policyPath)) return null;
  return {
    path: policyPath,
    relative_path: repoRelativePath(repoRoot!, policyPath),
    value: readJson<JsonRecord>(policyPath),
  };
}

function isFoundryTracePathSegments(pathSegments: string[]): boolean {
  return pathSegments.some((segment) => {
    const text = String(segment).toLowerCase();
    return text === "common:other" || text.startsWith("tiangongfoundry:");
  });
}

function payloadTextLeaves(
  value: unknown,
  pathSegments: string[] = [],
  leaves: TextLeaf[] = [],
): TextLeaf[] {
  if (isFoundryTracePathSegments(pathSegments)) return leaves;
  if (typeof value === "string") {
    leaves.push({
      path: pathSegments.length > 0 ? `/${pathSegments.map(jsonPointerToken).join("/")}` : "/",
      path_segments: pathSegments,
      text: value,
    });
    return leaves;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      payloadTextLeaves(item, [...pathSegments, String(index)], leaves),
    );
    return leaves;
  }
  if (!value || typeof value !== "object") return leaves;
  for (const [key, child] of Object.entries(value)) {
    payloadTextLeaves(child, [...pathSegments, key], leaves);
  }
  return leaves;
}

function normalizedPathSegments(pathSegments: string[]): string[] {
  return pathSegments.map((segment) => String(segment).replace(/^common:/u, ""));
}

function pathScopeMatches(pathSegments: string[], pathScope: unknown = {}): boolean {
  const typedScope = asRecord(pathScope);
  const raw = pathSegments.map(String);
  const normalized = normalizedPathSegments(pathSegments);
  const contains = ensureArray(typedScope.contains).map(String);
  const excludeContains = ensureArray(typedScope.exclude_contains).map(String);
  const hasSegment = (segment: string): boolean =>
    raw.includes(segment) || normalized.includes(segment.replace(/^common:/u, ""));
  if (contains.some((segment) => !hasSegment(segment))) return false;
  if (excludeContains.some((segment) => hasSegment(segment))) return false;
  return true;
}

function compilePolicyPattern(entry: unknown): RegExp | null {
  const typedEntry = asRecord(entry);
  try {
    return new RegExp(asText(typedEntry.pattern), asText(typedEntry.flags) || "u");
  } catch {
    return null;
  }
}

function policyLexiconEntries(policy: JsonRecord, rule: unknown): unknown[] {
  const typedRule = asRecord(rule);
  const lexiconName = asText(typedRule.lexicon);
  if (!lexiconName) return [];
  return ensureArray(asRecord(policy.lexicons)[lexiconName]);
}

export function prewriteContentQualityBlockers({
  repoRoot,
  payload,
  datasetType,
  profile = null,
}: ContentQualityOptions): JsonRecord[] {
  if (!["flow", "process", "lifecyclemodel"].includes(datasetType)) return [];
  const policy = readPrewriteContentPolicy(repoRoot);
  if (!policy) return [];
  const leaves = payloadTextLeaves(payload);
  const blockers: JsonRecord[] = [];
  for (const rule of ensureArray(policy.value.rules)) {
    const typedRule = asRecord(rule);
    const allowedTypes = ensureArray(typedRule.dataset_types).map(asText);
    if (allowedTypes.length > 0 && !allowedTypes.includes(datasetType)) continue;
    const entries = policyLexiconEntries(policy.value, rule);
    for (const leaf of leaves) {
      if (!pathScopeMatches(leaf.path_segments, typedRule.path_scope)) continue;
      for (const entry of entries) {
        const typedEntry = asRecord(entry);
        const pattern = compilePolicyPattern(entry);
        if (!pattern || !pattern.test(leaf.text)) continue;
        // A source naming convention classifies only its trailing metadata match.
        // Other matches, markers and fields still take the normal blocker path.
        const namingRule = asRecord(
          asRecord(asRecord(profile).domainRules).process_name_geography_year,
        );
        const geographySuffix = /\b(Global|EU)\s+(?:19|20)\d{2}(?:\s+v\d+)?$/iu.exec(leaf.text);
        if (
          datasetType === "process" &&
          asRecord(profile).id === "worldsteel" &&
          typedRule.code === "source_locator_in_dataset_name" &&
          typedEntry.id === "latin-author-year" &&
          namingRule.marker === "latin-author-year" &&
          namingRule.field === "baseName" &&
          leaf.path_segments.includes("baseName") &&
          geographySuffix &&
          geographySuffix.index > 0 &&
          ensureArray(namingRule.geographies).some(
            (geo) => asText(geo).toLowerCase() === geographySuffix[1].toLowerCase(),
          )
        ) {
          const matches = [
            ...leaf.text.matchAll(
              new RegExp(pattern.source, `${pattern.flags.replace(/g/gu, "")}g`),
            ),
          ];
          if (matches.length === 1 && matches[0].index === geographySuffix.index) continue;
        }
        blockers.push({
          code: asText(typedRule.code) || "prewrite_content_quality_blocked",
          stage: asText(typedRule.stage) || "prewrite_content_quality",
          message:
            asText(typedRule.message) ||
            "Write payload text violates the configured prewrite content policy.",
          dataset_type: datasetType,
          policy: policy.relative_path,
          rule_id: asText(typedRule.id) || null,
          lexicon: asText(typedRule.lexicon) || null,
          marker_id: asText(typedEntry.id) || null,
          path: leaf.path,
          text: leaf.text,
        });
      }
    }
  }
  return blockers;
}

export function prewriteIdentityBlockers(
  payload: unknown,
  datasetType: string,
  repoRoot: string | null = null,
  { allowAccountLocalSupportAndElementary = false, profile = null }: PrewriteIdentityOptions = {},
): JsonRecord[] {
  return [
    ...sourcePrewriteIdentityBlockers(payload, datasetType),
    ...flowPrewriteIdentityBlockers(payload, datasetType, allowAccountLocalSupportAndElementary),
    ...prewriteContentQualityBlockers({ repoRoot, payload, datasetType, profile }),
  ];
}

export function processClassificationClassesAreCanonical(
  repoRoot: string,
  classes: JsonRecord[],
): boolean {
  const rawCodes = classes.map(classCode).filter(Boolean);
  const leafCode = rawCodes.at(-1);
  const canonical = processCategoryPathForCode(repoRoot, leafCode);
  if (!leafCode || canonical.length === 0) return false;
  const canonicalPrefix = canonical.slice(0, rawCodes.length);
  if (rawCodes.join("/") !== canonicalPrefix.map((entry) => entry.code).join("/")) {
    return false;
  }
  return classes.every((item, index) => {
    const expected = canonicalPrefix[index];
    if (!expected) return false;
    const level = classLevel(item);
    const text = classText(item);
    return (level === null || level === expected.level) && (!text || text === expected.text);
  });
}

export function classificationQueueRowStillNeedsAuthoring({
  repoRoot,
  datasetType = "process",
  payload,
  row,
}: QueueAuthoringOptions): boolean {
  const typedRow = asRecord(row);
  const expectedDisplay = comparableText(typedRow.current_classification);
  if (!expectedDisplay) return true;
  const currentDisplay = comparableText(classificationDisplayForPayload(payload, datasetType));
  if (!currentDisplay) return true;
  if (currentDisplay === expectedDisplay) return true;
  if (
    datasetType === "process" &&
    !processClassificationClassesAreCanonical(
      repoRoot,
      classificationClassesForPayload(payload, datasetType),
    )
  ) {
    return true;
  }
  return false;
}

export function valueAtDotPath(value: unknown, dotPath: unknown): unknown {
  const parts = asText(dotPath).split(".").filter(Boolean);
  let current = value;
  for (const part of parts) {
    if (Array.isArray(current)) {
      const index = Number(part);
      if (!Number.isInteger(index)) return undefined;
      current = current[index];
      continue;
    }
    if (!current || typeof current !== "object") return undefined;
    current = (current as JsonRecord)[part];
  }
  return current;
}

export function locationQueueRowStillNeedsAuthoring({
  repoRoot,
  payload,
  row,
}: QueueAuthoringOptions): boolean {
  const typedRow = asRecord(row);
  const targetPath = asText(typedRow.target_path ?? typedRow.path);
  if (!targetPath) return true;
  const currentLocation = asText(valueAtDotPath(payload, targetPath));
  if (!currentLocation) return true;
  const queuedLocation = asText(typedRow.current_location ?? typedRow.location);
  if (!locationCodeMapForPatch(repoRoot).has(currentLocation)) return true;
  if (queuedLocation && currentLocation === queuedLocation) return true;
  return false;
}

export function classificationQueueActionItem(row: unknown): QueueActionItem {
  const typedRow = asRecord(row);
  const datasetType = asText(typedRow.dataset_type) || "process";
  const classificationPath =
    datasetType === "flow"
      ? "flowDataSet.flowInformation.dataSetInformation.classificationInformation.common:classification"
      : "processDataSet.processInformation.dataSetInformation.classificationInformation.common:classification";
  return {
    source: "classification_authoring_queue",
    code: asText(typedRow.code) || "process_classification_requires_authoring",
    path: classificationPath,
    message:
      asText(typedRow.message) ||
      "Converted classification requires AI authoring before remote write.",
    evidence: {
      current_classification: typedRow.current_classification ?? null,
      source_classification: typedRow.source_classification ?? null,
      authoring_context: typedRow.authoring_context ?? null,
      source_file: typedRow.source_file ?? null,
      classification_workflow: typedRow.classification_workflow ?? null,
    },
    instruction:
      asText(typedRow.required_resolution) ||
      "Use the full schema/YAML/context package and TIDAS classification workflow to choose the target classification. Preserve source classification only as provenance.",
    action_kind: "classification_decision_authoring",
    required_owner: "foundry_ai_authoring",
    ai_required: true,
    common_other_deferral_allowed: false,
  };
}

export function locationQueueActionItem(row: unknown): QueueActionItem {
  const typedRow = asRecord(row);
  return {
    source: "location_authoring_queue",
    code: asText(typedRow.code) || "location_code_requires_authoring",
    path: asText(typedRow.target_path ?? typedRow.path) || null,
    message:
      asText(typedRow.message) ||
      "Location value must be replaced with a valid TIDAS location code before remote write.",
    evidence: {
      current_location: typedRow.current_location ?? typedRow.location ?? null,
      target_path: typedRow.target_path ?? typedRow.path ?? null,
      location_workflow: typedRow.location_workflow ?? null,
      source_file: typedRow.source_file ?? null,
    },
    instruction:
      asText(typedRow.required_resolution) ||
      "Use the full schema/YAML/context package and TIDAS location classification workflow to choose the target location code.",
    action_kind: "location_decision_authoring",
    required_owner: "foundry_ai_authoring",
    ai_required: true,
    common_other_deferral_allowed: false,
  };
}

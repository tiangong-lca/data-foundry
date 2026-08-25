import path from "node:path";
import { datasetIdentity, identityKey } from "./dataset-payload.ts";
import {
  normalizeClassificationDecisionRows,
  payloadSha256ByIdentityForRows,
  readAuthoringPackageProof,
} from "./full-context-proof.ts";
import {
  asText,
  ensureArray,
  fileExists,
  optionList,
  readJsonOrJsonl,
  resolveRepoPath,
  unique,
} from "./runtime-io.ts";
import { readJsonLines } from "./workflow-patch-collect.ts";

interface JsonRecord {
  [key: string]: unknown;
}

interface IdentityRecord {
  id: string;
  version: string;
}

interface DecisionRecord extends JsonRecord {
  decision_status?: unknown;
  decisionStatus?: unknown;
  status?: unknown;
  dataset_type?: unknown;
  datasetType?: unknown;
  kind?: unknown;
  entity_type?: unknown;
  entityType?: unknown;
  dataset_id?: unknown;
  datasetId?: unknown;
  entity_id?: unknown;
  entityId?: unknown;
  flow_id?: unknown;
  flowId?: unknown;
  dataset_version?: unknown;
  datasetVersion?: unknown;
  version?: unknown;
  closes_action_items?: unknown;
  closesActionItems?: unknown;
  identity_decision?: unknown;
  identityDecision?: unknown;
  decision?: unknown;
  resolution?: unknown;
  canonical?: unknown;
  selected_reference?: unknown;
  selectedReference?: unknown;
  authoring_package?: unknown;
  authoringPackage?: unknown;
  authoring_context?: unknown;
  authoringContext?: unknown;
  authoring_package_sha256?: unknown;
  authoringPackageSha256?: unknown;
}

interface IdentityReferenceRewriteOptions extends JsonRecord {
  identityReferenceRewrites?: unknown;
  identityReferenceRewritesFile?: unknown;
  identityFlowReferenceRewrites?: unknown;
  identityFlowReferenceRewritesFile?: unknown;
  identityReferenceRewriteStatus?: unknown;
  identityReferenceRewritesStatus?: unknown;
  identityReferenceRewriteInputRows?: unknown;
  identityReferenceRewriteInputRowsFile?: unknown;
  identityReferenceRewriteOutputRows?: unknown;
  identityReferenceRewriteOutputRowsFile?: unknown;
}

interface WriteRowEntry {
  identity: IdentityRecord;
}

interface ReadIdentityReferenceRewriteContextOptions {
  repoRoot: string;
  rowsFile: unknown;
  options: IdentityReferenceRewriteOptions;
  writeRows: Map<unknown, WriteRowEntry>;
  referenceRows?: unknown;
  datasetType?: string | null;
}

export interface NormalizedIdentityReferenceRewriteRow extends JsonRecord {
  dataset_type: string | null;
  dataset_id: string;
  dataset_version: string;
  relation: string;
  path: string | null;
  action: string;
  reason: string | null;
  original: unknown;
  canonical: unknown;
  evidence: JsonRecord;
}

export interface IdentityReferenceRewriteContext {
  sourceFile: string | null;
  sourceRows: unknown[];
  scopedRows: NormalizedIdentityReferenceRewriteRow[];
  byIdentity: Map<string, NormalizedIdentityReferenceRewriteRow[]>;
  status: string;
  inputRowsFile: string | null;
  outputRowsFile: string | null;
  inputPayloadSha256ByIdentity: Map<string, string>;
  outputPayloadSha256ByIdentity: Map<string, string>;
}

interface IdentityDecisionFiles extends JsonRecord {
  decisions?: unknown;
  evidence?: unknown;
  input_rows?: unknown;
  output_rows?: unknown;
  reference_rows?: unknown;
  identity_reference_rewrites?: unknown;
}

interface IdentityDecisionReport extends JsonRecord {
  status?: unknown;
  decisions_file?: unknown;
  decisionsFile?: unknown;
  decisions?: unknown;
  dataset_type?: unknown;
  rows_file?: unknown;
  rowsFile?: unknown;
  files?: unknown;
}

interface ArtifactEnvelope {
  path?: unknown;
  value?: unknown;
}

export interface IdentityDecisionApplyContext extends JsonRecord {
  status: string;
  reportPath: unknown;
  reportPaths?: unknown[];
  decisionsFile: string | null;
  decisions: DecisionRecord[];
  byIdentity: Map<string, DecisionRecord[]>;
  authoringPackageProofs: unknown[];
  inputRows: string[];
  outputRows: string[];
  inputPayloadSha256ByIdentity?: Map<string, string>;
  outputPayloadSha256ByIdentity?: Map<string, string>;
  referenceRows: string[];
  identityReferenceRewritesFile: string | null;
  identityReferenceRewritesFiles?: string[];
}

export interface ReadIdentityDecisionApplyContext extends IdentityDecisionApplyContext {
  inputPayloadSha256ByIdentity: Map<string, string>;
  outputPayloadSha256ByIdentity: Map<string, string>;
}

interface IdentityParts {
  datasetType: unknown;
  id: unknown;
  version: unknown;
}

interface IdentityContextLookup extends IdentityParts {
  context: unknown;
}

interface IdentityContextClosesAction extends IdentityContextLookup {
  code: string;
}

interface IdentityContextHasDecision extends IdentityContextLookup {
  decisionValue: string;
  closesAction?: string | null;
}

function identityDecisionCompletionStatus(decision: unknown): string {
  const record = decision as DecisionRecord | null | undefined;
  return asText(record?.decision_status ?? record?.decisionStatus ?? record?.status);
}

function referenceKey({ table, id, version }: JsonRecord): string {
  return [asText(table), asText(id), asText(version)].join("\u0000");
}

export function defaultIdentityReferenceRewriteFile(rowsFile: unknown): string | null {
  const rowsDir = path.dirname(rowsFile as string);
  const candidates = [
    path.join(rowsDir, "identity-reference-rewrites.jsonl"),
    path.join(rowsDir, "identity-flow-reference-rewrites.jsonl"),
    path.join(path.dirname(rowsDir), "identity-reference-rewrites.jsonl"),
    path.join(path.dirname(rowsDir), "identity-flow-reference-rewrites.jsonl"),
  ];
  return candidates.find((candidate) => fileExists(candidate)) ?? null;
}

export function normalizeIdentityReferenceRewriteRow(
  row: unknown,
): NormalizedIdentityReferenceRewriteRow {
  const record = row as JsonRecord | null | undefined;
  const canonical = record?.canonical ?? record?.target ?? record?.replacement ?? null;
  const original = record?.original ?? record?.source ?? null;
  const normalized = {
    ...(row as JsonRecord),
    dataset_type: asText(record?.dataset_type ?? record?.datasetType) || null,
    dataset_id: asText(record?.dataset_id ?? record?.datasetId ?? record?.entity_id),
    dataset_version:
      asText(record?.dataset_version ?? record?.datasetVersion ?? record?.version) || "00.00.001",
    relation: asText(record?.relation) || "flow_reference_to_identity_preflight_duplicate",
    path: asText(record?.path) || null,
    action: asText(record?.action) || "rewrite_to_identity_preflight_duplicate_reference",
    reason: asText(record?.reason) || null,
    original,
    canonical,
  } as NormalizedIdentityReferenceRewriteRow;
  normalized.evidence = {
    source: "identity-reference-rewrites.jsonl",
    identity_preflight: record?.identity_preflight ?? null,
    original,
    canonical,
    reason: normalized.reason,
  };
  return normalized;
}

export function readIdentityReferenceRewriteContext({
  repoRoot,
  rowsFile,
  options,
  writeRows,
  referenceRows = [],
  datasetType = null,
}: ReadIdentityReferenceRewriteContextOptions): IdentityReferenceRewriteContext {
  const configuredFile = resolveRepoPath(
    repoRoot,
    (options.identityReferenceRewrites ??
      options.identityReferenceRewritesFile ??
      options.identityFlowReferenceRewrites ??
      options.identityFlowReferenceRewritesFile) as string | null | undefined,
  );
  const sourceFile =
    configuredFile && fileExists(configuredFile)
      ? configuredFile
      : defaultIdentityReferenceRewriteFile(rowsFile);
  const sourceRows = sourceFile ? readJsonLines(sourceFile) : [];
  const scopeIdentities = [
    ...[...writeRows.values()].map(({ identity }) => identity),
    ...ensureArray(referenceRows).map((row, index) =>
      datasetIdentity(row, index, datasetType as string),
    ),
  ];
  const writeKeys = new Set(scopeIdentities.map(identityKey));
  const writeIds = new Set(scopeIdentities.map((identity) => identity.id).filter(Boolean));
  const scopedRows = sourceRows.map(normalizeIdentityReferenceRewriteRow).filter((row) => {
    if (!row.dataset_id) return false;
    const key = `${row.dataset_id}@@${row.dataset_version || "00.00.001"}`;
    return writeKeys.has(key) || writeIds.has(row.dataset_id);
  });
  const byIdentity = new Map<string, NormalizedIdentityReferenceRewriteRow[]>();
  for (const row of scopedRows) {
    const key = `${row.dataset_id}@@${row.dataset_version || "00.00.001"}`;
    if (!byIdentity.has(key)) byIdentity.set(key, []);
    byIdentity.get(key)!.push(row);
    if (!byIdentity.has(row.dataset_id)) byIdentity.set(row.dataset_id, []);
    byIdentity.get(row.dataset_id)!.push(row);
  }
  return {
    sourceFile,
    sourceRows,
    scopedRows,
    byIdentity,
    status: asText(
      options.identityReferenceRewriteStatus ?? options.identityReferenceRewritesStatus,
    ),
    inputRowsFile: resolveRepoPath(
      repoRoot,
      (options.identityReferenceRewriteInputRows ??
        options.identityReferenceRewriteInputRowsFile) as string | null | undefined,
    ),
    outputRowsFile: resolveRepoPath(
      repoRoot,
      (options.identityReferenceRewriteOutputRows ??
        options.identityReferenceRewriteOutputRowsFile) as string | null | undefined,
    ),
    inputPayloadSha256ByIdentity: payloadSha256ByIdentityForRows(
      repoRoot,
      options.identityReferenceRewriteInputRows || options.identityReferenceRewriteInputRowsFile
        ? [
            options.identityReferenceRewriteInputRows ??
              options.identityReferenceRewriteInputRowsFile,
          ]
        : [],
      datasetType,
    ),
    outputPayloadSha256ByIdentity: payloadSha256ByIdentityForRows(
      repoRoot,
      options.identityReferenceRewriteOutputRows || options.identityReferenceRewriteOutputRowsFile
        ? [
            options.identityReferenceRewriteOutputRows ??
              options.identityReferenceRewriteOutputRowsFile,
          ]
        : [],
      datasetType,
    ),
  };
}

export function identityDecisionDatasetType(decision: unknown): string {
  const record = decision as DecisionRecord | null | undefined;
  return asText(
    record?.dataset_type ??
      record?.datasetType ??
      record?.kind ??
      record?.entity_type ??
      record?.entityType,
  );
}

export function identityDecisionDatasetId(decision: unknown): string {
  const record = decision as DecisionRecord | null | undefined;
  return asText(
    record?.dataset_id ??
      record?.datasetId ??
      record?.entity_id ??
      record?.entityId ??
      record?.flow_id ??
      record?.flowId,
  );
}

export function identityDecisionDatasetVersion(decision: unknown): string {
  const record = decision as DecisionRecord | null | undefined;
  return (
    asText(record?.dataset_version ?? record?.datasetVersion ?? record?.version) || "00.00.001"
  );
}

export function identityDecisionIdentityKeys({
  datasetType,
  id,
  version,
}: IdentityParts): string[] {
  const normalizedType = asText(datasetType);
  const normalizedId = asText(id);
  const normalizedVersion = asText(version) || "00.00.001";
  if (!normalizedId) return [];
  return [
    `${normalizedType}:${normalizedId}@@${normalizedVersion}`,
    `${normalizedType}:${normalizedId}`,
    `${normalizedId}@@${normalizedVersion}`,
    normalizedId,
  ].filter(Boolean);
}

export function identityDecisionClosesAction(decision: unknown, code: string): boolean {
  const record = decision as DecisionRecord | null | undefined;
  const resolution = record?.resolution as JsonRecord | null | undefined;
  return optionList(
    record?.closes_action_items ?? record?.closesActionItems ?? resolution?.closes_action_items,
  ).includes(code);
}

export function identityDecisionValue(decision: unknown): string {
  const record = decision as DecisionRecord | null | undefined;
  const resolution = record?.resolution as JsonRecord | null | undefined;
  const raw = asText(
    record?.identity_decision ??
      record?.identityDecision ??
      record?.decision ??
      resolution?.identity_decision ??
      resolution?.decision,
  );
  if (["reuse", "reuse_existing", "reference_reuse"].includes(raw)) {
    return "reuse_existing_reference";
  }
  if (["new", "insert", "write_new"].includes(raw)) return "create_new";
  if (["block", "blocked", "unresolved"].includes(raw)) return "block_unresolved";
  return raw;
}

export function identityDecisionCanonical(decision: unknown): JsonRecord | null {
  const record = decision as DecisionRecord | null | undefined;
  const resolution = record?.resolution as JsonRecord | null | undefined;
  const canonical =
    record?.canonical ??
    record?.selected_reference ??
    record?.selectedReference ??
    resolution?.canonical ??
    resolution?.selected_reference ??
    null;
  if (!canonical || typeof canonical !== "object") return null;
  const canonicalRecord = canonical as JsonRecord;
  const id = asText(
    canonicalRecord.ref_object_id ??
      canonicalRecord.refObjectId ??
      canonicalRecord.id ??
      canonicalRecord["@refObjectId"],
  );
  if (!id) return null;
  return {
    table: asText(canonicalRecord.table) || "flows",
    ref_object_id: id,
    version:
      asText(
        canonicalRecord.version ?? canonicalRecord.ref_version ?? canonicalRecord["@version"],
      ) || "00.00.001",
  };
}

export function identityDecisionPackageReference(decision: unknown): string {
  const record = decision as DecisionRecord | null | undefined;
  const authoringContext = record?.authoring_context as JsonRecord | null | undefined;
  const camelContext = record?.authoringContext as JsonRecord | null | undefined;
  return asText(
    record?.authoring_package ??
      record?.authoringPackage ??
      authoringContext?.authoring_package ??
      camelContext?.authoringPackage,
  );
}

export function identityDecisionPackageSha(decision: unknown): string {
  const record = decision as DecisionRecord | null | undefined;
  const authoringContext = record?.authoring_context as JsonRecord | null | undefined;
  const camelContext = record?.authoringContext as JsonRecord | null | undefined;
  return asText(
    record?.authoring_package_sha256 ??
      record?.authoringPackageSha256 ??
      authoringContext?.authoring_package_sha256 ??
      camelContext?.authoringPackageSha256,
  );
}

export function readIdentityDecisionApplyContext(
  repoRoot: string,
  identityDecisionApplyArtifact: ArtifactEnvelope | null | undefined,
): ReadIdentityDecisionApplyContext | null {
  if (!identityDecisionApplyArtifact) return null;
  const report = (identityDecisionApplyArtifact.value ?? {}) as IdentityDecisionReport;
  const files = report.files as IdentityDecisionFiles | null | undefined;
  const decisionsFile = resolveRepoPath(
    repoRoot,
    (report.decisions_file || report.decisionsFile || files?.decisions || files?.evidence) as
      string | null | undefined,
  );
  let decisions: DecisionRecord[] = [];
  if (decisionsFile && fileExists(decisionsFile)) {
    decisions = normalizeClassificationDecisionRows(
      readJsonOrJsonl(decisionsFile),
    ) as DecisionRecord[];
  }
  if (decisions.length === 0) {
    decisions = normalizeClassificationDecisionRows(report.decisions) as DecisionRecord[];
  }
  const byIdentity = new Map<string, DecisionRecord[]>();
  for (const decision of decisions) {
    const datasetType = identityDecisionDatasetType(decision) || asText(report.dataset_type);
    const id = identityDecisionDatasetId(decision);
    const version = identityDecisionDatasetVersion(decision);
    for (const key of identityDecisionIdentityKeys({ datasetType, id, version })) {
      if (!byIdentity.has(key)) byIdentity.set(key, []);
      byIdentity.get(key)!.push(decision);
    }
  }
  const packageProofs: unknown[] = [];
  const seenPackages = new Set<string>();
  for (const decision of decisions) {
    const packageRef = identityDecisionPackageReference(decision);
    if (!packageRef) continue;
    const packageKey = `${packageRef}\u0000${identityDecisionPackageSha(decision)}`;
    if (seenPackages.has(packageKey)) continue;
    seenPackages.add(packageKey);
    packageProofs.push(
      readAuthoringPackageProof(
        repoRoot,
        packageRef,
        identityDecisionPackageSha(decision),
        "identity_decision_apply",
      ),
    );
  }
  const inputRows = ensureArray(report.rows_file ?? report.rowsFile ?? files?.input_rows)
    .map((filePath) => resolveRepoPath(repoRoot, filePath as string | null | undefined))
    .filter(Boolean) as string[];
  const outputRows = ensureArray(files?.output_rows)
    .map((filePath) => resolveRepoPath(repoRoot, filePath as string | null | undefined))
    .filter(Boolean) as string[];
  const fallbackDatasetType = asText(report.dataset_type) || null;
  return {
    status: asText(report.status),
    reportPath: identityDecisionApplyArtifact.path,
    decisionsFile,
    decisions,
    byIdentity,
    authoringPackageProofs: packageProofs,
    inputRows,
    outputRows,
    inputPayloadSha256ByIdentity: payloadSha256ByIdentityForRows(
      repoRoot,
      inputRows,
      fallbackDatasetType,
    ),
    outputPayloadSha256ByIdentity: payloadSha256ByIdentityForRows(
      repoRoot,
      outputRows,
      fallbackDatasetType,
    ),
    referenceRows: ensureArray(files?.reference_rows)
      .map((filePath) => resolveRepoPath(repoRoot, filePath as string | null | undefined))
      .filter(Boolean) as string[],
    identityReferenceRewritesFile: resolveRepoPath(
      repoRoot,
      files?.identity_reference_rewrites as string | null | undefined,
    ),
  };
}

export function mergeIdentityDecisionApplyContexts(
  contexts: unknown,
): IdentityDecisionApplyContext | null {
  const available = ensureArray(contexts).filter(Boolean) as IdentityDecisionApplyContext[];
  if (available.length === 0) return null;
  if (available.length === 1) return available[0];

  const byIdentity = new Map<string, DecisionRecord[]>();
  const decisions: DecisionRecord[] = [];
  const authoringPackageProofs: unknown[] = [];
  const inputRows: string[] = [];
  const outputRows: string[] = [];
  const referenceRows: string[] = [];
  const identityReferenceRewritesFiles: string[] = [];
  const reportPaths: unknown[] = [];
  const seenPackages = new Set<string>();
  for (const context of available) {
    reportPaths.push(context.reportPath);
    decisions.push(...ensureArray(context.decisions));
    inputRows.push(...ensureArray(context.inputRows));
    outputRows.push(...ensureArray(context.outputRows));
    referenceRows.push(...ensureArray(context.referenceRows));
    for (const filePath of ensureArray(context.identityReferenceRewritesFiles)) {
      if (filePath) identityReferenceRewritesFiles.push(filePath);
    }
    if (context.identityReferenceRewritesFile) {
      identityReferenceRewritesFiles.push(context.identityReferenceRewritesFile);
    }
    for (const [key, rows] of context.byIdentity.entries()) {
      if (!byIdentity.has(key)) byIdentity.set(key, []);
      byIdentity.get(key)!.push(...rows);
    }
    for (const proof of ensureArray(context.authoringPackageProofs)) {
      const proofRecord = proof as JsonRecord | null | undefined;
      const key = JSON.stringify({
        package: proofRecord?.authoring_package ?? proofRecord?.path ?? proofRecord?.package_ref,
        expected: proofRecord?.expected_sha256,
        actual: proofRecord?.actual_sha256,
      });
      if (seenPackages.has(key)) continue;
      seenPackages.add(key);
      authoringPackageProofs.push(proof);
    }
  }
  const uniqueIdentityRewriteFiles = unique(identityReferenceRewritesFiles);
  return {
    status: available.every((context) => context.status === "completed") ? "completed" : "mixed",
    reportPath: reportPaths[0],
    reportPaths,
    decisionsFile: null,
    decisions,
    byIdentity,
    authoringPackageProofs,
    inputRows: unique(inputRows),
    outputRows: unique(outputRows),
    referenceRows: unique(referenceRows),
    identityReferenceRewritesFile: uniqueIdentityRewriteFiles[0] ?? null,
    identityReferenceRewritesFiles: uniqueIdentityRewriteFiles,
  };
}

export function readIdentityDecisionApplyContexts(
  repoRoot: string,
  artifacts: unknown,
): IdentityDecisionApplyContext | null {
  const artifactList = ensureArray(artifacts).filter(Boolean) as ArtifactEnvelope[];
  if (artifactList.length === 0) return null;
  return mergeIdentityDecisionApplyContexts(
    artifactList.map((artifact) => readIdentityDecisionApplyContext(repoRoot, artifact)),
  );
}

export function identityDecisionApplyContextDecisionsForIdentity({
  context,
  datasetType,
  id,
  version,
}: IdentityContextLookup): DecisionRecord[] {
  const typedContext = context as { byIdentity: Map<string, DecisionRecord[]> } | null | undefined;
  if (!typedContext) return [];
  for (const key of identityDecisionIdentityKeys({ datasetType, id, version })) {
    const rows = typedContext.byIdentity.get(key);
    if (rows?.length) return rows;
  }
  return [];
}

export function identityDecisionApplyContextClosesAction({
  context,
  datasetType,
  id,
  version,
  code,
}: IdentityContextClosesAction): boolean {
  return identityDecisionApplyContextDecisionsForIdentity({
    context,
    datasetType,
    id,
    version,
  }).some(
    (decision) =>
      identityDecisionCompletionStatus(decision) === "completed" &&
      identityDecisionClosesAction(decision, code),
  );
}

export function identityDecisionApplyContextHasDecision({
  context,
  datasetType,
  id,
  version,
  decisionValue,
  closesAction,
}: IdentityContextHasDecision): boolean {
  return identityDecisionApplyContextDecisionsForIdentity({
    context,
    datasetType,
    id,
    version,
  }).some(
    (decision) =>
      identityDecisionCompletionStatus(decision) === "completed" &&
      identityDecisionValue(decision) === decisionValue &&
      (!closesAction || identityDecisionClosesAction(decision, closesAction)),
  );
}

export function identityDecisionUnresolvedReferenceKeys(context: unknown): Set<string> {
  const typedContext = context as IdentityDecisionApplyContext | null | undefined;
  const keys = new Set<string>();
  for (const decision of ensureArray(typedContext?.decisions)) {
    const datasetType = identityDecisionDatasetType(decision) || asText(decision?.dataset_type);
    if (datasetType !== "flow") continue;
    if (identityDecisionValue(decision) !== "block_unresolved") continue;
    if (!identityDecisionClosesAction(decision, "elementary_flow_identity_manual_review")) {
      continue;
    }
    const id = identityDecisionDatasetId(decision);
    if (!id) continue;
    keys.add(
      referenceKey({
        table: "flows",
        id,
        version: identityDecisionDatasetVersion(decision),
      }),
    );
  }
  return keys;
}

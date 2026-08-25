import { readJsonLinesIfExists } from "./artifact-inputs.ts";
import { datasetIdentity, identityFreshnessIdentityKey } from "./dataset-payload.ts";
import { payloadSha256ByIdentityForRows } from "./full-context-proof.ts";
import { sha256Json, sha256Text } from "./hash-utils.ts";
import {
  asText,
  ensureArray,
  fileExists,
  normalizedArtifactPath,
  readText,
  repoRelativeArtifactPath,
  repoRelativePath,
  resolveRepoPath,
  sameArtifactPath,
} from "./runtime-io.ts";
import { readRowsIfExists } from "./workflow-patch-collect.ts";

interface JsonRecord {
  [key: string]: unknown;
}

interface ArtifactEnvelope {
  path?: unknown;
  value?: unknown;
}

interface ReportFiles extends JsonRecord {
  input_rows?: unknown;
  inputRows?: unknown;
  input?: unknown;
  output_rows?: unknown;
  outputRows?: unknown;
  output?: unknown;
  cleaned_rows?: unknown;
  cleanedRows?: unknown;
  traces?: unknown;
  unresolved_exchanges?: unknown;
  canonical_support_blockers?: unknown;
  blockers?: unknown;
  deferred_rows?: unknown;
  deferredRows?: unknown;
  canonical_support_rewrites?: unknown;
  rewrites?: unknown;
}

interface TransformReport extends JsonRecord {
  status?: unknown;
  counts?: unknown;
  files?: unknown;
  proofs?: unknown;
  input_rows_file?: unknown;
  inputRowsFile?: unknown;
  output_rows_file?: unknown;
  outputRowsFile?: unknown;
  traces_file?: unknown;
  tracesFile?: unknown;
  rows_file?: unknown;
  rowsFile?: unknown;
  input_path?: unknown;
  inputPath?: unknown;
  out_path?: unknown;
  outPath?: unknown;
  blockers_file?: unknown;
  deferred_rows_file?: unknown;
  deferredRowsFile?: unknown;
  rewrites_file?: unknown;
  blockers?: unknown;
  deferred_blockers?: unknown;
  source_exchange_completeness_proofs?: unknown;
}

interface TransformTrace extends JsonRecord {
  dataset_id?: unknown;
  entity_id?: unknown;
  dataset_version?: unknown;
  version?: unknown;
}

interface TransformContextLike {
  kind?: unknown;
  status?: unknown;
  inputRowsFile?: string | null;
  outputRowsFile?: string | null;
  inputRows?: string[];
  outputRows?: string[];
  inputPayloadSha256ByIdentity?: Map<string, string>;
  outputPayloadSha256ByIdentity?: Map<string, string>;
}

export interface RowsFileTransformContext extends TransformContextLike {
  kind: unknown;
  artifact: ArtifactEnvelope;
  status: string;
  counts: JsonRecord;
  sourceExchangeCompletenessProofs: unknown[];
  inputRowsFile: string | null;
  outputRowsFile: string | null;
  inputRowsFileRelative: string | null;
  outputRowsFileRelative: string | null;
  reportPathRelative: string;
  inputPayloadSha256ByIdentity: Map<string, string>;
  outputPayloadSha256ByIdentity: Map<string, string>;
}

export interface UnresolvedExchangeExternalizationContext extends TransformContextLike {
  artifact: ArtifactEnvelope;
  status: string;
  inputRowsFile: string | null;
  outputRowsFile: string | null;
  tracesFile: string | null;
  inputRowsFileRelative: string | null;
  outputRowsFileRelative: string | null;
  tracesFileRelative: string | null;
  reportPathRelative: string;
  externalizedExchanges: number;
  affectedRows: number;
  traces: unknown[];
  affectedKeys: Set<string>;
  externalizedExchangeCountByIdentity: Map<string, number>;
  inputPayloadSha256ByIdentity: Map<string, string>;
  outputPayloadSha256ByIdentity: Map<string, string>;
}

export interface CanonicalSupportRewriteContext extends TransformContextLike {
  artifact: ArtifactEnvelope;
  status: string;
  counts: JsonRecord;
  inputRowsFile: string | null;
  outputRowsFile: string | null;
  deferredRowsFile: string | null;
  inputPayloadSha256ByIdentity: Map<string, string>;
  outputPayloadSha256ByIdentity: Map<string, string>;
  inputRowsFileRelative: string | null;
  outputRowsFileRelative: string | null;
  deferredRowsFileRelative: string | null;
  reportPathRelative: string;
  blockersFileRelative: string | null;
  rewritesFileRelative: string | null;
  blockerRows: unknown[];
  blockers: unknown[];
  deferredBlockers: unknown[];
  rewrites: unknown[];
}

export interface RowsFileTransformEntry extends JsonRecord {
  kind?: unknown;
  inputRowsFile: string;
  outputRowsFile: string;
  inputPayloadSha256ByIdentity?: Map<string, string>;
  outputPayloadSha256ByIdentity?: Map<string, string>;
}

interface UnresolvedChainOptions {
  repoRoot: string;
  upstreamFile: unknown;
  finalFile: unknown;
  unresolvedExchangeExternalizationContext: TransformContextLike | null | undefined;
}

interface ExpectedRowsOptions {
  repoRoot: string;
  rowsFile: unknown;
  cleanupArtifact: ArtifactEnvelope | null | undefined;
}

interface DeterministicTransformContexts {
  patchApplyContext?: TransformContextLike | null;
  classificationDecisionApplyContext?: TransformContextLike | null;
  locationDecisionApplyContext?: TransformContextLike | null;
  identityDecisionApplyContext?: TransformContextLike | null;
  identityReferenceRewriteContext?: TransformContextLike | null;
  unresolvedExchangeExternalizationContext?: TransformContextLike | null;
  sourceContactRewriteContext?: TransformContextLike | null;
  canonicalSupportRewriteContext?: TransformContextLike | null;
  cleanupContext?: TransformContextLike | null;
}

interface TransformReachabilityOptions {
  repoRoot: string;
  startFiles: unknown;
  expectedRowsFile: unknown;
  transforms: RowsFileTransformEntry[];
}

interface DecisionTransformReachabilityOptions extends DeterministicTransformContexts {
  repoRoot: string;
  context: TransformContextLike | null | undefined;
  expectedRowsFile: unknown;
}

interface IdentityChainOptions {
  repoRoot: string;
  patchOut: unknown;
  cleanupInput: unknown;
  identityReferenceRewriteContext?: TransformContextLike | null;
}

interface UnresolvedPatchChainOptions {
  repoRoot: string;
  patchOut: unknown;
  cleanupInput: unknown;
  unresolvedExchangeExternalizationContext?: TransformContextLike | null;
}

interface CombinedPatchChainOptions extends IdentityChainOptions {
  unresolvedExchangeExternalizationContext?: TransformContextLike | null;
}

export function readUnresolvedExchangeExternalizationContext(
  repoRoot: string,
  artifact: ArtifactEnvelope | null | undefined,
): UnresolvedExchangeExternalizationContext | null {
  if (!artifact) return null;
  const report = (artifact.value ?? {}) as TransformReport;
  const files = report.files as ReportFiles | null | undefined;
  const counts = report.counts as JsonRecord | null | undefined;
  const inputRowsFile = resolveRepoPath(
    repoRoot,
    (report.input_rows_file ?? report.inputRowsFile ?? files?.input_rows ?? files?.inputRows) as
      string | null | undefined,
  );
  const outputRowsFile = resolveRepoPath(
    repoRoot,
    (report.output_rows_file ??
      report.outputRowsFile ??
      files?.output_rows ??
      files?.outputRows) as string | null | undefined,
  );
  const tracesFile = resolveRepoPath(
    repoRoot,
    (report.traces_file ?? report.tracesFile ?? files?.traces ?? files?.unresolved_exchanges) as
      string | null | undefined,
  );
  const traces = readJsonLinesIfExists(tracesFile);
  const affectedKeys = new Set<string>();
  const externalizedExchangeCountByIdentity = new Map<string, number>();
  for (const trace of traces) {
    const traceRecord = trace as TransformTrace | null | undefined;
    const id = asText(traceRecord?.dataset_id ?? traceRecord?.entity_id);
    const version = asText(traceRecord?.dataset_version ?? traceRecord?.version) || "00.00.001";
    if (!id) continue;
    const key = `process:${id}@@${version}`;
    affectedKeys.add(key);
    externalizedExchangeCountByIdentity.set(
      key,
      (externalizedExchangeCountByIdentity.get(key) ?? 0) + 1,
    );
  }
  const outputPayloadSha256ByIdentity = new Map<string, string>();
  if (outputRowsFile && fileExists(outputRowsFile)) {
    readRowsIfExists(outputRowsFile).forEach((row, index) => {
      const identity = datasetIdentity(row, index, "process");
      const key = identityFreshnessIdentityKey({
        datasetType: "process",
        identity,
      });
      if (key) {
        outputPayloadSha256ByIdentity.set(key, sha256Json(identity.payload));
      }
    });
  }
  return {
    artifact,
    status: asText(report.status),
    inputRowsFile,
    outputRowsFile,
    tracesFile,
    inputRowsFileRelative: repoRelativeArtifactPath(repoRoot, inputRowsFile),
    outputRowsFileRelative: repoRelativeArtifactPath(repoRoot, outputRowsFile),
    tracesFileRelative: repoRelativeArtifactPath(repoRoot, tracesFile),
    reportPathRelative: repoRelativePath(repoRoot, artifact.path as string),
    externalizedExchanges: Number(counts?.externalized_exchanges ?? 0) || 0,
    affectedRows: Number(counts?.affected_rows ?? 0) || 0,
    traces,
    affectedKeys,
    externalizedExchangeCountByIdentity,
    inputPayloadSha256ByIdentity: payloadSha256ByIdentityForRows(
      repoRoot,
      inputRowsFile ? [inputRowsFile] : [],
      "process",
    ),
    outputPayloadSha256ByIdentity,
  };
}

export function readCanonicalSupportRewriteContext(
  repoRoot: string,
  artifact: ArtifactEnvelope | null | undefined,
): CanonicalSupportRewriteContext | null {
  if (!artifact) return null;
  const report = (artifact.value ?? {}) as TransformReport;
  const files = report.files as ReportFiles | null | undefined;
  const inputRowsFile = resolveRepoPath(
    repoRoot,
    (report.rows_file ??
      report.rowsFile ??
      report.input_rows_file ??
      report.inputRowsFile ??
      files?.input_rows ??
      files?.inputRows) as string | null | undefined,
  );
  const outputRowsFile = resolveRepoPath(
    repoRoot,
    (report.output_rows_file ??
      report.outputRowsFile ??
      files?.output_rows ??
      files?.outputRows) as string | null | undefined,
  );
  const blockersFile = resolveRepoPath(
    repoRoot,
    (files?.canonical_support_blockers ?? files?.blockers ?? report.blockers_file) as
      string | null | undefined,
  );
  const deferredRowsFile = resolveRepoPath(
    repoRoot,
    (files?.deferred_rows ??
      files?.deferredRows ??
      report.deferred_rows_file ??
      report.deferredRowsFile) as string | null | undefined,
  );
  const rewritesFile = resolveRepoPath(
    repoRoot,
    (files?.canonical_support_rewrites ?? files?.rewrites ?? report.rewrites_file) as
      string | null | undefined,
  );
  const blockerRows = readJsonLinesIfExists(blockersFile);
  const hardBlockers = Array.isArray(report.blockers)
    ? report.blockers
    : String(report.status) === "blocked"
      ? blockerRows
      : [];
  const deferredBlockers = Array.isArray(report.deferred_blockers)
    ? report.deferred_blockers
    : String(report.status) === "completed_with_deferred_rows"
      ? blockerRows
      : [];
  return {
    artifact,
    status: asText(report.status),
    counts: report.counts && typeof report.counts === "object" ? (report.counts as JsonRecord) : {},
    inputRowsFile,
    outputRowsFile,
    deferredRowsFile,
    inputPayloadSha256ByIdentity: payloadSha256ByIdentityForRows(
      repoRoot,
      inputRowsFile ? [inputRowsFile] : [],
    ),
    outputPayloadSha256ByIdentity: payloadSha256ByIdentityForRows(
      repoRoot,
      outputRowsFile ? [outputRowsFile] : [],
    ),
    inputRowsFileRelative: repoRelativeArtifactPath(repoRoot, inputRowsFile),
    outputRowsFileRelative: repoRelativeArtifactPath(repoRoot, outputRowsFile),
    deferredRowsFileRelative: repoRelativeArtifactPath(repoRoot, deferredRowsFile),
    reportPathRelative: repoRelativePath(repoRoot, artifact.path as string),
    blockersFileRelative: repoRelativeArtifactPath(repoRoot, blockersFile),
    rewritesFileRelative: repoRelativeArtifactPath(repoRoot, rewritesFile),
    blockerRows,
    blockers: hardBlockers,
    deferredBlockers,
    rewrites: readJsonLinesIfExists(rewritesFile),
  };
}

export function readRowsFileTransformContext(
  repoRoot: string,
  artifact: ArtifactEnvelope | null | undefined,
  kind: unknown,
): RowsFileTransformContext | null {
  if (!artifact) return null;
  const report = (artifact.value ?? {}) as TransformReport;
  const files = report.files as ReportFiles | null | undefined;
  const proofs = report.proofs as JsonRecord | null | undefined;
  const inputRowsFile = resolveRepoPath(
    repoRoot,
    (report.rows_file ??
      report.rowsFile ??
      report.input_rows_file ??
      report.inputRowsFile ??
      report.input_path ??
      report.inputPath ??
      files?.input_rows ??
      files?.inputRows ??
      files?.input) as string | null | undefined,
  );
  const outputRowsFile = resolveRepoPath(
    repoRoot,
    (report.output_rows_file ??
      report.outputRowsFile ??
      report.out_path ??
      report.outPath ??
      files?.output_rows ??
      files?.outputRows ??
      files?.cleaned_rows ??
      files?.cleanedRows ??
      files?.output) as string | null | undefined,
  );
  return {
    kind,
    artifact,
    status: asText(report.status),
    counts: report.counts && typeof report.counts === "object" ? (report.counts as JsonRecord) : {},
    sourceExchangeCompletenessProofs: ensureArray(
      report.source_exchange_completeness_proofs ?? proofs?.source_exchange_completeness,
    ),
    inputRowsFile,
    outputRowsFile,
    inputRowsFileRelative: repoRelativeArtifactPath(repoRoot, inputRowsFile),
    outputRowsFileRelative: repoRelativeArtifactPath(repoRoot, outputRowsFile),
    reportPathRelative: repoRelativePath(repoRoot, artifact.path as string),
    inputPayloadSha256ByIdentity: payloadSha256ByIdentityForRows(
      repoRoot,
      inputRowsFile ? [inputRowsFile] : [],
    ),
    outputPayloadSha256ByIdentity: payloadSha256ByIdentityForRows(
      repoRoot,
      outputRowsFile ? [outputRowsFile] : [],
    ),
  };
}

export function readSourceContactRewriteContext(
  repoRoot: string,
  artifact: ArtifactEnvelope | null | undefined,
): RowsFileTransformContext | null {
  return readRowsFileTransformContext(repoRoot, artifact, "source_contact_rewrite");
}

export function readCleanupTransformContext(
  repoRoot: string,
  artifact: ArtifactEnvelope | null | undefined,
): RowsFileTransformContext | null {
  return readRowsFileTransformContext(repoRoot, artifact, "curation_cleanup");
}

export function unresolvedExchangeExternalizationRowsForIdentity(
  context: UnresolvedExchangeExternalizationContext | null | undefined,
  identity: { id?: unknown; version?: unknown } | null | undefined,
): unknown[] {
  if (!context || !identity?.id) return [];
  const key = `process:${identity.id}@@${identity.version || "00.00.001"}`;
  return context.traces.filter((trace) => {
    const traceRecord = trace as TransformTrace | null | undefined;
    const id = asText(traceRecord?.dataset_id ?? traceRecord?.entity_id);
    const version = asText(traceRecord?.dataset_version ?? traceRecord?.version) || "00.00.001";
    return key === `process:${id}@@${version}`;
  });
}

export function rowsFileChainsThroughUnresolvedExchangeExternalization({
  repoRoot,
  upstreamFile,
  finalFile,
  unresolvedExchangeExternalizationContext,
}: UnresolvedChainOptions): boolean {
  return Boolean(
    upstreamFile &&
    finalFile &&
    unresolvedExchangeExternalizationContext?.status === "completed" &&
    unresolvedExchangeExternalizationContext.inputRowsFile &&
    unresolvedExchangeExternalizationContext.outputRowsFile &&
    sameArtifactPath(
      repoRoot,
      upstreamFile,
      unresolvedExchangeExternalizationContext.inputRowsFile,
    ) &&
    sameArtifactPath(repoRoot, unresolvedExchangeExternalizationContext.outputRowsFile, finalFile),
  );
}

export function cleanupInputRowsFile(
  repoRoot: string,
  cleanupArtifact: ArtifactEnvelope | null | undefined,
): string | null {
  const value = cleanupArtifact?.value as TransformReport | null | undefined;
  const inputRows = value?.rows_file ?? value?.rowsFile ?? value?.input_path ?? value?.inputPath;
  return inputRows ? resolveRepoPath(repoRoot, inputRows as string | null | undefined) : null;
}

export function decisionApplyExpectedRowsFile({
  repoRoot,
  rowsFile,
  cleanupArtifact,
}: ExpectedRowsOptions): unknown {
  return cleanupArtifact ? cleanupInputRowsFile(repoRoot, cleanupArtifact) : rowsFile;
}

export function decisionApplyOutputRowsMatch(
  repoRoot: string,
  context: TransformContextLike | null | undefined,
  expectedRowsFile: unknown,
): boolean {
  return Boolean(
    expectedRowsFile &&
    context?.outputRows?.some((filePath) => sameRowsArtifact(repoRoot, filePath, expectedRowsFile)),
  );
}

export function decisionApplyInputRowsMatch(
  repoRoot: string,
  context: TransformContextLike | null | undefined,
  expectedRowsFile: unknown,
): boolean {
  return Boolean(
    expectedRowsFile &&
    context?.inputRows?.some((filePath) => sameRowsArtifact(repoRoot, filePath, expectedRowsFile)),
  );
}

export function rowsFileTransformEntriesFromDecisionApply(
  context: TransformContextLike | null | undefined,
  kind: unknown,
): RowsFileTransformEntry[] {
  const entries: RowsFileTransformEntry[] = [];
  if (!context?.inputRows?.length || !context?.outputRows?.length) return entries;
  if (context.status && context.status !== "completed") return entries;
  for (const inputRowsFile of context.inputRows) {
    for (const outputRowsFile of context.outputRows) {
      entries.push({
        kind,
        inputRowsFile,
        outputRowsFile,
        inputPayloadSha256ByIdentity: context.inputPayloadSha256ByIdentity,
        outputPayloadSha256ByIdentity: context.outputPayloadSha256ByIdentity,
      });
    }
  }
  return entries;
}

export function rowsFileTransformEntriesFromPatchApply(
  context: TransformContextLike | null | undefined,
): RowsFileTransformEntry[] {
  if (!context?.inputRowsFile || !context?.outputRows?.length) return [];
  return context.outputRows.map((outputRowsFile) => ({
    kind: "patch_apply",
    inputRowsFile: context.inputRowsFile!,
    outputRowsFile,
    inputPayloadSha256ByIdentity: context.inputPayloadSha256ByIdentity,
    outputPayloadSha256ByIdentity: context.outputPayloadSha256ByIdentity,
  }));
}

export function rowsFileTransformEntryFromIdentityReferenceRewrite(
  context: TransformContextLike | null | undefined,
): RowsFileTransformEntry[] {
  if (!context?.inputRowsFile || !context?.outputRowsFile) return [];
  return [
    {
      kind: "identity_reference_rewrite",
      inputRowsFile: context.inputRowsFile,
      outputRowsFile: context.outputRowsFile,
      inputPayloadSha256ByIdentity: context.inputPayloadSha256ByIdentity,
      outputPayloadSha256ByIdentity: context.outputPayloadSha256ByIdentity,
    },
  ];
}

export function rowsFileTransformEntryFromUnresolvedExchangeExternalization(
  context: TransformContextLike | null | undefined,
): RowsFileTransformEntry[] {
  if (context?.status !== "completed" || !context.inputRowsFile || !context.outputRowsFile) {
    return [];
  }
  return [
    {
      kind: "unresolved_exchange_externalization",
      inputRowsFile: context.inputRowsFile,
      outputRowsFile: context.outputRowsFile,
      inputPayloadSha256ByIdentity: context.inputPayloadSha256ByIdentity,
      outputPayloadSha256ByIdentity: context.outputPayloadSha256ByIdentity,
    },
  ];
}

export function rowsFileTransformEntryFromCanonicalSupportRewrite(
  context: TransformContextLike | null | undefined,
): RowsFileTransformEntry[] {
  if (!context?.inputRowsFile || !context?.outputRowsFile) return [];
  const status = asText(context.status);
  if (
    status &&
    !["completed", "completed_no_rewrites", "completed_with_deferred_rows", "blocked"].includes(
      status,
    )
  ) {
    return [];
  }
  return [
    {
      kind: "canonical_support_rewrite",
      inputRowsFile: context.inputRowsFile,
      outputRowsFile: context.outputRowsFile,
      inputPayloadSha256ByIdentity: context.inputPayloadSha256ByIdentity,
      outputPayloadSha256ByIdentity: context.outputPayloadSha256ByIdentity,
    },
  ];
}

export function rowsFileTransformEntryFromRowsFileContext(
  context: TransformContextLike | null | undefined,
  kind: unknown,
): RowsFileTransformEntry[] {
  if (!context?.inputRowsFile || !context?.outputRowsFile) return [];
  const status = asText(context.status);
  if (
    status &&
    ![
      "completed",
      "completed_no_rewrites",
      "completed_with_deferred_rows",
      "ready",
      "ready_with_profile_waivers",
    ].includes(status)
  ) {
    return [];
  }
  return [
    {
      kind: kind || context.kind || "rows_file_transform",
      inputRowsFile: context.inputRowsFile,
      outputRowsFile: context.outputRowsFile,
      inputPayloadSha256ByIdentity: context.inputPayloadSha256ByIdentity,
      outputPayloadSha256ByIdentity: context.outputPayloadSha256ByIdentity,
    },
  ];
}

export function deterministicRowsFileTransformEntries({
  patchApplyContext,
  classificationDecisionApplyContext,
  locationDecisionApplyContext,
  identityDecisionApplyContext,
  identityReferenceRewriteContext,
  unresolvedExchangeExternalizationContext,
  sourceContactRewriteContext,
  canonicalSupportRewriteContext,
  cleanupContext,
}: DeterministicTransformContexts): RowsFileTransformEntry[] {
  return [
    ...rowsFileTransformEntriesFromPatchApply(patchApplyContext),
    ...rowsFileTransformEntriesFromDecisionApply(
      classificationDecisionApplyContext,
      "classification_decision_apply",
    ),
    ...rowsFileTransformEntriesFromDecisionApply(
      locationDecisionApplyContext,
      "location_decision_apply",
    ),
    ...rowsFileTransformEntriesFromDecisionApply(
      identityDecisionApplyContext,
      "identity_decision_apply",
    ),
    ...rowsFileTransformEntryFromIdentityReferenceRewrite(identityReferenceRewriteContext),
    ...rowsFileTransformEntryFromUnresolvedExchangeExternalization(
      unresolvedExchangeExternalizationContext,
    ),
    ...rowsFileTransformEntryFromRowsFileContext(
      sourceContactRewriteContext,
      "source_contact_rewrite",
    ),
    ...rowsFileTransformEntryFromCanonicalSupportRewrite(canonicalSupportRewriteContext),
    ...rowsFileTransformEntryFromRowsFileContext(cleanupContext, "curation_cleanup"),
  ].filter((entry) => entry.inputRowsFile && entry.outputRowsFile);
}

export function sameRowsArtifact(repoRoot: string, left: unknown, right: unknown): boolean {
  if (sameArtifactPath(repoRoot, left, right)) return true;
  const resolvedLeft = normalizedArtifactPath(repoRoot, left);
  const resolvedRight = normalizedArtifactPath(repoRoot, right);
  if (!resolvedLeft || !resolvedRight || !fileExists(resolvedLeft) || !fileExists(resolvedRight)) {
    return false;
  }
  try {
    return sha256Text(readText(resolvedLeft)) === sha256Text(readText(resolvedRight));
  } catch {
    return false;
  }
}

export function rowsFileReachableThroughTransformChain({
  repoRoot,
  startFiles,
  expectedRowsFile,
  transforms,
}: TransformReachabilityOptions): boolean {
  if (!expectedRowsFile) return false;
  const reachable: unknown[] = [];
  const addReachable = (filePath: unknown): boolean => {
    if (!filePath) return false;
    if (reachable.some((existing) => sameRowsArtifact(repoRoot, existing, filePath))) {
      return false;
    }
    reachable.push(filePath);
    return true;
  };
  for (const filePath of ensureArray(startFiles)) addReachable(filePath);
  if (reachable.some((filePath) => sameRowsArtifact(repoRoot, filePath, expectedRowsFile))) {
    return true;
  }
  for (let pass = 0; pass <= transforms.length; pass += 1) {
    let changed = false;
    for (const transform of transforms) {
      const inputReachable = reachable.some((filePath) =>
        sameRowsArtifact(repoRoot, filePath, transform.inputRowsFile),
      );
      if (inputReachable) {
        changed = addReachable(transform.outputRowsFile) || changed;
      }
    }
    if (reachable.some((filePath) => sameRowsArtifact(repoRoot, filePath, expectedRowsFile))) {
      return true;
    }
    if (!changed) break;
  }
  return false;
}

export function decisionApplyOutputRowsReachableThroughDeterministicTransforms({
  repoRoot,
  context,
  expectedRowsFile,
  patchApplyContext,
  classificationDecisionApplyContext,
  locationDecisionApplyContext,
  identityDecisionApplyContext,
  identityReferenceRewriteContext,
  unresolvedExchangeExternalizationContext,
  sourceContactRewriteContext,
  canonicalSupportRewriteContext,
  cleanupContext,
}: DecisionTransformReachabilityOptions): boolean {
  return rowsFileReachableThroughTransformChain({
    repoRoot,
    startFiles: context?.outputRows ?? [],
    expectedRowsFile,
    transforms: deterministicRowsFileTransformEntries({
      patchApplyContext,
      classificationDecisionApplyContext,
      locationDecisionApplyContext,
      identityDecisionApplyContext,
      identityReferenceRewriteContext,
      unresolvedExchangeExternalizationContext,
      sourceContactRewriteContext,
      canonicalSupportRewriteContext,
      cleanupContext,
    }),
  });
}

export function decisionApplyOutputRowsChainThroughPatch(
  repoRoot: string,
  context: TransformContextLike | null | undefined,
  patchApplyContext: TransformContextLike | null | undefined,
  expectedRowsFile: unknown,
): boolean {
  return Boolean(
    expectedRowsFile &&
    patchApplyContext?.inputRowsFile &&
    decisionApplyOutputRowsMatch(repoRoot, context, patchApplyContext.inputRowsFile) &&
    patchApplyContext.outputRows?.some((filePath) =>
      sameArtifactPath(repoRoot, filePath, expectedRowsFile),
    ),
  );
}

export function patchApplyOutputChainsThroughIdentityRewrite({
  repoRoot,
  patchOut,
  cleanupInput,
  identityReferenceRewriteContext,
}: IdentityChainOptions): boolean {
  return Boolean(
    patchOut &&
    cleanupInput &&
    identityReferenceRewriteContext?.inputRowsFile &&
    identityReferenceRewriteContext?.outputRowsFile &&
    sameArtifactPath(repoRoot, patchOut, identityReferenceRewriteContext.inputRowsFile) &&
    sameArtifactPath(repoRoot, identityReferenceRewriteContext.outputRowsFile, cleanupInput),
  );
}

export function patchApplyOutputChainsThroughUnresolvedExchangeExternalization({
  repoRoot,
  patchOut,
  cleanupInput,
  unresolvedExchangeExternalizationContext,
}: UnresolvedPatchChainOptions): boolean {
  return rowsFileChainsThroughUnresolvedExchangeExternalization({
    repoRoot,
    upstreamFile: patchOut,
    finalFile: cleanupInput,
    unresolvedExchangeExternalizationContext,
  });
}

export function patchApplyOutputChainsThroughIdentityRewriteAndUnresolvedExchangeExternalization({
  repoRoot,
  patchOut,
  cleanupInput,
  identityReferenceRewriteContext,
  unresolvedExchangeExternalizationContext,
}: CombinedPatchChainOptions): boolean {
  return Boolean(
    patchApplyOutputChainsThroughIdentityRewrite({
      repoRoot,
      patchOut,
      cleanupInput: unresolvedExchangeExternalizationContext?.inputRowsFile,
      identityReferenceRewriteContext,
    }) &&
    rowsFileChainsThroughUnresolvedExchangeExternalization({
      repoRoot,
      upstreamFile: identityReferenceRewriteContext?.outputRowsFile,
      finalFile: cleanupInput,
      unresolvedExchangeExternalizationContext,
    }),
  );
}

export function decisionApplyOutputRowsChainThroughPatchAndIdentityRewrite(
  repoRoot: string,
  context: TransformContextLike | null | undefined,
  patchApplyContext: TransformContextLike | null | undefined,
  identityReferenceRewriteContext: TransformContextLike | null | undefined,
  expectedRowsFile: unknown,
): boolean {
  return Boolean(
    expectedRowsFile &&
    patchApplyContext?.inputRowsFile &&
    identityReferenceRewriteContext?.inputRowsFile &&
    identityReferenceRewriteContext?.outputRowsFile &&
    decisionApplyOutputRowsMatch(repoRoot, context, patchApplyContext.inputRowsFile) &&
    patchApplyContext.outputRows?.some((filePath) =>
      sameArtifactPath(repoRoot, filePath, identityReferenceRewriteContext.inputRowsFile),
    ) &&
    sameArtifactPath(repoRoot, identityReferenceRewriteContext.outputRowsFile, expectedRowsFile),
  );
}

export function decisionApplyOutputRowsChainThroughIdentityRewrite(
  repoRoot: string,
  context: TransformContextLike | null | undefined,
  identityReferenceRewriteContext: TransformContextLike | null | undefined,
  expectedRowsFile: unknown,
): boolean {
  return Boolean(
    expectedRowsFile &&
    identityReferenceRewriteContext?.inputRowsFile &&
    identityReferenceRewriteContext?.outputRowsFile &&
    decisionApplyOutputRowsMatch(
      repoRoot,
      context,
      identityReferenceRewriteContext.inputRowsFile,
    ) &&
    sameArtifactPath(repoRoot, identityReferenceRewriteContext.outputRowsFile, expectedRowsFile),
  );
}

export function decisionApplyOutputRowsChainThroughIdentityRewriteAndUnresolvedExchangeExternalization(
  repoRoot: string,
  context: TransformContextLike | null | undefined,
  identityReferenceRewriteContext: TransformContextLike | null | undefined,
  unresolvedExchangeExternalizationContext: TransformContextLike | null | undefined,
  expectedRowsFile: unknown,
): boolean {
  return Boolean(
    expectedRowsFile &&
    identityReferenceRewriteContext?.inputRowsFile &&
    identityReferenceRewriteContext?.outputRowsFile &&
    unresolvedExchangeExternalizationContext?.inputRowsFile &&
    decisionApplyOutputRowsMatch(
      repoRoot,
      context,
      identityReferenceRewriteContext.inputRowsFile,
    ) &&
    sameArtifactPath(
      repoRoot,
      identityReferenceRewriteContext.outputRowsFile,
      unresolvedExchangeExternalizationContext.inputRowsFile,
    ) &&
    rowsFileChainsThroughUnresolvedExchangeExternalization({
      repoRoot,
      upstreamFile: unresolvedExchangeExternalizationContext.inputRowsFile,
      finalFile: expectedRowsFile,
      unresolvedExchangeExternalizationContext,
    }),
  );
}

export function decisionApplyOutputRowsChainThroughClassification(
  repoRoot: string,
  context: TransformContextLike | null | undefined,
  classificationDecisionApplyContext: TransformContextLike | null | undefined,
  expectedRowsFile: unknown,
): boolean {
  return Boolean(
    expectedRowsFile &&
    classificationDecisionApplyContext?.inputRows?.some((filePath) =>
      decisionApplyOutputRowsMatch(repoRoot, context, filePath),
    ) &&
    decisionApplyOutputRowsMatch(repoRoot, classificationDecisionApplyContext, expectedRowsFile),
  );
}

export function decisionApplyOutputRowsChainThroughClassificationAndIdentityRewrite(
  repoRoot: string,
  context: TransformContextLike | null | undefined,
  classificationDecisionApplyContext: TransformContextLike | null | undefined,
  identityReferenceRewriteContext: TransformContextLike | null | undefined,
  expectedRowsFile: unknown,
): boolean {
  return Boolean(
    expectedRowsFile &&
    identityReferenceRewriteContext?.inputRowsFile &&
    identityReferenceRewriteContext?.outputRowsFile &&
    classificationDecisionApplyContext?.outputRows?.some((filePath) =>
      sameArtifactPath(repoRoot, filePath, identityReferenceRewriteContext.inputRowsFile),
    ) &&
    decisionApplyOutputRowsChainThroughClassification(
      repoRoot,
      context,
      classificationDecisionApplyContext,
      identityReferenceRewriteContext.inputRowsFile,
    ) &&
    sameArtifactPath(repoRoot, identityReferenceRewriteContext.outputRowsFile, expectedRowsFile),
  );
}

export function decisionApplyOutputRowsChainThroughClassificationIdentityRewriteAndUnresolvedExchangeExternalization(
  repoRoot: string,
  context: TransformContextLike | null | undefined,
  classificationDecisionApplyContext: TransformContextLike | null | undefined,
  identityReferenceRewriteContext: TransformContextLike | null | undefined,
  unresolvedExchangeExternalizationContext: TransformContextLike | null | undefined,
  expectedRowsFile: unknown,
): boolean {
  return Boolean(
    expectedRowsFile &&
    unresolvedExchangeExternalizationContext?.inputRowsFile &&
    decisionApplyOutputRowsChainThroughClassificationAndIdentityRewrite(
      repoRoot,
      context,
      classificationDecisionApplyContext,
      identityReferenceRewriteContext,
      unresolvedExchangeExternalizationContext.inputRowsFile,
    ) &&
    rowsFileChainsThroughUnresolvedExchangeExternalization({
      repoRoot,
      upstreamFile: unresolvedExchangeExternalizationContext.inputRowsFile,
      finalFile: expectedRowsFile,
      unresolvedExchangeExternalizationContext,
    }),
  );
}

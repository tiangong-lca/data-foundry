import path from "node:path";
import { identityKey } from "./dataset-payload.ts";
import { evidenceResolutionMode, payloadSha256ByIdentityForRows } from "./full-context-proof.ts";
import { sha256Json, sha256Text } from "./hash-utils.ts";
import {
  asText,
  ensureArray,
  fileExists,
  readText,
  repoRelativePath,
  resolveRepoPath,
  unique,
} from "./runtime-io.ts";
import { identityDecisionApplyContextHasDecision } from "./workflow-identity-decision-context.ts";
import { readFileArtifactIfOption, readJsonLines } from "./workflow-patch-collect.ts";
import { isAnnualSupplyTarget } from "./workflow-queue-context.ts";

interface JsonRecord {
  [key: string]: unknown;
}

interface PatchEvidenceEntry extends JsonRecord {
  row_index?: unknown;
  dataset_id?: unknown;
  entity_id?: unknown;
  id?: unknown;
  dataset_version?: unknown;
  version?: unknown;
  op?: unknown;
  operation?: unknown;
  path?: unknown;
  basis?: unknown;
  evidence?: unknown;
  resolution?: unknown;
  authoring_package?: unknown;
  authoring_package_sha256?: unknown;
  closes_action_items?: unknown;
}

export interface CompactPatchEvidenceEntry extends JsonRecord {
  row_index: number | null;
  dataset_id: string | null;
  dataset_version: string | null;
  operation: string | null;
  path: string | null;
  basis: string | null;
  evidence: unknown;
  resolution: unknown;
  authoring_package: string | null;
  authoring_package_sha256: string | null;
  closes_action_items: unknown[];
}

interface PatchApplyFiles extends JsonRecord {
  patch_evidence?: unknown;
  input_rows?: unknown;
  patched_rows?: unknown;
  output_rows?: unknown;
}

interface PatchApplyReport extends JsonRecord {
  status?: unknown;
  evidence_count?: unknown;
  input_path?: unknown;
  inputPath?: unknown;
  out_path?: unknown;
  outPath?: unknown;
  output_path?: unknown;
  outputPath?: unknown;
  files?: unknown;
}

interface ArtifactEnvelope {
  path?: unknown;
  value?: unknown;
}

export interface PatchApplyContext {
  status: unknown;
  report: PatchApplyReport | null;
  reportPath: unknown;
  inputRowsFile: string | null;
  outputRows: string[];
  inputPayloadSha256ByIdentity: Map<string, string>;
  outputPayloadSha256ByIdentity: Map<string, string>;
  evidenceFile: string | null;
  evidenceRows: unknown[];
  byIdentity: Map<string, CompactPatchEvidenceEntry[]>;
  byRowIndex: Map<number, CompactPatchEvidenceEntry[]>;
  globalBlockers: JsonRecord[];
}

interface DatasetIdentity {
  id?: unknown;
  version?: unknown;
}

interface ReadIndex<TKey, TValue> {
  get(key: TKey): TValue[] | undefined;
}

interface CleanupContext extends JsonRecord {
  status?: unknown;
  sourceExchangeCompletenessProofs?: unknown;
}

interface DeterministicSourceCleanupOptions {
  trace: unknown;
  cleanupContext: CleanupContext | null | undefined;
  identity: DatasetIdentity | null | undefined;
  rowIndex: unknown;
}

interface TraceSummary extends JsonRecord {
  unresolved_traces?: unknown;
  source_exchange_completeness?: unknown;
}

interface TracePatchEvidenceOptions {
  traceSummary?: TraceSummary | null;
  aiPatchEvidence: PatchEvidenceEntry[];
  identityDecisionApplyContext?: unknown;
  cleanupContext?: CleanupContext | null;
  identity?: DatasetIdentity | null;
  rowIndex?: unknown;
}

interface PolicyProfile {
  docs?: unknown;
}

export interface PolicySnapshot {
  kind: unknown;
  path: unknown;
  exists: boolean;
  sha256: string | null;
}

export function patchEvidenceIdentityKey(entry: unknown): string | null {
  const record = entry as PatchEvidenceEntry | null | undefined;
  const id = asText(record?.dataset_id ?? record?.entity_id ?? record?.id);
  const version = asText(record?.dataset_version ?? record?.version) || "00.00.001";
  return id ? `${id}@@${version}` : null;
}

export function compactPatchEvidenceEntry(entry: unknown): CompactPatchEvidenceEntry {
  const record = entry as PatchEvidenceEntry | null | undefined;
  return {
    row_index: Number.isInteger(record?.row_index) ? (record?.row_index as number) : null,
    dataset_id: asText(record?.dataset_id ?? record?.entity_id ?? record?.id) || null,
    dataset_version: asText(record?.dataset_version ?? record?.version) || null,
    operation: asText(record?.op ?? record?.operation) || null,
    path: asText(record?.path) || null,
    basis: asText(record?.basis) || null,
    evidence: record?.evidence ?? null,
    resolution: record?.resolution ?? null,
    authoring_package: asText(record?.authoring_package) || null,
    authoring_package_sha256: asText(record?.authoring_package_sha256) || null,
    closes_action_items: ensureArray(record?.closes_action_items),
  };
}

export function readPatchApplyContext(
  repoRoot: string,
  patchApplyArtifact: ArtifactEnvelope | null | undefined,
  patchEvidenceFile: string | null | undefined,
): PatchApplyContext {
  const report = (patchApplyArtifact?.value ?? null) as PatchApplyReport | null;
  const files = report?.files as PatchApplyFiles | null | undefined;
  const reportPath = patchApplyArtifact?.path ?? null;
  const evidenceFile =
    patchEvidenceFile ?? readFileArtifactIfOption(repoRoot, files?.patch_evidence) ?? null;
  const expectedEvidenceCount = Number(report?.evidence_count ?? 0);
  const evidenceRows = evidenceFile ? readJsonLines(evidenceFile) : [];
  const byIdentity = new Map<string, CompactPatchEvidenceEntry[]>();
  const byRowIndex = new Map<number, CompactPatchEvidenceEntry[]>();
  const globalBlockers: JsonRecord[] = [];

  if (!report && evidenceFile) {
    globalBlockers.push({
      code: "patch_apply_report_required",
      stage: "ai_patch_apply",
      message:
        "Patch evidence was provided, but dataset-patch-apply-report.json is required to prove deterministic application.",
      patch_evidence_file: repoRelativePath(repoRoot, evidenceFile),
    });
  }
  if (report && report.status !== "completed") {
    globalBlockers.push({
      code: "patch_apply_not_completed",
      stage: "ai_patch_apply",
      message: `dataset-patch-apply status is ${report.status}.`,
      patch_apply_report: reportPath ? repoRelativePath(repoRoot, reportPath as string) : null,
    });
  }
  if ((expectedEvidenceCount > 0 || patchEvidenceFile) && !evidenceFile) {
    globalBlockers.push({
      code: "patch_evidence_file_missing",
      stage: "ai_patch_apply",
      message:
        "Patch apply report expects patch evidence, but no readable patch evidence JSONL file was provided.",
      patch_apply_report: reportPath ? repoRelativePath(repoRoot, reportPath as string) : null,
    });
  }

  for (const entry of evidenceRows) {
    const record = entry as PatchEvidenceEntry | null | undefined;
    const compact = compactPatchEvidenceEntry(entry);
    const key = patchEvidenceIdentityKey(entry);
    if (key) {
      if (!byIdentity.has(key)) byIdentity.set(key, []);
      byIdentity.get(key)!.push(compact);
      if (compact.dataset_id && !byIdentity.has(compact.dataset_id)) {
        byIdentity.set(compact.dataset_id, []);
      }
      if (compact.dataset_id) byIdentity.get(compact.dataset_id)!.push(compact);
    }
    if (Number.isInteger(record?.row_index)) {
      const rowIndex = record?.row_index as number;
      if (!byRowIndex.has(rowIndex)) byRowIndex.set(rowIndex, []);
      byRowIndex.get(rowIndex)!.push(compact);
    }
  }

  const inputRowsFile = resolveRepoPath(
    repoRoot,
    (report?.input_path ?? report?.inputPath ?? files?.input_rows) as string | null | undefined,
  );
  const outputRows = unique([
    report?.out_path,
    report?.outPath,
    report?.output_path,
    report?.outputPath,
    files?.patched_rows,
    files?.output_rows,
  ])
    .flatMap((filePath) => ensureArray(filePath))
    .map((filePath) => resolveRepoPath(repoRoot, filePath as string | null | undefined))
    .filter(Boolean) as string[];

  return {
    status: report?.status ?? "not_provided",
    report,
    reportPath,
    inputRowsFile,
    outputRows,
    inputPayloadSha256ByIdentity: payloadSha256ByIdentityForRows(
      repoRoot,
      inputRowsFile ? [inputRowsFile] : [],
    ),
    outputPayloadSha256ByIdentity: payloadSha256ByIdentityForRows(repoRoot, outputRows),
    evidenceFile,
    evidenceRows,
    byIdentity,
    byRowIndex,
    globalBlockers,
  };
}

export function patchEvidenceForRow<TEntry, TRowIndex>(
  patchApplyContext:
    | {
        byIdentity: ReadIndex<string, TEntry>;
        byRowIndex: ReadIndex<TRowIndex, TEntry>;
      }
    | null
    | undefined,
  identity: { id: string; version: unknown },
  rowIndex: TRowIndex,
): TEntry[] {
  if (!patchApplyContext) return [];
  const seen = new Set<string>();
  const entries = [
    ...(patchApplyContext.byIdentity.get(identityKey(identity)) ?? []),
    ...(patchApplyContext.byIdentity.get(identity.id) ?? []),
    ...(patchApplyContext.byRowIndex.get(rowIndex) ?? []),
  ];
  return entries.filter((entry) => {
    const key = JSON.stringify(entry);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function patchEvidenceClosureCodes(entry: unknown): string[] {
  const record = entry as PatchEvidenceEntry | null | undefined;
  return ensureArray(record?.closes_action_items)
    .map((item) =>
      asText(
        typeof item === "string"
          ? item
          : ((item as JsonRecord | null | undefined)?.code ??
              (item as JsonRecord | null | undefined)?.action_item_code ??
              (item as JsonRecord | null | undefined)?.actionItemCode ??
              (item as JsonRecord | null | undefined)?.rule_id ??
              (item as JsonRecord | null | undefined)?.ruleId),
      ),
    )
    .filter(Boolean);
}

export function isDeterministicAnnualSupplyCleanupTrace(trace: unknown): boolean {
  const record = trace as JsonRecord | null | undefined;
  const actionCode = asText(record?.action_item_code);
  const blockedPath = asText(record?.blocked_path);
  const evidence = (record?.evidence ?? {}) as JsonRecord;
  return (
    isAnnualSupplyTarget(actionCode, blockedPath) &&
    asText(evidence?.source) === "foundry_deterministic_cleanup"
  );
}

export function isDeterministicSourceExchangeCleanupTrace({
  trace,
  cleanupContext,
  identity,
  rowIndex,
}: DeterministicSourceCleanupOptions): boolean {
  if (!cleanupContext || cleanupContext.status !== "completed") return false;
  const traceRecord = trace as JsonRecord | null | undefined;
  const status = asText(
    traceRecord?.status ?? traceRecord?.decision_status ?? traceRecord?.decisionStatus,
  );
  if (
    !["source_only_output_exchange_verified", "accepted_source_only_output", "verified"].includes(
      status,
    )
  ) {
    return false;
  }
  const evidence = (traceRecord?.evidence ?? traceRecord?.source_evidence ?? traceRecord?.trace) as
    JsonRecord | null | undefined;
  if (asText(evidence?.source) !== "foundry_deterministic_cleanup") {
    return false;
  }
  const id = asText(identity?.id);
  const version = asText(identity?.version) || "00.00.001";
  const traceHash = asText(traceRecord?.trace_sha256) || sha256Json(trace);
  return ensureArray(cleanupContext.sourceExchangeCompletenessProofs).some((proof) => {
    const proofRecord = proof as JsonRecord | null | undefined;
    const proofId = asText(proofRecord?.dataset_id ?? proofRecord?.entity_id ?? proofRecord?.id);
    const proofVersion =
      asText(proofRecord?.version ?? proofRecord?.dataset_version) || "00.00.001";
    const sourceSignature = asText(proofRecord?.source_exchange_signature_hash);
    const finalSignature = asText(proofRecord?.final_exchange_signature_hash);
    return (
      proofId === id &&
      proofVersion === version &&
      Number(proofRecord?.row_index) === Number(rowIndex) &&
      asText(proofRecord?.trace_hash) === traceHash &&
      sourceSignature &&
      sourceSignature === finalSignature
    );
  });
}

export function tracePatchEvidenceBlockers({
  traceSummary,
  aiPatchEvidence,
  identityDecisionApplyContext = null,
  cleanupContext = null,
  identity = null,
  rowIndex = null,
}: TracePatchEvidenceOptions): JsonRecord[] {
  const blockers: JsonRecord[] = [];
  const deferredEvidence = aiPatchEvidence.filter(
    (entry) => evidenceResolutionMode(entry) === "deferred_to_common_other",
  );
  for (const trace of ensureArray(traceSummary?.unresolved_traces)) {
    const traceRecord = trace as JsonRecord | null | undefined;
    const actionCode = asText(traceRecord?.action_item_code);
    const matched =
      actionCode &&
      deferredEvidence.some((entry) => patchEvidenceClosureCodes(entry).includes(actionCode));
    const identityMatched =
      actionCode === "elementary_flow_identity_manual_review" &&
      identityDecisionApplyContextHasDecision({
        context: identityDecisionApplyContext,
        datasetType: "flow",
        id: traceRecord?.reference_id,
        version: traceRecord?.reference_version,
        decisionValue: "block_unresolved",
        closesAction: "elementary_flow_identity_manual_review",
      });
    if (!matched && !identityMatched && !isDeterministicAnnualSupplyCleanupTrace(trace)) {
      blockers.push({
        code: "unresolved_trace_patch_evidence_required",
        stage: "full_context_ai_completion",
        message:
          "Final payload contains tiangongfoundry:unresolvedTrace. Each deferred trace must be backed by same-row AI patch evidence with resolution.mode=deferred_to_common_other, or by an AI identity block_unresolved decision for an elementary flow reference.",
        action_item_code: actionCode || null,
        blocked_path: traceRecord?.blocked_path ?? null,
      });
    }
  }

  const sourceTraceEvidence = aiPatchEvidence.filter(
    (entry) => evidenceResolutionMode(entry) === "source_trace_verified",
  );
  for (const trace of ensureArray(traceSummary?.source_exchange_completeness)) {
    const traceRecord = trace as JsonRecord | null | undefined;
    if (
      sourceTraceEvidence.length === 0 &&
      !isDeterministicSourceExchangeCleanupTrace({
        trace,
        cleanupContext,
        identity,
        rowIndex,
      })
    ) {
      blockers.push({
        code: "source_exchange_trace_patch_evidence_required",
        stage: "full_context_ai_completion",
        message:
          "Final payload contains tiangongfoundry:sourceExchangeCompleteness. Source-only exchange acceptance must be backed by same-row AI patch evidence with resolution.mode=source_trace_verified or by a matching deterministic cleanup source-exchange proof for this exact row.",
        status: traceRecord?.status ?? null,
      });
    }
  }
  return blockers;
}

export function readPolicySnapshots(
  repoRoot: string,
  profile: PolicyProfile | null | undefined,
): PolicySnapshot[] {
  const entries: Array<[unknown, unknown]> = [
    ["safety_policy", "docs/safety-policy.md"],
    ...ensureArray(profile?.docs).map((filePath): [unknown, unknown] => [
      "profile_context",
      filePath,
    ]),
  ];
  return entries.map(([kind, filePath]) => {
    const resolved = resolveRepoPath(repoRoot, filePath as string | null | undefined);
    if (!fileExists(resolved)) {
      return {
        kind,
        path: path.isAbsolute(filePath as string) ? filePath : filePath,
        exists: false,
        sha256: null,
      };
    }
    const text = readText(resolved!);
    return {
      kind,
      path: repoRelativePath(repoRoot, resolved!),
      exists: true,
      sha256: sha256Text(text),
    };
  });
}

export function hasImportOnlyTrace(value: unknown): boolean {
  let found = false;
  const visit = (node: unknown): void => {
    if (found || !node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }
    const record = node as JsonRecord;
    const other = record["common:other"];
    if (
      other &&
      typeof other === "object" &&
      !Array.isArray(other) &&
      (Object.hasOwn(other, "tidasimport:sourceTrace") ||
        Object.hasOwn(other, "@xmlns:tidasimport"))
    ) {
      found = true;
      return;
    }
    for (const child of Object.values(record)) visit(child);
  };
  visit(value);
  return found;
}

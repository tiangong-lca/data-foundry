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
import { identityDecisionApplyContextHasDecision } from "./workflow-identity-decision-context.mjs";
import { readFileArtifactIfOption, readJsonLines } from "./workflow-patch-collect.mjs";
import { isAnnualSupplyTarget } from "./workflow-queue-context.ts";

export function patchEvidenceIdentityKey(entry) {
  const id = asText(entry?.dataset_id ?? entry?.entity_id ?? entry?.id);
  const version = asText(entry?.dataset_version ?? entry?.version) || "00.00.001";
  return id ? `${id}@@${version}` : null;
}

export function compactPatchEvidenceEntry(entry) {
  return {
    row_index: Number.isInteger(entry?.row_index) ? entry.row_index : null,
    dataset_id: asText(entry?.dataset_id ?? entry?.entity_id ?? entry?.id) || null,
    dataset_version: asText(entry?.dataset_version ?? entry?.version) || null,
    operation: asText(entry?.op ?? entry?.operation) || null,
    path: asText(entry?.path) || null,
    basis: asText(entry?.basis) || null,
    evidence: entry?.evidence ?? null,
    resolution: entry?.resolution ?? null,
    authoring_package: asText(entry?.authoring_package) || null,
    authoring_package_sha256: asText(entry?.authoring_package_sha256) || null,
    closes_action_items: ensureArray(entry?.closes_action_items),
  };
}

export function readPatchApplyContext(repoRoot, patchApplyArtifact, patchEvidenceFile) {
  const report = patchApplyArtifact?.value ?? null;
  const reportPath = patchApplyArtifact?.path ?? null;
  const evidenceFile =
    patchEvidenceFile ?? readFileArtifactIfOption(repoRoot, report?.files?.patch_evidence) ?? null;
  const expectedEvidenceCount = Number(report?.evidence_count ?? 0);
  const evidenceRows = evidenceFile ? readJsonLines(evidenceFile) : [];
  const byIdentity = new Map();
  const byRowIndex = new Map();
  const globalBlockers = [];

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
      patch_apply_report: reportPath ? repoRelativePath(repoRoot, reportPath) : null,
    });
  }
  if ((expectedEvidenceCount > 0 || patchEvidenceFile) && !evidenceFile) {
    globalBlockers.push({
      code: "patch_evidence_file_missing",
      stage: "ai_patch_apply",
      message:
        "Patch apply report expects patch evidence, but no readable patch evidence JSONL file was provided.",
      patch_apply_report: reportPath ? repoRelativePath(repoRoot, reportPath) : null,
    });
  }

  for (const entry of evidenceRows) {
    const compact = compactPatchEvidenceEntry(entry);
    const key = patchEvidenceIdentityKey(entry);
    if (key) {
      if (!byIdentity.has(key)) byIdentity.set(key, []);
      byIdentity.get(key).push(compact);
      if (compact.dataset_id && !byIdentity.has(compact.dataset_id)) {
        byIdentity.set(compact.dataset_id, []);
      }
      if (compact.dataset_id) byIdentity.get(compact.dataset_id).push(compact);
    }
    if (Number.isInteger(entry?.row_index)) {
      if (!byRowIndex.has(entry.row_index)) byRowIndex.set(entry.row_index, []);
      byRowIndex.get(entry.row_index).push(compact);
    }
  }

  const inputRowsFile = resolveRepoPath(
    repoRoot,
    report?.input_path ?? report?.inputPath ?? report?.files?.input_rows,
  );
  const outputRows = unique([
    report?.out_path,
    report?.outPath,
    report?.output_path,
    report?.outputPath,
    report?.files?.patched_rows,
    report?.files?.output_rows,
  ])
    .flatMap((filePath) => ensureArray(filePath))
    .map((filePath) => resolveRepoPath(repoRoot, filePath))
    .filter(Boolean);

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

export function patchEvidenceForRow(patchApplyContext, identity, rowIndex) {
  if (!patchApplyContext) return [];
  const seen = new Set();
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

export function patchEvidenceClosureCodes(entry) {
  return ensureArray(entry?.closes_action_items)
    .map((item) =>
      asText(
        typeof item === "string"
          ? item
          : (item?.code ??
              item?.action_item_code ??
              item?.actionItemCode ??
              item?.rule_id ??
              item?.ruleId),
      ),
    )
    .filter(Boolean);
}

export function isDeterministicAnnualSupplyCleanupTrace(trace) {
  const actionCode = asText(trace?.action_item_code);
  const blockedPath = asText(trace?.blocked_path);
  const evidence = trace?.evidence ?? {};
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
}) {
  if (!cleanupContext || cleanupContext.status !== "completed") return false;
  const status = asText(trace?.status ?? trace?.decision_status ?? trace?.decisionStatus);
  if (
    !["source_only_output_exchange_verified", "accepted_source_only_output", "verified"].includes(
      status,
    )
  ) {
    return false;
  }
  const evidence = trace?.evidence ?? trace?.source_evidence ?? trace?.trace;
  if (asText(evidence?.source) !== "foundry_deterministic_cleanup") {
    return false;
  }
  const id = asText(identity?.id);
  const version = asText(identity?.version) || "00.00.001";
  const traceHash = asText(trace?.trace_sha256) || sha256Json(trace);
  return ensureArray(cleanupContext.sourceExchangeCompletenessProofs).some((proof) => {
    const proofId = asText(proof?.dataset_id ?? proof?.entity_id ?? proof?.id);
    const proofVersion = asText(proof?.version ?? proof?.dataset_version) || "00.00.001";
    const sourceSignature = asText(proof?.source_exchange_signature_hash);
    const finalSignature = asText(proof?.final_exchange_signature_hash);
    return (
      proofId === id &&
      proofVersion === version &&
      Number(proof?.row_index) === Number(rowIndex) &&
      asText(proof?.trace_hash) === traceHash &&
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
}) {
  const blockers = [];
  const deferredEvidence = aiPatchEvidence.filter(
    (entry) => evidenceResolutionMode(entry) === "deferred_to_common_other",
  );
  for (const trace of ensureArray(traceSummary?.unresolved_traces)) {
    const actionCode = asText(trace?.action_item_code);
    const matched =
      actionCode &&
      deferredEvidence.some((entry) => patchEvidenceClosureCodes(entry).includes(actionCode));
    const identityMatched =
      actionCode === "elementary_flow_identity_manual_review" &&
      identityDecisionApplyContextHasDecision({
        context: identityDecisionApplyContext,
        datasetType: "flow",
        id: trace?.reference_id,
        version: trace?.reference_version,
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
        blocked_path: trace?.blocked_path ?? null,
      });
    }
  }

  const sourceTraceEvidence = aiPatchEvidence.filter(
    (entry) => evidenceResolutionMode(entry) === "source_trace_verified",
  );
  for (const trace of ensureArray(traceSummary?.source_exchange_completeness)) {
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
        status: trace?.status ?? null,
      });
    }
  }
  return blockers;
}

export function readPolicySnapshots(repoRoot, profile) {
  const entries = [
    ["safety_policy", "docs/safety-policy.md"],
    ...ensureArray(profile?.docs).map((filePath) => ["profile_context", filePath]),
  ];
  return entries.map(([kind, filePath]) => {
    const resolved = resolveRepoPath(repoRoot, filePath);
    if (!fileExists(resolved)) {
      return {
        kind,
        path: path.isAbsolute(filePath) ? filePath : filePath,
        exists: false,
        sha256: null,
      };
    }
    const text = readText(resolved);
    return {
      kind,
      path: repoRelativePath(repoRoot, resolved),
      exists: true,
      sha256: sha256Text(text),
    };
  });
}

export function hasImportOnlyTrace(value) {
  let found = false;
  const visit = (node) => {
    if (found || !node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }
    const other = node["common:other"];
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
    for (const child of Object.values(node)) visit(child);
  };
  visit(value);
  return found;
}

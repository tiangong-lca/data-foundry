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

function identityDecisionCompletionStatus(decision) {
  return asText(decision?.decision_status ?? decision?.decisionStatus ?? decision?.status);
}

function referenceKey({ table, id, version }) {
  return [asText(table), asText(id), asText(version)].join("\u0000");
}

export function defaultIdentityReferenceRewriteFile(rowsFile) {
  const rowsDir = path.dirname(rowsFile);
  const candidates = [
    path.join(rowsDir, "identity-reference-rewrites.jsonl"),
    path.join(rowsDir, "identity-flow-reference-rewrites.jsonl"),
    path.join(path.dirname(rowsDir), "identity-reference-rewrites.jsonl"),
    path.join(path.dirname(rowsDir), "identity-flow-reference-rewrites.jsonl"),
  ];
  return candidates.find((candidate) => fileExists(candidate)) ?? null;
}

export function normalizeIdentityReferenceRewriteRow(row) {
  const canonical = row?.canonical ?? row?.target ?? row?.replacement ?? null;
  const original = row?.original ?? row?.source ?? null;
  const normalized = {
    ...row,
    dataset_type: asText(row?.dataset_type ?? row?.datasetType) || null,
    dataset_id: asText(row?.dataset_id ?? row?.datasetId ?? row?.entity_id),
    dataset_version:
      asText(row?.dataset_version ?? row?.datasetVersion ?? row?.version) || "00.00.001",
    relation: asText(row?.relation) || "flow_reference_to_identity_preflight_duplicate",
    path: asText(row?.path) || null,
    action: asText(row?.action) || "rewrite_to_identity_preflight_duplicate_reference",
    reason: asText(row?.reason) || null,
    original,
    canonical,
  };
  normalized.evidence = {
    source: "identity-reference-rewrites.jsonl",
    identity_preflight: row?.identity_preflight ?? null,
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
}) {
  const configuredFile = resolveRepoPath(
    repoRoot,
    options.identityReferenceRewrites ??
      options.identityReferenceRewritesFile ??
      options.identityFlowReferenceRewrites ??
      options.identityFlowReferenceRewritesFile,
  );
  const sourceFile =
    configuredFile && fileExists(configuredFile)
      ? configuredFile
      : defaultIdentityReferenceRewriteFile(rowsFile);
  const sourceRows = sourceFile ? readJsonLines(sourceFile) : [];
  const scopeIdentities = [
    ...[...writeRows.values()].map(({ identity }) => identity),
    ...ensureArray(referenceRows).map((row, index) => datasetIdentity(row, index, datasetType)),
  ];
  const writeKeys = new Set(scopeIdentities.map(identityKey));
  const writeIds = new Set(scopeIdentities.map((identity) => identity.id).filter(Boolean));
  const scopedRows = sourceRows.map(normalizeIdentityReferenceRewriteRow).filter((row) => {
    if (!row.dataset_id) return false;
    const key = `${row.dataset_id}@@${row.dataset_version || "00.00.001"}`;
    return writeKeys.has(key) || writeIds.has(row.dataset_id);
  });
  const byIdentity = new Map();
  for (const row of scopedRows) {
    const key = `${row.dataset_id}@@${row.dataset_version || "00.00.001"}`;
    if (!byIdentity.has(key)) byIdentity.set(key, []);
    byIdentity.get(key).push(row);
    if (!byIdentity.has(row.dataset_id)) byIdentity.set(row.dataset_id, []);
    byIdentity.get(row.dataset_id).push(row);
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
      options.identityReferenceRewriteInputRows ?? options.identityReferenceRewriteInputRowsFile,
    ),
    outputRowsFile: resolveRepoPath(
      repoRoot,
      options.identityReferenceRewriteOutputRows ?? options.identityReferenceRewriteOutputRowsFile,
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

export function identityDecisionDatasetType(decision) {
  return asText(
    decision?.dataset_type ??
      decision?.datasetType ??
      decision?.kind ??
      decision?.entity_type ??
      decision?.entityType,
  );
}

export function identityDecisionDatasetId(decision) {
  return asText(
    decision?.dataset_id ??
      decision?.datasetId ??
      decision?.entity_id ??
      decision?.entityId ??
      decision?.flow_id ??
      decision?.flowId,
  );
}

export function identityDecisionDatasetVersion(decision) {
  return (
    asText(decision?.dataset_version ?? decision?.datasetVersion ?? decision?.version) ||
    "00.00.001"
  );
}

export function identityDecisionIdentityKeys({ datasetType, id, version }) {
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

export function identityDecisionClosesAction(decision, code) {
  return optionList(
    decision?.closes_action_items ??
      decision?.closesActionItems ??
      decision?.resolution?.closes_action_items,
  ).includes(code);
}

export function identityDecisionValue(decision) {
  const raw = asText(
    decision?.identity_decision ??
      decision?.identityDecision ??
      decision?.decision ??
      decision?.resolution?.identity_decision ??
      decision?.resolution?.decision,
  );
  if (["reuse", "reuse_existing", "reference_reuse"].includes(raw)) {
    return "reuse_existing_reference";
  }
  if (["new", "insert", "write_new"].includes(raw)) return "create_new";
  if (["block", "blocked", "unresolved"].includes(raw)) return "block_unresolved";
  return raw;
}

export function identityDecisionCanonical(decision) {
  const canonical =
    decision?.canonical ??
    decision?.selected_reference ??
    decision?.selectedReference ??
    decision?.resolution?.canonical ??
    decision?.resolution?.selected_reference ??
    null;
  if (!canonical || typeof canonical !== "object") return null;
  const id = asText(
    canonical.ref_object_id ?? canonical.refObjectId ?? canonical.id ?? canonical["@refObjectId"],
  );
  if (!id) return null;
  return {
    table: asText(canonical.table) || "flows",
    ref_object_id: id,
    version:
      asText(canonical.version ?? canonical.ref_version ?? canonical["@version"]) || "00.00.001",
  };
}

export function identityDecisionPackageReference(decision) {
  return asText(
    decision?.authoring_package ??
      decision?.authoringPackage ??
      decision?.authoring_context?.authoring_package ??
      decision?.authoringContext?.authoringPackage,
  );
}

export function identityDecisionPackageSha(decision) {
  return asText(
    decision?.authoring_package_sha256 ??
      decision?.authoringPackageSha256 ??
      decision?.authoring_context?.authoring_package_sha256 ??
      decision?.authoringContext?.authoringPackageSha256,
  );
}

export function readIdentityDecisionApplyContext(repoRoot, identityDecisionApplyArtifact) {
  if (!identityDecisionApplyArtifact) return null;
  const report = identityDecisionApplyArtifact.value ?? {};
  const decisionsFile = resolveRepoPath(
    repoRoot,
    report.decisions_file ||
      report.decisionsFile ||
      report.files?.decisions ||
      report.files?.evidence,
  );
  let decisions = [];
  if (decisionsFile && fileExists(decisionsFile)) {
    decisions = normalizeClassificationDecisionRows(readJsonOrJsonl(decisionsFile));
  }
  if (decisions.length === 0) {
    decisions = normalizeClassificationDecisionRows(report.decisions);
  }
  const byIdentity = new Map();
  for (const decision of decisions) {
    const datasetType = identityDecisionDatasetType(decision) || asText(report.dataset_type);
    const id = identityDecisionDatasetId(decision);
    const version = identityDecisionDatasetVersion(decision);
    for (const key of identityDecisionIdentityKeys({ datasetType, id, version })) {
      if (!byIdentity.has(key)) byIdentity.set(key, []);
      byIdentity.get(key).push(decision);
    }
  }
  const packageProofs = [];
  const seenPackages = new Set();
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
  const inputRows = ensureArray(report.rows_file ?? report.rowsFile ?? report.files?.input_rows)
    .map((filePath) => resolveRepoPath(repoRoot, filePath))
    .filter(Boolean);
  const outputRows = ensureArray(report.files?.output_rows)
    .map((filePath) => resolveRepoPath(repoRoot, filePath))
    .filter(Boolean);
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
    referenceRows: ensureArray(report.files?.reference_rows)
      .map((filePath) => resolveRepoPath(repoRoot, filePath))
      .filter(Boolean),
    identityReferenceRewritesFile: resolveRepoPath(
      repoRoot,
      report.files?.identity_reference_rewrites,
    ),
  };
}

export function mergeIdentityDecisionApplyContexts(contexts) {
  const available = ensureArray(contexts).filter(Boolean);
  if (available.length === 0) return null;
  if (available.length === 1) return available[0];

  const byIdentity = new Map();
  const decisions = [];
  const authoringPackageProofs = [];
  const inputRows = [];
  const outputRows = [];
  const referenceRows = [];
  const identityReferenceRewritesFiles = [];
  const reportPaths = [];
  const seenPackages = new Set();
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
      byIdentity.get(key).push(...rows);
    }
    for (const proof of ensureArray(context.authoringPackageProofs)) {
      const key = JSON.stringify({
        package: proof?.authoring_package ?? proof?.path ?? proof?.package_ref,
        expected: proof?.expected_sha256,
        actual: proof?.actual_sha256,
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

export function readIdentityDecisionApplyContexts(repoRoot, artifacts) {
  const artifactList = ensureArray(artifacts).filter(Boolean);
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
}) {
  if (!context) return [];
  for (const key of identityDecisionIdentityKeys({ datasetType, id, version })) {
    const rows = context.byIdentity.get(key);
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
}) {
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
}) {
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

export function identityDecisionUnresolvedReferenceKeys(context) {
  const keys = new Set();
  for (const decision of ensureArray(context?.decisions)) {
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

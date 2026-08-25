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
import { readRowsIfExists } from "./workflow-patch-collect.mjs";

export function readUnresolvedExchangeExternalizationContext(repoRoot, artifact) {
  if (!artifact) return null;
  const report = artifact.value ?? {};
  const inputRowsFile = resolveRepoPath(
    repoRoot,
    report.input_rows_file ??
      report.inputRowsFile ??
      report.files?.input_rows ??
      report.files?.inputRows,
  );
  const outputRowsFile = resolveRepoPath(
    repoRoot,
    report.output_rows_file ??
      report.outputRowsFile ??
      report.files?.output_rows ??
      report.files?.outputRows,
  );
  const tracesFile = resolveRepoPath(
    repoRoot,
    report.traces_file ??
      report.tracesFile ??
      report.files?.traces ??
      report.files?.unresolved_exchanges,
  );
  const traces = readJsonLinesIfExists(tracesFile);
  const affectedKeys = new Set();
  const externalizedExchangeCountByIdentity = new Map();
  for (const trace of traces) {
    const id = asText(trace?.dataset_id ?? trace?.entity_id);
    const version = asText(trace?.dataset_version ?? trace?.version) || "00.00.001";
    if (!id) continue;
    const key = `process:${id}@@${version}`;
    affectedKeys.add(key);
    externalizedExchangeCountByIdentity.set(
      key,
      (externalizedExchangeCountByIdentity.get(key) ?? 0) + 1,
    );
  }
  const outputPayloadSha256ByIdentity = new Map();
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
    reportPathRelative: repoRelativePath(repoRoot, artifact.path),
    externalizedExchanges: Number(report.counts?.externalized_exchanges ?? 0) || 0,
    affectedRows: Number(report.counts?.affected_rows ?? 0) || 0,
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

export function readCanonicalSupportRewriteContext(repoRoot, artifact) {
  if (!artifact) return null;
  const report = artifact.value ?? {};
  const inputRowsFile = resolveRepoPath(
    repoRoot,
    report.rows_file ??
      report.rowsFile ??
      report.input_rows_file ??
      report.inputRowsFile ??
      report.files?.input_rows ??
      report.files?.inputRows,
  );
  const outputRowsFile = resolveRepoPath(
    repoRoot,
    report.output_rows_file ??
      report.outputRowsFile ??
      report.files?.output_rows ??
      report.files?.outputRows,
  );
  const blockersFile = resolveRepoPath(
    repoRoot,
    report.files?.canonical_support_blockers ?? report.files?.blockers ?? report.blockers_file,
  );
  const deferredRowsFile = resolveRepoPath(
    repoRoot,
    report.files?.deferred_rows ??
      report.files?.deferredRows ??
      report.deferred_rows_file ??
      report.deferredRowsFile,
  );
  const rewritesFile = resolveRepoPath(
    repoRoot,
    report.files?.canonical_support_rewrites ?? report.files?.rewrites ?? report.rewrites_file,
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
    counts: report.counts && typeof report.counts === "object" ? report.counts : {},
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
    reportPathRelative: repoRelativePath(repoRoot, artifact.path),
    blockersFileRelative: repoRelativeArtifactPath(repoRoot, blockersFile),
    rewritesFileRelative: repoRelativeArtifactPath(repoRoot, rewritesFile),
    blockerRows,
    blockers: hardBlockers,
    deferredBlockers,
    rewrites: readJsonLinesIfExists(rewritesFile),
  };
}

export function readRowsFileTransformContext(repoRoot, artifact, kind) {
  if (!artifact) return null;
  const report = artifact.value ?? {};
  const inputRowsFile = resolveRepoPath(
    repoRoot,
    report.rows_file ??
      report.rowsFile ??
      report.input_rows_file ??
      report.inputRowsFile ??
      report.input_path ??
      report.inputPath ??
      report.files?.input_rows ??
      report.files?.inputRows ??
      report.files?.input,
  );
  const outputRowsFile = resolveRepoPath(
    repoRoot,
    report.output_rows_file ??
      report.outputRowsFile ??
      report.out_path ??
      report.outPath ??
      report.files?.output_rows ??
      report.files?.outputRows ??
      report.files?.cleaned_rows ??
      report.files?.cleanedRows ??
      report.files?.output,
  );
  return {
    kind,
    artifact,
    status: asText(report.status),
    counts: report.counts && typeof report.counts === "object" ? report.counts : {},
    sourceExchangeCompletenessProofs: ensureArray(
      report.source_exchange_completeness_proofs ?? report.proofs?.source_exchange_completeness,
    ),
    inputRowsFile,
    outputRowsFile,
    inputRowsFileRelative: repoRelativeArtifactPath(repoRoot, inputRowsFile),
    outputRowsFileRelative: repoRelativeArtifactPath(repoRoot, outputRowsFile),
    reportPathRelative: repoRelativePath(repoRoot, artifact.path),
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

export function readSourceContactRewriteContext(repoRoot, artifact) {
  return readRowsFileTransformContext(repoRoot, artifact, "source_contact_rewrite");
}

export function readCleanupTransformContext(repoRoot, artifact) {
  return readRowsFileTransformContext(repoRoot, artifact, "curation_cleanup");
}

export function unresolvedExchangeExternalizationRowsForIdentity(context, identity) {
  if (!context || !identity?.id) return [];
  const key = `process:${identity.id}@@${identity.version || "00.00.001"}`;
  return context.traces.filter((trace) => {
    const id = asText(trace?.dataset_id ?? trace?.entity_id);
    const version = asText(trace?.dataset_version ?? trace?.version) || "00.00.001";
    return key === `process:${id}@@${version}`;
  });
}

export function rowsFileChainsThroughUnresolvedExchangeExternalization({
  repoRoot,
  upstreamFile,
  finalFile,
  unresolvedExchangeExternalizationContext,
}) {
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

export function cleanupInputRowsFile(repoRoot, cleanupArtifact) {
  const inputRows =
    cleanupArtifact?.value?.rows_file ??
    cleanupArtifact?.value?.rowsFile ??
    cleanupArtifact?.value?.input_path ??
    cleanupArtifact?.value?.inputPath;
  return inputRows ? resolveRepoPath(repoRoot, inputRows) : null;
}

export function decisionApplyExpectedRowsFile({ repoRoot, rowsFile, cleanupArtifact }) {
  return cleanupArtifact ? cleanupInputRowsFile(repoRoot, cleanupArtifact) : rowsFile;
}

export function decisionApplyOutputRowsMatch(repoRoot, context, expectedRowsFile) {
  return Boolean(
    expectedRowsFile &&
    context?.outputRows.some((filePath) => sameRowsArtifact(repoRoot, filePath, expectedRowsFile)),
  );
}

export function decisionApplyInputRowsMatch(repoRoot, context, expectedRowsFile) {
  return Boolean(
    expectedRowsFile &&
    context?.inputRows.some((filePath) => sameRowsArtifact(repoRoot, filePath, expectedRowsFile)),
  );
}

export function rowsFileTransformEntriesFromDecisionApply(context, kind) {
  const entries = [];
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

export function rowsFileTransformEntriesFromPatchApply(context) {
  if (!context?.inputRowsFile || !context?.outputRows?.length) return [];
  return context.outputRows.map((outputRowsFile) => ({
    kind: "patch_apply",
    inputRowsFile: context.inputRowsFile,
    outputRowsFile,
    inputPayloadSha256ByIdentity: context.inputPayloadSha256ByIdentity,
    outputPayloadSha256ByIdentity: context.outputPayloadSha256ByIdentity,
  }));
}

export function rowsFileTransformEntryFromIdentityReferenceRewrite(context) {
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

export function rowsFileTransformEntryFromUnresolvedExchangeExternalization(context) {
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

export function rowsFileTransformEntryFromCanonicalSupportRewrite(context) {
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

export function rowsFileTransformEntryFromRowsFileContext(context, kind) {
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
}) {
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

export function sameRowsArtifact(repoRoot, left, right) {
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
}) {
  if (!expectedRowsFile) return false;
  const reachable = [];
  const addReachable = (filePath) => {
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
}) {
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
  repoRoot,
  context,
  patchApplyContext,
  expectedRowsFile,
) {
  return Boolean(
    expectedRowsFile &&
    patchApplyContext?.inputRowsFile &&
    decisionApplyOutputRowsMatch(repoRoot, context, patchApplyContext.inputRowsFile) &&
    patchApplyContext.outputRows.some((filePath) =>
      sameArtifactPath(repoRoot, filePath, expectedRowsFile),
    ),
  );
}

export function patchApplyOutputChainsThroughIdentityRewrite({
  repoRoot,
  patchOut,
  cleanupInput,
  identityReferenceRewriteContext,
}) {
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
}) {
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
}) {
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
  repoRoot,
  context,
  patchApplyContext,
  identityReferenceRewriteContext,
  expectedRowsFile,
) {
  return Boolean(
    expectedRowsFile &&
    patchApplyContext?.inputRowsFile &&
    identityReferenceRewriteContext?.inputRowsFile &&
    identityReferenceRewriteContext?.outputRowsFile &&
    decisionApplyOutputRowsMatch(repoRoot, context, patchApplyContext.inputRowsFile) &&
    patchApplyContext.outputRows.some((filePath) =>
      sameArtifactPath(repoRoot, filePath, identityReferenceRewriteContext.inputRowsFile),
    ) &&
    sameArtifactPath(repoRoot, identityReferenceRewriteContext.outputRowsFile, expectedRowsFile),
  );
}

export function decisionApplyOutputRowsChainThroughIdentityRewrite(
  repoRoot,
  context,
  identityReferenceRewriteContext,
  expectedRowsFile,
) {
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
  repoRoot,
  context,
  identityReferenceRewriteContext,
  unresolvedExchangeExternalizationContext,
  expectedRowsFile,
) {
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
  repoRoot,
  context,
  classificationDecisionApplyContext,
  expectedRowsFile,
) {
  return Boolean(
    expectedRowsFile &&
    classificationDecisionApplyContext?.inputRows.some((filePath) =>
      decisionApplyOutputRowsMatch(repoRoot, context, filePath),
    ) &&
    decisionApplyOutputRowsMatch(repoRoot, classificationDecisionApplyContext, expectedRowsFile),
  );
}

export function decisionApplyOutputRowsChainThroughClassificationAndIdentityRewrite(
  repoRoot,
  context,
  classificationDecisionApplyContext,
  identityReferenceRewriteContext,
  expectedRowsFile,
) {
  return Boolean(
    expectedRowsFile &&
    identityReferenceRewriteContext?.inputRowsFile &&
    identityReferenceRewriteContext?.outputRowsFile &&
    classificationDecisionApplyContext?.outputRows.some((filePath) =>
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
  repoRoot,
  context,
  classificationDecisionApplyContext,
  identityReferenceRewriteContext,
  unresolvedExchangeExternalizationContext,
  expectedRowsFile,
) {
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

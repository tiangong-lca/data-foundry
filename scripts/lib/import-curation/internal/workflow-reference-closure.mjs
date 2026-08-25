import { fullContextAiCompletionRequirement } from "./context-inputs.ts";
import { datasetIdentity, identityKey } from "./dataset-payload.ts";
import {
  datasetTypePlural,
  referenceOnlySupportDatasetTypes,
  supportDatasetTypes,
} from "./dataset-types.ts";
import {
  authoringPackageProofsFromCurationGate,
  authoringPackageProofsFromPatchCollect,
  curationGateContextHasKind,
  curationGateContextHasPattern,
  evidenceResolutionContextKinds,
  evidenceResolutionMode,
  fullContextPackageProofBlockers,
} from "./full-context-proof.ts";
import { externalizeImportTraceMetadata } from "./prewrite-cleanup.ts";
import {
  asText,
  ensureArray,
  fileExists,
  repoRelativePath,
  resolveRepoPath,
} from "./runtime-io.ts";
import { foundryTraceSummary } from "./trace-summary.ts";
import {
  buildClassificationDecisionFullContextBlockers,
  buildIdentityDecisionFullContextBlockers,
  buildLocationDecisionFullContextBlockers,
  decisionApplyContextRelevantToRowsFile,
} from "./workflow-decision-full-context.ts";
import { normalizeDryRunOperation } from "./workflow-dry-run-context.ts";
import { prewriteIdentityBlockers } from "./workflow-identity-preflight.mjs";
import { readJsonLines } from "./workflow-patch-collect.ts";
import {
  hasImportOnlyTrace,
  patchEvidenceForRow,
  tracePatchEvidenceBlockers,
} from "./workflow-patch-evidence-context.ts";
import {
  deterministicRowsFileTransformEntries,
  rowsFileReachableThroughTransformChain,
} from "./workflow-row-transform-context.ts";
import { allowedPatchResolutionModes, jsonPointerToken } from "./workflow-semantic-actions.ts";

// part-11.mjs
export function sourceContactRewriteSemanticEvidenceCount({
  repoRoot,
  datasetType,
  rowsFile,
  sourceContactRewriteContext,
  canonicalSupportRewriteContext,
  cleanupContext,
}) {
  if (!["support", "source", "contact"].includes(asText(datasetType).toLowerCase())) return 0;
  if (sourceContactRewriteContext?.status !== "completed") return 0;
  if (!sourceContactRewriteContext?.inputRowsFile || !sourceContactRewriteContext?.outputRowsFile) {
    return 0;
  }
  const reachesFinalRows = rowsFileReachableThroughTransformChain({
    repoRoot,
    startFiles: [sourceContactRewriteContext.outputRowsFile],
    expectedRowsFile: rowsFile,
    transforms: deterministicRowsFileTransformEntries({
      sourceContactRewriteContext,
      canonicalSupportRewriteContext,
      cleanupContext,
    }),
  });
  if (!reachesFinalRows) return 0;
  const counts = sourceContactRewriteContext.counts ?? {};
  return Math.max(
    Number(counts.output_rows ?? 0) || 0,
    Number(counts.contact_reference_rewrites ?? 0) || 0,
    Number(counts.source_reference_rewrites ?? 0) || 0,
    1,
  );
}

export function buildFullContextAiCompletionBlockers({
  repoRoot,
  profile,
  datasetType,
  curationGateArtifact,
  rowsFile,
  patchApplyArtifact,
  patchApplyContext,
  patchCollectArtifact,
  cleanupArtifact,
  classificationDecisionApplyArtifact,
  classificationDecisionApplyContext,
  locationDecisionApplyArtifact,
  locationDecisionApplyContext,
  identityDecisionApplyArtifact,
  identityDecisionApplyContext,
  identityReferenceRewriteContext,
  unresolvedExchangeExternalizationContext,
  sourceContactRewriteContext,
  canonicalSupportRewriteContext,
  cleanupContext,
}) {
  const requirement = fullContextAiCompletionRequirement(profile, datasetType, repoRoot);
  if (!requirement) return [];
  const blockers = [];
  const curationPackageProofs = curationGateArtifact
    ? authoringPackageProofsFromCurationGate(repoRoot, curationGateArtifact)
    : [];
  const patchTaskPackageProofs = patchCollectArtifact
    ? authoringPackageProofsFromPatchCollect(repoRoot, patchCollectArtifact)
    : [];
  if (!curationGateArtifact) {
    blockers.push({
      code: "full_context_curation_gate_required",
      stage: "full_context_ai_completion",
      message:
        "This profile requires a post-authoring curation gate built with full schema/YAML/context before remote write planning.",
    });
  } else {
    for (const kind of requirement.requiredContextKinds) {
      if (!curationGateContextHasKind(curationGateArtifact, kind)) {
        blockers.push({
          code: "full_context_curation_gate_context_kind_missing",
          stage: "full_context_ai_completion",
          message: `Curation gate report does not prove full-context authoring kind '${kind}'.`,
          required_kind: kind,
          artifact: repoRelativePath(repoRoot, curationGateArtifact.path),
        });
      }
    }
    for (const pattern of requirement.requiredContextFilePatterns) {
      if (!curationGateContextHasPattern(curationGateArtifact, pattern)) {
        blockers.push({
          code: "full_context_curation_gate_context_file_missing",
          stage: "full_context_ai_completion",
          message: `Curation gate report does not reference required context file '${pattern}'.`,
          required_file_pattern: pattern,
          artifact: repoRelativePath(repoRoot, curationGateArtifact.path),
        });
      }
    }
  }

  for (const proof of [...curationPackageProofs, ...patchTaskPackageProofs]) {
    blockers.push(...fullContextPackageProofBlockers({ requirement, proof }));
  }

  const hasClassificationDecisionProof =
    classificationDecisionApplyArtifact &&
    classificationDecisionApplyContext?.status === "completed" &&
    classificationDecisionApplyContext.decisions.length > 0 &&
    decisionApplyContextRelevantToRowsFile({
      repoRoot,
      rowsFile,
      cleanupArtifact,
      context: classificationDecisionApplyContext,
    });
  const hasLocationDecisionProof =
    locationDecisionApplyArtifact &&
    locationDecisionApplyContext?.status === "completed" &&
    locationDecisionApplyContext.decisions.length > 0 &&
    decisionApplyContextRelevantToRowsFile({
      repoRoot,
      rowsFile,
      cleanupArtifact,
      context: locationDecisionApplyContext,
    });
  const hasIdentityDecisionProof =
    identityDecisionApplyArtifact &&
    identityDecisionApplyContext?.status === "completed" &&
    identityDecisionApplyContext.decisions.length > 0 &&
    decisionApplyContextRelevantToRowsFile({
      repoRoot,
      rowsFile,
      cleanupArtifact,
      context: identityDecisionApplyContext,
    });
  const hasDecisionProof =
    hasClassificationDecisionProof || hasLocationDecisionProof || hasIdentityDecisionProof;
  const hasSourceContactRewriteProof =
    sourceContactRewriteSemanticEvidenceCount({
      repoRoot,
      datasetType,
      rowsFile,
      sourceContactRewriteContext,
      canonicalSupportRewriteContext,
      cleanupContext,
    }) > 0;

  blockers.push(
    ...buildClassificationDecisionFullContextBlockers({
      repoRoot,
      rowsFile,
      cleanupArtifact,
      requirement,
      classificationDecisionApplyArtifact,
      classificationDecisionApplyContext,
      locationDecisionApplyContext,
      patchApplyContext,
      identityDecisionApplyContext,
      identityReferenceRewriteContext,
      unresolvedExchangeExternalizationContext,
      sourceContactRewriteContext,
      canonicalSupportRewriteContext,
      cleanupContext,
    }),
  );
  blockers.push(
    ...buildLocationDecisionFullContextBlockers({
      repoRoot,
      rowsFile,
      cleanupArtifact,
      requirement,
      locationDecisionApplyArtifact,
      locationDecisionApplyContext,
      patchApplyContext,
      identityDecisionApplyContext,
      identityReferenceRewriteContext,
      unresolvedExchangeExternalizationContext,
      sourceContactRewriteContext,
      canonicalSupportRewriteContext,
      cleanupContext,
    }),
  );
  blockers.push(
    ...buildIdentityDecisionFullContextBlockers({
      repoRoot,
      rowsFile,
      cleanupArtifact,
      requirement,
      identityDecisionApplyArtifact,
      identityDecisionApplyContext,
      classificationDecisionApplyContext,
      identityReferenceRewriteContext,
      unresolvedExchangeExternalizationContext,
      sourceContactRewriteContext,
      canonicalSupportRewriteContext,
      cleanupContext,
    }),
  );

  if (!patchCollectArtifact && !hasDecisionProof && !hasSourceContactRewriteProof) {
    blockers.push({
      code: "full_context_ai_completion_output_required",
      stage: "full_context_ai_completion",
      message:
        "This profile requires AI authoring output evidence from dataset-identity-decisions-apply, dataset-classification-decisions-apply, dataset-location-decisions-apply, or dataset-authoring-patch-collect before remote write planning.",
      proof: requirement.proof,
    });
  } else if (
    patchCollectArtifact &&
    patchCollectArtifact.value?.status !== "ready_for_patch_apply"
  ) {
    blockers.push({
      code: "full_context_ai_patch_collect_not_ready",
      stage: "full_context_ai_completion",
      message: `dataset-authoring-patch-collect status is ${patchCollectArtifact.value?.status ?? "missing"}.`,
      artifact: repoRelativePath(repoRoot, patchCollectArtifact.path),
    });
  }

  if (!patchApplyArtifact && !hasDecisionProof && !hasSourceContactRewriteProof) {
    blockers.push({
      code: "full_context_ai_deterministic_apply_required",
      stage: "full_context_ai_completion",
      message:
        "This profile requires full-context AI semantic outputs to be deterministically applied through identity/classification/location decision apply or patch apply before remote write planning.",
      proof: requirement.proof,
    });
  } else if (patchApplyArtifact && patchApplyArtifact.value?.status !== "completed") {
    blockers.push({
      code: "full_context_ai_patch_apply_not_completed",
      stage: "full_context_ai_completion",
      message: `dataset-patch-apply status is ${patchApplyArtifact.value?.status ?? "missing"}.`,
      artifact: repoRelativePath(repoRoot, patchApplyArtifact.path),
    });
  }

  const evidenceRows = ensureArray(patchApplyContext?.evidenceRows);
  if (patchApplyArtifact && evidenceRows.length === 0) {
    blockers.push({
      code: "full_context_ai_patch_evidence_required",
      stage: "full_context_ai_completion",
      message:
        "AI patch apply completed without patch evidence rows; semantic completion must be traceable to authoring packages.",
      artifact: repoRelativePath(repoRoot, patchApplyArtifact.path),
    });
  }
  const missingPackageHash = evidenceRows.filter(
    (entry) => !asText(entry?.authoring_package_sha256),
  );
  if (missingPackageHash.length > 0) {
    blockers.push({
      code: "full_context_ai_patch_package_hash_missing",
      stage: "full_context_ai_completion",
      message:
        "Every AI patch evidence row must include authoring_package_sha256 to prove it used the full authoring package context.",
      count: missingPackageHash.length,
      artifact: patchApplyArtifact ? repoRelativePath(repoRoot, patchApplyArtifact.path) : null,
    });
  }
  const knownPackageHashes = new Set(
    [...curationPackageProofs, ...patchTaskPackageProofs]
      .map((proof) => asText(proof?.sha256))
      .filter(Boolean),
  );
  const unknownPackageHash = evidenceRows.filter((entry) => {
    const hash = asText(entry?.authoring_package_sha256);
    return hash && !knownPackageHashes.has(hash);
  });
  if (unknownPackageHash.length > 0) {
    blockers.push({
      code: "full_context_ai_patch_package_hash_unknown",
      stage: "full_context_ai_completion",
      message:
        "AI patch evidence authoring_package_sha256 must match a readable full-context authoring package from the patch task manifest or curation gate.",
      count: unknownPackageHash.length,
      artifact: patchApplyArtifact ? repoRelativePath(repoRoot, patchApplyArtifact.path) : null,
    });
  }
  const missingClosures = evidenceRows.filter(
    (entry) => ensureArray(entry?.closes_action_items).length === 0,
  );
  if (missingClosures.length > 0) {
    blockers.push({
      code: "full_context_ai_patch_action_closure_missing",
      stage: "full_context_ai_completion",
      message:
        "Every AI patch evidence row must close at least one authoring action item for this profile.",
      count: missingClosures.length,
      artifact: patchApplyArtifact ? repoRelativePath(repoRoot, patchApplyArtifact.path) : null,
    });
  }
  const missingResolution = evidenceRows.filter((entry) => !evidenceResolutionMode(entry));
  if (missingResolution.length > 0) {
    blockers.push({
      code: "full_context_ai_patch_resolution_missing",
      stage: "full_context_ai_completion",
      message:
        "Every AI patch evidence row must include resolution.mode to explain how the action item was completed or deferred.",
      count: missingResolution.length,
      artifact: patchApplyArtifact ? repoRelativePath(repoRoot, patchApplyArtifact.path) : null,
    });
  }
  const invalidResolutionMode = evidenceRows.filter((entry) => {
    const mode = evidenceResolutionMode(entry);
    return mode && !allowedPatchResolutionModes.has(mode);
  });
  if (invalidResolutionMode.length > 0) {
    blockers.push({
      code: "full_context_ai_patch_resolution_mode_invalid",
      stage: "full_context_ai_completion",
      message: "AI patch evidence contains unsupported resolution.mode values.",
      count: invalidResolutionMode.length,
      artifact: patchApplyArtifact ? repoRelativePath(repoRoot, patchApplyArtifact.path) : null,
    });
  }
  const missingResolutionContext = [];
  for (const entry of evidenceRows) {
    const usedKinds = new Set(evidenceResolutionContextKinds(entry));
    for (const requiredKind of requirement.requiredContextKinds) {
      if (!usedKinds.has(requiredKind)) {
        missingResolutionContext.push({ entry, requiredKind });
      }
    }
  }
  if (missingResolutionContext.length > 0) {
    blockers.push({
      code: "full_context_ai_patch_resolution_context_missing",
      stage: "full_context_ai_completion",
      message:
        "AI patch evidence resolution.used_context_kinds must include every required full-context kind for this profile.",
      count: missingResolutionContext.length,
      required_context_kinds: requirement.requiredContextKinds,
      artifact: patchApplyArtifact ? repoRelativePath(repoRoot, patchApplyArtifact.path) : null,
    });
  }
  return blockers;
}

export const referenceTableByTypeToken = [
  ["contact", "contacts"],
  ["compliance system", "sources"],
  ["compliancesystem", "sources"],
  ["flow property", "flowproperties"],
  ["flowproperty", "flowproperties"],
  ["flow data", "flows"],
  ["lcia method", "lciamethods"],
  ["lciamethod", "lciamethods"],
  ["life cycle model", "lifecyclemodels"],
  ["lifecycle model", "lifecyclemodels"],
  ["lifecyclemodel", "lifecyclemodels"],
  ["process", "processes"],
  ["source", "sources"],
  ["unit group", "unitgroups"],
  ["unitgroup", "unitgroups"],
];

export const referenceTableByPathToken = [
  ["flowproperties", "flowproperties"],
  ["flowproperty", "flowproperties"],
  ["flowdataset", "flows"],
  ["lciamethod", "lciamethods"],
  ["lifecyclemodel", "lifecyclemodels"],
  ["datasetformat", "sources"],
  ["compliancesystem", "sources"],
  ["datasource", "sources"],
  ["source", "sources"],
  ["processdataset", "processes"],
  ["unitgroup", "unitgroups"],
  ["commissioner", "contacts"],
  ["personorentity", "contacts"],
  ["ownership", "contacts"],
  ["contact", "contacts"],
];

export function referenceTableFromType(value) {
  const text = asText(value).toLowerCase();
  if (!text) return null;
  const match = referenceTableByTypeToken.find(([token]) => text.includes(token));
  return match?.[1] ?? null;
}

export function referenceTableFromPath(pathSegments) {
  const text = pathSegments.join(".").toLowerCase();
  if (!text) return null;
  const compact = text.replace(/[^a-z0-9]/gu, "");
  const match = referenceTableByPathToken.find(([token]) => compact.includes(token));
  return match?.[1] ?? null;
}

export function referenceKey({ table, id, version }) {
  return [asText(table), asText(id), asText(version)].join("\u0000");
}

export function plannedRootReferenceKeys(rows, datasetType) {
  return new Set(
    rows.map((row, index) => {
      const identity = datasetIdentity(row, index, datasetType);
      return referenceKey({
        table: datasetTypePlural[identity.dataset_type || datasetType],
        id: identity.id,
        version: identity.version,
      });
    }),
  );
}

export function plannedRootReferenceIds(rows, datasetType) {
  return new Set(
    rows.map((row, index) => datasetIdentity(row, index, datasetType).id).filter(Boolean),
  );
}

export function collectDatasetReferences(value, pathSegments = [], refs = []) {
  if (isFoundryTracePathSegments(pathSegments)) return refs;
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      collectDatasetReferences(item, [...pathSegments, String(index)], refs),
    );
    return refs;
  }
  if (!value || typeof value !== "object") return refs;

  const id = asText(
    value["@refObjectId"] ?? value.refObjectId ?? value.ref_object_id ?? value.ref_id,
  );
  if (id) {
    const version = asText(
      value["@version"] ?? value.version ?? value.refVersion ?? value.ref_version,
    );
    const table =
      referenceTableFromType(value["@type"] ?? value.type) ?? referenceTableFromPath(pathSegments);
    refs.push({
      table,
      id,
      version,
      path: pathSegments.length > 0 ? `/${pathSegments.map(jsonPointerToken).join("/")}` : "/",
      type: asText(value["@type"] ?? value.type) || null,
      short_description:
        asText(value["common:shortDescription"]?.["#text"]) ||
        asText(value.shortDescription) ||
        null,
    });
  }

  for (const [key, child] of Object.entries(value)) {
    collectDatasetReferences(child, [...pathSegments, key], refs);
  }
  return refs;
}

export function isFoundryTracePathSegments(pathSegments) {
  return (
    pathSegments.includes("common:other") &&
    pathSegments.some(
      (segment) =>
        segment.startsWith("tiangongfoundry:") && segment.toLowerCase().includes("trace"),
    )
  );
}

export function remoteVerifyChecks(repoRoot, remoteVerifyArtifact) {
  const checks = ensureArray(remoteVerifyArtifact?.value?.checks);
  if (checks.length > 0) return checks;
  const checksFile = remoteVerifyArtifact?.value?.files?.checks;
  const checksPath = resolveRepoPath(repoRoot, checksFile);
  return checksPath && fileExists(checksPath) ? readJsonLines(checksPath) : [];
}

export function remoteVerifiedReferenceKeys(
  repoRoot,
  remoteVerifyArtifact,
  { acceptExactExistingOutdated = false } = {},
) {
  // `version_outdated` is returned by the CLI remote-verify ONLY when the exact
  // referenced version EXISTS remotely but a newer version is also published
  // (otherwise the status would be `missing_version`). For a *reference* row the
  // referenced dataset existing at that exact version is sufficient proof of the
  // write dependency closure — the "use latest" preference is a publish-quality
  // concern, not a reference-integrity one. Under the BAFU My Data override we
  // accept such references (e.g. account-local FP/UG at state_code=0 referenced
  // at their source version while a 01.00.000 row also exists).
  const acceptableStatuses = acceptExactExistingOutdated
    ? new Set(["ok", "version_outdated"])
    : new Set(["ok"]);
  return new Set(
    remoteVerifyChecks(repoRoot, remoteVerifyArtifact)
      .filter(
        (check) =>
          asText(check?.role) === "reference" &&
          acceptableStatuses.has(asText(check?.status)) &&
          asText(check?.table) &&
          asText(check?.id),
      )
      .map((check) =>
        referenceKey({
          table: check.table,
          id: check.id,
          version: check.version,
        }),
      ),
  );
}

export function identityReferenceRewriteProofKeys(context) {
  return new Set(
    ensureArray(context?.scopedRows)
      .map((row) => row?.canonical)
      .filter(Boolean)
      .map((canonical) => ({
        table: asText(canonical?.table) || "flows",
        id: asText(canonical?.ref_object_id ?? canonical?.refObjectId ?? canonical?.id),
        version:
          asText(canonical?.version ?? canonical?.["@version"] ?? canonical?.ref_version) ||
          "00.00.001",
      }))
      .filter((reference) => reference.id)
      .map(referenceKey),
  );
}

export function buildReferenceClosureBlockers({
  repoRoot,
  rows,
  datasetType,
  remoteVerifyArtifact,
  provenReferenceKeys = new Set(),
  unresolvedReferenceKeys = new Set(),
  allowAccountLocalSupportAndElementary = false,
}) {
  const plannedRootKeys = plannedRootReferenceKeys(rows, datasetType);
  const remoteOkKeys = remoteVerifiedReferenceKeys(repoRoot, remoteVerifyArtifact, {
    acceptExactExistingOutdated: allowAccountLocalSupportAndElementary,
  });
  const blockers = [];
  const seen = new Set();
  rows.forEach((row, rowIndex) => {
    for (const ref of collectDatasetReferences(row)) {
      if (!ref.table) {
        const key = `unsupported\u0000${rowIndex}\u0000${ref.id}\u0000${ref.path}`;
        if (seen.has(key)) continue;
        seen.add(key);
        blockers.push({
          code: "reference_closure_type_unresolved",
          stage: "reference_closure",
          message:
            "A TIDAS reference could not be mapped to a dataset table, so Foundry cannot prove the write dependency closure.",
          row_index: rowIndex,
          reference_id: ref.id,
          reference_version: ref.version || null,
          reference_type: ref.type,
          path: ref.path,
        });
        continue;
      }
      const key = referenceKey(ref);
      if (
        plannedRootKeys.has(key) ||
        remoteOkKeys.has(key) ||
        provenReferenceKeys.has(key) ||
        unresolvedReferenceKeys.has(key)
      ) {
        continue;
      }
      const seenKey = `${rowIndex}\u0000${key}\u0000${ref.path}`;
      if (seen.has(seenKey)) continue;
      seen.add(seenKey);
      blockers.push({
        code: remoteVerifyArtifact
          ? "reference_closure_unproven"
          : "reference_closure_remote_verify_required",
        stage: "reference_closure",
        message: remoteVerifyArtifact
          ? "Referenced dataset is neither covered by the exact write scope nor proven reusable by the supplied remote verification report."
          : "Referenced dataset is outside the exact write scope; run remote verification after support rows exist, or include the dependency in an earlier write scope before commit handoff.",
        row_index: rowIndex,
        table: ref.table,
        reference_id: ref.id,
        reference_version: ref.version || null,
        path: ref.path,
      });
    }
  });
  return blockers;
}

export function failureReasons(row) {
  return ensureArray(row?.reason ?? row?.reasons ?? row?.validation?.issues ?? row?.issues).map(
    (item) => ({
      code: item?.code ?? "failure",
      stage: item?.stage ?? null,
      path: item?.path ?? null,
      message: item?.message ?? item?.error?.message ?? null,
      validator: item?.validator ?? null,
    }),
  );
}

export function decisionCounts(items) {
  const counts = {};
  for (const item of items) {
    counts[item.decision] = (counts[item.decision] ?? 0) + 1;
  }
  return counts;
}

export function operationCounts(items) {
  const counts = {};
  for (const item of items) {
    if (!item.operation) continue;
    counts[item.operation] = (counts[item.operation] ?? 0) + 1;
  }
  return counts;
}

export function buildWriteCandidateItem({
  repoRoot,
  datasetType,
  row,
  identity,
  rowIndex,
  schemaRow,
  curationEntity,
  curationGateProvided,
  dryRun,
  remoteVerifyBlockers,
  targetUserId,
  cleanupStatus,
  patchApplyContext,
  sourceReferenceRewritesByKey,
  identityReferenceRewritesByKey,
  identityDecisionApplyContext,
  cleanupContext = null,
  evidenceScopeBlockers = [],
  allowAccountLocalSupportAndElementary = false,
  profile = null,
}) {
  const key = identityKey(identity);
  const blockers = [];
  blockers.push(...evidenceScopeBlockers);
  const invalidDryRunReport = evidenceScopeBlockers.some(
    (blocker) => blocker?.code === "dry_run_report_is_commit_report",
  );
  const aiPatchEvidence = patchEvidenceForRow(patchApplyContext, identity, rowIndex);
  const sourceReferenceRewrites = sourceReferenceRewritesByKey?.get(key) ?? [];
  const identityReferenceRewrites = identityReferenceRewritesByKey?.get(key) ?? [];
  for (const blocker of patchApplyContext?.globalBlockers ?? []) {
    blockers.push(blocker);
  }
  const schemaStatus = schemaRow?.status ?? "not_found";
  if (schemaStatus !== "valid") {
    blockers.push({
      code: "schema_not_valid",
      stage: "schema",
      message: `Schema status is ${schemaStatus}.`,
      issues: ensureArray(schemaRow?.issues),
    });
  }
  if (referenceOnlySupportDatasetTypes.has(datasetType) && !allowAccountLocalSupportAndElementary) {
    blockers.push({
      code: "reference_only_support_type_write_blocked",
      stage: "support_reference_policy",
      message:
        "Unit Groups and Flow Properties are reference-only support data for Foundry imports. Select existing database rows and rewrite references instead of writing account-local My Data rows.",
    });
  }
  blockers.push(
    ...prewriteIdentityBlockers(identity.payload, datasetType, repoRoot, {
      allowAccountLocalSupportAndElementary,
      profile,
    }),
  );

  const curationStatus = curationEntity?.status ?? null;
  if (curationGateProvided && !curationEntity) {
    blockers.push({
      code: "curation_gate_entity_missing",
      stage: "foundry_curation",
      message: "Curation gate report does not contain this write candidate.",
    });
  }
  if (curationEntity && !["ready", "ready_with_profile_waivers"].includes(curationStatus)) {
    blockers.push({
      code: "curation_gate_not_ready",
      stage: "foundry_curation",
      message: `Curation entity status is ${curationStatus}.`,
      authoring_package: curationEntity.authoring_package ?? null,
    });
  }

  if (remoteVerifyBlockers.has(identity.id)) {
    blockers.push({
      code: "remote_reference_closure_blocked",
      stage: "remote_verify",
      message: "Remote verification reported a blocker involving this entity.",
    });
  }

  if (hasImportOnlyTrace(row)) {
    blockers.push({
      code: "import_only_trace_not_cleaned",
      stage: "prewrite_cleanup",
      message: "Payload still contains tidasimport:sourceTrace or @xmlns:tidasimport.",
    });
  }

  if (!targetUserId) {
    blockers.push({
      code: "target_user_id_required",
      stage: "owner_guard",
      message: "Remote write planning requires an explicit target user id.",
    });
  }

  if (cleanupStatus !== "completed") {
    blockers.push({
      code: "curation_cleanup_required",
      stage: "prewrite_cleanup",
      message:
        "dataset-curation-cleanup must complete for the exact write rows before remote write planning.",
    });
  }

  let dryRunStatus = "missing";
  let operation = null;
  let dryRunEvidence = null;
  if (invalidDryRunReport) {
    dryRunStatus = "invalid_report";
  } else if (datasetType === "flow") {
    const success = dryRun.flow?.success.get(key);
    const failure = dryRun.flow?.failures.get(key);
    if (success) {
      dryRunStatus = "success";
      operation = normalizeDryRunOperation(success.operation);
      dryRunEvidence = success;
    } else if (failure) {
      dryRunStatus = "failure";
      blockers.push({
        code: "dry_run_failed",
        stage: "dry_run",
        message: "flow publish-version dry-run reported this row as failed.",
        reasons: failureReasons(failure),
      });
      dryRunEvidence = { reasons: failureReasons(failure) };
    }
  } else if (datasetType === "process") {
    const prepared = dryRun.process?.prepared.get(key);
    const failure = dryRun.process?.failures.get(key);
    if (prepared) {
      dryRunStatus = "success";
      operation = "save_draft_prepared";
      dryRunEvidence = prepared;
    } else if (failure) {
      dryRunStatus = "failure";
      blockers.push({
        code: "dry_run_failed",
        stage: "dry_run",
        message: "process save-draft dry-run reported this row as failed.",
        reasons: failureReasons(failure),
      });
      dryRunEvidence = { reasons: failureReasons(failure) };
    }
  } else if (datasetType === "lifecyclemodel") {
    const prepared = dryRun.lifecyclemodel?.prepared.get(key);
    const failure = dryRun.lifecyclemodel?.failures.get(key);
    if (prepared) {
      dryRunStatus = "success";
      operation = "save_draft_prepared";
      dryRunEvidence = prepared;
    } else if (failure) {
      dryRunStatus = "failure";
      blockers.push({
        code: "dry_run_failed",
        stage: "dry_run",
        message: "lifecyclemodel save-draft dry-run reported this row as failed.",
        reasons: failureReasons(failure),
      });
      dryRunEvidence = { reasons: failureReasons(failure) };
    }
  } else if (
    supportDatasetTypes.has(datasetType) ||
    referenceOnlySupportDatasetTypes.has(datasetType)
  ) {
    // unitgroup/flowproperty are reference-only by default but, under the
    // account-local override (P1a), they are committed through the same
    // dataset save-draft (--type auto) dry-run as contacts/sources, so their
    // prepared/failure evidence lives in the datasetSaveDraft maps too.
    const prepared = dryRun.datasetSaveDraft?.prepared.get(key);
    const failure = dryRun.datasetSaveDraft?.failures.get(key);
    if (prepared) {
      dryRunStatus = "success";
      operation = normalizeDryRunOperation(prepared.operation);
      dryRunEvidence = prepared;
    } else if (failure) {
      dryRunStatus = "failure";
      blockers.push({
        code: "dry_run_failed",
        stage: "dry_run",
        message: "dataset save-draft dry-run reported this support row as failed.",
        reasons: failureReasons(failure),
      });
      dryRunEvidence = { reasons: failureReasons(failure) };
    }
  }

  if (dryRunStatus === "missing") {
    blockers.push({
      code: "dry_run_evidence_missing",
      stage: "dry_run",
      message: "No matching dry-run success or failure artifact was found for this row.",
    });
  }

  const traceSummary = foundryTraceSummary({
    datasetType,
    identity,
    row,
    rowIndex,
  });
  blockers.push(
    ...tracePatchEvidenceBlockers({
      traceSummary,
      aiPatchEvidence,
      identityDecisionApplyContext,
      cleanupContext,
      identity,
      rowIndex,
    }),
  );
  const decision = blockers.length > 0 ? "blocked" : "write_or_update";
  return {
    dataset_type: datasetType,
    entity_id: identity.id,
    version: identity.version,
    role: "write_candidate",
    decision,
    operation,
    target_user_id: targetUserId,
    schema_status: schemaStatus,
    curation_status: curationStatus,
    ai_patch_apply_status: patchApplyContext?.status ?? "not_provided",
    ai_patch_evidence_count: aiPatchEvidence.length,
    ai_patch_evidence: aiPatchEvidence,
    source_reference_rewrite_count: sourceReferenceRewrites.length,
    source_reference_rewrites: sourceReferenceRewrites,
    identity_reference_rewrite_count: identityReferenceRewrites.length,
    identity_reference_rewrites: identityReferenceRewrites,
    dry_run_status: dryRunStatus,
    trace_summary_count: traceSummary.import_trace_summary_count,
    unresolved_trace_count: traceSummary.unresolved_trace_count,
    unresolved_exchange_trace_count: traceSummary.unresolved_exchange_trace_count,
    source_exchange_completeness_count: traceSummary.source_exchange_completeness_count,
    foundry_traces: {
      unresolved_traces: traceSummary.unresolved_traces,
      unresolved_exchange_traces: traceSummary.unresolved_exchange_traces,
      source_exchange_completeness: traceSummary.source_exchange_completeness,
    },
    blockers,
    dry_run_evidence: dryRunEvidence,
    source_rows_file: repoRelativePath(
      repoRoot,
      resolveRepoPath(repoRoot, identity.sourceRowsFile) ?? "",
    ),
  };
}

export function buildReferenceReuseItems({
  repoRoot,
  datasetType,
  rows,
  writeCandidateKeys,
  identityReferenceRewritesByKey,
}) {
  return rows.map((row, index) => {
    const identity = datasetIdentity(row, index, datasetType);
    const key = identityKey(identity);
    const identityReferenceRewrites =
      identityReferenceRewritesByKey?.get(key) ??
      identityReferenceRewritesByKey?.get(identity.id) ??
      [];
    const traceSummary = foundryTraceSummary({
      datasetType,
      identity,
      row,
      rowIndex: index,
    });
    const alreadyWriteCandidate = writeCandidateKeys.has(key);
    // Reference-reuse rows are never written, but the closure proof still
    // requires their payload snapshot to be free of raw import-only trace.
    // Write-candidate rows get this scrubbing via curation cleanup; reference
    // rows skip it, so a benign converter import trace would otherwise block
    // closure on a row we never write. Externalize it here (after the trace
    // summary is captured for reporting) so the raw tidasimport:* trace becomes
    // the sanctioned Foundry summary breadcrumb instead of a blocker. Matches
    // externalizeImportTraceMetadata's use on the write-candidate path.
    if (hasImportOnlyTrace(row)) {
      externalizeImportTraceMetadata(row);
    }
    const blockers = hasImportOnlyTrace(row)
      ? [
          {
            code: "reference_payload_contains_import_only_trace",
            stage: "prewrite_cleanup",
            message:
              "Reference-only rows are not written, but the payload snapshot still contains import-only trace metadata.",
          },
        ]
      : [];
    return {
      dataset_type: datasetType,
      entity_id: identity.id,
      version: identity.version,
      role: "reference_reuse",
      decision: alreadyWriteCandidate ? "covered_by_write_candidate" : "reuse_existing_reference",
      operation: null,
      target_user_id: null,
      schema_status: "not_required_for_reference_reuse",
      curation_status: "not_required_for_reference_reuse",
      dry_run_status: "not_required_for_reference_reuse",
      identity_reference_rewrite_count: identityReferenceRewrites.length,
      identity_reference_rewrites: identityReferenceRewrites,
      canonical_references: identityReferenceRewrites
        .map((rewrite) => rewrite.canonical)
        .filter(Boolean),
      trace_summary_count: traceSummary.import_trace_summary_count,
      unresolved_trace_count: traceSummary.unresolved_trace_count,
      unresolved_exchange_trace_count: traceSummary.unresolved_exchange_trace_count,
      source_exchange_completeness_count: traceSummary.source_exchange_completeness_count,
      foundry_traces: {
        unresolved_traces: traceSummary.unresolved_traces,
        unresolved_exchange_traces: traceSummary.unresolved_exchange_traces,
        source_exchange_completeness: traceSummary.source_exchange_completeness,
      },
      blockers,
    };
  });
}

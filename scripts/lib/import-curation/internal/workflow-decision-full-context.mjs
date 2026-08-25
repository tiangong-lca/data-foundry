import {
  fullContextDecisionTaskProofBlockers,
  fullContextPackageProofBlockers,
  payloadSha256ByIdentityForRows,
} from "./full-context-proof.ts";
import {
  asText,
  ensureArray,
  optionList,
  repoRelativePath,
  sameArtifactPath,
  unique,
} from "./runtime-io.ts";
import { readClassificationDecisionApplyContext } from "./workflow-decision-apply-context.ts";
import {
  identityDecisionCanonical,
  identityDecisionClosesAction,
  identityDecisionPackageReference,
  identityDecisionPackageSha,
  identityDecisionValue,
} from "./workflow-identity-decision-context.ts";
import {
  decisionApplyExpectedRowsFile,
  decisionApplyInputRowsMatch,
  decisionApplyOutputRowsChainThroughClassification,
  decisionApplyOutputRowsChainThroughClassificationAndIdentityRewrite,
  decisionApplyOutputRowsChainThroughClassificationIdentityRewriteAndUnresolvedExchangeExternalization,
  decisionApplyOutputRowsChainThroughIdentityRewrite,
  decisionApplyOutputRowsChainThroughIdentityRewriteAndUnresolvedExchangeExternalization,
  decisionApplyOutputRowsChainThroughPatch,
  decisionApplyOutputRowsChainThroughPatchAndIdentityRewrite,
  decisionApplyOutputRowsMatch,
  decisionApplyOutputRowsReachableThroughDeterministicTransforms,
  rowsFileChainsThroughUnresolvedExchangeExternalization,
  sameRowsArtifact,
} from "./workflow-row-transform-context.mjs";

// part-10.mjs
export function decisionApplyOutputRowsChainThroughUnresolvedExchangeExternalization(
  repoRoot,
  context,
  unresolvedExchangeExternalizationContext,
  expectedRowsFile,
) {
  return Boolean(
    expectedRowsFile &&
    unresolvedExchangeExternalizationContext?.inputRowsFile &&
    decisionApplyOutputRowsMatch(
      repoRoot,
      context,
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

export function decisionApplyOutputRowsChainThroughPatchAndUnresolvedExchangeExternalization(
  repoRoot,
  context,
  patchApplyContext,
  unresolvedExchangeExternalizationContext,
  expectedRowsFile,
) {
  return Boolean(
    expectedRowsFile &&
    patchApplyContext?.inputRowsFile &&
    unresolvedExchangeExternalizationContext?.inputRowsFile &&
    decisionApplyOutputRowsMatch(repoRoot, context, patchApplyContext.inputRowsFile) &&
    patchApplyContext.outputRows.some((filePath) =>
      sameArtifactPath(repoRoot, filePath, unresolvedExchangeExternalizationContext.inputRowsFile),
    ) &&
    rowsFileChainsThroughUnresolvedExchangeExternalization({
      repoRoot,
      upstreamFile: unresolvedExchangeExternalizationContext.inputRowsFile,
      finalFile: expectedRowsFile,
      unresolvedExchangeExternalizationContext,
    }),
  );
}

function decisionApplyRowsEquivalentToExpected(repoRoot, context, expectedRowsFile) {
  return Boolean(
    expectedRowsFile &&
    context?.inputRows?.some((filePath) =>
      sameRowsArtifact(repoRoot, filePath, expectedRowsFile),
    ) &&
    context?.outputRows?.some((filePath) => sameRowsArtifact(repoRoot, filePath, expectedRowsFile)),
  );
}

function decisionDatasetType(decision) {
  const explicit = asText(decision?.dataset_type ?? decision?.datasetType);
  if (explicit) return explicit;
  const categoryType = asText(decision?.category_type ?? decision?.categoryType);
  if (categoryType === "process") return "process";
  if (categoryType.startsWith("flow")) return "flow";
  if (["source", "contact", "flowproperty", "unitgroup", "lifecyclemodel"].includes(categoryType)) {
    return categoryType;
  }
  return null;
}

function decisionTargetIdentityKeys(context) {
  return ensureArray(context?.decisions)
    .map((decision) => {
      const datasetType = decisionDatasetType(decision);
      const id = asText(decision?.dataset_id ?? decision?.datasetId ?? decision?.id);
      const version =
        asText(decision?.dataset_version ?? decision?.datasetVersion ?? decision?.version) ||
        "00.00.001";
      return datasetType && id ? `${datasetType}:${id}@@${version}` : null;
    })
    .filter(Boolean);
}

export function decisionApplyContextRelevantToExpectedRowsFile({
  repoRoot,
  context,
  expectedRowsFile,
}) {
  if (!context || !expectedRowsFile) return true;
  if (
    decisionApplyInputRowsMatch(repoRoot, context, expectedRowsFile) ||
    decisionApplyOutputRowsMatch(repoRoot, context, expectedRowsFile)
  ) {
    return true;
  }
  const expectedKeys = new Set(payloadSha256ByIdentityForRows(repoRoot, [expectedRowsFile]).keys());
  if (expectedKeys.size === 0) return true;
  if (decisionTargetIdentityKeys(context).some((key) => expectedKeys.has(key))) return true;
  const contextKeys = [
    ...Array.from(context.inputPayloadSha256ByIdentity?.keys?.() ?? []),
    ...Array.from(context.outputPayloadSha256ByIdentity?.keys?.() ?? []),
  ];
  return contextKeys.some((key) => expectedKeys.has(key));
}

export function decisionApplyContextCoversExpectedRowsIdentity({
  repoRoot,
  context,
  expectedRowsFile,
}) {
  if (!context || !expectedRowsFile) return false;
  const expectedKeys = new Set(payloadSha256ByIdentityForRows(repoRoot, [expectedRowsFile]).keys());
  if (expectedKeys.size === 0) return false;
  const contextKeys = new Set([
    ...decisionTargetIdentityKeys(context),
    ...Array.from(context.inputPayloadSha256ByIdentity?.keys?.() ?? []),
    ...Array.from(context.outputPayloadSha256ByIdentity?.keys?.() ?? []),
  ]);
  if (contextKeys.size === 0) return false;
  return Array.from(expectedKeys).every((key) => contextKeys.has(key));
}

export function decisionApplyContextRelevantToRowsFile({
  repoRoot,
  rowsFile,
  cleanupArtifact,
  context,
}) {
  return decisionApplyContextRelevantToExpectedRowsFile({
    repoRoot,
    context,
    expectedRowsFile: decisionApplyExpectedRowsFile({ repoRoot, rowsFile, cleanupArtifact }),
  });
}

export function decisionApplyOutputRowsChainThroughPatchIdentityRewriteAndUnresolvedExchangeExternalization(
  repoRoot,
  context,
  patchApplyContext,
  identityReferenceRewriteContext,
  unresolvedExchangeExternalizationContext,
  expectedRowsFile,
) {
  return Boolean(
    expectedRowsFile &&
    patchApplyContext?.inputRowsFile &&
    identityReferenceRewriteContext?.inputRowsFile &&
    identityReferenceRewriteContext?.outputRowsFile &&
    unresolvedExchangeExternalizationContext?.inputRowsFile &&
    decisionApplyOutputRowsMatch(repoRoot, context, patchApplyContext.inputRowsFile) &&
    patchApplyContext.outputRows.some((filePath) =>
      sameArtifactPath(repoRoot, filePath, identityReferenceRewriteContext.inputRowsFile),
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

export function identityDecisionApplyProvesReferenceRewrite(
  repoRoot,
  context,
  identityReferenceRewriteContext,
) {
  const decisionRewriteFiles = unique(
    [
      ...ensureArray(context?.identityReferenceRewritesFiles),
      context?.identityReferenceRewritesFile,
    ].filter(Boolean),
  );
  if (decisionRewriteFiles.length === 0 || !identityReferenceRewriteContext?.sourceFile) {
    return false;
  }
  return decisionRewriteFiles.some((decisionRewriteFile) => {
    const directlyUsed = sameArtifactPath(
      repoRoot,
      decisionRewriteFile,
      identityReferenceRewriteContext.sourceFile,
    );
    const chainedThroughProcessRewrite = identityReferenceRewriteContext.scopedRows.some(
      (row) =>
        sameArtifactPath(repoRoot, row?.rewrite_source?.file, decisionRewriteFile) ||
        sameArtifactPath(repoRoot, row?.rewriteSource?.file, decisionRewriteFile),
    );
    return Boolean(
      identityReferenceRewriteContext.scopedRows.length > 0 &&
      (directlyUsed || chainedThroughProcessRewrite),
    );
  });
}

export function classificationDecisionContextKinds(decision) {
  return [
    ...optionList(decision?.used_context_kinds ?? decision?.usedContextKinds),
    ...optionList(
      decision?.resolution?.used_context_kinds ?? decision?.resolution?.usedContextKinds,
    ),
    ...optionList(decision?.evidence?.used_context_kinds ?? decision?.evidence?.usedContextKinds),
  ];
}

export function classificationDecisionContextBundleSha256(decision) {
  return asText(
    decision?.authoring_context?.context_bundle_sha256 ??
      decision?.authoringContext?.contextBundleSha256 ??
      decision?.authoring_context_sha256 ??
      decision?.context_bundle_sha256 ??
      decision?.contextBundleSha256,
  );
}

export function classificationDecisionCompletionStatus(decision) {
  return asText(decision?.decision_status ?? decision?.decisionStatus ?? decision?.status);
}

export function decisionTaskProofListFromContext(context) {
  const proofs = ensureArray(context?.decisionTaskProofs).filter(Boolean);
  if (proofs.length > 0) return proofs;
  return context?.decisionTaskProof ? [context.decisionTaskProof] : [];
}

export function decisionTaskContextBundleHashesFromContext(context) {
  return unique(
    decisionTaskProofListFromContext(context).map((proof) => proof.context_bundle_sha256),
  );
}

export function buildClassificationDecisionFullContextBlockers({
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
}) {
  const blockers = [];
  if (!classificationDecisionApplyArtifact) return blockers;
  const context = classificationDecisionApplyContext;
  const expectedRowsFile = decisionApplyExpectedRowsFile({
    repoRoot,
    rowsFile,
    cleanupArtifact,
  });
  if (
    !decisionApplyContextRelevantToExpectedRowsFile({
      repoRoot,
      context,
      expectedRowsFile,
    })
  ) {
    return blockers;
  }
  if (context?.status !== "completed") {
    blockers.push({
      code: "full_context_ai_classification_apply_not_completed",
      stage: "full_context_ai_completion",
      message: `dataset-classification-decisions-apply status is ${context?.status || "missing"}.`,
      artifact: repoRelativePath(repoRoot, classificationDecisionApplyArtifact.path),
    });
  }
  const decisionTaskProofs = decisionTaskProofListFromContext(context);
  if (decisionTaskProofs.length === 0) {
    blockers.push(
      ...fullContextDecisionTaskProofBlockers({
        requirement,
        proof: null,
        label: "classification",
      }),
    );
  } else {
    for (const proof of decisionTaskProofs) {
      blockers.push(
        ...fullContextDecisionTaskProofBlockers({
          requirement,
          proof,
          label: "classification",
        }),
      );
    }
  }
  if (cleanupArtifact && !expectedRowsFile) {
    blockers.push({
      code: "full_context_ai_classification_cleanup_input_missing",
      stage: "full_context_ai_completion",
      message:
        "Classification decision proof cannot be chained because the cleanup report does not record its input rows_file.",
      rows_file: repoRelativePath(repoRoot, rowsFile),
      artifact: repoRelativePath(repoRoot, classificationDecisionApplyArtifact.path),
      cleanup_report: repoRelativePath(repoRoot, cleanupArtifact.path),
    });
  } else if (
    !decisionApplyOutputRowsMatch(repoRoot, context, expectedRowsFile) &&
    !decisionApplyRowsEquivalentToExpected(repoRoot, context, expectedRowsFile) &&
    !decisionApplyContextCoversExpectedRowsIdentity({
      repoRoot,
      context,
      expectedRowsFile,
    }) &&
    !decisionApplyOutputRowsChainThroughPatch(
      repoRoot,
      context,
      patchApplyContext,
      expectedRowsFile,
    ) &&
    !decisionApplyOutputRowsChainThroughPatchAndIdentityRewrite(
      repoRoot,
      context,
      patchApplyContext,
      identityReferenceRewriteContext,
      expectedRowsFile,
    ) &&
    !decisionApplyOutputRowsChainThroughIdentityRewrite(
      repoRoot,
      context,
      identityReferenceRewriteContext,
      expectedRowsFile,
    ) &&
    !decisionApplyOutputRowsChainThroughUnresolvedExchangeExternalization(
      repoRoot,
      context,
      unresolvedExchangeExternalizationContext,
      expectedRowsFile,
    ) &&
    !decisionApplyOutputRowsChainThroughPatchAndUnresolvedExchangeExternalization(
      repoRoot,
      context,
      patchApplyContext,
      unresolvedExchangeExternalizationContext,
      expectedRowsFile,
    ) &&
    !decisionApplyOutputRowsChainThroughPatchIdentityRewriteAndUnresolvedExchangeExternalization(
      repoRoot,
      context,
      patchApplyContext,
      identityReferenceRewriteContext,
      unresolvedExchangeExternalizationContext,
      expectedRowsFile,
    ) &&
    !decisionApplyOutputRowsReachableThroughDeterministicTransforms({
      repoRoot,
      context,
      expectedRowsFile,
      patchApplyContext,
      locationDecisionApplyContext,
      identityDecisionApplyContext,
      identityReferenceRewriteContext,
      unresolvedExchangeExternalizationContext,
      sourceContactRewriteContext,
      canonicalSupportRewriteContext,
      cleanupContext,
    })
  ) {
    blockers.push({
      code: "full_context_ai_classification_rows_mismatch",
      stage: "full_context_ai_completion",
      message:
        "Classification decision apply report files.output_rows must match the cleanup input rows file, the exact mutation rows file, or the input rows of a completed patch apply report whose output rows then match that cleanup/mutation file.",
      rows_file: repoRelativePath(repoRoot, rowsFile),
      expected_output_rows_file: repoRelativePath(repoRoot, expectedRowsFile),
      patch_apply_input_rows_file: patchApplyContext?.inputRowsFile
        ? repoRelativePath(repoRoot, patchApplyContext.inputRowsFile)
        : null,
      patch_apply_output_rows_files:
        patchApplyContext?.outputRows.map((file) => repoRelativePath(repoRoot, file)) ?? [],
      identity_reference_rewrite_input_rows_file: identityReferenceRewriteContext?.inputRowsFile
        ? repoRelativePath(repoRoot, identityReferenceRewriteContext.inputRowsFile)
        : null,
      identity_reference_rewrite_output_rows_file: identityReferenceRewriteContext?.outputRowsFile
        ? repoRelativePath(repoRoot, identityReferenceRewriteContext.outputRowsFile)
        : null,
      unresolved_exchange_externalization_input_rows_file:
        unresolvedExchangeExternalizationContext?.inputRowsFile
          ? repoRelativePath(repoRoot, unresolvedExchangeExternalizationContext.inputRowsFile)
          : null,
      unresolved_exchange_externalization_output_rows_file:
        unresolvedExchangeExternalizationContext?.outputRowsFile
          ? repoRelativePath(repoRoot, unresolvedExchangeExternalizationContext.outputRowsFile)
          : null,
      source_contact_rewrite_input_rows_file: sourceContactRewriteContext?.inputRowsFile
        ? repoRelativePath(repoRoot, sourceContactRewriteContext.inputRowsFile)
        : null,
      source_contact_rewrite_output_rows_file: sourceContactRewriteContext?.outputRowsFile
        ? repoRelativePath(repoRoot, sourceContactRewriteContext.outputRowsFile)
        : null,
      canonical_support_rewrite_input_rows_file: canonicalSupportRewriteContext?.inputRowsFile
        ? repoRelativePath(repoRoot, canonicalSupportRewriteContext.inputRowsFile)
        : null,
      canonical_support_rewrite_output_rows_file: canonicalSupportRewriteContext?.outputRowsFile
        ? repoRelativePath(repoRoot, canonicalSupportRewriteContext.outputRowsFile)
        : null,
      cleanup_input_rows_file: cleanupContext?.inputRowsFile
        ? repoRelativePath(repoRoot, cleanupContext.inputRowsFile)
        : null,
      cleanup_output_rows_file: cleanupContext?.outputRowsFile
        ? repoRelativePath(repoRoot, cleanupContext.outputRowsFile)
        : null,
      artifact: repoRelativePath(repoRoot, classificationDecisionApplyArtifact.path),
    });
  }
  if (!context?.decisions.length) {
    blockers.push({
      code: "full_context_ai_classification_decision_evidence_required",
      stage: "full_context_ai_completion",
      message:
        "Classification decision apply report must point to at least one AI-authored classification decision.",
      artifact: repoRelativePath(repoRoot, classificationDecisionApplyArtifact.path),
    });
    return blockers;
  }
  const missingBasis = context.decisions.filter((decision) => !asText(decision?.basis));
  if (missingBasis.length > 0) {
    blockers.push({
      code: "full_context_ai_classification_basis_missing",
      stage: "full_context_ai_completion",
      message: "Every classification decision must include basis.",
      count: missingBasis.length,
      artifact: repoRelativePath(repoRoot, classificationDecisionApplyArtifact.path),
    });
  }
  const missingEvidence = context.decisions.filter(
    (decision) => !decision?.evidence || typeof decision.evidence !== "object",
  );
  if (missingEvidence.length > 0) {
    blockers.push({
      code: "full_context_ai_classification_evidence_missing",
      stage: "full_context_ai_completion",
      message: "Every classification decision must include structured evidence.",
      count: missingEvidence.length,
      artifact: repoRelativePath(repoRoot, classificationDecisionApplyArtifact.path),
    });
  }
  const notCompleted = context.decisions.filter(
    (decision) => classificationDecisionCompletionStatus(decision) !== "completed",
  );
  if (notCompleted.length > 0) {
    blockers.push({
      code: "full_context_ai_classification_decision_status_not_completed",
      stage: "full_context_ai_completion",
      message:
        "Every classification decision used as full-context AI evidence must declare decision_status=completed.",
      count: notCompleted.length,
      artifact: repoRelativePath(repoRoot, classificationDecisionApplyArtifact.path),
    });
  }
  const missingContextKinds = [];
  for (const decision of context.decisions) {
    const usedKinds = new Set(classificationDecisionContextKinds(decision));
    for (const requiredKind of requirement.requiredContextKinds) {
      if (!usedKinds.has(requiredKind)) {
        missingContextKinds.push({ decision, requiredKind });
      }
    }
  }
  if (missingContextKinds.length > 0) {
    blockers.push({
      code: "full_context_ai_classification_context_missing",
      stage: "full_context_ai_completion",
      message:
        "Classification decision used_context_kinds must include every required full-context kind for this profile.",
      count: missingContextKinds.length,
      required_context_kinds: requirement.requiredContextKinds,
      artifact: repoRelativePath(repoRoot, classificationDecisionApplyArtifact.path),
    });
  }
  const expectedContextBundleSha256AnyOf = decisionTaskContextBundleHashesFromContext(context);
  if (expectedContextBundleSha256AnyOf.length > 0) {
    const mismatchedContextBundle = context.decisions.filter(
      (decision) =>
        !expectedContextBundleSha256AnyOf.includes(
          classificationDecisionContextBundleSha256(decision),
        ),
    );
    if (mismatchedContextBundle.length > 0) {
      blockers.push({
        code: "full_context_ai_classification_context_bundle_mismatch",
        stage: "full_context_ai_completion",
        message:
          "Every classification decision must reference one of the AI decision task context_bundle_sha256 values.",
        count: mismatchedContextBundle.length,
        expected_context_bundle_sha256:
          expectedContextBundleSha256AnyOf.length === 1
            ? expectedContextBundleSha256AnyOf[0]
            : null,
        expected_context_bundle_sha256_any_of: expectedContextBundleSha256AnyOf,
        artifact: repoRelativePath(repoRoot, classificationDecisionApplyArtifact.path),
      });
    }
  }
  return blockers;
}

export function readLocationDecisionApplyContext(repoRoot, locationDecisionApplyArtifact) {
  return readClassificationDecisionApplyContext(
    repoRoot,
    locationDecisionApplyArtifact,
    "location_decision_apply",
  );
}

export function buildLocationDecisionFullContextBlockers({
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
}) {
  const blockers = [];
  if (!locationDecisionApplyArtifact) return blockers;
  const context = locationDecisionApplyContext;
  const expectedRowsFile = decisionApplyExpectedRowsFile({
    repoRoot,
    rowsFile,
    cleanupArtifact,
  });
  if (
    !decisionApplyContextRelevantToExpectedRowsFile({
      repoRoot,
      context,
      expectedRowsFile,
    })
  ) {
    return blockers;
  }
  if (context?.status !== "completed") {
    blockers.push({
      code: "full_context_ai_location_apply_not_completed",
      stage: "full_context_ai_completion",
      message: `dataset-location-decisions-apply status is ${context?.status || "missing"}.`,
      artifact: repoRelativePath(repoRoot, locationDecisionApplyArtifact.path),
    });
  }
  const decisionTaskProofs = decisionTaskProofListFromContext(context);
  if (decisionTaskProofs.length === 0) {
    blockers.push(
      ...fullContextDecisionTaskProofBlockers({
        requirement,
        proof: null,
        label: "location",
      }),
    );
  } else {
    for (const proof of decisionTaskProofs) {
      blockers.push(
        ...fullContextDecisionTaskProofBlockers({
          requirement,
          proof,
          label: "location",
        }),
      );
    }
  }
  if (cleanupArtifact && !expectedRowsFile) {
    blockers.push({
      code: "full_context_ai_location_cleanup_input_missing",
      stage: "full_context_ai_completion",
      message:
        "Location decision proof cannot be chained because the cleanup report does not record its input rows_file.",
      rows_file: repoRelativePath(repoRoot, rowsFile),
      artifact: repoRelativePath(repoRoot, locationDecisionApplyArtifact.path),
      cleanup_report: repoRelativePath(repoRoot, cleanupArtifact.path),
    });
  } else if (
    !decisionApplyOutputRowsMatch(repoRoot, context, expectedRowsFile) &&
    !decisionApplyRowsEquivalentToExpected(repoRoot, context, expectedRowsFile) &&
    !decisionApplyContextCoversExpectedRowsIdentity({
      repoRoot,
      context,
      expectedRowsFile,
    }) &&
    !decisionApplyOutputRowsChainThroughPatch(
      repoRoot,
      context,
      patchApplyContext,
      expectedRowsFile,
    ) &&
    !decisionApplyOutputRowsChainThroughPatchAndIdentityRewrite(
      repoRoot,
      context,
      patchApplyContext,
      identityReferenceRewriteContext,
      expectedRowsFile,
    ) &&
    !decisionApplyOutputRowsChainThroughIdentityRewrite(
      repoRoot,
      context,
      identityReferenceRewriteContext,
      expectedRowsFile,
    ) &&
    !decisionApplyOutputRowsChainThroughUnresolvedExchangeExternalization(
      repoRoot,
      context,
      unresolvedExchangeExternalizationContext,
      expectedRowsFile,
    ) &&
    !decisionApplyOutputRowsChainThroughPatchAndUnresolvedExchangeExternalization(
      repoRoot,
      context,
      patchApplyContext,
      unresolvedExchangeExternalizationContext,
      expectedRowsFile,
    ) &&
    !decisionApplyOutputRowsChainThroughPatchIdentityRewriteAndUnresolvedExchangeExternalization(
      repoRoot,
      context,
      patchApplyContext,
      identityReferenceRewriteContext,
      unresolvedExchangeExternalizationContext,
      expectedRowsFile,
    ) &&
    !decisionApplyOutputRowsReachableThroughDeterministicTransforms({
      repoRoot,
      context,
      expectedRowsFile,
      patchApplyContext,
      identityDecisionApplyContext,
      identityReferenceRewriteContext,
      unresolvedExchangeExternalizationContext,
      sourceContactRewriteContext,
      canonicalSupportRewriteContext,
      cleanupContext,
    })
  ) {
    blockers.push({
      code: "full_context_ai_location_rows_mismatch",
      stage: "full_context_ai_completion",
      message:
        "Location decision apply report files.output_rows must match the cleanup input rows file, the exact mutation rows file, or the input rows of a completed patch apply report whose output rows then match that cleanup/mutation file.",
      rows_file: repoRelativePath(repoRoot, rowsFile),
      expected_output_rows_file: repoRelativePath(repoRoot, expectedRowsFile),
      patch_apply_input_rows_file: patchApplyContext?.inputRowsFile
        ? repoRelativePath(repoRoot, patchApplyContext.inputRowsFile)
        : null,
      patch_apply_output_rows_files:
        patchApplyContext?.outputRows.map((file) => repoRelativePath(repoRoot, file)) ?? [],
      identity_reference_rewrite_input_rows_file: identityReferenceRewriteContext?.inputRowsFile
        ? repoRelativePath(repoRoot, identityReferenceRewriteContext.inputRowsFile)
        : null,
      identity_reference_rewrite_output_rows_file: identityReferenceRewriteContext?.outputRowsFile
        ? repoRelativePath(repoRoot, identityReferenceRewriteContext.outputRowsFile)
        : null,
      unresolved_exchange_externalization_input_rows_file:
        unresolvedExchangeExternalizationContext?.inputRowsFile
          ? repoRelativePath(repoRoot, unresolvedExchangeExternalizationContext.inputRowsFile)
          : null,
      unresolved_exchange_externalization_output_rows_file:
        unresolvedExchangeExternalizationContext?.outputRowsFile
          ? repoRelativePath(repoRoot, unresolvedExchangeExternalizationContext.outputRowsFile)
          : null,
      source_contact_rewrite_input_rows_file: sourceContactRewriteContext?.inputRowsFile
        ? repoRelativePath(repoRoot, sourceContactRewriteContext.inputRowsFile)
        : null,
      source_contact_rewrite_output_rows_file: sourceContactRewriteContext?.outputRowsFile
        ? repoRelativePath(repoRoot, sourceContactRewriteContext.outputRowsFile)
        : null,
      canonical_support_rewrite_input_rows_file: canonicalSupportRewriteContext?.inputRowsFile
        ? repoRelativePath(repoRoot, canonicalSupportRewriteContext.inputRowsFile)
        : null,
      canonical_support_rewrite_output_rows_file: canonicalSupportRewriteContext?.outputRowsFile
        ? repoRelativePath(repoRoot, canonicalSupportRewriteContext.outputRowsFile)
        : null,
      cleanup_input_rows_file: cleanupContext?.inputRowsFile
        ? repoRelativePath(repoRoot, cleanupContext.inputRowsFile)
        : null,
      cleanup_output_rows_file: cleanupContext?.outputRowsFile
        ? repoRelativePath(repoRoot, cleanupContext.outputRowsFile)
        : null,
      artifact: repoRelativePath(repoRoot, locationDecisionApplyArtifact.path),
    });
  }
  if (!context?.decisions.length) {
    blockers.push({
      code: "full_context_ai_location_decision_evidence_required",
      stage: "full_context_ai_completion",
      message:
        "Location decision apply report must point to at least one AI-authored location decision.",
      artifact: repoRelativePath(repoRoot, locationDecisionApplyArtifact.path),
    });
    return blockers;
  }
  const missingBasis = context.decisions.filter((decision) => !asText(decision?.basis));
  if (missingBasis.length > 0) {
    blockers.push({
      code: "full_context_ai_location_basis_missing",
      stage: "full_context_ai_completion",
      message: "Every location decision must include basis.",
      count: missingBasis.length,
      artifact: repoRelativePath(repoRoot, locationDecisionApplyArtifact.path),
    });
  }
  const missingEvidence = context.decisions.filter(
    (decision) => !decision?.evidence || typeof decision.evidence !== "object",
  );
  if (missingEvidence.length > 0) {
    blockers.push({
      code: "full_context_ai_location_evidence_missing",
      stage: "full_context_ai_completion",
      message: "Every location decision must include structured evidence.",
      count: missingEvidence.length,
      artifact: repoRelativePath(repoRoot, locationDecisionApplyArtifact.path),
    });
  }
  const notCompleted = context.decisions.filter(
    (decision) => classificationDecisionCompletionStatus(decision) !== "completed",
  );
  if (notCompleted.length > 0) {
    blockers.push({
      code: "full_context_ai_location_decision_status_not_completed",
      stage: "full_context_ai_completion",
      message:
        "Every location decision used as full-context AI evidence must declare decision_status=completed.",
      count: notCompleted.length,
      artifact: repoRelativePath(repoRoot, locationDecisionApplyArtifact.path),
    });
  }
  const missingContextKinds = [];
  for (const decision of context.decisions) {
    const usedKinds = new Set(classificationDecisionContextKinds(decision));
    for (const requiredKind of requirement.requiredContextKinds) {
      if (!usedKinds.has(requiredKind)) {
        missingContextKinds.push({ decision, requiredKind });
      }
    }
  }
  if (missingContextKinds.length > 0) {
    blockers.push({
      code: "full_context_ai_location_context_missing",
      stage: "full_context_ai_completion",
      message:
        "Location decision used_context_kinds must include every required full-context kind for this profile.",
      count: missingContextKinds.length,
      required_context_kinds: requirement.requiredContextKinds,
      artifact: repoRelativePath(repoRoot, locationDecisionApplyArtifact.path),
    });
  }
  const expectedContextBundleSha256AnyOf = decisionTaskContextBundleHashesFromContext(context);
  if (expectedContextBundleSha256AnyOf.length > 0) {
    const mismatchedContextBundle = context.decisions.filter(
      (decision) =>
        !expectedContextBundleSha256AnyOf.includes(
          classificationDecisionContextBundleSha256(decision),
        ),
    );
    if (mismatchedContextBundle.length > 0) {
      blockers.push({
        code: "full_context_ai_location_context_bundle_mismatch",
        stage: "full_context_ai_completion",
        message:
          "Every location decision must reference one of the AI decision task context_bundle_sha256 values.",
        count: mismatchedContextBundle.length,
        expected_context_bundle_sha256:
          expectedContextBundleSha256AnyOf.length === 1
            ? expectedContextBundleSha256AnyOf[0]
            : null,
        expected_context_bundle_sha256_any_of: expectedContextBundleSha256AnyOf,
        artifact: repoRelativePath(repoRoot, locationDecisionApplyArtifact.path),
      });
    }
  }
  return blockers;
}

export function buildIdentityDecisionFullContextBlockers({
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
}) {
  const blockers = [];
  if (!identityDecisionApplyArtifact) return blockers;
  const context = identityDecisionApplyContext;
  if (context?.status !== "completed") {
    blockers.push({
      code: "full_context_ai_identity_apply_not_completed",
      stage: "full_context_ai_completion",
      message: `dataset-identity-decisions-apply status is ${context?.status || "missing"}.`,
      artifact: repoRelativePath(repoRoot, identityDecisionApplyArtifact.path),
    });
  }
  const expectedRowsFile = decisionApplyExpectedRowsFile({
    repoRoot,
    rowsFile,
    cleanupArtifact,
  });
  const contextRelevantToRows = decisionApplyContextRelevantToExpectedRowsFile({
    repoRoot,
    context,
    expectedRowsFile,
  });
  if (cleanupArtifact && !expectedRowsFile) {
    blockers.push({
      code: "full_context_ai_identity_cleanup_input_missing",
      stage: "full_context_ai_completion",
      message:
        "Identity decision proof cannot be chained because the cleanup report does not record its input rows_file.",
      rows_file: repoRelativePath(repoRoot, rowsFile),
      artifact: repoRelativePath(repoRoot, identityDecisionApplyArtifact.path),
      cleanup_report: repoRelativePath(repoRoot, cleanupArtifact.path),
    });
  } else if (
    contextRelevantToRows &&
    !decisionApplyOutputRowsMatch(repoRoot, context, expectedRowsFile) &&
    !decisionApplyContextCoversExpectedRowsIdentity({
      repoRoot,
      context,
      expectedRowsFile,
    }) &&
    !decisionApplyOutputRowsChainThroughIdentityRewrite(
      repoRoot,
      context,
      identityReferenceRewriteContext,
      expectedRowsFile,
    ) &&
    !decisionApplyOutputRowsChainThroughIdentityRewriteAndUnresolvedExchangeExternalization(
      repoRoot,
      context,
      identityReferenceRewriteContext,
      unresolvedExchangeExternalizationContext,
      expectedRowsFile,
    ) &&
    !decisionApplyOutputRowsChainThroughClassification(
      repoRoot,
      context,
      classificationDecisionApplyContext,
      expectedRowsFile,
    ) &&
    !decisionApplyOutputRowsChainThroughClassificationAndIdentityRewrite(
      repoRoot,
      context,
      classificationDecisionApplyContext,
      identityReferenceRewriteContext,
      expectedRowsFile,
    ) &&
    !decisionApplyOutputRowsChainThroughClassificationIdentityRewriteAndUnresolvedExchangeExternalization(
      repoRoot,
      context,
      classificationDecisionApplyContext,
      identityReferenceRewriteContext,
      unresolvedExchangeExternalizationContext,
      expectedRowsFile,
    ) &&
    !identityDecisionApplyProvesReferenceRewrite(
      repoRoot,
      context,
      identityReferenceRewriteContext,
    ) &&
    !decisionApplyOutputRowsReachableThroughDeterministicTransforms({
      repoRoot,
      context,
      expectedRowsFile,
      classificationDecisionApplyContext,
      identityReferenceRewriteContext,
      unresolvedExchangeExternalizationContext,
      sourceContactRewriteContext,
      canonicalSupportRewriteContext,
      cleanupContext,
    })
  ) {
    blockers.push({
      code: "full_context_ai_identity_rows_mismatch",
      stage: "full_context_ai_completion",
      message:
        "Identity decision apply report files.output_rows must match the cleanup input rows file, the exact mutation rows file, feed a completed identity reference rewrite / unresolved exchange externalization chain, or provide an identity-reference-rewrites file used by this scope.",
      rows_file: repoRelativePath(repoRoot, rowsFile),
      expected_output_rows_file: repoRelativePath(repoRoot, expectedRowsFile),
      identity_reference_rewrite_input_rows_file: identityReferenceRewriteContext?.inputRowsFile
        ? repoRelativePath(repoRoot, identityReferenceRewriteContext.inputRowsFile)
        : null,
      identity_reference_rewrite_output_rows_file: identityReferenceRewriteContext?.outputRowsFile
        ? repoRelativePath(repoRoot, identityReferenceRewriteContext.outputRowsFile)
        : null,
      classification_decision_apply_input_rows_files:
        classificationDecisionApplyContext?.inputRows.map((file) =>
          repoRelativePath(repoRoot, file),
        ) ?? [],
      classification_decision_apply_output_rows_files:
        classificationDecisionApplyContext?.outputRows.map((file) =>
          repoRelativePath(repoRoot, file),
        ) ?? [],
      unresolved_exchange_externalization_input_rows_file:
        unresolvedExchangeExternalizationContext?.inputRowsFile
          ? repoRelativePath(repoRoot, unresolvedExchangeExternalizationContext.inputRowsFile)
          : null,
      unresolved_exchange_externalization_output_rows_file:
        unresolvedExchangeExternalizationContext?.outputRowsFile
          ? repoRelativePath(repoRoot, unresolvedExchangeExternalizationContext.outputRowsFile)
          : null,
      source_contact_rewrite_input_rows_file: sourceContactRewriteContext?.inputRowsFile
        ? repoRelativePath(repoRoot, sourceContactRewriteContext.inputRowsFile)
        : null,
      source_contact_rewrite_output_rows_file: sourceContactRewriteContext?.outputRowsFile
        ? repoRelativePath(repoRoot, sourceContactRewriteContext.outputRowsFile)
        : null,
      canonical_support_rewrite_input_rows_file: canonicalSupportRewriteContext?.inputRowsFile
        ? repoRelativePath(repoRoot, canonicalSupportRewriteContext.inputRowsFile)
        : null,
      canonical_support_rewrite_output_rows_file: canonicalSupportRewriteContext?.outputRowsFile
        ? repoRelativePath(repoRoot, canonicalSupportRewriteContext.outputRowsFile)
        : null,
      cleanup_input_rows_file: cleanupContext?.inputRowsFile
        ? repoRelativePath(repoRoot, cleanupContext.inputRowsFile)
        : null,
      cleanup_output_rows_file: cleanupContext?.outputRowsFile
        ? repoRelativePath(repoRoot, cleanupContext.outputRowsFile)
        : null,
      identity_decision_reference_rewrites_file: context?.identityReferenceRewritesFile
        ? repoRelativePath(repoRoot, context.identityReferenceRewritesFile)
        : null,
      identity_reference_rewrites_file: identityReferenceRewriteContext?.sourceFile
        ? repoRelativePath(repoRoot, identityReferenceRewriteContext.sourceFile)
        : null,
      identity_reference_rewrite_rows: identityReferenceRewriteContext?.scopedRows.length ?? 0,
      artifact: repoRelativePath(repoRoot, identityDecisionApplyArtifact.path),
    });
  }
  if (!context?.decisions.length) {
    blockers.push({
      code: "full_context_ai_identity_decision_evidence_required",
      stage: "full_context_ai_completion",
      message:
        "Identity decision apply report must point to at least one AI-authored identity decision.",
      artifact: repoRelativePath(repoRoot, identityDecisionApplyArtifact.path),
    });
    return blockers;
  }
  const packageProofs = ensureArray(context.authoringPackageProofs);
  if (packageProofs.length === 0) {
    blockers.push({
      code: "full_context_ai_identity_authoring_package_required",
      stage: "full_context_ai_completion",
      message:
        "Identity decisions must reference readable full-context authoring packages before remote write planning.",
      artifact: repoRelativePath(repoRoot, identityDecisionApplyArtifact.path),
    });
  } else {
    for (const proof of packageProofs) {
      blockers.push(...fullContextPackageProofBlockers({ requirement, proof }));
    }
  }
  const missingPackageBinding = context.decisions.filter(
    (decision) =>
      !identityDecisionPackageReference(decision) || !identityDecisionPackageSha(decision),
  );
  if (missingPackageBinding.length > 0) {
    blockers.push({
      code: "full_context_ai_identity_package_binding_missing",
      stage: "full_context_ai_completion",
      message:
        "Every identity decision must include authoring_package and authoring_package_sha256.",
      count: missingPackageBinding.length,
      artifact: repoRelativePath(repoRoot, identityDecisionApplyArtifact.path),
    });
  }
  const missingBasis = context.decisions.filter(
    (decision) => !asText(decision?.basis ?? decision?.reason),
  );
  if (missingBasis.length > 0) {
    blockers.push({
      code: "full_context_ai_identity_basis_missing",
      stage: "full_context_ai_completion",
      message: "Every identity decision must include basis.",
      count: missingBasis.length,
      artifact: repoRelativePath(repoRoot, identityDecisionApplyArtifact.path),
    });
  }
  const missingEvidence = context.decisions.filter(
    (decision) => !decision?.evidence || typeof decision.evidence !== "object",
  );
  if (missingEvidence.length > 0) {
    blockers.push({
      code: "full_context_ai_identity_evidence_missing",
      stage: "full_context_ai_completion",
      message: "Every identity decision must include structured evidence.",
      count: missingEvidence.length,
      artifact: repoRelativePath(repoRoot, identityDecisionApplyArtifact.path),
    });
  }
  const notCompleted = context.decisions.filter(
    (decision) => classificationDecisionCompletionStatus(decision) !== "completed",
  );
  if (notCompleted.length > 0) {
    blockers.push({
      code: "full_context_ai_identity_decision_status_not_completed",
      stage: "full_context_ai_completion",
      message:
        "Every identity decision used as full-context AI evidence must declare decision_status=completed.",
      count: notCompleted.length,
      artifact: repoRelativePath(repoRoot, identityDecisionApplyArtifact.path),
    });
  }
  const missingClosures = context.decisions.filter(
    (decision) =>
      !identityDecisionClosesAction(decision, "identity_preflight_manual_review") &&
      !identityDecisionClosesAction(decision, "elementary_flow_identity_manual_review"),
  );
  if (missingClosures.length > 0) {
    blockers.push({
      code: "full_context_ai_identity_action_closure_missing",
      stage: "full_context_ai_completion",
      message:
        "Every identity decision must close identity_preflight_manual_review or elementary_flow_identity_manual_review.",
      count: missingClosures.length,
      artifact: repoRelativePath(repoRoot, identityDecisionApplyArtifact.path),
    });
  }
  const missingCanonical = context.decisions.filter(
    (decision) =>
      identityDecisionValue(decision) === "reuse_existing_reference" &&
      !identityDecisionCanonical(decision),
  );
  if (missingCanonical.length > 0) {
    blockers.push({
      code: "full_context_ai_identity_canonical_missing",
      stage: "full_context_ai_completion",
      message:
        "reuse_existing_reference identity decisions must include canonical ref_object_id/version.",
      count: missingCanonical.length,
      artifact: repoRelativePath(repoRoot, identityDecisionApplyArtifact.path),
    });
  }
  const missingContextKinds = [];
  for (const decision of context.decisions) {
    const usedKinds = new Set(classificationDecisionContextKinds(decision));
    for (const requiredKind of requirement.requiredContextKinds) {
      if (!usedKinds.has(requiredKind)) {
        missingContextKinds.push({ decision, requiredKind });
      }
    }
  }
  if (missingContextKinds.length > 0) {
    blockers.push({
      code: "full_context_ai_identity_context_missing",
      stage: "full_context_ai_completion",
      message:
        "Identity decision used_context_kinds must include every required full-context kind for this profile.",
      count: missingContextKinds.length,
      required_context_kinds: requirement.requiredContextKinds,
      artifact: repoRelativePath(repoRoot, identityDecisionApplyArtifact.path),
    });
  }
  return blockers;
}

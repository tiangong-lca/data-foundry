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
import { identityDecisionApplyContextClosesAction } from "./workflow-identity-decision-context.ts";
import {
  classCode,
  classLevel,
  classText,
  locationCodeMapForPatch,
  processCategoryPathForCode,
} from "./workflow-patch-evidence.mjs";
import { identityPreflightIndexPath } from "./workflow-queue-context.ts";
import { deterministicRowsFileTransformEntries } from "./workflow-row-transform-context.mjs";
import {
  classificationEntriesForPayload,
  flowTypeForPayload,
  flowUsesElementaryClassification,
  jsonPointerToken,
  nameTextForPayload,
} from "./workflow-semantic-actions.mjs";

// part-01.mjs
export function identityPreflightResultFile(repoRoot, indexPath, row) {
  const baseDir = path.dirname(indexPath);
  const explicit =
    row?.expected_report_file ??
    row?.identity_decision_file ??
    row?.identityDecisionFile ??
    row?.report_file ??
    row?.reportFile;
  if (explicit) return resolveArtifactPath(repoRoot, explicit, baseDir);
  const outputDir = row?.output_dir ?? row?.outputDir;
  if (!outputDir) return null;
  const resolvedOutputDir = path.isAbsolute(outputDir)
    ? outputDir
    : path.resolve(baseDir, outputDir);
  const fromIndexBase = path.join(resolvedOutputDir, "outputs", "identity-decision.json");
  if (fileExists(fromIndexBase)) return fromIndexBase;
  return resolveRepoPath(repoRoot, path.join(outputDir, "outputs", "identity-decision.json"));
}

export function readIdentityPreflightIndexRow(repoRoot, indexPath, row) {
  const baseDir = path.dirname(indexPath);
  const datasetType = asText(row?.dataset_type ?? row?.type);
  const datasetId = asText(row?.dataset_id ?? row?.entity_id ?? row?.id);
  const datasetVersion = asText(row?.dataset_version ?? row?.version) || "00.00.001";
  if (!datasetType || !datasetId) return null;
  const requestPath = resolveArtifactPath(repoRoot, row?.request_file, baseDir);
  const request = readJsonIfExists(requestPath);
  const requestText = requestPath && fileExists(requestPath) ? readText(requestPath) : null;
  const resultPath = identityPreflightResultFile(repoRoot, indexPath, row);
  const result = readJsonIfExists(resultPath);
  const resultText = resultPath && fileExists(resultPath) ? readText(resultPath) : null;
  const executionManifestPath =
    resolveArtifactPath(
      repoRoot,
      row?.execution_manifest_file ?? row?.executionManifestFile,
      baseDir,
    ) ??
    (resultPath
      ? path.join(path.dirname(resultPath), "foundry-identity-preflight-execution.json")
      : null);
  const executionManifest = readJsonIfExists(executionManifestPath);
  const targetSha256 =
    row?.target_sha256 ??
    row?.targetSha256 ??
    (request ? sha256Json(request.target ?? null) : null);
  const executionEvidence = validateIdentityPreflightEvidence(executionManifest, {
    requestText,
    reportText: resultText,
    datasetType,
    datasetId,
    datasetVersion,
    targetSha256: asText(targetSha256),
    expectedProjectRef: asText(row?.expected_project_ref ?? row?.expectedProjectRef) || null,
    expectedUserId: asText(row?.expected_user_id ?? row?.expectedUserId) || null,
  });
  const completedResult = result && executionEvidence.ok ? result : null;
  // Candidate files are convenience exports and are not covered by the bound
  // execution manifest. Downstream semantic evidence comes only from the
  // manifest-bound identity-decision report.
  const outputDir = row?.output_dir
    ? (resolveArtifactPath(repoRoot, row.output_dir, baseDir) ??
      resolveRepoPath(repoRoot, row.output_dir))
    : (result?.out_dir ?? null);
  return {
    dataset_type: datasetType,
    dataset_id: datasetId,
    dataset_version: datasetVersion,
    source_file: row?.source_file ?? null,
    request_file: requestPath ? repoRelativePath(repoRoot, requestPath) : null,
    output_dir: outputDir ? repoRelativePath(repoRoot, outputDir) : null,
    command: row?.command ?? null,
    remote_search: row?.remote_search ?? request?.remote_candidate_search ?? null,
    request: request
      ? {
          schema_version: request.schema_version ?? null,
          remote_candidate_search: request.remote_candidate_search ?? null,
          target_sha256: targetSha256,
        }
      : row?.target_sha256 || row?.targetSha256
        ? {
            schema_version: null,
            remote_candidate_search: null,
            target_sha256: row?.target_sha256 ?? row?.targetSha256,
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

export function readIdentityPreflightContext(repoRoot, options, rowsFile) {
  const indexPath = identityPreflightIndexPath(repoRoot, options, rowsFile);
  if (!indexPath) return null;
  if (!fileExists(indexPath)) {
    throw new Error(`--identity-preflight-index must point to a readable JSONL file: ${indexPath}`);
  }
  const rows = readJsonLinesIfExists(indexPath)
    .map((row) => readIdentityPreflightIndexRow(repoRoot, indexPath, row))
    .filter(Boolean);
  const rowsByIdentity = new Map();
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

export function identityPreflightRowForIdentity(context, datasetType, identity) {
  if (!context || !identity?.id) return null;
  return (
    context.rowsByIdentity.get(
      `${datasetType}:${identity.id}@@${identity.version || "00.00.001"}`,
    ) ??
    context.rowsByIdentity.get(`${datasetType}:${identity.id}`) ??
    null
  );
}

export function identityPreflightFreshness(row, payload) {
  const currentPayloadSha256 = payload ? sha256Json(payload) : null;
  const requestTargetSha256 = asText(row?.request?.target_sha256) || null;
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
}) {
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
}) {
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
  const applied = [];
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
}) {
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

export function attachIdentityPreflightFreshness(row, payload, options = {}) {
  if (!row) return null;
  const freshness = identityPreflightFreshness(row, payload);
  const deterministicAllowances = [
    classificationFreshnessAllowance({
      repoRoot: options.repoRoot,
      freshness,
      datasetType: options.datasetType,
      identity: options.identity,
      classificationDecisionApplyContext: options.classificationDecisionApplyContext,
    }),
    externalizationFreshnessAllowance({
      freshness,
      datasetType: options.datasetType,
      identity: options.identity,
      unresolvedExchangeExternalizationContext: options.unresolvedExchangeExternalizationContext,
    }),
    deterministicTransformFreshnessAllowance({
      repoRoot: options.repoRoot,
      freshness,
      datasetType: options.datasetType,
      identity: options.identity,
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

export function identityPreflightFreshnessAccepted(freshness) {
  return Boolean(
    freshness?.current_payload_matches_request === true ||
    freshness?.current_payload_scope_accepted === true,
  );
}

export function identityPreflightSourceContextRequired({
  profile,
  datasetType,
  curationQueueContext,
  context,
}) {
  return Boolean(
    asText(profile?.id).toLowerCase() === "bafu" &&
    ["flow", "process"].includes(datasetType) &&
    curationQueueContext?.status === "attached" &&
    ensureArray(context?.rows).some((row) => asText(row?.source_file)),
  );
}

export function identityPreflightHasSourceContext(row) {
  return Boolean(asText(row?.source_file));
}

export function dependencyPayloadForFreshness(dependency) {
  const rows = ensureArray(
    dependency?.input_rows ??
      dependency?.rows ??
      dependency?.payload_rows ??
      dependency?.payloadRows,
  ).filter(Boolean);
  return rows[0] ?? dependency?.payload ?? null;
}

export function dependencyIdentityPreflightRows(context, curationQueueContext, options = {}) {
  if (!context || !curationQueueContext) return [];
  const rows = [];
  const seen = new Set();
  for (const dependency of ensureArray(curationQueueContext.dependency_rows)) {
    const task = dependency?.task;
    const datasetType = asText(task?.entity_type);
    const identity = {
      id: asText(task?.entity_id),
      version: asText(task?.version) || "00.00.001",
    };
    const row = identityPreflightRowForIdentity(context, datasetType, identity);
    if (!row) continue;
    const key = `${row.dataset_type}:${row.dataset_id}@@${row.dataset_version}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({
      relation: "dependency",
      ref: dependency?.ref ?? null,
      ref_path: dependency?.ref_path ?? null,
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
}) {
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
      dependencies.every((row) => row.identity_preflight.status === "completed")
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
}) {
  if (!required || !["flow", "process"].includes(datasetType)) return [];
  const items = [];
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
      const task = dependency?.task;
      const dependencyType = asText(task?.entity_type);
      if (!["flow", "process"].includes(dependencyType)) continue;
      const dependencyIdentity = {
        id: asText(task?.entity_id),
        version: asText(task?.version) || "00.00.001",
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
          path: dependency?.ref_path ?? null,
          message: "No identity-preflight result is attached for a referenced dependency entity.",
          action_kind: "identity_preflight_required",
          required_owner: "foundry_identity_preflight_run",
          ai_required: false,
          dependency_type: dependencyType,
          dependency_id: dependencyIdentity.id,
          dependency_version: dependencyIdentity.version,
          instruction: baseInstruction,
        });
      } else if (dependencyPreflightWithFreshness.status !== "completed") {
        items.push({
          source: "identity_preflight",
          code: "identity_preflight_dependency_result_pending",
          path: dependency?.ref_path ?? null,
          message: `Referenced dependency identity-preflight status is ${dependencyPreflightWithFreshness.status}.`,
          action_kind: "identity_preflight_required",
          required_owner: "foundry_identity_preflight_run",
          ai_required: false,
          dependency_type: dependencyType,
          dependency_id: dependencyIdentity.id,
          dependency_version: dependencyIdentity.version,
          instruction: baseInstruction,
        });
      } else if (
        dependencyPreflightWithFreshness.freshness &&
        !identityPreflightFreshnessAccepted(dependencyPreflightWithFreshness.freshness)
      ) {
        items.push({
          source: "identity_preflight",
          code: "identity_preflight_dependency_scope_stale",
          path: dependency?.ref_path ?? null,
          message:
            "Referenced dependency identity-preflight result was generated from a different dependency payload than the current curation queue context.",
          action_kind: "identity_preflight_required",
          required_owner: "foundry_identity_preflight_run",
          ai_required: false,
          dependency_type: dependencyType,
          dependency_id: dependencyIdentity.id,
          dependency_version: dependencyIdentity.version,
          instruction: staleInstruction,
          evidence: dependencyPreflightWithFreshness.freshness,
        });
      } else if (
        requiresSourceContext &&
        !identityPreflightHasSourceContext(dependencyPreflightWithFreshness)
      ) {
        items.push({
          source: "identity_preflight",
          code: "identity_preflight_dependency_source_context_missing",
          path: dependency?.ref_path ?? null,
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
            remote_search: dependencyPreflightWithFreshness.remote_search ?? null,
            request_file: dependencyPreflightWithFreshness.request_file ?? null,
          },
        });
      }
    }
  }
  return items;
}

export function identityPreflightNeedsAiDecision(row) {
  const result = row?.result;
  if (!result) return false;
  const status = asText(result.status);
  const decision = asText(result.decision);
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
}) {
  const result = row?.result ?? {};
  const candidates = ensureArray(result.candidates);
  const resultFlowType = asText(result?.target?.fields?.type_of_dataset);
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
      remote_search: row?.remote_search ?? null,
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
}) {
  if (!required || !authoringContext) return [];
  const items = [];
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

export function comparableText(value) {
  return asText(value).replace(/\s+/gu, " ").trim().toLowerCase();
}

export function classificationClassesForPayload(payload, datasetType) {
  const root = datasetRoot(payload, datasetType);
  const info = dataSetInformation(root, datasetType);
  const classification = info?.classificationInformation?.["common:classification"] ?? null;
  const classes = classification?.["common:class"] ?? classification?.["common:category"] ?? null;
  return ensureArray(classes).filter(
    (item) => item && typeof item === "object" && !Array.isArray(item),
  );
}

export function classificationDisplayForPayload(payload, datasetType) {
  return classificationClassesForPayload(payload, datasetType)
    .map((item) => asText(item?.["#text"] ?? item?.text ?? item?.label))
    .filter(Boolean)
    .join(" > ");
}

export function textContent(value) {
  if (Array.isArray(value)) {
    return value.map(textContent).filter(Boolean).join(" ");
  }
  if (value && typeof value === "object") {
    return asText(value["#text"] ?? value.text ?? value.label ?? value.name);
  }
  return asText(value);
}

export function sourcePrewriteIdentityBlockers(payload, datasetType) {
  if (datasetType !== "source") return [];
  const root = datasetRoot(payload, "source");
  const info = dataSetInformation(root, "source");
  const shortName = textContent(info?.["common:shortName"] ?? info?.shortName);
  const sourceCitation = textContent(info?.sourceCitation ?? info?.["common:sourceCitation"]);
  const classification = classificationDisplayForPayload(payload, "source");
  const blockers = [];
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
  payload,
  datasetType,
  allowAccountLocalSupportAndElementary = false,
) {
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

function readPrewriteContentPolicy(repoRoot) {
  const policyPath = resolveRepoPath(repoRoot, defaultPrewriteContentPolicyFile);
  if (!policyPath || !fileExists(policyPath)) return null;
  return {
    path: policyPath,
    relative_path: repoRelativePath(repoRoot, policyPath),
    value: readJson(policyPath),
  };
}

function isFoundryTracePathSegments(pathSegments) {
  return pathSegments.some((segment) => {
    const text = String(segment).toLowerCase();
    return text === "common:other" || text.startsWith("tiangongfoundry:");
  });
}

function payloadTextLeaves(value, pathSegments = [], leaves = []) {
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

function normalizedPathSegments(pathSegments) {
  return pathSegments.map((segment) => String(segment).replace(/^common:/u, ""));
}

function pathScopeMatches(pathSegments, pathScope = {}) {
  const raw = pathSegments.map(String);
  const normalized = normalizedPathSegments(pathSegments);
  const contains = ensureArray(pathScope.contains).map(String);
  const excludeContains = ensureArray(pathScope.exclude_contains).map(String);
  const hasSegment = (segment) =>
    raw.includes(segment) || normalized.includes(segment.replace(/^common:/u, ""));
  if (contains.some((segment) => !hasSegment(segment))) return false;
  if (excludeContains.some((segment) => hasSegment(segment))) return false;
  return true;
}

function compilePolicyPattern(entry) {
  try {
    return new RegExp(asText(entry?.pattern), asText(entry?.flags) || "u");
  } catch {
    return null;
  }
}

function policyLexiconEntries(policy, rule) {
  const lexiconName = asText(rule?.lexicon);
  if (!lexiconName) return [];
  return ensureArray(policy?.lexicons?.[lexiconName]);
}

export function prewriteContentQualityBlockers({ repoRoot, payload, datasetType, profile = null }) {
  if (!["flow", "process", "lifecyclemodel"].includes(datasetType)) return [];
  const policy = readPrewriteContentPolicy(repoRoot);
  if (!policy) return [];
  // Per-profile content-policy waivers (e.g. worldsteel waives source_locator_in_dataset_name
  // for process names, where "<Geography> <data-year>" is a false positive of the
  // latin-author-year marker, not a citation locator). A waiver matches either the rule code
  // or the rule id. Absent a profile (or waiver), every rule applies — BAFU/USLCI unchanged.
  const waivedRuleCodes = new Set(
    ensureArray(profile?.waivedContentPolicyRulesByType?.[datasetType]).map(asText),
  );
  const leaves = payloadTextLeaves(payload);
  const blockers = [];
  for (const rule of ensureArray(policy.value?.rules)) {
    const allowedTypes = ensureArray(rule?.dataset_types).map(asText);
    if (allowedTypes.length > 0 && !allowedTypes.includes(datasetType)) continue;
    if (waivedRuleCodes.has(asText(rule?.code)) || waivedRuleCodes.has(asText(rule?.id))) continue;
    const entries = policyLexiconEntries(policy.value, rule);
    for (const leaf of leaves) {
      if (!pathScopeMatches(leaf.path_segments, rule?.path_scope)) continue;
      for (const entry of entries) {
        const pattern = compilePolicyPattern(entry);
        if (!pattern || !pattern.test(leaf.text)) continue;
        blockers.push({
          code: asText(rule?.code) || "prewrite_content_quality_blocked",
          stage: asText(rule?.stage) || "prewrite_content_quality",
          message:
            asText(rule?.message) ||
            "Write payload text violates the configured prewrite content policy.",
          dataset_type: datasetType,
          policy: policy.relative_path,
          rule_id: asText(rule?.id) || null,
          lexicon: asText(rule?.lexicon) || null,
          marker_id: asText(entry?.id) || null,
          path: leaf.path,
          text: leaf.text,
        });
      }
    }
  }
  return blockers;
}

export function prewriteIdentityBlockers(
  payload,
  datasetType,
  repoRoot = null,
  { allowAccountLocalSupportAndElementary = false, profile = null } = {},
) {
  return [
    ...sourcePrewriteIdentityBlockers(payload, datasetType),
    ...flowPrewriteIdentityBlockers(payload, datasetType, allowAccountLocalSupportAndElementary),
    ...prewriteContentQualityBlockers({ repoRoot, payload, datasetType, profile }),
  ];
}

export function processClassificationClassesAreCanonical(repoRoot, classes) {
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

export function classificationQueueRowStillNeedsAuthoring({ repoRoot, datasetType, payload, row }) {
  const expectedDisplay = comparableText(row?.current_classification);
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

export function valueAtDotPath(value, dotPath) {
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
    current = current[part];
  }
  return current;
}

export function locationQueueRowStillNeedsAuthoring({ repoRoot, payload, row }) {
  const targetPath = asText(row?.target_path ?? row?.path);
  if (!targetPath) return true;
  const currentLocation = asText(valueAtDotPath(payload, targetPath));
  if (!currentLocation) return true;
  const queuedLocation = asText(row?.current_location ?? row?.location);
  if (!locationCodeMapForPatch(repoRoot).has(currentLocation)) return true;
  if (queuedLocation && currentLocation === queuedLocation) return true;
  return false;
}

export function classificationQueueActionItem(row) {
  const datasetType = asText(row?.dataset_type) || "process";
  const classificationPath =
    datasetType === "flow"
      ? "flowDataSet.flowInformation.dataSetInformation.classificationInformation.common:classification"
      : "processDataSet.processInformation.dataSetInformation.classificationInformation.common:classification";
  return {
    source: "classification_authoring_queue",
    code: asText(row?.code) || "process_classification_requires_authoring",
    path: classificationPath,
    message:
      asText(row?.message) || "Converted classification requires AI authoring before remote write.",
    evidence: {
      current_classification: row?.current_classification ?? null,
      source_classification: row?.source_classification ?? null,
      authoring_context: row?.authoring_context ?? null,
      source_file: row?.source_file ?? null,
      classification_workflow: row?.classification_workflow ?? null,
    },
    instruction:
      asText(row?.required_resolution) ||
      "Use the full schema/YAML/context package and TIDAS classification workflow to choose the target classification. Preserve source classification only as provenance.",
    action_kind: "classification_decision_authoring",
    required_owner: "foundry_ai_authoring",
    ai_required: true,
    common_other_deferral_allowed: false,
  };
}

export function locationQueueActionItem(row) {
  return {
    source: "location_authoring_queue",
    code: asText(row?.code) || "location_code_requires_authoring",
    path: asText(row?.target_path ?? row?.path) || null,
    message:
      asText(row?.message) ||
      "Location value must be replaced with a valid TIDAS location code before remote write.",
    evidence: {
      current_location: row?.current_location ?? row?.location ?? null,
      target_path: row?.target_path ?? row?.path ?? null,
      location_workflow: row?.location_workflow ?? null,
      source_file: row?.source_file ?? null,
    },
    instruction:
      asText(row?.required_resolution) ||
      "Use the full schema/YAML/context package and TIDAS location classification workflow to choose the target location code.",
    action_kind: "location_decision_authoring",
    required_owner: "foundry_ai_authoring",
    ai_required: true,
    common_other_deferral_allowed: false,
  };
}

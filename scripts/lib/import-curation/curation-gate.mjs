import fs from "node:fs";
import path from "node:path";
import * as curationGateWorkflow from "./internal/curation-gate-workflow.ts";

const {
  authoringQueueRowsForIdentity,
  buildIdentityPreflightAuthoringContext,
  buildQueueAuthoringContext,
  classificationQueueActionItem,
  classificationQueueRowStillNeedsAuthoring,
  collectBundledSchemaContextFiles,
  collectContextDirFiles,
  collectExplicitContextFiles,
  collectProfileSemanticActionItems,
  contextFileDetails,
  datasetIdentity,
  datasetTypeFromOptions,
  datasetTypePlural,
  ensureArray,
  entityIdFromFinding,
  fileExists,
  fullContextAiCompletionRequirement,
  fullContextGateItems,
  identityDecisionApplyContextDecisionsForIdentity,
  identityDecisionApplyReportOptionValues,
  identityKey,
  identityPreflightAuthoringActionItems,
  identityPreflightGateItems,
  jsonLines,
  locationQueueActionItem,
  locationQueueRowStillNeedsAuthoring,
  mapRowsByIdentity,
  nowIso,
  profileFor,
  qaFindingCode,
  qaFindingCurationAction,
  readAuthoringQueueContext,
  readCanonicalSupportRewriteContext,
  readClassificationDecisionApplyContext,
  readCleanupTransformContext,
  readContextFiles,
  readCurationQueueContext,
  readIdentityDecisionApplyContexts,
  readIdentityPreflightContext,
  readIdentityReferenceRewriteContext,
  readJson,
  readJsonArtifactsIfOption,
  readJsonIfOption,
  readQaFindings,
  readRows,
  readSourceContactRewriteContext,
  readText,
  readUnresolvedExchangeExternalizationContext,
  repoRelativePath,
  resolveRepoPath,
  sanitizeFileName,
  schemaIssueCurationAction,
  sha256Text,
  unresolvedExchangeExternalizationRowsForIdentity,
  writeJson,
  writeText,
} = curationGateWorkflow;

export function runDatasetCurationGate({ repoRoot, options = {} } = {}) {
  const datasetType = datasetTypeFromOptions(options);
  if (options.help) {
    return {
      schema_version: 2,
      status: "help",
      command: "dataset-curation-gate",
      usage: [
        "node scripts/foundry.mjs dataset-curation-gate --type process --rows-file <rows.jsonl> --schema-report <dataset-validate-report.json> --qa-report <qa-report.json> --queue-dir <curation-queue-dir> --classification-queue <classification-authoring-queue.jsonl> --location-queue <location-authoring-queue.jsonl>",
        "node scripts/foundry.mjs dataset-curation-gate --type process --rows-file ./rows/processes.jsonl --schema-report ./schema/report.json --qa-report ./qa/report.json --schema-file ./context/schema.json --yaml-file ./context/methodology.yaml --queue-dir ./curation-queue --classification-queue ./classification-authoring-queue.jsonl --location-queue ./location-authoring-queue.jsonl --identity-preflight-index ./identity-preflight-requests/identity-preflight-requests.jsonl",
      ],
      context: {
        queue_dir: "optional but required by the Foundry import workflow after queue build",
        classification_queue:
          "optional JSONL from dataset-bundle-sample-rows; attached to authoring packages and converted into classification action items",
        location_queue:
          "optional JSONL from dataset-bundle-sample-rows; attached to authoring packages and converted into location-code action items",
        identity_preflight_index:
          "optional JSONL from dataset-bundle-sample-rows; attached to authoring packages with read-only hybrid-search request/result evidence for process and flow reuse decisions",
        require_identity_preflight:
          "explicit hard-gate flag for profiles that require identity-preflight result artifacts for current entities and process dependencies",
        ai_authoring_package:
          "includes source row, schema/QA blockers, contract/profile context, queue task, closure, dependency rows, and support rows when --queue-dir is provided",
      },
    };
  }
  const rowsFile = resolveRepoPath(repoRoot, options.rowsFile || options.input);
  const schemaReportPath = resolveRepoPath(repoRoot, options.schemaReport);
  const qaReportPath = resolveRepoPath(repoRoot, options.qaReport);
  const defaultOut = `.foundry/workspaces/${datasetType}-dataset-curation-gate`;
  const outDir = resolveRepoPath(repoRoot, options.outDir || defaultOut);
  const profileId = String(options.profile || "generic")
    .trim()
    .toLowerCase();
  const profile = profileFor(repoRoot, profileId, options);
  if (!rowsFile || !fileExists(rowsFile)) {
    throw new Error("--rows-file is required and must point to a JSON/JSONL dataset row file.");
  }
  if (!schemaReportPath || !fileExists(schemaReportPath)) {
    throw new Error(
      "--schema-report is required and must point to dataset-tidas-validate compatibility report JSON.",
    );
  }
  if (!qaReportPath || !fileExists(qaReportPath)) {
    throw new Error("--qa-report is required and must point to a QA report JSON.");
  }

  const rows = readRows(rowsFile);
  const schemaReport = readJson(schemaReportPath);
  const qaReport = readJson(qaReportPath);
  const qaFindings = readQaFindings(repoRoot, qaReport, qaReportPath, datasetType);
  const profileContext = readContextFiles(
    repoRoot,
    profile.docs.map((filePath) => ["profile", filePath]),
  );
  const contractContext = readContextFiles(repoRoot, [
    ...collectExplicitContextFiles(options),
    ...collectContextDirFiles(repoRoot, options.contextDir),
    ...collectBundledSchemaContextFiles(repoRoot),
  ]);
  const fullContextRequirement = fullContextAiCompletionRequirement(profile, datasetType, repoRoot);
  const fullContextItems = fullContextGateItems({
    contractContext,
    requirement: fullContextRequirement,
  });
  const queueContext = readCurationQueueContext(repoRoot, options);
  const requireQueueContext =
    options.requireQueueContext === true ||
    options.requireQueueContext === "true" ||
    options.requireCurationQueueContext === true ||
    options.requireCurationQueueContext === "true";
  const classificationQueueContext = readAuthoringQueueContext(
    repoRoot,
    options.classificationQueue ?? options.classificationQueueFile,
    "classification",
  );
  const locationQueueContext = readAuthoringQueueContext(
    repoRoot,
    options.locationQueue ?? options.locationQueueFile,
    "location",
  );
  const identityPreflightContext = readIdentityPreflightContext(repoRoot, options, rowsFile);
  const classificationDecisionApplyArtifact = readJsonIfOption(
    repoRoot,
    options.classificationDecisionApplyReport ?? options.classificationDecisionsApplyReport,
  );
  const classificationDecisionApplyContext = classificationDecisionApplyArtifact
    ? readClassificationDecisionApplyContext(repoRoot, classificationDecisionApplyArtifact)
    : null;
  const identityDecisionApplyArtifacts = readJsonArtifactsIfOption(
    repoRoot,
    identityDecisionApplyReportOptionValues(options),
  );
  const identityDecisionApplyArtifact = identityDecisionApplyArtifacts[0] ?? null;
  const identityDecisionApplyContext = readIdentityDecisionApplyContexts(
    repoRoot,
    identityDecisionApplyArtifacts,
  );
  const unresolvedExchangeExternalizationArtifact = readJsonIfOption(
    repoRoot,
    options.unresolvedExchangeExternalizationReport,
  );
  const unresolvedExchangeExternalizationContext = readUnresolvedExchangeExternalizationContext(
    repoRoot,
    unresolvedExchangeExternalizationArtifact,
  );
  const sourceContactRewriteArtifact = readJsonIfOption(
    repoRoot,
    options.sourceContactRewriteReport ?? options.sourceContactRewritesReport,
  );
  const sourceContactRewriteContext = readSourceContactRewriteContext(
    repoRoot,
    sourceContactRewriteArtifact,
  );
  const canonicalSupportRewriteArtifact = readJsonIfOption(
    repoRoot,
    options.canonicalSupportRewriteReport ?? options.canonicalSupportRewritesReport,
  );
  const canonicalSupportRewriteContext = readCanonicalSupportRewriteContext(
    repoRoot,
    canonicalSupportRewriteArtifact,
  );
  const cleanupArtifact = readJsonIfOption(repoRoot, options.cleanupReport);
  const cleanupContext = readCleanupTransformContext(repoRoot, cleanupArtifact);
  const writeRows = mapRowsByIdentity(rows, datasetType);
  const identityReferenceRewriteContext = readIdentityReferenceRewriteContext({
    repoRoot,
    rowsFile,
    options,
    writeRows,
  });
  const waivedQaCodes = new Set(profile.waivedQaCodesByType?.[datasetType] ?? []);
  const schemaRowsById = new Map(
    ensureArray(schemaReport.rows).map((row) => [String(row.id ?? row.dataset_id ?? ""), row]),
  );
  const qaFindingsById = new Map();
  for (const finding of qaFindings) {
    const id = entityIdFromFinding(finding, datasetType);
    if (!id) continue;
    if (!qaFindingsById.has(id)) qaFindingsById.set(id, []);
    qaFindingsById.get(id).push(finding);
  }

  const packageDir = path.join(outDir, "ai-authoring-packages");
  const entityReports = rows.map((row, index) => {
    const identity = datasetIdentity(row, index, datasetType);
    const curationQueueContext = buildQueueAuthoringContext(
      repoRoot,
      queueContext,
      datasetType,
      identity,
    );
    const identityPreflightAuthoringContext = buildIdentityPreflightAuthoringContext({
      context: identityPreflightContext,
      datasetType,
      identity,
      curationQueueContext,
      repoRoot,
      classificationDecisionApplyContext,
      identityDecisionApplyContext,
      identityReferenceRewriteContext,
      unresolvedExchangeExternalizationContext,
      sourceContactRewriteContext,
      canonicalSupportRewriteContext,
      cleanupContext,
    });
    const unresolvedExchangeExternalizationRows = unresolvedExchangeExternalizationRowsForIdentity(
      unresolvedExchangeExternalizationContext,
      identity,
    );
    const identityReferenceRewrites =
      identityReferenceRewriteContext.byIdentity.get(identityKey(identity)) ?? [];
    const identityDecisionApplyRows = identityDecisionApplyContextDecisionsForIdentity({
      context: identityDecisionApplyContext,
      datasetType,
      id: identity.id,
      version: identity.version,
    });
    const identityPreflightGateItemsForEntity = identityPreflightGateItems({
      required: Boolean(fullContextRequirement) && ["flow", "process"].includes(datasetType),
      context: identityPreflightContext,
      authoringContext: identityPreflightAuthoringContext,
      datasetType,
      identity,
      curationQueueContext,
      profile,
    });
    const identityPreflightActionItems = identityPreflightAuthoringActionItems({
      required: Boolean(fullContextRequirement) && ["flow", "process"].includes(datasetType),
      authoringContext: identityPreflightAuthoringContext,
      datasetType,
      identity,
      identityDecisionApplyContext,
    });
    const classificationAuthoringRows = authoringQueueRowsForIdentity(
      classificationQueueContext,
      identity,
    );
    const locationAuthoringRows = authoringQueueRowsForIdentity(locationQueueContext, identity);
    const unresolvedClassificationAuthoringRows = classificationAuthoringRows.filter((row) =>
      classificationQueueRowStillNeedsAuthoring({
        repoRoot,
        datasetType,
        payload: identity.payload,
        row,
      }),
    );
    const unresolvedLocationAuthoringRows = locationAuthoringRows.filter((row) =>
      locationQueueRowStillNeedsAuthoring({
        repoRoot,
        payload: identity.payload,
        row,
      }),
    );
    const schemaRow = schemaRowsById.get(identity.id) ?? null;
    const schemaIssues = ensureArray(schemaRow?.issues);
    const entityQaFindings = qaFindingsById.get(identity.id) ?? [];
    const waivedFindings = entityQaFindings.filter((finding) =>
      waivedQaCodes.has(qaFindingCode(finding)),
    );
    const actionableQaFindings = entityQaFindings.filter(
      (finding) => !waivedQaCodes.has(qaFindingCode(finding)),
    );
    const schemaActionItems = schemaIssues.map((issue) => schemaIssueCurationAction(issue));
    const qaActionItems = actionableQaFindings.map((finding) =>
      qaFindingCurationAction(finding, datasetType),
    );
    const semanticActionItems = collectProfileSemanticActionItems({
      profile,
      datasetType,
      payload: identity.payload,
      hasClassificationQueueContext: unresolvedClassificationAuthoringRows.length > 0,
    });
    const classificationQueueActionItems = unresolvedClassificationAuthoringRows.map(
      classificationQueueActionItem,
    );
    const locationQueueActionItems = unresolvedLocationAuthoringRows.map(locationQueueActionItem);
    const actionItems = [
      ...schemaActionItems.filter((item) => item.ai_required),
      ...qaActionItems,
      ...identityPreflightActionItems,
      ...classificationQueueActionItems,
      ...locationQueueActionItems,
      ...semanticActionItems,
    ];
    const queueGateItems = [];
    if (requireQueueContext && !queueContext) {
      queueGateItems.push({
        source: "curation_queue",
        code: "curation_queue_context_required",
        path: null,
        message:
          "Full-context prewrite authoring requires curation queue and dependency closure context.",
        action_kind: "queue_rebuild",
        required_owner: "foundry_deterministic_queue_build",
        ai_required: false,
        instruction:
          "Run dataset-curation-queue-build for the exact rows and pass --queue-dir before AI authoring or remote write planning.",
      });
    } else {
      if (curationQueueContext?.status === "missing_task") {
        queueGateItems.push({
          source: "curation_queue",
          code: "curation_queue_task_missing",
          path: null,
          message: "No matching curation queue task was found for this entity.",
          action_kind: "queue_rebuild",
          required_owner: "foundry_deterministic_queue_build",
          ai_required: false,
          instruction:
            "Rebuild the curation queue with this entity included before AI authoring or remote write planning.",
        });
      }
      if (curationQueueContext?.queue_status && curationQueueContext.queue_status !== "ready") {
        queueGateItems.push({
          source: "curation_queue",
          code: "curation_queue_not_ready",
          path: null,
          message:
            "The curation queue manifest is not ready, so dependency closure cannot be trusted for AI authoring or remote write planning.",
          action_kind: "queue_rebuild",
          required_owner: "foundry_deterministic_queue_build",
          ai_required: false,
          instruction:
            "Resolve curation queue blockers, rebuild the queue, and rerun the curation gate before AI authoring or remote write planning.",
          evidence: {
            queue_status: curationQueueContext.queue_status,
            queue_counts: curationQueueContext.queue_counts ?? null,
            queue_blockers: curationQueueContext.queue_blockers ?? [],
          },
        });
      }
      const unresolvedQueueRefs = ensureArray(
        curationQueueContext?.closure?.dependencies?.unresolved_refs,
      );
      if (unresolvedQueueRefs.length > 0) {
        queueGateItems.push({
          source: "curation_queue",
          code: "curation_queue_dependency_refs_unresolved",
          path: null,
          message:
            "The curation queue closure still has unresolved dependency references for this entity.",
          action_kind: "queue_rebuild",
          required_owner: "foundry_deterministic_queue_build",
          ai_required: false,
          instruction:
            "Provide local dependency rows or declared external references, rebuild the queue, and rerun the curation gate before AI authoring or remote write planning.",
          evidence: {
            unresolved_refs: unresolvedQueueRefs,
          },
        });
      }
    }
    const deterministicCleanupItems = [
      ...schemaActionItems.filter((item) => !item.ai_required),
      ...queueGateItems,
      ...fullContextItems,
      ...identityPreflightGateItemsForEntity,
    ];
    const blockingItemCount = actionItems.length + deterministicCleanupItems.length;
    const status =
      actionItems.length > 0
        ? "needs_foundry_ai_authoring"
        : deterministicCleanupItems.length > 0
          ? "needs_foundry_deterministic_cleanup"
          : waivedFindings.length > 0
            ? "ready_with_profile_waivers"
            : "ready";
    const packagePath = path.join(
      packageDir,
      `${datasetType}-${sanitizeFileName(identity.id)}.authoring-package.json`,
    );
    const packagePayload = {
      schema_version: 2,
      generated_at_utc: nowIso(),
      profile: profile.id,
      dataset_type: datasetType,
      entity_id: identity.id,
      version: identity.version,
      authoring_package: repoRelativePath(repoRoot, packagePath),
      source_rows_file: repoRelativePath(repoRoot, rowsFile),
      profile_context_files: profileContext.files,
      contract_context_files: contractContext.files,
      full_context_ai_completion: fullContextRequirement
        ? {
            required: true,
            proof: fullContextRequirement.proof,
            required_context_kinds: fullContextRequirement.requiredContextKinds,
            required_context_file_patterns: fullContextRequirement.requiredContextFilePatterns,
            context_file_details: contextFileDetails(contractContext.files),
          }
        : {
            required: false,
          },
      missing_context_files: [...profileContext.missing, ...contractContext.missing],
      schema_issues: schemaIssues,
      qa_findings: entityQaFindings,
      waived_findings: waivedFindings.map((finding) => ({
        ...finding,
        waiver_basis: profile.waiverReasons?.[qaFindingCode(finding)] ?? null,
      })),
      action_items: actionItems,
      deterministic_cleanup_items: deterministicCleanupItems,
      curation_queue_context: curationQueueContext,
      identity_preflight_context: identityPreflightAuthoringContext,
      unresolved_exchange_externalization_context: unresolvedExchangeExternalizationContext
        ? {
            status: unresolvedExchangeExternalizationContext.status,
            report_file: unresolvedExchangeExternalizationContext.reportPathRelative,
            input_rows_file: unresolvedExchangeExternalizationContext.inputRowsFileRelative,
            output_rows_file: unresolvedExchangeExternalizationContext.outputRowsFileRelative,
            traces_file: unresolvedExchangeExternalizationContext.tracesFileRelative,
            rows: unresolvedExchangeExternalizationRows,
            policy:
              "Completed entries prove Foundry moved unresolved elementary-flow process exchanges into common:other traces before schema validation and remote write planning; they do not create new elementary flows.",
          }
        : {
            status: "not_provided",
          },
      identity_reference_rewrite_context: {
        status:
          identityReferenceRewriteContext.sourceFile && identityReferenceRewrites.length > 0
            ? "attached"
            : identityReferenceRewriteContext.sourceFile
              ? "no_rows_for_entity"
              : "not_provided",
        source_file: identityReferenceRewriteContext.sourceFile
          ? repoRelativePath(repoRoot, identityReferenceRewriteContext.sourceFile)
          : null,
        rows: identityReferenceRewrites,
        policy:
          "These rows prove deterministic process reference rewrites to existing database flow identities selected by CLI identity-preflight before validation and write planning.",
      },
      identity_decision_apply_context: {
        status: identityDecisionApplyContext ? identityDecisionApplyContext.status : "not_provided",
        report_file: identityDecisionApplyArtifact
          ? repoRelativePath(repoRoot, identityDecisionApplyArtifact.path)
          : null,
        decisions: identityDecisionApplyRows,
        policy:
          "These rows prove AI-authored identity decisions were deterministically applied before write planning. Completed decisions can close identity_preflight_manual_review action items; mutation manifest still verifies full-context evidence before remote write.",
      },
      classification_authoring_context: {
        queue_file: classificationQueueContext
          ? repoRelativePath(repoRoot, classificationQueueContext.path)
          : null,
        rows: classificationAuthoringRows,
      },
      location_authoring_context: {
        queue_file: locationQueueContext
          ? repoRelativePath(repoRoot, locationQueueContext.path)
          : null,
        rows: locationAuthoringRows,
      },
      source_row: row,
      entity_payload: identity.payload,
      output_contract: {
        artifact: `${datasetType}-build-plan.json or structured patch set`,
        apply_owner:
          "tiangong-lca-cli dataset patch apply for structured patches, or type-specific build-plan materialize when a build plan is produced",
        apply_report:
          "dataset-patch-apply-report.json is required when AI output is a structured patch set",
        patch_contract:
          "Structured patch sets must include authoring_package, row_index or dataset_id/version, operation evidence or basis, and closes_action_items for the package action_items they resolve.",
        recommended_apply:
          "node scripts/foundry.mjs dataset-patch-apply --input <rows.jsonl> --patch <ai-patches.json> --out <patched.jsonl> --out-dir <apply-dir> --authoring-package-dir <ai-authoring-packages-dir> --require-authoring-package --require-action-item-closure",
        cleanup_owner:
          "Foundry removes or externalizes import-only trace metadata before remote write",
        final_gate_owner: "Foundry profile-aware curation gate",
      },
    };
    if (datasetType === "process") {
      packagePayload.process_id = identity.id;
      packagePayload.process_payload = identity.payload;
      packagePayload.process_qa_findings = entityQaFindings;
    }
    writeJson(packagePath, packagePayload);
    const authoringPackageText = readText(packagePath);
    const authoringPackageContextDetails = contextFileDetails(
      packagePayload.contract_context_files,
    );
    return {
      dataset_type: datasetType,
      entity_id: identity.id,
      ...(datasetType === "process" ? { process_id: identity.id } : {}),
      version: identity.version,
      schema_status: schemaRow?.status ?? "not_found",
      schema_issue_count: schemaIssues.length,
      qa_finding_count: entityQaFindings.length,
      ...(datasetType === "process" ? { process_qa_finding_count: entityQaFindings.length } : {}),
      waived_finding_count: waivedFindings.length,
      action_item_count: actionItems.length,
      identity_action_item_count: identityPreflightActionItems.length,
      identity_decision_apply_count: identityDecisionApplyRows.length,
      semantic_action_item_count: semanticActionItems.length,
      classification_queue_action_item_count: classificationQueueActionItems.length,
      location_queue_action_item_count: locationQueueActionItems.length,
      deterministic_cleanup_count: deterministicCleanupItems.length,
      blocking_item_count: blockingItemCount,
      authoring_package: repoRelativePath(repoRoot, packagePath),
      authoring_package_sha256: sha256Text(authoringPackageText),
      authoring_package_context_file_details: authoringPackageContextDetails,
      status,
    };
  });

  const actionItemCount = entityReports.reduce((total, item) => total + item.action_item_count, 0);
  const semanticActionItemCount = entityReports.reduce(
    (total, item) => total + item.semantic_action_item_count,
    0,
  );
  const identityActionItemCount = entityReports.reduce(
    (total, item) => total + item.identity_action_item_count,
    0,
  );
  const classificationQueueActionItemCount = entityReports.reduce(
    (total, item) => total + item.classification_queue_action_item_count,
    0,
  );
  const locationQueueActionItemCount = entityReports.reduce(
    (total, item) => total + item.location_queue_action_item_count,
    0,
  );
  const deterministicCleanupCount = entityReports.reduce(
    (total, item) => total + item.deterministic_cleanup_count,
    0,
  );
  const blockingItemCount = actionItemCount + deterministicCleanupCount;
  const waiverCount = entityReports.reduce((total, item) => total + item.waived_finding_count, 0);
  const report = {
    schema_version: 2,
    generated_at_utc: nowIso(),
    status:
      actionItemCount > 0
        ? "blocked_needs_foundry_ai_authoring"
        : deterministicCleanupCount > 0
          ? "blocked_needs_foundry_deterministic_cleanup"
          : waiverCount > 0
            ? "ready_with_profile_waivers"
            : "ready",
    profile: profile.id,
    dataset_type: datasetType,
    rows_file: repoRelativePath(repoRoot, rowsFile),
    schema_report: repoRelativePath(repoRoot, schemaReportPath),
    qa_report: repoRelativePath(repoRoot, qaReportPath),
    policy: {
      cli_qa_role: "deterministic_qa_report_only",
      foundry_role:
        "profile policy, AI authoring package, deterministic cleanup, waiver, final prewrite decision",
      waived_qa_codes: [...waivedQaCodes],
      required_multilang_english_before_write: true,
      preserve_source_language_variants: true,
    },
    context: {
      profile_files: profileContext.files.map((file) => file.path),
      contract_context_files: contractContext.files.map((file) => file.path),
      contract_context_file_details: contextFileDetails(contractContext.files),
      full_context_ai_completion: fullContextRequirement
        ? {
            required: true,
            proof: fullContextRequirement.proof,
            required_context_kinds: fullContextRequirement.requiredContextKinds,
            required_context_file_patterns: fullContextRequirement.requiredContextFilePatterns,
          }
        : {
            required: false,
          },
      curation_queue: queueContext
        ? {
            queue_dir: repoRelativePath(repoRoot, queueContext.queueDir),
            manifest_file: repoRelativePath(repoRoot, queueContext.manifestPath),
            status: queueContext.manifest.status ?? null,
            counts: queueContext.manifest.counts ?? null,
          }
        : null,
      require_queue_context: requireQueueContext,
      classification_queue: classificationQueueContext
        ? {
            queue_file: repoRelativePath(repoRoot, classificationQueueContext.path),
            rows: classificationQueueContext.rows.length,
          }
        : null,
      location_queue: locationQueueContext
        ? {
            queue_file: repoRelativePath(repoRoot, locationQueueContext.path),
            rows: locationQueueContext.rows.length,
          }
        : null,
      unresolved_exchange_externalization: unresolvedExchangeExternalizationContext
        ? {
            status: unresolvedExchangeExternalizationContext.status,
            report_file: unresolvedExchangeExternalizationContext.reportPathRelative,
            input_rows_file: unresolvedExchangeExternalizationContext.inputRowsFileRelative,
            output_rows_file: unresolvedExchangeExternalizationContext.outputRowsFileRelative,
            traces_file: unresolvedExchangeExternalizationContext.tracesFileRelative,
            externalized_exchanges: unresolvedExchangeExternalizationContext.externalizedExchanges,
            affected_rows: unresolvedExchangeExternalizationContext.affectedRows,
          }
        : null,
      identity_preflight: identityPreflightContext
        ? {
            index_file: repoRelativePath(repoRoot, identityPreflightContext.indexPath),
            rows: identityPreflightContext.rows.length,
            completed: identityPreflightContext.completed,
            pending: identityPreflightContext.pending,
          }
        : null,
      identity_reference_rewrites: identityReferenceRewriteContext.sourceFile
        ? {
            source_file: repoRelativePath(repoRoot, identityReferenceRewriteContext.sourceFile),
            rows: identityReferenceRewriteContext.sourceRows.length,
            scoped_rows: identityReferenceRewriteContext.scopedRows.length,
          }
        : null,
      identity_decision_apply: identityDecisionApplyContext
        ? {
            report_file: repoRelativePath(repoRoot, identityDecisionApplyArtifact.path),
            status: identityDecisionApplyContext.status,
            decisions: identityDecisionApplyContext.decisions.length,
            authoring_package_proofs: identityDecisionApplyContext.authoringPackageProofs.length,
          }
        : null,
      missing_context_files: [...profileContext.missing, ...contractContext.missing],
    },
    counts: {
      entities: entityReports.length,
      [datasetTypePlural[datasetType]]: entityReports.length,
      action_items: actionItemCount,
      identity_action_items: identityActionItemCount,
      semantic_action_items: semanticActionItemCount,
      classification_queue_action_items: classificationQueueActionItemCount,
      location_queue_action_items: locationQueueActionItemCount,
      deterministic_cleanup_items: deterministicCleanupCount,
      blocking_items: blockingItemCount,
      waivers: waiverCount,
      identity_preflight_rows: identityPreflightContext?.rows.length ?? 0,
      identity_preflight_completed: identityPreflightContext?.completed ?? 0,
      identity_preflight_pending: identityPreflightContext?.pending ?? 0,
      identity_reference_rewrites: identityReferenceRewriteContext.scopedRows.length,
      identity_decisions: identityDecisionApplyContext?.decisions.length ?? 0,
    },
    entities: entityReports,
  };
  if (datasetType === "process") {
    report.processes = entityReports;
  }
  fs.mkdirSync(outDir, { recursive: true });
  const reportFileName = "dataset-curation-gate-report.json";
  const entitiesFileName = `${datasetType}-curation-gate-entities.jsonl`;
  const reportPath = path.join(outDir, reportFileName);
  const jsonlPath = path.join(outDir, entitiesFileName);
  writeJson(reportPath, report);
  writeText(jsonlPath, jsonLines(entityReports));
  return {
    ...report,
    files: {
      report: repoRelativePath(repoRoot, reportPath),
      entities: repoRelativePath(repoRoot, jsonlPath),
      ...(datasetType === "process" ? { processes: repoRelativePath(repoRoot, jsonlPath) } : {}),
      authoring_packages_dir: repoRelativePath(repoRoot, packageDir),
    },
  };
}

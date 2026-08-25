import fs from "node:fs";
import path from "node:path";
import * as mutationManifestWorkflow from "./internal/mutation-manifest-workflow.ts";

const {
  asText,
  buildEvidenceScopeBlockers,
  buildFullContextAiCompletionBlockers,
  buildReferenceClosureBlockers,
  buildReferenceReuseItems,
  buildWriteCandidateItem,
  datasetTypeFromOptions,
  datasetTypePlural,
  decisionApplyContextRelevantToRowsFile,
  decisionCounts,
  decisionTaskContextBundleHashesFromContext,
  ensureArray,
  evidenceScopeBlocker,
  fileExists,
  fullContextAiCompletionRequirement,
  identityDecisionApplyReportOptionValues,
  identityDecisionUnresolvedReferenceKeys,
  identityKey,
  identityReferenceRewriteProofKeys,
  mapCurationEntities,
  mapRowsByIdentity,
  mapSchemaRows,
  nowIso,
  operationCounts,
  plannedRootReferenceIds,
  plannedRootReferenceKeys,
  profileFor,
  readCanonicalSupportRewriteContext,
  readClassificationDecisionApplyContext,
  readCleanupTransformContext,
  readDatasetSaveDraftDryRunArtifacts,
  readFileArtifactIfOption,
  readFlowDryRunArtifacts,
  readIdentityDecisionApplyContexts,
  readIdentityReferenceRewriteContext,
  readJsonArtifactsIfOption,
  readJsonIfOption,
  readLifecyclemodelDryRunArtifacts,
  readLocationDecisionApplyContext,
  readPatchApplyContext,
  readPolicySnapshots,
  readProcessDryRunArtifacts,
  readRows,
  readRowsIfExists,
  publicCanonicalSourceReferenceKeys,
  readSourceContactRewriteContext,
  readSourceReferenceRewriteContext,
  sourceContactSupportCanonicalUnitGroupProofKeys,
  sourceContactSupportTrueSourceProofKeys,
  sourceReferenceRewriteProofKeys,
  readUnresolvedExchangeExternalizationContext,
  referenceKey,
  remoteVerifyBlockerKeys,
  repoRelativePath,
  resolveRepoPath,
  sourceContactRewriteSemanticEvidenceCount,
  supportDatasetTypes,
  writeJson,
  writeJsonLines,
} = mutationManifestWorkflow;

interface JsonRecord {
  [key: string]: unknown;
}

interface ArtifactEnvelope {
  path: string;
  value: JsonRecord;
}

interface MutationManifestOptions extends JsonRecord {
  help?: unknown;
  type?: unknown;
  datasetType?: unknown;
  kind?: unknown;
  rowsFile?: string | null;
  input?: string | null;
  referenceRowsFile?: string | null;
  referenceRows?: string | null;
  reuseRowsFile?: string | null;
  schemaReport?: string | null;
  curationGateReport?: string | null;
  dryRunReport?: string | null;
  remoteVerifyReport?: string | null;
  cleanupReport?: string | null;
  patchApplyReport?: string | null;
  patchCollectReport?: string | null;
  authoringPatchCollectReport?: string | null;
  classificationDecisionApplyReport?: string | null;
  classificationDecisionsApplyReport?: string | null;
  locationDecisionApplyReport?: string | null;
  locationDecisionsApplyReport?: string | null;
  patchEvidenceFile?: string | null;
  patchEvidence?: string | null;
  outDir?: string | null;
  targetUserId?: string | null;
  targetOwnerId?: string | null;
  profile?: unknown;
  unresolvedExchangeExternalizationReport?: string | null;
  canonicalSupportRewriteReport?: string | null;
  canonicalSupportRewritesReport?: string | null;
  sourceContactRewriteReport?: string | null;
  sourceContactRewritesReport?: string | null;
  requirePatchCollectReport?: boolean | string;
  requireCurationGate?: boolean | string;
  verifiedReferenceLedger?: unknown;
  verifiedReferenceLedgers?: unknown;
  verifiedReferenceLedgerFile?: unknown;
  verifiedReferenceLedgerFiles?: unknown;
  verifiedFlowLedger?: unknown;
  verifiedFlowLedgers?: unknown;
}

interface MutationManifestArgs {
  repoRoot?: string;
  options?: MutationManifestOptions;
}

interface VerifiedReferenceProof {
  files: string[];
  rows: number;
  proven_keys: number;
  keys: Set<string>;
}

type SourceSemanticOptions = Parameters<typeof sourceContactRewriteSemanticEvidenceCount>[0];
type DecisionRelevanceOptions = Parameters<typeof decisionApplyContextRelevantToRowsFile>[0];
type FullContextOptions = Parameters<typeof buildFullContextAiCompletionBlockers>[0];
type WriteCandidateOptions = Parameters<typeof buildWriteCandidateItem>[0];
type DecisionHashContext = Parameters<typeof decisionTaskContextBundleHashesFromContext>[0];
type IdentityProofContext = Parameters<typeof identityReferenceRewriteProofKeys>[0];
type EvidenceBlockerOptions = Parameters<typeof evidenceScopeBlocker>[0];

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : {};
}

function optionList(value: unknown): string[] {
  return ensureArray(value).flatMap((entry) =>
    String(entry ?? "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
  );
}

function readJsonLinesIfExists(filePath: string | null | undefined): JsonRecord[] {
  if (!filePath || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return [];
  return fs
    .readFileSync(filePath, "utf8")
    .trim()
    .split(/\r?\n/u)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as JsonRecord);
}

function verifiedReferenceLedgerProof(
  repoRoot: string,
  options: MutationManifestOptions,
): VerifiedReferenceProof {
  const ledgerFiles = optionList(
    options.verifiedReferenceLedger ??
      options.verifiedReferenceLedgers ??
      options.verifiedReferenceLedgerFile ??
      options.verifiedReferenceLedgerFiles ??
      options.verifiedFlowLedger ??
      options.verifiedFlowLedgers,
  )
    .map((filePath) => resolveRepoPath(repoRoot, filePath))
    .filter((filePath): filePath is string =>
      Boolean(filePath && fs.existsSync(filePath) && fs.statSync(filePath).isFile()),
    );
  const keys = new Set<string>();
  let rows = 0;
  for (const filePath of ledgerFiles) {
    for (const row of readJsonLinesIfExists(filePath)) {
      rows += 1;
      const datasetType = asText(
        row.row_dataset_type ?? row.dataset_type ?? row.type ?? row.scope_dataset_type,
      );
      const table = asText(row.table) || (datasetTypePlural as Record<string, string>)[datasetType];
      const id = asText(row.dataset_id ?? row.id ?? row.flow_id ?? row.process_id);
      const version =
        asText(row.version ?? row.dataset_version ?? row.flow_version ?? row.process_version) ||
        "00.00.001";
      if (!table || !id) continue;
      keys.add(referenceKey({ table, id, version }));
    }
  }
  return {
    files: ledgerFiles.map((filePath) => repoRelativePath(repoRoot, filePath)),
    rows,
    proven_keys: keys.size,
    keys,
  };
}

export function runDatasetMutationManifest({
  repoRoot,
  options = {},
}: MutationManifestArgs = {}): JsonRecord {
  const datasetType = datasetTypeFromOptions(options);
  if (options.help) {
    return {
      schema_version: 1,
      status: "help",
      command: "dataset-mutation-manifest",
      usage: [
        "node scripts/foundry.mjs dataset-mutation-manifest --type flow --rows-file <ready-flow-rows.jsonl> --schema-report <validation-report.json> --dry-run-report <flow-publish-report.json> --target-user-id <uuid>",
        "node scripts/foundry.mjs dataset-mutation-manifest --type process --rows-file <ready-processes.jsonl> --schema-report <validation-report.json> --dry-run-report <save-draft-summary.json> --remote-verify-report <remote-verification-report.json> --target-user-id <uuid>",
        "node scripts/foundry.mjs dataset-mutation-manifest --type lifecyclemodel --rows-file <ready-lifecyclemodels.jsonl> --schema-report <validation-report.json> --dry-run-report <save-draft-summary.json> --target-user-id <uuid>",
        "node scripts/foundry.mjs dataset-mutation-manifest --type flow --rows-file <classified-flows.jsonl> --classification-decision-apply-report <classification-decisions-apply-report.json> --schema-report <validation-report.json> --dry-run-report <save-draft-summary.json> --target-user-id <uuid>",
        "node scripts/foundry.mjs dataset-mutation-manifest --type process --rows-file <located-processes.jsonl> --location-decision-apply-report <location-decisions-apply-report.json> --schema-report <validation-report.json> --dry-run-report <save-draft-summary.json> --target-user-id <uuid>",
        "node scripts/foundry.mjs dataset-mutation-manifest --type process --rows-file <patched-cleaned-rows.jsonl> --patch-collect-report <authoring-patch-collect-report.json> --require-patch-collect-report --patch-apply-report <dataset-patch-apply-report.json> --cleanup-report <dataset-curation-cleanup-report.json> --schema-report <validation-report.json> --dry-run-report <save-draft-summary.json> --target-user-id <uuid>",
      ],
      purpose:
        "Build a prewrite mutation manifest that separates write/update candidates, reusable existing references, and blocked rows before any commit.",
    };
  }

  const root = repoRoot!;
  const rowsFile = resolveRepoPath(root, options.rowsFile || options.input);
  const referenceRowsFile = resolveRepoPath(
    root,
    options.referenceRowsFile || options.referenceRows || options.reuseRowsFile,
  );
  const schemaReportArtifact = readJsonIfOption(
    root,
    options.schemaReport,
  ) as ArtifactEnvelope | null;
  const curationGateArtifact = readJsonIfOption(
    root,
    options.curationGateReport,
  ) as ArtifactEnvelope | null;
  const dryRunReportArtifact = readJsonIfOption(
    root,
    options.dryRunReport,
  ) as ArtifactEnvelope | null;
  const remoteVerifyArtifact = readJsonIfOption(
    root,
    options.remoteVerifyReport,
  ) as ArtifactEnvelope | null;
  const cleanupArtifact = readJsonIfOption(root, options.cleanupReport) as ArtifactEnvelope | null;
  const patchApplyArtifact = readJsonIfOption(
    root,
    options.patchApplyReport,
  ) as ArtifactEnvelope | null;
  const patchCollectArtifact = readJsonIfOption(
    root,
    options.patchCollectReport ?? options.authoringPatchCollectReport,
  ) as ArtifactEnvelope | null;
  const classificationDecisionApplyArtifact = readJsonIfOption(
    root,
    options.classificationDecisionApplyReport ?? options.classificationDecisionsApplyReport,
  ) as ArtifactEnvelope | null;
  const locationDecisionApplyArtifact = readJsonIfOption(
    root,
    options.locationDecisionApplyReport ?? options.locationDecisionsApplyReport,
  ) as ArtifactEnvelope | null;
  const identityDecisionApplyArtifacts = readJsonArtifactsIfOption(
    root,
    identityDecisionApplyReportOptionValues(options),
  ) as ArtifactEnvelope[];
  const identityDecisionApplyArtifact = identityDecisionApplyArtifacts[0] ?? null;
  const patchEvidenceFile = readFileArtifactIfOption(
    root,
    options.patchEvidenceFile || options.patchEvidence,
  );
  const defaultOut = `.foundry/workspaces/${datasetType}-dataset-mutation-manifest`;
  const outDir = resolveRepoPath(root, options.outDir || defaultOut)!;
  const targetUserId = asText(
    options.targetUserId ??
      options.targetOwnerId ??
      dryRunReportArtifact?.value?.target_user_id_override ??
      process.env.FOUNDRY_TARGET_USER_ID,
  );
  const profileId = String(options.profile || "generic")
    .trim()
    .toLowerCase();
  const profile = profileFor(root, profileId, options);
  const fullContextRequirement = fullContextAiCompletionRequirement(profile, datasetType, root);
  const classificationDecisionApplyContext = classificationDecisionApplyArtifact
    ? readClassificationDecisionApplyContext(root, classificationDecisionApplyArtifact)
    : null;
  const locationDecisionApplyContext = locationDecisionApplyArtifact
    ? readLocationDecisionApplyContext(root, locationDecisionApplyArtifact)
    : null;
  const identityDecisionApplyContext = readIdentityDecisionApplyContexts(
    root,
    identityDecisionApplyArtifacts,
  );
  const unresolvedExchangeExternalizationArtifact = readJsonIfOption(
    root,
    options.unresolvedExchangeExternalizationReport,
  ) as ArtifactEnvelope | null;
  const unresolvedExchangeExternalizationContext = readUnresolvedExchangeExternalizationContext(
    root,
    unresolvedExchangeExternalizationArtifact,
  );
  const canonicalSupportRewriteArtifact = readJsonIfOption(
    root,
    options.canonicalSupportRewriteReport || options.canonicalSupportRewritesReport,
  ) as ArtifactEnvelope | null;
  const canonicalSupportRewriteContext = readCanonicalSupportRewriteContext(
    root,
    canonicalSupportRewriteArtifact,
  );
  const sourceContactRewriteArtifact = readJsonIfOption(
    root,
    options.sourceContactRewriteReport ?? options.sourceContactRewritesReport,
  ) as ArtifactEnvelope | null;
  const sourceContactRewriteContext = readSourceContactRewriteContext(
    root,
    sourceContactRewriteArtifact,
  );
  const cleanupContext = readCleanupTransformContext(root, cleanupArtifact);
  const sourceContactRewriteSemanticEvidenceEntries = sourceContactRewriteSemanticEvidenceCount({
    repoRoot: root,
    datasetType,
    rowsFile,
    sourceContactRewriteContext:
      sourceContactRewriteContext as unknown as SourceSemanticOptions["sourceContactRewriteContext"],
    canonicalSupportRewriteContext:
      canonicalSupportRewriteContext as unknown as SourceSemanticOptions["canonicalSupportRewriteContext"],
    cleanupContext: cleanupContext as unknown as SourceSemanticOptions["cleanupContext"],
  });
  const hasClassificationDecisionProof =
    classificationDecisionApplyContext?.status === "completed" &&
    classificationDecisionApplyContext.decisions.length > 0 &&
    decisionApplyContextRelevantToRowsFile({
      repoRoot: root,
      rowsFile: rowsFile!,
      cleanupArtifact,
      context: classificationDecisionApplyContext as unknown as DecisionRelevanceOptions["context"],
    });
  const hasLocationDecisionProof =
    locationDecisionApplyContext?.status === "completed" &&
    locationDecisionApplyContext.decisions.length > 0 &&
    decisionApplyContextRelevantToRowsFile({
      repoRoot: root,
      rowsFile: rowsFile!,
      cleanupArtifact,
      context: locationDecisionApplyContext as DecisionRelevanceOptions["context"],
    });
  const hasIdentityDecisionProof =
    identityDecisionApplyContext?.status === "completed" &&
    identityDecisionApplyContext.decisions.length > 0 &&
    decisionApplyContextRelevantToRowsFile({
      repoRoot: root,
      rowsFile: rowsFile!,
      cleanupArtifact,
      context: identityDecisionApplyContext,
    });
  const requirePatchCollectReport =
    options.requirePatchCollectReport === true ||
    options.requirePatchCollectReport === "true" ||
    (Boolean(fullContextRequirement) &&
      !hasClassificationDecisionProof &&
      !hasLocationDecisionProof &&
      !hasIdentityDecisionProof &&
      sourceContactRewriteSemanticEvidenceEntries <= 0);

  if (!rowsFile || !fileExists(rowsFile)) {
    throw new Error("--rows-file is required and must point to JSON/JSONL write-candidate rows.");
  }
  if (!schemaReportArtifact) {
    throw new Error("--schema-report is required for mutation manifest generation.");
  }

  const rows = readRows(rowsFile);
  const referenceRows = readRowsIfExists(referenceRowsFile);
  const schemaRows = mapSchemaRows(schemaReportArtifact.value);
  const curationEntities = mapCurationEntities(curationGateArtifact?.value);
  const writeRows = mapRowsByIdentity(rows, datasetType);
  const writeCandidateKeys = new Set(writeRows.keys());
  const sourceReferenceRewriteContext = readSourceReferenceRewriteContext({
    repoRoot: root,
    rowsFile,
    options,
    writeRows,
  });
  const identityReferenceRewriteContext = readIdentityReferenceRewriteContext({
    repoRoot: root,
    rowsFile,
    options,
    writeRows,
    referenceRows,
    datasetType,
  });
  const verifiedReferenceProof = verifiedReferenceLedgerProof(root, options);
  const plannedRootKeys = plannedRootReferenceKeys(rows, datasetType);
  const plannedRootIds = plannedRootReferenceIds(rows, datasetType);
  const remoteVerifyBlockers = remoteVerifyBlockerKeys(remoteVerifyArtifact?.value, {
    plannedRootKeys,
    plannedRootIds,
  });
  const patchApplyContext =
    patchApplyArtifact || patchEvidenceFile
      ? readPatchApplyContext(root, patchApplyArtifact, patchEvidenceFile)
      : null;
  const evidenceScopeBlockers = buildEvidenceScopeBlockers({
    repoRoot: root,
    rowsFile,
    schemaReportArtifact,
    curationGateArtifact,
    dryRunReportArtifact,
    cleanupArtifact,
    patchApplyArtifact,
    patchApplyContext,
    patchCollectArtifact,
    requirePatchCollectReport,
    remoteVerifyArtifact,
    identityDecisionApplyContext,
    requireCurationGate:
      options.requireCurationGate === undefined
        ? !(datasetType === "support" || supportDatasetTypes.has(datasetType))
        : options.requireCurationGate === true || options.requireCurationGate === "true",
    identityReferenceRewriteContext,
    unresolvedExchangeExternalizationContext,
    canonicalSupportRewriteContext,
  });
  evidenceScopeBlockers.push(
    ...buildFullContextAiCompletionBlockers({
      repoRoot: root,
      profile,
      datasetType,
      curationGateArtifact,
      rowsFile,
      patchApplyArtifact,
      patchApplyContext: patchApplyContext as unknown as FullContextOptions["patchApplyContext"],
      patchCollectArtifact,
      cleanupArtifact,
      classificationDecisionApplyArtifact,
      classificationDecisionApplyContext:
        classificationDecisionApplyContext as unknown as FullContextOptions["classificationDecisionApplyContext"],
      locationDecisionApplyArtifact,
      locationDecisionApplyContext:
        locationDecisionApplyContext as unknown as FullContextOptions["locationDecisionApplyContext"],
      identityDecisionApplyArtifact,
      identityDecisionApplyContext,
      identityReferenceRewriteContext:
        identityReferenceRewriteContext as unknown as FullContextOptions["identityReferenceRewriteContext"],
      unresolvedExchangeExternalizationContext:
        unresolvedExchangeExternalizationContext as unknown as FullContextOptions["unresolvedExchangeExternalizationContext"],
      sourceContactRewriteContext:
        sourceContactRewriteContext as unknown as FullContextOptions["sourceContactRewriteContext"],
      canonicalSupportRewriteContext:
        canonicalSupportRewriteContext as unknown as FullContextOptions["canonicalSupportRewriteContext"],
      cleanupContext: cleanupContext as unknown as FullContextOptions["cleanupContext"],
    }),
  );
  evidenceScopeBlockers.push(
    ...buildReferenceClosureBlockers({
      repoRoot: root,
      rows,
      datasetType,
      remoteVerifyArtifact,
      provenReferenceKeys: new Set([
        ...identityReferenceRewriteProofKeys(
          identityReferenceRewriteContext as unknown as IdentityProofContext,
        ),
        ...sourceReferenceRewriteProofKeys(sourceReferenceRewriteContext),
        // FIX C: true sources the source/contact-rewrite stage committed into THIS
        // scope's support set (including review-report sources defensively harvested
        // even when their kind did not classify as true_source). The first
        // process.finalize must pass closure for these once they are in the support
        // commit. Only sources actually committed by that stage are surfaced here, so
        // this cannot loosen closure for any source not in the scope's support set.
        ...sourceContactSupportTrueSourceProofKeys(sourceContactRewriteContext),
        // CLASS 1 fix: a minted (account-local) Flow Property whose reference Unit Group
        // is a public canonical UG keeps the canonical UG as a remote reference (the
        // FP's referenceToReferenceUnitGroup was rewritten to the canonical published
        // version, and the canonical UG is never written). Prove that canonical UG
        // id@published-version so closure passes for the FP->UG edge without writing the
        // UG. Only UGs the source/contact-rewrite stage proved against the canonical
        // support cache are surfaced, so this cannot prove a non-canonical UG.
        ...sourceContactSupportCanonicalUnitGroupProofKeys(sourceContactRewriteContext),
        // Direct references to the well-known public canonical sources (ILCD
        // format + compliance-system) are always reusable from remote, even when
        // they were not produced by an in-scope rewrite mapping — e.g. minted
        // account-local FP/UG (P1a) reference the canonical compliance source
        // directly. Without this, their closure blocked on a source that is in
        // fact a fixed public canonical dataset.
        ...publicCanonicalSourceReferenceKeys,
        ...verifiedReferenceProof.keys,
      ]),
      unresolvedReferenceKeys: identityDecisionUnresolvedReferenceKeys(
        identityDecisionApplyContext,
      ),
      allowAccountLocalSupportAndElementary: Boolean(
        profile?.allowAccountLocalSupportAndElementary,
      ),
    }),
  );
  if (
    dryRunReportArtifact?.value?.mode === "commit" ||
    dryRunReportArtifact?.value?.commit === true
  ) {
    evidenceScopeBlockers.push(
      evidenceScopeBlocker({
        code: "dry_run_report_is_commit_report",
        stage: "dry_run",
        message:
          "dataset-mutation-manifest --dry-run-report must point to a dry-run summary, not a commit summary. Keep commit reports as post-write evidence alongside dataset verify-remote.",
        report: dryRunReportArtifact.path,
      } as unknown as EvidenceBlockerOptions),
    );
  }
  const dryRun = {
    flow:
      datasetType === "flow" && dryRunReportArtifact
        ? readFlowDryRunArtifacts(root, dryRunReportArtifact.value)
        : null,
    process:
      datasetType === "process" && dryRunReportArtifact
        ? readProcessDryRunArtifacts(root, dryRunReportArtifact.value)
        : null,
    lifecyclemodel:
      datasetType === "lifecyclemodel" && dryRunReportArtifact
        ? readLifecyclemodelDryRunArtifacts(root, dryRunReportArtifact.value)
        : null,
    datasetSaveDraft:
      (datasetType === "support" || supportDatasetTypes.has(datasetType)) && dryRunReportArtifact
        ? readDatasetSaveDraftDryRunArtifacts(root, dryRunReportArtifact.value)
        : null,
  };

  const writeEntries = [...writeRows.values()];
  for (const entry of writeEntries) {
    (entry.identity as typeof entry.identity & { sourceRowsFile?: string }).sourceRowsFile =
      repoRelativePath(root, rowsFile);
  }

  const writeItems = writeEntries.map(({ row, identity, index }) => {
    const itemDatasetType = identity.dataset_type || datasetType;
    const key = identityKey(identity);
    return buildWriteCandidateItem({
      repoRoot: root,
      datasetType: itemDatasetType,
      row,
      identity,
      rowIndex: index,
      schemaRow: schemaRows.get(key) ?? schemaRows.get(identity.id) ?? null,
      curationEntity: curationEntities.get(key) ?? curationEntities.get(identity.id) ?? null,
      curationGateProvided: Boolean(curationGateArtifact),
      dryRun,
      remoteVerifyBlockers,
      targetUserId,
      cleanupStatus: cleanupArtifact?.value?.status ?? "not_provided",
      patchApplyContext: patchApplyContext as unknown as WriteCandidateOptions["patchApplyContext"],
      sourceReferenceRewritesByKey: sourceReferenceRewriteContext.byIdentity,
      identityReferenceRewritesByKey: identityReferenceRewriteContext.byIdentity,
      identityDecisionApplyContext,
      cleanupContext: cleanupContext as unknown as WriteCandidateOptions["cleanupContext"],
      evidenceScopeBlockers,
      allowAccountLocalSupportAndElementary: Boolean(
        profile?.allowAccountLocalSupportAndElementary,
      ),
      profile,
    });
  });
  const referenceItems = buildReferenceReuseItems({
    repoRoot: root,
    datasetType,
    rows: referenceRows,
    writeCandidateKeys,
    identityReferenceRewritesByKey: identityReferenceRewriteContext.byIdentity,
  });
  const items = [...writeItems, ...referenceItems];
  const unresolvedTraceItems = items.flatMap((item) =>
    ensureArray(item?.foundry_traces?.unresolved_traces),
  );
  const unresolvedExchangeTraceItems = items.flatMap((item) =>
    ensureArray(item?.foundry_traces?.unresolved_exchange_traces),
  );
  const sourceExchangeCompletenessItems = items.flatMap((item) =>
    ensureArray(item?.foundry_traces?.source_exchange_completeness),
  );
  const blockerCount = items.reduce((total, item) => total + item.blockers.length, 0);
  const cleanupStatus = cleanupArtifact?.value?.status ?? "not_provided";
  const remoteVerifyStatus = remoteVerifyArtifact?.value?.status ?? "not_provided";
  const status =
    blockerCount > 0
      ? "blocked"
      : writeItems.length > 0
        ? "ready_for_remote_write"
        : "ready_reference_only";
  const readyWriteRows =
    status === "ready_for_remote_write"
      ? writeEntries
          .filter((entry, index) => {
            const item = writeItems[index];
            return item?.decision === "write_or_update" && item.blockers.length === 0;
          })
          .map((entry) => entry.row)
      : [];
  const blockedWriteRows = writeEntries
    .filter((entry, index) => writeItems[index]?.blockers.length > 0)
    .map((entry) => entry.row);
  const report = {
    schema_version: 1,
    generated_at_utc: nowIso(),
    status,
    profile: profile.id,
    dataset_type: datasetType,
    rows_file: repoRelativePath(root, rowsFile),
    reference_rows_file:
      referenceRowsFile && fileExists(referenceRowsFile)
        ? repoRelativePath(root, referenceRowsFile)
        : null,
    target_user_id: targetUserId || null,
    policy_snapshots: readPolicySnapshots(root, profile),
    evidence: {
      schema_report: repoRelativePath(root, schemaReportArtifact.path),
      curation_gate_report: curationGateArtifact
        ? repoRelativePath(root, curationGateArtifact.path)
        : null,
      cleanup_report: cleanupArtifact ? repoRelativePath(root, cleanupArtifact.path) : null,
      cleanup_status: cleanupStatus,
      patch_apply_report: patchApplyArtifact
        ? repoRelativePath(root, patchApplyArtifact.path)
        : null,
      patch_apply_status: patchApplyContext?.status ?? "not_provided",
      patch_collect_report: patchCollectArtifact
        ? repoRelativePath(root, patchCollectArtifact.path)
        : null,
      patch_collect_status: patchCollectArtifact?.value?.status ?? "not_provided",
      patch_collect_required: requirePatchCollectReport,
      patch_evidence_file: patchApplyContext?.evidenceFile
        ? repoRelativePath(root, patchApplyContext.evidenceFile)
        : null,
      patch_evidence_count: patchApplyContext?.evidenceRows.length ?? 0,
      classification_decision_apply_report: classificationDecisionApplyArtifact
        ? repoRelativePath(root, classificationDecisionApplyArtifact.path)
        : null,
      classification_decision_apply_status:
        classificationDecisionApplyContext?.status ?? "not_provided",
      classification_decision_count: classificationDecisionApplyContext?.decisions.length ?? 0,
      classification_decision_task:
        classificationDecisionApplyContext?.decisionTaskProof?.path ?? null,
      classification_decision_tasks:
        classificationDecisionApplyContext?.decisionTaskProofs?.map((proof) => proof.path) ?? [],
      classification_decision_context_bundle_sha256:
        classificationDecisionApplyContext?.decisionTaskProof?.context_bundle_sha256 ?? null,
      classification_decision_context_bundle_sha256s: decisionTaskContextBundleHashesFromContext(
        classificationDecisionApplyContext as unknown as DecisionHashContext,
      ),
      location_decision_apply_report: locationDecisionApplyArtifact
        ? repoRelativePath(root, locationDecisionApplyArtifact.path)
        : null,
      location_decision_apply_status: locationDecisionApplyContext?.status ?? "not_provided",
      location_decision_count: locationDecisionApplyContext?.decisions.length ?? 0,
      location_decision_task: locationDecisionApplyContext?.decisionTaskProof?.path ?? null,
      location_decision_tasks:
        locationDecisionApplyContext?.decisionTaskProofs?.map((proof) => proof.path) ?? [],
      location_decision_context_bundle_sha256:
        locationDecisionApplyContext?.decisionTaskProof?.context_bundle_sha256 ?? null,
      location_decision_context_bundle_sha256s: decisionTaskContextBundleHashesFromContext(
        locationDecisionApplyContext as DecisionHashContext,
      ),
      identity_decision_apply_report: identityDecisionApplyArtifact
        ? repoRelativePath(root, identityDecisionApplyArtifact.path)
        : null,
      identity_decision_apply_reports: identityDecisionApplyArtifacts.map((artifact) =>
        repoRelativePath(root, artifact.path),
      ),
      identity_decision_apply_status: identityDecisionApplyContext?.status ?? "not_provided",
      identity_decision_count: identityDecisionApplyContext?.decisions.length ?? 0,
      identity_decision_authoring_packages:
        identityDecisionApplyContext?.authoringPackageProofs.map((proof) => asRecord(proof).path) ??
        [],
      dry_run_report: dryRunReportArtifact
        ? repoRelativePath(root, dryRunReportArtifact.path)
        : null,
      remote_verify_report: remoteVerifyArtifact
        ? repoRelativePath(root, remoteVerifyArtifact.path)
        : null,
      remote_verify_status: remoteVerifyStatus,
      canonical_support_rewrite_report: canonicalSupportRewriteContext?.reportPathRelative ?? null,
      canonical_support_rewrite_status: canonicalSupportRewriteContext?.status ?? "not_provided",
      canonical_support_rewrite_input_rows:
        canonicalSupportRewriteContext?.inputRowsFileRelative ?? null,
      canonical_support_rewrite_output_rows:
        canonicalSupportRewriteContext?.outputRowsFileRelative ?? null,
      canonical_support_rewrite_deferred_rows:
        canonicalSupportRewriteContext?.deferredRowsFileRelative ?? null,
      canonical_support_rewrite_input_row_count:
        canonicalSupportRewriteContext?.counts?.input_rows ?? null,
      canonical_support_rewrite_output_row_count:
        canonicalSupportRewriteContext?.counts?.output_rows ?? null,
      canonical_support_rewrite_deferred_row_count:
        canonicalSupportRewriteContext?.counts?.deferred_rows ?? 0,
      canonical_support_rewrite_blockers: canonicalSupportRewriteContext?.blockers.length ?? 0,
      canonical_support_rewrite_deferred_blockers:
        canonicalSupportRewriteContext?.deferredBlockers.length ?? 0,
      unresolved_exchange_externalization_report:
        unresolvedExchangeExternalizationContext?.reportPathRelative ?? null,
      unresolved_exchange_externalization_status:
        unresolvedExchangeExternalizationContext?.status ?? "not_provided",
      unresolved_exchange_externalized_count:
        unresolvedExchangeExternalizationContext?.externalizedExchanges ?? 0,
      unresolved_exchange_externalization_input_rows_file:
        unresolvedExchangeExternalizationContext?.inputRowsFileRelative ?? null,
      unresolved_exchange_externalization_output_rows_file:
        unresolvedExchangeExternalizationContext?.outputRowsFileRelative ?? null,
      unresolved_exchange_externalization_traces_file:
        unresolvedExchangeExternalizationContext?.tracesFileRelative ?? null,
      source_reference_rewrites_file:
        sourceReferenceRewriteContext.sourceFile &&
        sourceReferenceRewriteContext.sourceRows.length > 0
          ? repoRelativePath(root, sourceReferenceRewriteContext.sourceFile)
          : null,
      identity_reference_rewrites_file:
        identityReferenceRewriteContext.sourceFile &&
        identityReferenceRewriteContext.sourceRows.length > 0
          ? repoRelativePath(root, identityReferenceRewriteContext.sourceFile)
          : null,
      verified_reference_ledger_files: verifiedReferenceProof.files,
      verified_reference_ledger_rows: verifiedReferenceProof.rows,
      verified_reference_ledger_proven_keys: verifiedReferenceProof.proven_keys,
      full_context_ai_completion_required: Boolean(fullContextRequirement),
      full_context_ai_completion_proof: fullContextRequirement?.proof ?? null,
      scope_blockers: evidenceScopeBlockers,
    },
    counts: {
      write_candidates: readyWriteRows.length,
      planned_write_candidates: writeItems.length,
      blocked_write_candidates: blockedWriteRows.length,
      reference_reuse: referenceItems.filter((item) => item.decision === "reuse_existing_reference")
        .length,
      covered_by_write_candidate: referenceItems.filter(
        (item) => item.decision === "covered_by_write_candidate",
      ).length,
      blocked_items: items.filter((item) => item.blockers.length > 0).length,
      blockers: blockerCount,
      decisions: decisionCounts(items),
      operations: operationCounts(items),
      ai_patch_evidence_entries: writeItems.reduce(
        (total, item) => total + item.ai_patch_evidence_count!,
        0,
      ),
      ai_classification_decision_entries: classificationDecisionApplyContext?.decisions.length ?? 0,
      ai_location_decision_entries: locationDecisionApplyContext?.decisions.length ?? 0,
      ai_identity_decision_entries: identityDecisionApplyContext?.decisions.length ?? 0,
      source_contact_rewrite_semantic_evidence_entries: sourceContactRewriteSemanticEvidenceEntries,
      unresolved_trace_entries: unresolvedTraceItems.length,
      unresolved_exchange_trace_entries: unresolvedExchangeTraceItems.length,
      source_exchange_completeness_entries: sourceExchangeCompletenessItems.length,
      source_reference_rewrites: sourceReferenceRewriteContext.scopedRows.length,
      identity_reference_rewrites: identityReferenceRewriteContext.scopedRows.length,
      verified_reference_ledger_rows: verifiedReferenceProof.rows,
      verified_reference_ledger_proven_keys: verifiedReferenceProof.proven_keys,
      identity_reference_reuse_rows: referenceItems.filter(
        (item) => item.identity_reference_rewrite_count > 0,
      ).length,
      unresolved_exchange_externalized:
        unresolvedExchangeExternalizationContext?.externalizedExchanges ?? 0,
    },
    items,
  };

  fs.mkdirSync(outDir, { recursive: true });
  const reportPath = path.join(outDir, "dataset-mutation-manifest.json");
  const itemsPath = path.join(outDir, "dataset-mutation-manifest-items.jsonl");
  const writeRowsPath = path.join(
    outDir,
    `${datasetTypePlural[datasetType]}.write-candidates.jsonl`,
  );
  const blockedWriteRowsPath = path.join(
    outDir,
    `${datasetTypePlural[datasetType]}.blocked-write-candidates.jsonl`,
  );
  const referenceRowsPath = path.join(
    outDir,
    `${datasetTypePlural[datasetType]}.reference-reuse.jsonl`,
  );
  const unresolvedTracesPath = path.join(outDir, "unresolved-traces.jsonl");
  const unresolvedExchangeTracesPath = path.join(outDir, "unresolved-exchange-traces.jsonl");
  const sourceExchangeCompletenessPath = path.join(
    outDir,
    "source-exchange-completeness-traces.jsonl",
  );
  const sourceReferenceRewritesPath = path.join(outDir, "source-reference-rewrites.jsonl");
  const identityReferenceRewritesPath = path.join(outDir, "identity-reference-rewrites.jsonl");
  const files = {
    report: repoRelativePath(root, reportPath),
    items: repoRelativePath(root, itemsPath),
    write_candidates: repoRelativePath(root, writeRowsPath),
    blocked_write_candidates: repoRelativePath(root, blockedWriteRowsPath),
    reference_reuse: repoRelativePath(root, referenceRowsPath),
    unresolved_traces: repoRelativePath(root, unresolvedTracesPath),
    source_exchange_completeness_traces: repoRelativePath(root, sourceExchangeCompletenessPath),
    source_reference_rewrites: repoRelativePath(root, sourceReferenceRewritesPath),
    identity_reference_rewrites: repoRelativePath(root, identityReferenceRewritesPath),
    unresolved_exchange_externalization_report:
      unresolvedExchangeExternalizationContext?.reportPathRelative ?? null,
    unresolved_exchange_traces:
      unresolvedExchangeExternalizationContext?.tracesFileRelative ?? null,
  };
  // `items` can be enormous for mega-scopes (thousands of flow mutations); embedding
  // it inline here overflows JSON.stringify's max string length (RangeError: Invalid
  // string length) and aborts the finalize stage. It is persisted verbatim to the
  // items JSONL (files.items) and stays on the in-memory return value for in-process
  // consumers, so omit the redundant inline copy from the written report file.
  const { items: _omitInlineItems, ...reportWithoutItems } = report;
  writeJson(reportPath, { ...reportWithoutItems, files });
  // Stream these JSONL writes: mega-scopes (1000+ flow mutations) produce row sets
  // whose JSON.stringify-joined form exceeds V8's max string length, so build them
  // line-by-line on disk instead of as one in-memory string.
  writeJsonLines(itemsPath, items);
  writeJsonLines(writeRowsPath, readyWriteRows);
  writeJsonLines(blockedWriteRowsPath, blockedWriteRows);
  writeJsonLines(referenceRowsPath, referenceRows);
  writeJsonLines(unresolvedTracesPath, unresolvedTraceItems);
  writeJsonLines(unresolvedExchangeTracesPath, unresolvedExchangeTraceItems);
  writeJsonLines(sourceExchangeCompletenessPath, sourceExchangeCompletenessItems);
  writeJsonLines(sourceReferenceRewritesPath, sourceReferenceRewriteContext.scopedRows);
  writeJsonLines(identityReferenceRewritesPath, identityReferenceRewriteContext.scopedRows);
  return {
    ...report,
    files,
  };
}

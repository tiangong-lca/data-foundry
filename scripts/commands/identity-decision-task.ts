import fs from "node:fs";
import path from "node:path";
import process from "node:process";

type JsonRecord = Record<string, unknown>;

type ContractContextFile = JsonRecord & {
  kind?: unknown;
  text?: unknown;
};

type IdentityEvidence = JsonRecord & {
  remote_search?: unknown;
  target?: unknown;
  top_candidates?: unknown;
};

type IdentityActionItem = JsonRecord & {
  code?: unknown;
  dependency_type?: unknown;
  dependency_id?: unknown;
  dependency_version?: unknown;
  target_dataset_type?: unknown;
  target_dataset_id?: unknown;
  target_dataset_version?: unknown;
  dataset_type?: unknown;
  dataset_id?: unknown;
  dataset_version?: unknown;
  relation?: unknown;
  evidence?: IdentityEvidence;
};

type AuthoringPackage = JsonRecord & {
  dataset_type?: unknown;
  entity_id?: unknown;
  version?: unknown;
  action_items?: unknown;
  contract_context_files?: unknown;
  missing_context_files?: unknown;
  full_context_ai_completion?: unknown;
  fullContextAiCompletion?: unknown;
};

type PackageProof = {
  entity: JsonRecord;
  package_ref: string | null;
  package_path: string | null;
  package_sha256: string | null;
  expected_sha256: string | null;
  package: AuthoringPackage | null;
  blockers: JsonRecord[];
  live_package_ref?: string | null;
  live_package_path?: string | null;
};

type AuthoringEntity = {
  dataset_type: string;
  entity_id: string;
  version: string;
};

type IdentityTaskRow = JsonRecord & {
  dataset_type: string;
  dataset_id: string;
  dataset_version: string;
  relation: string;
  action_item_code: string;
  action_item_index: number;
  authoring_package: string | null;
  authoring_package_sha256: string | null;
  authoring_entity: AuthoringEntity;
  action_item: IdentityActionItem;
  package: AuthoringPackage;
  package_proof: PackageProof;
  source_task_rows?: IdentityTaskRow[];
  source_action_items?: JsonRecord[];
  action_item_codes?: string[];
  related_authoring_packages?: JsonRecord[];
  source_action_item_count?: number;
};

type SharedContextBundle = JsonRecord & {
  path: string;
  sha256: string;
};

export type IdentityDecisionTaskOptions = Record<string, unknown> & {
  help?: unknown;
  curationGateReport?: unknown;
  report?: unknown;
  input?: unknown;
  outDir?: unknown;
  sharedContextCacheDir?: unknown;
  contextCacheDir?: unknown;
  rowsFile?: unknown;
};

export type IdentityDecisionTaskFactoryDependencies = {
  asText: (value: unknown) => string;
  datasetRowsFileStem: (datasetType: string) => string;
  decisionAuthoringContext: (contextBundle: JsonRecord) => JsonRecord;
  decisionTaskBuildStatus: (input: {
    queueRows: IdentityTaskRow[];
    blockers: JsonRecord[];
    readyStatus: string;
    emptyStatus: string;
  }) => string;
  decisionTaskContextFileSummary: (file: unknown) => JsonRecord;
  dedupeDecisionTaskContextFiles: (files: ContractContextFile[]) => ContractContextFile[];
  ensureArray: <T>(value: T | T[] | null | undefined) => T[];
  fileExists: (filePath: string) => boolean;
  hasQueueSelectionOptions: (options: IdentityDecisionTaskOptions) => boolean;
  normalizedList: (value: unknown) => string[];
  nowIso: () => string;
  readJson: (filePath: string) => JsonRecord;
  readText: (filePath: string) => string;
  repoRelativePath: (filePath: string) => string;
  repoRoot: string;
  resolveRepoPath: (value: unknown) => string | null;
  selectDecisionTaskQueueRows: (
    rows: IdentityTaskRow[],
    options: IdentityDecisionTaskOptions,
    codeForRow: (row: IdentityTaskRow) => string,
  ) => {
    selected: Array<{ row: IdentityTaskRow; index?: number }>;
    selection: JsonRecord;
  };
  sha256Text: (text: string) => string;
  shellQuote: (value: unknown) => string;
  unique: <T>(values: T[]) => T[];
  writeDecisionTaskSharedContextBundle: (input: {
    outDir: string;
    taskKind: string;
    files: ContractContextFile[];
    references: JsonRecord[];
    cacheDir: string | null;
  }) => SharedContextBundle;
  writeJson: (filePath: string, value: unknown) => unknown;
  writeJsonLines: (filePath: string, rows: unknown[]) => unknown;
};

export function createIdentityDecisionTaskCommands({
  asText,
  datasetRowsFileStem,
  decisionAuthoringContext,
  decisionTaskBuildStatus,
  decisionTaskContextFileSummary,
  dedupeDecisionTaskContextFiles,
  ensureArray,
  fileExists,
  hasQueueSelectionOptions,
  normalizedList,
  nowIso,
  readJson,
  readText,
  repoRelativePath,
  repoRoot,
  resolveRepoPath,
  selectDecisionTaskQueueRows,
  sha256Text,
  shellQuote,
  unique,
  writeDecisionTaskSharedContextBundle,
  writeJson,
  writeJsonLines,
}: IdentityDecisionTaskFactoryDependencies) {
  const identityDecisionActionCodes = new Set([
    "identity_preflight_manual_review",
    "elementary_flow_identity_manual_review",
  ]);

  function curationGateEntities(report: JsonRecord): JsonRecord[] {
    return ensureArray<JsonRecord>(
      (report.entities ?? report.processes ?? report.flows ?? report.items) as
        JsonRecord | JsonRecord[] | null | undefined,
    );
  }

  function readAuthoringPackageForIdentityTask(entity: JsonRecord): PackageProof {
    const packageRef = asText(entity?.authoring_package ?? entity?.authoringPackage);
    const packagePath = resolveRepoPath(packageRef);
    const proof: PackageProof = {
      entity,
      package_ref: packageRef || null,
      package_path: packagePath,
      package_sha256: null,
      expected_sha256: asText(entity?.authoring_package_sha256) || null,
      package: null,
      blockers: [],
    };
    if (!packageRef || !packagePath || !fileExists(packagePath)) {
      proof.blockers.push({
        code: "identity_decision_authoring_package_missing",
        message: "Identity decision task requires a readable full-context authoring package.",
        authoring_package: packageRef || null,
      });
      return proof;
    }
    const text = readText(packagePath);
    proof.package_sha256 = sha256Text(text);
    try {
      proof.package = JSON.parse(text) as AuthoringPackage;
    } catch (error) {
      proof.blockers.push({
        code: "identity_decision_authoring_package_invalid",
        message: error instanceof Error ? error.message : String(error),
        authoring_package: packageRef,
      });
      return proof;
    }
    if (proof.expected_sha256 && proof.expected_sha256 !== proof.package_sha256) {
      proof.blockers.push({
        code: "identity_decision_authoring_package_hash_mismatch",
        message:
          "Authoring package sha256 in the curation gate report no longer matches the package content.",
        authoring_package: packageRef,
        expected_sha256: proof.expected_sha256,
        actual_sha256: proof.package_sha256,
      });
    }
    return proof;
  }

  function snapshotAuthoringPackageProof(proof: PackageProof, snapshotDir: string): PackageProof {
    if (!proof?.package || proof.blockers.length > 0) return proof;
    fs.mkdirSync(snapshotDir, { recursive: true });
    const parsed = path.parse(path.basename((proof.package_path || proof.package_ref)!));
    const snapshotPath = path.join(
      snapshotDir,
      `${parsed.name}.${proof.package_sha256}.snapshot${parsed.ext || ".json"}`,
    );
    if (!fileExists(snapshotPath)) {
      fs.copyFileSync(proof.package_path!, snapshotPath);
    }
    return {
      ...proof,
      live_package_ref: proof.package_ref,
      live_package_path: proof.package_path,
      package_ref: repoRelativePath(snapshotPath),
      package_path: snapshotPath,
      expected_sha256: proof.package_sha256,
    };
  }

  function contractContextKindsForPackage(packagePayload: AuthoringPackage): Set<string> {
    return new Set(
      ensureArray<ContractContextFile>(
        packagePayload.contract_context_files as ContractContextFile | ContractContextFile[],
      )
        .filter((file) => asText(file.kind) && asText(file.text))
        .map((file) => asText(file.kind)),
    );
  }

  function requiredIdentityContextKinds(packagePayload: AuthoringPackage): string[] {
    const fullContext = (packagePayload.full_context_ai_completion ??
      packagePayload.fullContextAiCompletion) as JsonRecord | undefined;
    const required = normalizedList(
      fullContext?.required_context_kinds ?? fullContext?.requiredContextKinds,
    );
    return required.length > 0 ? required : ["schema", "methodology_yaml", "ruleset"];
  }

  function identityTaskPackageContextBlockers(proof: PackageProof): JsonRecord[] {
    const blockers = [...proof.blockers];
    const packagePayload = proof.package;
    if (!packagePayload) return blockers;
    const availableKinds = contractContextKindsForPackage(packagePayload);
    for (const missing of ensureArray(packagePayload.missing_context_files)) {
      blockers.push({
        code: "identity_decision_authoring_package_missing_context_file",
        message:
          "Authoring package records missing context files and cannot be sent as a full-context identity decision task.",
        authoring_package: proof.package_ref,
        missing_context_file: missing,
      });
    }
    for (const kind of requiredIdentityContextKinds(packagePayload)) {
      if (!availableKinds.has(kind)) {
        blockers.push({
          code: "identity_decision_required_context_missing",
          message:
            "Identity decision task must include the full schema/YAML/ruleset/category context from the authoring package before AI authoring.",
          kind,
          authoring_package: proof.package_ref,
        });
      }
    }
    return blockers;
  }

  function identityActionItemsFromPackage(
    proof: PackageProof,
  ): Array<{ item: IdentityActionItem; actionIndex: number }> {
    const packagePayload = proof.package ?? {};
    return ensureArray<IdentityActionItem>(
      packagePayload.action_items as IdentityActionItem | IdentityActionItem[],
    )
      .map((item, actionIndex) => ({ item, actionIndex }))
      .filter(({ item }) => identityDecisionActionCodes.has(asText(item?.code)));
  }

  function identityDecisionTargetForAction(
    packagePayload: AuthoringPackage,
    actionItem: IdentityActionItem,
  ) {
    const dependencyType = asText(actionItem?.dependency_type);
    const dependencyId = asText(actionItem?.dependency_id);
    const dependencyVersion = asText(actionItem?.dependency_version);
    return {
      dataset_type:
        dependencyType ||
        asText(actionItem?.target_dataset_type) ||
        asText(actionItem?.dataset_type) ||
        asText(packagePayload?.dataset_type),
      dataset_id:
        dependencyId ||
        asText(actionItem?.target_dataset_id) ||
        asText(actionItem?.dataset_id) ||
        asText(packagePayload?.entity_id),
      dataset_version:
        dependencyVersion ||
        asText(actionItem?.target_dataset_version) ||
        asText(actionItem?.dataset_version) ||
        asText(packagePayload?.version) ||
        "00.00.001",
    };
  }

  function identityDecisionTaskRowsFromPackages(packageProofs: PackageProof[]): IdentityTaskRow[] {
    const rows: IdentityTaskRow[] = [];
    for (const proof of packageProofs) {
      const packagePayload = proof.package;
      if (!packagePayload) continue;
      for (const { item, actionIndex } of identityActionItemsFromPackage(proof)) {
        const target = identityDecisionTargetForAction(packagePayload, item);
        rows.push({
          dataset_type: target.dataset_type,
          dataset_id: target.dataset_id,
          dataset_version: target.dataset_version,
          relation: asText(item?.relation) || "current",
          action_item_code: asText(item?.code),
          action_item_index: actionIndex,
          authoring_package: proof.package_ref,
          authoring_package_sha256: proof.package_sha256,
          authoring_entity: {
            dataset_type: asText(packagePayload.dataset_type),
            entity_id: asText(packagePayload.entity_id),
            version: asText(packagePayload.version),
          },
          action_item: item,
          package: packagePayload,
          package_proof: proof,
        });
      }
    }
    return rows;
  }

  function identityDecisionTaskRowKey(row: IdentityTaskRow): string {
    return JSON.stringify([
      asText(row?.dataset_type).toLowerCase(),
      asText(row?.dataset_id),
      asText(row?.dataset_version) || "00.00.001",
    ]);
  }

  function identityDecisionTaskSourceItem(row: IdentityTaskRow): JsonRecord {
    return {
      dataset_type: row.dataset_type,
      dataset_id: row.dataset_id,
      dataset_version: row.dataset_version || "00.00.001",
      relation: row.relation,
      action_item_code: row.action_item_code,
      action_item_index: row.action_item_index,
      authoring_package: row.authoring_package,
      authoring_package_sha256: row.authoring_package_sha256,
      authoring_entity: row.authoring_entity,
      evidence: row.action_item?.evidence ?? null,
    };
  }

  function identityDecisionTaskPackageRefs(rows: IdentityTaskRow[]): JsonRecord[] {
    const byKey = new Map<string, JsonRecord>();
    for (const row of ensureArray(rows)) {
      const key = JSON.stringify([row.authoring_package, row.authoring_package_sha256]);
      if (!byKey.has(key)) {
        byKey.set(key, {
          authoring_package: row.authoring_package,
          authoring_package_sha256: row.authoring_package_sha256,
          authoring_entity: row.authoring_entity,
        });
      }
    }
    return [...byKey.values()];
  }

  function identityDecisionTaskRawRows(row: IdentityTaskRow): IdentityTaskRow[] {
    return ensureArray(row.source_task_rows).length > 0 ? row.source_task_rows! : ensureArray(row);
  }

  function identityDecisionTaskActionCodes(row: IdentityTaskRow): string[] {
    const rawRows = identityDecisionTaskRawRows(row);
    return unique(
      [
        ...ensureArray(row?.action_item_codes),
        row?.action_item_code,
        ...rawRows.map((rawRow) => rawRow.action_item_code),
      ].map(asText),
    );
  }

  function primaryIdentityDecisionActionCode(codes: string[]): string {
    return codes.includes("elementary_flow_identity_manual_review")
      ? "elementary_flow_identity_manual_review"
      : codes[0] || "identity_preflight_manual_review";
  }

  function mergeIdentityDecisionTaskRows(rows: IdentityTaskRow[]): IdentityTaskRow[] {
    const byKey = new Map<string, IdentityTaskRow>();
    for (const row of rows) {
      const key = identityDecisionTaskRowKey(row);
      if (!byKey.has(key)) {
        byKey.set(key, {
          ...row,
          dataset_version: row.dataset_version || "00.00.001",
          source_task_rows: [],
          source_action_items: [],
          action_item_codes: [],
          related_authoring_packages: [],
        });
      }
      const merged = byKey.get(key)!;
      const previousPrimaryCode = merged.action_item_code;
      merged.source_task_rows!.push(row);
      merged.source_action_items!.push(identityDecisionTaskSourceItem(row));
      merged.action_item_codes = unique([...merged.action_item_codes!, row.action_item_code]);
      merged.related_authoring_packages = identityDecisionTaskPackageRefs(merged.source_task_rows!);
      merged.source_action_item_count = merged.source_action_items!.length;
      merged.action_item_code = primaryIdentityDecisionActionCode(merged.action_item_codes);
      if (
        previousPrimaryCode !== merged.action_item_code &&
        row.action_item_code === merged.action_item_code &&
        merged.action_item !== row.action_item
      ) {
        merged.action_item = row.action_item;
        merged.action_item_index = row.action_item_index;
        merged.authoring_package = row.authoring_package;
        merged.authoring_package_sha256 = row.authoring_package_sha256;
        merged.authoring_entity = row.authoring_entity;
        merged.package = row.package;
        merged.package_proof = row.package_proof;
      }
    }
    return [...byKey.values()];
  }

  function buildIdentityDecisionTemplateRows(
    taskRows: IdentityTaskRow[],
    contextBundle: JsonRecord | null = null,
  ): JsonRecord[] {
    const authoringContext = contextBundle ? decisionAuthoringContext(contextBundle) : null;
    return taskRows.map((row, index) => {
      const actionCodes = identityDecisionTaskActionCodes(row);
      const isElementaryDecision = actionCodes.includes("elementary_flow_identity_manual_review");
      return {
        dataset_type: row.dataset_type,
        dataset_id: row.dataset_id,
        dataset_version: row.dataset_version || "00.00.001",
        decision_status: "completed",
        identity_decision: isElementaryDecision
          ? "__AI_SELECT_REUSE_EXISTING_REFERENCE_OR_BLOCK_UNRESOLVED__"
          : "__AI_SELECT_REUSE_EXISTING_REFERENCE_CREATE_NEW_OR_BLOCK_UNRESOLVED__",
        canonical: {
          table: datasetRowsFileStem(row.dataset_type),
          ref_object_id: "__AI_FILL_CANONICAL_REF_OBJECT_ID_IF_REUSE__",
          version: "__AI_FILL_CANONICAL_VERSION_IF_REUSE__",
          short_description: "__AI_FILL_CANONICAL_SHORT_DESCRIPTION_IF_REUSE__",
        },
        basis: "__AI_FILL_IDENTITY_DECISION_BASIS__",
        used_context_kinds: ["__AI_FILL_USED_CONTEXT_KINDS__"],
        closes_action_items: actionCodes,
        authoring_package: row.authoring_package,
        authoring_package_sha256: row.authoring_package_sha256,
        ...(authoringContext ? { authoring_context: authoringContext } : {}),
        evidence: {
          source: "foundry_identity_decision_task",
          task_row_index: index,
          relation: row.relation,
          action_item_code: row.action_item_code,
          action_item_codes: actionCodes,
          source_action_item_count:
            Number(row.source_action_item_count) || identityDecisionTaskRawRows(row).length,
          source_action_items: ensureArray(row.source_action_items),
          related_authoring_packages: ensureArray(row.related_authoring_packages),
          identity_preflight: row.action_item?.evidence ?? null,
          remote_search: row.action_item?.evidence?.remote_search ?? null,
          target: row.action_item?.evidence?.target ?? null,
          top_candidates: row.action_item?.evidence?.top_candidates ?? [],
          authoring_entity: row.authoring_entity,
        },
      };
    });
  }

  function runDatasetIdentityDecisionTaskBuild(options: IdentityDecisionTaskOptions): JsonRecord {
    if (options.help) {
      return {
        schema_version: 1,
        status: "help",
        command: "dataset-identity-decision-task-build",
        usage: [
          "node scripts/foundry.ts dataset-identity-decision-task-build --curation-gate-report <dataset-curation-gate-report.json> --out-dir <task-dir> [--shared-context-cache-dir <cache-dir>]",
        ],
        purpose:
          "Build an AI-facing identity decision task from Foundry curation gate authoring packages. AI decides reuse_existing_reference/create_new/block_unresolved; deterministic apply is handled by dataset-identity-decisions-apply.",
      };
    }
    const curationGateReportPath = resolveRepoPath(
      options.curationGateReport || options.report || options.input,
    );
    if (!curationGateReportPath || !fileExists(curationGateReportPath)) {
      throw new Error(
        "--curation-gate-report is required and must point to dataset-curation-gate-report.json.",
      );
    }
    const outDir = resolveRepoPath(options.outDir || ".foundry/workspaces/identity-decision-task")!;
    const sharedContextCacheDir = resolveRepoPath(
      options.sharedContextCacheDir || options.contextCacheDir,
    );
    fs.mkdirSync(outDir, { recursive: true });
    const snapshotDir = path.join(outDir, "authoring-package-snapshots");
    const curationGateReport = readJson(curationGateReportPath);
    const entities = curationGateEntities(curationGateReport);
    const packageProofs = entities
      .map(readAuthoringPackageForIdentityTask)
      .filter((proof) => {
        if (!proof.package) return proof.blockers.length > 0;
        return identityActionItemsFromPackage(proof).length > 0;
      })
      .map((proof) => snapshotAuthoringPackageProof(proof, snapshotDir));
    const sourceTaskRows = identityDecisionTaskRowsFromPackages(packageProofs);
    const uniqueTaskRows = mergeIdentityDecisionTaskRows(sourceTaskRows);
    const selected = selectDecisionTaskQueueRows(
      sourceTaskRows,
      options,
      (row) => row.action_item_code,
    );
    const selectedSourceRows = hasQueueSelectionOptions(options)
      ? selected.selected.map(({ row }) => row)
      : sourceTaskRows;
    const selectedRows = mergeIdentityDecisionTaskRows(selectedSourceRows);
    const selectedRawRows = selectedRows.flatMap(identityDecisionTaskRawRows);
    const selection = hasQueueSelectionOptions(options)
      ? selected.selection
      : {
          source_queue_rows: sourceTaskRows.length,
          matched_queue_rows: sourceTaskRows.length,
          selected_queue_rows: sourceTaskRows.length,
          source_queue_row_indices: sourceTaskRows.map((_, index) => index),
        };
    const taskPath = path.join(outDir, "identity-decision-task.json");
    const templatePath = path.join(outDir, "identity-decisions.template.jsonl");
    const decisionFile = path.join(outDir, "identity-decisions.jsonl");
    const reportPath = path.join(outDir, "identity-decision-task-report.json");
    const contractContext = {
      files: selectedRawRows.flatMap((row) =>
        ensureArray<ContractContextFile>(
          row.package.contract_context_files as
            ContractContextFile | ContractContextFile[] | null | undefined,
        ),
      ),
      missing: selectedRawRows.flatMap((row) => ensureArray(row.package?.missing_context_files)),
    };
    const identityContextFiles = dedupeDecisionTaskContextFiles(contractContext.files);
    const identityContextReferences = selectedRows.flatMap((row) =>
      identityDecisionTaskRawRows(row).flatMap((rawRow) =>
        ensureArray<ContractContextFile>(
          rawRow.package.contract_context_files as
            ContractContextFile | ContractContextFile[] | null | undefined,
        ).map((file) => {
          const summary = decisionTaskContextFileSummary(file);
          return {
            ...summary,
            authoring_package: rawRow.authoring_package,
            authoring_package_sha256: rawRow.authoring_package_sha256,
            action_item_code: rawRow.action_item_code,
            dataset_type: rawRow.dataset_type,
            dataset_id: rawRow.dataset_id,
            dataset_version: rawRow.dataset_version,
          };
        }),
      ),
    );
    const sharedContextBundle = writeDecisionTaskSharedContextBundle({
      outDir,
      taskKind: "identity_decision_authoring",
      files: identityContextFiles,
      references: identityContextReferences,
      cacheDir: sharedContextCacheDir,
    });
    const contextBundleStablePayload = {
      task_kind: "identity_decision_authoring",
      source_curation_gate_report: repoRelativePath(curationGateReportPath),
      task_rows: selectedRows.length,
      source_identity_action_items: selectedSourceRows.length,
      contract_context_files: identityContextFiles.map(decisionTaskContextFileSummary),
      missing_context_files: contractContext.missing,
      authoring_packages: selectedRawRows.map((row) => ({
        authoring_package: row.authoring_package,
        authoring_package_sha256: row.authoring_package_sha256,
        action_item_code: row.action_item_code,
        dataset_type: row.dataset_type,
        dataset_id: row.dataset_id,
        dataset_version: row.dataset_version,
      })),
      shared_context_bundle_sha256: sharedContextBundle.sha256,
    };
    const contextBundle = {
      ...contextBundleStablePayload,
      task: repoRelativePath(taskPath),
      shared_context_bundle: sharedContextBundle,
      hash_scope:
        "task_kind, source_curation_gate_report, task_rows, source_identity_action_items, contract_context_files, missing_context_files, authoring_packages, and shared_context_bundle_sha256; task path and generated_at_utc are excluded.",
      sha256: sha256Text(JSON.stringify(contextBundleStablePayload)),
    };
    const templateRows = buildIdentityDecisionTemplateRows(selectedRows, contextBundle);
    const blockers = [
      ...packageProofs.flatMap(identityTaskPackageContextBlockers),
      ...selectedRows
        .filter((row) => !row.dataset_type || !row.dataset_id)
        .map((row) => ({
          code: "identity_decision_target_missing",
          message: "Identity action item does not identify the flow/process target to decide.",
          authoring_package: row.authoring_package,
          action_item_code: row.action_item_code,
        })),
    ];
    const datasetTypes = unique(selectedRows.map((row) => row.dataset_type));
    const task = {
      schema_version: 1,
      generated_at_utc: nowIso(),
      status: decisionTaskBuildStatus({
        queueRows: selectedRows,
        blockers,
        readyStatus: "ready_for_ai_identity_decisions",
        emptyStatus: "ready_no_identity_actions",
      }),
      task_kind: "identity_decision_authoring",
      source_curation_gate_report: repoRelativePath(curationGateReportPath),
      counts: {
        curation_entities: entities.length,
        identity_action_items: sourceTaskRows.length,
        unique_identity_targets: uniqueTaskRows.length,
        selected_identity_action_items: selectedSourceRows.length,
        selected_unique_identity_targets: selectedRows.length,
        deduplicated_identity_action_items: selectedSourceRows.length - selectedRows.length,
        template_decisions: templateRows.length,
        authoring_packages: unique(selectedRawRows.map((row) => row.authoring_package)).length,
        dataset_types: datasetTypes.length,
        blockers: blockers.length,
      },
      blockers,
      dataset_types: datasetTypes,
      selection,
      identity_action_items: selectedRows.map((row) => ({
        dataset_type: row.dataset_type,
        dataset_id: row.dataset_id,
        dataset_version: row.dataset_version,
        relation: row.relation,
        action_item_code: row.action_item_code,
        authoring_package: row.authoring_package,
        authoring_package_sha256: row.authoring_package_sha256,
        action_item_codes: identityDecisionTaskActionCodes(row),
        source_action_item_count:
          Number(row.source_action_item_count) || identityDecisionTaskRawRows(row).length,
        source_action_items: ensureArray(row.source_action_items),
        related_authoring_packages: ensureArray(row.related_authoring_packages),
        evidence: row.action_item?.evidence ?? null,
      })),
      context_bundle: contextBundle,
      shared_context_bundle: sharedContextBundle,
      instructions: [
        "Read shared_context_bundle once for full schema/YAML/ruleset/category/location text, then read each snapshotted full authoring package for source row, identity-preflight candidates, action items, and package-specific evidence.",
        "Use the task-local authoring-package snapshot paths in decisions. Do not replace them with live curation-gate package paths, because finalize can regenerate live packages after decisions are applied.",
        "For product/process identity_preflight_manual_review, choose reuse_existing_reference, create_new, or block_unresolved with evidence.",
        "For elementary_flow_identity_manual_review, do not choose create_new. Choose reuse_existing_reference with canonical id/version, or block_unresolved with searched candidate evidence.",
        "Every decision must include dataset_type, dataset_id, dataset_version, decision_status=completed, identity_decision, basis, used_context_kinds, structured evidence, closes_action_items, authoring_package, and authoring_package_sha256.",
        "Do not write row JSON directly; run dataset-identity-decisions-apply after decisions are complete, then rerun validate/QA/curation/finalize on the applied rows.",
      ],
      files: {
        task: repoRelativePath(taskPath),
        template: repoRelativePath(templatePath),
        expected_decisions: repoRelativePath(decisionFile),
        report: repoRelativePath(reportPath),
        shared_context_bundle: sharedContextBundle.path,
        authoring_package_snapshots_dir: repoRelativePath(snapshotDir),
      },
      commands: {
        apply_decisions: [
          process.execPath,
          path.join(repoRoot, "scripts", "foundry.ts"),
          "dataset-identity-decisions-apply",
          "--type",
          datasetTypes.length === 1 ? datasetTypes[0] : "<flow-or-process>",
          "--rows-file",
          options.rowsFile || "<rows-file-containing-identity-targets>",
          "--decisions",
          decisionFile,
          "--out-dir",
          path.join(outDir, "apply"),
          "--authoring-package-dir",
          snapshotDir,
        ]
          .map(shellQuote)
          .join(" "),
      },
    };
    writeJsonLines(templatePath, templateRows);
    writeJson(taskPath, task);
    writeJson(reportPath, task);
    return task;
  }

  return { runDatasetIdentityDecisionTaskBuild };
}

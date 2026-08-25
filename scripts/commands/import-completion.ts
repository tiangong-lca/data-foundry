import path from "node:path";

type JsonRecord = Record<string, unknown>;

type CountRecord = Record<string, unknown> & {
  blockers?: unknown;
  root_payload_mismatches?: unknown;
  root_readback_checks?: unknown;
  unresolved_trace_entries?: unknown;
  source_exchange_completeness_entries?: unknown;
  source_reference_rewrites?: unknown;
  ai_patch_evidence_entries?: unknown;
  ai_classification_decision_entries?: unknown;
  ai_location_decision_entries?: unknown;
  ai_identity_decision_entries?: unknown;
  source_contact_rewrite_semantic_evidence_entries?: unknown;
  write_candidates?: unknown;
};

type FileRecord = Record<string, unknown> & {
  final_rows?: unknown;
  rows_file?: unknown;
  trace_queues?: Record<string, unknown>;
};

type CompletionArtifactValue = JsonRecord & {
  status?: unknown;
  dataset_type?: unknown;
  final_rows_file?: unknown;
  finalize_report?: unknown;
  mutation_manifest?: unknown;
  profile?: unknown;
  target_user_id?: unknown;
  expected_state_code?: unknown;
  commit_report?: unknown;
  post_write_verify_report?: unknown;
  rows_file?: unknown;
  counts?: CountRecord;
  files?: FileRecord;
};

type JsonArtifact = {
  path: string;
  value: CompletionArtifactValue;
};

type FullContextCheck = {
  required: boolean;
  blockers: JsonRecord[];
};

export type ImportCompletionOptions = Record<string, unknown> & {
  help?: unknown;
  closeoutReport?: unknown;
  closeoutReports?: unknown;
  report?: unknown;
  taskDir?: unknown;
  workspaceDir?: unknown;
  requireType?: unknown;
  requiredType?: unknown;
  requiredTypes?: unknown;
  expectedCloseouts?: unknown;
  expectedCloseoutCount?: unknown;
  outDir?: unknown;
  taskId?: unknown;
  id?: unknown;
};

export type ImportCompletionFactoryDependencies = {
  asText: (value: unknown) => string;
  countJsonLinesFile: (filePath: string) => number;
  countRowsFile: (filePath: string) => number;
  fileExists: (filePath: string) => boolean;
  findFilesByName: (startDir: string, name: string) => string[];
  fullContextProofCheck: (input: JsonRecord) => FullContextCheck;
  normalizedList: (value: unknown) => string[];
  nowIso: () => string;
  readJson: (filePath: string) => CompletionArtifactValue;
  readJsonArtifactOption: (value: unknown) => JsonArtifact | null;
  repoRelativeMaybe: (filePath: string | null) => string | null;
  repoRelativePath: (filePath: string) => string;
  resolveRepoPath: (value: unknown) => string | null;
  sameResolvedPath: (left: string, right: string) => boolean;
  unique: <T>(values: T[]) => T[];
  writeJson: (filePath: string, value: unknown) => unknown;
};

export function createImportCompletionCommands({
  asText,
  countJsonLinesFile,
  countRowsFile,
  fileExists,
  findFilesByName,
  fullContextProofCheck,
  normalizedList,
  nowIso,
  readJson,
  readJsonArtifactOption,
  repoRelativeMaybe,
  repoRelativePath,
  resolveRepoPath,
  sameResolvedPath,
  unique,
  writeJson,
}: ImportCompletionFactoryDependencies) {
  function closeoutCompletionSummary({
    artifact,
    blockers,
  }: {
    artifact: JsonArtifact;
    blockers: JsonRecord[];
  }) {
    const closeout = artifact.value;
    const closeoutPath = artifact.path;
    const datasetType = asText(closeout.dataset_type).toLowerCase();
    const finalRowsFile = resolveRepoPath(closeout.final_rows_file);
    const finalizeArtifact = readJsonArtifactOption(closeout.finalize_report);
    const mutationArtifact = readJsonArtifactOption(closeout.mutation_manifest);
    const finalRowsCount =
      finalRowsFile && fileExists(finalRowsFile) ? countRowsFile(finalRowsFile) : 0;
    const prefix = {
      closeout_report: repoRelativePath(closeoutPath),
      dataset_type: datasetType || null,
    };

    if (closeout.status !== "completed") {
      blockers.push({
        ...prefix,
        code: "closeout_not_completed",
        message: `Closeout status is ${closeout.status ?? "missing"}.`,
      });
    }
    if (!["process", "flow", "lifecyclemodel", "support"].includes(datasetType)) {
      blockers.push({
        ...prefix,
        code: "closeout_dataset_type_invalid",
        message: `Closeout dataset_type is ${datasetType || "missing"}.`,
      });
    }
    if (!finalRowsFile || !fileExists(finalRowsFile) || finalRowsCount <= 0) {
      blockers.push({
        ...prefix,
        code: "closeout_final_rows_missing",
        message: "Closeout final_rows_file must be readable and non-empty.",
        final_rows_file: closeout.final_rows_file ?? null,
      });
    }
    if (!finalizeArtifact) {
      blockers.push({
        ...prefix,
        code: "closeout_finalize_report_missing",
        message: "Task completion requires the finalize report referenced by each closeout.",
        finalize_report: closeout.finalize_report ?? null,
      });
    } else if (finalizeArtifact.value?.status !== "ready_for_remote_write") {
      blockers.push({
        ...prefix,
        code: "closeout_finalize_report_not_ready",
        message: `Finalize report status is ${finalizeArtifact.value?.status ?? "missing"}.`,
        finalize_report: repoRelativePath(finalizeArtifact.path),
      });
    }
    if (!mutationArtifact) {
      blockers.push({
        ...prefix,
        code: "closeout_mutation_manifest_missing",
        message: "Task completion requires the mutation manifest referenced by each closeout.",
        mutation_manifest: closeout.mutation_manifest ?? null,
      });
    } else if (mutationArtifact.value?.status !== "ready_for_remote_write") {
      blockers.push({
        ...prefix,
        code: "closeout_mutation_manifest_not_ready",
        message: `Mutation manifest status is ${mutationArtifact.value?.status ?? "missing"}.`,
        mutation_manifest: repoRelativePath(mutationArtifact.path),
      });
    }

    const finalizeRowsFile = resolveRepoPath(
      finalizeArtifact?.value?.files?.final_rows ||
        finalizeArtifact?.value?.final_rows_file ||
        finalizeArtifact?.value?.rows_file,
    );
    if (
      finalizeArtifact &&
      finalRowsFile &&
      (!finalizeRowsFile || !sameResolvedPath(finalizeRowsFile, finalRowsFile))
    ) {
      blockers.push({
        ...prefix,
        code: "closeout_finalize_rows_mismatch",
        message: "Finalize report final rows must match closeout final rows.",
        expected_rows: repoRelativeMaybe(finalRowsFile),
        actual_rows: repoRelativeMaybe(finalizeRowsFile),
      });
    }
    const mutationRowsFile = resolveRepoPath(
      mutationArtifact?.value?.rows_file ||
        mutationArtifact?.value?.files?.final_rows ||
        mutationArtifact?.value?.files?.rows_file,
    );
    if (
      mutationArtifact &&
      finalRowsFile &&
      (!mutationRowsFile || !sameResolvedPath(mutationRowsFile, finalRowsFile))
    ) {
      blockers.push({
        ...prefix,
        code: "closeout_mutation_rows_mismatch",
        message: "Mutation manifest rows_file must match closeout final rows.",
        expected_rows: repoRelativeMaybe(finalRowsFile),
        actual_rows: repoRelativeMaybe(mutationRowsFile),
      });
    }

    const closeoutBlockers = Number(closeout.counts?.blockers ?? 0);
    const rootPayloadMismatches = Number(closeout.counts?.root_payload_mismatches ?? -1);
    const rootReadbackChecks = Number(closeout.counts?.root_readback_checks ?? 0);
    const mutationCounts = mutationArtifact?.value?.counts ?? {};
    if (!Number.isFinite(closeoutBlockers) || closeoutBlockers !== 0) {
      blockers.push({
        ...prefix,
        code: "closeout_blockers_present",
        message: `Closeout still records ${Number.isFinite(closeoutBlockers) ? closeoutBlockers : "unknown"} blockers.`,
      });
    }
    if (!Number.isFinite(rootPayloadMismatches) || rootPayloadMismatches !== 0) {
      blockers.push({
        ...prefix,
        code: "closeout_payload_mismatches_present",
        message: `Closeout root payload mismatches: ${Number.isFinite(rootPayloadMismatches) ? rootPayloadMismatches : "missing"}.`,
      });
    }
    if (
      !Number.isFinite(rootReadbackChecks) ||
      rootReadbackChecks < finalRowsCount ||
      finalRowsCount <= 0
    ) {
      blockers.push({
        ...prefix,
        code: "closeout_readback_incomplete",
        message: `Closeout readback checks ${Number.isFinite(rootReadbackChecks) ? rootReadbackChecks : "missing"} do not cover ${finalRowsCount} final rows.`,
      });
    }

    const unresolvedTraceCount =
      Number(
        closeout.counts?.unresolved_trace_entries ?? mutationCounts.unresolved_trace_entries ?? 0,
      ) || 0;
    const sourceExchangeCompletenessCount =
      Number(
        closeout.counts?.source_exchange_completeness_entries ??
          mutationCounts.source_exchange_completeness_entries ??
          0,
      ) || 0;
    const traceQueues = closeout.files?.trace_queues ?? {};
    for (const [traceKind, expectedTraceCount] of [
      ["unresolved_traces", unresolvedTraceCount],
      ["source_exchange_completeness_traces", sourceExchangeCompletenessCount],
    ] as const) {
      const traceFile = resolveRepoPath(traceQueues?.[traceKind]);
      if (expectedTraceCount > 0 && (!traceFile || !fileExists(traceFile))) {
        blockers.push({
          ...prefix,
          code: "closeout_trace_queue_missing",
          message: `${traceKind} has ${expectedTraceCount} entries but its queue file is not readable.`,
          trace_queue: traceKind,
          file: traceQueues?.[traceKind] ?? null,
        });
        continue;
      }
      if (expectedTraceCount > 0 && traceFile) {
        const actualTraceCount = countJsonLinesFile(traceFile);
        if (actualTraceCount < expectedTraceCount) {
          blockers.push({
            ...prefix,
            code: "closeout_trace_queue_count_incomplete",
            message: `${traceKind} has ${actualTraceCount} JSONL rows; expected at least ${expectedTraceCount}.`,
            trace_queue: traceKind,
            file: repoRelativePath(traceFile),
          });
        }
      }
    }

    const fullContextCheck = fullContextProofCheck({
      prefix,
      profileId: closeout.profile ?? mutationArtifact?.value?.profile,
      datasetType,
      closeoutCounts: closeout.counts ?? {},
      mutationArtifact,
      codePrefix: "closeout",
    });
    blockers.push(...fullContextCheck.blockers);

    return {
      closeout_report: repoRelativePath(closeoutPath),
      dataset_type: datasetType || null,
      profile: closeout.profile ?? mutationArtifact?.value?.profile ?? null,
      status: closeout.status ?? null,
      final_rows_file: repoRelativeMaybe(finalRowsFile),
      final_rows: finalRowsCount,
      target_user_id: closeout.target_user_id ?? mutationArtifact?.value?.target_user_id ?? null,
      expected_state_code: closeout.expected_state_code ?? null,
      finalize_report: finalizeArtifact ? repoRelativePath(finalizeArtifact.path) : null,
      mutation_manifest: mutationArtifact ? repoRelativePath(mutationArtifact.path) : null,
      commit_report: closeout.commit_report ?? null,
      post_write_verify_report: closeout.post_write_verify_report ?? null,
      counts: {
        blockers: closeoutBlockers,
        root_readback_checks: Number.isFinite(rootReadbackChecks) ? rootReadbackChecks : 0,
        root_payload_mismatches: Number.isFinite(rootPayloadMismatches)
          ? rootPayloadMismatches
          : -1,
        unresolved_trace_entries: unresolvedTraceCount,
        source_exchange_completeness_entries: sourceExchangeCompletenessCount,
        source_reference_rewrites: Number(mutationCounts.source_reference_rewrites ?? 0) || 0,
        ai_patch_evidence_entries: Number(mutationCounts.ai_patch_evidence_entries ?? 0) || 0,
        ai_classification_decision_entries:
          Number(mutationCounts.ai_classification_decision_entries ?? 0) || 0,
        ai_location_decision_entries: Number(mutationCounts.ai_location_decision_entries ?? 0) || 0,
        ai_identity_decision_entries: Number(mutationCounts.ai_identity_decision_entries ?? 0) || 0,
        source_contact_rewrite_semantic_evidence_entries:
          Number(mutationCounts.source_contact_rewrite_semantic_evidence_entries ?? 0) || 0,
        ai_semantic_evidence_entries:
          (Number(mutationCounts.ai_patch_evidence_entries ?? 0) || 0) +
          (Number(mutationCounts.ai_classification_decision_entries ?? 0) || 0) +
          (Number(mutationCounts.ai_location_decision_entries ?? 0) || 0) +
          (Number(mutationCounts.ai_identity_decision_entries ?? 0) || 0) +
          (Number(mutationCounts.source_contact_rewrite_semantic_evidence_entries ?? 0) || 0),
        full_context_ai_completion_required: fullContextCheck.required,
      },
      trace_queues: closeout.files?.trace_queues ?? null,
    };
  }

  function runDatasetImportCompletionReport(options: ImportCompletionOptions): JsonRecord {
    if (options.help) {
      return {
        schema_version: 1,
        status: "help",
        command: "dataset-import-completion-report",
        usage: [
          "node scripts/foundry.mjs dataset-import-completion-report --task-dir .foundry/workspaces/<task-id> --out-dir .foundry/workspaces/<task-id>/import-completion",
          "node scripts/foundry.mjs dataset-import-completion-report --closeout-report <dataset-post-write-closeout-report.json> [--closeout-report <...>] --require-type process --out-dir <completion-dir>",
        ],
        purpose:
          "Build a read-only task-level completion report from one or more completed dataset-post-write-closeout reports. It never writes the database.",
        remote_write_mode: "read-only",
      };
    }

    const explicitCloseouts = unique([
      ...normalizedList(options.closeoutReport),
      ...normalizedList(options.closeoutReports),
      ...normalizedList(options.report),
    ]).map(resolveRepoPath);
    const taskDir = resolveRepoPath(options.taskDir || options.workspaceDir);
    const discoveredCloseouts = taskDir
      ? findFilesByName(taskDir, "dataset-post-write-closeout-report.json")
      : [];
    const closeoutPaths = unique(
      [...explicitCloseouts, ...discoveredCloseouts].filter((value): value is string =>
        Boolean(value),
      ),
    );
    const requiredTypes = unique(
      [
        ...normalizedList(options.requireType),
        ...normalizedList(options.requiredType),
        ...normalizedList(options.requiredTypes),
      ].map((type) => type.toLowerCase()),
    );
    const expectedCloseoutCountText = asText(
      options.expectedCloseouts || options.expectedCloseoutCount,
    );
    const expectedCloseoutCount = expectedCloseoutCountText
      ? Number(expectedCloseoutCountText)
      : null;
    const outDir = resolveRepoPath(
      options.outDir ||
        (taskDir
          ? path.join(taskDir, "import-completion")
          : ".foundry/workspaces/import-completion"),
    );
    const blockers: JsonRecord[] = [];

    if (!taskDir && explicitCloseouts.length === 0) {
      blockers.push({
        code: "completion_input_missing",
        message: "Provide --task-dir or at least one --closeout-report.",
      });
    }
    if (closeoutPaths.length === 0) {
      blockers.push({
        code: "completion_closeout_reports_missing",
        message: "Task completion requires at least one dataset-post-write-closeout-report.json.",
      });
    }
    if (expectedCloseoutCount !== null && closeoutPaths.length !== expectedCloseoutCount) {
      blockers.push({
        code: "completion_closeout_count_mismatch",
        message: `Expected ${expectedCloseoutCount} closeout reports but found ${closeoutPaths.length}.`,
      });
    }

    const closeoutArtifacts: JsonArtifact[] = [];
    for (const closeoutPath of closeoutPaths) {
      if (!fileExists(closeoutPath)) {
        blockers.push({
          code: "completion_closeout_report_unreadable",
          message: "Closeout report is not readable.",
          closeout_report: closeoutPath ? repoRelativeMaybe(closeoutPath) : null,
        });
        continue;
      }
      closeoutArtifacts.push({
        path: closeoutPath,
        value: readJson(closeoutPath),
      });
    }

    const closeouts = closeoutArtifacts.map((artifact) =>
      closeoutCompletionSummary({ artifact, blockers }),
    );
    const datasetTypes = unique(closeouts.map((closeout) => closeout.dataset_type));
    const closeoutsByScope = new Map<string, typeof closeouts>();
    for (const closeout of closeouts) {
      const scopeKey = `${closeout.dataset_type || "unknown"}::${closeout.final_rows_file || "missing"}`;
      if (!closeoutsByScope.has(scopeKey)) {
        closeoutsByScope.set(scopeKey, []);
      }
      closeoutsByScope.get(scopeKey)!.push(closeout);
    }
    for (const [scopeKey, scopeCloseouts] of closeoutsByScope.entries()) {
      if (scopeCloseouts.length > 1) {
        blockers.push({
          code: "completion_duplicate_closeout_scope",
          message:
            "Multiple closeout reports point to the same dataset type and final rows file; task completion requires one closeout per committed write scope.",
          scope_key: scopeKey,
          closeout_reports: scopeCloseouts.map((closeout) => closeout.closeout_report),
        });
      }
    }
    for (const requiredType of requiredTypes) {
      if (!datasetTypes.includes(requiredType)) {
        blockers.push({
          code: "completion_required_type_missing",
          message: `Required dataset type ${requiredType} has no completed closeout report.`,
          dataset_type: requiredType,
        });
      }
    }

    const reportPath = path.join(outDir!, "dataset-import-completion-report.json");
    const report = {
      schema_version: 1,
      generated_at_utc: nowIso(),
      status: blockers.length === 0 ? "completed" : "blocked",
      task_id: asText(options.taskId || options.id) || (taskDir ? path.basename(taskDir) : null),
      task_dir: repoRelativeMaybe(taskDir),
      remote_write_mode: "read-only",
      policy: {
        completion_boundary:
          "Task completion is read-only and requires every committed write scope to have a completed post-write closeout with attached finalize, mutation, readback, trace, and profile-required full schema/YAML/context AI evidence.",
        no_closeout_means_not_complete: true,
        required_multilang_english_before_write: true,
        preserve_source_language_variants: true,
        unresolved_trace_policy:
          "Unresolved values that could not be safely inferred may enter only through structured common:other trace queues preserved by mutation manifests and closeouts.",
      },
      counts: {
        closeout_reports: closeouts.length,
        blockers: blockers.length,
        final_rows: closeouts.reduce((total, closeout) => total + closeout.final_rows, 0),
        dataset_types: datasetTypes.length,
        unique_write_scopes: closeoutsByScope.size,
        unresolved_trace_entries: closeouts.reduce(
          (total, closeout) => total + closeout.counts.unresolved_trace_entries,
          0,
        ),
        source_exchange_completeness_entries: closeouts.reduce(
          (total, closeout) => total + closeout.counts.source_exchange_completeness_entries,
          0,
        ),
        source_reference_rewrites: closeouts.reduce(
          (total, closeout) =>
            total + (Number(closeout.counts.source_reference_rewrites ?? 0) || 0),
          0,
        ),
        ai_patch_evidence_entries: closeouts.reduce(
          (total, closeout) =>
            total + (Number(closeout.counts.ai_patch_evidence_entries ?? 0) || 0),
          0,
        ),
        ai_classification_decision_entries: closeouts.reduce(
          (total, closeout) =>
            total + (Number(closeout.counts.ai_classification_decision_entries ?? 0) || 0),
          0,
        ),
        ai_location_decision_entries: closeouts.reduce(
          (total, closeout) =>
            total + (Number(closeout.counts.ai_location_decision_entries ?? 0) || 0),
          0,
        ),
        ai_identity_decision_entries: closeouts.reduce(
          (total, closeout) =>
            total + (Number(closeout.counts.ai_identity_decision_entries ?? 0) || 0),
          0,
        ),
        source_contact_rewrite_semantic_evidence_entries: closeouts.reduce(
          (total, closeout) =>
            total +
            (Number(closeout.counts.source_contact_rewrite_semantic_evidence_entries ?? 0) || 0),
          0,
        ),
        ai_semantic_evidence_entries: closeouts.reduce(
          (total, closeout) =>
            total + (Number(closeout.counts.ai_semantic_evidence_entries ?? 0) || 0),
          0,
        ),
        full_context_scopes: closeouts.filter(
          (closeout) => closeout.counts.full_context_ai_completion_required,
        ).length,
      },
      dataset_types: datasetTypes,
      required_types: requiredTypes,
      closeouts,
      blockers,
      files: {
        report: repoRelativePath(reportPath),
      },
    };
    writeJson(reportPath, report);
    return report;
  }

  return { runDatasetImportCompletionReport };
}

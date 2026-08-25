import path from "node:path";
import process from "node:process";
import { createFileArtifactFact, createFoundryCommandSpec } from "../lib/foundry-command-spec.ts";

function commitCommandForDatasetType(
  datasetType,
  rowsFile,
  outDir,
  {
    appendOption,
    resolveTiangongLcaCliBin,
    resolveTiangongLcaCliCommand,
    targetUserId = null,
    allowAccountLocalSupportAndElementary = false,
  } = {},
) {
  const cliPrefix = () => {
    if (resolveTiangongLcaCliCommand) {
      const cli = resolveTiangongLcaCliCommand();
      return [cli.command, ...cli.args];
    }
    return [resolveTiangongLcaCliBin()];
  };
  if (["unitgroup", "flowproperty"].includes(datasetType)) {
    if (!allowAccountLocalSupportAndElementary) {
      throw new Error(
        `${datasetType} rows are reference-only for Foundry imports and cannot be committed through dataset save-draft.`,
      );
    }
    // Override: mint account-local (My Data, state_code=0) support rows.
    return [
      ...cliPrefix(),
      "dataset",
      "save-draft",
      "--type",
      datasetType,
      "--input",
      rowsFile,
      "--out-dir",
      path.join(outDir, "commit", `${datasetType}-save-draft`),
      "--allow-account-local-support",
      "--commit",
      "--json",
    ];
  }
  if (datasetType === "support") {
    const supportArgs = [
      ...cliPrefix(),
      "dataset",
      "save-draft",
      "--type",
      "auto",
      "--input",
      rowsFile,
      "--out-dir",
      path.join(outDir, "commit", "support-save-draft"),
      "--commit",
      "--json",
    ];
    // A mixed support set may carry account-local FP/UG (P1a), which are
    // reference-only types gated behind the override. No-op for contact/source-
    // only support sets, so it is safe to pass whenever the override is active.
    if (allowAccountLocalSupportAndElementary) {
      supportArgs.push("--allow-account-local-support");
    }
    return supportArgs;
  }
  if (["contact", "source"].includes(datasetType)) {
    return [
      ...cliPrefix(),
      "dataset",
      "save-draft",
      "--type",
      datasetType,
      "--input",
      rowsFile,
      "--out-dir",
      path.join(outDir, "commit", `${datasetType}-save-draft`),
      "--commit",
      "--json",
    ];
  }
  if (datasetType === "flow") {
    const args = [
      ...cliPrefix(),
      "flow",
      "publish-version",
      "--input-file",
      rowsFile,
      "--out-dir",
      path.join(outDir, "commit", "flow-publish-version"),
      "--commit",
      "--json",
    ];
    appendOption(args, "--target-user-id", targetUserId);
    return args;
  }
  if (datasetType === "lifecyclemodel") {
    return [
      ...cliPrefix(),
      "lifecyclemodel",
      "save-draft",
      "--input",
      rowsFile,
      "--out-dir",
      path.join(outDir, "commit", "lifecyclemodel-save-draft"),
      "--commit",
      "--json",
    ];
  }
  const args = [
    ...cliPrefix(),
    "process",
    "save-draft",
    "--input",
    rowsFile,
    "--out-dir",
    path.join(outDir, "commit", "process-save-draft"),
    "--commit",
    "--json",
  ];
  appendOption(args, "--target-user-id", targetUserId);
  return args;
}

export function createCommitHandoffCommands({
  appendOption,
  asText,
  countJsonLinesFile,
  fileExists,
  fullContextProofCheck,
  nowIso,
  profileFor,
  readJsonArtifactOption,
  repoRelativePath,
  repoRoot,
  resolveRepoPath,
  resolveTiangongLcaCliCommand,
  resolveTiangongLcaCliBin,
  shellQuote,
  validateTraceQueueCoverageForRows,
  writeJson,
}) {
  function validateTraceQueuesForCommitHandoff({
    datasetType,
    finalRowsFile,
    traceFiles,
    counts,
    blockers,
  }) {
    for (const [key, expectedCount] of [
      ["unresolved_traces", Number(counts.unresolved_trace_entries ?? 0) || 0],
      [
        "source_exchange_completeness_traces",
        Number(counts.source_exchange_completeness_entries ?? 0) || 0,
      ],
      ["source_reference_rewrites", Number(counts.source_reference_rewrites ?? 0) || 0],
    ]) {
      const queuePath = traceFiles?.[key];
      const resolved = resolveRepoPath(queuePath);
      if (!resolved) {
        if (expectedCount > 0) {
          blockers.push({
            code: "commit_handoff_trace_queue_missing",
            message: `${key} has ${expectedCount} entries but no queue file is recorded before commit handoff.`,
            trace_queue: key,
          });
        }
        continue;
      }
      if (!fileExists(resolved)) {
        blockers.push({
          code: "commit_handoff_trace_queue_file_missing",
          message: `${key} is recorded but the queue file is not readable before commit handoff.`,
          trace_queue: key,
          file: queuePath,
        });
        continue;
      }
      const actualCount = countJsonLinesFile(resolved);
      if (actualCount < expectedCount) {
        blockers.push({
          code: "commit_handoff_trace_queue_count_incomplete",
          message: `${key} has ${actualCount} JSONL rows; expected at least ${expectedCount} before commit handoff.`,
          trace_queue: key,
          file: repoRelativePath(resolved),
        });
      }
    }

    if (finalRowsFile && fileExists(finalRowsFile)) {
      validateTraceQueueCoverageForRows({
        datasetType,
        finalRowsFile,
        traceQueues: traceFiles,
        counts,
        blockers,
      });
    }
  }

  function runDatasetCommitHandoffPlan(options) {
    if (options.help) {
      return {
        schema_version: 1,
        status: "help",
        command: "dataset-commit-handoff-plan",
        usage: [
          "node scripts/foundry.mjs dataset-commit-handoff-plan --finalize-report <dataset-post-authoring-finalize-report.json> --out-dir <handoff-dir>",
          "node scripts/foundry.mjs dataset-commit-handoff-plan --finalize-report <dataset-post-authoring-finalize-report.json> --state-code <expected-state-code> --out-dir <handoff-dir>",
        ],
        purpose:
          "Build a read-only explicit commit handoff plan from a ready post-authoring finalize report. It never writes the database.",
        remote_write_mode: "read-only",
      };
    }

    const finalizeArtifact = readJsonArtifactOption(
      options.finalizeReport || options.report || options.input,
    );
    if (!finalizeArtifact) {
      throw new Error(
        "--finalize-report is required and must point to dataset-post-authoring-finalize-report.json.",
      );
    }
    const finalizeReport = finalizeArtifact.value;
    const datasetType = String(options.type || finalizeReport.dataset_type || "")
      .trim()
      .toLowerCase();
    if (
      !["contact", "source", "support", "process", "flow", "lifecyclemodel"].includes(datasetType)
    ) {
      throw new Error(
        `Unsupported dataset type for commit handoff: ${datasetType || "(missing)"}.`,
      );
    }

    const finalizeDir = path.dirname(finalizeArtifact.path);
    const outDir = resolveRepoPath(options.outDir || path.join(finalizeDir, "commit-handoff"));
    const finalRowsFile = resolveRepoPath(
      options.rowsFile ||
        options.finalRowsFile ||
        finalizeReport.files?.final_rows ||
        finalizeReport.final_rows_file,
    );
    const mutationArtifact = readJsonArtifactOption(
      options.mutationManifest || finalizeReport.files?.mutation_manifest,
    );
    const targetUserId = asText(
      options.targetUserId ||
        mutationArtifact?.value?.target_user_id ||
        finalizeReport.target_user_id ||
        process.env.FOUNDRY_TARGET_USER_ID,
    );
    const explicitStateCode = asText(options.stateCode ?? options.expectedStateCode);
    const stateCode = explicitStateCode || "0";
    const stateCodeSource = explicitStateCode ? "explicit_option" : "default_draft_write_state";
    const commitSupportsTargetUserId = ["flow", "process"].includes(datasetType);
    const blockers = [];

    if (finalizeReport.status !== "ready_for_remote_write") {
      blockers.push({
        code: "finalize_report_not_ready",
        message: `Finalize report status is ${finalizeReport.status ?? "missing"}.`,
        report: repoRelativePath(finalizeArtifact.path),
      });
    }
    const locationAuditBlockers = Number(finalizeReport.counts?.location_audit_blockers ?? 0);
    if (!Number.isFinite(locationAuditBlockers) || locationAuditBlockers !== 0) {
      blockers.push({
        code: "location_audit_blockers_present",
        message: `Finalize report still records ${
          Number.isFinite(locationAuditBlockers) ? locationAuditBlockers : "unknown"
        } location audit blockers; all rows must satisfy tidas_locations_category.json before commit handoff.`,
        report: repoRelativePath(finalizeArtifact.path),
      });
    }
    if (!mutationArtifact) {
      blockers.push({
        code: "mutation_manifest_required",
        message:
          "Commit handoff requires the dataset-mutation-manifest referenced by finalize report.",
      });
    } else if (mutationArtifact.value?.status !== "ready_for_remote_write") {
      blockers.push({
        code: "mutation_manifest_not_ready",
        message: `Mutation manifest status is ${mutationArtifact.value?.status ?? "missing"}.`,
        report: repoRelativePath(mutationArtifact.path),
      });
    }
    if (!finalRowsFile || !fileExists(finalRowsFile)) {
      blockers.push({
        code: "final_rows_missing",
        message: "Commit handoff requires readable final rows from the finalize report.",
        rows_file: finalizeReport.files?.final_rows ?? finalizeReport.final_rows_file ?? null,
      });
    }
    if (!targetUserId) {
      blockers.push({
        code: "target_user_id_required",
        message:
          "Commit handoff requires explicit target_user_id evidence from mutation manifest or options.",
      });
    }
    const handoffFullContextCheck = fullContextProofCheck({
      profileId: finalizeReport.profile ?? mutationArtifact?.value?.profile,
      datasetType,
      mutationArtifact,
      codePrefix: "commit_handoff",
    });
    blockers.push(...handoffFullContextCheck.blockers);

    const handoffProfileId = asText(
      finalizeReport.profile ?? mutationArtifact?.value?.profile ?? "generic",
    )
      .trim()
      .toLowerCase();
    const allowAccountLocalSupportAndElementary =
      typeof profileFor === "function"
        ? Boolean(profileFor(repoRoot, handoffProfileId, {})?.allowAccountLocalSupportAndElementary)
        : false;
    const commitArgs = finalRowsFile
      ? commitCommandForDatasetType(datasetType, finalRowsFile, outDir, {
          appendOption,
          resolveTiangongLcaCliCommand,
          resolveTiangongLcaCliBin,
          targetUserId,
          allowAccountLocalSupportAndElementary,
        })
      : [];
    const cliPrefix = resolveTiangongLcaCliCommand
      ? (() => {
          const cli = resolveTiangongLcaCliCommand();
          return [cli.command, ...cli.args];
        })()
      : [resolveTiangongLcaCliBin()];
    const verifyArgs = finalRowsFile
      ? [
          ...cliPrefix,
          "dataset",
          "verify-remote",
          "--input",
          finalRowsFile,
          "--out-dir",
          path.join(outDir, "post-write-verify"),
          "--root-policy",
          String(options.rootPolicy || options.remoteRootPolicy || "candidate"),
          "--compare-root-payload",
          "--json",
        ]
      : [];
    if (targetUserId) {
      verifyArgs.push("--target-user-id", targetUserId);
    }
    if (stateCode) {
      verifyArgs.push("--state-code", stateCode);
    }
    const finalRowsArtifact =
      finalRowsFile && fileExists(finalRowsFile)
        ? createFileArtifactFact({
            role: "final_rows",
            path: repoRelativePath(finalRowsFile),
            filePath: finalRowsFile,
          })
        : null;

    const traceFiles = {
      unresolved_traces:
        finalizeReport.files?.unresolved_traces ??
        mutationArtifact?.value?.files?.unresolved_traces ??
        null,
      source_exchange_completeness_traces:
        finalizeReport.files?.source_exchange_completeness_traces ??
        mutationArtifact?.value?.files?.source_exchange_completeness_traces ??
        null,
      source_reference_rewrites:
        finalizeReport.files?.source_reference_rewrites ??
        mutationArtifact?.value?.files?.source_reference_rewrites ??
        null,
    };
    validateTraceQueuesForCommitHandoff({
      datasetType,
      finalRowsFile,
      traceFiles,
      counts: {
        unresolved_trace_entries:
          mutationArtifact?.value?.counts?.unresolved_trace_entries ??
          finalizeReport.counts?.unresolved_trace_entries ??
          0,
        source_exchange_completeness_entries:
          mutationArtifact?.value?.counts?.source_exchange_completeness_entries ??
          finalizeReport.counts?.source_exchange_completeness_entries ??
          0,
        source_reference_rewrites:
          mutationArtifact?.value?.counts?.source_reference_rewrites ??
          finalizeReport.counts?.source_reference_rewrites ??
          0,
      },
      blockers,
    });
    const readyForExplicitCommit = blockers.length === 0;
    const report = {
      schema_version: 1,
      generated_at_utc: nowIso(),
      status: blockers.length === 0 ? "ready_for_explicit_commit" : "blocked",
      dataset_type: datasetType,
      profile: finalizeReport.profile ?? mutationArtifact?.value?.profile ?? null,
      remote_write_mode: "read-only",
      finalize_report: repoRelativePath(finalizeArtifact.path),
      mutation_manifest: mutationArtifact ? repoRelativePath(mutationArtifact.path) : null,
      final_rows_file: finalRowsFile ? repoRelativePath(finalRowsFile) : null,
      final_rows_artifact: finalRowsArtifact
        ? {
            path: finalRowsArtifact.path,
            bytes: finalRowsArtifact.bytes,
            sha256: finalRowsArtifact.sha256,
          }
        : null,
      target_user_id: targetUserId || null,
      expected_state_code: stateCode || null,
      expected_state_code_source: stateCodeSource,
      account_write_guard: {
        target_user_id_required: true,
        target_user_id: targetUserId || null,
        commit_command_supports_target_user_id: commitSupportsTargetUserId,
        commit_account_binding: commitSupportsTargetUserId
          ? "target_user_id_cli_argument"
          : "current_cli_auth_session",
        verify_account_binding: "target_user_id_cli_argument",
        execution_precondition: commitSupportsTargetUserId
          ? "Run the commit command with the target-user-id argument emitted in this plan."
          : "Run the commit command only in a CLI session authenticated as the recorded target_user_id; this published CLI commit command does not accept --target-user-id.",
      },
      policy: {
        commit_boundary:
          "This plan does not write the database. An approved runner must execute the authoritative commit CommandSpec, then the post_write_verify CommandSpec, without a shell.",
        post_write_verify_required: true,
        compare_root_payload_required: true,
        trace_queue_policy:
          "Foundry common:other trace queue files must be retained with commit/readback evidence for later database-side curation.",
      },
      counts: {
        blockers: blockers.length,
        write_candidates:
          mutationArtifact?.value?.counts?.write_candidates ??
          finalizeReport.counts?.write_candidates ??
          0,
        unresolved_trace_entries:
          mutationArtifact?.value?.counts?.unresolved_trace_entries ??
          finalizeReport.counts?.unresolved_trace_entries ??
          0,
        source_exchange_completeness_entries:
          mutationArtifact?.value?.counts?.source_exchange_completeness_entries ??
          finalizeReport.counts?.source_exchange_completeness_entries ??
          0,
        source_reference_rewrites:
          mutationArtifact?.value?.counts?.source_reference_rewrites ??
          finalizeReport.counts?.source_reference_rewrites ??
          0,
      },
      blockers,
      commands: {
        commit:
          readyForExplicitCommit && finalRowsArtifact
            ? createFoundryCommandSpec({
                executable: commitArgs[0],
                argv: commitArgs.slice(1),
                binding: { artifacts: [finalRowsArtifact] },
              })
            : null,
        post_write_verify:
          readyForExplicitCommit && finalRowsArtifact
            ? createFoundryCommandSpec({
                executable: verifyArgs[0],
                argv: verifyArgs.slice(1),
                binding: { artifacts: [finalRowsArtifact] },
              })
            : null,
      },
      files: {
        trace_queues: traceFiles,
        expected_commit_report_dir: repoRelativePath(path.join(outDir, "commit")),
        expected_post_write_verify_dir: repoRelativePath(path.join(outDir, "post-write-verify")),
      },
    };
    const reportPath = path.join(outDir, "dataset-commit-handoff-plan.json");
    writeJson(reportPath, report);
    return {
      ...report,
      files: {
        ...report.files,
        report: repoRelativePath(reportPath),
      },
    };
  }

  return {
    runDatasetCommitHandoffPlan,
  };
}

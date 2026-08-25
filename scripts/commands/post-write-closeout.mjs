import path from "node:path";
import { createFileArtifactFact } from "../lib/foundry-command-spec.ts";
import { normalizeAllowedTraceHashDifference } from "../lib/remote-verification-accepted-diff.ts";
import {
  canonicalPayloadSha256,
  validateUniqueRootReadbacks,
} from "../lib/post-write-root-proof.ts";

export function createPostWriteCloseoutCommands({
  asText,
  countJsonLinesFile,
  countRowsFile,
  datasetIdentity,
  ensureArray,
  fileExists,
  fullContextProofCheck,
  nowIso,
  readJsonArtifactOption,
  readJsonLines,
  readRowsFile,
  repoRelativeMaybe,
  repoRelativePath,
  reportInputPath,
  resolveRepoPath,
  sameResolvedPath,
  validateTraceQueueCoverageForRows,
  writeCloseoutImportLedger,
  writeJson,
}) {
  function validateCommitReportForCloseout({
    commitReport,
    commitReportPath,
    datasetType,
    finalRowsFile,
    expectedRows,
    blockers,
  }) {
    const inputPath = resolveRepoPath(reportInputPath(commitReport));
    const status = asText(commitReport.status);
    const mode = asText(commitReport.mode);
    const counts = commitReport.counts ?? {};
    const failedCount = Number(counts.failed ?? counts.failure_count ?? 0);
    const executedCount = Number(counts.executed ?? 0);
    const successCount = Number(counts.success_count ?? 0);
    const selectedCount = Number(counts.selected ?? counts.total_rows ?? 0);

    if (!inputPath || !sameResolvedPath(inputPath, finalRowsFile)) {
      blockers.push({
        code: "commit_report_input_mismatch",
        message: "Commit report input must match the handoff final rows file.",
        commit_report: repoRelativePath(commitReportPath),
        expected_input: repoRelativeMaybe(finalRowsFile),
        actual_input: inputPath ? repoRelativeMaybe(inputPath) : null,
      });
    }
    if (mode !== "commit") {
      blockers.push({
        code: "commit_report_not_commit_mode",
        message: `Commit report mode is ${mode || "missing"}; expected commit.`,
        commit_report: repoRelativePath(commitReportPath),
      });
    }
    if (Object.hasOwn(commitReport, "commit") && commitReport.commit !== true) {
      blockers.push({
        code: "commit_report_commit_flag_false",
        message: "Commit report has commit=false; dry-run reports cannot close an import.",
        commit_report: repoRelativePath(commitReportPath),
      });
    }
    if (!status || /with_failures|failure|failed|prepared/u.test(status)) {
      blockers.push({
        code: "commit_report_status_not_completed",
        message: `Commit report status is ${status || "missing"}; expected a completed commit without failures.`,
        commit_report: repoRelativePath(commitReportPath),
      });
    }
    if (!Number.isFinite(failedCount) || failedCount !== 0) {
      blockers.push({
        code: "commit_report_failures_present",
        message: `Commit report contains ${Number.isFinite(failedCount) ? failedCount : "unknown"} failed rows.`,
        commit_report: repoRelativePath(commitReportPath),
      });
    }

    const committedRows = datasetType === "flow" ? successCount : executedCount || successCount;
    if (!Number.isFinite(committedRows) || committedRows < expectedRows || expectedRows <= 0) {
      blockers.push({
        code: "commit_report_row_count_incomplete",
        message: `Commit report proves ${Number.isFinite(committedRows) ? committedRows : "unknown"} committed rows; expected ${expectedRows}.`,
        commit_report: repoRelativePath(commitReportPath),
      });
    }
    if (selectedCount && selectedCount < expectedRows) {
      blockers.push({
        code: "commit_report_selected_count_incomplete",
        message: `Commit report selected ${selectedCount} rows; expected at least ${expectedRows}.`,
        commit_report: repoRelativePath(commitReportPath),
      });
    }
  }

  function validatePostWriteVerifyForCloseout({
    verifyReport,
    verifyReportPath,
    finalRowsFile,
    expectedRows,
    targetUserId,
    expectedStateCode,
    intendedRoots,
    allowTraceHashOnlyNormalization,
    blockers,
  }) {
    const inputPath = resolveRepoPath(reportInputPath(verifyReport));
    const counts = verifyReport.counts ?? {};
    const blockerCount = Number(counts.blockers ?? verifyReport.blockers?.length ?? 0);
    const rootReadbackCount = Number(counts.root_readback_checks ?? 0);
    const rootPayloadMismatches = Number(counts.root_payload_mismatches ?? -1);

    if (!inputPath || !sameResolvedPath(inputPath, finalRowsFile)) {
      blockers.push({
        code: "post_write_verify_input_mismatch",
        message: "Post-write verification input must match the handoff final rows file.",
        post_write_verify_report: repoRelativePath(verifyReportPath),
        expected_input: repoRelativeMaybe(finalRowsFile),
        actual_input: inputPath ? repoRelativeMaybe(inputPath) : null,
      });
    }
    if (verifyReport.status !== "passed_remote_verification") {
      blockers.push({
        code: "post_write_verify_not_passed",
        message: `Post-write verification status is ${verifyReport.status ?? "missing"}.`,
        post_write_verify_report: repoRelativePath(verifyReportPath),
      });
    }
    if (
      !Number.isFinite(blockerCount) ||
      blockerCount !== 0 ||
      ensureArray(verifyReport.blockers).length > 0
    ) {
      blockers.push({
        code: "post_write_verify_blockers_present",
        message: `Post-write verification contains ${Number.isFinite(blockerCount) ? blockerCount : "unknown"} blockers.`,
        post_write_verify_report: repoRelativePath(verifyReportPath),
      });
    }
    if (
      !Number.isFinite(rootReadbackCount) ||
      rootReadbackCount !== expectedRows ||
      expectedRows <= 0
    ) {
      blockers.push({
        code: "post_write_verify_root_readback_incomplete",
        message: `Post-write verification has ${Number.isFinite(rootReadbackCount) ? rootReadbackCount : "unknown"} root readback checks; expected exactly ${expectedRows}.`,
        post_write_verify_report: repoRelativePath(verifyReportPath),
      });
    }
    if (!Number.isFinite(rootPayloadMismatches) || rootPayloadMismatches !== 0) {
      blockers.push({
        code: "post_write_verify_payload_mismatch",
        message: `Post-write verification root payload mismatches: ${Number.isFinite(rootPayloadMismatches) ? rootPayloadMismatches : "missing"}.`,
        post_write_verify_report: repoRelativePath(verifyReportPath),
      });
    }

    const checksFile = resolveRepoPath(verifyReport.files?.checks);
    if (!checksFile || !fileExists(checksFile)) {
      blockers.push({
        code: "post_write_verify_checks_missing",
        message:
          "Post-write closeout requires the remote-verification.jsonl checks file to prove --compare-root-payload hashes.",
        post_write_verify_report: repoRelativePath(verifyReportPath),
        checks_file: verifyReport.files?.checks ?? null,
      });
      return { checksFile: null, readbackChecks: [], uniqueReadbackCount: 0 };
    }

    const checks = readJsonLines(checksFile);
    const readbackChecks = checks.filter(
      (check) => check?.role === "root" && String(check?.path ?? "").endsWith("#readback"),
    );
    if (readbackChecks.length !== expectedRows) {
      blockers.push({
        code: "post_write_verify_readback_check_rows_missing",
        message: `Post-write check file contains ${readbackChecks.length} root readback checks; expected exactly ${expectedRows}.`,
        checks_file: repoRelativePath(checksFile),
      });
    }

    for (const check of readbackChecks) {
      const localHash = asText(check.local_payload_sha256);
      const remoteHash = asText(check.remote_payload_sha256);
      if (check.status !== "ok") {
        blockers.push({
          code: "post_write_verify_readback_check_not_ok",
          message: `Readback check for ${check.table}:${check.id}@${check.version} is ${check.status ?? "missing"}.`,
          checks_file: repoRelativePath(checksFile),
          row_index: check.row_index ?? null,
        });
      }
      if (!localHash || !remoteHash || localHash !== remoteHash) {
        blockers.push({
          code: "post_write_verify_compare_root_payload_not_proven",
          message:
            "Readback check is missing equal local/remote payload hashes, so --compare-root-payload was not proven.",
          checks_file: repoRelativePath(checksFile),
          row_index: check.row_index ?? null,
          table: check.table ?? null,
          id: check.id ?? null,
        });
      }
      if (targetUserId && check.remote_user_id !== targetUserId) {
        blockers.push({
          code: "post_write_verify_owner_not_proven",
          message: `Readback owner ${check.remote_user_id ?? "missing"} does not match ${targetUserId}.`,
          checks_file: repoRelativePath(checksFile),
          row_index: check.row_index ?? null,
        });
      }
      if (expectedStateCode !== null && Number(check.remote_state_code) !== expectedStateCode) {
        blockers.push({
          code: "post_write_verify_state_code_not_proven",
          message: `Readback state_code ${check.remote_state_code ?? "missing"} does not match ${expectedStateCode}.`,
          checks_file: repoRelativePath(checksFile),
          row_index: check.row_index ?? null,
        });
      }
    }
    const uniqueProof = validateUniqueRootReadbacks({
      intended: intendedRoots,
      checks: readbackChecks,
      targetUserId,
      expectedStateCode,
      allowTraceHashOnlyNormalization,
    });
    blockers.push(...uniqueProof.blockers);

    return {
      checksFile,
      readbackChecks,
      uniqueReadbackCount: uniqueProof.uniqueReadbackCount,
    };
  }

  function validateTraceQueuesForCloseout({
    handoffPlan,
    finalizeReport,
    mutationManifest,
    datasetType,
    finalRowsFile,
    blockers,
  }) {
    const counts = {
      unresolved_trace_entries:
        Number(
          handoffPlan.counts?.unresolved_trace_entries ??
            mutationManifest?.counts?.unresolved_trace_entries ??
            finalizeReport?.counts?.unresolved_trace_entries ??
            0,
        ) || 0,
      source_exchange_completeness_entries:
        Number(
          handoffPlan.counts?.source_exchange_completeness_entries ??
            mutationManifest?.counts?.source_exchange_completeness_entries ??
            finalizeReport?.counts?.source_exchange_completeness_entries ??
            0,
        ) || 0,
      source_reference_rewrites:
        Number(
          handoffPlan.counts?.source_reference_rewrites ??
            mutationManifest?.counts?.source_reference_rewrites ??
            finalizeReport?.counts?.source_reference_rewrites ??
            0,
        ) || 0,
    };
    const traceQueues = {
      unresolved_traces:
        handoffPlan.files?.trace_queues?.unresolved_traces ??
        mutationManifest?.files?.unresolved_traces ??
        finalizeReport?.files?.unresolved_traces ??
        null,
      source_exchange_completeness_traces:
        handoffPlan.files?.trace_queues?.source_exchange_completeness_traces ??
        mutationManifest?.files?.source_exchange_completeness_traces ??
        finalizeReport?.files?.source_exchange_completeness_traces ??
        null,
      source_reference_rewrites:
        handoffPlan.files?.trace_queues?.source_reference_rewrites ??
        mutationManifest?.files?.source_reference_rewrites ??
        finalizeReport?.files?.source_reference_rewrites ??
        null,
    };

    for (const [key, queuePath] of Object.entries(traceQueues)) {
      const expectedCount =
        key === "unresolved_traces"
          ? counts.unresolved_trace_entries
          : key === "source_exchange_completeness_traces"
            ? counts.source_exchange_completeness_entries
            : counts.source_reference_rewrites;
      const resolved = resolveRepoPath(queuePath);
      if (!resolved) {
        if (expectedCount > 0) {
          blockers.push({
            code: "trace_queue_missing",
            message: `${key} has ${expectedCount} entries but no queue file is recorded.`,
            trace_queue: key,
          });
        }
        continue;
      }
      if (!fileExists(resolved)) {
        blockers.push({
          code: "trace_queue_file_missing",
          message: `${key} is recorded but the queue file is not readable.`,
          trace_queue: key,
          file: queuePath,
        });
        continue;
      }
      const actualCount = countJsonLinesFile(resolved);
      if (actualCount < expectedCount) {
        blockers.push({
          code: "trace_queue_count_incomplete",
          message: `${key} has ${actualCount} JSONL rows; expected at least ${expectedCount}.`,
          trace_queue: key,
          file: repoRelativePath(resolved),
        });
      }
    }

    if (finalRowsFile && fileExists(finalRowsFile)) {
      validateTraceQueueCoverageForRows({
        datasetType,
        finalRowsFile,
        traceQueues,
        counts,
        blockers,
      });
    }

    return {
      counts,
      files: {
        unresolved_traces: traceQueues.unresolved_traces,
        source_exchange_completeness_traces: traceQueues.source_exchange_completeness_traces,
        source_reference_rewrites: traceQueues.source_reference_rewrites,
      },
    };
  }

  function rootTypeAndTable(row, fallbackType) {
    if (row?.contactDataSet) return { type: "contact", table: "contacts" };
    if (row?.sourceDataSet) return { type: "source", table: "sources" };
    if (row?.flowPropertyDataSet) return { type: "flowproperty", table: "flowproperties" };
    if (row?.unitGroupDataSet) return { type: "unitgroup", table: "unitgroups" };
    if (row?.flowDataSet) return { type: "flow", table: "flows" };
    if (row?.processDataSet) return { type: "process", table: "processes" };
    if (row?.lifeCycleModelDataSet || row?.lifecycleModelDataSet) {
      return { type: "lifecyclemodel", table: "lifecyclemodels" };
    }
    const table =
      fallbackType === "process"
        ? "processes"
        : fallbackType === "flow"
          ? "flows"
          : fallbackType === "contact"
            ? "contacts"
            : fallbackType === "source"
              ? "sources"
              : fallbackType === "lifecyclemodel"
                ? "lifecyclemodels"
                : "";
    return { type: fallbackType, table };
  }

  function validateHandoffFinalRowsArtifact({ handoffPlan, finalRowsFile, blockers }) {
    const artifact = handoffPlan.final_rows_artifact;
    if (
      !artifact ||
      typeof artifact !== "object" ||
      Array.isArray(artifact) ||
      typeof artifact.path !== "string" ||
      !Number.isSafeInteger(artifact.bytes) ||
      artifact.bytes < 0 ||
      typeof artifact.sha256 !== "string" ||
      !/^[a-f0-9]{64}$/u.test(artifact.sha256)
    ) {
      blockers.push({
        code: "handoff_final_rows_artifact_missing_or_invalid",
        message: "Post-write closeout requires handoff final_rows_artifact path/bytes/SHA-256.",
      });
      return null;
    }
    const artifactPath = resolveRepoPath(artifact.path);
    if (!artifactPath || !sameResolvedPath(artifactPath, finalRowsFile)) {
      blockers.push({
        code: "handoff_final_rows_artifact_path_mismatch",
        message: "Handoff final_rows_artifact path must resolve to the exact final rows file.",
        expected_rows: repoRelativeMaybe(finalRowsFile),
        artifact_path: artifact.path,
      });
      return null;
    }
    const current = createFileArtifactFact({
      role: "final_rows",
      path: artifact.path,
      filePath: finalRowsFile,
    });
    if (current.bytes !== artifact.bytes) {
      blockers.push({
        code: "handoff_final_rows_artifact_bytes_drift",
        message: "Final rows byte length changed after commit handoff.",
        expected_bytes: artifact.bytes,
        actual_bytes: current.bytes,
      });
    }
    if (current.sha256 !== artifact.sha256) {
      blockers.push({
        code: "handoff_final_rows_artifact_sha256_drift",
        message: "Final rows bytes changed after commit handoff.",
        expected_sha256: artifact.sha256,
        actual_sha256: current.sha256,
      });
    }
    return current;
  }

  function runDatasetPostWriteCloseout(options) {
    if (options.help) {
      return {
        schema_version: 1,
        status: "help",
        command: "dataset-post-write-closeout",
        usage: [
          "node scripts/foundry.mjs dataset-post-write-closeout --handoff-plan <dataset-commit-handoff-plan.json> --commit-report <summary-or-sync-report.json> --post-write-verify-report <remote-verification-report.json> --out-dir <closeout-dir> --ledger-dir <task-import-ledger-dir>",
        ],
        purpose:
          "Close an explicit remote write only after Foundry handoff, CLI commit report, and post-write verify-root-payload evidence prove the exact same final rows were written and read back.",
        remote_write_mode: "read-only",
      };
    }

    const handoffArtifact = readJsonArtifactOption(
      options.handoffPlan || options.plan || options.input,
    );
    const commitArtifact = readJsonArtifactOption(
      options.commitReport || options.commit || options.writeReport,
    );
    const verifyArtifact = readJsonArtifactOption(
      options.postWriteVerifyReport || options.verifyReport || options.remoteVerifyReport,
    );
    if (!handoffArtifact) {
      throw new Error(
        "--handoff-plan is required and must point to dataset-commit-handoff-plan.json.",
      );
    }
    if (!commitArtifact) {
      throw new Error("--commit-report is required and must point to the CLI commit report JSON.");
    }
    if (!verifyArtifact) {
      throw new Error(
        "--post-write-verify-report is required and must point to remote-verification-report.json.",
      );
    }

    const handoffPlan = handoffArtifact.value;
    const datasetType = String(options.type || handoffPlan.dataset_type || "")
      .trim()
      .toLowerCase();
    if (
      !["support", "contact", "source", "process", "flow", "lifecyclemodel"].includes(datasetType)
    ) {
      throw new Error(
        `Unsupported dataset type for post-write closeout: ${datasetType || "(missing)"}.`,
      );
    }
    const outDir = resolveRepoPath(
      options.outDir || path.join(path.dirname(handoffArtifact.path), "post-write-closeout"),
    );
    const finalRowsFile = resolveRepoPath(options.rowsFile || handoffPlan.final_rows_file);
    const finalizeArtifact = readJsonArtifactOption(
      options.finalizeReport || handoffPlan.finalize_report,
    );
    const mutationArtifact = readJsonArtifactOption(
      options.mutationManifest || handoffPlan.mutation_manifest,
    );
    const finalizeReport = finalizeArtifact?.value ?? null;
    const mutationManifest = mutationArtifact?.value ?? null;
    const targetUserId = asText(options.targetUserId || handoffPlan.target_user_id);
    const expectedStateCodeText = asText(options.stateCode ?? handoffPlan.expected_state_code);
    const expectedStateCode =
      expectedStateCodeText === "" || Number.isNaN(Number(expectedStateCodeText))
        ? null
        : Number(expectedStateCodeText);
    const blockers = [];
    const handoffAccountMode = asText(handoffPlan.account_mode).toLowerCase() || "ordinary";
    const environmentAccountMode = asText(process.env.FOUNDRY_ACCOUNT_MODE).toLowerCase();
    if (environmentAccountMode && environmentAccountMode !== handoffAccountMode) {
      blockers.push({
        code: "handoff_account_mode_mismatch",
        message: "Post-write closeout account mode must match the receipt-bound handoff mode.",
      });
    }
    const productionTestAccount =
      handoffAccountMode === "production-test" ||
      environmentAccountMode === "production-test" ||
      ["1", "true"].includes(String(options.productionCase || ""));

    if (handoffPlan.status !== "ready_for_explicit_commit") {
      blockers.push({
        code: "handoff_plan_not_ready",
        message: `Handoff plan status is ${handoffPlan.status ?? "missing"}.`,
        handoff_plan: repoRelativePath(handoffArtifact.path),
      });
    }
    if (!finalRowsFile || !fileExists(finalRowsFile)) {
      blockers.push({
        code: "final_rows_missing",
        message: "Post-write closeout requires the exact final rows file from handoff.",
        final_rows_file: handoffPlan.final_rows_file ?? null,
      });
    }
    const finalRowsArtifact =
      finalRowsFile && fileExists(finalRowsFile)
        ? validateHandoffFinalRowsArtifact({ handoffPlan, finalRowsFile, blockers })
        : null;
    if (!targetUserId) {
      blockers.push({
        code: "target_user_id_missing",
        message: "Post-write closeout requires target_user_id from handoff or options.",
      });
    }
    if (expectedStateCodeText === "" || expectedStateCode === null) {
      blockers.push({
        code: "state_code_missing",
        message: "Post-write closeout requires expected_state_code from handoff or options.",
      });
    }
    if (!finalizeArtifact) {
      blockers.push({
        code: "finalize_report_missing",
        message:
          "Post-write closeout requires the finalize report referenced by the handoff so AI/context prewrite gates remain attached to the committed import.",
        finalize_report: handoffPlan.finalize_report ?? null,
      });
    }
    if (!mutationArtifact) {
      blockers.push({
        code: "mutation_manifest_missing",
        message:
          "Post-write closeout requires the mutation manifest referenced by the handoff so exact-scope AI/context evidence remains attached to the committed import.",
        mutation_manifest: handoffPlan.mutation_manifest ?? null,
      });
    }
    if (finalizeReport && finalizeReport.status !== "ready_for_remote_write") {
      blockers.push({
        code: "finalize_report_not_ready",
        message: `Finalize report status is ${finalizeReport.status ?? "missing"}.`,
        finalize_report: repoRelativeMaybe(finalizeArtifact?.path),
      });
    }
    if (mutationManifest && mutationManifest.status !== "ready_for_remote_write") {
      blockers.push({
        code: "mutation_manifest_not_ready",
        message: `Mutation manifest status is ${mutationManifest.status ?? "missing"}.`,
        mutation_manifest: repoRelativeMaybe(mutationArtifact?.path),
      });
    }
    if (finalizeReport && finalRowsFile) {
      const finalizeRowsFile = resolveRepoPath(
        finalizeReport.files?.final_rows ||
          finalizeReport.final_rows_file ||
          finalizeReport.rows_file,
      );
      if (!finalizeRowsFile || !sameResolvedPath(finalizeRowsFile, finalRowsFile)) {
        blockers.push({
          code: "finalize_report_rows_mismatch",
          message: "Finalize report final rows must match the handoff final rows file.",
          finalize_report: repoRelativeMaybe(finalizeArtifact?.path),
          expected_rows: repoRelativeMaybe(finalRowsFile),
          actual_rows: finalizeRowsFile ? repoRelativeMaybe(finalizeRowsFile) : null,
        });
      }
    }
    if (mutationManifest && finalRowsFile) {
      const mutationRowsFile = resolveRepoPath(
        mutationManifest.rows_file ||
          mutationManifest.files?.final_rows ||
          mutationManifest.files?.rows_file,
      );
      if (!mutationRowsFile || !sameResolvedPath(mutationRowsFile, finalRowsFile)) {
        blockers.push({
          code: "mutation_manifest_rows_mismatch",
          message: "Mutation manifest rows_file must match the handoff final rows file.",
          mutation_manifest: repoRelativeMaybe(mutationArtifact?.path),
          expected_rows: repoRelativeMaybe(finalRowsFile),
          actual_rows: mutationRowsFile ? repoRelativeMaybe(mutationRowsFile) : null,
        });
      }
    }
    const closeoutProfile = asText(
      handoffPlan.profile ?? finalizeReport?.profile ?? mutationManifest?.profile,
    );
    const postWriteFullContextCheck = fullContextProofCheck({
      profileId: closeoutProfile,
      datasetType,
      mutationArtifact,
      codePrefix: "post_write_closeout",
    });
    blockers.push(...postWriteFullContextCheck.blockers);

    const expectedRows =
      finalRowsFile && fileExists(finalRowsFile) ? countRowsFile(finalRowsFile) : 0;
    const intendedRoots = [];
    if (finalRowsFile && fileExists(finalRowsFile)) {
      readRowsFile(finalRowsFile).forEach((row, rowIndex) => {
        const rootType = rootTypeAndTable(row, datasetType);
        const identity = datasetIdentity(row, rootType.type);
        if (!rootType.table || !identity.id || !identity.version) {
          blockers.push({
            code: "intended_root_identity_missing",
            message: `Final row ${rowIndex} does not expose one supported root identity.`,
            row_index: rowIndex,
          });
          return;
        }
        const acceptedNormalization = normalizeAllowedTraceHashDifference(row);
        intendedRoots.push({
          rowIndex,
          table: rootType.table,
          id: identity.id,
          version: identity.version,
          payloadSha256: canonicalPayloadSha256(row),
          acceptedNormalizedPayloadSha256:
            acceptedNormalization.removed_paths.length > 0
              ? acceptedNormalization.normalized_sha256
              : null,
          acceptedNormalizedRemovedPaths: acceptedNormalization.removed_paths,
        });
      });
    }
    if (expectedRows <= 0) {
      blockers.push({
        code: "final_rows_empty",
        message: "Post-write closeout requires at least one final row.",
        final_rows_file: repoRelativeMaybe(finalRowsFile),
      });
    }

    let rootProof = { checksFile: null, readbackChecks: [], uniqueReadbackCount: 0 };
    if (finalRowsFile && fileExists(finalRowsFile)) {
      validateCommitReportForCloseout({
        commitReport: commitArtifact.value,
        commitReportPath: commitArtifact.path,
        datasetType,
        finalRowsFile,
        expectedRows,
        blockers,
      });
      rootProof = validatePostWriteVerifyForCloseout({
        verifyReport: verifyArtifact.value,
        verifyReportPath: verifyArtifact.path,
        finalRowsFile,
        expectedRows,
        targetUserId,
        expectedStateCode,
        intendedRoots,
        allowTraceHashOnlyNormalization: !productionTestAccount,
        blockers,
      });
    }

    const traceQueues = validateTraceQueuesForCloseout({
      handoffPlan,
      finalizeReport,
      mutationManifest,
      datasetType,
      finalRowsFile,
      blockers,
    });

    const reportPath = path.join(outDir, "dataset-post-write-closeout-report.json");
    const report = {
      schema_version: 1,
      generated_at_utc: nowIso(),
      status: blockers.length === 0 ? "completed" : "blocked",
      dataset_type: datasetType,
      profile: handoffPlan.profile ?? finalizeReport?.profile ?? mutationManifest?.profile ?? null,
      remote_write_mode: "read-only",
      handoff_plan: repoRelativePath(handoffArtifact.path),
      finalize_report: finalizeArtifact ? repoRelativePath(finalizeArtifact.path) : null,
      mutation_manifest: mutationArtifact ? repoRelativePath(mutationArtifact.path) : null,
      commit_report: repoRelativePath(commitArtifact.path),
      post_write_verify_report: repoRelativePath(verifyArtifact.path),
      final_rows_file: repoRelativeMaybe(finalRowsFile),
      final_rows_artifact: finalRowsArtifact
        ? {
            path: finalRowsArtifact.path,
            bytes: finalRowsArtifact.bytes,
            sha256: finalRowsArtifact.sha256,
          }
        : null,
      target_user_id: targetUserId || null,
      expected_state_code: expectedStateCode,
      policy: {
        ai_full_context_semantic_completion_required_before_entry: true,
        commit_boundary:
          "This closeout is read-only. It accepts only an already executed explicit CLI commit plus post-write root payload readback evidence.",
        compare_root_payload_required: true,
        accepted_trace_hash_only_normalization: !productionTestAccount,
        closeout_completion:
          "completed means Foundry handoff was ready, CLI commit completed without row failures, post-write verify proved owner, state_code, and local/remote payload hash equality for the same final rows, and profile-required full schema/YAML/context AI proof remained attached.",
      },
      counts: {
        blockers: blockers.length,
        final_rows: expectedRows,
        commit_rows:
          Number(
            commitArtifact.value.counts?.executed ??
              commitArtifact.value.counts?.success_count ??
              0,
          ) || 0,
        post_write_verify_blockers:
          Number(
            verifyArtifact.value.counts?.blockers ?? verifyArtifact.value.blockers?.length ?? 0,
          ) || 0,
        root_readback_checks: Number(verifyArtifact.value.counts?.root_readback_checks ?? 0) || 0,
        unique_root_readback_checks: rootProof.uniqueReadbackCount,
        root_payload_mismatches: Number(verifyArtifact.value.counts?.root_payload_mismatches ?? -1),
        unresolved_trace_entries: traceQueues.counts.unresolved_trace_entries,
        source_exchange_completeness_entries:
          traceQueues.counts.source_exchange_completeness_entries,
        source_reference_rewrites: traceQueues.counts.source_reference_rewrites,
        ai_patch_evidence_entries:
          Number(mutationManifest?.counts?.ai_patch_evidence_entries ?? 0) || 0,
        ai_classification_decision_entries:
          Number(mutationManifest?.counts?.ai_classification_decision_entries ?? 0) || 0,
        ai_location_decision_entries:
          Number(mutationManifest?.counts?.ai_location_decision_entries ?? 0) || 0,
        ai_identity_decision_entries:
          Number(mutationManifest?.counts?.ai_identity_decision_entries ?? 0) || 0,
        source_contact_rewrite_semantic_evidence_entries:
          Number(mutationManifest?.counts?.source_contact_rewrite_semantic_evidence_entries ?? 0) ||
          0,
        ai_semantic_evidence_entries:
          (Number(mutationManifest?.counts?.ai_patch_evidence_entries ?? 0) || 0) +
          (Number(mutationManifest?.counts?.ai_classification_decision_entries ?? 0) || 0) +
          (Number(mutationManifest?.counts?.ai_location_decision_entries ?? 0) || 0) +
          (Number(mutationManifest?.counts?.ai_identity_decision_entries ?? 0) || 0) +
          (Number(
            mutationManifest?.counts?.source_contact_rewrite_semantic_evidence_entries ?? 0,
          ) || 0),
        full_context_ai_completion_required: postWriteFullContextCheck.required,
      },
      blockers,
      files: {
        report: repoRelativePath(reportPath),
        trace_queues: traceQueues.files,
        remote_verification_checks: verifyArtifact.value.files?.checks
          ? repoRelativeMaybe(resolveRepoPath(verifyArtifact.value.files.checks))
          : null,
      },
    };
    const importLedger = writeCloseoutImportLedger
      ? writeCloseoutImportLedger({
          report,
          reportPath,
          ledgerDir: resolveRepoPath(
            options.ledgerDir || options.importLedgerDir || path.join(outDir, "import-ledger"),
          ),
        })
      : { status: "skipped", files: {}, counts: { entries_written: 0 } };
    const finalReport = {
      ...report,
      counts: {
        ...report.counts,
        import_ledger_entries: importLedger.counts?.entries_written ?? 0,
      },
      files: {
        ...report.files,
        import_ledger: importLedger.files ?? {},
      },
    };
    writeJson(reportPath, finalReport);
    return finalReport;
  }

  return { runDatasetPostWriteCloseout };
}

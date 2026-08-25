import path from "node:path";
import {
  fileExists,
  readJson,
  repoRelativeArtifactPath,
  repoRelativePath,
  resolveRepoPath,
  sameArtifactPath,
} from "./runtime-io.ts";
import {
  deterministicRowsFileTransformEntries,
  patchApplyOutputChainsThroughIdentityRewrite,
  patchApplyOutputChainsThroughIdentityRewriteAndUnresolvedExchangeExternalization,
  patchApplyOutputChainsThroughUnresolvedExchangeExternalization,
  rowsFileReachableThroughTransformChain,
} from "./workflow-row-transform-context.mjs";

export function evidenceScopeBlocker({
  code,
  stage,
  message,
  expected,
  actual,
  artifact,
  repoRoot,
}) {
  return {
    code,
    stage,
    message,
    expected: repoRelativeArtifactPath(repoRoot, expected),
    actual: repoRelativeArtifactPath(repoRoot, actual),
    artifact: artifact ? repoRelativePath(repoRoot, artifact) : null,
  };
}

export function dryRunReportRowsFile(report) {
  return (
    report?.input_path ??
    report?.inputPath ??
    report?.input_file ??
    report?.inputFile ??
    report?.rows_file ??
    report?.rowsFile ??
    report?.source_rows_file ??
    report?.sourceRowsFile ??
    report?.source_path ??
    report?.sourcePath ??
    report?.files?.input ??
    report?.files?.input_rows ??
    report?.files?.source_rows ??
    report?.files?.selected_rows_input
  );
}

export function buildEvidenceScopeBlockers({
  repoRoot,
  rowsFile,
  schemaReportArtifact,
  curationGateArtifact,
  dryRunReportArtifact,
  cleanupArtifact,
  patchApplyArtifact,
  patchApplyContext,
  patchCollectArtifact,
  requirePatchCollectReport,
  requireCurationGate = true,
  remoteVerifyArtifact,
  identityDecisionApplyContext,
  identityReferenceRewriteContext,
  unresolvedExchangeExternalizationContext,
  sourceContactRewriteContext,
  canonicalSupportRewriteContext,
  cleanupContext,
}) {
  const blockers = [];
  const finalRowsFile = path.resolve(rowsFile);
  const schemaInput = schemaReportArtifact?.value?.input_path;
  if (!schemaInput) {
    blockers.push(
      evidenceScopeBlocker({
        code: "schema_report_input_missing",
        stage: "schema",
        message:
          "Schema validation report must record input_path for exact rows-file scope verification.",
        expected: finalRowsFile,
        actual: null,
        artifact: schemaReportArtifact?.path,
        repoRoot,
      }),
    );
  } else if (!sameArtifactPath(repoRoot, schemaInput, finalRowsFile)) {
    blockers.push(
      evidenceScopeBlocker({
        code: "schema_report_rows_mismatch",
        stage: "schema",
        message:
          "Schema validation report input_path does not match the mutation manifest rows file.",
        expected: finalRowsFile,
        actual: schemaInput,
        artifact: schemaReportArtifact?.path,
        repoRoot,
      }),
    );
  }

  if (!curationGateArtifact && requireCurationGate) {
    blockers.push({
      code: "curation_gate_report_required",
      stage: "foundry_curation",
      message:
        "dataset-mutation-manifest requires a post-authoring dataset-curation-gate report for the exact write rows.",
    });
  } else if (curationGateArtifact) {
    const curationRowsFile = curationGateArtifact.value?.rows_file;
    if (!curationRowsFile) {
      blockers.push(
        evidenceScopeBlocker({
          code: "curation_gate_rows_missing",
          stage: "foundry_curation",
          message:
            "Curation gate report must record rows_file for exact rows-file scope verification.",
          expected: finalRowsFile,
          actual: null,
          artifact: curationGateArtifact.path,
          repoRoot,
        }),
      );
    } else if (!sameArtifactPath(repoRoot, curationRowsFile, finalRowsFile)) {
      blockers.push(
        evidenceScopeBlocker({
          code: "curation_gate_rows_mismatch",
          stage: "foundry_curation",
          message: "Curation gate report rows_file does not match the mutation manifest rows file.",
          expected: finalRowsFile,
          actual: curationRowsFile,
          artifact: curationGateArtifact.path,
          repoRoot,
        }),
      );
    }
    if (!["ready", "ready_with_profile_waivers"].includes(curationGateArtifact.value?.status)) {
      blockers.push({
        code: "curation_gate_report_not_ready",
        stage: "foundry_curation",
        message: `Curation gate report status is ${curationGateArtifact.value?.status ?? "missing"}.`,
        artifact: repoRelativePath(repoRoot, curationGateArtifact.path),
      });
    }
    if (!curationGateArtifact.value?.qa_report) {
      blockers.push({
        code: "curation_gate_qa_report_missing",
        stage: "foundry_curation",
        message:
          "Curation gate report must record the deterministic QA report used for final prewrite curation.",
        artifact: repoRelativePath(repoRoot, curationGateArtifact.path),
      });
    } else {
      const qaReportPath = resolveRepoPath(repoRoot, curationGateArtifact.value.qa_report);
      if (!fileExists(qaReportPath)) {
        blockers.push({
          code: "curation_gate_qa_report_not_readable",
          stage: "foundry_curation",
          message: "Curation gate qa_report file is not readable.",
          artifact: repoRelativePath(repoRoot, curationGateArtifact.path),
          qa_report: repoRelativeArtifactPath(repoRoot, curationGateArtifact.value.qa_report),
        });
      } else {
        try {
          const qaReport = readJson(qaReportPath);
          const qaRowsFile = qaReport.rows_file ?? qaReport.input_path ?? qaReport.inputPath;
          if (!qaRowsFile) {
            blockers.push({
              code: "curation_gate_qa_rows_missing",
              stage: "foundry_curation",
              message:
                "Final deterministic QA report must record rows_file or input_path for exact rows-file scope verification.",
              artifact: repoRelativePath(repoRoot, curationGateArtifact.path),
              qa_report: repoRelativePath(repoRoot, qaReportPath),
            });
          } else if (!sameArtifactPath(repoRoot, qaRowsFile, finalRowsFile)) {
            blockers.push(
              evidenceScopeBlocker({
                code: "curation_gate_qa_rows_mismatch",
                stage: "foundry_curation",
                message:
                  "Final deterministic QA report rows_file/input_path does not match the mutation manifest rows file.",
                expected: finalRowsFile,
                actual: qaRowsFile,
                artifact: qaReportPath,
                repoRoot,
              }),
            );
          }
        } catch (error) {
          blockers.push({
            code: "curation_gate_qa_report_invalid",
            stage: "foundry_curation",
            message: error instanceof Error ? error.message : String(error),
            artifact: repoRelativePath(repoRoot, curationGateArtifact.path),
            qa_report: repoRelativePath(repoRoot, qaReportPath),
          });
        }
      }
    }
    if (
      curationGateArtifact.value?.schema_report &&
      schemaReportArtifact?.path &&
      !sameArtifactPath(
        repoRoot,
        curationGateArtifact.value.schema_report,
        schemaReportArtifact.path,
      )
    ) {
      blockers.push(
        evidenceScopeBlocker({
          code: "curation_gate_schema_report_mismatch",
          stage: "foundry_curation",
          message:
            "Curation gate schema_report does not match the schema report passed to mutation manifest.",
          expected: schemaReportArtifact.path,
          actual: curationGateArtifact.value.schema_report,
          artifact: curationGateArtifact.path,
          repoRoot,
        }),
      );
    }
  }

  if (cleanupArtifact) {
    const cleanedRowsFile =
      cleanupArtifact.value?.cleaned_rows_file ?? cleanupArtifact.value?.files?.cleaned_rows;
    if (!cleanedRowsFile) {
      blockers.push(
        evidenceScopeBlocker({
          code: "cleanup_cleaned_rows_missing",
          stage: "prewrite_cleanup",
          message:
            "Cleanup report must record cleaned_rows_file/files.cleaned_rows for exact rows-file scope verification.",
          expected: finalRowsFile,
          actual: null,
          artifact: cleanupArtifact.path,
          repoRoot,
        }),
      );
    } else if (!sameArtifactPath(repoRoot, cleanedRowsFile, finalRowsFile)) {
      blockers.push(
        evidenceScopeBlocker({
          code: "cleanup_cleaned_rows_mismatch",
          stage: "prewrite_cleanup",
          message: "Cleanup cleaned_rows_file does not match the mutation manifest rows file.",
          expected: finalRowsFile,
          actual: cleanedRowsFile,
          artifact: cleanupArtifact.path,
          repoRoot,
        }),
      );
    }
  }

  if (patchApplyArtifact) {
    const patchOut =
      patchApplyArtifact.value?.out_path ?? patchApplyArtifact.value?.files?.patched_rows;
    const cleanupInput = cleanupArtifact?.value?.rows_file;
    if (!patchOut) {
      blockers.push(
        evidenceScopeBlocker({
          code: "patch_apply_output_missing",
          stage: "ai_patch_apply",
          message:
            "Patch apply report must record out_path/files.patched_rows for exact scope verification.",
          expected: cleanupInput || finalRowsFile,
          actual: null,
          artifact: patchApplyArtifact.path,
          repoRoot,
        }),
      );
    } else if (
      cleanupArtifact &&
      !sameArtifactPath(repoRoot, patchOut, cleanupInput) &&
      !patchApplyOutputChainsThroughIdentityRewrite({
        repoRoot,
        patchOut,
        cleanupInput,
        identityReferenceRewriteContext,
      }) &&
      !patchApplyOutputChainsThroughUnresolvedExchangeExternalization({
        repoRoot,
        patchOut,
        cleanupInput,
        unresolvedExchangeExternalizationContext,
      }) &&
      !patchApplyOutputChainsThroughIdentityRewriteAndUnresolvedExchangeExternalization({
        repoRoot,
        patchOut,
        cleanupInput,
        identityReferenceRewriteContext,
        unresolvedExchangeExternalizationContext,
      }) &&
      !rowsFileReachableThroughTransformChain({
        repoRoot,
        startFiles: [patchOut],
        expectedRowsFile: cleanupInput,
        transforms: deterministicRowsFileTransformEntries({
          patchApplyContext: null,
          identityDecisionApplyContext,
          identityReferenceRewriteContext,
          unresolvedExchangeExternalizationContext,
          canonicalSupportRewriteContext,
        }),
      })
    ) {
      blockers.push(
        evidenceScopeBlocker({
          code: "patch_apply_cleanup_input_mismatch",
          stage: "ai_patch_apply",
          message:
            "Patch apply output must match the cleanup input rows file, or feed a completed deterministic rewrite chain whose output is the cleanup input.",
          expected: cleanupInput,
          actual: patchOut,
          artifact: patchApplyArtifact.path,
          repoRoot,
        }),
      );
    } else if (!cleanupArtifact && !sameArtifactPath(repoRoot, patchOut, finalRowsFile)) {
      blockers.push(
        evidenceScopeBlocker({
          code: "patch_apply_rows_mismatch",
          stage: "ai_patch_apply",
          message: "Patch apply output does not match the mutation manifest rows file.",
          expected: finalRowsFile,
          actual: patchOut,
          artifact: patchApplyArtifact.path,
          repoRoot,
        }),
      );
    }
    if ((patchApplyContext?.evidenceRows.length ?? 0) === 0) {
      blockers.push({
        code: "patch_evidence_required",
        stage: "ai_patch_apply",
        message:
          "AI-authored patch apply report was provided, but no patch evidence rows were found.",
        patch_apply_report: repoRelativePath(repoRoot, patchApplyArtifact.path),
      });
    }
  }

  if (requirePatchCollectReport && patchApplyArtifact && !patchCollectArtifact) {
    blockers.push({
      code: "patch_collect_report_required",
      stage: "ai_patch_collect",
      message:
        "Foundry AI authoring task patch apply requires --patch-collect-report from dataset-authoring-patch-collect.",
    });
  }

  if (patchCollectArtifact) {
    if (patchCollectArtifact.value?.status !== "ready_for_patch_apply") {
      blockers.push({
        code: "patch_collect_not_ready",
        stage: "ai_patch_collect",
        message: `dataset-authoring-patch-collect status is ${patchCollectArtifact.value?.status ?? "missing"}.`,
        artifact: repoRelativePath(repoRoot, patchCollectArtifact.path),
      });
    }
    const batchPatch = patchCollectArtifact.value?.files?.batch_patch;
    const appliedPatch = patchApplyArtifact?.value?.patch_path;
    if (
      patchApplyArtifact &&
      batchPatch &&
      appliedPatch &&
      !sameArtifactPath(repoRoot, batchPatch, appliedPatch)
    ) {
      blockers.push(
        evidenceScopeBlocker({
          code: "patch_collect_apply_patch_mismatch",
          stage: "ai_patch_collect",
          message:
            "Collected batch patch file does not match the patch file applied by dataset-patch-apply.",
          expected: batchPatch,
          actual: appliedPatch,
          artifact: patchCollectArtifact.path,
          repoRoot,
        }),
      );
    }
  }

  if (!dryRunReportArtifact) {
    blockers.push({
      code: "dry_run_report_required",
      stage: "dry_run",
      message:
        "dataset-mutation-manifest requires a dry-run report before remote write planning. Upstream prewrite gates may intentionally skip dry-run and keep the manifest blocked.",
    });
  } else {
    const dryRunInput = dryRunReportRowsFile(dryRunReportArtifact.value);
    if (!dryRunInput) {
      blockers.push(
        evidenceScopeBlocker({
          code: "dry_run_report_input_missing",
          stage: "dry_run",
          message:
            "Dry-run report must record input_path/input_file/rows_file for exact rows-file scope verification.",
          expected: finalRowsFile,
          actual: null,
          artifact: dryRunReportArtifact.path,
          repoRoot,
        }),
      );
    } else if (!sameArtifactPath(repoRoot, dryRunInput, finalRowsFile)) {
      blockers.push(
        evidenceScopeBlocker({
          code: "dry_run_report_rows_mismatch",
          stage: "dry_run",
          message: "Dry-run report input path does not match the mutation manifest rows file.",
          expected: finalRowsFile,
          actual: dryRunInput,
          artifact: dryRunReportArtifact.path,
          repoRoot,
        }),
      );
    }
  }

  if (remoteVerifyArtifact) {
    const remoteInput = remoteVerifyArtifact.value?.input_path;
    if (!remoteInput) {
      blockers.push(
        evidenceScopeBlocker({
          code: "remote_verify_input_missing",
          stage: "remote_verify",
          message:
            "Remote verification report must record input_path for exact rows-file scope verification.",
          expected: finalRowsFile,
          actual: null,
          artifact: remoteVerifyArtifact.path,
          repoRoot,
        }),
      );
    } else if (!sameArtifactPath(repoRoot, remoteInput, finalRowsFile)) {
      blockers.push(
        evidenceScopeBlocker({
          code: "remote_verify_rows_mismatch",
          stage: "remote_verify",
          message:
            "Remote verification report input_path does not match the mutation manifest rows file.",
          expected: finalRowsFile,
          actual: remoteInput,
          artifact: remoteVerifyArtifact.path,
          repoRoot,
        }),
      );
    }
  }

  return blockers;
}

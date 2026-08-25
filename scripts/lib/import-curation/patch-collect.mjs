import fs from "node:fs";
import path from "node:path";
import {
  authoringTaskFullContextReadinessBlockers,
  patchPayloadPatchSets,
  patchSetOperations,
  sharedContextBundleReadinessBlockers,
  validateCollectedPatchSet,
} from "./internal/authoring-patch-workflow.mjs";
import {
  asText,
  ensureArray,
  fileExists,
  nowIso,
  readJson,
  repoRelativePath,
  resolveRepoPath,
  writeJson,
} from "./internal/runtime-io.ts";

export function runDatasetAuthoringPatchCollect({ repoRoot, options = {} } = {}) {
  if (options.help) {
    return {
      schema_version: 1,
      status: "help",
      command: "dataset-authoring-patch-collect",
      usage: [
        "node scripts/foundry.mjs dataset-authoring-patch-collect --task-manifest <authoring-task-manifest.json>",
        "node scripts/foundry.mjs dataset-authoring-patch-collect --task-manifest ./authoring-tasks/authoring-task-manifest.json",
      ],
      purpose:
        "Collect per-task AI patch outputs into one batch patch file and block if any task output is missing or structurally invalid. This command is local-only and never writes the database.",
    };
  }

  const manifestPath = resolveRepoPath(
    repoRoot,
    options.taskManifest ?? options.manifest ?? options.input,
  );
  if (!manifestPath || !fileExists(manifestPath)) {
    throw new Error("--task-manifest is required and must point to authoring-task-manifest.json.");
  }
  const manifest = readJson(manifestPath);
  const manifestDir = path.dirname(manifestPath);
  const outDir = resolveRepoPath(repoRoot, options.outDir || manifestDir);
  const batchPatchPath = resolveRepoPath(
    repoRoot,
    options.out ||
      options.patchOut ||
      manifest.batch_patch_contract?.output_patch_file ||
      path.join(outDir, "ai-patches.batch.json"),
  );
  const reportPath = path.join(outDir, "authoring-patch-collect-report.json");
  const requiredTasks = ensureArray(manifest.tasks).filter(
    (task) => task?.status === "ready_for_ai_authoring" || Number(task?.action_item_count ?? 0) > 0,
  );
  const patchSets = [];
  const patchFiles = [];
  const blockers = [];

  if (requiredTasks.length > 0) {
    blockers.push(
      ...sharedContextBundleReadinessBlockers({
        repoRoot,
        sharedContextBundle: manifest?.shared_context_bundle,
        sourceKind: "manifest",
        sourcePath: manifestPath,
      }),
    );
  }

  for (const [taskIndex, task] of requiredTasks.entries()) {
    const taskContextBlockers = authoringTaskFullContextReadinessBlockers({
      repoRoot,
      task,
    });
    if (taskContextBlockers.length > 0) {
      blockers.push(
        ...taskContextBlockers.map((blocker) => ({
          ...blocker,
          task_index: taskIndex,
          entity: task.entity ?? null,
        })),
      );
      continue;
    }
    const patchPath = resolveRepoPath(repoRoot, task?.files?.output_patch_file);
    if (!patchPath || !fileExists(patchPath)) {
      blockers.push({
        code: "ai_patch_missing",
        message: "Expected AI patch file is missing for authoring task.",
        task_index: taskIndex,
        entity: task.entity ?? null,
        expected_patch_file: task?.files?.output_patch_file ?? null,
      });
      continue;
    }
    let rawPatch;
    try {
      rawPatch = readJson(patchPath);
    } catch (error) {
      blockers.push({
        code: "ai_patch_invalid_json",
        message: error instanceof Error ? error.message : String(error),
        task_index: taskIndex,
        entity: task.entity ?? null,
        patch_file: repoRelativePath(repoRoot, patchPath),
      });
      continue;
    }
    if (asText(rawPatch?.template_status) === "requires_ai_completion") {
      blockers.push({
        code: "ai_patch_template_incomplete",
        message: "AI patch file still has template_status=requires_ai_completion.",
        task_index: taskIndex,
        entity: task.entity ?? null,
        patch_file: repoRelativePath(repoRoot, patchPath),
      });
      continue;
    }
    const patchStatus = asText(rawPatch?.patch_status ?? rawPatch?.status);
    if (patchStatus !== "completed") {
      blockers.push({
        code: "ai_patch_status_not_completed",
        message: "AI patch file must declare patch_status=completed before collect.",
        task_index: taskIndex,
        entity: task.entity ?? null,
        patch_file: repoRelativePath(repoRoot, patchPath),
        patch_status: patchStatus || null,
      });
      continue;
    }
    const taskPatchSets = patchPayloadPatchSets(rawPatch);
    if (taskPatchSets.length === 0) {
      blockers.push({
        code: "ai_patch_no_patch_sets",
        message: "AI patch file must contain a patch set or patch_sets[].",
        task_index: taskIndex,
        entity: task.entity ?? null,
        patch_file: repoRelativePath(repoRoot, patchPath),
      });
      continue;
    }
    for (const [patchSetIndex, patchSet] of taskPatchSets.entries()) {
      blockers.push(
        ...validateCollectedPatchSet({
          repoRoot,
          task,
          patchSet,
          patchSetIndex,
          patchPath,
        }),
      );
    }
    patchSets.push(...taskPatchSets);
    patchFiles.push(repoRelativePath(repoRoot, patchPath));
  }

  const operationCount = patchSets.reduce(
    (total, patchSet) => total + (patchSetOperations(patchSet)?.length ?? 0),
    0,
  );
  const report = {
    schema_version: 1,
    generated_at_utc: nowIso(),
    status: blockers.length > 0 ? "blocked" : "ready_for_patch_apply",
    task_manifest: repoRelativePath(repoRoot, manifestPath),
    counts: {
      tasks: ensureArray(manifest.tasks).length,
      required_tasks: requiredTasks.length,
      patch_files: patchFiles.length,
      patch_sets: patchSets.length,
      operations: operationCount,
      blockers: blockers.length,
    },
    patch_files: patchFiles,
    blockers,
    commands: {
      apply_all_patches: manifest.commands?.apply_all_patches ?? null,
    },
    files: {
      batch_patch: repoRelativePath(repoRoot, batchPatchPath),
      report: repoRelativePath(repoRoot, reportPath),
    },
  };
  fs.mkdirSync(outDir, { recursive: true });
  if (blockers.length === 0) {
    writeJson(batchPatchPath, {
      schema_version: 1,
      kind: "tiangong_foundry_dataset_patch_batch",
      patch_status: "completed",
      generated_at_utc: report.generated_at_utc,
      task_manifest: repoRelativePath(repoRoot, manifestPath),
      patch_sets: patchSets,
    });
  }
  writeJson(reportPath, report);
  return report;
}

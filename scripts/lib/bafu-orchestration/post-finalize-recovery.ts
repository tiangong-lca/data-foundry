import path from "node:path";

import type { JsonRecord } from "./finalize-recovery-policy.ts";

export interface PostFinalizeRecoveryCommandResult {
  status: number | null;
  signal?: string | null;
  error?: Error;
  stdout?: string | Uint8Array | null;
  stderr?: string | Uint8Array | null;
}

export interface PostFinalizeRecoveryArgvStageInput {
  stage: string;
  argv: string[];
  logDir: string;
}

export interface PostFinalizeRecoveryArgvStageResult {
  result: PostFinalizeRecoveryCommandResult;
  stdoutLog: string;
  stderrLog: string;
}

export interface PostFinalizeRecoveryCommandAuthority {
  executable: string;
  argv: string[];
  display: string;
}

export interface PostFinalizeRecoveryStageProjectionInput {
  stage: string;
  command: PostFinalizeRecoveryCommandAuthority;
  result: PostFinalizeRecoveryCommandResult;
  stdoutLog: string;
  stderrLog: string;
  reportPath: string | null;
}

export interface PostFinalizeRecoveryAdapter {
  processExecutable: string;
  foundryEntryPath: string;
  resolveRepoPath: (value: unknown) => string | null;
  repoRelative: (filePath: string | null | undefined) => string;
  fileExists: (filePath: string | null | undefined) => boolean;
  readJson: (filePath: string) => JsonRecord;
  textValue: (value: unknown) => string;
  commandString: (argv: string[]) => string;
  runArgvStage: (input: PostFinalizeRecoveryArgvStageInput) => PostFinalizeRecoveryArgvStageResult;
  projectCommandStage: (input: PostFinalizeRecoveryStageProjectionInput) => JsonRecord;
}

export interface PostFinalizeRecoveryInput {
  finalizeReport: JsonRecord;
  currentRowsFile: string;
  outDir: string;
  logDir: string;
  attempt: number;
}

export interface PostFinalizeRecoveryResult extends JsonRecord {
  status: string;
  blocker?: JsonRecord;
  rowsFile?: string;
  identityApplyReport?: string | null;
  patchCollectReport?: string | null;
  patchApplyReport?: string | null;
  stages?: JsonRecord[];
}

function isJsonRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function jsonRecord(value: unknown): JsonRecord {
  return isJsonRecord(value) ? value : {};
}

interface ProjectedArgvStageInput extends PostFinalizeRecoveryArgvStageInput {
  reportPath: string | null;
}

interface ProjectedArgvStageResult extends PostFinalizeRecoveryArgvStageResult {
  projection: JsonRecord;
}

function runProjectedArgvStage(
  { stage, argv, logDir, reportPath }: ProjectedArgvStageInput,
  adapter: PostFinalizeRecoveryAdapter,
): ProjectedArgvStageResult {
  const [executable, ...args] = argv;
  if (!executable) throw new TypeError(`Recovery stage ${stage} requires an executable.`);
  const exactArgv = [executable, ...args];
  const command: PostFinalizeRecoveryCommandAuthority = {
    executable,
    argv: [...args],
    display: adapter.commandString(exactArgv),
  };
  const execution = adapter.runArgvStage({ stage, argv: [...exactArgv], logDir });
  return {
    ...execution,
    projection: adapter.projectCommandStage({
      stage,
      command,
      result: execution.result,
      stdoutLog: execution.stdoutLog,
      stderrLog: execution.stderrLog,
      reportPath,
    }),
  };
}

export function runPostFinalizeIdentityRecovery(
  { finalizeReport, currentRowsFile, outDir, logDir, attempt }: PostFinalizeRecoveryInput,
  adapter: PostFinalizeRecoveryAdapter,
): PostFinalizeRecoveryResult {
  const gateReportPath = adapter.resolveRepoPath(
    jsonRecord(finalizeReport.files).curation_gate_report,
  );
  if (!adapter.fileExists(gateReportPath)) {
    return {
      status: "blocked",
      blocker: {
        code: "post_finalize_curation_gate_report_missing",
        message: "Post-finalize identity recovery requires a readable curation gate report.",
      },
    };
  }
  const identityTaskDir = path.join(outDir, `post-finalize-${attempt}-identity-task`);
  const identityTaskReport = path.join(identityTaskDir, "identity-decision-task-report.json");
  const identityTaskArgv = [
    adapter.processExecutable,
    adapter.foundryEntryPath,
    "dataset-identity-decision-task-build",
    "--curation-gate-report",
    adapter.repoRelative(gateReportPath),
    "--out-dir",
    adapter.repoRelative(identityTaskDir),
    "--shared-context-cache-dir",
    adapter.repoRelative(path.join(outDir, "shared-context-cache")),
  ];
  const identityTask = runProjectedArgvStage(
    {
      stage: `post-finalize-${attempt}.identity-task`,
      argv: identityTaskArgv,
      logDir,
      reportPath: identityTaskReport,
    },
    adapter,
  );
  if (!adapter.fileExists(identityTaskReport)) {
    return {
      status: "blocked",
      stages: [identityTask.projection],
      blocker: {
        code: "post_finalize_identity_task_report_missing",
        message: "Post-finalize identity task did not emit its report.",
      },
    };
  }
  const identityTaskJson = adapter.readJson(identityTaskReport);
  const stages: JsonRecord[] = [identityTask.projection];
  if (identityTaskJson.status === "ready_no_identity_actions") {
    return {
      status: "completed_noop",
      rowsFile: currentRowsFile,
      identityApplyReport: null,
      stages,
    };
  }
  if (identityTaskJson.status !== "ready_for_ai_identity_decisions") {
    return {
      status: "blocked",
      stages,
      blocker: {
        code: "post_finalize_identity_task_not_ready",
        message: `Post-finalize identity task status is ${identityTaskJson.status || "missing"}.`,
        identity_task_status: identityTaskJson.status ?? null,
        blockers: identityTaskJson.blockers ?? [],
      },
    };
  }

  const identityAutofillReport = path.join(
    identityTaskDir,
    "bafu-identity-decisions-autofill-report.json",
  );
  const identityAutofillArgv = [
    adapter.processExecutable,
    adapter.foundryEntryPath,
    "dataset-bafu-identity-decisions-autofill",
    "--identity-decision-task",
    adapter.repoRelative(path.join(identityTaskDir, "identity-decision-task.json")),
  ];
  const identityAutofill = runProjectedArgvStage(
    {
      stage: `post-finalize-${attempt}.identity-autofill`,
      argv: identityAutofillArgv,
      logDir,
      reportPath: identityAutofillReport,
    },
    adapter,
  );
  stages.push(identityAutofill.projection);
  if (!adapter.fileExists(identityAutofillReport)) {
    return {
      status: "blocked",
      stages,
      blocker: {
        code: "post_finalize_identity_autofill_report_missing",
        message: "Post-finalize BAFU identity autofill did not emit its report.",
      },
    };
  }
  const identityAutofillJson = adapter.readJson(identityAutofillReport);
  if (
    !["completed", "completed_with_manual_review"].includes(
      adapter.textValue(identityAutofillJson.status),
    )
  ) {
    return {
      status: "blocked",
      stages,
      blocker: {
        code: "post_finalize_identity_autofill_not_completed",
        message: `Post-finalize BAFU identity autofill status is ${identityAutofillJson.status || "missing"}.`,
        blockers: identityAutofillJson.blockers ?? identityAutofillJson.blocked ?? [],
      },
    };
  }

  const identityApplyDir = path.join(outDir, `post-finalize-${attempt}-identity-apply`);
  const identityApplyReport = path.join(identityApplyDir, "identity-decisions-apply-report.json");
  const identityApplyArgv = [
    adapter.processExecutable,
    adapter.foundryEntryPath,
    "dataset-identity-decisions-apply",
    "--type",
    "process",
    "--rows-file",
    adapter.repoRelative(currentRowsFile),
    "--decisions",
    adapter.repoRelative(path.join(identityTaskDir, "identity-decisions.jsonl")),
    "--out-dir",
    adapter.repoRelative(identityApplyDir),
    "--authoring-package-dir",
    adapter.repoRelative(path.join(identityTaskDir, "authoring-package-snapshots")),
  ];
  const identityApply = runProjectedArgvStage(
    {
      stage: `post-finalize-${attempt}.identity-apply`,
      argv: identityApplyArgv,
      logDir,
      reportPath: identityApplyReport,
    },
    adapter,
  );
  stages.push(identityApply.projection);
  if (!adapter.fileExists(identityApplyReport)) {
    return {
      status: "blocked",
      stages,
      blocker: {
        code: "post_finalize_identity_apply_report_missing",
        message: "Post-finalize identity decisions apply did not emit its report.",
      },
    };
  }
  const identityApplyJson = adapter.readJson(identityApplyReport);
  if (identityApplyJson.status !== "completed") {
    return {
      status: "blocked",
      stages,
      blocker: {
        code: "post_finalize_identity_apply_not_completed",
        message: `Post-finalize identity apply status is ${identityApplyJson.status || "missing"}.`,
        blockers: identityApplyJson.blockers ?? [],
      },
    };
  }
  return {
    status: "completed",
    rowsFile:
      adapter.resolveRepoPath(jsonRecord(identityApplyJson.files).output_rows) || currentRowsFile,
    identityApplyReport,
    stages,
  };
}

export function runPostFinalizeSemanticRecovery(
  { finalizeReport, currentRowsFile, outDir, logDir, attempt }: PostFinalizeRecoveryInput,
  adapter: PostFinalizeRecoveryAdapter,
): PostFinalizeRecoveryResult {
  const gateReportPath = adapter.resolveRepoPath(
    jsonRecord(finalizeReport.files).curation_gate_report,
  );
  if (!adapter.fileExists(gateReportPath)) {
    return {
      status: "blocked",
      blocker: {
        code: "post_finalize_curation_gate_report_missing",
        message: "Post-finalize semantic recovery requires a readable curation gate report.",
      },
    };
  }

  const authoringDir = path.join(outDir, `post-finalize-${attempt}-semantic-task`);
  const taskManifest = path.join(authoringDir, "authoring-task-manifest.json");
  const taskBuildArgv = [
    adapter.processExecutable,
    adapter.foundryEntryPath,
    "dataset-authoring-task-build",
    "--curation-gate-report",
    adapter.repoRelative(gateReportPath),
    "--out-dir",
    adapter.repoRelative(authoringDir),
    "--shared-context-cache-dir",
    adapter.repoRelative(path.join(outDir, "shared-context-cache")),
  ];
  const taskBuild = runProjectedArgvStage(
    {
      stage: `post-finalize-${attempt}.semantic-task`,
      argv: taskBuildArgv,
      logDir,
      reportPath: taskManifest,
    },
    adapter,
  );
  const stages: JsonRecord[] = [taskBuild.projection];
  if (!adapter.fileExists(taskManifest)) {
    return {
      status: "blocked",
      stages,
      blocker: {
        code: "post_finalize_semantic_task_report_missing",
        message: "Post-finalize semantic authoring task did not emit its manifest.",
      },
    };
  }
  const taskBuildJson = adapter.readJson(taskManifest);
  if (taskBuildJson.status === "ready_no_action_items") {
    return {
      status: "completed_noop",
      rowsFile: currentRowsFile,
      patchCollectReport: null,
      patchApplyReport: null,
      stages,
    };
  }
  if (taskBuildJson.status !== "ready_for_ai_authoring_batch") {
    return {
      status: "blocked",
      stages,
      blocker: {
        code: "post_finalize_semantic_task_not_ready",
        message: `Post-finalize semantic authoring task status is ${taskBuildJson.status || "missing"}.`,
        authoring_task_status: taskBuildJson.status ?? null,
        blockers: taskBuildJson.blockers ?? [],
      },
    };
  }

  const patchAutofillReport = path.join(
    authoringDir,
    "bafu-authoring-patches-autofill-report.json",
  );
  const patchAutofillArgv = [
    adapter.processExecutable,
    adapter.foundryEntryPath,
    "dataset-bafu-authoring-patches-autofill",
    "--task-manifest",
    adapter.repoRelative(taskManifest),
  ];
  const patchAutofill = runProjectedArgvStage(
    {
      stage: `post-finalize-${attempt}.patch-autofill`,
      argv: patchAutofillArgv,
      logDir,
      reportPath: patchAutofillReport,
    },
    adapter,
  );
  stages.push(patchAutofill.projection);
  if (!adapter.fileExists(patchAutofillReport)) {
    return {
      status: "blocked",
      stages,
      blocker: {
        code: "post_finalize_semantic_patch_autofill_report_missing",
        message: "Post-finalize BAFU semantic patch autofill did not emit its report.",
      },
    };
  }
  const patchAutofillJson = adapter.readJson(patchAutofillReport);
  if (
    !["completed", "completed_no_supported_patches"].includes(
      adapter.textValue(patchAutofillJson.status),
    )
  ) {
    return {
      status: "blocked",
      stages,
      blocker: {
        code: "post_finalize_semantic_patch_autofill_not_completed",
        message: `Post-finalize BAFU semantic patch autofill status is ${patchAutofillJson.status || "missing"}.`,
        blockers: patchAutofillJson.blockers ?? patchAutofillJson.blocked ?? [],
      },
    };
  }

  const patchCollectReport = path.join(authoringDir, "authoring-patch-collect-report.json");
  const patchCollectArgv = [
    adapter.processExecutable,
    adapter.foundryEntryPath,
    "dataset-authoring-patch-collect",
    "--task-manifest",
    adapter.repoRelative(taskManifest),
  ];
  const patchCollect = runProjectedArgvStage(
    {
      stage: `post-finalize-${attempt}.patch-collect`,
      argv: patchCollectArgv,
      logDir,
      reportPath: patchCollectReport,
    },
    adapter,
  );
  stages.push(patchCollect.projection);
  if (!adapter.fileExists(patchCollectReport)) {
    return {
      status: "blocked",
      stages,
      blocker: {
        code: "post_finalize_semantic_patch_collect_report_missing",
        message: "Post-finalize semantic patch collect did not emit its report.",
      },
    };
  }
  const patchCollectJson = adapter.readJson(patchCollectReport);
  if (patchCollectJson.status === "ready_no_patch_required") {
    return {
      status: "completed_noop",
      rowsFile: currentRowsFile,
      patchCollectReport,
      patchApplyReport: null,
      stages,
    };
  }
  if (patchCollectJson.status !== "ready_for_patch_apply") {
    return {
      status: "blocked",
      stages,
      blocker: {
        code: "post_finalize_semantic_patch_collect_not_ready",
        message: `Post-finalize semantic patch collect status is ${patchCollectJson.status || "missing"}.`,
        blockers: patchCollectJson.blockers ?? [],
      },
    };
  }

  const patchedRowsFile = path.join(authoringDir, "processes.patched.jsonl");
  const patchApplyDir = path.join(authoringDir, "patch-apply");
  const patchApplyArgv = [
    adapter.processExecutable,
    adapter.foundryEntryPath,
    "dataset-patch-apply",
    "--input",
    adapter.repoRelative(currentRowsFile),
    "--patch",
    adapter.repoRelative(
      adapter.textValue(jsonRecord(patchCollectJson.files).batch_patch) ||
        path.join(authoringDir, "ai-patches.batch.json"),
    ),
    "--out",
    adapter.repoRelative(patchedRowsFile),
    "--out-dir",
    adapter.repoRelative(patchApplyDir),
    "--authoring-package-dir",
    adapter.repoRelative(path.join(authoringDir, "authoring-package-snapshots")),
    "--require-authoring-package",
    "--require-action-item-closure",
  ];
  const patchApplyReport = path.join(patchApplyDir, "outputs", "dataset-patch-apply-report.json");
  const patchApply = runProjectedArgvStage(
    {
      stage: `post-finalize-${attempt}.patch-apply`,
      argv: patchApplyArgv,
      logDir,
      reportPath: patchApplyReport,
    },
    adapter,
  );
  stages.push(patchApply.projection);
  if (!adapter.fileExists(patchApplyReport)) {
    return {
      status: "blocked",
      stages,
      blocker: {
        code: "post_finalize_semantic_patch_apply_report_missing",
        message: "Post-finalize semantic patch apply did not emit its report.",
      },
    };
  }
  const patchApplyJson = adapter.readJson(patchApplyReport);
  if (patchApplyJson.status !== "completed") {
    return {
      status: "blocked",
      stages,
      blocker: {
        code: "post_finalize_semantic_patch_apply_not_completed",
        message: `Post-finalize semantic patch apply status is ${patchApplyJson.status || "missing"}.`,
        blockers: patchApplyJson.blockers ?? [],
      },
    };
  }

  return {
    status: "completed",
    rowsFile:
      adapter.resolveRepoPath(jsonRecord(patchApplyJson.files).patched_rows) || patchedRowsFile,
    patchCollectReport,
    patchApplyReport,
    stages,
  };
}

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { readOnlyStageContract } from "../lib/stage-contract.ts";

interface LooseRecord {
  [key: string]: LooseRecord | undefined;
}

interface ExistingArtifact {
  path: string;
  value: LooseRecord;
}

interface ArtifactStatus {
  exists: boolean;
  path: string | null;
  status: string;
  counts?: LooseRecord | null;
  completed?: boolean;
}

interface ContextPaths {
  schema: string | null;
  methodology_yaml: string | null;
  ruleset: string | null;
  classification_schema: string[];
  location_schema: string | null;
}

interface GateScope {
  dataset_type: string;
  dataset_ids: string[];
}

interface PhaseStatus {
  status: string;
  required: boolean;
  [key: string]: unknown;
}

interface PhaseLike {
  status: string;
  required: boolean;
  [key: string]: unknown;
}

interface MutablePhase extends PhaseLike {
  commands: Record<string, unknown>;
}

interface ChunkBuildArgs {
  datasetType: string;
  offset: number;
  limit: number;
  chunkLabel: string;
}

interface IdentityApplyCommand {
  dataset_type: string;
  rows_file: string;
  authoring_package_dir: string | null;
  output_rows?: string | null;
  command: string;
}

interface AuthoringPlanDependencies {
  appendOption: (args: unknown[], flag: string, value: unknown) => void;
  appendRepeatedOptions: (args: unknown[], flag: string, values: unknown) => void;
  asText: (value: unknown) => string;
  datasetRowsFileStem: (datasetType: string) => string;
  decisionTaskChunkLabel: (
    options: LooseRecord,
    selection: Record<string, unknown>,
    fallback: string,
  ) => string;
  ensureArray: (value: unknown) => LooseRecord[];
  fileExists: (filePath: string | null | undefined) => boolean;
  hasUnresolvedAiPlaceholder: (value: unknown) => boolean;
  normalizedList: (value: unknown) => string[];
  nowIso: () => string;
  positiveIntegerOption: (value: unknown, fallback: number | null) => number | null;
  readJson: (filePath: string) => LooseRecord;
  readJsonOrJsonLines: (filePath: string) => LooseRecord[];
  repoRelativeMaybe: (filePath: string | null | undefined) => string | null;
  repoRelativePath: (filePath: string) => string;
  repoRoot: string;
  resolveRepoPath: (filePath: unknown) => string;
  safeFileToken: (value: unknown, fallback: string) => string;
  shellQuote: (value: unknown) => string;
  unique: <T>(values: T[]) => T[];
  writeJson: (filePath: string, value: unknown) => void;
}

const authoringPlanStageContract = readOnlyStageContract([
  {
    stage: "load_curation_scope",
    phase: "prepare",
    purpose:
      "Read the curation gate report and derive the authoring workspace, context files, queues, and entity scope.",
    inputs: ["dataset-curation-gate-report.json", "workspace options"],
    outputs: ["authoring plan scope"],
    side_effects: [],
  },
  {
    stage: "inspect_existing_artifacts",
    phase: "rewrite_cleanup",
    purpose:
      "Inspect existing identity, classification, location, patch task, decision, collect, and apply artifacts.",
    inputs: ["authoring workspace artifacts"],
    outputs: ["phase artifact status snapshots"],
    side_effects: [],
  },
  {
    stage: "plan_next_commands",
    phase: "gate_validate",
    purpose:
      "Synthesize deterministic next commands for missing task builds, AI decision application, patch collection, and patch application.",
    inputs: ["phase status snapshots", "curation scope"],
    outputs: ["phase command plan"],
    side_effects: [],
  },
  {
    stage: "report",
    phase: "report",
    purpose: "Emit the authoring plan with phases, instructions, counts, and report path.",
    inputs: ["phase command plan"],
    outputs: ["dataset-authoring-plan.json"],
    side_effects: ["writes local .foundry artifact files"],
  },
]);

export function createAuthoringPlanCommands({
  appendOption,
  appendRepeatedOptions,
  asText,
  datasetRowsFileStem,
  decisionTaskChunkLabel,
  ensureArray,
  fileExists,
  hasUnresolvedAiPlaceholder,
  normalizedList,
  nowIso,
  positiveIntegerOption,
  readJson,
  readJsonOrJsonLines,
  repoRelativeMaybe,
  repoRelativePath,
  repoRoot,
  resolveRepoPath,
  safeFileToken,
  shellQuote,
  unique,
  writeJson,
}: AuthoringPlanDependencies) {
  function foundryCommand(args: readonly unknown[]): string {
    return [process.execPath, path.join(repoRoot, "scripts", "foundry.mjs"), ...args]
      .map(shellQuote)
      .join(" ");
  }

  function authoringPlanWorkspaceDir(curationGateReportPath: string, options: LooseRecord): string {
    const explicit = resolveRepoPath(options.workspaceDir || options.workspace);
    if (explicit) return explicit;
    const curationDir = path.dirname(curationGateReportPath);
    return path.basename(curationDir) === "curation-gate" ? path.dirname(curationDir) : curationDir;
  }

  function existingArtifact(filePath: unknown): ExistingArtifact | null {
    const resolved = resolveRepoPath(filePath);
    if (!resolved || !fileExists(resolved)) return null;
    return { path: resolved, value: readJson(resolved) };
  }

  function artifactStatus(filePath: unknown): ArtifactStatus {
    const artifact = existingArtifact(filePath);
    if (!artifact) {
      return {
        exists: false,
        path: repoRelativeMaybe(resolveRepoPath(filePath)),
        status: "missing",
      };
    }
    return {
      exists: true,
      path: repoRelativePath(artifact.path),
      status: asText(artifact.value?.status) || "present",
      counts: artifact.value?.counts ?? null,
    };
  }

  function aiRowsFileStatus(
    filePath: unknown,
    { requireCompletedDecision = false }: { requireCompletedDecision?: boolean } = {},
  ) {
    const resolved = resolveRepoPath(filePath);
    if (!resolved || !fileExists(resolved)) {
      return {
        exists: false,
        path: resolved ? repoRelativePath(resolved) : null,
        status: "missing",
        rows: 0,
        placeholders: 0,
        incomplete_decisions: 0,
      };
    }
    const rows = readJsonOrJsonLines(resolved);
    const placeholders = rows.filter(hasUnresolvedAiPlaceholder).length;
    const incompleteDecisions = requireCompletedDecision
      ? rows.filter((row) => asText(row?.decision_status) !== "completed").length
      : 0;
    return {
      exists: true,
      path: repoRelativePath(resolved),
      status:
        rows.length === 0
          ? "empty"
          : placeholders > 0 || incompleteDecisions > 0
            ? "needs_ai_completion"
            : "ready_for_apply",
      rows: rows.length,
      placeholders,
      incomplete_decisions: incompleteDecisions,
    };
  }

  function authoringPlanContextPaths(curationGateReport: LooseRecord): ContextPaths {
    const details = ensureArray(curationGateReport?.context?.contract_context_file_details);
    const byKind = new Map<string, string[]>();
    for (const detail of details) {
      const kind = asText(detail?.kind);
      const filePath = asText(detail?.path);
      if (!kind || !filePath) continue;
      const values = byKind.get(kind) ?? [];
      values.push(filePath);
      byKind.set(kind, values);
    }
    return {
      schema: byKind.get("schema")?.[0] ?? null,
      methodology_yaml: byKind.get("methodology_yaml")?.[0] ?? null,
      ruleset: byKind.get("ruleset")?.[0] ?? null,
      classification_schema: byKind.get("classification_schema") ?? [],
      location_schema: byKind.get("location_schema")?.[0] ?? null,
    };
  }

  function appendContextOptions(args: unknown[], contextPaths: ContextPaths): void {
    appendOption(args, "--schema-file", contextPaths.schema);
    appendOption(args, "--yaml-file", contextPaths.methodology_yaml);
    appendOption(args, "--ruleset-file", contextPaths.ruleset);
    appendRepeatedOptions(args, "--classification-schema", contextPaths.classification_schema);
    appendOption(args, "--location-schema", contextPaths.location_schema);
  }

  function authoringPlanGateScope(curationGateReport: LooseRecord): GateScope {
    const datasetType = asText(curationGateReport?.dataset_type);
    const entities = ensureArray(
      curationGateReport?.entities ??
        curationGateReport?.processes ??
        curationGateReport?.flows ??
        curationGateReport?.items,
    );
    return {
      dataset_type: datasetType,
      dataset_ids: unique(
        entities
          .map((entity) =>
            asText(
              entity?.entity_id ?? entity?.dataset_id ?? entity?.process_id ?? entity?.flow_id,
            ),
          )
          .filter(Boolean),
      ),
    };
  }

  function appendAuthoringPlanGateScopeOptions(args: unknown[], scope: GateScope): void {
    appendOption(args, "--dataset-type", scope?.dataset_type);
    appendRepeatedOptions(args, "--dataset-id", scope?.dataset_ids ?? []);
  }

  function authoringPlanScopedDecisionQueuePath({
    taskPath,
    taskQueueKey,
    originalQueue,
    scope,
    kind,
  }: {
    taskPath: string;
    taskQueueKey: string;
    originalQueue: string;
    scope: GateScope;
    kind: string;
  }): string {
    const taskQueue = asText(existingArtifact(taskPath)?.value?.[taskQueueKey]);
    if (taskQueue) return taskQueue;
    if (scope?.dataset_type) {
      const selection = {
        dataset_types: [scope.dataset_type],
        category_types: [],
        bundle_ids: [],
      };
      const label = decisionTaskChunkLabel({}, selection, `${kind}-scope`);
      return repoRelativePath(
        path.join(
          path.dirname(resolveRepoPath(taskPath)),
          `${kind}-authoring-queue.${label}.jsonl`,
        ),
      );
    }
    return originalQueue;
  }

  function authoringPlanDefaultPaths(workspaceDir: string) {
    return {
      identityTask: path.join(
        workspaceDir,
        "identity-decision-task",
        "identity-decision-task.json",
      ),
      identityDecisions: path.join(
        workspaceDir,
        "identity-decision-task",
        "identity-decisions.jsonl",
      ),
      identityApplyReport: path.join(
        workspaceDir,
        "identity-decision-apply",
        "identity-decisions-apply-report.json",
      ),
      classificationTask: path.join(
        workspaceDir,
        "classification-decision-task",
        "classification-decision-task.json",
      ),
      classificationDecisions: path.join(
        workspaceDir,
        "classification-decision-task",
        "classification-decisions.jsonl",
      ),
      classificationApplyReport: path.join(
        workspaceDir,
        "classification-decision-apply",
        "classification-decisions-apply-report.json",
      ),
      locationTask: path.join(
        workspaceDir,
        "location-decision-task",
        "location-decision-task.json",
      ),
      locationDecisions: path.join(
        workspaceDir,
        "location-decision-task",
        "location-decisions.jsonl",
      ),
      locationApplyReport: path.join(
        workspaceDir,
        "location-decision-apply",
        "location-decisions-apply-report.json",
      ),
      authoringTaskManifest: path.join(
        workspaceDir,
        "authoring-tasks",
        "authoring-task-manifest.json",
      ),
      patchCollectReport: path.join(
        workspaceDir,
        "authoring-tasks",
        "authoring-patch-collect-report.json",
      ),
      patchApplyReport: path.join(workspaceDir, "patch-apply", "dataset-patch-apply-report.json"),
    };
  }

  function authoringPlanApplyStatus(reportPath: unknown): ArtifactStatus {
    const artifact = artifactStatus(reportPath);
    return {
      ...artifact,
      completed: artifact.exists && artifact.status === "completed",
    };
  }

  function phaseStatusFromTaskDecision({
    required,
    taskPath,
    readyStatus,
    emptyStatus,
    decisionsPath,
    applyReportPath,
    applyReportPaths = null,
  }: {
    required: boolean;
    taskPath: string;
    readyStatus: string;
    emptyStatus: string;
    decisionsPath: string;
    applyReportPath?: string;
    applyReportPaths?: string[] | null;
  }): PhaseStatus {
    if (!required) {
      return { status: "not_required", required: false };
    }
    const task = artifactStatus(taskPath);
    if (!task.exists) {
      return { status: "needs_task_build", required: true, task };
    }
    if (task.status === emptyStatus) {
      return { status: "completed_no_actions", required: true, task };
    }
    if (task.status !== readyStatus) {
      return { status: "blocked_task_not_ready", required: true, task };
    }
    const decisions = aiRowsFileStatus(decisionsPath, {
      requireCompletedDecision: true,
    });
    if (decisions.status !== "ready_for_apply") {
      return {
        status: "ready_for_ai_decisions",
        required: true,
        task,
        decisions,
      };
    }
    const applyReports = (applyReportPaths ?? [applyReportPath]).map(authoringPlanApplyStatus);
    if (!applyReports.every((report) => report.completed)) {
      return {
        status: "needs_deterministic_apply",
        required: true,
        task,
        decisions,
        apply_report: applyReports.length === 1 ? applyReports[0] : null,
        apply_reports: applyReports,
      };
    }
    return {
      status: "completed",
      required: true,
      task,
      decisions,
      apply_report: applyReports.length === 1 ? applyReports[0] : null,
      apply_reports: applyReports,
    };
  }

  function phaseStatusFromPatchAuthoring({
    required,
    manifestPath,
    patchCollectReportPath,
    patchApplyReportPath,
  }: {
    required: boolean;
    manifestPath: string;
    patchCollectReportPath: string;
    patchApplyReportPath: string;
  }): PhaseStatus {
    if (!required) {
      return { status: "not_required", required: false };
    }
    const manifest = artifactStatus(manifestPath);
    if (!manifest.exists) {
      return { status: "needs_task_build", required: true, manifest };
    }
    if (manifest.status === "ready_no_action_items") {
      return { status: "completed_no_actions", required: true, manifest };
    }
    if (manifest.status !== "ready_for_ai_authoring_batch") {
      return { status: "blocked_task_not_ready", required: true, manifest };
    }
    const collect = artifactStatus(patchCollectReportPath);
    if (!collect.exists || collect.status === "blocked") {
      return {
        status: "ready_for_ai_patches",
        required: true,
        manifest,
        patch_collect_report: collect,
      };
    }
    if (collect.status !== "ready_for_patch_apply") {
      return {
        status: "blocked_patch_collect_not_ready",
        required: true,
        manifest,
        patch_collect_report: collect,
      };
    }
    const applyReport = authoringPlanApplyStatus(patchApplyReportPath);
    if (!applyReport.completed) {
      return {
        status: "needs_deterministic_apply",
        required: true,
        manifest,
        patch_collect_report: collect,
        patch_apply_report: applyReport,
      };
    }
    return {
      status: "completed",
      required: true,
      manifest,
      patch_collect_report: collect,
      patch_apply_report: applyReport,
    };
  }

  function authoringPlanOverallStatus(phases: PhaseLike[]): string {
    const required = phases.filter((phase) => phase.required);
    if (required.length === 0) return "ready_no_authoring_actions";
    if (required.some((phase) => phase.status === "blocked_task_not_ready")) {
      return "blocked_task_not_ready";
    }
    if (required.some((phase) => phase.status === "blocked_patch_collect_not_ready")) {
      return "blocked_patch_collect_not_ready";
    }
    if (required.some((phase) => phase.status === "needs_task_build")) {
      return "needs_task_build";
    }
    if (
      required.some((phase) =>
        ["ready_for_ai_decisions", "ready_for_ai_patches"].includes(phase.status),
      )
    ) {
      return "ready_for_ai_authoring";
    }
    if (required.some((phase) => phase.status === "needs_deterministic_apply")) {
      return "needs_deterministic_apply";
    }
    return "ready_for_post_authoring_finalize";
  }

  function authoringPlanChunkSize(options: LooseRecord, kind: string): number {
    return (
      positiveIntegerOption(options[`${kind}ChunkSize`], null) ??
      positiveIntegerOption(options.decisionChunkSize, null) ??
      25
    );
  }

  function authoringPlanDecisionRows(taskPath: string, key: string): LooseRecord[] {
    const task = existingArtifact(taskPath)?.value;
    return ensureArray(task?.[key]);
  }

  function groupedRowsByDatasetType(rows: LooseRecord[]) {
    const groups = new Map<string, LooseRecord[]>();
    for (const row of rows) {
      const datasetType = asText(row?.dataset_type) || "all";
      const current = groups.get(datasetType) ?? [];
      current.push(row);
      groups.set(datasetType, current);
    }
    return [...groups.entries()].map(([datasetType, groupRows]) => ({
      dataset_type: datasetType,
      rows: groupRows,
    }));
  }

  function authoringPlanDecisionChunkPlan({
    kind,
    rows,
    chunkSize,
    buildArgsForChunk,
  }: {
    kind: string;
    rows: LooseRecord[];
    chunkSize: number;
    buildArgsForChunk: (args: ChunkBuildArgs) => unknown[];
  }) {
    if (rows.length === 0) {
      return {
        recommended: false,
        chunk_size: chunkSize,
        chunks: 0,
        commands: [],
      };
    }
    const commands: Array<Record<string, unknown>> = [];
    for (const group of groupedRowsByDatasetType(rows)) {
      for (let offset = 0; offset < group.rows.length; offset += chunkSize) {
        const selectedRows = group.rows.slice(offset, offset + chunkSize);
        const chunkLabel = safeFileToken(
          `${kind}-${group.dataset_type}-${offset}-${offset + selectedRows.length}`,
          `${kind}-chunk-${commands.length + 1}`,
        );
        commands.push({
          dataset_type: group.dataset_type,
          offset,
          limit: chunkSize,
          selected_rows: selectedRows.length,
          chunk_label: chunkLabel,
          command: foundryCommand(
            buildArgsForChunk({
              datasetType: group.dataset_type,
              offset,
              limit: chunkSize,
              chunkLabel,
            }),
          ),
        });
      }
    }
    return {
      recommended: rows.length > chunkSize,
      chunk_size: chunkSize,
      rows: rows.length,
      chunks: commands.length,
      commands,
    };
  }

  function authoringPlanIdentityDatasetTypes(
    taskPath: string,
    curationGateReport: LooseRecord,
  ): string[] {
    const task = existingArtifact(taskPath)?.value;
    const taskTypes = normalizedList(task?.dataset_types ?? task?.datasetTypes);
    if (taskTypes.length > 0) return taskTypes;
    const reportType = asText(curationGateReport?.dataset_type);
    return reportType ? [reportType] : ["<flow-or-process>"];
  }

  function authoringPlanRowsFileForDatasetType(
    datasetType: unknown,
    workspaceDir: string,
    curationGateReport: LooseRecord,
  ): string {
    const reportType = asText(curationGateReport?.dataset_type).toLowerCase();
    const normalizedType = asText(datasetType).toLowerCase();
    if (normalizedType && normalizedType === reportType && curationGateReport?.rows_file) {
      return curationGateReport.rows_file as unknown as string;
    }
    const queueManifest = existingArtifact(
      curationGateReport?.context?.curation_queue?.manifest_file,
    )?.value;
    const queueInput = asText(
      {
        process: queueManifest?.inputs?.processes,
        flow: queueManifest?.inputs?.flows,
        support: ensureArray(queueManifest?.inputs?.support)[0],
      }[normalizedType],
    );
    if (queueInput) {
      const resolved = resolveRepoPath(queueInput);
      return resolved ? repoRelativePath(resolved) : queueInput;
    }
    if (!normalizedType || normalizedType.startsWith("<")) {
      return "<rows-file-containing-identity-targets>";
    }
    return repoRelativePath(
      path.join(workspaceDir, "rows", `${datasetRowsFileStem(normalizedType)}.jsonl`),
    );
  }

  function authoringPlanAuthoringPackageDir(curationGateReport: LooseRecord): string | null {
    const packageDirs = unique(
      ensureArray(
        curationGateReport?.entities ??
          curationGateReport?.processes ??
          curationGateReport?.flows ??
          curationGateReport?.items,
      )
        .map((entity) => asText(entity?.authoring_package ?? entity?.authoringPackage))
        .filter(Boolean)
        .map((packageRef) => path.dirname(packageRef)),
    );
    return packageDirs.length === 1 ? packageDirs[0] : null;
  }

  function authoringPlanIdentityApplyReports(
    workspaceDir: string,
    datasetTypes: string[],
    explicitReportPath: string | null,
  ): string[] {
    if (explicitReportPath && datasetTypes.length <= 1) return [explicitReportPath];
    if (datasetTypes.length <= 1) {
      return [
        path.join(workspaceDir, "identity-decision-apply", "identity-decisions-apply-report.json"),
      ];
    }
    return datasetTypes.map((datasetType) =>
      path.join(
        workspaceDir,
        "identity-decision-apply",
        datasetType,
        "identity-decisions-apply-report.json",
      ),
    );
  }

  function authoringPlanIdentityApplyCommands({
    workspaceDir,
    curationGateReport,
    datasetTypes,
    decisionsPath,
    applyReportPaths,
    authoringPackageDir,
  }: {
    workspaceDir: string;
    curationGateReport: LooseRecord;
    datasetTypes: string[];
    decisionsPath: string;
    applyReportPaths: string[];
    authoringPackageDir: string | null;
  }): IdentityApplyCommand[] {
    return datasetTypes.map((datasetType, index) => {
      const reportPath = applyReportPaths[index];
      const rowsFile = authoringPlanRowsFileForDatasetType(
        datasetType,
        workspaceDir,
        curationGateReport,
      );
      const args = [
        "dataset-identity-decisions-apply",
        "--type",
        datasetType,
        "--rows-file",
        rowsFile,
        "--decisions",
        decisionsPath,
        "--out-dir",
        path.dirname(reportPath),
      ];
      appendOption(args, "--authoring-package-dir", authoringPackageDir);
      return {
        dataset_type: datasetType,
        rows_file: rowsFile,
        authoring_package_dir: authoringPackageDir,
        command: foundryCommand(args),
      };
    });
  }

  function authoringPlanRowsFileRef(fileRef: unknown): string | null {
    const text = asText(fileRef);
    if (!text) return null;
    const resolved = resolveRepoPath(text);
    return resolved ? repoRelativePath(resolved) : text;
  }

  function authoringPlanRowsFiles(values: unknown): string[] {
    return unique(
      ensureArray(values)
        .flatMap((value) => ensureArray(value))
        .map(authoringPlanRowsFileRef)
        .filter((value): value is string => Boolean(value)),
    );
  }

  function authoringPlanSingleRowsFile(values: unknown): string | null {
    const rowsFiles = authoringPlanRowsFiles(values);
    return rowsFiles.length === 1 ? rowsFiles[0] : null;
  }

  function authoringPlanCompletedOutputRows(reportPath: string, kind: string): string[] {
    const artifact = existingArtifact(reportPath);
    if (!artifact || (artifact.value.status as unknown as string) !== "completed") return [];
    const report = artifact.value;
    if (kind === "patch") {
      return authoringPlanRowsFiles([
        report.files?.output_rows,
        report.files?.patched_rows,
        report.output_rows,
        report.out_path,
      ]);
    }
    return authoringPlanRowsFiles([report.files?.output_rows, report.output_rows]);
  }

  function authoringPlanPlannedTransformOutputRows(
    currentRows: string,
    reportPath: string,
    suffix: string,
  ): string | null {
    const resolvedReport = resolveRepoPath(reportPath);
    const resolvedCurrentRows = resolveRepoPath(currentRows);
    if (!resolvedReport || !resolvedCurrentRows) return null;
    const inputBase = path.basename(resolvedCurrentRows).replace(/\.(jsonl|json)$/iu, "");
    return repoRelativePath(
      path.join(path.dirname(resolvedReport), "rows", `${inputBase}.${suffix}.jsonl`),
    );
  }

  function authoringPlanPlannedPatchOutputRows(
    currentRows: string,
    patchApplyReportPath: string,
  ): string | null {
    return authoringPlanPlannedTransformOutputRows(currentRows, patchApplyReportPath, "patched");
  }

  function authoringPlanPlannedIdentityOutputRows(
    identityApplyReportPath: string,
    datasetType: unknown,
  ): string | null {
    const resolvedReport = resolveRepoPath(identityApplyReportPath);
    const normalizedType = asText(datasetType);
    if (!resolvedReport || !normalizedType) return null;
    return repoRelativePath(
      path.join(
        path.dirname(resolvedReport),
        `${datasetRowsFileStem(normalizedType)}.identity-decisions-applied.jsonl`,
      ),
    );
  }

  function authoringPlanChainedClassificationCommand({
    queue,
    decisionsPath,
    taskPath,
    inputRows,
    outputRows,
    reportPath,
  }: {
    queue: string;
    decisionsPath: string;
    taskPath: string;
    inputRows: string | null;
    outputRows: string | null;
    reportPath: string;
  }): string | null {
    if (!inputRows || !outputRows) return null;
    return foundryCommand([
      "dataset-classification-decisions-apply",
      "--classification-queue",
      queue,
      "--decisions",
      decisionsPath,
      "--decision-task",
      taskPath,
      "--rows-file",
      inputRows,
      "--out",
      outputRows,
      "--out-dir",
      path.dirname(reportPath),
    ]);
  }

  function authoringPlanChainedLocationCommand({
    queue,
    decisionsPath,
    taskPath,
    inputRows,
    outputRows,
    reportPath,
  }: {
    queue: string;
    decisionsPath: string;
    taskPath: string;
    inputRows: string | null;
    outputRows: string | null;
    reportPath: string;
  }): string | null {
    if (!inputRows || !outputRows) return null;
    return foundryCommand([
      "dataset-location-decisions-apply",
      "--location-queue",
      queue,
      "--decisions",
      decisionsPath,
      "--decision-task",
      taskPath,
      "--rows-file",
      inputRows,
      "--out",
      outputRows,
      "--out-dir",
      path.dirname(reportPath),
    ]);
  }

  function authoringPlanChainedPatchCommand({
    manifestPath,
    patchApplyReportPath,
    authoringPackageDir,
    inputRows,
    outputRows,
  }: {
    manifestPath: string;
    patchApplyReportPath: string;
    authoringPackageDir: string | null;
    inputRows: string | null;
    outputRows: string | null;
  }): string | null {
    const manifest = existingArtifact(manifestPath)?.value;
    const patchFile = authoringPlanRowsFileRef(
      manifest?.batch_patch_contract?.output_patch_file ||
        path.join(path.dirname(resolveRepoPath(manifestPath)), "ai-patches.batch.json"),
    );
    if (!inputRows || !outputRows || !patchFile || !authoringPackageDir) return null;
    return foundryCommand([
      "dataset-patch-apply",
      "--input",
      inputRows,
      "--patch",
      patchFile,
      "--out",
      outputRows,
      "--out-dir",
      path.dirname(patchApplyReportPath),
      "--authoring-package-dir",
      authoringPackageDir,
      "--require-authoring-package",
      "--require-action-item-closure",
    ]);
  }

  function authoringPlanChainedIdentityCommands({
    datasetTypes,
    decisionsPath,
    applyReportPaths,
    authoringPackageDir,
    inputRows,
  }: {
    datasetTypes: string[];
    decisionsPath: string;
    applyReportPaths: string[];
    authoringPackageDir: string | null;
    inputRows: string | null;
  }): IdentityApplyCommand[] {
    if (!inputRows || datasetTypes.length !== 1) return [];
    return datasetTypes.map((datasetType, index) => {
      const reportPath = applyReportPaths[index];
      const args = [
        "dataset-identity-decisions-apply",
        "--type",
        datasetType,
        "--rows-file",
        inputRows,
        "--decisions",
        decisionsPath,
        "--out-dir",
        path.dirname(reportPath),
      ];
      appendOption(args, "--authoring-package-dir", authoringPackageDir);
      return {
        dataset_type: datasetType,
        rows_file: inputRows,
        authoring_package_dir: authoringPackageDir,
        output_rows: authoringPlanPlannedIdentityOutputRows(reportPath, datasetType),
        command: foundryCommand(args),
      };
    });
  }

  function authoringPlanRowsChain({
    baseRows,
    classificationPhase,
    classificationApplyReportPath,
    classificationApplyQueue,
    classificationDecisionsPath,
    classificationTaskPath,
    locationPhase,
    locationApplyReportPath,
    locationApplyQueue,
    locationDecisionsPath,
    locationTaskPath,
    patchPhase,
    authoringTaskManifestPath,
    patchApplyReportPath,
    authoringPackageDir,
    identityPhase,
    identityDatasetTypes,
    identityDecisionsPath,
    identityApplyReportPaths,
  }: {
    baseRows: unknown;
    classificationPhase: PhaseLike;
    classificationApplyReportPath: string;
    classificationApplyQueue: string;
    classificationDecisionsPath: string;
    classificationTaskPath: string;
    locationPhase: PhaseLike;
    locationApplyReportPath: string;
    locationApplyQueue: string;
    locationDecisionsPath: string;
    locationTaskPath: string;
    patchPhase: PhaseLike;
    authoringTaskManifestPath: string;
    patchApplyReportPath: string;
    authoringPackageDir: string | null;
    identityPhase: PhaseLike;
    identityDatasetTypes: string[];
    identityDecisionsPath: string;
    identityApplyReportPaths: string[];
  }) {
    let currentRows = authoringPlanRowsFileRef(baseRows);
    const steps: Array<Record<string, unknown>> = [];
    const commands: Record<string, Record<string, unknown>> = {};
    const blockers: Array<Record<string, unknown>> = [];
    const pending: Array<Record<string, unknown>> = [];

    function requireCurrentRows(phase: string): boolean {
      if (currentRows) return true;
      blockers.push({
        code: "authoring_rows_chain_current_rows_missing",
        phase,
        message: "Cannot build chained apply commands without a current rows file.",
      });
      return false;
    }

    function recordNoChange(phase: string, status: string): void {
      steps.push({
        phase,
        status,
        required: false,
        input_rows: currentRows,
        output_rows: currentRows,
        command: null,
      });
    }

    function recordTransformStep({
      phaseName,
      phase,
      reportPath,
      outputSuffix,
      outputKind,
      buildCommand,
    }: {
      phaseName: string;
      phase: PhaseLike;
      reportPath: string;
      outputSuffix: string;
      outputKind: string;
      buildCommand: (rows: { inputRows: string; outputRows: string | null }) => string | null;
    }): void {
      if (!phase.required) {
        recordNoChange(phaseName, phase.status);
        return;
      }
      if (["completed_no_actions", "not_required"].includes(phase.status)) {
        recordNoChange(phaseName, phase.status);
        return;
      }
      const inputRows = currentRows!;
      if (!requireCurrentRows(phaseName)) return;
      if (phase.status === "completed") {
        const outputRows = authoringPlanSingleRowsFile(
          authoringPlanCompletedOutputRows(reportPath, outputKind),
        );
        if (!outputRows) {
          blockers.push({
            code: "authoring_rows_chain_output_rows_ambiguous",
            phase: phaseName,
            report: repoRelativeMaybe(reportPath),
            message: "Completed apply report must expose exactly one output rows file.",
          });
          return;
        }
        steps.push({
          phase: phaseName,
          status: phase.status,
          required: true,
          input_rows: inputRows,
          output_rows: outputRows,
          report: repoRelativeMaybe(reportPath),
          command: null,
        });
        currentRows = outputRows;
        return;
      }
      if (phase.status === "needs_deterministic_apply") {
        const outputRows =
          outputKind === "patch"
            ? authoringPlanPlannedPatchOutputRows(inputRows, reportPath)
            : authoringPlanPlannedTransformOutputRows(inputRows, reportPath, outputSuffix);
        const command = buildCommand({ inputRows, outputRows });
        if (!outputRows || !command) {
          blockers.push({
            code: "authoring_rows_chain_command_unavailable",
            phase: phaseName,
            message: "The authoring plan could not build a safe chained apply command.",
          });
          return;
        }
        steps.push({
          phase: phaseName,
          status: phase.status,
          required: true,
          input_rows: inputRows,
          output_rows: outputRows,
          report: repoRelativeMaybe(reportPath),
          command,
        });
        commands[phaseName] = { command, input_rows: inputRows, output_rows: outputRows };
        currentRows = outputRows;
        return;
      }
      pending.push({
        phase: phaseName,
        status: phase.status,
      });
      steps.push({
        phase: phaseName,
        status: phase.status,
        required: true,
        input_rows: inputRows,
        output_rows: null,
        command: null,
      });
    }

    recordTransformStep({
      phaseName: "classification_decisions",
      phase: classificationPhase,
      reportPath: classificationApplyReportPath,
      outputSuffix: "classified",
      outputKind: "decision",
      buildCommand: ({ inputRows, outputRows }) =>
        authoringPlanChainedClassificationCommand({
          queue: classificationApplyQueue,
          decisionsPath: classificationDecisionsPath,
          taskPath: classificationTaskPath,
          inputRows,
          outputRows,
          reportPath: classificationApplyReportPath,
        }),
    });
    recordTransformStep({
      phaseName: "location_decisions",
      phase: locationPhase,
      reportPath: locationApplyReportPath,
      outputSuffix: "located",
      outputKind: "decision",
      buildCommand: ({ inputRows, outputRows }) =>
        authoringPlanChainedLocationCommand({
          queue: locationApplyQueue,
          decisionsPath: locationDecisionsPath,
          taskPath: locationTaskPath,
          inputRows,
          outputRows,
          reportPath: locationApplyReportPath,
        }),
    });
    recordTransformStep({
      phaseName: "field_patches",
      phase: patchPhase,
      reportPath: patchApplyReportPath,
      outputSuffix: "patched",
      outputKind: "patch",
      buildCommand: ({ inputRows, outputRows }) =>
        authoringPlanChainedPatchCommand({
          manifestPath: authoringTaskManifestPath,
          patchApplyReportPath,
          authoringPackageDir,
          inputRows,
          outputRows,
        }),
    });

    if (identityPhase.required) {
      const inputRows = currentRows;
      if (requireCurrentRows("identity_decisions")) {
        if (identityPhase.status === "completed") {
          const outputs = identityApplyReportPaths.flatMap((reportPath) =>
            authoringPlanCompletedOutputRows(reportPath, "decision"),
          );
          const outputRows = authoringPlanSingleRowsFile(outputs);
          if (!outputRows) {
            blockers.push({
              code: "authoring_rows_chain_output_rows_ambiguous",
              phase: "identity_decisions",
              message: "Completed identity apply reports must expose exactly one output rows file.",
            });
          } else {
            steps.push({
              phase: "identity_decisions",
              status: identityPhase.status,
              required: true,
              input_rows: inputRows,
              output_rows: outputRows,
              reports: identityApplyReportPaths.map(repoRelativeMaybe),
              command: null,
            });
            currentRows = outputRows;
          }
        } else if (identityPhase.status === "needs_deterministic_apply") {
          const chainedCommands = authoringPlanChainedIdentityCommands({
            datasetTypes: identityDatasetTypes,
            decisionsPath: identityDecisionsPath,
            applyReportPaths: identityApplyReportPaths,
            authoringPackageDir,
            inputRows,
          });
          const outputRows = authoringPlanSingleRowsFile(
            chainedCommands.map((command) => command.output_rows),
          );
          if (chainedCommands.length !== 1 || !outputRows) {
            blockers.push({
              code: "authoring_rows_chain_identity_command_unavailable",
              phase: "identity_decisions",
              dataset_types: identityDatasetTypes,
              message:
                "Chained identity apply currently requires one dataset type and one current rows file.",
            });
          } else {
            steps.push({
              phase: "identity_decisions",
              status: identityPhase.status,
              required: true,
              input_rows: inputRows,
              output_rows: outputRows,
              reports: identityApplyReportPaths.map(repoRelativeMaybe),
              commands: chainedCommands,
            });
            commands.identity_decisions = {
              commands: chainedCommands,
              input_rows: inputRows,
              output_rows: outputRows,
            };
            currentRows = outputRows;
          }
        } else {
          pending.push({
            phase: "identity_decisions",
            status: identityPhase.status,
          });
          steps.push({
            phase: "identity_decisions",
            status: identityPhase.status,
            required: true,
            input_rows: inputRows,
            output_rows: null,
            command: null,
          });
        }
      }
    } else {
      recordNoChange("identity_decisions", identityPhase.status);
    }

    return {
      status:
        blockers.length > 0
          ? "blocked_ambiguous_rows_chain"
          : pending.length > 0
            ? "waiting_for_prior_phase_completion"
            : steps.some((step) => step.command || step.commands)
              ? "needs_deterministic_apply"
              : "ready",
      order: [
        "classification_decisions",
        "location_decisions",
        "field_patches",
        "identity_decisions",
      ],
      base_rows: authoringPlanRowsFileRef(baseRows),
      current_rows: currentRows,
      pending,
      blockers,
      commands,
      steps,
      instruction:
        "Run chained commands in order and rerun dataset-authoring-plan after each deterministic apply. Downstream phases must use the previous step's output rows.",
    };
  }

  function runDatasetAuthoringPlan(options: LooseRecord) {
    if (options.help) {
      return {
        schema_version: 1,
        status: "help",
        command: "dataset-authoring-plan",
        usage: [
          "node scripts/foundry.mjs dataset-authoring-plan --curation-gate-report <dataset-curation-gate-report.json> --out-dir <plan-dir>",
        ],
        purpose:
          "Summarize the next required AI authoring, deterministic apply, and post-authoring validation steps from a Foundry curation gate report. This command never writes the database.",
        ...authoringPlanStageContract,
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
    const curationGateReport = readJson(curationGateReportPath);
    const workspaceDir = authoringPlanWorkspaceDir(curationGateReportPath, options);
    const defaults = authoringPlanDefaultPaths(workspaceDir);
    const outDir = resolveRepoPath(options.outDir || path.join(workspaceDir, "authoring-plan"));
    const contextPaths = authoringPlanContextPaths(curationGateReport);
    const classificationQueue = asText(
      curationGateReport?.context?.classification_queue?.queue_file,
    );
    const locationQueue = asText(curationGateReport?.context?.location_queue?.queue_file);
    const counts = curationGateReport.counts ?? {};
    const gateScope = authoringPlanGateScope(curationGateReport);
    const classificationRows = Number(
      counts.classification_queue_action_items ??
        curationGateReport?.context?.classification_queue?.rows ??
        0,
    );
    const locationRows = Number(
      counts.location_queue_action_items ?? curationGateReport?.context?.location_queue?.rows ?? 0,
    );
    const identityActionItems = Number(counts.identity_action_items ?? 0);
    const fieldActionItems = Math.max(
      0,
      Number(counts.action_items ?? 0) -
        identityActionItems -
        Number(counts.classification_queue_action_items ?? 0) -
        Number(counts.location_queue_action_items ?? 0),
    );

    const identityTaskPath = resolveRepoPath(
      options.identityDecisionTask || options.identityTask || defaults.identityTask,
    );
    const identityDecisionsPath = resolveRepoPath(
      options.identityDecisions || defaults.identityDecisions,
    );
    const explicitIdentityApplyReportPath = resolveRepoPath(
      options.identityDecisionApplyReport || options.identityApplyReport,
    );
    const classificationTaskPath = resolveRepoPath(
      options.classificationDecisionTask ||
        options.classificationTask ||
        defaults.classificationTask,
    );
    const classificationDecisionsPath = resolveRepoPath(
      options.classificationDecisions || defaults.classificationDecisions,
    );
    const classificationApplyReportPath = resolveRepoPath(
      options.classificationDecisionApplyReport ||
        options.classificationApplyReport ||
        defaults.classificationApplyReport,
    );
    const locationTaskPath = resolveRepoPath(
      options.locationDecisionTask || options.locationTask || defaults.locationTask,
    );
    const locationDecisionsPath = resolveRepoPath(
      options.locationDecisions || defaults.locationDecisions,
    );
    const locationApplyReportPath = resolveRepoPath(
      options.locationDecisionApplyReport ||
        options.locationApplyReport ||
        defaults.locationApplyReport,
    );
    const authoringTaskManifestPath = resolveRepoPath(
      options.authoringTaskManifest || options.taskManifest || defaults.authoringTaskManifest,
    );
    const patchCollectReportPath = resolveRepoPath(
      options.patchCollectReport || defaults.patchCollectReport,
    );
    const patchApplyReportPath = resolveRepoPath(
      options.patchApplyReport || defaults.patchApplyReport,
    );
    const identityDatasetTypes = authoringPlanIdentityDatasetTypes(
      identityTaskPath,
      curationGateReport,
    );
    const identityApplyReportPaths = authoringPlanIdentityApplyReports(
      workspaceDir,
      identityDatasetTypes,
      explicitIdentityApplyReportPath,
    );
    const authoringPackageDir = authoringPlanAuthoringPackageDir(curationGateReport);
    const identityApplyCommands = authoringPlanIdentityApplyCommands({
      workspaceDir,
      curationGateReport,
      datasetTypes: identityDatasetTypes,
      decisionsPath: identityDecisionsPath,
      applyReportPaths: identityApplyReportPaths,
      authoringPackageDir,
    });
    const identityChunkSize = authoringPlanChunkSize(options, "identity");
    const classificationChunkSize = authoringPlanChunkSize(options, "classification");
    const locationChunkSize = authoringPlanChunkSize(options, "location");
    const sharedContextCacheDir = resolveRepoPath(
      options.sharedContextCacheDir ||
        options.contextCacheDir ||
        path.join(workspaceDir, "shared-context-cache"),
    );
    const sharedContextCacheDirRef = repoRelativePath(sharedContextCacheDir);

    const identityBuildArgs = [
      "dataset-identity-decision-task-build",
      "--curation-gate-report",
      curationGateReportPath,
      "--shared-context-cache-dir",
      sharedContextCacheDirRef,
      "--out-dir",
      path.dirname(identityTaskPath),
    ];

    const classificationBuildArgs = [
      "dataset-classification-decision-task-build",
      "--classification-queue",
      classificationQueue || "<classification-authoring-queue.jsonl>",
    ];
    appendAuthoringPlanGateScopeOptions(classificationBuildArgs, gateScope);
    appendContextOptions(classificationBuildArgs, contextPaths);
    appendOption(classificationBuildArgs, "--shared-context-cache-dir", sharedContextCacheDirRef);
    classificationBuildArgs.push("--out-dir", path.dirname(classificationTaskPath));

    const locationBuildArgs = [
      "dataset-location-decision-task-build",
      "--location-queue",
      locationQueue || "<location-authoring-queue.jsonl>",
    ];
    appendAuthoringPlanGateScopeOptions(locationBuildArgs, gateScope);
    appendContextOptions(locationBuildArgs, contextPaths);
    appendOption(locationBuildArgs, "--shared-context-cache-dir", sharedContextCacheDirRef);
    locationBuildArgs.push("--out-dir", path.dirname(locationTaskPath));
    const classificationApplyQueue = authoringPlanScopedDecisionQueuePath({
      taskPath: classificationTaskPath,
      taskQueueKey: "classification_queue",
      originalQueue: classificationQueue || "<classification-authoring-queue.jsonl>",
      scope: gateScope,
      kind: "classification",
    });
    const locationApplyQueue = authoringPlanScopedDecisionQueuePath({
      taskPath: locationTaskPath,
      taskQueueKey: "location_queue",
      originalQueue: locationQueue || "<location-authoring-queue.jsonl>",
      scope: gateScope,
      kind: "location",
    });
    const scopedApplyRowsFile = gateScope.dataset_type
      ? authoringPlanRowsFileForDatasetType(
          gateScope.dataset_type,
          workspaceDir,
          curationGateReport,
        )
      : null;

    const identityPhase: MutablePhase = {
      phase: "identity_decisions",
      action_items: identityActionItems,
      ...phaseStatusFromTaskDecision({
        required: identityActionItems > 0,
        taskPath: identityTaskPath,
        readyStatus: "ready_for_ai_identity_decisions",
        emptyStatus: "ready_no_identity_actions",
        decisionsPath: identityDecisionsPath,
        applyReportPaths: identityApplyReportPaths,
      }),
      dataset_types: identityDatasetTypes,
      chunk_plan: authoringPlanDecisionChunkPlan({
        kind: "identity",
        rows: authoringPlanDecisionRows(identityTaskPath, "identity_action_items"),
        chunkSize: identityChunkSize,
        buildArgsForChunk: ({ datasetType, offset, limit, chunkLabel }) => [
          "dataset-identity-decision-task-build",
          "--curation-gate-report",
          curationGateReportPath,
          "--dataset-type",
          datasetType,
          "--limit",
          limit,
          "--offset",
          offset,
          "--chunk-label",
          chunkLabel,
          "--shared-context-cache-dir",
          sharedContextCacheDirRef,
          "--out-dir",
          path.join(path.dirname(identityTaskPath), "chunks", chunkLabel),
        ],
      }),
      commands: {
        build_task: foundryCommand(identityBuildArgs),
        apply_decisions:
          identityApplyCommands.length === 1 ? identityApplyCommands[0].command : null,
        apply_decisions_by_type: identityApplyCommands,
      },
    };
    const classificationPhase: MutablePhase = {
      phase: "classification_decisions",
      queue_rows: classificationRows,
      ...phaseStatusFromTaskDecision({
        required: classificationRows > 0,
        taskPath: classificationTaskPath,
        readyStatus: "ready_for_ai_classification_decisions",
        emptyStatus: "ready_no_classification_actions",
        decisionsPath: classificationDecisionsPath,
        applyReportPath: classificationApplyReportPath,
      }),
      chunk_plan: authoringPlanDecisionChunkPlan({
        kind: "classification",
        rows: authoringPlanDecisionRows(classificationTaskPath, "classification_queue_rows"),
        chunkSize: classificationChunkSize,
        buildArgsForChunk: ({ datasetType, offset, limit, chunkLabel }) => {
          const args = [
            "dataset-classification-decision-task-build",
            "--classification-queue",
            classificationQueue || "<classification-authoring-queue.jsonl>",
            "--dataset-type",
            datasetType,
            "--limit",
            limit,
            "--offset",
            offset,
            "--chunk-label",
            chunkLabel,
          ];
          appendContextOptions(args, contextPaths);
          appendOption(args, "--shared-context-cache-dir", sharedContextCacheDirRef);
          args.push(
            "--out-dir",
            path.join(path.dirname(classificationTaskPath), "chunks", chunkLabel),
          );
          return args;
        },
      }),
      commands: {
        build_task: foundryCommand(classificationBuildArgs),
        apply_decisions: foundryCommand([
          "dataset-classification-decisions-apply",
          "--classification-queue",
          classificationApplyQueue,
          "--decisions",
          classificationDecisionsPath,
          "--decision-task",
          classificationTaskPath,
          ...(scopedApplyRowsFile ? ["--rows-file", scopedApplyRowsFile] : []),
          "--out-dir",
          path.dirname(classificationApplyReportPath),
        ]),
      },
    };
    const locationPhase: MutablePhase = {
      phase: "location_decisions",
      queue_rows: locationRows,
      ...phaseStatusFromTaskDecision({
        required: locationRows > 0,
        taskPath: locationTaskPath,
        readyStatus: "ready_for_ai_location_decisions",
        emptyStatus: "ready_no_location_actions",
        decisionsPath: locationDecisionsPath,
        applyReportPath: locationApplyReportPath,
      }),
      chunk_plan: authoringPlanDecisionChunkPlan({
        kind: "location",
        rows: authoringPlanDecisionRows(locationTaskPath, "location_queue_rows"),
        chunkSize: locationChunkSize,
        buildArgsForChunk: ({ datasetType, offset, limit, chunkLabel }) => {
          const args = [
            "dataset-location-decision-task-build",
            "--location-queue",
            locationQueue || "<location-authoring-queue.jsonl>",
            "--dataset-type",
            datasetType,
            "--limit",
            limit,
            "--offset",
            offset,
            "--chunk-label",
            chunkLabel,
          ];
          appendContextOptions(args, contextPaths);
          appendOption(args, "--shared-context-cache-dir", sharedContextCacheDirRef);
          args.push("--out-dir", path.join(path.dirname(locationTaskPath), "chunks", chunkLabel));
          return args;
        },
      }),
      commands: {
        build_task: foundryCommand(locationBuildArgs),
        apply_decisions: foundryCommand([
          "dataset-location-decisions-apply",
          "--location-queue",
          locationApplyQueue,
          "--decisions",
          locationDecisionsPath,
          "--decision-task",
          locationTaskPath,
          ...(scopedApplyRowsFile ? ["--rows-file", scopedApplyRowsFile] : []),
          "--out-dir",
          path.dirname(locationApplyReportPath),
        ]),
      },
    };
    const patchPhase: MutablePhase = {
      phase: "field_patches",
      action_items: fieldActionItems,
      ...phaseStatusFromPatchAuthoring({
        required: fieldActionItems > 0,
        manifestPath: authoringTaskManifestPath,
        patchCollectReportPath,
        patchApplyReportPath,
      }),
      commands: {
        build_task: foundryCommand([
          "dataset-authoring-task-build",
          "--curation-gate-report",
          curationGateReportPath,
          "--shared-context-cache-dir",
          sharedContextCacheDirRef,
          "--out-dir",
          path.dirname(authoringTaskManifestPath),
        ]),
        collect_patches: foundryCommand([
          "dataset-authoring-patch-collect",
          "--task-manifest",
          authoringTaskManifestPath,
        ]),
        apply_patches:
          existingArtifact(authoringTaskManifestPath)?.value?.commands?.apply_all_patches ?? null,
      },
    };
    const phases = [identityPhase, classificationPhase, locationPhase, patchPhase];
    const rowsChain = authoringPlanRowsChain({
      baseRows: scopedApplyRowsFile || curationGateReport.rows_file,
      classificationPhase,
      classificationApplyReportPath,
      classificationApplyQueue,
      classificationDecisionsPath,
      classificationTaskPath,
      locationPhase,
      locationApplyReportPath,
      locationApplyQueue,
      locationDecisionsPath,
      locationTaskPath,
      patchPhase,
      authoringTaskManifestPath,
      patchApplyReportPath,
      authoringPackageDir,
      identityPhase,
      identityDatasetTypes,
      identityDecisionsPath,
      identityApplyReportPaths,
    });
    const chainedClassification = rowsChain.commands.classification_decisions as
      { command?: string } | undefined;
    if (chainedClassification?.command) {
      classificationPhase.commands.apply_decisions = chainedClassification.command;
    }
    const chainedLocation = rowsChain.commands.location_decisions as
      { command?: string } | undefined;
    if (chainedLocation?.command) {
      locationPhase.commands.apply_decisions = chainedLocation.command;
    }
    const manifestPatchApplyCommand = patchPhase.commands.apply_patches;
    if (manifestPatchApplyCommand) {
      patchPhase.commands.apply_patches_manifest = manifestPatchApplyCommand;
    }
    if (rowsChain.commands.field_patches?.command) {
      patchPhase.commands.apply_patches = rowsChain.commands.field_patches.command;
    } else if (
      patchPhase.required &&
      rowsChain.steps.some(
        (step) =>
          ["classification_decisions", "location_decisions"].includes(asText(step.phase)) &&
          step.required &&
          !step.output_rows,
      )
    ) {
      patchPhase.commands.apply_patches = null;
      patchPhase.commands.apply_patches_unavailable_reason =
        "Earlier classification/location phases have not produced a current rows file yet; rerun dataset-authoring-plan after those applies complete.";
    }
    const chainedIdentityGroup = rowsChain.commands.identity_decisions as
      { commands?: IdentityApplyCommand[] } | undefined;
    if ((chainedIdentityGroup?.commands?.length ?? 0) > 0) {
      const chainedIdentityCommands = chainedIdentityGroup!.commands!;
      identityPhase.commands.apply_decisions =
        chainedIdentityCommands.length === 1 ? chainedIdentityCommands[0].command : null;
      identityPhase.commands.apply_decisions_by_type = chainedIdentityCommands;
    }
    const reportPath = path.join(outDir, "dataset-authoring-plan.json");
    const report = {
      schema_version: 1,
      generated_at_utc: nowIso(),
      status: authoringPlanOverallStatus(phases),
      command: "dataset-authoring-plan",
      ...authoringPlanStageContract,
      curation_gate_report: repoRelativePath(curationGateReportPath),
      workspace_dir: repoRelativePath(workspaceDir),
      profile: curationGateReport.profile ?? null,
      dataset_type: curationGateReport.dataset_type ?? null,
      rows_file: curationGateReport.rows_file ?? null,
      counts: {
        action_items: Number(counts.action_items ?? 0),
        identity_action_items: identityActionItems,
        classification_queue_rows: classificationRows,
        location_queue_rows: locationRows,
        field_patch_action_items: fieldActionItems,
        deterministic_cleanup_items: Number(counts.deterministic_cleanup_items ?? 0),
        blockers: 0,
      },
      context: {
        schema_file: contextPaths.schema,
        methodology_yaml: contextPaths.methodology_yaml,
        ruleset_file: contextPaths.ruleset,
        classification_schema_files: contextPaths.classification_schema,
        location_schema_file: contextPaths.location_schema,
        authoring_package_dir: authoringPackageDir,
        shared_context_cache_dir: sharedContextCacheDirRef,
      },
      rows_chain: rowsChain,
      phases,
      blockers: [],
      instructions: [
        "Run any needs_task_build command first; task status must be ready before AI authoring.",
        "AI/Codex/skills must read the task JSON and referenced authoring packages before writing decisions or patches.",
        "When multiple authoring phases touch the same rows, follow rows_chain order and use the chained apply commands so classification/location/patch/identity evidence references one current rows lineage.",
        "Run deterministic apply commands after decisions/patches are completed; do not edit row JSON directly.",
        "After all required phases are completed, rerun Rust tidas validation, deterministic CLI QA, curation gate, post-authoring finalize, mutation manifest, and only then remote write planning.",
      ],
      files: {
        report: repoRelativePath(reportPath),
      },
    };
    fs.mkdirSync(outDir, { recursive: true });
    writeJson(reportPath, report);
    return report;
  }

  return { runDatasetAuthoringPlan };
}

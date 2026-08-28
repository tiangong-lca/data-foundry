import path from "node:path";

type JsonRecord = Record<string, unknown>;

export interface AuthoringTaskFilterAdapter {
  nowIso: () => string;
  resolveRepoPath: (value: unknown) => string | null;
  readJson: (filePath: string) => JsonRecord;
  readRows: (filePath: string | null | undefined) => JsonRecord[];
  writeJson: (filePath: string, value: unknown) => void;
  repoRelative: (filePath: string | null | undefined) => string;
  asText: (value: unknown) => string;
  datasetIdentity: (row: JsonRecord, type: string) => { id: string | null; version: string };
}

export interface FilterAuthoringTaskManifestInput {
  taskManifest: unknown;
  rowsFile: unknown;
  type: string;
  reportPath?: unknown;
}

function jsonRecord(value: unknown): JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

export function createAuthoringTaskFilterService(adapter: AuthoringTaskFilterAdapter) {
  function taskIdentity(task: JsonRecord): { id: string; version: string } {
    const entity = jsonRecord(task.entity);
    return {
      id: adapter.asText(entity.entity_id ?? task.dataset_id ?? task.id),
      version:
        adapter.asText(entity.version ?? task.dataset_version ?? task.version) || "00.00.001",
    };
  }

  function filterAuthoringTaskManifestToRows({
    taskManifest,
    rowsFile,
    type,
    reportPath,
  }: FilterAuthoringTaskManifestInput): JsonRecord {
    const resolvedTaskManifest = adapter.resolveRepoPath(taskManifest);
    const resolvedRowsFile = adapter.resolveRepoPath(rowsFile);
    const resolvedReportPath =
      adapter.resolveRepoPath(reportPath) ||
      path.join(path.dirname(resolvedTaskManifest!), "authoring-task-filter-report.json");
    const manifest = adapter.readJson(resolvedTaskManifest!);
    const rows = adapter.readRows(resolvedRowsFile);
    const retainedKeys = new Set(
      rows
        .map((row) => adapter.datasetIdentity(row, type))
        .filter((identity) => identity.id)
        .map((identity) => `${identity.id}@${identity.version}`),
    );
    const tasks = Array.isArray(manifest.tasks) ? manifest.tasks.map(jsonRecord) : [];
    const retainedTasks: JsonRecord[] = [];
    const skippedTasks: JsonRecord[] = [];
    for (const task of tasks) {
      const identity = taskIdentity(task);
      const key = identity.id ? `${identity.id}@${identity.version}` : "";
      if (key && retainedKeys.has(key)) retainedTasks.push(task);
      else {
        skippedTasks.push({
          dataset_type: jsonRecord(task.entity).dataset_type ?? type,
          dataset_id: identity.id || null,
          dataset_version: identity.version || null,
          reason: "dataset_not_present_after_identity_apply",
        });
      }
    }
    const filtered =
      skippedTasks.length > 0
        ? path.join(
            path.dirname(resolvedTaskManifest!),
            "authoring-task-manifest.current-rows.json",
          )
        : resolvedTaskManifest!;
    if (filtered !== resolvedTaskManifest) {
      adapter.writeJson(filtered, {
        ...manifest,
        tasks: retainedTasks,
        counts: {
          ...jsonRecord(manifest.counts),
          tasks: retainedTasks.length,
          original_tasks: tasks.length,
          skipped_not_in_current_rows: skippedTasks.length,
        },
        filter: {
          source_manifest: adapter.repoRelative(resolvedTaskManifest),
          current_rows_file: adapter.repoRelative(resolvedRowsFile),
          reason: "identity decisions may rewrite/reuse rows before content patches are applied",
        },
      });
    }
    const retainedActionItemCount = retainedTasks.reduce(
      (sum, task) =>
        sum +
        (Number.isFinite(Number(task.action_item_count))
          ? Number(task.action_item_count)
          : Array.isArray(task.action_items)
            ? task.action_items.length
            : 0),
      0,
    );
    const report: JsonRecord = {
      schema_version: 1,
      generated_at_utc: adapter.nowIso(),
      status:
        retainedActionItemCount > 0 ? "ready_for_ai_authoring_batch" : "ready_no_action_items",
      task_manifest: adapter.repoRelative(resolvedTaskManifest),
      filtered_task_manifest: adapter.repoRelative(filtered),
      current_rows_file: adapter.repoRelative(resolvedRowsFile),
      type,
      counts: {
        current_rows: rows.length,
        original_tasks: tasks.length,
        retained_tasks: retainedTasks.length,
        retained_action_items: retainedActionItemCount,
        skipped_tasks: skippedTasks.length,
      },
      skipped_tasks: skippedTasks.slice(0, 200),
    };
    adapter.writeJson(resolvedReportPath, report);
    return {
      status: report.status,
      taskManifest: filtered,
      reportPath: resolvedReportPath,
      counts: report.counts,
    };
  }

  return { filterAuthoringTaskManifestToRows };
}

import fs from "node:fs";
import path from "node:path";

type JsonRecord = Record<string, unknown>;
type TaskQueue = "inbox" | "active" | "done";

type TaskFile = {
  queue: TaskQueue;
  path: string;
};

type TaskDocument = {
  body: string;
  frontmatter: string;
  meta: Record<string, unknown>;
};

type CompletionReport = JsonRecord & {
  status?: unknown;
  task_id?: unknown;
  closeouts?: unknown;
  blockers?: unknown;
};

type JsonArtifact = {
  path: string;
  value: CompletionReport;
};

export type TaskCommandOptions = Record<string, unknown> & {
  help?: unknown;
  task?: unknown;
  taskId?: unknown;
  id?: unknown;
  taskFile?: unknown;
  completionReport?: unknown;
  importCompletionReport?: unknown;
  report?: unknown;
  dryRun?: unknown;
};

export type TaskCommandFactoryDependencies = {
  asText: (value: unknown) => string;
  booleanOption: (value: unknown) => boolean;
  completionFullContextBlockers: (input: {
    task: TaskDocument;
    completionReport: CompletionReport;
  }) => JsonRecord[];
  directoryExists: (filePath: string) => boolean;
  ensureArray: <T>(value: T | T[] | null | undefined) => T[];
  fileExists: (filePath: string) => boolean;
  nowIso: () => string;
  readJsonArtifactOption: (value: unknown) => JsonArtifact | null;
  replaceFrontmatterField: (frontmatter: string, key: string, value: string) => string;
  repoRelativePath: (filePath: string) => string;
  repoRoot: string;
  resolveRepoPath: (value: unknown) => string | null;
  taskMetaFromFile: (filePath: string) => TaskDocument;
  writeText: (filePath: string, text: string) => unknown;
};

const taskQueues: Record<TaskQueue, string> = {
  inbox: "tasks/inbox",
  active: "tasks/active",
  done: "tasks/done",
};

export function createTaskCommands({
  asText,
  booleanOption,
  completionFullContextBlockers,
  directoryExists,
  ensureArray,
  fileExists,
  nowIso,
  readJsonArtifactOption,
  replaceFrontmatterField,
  repoRelativePath,
  repoRoot,
  resolveRepoPath,
  taskMetaFromFile,
  writeText,
}: TaskCommandFactoryDependencies) {
  function listTaskFiles(queue: TaskQueue | null = null): TaskFile[] {
    const queueEntries = queue ? [[queue, taskQueues[queue]]] : Object.entries(taskQueues);
    const files: TaskFile[] = [];
    for (const [queueName, dir] of queueEntries) {
      const absDir = path.join(repoRoot, dir);
      if (!directoryExists(absDir)) continue;
      for (const name of fs.readdirSync(absDir).sort()) {
        if (name.endsWith(".md")) {
          files.push({ queue: queueName as TaskQueue, path: path.join(absDir, name) });
        }
      }
    }
    return files;
  }

  function taskSummary(file: TaskFile) {
    const { body, meta } = taskMetaFromFile(file.path);
    return {
      queue: file.queue,
      path: repoRelativePath(file.path),
      meta,
      body_preview: body.trim().split(/\r?\n/u).slice(0, 4).join("\n"),
    };
  }

  function findActiveTask(value: unknown):
    | string
    | null
    | {
        ambiguous_or_missing: true;
        candidates: Array<{ path: string; id: string; name: string }>;
      } {
    const token = asText(value);
    if (!token) return null;
    const directPath = resolveRepoPath(token);
    const activeRoot = resolveRepoPath(taskQueues.active)!;
    if (directPath && fileExists(directPath)) {
      const relativeToActive = path.relative(activeRoot, directPath);
      if (!relativeToActive.startsWith("..") && !path.isAbsolute(relativeToActive)) {
        return directPath;
      }
    }
    const candidates = listTaskFiles("active")
      .map((file) => {
        const parsed = taskMetaFromFile(file.path);
        return {
          path: file.path,
          id: asText(parsed.meta.id),
          name: path.basename(file.path, ".md"),
        };
      })
      .filter((task) => task.id === token || task.name === token);
    if (candidates.length !== 1) {
      return { ambiguous_or_missing: true, candidates };
    }
    return candidates[0].path;
  }

  function runTaskComplete(options: TaskCommandOptions): JsonRecord {
    if (options.help) {
      return {
        schema_version: 1,
        status: "help",
        command: "task-complete",
        usage: [
          "node scripts/foundry.ts task-complete --task <task-id|tasks/active/file.md> --completion-report <dataset-import-completion-report.json>",
        ],
        purpose:
          "Move one filesystem task from tasks/active to tasks/done only when the task-level import completion report is completed.",
        remote_write_mode: "read-only",
      };
    }

    const taskSelector = options.task || options.taskId || options.id || options.taskFile;
    const completionArtifact = readJsonArtifactOption(
      options.completionReport || options.importCompletionReport || options.report,
    );
    const blockers: JsonRecord[] = [];
    const taskMatch = findActiveTask(taskSelector);
    let taskPath = typeof taskMatch === "string" ? taskMatch : null;
    let task: TaskDocument | null = null;

    if (!taskSelector) {
      blockers.push({
        code: "task_selector_required",
        message: "task-complete requires --task with an active task id or file.",
      });
    } else if (!taskPath) {
      blockers.push({
        code: "active_task_not_found",
        message:
          "task-complete requires exactly one matching task under tasks/active; inbox/done/template tasks cannot be completed.",
        task: asText(taskSelector),
        candidates: (typeof taskMatch === "object" && taskMatch ? taskMatch.candidates : []).map(
          (candidate) => ({
            id: candidate.id,
            path: repoRelativePath(candidate.path),
          }),
        ),
      });
    } else {
      task = taskMetaFromFile(taskPath);
    }

    if (!completionArtifact) {
      blockers.push({
        code: "completion_report_required",
        message:
          "task-complete requires --completion-report pointing to dataset-import-completion-report.json.",
      });
    } else if (completionArtifact.value?.status !== "completed") {
      blockers.push({
        code: "completion_report_not_completed",
        message: `Completion report status is ${completionArtifact.value?.status ?? "missing"}.`,
        completion_report: repoRelativePath(completionArtifact.path),
      });
    }

    if (completionArtifact?.value?.status === "completed") {
      const completionCloseouts = ensureArray(completionArtifact.value.closeouts);
      if (completionCloseouts.length === 0) {
        blockers.push({
          code: "completion_report_closeouts_missing",
          message:
            "Completed import task reports must contain at least one post-write closeout scope.",
          completion_report: repoRelativePath(completionArtifact.path),
        });
      }
      const completionBlockers = ensureArray(completionArtifact.value.blockers);
      if (completionBlockers.length > 0) {
        blockers.push({
          code: "completion_report_blockers_present",
          message: "Completion report status is completed but still carries blockers.",
          completion_report: repoRelativePath(completionArtifact.path),
          blocker_count: completionBlockers.length,
        });
      }
    }

    const taskId = asText(task?.meta?.id);
    const reportTaskId = asText(completionArtifact?.value?.task_id);
    if (task && !taskId) {
      blockers.push({
        code: "task_id_missing",
        message: "Active task frontmatter must contain id before completion.",
        task_file: repoRelativePath(taskPath!),
      });
    }
    if (task && completionArtifact && (!reportTaskId || reportTaskId !== taskId)) {
      blockers.push({
        code: "completion_report_task_id_mismatch",
        message: "Completion report task_id must match the active task id.",
        task_id: taskId || null,
        completion_report_task_id: reportTaskId || null,
        completion_report: repoRelativePath(completionArtifact.path),
      });
    }
    if (task && completionArtifact?.value?.status === "completed") {
      blockers.push(
        ...completionFullContextBlockers({
          task,
          completionReport: completionArtifact.value,
        }).map((blocker) => ({
          ...blocker,
          completion_report: repoRelativePath(completionArtifact.path),
        })),
      );
    }

    const destinationPath = taskPath
      ? path.join(resolveRepoPath(taskQueues.done)!, path.basename(taskPath))
      : null;
    if (destinationPath && fileExists(destinationPath)) {
      blockers.push({
        code: "done_task_already_exists",
        message: "A done task with the same filename already exists.",
        done_task: repoRelativePath(destinationPath),
      });
    }

    const report = {
      schema_version: 1,
      generated_at_utc: nowIso(),
      status:
        blockers.length === 0 ? (booleanOption(options.dryRun) ? "ready" : "completed") : "blocked",
      remote_write_mode: "read-only",
      task_id: taskId || null,
      task_file: taskPath ? repoRelativePath(taskPath) : null,
      destination_file: destinationPath ? repoRelativePath(destinationPath) : null,
      completion_report: completionArtifact ? repoRelativePath(completionArtifact.path) : null,
      dry_run: booleanOption(options.dryRun),
      policy: {
        completion_gate:
          "tasks/active may move to tasks/done only after dataset-import-completion-report.status is completed for the same task_id, with full schema/YAML/context AI completion proof when the task or closeout profile requires it.",
        no_database_write: true,
        full_context_ai_completion_before_entry: true,
      },
      blockers,
    };
    if (blockers.length > 0 || booleanOption(options.dryRun)) {
      return report;
    }

    const frontmatter = replaceFrontmatterField(
      replaceFrontmatterField(
        replaceFrontmatterField(task!.frontmatter, "state", "Done"),
        "completion_report",
        repoRelativePath(completionArtifact!.path),
      ),
      "completed_at",
      report.generated_at_utc,
    );
    const updatedText = `---\n${frontmatter}\n---\n${task!.body}`;
    writeText(destinationPath!, updatedText);
    fs.unlinkSync(taskPath!);
    return report;
  }

  function tasksList() {
    return listTaskFiles().map(taskSummary);
  }

  function tasksCheck() {
    const errors: string[] = [];
    const ids = new Set<unknown>();
    for (const task of tasksList()) {
      for (const key of ["id", "title", "state", "kind"]) {
        if (!task.meta[key]) errors.push(`${task.path}: missing ${key}`);
      }
      if (task.meta.id) {
        if (ids.has(task.meta.id)) errors.push(`${task.path}: duplicate id ${task.meta.id}`);
        ids.add(task.meta.id);
      }
    }
    return { task_count: tasksList().length, errors, ok: errors.length === 0 };
  }

  return {
    runTaskComplete,
    tasksCheck,
    tasksList,
  };
}

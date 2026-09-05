import fs from "node:fs";
import { parseCapsule } from "./foundry-execution-context-format.ts";
import { sha256Json } from "./identity-preflight-proof.ts";
import path from "node:path";
import {
  assertFoundryRuntimeContext,
  readFoundryInput,
  type FoundryRuntimeContext,
} from "./foundry-runtime-context.ts";
import {
  readFoundryMigrationAuthority,
  migrationDatasetScope,
  type MigrationTaskAuthority,
} from "./foundry-migration-authority.ts";
import {
  transferFail,
  transferPath,
  transferRead,
  transferHash,
} from "./foundry-migration-transfer-io.ts";

function consumed(context: FoundryRuntimeContext, id: string): boolean {
  const attempts = transferPath(context.controlRoot, `workspaces/${id}/attempts`);
  if (!fs.existsSync(attempts)) return false;
  const stat = fs.lstatSync(attempts);
  if (!stat.isDirectory() || stat.isSymbolicLink())
    transferFail(
      "migration_attempt_history_invalid",
      "Current attempt history is not a contained directory.",
    );
  const directory = fs.opendirSync(attempts);
  try {
    return directory.readSync() !== null;
  } finally {
    directory.closeSync();
  }
}

/** Admission guard only. Original CLI dispatch/readback state is never changed or replayed here. */
export function assertFoundryMigrationNoReplay(
  context: FoundryRuntimeContext,
  inputFile: string,
): void {
  assertFoundryRuntimeContext(context);
  if (!context.migration) return;
  const authority = readFoundryMigrationAuthority(
    context.controlRoot,
    context.workspaceId!,
    context.migration,
  );
  const barriers: Pick<MigrationTaskAuthority, "disposition" | "scope_keys" | "scope_complete">[] =
    authority.tasks.filter((task) => task.disposition !== "local-unattempted");
  const workspaceTasks = transferPath(context.controlRoot, "workspaces");
  const registrations = transferPath(context.controlRoot, "state/task-registrations");
  const ids = new Set<string>(fs.existsSync(workspaceTasks) ? fs.readdirSync(workspaceTasks) : []);
  if (fs.existsSync(registrations))
    for (const name of fs.readdirSync(registrations))
      if (name.endsWith(".json")) ids.add(name.slice(0, -5));
  if (ids.size > 10_000)
    transferFail(
      "migration_attempt_history_invalid",
      "Current task history exceeds its audit bound.",
    );
  for (const id of ids) {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/u.test(id))
      transferFail("migration_attempt_history_invalid", "Current task identity is unsupported.");
    const taskRoot = transferPath(context.controlRoot, `workspaces/${id}`);
    if (!fs.existsSync(taskRoot) || !fs.lstatSync(taskRoot).isDirectory())
      transferFail(
        "migration_attempt_history_invalid",
        "Registered current task history is missing.",
      );
    const registration = JSON.parse(
      transferRead(
        transferPath(context.controlRoot, `state/task-registrations/${id}.json`),
        24 * 1024 * 1024,
      ).toString("utf8"),
    ) as Record<string, unknown>;
    const { registration_sha256: checksum, ...registered } = registration;
    const job = registration.job as Record<string, unknown> | null;
    if (
      registration.schema !== "tiangong-foundry.task-registration.v1" ||
      checksum !== sha256Json(registered) ||
      !job ||
      typeof job !== "object" ||
      Array.isArray(job) ||
      job.workspace_id !== context.workspaceId ||
      job.task_id !== id ||
      typeof job.actor_id !== "string"
    )
      transferFail(
        "migration_attempt_history_invalid",
        "Current task registration does not match this workspace.",
      );
    const jobBytes = transferRead(
      transferPath(context.controlRoot, `workspaces/${id}/foundry-job.json`),
      8 * 1024 * 1024,
    );
    const publication = JSON.parse(
      transferRead(
        transferPath(context.controlRoot, `state/task-publications/${id}.json`),
        64 * 1024,
      ).toString("utf8"),
    ) as Record<string, unknown>;
    if (
      sha256Json(JSON.parse(jobBytes.toString("utf8"))) !== sha256Json(job) ||
      publication.schema !== "tiangong-foundry.task-publication.v1" ||
      publication.workspace_id !== context.workspaceId ||
      publication.task_id !== id ||
      publication.job_sha256 !== transferHash(jobBytes)
    )
      transferFail(
        "migration_attempt_history_invalid",
        "Current task publication is missing or changed.",
      );
    if (!consumed(context, id)) continue;
    const task = { task_id: id, actor_id: job.actor_id };
    const keys = new Set<string>();
    let complete = true;
    const executionRoot = transferPath(
      context.controlRoot,
      `workspaces/${task.task_id}/evidence/executions`,
    );
    if (!fs.existsSync(executionRoot)) complete = false;
    else {
      const names = fs.readdirSync(executionRoot);
      if (!names.length || names.length > 1000) complete = false;
      for (const name of names.slice(0, 1000)) {
        try {
          if (!/^[0-9a-f]{64}\.json$/u.test(name)) {
            complete = false;
            continue;
          }
          const bytes = transferRead(
            transferPath(
              context.controlRoot,
              `workspaces/${task.task_id}/evidence/executions/${name}`,
            ),
            1024 * 1024,
          );
          if (transferHash(bytes) !== name.slice(0, -5)) {
            complete = false;
            continue;
          }
          const value = parseCapsule(JSON.parse(bytes.toString("utf8")));
          const fact = value.final_rows;
          if (
            value.schema !== "tiangong-foundry.execution-context.v1" ||
            value.workspace_id !== context.workspaceId ||
            value.task_id !== task.task_id ||
            value.actor_id !== task.actor_id ||
            !fact ||
            typeof fact.path !== "string" ||
            !fact.path.startsWith(context.controlRoot + path.sep)
          ) {
            complete = false;
            continue;
          }
          const input = transferPath(
            context.controlRoot,
            path.relative(context.controlRoot, fact.path).split(path.sep).join("/"),
          );
          const data = transferRead(input, 64 * 1024 * 1024);
          if (data.length !== fact.bytes || transferHash(data) !== fact.sha256) {
            complete = false;
            continue;
          }
          const scope = migrationDatasetScope(input, data);
          complete = complete && scope.complete;
          for (const key of scope.keys) keys.add(key);
        } catch {
          complete = false;
        }
      }
    }
    barriers.push({
      disposition: "owner-readback-only",
      scope_keys: [...keys].sort(),
      scope_complete: complete && keys.size > 0,
    });
  }
  if (!barriers.length) return;
  const current = migrationDatasetScope(inputFile, readFoundryInput(context, inputFile));
  if (!current.complete || barriers.some((task) => !task.scope_complete))
    transferFail(
      "migration_readback_required",
      "Unresolved migration history has no complete dataset scope; obtain original-owner status/readback before mutation admission.",
    );
  for (const task of barriers) {
    const previous = new Set(task.scope_keys);
    const resources = new Set(task.scope_keys.map((key) => key.split("@")[0]));
    if (
      current.keys.some(
        (key) =>
          previous.has(key) ||
          (task.disposition !== "terminal-retained" && resources.has(key.split("@")[0])),
      )
    )
      transferFail(
        "migration_replay_forbidden",
        "This dataset overlaps retained terminal or unresolved attempt authority; another request, path or runtime cannot authorize replay.",
      );
  }
}

import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { withBatchRunLock } from "@tiangong-lca/cli/batch";
import {
  assertFoundryRuntimeContext,
  assertFoundryWorkspaceWrite,
  assertPendingFoundryTaskIntent,
  FoundryContextError,
  resolveFoundryOutput,
  type FoundryInputFact,
  type FoundryRuntimeContext,
} from "./foundry-runtime-context.ts";
import {
  parseFoundryTaskStartSpec,
  taskStartSpecFingerprint,
  type FoundryTaskStartSpec,
} from "./foundry-task-start-spec.ts";
import { sha256Json } from "./identity-preflight-proof.ts";

export const FOUNDRY_FACADE_REQUEST_INDEX_SCHEMA =
  "tiangong-foundry.facade-request-index.v1" as const;
export const FOUNDRY_FACADE_TASK_POINTER_SCHEMA =
  "tiangong-foundry.facade-task-pointer.v1" as const;

interface FacadeRequestRevision {
  readonly revision: number;
  readonly task_id: string;
  readonly predecessor_task_id: string | null;
  readonly fingerprint_sha256: string;
  readonly spec_source: Readonly<FoundryInputFact>;
  readonly spec: FoundryTaskStartSpec;
  readonly inputs: readonly Readonly<FoundryInputFact>[];
  readonly created_at_utc: string;
  readonly record_sha256: string;
}

interface FacadeRequestIndex {
  readonly schema: typeof FOUNDRY_FACADE_REQUEST_INDEX_SCHEMA;
  readonly workspace_id: string;
  readonly request_id: string;
  readonly request_sha256: string;
  readonly revisions: readonly FacadeRequestRevision[];
  readonly index_sha256: string;
}

interface FacadeTaskPointer {
  readonly schema: typeof FOUNDRY_FACADE_TASK_POINTER_SCHEMA;
  readonly workspace_id: string;
  readonly task_id: string;
  readonly request_sha256: string;
  readonly revision: number;
  readonly revision_sha256: string;
}

export interface FoundryFacadeTaskRecord {
  readonly request_sha256: string;
  readonly revision: number;
  readonly task_id: string;
  readonly predecessor_task_id: string | null;
  readonly fingerprint_sha256: string;
  readonly spec_source: Readonly<FoundryInputFact>;
  readonly spec: FoundryTaskStartSpec;
  readonly inputs: readonly Readonly<FoundryInputFact>[];
  readonly created_at_utc: string;
}

const shaPattern = /^[0-9a-f]{64}$/u;
const taskIdPattern = /^task-[0-9a-f]{64}-r\d{4}$/u;
const maxIndexBytes = 8 * 1024 * 1024;
const maxRevisions = 1_000;

function fail(code: string, message: string): never {
  throw new FoundryContextError(code, message);
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    fail("facade_request_invalid", "Facade request state must be a JSON object.");
  return value as Record<string, unknown>;
}

function exact(value: Record<string, unknown>, keys: readonly string[]): void {
  if (Object.keys(value).length !== keys.length || keys.some((key) => !Object.hasOwn(value, key)))
    fail("facade_request_invalid", "Facade request state has missing or unsupported fields.");
}

function timestamp(value: unknown): value is string {
  return (
    typeof value === "string" &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value
  );
}

function content(value: unknown): Buffer {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
}

function contentFact(value: unknown): FoundryInputFact {
  const item = object(value);
  exact(item, ["path", "bytes", "sha256"]);
  if (
    typeof item.path !== "string" ||
    !path.isAbsolute(item.path) ||
    !Number.isSafeInteger(item.bytes) ||
    Number(item.bytes) < 0 ||
    typeof item.sha256 !== "string" ||
    !shaPattern.test(item.sha256)
  )
    fail("facade_request_invalid", "Facade input facts require canonical path, bytes and hash.");
  return { path: item.path, bytes: Number(item.bytes), sha256: item.sha256 };
}

function requestPath(context: FoundryRuntimeContext, requestSha256: string): string {
  if (!shaPattern.test(requestSha256))
    fail("facade_request_invalid", "Facade request identity must be a SHA-256 digest.");
  return resolveFoundryOutput(context, `facade-requests/${requestSha256}.json`, "state");
}

function taskPointerPath(context: FoundryRuntimeContext, taskId: string): string {
  if (!taskIdPattern.test(taskId))
    fail("task_id_invalid", "Facade task id has an unsupported shape.");
  return resolveFoundryOutput(context, `facade-tasks/${taskId}.json`, "state");
}

function readBounded(file: string, maxBytes = maxIndexBytes): Buffer {
  let fd: number;
  try {
    fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  } catch {
    return fail("facade_request_invalid", "Facade request state must be an existing regular file.");
  }
  try {
    const before = fs.fstatSync(fd, { bigint: true });
    if (!before.isFile() || before.size > BigInt(maxBytes))
      fail("facade_request_invalid", "Facade request state must be a bounded regular file.");
    const bytes = fs.readFileSync(fd);
    const after = fs.fstatSync(fd, { bigint: true });
    if (
      bytes.length > maxBytes ||
      before.dev !== after.dev ||
      before.ino !== after.ino ||
      before.size !== after.size ||
      before.mtimeNs !== after.mtimeNs ||
      BigInt(bytes.length) !== after.size
    )
      fail("facade_request_invalid", "Facade request state changed while it was read.");
    return bytes;
  } finally {
    fs.closeSync(fd);
  }
}

function revision(value: unknown, expected: number): FacadeRequestRevision {
  const item = object(value);
  exact(item, [
    "revision",
    "task_id",
    "predecessor_task_id",
    "fingerprint_sha256",
    "spec_source",
    "spec",
    "inputs",
    "created_at_utc",
    "record_sha256",
  ]);
  const { record_sha256: recorded, ...unsigned } = item;
  if (
    item.revision !== expected ||
    typeof item.task_id !== "string" ||
    !taskIdPattern.test(item.task_id) ||
    (item.predecessor_task_id !== null &&
      (typeof item.predecessor_task_id !== "string" ||
        !taskIdPattern.test(item.predecessor_task_id))) ||
    typeof item.fingerprint_sha256 !== "string" ||
    !shaPattern.test(item.fingerprint_sha256) ||
    typeof recorded !== "string" ||
    recorded !== sha256Json(unsigned) ||
    !Array.isArray(item.inputs) ||
    !item.inputs.length ||
    !timestamp(item.created_at_utc)
  )
    fail("facade_request_invalid", "Facade revision sequence or content binding changed.");
  const parsedSpec = parseFoundryTaskStartSpec(item.spec);
  const inputs = item.inputs.map(contentFact);
  if (
    taskStartSpecFingerprint(parsedSpec, inputs) !== item.fingerprint_sha256 ||
    (expected === 1 ? item.predecessor_task_id !== null : item.predecessor_task_id === null)
  )
    fail("facade_request_invalid", "Facade revision fingerprint or predecessor is invalid.");
  return Object.freeze({
    revision: expected,
    task_id: item.task_id,
    predecessor_task_id: item.predecessor_task_id,
    fingerprint_sha256: item.fingerprint_sha256,
    spec_source: Object.freeze(contentFact(item.spec_source)),
    spec: parsedSpec,
    inputs: Object.freeze(inputs.map((fact) => Object.freeze(fact))),
    created_at_utc: item.created_at_utc,
    record_sha256: recorded,
  });
}

function readRequest(
  context: FoundryRuntimeContext,
  requestSha256: string,
): { index: FacadeRequestIndex | null; bytes: Buffer | null } {
  const file = requestPath(context, requestSha256);
  if (!fs.existsSync(file)) return { index: null, bytes: null };
  const bytes = readBounded(file);
  let raw: Record<string, unknown>;
  try {
    raw = object(JSON.parse(bytes.toString("utf8")));
  } catch (error) {
    if (error instanceof FoundryContextError) throw error;
    return fail("facade_request_invalid", "Facade request state is incomplete JSON.");
  }
  exact(raw, [
    "schema",
    "workspace_id",
    "request_id",
    "request_sha256",
    "revisions",
    "index_sha256",
  ]);
  const { index_sha256: checksum, ...unsigned } = raw;
  if (
    raw.schema !== FOUNDRY_FACADE_REQUEST_INDEX_SCHEMA ||
    raw.workspace_id !== context.workspaceId ||
    raw.request_sha256 !== requestSha256 ||
    typeof raw.request_id !== "string" ||
    !Array.isArray(raw.revisions) ||
    !raw.revisions.length ||
    raw.revisions.length > maxRevisions ||
    checksum !== sha256Json(unsigned)
  )
    fail("facade_request_invalid", "Facade request index identity or checksum changed.");
  const revisions = raw.revisions.map((item, index) => revision(item, index + 1));
  for (let index = 0; index < revisions.length; index += 1) {
    const entry = revisions[index];
    const expectedTaskId = `task-${requestSha256}-r${String(index + 1).padStart(4, "0")}`;
    if (
      entry.task_id !== expectedTaskId ||
      entry.predecessor_task_id !== (revisions[index - 1]?.task_id ?? null)
    )
      fail("facade_request_invalid", "Facade task ids do not match revision ancestry.");
  }
  return {
    index: Object.freeze({
      schema: FOUNDRY_FACADE_REQUEST_INDEX_SCHEMA,
      workspace_id: raw.workspace_id as string,
      request_id: raw.request_id,
      request_sha256: raw.request_sha256,
      revisions: Object.freeze(revisions),
      index_sha256: checksum,
    }),
    bytes,
  };
}

function writeOnce(file: string, bytes: Buffer): void {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  if (fs.existsSync(file)) {
    if (!readBounded(file).equals(bytes))
      fail("facade_request_conflict", "Immutable facade state already has different bytes.");
    return;
  }
  const temp = `${file}.${randomUUID()}.tmp`;
  const fd = fs.openSync(temp, "wx", 0o600);
  try {
    fs.writeFileSync(fd, bytes);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  try {
    fs.linkSync(temp, file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    if (!readBounded(file).equals(bytes))
      fail("facade_request_conflict", "Concurrent facade state has different bytes.");
  } finally {
    if (fs.existsSync(temp)) fs.unlinkSync(temp);
  }
}

function replaceIndex(file: string, bytes: Buffer, before: Buffer | null): void {
  if (bytes.length > maxIndexBytes)
    fail("facade_request_limit", "Facade request history exceeds its bounded store.");
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.${randomUUID()}.tmp`;
  const fd = fs.openSync(temp, "wx", 0o600);
  try {
    fs.writeFileSync(fd, bytes);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  try {
    const current = fs.existsSync(file) ? readBounded(file) : null;
    if ((current === null) !== (before === null) || (current && before && !current.equals(before)))
      fail("facade_request_conflict", "Facade request index changed outside its lock.");
    if (current) fs.renameSync(temp, file);
    else fs.linkSync(temp, file);
  } finally {
    if (fs.existsSync(temp)) fs.unlinkSync(temp);
  }
}

function pointer(value: unknown, context: FoundryRuntimeContext): FacadeTaskPointer {
  const item = object(value);
  exact(item, [
    "schema",
    "workspace_id",
    "task_id",
    "request_sha256",
    "revision",
    "revision_sha256",
  ]);
  if (
    item.schema !== FOUNDRY_FACADE_TASK_POINTER_SCHEMA ||
    item.workspace_id !== context.workspaceId ||
    typeof item.task_id !== "string" ||
    !taskIdPattern.test(item.task_id) ||
    typeof item.request_sha256 !== "string" ||
    !shaPattern.test(item.request_sha256) ||
    !Number.isSafeInteger(item.revision) ||
    Number(item.revision) < 1 ||
    Number(item.revision) > maxRevisions ||
    typeof item.revision_sha256 !== "string" ||
    !shaPattern.test(item.revision_sha256)
  )
    fail("facade_task_pointer_invalid", "Facade task pointer is malformed.");
  return item as unknown as FacadeTaskPointer;
}

function requireUnattemptedPredecessors(
  context: FoundryRuntimeContext,
  predecessors: readonly FacadeRequestRevision[],
): void {
  for (const predecessor of predecessors) {
    const workspaces = path.join(context.controlRoot, "workspaces"),
      taskRoot = path.join(workspaces, predecessor.task_id),
      jobFile = path.join(taskRoot, "foundry-job.json");
    try {
      for (const directory of [context.controlRoot, workspaces, taskRoot]) {
        const stat = fs.lstatSync(directory);
        if (!stat.isDirectory() || stat.isSymbolicLink())
          fail(
            "facade_predecessor_history_invalid",
            "Predecessor task storage is missing or linked.",
          );
      }
      const stat = fs.lstatSync(jobFile);
      if (!stat.isFile() || stat.isSymbolicLink())
        fail("facade_predecessor_history_invalid", "Predecessor job must remain a regular file.");
      const jobBytes = readBounded(jobFile, 64 * 1024),
        job = object(JSON.parse(jobBytes.toString("utf8"))),
        publication = object(
          JSON.parse(
            readBounded(
              resolveFoundryOutput(
                context,
                `task-publications/${predecessor.task_id}.json`,
                "state",
              ),
              16 * 1024,
            ).toString("utf8"),
          ),
        );
      exact(publication, ["schema", "workspace_id", "task_id", "job_sha256"]);
      if (
        job.schema !== "tiangong-foundry.job.v2" ||
        job.workspace_id !== context.workspaceId ||
        job.task_id !== predecessor.task_id ||
        job.actor_id !== predecessor.spec.actor_id ||
        job.request_id !== predecessor.spec.request_id ||
        job.created_at_utc !== predecessor.created_at_utc ||
        publication.schema !== "tiangong-foundry.task-publication.v1" ||
        publication.workspace_id !== context.workspaceId ||
        publication.task_id !== predecessor.task_id ||
        publication.job_sha256 !== createHash("sha256").update(jobBytes).digest("hex")
      )
        fail(
          "facade_predecessor_history_invalid",
          "Predecessor publication and task identity differ.",
        );
      const attempts = path.join(taskRoot, "attempts");
      let attemptStat: fs.Stats;
      try {
        attemptStat = fs.lstatSync(attempts);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
        throw error;
      }
      if (!attemptStat.isDirectory() || attemptStat.isSymbolicLink())
        fail(
          "facade_predecessor_history_invalid",
          "Predecessor attempts must remain a contained directory.",
        );
      const directory = fs.opendirSync(attempts);
      try {
        if (directory.readSync())
          fail(
            "facade_predecessor_readback_required",
            `Retained predecessor ${predecessor.task_id} has attempt evidence; use its original owner for status/readback before any revision can continue.`,
          );
      } finally {
        directory.closeSync();
      }
    } catch (error) {
      if (error instanceof FoundryContextError) throw error;
      fail(
        "facade_predecessor_history_invalid",
        "Retained predecessor history is missing or invalid; restore or audit it before continuing.",
      );
    }
  }
}

export async function registerFoundryFacadeTask(
  context: FoundryRuntimeContext,
  options: {
    specSource: FoundryInputFact;
    spec: FoundryTaskStartSpec;
    inputs: readonly FoundryInputFact[];
    createOrLoad: (taskId: string) => { created_at_utc: string; inputs_sha256: string };
  },
): Promise<FoundryFacadeTaskRecord> {
  assertFoundryWorkspaceWrite(context);
  if (!context.workspaceId || context.taskId)
    fail(
      "workspace_context_required",
      "Facade request registration requires one workspace context.",
    );
  const spec = parseFoundryTaskStartSpec(options.spec);
  const fingerprint = taskStartSpecFingerprint(spec, options.inputs);
  const requestSha256 = sha256Json({
    workspace_id: context.workspaceId,
    request_id: spec.request_id,
  });
  const lockPath = resolveFoundryOutput(
    context,
    `facade-request-locks/${requestSha256}.json`,
    "state",
  );
  return withBatchRunLock(
    {
      runPath: lockPath,
      identity: {
        schema: "tiangong-foundry.facade-request-lock.v1",
        workspace_id: context.workspaceId,
        request_sha256: requestSha256,
      },
      reason: "Foundry facade request revision",
    },
    () => {
      const stored = readRequest(context, requestSha256);
      if (stored.index && stored.index.request_id !== spec.request_id)
        fail("facade_request_collision", "Facade request digest collides with another request id.");
      const latest = stored.index?.revisions.at(-1) ?? null;
      const revisionNumber =
        latest?.fingerprint_sha256 === fingerprint ? latest.revision : (latest?.revision ?? 0) + 1;
      if (revisionNumber > maxRevisions)
        fail("facade_request_limit", "Facade request has too many retained revisions.");
      const taskId = `task-${requestSha256}-r${String(revisionNumber).padStart(4, "0")}`;
      assertPendingFoundryTaskIntent(context, taskId, spec.request_id, spec.actor_id, fingerprint);
      const predecessors =
        stored.index?.revisions.filter((entry) => entry.task_id !== taskId) ?? [];
      requireUnattemptedPredecessors(context, predecessors);
      let task: { created_at_utc: string; inputs_sha256: string };
      try {
        task = options.createOrLoad(taskId);
        if (task.inputs_sha256 !== sha256Json(options.inputs))
          throw new FoundryContextError(
            "task_source_changed",
            "Registered task sources do not match this facade revision.",
          );
      } catch (error) {
        const taskStateExists =
          fs.existsSync(path.join(context.controlRoot, "workspaces", taskId)) ||
          fs.existsSync(resolveFoundryOutput(context, `task-publications/${taskId}.json`, "state"));
        if (
          (!latest || latest.fingerprint_sha256 !== fingerprint) &&
          taskStateExists &&
          error instanceof FoundryContextError &&
          error.code.startsWith("task_")
        )
          throw new FoundryContextError(
            "facade_crash_recovery_conflict",
            `An interrupted start already registered ${taskId}; retry the original task-start spec to complete its request index before creating another revision.`,
          );
        throw error;
      }
      let selected = latest;
      requireUnattemptedPredecessors(context, predecessors);
      if (!latest || latest.fingerprint_sha256 !== fingerprint) {
        const unsigned = {
          revision: revisionNumber,
          task_id: taskId,
          predecessor_task_id: latest?.task_id ?? null,
          fingerprint_sha256: fingerprint,
          spec_source: { ...options.specSource },
          spec,
          inputs: options.inputs.map((fact) => ({ ...fact })),
          created_at_utc: task.created_at_utc,
        };
        selected = revision(
          {
            ...unsigned,
            record_sha256: sha256Json(unsigned),
          },
          revisionNumber,
        );
        const payload = {
          schema: FOUNDRY_FACADE_REQUEST_INDEX_SCHEMA,
          workspace_id: context.workspaceId,
          request_id: spec.request_id,
          request_sha256: requestSha256,
          revisions: [...(stored.index?.revisions ?? []), selected],
        };
        replaceIndex(
          requestPath(context, requestSha256),
          content({ ...payload, index_sha256: sha256Json(payload) }),
          stored.bytes,
        );
      }
      if (!selected) return fail("facade_request_invalid", "Facade request has no task revision.");
      const taskPointer = {
        schema: FOUNDRY_FACADE_TASK_POINTER_SCHEMA,
        workspace_id: context.workspaceId,
        task_id: selected.task_id,
        request_sha256: requestSha256,
        revision: selected.revision,
        revision_sha256: selected.record_sha256,
      };
      writeOnce(taskPointerPath(context, selected.task_id), content(taskPointer));
      return Object.freeze({
        request_sha256: requestSha256,
        revision: selected.revision,
        task_id: selected.task_id,
        predecessor_task_id: selected.predecessor_task_id,
        fingerprint_sha256: selected.fingerprint_sha256,
        spec_source: selected.spec_source,
        spec: selected.spec,
        inputs: selected.inputs,
        created_at_utc: selected.created_at_utc,
      });
    },
  );
}

export function loadFoundryFacadeTaskRecord(
  context: FoundryRuntimeContext,
  taskId: string,
  actorId: string,
): FoundryFacadeTaskRecord {
  assertFoundryRuntimeContext(context);
  if (!context.workspaceId || context.taskId)
    fail("workspace_context_required", "Facade task lookup requires one workspace context.");
  const file = taskPointerPath(context, taskId);
  if (!fs.existsSync(file)) fail("task_not_found", "No registered facade task matches this id.");
  let taskPointer: FacadeTaskPointer;
  try {
    taskPointer = pointer(JSON.parse(readBounded(file).toString("utf8")), context);
  } catch (error) {
    if (error instanceof FoundryContextError) throw error;
    return fail("facade_task_pointer_invalid", "Facade task pointer is incomplete JSON.");
  }
  if (taskPointer.task_id !== taskId)
    fail("facade_task_pointer_invalid", "Facade task pointer names another task.");
  const request = readRequest(context, taskPointer.request_sha256).index;
  const selected = request?.revisions[taskPointer.revision - 1];
  if (
    !selected ||
    selected.task_id !== taskId ||
    selected.record_sha256 !== taskPointer.revision_sha256
  )
    fail("facade_task_pointer_invalid", "Facade task pointer has no current request revision.");
  if (selected.spec.actor_id !== actorId)
    fail("task_actor_mismatch", "Current actor does not match the registered task intent.");
  requireUnattemptedPredecessors(context, request.revisions.slice(0, taskPointer.revision - 1));
  return Object.freeze({
    request_sha256: taskPointer.request_sha256,
    revision: selected.revision,
    task_id: selected.task_id,
    predecessor_task_id: selected.predecessor_task_id,
    fingerprint_sha256: selected.fingerprint_sha256,
    spec_source: selected.spec_source,
    spec: selected.spec,
    inputs: selected.inputs,
    created_at_utc: selected.created_at_utc,
  });
}

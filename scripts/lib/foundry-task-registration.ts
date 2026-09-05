import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  assertFoundryRuntimeContext,
  assertFoundryWorkspaceWrite,
  assertPendingFoundryTaskIntent,
  captureFoundryInput,
  resolveFoundryAsset,
  resolveFoundryOutput,
  writeFoundryArtifact,
  type FoundryRuntimeContext,
} from "./foundry-runtime-context.ts";
import { sha256Json } from "./identity-preflight-proof.ts";
import {
  fail,
  object,
  exact,
  timestamp,
  bytes,
  digest,
  taskPath,
  readTaskBytes,
  readTaskJson,
  reference,
  facts,
  sameFact,
  maxDocumentBytes,
} from "./foundry-task-io.ts";
import type {
  JsonRecord,
  TaskRuntimeIdentity,
  TaskRegistration,
  FoundryTaskOptions,
  LoadedTask,
  FoundryTaskJob,
  SourceManifest,
} from "./foundry-task-types.ts";
const entityTypes = new Set([
  "contact",
  "source",
  "support",
  "flow",
  "flowproperty",
  "unitgroup",
  "process",
  "lifecyclemodel",
]);

function runtimeIdentity(context: FoundryRuntimeContext): TaskRuntimeIdentity {
  return {
    package_name: context.runtime.packageName,
    package_version: context.runtime.packageVersion,
    manifest_sha256: context.runtime.packageManifestSha256,
    entry_sha256: context.runtime.entrySha256,
  };
}
function profileLock(context: FoundryRuntimeContext, id: string): JsonRecord {
  const file = resolveFoundryAsset(context, "specs/import-profiles.json");
  const config = object(JSON.parse(fs.readFileSync(file, "utf8")));
  const profiles = object(config.profiles);
  if (!Object.hasOwn(profiles, id))
    fail("task_profile_unknown", "Task profile is not present in the executing runtime.");
  const profile = object(profiles[id]);
  return {
    schema: "tiangong-foundry.profile-lock.v2",
    profile_id: id,
    profile_sha256: sha256Json(profile),
    profile,
  };
}
export function requiredTask(context: FoundryRuntimeContext): void {
  assertFoundryRuntimeContext(context);
  if (!context.workspaceId || !context.taskId || !context.taskRoot || !context.actorId)
    fail(
      "task_context_required",
      "Task storage requires initialized workspace, task and actor intent.",
    );
}

function registrationPath(context: FoundryRuntimeContext): string {
  return resolveFoundryOutput(context, `task-registrations/${context.taskId}.json`, "state");
}

function readRegistration(context: FoundryRuntimeContext): TaskRegistration | null {
  const file = registrationPath(context);
  if (!fs.existsSync(file)) return null;
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 3 * maxDocumentBytes)
    fail("task_registration_invalid", "Task registration must be a bounded regular record.");
  let value: JsonRecord;
  try {
    value = object(JSON.parse(fs.readFileSync(file, "utf8")));
  } catch {
    fail("task_registration_invalid", "Task registration is malformed.");
  }
  exact(value, [
    "schema",
    "job",
    "source_manifest",
    "profile_lock",
    "seed_manifest",
    "registration_sha256",
  ]);
  const { registration_sha256: checksum, ...payload } = value;
  if (value.schema !== "tiangong-foundry.task-registration.v1" || checksum !== sha256Json(payload))
    fail("task_registration_invalid", "Task registration content changed.");
  const job = object(value.job);
  if (job.workspace_id !== context.workspaceId || job.task_id !== context.taskId)
    fail("task_binding_mismatch", "Registered task belongs to another workspace or task.");
  if (job.actor_id !== context.actorId)
    fail("task_actor_mismatch", "Task actor does not match the registered task intent.");
  if (
    context.workspaceAccess === "write" &&
    sha256Json(job.runtime_identity) !== sha256Json(runtimeIdentity(context))
  )
    fail("task_runtime_changed", "Task runtime differs from its registration.");
  if (
    typeof job.target_profile !== "string" ||
    (context.workspaceAccess === "write" &&
      !bytes(value.profile_lock).equals(bytes(profileLock(context, job.target_profile))))
  )
    fail("task_profile_changed", "Registered profile does not match current package rules.");
  return value as unknown as TaskRegistration;
}

function writeStateOnce(
  context: FoundryRuntimeContext,
  relativePath: string,
  content: Buffer,
): void {
  assertFoundryWorkspaceWrite(context);
  const target = resolveFoundryOutput(context, relativePath, "state");
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  resolveFoundryOutput(context, target, "state");
  if (fs.existsSync(target)) {
    if (!fs.lstatSync(target).isFile() || !fs.readFileSync(target).equals(content))
      fail("task_registration_conflict", "Existing task registration cannot be changed.");
    return;
  }
  const temp = `${target}.${randomUUID()}.tmp`;
  const fd = fs.openSync(temp, "wx", 0o600);
  try {
    fs.writeFileSync(fd, content);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  try {
    fs.linkSync(temp, target);
  } finally {
    if (fs.existsSync(temp)) fs.unlinkSync(temp);
  }
}

export function loadTask(context: FoundryRuntimeContext, options: FoundryTaskOptions): LoadedTask {
  const registration = readRegistration(context);
  if (!registration)
    fail(
      "legacy_task_requires_migration",
      "An unregistered task cannot be adopted as current execution state.",
    );
  const raw = readTaskJson(context, "foundry-job.json");
  exact(raw, [
    "schema",
    "workspace_id",
    "task_id",
    "actor_id",
    "request_id",
    "lane",
    "target_profile",
    "target_entities",
    "source_manifest",
    "profile_lock",
    "seed_manifest",
    "runtime_identity",
    "write_policy",
    "created_at_utc",
  ]);
  if (raw.schema !== "tiangong-foundry.job.v2")
    fail("legacy_task_requires_migration", "Existing task schema must be migrated explicitly.");
  if (raw.workspace_id !== context.workspaceId || raw.task_id !== context.taskId)
    fail("task_binding_mismatch", "Task storage belongs to another workspace or task.");
  if (raw.actor_id !== context.actorId)
    fail("task_actor_mismatch", "Task actor does not match the stored task intent.");
  if (!bytes(raw).equals(bytes(registration.job)))
    fail("task_snapshot_changed", "Task job differs from its immutable workspace registration.");

  if (
    typeof raw.request_id !== "string" ||
    !raw.request_id ||
    !timestamp(raw.created_at_utc) ||
    !["external-dataset-curated-import", "source-evidence-dataset-development"].includes(
      String(raw.lane),
    ) ||
    typeof raw.target_profile !== "string" ||
    !Array.isArray(raw.target_entities) ||
    !raw.target_entities.length ||
    raw.target_entities.some((kind) => typeof kind !== "string" || !entityTypes.has(kind))
  )
    fail("task_document_invalid", "Task job metadata is malformed.");
  if (
    (options.requestId && options.requestId !== raw.request_id) ||
    (options.lane && options.lane !== raw.lane) ||
    (options.profileId && options.profileId !== raw.target_profile) ||
    options.targetEntities?.some((kind) => !(raw.target_entities as string[]).includes(kind))
  )
    fail("task_request_mismatch", "Task request, lane, profile or entity scope changed.");
  if (sha256Json(raw.runtime_identity) !== sha256Json(runtimeIdentity(context)))
    fail(
      "task_runtime_changed",
      "Task runtime identity changed; use the pinned runtime or an explicit migration.",
    );
  if (sha256Json(raw.write_policy) !== sha256Json({ mode: "dry-run", remote_state_code: 0 }))
    fail("task_write_policy_invalid", "Task metadata cannot grant remote write authority.");
  const sourceRef = reference(raw.source_manifest, "source-manifest.json");
  const profileRef = reference(raw.profile_lock, "profile-lock.json");
  const sourceBytes = readTaskBytes(context, sourceRef.path);
  const lockedBytes = readTaskBytes(context, profileRef.path);
  if (digest(sourceBytes) !== sourceRef.sha256 || digest(lockedBytes) !== profileRef.sha256)
    fail("task_snapshot_changed", "Task source or profile snapshot bytes changed.");
  const source = object(JSON.parse(sourceBytes.toString("utf8")));
  exact(source, ["schema", "workspace_id", "task_id", "source_kind", "source_paths"]);
  if (
    source.schema !== "tiangong-foundry.source-manifest.v2" ||
    source.workspace_id !== context.workspaceId ||
    source.task_id !== context.taskId ||
    source.source_kind !== "selected-local-files"
  )
    fail("task_source_invalid", "Source manifest does not match this task.");
  const sourceFacts = facts(source.source_paths);
  if (sourceFacts.some((fact) => !path.isAbsolute(fact.path)))
    fail("task_source_invalid", "Original source paths must be canonical absolute selections.");
  if (!lockedBytes.equals(bytes(profileLock(context, raw.target_profile))))
    fail("task_profile_changed", "Current profile rules differ from the immutable task lock.");
  if (raw.seed_manifest !== null) {
    const seedRef = reference(raw.seed_manifest, "seed-manifest.json");
    if (digest(readTaskBytes(context, seedRef.path)) !== seedRef.sha256)
      fail("task_snapshot_changed", "Seed manifest bytes changed.");
  } else if (raw.lane === "source-evidence-dataset-development")
    fail("task_seed_required", "Source-evidence authoring requires its frozen seed manifest.");
  const publicationPath = resolveFoundryOutput(
    context,
    `task-publications/${context.taskId}.json`,
    "state",
  );
  const publication = bytes({
    schema: "tiangong-foundry.task-publication.v1",
    workspace_id: context.workspaceId,
    task_id: context.taskId,
    job_sha256: digest(bytes(registration.job)),
  });
  if (fs.existsSync(publicationPath)) {
    if (
      !fs.lstatSync(publicationPath).isFile() ||
      !fs.readFileSync(publicationPath).equals(publication)
    )
      fail("task_publication_changed", "Task publication evidence changed.");
  } else {
    const allowed = new Set([
      "foundry-job.json",
      "source-manifest.json",
      "profile-lock.json",
      "artifact-index.jsonl",
      ...(raw.seed_manifest ? ["seed-manifest.json"] : []),
    ]);
    if (
      fs.readdirSync(context.taskRoot!).some((name) => !allowed.has(name)) ||
      readTaskBytes(context, "artifact-index.jsonl").length > 0
    )
      fail(
        "task_initialization_ambiguous",
        "Missing task publication evidence cannot be repaired over existing operation or attempt state.",
      );
    writeStateOnce(context, `task-publications/${context.taskId}.json`, publication);
  }
  return {
    job: raw as unknown as FoundryTaskJob,
    jobSha256: digest(readTaskBytes(context, "foundry-job.json")),
    sources: sourceFacts,
  };
}

export function createTask(
  context: FoundryRuntimeContext,
  options: FoundryTaskOptions,
): LoadedTask {
  assertFoundryWorkspaceWrite(context);
  assertPendingFoundryTaskIntent(
    context,
    context.taskId!,
    options.requestId ?? context.taskId!,
    context.actorId!,
  );
  const target = context.taskRoot!;
  if (
    fs.existsSync(
      resolveFoundryOutput(context, `task-publications/${context.taskId}.json`, "state"),
    )
  )
    fail(
      "task_state_missing",
      "Published task state is missing; restore or audit it rather than resetting its ledger.",
    );
  if (fs.existsSync(target))
    fail(
      "legacy_task_requires_migration",
      "An existing unversioned task directory cannot be adopted or overwritten.",
    );
  for (const fact of context.inputs)
    if (!sameFact(captureFoundryInput(fact.path), fact))
      fail("input_changed", "Selected source changed before task creation.");
  const lane = options.lane ?? "external-dataset-curated-import";
  const profileId = options.profileId ?? "generic";
  if (
    !["external-dataset-curated-import", "source-evidence-dataset-development"].includes(lane) ||
    (options.requestId !== undefined &&
      (typeof options.requestId !== "string" ||
        !options.requestId ||
        options.requestId.length > 256))
  )
    fail("task_request_invalid", "Task lane and request identity are invalid.");
  const targets = [...new Set(options.targetEntities ?? ["flow", "process", "support"])];
  if (!targets.length || targets.some((kind) => !entityTypes.has(kind)))
    fail("task_entities_invalid", "Task target entity types are invalid.");
  if (lane === "source-evidence-dataset-development" && !options.seed)
    fail("task_seed_required", "Source-evidence authoring requires a seed manifest.");
  let source: SourceManifest = {
    schema: "tiangong-foundry.source-manifest.v2",
    workspace_id: context.workspaceId!,
    task_id: context.taskId!,
    source_kind: "selected-local-files",
    source_paths: context.inputs.map((fact) => ({ ...fact })),
  };
  let locked = profileLock(context, profileId);
  let seed = options.seed ?? null;
  let sourceBytes = bytes(source);
  let profileBytes = bytes(locked);
  let seedBytes = seed ? bytes(seed) : null;
  let job: FoundryTaskJob = {
    schema: "tiangong-foundry.job.v2",
    workspace_id: context.workspaceId!,
    task_id: context.taskId!,
    actor_id: context.actorId!,
    request_id: options.requestId ?? context.taskId!,
    lane,
    target_profile: profileId,
    target_entities: targets,
    source_manifest: { path: "source-manifest.json", sha256: digest(sourceBytes) },
    profile_lock: { path: "profile-lock.json", sha256: digest(profileBytes) },
    seed_manifest: seedBytes ? { path: "seed-manifest.json", sha256: digest(seedBytes) } : null,
    runtime_identity: runtimeIdentity(context),
    write_policy: { mode: "dry-run", remote_state_code: 0 },
    created_at_utc: new Date().toISOString(),
  };
  const registered = readRegistration(context);
  if (registered) {
    if (
      sha256Json(registered.source_manifest) !== sha256Json(source) ||
      registered.job.target_profile !== profileId ||
      registered.job.lane !== lane ||
      sha256Json(registered.job.target_entities) !== sha256Json(targets) ||
      registered.job.request_id !== job.request_id ||
      sha256Json(registered.seed_manifest) !== sha256Json(seed)
    )
      fail(
        "task_initialization_mismatch",
        "Interrupted task initialization requires the same original intent and input scope.",
      );
    job = registered.job;
    source = registered.source_manifest;
    locked = registered.profile_lock;
    seed = registered.seed_manifest;
    sourceBytes = bytes(source);
    profileBytes = bytes(locked);
    seedBytes = seed ? bytes(seed) : null;
  }
  if (
    [sourceBytes, profileBytes, bytes(job), ...(seedBytes ? [seedBytes] : [])].some(
      (content) => content.length > maxDocumentBytes,
    )
  )
    fail("task_document_limit", "Task metadata exceeds its bounded document limit.");
  const staging = resolveFoundryOutput(
    context,
    `task-initialization/${context.taskId}-${randomUUID()}`,
    "state",
  );
  fs.mkdirSync(staging, { recursive: true, mode: 0o700 });
  const documents: [string, Buffer][] = [
    ["source-manifest.json", sourceBytes],
    ["profile-lock.json", profileBytes],
    ["foundry-job.json", bytes(job)],
    ["artifact-index.jsonl", Buffer.alloc(0)],
  ];
  if (seedBytes) documents.push(["seed-manifest.json", seedBytes]);
  for (const [name, content] of documents) {
    const fd = fs.openSync(path.join(staging, name), "wx", 0o600);
    try {
      fs.writeFileSync(fd, content);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
  }
  const registration = {
    schema: "tiangong-foundry.task-registration.v1" as const,
    job,
    source_manifest: source,
    profile_lock: locked,
    seed_manifest: seed,
  };
  writeStateOnce(
    context,
    `task-registrations/${context.taskId}.json`,
    bytes({ ...registration, registration_sha256: sha256Json(registration) }),
  );
  taskPath(context, target);
  if (fs.existsSync(target))
    fail(
      "task_creation_conflict",
      "A task appeared during initialization; preserve both records and revalidate.",
    );
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  taskPath(context, target);
  fs.renameSync(staging, target);
  return loadTask(context, options);
}

export function bindAccountIntent(context: FoundryRuntimeContext): void {
  const taskFile = taskPath(context, "account-intent.json");
  const statePath = resolveFoundryOutput(context, `task-accounts/${context.taskId}.json`, "state");
  const intent = context.accountIntent;
  let registered: Buffer | null = null;
  if (fs.existsSync(statePath)) {
    const stat = fs.lstatSync(statePath);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 64 * 1024)
      fail("task_account_invalid", "Task account registration is not a bounded regular file.");
    registered = fs.readFileSync(statePath);
    let stored: JsonRecord;
    try {
      stored = object(JSON.parse(registered.toString("utf8")));
    } catch {
      fail("task_account_invalid", "Task account registration is malformed.");
    }
    exact(stored, ["schema", "workspace_id", "task_id", "project_ref", "user_id"]);
    if (
      stored.schema !== "tiangong-foundry.account-intent.v1" ||
      stored.workspace_id !== context.workspaceId ||
      stored.task_id !== context.taskId ||
      typeof stored.project_ref !== "string" ||
      !/^[a-z0-9]{20}$/u.test(stored.project_ref) ||
      typeof stored.user_id !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(stored.user_id)
    )
      fail("task_account_invalid", "Task account registration does not match this task.");
    if (intent && (stored.project_ref !== intent.projectRef || stored.user_id !== intent.userId))
      fail("task_account_mismatch", "Task account intent cannot change implicitly.");
  } else if (intent) {
    registered = bytes({
      schema: "tiangong-foundry.account-intent.v1",
      workspace_id: context.workspaceId,
      task_id: context.taskId,
      project_ref: intent.projectRef,
      user_id: intent.userId,
    });
    writeStateOnce(context, `task-accounts/${context.taskId}.json`, registered);
  }
  if (fs.existsSync(taskFile)) {
    if (!registered || !registered.equals(readTaskBytes(context, taskFile)))
      fail("task_account_changed", "Task account intent differs from its workspace registration.");
  } else if (registered) {
    // Complete only this already registered account binding after an interrupted local write.
    writeFoundryArtifact(context, taskFile, registered);
  }
}

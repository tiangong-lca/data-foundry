import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  captureFoundryInput,
  resolveFoundryInputPath,
  resolveFoundryOutput,
  writeFoundryArtifact,
  type FoundryInputFact,
  type FoundryRuntimeContext,
} from "./foundry-runtime-context.ts";
import {
  assertVerifiedFoundryIdentity,
  type VerifiedFoundryIdentity,
} from "./foundry-runtime-identity.ts";
import { withFoundryTaskMetadata } from "./foundry-task-store.ts";
import {
  bytes,
  digest,
  exact,
  fail,
  object,
  readTaskBytes,
  reference,
  shaPattern,
  taskPath,
} from "./foundry-task-io.ts";
import {
  validateTaskAuthorization,
  type TaskAuthorizationBinding,
  type ValidatedTaskAuthorization,
} from "./task-authorization.ts";
import { sha256Json } from "./identity-preflight-proof.ts";
import type { LoadedTask } from "./foundry-task-types.ts";

export interface TaskApprovalEvidence {
  id: string;
  kind: "user-decision" | "source-model";
  file: FoundryInputFact;
}
interface EvidenceRegistration extends TaskApprovalEvidence {
  snapshot: { path: string; sha256: string };
}
interface ApprovalRegistration {
  schema: "tiangong-foundry.authorization-registration.v1";
  job_sha256: string;
  authorization_sha256: string;
  input: FoundryInputFact;
  grant: { path: string; sha256: string };
  evidence: EvidenceRegistration[];
  identity: { project_ref: string; user_id: string };
}

function inputFact(context: FoundryRuntimeContext, file: string): FoundryInputFact {
  const resolved = resolveFoundryInputPath(context, file);
  return context.inputs.find((fact) => fact.path === resolved)!;
}

function binding(
  context: FoundryRuntimeContext,
  task: LoadedTask,
  input: FoundryInputFact,
): TaskAuthorizationBinding {
  if (!context.accountIntent)
    fail("account_intent_required", "Authorization requires an explicit task account intent.");
  const locked = object(JSON.parse(readTaskBytes(context, "profile-lock.json").toString("utf8")));
  if (typeof locked.profile_sha256 !== "string" || !shaPattern.test(locked.profile_sha256))
    fail("task_profile_changed", "Profile lock lacks a current content identity.");
  return {
    workspace_id: context.workspaceId!,
    task_id: context.taskId!,
    actor_id: context.actorId!,
    project_ref: context.accountIntent.projectRef,
    user_id: context.accountIntent.userId,
    profile_id: task.job.target_profile,
    profile_sha256: locked.profile_sha256,
    input_scope_sha256: input.sha256,
  };
}

function readEvidence(context: FoundryRuntimeContext, fact: FoundryInputFact): Buffer {
  const sessionReference = context.accountIntent?.sessionReference;
  const sessionPath =
    sessionReference && fs.existsSync(sessionReference)
      ? fs.realpathSync(sessionReference)
      : sessionReference;
  if (fact.path === sessionPath || fact.bytes > 8 * 1024 * 1024)
    fail(
      "authorization_evidence_invalid",
      "Approval evidence must be a bounded non-credential file.",
    );
  const current = captureFoundryInput(fact.path);
  if (current.path !== fact.path || current.bytes !== fact.bytes || current.sha256 !== fact.sha256)
    fail(
      "authorization_evidence_changed",
      "Approval/source evidence differs from the independently selected content fact.",
    );
  const data = fs.readFileSync(fact.path);
  if (data.length !== fact.bytes || digest(data) !== fact.sha256)
    fail("authorization_evidence_changed", "Approval evidence changed while it was read.");
  return data;
}

function registrationPath(context: FoundryRuntimeContext, authorizationSha256: string): string {
  if (!shaPattern.test(authorizationSha256))
    fail("task_authorization_unregistered", "Authorization identity must be a content digest.");
  return resolveFoundryOutput(
    context,
    `task-authorizations/${context.taskId}/${authorizationSha256}.json`,
    "state",
  );
}

function writeRegistration(
  context: FoundryRuntimeContext,
  registration: ApprovalRegistration,
): Buffer {
  const target = registrationPath(context, registration.authorization_sha256);
  const content = bytes(registration);
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  resolveFoundryOutput(context, target, "state");
  if (fs.existsSync(target)) {
    const stat = fs.lstatSync(target);
    if (!stat.isFile() || stat.isSymbolicLink() || !fs.readFileSync(target).equals(content))
      fail(
        "authorization_registration_conflict",
        "An approved grant identity cannot be replaced with different evidence.",
      );
    return content;
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
  return content;
}

function setActiveAuthorization(
  context: FoundryRuntimeContext,
  content: Buffer,
  expectedPreviousSha256: string | null,
): void {
  const target = taskPath(context, "authorization.json");
  const existing = fs.existsSync(target) ? readTaskBytes(context, target) : null;
  if (existing?.equals(content)) return;
  if (existing) {
    const pointer = object(JSON.parse(existing.toString("utf8")));
    if (pointer.schema !== "tiangong-foundry.authorization-pointer.v1")
      fail(
        "legacy_authorization_requires_migration",
        "Legacy authorization files must be mapped explicitly, not overwritten.",
      );
  }
  if ((existing ? digest(existing) : null) !== expectedPreviousSha256)
    fail(
      "authorization_update_conflict",
      "Active authorization changed; review the current pointer before replacing it.",
    );
  const temp = taskPath(context, `.authorization-${randomUUID()}.tmp`);
  const fd = fs.openSync(temp, "wx", 0o600);
  try {
    fs.writeFileSync(fd, content);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  try {
    const current = fs.existsSync(target) ? readTaskBytes(context, target) : null;
    if ((current ? digest(current) : null) !== expectedPreviousSha256)
      fail(
        "authorization_update_conflict",
        "Authorization pointer changed outside the metadata lock.",
      );
    if (current) fs.renameSync(temp, target);
    else fs.linkSync(temp, target);
  } finally {
    if (fs.existsSync(temp)) fs.unlinkSync(temp);
  }
}

/** Explicit host approval boundary. Evidence selections come from the trusted caller, never from grant text. */
export async function registerFoundryTaskAuthorization(
  context: FoundryRuntimeContext,
  identity: VerifiedFoundryIdentity,
  options: {
    inputFile: string;
    grant: unknown;
    evidence: readonly TaskApprovalEvidence[];
    expectedPreviousSha256?: string | null;
  },
): Promise<{ authorization_sha256: string; pointer_sha256: string }> {
  assertVerifiedFoundryIdentity(context, identity);
  return withFoundryTaskMetadata(context, (task) => {
    assertVerifiedFoundryIdentity(context, identity);
    const input = inputFact(context, options.inputFile);
    const result = validateTaskAuthorization(options.grant, binding(context, task, input));
    if (result.status !== "authorized")
      fail(
        result.blockers[0]?.code ?? "task_authorization_required",
        result.blockers[0]?.message ?? "Explicit task authorization is required.",
      );
    const authorization = result.authorization;
    if (
      options.evidence.length !== authorization.evidence.length ||
      new Set(options.evidence.map((entry) => entry.id)).size !== options.evidence.length
    )
      fail(
        "authorization_evidence_invalid",
        "Every grant evidence item needs one independent host selection.",
      );
    const selected = authorization.evidence.map((entry) => {
      const expected = options.evidence.find((value) => value.id === entry.id);
      const requested = path.isAbsolute(entry.reference)
        ? path.resolve(entry.reference)
        : taskPath(context, entry.reference);
      if (
        !expected ||
        expected.kind !== entry.kind ||
        expected.file.sha256 !== entry.sha256 ||
        expected.file.path !== requested
      )
        fail(
          "authorization_evidence_invalid",
          "Grant evidence does not match the independent host selection.",
        );
      return { entry, expected, data: readEvidence(context, expected.file) };
    });
    const grantPath = `evidence/authorizations/${authorization.authorization_sha256}/grant.json`;
    const grantBytes = bytes(options.grant);
    const registeredEvidence: EvidenceRegistration[] = [];
    for (const { entry, expected, data } of selected) {
      const snapshotPath = `evidence/authorizations/${authorization.authorization_sha256}/sources/${sha256Json(entry.id)}.bin`;
      writeFoundryArtifact(context, snapshotPath, data);
      registeredEvidence.push({
        id: entry.id,
        kind: entry.kind,
        file: { ...expected.file },
        snapshot: { path: snapshotPath, sha256: digest(data) },
      });
    }
    writeFoundryArtifact(context, grantPath, grantBytes);
    const registration: ApprovalRegistration = {
      schema: "tiangong-foundry.authorization-registration.v1",
      job_sha256: task.jobSha256,
      authorization_sha256: authorization.authorization_sha256,
      input: { ...input },
      grant: { path: grantPath, sha256: digest(grantBytes) },
      evidence: registeredEvidence,
      identity: {
        project_ref: identity.receipt.project.project_ref,
        user_id: identity.receipt.identity.user_id,
      },
    };
    assertVerifiedFoundryIdentity(context, identity);
    if (
      validateTaskAuthorization(options.grant, binding(context, task, input)).status !==
      "authorized"
    )
      fail(
        "task_authorization_invalid",
        "Authorization expired or changed before it could be activated.",
      );
    const registrationBytes = writeRegistration(context, registration);
    const pointer = bytes({
      schema: "tiangong-foundry.authorization-pointer.v1",
      authorization_sha256: authorization.authorization_sha256,
      registration_sha256: digest(registrationBytes),
    });
    setActiveAuthorization(context, pointer, options.expectedPreviousSha256 ?? null);
    return {
      authorization_sha256: authorization.authorization_sha256,
      pointer_sha256: digest(pointer),
    };
  });
}

export async function loadFoundryTaskAuthorization(
  context: FoundryRuntimeContext,
  identity: VerifiedFoundryIdentity,
  inputFile: string,
): Promise<ValidatedTaskAuthorization> {
  assertVerifiedFoundryIdentity(context, identity);
  return withFoundryTaskMetadata(context, (task) => {
    assertVerifiedFoundryIdentity(context, identity);
    const input = inputFact(context, inputFile);
    if (!fs.existsSync(taskPath(context, "authorization.json")))
      fail("task_authorization_required", "This task has no active registered authorization.");
    const pointer = object(
      JSON.parse(readTaskBytes(context, "authorization.json").toString("utf8")),
    );
    exact(pointer, ["schema", "authorization_sha256", "registration_sha256"]);
    if (
      pointer.schema !== "tiangong-foundry.authorization-pointer.v1" ||
      typeof pointer.authorization_sha256 !== "string"
    )
      fail(
        "task_authorization_unregistered",
        "Only explicitly registered task authorization can be loaded.",
      );
    const statePath = registrationPath(context, pointer.authorization_sha256);
    const stat = fs.lstatSync(statePath);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 8 * 1024 * 1024)
      fail(
        "task_authorization_unregistered",
        "Authorization registration is not a bounded regular file.",
      );
    const registrationBytes = fs.readFileSync(statePath);
    if (digest(registrationBytes) !== pointer.registration_sha256)
      fail("authorization_registration_changed", "Authorization registration content changed.");
    const registration = object(JSON.parse(registrationBytes.toString("utf8")));
    exact(registration, [
      "schema",
      "job_sha256",
      "authorization_sha256",
      "input",
      "grant",
      "evidence",
      "identity",
    ]);
    if (
      registration.schema !== "tiangong-foundry.authorization-registration.v1" ||
      registration.job_sha256 !== task.jobSha256 ||
      registration.authorization_sha256 !== pointer.authorization_sha256 ||
      sha256Json(registration.input) !== sha256Json(input) ||
      sha256Json(registration.identity) !==
        sha256Json({
          project_ref: identity.receipt.project.project_ref,
          user_id: identity.receipt.identity.user_id,
        })
    )
      fail(
        "task_authorization_binding_mismatch",
        "Registered authorization does not match current task inputs and account.",
      );
    const grantRef = reference(registration.grant);
    const grantBytes = readTaskBytes(context, grantRef.path);
    if (digest(grantBytes) !== grantRef.sha256)
      fail("task_authorization_changed", "Approved grant snapshot changed.");
    const result = validateTaskAuthorization(
      JSON.parse(grantBytes.toString("utf8")),
      binding(context, task, input),
    );
    if (
      result.status !== "authorized" ||
      result.authorization.authorization_sha256 !== pointer.authorization_sha256
    )
      fail(
        "task_authorization_invalid",
        "Approved grant is expired, invalid or no longer bound to current intent.",
      );
    if (
      !Array.isArray(registration.evidence) ||
      registration.evidence.length !== result.authorization.evidence.length ||
      new Set(registration.evidence.map((entry) => object(entry).id)).size !==
        registration.evidence.length
    )
      fail("authorization_evidence_invalid", "Registered approval evidence is incomplete.");
    for (const raw of registration.evidence) {
      const selected = object(raw);
      exact(selected, ["id", "kind", "file", "snapshot"]);
      const file = object(selected.file);
      exact(file, ["path", "bytes", "sha256"]);
      if (
        typeof file.path !== "string" ||
        !path.isAbsolute(file.path) ||
        typeof file.bytes !== "number" ||
        !Number.isSafeInteger(file.bytes) ||
        file.bytes < 0 ||
        typeof file.sha256 !== "string" ||
        !shaPattern.test(file.sha256)
      )
        fail("authorization_evidence_invalid", "Registered evidence fact is malformed.");
      const actual = readEvidence(context, {
        path: file.path,
        bytes: file.bytes,
        sha256: file.sha256,
      });
      const snapshot = reference(selected.snapshot);
      const snapshotBytes = readTaskBytes(context, snapshot.path);
      if (!snapshotBytes.equals(actual) || digest(snapshotBytes) !== snapshot.sha256)
        fail(
          "authorization_evidence_changed",
          "Approved evidence snapshot or original source changed.",
        );
      const proof = result.authorization.evidence.find((entry) => entry.id === selected.id);
      const evidencePath = proof
        ? path.isAbsolute(proof.reference)
          ? path.resolve(proof.reference)
          : taskPath(context, proof.reference)
        : null;
      if (
        !proof ||
        proof.kind !== selected.kind ||
        proof.sha256 !== file.sha256 ||
        evidencePath !== file.path
      )
        fail("authorization_evidence_invalid", "Grant and selected evidence no longer agree.");
    }
    assertVerifiedFoundryIdentity(context, identity);
    const refreshed = validateTaskAuthorization(
      JSON.parse(grantBytes.toString("utf8")),
      binding(context, task, input),
    );
    if (refreshed.status !== "authorized")
      fail(
        "task_authorization_invalid",
        "Task authorization expired during evidence verification.",
      );
    return refreshed.authorization;
  });
}

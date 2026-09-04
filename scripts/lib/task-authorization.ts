import { sha256Json } from "./identity-preflight-proof.ts";

export const taskAuthorizationActions = [
  "elementary_flow_write",
  "elementary_flow_create_new",
  "flowproperty_write",
  "unitgroup_write",
  "canonical_support_local_mint",
] as const;

export type TaskAuthorizationAction = (typeof taskAuthorizationActions)[number];

export interface TaskAuthorizationBinding {
  workspace_id: string;
  task_id: string;
  actor_id: string;
  project_ref: string;
  user_id: string;
  profile_id: string;
  profile_sha256: string;
  input_scope_sha256: string;
}

interface AuthorizationEvidence {
  id: string;
  kind: "user-decision" | "source-model";
  reference: string;
  sha256: string;
}

interface QaWaiver {
  dataset_type: "process";
  code: "process_material_balance_deviation";
  evidence_ids: readonly string[];
}

export interface ValidatedTaskAuthorization {
  readonly schema: "tiangong-foundry.task-authorization.v1";
  readonly binding: Readonly<TaskAuthorizationBinding>;
  readonly issued_at_utc: string;
  readonly expires_at_utc: string;
  readonly remote_state_code: 0;
  readonly allowed_actions: readonly TaskAuthorizationAction[];
  readonly qa_waivers: readonly Readonly<QaWaiver>[];
  readonly evidence: readonly Readonly<AuthorizationEvidence>[];
  readonly authorization_sha256: string;
}

export type TaskAuthorizationResult =
  | { status: "authorized"; authorization: ValidatedTaskAuthorization; blockers: [] }
  | {
      status: "missing" | "invalid";
      authorization: null;
      blockers: { code: string; message: string }[];
    };

const validated = new WeakSet<object>();
const hashPattern = /^[0-9a-f]{64}$/u;
const idPattern = /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,255}$/u;
const bindingKeys = [
  "workspace_id",
  "task_id",
  "actor_id",
  "project_ref",
  "user_id",
  "profile_id",
  "profile_sha256",
  "input_scope_sha256",
] as const;
const maxLifetimeMs = 24 * 60 * 60 * 1_000;

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return (
    Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key))
  );
}

function bindingIsValid(value: unknown): value is TaskAuthorizationBinding {
  const item = record(value);
  return (
    item !== null &&
    exactKeys(item, bindingKeys) &&
    bindingKeys.every(
      (key) =>
        typeof item[key] === "string" &&
        (key.endsWith("_sha256") ? hashPattern : idPattern).test(item[key]),
    )
  );
}

function timeIsValid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value
  );
}

function refused(code: string, message: string): TaskAuthorizationResult {
  return { status: "invalid", authorization: null, blockers: [{ code, message }] };
}

/** Validate explicit local approval against independently assembled current task intent.
 * This is neither an identity verifier nor remote write/replay authority. The caller owns
 * current input hashes and fresh CLI identity; a serialized result cannot act as approval.
 */
export function validateTaskAuthorization(
  value: unknown,
  expected: TaskAuthorizationBinding,
  nowMs = Date.now(),
): TaskAuthorizationResult {
  if (value === null || value === undefined) {
    return { status: "missing", authorization: null, blockers: [] };
  }
  const item = record(value);
  if (
    !item ||
    !exactKeys(item, [
      "schema",
      "binding",
      "issued_at_utc",
      "expires_at_utc",
      "remote_state_code",
      "allowed_actions",
      "qa_waivers",
      "evidence",
    ]) ||
    item.schema !== "tiangong-foundry.task-authorization.v1" ||
    item.remote_state_code !== 0
  ) {
    return refused(
      "task_authorization_invalid",
      "Task authorization must use the exact v1 draft-only contract.",
    );
  }
  const binding = item.binding;
  if (
    !bindingIsValid(binding) ||
    !bindingIsValid(expected) ||
    bindingKeys.some((key) => binding[key] !== expected[key])
  ) {
    return refused(
      "task_authorization_binding_mismatch",
      "Task authorization does not match current workspace, task, actor, account, profile and input scope.",
    );
  }
  if (
    !timeIsValid(item.issued_at_utc) ||
    !timeIsValid(item.expires_at_utc) ||
    !Number.isFinite(nowMs)
  ) {
    return refused(
      "task_authorization_time_invalid",
      "Task authorization requires exact UTC issue and expiry times.",
    );
  }
  const issued = Date.parse(item.issued_at_utc);
  const expires = Date.parse(item.expires_at_utc);
  if (
    issued > nowMs + 5_000 ||
    expires <= nowMs ||
    expires <= issued ||
    expires - issued > maxLifetimeMs
  ) {
    return refused(
      "task_authorization_expired",
      "Task authorization must be current and expire within 24 hours of issue.",
    );
  }
  if (
    !Array.isArray(item.allowed_actions) ||
    item.allowed_actions.length > taskAuthorizationActions.length ||
    new Set(item.allowed_actions).size !== item.allowed_actions.length ||
    item.allowed_actions.some((action) => !taskAuthorizationActions.includes(action))
  ) {
    return refused(
      "task_authorization_actions_invalid",
      "Task authorization contains duplicate or unsupported actions.",
    );
  }
  if (!Array.isArray(item.evidence) || item.evidence.length === 0 || item.evidence.length > 32) {
    return refused(
      "task_authorization_evidence_required",
      "Explicit approval evidence is required for task exceptions.",
    );
  }
  const evidence: AuthorizationEvidence[] = [];
  for (const entry of item.evidence) {
    const proof = record(entry);
    if (
      !proof ||
      !exactKeys(proof, ["id", "kind", "reference", "sha256"]) ||
      typeof proof.id !== "string" ||
      !idPattern.test(proof.id) ||
      !["user-decision", "source-model"].includes(String(proof.kind)) ||
      typeof proof.reference !== "string" ||
      !proof.reference.trim() ||
      proof.reference.length > 2_048 ||
      typeof proof.sha256 !== "string" ||
      !hashPattern.test(proof.sha256) ||
      evidence.some((prior) => prior.id === proof.id)
    ) {
      return refused(
        "task_authorization_evidence_invalid",
        "Task authorization evidence must be unique and content-bound.",
      );
    }
    evidence.push({
      id: proof.id,
      kind: proof.kind as AuthorizationEvidence["kind"],
      reference: proof.reference,
      sha256: proof.sha256,
    });
  }
  if (!evidence.some((entry) => entry.kind === "user-decision")) {
    return refused(
      "task_authorization_approval_required",
      "Source model evidence alone cannot authorize an exception.",
    );
  }
  if (!Array.isArray(item.qa_waivers) || item.qa_waivers.length > 1) {
    return refused(
      "task_authorization_qa_waiver_invalid",
      "Only the evidence-bound process material-balance observation is supported.",
    );
  }
  const qaWaivers: QaWaiver[] = [];
  for (const entry of item.qa_waivers) {
    const waiver = record(entry);
    if (
      !waiver ||
      !exactKeys(waiver, ["dataset_type", "code", "evidence_ids"]) ||
      waiver.dataset_type !== "process" ||
      waiver.code !== "process_material_balance_deviation" ||
      !Array.isArray(waiver.evidence_ids) ||
      waiver.evidence_ids.length === 0 ||
      new Set(waiver.evidence_ids).size !== waiver.evidence_ids.length ||
      waiver.evidence_ids.some((id) => !evidence.some((proof) => proof.id === id)) ||
      !waiver.evidence_ids.some((id) =>
        evidence.some((proof) => proof.id === id && proof.kind === "source-model"),
      )
    ) {
      return refused(
        "task_authorization_qa_waiver_invalid",
        "Material-balance observation requires exact source-model evidence; other QA and safety checks remain blocking.",
      );
    }
    qaWaivers.push({
      dataset_type: "process",
      code: "process_material_balance_deviation",
      evidence_ids: Object.freeze([...waiver.evidence_ids]),
    });
  }
  const authorization: ValidatedTaskAuthorization = Object.freeze({
    schema: "tiangong-foundry.task-authorization.v1",
    binding: Object.freeze({ ...expected }),
    issued_at_utc: item.issued_at_utc,
    expires_at_utc: item.expires_at_utc,
    remote_state_code: 0,
    allowed_actions: Object.freeze([...item.allowed_actions] as TaskAuthorizationAction[]),
    qa_waivers: Object.freeze(qaWaivers.map((waiver) => Object.freeze(waiver))),
    evidence: Object.freeze(evidence.map((proof) => Object.freeze(proof))),
    authorization_sha256: sha256Json(item),
  });
  validated.add(authorization);
  return { status: "authorized", authorization, blockers: [] };
}

export function taskAuthorizationMatches(
  value: unknown,
  expected: unknown,
  nowMs = Date.now(),
): value is ValidatedTaskAuthorization {
  const item = record(value);
  return (
    item !== null &&
    validated.has(item) &&
    bindingIsValid(expected) &&
    bindingKeys.every((key) => (item.binding as TaskAuthorizationBinding)[key] === expected[key]) &&
    Number.isFinite(nowMs) &&
    Date.parse(item.issued_at_utc as string) <= nowMs + 5_000 &&
    Date.parse(item.expires_at_utc as string) > nowMs
  );
}

export function taskAuthorizationAllows(
  value: unknown,
  action: TaskAuthorizationAction,
  nowMs = Date.now(),
): boolean {
  const item = record(value);
  return (
    item !== null &&
    taskAuthorizationMatches(item, item.binding, nowMs) &&
    item.allowed_actions.includes(action)
  );
}

export function taskAuthorizationWaivesQa(
  value: unknown,
  datasetType: string,
  code: string,
  nowMs = Date.now(),
): boolean {
  const item = record(value);
  return (
    item !== null &&
    taskAuthorizationMatches(item, item.binding, nowMs) &&
    item.qa_waivers.some((waiver) => waiver.dataset_type === datasetType && waiver.code === code)
  );
}

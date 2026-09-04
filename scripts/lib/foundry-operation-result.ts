import { FoundryContextError } from "./foundry-runtime-context.ts";

export const FOUNDRY_OPERATION_RESULT_SCHEMA = "tiangong-foundry.operation-result.v1" as const;
export const foundryOperationStatuses = Object.freeze([
  "ready",
  "running",
  "needs_auth",
  "needs_input",
  "blocked",
  "completed",
  "failed",
] as const);
export const foundryOperationPermissionStates = Object.freeze([
  "not_required",
  "required",
  "granted",
  "invalid",
] as const);

export type FoundryOperationStatus = (typeof foundryOperationStatuses)[number];
export type FoundryOperationPermissionState = (typeof foundryOperationPermissionStates)[number];
export type FoundryPublicOperation =
  | "unknown"
  | "workspace.init"
  | "doctor"
  | "task.start"
  | "task.status"
  | "task.resume"
  | "workspace.migrate";

export interface FoundryOperationBlocker {
  readonly code: string;
  readonly message: string;
  readonly scope: string | null;
}

export type FoundryOperationArtifact =
  | Readonly<{
      kind: "file";
      role: string;
      path: string;
      bytes: number;
      sha256: string;
    }>
  | Readonly<{
      kind: "inline";
      role: string;
      bytes: number;
      sha256: string;
      value: unknown;
    }>;

export type FoundryOperationNextAction =
  | Readonly<{ kind: "human"; code: string; instructions: string }>
  | Readonly<{
      kind: "command";
      code: string;
      executable: string;
      argv: readonly string[];
      cwd: string;
      purpose: string;
      binding_sha256: string;
    }>;

export interface FoundryOperationPermissions {
  readonly state: FoundryOperationPermissionState;
  readonly requested_actions: readonly string[];
  readonly approval_reference: string | null;
}

export interface FoundryOperationResult {
  readonly schema: typeof FOUNDRY_OPERATION_RESULT_SCHEMA;
  readonly operation: FoundryPublicOperation;
  readonly status: FoundryOperationStatus;
  readonly task_id: string | null;
  readonly artifacts: readonly FoundryOperationArtifact[];
  readonly blockers: readonly Readonly<FoundryOperationBlocker>[];
  readonly next_actions: readonly FoundryOperationNextAction[];
  readonly runtime_identity: unknown;
  readonly permissions: Readonly<FoundryOperationPermissions>;
}

interface CreateFoundryOperationResultOptions {
  operation: string;
  status: string;
  taskId: string | null;
  artifacts: readonly unknown[];
  blockers: readonly unknown[];
  nextActions: readonly unknown[];
  runtimeIdentity: unknown;
  permissions: unknown;
}

const operations = new Set<FoundryPublicOperation>([
  "unknown",
  "workspace.init",
  "doctor",
  "task.start",
  "task.status",
  "task.resume",
  "workspace.migrate",
]);
const shaPattern = /^[0-9a-f]{64}$/u;
const idPattern = /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,255}$/u;
const credentialKey = /(?:^|_)(?:password|passwd|token|secret|cookie|credential|session)(?:_|$)/iu;

function fail(message: string): never {
  throw new FoundryContextError("operation_result_invalid", message);
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    fail(`${label} must be an object.`);
  return value as Record<string, unknown>;
}

function exact(value: Record<string, unknown>, keys: readonly string[], label: string): void {
  if (Object.keys(value).length !== keys.length || keys.some((key) => !Object.hasOwn(value, key)))
    fail(`${label} has missing or unsupported fields.`);
}

function text(value: unknown, label: string, max = 4_096): string {
  if (typeof value !== "string" || !value || value.length > max || /[\0\r\n]/u.test(value))
    fail(`${label} must be a bounded nonempty single-line string.`);
  return value;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function safeJson(value: unknown, depth = 0): unknown {
  if (depth > 32) fail("Runtime or inline artifact identity exceeds its nesting limit.");
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (Array.isArray(value)) {
    if (value.length > 10_000) fail("Runtime or inline artifact array exceeds its limit.");
    return value.map((item) => safeJson(item, depth + 1));
  }
  const item = record(value, "Runtime or inline artifact value");
  if (Object.keys(item).length > 256) fail("Runtime or inline artifact object exceeds its limit.");
  const result: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(item)) {
    if (!key || key.length > 256 || credentialKey.test(key))
      fail("Operation results cannot contain credential-like fields.");
    result[key] = safeJson(child, depth + 1);
  }
  return result;
}

function artifact(value: unknown): FoundryOperationArtifact {
  const item = record(value, "Operation artifact");
  if (item.kind === "file") {
    exact(item, ["kind", "role", "path", "bytes", "sha256"], "File artifact");
    if (
      !Number.isSafeInteger(item.bytes) ||
      Number(item.bytes) < 0 ||
      typeof item.sha256 !== "string" ||
      !shaPattern.test(item.sha256)
    )
      fail("File artifact requires exact byte and SHA-256 facts.");
    return {
      kind: "file",
      role: text(item.role, "Artifact role", 256),
      path: text(item.path, "Artifact path"),
      bytes: Number(item.bytes),
      sha256: item.sha256,
    };
  }
  if (item.kind === "inline") {
    exact(item, ["kind", "role", "bytes", "sha256", "value"], "Inline artifact");
    const valueJson = safeJson(item.value);
    if (
      !Number.isSafeInteger(item.bytes) ||
      Number(item.bytes) < 0 ||
      typeof item.sha256 !== "string" ||
      !shaPattern.test(item.sha256)
    )
      fail("Inline artifact requires exact byte and SHA-256 facts.");
    return {
      kind: "inline",
      role: text(item.role, "Artifact role", 256),
      bytes: Number(item.bytes),
      sha256: item.sha256,
      value: valueJson,
    };
  }
  return fail("Operation artifact kind is unsupported.");
}

function blocker(value: unknown): FoundryOperationBlocker {
  const item = record(value, "Operation blocker");
  exact(item, ["code", "message", "scope"], "Operation blocker");
  if (item.scope !== null && typeof item.scope !== "string")
    fail("Operation blocker scope must be a string or null.");
  return {
    code: text(item.code, "Blocker code", 256),
    message: text(item.message, "Blocker message", 4_096),
    scope: item.scope === null ? null : text(item.scope, "Blocker scope", 1_024),
  };
}

function nextAction(value: unknown): FoundryOperationNextAction {
  const item = record(value, "Next action");
  if (item.kind === "human") {
    exact(item, ["kind", "code", "instructions"], "Human next action");
    return {
      kind: "human",
      code: text(item.code, "Human action code", 256),
      instructions: text(item.instructions, "Human action instructions", 8_192),
    };
  }
  if (item.kind === "command") {
    exact(
      item,
      ["kind", "code", "executable", "argv", "cwd", "purpose", "binding_sha256"],
      "Command next action",
    );
    if (
      !Array.isArray(item.argv) ||
      item.argv.length > 256 ||
      item.argv.some((token) => typeof token !== "string" || !token || /[\0\r\n]/u.test(token)) ||
      typeof item.binding_sha256 !== "string" ||
      !shaPattern.test(item.binding_sha256)
    )
      fail("Command next action requires bounded argv and an exact binding digest.");
    return {
      kind: "command",
      code: text(item.code, "Command action code", 256),
      executable: text(item.executable, "Command executable"),
      argv: [...item.argv],
      cwd: text(item.cwd, "Command working directory"),
      purpose: text(item.purpose, "Command purpose", 4_096),
      binding_sha256: item.binding_sha256,
    };
  }
  return fail("Next actions must be explicit human or executable-plus-argv records.");
}

function permissions(value: unknown): FoundryOperationPermissions {
  const item = record(value, "Operation permissions");
  exact(item, ["state", "requested_actions", "approval_reference"], "Operation permissions");
  if (
    typeof item.state !== "string" ||
    !foundryOperationPermissionStates.includes(item.state as FoundryOperationPermissionState) ||
    !Array.isArray(item.requested_actions) ||
    item.requested_actions.length > 32 ||
    new Set(item.requested_actions).size !== item.requested_actions.length ||
    item.requested_actions.some(
      (action) => typeof action !== "string" || !idPattern.test(action),
    ) ||
    (item.approval_reference !== null &&
      (typeof item.approval_reference !== "string" || !item.approval_reference))
  )
    fail("Operation permissions have an unsupported state, action or approval reference.");
  return {
    state: item.state as FoundryOperationPermissionState,
    requested_actions: [...item.requested_actions] as string[],
    approval_reference: item.approval_reference,
  };
}

export function assertFoundryOperationResult(value: unknown): FoundryOperationResult {
  const item = record(value, "Operation result");
  exact(
    item,
    [
      "schema",
      "operation",
      "status",
      "task_id",
      "artifacts",
      "blockers",
      "next_actions",
      "runtime_identity",
      "permissions",
    ],
    "Operation result",
  );
  if (
    item.schema !== FOUNDRY_OPERATION_RESULT_SCHEMA ||
    typeof item.operation !== "string" ||
    !operations.has(item.operation as FoundryPublicOperation) ||
    typeof item.status !== "string" ||
    !foundryOperationStatuses.includes(item.status as FoundryOperationStatus) ||
    (item.task_id !== null &&
      (typeof item.task_id !== "string" || !idPattern.test(item.task_id))) ||
    !Array.isArray(item.artifacts) ||
    item.artifacts.length > 10_000 ||
    !Array.isArray(item.blockers) ||
    item.blockers.length > 10_000 ||
    !Array.isArray(item.next_actions) ||
    item.next_actions.length > 1_000
  )
    fail("Operation result has an unsupported identity, status or collection shape.");
  const blockers = item.blockers.map(blocker);
  if (
    (["ready", "running", "completed"].includes(item.status) && blockers.length > 0) ||
    (!["ready", "running", "completed"].includes(item.status) && blockers.length === 0)
  )
    fail("Successful results cannot carry blockers and non-success results require one blocker.");
  const result: FoundryOperationResult = {
    schema: FOUNDRY_OPERATION_RESULT_SCHEMA,
    operation: item.operation as FoundryPublicOperation,
    status: item.status as FoundryOperationStatus,
    task_id: item.task_id,
    artifacts: item.artifacts.map(artifact),
    blockers,
    next_actions: item.next_actions.map(nextAction),
    runtime_identity: safeJson(item.runtime_identity),
    permissions: permissions(item.permissions),
  };
  return deepFreeze(result);
}

export function createFoundryOperationResult(
  options: CreateFoundryOperationResultOptions,
): FoundryOperationResult {
  return assertFoundryOperationResult({
    schema: FOUNDRY_OPERATION_RESULT_SCHEMA,
    operation: options.operation,
    status: options.status,
    task_id: options.taskId,
    artifacts: options.artifacts,
    blockers: options.blockers,
    next_actions: options.nextActions,
    runtime_identity: options.runtimeIdentity,
    permissions: options.permissions,
  });
}

export function exitCodeForFoundryOperationResult(result: FoundryOperationResult): number {
  if (result.blockers.some((item) => item.code === "operation_interrupted")) return 130;
  if (["ready", "running", "completed"].includes(result.status)) return 0;
  if (result.status === "needs_input") return 2;
  if (result.status === "needs_auth") return 3;
  if (result.status === "blocked") return 4;
  return 1;
}

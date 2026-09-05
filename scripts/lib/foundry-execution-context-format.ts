import path from "node:path";
import { exact, object, shaPattern } from "./foundry-task-io.ts";
import { FoundryContextError } from "./foundry-runtime-error.ts";
import type { FoundryInputFact } from "./foundry-runtime-context-types.ts";
import { taskAuthorizationActions, type TaskAuthorizationAction } from "./task-authorization.ts";

function fail(code: string, message: string): never {
  throw new FoundryContextError(code, message);
}
const qaWaiverCode = "process_material_balance_deviation";

export const FOUNDRY_EXECUTION_CAPSULE_SCHEMA = "tiangong-foundry.execution-context.v1" as const;

export interface ExecutionCapsule {
  schema: typeof FOUNDRY_EXECUTION_CAPSULE_SCHEMA;
  workspace_id: string;
  task_id: string;
  actor_id: string;
  command: string;
  qualification_sha256: string;
  authorization_sha256: string;
  approved_input: FoundryInputFact;
  final_rows: FoundryInputFact;
  required_actions: TaskAuthorizationAction[];
  required_qa_waivers: string[];
  command_spec_sha256: string;
}

function requiredQa(value: readonly string[]): readonly string[] {
  if (
    value.length > 1 ||
    new Set(value).size !== value.length ||
    value.some((code) => code !== qaWaiverCode)
  )
    fail(
      "execution_qa_waiver_invalid",
      "Only the evidence-bound process material-balance waiver can enter execution admission.",
    );
  return Object.freeze([...value]);
}

function requiredActions(value: readonly unknown[]): readonly TaskAuthorizationAction[] {
  if (
    value.length > taskAuthorizationActions.length ||
    new Set(value).size !== value.length ||
    value.some(
      (action) =>
        typeof action !== "string" ||
        !taskAuthorizationActions.includes(action as TaskAuthorizationAction),
    ) ||
    [...value].sort().some((action, index) => action !== value[index])
  )
    fail(
      "execution_action_invalid",
      "Execution actions must be a unique, sorted subset of the task authorization contract.",
    );
  return Object.freeze([...value] as TaskAuthorizationAction[]);
}

function parseFact(value: unknown, label: string): FoundryInputFact {
  const fact = object(value);
  exact(fact, ["path", "bytes", "sha256"]);
  if (
    typeof fact.path !== "string" ||
    !path.isAbsolute(fact.path) ||
    typeof fact.bytes !== "number" ||
    !Number.isSafeInteger(fact.bytes) ||
    fact.bytes < 0 ||
    typeof fact.sha256 !== "string" ||
    !shaPattern.test(fact.sha256)
  )
    fail("execution_capsule_invalid", `${label} content fact is malformed.`);
  return Object.freeze({ path: fact.path, bytes: fact.bytes, sha256: fact.sha256 });
}

export function parseCapsule(value: unknown): Readonly<ExecutionCapsule> {
  const item = object(value);
  exact(item, [
    "schema",
    "workspace_id",
    "task_id",
    "actor_id",
    "command",
    "qualification_sha256",
    "authorization_sha256",
    "approved_input",
    "final_rows",
    "required_actions",
    "required_qa_waivers",
    "command_spec_sha256",
  ]);
  if (
    item.schema !== FOUNDRY_EXECUTION_CAPSULE_SCHEMA ||
    typeof item.workspace_id !== "string" ||
    typeof item.task_id !== "string" ||
    typeof item.actor_id !== "string" ||
    typeof item.command !== "string" ||
    typeof item.qualification_sha256 !== "string" ||
    !shaPattern.test(item.qualification_sha256) ||
    typeof item.authorization_sha256 !== "string" ||
    !shaPattern.test(item.authorization_sha256) ||
    !Array.isArray(item.required_actions) ||
    typeof item.command_spec_sha256 !== "string" ||
    !shaPattern.test(item.command_spec_sha256) ||
    !Array.isArray(item.required_qa_waivers)
  )
    fail("execution_capsule_invalid", "Execution capsule has an unsupported shape.");
  return Object.freeze({
    schema: FOUNDRY_EXECUTION_CAPSULE_SCHEMA,
    workspace_id: item.workspace_id,
    task_id: item.task_id,
    actor_id: item.actor_id,
    command: item.command,
    qualification_sha256: item.qualification_sha256,
    authorization_sha256: item.authorization_sha256,
    approved_input: parseFact(item.approved_input, "Approved input"),
    final_rows: parseFact(item.final_rows, "Final rows"),
    required_actions: [...requiredActions(item.required_actions)],
    required_qa_waivers: [...requiredQa(item.required_qa_waivers)],
    command_spec_sha256: item.command_spec_sha256,
  });
}

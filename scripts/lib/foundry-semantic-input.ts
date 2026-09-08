import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import {
  captureFoundryInput,
  FoundryContextError,
  type FoundryInputFact,
  type FoundryRuntimeContext,
} from "./foundry-runtime-context.ts";
import { assertNotFoundrySessionFile, migrationCredentialPath } from "./foundry-private-path.ts";
import { workflowObject } from "./foundry-workflow-state.ts";

export const FOUNDRY_SEMANTIC_INPUT_SCHEMA = "tiangong-foundry.semantic-input.v1" as const;
export interface SemanticSubmission {
  readonly kind: "patch" | "classification" | "location" | "identity";
  readonly authoring_task_sha256: string;
  readonly file: string;
  readonly sha256: string;
}
export type SemanticPatchInput = SemanticSubmission & { readonly kind: "patch" };
export type SemanticDecisionInput = SemanticSubmission & {
  readonly kind: "classification" | "location" | "identity";
};
export interface FoundrySemanticInput {
  schema: typeof FOUNDRY_SEMANTIC_INPUT_SCHEMA;
  task_id: string;
  actor_id: string;
  assessment_sha256: string;
  submissions: readonly SemanticSubmission[];
}
export interface SelectedSemanticInput {
  readonly spec: FoundrySemanticInput;
  readonly descriptor: FoundryInputFact;
  readonly files: readonly FoundryInputFact[];
}
const selectedInputs = new WeakSet<object>();
const sha = /^[0-9a-f]{64}$/u;
function invalid(message: string): never {
  throw new FoundryContextError("task_semantic_input_invalid", message);
}
function exact(value: Record<string, unknown>, keys: readonly string[]) {
  if (Object.keys(value).length !== keys.length || keys.some((key) => !Object.hasOwn(value, key)))
    invalid("Semantic input has missing or unsupported fields.");
}

export function parseFoundrySemanticInput(value: unknown): FoundrySemanticInput {
  const data = workflowObject(value);
  exact(data, ["schema", "task_id", "actor_id", "assessment_sha256", "submissions"]);
  if (
    data.schema !== FOUNDRY_SEMANTIC_INPUT_SCHEMA ||
    typeof data.task_id !== "string" ||
    !/^task-[0-9a-f]{64}-r\d{4}$/u.test(data.task_id) ||
    typeof data.actor_id !== "string" ||
    !/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,255}$/u.test(data.actor_id) ||
    typeof data.assessment_sha256 !== "string" ||
    !sha.test(data.assessment_sha256) ||
    !Array.isArray(data.submissions) ||
    !data.submissions.length ||
    data.submissions.length > 1000
  )
    invalid("Semantic input must bind a task, actor, assessment and bounded submission selection.");
  const submissions = data.submissions.map((item) => {
    const part = workflowObject(item);
    exact(part, ["kind", "authoring_task_sha256", "file", "sha256"]);
    if (
      (part.kind !== "patch" &&
        part.kind !== "classification" &&
        part.kind !== "location" &&
        part.kind !== "identity") ||
      typeof part.authoring_task_sha256 !== "string" ||
      !sha.test(part.authoring_task_sha256) ||
      typeof part.sha256 !== "string" ||
      !sha.test(part.sha256) ||
      typeof part.file !== "string" ||
      !part.file ||
      part.file.length > 4096 ||
      /[\0\r\n]/u.test(part.file)
    )
      invalid("A semantic submission reference is invalid.");
    return Object.freeze({
      kind: part.kind,
      authoring_task_sha256: part.authoring_task_sha256,
      file: part.file,
      sha256: part.sha256,
    });
  });
  if (new Set(submissions.map((part) => part.authoring_task_sha256)).size !== submissions.length)
    invalid("A work item may appear only once in a submission.");
  return Object.freeze({
    schema: FOUNDRY_SEMANTIC_INPUT_SCHEMA,
    task_id: data.task_id,
    actor_id: data.actor_id,
    assessment_sha256: data.assessment_sha256,
    submissions: Object.freeze(submissions),
  });
}

export function readSelectedSemanticBytes(fact: FoundryInputFact): Buffer {
  const fd = fs.openSync(fact.path, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.size !== fact.bytes || stat.size > 8 * 1024 * 1024)
      invalid("Semantic input must be a bounded regular file.");
    const bytes = fs.readFileSync(fd);
    if (
      bytes.length !== fact.bytes ||
      createHash("sha256").update(bytes).digest("hex") !== fact.sha256
    )
      throw new FoundryContextError(
        "semantic_input_changed",
        "Semantic input changed after selection.",
      );
    return bytes;
  } finally {
    fs.closeSync(fd);
  }
}

export function selectFoundrySemanticInput(
  context: FoundryRuntimeContext,
  file: string,
): SelectedSemanticInput {
  let selectedBytes = 0;
  const select = (value: string) => {
    if (!value || value.length > 4096 || /[\0\r\n]/u.test(value))
      invalid("Semantic input path is invalid.");
    const target = path.resolve(context.workspaceRoot, value);
    if (migrationCredentialPath(path.relative(context.workspaceRoot, target)))
      invalid("Credential paths cannot be semantic inputs.");
    assertNotFoundrySessionFile(target, context.accountIntent?.sessionReference);
    const stat = fs.lstatSync(target);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 8 * 1024 * 1024)
      invalid("Semantic input must be a bounded regular file.");
    selectedBytes += stat.size;
    if (selectedBytes > 64 * 1024 * 1024)
      invalid("Semantic submission exceeds the 64 MiB batch limit.");
    return captureFoundryInput(target);
  };
  const descriptor = select(file);
  let spec: FoundrySemanticInput;
  try {
    spec = parseFoundrySemanticInput(
      JSON.parse(readSelectedSemanticBytes(descriptor).toString("utf8")),
    );
  } catch (error) {
    if (error instanceof FoundryContextError && error.code !== "workflow_report_invalid")
      throw error;
    invalid("Semantic input must be a complete supported JSON descriptor.");
  }
  if (spec.task_id !== context.taskId || spec.actor_id !== context.actorId)
    throw new FoundryContextError(
      "semantic_input_scope_mismatch",
      "Submission task or actor differs from this invocation.",
    );
  const files = spec.submissions.map((part) => {
    const fact = select(part.file);
    if (fact.sha256 !== part.sha256)
      throw new FoundryContextError(
        "semantic_input_changed",
        "Patch bytes do not match the submitted digest.",
      );
    readSelectedSemanticBytes(fact);
    return fact;
  });
  if (descriptor.bytes + files.reduce((sum, fact) => sum + fact.bytes, 0) > 64 * 1024 * 1024)
    invalid("Semantic submission exceeds the 64 MiB batch limit.");
  const result = Object.freeze({
    spec,
    descriptor: Object.freeze(descriptor),
    files: Object.freeze(files.map((fact) => Object.freeze(fact))),
  });
  selectedInputs.add(result);
  return result;
}

export function assertSelectedSemanticInput(value: SelectedSemanticInput): void {
  if (!selectedInputs.has(value))
    throw new FoundryContextError(
      "semantic_input_unverified",
      "Select semantic input through the current invocation.",
    );
  readSelectedSemanticBytes(value.descriptor);
  for (const file of value.files) readSelectedSemanticBytes(file);
}

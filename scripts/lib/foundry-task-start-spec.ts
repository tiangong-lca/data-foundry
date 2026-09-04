import path from "node:path";
import type { FoundryInputFact } from "./foundry-runtime-context.ts";
import { FoundryContextError } from "./foundry-runtime-context.ts";
import { sha256Json } from "./identity-preflight-proof.ts";
import type { Lane } from "./foundry-task-types.ts";

export const FOUNDRY_TASK_START_SPEC_SCHEMA = "tiangong-foundry.task-start.v1" as const;

interface SourceSelection {
  readonly path: string;
}

interface AccountIntentSelection {
  readonly project_ref: string;
  readonly user_id: string;
  readonly session_reference: string | null;
}

interface CleanupPreparation {
  readonly operation: "dataset-curation-cleanup";
  readonly type: string;
  readonly input: string;
  readonly source_input: string | null;
  readonly output_directory: string;
}

export interface FoundryTaskStartSpec {
  readonly schema: typeof FOUNDRY_TASK_START_SPEC_SCHEMA;
  readonly request_id: string;
  readonly actor_id: string;
  readonly lane: Lane;
  readonly profile_id: string;
  readonly target_entities: readonly string[];
  readonly sources: readonly Readonly<SourceSelection>[];
  readonly seed: Readonly<SourceSelection> | null;
  readonly account_intent: Readonly<AccountIntentSelection> | null;
  readonly preparation: Readonly<CleanupPreparation> | null;
}

const idPattern = /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,255}$/u;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
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

function fail(code: string, message: string): never {
  throw new FoundryContextError(code, message);
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    fail("task_spec_invalid", `${label} must be an object.`);
  return value as Record<string, unknown>;
}

function exact(value: Record<string, unknown>, keys: readonly string[], label: string): void {
  if (Object.keys(value).length !== keys.length || keys.some((key) => !Object.hasOwn(value, key)))
    fail("task_spec_invalid", `${label} has missing or unsupported fields.`);
}

function selectedPath(value: unknown, label: string): string {
  if (
    typeof value !== "string" ||
    !value ||
    value.length > 4_096 ||
    /[\0\r\n]/u.test(value) ||
    /^\.env(?:\.|$)/iu.test(path.basename(value))
  )
    fail("task_spec_path_invalid", `${label} must be a bounded non-credential file path.`);
  return value;
}

function selection(value: unknown, label: string): Readonly<SourceSelection> {
  const item = record(value, label);
  exact(item, ["path"], label);
  return Object.freeze({ path: selectedPath(item.path, `${label} path`) });
}

function account(value: unknown): Readonly<AccountIntentSelection> | null {
  if (value === null) return null;
  const item = record(value, "Account intent");
  exact(item, ["project_ref", "user_id", "session_reference"], "Account intent");
  if (
    typeof item.project_ref !== "string" ||
    !/^[a-z0-9]{20}$/u.test(item.project_ref) ||
    typeof item.user_id !== "string" ||
    !uuidPattern.test(item.user_id) ||
    (item.session_reference !== null &&
      (typeof item.session_reference !== "string" || !path.isAbsolute(item.session_reference)))
  )
    fail("task_spec_account_invalid", "Account intent requires exact project/user identifiers.");
  return Object.freeze({
    project_ref: item.project_ref,
    user_id: item.user_id,
    session_reference: item.session_reference,
  });
}

function preparation(
  value: unknown,
  sources: readonly SourceSelection[],
): Readonly<CleanupPreparation> | null {
  if (value === null) return null;
  const item = record(value, "Preparation");
  exact(item, ["operation", "type", "input", "source_input", "output_directory"], "Preparation");
  const input = selectedPath(item.input, "Preparation input");
  const sourceInput =
    item.source_input === null ? null : selectedPath(item.source_input, "Preparation source input");
  if (
    item.operation !== "dataset-curation-cleanup" ||
    typeof item.type !== "string" ||
    !entityTypes.has(item.type) ||
    !sources.some((source) => source.path === input) ||
    (sourceInput !== null && !sources.some((source) => source.path === sourceInput)) ||
    typeof item.output_directory !== "string" ||
    !item.output_directory ||
    path.isAbsolute(item.output_directory) ||
    item.output_directory.split(/[\\/]/u).some((part) => !part || part === "." || part === "..")
  )
    fail(
      "task_spec_preparation_invalid",
      "Preparation must select declared inputs and one contained cleanup output.",
    );
  return Object.freeze({
    operation: "dataset-curation-cleanup",
    type: item.type,
    input,
    source_input: sourceInput,
    output_directory: item.output_directory,
  });
}

export function parseFoundryTaskStartSpec(value: unknown): FoundryTaskStartSpec {
  const item = record(value, "Task-start spec");
  exact(
    item,
    [
      "schema",
      "request_id",
      "actor_id",
      "lane",
      "profile_id",
      "target_entities",
      "sources",
      "seed",
      "account_intent",
      "preparation",
    ],
    "Task-start spec",
  );
  if (
    item.schema !== FOUNDRY_TASK_START_SPEC_SCHEMA ||
    typeof item.request_id !== "string" ||
    !idPattern.test(item.request_id) ||
    typeof item.actor_id !== "string" ||
    !idPattern.test(item.actor_id) ||
    !["external-dataset-curated-import", "source-evidence-dataset-development"].includes(
      String(item.lane),
    ) ||
    typeof item.profile_id !== "string" ||
    !idPattern.test(item.profile_id) ||
    !Array.isArray(item.target_entities) ||
    !item.target_entities.length ||
    item.target_entities.length > entityTypes.size ||
    new Set(item.target_entities).size !== item.target_entities.length ||
    item.target_entities.some((type) => typeof type !== "string" || !entityTypes.has(type)) ||
    !Array.isArray(item.sources) ||
    !item.sources.length ||
    item.sources.length > 1_000
  )
    fail("task_spec_invalid", "Task-start identity, lane, profile or entity scope is invalid.");
  const sources = item.sources.map((source, index) => selection(source, `Source ${index + 1}`));
  if (new Set(sources.map((source) => source.path)).size !== sources.length)
    fail("task_spec_source_duplicate", "Task source selections must be unique.");
  const seed = item.seed === null ? null : selection(item.seed, "Seed");
  if (
    item.lane === "source-evidence-dataset-development" &&
    (!seed || !sources.some((source) => source.path === seed.path))
  )
    fail("task_seed_required", "Source-evidence authoring requires one selected JSON seed file.");
  const spec: FoundryTaskStartSpec = {
    schema: FOUNDRY_TASK_START_SPEC_SCHEMA,
    request_id: item.request_id,
    actor_id: item.actor_id,
    lane: item.lane as Lane,
    profile_id: item.profile_id,
    target_entities: Object.freeze([...(item.target_entities as string[])]),
    sources: Object.freeze(sources),
    seed,
    account_intent: account(item.account_intent),
    preparation: preparation(item.preparation, sources),
  };
  return Object.freeze(spec);
}

export function taskStartSpecFingerprint(
  spec: FoundryTaskStartSpec,
  inputs: readonly FoundryInputFact[],
): string {
  const parsed = parseFoundryTaskStartSpec(spec);
  if (
    inputs.length !== parsed.sources.length ||
    inputs.some(
      (fact) =>
        !path.isAbsolute(fact.path) ||
        !Number.isSafeInteger(fact.bytes) ||
        fact.bytes < 0 ||
        !/^[0-9a-f]{64}$/u.test(fact.sha256),
    ) ||
    new Set(inputs.map((fact) => fact.path)).size !== inputs.length
  )
    fail("task_spec_input_facts_invalid", "Task fingerprint requires exact selected input facts.");
  return sha256Json({ spec: parsed, inputs: inputs.map((fact) => ({ ...fact })) });
}

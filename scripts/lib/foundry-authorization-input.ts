import fs from "node:fs";
import path from "node:path";
import {
  captureFoundryInput,
  FoundryContextError,
  type FoundryInputFact,
  type FoundryRuntimeContext,
} from "./foundry-runtime-context.ts";
import { assertNotFoundrySessionFile, migrationCredentialPath } from "./foundry-private-path.ts";
import { readSelectedSemanticBytes } from "./foundry-semantic-input.ts";
import { workflowObject } from "./foundry-workflow-state.ts";
import { runFoundryTaskOperation } from "./foundry-task-store.ts";
import type { ArtifactEntry } from "./foundry-task-types.ts";

export const FOUNDRY_AUTHORIZATION_INPUT_SCHEMA =
  "tiangong-foundry.authorization-input.v1" as const;
export interface FoundryAuthorizationInput {
  schema: typeof FOUNDRY_AUTHORIZATION_INPUT_SCHEMA;
  task_id: string;
  actor_id: string;
  finalization_sha256: string;
  dataset_type: string;
  input_kind: "current_rows" | "final_rows";
  input_sha256: string;
  expected_previous_sha256: string | null;
  execution_contract?: { file: string; sha256: string };
  grant: { file: string; sha256: string };
  evidence: readonly {
    id: string;
    kind: "user-decision" | "source-model";
    file: string;
    sha256: string;
  }[];
}
export interface SelectedAuthorizationInput {
  readonly spec: FoundryAuthorizationInput;
  readonly descriptor: FoundryInputFact;
  readonly grant: FoundryInputFact;
  readonly evidence: readonly FoundryInputFact[];
  readonly executionContract?: FoundryInputFact;
  readonly executionContractSource?: FoundryInputFact;
}
const sha = /^[0-9a-f]{64}$/u;
const identifier = /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,255}$/u;
const selections = new WeakSet<object>();
function invalid(message: string): never {
  throw new FoundryContextError("task_authorization_input_invalid", message);
}
function exact(value: Record<string, unknown>, keys: string[]) {
  if (Object.keys(value).length !== keys.length || keys.some((key) => !Object.hasOwn(value, key)))
    invalid("Authorization input has missing or unsupported fields.");
}
function fileReference(value: Record<string, unknown>) {
  if (
    typeof value.file !== "string" ||
    !value.file ||
    value.file.length > 4096 ||
    /[\0\r\n]/u.test(value.file) ||
    typeof value.sha256 !== "string" ||
    !sha.test(value.sha256)
  )
    invalid("Authorization file reference is invalid.");
  return { file: value.file, sha256: value.sha256 };
}
export function parseFoundryAuthorizationInput(value: unknown): FoundryAuthorizationInput {
  const data = workflowObject(value);
  exact(data, [
    "schema",
    "task_id",
    "actor_id",
    "finalization_sha256",
    "dataset_type",
    "input_kind",
    "input_sha256",
    "expected_previous_sha256",
    "grant",
    "evidence",
    ...(Object.hasOwn(data, "execution_contract") ? ["execution_contract"] : []),
  ]);
  if (
    data.schema !== FOUNDRY_AUTHORIZATION_INPUT_SCHEMA ||
    typeof data.task_id !== "string" ||
    !/^task-[0-9a-f]{64}-r\d{4}$/u.test(data.task_id) ||
    typeof data.actor_id !== "string" ||
    !identifier.test(data.actor_id) ||
    typeof data.finalization_sha256 !== "string" ||
    !sha.test(data.finalization_sha256) ||
    typeof data.input_sha256 !== "string" ||
    !sha.test(data.input_sha256) ||
    typeof data.dataset_type !== "string" ||
    ![
      "flow",
      "process",
      "contact",
      "source",
      "unitgroup",
      "flowproperty",
      "lifecyclemodel",
    ].includes(data.dataset_type) ||
    (data.input_kind !== "current_rows" && data.input_kind !== "final_rows") ||
    (data.expected_previous_sha256 !== null &&
      (typeof data.expected_previous_sha256 !== "string" ||
        !sha.test(data.expected_previous_sha256))) ||
    !Array.isArray(data.evidence) ||
    !data.evidence.length ||
    data.evidence.length > 100
  )
    invalid(
      "Authorization input must bind a current task, scope, finalization and explicit evidence.",
    );
  const grant = workflowObject(data.grant);
  exact(grant, ["file", "sha256"]);
  let executionContract: { file: string; sha256: string } | undefined;
  if (Object.hasOwn(data, "execution_contract")) {
    if (
      data.input_kind !== "final_rows" ||
      !["flow", "process", "source"].includes(data.dataset_type)
    )
      invalid("Native insert contracts require finalized Flow, Process or Source rows.");
    const selected = workflowObject(data.execution_contract);
    exact(selected, ["file", "sha256"]);
    executionContract = Object.freeze(fileReference(selected));
  }
  const evidence = data.evidence.map((raw) => {
    const item = workflowObject(raw);
    exact(item, ["id", "kind", "file", "sha256"]);
    if (
      typeof item.id !== "string" ||
      !identifier.test(item.id) ||
      (item.kind !== "user-decision" && item.kind !== "source-model")
    )
      invalid("Approval evidence identity or kind is invalid.");
    return Object.freeze({ id: item.id, kind: item.kind, ...fileReference(item) });
  });
  if (
    new Set(evidence.map((item) => item.id)).size !== evidence.length ||
    !evidence.some((item) => item.kind === "user-decision")
  )
    invalid("Authorization needs unique evidence ids and explicit user-decision evidence.");
  return Object.freeze({
    schema: FOUNDRY_AUTHORIZATION_INPUT_SCHEMA,
    task_id: data.task_id,
    actor_id: data.actor_id,
    finalization_sha256: data.finalization_sha256,
    dataset_type: data.dataset_type,
    input_kind: data.input_kind,
    input_sha256: data.input_sha256,
    expected_previous_sha256: data.expected_previous_sha256,
    grant: Object.freeze(fileReference(grant)),
    evidence: Object.freeze(evidence),
    ...(executionContract ? { execution_contract: executionContract } : {}),
  });
}
export function selectFoundryAuthorizationInput(
  context: FoundryRuntimeContext,
  file: string,
): SelectedAuthorizationInput {
  let bytes = 0;
  const select = (input: string) => {
    if (!input || input.length > 4096 || /[\0\r\n]/u.test(input))
      invalid("Authorization input path is invalid.");
    const target = path.resolve(context.workspaceRoot, input);
    if (migrationCredentialPath(path.relative(context.workspaceRoot, target)))
      invalid("Credential paths cannot be approval evidence.");
    assertNotFoundrySessionFile(target, context.accountIntent?.sessionReference);
    const stat = fs.lstatSync(target);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 8 * 1024 * 1024)
      invalid("Approval input must be a bounded regular file.");
    bytes += stat.size;
    if (bytes > 64 * 1024 * 1024) invalid("Approval input exceeds the 64 MiB batch limit.");
    return Object.freeze(captureFoundryInput(target));
  };
  const descriptor = select(file);
  let spec: FoundryAuthorizationInput;
  try {
    spec = parseFoundryAuthorizationInput(
      JSON.parse(readSelectedSemanticBytes(descriptor).toString("utf8")),
    );
  } catch {
    invalid("Approval input must be a complete supported JSON descriptor.");
  }
  if (spec.task_id !== context.taskId || spec.actor_id !== context.actorId)
    invalid("Approval task or actor differs from the current invocation.");
  const selected = [spec.grant, ...spec.evidence].map((item) => {
    const fact = select(item.file);
    if (fact.sha256 !== item.sha256) invalid("Approval bytes differ from the selected digest.");
    readSelectedSemanticBytes(fact);
    return fact;
  });
  try {
    workflowObject(JSON.parse(readSelectedSemanticBytes(selected[0]).toString("utf8")));
  } catch {
    invalid("The selected grant must be a complete JSON object.");
  }
  Object.freeze(spec.evidence);
  const executionContract = spec.execution_contract ? select(spec.execution_contract.file) : null;
  if (executionContract && executionContract.sha256 !== spec.execution_contract!.sha256)
    invalid("Native execution contract bytes differ from the selected digest.");
  const result = Object.freeze({
    spec,
    descriptor,
    grant: selected[0],
    evidence: Object.freeze(selected.slice(1)),
    ...(executionContract ? { executionContract } : {}),
  });
  selections.add(result);
  return result;
}
export function assertSelectedAuthorizationInput(value: SelectedAuthorizationInput): void {
  if (!selections.has(value))
    invalid("Approval input must be independently selected by the current host.");
  for (const fact of [
    value.descriptor,
    value.grant,
    ...value.evidence,
    ...(value.executionContract ? [value.executionContract] : []),
    ...(value.executionContractSource ? [value.executionContractSource] : []),
  ])
    readSelectedSemanticBytes(fact);
}

export async function snapshotFoundryAuthorizationContract(
  context: FoundryRuntimeContext,
  selected: SelectedAuthorizationInput,
  entries: readonly ArtifactEntry[],
): Promise<SelectedAuthorizationInput> {
  assertSelectedAuthorizationInput(selected);
  if (!selected.executionContract) return selected;
  if (!context.taskRoot) invalid("A native contract snapshot requires the current task.");
  const file = path.join(
    context.taskRoot,
    "outputs",
    "native-contracts",
    `${selected.executionContract.sha256}.json`,
  );
  const indexed = entries.find((entry) => path.resolve(context.taskRoot!, entry.path) === file);
  if (!indexed) {
    await runFoundryTaskOperation(
      context,
      {
        command: "dataset-workflow-native-contract",
        options: {
          contract: selected.executionContract,
          task: selected.spec.task_id,
          input: selected.spec.input_sha256,
          finalization: selected.spec.finalization_sha256,
        },
        validateCurrent: () => assertSelectedAuthorizationInput(selected),
      },
      (operation) => {
        operation.writeText(file, readSelectedSemanticBytes(selected.executionContract!));
        const result = {
          status: "staged",
          artifact: captureFoundryInput(file),
          grants_permission: false,
        };
        operation.writeJson(`${file}.snapshot.json`, result);
        return result;
      },
    );
  } else if (
    indexed.sha256 !== selected.executionContract.sha256 ||
    indexed.bytes !== selected.executionContract.bytes
  ) {
    invalid("Indexed native contract differs from the selected content.");
  }
  const snapshot = Object.freeze({
    ...selected,
    executionContractSource: selected.executionContractSource ?? selected.executionContract,
    executionContract: Object.freeze(captureFoundryInput(file)),
  });
  if (
    snapshot.executionContract.sha256 !== selected.executionContract.sha256 ||
    snapshot.executionContract.bytes !== selected.executionContract.bytes
  )
    invalid("Native contract snapshot differs from the independently selected bytes.");
  selections.add(snapshot);
  assertSelectedAuthorizationInput(snapshot);
  return snapshot;
}

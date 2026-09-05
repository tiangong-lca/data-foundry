import {
  parseCapsule,
  FOUNDRY_EXECUTION_CAPSULE_SCHEMA,
  type ExecutionCapsule,
} from "./foundry-execution-context-format.ts";
export {
  FOUNDRY_EXECUTION_CAPSULE_SCHEMA,
  type ExecutionCapsule,
} from "./foundry-execution-context-format.ts";
import fs from "node:fs";
import path from "node:path";
import {
  assertFoundryCommandSpecArtifactsCurrent,
  commandSpecOptionValue,
  parseFoundryCommandSpec,
  type FoundryCommandSpec,
} from "@tiangong-lca/cli/command-spec";
import {
  assertFoundryRuntimeContext,
  assertFoundryWorkspaceActive,
  captureFoundryInput,
  FoundryContextError,
  readFoundryInput,
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
import {
  assertQualifiedFoundryRuntime,
  type QualifiedFoundryRuntime,
} from "./foundry-runtime-qualification.ts";
import { foundryRuntimeCommandPolicy } from "./foundry-runtime-command-policy.ts";
import { loadFoundryTaskAuthorization } from "./foundry-task-authorization.ts";
import { assertFoundryTaskInputLineage } from "./foundry-task-store.ts";
import {
  taskAuthorizationAllows,
  taskAuthorizationWaivesQa,
  type TaskAuthorizationAction,
  type ValidatedTaskAuthorization,
} from "./task-authorization.ts";
import { bytes, digest } from "./foundry-task-io.ts";
import { resolveInstalledTiangongLcaCliPackage } from "./foundry-runtime-utils.ts";
import { assertFoundryMigrationNoReplay } from "./foundry-migration-replay.ts";

export interface FoundryExecutionAdmission {
  readonly capsule: Readonly<ExecutionCapsule>;
  readonly capsule_file: string;
  readonly command_spec: Readonly<FoundryCommandSpec>;
  readonly authorization: ValidatedTaskAuthorization;
}

export interface CreateFoundryExecutionCapsuleOptions {
  command: string;
  approvedInputFile: string;
  finalRowsFile: string;
  requiredActions?: readonly TaskAuthorizationAction[];
  requiredQaWaivers?: readonly string[];
  commandSpec: unknown;
}

export interface RehydrateFoundryExecutionAdmissionOptions {
  capsuleFile: string;
  commandSpec: unknown;
}

const admissions = new WeakSet<object>();

function fail(code: string, message: string): never {
  throw new FoundryContextError(code, message);
}

function selected(context: FoundryRuntimeContext, file: string): FoundryInputFact {
  const resolved = resolveFoundryInputPath(context, file);
  const fact = context.inputs.find((item) => item.path === resolved);
  if (!fact) fail("execution_input_unselected", "Execution input was not selected by the host.");
  const current = captureFoundryInput(fact.path);
  if (current.bytes !== fact.bytes || current.sha256 !== fact.sha256)
    fail("execution_input_changed", "Execution input changed after host selection.");
  return fact;
}

function sameFact(left: FoundryInputFact, right: FoundryInputFact): boolean {
  return left.path === right.path && left.bytes === right.bytes && left.sha256 === right.sha256;
}

function resolveSpecArtifact(context: FoundryRuntimeContext, value: string): string {
  const candidate = path.isAbsolute(value)
    ? path.resolve(value)
    : path.resolve(context.workspaceRoot, value);
  if (!fs.existsSync(candidate)) return candidate;
  return fs.realpathSync(candidate);
}

function commandSpec(
  context: FoundryRuntimeContext,
  value: unknown,
  finalRows: FoundryInputFact,
  actions: readonly TaskAuthorizationAction[],
): FoundryCommandSpec {
  const spec = assertFoundryCommandSpecArtifactsCurrent(value, (artifactPath) =>
    resolveSpecArtifact(context, artifactPath),
  );
  if (spec.binding.artifacts.length !== 1 || spec.binding.artifacts[0]?.role !== "final_rows")
    fail(
      "execution_final_rows_unbound",
      "Restricted execution requires one exact final_rows artifact binding.",
    );
  const artifact = spec.binding.artifacts[0];
  if (
    resolveSpecArtifact(context, artifact.path) !== finalRows.path ||
    artifact.bytes !== finalRows.bytes ||
    artifact.sha256 !== finalRows.sha256
  )
    fail("execution_final_rows_unbound", "CommandSpec does not bind the selected final-row bytes.");
  const cli = resolveInstalledTiangongLcaCliPackage();
  let selectedCli: string | null = null;
  try {
    selectedCli = spec.argv[0] ? fs.realpathSync(spec.argv[0]) : null;
  } catch {
    /* A missing or non-resolvable argv[0] has no execution authority. */
  }
  if (
    path.resolve(spec.executable) !== path.resolve(process.execPath) ||
    selectedCli !== fs.realpathSync(cli.binPath)
  )
    fail(
      "execution_cli_unqualified",
      "Restricted execution must enter the exact installed owner CLI through Node.",
    );
  const input =
    commandSpecOptionValue(spec, "--input") ?? commandSpecOptionValue(spec, "--input-file");
  if (!input || resolveFoundryInputPath(context, input) !== finalRows.path)
    fail(
      "execution_final_rows_unbound",
      "The owner CLI input argument must select the exact final-row artifact.",
    );
  const outDir = commandSpecOptionValue(spec, "--out-dir");
  if (!outDir)
    fail("execution_output_unbound", "Restricted execution requires a task output root.");
  resolveFoundryOutput(context, outDir);
  if (!spec.argv.includes("--commit") || !spec.argv.includes("--json"))
    fail(
      "execution_command_unadmitted",
      "Restricted execution requires the owner CLI commit and machine-result flags.",
    );
  const [group, operation] = spec.argv.slice(1, 3);
  const datasetType = commandSpecOptionValue(spec, "--type");
  const isDatasetSave =
    group === "dataset" &&
    operation === "save-draft" &&
    datasetType !== null &&
    ["auto", "contact", "source", "unitgroup", "flowproperty"].includes(datasetType);
  const isProcessSave = group === "process" && operation === "save-draft" && !datasetType;
  const isLifecycleSave = group === "lifecyclemodel" && operation === "save-draft" && !datasetType;
  const isFlowPublish = group === "flow" && operation === "publish-version" && !datasetType;
  if (!isDatasetSave && !isProcessSave && !isLifecycleSave && !isFlowPublish)
    fail(
      "execution_command_unadmitted",
      "CommandSpec is not one of the reviewed owner-draft write operations.",
    );
  const has = (action: TaskAuthorizationAction) => actions.includes(action);
  if (
    (datasetType === "unitgroup" && !has("unitgroup_write")) ||
    (datasetType === "flowproperty" && !has("flowproperty_write")) ||
    (has("unitgroup_write") && !["unitgroup", "auto"].includes(datasetType ?? "")) ||
    (has("flowproperty_write") && !["flowproperty", "auto"].includes(datasetType ?? "")) ||
    ((has("elementary_flow_write") || has("elementary_flow_create_new")) && !isFlowPublish) ||
    (has("elementary_flow_create_new") && !has("elementary_flow_write")) ||
    (has("canonical_support_local_mint") && !has("unitgroup_write") && !has("flowproperty_write"))
  )
    fail(
      "execution_action_command_mismatch",
      "Authorized exception actions do not match the selected owner CLI write operation.",
    );
  if (
    (has("unitgroup_write") || has("flowproperty_write")) &&
    !spec.argv.includes("--allow-account-local-support")
  )
    fail(
      "execution_action_command_mismatch",
      "Account-local support writes require the reviewed owner CLI override flag.",
    );
  const targetUserId = commandSpecOptionValue(spec, "--target-user-id");
  if (targetUserId && targetUserId !== context.accountIntent?.userId)
    fail(
      "execution_account_mismatch",
      "CommandSpec target user does not match the freshly verified task account intent.",
    );
  readFoundryInput(context, finalRows.path);
  return spec;
}

async function verifyAdmission(
  context: FoundryRuntimeContext,
  qualification: QualifiedFoundryRuntime,
  identity: VerifiedFoundryIdentity,
  capsule: Readonly<ExecutionCapsule>,
  specValue: unknown,
) {
  assertFoundryRuntimeContext(context);
  assertQualifiedFoundryRuntime(context, qualification);
  assertVerifiedFoundryIdentity(context, identity, qualification);
  if (
    capsule.workspace_id !== context.workspaceId ||
    capsule.task_id !== context.taskId ||
    capsule.actor_id !== context.actorId ||
    capsule.qualification_sha256 !== qualification.qualification_sha256
  )
    fail(
      "execution_context_mismatch",
      "Execution capsule does not match current workspace, task, actor and runtime.",
    );
  const policy = foundryRuntimeCommandPolicy(capsule.command);
  if (
    !["task-stage", "native-runtime-stage"].includes(policy.disposition) ||
    policy.authorization !== "required-before-restricted-action"
  )
    fail("execution_command_unadmitted", "Selected command is not a qualified task stage.");
  const approved = selected(context, capsule.approved_input.path);
  const finalRows = selected(context, capsule.final_rows.path);
  assertFoundryMigrationNoReplay(context, finalRows.path);
  if (!sameFact(approved, capsule.approved_input) || !sameFact(finalRows, capsule.final_rows))
    fail("execution_input_changed", "Capsule input facts differ from current host selection.");
  if (!sameFact(approved, finalRows))
    await assertFoundryTaskInputLineage(context, approved.path, finalRows.path);
  const authorization = await loadFoundryTaskAuthorization(
    context,
    identity,
    finalRows.path,
    qualification,
  );
  if (
    authorization.authorization_sha256 !== capsule.authorization_sha256 ||
    capsule.required_actions.some((action) => !taskAuthorizationAllows(authorization, action))
  )
    fail(
      "execution_action_unauthorized",
      "Current task authorization does not permit the required final-row action.",
    );
  for (const code of capsule.required_qa_waivers) {
    if (!taskAuthorizationWaivesQa(authorization, "process", code))
      fail(
        "execution_qa_waiver_required",
        "Current final rows require a QA waiver not present in current authorization.",
      );
  }
  const spec = commandSpec(context, specValue, finalRows, capsule.required_actions);
  if (spec.sha256 !== capsule.command_spec_sha256)
    fail("execution_command_changed", "CommandSpec differs from the reviewed execution capsule.");
  assertQualifiedFoundryRuntime(context, qualification);
  assertVerifiedFoundryIdentity(context, identity, qualification);
  const refreshed = await loadFoundryTaskAuthorization(
    context,
    identity,
    finalRows.path,
    qualification,
  );
  if (
    refreshed.authorization_sha256 !== authorization.authorization_sha256 ||
    capsule.required_actions.some((action) => !taskAuthorizationAllows(refreshed, action))
  )
    fail("execution_authorization_changed", "Authorization changed during final admission checks.");
  assertFoundryMigrationNoReplay(context, finalRows.path);
  return { spec, authorization: refreshed };
}

export async function createFoundryExecutionCapsule(
  context: FoundryRuntimeContext,
  qualification: QualifiedFoundryRuntime,
  identity: VerifiedFoundryIdentity,
  options: CreateFoundryExecutionCapsuleOptions,
) {
  assertFoundryWorkspaceActive(context);
  assertQualifiedFoundryRuntime(context, qualification);
  assertVerifiedFoundryIdentity(context, identity, qualification);
  const approved = selected(context, options.approvedInputFile);
  const finalRows = selected(context, options.finalRowsFile);
  assertFoundryMigrationNoReplay(context, finalRows.path);
  const authorization = await loadFoundryTaskAuthorization(
    context,
    identity,
    finalRows.path,
    qualification,
  );
  const spec = parseFoundryCommandSpec(options.commandSpec);
  const capsule = parseCapsule({
    schema: FOUNDRY_EXECUTION_CAPSULE_SCHEMA,
    workspace_id: context.workspaceId,
    task_id: context.taskId,
    actor_id: context.actorId,
    command: options.command,
    qualification_sha256: qualification.qualification_sha256,
    authorization_sha256: authorization.authorization_sha256,
    approved_input: approved,
    final_rows: finalRows,
    required_actions: [...(options.requiredActions ?? [])].sort(),
    required_qa_waivers: [...(options.requiredQaWaivers ?? [])].sort(),
    command_spec_sha256: spec.sha256,
  });
  await verifyAdmission(context, qualification, identity, capsule, options.commandSpec);
  const content = bytes(capsule);
  const relative = `evidence/executions/${digest(content)}.json`;
  writeFoundryArtifact(context, relative, content);
  return Object.freeze({
    capsule,
    capsule_file: path.join(context.taskRoot!, relative),
    capsule_sha256: digest(content),
  });
}

export async function rehydrateFoundryExecutionAdmission(
  context: FoundryRuntimeContext,
  qualification: QualifiedFoundryRuntime,
  identity: VerifiedFoundryIdentity,
  options: RehydrateFoundryExecutionAdmissionOptions,
): Promise<FoundryExecutionAdmission> {
  assertFoundryWorkspaceActive(context);
  assertQualifiedFoundryRuntime(context, qualification);
  assertVerifiedFoundryIdentity(context, identity, qualification);
  const root = context.taskRoot;
  if (!root) fail("task_context_required", "Execution admission requires one task context.");
  let file: string;
  try {
    file = fs.realpathSync(options.capsuleFile);
  } catch {
    fail("execution_capsule_invalid", "Execution capsule must be a current regular file.");
  }
  const executionRoot = path.join(root, "evidence", "executions");
  const relative = path.relative(executionRoot, file);
  if (path.isAbsolute(relative) || relative === ".." || relative.startsWith(`..${path.sep}`))
    fail(
      "execution_capsule_outside_task",
      "Execution capsule must remain in its task execution-evidence root.",
    );
  const fact = captureFoundryInput(file);
  if (fact.bytes > 1024 * 1024)
    fail("execution_capsule_invalid", "Execution capsule exceeds its byte limit.");
  const content = fs.readFileSync(file);
  if (
    content.length !== fact.bytes ||
    digest(content) !== fact.sha256 ||
    path.basename(file) !== `${fact.sha256}.json`
  )
    fail("execution_capsule_changed", "Execution capsule bytes or content address changed.");
  let parsed: unknown;
  try {
    parsed = JSON.parse(content.toString("utf8"));
  } catch {
    fail("execution_capsule_invalid", "Execution capsule is not complete JSON.");
  }
  const capsule = parseCapsule(parsed);
  const verified = await verifyAdmission(
    context,
    qualification,
    identity,
    capsule,
    options.commandSpec,
  );
  const admission: FoundryExecutionAdmission = Object.freeze({
    capsule,
    capsule_file: file,
    command_spec: verified.spec,
    authorization: verified.authorization,
  });
  admissions.add(admission);
  return admission;
}

/** Re-run every external fact immediately before handing the spec to the existing no-replay owner. */
export async function assertFoundryExecutionAdmission(
  context: FoundryRuntimeContext,
  qualification: QualifiedFoundryRuntime,
  identity: VerifiedFoundryIdentity,
  admission: FoundryExecutionAdmission,
): Promise<FoundryCommandSpec> {
  if (!admission || !admissions.has(admission))
    fail(
      "execution_admission_unverified",
      "Serialized execution admission cannot authorize a child process.",
    );
  const verified = await rehydrateFoundryExecutionAdmission(context, qualification, identity, {
    capsuleFile: admission.capsule_file,
    commandSpec: admission.command_spec,
  });
  return verified.command_spec;
}

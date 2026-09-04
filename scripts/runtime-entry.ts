#!/usr/bin/env node
import path from "node:path";
import { createFoundryFacade, type FoundryFacadeRuntimeSelection } from "./foundry-facade.ts";
import { createFoundryRuntime } from "./foundry-runtime.ts";
import { parseArgs, type ParsedArgs } from "./lib/foundry-args.ts";
import {
  captureFoundryInput,
  createFoundryRuntimeContext,
  FoundryContextError,
} from "./lib/foundry-runtime-context.ts";
import { exitCodeForCommand } from "./lib/foundry-command-registry.ts";
import {
  createFoundryOperationResult,
  exitCodeForFoundryOperationResult,
  type FoundryOperationResult,
  type FoundryPublicOperation,
} from "./lib/foundry-operation-result.ts";

export interface FoundryRuntimeCommandHost {
  readonly runtimeSelection?: FoundryFacadeRuntimeSelection;
  readonly signal?: AbortSignal;
  readonly writeStdout?: (text: string) => void;
  readonly setExitCode?: (code: number) => void;
}

interface ParsedPublicCommand {
  operation: FoundryPublicOperation;
  args: ParsedArgs;
}

function option(value: unknown, name: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !value.trim())
    throw new FoundryContextError("argument_invalid", `${name} requires one nonempty value.`);
  return value;
}

function doctorAccountIntent(args: ParsedArgs) {
  const projectRef = option(args.expectedProjectRef, "--expected-project-ref");
  const userId = option(args.expectedUserId, "--expected-user-id");
  const sessionReference = option(args.sessionReference, "--session-reference");
  if (!projectRef && !userId && !sessionReference) return undefined;
  if (!projectRef || !userId)
    throw new FoundryContextError(
      "argument_account_intent_incomplete",
      "Account diagnostics require both expected project and user identifiers.",
    );
  return { projectRef, userId, ...(sessionReference ? { sessionReference } : {}) };
}

function publicCommand(argv: string[]): ParsedPublicCommand | null {
  const [group, action, ...rest] = argv.slice(2);
  if (group === "doctor")
    return { operation: "doctor", args: parseArgs([action, ...rest].filter(Boolean)) };
  if (group === "workspace" && action === "init")
    return { operation: "workspace.init", args: parseArgs(rest) };
  if (group === "workspace" && action === "migrate")
    return { operation: "workspace.migrate", args: parseArgs(rest) };
  if (group === "task" && ["start", "status", "resume"].includes(action))
    return { operation: `task.${action}` as FoundryPublicOperation, args: parseArgs(rest) };
  if (group === "workspace" || group === "task")
    return { operation: "unknown", args: parseArgs([action, ...rest].filter(Boolean)) };
  return null;
}

function invalidResult(
  operation: FoundryPublicOperation,
  taskId: string | null,
  code: string,
  message: string,
): FoundryOperationResult {
  return createFoundryOperationResult({
    operation,
    status: "needs_input",
    taskId,
    artifacts: [],
    blockers: [{ code, message, scope: taskId }],
    nextActions: [],
    runtimeIdentity: null,
    permissions: { state: "not_required", requested_actions: [], approval_reference: null },
  });
}

function interruptedResult(
  operation: FoundryPublicOperation,
  taskId: string | null,
): FoundryOperationResult {
  return createFoundryOperationResult({
    operation,
    status: "failed",
    taskId,
    artifacts: [],
    blockers: [
      {
        code: "operation_interrupted",
        message: "Operation was interrupted; retained evidence must be inspected before resume.",
        scope: taskId,
      },
    ],
    nextActions: [],
    runtimeIdentity: null,
    permissions: { state: "not_required", requested_actions: [], approval_reference: null },
  });
}

function failedResult(
  operation: FoundryPublicOperation,
  taskId: string | null,
  code: string,
  message: string,
): FoundryOperationResult {
  return createFoundryOperationResult({
    operation,
    status: "failed",
    taskId,
    artifacts: [],
    blockers: [{ code, message, scope: taskId }],
    nextActions: [],
    runtimeIdentity: null,
    permissions: { state: "not_required", requested_actions: [], approval_reference: null },
  });
}

async function runPublicCommand(
  parsed: ParsedPublicCommand,
  host: FoundryRuntimeCommandHost,
): Promise<FoundryOperationResult> {
  const taskId = option(parsed.args.task, "--task") ?? null;
  if (host.signal?.aborted) return interruptedResult(parsed.operation, taskId);
  if (parsed.args.json !== true)
    return invalidResult(
      parsed.operation,
      taskId,
      "argument_json_required",
      "Public Foundry operations require --json.",
    );
  if (parsed.operation === "unknown")
    return invalidResult(
      parsed.operation,
      taskId,
      "unknown_public_operation",
      "Unknown Foundry workspace or task operation.",
    );
  if (parsed.args._.length)
    return invalidResult(
      parsed.operation,
      taskId,
      "argument_positional_unsupported",
      "Public Foundry operations do not accept extra positional arguments.",
    );
  const allowed = new Set([
    "_",
    "json",
    "workspace",
    ...(parsed.operation === "doctor"
      ? ["expectedProjectRef", "expectedUserId", "sessionReference"]
      : parsed.operation === "workspace.migrate"
        ? ["dryRun"]
        : parsed.operation === "task.start"
          ? ["spec"]
          : parsed.operation === "task.status" || parsed.operation === "task.resume"
            ? ["task", "actor"]
            : []),
  ]);
  const unknownOption = Object.keys(parsed.args).find((key) => !allowed.has(key));
  if (unknownOption)
    return invalidResult(
      parsed.operation,
      taskId,
      "argument_option_unsupported",
      `Public Foundry operation does not accept --${unknownOption}.`,
    );
  const workspace = option(parsed.args.workspace, "--workspace");
  if (!workspace)
    return invalidResult(
      parsed.operation,
      taskId,
      "argument_workspace_required",
      "Public Foundry operations require an explicit --workspace.",
    );
  const facade = createFoundryFacade({
    moduleUrl: import.meta.url,
    workspace,
    runtimeSelection: host.runtimeSelection,
    accountIntent: parsed.operation === "doctor" ? doctorAccountIntent(parsed.args) : undefined,
    signal: host.signal,
  });
  let result: FoundryOperationResult;
  if (parsed.operation === "workspace.init") result = facade.initialize();
  else if (parsed.operation === "doctor") result = facade.doctor();
  else if (parsed.operation === "workspace.migrate") {
    if (parsed.args.dryRun !== true)
      return invalidResult(
        parsed.operation,
        null,
        "argument_dry_run_required",
        "Workspace migration is read-only in this release and requires --dry-run.",
      );
    result = facade.migrationDryRun();
  } else if (parsed.operation === "task.start") {
    const specFile = option(parsed.args.spec, "--spec");
    if (!specFile)
      return invalidResult(
        parsed.operation,
        null,
        "argument_spec_required",
        "Task start requires one explicit --spec file.",
      );
    result = await facade.start({ specFile });
  } else {
    const actorId = option(parsed.args.actor, "--actor");
    if (!taskId || !actorId)
      return invalidResult(
        parsed.operation,
        taskId,
        "argument_task_actor_required",
        "Task status and resume require exact --task and --actor values.",
      );
    result =
      parsed.operation === "task.status"
        ? await facade.status({ taskId, actorId })
        : await facade.resume({ taskId, actorId });
  }
  return result;
}

async function runLegacyWorkspaceRuntimeCommand(argv: string[]): Promise<void> {
  try {
    const [command = "help", ...rest] = argv.slice(2);
    if (!["init", "profiles-list", "dataset-curation-cleanup"].includes(command)) {
      throw new FoundryContextError(
        "runtime_command_unavailable",
        "This command has not been admitted to the explicit workspace runtime.",
      );
    }
    const args = parseArgs(rest);
    const workspace = option(args.workspace, "--workspace");
    const input =
      command === "dataset-curation-cleanup"
        ? option(args.rowsFile ?? args.input, "--rows-file")
        : undefined;
    const sourceInput =
      command === "dataset-curation-cleanup"
        ? option(args.sourceRowsFile, "--source-rows-file")
        : undefined;
    const contextOptions = {
      moduleUrl: import.meta.url,
      workspace,
      taskId: option(args.taskId, "--task-id"),
      actorId: option(args.actorId, "--actor-id"),
    };
    const initial = createFoundryRuntimeContext(contextOptions);
    const inputs = [input, sourceInput]
      .filter((value): value is string => Boolean(value))
      .map((file) => captureFoundryInput(path.resolve(initial.workspaceRoot, file)));
    const context = inputs.length
      ? createFoundryRuntimeContext({ ...contextOptions, workspace: initial.workspaceRoot, inputs })
      : initial;
    const runtime = createFoundryRuntime(context);
    const result =
      command === "init"
        ? runtime.initializeWorkspace()
        : command === "profiles-list"
          ? runtime.profiles()
          : await runtime.cleanup({
              input: input ?? "",
              sourceInput,
              type: option(args.type, "--type") ?? "process",
              outputDirectory: option(args.outDir, "--out-dir"),
              profileId: option(args.profile, "--profile"),
            });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    process.exitCode = exitCodeForCommand(command, {
      status: "status" in result ? String(result.status) : undefined,
    });
  } catch (error) {
    const code = error instanceof FoundryContextError ? error.code : "runtime_operation_failed";
    const message =
      error instanceof FoundryContextError
        ? error.message
        : "Foundry operation failed; preserve the selected input and inspect the local task.";
    process.stdout.write(`${JSON.stringify({ status: "failed", code, message })}\n`);
    process.exitCode = 1;
  }
}

export async function runFoundryRuntimeCommand(
  argv: string[] = process.argv,
  host: FoundryRuntimeCommandHost = {},
): Promise<void> {
  const controller = host.signal ? null : new AbortController();
  const abort = () => controller?.abort("host-signal");
  if (controller) {
    process.once("SIGINT", abort);
    process.once("SIGTERM", abort);
  }
  const effectiveHost: FoundryRuntimeCommandHost = {
    ...host,
    signal: host.signal ?? controller?.signal,
  };
  const parsed = publicCommand(argv);
  if (!parsed) {
    if (controller) {
      process.removeListener("SIGINT", abort);
      process.removeListener("SIGTERM", abort);
    }
    return runLegacyWorkspaceRuntimeCommand(argv);
  }
  const writeStdout = host.writeStdout ?? ((text: string) => process.stdout.write(text));
  const setExitCode = host.setExitCode ?? ((code: number) => (process.exitCode = code));
  let result: FoundryOperationResult;
  try {
    result = await runPublicCommand(parsed, effectiveHost);
  } catch (error) {
    result =
      error instanceof FoundryContextError && error.code.startsWith("argument_")
        ? invalidResult(parsed.operation, null, error.code, error.message)
        : failedResult(
            parsed.operation,
            null,
            error instanceof FoundryContextError ? error.code : "runtime_operation_failed",
            error instanceof FoundryContextError
              ? error.message
              : "Foundry public operation failed before changing task state.",
          );
  }
  try {
    writeStdout(`${JSON.stringify(result)}\n`);
    setExitCode(exitCodeForFoundryOperationResult(result));
  } finally {
    if (controller) {
      process.removeListener("SIGINT", abort);
      process.removeListener("SIGTERM", abort);
    }
  }
}

if (import.meta.main) void runFoundryRuntimeCommand();

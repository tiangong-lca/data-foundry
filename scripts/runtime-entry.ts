#!/usr/bin/env node
import path from "node:path";
import type { TrustedRuntimeManifest } from "@tiangong-lca/cli/runtime";
import type { FoundryRuntimeManagerOptions } from "./lib/foundry-runtime-selection.ts";
import { transferRead } from "./lib/foundry-migration-transfer-io.ts";
import { migrationCredentialPath } from "./lib/foundry-migration-inventory.ts";
import { createFoundryFacade, type FoundryFacadeRuntimeSelection } from "./foundry-facade.ts";
import { createFoundryRuntime } from "./foundry-runtime.ts";
import { parseArgs, type ParsedArgs } from "./lib/foundry-args.ts";
import { assertFoundryCacheRootSeparated } from "./lib/foundry-runtime-cache.ts";
import {
  captureFoundryInput,
  createFoundryRuntimeContext,
  FoundryContextError,
  type FoundryWorkspaceAccess,
  type FoundryAccountIntent,
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
  readonly workspaceAccess?: FoundryWorkspaceAccess;
  readonly cacheBase?: string;
  readonly accountIntent?: FoundryAccountIntent;
  readonly runtimeTarget?: TrustedRuntimeManifest;
  readonly runtimeManager?: FoundryRuntimeManagerOptions;
  readonly signal?: AbortSignal;
  readonly writeStdout?: (text: string) => void;
  readonly setExitCode?: (code: number) => void;
}

type PrepareRuntimeHost = (
  signal: AbortSignal,
) => Promise<Omit<FoundryRuntimeCommandHost, "signal" | "writeStdout" | "setExitCode">>;

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
  status: "failed" | "blocked" = "failed",
): FoundryOperationResult {
  return createFoundryOperationResult({
    operation,
    status,
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
        ? [
            "dryRun",
            "to",
            "actor",
            "request",
            "stageManifest",
            "input",
            "stage",
            "audit",
            "plan",
            "adoptionDryRun",
            "apply",
            "adoptionPlan",
            "taskSpec",
            "runtimeUse",
            "access",
          ]
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
  if (host.runtimeManager?.cacheDir !== undefined)
    assertFoundryCacheRootSeparated(host.runtimeManager.cacheDir, path.resolve(workspace));
  const facade = createFoundryFacade({
    moduleUrl: import.meta.url,
    workspace,
    cacheBase: host.cacheBase,
    runtimeSelection: host.runtimeSelection,
    workspaceAccess: host.workspaceAccess,
    runtimeManager: host.runtimeManager,
    accountIntent:
      parsed.operation === "doctor"
        ? (doctorAccountIntent(parsed.args) ?? host.accountIntent)
        : host.accountIntent,
    signal: host.signal,
  });
  let result: FoundryOperationResult;
  if (parsed.operation === "workspace.init") result = facade.initialize();
  else if (parsed.operation === "doctor") result = facade.doctor();
  else if (parsed.operation === "workspace.migrate") {
    if (parsed.args.runtimeUse === true) {
      const permitted = new Set([
        "_",
        "json",
        "workspace",
        "runtimeUse",
        "access",
        "actor",
        "request",
      ]);
      if (Object.keys(parsed.args).some((key) => !permitted.has(key)))
        return invalidResult(
          parsed.operation,
          null,
          "argument_runtime_selection_invalid",
          "Runtime selection cannot be combined with migration file operations.",
        );
      const actorId = option(parsed.args.actor, "--actor"),
        requestId = option(parsed.args.request, "--request"),
        access = option(parsed.args.access, "--access") ?? "read";
      if (!actorId || !requestId || !["read", "write"].includes(access) || !host.runtimeTarget)
        return invalidResult(
          parsed.operation,
          null,
          "argument_runtime_selection_required",
          "Runtime selection requires actor/request intent and an independently trusted target manifest from the host.",
        );
      return facade.runtimeUse({
        manifest: host.runtimeTarget,
        actorId,
        requestId,
        access: access as "read" | "write",
      });
    }
    if (parsed.args.access !== undefined)
      return invalidResult(
        parsed.operation,
        null,
        "argument_runtime_selection_invalid",
        "Access mode belongs to explicit runtime selection.",
      );
    if (
      [
        parsed.args.dryRun,
        parsed.args.stage,
        parsed.args.audit,
        parsed.args.adoptionDryRun,
        parsed.args.apply,
      ].filter((value) => value === true).length !== 1
    )
      return invalidResult(
        parsed.operation,
        null,
        "argument_dry_run_required",
        "Select exactly one migration mode: --dry-run, --stage, --adoption-dry-run, --apply or --audit.",
      );
    const destination = option(parsed.args.to, "--to");
    const actorId = option(parsed.args.actor, "--actor");
    const requestId = option(parsed.args.request, "--request");
    const stageValue = parsed.args.stageManifest;
    const inputValue = parsed.args.input;
    const externalInputs =
      inputValue === undefined
        ? []
        : (Array.isArray(inputValue) ? inputValue : [inputValue]).map((value) =>
            path.resolve(option(value, "--input")!),
          );
    const stageManifests =
      stageValue === undefined
        ? []
        : (Array.isArray(stageValue) ? stageValue : [stageValue]).map((value) =>
            option(value, "--stage-manifest")!,
          );
    if (
      (destination && (!actorId || !requestId)) ||
      (!destination &&
        (actorId ||
          requestId ||
          stageManifests.length ||
          externalInputs.length ||
          parsed.args.stage ||
          parsed.args.audit ||
          parsed.args.plan ||
          parsed.args.adoptionDryRun ||
          parsed.args.apply ||
          parsed.args.adoptionPlan ||
          parsed.args.taskSpec))
    )
      return invalidResult(
        parsed.operation,
        null,
        "argument_migration_intent_required",
        "Transfer planning requires --to, --actor and --request together.",
      );
    if (
      parsed.args.stage === true ||
      parsed.args.audit === true ||
      parsed.args.adoptionDryRun === true ||
      parsed.args.apply === true
    ) {
      const planFile = option(parsed.args.plan, "--plan");
      if (!planFile || !destination || !actorId || !requestId)
        return invalidResult(
          parsed.operation,
          null,
          "argument_migration_plan_required",
          "Staging and audit require a saved --plan and explicit transfer intent.",
        );
      if (migrationCredentialPath(planFile))
        return invalidResult(
          parsed.operation,
          null,
          "argument_migration_plan_invalid",
          "A private file cannot be used as a migration plan.",
        );
      const plan: unknown = JSON.parse(
        transferRead(path.resolve(planFile), 8 * 1024 * 1024).toString("utf8"),
      );
      if (parsed.args.adoptionDryRun === true || parsed.args.apply === true) {
        const raw = parsed.args.taskSpec;
        const tasks = (raw === undefined ? [] : Array.isArray(raw) ? raw : [raw]).map((value) => {
          const selected = option(value, "--task-spec")!;
          const separator = selected.indexOf("=");
          if (separator < 1 || separator === selected.length - 1)
            throw new FoundryContextError(
              "argument_task_spec_invalid",
              "Select --task-spec source-task=absolute-spec-file.",
            );
          return {
            sourceTask: selected.slice(0, separator),
            specFile: path.resolve(selected.slice(separator + 1)),
          };
        });
        const adoptionFile = option(parsed.args.adoptionPlan, "--adoption-plan");
        if (
          (parsed.args.apply === true && !adoptionFile) ||
          (parsed.args.adoptionDryRun === true && adoptionFile)
        )
          throw new FoundryContextError(
            "argument_adoption_plan_required",
            "Apply requires a saved adoption plan; adoption dry-run reconstructs it.",
          );
        if (adoptionFile && migrationCredentialPath(adoptionFile))
          throw new FoundryContextError(
            "argument_migration_plan_invalid",
            "Private storage cannot be used as an adoption plan.",
          );
        const adoptionPlan: unknown = adoptionFile
          ? JSON.parse(transferRead(path.resolve(adoptionFile), 8 * 1024 * 1024).toString("utf8"))
          : undefined;
        result = await facade.migrationAdoption({
          destination,
          actorId,
          requestId,
          stageManifests,
          externalInputs,
          plan,
          tasks,
          adoptionPlan,
          apply: parsed.args.apply === true,
        });
      } else {
        if (parsed.args.taskSpec !== undefined || parsed.args.adoptionPlan !== undefined)
          throw new FoundryContextError(
            "argument_migration_plan_invalid",
            "Task specifications belong to explicit adoption preview/application.",
          );
        result = await facade.migrationTransfer({
          destination,
          actorId,
          requestId,
          stageManifests,
          externalInputs,
          plan,
          audit: parsed.args.audit === true,
        });
      }
    } else {
      if (
        parsed.args.plan !== undefined ||
        parsed.args.taskSpec !== undefined ||
        parsed.args.adoptionPlan !== undefined
      )
        return invalidResult(
          parsed.operation,
          null,
          "argument_migration_plan_invalid",
          "Dry-run reconstructs a new plan; saved plans are used by stage or audit.",
        );
      result = facade.migrationDryRun(
        destination
          ? {
              destination,
              actorId: actorId!,
              requestId: requestId!,
              stageManifests,
              externalInputs,
            }
          : undefined,
      );
    }
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
  prepareHost?: PrepareRuntimeHost,
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
    const prepared =
      prepareHost && !effectiveHost.signal?.aborted ? await prepareHost(effectiveHost.signal!) : {};
    result = await runPublicCommand(parsed, {
      ...effectiveHost,
      ...prepared,
      signal: effectiveHost.signal,
    });
  } catch (error) {
    result = effectiveHost.signal?.aborted
      ? interruptedResult(parsed.operation, null)
      : error instanceof FoundryContextError && error.code.startsWith("argument_")
        ? invalidResult(parsed.operation, null, error.code, error.message)
        : failedResult(
            parsed.operation,
            null,
            error instanceof FoundryContextError ? error.code : "runtime_operation_failed",
            error instanceof FoundryContextError
              ? error.message
              : "Foundry public operation failed before changing task state.",
            error instanceof FoundryContextError && error.code === "managed_runtime_unsupported"
              ? "blocked"
              : "failed",
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

/** Package bin boundary: never fall back to repository/developer commands. */
export async function runFoundryPublicCommand(
  argv: string[] = process.argv,
  host: FoundryRuntimeCommandHost = {},
  prepareHost?: PrepareRuntimeHost,
): Promise<void> {
  if (publicCommand(argv)) return runFoundryRuntimeCommand(argv, host, prepareHost);
  return runFoundryRuntimeCommand(
    [
      argv[0] ?? process.execPath,
      argv[1] ?? "tiangong-foundry",
      "task",
      "__unknown",
      ...argv.slice(2),
    ],
    host,
    prepareHost,
  );
}

if (import.meta.main) void runFoundryRuntimeCommand();

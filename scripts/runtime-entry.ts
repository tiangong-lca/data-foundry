#!/usr/bin/env node
import path from "node:path";
import { createFoundryRuntime } from "./foundry-runtime.ts";
import { parseArgs } from "./lib/foundry-args.ts";
import {
  captureFoundryInput,
  createFoundryRuntimeContext,
  FoundryContextError,
} from "./lib/foundry-runtime-context.ts";
import { exitCodeForCommand } from "./lib/foundry-command-registry.ts";

function option(value: unknown, name: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !value.trim())
    throw new FoundryContextError("argument_invalid", `${name} requires one nonempty value.`);
  return value;
}

export async function runFoundryRuntimeCommand(argv: string[] = process.argv): Promise<void> {
  try {
    const [command = "help", ...rest] = argv.slice(2);
    if (!["init", "doctor", "profiles-list", "dataset-curation-cleanup"].includes(command)) {
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
          : command === "doctor"
            ? runtime.describe()
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

if (import.meta.main) void runFoundryRuntimeCommand();

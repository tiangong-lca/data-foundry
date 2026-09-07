import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  FoundryContextError,
  resolveFoundryOutput,
  type FoundryRuntimeContext,
} from "./foundry-runtime-context.ts";
import {
  assertQualifiedFoundryRuntime,
  type QualifiedFoundryRuntime,
} from "./foundry-runtime-qualification.ts";
import { resolveInstalledTiangongLcaCliPackage } from "./foundry-runtime-utils.ts";
import { createFoundryIsolatedChildEnvironment } from "./foundry-runtime-environment.ts";
import type { FoundryTaskOperation } from "./foundry-task-types.ts";

export function createWorkflowStageDirectory(
  context: FoundryRuntimeContext,
  operation: FoundryTaskOperation,
  stage: string,
): string {
  const parent = resolveFoundryOutput(context, `outputs/${stage}/${operation.operationId}`);
  fs.mkdirSync(parent, { recursive: true, mode: 0o700 });
  resolveFoundryOutput(context, parent);
  return fs.mkdtempSync(path.join(parent, "run-"));
}

export function registerWorkflowStageFiles(
  context: FoundryRuntimeContext,
  operation: FoundryTaskOperation,
  directory: string,
): string[] {
  const files: string[] = [];
  const visit = (current: string) => {
    resolveFoundryOutput(context, current);
    for (const name of fs.readdirSync(current).sort()) {
      const file = path.join(current, name),
        stat = fs.lstatSync(file);
      if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile()))
        throw new FoundryContextError(
          "workflow_output_invalid",
          "Stage outputs must be regular files.",
        );
      if (stat.isDirectory()) visit(file);
      else {
        if (files.length >= 9_998)
          throw new FoundryContextError(
            "workflow_output_limit",
            "Stage exceeds the task artifact limit.",
          );
        operation.writeText(file, fs.readFileSync(file));
        files.push(file);
      }
    }
  };
  visit(directory);
  return files;
}

export function runWorkflowLocalCli(
  context: FoundryRuntimeContext,
  qualified: QualifiedFoundryRuntime,
  temporary: string,
  argv: readonly string[],
): Record<string, unknown> {
  const result = runWorkflowLocalCliResult(context, qualified, temporary, argv);
  if (![0, 2].includes(result.exit) || "error" in result.report)
    throw new FoundryContextError(
      "workflow_cli_failed",
      "Local CLI returned an invalid stage report.",
    );
  return result.report;
}

export function runWorkflowLocalCliResult(
  context: FoundryRuntimeContext,
  qualified: QualifiedFoundryRuntime,
  temporary: string,
  argv: readonly string[],
): { exit: number; report: Record<string, unknown> } {
  const local =
    (argv[0] === "qa" && ["flow", "process", "lifecyclemodel"].includes(argv[1])) ||
    (argv[0] === "dataset" && argv[1] === "curation-queue" && argv[2] === "build") ||
    (argv[0] === "dataset" && argv[1] === "classification" && argv[2] === "apply") ||
    (argv[0] === "dataset" && argv[1] === "patch" && argv[2] === "apply");
  if (!local)
    throw new FoundryContextError(
      "workflow_command_invalid",
      "This stage admits local QA, queue preparation and patch application only.",
    );
  assertQualifiedFoundryRuntime(context, qualified);
  const cli = resolveInstalledTiangongLcaCliPackage();
  const child = spawnSync(process.execPath, [cli.binPath, ...argv], {
    cwd: context.workspaceRoot,
    env: createFoundryIsolatedChildEnvironment({ tempRoot: temporary }),
    encoding: "utf8",
    shell: false,
    timeout: 120_000,
    maxBuffer: 8 * 1024 * 1024,
  });
  if (
    child.error ||
    child.signal ||
    ![0, 1, 2].includes(child.status ?? -1) ||
    !child.stdout.trim()
  )
    throw new FoundryContextError(
      "workflow_cli_failed",
      `Local CLI ${argv.slice(0, 2).join(" ")} did not return a stage report.`,
    );
  const report: unknown = JSON.parse(child.stdout);
  if (!report || typeof report !== "object" || Array.isArray(report))
    throw new FoundryContextError(
      "workflow_cli_failed",
      "Local CLI returned an invalid stage report.",
    );
  assertQualifiedFoundryRuntime(context, qualified);
  return { exit: child.status!, report: report as Record<string, unknown> };
}

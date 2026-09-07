import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  FoundryContextError,
  readFoundryInput,
  resolveFoundryOutput,
  type FoundryRuntimeContext,
} from "./foundry-runtime-context.ts";
import {
  assertQualifiedFoundryRuntime,
  type QualifiedFoundryRuntime,
} from "./foundry-runtime-qualification.ts";
import { createFoundryIsolatedChildEnvironment } from "./foundry-runtime-environment.ts";
import { resolveInstalledTiangongLcaCliPackage } from "./foundry-runtime-utils.ts";
import { runFoundryTaskOperation } from "./foundry-task-store.ts";
import { supportedDatasetTypes } from "./import-curation/internal/dataset-types.ts";

export async function prepareFoundryWorkflowContext(
  context: FoundryRuntimeContext,
  qualified: QualifiedFoundryRuntime,
  selectedTypes: readonly string[],
) {
  assertQualifiedFoundryRuntime(context, qualified);
  if (!selectedTypes.length || selectedTypes.some((type) => !supportedDatasetTypes.has(type)))
    throw new FoundryContextError(
      "workflow_context_type_invalid",
      "Select supported task entity types.",
    );
  const types = [
    ...new Set(
      selectedTypes.flatMap((type) =>
        type === "support" ? ["contact", "source", "flowproperty", "unitgroup"] : [type],
      ),
    ),
  ].sort();
  return runFoundryTaskOperation(
    context,
    { command: "dataset-context-pack", options: { types, profile: "ai-import" } },
    (operation) => {
      assertQualifiedFoundryRuntime(context, qualified);
      for (const input of context.inputs) readFoundryInput(context, input.path);
      const parent = resolveFoundryOutput(context, `outputs/context/${operation.operationId}`);
      fs.mkdirSync(parent, { recursive: true, mode: 0o700 });
      resolveFoundryOutput(context, parent);
      // The owner writes to a new task-contained generation. Only this invocation's
      // inspected outputs enter the transaction; an interrupted generation is never adopted.
      const output = fs.mkdtempSync(path.join(parent, "run-"));
      fs.mkdirSync(resolveFoundryOutput(context, "tmp"), { recursive: true, mode: 0o700 });
      const temporary = fs.mkdtempSync(path.join(context.tempRoot, "context-"));
      try {
        const cli = resolveInstalledTiangongLcaCliPackage();
        const environment = createFoundryIsolatedChildEnvironment({ tempRoot: temporary });
        const reports: Array<{ type: string; report: string }> = [];
        for (const type of types) {
          assertQualifiedFoundryRuntime(context, qualified);
          const destination = path.join(output, type);
          const child = spawnSync(
            process.execPath,
            [
              cli.binPath,
              "dataset",
              "context-pack",
              "--type",
              type,
              "--profile",
              "ai-import",
              "--out-dir",
              destination,
              "--json",
            ],
            {
              cwd: context.workspaceRoot,
              env: environment,
              encoding: "utf8",
              shell: false,
              maxBuffer: 8 * 1024 * 1024,
              timeout: 120_000,
            },
          );
          if (child.error || child.signal || child.status !== 0 || child.stderr)
            throw new FoundryContextError(
              "workflow_context_failed",
              `CLI context preparation failed for ${type}.`,
            );
          const value: unknown = JSON.parse(child.stdout);
          if (
            !value ||
            typeof value !== "object" ||
            !("status" in value) ||
            value.status !== "completed"
          )
            throw new FoundryContextError(
              "workflow_context_invalid",
              "CLI returned no completed context pack.",
            );
          reports.push({ type, report: path.join(destination, "outputs/contract-report.json") });
        }
        const files: string[] = [];
        const register = (directory: string) => {
          for (const name of fs.readdirSync(directory).sort()) {
            const file = path.join(directory, name),
              stat = fs.lstatSync(file);
            if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile()))
              throw new FoundryContextError(
                "workflow_output_invalid",
                "Context outputs must be regular files.",
              );
            if (stat.isDirectory()) register(file);
            else {
              if (files.length >= 9_998)
                throw new FoundryContextError(
                  "workflow_output_limit",
                  "Context exceeds the task artifact limit.",
                );
              operation.writeText(file, fs.readFileSync(file));
              files.push(file);
            }
          }
        };
        for (const input of context.inputs) readFoundryInput(context, input.path);
        assertQualifiedFoundryRuntime(context, qualified);
        register(output);
        const report = {
          schema: "tiangong-foundry.context-stage.v1",
          status: "completed",
          reports,
          files,
        };
        operation.writeJson(path.join(output, "foundry-context.json"), report);
        return report;
      } finally {
        fs.rmSync(temporary, { recursive: true, force: true });
      }
    },
  );
}

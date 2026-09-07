import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  captureFoundryInput,
  FoundryContextError,
  readFoundryInput,
  type FoundryRuntimeContext,
} from "./foundry-runtime-context.ts";
import {
  assertQualifiedFoundryRuntime,
  type QualifiedFoundryRuntime,
} from "./foundry-runtime-qualification.ts";
import {
  copyFoundryIsolatedExecutable,
  createFoundryIsolatedChildEnvironment,
} from "./foundry-runtime-environment.ts";
import { runFoundryTaskOperation } from "./foundry-task-store.ts";
import { runTidasImport } from "./tidas-adapter.ts";

/** Native conversion is local preparation; its outputs enter the existing task index. */
export async function importFoundryWorkflowPackage(
  context: FoundryRuntimeContext,
  qualified: QualifiedFoundryRuntime,
  input: string,
) {
  assertQualifiedFoundryRuntime(context, qualified);
  readFoundryInput(context, input);
  return runFoundryTaskOperation(
    context,
    { command: "dataset-tidas-import", options: { input, from_format: "auto", target: "tidas" } },
    (operation) => {
      assertQualifiedFoundryRuntime(context, qualified);
      readFoundryInput(context, input);
      const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "foundry-workflow-import-"));
      try {
        const executable = path.join(temporary, path.basename(qualified.tidas.executable_path));
        copyFoundryIsolatedExecutable(qualified.tidas.executable_path, executable);
        const copied = captureFoundryInput(executable);
        const expected = qualified.tidas.expectation.executable;
        if (copied.bytes !== expected.bytes || copied.sha256 !== expected.sha256)
          throw new FoundryContextError(
            "runtime_tidas_unqualified",
            "Selected native bytes changed.",
          );
        const output = path.join(temporary, "converted");
        const result = runTidasImport({
          repoRoot: context.workspaceRoot,
          options: { tidasBin: executable, input, output, target: "tidas" },
          environment: createFoundryIsolatedChildEnvironment({ tempRoot: temporary }),
        });
        readFoundryInput(context, input);
        assertQualifiedFoundryRuntime(context, qualified);
        const prefix = `outputs/import/${operation.operationId}`;
        const files: Array<{ path: string; bytes: number; sha256: string }> = [];
        const collect = (directory: string) => {
          for (const name of fs.readdirSync(directory).sort()) {
            const file = path.join(directory, name);
            const stat = fs.lstatSync(file);
            if (stat.isSymbolicLink() || (!stat.isFile() && !stat.isDirectory()))
              throw new FoundryContextError(
                "workflow_output_invalid",
                "Native outputs must be regular files.",
              );
            if (stat.isDirectory()) collect(file);
            else {
              if (files.length >= 9_998)
                throw new FoundryContextError(
                  "workflow_output_limit",
                  "Native output exceeds the task artifact limit.",
                );
              const relative = path.relative(output, file).split(path.sep).join("/");
              const destination = `${prefix}/${relative}`;
              const fact = captureFoundryInput(file);
              operation.writeText(destination, fs.readFileSync(file));
              files.push({ path: destination, bytes: fact.bytes, sha256: fact.sha256 });
            }
          }
        };
        if (fs.existsSync(output)) collect(output);
        const report = {
          schema: "tiangong-foundry.native-import-stage.v1",
          status: result.exit_code === 0 ? "completed" : "blocked",
          input: context.inputs.find((fact) => fact.path === input)!,
          native_exit: result.exit_code,
          native_report: result.report,
          files,
        };
        operation.writeJson(`${prefix}/foundry-native-import.json`, report);
        return report;
      } finally {
        fs.rmSync(temporary, { recursive: true, force: true });
      }
    },
  );
}

import fs from "node:fs";
import path from "node:path";

import {
  executeFoundryCommandSpec,
  parseFoundryCommandSpec,
  type ExecuteFoundryCommandSpecOptions,
  type FoundryCommandSpec,
  type FoundryCommandSpecSpawnResult,
} from "@tiangong-lca/cli/command-spec";

import type { JsonRecord } from "./entity-projection.ts";

export interface ReadyScopeCommandContext {
  cwd: string;
  environment: NodeJS.ProcessEnv;
  logDir: string;
  token: string;
  stage: string;
}

export interface ReadyScopeCommandExecutorDependencies {
  resolveArtifactPath: (artifactPath: string) => string | null;
  repoRelativePath: (filePath: string) => string;
  executeCommandSpec?: (
    value: FoundryCommandSpec,
    options: ExecuteFoundryCommandSpecOptions,
  ) => Promise<FoundryCommandSpecSpawnResult>;
}

export interface ReadyScopeCommandExecutor {
  run: (value: unknown, context: ReadyScopeCommandContext) => Promise<JsonRecord>;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createReadyScopeCommandExecutor({
  resolveArtifactPath,
  repoRelativePath,
  executeCommandSpec = executeFoundryCommandSpec,
}: ReadyScopeCommandExecutorDependencies): ReadyScopeCommandExecutor {
  async function run(value: unknown, context: ReadyScopeCommandContext): Promise<JsonRecord> {
    const stdoutLog = path.join(context.logDir, `${context.token}.${context.stage}.stdout.log`);
    const stderrLog = path.join(context.logDir, `${context.token}.${context.stage}.stderr.log`);
    fs.mkdirSync(context.logDir, { recursive: true });
    let spec: FoundryCommandSpec | null = null;
    let result: FoundryCommandSpecSpawnResult | null = null;
    let failure: string | null = null;
    try {
      spec = parseFoundryCommandSpec(value);
      if (spec.binding.artifacts.length === 0) {
        throw new Error("Executable scope CommandSpec must bind at least one artifact.");
      }
      result = await executeCommandSpec(spec, {
        resolveArtifactPath,
        cwd: context.cwd,
        env: context.environment,
      });
      if (result.error) failure = errorMessage(result.error);
    } catch (error) {
      failure = errorMessage(error);
    }
    fs.writeFileSync(stdoutLog, result?.stdout ?? "");
    fs.writeFileSync(stderrLog, result?.stderr ?? "");
    const projection: JsonRecord = {
      stage: context.stage,
      command: spec,
      exit_code: typeof result?.status === "number" ? result.status : 1,
      stdout_log: repoRelativePath(stdoutLog),
      stderr_log: repoRelativePath(stderrLog),
    };
    if (failure) projection.error = failure;
    return projection;
  }

  return { run };
}

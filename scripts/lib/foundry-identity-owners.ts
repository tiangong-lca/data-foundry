import { parseScalar } from "./foundry-args.ts";
import {
  createFoundryRuntimeUtils,
  resolveTiangongLcaCliRuntimeCommand,
} from "./foundry-runtime-utils.ts";
import { createTidasRowUtils } from "./tidas-row-utils.ts";
import { bundleRowTypes } from "./bundle-row-types.ts";
import { createBundleSourceContextUtils } from "./bundle-source-context.ts";
import { createDecisionTaskUtils } from "./decision-task-utils.ts";
import { createIdentityPreflightArtifactUtils } from "./identity-preflight-artifacts.ts";
import { createIdentityPreflightRunCommands } from "./decision-owners/identity-preflight.ts";
import {
  datasetIdentity,
  unwrapDatasetPayload,
} from "./import-curation/internal/dataset-payload.ts";
import { ensureArray } from "./import-curation/internal/runtime-io.ts";
import { workflowObject } from "./foundry-workflow-state.ts";
import type { FoundryRuntimeContext } from "./foundry-runtime-context.ts";
import {
  assertQualifiedFoundryRuntime,
  type QualifiedFoundryRuntime,
} from "./foundry-runtime-qualification.ts";

interface FoundryIdentityOwners {
  preflight: ReturnType<typeof createIdentityPreflightRunCommands>;
  invoke<T>(action: () => T): T;
}

/** Current row payloads and explicit child execution facts, without the developer dispatcher. */
export function createFoundryIdentityOwners(
  context: FoundryRuntimeContext,
  qualified: QualifiedFoundryRuntime,
  type: "flow" | "process",
  execution: { environment: NodeJS.ProcessEnv; cwd: string },
): FoundryIdentityOwners {
  assertQualifiedFoundryRuntime(context, qualified);
  const runtime = createFoundryRuntimeUtils({ parseScalar, repoRoot: context.assetRoot });
  const cli = resolveTiangongLcaCliRuntimeCommand({});
  const rows = createTidasRowUtils({ ...runtime, bundleRowTypes });
  const sources = createBundleSourceContextUtils({ asText: runtime.asText });
  const decisions = createDecisionTaskUtils({
    ...runtime,
    ensureArray,
    readJson: (file) => workflowObject(runtime.readJson(file)),
    readJsonLines: (file) => runtime.readJsonLines(file).map(workflowObject),
  });
  const dependencies = {
    ...runtime,
    ...rows,
    ...sources,
    safeFileToken: decisions.safeFileToken,
    resolveTiangongLcaCliCommand: () => cli,
    resolveTiangongLcaCliCommandPrefix: () => [cli.command, ...cli.args],
    resolveTiangongLcaCliBin: () => cli.display,
    ensureArray,
    readRowsFile: (file: string) =>
      runtime.readRowsFile(file).map((row) => workflowObject(unwrapDatasetPayload(row, type))),
    datasetIdentity: (row: unknown, datasetType: string) => datasetIdentity(row, 0, datasetType),
  };
  const artifacts = createIdentityPreflightArtifactUtils(
    dependencies satisfies Record<
      keyof Parameters<typeof createIdentityPreflightArtifactUtils>[0],
      unknown
    > as unknown as Parameters<typeof createIdentityPreflightArtifactUtils>[0],
  );
  const preflight = createIdentityPreflightRunCommands({
    ...dependencies,
    ...artifacts,
    executionEnvironment: execution.environment,
    executionCwd: execution.cwd,
    repoRoot: context.assetRoot,
  } as unknown as Parameters<typeof createIdentityPreflightRunCommands>[0]);
  return {
    preflight,
    invoke<T>(action: () => T): T {
      const exitCode = process.exitCode;
      try {
        return action();
      } finally {
        process.exitCode = exitCode;
      }
    },
  };
}

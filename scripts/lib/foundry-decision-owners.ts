import { parseScalar } from "./foundry-args.ts";
import { createFoundryRuntimeUtils } from "./foundry-runtime-utils.ts";
import { createTidasRowUtils } from "./tidas-row-utils.ts";
import { bundleRowTypes } from "./bundle-row-types.ts";
import { createDecisionTaskUtils } from "./decision-task-utils.ts";
import {
  datasetIdentity,
  unwrapDatasetPayload,
} from "./import-curation/internal/dataset-payload.ts";
import { profileFor } from "./import-curation/profiles.ts";
import { referenceDescriptionText } from "./canonical-description.ts";
import { ensureArray } from "./import-curation/internal/runtime-io.ts";
import { workflowObject } from "./foundry-workflow-state.ts";
import { createClassificationDecisionCommands } from "./decision-owners/classification.ts";
import { createLocationDecisionCommands } from "./decision-owners/location.ts";
import { createIdentityDecisionTaskCommands } from "./decision-owners/identity-task.ts";
import { createIdentityDecisionCommands } from "./decision-owners/identity.ts";
import { runWorkflowLocalCliResult } from "./foundry-workflow-io.ts";
import type { FoundryRuntimeContext } from "./foundry-runtime-context.ts";
import type { QualifiedFoundryRuntime } from "./foundry-runtime-qualification.ts";

interface FoundryDecisionOwners {
  classification: ReturnType<typeof createClassificationDecisionCommands>;
  location: ReturnType<typeof createLocationDecisionCommands>;
  identityTask: ReturnType<typeof createIdentityDecisionTaskCommands>;
  identity: ReturnType<typeof createIdentityDecisionCommands>;
  invoke<T>(action: () => T): T;
  flowClassificationSchemaType(row: unknown): string;
}

/** Reuse the existing owners without loading the developer dispatcher or ambient CLI overrides. */
export function createFoundryDecisionOwners(
  context: FoundryRuntimeContext,
  qualified: QualifiedFoundryRuntime,
  temporary: string,
): FoundryDecisionOwners {
  const runtime = createFoundryRuntimeUtils({ parseScalar, repoRoot: context.assetRoot });
  const rows = createTidasRowUtils({ ...runtime, bundleRowTypes });
  const decisions = createDecisionTaskUtils({
    ...runtime,
    ensureArray,
    readJson: (file) => workflowObject(runtime.readJson(file)),
    readJsonLines: (file) => runtime.readJsonLines(file).map(workflowObject),
  });
  const dependencies = {
    ...runtime,
    ...rows,
    ...decisions,
    repoRoot: context.assetRoot,
    includeExecutionCommands: false,
    datasetIdentity: (row: unknown, type: string) => datasetIdentity(row, 0, type),
    flowTypeOfDataSet: (row: unknown) => rows.flowTypeOfDataSet(unwrapDatasetPayload(row, "flow")),
    referenceShortDescription: (value: unknown) => referenceDescriptionText(value, runtime.asText),
    profileFor,
    runTiangongJsonStage(stage: string, argv: string[]) {
      const result = runWorkflowLocalCliResult(context, qualified, temporary, argv);
      return {
        stage,
        exit_code: result.exit,
        report: result.report,
        stderr: "",
        status: result.report.status,
      };
    },
  };
  const classification = createClassificationDecisionCommands(
    dependencies as unknown as Parameters<typeof createClassificationDecisionCommands>[0],
  );
  const location = createLocationDecisionCommands(
    dependencies as unknown as Parameters<typeof createLocationDecisionCommands>[0],
  );
  const identityTask = createIdentityDecisionTaskCommands(
    dependencies as unknown as Parameters<typeof createIdentityDecisionTaskCommands>[0],
  );
  const identity = createIdentityDecisionCommands(
    dependencies as unknown as Parameters<typeof createIdentityDecisionCommands>[0],
  );
  const invoke = <T>(action: () => T): T => {
    const exitCode = process.exitCode;
    try {
      return action();
    } finally {
      process.exitCode = exitCode;
    }
  };
  return {
    classification,
    location,
    identityTask,
    identity,
    invoke,
    flowClassificationSchemaType: (row: unknown) =>
      rows.flowClassificationSchemaType(unwrapDatasetPayload(row, "flow")),
  };
}

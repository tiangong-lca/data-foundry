import {
  createFoundryFacade as createInternalFoundryFacade,
  type FoundryFacadeOptions,
} from "./foundry-facade.ts";
import { trustRuntimeManifest } from "@tiangong-lca/cli/runtime";
import { FoundryContextError, type FoundryWorkspaceAccess } from "./lib/foundry-runtime-context.ts";

/** Host-only bridge: verifies the independent anchor using the same CLI instance as this package. */
export function createFoundryWorkspaceAccess(input: {
  manifestBytes: Uint8Array;
  expectedSha256: string;
  access: "read" | "write";
}): FoundryWorkspaceAccess {
  if (input.access !== "read" && input.access !== "write")
    throw new FoundryContextError(
      "workspace_access_invalid",
      "Select read or write workspace access.",
    );
  return Object.freeze({
    manifest: trustRuntimeManifest(input.manifestBytes, input.expectedSha256),
    access: input.access,
  });
}

export type FoundryPackageFacadeOptions = Omit<FoundryFacadeOptions, "moduleUrl">;
export type { FoundryFacadeRuntimeSelection } from "./foundry-facade.ts";
export type { FoundryWorkspaceAccess } from "./lib/foundry-runtime-context.ts";
export {
  FOUNDRY_RUNTIME_SELECTION_SCHEMA,
  type FoundryRuntimeSelectionRecord,
} from "./lib/foundry-runtime-selection-record.ts";
export type { FoundryRuntimeManagerOptions } from "./lib/foundry-runtime-selection.ts";

/** Public host factory with package/source identity bound by this module, never caller input. */
export function createFoundryFacade(options: FoundryPackageFacadeOptions) {
  return createInternalFoundryFacade({ ...options, moduleUrl: import.meta.url });
}

export { runFoundryPublicCommand, type FoundryRuntimeCommandHost } from "./runtime-entry.ts";
export {
  FOUNDRY_COMMAND_NEXT_ACTION_BINDING_SCHEMA,
  FOUNDRY_OPERATION_RESULT_SCHEMA,
  assertFoundryOperationResult,
  commandNextActionBindingSha256,
  exitCodeForFoundryOperationResult,
  foundryOperationPermissionStates,
  foundryOperationStatuses,
  foundryPublicOperations,
  type FoundryOperationArtifact,
  type FoundryOperationBlocker,
  type FoundryOperationNextAction,
  type FoundryOperationPermissionState,
  type FoundryOperationPermissions,
  type FoundryOperationResult,
  type FoundryOperationStatus,
  type FoundryPublicOperation,
} from "./lib/foundry-operation-result.ts";
export {
  FOUNDRY_TASK_START_SPEC_SCHEMA,
  parseFoundryTaskStartSpec,
  type FoundryTaskStartSpec,
} from "./lib/foundry-task-start-spec.ts";
export {
  FOUNDRY_WORKSPACE_MIGRATION_PLAN_SCHEMA,
  type FoundryWorkspaceMigrationPlan,
} from "./lib/foundry-migration-inventory.ts";
export {
  FOUNDRY_MIGRATION_TRANSFER_PLAN_SCHEMA,
  type FoundryMigrationTransferPlan,
  type MigrationStageEvidence,
} from "./lib/foundry-migration-plan.ts";
export {
  FOUNDRY_MIGRATION_TRANSFER_RECEIPT_SCHEMA,
  type FoundryMigrationTransferReceipt,
} from "./lib/foundry-migration-transfer.ts";
export {
  FOUNDRY_MIGRATION_ADOPTION_PLAN_SCHEMA,
  type FoundryMigrationAdoptionPlan,
  type MigrationAdoptionSelection,
} from "./lib/foundry-migration-adoption-plan.ts";
export {
  FOUNDRY_MIGRATION_ACTIVATION_SCHEMA,
  FOUNDRY_MIGRATED_WORKSPACE_SCHEMA,
  type FoundryMigrationActivation,
  type MigrationTaskAuthority,
} from "./lib/foundry-migration-authority.ts";
export {
  FOUNDRY_PACKAGE_DESCRIPTOR_SCHEMA,
  FoundryPackageError,
  assertFoundryPackage,
  assertFoundryPackageDescriptor,
  type FoundryPackageDescriptor,
  type FoundryPackageFileFact,
} from "./lib/foundry-package-contract.ts";

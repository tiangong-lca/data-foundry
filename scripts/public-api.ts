import {
  createFoundryFacade as createInternalFoundryFacade,
  type FoundryFacadeOptions,
} from "./foundry-facade.ts";

export type FoundryPackageFacadeOptions = Omit<FoundryFacadeOptions, "moduleUrl">;
export type { FoundryFacadeRuntimeSelection } from "./foundry-facade.ts";

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
  FOUNDRY_PACKAGE_DESCRIPTOR_SCHEMA,
  FoundryPackageError,
  assertFoundryPackage,
  assertFoundryPackageDescriptor,
  type FoundryPackageDescriptor,
  type FoundryPackageFileFact,
} from "./lib/foundry-package-contract.ts";

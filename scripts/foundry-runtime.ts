import fs from "node:fs";
import path from "node:path";
import {
  assertFoundryRuntimeContext,
  FoundryContextError,
  initializeFoundryWorkspace,
  readFoundryInput,
  resolveFoundryOutput,
  resolveFoundryInputPath,
  resolveFoundryAsset,
  type FoundryRuntimeContext,
} from "./lib/foundry-runtime-context.ts";
import { runFoundryTaskOperation } from "./lib/foundry-task-store.ts";
import {
  assertVerifiedFoundryIdentity,
  verifyFoundryRuntimeIdentity,
  type FoundryAuthentication,
  type VerifiedFoundryIdentity,
} from "./lib/foundry-runtime-identity.ts";
import {
  assertQualifiedFoundryRuntime,
  foundryRuntimeQualificationIdentity,
  type QualifiedFoundryRuntime,
} from "./lib/foundry-runtime-qualification.ts";
import {
  loadFoundryTaskAuthorization,
  prepareDerivedFoundryTaskAuthorization,
  registerFoundryTaskAuthorization,
  type PrepareDerivedFoundryTaskAuthorizationOptions,
  type TaskApprovalEvidence,
} from "./lib/foundry-task-authorization.ts";
import {
  assertFoundryExecutionAdmission,
  createFoundryExecutionCapsule,
  rehydrateFoundryExecutionAdmission,
  type CreateFoundryExecutionCapsuleOptions,
  type FoundryExecutionAdmission,
  type RehydrateFoundryExecutionAdmissionOptions,
} from "./lib/foundry-execution-admission.ts";
import { foundryRuntimeCommandPolicies } from "./lib/foundry-runtime-command-policy.ts";
import { listImportProfiles } from "./lib/import-curation/profiles.ts";
import { runDatasetCurationCleanup } from "./lib/import-curation/curation-cleanup.ts";
import { readRows } from "./lib/import-curation/internal/runtime-io.ts";

export interface FoundryCleanupRequest {
  input: string;
  type: string;
  outputDirectory?: string;
  sourceInput?: string;
  profileId?: string;
}

/** Application boundary for user workspaces. Repository maintenance stays outside it. */
export function createFoundryRuntime(
  context: FoundryRuntimeContext,
  qualification?: QualifiedFoundryRuntime,
) {
  assertFoundryRuntimeContext(context);
  if (qualification) assertQualifiedFoundryRuntime(context, qualification);
  const requireQualification = (): QualifiedFoundryRuntime => {
    if (!qualification)
      throw new FoundryContextError(
        "runtime_qualification_required",
        "This operation requires an exact CLI and TIDAS runtime qualification.",
      );
    assertQualifiedFoundryRuntime(context, qualification);
    return qualification;
  };
  return Object.freeze({
    context,
    qualification: qualification ?? null,
    initializeWorkspace: () => initializeFoundryWorkspace(context),
    verifyIdentity: (authentication?: FoundryAuthentication) =>
      verifyFoundryRuntimeIdentity(context, authentication, process.env, qualification),
    registerAuthorization: (
      identity: VerifiedFoundryIdentity,
      options: {
        inputFile: string;
        grant: unknown;
        evidence: readonly TaskApprovalEvidence[];
        expectedPreviousSha256?: string | null;
      },
    ) => {
      if (qualification) assertVerifiedFoundryIdentity(context, identity, qualification);
      return registerFoundryTaskAuthorization(context, identity, options, qualification);
    },
    loadAuthorization: (identity: VerifiedFoundryIdentity, inputFile: string) => {
      if (qualification) assertVerifiedFoundryIdentity(context, identity, qualification);
      return loadFoundryTaskAuthorization(context, identity, inputFile, qualification);
    },
    prepareDerivedAuthorization: (
      identity: VerifiedFoundryIdentity,
      options: PrepareDerivedFoundryTaskAuthorizationOptions,
    ) => {
      const current = requireQualification();
      assertVerifiedFoundryIdentity(context, identity, current);
      return prepareDerivedFoundryTaskAuthorization(context, current, identity, options);
    },
    createExecutionCapsule: (
      identity: VerifiedFoundryIdentity,
      options: CreateFoundryExecutionCapsuleOptions,
    ) => {
      const current = requireQualification();
      assertVerifiedFoundryIdentity(context, identity, current);
      return createFoundryExecutionCapsule(context, current, identity, options);
    },
    rehydrateExecution: (
      identity: VerifiedFoundryIdentity,
      options: RehydrateFoundryExecutionAdmissionOptions,
    ) => {
      const current = requireQualification();
      assertVerifiedFoundryIdentity(context, identity, current);
      return rehydrateFoundryExecutionAdmission(context, current, identity, options);
    },
    admitExecution: (identity: VerifiedFoundryIdentity, admission: FoundryExecutionAdmission) => {
      const current = requireQualification();
      assertVerifiedFoundryIdentity(context, identity, current);
      return assertFoundryExecutionAdmission(context, current, identity, admission);
    },
    profiles: () => {
      resolveFoundryAsset(context, "specs/import-profiles.json");
      return listImportProfiles({ repoRoot: context.assetRoot });
    },
    describe: () => ({
      platform: context.platform,
      runtime: {
        package: context.runtime.packageName,
        version: context.runtime.packageVersion,
        entry_sha256: context.runtime.entrySha256,
      },
      workspace: { id: context.workspaceId, initialized: context.workspaceId !== null },
      task: { id: context.taskId, actor: context.actorId },
      qualification: qualification
        ? { status: "ready", identity: foundryRuntimeQualificationIdentity(context, qualification) }
        : { status: "required", identity: null },
      command_policy: {
        total: foundryRuntimeCommandPolicies.length,
        public_facade: foundryRuntimeCommandPolicies
          .filter((policy) => policy.distribution === "public-facade")
          .map((policy) => policy.command),
        internal_only: foundryRuntimeCommandPolicies.filter(
          (policy) => policy.distribution === "internal-only",
        ).length,
        excluded: foundryRuntimeCommandPolicies
          .filter((policy) => policy.distribution === "excluded")
          .map((policy) => policy.command),
      },
    }),
    async cleanup(request: FoundryCleanupRequest) {
      const input = resolveFoundryInputPath(context, request.input);
      const sourceInput = request.sourceInput
        ? resolveFoundryInputPath(context, request.sourceInput)
        : undefined;
      const outDir = resolveFoundryOutput(context, request.outputDirectory ?? "outputs/cleanup");
      return runFoundryTaskOperation(
        context,
        {
          command: "dataset-curation-cleanup",
          options: {
            type: request.type,
            source_input: sourceInput ?? null,
            output_directory: path.relative(context.taskRoot!, outDir).split(path.sep).join("/"),
          },
          task: { profileId: request.profileId, targetEntities: [request.type] },
        },
        (operation) => {
          readFoundryInput(context, input);
          if (sourceInput) readFoundryInput(context, sourceInput);
          return runDatasetCurationCleanup({
            repoRoot: context.workspaceRoot,
            options: { type: request.type, rowsFile: input, sourceRowsFile: sourceInput, outDir },
            io: {
              nowIso: operation.nowIso,
              fileExists(file) {
                if (!file) return false;
                const value = String(file);
                if (!context.inputs.some((fact) => fact.path === value))
                  resolveFoundryOutput(context, value);
                return fs.existsSync(value) && fs.lstatSync(value).isFile();
              },
              readRows(file) {
                return readRows(file, (selected) =>
                  readFoundryInput(context, selected).toString("utf8"),
                );
              },
              writeText(file, content) {
                const bytes =
                  typeof content === "string"
                    ? content
                    : Buffer.from(content.buffer, content.byteOffset, content.byteLength);
                operation.writeText(file, bytes);
              },
              writeJson(file, value) {
                operation.writeJson(file, value);
              },
            },
          });
        },
      );
    },
  });
}

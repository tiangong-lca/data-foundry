import fs from "node:fs";
import path from "node:path";
import {
  assertFoundryRuntimeContext,
  initializeFoundryWorkspace,
  readFoundryInput,
  resolveFoundryOutput,
  resolveFoundryInputPath,
  resolveFoundryAsset,
  type FoundryRuntimeContext,
} from "./lib/foundry-runtime-context.ts";
import { runFoundryTaskOperation } from "./lib/foundry-task-store.ts";
import {
  verifyFoundryRuntimeIdentity,
  type FoundryAuthentication,
  type VerifiedFoundryIdentity,
} from "./lib/foundry-runtime-identity.ts";
import {
  loadFoundryTaskAuthorization,
  registerFoundryTaskAuthorization,
  type TaskApprovalEvidence,
} from "./lib/foundry-task-authorization.ts";
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
export function createFoundryRuntime(context: FoundryRuntimeContext) {
  assertFoundryRuntimeContext(context);
  return Object.freeze({
    context,
    initializeWorkspace: () => initializeFoundryWorkspace(context),
    verifyIdentity: (authentication?: FoundryAuthentication) =>
      verifyFoundryRuntimeIdentity(context, authentication),
    registerAuthorization: (
      identity: VerifiedFoundryIdentity,
      options: {
        inputFile: string;
        grant: unknown;
        evidence: readonly TaskApprovalEvidence[];
        expectedPreviousSha256?: string | null;
      },
    ) => registerFoundryTaskAuthorization(context, identity, options),
    loadAuthorization: (identity: VerifiedFoundryIdentity, inputFile: string) =>
      loadFoundryTaskAuthorization(context, identity, inputFile),
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

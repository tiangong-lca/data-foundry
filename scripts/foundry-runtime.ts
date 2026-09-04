import fs from "node:fs";
import {
  assertFoundryRuntimeContext,
  initializeFoundryWorkspace,
  readFoundryInput,
  resolveFoundryOutput,
  resolveFoundryInputPath,
  resolveFoundryAsset,
  writeFoundryArtifact,
  type FoundryRuntimeContext,
} from "./lib/foundry-runtime-context.ts";
import { listImportProfiles } from "./lib/import-curation/profiles.ts";
import { runDatasetCurationCleanup } from "./lib/import-curation/curation-cleanup.ts";
import { readRows } from "./lib/import-curation/internal/runtime-io.ts";

export interface FoundryCleanupRequest {
  input: string;
  type: string;
  outputDirectory?: string;
  sourceInput?: string;
}

/** Application boundary for user workspaces. Repository maintenance stays outside it. */
export function createFoundryRuntime(context: FoundryRuntimeContext) {
  assertFoundryRuntimeContext(context);
  return Object.freeze({
    context,
    initializeWorkspace: () => initializeFoundryWorkspace(context),
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
    cleanup(request: FoundryCleanupRequest) {
      const input = resolveFoundryInputPath(context, request.input);
      const sourceInput = request.sourceInput
        ? resolveFoundryInputPath(context, request.sourceInput)
        : undefined;
      // Verify selections before creating any output. Existing owners retain transform semantics.
      readFoundryInput(context, input);
      if (sourceInput) readFoundryInput(context, sourceInput);
      const outDir = resolveFoundryOutput(context, request.outputDirectory ?? "outputs/cleanup");
      return runDatasetCurationCleanup({
        repoRoot: context.workspaceRoot,
        options: { type: request.type, rowsFile: input, sourceRowsFile: sourceInput, outDir },
        io: {
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
            writeFoundryArtifact(context, file, bytes);
          },
          writeJson(file, value) {
            writeFoundryArtifact(context, file, `${JSON.stringify(value, null, 2)}\n`);
          },
        },
      });
    },
  });
}

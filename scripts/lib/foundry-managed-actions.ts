import fs from "node:fs";
import {
  copyTrustedRuntimeManifestBytes,
  type CliRuntimeDescriptor,
  type RuntimeHostContext,
} from "@tiangong-lca/cli/runtime";
import {
  assertFoundryOperationResult,
  commandNextActionBindingSha256,
  type FoundryOperationResult,
} from "./foundry-operation-result.ts";
import { FoundryContextError } from "./foundry-runtime-error.ts";
import { transferPath, transferWriteOnce } from "./foundry-migration-transfer-io.ts";

/** Retain the verified host's launch policy when a caller executes a returned action. */
export function createManagedFoundryActionProjector(
  context: RuntimeHostContext,
  cli: CliRuntimeDescriptor,
  packageEntry: string,
): (result: FoundryOperationResult) => FoundryOperationResult {
  return (result) => {
    assertFoundryOperationResult(result);
    if (!result.next_actions.some((action) => action.kind === "command")) return result;
    for (const action of result.next_actions) {
      if (action.kind !== "command") continue;
      if (
        action.executable !== process.execPath ||
        !action.argv[0] ||
        fs.realpathSync(action.argv[0]) !== packageEntry
      )
        throw new FoundryContextError(
          "managed_action_invalid",
          "A managed action must continue through the verified Foundry package entry.",
        );
    }
    const bytes = Buffer.from(copyTrustedRuntimeManifestBytes(context.manifest));
    const relative = `foundry-manifests/${context.manifest.sha256}.json`;
    // A content-bound cache copy carries bytes, never authority from workspace state.
    transferWriteOnce(context.cacheDir, relative, bytes);
    const manifestFile = transferPath(context.cacheDir, relative);
    const nextActions = result.next_actions.map((action) => {
      if (action.kind !== "command") return action;
      const projected = {
        kind: action.kind,
        code: action.code,
        cwd: action.cwd,
        purpose: action.purpose,
        executable: cli.command.executable,
        argv: [
          ...cli.command.argv,
          "runtime",
          "exec",
          "--manifest",
          manifestFile,
          "--manifest-sha256",
          context.manifest.sha256,
          "--cache-dir",
          context.cacheDir,
          "--entry",
          context.entry,
          "--cwd",
          action.cwd,
          "--",
          ...action.argv.slice(1),
        ],
      };
      return { ...projected, binding_sha256: commandNextActionBindingSha256(projected) };
    });
    return assertFoundryOperationResult({ ...result, next_actions: nextActions });
  };
}

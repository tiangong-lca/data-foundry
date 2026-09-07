import type { TrustedRuntimeManifest } from "@tiangong-lca/cli/runtime";
import type { FoundryRuntimeIdentity } from "./foundry-runtime-paths.ts";

export interface FoundryInputFact {
  readonly path: string;
  readonly bytes: number;
  readonly sha256: string;
}

export interface FoundryAccountIntent {
  readonly projectRef: string;
  readonly userId: string;
  readonly sessionReference?: string;
}

export interface FoundryWorkspaceAccess {
  readonly manifest: TrustedRuntimeManifest;
  readonly access: "read" | "write";
}

export interface FoundryRuntimeContext {
  readonly runtime: FoundryRuntimeIdentity;
  readonly runtimeRoot: string;
  readonly assetRoot: string;
  readonly workspaceRoot: string;
  readonly workspaceId: string | null;
  readonly workspaceAccess: "read" | "write";
  readonly workspaceManifestSha256: string | null;
  readonly workspaceSchema: string;
  readonly workspaceFeatures: readonly string[];
  readonly migration: Readonly<{ plan_sha256: string; activation_sha256: string }> | null;
  readonly pendingMigration: string | null;
  readonly controlRoot: string;
  readonly stateRoot: string;
  readonly taskId: string | null;
  readonly actorId: string | null;
  readonly taskRoot: string | null;
  readonly tempRoot: string;
  readonly cacheRoot: string;
  readonly cacheBase: string;
  readonly platform: string;
  readonly accountIntent: Readonly<FoundryAccountIntent> | null;
  readonly inputs: readonly Readonly<FoundryInputFact>[];
}

export interface FoundryRuntimeContextOptions {
  moduleUrl: string;
  workspace?: string;
  cwd?: string;
  taskId?: string;
  actorId?: string;
  cacheBase?: string;
  managedCacheRoot?: string;
  environment?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  arch?: string;
  accountIntent?: FoundryAccountIntent;
  inputs?: readonly FoundryInputFact[];
  workspaceAccess?: FoundryWorkspaceAccess;
}

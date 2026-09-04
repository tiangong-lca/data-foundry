import childProcess, { type SpawnSyncReturns } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  assertFoundryRuntimeContext,
  FoundryContextError,
  type FoundryRuntimeContext,
} from "./foundry-runtime-context.ts";
import {
  assertQualifiedFoundryRuntime,
  type QualifiedFoundryRuntime,
} from "./foundry-runtime-qualification.ts";
import { resolveInstalledTiangongLcaCliPackage } from "./foundry-runtime-utils.ts";
import {
  parseFreshIntentBoundAuthReceipt,
  type AuthIdentityReceipt,
} from "./identity-preflight-proof.ts";
import { requirePrivateOAuthSessionFile } from "./oauth-session-reference.ts";

export interface FoundryPublicOAuthConfiguration {
  apiBaseUrl?: string;
  publishableKey?: string;
  oauthClientId?: string;
  oauthRedirectUri?: string;
}
export type FoundryAuthentication =
  | { mode: "oauth"; configuration?: FoundryPublicOAuthConfiguration }
  | { mode: "headless"; accessToken: string; apiBaseUrl: string; publishableKey: string };

export interface VerifiedFoundryIdentity {
  readonly receipt: AuthIdentityReceipt;
  readonly workspaceId: string;
  readonly taskId: string;
  readonly actorId: string;
  readonly runtimeManifestSha256: string;
  readonly runtimeEntrySha256: string;
  readonly runtimeQualificationSha256: string | null;
  readonly mode: "oauth" | "headless";
}
const verifiedIdentities = new WeakSet<object>();
const maxAgeMs = 60_000;
const systemKeys = [
  "PATH",
  "Path",
  "PATHEXT",
  "SystemRoot",
  "SYSTEMROOT",
  "WINDIR",
  "ComSpec",
  "COMSPEC",
  "HOME",
  "USERPROFILE",
  "APPDATA",
  "LOCALAPPDATA",
  "XDG_CONFIG_HOME",
  "TEMP",
  "TMP",
  "TMPDIR",
] as const;

function reject(code: string, message: string): never {
  throw new FoundryContextError(code, message);
}
function freezeReceipt(value: unknown): void {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return;
  for (const child of Object.values(value)) freezeReceipt(child);
  Object.freeze(value);
}

/** The owner CLI performs all token/session and server identity work. No auth material is persisted here. */
export function verifyFoundryRuntimeIdentity(
  context: FoundryRuntimeContext,
  authentication: FoundryAuthentication = { mode: "oauth" },
  systemEnvironment: NodeJS.ProcessEnv = process.env,
  qualification?: QualifiedFoundryRuntime,
): VerifiedFoundryIdentity {
  assertFoundryRuntimeContext(context);
  if (qualification) assertQualifiedFoundryRuntime(context, qualification);
  if (!["oauth", "headless"].includes(authentication.mode))
    reject("authentication_mode_invalid", "Select the CLI OAuth or explicit headless mode.");
  const account = context.accountIntent;
  if (!context.workspaceId || !context.taskId || !context.actorId || !account)
    reject(
      "account_intent_required",
      "Fresh task identity requires explicit workspace, task, actor, project and user intent.",
    );
  const cli = resolveInstalledTiangongLcaCliPackage();
  const environment: NodeJS.ProcessEnv = {};
  for (const key of systemKeys)
    if (systemEnvironment[key] !== undefined) environment[key] = systemEnvironment[key];
  if (authentication.mode === "oauth") {
    const config = authentication.configuration ?? {};
    environment.TIANGONG_LCA_API_BASE_URL = config.apiBaseUrl ?? "";
    environment.TIANGONG_LCA_SUPABASE_PUBLISHABLE_KEY = config.publishableKey ?? "";
    environment.TIANGONG_LCA_OAUTH_CLIENT_ID = config.oauthClientId ?? "";
    environment.TIANGONG_LCA_OAUTH_REDIRECT_URI = config.oauthRedirectUri ?? "";
    environment.TIANGONG_LCA_AUTH_MODE = "oauth";
    environment.TIANGONG_LCA_FORCE_REAUTH = "false";
    environment.TIANGONG_LCA_DISABLE_SESSION_CACHE = "false";
    if (account.sessionReference) {
      requirePrivateOAuthSessionFile(account.sessionReference);
      environment.TIANGONG_LCA_SESSION_FILE = account.sessionReference;
    }
  } else {
    if (!authentication.accessToken || !authentication.apiBaseUrl || !authentication.publishableKey)
      reject(
        "headless_target_required",
        "Headless mode requires the existing CLI explicit target and process-only actor token.",
      );
    environment.TIANGONG_LCA_AUTH_MODE = "access_token";
    environment.TIANGONG_LCA_ACCESS_TOKEN = authentication.accessToken;
    environment.TIANGONG_LCA_API_BASE_URL = authentication.apiBaseUrl;
    environment.TIANGONG_LCA_SUPABASE_PUBLISHABLE_KEY = authentication.publishableKey;
    environment.TIANGONG_LCA_DISABLE_SESSION_CACHE = "true";
  }
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "foundry-identity-"));
  fs.chmodSync(cwd, 0o700);
  try {
    let result: SpawnSyncReturns<string>;
    try {
      result = childProcess.spawnSync(
        process.execPath,
        [
          cli.binPath,
          "auth",
          "identity-receipt",
          "--expected-project-ref",
          account.projectRef,
          "--expected-user-id",
          account.userId,
          "--timeout-ms",
          "10000",
          "--json",
        ],
        {
          cwd,
          env: environment,
          shell: false,
          windowsHide: true,
          encoding: "utf8",
          timeout: 20_000,
          maxBuffer: 256 * 1024,
        },
      );
    } catch {
      reject("needs_auth", "The owner CLI identity command could not be started.");
    }
    if (result.error || result.signal || result.status !== 0 || result.stderr !== "")
      reject("needs_auth", "The owner CLI could not verify the intended task account.");
    let receipt: AuthIdentityReceipt;
    try {
      receipt = parseFreshIntentBoundAuthReceipt(JSON.parse(result.stdout), {
        nowMs: Date.now(),
        maxAgeMs,
        expectedProjectRef: account.projectRef,
        expectedUserId: account.userId,
        sessionMode: authentication.mode,
      });
    } catch {
      reject(
        "identity_receipt_invalid",
        "The owner CLI did not return a current intent-bound identity receipt.",
      );
    }
    if (
      receipt.cli.package_name !== cli.packageName ||
      receipt.cli.package_version !== cli.packageVersion
    )
      reject(
        "identity_runtime_mismatch",
        "Identity receipt does not match the qualified installed CLI.",
      );
    freezeReceipt(receipt);
    const identity: VerifiedFoundryIdentity = Object.freeze({
      receipt,
      workspaceId: context.workspaceId,
      taskId: context.taskId,
      actorId: context.actorId,
      runtimeManifestSha256: context.runtime.packageManifestSha256,
      runtimeEntrySha256: context.runtime.entrySha256,
      runtimeQualificationSha256: qualification?.qualification_sha256 ?? null,
      mode: authentication.mode,
    });
    verifiedIdentities.add(identity);
    return identity;
  } finally {
    delete environment.TIANGONG_LCA_ACCESS_TOKEN;
    fs.rmSync(cwd, { recursive: true, force: true });
  }
}

export function assertVerifiedFoundryIdentity(
  context: FoundryRuntimeContext,
  identity: VerifiedFoundryIdentity,
  qualification?: QualifiedFoundryRuntime,
): void {
  assertFoundryRuntimeContext(context);
  if (qualification) assertQualifiedFoundryRuntime(context, qualification);
  if (
    !identity ||
    !verifiedIdentities.has(identity) ||
    identity.workspaceId !== context.workspaceId ||
    identity.taskId !== context.taskId ||
    identity.actorId !== context.actorId ||
    identity.runtimeManifestSha256 !== context.runtime.packageManifestSha256 ||
    identity.runtimeEntrySha256 !== context.runtime.entrySha256 ||
    (qualification !== undefined &&
      identity.runtimeQualificationSha256 !== qualification.qualification_sha256) ||
    !context.accountIntent
  )
    reject("identity_context_mismatch", "Identity proof is not bound to the current task context.");
  try {
    parseFreshIntentBoundAuthReceipt(identity.receipt, {
      nowMs: Date.now(),
      maxAgeMs,
      expectedProjectRef: context.accountIntent.projectRef,
      expectedUserId: context.accountIntent.userId,
      sessionMode: identity.mode,
    });
  } catch {
    reject(
      "identity_receipt_stale",
      "Current task identity must be verified again before permission admission.",
    );
  }
}

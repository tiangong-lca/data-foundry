#!/usr/bin/env node
import { spawnSync, type SpawnSyncOptions } from "node:child_process";
import fs from "node:fs";
import { constants as osConstants } from "node:os";
import path from "node:path";
import process from "node:process";
import { parseEnv } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  parseFreshIntentBoundAuthReceipt,
  type AuthIdentityReceipt,
} from "./lib/identity-preflight-proof.ts";
import { resolveInstalledTiangongLcaCliPackage } from "./lib/foundry-runtime-utils.ts";
import { accountModeForVerifiedIdentity } from "./lib/production-case-policy.ts";

const DEFAULT_RECEIPT_TIMEOUT_MS = 10_000;
const RECEIPT_PROCESS_TIMEOUT_MS = 20_000;
const RECEIPT_MAX_AGE_MS = 60_000;
const MAX_RECEIPT_OUTPUT_BYTES = 256 * 1024;
const EXPECTED_CLI_PACKAGE = "@tiangong-lca/cli";
const EXPECTED_CLI_VERSION = "0.1.2";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const PROJECT_REF_PATTERN = /^[a-z0-9]+$/u;
const SAFE_FILE_STEM_PATTERN = /^[A-Za-z0-9._-]+$/u;
const SYSTEM_ENV_ALLOWLIST = [
  "PATH",
  "Path",
  "PATHEXT",
  "SYSTEMROOT",
  "SystemRoot",
  "WINDIR",
  "ComSpec",
  "TEMP",
  "TMP",
  "TMPDIR",
] as const;

type JsonRecord = Record<string, unknown>;

type InstalledCli = {
  packageName: string;
  packageVersion: string;
  binPath: string;
};

type AccountProfile = {
  apiBaseUrl: string;
  apiKey: string;
  publishableKey: string;
  region: string | null;
  label: string | null;
  expectedProjectRef: string;
  expectedUserId: string;
};

type SpawnResult = {
  status: number | null;
  signal: NodeJS.Signals | null;
  stdout?: unknown;
  stderr?: unknown;
  error?: Error;
};

type SpawnSyncLike = (
  executable: string,
  argv: readonly string[],
  options: SpawnSyncOptions,
) => SpawnResult;

export type WithLcaAccountDependencies = {
  repoRoot?: string;
  cwd?: string;
  processEnv?: NodeJS.ProcessEnv;
  nowMs?: () => number;
  spawnSyncImpl?: SpawnSyncLike;
  resolveInstalledCli?: () => InstalledCli;
};

type ParsedArguments =
  { kind: "help" } | { kind: "run"; profile: string; executable: string; argv: string[] };

class AccountWrapperError extends Error {
  readonly exitCode: number;

  constructor(message: string, exitCode = 1) {
    super(message);
    this.name = "AccountWrapperError";
    this.exitCode = exitCode;
  }
}

function usage(): string {
  return `Usage:
  node scripts/with-lca-account.ts <profile> -- <executable> [args...]

Account profile requirements:
  TIANGONG_LCA_API_BASE_URL
  TIANGONG_LCA_API_KEY
  TIANGONG_LCA_SUPABASE_PUBLISHABLE_KEY
  FOUNDRY_EXPECTED_PROJECT_REF
  FOUNDRY_EXPECTED_USER_ID

The wrapper always obtains a fresh, intent-bound CLI 0.1.2 identity receipt before it
executes the requested executable and argv without a shell. Authentication bypass flags
are not supported. The requested executable receives the account credential and inherits
terminal stdio, so invoke only trusted project CLI or Foundry entrypoints.
`;
}

function token(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized || null;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseArguments(argv: readonly string[]): ParsedArguments {
  const normalizedArgv = argv[0] === "--" ? argv.slice(1) : argv;
  if (
    normalizedArgv.length === 0 ||
    (normalizedArgv.length === 1 && ["-h", "--help"].includes(normalizedArgv[0] ?? ""))
  ) {
    return { kind: "help" };
  }
  const separatorIndex = normalizedArgv.indexOf("--");
  if (separatorIndex > 1) {
    throw new AccountWrapperError(
      "The account wrapper does not accept wrapper flags; authentication bypasses were removed.",
      2,
    );
  }
  if (separatorIndex !== 1 || normalizedArgv.length <= separatorIndex + 1) {
    throw new AccountWrapperError(
      "Expected <profile> -- <executable> [args...] with no wrapper flags.",
      2,
    );
  }
  const profile = normalizedArgv[0] ?? "";
  if (!SAFE_FILE_STEM_PATTERN.test(profile)) {
    throw new AccountWrapperError("Account profile name is invalid.", 2);
  }
  const [executable = "", ...commandArgv] = normalizedArgv.slice(separatorIndex + 1);
  if (
    !executable ||
    executable.includes("\0") ||
    commandArgv.some((value) => value.includes("\0"))
  ) {
    throw new AccountWrapperError("Requested executable or argv is invalid.", 2);
  }
  return { kind: "run", profile, executable, argv: commandArgv };
}

function assertRegularFile(filePath: string, label: string): void {
  let stats: fs.Stats;
  try {
    stats = fs.lstatSync(filePath);
  } catch {
    throw new AccountWrapperError(`${label} is missing.`, 2);
  }
  if (!stats.isFile() || stats.isSymbolicLink()) {
    throw new AccountWrapperError(`${label} must be a regular, non-symlink file.`, 2);
  }
}

function readProfile(profilePath: string): AccountProfile {
  assertRegularFile(profilePath, "Account profile");
  let values: NodeJS.ProcessEnv;
  try {
    values = parseEnv(fs.readFileSync(profilePath, "utf8"));
  } catch {
    throw new AccountWrapperError("Account profile could not be parsed.", 2);
  }
  const required = (key: string): string => {
    const value = token(values[key]);
    if (!value) throw new AccountWrapperError(`Account profile requires ${key}.`, 2);
    return value;
  };
  const expectedProjectRef = required("FOUNDRY_EXPECTED_PROJECT_REF");
  const expectedUserId = required("FOUNDRY_EXPECTED_USER_ID");
  if (!PROJECT_REF_PATTERN.test(expectedProjectRef)) {
    throw new AccountWrapperError(
      "FOUNDRY_EXPECTED_PROJECT_REF must be a canonical lowercase project ref.",
      2,
    );
  }
  if (!UUID_PATTERN.test(expectedUserId)) {
    throw new AccountWrapperError(
      "FOUNDRY_EXPECTED_USER_ID must be a canonical lowercase UUID.",
      2,
    );
  }
  return {
    apiBaseUrl: required("TIANGONG_LCA_API_BASE_URL"),
    apiKey: required("TIANGONG_LCA_API_KEY"),
    publishableKey: required("TIANGONG_LCA_SUPABASE_PUBLISHABLE_KEY"),
    region: token(values.TIANGONG_LCA_REGION),
    label: token(values.FOUNDRY_ACCOUNT_LABEL),
    expectedProjectRef,
    expectedUserId,
  };
}

function readThreadAccountGuard(input: {
  repoRoot: string;
  processEnv: NodeJS.ProcessEnv;
  profileName: string;
  profile: AccountProfile;
}): string | null {
  const threadId = token(input.processEnv.CODEX_THREAD_ID);
  if (!threadId) return null;
  if (!SAFE_FILE_STEM_PATTERN.test(threadId)) {
    throw new AccountWrapperError("CODEX_THREAD_ID is invalid.", 2);
  }
  const guardPath = path.join(
    input.repoRoot,
    ".foundry",
    "state",
    "thread-account-guards",
    `${threadId}.json`,
  );
  if (!fs.existsSync(guardPath)) {
    throw new AccountWrapperError("Thread account guard is required for the active Codex thread.");
  }
  assertRegularFile(guardPath, "Thread account guard");
  let guard: JsonRecord;
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(guardPath, "utf8"));
    if (!isRecord(parsed)) throw new Error("not an object");
    guard = parsed;
  } catch {
    throw new AccountWrapperError("Thread account guard is invalid.");
  }
  if (guard.schema_version !== 2) {
    throw new AccountWrapperError("Thread account guard schema_version must be 2.");
  }
  if (token(guard.codex_thread_id) !== threadId) {
    throw new AccountWrapperError("Thread account guard does not match the active thread.");
  }
  if (token(guard.profile) !== input.profileName) {
    throw new AccountWrapperError("Thread account guard does not match the selected profile.");
  }
  if (token(guard.expected_project_ref) !== input.profile.expectedProjectRef) {
    throw new AccountWrapperError("Thread account guard expected project does not match profile.");
  }
  if (token(guard.expected_user_id) !== input.profile.expectedUserId) {
    throw new AccountWrapperError("Thread account guard expected user does not match profile.");
  }
  return guardPath;
}

function buildRestrictedEnvironment(input: {
  processEnv: NodeJS.ProcessEnv;
  profileName: string;
  profile: AccountProfile;
  threadGuardPath: string | null;
  receipt?: AuthIdentityReceipt;
}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of SYSTEM_ENV_ALLOWLIST) {
    if (typeof input.processEnv[key] === "string") env[key] = input.processEnv[key];
  }
  env.TIANGONG_LCA_API_BASE_URL = input.profile.apiBaseUrl;
  env.TIANGONG_LCA_API_KEY = input.profile.apiKey;
  env.TIANGONG_LCA_SUPABASE_PUBLISHABLE_KEY = input.profile.publishableKey;
  if (input.profile.region) env.TIANGONG_LCA_REGION = input.profile.region;
  env.TIANGONG_LCA_DISABLE_SESSION_CACHE = "true";
  env.TIANGONG_LCA_FORCE_REAUTH = "true";
  env.FOUNDRY_ACCOUNT_PROFILE = input.profileName;
  env.FOUNDRY_EXPECTED_PROJECT_REF = input.profile.expectedProjectRef;
  env.FOUNDRY_EXPECTED_USER_ID = input.profile.expectedUserId;
  if (input.profile.label) env.FOUNDRY_ACCOUNT_LABEL = input.profile.label;
  if (input.threadGuardPath) env.FOUNDRY_THREAD_ACCOUNT_GUARD = input.threadGuardPath;
  if (input.receipt) {
    env.FOUNDRY_ACCOUNT_MODE = accountModeForVerifiedIdentity({
      projectRef: input.receipt.project.project_ref,
      userId: input.receipt.identity.user_id,
    });
    env.FOUNDRY_VERIFIED_PROJECT_REF = input.receipt.project.project_ref;
    env.FOUNDRY_VERIFIED_USER_ID = input.receipt.identity.user_id;
    env.FOUNDRY_AUTH_RECEIPT_PROJECT_REF = input.receipt.project.project_ref;
    env.FOUNDRY_AUTH_RECEIPT_USER_ID = input.receipt.identity.user_id;
    env.FOUNDRY_AUTH_RECEIPT_SCOPE_SHA256 = input.receipt.receipt_scope_sha256;
    env.FOUNDRY_AUTH_RECEIPT_CAPTURED_AT_UTC = input.receipt.captured_at_utc;
  }
  return env;
}

function parseSingleReceipt(stdout: unknown): unknown {
  if (typeof stdout !== "string" || Buffer.byteLength(stdout, "utf8") > MAX_RECEIPT_OUTPUT_BYTES) {
    throw new AccountWrapperError(
      "CLI did not return a valid fresh intent-bound identity receipt.",
    );
  }
  const lines = stdout.split(/\r?\n/u);
  if (lines.at(-1) === "") lines.pop();
  if (lines.length !== 1 || !lines[0]) {
    throw new AccountWrapperError(
      "CLI did not return a valid fresh intent-bound identity receipt.",
    );
  }
  try {
    return JSON.parse(lines[0]);
  } catch {
    throw new AccountWrapperError(
      "CLI did not return a valid fresh intent-bound identity receipt.",
    );
  }
}

function defaultResolveInstalledCli(): InstalledCli {
  const installed = resolveInstalledTiangongLcaCliPackage();
  return {
    packageName: installed.packageName,
    packageVersion: installed.packageVersion,
    binPath: installed.binPath,
  };
}

function exitCodeForSignal(signal: NodeJS.Signals): number {
  const signalNumber = osConstants.signals[signal];
  return Number.isInteger(signalNumber) && signalNumber > 0 ? 128 + signalNumber : 1;
}

const defaultSpawnSync: SpawnSyncLike = (executable, argv, options) =>
  spawnSync(executable, [...argv], options);

export function runWithLcaAccount(
  argv: readonly string[],
  dependencies: WithLcaAccountDependencies = {},
): number {
  const parsed = parseArguments(argv);
  if (parsed.kind === "help") {
    process.stdout.write(usage());
    return 0;
  }
  const repoRoot = path.resolve(
    dependencies.repoRoot ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."),
  );
  const cwd = path.resolve(dependencies.cwd ?? process.cwd());
  const processEnv = dependencies.processEnv ?? process.env;
  const profileDir = path.resolve(
    token(processEnv.FOUNDRY_ACCOUNT_PROFILES_DIR) ??
      path.join(repoRoot, ".foundry", "account-profiles"),
  );
  const profilePath = path.join(profileDir, `${parsed.profile}.env`);
  const profile = readProfile(profilePath);
  const threadGuardPath = readThreadAccountGuard({
    repoRoot,
    processEnv,
    profileName: parsed.profile,
    profile,
  });
  const installedCli = (dependencies.resolveInstalledCli ?? defaultResolveInstalledCli)();
  if (
    installedCli.packageName !== EXPECTED_CLI_PACKAGE ||
    installedCli.packageVersion !== EXPECTED_CLI_VERSION ||
    !token(installedCli.binPath)
  ) {
    throw new AccountWrapperError(
      `Account identity requires installed ${EXPECTED_CLI_PACKAGE}@${EXPECTED_CLI_VERSION}.`,
      2,
    );
  }
  const spawn = dependencies.spawnSyncImpl ?? defaultSpawnSync;
  const identityEnvironment = buildRestrictedEnvironment({
    processEnv,
    profileName: parsed.profile,
    profile,
    threadGuardPath,
  });
  let identityResult: SpawnResult;
  try {
    identityResult = spawn(
      process.execPath,
      [
        installedCli.binPath,
        "auth",
        "identity-receipt",
        "--expected-project-ref",
        profile.expectedProjectRef,
        "--expected-user-id",
        profile.expectedUserId,
        "--timeout-ms",
        String(DEFAULT_RECEIPT_TIMEOUT_MS),
        "--json",
      ],
      {
        cwd,
        env: identityEnvironment,
        shell: false,
        encoding: "utf8",
        timeout: RECEIPT_PROCESS_TIMEOUT_MS,
        maxBuffer: MAX_RECEIPT_OUTPUT_BYTES,
        windowsHide: true,
      },
    );
  } catch {
    throw new AccountWrapperError("CLI identity-receipt command could not be started.");
  }
  if (
    identityResult.error ||
    identityResult.status !== 0 ||
    identityResult.signal !== null ||
    identityResult.stderr !== ""
  ) {
    throw new AccountWrapperError("CLI identity-receipt command failed.");
  }
  let receipt: AuthIdentityReceipt;
  try {
    receipt = parseFreshIntentBoundAuthReceipt(parseSingleReceipt(identityResult.stdout), {
      nowMs: (dependencies.nowMs ?? Date.now)(),
      maxAgeMs: RECEIPT_MAX_AGE_MS,
      expectedProjectRef: profile.expectedProjectRef,
      expectedUserId: profile.expectedUserId,
      requireFreshSignin: true,
    });
  } catch {
    throw new AccountWrapperError(
      "CLI did not return a valid fresh intent-bound identity receipt.",
    );
  }
  if (
    receipt.cli.package_name !== installedCli.packageName ||
    receipt.cli.package_version !== installedCli.packageVersion
  ) {
    throw new AccountWrapperError("Identity receipt CLI package does not match the installed CLI.");
  }
  const commandEnvironment = buildRestrictedEnvironment({
    processEnv,
    profileName: parsed.profile,
    profile,
    threadGuardPath,
    receipt,
  });
  let commandResult: SpawnResult;
  try {
    commandResult = spawn(parsed.executable, parsed.argv, {
      cwd,
      env: commandEnvironment,
      shell: false,
      stdio: "inherit",
      windowsHide: true,
    });
  } catch {
    throw new AccountWrapperError("Requested account command could not be started.");
  }
  if (commandResult.error) {
    throw new AccountWrapperError("Requested account command could not be started.");
  }
  if (commandResult.signal !== null) return exitCodeForSignal(commandResult.signal);
  return typeof commandResult.status === "number" ? commandResult.status : 1;
}

export function main(argv: string[] = process.argv.slice(2)): number {
  try {
    return runWithLcaAccount(argv);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Account wrapper failed.";
    process.stderr.write(`[with-lca-account] ${message}\n`);
    return error instanceof AccountWrapperError ? error.exitCode : 1;
  }
}

export function isDirectEntry(importMetaUrl: string, argv1: string | undefined): boolean {
  if (!argv1) return false;
  const canonicalFileUrl = (filePath: string): string => {
    const resolved = path.resolve(filePath);
    try {
      return pathToFileURL(fs.realpathSync(resolved)).href;
    } catch {
      return pathToFileURL(resolved).href;
    }
  };
  try {
    return canonicalFileUrl(fileURLToPath(importMetaUrl)) === canonicalFileUrl(argv1);
  } catch {
    return importMetaUrl === pathToFileURL(path.resolve(argv1)).href;
  }
}

if (isDirectEntry(import.meta.url, process.argv[1])) {
  process.exitCode = main();
}

#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { createHash, randomUUID as nodeRandomUUID } from "node:crypto";
import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdtempSync,
  mkdirSync,
  openSync,
  readFileSync,
  readlinkSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import process from "node:process";
import { constants as osConstants } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs, parseEnv } from "node:util";
import {
  parseFreshIntentBoundAuthReceipt,
  sha256Json,
  stableJson,
} from "../lib/identity-preflight-proof.ts";

import { requirePrivateOAuthSessionFile } from "../lib/oauth-session-reference.ts";

const CASE_SCHEMA = "tiangong-foundry.production-contact-draft-case.v1" as const;
const FAILURE_SCHEMA = "tiangong-foundry.production-contact-draft-case-failure.v1" as const;
const CLI_PACKAGE_NAME = "@tiangong-lca/cli" as const;
const CLI_PACKAGE_VERSION = "0.1.11" as const;
const MAX_CHILD_OUTPUT_BYTES = 8 * 1024 * 1024;
const CHILD_TIMEOUT_MS = 120_000;
const RECEIPT_MAX_AGE_MS = 5 * 60_000;
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const PROJECT_REF_PATTERN = /^[a-z0-9-]+$/u;
const REQUIRED_ENV_KEYS = [
  "TIANGONG_LCA_API_BASE_URL",
  "TIANGONG_LCA_SUPABASE_PUBLISHABLE_KEY",
  "TIANGONG_LCA_SESSION_FILE",
  "TIANGONG_LCA_OAUTH_CLIENT_ID",
] as const;
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
type CaseEnv = Record<(typeof REQUIRED_ENV_KEYS)[number], string>;

export type ProductionContactDraftCaseOptions = {
  envFile: string;
  expectedProjectRef: string;
  expectedUserId: string;
  outDir: string;
};

export type ProductionContactDraftRuntimeEvidence = {
  entrypoint: string;
  cliPackageName: string;
  cliPackageVersion: string;
  cliEntrypointSha256: string;
  cliRuntimeSha256: string;
  runnerSha256: string;
  pnpmLockSha256: string;
  pnpmInstallationSha256: string;
  foundrySourceSha256?: string;
  verifyCurrent: () => void;
  cleanup: () => void;
};

export type ProductionContactDraftSpawn = {
  command: string;
  args: string[];
  options: {
    cwd: string;
    env: NodeJS.ProcessEnv;
    shell: false;
    encoding: "utf8";
    maxBuffer: number;
    timeout: number;
    windowsHide: true;
  };
};

type SpawnResult = {
  status: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  error?: Error;
};

type StageEvidence = {
  stage: string;
  argv: string[];
  argv_sha256: string;
  report_sha256: string;
  disk_report_sha256: string | null;
  status: string | null;
};

type ArtifactFact = { path: string; bytes: number; sha256: string };

type ManifestScope = {
  schema: typeof CASE_SCHEMA;
  status: "passed";
  executed_at_utc: string;
  project_ref: string;
  user_id: string;
  contact_id: string;
  contact_version: "00.00.001";
  contact_artifact: ArtifactFact & { payload_sha256: string };
  cli: {
    package_name: string;
    package_version: string;
    entrypoint_sha256: string;
    runtime_sha256: string;
    pnpm_installation_sha256: string;
  };
  foundry: {
    runner_sha256: string;
    source_sha256: string | null;
    pnpm_lock_sha256: string;
  };
  receipts: Array<{
    role: "before_reads" | "before_write";
    file: string;
    file_sha256: string;
    receipt_scope_sha256: string;
    captured_at_utc: string;
  }>;
  stages: StageEvidence[];
  mutation_dispatch_count: 1;
  mutation_disposition: "retained_owner_draft";
  unique_root_readback_checks: 1;
  artifacts: ArtifactFact[];
};

export type ProductionContactDraftCaseManifest = ManifestScope & {
  manifest_scope_sha256: string;
};

export type RunProductionContactDraftCaseDeps = {
  processEnv?: NodeJS.ProcessEnv;
  now?: () => Date;
  randomUUID?: () => string;
  platform?: NodeJS.Platform;
  prepareRuntimeSnapshot?: () => ProductionContactDraftRuntimeEvidence;
  spawnImpl?: (
    command: string,
    args: string[],
    options: ProductionContactDraftSpawn["options"],
  ) => SpawnResult;
};

class ProductionContactDraftCaseError extends Error {
  readonly code: string;
  readonly exitCode: number;

  constructor(message: string, code: string, exitCode = 1) {
    super(message);
    this.name = "ProductionContactDraftCaseError";
    this.code = code;
    this.exitCode = exitCode;
  }
}

function fail(message: string, code: string, exitCode = 1): never {
  throw new ProductionContactDraftCaseError(message, code, exitCode);
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function token(value: unknown): string | null {
  const text = typeof value === "string" ? value.trim() : "";
  return text || null;
}

function required(value: unknown, label: string): string {
  return (
    token(value) ??
    fail(`Production contact draft case requires ${label}.`, "CASE_ARGS_REQUIRED", 2)
  );
}

function assertCanonicalUuid(value: string, label: string): string {
  if (!UUID_PATTERN.test(value)) {
    return fail(`${label} must be a canonical lowercase UUID.`, "CASE_ARGS_INVALID", 2);
  }
  return value;
}

function normalizeOptions(
  options: ProductionContactDraftCaseOptions,
): ProductionContactDraftCaseOptions {
  const normalized = {
    envFile: path.resolve(required(options.envFile, "--env-file")),
    expectedProjectRef: required(options.expectedProjectRef, "--expected-project-ref"),
    expectedUserId: assertCanonicalUuid(
      required(options.expectedUserId, "--expected-user-id"),
      "--expected-user-id",
    ),
    outDir: path.resolve(required(options.outDir, "--out-dir")),
  };
  if (!PROJECT_REF_PATTERN.test(normalized.expectedProjectRef)) {
    return fail(
      "--expected-project-ref must contain only lowercase project-ref characters.",
      "CASE_ARGS_INVALID",
      2,
    );
  }
  if (existsSync(normalized.outDir)) {
    return fail(
      "Production contact draft case output directory must not already exist.",
      "CASE_OUTPUT_EXISTS",
      2,
    );
  }
  return normalized;
}

export function parseProductionContactDraftCaseArgs(
  argv: string[],
): ProductionContactDraftCaseOptions {
  const args = argv[0] === "--" ? argv.slice(1) : argv;
  let parsed: ReturnType<typeof parseArgs>;
  try {
    parsed = parseArgs({
      args,
      allowPositionals: false,
      strict: true,
      tokens: true,
      options: {
        "env-file": { type: "string" },
        "expected-project-ref": { type: "string" },
        "expected-user-id": { type: "string" },
        "out-dir": { type: "string" },
      },
    });
  } catch (error) {
    return fail(
      `Invalid production contact draft case arguments: ${error instanceof Error ? error.message : "parse failure"}`,
      "CASE_ARGS_INVALID",
      2,
    );
  }
  for (const name of ["env-file", "expected-project-ref", "expected-user-id", "out-dir"] as const) {
    if (
      (parsed.tokens ?? []).filter((entry) => entry.kind === "option" && entry.name === name)
        .length !== 1
    ) {
      return fail(
        `Production contact draft case requires exactly one --${name}.`,
        "CASE_ARGS_INVALID",
        2,
      );
    }
  }
  return {
    envFile: path.resolve(required(parsed.values["env-file"], "--env-file")),
    expectedProjectRef: required(parsed.values["expected-project-ref"], "--expected-project-ref"),
    expectedUserId: assertCanonicalUuid(
      required(parsed.values["expected-user-id"], "--expected-user-id"),
      "--expected-user-id",
    ),
    outDir: path.resolve(required(parsed.values["out-dir"], "--out-dir")),
  };
}

function repositoryRoot(): string {
  let current = path.dirname(fileURLToPath(import.meta.url));
  for (let depth = 0; depth < 6; depth += 1) {
    if (
      existsSync(path.join(current, "package.json")) &&
      existsSync(path.join(current, "pnpm-lock.yaml"))
    ) {
      const manifest = JSON.parse(readFileSync(path.join(current, "package.json"), "utf8")) as {
        name?: unknown;
      };
      if (manifest.name === "@tiangong-lca/foundry") return realpathSync(current);
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return fail("Could not resolve the trusted Foundry repository root.", "CASE_RUNTIME_INVALID", 2);
}

function assertGitIgnoredCaseOutDir(root: string, outDir: string): void {
  const relative = path.relative(root, outDir);
  if (!relative || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    return fail(
      "Production case output must be a git-ignored per-run directory inside the repository.",
      "CASE_OUTPUT_NOT_IGNORED",
      2,
    );
  }
  const result = spawnSync("git", ["check-ignore", "--quiet", "--no-index", "--", outDir], {
    cwd: root,
    env: systemEnv(process.env),
    encoding: "utf8",
    shell: false,
    windowsHide: true,
  });
  if (result.status !== 0 || result.signal !== null || result.error) {
    return fail(
      "Production case output must be a git-ignored per-run directory inside the repository.",
      "CASE_OUTPUT_NOT_IGNORED",
      2,
    );
  }
}

function assertPrivateParentInsideRepository(root: string, outDir: string): void {
  const parent = path.dirname(outDir);
  const relativeParent = path.relative(root, parent);
  let current = root;
  for (const part of relativeParent.split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    if (!existsSync(current)) break;
    if (lstatSync(current).isSymbolicLink()) {
      return fail(
        "Production case output parent must not traverse a symbolic link.",
        "CASE_OUTPUT_PARENT_SYMLINK",
        2,
      );
    }
  }
}

type BufferedFile = { relativePath: string; bytes: Buffer };

function comparePortablePaths(left: BufferedFile, right: BufferedFile): number {
  return Buffer.compare(
    Buffer.from(left.relativePath, "utf8"),
    Buffer.from(right.relativePath, "utf8"),
  );
}

function readRegularFile(filePath: string): Buffer {
  let stats;
  try {
    stats = lstatSync(filePath);
  } catch {
    return fail("Production case runtime evidence is incomplete.", "CASE_RUNTIME_INVALID", 2);
  }
  if (!stats.isFile() || stats.isSymbolicLink()) {
    return fail(
      "Production case runtime evidence must contain regular files only.",
      "CASE_RUNTIME_INVALID",
      2,
    );
  }
  return readFileSync(filePath);
}

function collectFiles(root: string): BufferedFile[] {
  const files: BufferedFile[] = [];
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        return fail("CLI runtime snapshot cannot contain symlinks.", "CASE_RUNTIME_INVALID", 2);
      }
      if (entry.isDirectory()) visit(entryPath);
      else if (entry.isFile()) {
        files.push({
          relativePath: path.relative(root, entryPath).replaceAll("\\", "/"),
          bytes: readRegularFile(entryPath),
        });
      }
    }
  };
  visit(root);
  return files.sort(comparePortablePaths);
}

function collectPnpmInstallationFiles(root: string): BufferedFile[] {
  const files: BufferedFile[] = [];
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.name.startsWith(".foundry-contact-case-runtime-")) continue;
      const entryPath = path.join(directory, entry.name);
      const relativePath = path.relative(root, entryPath).replaceAll("\\", "/");
      if (entry.isSymbolicLink()) {
        files.push({
          relativePath,
          bytes: Buffer.from(`SYMLINK\0${readlinkSync(entryPath)}`, "utf8"),
        });
      } else if (entry.isDirectory()) visit(entryPath);
      else if (entry.isFile()) files.push({ relativePath, bytes: readRegularFile(entryPath) });
      else
        return fail(
          "pnpm installation contains an unsupported filesystem entry.",
          "CASE_RUNTIME_INVALID",
          2,
        );
    }
  };
  visit(root);
  return files.sort(comparePortablePaths);
}

function hashBufferedFiles(files: BufferedFile[]): string {
  const hash = createHash("sha256");
  for (const file of files) {
    hash.update(file.relativePath).update("\0").update(file.bytes).update("\0");
  }
  return hash.digest("hex");
}

function sourceEvidence(root: string): string {
  const paths = [
    "package.json",
    "pnpm-lock.yaml",
    "tsconfig.json",
    "tsconfig.build.json",
    "scripts/cases/production-contact-draft.ts",
    "scripts/lib/identity-preflight-proof.ts",
  ];
  return hashBufferedFiles(
    paths.map((relativePath) => ({
      relativePath,
      bytes: readRegularFile(path.join(root, relativePath)),
    })),
  );
}

function prepareRuntimeSnapshot(): ProductionContactDraftRuntimeEvidence {
  const root = repositoryRoot();
  const logicalPackageRoot = path.join(root, "node_modules", "@tiangong-lca", "cli");
  const packageRoot = realpathSync(logicalPackageRoot);
  const packageJsonBytes = readRegularFile(path.join(packageRoot, "package.json"));
  const packageJson = JSON.parse(packageJsonBytes.toString("utf8")) as {
    name?: unknown;
    version?: unknown;
    bin?: unknown;
  };
  if (packageJson.name !== CLI_PACKAGE_NAME || packageJson.version !== CLI_PACKAGE_VERSION) {
    return fail(
      `Expected installed ${CLI_PACKAGE_NAME}@${CLI_PACKAGE_VERSION}.`,
      "CASE_RUNTIME_INVALID",
      2,
    );
  }
  const binEntry =
    typeof packageJson.bin === "string"
      ? packageJson.bin
      : isRecord(packageJson.bin)
        ? token(packageJson.bin["tiangong-lca"])
        : null;
  if (!binEntry) return fail("Installed CLI bin is missing.", "CASE_RUNTIME_INVALID", 2);
  const packageFiles = collectFiles(packageRoot);
  const binRelativePath = path
    .relative(packageRoot, path.resolve(packageRoot, binEntry))
    .replaceAll("\\", "/");
  const binFile = packageFiles.find((file) => file.relativePath === binRelativePath);
  if (!binFile) return fail("Installed CLI entrypoint is missing.", "CASE_RUNTIME_INVALID", 2);
  const pnpmInstallationRoot = path.join(root, "node_modules", ".pnpm");
  const pnpmInstallationSha256 = hashBufferedFiles(
    collectPnpmInstallationFiles(pnpmInstallationRoot),
  );
  const cliRuntimeSha256 = hashBufferedFiles(packageFiles);
  const runnerPath = fileURLToPath(import.meta.url);
  const runnerSha256 = createHash("sha256").update(readRegularFile(runnerPath)).digest("hex");
  const lockPath = path.join(root, "pnpm-lock.yaml");
  const pnpmLockSha256 = createHash("sha256").update(readRegularFile(lockPath)).digest("hex");
  const foundrySourceSha256 = sourceEvidence(root);

  // Keep the private copy inside the installed package's pnpm dependency island.
  // ESM does not honor NODE_PATH, so moving the package under a generic cache
  // directory would detach it from pnpm's non-hoisted dependency links.
  const snapshotParent = path.dirname(packageRoot);
  const snapshotRoot = mkdtempSync(path.join(snapshotParent, ".foundry-contact-case-runtime-"));
  try {
    if (process.platform !== "win32") chmodSync(snapshotRoot, 0o700);
    for (const file of packageFiles) {
      const target = path.join(snapshotRoot, "cli", file.relativePath);
      mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
      writeFileSync(target, file.bytes, { flag: "wx", mode: 0o600 });
      if (process.platform !== "win32") chmodSync(target, 0o600);
    }
    const snapshotPackageRoot = path.join(snapshotRoot, "cli");
    const verifyCurrent = (): void => {
      if (
        hashBufferedFiles(collectPnpmInstallationFiles(pnpmInstallationRoot)) !==
          pnpmInstallationSha256 ||
        hashBufferedFiles(collectFiles(snapshotPackageRoot)) !== cliRuntimeSha256 ||
        createHash("sha256").update(readRegularFile(runnerPath)).digest("hex") !== runnerSha256 ||
        createHash("sha256").update(readRegularFile(lockPath)).digest("hex") !== pnpmLockSha256 ||
        sourceEvidence(root) !== foundrySourceSha256
      ) {
        return fail(
          "The pinned runtime, source, lock, or pnpm dependency bytes changed during the production case.",
          "CASE_RUNTIME_DRIFT",
        );
      }
    };
    return {
      entrypoint: path.join(snapshotRoot, "cli", binRelativePath),
      cliPackageName: CLI_PACKAGE_NAME,
      cliPackageVersion: CLI_PACKAGE_VERSION,
      cliEntrypointSha256: createHash("sha256").update(binFile.bytes).digest("hex"),
      cliRuntimeSha256,
      runnerSha256,
      pnpmLockSha256,
      pnpmInstallationSha256,
      foundrySourceSha256,
      verifyCurrent,
      cleanup: () =>
        rmSync(snapshotRoot, {
          recursive: true,
          force: true,
          maxRetries: 3,
          retryDelay: 50,
        }),
    };
  } catch (error) {
    rmSync(snapshotRoot, { recursive: true, force: true });
    throw error;
  }
}

function validateRuntimeEvidence(
  evidence: ProductionContactDraftRuntimeEvidence,
): ProductionContactDraftRuntimeEvidence {
  if (
    !path.isAbsolute(evidence.entrypoint) ||
    evidence.cliPackageName !== CLI_PACKAGE_NAME ||
    evidence.cliPackageVersion !== CLI_PACKAGE_VERSION ||
    !SHA256_PATTERN.test(evidence.cliEntrypointSha256) ||
    !SHA256_PATTERN.test(evidence.cliRuntimeSha256) ||
    !SHA256_PATTERN.test(evidence.runnerSha256) ||
    !SHA256_PATTERN.test(evidence.pnpmLockSha256) ||
    !SHA256_PATTERN.test(evidence.pnpmInstallationSha256) ||
    (evidence.foundrySourceSha256 !== undefined &&
      !SHA256_PATTERN.test(evidence.foundrySourceSha256)) ||
    typeof evidence.verifyCurrent !== "function" ||
    typeof evidence.cleanup !== "function"
  ) {
    return fail("Production case runtime evidence is invalid.", "CASE_RUNTIME_INVALID", 2);
  }
  return evidence;
}

function assertReceiptRuntime(
  receipt: ReturnType<typeof parseFreshIntentBoundAuthReceipt>,
  runtime: ProductionContactDraftRuntimeEvidence,
): void {
  if (
    receipt.cli.package_name !== runtime.cliPackageName ||
    receipt.cli.package_version !== runtime.cliPackageVersion
  ) {
    return fail(
      "The identity receipt CLI does not match the pinned runtime.",
      "CASE_RECEIPT_RUNTIME_MISMATCH",
    );
  }
}

function readCaseEnv(envFile: string, root: string): CaseEnv {
  let stats;
  try {
    stats = lstatSync(envFile);
  } catch {
    return fail("Production case env file is not readable.", "CASE_ENV_INVALID", 2);
  }
  if (!stats.isFile() || stats.isSymbolicLink()) {
    return fail("Production case env file must be a regular file.", "CASE_ENV_INVALID", 2);
  }
  if ((stats.mode & 0o077) !== 0) {
    return fail(
      "Production case env file must be owner-private (0600 or stricter).",
      "CASE_ENV_NOT_PRIVATE",
      2,
    );
  }
  const relative = path.relative(root, envFile);
  if (relative && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)) {
    const ignored = spawnSync("git", ["check-ignore", "--quiet", "--no-index", "--", envFile], {
      cwd: root,
      env: systemEnv(process.env),
      encoding: "utf8",
      shell: false,
      windowsHide: true,
    });
    if (ignored.status !== 0 || ignored.signal !== null || ignored.error) {
      return fail(
        "Production case env file inside the repository must be git-ignored.",
        "CASE_ENV_NOT_IGNORED",
        2,
      );
    }
  }
  let parsed: NodeJS.ProcessEnv;
  try {
    parsed = parseEnv(readFileSync(envFile, "utf8"));
  } catch {
    return fail("Production case env file could not be parsed.", "CASE_ENV_INVALID", 2);
  }
  const selected = Object.fromEntries(
    REQUIRED_ENV_KEYS.map((key) => [key, token(parsed[key])]),
  ) as Record<(typeof REQUIRED_ENV_KEYS)[number], string | null>;
  const missing = REQUIRED_ENV_KEYS.filter((key) => !selected[key]);
  if (missing.length > 0) {
    return fail(
      `Missing required production-case env: ${missing.join(", ")}.`,
      "CASE_ENV_REQUIRED",
      2,
    );
  }
  requirePrivateOAuthSessionFile(selected.TIANGONG_LCA_SESSION_FILE as string);
  return selected as CaseEnv;
}

function projectRefFromBaseUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return fail("Production case API base URL is invalid.", "CASE_PROJECT_INVALID", 2);
  }
  const suffix = ".supabase.co";
  const hostname = url.hostname.toLowerCase();
  const projectRef = hostname.endsWith(suffix) ? hostname.slice(0, -suffix.length) : "";
  const pathname = url.pathname.replace(/\/+$/u, "");
  if (
    url.protocol !== "https:" ||
    !PROJECT_REF_PATTERN.test(projectRef) ||
    projectRef.includes(".") ||
    !["", "/functions/v1", "/rest/v1"].includes(pathname) ||
    url.username ||
    url.password ||
    url.port ||
    url.search ||
    url.hash
  ) {
    return fail("Production case API base URL is invalid.", "CASE_PROJECT_INVALID", 2);
  }
  return projectRef;
}

function systemEnv(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const selected: NodeJS.ProcessEnv = {};
  for (const key of SYSTEM_ENV_ALLOWLIST) {
    if (typeof source[key] === "string") selected[key] = source[key];
  }
  return selected;
}

function remoteEnv(source: NodeJS.ProcessEnv, caseEnv: CaseEnv): NodeJS.ProcessEnv {
  return {
    ...systemEnv(source),
    TIANGONG_LCA_API_BASE_URL: caseEnv.TIANGONG_LCA_API_BASE_URL,
    TIANGONG_LCA_SUPABASE_PUBLISHABLE_KEY: caseEnv.TIANGONG_LCA_SUPABASE_PUBLISHABLE_KEY,
    TIANGONG_LCA_AUTH_MODE: "oauth",
    TIANGONG_LCA_SESSION_FILE: caseEnv.TIANGONG_LCA_SESSION_FILE,
    TIANGONG_LCA_OAUTH_CLIENT_ID: caseEnv.TIANGONG_LCA_OAUTH_CLIENT_ID,
    TIANGONG_LCA_DISABLE_SESSION_CACHE: "false",
    TIANGONG_LCA_FORCE_REAUTH: "false",
  };
}

function writePrivateFile(filePath: string, text: string, mode = 0o600): void {
  const descriptor = openSync(filePath, "wx", mode);
  try {
    writeFileSync(descriptor, text, { encoding: "utf8" });
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
  if (process.platform !== "win32") chmodSync(filePath, mode);
}

function overwritePrivateFile(filePath: string, text: string): void {
  const descriptor = openSync(filePath, "w", 0o600);
  try {
    writeFileSync(descriptor, text, { encoding: "utf8" });
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
  if (process.platform !== "win32") chmodSync(filePath, 0o600);
}

function writePrivateJson(filePath: string, value: unknown, mode = 0o600): void {
  writePrivateFile(filePath, `${JSON.stringify(value, null, 2)}\n`, mode);
}

function contactPayload(id: string, now: Date): JsonRecord {
  const name = `TianGong LCA production TDD contact ${id.slice(0, 8)}`;
  const localized = { "@xml:lang": "en", "#text": name };
  const dataSetFormatReference = {
    "@type": "source data set",
    "@refObjectId": "a97a0155-0234-4b87-b4ce-a45da52f2a40",
    "@version": "03.00.003",
    "@uri": "../sources/a97a0155-0234-4b87-b4ce-a45da52f2a40_03.00.003.xml",
    "common:shortDescription": { "@xml:lang": "en", "#text": "ILCD format" },
  };
  const ownershipReference = {
    "@type": "contact data set",
    "@refObjectId": id,
    "@version": "00.00.001",
    "@uri": `../contacts/${id}_00.00.001.xml`,
    "common:shortDescription": localized,
  };
  return {
    contactDataSet: {
      "@version": "1.1",
      "@xmlns": "http://lca.jrc.it/ILCD/Contact",
      "@xmlns:common": "http://lca.jrc.it/ILCD/Common",
      "@xmlns:xsi": "http://www.w3.org/2001/XMLSchema-instance",
      "@xsi:schemaLocation": "http://lca.jrc.it/ILCD/Contact ../../schemas/ILCD_ContactDataSet.xsd",
      contactInformation: {
        dataSetInformation: {
          "common:UUID": id,
          "common:shortName": localized,
          "common:name": localized,
          classificationInformation: {
            "common:classification": {
              "common:class": [
                { "@level": "0", "@classId": "2", "#text": "Organisations" },
                { "@level": "1", "@classId": "2.4", "#text": "Other organisations" },
              ],
            },
          },
          centralContactPoint: localized,
          contactDescriptionOrComment: {
            "@xml:lang": "en",
            "#text":
              "Isolated, unreviewed and unpublished production-account draft created by the Foundry TDD case.",
          },
        },
      },
      administrativeInformation: {
        dataEntryBy: {
          "common:timeStamp": now.toISOString(),
          "common:referenceToDataSetFormat": dataSetFormatReference,
        },
        publicationAndOwnership: {
          "common:dataSetVersion": "00.00.001",
          "common:permanentDataSetURI": `https://lcdn.tiangong.earth/datasetdetail/contact.xhtml?uuid=${id}&version=00.00.001`,
          "common:referenceToOwnershipOfDataSet": ownershipReference,
        },
      },
    },
  };
}

function contactRootProbe(id: string): JsonRecord {
  return {
    contactDataSet: {
      contactInformation: { dataSetInformation: { "common:UUID": id } },
      administrativeInformation: {
        publicationAndOwnership: { "common:dataSetVersion": "00.00.001" },
      },
    },
  };
}

function parseSingleJsonLine(stdout: string, stage: string): JsonRecord {
  if (Buffer.byteLength(stdout, "utf8") > MAX_CHILD_OUTPUT_BYTES) {
    return fail(`CLI output exceeded the limit at ${stage}.`, "CASE_CHILD_OUTPUT_TOO_LARGE");
  }
  const lines = stdout.split(/\r?\n/u);
  if (lines.at(-1) === "") lines.pop();
  if (lines.length !== 1 || !lines[0]) {
    return fail(`CLI did not emit one JSON line at ${stage}.`, "CASE_CHILD_STDOUT_INVALID");
  }
  try {
    const value = JSON.parse(lines[0]);
    if (!isRecord(value)) throw new Error("not an object");
    return value;
  } catch {
    return fail(`CLI emitted invalid JSON at ${stage}.`, "CASE_CHILD_STDOUT_INVALID");
  }
}

function safeChildCode(stderr: string): string {
  if (Buffer.byteLength(stderr, "utf8") > MAX_CHILD_OUTPUT_BYTES) {
    return "CASE_CHILD_OUTPUT_TOO_LARGE";
  }
  try {
    const value = JSON.parse(stderr);
    const code = isRecord(value) && isRecord(value.error) ? token(value.error.code) : null;
    return code && /^[A-Z0-9_]+$/u.test(code) ? code : "CASE_CHILD_FAILED";
  } catch {
    return "CASE_CHILD_FAILED";
  }
}

function signalExitCode(signal: NodeJS.Signals): number {
  const signalNumber = osConstants.signals[signal];
  return typeof signalNumber === "number" ? 128 + signalNumber : 1;
}

function containsSecretMaterial(value: string, secrets: string[]): boolean {
  return redactCredentialText(value, secrets) !== value;
}

function redactCredentialText(value: string, references: string[]): string {
  let text = value;
  for (const reference of references.filter(Boolean))
    text = text.replaceAll(reference, "[REDACTED]");
  // The CLI owns session contents. Detect structured credentials without reading that store.
  return text
    .replace(
      /("(?:access_token|refresh_token|password|authorization|cookie|set-cookie)"\s*:\s*)"(?:[^"\\]|\\.)*"/giu,
      '$1"[REDACTED]"',
    )
    .replace(/\bBearer [A-Za-z0-9._~+/-]+=*/gu, "Bearer [REDACTED]")
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/gu, "[REDACTED]");
}

function fileFact(filePath: string, relativeTo: string): ArtifactFact {
  const bytes = readRegularFile(filePath);
  return {
    path: path.relative(relativeTo, filePath).replaceAll("\\", "/"),
    bytes: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

function requireDiskReport(
  reportPath: string,
  stdoutReport: JsonRecord,
  stage: string,
): ArtifactFact {
  if (!existsSync(reportPath)) {
    return fail(`CLI disk report is missing at ${stage}.`, "CASE_DISK_REPORT_MISSING");
  }
  let diskReport: unknown;
  try {
    diskReport = JSON.parse(readFileSync(reportPath, "utf8"));
  } catch {
    return fail(`CLI disk report is invalid at ${stage}.`, "CASE_DISK_REPORT_INVALID");
  }
  if (stableJson(diskReport) !== stableJson(stdoutReport)) {
    return fail(`CLI stdout and disk report differ at ${stage}.`, "CASE_DISK_REPORT_MISMATCH");
  }
  return fileFact(reportPath, path.dirname(path.dirname(reportPath)));
}

function exactInput(report: JsonRecord, inputPath: string, stage: string): void {
  if (path.resolve(token(report.input_path) ?? "") !== inputPath) {
    return fail(`CLI report input drifted at ${stage}.`, "CASE_INPUT_MISMATCH");
  }
}

function numberAt(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fail(`Expected numeric ${label}.`, "CASE_REPORT_INVALID");
  }
  return value;
}

function recordAt(value: unknown, label: string): JsonRecord {
  if (!isRecord(value)) return fail(`Expected object ${label}.`, "CASE_REPORT_INVALID");
  return value;
}

function arrayAt(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) return fail(`Expected array ${label}.`, "CASE_REPORT_INVALID");
  return value;
}

function validateValidationReport(report: JsonRecord, inputPath: string): void {
  exactInput(report, inputPath, "offline-validate");
  const counts = recordAt(report.counts, "validation counts");
  if (
    report.status !== "completed" ||
    report.requested_type !== "contact" ||
    numberAt(counts.total, "validation total") !== 1 ||
    numberAt(counts.valid, "validation valid") !== 1 ||
    numberAt(counts.invalid, "validation invalid") !== 0 ||
    numberAt(recordAt(counts.by_type, "validation by_type").contact, "contact count") !== 1
  ) {
    return fail(
      "Offline contact validation did not pass exactly one row.",
      "CASE_OFFLINE_VALIDATE_FAILED",
    );
  }
}

function validateDryRun(report: JsonRecord, inputPath: string): void {
  exactInput(report, inputPath, "offline-save-draft-dry-run");
  const counts = recordAt(report.counts, "dry-run counts");
  if (
    report.status !== "completed" ||
    report.mode !== "dry_run" ||
    report.commit !== false ||
    report.requested_type !== "contact" ||
    numberAt(counts.selected, "dry-run selected") !== 1 ||
    numberAt(counts.prepared, "dry-run prepared") !== 1 ||
    numberAt(counts.executed, "dry-run executed") !== 0 ||
    numberAt(counts.failed, "dry-run failed") !== 0
  ) {
    return fail(
      "Contact save-draft dry-run did not prepare exactly one row.",
      "CASE_DRY_RUN_FAILED",
    );
  }
}

function validatePublicFlowRead(report: JsonRecord): void {
  const filters = recordAt(report.filters, "flow list filters");
  const rows = arrayAt(report.rows, "flow list rows");
  if (
    report.status !== "listed_remote_flows" ||
    stableJson(filters.requested_state_codes) !== "[100]" ||
    numberAt(filters.limit, "flow list limit") !== 1 ||
    numberAt(report.count, "flow list count") !== rows.length ||
    rows.length !== 1 ||
    rows.some((row) => !isRecord(row) || row.state_code !== 100)
  ) {
    return fail(
      "Public flow read was not the exact bounded state-100 case.",
      "CASE_PUBLIC_READ_FAILED",
    );
  }
}

function validateSelfDraftRead(report: JsonRecord, userId: string): void {
  const filters = recordAt(report.filters, "process list filters");
  const rows = arrayAt(report.rows, "process list rows");
  if (
    report.status !== "listed_remote_processes" ||
    filters.requested_user_id !== userId ||
    stableJson(filters.requested_state_codes) !== "[0]" ||
    numberAt(filters.limit, "process list limit") !== 1 ||
    numberAt(report.count, "process list count") !== rows.length ||
    rows.length > 1 ||
    rows.some((row) => !isRecord(row) || row.user_id !== userId || row.state_code !== 0)
  ) {
    return fail(
      "Self-draft read escaped the exact owner/state scope.",
      "CASE_SELF_DRAFT_READ_FAILED",
    );
  }
}

function readChecks(filePath: string): JsonRecord[] {
  if (!existsSync(filePath)) {
    return fail("Remote verification checks are missing.", "CASE_CHECKS_MISSING");
  }
  const text = readFileSync(filePath, "utf8").trim();
  try {
    return text
      ? text.split(/\r?\n/u).map((line) => {
          const value = JSON.parse(line);
          if (!isRecord(value)) throw new Error("not object");
          return value;
        })
      : [];
  } catch {
    return fail("Remote verification checks are invalid.", "CASE_CHECKS_INVALID");
  }
}

function validatePrewriteVerify(
  report: JsonRecord,
  checks: JsonRecord[],
  inputPath: string,
  contactId: string,
): void {
  exactInput(report, inputPath, "prewrite-verify");
  const counts = recordAt(report.counts, "prewrite counts");
  const blockers = arrayAt(report.blockers, "prewrite blockers");
  const roots = checks.filter(
    (check) => check.role === "root" && !String(check.path ?? "").endsWith("#readback"),
  );
  const root = roots[0];
  if (
    report.status !== "passed_remote_verification" ||
    report.root_policy !== "candidate" ||
    numberAt(counts.blockers, "prewrite blockers") !== 0 ||
    blockers.length !== 0 ||
    roots.length !== 1 ||
    root?.row_index !== 0 ||
    root.table !== "contacts" ||
    root.id !== contactId ||
    root.version !== "00.00.001" ||
    root.status !== "ok" ||
    root.exact_version !== null ||
    root.latest_version !== null ||
    checks.some((check) => check.status !== "ok")
  ) {
    return fail(
      "Prewrite verification did not prove a unique absent contact candidate.",
      "CASE_PREWRITE_COLLISION",
    );
  }
}

function validateCommit(report: JsonRecord, inputPath: string, contactId: string): void {
  exactInput(report, inputPath, "commit");
  const counts = recordAt(report.counts, "commit counts");
  const rows = arrayAt(report.rows, "commit rows");
  const row = rows[0];
  if (
    report.status !== "completed" ||
    report.mode !== "commit" ||
    report.commit !== true ||
    report.requested_type !== "contact" ||
    numberAt(counts.selected, "commit selected") !== 1 ||
    numberAt(counts.executed, "commit executed") !== 1 ||
    numberAt(counts.failed, "commit failed") !== 0 ||
    rows.length !== 1 ||
    !isRecord(row) ||
    row.id !== contactId ||
    row.version !== "00.00.001" ||
    row.type !== "contact" ||
    row.table !== "contacts" ||
    row.status !== "executed" ||
    !["insert", "save_draft", "recovered_exact_readback"].includes(String(row.operation))
  ) {
    return fail("Contact commit did not prove exactly one successful row.", "CASE_COMMIT_FAILED");
  }
}

function validatePostwriteVerify(
  report: JsonRecord,
  checks: JsonRecord[],
  inputPath: string,
  contactId: string,
  userId: string,
  payloadSha256: string,
): void {
  exactInput(report, inputPath, "postwrite-verify");
  const counts = recordAt(report.counts, "postwrite counts");
  const blockers = arrayAt(report.blockers, "postwrite blockers");
  const readbacks = checks.filter(
    (check) => check.role === "root" && String(check.path ?? "").endsWith("#readback"),
  );
  const readback = readbacks[0];
  if (
    report.status !== "passed_remote_verification" ||
    report.root_policy !== "candidate" ||
    numberAt(counts.blockers, "postwrite blockers") !== 0 ||
    numberAt(counts.root_readback_checks, "root readbacks") !== 1 ||
    numberAt(counts.root_payload_mismatches, "payload mismatches") !== 0 ||
    blockers.length !== 0 ||
    checks.some((check) => check.status !== "ok") ||
    readbacks.length !== 1 ||
    readback?.row_index !== 0 ||
    readback.table !== "contacts" ||
    readback.id !== contactId ||
    readback.version !== "00.00.001" ||
    readback.status !== "ok" ||
    readback.remote_user_id !== userId ||
    readback.remote_state_code !== 0 ||
    readback.local_payload_sha256 !== payloadSha256 ||
    readback.remote_payload_sha256 !== payloadSha256
  ) {
    return fail(
      checks.some((check) => check.status !== "ok")
        ? "Postwrite verification contains a non-ok verification check."
        : "Postwrite verification did not prove the unique owner draft.",
      "CASE_READBACK_FAILED",
    );
  }
}

function redactSecrets(root: string, secrets: string[]): string[] {
  if (!existsSync(root)) return [];
  const changedPaths: string[] = [];
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(entryPath);
      else if (entry.isFile()) {
        const text = readFileSync(entryPath).toString("utf8");
        const redacted = redactCredentialText(text, secrets);
        if (redacted !== text) {
          overwritePrivateFile(entryPath, redacted);
          changedPaths.push(entryPath);
        }
      }
    }
  };
  visit(root);
  return changedPaths.sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right)));
}

function hardenTree(root: string): void {
  if (process.platform === "win32" || !existsSync(root)) return;
  const visit = (directory: string): void => {
    chmodSync(directory, 0o700);
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(entryPath);
      else if (entry.isFile()) chmodSync(entryPath, 0o600);
    }
  };
  visit(root);
}

function artifactInventory(root: string): ArtifactFact[] {
  const facts: ArtifactFact[] = [];
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(entryPath);
      else if (
        entry.isFile() &&
        !["case-manifest.json", "case-failure.json"].includes(entry.name)
      ) {
        facts.push(fileFact(entryPath, root));
      }
    }
  };
  visit(root);
  return facts.sort((left, right) =>
    Buffer.compare(Buffer.from(left.path, "utf8"), Buffer.from(right.path, "utf8")),
  );
}

function writeFailure(
  outDir: string,
  input: {
    stage: string;
    code: string;
    mutationDispatchCount: number;
    contactId: string | null;
    runtimeCleanupErrorCode: string | null;
    redactionErrorCode: string | null;
  },
): void {
  if (!existsSync(outDir) || existsSync(path.join(outDir, "case-failure.json"))) return;
  writePrivateJson(path.join(outDir, "case-failure.json"), {
    schema: FAILURE_SCHEMA,
    status: "failed",
    stage: input.stage,
    error_code: input.code,
    mutation_dispatch_count: input.mutationDispatchCount,
    contact_id: input.contactId,
    runtime_cleanup_error_code: input.runtimeCleanupErrorCode,
    redaction_error_code: input.redactionErrorCode,
    automatic_retry_performed: false,
  });
}

export async function runProductionContactDraftCase(
  rawOptions: ProductionContactDraftCaseOptions,
  deps: RunProductionContactDraftCaseDeps = {},
): Promise<ProductionContactDraftCaseManifest> {
  const options = normalizeOptions(rawOptions);
  const platform = deps.platform ?? process.platform;
  if (platform === "win32") {
    return fail(
      "Secure private case storage is unsupported on Windows without a verified user-exclusive ACL.",
      "CASE_PLATFORM_PRIVATE_STORAGE_UNSUPPORTED",
      2,
    );
  }
  const root = repositoryRoot();
  assertPrivateParentInsideRepository(root, options.outDir);
  assertGitIgnoredCaseOutDir(root, options.outDir);
  const runtime = validateRuntimeEvidence(
    (deps.prepareRuntimeSnapshot ?? prepareRuntimeSnapshot)(),
  );
  let cleanupAttempted = false;
  let runtimeCleanupErrorCode: string | null = null;
  const cleanup = (): void => {
    if (cleanupAttempted) return;
    cleanupAttempted = true;
    try {
      runtime.cleanup();
    } catch {
      runtimeCleanupErrorCode = "CASE_RUNTIME_CLEANUP_FAILED";
    }
  };
  const now = deps.now ?? (() => new Date());
  const processEnv = deps.processEnv ?? process.env;
  const spawnImpl =
    deps.spawnImpl ??
    ((command: string, args: string[], spawnOptions: ProductionContactDraftSpawn["options"]) =>
      spawnSync(command, args, spawnOptions));
  const stages: StageEvidence[] = [];
  let stage = "prepare";
  let mutationDispatchCount = 0;
  let contactId: string | null = null;
  let secrets: string[] = [];

  try {
    const outParent = path.dirname(options.outDir);
    const outParentExisted = existsSync(outParent);
    try {
      mkdirSync(outParent, { recursive: true, mode: 0o700 });
      if (!lstatSync(outParent).isDirectory()) throw new Error("not a directory");
      const realParent = realpathSync(outParent);
      const relativeRealParent = path.relative(root, realParent);
      if (relativeRealParent.startsWith(`..${path.sep}`) || path.isAbsolute(relativeRealParent)) {
        throw new Error("parent escaped repository");
      }
      if (!outParentExisted && process.platform !== "win32") chmodSync(outParent, 0o700);
    } catch {
      return fail(
        "Production case output parent could not be created safely.",
        "CASE_OUTPUT_PARENT_CREATE_FAILED",
        2,
      );
    }
    try {
      mkdirSync(options.outDir, { recursive: false, mode: 0o700 });
    } catch {
      return fail(
        "Production case output directory could not be created exclusively.",
        "CASE_OUTPUT_CREATE_FAILED",
        2,
      );
    }
    if (process.platform !== "win32") chmodSync(options.outDir, 0o700);
    const cleanCwd = path.join(options.outDir, "clean-cwd");
    mkdirSync(cleanCwd, { recursive: false, mode: 0o700 });
    if (process.platform !== "win32") chmodSync(cleanCwd, 0o700);
    if (existsSync(path.join(cleanCwd, ".env"))) {
      return fail("Production case cwd contains .env.", "CASE_CWD_UNSAFE", 2);
    }

    contactId = assertCanonicalUuid((deps.randomUUID ?? nodeRandomUUID)(), "Generated contact id");
    const candidate = contactPayload(contactId, now());
    const candidatePath = path.join(options.outDir, "contact.jsonl");
    const candidateText = `${JSON.stringify(candidate)}\n`;
    const candidateBytes = Buffer.from(candidateText, "utf8");
    writePrivateFile(candidatePath, candidateText);
    const rootProbePath = path.join(options.outDir, "contact-root-probe.jsonl");
    writePrivateFile(rootProbePath, `${JSON.stringify(contactRootProbe(contactId))}\n`);
    chmodSync(candidatePath, 0o400);
    chmodSync(rootProbePath, 0o400);
    const candidatePayloadSha256 = sha256Json(candidate);

    const invoke = (
      stageName: string,
      argv: string[],
      env: NodeJS.ProcessEnv,
      diskReportPath: string | null,
      markMutationDispatch = false,
    ): JsonRecord => {
      stage = stageName;
      if (diskReportPath && existsSync(diskReportPath)) {
        return fail(`Refusing stale report path at ${stageName}.`, "CASE_STALE_ARTIFACT");
      }
      const spawnOptions: ProductionContactDraftSpawn["options"] = {
        cwd: cleanCwd,
        env,
        shell: false,
        encoding: "utf8",
        maxBuffer: MAX_CHILD_OUTPUT_BYTES,
        timeout: CHILD_TIMEOUT_MS,
        windowsHide: true,
      };
      let child: SpawnResult;
      try {
        runtime.verifyCurrent();
      } catch {
        return fail(`Runtime evidence drifted at ${stageName}.`, "CASE_RUNTIME_DRIFT");
      }
      if (markMutationDispatch) mutationDispatchCount += 1;
      try {
        child = spawnImpl(process.execPath, [runtime.entrypoint, ...argv], spawnOptions);
      } catch {
        return fail(
          stageName === "commit-contact-draft" && mutationDispatchCount > 0
            ? `CLI failed at ${stageName} with an ambiguous mutation outcome.`
            : `CLI spawn failed at ${stageName}.`,
          stageName === "commit-contact-draft" && mutationDispatchCount > 0
            ? "CASE_MUTATION_OUTCOME_AMBIGUOUS"
            : "CASE_CHILD_SPAWN_FAILED",
          stageName === "commit-contact-draft" && mutationDispatchCount > 0 ? 70 : 1,
        );
      }
      try {
        runtime.verifyCurrent();
      } catch {
        return fail(
          stageName === "commit-contact-draft" && mutationDispatchCount > 0
            ? `CLI failed at ${stageName} with an ambiguous mutation outcome.`
            : `Runtime evidence drifted at ${stageName}.`,
          stageName === "commit-contact-draft" && mutationDispatchCount > 0
            ? "CASE_MUTATION_OUTCOME_AMBIGUOUS"
            : "CASE_RUNTIME_DRIFT",
          stageName === "commit-contact-draft" && mutationDispatchCount > 0 ? 70 : 1,
        );
      }
      if (child.error || child.status !== 0 || child.signal !== null || child.stderr !== "") {
        if (stageName === "commit-contact-draft" && mutationDispatchCount > 0) {
          return fail(
            `CLI failed at ${stageName} with an ambiguous mutation outcome.`,
            "CASE_MUTATION_OUTCOME_AMBIGUOUS",
            70,
          );
        }
        if (child.signal) {
          return fail(
            `CLI was cancelled at ${stageName}.`,
            "CASE_CHILD_CANCELLED",
            signalExitCode(child.signal),
          );
        }
        return fail(
          `CLI failed at ${stageName}.`,
          child.error ? "CASE_CHILD_SPAWN_FAILED" : safeChildCode(child.stderr),
        );
      }
      if (
        containsSecretMaterial(child.stdout, secrets) ||
        containsSecretMaterial(child.stderr, secrets)
      ) {
        return fail(
          "Secret material was detected in production case child output.",
          "CASE_SECRET_MATERIAL_DETECTED",
        );
      }
      const report = parseSingleJsonLine(child.stdout, stageName);
      const diskFact = diskReportPath ? requireDiskReport(diskReportPath, report, stageName) : null;
      if (diskReportPath && containsSecretMaterial(readFileSync(diskReportPath, "utf8"), secrets)) {
        return fail(
          "Secret material was detected in a production case disk report.",
          "CASE_SECRET_MATERIAL_DETECTED",
        );
      }
      stages.push({
        stage: stageName,
        argv,
        argv_sha256: sha256Json(argv),
        report_sha256: sha256Json(report),
        disk_report_sha256: diskFact?.sha256 ?? null,
        status: token(report.status),
      });
      return report;
    };

    const offlineEnv = systemEnv(processEnv);
    const validateDir = path.join(options.outDir, "offline-validate");
    const validation = invoke(
      "offline-validate",
      [
        "dataset",
        "validate",
        "--input",
        candidatePath,
        "--type",
        "contact",
        "--out-dir",
        validateDir,
        "--json",
      ],
      offlineEnv,
      path.join(validateDir, "outputs", "validation-report.json"),
    );
    validateValidationReport(validation, candidatePath);

    const dryRunDir = path.join(options.outDir, "offline-save-draft-dry-run");
    const dryRun = invoke(
      "offline-save-draft-dry-run",
      [
        "dataset",
        "save-draft",
        "--input",
        candidatePath,
        "--type",
        "contact",
        "--out-dir",
        dryRunDir,
        "--dry-run",
        "--json",
      ],
      offlineEnv,
      path.join(dryRunDir, "outputs", "dataset-save-draft", "summary.json"),
    );
    validateDryRun(dryRun, candidatePath);

    stage = "load-production-env";
    const caseEnv = readCaseEnv(options.envFile, root);
    secrets = [caseEnv.TIANGONG_LCA_SESSION_FILE];
    if (projectRefFromBaseUrl(caseEnv.TIANGONG_LCA_API_BASE_URL) !== options.expectedProjectRef) {
      return fail("Production env project does not match intent.", "CASE_PROJECT_MISMATCH", 2);
    }
    const authenticatedEnv = remoteEnv(processEnv, caseEnv);

    const authArgv = [
      "auth",
      "identity-receipt",
      "--expected-project-ref",
      options.expectedProjectRef,
      "--expected-user-id",
      options.expectedUserId,
      "--json",
    ];
    const firstReceiptValue = invoke("identity-before-reads", authArgv, authenticatedEnv, null);
    const firstReceipt = parseFreshIntentBoundAuthReceipt(firstReceiptValue, {
      nowMs: now().getTime(),
      maxAgeMs: RECEIPT_MAX_AGE_MS,
      expectedProjectRef: options.expectedProjectRef,
      expectedUserId: options.expectedUserId,
    });
    assertReceiptRuntime(firstReceipt, runtime);
    const firstReceiptPath = path.join(options.outDir, "identity-receipt-before-reads.json");
    writePrivateJson(firstReceiptPath, firstReceipt);

    const publicRead = invoke(
      "public-flow-read",
      ["flow", "list", "--state-code", "100", "--limit", "1", "--json"],
      authenticatedEnv,
      null,
    );
    validatePublicFlowRead(publicRead);

    const selfDraftRead = invoke(
      "self-process-draft-read",
      [
        "process",
        "list",
        "--user-id",
        options.expectedUserId,
        "--state-code",
        "0",
        "--limit",
        "1",
        "--json",
      ],
      authenticatedEnv,
      null,
    );
    validateSelfDraftRead(selfDraftRead, options.expectedUserId);

    const prewriteDir = path.join(options.outDir, "prewrite-verify");
    const prewrite = invoke(
      "prewrite-verify",
      [
        "dataset",
        "verify-remote",
        "--input",
        rootProbePath,
        "--out-dir",
        prewriteDir,
        "--root-policy",
        "candidate",
        "--json",
      ],
      authenticatedEnv,
      path.join(prewriteDir, "outputs", "remote-verification-report.json"),
    );
    validatePrewriteVerify(
      prewrite,
      readChecks(path.join(prewriteDir, "outputs", "remote-verification.jsonl")),
      rootProbePath,
      contactId,
    );

    const secondReceiptValue = invoke("identity-before-write", authArgv, authenticatedEnv, null);
    const secondReceipt = parseFreshIntentBoundAuthReceipt(secondReceiptValue, {
      nowMs: now().getTime(),
      maxAgeMs: RECEIPT_MAX_AGE_MS,
      expectedProjectRef: options.expectedProjectRef,
      expectedUserId: options.expectedUserId,
    });
    assertReceiptRuntime(secondReceipt, runtime);
    if (Date.parse(secondReceipt.captured_at_utc) < Date.parse(firstReceipt.captured_at_utc)) {
      return fail("Write receipt predates the read receipt.", "CASE_RECEIPT_ORDER_INVALID");
    }
    const secondReceiptPath = path.join(options.outDir, "identity-receipt-before-write.json");
    writePrivateJson(secondReceiptPath, secondReceipt);

    const commitDir = path.join(options.outDir, "commit-contact-draft");
    const currentCandidateBytes = readRegularFile(candidatePath);
    if (!currentCandidateBytes.equals(candidateBytes)) {
      return fail(
        "The candidate bytes changed before mutation dispatch.",
        "CASE_CANDIDATE_ARTIFACT_DRIFT",
      );
    }
    const commit = invoke(
      "commit-contact-draft",
      [
        "dataset",
        "save-draft",
        "--input",
        candidatePath,
        "--type",
        "contact",
        "--out-dir",
        commitDir,
        "--commit",
        "--json",
      ],
      authenticatedEnv,
      path.join(commitDir, "outputs", "dataset-save-draft", "summary.json"),
      true,
    );
    validateCommit(commit, candidatePath, contactId);

    const postwriteDir = path.join(options.outDir, "postwrite-verify");
    const postwrite = invoke(
      "postwrite-verify",
      [
        "dataset",
        "verify-remote",
        "--input",
        candidatePath,
        "--out-dir",
        postwriteDir,
        "--root-policy",
        "candidate",
        "--compare-root-payload",
        "--target-user-id",
        options.expectedUserId,
        "--state-code",
        "0",
        "--json",
      ],
      authenticatedEnv,
      path.join(postwriteDir, "outputs", "remote-verification-report.json"),
    );
    validatePostwriteVerify(
      postwrite,
      readChecks(path.join(postwriteDir, "outputs", "remote-verification.jsonl")),
      candidatePath,
      contactId,
      options.expectedUserId,
      candidatePayloadSha256,
    );

    cleanup();
    if (runtimeCleanupErrorCode) {
      return fail("The private runtime snapshot could not be cleaned up.", runtimeCleanupErrorCode);
    }
    const redactedPaths = redactSecrets(options.outDir, secrets);
    if (redactedPaths.length > 0) {
      return fail(
        "Secret material was detected in persisted production case artifacts.",
        "CASE_SECRET_MATERIAL_DETECTED",
      );
    }
    hardenTree(options.outDir);
    const candidateFact = fileFact(candidatePath, options.outDir);
    const firstReceiptFact = fileFact(firstReceiptPath, options.outDir);
    const secondReceiptFact = fileFact(secondReceiptPath, options.outDir);
    const scope: ManifestScope = {
      schema: CASE_SCHEMA,
      status: "passed",
      executed_at_utc: now().toISOString(),
      project_ref: options.expectedProjectRef,
      user_id: options.expectedUserId,
      contact_id: contactId,
      contact_version: "00.00.001",
      contact_artifact: { ...candidateFact, payload_sha256: candidatePayloadSha256 },
      cli: {
        package_name: runtime.cliPackageName,
        package_version: runtime.cliPackageVersion,
        entrypoint_sha256: runtime.cliEntrypointSha256,
        runtime_sha256: runtime.cliRuntimeSha256,
        pnpm_installation_sha256: runtime.pnpmInstallationSha256,
      },
      foundry: {
        runner_sha256: runtime.runnerSha256,
        source_sha256: runtime.foundrySourceSha256 ?? null,
        pnpm_lock_sha256: runtime.pnpmLockSha256,
      },
      receipts: [
        {
          role: "before_reads",
          file: firstReceiptFact.path,
          file_sha256: firstReceiptFact.sha256,
          receipt_scope_sha256: firstReceipt.receipt_scope_sha256,
          captured_at_utc: firstReceipt.captured_at_utc,
        },
        {
          role: "before_write",
          file: secondReceiptFact.path,
          file_sha256: secondReceiptFact.sha256,
          receipt_scope_sha256: secondReceipt.receipt_scope_sha256,
          captured_at_utc: secondReceipt.captured_at_utc,
        },
      ],
      stages,
      mutation_dispatch_count: 1,
      mutation_disposition: "retained_owner_draft",
      unique_root_readback_checks: 1,
      artifacts: artifactInventory(options.outDir),
    };
    const manifest = { ...scope, manifest_scope_sha256: sha256Json(scope) };
    writePrivateJson(path.join(options.outDir, "case-manifest.json"), manifest, 0o400);
    if (process.platform !== "win32") {
      for (const immutable of [candidatePath, firstReceiptPath, secondReceiptPath]) {
        chmodSync(immutable, 0o400);
      }
    }
    return manifest;
  } catch (error) {
    cleanup();
    let redactionErrorCode: string | null = null;
    try {
      redactSecrets(options.outDir, secrets);
    } catch {
      redactionErrorCode = "CASE_SECRET_REDACTION_FAILED";
    }
    const code =
      error instanceof ProductionContactDraftCaseError ? error.code : "CASE_UNEXPECTED_FAILURE";
    writeFailure(options.outDir, {
      stage,
      code,
      mutationDispatchCount,
      contactId,
      runtimeCleanupErrorCode,
      redactionErrorCode,
    });
    hardenTree(options.outDir);
    throw error;
  } finally {
    cleanup();
  }
}

function renderHelp(): string {
  return `Usage:
  pnpm case:production:contact-draft -- --env-file <ignored-.env> --expected-project-ref <ref> --expected-user-id <uuid> --out-dir <new-private-dir>

This explicit case runs offline validation, bounded production reads, one owner-draft contact write,
and an exact owner/state/payload readback. It is POSIX-only, requires an owner-private env file plus
a repository-local git-ignored output without symlink parents, is not part of ordinary CI, and never retries a write.`;
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(`${renderHelp()}\n`);
    return 0;
  }
  try {
    const options = parseProductionContactDraftCaseArgs(argv);
    const manifest = await runProductionContactDraftCase(options);
    process.stdout.write(
      `${JSON.stringify({ status: manifest.status, out_dir: options.outDir, contact_id: manifest.contact_id, manifest_scope_sha256: manifest.manifest_scope_sha256 })}\n`,
    );
    return 0;
  } catch (error) {
    const code =
      error instanceof ProductionContactDraftCaseError ? error.code : "CASE_UNEXPECTED_FAILURE";
    const exitCode = error instanceof ProductionContactDraftCaseError ? error.exitCode : 1;
    process.stderr.write(`${JSON.stringify({ error: { code } })}\n`);
    return exitCode;
  }
}

function isDirectEntry(importMetaUrl: string, argv1: string | undefined): boolean {
  if (!argv1) return false;
  let invokedPath = path.resolve(argv1);
  let modulePath = fileURLToPath(importMetaUrl);
  try {
    invokedPath = realpathSync(invokedPath);
  } catch {
    // A missing invoked path cannot be the loaded module.
  }
  try {
    modulePath = realpathSync(modulePath);
  } catch {
    // Keep the canonical URL path when a test virtualizes the module.
  }
  return pathToFileURL(invokedPath).href === pathToFileURL(modulePath).href;
}

export const __testInternals = {
  contactPayload,
  contactRootProbe,
  prepareRuntimeSnapshot,
  signalExitCode,
};

if (isDirectEntry(import.meta.url, process.argv[1])) process.exitCode = await main();

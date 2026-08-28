import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import process from "node:process";
import {
  runtimeEnvFilePolicyDisabled,
  runtimeEnvFilePolicyKey,
} from "./foundry-runtime-environment.ts";
import { resolveFoundryRuntimePaths } from "./foundry-runtime-paths.ts";

const require = createRequire(import.meta.url);
const tiangongLcaCliPackageName = "@tiangong-lca/cli";
const tiangongLcaCliPackageVersion = "0.1.3";
const tiangongLcaCliBinName = "tiangong-lca";
const { repoRoot: foundryRepoRoot } = resolveFoundryRuntimePaths(import.meta.url);

export interface InstalledTiangongLcaCliPackage {
  packageName: string;
  packageVersion: string;
  packageSpec: string;
  packageJsonPath: string;
  packageRoot: string;
  binName: string;
  binPath: string;
  schemaDir: string;
}

export interface TiangongLcaCliRuntimeCommand {
  command: string;
  args: string[];
  display: string;
  source: "TIANGONG_LCA_CLI_BIN" | "installed_package";
  package: string | null;
  package_version: string | null;
  package_root?: string;
  bin_path: string;
}

export interface FoundryRuntimeDependencies {
  parseScalar: (value: unknown) => unknown;
  repoRoot: string;
}

interface JsonRecord {
  [key: string]: unknown;
}

interface RuntimeStage extends JsonRecord {
  stage?: string;
  status?: string;
  exit_code?: number;
  command?: string;
  args?: string[];
  stderr?: string;
  report?: JsonRecord | null;
  report_file?: string | null;
}

interface LoadEnvOptions {
  override?: boolean;
}

interface LoadRuntimeEnvOptions {
  allowFilesystemEnv?: boolean;
}

interface GateBlockerOptions {
  code: string;
  message: string;
}

interface PostAuthoringGateOptions {
  schemaStage: RuntimeStage;
  qaStage: RuntimeStage;
  locationAuditBlockers: JsonRecord[];
  curationGate: JsonRecord | null;
  curationGateReportFile: string | null;
  requireDeterministicQa?: boolean;
  requireCurationGate?: boolean;
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function resolveInstalledTiangongLcaCliPackage(): InstalledTiangongLcaCliPackage {
  const logicalPackageJsonPath = path.join(
    foundryRepoRoot,
    "node_modules",
    "@tiangong-lca",
    "cli",
    "package.json",
  );
  let packageJsonPath = logicalPackageJsonPath;
  if (!fs.existsSync(packageJsonPath)) {
    try {
      packageJsonPath = require.resolve(`${tiangongLcaCliPackageName}/package.json`);
    } catch (error) {
      throw new Error(
        `Unable to resolve installed ${tiangongLcaCliPackageName}@${tiangongLcaCliPackageVersion}; run pnpm install --frozen-lockfile.`,
        { cause: error },
      );
    }
  }

  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8")) as JsonRecord;
  if (
    packageJson.name !== tiangongLcaCliPackageName ||
    packageJson.version !== tiangongLcaCliPackageVersion
  ) {
    throw new Error(
      `Expected installed ${tiangongLcaCliPackageName}@${tiangongLcaCliPackageVersion}, received ${packageJson.name ?? "unknown"}@${packageJson.version ?? "unknown"}.`,
    );
  }

  const binEntry =
    typeof packageJson.bin === "string"
      ? packageJson.bin
      : isRecord(packageJson.bin)
        ? packageJson.bin[tiangongLcaCliBinName]
        : undefined;
  if (typeof binEntry !== "string" || binEntry.trim() === "") {
    throw new Error(
      `Installed ${tiangongLcaCliPackageName}@${tiangongLcaCliPackageVersion} does not expose the '${tiangongLcaCliBinName}' package bin.`,
    );
  }

  const packageRoot = path.dirname(packageJsonPath);
  const binPath = path.resolve(packageRoot, binEntry);
  const schemaDir = path.join(packageRoot, "assets", "tidas-schemas");
  if (!fs.existsSync(binPath) || !fs.statSync(binPath).isFile()) {
    throw new Error(`Installed ${tiangongLcaCliPackageName} bin is missing at ${binPath}.`);
  }
  if (!fs.existsSync(schemaDir) || !fs.statSync(schemaDir).isDirectory()) {
    throw new Error(
      `Installed ${tiangongLcaCliPackageName} schema assets are missing at ${schemaDir}.`,
    );
  }

  return {
    packageName: packageJson.name,
    packageVersion: packageJson.version,
    packageSpec: `${packageJson.name}@${packageJson.version}`,
    packageJsonPath,
    packageRoot,
    binName: tiangongLcaCliBinName,
    binPath,
    schemaDir,
  };
}

function shellQuoteCommandToken(value: unknown): string {
  const text = String(value ?? "");
  if (/^[A-Za-z0-9_./:@%+=,-]+$/u.test(text)) return text;
  return `'${text.replace(/'/gu, `'\\''`)}'`;
}

export function resolveTiangongLcaCliRuntimeCommand(
  env: NodeJS.ProcessEnv = process.env,
): TiangongLcaCliRuntimeCommand {
  if (env.TIANGONG_LCA_CLI_BIN) {
    const binPath = env.TIANGONG_LCA_CLI_BIN;
    const isNodeScript = process.platform === "win32" && /\.(?:cjs|mjs|js)$/iu.test(binPath);
    const command = isNodeScript ? process.execPath : binPath;
    const args = isNodeScript ? [binPath] : [];
    return {
      command,
      args,
      display: [command, ...args].map(shellQuoteCommandToken).join(" "),
      source: "TIANGONG_LCA_CLI_BIN",
      package: null,
      package_version: null,
      bin_path: binPath,
    };
  }

  const installed = resolveInstalledTiangongLcaCliPackage();
  return {
    command: process.execPath,
    args: [installed.binPath],
    display: [process.execPath, installed.binPath].map(shellQuoteCommandToken).join(" "),
    source: "installed_package",
    package: installed.packageSpec,
    package_version: installed.packageVersion,
    package_root: installed.packageRoot,
    bin_path: installed.binPath,
  };
}

export function createFoundryRuntimeUtils({ parseScalar, repoRoot }: FoundryRuntimeDependencies) {
  function nowIso(): string {
    return new Date().toISOString();
  }

  function readText(filePath: string): string {
    return fs.readFileSync(filePath, "utf8");
  }

  function writeText(filePath: string, text: string): void {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, text);
  }

  function resolveTiangongLcaCliCommand(): TiangongLcaCliRuntimeCommand {
    return resolveTiangongLcaCliRuntimeCommand(process.env);
  }

  function resolveTiangongLcaCliBin(): string {
    return resolveTiangongLcaCliCommand().display;
  }

  function resolveTiangongLcaCliCommandPrefix(): string[] {
    const cli = resolveTiangongLcaCliCommand();
    return [cli.command, ...cli.args];
  }

  function tiangongLcaCliInvocation(args: string[] = []) {
    const cli = resolveTiangongLcaCliCommand();
    const spawnArgs = [...cli.args, ...args];
    return {
      ...cli,
      spawn_args: spawnArgs,
      command_line: [cli.command, ...spawnArgs].map(shellQuote).join(" "),
    };
  }

  function readJson(filePath: string): unknown {
    return JSON.parse(readText(filePath));
  }

  function readJsonLines(filePath: string): unknown[] {
    return readText(filePath)
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line, index) => {
        try {
          return JSON.parse(line);
        } catch (error) {
          throw new Error(`Invalid JSONL at ${repoRelativePath(filePath)}:${index + 1}: ${error}`);
        }
      });
  }

  function writeJson(filePath: string, value: unknown): void {
    writeText(filePath, `${JSON.stringify(value, null, 2)}\n`);
  }

  function fileExists(filePath: string | null | undefined): boolean {
    return Boolean(filePath && fs.existsSync(filePath) && fs.statSync(filePath).isFile());
  }

  function directoryExists(filePath: string | null | undefined): boolean {
    return Boolean(filePath && fs.existsSync(filePath) && fs.statSync(filePath).isDirectory());
  }

  function resolveRepoPath(filePath: unknown): string | null {
    if (!filePath) return null;
    const value = filePath as string;
    return path.isAbsolute(value) ? value : path.join(repoRoot, value);
  }

  function repoRelativePath(filePath: string): string {
    return path.relative(repoRoot, filePath).split(path.sep).join(path.posix.sep);
  }

  function repoRelativeMaybe(filePath: string | null | undefined): string | null {
    return filePath ? repoRelativePath(filePath) : null;
  }

  function sha256Text(value: unknown): string {
    return createHash("sha256")
      .update(String(value ?? ""))
      .digest("hex");
  }

  function sameResolvedPath(left: string | null | undefined, right: string | null | undefined) {
    if (!left || !right) return false;
    return path.resolve(left) === path.resolve(right);
  }

  function reportInputPath(report: unknown): string {
    const record = isRecord(report) ? report : {};
    return asText(record.input_path || record.input_file || record.inputPath || record.inputFile);
  }

  function countRowsFile(filePath: string | null | undefined): number {
    if (!filePath || !fileExists(filePath)) return 0;
    const text = readText(filePath);
    if (!text.trim()) return 0;
    if (filePath.toLowerCase().endsWith(".jsonl")) {
      return text.split(/\r?\n/u).filter((line) => line.trim()).length;
    }
    const value = JSON.parse(text);
    if (Array.isArray(value)) return value.length;
    if (isRecord(value) && Array.isArray(value.rows)) return value.rows.length;
    if (isRecord(value) && Array.isArray(value.items)) return value.items.length;
    return 1;
  }

  function countJsonLinesFile(filePath: string | null | undefined): number {
    if (!filePath || !fileExists(filePath)) return 0;
    return readText(filePath)
      .split(/\r?\n/u)
      .filter((line) => line.trim()).length;
  }

  function readRowsFile(filePath: string | null | undefined): unknown[] {
    if (!filePath || !fileExists(filePath)) return [];
    if (filePath.toLowerCase().endsWith(".jsonl")) {
      return readJsonLines(filePath);
    }
    const value = readJson(filePath);
    if (Array.isArray(value)) return value;
    if (isRecord(value) && Array.isArray(value.rows)) return value.rows;
    if (isRecord(value) && Array.isArray(value.items)) return value.items;
    return [value];
  }

  function findFilesByName(startDir: unknown, fileName: string, maxDepth = 8): string[] {
    const root = resolveRepoPath(startDir);
    if (!root || !directoryExists(root)) return [];
    const found: string[] = [];
    const ignoredDirs = new Set([".git", "node_modules"]);
    function walk(dir: string, depth: number): void {
      if (depth > maxDepth) return;
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const entryPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (!ignoredDirs.has(entry.name)) walk(entryPath, depth + 1);
        } else if (entry.isFile() && entry.name === fileName) {
          found.push(entryPath);
        }
      }
    }
    walk(root, 0);
    return found.sort();
  }

  function asText(value: unknown): string {
    if (value === undefined || value === null) return "";
    if (typeof value === "string") return value.trim();
    if (typeof value === "number" || typeof value === "boolean") return String(value);
    return "";
  }

  function splitFrontmatter(text: string): { frontmatter: string; body: string } {
    if (!text.startsWith("---\n")) return { frontmatter: "", body: text };
    const end = text.indexOf("\n---\n", 4);
    if (end === -1) throw new Error("Missing closing frontmatter marker.");
    return {
      frontmatter: text.slice(4, end),
      body: text.slice(end + 5),
    };
  }

  function replaceFrontmatterField(frontmatter: string, key: string, value: unknown): string {
    const lines = frontmatter.split(/\r?\n/u);
    let replaced = false;
    const nextLines = lines.map((line) => {
      if (line.match(new RegExp(`^${key}:\\s*`, "u"))) {
        replaced = true;
        return `${key}: ${value}`;
      }
      return line;
    });
    if (!replaced) {
      nextLines.push(`${key}: ${value}`);
    }
    return nextLines.join("\n").replace(/\n+$/u, "");
  }

  function taskMetaFromFile(filePath: string) {
    const text = readText(filePath);
    const { frontmatter, body } = splitFrontmatter(text);
    const meta: Record<string, unknown> = {};
    for (const line of frontmatter.split(/\r?\n/u)) {
      const match = line.match(/^([A-Za-z0-9_.-]+):\s*(.*)$/u);
      if (match) meta[match[1]] = parseScalar(match[2]);
    }
    return { text, frontmatter, body, meta };
  }

  function isPlaceholderEnvValue(value: unknown): boolean {
    const normalized = String(value ?? "").trim();
    return normalized === "" || normalized === "REPLACE_ME";
  }

  function loadEnvFile(filePath: string | null, { override = false }: LoadEnvOptions = {}) {
    if (!filePath || !fs.existsSync(filePath)) return { file: filePath, loaded: false, keys: [] };
    const keys: string[] = [];
    for (const rawLine of readText(filePath).split(/\r?\n/u)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const match = line.replace(/^export\s+/u, "").match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/u);
      if (!match) continue;
      const key = match[1];
      const value = String(match[2] ?? "")
        .trim()
        .replace(/^["']|["']$/gu, "");
      if (override || process.env[key] === undefined || isPlaceholderEnvValue(process.env[key])) {
        process.env[key] = value;
      }
      keys.push(key);
    }
    return { file: filePath, loaded: true, keys };
  }

  function loadRuntimeEnv(options: LoadRuntimeEnvOptions = {}) {
    const envFile = path.join(repoRoot, ".env");
    const allowFilesystemEnv =
      options.allowFilesystemEnv ??
      process.env[runtimeEnvFilePolicyKey] !== runtimeEnvFilePolicyDisabled;
    const repoEnv = allowFilesystemEnv
      ? loadEnvFile(envFile)
      : { file: envFile, loaded: false, keys: [] };
    return { repoEnv };
  }

  function hasUsableEnvValue(key: string): boolean {
    return process.env[key] !== undefined && !isPlaceholderEnvValue(process.env[key]);
  }

  function ensureArray(value: unknown): unknown[] {
    if (Array.isArray(value)) return value;
    if (value === undefined || value === null || value === "") return [];
    return [value];
  }

  function normalizedList(value: unknown): string[] {
    return ensureArray(value)
      .flatMap((item) => String(item).split(","))
      .map((item) => item.trim())
      .filter(Boolean);
  }

  function unique<T>(values: T[]): T[] {
    return [...new Set(values.filter(Boolean))];
  }

  function appendOption(args: string[], flag: string, value: unknown): void {
    if (value === undefined || value === null || value === false || value === "") return;
    args.push(flag, String(value));
  }

  function appendRepeatedOptions(args: string[], flag: string, values: unknown): void {
    for (const value of normalizedList(values)) {
      appendOption(args, flag, value);
    }
  }

  function booleanOption(value: unknown): boolean {
    return value === true || value === "true" || value === "1" || value === "yes";
  }

  function integerOption(value: unknown, fallback: number | null = null): number | null {
    if (value === undefined || value === null || value === "") return fallback;
    const number = Number(value);
    return Number.isInteger(number) ? number : fallback;
  }

  function positiveIntegerOption(value: unknown, fallback: number | null = null): number | null {
    const number = integerOption(value, fallback);
    return number !== null && Number.isInteger(number) && number > 0 ? number : fallback;
  }

  function shellQuote(value: unknown): string {
    const text = String(value ?? "");
    if (/^[A-Za-z0-9_./:@%+=,-]+$/u.test(text)) return text;
    return `'${text.replace(/'/gu, `'\\''`)}'`;
  }

  function compactStageReport(stage: RuntimeStage) {
    return {
      stage: stage.stage,
      status: stage.report?.status ?? stage.status ?? null,
      exit_code: stage.exit_code,
      command: stage.command,
      args: stage.args,
      stderr: stage.stderr,
      report_file: stage.report_file ? repoRelativePath(stage.report_file) : null,
    };
  }

  function reportFileFromCliStage(
    stage: RuntimeStage,
    selectors: string[],
    fallbackPath: unknown,
  ): string | null {
    for (const selector of selectors) {
      const parts = selector.split(".");
      let value: unknown = stage.report;
      for (const part of parts) {
        value = isRecord(value) ? value[part] : undefined;
      }
      const resolved = resolveRepoPath(value);
      if (fileExists(resolved)) {
        return resolved;
      }
    }
    const fallback = resolveRepoPath(fallbackPath);
    return fileExists(fallback) ? fallback : null;
  }

  function blockersFromLocationAuditStage(stage: RuntimeStage | null | undefined): JsonRecord[] {
    const reportBlockers = ensureArray(stage?.report?.blockers);
    const blockers: JsonRecord[] = reportBlockers.map((value) => {
      const blocker = value as JsonRecord;
      return {
        ...blocker,
        code: blocker.code || "location_audit_blocker",
        stage: "location_audit",
        message: blocker.message || "Location audit reported a blocker before remote write.",
      };
    });
    if (stage?.exit_code !== 0 && blockers.length === 0) {
      blockers.push({
        code: "location_audit_failed",
        stage: "location_audit",
        message:
          "Location audit stage failed before remote write; inspect the stage stderr/report.",
        stderr: stage?.stderr || "",
      });
    }
    return blockers;
  }

  function stageExitBlocker(
    stage: RuntimeStage | null | undefined,
    { code, message }: GateBlockerOptions,
  ) {
    return stage?.exit_code === 0
      ? null
      : {
          code,
          stage: stage?.stage ?? null,
          message,
          exit_code: stage?.exit_code ?? null,
          report_file: repoRelativeMaybe(stage?.report_file),
        };
  }

  function postAuthoringPrewriteGateBlockers({
    schemaStage,
    qaStage,
    locationAuditBlockers,
    curationGate,
    curationGateReportFile,
    requireDeterministicQa = true,
    requireCurationGate = true,
  }: PostAuthoringGateOptions): JsonRecord[] {
    const blockers: Array<JsonRecord | null> = [
      stageExitBlocker(schemaStage, {
        code: "schema_validate_not_ready",
        message:
          "Schema validation must complete before post-authoring dry-run or remote write planning.",
      }),
      requireDeterministicQa
        ? stageExitBlocker(qaStage, {
            code: "deterministic_qa_not_ready",
            message:
              "Deterministic QA must complete before post-authoring dry-run or remote write planning.",
          })
        : null,
      ...locationAuditBlockers,
      !requireCurationGate ||
      ["ready", "ready_with_profile_waivers"].includes(curationGate?.status as string)
        ? null
        : {
            code: "post_authoring_curation_gate_not_ready",
            stage: "post_authoring_curation_gate",
            message:
              "Post-authoring curation gate must be ready before dry-run or remote write planning.",
            status: curationGate?.status ?? null,
            report_file: repoRelativeMaybe(curationGateReportFile),
          },
    ];
    return blockers.filter((blocker): blocker is JsonRecord => Boolean(blocker));
  }

  function skippedPrewriteStage(stage: string, reason: string) {
    return {
      stage,
      status: "skipped",
      exit_code: 1,
      command: "skipped",
      args: [],
      stderr: reason,
      report: {
        status: "skipped",
        reason,
      },
      report_file: null,
    };
  }

  function readJsonArtifactOption(value: unknown): { path: string; value: unknown } | null {
    const resolved = resolveRepoPath(value);
    return resolved && fileExists(resolved) ? { path: resolved, value: readJson(resolved) } : null;
  }

  function runTiangongJsonStage(stage: string, args: string[]) {
    const cli = tiangongLcaCliInvocation(args);
    const result = spawnSync(cli.command, cli.spawn_args, {
      cwd: repoRoot,
      env: process.env,
      encoding: "utf8",
      // Mega-scope stages emit large JSON payloads on stdout; the 1MB spawnSync
      // default overflows with ENOBUFS. Cap below V8's max string length.
      maxBuffer: 512 * 1024 * 1024,
    });
    const exitCode = typeof result.status === "number" ? result.status : 1;
    if (result.error) {
      throw result.error;
    }
    let report: unknown = null;
    try {
      report = JSON.parse(result.stdout || "{}");
    } catch {
      throw new Error(
        [
          `tiangong-lca stage ${stage} did not emit JSON.`,
          result.stdout ? `stdout:\n${result.stdout}` : "",
          result.stderr ? `stderr:\n${result.stderr}` : "",
        ]
          .filter(Boolean)
          .join("\n"),
      );
    }
    return {
      stage,
      command: cli.display,
      executable: cli.command,
      args: cli.spawn_args,
      cli_args: args,
      cli_package: cli.package,
      exit_code: exitCode,
      stderr: result.stderr || "",
      report,
      report_file: null,
    };
  }

  function readJsonOrJsonLines(filePath: unknown): unknown[] {
    const resolved = resolveRepoPath(filePath);
    if (!resolved || !fileExists(resolved)) return [];
    if (resolved.toLowerCase().endsWith(".jsonl")) return readJsonLines(resolved);
    const value = readJson(resolved);
    if (Array.isArray(value)) return value;
    if (isRecord(value) && Array.isArray(value.decisions)) return value.decisions;
    if (isRecord(value) && Array.isArray(value.rows)) return value.rows;
    return value && typeof value === "object" ? [value] : [];
  }

  function hasUnresolvedAiPlaceholder(value: unknown): boolean {
    return /__AI_(?:FILL|SELECT)[A-Z0-9_]*__|requires_ai_completion/iu.test(JSON.stringify(value));
  }

  function cloneJson<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
  }

  function jsonSha256(value: unknown): string {
    return createHash("sha256").update(JSON.stringify(value)).digest("hex");
  }

  function deterministicUuid(input: unknown): string {
    const bytes = Buffer.from(
      createHash("sha1").update(String(input)).digest("hex").slice(0, 32),
      "hex",
    );
    bytes[6] = (bytes[6] & 0x0f) | 0x50;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = bytes.toString("hex");
    return [
      hex.slice(0, 8),
      hex.slice(8, 12),
      hex.slice(12, 16),
      hex.slice(16, 20),
      hex.slice(20),
    ].join("-");
  }

  return {
    appendOption,
    appendRepeatedOptions,
    asText,
    blockersFromLocationAuditStage,
    booleanOption,
    cloneJson,
    compactStageReport,
    countJsonLinesFile,
    countRowsFile,
    deterministicUuid,
    directoryExists,
    ensureArray,
    fileExists,
    findFilesByName,
    hasUnresolvedAiPlaceholder,
    hasUsableEnvValue,
    integerOption,
    isPlaceholderEnvValue,
    jsonSha256,
    loadEnvFile,
    loadRuntimeEnv,
    normalizedList,
    nowIso,
    positiveIntegerOption,
    postAuthoringPrewriteGateBlockers,
    readJson,
    readJsonArtifactOption,
    readJsonLines,
    readJsonOrJsonLines,
    readRowsFile,
    readText,
    replaceFrontmatterField,
    reportFileFromCliStage,
    reportInputPath,
    repoRelativeMaybe,
    repoRelativePath,
    resolveRepoPath,
    resolveTiangongLcaCliCommand,
    resolveTiangongLcaCliCommandPrefix,
    resolveTiangongLcaCliBin,
    runTiangongJsonStage,
    sameResolvedPath,
    sha256Text,
    shellQuote,
    skippedPrewriteStage,
    splitFrontmatter,
    stageExitBlocker,
    taskMetaFromFile,
    unique,
    writeJson,
    writeText,
  };
}

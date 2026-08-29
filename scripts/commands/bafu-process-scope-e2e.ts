import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import {
  canRunPostFinalizeIdentityRecovery,
  canRunPostFinalizeSemanticRecovery,
  curationGateBlockers,
  finalizeBlockers,
  postWriteVerifyRetryReasonFromReport,
  reportCodes,
  type JsonRecord,
} from "../lib/bafu-orchestration/finalize-recovery-policy.ts";
import {
  runPostFinalizeIdentityRecovery,
  runPostFinalizeSemanticRecovery,
  type PostFinalizeRecoveryAdapter,
} from "../lib/bafu-orchestration/post-finalize-recovery.ts";
import {
  executeHandoff,
  type ProcessHandoffAdapter,
} from "../lib/bafu-orchestration/process-handoff.ts";
import { readHandoffPlan } from "../lib/bafu-orchestration/process-handoff-plan.ts";
import {
  createBafuProcessScopeRun,
  type BafuProcessScopeRunAdapter,
  type ProcessScopeFinalizeStageResult,
} from "../lib/bafu-orchestration/process-scope-run.ts";
import { createBafuProcessScopeRuntime } from "../lib/bafu-orchestration/process-scope-runtime.ts";
import {
  applyBafuProcessScopeHandoffSummary,
  compactCommandStage as projectCompactCommandStage,
  projectBafuProcessScopeFinalizeReport,
  type CompactCommandStage,
  type CompactCommandStageResult,
} from "../lib/bafu-orchestration/process-scope-report.ts";
import {
  assertFoundryCommandSpecArtifactsCurrent,
  assertFoundryCommandSpecBindsArtifact,
  executeFoundryCommandSpecSync,
  type FoundryCommandSpec,
} from "../lib/foundry-command-spec.ts";
import { resolveFoundryRuntimePaths } from "../lib/foundry-runtime-paths.ts";
import { resolveInstalledTiangongLcaCliPackage } from "../lib/foundry-runtime-utils.ts";
import {
  assertReceiptBoundHandoffAccount,
  traceHashNormalizationAllowed,
} from "../lib/production-case-policy.ts";
import { acceptTraceHashOnlyRemoteVerificationMismatch } from "../lib/remote-verification-accepted-diff.ts";

interface BafuProcessScopeE2eRuntime {
  nowIso: () => string;
  resolveRepoPath: (value: unknown) => string | null;
  repoRelativeMaybe: (filePath: string | null | undefined) => string | null;
  fileExists: (filePath: string | null | undefined) => boolean;
  readJson: (filePath: string) => unknown;
  readJsonLines: (filePath: string) => unknown[];
  readRowsFile: (filePath: string) => unknown[];
  writeJson: (filePath: string, value: unknown) => void;
  textValue: (value: unknown) => string;
  booleanOption: (value: unknown) => boolean;
  shellQuote: (value: string) => string;
}
interface CommandSpecStageInput {
  stage: string;
  commandSpec: FoundryCommandSpec;
  cwd: string;
  logDir: string;
}
interface ArgvStageInput {
  stage: string;
  argv: string[];
  logDir: string;
}

const { entryRepoRelativePath: foundryEntryPath, repoRoot } = resolveFoundryRuntimePaths(
  import.meta.url,
);
const commandName = "dataset-bafu-process-scope-e2e";
const reportFileName = "bafu-process-scope-e2e-report.json";
const ledgerFileName = "bafu-process-scope-e2e-ledger.jsonl";
const finalizeReportName = "dataset-post-authoring-finalize-report.json";
const bafuProcessScopeE2eRuntimeKeys = [
  "nowIso",
  "resolveRepoPath",
  "repoRelativeMaybe",
  "fileExists",
  "readJson",
  "readJsonLines",
  "readRowsFile",
  "writeJson",
  "textValue",
  "booleanOption",
  "shellQuote",
] as const satisfies readonly (keyof BafuProcessScopeE2eRuntime)[];

let bafuProcessScopeE2eRuntime: BafuProcessScopeE2eRuntime | null = null;

function installBafuProcessScopeE2eRuntime(deps: BafuProcessScopeE2eRuntime): void {
  const missing = bafuProcessScopeE2eRuntimeKeys.filter((key) => typeof deps?.[key] !== "function");
  if (missing.length > 0) {
    throw new Error(
      `createBafuProcessScopeE2eCommands missing dependencies: ${missing.join(", ")}`,
    );
  }
  bafuProcessScopeE2eRuntime = deps;
}

function runtime(): BafuProcessScopeE2eRuntime {
  if (!bafuProcessScopeE2eRuntime) {
    throw new Error("createBafuProcessScopeE2eCommands must install command dependencies.");
  }
  return bafuProcessScopeE2eRuntime;
}

function nowIso(): string {
  return runtime().nowIso();
}

function resolveRepoPath(value: unknown): string | null {
  return runtime().resolveRepoPath(value);
}

function repoRelativeMaybe(filePath: string | null | undefined): string | null {
  return runtime().repoRelativeMaybe(filePath);
}

function repoRelative(filePath: string | null | undefined): string {
  return repoRelativeMaybe(filePath) as string;
}

function fileExists(filePath: string | null | undefined): boolean {
  return runtime().fileExists(filePath);
}

function readJson(filePath: string): JsonRecord {
  return runtime().readJson(filePath) as JsonRecord;
}

function readJsonLines(filePath: string): JsonRecord[] {
  return runtime().readJsonLines(filePath) as JsonRecord[];
}

function readRowsFile(filePath: string): JsonRecord[] {
  return runtime().readRowsFile(filePath) as JsonRecord[];
}

function writeJson(filePath: string, value: JsonRecord): void {
  runtime().writeJson(filePath, value);
}

function textValue(value: unknown): string {
  return runtime().textValue(value);
}

function booleanOption(value: unknown): boolean {
  return runtime().booleanOption(value);
}

function shellQuote(value: string): string {
  return runtime().shellQuote(value);
}

function appendLedger(ledgerPath: string, row: JsonRecord): void {
  fs.mkdirSync(path.dirname(ledgerPath), { recursive: true });
  fs.appendFileSync(ledgerPath, `${JSON.stringify(row)}\n`);
}

const processScopeRuntime = createBafuProcessScopeRuntime({
  commandName,
  finalizeReportName,
  foundryEntryPath,
  processExecutable: process.execPath,
  nowIso,
  resolveRepoPath,
  repoRelative,
  fileExists,
  readJson,
  readJsonLines,
  readRowsFile,
  textValue,
  booleanOption,
  shellQuote,
  appendLedger,
  makeDirectory: (directory) => fs.mkdirSync(directory, { recursive: true }),
});

function projectCommandStage({
  stage,
  command,
  result,
  stdoutLog,
  stderrLog,
  reportPath,
}: {
  stage: string;
  command: unknown;
  result: CompactCommandStageResult;
  stdoutLog: string;
  stderrLog: string;
  reportPath: string | null;
}): CompactCommandStage {
  return projectCompactCommandStage({
    stage,
    command,
    result,
    stdoutLog: repoRelativeMaybe(stdoutLog),
    stderrLog: repoRelativeMaybe(stderrLog),
    report: repoRelativeMaybe(reportPath),
  });
}

function runFinalizeStage({
  command,
  logDir,
  label,
}: {
  command: string[];
  logDir: string;
  label: string;
}): ProcessScopeFinalizeStageResult {
  fs.mkdirSync(logDir, { recursive: true });
  const result = spawnSync(command[0], command.slice(1), {
    cwd: repoRoot,
    env: process.env,
    encoding: "utf8",
  });
  const stdoutLog = path.join(logDir, `${label}.stdout.log`);
  const stderrLog = path.join(logDir, `${label}.stderr.log`);
  fs.writeFileSync(stdoutLog, result.stdout || "");
  fs.writeFileSync(stderrLog, result.stderr || "");
  return { result, stdoutLog, stderrLog };
}

function runCommandSpecStage({ stage, commandSpec, cwd, logDir }: CommandSpecStageInput) {
  fs.mkdirSync(logDir, { recursive: true });
  const stdoutLog = path.join(logDir, `${stage}.stdout.log`);
  const stderrLog = path.join(logDir, `${stage}.stderr.log`);
  const result = executeFoundryCommandSpecSync(commandSpec, {
    resolveArtifactPath: resolveRepoPath,
    cwd,
    env: process.env,
  });
  fs.writeFileSync(stdoutLog, result.stdout || "");
  fs.writeFileSync(stderrLog, result.stderr || "");
  return { result, stdoutLog, stderrLog };
}

function runArgvStage({ stage, argv, logDir }: ArgvStageInput) {
  fs.mkdirSync(logDir, { recursive: true });
  const stdoutLog = path.join(logDir, `${stage}.stdout.log`);
  const stderrLog = path.join(logDir, `${stage}.stderr.log`);
  const result = spawnSync(argv[0], argv.slice(1), {
    cwd: repoRoot,
    env: process.env,
    encoding: "utf8",
  });
  fs.writeFileSync(stdoutLog, result.stdout || "");
  fs.writeFileSync(stderrLog, result.stderr || "");
  return { result, stdoutLog, stderrLog };
}

function sleepSync(ms: number): void {
  if (ms > 0) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function integerEnv(name: string, fallback: number): number {
  const parsed = Number.parseInt(String(process.env[name] ?? ""), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function postWriteVerifyRetryAttempts(): number {
  return Math.max(1, Math.min(8, integerEnv("BAFU_POST_WRITE_VERIFY_ATTEMPTS", 3)));
}

function postWriteVerifyRetryDelayMs(attemptIndex: number): number {
  return Math.max(
    0,
    Math.min(
      60_000,
      integerEnv("BAFU_POST_WRITE_VERIFY_RETRY_DELAY_MS", 2_000) * 2 ** attemptIndex,
    ),
  );
}

function postWriteVerifyRetryReason(verifyReportPath: string | null): string | null {
  if (!verifyReportPath || !fileExists(verifyReportPath)) {
    return postWriteVerifyRetryReasonFromReport({ availability: "missing" });
  }
  return postWriteVerifyRetryReasonFromReport({
    availability: "available",
    report: readJson(verifyReportPath),
  });
}

function listProcessHandoffFiles(rootDir: string | null): string[] {
  if (!rootDir || !fs.existsSync(rootDir)) return [];
  const stack = [rootDir];
  const files: string[] = [];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const next = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(next);
      else if (entry.isFile()) files.push(next);
    }
  }
  return files;
}

function postFinalizeRecoveryAdapter(): PostFinalizeRecoveryAdapter {
  return {
    processExecutable: process.execPath,
    foundryEntryPath,
    resolveRepoPath,
    repoRelative,
    fileExists,
    readJson,
    textValue,
    commandString: (argv) => processScopeRuntime.commandString(argv),
    runArgvStage,
    projectCommandStage,
  };
}

function processHandoffAdapter(): ProcessHandoffAdapter {
  return {
    processExecutable: process.execPath,
    foundryEntryPath,
    repoRoot,
    environment: process.env,
    resolveRepoPath,
    repoRelative,
    fileExists,
    readJson,
    textValue,
    joinPath: (...parts) => path.join(...parts),
    basename: (filePath) => path.basename(filePath),
    listFilesRecursively: listProcessHandoffFiles,
    assertReceiptBoundHandoffAccount,
    assertCommandSpecBindsArtifact: (value, requiredArtifact) =>
      assertFoundryCommandSpecBindsArtifact(value, requiredArtifact),
    assertCommandSpecArtifactsCurrent: (commandSpec) =>
      assertFoundryCommandSpecArtifactsCurrent(commandSpec, resolveRepoPath),
    runCommandSpecStage,
    runArgvStage,
    projectCommandStage,
    commandString: (argv) => processScopeRuntime.commandString(argv),
    retryAttempts: postWriteVerifyRetryAttempts,
    retryDelayMs: postWriteVerifyRetryDelayMs,
    retryReason: postWriteVerifyRetryReason,
    sleep: sleepSync,
    traceHashNormalizationAllowed,
    acceptTraceHashOnlyRemoteVerificationMismatch,
  };
}

function createRunAdapter(): BafuProcessScopeRunAdapter {
  const handoffRuntime = processHandoffAdapter();
  const recoveryRuntime = postFinalizeRecoveryAdapter();
  return {
    clock: { nowIso },
    fs: {
      exists: fileExists,
      mkdir: (directory) => fs.mkdirSync(directory, { recursive: true }),
      readJson,
      readJsonLines,
      readRowsFile,
    },
    path: {
      join: (...parts) => path.join(...parts),
      relative: repoRelativeMaybe,
      resolve: resolveRepoPath,
    },
    hash: {
      fileSha256: (filePath) =>
        crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex"),
      cliPackage: resolveInstalledTiangongLcaCliPackage().packageSpec,
    },
    options: {
      boolean: booleanOption,
      identityReports: processScopeRuntime.processIdentityReportsFromOptions,
      processIdentity: processScopeRuntime.processIdentity,
    },
    ledger: { append: appendLedger },
    stage: {
      project: projectCompactCommandStage,
      runFinalize: runFinalizeStage,
    },
    finalize: {
      build: processScopeRuntime.buildFinalizeCommand,
      project: processScopeRuntime.projectFinalizeReport,
      readGate: processScopeRuntime.readCurationGateReport,
    },
    handoff: {
      appendVerifiedSupportIdentities: processScopeRuntime.appendVerifiedSupportIdentities,
      applySummary: applyBafuProcessScopeHandoffSummary,
      execute: (input) => executeHandoff(input, handoffRuntime),
      loadVerifiedSupportIdentities: processScopeRuntime.loadVerifiedSupportIdentities,
      readPlan: (finalizeReport, key) => readHandoffPlan(finalizeReport, key, handoffRuntime),
      supportIdentityKeys: processScopeRuntime.supportIdentityKeysFromHandoffPlan,
    },
    recovery: {
      canRunIdentity: canRunPostFinalizeIdentityRecovery,
      canRunSemantic: canRunPostFinalizeSemanticRecovery,
      runIdentity: (input) => runPostFinalizeIdentityRecovery(input, recoveryRuntime),
      runSemantic: (input) => runPostFinalizeSemanticRecovery(input, recoveryRuntime),
    },
    report: {
      commandString: processScopeRuntime.commandString,
      rerunCommand: processScopeRuntime.rerunCommand,
      writeJson,
    },
  };
}

function ensureNoRemoteCommitFlags(options: JsonRecord): void {
  const forbidden = ["remoteCommit", "executeCommit", "allowRemoteCommit", "allowRemoteCommits"];
  const requested = forbidden.filter((key) => booleanOption(options[key]));
  if (requested.length > 0) {
    throw new Error(
      `${commandName} only performs remote commits through the explicit --commit handoff path; remove ${requested
        .map((key) => `--${key.replace(/[A-Z]/gu, (letter) => `-${letter.toLowerCase()}`)}`)
        .join(", ")}.`,
    );
  }
}

function runDatasetBafuProcessScopeE2e(options: JsonRecord = {}): JsonRecord {
  if (options.help || options.h) {
    return {
      schema_version: 1,
      status: "help",
      command: commandName,
      usage: [
        "node scripts/foundry.ts dataset-bafu-process-scope-e2e --rows-file <one-process.jsonl> --source-support-rows-file <sources.jsonl> --out-dir <scope-run-dir>",
        "node scripts/foundry.ts dataset-bafu-process-scope-e2e --rows-file <one-process.jsonl> --source-support-rows-file <sources.jsonl> --out-dir <scope-run-dir> --execute",
        "node scripts/foundry.ts dataset-bafu-process-scope-e2e --rows-file <one-process.jsonl> --source-support-rows-file <sources.jsonl> --out-dir <scope-run-dir> --execute --commit-support --commit",
        "node scripts/foundry.ts dataset-bafu-process-scope-e2e --rows-file <one-process.jsonl> --out-dir <scope-run-dir> --execute --commit-support --verified-support-identities-file <cache.jsonl>",
      ],
      purpose:
        "Plan, resume, execute, or explicitly commit the existing Foundry BAFU post-authoring finalize chain for exactly one process scope.",
    };
  }
  ensureNoRemoteCommitFlags(options);
  return createBafuProcessScopeRun({
    commandName,
    reportFileName,
    ledgerFileName,
    adapter: createRunAdapter(),
  }).run(options);
}

export function createBafuProcessScopeE2eCommands(deps: BafuProcessScopeE2eRuntime): {
  runDatasetBafuProcessScopeE2e: typeof runDatasetBafuProcessScopeE2e;
} {
  installBafuProcessScopeE2eRuntime(deps);
  return { runDatasetBafuProcessScopeE2e };
}

export const bafuProcessScopeE2eTestHooks = {
  applyBafuProcessScopeHandoffSummary,
  canRunPostFinalizeIdentityRecovery,
  canRunPostFinalizeSemanticRecovery,
  compactCommandStage: projectCompactCommandStage,
  curationGateBlockers,
  finalizeBlockers,
  foundryEntryPath,
  loadVerifiedSupportIdentities: processScopeRuntime.loadVerifiedSupportIdentities,
  postWriteVerifyRetryReason,
  postWriteVerifyRetryReasonFromReport,
  projectBafuProcessScopeFinalizeReport,
  reportCodes,
  supportIdentityKeysFromHandoffPlan: processScopeRuntime.supportIdentityKeysFromHandoffPlan,
};

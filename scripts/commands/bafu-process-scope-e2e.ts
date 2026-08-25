import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { acceptTraceHashOnlyRemoteVerificationMismatch } from "../lib/remote-verification-accepted-diff.ts";
import {
  assertFoundryCommandSpecArtifactsCurrent,
  assertFoundryCommandSpecBindsArtifact,
  commandSpecOptionValue,
  executeFoundryCommandSpecSync,
  type FoundryArtifactFact,
  type FoundryCommandSpec,
} from "../lib/foundry-command-spec.ts";
import {
  assertReceiptBoundHandoffAccount,
  traceHashNormalizationAllowed,
} from "../lib/production-case-policy.ts";

interface JsonRecord {
  [key: string]: unknown;
}

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

interface CommandStage extends JsonRecord {
  stage: string;
  command: unknown;
  exit_code: number;
  signal?: NodeJS.Signals | null;
  error?: string | null;
  stdout_log?: string | null;
  stderr_log?: string | null;
  report?: unknown;
  attempt?: number;
  max_attempts?: number;
  retry_reason?: string;
  retry_next_delay_ms?: number;
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

interface CompactStageResult {
  status: number | null;
  signal?: NodeJS.Signals | null;
  error?: Error;
}

interface FinalizeCommandResult {
  argv: string[];
  finalizeDir: string;
  finalizeReportPath: string;
}

interface GateBlockerResult {
  gateReport: JsonRecord | null;
  blockers: JsonRecord[];
}

interface RecoveryInput {
  finalizeReport: JsonRecord;
  currentRowsFile: string;
  outDir: string;
  logDir: string;
  attempt: number;
}

interface RecoveryResult extends JsonRecord {
  status: string;
  blocker?: JsonRecord;
  rowsFile?: string;
  identityApplyReport?: string | null;
  patchCollectReport?: string | null;
  patchApplyReport?: string | null;
  stages?: JsonRecord[];
}

interface FinalizeReportInput {
  processScope: JsonRecord;
  outDir: string;
  reportPath: string;
  ledgerPath: string;
  finalizeReport: JsonRecord;
  finalizeReportPath: string;
  finalizeCommand: string[];
  mode: string;
  sourceSupportRowsFile: string | null;
  sourceRowsFile: string | null;
}

interface HandoffResult extends JsonRecord {
  status: string;
  blockers: JsonRecord[];
  stages: JsonRecord[];
  handoffPlan: JsonRecord;
  closeoutReport?: JsonRecord | null;
  commitReportPath?: string;
  verifyReportPath?: string;
  closeoutReportPath?: string;
}

interface ProcessScopeReport extends JsonRecord {
  generated_at_utc: string;
  status: string;
  blockers: JsonRecord[];
  counts: JsonRecord;
  files: JsonRecord;
  policy: JsonRecord;
  handoff_stages?: JsonRecord[];
}

function isJsonRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function jsonRecord(value: unknown): JsonRecord {
  return isJsonRecord(value) ? value : {};
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
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

function repoRelative(filePath: string | null | undefined): string {
  return runtime().repoRelativeMaybe(filePath) as string;
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

function sha256File(filePath: string): string {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function textValue(value: unknown): string {
  return runtime().textValue(value);
}

function processIdentity(row: JsonRecord): { id: string; version: string } {
  const payload = jsonRecord(row.processDataSet ?? row);
  const dataSetInformation =
    jsonRecord(payload.processInformation).dataSetInformation ??
    jsonRecord(payload.processInformation)["common:dataSetInformation"] ??
    {};
  const information = jsonRecord(dataSetInformation);
  const publication =
    jsonRecord(payload.administrativeInformation).publicationAndOwnership ??
    jsonRecord(payload.administrativeInformation)["common:publicationAndOwnership"] ??
    {};
  const publicationRecord = jsonRecord(publication);
  return {
    id:
      textValue(information["common:UUID"]) ||
      textValue(information.UUID) ||
      textValue(row.dataset_id) ||
      textValue(row.id),
    version:
      textValue(publicationRecord["common:dataSetVersion"]) ||
      textValue(publicationRecord.dataSetVersion) ||
      textValue(row.dataset_version) ||
      textValue(row.version) ||
      "00.00.001",
  };
}

function datasetTypeFromRow(row: JsonRecord): string | null {
  if (row.contactDataSet) return "contact";
  if (row.sourceDataSet) return "source";
  return null;
}

function supportIdentity(
  row: JsonRecord,
  fallbackType: string | null,
): { type: string | null; id: string; version: string } {
  const type = datasetTypeFromRow(row) || fallbackType;
  const root = type ? jsonRecord(row[`${type}DataSet`]) : {};
  const information =
    jsonRecord(root[`${type}Information`]).dataSetInformation ??
    jsonRecord(root[`${type}Information`])["common:dataSetInformation"] ??
    {};
  const informationRecord = jsonRecord(information);
  const publication =
    jsonRecord(root.administrativeInformation).publicationAndOwnership ??
    jsonRecord(root.administrativeInformation)["common:publicationAndOwnership"] ??
    {};
  const publicationRecord = jsonRecord(publication);
  return {
    type,
    id:
      textValue(informationRecord["common:UUID"]) ||
      textValue(informationRecord.UUID) ||
      textValue(row.dataset_id) ||
      textValue(row.id),
    version:
      textValue(publicationRecord["common:dataSetVersion"]) ||
      textValue(publicationRecord.dataSetVersion) ||
      textValue(row.dataset_version) ||
      textValue(row.version) ||
      "00.00.001",
  };
}

function supportIdentityKeysFromHandoffPlan(handoffPlan: JsonRecord): string[] {
  const commands = jsonRecord(handoffPlan.commands);
  const inputPath = resolveRepoPath(
    commandSpecOptionValue(commands.commit, "--input") ||
      commandSpecOptionValue(commands.commit, "--input-file"),
  );
  const fallbackType = commandSpecOptionValue(commands.commit, "--type");
  if (!fileExists(inputPath)) return [];
  return readRowsFile(inputPath!)
    .map((row) => {
      const identity = supportIdentity(row, fallbackType);
      if (!identity.type || !["contact", "source"].includes(identity.type) || !identity.id) {
        return null;
      }
      return `${identity.type}:${identity.id}@${identity.version}`;
    })
    .filter((key): key is string => Boolean(key));
}

function supportIdentityKeyFromCacheRow(row: JsonRecord): string | null {
  if (row.identity_key) return String(row.identity_key);
  const type = textValue(row.dataset_type || row.type || textValue(row.table).replace(/s$/u, ""));
  const id = row.dataset_id || row.id;
  const version = row.dataset_version || row.version || "00.00.001";
  return ["contact", "source"].includes(type) && id ? `${type}:${id}@${version}` : null;
}

function loadVerifiedSupportIdentities(cacheFile: unknown): Set<string> {
  const resolved = resolveRepoPath(cacheFile);
  if (!fileExists(resolved)) return new Set();
  return new Set(
    readJsonLines(resolved!)
      .map(supportIdentityKeyFromCacheRow)
      .filter((key): key is string => Boolean(key)),
  );
}

function appendVerifiedSupportIdentities({
  cacheFile,
  identityKeys,
  source,
  report,
}: {
  cacheFile: unknown;
  identityKeys: string[];
  source: string;
  report: string;
}): void {
  const resolved = resolveRepoPath(cacheFile);
  if (!resolved || identityKeys.length === 0) return;
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  for (const identityKey of identityKeys) {
    const match = /^(contact|source):([^@]+)@(.+)$/u.exec(identityKey);
    if (!match) continue;
    appendLedger(resolved, {
      schema_version: 1,
      generated_at_utc: nowIso(),
      identity_key: identityKey,
      dataset_type: match[1],
      dataset_id: match[2],
      dataset_version: match[3],
      status: "verified",
      source,
      report: repoRelative(report),
    });
  }
}

function booleanOption(value: unknown): boolean {
  return runtime().booleanOption(value);
}

function appendOption(args: string[], name: string, value: unknown): void {
  if (value === undefined || value === null || value === "") return;
  if (value === true) {
    args.push(name);
    return;
  }
  args.push(name, String(value));
}

function appendPathOption(args: string[], name: string, value: unknown): void {
  if (!value) return;
  appendOption(args, name, repoRelative(resolveRepoPath(value)));
}

function appendPathOptions(args: string[], name: string, value: unknown): void {
  const values = Array.isArray(value) ? value : String(value ?? "").split(",");
  for (const item of values.map((entry) => String(entry).trim()).filter(Boolean)) {
    appendPathOption(args, name, item);
  }
}

function shellQuote(value: string): string {
  return runtime().shellQuote(value);
}

function commandString(argv: string[]): string {
  return argv.map(shellQuote).join(" ");
}

function helperRerunCommand({
  rowsFile,
  outDir,
  sourceSupportRowsFile,
  sourceRowsFile,
}: {
  rowsFile: string;
  outDir: string;
  sourceSupportRowsFile?: string | null;
  sourceRowsFile?: string | null;
}): string {
  const args = [
    "node",
    "scripts/foundry.ts",
    "dataset-bafu-process-scope-e2e",
    "--rows-file",
    repoRelative(rowsFile) || "<rows.jsonl>",
    "--out-dir",
    repoRelative(outDir),
    "--execute",
  ];
  appendPathOption(args, "--source-support-rows-file", sourceSupportRowsFile);
  appendPathOption(args, "--source-rows-file", sourceRowsFile);
  return commandString(args);
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

function latestLedgerEntry(
  ledgerPath: string,
  predicate: (row: JsonRecord) => boolean,
): JsonRecord | null {
  if (!fileExists(ledgerPath)) return null;
  return readJsonLines(ledgerPath).reverse().find(predicate) ?? null;
}

function appendLedger(ledgerPath: string, row: unknown): void {
  fs.mkdirSync(path.dirname(ledgerPath), { recursive: true });
  fs.appendFileSync(ledgerPath, `${JSON.stringify(row)}\n`);
}

function writeJson(filePath: string, value: unknown): void {
  runtime().writeJson(filePath, value);
}

function compactCommandStage({
  stage,
  command,
  result,
  stdoutLog,
  stderrLog,
  reportPath,
}: {
  stage: string;
  command: unknown;
  result: CompactStageResult;
  stdoutLog: string;
  stderrLog: string;
  reportPath: string | null;
}): CommandStage {
  return {
    stage,
    command,
    exit_code: typeof result.status === "number" ? result.status : 1,
    signal: result.signal ?? null,
    error: result.error ? String(result.error.message || result.error) : null,
    stdout_log: repoRelative(stdoutLog),
    stderr_log: repoRelative(stderrLog),
    report: repoRelative(reportPath),
  };
}

function runCommandSpecStage({ stage, commandSpec, cwd, logDir }: CommandSpecStageInput): {
  result: ReturnType<typeof executeFoundryCommandSpecSync>;
  stdoutLog: string;
  stderrLog: string;
} {
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

function sleepSync(ms: number): void {
  if (!ms || ms <= 0) return;
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
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

const postWriteVerifyRetryableCodes = new Set([
  "lookup_failed",
  "remote_lookup_failed",
  "readback_failed",
  "remote_readback_failed",
  "remote_readback_missing",
  "root_readback_incomplete",
  "post_write_verify_root_readback_incomplete",
  "verify_report_missing",
]);

function collectReportCodes(
  value: unknown,
  codes: Set<string> = new Set(),
  depth = 0,
): Set<string> {
  if (value == null || depth > 6) return codes;
  if (Array.isArray(value)) {
    for (const entry of value) collectReportCodes(entry, codes, depth + 1);
    return codes;
  }
  if (typeof value !== "object") return codes;
  const record = jsonRecord(value);
  for (const key of ["code", "failure_code", "status_code", "readback_status"]) {
    const text = textValue(record[key]);
    if (text) codes.add(text);
  }
  for (const key of ["blockers", "findings", "checks", "results", "rows", "items"]) {
    collectReportCodes(record[key], codes, depth + 1);
  }
  return codes;
}

function postWriteVerifyRetryReason(verifyReportPath: string | null): string | null {
  if (!verifyReportPath || !fileExists(verifyReportPath)) return "verify_report_missing";
  const report = readJson(verifyReportPath);
  const codes = collectReportCodes(report);
  for (const code of codes) {
    if (postWriteVerifyRetryableCodes.has(code)) return code;
  }
  const counts = jsonRecord(report.counts);
  const byStatus = jsonRecord(counts.by_status || counts.statuses);
  for (const code of postWriteVerifyRetryableCodes) {
    if (Number(byStatus?.[code] ?? 0) > 0) return code;
  }
  return null;
}

function runArgvStage({ stage, argv, logDir }: ArgvStageInput): {
  result: ReturnType<typeof spawnSync>;
  stdoutLog: string;
  stderrLog: string;
} {
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

function optionPathList(value: unknown): string[] {
  const values = Array.isArray(value) ? value : String(value ?? "").split(",");
  return values
    .map((entry) => String(entry).trim())
    .filter(Boolean)
    .map(resolveRepoPath)
    .filter((filePath): filePath is string => Boolean(filePath));
}

function processIdentityReportsFromOptions(options: JsonRecord): string[] {
  return optionPathList(
    options.identityDecisionApplyReports ||
      options.identityDecisionsApplyReports ||
      options.identityDecisionApplyReport ||
      options.identityDecisionsApplyReport,
  );
}

function firstExistingPath(candidates: unknown[]): string | null {
  return candidates.map(resolveRepoPath).find(fileExists) ?? null;
}

function findReportFile(rootDir: unknown, predicate: (filePath: string) => boolean): string | null {
  const resolved = resolveRepoPath(rootDir);
  if (!resolved || !fs.existsSync(resolved)) return null;
  const stack = [resolved];
  const matches: string[] = [];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const next = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(next);
      } else if (entry.isFile() && predicate(next)) {
        matches.push(next);
      }
    }
  }
  return matches.sort()[0] ?? null;
}

function commitReportForHandoffPlan(handoffPlan: JsonRecord): string | null {
  const expectedDir = resolveRepoPath(jsonRecord(handoffPlan.files).expected_commit_report_dir);
  return (
    firstExistingPath([
      path.join(
        expectedDir || "",
        "process-save-draft",
        "outputs",
        "save-draft-rpc",
        "summary.json",
      ),
      path.join(
        expectedDir || "",
        "support-save-draft",
        "outputs",
        "dataset-save-draft",
        "summary.json",
      ),
      path.join(
        expectedDir || "",
        "contact-save-draft",
        "outputs",
        "dataset-save-draft",
        "summary.json",
      ),
      path.join(
        expectedDir || "",
        "source-save-draft",
        "outputs",
        "dataset-save-draft",
        "summary.json",
      ),
      path.join(
        expectedDir || "",
        "lifecyclemodel-save-draft",
        "outputs",
        "save-draft-bundle",
        "summary.json",
      ),
    ]) ??
    findReportFile(expectedDir, (filePath) =>
      /(?:summary|sync_report)\.json$/u.test(path.basename(filePath)),
    )
  );
}

function verifyReportForHandoffPlan(handoffPlan: JsonRecord): string | null {
  const expectedDir = resolveRepoPath(jsonRecord(handoffPlan.files).expected_post_write_verify_dir);
  return (
    firstExistingPath([
      path.join(expectedDir || "", "outputs", "remote-verification-report.json"),
    ]) ??
    findReportFile(
      expectedDir,
      (filePath) => path.basename(filePath) === "remote-verification-report.json",
    )
  );
}

function readHandoffPlan(
  finalizeReport: JsonRecord,
  key = "commit_handoff_plan",
): { path: string | null; value: JsonRecord | null } {
  const handoffPath = resolveRepoPath(jsonRecord(finalizeReport.files)[key]);
  if (!fileExists(handoffPath)) {
    return { path: null, value: null };
  }
  return { path: handoffPath!, value: readJson(handoffPath!) };
}

function closeoutCommand({
  handoffPlanPath,
  commitReportPath,
  verifyReportPath,
  outDir,
  ledgerDir,
}: {
  handoffPlanPath: string;
  commitReportPath: string;
  verifyReportPath: string;
  outDir: string;
  ledgerDir: string;
}): string[] {
  const args = [
    process.execPath,
    "scripts/foundry.ts",
    "dataset-post-write-closeout",
    "--handoff-plan",
    repoRelative(handoffPlanPath),
    "--commit-report",
    repoRelative(commitReportPath),
    "--post-write-verify-report",
    repoRelative(verifyReportPath),
    "--out-dir",
    repoRelative(outDir),
    "--ledger-dir",
    repoRelative(ledgerDir),
  ];
  return args;
}

function executeHandoff({
  handoffPlanPath,
  ledgerDir,
  outDir,
  logDir,
  label,
}: {
  handoffPlanPath: string;
  ledgerDir: string;
  outDir: string;
  logDir: string;
  label: string;
}): HandoffResult {
  const handoffPlan = readJson(handoffPlanPath);
  const blockers: JsonRecord[] = [];
  const stages: JsonRecord[] = [];
  if (handoffPlan.status !== "ready_for_explicit_commit") {
    blockers.push({
      code: "handoff_plan_not_ready",
      message: `Handoff plan status is ${handoffPlan.status || "missing"}.`,
      handoff_plan: repoRelative(handoffPlanPath),
    });
    return { status: "blocked", blockers, stages, handoffPlan };
  }
  try {
    assertReceiptBoundHandoffAccount(handoffPlan, process.env);
  } catch (error) {
    blockers.push({
      code: "handoff_account_evidence_mismatch",
      message: String(error instanceof Error ? error.message : error),
      handoff_plan: repoRelative(handoffPlanPath),
    });
    return { status: "blocked", blockers, stages, handoffPlan };
  }
  let commitSpec: FoundryCommandSpec;
  let verifySpec: FoundryCommandSpec;
  try {
    const commands = jsonRecord(handoffPlan.commands);
    const finalRowsArtifact = jsonRecord(handoffPlan.final_rows_artifact);
    const requiredFinalRowsArtifact: FoundryArtifactFact = {
      role: "final_rows",
      path: textValue(finalRowsArtifact.path),
      bytes: Number(finalRowsArtifact.bytes),
      sha256: textValue(finalRowsArtifact.sha256),
    };
    commitSpec = assertFoundryCommandSpecBindsArtifact(commands.commit, requiredFinalRowsArtifact);
    verifySpec = assertFoundryCommandSpecBindsArtifact(
      commands.post_write_verify,
      requiredFinalRowsArtifact,
    );
  } catch (error) {
    blockers.push({
      code: "handoff_command_spec_invalid",
      message: `Handoff plan must include valid authoritative commit and post_write_verify CommandSpecs: ${String(error instanceof Error ? error.message : error)}`,
      handoff_plan: repoRelative(handoffPlanPath),
    });
    return { status: "blocked", blockers, stages, handoffPlan };
  }

  let commitStage: ReturnType<typeof runCommandSpecStage>;
  try {
    assertFoundryCommandSpecArtifactsCurrent(commitSpec, resolveRepoPath);
    commitStage = runCommandSpecStage({
      stage: `${label}.commit`,
      commandSpec: commitSpec,
      cwd: repoRoot,
      logDir,
    });
  } catch (error) {
    blockers.push({
      code: "commit_handoff_artifact_binding_failed",
      message: `Commit CommandSpec artifact binding failed before spawn: ${String(error instanceof Error ? error.message : error)}`,
      handoff_plan: repoRelative(handoffPlanPath),
    });
    return { status: "failed", blockers, stages, handoffPlan };
  }
  const commitReportPath = commitReportForHandoffPlan(handoffPlan);
  stages.push(
    compactCommandStage({
      stage: `${label}.commit`,
      command: commitSpec.display,
      result: commitStage.result,
      stdoutLog: commitStage.stdoutLog,
      stderrLog: commitStage.stderrLog,
      reportPath: commitReportPath,
    }),
  );
  if (commitStage.result.status !== 0 || !commitReportPath) {
    blockers.push({
      code: "commit_handoff_command_failed",
      message: "CLI commit handoff failed or did not emit the expected commit report.",
      handoff_plan: repoRelative(handoffPlanPath),
      exit_code: commitStage.result.status ?? 1,
      commit_report: repoRelative(commitReportPath),
    });
    return { status: "failed", blockers, stages, handoffPlan };
  }

  let verifyReportPath = null;
  let verifyAccepted = false;
  let verifyExitCode = 1;
  let verifyAttempts = 0;
  let verifyRetryReason = null;
  const maxVerifyAttempts = postWriteVerifyRetryAttempts();
  for (let attempt = 1; attempt <= maxVerifyAttempts; attempt += 1) {
    const verifyStageName =
      attempt === 1 ? `${label}.post_write_verify` : `${label}.post_write_verify.retry_${attempt}`;
    let verifyStage: ReturnType<typeof runCommandSpecStage>;
    try {
      verifyStage = runCommandSpecStage({
        stage: verifyStageName,
        commandSpec: verifySpec,
        cwd: repoRoot,
        logDir,
      });
    } catch (error) {
      blockers.push({
        code: "post_write_verify_artifact_binding_failed",
        message: `Verify CommandSpec artifact binding failed before spawn: ${String(error instanceof Error ? error.message : error)}`,
        handoff_plan: repoRelative(handoffPlanPath),
      });
      return { status: "failed", blockers, stages, handoffPlan };
    }
    verifyReportPath = verifyReportForHandoffPlan(handoffPlan);
    verifyExitCode = verifyStage.result.status ?? 1;
    verifyAttempts = attempt;
    const stageReport = compactCommandStage({
      stage: verifyStageName,
      command: verifySpec.display,
      result: verifyStage.result,
      stdoutLog: verifyStage.stdoutLog,
      stderrLog: verifyStage.stderrLog,
      reportPath: verifyReportPath,
    });
    stageReport.attempt = attempt;
    stageReport.max_attempts = maxVerifyAttempts;
    stages.push(stageReport);
    verifyAccepted = verifyStage.result.status === 0 && Boolean(verifyReportPath);
    if (
      verifyStage.result.status !== 0 &&
      verifyReportPath &&
      traceHashNormalizationAllowed(handoffPlan)
    ) {
      const acceptedVerify = acceptTraceHashOnlyRemoteVerificationMismatch({
        verifyReportPath,
        outDir,
        repoRoot,
      });
      if (acceptedVerify.accepted) {
        verifyReportPath = acceptedVerify.verifyReportPath;
        verifyAccepted = true;
        stages.push({
          stage: `${label}.post_write_verify.accepted_diff`,
          status: "accepted",
          report: repoRelative(acceptedVerify.acceptanceReportPath),
          accepted_differences: acceptedVerify.evidence.length,
        });
      }
    }
    if (verifyAccepted) break;
    verifyRetryReason = postWriteVerifyRetryReason(verifyReportPath);
    if (!verifyRetryReason || attempt >= maxVerifyAttempts) break;
    const retryDelayMs = postWriteVerifyRetryDelayMs(attempt - 1);
    stageReport.retry_reason = verifyRetryReason;
    stageReport.retry_next_delay_ms = retryDelayMs;
    sleepSync(retryDelayMs);
  }
  if (!verifyAccepted || !verifyReportPath) {
    blockers.push({
      code: "post_write_verify_command_failed",
      message:
        "CLI post-write verification failed or did not emit the expected remote verification report.",
      handoff_plan: repoRelative(handoffPlanPath),
      exit_code: verifyExitCode,
      post_write_verify_report: repoRelative(verifyReportPath),
      post_write_verify_attempts: verifyAttempts,
      retry_reason: verifyRetryReason,
    });
    return { status: "failed", blockers, stages, handoffPlan };
  }

  const closeoutDir = path.join(outDir, "closeout");
  const closeoutArgv = closeoutCommand({
    handoffPlanPath,
    commitReportPath,
    verifyReportPath,
    outDir: closeoutDir,
    ledgerDir,
  });
  const closeoutStage = runArgvStage({
    stage: `${label}.closeout`,
    argv: closeoutArgv,
    logDir,
  });
  const closeoutReportPath = path.join(closeoutDir, "dataset-post-write-closeout-report.json");
  stages.push(
    compactCommandStage({
      stage: `${label}.closeout`,
      command: commandString(closeoutArgv),
      result: closeoutStage.result,
      stdoutLog: closeoutStage.stdoutLog,
      stderrLog: closeoutStage.stderrLog,
      reportPath: closeoutReportPath,
    }),
  );
  const closeoutReport = fileExists(closeoutReportPath) ? readJson(closeoutReportPath) : null;
  if (closeoutStage.result.status !== 0 || closeoutReport?.status !== "completed") {
    blockers.push({
      code: "post_write_closeout_failed",
      message: `Post-write closeout status is ${closeoutReport?.status || "missing"}.`,
      handoff_plan: repoRelative(handoffPlanPath),
      closeout_report: repoRelative(closeoutReportPath),
      closeout_blockers: closeoutReport?.blockers ?? [],
    });
    return { status: "failed", blockers, stages, handoffPlan, closeoutReport };
  }
  return {
    status: "completed",
    blockers,
    stages,
    handoffPlan,
    closeoutReport,
    commitReportPath,
    verifyReportPath,
    closeoutReportPath,
  };
}

function buildFinalizeCommand({
  options,
  rowsFile,
  outDir,
  importLedgerDir,
}: {
  options: JsonRecord;
  rowsFile: string;
  outDir: string;
  importLedgerDir: string;
}): FinalizeCommandResult {
  const finalizeDir = resolveRepoPath(options.finalizeDir) || path.join(outDir, "finalize");
  const args = [
    process.execPath,
    "scripts/foundry.ts",
    "dataset-post-authoring-finalize",
    "--type",
    "process",
    "--profile",
    "bafu",
    "--rows-file",
    repoRelative(rowsFile),
    "--out-dir",
    repoRelative(finalizeDir),
    "--ledger-dir",
    repoRelative(importLedgerDir),
  ];
  appendPathOption(args, "--source-support-rows-file", options.sourceSupportRowsFile);
  appendPathOption(args, "--source-rows-file", options.sourceRowsFile || options.originalRowsFile);
  appendPathOption(args, "--identity-preflight-index", options.identityPreflightIndex);
  appendPathOption(args, "--schema-file", options.schemaFile);
  appendPathOption(args, "--yaml-file", options.yamlFile);
  appendPathOption(args, "--ruleset-file", options.rulesetFile);
  appendPathOption(args, "--queue-dir", options.queueDir || options.curationQueueDir);
  appendPathOption(args, "--classification-queue", options.classificationQueue);
  appendPathOption(args, "--location-queue", options.locationQueue);
  appendPathOption(
    args,
    "--classification-decision-apply-report",
    options.classificationDecisionApplyReport || options.classificationDecisionsApplyReport,
  );
  appendPathOption(
    args,
    "--location-decision-apply-report",
    options.locationDecisionApplyReport || options.locationDecisionsApplyReport,
  );
  appendPathOptions(
    args,
    "--identity-decision-apply-report",
    options.identityDecisionApplyReports ||
      options.identityDecisionsApplyReports ||
      options.identityDecisionApplyReport ||
      options.identityDecisionsApplyReport,
  );
  appendPathOption(
    args,
    "--patch-collect-report",
    options.patchCollectReport || options.authoringPatchCollectReport,
  );
  appendPathOption(args, "--patch-apply-report", options.patchApplyReport);
  appendOption(args, "--target-user-id", options.targetUserId);
  appendOption(args, "--state-code", options.stateCode);
  appendOption(args, "--root-policy", options.rootPolicy);

  for (const key of [
    ["finalizeSourceContactSupport", "--finalize-source-contact-support"],
    ["verifyRemote", "--verify-remote"],
    ["requireQueueContext", "--require-queue-context"],
    ["runIdentityPreflight", "--run-identity-preflight"],
    ["refreshIdentityPreflight", "--refresh-identity-preflight"],
    ["requirePatchCollectReport", "--require-patch-collect-report"],
  ]) {
    const [optionKey, flag] = key;
    if (Object.hasOwn(options, optionKey)) appendOption(args, flag, options[optionKey]);
  }

  return {
    argv: args,
    finalizeDir,
    finalizeReportPath: path.join(finalizeDir, finalizeReportName),
  };
}

function curationGateBlockers(finalizeReport: JsonRecord): GateBlockerResult {
  const blockers: JsonRecord[] = [];
  const gateReportPath = resolveRepoPath(jsonRecord(finalizeReport.files).curation_gate_report);
  if (!fileExists(gateReportPath)) {
    if (finalizeReport?.status === "ready_for_remote_write") {
      blockers.push({
        code: "curation_gate_report_missing",
        severity: "error",
        message: "Ready BAFU process scope is missing a readable curation gate report.",
      });
    }
    return { gateReport: null, blockers };
  }
  const gateReport = readJson(gateReportPath!);
  const counts = jsonRecord(gateReport.counts);
  const actionItems = Number(counts.action_items ?? 0);
  if (actionItems > 0) {
    blockers.push({
      code: "unresolved_ai_curation_items",
      severity: "error",
      message:
        "BAFU process scope still has unresolved AI curation action items; rerun authoring/apply stages before write planning.",
      action_items: actionItems,
      identity_action_items: Number(counts.identity_action_items ?? 0),
      semantic_action_items: Number(counts.semantic_action_items ?? 0),
      classification_queue_action_items: Number(counts.classification_queue_action_items ?? 0),
      location_queue_action_items: Number(counts.location_queue_action_items ?? 0),
      examples: (Array.isArray(gateReport.entities)
        ? gateReport.entities
        : Array.isArray(gateReport.processes)
          ? gateReport.processes
          : []
      )
        .map(jsonRecord)
        .filter((entity) => Number(entity.action_item_count ?? 0) > 0)
        .slice(0, 5)
        .map((entity) => ({
          dataset_type: entity.dataset_type,
          dataset_id: entity.entity_id ?? entity.process_id,
          action_item_count: entity.action_item_count,
          authoring_package: entity.authoring_package,
        })),
    });
  }
  const deterministicCleanupItems = Number(counts.deterministic_cleanup_items ?? 0);
  if (deterministicCleanupItems > 0) {
    blockers.push({
      code: "unresolved_deterministic_curation_items",
      severity: "error",
      message:
        "BAFU process scope still has deterministic cleanup items; rerun cleanup/finalize before write planning.",
      deterministic_cleanup_items: deterministicCleanupItems,
    });
  }
  if (!["ready", "ready_with_profile_waivers"].includes(String(gateReport.status))) {
    blockers.push({
      code: "curation_gate_not_ready",
      severity: "error",
      message: `Post-authoring curation gate status is ${gateReport.status || "missing"}.`,
      curation_gate_status: gateReport.status ?? null,
    });
  }
  return { gateReport, blockers };
}

function canRunPostFinalizeIdentityRecovery(finalizeReport: JsonRecord): boolean {
  const gateReportPath = resolveRepoPath(jsonRecord(finalizeReport.files).curation_gate_report);
  if (!fileExists(gateReportPath)) return false;
  const gateReport = readJson(gateReportPath!);
  const counts = jsonRecord(gateReport.counts);
  return (
    Number(counts.identity_action_items ?? 0) > 0 &&
    Number(counts.semantic_action_items ?? 0) === 0 &&
    Number(counts.classification_queue_action_items ?? 0) === 0 &&
    Number(counts.location_queue_action_items ?? 0) === 0
  );
}

function canRunPostFinalizeSemanticRecovery(finalizeReport: JsonRecord): boolean {
  const gateReportPath = resolveRepoPath(jsonRecord(finalizeReport.files).curation_gate_report);
  if (!fileExists(gateReportPath)) return false;
  const gateReport = readJson(gateReportPath!);
  const counts = jsonRecord(gateReport.counts);
  return (
    Number(counts.semantic_action_items ?? 0) > 0 &&
    Number(counts.identity_action_items ?? 0) === 0 &&
    Number(counts.classification_queue_action_items ?? 0) === 0 &&
    Number(counts.location_queue_action_items ?? 0) === 0
  );
}

function runPostFinalizeIdentityRecovery({
  finalizeReport,
  currentRowsFile,
  outDir,
  logDir,
  attempt,
}: RecoveryInput): RecoveryResult {
  const gateReportPath = resolveRepoPath(jsonRecord(finalizeReport.files).curation_gate_report);
  if (!fileExists(gateReportPath)) {
    return {
      status: "blocked",
      blocker: {
        code: "post_finalize_curation_gate_report_missing",
        message: "Post-finalize identity recovery requires a readable curation gate report.",
      },
    };
  }
  const identityTaskDir = path.join(outDir, `post-finalize-${attempt}-identity-task`);
  const identityTaskReport = path.join(identityTaskDir, "identity-decision-task-report.json");
  const identityTask = runArgvStage({
    stage: `post-finalize-${attempt}.identity-task`,
    argv: [
      process.execPath,
      "scripts/foundry.ts",
      "dataset-identity-decision-task-build",
      "--curation-gate-report",
      repoRelative(gateReportPath),
      "--out-dir",
      repoRelative(identityTaskDir),
      "--shared-context-cache-dir",
      repoRelative(path.join(outDir, "shared-context-cache")),
    ],
    logDir,
  });
  if (!fileExists(identityTaskReport)) {
    return {
      status: "blocked",
      stages: [
        compactCommandStage({
          stage: `post-finalize-${attempt}.identity-task`,
          command: commandString([
            process.execPath,
            "scripts/foundry.ts",
            "dataset-identity-decision-task-build",
          ]),
          result: identityTask.result,
          stdoutLog: identityTask.stdoutLog,
          stderrLog: identityTask.stderrLog,
          reportPath: identityTaskReport,
        }),
      ],
      blocker: {
        code: "post_finalize_identity_task_report_missing",
        message: "Post-finalize identity task did not emit its report.",
      },
    };
  }
  const identityTaskJson = readJson(identityTaskReport);
  const stages: JsonRecord[] = [
    compactCommandStage({
      stage: `post-finalize-${attempt}.identity-task`,
      command: commandString([
        process.execPath,
        "scripts/foundry.ts",
        "dataset-identity-decision-task-build",
        "--curation-gate-report",
        repoRelative(gateReportPath),
        "--out-dir",
        repoRelative(identityTaskDir),
      ]),
      result: identityTask.result,
      stdoutLog: identityTask.stdoutLog,
      stderrLog: identityTask.stderrLog,
      reportPath: identityTaskReport,
    }),
  ];
  if (identityTaskJson.status === "ready_no_identity_actions") {
    return {
      status: "completed_noop",
      rowsFile: currentRowsFile,
      identityApplyReport: null,
      stages,
    };
  }
  if (identityTaskJson.status !== "ready_for_ai_identity_decisions") {
    return {
      status: "blocked",
      stages,
      blocker: {
        code: "post_finalize_identity_task_not_ready",
        message: `Post-finalize identity task status is ${identityTaskJson.status || "missing"}.`,
        identity_task_status: identityTaskJson.status ?? null,
        blockers: identityTaskJson.blockers ?? [],
      },
    };
  }

  const identityAutofillReport = path.join(
    identityTaskDir,
    "bafu-identity-decisions-autofill-report.json",
  );
  const identityAutofillArgv = [
    process.execPath,
    "scripts/foundry.ts",
    "dataset-bafu-identity-decisions-autofill",
    "--identity-decision-task",
    repoRelative(path.join(identityTaskDir, "identity-decision-task.json")),
  ];
  const identityAutofill = runArgvStage({
    stage: `post-finalize-${attempt}.identity-autofill`,
    argv: identityAutofillArgv,
    logDir,
  });
  stages.push(
    compactCommandStage({
      stage: `post-finalize-${attempt}.identity-autofill`,
      command: commandString(identityAutofillArgv),
      result: identityAutofill.result,
      stdoutLog: identityAutofill.stdoutLog,
      stderrLog: identityAutofill.stderrLog,
      reportPath: identityAutofillReport,
    }),
  );
  if (!fileExists(identityAutofillReport)) {
    return {
      status: "blocked",
      stages,
      blocker: {
        code: "post_finalize_identity_autofill_report_missing",
        message: "Post-finalize BAFU identity autofill did not emit its report.",
      },
    };
  }
  const identityAutofillJson = readJson(identityAutofillReport);
  if (
    !["completed", "completed_with_manual_review"].includes(textValue(identityAutofillJson.status))
  ) {
    return {
      status: "blocked",
      stages,
      blocker: {
        code: "post_finalize_identity_autofill_not_completed",
        message: `Post-finalize BAFU identity autofill status is ${identityAutofillJson.status || "missing"}.`,
        blockers: identityAutofillJson.blockers ?? identityAutofillJson.blocked ?? [],
      },
    };
  }

  const identityApplyDir = path.join(outDir, `post-finalize-${attempt}-identity-apply`);
  const identityApplyReport = path.join(identityApplyDir, "identity-decisions-apply-report.json");
  const identityApplyArgv = [
    process.execPath,
    "scripts/foundry.ts",
    "dataset-identity-decisions-apply",
    "--type",
    "process",
    "--rows-file",
    repoRelative(currentRowsFile),
    "--decisions",
    repoRelative(path.join(identityTaskDir, "identity-decisions.jsonl")),
    "--out-dir",
    repoRelative(identityApplyDir),
    "--authoring-package-dir",
    repoRelative(path.join(identityTaskDir, "authoring-package-snapshots")),
  ];
  const identityApply = runArgvStage({
    stage: `post-finalize-${attempt}.identity-apply`,
    argv: identityApplyArgv,
    logDir,
  });
  stages.push(
    compactCommandStage({
      stage: `post-finalize-${attempt}.identity-apply`,
      command: commandString(identityApplyArgv),
      result: identityApply.result,
      stdoutLog: identityApply.stdoutLog,
      stderrLog: identityApply.stderrLog,
      reportPath: identityApplyReport,
    }),
  );
  if (!fileExists(identityApplyReport)) {
    return {
      status: "blocked",
      stages,
      blocker: {
        code: "post_finalize_identity_apply_report_missing",
        message: "Post-finalize identity decisions apply did not emit its report.",
      },
    };
  }
  const identityApplyJson = readJson(identityApplyReport);
  if (identityApplyJson.status !== "completed") {
    return {
      status: "blocked",
      stages,
      blocker: {
        code: "post_finalize_identity_apply_not_completed",
        message: `Post-finalize identity apply status is ${identityApplyJson.status || "missing"}.`,
        blockers: identityApplyJson.blockers ?? [],
      },
    };
  }
  return {
    status: "completed",
    rowsFile: resolveRepoPath(jsonRecord(identityApplyJson.files).output_rows) || currentRowsFile,
    identityApplyReport,
    stages,
  };
}

function runPostFinalizeSemanticRecovery({
  finalizeReport,
  currentRowsFile,
  outDir,
  logDir,
  attempt,
}: RecoveryInput): RecoveryResult {
  const gateReportPath = resolveRepoPath(jsonRecord(finalizeReport.files).curation_gate_report);
  if (!fileExists(gateReportPath)) {
    return {
      status: "blocked",
      blocker: {
        code: "post_finalize_curation_gate_report_missing",
        message: "Post-finalize semantic recovery requires a readable curation gate report.",
      },
    };
  }

  const authoringDir = path.join(outDir, `post-finalize-${attempt}-semantic-task`);
  const taskManifest = path.join(authoringDir, "authoring-task-manifest.json");
  const taskBuildArgv = [
    process.execPath,
    "scripts/foundry.ts",
    "dataset-authoring-task-build",
    "--curation-gate-report",
    repoRelative(gateReportPath),
    "--out-dir",
    repoRelative(authoringDir),
    "--shared-context-cache-dir",
    repoRelative(path.join(outDir, "shared-context-cache")),
  ];
  const taskBuild = runArgvStage({
    stage: `post-finalize-${attempt}.semantic-task`,
    argv: taskBuildArgv,
    logDir,
  });
  const stages: JsonRecord[] = [
    compactCommandStage({
      stage: `post-finalize-${attempt}.semantic-task`,
      command: commandString(taskBuildArgv),
      result: taskBuild.result,
      stdoutLog: taskBuild.stdoutLog,
      stderrLog: taskBuild.stderrLog,
      reportPath: taskManifest,
    }),
  ];
  if (!fileExists(taskManifest)) {
    return {
      status: "blocked",
      stages,
      blocker: {
        code: "post_finalize_semantic_task_report_missing",
        message: "Post-finalize semantic authoring task did not emit its manifest.",
      },
    };
  }
  const taskBuildJson = readJson(taskManifest);
  if (taskBuildJson.status === "ready_no_action_items") {
    return {
      status: "completed_noop",
      rowsFile: currentRowsFile,
      patchCollectReport: null,
      patchApplyReport: null,
      stages,
    };
  }
  if (taskBuildJson.status !== "ready_for_ai_authoring_batch") {
    return {
      status: "blocked",
      stages,
      blocker: {
        code: "post_finalize_semantic_task_not_ready",
        message: `Post-finalize semantic authoring task status is ${taskBuildJson.status || "missing"}.`,
        authoring_task_status: taskBuildJson.status ?? null,
        blockers: taskBuildJson.blockers ?? [],
      },
    };
  }

  const patchAutofillReport = path.join(
    authoringDir,
    "bafu-authoring-patches-autofill-report.json",
  );
  const patchAutofillArgv = [
    process.execPath,
    "scripts/foundry.ts",
    "dataset-bafu-authoring-patches-autofill",
    "--task-manifest",
    repoRelative(taskManifest),
  ];
  const patchAutofill = runArgvStage({
    stage: `post-finalize-${attempt}.patch-autofill`,
    argv: patchAutofillArgv,
    logDir,
  });
  stages.push(
    compactCommandStage({
      stage: `post-finalize-${attempt}.patch-autofill`,
      command: commandString(patchAutofillArgv),
      result: patchAutofill.result,
      stdoutLog: patchAutofill.stdoutLog,
      stderrLog: patchAutofill.stderrLog,
      reportPath: patchAutofillReport,
    }),
  );
  if (!fileExists(patchAutofillReport)) {
    return {
      status: "blocked",
      stages,
      blocker: {
        code: "post_finalize_semantic_patch_autofill_report_missing",
        message: "Post-finalize BAFU semantic patch autofill did not emit its report.",
      },
    };
  }
  const patchAutofillJson = readJson(patchAutofillReport);
  if (
    !["completed", "completed_no_supported_patches"].includes(textValue(patchAutofillJson.status))
  ) {
    return {
      status: "blocked",
      stages,
      blocker: {
        code: "post_finalize_semantic_patch_autofill_not_completed",
        message: `Post-finalize BAFU semantic patch autofill status is ${patchAutofillJson.status || "missing"}.`,
        blockers: patchAutofillJson.blockers ?? patchAutofillJson.blocked ?? [],
      },
    };
  }

  const patchCollectReport = path.join(authoringDir, "authoring-patch-collect-report.json");
  const patchCollectArgv = [
    process.execPath,
    "scripts/foundry.ts",
    "dataset-authoring-patch-collect",
    "--task-manifest",
    repoRelative(taskManifest),
  ];
  const patchCollect = runArgvStage({
    stage: `post-finalize-${attempt}.patch-collect`,
    argv: patchCollectArgv,
    logDir,
  });
  stages.push(
    compactCommandStage({
      stage: `post-finalize-${attempt}.patch-collect`,
      command: commandString(patchCollectArgv),
      result: patchCollect.result,
      stdoutLog: patchCollect.stdoutLog,
      stderrLog: patchCollect.stderrLog,
      reportPath: patchCollectReport,
    }),
  );
  if (!fileExists(patchCollectReport)) {
    return {
      status: "blocked",
      stages,
      blocker: {
        code: "post_finalize_semantic_patch_collect_report_missing",
        message: "Post-finalize semantic patch collect did not emit its report.",
      },
    };
  }
  const patchCollectJson = readJson(patchCollectReport);
  if (patchCollectJson.status === "ready_no_patch_required") {
    return {
      status: "completed_noop",
      rowsFile: currentRowsFile,
      patchCollectReport,
      patchApplyReport: null,
      stages,
    };
  }
  if (patchCollectJson.status !== "ready_for_patch_apply") {
    return {
      status: "blocked",
      stages,
      blocker: {
        code: "post_finalize_semantic_patch_collect_not_ready",
        message: `Post-finalize semantic patch collect status is ${patchCollectJson.status || "missing"}.`,
        blockers: patchCollectJson.blockers ?? [],
      },
    };
  }

  const patchedRowsFile = path.join(authoringDir, "processes.patched.jsonl");
  const patchApplyDir = path.join(authoringDir, "patch-apply");
  const patchApplyArgv = [
    process.execPath,
    "scripts/foundry.ts",
    "dataset-patch-apply",
    "--input",
    repoRelative(currentRowsFile),
    "--patch",
    repoRelative(
      textValue(jsonRecord(patchCollectJson.files).batch_patch) ||
        path.join(authoringDir, "ai-patches.batch.json"),
    ),
    "--out",
    repoRelative(patchedRowsFile),
    "--out-dir",
    repoRelative(patchApplyDir),
    "--authoring-package-dir",
    repoRelative(path.join(authoringDir, "authoring-package-snapshots")),
    "--require-authoring-package",
    "--require-action-item-closure",
  ];
  const patchApply = runArgvStage({
    stage: `post-finalize-${attempt}.patch-apply`,
    argv: patchApplyArgv,
    logDir,
  });
  const patchApplyReport = path.join(patchApplyDir, "outputs", "dataset-patch-apply-report.json");
  stages.push(
    compactCommandStage({
      stage: `post-finalize-${attempt}.patch-apply`,
      command: commandString(patchApplyArgv),
      result: patchApply.result,
      stdoutLog: patchApply.stdoutLog,
      stderrLog: patchApply.stderrLog,
      reportPath: patchApplyReport,
    }),
  );
  if (!fileExists(patchApplyReport)) {
    return {
      status: "blocked",
      stages,
      blocker: {
        code: "post_finalize_semantic_patch_apply_report_missing",
        message: "Post-finalize semantic patch apply did not emit its report.",
      },
    };
  }
  const patchApplyJson = readJson(patchApplyReport);
  if (patchApplyJson.status !== "completed") {
    return {
      status: "blocked",
      stages,
      blocker: {
        code: "post_finalize_semantic_patch_apply_not_completed",
        message: `Post-finalize semantic patch apply status is ${patchApplyJson.status || "missing"}.`,
        blockers: patchApplyJson.blockers ?? [],
      },
    };
  }

  return {
    status: "completed",
    rowsFile: resolveRepoPath(jsonRecord(patchApplyJson.files).patched_rows) || patchedRowsFile,
    patchCollectReport,
    patchApplyReport,
    stages,
  };
}

function finalizeBlockers(finalizeReport: JsonRecord): JsonRecord[] {
  const blockers: JsonRecord[] = [];
  const commitHandoff = jsonRecord(finalizeReport.commit_handoff);
  if (finalizeReport.status !== "ready_for_remote_write") {
    blockers.push({
      code: "post_authoring_finalize_not_ready",
      severity: "error",
      message: `Post-authoring finalize status is ${finalizeReport.status || "missing"}.`,
      finalize_status: finalizeReport.status ?? null,
    });
  }
  if (commitHandoff.status !== "ready_for_explicit_commit") {
    blockers.push({
      code: "commit_handoff_not_ready",
      severity: "error",
      message: `Commit handoff status is ${commitHandoff.status || "missing"}.`,
      commit_handoff_status: commitHandoff.status ?? null,
      commit_handoff_blockers: commitHandoff.blockers ?? [],
    });
  }
  return blockers.concat(
    Array.isArray(finalizeReport.blockers) ? finalizeReport.blockers.map(jsonRecord) : [],
  );
}

function reportFromFinalize({
  processScope,
  outDir,
  reportPath,
  ledgerPath,
  finalizeReport,
  finalizeReportPath,
  finalizeCommand,
  mode,
  sourceSupportRowsFile,
  sourceRowsFile,
}: FinalizeReportInput): ProcessScopeReport {
  const { gateReport, blockers: gateBlockers } = curationGateBlockers(finalizeReport);
  const otherBlockers = finalizeBlockers(finalizeReport);
  const blockers = [...gateBlockers, ...otherBlockers];
  const gateCounts = jsonRecord(gateReport?.counts);
  const finalizeCounts = jsonRecord(finalizeReport.counts);
  const commitHandoff = jsonRecord(finalizeReport.commit_handoff);
  const finalizeFiles = jsonRecord(finalizeReport.files);
  const unresolvedAi = gateBlockers.some(
    (blocker) => blocker.code === "unresolved_ai_curation_items",
  );
  const status =
    blockers.length === 0
      ? "ready_for_explicit_commit"
      : unresolvedAi
        ? "blocked_unresolved_ai_curation"
        : "blocked";
  return {
    schema_version: 1,
    generated_at_utc: nowIso(),
    command: commandName,
    status,
    mode,
    profile: "bafu",
    process_scope: processScope,
    policy: {
      uses_existing_foundry_commands: true,
      existing_command: "dataset-post-authoring-finalize",
      remote_commit_executed: false,
      remote_commit_boundary:
        "This helper executes emitted commit handoff commands only when --commit is explicit and finalize is ready; otherwise it is read-only.",
      unresolved_ai_curation_items_hard_block: true,
      one_process_scope_only: true,
    },
    counts: {
      blockers: blockers.length,
      ai_action_items: Number(gateCounts.action_items ?? 0),
      deterministic_cleanup_items: Number(gateCounts.deterministic_cleanup_items ?? 0),
      finalize_blockers: Number(finalizeCounts.blockers ?? 0),
      commit_handoff_blockers: Number(finalizeCounts.commit_handoff_blockers ?? 0),
    },
    blockers,
    commands: {
      post_authoring_finalize: commandString(finalizeCommand),
      commit_handoff: commitHandoff.command ?? null,
      post_write_verify: commitHandoff.post_write_verify_command ?? null,
    },
    inputs: {
      source_support_rows_file: repoRelative(sourceSupportRowsFile),
      source_rows_file: repoRelative(sourceRowsFile),
    },
    files: {
      report: repoRelative(reportPath),
      run_ledger: repoRelative(ledgerPath),
      finalize_report: repoRelative(finalizeReportPath),
      curation_gate_report: finalizeFiles.curation_gate_report ?? null,
      mutation_manifest: finalizeFiles.mutation_manifest ?? null,
      commit_handoff_plan: finalizeFiles.commit_handoff_plan ?? null,
      import_ledger: finalizeFiles.import_ledger ?? null,
    },
    resume: {
      rerun_command: helperRerunCommand({
        rowsFile: resolveRepoPath(finalizeReport.rows_file)!,
        outDir,
        sourceSupportRowsFile,
        sourceRowsFile,
      }),
      reused_existing_finalize_report: mode === "resume",
    },
  };
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
  const profile = String(options.profile || "bafu")
    .trim()
    .toLowerCase();
  if (profile !== "bafu") {
    throw new Error(`${commandName} is intentionally scoped to --profile bafu.`);
  }
  const rowsFile = resolveRepoPath(options.rowsFile || options.rows || options.input);
  if (!fileExists(rowsFile)) {
    throw new Error("--rows-file is required and must point to one process row file.");
  }
  const rows = readRowsFile(rowsFile!);
  if (rows.length !== 1) {
    throw new Error(`--rows-file must contain exactly one process row; found ${rows.length}.`);
  }
  const processScope = processIdentity(rows[0]);
  if (!processScope.id) {
    throw new Error("--rows-file must contain a process UUID or dataset_id.");
  }
  const outDir = resolveRepoPath(
    options.outDir ||
      path.join(".foundry", "workspaces", "bafu-process-scope-e2e", processScope.id),
  )!;
  fs.mkdirSync(outDir, { recursive: true });
  const reportPath = path.join(outDir, reportFileName);
  const ledgerPath = path.join(outDir, ledgerFileName);
  const importLedgerDir = resolveRepoPath(
    options.ledgerDir || options.importLedgerDir || path.join(outDir, "import-ledger"),
  )!;
  const sourceSupportRowsFile = resolveRepoPath(options.sourceSupportRowsFile);
  if (options.sourceSupportRowsFile && !fileExists(sourceSupportRowsFile)) {
    throw new Error("--source-support-rows-file must point to a readable rows file.");
  }
  const sourceRowsFile = resolveRepoPath(options.sourceRowsFile || options.originalRowsFile);
  if ((options.sourceRowsFile || options.originalRowsFile) && !fileExists(sourceRowsFile)) {
    throw new Error("--source-rows-file must point to a readable rows file when provided.");
  }
  const inputHashes = {
    rows_file_sha256: sha256File(rowsFile!),
    source_support_rows_file_sha256: sourceSupportRowsFile
      ? sha256File(sourceSupportRowsFile)
      : null,
    source_rows_file_sha256: sourceRowsFile ? sha256File(sourceRowsFile) : null,
  };
  let currentRowsFile = rowsFile!;
  let currentIdentityReports = processIdentityReportsFromOptions(options);
  let currentPatchCollectReport = resolveRepoPath(
    options.patchCollectReport || options.authoringPatchCollectReport,
  );
  let currentPatchApplyReport = resolveRepoPath(options.patchApplyReport);
  let finalizePlan = buildFinalizeCommand({
    options,
    rowsFile: currentRowsFile,
    outDir,
    importLedgerDir,
  });
  const explicitFinalizeReportPath = resolveRepoPath(options.finalizeReport);
  let finalizeReportPath = explicitFinalizeReportPath || finalizePlan.finalizeReportPath;
  let finalizeCommand = finalizePlan.argv;
  const resume = !Object.hasOwn(options, "resume") || booleanOption(options.resume);
  const previous = resume
    ? latestLedgerEntry(
        ledgerPath,
        (row) =>
          row.stage === "post_authoring_finalize" &&
          jsonRecord(row.input_hashes).rows_file_sha256 === inputHashes.rows_file_sha256 &&
          jsonRecord(row.input_hashes).source_support_rows_file_sha256 ===
            inputHashes.source_support_rows_file_sha256 &&
          jsonRecord(row.input_hashes).source_rows_file_sha256 ===
            inputHashes.source_rows_file_sha256 &&
          fileExists(resolveRepoPath(jsonRecord(row.files).finalize_report)),
      )
    : null;
  const existingFinalizeReportPath = previous
    ? resolveRepoPath(jsonRecord(previous.files).finalize_report)
    : fileExists(finalizeReportPath)
      ? finalizeReportPath
      : null;

  if (existingFinalizeReportPath && !booleanOption(options.force)) {
    const finalizeReport = readJson(existingFinalizeReportPath);
    const report = reportFromFinalize({
      processScope,
      outDir,
      reportPath,
      ledgerPath,
      finalizeReport,
      finalizeReportPath: existingFinalizeReportPath,
      finalizeCommand,
      mode: previous ? "resume" : "existing-report",
      sourceSupportRowsFile,
      sourceRowsFile,
    });
    appendLedger(ledgerPath, {
      schema_version: 1,
      generated_at_utc: report.generated_at_utc,
      command: commandName,
      stage: "resume",
      state: report.status,
      process_scope: processScope,
      input_hashes: inputHashes,
      files: {
        report: repoRelative(reportPath),
        finalize_report: repoRelative(existingFinalizeReportPath),
      },
      blockers: report.blockers,
    });
    writeJson(reportPath, report);
    return report;
  }

  if (!booleanOption(options.execute)) {
    const report = {
      schema_version: 1,
      generated_at_utc: nowIso(),
      command: commandName,
      status: "planned",
      profile: "bafu",
      process_scope: processScope,
      policy: {
        uses_existing_foundry_commands: true,
        existing_command: "dataset-post-authoring-finalize",
        remote_commit_executed: false,
        unresolved_ai_curation_items_hard_block: true,
        one_process_scope_only: true,
      },
      counts: {
        blockers: 0,
      },
      blockers: [],
      commands: {
        post_authoring_finalize: commandString(finalizeCommand),
      },
      inputs: {
        rows_file: repoRelative(rowsFile),
        source_support_rows_file: repoRelative(sourceSupportRowsFile),
        source_rows_file: repoRelative(sourceRowsFile),
      },
      files: {
        report: repoRelative(reportPath),
        run_ledger: repoRelative(ledgerPath),
        expected_finalize_report: repoRelative(finalizeReportPath),
        import_ledger_dir: repoRelative(importLedgerDir),
      },
      resume: {
        rerun_command: helperRerunCommand({
          rowsFile: rowsFile!,
          outDir,
          sourceSupportRowsFile,
          sourceRowsFile,
        }),
      },
    };
    appendLedger(ledgerPath, {
      schema_version: 1,
      generated_at_utc: report.generated_at_utc,
      command: commandName,
      stage: "plan",
      state: "planned",
      process_scope: processScope,
      input_hashes: inputHashes,
      files: {
        report: repoRelative(reportPath),
        expected_finalize_report: repoRelative(finalizeReportPath),
      },
    });
    writeJson(reportPath, report);
    return report;
  }

  const logDir = path.join(outDir, "logs");
  fs.mkdirSync(logDir, { recursive: true });
  let result = spawnSync(finalizeCommand[0], finalizeCommand.slice(1), {
    cwd: repoRoot,
    env: process.env,
    encoding: "utf8",
  });
  const stdoutLog = path.join(logDir, "post-authoring-finalize.stdout.log");
  const stderrLog = path.join(logDir, "post-authoring-finalize.stderr.log");
  fs.writeFileSync(stdoutLog, result.stdout || "");
  fs.writeFileSync(stderrLog, result.stderr || "");
  if (!fileExists(finalizeReportPath)) {
    const failedReport = {
      schema_version: 1,
      generated_at_utc: nowIso(),
      command: commandName,
      status: "failed",
      profile: "bafu",
      process_scope: processScope,
      counts: { blockers: 1 },
      blockers: [
        {
          code: "post_authoring_finalize_failed_without_report",
          severity: "error",
          message: "Existing Foundry finalize command failed before writing its report.",
          exit_code: result.status ?? 1,
          error: result.error ? String(result.error.message || result.error) : null,
        },
      ],
      commands: {
        post_authoring_finalize: commandString(finalizeCommand),
      },
      files: {
        report: repoRelative(reportPath),
        run_ledger: repoRelative(ledgerPath),
        stdout_log: repoRelative(stdoutLog),
        stderr_log: repoRelative(stderrLog),
      },
    };
    appendLedger(ledgerPath, {
      schema_version: 1,
      generated_at_utc: failedReport.generated_at_utc,
      command: commandName,
      stage: "post_authoring_finalize",
      state: "failed",
      process_scope: processScope,
      input_hashes: inputHashes,
      exit_code: result.status ?? 1,
      files: failedReport.files,
      blockers: failedReport.blockers,
    });
    writeJson(reportPath, failedReport);
    return failedReport;
  }
  let finalizeReport = readJson(finalizeReportPath);
  const handoffStages: JsonRecord[] = [];
  const handoffBlockers: JsonRecord[] = [];
  let supportCommitted = false;
  let supportReused = false;
  if (booleanOption(options.commitSupport)) {
    const supportHandoff = readHandoffPlan(
      finalizeReport,
      "source_contact_support_commit_handoff_plan",
    );
    if (supportHandoff.path) {
      const supportIdentityKeys = supportIdentityKeysFromHandoffPlan(
        jsonRecord(supportHandoff.value),
      );
      const supportCacheFile =
        options.verifiedSupportIdentitiesFile || options.supportIdentityCache || null;
      const cachedSupportIdentities = loadVerifiedSupportIdentities(supportCacheFile);
      const canReuseSupport =
        supportIdentityKeys.length > 0 &&
        supportIdentityKeys.every((identityKey) => cachedSupportIdentities.has(identityKey));
      if (canReuseSupport) {
        supportReused = true;
        supportCommitted = true;
        const reuseReportPath = path.join(
          outDir,
          "source-contact-support-handoff",
          "reused-support-identities.json",
        );
        writeJson(reuseReportPath, {
          schema_version: 1,
          generated_at_utc: nowIso(),
          status: "reused_verified_support_identities",
          handoff_plan: repoRelative(supportHandoff.path),
          support_identity_cache: repoRelative(resolveRepoPath(supportCacheFile)),
          support_identities: supportIdentityKeys,
        });
        handoffStages.push({
          stage: "support.reuse_verified",
          status: "skipped",
          report: repoRelative(reuseReportPath),
          support_identities: supportIdentityKeys,
        });
      } else {
        const supportResult = executeHandoff({
          handoffPlanPath: supportHandoff.path,
          ledgerDir: importLedgerDir,
          outDir: path.join(outDir, "source-contact-support-handoff"),
          logDir,
          label: "support",
        });
        handoffStages.push(...supportResult.stages);
        handoffBlockers.push(...supportResult.blockers);
        supportCommitted = supportResult.status === "completed";
        if (supportCommitted && !handoffBlockers.length) {
          appendVerifiedSupportIdentities({
            cacheFile: supportCacheFile,
            identityKeys: supportIdentityKeys,
            source: "process_scope_e2e.support_handoff",
            report: supportResult.closeoutReportPath!,
          });
        }
      }
      if (supportCommitted && !handoffBlockers.length) {
        const rerun = spawnSync(finalizeCommand[0], finalizeCommand.slice(1), {
          cwd: repoRoot,
          env: process.env,
          encoding: "utf8",
        });
        const rerunStdoutLog = path.join(
          logDir,
          "post-authoring-finalize-after-support.stdout.log",
        );
        const rerunStderrLog = path.join(
          logDir,
          "post-authoring-finalize-after-support.stderr.log",
        );
        fs.writeFileSync(rerunStdoutLog, rerun.stdout || "");
        fs.writeFileSync(rerunStderrLog, rerun.stderr || "");
        handoffStages.push(
          compactCommandStage({
            stage: "process.finalize_after_support",
            command: commandString(finalizeCommand),
            result: rerun,
            stdoutLog: rerunStdoutLog,
            stderrLog: rerunStderrLog,
            reportPath: finalizeReportPath,
          }),
        );
        if (fileExists(finalizeReportPath)) {
          finalizeReport = readJson(finalizeReportPath);
        }
      }
    }
  }

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    if (finalizeReport?.status === "ready_for_remote_write") break;
    let recovery = null;
    let recoveryKind = null;
    if (canRunPostFinalizeIdentityRecovery(finalizeReport)) {
      recoveryKind = "identity";
      recovery = runPostFinalizeIdentityRecovery({
        finalizeReport,
        currentRowsFile,
        outDir,
        logDir,
        attempt,
      });
    } else if (canRunPostFinalizeSemanticRecovery(finalizeReport)) {
      recoveryKind = "semantic";
      recovery = runPostFinalizeSemanticRecovery({
        finalizeReport,
        currentRowsFile,
        outDir,
        logDir,
        attempt,
      });
    } else {
      break;
    }
    handoffStages.push(...(recovery.stages ?? []));
    if (!["completed", "completed_noop"].includes(recovery.status)) {
      handoffBlockers.push(
        recovery.blocker ?? {
          code: `post_finalize_${recoveryKind}_recovery_failed`,
          message: `Post-finalize ${recoveryKind} recovery did not complete.`,
        },
      );
      break;
    }
    currentRowsFile = recovery.rowsFile || currentRowsFile;
    if (recovery.identityApplyReport) currentIdentityReports.push(recovery.identityApplyReport);
    if (recovery.patchCollectReport) currentPatchCollectReport = recovery.patchCollectReport;
    if (recovery.patchApplyReport) currentPatchApplyReport = recovery.patchApplyReport;
    finalizePlan = buildFinalizeCommand({
      options: {
        ...options,
        identityDecisionApplyReports: currentIdentityReports,
        patchCollectReport: currentPatchCollectReport,
        patchApplyReport: currentPatchApplyReport,
      },
      rowsFile: currentRowsFile,
      outDir,
      importLedgerDir,
    });
    finalizeReportPath = explicitFinalizeReportPath || finalizePlan.finalizeReportPath;
    finalizeCommand = finalizePlan.argv;
    result = spawnSync(finalizeCommand[0], finalizeCommand.slice(1), {
      cwd: repoRoot,
      env: process.env,
      encoding: "utf8",
    });
    const recoveryStderrLog = path.join(
      logDir,
      `post-authoring-finalize-after-${recoveryKind}-${attempt}.stderr.log`,
    );
    const recoveryStdoutLog = path.join(
      logDir,
      `post-authoring-finalize-after-${recoveryKind}-${attempt}.stdout.log`,
    );
    fs.writeFileSync(recoveryStdoutLog, result.stdout || "");
    fs.writeFileSync(recoveryStderrLog, result.stderr || "");
    handoffStages.push(
      compactCommandStage({
        stage: `process.finalize_after_${recoveryKind}_${attempt}`,
        command: commandString(finalizeCommand),
        result,
        stdoutLog: recoveryStdoutLog,
        stderrLog: recoveryStderrLog,
        reportPath: finalizeReportPath,
      }),
    );
    if (!fileExists(finalizeReportPath)) break;
    finalizeReport = readJson(finalizeReportPath);
  }

  let report = reportFromFinalize({
    processScope,
    outDir,
    reportPath,
    ledgerPath,
    finalizeReport,
    finalizeReportPath,
    finalizeCommand,
    mode: "execute",
    sourceSupportRowsFile,
    sourceRowsFile,
  });
  if (handoffStages.length > 0 || handoffBlockers.length > 0) {
    report.handoff_stages = handoffStages;
    report.support_handoff = {
      requested: true,
      completed: supportCommitted,
      reused_verified_identities: supportReused,
    };
    report.blockers = [...handoffBlockers, ...report.blockers];
    report.counts.blockers = report.blockers.length;
    if (handoffBlockers.length > 0) {
      report.status = "failed";
    }
  }

  if (booleanOption(options.commit) && report.status === "ready_for_explicit_commit") {
    const processHandoff = readHandoffPlan(finalizeReport, "commit_handoff_plan");
    if (!processHandoff.path) {
      report.blockers = [
        ...report.blockers,
        {
          code: "process_commit_handoff_plan_missing",
          message: "Ready process scope is missing dataset-commit-handoff-plan.json.",
        },
      ];
      report.counts.blockers = report.blockers.length;
      report.status = "blocked";
    } else {
      const processResult = executeHandoff({
        handoffPlanPath: processHandoff.path,
        ledgerDir: importLedgerDir,
        outDir: path.join(outDir, "process-handoff"),
        logDir,
        label: "process",
      });
      report.handoff_stages = [...(report.handoff_stages ?? []), ...processResult.stages];
      report.blockers = [...report.blockers, ...processResult.blockers];
      report.counts.blockers = report.blockers.length;
      report.files.process_commit_report = repoRelative(processResult.commitReportPath);
      report.files.process_post_write_verify_report = repoRelative(processResult.verifyReportPath);
      report.files.process_closeout_report = repoRelative(processResult.closeoutReportPath);
      report.status = processResult.status === "completed" ? "completed" : "failed";
      report.policy.remote_commit_executed = processResult.status === "completed";
    }
  }
  appendLedger(ledgerPath, {
    schema_version: 1,
    generated_at_utc: report.generated_at_utc,
    command: commandName,
    stage: "post_authoring_finalize",
    state: report.status,
    process_scope: processScope,
    input_hashes: inputHashes,
    exit_code: result.status ?? 0,
    files: {
      report: repoRelative(reportPath),
      finalize_report: repoRelative(finalizeReportPath),
      stdout_log: repoRelative(stdoutLog),
      stderr_log: repoRelative(stderrLog),
    },
    blockers: report.blockers,
  });
  writeJson(reportPath, report);
  return report;
}

export function createBafuProcessScopeE2eCommands(deps: BafuProcessScopeE2eRuntime): {
  runDatasetBafuProcessScopeE2e: typeof runDatasetBafuProcessScopeE2e;
} {
  installBafuProcessScopeE2eRuntime(deps);
  return {
    runDatasetBafuProcessScopeE2e,
  };
}

export const bafuProcessScopeE2eTestHooks = {
  canRunPostFinalizeIdentityRecovery,
  canRunPostFinalizeSemanticRecovery,
  loadVerifiedSupportIdentities,
  postWriteVerifyRetryReason,
  supportIdentityKeysFromHandoffPlan,
};

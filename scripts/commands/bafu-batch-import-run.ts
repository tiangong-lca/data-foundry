import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import {
  bafuFamilyPlanFields,
  bafuFamilySelectionRank,
  bafuFamilySignatureForScope,
  buildBafuFamilySignatureIndex,
  compactBafuFamilySignature,
  summarizeBafuFamilyScopes,
} from "../lib/bafu-family-signatures.ts";
import {
  createClassificationSchemaRepairService,
  type SchemaPaths,
} from "../lib/bafu-classification/schema-repair.ts";
import { createBafuIdentityDecisionCarryForwardService } from "../lib/bafu-orchestration/identity-decision-carry-forward.ts";
import {
  createBatchFinalizeStageService,
  type BatchFinalizeContextPaths as ContextPaths,
  type BatchFinalizeStageResult as StageResult,
} from "../lib/bafu-orchestration/batch-finalize-stage.ts";
import {
  buildClassificationDecisionIndex,
  preflightPlanRows,
  selectScopesForRun,
  selectionOrderOption,
} from "../lib/batch-orchestration/scope-selection.ts";
import {
  createBatchScopeExecutionService,
  type BatchScopeExecutionPaths as BatchPaths,
} from "../lib/batch-orchestration/scope-execution.ts";
import { createIdentityPatchStageService } from "../lib/batch-orchestration/identity-patch-stage.ts";
import {
  createBatchScopePreparationService,
  type BatchScopeMaterializedRows as MaterializedRows,
} from "../lib/batch-orchestration/scope-preparation.ts";
import { createSupportIdentityCacheService } from "../lib/batch-orchestration/support-identity-cache.ts";
import {
  createUniverseCoverageService,
  type UniverseCoverageRuntimeAdapter,
} from "../lib/batch-orchestration/universe-coverage.ts";
import { createVerifiedLedgerProjectionService } from "../lib/batch-orchestration/verified-ledger-projection.ts";
import {
  createBatchPostWriteHandoffService,
  type BatchPostWriteHandoffResult as HandoffResult,
} from "../lib/batch-orchestration/post-write-handoff.ts";
import { acceptTraceHashOnlyRemoteVerificationMismatch } from "../lib/remote-verification-accepted-diff.ts";
import {
  assertFoundryCommandSpecArtifactsCurrent,
  assertFoundryCommandSpecBindsArtifact,
  commandSpecOptionValue,
} from "../lib/foundry-command-spec.ts";
import { resolveInstalledTiangongLcaCliPackage } from "../lib/foundry-runtime-utils.ts";
import { resolveFoundryRuntimePaths } from "../lib/foundry-runtime-paths.ts";
import { stageContract } from "../lib/stage-contract.ts";
import {
  assertReceiptBoundHandoffAccount,
  traceHashNormalizationAllowed,
} from "../lib/production-case-policy.ts";

interface JsonRecord {
  [key: string]: unknown;
}

interface DatasetIdentity {
  id: string | null;
  version: string;
}

interface BafuBatchRuntime {
  nowIso: () => string;
  resolveRepoPath: (value: unknown) => string | null;
  repoRelativeMaybe: (filePath: string | null | undefined) => string | null;
  fileExists: (filePath: string | null | undefined) => boolean;
  directoryExists: (filePath: string | null | undefined) => boolean;
  readJson: (filePath: string) => unknown;
  readJsonLines: (filePath: string) => unknown[];
  writeJson: (filePath: string, value: unknown) => void;
  writeJsonLines: (filePath: string, rows: readonly unknown[]) => void;
  asText: (value: unknown) => string;
  booleanOption: (value: unknown) => boolean;
  integerOption: (value: unknown, fallback?: number | null) => number | null;
  normalizedList: (value: unknown) => string[];
  shellQuote: (value: string) => string;
  datasetIdentity: (
    row: unknown,
    datasetType: string,
  ) => {
    id?: string | null;
    version?: string | null;
  };
}

interface BafuBatchConfig extends JsonRecord {
  profile?: string;
  commandName?: string;
  enableBafuAutofill?: boolean;
  enableFamilySignatures?: boolean;
  defaults?: JsonRecord;
  commitFlowSupportInline?: boolean;
  mintUnmatchedFpUgSupport?: boolean;
  applyResolutionRewrites?: boolean;
}

interface SupportFinalizeInput {
  type: string;
  finalizeReport: JsonRecord;
  finalizeReportPath: string;
  finalizeArgs: string[];
  ledgerDir: string;
  scopeDir: string;
  logDir: string;
  stages: JsonRecord[];
  supportIdentityCacheFile: string;
}

interface FinalizeAndCommitInput {
  type: string;
  rowsFile: string;
  scopeDir: string;
  runDir: string;
  materialized: MaterializedRows;
  classificationApplyReport: string | null;
  locationApplyReport: string | null;
  identityApplyReports: string[];
  patchCollectReport: string | null;
  patchApplyReport: string | null;
  targetUserId: string;
  stateCode: number;
  logDir: string;
  ledgerDir: string;
  stages: JsonRecord[];
  supportIdentityCacheFile: string;
}

interface DatasetCommitCompleted extends JsonRecord {
  status: "completed";
  report: string;
  finalizeReport: JsonRecord;
  handoff: HandoffResult;
}

interface DatasetCommitBlocked extends JsonRecord {
  status: "failed" | "blocked";
  blocker: JsonRecord;
  report: string;
  finalizeReport: JsonRecord | null;
  handoff?: HandoffResult;
}

type DatasetCommitResult = DatasetCommitCompleted | DatasetCommitBlocked;

type BafuFamilyIndex = ReturnType<typeof buildBafuFamilySignatureIndex>;
type BafuFamilySignature = ReturnType<typeof bafuFamilySignatureForScope>;

function isJsonRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function jsonRecord(value: unknown): JsonRecord {
  return isJsonRecord(value) ? value : {};
}

function recordArray(value: unknown): JsonRecord[] {
  return Array.isArray(value) ? value.map(jsonRecord) : [];
}

const { entryRepoRelativePath: foundryEntryPath, repoRoot } = resolveFoundryRuntimePaths(
  import.meta.url,
);
const commandName = "dataset-bafu-batch-import-run";
const coverageCommandName = "dataset-bafu-universe-coverage-report";
let supportCommitQueue: Promise<unknown> = Promise.resolve();
const verifiedSupportIdentities = new Set<string>();
const bafuBatchStageContract = {
  remote_write_mode: "explicit-commit-only",
  stage_pipeline: stageContract([
    {
      stage: "load_scope_ledgers",
      phase: "prepare",
      purpose:
        "Load ready scopes plus existing ok/blocked/retry ledgers so reruns skip verified and deferred scopes.",
      inputs: [
        "ready-scopes.jsonl",
        "import-ledger/*.jsonl",
        "optional --ledger-source-dir ledgers",
      ],
      outputs: ["selected process scopes", "run-manifest.json"],
      side_effects: ["writes local Foundry run manifest"],
    },
    {
      stage: "materialize_scope",
      phase: "rewrite_cleanup",
      purpose:
        "Materialize one process scope from process-bundles, apply deterministic rewrites, and refresh exact-payload identity evidence when needed.",
      inputs: ["process-bundles/<process>", "library classification decisions", "context packs"],
      outputs: ["scope materialized rows", "identity preflight artifacts", "patch/apply reports"],
      side_effects: ["writes local scope workspace artifacts"],
    },
    {
      stage: "scope_commit_gate",
      phase: "gate_validate",
      purpose:
        "Run finalize, mutation manifest, handoff planning, remote commit, and readback verify only for scopes whose dependency closure is ready.",
      inputs: ["materialized scope rows", "finalize context", "target user/account guard"],
      outputs: ["commit reports", "remote verification reports", "blocked-scope ledger rows"],
      blockers: [
        "unresolved AI/human review dependencies",
        "reference closure failures",
        "remote write failures",
      ],
      side_effects: ["may write verified rows to the remote database when --commit is supplied"],
    },
    {
      stage: "ledger_report",
      phase: "report",
      purpose:
        "Write separated ok, blocked, and retry ledgers plus a reader-facing batch report for resumable import.",
      inputs: ["scope run results"],
      outputs: [
        "dataset-bafu-batch-import-run-report.json",
        "scope-checkpoints.jsonl",
        "import-ledger/ok.*.jsonl",
        "import-ledger/blocked.*.jsonl",
        "import-ledger/failed.scopes.retry.jsonl",
      ],
      side_effects: ["writes local Foundry ledgers"],
    },
  ]).map((stage) => ({
    ...stage,
    report_contract: {
      ...stage.report_contract,
      remote_write_mode: "explicit-commit-only",
    },
  })),
};

const bafuBatchRuntimeKeys = [
  "nowIso",
  "resolveRepoPath",
  "repoRelativeMaybe",
  "fileExists",
  "directoryExists",
  "readJson",
  "readJsonLines",
  "writeJson",
  "writeJsonLines",
  "asText",
  "booleanOption",
  "integerOption",
  "normalizedList",
  "shellQuote",
  "datasetIdentity",
] as const satisfies readonly (keyof BafuBatchRuntime)[];

let bafuBatchRuntime: BafuBatchRuntime | null = null;
// Profile config lets the same engine drive other profiles (e.g. USLCI) without
// changing BAFU behavior: every default below reproduces the BAFU runner exactly,
// so an empty config == the historical BAFU runner.
let bafuBatchConfig: BafuBatchConfig = {};

function installBafuBatchRuntime(deps: BafuBatchRuntime, config: BafuBatchConfig = {}): void {
  const missing = bafuBatchRuntimeKeys.filter((key) => typeof deps?.[key] !== "function");
  if (missing.length > 0) {
    throw new Error(`createBafuBatchImportRunCommands missing dependencies: ${missing.join(", ")}`);
  }
  bafuBatchRuntime = deps;
  bafuBatchConfig = config || {};
}

function createUniverseCoverageRuntimeAdapter(
  deps: BafuBatchRuntime,
): UniverseCoverageRuntimeAdapter {
  const pathAdapter = Object.freeze({
    join: (...parts: string[]) => path.join(...parts),
    dirname: (filePath: string) => path.dirname(filePath),
    basename: (filePath: string, suffix?: string) => path.basename(filePath, suffix),
    isAbsolute: (filePath: string) => path.isAbsolute(filePath),
    resolve: (filePath: string) => path.resolve(filePath),
  });
  return Object.freeze({
    nowIso: deps.nowIso,
    resolveRepoPath: deps.resolveRepoPath,
    repoRelative: deps.repoRelativeMaybe,
    fileExists: deps.fileExists,
    directoryExists: deps.directoryExists,
    readJson: deps.readJson,
    readJsonLines: deps.readJsonLines,
    writeJson: deps.writeJson,
    writeJsonLines: deps.writeJsonLines,
    ensureDirectory: (directory: string) => fs.mkdirSync(directory, { recursive: true }),
    normalizedList: deps.normalizedList,
    asText: deps.asText,
    datasetIdentity: deps.datasetIdentity,
    path: pathAdapter,
    walkFiles: (rootDir: unknown, predicate: (filePath: string) => boolean): string[] => {
      const resolved = deps.resolveRepoPath(rootDir);
      if (!resolved || !fs.existsSync(resolved)) return [];
      const stack = [resolved];
      const files: string[] = [];
      while (stack.length > 0) {
        const current = stack.pop();
        if (!current) continue;
        for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
          const next = path.join(current, entry.name);
          if (entry.isDirectory()) stack.push(next);
          else if (entry.isFile() && predicate(next)) files.push(next);
        }
      }
      return files.sort();
    },
  });
}

function runtime(): BafuBatchRuntime {
  if (!bafuBatchRuntime) {
    throw new Error("createBafuBatchImportRunCommands must install command dependencies.");
  }
  return bafuBatchRuntime;
}

// Profile-config accessors. Defaults == BAFU, so BAFU is byte-for-byte unchanged.
function activeProfile(): string {
  return bafuBatchConfig.profile || "bafu";
}
function activeCommandName(): string {
  return bafuBatchConfig.commandName || commandName;
}
function bafuAutofillEnabled(): boolean {
  return bafuBatchConfig.enableBafuAutofill !== false;
}
function familySignaturesEnabled(): boolean {
  return bafuBatchConfig.enableFamilySignatures !== false;
}
// When true, the dependency-flow finalize commits its source/contact support
// (the shared library contact) inline right after pre-finalize — mirroring the
// process path — so the first scope of a never-before-imported library can prove
// reference closure for its own flows. BAFU leaves this false: its FOEN library
// contact already exists remotely, so flow pre-finalize is closure-clean and the
// inline support commit would be redundant.
function commitFlowSupportInline(): boolean {
  return Boolean(bafuBatchConfig.commitFlowSupportInline);
}
// When true, the finalize lifts the scope's UNMATCHED (non-canonical) Unit Groups
// and Flow Properties into the support commit set so they are minted as
// account-local My Data once and committed before the flows that reference them
// (P1a of the BAFU-cleanup backlog). Only adapters that freeze this flag on may use
// the path (currently USLCI and Worldsteel); BAFU keeps FP/UG reference-only and must
// not start minting them even though its profile also has the account-local override.
function mintUnmatchedFpUgSupport(): boolean {
  return Boolean(bafuBatchConfig.mintUnmatchedFpUgSupport);
}
// The dataset types the runner tracks as account-local "support" identities. A profile
// whose adapter leaves the mint flag off commits only contacts + true sources as support,
// so its support identity set, reuse-skip condition, cache, and cross-scope discovery stay
// exactly contact|source — unchanged. Under --mint-unmatched-fp-ug-support, minted Flow
// Properties and Unit Groups are ALSO account-local
// support: they must be tracked as support identities so the reuse-skip branch does
// not falsely short-circuit the support commit (a contact already verified must not
// hide an un-committed minted FP/UG), and so a committed FP/UG can be reused across
// scopes. Order is irrelevant; membership is what gates.
function supportIdentityTypes(): string[] {
  return mintUnmatchedFpUgSupport()
    ? ["contact", "source", "unitgroup", "flowproperty"]
    : ["contact", "source"];
}

function findFiles(rootDir: unknown, predicate: (filePath: string) => boolean): string[] {
  const resolved = resolveRepoPath(rootDir);
  if (!resolved || !fs.existsSync(resolved)) return [];
  const stack = [resolved];
  const matches: string[] = [];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const next = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(next);
      else if (entry.isFile() && predicate(next)) matches.push(next);
    }
  }
  return matches.sort();
}

const supportIdentityCache = createSupportIdentityCacheService(
  {
    nowIso,
    repoRelative,
    resolveRepoPath,
    fileExists,
    directoryExists,
    readJson,
    readJsonLines,
    appendJsonLine,
    findFiles,
    supportedTypes: supportIdentityTypes,
    path: {
      join: (...parts: string[]) => path.join(...parts),
      basename: (filePath: string) => path.basename(filePath),
      dirname: (filePath: string) => path.dirname(filePath),
      separator: path.sep,
    },
  },
  verifiedSupportIdentities,
);

const classificationSchemaRepair = createClassificationSchemaRepairService({
  fileExists,
  readJson,
  readJsonLines,
  writeJsonLines,
  repoRelative,
  normalizeSearchText,
  pathJoin: (...parts: string[]) => path.join(...parts),
});
// When true (USLCI only), the flow-identity step applies the authoritative
// library-resolution exchange-reference-rewrites deterministically: every flow the
// resolution proved reusable becomes a canonical reference, only flows with NO
// rewrite mint. This replaces the brittle decisions-* carry-forward whose additions
// frequently came out empty (apply skipped -> dependency flows wrongly minted even
// when the offline resolution already matched them to canonical). BAFU keeps this
// false: its reuse runs entirely through autofill + carry-forward.
function applyResolutionRewrites(): boolean {
  return Boolean(bafuBatchConfig.applyResolutionRewrites);
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

function directoryExists(filePath: string | null | undefined): boolean {
  return runtime().directoryExists(filePath);
}

function readJson(filePath: string): JsonRecord {
  return runtime().readJson(filePath) as JsonRecord;
}

function readJsonLines(filePath: string | null | undefined): JsonRecord[] {
  if (!fileExists(filePath)) return [];
  return runtime().readJsonLines(filePath!) as JsonRecord[];
}

function writeJson(filePath: string, value: unknown): void {
  runtime().writeJson(filePath, value);
}

function writeJsonLines(filePath: string, rows: readonly unknown[]): void {
  runtime().writeJsonLines(filePath, rows);
}

function appendJsonLine(filePath: string, row: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.appendFileSync(filePath, `${JSON.stringify(row)}\n`);
}

function sha256File(filePath: string): string {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function asText(value: unknown): string {
  return runtime().asText(value);
}

function normalizeSearchText(value: unknown): string {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\\+/gu, " ")
    .replace(/[^a-z0-9]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function booleanOption(value: unknown): boolean {
  return runtime().booleanOption(value);
}

function integerOption(value: unknown, fallback: number | null = null): number | null {
  return runtime().integerOption(value, fallback);
}

function normalizedList(value: unknown): string[] {
  return runtime().normalizedList(value);
}

function requestedProcessIdValues(options: JsonRecord): string[] {
  const values = [...normalizedList(options.processId || options.processIds)];
  const fileOption = options.processIdFile ?? options.processIdsFile;
  if (fileOption == null || fileOption === false) return values;
  const filePath = resolveRepoPath(asText(fileOption));
  if (!filePath || !fileExists(filePath)) {
    throw new Error(`--process-id-file not found: ${filePath || asText(fileOption)}`);
  }
  const fileIds = fs
    .readFileSync(filePath, "utf8")
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    // Same comma tolerance as --process-id values via normalizedList.
    .flatMap((line) => line.split(",").map((entry) => entry.trim()))
    .filter(Boolean);
  return [...values, ...fileIds];
}

function shellQuote(value: string): string {
  return runtime().shellQuote(value);
}

function commandString(argv: string[]): string {
  return argv.map(shellQuote).join(" ");
}

function datasetIdentity(row: JsonRecord, type: string): DatasetIdentity {
  const injected = runtime().datasetIdentity(row, type);
  if (injected?.id || injected?.version) {
    return {
      id: injected.id ?? null,
      version: injected.version || "00.00.001",
    };
  }
  const root = jsonRecord(row[`${type}DataSet`] ?? row);
  const typeInformation = jsonRecord(root[`${type}Information`]);
  const dataSetInformation =
    typeInformation.dataSetInformation ??
    typeInformation["common:dataSetInformation"] ??
    jsonRecord(root.processInformation).dataSetInformation ??
    jsonRecord(root.flowInformation).dataSetInformation ??
    {};
  const information = jsonRecord(dataSetInformation);
  const publication =
    jsonRecord(root.administrativeInformation).publicationAndOwnership ??
    jsonRecord(root.administrativeInformation)["common:publicationAndOwnership"] ??
    {};
  const publicationRecord = jsonRecord(publication);
  return {
    id:
      asText(information["common:UUID"]) ||
      asText(information.UUID) ||
      asText(row.dataset_id) ||
      asText(row.id),
    version:
      asText(publicationRecord["common:dataSetVersion"]) ||
      asText(publicationRecord.dataSetVersion) ||
      asText(row.dataset_version) ||
      asText(row.version) ||
      "00.00.001",
  };
}

const identityDecisionCarryForward = createBafuIdentityDecisionCarryForwardService({
  nowIso,
  repoRelative,
  resolveRepoPath,
  datasetIdentity: (row, datasetType) => datasetIdentity(jsonRecord(row), datasetType),
  // Cache entries are produced by scripts/commands/identity-preflight-run.ts.
  resultCacheDirectory: () => process.env.BAFU_IDENTITY_PREFLIGHT_RESULT_CACHE ?? null,
  fs: {
    fileExists,
    directoryExists,
    readDirectory: (directory) =>
      fs.readdirSync(directory, { withFileTypes: true }).map((entry) => ({
        name: entry.name,
        isDirectory: entry.isDirectory(),
      })),
    readJson,
    readJsonLines,
    writeJson,
    writeJsonLines,
    ensureDirectory: (directory) => fs.mkdirSync(directory, { recursive: true }),
    copyFile: (source, destination) => fs.copyFileSync(source, destination),
    readText: (filePath) => fs.readFileSync(filePath, "utf8"),
    removeDirectory: (directory) => fs.rmSync(directory, { recursive: true, force: true }),
  },
  path: {
    join: (...parts) => path.join(...parts),
    basename: (filePath) => path.basename(filePath),
    parse: (filePath) => path.parse(filePath),
  },
  hash: { sha256File },
});

const {
  invalidateIdentityPreflightResultCacheEntry,
  loadResolutionRewritesByProcess,
  mergeCompletedReusableIdentityDecisions,
} = identityDecisionCarryForward;

const {
  batchRunStatus,
  blockRow,
  datasetIdentityKey,
  flowRowsPendingVerification,
  loadActiveBlockedScopeSetFromFiles,
  loadVerifiedRowsByKeyFromFiles,
  loadVerifiedSetFromFiles,
  okDatasetRow,
  writeBlockedScopeViews,
  writeScopeCarriedForwardVerifiedFlowRows,
} = createVerifiedLedgerProjectionService({
  nowIso,
  asText,
  datasetIdentity,
  readJsonLines,
  writeJsonLines,
  appendJsonLine,
  repoRelative,
  pathJoin: (...parts: string[]) => path.join(...parts),
});

function taskIdentity(task: JsonRecord): { id: string; version: string } {
  const entity = jsonRecord(task.entity);
  return {
    id: asText(entity.entity_id ?? task.dataset_id ?? task.id),
    version: asText(entity.version ?? task.dataset_version ?? task.version) || "00.00.001",
  };
}

export function filterAuthoringTaskManifestToRows({
  taskManifest,
  rowsFile,
  type,
  reportPath,
}: {
  taskManifest: unknown;
  rowsFile: unknown;
  type: string;
  reportPath?: unknown;
}): JsonRecord {
  const resolvedTaskManifest = resolveRepoPath(taskManifest);
  const resolvedRowsFile = resolveRepoPath(rowsFile);
  const resolvedReportPath =
    resolveRepoPath(reportPath) ||
    path.join(path.dirname(resolvedTaskManifest!), "authoring-task-filter-report.json");
  const manifest = readJson(resolvedTaskManifest!);
  const rows = readRows(resolvedRowsFile);
  const retainedKeys = new Set(
    rows
      .map((row) => datasetIdentity(row, type))
      .filter((identity) => identity.id)
      .map((identity) => `${identity.id}@${identity.version}`),
  );
  const tasks = Array.isArray(manifest.tasks) ? manifest.tasks.map(jsonRecord) : [];
  const retainedTasks: JsonRecord[] = [];
  const skippedTasks: JsonRecord[] = [];
  for (const task of tasks) {
    const identity = taskIdentity(task);
    const key = identity.id ? `${identity.id}@${identity.version}` : "";
    if (key && retainedKeys.has(key)) {
      retainedTasks.push(task);
    } else {
      skippedTasks.push({
        dataset_type: jsonRecord(task.entity).dataset_type ?? type,
        dataset_id: identity.id || null,
        dataset_version: identity.version || null,
        reason: "dataset_not_present_after_identity_apply",
      });
    }
  }
  const filtered =
    skippedTasks.length > 0
      ? path.join(path.dirname(resolvedTaskManifest!), "authoring-task-manifest.current-rows.json")
      : resolvedTaskManifest!;
  if (filtered !== resolvedTaskManifest) {
    writeJson(filtered, {
      ...manifest,
      tasks: retainedTasks,
      counts: {
        ...(manifest.counts ?? {}),
        tasks: retainedTasks.length,
        original_tasks: tasks.length,
        skipped_not_in_current_rows: skippedTasks.length,
      },
      filter: {
        source_manifest: repoRelative(resolvedTaskManifest),
        current_rows_file: repoRelative(resolvedRowsFile),
        reason: "identity decisions may rewrite/reuse rows before content patches are applied",
      },
    });
  }
  // Status reflects whether the RETAINED tasks actually carry authoring action items,
  // not merely how many tasks survived the current-rows filter. A reuse-heavy scope
  // (e.g. worldsteel) can retain only already-authored new rows whose action items are
  // all closed; those are `ready_no_action_items` tasks and must NOT force the
  // autofill-off block. Count-based status wrongly reported ready_for_ai_authoring_batch
  // for a scope with zero outstanding action items. BAFU/USLCI scopes whose retained
  // tasks still carry action items are unaffected (count > 0 keeps the batch status).
  const retainedActionItemCount = retainedTasks.reduce(
    (sum, task) =>
      sum +
      (Number.isFinite(Number(task.action_item_count))
        ? Number(task.action_item_count)
        : Array.isArray(task.action_items)
          ? task.action_items.length
          : 0),
    0,
  );
  const report: JsonRecord = {
    schema_version: 1,
    generated_at_utc: nowIso(),
    status: retainedActionItemCount > 0 ? "ready_for_ai_authoring_batch" : "ready_no_action_items",
    task_manifest: repoRelative(resolvedTaskManifest),
    filtered_task_manifest: repoRelative(filtered),
    current_rows_file: repoRelative(resolvedRowsFile),
    type,
    counts: {
      current_rows: rows.length,
      original_tasks: tasks.length,
      retained_tasks: retainedTasks.length,
      retained_action_items: retainedActionItemCount,
      skipped_tasks: skippedTasks.length,
    },
    skipped_tasks: skippedTasks.slice(0, 200),
  };
  writeJson(resolvedReportPath, report);
  return {
    status: report.status,
    taskManifest: filtered,
    reportPath: resolvedReportPath,
    counts: report.counts,
  };
}

function readRows(filePath: string | null | undefined): JsonRecord[] {
  if (!fileExists(filePath)) return [];
  if (String(filePath).toLowerCase().endsWith(".jsonl")) return readJsonLines(filePath);
  const value: unknown = readJson(filePath!);
  if (Array.isArray(value)) return value.map(jsonRecord);
  const record = jsonRecord(value);
  if (Array.isArray(record.rows)) return record.rows.map(jsonRecord);
  return [record];
}

function uniqueExistingPaths(paths: unknown[]): string[] {
  return [
    ...new Set(
      paths
        .map(resolveRepoPath)
        .filter((filePath): filePath is string => Boolean(filePath && fileExists(filePath))),
    ),
  ];
}

function datasetTypeFromRow(row: JsonRecord): string | null {
  if (row?.contactDataSet) return "contact";
  if (row?.sourceDataSet) return "source";
  if (row?.flowDataSet) return "flow";
  if (row?.processDataSet) return "process";
  if (row?.unitGroupDataSet) return "unitgroup";
  if (row?.flowPropertyDataSet) return "flowproperty";
  return null;
}

function supportIdentityKeysFromHandoffPlan(handoffPlan: JsonRecord): string[] {
  const commands = jsonRecord(handoffPlan.commands);
  const inputPath = resolveRepoPath(
    commandSpecOptionValue(commands.commit, "--input") ||
      commandSpecOptionValue(commands.commit, "--input-file"),
  );
  if (!fileExists(inputPath)) return [];
  return readRows(inputPath)
    .map((row) => {
      const type = datasetTypeFromRow(row) || commandSpecOptionValue(commands.commit, "--type");
      if (!type || !supportIdentityTypes().includes(type)) return null;
      const identity = datasetIdentity(row, type);
      return identity.id ? `${type}:${identity.id}@${identity.version}` : null;
    })
    .filter((key): key is string => Boolean(key));
}

const splitSupportIdentityKey = supportIdentityCache.splitIdentityKey;
const appendSupportIdentityCacheRows = supportIdentityCache.appendVerifiedRows;
const appendSupportIdentityInvalidationRows = supportIdentityCache.appendInvalidationRows;
const staleReusedSupportIdentityKeys = supportIdentityCache.staleReusedKeys;

const primeVerifiedSupportIdentityCache = supportIdentityCache.prime;

function appendOption(args: string[], name: string, value: unknown): void {
  if (value == null || value === "") return;
  if (value === true) {
    args.push(name);
    return;
  }
  args.push(name, String(value));
}

function foundryCommand(command: string, options: JsonRecord = {}): string[] {
  const args = [process.execPath, foundryEntryPath, command];
  for (const [key, value] of Object.entries(options)) {
    const flag = `--${key.replace(/[A-Z]/gu, (letter) => `-${letter.toLowerCase()}`)}`;
    if (Array.isArray(value)) {
      for (const item of value) appendOption(args, flag, item);
    } else {
      appendOption(args, flag, value);
    }
  }
  return args;
}

function parseJsonStdout(stdout: unknown): JsonRecord | null {
  const text = String(stdout || "").trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(text.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

function stageTimeoutMs(stage: unknown): number {
  const override = integerOption(process.env.BAFU_BATCH_STAGE_TIMEOUT_MS, null);
  if (override && override > 0) return override;
  const name = String(stage ?? "");
  if (name.includes("post_write_verify") || name.includes("verify")) return 180_000;
  if (name.includes("finalize")) return 900_000;
  if (name.includes("commit")) return 300_000;
  return 180_000;
}

async function runArgvStage({
  stage,
  argv,
  logDir,
  reportPath,
}: {
  stage: string;
  argv: string[];
  logDir: string;
  reportPath?: unknown;
}): Promise<StageResult> {
  const result = await runStage({ stage, logDir, command: argv });
  const resolvedReport = resolveRepoPath(reportPath);
  if (fileExists(resolvedReport)) {
    result.json = readJson(resolvedReport!);
    result.report = repoRelative(resolvedReport);
  }
  return result;
}

function runStage({
  stage,
  command,
  logDir,
}: {
  stage: string;
  command: string[];
  logDir: string;
}): Promise<StageResult> {
  fs.mkdirSync(logDir, { recursive: true });
  const safeStage = stage.replace(/[^A-Za-z0-9_.-]+/gu, "-");
  const stdoutLog = path.join(logDir, `${safeStage}.stdout.log`);
  const stderrLog = path.join(logDir, `${safeStage}.stderr.log`);
  const startedAt = nowIso();
  return new Promise<StageResult>((resolve) => {
    const timeoutMs = stageTimeoutMs(stage);
    let timedOut = false;
    let closed = false;
    const childEnv = { ...process.env };
    delete childEnv.TIANGONG_LCA_FORCE_REAUTH;
    const child = spawn(command[0], command.slice(1), {
      cwd: repoRoot,
      env: childEnv,
      shell: false,
    });
    const timeout = setTimeout(() => {
      timedOut = true;
      stderr += `Stage timed out after ${timeoutMs} ms.\n`;
      child.kill("SIGTERM");
      setTimeout(() => {
        if (!closed) child.kill("SIGKILL");
      }, 10_000).unref();
    }, timeoutMs);
    timeout.unref();
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      stderr += `${error.stack || error.message || String(error)}\n`;
    });
    child.on("close", (code, signal) => {
      closed = true;
      clearTimeout(timeout);
      fs.writeFileSync(stdoutLog, stdout);
      fs.writeFileSync(stderrLog, stderr);
      resolve({
        stage,
        command: commandString(command),
        exit_code: timedOut ? 124 : typeof code === "number" ? code : 1,
        signal: signal ?? null,
        timed_out: timedOut,
        timeout_ms: timeoutMs,
        started_at_utc: startedAt,
        finished_at_utc: nowIso(),
        stdout_log: repoRelative(stdoutLog),
        stderr_log: repoRelative(stderrLog),
        json: parseJsonStdout(stdout),
      });
    });
  });
}

const batchPostWriteHandoff = createBatchPostWriteHandoffService({
  processExecutable: process.execPath,
  foundryEntryPath,
  repoRoot,
  environment: process.env,
  resolveRepoPath,
  repoRelative,
  fileExists,
  readJson,
  findFiles,
  joinPath: (...parts: string[]) => path.join(...parts),
  basename: (filePath: string) => path.basename(filePath),
  asText,
  integerOption,
  assertReceiptBoundHandoffAccount,
  assertCommandSpecBindsArtifact: assertFoundryCommandSpecBindsArtifact,
  assertCommandSpecArtifactsCurrent: (commandSpec) =>
    assertFoundryCommandSpecArtifactsCurrent(commandSpec, resolveRepoPath),
  runStage,
  sleep: (delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs)),
  traceHashNormalizationAllowed,
  acceptTraceHashOnlyRemoteVerificationMismatch,
});

const executeHandoff = batchPostWriteHandoff.execute;
const commitFailuresAllAlreadyExist = batchPostWriteHandoff.commitFailuresAllAlreadyExist;
const postWriteVerifyRetryReason = batchPostWriteHandoff.postWriteVerifyRetryReason;

function reportFile(stageJson: JsonRecord | null, fallback: string): string | null {
  const value = jsonRecord(stageJson?.files).report ?? stageJson?.report;
  return resolveRepoPath(value) || fallback;
}

function outputRowsByStem(report: JsonRecord | null, stem: string): string | null {
  const files = jsonRecord(report?.files);
  const rows = Array.isArray(files.output_rows)
    ? files.output_rows
    : [files.output_rows].filter(Boolean);
  return resolveRepoPath(
    rows.find((entry) => path.basename(String(entry)).startsWith(stem)) ?? rows[0],
  );
}

function identityApplyReportHasReferenceRewrites(reportPath: string): boolean {
  if (!fileExists(reportPath)) return false;
  const report = readJson(reportPath);
  const rewritesFile = resolveRepoPath(jsonRecord(report.files).identity_reference_rewrites);
  return readJsonLines(rewritesFile).length > 0;
}

function existingIdentityApplyReportsWithReferenceRewrites(
  scopeDir: string,
  label: string,
): string[] {
  const candidates = [
    path.join(scopeDir, `${label}-identity-apply`, "identity-decisions-apply-report.json"),
    ...findFiles(
      scopeDir,
      (filePath) => path.basename(filePath) === "identity-decisions-apply-report.json",
    ),
  ];
  return uniqueExistingPaths(candidates).filter(identityApplyReportHasReferenceRewrites);
}

function categoryForBlocker(code: unknown): string {
  const text = String(code || "");
  if (/classification|location|identity|authoring|patch|curation/u.test(text)) {
    return "human-review";
  }
  if (/reference|closure|support/u.test(text)) return "reference-closure";
  if (/commit|verify|remote|timeout|network/u.test(text)) return "remote-write";
  return "other";
}

function firstBlocker(
  report: JsonRecord | null,
  fallbackCode: string,
  fallbackMessage: string,
): JsonRecord {
  return recordArray(report?.blockers)[0] ?? { code: fallbackCode, message: fallbackMessage };
}

function statusIs(report: JsonRecord | null, values: string[]): boolean {
  return values.includes(String(report?.status || ""));
}

function authoringRecoveryProducedEvidence(recovery: JsonRecord | null): boolean {
  return Boolean(
    recovery?.identityApplyReport || recovery?.patchCollectReport || recovery?.patchApplyReport,
  );
}

function preFinalizeRecoveryBlocker({
  type,
  finalizeReport,
  recovery,
}: {
  type: string;
  finalizeReport: JsonRecord;
  recovery: JsonRecord | null;
}): JsonRecord | null {
  if (statusIs(finalizeReport, ["ready_for_remote_write"])) return null;
  if (authoringRecoveryProducedEvidence(recovery)) return null;
  return firstBlocker(
    finalizeReport,
    `${type}_pre_finalize_not_ready`,
    `${type} pre-finalize status is ${finalizeReport?.status || "missing"} and no automatic authoring evidence was produced.`,
  );
}

function identityUnresolvedReferenceBlocker({
  type,
  report,
}: {
  type: string;
  report: JsonRecord;
}): JsonRecord | null {
  const files = jsonRecord(report.files);
  const counts = jsonRecord(report.counts);
  const unresolvedRowsFile = resolveRepoPath(
    files.identity_unresolved_references || files.unresolved_reference_rows,
  );
  const unresolvedRows = readJsonLines(unresolvedRowsFile);
  const unresolvedCount =
    unresolvedRows.length ||
    Number(counts.identity_unresolved_references ?? counts.unresolved_reference_rows ?? 0);
  if (!unresolvedCount) return null;
  return {
    code: `${type}_identity_unresolved_references`,
    message: `${type} identity decisions still leave ${unresolvedCount} unresolved reference row(s).`,
    unresolved_reference_rows: repoRelative(unresolvedRowsFile),
  };
}

function findOneFile(rootDir: unknown, pattern: RegExp): string | null {
  const resolved = resolveRepoPath(rootDir);
  if (!directoryExists(resolved)) return null;
  const matches = fs
    .readdirSync(resolved!)
    .filter((name) => pattern.test(name))
    .sort();
  return matches.length ? path.join(resolved!, matches[0]) : null;
}

function defaultContext(runDir: string, type: string): ContextPaths {
  return {
    schemaFile: path.join(runDir, "context", type, "outputs", "schema.json"),
    yamlFile: path.join(runDir, "context", type, "outputs", "methodology.yaml"),
    rulesetFile: path.join(runDir, "context", type, "outputs", "runtime-ruleset.json"),
  };
}

function defaultSchemaFiles(options: JsonRecord): SchemaPaths {
  const schemaRoot = resolveRepoPath(
    options.tidasSchemaDir || resolveInstalledTiangongLcaCliPackage().schemaDir,
  );
  return {
    processCategory: path.join(schemaRoot!, "tidas_processes_category.json"),
    flowProductCategory: path.join(schemaRoot!, "tidas_flows_product_category.json"),
    flowElementaryCategory: path.join(schemaRoot!, "tidas_flows_elementary_category.json"),
    location: path.join(schemaRoot!, "tidas_locations_category.json"),
    allClassification: [
      "tidas_contacts_category.json",
      "tidas_flowproperties_category.json",
      "tidas_flows_elementary_category.json",
      "tidas_flows_product_category.json",
      "tidas_lciamethods_category.json",
      "tidas_processes_category.json",
      "tidas_sources_category.json",
      "tidas_unitgroups_category.json",
    ].map((name) => path.join(schemaRoot!, name)),
  };
}

const repairClassificationDecisionCodes = classificationSchemaRepair.repair;

// Worker-level safety net: an uncaught throw inside runOneScope (e.g. a transient
// fs EINVAL/ENOENT from concurrent shared-cache access at higher --parallel) would
// otherwise reject Promise.all and abort the ENTIRE batch with no ledgers written.
// Record the scope as a retryable failure (mirroring the in-scope `fail` path) so the
// remaining scopes continue and the failed scope can simply be rerun.
function recordScopeExecutionException({
  scope,
  familySignature,
  error,
  paths,
}: {
  scope: JsonRecord;
  familySignature: BafuFamilySignature;
  error: unknown;
  paths: JsonRecord;
}): JsonRecord {
  const processId = asText(scope.process_id || scope.id);
  const processVersion = asText(scope.process_version || scope.version) || "00.00.001";
  const row = blockRow({
    scope,
    stage: "scope_execution",
    blocker: {
      code: "scope_execution_exception",
      message: `Uncaught error during scope execution: ${error instanceof Error ? error.message : String(error)}`,
      retryable: true,
      retryable_reason_code: "scope_execution_exception",
      required_human_action:
        "Transient runtime error during scope execution (often a concurrent shared-cache fs race at higher --parallel). Rerun the exact scope command; if it persists, retry with --parallel 1.",
    },
    report: null,
    rerunCommand: commandString([
      process.execPath,
      foundryEntryPath,
      commandName,
      "--scope-file",
      repoRelative(asText(paths.scopeFile)),
      "--process-bundles-dir",
      repoRelative(asText(paths.processBundlesDir)),
      "--run-dir",
      repoRelative(asText(paths.runDir)),
      "--out-dir",
      repoRelative(asText(paths.outDir)),
      "--process-id",
      processId,
      "--commit",
      "--parallel",
      "1",
    ]),
  });
  appendJsonLine(asText(paths.failedRetry), row);
  appendJsonLine(asText(paths.blocked_remote_write), row);
  appendJsonLine(asText(paths.scopeCheckpoints), {
    schema_version: 1,
    generated_at_utc: nowIso(),
    process_id: processId,
    process_version: processVersion,
    scope_lock: `process:${processId}:${processVersion}`,
    ...bafuFamilyPlanFields(familySignature),
    state: "failed_retryable",
    stage: "scope_execution",
    code: row.code,
  });
  return {
    status: "failed",
    checkpoint: { state: "failed_retryable" },
    block: row,
    stages: [],
  };
}

const batchFinalizeStage = createBatchFinalizeStageService({
  processExecPath: process.execPath,
  foundryEntryPath,
  activeProfile,
  libraryContact: () => jsonRecord(bafuBatchConfig.libraryContact),
  mintUnmatchedFpUgSupport,
  nowIso,
  normalizedList,
  repoRelative,
  resolveRepoPath,
  fileExists,
  readJson,
  runArgvStage,
});

const buildFinalizeArgs = batchFinalizeStage.buildFinalizeArgs;
const retryableStageFailure = batchFinalizeStage.retryableStageFailure;
const runFinalizeStage = batchFinalizeStage.runFinalizeStage;

const identityPatchStage = createIdentityPatchStageService({
  processExecPath: process.execPath,
  foundryEntryPath,
  activeProfile,
  bafuAutofillEnabled,
  resolveRepoPath,
  repoRelative,
  fileExists,
  foundryCommand,
  runArgvStage,
  statusIs,
  firstBlocker,
  reportFile,
  mergeCompletedReusableIdentityDecisions,
  identityUnresolvedReferenceBlocker,
  filterAuthoringTaskManifestToRows,
  writeJsonLines,
});

const runIdentityAndPatch = identityPatchStage.runIdentityAndPatch;

async function maybeCommitSupportThenRerunFinalize({
  type,
  finalizeReport,
  finalizeReportPath,
  finalizeArgs,
  ledgerDir,
  scopeDir,
  logDir,
  stages,
  supportIdentityCacheFile,
}: SupportFinalizeInput): Promise<JsonRecord> {
  const supportPlan = resolveRepoPath(
    jsonRecord(finalizeReport.files).source_contact_support_commit_handoff_plan,
  );
  if (!fileExists(supportPlan)) return finalizeReport;
  const handoffPlan = readJson(supportPlan!);
  const supportIdentityKeys = supportIdentityKeysFromHandoffPlan(handoffPlan);
  const previousSupportCommit = supportCommitQueue;
  let releaseSupportCommit: () => void = () => {};
  supportCommitQueue = new Promise<void>((resolve) => {
    releaseSupportCommit = resolve;
  });
  await previousSupportCommit;
  let supportResult: HandoffResult | null = null;
  try {
    if (
      supportIdentityKeys.length > 0 &&
      supportIdentityKeys.every((identityKey) => verifiedSupportIdentities.has(identityKey))
    ) {
      const reuseDir = path.join(scopeDir, `${type}-source-contact-support-handoff`);
      const reuseReportPath = path.join(reuseDir, "reused-support-identities.json");
      writeJson(reuseReportPath, {
        schema_version: 1,
        generated_at_utc: nowIso(),
        status: "reused_verified_support_identities",
        handoff_plan: repoRelative(supportPlan),
        support_identity_cache: repoRelative(supportIdentityCacheFile),
        support_identities: supportIdentityKeys,
      });
      stages.push({
        stage: `${type}.support.reuse_verified`,
        status: "skipped",
        report: repoRelative(reuseReportPath),
        support_identities: supportIdentityKeys,
      });
      const rerun = await runFinalizeStage({
        stage: `${type}.finalize_after_support_reuse`,
        args: finalizeArgs,
        reportPath: finalizeReportPath,
        logDir,
      });
      stages.push(rerun);
      const staleKeys = staleReusedSupportIdentityKeys(rerun.json!, supportIdentityKeys);
      if (staleKeys.length === 0) return rerun.json!;
      for (const identityKey of staleKeys) verifiedSupportIdentities.delete(identityKey);
      appendSupportIdentityInvalidationRows({
        cacheFile: supportIdentityCacheFile,
        identityKeys: staleKeys,
        source: `${type}.support.reuse_invalidated`,
        report: finalizeReportPath,
      });
      stages.push({
        stage: `${type}.support.reuse_invalidated`,
        status: "invalidated_stale_support_identities",
        support_identities: staleKeys,
        report: repoRelative(finalizeReportPath),
      });
    }
    supportResult = await executeHandoff({
      handoffPlanPath: supportPlan!,
      ledgerDir,
      outDir: path.join(scopeDir, `${type}-source-contact-support-handoff`),
      logDir,
      label: `${type}.support`,
    });
  } finally {
    releaseSupportCommit();
  }
  if (!supportResult) return finalizeReport;
  stages.push(...supportResult.stages);
  if (supportResult.status !== "completed") {
    return {
      ...finalizeReport,
      status: "blocked",
      blockers: [...supportResult.blockers, ...recordArray(finalizeReport.blockers)],
    };
  }
  for (const identityKey of supportIdentityKeys) verifiedSupportIdentities.add(identityKey);
  appendSupportIdentityCacheRows({
    cacheFile: supportIdentityCacheFile,
    identityKeys: supportIdentityKeys,
    source: `${type}.support_handoff`,
    report: supportResult.closeoutReportPath ?? null,
  });
  const rerun = await runFinalizeStage({
    stage: `${type}.finalize_after_support`,
    args: finalizeArgs,
    reportPath: finalizeReportPath,
    logDir,
  });
  stages.push(rerun);
  return rerun.json!;
}

async function finalizeAndCommitDataset({
  type,
  rowsFile,
  scopeDir,
  runDir,
  materialized,
  classificationApplyReport,
  locationApplyReport,
  identityApplyReports,
  patchCollectReport,
  patchApplyReport,
  targetUserId,
  stateCode,
  logDir,
  ledgerDir,
  stages,
  supportIdentityCacheFile,
}: FinalizeAndCommitInput): Promise<DatasetCommitResult> {
  const context = defaultContext(runDir, type);
  const finalizeDir = path.join(scopeDir, `finalize-${type}-ready`);
  const finalizeReportPath = path.join(finalizeDir, "dataset-post-authoring-finalize-report.json");
  let currentRowsFile = rowsFile;
  const currentIdentityApplyReports = [...(identityApplyReports ?? [])];
  let currentPatchCollectReport = patchCollectReport;
  let currentPatchApplyReport = patchApplyReport;
  let finalizeReport = null;
  let finalizeArgs = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    finalizeArgs = buildFinalizeArgs({
      type,
      rowsFile: currentRowsFile,
      outDir: finalizeDir,
      ledgerDir,
      sourceSupportRowsFile: materialized.supportRowsFile,
      sourceRowsFile: materialized.sourceRowsFile,
      flowpropertyRowsFile: materialized.flowpropertyRowsFile,
      unitgroupRowsFile: materialized.unitgroupRowsFile,
      identityPreflightIndex: materialized.identityPreflightIndex,
      context,
      classificationQueue: materialized.classificationQueue,
      locationQueue: materialized.locationQueue,
      classificationApplyReport,
      locationApplyReport,
      identityApplyReports: currentIdentityApplyReports,
      patchCollectReport: currentPatchCollectReport,
      patchApplyReport: currentPatchApplyReport,
      targetUserId,
      stateCode,
    });
    const finalize = await runFinalizeStage({
      stage:
        attempt === 0
          ? `${type}.finalize_ready`
          : `${type}.finalize_ready_after_authoring_${attempt}`,
      args: finalizeArgs,
      reportPath: finalizeReportPath,
      logDir,
    });
    stages.push(finalize);
    if (finalize.finalize_report_missing) {
      finalizeReport = finalize.json!;
      return {
        status: "failed",
        blocker: firstBlocker(
          finalizeReport,
          "finalize_report_missing",
          `${type} finalize did not write the expected report.`,
        ),
        report: finalizeReportPath,
        finalizeReport,
      };
    }
    finalizeReport = await maybeCommitSupportThenRerunFinalize({
      type,
      finalizeReport: finalize.json!,
      finalizeReportPath,
      finalizeArgs,
      ledgerDir,
      scopeDir,
      logDir,
      stages,
      supportIdentityCacheFile,
    });
    if (finalizeReport?.status === "ready_for_remote_write") break;
    const gateReport = resolveRepoPath(jsonRecord(finalizeReport.files).curation_gate_report);
    if (!fileExists(gateReport)) break;
    const recovery = await runIdentityAndPatch({
      type,
      inputRowsFile: currentRowsFile,
      preFinalizeReport: finalizeReport,
      scopeDir,
      runDir,
      logDir,
      stages,
      label: `${type}-post-finalize-${attempt + 1}`,
      stagePrefix: `${type}.post_finalize_${attempt + 1}`,
    });
    if (recovery.status !== "completed") {
      return {
        status: "blocked",
        blocker: recovery.blocker,
        report: recovery.report ?? finalizeReportPath,
        finalizeReport,
      };
    }
    const producedEvidence =
      recovery.identityApplyReport || recovery.patchCollectReport || recovery.patchApplyReport;
    if (!producedEvidence) break;
    currentRowsFile = recovery.rowsFile;
    if (recovery.identityApplyReport)
      currentIdentityApplyReports.push(recovery.identityApplyReport);
    if (recovery.patchCollectReport) currentPatchCollectReport = recovery.patchCollectReport;
    if (recovery.patchApplyReport) currentPatchApplyReport = recovery.patchApplyReport;
  }
  if (finalizeReport?.status !== "ready_for_remote_write") {
    return {
      status: "blocked",
      blocker: firstBlocker(
        finalizeReport,
        `${type}_finalize_not_ready`,
        `${type} finalize status is ${finalizeReport?.status || "missing"}.`,
      ),
      report: finalizeReportPath,
      finalizeReport,
    };
  }
  const handoffPlan = resolveRepoPath(jsonRecord(finalizeReport.files).commit_handoff_plan);
  const handoff = await executeHandoff({
    handoffPlanPath: handoffPlan!,
    ledgerDir,
    outDir: path.join(scopeDir, `${type}-handoff`),
    logDir,
    label: type,
  });
  stages.push(...handoff.stages);
  if (handoff.status !== "completed") {
    return {
      status: "failed",
      blocker: handoff.blockers?.[0] ?? {
        code: `${type}_handoff_failed`,
        message: `${type} commit/verify handoff failed.`,
      },
      report: finalizeReportPath,
      finalizeReport,
      handoff,
    };
  }
  return {
    status: "completed",
    report: finalizeReportPath,
    finalizeReport,
    handoff,
  };
}

// --- Post-commit disk reclamation -----------------------------------------
// A committed scope's heavy per-scope scratch (flow-pre-finalize — which holds the
// multi-GB mutation-manifest items file + curation-gate — plus flow-identity-task and
// flow-authoring-tasks) is pure derived data once the scope verifies: the remote is the
// source of truth, and import-ledger + scope-run-report.json carry the audit trail.
// Without trimming, each committed mega-scope leaves ~15G behind, so the run directory
// grows without bound. Delete every child of scopeDir except the two audit artifacts.
// Best-effort (never fails the import), gated on a real commit; --keep-scratch (or
// BAFU_KEEP_SCOPE_SCRATCH=1) opts out for debugging / re-verify sessions.
const VERIFIED_SCOPE_KEEP = new Set(["import-ledger", "scope-run-report.json"]);
function keepScratchRequested(options: JsonRecord): boolean {
  return booleanOption(options?.keepScratch) || process.env.BAFU_KEEP_SCOPE_SCRATCH === "1";
}
function trimVerifiedScopeScratch(scopeDir: string, options: JsonRecord): void {
  if (!booleanOption(options?.commit)) return;
  if (keepScratchRequested(options)) return;
  let entries;
  try {
    entries = fs.readdirSync(scopeDir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (VERIFIED_SCOPE_KEEP.has(entry.name)) continue;
    try {
      fs.rmSync(path.join(scopeDir, entry.name), { recursive: true, force: true });
    } catch {
      // best-effort: a locked or partially-written dir must never fail the import
    }
  }
}

// The shared-context-cache (runDir/shared-context-cache) is a run-level, content-addressed
// store of inlined authoring context with no eviction, so across thousands of scopes it grew
// to ~118G. Cross-scope hits are rare (per-scope context differs); the real value is
// intra-scope dedup. Bound it: once it exceeds a cap, clear it. Cheap (names only, no
// per-file stat), robust to mid-run kills, correctness-safe (a miss just recomputes).
const SHARED_CONTEXT_CACHE_MAX_ENTRIES = (() => {
  const raw = Number(process.env.BAFU_CONTEXT_CACHE_MAX_ENTRIES);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 6000;
})();
function enforceSharedContextCacheCap(
  runDir: string,
  options: JsonRecord,
  maxEntries = SHARED_CONTEXT_CACHE_MAX_ENTRIES,
): void {
  if (keepScratchRequested(options)) return;
  const cacheDir = path.join(runDir, "shared-context-cache");
  let names;
  try {
    names = fs.readdirSync(cacheDir);
  } catch {
    return;
  }
  if (names.length <= maxEntries) return;
  for (const name of names) {
    try {
      fs.rmSync(path.join(cacheDir, name), { recursive: true, force: true });
    } catch {
      // best-effort
    }
  }
}

export function createBafuBatchImportRunCommands(
  deps: BafuBatchRuntime,
  config: BafuBatchConfig = {},
): {
  runDatasetBafuBatchImportRun: (options?: JsonRecord) => Promise<JsonRecord>;
  runDatasetBafuUniverseCoverageReport: (options?: JsonRecord) => JsonRecord;
} {
  installBafuBatchRuntime(deps, config);
  const universeCoverage = createUniverseCoverageService(
    createUniverseCoverageRuntimeAdapter(deps),
  );
  const { ledgerFiles, resolveLedgerSourceDirs, summarizeLedgerSources, sumLedgerSourceRows } =
    universeCoverage;
  const scopePreparation = createBatchScopePreparationService({
    io: {
      processExecPath: process.execPath,
      foundryEntryPath,
      joinPath: (...parts) => path.join(...parts),
      repoRelative,
      resolveRepoPath,
      fileExists,
      readJsonLines,
    },
    operations: {
      runArgvStage,
      foundryCommand,
      activeProfile,
      libraryContact: () => jsonRecord(bafuBatchConfig.libraryContact),
      firstBlocker,
      repairClassificationDecisionCodes,
      defaultContext,
      reportFile,
      outputRowsByStem,
      findOneFile,
    },
  });
  const scopeExecution = createBatchScopeExecutionService({
    io: {
      processExecPath: process.execPath,
      foundryEntryPath,
      rerunCommandName: commandName,
      joinPath: (...parts) => path.join(...parts),
      ensureDirectory: (directory) => fs.mkdirSync(directory, { recursive: true }),
      nowIso,
      asText,
      integerOption,
      booleanOption,
      repoRelative,
      resolveRepoPath,
      fileExists,
      readJsonLines,
      readRows,
      writeJson,
      writeJsonLines,
      appendJsonLine,
    },
    operations: {
      prepareScope: scopePreparation.prepareScope,
      requestedProcessIdValues,
      familyPlanFields: (signature) => bafuFamilyPlanFields(signature as BafuFamilySignature),
      compactFamilySignature: (signature, relativePath) =>
        compactBafuFamilySignature(signature as BafuFamilySignature, relativePath),
      commandString,
      blockRow,
      categoryForBlocker,
      retryableStageFailure,
      firstBlocker,
      datasetIdentity,
      datasetIdentityKey,
      flowRowsPendingVerification,
      writeScopeCarriedForwardVerifiedFlowRows,
      existingIdentityApplyReportsWithReferenceRewrites,
      uniqueExistingPaths,
      buildFinalizeArgs,
      runFinalizeStage,
      defaultContext,
      commitFlowSupportInline,
      maybeCommitSupportThenRerunFinalize,
      runIdentityAndPatch,
      preFinalizeRecoveryBlocker,
      finalizeAndCommitDataset,
      invalidateIdentityPreflightResultCacheEntry,
      okDatasetRow,
      executeHandoff,
      trimVerifiedScopeScratch,
    },
  });

  function runDatasetBafuUniverseCoverageReport(options: JsonRecord = {}): JsonRecord {
    if (options.help) {
      return {
        schema_version: 1,
        status: "help",
        command: coverageCommandName,
        usage: [
          "node scripts/foundry.ts dataset-bafu-universe-coverage-report --run-dir .foundry/workspaces/<bafu-run> --ledger-source-dir <batch/import-ledger> --out-dir <coverage-dir>",
          "node scripts/foundry.ts dataset-bafu-universe-coverage-report --input-dir 'inputs/BAFU-2025 Version 2 - TIDAS 2026-03-09' --scope-file <ready-scopes.jsonl> --ledger-source-dir <batch/import-ledger>",
        ],
        purpose:
          "Build a read-only BAFU full-universe coverage report from process-bundles, ready scopes, flow references, and explicit ledger sources.",
        remote_write_mode: "read-only",
      };
    }
    return universeCoverage.runReport(options, {
      commandName: coverageCommandName,
      defaultInputDir: "inputs/BAFU-2025 Version 2 - TIDAS 2026-03-09",
    });
  }

  async function runDatasetBafuBatchImportRun(options: JsonRecord = {}): Promise<JsonRecord> {
    // Re-install this factory's profile config so a sibling factory (e.g. USLCI)
    // constructed against the same module cannot leak its config into this run.
    // Runs are sequential, so this is race-free.
    installBafuBatchRuntime(deps, config);
    if (options.help || options.h) {
      return {
        schema_version: 1,
        status: "help",
        command: activeCommandName(),
        usage: [
          "node scripts/foundry.ts dataset-bafu-batch-import-run --scope-file <ready-scopes.jsonl> --process-bundles-dir <.../process-bundles> --run-dir <run-dir> --out-dir <run-dir>/batch-import --parallel 5 --commit",
          "node scripts/foundry.ts dataset-bafu-batch-import-run --scope-file <ready-scopes.jsonl> --out-dir <existing-batch-dir> --pending-only --selection-order estimated-weight-asc --limit 20 --pause-file <pause.flag> --commit",
          "node scripts/foundry.ts dataset-bafu-batch-import-run --scope-file <ready-scopes.jsonl> --pending-only --selection-order family-master-first --preflight-only",
          "node scripts/foundry.ts dataset-bafu-batch-import-run --scope-file <ready-scopes.jsonl> --pending-only --require-leaf-classification --preflight-only",
          "node scripts/foundry.ts dataset-bafu-batch-import-run --scope-file <ready-scopes.jsonl> --out-dir <new-batch-dir> --ledger-source-dir <previous-batch-dir> --pending-only --preflight-only",
          "node scripts/foundry.ts dataset-bafu-batch-import-run --scope-file <ready-scopes.jsonl> --out-dir <existing-batch-dir> --pending-only --selection-order estimated-weight-asc --preflight-only",
          "node scripts/foundry.ts dataset-bafu-batch-import-run --scope-file <ready-scopes.jsonl> --process-id <uuid> --commit",
          "node scripts/foundry.ts dataset-bafu-batch-import-run --scope-file <ready-scopes.jsonl> --process-id-file <retry-ids.txt> --commit (one id per line; blank lines and # comments ignored)",
        ],
        purpose:
          "Run BAFU ready process scopes through materialize, semantic decisions, dependency flow commit, support commit, process commit, readback verify, and resumable ledgers.",
        ...bafuBatchStageContract,
      };
    }

    const runDir = resolveRepoPath(
      options.runDir || path.dirname(resolveRepoPath(options.scopeFile || "") || repoRoot),
    )!;
    const scopeFile = resolveRepoPath(
      options.scopeFile ||
        path.join(runDir, "library-resolution-v4-leaf-category-map", "ready-scopes.jsonl"),
    )!;
    const processBundlesDir = resolveRepoPath(
      options.processBundlesDir ||
        options.bundlesDir ||
        "inputs/BAFU-2025 Version 2 - TIDAS 2026-03-09/process-bundles",
    )!;
    if (!fileExists(scopeFile)) throw new Error("--scope-file is required.");
    if (!directoryExists(processBundlesDir)) throw new Error("--process-bundles-dir is required.");
    if (!directoryExists(runDir)) throw new Error("--run-dir is required.");
    const outDir = resolveRepoPath(options.outDir || path.join(runDir, "batch-import"))!;
    const commit = booleanOption(options.commit);
    const preflightOnly = booleanOption(options.preflightOnly || options.planOnly);
    if (!commit && !preflightOnly) {
      throw new Error(
        `${commandName} requires --commit for remote writes, or --preflight-only for a read-only execution plan.`,
      );
    }
    const targetUserId = asText(options.targetUserId);
    if (!preflightOnly && !targetUserId) throw new Error("--target-user-id is required.");
    const stateCode = integerOption(options.stateCode, 0) ?? 0;
    const parallel = Math.max(1, Math.min(20, integerOption(options.parallel, 5) ?? 5));
    const limit = options.limit == null ? null : Math.max(0, integerOption(options.limit, 0) ?? 0);
    const requestedProcessIds = new Set(requestedProcessIdValues(options));
    const pendingOnly = booleanOption(options.pendingOnly);
    const force = booleanOption(options.force);
    const selectionOrder = selectionOrderOption(options.selectionOrder || options.scopeOrder);
    const requireLeafClassification = booleanOption(
      options.requireLeafClassification || options.leafClassificationOnly,
    );
    // FIX A: optional authoritative library-resolution directory holding the proven
    // per-process per-exchange elementary reuses (exchange-reference-rewrites.jsonl).
    // Only consumed when the profile config enables applyResolutionRewrites (USLCI).
    const libraryResolutionDir = asText(options.libraryResolution || options.libraryResolutionDir)
      ? resolveRepoPath(options.libraryResolution || options.libraryResolutionDir)
      : null;
    const resolutionRewritesByProcess =
      applyResolutionRewrites() && libraryResolutionDir
        ? loadResolutionRewritesByProcess(libraryResolutionDir)
        : new Map();
    const pauseFile = asText(options.pauseFile) ? resolveRepoPath(options.pauseFile) : null;
    const stopAfterBlocked =
      options.stopAfterBlocked == null
        ? null
        : Math.max(1, integerOption(options.stopAfterBlocked, 1) ?? 1);
    fs.mkdirSync(outDir, { recursive: true });
    const paths: BatchPaths = {
      runDir,
      outDir,
      scopeFile,
      processBundlesDir,
      libraryClassificationDecisions: resolveRepoPath(
        options.libraryClassificationDecisions ||
          path.join(runDir, "decisions-v4-leaf-category-map", "classification-decisions.jsonl"),
      ),
      scopeCheckpoints: path.join(outDir, "scope-checkpoints.jsonl"),
      okFlows: path.join(outDir, "import-ledger", "ok.flows.verified.jsonl"),
      okProcesses: path.join(outDir, "import-ledger", "ok.processes.verified.jsonl"),
      okScopes: path.join(outDir, "import-ledger", "ok.scopes.verified.jsonl"),
      blockedHumanReview: path.join(outDir, "import-ledger", "blocked.scopes.human-review.jsonl"),
      blockedHumanReviewActive: path.join(
        outDir,
        "import-ledger",
        "blocked.scopes.human-review.active.jsonl",
      ),
      blockedHumanReviewResolved: path.join(
        outDir,
        "import-ledger",
        "blocked.scopes.human-review.resolved.jsonl",
      ),
      blocked_human_review: path.join(
        outDir,
        "import-ledger",
        "blocked.dependencies.human-review.jsonl",
      ),
      blocked_reference_closure: path.join(
        outDir,
        "import-ledger",
        "blocked.dependencies.reference-closure.jsonl",
      ),
      blocked_remote_write: path.join(
        outDir,
        "import-ledger",
        "blocked.dependencies.remote-write.jsonl",
      ),
      blockedOther: path.join(outDir, "import-ledger", "blocked.dependencies.other.jsonl"),
      failedRetry: path.join(outDir, "import-ledger", "failed.scopes.retry.jsonl"),
      supportIdentityCache: resolveRepoPath(
        options.verifiedSupportIdentitiesFile ||
          options.supportIdentityCache ||
          path.join(outDir, "import-ledger", "verified-support-identities.jsonl"),
      )!,
      preflightPlan: path.join(outDir, "import-ledger", "preflight.plan.jsonl"),
      bafuFamilySignatures: path.join(outDir, "import-ledger", "bafu-family-signatures.json"),
      // FIX A: run-level resolution rewrite index (process_id -> rewrite rows) plus the
      // mode flag, threaded into runOneScope -> flow runIdentityAndPatch. Empty map when
      // the flag is off or --library-resolution is not provided (BAFU defaults).
      resolutionRewritesByProcess,
      applyResolutionRewritesMode: applyResolutionRewrites(),
    };
    const ledgerSourceDirs = resolveLedgerSourceDirs(
      options.ledgerSourceDir ||
        options.ledgerSourceDirs ||
        options.carryForwardLedgerDir ||
        options.carryForwardLedgerDirs,
    );
    const ledgerSourceSummary = summarizeLedgerSources(ledgerSourceDirs);
    const okScopeFiles = [
      ...ledgerFiles(ledgerSourceDirs, "ok.scopes.verified.jsonl"),
      paths.okScopes,
    ];
    const okFlowFiles = [
      ...ledgerFiles(ledgerSourceDirs, "ok.flows.verified.jsonl"),
      paths.okFlows,
    ];
    const blockedScopeFiles = [
      ...ledgerFiles(ledgerSourceDirs, "blocked.scopes.human-review.jsonl"),
      paths.blockedHumanReview,
    ];
    const allScopes = readJsonLines(scopeFile);
    const defaultProcessesDir = path.join(path.dirname(processBundlesDir), "tidas", "processes");
    const processFilesDir = resolveRepoPath(
      options.bafuProcessesDir ||
        options.processesDir ||
        (directoryExists(defaultProcessesDir) ? defaultProcessesDir : null),
    );
    const schemas = defaultSchemaFiles(options);
    const missingInputs = [
      paths.libraryClassificationDecisions,
      defaultContext(runDir, "process").schemaFile,
      defaultContext(runDir, "process").yamlFile,
      defaultContext(runDir, "process").rulesetFile,
      defaultContext(runDir, "flow").schemaFile,
      defaultContext(runDir, "flow").yamlFile,
      defaultContext(runDir, "flow").rulesetFile,
      schemas.processCategory,
      schemas.flowProductCategory,
      schemas.location,
    ].filter((filePath) => !fileExists(filePath));
    if (missingInputs.length > 0) {
      throw new Error(
        `Missing required batch import inputs:\n${missingInputs.map(repoRelative).join("\n")}`,
      );
    }
    const verifiedScopes = loadVerifiedSetFromFiles(okScopeFiles, "scope");
    const verifiedFlows = loadVerifiedSetFromFiles(okFlowFiles, "flow");
    const verifiedFlowRowsByKey = loadVerifiedRowsByKeyFromFiles(okFlowFiles, "flow");
    const blockedScopes = loadActiveBlockedScopeSetFromFiles(blockedScopeFiles, verifiedScopes);
    const supportIdentityCache = primeVerifiedSupportIdentityCache({
      outDir,
      cacheFile: paths.supportIdentityCache,
      sourceLedgerDirs: ledgerSourceDirs,
    });
    const familySignatureIndex: BafuFamilyIndex = familySignaturesEnabled()
      ? buildBafuFamilySignatureIndex({
          scopes: allScopes,
          processBundlesDir,
          processesDir: directoryExists(processFilesDir) ? processFilesDir : null,
          readJson,
        })
      : ({ summary: {}, entries: [], byScopeKey: new Map() } as unknown as BafuFamilyIndex);
    const familyAdapter = {
      selectionRank: bafuFamilySelectionRank,
      planFields: bafuFamilyPlanFields,
    };
    const classificationDecisionIndex = buildClassificationDecisionIndex(
      readJsonLines(paths.libraryClassificationDecisions),
    );
    const selection = selectScopesForRun({
      allScopes,
      requestedProcessIds,
      verifiedScopes,
      blockedScopes,
      pendingOnly,
      force,
      selectionOrder,
      limit,
      familySignaturesByScopeKey: familySignatureIndex.byScopeKey,
      familyAdapter,
      classificationDecisionIndex,
      requireLeafClassification,
    });
    const scopes = selection.scopes;
    const selectedFamilySummary = summarizeBafuFamilyScopes(scopes, familySignatureIndex);
    writeJson(paths.bafuFamilySignatures, {
      schema_version: 1,
      generated_at_utc: nowIso(),
      status: "completed",
      command: activeCommandName(),
      scope_file: repoRelative(scopeFile),
      process_bundles_dir: repoRelative(processBundlesDir),
      processes_dir: repoRelative(processFilesDir),
      policy: {
        same_amount_vector:
          "Master plus variant generation is allowed only as a BAFU-specific authoring shortcut; each scope still runs schema validation, QA gates, remote write, and readback verification.",
        same_skeleton:
          "Authoring, curation, and identity decisions may be reused as templates only with amount, location, and source-specific text parameterized per scope.",
        standard: "Scopes without matching vectors or skeletons stay on the ordinary import path.",
      },
      counts: {
        all_scopes: familySignatureIndex.summary,
        selected_scopes: selectedFamilySummary,
      },
      entries: familySignatureIndex.entries.map((entry) =>
        compactBafuFamilySignature(entry, repoRelative),
      ),
      missing: familySignatureIndex.missing,
      files: {
        report: repoRelative(paths.bafuFamilySignatures),
      },
    });
    const manifest = {
      schema_version: 1,
      generated_at_utc: nowIso(),
      command: activeCommandName(),
      status: "running",
      mode: preflightOnly ? "preflight" : "commit",
      target_user_id: targetUserId,
      state_code: stateCode,
      preflight_only: preflightOnly,
      commit,
      parallel,
      counts: {
        input_scopes: allScopes.length,
        matched_scopes: selection.stats.matched_scopes,
        pending_candidate_scopes: selection.stats.candidate_scopes_before_limit,
        selected_scopes: scopes.length,
        filtered_already_verified_scopes: selection.stats.filtered_already_verified,
        filtered_already_blocked_scopes: selection.stats.filtered_already_blocked,
        filtered_classification_missing_scopes: selection.stats.filtered_classification_missing,
        filtered_classification_not_leaf_scopes: selection.stats.filtered_classification_not_leaf,
        already_verified_scopes: verifiedScopes.size,
        already_verified_flows: verifiedFlows.size,
        already_blocked_scopes: blockedScopes.size,
        verified_support_identities: verifiedSupportIdentities.size,
        ledger_source_dirs: ledgerSourceSummary.length,
        ledger_source_ok_scope_rows: sumLedgerSourceRows(ledgerSourceSummary, "ok_scope_rows"),
        ledger_source_ok_flow_rows: sumLedgerSourceRows(ledgerSourceSummary, "ok_flow_rows"),
        ledger_source_blocked_scope_rows: sumLedgerSourceRows(
          ledgerSourceSummary,
          "blocked_scope_rows",
        ),
        library_classification_decisions: classificationDecisionIndex.row_count,
        indexed_library_classification_decisions: classificationDecisionIndex.indexed_decisions,
      },
      bafu_family_signatures: {
        all_scopes: familySignatureIndex.summary,
        selected_scopes: selectedFamilySummary,
      },
      files: Object.fromEntries(
        Object.entries(paths).flatMap(([key, value]) =>
          typeof value === "string" ? [[key, repoRelative(value)]] : [],
        ),
      ),
      selection: {
        pending_only: pendingOnly,
        selection_order: selectionOrder,
        limit,
        requested_process_ids: [...requestedProcessIds],
        require_leaf_classification: requireLeafClassification,
        ledger_source_dirs: ledgerSourceDirs.map(repoRelative),
        pause_file: repoRelative(pauseFile),
        stop_after_blocked: stopAfterBlocked,
      },
      support_identity_cache: supportIdentityCache,
      ledger_sources: ledgerSourceSummary,
      policy: {
        ready_scopes_only: true,
        blocked_scopes_deferred: true,
        pending_only_filters_before_limit: pendingOnly,
        read_only_preflight_supported: true,
        stop_after_blocked_supported: true,
        process_scope_atomic_commit: true,
        support_and_flows_commit_before_process_commit: true,
        retryable_remote_failures_are_separate_from_human_review: true,
        bafu_family_reuse_is_dataset_specific: true,
        bafu_family_variants_still_require_per_scope_schema_qa_remote_verify: true,
        ledger_source_dirs_are_read_only_carry_forward_inputs: true,
        require_leaf_classification_filters_only_library_decision_readiness:
          requireLeafClassification,
      },
    };
    writeJson(path.join(outDir, "import-ledger", "run-manifest.json"), manifest);
    if (preflightOnly) {
      writeJsonLines(
        paths.preflightPlan,
        preflightPlanRows({
          scopes,
          verifiedScopes,
          blockedScopes,
          familySignaturesByScopeKey: familySignatureIndex.byScopeKey,
          familyAdapter,
          classificationDecisionIndex,
        }),
      );
      const report = {
        schema_version: 1,
        generated_at_utc: nowIso(),
        command: activeCommandName(),
        status: "preflight_completed",
        mode: "preflight",
        parallel,
        target_user_id: targetUserId || null,
        selection: manifest.selection,
        support_identity_cache: supportIdentityCache,
        bafu_family_signatures: {
          all_scopes: familySignatureIndex.summary,
          selected_scopes: selectedFamilySummary,
        },
        counts: {
          selected_scopes: scopes.length,
          processed_scopes: 0,
          pending_candidate_scopes: selection.stats.candidate_scopes_before_limit,
          filtered_already_verified_scopes: selection.stats.filtered_already_verified,
          filtered_already_blocked_scopes: selection.stats.filtered_already_blocked,
          filtered_classification_missing_scopes: selection.stats.filtered_classification_missing,
          filtered_classification_not_leaf_scopes: selection.stats.filtered_classification_not_leaf,
          already_verified_scopes: verifiedScopes.size,
          already_verified_flows: verifiedFlows.size,
          already_blocked_scopes: blockedScopes.size,
          verified_support_identities: verifiedSupportIdentities.size,
          ledger_source_dirs: ledgerSourceSummary.length,
          ledger_source_ok_scope_rows: sumLedgerSourceRows(ledgerSourceSummary, "ok_scope_rows"),
          ledger_source_ok_flow_rows: sumLedgerSourceRows(ledgerSourceSummary, "ok_flow_rows"),
          ledger_source_blocked_scope_rows: sumLedgerSourceRows(
            ledgerSourceSummary,
            "blocked_scope_rows",
          ),
          library_classification_decisions: classificationDecisionIndex.row_count,
          indexed_library_classification_decisions: classificationDecisionIndex.indexed_decisions,
          selected_same_amount_vector_scopes: selectedFamilySummary.same_amount_vector_scopes,
          selected_same_skeleton_only_scopes: selectedFamilySummary.same_skeleton_only_scopes,
          selected_standard_scopes: selectedFamilySummary.standard_scopes,
        },
        files: {
          report: repoRelative(path.join(outDir, "dataset-bafu-batch-import-run-report.json")),
          run_manifest: repoRelative(path.join(outDir, "import-ledger", "run-manifest.json")),
          preflight_plan: repoRelative(paths.preflightPlan),
          bafu_family_signatures: repoRelative(paths.bafuFamilySignatures),
          support_identity_cache: repoRelative(paths.supportIdentityCache),
        },
        ledger_sources: ledgerSourceSummary,
      };
      writeJson(path.join(outDir, "dataset-bafu-batch-import-run-report.json"), report);
      writeJson(path.join(outDir, "import-ledger", "run-manifest.json"), {
        ...manifest,
        status: report.status,
        finished_at_utc: report.generated_at_utc,
        final_counts: report.counts,
      });
      return report;
    }

    const results: JsonRecord[] = [];
    let nextIndex = 0;
    let pauseObserved = false;
    let stoppedAfterBlocked = false;
    function pauseRequested() {
      if (!pauseFile || !fileExists(pauseFile)) return false;
      pauseObserved = true;
      return true;
    }
    function stopRequested() {
      return stoppedAfterBlocked;
    }
    async function worker(workerIndex: number): Promise<void> {
      while (nextIndex < scopes.length) {
        if (pauseRequested() || stopRequested()) break;
        const scope = scopes[nextIndex];
        const familySignature = bafuFamilySignatureForScope(familySignatureIndex, scope);
        nextIndex += 1;
        let result: JsonRecord;
        try {
          result = await scopeExecution.runOneScope({
            scope,
            familySignature,
            options: { ...options, targetUserId, stateCode },
            paths,
            schemas,
            verifiedScopes,
            verifiedFlows,
            verifiedFlowRowsByKey,
            blockedScopes,
            workerIndex,
          });
        } catch (error) {
          result = recordScopeExecutionException({ scope, familySignature, error, paths });
        }
        results.push({
          process_id: scope.process_id || scope.id,
          status: result.status,
          ...bafuFamilyPlanFields(familySignature),
        });
        try {
          enforceSharedContextCacheCap(paths.runDir, options);
        } catch {
          /* best-effort cache cap; never abort the run on a cache-eviction fs race */
        }
        if (
          stopAfterBlocked != null &&
          results.filter((row) => row.status === "blocked").length >= stopAfterBlocked
        ) {
          stoppedAfterBlocked = true;
        }
      }
    }
    await Promise.all(Array.from({ length: parallel }, (_, index) => worker(index)));
    const blockedScopeViews = writeBlockedScopeViews(paths);
    const pausedNotStarted =
      pauseObserved || stoppedAfterBlocked ? scopes.length - results.length : 0;

    const report = {
      schema_version: 1,
      generated_at_utc: nowIso(),
      command: activeCommandName(),
      status: batchRunStatus(results, { paused: pauseObserved, stoppedAfterBlocked }),
      mode: "commit",
      parallel,
      target_user_id: targetUserId,
      selection: manifest.selection,
      support_identity_cache: supportIdentityCache,
      bafu_family_signatures: {
        all_scopes: familySignatureIndex.summary,
        selected_scopes: selectedFamilySummary,
      },
      counts: {
        selected_scopes: scopes.length,
        pending_candidate_scopes: selection.stats.candidate_scopes_before_limit,
        filtered_already_verified_scopes: selection.stats.filtered_already_verified,
        filtered_already_blocked_scopes: selection.stats.filtered_already_blocked,
        filtered_classification_missing_scopes: selection.stats.filtered_classification_missing,
        filtered_classification_not_leaf_scopes: selection.stats.filtered_classification_not_leaf,
        processed_scopes: results.length,
        paused_not_started: pausedNotStarted,
        stopped_after_blocked: stoppedAfterBlocked,
        verified: results.filter((row) => row.status === "verified").length,
        skipped: results.filter((row) => row.status === "skipped").length,
        skipped_blocked: results.filter((row) => row.status === "skipped_blocked").length,
        blocked: results.filter((row) => row.status === "blocked").length,
        failed_retryable: results.filter((row) => row.status === "failed").length,
        ok_scope_ledger_rows: readJsonLines(paths.okScopes).length,
        ok_flow_ledger_rows: readJsonLines(paths.okFlows).length,
        human_review_rows: blockedScopeViews.active,
        historical_human_review_rows: blockedScopeViews.historical,
        resolved_human_review_rows: blockedScopeViews.resolved,
        retry_rows: readJsonLines(paths.failedRetry).length,
        already_verified_scopes: verifiedScopes.size,
        already_verified_flows: verifiedFlows.size,
        already_blocked_scopes: blockedScopes.size,
        verified_support_identities: verifiedSupportIdentities.size,
        ledger_source_dirs: ledgerSourceSummary.length,
        ledger_source_ok_scope_rows: sumLedgerSourceRows(ledgerSourceSummary, "ok_scope_rows"),
        ledger_source_ok_flow_rows: sumLedgerSourceRows(ledgerSourceSummary, "ok_flow_rows"),
        ledger_source_blocked_scope_rows: sumLedgerSourceRows(
          ledgerSourceSummary,
          "blocked_scope_rows",
        ),
        library_classification_decisions: classificationDecisionIndex.row_count,
        indexed_library_classification_decisions: classificationDecisionIndex.indexed_decisions,
        selected_same_amount_vector_scopes: selectedFamilySummary.same_amount_vector_scopes,
        selected_same_skeleton_only_scopes: selectedFamilySummary.same_skeleton_only_scopes,
        selected_standard_scopes: selectedFamilySummary.standard_scopes,
      },
      files: {
        report: repoRelative(path.join(outDir, "dataset-bafu-batch-import-run-report.json")),
        run_manifest: repoRelative(path.join(outDir, "import-ledger", "run-manifest.json")),
        scope_checkpoints: repoRelative(paths.scopeCheckpoints),
        ok_scopes: repoRelative(paths.okScopes),
        ok_flows: repoRelative(paths.okFlows),
        ok_processes: repoRelative(paths.okProcesses),
        blocked_human_review: repoRelative(paths.blockedHumanReview),
        blocked_human_review_active: repoRelative(paths.blockedHumanReviewActive),
        blocked_human_review_resolved: repoRelative(paths.blockedHumanReviewResolved),
        failed_retry: repoRelative(paths.failedRetry),
        bafu_family_signatures: repoRelative(paths.bafuFamilySignatures),
        support_identity_cache: repoRelative(paths.supportIdentityCache),
      },
      results,
      ledger_sources: ledgerSourceSummary,
    };
    writeJson(path.join(outDir, "dataset-bafu-batch-import-run-report.json"), report);
    writeJson(path.join(outDir, "import-ledger", "run-manifest.json"), {
      ...manifest,
      status: report.status,
      finished_at_utc: report.generated_at_utc,
      final_counts: report.counts,
      pause_observed: pauseObserved,
      stopped_after_blocked: stoppedAfterBlocked,
    });
    return report;
  }

  return { runDatasetBafuBatchImportRun, runDatasetBafuUniverseCoverageReport };
}

export const bafuBatchImportRunTestHooks = {
  commitFailuresAllAlreadyExist,
  enforceSharedContextCacheCap,
  flowRowsPendingVerification,
  foundryCommand,
  identityUnresolvedReferenceBlocker,
  invalidateIdentityPreflightResultCacheEntry,
  mergeCompletedReusableIdentityDecisions,
  postWriteVerifyRetryReason,
  preFinalizeRecoveryBlocker,
  requestedProcessIdValues,
  retryableStageFailure,
  sha256File,
  splitSupportIdentityKey,
  supportIdentityKeysFromHandoffPlan,
  supportIdentityTypes,
  trimVerifiedScopeScratch,
  writeScopeCarriedForwardVerifiedFlowRows,
  // Test-only: drive the profile-config flags (e.g. mintUnmatchedFpUgSupport) that
  // gate the FP/UG support-identity behavior without standing up a full run.
  setBafuBatchConfigForTest: (config: BafuBatchConfig): void => {
    bafuBatchConfig = config || {};
  },
};

import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  bafuFamilyPlanFields,
  bafuFamilySelectionRank,
  bafuFamilySignatureForScope,
  buildBafuFamilySignatureIndex,
  compactBafuFamilySignature,
  summarizeBafuFamilyScopes,
} from "../lib/bafu-family-signatures.mjs";
import {
  acceptTraceHashOnlyRemoteVerificationMismatch,
  acceptTrustedExternalReferenceMissingDataset,
} from "../lib/remote-verification-accepted-diff.mjs";
import { resolveInstalledTiangongLcaCliPackage } from "../lib/foundry-runtime-utils.mjs";
import { stageContract } from "../lib/stage-contract.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const commandName = "dataset-bafu-batch-import-run";
const coverageCommandName = "dataset-bafu-universe-coverage-report";
let supportCommitQueue = Promise.resolve();
const verifiedSupportIdentities = new Set();
// Trusted external reference flows: `${table}\0${id}\0${version}` keys for datasets that
// exist remotely but are invisible to the importing account through RLS (worldsteel
// references to USLCI-account state_code=0 flows, verified present via the USLCI token and
// reused by governance rule). The post-write verify's RLS-scoped readback falsely reports
// these as missing_dataset; executeHandoff accepts that single blocker class for these
// keys only. Empty for BAFU/USLCI, so their runs are unchanged.
const trustedExternalReferenceFlows = new Set();
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
];

let bafuBatchRuntime = null;
// Profile config lets the same engine drive other profiles (e.g. USLCI) without
// changing BAFU behavior: every default below reproduces the BAFU runner exactly,
// so an empty config == the historical BAFU runner.
let bafuBatchConfig = {};

function installBafuBatchRuntime(deps, config = {}) {
  const missing = bafuBatchRuntimeKeys.filter((key) => typeof deps?.[key] !== "function");
  if (missing.length > 0) {
    throw new Error(`createBafuBatchImportRunCommands missing dependencies: ${missing.join(", ")}`);
  }
  bafuBatchRuntime = deps;
  bafuBatchConfig = config || {};
  trustedExternalReferenceFlows.clear();
  for (const ref of Array.isArray(bafuBatchConfig.trustedExternalReferenceFlows)
    ? bafuBatchConfig.trustedExternalReferenceFlows
    : []) {
    const table = String(ref?.table || "flows");
    const id = String(ref?.id || "");
    const version = String(ref?.version || "00.00.001");
    if (id) trustedExternalReferenceFlows.add(`${table} ${id} ${version}`);
  }
}

function runtime() {
  if (!bafuBatchRuntime) {
    throw new Error("createBafuBatchImportRunCommands must install command dependencies.");
  }
  return bafuBatchRuntime;
}

// Profile-config accessors. Defaults == BAFU, so BAFU is byte-for-byte unchanged.
function activeProfile() {
  return bafuBatchConfig.profile || "bafu";
}
function activeCommandName() {
  return bafuBatchConfig.commandName || commandName;
}
function bafuAutofillEnabled() {
  return bafuBatchConfig.enableBafuAutofill !== false;
}
function familySignaturesEnabled() {
  return bafuBatchConfig.enableFamilySignatures !== false;
}
function activeDefaults() {
  return bafuBatchConfig.defaults || {};
}
// When true, the dependency-flow finalize commits its source/contact support
// (the shared library contact) inline right after pre-finalize — mirroring the
// process path — so the first scope of a never-before-imported library can prove
// reference closure for its own flows. BAFU leaves this false: its FOEN library
// contact already exists remotely, so flow pre-finalize is closure-clean and the
// inline support commit would be redundant.
function commitFlowSupportInline() {
  return Boolean(bafuBatchConfig.commitFlowSupportInline);
}
// When true, the finalize lifts the scope's UNMATCHED (non-canonical) Unit Groups
// and Flow Properties into the support commit set so they are minted as
// account-local My Data once and committed before the flows that reference them
// (P1a of the BAFU-cleanup backlog). USLCI-only: BAFU keeps FP/UG reference-only
// and must not start minting them even though its profile also has the
// account-local override enabled.
function mintUnmatchedFpUgSupport() {
  return Boolean(bafuBatchConfig.mintUnmatchedFpUgSupport);
}
// The dataset types the runner tracks as account-local "support" identities. BAFU
// (and every non-USLCI profile) commits only contacts + true sources as support, so
// its support identity set, reuse-skip condition, cache, and cross-scope discovery
// stay exactly contact|source — unchanged. Under --mint-unmatched-fp-ug-support
// (USLCI only), minted Flow Properties and Unit Groups are ALSO account-local
// support: they must be tracked as support identities so the reuse-skip branch does
// not falsely short-circuit the support commit (a contact already verified must not
// hide an un-committed minted FP/UG), and so a committed FP/UG can be reused across
// scopes. Order is irrelevant; membership is what gates.
function supportIdentityTypes() {
  return mintUnmatchedFpUgSupport()
    ? ["contact", "source", "unitgroup", "flowproperty"]
    : ["contact", "source"];
}
// When true (USLCI only), the flow-identity step applies the authoritative
// library-resolution exchange-reference-rewrites deterministically: every flow the
// resolution proved reusable becomes a canonical reference, only flows with NO
// rewrite mint. This replaces the brittle decisions-* carry-forward whose additions
// frequently came out empty (apply skipped -> dependency flows wrongly minted even
// when the offline resolution already matched them to canonical). BAFU keeps this
// false: its reuse runs entirely through autofill + carry-forward.
function applyResolutionRewrites() {
  return Boolean(bafuBatchConfig.applyResolutionRewrites);
}

function nowIso() {
  return runtime().nowIso();
}

function resolveRepoPath(value) {
  return runtime().resolveRepoPath(value);
}

function repoRelative(filePath) {
  return runtime().repoRelativeMaybe(filePath);
}

function fileExists(filePath) {
  return runtime().fileExists(filePath);
}

function directoryExists(filePath) {
  return runtime().directoryExists(filePath);
}

function readJson(filePath) {
  return runtime().readJson(filePath);
}

function readJsonLines(filePath) {
  if (!fileExists(filePath)) return [];
  return runtime().readJsonLines(filePath);
}

function writeJson(filePath, value) {
  runtime().writeJson(filePath, value);
}

function writeJsonLines(filePath, rows) {
  runtime().writeJsonLines(filePath, rows);
}

function appendJsonLine(filePath, row) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.appendFileSync(filePath, `${JSON.stringify(row)}\n`);
}

function sha256File(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function asText(value) {
  return runtime().asText(value);
}

function normalizeSearchText(value) {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\\+/gu, " ")
    .replace(/[^a-z0-9]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function booleanOption(value) {
  return runtime().booleanOption(value);
}

function integerOption(value, fallback) {
  return runtime().integerOption(value, fallback);
}

function normalizedList(value) {
  return runtime().normalizedList(value);
}

function requestedProcessIdValues(options) {
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

function uniqueValues(values) {
  return [...new Set(values.filter((value) => value != null && value !== ""))];
}

function shellQuote(value) {
  return runtime().shellQuote(value);
}

function commandString(argv) {
  return argv.map(shellQuote).join(" ");
}

function datasetIdentity(row, type) {
  const injected = runtime().datasetIdentity(row, type);
  if (injected?.id || injected?.version) {
    return {
      id: injected.id ?? null,
      version: injected.version || "00.00.001",
    };
  }
  const root = row?.[`${type}DataSet`] ?? row;
  const dataSetInformation =
    root?.[`${type}Information`]?.dataSetInformation ??
    root?.[`${type}Information`]?.["common:dataSetInformation"] ??
    root?.processInformation?.dataSetInformation ??
    root?.flowInformation?.dataSetInformation ??
    {};
  const publication =
    root?.administrativeInformation?.publicationAndOwnership ??
    root?.administrativeInformation?.["common:publicationAndOwnership"] ??
    {};
  return {
    id:
      asText(dataSetInformation["common:UUID"]) ||
      asText(dataSetInformation.UUID) ||
      asText(row?.dataset_id) ||
      asText(row?.id),
    version:
      asText(publication["common:dataSetVersion"]) ||
      asText(publication.dataSetVersion) ||
      asText(row?.dataset_version) ||
      asText(row?.version) ||
      "00.00.001",
  };
}

function taskIdentity(task) {
  return {
    id: asText(task?.entity?.entity_id ?? task?.dataset_id ?? task?.id),
    version: asText(task?.entity?.version ?? task?.dataset_version ?? task?.version) || "00.00.001",
  };
}

export function filterAuthoringTaskManifestToRows({ taskManifest, rowsFile, type, reportPath }) {
  const resolvedTaskManifest = resolveRepoPath(taskManifest);
  const resolvedRowsFile = resolveRepoPath(rowsFile);
  const resolvedReportPath =
    resolveRepoPath(reportPath) ||
    path.join(path.dirname(resolvedTaskManifest), "authoring-task-filter-report.json");
  const manifest = readJson(resolvedTaskManifest);
  const rows = readRows(resolvedRowsFile);
  const retainedKeys = new Set(
    rows
      .map((row) => datasetIdentity(row, type))
      .filter((identity) => identity.id)
      .map((identity) => `${identity.id}@${identity.version}`),
  );
  const tasks = Array.isArray(manifest.tasks) ? manifest.tasks : [];
  const retainedTasks = [];
  const skippedTasks = [];
  for (const task of tasks) {
    const identity = taskIdentity(task);
    const key = identity.id ? `${identity.id}@${identity.version}` : "";
    if (key && retainedKeys.has(key)) {
      retainedTasks.push(task);
    } else {
      skippedTasks.push({
        dataset_type: task?.entity?.dataset_type ?? type,
        dataset_id: identity.id || null,
        dataset_version: identity.version || null,
        reason: "dataset_not_present_after_identity_apply",
      });
    }
  }
  const filtered =
    skippedTasks.length > 0
      ? path.join(path.dirname(resolvedTaskManifest), "authoring-task-manifest.current-rows.json")
      : resolvedTaskManifest;
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
      (Number.isFinite(Number(task?.action_item_count))
        ? Number(task.action_item_count)
        : Array.isArray(task?.action_items)
          ? task.action_items.length
          : 0),
    0,
  );
  const report = {
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

function readRows(filePath) {
  if (!fileExists(filePath)) return [];
  if (String(filePath).toLowerCase().endsWith(".jsonl")) return readJsonLines(filePath);
  const value = readJson(filePath);
  if (Array.isArray(value)) return value;
  if (Array.isArray(value.rows)) return value.rows;
  return [value];
}

function uniqueExistingPaths(paths) {
  return [...new Set((paths ?? []).map(resolveRepoPath).filter(fileExists))];
}

function shellTokens(command) {
  const tokens = [];
  let current = "";
  let quote = null;
  const text = String(command ?? "");
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quote) {
      if (char === quote) {
        quote = null;
      } else {
        current += char;
      }
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    if (char === "\\" && index + 1 < text.length) {
      const next = text[index + 1];
      if (/\s/u.test(next) || next === "\\" || next === "'" || next === '"') {
        index += 1;
        current += next;
      } else {
        current += char;
      }
      continue;
    }
    if (/\s/u.test(char)) {
      if (current) {
        tokens.push(current);
        current = "";
      }
      continue;
    }
    current += char;
  }
  if (current) tokens.push(current);
  return tokens;
}

function commandOptionValue(command, optionName) {
  const tokens = shellTokens(command);
  const index = tokens.indexOf(optionName);
  return index >= 0 ? tokens[index + 1] || null : null;
}

function datasetTypeFromRow(row) {
  if (row?.contactDataSet) return "contact";
  if (row?.sourceDataSet) return "source";
  if (row?.flowDataSet) return "flow";
  if (row?.processDataSet) return "process";
  if (row?.unitGroupDataSet) return "unitgroup";
  if (row?.flowPropertyDataSet) return "flowproperty";
  return null;
}

function supportIdentityKeysFromHandoffPlan(handoffPlan) {
  const inputPath = resolveRepoPath(commandOptionValue(handoffPlan?.commands?.commit, "--input"));
  if (!fileExists(inputPath)) return [];
  return readRows(inputPath)
    .map((row) => {
      const type =
        datasetTypeFromRow(row) || commandOptionValue(handoffPlan?.commands?.commit, "--type");
      if (!supportIdentityTypes().includes(type)) return null;
      const identity = datasetIdentity(row, type);
      return identity.id ? `${type}:${identity.id}@${identity.version}` : null;
    })
    .filter(Boolean);
}

function splitSupportIdentityKey(identityKey) {
  // contact|source for every profile; unitgroup|flowproperty additionally under
  // --mint-unmatched-fp-ug-support (USLCI). Parsing a wider key set is harmless for
  // BAFU because BAFU never produces unitgroup/flowproperty support identity keys.
  const match = /^(contact|source|unitgroup|flowproperty):([^@]+)@(.+)$/u.exec(
    String(identityKey || ""),
  );
  if (!match) return null;
  return { dataset_type: match[1], dataset_id: match[2], dataset_version: match[3] };
}

function supportIdentityKeyFromCacheRow(row) {
  if (row?.identity_key) return String(row.identity_key);
  const rawType = row?.dataset_type || row?.type || row?.table;
  // Tables are plural (flowproperties/unitgroups/contacts/sources); strip to singular.
  const type =
    rawType === "flowproperties"
      ? "flowproperty"
      : rawType === "unitgroups"
        ? "unitgroup"
        : String(rawType || "").replace(/s$/u, "");
  const id = row?.dataset_id || row?.id;
  const version = row?.dataset_version || row?.version || "00.00.001";
  return supportIdentityTypes().includes(type) && id ? `${type}:${id}@${version}` : null;
}

function supportIdentityCacheRow({ identityKey, source, report }) {
  const identity = splitSupportIdentityKey(identityKey);
  if (!identity) return null;
  return {
    schema_version: 1,
    generated_at_utc: nowIso(),
    identity_key: identityKey,
    ...identity,
    status: "verified",
    source,
    report: repoRelative(report),
  };
}

function appendSupportIdentityCacheRows({ cacheFile, identityKeys, source, report }) {
  if (!cacheFile || identityKeys.length === 0) return 0;
  let written = 0;
  for (const identityKey of identityKeys) {
    const row = supportIdentityCacheRow({ identityKey, source, report });
    if (!row) continue;
    appendJsonLine(cacheFile, row);
    written += 1;
  }
  return written;
}

function appendSupportIdentityInvalidationRows({ cacheFile, identityKeys, source, report }) {
  if (!cacheFile || identityKeys.length === 0) return 0;
  let written = 0;
  for (const identityKey of identityKeys) {
    const identity = splitSupportIdentityKey(identityKey);
    if (!identity) continue;
    appendJsonLine(cacheFile, {
      schema_version: 1,
      generated_at_utc: nowIso(),
      identity_key: identityKey,
      ...identity,
      status: "invalidated_remote_missing",
      source,
      report: repoRelative(report),
    });
    written += 1;
  }
  return written;
}

function staleReusedSupportIdentityKeys(finalizeReport, supportIdentityKeys) {
  const keySet = new Set(supportIdentityKeys);
  const stale = new Set();
  for (const blocker of asArray(finalizeReport?.blockers)) {
    if (!["missing_dataset", "reference_closure_unproven"].includes(asText(blocker?.code))) {
      continue;
    }
    const table = asText(blocker?.table);
    const type =
      table === "contacts"
        ? "contact"
        : table === "sources"
          ? "source"
          : table === "unitgroups"
            ? "unitgroup"
            : table === "flowproperties"
              ? "flowproperty"
              : null;
    if (!type || !supportIdentityTypes().includes(type)) continue;
    const id = asText(blocker?.reference_id ?? blocker?.id);
    if (!id) continue;
    const version = asText(blocker?.reference_version ?? blocker?.version) || "00.00.001";
    const identityKey = `${type}:${id}@${version}`;
    if (keySet.has(identityKey)) stale.add(identityKey);
  }
  return [...stale];
}

function supportCacheRowsFromFile(cacheFile) {
  const byKey = new Map();
  for (const row of readJsonLines(cacheFile)) {
    const identityKey = supportIdentityKeyFromCacheRow(row);
    if (!identityKey) continue;
    byKey.set(identityKey, { ...row, identity_key: identityKey });
  }
  return [...byKey.values()];
}

function supportCacheRowIsVerified(row) {
  const status = asText(row?.status) || "verified";
  return status === "verified";
}

function supportCacheRowsFromCommitSummary(summaryPath, closeoutPath) {
  const summary = readJson(summaryPath);
  if (summary?.commit !== true || summary?.status !== "completed") return [];
  return (summary.rows ?? [])
    .filter((row) => row?.status === "executed")
    .map((row) => {
      const type =
        row.table === "contacts"
          ? "contact"
          : row.table === "sources"
            ? "source"
            : row.table === "unitgroups"
              ? "unitgroup"
              : row.table === "flowproperties"
                ? "flowproperty"
                : row.type;
      if (!supportIdentityTypes().includes(type) || !row.id) return null;
      return supportIdentityCacheRow({
        identityKey: `${type}:${row.id}@${row.version || "00.00.001"}`,
        source: "existing_support_closeout_scan",
        report: closeoutPath,
      });
    })
    .filter(Boolean);
}

function supportCacheRowsFromCloseoutReport(closeoutPath) {
  const closeout = readJson(closeoutPath);
  if (closeout?.status !== "completed") return [];
  const commitReport = resolveRepoPath(closeout.commit_report);
  if (
    !fileExists(commitReport) ||
    !commitReport.includes(`${path.sep}dataset-save-draft${path.sep}`)
  ) {
    return [];
  }
  return supportCacheRowsFromCommitSummary(commitReport, closeoutPath);
}

function discoverVerifiedSupportIdentityRows(outDir) {
  const scopesDir = path.join(outDir, "scopes");
  if (!directoryExists(scopesDir)) return [];
  return findFiles(
    scopesDir,
    (filePath) =>
      path.basename(filePath) === "dataset-post-write-closeout-report.json" &&
      filePath.includes(`${path.sep}closeout${path.sep}`),
  ).flatMap(supportCacheRowsFromCloseoutReport);
}

function primeVerifiedSupportIdentityCache({ outDir, cacheFile, sourceLedgerDirs = [] }) {
  verifiedSupportIdentities.clear();
  const seen = new Set();
  let loaded_from_cache = 0;
  let loaded_from_ledger_sources = 0;
  let discovered_from_artifacts = 0;
  let discovered_from_ledger_source_artifacts = 0;
  for (const row of supportCacheRowsFromFile(cacheFile)) {
    if (seen.has(row.identity_key)) continue;
    seen.add(row.identity_key);
    if (!supportCacheRowIsVerified(row)) continue;
    verifiedSupportIdentities.add(row.identity_key);
    loaded_from_cache += 1;
  }
  for (const ledgerDir of sourceLedgerDirs) {
    const sourceCacheFile = path.join(ledgerDir, "verified-support-identities.jsonl");
    for (const row of supportCacheRowsFromFile(sourceCacheFile)) {
      if (seen.has(row.identity_key)) continue;
      seen.add(row.identity_key);
      appendJsonLine(cacheFile, {
        ...row,
        carried_forward_from: repoRelative(sourceCacheFile),
        carried_forward_at_utc: nowIso(),
      });
      if (!supportCacheRowIsVerified(row)) continue;
      verifiedSupportIdentities.add(row.identity_key);
      loaded_from_ledger_sources += 1;
    }
  }
  for (const row of discoverVerifiedSupportIdentityRows(outDir)) {
    if (seen.has(row.identity_key)) continue;
    seen.add(row.identity_key);
    verifiedSupportIdentities.add(row.identity_key);
    appendJsonLine(cacheFile, row);
    discovered_from_artifacts += 1;
  }
  for (const outDirFromLedger of sourceLedgerDirs
    .filter((ledgerDir) => path.basename(ledgerDir) === "import-ledger")
    .map((ledgerDir) => path.dirname(ledgerDir))) {
    for (const row of discoverVerifiedSupportIdentityRows(outDirFromLedger)) {
      if (seen.has(row.identity_key)) continue;
      seen.add(row.identity_key);
      verifiedSupportIdentities.add(row.identity_key);
      appendJsonLine(cacheFile, {
        ...row,
        carried_forward_from: repoRelative(outDirFromLedger),
        carried_forward_at_utc: nowIso(),
      });
      discovered_from_ledger_source_artifacts += 1;
    }
  }
  return {
    cache_file: repoRelative(cacheFile),
    loaded_from_cache,
    loaded_from_ledger_sources,
    discovered_from_artifacts,
    discovered_from_ledger_source_artifacts,
    verified_support_identities: verifiedSupportIdentities.size,
  };
}

function appendOption(args, name, value) {
  if (value == null || value === "") return;
  if (value === true) {
    args.push(name);
    return;
  }
  args.push(name, String(value));
}

function appendPathOption(args, name, value) {
  if (!value) return;
  appendOption(args, name, repoRelative(resolveRepoPath(value)));
}

function appendPathOptions(args, name, values) {
  for (const value of normalizedList(values)) appendPathOption(args, name, value);
}

function foundryCommand(command, options = {}) {
  const args = [process.execPath, "scripts/foundry.mjs", command];
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

function parseJsonStdout(stdout) {
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

function stageTimeoutMs(stage) {
  const override = integerOption(process.env.BAFU_BATCH_STAGE_TIMEOUT_MS, null);
  if (override && override > 0) return override;
  const name = String(stage ?? "");
  if (name.includes("post_write_verify") || name.includes("verify")) return 180_000;
  if (name.includes("finalize")) return 900_000;
  if (name.includes("commit")) return 300_000;
  return 180_000;
}

async function runArgvStage({ stage, argv, logDir, reportPath }) {
  const result = await runStage({ stage, logDir, command: argv, shell: false });
  const resolvedReport = resolveRepoPath(reportPath);
  if (fileExists(resolvedReport)) {
    result.json = readJson(resolvedReport);
    result.report = repoRelative(resolvedReport);
  }
  return result;
}

function runShellStage({ stage, command, logDir }) {
  return runStage({ stage, logDir, command, shell: true });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function runStage({ stage, command, logDir, shell }) {
  fs.mkdirSync(logDir, { recursive: true });
  const safeStage = stage.replace(/[^A-Za-z0-9_.-]+/gu, "-");
  const stdoutLog = path.join(logDir, `${safeStage}.stdout.log`);
  const stderrLog = path.join(logDir, `${safeStage}.stderr.log`);
  const startedAt = nowIso();
  return new Promise((resolve) => {
    const timeoutMs = stageTimeoutMs(stage);
    let timedOut = false;
    let closed = false;
    const childEnv = { ...process.env };
    delete childEnv.TIANGONG_LCA_FORCE_REAUTH;
    const child = shell
      ? spawn(command, { cwd: repoRoot, env: childEnv, shell: true })
      : spawn(command[0], command.slice(1), { cwd: repoRoot, env: childEnv });
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
        command: shell ? command : commandString(command),
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

function postWriteVerifyRetryAttempts() {
  const parsed = integerOption(process.env.BAFU_POST_WRITE_VERIFY_ATTEMPTS, 3);
  return Math.max(1, Math.min(8, parsed || 3));
}

function postWriteVerifyRetryDelayMs(attemptIndex) {
  const base = integerOption(process.env.BAFU_POST_WRITE_VERIFY_RETRY_DELAY_MS, 2_000);
  return Math.max(0, Math.min(60_000, (base || 2_000) * 2 ** attemptIndex));
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

function collectReportCodes(value, codes = new Set(), depth = 0) {
  if (value == null || depth > 6) return codes;
  if (Array.isArray(value)) {
    for (const entry of value) collectReportCodes(entry, codes, depth + 1);
    return codes;
  }
  if (typeof value !== "object") return codes;
  for (const key of ["code", "failure_code", "status_code", "readback_status"]) {
    const text = asText(value[key]);
    if (text) codes.add(text);
  }
  for (const key of ["blockers", "findings", "checks", "results", "rows", "items"]) {
    collectReportCodes(value[key], codes, depth + 1);
  }
  return codes;
}

function postWriteVerifyRetryReason(verifyReportPath) {
  if (!verifyReportPath || !fileExists(verifyReportPath)) return "verify_report_missing";
  const report = readJson(verifyReportPath);
  const codes = collectReportCodes(report);
  for (const code of codes) {
    if (postWriteVerifyRetryableCodes.has(code)) return code;
  }
  const byStatus = report?.counts?.by_status || report?.counts?.statuses || {};
  for (const code of postWriteVerifyRetryableCodes) {
    if (Number(byStatus?.[code] ?? 0) > 0) return code;
  }
  return null;
}

function firstExistingPath(candidates) {
  return candidates.map(resolveRepoPath).find(fileExists) ?? null;
}

function findReportFile(rootDir, predicate) {
  const resolved = resolveRepoPath(rootDir);
  if (!resolved || !fs.existsSync(resolved)) return null;
  const stack = [resolved];
  const matches = [];
  while (stack.length > 0) {
    const current = stack.pop();
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

function findFiles(rootDir, predicate) {
  const resolved = resolveRepoPath(rootDir);
  if (!resolved || !fs.existsSync(resolved)) return [];
  const stack = [resolved];
  const matches = [];
  while (stack.length > 0) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const next = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(next);
      } else if (entry.isFile() && predicate(next)) {
        matches.push(next);
      }
    }
  }
  return matches.sort();
}

function commitReportForHandoffPlan(handoffPlan) {
  const expectedDir = resolveRepoPath(handoffPlan?.files?.expected_commit_report_dir);
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
      path.join(expectedDir || "", "flow-publish-version", "outputs", "summary.json"),
    ]) ??
    findReportFile(expectedDir, (filePath) =>
      /(?:summary|sync_report)\.json$/u.test(path.basename(filePath)),
    )
  );
}

// A support commit whose only failures are "the dataset already exists with the same
// id and version" is an idempotent no-op, not a real failure: the row is already present
// remotely, so the referencing process/flow rows resolve against it. This is the normal
// case for reference-reuse imports (e.g. worldsteel reuses the canonical World Steel
// Association contact and other standard ILCD reference support) and for resuming a run
// that already committed some support. Postgres unique-violation 23505 with the
// "same id and version already exists" message is the authoritative signal. Any other
// failure type is NOT accepted.
function commitFailuresAllAlreadyExist(handoffPlan) {
  const expectedDir = resolveRepoPath(handoffPlan?.files?.expected_commit_report_dir);
  if (!expectedDir) return { accepted: false, alreadyExists: 0, otherFailures: 0 };
  const summaries = findFiles(expectedDir, (filePath) =>
    /(?:summary|sync_report)\.json$/u.test(path.basename(filePath)),
  );
  let failed = 0;
  let alreadyExists = 0;
  for (const summaryPath of summaries) {
    let report;
    try {
      report = readJson(summaryPath);
    } catch {
      continue;
    }
    for (const row of asArray(report?.rows)) {
      if (asText(row?.status) !== "failed") continue;
      failed += 1;
      const error = row?.error ?? {};
      const haystack = `${asText(error.message)} ${asText(error.details)}`.toLowerCase();
      if (
        haystack.includes("same id and version already exists") ||
        (haystack.includes("23505") && haystack.includes("already exists"))
      ) {
        alreadyExists += 1;
      }
    }
  }
  return {
    accepted: failed > 0 && failed === alreadyExists,
    alreadyExists,
    otherFailures: failed - alreadyExists,
  };
}

function verifyReportForHandoffPlan(handoffPlan) {
  const expectedDir = resolveRepoPath(handoffPlan?.files?.expected_post_write_verify_dir);
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

async function executeHandoff({ handoffPlanPath, ledgerDir, outDir, logDir, label }) {
  if (!fileExists(handoffPlanPath)) {
    return {
      status: "blocked",
      blockers: [{ code: "handoff_plan_missing", message: `${label} handoff plan is missing.` }],
      stages: [],
    };
  }
  const handoffPlan = readJson(handoffPlanPath);
  const blockers = [];
  const stages = [];
  if (handoffPlan.status !== "ready_for_explicit_commit") {
    return {
      status: "blocked",
      blockers: [
        {
          code: "handoff_plan_not_ready",
          message: `${label} handoff plan status is ${handoffPlan.status || "missing"}.`,
          handoff_plan: repoRelative(handoffPlanPath),
        },
      ],
      stages,
      handoffPlan,
    };
  }
  if (!handoffPlan.commands?.commit || !handoffPlan.commands?.post_write_verify) {
    return {
      status: "blocked",
      blockers: [
        {
          code: "handoff_commands_missing",
          message: `${label} handoff plan must include commit and post_write_verify commands.`,
          handoff_plan: repoRelative(handoffPlanPath),
        },
      ],
      stages,
      handoffPlan,
    };
  }

  const commitStage = await runShellStage({
    stage: `${label}.commit`,
    command: handoffPlan.commands.commit,
    logDir,
  });
  const commitReportPath = commitReportForHandoffPlan(handoffPlan);
  stages.push({ ...commitStage, report: repoRelative(commitReportPath) });
  if (commitStage.exit_code !== 0 || !commitReportPath) {
    // Accept the commit when its only failures are idempotent "already exists with the
    // same id and version" rows: those datasets are present remotely and the references
    // resolve, so the post-write verify below confirms them. Any other failure blocks.
    const idempotent = commitReportPath ? commitFailuresAllAlreadyExist(handoffPlan) : null;
    if (!idempotent?.accepted) {
      blockers.push({
        code: "commit_handoff_command_failed",
        message: `${label} commit handoff failed or did not emit the expected commit report.`,
        handoff_plan: repoRelative(handoffPlanPath),
        exit_code: commitStage.exit_code,
        commit_report: repoRelative(commitReportPath),
      });
      return { status: "failed", blockers, stages, handoffPlan };
    }
    stages.push({
      stage: `${label}.commit.accepted_existing_support`,
      status: "accepted",
      report: repoRelative(commitReportPath),
      reused_existing_rows: idempotent.alreadyExists,
      message: `${label} commit reused ${idempotent.alreadyExists} support row(s) that already exist with the same id and version; references resolve to the present datasets and are confirmed by post-write verification.`,
    });
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
    const verifyStage = await runShellStage({
      stage: verifyStageName,
      command: handoffPlan.commands.post_write_verify,
      logDir,
    });
    verifyReportPath = verifyReportForHandoffPlan(handoffPlan);
    verifyExitCode = verifyStage.exit_code;
    verifyAttempts = attempt;
    const stageRecord = {
      ...verifyStage,
      report: repoRelative(verifyReportPath),
      attempt,
      max_attempts: maxVerifyAttempts,
    };
    stages.push(stageRecord);
    verifyAccepted = verifyStage.exit_code === 0 && Boolean(verifyReportPath);
    if (verifyStage.exit_code !== 0 && verifyReportPath) {
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
    if (!verifyAccepted && verifyReportPath && trustedExternalReferenceFlows.size > 0) {
      // Accept a readback whose ONLY blockers are missing_dataset on reference-role rows
      // that point at pre-verified trusted external datasets (worldsteel -> USLCI
      // state_code=0 flows, reused by reference and invisible to worldsteel via RLS).
      const acceptedTrusted = acceptTrustedExternalReferenceMissingDataset({
        verifyReportPath,
        outDir,
        repoRoot,
        trustedReferenceKeys: trustedExternalReferenceFlows,
      });
      if (acceptedTrusted.accepted) {
        verifyReportPath = acceptedTrusted.verifyReportPath;
        verifyAccepted = true;
        stages.push({
          stage: `${label}.post_write_verify.accepted_trusted_reference`,
          status: "accepted",
          report: repoRelative(acceptedTrusted.acceptanceReportPath),
          accepted_trusted_references: acceptedTrusted.evidence.length,
        });
      }
    }
    if (verifyAccepted) break;
    verifyRetryReason = postWriteVerifyRetryReason(verifyReportPath);
    if (!verifyRetryReason || attempt >= maxVerifyAttempts) break;
    const retryDelayMs = postWriteVerifyRetryDelayMs(attempt - 1);
    stageRecord.retry_reason = verifyRetryReason;
    stageRecord.retry_next_delay_ms = retryDelayMs;
    await sleep(retryDelayMs);
  }
  if (!verifyAccepted || !verifyReportPath) {
    blockers.push({
      code: "post_write_verify_command_failed",
      message: `${label} post-write verification failed or did not emit the expected remote verification report.`,
      handoff_plan: repoRelative(handoffPlanPath),
      exit_code: verifyExitCode,
      post_write_verify_report: repoRelative(verifyReportPath),
      post_write_verify_attempts: verifyAttempts,
      retry_reason: verifyRetryReason,
    });
    return { status: "failed", blockers, stages, handoffPlan };
  }

  const closeoutDir = path.join(outDir, "closeout");
  const closeoutCommand = commandString([
    process.execPath,
    "scripts/foundry.mjs",
    "dataset-post-write-closeout",
    "--handoff-plan",
    repoRelative(handoffPlanPath),
    "--commit-report",
    repoRelative(commitReportPath),
    "--post-write-verify-report",
    repoRelative(verifyReportPath),
    "--out-dir",
    repoRelative(closeoutDir),
    "--ledger-dir",
    repoRelative(ledgerDir),
  ]);
  const closeoutStage = await runShellStage({
    stage: `${label}.closeout`,
    command: closeoutCommand,
    logDir,
  });
  const closeoutReportPath = path.join(closeoutDir, "dataset-post-write-closeout-report.json");
  const closeoutReport = fileExists(closeoutReportPath) ? readJson(closeoutReportPath) : null;
  stages.push({ ...closeoutStage, report: repoRelative(closeoutReportPath) });
  if (closeoutStage.exit_code !== 0 || closeoutReport?.status !== "completed") {
    blockers.push({
      code: "post_write_closeout_failed",
      message: `${label} post-write closeout status is ${closeoutReport?.status || "missing"}.`,
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

function reportFile(stageJson, fallback) {
  const value = stageJson?.files?.report ?? stageJson?.report;
  return resolveRepoPath(value) || fallback;
}

function outputRowsByStem(report, stem) {
  const rows = Array.isArray(report?.files?.output_rows)
    ? report.files.output_rows
    : [report?.files?.output_rows].filter(Boolean);
  return resolveRepoPath(
    rows.find((entry) => path.basename(String(entry)).startsWith(stem)) ?? rows[0],
  );
}

function identityApplyReportHasReferenceRewrites(reportPath) {
  if (!fileExists(reportPath)) return false;
  const report = readJson(reportPath);
  const rewritesFile = resolveRepoPath(report?.files?.identity_reference_rewrites);
  return readJsonLines(rewritesFile).length > 0;
}

function existingIdentityApplyReportsWithReferenceRewrites(scopeDir, label) {
  const candidates = [
    path.join(scopeDir, `${label}-identity-apply`, "identity-decisions-apply-report.json"),
    ...findFiles(
      scopeDir,
      (filePath) => path.basename(filePath) === "identity-decisions-apply-report.json",
    ),
  ];
  return uniqueExistingPaths(candidates).filter(identityApplyReportHasReferenceRewrites);
}

function identityDecisionDatasetKey(row, fallbackType = null) {
  const datasetType = asText(row?.dataset_type ?? row?.datasetType ?? row?.type ?? fallbackType);
  const datasetId = asText(
    row?.dataset_id ??
      row?.datasetId ??
      row?.source_dataset_id ??
      row?.sourceDatasetId ??
      row?.entity_id ??
      row?.entityId,
  );
  if (!datasetType || !datasetId) return null;
  const datasetVersion =
    asText(
      row?.dataset_version ??
        row?.datasetVersion ??
        row?.source_dataset_version ??
        row?.sourceDatasetVersion ??
        row?.version,
    ) || "00.00.001";
  return `${datasetType.toLowerCase()}:${datasetId}@${datasetVersion}`;
}

function identityDecisionValue(row) {
  const value = asText(row?.identity_decision ?? row?.identityDecision ?? row?.decision);
  if (["reuse", "reuse_existing", "reference_reuse"].includes(value)) {
    return "reuse_existing_reference";
  }
  if (["block", "blocked", "unresolved"].includes(value)) return "block_unresolved";
  return value;
}

function identityDecisionCanonical(row) {
  const canonical = row?.canonical ?? row?.selected_reference ?? row?.selectedReference;
  if (!canonical || typeof canonical !== "object") return null;
  const id = asText(
    canonical.ref_object_id ?? canonical.refObjectId ?? canonical.id ?? canonical["@refObjectId"],
  );
  if (!id) return null;
  return {
    table: asText(canonical.table) || "flows",
    ref_object_id: id,
    version:
      asText(canonical.version ?? canonical.ref_version ?? canonical["@version"]) || "00.00.001",
    short_description:
      asText(
        canonical.short_description ??
          canonical.shortDescription ??
          canonical["common:shortDescription"]?.["#text"],
      ) || id,
  };
}

function canonicalDecisionKey(canonical) {
  if (!canonical) return "";
  return `${canonical.table}:${canonical.ref_object_id}@${canonical.version}`;
}

function completedReusableIdentityDecision(row) {
  return (
    asText(row?.decision_status ?? row?.decisionStatus ?? row?.status) === "completed" &&
    identityDecisionValue(row) === "reuse_existing_reference" &&
    Boolean(identityDecisionCanonical(row)) &&
    Boolean(row?.evidence && typeof row.evidence === "object") &&
    asText(row?.basis ?? row?.reason)
  );
}

// Invalidate a flow's run-level identity-preflight RESULT cache entry the moment
// the flow is minted/committed. A later scope referencing the same source flow then
// re-runs the (now cheap, post-mint) search and reuses the freshly created flow
// instead of restoring the stale pre-mint result and minting a duplicate.
// Paired with the cache in scripts/commands/identity-preflight-run.mjs. No-op unless
// BAFU_IDENTITY_PREFLIGHT_RESULT_CACHE is set.
function invalidateIdentityPreflightResultCacheEntry(identityKey) {
  const raw = process.env.BAFU_IDENTITY_PREFLIGHT_RESULT_CACHE;
  if (!raw || !identityKey) return false;
  const cacheDir = resolveRepoPath(raw);
  const entryDir = path.join(cacheDir, identityKey.replace(/[^A-Za-z0-9_.@-]+/gu, "-"));
  try {
    fs.rmSync(entryDir, { recursive: true, force: true });
  } catch {
    /* best-effort invalidation */
  }
  return true;
}

function identityDecisionSourceFiles(runDir) {
  if (!directoryExists(runDir)) return [];
  return fs
    .readdirSync(runDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^decisions(?:-|$)/u.test(entry.name))
    .map((entry) => path.join(runDir, entry.name, "identity-decisions.jsonl"))
    .filter(fileExists)
    .sort();
}

function loadCompletedReusableIdentityDecisions(runDir) {
  const byKey = new Map();
  const conflicts = [];
  const files = identityDecisionSourceFiles(runDir);
  for (const filePath of files) {
    for (const row of readJsonLines(filePath)) {
      if (!completedReusableIdentityDecision(row)) continue;
      const key = identityDecisionDatasetKey(row);
      if (!key) continue;
      const canonical = identityDecisionCanonical(row);
      const existing = byKey.get(key);
      if (existing) {
        const existingCanonicalKey = canonicalDecisionKey(identityDecisionCanonical(existing.row));
        const currentCanonicalKey = canonicalDecisionKey(canonical);
        if (existingCanonicalKey !== currentCanonicalKey) {
          conflicts.push({
            key,
            existing_source_file: repoRelative(existing.source_file),
            existing_canonical: existingCanonicalKey,
            source_file: repoRelative(filePath),
            canonical: currentCanonicalKey,
          });
          byKey.delete(key);
        }
        continue;
      }
      byKey.set(key, { row, source_file: filePath });
    }
  }
  return { files, byKey, conflicts };
}

// FIX A: load the authoritative library-resolution exchange-reference-rewrites into a
// Map keyed by process_id -> array of rewrite rows. Each row proves, per process and
// per exchange, that a materialized source flow (source_flow_id/source_flow_version)
// should reference a canonical library flow (canonical_flow_id/canonical_flow_version).
// Empty/missing dir yields an empty map (deterministic path simply applies no reuse).
function loadResolutionRewritesByProcess(resolutionDir) {
  const byProcess = new Map();
  if (!resolutionDir) return byProcess;
  const rewritesFile = path.join(
    resolveRepoPath(resolutionDir),
    "exchange-reference-rewrites.jsonl",
  );
  if (!fileExists(rewritesFile)) {
    throw new Error(
      `--library-resolution directory does not contain exchange-reference-rewrites.jsonl: ${repoRelative(rewritesFile)}`,
    );
  }
  for (const row of readJsonLines(rewritesFile)) {
    const processId = asText(row?.process_id);
    if (!processId) continue;
    if (!byProcess.has(processId)) byProcess.set(processId, []);
    byProcess.get(processId).push(row);
  }
  return byProcess;
}

function curationGateAuthoringPackagesById(curationGateReport) {
  const byId = new Map();
  if (!curationGateReport || !fileExists(curationGateReport)) return byId;
  let report;
  try {
    report = readJson(curationGateReport);
  } catch {
    return byId;
  }
  const entities = [report?.entities, report?.processes, report?.flows, report?.items].find(
    Array.isArray,
  );
  for (const entity of entities ?? []) {
    const id = asText(entity?.entity_id ?? entity?.dataset_id);
    const packageRef = asText(entity?.authoring_package);
    if (!id || !packageRef) continue;
    byId.set(id, {
      package_ref: packageRef,
      sha256: asText(entity?.authoring_package_sha256) || null,
    });
  }
  return byId;
}

// Mirrors dataset-identity-decision-task-build: bind the decision to a snapshot of the
// entity's real full-context authoring package so downstream full-context proofs hold.
function snapshotGateAuthoringPackage({ gatePackage, outDir }) {
  const packagePath = resolveRepoPath(gatePackage.package_ref);
  if (!packagePath || !fileExists(packagePath)) return null;
  const sha = gatePackage.sha256 || sha256File(packagePath);
  const parsed = path.parse(path.basename(packagePath));
  const snapshotPath = path.join(
    outDir,
    "authoring-package-snapshots",
    `${parsed.name}.${sha}.snapshot${parsed.ext || ".json"}`,
  );
  fs.mkdirSync(path.dirname(snapshotPath), { recursive: true });
  if (!fileExists(snapshotPath)) fs.copyFileSync(packagePath, snapshotPath);
  let contractContextKinds = [];
  try {
    contractContextKinds = uniqueValues(
      (readJson(snapshotPath)?.contract_context_files ?? [])
        .filter((file) => asText(file?.kind) && asText(file?.text))
        .map((file) => asText(file.kind)),
    );
  } catch {
    contractContextKinds = [];
  }
  return {
    authoring_package: repoRelative(snapshotPath),
    authoring_package_sha256: sha,
    contractContextKinds,
  };
}

function mergeCompletedReusableIdentityDecisions({
  runDir,
  decisionsFile,
  outDir,
  datasetType,
  rowsFile = null,
  curationGateReport = null,
}) {
  const currentRows = fileExists(decisionsFile) ? readJsonLines(decisionsFile) : [];
  const reusable = loadCompletedReusableIdentityDecisions(runDir);
  const replacements = [];
  const additions = [];
  const mergedRows = currentRows.map((row) => {
    const key = identityDecisionDatasetKey(row, datasetType);
    const reusableDecision = key ? reusable.byKey.get(key) : null;
    if (!reusableDecision || identityDecisionValue(row) !== "block_unresolved") return row;
    replacements.push({
      key,
      source_file: repoRelative(reusableDecision.source_file),
      previous_decision: identityDecisionValue(row),
      replacement_decision: "reuse_existing_reference",
      canonical: identityDecisionCanonical(reusableDecision.row),
    });
    return {
      ...reusableDecision.row,
      dataset_type: row.dataset_type ?? reusableDecision.row.dataset_type ?? datasetType,
      dataset_id:
        row.dataset_id ?? row.source_dataset_id ?? reusableDecision.row.dataset_id ?? null,
      dataset_version:
        row.dataset_version ??
        row.source_dataset_version ??
        reusableDecision.row.dataset_version ??
        "00.00.001",
      authoring_package: reusableDecision.row.authoring_package ?? row.authoring_package ?? null,
      authoring_package_sha256:
        reusableDecision.row.authoring_package_sha256 ?? row.authoring_package_sha256 ?? null,
      used_context_kinds: uniqueValues([
        ...normalizedList(reusableDecision.row.used_context_kinds),
        ...normalizedList(row.used_context_kinds),
      ]),
      closes_action_items: uniqueValues([
        ...normalizedList(reusableDecision.row.closes_action_items),
        ...normalizedList(row.closes_action_items),
      ]),
    };
  });
  // A materialized row without any task decision would otherwise fall through to the
  // write path even when the library already holds a completed reuse decision for it
  // (e.g. an elementary flow that produced no preflight action item).
  if (rowsFile && fileExists(rowsFile)) {
    const gatePackagesById = curationGateAuthoringPackagesById(curationGateReport);
    const decidedKeys = new Set(
      mergedRows.map((row) => identityDecisionDatasetKey(row, datasetType)).filter(Boolean),
    );
    for (const payloadRow of readJsonLines(rowsFile)) {
      const identity = datasetIdentity(payloadRow, datasetType);
      if (!identity?.id) continue;
      const key = identityDecisionDatasetKey(
        { dataset_type: datasetType, dataset_id: identity.id, dataset_version: identity.version },
        datasetType,
      );
      if (!key || decidedKeys.has(key)) continue;
      const reusableDecision = reusable.byKey.get(key);
      if (!reusableDecision) continue;
      decidedKeys.add(key);
      // Appended rows have no per-scope task decision, so bind them to the entity's own
      // full-context authoring package from the curation gate (same trust pattern as
      // replacement rows, which keep the task package while taking the library decision).
      const gatePackage = gatePackagesById.get(identity.id);
      const packageBinding = gatePackage
        ? snapshotGateAuthoringPackage({ gatePackage, outDir })
        : null;
      additions.push({
        key,
        source_file: repoRelative(reusableDecision.source_file),
        replacement_decision: "reuse_existing_reference",
        canonical: identityDecisionCanonical(reusableDecision.row),
        authoring_package: packageBinding?.authoring_package ?? null,
      });
      mergedRows.push({
        ...reusableDecision.row,
        dataset_type: datasetType,
        dataset_id: identity.id,
        dataset_version: identity.version || reusableDecision.row.dataset_version || "00.00.001",
        ...(packageBinding
          ? {
              authoring_package: packageBinding.authoring_package,
              authoring_package_sha256: packageBinding.authoring_package_sha256,
            }
          : {}),
        // The full-context proof requires every profile context kind on each decision;
        // replacement rows inherit them from the autofill template, appended rows declare
        // exactly what their bound authoring package proves (plus the contract baseline).
        used_context_kinds: uniqueValues([
          ...normalizedList(reusableDecision.row.used_context_kinds),
          "schema",
          "methodology_yaml",
          "ruleset",
          ...(packageBinding?.contractContextKinds ?? []),
        ]),
      });
    }
  }
  fs.mkdirSync(outDir, { recursive: true });
  const changed = replacements.length > 0 || additions.length > 0;
  const outputFile = changed
    ? path.join(outDir, "identity-decisions.with-carry-forward.jsonl")
    : decisionsFile;
  if (changed) writeJsonLines(outputFile, mergedRows);
  const reportPath = path.join(outDir, "identity-decision-carry-forward-report.json");
  const report = {
    schema_version: 1,
    generated_at_utc: nowIso(),
    command: "dataset-bafu-identity-decision-carry-forward",
    status: changed ? "completed" : "completed_noop",
    remote_write_mode: "read-only",
    dataset_type: datasetType,
    files: {
      report: repoRelative(reportPath),
      input_decisions: repoRelative(decisionsFile),
      output_decisions: repoRelative(outputFile),
      source_decision_files: reusable.files.map(repoRelative),
    },
    counts: {
      input_decisions: currentRows.length,
      source_decision_files: reusable.files.length,
      reusable_decisions: reusable.byKey.size,
      replacements: replacements.length,
      additions: additions.length,
      conflicts: reusable.conflicts.length,
    },
    replacements,
    additions,
    conflicts: reusable.conflicts,
  };
  writeJson(reportPath, report);
  return { report, reportPath, outputFile };
}

function countRows(filePath) {
  return readRows(filePath).length;
}

function categoryForBlocker(code) {
  const text = String(code || "");
  if (/classification|location|identity|authoring|patch|curation/u.test(text)) {
    return "human-review";
  }
  if (/reference|closure|support/u.test(text)) return "reference-closure";
  if (/commit|verify|remote|timeout|network/u.test(text)) return "remote-write";
  return "other";
}

function firstBlocker(report, fallbackCode, fallbackMessage) {
  return report?.blockers?.[0] ?? { code: fallbackCode, message: fallbackMessage };
}

function statusIs(report, values) {
  return values.includes(String(report?.status || ""));
}

function authoringRecoveryProducedEvidence(recovery) {
  return Boolean(
    recovery?.identityApplyReport || recovery?.patchCollectReport || recovery?.patchApplyReport,
  );
}

function preFinalizeRecoveryBlocker({ type, finalizeReport, recovery }) {
  if (statusIs(finalizeReport, ["ready_for_remote_write"])) return null;
  if (authoringRecoveryProducedEvidence(recovery)) return null;
  return firstBlocker(
    finalizeReport,
    `${type}_pre_finalize_not_ready`,
    `${type} pre-finalize status is ${finalizeReport?.status || "missing"} and no automatic authoring evidence was produced.`,
  );
}

function identityUnresolvedReferenceBlocker({ type, report }) {
  const unresolvedRowsFile = resolveRepoPath(
    report?.files?.identity_unresolved_references || report?.files?.unresolved_reference_rows,
  );
  const unresolvedRows = readJsonLines(unresolvedRowsFile);
  const unresolvedCount =
    unresolvedRows.length ||
    Number(
      report?.counts?.identity_unresolved_references ??
        report?.counts?.unresolved_reference_rows ??
        0,
    );
  if (!unresolvedCount) return null;
  return {
    code: `${type}_identity_unresolved_references`,
    message: `${type} identity decisions still leave ${unresolvedCount} unresolved reference row(s).`,
    unresolved_reference_rows: repoRelative(unresolvedRowsFile),
  };
}

function findOneFile(rootDir, pattern) {
  const resolved = resolveRepoPath(rootDir);
  if (!directoryExists(resolved)) return null;
  const matches = fs
    .readdirSync(resolved)
    .filter((name) => pattern.test(name))
    .sort();
  return matches.length ? path.join(resolved, matches[0]) : null;
}

function defaultContext(runDir, type) {
  return {
    schemaFile: path.join(runDir, "context", type, "outputs", "schema.json"),
    yamlFile: path.join(runDir, "context", type, "outputs", "methodology.yaml"),
    rulesetFile: path.join(runDir, "context", type, "outputs", "runtime-ruleset.json"),
  };
}

function defaultSchemaFiles(options) {
  const schemaRoot = resolveRepoPath(
    options.tidasSchemaDir || resolveInstalledTiangongLcaCliPackage().schemaDir,
  );
  return {
    processCategory: path.join(schemaRoot, "tidas_processes_category.json"),
    flowProductCategory: path.join(schemaRoot, "tidas_flows_product_category.json"),
    flowElementaryCategory: path.join(schemaRoot, "tidas_flows_elementary_category.json"),
    location: path.join(schemaRoot, "tidas_locations_category.json"),
    allClassification: [
      "tidas_contacts_category.json",
      "tidas_flowproperties_category.json",
      "tidas_flows_elementary_category.json",
      "tidas_flows_product_category.json",
      "tidas_lciamethods_category.json",
      "tidas_processes_category.json",
      "tidas_sources_category.json",
      "tidas_unitgroups_category.json",
    ].map((name) => path.join(schemaRoot, name)),
  };
}

function schemaClasses(schemaFile) {
  const classes = new Map();
  const visit = (value) => {
    if (!value || typeof value !== "object") return;
    const classId = value?.properties?.["@classId"]?.const;
    if (classId != null) {
      classes.set(String(classId), {
        classId: String(classId),
        level: String(value?.properties?.["@level"]?.const ?? ""),
        text: String(value?.properties?.["#text"]?.const ?? ""),
      });
    }
    for (const child of Object.values(value)) visit(child);
  };
  visit(readJson(schemaFile));
  return classes;
}

function categorySchemaForDecision(decision, schemas) {
  const type = String(decision?.category_type || decision?.schema_type || "").toLowerCase();
  if (type === "process") return schemas.processCategory;
  if (type === "flow-elementary") return schemas.flowElementaryCategory;
  if (type === "flow-product" || type === "flow" || type === "product") {
    return schemas.flowProductCategory;
  }
  return null;
}

function childClassesFor(classes, parentCode) {
  const parent = classes.get(parentCode);
  const parentLevel = Number(parent?.level);
  if (!Number.isFinite(parentLevel)) return [];
  return [...classes.values()]
    .filter((entry) => {
      const level = Number(entry.level);
      return (
        Number.isFinite(level) &&
        level === parentLevel + 1 &&
        entry.classId.startsWith(parentCode) &&
        entry.classId !== parentCode
      );
    })
    .sort((left, right) => left.classId.localeCompare(right.classId));
}

function decisionEvidenceText(row) {
  const queue = row?.evidence?.queue ?? {};
  const authoringContext = queue?.authoring_context ?? {};
  const libraryDecision = row?.evidence?.library_decision ?? {};
  return normalizeSearchText(
    [
      row?.basis,
      row?.code,
      row?.selected_code,
      libraryDecision?.basis,
      libraryDecision?.source_name,
      queue?.source_classification?.category,
      queue?.source_classification?.localCategory,
      authoringContext?.source_name,
      authoringContext?.source_local_name,
      authoringContext?.technology,
    ]
      .filter(Boolean)
      .join(" "),
  );
}

function bestChildRepairCode(row, parentCode, children) {
  if (children.length === 0) return null;
  const text = decisionEvidenceText(row);

  if (parentCode === "351") {
    const mentionsDistribution = /\b(?:distribution|transmission)\b/u.test(text);
    const negatesDistribution =
      /\b(?:not|nor|without)\s+(?:include\s+)?(?:transport\s+)?(?:nor\s+)?distribution\b/u.test(
        text,
      );
    if (
      mentionsDistribution &&
      !negatesDistribution &&
      !/\b(?:production|generation)\b/u.test(text)
    ) {
      return children.find((child) => child.classId === "3513")?.classId ?? null;
    }
    const renewableOnly =
      /\b(?:renewable|wind|hydro|hydropower|photovoltaic|solar|biogas|wood)\b/u.test(text) &&
      !/\b(?:coal|diesel|gas|industrial gas|natural gas|nuclear|oil|non renewable|nonrenewable)\b/u.test(
        text,
      );
    if (renewableOnly) return children.find((child) => child.classId === "3512")?.classId ?? null;
    if (/\b(?:electricity|power|production|generation|plant|cogen|cogeneration)\b/u.test(text)) {
      return children.find((child) => child.classId === "3511")?.classId ?? null;
    }
  }

  let best = null;
  let bestScore = -1;
  const tokens = new Set(text.split(" ").filter((token) => token.length > 2));
  for (const child of children) {
    const childTokens = normalizeSearchText(child.text)
      .split(" ")
      .filter((token) => token.length > 2);
    const score = childTokens.reduce((sum, token) => sum + (tokens.has(token) ? 1 : 0), 0);
    if (score > bestScore) {
      best = child;
      bestScore = score;
    }
  }
  return best?.classId ?? null;
}

function repairClassificationDecisionCodes({ decisionsFile, schemas, outDir }) {
  const rows = readJsonLines(decisionsFile);
  const cache = new Map();
  const repairs = [];
  const unresolved = [];
  const repaired = rows.map((row) => {
    const schemaFile = categorySchemaForDecision(row, schemas);
    if (!schemaFile || !fileExists(schemaFile)) return row;
    if (!cache.has(schemaFile)) cache.set(schemaFile, schemaClasses(schemaFile));
    const classes = cache.get(schemaFile);
    const code = String(row.code ?? row.selected_code ?? "").trim();
    if (!code || classes.has(code)) return row;
    const stripped = code.replace(/0+$/u, "");
    if (stripped && stripped !== code && classes.has(stripped)) {
      const children = childClassesFor(classes, stripped);
      const repairedCode = bestChildRepairCode(row, stripped, children) ?? stripped;
      const repairKind =
        repairedCode === stripped
          ? "strip_invalid_trailing_zero_to_valid_parent_class"
          : "replace_invalid_trailing_zero_code_with_schema_valid_child_class";
      repairs.push({
        schema_version: 1,
        dataset_id: row.dataset_id,
        dataset_version: row.dataset_version,
        category_type: row.category_type ?? row.schema_type,
        original_code: code,
        repaired_code: repairedCode,
        basis:
          repairedCode === stripped
            ? "Projected category code was not valid in the bundled TIDAS schema; removing trailing zeroes selected the valid parent class without changing the semantic branch."
            : "Projected category code was not valid in the bundled TIDAS schema; the valid parent branch required one more schema level, so the closest source-backed child class was selected.",
      });
      return {
        ...row,
        code: repairedCode,
        basis:
          repairedCode === stripped
            ? `${row.basis || "Classification decision projected from library-level semantic decision."} Schema repair: ${code} -> ${stripped} because ${code} is not a valid bundled TIDAS classId and ${stripped} is the valid parent class.`
            : `${row.basis || "Classification decision projected from library-level semantic decision."} Schema repair: ${code} -> ${repairedCode} because ${code} is not a valid bundled TIDAS classId and ${repairedCode} is the closest valid child class under parent ${stripped}.`,
        evidence: {
          ...(row.evidence ?? {}),
          schema_repair: {
            source: "dataset-bafu-batch-import-run",
            original_code: code,
            repaired_code: repairedCode,
            parent_code: stripped,
            schema_file: repoRelative(schemaFile),
            repair_kind: repairKind,
            child_candidates: children.map((child) => ({
              code: child.classId,
              label: child.text,
            })),
          },
        },
      };
    }
    unresolved.push({
      schema_version: 1,
      dataset_id: row.dataset_id,
      dataset_version: row.dataset_version,
      category_type: row.category_type ?? row.schema_type,
      code,
      schema_file: repoRelative(schemaFile),
      reason: "classification_code_not_in_bundled_tidas_schema",
    });
    return row;
  });
  writeJsonLines(decisionsFile, repaired);
  const repairPath = path.join(outDir, "classification-decisions.schema-repairs.jsonl");
  const unresolvedPath = path.join(
    outDir,
    "classification-decisions.schema-invalid.manual-review.jsonl",
  );
  writeJsonLines(repairPath, repairs);
  writeJsonLines(unresolvedPath, unresolved);
  return { repairs, unresolved, repairPath, unresolvedPath };
}

function ledgerDirCandidate(sourcePath) {
  if (!sourcePath) return null;
  if (directoryExists(path.join(sourcePath, "import-ledger"))) {
    return path.join(sourcePath, "import-ledger");
  }
  if (!directoryExists(sourcePath)) return null;
  if (path.basename(sourcePath) === "import-ledger") return sourcePath;
  const knownLedgerFiles = [
    "ok.scopes.verified.jsonl",
    "ok.flows.verified.jsonl",
    "blocked.scopes.human-review.jsonl",
    "verified-support-identities.jsonl",
  ];
  if (knownLedgerFiles.some((name) => fileExists(path.join(sourcePath, name)))) return sourcePath;
  return null;
}

function resolveLedgerSourceDirs(value) {
  const seen = new Set();
  const dirs = [];
  for (const entry of normalizedList(value)) {
    const resolved = resolveRepoPath(entry);
    const ledgerDir = ledgerDirCandidate(resolved);
    if (!ledgerDir) {
      throw new Error(
        `--ledger-source-dir must point to a batch directory or import-ledger directory: ${entry}`,
      );
    }
    const key = path.resolve(ledgerDir);
    if (seen.has(key)) continue;
    seen.add(key);
    dirs.push(ledgerDir);
  }
  return dirs;
}

function ledgerFiles(sourceDirs, name) {
  return sourceDirs.map((dir) => path.join(dir, name));
}

function summarizeLedgerSources(sourceDirs) {
  return sourceDirs.map((dir) => ({
    ledger_dir: repoRelative(dir),
    ok_scope_rows: readJsonLines(path.join(dir, "ok.scopes.verified.jsonl")).length,
    ok_flow_rows: readJsonLines(path.join(dir, "ok.flows.verified.jsonl")).length,
    blocked_scope_rows: readJsonLines(path.join(dir, "blocked.scopes.human-review.jsonl")).length,
    verified_support_identity_rows: readJsonLines(
      path.join(dir, "verified-support-identities.jsonl"),
    ).length,
  }));
}

function sumLedgerSourceRows(summary, field) {
  return summary.reduce((sum, row) => sum + (Number(row[field]) || 0), 0);
}

function sortedSet(values) {
  return [...values].sort();
}

function setDifference(left, right) {
  return new Set([...left].filter((value) => !right.has(value)));
}

function setIntersection(left, right) {
  return new Set([...left].filter((value) => right.has(value)));
}

function datasetKeyFromParts(id, version) {
  return id ? `${id}@${version || "00.00.001"}` : null;
}

function datasetKeyFromRow(row, type) {
  const id = row?.dataset_id || row?.id || row?.[`${type}_id`] || row?.process_id || row?.flow_id;
  const version =
    row?.dataset_version ||
    row?.version ||
    row?.[`${type}_version`] ||
    row?.process_version ||
    row?.flow_version ||
    "00.00.001";
  return datasetKeyFromParts(id, version);
}

function identityFromTidasRow(row, type, fallbackId = null) {
  const identity = runtime().datasetIdentity(row, type) ?? {};
  const root = row?.[`${type}DataSet`] ?? {};
  const info =
    root?.[`${type}Information`]?.dataSetInformation ??
    root?.[`${type}Information`]?.["common:dataSetInformation"] ??
    {};
  const publication =
    root?.administrativeInformation?.publicationAndOwnership ??
    root?.administrativeInformation?.["common:publicationAndOwnership"] ??
    {};
  return {
    id: identity.id || asText(info["common:UUID"] ?? info.UUID) || fallbackId,
    version:
      identity.version ||
      asText(publication["common:dataSetVersion"] ?? publication.dataSetVersion) ||
      "00.00.001",
  };
}

function readJsonIfExists(filePath) {
  return fileExists(filePath) ? readJson(filePath) : null;
}

function walkFiles(rootDir, predicate) {
  const resolved = resolveRepoPath(rootDir);
  if (!resolved || !fs.existsSync(resolved)) return [];
  const stack = [resolved];
  const files = [];
  while (stack.length > 0) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const next = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(next);
      } else if (entry.isFile() && predicate(next)) {
        files.push(next);
      }
    }
  }
  return files.sort();
}

function bundleIndexRows(processBundlesDir) {
  const indexFile = path.join(processBundlesDir, "index.json");
  const indexDir = path.dirname(indexFile);
  const index = readJsonIfExists(indexFile);
  let entries = [];
  if (Array.isArray(index)) {
    entries = index;
  } else if (Array.isArray(index?.bundles)) {
    entries = index.bundles;
  } else if (Array.isArray(index?.process_bundles)) {
    entries = index.process_bundles;
  } else if (index && typeof index === "object") {
    entries = Object.values(index).find(Array.isArray) ?? [];
  }
  return entries.map((entry) => {
    const processId = asText(
      entry?.process_id || entry?.id || entry?.dataset_id || entry?.process?.id,
    );
    const processVersion = asText(
      entry?.process_version || entry?.version || entry?.dataset_version || entry?.process?.version,
    );
    const bundleDir = processId ? path.join(processBundlesDir, processId) : null;
    const manifest = entry?.manifest
      ? resolveRepoPath(
          path.isAbsolute(entry.manifest) ? entry.manifest : path.join(indexDir, entry.manifest),
        )
      : bundleDir
        ? path.join(bundleDir, "manifest.json")
        : null;
    const tidasDir = entry?.tidas_dir
      ? resolveRepoPath(
          path.isAbsolute(entry.tidas_dir) ? entry.tidas_dir : path.join(indexDir, entry.tidas_dir),
        )
      : bundleDir
        ? path.join(bundleDir, "tidas")
        : null;
    return {
      process_id: processId,
      process_version: processVersion || "00.00.001",
      process_key: datasetKeyFromParts(processId, processVersion || "00.00.001"),
      manifest,
      tidas_dir: tidasDir,
    };
  });
}

function processFileRows(processesDir) {
  return walkFiles(processesDir, (filePath) => filePath.endsWith(".json")).map((filePath) => {
    const row = readJson(filePath);
    const fallbackId = path.basename(filePath, ".json");
    const identity = identityFromTidasRow(row, "process", fallbackId);
    return {
      process_id: identity.id,
      process_version: identity.version,
      process_key: datasetKeyFromParts(identity.id, identity.version),
      file: filePath,
      row,
    };
  });
}

function textAt(value) {
  if (value == null) return "";
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.map(textAt).filter(Boolean).join("; ");
  if (typeof value === "object") return textAt(value["#text"] ?? value.value ?? value.id);
  return "";
}

function collectFlowReferences(value, refs = []) {
  if (!value || typeof value !== "object") return refs;
  if (Array.isArray(value)) {
    for (const entry of value) collectFlowReferences(entry, refs);
    return refs;
  }
  const ref = value.referenceToFlowDataSet;
  if (ref && typeof ref === "object") {
    const flowId = asText(ref["@refObjectId"] ?? ref.refObjectId ?? ref.id);
    const flowVersion = asText(ref["@version"] ?? ref.version) || "00.00.001";
    if (flowId) {
      refs.push({
        flow_id: flowId,
        flow_version: flowVersion,
        flow_key: datasetKeyFromParts(flowId, flowVersion),
        short_description: textAt(ref["common:shortDescription"] ?? ref.shortDescription),
      });
    }
  }
  for (const entry of Object.values(value)) collectFlowReferences(entry, refs);
  return refs;
}

function flowTypeOfRow(row) {
  const info =
    row?.flowDataSet?.flowInformation?.dataSetInformation ??
    row?.flowDataSet?.flowInformation?.["common:dataSetInformation"] ??
    {};
  return asText(info.typeOfDataSet ?? info["common:typeOfDataSet"] ?? row?.typeOfDataSet);
}

function flowRowsByKey(flowsDir) {
  const rowsByKey = new Map();
  for (const filePath of walkFiles(flowsDir, (entry) => entry.endsWith(".json"))) {
    const row = readJson(filePath);
    const fallbackId = path.basename(filePath, ".json");
    const identity = identityFromTidasRow(row, "flow", fallbackId);
    const key = datasetKeyFromParts(identity.id, identity.version);
    if (!key) continue;
    rowsByKey.set(key, {
      flow_id: identity.id,
      flow_version: identity.version,
      flow_key: key,
      flow_type: flowTypeOfRow(row),
      file: filePath,
    });
  }
  return rowsByKey;
}

function scopeFilesForCoverage(options, runDir) {
  const explicit = normalizedList(options.scopeFile || options.scopeFiles);
  if (explicit.length > 0) return uniqueExistingPaths(explicit);
  return walkFiles(runDir, (filePath) => path.basename(filePath) === "ready-scopes.jsonl");
}

function scopeKeyRowsFromFiles(files) {
  const rows = [];
  for (const filePath of files) {
    for (const row of readJsonLines(filePath)) {
      const key = scopeKey(row);
      if (!key) continue;
      rows.push({
        process_id: row.process_id || row.id,
        process_version: row.process_version || row.version || "00.00.001",
        process_key: key,
        closure_status: row.closure_status ?? row.status ?? null,
        source_file: filePath,
      });
    }
  }
  return rows;
}

function keySetFromRows(rows, type) {
  return new Set(rows.map((row) => datasetKeyFromRow(row, type)).filter(Boolean));
}

function keySetFromFiles(files, type) {
  return keySetFromRows(
    files.flatMap((filePath) => readJsonLines(filePath)),
    type,
  );
}

function runDatasetBafuUniverseCoverageReport(options = {}) {
  if (options.help) {
    return {
      schema_version: 1,
      status: "help",
      command: coverageCommandName,
      usage: [
        "node scripts/foundry.mjs dataset-bafu-universe-coverage-report --run-dir .foundry/workspaces/<bafu-run> --ledger-source-dir <batch/import-ledger> --out-dir <coverage-dir>",
        "node scripts/foundry.mjs dataset-bafu-universe-coverage-report --input-dir 'inputs/BAFU-2025 Version 2 - TIDAS 2026-03-09' --scope-file <ready-scopes.jsonl> --ledger-source-dir <batch/import-ledger>",
      ],
      purpose:
        "Build a read-only BAFU full-universe coverage report from process-bundles, ready scopes, flow references, and explicit ledger sources.",
      remote_write_mode: "read-only",
    };
  }

  const inputDir = resolveRepoPath(
    options.inputDir || "inputs/BAFU-2025 Version 2 - TIDAS 2026-03-09",
  );
  const processBundlesDir = resolveRepoPath(
    options.processBundlesDir || options.bundlesDir || path.join(inputDir, "process-bundles"),
  );
  const processesDir = resolveRepoPath(
    options.processesDir || path.join(inputDir, "tidas", "processes"),
  );
  const flowsDir = resolveRepoPath(options.flowsDir || path.join(inputDir, "tidas", "flows"));
  const runDir = resolveRepoPath(options.runDir || path.dirname(processBundlesDir));
  const outDir = resolveRepoPath(
    options.outDir || path.join(runDir, "bafu-universe-coverage-report"),
  );
  if (!directoryExists(processBundlesDir)) {
    throw new Error("--process-bundles-dir is required and must point to process-bundles.");
  }
  if (!directoryExists(processesDir)) {
    throw new Error("--processes-dir is required and must point to tidas/processes.");
  }
  fs.mkdirSync(outDir, { recursive: true });

  const ledgerSourceDirs = resolveLedgerSourceDirs(
    options.ledgerSourceDir ||
      options.ledgerSourceDirs ||
      options.carryForwardLedgerDir ||
      options.carryForwardLedgerDirs,
  );
  const ledgerSourceSummary = summarizeLedgerSources(ledgerSourceDirs);
  const scopeFiles = scopeFilesForCoverage(options, runDir);
  const scopeRows = scopeKeyRowsFromFiles(scopeFiles);
  const readyScopeSet = new Set(scopeRows.map((row) => row.process_key));
  const bundleRows = bundleIndexRows(processBundlesDir);
  const processRows = processFileRows(processesDir);
  const processByKey = new Map();
  for (const row of bundleRows) {
    if (!row.process_key) continue;
    processByKey.set(row.process_key, {
      process_id: row.process_id,
      process_version: row.process_version,
      process_key: row.process_key,
      in_process_bundles: true,
      in_tidas_processes: false,
      bundle_manifest: repoRelative(row.manifest),
    });
  }
  for (const row of processRows) {
    if (!row.process_key) continue;
    const current = processByKey.get(row.process_key) ?? {
      process_id: row.process_id,
      process_version: row.process_version,
      process_key: row.process_key,
      in_process_bundles: false,
      in_tidas_processes: false,
    };
    current.in_tidas_processes = true;
    current.process_file = repoRelative(row.file);
    processByKey.set(row.process_key, current);
  }
  const processUniverseSet = new Set(processByKey.keys());

  const verifiedScopes = keySetFromFiles(
    ledgerFiles(ledgerSourceDirs, "ok.scopes.verified.jsonl"),
    "scope",
  );
  const verifiedFlows = keySetFromFiles(
    ledgerFiles(ledgerSourceDirs, "ok.flows.verified.jsonl"),
    "flow",
  );
  const blockedScopeRows = ledgerFiles(
    ledgerSourceDirs,
    "blocked.scopes.human-review.jsonl",
  ).flatMap((filePath) => readJsonLines(filePath));
  const activeBlockedScopes = setDifference(
    keySetFromRows(blockedScopeRows, "scope"),
    verifiedScopes,
  );
  const retryScopeRows = [
    ...ledgerFiles(ledgerSourceDirs, "failed.scopes.retry.jsonl"),
    ...ledgerFiles(ledgerSourceDirs, "retry.scopes.jsonl"),
  ].flatMap((filePath) => readJsonLines(filePath));
  const retryScopes = setDifference(keySetFromRows(retryScopeRows, "scope"), verifiedScopes);
  const nonImportableScopes = keySetFromFiles(
    normalizedList(options.nonImportableScopesFile || options.nonImportableScopesFiles).map(
      resolveRepoPath,
    ),
    "scope",
  );

  const readyUniverseSet = setIntersection(processUniverseSet, readyScopeSet);
  const missingReadySet = setDifference(processUniverseSet, readyScopeSet);
  const verifiedUniverseSet = setIntersection(processUniverseSet, verifiedScopes);
  const pendingReadySet = setDifference(
    setDifference(setDifference(readyUniverseSet, verifiedUniverseSet), activeBlockedScopes),
    retryScopes,
  );

  const flowIndex = flowRowsByKey(flowsDir);
  const referencedFlows = new Map();
  for (const row of processRows) {
    for (const ref of collectFlowReferences(row.row)) {
      const current = referencedFlows.get(ref.flow_key) ?? {
        ...ref,
        referencing_processes: new Set(),
      };
      current.referencing_processes.add(row.process_key);
      referencedFlows.set(ref.flow_key, current);
    }
  }
  const productOrUnknownFlowKeys = new Set();
  const referencedFlowRows = [];
  for (const [flowKey, ref] of referencedFlows.entries()) {
    const indexed = flowIndex.get(flowKey);
    const flowType = indexed?.flow_type || "unknown";
    const isElementary = /elementary/u.test(flowType.toLowerCase());
    if (!isElementary) productOrUnknownFlowKeys.add(flowKey);
    referencedFlowRows.push({
      schema_version: 1,
      flow_id: ref.flow_id,
      flow_version: ref.flow_version,
      flow_key: flowKey,
      flow_type: flowType,
      flow_file: repoRelative(indexed?.file),
      reference_kind: isElementary
        ? "elementary"
        : flowType === "unknown"
          ? "unknown"
          : "product_or_waste",
      verified: verifiedFlows.has(flowKey),
      referencing_process_count: ref.referencing_processes.size,
      sample_referencing_processes: sortedSet(ref.referencing_processes).slice(0, 20),
    });
  }
  const unverifiedProductOrUnknownFlows = setDifference(productOrUnknownFlowKeys, verifiedFlows);

  const processCoverageRows = sortedSet(processUniverseSet).map((key) => {
    const processRow = processByKey.get(key);
    const verified = verifiedScopes.has(key);
    const nonImportable = nonImportableScopes.has(key);
    const activeBlocked = activeBlockedScopes.has(key);
    const retry = retryScopes.has(key);
    const ready = readyScopeSet.has(key);
    const coverageStatus = verified
      ? "verified"
      : nonImportable
        ? "non_importable"
        : retry
          ? "retry"
          : activeBlocked
            ? "active_human_review"
            : ready
              ? "pending_ready_scope"
              : "missing_ready_scope";
    return {
      schema_version: 1,
      ...processRow,
      ready_scope: ready,
      verified,
      non_importable: nonImportable,
      active_human_review: activeBlocked,
      retry,
      coverage_status: coverageStatus,
    };
  });
  const processCoverageStatusCounts = processCoverageRows.reduce((counts, row) => {
    counts[row.coverage_status] = (counts[row.coverage_status] ?? 0) + 1;
    return counts;
  }, {});
  const processGapRows = processCoverageRows.filter(
    (row) => !["verified", "non_importable"].includes(row.coverage_status),
  );
  const flowGapRows = referencedFlowRows.filter(
    (row) => row.reference_kind !== "elementary" && !row.verified,
  );

  const processUniversePath = path.join(outDir, "bafu-process-universe.coverage.jsonl");
  const processGapPath = path.join(outDir, "bafu-process-coverage-gaps.jsonl");
  const flowReferencePath = path.join(outDir, "bafu-flow-reference-coverage.jsonl");
  const flowGapPath = path.join(outDir, "bafu-flow-reference-coverage-gaps.jsonl");
  const reportPath = path.join(outDir, "bafu-universe-coverage-report.json");
  writeJsonLines(processUniversePath, processCoverageRows);
  writeJsonLines(processGapPath, processGapRows);
  writeJsonLines(flowReferencePath, referencedFlowRows);
  writeJsonLines(flowGapPath, flowGapRows);

  const report = {
    schema_version: 1,
    generated_at_utc: nowIso(),
    status:
      processGapRows.length === 0 && flowGapRows.length === 0
        ? "completed"
        : "completed_with_coverage_gaps",
    command: coverageCommandName,
    remote_write_mode: "read-only",
    inputs: {
      input_dir: repoRelative(inputDir),
      process_bundles_dir: repoRelative(processBundlesDir),
      processes_dir: repoRelative(processesDir),
      flows_dir: repoRelative(flowsDir),
      run_dir: repoRelative(runDir),
      scope_files: scopeFiles.map(repoRelative),
      ledger_source_dirs: ledgerSourceDirs.map(repoRelative),
      non_importable_scope_files: normalizedList(
        options.nonImportableScopesFile || options.nonImportableScopesFiles,
      ).map((entry) => repoRelative(resolveRepoPath(entry))),
    },
    counts: {
      process_bundle_entries: bundleRows.length,
      process_bundle_unique: new Set(bundleRows.map((row) => row.process_key).filter(Boolean)).size,
      tidas_process_files: processRows.length,
      tidas_process_unique: new Set(processRows.map((row) => row.process_key).filter(Boolean)).size,
      process_universe: processUniverseSet.size,
      ready_scope_files: scopeFiles.length,
      ready_scope_rows: scopeRows.length,
      ready_scope_unique: readyScopeSet.size,
      ready_scopes_in_universe: readyUniverseSet.size,
      missing_ready_scopes: missingReadySet.size,
      verified_process_scopes: processCoverageStatusCounts.verified ?? 0,
      non_importable_process_scopes: processCoverageStatusCounts.non_importable ?? 0,
      active_human_review_scopes: processCoverageStatusCounts.active_human_review ?? 0,
      retry_scopes: processCoverageStatusCounts.retry ?? 0,
      pending_ready_scopes: processCoverageStatusCounts.pending_ready_scope ?? 0,
      process_coverage_gap_rows: processGapRows.length,
      referenced_flow_rows: referencedFlows.size,
      product_or_unknown_flow_references: productOrUnknownFlowKeys.size,
      verified_product_or_unknown_flow_references: setIntersection(
        productOrUnknownFlowKeys,
        verifiedFlows,
      ).size,
      unverified_product_or_unknown_flow_references: unverifiedProductOrUnknownFlows.size,
      flow_coverage_gap_rows: flowGapRows.length,
      ledger_source_dirs: ledgerSourceSummary.length,
      ledger_source_ok_scope_rows: sumLedgerSourceRows(ledgerSourceSummary, "ok_scope_rows"),
      ledger_source_ok_scope_unique: verifiedScopes.size,
      ledger_source_ok_scope_unique_in_universe: verifiedUniverseSet.size,
      ledger_source_ok_flow_rows: sumLedgerSourceRows(ledgerSourceSummary, "ok_flow_rows"),
      ledger_source_ok_flow_unique: verifiedFlows.size,
      ledger_source_ok_flow_unique_product_or_unknown_references: setIntersection(
        productOrUnknownFlowKeys,
        verifiedFlows,
      ).size,
      ledger_source_blocked_scope_rows: sumLedgerSourceRows(
        ledgerSourceSummary,
        "blocked_scope_rows",
      ),
    },
    ledger_sources: ledgerSourceSummary,
    files: {
      report: repoRelative(reportPath),
      process_universe: repoRelative(processUniversePath),
      process_coverage_gaps: repoRelative(processGapPath),
      flow_reference_coverage: repoRelative(flowReferencePath),
      flow_reference_coverage_gaps: repoRelative(flowGapPath),
    },
    policy: {
      ledger_sources_are_explicit:
        "Coverage is computed only from the explicit --ledger-source-dir inputs. Root import-ledger is not assumed to aggregate prior batches.",
      v8_ready_scope_is_not_full_universe:
        "Ready scope files are treated as closure snapshots, not as the full input process universe.",
      read_only: true,
    },
  };
  writeJson(reportPath, report);
  return report;
}

function loadVerifiedSetFromFiles(filePaths, type) {
  const set = new Set();
  for (const filePath of filePaths) {
    for (const row of readJsonLines(filePath)) {
      const id = row.dataset_id || row.id || row[`${type}_id`] || row.process_id;
      const version =
        row.dataset_version ||
        row.version ||
        row[`${type}_version`] ||
        row.process_version ||
        "00.00.001";
      if (id) set.add(`${id}@${version}`);
    }
  }
  return set;
}

function loadVerifiedRowsByKeyFromFiles(filePaths, type) {
  const rowsByKey = new Map();
  for (const filePath of filePaths) {
    for (const row of readJsonLines(filePath)) {
      const id = row.dataset_id || row.id || row[`${type}_id`] || row.process_id;
      const version =
        row.dataset_version ||
        row.version ||
        row[`${type}_version`] ||
        row.process_version ||
        "00.00.001";
      if (!id) continue;
      const key = `${id}@${version}`;
      if (rowsByKey.has(key)) continue;
      rowsByKey.set(key, {
        ...row,
        source_ledger_file: repoRelative(filePath),
      });
    }
  }
  return rowsByKey;
}

function loadVerifiedSet(filePath, type) {
  return loadVerifiedSetFromFiles([filePath], type);
}

function datasetIdentityKey(identity) {
  const id = asText(identity?.id);
  if (!id) return null;
  return `${id}@${asText(identity?.version) || "00.00.001"}`;
}

function flowRowsPendingVerification(rows, verifiedFlows) {
  const pendingRows = [];
  const verifiedRows = [];
  const pendingIdentities = [];
  const verifiedIdentities = [];
  for (const row of rows) {
    const identity = datasetIdentity(row, "flow");
    const key = datasetIdentityKey(identity);
    if (!key) continue;
    const entry = {
      id: identity.id,
      version: asText(identity.version) || "00.00.001",
      identity_key: key,
    };
    if (verifiedFlows.has(key)) {
      verifiedRows.push(row);
      verifiedIdentities.push(entry);
      continue;
    }
    pendingRows.push(row);
    pendingIdentities.push(entry);
  }
  return {
    pendingRows,
    verifiedRows,
    pendingIdentities,
    verifiedIdentities,
  };
}

function writeScopeCarriedForwardVerifiedFlowRows({
  ledgerDir,
  processId,
  verifiedIdentities,
  verifiedFlowRowsByKey,
}) {
  const ledgerPath = path.join(ledgerDir, "ok.flows.verified.jsonl");
  const existing = loadVerifiedSet(ledgerPath, "flow");
  const written = [];
  for (const identity of verifiedIdentities ?? []) {
    const key = identity.identity_key || datasetIdentityKey(identity);
    if (!key || existing.has(key)) continue;
    const sourceRow = verifiedFlowRowsByKey?.get(key);
    if (!sourceRow) continue;
    const carried = {
      ...sourceRow,
      schema_version: 1,
      status: "verified",
      carried_forward: true,
      carried_forward_at_utc: nowIso(),
      carried_forward_for_process_id: processId,
    };
    appendJsonLine(ledgerPath, carried);
    existing.add(key);
    written.push({
      id: identity.id || carried.dataset_id || carried.flow_id,
      version: identity.version || carried.dataset_version || carried.flow_version || "00.00.001",
      identity_key: key,
      source_ledger_file: carried.source_ledger_file ?? null,
    });
  }
  return {
    count: written.length,
    rows: written,
    ledger: ledgerPath,
  };
}

function scopeKeyFromLedgerRow(row) {
  const id = row?.process_id || row?.dataset_id || row?.id;
  const version = row?.process_version || row?.dataset_version || row?.version || "00.00.001";
  return id ? `${id}@${version}` : null;
}

function writeBlockedScopeViews(paths) {
  const verified = new Map();
  for (const row of readJsonLines(paths.okScopes)) {
    const key = scopeKeyFromLedgerRow(row);
    if (key) verified.set(key, row);
  }
  const historical = readJsonLines(paths.blockedHumanReview);
  const active = [];
  const resolved = [];
  for (const row of historical) {
    const key = scopeKeyFromLedgerRow(row);
    const ok = key ? verified.get(key) : null;
    if (!ok) {
      active.push(row);
      continue;
    }
    resolved.push({
      ...row,
      resolution_status: "resolved_by_verified_scope",
      resolved_at_utc: ok.generated_at_utc ?? null,
      resolved_report: ok.report ?? null,
    });
  }
  writeJsonLines(paths.blockedHumanReviewActive, active);
  writeJsonLines(paths.blockedHumanReviewResolved, resolved);
  return {
    historical: historical.length,
    active: active.length,
    resolved: resolved.length,
  };
}

function loadActiveBlockedScopeSetFromFiles(filePaths, verifiedScopes) {
  const set = new Set();
  for (const filePath of filePaths) {
    for (const row of readJsonLines(filePath)) {
      const key = scopeKeyFromLedgerRow(row);
      if (key && !verifiedScopes.has(key)) set.add(key);
    }
  }
  return set;
}

function loadActiveBlockedScopeSet(paths, verifiedScopes) {
  return loadActiveBlockedScopeSetFromFiles([paths.blockedHumanReview], verifiedScopes);
}

function scopeKey(scope) {
  return `${scope.process_id || scope.id}@${scope.process_version || scope.version || "00.00.001"}`;
}

function finiteNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function scopeEstimatedWeight(scope) {
  const direct = [
    scope?.estimated_weight,
    scope?.estimatedWeight,
    scope?.weight,
    scope?.checkpoint?.estimated_weight,
    scope?.checkpoint?.estimatedWeight,
    scope?.checkpoint?.weight,
  ];
  for (const value of direct) {
    const parsed = finiteNumber(value);
    if (parsed != null) return parsed;
  }
  const counts = scope?.dependency_counts ?? scope?.checkpoint?.dependency_counts ?? {};
  const flowCount = finiteNumber(counts.flows ?? counts.flow_count ?? scope?.flow_count);
  const supportCount = finiteNumber(
    counts.support_rows ?? counts.support ?? counts.sources ?? scope?.support_count,
  );
  const processCount = finiteNumber(counts.processes ?? counts.process_count ?? 1);
  if (flowCount != null || supportCount != null || processCount != null) {
    return (flowCount ?? 0) + (supportCount ?? 0) + (processCount ?? 0);
  }
  return null;
}

function asArray(value) {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function classificationDecisionKey({ datasetType, datasetId, datasetVersion, categoryType }) {
  const type = asText(datasetType);
  const id = asText(datasetId);
  const version = asText(datasetVersion) || "00.00.001";
  const category = asText(categoryType);
  return type && id && category ? `${type}:${id}@${version}:${category}` : null;
}

function loadClassificationDecisionIndex(filePath) {
  const byKey = new Map();
  const rows = readJsonLines(filePath);
  for (const row of rows) {
    const key = classificationDecisionKey({
      datasetType: row?.dataset_type,
      datasetId: row?.dataset_id,
      datasetVersion: row?.dataset_version,
      categoryType: row?.category_type,
    });
    if (key) byKey.set(key, row);
  }
  return {
    row_count: rows.length,
    indexed_decisions: byKey.size,
    byKey,
  };
}

function isLeafClassificationDecision(row) {
  return (
    row &&
    asText(row.decision_status || "completed") === "completed" &&
    asText(row.classification_decision_level) === "leaf" &&
    Boolean(asText(row.selected_code ?? row.code))
  );
}

function scopeClassificationRequirements(scope) {
  const processId = asText(scope?.process_id ?? scope?.id);
  const processVersion = asText(scope?.process_version ?? scope?.version) || "00.00.001";
  const requirements = [];
  if (processId) {
    requirements.push({
      dataset_type: "process",
      dataset_id: processId,
      dataset_version: processVersion,
      category_type: "process",
    });
  }
  for (const flow of asArray(scope?.dependency_ids?.flows)) {
    const flowType = asText(flow?.flow_type);
    if (flowType && flowType !== "Product flow") continue;
    const flowId = asText(flow?.id ?? flow?.dataset_id);
    if (!flowId) continue;
    requirements.push({
      dataset_type: "flow",
      dataset_id: flowId,
      dataset_version: asText(flow?.version ?? flow?.dataset_version) || "00.00.001",
      category_type: "flow-product",
    });
  }
  return requirements;
}

function scopeClassificationPreflight(scope, classificationDecisionIndex) {
  const requirements = scopeClassificationRequirements(scope);
  const missing = [];
  const notLeaf = [];
  for (const requirement of requirements) {
    const key = classificationDecisionKey({
      datasetType: requirement.dataset_type,
      datasetId: requirement.dataset_id,
      datasetVersion: requirement.dataset_version,
      categoryType: requirement.category_type,
    });
    const decision = key ? classificationDecisionIndex?.byKey?.get(key) : null;
    if (!decision) {
      missing.push(requirement);
      continue;
    }
    if (!isLeafClassificationDecision(decision)) {
      notLeaf.push({
        ...requirement,
        selected_code: asText(decision.selected_code ?? decision.code) || null,
        classification_decision_level: asText(decision.classification_decision_level) || null,
        decision_status: asText(decision.decision_status) || null,
      });
    }
  }
  const status = missing.length > 0 ? "missing" : notLeaf.length > 0 ? "not_leaf" : "leaf";
  return {
    status,
    checked_decisions: requirements.length,
    missing_decisions: missing.length,
    not_leaf_decisions: notLeaf.length,
    first_missing: missing[0] ?? null,
    first_not_leaf: notLeaf[0] ?? null,
  };
}

function selectionOrderOption(value) {
  const normalized = asText(value || "input");
  const aliases = {
    family: "family-master-first",
    "family-master": "family-master-first",
    weight: "estimated-weight-asc",
    "weight-asc": "estimated-weight-asc",
    "weight-desc": "estimated-weight-desc",
    estimated_weight_asc: "estimated-weight-asc",
    estimated_weight_desc: "estimated-weight-desc",
  };
  const order = aliases[normalized] ?? normalized;
  if (
    ![
      "input",
      "estimated-weight-asc",
      "estimated-weight-desc",
      "family-master-first",
      "family-master-first-weight-asc",
    ].includes(order)
  ) {
    throw new Error(
      `Unsupported --selection-order ${JSON.stringify(normalized)}. Use input, estimated-weight-asc, estimated-weight-desc, family-master-first, or family-master-first-weight-asc.`,
    );
  }
  return order;
}

function compareSelectionRows(left, right, selectionOrder) {
  if (selectionOrder.startsWith("family-master-first")) {
    const leftRank = bafuFamilySelectionRank(left.familySignature);
    const rightRank = bafuFamilySelectionRank(right.familySignature);
    if (leftRank !== rightRank) return leftRank - rightRank;
    const leftGroup = left.familySignature?.family_group_key ?? "";
    const rightGroup = right.familySignature?.family_group_key ?? "";
    if (leftGroup !== rightGroup) return leftGroup.localeCompare(rightGroup);
    if (selectionOrder === "family-master-first-weight-asc") {
      const leftUnknown = left.weight == null;
      const rightUnknown = right.weight == null;
      if (leftUnknown !== rightUnknown) return leftUnknown ? 1 : -1;
      if (!leftUnknown && !rightUnknown && left.weight !== right.weight) {
        return left.weight - right.weight;
      }
    }
    return left.index - right.index;
  }
  if (selectionOrder === "input") return left.index - right.index;
  const leftUnknown = left.weight == null;
  const rightUnknown = right.weight == null;
  if (leftUnknown !== rightUnknown) return leftUnknown ? 1 : -1;
  if (!leftUnknown && !rightUnknown && left.weight !== right.weight) {
    return selectionOrder === "estimated-weight-desc"
      ? right.weight - left.weight
      : left.weight - right.weight;
  }
  return left.index - right.index;
}

function selectScopesForRun({
  allScopes,
  requestedProcessIds,
  verifiedScopes,
  blockedScopes,
  pendingOnly,
  force,
  selectionOrder,
  limit,
  familySignatureIndex,
  classificationDecisionIndex,
  requireLeafClassification,
}) {
  const explicit = requestedProcessIds.size > 0;
  const stats = {
    input_scopes: allScopes.length,
    matched_scopes: 0,
    filtered_already_verified: 0,
    filtered_already_blocked: 0,
    filtered_classification_missing: 0,
    filtered_classification_not_leaf: 0,
    candidate_scopes_before_limit: 0,
    selected_scopes: 0,
  };
  const candidates = [];
  for (const [index, scope] of allScopes.entries()) {
    const processId = scope?.process_id || scope?.id;
    if (explicit && !requestedProcessIds.has(processId)) continue;
    stats.matched_scopes += 1;
    const key = scopeKey(scope);
    if (pendingOnly && !force && verifiedScopes.has(key)) {
      stats.filtered_already_verified += 1;
      continue;
    }
    if (pendingOnly && !force && !explicit && blockedScopes.has(key)) {
      stats.filtered_already_blocked += 1;
      continue;
    }
    const classificationPreflight = scopeClassificationPreflight(
      scope,
      classificationDecisionIndex,
    );
    if (requireLeafClassification && classificationPreflight.status !== "leaf") {
      if (classificationPreflight.status === "missing") {
        stats.filtered_classification_missing += 1;
      } else {
        stats.filtered_classification_not_leaf += 1;
      }
      continue;
    }
    candidates.push({
      scope,
      index,
      weight: scopeEstimatedWeight(scope),
      familySignature: bafuFamilySignatureForScope(familySignatureIndex, scope),
      classificationPreflight,
    });
  }
  candidates.sort((left, right) => compareSelectionRows(left, right, selectionOrder));
  stats.candidate_scopes_before_limit = candidates.length;
  const limited = limit == null ? candidates : candidates.slice(0, limit);
  stats.selected_scopes = limited.length;
  return {
    scopes: limited.map((entry) => entry.scope),
    stats,
  };
}

function preflightPlanRows({
  scopes,
  verifiedScopes,
  blockedScopes,
  familySignatureIndex,
  classificationDecisionIndex,
}) {
  return scopes.map((scope, index) => {
    const key = scopeKey(scope);
    const familySignature = bafuFamilySignatureForScope(familySignatureIndex, scope);
    const classificationPreflight = scopeClassificationPreflight(
      scope,
      classificationDecisionIndex,
    );
    return {
      schema_version: 1,
      index,
      process_id: scope.process_id || scope.id,
      process_version: scope.process_version || scope.version || "00.00.001",
      scope_key: key,
      estimated_weight: scopeEstimatedWeight(scope),
      already_verified: verifiedScopes.has(key),
      already_blocked: blockedScopes.has(key),
      closure_status: scope.closure_status ?? scope.status ?? null,
      classification_preflight_status: classificationPreflight.status,
      classification_preflight_checked_decisions: classificationPreflight.checked_decisions,
      classification_preflight_missing_decisions: classificationPreflight.missing_decisions,
      classification_preflight_not_leaf_decisions: classificationPreflight.not_leaf_decisions,
      classification_preflight_first_missing: classificationPreflight.first_missing,
      classification_preflight_first_not_leaf: classificationPreflight.first_not_leaf,
      ...bafuFamilyPlanFields(familySignature),
    };
  });
}

function batchRunStatus(results, { paused = false, stoppedAfterBlocked = false } = {}) {
  const failed = results.some((row) => row.status === "failed");
  const blocked = results.some((row) => row.status === "blocked");
  if (stoppedAfterBlocked) {
    if (failed) return "stopped_after_blocked_with_retryable_failures";
    return "stopped_after_blocked";
  }
  if (paused) {
    if (failed) return "paused_with_retryable_failures";
    if (blocked) return "paused_with_deferred_scopes";
    return "paused";
  }
  if (failed) return "completed_with_retryable_failures";
  if (blocked) return "completed_with_deferred_scopes";
  return "completed";
}

function okDatasetRow({ type, id, version, processId, report, files }) {
  return {
    schema_version: 1,
    generated_at_utc: nowIso(),
    dataset_type: type,
    dataset_id: id,
    dataset_version: version || "00.00.001",
    process_id: processId,
    status: "verified",
    report: repoRelative(report),
    files,
  };
}

function blockRow({ scope, stage, blocker, report, rerunCommand }) {
  return {
    schema_version: 1,
    generated_at_utc: nowIso(),
    process_id: scope.process_id || scope.id,
    process_version: scope.process_version || scope.version || "00.00.001",
    stage,
    code: blocker?.code || "blocked",
    message: blocker?.message || "Scope is blocked.",
    blocker,
    report: repoRelative(report),
    required_human_action:
      blocker?.required_human_action ||
      "Review the stage report, complete missing semantic decisions or references, then rerun this scope.",
    rerun_command: rerunCommand,
  };
}

// Worker-level safety net: an uncaught throw inside runOneScope (e.g. a transient
// fs EINVAL/ENOENT from concurrent shared-cache access at higher --parallel) would
// otherwise reject Promise.all and abort the ENTIRE batch with no ledgers written.
// Record the scope as a retryable failure (mirroring the in-scope `fail` path) so the
// remaining scopes continue and the failed scope can simply be rerun.
function recordScopeExecutionException({ scope, familySignature, error, paths }) {
  const processId = scope.process_id || scope.id;
  const processVersion = scope.process_version || scope.version || "00.00.001";
  const row = blockRow({
    scope,
    stage: "scope_execution",
    blocker: {
      code: "scope_execution_exception",
      message: `Uncaught error during scope execution: ${error?.message || String(error)}`,
      retryable: true,
      retryable_reason_code: "scope_execution_exception",
      required_human_action:
        "Transient runtime error during scope execution (often a concurrent shared-cache fs race at higher --parallel). Rerun the exact scope command; if it persists, retry with --parallel 1.",
    },
    report: null,
    rerunCommand: commandString([
      process.execPath,
      "scripts/foundry.mjs",
      commandName,
      "--scope-file",
      repoRelative(paths.scopeFile),
      "--process-bundles-dir",
      repoRelative(paths.processBundlesDir),
      "--run-dir",
      repoRelative(paths.runDir),
      "--out-dir",
      repoRelative(paths.outDir),
      "--process-id",
      processId,
      "--commit",
      "--parallel",
      "1",
    ]),
  });
  appendJsonLine(paths.failedRetry, row);
  appendJsonLine(paths.blocked_remote_write, row);
  appendJsonLine(paths.scopeCheckpoints, {
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

const retryableStageFailurePattern =
  /\b(?:ENOTFOUND|EAI_AGAIN|ETIMEDOUT|ECONNRESET|ECONNREFUSED|ECONNABORTED|EHOSTUNREACH|ENETUNREACH|ESOCKETTIMEDOUT)\b|npm error network|registry\.npmjs\.org|network connectivity|timed out after|lookup_failed after insert|identity_preflight_report_missing_or_non_json|identity_preflight_timeout|REMOTE_REQUEST_FAILED|Auth session missing/u;

function failedStageNestedReportText(stageEntry) {
  if (!stageEntry || stageEntry.exit_code === 0) return [];
  const nestedPath = resolveRepoPath(stageEntry.report_file);
  if (!nestedPath || !fileExists(nestedPath)) return [];
  let nested;
  try {
    nested = readJson(nestedPath);
  } catch {
    return [];
  }
  return [
    nested?.status,
    ...(Array.isArray(nested?.blockers) ? nested.blockers : []).map((entry) =>
      JSON.stringify(entry),
    ),
  ].filter(Boolean);
}

function retryableStageFailureText({ blocker, report }) {
  const parts = [
    blocker?.code,
    blocker?.message,
    blocker?.stderr,
    blocker?.stage?.stderr,
    blocker?.stage?.command,
  ];
  const reportPath = resolveRepoPath(report);
  if (fileExists(reportPath)) {
    const reportJson = readJson(reportPath);
    parts.push(
      reportJson?.status,
      ...(reportJson?.blockers ?? []).map((entry) => JSON.stringify(entry)),
      ...(reportJson?.stages ?? []).map((entry) =>
        [entry?.stage, entry?.status, entry?.exit_code, entry?.stderr, entry?.command]
          .filter((value) => value != null && value !== "")
          .join("\n"),
      ),
      ...(reportJson?.stages ?? []).flatMap((entry) => failedStageNestedReportText(entry)),
    );
  }
  return parts.filter(Boolean).join("\n");
}

function retryableStageFailure({ stage, blocker, report }) {
  const code = String(blocker?.code ?? "");
  const stageName = String(stage ?? "");
  if (
    !/(?:_stage_failed|_command_failed|_timeout|_report_missing|not_completed|not_ready|handoff_failed)$/u.test(
      code,
    ) &&
    !/(?:commit|verify|finalize|apply|materialize|preflight)/u.test(stageName)
  ) {
    return null;
  }
  const text = retryableStageFailureText({ blocker, report });
  if (!retryableStageFailurePattern.test(text)) return null;
  const match = text.match(retryableStageFailurePattern);
  return {
    code: match?.[0] ?? "retryable_stage_failure",
    message:
      "Stage failed for a retryable tool, network, or eventual-consistency reason; rerun the same scope instead of sending it to human review.",
  };
}

function buildFinalizeArgs({
  type,
  rowsFile,
  outDir,
  ledgerDir,
  sourceSupportRowsFile,
  sourceRowsFile,
  flowpropertyRowsFile,
  unitgroupRowsFile,
  identityPreflightIndex,
  context,
  classificationQueue,
  locationQueue,
  classificationApplyReport,
  locationApplyReport,
  identityApplyReports,
  patchCollectReport,
  patchApplyReport,
  targetUserId,
  stateCode,
}) {
  const args = [
    process.execPath,
    "scripts/foundry.mjs",
    "dataset-post-authoring-finalize",
    "--type",
    type,
    "--profile",
    activeProfile(),
    "--rows-file",
    repoRelative(rowsFile),
    "--out-dir",
    repoRelative(outDir),
    "--ledger-dir",
    repoRelative(ledgerDir),
  ];
  appendPathOption(args, "--source-support-rows-file", sourceSupportRowsFile);
  appendPathOption(args, "--source-rows-file", sourceRowsFile);
  appendPathOption(args, "--identity-preflight-index", identityPreflightIndex);
  appendPathOption(args, "--schema-file", context.schemaFile);
  appendPathOption(args, "--yaml-file", context.yamlFile);
  appendPathOption(args, "--ruleset-file", context.rulesetFile);
  appendPathOption(args, "--classification-queue", classificationQueue);
  appendPathOption(args, "--location-queue", locationQueue);
  appendPathOption(args, "--classification-decision-apply-report", classificationApplyReport);
  appendPathOption(args, "--location-decision-apply-report", locationApplyReport);
  appendPathOptions(args, "--identity-decision-apply-report", identityApplyReports);
  appendPathOption(args, "--patch-collect-report", patchCollectReport);
  appendPathOption(args, "--patch-apply-report", patchApplyReport);
  appendOption(args, "--target-user-id", targetUserId);
  appendOption(args, "--state-code", stateCode);
  appendOption(args, "--root-policy", "candidate");
  args.push(
    "--finalize-source-contact-support",
    "--verify-remote",
    "--run-identity-preflight",
    "--refresh-identity-preflight",
  );
  // Thread the active profile's library contact identity into the finalize
  // subprocess so its buildLibraryContactPayload mints the SAME shared library
  // contact the materialize stage stamped (deterministic on profile+name+website).
  // Without this the finalize would fall back to the default (BAFU FOEN) contact.
  // Empty for BAFU (no libraryContact config) → BAFU finalize args unchanged.
  const libraryContact = bafuBatchConfig.libraryContact;
  if (libraryContact && typeof libraryContact === "object") {
    appendOption(args, "--library-name", libraryContact.libraryName);
    appendOption(args, "--library-short-name", libraryContact.shortName);
    appendOption(args, "--library-website", libraryContact.website);
    appendOption(args, "--library-email", libraryContact.email);
    appendOption(args, "--library-telephone", libraryContact.telephone);
    appendOption(args, "--library-contact-address", libraryContact.contactAddress);
    appendOption(args, "--library-central-contact-point", libraryContact.centralContactPoint);
    appendOption(args, "--library-description", libraryContact.description);
    // Optional explicit identity to REUSE an existing packaged contact as the
    // shared library contact (worldsteel reuses its packaged contact d5710976)
    // instead of minting a synthetic deterministic foundry contact.
    appendOption(args, "--library-contact-id", libraryContact.contactId);
    appendOption(args, "--library-contact-version", libraryContact.contactVersion);
  }
  // P1a: USLCI-only — mint unmatched FP/UG as account-local support before the
  // flows that reference them. Empty for BAFU (config flag off) so its finalize
  // args and reference-only FP/UG policy are unchanged.
  if (mintUnmatchedFpUgSupport()) {
    args.push("--mint-unmatched-fp-ug-support");
    appendPathOption(args, "--support-flowproperty-rows-file", flowpropertyRowsFile);
    appendPathOption(args, "--support-unitgroup-rows-file", unitgroupRowsFile);
  }
  if (patchCollectReport) args.push("--require-patch-collect-report");
  return args;
}

async function runFinalizeStage({ stage, args, reportPath, logDir }) {
  const result = await runArgvStage({ stage, argv: args, logDir });
  const reportExists = fileExists(reportPath);
  const report = reportExists
    ? readJson(reportPath)
    : {
        schema_version: 1,
        generated_at_utc: nowIso(),
        status: "failed_retryable",
        blockers: [
          {
            code: result.timed_out ? "finalize_stage_timeout" : "finalize_report_missing",
            message: result.timed_out
              ? `${stage} timed out before writing the expected finalize report.`
              : `${stage} did not write the expected finalize report.`,
            stage,
            expected_report: repoRelative(reportPath),
            exit_code: result.exit_code,
            timed_out: Boolean(result.timed_out),
            stdout_log: result.stdout_log,
            stderr_log: result.stderr_log,
            stdout_report_status: result.json?.status ?? null,
            stdout_report_dataset_type: result.json?.dataset_type ?? null,
          },
        ],
        files: {
          expected_report: repoRelative(reportPath),
          stdout_log: result.stdout_log,
          stderr_log: result.stderr_log,
        },
      };
  result.finalize_report_missing = !reportExists;
  result.report = repoRelative(reportPath);
  result.json = report;
  return result;
}

async function runIdentityAndPatch({
  type,
  inputRowsFile,
  preFinalizeReport,
  scopeDir,
  runDir,
  logDir,
  stages,
  label = type,
  stagePrefix = type,
  // FIX A: rewrite rows for THIS scope's process_id (may be undefined) + the mode flag.
  resolutionRewriteRows = undefined,
  applyResolutionRewritesMode = false,
}) {
  const gateReport = resolveRepoPath(preFinalizeReport?.files?.curation_gate_report);
  if (!fileExists(gateReport)) {
    return {
      status: "blocked",
      blocker: {
        code: `${type}_curation_gate_report_missing`,
        message: `${type} curation gate report is required for identity and patch authoring.`,
      },
    };
  }

  const identityTaskDir = path.join(scopeDir, `${label}-identity-task`);
  const identityTask = await runArgvStage({
    stage: `${stagePrefix}.identity_task`,
    argv: foundryCommand("dataset-identity-decision-task-build", {
      curationGateReport: repoRelative(gateReport),
      outDir: repoRelative(identityTaskDir),
      sharedContextCacheDir: repoRelative(path.join(runDir, "shared-context-cache")),
    }),
    logDir,
    reportPath: path.join(identityTaskDir, "identity-decision-task-report.json"),
  });
  stages.push(identityTask);
  if (
    !statusIs(identityTask.json, ["ready_for_ai_identity_decisions", "ready_no_identity_actions"])
  ) {
    return {
      status: "blocked",
      blocker: firstBlocker(
        identityTask.json,
        `${type}_identity_task_not_ready`,
        `${type} identity task did not become ready.`,
      ),
      report: reportFile(
        identityTask.json,
        path.join(identityTaskDir, "identity-decision-task-report.json"),
      ),
    };
  }

  let identityApplyReport = null;
  let identityOutputRows = inputRowsFile;
  const identityDecisions = path.join(identityTaskDir, "identity-decisions.jsonl");
  if (bafuAutofillEnabled() && statusIs(identityTask.json, ["ready_for_ai_identity_decisions"])) {
    const identityAutofill = await runArgvStage({
      stage: `${stagePrefix}.identity_autofill`,
      argv: foundryCommand("dataset-bafu-identity-decisions-autofill", {
        identityDecisionTask: repoRelative(
          path.join(identityTaskDir, "identity-decision-task.json"),
        ),
      }),
      logDir,
      reportPath: path.join(identityTaskDir, "bafu-identity-decisions-autofill-report.json"),
    });
    stages.push(identityAutofill);
    if (!statusIs(identityAutofill.json, ["completed", "completed_with_manual_review"])) {
      return {
        status: "blocked",
        blocker: firstBlocker(
          identityAutofill.json,
          `${type}_identity_autofill_not_completed`,
          `${type} identity autofill did not complete.`,
        ),
        report: reportFile(
          identityAutofill.json,
          path.join(identityTaskDir, "bafu-identity-decisions-autofill-report.json"),
        ),
      };
    }
    const carryForward = mergeCompletedReusableIdentityDecisions({
      runDir,
      decisionsFile: identityDecisions,
      outDir: identityTaskDir,
      datasetType: type,
      rowsFile: inputRowsFile,
      curationGateReport: gateReport,
    });
    stages.push({
      stage: `${stagePrefix}.identity_decision_carry_forward`,
      status: carryForward.report.status,
      report: repoRelative(carryForward.reportPath),
      replacements: carryForward.report.counts.replacements,
      additions: carryForward.report.counts.additions,
      conflicts: carryForward.report.counts.conflicts,
    });
    const identityApplyDir = path.join(scopeDir, `${label}-identity-apply`);
    const identityApply = await runArgvStage({
      stage: `${stagePrefix}.identity_apply`,
      argv: foundryCommand("dataset-identity-decisions-apply", {
        type,
        profile: activeProfile(),
        rowsFile: repoRelative(inputRowsFile),
        decisions: repoRelative(carryForward.outputFile),
        outDir: repoRelative(identityApplyDir),
        authoringPackageDir: repoRelative(
          path.join(identityTaskDir, "authoring-package-snapshots"),
        ),
      }),
      logDir,
      reportPath: path.join(identityApplyDir, "identity-decisions-apply-report.json"),
    });
    stages.push(identityApply);
    identityApplyReport = reportFile(
      identityApply.json,
      path.join(identityApplyDir, "identity-decisions-apply-report.json"),
    );
    if (!statusIs(identityApply.json, ["completed"])) {
      return {
        status: "blocked",
        blocker: firstBlocker(
          identityApply.json,
          `${type}_identity_apply_not_completed`,
          `${type} identity decisions did not apply cleanly.`,
        ),
        report: identityApplyReport,
      };
    }
    const unresolvedReferenceBlocker = identityUnresolvedReferenceBlocker({
      type,
      report: identityApply.json,
    });
    if (unresolvedReferenceBlocker) {
      return {
        status: "blocked",
        blocker: unresolvedReferenceBlocker,
        report: identityApplyReport,
      };
    }
    identityOutputRows =
      resolveRepoPath(identityApply.json?.files?.output_rows) || identityOutputRows;
  } else if (
    applyResolutionRewritesMode &&
    type === "flow" &&
    resolutionRewriteRows &&
    resolutionRewriteRows.length > 0
  ) {
    // FIX A: deterministic identity application from the authoritative library
    // resolution. The carry-forward (decisions-* glob -> byKey -> additions) frequently
    // produced additions=0 for autofill-off scopes, skipping the apply entirely and
    // wrongly minting every dependency flow even when the offline resolution already
    // matched them to canonical. Here we synthesize one completed reuse decision per
    // distinct source flow proven by the resolution and apply it UNCONDITIONALLY, so
    // every proven reuse becomes a canonical reference and only no-rewrite flows mint.
    const distinctBySourceFlow = new Map();
    for (const rewrite of resolutionRewriteRows) {
      const sourceFlowId = asText(rewrite?.source_flow_id);
      if (!sourceFlowId) continue;
      const sourceFlowVersion = asText(rewrite?.source_flow_version) || "00.00.001";
      const key = `${sourceFlowId}@@${sourceFlowVersion}`;
      if (distinctBySourceFlow.has(key)) continue;
      distinctBySourceFlow.set(key, {
        schema_version: 1,
        dataset_type: "flow",
        dataset_id: sourceFlowId,
        dataset_version: sourceFlowVersion,
        decision: "reuse_existing_reference",
        identity_decision: "reuse_existing_reference",
        decision_status: "completed",
        canonical: {
          table: "flows",
          ref_object_id: asText(rewrite?.canonical_flow_id),
          version: asText(rewrite?.canonical_flow_version) || "00.00.001",
          // Carry the canonical flow's display name so dataset-identity-decisions-apply
          // sets referenceToFlowDataSet common:shortDescription to the real name instead
          // of falling back to the UUID (identity-decisions.mjs: short_description ?? id).
          short_description: asText(rewrite?.canonical_short_description) || undefined,
        },
        canonical_flow_id: asText(rewrite?.canonical_flow_id),
        canonical_flow_version: asText(rewrite?.canonical_flow_version) || "00.00.001",
        canonical_short_description: asText(rewrite?.canonical_short_description) || undefined,
        basis:
          "Applied from library-resolution exchange-reference-rewrites (deterministic physical-equivalence reuse).",
        evidence: {
          source: "library-resolution",
          artifact: "exchange-reference-rewrites.jsonl",
          process_id: asText(rewrite?.process_id),
          exchange_index: rewrite?.exchange_index ?? null,
        },
        used_context_kinds: ["schema", "methodology_yaml", "ruleset", "library_resolution"],
        closes_action_items: [
          "identity_preflight_manual_review",
          "elementary_flow_identity_manual_review",
        ],
        confidence: "high",
      });
    }
    const resolutionDecisions = [...distinctBySourceFlow.values()];
    const resolutionDecisionsFile = path.join(
      identityTaskDir,
      "identity-decisions.resolution.jsonl",
    );
    writeJsonLines(resolutionDecisionsFile, resolutionDecisions);
    stages.push({
      stage: `${stagePrefix}.identity_resolution_rewrites`,
      status: "completed",
      reuse_count: resolutionDecisions.length,
      report: repoRelative(resolutionDecisionsFile),
    });
    const identityApplyDir = path.join(scopeDir, `${label}-identity-apply`);
    const identityApply = await runArgvStage({
      stage: `${stagePrefix}.identity_apply`,
      argv: foundryCommand("dataset-identity-decisions-apply", {
        type,
        profile: activeProfile(),
        rowsFile: repoRelative(inputRowsFile),
        decisions: repoRelative(resolutionDecisionsFile),
        outDir: repoRelative(identityApplyDir),
      }),
      logDir,
      reportPath: path.join(identityApplyDir, "identity-decisions-apply-report.json"),
    });
    stages.push(identityApply);
    identityApplyReport = reportFile(
      identityApply.json,
      path.join(identityApplyDir, "identity-decisions-apply-report.json"),
    );
    if (!statusIs(identityApply.json, ["completed"])) {
      return {
        status: "blocked",
        blocker: firstBlocker(
          identityApply.json,
          `${type}_identity_apply_not_completed`,
          `${type} identity decisions did not apply cleanly.`,
        ),
        report: identityApplyReport,
      };
    }
    const unresolvedReferenceBlocker = identityUnresolvedReferenceBlocker({
      type,
      report: identityApply.json,
    });
    if (unresolvedReferenceBlocker) {
      return {
        status: "blocked",
        blocker: unresolvedReferenceBlocker,
        report: identityApplyReport,
      };
    }
    identityOutputRows =
      resolveRepoPath(identityApply.json?.files?.output_rows) || identityOutputRows;
  } else {
    // Pre-authored reuse path (no runtime AI autofill). Reached for BOTH
    // ready_no_identity_actions AND ready_for_ai_identity_decisions when autofill is
    // disabled (e.g. USLCI: identity decisions are authored offline, not by per-scope
    // autofill). Rows carry completed library reuse decisions from the offline
    // decisions-* dirs; the carry-forward merges them and the apply rewrites references
    // to canonical so reuse-eligible flows become references instead of account-local
    // mints. Without this branch, autofill-off scopes whose identity task still has
    // action items (ready_for_ai_identity_decisions) would skip the apply entirely and
    // wrongly mint flows that the offline decisions already matched to canonical.
    const carryForward = mergeCompletedReusableIdentityDecisions({
      runDir,
      decisionsFile: identityDecisions,
      outDir: identityTaskDir,
      datasetType: type,
      rowsFile: inputRowsFile,
      curationGateReport: gateReport,
    });
    stages.push({
      stage: `${stagePrefix}.identity_decision_carry_forward`,
      status: carryForward.report.status,
      report: repoRelative(carryForward.reportPath),
      replacements: carryForward.report.counts.replacements,
      additions: carryForward.report.counts.additions,
      conflicts: carryForward.report.counts.conflicts,
    });
    if (carryForward.report.counts.additions > 0 || carryForward.report.counts.replacements > 0) {
      const identityApplyDir = path.join(scopeDir, `${label}-identity-apply`);
      const identityApply = await runArgvStage({
        stage: `${stagePrefix}.identity_apply`,
        argv: foundryCommand("dataset-identity-decisions-apply", {
          type,
          profile: activeProfile(),
          rowsFile: repoRelative(inputRowsFile),
          decisions: repoRelative(carryForward.outputFile),
          outDir: repoRelative(identityApplyDir),
        }),
        logDir,
        reportPath: path.join(identityApplyDir, "identity-decisions-apply-report.json"),
      });
      stages.push(identityApply);
      identityApplyReport = reportFile(
        identityApply.json,
        path.join(identityApplyDir, "identity-decisions-apply-report.json"),
      );
      if (!statusIs(identityApply.json, ["completed"])) {
        return {
          status: "blocked",
          blocker: firstBlocker(
            identityApply.json,
            `${type}_identity_apply_not_completed`,
            `${type} identity decisions did not apply cleanly.`,
          ),
          report: identityApplyReport,
        };
      }
      const unresolvedReferenceBlocker = identityUnresolvedReferenceBlocker({
        type,
        report: identityApply.json,
      });
      if (unresolvedReferenceBlocker) {
        return {
          status: "blocked",
          blocker: unresolvedReferenceBlocker,
          report: identityApplyReport,
        };
      }
      identityOutputRows =
        resolveRepoPath(identityApply.json?.files?.output_rows) || identityOutputRows;
    }
  }

  const authoringDir = path.join(scopeDir, `${label}-authoring-tasks`);
  const taskManifest = path.join(authoringDir, "authoring-task-manifest.json");
  const taskBuild = await runArgvStage({
    stage: `${stagePrefix}.authoring_task`,
    argv: foundryCommand("dataset-authoring-task-build", {
      curationGateReport: repoRelative(gateReport),
      outDir: repoRelative(authoringDir),
      sharedContextCacheDir: repoRelative(path.join(runDir, "shared-context-cache")),
    }),
    logDir,
    reportPath: taskManifest,
  });
  stages.push(taskBuild);
  if (!statusIs(taskBuild.json, ["ready_for_ai_authoring_batch", "ready_no_action_items"])) {
    return {
      status: "blocked",
      blocker: firstBlocker(
        taskBuild.json,
        `${type}_authoring_task_not_ready`,
        `${type} authoring task did not become ready.`,
      ),
      report: reportFile(taskBuild.json, taskManifest),
    };
  }
  if (statusIs(taskBuild.json, ["ready_no_action_items"])) {
    return {
      status: "completed",
      rowsFile: identityOutputRows,
      identityApplyReport,
      patchCollectReport: null,
      patchApplyReport: null,
    };
  }

  const taskFilter = filterAuthoringTaskManifestToRows({
    taskManifest,
    rowsFile: identityOutputRows,
    type,
    reportPath: path.join(authoringDir, "authoring-task-filter-report.json"),
  });
  const activeTaskManifest = taskFilter.taskManifest;
  if (taskFilter.status === "ready_no_action_items") {
    return {
      status: "completed",
      rowsFile: identityOutputRows,
      identityApplyReport,
      patchCollectReport: null,
      patchApplyReport: null,
    };
  }

  if (!bafuAutofillEnabled()) {
    // Non-BAFU profiles (e.g. USLCI) must not run BAFU-shaped patch autofill;
    // surface the un-authored action items instead of mis-authoring them.
    return {
      status: "blocked",
      blocker: {
        code: `${type}_authoring_action_items_require_authoring`,
        message: `${type} scope has authoring action items but BAFU patch autofill is disabled for this profile; author the fields explicitly before commit.`,
      },
      report: reportFile(taskBuild.json, taskManifest),
    };
  }
  const patchAutofill = await runArgvStage({
    stage: `${stagePrefix}.patch_autofill`,
    argv: foundryCommand("dataset-bafu-authoring-patches-autofill", {
      taskManifest: repoRelative(activeTaskManifest),
    }),
    logDir,
    reportPath: path.join(authoringDir, "bafu-authoring-patches-autofill-report.json"),
  });
  stages.push(patchAutofill);
  if (!statusIs(patchAutofill.json, ["completed", "completed_no_supported_patches"])) {
    return {
      status: "blocked",
      blocker: firstBlocker(
        patchAutofill.json,
        `${type}_patch_autofill_not_completed`,
        `${type} patch autofill did not complete.`,
      ),
      report: reportFile(
        patchAutofill.json,
        path.join(authoringDir, "bafu-authoring-patches-autofill-report.json"),
      ),
    };
  }

  const patchCollect = await runArgvStage({
    stage: `${stagePrefix}.patch_collect`,
    argv: foundryCommand("dataset-authoring-patch-collect", {
      taskManifest: repoRelative(activeTaskManifest),
    }),
    logDir,
    reportPath: path.join(authoringDir, "authoring-patch-collect-report.json"),
  });
  stages.push(patchCollect);
  const patchCollectReport = reportFile(
    patchCollect.json,
    path.join(authoringDir, "authoring-patch-collect-report.json"),
  );
  if (!statusIs(patchCollect.json, ["ready_for_patch_apply", "ready_no_patch_required"])) {
    return {
      status: "blocked",
      blocker: firstBlocker(
        patchCollect.json,
        `${type}_patch_collect_not_ready`,
        `${type} patch collection did not become ready.`,
      ),
      report: patchCollectReport,
    };
  }
  if (statusIs(patchCollect.json, ["ready_no_patch_required"])) {
    return {
      status: "completed",
      rowsFile: identityOutputRows,
      identityApplyReport,
      patchCollectReport,
      patchApplyReport: null,
    };
  }

  const patchedRowsFile = path.join(
    authoringDir,
    `${type === "flow" ? "flows" : "processes"}.patched.jsonl`,
  );
  const patchApplyDir = path.join(authoringDir, "patch-apply");
  const patchApply = await runArgvStage({
    stage: `${stagePrefix}.patch_apply`,
    argv: [
      process.execPath,
      "scripts/foundry.mjs",
      "dataset-patch-apply",
      "--input",
      repoRelative(identityOutputRows),
      "--patch",
      repoRelative(
        patchCollect.json?.files?.batch_patch || path.join(authoringDir, "ai-patches.batch.json"),
      ),
      "--out",
      repoRelative(patchedRowsFile),
      "--out-dir",
      repoRelative(patchApplyDir),
      "--authoring-package-dir",
      repoRelative(path.join(authoringDir, "authoring-package-snapshots")),
      "--require-authoring-package",
      "--require-action-item-closure",
    ],
    logDir,
    reportPath: path.join(patchApplyDir, "outputs", "dataset-patch-apply-report.json"),
  });
  stages.push(patchApply);
  const patchApplyReport = reportFile(
    patchApply.json,
    path.join(patchApplyDir, "outputs", "dataset-patch-apply-report.json"),
  );
  if (!statusIs(patchApply.json, ["completed"])) {
    return {
      status: "blocked",
      blocker: firstBlocker(
        patchApply.json,
        `${type}_patch_apply_not_completed`,
        `${type} patch apply did not complete.`,
      ),
      report: patchApplyReport,
    };
  }
  return {
    status: "completed",
    rowsFile: resolveRepoPath(patchApply.json?.files?.patched_rows) || patchedRowsFile,
    identityApplyReport,
    patchCollectReport,
    patchApplyReport,
  };
}

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
}) {
  const supportPlan = resolveRepoPath(
    finalizeReport?.files?.source_contact_support_commit_handoff_plan,
  );
  if (!fileExists(supportPlan)) return finalizeReport;
  const handoffPlan = readJson(supportPlan);
  const supportIdentityKeys = supportIdentityKeysFromHandoffPlan(handoffPlan);
  const previousSupportCommit = supportCommitQueue;
  let releaseSupportCommit;
  supportCommitQueue = new Promise((resolve) => {
    releaseSupportCommit = resolve;
  });
  await previousSupportCommit;
  let supportResult;
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
      const staleKeys = staleReusedSupportIdentityKeys(rerun.json, supportIdentityKeys);
      if (staleKeys.length === 0) return rerun.json;
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
      handoffPlanPath: supportPlan,
      ledgerDir,
      outDir: path.join(scopeDir, `${type}-source-contact-support-handoff`),
      logDir,
      label: `${type}.support`,
    });
  } finally {
    releaseSupportCommit();
  }
  stages.push(...supportResult.stages);
  if (supportResult.status !== "completed") {
    return {
      ...finalizeReport,
      status: "blocked",
      blockers: [...(supportResult.blockers ?? []), ...(finalizeReport.blockers ?? [])],
    };
  }
  for (const identityKey of supportIdentityKeys) verifiedSupportIdentities.add(identityKey);
  appendSupportIdentityCacheRows({
    cacheFile: supportIdentityCacheFile,
    identityKeys: supportIdentityKeys,
    source: `${type}.support_handoff`,
    report: supportResult.closeoutReportPath,
  });
  const rerun = await runFinalizeStage({
    stage: `${type}.finalize_after_support`,
    args: finalizeArgs,
    reportPath: finalizeReportPath,
    logDir,
  });
  stages.push(rerun);
  return rerun.json;
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
}) {
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
      finalizeReport = finalize.json;
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
      finalizeReport: finalize.json,
      finalizeReportPath,
      finalizeArgs,
      ledgerDir,
      scopeDir,
      logDir,
      stages,
      supportIdentityCacheFile,
    });
    if (finalizeReport?.status === "ready_for_remote_write") break;
    const gateReport = resolveRepoPath(finalizeReport?.files?.curation_gate_report);
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
  const handoffPlan = resolveRepoPath(finalizeReport?.files?.commit_handoff_plan);
  const handoff = await executeHandoff({
    handoffPlanPath: handoffPlan,
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
function keepScratchRequested(options) {
  return booleanOption(options?.keepScratch) || process.env.BAFU_KEEP_SCOPE_SCRATCH === "1";
}
function trimVerifiedScopeScratch(scopeDir, options) {
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
  runDir,
  options,
  maxEntries = SHARED_CONTEXT_CACHE_MAX_ENTRIES,
) {
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

async function runOneScope({
  scope,
  familySignature,
  options,
  paths,
  schemas,
  verifiedScopes,
  verifiedFlows,
  verifiedFlowRowsByKey,
  blockedScopes,
}) {
  const processId = scope.process_id || scope.id;
  const processVersion = scope.process_version || scope.version || "00.00.001";
  const scopeDir = path.join(paths.outDir, "scopes", processId);
  const logDir = path.join(scopeDir, "logs");
  const ledgerDir = path.join(scopeDir, "import-ledger");
  const stages = [];
  const checkpointBase = {
    schema_version: 1,
    generated_at_utc: nowIso(),
    process_id: processId,
    process_version: processVersion,
    scope_lock: `process:${processId}:${processVersion}`,
    ...bafuFamilyPlanFields(familySignature),
  };
  const rerunCommand = commandString([
    process.execPath,
    "scripts/foundry.mjs",
    commandName,
    "--scope-file",
    repoRelative(paths.scopeFile),
    "--process-bundles-dir",
    repoRelative(paths.processBundlesDir),
    "--run-dir",
    repoRelative(paths.runDir),
    "--out-dir",
    repoRelative(paths.outDir),
    "--process-id",
    processId,
    "--commit",
    "--parallel",
    "1",
  ]);

  fs.mkdirSync(scopeDir, { recursive: true });
  if (verifiedScopes.has(`${processId}@${processVersion}`) && !booleanOption(options.force)) {
    const checkpoint = { ...checkpointBase, state: "skipped_already_verified" };
    appendJsonLine(paths.scopeCheckpoints, checkpoint);
    return { status: "skipped", checkpoint, stages };
  }
  const explicitProcessIds = new Set(requestedProcessIdValues(options));
  if (
    blockedScopes?.has(`${processId}@${processVersion}`) &&
    !booleanOption(options.force) &&
    !explicitProcessIds.has(processId)
  ) {
    const checkpoint = { ...checkpointBase, state: "skipped_blocked_deferred" };
    appendJsonLine(paths.scopeCheckpoints, checkpoint);
    return { status: "skipped_blocked", checkpoint, stages };
  }

  appendJsonLine(paths.scopeCheckpoints, { ...checkpointBase, state: "started" });

  const block = ({ stage, blocker, report }) => {
    const row = blockRow({ scope, stage, blocker, report, rerunCommand });
    appendJsonLine(paths.blockedHumanReview, row);
    appendJsonLine(
      paths[`blocked_${categoryForBlocker(row.code).replace(/-/gu, "_")}`] || paths.blockedOther,
      row,
    );
    appendJsonLine(paths.scopeCheckpoints, {
      ...checkpointBase,
      state: "blocked_deferred",
      stage,
      code: row.code,
    });
    return {
      status: "blocked",
      checkpoint: { ...checkpointBase, state: "blocked_deferred" },
      block: row,
      stages,
    };
  };

  const fail = ({ stage, blocker, report }) => {
    const row = blockRow({ scope, stage, blocker, report, rerunCommand });
    appendJsonLine(paths.failedRetry, row);
    appendJsonLine(paths.blocked_remote_write, row);
    appendJsonLine(paths.scopeCheckpoints, {
      ...checkpointBase,
      state: "failed_retryable",
      stage,
      code: row.code,
    });
    return {
      status: "failed",
      checkpoint: { ...checkpointBase, state: "failed_retryable" },
      block: row,
      stages,
    };
  };

  const defer = ({ stage, blocker, report }) => {
    const retryable = retryableStageFailure({ stage, blocker, report });
    if (!retryable) return block({ stage, blocker, report });
    return fail({
      stage,
      blocker: {
        ...blocker,
        retryable: true,
        retryable_reason_code: retryable.code,
        retryable_reason: retryable.message,
        required_human_action:
          "Do not manually curate this scope for the recorded stage failure. Restore CLI/npm/network availability or wait for remote consistency, then rerun the exact scope command.",
      },
      report,
    });
  };

  const materializedDir = path.join(scopeDir, "materialized");
  const materialize = await runArgvStage({
    stage: "materialize",
    argv: foundryCommand("dataset-bundle-sample-rows", {
      bundlesDir: repoRelative(paths.processBundlesDir),
      processId,
      outDir: repoRelative(materializedDir),
      profile: activeProfile(),
      // Non-BAFU profiles must not inherit the BAFU FOEN library contact; the
      // profile config supplies the dataset-appropriate library contact (e.g. NREL
      // for USLCI). BAFU passes nothing here, keeping its FOEN default unchanged.
      ...(bafuBatchConfig.libraryContact || {}),
    }),
    logDir,
    reportPath: path.join(materializedDir, "dataset-bundle-sample-rows-report.json"),
  });
  stages.push(materialize);
  const materializedReport = materialize.json;
  const fatalMaterializeBlocker = (materializedReport?.blockers ?? []).find((blocker) =>
    [
      "requested_process_bundle_missing",
      "bundle_row_identity_missing",
      "process_scope_dependency_unresolved",
    ].includes(String(blocker?.code || "")),
  );
  if (!materializedReport || fatalMaterializeBlocker) {
    return defer({
      stage: "materialize",
      blocker:
        fatalMaterializeBlocker ??
        firstBlocker(materializedReport, "materialize_not_ready", "Bundle materialization failed."),
      report: path.join(materializedDir, "dataset-bundle-sample-rows-report.json"),
    });
  }
  const materialized = {
    flowRowsFile: resolveRepoPath(materializedReport.files?.rows?.flow),
    processRowsFile: resolveRepoPath(materializedReport.files?.rows?.process),
    sourceRowsFile: resolveRepoPath(materializedReport.files?.rows?.source),
    supportRowsFile: resolveRepoPath(materializedReport.files?.rows?.support),
    flowpropertyRowsFile: resolveRepoPath(materializedReport.files?.rows?.flowproperty),
    unitgroupRowsFile: resolveRepoPath(materializedReport.files?.rows?.unitgroup),
    classificationQueue: resolveRepoPath(materializedReport.files?.classification_authoring_queue),
    locationQueue: resolveRepoPath(materializedReport.files?.location_authoring_queue),
    identityPreflightIndex: resolveRepoPath(materializedReport.files?.identity_preflight_requests),
  };
  if (!fileExists(materialized.processRowsFile)) {
    return defer({
      stage: "materialize",
      blocker: {
        code: "materialized_process_rows_missing",
        message: "Materialized process rows are missing.",
      },
      report: path.join(materializedDir, "dataset-bundle-sample-rows-report.json"),
    });
  }

  const classificationTaskDir = path.join(scopeDir, "classification-task");
  const processContext = defaultContext(paths.runDir, "process");
  const classificationTask = await runArgvStage({
    stage: "classification.task",
    argv: [
      process.execPath,
      "scripts/foundry.mjs",
      "dataset-classification-decision-task-build",
      "--classification-queue",
      repoRelative(materialized.classificationQueue),
      "--schema-file",
      repoRelative(processContext.schemaFile),
      "--yaml-file",
      repoRelative(processContext.yamlFile),
      "--ruleset-file",
      repoRelative(processContext.rulesetFile),
      "--classification-schema",
      schemas.allClassification.map(repoRelative).join(","),
      "--location-schema",
      repoRelative(schemas.location),
      "--out-dir",
      repoRelative(classificationTaskDir),
      "--shared-context-cache-dir",
      repoRelative(path.join(paths.runDir, "shared-context-cache")),
    ],
    logDir,
    reportPath: path.join(classificationTaskDir, "classification-decision-task-report.json"),
  });
  stages.push(classificationTask);
  if (
    !statusIs(classificationTask.json, [
      "ready_for_ai_classification_decisions",
      "ready_no_classification_actions",
    ])
  ) {
    return defer({
      stage: "classification.task",
      blocker: firstBlocker(
        classificationTask.json,
        "classification_task_not_ready",
        "Classification decision task did not become ready.",
      ),
      report: path.join(classificationTaskDir, "classification-decision-task-report.json"),
    });
  }

  let classificationApplyReport = null;
  let flowClassifiedRows = materialized.flowRowsFile;
  let processClassifiedRows = materialized.processRowsFile;
  if (statusIs(classificationTask.json, ["ready_for_ai_classification_decisions"])) {
    const classificationProjectionDir = path.join(scopeDir, "classification-projection");
    const classificationProjection = await runArgvStage({
      stage: "classification.project",
      argv: foundryCommand("dataset-library-classification-decisions-project", {
        classificationQueue: repoRelative(materialized.classificationQueue),
        libraryDecisions: repoRelative(paths.libraryClassificationDecisions),
        decisionTask: repoRelative(
          path.join(classificationTaskDir, "classification-decision-task.json"),
        ),
        outDir: repoRelative(classificationProjectionDir),
      }),
      logDir,
      reportPath: path.join(
        classificationProjectionDir,
        "dataset-library-classification-decisions-project-report.json",
      ),
    });
    stages.push(classificationProjection);
    if (!statusIs(classificationProjection.json, ["completed", "completed_with_manual_review"])) {
      return defer({
        stage: "classification.project",
        blocker: firstBlocker(
          classificationProjection.json,
          "classification_projection_not_completed",
          "Library classification decisions could not be projected to this scope.",
        ),
        report: path.join(
          classificationProjectionDir,
          "dataset-library-classification-decisions-project-report.json",
        ),
      });
    }
    const schemaRepair = repairClassificationDecisionCodes({
      decisionsFile: path.join(classificationProjectionDir, "classification-decisions.jsonl"),
      schemas,
      outDir: classificationProjectionDir,
    });
    if (schemaRepair.unresolved.length > 0) {
      return defer({
        stage: "classification.schema_repair",
        blocker: {
          code: "classification_decision_code_invalid",
          message:
            "Projected classification decisions contain codes that are not valid in the bundled TIDAS category schema.",
          manual_review_rows: repoRelative(schemaRepair.unresolvedPath),
        },
        report: path.join(
          classificationProjectionDir,
          "dataset-library-classification-decisions-project-report.json",
        ),
      });
    }
    const manualRows = path.join(
      classificationProjectionDir,
      "classification-decisions.manual-review.jsonl",
    );
    if (readJsonLines(manualRows).length > 0) {
      return defer({
        stage: "classification.project",
        blocker: {
          code: "classification_requires_human_review",
          message:
            "This scope still has classification decisions without a completed library-level decision.",
          manual_review_rows: repoRelative(manualRows),
        },
        report: path.join(
          classificationProjectionDir,
          "dataset-library-classification-decisions-project-report.json",
        ),
      });
    }
    const classificationApplyDir = path.join(scopeDir, "classification-apply");
    const classificationApply = await runArgvStage({
      stage: "classification.apply",
      argv: foundryCommand("dataset-classification-decisions-apply", {
        classificationQueue: repoRelative(materialized.classificationQueue),
        decisions: repoRelative(
          path.join(classificationProjectionDir, "classification-decisions.jsonl"),
        ),
        decisionTask: repoRelative(
          path.join(classificationTaskDir, "classification-decision-task.json"),
        ),
        outDir: repoRelative(classificationApplyDir),
      }),
      logDir,
      reportPath: path.join(classificationApplyDir, "classification-decisions-apply-report.json"),
    });
    stages.push(classificationApply);
    classificationApplyReport = reportFile(
      classificationApply.json,
      path.join(classificationApplyDir, "classification-decisions-apply-report.json"),
    );
    if (!statusIs(classificationApply.json, ["completed"])) {
      return defer({
        stage: "classification.apply",
        blocker: firstBlocker(
          classificationApply.json,
          "classification_apply_not_completed",
          "Classification decisions did not apply cleanly.",
        ),
        report: classificationApplyReport,
      });
    }
    flowClassifiedRows = outputRowsByStem(classificationApply.json, "flows.") || flowClassifiedRows;
    processClassifiedRows =
      outputRowsByStem(classificationApply.json, "processes.") || processClassifiedRows;
  }

  let flowRowsForFinalize = flowClassifiedRows;
  let locationApplyReport = null;
  if (
    fileExists(materialized.locationQueue) &&
    readJsonLines(materialized.locationQueue).length > 0 &&
    fileExists(flowClassifiedRows)
  ) {
    const locationTaskDir = path.join(scopeDir, "location-task");
    const flowContext = defaultContext(paths.runDir, "flow");
    const locationTask = await runArgvStage({
      stage: "location.task",
      argv: [
        process.execPath,
        "scripts/foundry.mjs",
        "dataset-location-decision-task-build",
        "--location-queue",
        repoRelative(materialized.locationQueue),
        "--rows-file",
        repoRelative(flowClassifiedRows),
        "--schema-file",
        repoRelative(flowContext.schemaFile),
        "--yaml-file",
        repoRelative(flowContext.yamlFile),
        "--ruleset-file",
        repoRelative(flowContext.rulesetFile),
        "--classification-schema",
        repoRelative(schemas.flowProductCategory),
        "--location-schema",
        repoRelative(schemas.location),
        "--out-dir",
        repoRelative(locationTaskDir),
        "--shared-context-cache-dir",
        repoRelative(path.join(paths.runDir, "shared-context-cache")),
      ],
      logDir,
      reportPath: path.join(locationTaskDir, "location-decision-task-report.json"),
    });
    stages.push(locationTask);
    if (
      !statusIs(locationTask.json, ["ready_for_ai_location_decisions", "ready_no_location_actions"])
    ) {
      return defer({
        stage: "location.task",
        blocker: firstBlocker(
          locationTask.json,
          "location_task_not_ready",
          "Location task did not become ready.",
        ),
        report: path.join(locationTaskDir, "location-decision-task-report.json"),
      });
    }
    if (statusIs(locationTask.json, ["ready_for_ai_location_decisions"])) {
      const locationDecisionDir = path.join(scopeDir, "location-decisions");
      const locationSuggest = await runArgvStage({
        stage: "location.suggest",
        argv: foundryCommand("dataset-location-decisions-suggest", {
          locationQueue: repoRelative(
            findOneFile(locationTaskDir, /^location-authoring-queue\..*\.jsonl$/u) ||
              materialized.locationQueue,
          ),
          decisionTask: repoRelative(path.join(locationTaskDir, "location-decision-task.json")),
          locationSchema: repoRelative(schemas.location),
          outDir: repoRelative(locationDecisionDir),
        }),
        logDir,
        reportPath: path.join(
          locationDecisionDir,
          "dataset-location-decisions-suggest-report.json",
        ),
      });
      stages.push(locationSuggest);
      if (!statusIs(locationSuggest.json, ["completed", "completed_with_manual_review"])) {
        return defer({
          stage: "location.suggest",
          blocker: firstBlocker(
            locationSuggest.json,
            "location_suggest_not_completed",
            "Location decisions could not be suggested.",
          ),
          report: path.join(locationDecisionDir, "dataset-location-decisions-suggest-report.json"),
        });
      }
      const manualRows = path.join(locationDecisionDir, "location-decisions.manual-review.jsonl");
      if (readJsonLines(manualRows).length > 0) {
        return defer({
          stage: "location.suggest",
          blocker: {
            code: "location_requires_human_review",
            message:
              "This scope still has location decisions without one provable TIDAS location code.",
            manual_review_rows: repoRelative(manualRows),
          },
          report: path.join(locationDecisionDir, "dataset-location-decisions-suggest-report.json"),
        });
      }
      const taskQueue =
        findOneFile(locationTaskDir, /^location-authoring-queue\..*\.jsonl$/u) ||
        materialized.locationQueue;
      const locationApplyDir = path.join(scopeDir, "location-apply");
      const locationApply = await runArgvStage({
        stage: "location.apply",
        argv: foundryCommand("dataset-location-decisions-apply", {
          locationQueue: repoRelative(taskQueue),
          decisions: repoRelative(path.join(locationDecisionDir, "location-decisions.jsonl")),
          decisionTask: repoRelative(path.join(locationTaskDir, "location-decision-task.json")),
          outDir: repoRelative(locationApplyDir),
        }),
        logDir,
        reportPath: path.join(locationApplyDir, "location-decisions-apply-report.json"),
      });
      stages.push(locationApply);
      locationApplyReport = reportFile(
        locationApply.json,
        path.join(locationApplyDir, "location-decisions-apply-report.json"),
      );
      if (!statusIs(locationApply.json, ["completed"])) {
        return defer({
          stage: "location.apply",
          blocker: firstBlocker(
            locationApply.json,
            "location_apply_not_completed",
            "Location decisions did not apply cleanly.",
          ),
          report: locationApplyReport,
        });
      }
      flowRowsForFinalize = outputRowsByStem(locationApply.json, "flows.") || flowRowsForFinalize;
    }
  }

  const flowRows = readRows(flowRowsForFinalize);
  const flowIds = flowRows
    .map((row) => datasetIdentity(row, "flow"))
    .filter((identity) => identity.id);
  const flowVerificationPlan = flowRowsPendingVerification(flowRows, verifiedFlows);
  const unverifiedFlowIds = flowVerificationPlan.pendingIdentities;
  const carriedForwardFlows = writeScopeCarriedForwardVerifiedFlowRows({
    ledgerDir,
    processId,
    verifiedIdentities: flowVerificationPlan.verifiedIdentities,
    verifiedFlowRowsByKey,
  });
  if (carriedForwardFlows.count > 0) {
    stages.push({
      stage: "flow.carry_forward_verified",
      status: "completed",
      exit_code: 0,
      report: null,
      counts: {
        carried_forward_verified_flows: carriedForwardFlows.count,
      },
      carried_forward_verified_identities: carriedForwardFlows.rows,
      ledger: repoRelative(carriedForwardFlows.ledger),
    });
  }
  if (
    flowRows.length > 0 &&
    flowVerificationPlan.pendingRows.length > 0 &&
    flowVerificationPlan.pendingRows.length < flowRows.length
  ) {
    const flowFilterDir = path.join(scopeDir, "flow-filter-verified");
    const pendingRowsFile = path.join(flowFilterDir, "flows.unverified.jsonl");
    const filterReportPath = path.join(flowFilterDir, "flow-filter-verified-report.json");
    writeJsonLines(pendingRowsFile, flowVerificationPlan.pendingRows);
    writeJson(filterReportPath, {
      schema_version: 1,
      generated_at_utc: nowIso(),
      status: "completed",
      input_rows_file: repoRelative(flowRowsForFinalize),
      output_rows_file: repoRelative(pendingRowsFile),
      policy:
        "Only flow rows not present in ok.flows.verified are passed to flow finalize/commit. Already verified flows remain remote dependencies for the process scope.",
      counts: {
        input_rows: flowRows.length,
        output_rows: flowVerificationPlan.pendingRows.length,
        skipped_verified_rows: flowVerificationPlan.verifiedRows.length,
      },
      pending_identities: flowVerificationPlan.pendingIdentities,
      skipped_verified_identities: flowVerificationPlan.verifiedIdentities,
      files: {
        input_rows: repoRelative(flowRowsForFinalize),
        output_rows: repoRelative(pendingRowsFile),
        report: repoRelative(filterReportPath),
      },
    });
    stages.push({
      stage: "flow.filter_verified",
      status: "completed",
      exit_code: 0,
      report: repoRelative(filterReportPath),
      counts: {
        input_rows: flowRows.length,
        output_rows: flowVerificationPlan.pendingRows.length,
        skipped_verified_rows: flowVerificationPlan.verifiedRows.length,
      },
    });
    flowRowsForFinalize = pendingRowsFile;
  }
  let flowIdentityReport = null;
  let flowIdentityReportsForProcess = existingIdentityApplyReportsWithReferenceRewrites(
    scopeDir,
    "flow",
  );
  if (flowRows.length > 0 && unverifiedFlowIds.length > 0) {
    const flowPreDir = path.join(scopeDir, "flow-pre-finalize");
    const flowPreReportPath = path.join(flowPreDir, "dataset-post-authoring-finalize-report.json");
    const flowPreArgs = buildFinalizeArgs({
      type: "flow",
      rowsFile: flowRowsForFinalize,
      outDir: flowPreDir,
      ledgerDir,
      sourceSupportRowsFile: materialized.supportRowsFile,
      sourceRowsFile: materialized.sourceRowsFile,
      flowpropertyRowsFile: materialized.flowpropertyRowsFile,
      unitgroupRowsFile: materialized.unitgroupRowsFile,
      identityPreflightIndex: materialized.identityPreflightIndex,
      context: defaultContext(paths.runDir, "flow"),
      classificationQueue: materialized.classificationQueue,
      locationQueue: materialized.locationQueue,
      classificationApplyReport,
      locationApplyReport,
      identityApplyReports: [],
      targetUserId: options.targetUserId,
      stateCode: options.stateCode,
    });
    const flowPre = await runFinalizeStage({
      stage: "flow.pre_finalize",
      args: flowPreArgs,
      reportPath: flowPreReportPath,
      logDir,
    });
    stages.push(flowPre);
    if (flowPre.finalize_report_missing) {
      return fail({
        stage: "flow.pre_finalize",
        blocker: firstBlocker(
          flowPre.json,
          "finalize_report_missing",
          "Flow pre-finalize did not write the expected report.",
        ),
        report: flowPreReportPath,
      });
    }
    // For a never-before-imported library, the dependency-flow references the
    // shared library contact (ownership/data-entry) which is not yet remote and
    // is not in the flow's own write scope, so pre-finalize blocks on reference
    // closure. Commit the flow's source/contact support inline here (mirroring the
    // process path) so the library contact lands remotely and the re-finalized
    // flow proves closure. Gated off for BAFU (its FOEN contact already exists).
    if (commitFlowSupportInline()) {
      flowPre.json = await maybeCommitSupportThenRerunFinalize({
        type: "flow",
        finalizeReport: flowPre.json,
        finalizeReportPath: flowPreReportPath,
        finalizeArgs: flowPreArgs,
        ledgerDir,
        scopeDir,
        logDir,
        stages,
        supportIdentityCacheFile: paths.supportIdentityCache,
      });
    }
    let flowReadyRows = resolveRepoPath(flowPre.json?.files?.final_rows) || flowRowsForFinalize;
    let flowPatchCollectReport = null;
    let flowPatchApplyReport = null;
    // FIX A (apply-gate): in deterministic resolution-rewrite mode the flow identity
    // apply MUST run even when pre-finalize reports ready_for_remote_write. A "ready"
    // status there means the source elementary flows would be MINTED as account-local
    // as-is — but the library resolution already proved they reuse canonical. Forcing
    // runIdentityAndPatch applies those reuses (rewrites references to canonical and
    // drops reused flows from the write set) instead of wrongly minting them. Without
    // this, scopes whose per-scope preflight surfaced no candidates skip identity
    // entirely and over-mint (e.g. 00e711cb: 27/27 reuse-eligible minted). Gated on the
    // mode + the presence of proven rewrites for THIS process, so BAFU is unaffected.
    const deterministicFlowReuse =
      Boolean(paths.applyResolutionRewritesMode) &&
      (paths.resolutionRewritesByProcess?.get(processId)?.length || 0) > 0;
    if (flowPre.json?.status !== "ready_for_remote_write" || deterministicFlowReuse) {
      const flowAuthoring = await runIdentityAndPatch({
        type: "flow",
        inputRowsFile: flowReadyRows,
        preFinalizeReport: flowPre.json,
        scopeDir,
        runDir: paths.runDir,
        logDir,
        stages,
        // FIX A: deterministic identity application from the authoritative
        // library-resolution rewrites for THIS process (flow-only; process has no
        // flow reuse). undefined rewrite rows -> mode no-ops, falling back to the
        // unchanged carry-forward path.
        resolutionRewriteRows: paths.resolutionRewritesByProcess?.get(processId),
        applyResolutionRewritesMode: Boolean(paths.applyResolutionRewritesMode),
      });
      if (flowAuthoring.status !== "completed") {
        return defer({
          stage: "flow.authoring",
          blocker: flowAuthoring.blocker,
          report: flowAuthoring.report,
        });
      }
      flowReadyRows = flowAuthoring.rowsFile;
      flowIdentityReport = flowAuthoring.identityApplyReport;
      flowIdentityReportsForProcess = uniqueExistingPaths([
        ...flowIdentityReportsForProcess,
        flowIdentityReport,
      ]);
      flowPatchCollectReport = flowAuthoring.patchCollectReport;
      flowPatchApplyReport = flowAuthoring.patchApplyReport;
      const recoveryBlocker = preFinalizeRecoveryBlocker({
        type: "flow",
        finalizeReport: flowPre.json,
        recovery: flowAuthoring,
      });
      if (recoveryBlocker) {
        return defer({
          stage: "flow.finalize",
          blocker: recoveryBlocker,
          report: flowPreReportPath,
        });
      }
    }
    const flowReadyRowCount = readRows(flowReadyRows).length;
    if (flowReadyRowCount === 0) {
      stages.push({
        stage: "flow.finalize",
        status: "skipped_no_write_rows_after_identity_reuse",
        exit_code: 0,
        rows_file: repoRelative(flowReadyRows),
        identity_decision_apply_report: flowIdentityReport
          ? repoRelative(flowIdentityReport)
          : null,
      });
    } else {
      const flowCommit = await finalizeAndCommitDataset({
        type: "flow",
        rowsFile: flowReadyRows,
        scopeDir,
        runDir: paths.runDir,
        materialized,
        classificationApplyReport,
        locationApplyReport,
        identityApplyReports: flowIdentityReport ? [flowIdentityReport] : [],
        patchCollectReport: flowPatchCollectReport,
        patchApplyReport: flowPatchApplyReport,
        targetUserId: options.targetUserId,
        stateCode: options.stateCode,
        logDir,
        ledgerDir,
        stages,
        supportIdentityCacheFile: paths.supportIdentityCache,
      });
      if (flowCommit.status === "failed") {
        return fail({
          stage: "flow.commit",
          blocker: flowCommit.blocker,
          report: flowCommit.report,
        });
      }
      if (flowCommit.status !== "completed") {
        if (categoryForBlocker(flowCommit.blocker?.code) === "remote-write") {
          return fail({
            stage: "flow.finalize",
            blocker: flowCommit.blocker,
            report: flowCommit.report,
          });
        }
        return defer({
          stage: "flow.finalize",
          blocker: flowCommit.blocker,
          report: flowCommit.report,
        });
      }
      const committedFlowRows =
        readRows(resolveRepoPath(flowCommit.finalizeReport?.files?.final_rows)).length > 0
          ? readRows(resolveRepoPath(flowCommit.finalizeReport?.files?.final_rows))
          : readRows(flowReadyRows);
      for (const identity of committedFlowRows
        .map((row) => datasetIdentity(row, "flow"))
        .filter((entry) => entry.id)) {
        const identityKey = datasetIdentityKey(identity);
        const alreadyVerified = verifiedFlows.has(identityKey);
        verifiedFlows.add(identityKey);
        invalidateIdentityPreflightResultCacheEntry(
          `flow:${identity.id}@${identity.version || "00.00.001"}`,
        );
        const okFlowRow = okDatasetRow({
          type: "flow",
          id: identity.id,
          version: identity.version,
          processId,
          report: flowCommit.report,
          files: {
            finalize_report: repoRelative(flowCommit.report),
            closeout_report: repoRelative(flowCommit.handoff?.closeoutReportPath),
          },
        });
        verifiedFlowRowsByKey?.set(identityKey, {
          ...okFlowRow,
          source_ledger_file: repoRelative(paths.okFlows),
        });
        if (alreadyVerified) continue;
        appendJsonLine(paths.okFlows, okFlowRow);
      }
    }
  }

  const processPreDir = path.join(scopeDir, "process-pre-finalize");
  const processPreReportPath = path.join(
    processPreDir,
    "dataset-post-authoring-finalize-report.json",
  );
  const processPreArgs = buildFinalizeArgs({
    type: "process",
    rowsFile: processClassifiedRows,
    outDir: processPreDir,
    ledgerDir,
    sourceSupportRowsFile: materialized.supportRowsFile,
    sourceRowsFile: materialized.sourceRowsFile,
    flowpropertyRowsFile: materialized.flowpropertyRowsFile,
    unitgroupRowsFile: materialized.unitgroupRowsFile,
    identityPreflightIndex: materialized.identityPreflightIndex,
    context: defaultContext(paths.runDir, "process"),
    classificationQueue: materialized.classificationQueue,
    locationQueue: materialized.locationQueue,
    classificationApplyReport,
    locationApplyReport,
    identityApplyReports: flowIdentityReportsForProcess,
    targetUserId: options.targetUserId,
    stateCode: options.stateCode,
  });
  const processPre = await runFinalizeStage({
    stage: "process.pre_finalize",
    args: processPreArgs,
    reportPath: processPreReportPath,
    logDir,
  });
  stages.push(processPre);
  if (processPre.finalize_report_missing) {
    return fail({
      stage: "process.pre_finalize",
      blocker: firstBlocker(
        processPre.json,
        "finalize_report_missing",
        "Process pre-finalize did not write the expected report.",
      ),
      report: processPreReportPath,
    });
  }
  const processPreReport = await maybeCommitSupportThenRerunFinalize({
    type: "process",
    finalizeReport: processPre.json,
    finalizeReportPath: processPreReportPath,
    finalizeArgs: processPreArgs,
    ledgerDir,
    scopeDir,
    logDir,
    stages,
    supportIdentityCacheFile: paths.supportIdentityCache,
  });
  let processRowsForE2e =
    resolveRepoPath(processPreReport?.files?.final_rows) || processClassifiedRows;
  let processIdentityReport = null;
  let processPatchCollectReport = null;
  let processPatchApplyReport = null;
  if (processPreReport?.status !== "ready_for_remote_write") {
    const processAuthoring = await runIdentityAndPatch({
      type: "process",
      inputRowsFile: processRowsForE2e,
      preFinalizeReport: processPreReport,
      scopeDir,
      runDir: paths.runDir,
      logDir,
      stages,
    });
    if (processAuthoring.status !== "completed") {
      return defer({
        stage: "process.authoring",
        blocker: processAuthoring.blocker,
        report: processAuthoring.report,
      });
    }
    processRowsForE2e = processAuthoring.rowsFile;
    processIdentityReport = processAuthoring.identityApplyReport;
    processPatchCollectReport = processAuthoring.patchCollectReport;
    processPatchApplyReport = processAuthoring.patchApplyReport;
    const recoveryBlocker = preFinalizeRecoveryBlocker({
      type: "process",
      finalizeReport: processPreReport,
      recovery: processAuthoring,
    });
    if (recoveryBlocker) {
      return defer({
        stage: "process.finalize",
        blocker: recoveryBlocker,
        report: processPreReportPath,
      });
    }
  }

  let processScopeReport = processPreReportPath;
  let processCloseoutReport = null;
  if (processPreReport?.status === "ready_for_remote_write" && !processPatchApplyReport) {
    const handoffPlan = resolveRepoPath(processPreReport.files?.commit_handoff_plan);
    const handoff = await executeHandoff({
      handoffPlanPath: handoffPlan,
      ledgerDir,
      outDir: path.join(scopeDir, "process-handoff"),
      logDir,
      label: "process",
    });
    stages.push(...handoff.stages);
    if (handoff.status !== "completed") {
      const blocker = handoff.blockers?.[0] ?? {
        code: "process_handoff_failed",
        message: "Process commit/verify handoff failed.",
      };
      return fail({ stage: "process.commit", blocker, report: processPreReportPath });
    }
    processCloseoutReport = handoff.closeoutReportPath;
  } else {
    const processCommit = await finalizeAndCommitDataset({
      type: "process",
      rowsFile: processRowsForE2e,
      scopeDir,
      runDir: paths.runDir,
      materialized,
      classificationApplyReport,
      locationApplyReport,
      identityApplyReports: [...flowIdentityReportsForProcess, processIdentityReport].filter(
        Boolean,
      ),
      patchCollectReport: processPatchCollectReport,
      patchApplyReport: processPatchApplyReport,
      targetUserId: options.targetUserId,
      stateCode: options.stateCode,
      logDir,
      ledgerDir,
      stages,
      supportIdentityCacheFile: paths.supportIdentityCache,
    });
    if (processCommit.status === "failed") {
      return fail({
        stage: "process.commit",
        blocker: processCommit.blocker,
        report: processCommit.report,
      });
    }
    if (processCommit.status !== "completed") {
      if (categoryForBlocker(processCommit.blocker?.code) === "remote-write") {
        return fail({
          stage: "process.finalize",
          blocker: processCommit.blocker,
          report: processCommit.report,
        });
      }
      return defer({
        stage: "process.finalize",
        blocker: processCommit.blocker,
        report: processCommit.report,
      });
    }
    processScopeReport = processCommit.report;
    processCloseoutReport = processCommit.handoff?.closeoutReportPath ?? null;
  }

  verifiedScopes.add(`${processId}@${processVersion}`);
  appendJsonLine(
    paths.okProcesses,
    okDatasetRow({
      type: "process",
      id: processId,
      version: processVersion,
      processId,
      report: processScopeReport,
      files: {
        process_finalize_report: repoRelative(processScopeReport),
        process_closeout_report: repoRelative(processCloseoutReport),
      },
    }),
  );
  appendJsonLine(paths.okScopes, {
    schema_version: 1,
    generated_at_utc: nowIso(),
    process_id: processId,
    process_version: processVersion,
    status: "verified",
    report: repoRelative(processScopeReport),
    rows: {
      flows: flowIds.length,
      processes: 1,
    },
  });
  appendJsonLine(paths.scopeCheckpoints, {
    ...checkpointBase,
    state: "verified",
    stages: stages.map((stage) => ({
      stage: stage.stage,
      exit_code: stage.exit_code,
      report: stage.report,
      stdout_log: stage.stdout_log,
      stderr_log: stage.stderr_log,
    })),
  });
  writeJson(path.join(scopeDir, "scope-run-report.json"), {
    schema_version: 1,
    generated_at_utc: nowIso(),
    status: "verified",
    process_id: processId,
    process_version: processVersion,
    bafu_family_signature: compactBafuFamilySignature(familySignature, repoRelative),
    stages,
    files: {
      process_finalize_report: repoRelative(processScopeReport),
      process_closeout_report: repoRelative(processCloseoutReport),
    },
  });
  trimVerifiedScopeScratch(scopeDir, options);
  return { status: "verified", stages };
}

export function createBafuBatchImportRunCommands(deps, config = {}) {
  installBafuBatchRuntime(deps, config);
  async function runDatasetBafuBatchImportRun(options = {}) {
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
          "node scripts/foundry.mjs dataset-bafu-batch-import-run --scope-file <ready-scopes.jsonl> --process-bundles-dir <.../process-bundles> --run-dir <run-dir> --out-dir <run-dir>/batch-import --parallel 5 --commit",
          "node scripts/foundry.mjs dataset-bafu-batch-import-run --scope-file <ready-scopes.jsonl> --out-dir <existing-batch-dir> --pending-only --selection-order estimated-weight-asc --limit 20 --pause-file <pause.flag> --commit",
          "node scripts/foundry.mjs dataset-bafu-batch-import-run --scope-file <ready-scopes.jsonl> --pending-only --selection-order family-master-first --preflight-only",
          "node scripts/foundry.mjs dataset-bafu-batch-import-run --scope-file <ready-scopes.jsonl> --pending-only --require-leaf-classification --preflight-only",
          "node scripts/foundry.mjs dataset-bafu-batch-import-run --scope-file <ready-scopes.jsonl> --out-dir <new-batch-dir> --ledger-source-dir <previous-batch-dir> --pending-only --preflight-only",
          "node scripts/foundry.mjs dataset-bafu-batch-import-run --scope-file <ready-scopes.jsonl> --out-dir <existing-batch-dir> --pending-only --selection-order estimated-weight-asc --preflight-only",
          "node scripts/foundry.mjs dataset-bafu-batch-import-run --scope-file <ready-scopes.jsonl> --process-id <uuid> --commit",
          "node scripts/foundry.mjs dataset-bafu-batch-import-run --scope-file <ready-scopes.jsonl> --process-id-file <retry-ids.txt> --commit (one id per line; blank lines and # comments ignored)",
        ],
        purpose:
          "Run BAFU ready process scopes through materialize, semantic decisions, dependency flow commit, support commit, process commit, readback verify, and resumable ledgers.",
        remote_write_mode: "explicit-commit-only",
        ...bafuBatchStageContract,
      };
    }

    const runDir = resolveRepoPath(
      options.runDir || path.dirname(resolveRepoPath(options.scopeFile || "") || repoRoot),
    );
    const scopeFile = resolveRepoPath(
      options.scopeFile ||
        path.join(runDir, "library-resolution-v4-leaf-category-map", "ready-scopes.jsonl"),
    );
    const processBundlesDir = resolveRepoPath(
      options.processBundlesDir ||
        options.bundlesDir ||
        "inputs/BAFU-2025 Version 2 - TIDAS 2026-03-09/process-bundles",
    );
    if (!fileExists(scopeFile)) throw new Error("--scope-file is required.");
    if (!directoryExists(processBundlesDir)) throw new Error("--process-bundles-dir is required.");
    if (!directoryExists(runDir)) throw new Error("--run-dir is required.");
    const outDir = resolveRepoPath(options.outDir || path.join(runDir, "batch-import"));
    const commit = booleanOption(options.commit);
    const preflightOnly = booleanOption(options.preflightOnly || options.planOnly);
    if (!commit && !preflightOnly) {
      throw new Error(
        `${commandName} requires --commit for remote writes, or --preflight-only for a read-only execution plan.`,
      );
    }
    const targetUserId = asText(options.targetUserId);
    if (!preflightOnly && !targetUserId) throw new Error("--target-user-id is required.");
    const stateCode = integerOption(options.stateCode, 0);
    const parallel = Math.max(1, Math.min(20, integerOption(options.parallel, 5)));
    const limit = options.limit == null ? null : Math.max(0, integerOption(options.limit, 0));
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
    // Mega-scope speed-up: when applying the library resolution, also expose its
    // exchange-reference-rewrites to every per-scope finalize as
    // IDENTITY_PREFLIGHT_REUSE_MAP. The finalize stage then PRE-SEEDS a reuse decision
    // for each reuse-proven flow and SKIPS the redundant per-flow REMOTE identity
    // preflight (the dominant cost on worldsteel's ~2,000-2,543-exchange mega-scopes).
    // The finalize subprocess inherits process.env. Respect an operator-set value; no-op
    // for BAFU (applyResolutionRewrites off) and when the rewrites file is absent.
    if (
      applyResolutionRewrites() &&
      libraryResolutionDir &&
      !asText(process.env.IDENTITY_PREFLIGHT_REUSE_MAP)
    ) {
      const reuseMapFile = path.join(libraryResolutionDir, "exchange-reference-rewrites.jsonl");
      if (fs.existsSync(reuseMapFile)) {
        process.env.IDENTITY_PREFLIGHT_REUSE_MAP = reuseMapFile;
      }
    }
    const pauseFile = asText(options.pauseFile) ? resolveRepoPath(options.pauseFile) : null;
    const stopAfterBlocked =
      options.stopAfterBlocked == null
        ? null
        : Math.max(1, integerOption(options.stopAfterBlocked, 1));
    fs.mkdirSync(outDir, { recursive: true });
    const paths = {
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
      ),
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
    const familySignatureIndex = familySignaturesEnabled()
      ? buildBafuFamilySignatureIndex({
          scopes: allScopes,
          processBundlesDir,
          processesDir: directoryExists(processFilesDir) ? processFilesDir : null,
          readJson,
        })
      : { summary: {}, entries: [], byScopeKey: new Map() };
    const classificationDecisionIndex = loadClassificationDecisionIndex(
      paths.libraryClassificationDecisions,
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
      familySignatureIndex,
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
        Object.entries(paths)
          .filter(([, value]) => typeof value === "string")
          .map(([key, value]) => [key, repoRelative(value)]),
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
          familySignatureIndex,
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

    const results = [];
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
    async function worker(workerIndex) {
      while (nextIndex < scopes.length) {
        if (pauseRequested() || stopRequested()) break;
        const scope = scopes[nextIndex];
        const familySignature = bafuFamilySignatureForScope(familySignatureIndex, scope);
        nextIndex += 1;
        let result;
        try {
          result = await runOneScope({
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
  identityUnresolvedReferenceBlocker,
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
  setBafuBatchConfigForTest: (config) => {
    bafuBatchConfig = config || {};
  },
};

import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { resolveTiangongLcaCliRuntimeCommand } from "./foundry-runtime-utils.ts";

type JsonRecord = Record<string, unknown>;

interface RootPayloadMismatch extends JsonRecord {
  code: "payload_mismatch";
  role: "root";
  table: string;
}

function isJsonRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asJsonRecord(value: unknown): JsonRecord {
  return isJsonRecord(value) ? value : {};
}

function isSupportedRootPayloadMismatch(value: JsonRecord): value is RootPayloadMismatch {
  return (
    value.code === "payload_mismatch" &&
    value.role === "root" &&
    typeof value.table === "string" &&
    supportedRootTables.has(value.table)
  );
}

type CliGetResult = {
  ok: boolean;
  payload?: JsonRecord | null;
  command?: string | null;
  executable?: string;
  cli_package?: string | null;
  exit_code?: number;
  stdout_log?: string | null;
  stderr_log?: string | null;
  parsed?: JsonRecord | null;
  error?: string | null;
};

type CliGet = (options: {
  table: string;
  id: string;
  version: string;
  outDir: string;
  repoRoot: string;
}) => CliGetResult;

type AcceptedDiffResult =
  | { accepted: false; reason: string; [key: string]: unknown }
  | {
      accepted: true;
      verifyReportPath: string;
      acceptanceReportPath: string;
      evidence: JsonRecord[];
    };

const supportedRootTables = new Map<string, { command: string; payloadKeys: string[] }>([
  ["flows", { command: "flow", payloadKeys: ["flow", "payload"] }],
  ["processes", { command: "process", payloadKeys: ["process", "payload"] }],
]);

function nowIso() {
  return new Date().toISOString();
}

function fileExists(filePath: string | null | undefined): boolean {
  return Boolean(filePath && fs.existsSync(filePath) && fs.statSync(filePath).isFile());
}

function readJson(filePath: string): unknown {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function readJsonLines(filePath: string): unknown[] {
  if (!fileExists(filePath)) return [];
  const text = fs.readFileSync(filePath, "utf8").trim();
  return text
    ? text
        .split(/\r?\n/u)
        .filter(Boolean)
        .map((line) => JSON.parse(line))
    : [];
}

function readRows(filePath: string): unknown[] {
  if (String(filePath).toLowerCase().endsWith(".jsonl")) return readJsonLines(filePath);
  const value = readJson(filePath);
  if (Array.isArray(value)) return value;
  if (isJsonRecord(value) && Array.isArray(value.rows)) return value.rows;
  return [value];
}

function writeJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function writeJsonLines(filePath: string, rows: unknown[]): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(
    filePath,
    rows.map((row) => JSON.stringify(row)).join("\n") + (rows.length ? "\n" : ""),
  );
}

function repoRelative(repoRoot: string, filePath: string | null | undefined): string | null {
  if (!filePath) return null;
  return path.relative(repoRoot, filePath).split(path.sep).join(path.posix.sep);
}

function asText(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string" || typeof value === "number") return String(value).trim();
  if (Array.isArray(value)) return value.map(asText).filter(Boolean).join("; ");
  if (typeof value === "object") {
    const record = value as JsonRecord;
    return asText(record["#text"] ?? record.value ?? record.id);
  }
  return "";
}

function datasetIdentity(rowValue: unknown, table: string): { id: string; version: string } {
  const row = asJsonRecord(rowValue);
  const type = table === "processes" ? "process" : table === "flows" ? "flow" : null;
  const rootValue = type ? (row[`${type}DataSet`] ?? row) : row;
  const root = asJsonRecord(rootValue);
  const informationContainer = asJsonRecord(root[`${type}Information`]);
  const information = asJsonRecord(
    informationContainer.dataSetInformation ?? informationContainer["common:dataSetInformation"],
  );
  const administrativeInformation = asJsonRecord(root.administrativeInformation);
  const publication = asJsonRecord(
    administrativeInformation.publicationAndOwnership ??
      administrativeInformation["common:publicationAndOwnership"],
  );
  return {
    id:
      asText(information["common:UUID"]) ||
      asText(information.UUID) ||
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

function stableJson(value: unknown): string | undefined {
  if (value == null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const record = asJsonRecord(value);
  const keys = Object.keys(record).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
}

function sha256StableJson(value: unknown): string {
  return crypto.createHash("sha256").update(stableJson(value)!).digest("hex");
}

function traceHashPath(pathParts: string[]): string {
  return `/${pathParts.join("/")}`;
}

function stripTraceHashFromImportTraceSummary(
  value: unknown,
  pathParts: string[] = [],
  removed: string[] = [],
): unknown {
  if (Array.isArray(value)) {
    return value.map((entry, index) =>
      stripTraceHashFromImportTraceSummary(entry, [...pathParts, String(index)], removed),
    );
  }
  if (!isJsonRecord(value)) return value;
  const output: JsonRecord = {};
  for (const [key, child] of Object.entries(value)) {
    if (key === "tiangongfoundry:importTraceSummary") {
      output[key] = stripTraceHashValue(child, [...pathParts, key], removed);
    } else {
      output[key] = stripTraceHashFromImportTraceSummary(child, [...pathParts, key], removed);
    }
  }
  return output;
}

function stripTraceHashValue(value: unknown, pathParts: string[], removed: string[]): unknown {
  if (Array.isArray(value)) {
    return value.map((entry, index) =>
      stripTraceHashValue(entry, [...pathParts, String(index)], removed),
    );
  }
  if (!isJsonRecord(value)) return value;
  const output: JsonRecord = {};
  for (const [key, child] of Object.entries(value)) {
    if (key === "traceHash") {
      removed.push(traceHashPath([...pathParts, key]));
      continue;
    }
    output[key] = stripTraceHashFromImportTraceSummary(child, [...pathParts, key], removed);
  }
  return output;
}

export function normalizeAllowedTraceHashDifference(payload: unknown): {
  normalized: unknown;
  removed_paths: string[];
  normalized_sha256: string;
} {
  const removed_paths: string[] = [];
  const normalized = stripTraceHashFromImportTraceSummary(payload, [], removed_paths);
  return {
    normalized,
    removed_paths,
    normalized_sha256: sha256StableJson(normalized),
  };
}

function extractPayloadFromGet(table: string, json: JsonRecord | null): JsonRecord | null {
  const config = supportedRootTables.get(table);
  if (!config || !json || typeof json !== "object") return null;
  for (const key of config.payloadKeys) {
    if (isJsonRecord(json[key])) return json[key];
  }
  if (table === "flows" && json.flowDataSet) return json;
  if (table === "processes" && json.processDataSet) return json;
  return null;
}

function defaultCliGet({
  table,
  id,
  version,
  outDir,
  repoRoot,
}: {
  table: string;
  id: string;
  version: string;
  outDir: string;
  repoRoot: string;
}): CliGetResult {
  const config = supportedRootTables.get(table);
  if (!config) {
    return {
      ok: false,
      error: `Unsupported root payload table for accepted remote verification diff: ${table}.`,
    };
  }
  fs.mkdirSync(outDir, { recursive: true });
  const stdoutLog = path.join(outDir, `${table}-${id}-${version}.stdout.log`);
  const stderrLog = path.join(outDir, `${table}-${id}-${version}.stderr.log`);
  const cli = resolveTiangongLcaCliRuntimeCommand();
  const cliArgs = [config.command, "get", "--id", id, "--version", version, "--json"];
  const spawnArgs = [...cli.args, ...cliArgs];
  const result = spawnSync(cli.command, spawnArgs, {
    cwd: repoRoot,
    env: process.env,
    encoding: "utf8",
  });
  fs.writeFileSync(stdoutLog, result.stdout || "");
  fs.writeFileSync(stderrLog, result.stderr || "");
  const parsed = parseJsonStdout(result.stdout);
  const payload = extractPayloadFromGet(table, parsed);
  return {
    ok: result.status === 0 && Boolean(payload),
    command: [cli.display, ...cliArgs].join(" "),
    executable: cli.command,
    cli_package: cli.package,
    exit_code: result.status ?? 1,
    stdout_log: repoRelative(repoRoot, stdoutLog),
    stderr_log: repoRelative(repoRoot, stderrLog),
    payload,
    parsed,
    error:
      result.status === 0 && !payload ? "CLI get did not return a supported root payload." : null,
  };
}

function rewriteCounts(counts: JsonRecord | undefined, acceptedCount: number): JsonRecord {
  const output = { ...(counts ?? {}) };
  output.blockers = Math.max(0, Number(output.blockers ?? 0) - acceptedCount);
  output.root_payload_mismatches = Math.max(
    0,
    Number(output.root_payload_mismatches ?? 0) - acceptedCount,
  );
  const byStatus = { ...asJsonRecord(output.by_status) };
  byStatus.payload_mismatch = Math.max(0, Number(byStatus.payload_mismatch ?? 0) - acceptedCount);
  byStatus.ok = Number(byStatus.ok ?? 0) + acceptedCount;
  output.by_status = byStatus;
  return output;
}

function acceptanceKey({
  table,
  id,
  version,
  row_index,
  path: checkPath,
}: {
  table: string;
  id: string;
  version: string;
  row_index: number;
  path?: string | null;
}): string {
  return `${table}:${id}@${version}:${row_index}:${checkPath || ""}`;
}

export function acceptTraceHashOnlyRemoteVerificationMismatch({
  verifyReportPath,
  outDir,
  repoRoot,
  runCliGet = defaultCliGet,
}: {
  verifyReportPath: string;
  outDir: string;
  repoRoot: string;
  runCliGet?: CliGet;
}): AcceptedDiffResult {
  if (!fileExists(verifyReportPath)) {
    return { accepted: false, reason: "verify_report_missing" };
  }
  const verifyReport = asJsonRecord(readJson(verifyReportPath));
  const blockers = Array.isArray(verifyReport.blockers)
    ? verifyReport.blockers.map(asJsonRecord)
    : [];
  if (verifyReport.status === "passed_remote_verification" || blockers.length === 0) {
    return { accepted: false, reason: "verify_report_has_no_blocked_payload_mismatches" };
  }
  const rootPayloadMismatches = blockers.filter(isSupportedRootPayloadMismatch);
  if (rootPayloadMismatches.length !== blockers.length) {
    return { accepted: false, reason: "verify_report_has_non_accepted_blockers" };
  }

  const inputPath = path.resolve(String(verifyReport.input_path || ""));
  if (!fileExists(inputPath)) return { accepted: false, reason: "verify_report_input_missing" };
  const verifyFiles = asJsonRecord(verifyReport.files);
  const checksPath = path.resolve(String(verifyFiles.checks || ""));
  if (!fileExists(checksPath)) return { accepted: false, reason: "verify_checks_missing" };
  const rows = readRows(inputPath);
  const checks = readJsonLines(checksPath).map(asJsonRecord);
  const acceptedDir = path.join(outDir, "accepted-post-write-verify");
  const outputsDir = path.join(acceptedDir, "outputs");
  const remoteDir = path.join(acceptedDir, "remote-readback");
  const acceptedByKey = new Map<string, JsonRecord>();
  const evidence: JsonRecord[] = [];

  for (const blocker of rootPayloadMismatches) {
    const rowIndex = Number(blocker.row_index);
    if (!Number.isInteger(rowIndex) || rowIndex < 0 || rowIndex >= rows.length) {
      return { accepted: false, reason: "payload_mismatch_row_index_missing", blocker };
    }
    const localPayload = rows[rowIndex];
    const localIdentity = datasetIdentity(localPayload, blocker.table);
    const blockerVersion = String(blocker.version || "00.00.001");
    if (
      localIdentity.id !== blocker.id ||
      String(localIdentity.version || "00.00.001") !== blockerVersion
    ) {
      return {
        accepted: false,
        reason: "payload_mismatch_identity_mismatch",
        blocker,
        localIdentity,
      };
    }

    const remote = runCliGet({
      table: blocker.table,
      id: localIdentity.id,
      version: blockerVersion,
      outDir: remoteDir,
      repoRoot,
    });
    if (!remote?.ok || !remote.payload) {
      return { accepted: false, reason: "remote_readback_failed", blocker, remote };
    }

    const localNormalized = normalizeAllowedTraceHashDifference(localPayload);
    const remoteNormalized = normalizeAllowedTraceHashDifference(remote.payload);
    if (localNormalized.removed_paths.length === 0 || remoteNormalized.removed_paths.length === 0) {
      return { accepted: false, reason: "trace_hash_difference_not_present", blocker };
    }
    if (stableJson(localNormalized.normalized) !== stableJson(remoteNormalized.normalized)) {
      return {
        accepted: false,
        reason: "payloads_still_differ_after_trace_hash_normalization",
        blocker,
        local_removed_paths: localNormalized.removed_paths,
        remote_removed_paths: remoteNormalized.removed_paths,
      };
    }

    const check = checks.find(
      (candidate) =>
        candidate?.role === "root" &&
        candidate?.table === blocker.table &&
        candidate?.id === blocker.id &&
        String(candidate?.version || "00.00.001") === String(blocker.version || "00.00.001") &&
        Number(candidate?.row_index) === rowIndex &&
        String(candidate?.path ?? "").endsWith("#readback"),
    );
    if (!check || check.status !== "payload_mismatch") {
      return { accepted: false, reason: "payload_mismatch_check_missing", blocker };
    }

    const accepted = {
      table: blocker.table,
      id: blocker.id,
      version: blocker.version || "00.00.001",
      row_index: rowIndex,
      accepted_difference: "tiangongfoundry_import_trace_summary_trace_hash_only",
      local_removed_paths: localNormalized.removed_paths,
      remote_removed_paths: remoteNormalized.removed_paths,
      normalized_payload_sha256: localNormalized.normalized_sha256,
      original_local_payload_sha256: check.local_payload_sha256 ?? null,
      original_remote_payload_sha256: check.remote_payload_sha256 ?? null,
      remote_readback_command: remote.command ?? null,
      remote_readback_stdout_log: remote.stdout_log ?? null,
      remote_readback_stderr_log: remote.stderr_log ?? null,
    };
    acceptedByKey.set(
      acceptanceKey({
        table: blocker.table,
        id: localIdentity.id,
        version: blockerVersion,
        row_index: rowIndex,
        path: typeof blocker.path === "string" ? blocker.path : null,
      }),
      accepted,
    );
    evidence.push(accepted);
  }

  const acceptedChecks = checks.map((check) => {
    const key = acceptanceKey({
      table: String(check.table ?? ""),
      id: String(check.id ?? ""),
      version: String(check.version || "00.00.001"),
      row_index: Number(check.row_index),
      path: check.path == null ? null : String(check.path),
    });
    const accepted = acceptedByKey.get(key);
    if (!accepted) return check;
    return {
      ...check,
      status: "ok",
      local_payload_sha256: accepted.normalized_payload_sha256,
      remote_payload_sha256: accepted.normalized_payload_sha256,
      foundry_verification_mode: "accepted_normalized_payload",
      foundry_original_status: check.status ?? null,
      foundry_original_local_payload_sha256: accepted.original_local_payload_sha256,
      foundry_original_remote_payload_sha256: accepted.original_remote_payload_sha256,
      foundry_accepted_differences: [accepted],
    };
  });
  const remainingBadChecks = acceptedChecks.filter(
    (check) => check?.role === "root" && check.status !== "ok",
  );
  if (remainingBadChecks.length > 0) {
    return {
      accepted: false,
      reason: "non_accepted_root_checks_remain",
      count: remainingBadChecks.length,
    };
  }

  const acceptedChecksPath = path.join(outputsDir, "remote-verification.jsonl");
  const acceptedBlockersPath = path.join(outputsDir, "blockers.jsonl");
  const acceptedReportPath = path.join(outputsDir, "remote-verification-report.json");
  const acceptanceReportPath = path.join(
    acceptedDir,
    "foundry-accepted-remote-verification-diff.json",
  );
  const acceptedReport = {
    ...verifyReport,
    generated_at_utc: nowIso(),
    status: "passed_remote_verification",
    counts: rewriteCounts(asJsonRecord(verifyReport.counts), evidence.length),
    blockers: [],
    files: {
      ...verifyFiles,
      report: acceptedReportPath,
      checks: acceptedChecksPath,
      blockers: acceptedBlockersPath,
      foundry_original_report: verifyReportPath,
      foundry_acceptance_report: acceptanceReportPath,
    },
    foundry_accepted_remote_verification: {
      status: "accepted_normalized_payload",
      policy:
        "tiangongfoundry:importTraceSummary.traceHash may differ after remote persistence canonicalizes import-only trace summaries; all other root payload content must match exactly.",
      original_report: repoRelative(repoRoot, verifyReportPath),
      accepted_at_utc: nowIso(),
      accepted_differences: evidence,
    },
  };
  const acceptanceReport = {
    schema_version: 1,
    generated_at_utc: nowIso(),
    status: "accepted",
    original_report: repoRelative(repoRoot, verifyReportPath),
    accepted_report: repoRelative(repoRoot, acceptedReportPath),
    accepted_checks: repoRelative(repoRoot, acceptedChecksPath),
    accepted_differences: evidence,
  };
  writeJsonLines(acceptedChecksPath, acceptedChecks);
  writeJsonLines(acceptedBlockersPath, []);
  writeJson(acceptedReportPath, acceptedReport);
  writeJson(acceptanceReportPath, acceptanceReport);
  return {
    accepted: true,
    verifyReportPath: acceptedReportPath,
    acceptanceReportPath,
    evidence,
  };
}

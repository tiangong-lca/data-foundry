import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { resolveTiangongLcaCliRuntimeCommand } from "./foundry-runtime-utils.mjs";

const supportedRootTables = new Map([
  ["flows", { command: "flow", payloadKeys: ["flow", "payload"] }],
  ["processes", { command: "process", payloadKeys: ["process", "payload"] }],
]);

function nowIso() {
  return new Date().toISOString();
}

function fileExists(filePath) {
  return Boolean(filePath) && fs.existsSync(filePath) && fs.statSync(filePath).isFile();
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function readJsonLines(filePath) {
  if (!fileExists(filePath)) return [];
  const text = fs.readFileSync(filePath, "utf8").trim();
  return text
    ? text
        .split(/\r?\n/u)
        .filter(Boolean)
        .map((line) => JSON.parse(line))
    : [];
}

function readRows(filePath) {
  if (String(filePath).toLowerCase().endsWith(".jsonl")) return readJsonLines(filePath);
  const value = readJson(filePath);
  if (Array.isArray(value)) return value;
  if (Array.isArray(value.rows)) return value.rows;
  return [value];
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function writeJsonLines(filePath, rows) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(
    filePath,
    rows.map((row) => JSON.stringify(row)).join("\n") + (rows.length ? "\n" : ""),
  );
}

function repoRelative(repoRoot, filePath) {
  if (!filePath) return null;
  return path.relative(repoRoot, filePath).split(path.sep).join(path.posix.sep);
}

function asText(value) {
  if (value == null) return "";
  if (typeof value === "string" || typeof value === "number") return String(value).trim();
  if (Array.isArray(value)) return value.map(asText).filter(Boolean).join("; ");
  if (typeof value === "object") return asText(value["#text"] ?? value.value ?? value.id);
  return "";
}

function datasetIdentity(row, table) {
  const type = table === "processes" ? "process" : table === "flows" ? "flow" : null;
  const root = type ? (row?.[`${type}DataSet`] ?? row) : row;
  const information =
    root?.[`${type}Information`]?.dataSetInformation ??
    root?.[`${type}Information`]?.["common:dataSetInformation"] ??
    {};
  const publication =
    root?.administrativeInformation?.publicationAndOwnership ??
    root?.administrativeInformation?.["common:publicationAndOwnership"] ??
    {};
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

function stableJson(value) {
  if (value == null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
}

function sha256StableJson(value) {
  return crypto.createHash("sha256").update(stableJson(value)).digest("hex");
}

function traceHashPath(pathParts) {
  return `/${pathParts.join("/")}`;
}

function stripTraceHashFromImportTraceSummary(value, pathParts = [], removed = []) {
  if (Array.isArray(value)) {
    return value.map((entry, index) =>
      stripTraceHashFromImportTraceSummary(entry, [...pathParts, String(index)], removed),
    );
  }
  if (!value || typeof value !== "object") return value;
  const output = {};
  for (const [key, child] of Object.entries(value)) {
    if (key === "tiangongfoundry:importTraceSummary") {
      output[key] = stripTraceHashValue(child, [...pathParts, key], removed);
    } else {
      output[key] = stripTraceHashFromImportTraceSummary(child, [...pathParts, key], removed);
    }
  }
  return output;
}

function stripTraceHashValue(value, pathParts, removed) {
  if (Array.isArray(value)) {
    return value.map((entry, index) =>
      stripTraceHashValue(entry, [...pathParts, String(index)], removed),
    );
  }
  if (!value || typeof value !== "object") return value;
  const output = {};
  for (const [key, child] of Object.entries(value)) {
    if (key === "traceHash") {
      removed.push(traceHashPath([...pathParts, key]));
      continue;
    }
    output[key] = stripTraceHashFromImportTraceSummary(child, [...pathParts, key], removed);
  }
  return output;
}

function normalizeAllowedTraceHashDifference(payload) {
  const removed_paths = [];
  const normalized = stripTraceHashFromImportTraceSummary(payload, [], removed_paths);
  return {
    normalized,
    removed_paths,
    normalized_sha256: sha256StableJson(normalized),
  };
}

function extractPayloadFromGet(table, json) {
  const config = supportedRootTables.get(table);
  if (!config || !json || typeof json !== "object") return null;
  for (const key of config.payloadKeys) {
    if (json[key] && typeof json[key] === "object") return json[key];
  }
  if (table === "flows" && json.flowDataSet) return json;
  if (table === "processes" && json.processDataSet) return json;
  return null;
}

function defaultCliGet({ table, id, version, outDir, repoRoot }) {
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

function rewriteCounts(counts, acceptedCount) {
  const output = { ...(counts ?? {}) };
  output.blockers = Math.max(0, Number(output.blockers ?? 0) - acceptedCount);
  output.root_payload_mismatches = Math.max(
    0,
    Number(output.root_payload_mismatches ?? 0) - acceptedCount,
  );
  output.by_status = { ...(output.by_status ?? {}) };
  output.by_status.payload_mismatch = Math.max(
    0,
    Number(output.by_status.payload_mismatch ?? 0) - acceptedCount,
  );
  output.by_status.ok = Number(output.by_status.ok ?? 0) + acceptedCount;
  return output;
}

function acceptanceKey({ table, id, version, row_index, path: checkPath }) {
  return `${table}:${id}@${version}:${row_index}:${checkPath || ""}`;
}

export function acceptTraceHashOnlyRemoteVerificationMismatch({
  verifyReportPath,
  outDir,
  repoRoot,
  runCliGet = defaultCliGet,
}) {
  if (!fileExists(verifyReportPath)) {
    return { accepted: false, reason: "verify_report_missing" };
  }
  const verifyReport = readJson(verifyReportPath);
  const blockers = Array.isArray(verifyReport.blockers) ? verifyReport.blockers : [];
  if (verifyReport.status === "passed_remote_verification" || blockers.length === 0) {
    return { accepted: false, reason: "verify_report_has_no_blocked_payload_mismatches" };
  }
  if (
    blockers.some(
      (blocker) =>
        blocker?.code !== "payload_mismatch" ||
        blocker?.role !== "root" ||
        !supportedRootTables.has(blocker?.table),
    )
  ) {
    return { accepted: false, reason: "verify_report_has_non_accepted_blockers" };
  }

  const inputPath = path.resolve(String(verifyReport.input_path || ""));
  if (!fileExists(inputPath)) return { accepted: false, reason: "verify_report_input_missing" };
  const checksPath = path.resolve(String(verifyReport.files?.checks || ""));
  if (!fileExists(checksPath)) return { accepted: false, reason: "verify_checks_missing" };
  const rows = readRows(inputPath);
  const checks = readJsonLines(checksPath);
  const acceptedDir = path.join(outDir, "accepted-post-write-verify");
  const outputsDir = path.join(acceptedDir, "outputs");
  const remoteDir = path.join(acceptedDir, "remote-readback");
  const acceptedByKey = new Map();
  const evidence = [];

  for (const blocker of blockers) {
    const rowIndex = Number(blocker.row_index);
    if (!Number.isInteger(rowIndex) || rowIndex < 0 || rowIndex >= rows.length) {
      return { accepted: false, reason: "payload_mismatch_row_index_missing", blocker };
    }
    const localPayload = rows[rowIndex];
    const localIdentity = datasetIdentity(localPayload, blocker.table);
    if (
      localIdentity.id !== blocker.id ||
      String(localIdentity.version || "00.00.001") !== String(blocker.version || "00.00.001")
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
      id: blocker.id,
      version: blocker.version || "00.00.001",
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
    acceptedByKey.set(acceptanceKey({ ...blocker, row_index: rowIndex }), accepted);
    evidence.push(accepted);
  }

  const acceptedChecks = checks.map((check) => {
    const key = acceptanceKey({
      table: check.table,
      id: check.id,
      version: check.version || "00.00.001",
      row_index: Number(check.row_index),
      path: check.path,
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
    counts: rewriteCounts(verifyReport.counts, evidence.length),
    blockers: [],
    files: {
      ...(verifyReport.files ?? {}),
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

function trustedReferenceMatchKey(table, id, version) {
  return `${table} ${id} ${version || "00.00.001"}`;
}

// Accept a post-write remote verification whose ONLY blockers are `missing_dataset` on
// REFERENCE-role rows that point at a pre-verified trusted external dataset — one that
// genuinely exists remotely but is invisible to the importing account through RLS. This
// is the worldsteel case where a process references a flow owned by the USLCI account
// (linanenv@126.com) at state_code=0: the flow was verified to exist via the USLCI token
// and is reused-by-reference per governance rule instead of being duplicated. The
// referencing account cannot resolve it (raw PostgREST + CLI both return not-found), so
// the RLS-scoped post-write verify falsely reports missing_dataset. Every other blocker
// (version_outdated, non-trusted missing references, any root-role blocker, payload
// mismatches) rejects acceptance. `trustedReferenceKeys` is a Set of
// `${table}\0${id}\0${version}` strings the caller independently proved present.
export function acceptTrustedExternalReferenceMissingDataset({
  verifyReportPath,
  outDir,
  repoRoot,
  trustedReferenceKeys,
}) {
  if (!fileExists(verifyReportPath)) {
    return { accepted: false, reason: "verify_report_missing" };
  }
  const trusted = trustedReferenceKeys instanceof Set ? trustedReferenceKeys : new Set();
  if (trusted.size === 0) {
    return { accepted: false, reason: "no_trusted_reference_keys" };
  }
  const verifyReport = readJson(verifyReportPath);
  const blockers = Array.isArray(verifyReport.blockers) ? verifyReport.blockers : [];
  if (verifyReport.status === "passed_remote_verification" || blockers.length === 0) {
    return { accepted: false, reason: "verify_report_has_no_blockers" };
  }
  const evidence = [];
  const acceptedRefKeys = new Set();
  for (const blocker of blockers) {
    if (blocker?.code !== "missing_dataset" || blocker?.role !== "reference") {
      return { accepted: false, reason: "verify_report_has_non_trusted_blockers", blocker };
    }
    const key = trustedReferenceMatchKey(blocker.table, blocker.id, blocker.version);
    if (!trusted.has(key)) {
      return { accepted: false, reason: "reference_not_in_trusted_set", blocker };
    }
    acceptedRefKeys.add(key);
    evidence.push({
      table: blocker.table,
      id: blocker.id,
      version: blocker.version || "00.00.001",
      path: blocker.path ?? null,
      accepted_reason: "trusted_external_state0_reference_verified_present",
    });
  }

  const acceptedDir = path.join(outDir, "accepted-post-write-verify-trusted-reference");
  const outputsDir = path.join(acceptedDir, "outputs");
  const acceptedChecksPath = path.join(outputsDir, "remote-verification.jsonl");
  const acceptedBlockersPath = path.join(outputsDir, "blockers.jsonl");
  const acceptedReportPath = path.join(outputsDir, "remote-verification-report.json");
  const acceptanceReportPath = path.join(acceptedDir, "foundry-accepted-trusted-reference.json");

  const checksPath = path.resolve(String(verifyReport.files?.checks || ""));
  const checks = fileExists(checksPath) ? readJsonLines(checksPath) : [];
  const acceptedChecks = checks.map((check) => {
    if (check?.status !== "missing_dataset") return check;
    const key = trustedReferenceMatchKey(check.table, check.id, check.version);
    if (!acceptedRefKeys.has(key)) return check;
    return {
      ...check,
      status: "ok",
      foundry_verification_mode: "accepted_trusted_external_reference",
      foundry_original_status: "missing_dataset",
    };
  });

  const acceptedCount = evidence.length;
  const counts = { ...(verifyReport.counts ?? {}) };
  counts.blockers = Math.max(0, Number(counts.blockers ?? 0) - acceptedCount);
  counts.by_status = { ...(counts.by_status ?? {}) };
  counts.by_status.missing_dataset = Math.max(
    0,
    Number(counts.by_status.missing_dataset ?? 0) - acceptedCount,
  );
  counts.by_status.ok = Number(counts.by_status.ok ?? 0) + acceptedCount;

  const acceptedReport = {
    ...verifyReport,
    generated_at_utc: nowIso(),
    status: "passed_remote_verification",
    counts,
    blockers: [],
    files: {
      ...(verifyReport.files ?? {}),
      report: acceptedReportPath,
      checks: acceptedChecksPath,
      blockers: acceptedBlockersPath,
      foundry_original_report: verifyReportPath,
      foundry_acceptance_report: acceptanceReportPath,
    },
    foundry_accepted_trusted_external_references: {
      status: "accepted_trusted_external_reference",
      policy:
        "A missing_dataset blocker on a reference-role row is accepted when the referenced dataset is a pre-verified trusted external dataset (present remotely but hidden from the importing account by RLS). Used for worldsteel references to USLCI-account (linanenv@126.com) state_code=0 flows reused by governance rule. Root readback and every non-trusted reference must still pass exactly.",
      accepted_at_utc: nowIso(),
      accepted_references: evidence,
    },
  };
  const acceptanceReport = {
    schema_version: 1,
    generated_at_utc: nowIso(),
    status: "accepted",
    original_report: repoRelative(repoRoot, verifyReportPath),
    accepted_report: repoRelative(repoRoot, acceptedReportPath),
    accepted_references: evidence,
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

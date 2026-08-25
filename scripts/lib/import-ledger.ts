import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { bundleRowTypes } from "./bundle-row-types.ts";

const LEDGER_FILES = {
  manifest: "run-manifest.json",
  okScopes: "ok.scopes.verified.jsonl",
  blockedScopes: "blocked.scopes.human-review.jsonl",
  resumePlan: "resume.plan.jsonl",
  resumeSkipped: "resume.skipped-verified.jsonl",
  report: "dataset-import-ledger-report.json",
};

const BLOCKER_BUCKETS = [
  "elementary-flow",
  "canonical-support",
  "classification",
  "content-saturation",
  "reference-closure",
  "identity",
  "remote-write",
  "other",
];

function sha256(value: any): string {
  return createHash("sha256")
    .update(String(value ?? ""))
    .digest("hex");
}

function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

function jsonLine(row: any): string {
  return `${JSON.stringify(row)}\n`;
}

function readJsonLinesIfExists(filePath: any): any[] {
  if (!filePath || !fs.existsSync(filePath)) return [];
  const text = fs.readFileSync(filePath, "utf8").trim();
  return text ? text.split(/\r?\n/u).map((line) => JSON.parse(line)) : [];
}

function writeJsonLinesFile(filePath: string, rows: any[]): void {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(
    filePath,
    rows.map((row) => JSON.stringify(row)).join("\n") + (rows.length ? "\n" : ""),
  );
}

function appendJsonLinesDedup(filePath: string, rows: any[]) {
  ensureDir(path.dirname(filePath));
  const seen = new Set(
    readJsonLinesIfExists(filePath)
      .map((row) => String(row?.ledger_key ?? ""))
      .filter(Boolean),
  );
  const pending = [];
  for (const row of rows) {
    const key = String(row?.ledger_key ?? "");
    if (!key || seen.has(key)) continue;
    seen.add(key);
    pending.push(row);
  }
  if (pending.length > 0) {
    fs.appendFileSync(filePath, pending.map(jsonLine).join(""));
  }
  return {
    file: filePath,
    appended: pending.length,
    skipped_existing: rows.length - pending.length,
  };
}

function supportPluralForType(datasetType: string): string {
  return (
    (bundleRowTypes as Record<string, { plural: string }>)[datasetType]?.plural ??
    `${datasetType || "unknown"}s`
  );
}

function rowPayload(row: any): any {
  return row?.payload && typeof row.payload === "object" && !Array.isArray(row.payload)
    ? row.payload
    : row;
}

function inferRowDatasetType(payload: any, fallbackType: any): string {
  for (const [datasetType, config] of Object.entries(bundleRowTypes)) {
    if (payload?.[config.rootKey]) return datasetType;
  }
  return fallbackType === "support" ? "support" : fallbackType || "unknown";
}

function rowsFromValue(value: any): any[] {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.rows)) return value.rows;
  if (Array.isArray(value?.items)) return value.items;
  return value && typeof value === "object" ? [value] : [];
}

function blockerBucket(blocker: any): string {
  const text = [
    blocker?.code,
    blocker?.stage,
    blocker?.message,
    blocker?.dataset_type,
    blocker?.blocking_dependency?.dataset_type,
    blocker?.reference_type,
    blocker?.table,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  if (/(elementary|flow_?elementary)/u.test(text)) return "elementary-flow";
  if (
    /(canonical_?support|flow_?property|flowproperty|unit_?group|unitgroup|reference_only_support)/u.test(
      text,
    )
  ) {
    return "canonical-support";
  }
  if (/classification/u.test(text)) return "classification";
  if (/(identity|preflight|candidate)/u.test(text)) return "identity";
  if (/(remote_write|commit|post_write|readback|write failure|save-draft|publish)/u.test(text)) {
    return "remote-write";
  }
  if (
    /(reference_closure|reference closure|remote_verify|verify_remote|unproven|source|contact)/u.test(
      text,
    )
  ) {
    return "reference-closure";
  }
  if (
    /(saturation|full_context|semantic|curation|location|name_plan|synonym|placeholder|authoring)/u.test(
      text,
    )
  ) {
    return "content-saturation";
  }
  return "other";
}

function humanActionForBlocker(blocker: any): string {
  const bucket = blockerBucket(blocker);
  const code = String(blocker?.code ?? "").toLowerCase();
  if (bucket === "classification") {
    return "Produce full-context semantic classification decisions and apply them through the deterministic classification-decision command, then rerun finalize.";
  }
  if (bucket === "elementary-flow") {
    return "Resolve physical-equivalence evidence against an existing canonical elementary flow, or keep the affected scope blocked for human review.";
  }
  if (bucket === "canonical-support") {
    return "Map the generated flowproperty/unitgroup support reference to an existing canonical support row, or add database governance data before rerun.";
  }
  if (bucket === "reference-closure") {
    return "Commit and verify the referenced writable source/contact/flow scope first, or replace placeholder references with true canonical provenance.";
  }
  if (bucket === "identity") {
    return code.includes("timeout")
      ? "Retry only the failed identity/preflight request rows, then merge the refreshed index and rerun finalize."
      : "Produce or refresh exact-payload identity reuse decisions, then rerun finalize.";
  }
  if (bucket === "content-saturation") {
    return "Patch provable schema fields from full context in one AI completion pass, apply deterministically, then rerun validation and finalize.";
  }
  if (bucket === "remote-write") {
    return "Inspect the CLI commit/readback artifact, repair the write or account guard issue, then rerun closeout for the same final rows.";
  }
  return "Review the blocker evidence, repair the affected dependency or row content, and rerun only the affected scope.";
}

export function createImportLedgerUtils({
  asText,
  datasetIdentity,
  fileExists,
  nowIso,
  readJson,
  readJsonLines,
  repoRelativePath,
  resolveRepoPath,
  writeJson,
}: any) {
  function relativeInput(value: any): any {
    const resolved = resolveRepoPath(value);
    return resolved ? repoRelativePath(resolved) : null;
  }

  function readRowsFileMaybe(filePath: any): any[] {
    const resolved = resolveRepoPath(filePath);
    if (!resolved || !fileExists(resolved)) return [];
    if (resolved.toLowerCase().endsWith(".jsonl")) return readJsonLines(resolved);
    return rowsFromValue(readJson(resolved));
  }

  function rowIdentity(row: any, fallbackType: any) {
    const payload = rowPayload(row);
    const datasetType = inferRowDatasetType(payload, fallbackType);
    const identity =
      datasetType && datasetType !== "support" ? datasetIdentity(payload, datasetType) : {};
    return {
      payload,
      dataset_type: datasetType,
      dataset_id:
        identity.id || asText(row?.dataset_id) || asText(row?.id) || asText(row?.entity_id) || null,
      version: identity.version || asText(row?.version) || null,
      payload_hash: sha256(JSON.stringify(payload ?? row ?? null)),
    };
  }

  function updateManifest({ ledgerDir, eventKind, files = {}, reportPath = null }: any): string {
    ensureDir(ledgerDir);
    const manifestPath = path.join(ledgerDir, LEDGER_FILES.manifest);
    const previous = fs.existsSync(manifestPath) ? readJson(manifestPath) : {};
    const manifest = {
      schema_version: 1,
      created_at_utc: previous.created_at_utc ?? nowIso(),
      updated_at_utc: nowIso(),
      ledger_dir: repoRelativePath(ledgerDir),
      event_kinds: [...new Set([...(previous.event_kinds ?? []), eventKind].filter(Boolean))],
      latest_report: reportPath ? repoRelativePath(reportPath) : (previous.latest_report ?? null),
      files: {
        ...previous.files,
        ...Object.fromEntries(
          Object.entries(files)
            .filter(([, file]) => file)
            .map(([key, file]) => [key, repoRelativePath(file)]),
        ),
      },
      contract: {
        ok_prefix: "ok.*.verified.jsonl",
        blocked_prefix: "blocked.*.jsonl",
        retry_prefix: "retry.*.jsonl",
        resume_prefix: "resume.*.jsonl",
        append_only: true,
        dedup_key: "ledger_key",
      },
    };
    writeJson(manifestPath, manifest);
    return manifestPath;
  }

  function writeCloseoutImportLedger({ report, reportPath, ledgerDir }: any) {
    if (!ledgerDir || !report) {
      return {
        status: "skipped",
        reason: !ledgerDir ? "ledger_dir_missing" : "report_missing",
        files: {},
        counts: { entries_written: 0 },
      };
    }
    if (report.status !== "completed") {
      const blockers = Array.isArray(report.blockers) ? report.blockers : [];
      if (blockers.length === 0) {
        return {
          status: "skipped",
          reason: "closeout_not_completed_without_blockers",
          files: {},
          counts: { entries_written: 0 },
        };
      }
      const generatedAt = nowIso();
      const rowIdentities = readRowsFileMaybe(report.final_rows_file).map((row) =>
        rowIdentity(row, report.dataset_type),
      );
      const scopeKey = `${report.dataset_type ?? "unknown"}:${relativeInput(report.final_rows_file) ?? repoRelativePath(reportPath)}`;
      const summaryRow: any = {
        schema_version: 1,
        ledger_kind: "blocked",
        status: "blocked_human_review",
        blocked_at_utc: generatedAt,
        scope_dataset_type: report.dataset_type ?? null,
        profile: report.profile ?? null,
        scope_ids: [
          ...new Set(rowIdentities.map((identity) => identity.dataset_id).filter(Boolean)),
        ],
        scope_versions: [
          ...new Set(rowIdentities.map((identity) => identity.version).filter(Boolean)),
        ],
        scope_key: scopeKey,
        blocker_codes: [...new Set(blockers.map((blocker: any) => blocker?.code).filter(Boolean))],
        blocker_count: blockers.length,
        required_human_action:
          "Repair the commit/readback/account guard blocker for this exact final rows scope, then rerun post-write verification and closeout.",
        final_rows_file: relativeInput(report.final_rows_file),
        finalize_report: relativeInput(report.finalize_report),
        mutation_manifest: relativeInput(report.mutation_manifest),
        closeout_report: repoRelativePath(reportPath),
        rerun_command: `node scripts/foundry.mjs dataset-post-write-closeout --handoff-plan <dataset-commit-handoff-plan.json> --commit-report <commit-report.json> --post-write-verify-report <remote-verification-report.json> --ledger-dir ${repoRelativePath(ledgerDir)}`,
      };
      summaryRow.ledger_key = `blocked:closeout:${summaryRow.scope_key}:${sha256(
        JSON.stringify(summaryRow.blocker_codes),
      )}:${repoRelativePath(reportPath)}`;
      const dependencyRows = blockers.map((blocker: any, index: number) => {
        const bucket = blockerBucket(blocker) === "other" ? "remote-write" : blockerBucket(blocker);
        const row: any = {
          schema_version: 1,
          ledger_kind: "blocked",
          status: "blocked_human_review",
          blocked_at_utc: generatedAt,
          blocker_bucket: bucket,
          reason_code: blocker?.code ?? "closeout_blocker",
          message: blocker?.message ?? null,
          blocking_stage: "post_write_closeout",
          scope_dataset_type: report.dataset_type ?? null,
          scope_ids: summaryRow.scope_ids,
          scope_key: summaryRow.scope_key,
          blocking_dependency: {
            dataset_type: blocker?.dataset_type ?? null,
            id: blocker?.reference_id || blocker?.entity_id || blocker?.id || null,
            version: blocker?.reference_version || blocker?.version || null,
            path: blocker?.path ?? null,
          },
          required_human_action: humanActionForBlocker({
            ...blocker,
            code: blocker?.code ?? "remote_write_blocker",
          }),
          final_rows_file: summaryRow.final_rows_file,
          closeout_report: repoRelativePath(reportPath),
          raw_blocker: blocker,
        };
        row.ledger_key = `blocked:closeout-dependency:${bucket}:${row.reason_code}:${summaryRow.scope_key}:${index}:${repoRelativePath(reportPath)}`;
        return row;
      });
      const writes: any[] = [
        appendJsonLinesDedup(path.join(ledgerDir, LEDGER_FILES.blockedScopes), [summaryRow]),
      ];
      for (const bucket of BLOCKER_BUCKETS) {
        const bucketRows = dependencyRows.filter((row: any) => row.blocker_bucket === bucket);
        if (bucketRows.length === 0) continue;
        writes.push(
          appendJsonLinesDedup(
            path.join(ledgerDir, `blocked.dependencies.${bucket}.jsonl`),
            bucketRows,
          ),
        );
      }
      const manifestPath = updateManifest({
        ledgerDir,
        eventKind: "post_write_closeout_blocked",
        files: { blocked_scopes: path.join(ledgerDir, LEDGER_FILES.blockedScopes) },
        reportPath,
      });
      return {
        status: "completed",
        files: {
          manifest: repoRelativePath(manifestPath),
          blocked_scopes: repoRelativePath(path.join(ledgerDir, LEDGER_FILES.blockedScopes)),
        },
        counts: {
          blockers: blockers.length,
          blocked_scopes: 1,
          entries_written: writes.reduce((total, write) => total + write.appended, 0),
          entries_skipped_existing: writes.reduce(
            (total, write) => total + write.skipped_existing,
            0,
          ),
        },
      };
    }
    const rows = readRowsFileMaybe(report.final_rows_file);
    const generatedAt = nowIso();
    const common = {
      schema_version: 1,
      ledger_kind: "ok",
      status: "verified",
      verified_at_utc: generatedAt,
      scope_dataset_type: report.dataset_type ?? null,
      profile: report.profile ?? null,
      target_user_id: report.target_user_id ?? null,
      expected_state_code: report.expected_state_code ?? null,
      final_rows_file: relativeInput(report.final_rows_file),
      finalize_report: relativeInput(report.finalize_report),
      mutation_manifest: relativeInput(report.mutation_manifest),
      commit_report: relativeInput(report.commit_report),
      post_write_verify_report: relativeInput(report.post_write_verify_report),
      closeout_report: repoRelativePath(reportPath),
      root_payload_mismatches: Number(report.counts?.root_payload_mismatches ?? -1),
    };
    const ledgerRows = rows.map((row: any, index: number) => {
      const identity = rowIdentity(row, report.dataset_type);
      const datasetKey = `${identity.dataset_type}:${identity.dataset_id ?? "missing"}:${identity.version ?? "missing"}`;
      return {
        ...common,
        row_index: index,
        row_dataset_type: identity.dataset_type,
        dataset_id: identity.dataset_id,
        version: identity.version,
        payload_hash: identity.payload_hash,
        dataset_key: datasetKey,
        scope_key: `${report.dataset_type ?? identity.dataset_type}:${common.final_rows_file ?? datasetKey}`,
        ledger_key: `ok:${datasetKey}:${identity.payload_hash}:${repoRelativePath(reportPath)}`,
      };
    });
    const writes: any[] = [];
    writes.push(appendJsonLinesDedup(path.join(ledgerDir, LEDGER_FILES.okScopes), ledgerRows));
    for (const [datasetType, typeRows] of Map.groupBy(
      ledgerRows,
      (row: any) => row.row_dataset_type || "unknown",
    )) {
      writes.push(
        appendJsonLinesDedup(
          path.join(ledgerDir, `ok.${supportPluralForType(datasetType)}.verified.jsonl`),
          typeRows,
        ),
      );
    }
    const files = Object.fromEntries(
      writes.map((write) => [path.basename(write.file).replace(/[.-]/gu, "_"), write.file]),
    );
    const manifestPath = updateManifest({
      ledgerDir,
      eventKind: "post_write_closeout_verified",
      files: { ...files, ok_scopes: path.join(ledgerDir, LEDGER_FILES.okScopes) },
      reportPath,
    });
    return {
      status: "completed",
      files: {
        manifest: repoRelativePath(manifestPath),
        ok_scopes: repoRelativePath(path.join(ledgerDir, LEDGER_FILES.okScopes)),
      },
      counts: {
        rows: rows.length,
        entries_written: writes.reduce((total, write) => total + write.appended, 0),
        entries_skipped_existing: writes.reduce(
          (total, write) => total + write.skipped_existing,
          0,
        ),
      },
    };
  }

  function writeFinalizeImportLedger({ report, reportPath, ledgerDir }: any) {
    if (
      !ledgerDir ||
      !report ||
      ["ready_for_remote_write", "ready_reference_only"].includes(report.status)
    ) {
      return {
        status: "skipped",
        reason: !ledgerDir ? "ledger_dir_missing" : "finalize_ready",
        files: {},
        counts: { entries_written: 0 },
      };
    }
    const blockers = Array.isArray(report.blockers) ? report.blockers : [];
    if (blockers.length === 0) {
      return {
        status: "skipped",
        reason: "no_blockers",
        files: {},
        counts: { entries_written: 0 },
      };
    }
    const rows = readRowsFileMaybe(report.final_rows_file || report.rows_file);
    const rowIdentities = rows.map((row) => rowIdentity(row, report.dataset_type));
    const scopeIds = rowIdentities.map((identity) => identity.dataset_id).filter(Boolean);
    const scopeVersions = rowIdentities.map((identity) => identity.version).filter(Boolean);
    const generatedAt = nowIso();
    const summaryRow: any = {
      schema_version: 1,
      ledger_kind: "blocked",
      status: "blocked_human_review",
      blocked_at_utc: generatedAt,
      scope_dataset_type: report.dataset_type ?? null,
      profile: report.profile ?? null,
      scope_ids: [...new Set(scopeIds)],
      scope_versions: [...new Set(scopeVersions)],
      scope_key: `${report.dataset_type ?? "unknown"}:${relativeInput(report.final_rows_file || report.rows_file) ?? sha256(JSON.stringify(scopeIds))}`,
      blocker_codes: [...new Set(blockers.map((blocker: any) => blocker?.code).filter(Boolean))],
      blocker_count: blockers.length,
      required_human_action:
        "Repair the listed blocker dependencies or content fields, then rerun only this affected scope. Verified scopes in ok.* ledgers should be skipped.",
      final_rows_file: relativeInput(report.final_rows_file || report.rows_file),
      finalize_report: repoRelativePath(reportPath),
      curation_gate_report: relativeInput(report.files?.curation_gate_report),
      mutation_manifest: relativeInput(report.files?.mutation_manifest),
      commit_handoff_plan: relativeInput(report.files?.commit_handoff_plan),
      rerun_command: `node scripts/foundry.mjs dataset-post-authoring-finalize --rows-file ${relativeInput(report.rows_file) ?? "<rows.jsonl>"} --type ${report.dataset_type ?? "<type>"} --out-dir <finalize-dir>`,
    };
    summaryRow.ledger_key = `blocked:scope:${summaryRow.scope_key}:${sha256(
      JSON.stringify(summaryRow.blocker_codes),
    )}:${repoRelativePath(reportPath)}`;

    const dependencyRows = blockers.map((blocker: any, index: number) => {
      const bucket = blockerBucket(blocker);
      const row: any = {
        schema_version: 1,
        ledger_kind: "blocked",
        status: "blocked_human_review",
        blocked_at_utc: generatedAt,
        blocker_bucket: bucket,
        reason_code: blocker?.code ?? "unknown_blocker",
        message: blocker?.message ?? null,
        blocking_stage: blocker?.stage ?? null,
        scope_dataset_type: report.dataset_type ?? null,
        scope_ids: summaryRow.scope_ids,
        scope_key: summaryRow.scope_key,
        blocking_dependency: {
          dataset_type:
            blocker?.blocking_dependency?.dataset_type ||
            blocker?.dataset_type ||
            blocker?.reference_type ||
            blocker?.table ||
            null,
          id:
            blocker?.blocking_dependency?.id ||
            blocker?.reference_id ||
            blocker?.entity_id ||
            blocker?.id ||
            null,
          version:
            blocker?.blocking_dependency?.version ||
            blocker?.reference_version ||
            blocker?.version ||
            null,
          path: blocker?.path ?? null,
        },
        required_human_action: humanActionForBlocker(blocker),
        final_rows_file: summaryRow.final_rows_file,
        finalize_report: repoRelativePath(reportPath),
        mutation_manifest: summaryRow.mutation_manifest,
        raw_blocker: blocker,
      };
      row.ledger_key = `blocked:dependency:${bucket}:${row.reason_code}:${summaryRow.scope_key}:${index}:${repoRelativePath(reportPath)}`;
      return row;
    });

    const writes: any[] = [
      appendJsonLinesDedup(path.join(ledgerDir, LEDGER_FILES.blockedScopes), [summaryRow]),
    ];
    for (const bucket of BLOCKER_BUCKETS) {
      const bucketRows = dependencyRows.filter((row: any) => row.blocker_bucket === bucket);
      if (bucketRows.length === 0) continue;
      writes.push(
        appendJsonLinesDedup(
          path.join(ledgerDir, `blocked.dependencies.${bucket}.jsonl`),
          bucketRows,
        ),
      );
    }
    const identityRetryRows = dependencyRows.filter(
      (row: any) =>
        row.blocker_bucket === "identity" &&
        /(timeout|429|network|rate)/iu.test(`${row.reason_code} ${row.message ?? ""}`),
    );
    if (identityRetryRows.length > 0) {
      writes.push(
        appendJsonLinesDedup(
          path.join(ledgerDir, "retry.identity-failed.jsonl"),
          identityRetryRows,
        ),
      );
    }
    const files = Object.fromEntries(
      writes.map((write) => [path.basename(write.file).replace(/[.-]/gu, "_"), write.file]),
    );
    const manifestPath = updateManifest({
      ledgerDir,
      eventKind: "post_authoring_finalize_blocked",
      files: { ...files, blocked_scopes: path.join(ledgerDir, LEDGER_FILES.blockedScopes) },
      reportPath,
    });
    return {
      status: "completed",
      files: {
        manifest: repoRelativePath(manifestPath),
        blocked_scopes: repoRelativePath(path.join(ledgerDir, LEDGER_FILES.blockedScopes)),
      },
      counts: {
        blockers: blockers.length,
        blocked_scopes: 1,
        entries_written: writes.reduce((total, write) => total + write.appended, 0),
        entries_skipped_existing: writes.reduce(
          (total, write) => total + write.skipped_existing,
          0,
        ),
      },
    };
  }

  function latestByKey(rows: any[], keyFn: (row: any) => any): any[] {
    const latest = new Map<any, any>();
    for (const row of rows) {
      latest.set(keyFn(row), row);
    }
    return [...latest.values()];
  }

  function runDatasetImportLedgerReport(options: any) {
    if (options.help) {
      return {
        schema_version: 1,
        status: "help",
        command: "dataset-import-ledger-report",
        usage: [
          "node scripts/foundry.mjs dataset-import-ledger-report --ledger-dir .foundry/workspaces/<task-id>/import-ledger --out-dir .foundry/workspaces/<task-id>/import-ledger",
        ],
        purpose:
          "Build a read-only resume report from append-only ok/blocked/retry import ledgers. It never writes the database.",
        remote_write_mode: "read-only",
      };
    }
    const ledgerDir = resolveRepoPath(options.ledgerDir || options.importLedgerDir);
    if (!ledgerDir || !fs.existsSync(ledgerDir) || !fs.statSync(ledgerDir).isDirectory()) {
      throw new Error("--ledger-dir is required and must point to an import ledger directory.");
    }
    const outDir = resolveRepoPath(options.outDir || ledgerDir);
    ensureDir(outDir);
    const okScopePath = path.join(ledgerDir, LEDGER_FILES.okScopes);
    const okRows = fs.existsSync(okScopePath)
      ? readJsonLinesIfExists(okScopePath)
      : fs
          .readdirSync(ledgerDir)
          .filter((name) => /^ok\..*\.verified\.jsonl$/u.test(name))
          .flatMap((name) => readJsonLinesIfExists(path.join(ledgerDir, name)));
    const blockedScopeRows = readJsonLinesIfExists(
      path.join(ledgerDir, LEDGER_FILES.blockedScopes),
    );
    const blockedDependencyRows = fs
      .readdirSync(ledgerDir)
      .filter((name) => /^blocked\.dependencies\..*\.jsonl$/u.test(name))
      .flatMap((name) => readJsonLinesIfExists(path.join(ledgerDir, name)));
    const blockedRows = [...blockedScopeRows, ...blockedDependencyRows];
    const retryRows = fs
      .readdirSync(ledgerDir)
      .filter((name) => /^(?:retry\..*|failed\..*\.retry)\.jsonl$/u.test(name))
      .flatMap((name) => readJsonLinesIfExists(path.join(ledgerDir, name)));
    const verifiedKeys = new Set(
      okRows
        .map((row) => row.dataset_key || `${row.row_dataset_type}:${row.dataset_id}:${row.version}`)
        .filter(Boolean),
    );
    const latestBlockedScopes = latestByKey(blockedScopeRows, (row) => row.scope_key);
    const resumeRows = latestBlockedScopes
      .filter((row) => {
        const keys = Array.isArray(row.scope_ids)
          ? row.scope_ids.map(
              (id: any) =>
                `${row.scope_dataset_type}:${id}:${row.scope_versions?.[0] ?? "missing"}`,
            )
          : [];
        return keys.length === 0 || keys.some((key: any) => !verifiedKeys.has(key));
      })
      .map((row) => ({
        schema_version: 1,
        ledger_kind: "resume",
        status: "pending_human_review",
        source_ledger_key: row.ledger_key ?? null,
        scope_key: row.scope_key ?? null,
        scope_dataset_type: row.scope_dataset_type ?? null,
        scope_ids: row.scope_ids ?? [],
        blocker_codes: row.blocker_codes ?? [],
        blocker_count: row.blocker_count ?? null,
        required_human_action: row.required_human_action ?? null,
        final_rows_file: row.final_rows_file ?? null,
        finalize_report: row.finalize_report ?? null,
        rerun_command: row.rerun_command ?? null,
      }));
    const skippedRows = latestByKey(okRows, (row) => row.dataset_key || row.ledger_key).map(
      (row) => ({
        schema_version: 1,
        ledger_kind: "resume",
        status: "skipped_verified",
        source_ledger_key: row.ledger_key ?? null,
        dataset_key: row.dataset_key ?? null,
        row_dataset_type: row.row_dataset_type ?? null,
        dataset_id: row.dataset_id ?? null,
        version: row.version ?? null,
        verified_at_utc: row.verified_at_utc ?? null,
        closeout_report: row.closeout_report ?? null,
      }),
    );
    const resumePath = path.join(outDir, LEDGER_FILES.resumePlan);
    const skippedPath = path.join(outDir, LEDGER_FILES.resumeSkipped);
    writeJsonLinesFile(resumePath, resumeRows);
    writeJsonLinesFile(skippedPath, skippedRows);
    const reportPath = path.join(outDir, LEDGER_FILES.report);
    const report = {
      schema_version: 1,
      generated_at_utc: nowIso(),
      status: resumeRows.length > 0 ? "completed_with_blocked_scopes" : "completed",
      ledger_dir: repoRelativePath(ledgerDir),
      remote_write_mode: "read-only",
      policy: {
        resume_boundary:
          "The ledger report is read-only. Verified scopes are skipped; blocked scopes remain pending until human/database governance repairs their dependencies and reruns only affected scopes.",
      },
      counts: {
        ok_rows: okRows.length,
        blocked_rows: blockedRows.length,
        retry_rows: retryRows.length,
        resume_rows: resumeRows.length,
        skipped_verified_rows: skippedRows.length,
      },
      files: {
        report: repoRelativePath(reportPath),
        resume_plan: repoRelativePath(resumePath),
        resume_skipped_verified: repoRelativePath(skippedPath),
      },
    };
    writeJson(reportPath, report);
    updateManifest({
      ledgerDir,
      eventKind: "ledger_report",
      files: { report: reportPath, resume_plan: resumePath, resume_skipped_verified: skippedPath },
      reportPath,
    });
    return report;
  }

  return {
    runDatasetImportLedgerReport,
    writeCloseoutImportLedger,
    writeFinalizeImportLedger,
  };
}

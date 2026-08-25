import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  createImportLedgerUtils as createImportLedgerUtilsSource,
  type CloseoutReport,
  type JsonRecord,
  type JsonValue,
} from "../../scripts/lib/import-ledger.ts";

const createImportLedgerUtils = createImportLedgerUtilsSource;

const rootKeys = {
  process: "processDataSet",
  flowproperty: "flowPropertyDataSet",
} as const;

function toPosix(value: string): string {
  return value.replaceAll("\\", "/");
}

function writeJson(filePath: string, value: JsonValue): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function writeJsonLines(filePath: string, rows: unknown[]): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(
    filePath,
    rows.map((row) => JSON.stringify(row)).join("\n") + (rows.length > 0 ? "\n" : ""),
  );
}

function readJson(filePath: string): JsonRecord {
  return asJsonRecord(JSON.parse(fs.readFileSync(filePath, "utf8")));
}

function readJsonLines(filePath: string): JsonRecord[] {
  const text = fs.readFileSync(filePath, "utf8").trim();
  return text ? text.split(/\r?\n/u).map((line) => asJsonRecord(JSON.parse(line))) : [];
}

function createHarness(root: string) {
  return createImportLedgerUtils({
    asText: (value: unknown) => (value == null ? "" : String(value).trim()),
    datasetIdentity: (payload: JsonValue, datasetType: string) => {
      const payloadRecord = isJsonRecord(payload) ? payload : {};
      const rootKey = rootKeys[datasetType as keyof typeof rootKeys];
      const datasetRoot = rootKey ? asJsonRecord(payloadRecord[rootKey]) : {};
      const identity = asJsonRecord(datasetRoot.identity);
      return {
        id: typeof identity.id === "string" ? identity.id : null,
        version: typeof identity.version === "string" ? identity.version : null,
      };
    },
    fileExists: (filePath: string) => fs.existsSync(filePath) && fs.statSync(filePath).isFile(),
    nowIso: () => "2026-08-25T01:02:03.000Z",
    readJson,
    readJsonLines,
    repoRelativePath: (filePath: string) => toPosix(path.relative(root, filePath)),
    resolveRepoPath: (filePath: unknown) => {
      if (!filePath) return null;
      const text = String(filePath);
      return path.isAbsolute(text) ? text : path.join(root, text);
    },
    writeJson,
  });
}

function isJsonRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asJsonRecord(value: unknown): JsonRecord {
  return isJsonRecord(value) ? value : {};
}

function withTempRoot(name: string, body: (root: string) => void): void {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `${name}-`));
  try {
    body(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test("verified closeout preserves JSONL order, row identities, hashes, artifact paths, and append-only dedupe", () => {
  withTempRoot("import-ledger-verified", (root) => {
    const rowsFile = path.join(root, "inputs", "rows.jsonl");
    const ledgerDir = path.join(root, "ledger");
    const reportPath = path.join(root, "reports", "closeout.json");
    const processPayload = {
      processDataSet: { identity: { id: "process-a", version: "01.00.000" }, amount: 1 },
    };
    const flowPropertyPayload = {
      flowPropertyDataSet: {
        identity: { id: "property-b", version: "02.00.000" },
        name: "Mass",
      },
    };
    writeJsonLines(rowsFile, [
      { payload: processPayload, dataset_id: "ignored-wrapper-id" },
      { payload: flowPropertyPayload },
    ]);
    const report = {
      status: "completed" as const,
      dataset_type: "process",
      profile: "bafu",
      final_rows_file: "inputs/rows.jsonl",
      finalize_report: "reports/finalize.json",
      mutation_manifest: "reports/mutations.json",
      commit_report: "reports/commit.json",
      post_write_verify_report: "reports/verify.json",
      target_user_id: "test-account",
      expected_state_code: 0,
      counts: { root_payload_mismatches: 0 },
    };
    const utils = createHarness(root);

    const first = utils.writeCloseoutImportLedger({ ledgerDir, report, reportPath });
    assert.deepEqual(first, {
      status: "completed",
      files: { manifest: "ledger/run-manifest.json", ok_scopes: "ledger/ok.scopes.verified.jsonl" },
      counts: { rows: 2, entries_written: 4, entries_skipped_existing: 0 },
    });

    const okRows = readJsonLines(path.join(ledgerDir, "ok.scopes.verified.jsonl"));
    assert.deepEqual(
      okRows.map((row) => ({
        row_index: row.row_index,
        row_dataset_type: row.row_dataset_type,
        dataset_id: row.dataset_id,
        version: row.version,
        payload_hash: row.payload_hash,
        dataset_key: row.dataset_key,
        ledger_key: row.ledger_key,
      })),
      [
        {
          row_index: 0,
          row_dataset_type: "process",
          dataset_id: "process-a",
          version: "01.00.000",
          payload_hash: "d5ecd50091410a596052cdf97dc769482ac2b47c74beaf25226124d1eb5a7927",
          dataset_key: "process:process-a:01.00.000",
          ledger_key:
            "ok:process:process-a:01.00.000:d5ecd50091410a596052cdf97dc769482ac2b47c74beaf25226124d1eb5a7927:reports/closeout.json",
        },
        {
          row_index: 1,
          row_dataset_type: "flowproperty",
          dataset_id: "property-b",
          version: "02.00.000",
          payload_hash: "3d3f6fbb3798ee8899943d69ab99fd3abef1163425cb7716b5ba373afbe653bc",
          dataset_key: "flowproperty:property-b:02.00.000",
          ledger_key:
            "ok:flowproperty:property-b:02.00.000:3d3f6fbb3798ee8899943d69ab99fd3abef1163425cb7716b5ba373afbe653bc:reports/closeout.json",
        },
      ],
    );
    assert.equal(okRows[0].final_rows_file, "inputs/rows.jsonl");
    assert.equal(okRows[0].post_write_verify_report, "reports/verify.json");
    assert.deepEqual(readJsonLines(path.join(ledgerDir, "ok.processes.verified.jsonl")), [
      okRows[0],
    ]);
    assert.deepEqual(readJsonLines(path.join(ledgerDir, "ok.flowproperties.verified.jsonl")), [
      okRows[1],
    ]);
    assert.equal(
      fs.readFileSync(path.join(ledgerDir, "ok.scopes.verified.jsonl"), "utf8"),
      `${JSON.stringify(okRows[0])}\n${JSON.stringify(okRows[1])}\n`,
    );

    const duplicate = utils.writeCloseoutImportLedger({ ledgerDir, report, reportPath });
    assert.deepEqual(duplicate.counts, {
      rows: 2,
      entries_written: 0,
      entries_skipped_existing: 4,
    });
    assert.deepEqual(readJsonLines(path.join(ledgerDir, "ok.scopes.verified.jsonl")), okRows);

    const manifest = readJson(path.join(ledgerDir, "run-manifest.json"));
    assert.deepEqual(manifest.event_kinds, ["post_write_closeout_verified"]);
    assert.deepEqual(manifest.contract, {
      ok_prefix: "ok.*.verified.jsonl",
      blocked_prefix: "blocked.*.jsonl",
      retry_prefix: "retry.*.jsonl",
      resume_prefix: "resume.*.jsonl",
      append_only: true,
      dedup_key: "ledger_key",
    });
    assert.equal(asJsonRecord(manifest.files).ok_scopes, "ledger/ok.scopes.verified.jsonl");
  });
});

test("blocked finalize preserves blocker order, human actions, retry rows, summaries, and dedupe", () => {
  withTempRoot("import-ledger-blocked", (root) => {
    const rowsFile = path.join(root, "inputs", "rows.json");
    const ledgerDir = path.join(root, "ledger");
    const reportPath = path.join(root, "reports", "finalize.json");
    writeJson(rowsFile, {
      rows: [
        {
          processDataSet: {
            identity: { id: "process-blocked", version: "00.00.001" },
          },
        },
      ],
    });
    const blockers = [
      {
        code: "identity_preflight_timeout",
        stage: "identity.preflight",
        message: "network timeout",
        blocking_dependency: { dataset_type: "process", id: "candidate-1" },
      },
      {
        code: "classification_decision_missing",
        stage: "classification.apply",
        reference_id: "category-1",
      },
      {
        code: "canonical_unit_group_reference_unresolved",
        dataset_type: "unitgroup",
        reference_id: "unit-group-1",
      },
    ];
    const report = {
      status: "blocked" as const,
      dataset_type: "process",
      profile: "bafu",
      rows_file: "inputs/rows.json",
      final_rows_file: "inputs/rows.json",
      blockers,
      files: {
        curation_gate_report: "reports/curation.json",
        mutation_manifest: "reports/mutations.json",
        commit_handoff_plan: "reports/handoff.json",
      },
    };
    const utils = createHarness(root);

    const first = utils.writeFinalizeImportLedger({ ledgerDir, report, reportPath });
    assert.deepEqual(first.counts, {
      blockers: 3,
      blocked_scopes: 1,
      entries_written: 5,
      entries_skipped_existing: 0,
    });
    const summaries = readJsonLines(path.join(ledgerDir, "blocked.scopes.human-review.jsonl"));
    assert.deepEqual(summaries[0].scope_ids, ["process-blocked"]);
    assert.deepEqual(summaries[0].scope_versions, ["00.00.001"]);
    assert.deepEqual(
      summaries[0].blocker_codes,
      blockers.map((blocker) => blocker.code),
    );
    assert.equal(summaries[0].final_rows_file, "inputs/rows.json");
    assert.equal(summaries[0].curation_gate_report, "reports/curation.json");
    assert.match(
      String(summaries[0].rerun_command),
      /--rows-file inputs\/rows\.json --type process/u,
    );

    const identityRows = readJsonLines(path.join(ledgerDir, "blocked.dependencies.identity.jsonl"));
    const classificationRows = readJsonLines(
      path.join(ledgerDir, "blocked.dependencies.classification.jsonl"),
    );
    const supportRows = readJsonLines(
      path.join(ledgerDir, "blocked.dependencies.canonical-support.jsonl"),
    );
    assert.equal(identityRows[0].reason_code, blockers[0].code);
    assert.equal(classificationRows[0].reason_code, blockers[1].code);
    assert.equal(supportRows[0].reason_code, blockers[2].code);
    assert.equal(
      identityRows[0].required_human_action,
      "Retry only the failed identity/preflight request rows, then merge the refreshed index and rerun finalize.",
    );
    assert.equal(
      classificationRows[0].required_human_action,
      "Produce full-context semantic classification decisions and apply them through the deterministic classification-decision command, then rerun finalize.",
    );
    assert.equal(
      supportRows[0].required_human_action,
      "Map the generated flowproperty/unitgroup support reference to an existing canonical support row, or add database governance data before rerun.",
    );
    assert.deepEqual(
      readJsonLines(path.join(ledgerDir, "retry.identity-failed.jsonl")),
      identityRows,
    );

    const duplicate = utils.writeFinalizeImportLedger({ ledgerDir, report, reportPath });
    assert.deepEqual(duplicate.counts, {
      blockers: 3,
      blocked_scopes: 1,
      entries_written: 0,
      entries_skipped_existing: 5,
    });
    assert.deepEqual(readJson(path.join(ledgerDir, "run-manifest.json")).event_kinds, [
      "post_authoring_finalize_blocked",
    ]);
  });
});

test("blocked closeout emits the remote-write envelope and preserves duplicate error evidence", () => {
  withTempRoot("import-ledger-closeout-blocked", (root) => {
    const ledgerDir = path.join(root, "ledger");
    const rowsFile = path.join(root, "inputs", "rows.jsonl");
    const reportPath = path.join(root, "reports", "closeout.json");
    writeJsonLines(rowsFile, [
      {
        processDataSet: { identity: { id: "process-closeout", version: "00.00.001" } },
      },
    ]);
    const report = {
      status: "failed",
      dataset_type: "process",
      profile: "bafu",
      final_rows_file: "inputs/rows.jsonl",
      blockers: [
        { code: "commit_failed", message: "save-draft failed" },
        { code: "commit_failed", message: "readback failed" },
      ],
    };
    const result = createHarness(root).writeCloseoutImportLedger({
      ledgerDir,
      report: report as unknown as CloseoutReport,
      reportPath,
    });

    assert.deepEqual(result.counts, {
      blockers: 2,
      blocked_scopes: 1,
      entries_written: 3,
      entries_skipped_existing: 0,
    });
    const summary = readJsonLines(path.join(ledgerDir, "blocked.scopes.human-review.jsonl"))[0];
    assert.deepEqual(summary.blocker_codes, ["commit_failed"]);
    assert.equal(summary.blocker_count, 2);
    assert.equal(summary.scope_key, "process:inputs/rows.jsonl");
    assert.equal(summary.closeout_report, "reports/closeout.json");
    const dependencies = readJsonLines(
      path.join(ledgerDir, "blocked.dependencies.remote-write.jsonl"),
    );
    assert.deepEqual(
      dependencies.map((row) => row.message),
      ["save-draft failed", "readback failed"],
    );
    assert.deepEqual(
      dependencies.map((row) => String(row.ledger_key).match(/:([01]):reports/u)?.[1]),
      ["0", "1"],
    );
  });
});

test("ledger report keeps latest blocked rows in first-seen scope order and summarizes verified/retry artifacts", () => {
  withTempRoot("import-ledger-report", (root) => {
    const ledgerDir = path.join(root, "ledger");
    const outDir = path.join(root, "output");
    writeJsonLines(path.join(ledgerDir, "ok.scopes.verified.jsonl"), [
      {
        dataset_key: "process:verified:00.00.001",
        dataset_id: "verified",
        row_dataset_type: "process",
        version: "00.00.001",
        ledger_key: "ok-verified",
        verified_at_utc: "earlier",
      },
      {
        dataset_key: "process:verified:00.00.001",
        dataset_id: "verified",
        row_dataset_type: "process",
        version: "00.00.001",
        ledger_key: "ok-verified-latest",
        verified_at_utc: "latest",
      },
    ]);
    writeJsonLines(path.join(ledgerDir, "blocked.scopes.human-review.jsonl"), [
      {
        scope_key: "scope-a",
        scope_dataset_type: "process",
        scope_ids: ["pending-a"],
        scope_versions: ["00.00.001"],
        blocker_codes: ["old"],
        ledger_key: "blocked-a-old",
      },
      {
        scope_key: "scope-b",
        scope_dataset_type: "process",
        scope_ids: ["verified"],
        scope_versions: ["00.00.001"],
        blocker_codes: ["already-verified"],
        ledger_key: "blocked-b",
      },
      {
        scope_key: "scope-a",
        scope_dataset_type: "process",
        scope_ids: ["pending-a"],
        scope_versions: ["00.00.001"],
        blocker_codes: ["latest"],
        ledger_key: "blocked-a-latest",
      },
    ]);
    writeJsonLines(path.join(ledgerDir, "blocked.dependencies.identity.jsonl"), [
      { ledger_key: "dependency-a", reason_code: "identity_timeout" },
    ]);
    writeJsonLines(path.join(ledgerDir, "retry.identity-failed.jsonl"), [
      { ledger_key: "retry-a", reason_code: "identity_timeout" },
    ]);
    const utils = createHarness(root);

    const report = utils.runDatasetImportLedgerReport({
      ledgerDir: "ledger",
      outDir: "output",
    });
    assert.notEqual(report.status, "help");
    if (report.status === "help") return;
    assert.deepEqual(report.counts, {
      ok_rows: 2,
      blocked_rows: 4,
      retry_rows: 1,
      resume_rows: 1,
      skipped_verified_rows: 1,
    });
    assert.equal(report.status, "completed_with_blocked_scopes");
    assert.deepEqual(readJsonLines(path.join(outDir, "resume.plan.jsonl")), [
      {
        schema_version: 1,
        ledger_kind: "resume",
        status: "pending_human_review",
        source_ledger_key: "blocked-a-latest",
        scope_key: "scope-a",
        scope_dataset_type: "process",
        scope_ids: ["pending-a"],
        blocker_codes: ["latest"],
        blocker_count: null,
        required_human_action: null,
        final_rows_file: null,
        finalize_report: null,
        rerun_command: null,
      },
    ]);
    assert.deepEqual(readJsonLines(path.join(outDir, "resume.skipped-verified.jsonl")), [
      {
        schema_version: 1,
        ledger_kind: "resume",
        status: "skipped_verified",
        source_ledger_key: "ok-verified-latest",
        dataset_key: "process:verified:00.00.001",
        row_dataset_type: "process",
        dataset_id: "verified",
        version: "00.00.001",
        verified_at_utc: "latest",
        closeout_report: null,
      },
    ]);
    assert.equal(report.files.report, "output/dataset-import-ledger-report.json");
    assert.equal(
      fs.readFileSync(path.join(outDir, "resume.plan.jsonl"), "utf8"),
      `${JSON.stringify(readJsonLines(path.join(outDir, "resume.plan.jsonl"))[0])}\n`,
    );
  });
});

test("ledger skip and error envelopes remain exact for absent inputs, ready reports, and malformed ledgers", () => {
  withTempRoot("import-ledger-errors", (root) => {
    const utils = createHarness(root);
    assert.deepEqual(
      utils.writeCloseoutImportLedger({
        report: {} as unknown as CloseoutReport,
        reportPath: "report.json",
        ledgerDir: null,
      }),
      {
        status: "skipped",
        reason: "ledger_dir_missing",
        files: {},
        counts: { entries_written: 0 },
      },
    );
    assert.deepEqual(
      utils.writeCloseoutImportLedger({
        report: { status: "failed", blockers: [] },
        reportPath: "report.json",
        ledgerDir: "ledger",
      }),
      {
        status: "skipped",
        reason: "closeout_not_completed_without_blockers",
        files: {},
        counts: { entries_written: 0 },
      },
    );
    assert.deepEqual(
      utils.writeFinalizeImportLedger({
        report: { status: "ready_for_remote_write" },
        reportPath: "report.json",
        ledgerDir: "ledger",
      }),
      {
        status: "skipped",
        reason: "finalize_ready",
        files: {},
        counts: { entries_written: 0 },
      },
    );
    assert.deepEqual(
      utils.writeFinalizeImportLedger({
        report: { status: "blocked", blockers: [] },
        reportPath: "report.json",
        ledgerDir: "ledger",
      }),
      {
        status: "skipped",
        reason: "no_blockers",
        files: {},
        counts: { entries_written: 0 },
      },
    );
    assert.throws(
      () => utils.runDatasetImportLedgerReport({}),
      new Error("--ledger-dir is required and must point to an import ledger directory."),
    );

    const ledgerDir = path.join(root, "ledger-malformed");
    fs.mkdirSync(ledgerDir, { recursive: true });
    fs.writeFileSync(path.join(ledgerDir, "ok.scopes.verified.jsonl"), "{not-json}\n");
    assert.throws(
      () => utils.runDatasetImportLedgerReport({ ledgerDir }),
      (error: unknown) => error instanceof SyntaxError,
    );

    assert.deepEqual(utils.runDatasetImportLedgerReport({ help: true }), {
      schema_version: 1,
      status: "help",
      command: "dataset-import-ledger-report",
      usage: [
        "node scripts/foundry.ts dataset-import-ledger-report --ledger-dir .foundry/workspaces/<task-id>/import-ledger --out-dir .foundry/workspaces/<task-id>/import-ledger",
      ],
      purpose:
        "Build a read-only resume report from append-only ok/blocked/retry import ledgers. It never writes the database.",
      remote_write_mode: "read-only",
    });
  });
});

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  createBafuProcessScopeRun,
  type BafuProcessScopeRunAdapter,
  type ProcessScopeFinalizeStageResult,
  type ProcessScopeHandoffRunResult,
} from "../../scripts/lib/bafu-orchestration/process-scope-run.ts";
import {
  applyBafuProcessScopeHandoffSummary,
  compactCommandStage,
  projectBafuProcessScopeFinalizeReport,
} from "../../scripts/lib/bafu-orchestration/process-scope-report.ts";
import type { JsonRecord } from "../../scripts/lib/bafu-orchestration/finalize-recovery-policy.ts";

const fixedNow = "2026-08-26T12:00:00.000Z";
const fixtureRoot = "/fixture";
const rowsFile = "/fixture/input/process.jsonl";
const supportRowsFile = "/fixture/input/support.jsonl";
const sourceRowsFile = "/fixture/input/source-process.jsonl";
const outDir = "/fixture/run";
const reportPath = "/fixture/run/bafu-process-scope-e2e-report.json";
const ledgerPath = "/fixture/run/bafu-process-scope-e2e-ledger.jsonl";
const finalizeReportPath = "/fixture/run/finalize/dataset-post-authoring-finalize-report.json";
const processScope = {
  id: "11111111-2222-4333-8444-555555555555",
  version: "00.00.001",
};
const inputHashes = {
  rows_file_sha256: "rows-sha256",
  source_support_rows_file_sha256: "support-sha256",
  source_rows_file_sha256: "source-sha256",
};

interface FixtureState {
  json: Map<string, JsonRecord>;
  rows: Map<string, JsonRecord[]>;
  ledgers: Map<string, JsonRecord[]>;
  bytes: Map<string, string>;
  reads: string[];
  events: string[];
  finalizeResults: ProcessScopeFinalizeStageResult[];
  beforeFinalize: (() => void) | null;
  handoffResult: ProcessScopeHandoffRunResult | null;
}

function relative(filePath: string | null | undefined): string | null {
  return filePath ? path.posix.relative(fixtureRoot, filePath) : null;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function prettyBytes(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function ledgerBytes(rows: readonly unknown[]): string {
  return rows.map((row) => JSON.stringify(row)).join("\n") + (rows.length > 0 ? "\n" : "");
}

function expectJsonArtifact(state: FixtureState, filePath: string, expected: unknown): void {
  const expectedBytes = prettyBytes(expected);
  const actualBytes = state.bytes.get(filePath);
  assert.equal(actualBytes, expectedBytes);
  if (actualBytes === undefined) assert.fail(`missing JSON artifact: ${filePath}`);
  assert.equal(sha256(actualBytes), sha256(expectedBytes));
}

function expectLedgerArtifact(
  state: FixtureState,
  filePath: string,
  expected: readonly JsonRecord[],
): void {
  const expectedBytes = ledgerBytes(expected);
  const actualBytes = state.bytes.get(filePath);
  assert.equal(actualBytes, expectedBytes);
  if (actualBytes === undefined) assert.fail(`missing ledger artifact: ${filePath}`);
  assert.equal(sha256(actualBytes), sha256(expectedBytes));
}

function readyFinalizeReport(reportFile: string = finalizeReportPath): {
  report: JsonRecord;
  gatePath: string;
} {
  const gatePath = path.posix.join(path.posix.dirname(reportFile), "curation-gate-report.json");
  return {
    gatePath,
    report: {
      schema_version: 1,
      status: "ready_for_remote_write",
      rows_file: relative(rowsFile),
      counts: { blockers: 0, commit_handoff_blockers: 0 },
      files: {
        curation_gate_report: relative(gatePath),
        mutation_manifest: "run/finalize/mutation-manifest.json",
        commit_handoff_plan: "run/finalize/dataset-commit-handoff-plan.json",
      },
      commit_handoff: {
        status: "ready_for_explicit_commit",
        command: { schema: "commit-spec" },
        post_write_verify_command: { schema: "verify-spec" },
        blockers: [],
      },
      blockers: [],
    },
  };
}

function blockedFinalizeReport(reportFile: string): { report: JsonRecord; gatePath: string } {
  const gatePath = path.posix.join(path.posix.dirname(reportFile), "curation-gate-report.json");
  return {
    gatePath,
    report: {
      schema_version: 1,
      status: "blocked",
      rows_file: relative(rowsFile),
      counts: { blockers: 1, commit_handoff_blockers: 1 },
      files: { curation_gate_report: relative(gatePath) },
      commit_handoff: {
        status: "blocked",
        command: null,
        post_write_verify_command: null,
        blockers: [{ code: "finalize_not_ready" }],
      },
      blockers: [{ code: "post_authoring_curation_gate_not_ready" }],
    },
  };
}

function makeFixture(): {
  adapter: BafuProcessScopeRunAdapter;
  state: FixtureState;
  run: ReturnType<typeof createBafuProcessScopeRun>["run"];
} {
  const state: FixtureState = {
    json: new Map(),
    rows: new Map([
      [rowsFile, [{ processDataSet: { fixture: true } }]],
      [supportRowsFile, [{ sourceDataSet: { fixture: true } }]],
      [sourceRowsFile, [{ processDataSet: { source: true } }]],
    ]),
    ledgers: new Map(),
    bytes: new Map(),
    reads: [],
    events: [],
    finalizeResults: [],
    beforeFinalize: null,
    handoffResult: null,
  };

  const commandString = (argv: readonly string[]): string => argv.join(" ");
  const rerunCommand = ({
    rowsFile: currentRowsFile,
    outDir: currentOutDir,
    sourceSupportRowsFile: currentSupportRowsFile,
    sourceRowsFile: currentSourceRowsFile,
  }: {
    rowsFile: string;
    outDir: string;
    sourceSupportRowsFile?: string | null;
    sourceRowsFile?: string | null;
  }): string => {
    const argv = [
      "node",
      "scripts/foundry.ts",
      "dataset-bafu-process-scope-e2e",
      "--rows-file",
      relative(currentRowsFile)!,
      "--out-dir",
      relative(currentOutDir)!,
      "--execute",
    ];
    if (currentSupportRowsFile) {
      argv.push("--source-support-rows-file", relative(currentSupportRowsFile)!);
    }
    if (currentSourceRowsFile) argv.push("--source-rows-file", relative(currentSourceRowsFile)!);
    return commandString(argv);
  };

  const adapter: BafuProcessScopeRunAdapter = {
    clock: { nowIso: () => fixedNow },
    fs: {
      exists: (filePath) => {
        if (!filePath) return false;
        return (
          state.json.has(filePath) ||
          state.rows.has(filePath) ||
          state.ledgers.has(filePath) ||
          state.bytes.has(filePath)
        );
      },
      mkdir: (directory) => state.events.push(`mkdir:${relative(directory)}`),
      readJson: (filePath) => {
        state.reads.push(filePath);
        return state.json.get(filePath) ?? {};
      },
      readJsonLines: (filePath) => [...(state.ledgers.get(filePath) ?? [])],
      readRowsFile: (filePath) => [...(state.rows.get(filePath) ?? [])],
    },
    path: {
      join: (...parts) => path.posix.join(...parts),
      relative,
      resolve: (value) => {
        if (value == null || value === "") return null;
        const text = String(value);
        return path.posix.isAbsolute(text) ? text : path.posix.join(fixtureRoot, text);
      },
    },
    hash: {
      fileSha256: (filePath) => {
        if (filePath === rowsFile) return inputHashes.rows_file_sha256;
        if (filePath === supportRowsFile) return inputHashes.source_support_rows_file_sha256;
        if (filePath === sourceRowsFile) return inputHashes.source_rows_file_sha256;
        throw new Error(`unexpected hash input: ${filePath}`);
      },
    },
    options: {
      boolean: (value) => value === true || value === "true",
      identityReports: () => [],
      processIdentity: () => processScope,
    },
    ledger: {
      append: (filePath, row) => {
        const rows = [...(state.ledgers.get(filePath) ?? []), row];
        state.ledgers.set(filePath, rows);
        state.bytes.set(filePath, ledgerBytes(rows));
        state.events.push(`ledger:${String(row.stage)}`);
      },
    },
    stage: {
      project: (input) => compactCommandStage(input),
      runFinalize: ({ command, logDir, label }) => {
        state.events.push(`stage:${label}:${commandString(command)}`);
        state.beforeFinalize?.();
        const result = state.finalizeResults.shift();
        if (!result) throw new Error(`missing fixture finalize result for ${label}`);
        return {
          ...result,
          stdoutLog: path.posix.join(logDir, `${label}.stdout.log`),
          stderrLog: path.posix.join(logDir, `${label}.stderr.log`),
        };
      },
    },
    finalize: {
      build: ({ options, rowsFile: currentRowsFile, outDir: currentOutDir, importLedgerDir }) => {
        const finalizeDir = path.posix.join(currentOutDir, "finalize");
        const argv = [
          "/usr/bin/node",
          "scripts/foundry.ts",
          "dataset-post-authoring-finalize",
          "--type",
          "process",
          "--profile",
          "bafu",
          "--rows-file",
          relative(currentRowsFile)!,
          "--out-dir",
          relative(finalizeDir)!,
          "--ledger-dir",
          relative(importLedgerDir)!,
        ];
        if (options.sourceSupportRowsFile) {
          argv.push("--source-support-rows-file", relative(String(options.sourceSupportRowsFile))!);
        }
        if (options.sourceRowsFile || options.originalRowsFile) {
          argv.push(
            "--source-rows-file",
            relative(String(options.sourceRowsFile || options.originalRowsFile))!,
          );
        }
        return {
          argv,
          finalizeDir,
          finalizeReportPath: path.posix.join(
            finalizeDir,
            "dataset-post-authoring-finalize-report.json",
          ),
        };
      },
      project: (input) => {
        const gateReport = adapter.finalize.readGate(input.finalizeReport);
        return projectBafuProcessScopeFinalizeReport({
          generatedAtUtc: fixedNow,
          processScope: input.processScope,
          mode: input.mode,
          finalizeReport: input.finalizeReport,
          gateReport,
          finalizeCommand: commandString(input.finalizeCommand),
          rerunCommand: rerunCommand({
            rowsFile: String(input.finalizeReport.rows_file),
            outDir: input.outDir,
            sourceSupportRowsFile: input.sourceSupportRowsFile,
            sourceRowsFile: input.sourceRowsFile,
          }),
          paths: {
            report: relative(input.reportPath),
            runLedger: relative(input.ledgerPath),
            finalizeReport: relative(input.finalizeReportPath),
            sourceSupportRowsFile: relative(input.sourceSupportRowsFile),
            sourceRowsFile: relative(input.sourceRowsFile),
          },
        });
      },
      readGate: (finalizeReport) => {
        const gatePath = adapter.path.resolve(
          (finalizeReport.files as JsonRecord | undefined)?.curation_gate_report,
        );
        return gatePath && adapter.fs.exists(gatePath) ? adapter.fs.readJson(gatePath) : null;
      },
    },
    handoff: {
      appendVerifiedSupportIdentities: () => state.events.push("support-cache:append"),
      applySummary: (input) => applyBafuProcessScopeHandoffSummary(input),
      execute: (input) => {
        state.events.push(`handoff:${input.label}:${relative(input.handoffPlanPath)}`);
        if (!state.handoffResult) throw new Error(`missing ${input.label} handoff fixture result`);
        return state.handoffResult;
      },
      loadVerifiedSupportIdentities: () => new Set(),
      readPlan: (finalizeReport, key) => {
        const handoffPlanPath = adapter.path.resolve(
          (finalizeReport.files as JsonRecord | undefined)?.[key],
        );
        return {
          path: handoffPlanPath,
          value: handoffPlanPath ? (state.json.get(handoffPlanPath) ?? null) : null,
        };
      },
      supportIdentityKeys: () => [],
    },
    recovery: {
      canRunIdentity: () => false,
      canRunSemantic: () => false,
      runIdentity: () => {
        throw new Error("identity recovery was not expected");
      },
      runSemantic: () => {
        throw new Error("semantic recovery was not expected");
      },
    },
    report: {
      commandString,
      rerunCommand,
      writeJson: (filePath, value) => {
        state.json.set(filePath, value);
        state.bytes.set(filePath, prettyBytes(value));
        state.events.push(`report:${relative(filePath)}`);
      },
    },
  };

  const run = createBafuProcessScopeRun({
    commandName: "dataset-bafu-process-scope-e2e",
    reportFileName: "bafu-process-scope-e2e-report.json",
    ledgerFileName: "bafu-process-scope-e2e-ledger.jsonl",
    adapter,
  }).run;
  return { adapter, state, run };
}

function commonOptions(overrides: JsonRecord = {}): JsonRecord {
  return {
    rowsFile,
    sourceSupportRowsFile: supportRowsFile,
    sourceRowsFile,
    outDir,
    ...overrides,
  };
}

test("new scope plan freezes all input hashes, finalize argv, report and ledger bytes", () => {
  const { run, state } = makeFixture();
  const report = run(commonOptions());
  const finalizeCommand = [
    "/usr/bin/node",
    "scripts/foundry.ts",
    "dataset-post-authoring-finalize",
    "--type",
    "process",
    "--profile",
    "bafu",
    "--rows-file",
    "input/process.jsonl",
    "--out-dir",
    "run/finalize",
    "--ledger-dir",
    "run/import-ledger",
    "--source-support-rows-file",
    "input/support.jsonl",
    "--source-rows-file",
    "input/source-process.jsonl",
  ];
  const expectedReport = {
    schema_version: 1,
    generated_at_utc: fixedNow,
    command: "dataset-bafu-process-scope-e2e",
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
    counts: { blockers: 0 },
    blockers: [],
    commands: { post_authoring_finalize: finalizeCommand.join(" ") },
    inputs: {
      rows_file: "input/process.jsonl",
      source_support_rows_file: "input/support.jsonl",
      source_rows_file: "input/source-process.jsonl",
    },
    files: {
      report: "run/bafu-process-scope-e2e-report.json",
      run_ledger: "run/bafu-process-scope-e2e-ledger.jsonl",
      expected_finalize_report: "run/finalize/dataset-post-authoring-finalize-report.json",
      import_ledger_dir: "run/import-ledger",
    },
    resume: {
      rerun_command:
        "node scripts/foundry.ts dataset-bafu-process-scope-e2e --rows-file input/process.jsonl --out-dir run --execute --source-support-rows-file input/support.jsonl --source-rows-file input/source-process.jsonl",
    },
  };
  const expectedLedger = [
    {
      schema_version: 1,
      generated_at_utc: fixedNow,
      command: "dataset-bafu-process-scope-e2e",
      stage: "plan",
      state: "planned",
      process_scope: processScope,
      input_hashes: inputHashes,
      files: {
        report: "run/bafu-process-scope-e2e-report.json",
        expected_finalize_report: "run/finalize/dataset-post-authoring-finalize-report.json",
      },
    },
  ];

  assert.deepEqual(report, expectedReport);
  expectJsonArtifact(state, reportPath, expectedReport);
  expectLedgerArtifact(state, ledgerPath, expectedLedger);
  assert.deepEqual(
    state.events.filter((event) => event.startsWith("stage:")),
    [],
  );
});

test("matching ledger checkpoint wins over a newer mismatched row and explicit finalize report", () => {
  const { run, state } = makeFixture();
  const matchingReportPath = "/fixture/checkpoints/matching/finalize.json";
  const mismatchedReportPath = "/fixture/checkpoints/mismatched/finalize.json";
  const explicitReportPath = "/fixture/explicit/finalize.json";
  const matching = blockedFinalizeReport(matchingReportPath);
  const mismatched = readyFinalizeReport(mismatchedReportPath);
  const explicit = readyFinalizeReport(explicitReportPath);
  state.json.set(matchingReportPath, matching.report);
  state.json.set(matching.gatePath, {
    schema_version: 2,
    status: "blocked_needs_foundry_ai_authoring",
    counts: {
      action_items: 1,
      identity_action_items: 0,
      semantic_action_items: 1,
      classification_queue_action_items: 0,
      location_queue_action_items: 0,
      deterministic_cleanup_items: 0,
    },
    entities: [{ entity_id: processScope.id, action_item_count: 1 }],
  });
  state.json.set(mismatchedReportPath, mismatched.report);
  state.json.set(mismatched.gatePath, { schema_version: 2, status: "ready", counts: {} });
  state.json.set(explicitReportPath, explicit.report);
  state.json.set(explicit.gatePath, { schema_version: 2, status: "ready", counts: {} });
  const checkpointRows: JsonRecord[] = [
    {
      schema_version: 1,
      stage: "post_authoring_finalize",
      input_hashes: inputHashes,
      files: { finalize_report: relative(matchingReportPath) },
    },
    {
      schema_version: 1,
      stage: "post_authoring_finalize",
      input_hashes: { ...inputHashes, rows_file_sha256: "different-rows" },
      files: { finalize_report: relative(mismatchedReportPath) },
    },
  ];
  state.ledgers.set(ledgerPath, checkpointRows);
  state.bytes.set(ledgerPath, ledgerBytes(checkpointRows));

  const report = run(commonOptions({ finalizeReport: explicitReportPath }));
  assert.equal(report.status, "blocked_unresolved_ai_curation");
  assert.equal((report.files as JsonRecord).finalize_report, relative(matchingReportPath));
  assert.equal((report.resume as JsonRecord).reused_existing_finalize_report, true);
  assert.equal(state.reads.includes(matchingReportPath), true);
  assert.equal(state.reads.includes(explicitReportPath), false);
  assert.equal(state.reads.includes(mismatchedReportPath), false);
  const appended = state.ledgers.get(ledgerPath)!;
  assert.deepEqual(appended.at(-1)?.input_hashes, inputHashes);
  assert.equal(appended.at(-1)?.stage, "resume");
  expectJsonArtifact(state, reportPath, report);
  expectLedgerArtifact(state, ledgerPath, appended);
});

test("execute blocks with exact failure artifact when finalize exits without a report", () => {
  const { run, state } = makeFixture();
  state.finalizeResults.push({
    result: { status: 9, error: new Error("fixture finalize failed") },
    stdoutLog: "",
    stderrLog: "",
  });

  const report = run(commonOptions({ execute: true }));
  const expectedReport = {
    schema_version: 1,
    generated_at_utc: fixedNow,
    command: "dataset-bafu-process-scope-e2e",
    status: "failed",
    profile: "bafu",
    process_scope: processScope,
    counts: { blockers: 1 },
    blockers: [
      {
        code: "post_authoring_finalize_failed_without_report",
        severity: "error",
        message: "Existing Foundry finalize command failed before writing its report.",
        exit_code: 9,
        error: "fixture finalize failed",
      },
    ],
    commands: {
      post_authoring_finalize:
        "/usr/bin/node scripts/foundry.ts dataset-post-authoring-finalize --type process --profile bafu --rows-file input/process.jsonl --out-dir run/finalize --ledger-dir run/import-ledger --source-support-rows-file input/support.jsonl --source-rows-file input/source-process.jsonl",
    },
    files: {
      report: "run/bafu-process-scope-e2e-report.json",
      run_ledger: "run/bafu-process-scope-e2e-ledger.jsonl",
      stdout_log: "run/logs/post-authoring-finalize.stdout.log",
      stderr_log: "run/logs/post-authoring-finalize.stderr.log",
    },
  };
  const expectedLedger = [
    {
      schema_version: 1,
      generated_at_utc: fixedNow,
      command: "dataset-bafu-process-scope-e2e",
      stage: "post_authoring_finalize",
      state: "failed",
      process_scope: processScope,
      input_hashes: inputHashes,
      exit_code: 9,
      files: expectedReport.files,
      blockers: expectedReport.blockers,
    },
  ];
  assert.deepEqual(report, expectedReport);
  assert.match(
    state.events.find((event) => event.startsWith("stage:"))!,
    /--rows-file/u,
  );
  expectJsonArtifact(state, reportPath, expectedReport);
  expectLedgerArtifact(state, ledgerPath, expectedLedger);
});

test("finalize-ready execute with commit=false keeps the exact handoff ready report read-only", () => {
  const { run, state } = makeFixture();
  const ready = readyFinalizeReport();
  state.json.set(ready.gatePath, { schema_version: 2, status: "ready", counts: {} });
  state.finalizeResults.push({
    result: { status: 0 },
    stdoutLog: "",
    stderrLog: "",
  });
  state.beforeFinalize = () => {
    state.json.set(finalizeReportPath, ready.report);
  };
  state.events.push("fixture:finalize-ready");

  const report = run(commonOptions({ execute: true, commit: false }));
  assert.equal(report.status, "ready_for_explicit_commit");
  assert.equal((report.policy as JsonRecord).remote_commit_executed, false);
  assert.deepEqual(
    state.events.filter((event) => event.startsWith("handoff:")),
    [],
  );
  assert.equal(state.events.filter((event) => event.startsWith("stage:")).length, 1);
  const ledgerRows = state.ledgers.get(ledgerPath)!;
  assert.deepEqual(ledgerRows.at(-1)?.input_hashes, inputHashes);
  assert.equal(ledgerRows.at(-1)?.exit_code, 0);
  expectJsonArtifact(state, reportPath, report);
  expectLedgerArtifact(state, ledgerPath, ledgerRows);
});

test("handoff-ready commit preserves finalize then handoff stage order and terminal bytes", () => {
  const { run, state } = makeFixture();
  const ready = readyFinalizeReport();
  const handoffPlanPath = "/fixture/run/finalize/dataset-commit-handoff-plan.json";
  state.json.set(ready.gatePath, { schema_version: 2, status: "ready", counts: {} });
  state.json.set(handoffPlanPath, { schema_version: 1, commands: {} });
  state.finalizeResults.push({
    result: { status: 0 },
    stdoutLog: "",
    stderrLog: "",
  });
  state.beforeFinalize = () => {
    state.json.set(finalizeReportPath, ready.report);
  };
  state.handoffResult = {
    status: "completed",
    stages: [
      { stage: "process.commit", exit_code: 0 },
      { stage: "process.verify", exit_code: 0 },
    ],
    blockers: [],
    commitReportPath: "/fixture/run/process-handoff/commit.json",
    verifyReportPath: "/fixture/run/process-handoff/verify.json",
    closeoutReportPath: "/fixture/run/process-handoff/closeout.json",
  };

  const report = run(commonOptions({ execute: true, commit: true }));
  assert.equal(report.status, "completed");
  assert.equal((report.policy as JsonRecord).remote_commit_executed, true);
  assert.deepEqual(
    (report.handoff_stages as JsonRecord[]).map((stage) => stage.stage),
    ["process.commit", "process.verify"],
  );
  assert.deepEqual(
    state.events.filter((event) => event.startsWith("stage:") || event.startsWith("handoff:")),
    [
      "stage:post-authoring-finalize:/usr/bin/node scripts/foundry.ts dataset-post-authoring-finalize --type process --profile bafu --rows-file input/process.jsonl --out-dir run/finalize --ledger-dir run/import-ledger --source-support-rows-file input/support.jsonl --source-rows-file input/source-process.jsonl",
      "handoff:process:run/finalize/dataset-commit-handoff-plan.json",
    ],
  );
  assert.equal(
    (report.files as JsonRecord).process_commit_report,
    "run/process-handoff/commit.json",
  );
  assert.equal(
    (report.files as JsonRecord).process_post_write_verify_report,
    "run/process-handoff/verify.json",
  );
  assert.equal(
    (report.files as JsonRecord).process_closeout_report,
    "run/process-handoff/closeout.json",
  );
  const ledgerRows = state.ledgers.get(ledgerPath)!;
  expectJsonArtifact(state, reportPath, report);
  expectLedgerArtifact(state, ledgerPath, ledgerRows);
});

test("process owner and extracted semantic modules stay within their architecture budgets", () => {
  // The static module-budget suite owns the shared ratchet. This focused contract makes the
  // process-scope extraction's terminal target explicit at the behavior boundary.
  const ownerSource = fileURLToPath(
    new URL("../../scripts/commands/bafu-process-scope-e2e.ts", import.meta.url),
  );
  const runSource = fileURLToPath(
    new URL("../../scripts/lib/bafu-orchestration/process-scope-run.ts", import.meta.url),
  );
  const lineCount = (filePath: string): number =>
    fs.readFileSync(filePath, "utf8").trimEnd().split(/\r?\n/u).length;
  assert.ok(lineCount(ownerSource) <= 500, `owner LOC=${lineCount(ownerSource)} exceeds 500`);
  assert.ok(lineCount(runSource) <= 800, `run LOC=${lineCount(runSource)} exceeds 800`);
});

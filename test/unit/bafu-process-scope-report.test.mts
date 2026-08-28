import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { bafuProcessScopeE2eTestHooks } from "../../scripts/commands/bafu-process-scope-e2e.ts";
import {
  applyBafuProcessScopeHandoffSummary,
  compactCommandStage,
  projectBafuProcessScopeFinalizeReport,
  type BafuProcessScopeFinalizeReport,
  type BafuProcessScopeFinalizeReportInput,
} from "../../scripts/lib/bafu-orchestration/process-scope-report.ts";

type JsonRecord = Record<string, unknown>;

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, "..", "..");
const modulePath = path.join(
  repoRoot,
  "scripts",
  "lib",
  "bafu-orchestration",
  "process-scope-report.ts",
);
const ownerPath = path.join(repoRoot, "scripts", "commands", "bafu-process-scope-e2e.ts");

function sha256Text(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function assertFrozen(
  name: string,
  value: unknown,
  expected: { bytes: number; sha256: string },
): void {
  const serialized = JSON.stringify(value);
  assert.equal(Buffer.byteLength(serialized), expected.bytes, `${name}: byte count`);
  assert.equal(sha256Text(serialized), expected.sha256, `${name}: sha256`);
}

function baseInput(): Omit<BafuProcessScopeFinalizeReportInput, "finalizeReport" | "gateReport"> {
  return {
    generatedAtUtc: "2026-01-02T03:04:05.000Z",
    processScope: {
      dataset_type: "process",
      id: "11111111-2222-4333-8444-555555555555",
      version: "00.00.001",
    },
    mode: "execute",
    finalizeCommand:
      "node scripts/foundry.ts dataset-post-authoring-finalize --rows-file tmp/process.jsonl",
    rerunCommand:
      "node scripts/foundry.ts dataset-bafu-process-scope-e2e --rows-file tmp/process.jsonl --execute",
    paths: {
      report: "tmp/run/bafu-process-scope-e2e-report.json",
      runLedger: "tmp/run/bafu-process-scope-e2e-ledger.jsonl",
      finalizeReport: "tmp/run/finalize/dataset-post-authoring-finalize-report.json",
      sourceSupportRowsFile: "tmp/source/support.jsonl",
      sourceRowsFile: null,
    },
  };
}

function readyReport(): BafuProcessScopeFinalizeReport {
  return projectBafuProcessScopeFinalizeReport({
    ...baseInput(),
    finalizeReport: {
      schema_version: 1,
      status: "ready_for_remote_write",
      rows_file: "tmp/process.jsonl",
      counts: { blockers: 0, commit_handoff_blockers: 0 },
      files: {
        curation_gate_report: "tmp/run/finalize/curation-gate/report.json",
        mutation_manifest: "tmp/run/finalize/mutation/manifest.json",
        commit_handoff_plan: "tmp/run/finalize/handoff/plan.json",
        import_ledger: "tmp/run/finalize/import-ledger",
      },
      commit_handoff: {
        status: "ready_for_explicit_commit",
        command: "pnpm exec tiangong-lca dataset save-draft --type process",
        post_write_verify_command: "pnpm exec tiangong-lca dataset verify-remote --type process",
      },
      blockers: [],
    },
    gateReport: {
      schema_version: 2,
      status: "ready",
      counts: { action_items: 0, deterministic_cleanup_items: 0 },
      entities: [],
    },
  });
}

function blockedAiReport(): BafuProcessScopeFinalizeReport {
  return projectBafuProcessScopeFinalizeReport({
    ...baseInput(),
    mode: "resume",
    finalizeReport: {
      schema_version: 1,
      status: "blocked",
      rows_file: "tmp/process.jsonl",
      counts: { blockers: 1, commit_handoff_blockers: 2 },
      files: {
        curation_gate_report: "tmp/run/finalize/curation-gate/report.json",
      },
      commit_handoff: {
        status: "blocked",
        command: null,
        post_write_verify_command: null,
        blockers: [{ code: "finalize_not_ready" }],
      },
      blockers: [{ code: "post_authoring_curation_gate_not_ready", scope: "process-a" }],
    },
    gateReport: {
      schema_version: 2,
      status: "blocked_needs_foundry_ai_authoring",
      counts: {
        action_items: 2,
        identity_action_items: 1,
        semantic_action_items: 1,
        classification_queue_action_items: 0,
        location_queue_action_items: 0,
        deterministic_cleanup_items: 0,
      },
      entities: [
        {
          dataset_type: "process",
          entity_id: "process-a",
          action_item_count: 2,
          authoring_package: "tmp/authoring/process-a.json",
        },
      ],
    },
  });
}

test("process-scope report projection is a pure typed leaf reused by the command owner", () => {
  const moduleSource = fs.readFileSync(modulePath, "utf8");
  const ownerSource = fs.readFileSync(ownerPath, "utf8");

  assert.doesNotMatch(
    moduleSource,
    /node:(?:fs|path|process|child_process)|\bprocess\.|\bspawn\b|CommandSpec|\bfetch\s*\(|\bXMLHttpRequest\b|\bAtomics\b/u,
  );
  assert.doesNotMatch(moduleSource, /^let\s+/mu);
  assert.doesNotMatch(moduleSource, /install\w*Runtime|moduleRuntime|runtime\(\)/u);
  assert.match(moduleSource, /export interface BafuProcessScopeFinalizeReportInput\s*\{/u);
  assert.match(ownerSource, /from "\.\.\/lib\/bafu-orchestration\/process-scope-report\.ts"/u);
  assert.doesNotMatch(ownerSource, /function reportFromFinalize\s*\(/u);
  assert.doesNotMatch(ownerSource, /function compactCommandStage\s*\(/u);
  assert.equal(
    bafuProcessScopeE2eTestHooks.projectBafuProcessScopeFinalizeReport,
    projectBafuProcessScopeFinalizeReport,
  );
  assert.equal(
    bafuProcessScopeE2eTestHooks.applyBafuProcessScopeHandoffSummary,
    applyBafuProcessScopeHandoffSummary,
  );
  assert.equal(bafuProcessScopeE2eTestHooks.compactCommandStage, compactCommandStage);
});

test("ready finalize projects exact report bytes, key order, commands, and empty blockers", () => {
  const report = readyReport();

  assert.equal(report.status, "ready_for_explicit_commit");
  assert.deepEqual(report.blockers, []);
  assert.deepEqual(Object.keys(report), [
    "schema_version",
    "generated_at_utc",
    "command",
    "status",
    "mode",
    "profile",
    "process_scope",
    "policy",
    "counts",
    "blockers",
    "commands",
    "inputs",
    "files",
    "resume",
  ]);
  assertFrozen("ready finalize report", report, {
    bytes: 1780,
    sha256: "1af8cbdc0484a1751b002ef0ef2063f2dad18d59732f34889bde94dae03e7055",
  });
});

test("blocked AI finalize keeps gate blockers before synthesized and original finalize blockers", () => {
  const report = blockedAiReport();

  assert.equal(report.status, "blocked_unresolved_ai_curation");
  assert.equal(report.resume.reused_existing_finalize_report, true);
  assert.deepEqual(
    report.blockers.map((blocker: JsonRecord) => blocker.code),
    [
      "unresolved_ai_curation_items",
      "curation_gate_not_ready",
      "post_authoring_finalize_not_ready",
      "commit_handoff_not_ready",
      "post_authoring_curation_gate_not_ready",
    ],
  );
  assertFrozen("blocked AI finalize report", report, {
    bytes: 2651,
    sha256: "57796445216dc146294abf2cd98c3972c68e586ed3074dc07e684738e4f64e27",
  });
});

test("handoff summary prepends execution blockers without disturbing report key order", () => {
  const report = applyBafuProcessScopeHandoffSummary({
    report: blockedAiReport(),
    stages: [
      {
        stage: "support.commit",
        command: "pnpm exec tiangong-lca dataset save-draft --type support",
        exit_code: 1,
        signal: null,
        error: null,
        stdout_log: "tmp/run/logs/support.commit.stdout.log",
        stderr_log: "tmp/run/logs/support.commit.stderr.log",
        report: "tmp/run/support/commit-report.json",
      },
    ],
    blockers: [
      {
        code: "commit_handoff_command_failed",
        message: "CLI commit handoff failed or did not emit the expected commit report.",
      },
    ],
    supportCommitted: false,
    supportReused: false,
  });

  assert.equal(report.status, "failed");
  assert.equal(report.counts.blockers, 6);
  assert.deepEqual(
    report.blockers.map((blocker: JsonRecord) => blocker.code),
    [
      "commit_handoff_command_failed",
      "unresolved_ai_curation_items",
      "curation_gate_not_ready",
      "post_authoring_finalize_not_ready",
      "commit_handoff_not_ready",
      "post_authoring_curation_gate_not_ready",
    ],
  );
  assertFrozen("handoff summary report", report, {
    bytes: 3150,
    sha256: "11ea592220689f432142ab7320cd320c295a4ae3622fe5adf79a7451e49e94aa",
  });
});

test("retry-shaped compact stage preserves null-status failure and retry metadata order", () => {
  const stage = compactCommandStage({
    stage: "process.post_write_verify.retry_2",
    command: "pnpm exec tiangong-lca dataset verify-remote --type process",
    result: {
      status: null,
      signal: "SIGTERM",
      error: new Error("verify timed out"),
    },
    stdoutLog: "tmp/run/logs/process.post_write_verify.retry_2.stdout.log",
    stderrLog: "tmp/run/logs/process.post_write_verify.retry_2.stderr.log",
    report: "tmp/run/process-handoff/remote-verification-report.json",
    attempt: 2,
    maxAttempts: 3,
    retryReason: "lookup_failed",
    retryNextDelayMs: 4000,
  });

  assert.equal(stage.exit_code, 1);
  assert.equal(stage.error, "verify timed out");
  assert.deepEqual(Object.keys(stage), [
    "stage",
    "command",
    "exit_code",
    "signal",
    "error",
    "stdout_log",
    "stderr_log",
    "report",
    "attempt",
    "max_attempts",
    "retry_reason",
    "retry_next_delay_ms",
  ]);
  assertFrozen("retry compact stage", stage, {
    bytes: 477,
    sha256: "8160f99974f38e006e94e6cc3948b7bf324e8cf6e9451e0f9c1359b9f6a48e0a",
  });
});

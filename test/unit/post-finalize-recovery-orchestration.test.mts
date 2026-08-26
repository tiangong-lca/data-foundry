import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  runPostFinalizeIdentityRecovery,
  runPostFinalizeSemanticRecovery,
  type PostFinalizeRecoveryAdapter,
  type PostFinalizeRecoveryArgvStageInput,
  type PostFinalizeRecoveryCommandResult,
} from "../../scripts/lib/bafu-orchestration/post-finalize-recovery.ts";
import { compactCommandStage } from "../../scripts/lib/bafu-orchestration/process-scope-report.ts";

type JsonRecord = Record<string, unknown>;

interface StageFixture {
  status?: number;
  reports?: Array<{ path: string; value: JsonRecord }>;
}

interface RecoveryHarness {
  adapter: PostFinalizeRecoveryAdapter;
  invocations: PostFinalizeRecoveryArgvStageInput[];
}

const fakeRepoRoot = "/repo";
const processExecutable = "/runtime/node";
const foundryEntryPath = "scripts/foundry.ts";
const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, "..", "..");

function isJsonRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function textValue(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string" || typeof value === "number") return String(value).trim();
  if (isJsonRecord(value)) return textValue(value["#text"] ?? value.value ?? value.id);
  return "";
}

function resolveRepoPath(value: unknown): string | null {
  const text = textValue(value);
  if (!text) return null;
  return path.posix.isAbsolute(text) ? text : path.posix.join(fakeRepoRoot, text);
}

function repoRelative(filePath: string | null | undefined): string {
  if (!filePath) return "";
  return path.posix.isAbsolute(filePath)
    ? path.posix.relative(fakeRepoRoot, filePath)
    : filePath.replace(/^\.\//u, "");
}

function shellQuote(value: string): string {
  return /^[A-Za-z0-9_./:=@%+-]+$/u.test(value) ? value : `'${value.replaceAll("'", "'\\''")}'`;
}

function makeHarness({
  initialReports = [],
  stages = {},
}: {
  initialReports?: Array<{ path: string; value: JsonRecord }>;
  stages?: Record<string, StageFixture>;
} = {}): RecoveryHarness {
  const reports = new Map<string, JsonRecord>();
  for (const report of initialReports) reports.set(resolveRepoPath(report.path)!, report.value);
  const invocations: PostFinalizeRecoveryArgvStageInput[] = [];
  const runArgvStage = (
    input: PostFinalizeRecoveryArgvStageInput,
  ): {
    result: PostFinalizeRecoveryCommandResult;
    stdoutLog: string;
    stderrLog: string;
  } => {
    invocations.push({ ...input, argv: [...input.argv] });
    const fixture = stages[input.stage] ?? {};
    for (const report of fixture.reports ?? []) {
      reports.set(resolveRepoPath(report.path)!, report.value);
    }
    return {
      result: {
        status: fixture.status ?? 0,
        signal: null,
        stdout: `${input.stage}:stdout\n`,
        stderr: fixture.status ? `${input.stage}:stderr\n` : "",
      },
      stdoutLog: path.posix.join(input.logDir, `${input.stage}.stdout.log`),
      stderrLog: path.posix.join(input.logDir, `${input.stage}.stderr.log`),
    };
  };
  return {
    invocations,
    adapter: {
      processExecutable,
      foundryEntryPath,
      resolveRepoPath,
      repoRelative,
      fileExists: (filePath) => Boolean(filePath && reports.has(filePath)),
      readJson: (filePath) => reports.get(filePath) ?? {},
      textValue,
      commandString: (argv) => argv.map(shellQuote).join(" "),
      runArgvStage,
      projectCommandStage: ({ stage, command, result, stdoutLog, stderrLog, reportPath }) =>
        compactCommandStage({
          stage,
          command,
          result,
          stdoutLog: repoRelative(stdoutLog),
          stderrLog: repoRelative(stderrLog),
          report: repoRelative(reportPath),
        }),
    },
  };
}

function assertFrozen(
  name: string,
  value: unknown,
  expected: { bytes: number; sha256: string },
): void {
  const serialized = JSON.stringify(value);
  assert.equal(Buffer.byteLength(serialized), expected.bytes, `${name}: byte count`);
  assert.equal(
    createHash("sha256").update(serialized).digest("hex"),
    expected.sha256,
    `${name}: sha256`,
  );
}

test("post-finalize recovery is a bounded typed adapter leaf reused by the process owner", () => {
  const moduleSource = fs.readFileSync(
    path.join(repoRoot, "scripts", "lib", "bafu-orchestration", "post-finalize-recovery.ts"),
    "utf8",
  );
  const ownerSource = fs.readFileSync(
    path.join(repoRoot, "scripts", "commands", "bafu-process-scope-e2e.ts"),
    "utf8",
  );

  assert.ok(moduleSource.split(/\r?\n/u).length - 1 <= 800);
  assert.doesNotMatch(moduleSource, /node:(?:child_process|fs)|\bspawnSync\b|\bprocess\./u);
  assert.doesNotMatch(
    moduleSource,
    /--(?:commit|remote-commit|execute-commit|allow-remote-commit)/u,
  );
  assert.match(moduleSource, /export interface PostFinalizeRecoveryAdapter\s*\{/u);
  assert.match(ownerSource, /from "\.\.\/lib\/bafu-orchestration\/post-finalize-recovery\.ts"/u);
  assert.doesNotMatch(ownerSource, /function runPostFinalizeIdentityRecovery\s*\(/u);
  assert.doesNotMatch(ownerSource, /function runPostFinalizeSemanticRecovery\s*\(/u);
});

test("post-finalize identity recovery preserves task, autofill, and apply argv plus report bytes", () => {
  const gateReport = "run/finalize/curation-gate/dataset-curation-gate-report.json";
  const { adapter, invocations } = makeHarness({
    initialReports: [{ path: gateReport, value: { status: "blocked_needs_foundry_ai_authoring" } }],
    stages: {
      "post-finalize-1.identity-task": {
        reports: [
          {
            path: "run/post-finalize-1-identity-task/identity-decision-task-report.json",
            value: { status: "ready_for_ai_identity_decisions", blockers: [] },
          },
        ],
      },
      "post-finalize-1.identity-autofill": {
        reports: [
          {
            path: "run/post-finalize-1-identity-task/bafu-identity-decisions-autofill-report.json",
            value: { status: "completed_with_manual_review", blockers: [] },
          },
        ],
      },
      "post-finalize-1.identity-apply": {
        reports: [
          {
            path: "run/post-finalize-1-identity-apply/identity-decisions-apply-report.json",
            value: {
              status: "completed",
              files: {
                output_rows: "run/post-finalize-1-identity-apply/processes.identity-applied.jsonl",
              },
            },
          },
        ],
      },
    },
  });
  const result = runPostFinalizeIdentityRecovery(
    {
      finalizeReport: { files: { curation_gate_report: gateReport } },
      currentRowsFile: "/repo/run/processes.cleaned.jsonl",
      outDir: "/repo/run",
      logDir: "/repo/run/logs",
      attempt: 1,
    },
    adapter,
  );

  assert.deepEqual(
    invocations.map(({ stage, argv }) => ({ stage, argv })),
    [
      {
        stage: "post-finalize-1.identity-task",
        argv: [
          processExecutable,
          foundryEntryPath,
          "dataset-identity-decision-task-build",
          "--curation-gate-report",
          gateReport,
          "--out-dir",
          "run/post-finalize-1-identity-task",
          "--shared-context-cache-dir",
          "run/shared-context-cache",
        ],
      },
      {
        stage: "post-finalize-1.identity-autofill",
        argv: [
          processExecutable,
          foundryEntryPath,
          "dataset-bafu-identity-decisions-autofill",
          "--identity-decision-task",
          "run/post-finalize-1-identity-task/identity-decision-task.json",
        ],
      },
      {
        stage: "post-finalize-1.identity-apply",
        argv: [
          processExecutable,
          foundryEntryPath,
          "dataset-identity-decisions-apply",
          "--type",
          "process",
          "--rows-file",
          "run/processes.cleaned.jsonl",
          "--decisions",
          "run/post-finalize-1-identity-task/identity-decisions.jsonl",
          "--out-dir",
          "run/post-finalize-1-identity-apply",
          "--authoring-package-dir",
          "run/post-finalize-1-identity-task/authoring-package-snapshots",
        ],
      },
    ],
  );
  assert.equal(result.status, "completed");
  assert.equal(
    result.rowsFile,
    "/repo/run/post-finalize-1-identity-apply/processes.identity-applied.jsonl",
  );
  assert.deepEqual(
    result.stages?.map((stage) => stage.stage),
    [
      "post-finalize-1.identity-task",
      "post-finalize-1.identity-autofill",
      "post-finalize-1.identity-apply",
    ],
  );
  assertFrozen("identity recovery result", result, {
    bytes: 1847,
    sha256: "0f3eb7174c0b08445bb3291b82f9629ffffc7c45d65d7b653152df49dca8dc86",
  });
});

test("post-finalize semantic recovery preserves task, autofill, collect, and apply argv plus report bytes", () => {
  const gateReport = "run/finalize/curation-gate/dataset-curation-gate-report.json";
  const { adapter, invocations } = makeHarness({
    initialReports: [{ path: gateReport, value: { status: "blocked_needs_foundry_ai_authoring" } }],
    stages: {
      "post-finalize-2.semantic-task": {
        reports: [
          {
            path: "run/post-finalize-2-semantic-task/authoring-task-manifest.json",
            value: { status: "ready_for_ai_authoring_batch", blockers: [] },
          },
        ],
      },
      "post-finalize-2.patch-autofill": {
        reports: [
          {
            path: "run/post-finalize-2-semantic-task/bafu-authoring-patches-autofill-report.json",
            value: { status: "completed", blockers: [] },
          },
        ],
      },
      "post-finalize-2.patch-collect": {
        reports: [
          {
            path: "run/post-finalize-2-semantic-task/authoring-patch-collect-report.json",
            value: {
              status: "ready_for_patch_apply",
              files: { batch_patch: "/repo/run/custom/semantic-patches.batch.json" },
            },
          },
        ],
      },
      "post-finalize-2.patch-apply": {
        reports: [
          {
            path: "run/post-finalize-2-semantic-task/patch-apply/outputs/dataset-patch-apply-report.json",
            value: {
              status: "completed",
              files: {
                patched_rows: "run/post-finalize-2-semantic-task/processes.final.jsonl",
              },
            },
          },
        ],
      },
    },
  });
  const result = runPostFinalizeSemanticRecovery(
    {
      finalizeReport: { files: { curation_gate_report: gateReport } },
      currentRowsFile: "/repo/run/processes.identity-applied.jsonl",
      outDir: "/repo/run",
      logDir: "/repo/run/logs",
      attempt: 2,
    },
    adapter,
  );

  assert.deepEqual(
    invocations.map(({ stage, argv }) => ({ stage, argv })),
    [
      {
        stage: "post-finalize-2.semantic-task",
        argv: [
          processExecutable,
          foundryEntryPath,
          "dataset-authoring-task-build",
          "--curation-gate-report",
          gateReport,
          "--out-dir",
          "run/post-finalize-2-semantic-task",
          "--shared-context-cache-dir",
          "run/shared-context-cache",
        ],
      },
      {
        stage: "post-finalize-2.patch-autofill",
        argv: [
          processExecutable,
          foundryEntryPath,
          "dataset-bafu-authoring-patches-autofill",
          "--task-manifest",
          "run/post-finalize-2-semantic-task/authoring-task-manifest.json",
        ],
      },
      {
        stage: "post-finalize-2.patch-collect",
        argv: [
          processExecutable,
          foundryEntryPath,
          "dataset-authoring-patch-collect",
          "--task-manifest",
          "run/post-finalize-2-semantic-task/authoring-task-manifest.json",
        ],
      },
      {
        stage: "post-finalize-2.patch-apply",
        argv: [
          processExecutable,
          foundryEntryPath,
          "dataset-patch-apply",
          "--input",
          "run/processes.identity-applied.jsonl",
          "--patch",
          "run/custom/semantic-patches.batch.json",
          "--out",
          "run/post-finalize-2-semantic-task/processes.patched.jsonl",
          "--out-dir",
          "run/post-finalize-2-semantic-task/patch-apply",
          "--authoring-package-dir",
          "run/post-finalize-2-semantic-task/authoring-package-snapshots",
          "--require-authoring-package",
          "--require-action-item-closure",
        ],
      },
    ],
  );
  assert.equal(result.status, "completed");
  assert.equal(result.rowsFile, "/repo/run/post-finalize-2-semantic-task/processes.final.jsonl");
  assert.deepEqual(
    result.stages?.map((stage) => stage.stage),
    [
      "post-finalize-2.semantic-task",
      "post-finalize-2.patch-autofill",
      "post-finalize-2.patch-collect",
      "post-finalize-2.patch-apply",
    ],
  );
  assertFrozen("semantic recovery result", result, {
    bytes: 2505,
    sha256: "fd7608883ffedc2571589962255aa49a0d3ff6d0ea6afd07610c78e1e7b772ae",
  });
});

test("post-finalize recovery stops on missing gate and missing stage evidence", () => {
  const missingGateHarness = makeHarness();
  const missingGate = runPostFinalizeIdentityRecovery(
    {
      finalizeReport: {
        files: { curation_gate_report: "run/finalize/missing-curation-gate.json" },
      },
      currentRowsFile: "/repo/run/processes.cleaned.jsonl",
      outDir: "/repo/run",
      logDir: "/repo/run/logs",
      attempt: 3,
    },
    missingGateHarness.adapter,
  );
  assert.deepEqual(missingGateHarness.invocations, []);
  assert.deepEqual(missingGate, {
    status: "blocked",
    blocker: {
      code: "post_finalize_curation_gate_report_missing",
      message: "Post-finalize identity recovery requires a readable curation gate report.",
    },
  });

  const gateReport = "run/finalize/curation-gate/dataset-curation-gate-report.json";
  const missingIdentityTaskHarness = makeHarness({
    initialReports: [{ path: gateReport, value: { status: "blocked_needs_foundry_ai_authoring" } }],
    stages: { "post-finalize-4.identity-task": { status: 9 } },
  });
  const missingIdentityTask = runPostFinalizeIdentityRecovery(
    {
      finalizeReport: { files: { curation_gate_report: gateReport } },
      currentRowsFile: "/repo/run/processes.cleaned.jsonl",
      outDir: "/repo/run",
      logDir: "/repo/run/logs",
      attempt: 4,
    },
    missingIdentityTaskHarness.adapter,
  );
  assert.equal(missingIdentityTaskHarness.invocations.length, 1);
  assert.equal(missingIdentityTask.status, "blocked");
  assert.equal(missingIdentityTask.blocker?.code, "post_finalize_identity_task_report_missing");
  assert.equal(missingIdentityTask.stages?.[0]?.exit_code, 9);
  assertFrozen("missing identity task result", missingIdentityTask, {
    bytes: 535,
    sha256: "4e0a13cf7b80e70b27ce97b0ea0ac7c1a785287d7cd7bfd8852e7e1ada8cd922",
  });

  const missingCollectHarness = makeHarness({
    initialReports: [{ path: gateReport, value: { status: "blocked_needs_foundry_ai_authoring" } }],
    stages: {
      "post-finalize-5.semantic-task": {
        reports: [
          {
            path: "run/post-finalize-5-semantic-task/authoring-task-manifest.json",
            value: { status: "ready_for_ai_authoring_batch" },
          },
        ],
      },
      "post-finalize-5.patch-autofill": {
        reports: [
          {
            path: "run/post-finalize-5-semantic-task/bafu-authoring-patches-autofill-report.json",
            value: { status: "completed_no_supported_patches" },
          },
        ],
      },
      "post-finalize-5.patch-collect": { status: 7 },
    },
  });
  const missingCollect = runPostFinalizeSemanticRecovery(
    {
      finalizeReport: { files: { curation_gate_report: gateReport } },
      currentRowsFile: "/repo/run/processes.cleaned.jsonl",
      outDir: "/repo/run",
      logDir: "/repo/run/logs",
      attempt: 5,
    },
    missingCollectHarness.adapter,
  );
  assert.deepEqual(
    missingCollectHarness.invocations.map((invocation) => invocation.stage),
    [
      "post-finalize-5.semantic-task",
      "post-finalize-5.patch-autofill",
      "post-finalize-5.patch-collect",
    ],
  );
  assert.equal(missingCollect.status, "blocked");
  assert.equal(missingCollect.blocker?.code, "post_finalize_semantic_patch_collect_report_missing");
  assert.equal(missingCollect.stages?.[2]?.exit_code, 7);
  assertFrozen("missing semantic collect result", missingCollect, {
    bytes: 1638,
    sha256: "39a69cc838734b824d92949a45d802d1fb2fd48aead285cb1c82f420cf8eb61b",
  });
});

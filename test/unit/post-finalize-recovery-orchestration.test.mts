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
  status?: number | null;
  error?: Error;
  signal?: string | null;
  reports?: Array<{ path: string; value: JsonRecord }>;
}

interface RecoveryHarness {
  adapter: PostFinalizeRecoveryAdapter;
  invocations: PostFinalizeRecoveryArgvStageInput[];
}

const fakeRepoRoot = path.join(path.sep, "repo");
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
  return path.isAbsolute(text) ? text : path.join(fakeRepoRoot, text);
}

function repoRelative(filePath: string | null | undefined): string {
  if (!filePath) return "";
  return (path.isAbsolute(filePath) ? path.relative(fakeRepoRoot, filePath) : filePath)
    .replaceAll("\\", "/")
    .replace(/^\.\//u, "");
}

function repoPath(...parts: string[]): string {
  return path.join(fakeRepoRoot, ...parts);
}

function portableValue(value: unknown): unknown {
  if (typeof value === "string") return value.replaceAll("\\", "/");
  if (Array.isArray(value)) return value.map(portableValue);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, portableValue(child)]),
    );
  }
  return value;
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
        status: fixture.status === undefined ? 0 : fixture.status,
        signal: fixture.signal ?? null,
        error: fixture.error,
        stdout: `${input.stage}:stdout\n`,
        stderr: fixture.status || fixture.error ? `${input.stage}:stderr\n` : "",
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
  const serialized = JSON.stringify(portableValue(value));
  assert.equal(Buffer.byteLength(serialized), expected.bytes, `${name}: byte count`);
  assert.equal(
    createHash("sha256").update(serialized).digest("hex"),
    expected.sha256,
    `${name}: sha256`,
  );
}

function commandAuthority(argv: string[]): JsonRecord {
  return {
    executable: argv[0],
    argv: argv.slice(1),
    display: argv.map(shellQuote).join(" "),
  };
}

function assertProjectedAuthorities(
  result: JsonRecord,
  invocations: PostFinalizeRecoveryArgvStageInput[],
): void {
  const stages = Array.isArray(result.stages)
    ? result.stages.map((stage) => stage as JsonRecord)
    : [];
  assert.equal(stages.length, invocations.length);
  for (const invocation of invocations) {
    const projection = stages.find((stage) => stage.stage === invocation.stage);
    assert.ok(projection, invocation.stage);
    assert.deepEqual(projection.command, commandAuthority(invocation.argv), invocation.stage);
  }
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
  assert.equal(moduleSource.match(/adapter\.runArgvStage\(/gu)?.length, 1);
  assert.equal(moduleSource.match(/adapter\.projectCommandStage\(/gu)?.length, 1);
  assert.equal(moduleSource.match(/adapter\.commandString\(/gu)?.length, 1);
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
      currentRowsFile: repoPath("run", "processes.cleaned.jsonl"),
      outDir: repoPath("run"),
      logDir: repoPath("run", "logs"),
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
  assertProjectedAuthorities(result, invocations);
  assert.equal(result.status, "completed");
  assert.equal(
    result.rowsFile,
    repoPath("run", "post-finalize-1-identity-apply", "processes.identity-applied.jsonl"),
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
    bytes: 2789,
    sha256: "5017d130a26200a8c8715d0d4c8298e17fbc109d6cb468f4b0b8f166cae952d9",
  });
});

test("post-finalize identity recovery projects exact authority for nonzero thrown and missing reports", () => {
  const gateReport = "run/finalize/curation-gate/dataset-curation-gate-report.json";
  const reportPath = "run/post-finalize-6-identity-task/identity-decision-task-report.json";
  const cases: Array<{
    name: string;
    fixture: StageFixture;
    blocker: string;
    exitCode: number;
    error: string | null;
  }> = [
    {
      name: "missing-report",
      fixture: {},
      blocker: "post_finalize_identity_task_report_missing",
      exitCode: 0,
      error: null,
    },
    {
      name: "nonzero-exit",
      fixture: {
        status: 9,
        reports: [{ path: reportPath, value: { status: "execution_failed" } }],
      },
      blocker: "post_finalize_identity_task_not_ready",
      exitCode: 9,
      error: null,
    },
    {
      name: "thrown-execution",
      fixture: {
        status: null,
        error: new Error("identity task spawn failed"),
        reports: [{ path: reportPath, value: { status: "execution_failed" } }],
      },
      blocker: "post_finalize_identity_task_not_ready",
      exitCode: 1,
      error: "identity task spawn failed",
    },
  ];

  for (const current of cases) {
    const harness = makeHarness({
      initialReports: [
        { path: gateReport, value: { status: "blocked_needs_foundry_ai_authoring" } },
      ],
      stages: { "post-finalize-6.identity-task": current.fixture },
    });
    const result = runPostFinalizeIdentityRecovery(
      {
        finalizeReport: { files: { curation_gate_report: gateReport } },
        currentRowsFile: repoPath("run", "processes.cleaned.jsonl"),
        outDir: repoPath("run"),
        logDir: repoPath("run", "logs"),
        attempt: 6,
      },
      harness.adapter,
    );

    assert.equal(result.status, "blocked", current.name);
    assert.equal(result.blocker?.code, current.blocker, current.name);
    assertProjectedAuthorities(result, harness.invocations);
    assert.equal(result.stages?.[0]?.exit_code, current.exitCode, current.name);
    assert.equal(result.stages?.[0]?.error, current.error, current.name);
  }
});

test("post-finalize recovery rejects projected argv drift before the next stage", () => {
  const gateReport = "run/finalize/curation-gate/dataset-curation-gate-report.json";
  const harness = makeHarness({
    initialReports: [{ path: gateReport, value: { status: "blocked_needs_foundry_ai_authoring" } }],
    stages: {
      "post-finalize-7.identity-task": {
        reports: [
          {
            path: "run/post-finalize-7-identity-task/identity-decision-task-report.json",
            value: { status: "ready_for_ai_identity_decisions" },
          },
        ],
      },
    },
  });
  const projectCommandStage = harness.adapter.projectCommandStage;
  harness.adapter.projectCommandStage = (input) => ({
    ...projectCommandStage(input),
    command: { ...input.command, argv: input.command.argv.slice(0, -2) },
  });

  assert.throws(
    () =>
      runPostFinalizeIdentityRecovery(
        {
          finalizeReport: { files: { curation_gate_report: gateReport } },
          currentRowsFile: repoPath("run", "processes.cleaned.jsonl"),
          outDir: repoPath("run"),
          logDir: repoPath("run", "logs"),
          attempt: 7,
        },
        harness.adapter,
      ),
    /projected command authority drift/u,
  );
  assert.deepEqual(
    harness.invocations.map((invocation) => invocation.stage),
    ["post-finalize-7.identity-task"],
  );
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
              files: {
                batch_patch: repoPath("run", "custom", "semantic-patches.batch.json"),
              },
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
      currentRowsFile: repoPath("run", "processes.identity-applied.jsonl"),
      outDir: repoPath("run"),
      logDir: repoPath("run", "logs"),
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
  assertProjectedAuthorities(result, invocations);
  assert.equal(result.status, "completed");
  assert.equal(
    result.rowsFile,
    repoPath("run", "post-finalize-2-semantic-task", "processes.final.jsonl"),
  );
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
    bytes: 3656,
    sha256: "0fee15a233f454521e3ee26a8144bef75191b39a42253dffecbc083eb3d8dc59",
  });
});

test("post-finalize recovery stops on missing gate and missing stage evidence", () => {
  const missingGateHarness = makeHarness();
  const missingGate = runPostFinalizeIdentityRecovery(
    {
      finalizeReport: {
        files: { curation_gate_report: "run/finalize/missing-curation-gate.json" },
      },
      currentRowsFile: repoPath("run", "processes.cleaned.jsonl"),
      outDir: repoPath("run"),
      logDir: repoPath("run", "logs"),
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
      currentRowsFile: repoPath("run", "processes.cleaned.jsonl"),
      outDir: repoPath("run"),
      logDir: repoPath("run", "logs"),
      attempt: 4,
    },
    missingIdentityTaskHarness.adapter,
  );
  assert.equal(missingIdentityTaskHarness.invocations.length, 1);
  assert.equal(missingIdentityTask.status, "blocked");
  assert.equal(missingIdentityTask.blocker?.code, "post_finalize_identity_task_report_missing");
  assert.equal(missingIdentityTask.stages?.[0]?.exit_code, 9);
  assertProjectedAuthorities(missingIdentityTask, missingIdentityTaskHarness.invocations);
  assertFrozen("missing identity task result", missingIdentityTask, {
    bytes: 1017,
    sha256: "b77a5339e3684f7604f577730d952d62cfd762f5b5230fc4148a5789cf554478",
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
      currentRowsFile: repoPath("run", "processes.cleaned.jsonl"),
      outDir: repoPath("run"),
      logDir: repoPath("run", "logs"),
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
  assertProjectedAuthorities(missingCollect, missingCollectHarness.invocations);
  assertFrozen("missing semantic collect result", missingCollect, {
    bytes: 2316,
    sha256: "a46b70f9f4457af14b3895ad5a8424dcf390313d636963941de887ec9fd0deff",
  });
});

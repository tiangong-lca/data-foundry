import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import type {
  FoundryArtifactFact,
  FoundryCommandSpec,
} from "../../scripts/lib/foundry-command-spec.ts";
import {
  closeoutCommand,
  commitReportForHandoffPlan,
  executeHandoff,
  readHandoffPlan,
  verifyReportForHandoffPlan,
  type ProcessHandoffAdapter,
  type ProcessHandoffCommandResult,
} from "../../scripts/lib/bafu-orchestration/process-handoff.ts";

type JsonRecord = Record<string, unknown>;

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, "..", "..");
const ownerPath = path.join(repoRoot, "scripts", "commands", "bafu-process-scope-e2e.ts");
const modulePath = path.join(
  repoRoot,
  "scripts",
  "lib",
  "bafu-orchestration",
  "process-handoff.ts",
);
const artifactSha = "0123456789abcdef".repeat(4);

type VerifyAttempt = {
  status: number;
  report?: JsonRecord;
  reportPath?: string;
};

type HarnessOptions = {
  commitStatus?: number;
  commitReport?: JsonRecord | null;
  verifyAttempts?: VerifyAttempt[];
  closeoutStatus?: number;
  closeoutReport?: JsonRecord | null;
  allowTraceHashNormalization?: boolean;
  acceptTraceHashDifference?: boolean;
};

function commandSpec(label: string): FoundryCommandSpec {
  return {
    schema: "tiangong-foundry.command-spec.v1",
    executable: "/cli",
    argv: ["dataset", label, "--input", "rows/final.jsonl"],
    display: `/cli dataset ${label} --input rows/final.jsonl`,
    binding: {
      artifacts: [
        {
          role: "final_rows",
          path: "rows/final.jsonl",
          bytes: 37,
          sha256: artifactSha,
        },
      ],
    },
    sha256: label === "save-draft" ? "a".repeat(64) : "b".repeat(64),
  };
}

function stageProjection(input: {
  stage: string;
  command: unknown;
  result: ProcessHandoffCommandResult;
  stdoutLog: string;
  stderrLog: string;
  reportPath: string | null;
}): JsonRecord {
  return {
    stage: input.stage,
    command: input.command,
    exit_code: typeof input.result.status === "number" ? input.result.status : 1,
    signal: input.result.signal ?? null,
    error: input.result.error ? String(input.result.error.message) : null,
    stdout_log: input.stdoutLog.replace(/^\/repo\//u, ""),
    stderr_log: input.stderrLog.replace(/^\/repo\//u, ""),
    report: input.reportPath?.replace(/^\/repo\//u, "") ?? null,
  };
}

function createHarness(options: HarnessOptions = {}): {
  adapter: ProcessHandoffAdapter;
  events: string[];
  files: Map<string, unknown>;
  handoffPlan: JsonRecord;
  handoffPlanPath: string;
  sleeps: number[];
} {
  const files = new Map<string, unknown>();
  const events: string[] = [];
  const sleeps: number[] = [];
  const handoffPlanPath = "/repo/handoff/dataset-commit-handoff-plan.json";
  const commitReportPath =
    "/repo/out/commit/process-save-draft/outputs/save-draft-rpc/summary.json";
  const canonicalVerifyReportPath = "/repo/out/verify/outputs/remote-verification-report.json";
  const handoffPlan: JsonRecord = {
    schema_version: 1,
    status: "ready_for_explicit_commit",
    account_mode: "ordinary",
    final_rows_artifact: {
      path: "rows/final.jsonl",
      bytes: 37,
      sha256: artifactSha,
    },
    commands: {
      commit: commandSpec("save-draft"),
      post_write_verify: commandSpec("verify-remote"),
    },
    files: {
      expected_commit_report_dir: "out/commit",
      expected_post_write_verify_dir: "out/verify",
    },
  };
  files.set(handoffPlanPath, handoffPlan);
  files.set("/repo/finalize/report.json", {
    files: { commit_handoff_plan: "handoff/dataset-commit-handoff-plan.json" },
  });

  let verifyIndex = 0;
  const adapter: ProcessHandoffAdapter = {
    processExecutable: "/node",
    foundryEntryPath: "scripts/foundry.ts",
    repoRoot: "/repo",
    environment: {},
    resolveRepoPath(value) {
      if (typeof value !== "string" || value.length === 0) return null;
      return value.startsWith("/") ? value : path.posix.join("/repo", value);
    },
    repoRelative(filePath) {
      if (!filePath) return null;
      return filePath.replace(/^\/repo\//u, "");
    },
    fileExists(filePath) {
      return Boolean(filePath) && files.has(String(filePath));
    },
    readJson(filePath) {
      const value = files.get(filePath);
      assert.ok(value && typeof value === "object" && !Array.isArray(value), filePath);
      return value as JsonRecord;
    },
    joinPath: (...parts) => path.posix.join(...parts),
    basename: (filePath) => path.posix.basename(filePath),
    listFilesRecursively(rootDir) {
      if (!rootDir) return [];
      const prefix = rootDir.endsWith("/") ? rootDir : `${rootDir}/`;
      return [...files.keys()].filter((filePath) => filePath.startsWith(prefix)).sort();
    },
    assertReceiptBoundHandoffAccount() {
      events.push("account");
    },
    assertCommandSpecBindsArtifact(value, requiredArtifact: FoundryArtifactFact) {
      const spec = value as FoundryCommandSpec;
      assert.deepEqual(requiredArtifact, {
        role: "final_rows",
        path: "rows/final.jsonl",
        bytes: 37,
        sha256: artifactSha,
      });
      events.push(`bind:${spec.argv[1]}`);
      return spec;
    },
    assertCommandSpecArtifactsCurrent(spec) {
      events.push(`artifact:${spec.argv[1]}`);
    },
    runCommandSpecStage({ stage, commandSpec: spec }) {
      events.push(`spec:${stage}:${spec.argv[1]}`);
      if (stage.endsWith(".commit")) {
        if (options.commitReport !== null) {
          files.set(commitReportPath, options.commitReport ?? { status: "completed" });
        }
        return {
          result: { status: options.commitStatus ?? 0, stdout: "commit\n", stderr: "" },
          stdoutLog: `/repo/logs/${stage}.stdout.log`,
          stderrLog: `/repo/logs/${stage}.stderr.log`,
        };
      }
      const attempt = options.verifyAttempts?.[verifyIndex] ?? {
        status: 0,
        report: { status: "completed" },
      };
      verifyIndex += 1;
      if (attempt.report) {
        files.set(attempt.reportPath ?? canonicalVerifyReportPath, attempt.report);
      }
      return {
        result: { status: attempt.status, stdout: `verify ${verifyIndex}\n`, stderr: "" },
        stdoutLog: `/repo/logs/${stage}.stdout.log`,
        stderrLog: `/repo/logs/${stage}.stderr.log`,
      };
    },
    runArgvStage({ stage, argv }) {
      events.push(`argv:${stage}:${argv.join("\u0000")}`);
      const outDirIndex = argv.indexOf("--out-dir");
      assert.ok(outDirIndex >= 0);
      const closeoutDir = path.posix.join("/repo", argv[outDirIndex + 1]);
      const reportPath = path.posix.join(closeoutDir, "dataset-post-write-closeout-report.json");
      if (options.closeoutReport !== null) {
        files.set(
          reportPath,
          options.closeoutReport ?? { schema_version: 1, status: "completed", blockers: [] },
        );
      }
      return {
        result: { status: options.closeoutStatus ?? 0, stdout: "closeout\n", stderr: "" },
        stdoutLog: `/repo/logs/${stage}.stdout.log`,
        stderrLog: `/repo/logs/${stage}.stderr.log`,
      };
    },
    projectCommandStage: stageProjection,
    commandString(argv) {
      return argv.join(" ");
    },
    retryAttempts: () => 3,
    retryDelayMs: (attemptIndex) => 17 * 2 ** attemptIndex,
    retryReason(verifyReportPath) {
      if (!verifyReportPath) return "verify_report_missing";
      const report = files.get(verifyReportPath) as JsonRecord | undefined;
      const blockers = Array.isArray(report?.blockers) ? report.blockers : [];
      return blockers.some(
        (blocker) =>
          blocker &&
          typeof blocker === "object" &&
          (blocker as JsonRecord).code === "lookup_failed",
      )
        ? "lookup_failed"
        : null;
    },
    sleep(delayMs) {
      sleeps.push(delayMs);
      events.push(`sleep:${delayMs}`);
    },
    traceHashNormalizationAllowed: () => Boolean(options.allowTraceHashNormalization),
    acceptTraceHashOnlyRemoteVerificationMismatch({ verifyReportPath, outDir }) {
      events.push(`accepted-diff:${verifyReportPath}`);
      const acceptedVerifyReportPath = path.posix.join(outDir, "accepted-verify.json");
      const acceptanceReportPath = path.posix.join(outDir, "accepted-difference.json");
      if (!options.acceptTraceHashDifference) {
        return {
          accepted: false,
          verifyReportPath,
          acceptanceReportPath,
          evidence: [],
        };
      }
      files.set(acceptedVerifyReportPath, { status: "completed_accepted_difference" });
      files.set(acceptanceReportPath, { status: "accepted", exact_sha256: artifactSha });
      return {
        accepted: true,
        verifyReportPath: acceptedVerifyReportPath,
        acceptanceReportPath,
        evidence: [{ path: "importTraceSummary.traceHash", sha256: artifactSha }],
      };
    },
  };
  return { adapter, events, files, handoffPlan, handoffPlanPath, sleeps };
}

function runHarness(options: HarnessOptions = {}) {
  const harness = createHarness(options);
  const result = executeHandoff(
    {
      handoffPlanPath: harness.handoffPlanPath,
      ledgerDir: "/repo/ledger",
      outDir: "/repo/run/process-handoff",
      logDir: "/repo/logs",
      label: "process",
    },
    harness.adapter,
  );
  return { ...harness, result };
}

test("process handoff is a typed semantic module and the command owner delegates to it", () => {
  const moduleSource = fs.readFileSync(modulePath, "utf8");
  const ownerSource = fs.readFileSync(ownerPath, "utf8");
  const lineCount = moduleSource.endsWith("\n")
    ? moduleSource.split("\n").length - 1
    : moduleSource.split("\n").length;

  assert.ok(lineCount <= 800, `process handoff module has ${lineCount} lines`);
  assert.doesNotMatch(moduleSource, /node:(?:fs|path|child_process)|\bspawnSync\b|\bAtomics\b/u);
  assert.match(ownerSource, /from "\.\.\/lib\/bafu-orchestration\/process-handoff\.ts"/u);
  for (const functionName of [
    "commitReportForHandoffPlan",
    "verifyReportForHandoffPlan",
    "readHandoffPlan",
    "closeoutCommand",
    "executeHandoff",
  ]) {
    assert.doesNotMatch(ownerSource, new RegExp(`function ${functionName}\\s*\\(`, "u"));
  }
});

test("ready handoff commits once, verifies exact rows, closes out, and preserves report order", () => {
  const { result, events } = runHarness();

  assert.equal(result.status, "completed");
  assert.deepEqual(result.blockers, []);
  assert.equal(
    result.commitReportPath,
    "/repo/out/commit/process-save-draft/outputs/save-draft-rpc/summary.json",
  );
  assert.equal(result.verifyReportPath, "/repo/out/verify/outputs/remote-verification-report.json");
  assert.equal(
    result.closeoutReportPath,
    "/repo/run/process-handoff/closeout/dataset-post-write-closeout-report.json",
  );
  assert.deepEqual(
    result.stages.map((stage) => stage.stage),
    ["process.commit", "process.post_write_verify", "process.closeout"],
  );
  assert.deepEqual(events.slice(0, 6), [
    "account",
    "bind:save-draft",
    "bind:verify-remote",
    "artifact:save-draft",
    "spec:process.commit:save-draft",
    "spec:process.post_write_verify:verify-remote",
  ]);
  assert.equal(events.filter((event) => event === "spec:process.commit:save-draft").length, 1);
  assert.ok(
    (events.at(-1) ?? "").includes(["--post-write-verify-report", "out/verify"].join("\u0000")),
  );
  assert.equal(
    createHash("sha256").update(JSON.stringify(result)).digest("hex"),
    "174fa0f1a891422cf54c55878478e3290c7ad8e71427582a923ebcc911233386",
  );
});

test("commit failure is at-most-once and already-exists evidence is not silently re-executed", () => {
  for (const commitReport of [
    null,
    {
      status: "failed",
      counts: { failed: 1 },
      failures: [
        {
          code: "23505",
          message: "same id and version already exists",
          dataset_id: "process-a",
        },
      ],
    },
  ]) {
    const { result, events } = runHarness({ commitStatus: 1, commitReport });
    assert.equal(result.status, "failed");
    assert.deepEqual(
      result.blockers.map((blocker) => blocker.code),
      ["commit_handoff_command_failed"],
    );
    assert.equal(events.filter((event) => event === "spec:process.commit:save-draft").length, 1);
    assert.equal(
      events.some((event) => event.includes("post_write_verify")),
      false,
    );
    assert.equal(
      events.some((event) => event.startsWith("argv:")),
      false,
    );
  }
});

test("retryable verify readback retries in order and closeout receives the final report", () => {
  const nestedVerifyPath = "/repo/out/verify/z/readback/remote-verification-report.json";
  const { result, events, sleeps } = runHarness({
    verifyAttempts: [
      {
        status: 1,
        report: { status: "failed", blockers: [{ code: "lookup_failed" }] },
        reportPath: nestedVerifyPath,
      },
      { status: 0, report: { status: "completed", blockers: [] }, reportPath: nestedVerifyPath },
    ],
  });

  assert.equal(result.status, "completed");
  assert.equal(result.verifyReportPath, nestedVerifyPath);
  assert.deepEqual(sleeps, [17]);
  assert.deepEqual(
    result.stages.map((stage) => ({
      stage: stage.stage,
      attempt: stage.attempt,
      maxAttempts: stage.max_attempts,
      retryReason: stage.retry_reason,
      retryDelay: stage.retry_next_delay_ms,
    })),
    [
      {
        stage: "process.commit",
        attempt: undefined,
        maxAttempts: undefined,
        retryReason: undefined,
        retryDelay: undefined,
      },
      {
        stage: "process.post_write_verify",
        attempt: 1,
        maxAttempts: 3,
        retryReason: "lookup_failed",
        retryDelay: 17,
      },
      {
        stage: "process.post_write_verify.retry_2",
        attempt: 2,
        maxAttempts: 3,
        retryReason: undefined,
        retryDelay: undefined,
      },
      {
        stage: "process.closeout",
        attempt: undefined,
        maxAttempts: undefined,
        retryReason: undefined,
        retryDelay: undefined,
      },
    ],
  );
  assert.ok(
    (events.at(-1) ?? "").includes(
      ["--post-write-verify-report", "out/verify/z/readback"].join("\u0000"),
    ),
  );
});

test("trace-hash-only accepted difference remains SHA-bound before closeout", () => {
  const { result } = runHarness({
    verifyAttempts: [
      {
        status: 1,
        report: {
          status: "blocked_remote_verification",
          blockers: [{ code: "root_payload_mismatch" }],
          expected_sha256: artifactSha,
        },
      },
    ],
    allowTraceHashNormalization: true,
    acceptTraceHashDifference: true,
  });

  assert.equal(result.status, "completed");
  assert.equal(result.verifyReportPath, "/repo/run/process-handoff/accepted-verify.json");
  assert.deepEqual(result.stages.at(2), {
    stage: "process.post_write_verify.accepted_diff",
    status: "accepted",
    report: "run/process-handoff/accepted-difference.json",
    accepted_differences: 1,
  });
  assert.equal(
    createHash("sha256").update(JSON.stringify(result)).digest("hex"),
    "166ca94a1640015197acfa2e21a262b3a2df16fac772dc1942d1561c2201ff65",
  );
});

test("closeout failure preserves the exact report, blockers, argv, and stage ordering", () => {
  const closeoutReport = {
    schema_version: 1,
    status: "blocked",
    blockers: [{ code: "root_payload_sha256_mismatch", expected_sha256: artifactSha }],
  };
  const { result, events } = runHarness({ closeoutStatus: 1, closeoutReport });

  assert.equal(result.status, "failed");
  assert.equal(result.closeoutReport, closeoutReport);
  assert.deepEqual(result.blockers, [
    {
      code: "post_write_closeout_failed",
      message: "Post-write closeout status is blocked.",
      handoff_plan: "handoff/dataset-commit-handoff-plan.json",
      closeout_report: "run/process-handoff/closeout/dataset-post-write-closeout-report.json",
      closeout_blockers: closeoutReport.blockers,
    },
  ]);
  assert.deepEqual(
    closeoutCommand(
      {
        handoffPlanPath: "/repo/handoff/dataset-commit-handoff-plan.json",
        commitReportPath: "/repo/out/commit/process-save-draft/outputs/save-draft-rpc/summary.json",
        verifyReportPath: "/repo/out/verify/outputs/remote-verification-report.json",
        outDir: "/repo/run/process-handoff/closeout",
        ledgerDir: "/repo/ledger",
      },
      createHarness().adapter,
    ),
    [
      "/node",
      "scripts/foundry.ts",
      "dataset-post-write-closeout",
      "--handoff-plan",
      "handoff/dataset-commit-handoff-plan.json",
      "--commit-report",
      "out/commit/process-save-draft/outputs/save-draft-rpc/summary.json",
      "--post-write-verify-report",
      "out/verify/outputs/remote-verification-report.json",
      "--out-dir",
      "run/process-handoff/closeout",
      "--ledger-dir",
      "ledger",
    ],
  );
  assert.equal(events.filter((event) => event.startsWith("argv:process.closeout:")).length, 1);
});

test("handoff plan and report selection retain canonical and sorted fallback paths", () => {
  const harness = createHarness();
  assert.deepEqual(readHandoffPlan({ files: {} }, "commit_handoff_plan", harness.adapter), {
    path: null,
    value: null,
  });
  assert.deepEqual(
    readHandoffPlan(
      { files: { commit_handoff_plan: "handoff/dataset-commit-handoff-plan.json" } },
      "commit_handoff_plan",
      harness.adapter,
    ),
    { path: harness.handoffPlanPath, value: harness.handoffPlan },
  );

  harness.files.set("/repo/out/commit/z/sync_report.json", { status: "completed" });
  harness.files.set("/repo/out/commit/a/summary.json", { status: "completed" });
  harness.files.set("/repo/out/verify/z/remote-verification-report.json", {
    status: "completed",
  });
  harness.files.set("/repo/out/verify/a/remote-verification-report.json", {
    status: "completed",
  });
  assert.equal(
    commitReportForHandoffPlan(harness.handoffPlan, harness.adapter),
    "/repo/out/commit/a/summary.json",
  );
  assert.equal(
    verifyReportForHandoffPlan(harness.handoffPlan, harness.adapter),
    "/repo/out/verify/a/remote-verification-report.json",
  );
});

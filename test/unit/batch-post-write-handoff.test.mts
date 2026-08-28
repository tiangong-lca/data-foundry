import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import type { FoundryCommandSpec } from "../../scripts/lib/foundry-command-spec.ts";
import {
  createBatchPostWriteHandoffService,
  type BatchPostWriteHandoffAdapter,
  type BatchPostWriteHandoffJsonRecord,
} from "../../scripts/lib/batch-orchestration/post-write-handoff.ts";

type JsonRecord = BatchPostWriteHandoffJsonRecord;

type VerifyAttempt = {
  exitCode: number;
  report?: JsonRecord;
};

type HarnessOptions = {
  commitExitCode?: number;
  commitReportRelativePath?: string;
  commitReport?: JsonRecord | null;
  verifyAttempts?: VerifyAttempt[];
  closeoutExitCode?: number;
  closeoutReport?: JsonRecord | null;
};

const artifactSha = "0123456789abcdef".repeat(4);

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

function createHarness(options: HarnessOptions = {}): {
  adapter: BatchPostWriteHandoffAdapter;
  events: string[];
  files: Map<string, JsonRecord>;
  handoffPlanPath: string;
  sleeps: number[];
} {
  const files = new Map<string, JsonRecord>();
  const events: string[] = [];
  const sleeps: number[] = [];
  const handoffPlanPath = "/repo/handoff/dataset-commit-handoff-plan.json";
  const commitReportPath = path.posix.join(
    "/repo/out/commit",
    options.commitReportRelativePath ?? "process-save-draft/outputs/save-draft-rpc/summary.json",
  );
  const verifyReportPath = "/repo/out/verify/outputs/remote-verification-report.json";
  files.set(handoffPlanPath, {
    status: "ready_for_explicit_commit",
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
  });

  let verifyIndex = 0;
  const adapter: BatchPostWriteHandoffAdapter = {
    processExecutable: "/node",
    foundryEntryPath: "scripts/foundry.ts",
    repoRoot: "/repo",
    environment: {},
    resolveRepoPath(value) {
      if (typeof value !== "string" || value.length === 0) return null;
      return value.startsWith("/") ? value : path.posix.join("/repo", value);
    },
    repoRelative(filePath) {
      return filePath?.replace(/^\/repo\//u, "") ?? null;
    },
    fileExists(filePath) {
      return Boolean(filePath && files.has(filePath));
    },
    readJson(filePath) {
      const value = files.get(filePath);
      assert.ok(value, filePath);
      return value;
    },
    findFiles(rootDir, predicate) {
      const resolved = typeof rootDir === "string" ? rootDir : null;
      if (!resolved) return [];
      const prefix = resolved.endsWith("/") ? resolved : `${resolved}/`;
      return [...files.keys()]
        .filter((filePath) => filePath.startsWith(prefix) && predicate(filePath))
        .sort();
    },
    joinPath: (...parts) => path.posix.join(...parts),
    basename: (filePath) => path.posix.basename(filePath),
    asText: (value) => (value == null ? "" : String(value).trim()),
    integerOption(value, fallback = null) {
      const parsed = Number(value);
      return Number.isInteger(parsed) ? parsed : fallback;
    },
    assertReceiptBoundHandoffAccount() {
      events.push("account");
    },
    assertCommandSpecBindsArtifact(value, artifact) {
      assert.deepEqual(artifact, {
        role: "final_rows",
        path: "rows/final.jsonl",
        bytes: 37,
        sha256: artifactSha,
      });
      return value as FoundryCommandSpec;
    },
    assertCommandSpecArtifactsCurrent(spec) {
      return spec;
    },
    async runStage({ stage, command }) {
      events.push(`${stage}:${command.join(" ")}`);
      if (stage.endsWith(".commit")) {
        if (options.commitReport !== null) {
          files.set(commitReportPath, options.commitReport ?? { status: "completed" });
        }
        return { stage, exit_code: options.commitExitCode ?? 0 };
      }
      if (stage.includes("post_write_verify")) {
        const attempt = options.verifyAttempts?.[verifyIndex] ?? {
          exitCode: 0,
          report: { status: "completed" },
        };
        verifyIndex += 1;
        if (attempt.report) files.set(verifyReportPath, attempt.report);
        else files.delete(verifyReportPath);
        return { stage, exit_code: attempt.exitCode };
      }
      const outDirIndex = command.indexOf("--out-dir");
      assert.ok(outDirIndex >= 0);
      const closeoutReportPath = path.posix.join(
        "/repo",
        command[outDirIndex + 1],
        "dataset-post-write-closeout-report.json",
      );
      if (options.closeoutReport !== null) {
        files.set(
          closeoutReportPath,
          options.closeoutReport ?? { status: "completed", blockers: [] },
        );
      }
      return { stage, exit_code: options.closeoutExitCode ?? 0 };
    },
    async sleep(delayMs) {
      sleeps.push(delayMs);
    },
    traceHashNormalizationAllowed: () => false,
    acceptTraceHashOnlyRemoteVerificationMismatch: () => ({ accepted: false }),
  };
  return { adapter, events, files, handoffPlanPath, sleeps };
}

const sameIdentityFailure = {
  rows: [
    {
      status: "failed",
      error: {
        code: "23505",
        message: "A dataset with the same id and version already exists",
      },
    },
  ],
};

for (const [label, reportPath] of [
  ["process", "process-save-draft/outputs/save-draft-rpc/summary.json"],
  ["support", "support-save-draft/outputs/dataset-save-draft/summary.json"],
  ["flow", "flow-publish-version/outputs/summary.json"],
] as const) {
  test(`batch post-write handoff accepts ${label} same-id/version commit conflicts only after verify`, async () => {
    const harness = createHarness({
      commitExitCode: 1,
      commitReportRelativePath: reportPath,
      commitReport: sameIdentityFailure,
    });
    const service = createBatchPostWriteHandoffService(harness.adapter);
    const result = await service.execute({
      handoffPlanPath: harness.handoffPlanPath,
      ledgerDir: "/repo/ledger",
      outDir: "/repo/handoff",
      logDir: "/repo/logs",
      label,
    });

    assert.equal(result.status, "completed");
    assert.equal(
      result.stages.some((stage) => stage.stage === `${label}.commit.accepted_existing_support`),
      true,
    );
    assert.equal(
      harness.events.some((event) => event.startsWith(`${label}.post_write_verify:`)),
      true,
    );
  });
}

test("batch post-write handoff retries a retryable readback before closeout", async () => {
  const harness = createHarness({
    verifyAttempts: [
      { exitCode: 1, report: { blockers: [{ code: "lookup_failed" }] } },
      { exitCode: 0, report: { status: "completed" } },
    ],
  });
  const result = await createBatchPostWriteHandoffService(harness.adapter).execute({
    handoffPlanPath: harness.handoffPlanPath,
    ledgerDir: "/repo/ledger",
    outDir: "/repo/handoff",
    logDir: "/repo/logs",
    label: "process",
  });

  assert.equal(result.status, "completed");
  assert.deepEqual(harness.sleeps, [2_000]);
  assert.equal(result.stages[1]?.retry_reason, "lookup_failed");
  assert.equal(result.stages[1]?.retry_next_delay_ms, 2_000);
});

test("batch post-write handoff exhausts missing verify reports without closeout", async () => {
  const harness = createHarness({
    verifyAttempts: [{ exitCode: 1 }, { exitCode: 1 }, { exitCode: 1 }],
  });
  const result = await createBatchPostWriteHandoffService(harness.adapter).execute({
    handoffPlanPath: harness.handoffPlanPath,
    ledgerDir: "/repo/ledger",
    outDir: "/repo/handoff",
    logDir: "/repo/logs",
    label: "process",
  });

  assert.equal(result.status, "failed");
  assert.deepEqual(harness.sleeps, [2_000, 4_000]);
  assert.equal(result.blockers[0]?.code, "post_write_verify_command_failed");
  assert.equal(result.blockers[0]?.post_write_verify_attempts, 3);
  assert.equal(result.blockers[0]?.retry_reason, "verify_report_missing");
  assert.equal(
    harness.events.some((event) => event.includes(".closeout:")),
    false,
  );
});

test("batch post-write handoff rejects non-idempotent commit failures before verify", async () => {
  const harness = createHarness({
    commitExitCode: 1,
    commitReport: {
      rows: [{ status: "failed", error: { code: "permission_denied" } }],
    },
  });
  const result = await createBatchPostWriteHandoffService(harness.adapter).execute({
    handoffPlanPath: harness.handoffPlanPath,
    ledgerDir: "/repo/ledger",
    outDir: "/repo/handoff",
    logDir: "/repo/logs",
    label: "support",
  });

  assert.equal(result.status, "failed");
  assert.equal(result.blockers[0]?.code, "commit_handoff_command_failed");
  assert.equal(
    harness.events.some((event) => event.includes("post_write_verify")),
    false,
  );
});

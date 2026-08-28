import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import {
  createBatchScopeFinalizeCommitService,
  type BatchScopeFinalizeCommitAdapter,
  type BatchScopeFinalizeJsonRecord,
} from "../../scripts/lib/batch-orchestration/scope-finalize-commit.ts";
import type { BatchPostWriteHandoffResult } from "../../scripts/lib/batch-orchestration/post-write-handoff.ts";

type JsonRecord = BatchScopeFinalizeJsonRecord;

type FinalizeStep = {
  report: JsonRecord;
  missing?: boolean;
};

type HarnessOptions = {
  finalizeSteps: FinalizeStep[];
  supportKeys?: string[];
  verifiedKeys?: string[];
  staleKeys?: string[];
  supportHandoff?: BatchPostWriteHandoffResult;
  mainHandoff?: BatchPostWriteHandoffResult;
  recovery?: JsonRecord;
};

const materialized = {
  flowRowsFile: null,
  processRowsFile: "rows/process.jsonl",
  sourceRowsFile: null,
  supportRowsFile: "rows/support.jsonl",
  flowpropertyRowsFile: null,
  unitgroupRowsFile: null,
  classificationQueue: null,
  locationQueue: null,
  identityPreflightIndex: "identity/index.jsonl",
};

function readyFinalize(): JsonRecord {
  return {
    status: "ready_for_remote_write",
    files: { commit_handoff_plan: "handoff/main-plan.json" },
    blockers: [],
  };
}

function blockedSupportFinalize(): JsonRecord {
  return {
    status: "blocked",
    files: {
      source_contact_support_commit_handoff_plan: "handoff/support-plan.json",
    },
    blockers: [{ code: "support_not_committed" }],
  };
}

function createHarness(options: HarnessOptions): {
  adapter: BatchScopeFinalizeCommitAdapter;
  events: string[];
  verified: Set<string>;
  buildRows: string[];
} {
  const files = new Map<string, JsonRecord>([
    ["/repo/handoff/support-plan.json", { status: "ready_for_explicit_commit" }],
    ["/repo/handoff/main-plan.json", { status: "ready_for_explicit_commit" }],
    ["/repo/gate/report.json", { status: "blocked" }],
  ]);
  const events: string[] = [];
  const buildRows: string[] = [];
  const verified = new Set(options.verifiedKeys ?? []);
  let finalizeIndex = 0;

  const adapter: BatchScopeFinalizeCommitAdapter = {
    joinPath: (...parts) => path.posix.join(...parts),
    nowIso: () => "2026-08-29T00:00:00.000Z",
    repoRelative(filePath) {
      return filePath?.replace(/^\/repo\//u, "") ?? null;
    },
    resolveRepoPath(value) {
      if (typeof value !== "string" || value.length === 0) return null;
      return value.startsWith("/") ? value : path.posix.join("/repo", value);
    },
    fileExists(filePath) {
      return Boolean(filePath && files.has(filePath));
    },
    readJson(filePath) {
      const value = files.get(filePath);
      assert.ok(value, filePath);
      return value;
    },
    writeJson(filePath, value) {
      assert.ok(value && typeof value === "object" && !Array.isArray(value));
      files.set(filePath, value as JsonRecord);
      events.push(`write:${filePath}`);
    },
    buildFinalizeArgs(input) {
      buildRows.push(input.rowsFile);
      return ["finalize", input.type, input.rowsFile];
    },
    async runFinalizeStage({ stage }) {
      const step = options.finalizeSteps[finalizeIndex];
      assert.ok(step, `missing finalize step ${finalizeIndex}`);
      finalizeIndex += 1;
      events.push(`finalize:${stage}`);
      return {
        stage,
        json: step.report,
        finalize_report_missing: Boolean(step.missing),
      };
    },
    async executeHandoff(input) {
      events.push(`handoff:${input.label}`);
      const configured = input.label.endsWith(".support")
        ? options.supportHandoff
        : options.mainHandoff;
      if (configured) return configured;
      return {
        status: "completed",
        blockers: [],
        stages: [{ stage: `${input.label}.complete` }],
        closeoutReportPath: `${input.outDir}/closeout.json`,
      };
    },
    async runIdentityAndPatch() {
      events.push("recovery");
      return (options.recovery ?? {
        status: "blocked",
        blocker: { code: "recovery_not_configured" },
        report: null,
      }) as never;
    },
    supportIdentityKeysFromHandoffPlan: () => options.supportKeys ?? [],
    verifiedSupportIdentities: verified,
    staleReusedSupportIdentityKeys: () => options.staleKeys ?? [],
    appendSupportIdentityInvalidationRows(input) {
      events.push(`invalidate:${input.identityKeys.join(",")}`);
    },
    appendSupportIdentityCacheRows(input) {
      events.push(`cache:${input.identityKeys.join(",")}`);
    },
    firstBlocker(report, fallbackCode, fallbackMessage) {
      const blockers = Array.isArray(report?.blockers) ? report.blockers : [];
      const blocker = blockers[0];
      return blocker && typeof blocker === "object" && !Array.isArray(blocker)
        ? (blocker as JsonRecord)
        : { code: fallbackCode, message: fallbackMessage };
    },
  };
  return { adapter, events, verified, buildRows };
}

function finalizeInput(stages: JsonRecord[] = []) {
  return {
    type: "process",
    rowsFile: "rows/process.jsonl",
    scopeDir: "/repo/scopes/process-a",
    runDir: "/repo/run",
    materialized,
    classificationApplyReport: null,
    locationApplyReport: null,
    identityApplyReports: [] as string[],
    patchCollectReport: null,
    patchApplyReport: null,
    targetUserId: "11111111-1111-4111-8111-111111111111",
    stateCode: 0,
    logDir: "/repo/logs",
    ledgerDir: "/repo/ledger",
    stages,
    supportIdentityCacheFile: "/repo/ledger/support.jsonl",
  };
}

test("scope finalize fails closed when the finalize report is missing", async () => {
  const harness = createHarness({
    finalizeSteps: [
      {
        missing: true,
        report: { status: "failed", blockers: [{ code: "finalize_report_missing" }] },
      },
    ],
  });
  const result = await createBatchScopeFinalizeCommitService(harness.adapter).finalizeAndCommit(
    finalizeInput(),
  );

  assert.equal(result.status, "failed");
  assert.equal(result.blocker.code, "finalize_report_missing");
  assert.deepEqual(harness.events, ["finalize:process.finalize_ready"]);
});

test("scope finalize reuses verified support before the main handoff", async () => {
  const stages: JsonRecord[] = [];
  const harness = createHarness({
    finalizeSteps: [{ report: blockedSupportFinalize() }, { report: readyFinalize() }],
    supportKeys: ["contact:c@00.00.001"],
    verifiedKeys: ["contact:c@00.00.001"],
  });
  const result = await createBatchScopeFinalizeCommitService(harness.adapter).finalizeAndCommit(
    finalizeInput(stages),
  );

  assert.equal(result.status, "completed");
  assert.equal(harness.events.includes("handoff:process.support"), false);
  assert.equal(harness.events.includes("handoff:process"), true);
  assert.equal(
    stages.some((stage) => stage.stage === "process.support.reuse_verified"),
    true,
  );
});

test("scope finalize invalidates stale support reuse before committing and caching it", async () => {
  const harness = createHarness({
    finalizeSteps: [
      { report: blockedSupportFinalize() },
      { report: blockedSupportFinalize() },
      { report: readyFinalize() },
    ],
    supportKeys: ["source:s@00.00.001"],
    verifiedKeys: ["source:s@00.00.001"],
    staleKeys: ["source:s@00.00.001"],
  });
  const result = await createBatchScopeFinalizeCommitService(harness.adapter).finalizeAndCommit(
    finalizeInput(),
  );

  assert.equal(result.status, "completed");
  assert.equal(harness.verified.has("source:s@00.00.001"), true);
  assert.deepEqual(
    harness.events.filter((event) => /^(?:invalidate|handoff|cache):/u.test(event)),
    [
      "invalidate:source:s@00.00.001",
      "handoff:process.support",
      "cache:source:s@00.00.001",
      "handoff:process",
    ],
  );
});

test("scope finalize feeds recovered rows and evidence into the next exact finalize", async () => {
  const blocked = {
    status: "blocked",
    files: { curation_gate_report: "gate/report.json" },
    blockers: [{ code: "identity_pending" }],
  };
  const harness = createHarness({
    finalizeSteps: [{ report: blocked }, { report: readyFinalize() }],
    recovery: {
      status: "completed",
      rowsFile: "rows/process.patched.jsonl",
      identityApplyReport: "identity/apply.json",
      patchCollectReport: null,
      patchApplyReport: null,
    },
  });
  const result = await createBatchScopeFinalizeCommitService(harness.adapter).finalizeAndCommit(
    finalizeInput(),
  );

  assert.equal(result.status, "completed");
  assert.deepEqual(harness.buildRows, ["rows/process.jsonl", "rows/process.patched.jsonl"]);
  assert.deepEqual(
    harness.events.filter((event) => event === "recovery"),
    ["recovery"],
  );
});

test("scope finalize keeps a failed support handoff blocking and skips the main handoff", async () => {
  const harness = createHarness({
    finalizeSteps: [{ report: blockedSupportFinalize() }],
    supportKeys: ["source:s@00.00.001"],
    supportHandoff: {
      status: "failed",
      blockers: [{ code: "support_commit_failed" }],
      stages: [{ stage: "support.commit" }],
    },
  });
  const result = await createBatchScopeFinalizeCommitService(harness.adapter).finalizeAndCommit(
    finalizeInput(),
  );

  assert.equal(result.status, "blocked");
  assert.equal(result.blocker.code, "support_commit_failed");
  assert.equal(harness.events.includes("handoff:process.support"), true);
  assert.equal(harness.events.includes("handoff:process"), false);
});

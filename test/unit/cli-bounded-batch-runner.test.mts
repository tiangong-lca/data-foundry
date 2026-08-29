import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { batchRunLockPath } from "@tiangong-lca/cli/batch";

import { runLockedCliBatch } from "../../scripts/lib/batch-orchestration/cli-bounded-batch-runner.ts";
import { runFoundryScopeBatch } from "../../scripts/lib/batch-orchestration/foundry-scope-batch-runner.ts";
import { createScopeResumeContract } from "../../scripts/lib/batch-orchestration/scope-resume-contract.ts";

test("BAFU command delegates claims to the locked CLI batch boundary", () => {
  const facadeSource = fs.readFileSync(
    path.resolve("scripts/commands/bafu-batch-import-run.ts"),
    "utf8",
  );
  const runtimeSource = fs.readFileSync(
    path.resolve("scripts/lib/batch-orchestration/bafu-batch-command-runtime.ts"),
    "utf8",
  );
  assert.match(facadeSource, /bafu-batch-command-runtime\.ts/u);
  assert.match(runtimeSource, /runFoundryScopeBatch/u);
  assert.doesNotMatch(runtimeSource, /async function worker\(workerIndex/u);
  assert.doesNotMatch(runtimeSource, /Promise\.all\(Array\.from\(\{ length: parallel \}/u);
});

test("locked CLI batch runner binds the public contract and releases its run lock", async () => {
  const runPath = fs.mkdtempSync(path.join(os.tmpdir(), "foundry-cli-batch-runner-"));
  let inFlight = 0;
  let maxInFlight = 0;
  try {
    const result = await runLockedCliBatch({
      runPath,
      reason: "foundry-unit-proof",
      identity: { schema: "foundry.cli-batch-runner.v1", run_id: "unit-proof" },
      content: { items: ["scope-a", "scope-b"] },
      policy: { mode: "read", max_concurrency: 2 },
      items: ["scope-a", "scope-b"],
      getItemIdentity: (item) => item,
      projectItemContent: (item) => ({ item }),
      projectItemPolicy: () => ({ profile: "generic" }),
      mode: "read",
      maxConcurrency: 2,
      execute: async ({ item }) => {
        assert.equal(fs.existsSync(batchRunLockPath(runPath)), true);
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise<void>((resolve) => setImmediate(resolve));
        inFlight -= 1;
        return `${item}:completed`;
      },
    });

    assert.equal(result.status, "completed");
    assert.equal(maxInFlight, 2);
    assert.deepEqual(result.claim_order, ["scope-a", "scope-b"]);
    assert.deepEqual(
      result.results_input_order.map((entry) =>
        entry.status === "failed" ? entry.status : entry.value,
      ),
      ["scope-a:completed", "scope-b:completed"],
    );
    assert.equal(fs.existsSync(batchRunLockPath(runPath)), false);
  } finally {
    fs.rmSync(runPath, { recursive: true, force: true });
  }
});

test("locked CLI batch runner preserves pause and stop closure", async () => {
  const pausedPath = fs.mkdtempSync(path.join(os.tmpdir(), "foundry-cli-batch-paused-"));
  const stoppedPath = fs.mkdtempSync(path.join(os.tmpdir(), "foundry-cli-batch-stopped-"));
  try {
    const paused = await runLockedCliBatch({
      runPath: pausedPath,
      reason: "pause-proof",
      identity: { schema: "foundry.cli-batch-runner.v1", run_id: "pause" },
      content: ["a", "b"],
      policy: { pause: true },
      items: ["a", "b"],
      getItemIdentity: (item) => item,
      projectItemContent: (item) => item,
      projectItemPolicy: () => null,
      mode: "read",
      maxConcurrency: 2,
      execute: () => "unexpected",
      shouldPauseBeforeClaim: () => true,
    });
    assert.equal(paused.status, "paused");
    assert.deepEqual(paused.unclaimed_item_ids, ["a", "b"]);

    const stopped = await runLockedCliBatch({
      runPath: stoppedPath,
      reason: "stop-proof",
      identity: { schema: "foundry.cli-batch-runner.v1", run_id: "stop" },
      content: ["a", "b"],
      policy: { stop_after: 1 },
      items: ["a", "b"],
      getItemIdentity: (item) => item,
      projectItemContent: (item) => item,
      projectItemPolicy: () => null,
      mode: "read",
      maxConcurrency: 1,
      execute: ({ item }) => `${item}:done`,
      shouldStop: () => true,
    });
    assert.equal(stopped.status, "stopped");
    assert.deepEqual(stopped.completion_order, ["a"]);
    assert.deepEqual(stopped.unclaimed_item_ids, ["b"]);
  } finally {
    fs.rmSync(pausedPath, { recursive: true, force: true });
    fs.rmSync(stoppedPath, { recursive: true, force: true });
  }
});

test("locked mutation resume consumes no second attempt before readback recovery", async () => {
  const runPath = fs.mkdtempSync(path.join(os.tmpdir(), "foundry-cli-batch-recovery-"));
  let executions = 0;
  let recoverySource = "";
  try {
    const common = {
      runPath,
      reason: "mutation-recovery-proof",
      identity: { schema: "foundry.cli-batch-runner.v1", run_id: "recovery" },
      content: { items: ["scope-a"] },
      policy: { mode: "mutation" },
      items: ["scope-a"],
      getItemIdentity: (item: string) => item,
      projectItemContent: (item: string) => ({ item }),
      projectItemPolicy: () => ({ profile: "bafu" }),
      mode: "mutation" as const,
      maxConcurrency: 1,
    };
    const first = await runLockedCliBatch({
      ...common,
      execute: () => {
        executions += 1;
        throw new Error("transport closed after mutation admission");
      },
      recoverMutation: () => ({ status: "unresolved" as const }),
    });
    const attempted = first.results_input_order[0];
    assert.equal(attempted.status, "failed");
    assert.equal(executions, 1);

    const second = await runLockedCliBatch({
      ...common,
      resumeItems: [
        {
          ...attempted.item_contract,
          state: "attempted" as const,
          attempts: attempted.attempts,
        },
      ],
      execute: () => {
        executions += 1;
        return "unsafe replay";
      },
      recoverMutation: ({ source }) => {
        recoverySource = source;
        return { status: "recovered" as const, value: "verified by readback" };
      },
    });
    assert.equal(executions, 1);
    assert.equal(recoverySource, "resume_incomplete");
    assert.equal(second.results_input_order[0].status, "recovered");
    assert.equal(second.results_input_order[0].resumed, true);
  } finally {
    fs.rmSync(runPath, { recursive: true, force: true });
  }
});

test("Foundry scope adapter serializes one family while independent scope work continues", async () => {
  const runPath = fs.mkdtempSync(path.join(os.tmpdir(), "foundry-family-batch-"));
  const starts: string[] = [];
  let sharedInFlight = 0;
  let sharedMaxInFlight = 0;
  try {
    const result = await runFoundryScopeBatch({
      runPath,
      outDirIdentity: "batch",
      scopeFileIdentity: "ready-scopes.jsonl",
      pauseFileIdentity: null,
      command: "dataset-bafu-batch-import-run",
      profile: "bafu",
      targetUserId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
      stateCode: 0,
      selectionOrder: "family-master-first",
      stopAfterBlocked: null,
      maxConcurrency: 2,
      items: [
        { id: "family-master", family: "shared", role: "master" },
        { id: "family-variant", family: "shared", role: "variant" },
        { id: "independent", family: "independent", role: "standard" },
      ],
      getScopeKey: (scope) => scope.id,
      getScopeResumeContract: (scope) =>
        createScopeResumeContract({
          identityKey: scope.id,
          content: scope,
          policy: { profile: "bafu" },
          executable: { cli: "0.1.3" },
        }),
      getFamilyPolicy: (scope) => ({
        familyGroupKey: scope.family,
        optimizationRole: scope.role,
      }),
      executeScope: async (scope) => {
        starts.push(scope.id);
        if (scope.family === "shared") {
          sharedInFlight += 1;
          sharedMaxInFlight = Math.max(sharedMaxInFlight, sharedInFlight);
        }
        await new Promise<void>((resolve) => setImmediate(resolve));
        if (scope.family === "shared") sharedInFlight -= 1;
        return { process_id: scope.id, status: "verified" };
      },
      recoverScopeFailure: (scope) => ({ process_id: scope.id, status: "failed" }),
      recoverScopeMutation: () => null,
      summarizeScope: (_scope, result) => result,
      afterScope: () => undefined,
      pauseRequested: () => false,
    });

    assert.equal(result.paused, false);
    assert.equal(result.stoppedAfterBlocked, false);
    assert.equal(result.unclaimedCount, 0);
    assert.equal(sharedMaxInFlight, 1);
    assert.ok(starts.indexOf("family-master") < starts.indexOf("family-variant"));
    assert.deepEqual(
      result.results.map((entry) => entry.process_id).sort(),
      ["family-master", "family-variant", "independent"].sort(),
    );
  } finally {
    fs.rmSync(runPath, { recursive: true, force: true });
  }
});

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { batchRunLockPath } from "@tiangong-lca/cli/batch";

import { runLockedCliBatch } from "../../scripts/lib/batch-orchestration/cli-bounded-batch-runner.ts";

test("BAFU command delegates claims to the locked CLI batch boundary", () => {
  const ownerSource = fs.readFileSync(
    path.resolve("scripts/commands/bafu-batch-import-run.ts"),
    "utf8",
  );
  assert.match(ownerSource, /runLockedCliBatch/u);
  assert.doesNotMatch(ownerSource, /async function worker\(workerIndex/u);
  assert.doesNotMatch(ownerSource, /Promise\.all\(Array\.from\(\{ length: parallel \}/u);
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

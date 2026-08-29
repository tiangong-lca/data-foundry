import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  scheduleReadyScopes,
  type ReadyScopeScheduleItem,
} from "../../scripts/lib/library-orchestration/ready-scope-scheduler.ts";

function item(id: string, index: number): ReadyScopeScheduleItem {
  return {
    process_id: id,
    process_version: "00.00.001",
    state: "ready",
    input_index: index,
    content_sha256: id
      .repeat(64)
      .slice(0, 64)
      .replace(/[^a-f0-9]/gu, "a"),
    commit_spec_sha256: "b".repeat(64),
    verify_spec_sha256: "c".repeat(64),
  };
}

test("ready scope scheduler forwards pause and stop policy to the CLI engine", async () => {
  const pauseRoot = fs.mkdtempSync(path.join(os.tmpdir(), "foundry-ready-pause-"));
  const stopRoot = fs.mkdtempSync(path.join(os.tmpdir(), "foundry-ready-stop-"));
  const items = [item("a", 0), item("b", 1), item("c", 2)];
  try {
    const pauseOptions = {
      runPath: pauseRoot,
      scopeFile: "scopes.jsonl",
      libraryResolution: "resolution.json",
      cliPackage: "@tiangong-lca/cli@0.1.3",
      commit: true,
      parallel: 2,
      items,
      execute: async (scope: ReadyScopeScheduleItem) => `${scope.process_id}:unexpected`,
      pauseRequested: () => true,
    };
    const paused = await scheduleReadyScopes(pauseOptions);
    assert.equal(paused.status, "paused");
    assert.deepEqual(paused.unclaimed_item_ids, [
      "0:a@00.00.001",
      "1:b@00.00.001",
      "2:c@00.00.001",
    ]);

    const completed: string[] = [];
    const stopOptions = {
      ...pauseOptions,
      runPath: stopRoot,
      parallel: 1,
      pauseRequested: () => false,
      execute: async (scope: ReadyScopeScheduleItem) => {
        completed.push(scope.process_id);
        return `${scope.process_id}:done`;
      },
      shouldStop: (results: readonly string[]) => results.length >= 1,
    };
    const stopped = await scheduleReadyScopes(stopOptions);
    assert.equal(stopped.status, "stopped");
    assert.deepEqual(completed, ["a"]);
    assert.deepEqual(stopped.unclaimed_item_ids, ["1:b@00.00.001", "2:c@00.00.001"]);
  } finally {
    fs.rmSync(pauseRoot, { recursive: true, force: true });
    fs.rmSync(stopRoot, { recursive: true, force: true });
  }
});

test("ready scope scheduler isolates one mutation exception without replay", async () => {
  const runRoot = fs.mkdtempSync(path.join(os.tmpdir(), "foundry-ready-error-"));
  const attempts = new Map<string, number>();
  try {
    const result = await scheduleReadyScopes({
      runPath: runRoot,
      scopeFile: "scopes.jsonl",
      libraryResolution: "resolution.json",
      cliPackage: "@tiangong-lca/cli@0.1.3",
      commit: true,
      parallel: 2,
      items: [item("a", 0), item("b", 1)],
      execute: async (scope) => {
        attempts.set(scope.process_id, (attempts.get(scope.process_id) ?? 0) + 1);
        if (scope.process_id === "a") throw new Error("ambiguous mutation transport");
        return `${scope.process_id}:done`;
      },
    });

    assert.deepEqual(Object.fromEntries(attempts), { a: 1, b: 1 });
    assert.deepEqual(
      result.results_input_order.map((entry) => entry.status),
      ["failed", "succeeded"],
    );
  } finally {
    fs.rmSync(runRoot, { recursive: true, force: true });
  }
});

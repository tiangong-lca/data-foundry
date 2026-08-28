import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { resolveInstalledTiangongLcaCliPackage } from "../../scripts/lib/foundry-runtime-utils.ts";

test("Foundry consumes the published CLI 0.1.2 batch engine and run lock", async () => {
  const installed = resolveInstalledTiangongLcaCliPackage();
  assert.equal(installed.packageVersion, "0.1.2");
  assert.equal(installed.packageSpec, "@tiangong-lca/cli@0.1.2");

  const batch = await import("@tiangong-lca/cli/batch");
  assert.equal(typeof batch.createBatchContract, "function");
  assert.equal(typeof batch.runBoundedBatch, "function");
  assert.equal(typeof batch.withBatchRunLock, "function");

  const root = fs.mkdtempSync(path.join(os.tmpdir(), "foundry-public-cli-batch-"));
  try {
    const contract = batch.createBatchContract({
      identity: { run_id: "foundry-public-batch-case" },
      content: { items: ["scope-a", "scope-b"] },
      policy: { mode: "read", max_concurrency: 2 },
    });
    const result = await batch.withBatchRunLock(
      {
        runPath: root,
        identity: contract.identity,
        reason: "foundry-package-contract",
      },
      () =>
        batch.runBoundedBatch({
          contract,
          items: ["scope-a", "scope-b"],
          getItemIdentity: (item) => item,
          projectItemContent: (item) => ({ item }),
          projectItemPolicy: () => ({ profile: "generic" }),
          mode: "read",
          maxConcurrency: 2,
          execute: ({ item }) => `${item}:completed`,
        }),
    );

    assert.equal(result.status, "completed");
    assert.deepEqual(result.claim_order, ["scope-a", "scope-b"]);
    assert.deepEqual(
      result.results_input_order.map((entry) =>
        entry.status === "failed" ? entry.status : entry.value,
      ),
      ["scope-a:completed", "scope-b:completed"],
    );
    assert.equal(fs.existsSync(batch.batchRunLockPath(root)), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

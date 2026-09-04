import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { parseAuthIdentityReceipt } from "@tiangong-lca/cli/auth-identity-receipt";

import { resolveInstalledTiangongLcaCliPackage } from "../../scripts/lib/foundry-runtime-utils.ts";
import { testAuthIdentityReceipt } from "../fixtures/auth-identity-receipt.ts";

test("Foundry consumes the published CLI 0.1.8 batch, run-lock, and auth parser exports", async () => {
  const installed = resolveInstalledTiangongLcaCliPackage();
  assert.equal(installed.packageVersion, "0.1.8");
  assert.equal(installed.packageSpec, "@tiangong-lca/cli@0.1.8");

  const batch = await import("@tiangong-lca/cli/batch");
  assert.equal(typeof batch.createBatchContract, "function");
  assert.equal(typeof batch.runBoundedBatch, "function");
  assert.equal(typeof batch.withBatchRunLock, "function");
  assert.equal(parseAuthIdentityReceipt(testAuthIdentityReceipt()).cli.package_version, "0.1.8");

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
    const unsupportedDeepPath = [
      "@tiangong-lca/cli",
      "dist",
      "src",
      "lib",
      "auth-identity-receipt.js",
    ].join("/");
    await assert.rejects(import(unsupportedDeepPath), (error: unknown) => {
      return (
        error instanceof Error && "code" in error && error.code === "ERR_PACKAGE_PATH_NOT_EXPORTED"
      );
    });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

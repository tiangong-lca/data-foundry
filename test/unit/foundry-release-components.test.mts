import assert from "node:assert/strict";
import test from "node:test";
import {
  preparedFoundryRuntimeAuthority,
  type PreparedFoundryRuntimeComponents,
} from "../../scripts/lib/foundry-release-components.ts";
import { qualifyFoundryRuntimeComponents } from "../../scripts/lib/foundry-release-runtime-qualification.ts";
import inputs from "../../specs/release/runtime-inputs.json" with { type: "json" };

test("a copied component receipt cannot start runtime qualification", async () => {
  const copied = {
    status: "prepared",
    source: { commit: "a".repeat(40) },
  } as unknown as PreparedFoundryRuntimeComponents;
  assert.throws(() => preparedFoundryRuntimeAuthority(copied), /in-process/u);
  await assert.rejects(qualifyFoundryRuntimeComponents(copied), /in-process/u);
});

test("runtime minimum hosts and intrinsic native dates bind the reviewed four-platform input", () => {
  assert.deepEqual(inputs.minimum_hosts, {
    "darwin-arm64": { os_release: "22.6.0", glibc: null },
    "linux-x64": { os_release: "4.18.0", glibc: "2.38" },
    "linux-arm64": { os_release: "4.18.0", glibc: "2.38" },
    "win32-x64": { os_release: "10.0.0", glibc: null },
  });
  assert.equal(inputs.node.source_date, "2026-07-30T11:57:02.000Z");
  assert.equal(inputs.tidas.source_date, "2026-09-06T12:10:24.000Z");
});

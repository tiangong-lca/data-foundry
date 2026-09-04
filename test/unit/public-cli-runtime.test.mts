import assert from "node:assert/strict";
import test from "node:test";
import {
  CLI_RUNTIME_EXPECTATION_SCHEMA,
  RUNTIME_PLATFORMS,
  assertCliRuntimeMatches,
  describeCliRuntime,
  ensureRuntimeComponents,
  executeRuntimeLaunch,
  inspectRuntimeComponents,
  loadTrustedRuntimeManifest,
  parseRuntimeManifest,
  pruneRuntimeComponents,
} from "@tiangong-lca/cli/runtime";

test("Foundry consumes the exact published CLI C1 runtime boundary", () => {
  const descriptor = describeCliRuntime();
  assert.equal(descriptor.package.name, "@tiangong-lca/cli");
  assert.equal(descriptor.package.version, "0.1.10");
  assert.deepEqual(
    [...RUNTIME_PLATFORMS],
    ["darwin-arm64", "linux-x64", "linux-arm64", "win32-x64"],
  );
  assert.equal(Object.isFrozen(descriptor), true);
  assert.equal(Object.isFrozen(descriptor.files), true);
  const expectation = {
    schema: CLI_RUNTIME_EXPECTATION_SCHEMA,
    package_version: descriptor.package.version,
    platform: descriptor.platform,
    content_sha256: descriptor.content_sha256,
    node_version: descriptor.node.version,
    node_sha256: descriptor.node.sha256,
  };
  assert.equal(assertCliRuntimeMatches(expectation).content_sha256, descriptor.content_sha256);
  assert.throws(
    () => assertCliRuntimeMatches({ ...expectation, content_sha256: "0".repeat(64) }),
    /does not match/u,
  );
  assert.throws(() => parseRuntimeManifest({}), /Runtime manifest/u);
  for (const value of [
    loadTrustedRuntimeManifest,
    ensureRuntimeComponents,
    inspectRuntimeComponents,
    pruneRuntimeComponents,
    executeRuntimeLaunch,
  ]) {
    assert.equal(typeof value, "function");
  }
});

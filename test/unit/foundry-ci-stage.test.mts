import assert from "node:assert/strict";
import test from "node:test";
import { selectStageArtifacts, stageArtifactPrefix } from "../../scripts/lib/foundry-ci-stage.ts";
import { type CapsuleExpectation } from "../../scripts/lib/foundry-ci-capsule.ts";
import { parsePlatformDiagnostic } from "../../scripts/release-diagnose-platform.ts";
const expected: CapsuleExpectation = {
  stage: "native",
  platform: "linux-x64",
  purpose: "release",
  input_sha256: "f".repeat(64),
  identity: {
    repository: { id: "123", owner_id: "456" },
    source: { commit: "a".repeat(40), tree: "b".repeat(40) },
    package: { name: "@tiangong-lca/foundry", version: "0.1.4" },
    toolchain: {
      node: "24.19.0",
      pnpm: "11.24.0",
      typescript: "7.0.2",
      lock_sha256: "c".repeat(64),
    },
    runtime_inputs_sha256: "d".repeat(64),
    test_plan_sha256: "e".repeat(64),
  },
};
test("artifact discovery chooses only unexpired exact stage/input/platform locators in newest order", () => {
  const prefix = stageArtifactPrefix(expected);
  const row = (id: number, name = `${prefix}123-${id}`, expired = false) => ({ id, name, expired });
  const selected = selectStageArtifacts(
    {
      artifacts: [
        row(1),
        row(3),
        row(2, undefined, true),
        row(4, `${prefix}123-4-extra`),
        row(5, `${prefix.replace("linux-x64", "win32-x64")}123-5`),
        row(6, `${prefix.replace("f".repeat(16), "a".repeat(16))}123-6`),
      ],
    },
    expected,
  );
  assert.deepEqual(
    selected.map((s) => s.id),
    [3, 1],
  );
  assert.throws(() =>
    selectStageArtifacts({ artifacts: [{ id: "123", name: "fake", expired: false }] }, expected),
  );
});
test("platform diagnostics admit an exact immutable tag and reject publication/recovery mode mixing", () => {
  const inputs = {
    diagnose_platform: "win32-x64",
    diagnose_tag: "foundry-v0.1.4",
    diagnose_npm_oidc: false,
    resume_run_id: "",
  };
  assert.deepEqual(parsePlatformDiagnostic(inputs), {
    platform: "win32-x64",
    tag: "foundry-v0.1.4",
  });
  for (const delta of [
    { diagnose_platform: "darwin-x64" },
    { diagnose_tag: "main" },
    { diagnose_tag: "foundry-v01.1.4" },
    { diagnose_tag: "foundry-v0.1.4;echo bad" },
    { diagnose_npm_oidc: true },
    { resume_run_id: "123" },
  ])
    assert.throws(() => parsePlatformDiagnostic({ ...inputs, ...delta }));
});

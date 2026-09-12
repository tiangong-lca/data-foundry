import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  capsuleHash,
  capsuleIdentity,
  inspectCapsuleReceipt,
  inventoryCapsuleFiles,
  validateCapsuleCertificate,
  materializeCapsule,
  type VerifiedCapsule,
  type CapsuleReceipt,
} from "../../scripts/lib/foundry-ci-capsule.ts";
import { currentCapsuleRepositoryIdentity } from "../../scripts/lib/foundry-ci-capsule.ts";

const identity = {
  repository: { id: "1234", owner_id: "123" },
  source: { commit: "a".repeat(40), tree: "b".repeat(40) },
  package: { name: "@tiangong-lca/foundry", version: "0.1.4" },
  toolchain: { node: "24.19.0", pnpm: "11.24.0", typescript: "7.0.2", lock_sha256: "c".repeat(64) },
  runtime_inputs_sha256: "d".repeat(64),
  test_plan_sha256: "e".repeat(64),
};
const origin = {
  run: "123",
  attempt: "1",
  ref: "refs/heads/main",
  workflow: ".github/workflows/publish-foundry.yml",
};
function receipt(): CapsuleReceipt {
  return {
    schema: "tiangong-foundry.ci-capsule.v1",
    stage: "native",
    platform: "linux-x64",
    purpose: "release",
    identity,
    input_sha256: "f".repeat(64),
    origin,
    files: [{ path: "result.json", bytes: 2, sha256: capsuleHash(Buffer.from("{}")) }],
  };
}

test("capsule identity ignores consuming run but binds every qualification input", () => {
  assert.equal(capsuleIdentity(identity), capsuleIdentity(JSON.parse(JSON.stringify(identity))));
  for (const changed of [
    { ...identity, source: { ...identity.source, commit: "f".repeat(40) } },
    { ...identity, toolchain: { ...identity.toolchain, lock_sha256: "f".repeat(64) } },
    { ...identity, toolchain: { ...identity.toolchain, node: "24.20.0" } },
    { ...identity, runtime_inputs_sha256: "f".repeat(64) },
    { ...identity, test_plan_sha256: "f".repeat(64) },
  ])
    assert.notEqual(capsuleIdentity(identity), capsuleIdentity(changed));
});

test("capsule parsing rejects wrong source, platform, input and unsafe inventories", () => {
  const expected = {
    identity,
    stage: "native" as const,
    platform: "linux-x64" as const,
    input_sha256: "f".repeat(64),
    purpose: "release" as const,
  };
  assert.equal(
    inspectCapsuleReceipt(Buffer.from(JSON.stringify(receipt())), expected).origin.run,
    "123",
  );
  for (const delta of [
    { stage: "bootstrap" },
    { platform: "win32-x64" },
    { purpose: "ci" },
    { input_sha256: "0".repeat(64) },
    { identity: { ...identity, source: { ...identity.source, tree: "0".repeat(40) } } },
    { files: [{ path: "../escape", bytes: 2, sha256: "f".repeat(64) }] },
    { files: [receipt().files[0], receipt().files[0]] },
    { passed: true },
    { origin: { ...origin, workflow: ".github/workflows/untrusted.yml" } },
  ])
    assert.throws(() =>
      inspectCapsuleReceipt(Buffer.from(JSON.stringify({ ...receipt(), ...delta })), expected),
    );
});

test("capsule provenance policy reads certificate identity instead of a forged predicate", () => {
  const cert = {
    issuer: "https://token.actions.githubusercontent.com",
    runnerEnvironment: "github-hosted",
    sourceRepositoryURI: "https://github.com/tiangong-lca/foundry",
    sourceRepositoryDigest: identity.source.commit,
    sourceRepositoryIdentifier: identity.repository.id,
    sourceRepositoryOwnerIdentifier: identity.repository.owner_id,
    buildConfigURI: `https://github.com/tiangong-lca/foundry/${origin.workflow}@${origin.ref}`,
    buildConfigDigest: identity.source.commit,
    buildSignerDigest: identity.source.commit,
    sourceRepositoryRef: origin.ref,
    buildSignerURI: `https://github.com/tiangong-lca/foundry/${origin.workflow}@${origin.ref}`,
    runInvocationURI: "https://github.com/tiangong-lca/foundry/actions/runs/123/attempts/1",
  };
  const verification = (certificate: unknown) => [
    {
      verificationResult: {
        signature: { certificate },
        verifiedTimestamps: [{ timestamp: new Date().toISOString() }],
        statement: { predicate: { safe: true } },
      },
    },
  ];
  validateCapsuleCertificate(verification(cert), receipt());
  for (const delta of [
    { runnerEnvironment: "self-hosted" },
    { sourceRepositoryDigest: "0".repeat(40) },
    { buildSignerDigest: "0".repeat(40) },
    { issuer: "https://untrusted.invalid" },
    { runInvocationURI: "https://github.com/other/repo/actions/runs/123/attempts/1" },
  ])
    assert.throws(() => validateCapsuleCertificate(verification({ ...cert, ...delta }), receipt()));
  assert.throws(
    () => validateCapsuleCertificate(verification(cert), receipt(), Date.now() + 25 * 3600000),
    /24 hours/u,
  );
});

test("capsule inventory rejects links and a serialized receipt cannot grant materialization", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "capsule-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, "result.json"), "{}");
  assert.deepEqual(inventoryCapsuleFiles(root), receipt().files);
  if (process.platform !== "win32") {
    fs.symlinkSync("result.json", path.join(root, "alias"));
    assert.throws(() => inventoryCapsuleFiles(root));
  }
  assert.throws(
    () =>
      materializeCapsule(
        { receipt: receipt() } as unknown as VerifiedCapsule,
        path.join(root, "out"),
      ),
    /verified/u,
  );
});

test("capsule identity generation uses current ids and is never blocked by the publication floor", () => {
  // Current organization/repository ids pass even though the candidate package
  // version may still be 0.1.8 (the npm floor only governs publication, not capsules).
  assert.deepEqual(currentCapsuleRepositoryIdentity("1260957221", "327771381"), {
    id: "1260957221",
    owner_id: "327771381",
  });
  assert.throws(
    () => currentCapsuleRepositoryIdentity("1260957221", "199785309"),
    /current source profile/u,
  );
  assert.throws(
    () => currentCapsuleRepositoryIdentity("1260957222", "327771381"),
    /current source profile/u,
  );
  assert.throws(() => currentCapsuleRepositoryIdentity(undefined, "327771381"), /missing/u);
});

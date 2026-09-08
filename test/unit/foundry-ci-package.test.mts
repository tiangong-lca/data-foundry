import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  verifyFoundryCiPackageBytes,
  type FoundryCiBuildContext,
} from "../../scripts/lib/foundry-ci-package.ts";

const hash = (value: Uint8Array) => createHash("sha256").update(value).digest("hex");
const context: FoundryCiBuildContext = {
  source: { commit: "a".repeat(40), tree: "b".repeat(40) },
  package: { name: "@tiangong-lca/foundry", version: "0.1.0" },
  toolchain: { node: "24.19.0", pnpm: "11.24.0", typescript: "7.0.2", lock_sha256: "c".repeat(64) },
  run: {
    id: "123",
    attempt: "1",
    workflow_ref: "tiangong-lca/data-foundry/.github/workflows/quality-gate.yml@refs/pull/1/merge",
  },
};
function fixture() {
  const archive = Buffer.from("verified archive bytes");
  const manifest = Buffer.from(
    JSON.stringify({
      schema: "tiangong-foundry.ci-package.v1",
      context,
      artifact: {
        file: "tiangong-lca-foundry-0.1.0.tgz",
        bytes: archive.length,
        sha256: hash(archive),
        inventory_sha256: "d".repeat(64),
      },
    }),
  );
  return {
    archive,
    manifest,
    expected: { manifestSha256: hash(manifest), archiveSha256: hash(archive) },
  };
}

test("CI package reuse binds independently selected digests and exact build context", () => {
  const f = fixture();
  const result = verifyFoundryCiPackageBytes(f.manifest, f.archive, f.expected, context);
  assert.equal(result.artifact.sha256, f.expected.archiveSha256);
  assert.equal(result.artifact.bytes, f.archive.length);
});

test("self-consistent edited manifests cannot replace trusted CI output digests", () => {
  const f = fixture();
  const altered = Buffer.from("modified archive");
  const value = JSON.parse(f.manifest.toString());
  value.artifact.sha256 = hash(altered);
  value.artifact.bytes = altered.length;
  assert.throws(
    () =>
      verifyFoundryCiPackageBytes(Buffer.from(JSON.stringify(value)), altered, f.expected, context),
    /digest/,
  );
  assert.throws(
    () => verifyFoundryCiPackageBytes(f.manifest, altered, f.expected, context),
    /digest/,
  );
  assert.throws(
    () =>
      verifyFoundryCiPackageBytes(
        f.manifest,
        f.archive,
        { manifestSha256: "", archiveSha256: "" },
        context,
      ),
    /digest/,
  );
});

test("CI package reuse rejects other commits, dependencies, toolchains and run attempts", () => {
  const f = fixture();
  for (const expected of [
    { ...context, source: { ...context.source, commit: "e".repeat(40) } },
    { ...context, source: { ...context.source, tree: "e".repeat(40) } },
    { ...context, toolchain: { ...context.toolchain, lock_sha256: "e".repeat(64) } },
    { ...context, toolchain: { ...context.toolchain, node: "24.20.0" } },
    { ...context, run: { ...context.run!, attempt: "2" } },
  ])
    assert.throws(
      () => verifyFoundryCiPackageBytes(f.manifest, f.archive, f.expected, expected),
      /context/,
    );
});

test("CI package metadata cannot redirect paths or conceal artifact mismatches", () => {
  const f = fixture();
  for (const change of [
    { file: "../outside.tgz" },
    { bytes: 0 },
    { inventory_sha256: "bad" },
    { sha256: "e".repeat(64) },
    { extra: "unexpected" },
  ]) {
    const value = JSON.parse(f.manifest.toString());
    Object.assign(value.artifact, change);
    const manifest = Buffer.from(JSON.stringify(value));
    assert.throws(
      () =>
        verifyFoundryCiPackageBytes(
          manifest,
          f.archive,
          { ...f.expected, manifestSha256: hash(manifest) },
          context,
        ),
      /artifact/,
    );
  }
});

import {
  selectedFoundryCiPackage,
  materializeVerifiedFoundryCiPackage,
} from "../../scripts/lib/foundry-ci-package.ts";

test("CI reuse never falls back after a partial selection or accepts a serialized proof", () => {
  assert.equal(selectedFoundryCiPackage({}), undefined);
  for (const env of [
    { FOUNDRY_CI_PACKAGE_DIR: "/unused" },
    { FOUNDRY_CI_PACKAGE_MANIFEST_SHA256: "a".repeat(64) },
    { FOUNDRY_CI_PACKAGE_SHA256: "a".repeat(64) },
  ])
    assert.throws(() => selectedFoundryCiPackage(env), /complete independent/);
  const f = fixture();
  const manifest = verifyFoundryCiPackageBytes(f.manifest, f.archive, f.expected, context);
  assert.throws(
    () => materializeVerifiedFoundryCiPackage({ manifest }, "/unused"),
    /fresh verified/,
  );
});

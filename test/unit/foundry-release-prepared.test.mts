import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  readFoundryReleaseArtifact,
  verifyPreparedFoundryNpm,
} from "../../scripts/lib/foundry-release-prepared.ts";

test("prepared artifact reads retain exact bounded regular bytes", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "foundry-prepared-"));
  try {
    const file = path.join(root, "artifact");
    const bytes = Buffer.from([0, 255, 31, 10]);
    fs.writeFileSync(file, bytes);
    assert.deepEqual(readFoundryReleaseArtifact(file, 4), bytes);
    assert.throws(() => readFoundryReleaseArtifact(file, 3), /size/u);
    assert.throws(() => readFoundryReleaseArtifact(root, 100), /regular/u);
    const linked = path.join(root, "linked");
    fs.symlinkSync(file, linked);
    assert.throws(() => readFoundryReleaseArtifact(linked, 100), /regular/u);
    fs.writeFileSync(file, Buffer.alloc(0));
    assert.throws(() => readFoundryReleaseArtifact(file, 100), /size/u);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("prepared verification requires independently selected source and canonical artifact names", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "foundry-prepared-verify-"));
  const expected = { version: "0.1.1", gitHead: "a".repeat(40) };
  try {
    await assert.rejects(verifyPreparedFoundryNpm(".", expected), /absolute/u);
    await assert.rejects(
      verifyPreparedFoundryNpm(root, { ...expected, gitHead: "main" }),
      /exact source/u,
    );
    await assert.rejects(
      verifyPreparedFoundryNpm(root, { ...expected, version: "../../unexpected" }),
      /version/u,
    );
    fs.writeFileSync(path.join(root, "other.tgz"), "unrelated");
    await assert.rejects(verifyPreparedFoundryNpm(root, expected), /regular/u);
    fs.writeFileSync(path.join(root, "tiangong-lca-foundry-0.1.1.tgz"), "unsigned fixture");
    fs.writeFileSync(path.join(root, "foundry-0.1.1.sigstore"), "{}");
    await assert.rejects(verifyPreparedFoundryNpm(root, expected), /DSSE/u);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

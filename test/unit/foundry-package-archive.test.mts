import assert from "node:assert/strict";
import { gzipSync, gunzipSync } from "node:zlib";
import test from "node:test";
import { canonicalizeFoundryPackageArchive } from "../../scripts/pack-foundry-package.ts";

test("canonical package gzip headers give identical bytes across actual pnpm host OS markers", () => {
  const payload = Buffer.from("identical package tar payload\n");
  const source = gzipSync(payload);
  const results = [3, 10, 19].map((os) => {
    const input = Buffer.from(source);
    input[9] = os;
    const result = canonicalizeFoundryPackageArchive(input);
    assert.equal(input[9], os);
    assert.deepEqual(gunzipSync(result), payload);
    assert.deepEqual(result.subarray(10), input.subarray(10));
    return result;
  });
  assert.deepEqual(results[0], results[1]);
  assert.deepEqual(results[1], results[2]);
  assert.equal(results[0][9], 255);
});

test("unexpected gzip header features fail rather than invalidating header checksums", () => {
  const bytes = gzipSync(Buffer.from("package"));
  for (const flags of [2, 4, 8, 16]) {
    const changed = Buffer.from(bytes);
    changed[3] = flags;
    assert.throws(() => canonicalizeFoundryPackageArchive(changed), /gzip/u);
  }
  assert.throws(() => canonicalizeFoundryPackageArchive(Buffer.from("not gzip")), /gzip/u);
});

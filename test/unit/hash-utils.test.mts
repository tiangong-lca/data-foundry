import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";

import { sha256Json, sha256Text } from "../../scripts/lib/import-curation/internal/hash-utils.mjs";

test("text hashing preserves exact String coercion and SHA-256 bytes", () => {
  assert.equal(sha256Text(""), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  assert.equal(
    sha256Text("abc"),
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  );
  assert.equal(sha256Text(null), sha256Text(undefined));
  assert.equal(sha256Text(null), sha256Text(""));
  assert.equal(sha256Text(42), sha256Text("42"));
  assert.equal(sha256Text({ value: 1 }), sha256Text("[object Object]"));
});

test("JSON hashing is the exact JSON.stringify byte contract", () => {
  const value = { a: 1, nested: { b: true }, values: [2, 3] };
  const expected = crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
  assert.equal(sha256Json(value), expected);
  assert.equal(
    sha256Json({ a: 1, b: 2 }),
    "43258cff783fe7036d8a43033f830adfc60ec037382473548ac742b888292777",
  );
});

test("JSON hashing preserves object insertion order and array order", () => {
  assert.notEqual(sha256Json({ a: 1, b: 2 }), sha256Json({ b: 2, a: 1 }));
  assert.notEqual(sha256Json([1, 2]), sha256Json([2, 1]));
  assert.equal(sha256Json({ values: [1, 2] }), sha256Json({ values: [1, 2] }));
});

test("JSON hashing retains JSON.stringify invalid-input failures", () => {
  assert.throws(() => sha256Json(undefined), TypeError);
  assert.throws(() => sha256Json(1n), TypeError);
});

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  conversionHashSets,
  mergeThreeWay,
  readJsonLinesWithMeta,
  sha256Json,
  stableJson,
  valueSha256,
} from "../../scripts/commands/incremental-change-set.ts";
import {
  fixtureBoundRule,
  fixtureSha256Json,
  fixtureValueSha256,
} from "../fixtures/incremental-change-set-fixtures.mjs";

test("incremental JSONL reader preserves line numbers and hashes without whole-file strings", (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "foundry-incremental-jsonl-"));
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));
  const filePath = path.join(tempDir, "rows.jsonl");
  fs.writeFileSync(filePath, '{"id":1}\r\n\n{"id":2}', "utf8");

  assert.deepEqual(readJsonLinesWithMeta(filePath), [
    {
      value: { id: 1 },
      line: 1,
      raw_sha256: crypto.createHash("sha256").update('{"id":1}').digest("hex"),
    },
    {
      value: { id: 2 },
      line: 3,
      raw_sha256: crypto.createHash("sha256").update('{"id":2}').digest("hex"),
    },
  ]);
});

function tablePolicy(overrides = {}) {
  return {
    allow_insert: true,
    allow_update: true,
    semantic_noise_rules: [],
    conflict_rules: [],
    array_merge_rules: [],
    ...overrides,
  };
}

test("incremental change-set canonical JSON and bound-value hashes are reproducible", () => {
  const value = { z: 1, nested: { b: 2, a: [3, { d: 4, c: 5 }] }, a: 0 };
  const canonical = '{"a":0,"nested":{"a":[3,{"c":5,"d":4}],"b":2},"z":1}';
  assert.equal(stableJson(value), canonical);
  assert.equal(sha256Json(value), crypto.createHash("sha256").update(canonical).digest("hex"));
  assert.equal(valueSha256(value), fixtureValueSha256(value));
  assert.equal(valueSha256(undefined), fixtureValueSha256(undefined));
  assert.notEqual(valueSha256(undefined), valueSha256(null));
});

test("three-way merge takes upstream changes when owner remains at old", () => {
  const merged = mergeThreeWay({
    oldValue: { name: "old", amount: 1 },
    candidateValue: { name: "old", amount: 2 },
    currentValue: { name: "old", amount: 1 },
    entityKey: "processes/p1@01.00.000",
    tablePolicy: tablePolicy(),
  });
  assert.deepEqual(merged.value, { amount: 2, name: "old" });
  assert.deepEqual(merged.applied_paths, ["/amount"]);
  assert.deepEqual(merged.conflicts, []);
});

test("owner preservation requires the exact entity, pointer, three values, and evidence binding", () => {
  const entityKey = "sources/s1@01.00.000";
  const inputs = {
    oldValue: { name: "old", amount: 1 },
    candidateValue: { name: "old", amount: 1 },
    currentValue: { name: "reviewed", amount: 1 },
  };
  const rule = fixtureBoundRule({
    entityKey,
    pointer: "/name",
    oldValue: "old",
    candidateValue: "old",
    currentValue: "reviewed",
    mode: "preserve_owner",
    evidence: { review: "fixture" },
  });
  const preserved = mergeThreeWay({
    ...inputs,
    entityKey,
    tablePolicy: tablePolicy({ conflict_rules: [rule] }),
  });
  assert.deepEqual(preserved.value, { amount: 1, name: "reviewed" });
  assert.deepEqual(preserved.preserved_paths, ["/name"]);
  assert.deepEqual(preserved.preserve_owner_evidence_sha256, [rule.evidence_sha256]);
  assert.deepEqual(preserved.conflicts, []);

  const otherEntity = mergeThreeWay({
    ...inputs,
    entityKey: "sources/s2@01.00.000",
    tablePolicy: tablePolicy({ conflict_rules: [rule] }),
  });
  assert.deepEqual(otherEntity.conflicts, [
    { pointer: "/name", reason: "unattributed_current_drift" },
  ]);

  const staleRule = { ...rule, current_value_sha256: valueSha256("stale-owner-value") };
  const staleCurrent = mergeThreeWay({
    ...inputs,
    entityKey,
    tablePolicy: tablePolicy({ conflict_rules: [staleRule] }),
  });
  assert.deepEqual(staleCurrent.conflicts, [
    { pointer: "/name", reason: "unattributed_current_drift" },
  ]);
});

test("decimal lexical noise is exact-bound while material numeric and Unicode changes remain updates", () => {
  const entityKey = "processes/p1@01.00.000";
  const decimalRule = fixtureBoundRule({
    entityKey,
    pointer: "/amount",
    oldValue: "1",
    candidateValue: "1.0",
    currentValue: "1",
    transform_id: "decimal_lexical_equivalence_v1",
    evidence: { source: "decimal-spelling-review" },
  });
  const lexical = mergeThreeWay({
    oldValue: { label: "A", amount: "1" },
    candidateValue: { label: "A", amount: "1.0" },
    currentValue: { label: "A", amount: "1" },
    entityKey,
    tablePolicy: tablePolicy({ semantic_noise_rules: [decimalRule] }),
  });
  assert.deepEqual(lexical.value, { amount: "1", label: "A" });
  assert.deepEqual(lexical.noise_paths, ["/amount"]);
  assert.deepEqual(lexical.noise_evidence_sha256, [decimalRule.evidence_sha256]);

  const materialRule = {
    ...decimalRule,
    candidate_value_sha256: valueSha256("1.01"),
  };
  const material = mergeThreeWay({
    oldValue: { amount: "1" },
    candidateValue: { amount: "1.01" },
    currentValue: { amount: "1" },
    entityKey,
    tablePolicy: tablePolicy({ semantic_noise_rules: [materialRule] }),
  });
  assert.deepEqual(material.value, { amount: "1.01" });
  assert.deepEqual(material.noise_paths, []);
  assert.deepEqual(material.applied_paths, ["/amount"]);

  const unicode = mergeThreeWay({
    oldValue: { text: "¨" },
    candidateValue: { text: " " },
    currentValue: { text: "¨" },
    entityKey,
    tablePolicy: tablePolicy(),
  });
  assert.deepEqual(unicode.value, { text: " " });
  assert.deepEqual(unicode.applied_paths, ["/text"]);
  assert.notEqual(fixtureSha256Json({ text: "¨" }), fixtureSha256Json({ text: " " }));
});

test("semantic hashes normalize only exact-bound matching decimal noise rules", () => {
  const entityKey = "processes/p1@01.00.000";
  const decimalRule = fixtureBoundRule({
    entityKey,
    pointer: "/amount",
    oldValue: 1,
    candidateValue: "1.0",
    currentValue: "1",
    transform_id: "decimal_lexical_equivalence_v1",
    evidence: { source: "exact-decimal-review" },
  });
  const normalized = conversionHashSets({
    oldValue: { amount: 1, text: "é" },
    candidateValue: { amount: "1.0", text: "é" },
    currentValue: { amount: "1", text: "é" },
    tablePolicy: tablePolicy({ semantic_noise_rules: [decimalRule] }),
    entityKey,
    domain: "fixture-semantic.v1",
  });
  assert.equal(normalized.hashes.old.semantic_sha256, normalized.hashes.candidate.semantic_sha256);
  assert.equal(
    normalized.hashes.candidate.semantic_sha256,
    normalized.hashes.current.semantic_sha256,
  );
  assert.notEqual(normalized.hashes.old.payload_sha256, normalized.hashes.candidate.payload_sha256);
  assert.deepEqual(normalized.noise_rules, [decimalRule]);

  const materialDecimal = conversionHashSets({
    oldValue: { amount: 1 },
    candidateValue: { amount: "1.01" },
    currentValue: { amount: "1" },
    tablePolicy: tablePolicy({ semantic_noise_rules: [decimalRule] }),
    entityKey,
    domain: "fixture-semantic.v1",
  });
  assert.notEqual(
    materialDecimal.hashes.old.semantic_sha256,
    materialDecimal.hashes.candidate.semantic_sha256,
  );
  assert.deepEqual(materialDecimal.noise_rules, []);

  const unicode = conversionHashSets({
    oldValue: { text: "é" },
    candidateValue: { text: "é" },
    currentValue: { text: "é" },
    tablePolicy: tablePolicy(),
    entityKey,
    domain: "fixture-semantic.v1",
  });
  assert.notEqual(unicode.hashes.old.semantic_sha256, unicode.hashes.candidate.semantic_sha256);
});

test("stable arrays merge disjoint element changes only under an exact array rule", () => {
  const entityKey = "processes/p-array@01.00.000";
  const oldItems = [
    { id: "a", amount: 1 },
    { id: "b", amount: 1 },
  ];
  const candidateItems = [
    { id: "a", amount: 2 },
    { id: "b", amount: 1 },
  ];
  const currentItems = [
    { id: "a", amount: 1 },
    { id: "b", amount: 3 },
  ];
  const arrayRule = fixtureBoundRule({
    entityKey,
    pointer: "/items",
    oldValue: oldItems,
    candidateValue: candidateItems,
    currentValue: currentItems,
    mode: "stable_identity_by_index_v1",
    element_identity_pointer: "/id",
    evidence: { source: "stable-array-identity-review" },
  });
  const merged = mergeThreeWay({
    oldValue: { items: oldItems },
    candidateValue: { items: candidateItems },
    currentValue: { items: currentItems },
    entityKey,
    tablePolicy: tablePolicy({ array_merge_rules: [arrayRule] }),
  });
  assert.deepEqual(merged.conflicts, []);
  assert.deepEqual(merged.value.items, [
    { id: "a", amount: 2 },
    { id: "b", amount: 3 },
  ]);
  assert.deepEqual(merged.applied_paths, ["/items/0/amount"]);
  assert.deepEqual(merged.stable_array_evidence_sha256, [arrayRule.evidence_sha256]);
});

test("take-candidate conflict evidence is logged only when the exact rule resolves a conflict", () => {
  const entityKey = "sources/s1@01.00.000";
  const rule = fixtureBoundRule({
    entityKey,
    pointer: "/name",
    oldValue: "old",
    candidateValue: "candidate",
    currentValue: "owner",
    mode: "take_candidate",
    evidence: { source: "reviewed-take-candidate" },
  });
  const merged = mergeThreeWay({
    oldValue: { name: "old" },
    candidateValue: { name: "candidate" },
    currentValue: { name: "owner" },
    entityKey,
    tablePolicy: tablePolicy({ conflict_rules: [rule] }),
  });
  assert.deepEqual(merged.value, { name: "candidate" });
  assert.deepEqual(merged.take_candidate_evidence_sha256, [rule.evidence_sha256]);
  assert.deepEqual(merged.preserve_owner_evidence_sha256, []);
});

test("array reorder and duplicate element identity cannot inherit a stable-array rule", () => {
  const entityKey = "processes/p-array@01.00.000";
  const oldItems = [
    { id: "a", amount: 1 },
    { id: "b", amount: 1 },
  ];
  const candidateItems = [
    { id: "b", amount: 2 },
    { id: "a", amount: 1 },
  ];
  const currentItems = [
    { id: "a", amount: 1 },
    { id: "b", amount: 3 },
  ];
  const reorderedRule = fixtureBoundRule({
    entityKey,
    pointer: "/items",
    oldValue: oldItems,
    candidateValue: candidateItems,
    currentValue: currentItems,
    mode: "stable_identity_by_index_v1",
    element_identity_pointer: "/id",
    evidence: { source: "array-review" },
  });
  const reordered = mergeThreeWay({
    oldValue: { items: oldItems },
    candidateValue: { items: candidateItems },
    currentValue: { items: currentItems },
    entityKey,
    tablePolicy: tablePolicy({ array_merge_rules: [reorderedRule] }),
  });
  assert.deepEqual(reordered.conflicts, [{ pointer: "/items", reason: "array_identity_unstable" }]);

  const duplicateItems = [
    { id: "a", amount: 1 },
    { id: "a", amount: 3 },
  ];
  const duplicateRule = fixtureBoundRule({
    entityKey,
    pointer: "/items",
    oldValue: duplicateItems,
    candidateValue: duplicateItems.map((row, index) => ({ ...row, amount: index + 4 })),
    currentValue: duplicateItems.map((row, index) => ({ ...row, amount: index + 6 })),
    mode: "stable_identity_by_index_v1",
    element_identity_pointer: "/id",
    evidence: { source: "array-review" },
  });
  const duplicate = mergeThreeWay({
    oldValue: { items: duplicateItems },
    candidateValue: {
      items: duplicateItems.map((row, index) => ({ ...row, amount: index + 4 })),
    },
    currentValue: {
      items: duplicateItems.map((row, index) => ({ ...row, amount: index + 6 })),
    },
    entityKey,
    tablePolicy: tablePolicy({ array_merge_rules: [duplicateRule] }),
  });
  assert.deepEqual(duplicate.conflicts, [{ pointer: "/items", reason: "array_identity_unstable" }]);
});

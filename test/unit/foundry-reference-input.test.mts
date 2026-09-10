import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import Ajv2020 from "ajv/dist/2020.js";
import { parseFoundryReferenceInput } from "../../scripts/lib/foundry-reference-input.ts";

const sample = () => ({
  schema: "tiangong-foundry.reference-input.v1",
  task_id: `task-${"a".repeat(64)}-r0001`,
  actor_id: "actor",
  rows_manifest_sha256: "b".repeat(64),
  dataset_type: "process",
  qa_reference_rows: [{ file: "flows.jsonl", sha256: "c".repeat(64) }],
  intent: null,
  review_files: [],
});
test("reference input schema and parser retain explicit scope and immutable file choices", () => {
  const Ajv = Ajv2020 as unknown as new (options: { strict: boolean }) => {
    compile: (schema: unknown) => (value: unknown) => boolean;
  };
  const validate = new Ajv({ strict: true }).compile(
    JSON.parse(
      fs.readFileSync(
        new URL("../../specs/schemas/foundry-reference-input.schema.json", import.meta.url),
        "utf8",
      ),
    ),
  );
  const original = sample(),
    parsed = parseFoundryReferenceInput(original);
  assert.equal(validate(original), true);
  assert.ok(
    Object.isFrozen(parsed) &&
      Object.isFrozen(parsed.qa_reference_rows) &&
      Object.isFrozen(parsed.qa_reference_rows[0]),
  );
  for (const change of [
    { schema: "old" },
    { dataset_type: "flow" },
    { qa_reference_rows: [] },
    { task_id: "other" },
    { rows_manifest_sha256: "latest" },
    { runtime_manifest: "override" },
    { intent: { file: "intent.json", sha256: "d".repeat(64) } },
  ]) {
    const value = { ...original, ...change };
    assert.equal(validate(value), false, JSON.stringify(change));
    assert.throws(() => parseFoundryReferenceInput(value));
  }
  const withIntent = {
    ...original,
    dataset_type: "flow",
    qa_reference_rows: [],
    intent: { file: "intent.json", sha256: "d".repeat(64) },
    review_files: [{ file: "review.json", sha256: "e".repeat(64) }],
  };
  assert.equal(validate(withIntent), true);
  assert.ok(Object.isFrozen(parseFoundryReferenceInput(withIntent).intent));
});

import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import Ajv2020 from "ajv/dist/2020.js";
import { parseFoundrySemanticInput } from "../../scripts/lib/foundry-semantic-input.ts";

const input = () => ({
  schema: "tiangong-foundry.semantic-input.v1",
  task_id: `task-${"a".repeat(64)}-r0001`,
  actor_id: "actor",
  assessment_sha256: "b".repeat(64),
  submissions: [
    {
      kind: "patch",
      authoring_task_sha256: "c".repeat(64),
      file: "review/patch.json",
      sha256: "d".repeat(64),
    },
  ],
});

test("semantic input binds immutable task/work-item and patch content facts", () => {
  const parsed = parseFoundrySemanticInput(input());
  assert.equal(parsed.submissions[0].file, "review/patch.json");
  assert.equal(Object.isFrozen(parsed), true);
  assert.equal(Object.isFrozen(parsed.submissions), true);
  assert.equal(Object.isFrozen(parsed.submissions[0]), true);
});

test("semantic submission kinds admit supported owners and reject unknown input", () => {
  for (const kind of ["patch", "classification", "location", "identity"]) {
    const value = input();
    value.submissions[0].kind = kind;
    assert.equal(parseFoundrySemanticInput(value).submissions[0].kind, kind);
  }
  const unsupported = input();
  unsupported.submissions[0].kind = "remote-write";
  assert.throws(() => parseFoundrySemanticInput(unsupported));
});

test("semantic input rejects duplicate work, source overrides and unbounded selectors", () => {
  const duplicate = input();
  duplicate.submissions.push({ ...duplicate.submissions[0] });
  assert.throws(() => parseFoundrySemanticInput(duplicate));
  assert.throws(() =>
    parseFoundrySemanticInput({ ...input(), runtime_manifest: "untrusted.json" }),
  );
  const invalid = input();
  invalid.submissions[0].file = "patch.json\n--commit";
  assert.throws(() => parseFoundrySemanticInput(invalid));
  assert.throws(() => parseFoundrySemanticInput({ ...input(), assessment_sha256: "latest" }));
  assert.throws(() => parseFoundrySemanticInput({ ...input(), submissions: [] }));
});

test("semantic input schema agrees with the supported file and identity forms", () => {
  const Ajv = Ajv2020 as unknown as new (options: { strict: boolean }) => {
    compile: (schema: unknown) => (value: unknown) => boolean;
  };
  const schema = JSON.parse(
    fs.readFileSync(
      new URL("../../specs/schemas/foundry-semantic-input.schema.json", import.meta.url),
      "utf8",
    ),
  );
  const validate = new Ajv({ strict: true }).compile(schema);
  assert.equal(validate(input()), true);
  for (const kind of ["classification", "location", "identity", "remote-write"]) {
    const value = input();
    value.submissions[0].kind = kind;
    assert.equal(validate(value), kind !== "remote-write");
  }
  const invalid = input();
  invalid.submissions[0].file = "patch\n.json";
  assert.equal(validate(invalid), false);
  assert.equal(validate({ ...input(), runtime_manifest: "override.json" }), false);
});

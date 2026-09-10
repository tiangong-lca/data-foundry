import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import Ajv2020 from "ajv/dist/2020.js";
import { parseFoundryAuthorizationInput } from "../../scripts/lib/foundry-authorization-input.ts";

const input = () => ({
  schema: "tiangong-foundry.authorization-input.v1",
  task_id: `task-${"a".repeat(64)}-r0001`,
  actor_id: "actor",
  finalization_sha256: "b".repeat(64),
  dataset_type: "flow",
  input_kind: "final_rows",
  input_sha256: "c".repeat(64),
  expected_previous_sha256: null,
  grant: { file: "review/grant.json", sha256: "d".repeat(64) },
  evidence: [
    {
      id: "user-approval",
      kind: "user-decision",
      file: "review/approval.txt",
      sha256: "e".repeat(64),
    },
  ],
});

test("approval input selects grant and evidence independently and freezes its intent", () => {
  const parsed = parseFoundryAuthorizationInput(input());
  assert.equal(parsed.input_kind, "final_rows");
  assert.equal(
    parseFoundryAuthorizationInput({ ...input(), input_kind: "current_rows" }).input_kind,
    "current_rows",
  );
  assert.ok(
    Object.isFrozen(parsed) &&
      Object.isFrozen(parsed.grant) &&
      Object.isFrozen(parsed.evidence) &&
      Object.isFrozen(parsed.evidence[0]),
  );
  const duplicate = input();
  duplicate.evidence.push({ ...duplicate.evidence[0], file: "review/second.txt" });
  assert.throws(() => parseFoundryAuthorizationInput(duplicate));
  assert.throws(() =>
    parseFoundryAuthorizationInput({ ...input(), runtime_manifest: "override.json" }),
  );
  assert.throws(() =>
    parseFoundryAuthorizationInput({ ...input(), expected_previous_sha256: "latest" }),
  );
});

test("native execution selection is explicit, content-bound and limited to finalized insert types", () => {
  const execution_contract = { file: "review/insert.json", sha256: "f".repeat(64) };
  for (const dataset_type of ["flow", "process", "source"]) {
    const parsed = parseFoundryAuthorizationInput({ ...input(), dataset_type, execution_contract });
    assert.deepEqual(parsed.execution_contract, execution_contract);
    assert.ok(Object.isFrozen(parsed.execution_contract));
  }
  for (const change of [
    { input_kind: "current_rows" },
    { dataset_type: "unitgroup" },
    { dataset_type: "contact" },
    { execution_contract: { file: "review/insert.json", sha256: "latest" } },
    { execution_contract: { ...execution_contract, optional: true } },
  ])
    assert.throws(() =>
      parseFoundryAuthorizationInput({ ...input(), execution_contract, ...change }),
    );
  assert.equal(Object.hasOwn(parseFoundryAuthorizationInput(input()), "execution_contract"), false);
});

test("approval schema and parser reject missing user evidence and unsupported scope selectors", () => {
  const Ajv = Ajv2020 as unknown as new (options: { strict: boolean }) => {
    compile: (schema: unknown) => (value: unknown) => boolean;
  };
  const validate = new Ajv({ strict: true }).compile(
    JSON.parse(
      fs.readFileSync(
        new URL("../../specs/schemas/foundry-authorization-input.schema.json", import.meta.url),
        "utf8",
      ),
    ),
  );
  assert.equal(validate(input()), true);
  const native = {
    ...input(),
    execution_contract: { file: "insert.json", sha256: "f".repeat(64) },
  };
  for (const dataset_type of ["flow", "process", "source"])
    assert.equal(validate({ ...native, dataset_type }), true);
  for (const change of [
    { input_kind: "current_rows" },
    { dataset_type: "contact" },
    { execution_contract: { file: "insert.json", sha256: "latest" } },
  ])
    assert.equal(validate({ ...native, ...change }), false);
  for (const change of [
    { input_kind: "any_rows" },
    { finalization_sha256: "latest" },
    { evidence: [] },
    { dataset_type: "*" },
  ]) {
    const value = { ...input(), ...change };
    assert.equal(validate(value), false);
    assert.throws(() => parseFoundryAuthorizationInput(value));
  }
  const noUser = input();
  noUser.evidence[0].kind = "source-model";
  assert.equal(validate(noUser), false);
  assert.throws(() => parseFoundryAuthorizationInput(noUser));
});

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import Ajv2020 from "ajv/dist/2020.js";

const schemaRoot = path.resolve(import.meta.dirname, "../../specs/schemas");
const digest = "1".repeat(64);
const fact = { path: "/selected/input.jsonl", bytes: 12, sha256: digest };
type SchemaValidator = ((value: unknown) => boolean) & { errors?: unknown };
const Ajv2020Constructor = Ajv2020 as unknown as new (options: { strict: boolean }) => {
  compile: (schema: unknown) => SchemaValidator;
};

function validator(name: string) {
  const schema = JSON.parse(fs.readFileSync(path.join(schemaRoot, name), "utf8"));
  return new Ajv2020Constructor({ strict: true }).compile(schema);
}

test("runtime authority documents have strict reviewable machine schemas", () => {
  const tidas = validator("tidas-runtime-expectation.schema.json");
  assert.equal(
    tidas({
      schema: "tiangong-foundry.tidas-runtime-expectation.v1",
      platform: "darwin-arm64",
      binary_version: "0.2.1",
      executable: { bytes: 42, sha256: digest },
      validation: {
        schema_version: "tidas.validation-describe.v1",
        asset_fingerprint: digest,
        protocols: ["document-validation-batch.v1"],
        event_schema_versions: ["tidas.validation-final-event.v1"],
      },
    }),
    true,
    JSON.stringify(tidas.errors),
  );
  assert.equal(
    tidas({
      schema: "tiangong-foundry.tidas-runtime-expectation.v1",
      platform: "darwin-x64",
      binary_version: "0.2.1",
      executable: { bytes: 42, sha256: digest },
      validation: {
        schema_version: "tidas.validation-describe.v1",
        asset_fingerprint: digest,
        protocols: ["document-validation-batch.v1"],
        event_schema_versions: ["tidas.validation-final-event.v1"],
      },
    }),
    false,
  );

  const qualification = validator("runtime-qualification.schema.json");
  assert.equal(
    qualification({
      schema: "tiangong-foundry.runtime-qualification.v1",
      qualification_sha256: digest,
      cli: {
        package_version: "0.1.11",
        platform: "darwin-arm64",
        content_sha256: digest,
        node_version: "24.19.0",
        node_sha256: digest,
      },
      tidas: {
        binary_version: "0.2.1",
        executable: { bytes: 42, sha256: digest },
        asset_fingerprint: digest,
        protocols: ["document-validation-batch.v1"],
        event_schema_versions: ["tidas.validation-final-event.v1"],
      },
    }),
    true,
    JSON.stringify(qualification.errors),
  );

  const execution = validator("execution-context.schema.json");
  const executionDocument = {
    schema: "tiangong-foundry.execution-context.v1",
    workspace_id: "workspace",
    task_id: "task",
    actor_id: "actor",
    command: "dataset-commit-handoff-plan",
    qualification_sha256: digest,
    authorization_sha256: digest,
    approved_input: fact,
    final_rows: fact,
    required_actions: ["unitgroup_write"],
    required_qa_waivers: [],
    command_spec_sha256: digest,
  };
  assert.equal(execution(executionDocument), true, JSON.stringify(execution.errors));
  assert.equal(execution({ ...executionDocument, required_actions: ["publish"] }), false);

  const derivation = validator("authorization-derivation.schema.json");
  assert.equal(
    derivation({
      schema: "tiangong-foundry.authorization-derivation.v1",
      parent_authorization_sha256: digest,
      derived_authorization_sha256: "2".repeat(64),
      approved_input: fact,
      derived_input: { ...fact, path: "/selected/derived.jsonl", sha256: "3".repeat(64) },
    }),
    true,
    JSON.stringify(derivation.errors),
  );
});

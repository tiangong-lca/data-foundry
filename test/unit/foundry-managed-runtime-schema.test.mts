import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { Ajv2020 } from "ajv/dist/2020.js";

const read = (name: string): unknown =>
  JSON.parse(fs.readFileSync(new URL(`../../specs/schemas/${name}`, import.meta.url), "utf8"));

test("managed runtime metadata has a strict portable structural contract", () => {
  const validate = new Ajv2020({ strict: true })
    .addSchema(read("tidas-runtime-expectation.schema.json") as object)
    .compile(read("foundry-managed-runtime.schema.json") as object);
  const digest = "1".repeat(64);
  const value = {
    schema: "tiangong-foundry.managed-runtime.v1",
    platform: "darwin-arm64",
    cli: {
      schema: "tiangong-lca.cli-runtime-expectation.v1",
      package_version: "0.1.11",
      platform: "darwin-arm64",
      content_sha256: digest,
      node_version: "24.19.0",
      node_sha256: digest,
    },
    tidas: {
      executable: { component: "native", path: "bin/tidas" },
      expectation: {
        schema: "tiangong-foundry.tidas-runtime-expectation.v1",
        platform: "darwin-arm64",
        binary_version: "0.2.2",
        executable: { bytes: 42, sha256: digest },
        validation: {
          schema_version: "tidas.validation-describe.v1",
          asset_fingerprint: digest,
          protocols: ["document-validation-batch.v1"],
          event_schema_versions: ["tidas.validation-final-event.v1"],
        },
      },
    },
    launches: [{ id: "foundry", access: "write", target: null }],
  };
  assert.equal(validate(value), true, JSON.stringify(validate.errors));
  assert.equal(
    validate({
      ...value,
      launches: [
        {
          id: "foundry-rollback",
          access: "write",
          target: { component: "application", path: "metadata/previous-runtime.json" },
        },
      ],
    }),
    true,
  );
  for (const invalid of [
    { ...value, schema: "tiangong-foundry.managed-runtime.v999" },
    { ...value, platform: "darwin-x64" },
    { ...value, credential: "unwanted" },
    { ...value, launches: [] },
    { ...value, launches: [value.launches[0], value.launches[0]] },
    { ...value, launches: [{ ...value.launches[0], access: "force-write" }] },
    {
      ...value,
      launches: [{ ...value.launches[0], target: "https://untrusted.invalid/manifest.json" }],
    },
    { ...value, cli: { ...value.cli, package_version: "0.1.10" } },
    Object.fromEntries(Object.entries(value).filter(([key]) => key !== "cli")),
  ])
    assert.equal(validate(invalid), false, JSON.stringify(invalid));
  for (const selected of [
    "",
    "/escape",
    "../escape",
    "a/../b",
    "a/./b",
    "a\\b",
    "a//b",
    "a/",
    "C:/b",
    "a\0b",
  ])
    assert.equal(
      validate({
        ...value,
        tidas: { ...value.tidas, executable: { component: "native", path: selected } },
      }),
      false,
      selected,
    );
});

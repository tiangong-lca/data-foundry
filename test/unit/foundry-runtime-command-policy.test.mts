import assert from "node:assert/strict";
import test from "node:test";
import { knownCommands } from "../../scripts/lib/foundry-command-registry.ts";
import { commandMetadata } from "../../scripts/lib/foundry-command-metadata.ts";
import {
  foundryRuntimeCommandPolicies,
  foundryRuntimeCommandPolicy,
} from "../../scripts/lib/foundry-runtime-command-policy.ts";

const hasCode = (code: string) => (error: unknown) =>
  Boolean(error && typeof error === "object" && "code" in error && error.code === code);

test("all internal commands have one explicit runtime and path ownership disposition", () => {
  assert.equal(foundryRuntimeCommandPolicies.length, knownCommands.length);
  assert.equal(new Set(foundryRuntimeCommandPolicies.map((item) => item.command)).size, 63);
  assert.deepEqual(
    foundryRuntimeCommandPolicies.map((item) => item.command),
    knownCommands,
  );
  assert.deepEqual(Object.keys(commandMetadata).sort(), [...knownCommands].sort());
  for (const policy of foundryRuntimeCommandPolicies) {
    assert.equal(Object.isFrozen(policy), true);
    assert.equal(Object.isFrozen(policy.declared_inputs), true);
    assert.equal(Object.isFrozen(policy.declared_outputs), true);
    assert.equal(policy.asset_root, "runtime");
    if (policy.disposition === "developer-maintenance") {
      assert.equal(policy.distribution, "excluded");
      assert.equal(policy.output_root, "none");
    }
    if (
      ["native-runtime-stage", "task-stage"].includes(policy.disposition) &&
      policy.command !== "tidas-handshake"
    ) {
      assert.equal(policy.input_root, "task-lineage");
      assert.equal(policy.output_root, "task-artifacts");
    }
    assert.equal(
      policy.runtime_qualification,
      policy.child_process === "none" ? "not-required" : "required-before-child",
    );
  }
});

test("public facade adapters stay narrow and nested stages retain their guards", () => {
  assert.deepEqual(
    foundryRuntimeCommandPolicies
      .filter((policy) => policy.distribution === "public-facade")
      .map((policy) => [policy.command, policy.facade_operation]),
    [
      ["init", "workspace.init"],
      ["doctor", "doctor"],
    ],
  );
  assert.deepEqual(foundryRuntimeCommandPolicy("dataset-tidas-validate"), {
    ...foundryRuntimeCommandPolicy("dataset-tidas-validate"),
    disposition: "native-runtime-stage",
    child_process: "tidas",
    runtime_qualification: "required-before-child",
  });
  assert.equal(foundryRuntimeCommandPolicy("dataset-tidas-validate").authorization, "not-required");
  assert.equal(
    foundryRuntimeCommandPolicy("dataset-curation-cleanup").authorization,
    "not-required",
  );
  assert.equal(foundryRuntimeCommandPolicy("dataset-curation-cleanup").child_process, "none");
  const handoff = foundryRuntimeCommandPolicy("dataset-commit-handoff-plan");
  assert.equal(handoff.distribution, "internal-only");
  assert.equal(handoff.authorization, "required-before-restricted-action");
  assert.throws(
    () => foundryRuntimeCommandPolicy("constructor"),
    hasCode("runtime_command_unknown"),
  );
  assert.throws(() => foundryRuntimeCommandPolicy("unknown"), hasCode("runtime_command_unknown"));
});

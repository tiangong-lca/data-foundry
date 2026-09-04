import assert from "node:assert/strict";
import test from "node:test";
import {
  FOUNDRY_TASK_START_SPEC_SCHEMA,
  parseFoundryTaskStartSpec,
  taskStartSpecFingerprint,
} from "../../scripts/lib/foundry-task-start-spec.ts";

const base = {
  schema: FOUNDRY_TASK_START_SPEC_SCHEMA,
  request_id: "request-001",
  actor_id: "agent/session-001",
  lane: "external-dataset-curated-import",
  profile_id: "generic",
  target_entities: ["flow"],
  sources: [{ path: "inputs/flow.json" }],
  seed: null,
  account_intent: null,
  preparation: {
    operation: "dataset-curation-cleanup",
    type: "flow",
    input: "inputs/flow.json",
    source_input: null,
    output_directory: "outputs/cleanup",
  },
};

test("task-start spec strictly freezes lane, actor, sources, seed, account and preparation", () => {
  const parsed = parseFoundryTaskStartSpec(base);
  assert.equal(Object.isFrozen(parsed), true);
  assert.equal(Object.isFrozen(parsed.sources), true);
  assert.deepEqual(parsed, base);
  const fingerprint = taskStartSpecFingerprint(parsed, [
    { path: "/project/inputs/flow.json", bytes: 42, sha256: "1".repeat(64) },
  ]);
  assert.match(fingerprint, /^[0-9a-f]{64}$/u);
  assert.equal(
    taskStartSpecFingerprint(parsed, [
      { path: "/moved/flow.json", bytes: 42, sha256: "1".repeat(64) },
    ]) === fingerprint,
    false,
  );
});

test("source-evidence specs require one selected JSON seed and every preparation input", () => {
  assert.throws(() =>
    parseFoundryTaskStartSpec({
      ...base,
      lane: "source-evidence-dataset-development",
      seed: null,
    }),
  );
  assert.throws(() =>
    parseFoundryTaskStartSpec({
      ...base,
      preparation: { ...base.preparation, input: "inputs/not-selected.json" },
    }),
  );
  const parsed = parseFoundryTaskStartSpec({
    ...base,
    lane: "source-evidence-dataset-development",
    seed: { path: "inputs/seed.json" },
    sources: [...base.sources, { path: "inputs/seed.json" }],
  });
  assert.deepEqual(parsed.seed, { path: "inputs/seed.json" });
});

test("task-start spec rejects duplicates, credentials, unknown fields and malformed intent", () => {
  assert.throws(() => parseFoundryTaskStartSpec({ ...base, extra: true }));
  assert.throws(() =>
    parseFoundryTaskStartSpec({ ...base, sources: [base.sources[0], base.sources[0]] }),
  );
  assert.throws(() => parseFoundryTaskStartSpec({ ...base, sources: [{ path: ".env" }] }));
  assert.throws(() =>
    parseFoundryTaskStartSpec({
      ...base,
      account_intent: { project_ref: "short", user_id: "not-a-uuid", session_reference: null },
    }),
  );
});

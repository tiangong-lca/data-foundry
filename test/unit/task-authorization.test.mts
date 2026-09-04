import assert from "node:assert/strict";
import test from "node:test";
import {
  taskAuthorizationAllows,
  taskAuthorizationMatches,
  taskAuthorizationWaivesQa,
  validateTaskAuthorization,
} from "../../scripts/lib/task-authorization.ts";
import { taskAuthorizationFixture } from "../fixtures/task-authorizations.ts";

test("only exact task intent yields immutable, action-specific draft exceptions", () => {
  const fixture = taskAuthorizationFixture();
  fixture.authorization.allowed_actions = ["elementary_flow_create_new"];
  const result = validateTaskAuthorization(fixture.authorization, fixture.binding, fixture.nowMs);
  assert.equal(result.status, "authorized");
  assert.equal(
    taskAuthorizationAllows(result.authorization, "elementary_flow_create_new", fixture.nowMs),
    true,
  );
  assert.equal(
    taskAuthorizationAllows(result.authorization, "elementary_flow_write", fixture.nowMs),
    false,
  );
  assert.equal(
    taskAuthorizationAllows(result.authorization, "flowproperty_write", fixture.nowMs),
    false,
  );
  assert.equal(
    taskAuthorizationMatches(result.authorization, fixture.binding, fixture.nowMs),
    true,
  );
  assert.equal(
    taskAuthorizationAllows(
      JSON.parse(JSON.stringify(result.authorization)),
      "elementary_flow_create_new",
      fixture.nowMs,
    ),
    false,
  );
  assert.throws(
    () => Object.assign(result.authorization, { allowed_actions: ["unitgroup_write"] }),
    TypeError,
  );
  assert.throws(
    () => Object.assign(result.authorization.binding, { task_id: "other-task" }),
    TypeError,
  );
  fixture.authorization.allowed_actions.push("elementary_flow_write");
  assert.equal(
    taskAuthorizationAllows(result.authorization, "elementary_flow_write", fixture.nowMs),
    false,
  );
});

test("missing, mismatched and legacy approvals never authorize affected operations", () => {
  const { authorization, binding, nowMs } = taskAuthorizationFixture();
  assert.equal(validateTaskAuthorization(null, binding, nowMs).status, "missing");
  assert.equal(
    validateTaskAuthorization({ enabled: true, authorized_by: "legacy" }, binding, nowMs).status,
    "invalid",
  );
  for (const key of Object.keys(binding) as (keyof typeof binding)[]) {
    const expected = { ...binding, [key]: key.endsWith("_sha256") ? "f".repeat(64) : "different" };
    assert.equal(validateTaskAuthorization(authorization, expected, nowMs).status, "invalid", key);
  }
  for (const action of ["publish", "delete", "*", "full_context_identity_relaxation"]) {
    assert.equal(
      validateTaskAuthorization({ ...authorization, allowed_actions: [action] }, binding, nowMs)
        .status,
      "invalid",
      action,
    );
  }
  assert.equal(
    validateTaskAuthorization({ ...authorization, remote_state_code: 100 }, binding, nowMs).status,
    "invalid",
  );
  assert.equal(
    validateTaskAuthorization({ ...authorization, replay: true }, binding, nowMs).status,
    "invalid",
  );
  assert.equal(
    validateTaskAuthorization(
      { ...authorization, binding: { ...binding, extra: "ignored" } },
      binding,
      nowMs,
    ).status,
    "invalid",
  );
});

test("scope grants expire, reject future/malformed lifetime and cannot be extended after validation", () => {
  const { authorization, binding, nowMs } = taskAuthorizationFixture();
  const result = validateTaskAuthorization(authorization, binding, nowMs);
  const expiry = Date.parse(authorization.expires_at_utc);
  assert.equal(taskAuthorizationAllows(result.authorization, "unitgroup_write", expiry), false);
  for (const times of [
    { expires_at_utc: new Date(nowMs).toISOString() },
    { issued_at_utc: new Date(nowMs + 6_000).toISOString() },
    { issued_at_utc: "2026-02-30T00:00:00.000Z" },
    { expires_at_utc: new Date(nowMs + 86_400_001).toISOString() },
    { issued_at_utc: "2026-09-04" },
  ])
    assert.equal(
      validateTaskAuthorization({ ...authorization, ...times }, binding, nowMs).status,
      "invalid",
    );
  assert.equal(validateTaskAuthorization(authorization, binding, Number.NaN).status, "invalid");
});

test("material balance needs both approval and exact source-model evidence, without waiving other gates", () => {
  const { authorization, binding, nowMs } = taskAuthorizationFixture();
  authorization.qa_waivers = [
    {
      dataset_type: "process",
      code: "process_material_balance_deviation",
      evidence_ids: ["model"],
    },
  ];
  assert.equal(validateTaskAuthorization(authorization, binding, nowMs).status, "invalid");
  authorization.evidence.push({
    id: "model",
    kind: "source-model",
    reference: "fixture/source-model.json",
    sha256: "b".repeat(64),
  });
  const result = validateTaskAuthorization(authorization, binding, nowMs);
  assert.equal(result.status, "authorized");
  assert.equal(
    taskAuthorizationWaivesQa(
      result.authorization,
      "process",
      "process_material_balance_deviation",
      nowMs,
    ),
    true,
  );
  assert.equal(
    taskAuthorizationWaivesQa(
      result.authorization,
      "flow",
      "process_material_balance_deviation",
      nowMs,
    ),
    false,
  );
  for (const code of [
    "canonical_support_amount_scaling_required",
    "canonical_support_amount_scale_unresolved",
    "schema_not_valid",
    "missing_dataset",
  ]) {
    assert.equal(taskAuthorizationWaivesQa(result.authorization, "process", code, nowMs), false);
    assert.equal(
      validateTaskAuthorization(
        { ...authorization, qa_waivers: [{ ...authorization.qa_waivers[0], code }] },
        binding,
        nowMs,
      ).status,
      "invalid",
    );
  }
  assert.equal(
    validateTaskAuthorization(
      { ...authorization, evidence: authorization.evidence.slice(1) },
      binding,
      nowMs,
    ).status,
    "invalid",
  );
});

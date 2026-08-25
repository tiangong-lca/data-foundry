import assert from "node:assert/strict";
import test from "node:test";

import {
  accountModeForVerifiedIdentity,
  acceptedRemoteDifferencePolicy,
  assertAuthoritativeCommand,
  assertReceiptBoundHandoffAccount,
} from "../../scripts/lib/production-case-policy.ts";

test("production test-account cases reject every accepted remote difference", () => {
  assert.equal(
    accountModeForVerifiedIdentity({
      projectRef: "qgzvkongdjqiiamzbbts",
      userId: "c536ee37-64ab-427b-b7e3-4e2bb4fdffb7",
    }),
    "production-test",
  );
  assert.equal(
    accountModeForVerifiedIdentity({
      projectRef: "another-project",
      userId: "11111111-1111-4111-8111-111111111111",
    }),
    "ordinary",
  );
  assert.deepEqual(acceptedRemoteDifferencePolicy({ accountMode: "production-test" }), {
    traceHashOnly: false,
    foreignStateZeroReference: false,
  });
  assert.deepEqual(acceptedRemoteDifferencePolicy({ accountMode: "ordinary" }), {
    traceHashOnly: true,
    foreignStateZeroReference: false,
  });
});

test("case and handoff commands require an argv array; display text is never executable", () => {
  assert.deepEqual(
    assertAuthoritativeCommand({
      executable: "node",
      argv: ["cli.js", "dataset", "verify-remote", "--json"],
      display: "node cli.js dataset verify-remote --json",
    }),
    { executable: "node", argv: ["cli.js", "dataset", "verify-remote", "--json"] },
  );
  assert.throws(() =>
    assertAuthoritativeCommand({
      executable: "",
      argv: [],
      display: "node cli.js dataset verify-remote --json",
    }),
  );
});

test("receipt-bound runners reject stale or cross-account handoff plans", () => {
  const env = {
    FOUNDRY_VERIFIED_PROJECT_REF: "qgzvkongdjqiiamzbbts",
    FOUNDRY_VERIFIED_USER_ID: "c536ee37-64ab-427b-b7e3-4e2bb4fdffb7",
    FOUNDRY_ACCOUNT_MODE: "production-test",
  };
  const plan = {
    verified_project_ref: env.FOUNDRY_VERIFIED_PROJECT_REF,
    verified_user_id: env.FOUNDRY_VERIFIED_USER_ID,
    target_user_id: env.FOUNDRY_VERIFIED_USER_ID,
    account_mode: env.FOUNDRY_ACCOUNT_MODE,
  };
  assert.doesNotThrow(() => assertReceiptBoundHandoffAccount(plan, env));
  for (const changed of [
    { ...plan, account_mode: "ordinary" },
    { ...plan, verified_project_ref: null },
    { ...plan, verified_user_id: "11111111-1111-4111-8111-111111111111" },
    { ...plan, target_user_id: "11111111-1111-4111-8111-111111111111" },
  ]) {
    assert.throws(() => assertReceiptBoundHandoffAccount(changed, env));
  }
});

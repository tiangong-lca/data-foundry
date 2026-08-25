import assert from "node:assert/strict";
import test from "node:test";

import {
  accountModeForVerifiedIdentity,
  assertReceiptBoundHandoffAccount,
  traceHashNormalizationAllowed,
} from "../../scripts/lib/production-case-policy.ts";

test("verified test accounts disable traceHash normalization", () => {
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
  assert.equal(traceHashNormalizationAllowed({ account_mode: "production-test" }), false);
  assert.equal(traceHashNormalizationAllowed({ account_mode: "ordinary" }), true);
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
  assert.throws(() => assertReceiptBoundHandoffAccount(plan, {}));
  assert.doesNotThrow(() =>
    assertReceiptBoundHandoffAccount(
      {
        verified_project_ref: null,
        verified_user_id: null,
        target_user_id: "legacy-user",
        account_mode: "ordinary",
      },
      {},
    ),
  );
  for (const changed of [
    { ...plan, account_mode: "ordinary" },
    { ...plan, verified_project_ref: null },
    { ...plan, verified_user_id: "11111111-1111-4111-8111-111111111111" },
    { ...plan, target_user_id: "11111111-1111-4111-8111-111111111111" },
  ]) {
    assert.throws(() => assertReceiptBoundHandoffAccount(changed, env));
  }
});

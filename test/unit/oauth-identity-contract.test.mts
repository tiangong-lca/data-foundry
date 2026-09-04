import assert from "node:assert/strict";
import test from "node:test";
import { parseFreshIntentBoundAuthReceipt } from "../../scripts/lib/identity-preflight-proof.ts";
import { testAuthIdentityReceipt } from "../fixtures/auth-identity-receipt.ts";

const nowMs = Date.parse("2026-09-04T08:00:00.000Z");
const expectedProjectRef = "exampleprojectref";
const expectedUserId = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const options = { nowMs, maxAgeMs: 60_000, expectedProjectRef, expectedUserId };

function oauthReceipt(source = "cache", overrides: Record<string, unknown> = {}) {
  return testAuthIdentityReceipt({
    projectRef: expectedProjectRef,
    userId: expectedUserId,
    packageVersion: "0.1.8",
    capturedAtUtc: "2026-09-04T07:59:45.000Z",
    scopeOverrides: {
      session: {
        source,
        cache_mode: "custom-file",
        force_reauth: false,
        expires_at_utc: "2026-09-04T09:00:00.000Z",
      },
      ...overrides,
    },
  });
}

test("fresh real-OAuth-shaped identity proof accepts a persisted CLI session", () => {
  for (const source of ["cache", "memory", "refresh", "oauth_login"]) {
    const receipt = oauthReceipt(source);
    assert.equal(
      parseFreshIntentBoundAuthReceipt(receipt, options).receipt_scope_sha256,
      receipt.receipt_scope_sha256,
    );
  }
});

test("OAuth identity admission retains exact intent, TTL and tamper rejection", () => {
  for (const input of [
    oauthReceipt("access_token"),
    oauthReceipt("cache", { captured_at_utc: "2026-09-04T07:58:00.000Z" }),
    oauthReceipt("cache", { captured_at_utc: "2026-09-04T08:00:06.000Z" }),
    { ...oauthReceipt(), receipt_scope_sha256: "0".repeat(64) },
  ])
    assert.throws(() => parseFreshIntentBoundAuthReceipt(input, options));
  assert.throws(() =>
    parseFreshIntentBoundAuthReceipt(oauthReceipt(), {
      ...options,
      expectedProjectRef: "wrongproject",
    }),
  );
  assert.throws(() =>
    parseFreshIntentBoundAuthReceipt(oauthReceipt(), {
      ...options,
      expectedUserId: "11111111-1111-4111-8111-111111111111",
    }),
  );
});

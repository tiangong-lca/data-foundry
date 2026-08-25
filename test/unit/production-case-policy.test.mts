import assert from "node:assert/strict";
import test from "node:test";

import {
  accountModeForVerifiedIdentity,
  acceptedRemoteDifferencePolicy,
  assertAuthoritativeCommand,
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

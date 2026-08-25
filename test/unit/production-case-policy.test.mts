import assert from "node:assert/strict";
import test from "node:test";

import {
  acceptedRemoteDifferencePolicy,
  assertAuthoritativeCommand,
} from "../../scripts/lib/production-case-policy.ts";

test("production test-account cases reject every accepted remote difference", () => {
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

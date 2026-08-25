import assert from "node:assert/strict";
import test from "node:test";
import { modelExecutionAttemptDisposition } from "../../scripts/commands/execution-capsule.ts";

test("attempt model keeps pre-dispatch failures unconsumed", () => {
  assert.deepEqual(
    modelExecutionAttemptDisposition({
      dispatch_state: "NOT_DISPATCHED",
      readback_state: "NOT_STARTED",
    }),
    {
      disposition: "UNATTEMPTED",
      attempt_consumed: false,
      replay_allowed: true,
      terminal: false,
    },
  );
});

test("attempt model recovers ambiguous dispatch only through exact desired readback", () => {
  assert.deepEqual(
    modelExecutionAttemptDisposition({
      dispatch_state: "DISPATCH_UNKNOWN",
      readback_state: "EXACT_DESIRED",
    }),
    {
      disposition: "SUCCEEDED_RECOVERED_EXACT_READBACK",
      attempt_consumed: true,
      replay_allowed: false,
      terminal: true,
    },
  );
});

test("attempt model forbids replay after unresolved confirmed dispatch", () => {
  assert.deepEqual(
    modelExecutionAttemptDisposition({
      dispatch_state: "DISPATCH_CONFIRMED",
      readback_state: "MISSING",
    }),
    {
      disposition: "UNKNOWN_DO_NOT_REPLAY",
      attempt_consumed: true,
      replay_allowed: false,
      terminal: false,
    },
  );
});

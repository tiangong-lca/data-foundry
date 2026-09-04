import assert from "node:assert/strict";
import test from "node:test";
import {
  FOUNDRY_OPERATION_RESULT_SCHEMA,
  assertFoundryOperationResult,
  createFoundryOperationResult,
  exitCodeForFoundryOperationResult,
  foundryOperationPermissionStates,
  foundryOperationStatuses,
} from "../../scripts/lib/foundry-operation-result.ts";

test("public operation results have one exact immutable envelope and exit table", () => {
  assert.deepEqual(foundryOperationStatuses, [
    "ready",
    "running",
    "needs_auth",
    "needs_input",
    "blocked",
    "completed",
    "failed",
  ]);
  assert.deepEqual(foundryOperationPermissionStates, [
    "not_required",
    "required",
    "granted",
    "invalid",
  ]);
  const ready = createFoundryOperationResult({
    operation: "doctor",
    status: "ready",
    taskId: null,
    artifacts: [],
    blockers: [],
    nextActions: [],
    runtimeIdentity: { qualification: "required" },
    permissions: { state: "not_required", requested_actions: [], approval_reference: null },
  });
  assert.deepEqual(Object.keys(ready), [
    "schema",
    "operation",
    "status",
    "task_id",
    "artifacts",
    "blockers",
    "next_actions",
    "runtime_identity",
    "permissions",
  ]);
  assert.equal(ready.schema, FOUNDRY_OPERATION_RESULT_SCHEMA);
  assert.equal(Object.isFrozen(ready), true);
  assert.equal(Object.isFrozen(ready.permissions), true);
  assert.equal(exitCodeForFoundryOperationResult(ready), 0);
  assert.deepEqual(assertFoundryOperationResult(JSON.parse(JSON.stringify(ready))), ready);

  const exits = new Map([
    ["ready", 0],
    ["running", 0],
    ["completed", 0],
    ["failed", 1],
    ["needs_input", 2],
    ["needs_auth", 3],
    ["blocked", 4],
  ]);
  for (const [status, exit] of exits) {
    const result = createFoundryOperationResult({
      operation: "task.status",
      status,
      taskId: "task",
      artifacts: [],
      blockers: ["ready", "running", "completed"].includes(status)
        ? []
        : [{ code: "fixture", message: "fixture", scope: null }],
      nextActions: [],
      runtimeIdentity: null,
      permissions: { state: "not_required", requested_actions: [], approval_reference: null },
    });
    assert.equal(exitCodeForFoundryOperationResult(result), exit);
  }
  const interrupted = createFoundryOperationResult({
    operation: "task.resume",
    status: "failed",
    taskId: "task",
    artifacts: [],
    blockers: [{ code: "operation_interrupted", message: "Interrupted.", scope: null }],
    nextActions: [],
    runtimeIdentity: null,
    permissions: { state: "not_required", requested_actions: [], approval_reference: null },
  });
  assert.equal(exitCodeForFoundryOperationResult(interrupted), 130);
});

test("operation result validation rejects extra fields, display commands and malformed permissions", () => {
  const base = {
    schema: FOUNDRY_OPERATION_RESULT_SCHEMA,
    operation: "task.status",
    status: "ready",
    task_id: "task",
    artifacts: [],
    blockers: [],
    next_actions: [],
    runtime_identity: null,
    permissions: { state: "not_required", requested_actions: [], approval_reference: null },
  };
  assert.throws(() => assertFoundryOperationResult({ ...base, unexpected: true }));
  assert.throws(() =>
    assertFoundryOperationResult({
      ...base,
      permissions: { ...base.permissions, state: "approved" },
    }),
  );
  assert.throws(() =>
    assertFoundryOperationResult({
      ...base,
      next_actions: [{ kind: "command", display: "sh -c anything" }],
    }),
  );
});

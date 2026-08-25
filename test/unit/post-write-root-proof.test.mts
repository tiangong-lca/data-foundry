import assert from "node:assert/strict";
import test from "node:test";

import { validateUniqueRootReadbacks } from "../../scripts/lib/post-write-root-proof.ts";

const intended = [
  {
    rowIndex: 0,
    table: "contacts",
    id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeee1",
    version: "00.00.001",
    payloadSha256: "1".repeat(64),
  },
  {
    rowIndex: 1,
    table: "contacts",
    id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeee2",
    version: "00.00.001",
    payloadSha256: "2".repeat(64),
  },
];

function check(index: number) {
  const row = intended[index];
  return {
    role: "root",
    row_index: row.rowIndex,
    table: row.table,
    id: row.id,
    version: row.version,
    path: `/contactDataSet#readback`,
    status: "ok",
    local_payload_sha256: row.payloadSha256,
    remote_payload_sha256: row.payloadSha256,
    remote_user_id: "c536ee37-64ab-427b-b7e3-4e2bb4fdffb7",
    remote_state_code: 0,
  };
}

test("post-write proof requires each intended root exactly once", () => {
  const passed = validateUniqueRootReadbacks({
    intended,
    checks: [check(0), check(1)],
    targetUserId: "c536ee37-64ab-427b-b7e3-4e2bb4fdffb7",
    expectedStateCode: 0,
  });
  assert.deepEqual(passed.blockers, []);
  assert.equal(passed.uniqueReadbackCount, 2);

  const duplicate = validateUniqueRootReadbacks({
    intended,
    checks: [check(0), check(0)],
    targetUserId: "c536ee37-64ab-427b-b7e3-4e2bb4fdffb7",
    expectedStateCode: 0,
  });
  assert.ok(duplicate.blockers.some((item) => item.code === "root_readback_duplicate"));
  assert.ok(duplicate.blockers.some((item) => item.code === "root_readback_missing"));
});

test("post-write proof rejects extra, wrong-index, payload, owner, and state roots", () => {
  const extra = { ...check(1), id: "ffffffff-bbbb-4ccc-8ddd-eeeeeeeeeeee" };
  const wrong = {
    ...check(0),
    row_index: 1,
    remote_payload_sha256: "9".repeat(64),
    remote_user_id: "ffffffff-ffff-4fff-8fff-ffffffffffff",
    remote_state_code: 100,
  };
  const result = validateUniqueRootReadbacks({
    intended,
    checks: [wrong, check(1), extra],
    targetUserId: "c536ee37-64ab-427b-b7e3-4e2bb4fdffb7",
    expectedStateCode: 0,
  });
  for (const code of [
    "root_readback_unexpected",
    "root_readback_index_mismatch",
    "root_readback_payload_mismatch",
    "root_readback_owner_mismatch",
    "root_readback_state_mismatch",
  ]) {
    assert.ok(
      result.blockers.some((item) => item.code === code),
      code,
    );
  }
});

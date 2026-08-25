import test from "node:test";

import { createFixture } from "../fixtures/full-context-fixtures.mjs";
import {
  assert,
  blockerCodes,
  path,
  readJson,
  rel,
  repoRoot,
  runFoundry,
  sha256Text,
  targetUserId,
  writeJsonLines,
} from "../fixtures/foundry-core.mjs";

test("post-write closeout rejects duplicate root checks that hide an intended row", () => {
  const fixture = createFixture();
  const verify = readJson(fixture.verifyReport);
  const checksFile = path.join(repoRoot, verify.files.checks);
  const payloadSha = sha256Text(JSON.stringify({ id: "p1" }));
  const duplicate = {
    role: "root",
    table: "processes",
    id: "p1",
    version: "00.00.001",
    path: "processes/0#readback",
    status: "ok",
    local_payload_sha256: payloadSha,
    remote_payload_sha256: payloadSha,
    remote_user_id: targetUserId,
    remote_state_code: 0,
    row_index: 0,
  };
  writeJsonLines(checksFile, [duplicate, duplicate]);

  const closeout = runFoundry([
    "dataset-post-write-closeout",
    "--handoff-plan",
    rel(fixture.handoffWithProof),
    "--commit-report",
    rel(fixture.commitReport),
    "--post-write-verify-report",
    rel(fixture.verifyReport),
    "--out-dir",
    rel(path.join(repoRoot, "tmp", "duplicate-root-closeout")),
  ]);
  assert.equal(closeout.code, 1, JSON.stringify(closeout.json));
  assert.equal(closeout.json.status, "blocked");
  assert.ok(blockerCodes(closeout.json).has("root_readback_duplicate"));
  assert.ok(blockerCodes(closeout.json).has("root_readback_missing"));
});

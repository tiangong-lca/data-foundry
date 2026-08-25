import test from "node:test";
import { canonicalPayloadSha256 } from "../../scripts/lib/post-write-root-proof.ts";

import { createFixture } from "../fixtures/full-context-fixtures.mjs";
import {
  assert,
  blockerCodes,
  path,
  readJson,
  readJsonLines,
  rel,
  repoRoot,
  runFoundry,
  sha256Text,
  targetUserId,
  writeJson,
  writeJsonLines,
} from "../fixtures/foundry-core.ts";

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

test("post-write closeout rejects duplicate root checks that hide an intended row", () => {
  const fixture = createFixture();
  const verify = readJson(fixture.verifyReport);
  const checksFile = path.join(repoRoot, verify.files.checks);
  const firstRow = readJsonLines(fixture.rowsFile)[0];
  const payloadSha = canonicalPayloadSha256(firstRow);
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

test("post-write closeout rejects same-path final-row byte drift after handoff", () => {
  const fixture = createFixture();
  const rows = readJsonLines(fixture.rowsFile);
  rows[1].processDataSet.processInformation.dataSetInformation["common:name"] = {
    "@xml:lang": "en",
    "#text": "drifted after handoff",
  };
  writeJsonLines(fixture.rowsFile, rows);

  const closeout = runFoundry([
    "dataset-post-write-closeout",
    "--handoff-plan",
    rel(fixture.handoffWithProof),
    "--commit-report",
    rel(fixture.commitReport),
    "--post-write-verify-report",
    rel(fixture.verifyReport),
    "--out-dir",
    rel(path.join(repoRoot, "tmp", "drifted-root-closeout")),
  ]);
  assert.equal(closeout.code, 1, JSON.stringify(closeout.json));
  assert.ok(blockerCodes(closeout.json).has("handoff_final_rows_artifact_sha256_drift"));
});

test("post-write closeout accepts CLI canonical payload hashes for non-lexical TIDAS keys", () => {
  const fixture = createFixture();
  const rows = readJsonLines(fixture.rowsFile);
  const checksFile = path.join(repoRoot, readJson(fixture.verifyReport).files.checks);
  writeJsonLines(
    checksFile,
    rows.map((row, rowIndex) => {
      const payloadSha = sha256Text(canonicalJson(row));
      return {
        role: "root",
        table: "processes",
        id: `p${rowIndex + 1}`,
        version: "00.00.001",
        path: `processes/${rowIndex}#readback`,
        status: "ok",
        local_payload_sha256: payloadSha,
        remote_payload_sha256: payloadSha,
        remote_user_id: targetUserId,
        remote_state_code: 0,
        row_index: rowIndex,
      };
    }),
  );

  const closeout = runFoundry([
    "dataset-post-write-closeout",
    "--handoff-plan",
    rel(fixture.handoffWithProof),
    "--commit-report",
    rel(fixture.commitReport),
    "--post-write-verify-report",
    rel(fixture.verifyReport),
    "--out-dir",
    rel(path.join(repoRoot, "tmp", "canonical-root-closeout")),
  ]);
  assert.equal(closeout.code, 0, JSON.stringify(closeout.json));
  assert.equal(closeout.json.counts.unique_root_readback_checks, 2);
});

test("production-test session cannot resume an ordinary-mode handoff", () => {
  const fixture = createFixture();
  const handoff = readJson(fixture.handoffWithProof);
  handoff.account_mode = "ordinary";
  const handoffPath = path.join(repoRoot, "tmp", "production-mode-handoff.json");
  writeJson(handoffPath, handoff);
  const closeout = runFoundry(
    [
      "dataset-post-write-closeout",
      "--handoff-plan",
      rel(handoffPath),
      "--commit-report",
      rel(fixture.commitReport),
      "--post-write-verify-report",
      rel(fixture.verifyReport),
      "--out-dir",
      rel(path.join(repoRoot, "tmp", "production-mode-closeout")),
    ],
    { env: { FOUNDRY_ACCOUNT_MODE: "production-test" } },
  );
  assert.equal(closeout.code, 1);
  assert.ok(blockerCodes(closeout.json).has("handoff_account_mode_mismatch"));
  assert.equal(closeout.json.policy.accepted_trace_hash_only_normalization, false);
});

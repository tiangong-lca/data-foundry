import test from "node:test";
import { sha256Json } from "../../scripts/lib/identity-preflight-proof.ts";
import { createFixture } from "../fixtures/full-context-fixtures.ts";
import {
  assert,
  blockerCodes,
  path,
  readJson,
  readJsonLines,
  rel,
  runFoundry,
  targetUserId,
  writeJson,
} from "../fixtures/foundry-core.ts";

function nativeFixture() {
  const fixture = createFixture();
  const root = path.dirname(fixture.rowsFile);
  const rows = readJsonLines(fixture.rowsFile);
  const mutation = readJson(fixture.mutationWithProof);
  mutation.profile = "generic";
  writeJson(fixture.mutationWithProof, mutation);
  const finalize = readJson(fixture.finalizeReport);
  finalize.profile = "generic";
  finalize.counts.location_audit_blockers = 0;
  finalize.files.mutation_manifest = rel(fixture.mutationWithProof);
  writeJson(fixture.finalizeReport, finalize);
  const contract = {
    schema_version: "dataset-save-draft-execution-contract.v1",
    execution_id: "native-process-test",
    project_ref: "abcdefghijklmnopqrst",
    target_mode: "owner_draft",
    owner: { user_id: targetUserId, email: "test@example.invalid", state_code: 0 },
    actions: rows.map((row, index) => ({
      action_id: `insert-${index}`,
      expected_operation: "insert",
      table: "processes",
      id: `p${index + 1}`,
      version: "00.00.001",
      desired_sha256: sha256Json(row),
      before_sha256: null,
      dependency_action_ids: [],
    })),
  };
  const contractFile = path.join(root, "native-contract.json");
  writeJson(contractFile, contract);
  const outDir = path.join(root, "native-handoff");
  const handoff = runFoundry([
    "dataset-commit-handoff-plan",
    "--finalize-report",
    rel(fixture.finalizeReport),
    "--execution-contract-file",
    contractFile,
    "--out-dir",
    outDir,
  ]);
  assert.equal(handoff.code, 0, JSON.stringify(handoff.json));
  const report = {
    schema_version: 2,
    status: "completed",
    mode: "commit",
    commit: true,
    requested_type: "process",
    input_path: fixture.rowsFile,
    counts: { selected: 2, executed: 2, attempts_consumed: 2, failed: 0, unknown: 0, blocked: 0 },
    execution_contract: {
      path: contractFile,
      sha256: sha256Json(contract),
      execution_id: contract.execution_id,
      target_mode: "owner_draft",
    },
    rows: contract.actions.map((action, index) => ({
      index,
      type: "process",
      table: action.table,
      id: action.id,
      version: action.version,
      action_id: action.action_id,
      desired_sha256: action.desired_sha256,
      status: "executed",
      operation: "insert",
      attempt_consumed: true,
      replayed: false,
      readback: "desired_exact",
    })),
  };
  return {
    fixture,
    root,
    report,
    handoffFile: path.join(outDir, "dataset-commit-handoff-plan.json"),
  };
}

test("native closeout rejects a completed report from a different contract despite exact root readback", () => {
  const { fixture, root, report, handoffFile } = nativeFixture();
  report.execution_contract.sha256 = "a".repeat(64);
  writeJson(fixture.commitReport, report);
  const result = runFoundry([
    "dataset-post-write-closeout",
    "--handoff-plan",
    handoffFile,
    "--commit-report",
    fixture.commitReport,
    "--post-write-verify-report",
    fixture.verifyReport,
    "--out-dir",
    path.join(root, "bad-native-closeout"),
  ]);
  assert.equal(result.code, 1, JSON.stringify(result.json));
  assert.ok(blockerCodes(result.json).has("native_execution_evidence_invalid"));
});

test("native closeout accepts exact consumed insert/readback evidence and still requires unique roots", () => {
  const { fixture, root, report, handoffFile } = nativeFixture();
  writeJson(fixture.commitReport, report);
  const result = runFoundry([
    "dataset-post-write-closeout",
    "--handoff-plan",
    handoffFile,
    "--commit-report",
    fixture.commitReport,
    "--post-write-verify-report",
    fixture.verifyReport,
    "--out-dir",
    path.join(root, "native-closeout"),
  ]);
  assert.equal(result.code, 0, JSON.stringify(result.json));
  assert.equal(result.json.counts.unique_root_readback_checks, 2);
});

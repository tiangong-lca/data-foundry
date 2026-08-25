import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import {
  readJson,
  readJsonLines,
  rel,
  runFoundry,
  testTmpRoot,
  writeJsonLines,
} from "../fixtures/foundry-core.mjs";

test("import ledger report separates verified rows from human-review resume scopes", () => {
  const root = testTmpRoot("import-ledger-report");
  fs.rmSync(root, { recursive: true, force: true });
  const ledgerDir = path.join(root, "ledger");
  const outDir = path.join(root, "report");
  writeJsonLines(path.join(ledgerDir, "ok.scopes.verified.jsonl"), [
    {
      schema_version: 1,
      ledger_kind: "ok",
      status: "verified",
      dataset_key: "process:ready-process:00.00.001",
      row_dataset_type: "process",
      dataset_id: "ready-process",
      version: "00.00.001",
      closeout_report: "tmp/ready/dataset-post-write-closeout-report.json",
      ledger_key: "ok:process:ready-process:00.00.001:hash:report",
    },
  ]);
  writeJsonLines(path.join(ledgerDir, "blocked.scopes.human-review.jsonl"), [
    {
      schema_version: 1,
      ledger_kind: "blocked",
      status: "blocked_human_review",
      scope_key: "process:blocked-processes.jsonl",
      scope_dataset_type: "process",
      scope_ids: ["blocked-process"],
      scope_versions: ["00.00.001"],
      blocker_codes: ["canonical_flow_property_reference_unresolved"],
      blocker_count: 1,
      required_human_action: "Map canonical support and rerun this scope.",
      final_rows_file: "tmp/blocked/processes.jsonl",
      finalize_report: "tmp/blocked/dataset-post-authoring-finalize-report.json",
      rerun_command:
        "node scripts/foundry.mjs dataset-post-authoring-finalize --rows-file tmp/blocked/processes.jsonl",
      ledger_key: "blocked:scope:process:blocked-processes.jsonl",
    },
  ]);
  writeJsonLines(path.join(ledgerDir, "blocked.dependencies.canonical-support.jsonl"), [
    {
      schema_version: 1,
      ledger_kind: "blocked",
      status: "blocked_human_review",
      blocker_bucket: "canonical-support",
      reason_code: "canonical_flow_property_reference_unresolved",
      scope_key: "process:blocked-processes.jsonl",
      required_human_action: "Map canonical support.",
      ledger_key: "blocked:dependency:canonical-support:1",
    },
  ]);
  writeJsonLines(path.join(ledgerDir, "failed.scopes.retry.jsonl"), [
    {
      schema_version: 1,
      process_id: "retry-process",
      process_version: "00.00.001",
      stage: "classification.apply",
      code: "classification_apply_stage_failed",
      ledger_key: "retry:scope:process:retry-process",
    },
  ]);

  const result = runFoundry([
    "dataset-import-ledger-report",
    "--ledger-dir",
    rel(ledgerDir),
    "--out-dir",
    rel(outDir),
  ]);

  assert.equal(result.code, 0);
  assert.equal(result.json.status, "completed_with_blocked_scopes");
  assert.equal(result.json.counts.skipped_verified_rows, 1);
  assert.equal(result.json.counts.resume_rows, 1);
  assert.equal(result.json.counts.blocked_rows, 2);
  assert.equal(result.json.counts.retry_rows, 1);

  const report = readJson(path.join(outDir, "dataset-import-ledger-report.json"));
  const resumeRows = readJsonLines(path.join(outDir, "resume.plan.jsonl"));
  const skippedRows = readJsonLines(path.join(outDir, "resume.skipped-verified.jsonl"));
  assert.equal(report.status, "completed_with_blocked_scopes");
  assert.equal(resumeRows[0].scope_ids[0], "blocked-process");
  assert.equal(skippedRows[0].dataset_id, "ready-process");
});

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { runDatasetMutationManifest } from "../../scripts/lib/import-curation/mutation-manifest.ts";
import { processRowWithFlowRef } from "../fixtures/row-builders.mjs";

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord {
  assert.ok(value && typeof value === "object" && !Array.isArray(value));
  return value as JsonRecord;
}

function records(value: unknown): JsonRecord[] {
  assert.ok(Array.isArray(value));
  return value.map(record);
}

function writeJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function writeJsonLines(filePath: string, rows: unknown[]): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, rows.map((row) => JSON.stringify(row)).join("\n") + "\n");
}

function parseJsonLines(text: string): JsonRecord[] {
  return text
    .trimEnd()
    .split("\n")
    .filter(Boolean)
    .map((line) => record(JSON.parse(line)));
}

test("mutation manifest preserves partition, proof, item, byte, and fail-closed order", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "foundry-mutation-manifest-contract-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const processA = "11111111-1111-4111-8111-111111111111";
  const processB = "22222222-2222-4222-8222-222222222222";
  const referenceOnly = "33333333-3333-4333-8333-333333333333";
  const remoteFlow = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const rows = [
    processRowWithFlowRef(processA, remoteFlow),
    processRowWithFlowRef(processB, remoteFlow),
  ];
  const referenceRows = [
    processRowWithFlowRef(referenceOnly, remoteFlow),
    processRowWithFlowRef(processA, remoteFlow),
  ];
  const rowsFile = path.join(root, "rows", "processes.jsonl");
  const referenceRowsFile = path.join(root, "rows", "reference-processes.jsonl");
  const schemaReport = path.join(root, "schema", "report.json");
  const qaReport = path.join(root, "qa", "report.json");
  const curationReport = path.join(root, "curation", "report.json");
  const cleanupReport = path.join(root, "cleanup", "report.json");
  const progressFile = path.join(root, "dry-run", "progress.jsonl");
  const failuresFile = path.join(root, "dry-run", "failures.jsonl");
  const dryRunReport = path.join(root, "dry-run", "report.json");
  const remoteReport = path.join(root, "remote", "report.json");
  writeJsonLines(rowsFile, rows);
  writeJsonLines(referenceRowsFile, referenceRows);
  writeJson(schemaReport, {
    status: "completed",
    input_path: "rows/processes.jsonl",
    rows: [
      { id: processB, version: "00.00.001", status: "valid", issues: [] },
      { id: processA, version: "00.00.001", status: "valid", issues: [] },
    ],
  });
  writeJson(qaReport, { status: "completed", rows_file: "rows/processes.jsonl", findings: [] });
  writeJson(curationReport, {
    status: "ready",
    rows_file: "rows/processes.jsonl",
    schema_report: "schema/report.json",
    qa_report: "qa/report.json",
    entities: [
      { entity_id: processB, version: "00.00.001", status: "ready" },
      { entity_id: processA, version: "00.00.001", status: "ready" },
    ],
  });
  writeJson(cleanupReport, {
    status: "completed",
    rows_file: "rows/processes.jsonl",
    cleaned_rows_file: "rows/processes.jsonl",
  });
  writeJsonLines(progressFile, [
    { id: processA, version: "00.00.001", status: "prepared", operation: "would_insert" },
    { id: processB, version: "00.00.001", status: "prepared", operation: "would_insert" },
  ]);
  writeJsonLines(failuresFile, []);
  writeJson(dryRunReport, {
    status: "completed",
    mode: "dry-run",
    input_path: "rows/processes.jsonl",
    files: {
      progress_jsonl: "dry-run/progress.jsonl",
      failures_jsonl: "dry-run/failures.jsonl",
    },
  });
  writeJson(remoteReport, {
    status: "blocked_one_root",
    input_path: "rows/processes.jsonl",
    checks: [
      {
        role: "reference",
        status: "ok",
        table: "flows",
        id: remoteFlow,
        version: "00.00.001",
      },
    ],
    blockers: [
      {
        role: "root",
        root_id: processB,
        code: "fixture_root_blocked",
      },
    ],
  });

  const result = record(
    runDatasetMutationManifest({
      repoRoot: root,
      options: {
        type: "process",
        profile: "generic",
        rowsFile: "rows/processes.jsonl",
        referenceRowsFile: "rows/reference-processes.jsonl",
        schemaReport: "schema/report.json",
        curationGateReport: "curation/report.json",
        cleanupReport: "cleanup/report.json",
        dryRunReport: "dry-run/report.json",
        remoteVerifyReport: "remote/report.json",
        targetUserId: "44444444-4444-4444-8444-444444444444",
        outDir: "manifest",
      },
    }),
  );
  assert.equal(result.status, "blocked");
  const items = records(result.items);
  assert.deepEqual(
    items.map((item) => [item.entity_id, item.role, item.decision, item.operation]),
    [
      [processA, "write_candidate", "write_or_update", "save_draft_prepared"],
      [processB, "write_candidate", "blocked", "save_draft_prepared"],
      [referenceOnly, "reference_reuse", "reuse_existing_reference", null],
      [processA, "reference_reuse", "covered_by_write_candidate", null],
    ],
  );
  assert.deepEqual(
    records(items[1]?.blockers).map((blocker) => blocker.code),
    ["remote_reference_closure_blocked"],
  );
  assert.deepEqual(records(items[0]?.blockers), []);
  const evidence = record(result.evidence);
  assert.deepEqual(
    records(evidence.scope_blockers).filter((blocker) =>
      String(blocker.code).startsWith("reference_closure"),
    ),
    [],
  );
  const counts = record(result.counts);
  assert.deepEqual(
    {
      write_candidates: counts.write_candidates,
      planned_write_candidates: counts.planned_write_candidates,
      blocked_write_candidates: counts.blocked_write_candidates,
      reference_reuse: counts.reference_reuse,
      covered_by_write_candidate: counts.covered_by_write_candidate,
      blocked_items: counts.blocked_items,
      blockers: counts.blockers,
      decisions: counts.decisions,
      operations: counts.operations,
    },
    {
      write_candidates: 0,
      planned_write_candidates: 2,
      blocked_write_candidates: 1,
      reference_reuse: 1,
      covered_by_write_candidate: 1,
      blocked_items: 1,
      blockers: 1,
      decisions: {
        write_or_update: 1,
        blocked: 1,
        reuse_existing_reference: 1,
        covered_by_write_candidate: 1,
      },
      operations: { save_draft_prepared: 2 },
    },
  );

  const files = record(result.files);
  const reportText = fs.readFileSync(path.join(root, String(files.report)), "utf8");
  const itemsText = fs.readFileSync(path.join(root, String(files.items)), "utf8");
  const reportWithoutItems = { ...result };
  delete reportWithoutItems.items;
  assert.equal(reportText, `${JSON.stringify(reportWithoutItems, null, 2)}\n`);
  assert.equal(itemsText, items.map((item) => JSON.stringify(item)).join("\n") + "\n");
  assert.equal(fs.readFileSync(path.join(root, String(files.write_candidates)), "utf8"), "");
  assert.deepEqual(
    parseJsonLines(
      fs.readFileSync(path.join(root, String(files.blocked_write_candidates)), "utf8"),
    ),
    [record(rows[1])],
  );
  assert.deepEqual(
    parseJsonLines(fs.readFileSync(path.join(root, String(files.reference_reuse)), "utf8")),
    referenceRows.map(record),
  );

  const normalizedReport = reportText.replace(
    /"generated_at_utc": "[^"]+"/u,
    '"generated_at_utc": "<timestamp>"',
  );
  assert.equal(
    createHash("sha256").update(normalizedReport).digest("hex"),
    "64567990953ca1cf1d32b5561a7d0d360909d6dded09d5a8c05cb4b56a230804",
  );
  assert.equal(
    createHash("sha256").update(itemsText).digest("hex"),
    "1b4d5d95e49c25fc3c1a9664e1488e18247aa0f557af98179a6db2bc83ee93c1",
  );
});

test("malformed readable schema report retains native SyntaxError before output", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "foundry-mutation-manifest-error-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeJsonLines(path.join(root, "rows.jsonl"), [
    processRowWithFlowRef("process-error", "flow-error"),
  ]);
  fs.writeFileSync(path.join(root, "schema.json"), "{");
  assert.throws(
    () =>
      runDatasetMutationManifest({
        repoRoot: root,
        options: {
          type: "process",
          rowsFile: "rows.jsonl",
          schemaReport: "schema.json",
          outDir: "manifest",
        },
      }),
    SyntaxError,
  );
  assert.equal(fs.existsSync(path.join(root, "manifest")), false);
});

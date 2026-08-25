import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import * as evidenceScope from "../../scripts/lib/import-curation/internal/workflow-evidence-scope.ts";

type JsonRecord = Record<string, unknown>;

function writeText(filePath: string, text: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, text);
}

function writeJson(filePath: string, value: unknown): void {
  writeText(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function withTempRoot(name: string, body: (root: string) => void): void {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `${name}-`));
  try {
    body(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test("evidence blocker and dry-run row aliases preserve portable paths, nulls, and precedence", () => {
  const root = path.join(path.sep, "repo");
  assert.deepEqual(
    evidenceScope.evidenceScopeBlocker({
      code: "code",
      stage: "stage",
      message: "message",
      expected: path.join(root, "rows", "expected.jsonl"),
      actual: null,
      artifact: path.join(root, "reports", "report.json"),
      repoRoot: root,
    }),
    {
      code: "code",
      stage: "stage",
      message: "message",
      expected: "rows/expected.jsonl",
      actual: null,
      artifact: "reports/report.json",
    },
  );
  const aliases = [
    "input_path",
    "inputPath",
    "input_file",
    "inputFile",
    "rows_file",
    "rowsFile",
    "source_rows_file",
    "sourceRowsFile",
    "source_path",
    "sourcePath",
  ];
  for (const alias of aliases) {
    assert.equal(evidenceScope.dryRunReportRowsFile({ [alias]: alias }), alias);
  }
  assert.equal(evidenceScope.dryRunReportRowsFile({ files: { input: "input" } }), "input");
  assert.equal(evidenceScope.dryRunReportRowsFile({ files: { input_rows: "rows" } }), "rows");
  assert.equal(evidenceScope.dryRunReportRowsFile({ files: { source_rows: "source" } }), "source");
  assert.equal(
    evidenceScope.dryRunReportRowsFile({ files: { selected_rows_input: "selected" } }),
    "selected",
  );
  assert.equal(
    evidenceScope.dryRunReportRowsFile({ input_path: "first", rows_file: "ignored" }),
    "first",
  );
  assert.equal(evidenceScope.dryRunReportRowsFile(null), undefined);
});

test("evidence scope preserves all-missing blocker order and optional curation boundary", () => {
  withTempRoot("evidence-scope-missing", (root) => {
    const rowsFile = path.join(root, "rows", "final.jsonl");
    const blockers = evidenceScope.buildEvidenceScopeBlockers({
      repoRoot: root,
      rowsFile,
      schemaReportArtifact: { path: path.join(root, "reports", "schema.json"), value: {} },
      curationGateArtifact: {
        path: path.join(root, "reports", "curation.json"),
        value: {},
      },
      cleanupArtifact: { path: path.join(root, "reports", "cleanup.json"), value: {} },
      patchApplyArtifact: { path: path.join(root, "reports", "patch.json"), value: {} },
      patchApplyContext: { evidenceRows: [] },
      patchCollectArtifact: null,
      requirePatchCollectReport: true,
      dryRunReportArtifact: { path: path.join(root, "reports", "dry.json"), value: {} },
      remoteVerifyArtifact: { path: path.join(root, "reports", "remote.json"), value: {} },
    });
    assert.deepEqual(
      blockers.map((blocker: JsonRecord) => blocker.code),
      [
        "schema_report_input_missing",
        "curation_gate_rows_missing",
        "curation_gate_report_not_ready",
        "curation_gate_qa_report_missing",
        "cleanup_cleaned_rows_missing",
        "patch_apply_output_missing",
        "patch_evidence_required",
        "patch_collect_report_required",
        "dry_run_report_input_missing",
        "remote_verify_input_missing",
      ],
    );
    const withoutCuration = evidenceScope.buildEvidenceScopeBlockers({
      repoRoot: root,
      rowsFile,
      schemaReportArtifact: null,
      curationGateArtifact: null,
      requireCurationGate: false,
      dryRunReportArtifact: null,
    });
    assert.deepEqual(
      withoutCuration.map((blocker: JsonRecord) => blocker.code),
      ["schema_report_input_missing", "dry_run_report_required"],
    );
  });
});

test("fully bound reports and deterministic patch-to-rewrite chain produce no scope blockers", () => {
  withTempRoot("evidence-scope-valid", (root) => {
    const finalRows = path.join(root, "rows", "final.jsonl");
    const patchRows = path.join(root, "rows", "patched.jsonl");
    const identityRows = path.join(root, "rows", "identity.jsonl");
    const batchPatch = path.join(root, "patches", "batch.json");
    const schemaPath = path.join(root, "reports", "schema.json");
    const qaPath = path.join(root, "reports", "qa.json");
    writeText(finalRows, "[]\n");
    writeText(patchRows, "[]\n");
    writeText(identityRows, "[]\n");
    writeText(batchPatch, "{}\n");
    writeJson(qaPath, { rows_file: finalRows });
    const blockers = evidenceScope.buildEvidenceScopeBlockers({
      repoRoot: root,
      rowsFile: finalRows,
      schemaReportArtifact: { path: schemaPath, value: { input_path: finalRows } },
      curationGateArtifact: {
        path: path.join(root, "reports", "curation.json"),
        value: {
          rows_file: finalRows,
          status: "ready_with_profile_waivers",
          qa_report: qaPath,
          schema_report: schemaPath,
        },
      },
      cleanupArtifact: {
        path: path.join(root, "reports", "cleanup.json"),
        value: { rows_file: identityRows, cleaned_rows_file: finalRows },
      },
      patchApplyArtifact: {
        path: path.join(root, "reports", "patch.json"),
        value: { out_path: patchRows, patch_path: batchPatch },
      },
      patchApplyContext: { evidenceRows: [{ id: 1 }] },
      patchCollectArtifact: {
        path: path.join(root, "reports", "collect.json"),
        value: { status: "ready_for_patch_apply", files: { batch_patch: batchPatch } },
      },
      requirePatchCollectReport: true,
      dryRunReportArtifact: {
        path: path.join(root, "reports", "dry.json"),
        value: { files: { input_rows: finalRows } },
      },
      remoteVerifyArtifact: {
        path: path.join(root, "reports", "remote.json"),
        value: { input_path: finalRows },
      },
      identityReferenceRewriteContext: {
        inputRowsFile: patchRows,
        outputRowsFile: identityRows,
      },
    });
    assert.deepEqual(blockers, []);
  });
});

test("scope mismatches retain stage order, QA parse envelope, patch collect binding, dry-run and remote failures", () => {
  withTempRoot("evidence-scope-mismatch", (root) => {
    const finalRows = path.join(root, "rows", "final.jsonl");
    const otherRows = path.join(root, "rows", "other.jsonl");
    const thirdRows = path.join(root, "rows", "third.jsonl");
    const schemaPath = path.join(root, "reports", "schema.json");
    const otherSchema = path.join(root, "reports", "other-schema.json");
    const qaPath = path.join(root, "reports", "qa.json");
    const batchPatch = path.join(root, "patches", "batch.json");
    const appliedPatch = path.join(root, "patches", "applied.json");
    for (const filePath of [finalRows, otherRows, thirdRows, batchPatch, appliedPatch]) {
      writeText(filePath, "{}\n");
    }
    writeText(thirdRows, '{"third":true}\n');
    writeText(qaPath, "{bad\n");
    const blockers = evidenceScope.buildEvidenceScopeBlockers({
      repoRoot: root,
      rowsFile: finalRows,
      schemaReportArtifact: { path: schemaPath, value: { input_path: otherRows } },
      curationGateArtifact: {
        path: path.join(root, "reports", "curation.json"),
        value: {
          rows_file: otherRows,
          status: "blocked",
          qa_report: qaPath,
          schema_report: otherSchema,
        },
      },
      cleanupArtifact: {
        path: path.join(root, "reports", "cleanup.json"),
        value: { rows_file: thirdRows, files: { cleaned_rows: otherRows } },
      },
      patchApplyArtifact: {
        path: path.join(root, "reports", "patch.json"),
        value: { out_path: otherRows, patch_path: appliedPatch },
      },
      patchApplyContext: { evidenceRows: [{ ok: true }] },
      patchCollectArtifact: {
        path: path.join(root, "reports", "collect.json"),
        value: { status: "blocked", files: { batch_patch: batchPatch } },
      },
      dryRunReportArtifact: {
        path: path.join(root, "reports", "dry.json"),
        value: { input_path: otherRows },
      },
      remoteVerifyArtifact: {
        path: path.join(root, "reports", "remote.json"),
        value: { input_path: otherRows },
      },
    });
    assert.deepEqual(
      blockers.map((blocker: JsonRecord) => blocker.code),
      [
        "schema_report_rows_mismatch",
        "curation_gate_rows_mismatch",
        "curation_gate_report_not_ready",
        "curation_gate_qa_report_invalid",
        "curation_gate_schema_report_mismatch",
        "cleanup_cleaned_rows_mismatch",
        "patch_apply_cleanup_input_mismatch",
        "patch_collect_not_ready",
        "patch_collect_apply_patch_mismatch",
        "dry_run_report_rows_mismatch",
        "remote_verify_rows_mismatch",
      ],
    );
    assert.match(String(blockers[3].message), /JSON/u);
    assert.throws(
      () =>
        evidenceScope.buildEvidenceScopeBlockers({
          repoRoot: root,
          rowsFile: null,
          schemaReportArtifact: null,
          dryRunReportArtifact: null,
        }),
      (error: unknown) => error instanceof TypeError,
    );
  });
});

test("evidence scope retains its exact export surface", () => {
  assert.deepEqual(Object.keys(evidenceScope), [
    "buildEvidenceScopeBlockers",
    "dryRunReportRowsFile",
    "evidenceScopeBlocker",
  ]);
});

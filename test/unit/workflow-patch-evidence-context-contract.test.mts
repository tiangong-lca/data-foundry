import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import * as evidenceContext from "../../scripts/lib/import-curation/internal/workflow-patch-evidence-context.ts";
import { sha256Json, sha256Text } from "../../scripts/lib/import-curation/internal/hash-utils.ts";

type JsonRecord = Record<string, unknown>;

function writeText(filePath: string, text: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, text);
}

function writeJsonLines(filePath: string, rows: unknown[]): void {
  writeText(
    filePath,
    rows.map((row) => JSON.stringify(row)).join("\n") + (rows.length ? "\n" : ""),
  );
}

function withTempRoot(name: string, body: (root: string) => void): void {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `${name}-`));
  try {
    body(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test("patch evidence identity and compact envelopes preserve aliases, integers, references, and closure order", () => {
  const evidence = { source: "source.json", path: "/field" };
  const resolution = { mode: "evidence_backed_completion" };
  const entry = {
    row_index: 2,
    dataset_id: " id ",
    dataset_version: "",
    op: " replace ",
    operation: "ignored",
    path: " /field ",
    basis: " basis ",
    evidence,
    resolution,
    authoring_package: " package.json ",
    authoring_package_sha256: " sha ",
    closes_action_items: ["first", { action_item_code: " second " }, { ruleId: "third" }, null],
  };
  assert.equal(evidenceContext.patchEvidenceIdentityKey(entry), "id@@00.00.001");
  assert.equal(
    evidenceContext.patchEvidenceIdentityKey({ entity_id: "entity", version: "1" }),
    "entity@@1",
  );
  assert.equal(evidenceContext.patchEvidenceIdentityKey({}), null);
  assert.deepEqual(evidenceContext.compactPatchEvidenceEntry(entry), {
    row_index: 2,
    dataset_id: "id",
    dataset_version: null,
    operation: "replace",
    path: "/field",
    basis: "basis",
    evidence,
    resolution,
    authoring_package: "package.json",
    authoring_package_sha256: "sha",
    closes_action_items: entry.closes_action_items,
  });
  assert.equal(evidenceContext.compactPatchEvidenceEntry({ row_index: 2.5 }).row_index, null);
  assert.deepEqual(evidenceContext.patchEvidenceClosureCodes(entry), ["first", "second", "third"]);
});

test("patch apply context preserves report/evidence blockers, dual indexes, path order, payload hashes, and native parse errors", () => {
  withTempRoot("patch-evidence-apply", (root) => {
    const evidencePath = path.join(root, "evidence", "patch-evidence.jsonl");
    const evidenceRows = [
      {
        row_index: 0,
        dataset_id: "dataset-id",
        dataset_version: "01.00.000",
        op: "replace",
        path: "/field/a",
        basis: "first",
        resolution: { mode: "evidence_backed_completion" },
        closes_action_items: ["first"],
      },
      {
        row_index: 0,
        dataset_id: "dataset-id",
        dataset_version: "01.00.000",
        operation: "add",
        path: "/field/b",
        basis: "second",
        resolution: { mode: "deferred_to_common_other" },
        closes_action_items: ["second"],
      },
      { row_index: 1, basis: "row-only" },
    ];
    writeJsonLines(evidencePath, evidenceRows);
    const inputPayload = { processDataSet: { marker: "input" } };
    const outputOld = { processDataSet: { marker: "old" } };
    const outputNew = { processDataSet: { marker: "new" } };
    const inputPath = path.join(root, "rows", "input.jsonl");
    const outputAPath = path.join(root, "rows", "output-a.jsonl");
    const outputBPath = path.join(root, "rows", "output-b.jsonl");
    writeJsonLines(inputPath, [{ id: "dataset-id", version: "01.00.000", payload: inputPayload }]);
    writeJsonLines(outputAPath, [{ id: "dataset-id", version: "01.00.000", payload: outputOld }]);
    writeJsonLines(outputBPath, [{ id: "dataset-id", version: "01.00.000", payload: outputNew }]);
    const reportPath = path.join(root, "reports", "patch-apply.json");
    const context = evidenceContext.readPatchApplyContext(
      root,
      {
        path: reportPath,
        value: {
          status: "completed",
          evidence_count: 3,
          inputPath: "rows/input.jsonl",
          out_path: "rows/output-a.jsonl",
          outPath: "rows/output-a.jsonl",
          output_path: "rows/output-b.jsonl",
          files: { patch_evidence: "evidence/patch-evidence.jsonl" },
        },
      },
      null,
    );
    assert.equal(context.status, "completed");
    assert.equal(context.evidenceFile, evidencePath);
    assert.deepEqual(
      context.evidenceRows.map((row) => (row as JsonRecord).basis),
      ["first", "second", "row-only"],
    );
    assert.deepEqual(
      context.byIdentity.get("dataset-id@@01.00.000")!.map((row) => row.basis),
      ["first", "second"],
    );
    assert.deepEqual(
      context.byIdentity.get("dataset-id")!.map((row) => row.basis),
      ["first", "second"],
    );
    assert.deepEqual(
      context.byRowIndex.get(0)!.map((row) => row.basis),
      ["first", "second"],
    );
    assert.equal(context.inputRowsFile, inputPath);
    assert.deepEqual(context.outputRows, [outputAPath, outputBPath]);
    assert.deepEqual(
      [...context.inputPayloadSha256ByIdentity],
      [["process:dataset-id@@01.00.000", sha256Json(inputPayload)]],
    );
    assert.deepEqual(
      [...context.outputPayloadSha256ByIdentity],
      [["process:dataset-id@@01.00.000", sha256Json(outputNew)]],
    );
    assert.deepEqual(context.globalBlockers, []);

    const noReport = evidenceContext.readPatchApplyContext(root, null, evidencePath);
    assert.deepEqual(
      noReport.globalBlockers.map((blocker: JsonRecord) => blocker.code),
      ["patch_apply_report_required"],
    );
    const blocked = evidenceContext.readPatchApplyContext(
      root,
      { path: reportPath, value: { status: "blocked", evidence_count: 1 } },
      null,
    );
    assert.deepEqual(
      blocked.globalBlockers.map((blocker: JsonRecord) => blocker.code),
      ["patch_apply_not_completed", "patch_evidence_file_missing"],
    );

    writeText(evidencePath, "{bad}\n");
    assert.throws(
      () => evidenceContext.readPatchApplyContext(root, null, evidencePath),
      (error: unknown) => error instanceof SyntaxError,
    );
    assert.throws(
      () =>
        evidenceContext.readPatchApplyContext(
          root,
          { value: { status: "completed", out_path: 42 } },
          null,
        ),
      (error: unknown) => error instanceof TypeError,
    );
  });
});

test("row evidence lookup preserves exact, bare-id, row-index order, JSON dedupe, and native circular errors", () => {
  const first = { basis: "first", value: 1 };
  const duplicate = { basis: "first", value: 1 };
  const idOnly = { basis: "id-only", value: 2 };
  const rowOnly = { basis: "row-only", value: 3 };
  const context = {
    byIdentity: new Map([
      ["id@@1", [first]],
      ["id", [duplicate, idOnly]],
    ]),
    byRowIndex: new Map([[4, [rowOnly, first]]]),
  };
  assert.deepEqual(evidenceContext.patchEvidenceForRow(context, { id: "id", version: "1" }, 4), [
    first,
    idOnly,
    rowOnly,
  ]);
  assert.deepEqual(evidenceContext.patchEvidenceForRow(null, { id: "id", version: "1" }, 4), []);
  const circular: JsonRecord = {};
  circular.self = circular;
  assert.throws(
    () =>
      evidenceContext.patchEvidenceForRow(
        { byIdentity: new Map([["id@@1", [circular]]]), byRowIndex: new Map() },
        { id: "id", version: "1" },
        0,
      ),
    (error: unknown) => error instanceof TypeError,
  );
});

test("deterministic annual and source cleanup proof requires exact owner, status, identity, row, trace, and signatures", () => {
  const annual = {
    action_item_code: "annual_supply_or_production_volume_missing",
    blocked_path: "/annualSupplyOrProductionVolume",
    evidence: { source: "foundry_deterministic_cleanup" },
  };
  assert.equal(evidenceContext.isDeterministicAnnualSupplyCleanupTrace(annual), true);
  assert.equal(
    evidenceContext.isDeterministicAnnualSupplyCleanupTrace({
      ...annual,
      evidence: { source: "ai" },
    }),
    false,
  );

  const trace = {
    status: "verified",
    trace_sha256: "trace-sha",
    evidence: { source: "foundry_deterministic_cleanup" },
  };
  const cleanup = {
    status: "completed",
    sourceExchangeCompletenessProofs: [
      {
        dataset_id: "id",
        version: "01.00.000",
        row_index: 2,
        trace_hash: "trace-sha",
        source_exchange_signature_hash: "same",
        final_exchange_signature_hash: "same",
      },
    ],
  };
  assert.equal(
    evidenceContext.isDeterministicSourceExchangeCleanupTrace({
      trace,
      cleanupContext: cleanup,
      identity: { id: "id", version: "01.00.000" },
      rowIndex: 2,
    }),
    true,
  );
  for (const changed of [
    { cleanupContext: { ...cleanup, status: "blocked" } },
    { trace: { ...trace, status: "pending" } },
    { trace: { ...trace, evidence: { source: "ai" } } },
    { identity: { id: "other", version: "01.00.000" } },
    { rowIndex: 3 },
  ]) {
    assert.equal(
      evidenceContext.isDeterministicSourceExchangeCleanupTrace({
        trace,
        cleanupContext: cleanup,
        identity: { id: "id", version: "01.00.000" },
        rowIndex: 2,
        ...changed,
      }),
      false,
    );
  }
  const circular: JsonRecord = {
    status: "verified",
    evidence: { source: "foundry_deterministic_cleanup" },
  };
  circular.self = circular;
  assert.throws(
    () =>
      evidenceContext.isDeterministicSourceExchangeCleanupTrace({
        trace: circular,
        cleanupContext: cleanup,
        identity: { id: "id", version: "01.00.000" },
        rowIndex: 2,
      }),
    (error: unknown) => error instanceof TypeError,
  );
});

test("trace blockers preserve unresolved-before-source order and exact AI, identity, annual, and cleanup alternatives", () => {
  const identityDecision = {
    decision_status: "completed",
    identity_decision: "unresolved",
    closes_action_items: ["elementary_flow_identity_manual_review"],
  };
  const identityApplyContext = {
    byIdentity: new Map([
      ["flow:flow-ref@@01.00.000", [identityDecision]],
      ["flow:flow-ref", [identityDecision]],
    ]),
  };
  const annualTrace = {
    action_item_code: "annual_supply_or_production_volume_missing",
    blocked_path: "/annualSupplyOrProductionVolume",
    evidence: { source: "foundry_deterministic_cleanup" },
  };
  const sourceTrace = {
    status: "verified",
    trace_sha256: "trace-sha",
    evidence: { source: "foundry_deterministic_cleanup" },
  };
  const cleanup = {
    status: "completed",
    sourceExchangeCompletenessProofs: [
      {
        dataset_id: "dataset-id",
        version: "01.00.000",
        row_index: 0,
        trace_hash: "trace-sha",
        source_exchange_signature_hash: "same",
        final_exchange_signature_hash: "same",
      },
    ],
  };
  const blockers = evidenceContext.tracePatchEvidenceBlockers({
    traceSummary: {
      unresolved_traces: [
        { action_item_code: "deferred-action", blocked_path: "/deferred" },
        {
          action_item_code: "elementary_flow_identity_manual_review",
          reference_id: "flow-ref",
          reference_version: "01.00.000",
        },
        annualTrace,
        { action_item_code: "missing-action", blocked_path: "/missing" },
      ],
      source_exchange_completeness: [
        sourceTrace,
        { ...sourceTrace, trace_sha256: "other", status: "accepted_source_only_output" },
      ],
    },
    aiPatchEvidence: [
      {
        resolution: { mode: "deferred_to_common_other" },
        closes_action_items: ["deferred-action"],
      },
    ],
    identityDecisionApplyContext: identityApplyContext,
    cleanupContext: cleanup,
    identity: { id: "dataset-id", version: "01.00.000" },
    rowIndex: 0,
  });
  assert.deepEqual(
    blockers.map((blocker: JsonRecord) => blocker.code),
    ["unresolved_trace_patch_evidence_required", "source_exchange_trace_patch_evidence_required"],
  );
  assert.equal(blockers[0].action_item_code, "missing-action");

  const withSourceAi = evidenceContext.tracePatchEvidenceBlockers({
    traceSummary: { source_exchange_completeness: [{ status: "unmatched" }] },
    aiPatchEvidence: [{ resolution: { mode: "source_trace_verified" } }],
  });
  assert.deepEqual(withSourceAi, []);
});

test("policy snapshots preserve safety-first/profile order, duplicates, relative paths, exact hashes, and missing evidence", () => {
  withTempRoot("patch-evidence-policy", (root) => {
    const safetyText = "# Safety\n";
    const profileText = "# Profile\n";
    writeText(path.join(root, "docs", "safety-policy.md"), safetyText);
    writeText(path.join(root, "docs", "profile.md"), profileText);
    const snapshots = evidenceContext.readPolicySnapshots(root, {
      docs: ["docs/profile.md", "docs/missing.md", "docs/profile.md"],
    });
    assert.deepEqual(snapshots, [
      {
        kind: "safety_policy",
        path: "docs/safety-policy.md",
        exists: true,
        sha256: sha256Text(safetyText),
      },
      {
        kind: "profile_context",
        path: "docs/profile.md",
        exists: true,
        sha256: sha256Text(profileText),
      },
      { kind: "profile_context", path: "docs/missing.md", exists: false, sha256: null },
      {
        kind: "profile_context",
        path: "docs/profile.md",
        exists: true,
        sha256: sha256Text(profileText),
      },
    ]);
    assert.throws(
      () => evidenceContext.readPolicySnapshots(root, { docs: [42] }),
      (error: unknown) => error instanceof TypeError,
    );
  });
});

test("import-only trace detection preserves recursive object/array traversal and native cycle failure", () => {
  assert.equal(evidenceContext.hasImportOnlyTrace(null), false);
  assert.equal(
    evidenceContext.hasImportOnlyTrace({
      items: [
        { ignored: true },
        { nested: { "common:other": { "tidasimport:sourceTrace": { source: "x" } } } },
      ],
    }),
    true,
  );
  assert.equal(
    evidenceContext.hasImportOnlyTrace({
      "common:other": { "@xmlns:tidasimport": "https://example.invalid" },
    }),
    true,
  );
  assert.equal(evidenceContext.hasImportOnlyTrace({ "common:other": [] }), false);
  const circular: JsonRecord = {};
  circular.self = circular;
  assert.throws(
    () => evidenceContext.hasImportOnlyTrace(circular),
    (error: unknown) => error instanceof RangeError,
  );
});

test("patch evidence context retains its exact export surface", () => {
  assert.deepEqual(Object.keys(evidenceContext), [
    "compactPatchEvidenceEntry",
    "hasImportOnlyTrace",
    "isDeterministicAnnualSupplyCleanupTrace",
    "isDeterministicSourceExchangeCleanupTrace",
    "patchEvidenceClosureCodes",
    "patchEvidenceForRow",
    "patchEvidenceIdentityKey",
    "readPatchApplyContext",
    "readPolicySnapshots",
    "tracePatchEvidenceBlockers",
  ]);
});

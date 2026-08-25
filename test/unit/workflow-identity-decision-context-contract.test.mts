import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import * as identityContext from "../../scripts/lib/import-curation/internal/workflow-identity-decision-context.mjs";
import { sha256Json, sha256Text } from "../../scripts/lib/import-curation/internal/hash-utils.ts";

type JsonRecord = Record<string, unknown>;

function writeText(filePath: string, text: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, text);
}

function writeJson(filePath: string, value: unknown): string {
  const text = `${JSON.stringify(value, null, 2)}\n`;
  writeText(filePath, text);
  return text;
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

test("identity rewrite discovery and normalization preserve candidate priority, aliases, references, and evidence", () => {
  withTempRoot("identity-rewrite-normalize", (root) => {
    const rowsFile = path.join(root, "scope", "rows", "processes.jsonl");
    fs.mkdirSync(path.dirname(rowsFile), { recursive: true });
    assert.equal(identityContext.defaultIdentityReferenceRewriteFile(rowsFile), null);
    const parentFlow = path.join(root, "scope", "identity-flow-reference-rewrites.jsonl");
    writeJsonLines(parentFlow, []);
    assert.equal(identityContext.defaultIdentityReferenceRewriteFile(rowsFile), parentFlow);
    const siblingFlow = path.join(root, "scope", "rows", "identity-flow-reference-rewrites.jsonl");
    writeJsonLines(siblingFlow, []);
    assert.equal(identityContext.defaultIdentityReferenceRewriteFile(rowsFile), siblingFlow);
    const siblingIdentity = path.join(root, "scope", "rows", "identity-reference-rewrites.jsonl");
    writeJsonLines(siblingIdentity, []);
    assert.equal(identityContext.defaultIdentityReferenceRewriteFile(rowsFile), siblingIdentity);

    const canonical = { ref_object_id: "canonical-id", version: "02.00.000" };
    const original = { ref_object_id: "original-id", version: "01.00.000" };
    const normalized = identityContext.normalizeIdentityReferenceRewriteRow({
      custom: "retained",
      datasetType: " process ",
      datasetId: " dataset-id ",
      version: "",
      relation: "",
      path: " /exchanges/0 ",
      action: "",
      reason: " duplicate ",
      source: original,
      replacement: canonical,
      identity_preflight: { score: 1 },
      evidence: { overwritten: true },
    });
    assert.equal(normalized.dataset_type, "process");
    assert.equal(normalized.dataset_id, "dataset-id");
    assert.equal(normalized.dataset_version, "00.00.001");
    assert.equal(normalized.relation, "flow_reference_to_identity_preflight_duplicate");
    assert.equal(normalized.path, "/exchanges/0");
    assert.equal(normalized.action, "rewrite_to_identity_preflight_duplicate_reference");
    assert.equal(normalized.reason, "duplicate");
    assert.equal(normalized.original, original);
    assert.equal(normalized.canonical, canonical);
    assert.deepEqual(normalized.evidence, {
      source: "identity-reference-rewrites.jsonl",
      identity_preflight: { score: 1 },
      original,
      canonical,
      reason: "duplicate",
    });
    assert.deepEqual(identityContext.normalizeIdentityReferenceRewriteRow(null), {
      dataset_type: null,
      dataset_id: "",
      dataset_version: "00.00.001",
      relation: "flow_reference_to_identity_preflight_duplicate",
      path: null,
      action: "rewrite_to_identity_preflight_duplicate_reference",
      reason: null,
      original: null,
      canonical: null,
      evidence: {
        source: "identity-reference-rewrites.jsonl",
        identity_preflight: null,
        original: null,
        canonical: null,
        reason: null,
      },
    });
    assert.throws(
      () => identityContext.defaultIdentityReferenceRewriteFile(null),
      (error: unknown) => error instanceof TypeError,
    );
  });
});

test("identity rewrite context preserves configured/default selection, scope order, dual indexes, status, paths, hashes, and errors", () => {
  withTempRoot("identity-rewrite-context", (root) => {
    const rowsFile = path.join(root, "scope", "rows", "processes.jsonl");
    const rewritesPath = path.join(root, "scope", "rows", "identity-reference-rewrites.jsonl");
    writeJsonLines(rewritesPath, [
      { dataset_id: "write-id", dataset_version: "01.00.000", marker: "exact" },
      { dataset_id: "write-id", dataset_version: "02.00.000", marker: "id-fallback" },
      { dataset_id: "reference-id", marker: "reference" },
      { dataset_id: "other-id", marker: "excluded" },
      { marker: "missing-id" },
    ]);
    const inputPayload = { marker: "input" };
    const outputPayload = { marker: "output" };
    writeJsonLines(path.join(root, "artifacts", "input.jsonl"), [
      { id: "write-id", version: "01.00.000", payload: inputPayload },
    ]);
    writeJsonLines(path.join(root, "artifacts", "output.jsonl"), [
      { id: "write-id", version: "01.00.000", payload: outputPayload },
    ]);
    const writeRows = new Map([
      ["write-id@@01.00.000", { identity: { id: "write-id", version: "01.00.000" } }],
    ]);
    const context = identityContext.readIdentityReferenceRewriteContext({
      repoRoot: root,
      rowsFile,
      options: {
        identityReferenceRewrites: "missing-configured.jsonl",
        identityReferenceRewriteStatus: " complete ",
        identityReferenceRewritesStatus: "ignored",
        identityReferenceRewriteInputRows: "artifacts/input.jsonl",
        identityReferenceRewriteOutputRowsFile: "artifacts/output.jsonl",
      },
      writeRows,
      referenceRows: [{ id: "reference-id", version: "00.00.001", payload: { marker: "ref" } }],
      datasetType: "process",
    });
    assert.equal(context.sourceFile, rewritesPath);
    assert.deepEqual(
      context.sourceRows.map((row: JsonRecord) => row.marker),
      ["exact", "id-fallback", "reference", "excluded", "missing-id"],
    );
    assert.deepEqual(
      context.scopedRows.map((row: JsonRecord) => row.marker),
      ["exact", "id-fallback", "reference"],
    );
    assert.deepEqual(
      context.byIdentity.get("write-id@@01.00.000").map((row: JsonRecord) => row.marker),
      ["exact"],
    );
    assert.deepEqual(
      context.byIdentity.get("write-id").map((row: JsonRecord) => row.marker),
      ["exact", "id-fallback"],
    );
    assert.equal(context.status, "complete");
    assert.equal(context.inputRowsFile, path.join(root, "artifacts", "input.jsonl"));
    assert.equal(context.outputRowsFile, path.join(root, "artifacts", "output.jsonl"));
    assert.deepEqual(
      [...context.inputPayloadSha256ByIdentity],
      [["process:write-id@@01.00.000", sha256Json(inputPayload)]],
    );
    assert.deepEqual(
      [...context.outputPayloadSha256ByIdentity],
      [["process:write-id@@01.00.000", sha256Json(outputPayload)]],
    );

    const configuredPath = path.join(root, "configured.jsonl");
    writeJsonLines(configuredPath, [{ dataset_id: "write-id", marker: "configured" }]);
    assert.equal(
      identityContext.readIdentityReferenceRewriteContext({
        repoRoot: root,
        rowsFile,
        options: { identityReferenceRewritesFile: "configured.jsonl" },
        writeRows,
        datasetType: "process",
      }).sourceFile,
      configuredPath,
    );
    writeText(configuredPath, "{bad}\n");
    assert.throws(
      () =>
        identityContext.readIdentityReferenceRewriteContext({
          repoRoot: root,
          rowsFile,
          options: { identityReferenceRewritesFile: "configured.jsonl" },
          writeRows,
          datasetType: "process",
        }),
      (error: unknown) => error instanceof SyntaxError,
    );
  });
});

test("identity decision accessors preserve alias precedence, normalization, keys, canonical references, and defaults", () => {
  const decision = {
    dataset_type: "flow",
    datasetType: "ignored",
    dataset_id: "flow-id",
    datasetId: "ignored-id",
    dataset_version: "",
    version: "02.00.000",
    closesActionItems: "first,second",
    resolution: { closes_action_items: "ignored", decision: "reuse" },
    identityDecision: "new",
    selectedReference: {
      table: "",
      refObjectId: "canonical-id",
      ref_version: "03.00.000",
    },
    authoringContext: {
      authoringPackage: "packages/decision.json",
      authoringPackageSha256: "package-sha",
    },
  };
  assert.equal(identityContext.identityDecisionDatasetType(decision), "flow");
  assert.equal(identityContext.identityDecisionDatasetId(decision), "flow-id");
  assert.equal(identityContext.identityDecisionDatasetVersion(decision), "00.00.001");
  assert.deepEqual(
    identityContext.identityDecisionIdentityKeys({
      datasetType: " flow ",
      id: " flow-id ",
      version: "",
    }),
    ["flow:flow-id@@00.00.001", "flow:flow-id", "flow-id@@00.00.001", "flow-id"],
  );
  assert.deepEqual(
    identityContext.identityDecisionIdentityKeys({ datasetType: "", id: "id", version: "1" }),
    [":id@@1", ":id", "id@@1", "id"],
  );
  assert.deepEqual(
    identityContext.identityDecisionIdentityKeys({ datasetType: "flow", id: "", version: "1" }),
    [],
  );
  assert.equal(identityContext.identityDecisionClosesAction(decision, "second"), true);
  assert.equal(identityContext.identityDecisionClosesAction(decision, "ignored"), false);
  assert.equal(identityContext.identityDecisionValue(decision), "create_new");
  assert.equal(
    identityContext.identityDecisionValue({ decision: "reuse_existing" }),
    "reuse_existing_reference",
  );
  assert.equal(
    identityContext.identityDecisionValue({ decision: "unresolved" }),
    "block_unresolved",
  );
  assert.equal(identityContext.identityDecisionValue({ decision: "custom" }), "custom");
  assert.deepEqual(identityContext.identityDecisionCanonical(decision), {
    table: "flows",
    ref_object_id: "canonical-id",
    version: "03.00.000",
  });
  assert.deepEqual(
    identityContext.identityDecisionCanonical({ canonical: { "@refObjectId": "id" } }),
    { table: "flows", ref_object_id: "id", version: "00.00.001" },
  );
  assert.equal(identityContext.identityDecisionCanonical({ canonical: [] }), null);
  assert.equal(identityContext.identityDecisionCanonical({ canonical: {} }), null);
  assert.equal(
    identityContext.identityDecisionPackageReference(decision),
    "packages/decision.json",
  );
  assert.equal(identityContext.identityDecisionPackageSha(decision), "package-sha");
});

test("identity apply context preserves file/embedded fallback, decision indexes, package proof dedupe, path order, payload hashes, and native errors", () => {
  withTempRoot("identity-apply-context", (root) => {
    const packagePayload = { contract_context_files: [] };
    const packagePath = path.join(root, "packages", "authoring.json");
    const packageText = writeJson(packagePath, packagePayload);
    const decisions = [
      {
        dataset_type: "flow",
        dataset_id: "flow-id",
        dataset_version: "01.00.000",
        status: "completed",
        identity_decision: "unresolved",
        closes_action_items: "elementary_flow_identity_manual_review",
        authoring_package: "packages/authoring.json",
        authoring_package_sha256: sha256Text(packageText),
        marker: "first",
      },
      {
        datasetType: "flow",
        datasetId: "flow-id",
        version: "01.00.000",
        decisionStatus: "completed",
        decision: "reuse",
        closesActionItems: ["duplicate_review"],
        authoringPackage: "packages/authoring.json",
        authoringPackageSha256: sha256Text(packageText),
        marker: "second",
      },
    ];
    writeJson(path.join(root, "decisions", "decisions.json"), { decisions });
    const inputOld = { marker: "input-old" };
    const inputNew = { marker: "input-new" };
    writeJsonLines(path.join(root, "rows", "input-a.jsonl"), [
      { id: "flow-id", version: "01.00.000", payload: inputOld },
    ]);
    writeJsonLines(path.join(root, "rows", "input-b.jsonl"), [
      { id: "flow-id", version: "01.00.000", payload: inputNew },
    ]);
    const outputPayload = { marker: "output" };
    writeJsonLines(path.join(root, "rows", "output.jsonl"), [
      { id: "flow-id", version: "01.00.000", payload: outputPayload },
    ]);
    const context = identityContext.readIdentityDecisionApplyContext(root, {
      path: "reports/apply.json",
      value: {
        status: " completed ",
        decisionsFile: "decisions/decisions.json",
        dataset_type: "flow",
        rowsFile: ["rows/missing.json", "rows/input-a.jsonl", "rows/input-b.jsonl"],
        files: {
          output_rows: "rows/output.jsonl",
          reference_rows: ["rows/reference-a.jsonl", null, "rows/reference-b.jsonl"],
          identity_reference_rewrites: "rewrites/identity.jsonl",
        },
      },
    });
    assert.equal(context.status, "completed");
    assert.equal(context.reportPath, "reports/apply.json");
    assert.equal(context.decisionsFile, path.join(root, "decisions", "decisions.json"));
    assert.deepEqual(
      context.byIdentity.get("flow:flow-id@@01.00.000").map((row: JsonRecord) => row.marker),
      ["first", "second"],
    );
    assert.equal(context.authoringPackageProofs.length, 1);
    assert.deepEqual(context.authoringPackageProofs[0].blockers, []);
    assert.deepEqual(context.inputRows, [
      path.join(root, "rows", "missing.json"),
      path.join(root, "rows", "input-a.jsonl"),
      path.join(root, "rows", "input-b.jsonl"),
    ]);
    assert.deepEqual(
      [...context.inputPayloadSha256ByIdentity],
      [["flow:flow-id@@01.00.000", sha256Json(inputNew)]],
    );
    assert.deepEqual(
      [...context.outputPayloadSha256ByIdentity],
      [["flow:flow-id@@01.00.000", sha256Json(outputPayload)]],
    );
    assert.deepEqual(context.referenceRows, [
      path.join(root, "rows", "reference-a.jsonl"),
      path.join(root, "rows", "reference-b.jsonl"),
    ]);
    assert.equal(
      context.identityReferenceRewritesFile,
      path.join(root, "rewrites", "identity.jsonl"),
    );

    const embedded = identityContext.readIdentityDecisionApplyContext(root, {
      path: "reports/embedded.json",
      value: { decisions_file: "missing.json", decisions: [decisions[1]] },
    });
    assert.deepEqual(embedded.decisions, [decisions[1]]);

    writeText(path.join(root, "decisions", "invalid.jsonl"), "{bad}\n");
    assert.throws(
      () =>
        identityContext.readIdentityDecisionApplyContext(root, {
          value: { decisions_file: "decisions/invalid.jsonl" },
        }),
      (error: unknown) => error instanceof SyntaxError,
    );
    assert.throws(
      () =>
        identityContext.readIdentityDecisionApplyContext(root, {
          value: { rows_file: [42] },
        }),
      (error: unknown) => error instanceof TypeError,
    );
    assert.equal(identityContext.readIdentityDecisionApplyContext(root, null), null);
  });
});

test("identity context merge preserves concatenation, map rows, proof/file dedupe, status, and one-context identity", () => {
  const proofA = { path: "packages/a.json", expected_sha256: "sha", marker: "first" };
  const proofADuplicate = { path: "packages/a.json", expected_sha256: "sha", marker: "duplicate" };
  const proofB = { path: "packages/b.json", expected_sha256: "sha-b", marker: "second" };
  const contextA = {
    status: "completed",
    reportPath: "report-a.json",
    decisions: [{ marker: "a" }],
    byIdentity: new Map([["flow:id", [{ marker: "a" }]]]),
    authoringPackageProofs: [proofA],
    inputRows: ["input-a", "shared"],
    outputRows: ["output-a"],
    referenceRows: ["ref-a", "shared-ref"],
    identityReferenceRewritesFile: "rewrite-a",
  };
  const contextB = {
    status: "blocked",
    reportPath: "report-b.json",
    decisions: [{ marker: "b" }],
    byIdentity: new Map([
      ["flow:id", [{ marker: "b" }]],
      ["flow:other", [{ marker: "other" }]],
    ]),
    authoringPackageProofs: [proofADuplicate, proofB],
    inputRows: ["shared", "input-b"],
    outputRows: ["output-a", "output-b"],
    referenceRows: ["shared-ref", "ref-b"],
    identityReferenceRewritesFiles: ["rewrite-b", "rewrite-a"],
  };
  assert.equal(identityContext.mergeIdentityDecisionApplyContexts([]), null);
  assert.equal(identityContext.mergeIdentityDecisionApplyContexts([contextA]), contextA);
  const merged = identityContext.mergeIdentityDecisionApplyContexts([contextA, null, contextB]);
  assert.equal(merged.status, "mixed");
  assert.equal(merged.reportPath, "report-a.json");
  assert.deepEqual(merged.reportPaths, ["report-a.json", "report-b.json"]);
  assert.deepEqual(
    merged.decisions.map((row: JsonRecord) => row.marker),
    ["a", "b"],
  );
  assert.deepEqual(
    merged.byIdentity.get("flow:id").map((row: JsonRecord) => row.marker),
    ["a", "b"],
  );
  assert.deepEqual(
    merged.authoringPackageProofs.map((proof: JsonRecord) => proof.marker),
    ["first", "second"],
  );
  assert.deepEqual(merged.inputRows, ["input-a", "shared", "input-b"]);
  assert.deepEqual(merged.outputRows, ["output-a", "output-b"]);
  assert.deepEqual(merged.referenceRows, ["ref-a", "shared-ref", "ref-b"]);
  assert.deepEqual(merged.identityReferenceRewritesFiles, ["rewrite-a", "rewrite-b"]);
  assert.equal(merged.identityReferenceRewritesFile, "rewrite-a");
  assert.equal(merged.decisionsFile, null);
  assert.equal(
    identityContext.mergeIdentityDecisionApplyContexts([
      contextA,
      { ...contextB, status: "completed" },
    ]).status,
    "completed",
  );
});

test("identity lookup, completion predicates, and unresolved reference keys preserve key priority and set order", () => {
  const completedReuse = {
    status: "completed",
    decision: "reuse",
    closes_action_items: ["duplicate_review"],
  };
  const blocked = {
    decision_status: "completed",
    dataset_type: "flow",
    dataset_id: "unresolved-a",
    dataset_version: "01.00.000",
    identity_decision: "unresolved",
    closes_action_items: ["elementary_flow_identity_manual_review"],
  };
  const context = {
    byIdentity: new Map([
      ["flow:id@@01.00.000", [completedReuse]],
      ["flow:id", [{ status: "completed", decision: "new" }]],
    ]),
    decisions: [
      blocked,
      { ...blocked },
      { ...blocked, dataset_id: "unresolved-b", version: "02.00.000" },
      { ...blocked, dataset_type: "process", dataset_id: "ignored-process" },
      { ...blocked, identity_decision: "reuse", dataset_id: "ignored-reuse" },
      { ...blocked, closes_action_items: ["other"], dataset_id: "ignored-closure" },
    ],
  };
  assert.deepEqual(
    identityContext.identityDecisionApplyContextDecisionsForIdentity({
      context,
      datasetType: "flow",
      id: "id",
      version: "01.00.000",
    }),
    [completedReuse],
  );
  assert.equal(
    identityContext.identityDecisionApplyContextClosesAction({
      context,
      datasetType: "flow",
      id: "id",
      version: "01.00.000",
      code: "duplicate_review",
    }),
    true,
  );
  assert.equal(
    identityContext.identityDecisionApplyContextHasDecision({
      context,
      datasetType: "flow",
      id: "id",
      version: "01.00.000",
      decisionValue: "reuse_existing_reference",
      closesAction: "duplicate_review",
    }),
    true,
  );
  assert.deepEqual(
    [...identityContext.identityDecisionUnresolvedReferenceKeys(context)],
    ["flows\u0000unresolved-a\u000001.00.000", "flows\u0000unresolved-b\u000001.00.000"],
  );
  assert.deepEqual(
    identityContext.identityDecisionApplyContextDecisionsForIdentity({
      context: null,
      datasetType: "flow",
      id: "id",
      version: "1",
    }),
    [],
  );
});

test("identity decision context retains its exact export surface", () => {
  assert.deepEqual(Object.keys(identityContext).sort(), [
    "defaultIdentityReferenceRewriteFile",
    "identityDecisionApplyContextClosesAction",
    "identityDecisionApplyContextDecisionsForIdentity",
    "identityDecisionApplyContextHasDecision",
    "identityDecisionCanonical",
    "identityDecisionClosesAction",
    "identityDecisionDatasetId",
    "identityDecisionDatasetType",
    "identityDecisionDatasetVersion",
    "identityDecisionIdentityKeys",
    "identityDecisionPackageReference",
    "identityDecisionPackageSha",
    "identityDecisionUnresolvedReferenceKeys",
    "identityDecisionValue",
    "mergeIdentityDecisionApplyContexts",
    "normalizeIdentityReferenceRewriteRow",
    "readIdentityDecisionApplyContext",
    "readIdentityDecisionApplyContexts",
    "readIdentityReferenceRewriteContext",
  ]);
});

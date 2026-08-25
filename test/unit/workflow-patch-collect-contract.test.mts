import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import * as patchCollect from "../../scripts/lib/import-curation/internal/workflow-patch-collect.mjs";

type JsonRecord = Record<string, unknown>;

function writeText(filePath: string, text: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, text);
}

function writeJson(filePath: string, value: unknown): void {
  writeText(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function writeJsonLines(filePath: string, rows: unknown[], newline = "\n"): void {
  writeText(
    filePath,
    rows.map((row) => JSON.stringify(row)).join(newline) + (rows.length ? newline : ""),
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

function baseTask(root: string): JsonRecord {
  return {
    entity: { entity_id: "dataset-id", version: "01.00.000", entity_type: "process" },
    files: { authoring_package: path.join(root, "packages", "authoring-package.json") },
    action_items: [{ code: "required_field", path: "/field" }],
    context: { full_context_ai_completion: { required: false } },
  };
}

function validPatchSet(): JsonRecord {
  return {
    dataset_id: "dataset-id",
    dataset_version: "01.00.000",
    authoring_package: "authoring-package.json",
    operations: [
      {
        op: "replace",
        path: "/field",
        value: "completed",
        basis: "source evidence",
        evidence: { source: "source.json", path: "/field" },
        resolution: { mode: "evidence_backed_completion", used_context_kinds: [] },
        closes: [{ code: "required_field", path: "/field" }],
      },
    ],
  };
}

test("patch validation preserves early invalid return, valid closure, and top-level blocker order", () => {
  withTempRoot("patch-collect-validation", (root) => {
    const patchPath = path.join(root, "patches", "patch.json");
    const task = baseTask(root);
    assert.deepEqual(
      patchCollect.validateCollectedPatchSet({
        repoRoot: root,
        task,
        patchSet: {},
        patchSetIndex: 3,
        patchPath,
      }),
      [
        {
          code: "patch_set_invalid",
          message: "AI patch output must contain patch sets with operations[].",
          patch_file: "patches/patch.json",
          patch_set_index: 3,
          entity: task.entity,
        },
      ],
    );

    assert.deepEqual(
      patchCollect.validateCollectedPatchSet({
        repoRoot: root,
        task,
        patchSet: validPatchSet(),
        patchSetIndex: 0,
        patchPath,
      }),
      [],
    );

    const empty = patchCollect.validateCollectedPatchSet({
      repoRoot: root,
      task,
      patchSet: { operations: [] },
      patchSetIndex: 1,
      patchPath,
    });
    assert.deepEqual(
      empty.map((blocker: JsonRecord) => blocker.code),
      [
        "patch_effective_operation_missing",
        "patch_target_missing",
        "patch_dataset_version_mismatch",
        "patch_authoring_package_missing",
        "patch_action_item_unclosed",
      ],
    );
    assert.equal(empty[4].path, "/field");

    const invalidOperation = patchCollect.validateCollectedPatchSet({
      repoRoot: root,
      task: { ...task, action_items: [] },
      patchSet: {
        dataset_id: "wrong-id",
        dataset_version: "02.00.000",
        authoring_package: "wrong-package.json",
        operations: [{ op: "move", path: "not-a-pointer", value: "__AI_FILL_VALUE__" }],
      },
      patchSetIndex: 2,
      patchPath,
    });
    assert.deepEqual(
      invalidOperation.map((blocker: JsonRecord) => blocker.code),
      [
        "patch_dataset_id_mismatch",
        "patch_dataset_version_mismatch",
        "patch_authoring_package_mismatch",
        "patch_operation_invalid",
        "patch_resolution_missing",
        "patch_path_invalid",
        "patch_evidence_missing",
        "patch_template_placeholder_unresolved",
      ],
    );
    assert.deepEqual(
      invalidOperation.slice(3).map((blocker: JsonRecord) => blocker.operation_index),
      [0, 0, 0, 0, 0],
    );
  });
});

test("annual-supply deferral, full-context requirements, trace contracts, and native circular errors stay fail-closed", () => {
  withTempRoot("patch-collect-evidence", (root) => {
    const patchPath = path.join(root, "patches", "patch.json");
    const annualTask = {
      ...baseTask(root),
      action_items: [
        {
          code: "annual_supply_or_production_volume_missing",
          path: "/processDataSet/annualSupplyOrProductionVolume",
        },
      ],
    };
    const deferred = patchCollect.validateCollectedPatchSet({
      repoRoot: root,
      task: annualTask,
      patchSet: {
        dataset_id: "dataset-id",
        dataset_version: "01.00.000",
        authoring_package: "authoring-package.json",
        operations: [
          {
            op: "add",
            path: "/processDataSet/common:other",
            value: { "tiangongfoundry:sourceTrace": { reason: "missing" } },
            basis: "missing source",
            evidence: { source: "source.json", path: "/annual" },
            resolution: { mode: "deferred_to_common_other", used_context_kinds: [] },
            closes: [
              {
                code: "annual_supply_or_production_volume_missing",
                path: "/processDataSet/annualSupplyOrProductionVolume",
              },
            ],
          },
        ],
      },
      patchSetIndex: 0,
      patchPath,
    });
    assert.equal(deferred[0].code, "patch_deferred_annual_supply_not_allowed");
    assert.equal(deferred[0].sentinel_value, "9999 missing-data-sentinel/year");

    const fullContextTask = {
      ...baseTask(root),
      context: {
        full_context_ai_completion: {
          required: true,
          required_context_kinds: ["schema", "ruleset"],
        },
        contract_context_files: [
          { kind: "schema", path: "schema.json" },
          { kind: "ruleset", path: "runtime-ruleset.json" },
        ],
      },
    };
    const fullContextPatch = validPatchSet();
    const operation = (fullContextPatch.operations as JsonRecord[])[0];
    operation.resolution = { mode: "evidence_backed_completion", used_context_kinds: ["schema"] };
    operation.evidence = "free-text-only";
    const fullContextBlockers = patchCollect.validateCollectedPatchSet({
      repoRoot: root,
      task: fullContextTask,
      patchSet: fullContextPatch,
      patchSetIndex: 0,
      patchPath,
    });
    assert.deepEqual(
      fullContextBlockers.map((blocker: JsonRecord) => blocker.code),
      ["patch_resolution_context_kind_missing", "patch_structured_evidence_required_full_context"],
    );

    const circular: JsonRecord = {};
    circular.self = circular;
    const circularPatch = validPatchSet();
    const circularOperation = (circularPatch.operations as JsonRecord[])[0];
    circularOperation.value = circular;
    circularOperation.resolution = {
      mode: "source_trace_verified",
      used_context_kinds: [],
    };
    assert.throws(
      () =>
        patchCollect.validateCollectedPatchSet({
          repoRoot: root,
          task: baseTask(root),
          patchSet: circularPatch,
          patchSetIndex: 0,
          patchPath,
        }),
      (error: unknown) => error instanceof TypeError,
    );
    assert.throws(
      () =>
        patchCollect.validateCollectedPatchSet({
          repoRoot: root,
          task: baseTask(root),
          patchSet: validPatchSet(),
          patchSetIndex: 0,
          patchPath: null,
        }),
      (error: unknown) => error instanceof TypeError,
    );
  });
});

test("JSONL and row readers preserve delimiters, envelopes, order, missing inputs, and native parse errors", () => {
  withTempRoot("patch-collect-readers", (root) => {
    const rowsPath = path.join(root, "rows", "rows.jsonl");
    writeText(rowsPath, '{"id":1}\r\n\r\n{"id":2}\r\n');
    assert.deepEqual(patchCollect.readJsonLines(rowsPath), [{ id: 1 }, { id: 2 }]);
    assert.deepEqual(patchCollect.readJsonLines(null), []);
    assert.deepEqual(patchCollect.readJsonLines(path.join(root, "missing.jsonl")), []);
    const emptyPath = path.join(root, "rows", "empty.jsonl");
    writeText(emptyPath, " \n");
    assert.deepEqual(patchCollect.readJsonLines(emptyPath), []);

    const envelopePath = path.join(root, "rows", "envelope.json");
    writeJson(envelopePath, { rows: [{ id: "a" }, { id: "b" }] });
    assert.deepEqual(patchCollect.readRowsIfExists(envelopePath), [{ id: "a" }, { id: "b" }]);
    assert.deepEqual(patchCollect.readRowsIfExists(null), []);

    const invalidPath = path.join(root, "rows", "invalid.jsonl");
    writeText(invalidPath, '{"ok":true}\n{bad}\n');
    assert.throws(
      () => patchCollect.readJsonLines(invalidPath),
      (error: unknown) => error instanceof SyntaxError,
    );
    assert.throws(
      () => patchCollect.readRowsIfExists(invalidPath),
      (error: unknown) => error instanceof SyntaxError,
    );
  });
});

test("artifact option readers preserve alias encounter order, duplicates, filtering, paths, and native errors", () => {
  withTempRoot("patch-collect-artifacts", (root) => {
    writeJson(path.join(root, "reports", "first.json"), { marker: "first" });
    writeJson(path.join(root, "reports", "second.json"), { marker: "second" });
    assert.deepEqual(patchCollect.readJsonIfOption(root, null), null);
    assert.deepEqual(patchCollect.readJsonIfOption(root, "reports/first.json"), {
      path: path.join(root, "reports", "first.json"),
      value: { marker: "first" },
    });
    assert.equal(patchCollect.readFileArtifactIfOption(root, "reports/missing.json"), null);
    assert.equal(
      patchCollect.readFileArtifactIfOption(root, "reports/second.json"),
      path.join(root, "reports", "second.json"),
    );
    assert.deepEqual(
      patchCollect.readJsonArtifactsIfOption(root, [
        "reports/first.json,reports/missing.json",
        "reports/second.json",
        "reports/first.json",
      ]),
      [
        { path: path.join(root, "reports", "first.json"), value: { marker: "first" } },
        { path: path.join(root, "reports", "second.json"), value: { marker: "second" } },
        { path: path.join(root, "reports", "first.json"), value: { marker: "first" } },
      ],
    );
    assert.deepEqual(
      patchCollect.identityDecisionApplyReportOptionValues({
        identityDecisionApplyReport: "a.json,b.json",
        identityDecisionsApplyReport: ["b.json", "c.json"],
        identityDecisionApplyReports: "d.json",
        identityDecisionsApplyReports: "a.json,e.json",
      }),
      ["a.json", "b.json", "c.json", "d.json", "e.json"],
    );
    assert.throws(
      () => patchCollect.identityDecisionApplyReportOptionValues(null),
      (error: unknown) => error instanceof TypeError,
    );
    assert.throws(
      () => patchCollect.readJsonIfOption(root, 42),
      (error: unknown) => error instanceof TypeError,
    );
  });
});

test("source rewrite discovery and normalization preserve candidate priority, aliases, references, and evidence envelope", () => {
  withTempRoot("patch-collect-source-rewrite", (root) => {
    const rowsFile = path.join(root, "scope", "rows", "processes.jsonl");
    fs.mkdirSync(path.dirname(rowsFile), { recursive: true });
    assert.equal(patchCollect.defaultSourceReferenceRewriteFile(rowsFile), null);
    const parentCandidate = path.join(root, "scope", "source-reference-rewrites.jsonl");
    writeJsonLines(parentCandidate, [{ marker: "parent" }]);
    assert.equal(patchCollect.defaultSourceReferenceRewriteFile(rowsFile), parentCandidate);
    const siblingCandidate = path.join(root, "scope", "rows", "source-reference-rewrites.jsonl");
    writeJsonLines(siblingCandidate, [{ marker: "sibling" }]);
    assert.equal(patchCollect.defaultSourceReferenceRewriteFile(rowsFile), siblingCandidate);

    const original = { id: "original" };
    const canonical = { id: "canonical" };
    const normalized = patchCollect.normalizeSourceReferenceRewriteRow({
      custom: "retained",
      datasetType: " process ",
      datasetId: " id-1 ",
      version: "",
      relation: " format ",
      path: " /source ",
      action: "",
      reason: " duplicate ",
      sourceFile: " source.json ",
      original,
      canonical,
      evidence: { overwritten: true },
    });
    assert.deepEqual(normalized, {
      custom: "retained",
      datasetType: " process ",
      datasetId: " id-1 ",
      version: "",
      relation: "format",
      path: "/source",
      action: "rewrite_to_canonical_source_reference",
      reason: "duplicate",
      sourceFile: " source.json ",
      original,
      canonical,
      evidence: {
        source: "source-reference-rewrites.jsonl",
        source_file: "source.json",
        original,
        canonical,
        reason: "duplicate",
      },
      dataset_type: "process",
      dataset_id: "id-1",
      dataset_version: "00.00.001",
    });
    assert.equal(normalized.evidence.original, original);
    assert.equal(normalized.evidence.canonical, canonical);
    assert.deepEqual(patchCollect.normalizeSourceReferenceRewriteRow(null), {
      dataset_type: null,
      dataset_id: "",
      dataset_version: "00.00.001",
      relation: null,
      path: null,
      action: "rewrite_to_canonical_source_reference",
      reason: null,
      evidence: {
        source: "source-reference-rewrites.jsonl",
        source_file: null,
        original: null,
        canonical: null,
        reason: null,
      },
    });
    assert.throws(
      () => patchCollect.defaultSourceReferenceRewriteFile(null),
      (error: unknown) => error instanceof TypeError,
    );
  });
});

test("patch collect helper retains its exact export surface", () => {
  assert.deepEqual(Object.keys(patchCollect).sort(), [
    "defaultSourceReferenceRewriteFile",
    "identityDecisionApplyReportOptionValues",
    "normalizeSourceReferenceRewriteRow",
    "readFileArtifactIfOption",
    "readJsonArtifactsIfOption",
    "readJsonIfOption",
    "readJsonLines",
    "readRowsIfExists",
    "validateCollectedPatchSet",
  ]);
});

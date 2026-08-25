import test from "node:test";
import { flowIdentityReferenceFixtureRoot } from "../fixtures/fixture-roots.ts";
import {
  assert,
  blockerCodes,
  fs,
  path,
  readJsonLines,
  rel,
  repoRoot,
  runFoundry,
  testTmpRoot,
  writeJson,
  writeJsonLines,
} from "../fixtures/foundry-core.ts";
import { writeCompletedIdentityPreflightIndex } from "../fixtures/identity-fixtures.ts";
import {
  flowRow,
  flowRowWithClassification,
  processRowWithFlowRef,
} from "../fixtures/row-builders.ts";

test("identity duplicate flow decisions become reference reuse rows before mutation planning", () => {
  fs.rmSync(flowIdentityReferenceFixtureRoot, {
    recursive: true,
    force: true,
  });
  const duplicateFlowId = "aaaaaaaa-bbbb-4ccc-8ddd-000000000010";
  const newFlowId = "aaaaaaaa-bbbb-4ccc-8ddd-000000000011";
  const existingFlowId = "aaaaaaaa-bbbb-4ccc-8ddd-000000000012";
  const rowsFile = path.join(flowIdentityReferenceFixtureRoot, "flows.jsonl");
  writeJsonLines(rowsFile, [flowRow(duplicateFlowId), flowRow(newFlowId)]);

  try {
    const identityIndex = writeCompletedIdentityPreflightIndex(flowIdentityReferenceFixtureRoot, [
      {
        datasetType: "flow",
        id: duplicateFlowId,
        name: "Natural gas",
        decision: "block_duplicate",
        status: "blocked",
        candidates: [
          {
            index: 0,
            id: existingFlowId,
            version: "03.00.004",
            state_code: 100,
            names: ["Natural gas"],
            fields: { type_of_dataset: "Product flow" },
            match_score: 100,
            match_reasons: ["equivalent_flow_core_fields"],
            decision_hint: "block_duplicate",
          },
        ],
      },
      {
        datasetType: "flow",
        id: newFlowId,
        name: "New product flow",
        decision: "create_new",
        status: "passed",
        candidates: [],
      },
    ]);

    const rewriteReport = runFoundry([
      "dataset-identity-reference-rewrites-apply",
      "--type",
      "flow",
      "--rows-file",
      rel(rowsFile),
      "--identity-preflight-index",
      rel(identityIndex),
      "--out-dir",
      rel(path.join(flowIdentityReferenceFixtureRoot, "identity-rewrites")),
    ]);
    assert.equal(rewriteReport.code, 0);
    assert.equal(rewriteReport.json.status, "completed");
    assert.equal(rewriteReport.json.counts.input_rows, 2);
    assert.equal(rewriteReport.json.counts.output_rows, 1);
    assert.equal(rewriteReport.json.counts.reference_rows, 1);
    assert.equal(rewriteReport.json.counts.flow_reference_rewrites, 1);

    const outputRows = readJsonLines(path.join(repoRoot, rewriteReport.json.files.output_rows));
    const referenceRows = readJsonLines(
      path.join(repoRoot, rewriteReport.json.files.reference_rows),
    );
    assert.equal(
      outputRows[0].flowDataSet.flowInformation.dataSetInformation["common:UUID"],
      newFlowId,
    );
    assert.equal(
      referenceRows[0].flowDataSet.flowInformation.dataSetInformation["common:UUID"],
      duplicateFlowId,
    );

    const schemaReport = path.join(
      flowIdentityReferenceFixtureRoot,
      "schema",
      "validation-report.json",
    );
    writeJson(schemaReport, {
      input_path: rewriteReport.json.files.output_rows,
      status: "completed",
      rows: [
        {
          index: 0,
          id: newFlowId,
          version: "00.00.001",
          type: "flow",
          status: "valid",
          issues: [],
        },
      ],
    });
    const manifest = runFoundry([
      "dataset-mutation-manifest",
      "--type",
      "flow",
      "--profile",
      "generic",
      "--rows-file",
      rewriteReport.json.files.output_rows,
      "--reference-rows",
      rewriteReport.json.files.reference_rows,
      "--identity-reference-rewrites",
      rewriteReport.json.files.identity_reference_rewrites,
      "--schema-report",
      rel(schemaReport),
      "--require-curation-gate",
      "false",
      "--out-dir",
      rel(path.join(flowIdentityReferenceFixtureRoot, "mutation-manifest")),
    ]);
    assert.equal(manifest.code, 1);
    assert.equal(manifest.json.status, "blocked");
    assert.equal(manifest.json.counts.write_candidates, 0);
    assert.equal(manifest.json.counts.planned_write_candidates, 1);
    assert.equal(manifest.json.counts.blocked_write_candidates, 1);
    assert.equal(manifest.json.counts.reference_reuse, 1);
    assert.equal(manifest.json.counts.identity_reference_rewrites, 1);
    assert.equal(manifest.json.counts.identity_reference_reuse_rows, 1);
    assert.deepEqual(
      manifest.json.items.map((item) => item.role),
      ["write_candidate", "reference_reuse"],
    );
    const referenceItem = manifest.json.items.find((item) => item.role === "reference_reuse")!;
    assert.equal(referenceItem.entity_id, duplicateFlowId);
    assert.equal(referenceItem.identity_reference_rewrite_count, 1);
    assert.equal(referenceItem.canonical_references[0].ref_object_id, existingFlowId);
  } finally {
    fs.rmSync(flowIdentityReferenceFixtureRoot, {
      recursive: true,
      force: true,
    });
  }
});

test("unresolved root flow identity decisions are deferred before flow write planning", () => {
  const root = path.join(repoRoot, "tmp", "flow-root-identity-unresolved-reference-test");
  fs.rmSync(root, { recursive: true, force: true });
  const unresolvedFlowId = "aaaaaaaa-bbbb-4ccc-8ddd-000000000015";
  const writeFlowId = "aaaaaaaa-bbbb-4ccc-8ddd-000000000016";
  const rowsFile = path.join(root, "flows.jsonl");
  const unresolvedReferencesFile = path.join(root, "identity-unresolved-references.jsonl");
  writeJsonLines(rowsFile, [flowRow(unresolvedFlowId), flowRow(writeFlowId)]);
  writeJsonLines(unresolvedReferencesFile, [
    {
      relation: "elementary_flow_identity_ai_decision_unresolved",
      action: "preserve_dependent_process_reference_with_trace",
      dataset_type: "flow",
      dataset_id: unresolvedFlowId,
      dataset_version: "00.00.001",
      original: {
        table: "flows",
        ref_object_id: unresolvedFlowId,
        version: "00.00.001",
        short_description: "Unresolved elementary flow",
      },
      identity_decision: {
        decision: "block_unresolved",
        basis:
          "No sufficient public elementary flow candidate was available; do not create an account-local elementary flow.",
      },
      evidence: {
        target: {
          id: unresolvedFlowId,
          fields: { type_of_dataset: "Elementary flow" },
        },
      },
    },
  ]);

  try {
    const rewriteReport = runFoundry([
      "dataset-identity-reference-rewrites-apply",
      "--type",
      "flow",
      "--rows-file",
      rel(rowsFile),
      "--identity-unresolved-references",
      rel(unresolvedReferencesFile),
      "--out-dir",
      rel(path.join(root, "identity-rewrites")),
    ]);
    assert.equal(rewriteReport.code, 0);
    assert.equal(rewriteReport.json.status, "completed");
    assert.equal(rewriteReport.json.counts.input_rows, 2);
    assert.equal(rewriteReport.json.counts.output_rows, 1);
    assert.equal(rewriteReport.json.counts.root_flow_unresolved_rows, 1);
    assert.equal(rewriteReport.json.counts.flow_reference_unresolved_traces, 1);

    const outputRows = readJsonLines(path.join(repoRoot, rewriteReport.json.files.output_rows));
    const unresolvedRows = readJsonLines(
      path.join(repoRoot, rewriteReport.json.files.identity_unresolved_references),
    );
    assert.equal(
      outputRows[0].flowDataSet.flowInformation.dataSetInformation["common:UUID"],
      writeFlowId,
    );
    assert.equal(unresolvedRows[0].relation, "root_flow_identity_unresolved");
    assert.equal(unresolvedRows[0].dataset_id, unresolvedFlowId);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("identity duplicate flow rewrites require high-confidence preflight evidence", () => {
  const root = path.join(repoRoot, "tmp", "flow-identity-low-confidence-reference-test");
  fs.rmSync(root, { recursive: true, force: true });
  const duplicateFlowId = "aaaaaaaa-bbbb-4ccc-8ddd-000000000013";
  const existingFlowId = "aaaaaaaa-bbbb-4ccc-8ddd-000000000014";
  const rowsFile = path.join(root, "flows.jsonl");
  writeJsonLines(rowsFile, [flowRow(duplicateFlowId)]);

  try {
    const identityIndex = writeCompletedIdentityPreflightIndex(root, [
      {
        datasetType: "flow",
        id: duplicateFlowId,
        name: "Natural gas",
        decision: "block_duplicate",
        status: "blocked",
        confidence: "medium",
        candidates: [
          {
            index: 0,
            id: existingFlowId,
            version: "03.00.004",
            state_code: 100,
            names: ["Natural gas"],
            fields: { type_of_dataset: "Product flow" },
            match_score: 100,
            match_reasons: ["equivalent_flow_core_fields"],
            decision_hint: "block_duplicate",
          },
        ],
      },
    ]);

    const rewriteReport = runFoundry([
      "dataset-identity-reference-rewrites-apply",
      "--type",
      "flow",
      "--rows-file",
      rel(rowsFile),
      "--identity-preflight-index",
      rel(identityIndex),
      "--out-dir",
      rel(path.join(root, "identity-rewrites")),
    ]);
    assert.equal(rewriteReport.code, 0);
    assert.equal(rewriteReport.json.status, "completed_no_rewrites");
    assert.equal(rewriteReport.json.counts.output_rows, 1);
    assert.equal(rewriteReport.json.counts.reference_rows, 0);
    assert.equal(rewriteReport.json.counts.duplicate_flow_mappings, 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("AI identity decisions apply split flow rows into writes and reference reuse", () => {
  const root = testTmpRoot("flow-identity-decisions-apply-test");
  fs.rmSync(root, { recursive: true, force: true });
  const reuseFlowId = "aaaaaaaa-bbbb-4ccc-8ddd-000000000030";
  const createFlowId = "aaaaaaaa-bbbb-4ccc-8ddd-000000000031";
  const existingFlowId = "aaaaaaaa-bbbb-4ccc-8ddd-000000000032";
  const rowsFile = path.join(root, "flows.jsonl");
  const decisionsFile = path.join(root, "identity-decisions.jsonl");
  const incompleteDecisionsFile = path.join(root, "identity-decisions-incomplete.jsonl");
  writeJsonLines(rowsFile, [flowRow(reuseFlowId), flowRow(createFlowId)]);
  writeJsonLines(incompleteDecisionsFile, [
    {
      dataset_type: "flow",
      dataset_id: reuseFlowId,
      dataset_version: "00.00.001",
      decision_status: "completed",
      identity_decision: "reuse_existing_reference",
      canonical: {
        table: "flows",
        ref_object_id: "__AI_FILL_CANONICAL_REF_OBJECT_ID__",
        version: "03.00.004",
      },
      basis:
        "The selected database flow matches the source-language base name and identity preflight candidate fields.",
      evidence: {
        used_context_kinds: ["schema", "methodology_yaml", "ruleset"],
      },
      used_context_kinds: ["schema", "methodology_yaml", "ruleset"],
      closes_action_items: ["identity_preflight_manual_review"],
    },
  ]);
  writeJsonLines(decisionsFile, [
    {
      dataset_type: "flow",
      dataset_id: reuseFlowId,
      dataset_version: "00.00.001",
      decision_status: "completed",
      identity_decision: "reuse_existing_reference",
      canonical: {
        table: "flows",
        ref_object_id: existingFlowId,
        version: "03.00.004",
        short_description: "Natural gas",
      },
      basis:
        "The selected database flow matches the source-language base name and identity preflight candidate fields, so this row should reuse the existing reference.",
      evidence: {
        used_context_kinds: ["schema", "methodology_yaml", "ruleset"],
        remote_search: {
          endpoint: "flow_hybrid_search",
          candidate_id: existingFlowId,
          match_reasons: ["source_name_match", "flow_type_match"],
        },
      },
      used_context_kinds: ["schema", "methodology_yaml", "ruleset"],
      closes_action_items: ["identity_preflight_manual_review"],
    },
    {
      dataset_type: "flow",
      dataset_id: createFlowId,
      dataset_version: "00.00.001",
      decision_status: "completed",
      identity_decision: "create_new",
      basis:
        "No existing database candidate matched the source-language base name and source flow identity closely enough, so this row remains a write candidate.",
      evidence: {
        used_context_kinds: ["schema", "methodology_yaml", "ruleset"],
        remote_search: {
          endpoint: "flow_hybrid_search",
          candidate_count: 0,
        },
      },
      used_context_kinds: ["schema", "methodology_yaml", "ruleset"],
      closes_action_items: ["identity_preflight_manual_review"],
    },
  ]);

  try {
    const incompleteApplyReport = runFoundry([
      "dataset-identity-decisions-apply",
      "--type",
      "flow",
      "--rows-file",
      rel(rowsFile),
      "--decisions",
      rel(incompleteDecisionsFile),
      "--out-dir",
      rel(path.join(root, "identity-decisions-incomplete-applied")),
    ]);
    assert.equal(incompleteApplyReport.code, 1);
    assert.equal(incompleteApplyReport.json.status, "blocked");
    assert.ok(
      incompleteApplyReport.json.blockers.some(
        (blocker) => blocker.code === "identity_decision_template_incomplete",
      ),
    );

    const applyReport = runFoundry([
      "dataset-identity-decisions-apply",
      "--type",
      "flow",
      "--rows-file",
      rel(rowsFile),
      "--decisions",
      rel(decisionsFile),
      "--out-dir",
      rel(path.join(root, "identity-decisions-applied")),
    ]);
    assert.equal(applyReport.code, 0);
    assert.equal(applyReport.json.status, "completed");
    assert.equal(applyReport.json.counts.input_rows, 2);
    assert.equal(applyReport.json.counts.output_rows, 1);
    assert.equal(applyReport.json.counts.reference_rows, 1);
    assert.equal(applyReport.json.counts.identity_reference_rewrites, 1);
    assert.equal(applyReport.json.counts.evidence_rows, 2);

    const outputRows = readJsonLines(path.join(repoRoot, applyReport.json.files.output_rows));
    const referenceRows = readJsonLines(path.join(repoRoot, applyReport.json.files.reference_rows));
    const rewriteRows = readJsonLines(
      path.join(repoRoot, applyReport.json.files.identity_reference_rewrites),
    );
    assert.equal(
      outputRows[0].flowDataSet.flowInformation.dataSetInformation["common:UUID"],
      createFlowId,
    );
    assert.equal(
      referenceRows[0].flowDataSet.flowInformation.dataSetInformation["common:UUID"],
      reuseFlowId,
    );
    assert.equal(rewriteRows[0].canonical.ref_object_id, existingFlowId);

    const schemaReport = path.join(root, "schema", "validation-report.json");
    writeJson(schemaReport, {
      input_path: applyReport.json.files.output_rows,
      status: "completed",
      rows: [
        {
          index: 0,
          id: createFlowId,
          version: "00.00.001",
          type: "flow",
          status: "valid",
          issues: [],
        },
      ],
    });
    const manifest = runFoundry([
      "dataset-mutation-manifest",
      "--type",
      "flow",
      "--profile",
      "generic",
      "--rows-file",
      applyReport.json.files.output_rows,
      "--reference-rows",
      applyReport.json.files.reference_rows,
      "--identity-reference-rewrites",
      applyReport.json.files.identity_reference_rewrites,
      "--schema-report",
      rel(schemaReport),
      "--require-curation-gate",
      "false",
      "--out-dir",
      rel(path.join(root, "mutation-manifest")),
    ]);
    assert.equal(manifest.json.counts.write_candidates, 0);
    assert.equal(manifest.json.counts.planned_write_candidates, 1);
    assert.equal(manifest.json.counts.blocked_write_candidates, 1);
    assert.equal(manifest.json.counts.reference_reuse, 1);
    assert.equal(manifest.json.counts.identity_reference_rewrites, 1);
    assert.equal(manifest.json.counts.identity_reference_reuse_rows, 1);

    const processId = "aaaaaaaa-bbbb-4ccc-8ddd-000000000033";
    const processRowsFile = path.join(root, "processes.jsonl");
    writeJsonLines(processRowsFile, [processRowWithFlowRef(processId, reuseFlowId)]);
    const processRewrite = runFoundry([
      "dataset-identity-reference-rewrites-apply",
      "--type",
      "process",
      "--rows-file",
      rel(processRowsFile),
      "--identity-decision-apply-report",
      applyReport.json.files.report,
      "--out-dir",
      rel(path.join(root, "process-identity-rewrites")),
    ]);
    assert.equal(processRewrite.code, 0);
    assert.equal(processRewrite.json.status, "completed");
    assert.equal(processRewrite.json.counts.flow_reference_rewrites, 1);
    const rewrittenProcess = readJsonLines(
      path.join(repoRoot, processRewrite.json.files.output_rows),
    )[0];
    assert.equal(
      rewrittenProcess.processDataSet.exchanges.exchange[0].referenceToFlowDataSet["@refObjectId"],
      existingFlowId,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("AI identity decisions apply blocks create_new for elementary flows", () => {
  const root = path.join(repoRoot, "tmp", "elementary-flow-identity-create-new-block-test");
  fs.rmSync(root, { recursive: true, force: true });
  const flowId = "aaaaaaaa-bbbb-4ccc-8ddd-000000000039";
  const rowsFile = path.join(root, "flows.jsonl");
  const decisionsFile = path.join(root, "identity-decisions.jsonl");
  writeJsonLines(rowsFile, [
    flowRowWithClassification({
      flowId,
      typeOfDataSet: "Elementary flow",
      classification: {
        "common:elementaryFlowCategorization": {
          "common:category": [
            { "@level": "0", "#text": "Emissions" },
            { "@level": "1", "#text": "Emissions to air" },
          ],
        },
      },
    }),
  ]);
  writeJsonLines(decisionsFile, [
    {
      dataset_type: "flow",
      dataset_id: flowId,
      dataset_version: "00.00.001",
      decision_status: "completed",
      identity_decision: "create_new",
      basis: "The AI could not select an existing elementary flow candidate.",
      evidence: {
        used_context_kinds: ["schema", "methodology_yaml", "ruleset"],
        remote_search: {
          endpoint: "flow_hybrid_search",
          candidate_count: 0,
        },
      },
      used_context_kinds: ["schema", "methodology_yaml", "ruleset"],
      closes_action_items: ["elementary_flow_identity_manual_review"],
    },
  ]);

  try {
    const applyReport = runFoundry([
      "dataset-identity-decisions-apply",
      "--type",
      "flow",
      "--rows-file",
      rel(rowsFile),
      "--decisions",
      rel(decisionsFile),
      "--out-dir",
      rel(path.join(root, "identity-decisions-applied")),
    ]);
    assert.equal(applyReport.code, 1);
    assert.equal(applyReport.json.status, "blocked");
    assert.ok(blockerCodes(applyReport.json).has("elementary_flow_identity_create_new_blocked"));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

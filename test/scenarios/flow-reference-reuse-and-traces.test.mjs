import test from "node:test";
import {
  assert,
  fs,
  fullContextKinds,
  itemBlockerCodes,
  path,
  readJson,
  readJsonLines,
  rel,
  repoRoot,
  runFoundry,
  sha256Text,
  targetUserId,
  testTmpRoot,
  writeJson,
  writeJsonLines,
} from "../fixtures/foundry-core.ts";
import { writeContextPackFiles } from "../fixtures/full-context-fixtures.mjs";
import { writeCompletedIdentityPreflightIndex } from "../fixtures/identity-fixtures.mjs";
import { flowRowWithClassification, processRowWithFlowRef } from "../fixtures/row-builders.mjs";

test("unresolved elementary flow identity decisions defer references as Foundry traces", () => {
  const root = testTmpRoot("elementary-flow-identity-unresolved-trace-test");
  fs.rmSync(root, { recursive: true, force: true });
  const flowId = "aaaaaaaa-bbbb-4ccc-8ddd-000000000041";
  const processId = "aaaaaaaa-bbbb-4ccc-8ddd-000000000042";
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
            { "@level": "2", "#text": "Emissions to air, unspecified" },
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
      identity_decision: "block_unresolved",
      basis:
        "The full context and flow_hybrid_search evidence did not provide an identity-equivalent public elementary flow, and Foundry must not create account-local elementary flows.",
      evidence: {
        used_context_kinds: fullContextKinds,
        remote_search: {
          endpoint: "flow_hybrid_search",
          query: "flow name: Noise, road, passenger car, average",
          candidate_count: 0,
        },
        target: {
          id: flowId,
          fields: {
            type_of_dataset: "Elementary flow",
            flow_property: "Length",
          },
        },
        top_candidates: [],
      },
      used_context_kinds: fullContextKinds,
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
    assert.equal(applyReport.code, 0);
    assert.equal(applyReport.json.status, "completed");
    assert.equal(applyReport.json.counts.output_rows, 0);
    assert.equal(applyReport.json.counts.unresolved_reference_rows, 1);
    assert.equal(applyReport.json.counts.identity_unresolved_references, 1);
    assert.equal(readJsonLines(path.join(repoRoot, applyReport.json.files.output_rows)).length, 0);

    const processRowsFile = path.join(root, "processes.jsonl");
    writeJsonLines(processRowsFile, [processRowWithFlowRef(processId, flowId)]);
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
    assert.equal(processRewrite.json.counts.flow_reference_rewrites, 0);
    assert.equal(processRewrite.json.counts.flow_reference_unresolved_traces, 1);
    const rewrittenProcess = readJsonLines(
      path.join(repoRoot, processRewrite.json.files.output_rows),
    )[0];
    assert.equal(
      rewrittenProcess.processDataSet.exchanges.exchange[0].referenceToFlowDataSet["@refObjectId"],
      flowId,
    );
    const trace =
      rewrittenProcess.processDataSet.processInformation.dataSetInformation["common:other"][
        "tiangongfoundry:unresolvedTrace"
      ][0];
    assert.equal(trace.action_item_code, "elementary_flow_identity_manual_review");
    assert.equal(trace.reference_id, flowId);
    assert.equal(trace.evidence.source, "dataset-identity-decisions-apply");

    const schemaReport = path.join(root, "schema", "validation-report.json");
    writeJson(schemaReport, {
      input_path: processRewrite.json.files.output_rows,
      status: "completed",
      rows: [
        {
          index: 0,
          id: processId,
          version: "00.00.001",
          type: "process",
          status: "valid",
          issues: [],
        },
      ],
    });
    const manifest = runFoundry([
      "dataset-mutation-manifest",
      "--type",
      "process",
      "--profile",
      "generic",
      "--rows-file",
      processRewrite.json.files.output_rows,
      "--schema-report",
      rel(schemaReport),
      "--identity-decision-apply-report",
      applyReport.json.files.report,
      "--require-curation-gate",
      "false",
      "--target-user-id",
      targetUserId,
      "--out-dir",
      rel(path.join(root, "mutation-manifest")),
    ]);
    assert.equal(manifest.json.status, "blocked");
    assert.equal(manifest.json.counts.unresolved_trace_entries, 1);
    assert.equal(
      itemBlockerCodes(manifest.json).has("reference_closure_remote_verify_required"),
      false,
    );
    assert.equal(
      itemBlockerCodes(manifest.json).has("unresolved_trace_patch_evidence_required"),
      false,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("same-reference identity rewrites preserve curated process exchange descriptions", () => {
  const root = testTmpRoot("same-reference-description-preservation-test");
  fs.rmSync(root, { recursive: true, force: true });
  const flowId = "aaaaaaaa-bbbb-4ccc-8ddd-000000000045";
  const processId = "aaaaaaaa-bbbb-4ccc-8ddd-000000000046";
  const rowsFile = path.join(root, "processes.jsonl");
  const processRow = processRowWithFlowRef(processId, flowId);
  processRow.processDataSet.exchanges.exchange[0].referenceToFlowDataSet[
    "common:shortDescription"
  ] = {
    "@xml:lang": "en",
    "#text": "Electricity, lignite, at power plant",
  };
  writeJsonLines(rowsFile, [processRow]);
  const rewritesFile = path.join(root, "identity-reference-rewrites.jsonl");
  writeJsonLines(rewritesFile, [
    {
      relation: "flow_identity_ai_decision_reference",
      action: "reuse_ai_selected_existing_reference",
      dataset_type: "flow",
      dataset_id: flowId,
      dataset_version: "00.00.001",
      original: {
        table: "flows",
        ref_object_id: flowId,
        version: "00.00.001",
      },
      canonical: {
        table: "flows",
        ref_object_id: flowId,
        version: "00.00.001",
        short_description: "Electricity, lignite, at power plant {DE}",
      },
      identity_decision: {
        source: "dataset-identity-decisions-apply",
        decision: "reuse_existing_reference",
        basis:
          "The same BAFU product flow was already committed and verified in the preceding flow write stage.",
      },
    },
  ]);

  try {
    const rewrite = runFoundry([
      "dataset-identity-reference-rewrites-apply",
      "--type",
      "process",
      "--rows-file",
      rel(rowsFile),
      "--identity-reference-rewrites",
      rel(rewritesFile),
      "--out-dir",
      rel(path.join(root, "process-identity-rewrites")),
    ]);
    assert.equal(rewrite.code, 0);
    assert.equal(rewrite.json.status, "completed");
    assert.equal(rewrite.json.counts.flow_reference_rewrites, 1);

    const rewrittenProcess = readJsonLines(path.join(repoRoot, rewrite.json.files.output_rows))[0];
    const rewrittenRef =
      rewrittenProcess.processDataSet.exchanges.exchange[0].referenceToFlowDataSet;
    assert.equal(rewrittenRef["@refObjectId"], flowId);
    assert.equal(rewrittenRef["@version"], "00.00.001");
    assert.equal(
      rewrittenRef["common:shortDescription"]["#text"],
      "Electricity, lignite, at power plant",
    );
    const rewriteTrace = readJsonLines(path.join(repoRoot, rewrite.json.rewrite_file))[0];
    assert.equal(
      rewriteTrace.canonical.short_description_source,
      "existing_reference_display_text",
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("identity decision apply closes flow identity curation and counts as full-context evidence", () => {
  const root = testTmpRoot("flow-identity-decision-proof-test");
  fs.rmSync(root, { recursive: true, force: true });
  const flowId = "aaaaaaaa-bbbb-4ccc-8ddd-000000000040";
  const rowsFile = path.join(root, "rows", "flows.jsonl");
  const flowRow = flowRowWithClassification({
    flowId,
    typeOfDataSet: "Product flow",
    classification: {
      "common:classification": {
        "common:class": [
          { "@level": "0", "@classId": "C", "#text": "Manufacturing" },
          {
            "@level": "1",
            "@classId": "20",
            "#text": "Manufacture of chemicals and chemical products",
          },
        ],
      },
    },
  });
  writeJsonLines(rowsFile, [flowRow]);

  try {
    const context = writeContextPackFiles(root);
    const schemaReport = path.join(root, "schema", "validation-report.json");
    writeJson(schemaReport, {
      input_path: rel(rowsFile),
      status: "completed",
      rows: [
        {
          index: 0,
          id: flowId,
          version: "00.00.001",
          type: "flow",
          status: "valid",
          issues: [],
        },
      ],
    });
    const qaReport = path.join(root, "qa", "flow_qa_report.json");
    writeJson(qaReport, {
      rows_file: rel(rowsFile),
      status: "completed_local_flow_qa",
      blockers: [],
      findings: [],
    });
    const identityIndex = writeCompletedIdentityPreflightIndex(root, [
      {
        datasetType: "flow",
        id: flowId,
        target: flowRow,
        name: "Natural gas",
        decision: "manual_review",
        status: "needs_review",
        fields: { type_of_dataset: "Product flow" },
        candidates: [],
      },
    ]);

    const firstGate = runFoundry([
      "dataset-curation-gate",
      "--type",
      "flow",
      "--profile",
      "bafu",
      "--rows-file",
      rel(rowsFile),
      "--schema-report",
      rel(schemaReport),
      "--qa-report",
      rel(qaReport),
      "--schema-file",
      rel(context.schemaFile),
      "--yaml-file",
      rel(context.yamlFile),
      "--ruleset-file",
      rel(context.rulesetFile),
      "--identity-preflight-index",
      rel(identityIndex),
      "--out-dir",
      rel(path.join(root, "curation-before-identity-decision")),
    ]);
    assert.equal(firstGate.code, 1);
    assert.equal(firstGate.json.counts.identity_action_items, 1);
    const packageRef = firstGate.json.entities[0].authoring_package;
    const packageSha = firstGate.json.entities[0].authoring_package_sha256;
    const identityTask = runFoundry([
      "dataset-identity-decision-task-build",
      "--curation-gate-report",
      firstGate.json.files.report,
      "--rows-file",
      rel(rowsFile),
      "--out-dir",
      rel(path.join(root, "identity-decision-task")),
    ]);
    assert.equal(identityTask.code, 0);
    assert.equal(identityTask.json.status, "ready_for_ai_identity_decisions");
    assert.equal(identityTask.json.counts.identity_action_items, 1);
    assert.equal(identityTask.json.counts.template_decisions, 1);
    const snapshotPackageRef = identityTask.json.identity_action_items[0].authoring_package;
    assert.notEqual(snapshotPackageRef, packageRef);
    assert.match(snapshotPackageRef, /authoring-package-snapshots/u);
    assert.equal(identityTask.json.identity_action_items[0].authoring_package_sha256, packageSha);
    assert.equal(
      sha256Text(fs.readFileSync(path.join(repoRoot, snapshotPackageRef), "utf8")),
      packageSha,
    );
    assert.ok(identityTask.json.files.shared_context_bundle);
    assert.equal(
      identityTask.json.shared_context_bundle.path,
      identityTask.json.files.shared_context_bundle,
    );
    const identityBundle = readJson(
      path.join(repoRoot, identityTask.json.files.shared_context_bundle),
    );
    assert.equal(identityBundle.sha256, identityTask.json.shared_context_bundle.sha256);
    assert.match(
      identityBundle.files.find((file) => file.kind === "schema").text,
      /process schema/u,
    );
    const identityTemplate = readJsonLines(path.join(repoRoot, identityTask.json.files.template));
    assert.equal(identityTemplate.length, 1);
    assert.equal(identityTemplate[0].dataset_id, flowId);
    assert.equal(identityTemplate[0].authoring_package_sha256, packageSha);
    assert.equal(
      identityTemplate[0].authoring_context.context_bundle_sha256,
      identityTask.json.context_bundle.sha256,
    );
    assert.deepEqual(identityTemplate[0].closes_action_items, ["identity_preflight_manual_review"]);

    const decisionsFile = path.join(root, "identity-decisions.jsonl");
    writeJsonLines(decisionsFile, [
      {
        dataset_type: "flow",
        dataset_id: flowId,
        dataset_version: "00.00.001",
        decision_status: "completed",
        identity_decision: "create_new",
        authoring_package: identityTemplate[0].authoring_package,
        authoring_package_sha256: identityTemplate[0].authoring_package_sha256,
        basis:
          "The full authoring package and identity-preflight candidates show no existing TianGong flow is identity-equivalent, so this product flow remains a write candidate.",
        evidence: {
          used_context_kinds: fullContextKinds,
          remote_search: {
            endpoint: "flow_hybrid_search",
            candidate_count: 0,
          },
        },
        used_context_kinds: fullContextKinds,
        closes_action_items: ["identity_preflight_manual_review"],
      },
    ]);
    const identityApply = runFoundry([
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
    assert.equal(identityApply.code, 0);
    assert.equal(identityApply.json.status, "completed");
    assert.equal(identityApply.json.counts.output_rows, 1);

    const appliedSchemaReport = path.join(
      root,
      "schema-after-identity-decision",
      "validation-report.json",
    );
    writeJson(appliedSchemaReport, {
      input_path: identityApply.json.files.output_rows,
      status: "completed",
      rows: [
        {
          index: 0,
          id: flowId,
          version: "00.00.001",
          type: "flow",
          status: "valid",
          issues: [],
        },
      ],
    });
    const appliedQaReport = path.join(root, "qa-after-identity-decision", "flow_qa_report.json");
    writeJson(appliedQaReport, {
      rows_file: identityApply.json.files.output_rows,
      status: "completed_local_flow_qa",
      blockers: [],
      findings: [],
    });

    const secondGate = runFoundry([
      "dataset-curation-gate",
      "--type",
      "flow",
      "--profile",
      "bafu",
      "--rows-file",
      identityApply.json.files.output_rows,
      "--schema-report",
      rel(appliedSchemaReport),
      "--qa-report",
      rel(appliedQaReport),
      "--schema-file",
      rel(context.schemaFile),
      "--yaml-file",
      rel(context.yamlFile),
      "--ruleset-file",
      rel(context.rulesetFile),
      "--identity-preflight-index",
      rel(identityIndex),
      "--identity-decision-apply-report",
      identityApply.json.files.report,
      "--out-dir",
      rel(path.join(root, "curation-after-identity-decision")),
    ]);
    assert.equal(secondGate.code, 0);
    assert.equal(secondGate.json.status, "ready");
    assert.equal(secondGate.json.counts.identity_action_items, 0);
    assert.equal(secondGate.json.counts.identity_decisions, 1);

    const successList = path.join(root, "dry-run", "success-list.jsonl");
    const remoteFailed = path.join(root, "dry-run", "remote-failed.jsonl");
    writeJsonLines(successList, [{ id: flowId, version: "00.00.001", operation: "would_insert" }]);
    writeJsonLines(remoteFailed, []);
    const dryRunReport = path.join(root, "dry-run", "summary.json");
    writeJson(dryRunReport, {
      status: "completed",
      mode: "dry-run",
      commit: false,
      input_path: identityApply.json.files.output_rows,
      files: {
        success_list: rel(successList),
        remote_failed: rel(remoteFailed),
      },
    });
    const cleanupReport = path.join(root, "cleanup", "dataset-curation-cleanup-report.json");
    writeJson(cleanupReport, {
      schema_version: 2,
      status: "completed",
      dataset_type: "flow",
      rows_file: identityApply.json.files.output_rows,
      cleaned_rows_file: identityApply.json.files.output_rows,
      files: {
        cleaned_rows: identityApply.json.files.output_rows,
      },
    });

    const manifest = runFoundry([
      "dataset-mutation-manifest",
      "--type",
      "flow",
      "--profile",
      "bafu",
      "--rows-file",
      identityApply.json.files.output_rows,
      "--schema-report",
      rel(appliedSchemaReport),
      "--curation-gate-report",
      secondGate.json.files.report,
      "--cleanup-report",
      rel(cleanupReport),
      "--identity-decision-apply-report",
      identityApply.json.files.report,
      "--dry-run-report",
      rel(dryRunReport),
      "--target-user-id",
      targetUserId,
      "--out-dir",
      rel(path.join(root, "mutation-manifest")),
    ]);
    assert.equal(manifest.code, 0);
    assert.equal(manifest.json.status, "ready_for_remote_write");
    assert.equal(manifest.json.counts.ai_identity_decision_entries, 1);
    assert.equal(manifest.json.evidence.identity_decision_apply_status, "completed");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("identity decision task template uses canonical process table name", () => {
  const root = testTmpRoot("process-identity-decision-template-test");
  fs.rmSync(root, { recursive: true, force: true });
  const processId = "aaaaaaaa-bbbb-4ccc-8ddd-000000000041";
  const authoringPackage = path.join(root, "authoring-package.json");
  writeJson(authoringPackage, {
    schema_version: 2,
    profile: "bafu",
    dataset_type: "process",
    entity_id: processId,
    version: "00.00.001",
    contract_context_files: fullContextKinds.map((kind) => ({
      kind,
      path: `${kind}.fixture`,
      text: `${kind} context`,
    })),
    missing_context_files: [],
    full_context_ai_completion: {
      required_context_kinds: fullContextKinds,
    },
    action_items: [
      {
        code: "identity_preflight_manual_review",
        dataset_type: "process",
        dataset_id: processId,
        dataset_version: "00.00.001",
        evidence: {
          remote_search: {
            endpoint: "process_hybrid_search",
            query: "process name: Fixture process",
            candidate_count: 0,
          },
        },
      },
    ],
  });
  const authoringPackageSha256 = sha256Text(fs.readFileSync(authoringPackage, "utf8"));
  const curationGateReport = path.join(root, "dataset-curation-gate-report.json");
  writeJson(curationGateReport, {
    schema_version: 1,
    status: "blocked",
    entities: [
      {
        dataset_type: "process",
        entity_id: processId,
        version: "00.00.001",
        authoring_package: rel(authoringPackage),
        authoring_package_sha256: authoringPackageSha256,
      },
    ],
  });

  try {
    const identityTask = runFoundry([
      "dataset-identity-decision-task-build",
      "--curation-gate-report",
      rel(curationGateReport),
      "--out-dir",
      rel(path.join(root, "identity-decision-task")),
    ]);
    assert.equal(identityTask.code, 0);
    assert.equal(identityTask.json.status, "ready_for_ai_identity_decisions");
    const templateRows = readJsonLines(path.join(repoRoot, identityTask.json.files.template));
    assert.equal(templateRows.length, 1);
    assert.equal(templateRows[0].dataset_type, "process");
    assert.equal(templateRows[0].canonical.table, "processes");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

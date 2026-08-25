import test from "node:test";
import {
  elementaryFlowManifestFixtureRoot,
  flowClassificationFixtureRoot,
} from "../fixtures/fixture-roots.ts";
import {
  assert,
  blockerCodes,
  fs,
  fullContextKinds,
  itemBlockerCodes,
  path,
  readJson,
  readJsonLines,
  rel,
  repoRoot,
  runFoundry,
  targetUserId,
  writeJson,
  writeJsonLines,
} from "../fixtures/foundry-core.ts";
import { writeContextPackFiles } from "../fixtures/full-context-fixtures.ts";
import { writeCompletedIdentityPreflightIndex } from "../fixtures/identity-fixtures.ts";
import { flowRowWithClassification } from "../fixtures/row-builders.ts";

test("flow curation gate distinguishes elementary and product category schemas", () => {
  fs.rmSync(flowClassificationFixtureRoot, {
    recursive: true,
    force: true,
  });
  const elementaryId = "11111111-2222-4333-8444-555555555555";
  const productId = "22222222-3333-4444-8555-666666666666";
  const context = writeContextPackFiles(flowClassificationFixtureRoot);

  try {
    const elementaryRowsFile = path.join(
      flowClassificationFixtureRoot,
      "rows",
      "elementary-flows.jsonl",
    );
    writeJsonLines(elementaryRowsFile, [
      flowRowWithClassification({
        flowId: elementaryId,
        typeOfDataSet: "Elementary flow",
        classification: {
          "common:elementaryFlowCategorization": {
            "common:category": [
              { "@level": "0", "@catId": "1", "#text": "Emissions" },
              {
                "@level": "1",
                "@catId": "1.3",
                "#text": "Emissions to air",
              },
              {
                "@level": "2",
                "@catId": "1.3.4",
                "#text": "Emissions to air, unspecified",
              },
            ],
          },
        },
      }),
    ]);
    const elementarySchemaReport = path.join(
      flowClassificationFixtureRoot,
      "schema",
      "elementary-validation-report.json",
    );
    writeJson(elementarySchemaReport, {
      input_path: rel(elementaryRowsFile),
      status: "completed",
      rows: [
        {
          index: 0,
          id: elementaryId,
          version: "00.00.001",
          type: "flow",
          status: "valid",
          issues: [],
        },
      ],
    });
    const qaReport = path.join(flowClassificationFixtureRoot, "qa", "flow-qa-report.json");
    writeJson(qaReport, {
      rows_file: rel(elementaryRowsFile),
      status: "completed",
      blockers: [],
      findings: [],
    });
    const elementaryGate = runFoundry([
      "dataset-curation-gate",
      "--type",
      "flow",
      "--profile",
      "bafu",
      "--rows-file",
      rel(elementaryRowsFile),
      "--schema-report",
      rel(elementarySchemaReport),
      "--qa-report",
      rel(qaReport),
      "--schema-file",
      rel(context.schemaFile),
      "--yaml-file",
      rel(context.yamlFile),
      "--ruleset-file",
      rel(context.rulesetFile),
      "--out-dir",
      rel(path.join(flowClassificationFixtureRoot, "elementary-gate")),
    ]);
    assert.equal(elementaryGate.code, 1);
    assert.equal(elementaryGate.json.status, "blocked_needs_foundry_ai_authoring");
    assert.equal(elementaryGate.json.counts.action_items, 1);
    assert.equal(elementaryGate.json.entities[0].status, "needs_foundry_ai_authoring");
    const elementaryPackage = readJson(
      path.join(repoRoot, elementaryGate.json.entities[0].authoring_package),
    );
    assert.equal(
      elementaryPackage.action_items[0].code,
      "elementary_flow_requires_existing_database_match",
    );

    const productRowsFile = path.join(flowClassificationFixtureRoot, "rows", "product-flows.jsonl");
    writeJsonLines(productRowsFile, [
      flowRowWithClassification({
        flowId: productId,
        typeOfDataSet: "Product flow",
        classification: {
          "common:classification": {
            "common:class": [
              {
                "@level": "0",
                "@classId": "9",
                "#text": "Community, social and personal services",
              },
              {
                "@level": "1",
                "@classId": "94",
                "#text":
                  "Sewage and waste collection, treatment and disposal and other environmental protection services",
              },
              {
                "@level": "2",
                "@classId": "949",
                "#text": "Other environmental protection services n.e.c.",
              },
              {
                "@level": "3",
                "@classId": "9490",
                "#text": "Other environmental protection services n.e.c.",
              },
              {
                "@level": "4",
                "@classId": "94900",
                "#text": "Other environmental protection services n.e.c.",
              },
            ],
          },
        },
      }),
    ]);
    const productSchemaReport = path.join(
      flowClassificationFixtureRoot,
      "schema",
      "product-validation-report.json",
    );
    writeJson(productSchemaReport, {
      input_path: rel(productRowsFile),
      status: "completed",
      rows: [
        {
          index: 0,
          id: productId,
          version: "00.00.001",
          type: "flow",
          status: "valid",
          issues: [],
        },
      ],
    });
    const productGate = runFoundry([
      "dataset-curation-gate",
      "--type",
      "flow",
      "--profile",
      "bafu",
      "--rows-file",
      rel(productRowsFile),
      "--schema-report",
      rel(productSchemaReport),
      "--qa-report",
      rel(qaReport),
      "--schema-file",
      rel(context.schemaFile),
      "--yaml-file",
      rel(context.yamlFile),
      "--ruleset-file",
      rel(context.rulesetFile),
      "--out-dir",
      rel(path.join(flowClassificationFixtureRoot, "product-gate")),
    ]);
    assert.equal(productGate.code, 1);
    assert.equal(productGate.json.status, "blocked_needs_foundry_ai_authoring");
    assert.equal(productGate.json.counts.semantic_action_items, 1);
    const productPackage = readJson(
      path.join(repoRoot, productGate.json.entities[0].authoring_package),
    );
    assert.equal(productPackage.action_items[0].code, "semantic_classification_converted_default");
    assert.equal(
      productPackage.action_items[0].path,
      "flowDataSet.flowInformation.dataSetInformation.classificationInformation.common:classification",
    );

    const task = runFoundry([
      "dataset-authoring-task-build",
      "--curation-gate-report",
      productGate.json.files.report,
      "--out-dir",
      rel(path.join(flowClassificationFixtureRoot, "authoring-tasks")),
    ]);
    assert.equal(task.code, 0);
    const actionItem = task.json.tasks[0].action_items[0];
    assert.equal(
      actionItem.json_pointer,
      "/flowDataSet/flowInformation/dataSetInformation/classificationInformation/common:classification",
    );
    const outputPatchFile = path.join(repoRoot, task.json.tasks[0].files.output_patch_file);
    const authoringPackageFile = path.join(repoRoot, task.json.tasks[0].files.authoring_package);
    const patchPayload = (value) => ({
      schema_version: 1,
      kind: "tiangong_foundry_dataset_patch",
      patch_status: "completed",
      patch_sets: [
        {
          dataset_id: productId,
          version: "00.00.001",
          authoring_package: path.basename(authoringPackageFile),
          operations: [
            {
              op: "replace",
              path: actionItem.json_pointer,
              value,
              basis:
                "The product flow is natural gas and the selected path is the canonical bundled product-flow category path.",
              evidence: {
                source: "source_row.flowDataSet.flowInformation.dataSetInformation.name.baseName",
                quote_or_trace: "Natural gas",
              },
              resolution: {
                mode: "classification_decision",
                used_context_kinds: fullContextKinds,
                summary:
                  "Select product-flow category Natural gas, liquefied or in the gaseous state.",
              },
              closes_action_items: [
                {
                  code: actionItem.code,
                  path: actionItem.path,
                },
              ],
            },
          ],
        },
      ],
    });
    writeJson(
      outputPatchFile,
      patchPayload({
        "common:class": [{ "@level": "0", "@classId": "9", "#text": "Wrong root" }],
      }),
    );
    const invalidCollect = runFoundry([
      "dataset-authoring-patch-collect",
      "--task-manifest",
      task.json.files.manifest,
      "--out-dir",
      rel(path.join(flowClassificationFixtureRoot, "patches-invalid")),
    ]);
    assert.equal(invalidCollect.code, 1);
    assert.equal(invalidCollect.json.status, "blocked");
    assert.equal(
      blockerCodes(invalidCollect.json).has("patch_classification_decision_entry_invalid"),
      true,
    );

    writeJson(
      outputPatchFile,
      patchPayload({
        "common:class": [
          {
            "@level": "0",
            "@classId": "1",
            "#text": "Ores and minerals; electricity, gas and water",
          },
          {
            "@level": "1",
            "@classId": "12",
            "#text": "Crude petroleum and natural gas",
          },
          {
            "@level": "2",
            "@classId": "120",
            "#text": "Crude petroleum and natural gas",
          },
          {
            "@level": "3",
            "@classId": "1202",
            "#text": "Natural gas, liquefied or in the gaseous state",
          },
          {
            "@level": "4",
            "@classId": "12020",
            "#text": "Natural gas, liquefied or in the gaseous state",
          },
        ],
      }),
    );
    const validCollect = runFoundry([
      "dataset-authoring-patch-collect",
      "--task-manifest",
      task.json.files.manifest,
      "--out-dir",
      rel(path.join(flowClassificationFixtureRoot, "patches-valid")),
    ]);
    assert.equal(validCollect.code, 0);
    assert.equal(validCollect.json.status, "ready_for_patch_apply");

    const patchedRowsFile = path.join(
      flowClassificationFixtureRoot,
      "rows",
      "product-flows.patched.jsonl",
    );
    const apply = runFoundry([
      "dataset-patch-apply",
      "--input",
      rel(productRowsFile),
      "--patch",
      validCollect.json.files.batch_patch,
      "--out",
      rel(patchedRowsFile),
      "--out-dir",
      rel(path.join(flowClassificationFixtureRoot, "patch-apply")),
      "--authoring-package-dir",
      rel(path.dirname(authoringPackageFile)),
      "--require-authoring-package",
      "--require-action-item-closure",
    ]);
    assert.equal(apply.code, 0);
    const patchedRow = readJsonLines(patchedRowsFile)[0];
    assert.equal(
      patchedRow.flowDataSet.flowInformation.dataSetInformation.classificationInformation[
        "common:classification"
      ]["common:class"][4]["@classId"],
      "12020",
    );

    const patchedSchemaReport = path.join(
      flowClassificationFixtureRoot,
      "schema",
      "product-patched-validation-report.json",
    );
    writeJson(patchedSchemaReport, {
      input_path: rel(patchedRowsFile),
      status: "completed",
      rows: [
        {
          index: 0,
          id: productId,
          version: "00.00.001",
          type: "flow",
          status: "valid",
          issues: [],
        },
      ],
    });
    const identityPreflightIndex = writeCompletedIdentityPreflightIndex(
      flowClassificationFixtureRoot,
      [
        {
          datasetType: "flow",
          id: productId,
          target: patchedRow,
          name: "Fixture product flow",
          filter: { flowType: "Product flow" },
          query:
            "flow name: Fixture product flow\nflow type: Product flow\nreference property: Mass",
        },
      ],
    );
    const resolvedGate = runFoundry([
      "dataset-curation-gate",
      "--type",
      "flow",
      "--profile",
      "bafu",
      "--rows-file",
      rel(patchedRowsFile),
      "--schema-report",
      rel(patchedSchemaReport),
      "--qa-report",
      rel(qaReport),
      "--schema-file",
      rel(context.schemaFile),
      "--yaml-file",
      rel(context.yamlFile),
      "--ruleset-file",
      rel(context.rulesetFile),
      "--identity-preflight-index",
      rel(identityPreflightIndex),
      "--out-dir",
      rel(path.join(flowClassificationFixtureRoot, "product-gate-resolved")),
    ]);
    assert.equal(resolvedGate.code, 0);
    assert.equal(resolvedGate.json.status, "ready");
  } finally {
    fs.rmSync(flowClassificationFixtureRoot, {
      recursive: true,
      force: true,
    });
  }
});

test("mutation manifest blocks elementary flow write candidates", () => {
  fs.rmSync(elementaryFlowManifestFixtureRoot, {
    recursive: true,
    force: true,
  });
  const flowId = "33333333-4444-4555-8666-777777777777";
  const rowsFile = path.join(elementaryFlowManifestFixtureRoot, "rows", "elementary-flows.jsonl");
  writeJsonLines(rowsFile, [
    flowRowWithClassification({
      flowId,
      typeOfDataSet: "Elementary flow",
      classification: {
        "common:elementaryFlowCategorization": {
          "common:category": [
            { "@level": "0", "@catId": "1", "#text": "Emissions" },
            { "@level": "1", "@catId": "1.3", "#text": "Emissions to air" },
            {
              "@level": "2",
              "@catId": "1.3.4",
              "#text": "Emissions to air, unspecified",
            },
          ],
        },
      },
    }),
  ]);

  try {
    const schemaReport = path.join(
      elementaryFlowManifestFixtureRoot,
      "schema",
      "validation-report.json",
    );
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
    const successList = path.join(
      elementaryFlowManifestFixtureRoot,
      "dry-run",
      "success-list.jsonl",
    );
    const remoteFailed = path.join(
      elementaryFlowManifestFixtureRoot,
      "dry-run",
      "remote-failed.jsonl",
    );
    writeJsonLines(successList, [
      {
        id: flowId,
        version: "00.00.001",
        operation: "would_insert",
      },
    ]);
    writeJsonLines(remoteFailed, []);
    const dryRunReport = path.join(elementaryFlowManifestFixtureRoot, "dry-run", "summary.json");
    writeJson(dryRunReport, {
      status: "completed",
      mode: "dry-run",
      commit: false,
      input_path: rel(rowsFile),
      files: {
        success_list: rel(successList),
        remote_failed: rel(remoteFailed),
      },
    });
    const cleanupReport = path.join(
      elementaryFlowManifestFixtureRoot,
      "cleanup",
      "dataset-curation-cleanup-report.json",
    );
    writeJson(cleanupReport, {
      schema_version: 2,
      status: "completed",
      dataset_type: "flow",
      rows_file: rel(rowsFile),
      cleaned_rows_file: rel(rowsFile),
      files: {
        cleaned_rows: rel(rowsFile),
      },
    });

    const manifest = runFoundry([
      "dataset-mutation-manifest",
      "--type",
      "flow",
      "--profile",
      "generic",
      "--rows-file",
      rel(rowsFile),
      "--schema-report",
      rel(schemaReport),
      "--cleanup-report",
      rel(cleanupReport),
      "--dry-run-report",
      rel(dryRunReport),
      "--require-curation-gate",
      "false",
      "--target-user-id",
      targetUserId,
      "--out-dir",
      rel(path.join(elementaryFlowManifestFixtureRoot, "mutation-manifest")),
    ]);
    assert.equal(manifest.code, 1);
    assert.equal(manifest.json.status, "blocked");
    assert.equal(itemBlockerCodes(manifest.json).has("elementary_flow_write_blocked"), true);
    assert.equal(manifest.json.items[0].decision, "blocked");
    assert.equal(manifest.json.counts.write_candidates, 0);
    assert.equal(manifest.json.counts.planned_write_candidates, 1);
    assert.equal(manifest.json.counts.blocked_write_candidates, 1);
    assert.deepEqual(readJsonLines(path.join(repoRoot, manifest.json.files.write_candidates)), []);
    assert.equal(
      readJsonLines(path.join(repoRoot, manifest.json.files.blocked_write_candidates))[0]
        .flowDataSet.flowInformation.dataSetInformation["common:UUID"],
      flowId,
    );
  } finally {
    fs.rmSync(elementaryFlowManifestFixtureRoot, {
      recursive: true,
      force: true,
    });
  }
});

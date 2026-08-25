import test from "node:test";
import {
  finalizeAutoQueueFixtureRoot,
  finalizeCurationGateFixtureRoot,
  fixtureRoot,
} from "../fixtures/fixture-roots.ts";
import {
  assert,
  fs,
  path,
  readJson,
  readJsonLines,
  rel,
  repoRoot,
  runFoundry,
  scopeBlockerCodes,
  targetUserId,
  writeJson,
  writeJsonLines,
  writeText,
} from "../fixtures/foundry-core.ts";
import { writeContextPackFiles } from "../fixtures/full-context-fixtures.mjs";
import {
  testAuthIdentityReceipt,
  writeCompletedIdentityPreflightIndex,
} from "../fixtures/identity-fixtures.mjs";
import {
  flowRow,
  flowRowWithClassification,
  processRowWithDefaultClassification,
  processRowWithFlowRef,
  processRowWithInvalidLocation,
  sourceRow,
} from "../fixtures/row-builders.mjs";

test("flow post-authoring finalize dry-run omits unsupported state-code flag", () => {
  const root = path.join(fixtureRoot, "flow-finalize-dry-run-state-code");
  fs.rmSync(root, { recursive: true, force: true });
  const flowId = "12345678-9999-4aaa-8bbb-cccccccccccc";
  const rowsFile = path.join(root, "rows", "flows.jsonl");
  writeJsonLines(rowsFile, [
    flowRowWithClassification({
      flowId,
      typeOfDataSet: "Product flow",
      classification: {
        "common:classification": {
          "common:class": [
            {
              "@level": "0",
              "@classId": "9",
              "#text": "Community, social and personal services",
            },
          ],
        },
      },
    }),
  ]);
  const fakeCli = path.join(root, "bin", "fake-cli.cjs");
  const callsFile = path.join(root, "fake-cli-calls.jsonl");
  writeText(
    fakeCli,
    String.raw`#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const args = process.argv.slice(2);
const callsFile = process.env.FOUNDRY_FAKE_CLI_CALLS;
if (callsFile) {
  fs.mkdirSync(path.dirname(callsFile), { recursive: true });
  fs.appendFileSync(callsFile, JSON.stringify({ args }) + "\n");
}
function opt(name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : null;
}
function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + "\n");
}
function readRows(filePath) {
  return fs.readFileSync(filePath, "utf8").trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
}
function identity(row) {
  const info = row.flowDataSet.flowInformation.dataSetInformation;
  return {
    id: info["common:UUID"],
    version:
      row.flowDataSet.administrativeInformation?.publicationAndOwnership?.["common:dataSetVersion"] ||
      "00.00.001",
  };
}
if (args[0] === "dataset" && args[1] === "validate") {
  const input = opt("--input");
  const outDir = opt("--out-dir");
  const rows = readRows(input).map(identity);
  const reportFile = path.join(outDir, "outputs", "validation-report.json");
  const report = {
    status: "completed",
    input_path: input,
    rows: rows.map((row, index) => ({
      index,
      id: row.id,
      version: row.version,
      type: "flow",
      status: "valid",
      issues: [],
    })),
    files: { report: reportFile },
  };
  writeJson(reportFile, report);
  process.stdout.write(JSON.stringify(report));
  process.exit(0);
}
if (args[0] === "qa" && args[1] === "flow") {
  const rowsFile = opt("--rows-file");
  const outDir = opt("--out-dir");
  const reportFile = path.join(outDir, "flow_qa_report.json");
  const report = {
    status: "completed_local_flow_qa",
    rows_file: rowsFile,
    blockers: [],
    findings: [],
    counts: { blockers: 0 },
    files: { report: reportFile },
  };
  writeJson(reportFile, report);
  process.stdout.write(JSON.stringify(report));
  process.exit(0);
}
if (args[0] === "dataset" && args[1] === "classification" && args[2] === "audit") {
  const input = opt("--input");
  const outDir = opt("--out-dir");
  const reportFile = path.join(outDir, "outputs", "location-audit-report.json");
  const report = {
    status: "completed",
    input_path: input,
    blockers: [],
    findings: [],
    counts: { invalid: 0, blockers: 0 },
    files: { report: reportFile },
  };
  writeJson(reportFile, report);
  process.stdout.write(JSON.stringify(report));
  process.exit(0);
}
if (args[0] === "flow" && args[1] === "publish-version") {
  if (args.includes("--state-code")) {
    process.stderr.write("unexpected --state-code for flow publish-version\n");
    process.exit(2);
  }
  const input = opt("--input-file");
  const outDir = opt("--out-dir");
  const rows = readRows(input).map(identity);
  const successFile = path.join(outDir, "flows_tidas_sdk_plus_classification_mcp_success_list.json");
  const failedFile = path.join(outDir, "flows_tidas_sdk_plus_classification_remote_validation_failed.jsonl");
  const reportFile = path.join(outDir, "flows_tidas_sdk_plus_classification_mcp_sync_report.json");
  writeJson(successFile, rows.map((row) => ({ ...row, operation: "would_insert" })));
  fs.mkdirSync(path.dirname(failedFile), { recursive: true });
  fs.writeFileSync(failedFile, "");
  const report = {
    status: "completed_flow_publish_version",
    mode: "dry_run",
    dry_run: true,
    commit: false,
    input_path: input,
    target_user_id_override: opt("--target-user-id"),
    files: {
      report: reportFile,
      success_list: successFile,
      remote_failed: failedFile,
    },
  };
  writeJson(reportFile, report);
  process.stdout.write(JSON.stringify(report));
  process.exit(0);
}
process.stderr.write("unexpected fake CLI args: " + args.join(" ") + "\n");
process.exit(2);
`,
  );
  fs.chmodSync(fakeCli, 0o755);
  const authReceiptFile = path.join(root, "auth-identity-receipt.json");
  writeJson(authReceiptFile, testAuthIdentityReceipt());

  try {
    const finalize = runFoundry(
      [
        "dataset-post-authoring-finalize",
        "--type",
        "flow",
        "--profile",
        "generic",
        "--rows-file",
        rel(rowsFile),
        "--target-user-id",
        targetUserId,
        "--auth-receipt",
        rel(authReceiptFile),
        "--expected-project-ref",
        "qgzvkongdjqiiamzbbts",
        "--expected-user-id",
        "c536ee37-64ab-427b-b7e3-4e2bb4fdffb7",
        "--state-code",
        "0",
        "--out-dir",
        rel(path.join(root, "finalize")),
      ],
      {
        env: {
          TIANGONG_LCA_CLI_BIN: fakeCli,
          FOUNDRY_VERIFIED_PROJECT_REF: "qgzvkongdjqiiamzbbts",
          FOUNDRY_VERIFIED_USER_ID: "c536ee37-64ab-427b-b7e3-4e2bb4fdffb7",
          FOUNDRY_FAKE_CLI_CALLS: callsFile,
        },
      },
    );
    assert.equal(finalize.code, 0, JSON.stringify(finalize.json, null, 2));
    assert.equal(finalize.json.status, "ready_for_remote_write");
    assert.ok(finalize.json.files.dry_run_report);
    const dryRunStage = finalize.json.stages.find(
      (stage) => stage.stage === "flow_publish_version_dry_run",
    );
    assert.equal(dryRunStage.exit_code, 0);
    assert.equal(dryRunStage.args.includes("--target-user-id"), true);
    assert.equal(dryRunStage.args.includes("--state-code"), false);
    const calls = readJsonLines(callsFile);
    const publishCall = calls.find(
      (call) => call.args[0] === "flow" && call.args[1] === "publish-version",
    );
    assert.ok(publishCall);
    assert.equal(publishCall.args.includes("--target-user-id"), true);
    assert.equal(publishCall.args.includes("--state-code"), false);
    const mutationManifest = readJson(path.join(repoRoot, finalize.json.files.mutation_manifest));
    assert.equal(mutationManifest.status, "ready_for_remote_write");
    assert.equal(mutationManifest.counts.blockers, 0);
    const mutationItems = readJsonLines(path.join(repoRoot, mutationManifest.files.items));
    assert.equal(mutationItems[0].dry_run_status, "success");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("post-authoring finalize auto-builds curation queue context from sibling process bundle rows", () => {
  const root = path.join(finalizeAutoQueueFixtureRoot, "with-local-flow");
  fs.rmSync(root, { recursive: true, force: true });
  const processId = "b0b0b0b0-1111-4222-8333-444444444444";
  const flowId = "c0c0c0c0-2222-4333-8444-555555555555";
  const sourceId = "d0d0d0d0-3333-4444-8555-666666666666";
  const rowsDir = path.join(root, "rows");
  const rowsFile = path.join(rowsDir, "processes.jsonl");
  const flowsFile = path.join(rowsDir, "flows.jsonl");
  const supportFile = path.join(rowsDir, "support.jsonl");
  writeJsonLines(rowsFile, [processRowWithFlowRef(processId, flowId)]);
  writeJsonLines(flowsFile, [flowRow(flowId)]);
  writeJsonLines(supportFile, [sourceRow(sourceId)]);
  const context = writeContextPackFiles(root);
  const staleProcessTarget = processRowWithFlowRef(processId, flowId);
  staleProcessTarget.processDataSet.processInformation.dataSetInformation.name.baseName["#text"] =
    "Stale heat production";
  const identityPreflightIndex = writeCompletedIdentityPreflightIndex(root, [
    {
      datasetType: "process",
      id: processId,
      target: staleProcessTarget,
      name: "Heat production",
    },
    {
      datasetType: "flow",
      id: flowId,
      target: flowRow(flowId),
      name: "Natural gas",
    },
  ]);
  const authReceiptFile = path.join(root, "auth-identity-receipt.json");
  writeJson(authReceiptFile, testAuthIdentityReceipt());
  const fakeCli = path.join(root, "bin", "fake-identity-preflight.cjs");
  writeText(
    fakeCli,
    String.raw`#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const args = process.argv.slice(2);
function opt(name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : null;
}
function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + "\n");
}
function readRows(filePath) {
  return fs.readFileSync(filePath, "utf8").trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
}
if (args[0] === "dataset" && args[1] === "curation-queue" && args[2] === "build") {
  const outDir = opt("--out-dir");
  const processRows = readRows(opt("--processes"));
  const flowRows = readRows(opt("--flows"));
  function identity(row, kind) {
    const root = row[kind + "DataSet"];
    const info = root[kind + "Information"].dataSetInformation;
    return {
      id: info["common:UUID"],
      version: root.administrativeInformation?.publicationAndOwnership?.["common:dataSetVersion"] || "00.00.001",
    };
  }
  const processIdentity = identity(processRows[0], "process");
  const flow = identity(flowRows[0], "flow");
  const processInput = path.join(outDir, "inputs", "process.jsonl");
  const flowInput = path.join(outDir, "inputs", "flow.jsonl");
  fs.mkdirSync(path.dirname(processInput), { recursive: true });
  fs.writeFileSync(processInput, processRows.map(JSON.stringify).join("\n") + "\n");
  fs.writeFileSync(flowInput, flowRows.map(JSON.stringify).join("\n") + "\n");
  const processClosure = path.join(outDir, "closures", "process.json");
  const flowClosure = path.join(outDir, "closures", "flow.json");
  writeJson(processClosure, {
    dependencies: {
      local_tasks: [{ task_id: "flow-task", ref: flow.id, ref_path: "processDataSet.exchanges" }],
    },
  });
  writeJson(flowClosure, { dependencies: { local_tasks: [] } });
  const manifestFile = path.join(outDir, "outputs", "curation-queue-manifest.json");
  const report = {
    status: "ready",
    counts: { process_rows: processRows.length, flow_rows: flowRows.length },
    blockers: [],
    tasks: [
      {
        schema_version: 1,
        entity_type: "process",
        task_id: "process-task",
        entity_id: processIdentity.id,
        version: processIdentity.version,
        lock_key: "process:" + processIdentity.id,
        depends_on: ["flow-task"],
        input_rows_file: "inputs/process.jsonl",
        closure_file: "closures/process.json",
        run_plan_file: null,
      },
      {
        schema_version: 1,
        entity_type: "flow",
        task_id: "flow-task",
        entity_id: flow.id,
        version: flow.version,
        lock_key: "flow:" + flow.id,
        depends_on: [],
        input_rows_file: "inputs/flow.jsonl",
        closure_file: "closures/flow.json",
        run_plan_file: null,
      },
    ],
    files: { manifest: manifestFile },
  };
  writeJson(manifestFile, report);
  process.stdout.write(JSON.stringify(report));
  process.exit(0);
}
if (args[0] === "dataset" && args[1] === "validate") {
  const input = opt("--input");
  const outDir = opt("--out-dir");
  const reportFile = path.join(outDir, "outputs", "validation-report.json");
  const rows = readRows(input).map((row, index) => ({
    index,
    id: row.processDataSet.processInformation.dataSetInformation["common:UUID"],
    version: row.processDataSet.administrativeInformation?.publicationAndOwnership?.["common:dataSetVersion"] || "00.00.001",
    type: "process",
    status: "valid",
    issues: [],
  }));
  const report = { status: "completed", input_path: input, rows, files: { report: reportFile } };
  writeJson(reportFile, report);
  process.stdout.write(JSON.stringify(report));
  process.exit(0);
}
if (args[0] === "qa" && args[1] === "process") {
  const rowsFile = opt("--rows-file");
  const reportFile = path.join(opt("--out-dir"), "process-qa-report.json");
  const report = {
    status: "completed_local_process_qa",
    rows_file: rowsFile,
    blockers: [],
    findings: [],
    counts: { blockers: 0 },
    files: { report: reportFile },
  };
  writeJson(reportFile, report);
  process.stdout.write(JSON.stringify(report));
  process.exit(0);
}
if (args[0] === "dataset" && args[1] === "classification" && args[2] === "audit") {
  const input = opt("--input");
  const reportFile = path.join(opt("--out-dir"), "outputs", "location-audit-report.json");
  const report = {
    status: "completed",
    input_path: input,
    blockers: [],
    findings: [],
    counts: { invalid: 0, blockers: 0 },
    files: { report: reportFile },
  };
  writeJson(reportFile, report);
  process.stdout.write(JSON.stringify(report));
  process.exit(0);
}
const kind = args[0];
if (!(["flow", "process"].includes(kind)) || args[1] !== "identity-preflight") {
  process.stderr.write("unexpected fake identity-preflight args\n");
  process.exit(2);
}
const request = JSON.parse(fs.readFileSync(opt("--input"), "utf8"));
const target = request.target;
const rootKey = kind + "DataSet";
const informationKey = kind + "Information";
const root = target[rootKey];
const information = root[informationKey].dataSetInformation;
const id = information["common:UUID"];
const version = root.administrativeInformation?.publicationAndOwnership?.["common:dataSetVersion"] || "00.00.001";
const report = {
  schema_version: 1,
  kind,
  status: "passed",
  decision: "create_new",
  confidence: "medium",
  target: {
    id,
    version,
    names: [id],
    fields: {},
    exchange_signature: [],
    schema_validation: { status: "passed", issue_count: 0, issues: [] },
  },
  candidates: [],
  candidate_sources: [],
  findings: [],
  blockers: [],
  next_action: "materialize_new_payload",
  files: {},
};
const reportFile = path.join(opt("--out-dir"), "outputs", "identity-decision.json");
fs.mkdirSync(path.dirname(reportFile), { recursive: true });
fs.writeFileSync(reportFile, JSON.stringify(report, null, 2) + "\n");
process.stdout.write(JSON.stringify(report));
`,
  );
  fs.chmodSync(fakeCli, 0o755);

  try {
    const finalize = runFoundry(
      [
        "dataset-post-authoring-finalize",
        "--type",
        "process",
        "--profile",
        "bafu",
        "--rows-file",
        rel(rowsFile),
        "--identity-preflight-index",
        rel(identityPreflightIndex),
        "--run-identity-preflight",
        "--refresh-identity-preflight",
        "false",
        "--schema-file",
        rel(context.schemaFile),
        "--yaml-file",
        rel(context.yamlFile),
        "--ruleset-file",
        rel(context.rulesetFile),
        "--target-user-id",
        targetUserId,
        "--auth-receipt",
        rel(authReceiptFile),
        "--expected-project-ref",
        "qgzvkongdjqiiamzbbts",
        "--expected-user-id",
        "c536ee37-64ab-427b-b7e3-4e2bb4fdffb7",
        "--out-dir",
        rel(path.join(root, "finalize")),
      ],
      {
        env: {
          TIANGONG_LCA_CLI_BIN: fakeCli,
          FOUNDRY_VERIFIED_PROJECT_REF: "qgzvkongdjqiiamzbbts",
          FOUNDRY_VERIFIED_USER_ID: "c536ee37-64ab-427b-b7e3-4e2bb4fdffb7",
        },
      },
    );

    assert.equal(finalize.code, 1);
    assert.equal(finalize.json.status, "blocked");
    assert.equal(finalize.json.counts.identity_preflight_run_selected, 2);
    assert.equal(finalize.json.counts.identity_preflight_run_completed, 2);
    assert.equal(finalize.json.counts.identity_preflight_run_skipped_existing, 0);
    assert.equal(finalize.json.counts.identity_preflight_refresh_required, true);
    assert.equal(
      finalize.json.counts.identity_preflight_refresh_reason,
      "current_scope_index_not_exact",
    );
    assert.equal(finalize.json.counts.identity_preflight_refreshed_current_rows, 1);
    assert.equal(finalize.json.counts.identity_preflight_merge_replaced_rows, 1);
    assert.ok(finalize.json.files.identity_preflight_refresh_report);
    assert.ok(finalize.json.files.identity_preflight_merge_report);
    assert.ok(
      finalize.json.timings.some(
        (timing) => timing.stage === "identity_preflight_run" && timing.duration_ms >= 0,
      ),
    );
    assert.ok(
      finalize.json.stages.some(
        (stage) => stage.stage === "identity_preflight_run" && stage.duration_ms >= 0,
      ),
    );
    assert.equal(
      finalize.json.counts.curation_queue_status,
      "ready",
      JSON.stringify(finalize.json, null, 2),
    );
    assert.equal(finalize.json.counts.curation_queue_process_rows, 1);
    assert.equal(finalize.json.counts.curation_queue_flow_rows, 1);
    assert.ok(finalize.json.files.curation_queue_report);
    assert.ok(
      finalize.json.stages.some(
        (stage) =>
          stage.stage === "identity_preflight_run" &&
          ["completed", "completed_with_identity_findings"].includes(stage.status) &&
          stage.exit_code === 0,
      ),
    );
    assert.ok(
      finalize.json.stages.some(
        (stage) =>
          stage.stage === "curation_queue" && stage.status === "ready" && stage.exit_code === 0,
      ),
    );

    const gateReport = readJson(path.join(repoRoot, finalize.json.files.curation_gate_report));
    assert.equal(gateReport.context.require_queue_context, true);
    assert.equal(gateReport.context.curation_queue.status, "ready");
    const authoringPackage = readJson(
      path.join(repoRoot, gateReport.entities[0].authoring_package),
    );
    const deterministicCodes = new Set(
      authoringPackage.deterministic_cleanup_items.map((item) => item.code),
    );
    assert.equal(deterministicCodes.has("curation_queue_context_required"), false);
    assert.equal(authoringPackage.curation_queue_context.status, "attached");
    assert.equal(authoringPackage.curation_queue_context.dependency_rows.length, 1);
    assert.match(
      JSON.stringify(authoringPackage.curation_queue_context.dependency_rows[0].input_rows),
      new RegExp(flowId, "u"),
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("post-authoring finalize skips forced identity preflight refresh when current scope index is exact", () => {
  const root = path.join(finalizeAutoQueueFixtureRoot, "identity-refresh-exact-cache");
  fs.rmSync(root, { recursive: true, force: true });
  const processId = "d3333333-2222-4333-8444-555555555555";
  const flowId = "f3333333-2222-4333-8444-555555555555";
  const rowsFile = path.join(root, "rows", "processes.jsonl");
  const processRow = processRowWithFlowRef(processId, flowId);
  writeJsonLines(rowsFile, [processRow]);
  const context = writeContextPackFiles(root);
  const identityPreflightIndex = writeCompletedIdentityPreflightIndex(root, [
    {
      datasetType: "process",
      id: processId,
      target: processRow,
      name: "Heat production",
    },
    {
      datasetType: "flow",
      id: flowId,
      target: flowRow(flowId),
      name: "Natural gas",
    },
  ]);
  const authReceiptFile = path.join(root, "auth-identity-receipt.json");
  writeJson(authReceiptFile, testAuthIdentityReceipt());

  try {
    const finalize = runFoundry(
      [
        "dataset-post-authoring-finalize",
        "--type",
        "process",
        "--profile",
        "bafu",
        "--rows-file",
        rel(rowsFile),
        "--identity-preflight-index",
        rel(identityPreflightIndex),
        "--run-identity-preflight",
        "--refresh-identity-preflight",
        "--schema-file",
        rel(context.schemaFile),
        "--yaml-file",
        rel(context.yamlFile),
        "--ruleset-file",
        rel(context.rulesetFile),
        "--target-user-id",
        targetUserId,
        "--auth-receipt",
        rel(authReceiptFile),
        "--expected-project-ref",
        "qgzvkongdjqiiamzbbts",
        "--expected-user-id",
        "c536ee37-64ab-427b-b7e3-4e2bb4fdffb7",
        "--out-dir",
        rel(path.join(root, "finalize")),
      ],
      {
        env: {
          FOUNDRY_VERIFIED_PROJECT_REF: "qgzvkongdjqiiamzbbts",
          FOUNDRY_VERIFIED_USER_ID: "c536ee37-64ab-427b-b7e3-4e2bb4fdffb7",
        },
      },
    );

    assert.equal(finalize.json.counts.identity_preflight_refresh_required, false);
    assert.equal(finalize.json.counts.identity_preflight_refresh_forced, false);
    assert.equal(finalize.json.counts.identity_preflight_refresh_force_skipped_exact, true);
    assert.equal(finalize.json.counts.identity_preflight_refreshed_current_rows, 0);
    assert.equal(finalize.json.files.identity_preflight_refresh_report, null);
    assert.equal(finalize.json.files.identity_preflight_merge_report, null);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("post-authoring finalize includes referenced true sources in source/contact support rows", () => {
  const root = path.join(finalizeAutoQueueFixtureRoot, "source-contact-support-true-source");
  fs.rmSync(root, { recursive: true, force: true });
  const processId = "a1111111-2222-4333-8444-555555555555";
  const sourceId = "b1111111-2222-4333-8444-555555555555";
  const rowsFile = path.join(root, "rows", "processes.jsonl");
  const sourceSupportRowsFile = path.join(root, "rows", "sources.jsonl");
  const processRow = processRowWithDefaultClassification(processId);
  processRow.processDataSet.modellingAndValidation = {
    dataSourcesTreatmentAndRepresentativeness: {
      referenceToDataSource: {
        "@type": "source data set",
        "@refObjectId": sourceId,
        "@version": "00.00.001",
        "common:shortDescription": {
          "@xml:lang": "en",
          "#text": "Converted short name",
        },
      },
    },
  };
  writeJsonLines(rowsFile, [processRow]);
  const trueSourceRow = sourceRow(sourceId);
  trueSourceRow.sourceDataSet.sourceInformation.dataSetInformation.sourceCitation =
    "Fixture report, 2026";
  writeJsonLines(sourceSupportRowsFile, [trueSourceRow]);

  try {
    const finalize = runFoundry([
      "dataset-post-authoring-finalize",
      "--type",
      "process",
      "--profile",
      "bafu",
      "--rows-file",
      rel(rowsFile),
      "--source-support-rows-file",
      rel(sourceSupportRowsFile),
      "--out-dir",
      rel(path.join(root, "finalize")),
    ]);

    assert.equal(finalize.json.counts.source_contact_support_rows, 2);
    assert.equal(
      finalize.json.counts.source_contact_support_finalize_status,
      "available_not_requested",
    );
    assert.equal(finalize.json.counts.source_contact_source_reference_rewrites, 2);
    const supportRows = readJsonLines(
      path.join(repoRoot, finalize.json.files.source_contact_support_rows),
    );
    assert.equal(supportRows.filter((row) => row.contactDataSet).length, 1);
    assert.equal(supportRows.filter((row) => row.sourceDataSet).length, 1);
    assert.equal(
      supportRows.find((row) => row.sourceDataSet)?.sourceDataSet.sourceInformation
        .dataSetInformation["common:UUID"],
      sourceId,
    );
    const rewrittenRows = readJsonLines(
      path.join(repoRoot, finalize.json.files.source_contact_rewritten_rows),
    );
    assert.equal(
      rewrittenRows[0].processDataSet.modellingAndValidation
        .dataSourcesTreatmentAndRepresentativeness.referenceToDataSource["common:shortDescription"][
        "#text"
      ],
      "Fixture report",
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// CLASS 1 + CLASS 2 (USLCI account-local support closure). Under
// --mint-unmatched-fp-ug-support the source/contact stage:
//   (1) mints genuinely account-local UGs/FPs as support;
//   (2) does NOT write a public canonical UG, instead bumping a minted FP's
//       referenceToReferenceUnitGroup to the canonical published version and proving the
//       canonical UG id@version (avoids remote version_outdated, root + reference roles);
//   (3) never harvests a non-true (format/compliance) support source into the commit set
//       even when it is referenced via validation/review (avoids
//       source_*_not_true_source -> mutation_manifest_not_ready -> handoff_plan_not_ready).
test("post-authoring finalize proves canonical UG for minted FP and excludes format support source", () => {
  const root = path.join(finalizeAutoQueueFixtureRoot, "account-local-support-closure");
  fs.rmSync(root, { recursive: true, force: true });
  const processId = "c1c1c1c1-2222-4333-8444-555555555555";
  const trueSourceId = "d1d1d1d1-2222-4333-8444-555555555555";
  const formatSourceId = "16938856-0a35-5654-8aff-56c17e61da4d";
  const canonicalUnitGroupId = "93a60a57-a3c8-11da-a746-0800200c9a66";
  const canonicalUnitGroupVersion = "03.00.003";
  const mintedFlowPropertyId = "f6811440-ee37-11de-8a39-0800200c9a66";
  const mintedUnitGroupId = "11d161f0-37e3-4d49-bf7a-ff4f31a9e5c7";

  const rowsFile = path.join(root, "rows", "processes.jsonl");
  const sourceSupportRowsFile = path.join(root, "rows", "sources.jsonl");
  const fpRowsFile = path.join(root, "rows", "flowproperties.jsonl");
  const ugRowsFile = path.join(root, "rows", "unitgroups.jsonl");
  const cacheFile = path.join(root, "cache", "flow-properties-unit-groups.json");

  const processRow = processRowWithDefaultClassification(processId);
  processRow.processDataSet.modellingAndValidation = {
    dataSourcesTreatmentAndRepresentativeness: {
      referenceToDataSource: {
        "@type": "source data set",
        "@refObjectId": trueSourceId,
        "@version": "00.00.001",
        "common:shortDescription": { "@xml:lang": "en", "#text": "Converted short name" },
      },
    },
    validation: {
      review: {
        "common:referenceToCompleteReviewReport": {
          "@type": "source data set",
          "@refObjectId": formatSourceId,
          "@version": "00.00.001",
          "common:shortDescription": { "@xml:lang": "en", "#text": "ILCD format" },
        },
      },
    },
  };
  writeJsonLines(rowsFile, [processRow]);

  const trueSource = sourceRow(trueSourceId);
  trueSource.sourceDataSet.sourceInformation.dataSetInformation.sourceCitation =
    "Fixture report, 2026";
  const formatSource = sourceRow(formatSourceId);
  formatSource.sourceDataSet.sourceInformation.dataSetInformation["common:shortName"] = {
    "@xml:lang": "en",
    "#text": "ILCD format",
  };
  delete formatSource.sourceDataSet.sourceInformation.sourceCitation;
  formatSource.sourceDataSet.sourceInformation.dataSetInformation.classificationInformation = {
    "common:classification": {
      "common:class": { "@level": "0", "@classId": "1", "#text": "Data set formats" },
    },
  };
  writeJsonLines(sourceSupportRowsFile, [trueSource, formatSource]);

  // Minted FP referencing a PUBLIC CANONICAL UG at the converter's @00.00.001.
  const mintedFlowProperty = {
    flowPropertyDataSet: {
      flowPropertiesInformation: {
        dataSetInformation: { "common:UUID": mintedFlowPropertyId },
        quantitativeReference: {
          referenceToReferenceUnitGroup: {
            "@type": "unit group data set",
            "@refObjectId": canonicalUnitGroupId,
            "@version": "00.00.001",
            "@uri": `../unitgroups/${canonicalUnitGroupId}.json`,
            "common:shortDescription": { "@xml:lang": "en", "#text": "Units of energy" },
          },
        },
      },
      administrativeInformation: {
        publicationAndOwnership: { "common:dataSetVersion": "00.00.001" },
      },
    },
  };
  writeJsonLines(fpRowsFile, [mintedFlowProperty]);

  // Support UG rows: one genuinely account-local (minted) UG, plus the canonical UG. The
  // canonical UG must NOT be written; the account-local one must be.
  const mintedUnitGroup = {
    unitGroupDataSet: {
      unitGroupInformation: { dataSetInformation: { "common:UUID": mintedUnitGroupId } },
      administrativeInformation: {
        publicationAndOwnership: { "common:dataSetVersion": "00.00.001" },
      },
    },
  };
  const canonicalUnitGroup = {
    unitGroupDataSet: {
      unitGroupInformation: { dataSetInformation: { "common:UUID": canonicalUnitGroupId } },
      administrativeInformation: {
        publicationAndOwnership: { "common:dataSetVersion": "00.00.001" },
      },
    },
  };
  writeJsonLines(ugRowsFile, [mintedUnitGroup, canonicalUnitGroup]);

  fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
  fs.writeFileSync(
    cacheFile,
    JSON.stringify({
      unit_groups: [
        { id: canonicalUnitGroupId, version: canonicalUnitGroupVersion, state_code: 100 },
      ],
      flow_properties: [],
      flow_property_mappings: [],
    }) + "\n",
  );

  try {
    const finalize = runFoundry([
      "dataset-post-authoring-finalize",
      "--type",
      "process",
      "--profile",
      "uslci",
      "--rows-file",
      rel(rowsFile),
      "--source-support-rows-file",
      rel(sourceSupportRowsFile),
      "--support-flowproperty-rows-file",
      rel(fpRowsFile),
      "--support-unitgroup-rows-file",
      rel(ugRowsFile),
      "--canonical-support-cache",
      rel(cacheFile),
      "--mint-unmatched-fp-ug-support",
      "--out-dir",
      rel(path.join(root, "finalize")),
    ]);

    const supportRows = readJsonLines(
      path.join(repoRoot, finalize.json.files.source_contact_support_rows),
    );
    const supportSourceIds = supportRows
      .filter((row) => row.sourceDataSet)
      .map((row) => row.sourceDataSet.sourceInformation.dataSetInformation["common:UUID"]);
    const supportUnitGroupIds = supportRows
      .filter((row) => row.unitGroupDataSet)
      .map((row) => row.unitGroupDataSet.unitGroupInformation.dataSetInformation["common:UUID"]);

    // CLASS 2: the format support source is never committed.
    assert.equal(supportSourceIds.includes(formatSourceId), false);
    // The true source referenced via referenceToDataSource is still committed.
    assert.equal(supportSourceIds.includes(trueSourceId), true);

    // CLASS 2 (review-report path): the format support source referenced via
    // modellingAndValidation/validation/review/common:referenceToCompleteReviewReport is
    // rewritten to the public canonical ILCD format source on the finalized process rows,
    // so reference closure proves it via publicCanonicalSourceReferenceKeys instead of
    // leaving a stale, unprovable support-source reference.
    const finalProcessRows = readJsonLines(path.join(repoRoot, finalize.json.files.final_rows));
    const reviewReportRef =
      finalProcessRows[0].processDataSet.modellingAndValidation.validation.review[
        "common:referenceToCompleteReviewReport"
      ];
    assert.equal(reviewReportRef["@refObjectId"], "a97a0155-0234-4b87-b4ce-a45da52f2a40");
    assert.equal(reviewReportRef["@version"], "03.00.003");
    // Closure no longer reports the format source as unproven on the process finalize.
    const processClosureBlockers = (finalize.json.blockers ?? []).filter(
      (blocker) => blocker?.reference_id === formatSourceId,
    );
    assert.equal(processClosureBlockers.length, 0);

    // CLASS 1: the account-local UG is written; the canonical UG is NOT written.
    assert.equal(supportUnitGroupIds.includes(mintedUnitGroupId), true);
    assert.equal(supportUnitGroupIds.includes(canonicalUnitGroupId), false);

    // CLASS 1: the minted FP's reference unit group version is bumped to canonical.
    const mintedFpRow = supportRows.find(
      (row) =>
        row.flowPropertyDataSet?.flowPropertiesInformation?.dataSetInformation?.["common:UUID"] ===
        mintedFlowPropertyId,
    );
    assert.ok(mintedFpRow, "minted FP is committed as account-local support");
    assert.equal(
      mintedFpRow.flowPropertyDataSet.flowPropertiesInformation.quantitativeReference
        .referenceToReferenceUnitGroup["@version"],
      canonicalUnitGroupVersion,
    );

    // CLASS 1: the canonical UG id@published-version is surfaced as a closure proof key.
    const rewriteReport = readJson(
      path.join(repoRoot, finalize.json.files.source_contact_rewrite_report),
    );
    const proofKeys = rewriteReport.canonical_support.canonical_unit_group_reference_keys;
    assert.deepEqual(proofKeys, [{ id: canonicalUnitGroupId, version: canonicalUnitGroupVersion }]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// Part A (deep redesign): the SUPPORT sub-finalize runs with --skip-source-contact-rewrites
// (verify-remote OFF). It WRITES minted Flow Properties that reference a PUBLIC CANONICAL
// Unit Group it does NOT write. The support sub-finalize must prove that reused canonical UG
// in its OWN mutation manifest, otherwise reference closure blocks
// (reference_closure_remote_verify_required -> mutation_manifest_not_ready ->
// handoff_plan_not_ready). This drives the exact skipped-rewrites support finalize and
// asserts (1) the skipped source/contact report re-derives the canonical_support proof block
// from the support rows, and (2) the support mutation manifest proves the canonical UG so no
// reference-closure blocker remains for it.
test("support finalize with skipped rewrites proves its own reused canonical unit group", () => {
  const root = path.join(finalizeAutoQueueFixtureRoot, "support-skip-rewrites-canonical-ug");
  fs.rmSync(root, { recursive: true, force: true });
  const canonicalUnitGroupId = "93a60a57-a3c8-11da-a746-0800200c9a66";
  const canonicalUnitGroupVersion = "03.00.003";
  const mintedFlowPropertyId = "f6811440-ee37-11de-8a39-0800200c9a66";
  const mintedUnitGroupId = "11d161f0-37e3-4d49-bf7a-ff4f31a9e5c7";

  const supportRowsFile = path.join(root, "rows", "support.jsonl");
  const cacheFile = path.join(root, "cache", "flow-properties-unit-groups.json");

  // Exactly the support set the parent hands to the support sub-finalize: a contact, one
  // genuinely account-local (minted) UG, and a minted FP whose reference UG is the public
  // canonical UG (already bumped to the canonical published version by the parent collector).
  const libraryContact = {
    contactDataSet: {
      contactInformation: {
        dataSetInformation: {
          "common:UUID": "aaaaaaaa-1111-4222-8333-444444444444",
          "common:shortName": { "@xml:lang": "en", "#text": "NREL USLCI" },
        },
      },
      administrativeInformation: {
        publicationAndOwnership: { "common:dataSetVersion": "00.00.001" },
      },
    },
  };
  const mintedUnitGroup = {
    unitGroupDataSet: {
      unitGroupInformation: { dataSetInformation: { "common:UUID": mintedUnitGroupId } },
      administrativeInformation: {
        publicationAndOwnership: { "common:dataSetVersion": "00.00.001" },
      },
    },
  };
  const mintedFlowProperty = {
    flowPropertyDataSet: {
      flowPropertiesInformation: {
        dataSetInformation: { "common:UUID": mintedFlowPropertyId },
        quantitativeReference: {
          referenceToReferenceUnitGroup: {
            "@type": "unit group data set",
            "@refObjectId": canonicalUnitGroupId,
            "@version": canonicalUnitGroupVersion,
            "@uri": `../unitgroups/${canonicalUnitGroupId}.json`,
            "common:shortDescription": { "@xml:lang": "en", "#text": "Units of energy" },
          },
        },
      },
      administrativeInformation: {
        publicationAndOwnership: { "common:dataSetVersion": "00.00.001" },
      },
    },
  };
  writeJsonLines(supportRowsFile, [mintedUnitGroup, mintedFlowProperty, libraryContact]);

  fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
  fs.writeFileSync(
    cacheFile,
    JSON.stringify({
      unit_groups: [
        { id: canonicalUnitGroupId, version: canonicalUnitGroupVersion, state_code: 100 },
      ],
      flow_properties: [],
      flow_property_mappings: [],
    }) + "\n",
  );

  try {
    const finalize = runFoundry([
      "dataset-post-authoring-finalize",
      "--type",
      "support",
      "--profile",
      "uslci",
      "--rows-file",
      rel(supportRowsFile),
      "--canonical-support-cache",
      rel(cacheFile),
      // The parent always hands the support sub-finalize --skip-source-contact-rewrites.
      "--skip-source-contact-rewrites",
      "--target-user-id",
      targetUserId,
      "--out-dir",
      rel(path.join(root, "finalize")),
    ]);

    // (1) The skipped source/contact report re-derives the canonical_support proof block
    // from the support rows even though the deterministic rewrite did not run.
    const skippedReport = readJson(
      path.join(repoRoot, finalize.json.files.source_contact_rewrite_report),
    );
    assert.equal(skippedReport.status, "skipped");
    assert.deepEqual(skippedReport.canonical_support.canonical_unit_group_reference_keys, [
      { id: canonicalUnitGroupId, version: canonicalUnitGroupVersion },
    ]);

    // (2) The support mutation manifest proves the canonical UG, so no reference-closure
    // blocker remains for it (the minted FP -> canonical UG edge closes). Any residual
    // blockers in this minimal fixture are schema/dry-run evidence, never closure.
    const closureBlockers = (finalize.json.blockers ?? []).filter(
      (blocker) =>
        String(blocker?.code ?? "").startsWith("reference_closure") &&
        blocker?.reference_id === canonicalUnitGroupId,
    );
    assert.equal(closureBlockers.length, 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("post-authoring finalize declares external process flow refs for remote proof", () => {
  const root = path.join(finalizeAutoQueueFixtureRoot, "missing-local-flow");
  fs.rmSync(root, { recursive: true, force: true });
  const processId = "e0e0e0e0-4444-4555-8666-777777777777";
  const missingFlowId = "f0f0f0f0-5555-4666-8777-888888888888";
  const rowsFile = path.join(root, "rows", "processes.jsonl");
  writeJsonLines(rowsFile, [processRowWithFlowRef(processId, missingFlowId)]);
  const context = writeContextPackFiles(root);
  const identityPreflightIndex = writeCompletedIdentityPreflightIndex(root, [
    {
      datasetType: "process",
      id: processId,
      target: processRowWithFlowRef(processId, missingFlowId),
      name: "Heat production",
    },
  ]);

  try {
    const finalize = runFoundry([
      "dataset-post-authoring-finalize",
      "--type",
      "process",
      "--profile",
      "bafu",
      "--rows-file",
      rel(rowsFile),
      "--identity-preflight-index",
      rel(identityPreflightIndex),
      "--schema-file",
      rel(context.schemaFile),
      "--yaml-file",
      rel(context.yamlFile),
      "--ruleset-file",
      rel(context.rulesetFile),
      "--target-user-id",
      targetUserId,
      "--out-dir",
      rel(path.join(root, "finalize")),
    ]);

    assert.equal(finalize.code, 1);
    assert.equal(finalize.json.status, "blocked");
    assert.equal(finalize.json.counts.curation_queue_status, "ready");
    assert.equal(finalize.json.counts.curation_queue_blockers, 0);
    assert.ok(
      finalize.json.blockers.some(
        (blocker) =>
          blocker.code === "reference_closure_remote_verify_required" &&
          blocker.reference_id === missingFlowId,
      ),
    );
    assert.ok(
      finalize.json.stages.some(
        (stage) =>
          stage.stage === "curation_queue" && stage.status === "ready" && stage.exit_code === 0,
      ),
    );

    const gateReport = readJson(path.join(repoRoot, finalize.json.files.curation_gate_report));
    assert.equal(gateReport.context.curation_queue.status, "ready");
    const authoringPackage = readJson(
      path.join(repoRoot, gateReport.entities[0].authoring_package),
    );
    const deterministicCodes = new Set(
      authoringPackage.deterministic_cleanup_items.map((item) => item.code),
    );
    assert.equal(deterministicCodes.has("curation_queue_context_required"), false);
    assert.equal(deterministicCodes.has("curation_queue_not_ready"), false);
    assert.equal(deterministicCodes.has("curation_queue_dependency_refs_unresolved"), false);
    assert.deepEqual(
      authoringPackage.curation_queue_context.closure.dependencies.external_refs.map(
        (ref) => ref.entity_id,
      ),
      [missingFlowId],
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("post-authoring finalize externalizes unresolved elementary flow exchanges", () => {
  const root = path.join(finalizeAutoQueueFixtureRoot, "unresolved-exchange-trace");
  fs.rmSync(root, { recursive: true, force: true });
  const processId = "e1e1e1e1-4444-4555-8666-777777777777";
  const missingFlowId = "f1f1f1f1-5555-4666-8777-888888888888";
  const rowsFile = path.join(root, "rows", "processes.jsonl");
  const row = processRowWithFlowRef(processId, missingFlowId);
  row.processDataSet.processInformation.dataSetInformation["common:other"] = {
    "tiangongfoundry:unresolvedTrace": [
      {
        status: "unresolved_deferred",
        action_item_code: "elementary_flow_identity_manual_review",
        blocked_path: "processDataSet.exchanges.exchange.0.referenceToFlowDataSet",
        reference_id: missingFlowId,
        reference_version: "00.00.001",
        reason: "Fixture unresolved elementary flow cannot be safely mapped to a public flow.",
      },
    ],
  };
  writeJsonLines(rowsFile, [row]);
  const context = writeContextPackFiles(root);
  const identityPreflightIndex = writeCompletedIdentityPreflightIndex(root, [
    {
      datasetType: "process",
      id: processId,
      target: row,
      name: "Heat production",
    },
  ]);

  try {
    const finalize = runFoundry([
      "dataset-post-authoring-finalize",
      "--type",
      "process",
      "--profile",
      "bafu",
      "--rows-file",
      rel(rowsFile),
      "--identity-preflight-index",
      rel(identityPreflightIndex),
      "--schema-file",
      rel(context.schemaFile),
      "--yaml-file",
      rel(context.yamlFile),
      "--ruleset-file",
      rel(context.rulesetFile),
      "--target-user-id",
      targetUserId,
      "--out-dir",
      rel(path.join(root, "finalize")),
    ]);

    assert.equal(finalize.json.counts.unresolved_exchange_externalized, 1);
    assert.ok(finalize.json.files.unresolved_exchange_externalized_rows);
    assert.ok(finalize.json.files.unresolved_exchange_traces);
    assert.ok(
      finalize.json.stages.some(
        (stage) =>
          stage.stage === "unresolved_exchange_externalization" &&
          stage.status === "completed" &&
          stage.exit_code === 0,
      ),
    );
    const externalizedRows = readJsonLines(
      path.join(repoRoot, finalize.json.files.unresolved_exchange_externalized_rows),
    );
    const exchanges = externalizedRows[0].processDataSet.exchanges.exchange;
    assert.deepEqual(exchanges, []);
    const traces =
      externalizedRows[0].processDataSet.processInformation.dataSetInformation["common:other"][
        "tiangongfoundry:unresolvedExchangeTrace"
      ];
    assert.equal(traces.length, 1);
    assert.equal(traces[0].reference_id, missingFlowId);
    assert.equal(traces[0].original_exchange.referenceToFlowDataSet["@refObjectId"], missingFlowId);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("post-authoring finalize externalizes exchanges for upstream blocked flow dependencies", () => {
  const root = path.join(finalizeAutoQueueFixtureRoot, "blocked-flow-dependency-trace");
  fs.rmSync(root, { recursive: true, force: true });
  const processId = "e2e2e2e2-4444-4555-8666-777777777777";
  const blockedFlowId = "f2f2f2f2-5555-4666-8777-888888888888";
  const rowsFile = path.join(root, "rows", "processes.jsonl");
  const row = processRowWithFlowRef(processId, blockedFlowId);
  writeJsonLines(rowsFile, [row]);
  const blockedFlowReferences = path.join(
    root,
    "upstream-flow-finalize",
    "canonical-support-blockers.jsonl",
  );
  writeJsonLines(blockedFlowReferences, [
    {
      code: "canonical_flow_property_reference_unresolved",
      dataset_type: "flow",
      dataset_id: blockedFlowId,
      dataset_version: "00.00.001",
      source_unit: "my",
      original_ref_object_id: "flow-property-my",
      required_resolution:
        "Add the public canonical flow property/unit group support row before this flow can be written.",
    },
  ]);
  const context = writeContextPackFiles(root);
  const identityPreflightIndex = writeCompletedIdentityPreflightIndex(root, [
    {
      datasetType: "process",
      id: processId,
      target: row,
      name: "Transport service",
    },
  ]);

  try {
    const finalize = runFoundry([
      "dataset-post-authoring-finalize",
      "--type",
      "process",
      "--profile",
      "bafu",
      "--rows-file",
      rel(rowsFile),
      "--identity-preflight-index",
      rel(identityPreflightIndex),
      "--blocked-flow-reference-blockers",
      rel(blockedFlowReferences),
      "--schema-file",
      rel(context.schemaFile),
      "--yaml-file",
      rel(context.yamlFile),
      "--ruleset-file",
      rel(context.rulesetFile),
      "--target-user-id",
      targetUserId,
      "--out-dir",
      rel(path.join(root, "finalize")),
    ]);

    assert.equal(finalize.json.counts.unresolved_exchange_externalized, 1);
    assert.equal(finalize.json.counts.blocked_flow_dependency_externalized, 1);
    const externalizedRows = readJsonLines(
      path.join(repoRoot, finalize.json.files.unresolved_exchange_externalized_rows),
    );
    assert.deepEqual(externalizedRows[0].processDataSet.exchanges.exchange, []);
    const traces =
      externalizedRows[0].processDataSet.processInformation.dataSetInformation["common:other"][
        "tiangongfoundry:unresolvedExchangeTrace"
      ];
    assert.equal(traces.length, 1);
    assert.equal(traces[0].action_item_code, "blocked_flow_dependency_exchange_externalized");
    assert.equal(traces[0].reference_id, blockedFlowId);
    assert.equal(
      traces[0].upstream_flow_blockers[0].code,
      "canonical_flow_property_reference_unresolved",
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("post-authoring finalize blocks residual BAFU AI action items after location codes pass", () => {
  fs.rmSync(finalizeCurationGateFixtureRoot, {
    recursive: true,
    force: true,
  });
  const processId = "afafafaf-cdcd-4efe-8aaa-bbbbbbbbbbbb";
  const rowsFile = path.join(finalizeCurationGateFixtureRoot, "rows", "processes.jsonl");
  const row = processRowWithInvalidLocation(processId);
  row.processDataSet.processInformation.dataSetInformation.name.baseName["#text"] =
    "xx Li salt, hydrometallurgical processing Li-ion batteries, at plant {GLO}";
  row.processDataSet.processInformation.geography.locationOfOperationSupplyOrProduction[
    "@location"
  ] = "CH";
  writeJsonLines(rowsFile, [row]);
  const context = writeContextPackFiles(finalizeCurationGateFixtureRoot);

  try {
    const finalize = runFoundry([
      "dataset-post-authoring-finalize",
      "--type",
      "process",
      "--profile",
      "bafu",
      "--rows-file",
      rel(rowsFile),
      "--schema-file",
      rel(context.schemaFile),
      "--yaml-file",
      rel(context.yamlFile),
      "--ruleset-file",
      rel(context.rulesetFile),
      "--target-user-id",
      targetUserId,
      "--out-dir",
      rel(path.join(finalizeCurationGateFixtureRoot, "finalize")),
    ]);

    assert.equal(finalize.code, 1);
    assert.equal(finalize.json.status, "blocked");
    assert.equal(finalize.json.counts.location_audit_blockers, 0);
    assert.equal(finalize.json.counts.location_code_invalid, 0);
    assert.ok(
      finalize.json.stages.some(
        (stage) => stage.stage === "post_authoring_curation_gate" && stage.exit_code === 1,
      ),
    );
    assert.ok(
      finalize.json.stages.some(
        (stage) => stage.stage === "process_save_draft_dry_run" && stage.status === "skipped",
      ),
    );
    assert.equal(finalize.json.files.dry_run_report, null);
    assert.ok(finalize.json.files.curation_gate_report);
    const gateReport = readJson(path.join(repoRoot, finalize.json.files.curation_gate_report));
    assert.equal(gateReport.status, "blocked_needs_foundry_ai_authoring");
    assert.ok(gateReport.counts.action_items > 0);

    const authoringPackageFile = path.join(repoRoot, gateReport.entities[0].authoring_package);
    const authoringPackage = readJson(authoringPackageFile);
    const actionCodes = new Set(authoringPackage.action_items.map((item) => item.code));
    assert.ok(actionCodes.has("semantic_name_placeholder_token"));
    assert.ok(actionCodes.has("semantic_geography_token_in_name"));
    assert.ok(
      finalize.json.counts.mutation_manifest_blockers > 0,
      "Mutation manifest must keep residual AI action items out of remote write.",
    );
    const mutationManifest = readJson(path.join(repoRoot, finalize.json.files.mutation_manifest));
    assert.ok(scopeBlockerCodes(mutationManifest).has("dry_run_report_required"));
  } finally {
    fs.rmSync(finalizeCurationGateFixtureRoot, {
      recursive: true,
      force: true,
    });
  }
});

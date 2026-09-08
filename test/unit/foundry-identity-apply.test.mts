import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import test from "node:test";
import { describeCliRuntime, CLI_RUNTIME_EXPECTATION_SCHEMA } from "@tiangong-lca/cli/runtime";
import {
  createFoundryRuntimeContext,
  initializeFoundryWorkspace,
  captureFoundryInput,
} from "../../scripts/lib/foundry-runtime-context.ts";
import {
  FOUNDRY_TIDAS_EXPECTATION_SCHEMA,
  qualifyFoundryRuntime,
} from "../../scripts/lib/foundry-runtime-qualification.ts";
import { createFoundryRuntime } from "../../scripts/foundry-runtime.ts";
import { applyFoundryIdentityDecisions } from "../../scripts/lib/foundry-workflow-identity-apply.ts";
import { flowRow, processRowWithFlowRef } from "../fixtures/row-builders.ts";

test("identity reuse partitions local rows and rewrites dependent process references without losing metadata", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "foundry-identity-apply-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const flowId = "11111111-1111-4111-8111-111111111111",
    processId = "22222222-2222-4222-8222-222222222222";
  const canonicalId = "33333333-3333-4333-8333-333333333333";
  const flow = {
    id: flowId,
    version: "00.00.001",
    json: flowRow(flowId),
    source_label: "preserved flow metadata",
  };
  const process = {
    id: processId,
    version: "00.00.001",
    json: processRowWithFlowRef(processId, flowId),
    source_label: "preserved process metadata",
  };
  const flowFile = path.join(root, "flows.json"),
    processFile = path.join(root, "processes.json"),
    snapshot = path.join(root, "authoring-package.json");
  fs.writeFileSync(flowFile, JSON.stringify([flow]));
  fs.writeFileSync(processFile, JSON.stringify([process]));
  fs.writeFileSync(
    snapshot,
    JSON.stringify({ source_row: flow, fixture: "identity owner wiring" }),
  );
  const base = {
    moduleUrl: new URL("../../scripts/runtime-entry.ts", import.meta.url).href,
    workspace: path.join(root, "workspace"),
    cacheBase: path.join(root, "cache"),
  };
  initializeFoundryWorkspace(createFoundryRuntimeContext(base));
  const context = createFoundryRuntimeContext({
    ...base,
    taskId: "identity-apply-fixture",
    actorId: "actor",
    inputs: [flowFile, processFile, snapshot].map(captureFoundryInput),
  });
  createFoundryRuntime(context).startTask({
    requestId: "identity-apply-fixture",
    lane: "source-evidence-dataset-development",
    profileId: "generic",
    targetEntities: ["flow", "process"],
    seed: { rows: [flow, process] },
  });
  const binary = path.resolve(import.meta.dirname, "../fixtures/fake-tidas.ts"),
    cli = describeCliRuntime();
  const qualified = qualifyFoundryRuntime(context, {
    cliExpectation: {
      schema: CLI_RUNTIME_EXPECTATION_SCHEMA,
      package_version: cli.package.version,
      platform: cli.platform,
      content_sha256: cli.content_sha256,
      node_version: cli.node.version,
      node_sha256: cli.node.sha256,
    },
    tidasExecutable: binary,
    tidasExpectation: {
      schema: FOUNDRY_TIDAS_EXPECTATION_SCHEMA,
      platform: cli.platform,
      binary_version: "0.2.7",
      executable: {
        bytes: fs.statSync(binary).size,
        sha256: createHash("sha256").update(fs.readFileSync(binary)).digest("hex"),
      },
      validation: {
        schema_version: "tidas.validation-describe.v1",
        asset_fingerprint: "1".repeat(64),
        protocols: ["document-validation-batch.v1"],
        event_schema_versions: [
          "tidas.validation-final-event.v1",
          "tidas.validation-issue-event.v1",
        ],
      },
    },
  });
  const snapshotSha = captureFoundryInput(snapshot).sha256,
    contextSha = "2".repeat(64);
  const row = {
    dataset_type: "flow",
    dataset_id: flowId,
    dataset_version: "00.00.001",
    authoring_package: snapshot,
    authoring_package_sha256: snapshotSha,
  };
  const task = {
    identity_action_items: [row],
    context_bundle: { sha256: contextSha },
    files: { authoring_package_snapshots_dir: root },
  };
  const decisions = [
    {
      ...row,
      decision_status: "completed",
      identity_decision: "reuse_existing_reference",
      canonical: {
        table: "flows",
        ref_object_id: canonicalId,
        version: "00.00.001",
        short_description: [{ "@xml:lang": "en", "#text": "Canonical natural gas" }],
      },
      authoring_context: { context_bundle_sha256: contextSha },
      basis: "Controlled canonical reference fixture.",
      evidence: { source: snapshot, quote_or_trace: "Fixture canonical selection." },
      used_context_kinds: ["schema", "methodology_yaml", "ruleset"],
      closes_action_items: ["identity_preflight_manual_review"],
    },
  ];
  const request = {
    task,
    decisions,
    sets: [
      { type: "flow", file: flowFile, count: 1 },
      { type: "process", file: processFile, count: 1 },
    ],
    output: path.join(context.taskRoot!, "outputs", "identity"),
  };
  const wrongTable = structuredClone(request);
  wrongTable.decisions[0].canonical.table = "processes";
  assert.throws(
    () => applyFoundryIdentityDecisions(context, qualified, root, wrongTable),
    /matching dataset table/u,
  );
  const result = applyFoundryIdentityDecisions(context, qualified, root, request);
  assert.deepEqual(result.blockers, []);
  assert.equal(result.sets.find((set) => set.type === "flow")?.count, 0);
  assert.equal(result.rewriteReports.length, 1);
  const set = result.sets.find((value) => value.type === "process");
  assert.ok(set);
  const rewritten = JSON.parse(fs.readFileSync(set.file, "utf8").trim()) as typeof process;
  assert.equal(rewritten.source_label, process.source_label);
  assert.equal(
    rewritten.json.processDataSet.exchanges.exchange[0].referenceToFlowDataSet["@refObjectId"],
    canonicalId,
  );
  assert.deepEqual(JSON.parse(fs.readFileSync(processFile, "utf8")), [process]);
  const report = JSON.parse(fs.readFileSync(result.reports[0], "utf8")) as {
    counts: { input_rows: number; output_rows: number; reference_rows: number };
    files: { reference_rows: string };
  };
  assert.deepEqual(
    [report.counts.input_rows, report.counts.output_rows, report.counts.reference_rows],
    [1, 0, 1],
  );
  assert.deepEqual(
    JSON.parse(
      fs.readFileSync(path.resolve(context.assetRoot, report.files.reference_rows), "utf8").trim(),
    ),
    flow,
  );
});

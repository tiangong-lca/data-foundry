import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const fixtureRoot = path.join(repoRoot, "tmp", "authoring-plan-test");

function rel(filePath) {
  return path.relative(repoRoot, filePath).replaceAll("\\", "/");
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function writeJsonLines(filePath, rows) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`);
}

function runFoundry(args, expectedStatus = 0) {
  const result = spawnSync(process.execPath, ["scripts/foundry.mjs", ...args], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  assert.equal(result.status, expectedStatus, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

function writeCurationGateReport() {
  const reportPath = path.join(fixtureRoot, "curation-gate", "dataset-curation-gate-report.json");
  const queueManifestPath = path.join(
    fixtureRoot,
    "curation-queue",
    "outputs",
    "curation-queue-manifest.json",
  );
  writeJson(queueManifestPath, {
    status: "ready",
    inputs: {
      processes: rel(path.join(fixtureRoot, "rows", "processes.jsonl")),
      flows: rel(path.join(fixtureRoot, "rows", "flows.jsonl")),
    },
  });
  writeJson(reportPath, {
    schema_version: 2,
    status: "blocked_needs_foundry_ai_authoring",
    profile: "bafu",
    dataset_type: "process",
    rows_file: rel(path.join(fixtureRoot, "rows", "processes.jsonl")),
    counts: {
      action_items: 6,
      identity_action_items: 2,
      classification_queue_action_items: 1,
      location_queue_action_items: 0,
      deterministic_cleanup_items: 0,
    },
    context: {
      classification_queue: {
        queue_file: rel(path.join(fixtureRoot, "classification-authoring-queue.jsonl")),
        rows: 3,
      },
      location_queue: {
        queue_file: rel(path.join(fixtureRoot, "location-authoring-queue.jsonl")),
        rows: 0,
      },
      curation_queue: {
        manifest_file: rel(queueManifestPath),
      },
      contract_context_file_details: [
        { kind: "schema", path: "context/process/schema.json" },
        { kind: "methodology_yaml", path: "context/process/methodology.yaml" },
        { kind: "ruleset", path: "context/process/runtime-ruleset.json" },
        {
          kind: "classification_schema",
          path: "node_modules/@tiangong-lca/cli/assets/tidas-schemas/tidas_processes_category.json",
        },
        {
          kind: "classification_schema",
          path: "node_modules/@tiangong-lca/cli/assets/tidas-schemas/tidas_flows_product_category.json",
        },
        {
          kind: "location_schema",
          path: "node_modules/@tiangong-lca/cli/assets/tidas-schemas/tidas_locations_category.json",
        },
      ],
    },
    entities: [
      {
        dataset_type: "process",
        entity_id: "33333333-3333-5333-8333-333333333333",
        authoring_package: rel(
          path.join(
            fixtureRoot,
            "curation-gate",
            "ai-authoring-packages",
            "process-33333333-3333-5333-8333-333333333333.authoring-package.json",
          ),
        ),
      },
    ],
  });
  return reportPath;
}

test("dataset-authoring-plan aggregates missing AI task builds from curation gate", () => {
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
  const reportPath = writeCurationGateReport();
  const plan = runFoundry([
    "dataset-authoring-plan",
    "--curation-gate-report",
    rel(reportPath),
    "--out-dir",
    rel(path.join(fixtureRoot, "authoring-plan")),
  ]);

  assert.equal(plan.status, "needs_task_build");
  assert.equal(plan.counts.identity_action_items, 2);
  assert.equal(plan.counts.classification_queue_rows, 1);
  assert.equal(plan.counts.field_patch_action_items, 3);
  assert.equal(
    plan.phases.find((phase) => phase.phase === "location_decisions").status,
    "not_required",
  );
  assert.equal(
    plan.phases.find((phase) => phase.phase === "identity_decisions").status,
    "needs_task_build",
  );
  assert.equal(
    plan.phases.find((phase) => phase.phase === "classification_decisions").status,
    "needs_task_build",
  );
  assert.equal(
    plan.phases.find((phase) => phase.phase === "field_patches").status,
    "needs_task_build",
  );
  assert.match(
    plan.phases.find((phase) => phase.phase === "classification_decisions").commands.build_task,
    /dataset-classification-decision-task-build/u,
  );
  assert.match(
    plan.phases.find((phase) => phase.phase === "classification_decisions").commands.build_task,
    /tidas_locations_category\.json/u,
  );
  assert.match(
    plan.phases.find((phase) => phase.phase === "classification_decisions").commands.build_task,
    /--dataset-type process/u,
  );
  assert.match(
    plan.phases.find((phase) => phase.phase === "classification_decisions").commands.build_task,
    /33333333-3333-5333-8333-333333333333/u,
  );
  assert.match(
    plan.phases
      .find((phase) => phase.phase === "classification_decisions")
      .commands.apply_decisions.replaceAll("\\", "/"),
    /classification-authoring-queue\.process\.jsonl/u,
  );
  assert.match(
    plan.phases.find((phase) => phase.phase === "classification_decisions").commands
      .apply_decisions,
    /--rows-file tmp\/authoring-plan-test\/rows\/processes\.jsonl/u,
  );
});

test("dataset-authoring-plan detects ready tasks and waits for AI outputs", () => {
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
  const reportPath = writeCurationGateReport();
  writeJson(path.join(fixtureRoot, "identity-decision-task", "identity-decision-task.json"), {
    status: "ready_for_ai_identity_decisions",
    dataset_types: ["flow", "process"],
    counts: { template_decisions: 2 },
    identity_action_items: [
      { dataset_type: "flow", dataset_id: "flow-1" },
      { dataset_type: "flow", dataset_id: "flow-2" },
      { dataset_type: "process", dataset_id: "process-1" },
    ],
  });
  writeJson(
    path.join(fixtureRoot, "classification-decision-task", "classification-decision-task.json"),
    {
      status: "ready_for_ai_classification_decisions",
      counts: { template_decisions: 3 },
      classification_queue_rows: [
        { dataset_type: "flow", dataset_id: "flow-1" },
        { dataset_type: "flow", dataset_id: "flow-2" },
        { dataset_type: "flow", dataset_id: "flow-3" },
      ],
    },
  );
  writeJson(path.join(fixtureRoot, "authoring-tasks", "authoring-task-manifest.json"), {
    status: "ready_for_ai_authoring_batch",
    counts: { action_items: 3 },
    commands: {
      apply_all_patches: "node scripts/foundry.mjs dataset-patch-apply --input rows.jsonl",
    },
  });

  const plan = runFoundry([
    "dataset-authoring-plan",
    "--curation-gate-report",
    rel(reportPath),
    "--decision-chunk-size",
    "2",
    "--out-dir",
    rel(path.join(fixtureRoot, "authoring-plan")),
  ]);

  assert.equal(plan.status, "ready_for_ai_authoring");
  assert.equal(
    plan.phases.find((phase) => phase.phase === "identity_decisions").status,
    "ready_for_ai_decisions",
  );
  assert.equal(
    plan.phases.find((phase) => phase.phase === "identity_decisions").commands.apply_decisions,
    null,
  );
  assert.deepEqual(
    plan.phases
      .find((phase) => phase.phase === "identity_decisions")
      .commands.apply_decisions_by_type.map((item) => item.dataset_type),
    ["flow", "process"],
  );
  assert.match(
    plan.phases
      .find((phase) => phase.phase === "identity_decisions")
      .commands.apply_decisions_by_type[0].command.replaceAll("\\", "/"),
    /--authoring-package-dir/u,
  );
  assert.match(
    plan.phases.find((phase) => phase.phase === "identity_decisions").commands
      .apply_decisions_by_type[0].command,
    /rows\/flows\.jsonl/u,
  );
  assert.equal(
    plan.phases.find((phase) => phase.phase === "identity_decisions").chunk_plan.chunks,
    2,
  );
  assert.match(
    plan.phases.find((phase) => phase.phase === "identity_decisions").chunk_plan.commands[0]
      .command,
    /--limit 2/u,
  );
  assert.equal(
    plan.phases.find((phase) => phase.phase === "classification_decisions").chunk_plan.chunks,
    2,
  );
  assert.equal(
    plan.phases.find((phase) => phase.phase === "classification_decisions").status,
    "ready_for_ai_decisions",
  );
  assert.equal(
    plan.phases.find((phase) => phase.phase === "field_patches").status,
    "ready_for_ai_patches",
  );
  const patchPhase = plan.phases.find((phase) => phase.phase === "field_patches");
  assert.equal(patchPhase.commands.apply_patches, null);
  assert.equal(
    patchPhase.commands.apply_patches_manifest,
    "node scripts/foundry.mjs dataset-patch-apply --input rows.jsonl",
  );
  assert.match(
    patchPhase.commands.apply_patches_unavailable_reason,
    /Earlier classification\/location phases/u,
  );
  assert.equal(plan.rows_chain.status, "waiting_for_prior_phase_completion");
});

test("dataset-authoring-plan chains classification output through patch and identity apply", () => {
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
  const reportPath = writeCurationGateReport();
  const sourceRows = path.join(fixtureRoot, "rows", "processes.jsonl");
  const classifiedRows = path.join(
    fixtureRoot,
    "classification-decision-apply",
    "rows",
    "processes.classified.jsonl",
  );
  const batchPatchFile = path.join(fixtureRoot, "authoring-tasks", "ai-patches.batch.json");
  writeJsonLines(sourceRows, [
    {
      processDataSet: {
        processInformation: {
          dataSetInformation: {
            "common:UUID": "33333333-3333-5333-8333-333333333333",
          },
        },
      },
    },
  ]);
  writeJsonLines(classifiedRows, [
    {
      processDataSet: {
        processInformation: {
          dataSetInformation: {
            "common:UUID": "33333333-3333-5333-8333-333333333333",
          },
        },
      },
    },
  ]);
  writeJsonLines(batchPatchFile, []);
  writeJson(
    path.join(fixtureRoot, "classification-decision-task", "classification-decision-task.json"),
    {
      status: "ready_for_ai_classification_decisions",
      classification_queue: rel(path.join(fixtureRoot, "classification-authoring-queue.jsonl")),
      classification_queue_rows: [{ dataset_type: "process", dataset_id: "process-1" }],
    },
  );
  writeJsonLines(
    path.join(fixtureRoot, "classification-decision-task", "classification-decisions.jsonl"),
    [
      {
        dataset_type: "process",
        dataset_id: "process-1",
        dataset_version: "00.00.001",
        category_type: "process",
        decision_status: "completed",
      },
    ],
  );
  writeJson(
    path.join(
      fixtureRoot,
      "classification-decision-apply",
      "classification-decisions-apply-report.json",
    ),
    {
      status: "completed",
      files: {
        input_rows: [rel(sourceRows)],
        output_rows: [rel(classifiedRows)],
      },
    },
  );
  writeJson(path.join(fixtureRoot, "authoring-tasks", "authoring-task-manifest.json"), {
    status: "ready_for_ai_authoring_batch",
    counts: { action_items: 3 },
    batch_patch_contract: {
      status: "available",
      output_patch_file: rel(batchPatchFile),
    },
    commands: {
      apply_all_patches:
        "node scripts/foundry.mjs dataset-patch-apply --input tmp/old/processes.jsonl",
    },
  });
  writeJson(path.join(fixtureRoot, "authoring-tasks", "authoring-patch-collect-report.json"), {
    status: "ready_for_patch_apply",
  });
  writeJson(path.join(fixtureRoot, "identity-decision-task", "identity-decision-task.json"), {
    status: "ready_for_ai_identity_decisions",
    dataset_types: ["process"],
    identity_action_items: [{ dataset_type: "process", dataset_id: "process-1" }],
  });
  writeJsonLines(path.join(fixtureRoot, "identity-decision-task", "identity-decisions.jsonl"), [
    {
      dataset_type: "process",
      dataset_id: "process-1",
      dataset_version: "00.00.001",
      decision_status: "completed",
      identity_decision: "create_new",
      basis: "No existing process is physically equivalent.",
    },
  ]);

  const plan = runFoundry([
    "dataset-authoring-plan",
    "--curation-gate-report",
    rel(reportPath),
    "--out-dir",
    rel(path.join(fixtureRoot, "authoring-plan")),
  ]);

  const patchOutput = rel(
    path.join(fixtureRoot, "patch-apply", "rows", "processes.classified.patched.jsonl"),
  );
  const identityOutput = rel(
    path.join(fixtureRoot, "identity-decision-apply", "processes.identity-decisions-applied.jsonl"),
  );
  const chainedPatchPhase = plan.phases.find((phase) => phase.phase === "field_patches");
  assert.match(
    chainedPatchPhase.commands.apply_patches.replaceAll("\\", "/"),
    new RegExp(rel(classifiedRows), "u"),
  );
  assert.match(
    chainedPatchPhase.commands.apply_patches.replaceAll("\\", "/"),
    new RegExp(patchOutput, "u"),
  );
  assert.doesNotMatch(chainedPatchPhase.commands.apply_patches, /tmp\/old\/processes\.jsonl/u);

  const identityPhase = plan.phases.find((phase) => phase.phase === "identity_decisions");
  assert.equal(identityPhase.commands.apply_decisions_by_type[0].rows_file, patchOutput);
  assert.match(
    identityPhase.commands.apply_decisions_by_type[0].command.replaceAll("\\", "/"),
    new RegExp(patchOutput, "u"),
  );
  assert.equal(plan.rows_chain.status, "needs_deterministic_apply");
  assert.equal(plan.rows_chain.current_rows, identityOutput);
});

test("dataset-identity-decisions-apply filters mixed decisions by requested type", () => {
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
  const flowId = "11111111-1111-5111-8111-111111111111";
  const processId = "22222222-2222-5222-8222-222222222222";
  const rowsFile = path.join(fixtureRoot, "rows", "flows.jsonl");
  const decisionsFile = path.join(fixtureRoot, "identity-decisions.jsonl");
  writeJsonLines(rowsFile, [
    {
      flowDataSet: {
        flowInformation: {
          dataSetInformation: {
            "common:UUID": flowId,
          },
        },
        administrativeInformation: {
          publicationAndOwnership: {
            "common:dataSetVersion": "00.00.001",
          },
        },
      },
    },
  ]);
  writeJsonLines(decisionsFile, [
    {
      dataset_type: "flow",
      dataset_id: flowId,
      dataset_version: "00.00.001",
      decision_status: "completed",
      identity_decision: "create_new",
      basis: "No existing flow candidate matched the full source context.",
      used_context_kinds: ["schema", "methodology_yaml", "ruleset"],
      closes_action_items: ["identity_preflight_manual_review"],
      evidence: {
        source: "unit-test",
      },
    },
    {
      dataset_type: "process",
      dataset_id: processId,
      dataset_version: "00.00.001",
      decision_status: "completed",
      identity_decision: "block_unresolved",
      basis: "This process decision belongs to a different apply pass.",
      used_context_kinds: ["schema", "methodology_yaml", "ruleset"],
      evidence: {
        source: "unit-test",
      },
    },
  ]);

  const report = runFoundry([
    "dataset-identity-decisions-apply",
    "--type",
    "flow",
    "--rows-file",
    rel(rowsFile),
    "--decisions",
    rel(decisionsFile),
    "--out-dir",
    rel(path.join(fixtureRoot, "identity-decision-apply", "flow")),
  ]);

  assert.equal(report.status, "completed");
  assert.equal(report.counts.input_decisions, 2);
  assert.equal(report.counts.decisions, 1);
  assert.equal(report.counts.blockers, 0);
});

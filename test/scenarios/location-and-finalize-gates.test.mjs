import test from "node:test";
import {
  finalizeIdentityPreflightFixtureRoot,
  finalizeLocationFixtureRoot,
  locationFixtureRoot,
} from "../fixtures/fixture-roots.ts";
import {
  assert,
  bundledCategorySchemaNames,
  contextTextByPathSuffix,
  fs,
  path,
  readJson,
  rel,
  repoRoot,
  runFoundry,
  scopeBlockerCodes,
  targetUserId,
  writeJson,
  writeJsonLines,
} from "../fixtures/foundry-core.ts";
import { writeContextPackFiles } from "../fixtures/full-context-fixtures.mjs";
import { processRowWithInvalidLocation } from "../fixtures/row-builders.mjs";

test("curation gate attaches location queue context as a concrete AI action item", () => {
  fs.rmSync(locationFixtureRoot, { recursive: true, force: true });
  const processId = "cccccccc-dddd-4eee-8fff-aaaaaaaaaaaa";
  const rowsFile = path.join(locationFixtureRoot, "rows", "processes.jsonl");
  writeJsonLines(rowsFile, [processRowWithInvalidLocation(processId)]);
  const schemaReport = path.join(locationFixtureRoot, "schema", "validation-report.json");
  writeJson(schemaReport, {
    input_path: rel(rowsFile),
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
  const qaReport = path.join(locationFixtureRoot, "qa", "process-qa-report.json");
  writeJson(qaReport, {
    rows_file: rel(rowsFile),
    status: "completed",
    blockers: [],
    findings: [],
  });
  const locationQueue = path.join(locationFixtureRoot, "location-authoring-queue.jsonl");
  const locationPath =
    "processDataSet.processInformation.geography.locationOfOperationSupplyOrProduction.@location";
  writeJsonLines(locationQueue, [
    {
      dataset_type: "process",
      dataset_id: processId,
      dataset_version: "00.00.001",
      code: "location_code_requires_authoring",
      path: locationPath,
      current_location: "Invalid region",
      location_workflow: {
        schema_type: "location",
        commands: {
          audit: "tiangong-lca dataset classification audit --type location",
          apply: "tiangong-lca dataset classification apply --type location",
        },
      },
      required_resolution: "Choose a valid TIDAS location code from tidas_locations_category.json.",
    },
  ]);
  const context = writeContextPackFiles(locationFixtureRoot);

  try {
    const gate = runFoundry([
      "dataset-curation-gate",
      "--type",
      "process",
      "--profile",
      "bafu",
      "--rows-file",
      rel(rowsFile),
      "--schema-report",
      rel(schemaReport),
      "--qa-report",
      rel(qaReport),
      "--location-queue",
      rel(locationQueue),
      "--schema-file",
      rel(context.schemaFile),
      "--yaml-file",
      rel(context.yamlFile),
      "--ruleset-file",
      rel(context.rulesetFile),
      "--out-dir",
      rel(path.join(locationFixtureRoot, "curation-gate")),
    ]);
    assert.equal(gate.code, 1);
    assert.equal(gate.json.status, "blocked_needs_foundry_ai_authoring");
    assert.equal(gate.json.counts.action_items, 1);
    assert.equal(gate.json.counts.location_queue_action_items, 1);
    assert.deepEqual(
      bundledCategorySchemaNames().filter(
        (name) =>
          !gate.json.context.full_context_ai_completion.required_context_file_patterns.includes(
            name,
          ),
      ),
      [],
    );

    const packagePath = path.join(repoRoot, gate.json.entities[0].authoring_package);
    const authoringPackage = readJson(packagePath);
    assert.equal(authoringPackage.location_authoring_context.rows.length, 1);
    assert.equal(authoringPackage.action_items[0].path, locationPath);
    assert.match(
      contextTextByPathSuffix(authoringPackage, "tidas_locations_category.json"),
      /Switzerland/u,
    );

    const task = runFoundry([
      "dataset-authoring-task-build",
      "--curation-gate-report",
      gate.json.files.report,
      "--out-dir",
      rel(path.join(locationFixtureRoot, "authoring-tasks")),
    ]);
    assert.equal(task.code, 0);
    assert.equal(task.json.status, "ready_no_action_items");
    assert.equal(task.json.counts.action_items, 0);
    assert.equal(task.json.counts.decision_only_action_items, 1);
    assert.equal(task.json.batch_patch_contract.status, "not_required_no_patch_action_items");
    assert.equal(task.json.commands.apply_all_patches, null);
    assert.ok(
      task.json.tasks[0].context.contract_context_files.some(
        (file) => file.kind === "location_schema" && file.bytes > 0,
      ),
    );
    assert.deepEqual(task.json.tasks[0].action_items, []);
    const decisionItem = task.json.tasks[0].decision_only_action_items[0];
    assert.deepEqual(decisionItem.allowed_resolution_modes, ["location_decision"]);
    assert.equal(
      decisionItem.json_pointer,
      "/processDataSet/processInformation/geography/locationOfOperationSupplyOrProduction/@location",
    );
    const patchTemplate = readJson(path.join(repoRoot, task.json.tasks[0].files.patch_template));
    assert.equal(patchTemplate.patch_sets[0].operations.length, 0);
  } finally {
    fs.rmSync(locationFixtureRoot, { recursive: true, force: true });
  }
});

test("post-authoring finalize runs location audit as a hard prewrite gate", () => {
  fs.rmSync(finalizeLocationFixtureRoot, { recursive: true, force: true });
  const processId = "abababab-cdcd-4efe-8aaa-bbbbbbbbbbbb";
  const rowsFile = path.join(finalizeLocationFixtureRoot, "rows", "processes.jsonl");
  writeJsonLines(rowsFile, [processRowWithInvalidLocation(processId)]);

  try {
    const finalize = runFoundry([
      "dataset-post-authoring-finalize",
      "--type",
      "process",
      "--profile",
      "generic",
      "--rows-file",
      rel(rowsFile),
      "--out-dir",
      rel(path.join(finalizeLocationFixtureRoot, "finalize")),
    ]);
    assert.equal(finalize.code, 1);
    assert.equal(finalize.json.status, "blocked");
    assert.equal(finalize.json.counts.location_audit_blockers, 1);
    assert.equal(finalize.json.counts.location_code_invalid, 1);
    assert.ok(
      finalize.json.stages.some(
        (stage) => stage.stage === "location_audit" && stage.exit_code === 1,
      ),
    );
    assert.ok(finalize.json.blockers.some((blocker) => blocker.code === "location_code_invalid"));
    assert.ok(
      finalize.json.stages.some(
        (stage) => stage.stage === "process_save_draft_dry_run" && stage.status === "skipped",
      ),
    );
    assert.equal(finalize.json.files.dry_run_report, null);
    assert.ok(finalize.json.files.location_audit_report);
    const locationAuditReport = readJson(
      path.join(repoRoot, finalize.json.files.location_audit_report),
    );
    assert.equal(locationAuditReport.status, "blocked");
    assert.equal(locationAuditReport.counts.invalid, 1);
    assert.equal(
      locationAuditReport.findings[0].path,
      "processDataSet.processInformation.geography.locationOfOperationSupplyOrProduction.@location",
    );
    const mutationManifest = readJson(path.join(repoRoot, finalize.json.files.mutation_manifest));
    assert.ok(scopeBlockerCodes(mutationManifest).has("dry_run_report_required"));
  } finally {
    fs.rmSync(finalizeLocationFixtureRoot, { recursive: true, force: true });
  }
});

test("post-authoring finalize auto-requires identity preflight for BAFU process scopes", () => {
  fs.rmSync(finalizeIdentityPreflightFixtureRoot, {
    recursive: true,
    force: true,
  });
  const processId = "adadadad-cdcd-4efe-8aaa-bbbbbbbbbbbb";
  const rowsFile = path.join(finalizeIdentityPreflightFixtureRoot, "rows", "processes.jsonl");
  const row = processRowWithInvalidLocation(processId);
  row.processDataSet.processInformation.geography.locationOfOperationSupplyOrProduction[
    "@location"
  ] = "CH";
  writeJsonLines(rowsFile, [row]);
  const context = writeContextPackFiles(finalizeIdentityPreflightFixtureRoot);

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
      rel(path.join(finalizeIdentityPreflightFixtureRoot, "finalize")),
    ]);

    assert.equal(finalize.code, 1);
    assert.equal(finalize.json.status, "blocked");
    assert.equal(finalize.json.counts.identity_preflight_required, true);
    assert.equal(
      finalize.json.counts.source_contact_support_finalize_status,
      "available_not_requested",
    );
    assert.ok(finalize.json.files.source_contact_support_rows);
    assert.equal(finalize.json.files.source_contact_support_finalize_report, null);
    assert.ok(finalize.json.files.curation_gate_report);
    assert.ok(
      finalize.json.stages.some(
        (stage) => stage.stage === "process_save_draft_dry_run" && stage.status === "skipped",
      ),
    );
    const gateReport = readJson(path.join(repoRoot, finalize.json.files.curation_gate_report));
    const deterministicCodes = new Set(
      gateReport.entities.flatMap((entity) =>
        readJson(path.join(repoRoot, entity.authoring_package)).deterministic_cleanup_items.map(
          (item) => item.code,
        ),
      ),
    );
    assert.equal(gateReport.counts.identity_preflight_rows, 0);
    assert.ok(deterministicCodes.has("identity_preflight_index_required"));
  } finally {
    fs.rmSync(finalizeIdentityPreflightFixtureRoot, {
      recursive: true,
      force: true,
    });
  }
});

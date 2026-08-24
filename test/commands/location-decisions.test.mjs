import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const fixtureRoot = path.join(repoRoot, "tmp", "location-decisions-test");
const processId = "33333333-4444-5555-8666-777777777777";
const locationPath =
  "processDataSet.processInformation.geography.locationOfOperationSupplyOrProduction.@location";

function rel(filePath) {
  return path.relative(repoRoot, filePath).replaceAll("\\", "/");
}

function ml(text) {
  return { "@xml:lang": "en", "#text": text };
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function writeJsonLines(filePath, rows) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`);
}

function readJsonLines(filePath) {
  return fs
    .readFileSync(filePath, "utf8")
    .trim()
    .split(/\r?\n/u)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function runFoundry(args, expectedStatus = 0) {
  const result = spawnSync(process.execPath, ["scripts/foundry.mjs", ...args], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  assert.equal(result.status, expectedStatus, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

function processRow() {
  return {
    processDataSet: {
      processInformation: {
        dataSetInformation: {
          "common:UUID": processId,
          name: { baseName: ml("Swiss recycling operation") },
        },
        geography: {
          locationOfOperationSupplyOrProduction: {
            "@location": "Switzerland, source text",
            descriptionOfRestrictions: ml("Source geography is Switzerland."),
          },
        },
      },
      administrativeInformation: {
        publicationAndOwnership: {
          "common:dataSetVersion": "00.00.001",
        },
      },
    },
  };
}

test("location decision task and apply route AI location choices through CLI location apply", () => {
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
  const rowsDir = path.join(fixtureRoot, "rows");
  const processRows = path.join(rowsDir, "processes.jsonl");
  const processOut = path.join(rowsDir, "processes.located.jsonl");
  const queue = path.join(fixtureRoot, "location-authoring-queue.jsonl");
  const decisions = path.join(fixtureRoot, "location-decisions.jsonl");
  const taskDir = path.join(fixtureRoot, "location-task");
  const applyDir = path.join(fixtureRoot, "location-apply");
  const contextDir = path.join(fixtureRoot, "context");
  const schemaFile = path.join(contextDir, "schema.json");
  const yamlFile = path.join(contextDir, "methodology.yaml");
  const rulesetFile = path.join(contextDir, "runtime-ruleset.json");
  const classificationCategoryFile = path.join(contextDir, "tidas_processes_category.json");
  const locationCategoryFile = path.join(contextDir, "tidas_locations_category.json");

  try {
    writeJsonLines(processRows, [processRow()]);
    writeJson(schemaFile, { title: "Fixture process schema" });
    fs.mkdirSync(contextDir, { recursive: true });
    fs.writeFileSync(yamlFile, "process:\n  geography: required\n");
    writeJson(rulesetFile, { rules: ["source-language-only"] });
    writeJson(classificationCategoryFile, { oneOf: [{ const: "A.1.1" }] });
    writeJson(locationCategoryFile, { oneOf: [{ const: "CH" }] });
    writeJsonLines(queue, [
      {
        dataset_type: "process",
        dataset_id: processId,
        dataset_version: "00.00.001",
        code: "location_code_requires_authoring",
        path: locationPath,
        current_location: "Switzerland, source text",
        source_file: "tmp/source/process.json",
        location_workflow: {
          schema_type: "location",
          commands: {
            input_rows: rel(processRows),
            output_rows: rel(processOut),
          },
        },
        required_resolution:
          "Choose a valid TIDAS location code from tidas_locations_category.json.",
      },
    ]);

    const task = runFoundry([
      "dataset-location-decision-task-build",
      "--location-queue",
      rel(queue),
      "--schema-file",
      rel(schemaFile),
      "--yaml-file",
      rel(yamlFile),
      "--ruleset-file",
      rel(rulesetFile),
      "--classification-schema",
      rel(classificationCategoryFile),
      "--location-schema",
      rel(locationCategoryFile),
      "--out-dir",
      rel(taskDir),
    ]);
    assert.equal(task.status, "ready_for_ai_location_decisions");
    assert.equal(task.counts.template_decisions, 1);
    assert.equal(task.counts.contract_context_files, 5);
    assert.equal(task.counts.blockers, 0);
    assert.equal(task.counts.attached_input_rows, 1);
    assert.equal(task.location_queue_rows.length, 1);
    assert.match(task.commands.apply_decisions, /dataset-location-decisions-apply/u);
    const templateRows = readJsonLines(path.join(repoRoot, task.files.template));
    assert.equal(templateRows[0].decision_status, "completed");
    assert.equal(templateRows[0].code, "__AI_SELECT_TIDAS_LOCATION_CODE__");
    assert.equal(templateRows[0].target_path, locationPath);
    assert.match(templateRows[0].authoring_context.context_bundle_sha256, /^[a-f0-9]{64}$/u);
    assert.equal(
      templateRows[0].evidence.input_row_payload.processDataSet.processInformation.geography
        .locationOfOperationSupplyOrProduction["@location"],
      "Switzerland, source text",
    );

    const missingContextTask = runFoundry(
      [
        "dataset-location-decision-task-build",
        "--location-queue",
        rel(queue),
        "--schema-file",
        rel(schemaFile),
        "--yaml-file",
        rel(yamlFile),
        "--ruleset-file",
        rel(rulesetFile),
        "--out-dir",
        rel(path.join(fixtureRoot, "location-task-missing-context")),
      ],
      1,
    );
    assert.equal(missingContextTask.status, "blocked_missing_full_context");
    assert.equal(
      missingContextTask.blockers.some(
        (blocker) =>
          blocker.code === "location_decision_task_required_context_missing" &&
          blocker.kind === "classification_schema",
      ),
      true,
    );

    const chunkTaskDir = path.join(fixtureRoot, "location-task-chunk");
    const chunkTask = runFoundry([
      "dataset-location-decision-task-build",
      "--location-queue",
      rel(queue),
      "--limit",
      "1",
      "--chunk-label",
      "location-chunk",
      "--schema-file",
      rel(schemaFile),
      "--yaml-file",
      rel(yamlFile),
      "--ruleset-file",
      rel(rulesetFile),
      "--classification-schema",
      rel(classificationCategoryFile),
      "--location-schema",
      rel(locationCategoryFile),
      "--out-dir",
      rel(chunkTaskDir),
    ]);
    assert.equal(chunkTask.status, "ready_for_ai_location_decisions");
    assert.equal(chunkTask.counts.template_decisions, 1);
    assert.equal(chunkTask.selection.selected_queue_rows, 1);
    assert.equal(chunkTask.source_location_queue, rel(queue));
    assert.notEqual(chunkTask.location_queue, rel(queue));
    assert.match(
      chunkTask.commands.apply_decisions,
      /location-authoring-queue\.location-chunk\.jsonl/u,
    );
    const filteredQueue = readJsonLines(path.join(repoRoot, chunkTask.location_queue));
    assert.equal(filteredQueue.length, 1);
    assert.equal(filteredQueue[0].foundry_selection.source_queue_row_index, 0);
    assert.match(
      filteredQueue[0].location_workflow.commands.output_rows,
      /processes\.location-chunk\.located\.jsonl$/u,
    );
    assert.notEqual(filteredQueue[0].location_workflow.commands.output_rows, rel(processOut));

    writeJsonLines(decisions, [
      {
        dataset_id: processId,
        dataset_version: "00.00.001",
        category_type: "location",
        decision_status: "completed",
        code: "CH",
        target_path: locationPath,
        basis:
          "The source geography states Switzerland and the bundled TIDAS location schema contains CH for Switzerland.",
        authoring_context: templateRows[0].authoring_context,
        used_context_kinds: [
          "schema",
          "methodology_yaml",
          "ruleset",
          "classification_schema",
          "location_schema",
        ],
        evidence: {
          source: "location-authoring-queue",
          quote_or_trace: "Source geography is Switzerland.",
        },
      },
    ]);

    const apply = runFoundry([
      "dataset-location-decisions-apply",
      "--location-queue",
      rel(queue),
      "--decisions",
      rel(decisions),
      "--decision-task",
      task.files.task,
      "--out-dir",
      rel(applyDir),
    ]);
    assert.equal(apply.status, "completed");
    assert.equal(apply.counts.applied, 1);
    assert.equal(
      apply.decision_task.context_bundle_sha256,
      templateRows[0].authoring_context.context_bundle_sha256,
    );
    assert.deepEqual(apply.files.output_rows, [rel(processOut)]);
    assert.deepEqual(apply.files.input_rows, [rel(processRows)]);

    const locatedProcess = readJsonLines(processOut)[0];
    assert.equal(
      locatedProcess.processDataSet.processInformation.geography
        .locationOfOperationSupplyOrProduction["@location"],
      "CH",
    );

    writeJsonLines(decisions, [
      {
        dataset_id: processId,
        dataset_version: "00.00.001",
        category_type: "location",
        decision_status: "completed",
        code: "CH",
        target_path: locationPath,
        basis:
          "The source geography states Switzerland and the bundled TIDAS location schema contains CH for Switzerland.",
        used_context_kinds: [
          "schema",
          "methodology_yaml",
          "ruleset",
          "classification_schema",
          "location_schema",
        ],
        evidence: {
          source: "location-authoring-queue",
          quote_or_trace: "Source geography is Switzerland.",
        },
      },
    ]);
    const missingContextBundle = runFoundry(
      [
        "dataset-location-decisions-apply",
        "--location-queue",
        rel(queue),
        "--decisions",
        rel(decisions),
        "--decision-task",
        task.files.task,
        "--out-dir",
        rel(path.join(fixtureRoot, "location-apply-missing-context-bundle")),
      ],
      1,
    );
    assert.equal(missingContextBundle.status, "blocked");
    assert.equal(
      missingContextBundle.blockers.some(
        (blocker) => blocker.code === "location_decision_context_bundle_missing",
      ),
      true,
    );

    writeJsonLines(decisions, [
      {
        dataset_id: processId,
        dataset_version: "00.00.001",
        category_type: "location",
        code: "CH",
        target_path: locationPath,
        basis:
          "The source geography states Switzerland and the bundled TIDAS location schema contains CH for Switzerland.",
        authoring_context: templateRows[0].authoring_context,
        used_context_kinds: [
          "schema",
          "methodology_yaml",
          "ruleset",
          "classification_schema",
          "location_schema",
        ],
        evidence: {
          source: "location-authoring-queue",
          quote_or_trace: "Source geography is Switzerland.",
        },
      },
    ]);
    const missingDecisionStatus = runFoundry(
      [
        "dataset-location-decisions-apply",
        "--location-queue",
        rel(queue),
        "--decisions",
        rel(decisions),
        "--decision-task",
        task.files.task,
        "--out-dir",
        rel(path.join(fixtureRoot, "location-apply-missing-status")),
      ],
      1,
    );
    assert.equal(missingDecisionStatus.status, "blocked");
    assert.equal(
      missingDecisionStatus.blockers.some(
        (blocker) => blocker.code === "location_decision_status_not_completed",
      ),
      true,
    );

    writeJsonLines(decisions, [
      {
        dataset_id: processId,
        dataset_version: "00.00.001",
        category_type: "location",
        decision_status: "completed",
        code: "CH",
        basis: "Missing target path is intentionally invalid.",
        used_context_kinds: ["schema"],
        evidence: { source: "fixture" },
      },
    ]);
    const blocked = runFoundry(
      [
        "dataset-location-decisions-apply",
        "--location-queue",
        rel(queue),
        "--decisions",
        rel(decisions),
        "--out-dir",
        rel(path.join(fixtureRoot, "location-apply-blocked")),
      ],
      1,
    );
    assert.equal(blocked.status, "blocked");
    assert.equal(
      blocked.blockers.some((blocker) => blocker.code === "location_decision_target_path_missing"),
      true,
    );
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("location decisions suggest creates task-bound decisions for unique valid candidates", () => {
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
  const rowsDir = path.join(fixtureRoot, "rows-suggest");
  const processRows = path.join(rowsDir, "processes.jsonl");
  const queue = path.join(fixtureRoot, "location-authoring-queue.suggest.jsonl");
  const taskDir = path.join(fixtureRoot, "location-task-suggest");
  const suggestDir = path.join(fixtureRoot, "location-decisions-suggest");
  const contextDir = path.join(fixtureRoot, "context-suggest");
  const schemaFile = path.join(contextDir, "schema.json");
  const yamlFile = path.join(contextDir, "methodology.yaml");
  const rulesetFile = path.join(contextDir, "runtime-ruleset.json");
  const classificationCategoryFile = path.join(contextDir, "tidas_processes_category.json");
  const locationCategoryFile = path.join(contextDir, "tidas_locations_category.json");

  writeJsonLines(processRows, [processRow()]);
  writeJson(schemaFile, { title: "Fixture process schema" });
  fs.mkdirSync(contextDir, { recursive: true });
  fs.writeFileSync(yamlFile, "process:\n  geography: required\n");
  writeJson(rulesetFile, { rules: ["source-language-only"] });
  writeJson(classificationCategoryFile, { oneOf: [{ const: "A.1.1" }] });
  writeJson(locationCategoryFile, { oneOf: [{ const: "CH" }] });
  writeJsonLines(queue, [
    {
      dataset_type: "process",
      dataset_id: processId,
      dataset_version: "00.00.001",
      code: "location_code_requires_authoring",
      path: locationPath,
      current_location: null,
      suggested_location_code: "CH",
      source_file: "tmp/source/process.json",
      evidence: {
        source: "test",
        candidates: [{ code: "CH", evidence_source: "fixture" }],
      },
      location_workflow: {
        schema_type: "location",
        commands: {
          input_rows: rel(processRows),
          output_rows: rel(path.join(rowsDir, "processes.located.jsonl")),
        },
      },
    },
  ]);

  const task = runFoundry([
    "dataset-location-decision-task-build",
    "--location-queue",
    rel(queue),
    "--schema-file",
    rel(schemaFile),
    "--yaml-file",
    rel(yamlFile),
    "--ruleset-file",
    rel(rulesetFile),
    "--classification-schema",
    rel(classificationCategoryFile),
    "--location-schema",
    rel(locationCategoryFile),
    "--out-dir",
    rel(taskDir),
  ]);
  assert.equal(task.status, "ready_for_ai_location_decisions");

  const suggest = runFoundry([
    "dataset-location-decisions-suggest",
    "--location-queue",
    rel(queue),
    "--decision-task",
    task.files.task,
    "--location-schema",
    rel(locationCategoryFile),
    "--out-dir",
    rel(suggestDir),
  ]);
  assert.equal(suggest.status, "completed");
  assert.equal(suggest.counts.suggested_decisions, 1);
  assert.equal(suggest.counts.manual_review, 0);

  const decisions = readJsonLines(path.join(repoRoot, suggest.files.decisions));
  assert.equal(decisions[0].code, "CH");
  assert.equal(decisions[0].category_type, "location");
  assert.equal(decisions[0].decision_status, "completed");
  assert.equal(decisions[0].target_path, locationPath);
  assert.match(decisions[0].authoring_context.context_bundle_sha256, /^[a-f0-9]{64}$/u);
  assert.equal(decisions[0].authoring_context.context_bundle_sha256, task.context_bundle.sha256);
  assert.equal(decisions[0].used_context_kinds.includes("location_authoring_queue"), true);

  writeJsonLines(queue, [
    {
      dataset_type: "process",
      dataset_id: processId,
      dataset_version: "00.00.001",
      path: locationPath,
      suggested_location_code: "Invalid",
      location_workflow: {
        schema_type: "location",
        commands: {
          input_rows: rel(processRows),
          output_rows: rel(path.join(rowsDir, "processes.located.jsonl")),
        },
      },
    },
  ]);
  const blockedSuggest = runFoundry(
    [
      "dataset-location-decisions-suggest",
      "--location-queue",
      rel(queue),
      "--decision-task",
      task.files.task,
      "--location-schema",
      rel(locationCategoryFile),
      "--out-dir",
      rel(path.join(fixtureRoot, "location-decisions-suggest-blocked")),
    ],
    1,
  );
  assert.equal(blockedSuggest.status, "blocked");
  assert.equal(blockedSuggest.blockers[0].code, "location_suggestion_missing_or_invalid");
});

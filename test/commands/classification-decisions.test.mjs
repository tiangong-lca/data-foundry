import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const fixtureRoot = path.join(repoRoot, "tmp", "classification-decisions-test");
const processId = "11111111-2222-5333-8444-555555555555";
const flowId = "22222222-3333-5444-8555-666666666666";

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

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
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
  const result = spawnSync(process.execPath, ["scripts/foundry.ts", ...args], {
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
          name: { baseName: ml("Fava beans IP, at feed mill") },
          classificationInformation: {
            "common:classification": {
              "common:class": [
                {
                  "@level": "0",
                  "@classId": "S",
                  "#text": "Other service activities",
                },
              ],
            },
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

function productFlowRow() {
  return {
    flowDataSet: {
      flowInformation: {
        dataSetInformation: {
          "common:UUID": flowId,
          typeOfDataSet: "Product flow",
          name: { baseName: ml("Wheat grain") },
          classificationInformation: {
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

test("classification decision task and apply route AI choices through CLI classification apply", () => {
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
  const rowsDir = path.join(fixtureRoot, "rows");
  const processRows = path.join(rowsDir, "processes.jsonl");
  const flowRows = path.join(rowsDir, "flows.jsonl");
  const processOut = path.join(rowsDir, "processes.classified.jsonl");
  const flowOut = path.join(rowsDir, "flows.classified.jsonl");
  const queue = path.join(fixtureRoot, "classification-authoring-queue.jsonl");
  const decisions = path.join(fixtureRoot, "classification-decisions.jsonl");
  const taskDir = path.join(fixtureRoot, "classification-task");
  const applyDir = path.join(fixtureRoot, "classification-apply");
  const contextDir = path.join(fixtureRoot, "context");
  const schemaFile = path.join(contextDir, "schema.json");
  const yamlFile = path.join(contextDir, "methodology.yaml");
  const rulesetFile = path.join(contextDir, "runtime-ruleset.json");
  const processCategoryFile = path.join(contextDir, "tidas_processes_category.json");
  const locationCategoryFile = path.join(contextDir, "tidas_locations_category.json");

  try {
    writeJsonLines(processRows, [processRow()]);
    writeJsonLines(flowRows, [productFlowRow()]);
    writeJson(schemaFile, { title: "Fixture process schema" });
    fs.writeFileSync(yamlFile, "process:\n  required: true\n");
    writeJson(rulesetFile, { rules: ["source-language-only"] });
    writeJson(processCategoryFile, { oneOf: [{ const: "1080" }] });
    writeJson(locationCategoryFile, { oneOf: [{ const: "GLO" }] });
    writeJsonLines(queue, [
      {
        dataset_type: "process",
        dataset_id: processId,
        dataset_version: "00.00.001",
        code: "process_classification_requires_authoring",
        current_classification: "Other service activities",
        source_classification: { category: "agriculture", subCategory: "feed" },
        classification_workflow: {
          schema_type: "process",
          row_type: "process",
          commands: {
            input_rows: rel(processRows),
            output_rows: rel(processOut),
          },
        },
      },
      {
        dataset_type: "flow",
        dataset_id: flowId,
        dataset_version: "00.00.001",
        code: "flow_classification_requires_authoring",
        current_classification: "Community, social and personal services",
        source_classification: { category: "agriculture", subCategory: "wheat" },
        classification_workflow: {
          schema_type: "flow-product",
          row_type: "flow",
          commands: {
            input_rows: rel(flowRows),
            output_rows: rel(flowOut),
          },
        },
      },
    ]);

    const task = runFoundry([
      "dataset-classification-decision-task-build",
      "--classification-queue",
      rel(queue),
      "--schema-file",
      rel(schemaFile),
      "--yaml-file",
      rel(yamlFile),
      "--ruleset-file",
      rel(rulesetFile),
      "--classification-schema",
      rel(processCategoryFile),
      "--location-schema",
      rel(locationCategoryFile),
      "--out-dir",
      rel(taskDir),
    ]);
    assert.equal(task.status, "ready_for_ai_classification_decisions");
    assert.equal(task.counts.template_decisions, 2);
    assert.equal(task.counts.contract_context_files, 5);
    assert.equal(task.counts.blockers, 0);
    assert.equal(task.counts.attached_input_rows, 2);
    assert.equal(task.contract_context_files[0].kind, "schema");
    const sharedBundle = readJson(path.join(repoRoot, task.files.shared_context_bundle));
    assert.match(sharedBundle.files[1].text, /process:/u);
    assert.equal(task.classification_queue_rows.length, 2);
    assert.equal(
      task.attached_input_rows[0].payload.processDataSet.processInformation.dataSetInformation.name
        .baseName["#text"],
      "Fava beans IP, at feed mill",
    );
    assert.match(task.commands.apply_decisions, /dataset-classification-decisions-apply/u);
    const templateRows = readJsonLines(path.join(repoRoot, task.files.template));
    assert.equal(templateRows[0].decision_status, "completed");
    assert.equal(templateRows[0].code, "__AI_SELECT_TIDAS_CLASSIFICATION_CODE__");
    assert.match(templateRows[0].authoring_context.context_bundle_sha256, /^[a-f0-9]{64}$/u);
    assert.equal(
      templateRows[0].evidence.input_row_payload.processDataSet.processInformation
        .dataSetInformation.name.baseName["#text"],
      "Fava beans IP, at feed mill",
    );

    const missingContextTask = runFoundry(
      [
        "dataset-classification-decision-task-build",
        "--classification-queue",
        rel(queue),
        "--schema-file",
        rel(schemaFile),
        "--yaml-file",
        rel(yamlFile),
        "--ruleset-file",
        rel(rulesetFile),
        "--classification-schema",
        rel(processCategoryFile),
        "--out-dir",
        rel(path.join(fixtureRoot, "classification-task-missing-context")),
      ],
      1,
    );
    assert.equal(missingContextTask.status, "blocked_missing_full_context");
    assert.equal(
      missingContextTask.blockers.some(
        (blocker) =>
          blocker.code === "classification_decision_task_required_context_missing" &&
          blocker.kind === "location_schema",
      ),
      true,
    );

    writeJsonLines(decisions, [
      {
        dataset_id: processId,
        dataset_version: "00.00.001",
        category_type: "process",
        decision_status: "completed",
        code: "1080",
        basis: "The source process is a feed mill activity.",
        authoring_context: templateRows[0].authoring_context,
        used_context_kinds: [
          "schema",
          "methodology_yaml",
          "ruleset",
          "classification_schema",
          "location_schema",
        ],
        evidence: {
          source: "classification-authoring-queue",
          quote_or_trace: "process baseName Fava beans IP, at feed mill",
        },
      },
      {
        dataset_id: flowId,
        dataset_version: "00.00.001",
        category_type: "flow-product",
        decision_status: "completed",
        code: "0111",
        basis: "The source flow is wheat grain.",
        authoring_context: templateRows[1].authoring_context,
        used_context_kinds: [
          "schema",
          "methodology_yaml",
          "ruleset",
          "classification_schema",
          "location_schema",
        ],
        evidence: {
          source: "classification-authoring-queue",
          quote_or_trace: "flow baseName Wheat grain",
        },
      },
    ]);

    const apply = runFoundry([
      "dataset-classification-decisions-apply",
      "--classification-queue",
      rel(queue),
      "--decisions",
      rel(decisions),
      "--decision-task",
      task.files.task,
      "--out-dir",
      rel(applyDir),
    ]);
    assert.equal(apply.status, "completed");
    assert.equal(apply.counts.stages, 2);
    assert.equal(apply.counts.applied, 2);
    assert.equal(
      apply.decision_task.context_bundle_sha256,
      templateRows[0].authoring_context.context_bundle_sha256,
    );
    assert.deepEqual(apply.files.output_rows.sort(), [rel(flowOut), rel(processOut)].sort());

    const classifiedProcess = readJsonLines(processOut)[0];
    const processClasses =
      classifiedProcess.processDataSet.processInformation.dataSetInformation
        .classificationInformation["common:classification"]["common:class"];
    assert.equal(processClasses.at(-1)["@classId"], "1080");
    assert.equal(processClasses.at(-1)["#text"], "Manufacture of prepared animal feeds");

    const classifiedFlow = readJsonLines(flowOut)[0];
    const flowClasses =
      classifiedFlow.flowDataSet.flowInformation.dataSetInformation.classificationInformation[
        "common:classification"
      ]["common:class"];
    assert.equal(flowClasses.at(-1)["@classId"], "0111");
    assert.equal(flowClasses.at(-1)["#text"], "Wheat");

    const chunkTaskDir = path.join(fixtureRoot, "classification-task-flow-chunk");
    const chunkDecisions = path.join(chunkTaskDir, "classification-decisions.jsonl");
    const chunkApplyDir = path.join(fixtureRoot, "classification-apply-flow-chunk");
    const chunkTask = runFoundry([
      "dataset-classification-decision-task-build",
      "--classification-queue",
      rel(queue),
      "--dataset-type",
      "flow",
      "--limit",
      "1",
      "--chunk-label",
      "flow-chunk",
      "--schema-file",
      rel(schemaFile),
      "--yaml-file",
      rel(yamlFile),
      "--ruleset-file",
      rel(rulesetFile),
      "--classification-schema",
      rel(processCategoryFile),
      "--location-schema",
      rel(locationCategoryFile),
      "--out-dir",
      rel(chunkTaskDir),
    ]);
    assert.equal(chunkTask.status, "ready_for_ai_classification_decisions");
    assert.equal(chunkTask.counts.template_decisions, 1);
    assert.equal(chunkTask.selection.selected_queue_rows, 1);
    assert.equal(chunkTask.source_classification_queue, rel(queue));
    assert.notEqual(chunkTask.classification_queue, rel(queue));
    assert.match(
      chunkTask.commands.apply_decisions,
      /classification-authoring-queue\.flow-chunk\.jsonl/u,
    );
    const filteredQueue = readJsonLines(path.join(repoRoot, chunkTask.classification_queue));
    assert.equal(filteredQueue.length, 1);
    assert.equal(filteredQueue[0].dataset_type, "flow");
    assert.equal(filteredQueue[0].foundry_selection.source_queue_row_index, 1);
    assert.match(
      filteredQueue[0].classification_workflow.commands.output_rows,
      /flows\.flow-chunk\.classified\.jsonl$/u,
    );
    assert.notEqual(filteredQueue[0].classification_workflow.commands.output_rows, rel(flowOut));
    const chunkTemplateRows = readJsonLines(path.join(repoRoot, chunkTask.files.template));
    writeJsonLines(chunkDecisions, [
      {
        dataset_id: flowId,
        dataset_version: "00.00.001",
        category_type: "flow-product",
        decision_status: "completed",
        code: "0111",
        basis: "The selected chunk contains only the wheat grain product flow.",
        authoring_context: chunkTemplateRows[0].authoring_context,
        used_context_kinds: [
          "schema",
          "methodology_yaml",
          "ruleset",
          "classification_schema",
          "location_schema",
        ],
        evidence: {
          source: "classification-authoring-queue",
          quote_or_trace: "flow baseName Wheat grain",
        },
      },
    ]);
    const chunkApply = runFoundry([
      "dataset-classification-decisions-apply",
      "--classification-queue",
      chunkTask.classification_queue,
      "--decisions",
      rel(chunkDecisions),
      "--decision-task",
      chunkTask.files.task,
      "--out-dir",
      rel(chunkApplyDir),
    ]);
    assert.equal(chunkApply.status, "completed");
    assert.deepEqual(chunkApply.files.output_rows, [
      filteredQueue[0].classification_workflow.commands.output_rows,
    ]);

    const processChunkTaskDir = path.join(fixtureRoot, "classification-task-process-chunk");
    const processChunkTask = runFoundry([
      "dataset-classification-decision-task-build",
      "--classification-queue",
      rel(queue),
      "--dataset-type",
      "process",
      "--limit",
      "1",
      "--chunk-label",
      "process-chunk",
      "--schema-file",
      rel(schemaFile),
      "--yaml-file",
      rel(yamlFile),
      "--ruleset-file",
      rel(rulesetFile),
      "--classification-schema",
      rel(processCategoryFile),
      "--location-schema",
      rel(locationCategoryFile),
      "--out-dir",
      rel(processChunkTaskDir),
    ]);
    const processChunkTemplateRows = readJsonLines(
      path.join(repoRoot, processChunkTask.files.template),
    );
    assert.equal(processChunkTask.selection.selected_queue_rows, 1);
    assert.equal(processChunkTask.source_classification_queue, rel(queue));
    assert.notEqual(processChunkTemplateRows[0].authoring_context.context_bundle_sha256, "");

    const multiTaskDecisions = path.join(fixtureRoot, "classification-decisions.multi-task.jsonl");
    writeJsonLines(multiTaskDecisions, [
      {
        dataset_id: processId,
        dataset_version: "00.00.001",
        category_type: "process",
        decision_status: "completed",
        code: "1080",
        basis:
          "The process chunk contains the feed mill process and the process category schema maps it to prepared animal feeds.",
        authoring_context: processChunkTemplateRows[0].authoring_context,
        used_context_kinds: [
          "schema",
          "methodology_yaml",
          "ruleset",
          "classification_schema",
          "location_schema",
        ],
        evidence: {
          source: "classification-authoring-queue.process-chunk",
          quote_or_trace: "process baseName Fava beans IP, at feed mill",
        },
      },
      {
        dataset_id: flowId,
        dataset_version: "00.00.001",
        category_type: "flow-product",
        decision_status: "completed",
        code: "0111",
        basis:
          "The flow chunk contains the wheat grain product flow and the product-flow schema maps it to wheat.",
        authoring_context: chunkTemplateRows[0].authoring_context,
        used_context_kinds: [
          "schema",
          "methodology_yaml",
          "ruleset",
          "classification_schema",
          "location_schema",
        ],
        evidence: {
          source: "classification-authoring-queue.flow-chunk",
          quote_or_trace: "flow baseName Wheat grain",
        },
      },
    ]);
    const multiTaskApply = runFoundry([
      "dataset-classification-decisions-apply",
      "--classification-queue",
      rel(queue),
      "--decisions",
      rel(multiTaskDecisions),
      "--decision-task",
      processChunkTask.files.task,
      "--decision-task",
      chunkTask.files.task,
      "--out-dir",
      rel(path.join(fixtureRoot, "classification-apply-multi-task")),
    ]);
    assert.equal(multiTaskApply.status, "completed");
    assert.equal(multiTaskApply.decision_task, null);
    assert.equal(multiTaskApply.decision_tasks.length, 2);
    assert.deepEqual(
      multiTaskApply.decision_tasks.map((decisionTask) => decisionTask.source_queue).sort(),
      [rel(queue), rel(queue)].sort(),
    );
    assert.deepEqual(
      multiTaskApply.files.output_rows.sort(),
      [rel(flowOut), rel(processOut)].sort(),
    );
    writeJsonLines(decisions, [
      {
        dataset_id: processId,
        dataset_version: "00.00.001",
        category_type: "process",
        decision_status: "completed",
        code: "1080",
        basis: "The source process is a feed mill activity.",
        used_context_kinds: [
          "schema",
          "methodology_yaml",
          "ruleset",
          "classification_schema",
          "location_schema",
        ],
        evidence: {
          source: "classification-authoring-queue",
          quote_or_trace: "process baseName Fava beans IP, at feed mill",
        },
      },
      {
        dataset_id: flowId,
        dataset_version: "00.00.001",
        category_type: "flow-product",
        decision_status: "completed",
        code: "0111",
        basis: "The source flow is wheat grain.",
        used_context_kinds: [
          "schema",
          "methodology_yaml",
          "ruleset",
          "classification_schema",
          "location_schema",
        ],
        evidence: {
          source: "classification-authoring-queue",
          quote_or_trace: "flow baseName Wheat grain",
        },
      },
    ]);
    const missingContextBundle = runFoundry(
      [
        "dataset-classification-decisions-apply",
        "--classification-queue",
        rel(queue),
        "--decisions",
        rel(decisions),
        "--decision-task",
        task.files.task,
        "--out-dir",
        rel(path.join(fixtureRoot, "classification-apply-missing-context-bundle")),
      ],
      1,
    );
    assert.equal(missingContextBundle.status, "blocked");
    assert.equal(
      missingContextBundle.blockers.some(
        (blocker) => blocker.code === "classification_decision_context_bundle_missing",
      ),
      true,
    );

    writeJsonLines(decisions, [
      {
        dataset_id: processId,
        dataset_version: "00.00.001",
        category_type: "process",
        code: "1080",
        basis: "The source process is a feed mill activity.",
        authoring_context: templateRows[0].authoring_context,
        used_context_kinds: [
          "schema",
          "methodology_yaml",
          "ruleset",
          "classification_schema",
          "location_schema",
        ],
        evidence: {
          source: "classification-authoring-queue",
          quote_or_trace: "process baseName Fava beans IP, at feed mill",
        },
      },
      {
        dataset_id: flowId,
        dataset_version: "00.00.001",
        category_type: "flow-product",
        decision_status: "completed",
        code: "0111",
        basis: "The source flow is wheat grain.",
        authoring_context: templateRows[1].authoring_context,
        used_context_kinds: [
          "schema",
          "methodology_yaml",
          "ruleset",
          "classification_schema",
          "location_schema",
        ],
        evidence: {
          source: "classification-authoring-queue",
          quote_or_trace: "flow baseName Wheat grain",
        },
      },
    ]);
    const missingDecisionStatus = runFoundry(
      [
        "dataset-classification-decisions-apply",
        "--classification-queue",
        rel(queue),
        "--decisions",
        rel(decisions),
        "--decision-task",
        task.files.task,
        "--out-dir",
        rel(path.join(fixtureRoot, "classification-apply-missing-status")),
      ],
      1,
    );
    assert.equal(missingDecisionStatus.status, "blocked");
    assert.equal(
      missingDecisionStatus.blockers.some(
        (blocker) => blocker.code === "classification_decision_status_not_completed",
      ),
      true,
    );

    writeJsonLines(decisions, [
      {
        dataset_id: processId,
        dataset_version: "00.00.001",
        category_type: "process",
        decision_status: "completed",
        code: "1080",
        basis: "Only one decision is intentionally present.",
        used_context_kinds: ["schema"],
        evidence: { source: "fixture" },
      },
    ]);
    const blocked = runFoundry(
      [
        "dataset-classification-decisions-apply",
        "--classification-queue",
        rel(queue),
        "--decisions",
        rel(decisions),
        "--out-dir",
        rel(path.join(fixtureRoot, "classification-apply-blocked")),
      ],
      1,
    );
    assert.equal(blocked.status, "blocked");
    assert.equal(
      blocked.blockers.some((blocker) => blocker.code === "classification_queue_item_unclosed"),
      true,
    );
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("library classification decisions project into task-bound apply decisions", () => {
  const root = path.join(repoRoot, "tmp", "classification-library-projection-test");
  fs.rmSync(root, { recursive: true, force: true });
  const rowsDir = path.join(root, "rows");
  const processRows = path.join(rowsDir, "processes.jsonl");
  const processOut = path.join(rowsDir, "processes.classified.jsonl");
  const queue = path.join(root, "classification-authoring-queue.jsonl");
  const libraryDecisions = path.join(root, "library-classification-decisions.jsonl");
  const taskDir = path.join(root, "classification-task");
  const projectionDir = path.join(root, "projection");
  const applyDir = path.join(root, "classification-apply");
  const contextDir = path.join(root, "context");
  const schemaFile = path.join(contextDir, "schema.json");
  const yamlFile = path.join(contextDir, "methodology.yaml");
  const rulesetFile = path.join(contextDir, "runtime-ruleset.json");
  const processCategoryFile = path.join(contextDir, "tidas_processes_category.json");
  const locationCategoryFile = path.join(contextDir, "tidas_locations_category.json");

  try {
    writeJsonLines(processRows, [processRow()]);
    writeJson(schemaFile, { title: "Fixture process schema" });
    fs.writeFileSync(yamlFile, "process:\n  required: true\n");
    writeJson(rulesetFile, { rules: ["source-language-only"] });
    writeJson(processCategoryFile, { oneOf: [{ const: "1080" }] });
    writeJson(locationCategoryFile, { oneOf: [{ const: "GLO" }] });
    writeJsonLines(queue, [
      {
        dataset_type: "process",
        dataset_id: processId,
        dataset_version: "00.00.001",
        code: "process_classification_requires_authoring",
        current_classification: "Other service activities",
        source_classification: { category: "agriculture", subCategory: "feed" },
        authoring_context: { source_name: "Fava beans IP, at feed mill" },
        classification_workflow: {
          schema_type: "process",
          row_type: "process",
          commands: {
            input_rows: rel(processRows),
            output_rows: rel(processOut),
          },
        },
      },
    ]);
    writeJsonLines(libraryDecisions, [
      {
        dataset_type: "process",
        dataset_id: processId,
        dataset_version: "00.00.001",
        category_type: "process",
        selected_code: "1080",
        decision_status: "completed",
        basis: "Library-level semantic decision: the process is prepared animal feed manufacture.",
        confidence: "high",
      },
    ]);

    const task = runFoundry([
      "dataset-classification-decision-task-build",
      "--classification-queue",
      rel(queue),
      "--schema-file",
      rel(schemaFile),
      "--yaml-file",
      rel(yamlFile),
      "--ruleset-file",
      rel(rulesetFile),
      "--classification-schema",
      rel(processCategoryFile),
      "--location-schema",
      rel(locationCategoryFile),
      "--out-dir",
      rel(taskDir),
    ]);
    assert.equal(task.status, "ready_for_ai_classification_decisions");

    const projection = runFoundry([
      "dataset-library-classification-decisions-project",
      "--classification-queue",
      rel(queue),
      "--library-decisions",
      rel(libraryDecisions),
      "--decision-task",
      task.files.task,
      "--out-dir",
      rel(projectionDir),
    ]);
    assert.equal(projection.status, "completed");
    assert.equal(projection.counts.projected_decisions, 1);
    const projectedDecisions = readJsonLines(path.join(repoRoot, projection.files.decisions));
    assert.equal(projectedDecisions[0].code, "1080");
    assert.equal(projectedDecisions[0].decision_status, "completed");
    assert.equal(
      projectedDecisions[0].authoring_context.context_bundle_sha256,
      task.context_bundle.sha256,
    );
    assert.deepEqual(projectedDecisions[0].used_context_kinds.sort(), [
      "classification_schema",
      "location_schema",
      "methodology_yaml",
      "ruleset",
      "schema",
    ]);

    const apply = runFoundry([
      "dataset-classification-decisions-apply",
      "--classification-queue",
      rel(queue),
      "--decisions",
      projection.files.decisions,
      "--decision-task",
      task.files.task,
      "--out-dir",
      rel(applyDir),
    ]);
    assert.equal(apply.status, "completed");
    assert.deepEqual(apply.files.output_rows, [rel(processOut)]);

    writeJsonLines(libraryDecisions, [
      {
        dataset_type: "process",
        dataset_id: processId,
        dataset_version: "00.00.001",
        category_type: "process",
        selected_code: "D",
        decision_status: "completed",
        classification_decision_level: "broad_section",
        basis: "Only a broad section was selected.",
        confidence: "high",
      },
    ]);
    const broadProjection = runFoundry(
      [
        "dataset-library-classification-decisions-project",
        "--classification-queue",
        rel(queue),
        "--library-decisions",
        rel(libraryDecisions),
        "--decision-task",
        task.files.task,
        "--out-dir",
        rel(path.join(root, "projection-broad")),
      ],
      1,
    );
    assert.equal(broadProjection.status, "blocked");
    assert.equal(broadProjection.counts.manual_review, 1);
    assert.equal(broadProjection.blockers[0].code, "library_classification_decision_not_leaf");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("library classification projection blocks broad flow-product decisions", () => {
  const root = path.join(repoRoot, "tmp", "classification-library-flow-broad-test");
  fs.rmSync(root, { recursive: true, force: true });
  const rowsDir = path.join(root, "rows");
  const flowRows = path.join(rowsDir, "flows.jsonl");
  const flowOut = path.join(rowsDir, "flows.classified.jsonl");
  const queue = path.join(root, "classification-authoring-queue.jsonl");
  const libraryDecisions = path.join(root, "library-classification-decisions.jsonl");
  const taskDir = path.join(root, "classification-task");
  const contextDir = path.join(root, "context");
  const schemaFile = path.join(contextDir, "schema.json");
  const yamlFile = path.join(contextDir, "methodology.yaml");
  const rulesetFile = path.join(contextDir, "runtime-ruleset.json");
  const flowProductCategoryFile = path.join(contextDir, "tidas_flows_product_category.json");
  const locationCategoryFile = path.join(contextDir, "tidas_locations_category.json");

  try {
    writeJsonLines(flowRows, [productFlowRow()]);
    writeJson(schemaFile, { title: "Fixture flow schema" });
    fs.writeFileSync(yamlFile, "flow:\n  required: true\n");
    writeJson(rulesetFile, { rules: ["source-language-only"] });
    writeJson(flowProductCategoryFile, { oneOf: [{ const: "39380" }] });
    writeJson(locationCategoryFile, { oneOf: [{ const: "GLO" }] });
    writeJsonLines(queue, [
      {
        dataset_type: "flow",
        dataset_id: flowId,
        dataset_version: "00.00.001",
        code: "flow_classification_requires_authoring",
        current_classification: "Community, social and personal services",
        source_classification: { category: "electronics waste" },
        authoring_context: { source_name: "Disposal, Li-ions batteries, mixed technology" },
        classification_workflow: {
          schema_type: "flow-product",
          row_type: "flow",
          commands: {
            input_rows: rel(flowRows),
            output_rows: rel(flowOut),
          },
        },
      },
    ]);
    writeJsonLines(libraryDecisions, [
      {
        dataset_type: "flow",
        dataset_id: flowId,
        dataset_version: "00.00.001",
        category_type: "flow-product",
        selected_code: "9",
        decision_status: "completed",
        classification_decision_level: "broad_section",
        basis: "Only a broad product-flow section was selected.",
        confidence: "high",
      },
    ]);

    const task = runFoundry([
      "dataset-classification-decision-task-build",
      "--classification-queue",
      rel(queue),
      "--schema-file",
      rel(schemaFile),
      "--yaml-file",
      rel(yamlFile),
      "--ruleset-file",
      rel(rulesetFile),
      "--classification-schema",
      rel(flowProductCategoryFile),
      "--location-schema",
      rel(locationCategoryFile),
      "--out-dir",
      rel(taskDir),
    ]);
    assert.equal(task.status, "ready_for_ai_classification_decisions");

    const broadProjection = runFoundry(
      [
        "dataset-library-classification-decisions-project",
        "--classification-queue",
        rel(queue),
        "--library-decisions",
        rel(libraryDecisions),
        "--decision-task",
        task.files.task,
        "--out-dir",
        rel(path.join(root, "projection-broad")),
      ],
      1,
    );
    assert.equal(broadProjection.status, "blocked");
    assert.equal(broadProjection.counts.manual_review, 1);
    assert.equal(broadProjection.blockers[0].code, "library_classification_decision_not_leaf");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

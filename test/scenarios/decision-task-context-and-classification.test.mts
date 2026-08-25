import test from "node:test";
import { classificationFixtureRoot, fixtureRoot } from "../fixtures/fixture-roots.ts";
import {
  assert,
  fs,
  path,
  readJson,
  rel,
  repoRoot,
  runFoundry,
  writeJson,
  writeJsonLines,
  writeText,
} from "../fixtures/foundry-core.ts";
import { writeContextPackFiles } from "../fixtures/full-context-fixtures.ts";
import {
  processRowWithDefaultClassification,
  processRowWithInvalidLocation,
} from "../fixtures/row-builders.ts";

test("decision tasks externalize full context into stable shared bundles", () => {
  const root = path.join(fixtureRoot, "decision-task-shared-context");
  fs.rmSync(root, { recursive: true, force: true });
  const processId = "33333333-3333-4333-8333-333333333333";
  const rowsFile = path.join(root, "rows", "processes.jsonl");
  writeJsonLines(rowsFile, [processRowWithInvalidLocation(processId)]);
  const classificationQueue = path.join(root, "classification-authoring-queue.jsonl");
  const locationQueue = path.join(root, "location-authoring-queue.jsonl");
  writeJsonLines(classificationQueue, [
    {
      dataset_type: "process",
      dataset_id: processId,
      dataset_version: "00.00.001",
      classification_workflow: {
        schema_type: "process",
        row_type: "process",
        commands: {
          input_rows: rel(rowsFile),
          output_rows: rel(path.join(root, "rows", "processes.classified.jsonl")),
        },
      },
    },
  ]);
  writeJsonLines(locationQueue, [
    {
      dataset_type: "process",
      dataset_id: processId,
      dataset_version: "00.00.001",
      path: "processDataSet.processInformation.geography.locationOfOperationSupplyOrProduction.@location",
      location_workflow: {
        schema_type: "location",
        commands: {
          input_rows: rel(rowsFile),
          output_rows: rel(path.join(root, "rows", "processes.located.jsonl")),
        },
      },
    },
  ]);
  const context = writeContextPackFiles(root);
  const classificationSchema = path.join(root, "context", "tidas_processes_category.json");
  const locationSchema = path.join(root, "context", "tidas_locations_category.json");
  writeText(
    classificationSchema,
    '{"categories":[{"code":"1080","name":"Fixture process category"}]}\n',
  );
  writeText(locationSchema, '{"locations":[{"code":"CH","name":"Switzerland"}]}\n');
  const sharedContextCacheDir = path.join(root, "shared-context-cache");

  try {
    const buildClassification = (outDir: string) =>
      runFoundry([
        "dataset-classification-decision-task-build",
        "--classification-queue",
        rel(classificationQueue),
        "--schema-file",
        rel(context.schemaFile),
        "--yaml-file",
        rel(context.yamlFile),
        "--ruleset-file",
        rel(context.rulesetFile),
        "--classification-schema",
        rel(classificationSchema),
        "--location-schema",
        rel(locationSchema),
        "--limit",
        "1",
        "--chunk-label",
        "stable-test",
        "--shared-context-cache-dir",
        rel(sharedContextCacheDir),
        "--out-dir",
        rel(path.join(root, outDir)),
      ]);
    const firstClassification = buildClassification("classification-task-a");
    const secondClassification = buildClassification("classification-task-b");
    assert.equal(firstClassification.code, 0, JSON.stringify(firstClassification.json, null, 2));
    assert.equal(firstClassification.json.status, "ready_for_ai_classification_decisions");
    assert.equal(
      firstClassification.json.context_bundle.sha256,
      secondClassification.json.context_bundle.sha256,
    );
    assert.notEqual(
      firstClassification.json.context_bundle.task,
      secondClassification.json.context_bundle.task,
    );
    assert.ok(firstClassification.json.files.shared_context_bundle);
    assert.equal(
      firstClassification.json.shared_context_bundle.path,
      firstClassification.json.files.shared_context_bundle,
    );
    assert.equal(
      firstClassification.json.files.shared_context_bundle,
      secondClassification.json.files.shared_context_bundle,
    );
    assert.equal(firstClassification.json.shared_context_bundle.cache.enabled, true);
    assert.equal(firstClassification.json.shared_context_bundle.cache.reused, false);
    assert.equal(secondClassification.json.shared_context_bundle.cache.reused, true);
    assert.equal(
      firstClassification.json.contract_context_files.some((file) => Object.hasOwn(file, "text")),
      false,
    );
    const classificationBundle = readJson(
      path.join(repoRoot, firstClassification.json.files.shared_context_bundle),
    );
    assert.equal(
      classificationBundle.sha256,
      firstClassification.json.shared_context_bundle.sha256,
    );
    assert.equal(classificationBundle.counts.duplicate_context_bytes_avoided, 0);
    assert.match(
      classificationBundle.files.find((file) => file.kind === "schema")!.text,
      /process schema/u,
    );
    assert.match(
      classificationBundle.files.find((file) => file.kind === "classification_schema")!.text,
      /Fixture process category/u,
    );

    const buildLocation = (outDir: string) =>
      runFoundry([
        "dataset-location-decision-task-build",
        "--location-queue",
        rel(locationQueue),
        "--schema-file",
        rel(context.schemaFile),
        "--yaml-file",
        rel(context.yamlFile),
        "--ruleset-file",
        rel(context.rulesetFile),
        "--classification-schema",
        rel(classificationSchema),
        "--location-schema",
        rel(locationSchema),
        "--limit",
        "1",
        "--chunk-label",
        "stable-test",
        "--shared-context-cache-dir",
        rel(sharedContextCacheDir),
        "--out-dir",
        rel(path.join(root, outDir)),
      ]);
    const firstLocation = buildLocation("location-task-a");
    const secondLocation = buildLocation("location-task-b");
    assert.equal(firstLocation.code, 0, JSON.stringify(firstLocation.json, null, 2));
    assert.equal(firstLocation.json.status, "ready_for_ai_location_decisions");
    assert.equal(
      firstLocation.json.context_bundle.sha256,
      secondLocation.json.context_bundle.sha256,
    );
    assert.equal(
      firstLocation.json.files.shared_context_bundle,
      secondLocation.json.files.shared_context_bundle,
    );
    assert.equal(firstLocation.json.shared_context_bundle.cache.enabled, true);
    assert.equal(secondLocation.json.shared_context_bundle.cache.reused, true);
    assert.equal(
      firstLocation.json.contract_context_files.some((file) => Object.hasOwn(file, "text")),
      false,
    );
    const locationBundle = readJson(
      path.join(repoRoot, firstLocation.json.files.shared_context_bundle),
    );
    assert.match(
      locationBundle.files.find((file) => file.kind === "location_schema")!.text,
      /Switzerland/u,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("authoring plan propagates shared context cache to decision chunks", () => {
  const root = path.join(fixtureRoot, "authoring-plan-shared-context-cache");
  fs.rmSync(root, { recursive: true, force: true });
  const context = writeContextPackFiles(root);
  const classificationSchema = path.join(root, "context", "tidas_processes_category.json");
  const locationSchema = path.join(root, "context", "tidas_locations_category.json");
  writeText(classificationSchema, '{"categories":[]}\n');
  writeText(locationSchema, '{"locations":[]}\n');
  const classificationQueue = path.join(root, "classification-authoring-queue.jsonl");
  const queueRows = [
    {
      dataset_type: "process",
      dataset_id: "44444444-4444-4444-8444-444444444444",
      dataset_version: "00.00.001",
      classification_workflow: {
        schema_type: "process",
      },
    },
    {
      dataset_type: "process",
      dataset_id: "55555555-5555-4555-8555-555555555555",
      dataset_version: "00.00.001",
      classification_workflow: {
        schema_type: "process",
      },
    },
  ];
  writeJsonLines(classificationQueue, queueRows);
  const curationGateReport = path.join(root, "curation-gate", "dataset-curation-gate-report.json");
  const contextDetails = [
    { kind: "schema", path: rel(context.schemaFile) },
    { kind: "methodology_yaml", path: rel(context.yamlFile) },
    { kind: "ruleset", path: rel(context.rulesetFile) },
    { kind: "classification_schema", path: rel(classificationSchema) },
    { kind: "location_schema", path: rel(locationSchema) },
  ];
  writeJson(curationGateReport, {
    schema_version: 2,
    status: "blocked_needs_foundry_ai_authoring",
    profile: "bafu",
    dataset_type: "process",
    rows_file: rel(path.join(root, "rows", "processes.jsonl")),
    counts: {
      action_items: 2,
      classification_queue_action_items: 2,
    },
    context: {
      contract_context_file_details: contextDetails,
      classification_queue: {
        queue_file: rel(classificationQueue),
        rows: 2,
      },
    },
  });
  const classificationTask = path.join(
    root,
    "classification-decision-task",
    "classification-decision-task.json",
  );
  writeJson(classificationTask, {
    schema_version: 1,
    status: "ready_for_ai_classification_decisions",
    task_kind: "classification_decision_authoring",
    classification_queue: rel(classificationQueue),
    classification_queue_rows: queueRows,
  });

  try {
    const plan = runFoundry([
      "dataset-authoring-plan",
      "--curation-gate-report",
      rel(curationGateReport),
      "--classification-chunk-size",
      "1",
      "--out-dir",
      rel(path.join(root, "authoring-plan")),
    ]);
    assert.equal(plan.code, 0, JSON.stringify(plan.json, null, 2));
    const expectedCacheDir = rel(path.join(root, "shared-context-cache"));
    assert.equal(plan.json.context.shared_context_cache_dir, expectedCacheDir);
    const classificationPhase = plan.json.phases.find(
      (phase) => phase.phase === "classification_decisions",
    )!;
    assert.match(classificationPhase.commands.build_task!, /--shared-context-cache-dir/u);
    const chunkCommands = classificationPhase.chunk_plan.commands;
    assert.equal(chunkCommands.length, 2);
    assert.equal(
      chunkCommands.every((command) => command.command.includes("--shared-context-cache-dir")),
      true,
    );
    assert.equal(
      chunkCommands.every((command) => command.command.includes(expectedCacheDir)),
      true,
    );
    const patchPhase = plan.json.phases.find((phase) => phase.phase === "field_patches")!;
    assert.match(patchPhase.commands.build_task!, /--shared-context-cache-dir/u);
    assert.match(
      patchPhase.commands.build_task!.replaceAll("\\", "/"),
      new RegExp(expectedCacheDir, "u"),
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("curation gate attaches classification queue context as a concrete AI action item", () => {
  fs.rmSync(classificationFixtureRoot, { recursive: true, force: true });
  const processId = "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff";
  const rowsFile = path.join(classificationFixtureRoot, "rows", "processes.jsonl");
  writeJsonLines(rowsFile, [processRowWithDefaultClassification(processId)]);
  const schemaReport = path.join(classificationFixtureRoot, "schema", "validation-report.json");
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
  const qaReport = path.join(classificationFixtureRoot, "qa", "process-qa-report.json");
  writeJson(qaReport, {
    rows_file: rel(rowsFile),
    status: "completed",
    blockers: [],
    findings: [],
  });
  const classificationQueue = path.join(
    classificationFixtureRoot,
    "classification-authoring-queue.jsonl",
  );
  writeJsonLines(classificationQueue, [
    {
      dataset_type: "process",
      dataset_id: processId,
      dataset_version: "00.00.001",
      code: "process_classification_requires_authoring",
      current_classification:
        "Other service activities > Activities of membership organizations > Activities of other membership organizations > Activities of other membership organizations n.e.c.",
      source_classification: {
        category: "heat",
        subCategory: "gas",
      },
      authoring_context: {
        source_name: "Heat, from natural gas {GR}",
        source_location: "GR",
        source_unit: "MJ",
      },
      classification_workflow: {
        schema_type: "process",
        commands: {
          children_root: "tiangong-lca dataset classification children --type process",
          apply: "tiangong-lca dataset classification apply --type process",
        },
      },
      required_resolution:
        "Replace the converted default ISIC path with a target TIDAS process classification.",
    },
  ]);
  const context = writeContextPackFiles(classificationFixtureRoot);

  try {
    const gate = runFoundry([
      "dataset-curation-gate",
      "--type",
      "process",
      "--profile",
      "generic",
      "--rows-file",
      rel(rowsFile),
      "--schema-report",
      rel(schemaReport),
      "--qa-report",
      rel(qaReport),
      "--classification-queue",
      rel(classificationQueue),
      "--schema-file",
      rel(context.schemaFile),
      "--yaml-file",
      rel(context.yamlFile),
      "--ruleset-file",
      rel(context.rulesetFile),
      "--out-dir",
      rel(path.join(classificationFixtureRoot, "curation-gate")),
    ]);
    assert.equal(gate.code, 1);
    assert.equal(gate.json.status, "blocked_needs_foundry_ai_authoring");
    assert.equal(gate.json.counts.action_items, 1);
    assert.equal(gate.json.counts.classification_queue_action_items, 1);

    const packagePath = path.join(repoRoot, gate.json.entities[0].authoring_package);
    const authoringPackage = readJson(packagePath);
    assert.equal(authoringPackage.classification_authoring_context.rows.length, 1);
    assert.equal(
      authoringPackage.action_items[0].path,
      "processDataSet.processInformation.dataSetInformation.classificationInformation.common:classification",
    );

    const task = runFoundry([
      "dataset-authoring-task-build",
      "--curation-gate-report",
      gate.json.files.report,
      "--out-dir",
      rel(path.join(classificationFixtureRoot, "authoring-tasks")),
    ]);
    assert.equal(task.code, 0);
    assert.equal(task.json.status, "ready_no_action_items");
    assert.equal(task.json.counts.action_items, 0);
    assert.equal(task.json.counts.decision_only_action_items, 1);
    assert.equal(task.json.batch_patch_contract.status, "not_required_no_patch_action_items");
    assert.equal(task.json.commands.apply_all_patches, null);
    assert.deepEqual(task.json.tasks[0].action_items, []);
    const decisionItem = task.json.tasks[0].decision_only_action_items[0];
    assert.deepEqual(decisionItem.allowed_resolution_modes, ["classification_decision"]);
    assert.equal(
      decisionItem.json_pointer,
      "/processDataSet/processInformation/dataSetInformation/classificationInformation/common:classification",
    );
    const patchTemplate = readJson(path.join(repoRoot, task.json.tasks[0].files.patch_template));
    assert.equal(patchTemplate.patch_sets[0].operations.length, 0);
  } finally {
    fs.rmSync(classificationFixtureRoot, { recursive: true, force: true });
  }
});

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const fixtureRoot = path.join(repoRoot, "tmp", "authoring-task-context-test");
const processId = "aaaaaaaa-bbbb-5ccc-8ddd-eeeeeeeeeeee";

function rel(filePath) {
  return path.relative(repoRoot, filePath).replaceAll("\\", "/");
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function runFoundry(args, expectedStatus = 0) {
  const result = spawnSync(process.execPath, ["scripts/foundry.mjs", ...args], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  assert.equal(result.status, expectedStatus, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

function actionItem() {
  return {
    code: "process_placeholder_content",
    path: "processDataSet.processInformation.quantitativeReference.functionalUnitOrOther",
    message: "Functional unit placeholder requires evidence-backed completion.",
    allowed_resolution_modes: ["evidence_backed_completion", "deferred_to_common_other"],
  };
}

function authoringPackage(contractContextFiles, actionItems = [actionItem()]) {
  return {
    schema_version: 2,
    profile: "bafu",
    dataset_type: "process",
    entity_id: processId,
    version: "00.00.001",
    source_rows_file: "tmp/source/processes.jsonl",
    contract_context_files: contractContextFiles,
    full_context_ai_completion: {
      required: true,
      required_context_kinds: [
        "schema",
        "methodology_yaml",
        "ruleset",
        "classification_schema",
        "location_schema",
      ],
      required_context_file_patterns: [
        "schema.json",
        "methodology.yaml",
        "runtime-ruleset.json",
        "tidas_processes_category.json",
        "tidas_locations_category.json",
      ],
    },
    missing_context_files: [],
    action_items: actionItems,
    source_row: {
      processDataSet: {
        processInformation: {
          dataSetInformation: { "common:UUID": processId },
        },
      },
    },
    entity_payload: {
      processDataSet: {
        processInformation: {
          dataSetInformation: { "common:UUID": processId },
        },
      },
    },
  };
}

function fullContextFiles() {
  return [
    {
      kind: "schema",
      path: "context/schema.json",
      text: "{}",
    },
    {
      kind: "methodology_yaml",
      path: "context/methodology.yaml",
      text: "process:\n  required: true\n",
    },
    {
      kind: "ruleset",
      path: "context/runtime-ruleset.json",
      text: '{"rules":[]}',
    },
    {
      kind: "classification_schema",
      path: "context/tidas_processes_category.json",
      text: '{"oneOf":[]}',
    },
    {
      kind: "location_schema",
      path: "context/tidas_locations_category.json",
      text: '{"oneOf":[]}',
    },
  ];
}

test("authoring task build blocks AI patch authoring when full context is incomplete", () => {
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
  const packagePath = path.join(fixtureRoot, "process.authoring-package.json");
  const taskDir = path.join(fixtureRoot, "authoring-task");

  try {
    writeJson(
      packagePath,
      authoringPackage([
        {
          kind: "schema",
          path: "context/schema.json",
          text: "{}",
        },
        {
          kind: "methodology_yaml",
          path: "context/methodology.yaml",
          text: "process:\n  required: true\n",
        },
      ]),
    );

    const task = runFoundry(
      [
        "dataset-authoring-task-build",
        "--authoring-package",
        rel(packagePath),
        "--out-dir",
        rel(taskDir),
      ],
      1,
    );

    assert.equal(task.status, "blocked_missing_full_context");
    assert.equal(task.counts.action_items, 1);
    assert.equal(
      task.blockers.some(
        (blocker) =>
          blocker.code === "authoring_task_required_context_missing" &&
          blocker.required_kind === "ruleset",
      ),
      true,
    );
    assert.equal(
      task.blockers.some(
        (blocker) =>
          blocker.code === "authoring_task_required_context_file_missing" &&
          blocker.required_file_pattern === "tidas_locations_category.json",
      ),
      true,
    );
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("authoring patch task excludes decision-only identity classification and location items", () => {
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
  const packagePath = path.join(fixtureRoot, "process.authoring-package.json");
  const taskDir = path.join(fixtureRoot, "authoring-task");

  try {
    writeJson(
      packagePath,
      authoringPackage(fullContextFiles(), [
        actionItem(),
        {
          code: "identity_preflight_manual_review",
          path: null,
          action_kind: "identity_decision_authoring",
          ai_required: true,
          message: "Identity must be decided from remote candidates.",
        },
        {
          code: "process_classification_requires_authoring",
          path: "processDataSet.processInformation.dataSetInformation.classificationInformation.common:classification",
          action_kind: "classification_decision_authoring",
          ai_required: true,
          message: "Classification must be selected from TIDAS categories.",
        },
        {
          code: "location_code_requires_authoring",
          path: "processDataSet.processInformation.geography.locationOfOperationSupplyOrProduction.@location",
          action_kind: "location_decision_authoring",
          ai_required: true,
          message: "Location must be selected from TIDAS locations.",
        },
      ]),
    );

    const task = runFoundry([
      "dataset-authoring-task-build",
      "--authoring-package",
      rel(packagePath),
      "--out-dir",
      rel(taskDir),
    ]);

    assert.equal(task.status, "ready_for_ai_authoring");
    assert.equal(task.counts.action_items, 1);
    assert.equal(task.counts.decision_only_action_items, 3);
    assert.deepEqual(
      task.action_items.map((item) => item.code),
      ["process_placeholder_content"],
    );
    assert.deepEqual(
      task.decision_only_action_items.map((item) => item.code),
      [
        "identity_preflight_manual_review",
        "process_classification_requires_authoring",
        "location_code_requires_authoring",
      ],
    );
    const patchTemplate = JSON.parse(
      fs.readFileSync(path.join(repoRoot, task.files.patch_template), "utf8"),
    );
    assert.equal(patchTemplate.patch_sets[0].operations.length, 1);
    assert.deepEqual(patchTemplate.patch_sets[0].operations[0].closes_action_items, [
      {
        code: "process_placeholder_content",
        path: "processDataSet.processInformation.quantitativeReference.functionalUnitOrOther",
      },
    ]);
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("authoring patch collect blocks stale manifests that lack full-context task proof", () => {
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
  const packagePath = path.join(fixtureRoot, "process.authoring-package.json");
  const patchPath = path.join(fixtureRoot, "ai-patches.json");
  const manifestPath = path.join(fixtureRoot, "authoring-task-manifest.json");

  try {
    writeJson(
      packagePath,
      authoringPackage([
        {
          kind: "schema",
          path: "context/schema.json",
          text: "{}",
        },
      ]),
    );
    writeJson(patchPath, {
      schema_version: 1,
      patch_status: "completed",
      patch_sets: [
        {
          dataset_id: processId,
          version: "00.00.001",
          authoring_package: path.basename(packagePath),
          operations: [
            {
              op: "replace",
              path: "/processDataSet/processInformation/quantitativeReference/functionalUnitOrOther",
              value: {
                "@xml:lang": "en",
                "#text": "1 item",
              },
              basis: "Fixture value.",
              evidence: {
                source: "fixture",
                quote_or_trace: "fixture trace",
              },
              resolution: {
                mode: "evidence_backed_completion",
                used_context_kinds: [
                  "schema",
                  "methodology_yaml",
                  "ruleset",
                  "classification_schema",
                  "location_schema",
                ],
              },
              closes_action_items: [actionItem()],
            },
          ],
        },
      ],
    });
    writeJson(manifestPath, {
      schema_version: 1,
      status: "ready_for_ai_authoring_batch",
      tasks: [
        {
          status: "ready_for_ai_authoring",
          entity: {
            dataset_type: "process",
            entity_id: processId,
            version: "00.00.001",
          },
          context: {
            full_context_ai_completion: authoringPackage([]).full_context_ai_completion,
            contract_context_files: [
              {
                kind: "schema",
                path: "context/schema.json",
                sha256: "fixture",
                bytes: 2,
              },
            ],
            missing_context_files: [],
          },
          action_item_count: 1,
          action_items: [actionItem()],
          files: {
            authoring_package: rel(packagePath),
            output_patch_file: rel(patchPath),
          },
        },
      ],
    });

    const report = runFoundry(
      ["dataset-authoring-patch-collect", "--task-manifest", rel(manifestPath)],
      1,
    );

    assert.equal(report.status, "blocked");
    assert.equal(
      report.blockers.some(
        (blocker) =>
          blocker.code === "authoring_task_required_context_missing" &&
          blocker.required_kind === "methodology_yaml",
      ),
      true,
    );
    assert.equal(report.counts.patch_sets, 0);
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("authoring patch collect blocks AI patches without completed status", () => {
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
  const packagePath = path.join(fixtureRoot, "process.authoring-package.json");
  const patchPath = path.join(fixtureRoot, "ai-patches.json");
  const manifestPath = path.join(fixtureRoot, "authoring-task-manifest.json");

  try {
    writeJson(packagePath, {
      ...authoringPackage([]),
      full_context_ai_completion: { required: false },
      contract_context_files: [],
    });
    writeJson(patchPath, {
      schema_version: 1,
      patch_sets: [
        {
          dataset_id: processId,
          version: "00.00.001",
          authoring_package: path.basename(packagePath),
          operations: [
            {
              op: "replace",
              path: "/processDataSet/processInformation/quantitativeReference/functionalUnitOrOther",
              value: {
                "@xml:lang": "en",
                "#text": "1 item",
              },
              basis: "Fixture value.",
              evidence: {
                source: "fixture",
                quote_or_trace: "fixture trace",
              },
              resolution: {
                mode: "evidence_backed_completion",
                used_context_kinds: ["schema"],
              },
              closes_action_items: [actionItem()],
            },
          ],
        },
      ],
    });
    writeJson(manifestPath, {
      schema_version: 1,
      status: "ready_for_ai_authoring_batch",
      tasks: [
        {
          status: "ready_for_ai_authoring",
          entity: {
            dataset_type: "process",
            entity_id: processId,
            version: "00.00.001",
          },
          context: {
            full_context_ai_completion: { required: false },
            contract_context_files: [],
            missing_context_files: [],
          },
          action_item_count: 1,
          action_items: [actionItem()],
          files: {
            authoring_package: rel(packagePath),
            output_patch_file: rel(patchPath),
          },
        },
      ],
    });

    const report = runFoundry(
      ["dataset-authoring-patch-collect", "--task-manifest", rel(manifestPath)],
      1,
    );

    assert.equal(report.status, "blocked");
    assert.equal(
      report.blockers.some((blocker) => blocker.code === "ai_patch_status_not_completed"),
      true,
    );
    assert.equal(report.counts.patch_sets, 0);
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

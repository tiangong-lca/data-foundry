import test from "node:test";
import { fixtureRoot } from "../fixtures/fixture-roots.ts";
import {
  assert,
  blockerCodes,
  fs,
  path,
  readJson,
  rel,
  repoRoot,
  runFoundry,
  sha256Text,
  writeJson,
  writeText,
} from "../fixtures/foundry-core.mjs";
import { processRowWithInvalidLocation } from "../fixtures/row-builders.mjs";

test("authoring task batch writes shared full-context bundle for repeated package context", () => {
  const root = path.join(fixtureRoot, "authoring-task-shared-context");
  fs.rmSync(root, { recursive: true, force: true });
  const packageDir = path.join(root, "curation-gate", "ai-authoring-packages");
  const contextFiles = [
    {
      kind: "schema",
      path: rel(path.join(root, "context", "schema.json")),
      text: '{"title":"process schema"}',
    },
    {
      kind: "methodology_yaml",
      path: rel(path.join(root, "context", "methodology.yaml")),
      text: "process:\n  required_multilang_english: true\n",
    },
  ];
  for (const file of contextFiles) {
    writeText(path.join(repoRoot, file.path), file.text);
  }
  const actionItem = {
    code: "source_system_boilerplate",
    path: "processDataSet.processInformation.dataSetInformation.generalComment",
    ai_required: true,
  };
  const packages = [
    "11111111-1111-4111-8111-111111111111",
    "22222222-2222-4222-8222-222222222222",
  ].map((processId) => {
    const row = processRowWithInvalidLocation(processId);
    row.processDataSet.processInformation.geography.locationOfOperationSupplyOrProduction[
      "@location"
    ] = "CH";
    const packagePath = path.join(packageDir, `process-${processId}.authoring-package.json`);
    writeJson(packagePath, {
      schema_version: 2,
      profile: "bafu",
      dataset_type: "process",
      entity_id: processId,
      version: "00.00.001",
      contract_context_files: contextFiles,
      full_context_ai_completion: {
        required: true,
        required_context_kinds: ["schema", "methodology_yaml"],
      },
      missing_context_files: [],
      action_items: [actionItem],
      source_row: row,
      entity_payload: row,
    });
    return {
      processId,
      packagePath,
      sha256: sha256Text(fs.readFileSync(packagePath, "utf8")),
    };
  });
  const curationGateReport = path.join(root, "curation-gate", "dataset-curation-gate-report.json");
  writeJson(curationGateReport, {
    schema_version: 2,
    status: "blocked_needs_foundry_ai_authoring",
    profile: "bafu",
    dataset_type: "process",
    entities: packages.map((entry) => ({
      dataset_type: "process",
      entity_id: entry.processId,
      version: "00.00.001",
      status: "needs_foundry_ai_authoring",
      action_item_count: 1,
      authoring_package: rel(entry.packagePath),
      authoring_package_sha256: entry.sha256,
    })),
  });
  const sharedContextCacheDir = path.join(root, "shared-context-cache");

  try {
    const task = runFoundry([
      "dataset-authoring-task-build",
      "--curation-gate-report",
      rel(curationGateReport),
      "--shared-context-cache-dir",
      rel(sharedContextCacheDir),
      "--out-dir",
      rel(path.join(root, "authoring-tasks")),
    ]);
    const taskCached = runFoundry([
      "dataset-authoring-task-build",
      "--curation-gate-report",
      rel(curationGateReport),
      "--shared-context-cache-dir",
      rel(sharedContextCacheDir),
      "--out-dir",
      rel(path.join(root, "authoring-tasks-cached")),
    ]);
    assert.equal(task.code, 0, JSON.stringify(task.json, null, 2));
    assert.equal(taskCached.code, 0, JSON.stringify(taskCached.json, null, 2));
    assert.equal(task.json.status, "ready_for_ai_authoring_batch");
    assert.equal(task.json.counts.tasks, 2);
    assert.equal(task.json.counts.shared_context_files, 2);
    assert.equal(task.json.counts.shared_context_references, 4);
    assert.equal(task.json.counts.duplicate_context_references, 2);
    assert.ok(task.json.counts.duplicate_context_bytes_avoided > 0);
    assert.ok(task.json.files.shared_context_bundle);
    assert.equal(task.json.shared_context_bundle.path, task.json.files.shared_context_bundle);
    assert.equal(
      task.json.files.shared_context_bundle,
      taskCached.json.files.shared_context_bundle,
    );
    assert.equal(task.json.shared_context_bundle.cache.enabled, true);
    assert.equal(task.json.shared_context_bundle.cache.reused, false);
    assert.equal(taskCached.json.shared_context_bundle.cache.reused, true);
    assert.equal(
      task.json.tasks[0].context.shared_context_bundle.path,
      task.json.files.shared_context_bundle,
    );
    const bundle = readJson(path.join(repoRoot, task.json.files.shared_context_bundle));
    assert.equal(bundle.sha256, task.json.shared_context_bundle.sha256);
    const {
      generated_at_utc: _generatedAt,
      hash_scope: _hashScope,
      sha256,
      ...stableBundlePayload
    } = bundle;
    assert.equal(sha256, sha256Text(JSON.stringify(stableBundlePayload)));
    assert.equal(bundle.counts.files, 2);
    assert.equal(bundle.counts.references, 4);
    assert.deepEqual(bundle.files.map((file) => file.kind).sort(), ["methodology_yaml", "schema"]);
    assert.match(bundle.files.find((file) => file.kind === "schema").text, /process schema/u);
    assert.equal(
      task.json.tasks[0].context.contract_context_files.some((file) => Object.hasOwn(file, "text")),
      false,
    );
    const firstTaskJson = readJson(path.join(repoRoot, task.json.tasks[0].files.task_json));
    assert.equal(
      firstTaskJson.context.shared_context_bundle.path,
      task.json.files.shared_context_bundle,
    );
    assert.equal(
      firstTaskJson.context.contract_context_files.some((file) => Object.hasOwn(file, "text")),
      false,
    );
    assert.match(
      fs.readFileSync(path.join(repoRoot, task.json.tasks[0].files.task_markdown), "utf8"),
      /shared context bundle:/u,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("authoring patch collect verifies referenced shared full-context bundle", () => {
  const root = path.join(fixtureRoot, "authoring-patch-shared-context-proof");
  fs.rmSync(root, { recursive: true, force: true });
  const processId = "12121212-1212-4121-8121-121212121212";
  const packageDir = path.join(root, "curation-gate", "ai-authoring-packages");
  const contextFiles = [
    {
      kind: "schema",
      path: rel(path.join(root, "context", "schema.json")),
      text: '{"title":"process schema"}',
    },
    {
      kind: "methodology_yaml",
      path: rel(path.join(root, "context", "methodology.yaml")),
      text: "process:\n  required_multilang_english: true\n",
    },
  ];
  for (const file of contextFiles) {
    writeText(path.join(repoRoot, file.path), file.text);
  }
  const row = processRowWithInvalidLocation(processId);
  row.processDataSet.processInformation.geography.locationOfOperationSupplyOrProduction[
    "@location"
  ] = "CH";
  const actionItem = {
    code: "process_placeholder_content",
    path: "processDataSet.processInformation.dataSetInformation.generalComment",
    message: "General comment still contains placeholder-like content.",
    ai_required: true,
  };
  const packagePath = path.join(packageDir, `process-${processId}.authoring-package.json`);
  writeJson(packagePath, {
    schema_version: 2,
    profile: "bafu",
    dataset_type: "process",
    entity_id: processId,
    version: "00.00.001",
    contract_context_files: contextFiles,
    full_context_ai_completion: {
      required: true,
      required_context_kinds: ["schema", "methodology_yaml"],
    },
    missing_context_files: [],
    action_items: [actionItem],
    source_row: row,
    entity_payload: row,
  });
  const curationGateReport = path.join(root, "curation-gate", "dataset-curation-gate-report.json");
  writeJson(curationGateReport, {
    schema_version: 2,
    status: "blocked_needs_foundry_ai_authoring",
    profile: "bafu",
    dataset_type: "process",
    entities: [
      {
        dataset_type: "process",
        entity_id: processId,
        version: "00.00.001",
        status: "needs_foundry_ai_authoring",
        action_item_count: 1,
        authoring_package: rel(packagePath),
        authoring_package_sha256: sha256Text(fs.readFileSync(packagePath, "utf8")),
      },
    ],
  });

  try {
    const task = runFoundry([
      "dataset-authoring-task-build",
      "--curation-gate-report",
      rel(curationGateReport),
      "--shared-context-cache-dir",
      rel(path.join(root, "shared-context-cache")),
      "--out-dir",
      rel(path.join(root, "authoring-tasks")),
    ]);
    assert.equal(task.code, 0, JSON.stringify(task.json, null, 2));
    assert.equal(task.json.status, "ready_for_ai_authoring_batch");
    const taskEntry = task.json.tasks[0];
    const taskActionItem = taskEntry.action_items[0];
    const patchTemplate = readJson(path.join(repoRoot, taskEntry.files.patch_template));
    const outputPatchFile = path.join(repoRoot, taskEntry.files.output_patch_file);
    writeJson(outputPatchFile, {
      schema_version: 1,
      kind: "tiangong_foundry_dataset_patch",
      patch_status: "completed",
      patch_sets: [
        {
          dataset_id: processId,
          version: "00.00.001",
          authoring_package: patchTemplate.patch_sets[0].authoring_package,
          operations: [
            {
              op: "add",
              path: "/processDataSet/processInformation/dataSetInformation/generalComment",
              value: {
                "@xml:lang": "en",
                "#text":
                  "The source row was reviewed against the process schema and BAFU authoring context.",
              },
              basis:
                "The converted source row and schema context support replacing placeholder-like prose with source-traced process documentation.",
              evidence: {
                source: "authoring_package.source_row",
                quote_or_trace:
                  "processDataSet.processInformation.dataSetInformation.name.baseName.#text = Heat, from natural gas",
              },
              resolution: {
                mode: "evidence_backed_completion",
                used_context_kinds: ["schema", "methodology_yaml"],
              },
              closes_action_items: [
                {
                  code: taskActionItem.code,
                  path: taskActionItem.path,
                },
              ],
            },
          ],
        },
      ],
    });

    const collect = runFoundry([
      "dataset-authoring-patch-collect",
      "--task-manifest",
      task.json.files.manifest,
      "--out-dir",
      rel(path.join(root, "authoring-patches-ok")),
    ]);
    assert.equal(collect.code, 0, JSON.stringify(collect.json, null, 2));
    assert.equal(collect.json.status, "ready_for_patch_apply");

    const bundlePath = path.join(repoRoot, task.json.files.shared_context_bundle);
    const bundle = readJson(bundlePath);
    fs.rmSync(bundlePath);
    const missingCollect = runFoundry([
      "dataset-authoring-patch-collect",
      "--task-manifest",
      task.json.files.manifest,
      "--out-dir",
      rel(path.join(root, "authoring-patches-missing-bundle")),
    ]);
    assert.equal(missingCollect.code, 1);
    assert.equal(missingCollect.json.status, "blocked");
    assert.ok(
      blockerCodes(missingCollect.json).has("authoring_manifest_shared_context_bundle_missing"),
    );
    assert.ok(
      blockerCodes(missingCollect.json).has("authoring_task_shared_context_bundle_missing"),
    );

    writeJson(bundlePath, {
      ...bundle,
      files: [
        ...bundle.files,
        {
          kind: "schema",
          path: "tampered-schema.json",
          sha256: sha256Text("tampered"),
          bytes: 8,
          text: "tampered",
        },
      ],
    });
    const tamperedCollect = runFoundry([
      "dataset-authoring-patch-collect",
      "--task-manifest",
      task.json.files.manifest,
      "--out-dir",
      rel(path.join(root, "authoring-patches-tampered-bundle")),
    ]);
    assert.equal(tamperedCollect.code, 1);
    assert.equal(tamperedCollect.json.status, "blocked");
    assert.ok(
      blockerCodes(tamperedCollect.json).has(
        "authoring_manifest_shared_context_bundle_content_hash_mismatch",
      ),
    );
    assert.ok(
      blockerCodes(tamperedCollect.json).has(
        "authoring_task_shared_context_bundle_content_hash_mismatch",
      ),
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

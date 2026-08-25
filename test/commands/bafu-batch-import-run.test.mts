import assert from "node:assert/strict";
import test from "node:test";
import {
  bafuBatchImportRunTestHooks,
  createBafuBatchImportRunCommands,
  filterAuthoringTaskManifestToRows,
} from "../../scripts/commands/bafu-batch-import-run.ts";
import {
  createFileArtifactFact,
  createFoundryCommandSpec,
} from "../../scripts/lib/foundry-command-spec.ts";
import {
  fs,
  path,
  readJson,
  readJsonLines,
  rel,
  repoRoot,
  runFoundry,
  testTmpRoot,
  writeJson,
  writeJsonLines,
} from "../fixtures/foundry-core.mjs";

const fixtureRoot = testTmpRoot("bafu-batch-import-run-test");
const processId = "11111111-2222-4333-8444-555555555555";

type JsonRecord = Record<string, unknown>;
type DatasetType = keyof typeof DATASET_ROOT_KEYS;
type DependencyFactory = (dependencies: never) => unknown;

function bindFactory<Factory extends DependencyFactory>(
  factory: Factory,
  dependencies: unknown,
): ReturnType<Factory> {
  return factory(dependencies as never) as ReturnType<Factory>;
}

function record(value: unknown): JsonRecord {
  return typeof value === "object" && value !== null ? (value as JsonRecord) : {};
}

function textValue(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string" || typeof value === "number") return String(value).trim();
  if (Array.isArray(value)) return value.map(textValue).filter(Boolean).join("; ");
  if (typeof value === "object") {
    const entry = record(value);
    return textValue(entry["#text"] ?? entry.value ?? entry.id);
  }
  return "";
}

// ILCD root/information keys are irregular for unit groups and flow properties
// (unitGroupDataSet/unitGroupInformation, flowPropertyDataSet/flowPropertiesInformation),
// so the plain `${type}DataSet`/`${type}Information` template does not reach them.
const DATASET_ROOT_KEYS = {
  contact: ["contactDataSet", "contactInformation"],
  source: ["sourceDataSet", "sourceInformation"],
  flow: ["flowDataSet", "flowInformation"],
  process: ["processDataSet", "processInformation"],
  unitgroup: ["unitGroupDataSet", "unitGroupInformation"],
  flowproperty: ["flowPropertyDataSet", "flowPropertiesInformation"],
};

function datasetIdentity(row: JsonRecord, type: DatasetType) {
  const [rootKey, infoKey] = DATASET_ROOT_KEYS[type] ?? [`${type}DataSet`, `${type}Information`];
  const root = record(row[rootKey]);
  const informationRoot = record(root[infoKey]);
  const information = record(
    informationRoot.dataSetInformation ?? informationRoot["common:dataSetInformation"],
  );
  const administrativeInformation = record(root.administrativeInformation);
  const publication = record(
    administrativeInformation.publicationAndOwnership ??
      administrativeInformation["common:publicationAndOwnership"],
  );
  return {
    id: textValue(information["common:UUID"]),
    version: textValue(publication["common:dataSetVersion"]),
  };
}

bindFactory(createBafuBatchImportRunCommands, {
  asText: textValue,
  booleanOption: (value: unknown) => value === true || value === "true",
  datasetIdentity,
  directoryExists: (filePath: string | null) =>
    Boolean(filePath) && fs.existsSync(filePath!) && fs.statSync(filePath!).isDirectory(),
  fileExists: (filePath: string | null) =>
    Boolean(filePath) && fs.existsSync(filePath!) && fs.statSync(filePath!).isFile(),
  integerOption: (value: unknown, fallback: number | null) => {
    const parsed = Number.parseInt(String(value ?? ""), 10);
    return Number.isFinite(parsed) ? parsed : fallback;
  },
  normalizedList: (value: unknown) =>
    value == null
      ? []
      : (Array.isArray(value) ? value : String(value).split(","))
          .map((entry) => String(entry).trim())
          .filter(Boolean),
  nowIso: () => "2026-01-01T00:00:00.000Z",
  readJson,
  readJsonLines: (filePath: string) => (fs.existsSync(filePath) ? readJsonLines(filePath) : []),
  repoRelativeMaybe: (filePath: string | null) => (filePath ? rel(filePath) : null),
  resolveRepoPath: (filePath: string | null) =>
    filePath ? (path.isAbsolute(filePath) ? filePath : path.join(repoRoot, filePath)) : null,
  shellQuote: (value: unknown) => {
    const text = String(value);
    return /^[A-Za-z0-9_./:=@%+-]+$/u.test(text) ? text : `'${text.replace(/'/gu, "'\\''")}'`;
  },
  writeJson,
  writeJsonLines,
});

function writeTextFile(filePath: string, text = "{}\n"): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, text);
}

function writeRequiredContext(runDir: string, schemaDir: string): void {
  for (const type of ["flow", "process"]) {
    writeTextFile(path.join(runDir, "context", type, "outputs", "schema.json"));
    writeTextFile(path.join(runDir, "context", type, "outputs", "runtime-ruleset.json"));
    writeTextFile(path.join(runDir, "context", type, "outputs", "methodology.yaml"), "rules: []\n");
  }
  for (const name of [
    "tidas_contacts_category.json",
    "tidas_flowproperties_category.json",
    "tidas_flows_elementary_category.json",
    "tidas_flows_product_category.json",
    "tidas_lciamethods_category.json",
    "tidas_processes_category.json",
    "tidas_sources_category.json",
    "tidas_unitgroups_category.json",
    "tidas_locations_category.json",
  ]) {
    writeTextFile(path.join(schemaDir, name));
  }
  writeJsonLines(
    path.join(runDir, "decisions-v4-leaf-category-map", "classification-decisions.jsonl"),
    [],
  );
}

function bafuFamilyProcessPayload({
  id,
  name,
  location,
  inputAmount,
}: {
  id: string;
  name: string;
  location: string;
  inputAmount: number;
}) {
  return {
    processDataSet: {
      processInformation: {
        dataSetInformation: {
          "common:UUID": id,
          name: {
            baseName: { "@xml:lang": "en", "#text": name },
            mixAndLocationTypes: { "@xml:lang": "en", "#text": location },
          },
        },
        geography: {
          locationOfOperationSupplyOrProduction: {
            "@location": location,
          },
        },
      },
      exchanges: {
        exchange: [
          {
            exchangeDirection: "Output",
            referenceToFlowDataSet: {
              "common:shortDescription": { "@xml:lang": "en", "#text": name },
            },
            meanAmount: "1.0",
            resultingAmount: "1.0",
            uncertaintyDistributionType: "undefined",
            dataDerivationTypeStatus: "Unknown derivation",
          },
          {
            exchangeDirection: "Input",
            referenceToFlowDataSet: {
              "common:shortDescription": {
                "@xml:lang": "en",
                "#text": `Natural gas supply {${location}}`,
              },
            },
            meanAmount: String(inputAmount),
            resultingAmount: String(inputAmount),
            uncertaintyDistributionType: "undefined",
            dataDerivationTypeStatus: "Unknown derivation",
          },
        ],
      },
      administrativeInformation: {
        publicationAndOwnership: {
          "common:dataSetVersion": "00.00.001",
        },
      },
    },
  };
}

function writeBafuFamilyBundleProcess(
  bundlesDir: string,
  payload: ReturnType<typeof bafuFamilyProcessPayload>,
): void {
  const id = payload.processDataSet.processInformation.dataSetInformation["common:UUID"];
  writeJson(path.join(bundlesDir, id, "tidas", "processes", `${id}.json`), payload);
}

function coverageProcessPayload({ id, flowIds }: { id: string; flowIds: string[] }) {
  return {
    processDataSet: {
      processInformation: {
        dataSetInformation: {
          "common:UUID": id,
          name: {
            baseName: { "@xml:lang": "en", "#text": `Process ${id}` },
          },
        },
      },
      exchanges: {
        exchange: flowIds.map((flowId, index) => ({
          exchangeDirection: index === 0 ? "Output" : "Input",
          referenceToFlowDataSet: {
            "@type": "flow data set",
            "@refObjectId": flowId,
            "@version": "00.00.001",
            "common:shortDescription": { "@xml:lang": "en", "#text": `Flow ${flowId}` },
          },
          meanAmount: "1.0",
          resultingAmount: "1.0",
        })),
      },
      administrativeInformation: {
        publicationAndOwnership: {
          "common:dataSetVersion": "00.00.001",
        },
      },
    },
  };
}

function coverageFlowPayload({
  id,
  typeOfDataSet = "Product flow",
}: {
  id: string;
  typeOfDataSet?: string;
}) {
  return {
    flowDataSet: {
      flowInformation: {
        dataSetInformation: {
          "common:UUID": id,
          typeOfDataSet,
          name: {
            baseName: { "@xml:lang": "en", "#text": `Flow ${id}` },
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

test("BAFU batch import runner publishes explicit commit stage contract", () => {
  const result = runFoundry(["dataset-bafu-batch-import-run", "--help"]);
  assert.equal(result.code, 0);
  assert.equal(result.json.remote_write_mode, "explicit-commit-only");
  assert.ok(Array.isArray(result.json.stage_pipeline));
  assert.deepEqual(
    result.json.stage_pipeline.map((stage: { phase: string }) => stage.phase),
    ["prepare", "rewrite_cleanup", "gate_validate", "report"],
  );
  assert.equal(
    result.json.stage_pipeline[2].report_contract.remote_write_mode,
    "explicit-commit-only",
  );
});

test("BAFU batch import runner skips already verified scopes through resumable ledgers", () => {
  const root = path.join(fixtureRoot, "skip");
  fs.rmSync(root, { recursive: true, force: true });
  const runDir = path.join(root, "run");
  const schemaDir = path.join(root, "schemas");
  const bundlesDir = path.join(root, "process-bundles");
  const outDir = path.join(root, "batch");
  fs.mkdirSync(bundlesDir, { recursive: true });
  writeRequiredContext(runDir, schemaDir);
  const scopeFile = path.join(root, "ready-scopes.jsonl");
  writeJsonLines(scopeFile, [
    {
      schema_version: 1,
      process_id: processId,
      process_version: "00.00.001",
      closure_status: "ready",
    },
  ]);
  writeJsonLines(path.join(outDir, "import-ledger", "ok.scopes.verified.jsonl"), [
    {
      schema_version: 1,
      dataset_type: "process",
      dataset_id: processId,
      dataset_version: "00.00.001",
      process_id: processId,
      process_version: "00.00.001",
      status: "verified",
    },
  ]);

  try {
    const result = runFoundry([
      "dataset-bafu-batch-import-run",
      "--scope-file",
      rel(scopeFile),
      "--process-bundles-dir",
      rel(bundlesDir),
      "--run-dir",
      rel(runDir),
      "--out-dir",
      rel(outDir),
      "--tidas-schema-dir",
      rel(schemaDir),
      "--target-user-id",
      "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
      "--commit",
      "--parallel",
      "2",
    ]);

    assert.equal(result.code, 0);
    const report = result.json;
    assert.equal(report.status, "completed");
    assert.equal(report.counts.skipped, 1);
    assert.equal(report.counts.verified, 0);
    const checkpoints = readJsonLines(path.join(repoRoot, report.files.scope_checkpoints));
    assert.equal(checkpoints.at(-1).state, "skipped_already_verified");
    assert.equal(fs.existsSync(path.join(outDir, "scopes", processId, "materialized")), false);
    const manifest = readJson(path.join(repoRoot, report.files.run_manifest));
    assert.equal(manifest.status, "completed");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("BAFU batch import runner skips already blocked scopes during normal resume", () => {
  const root = path.join(fixtureRoot, "skip-blocked");
  fs.rmSync(root, { recursive: true, force: true });
  const runDir = path.join(root, "run");
  const schemaDir = path.join(root, "schemas");
  const bundlesDir = path.join(root, "process-bundles");
  const outDir = path.join(root, "batch");
  fs.mkdirSync(bundlesDir, { recursive: true });
  writeRequiredContext(runDir, schemaDir);
  const scopeFile = path.join(root, "ready-scopes.jsonl");
  writeJsonLines(scopeFile, [
    {
      schema_version: 1,
      process_id: processId,
      process_version: "00.00.001",
      closure_status: "ready",
    },
  ]);
  writeJsonLines(path.join(outDir, "import-ledger", "blocked.scopes.human-review.jsonl"), [
    {
      schema_version: 1,
      process_id: processId,
      process_version: "00.00.001",
      stage: "flow.authoring",
      code: "bafu_name_split_unsupported",
      status: "blocked",
    },
  ]);

  try {
    const result = runFoundry([
      "dataset-bafu-batch-import-run",
      "--scope-file",
      rel(scopeFile),
      "--process-bundles-dir",
      rel(bundlesDir),
      "--run-dir",
      rel(runDir),
      "--out-dir",
      rel(outDir),
      "--tidas-schema-dir",
      rel(schemaDir),
      "--target-user-id",
      "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
      "--commit",
      "--parallel",
      "2",
    ]);

    assert.equal(result.code, 0);
    const report = result.json;
    assert.equal(report.status, "completed");
    assert.equal(report.counts.skipped_blocked, 1);
    assert.equal(report.counts.blocked, 0);
    const checkpoints = readJsonLines(path.join(repoRoot, report.files.scope_checkpoints));
    assert.equal(checkpoints.at(-1).state, "skipped_blocked_deferred");
    assert.equal(fs.existsSync(path.join(outDir, "scopes", processId, "materialized")), false);
    const blockers = readJsonLines(
      path.join(outDir, "import-ledger", "blocked.scopes.human-review.jsonl"),
    );
    assert.equal(blockers.length, 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("BAFU batch import runner can order selected scopes by estimated weight", () => {
  const root = path.join(fixtureRoot, "selection-order");
  fs.rmSync(root, { recursive: true, force: true });
  const runDir = path.join(root, "run");
  const schemaDir = path.join(root, "schemas");
  const bundlesDir = path.join(root, "process-bundles");
  const outDir = path.join(root, "batch");
  fs.mkdirSync(bundlesDir, { recursive: true });
  writeRequiredContext(runDir, schemaDir);
  const scopeFile = path.join(root, "ready-scopes.jsonl");
  const processIds = [
    "11111111-2222-4333-8444-555555555551",
    "11111111-2222-4333-8444-555555555552",
    "11111111-2222-4333-8444-555555555553",
  ];
  writeJsonLines(scopeFile, [
    {
      schema_version: 1,
      process_id: processIds[0],
      process_version: "00.00.001",
      closure_status: "ready",
      estimated_weight: 20,
    },
    {
      schema_version: 1,
      process_id: processIds[1],
      process_version: "00.00.001",
      closure_status: "ready",
      estimated_weight: 5,
    },
    {
      schema_version: 1,
      process_id: processIds[2],
      process_version: "00.00.001",
      closure_status: "ready",
      estimated_weight: 10,
    },
  ]);
  writeJsonLines(
    path.join(outDir, "import-ledger", "ok.scopes.verified.jsonl"),
    processIds.map((id) => ({
      schema_version: 1,
      dataset_type: "process",
      dataset_id: id,
      dataset_version: "00.00.001",
      process_id: id,
      process_version: "00.00.001",
      status: "verified",
    })),
  );

  try {
    const result = runFoundry([
      "dataset-bafu-batch-import-run",
      "--scope-file",
      rel(scopeFile),
      "--process-bundles-dir",
      rel(bundlesDir),
      "--run-dir",
      rel(runDir),
      "--out-dir",
      rel(outDir),
      "--tidas-schema-dir",
      rel(schemaDir),
      "--target-user-id",
      "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
      "--commit",
      "--parallel",
      "1",
      "--selection-order",
      "estimated-weight-asc",
      "--limit",
      "2",
    ]);

    assert.equal(result.code, 0);
    const report = result.json;
    assert.equal(report.status, "completed");
    assert.equal(report.selection.selection_order, "estimated-weight-asc");
    assert.equal(report.counts.selected_scopes, 2);
    assert.equal(report.counts.skipped, 2);
    const checkpoints = readJsonLines(path.join(repoRoot, report.files.scope_checkpoints));
    assert.deepEqual(
      checkpoints.slice(-2).map((checkpoint) => checkpoint.process_id),
      [processIds[1], processIds[2]],
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("BAFU batch import runner emits BAFU family signatures and can order masters before variants", () => {
  const root = path.join(fixtureRoot, "family-master-first");
  fs.rmSync(root, { recursive: true, force: true });
  const runDir = path.join(root, "run");
  const schemaDir = path.join(root, "schemas");
  const bundlesDir = path.join(root, "process-bundles");
  const outDir = path.join(root, "batch");
  fs.mkdirSync(bundlesDir, { recursive: true });
  writeRequiredContext(runDir, schemaDir);
  const ids = [
    "11111111-2222-4333-8444-555555555581",
    "11111111-2222-4333-8444-555555555582",
    "11111111-2222-4333-8444-555555555583",
    "11111111-2222-4333-8444-555555555584",
  ];
  writeBafuFamilyBundleProcess(
    bundlesDir,
    bafuFamilyProcessPayload({
      id: ids[0],
      name: "Natural gas, production CH, at long-distance pipeline {CH}",
      location: "CH",
      inputAmount: 5,
    }),
  );
  writeBafuFamilyBundleProcess(
    bundlesDir,
    bafuFamilyProcessPayload({
      id: ids[1],
      name: "Natural gas, production DE, at long-distance pipeline {DE}",
      location: "DE",
      inputAmount: 5,
    }),
  );
  writeBafuFamilyBundleProcess(
    bundlesDir,
    bafuFamilyProcessPayload({
      id: ids[2],
      name: "Heat production CH, at boiler {CH}",
      location: "CH",
      inputAmount: 2,
    }),
  );
  writeBafuFamilyBundleProcess(
    bundlesDir,
    bafuFamilyProcessPayload({
      id: ids[3],
      name: "Heat production DE, at boiler {DE}",
      location: "DE",
      inputAmount: 3,
    }),
  );
  const scopeFile = path.join(root, "ready-scopes.jsonl");
  writeJsonLines(
    scopeFile,
    [ids[1], ids[0], ids[3], ids[2]].map((id) => ({
      schema_version: 1,
      process_id: id,
      process_version: "00.00.001",
      closure_status: "ready",
    })),
  );

  try {
    const result = runFoundry([
      "dataset-bafu-batch-import-run",
      "--scope-file",
      rel(scopeFile),
      "--process-bundles-dir",
      rel(bundlesDir),
      "--run-dir",
      rel(runDir),
      "--out-dir",
      rel(outDir),
      "--tidas-schema-dir",
      rel(schemaDir),
      "--preflight-only",
      "--selection-order",
      "family-master-first",
    ]);

    assert.equal(result.code, 0);
    assert.equal(result.json.status, "preflight_completed");
    assert.equal(result.json.selection.selection_order, "family-master-first");
    assert.equal(result.json.counts.selected_same_amount_vector_scopes, 2);
    assert.equal(result.json.counts.selected_same_skeleton_only_scopes, 2);
    const plan = readJsonLines(path.join(repoRoot, result.json.files.preflight_plan));
    assert.deepEqual(
      plan.map((row) => row.process_id),
      [ids[1], ids[3], ids[0], ids[2]],
    );
    assert.deepEqual(
      plan.map((row) => row.bafu_family_optimization_role),
      [
        "same_amount_master",
        "same_skeleton_master",
        "same_amount_variant",
        "same_skeleton_variant",
      ],
    );
    const familyReport = readJson(path.join(repoRoot, result.json.files.bafu_family_signatures));
    assert.equal(familyReport.counts.selected_scopes.same_amount_vector_scopes, 2);
    assert.equal(familyReport.counts.selected_scopes.same_skeleton_scopes, 4);
    assert.equal(familyReport.counts.selected_scopes.same_skeleton_only_scopes, 2);
    assert.equal(familyReport.entries.length, 4);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("BAFU batch import runner can require leaf classification decisions before selection", () => {
  const root = path.join(fixtureRoot, "leaf-classification-filter");
  fs.rmSync(root, { recursive: true, force: true });
  const runDir = path.join(root, "run");
  const schemaDir = path.join(root, "schemas");
  const bundlesDir = path.join(root, "process-bundles");
  const outDir = path.join(root, "batch");
  fs.mkdirSync(bundlesDir, { recursive: true });
  writeRequiredContext(runDir, schemaDir);
  const ids = [
    "11111111-2222-4333-8444-555555555591",
    "11111111-2222-4333-8444-555555555592",
    "11111111-2222-4333-8444-555555555593",
  ];
  const flowIds = [
    "22222222-3333-4444-8555-666666666691",
    "22222222-3333-4444-8555-666666666692",
    "22222222-3333-4444-8555-666666666693",
  ];
  for (const [index, id] of ids.entries()) {
    writeBafuFamilyBundleProcess(
      bundlesDir,
      bafuFamilyProcessPayload({
        id,
        name: `Leaf filter sample ${index} {CH}`,
        location: "CH",
        inputAmount: index + 1,
      }),
    );
  }
  writeJsonLines(
    path.join(runDir, "decisions-v4-leaf-category-map", "classification-decisions.jsonl"),
    [
      {
        dataset_type: "process",
        dataset_id: ids[0],
        dataset_version: "00.00.001",
        category_type: "process",
        decision_status: "completed",
        classification_decision_level: "leaf",
        selected_code: "35101",
      },
      {
        dataset_type: "flow",
        dataset_id: flowIds[0],
        dataset_version: "00.00.001",
        category_type: "flow-product",
        decision_status: "completed",
        classification_decision_level: "leaf",
        selected_code: "17100",
      },
      {
        dataset_type: "process",
        dataset_id: ids[1],
        dataset_version: "00.00.001",
        category_type: "process",
        decision_status: "completed",
        classification_decision_level: "broad_section",
        selected_code: "D",
      },
      {
        dataset_type: "flow",
        dataset_id: flowIds[1],
        dataset_version: "00.00.001",
        category_type: "flow-product",
        decision_status: "completed",
        classification_decision_level: "leaf",
        selected_code: "17100",
      },
      {
        dataset_type: "process",
        dataset_id: ids[2],
        dataset_version: "00.00.001",
        category_type: "process",
        decision_status: "completed",
        classification_decision_level: "leaf",
        selected_code: "35101",
      },
    ],
  );
  const scopeFile = path.join(root, "ready-scopes.jsonl");
  writeJsonLines(
    scopeFile,
    ids.map((id, index) => ({
      schema_version: 1,
      process_id: id,
      process_version: "00.00.001",
      closure_status: "ready",
      dependency_ids: {
        flows: [
          {
            id: flowIds[index],
            version: "00.00.001",
            flow_type: "Product flow",
            reference_only: false,
          },
        ],
      },
    })),
  );

  try {
    const result = runFoundry([
      "dataset-bafu-batch-import-run",
      "--scope-file",
      rel(scopeFile),
      "--process-bundles-dir",
      rel(bundlesDir),
      "--run-dir",
      rel(runDir),
      "--out-dir",
      rel(outDir),
      "--tidas-schema-dir",
      rel(schemaDir),
      "--preflight-only",
      "--require-leaf-classification",
    ]);

    assert.equal(result.code, 0);
    assert.equal(result.json.selection.require_leaf_classification, true);
    assert.equal(result.json.counts.selected_scopes, 1);
    assert.equal(result.json.counts.filtered_classification_not_leaf_scopes, 1);
    assert.equal(result.json.counts.filtered_classification_missing_scopes, 1);
    const plan = readJsonLines(path.join(repoRoot, result.json.files.preflight_plan));
    assert.deepEqual(
      plan.map((row) => row.process_id),
      [ids[0]],
    );
    assert.equal(plan[0].classification_preflight_status, "leaf");
    assert.equal(plan[0].classification_preflight_checked_decisions, 2);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("BAFU batch import runner treats npm network apply failures as retryable", () => {
  const retryable = bafuBatchImportRunTestHooks.retryableStageFailure({
    stage: "classification.apply",
    report: null,
    blocker: {
      code: "classification_apply_stage_failed",
      message: "CLI classification apply failed for process.",
      stderr:
        "npm error code ENOTFOUND\nnpm error network request to https://registry.npmjs.org/@tiangong-lca%2fcli failed",
    },
  });

  assert.ok(retryable);
  assert.equal(retryable.code, "ENOTFOUND");
});

test("BAFU batch import runner treats curation gate blocks from failed identity preflight execution as retryable", () => {
  const root = path.join(fixtureRoot, "retryable-identity-preflight-gate");
  fs.rmSync(root, { recursive: true, force: true });
  const preflightRunReport = path.join(root, "identity-preflight-run", "run-report.json");
  writeJson(preflightRunReport, {
    status: "failed",
    counts: { failed: 1, cli_exit_nonzero: 1 },
    blockers: [
      {
        code: "identity_preflight_report_missing_or_non_json",
        message: "Identity-preflight runner could not produce usable evidence for a selected row.",
      },
    ],
  });
  const finalizeReport = path.join(root, "finalize", "dataset-post-authoring-finalize-report.json");
  writeJson(finalizeReport, {
    status: "blocked",
    blockers: [
      {
        code: "post_authoring_curation_gate_not_ready",
        stage: "post_authoring_curation_gate",
        status: "blocked_needs_foundry_deterministic_cleanup",
      },
    ],
    stages: [
      {
        stage: "identity_preflight_run",
        status: "failed",
        exit_code: 1,
        stderr: "",
        report_file: rel(preflightRunReport),
      },
      {
        stage: "post_authoring_curation_gate",
        status: "blocked_needs_foundry_deterministic_cleanup",
        exit_code: 1,
      },
    ],
  });

  const retryable = bafuBatchImportRunTestHooks.retryableStageFailure({
    stage: "process.finalize",
    blocker: {
      code: "post_authoring_curation_gate_not_ready",
      message:
        "Post-authoring curation gate must be ready before dry-run or remote write planning.",
    },
    report: rel(finalizeReport),
  });

  assert.ok(retryable, "failed identity preflight execution should classify as retryable");
  assert.equal(retryable.code, "identity_preflight_report_missing_or_non_json");

  fs.rmSync(root, { recursive: true, force: true });
});

test("BAFU batch import runner keeps genuine curation gate blocks on the human review path", () => {
  const root = path.join(fixtureRoot, "non-retryable-curation-gate");
  fs.rmSync(root, { recursive: true, force: true });
  const finalizeReport = path.join(root, "finalize", "dataset-post-authoring-finalize-report.json");
  writeJson(finalizeReport, {
    status: "blocked",
    blockers: [
      {
        code: "post_authoring_curation_gate_not_ready",
        stage: "post_authoring_curation_gate",
        status: "blocked_needs_foundry_ai_authoring",
      },
    ],
    stages: [
      {
        stage: "identity_preflight_run",
        status: "completed",
        exit_code: 0,
      },
      {
        stage: "post_authoring_curation_gate",
        status: "blocked_needs_foundry_ai_authoring",
        exit_code: 1,
      },
    ],
  });

  const retryable = bafuBatchImportRunTestHooks.retryableStageFailure({
    stage: "process.finalize",
    blocker: {
      code: "post_authoring_curation_gate_not_ready",
      message:
        "Post-authoring curation gate must be ready before dry-run or remote write planning.",
    },
    report: rel(finalizeReport),
  });

  assert.equal(retryable, null);

  fs.rmSync(root, { recursive: true, force: true });
});

test("BAFU universe coverage report compares full process universe with ready scopes and ledgers", () => {
  const root = path.join(fixtureRoot, "universe-coverage");
  fs.rmSync(root, { recursive: true, force: true });
  const inputDir = path.join(root, "input");
  const bundlesDir = path.join(inputDir, "process-bundles");
  const processesDir = path.join(inputDir, "tidas", "processes");
  const flowsDir = path.join(inputDir, "tidas", "flows");
  const ledgerDir = path.join(root, "previous-batch", "import-ledger");
  const outDir = path.join(root, "coverage");
  const readyScopes = path.join(root, "ready-scopes.jsonl");
  const p1 = "11111111-2222-4333-8444-555555555591";
  const p2 = "11111111-2222-4333-8444-555555555592";
  const p3 = "11111111-2222-4333-8444-555555555593";
  const f1 = "22222222-3333-4444-8555-666666666691";
  const f2 = "22222222-3333-4444-8555-666666666692";
  const f3 = "22222222-3333-4444-8555-666666666693";

  writeJson(path.join(bundlesDir, "index.json"), {
    bundles: [
      { process_id: p1, process_version: "00.00.001", manifest: `${p1}/manifest.json` },
      { process_id: p2, process_version: "00.00.001", manifest: `${p2}/manifest.json` },
      { process_id: p3, process_version: "00.00.001", manifest: `${p3}/manifest.json` },
    ],
  });
  writeJson(
    path.join(processesDir, `${p1}.json`),
    coverageProcessPayload({ id: p1, flowIds: [f1] }),
  );
  writeJson(
    path.join(processesDir, `${p2}.json`),
    coverageProcessPayload({ id: p2, flowIds: [f2] }),
  );
  writeJson(
    path.join(processesDir, `${p3}.json`),
    coverageProcessPayload({ id: p3, flowIds: [f3] }),
  );
  writeJson(path.join(flowsDir, `${f1}.json`), coverageFlowPayload({ id: f1 }));
  writeJson(path.join(flowsDir, `${f2}.json`), coverageFlowPayload({ id: f2 }));
  writeJson(path.join(flowsDir, `${f3}.json`), coverageFlowPayload({ id: f3 }));
  writeJsonLines(readyScopes, [
    {
      schema_version: 1,
      process_id: p1,
      process_version: "00.00.001",
      closure_status: "ready",
    },
  ]);
  writeJsonLines(path.join(ledgerDir, "ok.scopes.verified.jsonl"), [
    {
      schema_version: 1,
      dataset_type: "process",
      dataset_id: p1,
      dataset_version: "00.00.001",
      status: "verified",
    },
  ]);
  writeJsonLines(path.join(ledgerDir, "ok.flows.verified.jsonl"), [
    {
      schema_version: 1,
      dataset_type: "flow",
      dataset_id: f1,
      dataset_version: "00.00.001",
      status: "verified",
    },
  ]);
  writeJsonLines(path.join(ledgerDir, "blocked.scopes.human-review.jsonl"), [
    {
      schema_version: 1,
      process_id: p2,
      process_version: "00.00.001",
      stage: "classification.apply",
      code: "classification_apply_stage_failed",
    },
    {
      schema_version: 1,
      process_id: p3,
      process_version: "00.00.001",
      stage: "flow.commit",
      code: "finalize_report_missing",
    },
  ]);
  writeJsonLines(path.join(ledgerDir, "failed.scopes.retry.jsonl"), [
    {
      schema_version: 1,
      process_id: p3,
      process_version: "00.00.001",
      stage: "flow.commit",
      code: "finalize_report_missing",
    },
  ]);

  try {
    const result = runFoundry([
      "dataset-bafu-universe-coverage-report",
      "--input-dir",
      rel(inputDir),
      "--process-bundles-dir",
      rel(bundlesDir),
      "--scope-file",
      rel(readyScopes),
      "--ledger-source-dir",
      rel(ledgerDir),
      "--out-dir",
      rel(outDir),
    ]);

    assert.equal(result.code, 0);
    assert.equal(result.json.status, "completed_with_coverage_gaps");
    assert.equal(result.json.counts.process_universe, 3);
    assert.equal(result.json.counts.ready_scope_unique, 1);
    assert.equal(result.json.counts.verified_process_scopes, 1);
    assert.equal(result.json.counts.active_human_review_scopes, 1);
    assert.equal(result.json.counts.retry_scopes, 1);
    assert.equal(result.json.counts.ledger_source_ok_scope_rows, 1);
    assert.equal(result.json.counts.ledger_source_ok_scope_unique, 1);
    assert.equal(result.json.counts.ledger_source_ok_scope_unique_in_universe, 1);
    assert.equal(result.json.counts.ledger_source_ok_flow_rows, 1);
    assert.equal(result.json.counts.ledger_source_ok_flow_unique, 1);
    assert.equal(result.json.counts.unverified_product_or_unknown_flow_references, 2);
    const gaps = readJsonLines(path.join(outDir, "bafu-process-coverage-gaps.jsonl"));
    assert.deepEqual(
      gaps.map((row) => [row.process_id, row.coverage_status]),
      [
        [p2, "active_human_review"],
        [p3, "retry"],
      ],
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("BAFU identity decision carry-forward replaces unresolved rows only with completed reusable decisions", () => {
  const root = path.join(fixtureRoot, "identity-carry-forward");
  fs.rmSync(root, { recursive: true, force: true });
  const runDir = path.join(root, "run");
  const decisionDir = path.join(runDir, "decisions-v7-support-process-flow-product-leaf");
  const taskDir = path.join(root, "scope", "flow-identity-task");
  const sourceId = "33333333-4444-4555-8666-777777777791";
  const canonicalId = "44444444-5555-4666-8777-888888888891";
  const decisionsFile = path.join(taskDir, "identity-decisions.jsonl");

  writeJsonLines(path.join(decisionDir, "identity-decisions.jsonl"), [
    {
      schema_version: 1,
      dataset_type: "flow",
      dataset_id: sourceId,
      dataset_version: "00.00.001",
      decision_status: "completed",
      identity_decision: "reuse_existing_reference",
      canonical: {
        table: "flows",
        ref_object_id: canonicalId,
        version: "03.00.004",
        short_description: "canonical elementary flow",
      },
      basis: "Existing completed decision with physical-equivalence evidence.",
      used_context_kinds: ["schema", "methodology_yaml", "ruleset"],
      closes_action_items: ["elementary_flow_identity_manual_review"],
      evidence: {
        source: "prior_completed_identity_decision",
        selected_candidate: { id: canonicalId, version: "03.00.004" },
      },
    },
    {
      schema_version: 1,
      dataset_type: "flow",
      dataset_id: "33333333-4444-4555-8666-777777777792",
      dataset_version: "00.00.001",
      decision_status: "needs_review",
      identity_decision: "reuse_existing_reference",
      canonical: {
        table: "flows",
        ref_object_id: "44444444-5555-4666-8777-888888888892",
        version: "03.00.004",
      },
      basis: "Incomplete rows must not be reused.",
      evidence: { source: "incomplete" },
    },
  ]);
  writeJsonLines(decisionsFile, [
    {
      schema_version: 1,
      dataset_type: "flow",
      dataset_id: sourceId,
      dataset_version: "00.00.001",
      decision_status: "completed",
      identity_decision: "block_unresolved",
      canonical: null,
      basis: "Autofill could not prove reuse.",
      used_context_kinds: ["schema", "methodology_yaml", "ruleset"],
      closes_action_items: ["elementary_flow_identity_manual_review"],
      authoring_package: "current/flow.authoring-package.json",
      authoring_package_sha256: "current-sha",
      evidence: { source: "autofill" },
    },
  ]);

  try {
    const result = bafuBatchImportRunTestHooks.mergeCompletedReusableIdentityDecisions({
      runDir,
      decisionsFile,
      outDir: taskDir,
      datasetType: "flow",
    });

    assert.equal(result.report.status, "completed");
    assert.equal(result.report.counts.replacements, 1);
    assert.equal(result.report.counts.reusable_decisions, 1);
    const merged = readJsonLines(result.outputFile);
    assert.equal(merged.length, 1);
    assert.equal(merged[0].identity_decision, "reuse_existing_reference");
    assert.equal(merged[0].canonical.ref_object_id, canonicalId);
    assert.equal(merged[0].authoring_package, "current/flow.authoring-package.json");
    assert.equal(merged[0].authoring_package_sha256, "current-sha");
    assert.deepEqual(merged[0].used_context_kinds, ["schema", "methodology_yaml", "ruleset"]);
    assert.deepEqual(merged[0].closes_action_items, ["elementary_flow_identity_manual_review"]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("BAFU identity decision carry-forward appends library reuse rows with full apply contract", () => {
  const root = path.join(fixtureRoot, "identity-carry-forward-append");
  fs.rmSync(root, { recursive: true, force: true });
  const runDir = path.join(root, "run");
  const decisionDir = path.join(runDir, "decisions-v7-support-process-flow-product-leaf");
  const taskDir = path.join(root, "scope", "flow-identity-task");
  const appendedId = "33333333-4444-4555-8666-777777777793";
  const canonicalId = "44444444-5555-4666-8777-888888888893";
  const decisionsFile = path.join(taskDir, "identity-decisions.jsonl");
  const rowsFile = path.join(root, "flows.jsonl");
  const gateReportPath = path.join(root, "curation-gate", "dataset-curation-gate-report.json");
  const gatePackagePath = path.join(root, "authoring", `flow-${appendedId}.authoring-package.json`);

  writeJson(gatePackagePath, {
    schema_version: 1,
    dataset_type: "flow",
    entity_id: appendedId,
    contract_context_files: [
      { kind: "schema", path: "context/schema.json", text: "{}" },
      { kind: "methodology_yaml", path: "context/methodology.yaml", text: "rules: []" },
      { kind: "ruleset", path: "context/runtime-ruleset.json", text: "{}" },
      { kind: "classification_schema", path: "context/categories.json", text: "{}" },
      { kind: "location_schema", path: "context/locations.json", text: "{}" },
      { kind: "empty_text_kind_must_not_count", path: "context/empty.json", text: "" },
    ],
  });
  const gatePackageSha = bafuBatchImportRunTestHooks.sha256File(gatePackagePath);
  writeJson(gateReportPath, {
    schema_version: 1,
    entities: [
      {
        dataset_type: "flow",
        entity_id: appendedId,
        version: "00.00.001",
        authoring_package: rel(gatePackagePath),
        authoring_package_sha256: gatePackageSha,
      },
    ],
  });

  writeJsonLines(path.join(decisionDir, "identity-decisions.jsonl"), [
    {
      schema_version: 1,
      dataset_type: "flow",
      dataset_id: appendedId,
      dataset_version: "00.00.001",
      decision_status: "completed",
      identity_decision: "reuse_existing_reference",
      canonical: {
        table: "flows",
        ref_object_id: canonicalId,
        version: "03.00.004",
        short_description: "canonical elementary flow",
      },
      basis: "Completed library reuse decision without a per-scope task.",
      used_context_kinds: ["library_index", "scope_projection", "identity_preflight"],
      closes_action_items: ["elementary_flow_identity_manual_review"],
      evidence: { source: "identity_preflight" },
    },
  ]);
  writeJsonLines(decisionsFile, []);
  writeJsonLines(rowsFile, [
    {
      flowDataSet: {
        flowInformation: {
          dataSetInformation: { "common:UUID": appendedId },
        },
        administrativeInformation: {
          publicationAndOwnership: { "common:dataSetVersion": "00.00.001" },
        },
      },
    },
  ]);

  try {
    const result = bafuBatchImportRunTestHooks.mergeCompletedReusableIdentityDecisions({
      runDir,
      decisionsFile,
      outDir: taskDir,
      datasetType: "flow",
      rowsFile,
      curationGateReport: gateReportPath,
    });

    assert.equal(result.report.status, "completed");
    assert.equal(result.report.counts.additions, 1);
    const merged = readJsonLines(result.outputFile);
    assert.equal(merged.length, 1);
    assert.equal(merged[0].identity_decision, "reuse_existing_reference");
    assert.equal(merged[0].canonical.ref_object_id, canonicalId);
    assert.deepEqual(merged[0].used_context_kinds, [
      "library_index",
      "scope_projection",
      "identity_preflight",
      "schema",
      "methodology_yaml",
      "ruleset",
      "classification_schema",
      "location_schema",
    ]);
    const snapshotPath = path.join(
      taskDir,
      "authoring-package-snapshots",
      `flow-${appendedId}.authoring-package.${gatePackageSha}.snapshot.json`,
    );
    assert.equal(merged[0].authoring_package, rel(snapshotPath));
    assert.equal(merged[0].authoring_package_sha256, gatePackageSha);
    assert.ok(fs.existsSync(snapshotPath));
    assert.equal(
      bafuBatchImportRunTestHooks.sha256File(snapshotPath),
      gatePackageSha,
      "snapshot must be a byte-identical copy of the gate authoring package",
    );
    assert.deepEqual(
      readJson(snapshotPath).contract_context_files.map((file: { kind: string }) => file.kind),
      [
        "schema",
        "methodology_yaml",
        "ruleset",
        "classification_schema",
        "location_schema",
        "empty_text_kind_must_not_count",
      ],
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("BAFU batch import runner applies pending-only before limit and honors pause file", () => {
  const root = path.join(fixtureRoot, "pending-pause");
  fs.rmSync(root, { recursive: true, force: true });
  const runDir = path.join(root, "run");
  const schemaDir = path.join(root, "schemas");
  const bundlesDir = path.join(root, "process-bundles");
  const outDir = path.join(root, "batch");
  const pauseFile = path.join(outDir, "pause.flag");
  fs.mkdirSync(bundlesDir, { recursive: true });
  writeRequiredContext(runDir, schemaDir);
  writeTextFile(pauseFile, "pause\n");
  const scopeFile = path.join(root, "ready-scopes.jsonl");
  const verifiedId = "11111111-2222-4333-8444-555555555561";
  const blockedId = "11111111-2222-4333-8444-555555555562";
  const pendingId = "11111111-2222-4333-8444-555555555563";
  writeJsonLines(scopeFile, [
    {
      schema_version: 1,
      process_id: verifiedId,
      process_version: "00.00.001",
      closure_status: "ready",
      estimated_weight: 1,
    },
    {
      schema_version: 1,
      process_id: blockedId,
      process_version: "00.00.001",
      closure_status: "ready",
      estimated_weight: 2,
    },
    {
      schema_version: 1,
      process_id: pendingId,
      process_version: "00.00.001",
      closure_status: "ready",
      estimated_weight: 3,
    },
  ]);
  writeJsonLines(path.join(outDir, "import-ledger", "ok.scopes.verified.jsonl"), [
    {
      schema_version: 1,
      dataset_type: "process",
      dataset_id: verifiedId,
      dataset_version: "00.00.001",
      process_id: verifiedId,
      process_version: "00.00.001",
      status: "verified",
    },
  ]);
  writeJsonLines(path.join(outDir, "import-ledger", "blocked.scopes.human-review.jsonl"), [
    {
      schema_version: 1,
      process_id: blockedId,
      process_version: "00.00.001",
      stage: "flow.authoring",
      code: "bafu_name_split_unsupported",
      status: "blocked",
    },
  ]);

  try {
    const result = runFoundry([
      "dataset-bafu-batch-import-run",
      "--scope-file",
      rel(scopeFile),
      "--process-bundles-dir",
      rel(bundlesDir),
      "--run-dir",
      rel(runDir),
      "--out-dir",
      rel(outDir),
      "--tidas-schema-dir",
      rel(schemaDir),
      "--target-user-id",
      "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
      "--commit",
      "--parallel",
      "2",
      "--pending-only",
      "--limit",
      "1",
      "--pause-file",
      rel(pauseFile),
    ]);

    assert.equal(result.code, 0);
    const report = result.json;
    assert.equal(report.status, "paused");
    assert.equal(report.selection.pending_only, true);
    assert.equal(report.counts.selected_scopes, 1);
    assert.equal(report.counts.processed_scopes, 0);
    assert.equal(report.counts.paused_not_started, 1);
    assert.deepEqual(report.results, []);
    const manifest = readJson(path.join(repoRoot, report.files.run_manifest));
    assert.equal(manifest.counts.filtered_already_verified_scopes, 1);
    assert.equal(manifest.counts.filtered_already_blocked_scopes, 1);
    assert.equal(manifest.counts.pending_candidate_scopes, 1);
    assert.equal(manifest.pause_observed, true);
    assert.equal(fs.existsSync(path.join(repoRoot, report.files.scope_checkpoints)), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("BAFU batch import runner carries forward prior ledgers into fresh batch selection", () => {
  const root = path.join(fixtureRoot, "ledger-source-carry-forward");
  fs.rmSync(root, { recursive: true, force: true });
  const runDir = path.join(root, "run");
  const schemaDir = path.join(root, "schemas");
  const bundlesDir = path.join(root, "process-bundles");
  const sourceOutDir = path.join(root, "previous-batch");
  const outDir = path.join(root, "fresh-batch");
  fs.mkdirSync(bundlesDir, { recursive: true });
  writeRequiredContext(runDir, schemaDir);
  const scopeFile = path.join(root, "ready-scopes.jsonl");
  const verifiedId = "11111111-2222-4333-8444-555555555581";
  const blockedId = "11111111-2222-4333-8444-555555555582";
  const pendingId = "11111111-2222-4333-8444-555555555583";
  const verifiedFlowId = "22222222-3333-4444-8555-666666666681";
  writeJsonLines(scopeFile, [
    {
      schema_version: 1,
      process_id: verifiedId,
      process_version: "00.00.001",
      closure_status: "ready",
      estimated_weight: 1,
    },
    {
      schema_version: 1,
      process_id: blockedId,
      process_version: "00.00.001",
      closure_status: "ready",
      estimated_weight: 2,
    },
    {
      schema_version: 1,
      process_id: pendingId,
      process_version: "00.00.001",
      closure_status: "ready",
      estimated_weight: 3,
    },
  ]);
  writeJsonLines(path.join(sourceOutDir, "import-ledger", "ok.scopes.verified.jsonl"), [
    {
      schema_version: 1,
      dataset_type: "process",
      dataset_id: verifiedId,
      dataset_version: "00.00.001",
      process_id: verifiedId,
      process_version: "00.00.001",
      status: "verified",
    },
  ]);
  writeJsonLines(path.join(sourceOutDir, "import-ledger", "ok.flows.verified.jsonl"), [
    {
      schema_version: 1,
      dataset_type: "flow",
      dataset_id: verifiedFlowId,
      dataset_version: "00.00.001",
      status: "verified",
    },
  ]);
  writeJsonLines(path.join(sourceOutDir, "import-ledger", "blocked.scopes.human-review.jsonl"), [
    {
      schema_version: 1,
      process_id: blockedId,
      process_version: "00.00.001",
      stage: "flow.authoring",
      code: "bafu_name_split_unsupported",
      status: "blocked",
    },
  ]);
  writeJsonLines(path.join(sourceOutDir, "import-ledger", "verified-support-identities.jsonl"), [
    {
      schema_version: 1,
      identity_key: "source:bbbbbbbb-cccc-4ddd-8eee-ffffffffffff@00.00.001",
      type: "source",
      id: "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff",
      version: "00.00.001",
      status: "verified",
    },
    {
      schema_version: 1,
      identity_key: "source:cccccccc-dddd-4eee-8fff-000000000000@00.00.001",
      type: "source",
      id: "cccccccc-dddd-4eee-8fff-000000000000",
      version: "00.00.001",
      status: "verified",
    },
    {
      schema_version: 1,
      identity_key: "source:cccccccc-dddd-4eee-8fff-000000000000@00.00.001",
      type: "source",
      id: "cccccccc-dddd-4eee-8fff-000000000000",
      version: "00.00.001",
      status: "invalidated_remote_missing",
    },
  ]);

  try {
    const result = runFoundry([
      "dataset-bafu-batch-import-run",
      "--scope-file",
      rel(scopeFile),
      "--process-bundles-dir",
      rel(bundlesDir),
      "--run-dir",
      rel(runDir),
      "--out-dir",
      rel(outDir),
      "--ledger-source-dir",
      rel(sourceOutDir),
      "--tidas-schema-dir",
      rel(schemaDir),
      "--preflight-only",
      "--pending-only",
      "--selection-order",
      "estimated-weight-asc",
      "--limit",
      "1",
    ]);

    assert.equal(result.code, 0);
    assert.equal(result.json.status, "preflight_completed");
    assert.equal(result.json.counts.selected_scopes, 1);
    assert.equal(result.json.counts.filtered_already_verified_scopes, 1);
    assert.equal(result.json.counts.filtered_already_blocked_scopes, 1);
    assert.equal(result.json.counts.already_verified_scopes, 1);
    assert.equal(result.json.counts.already_verified_flows, 1);
    assert.equal(result.json.counts.already_blocked_scopes, 1);
    assert.equal(result.json.counts.ledger_source_dirs, 1);
    assert.equal(result.json.counts.ledger_source_ok_scope_rows, 1);
    assert.equal(result.json.counts.ledger_source_ok_flow_rows, 1);
    assert.equal(result.json.counts.ledger_source_blocked_scope_rows, 1);
    assert.equal(result.json.support_identity_cache.loaded_from_ledger_sources, 1);
    assert.deepEqual(result.json.selection.ledger_source_dirs, [
      rel(path.join(sourceOutDir, "import-ledger")),
    ]);
    const plan = readJsonLines(path.join(repoRoot, result.json.files.preflight_plan));
    assert.deepEqual(
      plan.map((row) => row.process_id),
      [pendingId],
    );
    const cache = readJsonLines(path.join(repoRoot, result.json.files.support_identity_cache));
    assert.deepEqual(
      cache.map((row) => row.identity_key),
      [
        "source:bbbbbbbb-cccc-4ddd-8eee-ffffffffffff@00.00.001",
        "source:cccccccc-dddd-4eee-8fff-000000000000@00.00.001",
      ],
    );
    assert.equal(cache[0].status, "verified");
    assert.equal(cache[1].status, "invalidated_remote_missing");
    assert.equal(
      cache[0].carried_forward_from,
      rel(path.join(sourceOutDir, "import-ledger", "verified-support-identities.jsonl")),
    );
    const manifest = readJson(path.join(repoRoot, result.json.files.run_manifest));
    assert.equal(manifest.counts.ledger_source_dirs, 1);
    assert.equal(manifest.policy.ledger_source_dirs_are_read_only_carry_forward_inputs, true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("BAFU batch import runner writes read-only preflight plan and primes support identity cache", () => {
  const root = path.join(fixtureRoot, "preflight-support-cache");
  fs.rmSync(root, { recursive: true, force: true });
  const runDir = path.join(root, "run");
  const schemaDir = path.join(root, "schemas");
  const bundlesDir = path.join(root, "process-bundles");
  const outDir = path.join(root, "batch");
  fs.mkdirSync(bundlesDir, { recursive: true });
  writeRequiredContext(runDir, schemaDir);
  const scopeFile = path.join(root, "ready-scopes.jsonl");
  const processIds = [
    "11111111-2222-4333-8444-555555555571",
    "11111111-2222-4333-8444-555555555572",
  ];
  writeJsonLines(scopeFile, [
    {
      schema_version: 1,
      process_id: processIds[0],
      process_version: "00.00.001",
      closure_status: "ready",
      estimated_weight: 10,
    },
    {
      schema_version: 1,
      process_id: processIds[1],
      process_version: "00.00.001",
      closure_status: "ready",
      estimated_weight: 2,
    },
  ]);
  const handoffDir = path.join(
    outDir,
    "scopes",
    "existing",
    "process-e2e",
    "source-contact-support-handoff",
  );
  const supportCommitReport = path.join(
    handoffDir,
    "commit",
    "support-save-draft",
    "outputs",
    "dataset-save-draft",
    "summary.json",
  );
  writeJson(path.join(handoffDir, "closeout", "dataset-post-write-closeout-report.json"), {
    schema_version: 1,
    status: "completed",
    commit_report: rel(supportCommitReport),
  });
  writeJson(supportCommitReport, {
    schema_version: 1,
    commit: true,
    status: "completed",
    rows: [
      {
        id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
        version: "00.00.001",
        type: "contact",
        table: "contacts",
        status: "executed",
      },
      {
        id: "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff",
        version: "00.00.001",
        type: "source",
        table: "sources",
        status: "executed",
      },
    ],
  });

  try {
    const result = runFoundry([
      "dataset-bafu-batch-import-run",
      "--scope-file",
      rel(scopeFile),
      "--process-bundles-dir",
      rel(bundlesDir),
      "--run-dir",
      rel(runDir),
      "--out-dir",
      rel(outDir),
      "--tidas-schema-dir",
      rel(schemaDir),
      "--preflight-only",
      "--pending-only",
      "--selection-order",
      "estimated-weight-asc",
      "--limit",
      "1",
    ]);

    assert.equal(result.code, 0);
    assert.equal(result.json.status, "preflight_completed");
    assert.equal(result.json.mode, "preflight");
    assert.equal(result.json.counts.selected_scopes, 1);
    assert.equal(result.json.counts.processed_scopes, 0);
    assert.equal(result.json.counts.verified_support_identities, 2);
    const plan = readJsonLines(path.join(repoRoot, result.json.files.preflight_plan));
    assert.deepEqual(
      plan.map((row) => row.process_id),
      [processIds[1]],
    );
    const cache = readJsonLines(path.join(repoRoot, result.json.files.support_identity_cache));
    assert.deepEqual(cache.map((row) => row.identity_key).sort(), [
      "contact:aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee@00.00.001",
      "source:bbbbbbbb-cccc-4ddd-8eee-ffffffffffff@00.00.001",
    ]);
    const manifest = readJson(path.join(repoRoot, result.json.files.run_manifest));
    assert.equal(manifest.status, "preflight_completed");
    assert.equal(fs.existsSync(path.join(outDir, "scope-checkpoints.jsonl")), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("BAFU authoring task filter removes rows already rewritten by identity apply", () => {
  const root = path.join(fixtureRoot, "filter-authoring");
  fs.rmSync(root, { recursive: true, force: true });
  const keepId = "22222222-3333-4444-8555-666666666666";
  const skippedId = "33333333-4444-4555-8666-777777777777";
  const rowsFile = path.join(root, "flows.identity-decisions-applied.jsonl");
  const taskManifest = path.join(root, "authoring-task-manifest.json");
  const reportPath = path.join(root, "authoring-task-filter-report.json");
  writeJsonLines(rowsFile, [
    {
      flowDataSet: {
        flowInformation: {
          dataSetInformation: {
            "common:UUID": keepId,
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
  writeJson(taskManifest, {
    schema_version: 1,
    status: "ready_for_ai_authoring_batch",
    tasks: [
      {
        entity: {
          dataset_type: "flow",
          entity_id: keepId,
          version: "00.00.001",
        },
        action_item_count: 2,
        action_items: [{ code: "semantic_name_treatment_placeholder" }, { code: "x" }],
      },
      {
        entity: {
          dataset_type: "flow",
          entity_id: skippedId,
          version: "00.00.001",
        },
        action_item_count: 1,
        action_items: [{ code: "x" }],
      },
    ],
  });

  try {
    const result = filterAuthoringTaskManifestToRows({
      taskManifest,
      rowsFile,
      type: "flow",
      reportPath,
    });
    assert.equal(result.status, "ready_for_ai_authoring_batch");
    assert.notEqual(result.taskManifest, taskManifest);
    const filtered = readJson(result.taskManifest);
    assert.equal(filtered.tasks.length, 1);
    assert.equal(filtered.tasks[0].entity.entity_id, keepId);
    const report = readJson(reportPath);
    assert.equal(report.counts.original_tasks, 2);
    assert.equal(report.counts.retained_tasks, 1);
    assert.equal(report.counts.skipped_tasks, 1);
    assert.equal(report.counts.retained_action_items, 2);
    assert.equal(report.skipped_tasks[0].dataset_id, skippedId);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("BAFU authoring task filter reports ready_no_action_items when retained tasks are already authored", () => {
  // Reuse-heavy scope (e.g. worldsteel): the current-rows filter drops all
  // reuse rows and retains only new rows whose action items are already closed.
  // Those retained tasks carry zero action items, so the filter must report
  // ready_no_action_items and NOT force the autofill-off authoring block.
  const root = path.join(fixtureRoot, "filter-authoring-clean");
  fs.rmSync(root, { recursive: true, force: true });
  const taskManifest = path.join(root, "authoring-task-manifest.json");
  const rowsFile = path.join(root, "flows.identity-decisions-applied.jsonl");
  const reportPath = path.join(root, "authoring-task-filter-report.json");
  const keepId = "11111111-1111-1111-1111-811111111111";
  writeJsonLines(rowsFile, [
    {
      flowDataSet: {
        flowInformation: { dataSetInformation: { "common:UUID": keepId } },
        administrativeInformation: {
          publicationAndOwnership: { "common:dataSetVersion": "00.00.001" },
        },
      },
    },
  ]);
  writeJson(taskManifest, {
    schema_version: 1,
    status: "ready_for_ai_authoring_batch",
    tasks: [
      {
        status: "ready_no_action_items",
        entity: { dataset_type: "flow", entity_id: keepId, version: "00.00.001" },
        action_item_count: 0,
        action_items: [],
      },
    ],
  });
  try {
    const result = filterAuthoringTaskManifestToRows({
      taskManifest,
      rowsFile,
      type: "flow",
      reportPath,
    });
    assert.equal(result.status, "ready_no_action_items");
    const report = readJson(reportPath);
    assert.equal(report.counts.retained_tasks, 1);
    assert.equal(report.counts.retained_action_items, 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("commitFailuresAllAlreadyExist accepts idempotent same-id-version conflicts only", () => {
  const root = path.join(fixtureRoot, "commit-idempotent");
  fs.rmSync(root, { recursive: true, force: true });
  const commitDir = path.join(root, "commit");
  const summaryDir = path.join(commitDir, "contact-save-draft", "outputs", "dataset-save-draft");
  const summaryPath = path.join(summaryDir, "summary.json");
  const handoffPlan = { files: { expected_commit_report_dir: commitDir } };

  // All failures are "same id and version already exists" -> accepted reuse.
  writeJson(summaryPath, {
    status: "completed_with_failures",
    counts: { selected: 1, failed: 1 },
    rows: [
      {
        id: "d5710976-d600-11da-a94d-0800200c9a66",
        version: "20.20.002",
        status: "failed",
        error: {
          message: "HTTP 409 returned from .../app_dataset_create",
          details:
            '{"ok":false,"code":"23505","message":"Dataset with the same id and version already exists"}',
        },
      },
    ],
  });
  let result = bafuBatchImportRunTestHooks.commitFailuresAllAlreadyExist(handoffPlan);
  assert.equal(result.accepted, true);
  assert.equal(result.alreadyExists, 1);
  assert.equal(result.otherFailures, 0);

  // A non-idempotent failure must NOT be accepted.
  writeJson(summaryPath, {
    status: "completed_with_failures",
    counts: { selected: 2, failed: 2 },
    rows: [
      {
        id: "a",
        status: "failed",
        error: {
          message: "HTTP 409",
          details: '{"code":"23505","message":"same id and version already exists"}',
        },
      },
      {
        id: "b",
        status: "failed",
        error: { message: "HTTP 500 internal error", details: '{"code":"XX000","message":"boom"}' },
      },
    ],
  });
  result = bafuBatchImportRunTestHooks.commitFailuresAllAlreadyExist(handoffPlan);
  assert.equal(result.accepted, false);
  assert.equal(result.alreadyExists, 1);
  assert.equal(result.otherFailures, 1);

  fs.rmSync(root, { recursive: true, force: true });
});

test("BAFU batch flow verification filter keeps only flows not in ok flow ledger", () => {
  const root = path.join(fixtureRoot, "flow-filter-carry-forward");
  fs.rmSync(root, { recursive: true, force: true });
  const verifiedId = "44444444-5555-4666-8777-888888888888";
  const pendingId = "55555555-6666-4777-8888-999999999999";
  const rows = [verifiedId, pendingId].map((id) => ({
    flowDataSet: {
      flowInformation: {
        dataSetInformation: {
          "common:UUID": id,
        },
      },
      administrativeInformation: {
        publicationAndOwnership: {
          "common:dataSetVersion": "00.00.001",
        },
      },
    },
  }));
  const plan = bafuBatchImportRunTestHooks.flowRowsPendingVerification(
    rows,
    new Set([`${verifiedId}@00.00.001`]),
  );

  assert.equal(plan.pendingRows.length, 1);
  assert.equal(plan.verifiedRows.length, 1);
  assert.equal(plan.pendingIdentities[0].id, pendingId);
  assert.equal(plan.verifiedIdentities[0].id, verifiedId);
  const ledgerDir = path.join(root, "scope", "import-ledger");
  const sourceRow = {
    schema_version: 1,
    dataset_type: "flow",
    dataset_id: verifiedId,
    dataset_version: "00.00.001",
    status: "verified",
    report: "prior/finalize-report.json",
  };
  const sourceRows = new Map([[`${verifiedId}@00.00.001`, sourceRow]]);

  try {
    const carried = bafuBatchImportRunTestHooks.writeScopeCarriedForwardVerifiedFlowRows({
      ledgerDir,
      processId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
      verifiedIdentities: plan.verifiedIdentities,
      verifiedFlowRowsByKey: sourceRows,
    });
    assert.equal(carried.count, 1);
    const ledgerRows = readJsonLines(path.join(ledgerDir, "ok.flows.verified.jsonl"));
    assert.equal(ledgerRows.length, 1);
    assert.equal(ledgerRows[0].dataset_id, verifiedId);
    assert.equal(ledgerRows[0].carried_forward, true);
    assert.equal(
      ledgerRows[0].carried_forward_for_process_id,
      "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
    );
    assert.equal(ledgerRows[0].report, "prior/finalize-report.json");

    const repeated = bafuBatchImportRunTestHooks.writeScopeCarriedForwardVerifiedFlowRows({
      ledgerDir,
      processId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
      verifiedIdentities: plan.verifiedIdentities,
      verifiedFlowRowsByKey: sourceRows,
    });
    assert.equal(repeated.count, 0);
    assert.equal(readJsonLines(path.join(ledgerDir, "ok.flows.verified.jsonl")).length, 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("BAFU batch import runner preserves blocked pre-finalize when authoring produces no evidence", () => {
  const finalizeReport = {
    status: "blocked",
    blockers: [
      {
        code: "post_authoring_curation_gate_not_ready",
        message: "Curation gate still has unresolved action items.",
      },
    ],
  };

  const blocker = bafuBatchImportRunTestHooks.preFinalizeRecoveryBlocker({
    type: "flow",
    finalizeReport,
    recovery: {
      status: "completed",
      identityApplyReport: null,
      patchCollectReport: null,
      patchApplyReport: null,
    },
  });

  assert.ok(blocker);
  assert.equal(blocker.code, "post_authoring_curation_gate_not_ready");

  const retryBlocker = bafuBatchImportRunTestHooks.preFinalizeRecoveryBlocker({
    type: "flow",
    finalizeReport,
    recovery: {
      status: "completed",
      identityApplyReport: null,
      patchCollectReport: "tmp/authoring-patch-collect-report.json",
      patchApplyReport: null,
    },
  });

  assert.equal(retryBlocker, null);
});

test("BAFU batch import runner blocks unresolved identity reference rows", () => {
  const root = path.join(fixtureRoot, "identity-unresolved-reference");
  fs.rmSync(root, { recursive: true, force: true });
  const unresolvedRows = path.join(root, "identity-unresolved-references.jsonl");
  writeJsonLines(unresolvedRows, [
    {
      dataset_type: "flow",
      dataset_id: "66666666-7777-4888-8999-000000000001",
      version: "00.00.001",
    },
  ]);

  try {
    const blocker = bafuBatchImportRunTestHooks.identityUnresolvedReferenceBlocker({
      type: "flow",
      report: {
        status: "completed",
        counts: {
          identity_unresolved_references: 1,
        },
        files: {
          identity_unresolved_references: rel(unresolvedRows),
        },
      },
    });

    assert.ok(blocker);
    assert.equal(blocker.code, "flow_identity_unresolved_references");
    assert.equal(blocker.unresolved_reference_rows, rel(unresolvedRows));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("BAFU batch import runner merges --process-id-file ids with explicit process ids", () => {
  const root = path.join(fixtureRoot, "process-id-file-merge");
  fs.rmSync(root, { recursive: true, force: true });
  fs.mkdirSync(root, { recursive: true });
  const idFile = path.join(root, "retry-ids.txt");
  fs.writeFileSync(
    idFile,
    [
      "# blocked retry batch",
      "",
      "aaaaaaaa-1111-4111-8111-111111111111",
      "  bbbbbbbb-2222-4222-8222-222222222222  ",
      "# trailing comment",
      "",
    ].join("\n"),
  );

  try {
    const merged = bafuBatchImportRunTestHooks.requestedProcessIdValues({
      processId: "cccccccc-3333-4333-8333-333333333333",
      processIdFile: idFile,
    });
    assert.deepEqual(merged, [
      "cccccccc-3333-4333-8333-333333333333",
      "aaaaaaaa-1111-4111-8111-111111111111",
      "bbbbbbbb-2222-4222-8222-222222222222",
    ]);

    const fileOnly = bafuBatchImportRunTestHooks.requestedProcessIdValues({
      processIdsFile: idFile,
    });
    assert.deepEqual(fileOnly, [
      "aaaaaaaa-1111-4111-8111-111111111111",
      "bbbbbbbb-2222-4222-8222-222222222222",
    ]);

    const absent = bafuBatchImportRunTestHooks.requestedProcessIdValues({
      processId: "cccccccc-3333-4333-8333-333333333333",
    });
    assert.deepEqual(absent, ["cccccccc-3333-4333-8333-333333333333"]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("BAFU batch import runner rejects a missing --process-id-file with the path in the error", () => {
  const missingFile = path.join(fixtureRoot, "process-id-file-missing", "no-such-ids.txt");
  assert.throws(
    () =>
      bafuBatchImportRunTestHooks.requestedProcessIdValues({
        processIdFile: missingFile,
      }),
    (error) =>
      error instanceof Error &&
      error.message.includes("--process-id-file not found:") &&
      error.message.includes(missingFile),
  );
});

function buildScopeScratchDir(label: string) {
  const scopeDir = path.join(fixtureRoot, label, "scopes", processId);
  fs.mkdirSync(path.join(scopeDir, "import-ledger"), { recursive: true });
  fs.writeFileSync(
    path.join(scopeDir, "import-ledger", "ok.processes.verified.jsonl"),
    '{"process_id":"x"}\n',
  );
  fs.writeFileSync(path.join(scopeDir, "scope-run-report.json"), '{"status":"verified"}\n');
  fs.mkdirSync(path.join(scopeDir, "flow-pre-finalize", "mutation-manifest"), { recursive: true });
  fs.writeFileSync(
    path.join(scopeDir, "flow-pre-finalize", "mutation-manifest", "items.jsonl"),
    "heavy",
  );
  fs.mkdirSync(path.join(scopeDir, "flow-identity-task"), { recursive: true });
  fs.mkdirSync(path.join(scopeDir, "logs"), { recursive: true });
  return scopeDir;
}

test("trimVerifiedScopeScratch keeps audit artifacts and removes heavy scratch on commit", () => {
  const scopeDir = buildScopeScratchDir("trim-commit");
  bafuBatchImportRunTestHooks.trimVerifiedScopeScratch(scopeDir, { commit: true });
  assert.equal(
    fs.existsSync(path.join(scopeDir, "import-ledger", "ok.processes.verified.jsonl")),
    true,
  );
  assert.equal(fs.existsSync(path.join(scopeDir, "scope-run-report.json")), true);
  assert.equal(fs.existsSync(path.join(scopeDir, "flow-pre-finalize")), false);
  assert.equal(fs.existsSync(path.join(scopeDir, "flow-identity-task")), false);
  assert.equal(fs.existsSync(path.join(scopeDir, "logs")), false);
});

test("trimVerifiedScopeScratch is a no-op without commit and with keep-scratch", () => {
  const noCommit = buildScopeScratchDir("trim-no-commit");
  bafuBatchImportRunTestHooks.trimVerifiedScopeScratch(noCommit, { commit: false });
  assert.equal(fs.existsSync(path.join(noCommit, "flow-pre-finalize")), true);

  const kept = buildScopeScratchDir("trim-keep-scratch");
  bafuBatchImportRunTestHooks.trimVerifiedScopeScratch(kept, { commit: true, keepScratch: true });
  assert.equal(fs.existsSync(path.join(kept, "flow-pre-finalize")), true);
});

test("trimVerifiedScopeScratch never throws on a missing scope dir", () => {
  assert.doesNotThrow(() =>
    bafuBatchImportRunTestHooks.trimVerifiedScopeScratch(
      path.join(fixtureRoot, "trim-missing", "nope"),
      { commit: true },
    ),
  );
});

test("support identity types stay contact|source for BAFU and add FP/UG only under the mint flag", () => {
  const { setBafuBatchConfigForTest, supportIdentityTypes, splitSupportIdentityKey } =
    bafuBatchImportRunTestHooks;
  try {
    // BAFU (and every non-USLCI profile): support identities are exactly contact|source,
    // so the reuse-skip / cache / cross-scope discovery behavior is unchanged.
    setBafuBatchConfigForTest({});
    assert.deepEqual(supportIdentityTypes(), ["contact", "source"]);
    assert.equal(splitSupportIdentityKey("contact:c1@00.00.001")?.dataset_type, "contact");
    assert.equal(splitSupportIdentityKey("source:s1@00.00.001")?.dataset_type, "source");
    // The wider parser accepts FP/UG keys, but BAFU never produces them.
    assert.equal(
      splitSupportIdentityKey("flowproperty:fp1@00.00.001")?.dataset_type,
      "flowproperty",
    );
    assert.equal(splitSupportIdentityKey("unitgroup:ug1@00.00.001")?.dataset_type, "unitgroup");
    assert.equal(splitSupportIdentityKey("flow:f1@00.00.001"), null);

    // USLCI (--mint-unmatched-fp-ug-support): minted FP/UG are account-local support, so
    // they must be tracked as support identities — otherwise a contact already verified
    // would let the reuse-skip short-circuit an un-committed minted FP/UG and the
    // dependent flow/process never proves reference closure.
    setBafuBatchConfigForTest({ mintUnmatchedFpUgSupport: true });
    assert.deepEqual(supportIdentityTypes(), ["contact", "source", "unitgroup", "flowproperty"]);
  } finally {
    setBafuBatchConfigForTest({});
  }
});

test("supportIdentityKeysFromHandoffPlan extracts minted FP/UG keys only under the mint flag", () => {
  const { setBafuBatchConfigForTest, supportIdentityKeysFromHandoffPlan } =
    bafuBatchImportRunTestHooks;
  const supportDir = path.join(fixtureRoot, "support-identity-keys");
  fs.mkdirSync(supportDir, { recursive: true });
  const supportRowsFile = path.join(supportDir, "support.cleaned.jsonl");
  const ml = (text: string) => ({ "@xml:lang": "en", "#text": text });
  const contactId = "00000000-0000-4000-8000-00000000000c";
  const fpId = "00000000-0000-4000-8000-00000000000f";
  const ugId = "00000000-0000-4000-8000-00000000000a";
  writeJsonLines(supportRowsFile, [
    {
      unitGroupDataSet: {
        unitGroupInformation: {
          dataSetInformation: { "common:UUID": ugId, "common:name": ml("UG") },
        },
        administrativeInformation: {
          publicationAndOwnership: { "common:dataSetVersion": "00.00.001" },
        },
      },
    },
    {
      flowPropertyDataSet: {
        flowPropertiesInformation: {
          dataSetInformation: { "common:UUID": fpId, "common:name": ml("FP") },
        },
        administrativeInformation: {
          publicationAndOwnership: { "common:dataSetVersion": "00.00.001" },
        },
      },
    },
    {
      contactDataSet: {
        contactInformation: {
          dataSetInformation: { "common:UUID": contactId, "common:name": ml("C") },
        },
        administrativeInformation: {
          publicationAndOwnership: { "common:dataSetVersion": "00.00.001" },
        },
      },
    },
  ]);
  const handoffPlan = {
    commands: {
      commit: createFoundryCommandSpec({
        executable: "tiangong-lca",
        argv: ["dataset", "save-draft", "--type", "auto", "--input", supportRowsFile, "--commit"],
        binding: {
          artifacts: [
            createFileArtifactFact({
              role: "final_rows",
              path: supportRowsFile,
              filePath: supportRowsFile,
            }),
          ],
        },
      }),
    },
  };
  try {
    // BAFU: only the contact is tracked — the FP/UG are NOT support identities.
    setBafuBatchConfigForTest({});
    assert.deepEqual(supportIdentityKeysFromHandoffPlan(handoffPlan), [
      `contact:${contactId}@00.00.001`,
    ]);

    // USLCI: the minted FP and its reference UG are tracked alongside the contact, so the
    // support commit is not falsely skipped and the committed FP/UG are reusable.
    setBafuBatchConfigForTest({ mintUnmatchedFpUgSupport: true });
    assert.deepEqual(supportIdentityKeysFromHandoffPlan(handoffPlan).sort(), [
      `contact:${contactId}@00.00.001`,
      `flowproperty:${fpId}@00.00.001`,
      `unitgroup:${ugId}@00.00.001`,
    ]);
  } finally {
    setBafuBatchConfigForTest({});
  }
});

test("enforceSharedContextCacheCap clears the cache only when over the cap", () => {
  const runDir = path.join(fixtureRoot, "context-cache-cap");
  const cacheDir = path.join(runDir, "shared-context-cache");
  fs.mkdirSync(cacheDir, { recursive: true });
  for (let i = 0; i < 3; i += 1) {
    fs.writeFileSync(path.join(cacheDir, `authoring.${i}.json`), "ctx");
  }
  // under cap -> untouched
  bafuBatchImportRunTestHooks.enforceSharedContextCacheCap(runDir, {}, 10);
  assert.equal(fs.readdirSync(cacheDir).length, 3);
  // keep-scratch opt-out -> untouched even over cap
  bafuBatchImportRunTestHooks.enforceSharedContextCacheCap(runDir, { keepScratch: true }, 1);
  assert.equal(fs.readdirSync(cacheDir).length, 3);
  // over cap -> cleared
  bafuBatchImportRunTestHooks.enforceSharedContextCacheCap(runDir, {}, 2);
  assert.equal(fs.readdirSync(cacheDir).length, 0);
});

test("minted flow invalidation removes every content-bound preflight cache entry", () => {
  const root = path.join(fixtureRoot, "identity-binding-cache-invalidation");
  const cacheDir = path.join(root, "cache");
  fs.rmSync(root, { recursive: true, force: true });
  const matching = ["a".repeat(64), "b".repeat(64)];
  const unrelated = "c".repeat(64);
  for (const [binding, id] of [
    [matching[0], "flow-minted"],
    [matching[1], "flow-minted"],
    [unrelated, "flow-other"],
  ]) {
    writeJson(path.join(cacheDir, binding, "foundry-identity-preflight-execution.json"), {
      schema: "tiangong-foundry.identity-preflight-execution.v1",
      binding: {
        dataset: { type: "flow", id, version: "00.00.001" },
      },
    });
  }
  const before = process.env.BAFU_IDENTITY_PREFLIGHT_RESULT_CACHE;
  process.env.BAFU_IDENTITY_PREFLIGHT_RESULT_CACHE = cacheDir;
  try {
    assert.equal(
      bafuBatchImportRunTestHooks.invalidateIdentityPreflightResultCacheEntry(
        "flow:flow-minted@00.00.001",
      ),
      true,
    );
    assert.ok(matching.every((binding) => !fs.existsSync(path.join(cacheDir, binding))));
    assert.equal(fs.existsSync(path.join(cacheDir, unrelated)), true);
  } finally {
    if (before === undefined) delete process.env.BAFU_IDENTITY_PREFLIGHT_RESULT_CACHE;
    else process.env.BAFU_IDENTITY_PREFLIGHT_RESULT_CACHE = before;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

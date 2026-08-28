import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const fixtureRoot = path.join(repoRoot, "tmp", "bafu-leaf-classification-tasks-test");

function rel(filePath: string): string {
  return path.relative(repoRoot, filePath).replaceAll("\\", "/");
}

function writeJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function writeJsonLines(filePath: string, rows: unknown[]): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, rows.map((row) => JSON.stringify(row)).join("\n") + "\n");
}

function readJson(filePath: string) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function readJsonLines(filePath: string) {
  return fs
    .readFileSync(filePath, "utf8")
    .trim()
    .split(/\r?\n/u)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function processPayload({
  id,
  name,
  sourceCategory,
  unit = "kg",
}: {
  id: string;
  name: string;
  sourceCategory: string;
  unit?: string;
}) {
  return {
    processDataSet: {
      processInformation: {
        dataSetInformation: {
          "common:UUID": id,
          name: {
            baseName: { "@xml:lang": "en", "#text": name },
            treatmentStandardsRoutes: {
              "@xml:lang": "en",
              "#text": "at plant",
            },
            mixAndLocationTypes: { "@xml:lang": "en", "#text": "CH" },
          },
          classificationInformation: {
            "common:classification": {
              "common:class": [
                { "@level": "0", "@classId": "T", "#text": "Other service activities" },
                {
                  "@level": "1",
                  "@classId": "94",
                  "#text": "Activities of membership organizations",
                },
              ],
            },
          },
          "common:generalComment": {
            "@xml:lang": "en",
            "#text": `${name} process comment with source evidence.`,
          },
          "common:other": {
            "tidasimport:sourceTrace": {
              payload: {
                sourceObject: `source/${id}.xml`,
                sourceClassification: {
                  category: sourceCategory,
                  subCategory: "fixture",
                },
                dataset: {
                  children: [
                    {
                      name: "metaInformation",
                      children: [
                        {
                          name: "processInformation",
                          children: [
                            {
                              name: "referenceFunction",
                              attributes: [
                                { name: "name", value: name },
                                { name: "category", value: sourceCategory },
                                { name: "unit", value: unit },
                              ],
                            },
                            {
                              name: "geography",
                              attributes: [{ name: "location", value: "CH" }],
                            },
                          ],
                        },
                      ],
                    },
                  ],
                },
              },
            },
          },
        },
      },
    },
  };
}

function runFoundry(command: string, args: string[], expectedStatus = 0) {
  const result = spawnSync(process.execPath, ["scripts/foundry.ts", command, ...args], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  assert.equal(result.status, expectedStatus, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

function runHelper(args: string[]) {
  return runFoundry("dataset-bafu-leaf-classification-tasks-prepare", args);
}

test("BAFU leaf classification helper prepares sharded process authoring tasks", () => {
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
  const indexDir = path.join(fixtureRoot, "library-index");
  const sourceDir = path.join(fixtureRoot, "source");
  const blockedLedger = path.join(fixtureRoot, "library-resolution", "blocked-scope-ledger.jsonl");
  const decisions = path.join(fixtureRoot, "decisions", "classification-decisions.jsonl");
  const outDir = path.join(fixtureRoot, "leaf-authoring");
  const processA = "11111111-2222-4333-8444-555555555555";
  const processB = "22222222-3333-4444-8555-666666666666";
  const processC = "33333333-4444-4555-8666-777777777777";

  const processAFile = path.join(sourceDir, "processes", `${processA}.json`);
  const processBFile = path.join(sourceDir, "processes", `${processB}.json`);
  writeJson(
    processAFile,
    processPayload({ id: processA, name: "Acrylic varnish at plant", sourceCategory: "chemicals" }),
  );
  writeJson(
    processBFile,
    processPayload({
      id: processB,
      name: "Electricity production mix",
      sourceCategory: "electricity",
    }),
  );

  writeJsonLines(path.join(indexDir, "library-entity-index.jsonl"), [
    {
      schema_version: 1,
      entity_key: `process:${processA}:00.00.001`,
      dataset_type: "process",
      dataset_id: processA,
      dataset_version: "00.00.001",
      source_file: rel(processAFile),
      payload_sha256: "aaa",
      semantic_key: "process|acrylic varnish|converted",
      semantic_hash: "hash-a",
      name: "Acrylic varnish at plant",
      classification_path: "Other service activities > Activities of membership organizations",
      references: [
        {
          path: "processDataSet.exchanges.exchange.0.referenceToFlowDataSet",
          type: "flow data set",
          id: "flow-a",
          version: "00.00.001",
          short_description: "Acrylic varnish",
        },
        {
          path: "processDataSet.modellingAndValidation.dataSourcesTreatmentAndRepresentativeness.referenceToDataSource",
          type: "source data set",
          id: "source-a",
          version: "00.00.001",
          short_description: "Fixture source",
        },
      ],
      source_files: [rel(processAFile)],
    },
    {
      schema_version: 1,
      entity_key: `process:${processB}:00.00.001`,
      dataset_type: "process",
      dataset_id: processB,
      dataset_version: "00.00.001",
      source_file: rel(processBFile),
      payload_sha256: "bbb",
      semantic_key: "process|electricity|converted",
      semantic_hash: "hash-b",
      name: "Electricity production mix",
      classification_path: "Other service activities > Activities of membership organizations",
      references: [],
      source_files: [rel(processBFile)],
    },
  ]);
  writeJsonLines(path.join(indexDir, "scope-projection.jsonl"), [
    {
      schema_version: 1,
      process_id: processA,
      process_version: "00.00.001",
      process_entity_key: `process:${processA}:00.00.001`,
      process_file: rel(processAFile),
      bundle_dir: rel(path.join(sourceDir, "process-bundles", processA)),
      manifest: rel(path.join(sourceDir, "process-bundles", processA, "manifest.json")),
      tidas_dir: rel(path.join(sourceDir, "process-bundles", processA, "tidas")),
      dependency_ids: {
        flows: [{ id: "flow-a", version: "00.00.001" }],
        flowproperties: [],
        unitgroups: [],
      },
      usage_refs: {
        process_exchange_flow_refs: [
          {
            exchange_index: 0,
            flow_id: "flow-a",
            flow_version: "00.00.001",
            direction: "Output",
            amount: "1",
            short_description: "Acrylic varnish",
          },
        ],
      },
      estimated_weight: 4,
    },
    {
      schema_version: 1,
      process_id: processB,
      process_version: "00.00.001",
      process_entity_key: `process:${processB}:00.00.001`,
      process_file: rel(processBFile),
      dependency_ids: { flows: [], flowproperties: [], unitgroups: [] },
      usage_refs: { process_exchange_flow_refs: [] },
      estimated_weight: 2,
    },
  ]);
  writeJsonLines(blockedLedger, [
    {
      schema_version: 1,
      blocked_process_id: processA,
      blocked_process_version: "00.00.001",
      blocking_dependency: { dataset_type: "process", id: processA, version: "00.00.001" },
      reason: "process_classification_requires_leaf_authoring",
      message: "Process classification decision is only a broad section.",
      required_human_action: "Run semantic classification authoring.",
      rerun_command: "node scripts/foundry.ts dataset-library-decisions-apply ...",
    },
    {
      schema_version: 1,
      blocked_process_id: processB,
      blocked_process_version: "00.00.001",
      blocking_dependency: { dataset_type: "process", id: processB, version: "00.00.001" },
      reason: "process_classification_requires_leaf_authoring",
      message: "Process classification decision is only a broad section.",
      required_human_action: "Run semantic classification authoring.",
      rerun_command: "node scripts/foundry.ts dataset-library-decisions-apply ...",
    },
    {
      schema_version: 1,
      blocked_process_id: processC,
      blocked_process_version: "00.00.001",
      blocking_dependency: { dataset_type: "flow", id: "flow-c", version: "00.00.001" },
      reason: "elementary_flow_requires_existing_database_match",
    },
  ]);
  writeJsonLines(decisions, [
    {
      schema_version: 1,
      dataset_type: "process",
      dataset_id: processA,
      dataset_version: "00.00.001",
      category_type: "process",
      selected_code: "T",
      basis: "Broad placeholder decision.",
      confidence: "medium",
      decision_status: "completed",
      classification_decision_level: "broad_section",
      rule_hits: ["T"],
    },
  ]);

  const report = runHelper([
    "--library-index",
    rel(indexDir),
    "--blocked-ledger",
    rel(blockedLedger),
    "--library-decisions",
    rel(decisions),
    "--out-dir",
    rel(outDir),
    "--shard-size",
    "1",
  ]);

  assert.equal(report.status, "completed");
  assert.equal(report.counts.unique_leaf_classification_blocked_processes, 2);
  assert.equal(report.counts.selected_tasks, 2);
  assert.equal(report.counts.shards, 2);
  assert.equal(report.counts.attached_existing_library_decisions, 1);
  assert.match(report.input_hashes.blocked_ledger_sha256, /^[a-f0-9]{64}$/u);

  const tasks = readJsonLines(path.join(repoRoot, report.files.tasks));
  assert.equal(tasks.length, 2);
  assert.equal(tasks[0].dataset_id, processA);
  assert.equal(tasks[0].process_context.source_trace.source_classification.category, "chemicals");
  assert.equal(tasks[0].process_context.source_trace.reference_function_attributes.unit, "kg");
  assert.equal(tasks[0].exchange_context.output_flows.rows[0].short_description, "Acrylic varnish");
  assert.equal(tasks[0].existing_library_decision.selected_code, "T");
  assert.equal(tasks[0].decision_template.selected_code, "__AI_SELECT_TIDAS_PROCESS_LEAF_CODE__");
  assert.equal(tasks[0].decision_template.classification_decision_level, "leaf");

  const shardTemplate = readJsonLines(
    path.join(outDir, "shards", "classification-decisions-0000.template.jsonl"),
  );
  assert.equal(shardTemplate.length, 1);
  assert.equal(shardTemplate[0].dataset_id, processA);

  const reportFile = readJson(path.join(repoRoot, report.files.report));
  assert.equal(reportFile.expected_ai_output.broad_codes_rejected, true);
});

test("BAFU leaf category-map projection writes task-bound decisions and candidates separately", () => {
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
  const indexDir = path.join(fixtureRoot, "library-index");
  const sourceDir = path.join(fixtureRoot, "source");
  const blockedLedger = path.join(fixtureRoot, "library-resolution", "blocked-scope-ledger.jsonl");
  const decisionsDir = path.join(fixtureRoot, "decisions");
  const outDir = path.join(fixtureRoot, "projected-decisions");
  const processSchema = path.join(fixtureRoot, "schema", "tidas_processes_category.json");
  const flowProductSchema = path.join(fixtureRoot, "schema", "tidas_flows_product_category.json");
  const categoryDecisionDir = path.join(fixtureRoot, "category-map-decisions");
  const taskDir = path.join(fixtureRoot, "leaf-authoring");
  const processA = "11111111-2222-4333-8444-555555555555";
  const processB = "22222222-3333-4444-8555-666666666666";
  const processC = "33333333-4444-4555-8666-777777777777";
  const processAFile = path.join(sourceDir, "processes", `${processA}.json`);
  const processBFile = path.join(sourceDir, "processes", `${processB}.json`);
  const processCFile = path.join(sourceDir, "processes", `${processC}.json`);

  writeJson(
    processAFile,
    processPayload({ id: processA, name: "Acrylic varnish at plant", sourceCategory: "chemicals" }),
  );
  writeJson(
    processBFile,
    processPayload({
      id: processB,
      name: "Electricity production mix",
      sourceCategory: "electricity",
    }),
  );
  writeJson(
    processCFile,
    processPayload({
      id: processC,
      name: "Electricity, from biogas, at co-generation plant",
      sourceCategory: "electricity",
      unit: "kWh",
    }),
  );
  writeJsonLines(path.join(indexDir, "library-entity-index.jsonl"), [
    {
      schema_version: 1,
      entity_key: `process:${processA}:00.00.001`,
      dataset_type: "process",
      dataset_id: processA,
      dataset_version: "00.00.001",
      source_file: rel(processAFile),
      payload_sha256: "aaa",
      name: "Acrylic varnish at plant",
      classification_path: "Other service activities > Activities of membership organizations",
      references: [],
      source_files: [rel(processAFile)],
    },
    {
      schema_version: 1,
      entity_key: `process:${processB}:00.00.001`,
      dataset_type: "process",
      dataset_id: processB,
      dataset_version: "00.00.001",
      source_file: rel(processBFile),
      payload_sha256: "bbb",
      name: "Electricity production mix",
      classification_path: "Other service activities > Activities of membership organizations",
      references: [],
      source_files: [rel(processBFile)],
    },
    {
      schema_version: 1,
      entity_key: `process:${processC}:00.00.001`,
      dataset_type: "process",
      dataset_id: processC,
      dataset_version: "00.00.001",
      source_file: rel(processCFile),
      payload_sha256: "ccc",
      name: "Electricity, from biogas, at co-generation plant",
      classification_path: "Other service activities > Activities of membership organizations",
      references: [],
      source_files: [rel(processCFile)],
    },
  ]);
  writeJsonLines(path.join(indexDir, "scope-projection.jsonl"), [
    {
      schema_version: 1,
      process_id: processA,
      process_version: "00.00.001",
      process_file: rel(processAFile),
      dependency_ids: { flows: [], flowproperties: [], unitgroups: [] },
      usage_refs: { process_exchange_flow_refs: [] },
    },
    {
      schema_version: 1,
      process_id: processB,
      process_version: "00.00.001",
      process_file: rel(processBFile),
      dependency_ids: { flows: [], flowproperties: [], unitgroups: [] },
      usage_refs: { process_exchange_flow_refs: [] },
    },
    {
      schema_version: 1,
      process_id: processC,
      process_version: "00.00.001",
      process_file: rel(processCFile),
      dependency_ids: { flows: [], flowproperties: [], unitgroups: [] },
      usage_refs: { process_exchange_flow_refs: [] },
    },
  ]);
  writeJsonLines(blockedLedger, [
    {
      schema_version: 1,
      blocked_process_id: processA,
      blocked_process_version: "00.00.001",
      reason: "process_classification_requires_leaf_authoring",
    },
    {
      schema_version: 1,
      blocked_process_id: processB,
      blocked_process_version: "00.00.001",
      reason: "process_classification_requires_leaf_authoring",
    },
    {
      schema_version: 1,
      blocked_process_id: processC,
      blocked_process_version: "00.00.001",
      reason: "process_classification_requires_leaf_authoring",
    },
  ]);
  writeJsonLines(path.join(decisionsDir, "classification-decisions.jsonl"), [
    {
      schema_version: 1,
      dataset_type: "process",
      dataset_id: processA,
      dataset_version: "00.00.001",
      category_type: "process",
      selected_code: "T",
      decision_status: "completed",
      classification_decision_level: "broad_section",
      basis: "Broad placeholder decision.",
    },
    {
      schema_version: 1,
      dataset_type: "flow",
      dataset_id: "flow-a",
      dataset_version: "00.00.001",
      category_type: "flow-product",
      selected_code: "product-flow-leaf",
      decision_status: "completed",
      basis: "Preserve flow decisions.",
    },
    {
      schema_version: 1,
      dataset_type: "flow",
      dataset_id: "flow-b",
      dataset_version: "00.00.001",
      category_type: "flow-product",
      selected_code: "9",
      decision_status: "completed",
      classification_decision_level: "broad_section",
      source_name: "Disposal, Li-ions batteries, mixed technology {GLO}",
      basis: "Broad service section selected from disposal wording.",
    },
    {
      schema_version: 1,
      dataset_type: "flow",
      dataset_id: "flow-c",
      dataset_version: "00.00.001",
      category_type: "flow-product",
      selected_code: "3",
      decision_status: "completed",
      classification_decision_level: "broad_section",
      source_name: "Fixture product requiring human leaf classification",
      basis: "Broad default.",
    },
    {
      schema_version: 1,
      dataset_type: "flow",
      dataset_id: "flow-d",
      dataset_version: "00.00.001",
      category_type: "flow-product",
      selected_code: "5",
      decision_status: "completed",
      classification_decision_level: "broad_section",
      source_name: "Road",
      basis: "Broad construction section selected from source name.",
    },
    {
      schema_version: 1,
      dataset_type: "flow",
      dataset_id: "flow-e",
      dataset_version: "00.00.001",
      category_type: "flow-product",
      selected_code: "5",
      decision_status: "completed",
      classification_decision_level: "broad_section",
      source_name: "Pipeline, natural gas, low pressure distribution",
      basis: "Broad construction section selected from source name.",
    },
    {
      schema_version: 1,
      dataset_type: "flow",
      dataset_id: "flow-f",
      dataset_version: "00.00.001",
      category_type: "flow-product",
      selected_code: "5",
      decision_status: "completed",
      classification_decision_level: "broad_section",
      source_name: "Pipeline, natural gas, long distance",
      basis: "Broad construction section selected from source name.",
    },
    {
      schema_version: 1,
      dataset_type: "flow",
      dataset_id: "flow-g",
      dataset_version: "00.00.001",
      category_type: "flow-product",
      selected_code: "6",
      decision_status: "completed",
      classification_decision_level: "broad_section",
      source_name: "Transport, crude oil, pipeline",
      basis: "Broad service section selected from source name.",
    },
    {
      schema_version: 1,
      dataset_type: "flow",
      dataset_id: "flow-h",
      dataset_version: "00.00.001",
      category_type: "flow-product",
      selected_code: "3",
      decision_status: "completed",
      classification_decision_level: "broad_section",
      source_name: "Polyethylene terephthalate resin",
      basis: "Broad plastics section selected from source name.",
    },
    {
      schema_version: 1,
      dataset_type: "flow",
      dataset_id: "flow-i",
      dataset_version: "00.00.001",
      category_type: "flow-product",
      selected_code: "3",
      decision_status: "completed",
      classification_decision_level: "broad_section",
      source_name: "Polyethylene granulate",
      basis: "Broad plastics section selected from source name.",
    },
    {
      schema_version: 1,
      dataset_type: "flow",
      dataset_id: "flow-j",
      dataset_version: "00.00.001",
      category_type: "flow-product",
      selected_code: "3",
      decision_status: "completed",
      classification_decision_level: "broad_section",
      source_name: "Hydrogen peroxide, without water",
      basis: "Broad chemical section selected from source name.",
    },
    {
      schema_version: 1,
      dataset_type: "flow",
      dataset_id: "flow-k",
      dataset_version: "00.00.001",
      category_type: "flow-product",
      selected_code: "3",
      decision_status: "completed",
      classification_decision_level: "broad_section",
      source_name: "Hydrogen, liquid",
      basis: "Broad chemical section selected from source name.",
    },
    {
      schema_version: 1,
      dataset_type: "flow",
      dataset_id: "flow-l",
      dataset_version: "00.00.001",
      category_type: "flow-product",
      selected_code: "6",
      decision_status: "completed",
      classification_decision_level: "broad_section",
      source_name: "Transport, liquefied natural gas AU, freight ship {OCE}",
      basis: "Broad transport service section selected from source name.",
    },
  ]);
  writeJsonLines(path.join(decisionsDir, "identity-decisions.jsonl"), [
    { schema_version: 1, source_dataset_id: "flow-a", decision: "reuse_existing_reference" },
  ]);
  writeJsonLines(path.join(decisionsDir, "canonical-support-mappings.jsonl"), [
    { schema_version: 1, source_dataset_type: "unitgroup", source_dataset_id: "unit-a" },
  ]);
  writeJson(processSchema, {
    $schema: "http://json-schema.org/draft-07/schema#",
    oneOf: [
      {
        properties: {
          "@level": { const: "3" },
          "@classId": { const: "2013" },
          "#text": { const: "Manufacture of plastics and synthetic rubber in primary forms" },
        },
      },
      {
        properties: {
          "@level": { const: "3" },
          "@classId": { const: "3510" },
          "#text": { const: "Electric power generation, transmission and distribution" },
        },
      },
      {
        properties: {
          "@level": { const: "3" },
          "@classId": { const: "3512" },
          "#text": { const: "Electric power generation activities from renewable sources" },
        },
      },
    ],
  });
  writeJson(flowProductSchema, {
    $schema: "http://json-schema.org/draft-07/schema#",
    oneOf: [
      {
        properties: {
          "@level": { const: "1" },
          "@classId": { const: "39" },
          "#text": { const: "Wastes or scraps" },
        },
      },
      {
        properties: {
          "@level": { const: "2" },
          "@classId": { const: "393" },
          "#text": { const: "Metal wastes or scraps" },
        },
      },
      {
        properties: {
          "@level": { const: "3" },
          "@classId": { const: "3938" },
          "#text": {
            const:
              "Waste and scrap of primary cells, primary batteries and electric accumulators; spent primary cells, primary batteries and electric accumulators",
          },
        },
      },
      {
        properties: {
          "@level": { const: "4" },
          "@classId": { const: "39380" },
          "#text": {
            const:
              "Waste and scrap of primary cells, primary batteries and electric accumulators; spent primary cells, primary batteries and electric accumulators",
          },
        },
      },
      {
        properties: {
          "@level": { const: "4" },
          "@classId": { const: "94321" },
          "#text": { const: "Hazardous waste treatment services" },
        },
      },
      {
        properties: {
          "@level": { const: "4" },
          "@classId": { const: "53211" },
          "#text": { const: "Highways (except elevated highways), streets and roads" },
        },
      },
      {
        properties: {
          "@level": { const: "4" },
          "@classId": { const: "53241" },
          "#text": { const: "Long-distance pipelines" },
        },
      },
      {
        properties: {
          "@level": { const: "4" },
          "@classId": { const: "53251" },
          "#text": { const: "Local pipelines" },
        },
      },
      {
        properties: {
          "@level": { const: "4" },
          "@classId": { const: "65131" },
          "#text": { const: "Transport services via pipeline of petroleum and natural gas" },
        },
      },
      {
        properties: {
          "@level": { const: "4" },
          "@classId": { const: "34710" },
          "#text": { const: "Polymers of ethylene, in primary forms" },
        },
      },
      {
        properties: {
          "@level": { const: "4" },
          "@classId": { const: "34740" },
          "#text": {
            const:
              "Polyacetals, other polyethers and epoxide resins, in primary forms; polycarbonates, alkyd resins, polyallyl esters and other polyesters, in primary forms",
          },
        },
      },
      {
        properties: {
          "@level": { const: "4" },
          "@classId": { const: "34210" },
          "#text": {
            const:
              "Hydrogen, nitrogen, oxygen, carbon dioxide and rare gases; inorganic oxygen compounds of non-metals n.e.c.",
          },
        },
      },
      {
        properties: {
          "@level": { const: "4" },
          "@classId": { const: "34280" },
          "#text": {
            const:
              "Hydrogen peroxide; phosphides; carbides; hydrides, nitrides, azides, silicides and borides",
          },
        },
      },
      {
        properties: {
          "@level": { const: "4" },
          "@classId": { const: "65212" },
          "#text": {
            const: "Coastal and transoceanic water transport services of freight by tankers",
          },
        },
      },
    ],
  });

  runHelper([
    "--library-index",
    rel(indexDir),
    "--blocked-ledger",
    rel(blockedLedger),
    "--library-decisions",
    rel(path.join(decisionsDir, "classification-decisions.jsonl")),
    "--out-dir",
    rel(taskDir),
  ]);
  writeJsonLines(path.join(categoryDecisionDir, "category-map-decisions-0000.jsonl"), [
    {
      schema_version: 1,
      category_key: "chemicals > fixture",
      decision_status: "completed",
      selected_code: "2013",
      selected_label: "Manufacture of plastics and synthetic rubber in primary forms",
      confidence: "high",
      basis: "Acrylic varnish is a chemical product manufacturing process.",
      authoring_context: {
        context_bundle_sha256: "1111111111111111111111111111111111111111111111111111111111111111",
      },
      used_context_kinds: ["bafu_category_map_authoring_task"],
    },
    {
      schema_version: 1,
      category_key: "electricity > fixture",
      decision_status: "manual_review",
      basis: "Fixture intentionally left unresolved.",
    },
  ]);

  const report = runFoundry(
    "dataset-bafu-leaf-classification-category-map-project",
    [
      "--task-dir",
      rel(taskDir),
      "--category-map-decisions-dir",
      rel(categoryDecisionDir),
      "--source-decisions-dir",
      rel(decisionsDir),
      "--process-category-schema",
      rel(processSchema),
      "--flow-product-category-schema",
      rel(flowProductSchema),
      "--out-dir",
      rel(outDir),
    ],
    1,
  );

  assert.equal(report.status, "completed_with_manual_review");
  assert.equal(report.counts.projected_process_decisions, 1);
  assert.equal(report.counts.process_leaf_classification_candidates, 1);
  assert.equal(report.counts.flow_product_classification_candidates, 10);
  assert.equal(report.counts.flow_product_manual_review_rows, 11);
  assert.equal(report.counts.projection_manual_review_rows, 13);
  assert.equal(report.copied_decision_files.length, 2);

  const projected = readJsonLines(path.join(outDir, "classification-decisions.jsonl"));
  const processADecision = projected.find((row) => row.dataset_id === processA);
  const processBDecision = projected.find((row) => row.dataset_id === processB);
  const processCDecision = projected.find((row) => row.dataset_id === processC);
  const flowDecision = projected.find((row) => row.dataset_id === "flow-a");
  const batteryFlowDecision = projected.find((row) => row.dataset_id === "flow-b");
  const unresolvedFlowDecision = projected.find((row) => row.dataset_id === "flow-c");
  const roadDecision = projected.find((row) => row.dataset_id === "flow-d");
  const localPipelineDecision = projected.find((row) => row.dataset_id === "flow-e");
  const longPipelineDecision = projected.find((row) => row.dataset_id === "flow-f");
  const pipelineTransportDecision = projected.find((row) => row.dataset_id === "flow-g");
  const petDecision = projected.find((row) => row.dataset_id === "flow-h");
  const peDecision = projected.find((row) => row.dataset_id === "flow-i");
  const peroxideDecision = projected.find((row) => row.dataset_id === "flow-j");
  const hydrogenDecision = projected.find((row) => row.dataset_id === "flow-k");
  assert.equal(processADecision.selected_code, "2013");
  assert.equal(processADecision.classification_decision_level, "leaf");
  assert.equal(processADecision.evidence.category_key, "chemicals > fixture");
  assert.equal(
    processADecision.authoring_context.context_bundle_sha256,
    "1111111111111111111111111111111111111111111111111111111111111111",
  );
  assert.equal(processBDecision, undefined);
  assert.equal(processCDecision, undefined);
  assert.equal(flowDecision.selected_code, "product-flow-leaf");
  assert.equal(batteryFlowDecision, undefined);
  assert.equal(roadDecision, undefined);
  assert.equal(localPipelineDecision, undefined);
  assert.equal(longPipelineDecision, undefined);
  assert.equal(pipelineTransportDecision, undefined);
  assert.equal(petDecision, undefined);
  assert.equal(peDecision, undefined);
  assert.equal(peroxideDecision, undefined);
  assert.equal(hydrogenDecision, undefined);
  assert.equal(unresolvedFlowDecision, undefined);
  assert.equal(fs.existsSync(path.join(outDir, "identity-decisions.jsonl")), true);
  assert.equal(fs.existsSync(path.join(outDir, "canonical-support-mappings.jsonl")), true);

  const manualReview = readJsonLines(
    path.join(outDir, "classification-decisions.manual-review.jsonl"),
  );
  assert.equal(manualReview[0].dataset_id, processB);
  assert.equal(manualReview[1].dataset_id, processC);
  assert.equal(manualReview[1].candidate_decision.selected_code, "3512");
  assert.equal(manualReview[3].dataset_id, "flow-c");
  const flowCandidates = readJsonLines(
    path.join(outDir, "flow-product-classification-candidates.jsonl"),
  );
  assert.equal(flowCandidates[0].dataset_id, "flow-b");
  assert.equal(flowCandidates[0].decision_status, "candidate_requires_ai_or_human_review");
  assert.equal(flowCandidates.length, 10);
  const lngCandidate = flowCandidates.find((row) => row.dataset_id === "flow-l");
  assert.equal(lngCandidate.selected_code, "65212");
  assert.equal(lngCandidate.evidence.repair_rule, "lng_tanker_transport_service_to_65212");
  const processCandidates = readJsonLines(
    path.join(outDir, "process-leaf-classification-candidates.jsonl"),
  );
  assert.equal(processCandidates[0].dataset_id, processC);
  assert.equal(processCandidates[0].decision_status, "candidate_requires_ai_or_human_review");
});

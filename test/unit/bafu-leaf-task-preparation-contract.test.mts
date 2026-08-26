import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";

import {
  extractBafuLeafProcessPayloadContext,
  projectBafuLeafClassificationTaskArtifacts,
  type BafuLeafTaskProjectionHelpers,
  type JsonRecord,
} from "../../scripts/lib/bafu-classification/task-preparation.ts";

const fixtureRoot = "tmp/bafu-leaf-task-preparation-contract";
const processA = "11111111-1111-4111-8111-111111111111";
const processB = "22222222-2222-4222-8222-222222222222";
const processC = "33333333-3333-4333-8333-333333333333";
const processD = "44444444-4444-4444-8444-444444444444";
const processBFile = `${fixtureRoot}/source/processes/${processB}.json`;
const processCFile = `${fixtureRoot}/source/processes/${processC}.json`;

function textValue(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const record = value as JsonRecord;
    return textValue(record["#text"]) || textValue(record.value);
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const text = textValue(item);
      if (text) return text;
    }
  }
  return "";
}

function ensureArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null || value === "") return [];
  return [value];
}

const helpers: BafuLeafTaskProjectionHelpers = { textValue, ensureArray };

function processPayload(id: string, name: string, sourceCategory: string): JsonRecord {
  return {
    processDataSet: {
      processInformation: {
        dataSetInformation: {
          "common:UUID": id,
          name: {
            baseName: { "@xml:lang": "en", "#text": name },
            treatmentStandardsRoutes: { "@xml:lang": "en", "#text": "at plant" },
            mixAndLocationTypes: { "@xml:lang": "en", "#text": "CH" },
          },
          classificationInformation: {
            "common:classification": {
              "common:class": [
                { "@level": "0", "@classId": "D", "#text": "Manufacturing" },
                { "@level": "1", "@classId": "20", "#text": "Chemicals" },
              ],
            },
          },
          "common:generalComment": {
            "@xml:lang": "en",
            "#text": `${name} source evidence.`,
          },
          "common:other": {
            "tidasimport:sourceTrace": {
              payload: {
                sourceObject: `source/${id}.xml`,
                sourceClassification: { category: sourceCategory, subCategory: "fixture" },
                dataset: {
                  children: [
                    {
                      name: "processInformation",
                      children: [
                        {
                          name: "referenceFunction",
                          attributes: [
                            { name: "name", value: name },
                            { name: "category", value: sourceCategory },
                            { name: "unit", value: "kg" },
                          ],
                        },
                        { name: "geography", attributes: [{ name: "location", value: "CH" }] },
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

const entityRows: JsonRecord[] = [
  {
    schema_version: 1,
    entity_key: `process:${processA}:00.00.001`,
    dataset_type: "process",
    dataset_id: processA,
    dataset_version: "00.00.001",
    source_file: `${fixtureRoot}/source/processes/${processA}.json`,
    payload_sha256: "payload-a",
    name: "Skipped process",
    references: [],
  },
  {
    schema_version: 1,
    entity_key: `process:${processC}:00.00.001`,
    dataset_type: "process",
    dataset_id: processC,
    dataset_version: "00.00.001",
    source_file: processCFile,
    source_files: [processCFile],
    payload_sha256: "payload-c",
    semantic_key: "process|acrylic resin|converted",
    semantic_hash: "semantic-c",
    name: "Acrylic resin production",
    classification_path: "Manufacturing > Chemicals",
    references: [
      { type: "source data set", id: "source-c-1", version: "00.00.001" },
      { type: "source data set", id: "source-c-2", version: "00.00.001" },
      { type: "contact data set", id: "contact-c", version: "00.00.001" },
    ],
  },
  {
    schema_version: 1,
    dataset_type: "flow",
    dataset_id: "ignored-flow",
    dataset_version: "00.00.001",
  },
];

const scopeRows: JsonRecord[] = [
  {
    schema_version: 1,
    process_id: processA,
    process_version: "00.00.001",
    process_file: `${fixtureRoot}/source/processes/${processA}.json`,
    dependency_ids: { flows: [], flowproperties: [], unitgroups: [] },
    usage_refs: { process_exchange_flow_refs: [] },
  },
  {
    schema_version: 1,
    process_id: processB,
    process_version: "00.00.001",
    process_file: processBFile,
    bundle_dir: `${fixtureRoot}/bundles/${processB}`,
    manifest: `${fixtureRoot}/bundles/${processB}/manifest.json`,
    tidas_dir: `${fixtureRoot}/bundles/${processB}/tidas`,
    dependency_ids: {
      flows: [{ id: "flow-b-1" }, { id: "flow-b-2" }],
      sources: [{ id: "source-b" }],
    },
    usage_refs: {
      process_exchange_flow_refs: [
        { direction: "Output", flow_id: "flow-b-1", short_description: "Recovered solvent" },
        { direction: "Output", flow_id: "flow-b-2", short_description: "Residue" },
        { direction: "Input", flow_id: "flow-b-3", short_description: "Waste solvent" },
      ],
    },
    estimated_weight: 7,
  },
];

const blockedRows: JsonRecord[] = [
  {
    blocked_process_id: processA,
    blocked_process_version: "00.00.001",
    reason: "process_classification_requires_leaf_authoring",
    message: "skip via offset",
  },
  {
    blocked_process_id: processB,
    blocked_process_version: "00.00.001",
    reason: "process_classification_requires_leaf_authoring",
    message: "first duplicate wins",
    required_human_action: "Author a process leaf classification.",
    rerun_command: "node scripts/foundry.ts dataset-library-decisions-apply ...",
  },
  {
    blocked_process_id: processB,
    blocked_process_version: "00.00.001",
    reason: "process_classification_requires_leaf_authoring",
    message: "ignored duplicate",
  },
  {
    blocking_dependency: { id: processC, version: "00.00.001" },
    reason: "process_classification_requires_leaf_authoring",
    message: "scope projection missing",
  },
  { blocked_process_id: processD, reason: "elementary_flow_requires_existing_database_match" },
];

const decisionRows: JsonRecord[] = [
  {
    dataset_type: "process",
    dataset_id: processB,
    dataset_version: "00.00.001",
    selected_code: "D",
    basis: "Broad section placeholder.",
    confidence: "medium",
    source_name: "Waste solvent treatment",
    classification_decision_level: "broad_section",
    rule_hits: ["D"],
  },
];

function jsonLines(rows: readonly unknown[]): string {
  return rows.length > 0 ? `${rows.map((row) => JSON.stringify(row)).join("\n")}\n` : "";
}

function sha256(bytes: string): string {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function assertArtifact(bytes: string, expectedBytes: number, expectedSha256: string): void {
  assert.equal(Buffer.byteLength(bytes), expectedBytes);
  assert.equal(sha256(bytes), expectedSha256);
}

test("leaf task preparation preserves realistic blocked-process projection and exact artifacts", () => {
  const processPayloads = new Map<string, JsonRecord>([
    [processBFile, processPayload(processB, "Waste solvent treatment", "waste treatment")],
    [processCFile, processPayload(processC, "Acrylic resin production", "chemicals")],
  ]);
  const projection = projectBafuLeafClassificationTaskArtifacts({
    entityRows,
    scopeRows,
    blockedRows,
    decisionRows,
    helpers,
    readProcessContext(filePath) {
      const payload = processPayloads.get(textValue(filePath));
      return payload ? extractBafuLeafProcessPayloadContext(payload, helpers) : null;
    },
    selection: {
      offset: 1,
      limit: 2,
      shardSize: 1,
      maxExchangeRefs: 1,
      maxReferences: 1,
    },
    report: {
      generatedAtUtc: "2026-08-26T00:00:00.000Z",
      command: "dataset-bafu-leaf-classification-tasks-prepare",
      inputs: {
        library_index: `${fixtureRoot}/library-index`,
        library_entity_index: `${fixtureRoot}/library-index/library-entity-index.jsonl`,
        scope_projection: `${fixtureRoot}/library-index/scope-projection.jsonl`,
        blocked_ledger: `${fixtureRoot}/blocked-scope-ledger.jsonl`,
        library_decisions: `${fixtureRoot}/classification-decisions.jsonl`,
      },
      inputHashes: {
        library_entity_index_sha256:
          "b97ac2699414f259c24213250f8bd978b99d5a1484be5bec568d34a8e4142406",
        scope_projection_sha256: "67094ca9fffff49190f99c56b9a54f61e170b45369fc4f278738fd09c89086e3",
        blocked_ledger_sha256: "e9ff8484d67dc633d13cba591beb9e62598c8027729b2e799fe25eaa92519e09",
        library_decisions_sha256:
          "4bf01ec6ad811bc1abdcf5a321199c3e41064eb08617a9a5428390ba2c847047",
      },
      files: {
        report: `${fixtureRoot}/out/leaf-process-classification-task-report.json`,
        tasks: `${fixtureRoot}/out/leaf-process-classification-tasks.jsonl`,
        template: `${fixtureRoot}/out/classification-decisions.template.jsonl`,
        shardTasks: (shardId) =>
          `${fixtureRoot}/out/shards/leaf-process-classification-tasks-${shardId}.jsonl`,
        shardTemplate: (shardId) =>
          `${fixtureRoot}/out/shards/classification-decisions-${shardId}.template.jsonl`,
      },
    },
  });

  assert.deepEqual(
    projection.tasks.map((task) => task.dataset_id),
    [processB, processC],
  );
  const firstTask = projection.tasks[0];
  const secondTask = projection.tasks[1];
  assert.ok(firstTask);
  assert.ok(secondTask);
  assert.deepEqual(Object.keys(firstTask), [
    "schema_version",
    "task_kind",
    "task_id",
    "status",
    "dataset_type",
    "dataset_id",
    "dataset_version",
    "entity_key",
    "blocked_scope",
    "library_index_context",
    "process_context",
    "reference_context",
    "exchange_context",
    "existing_library_decision",
    "authoring_requirement",
    "decision_template",
  ]);
  assert.equal((firstTask.blocked_scope as JsonRecord).message, "first duplicate wins");
  assert.deepEqual(projection.contextGaps, {
    missingLibraryEntityRows: 1,
    missingScopeProjectionRows: 1,
  });
  assert.equal((firstTask.library_index_context as JsonRecord).entity_row_found, false);
  assert.equal((secondTask.library_index_context as JsonRecord).scope_projection_found, false);
  assert.deepEqual((firstTask.exchange_context as JsonRecord).output_flows, {
    rows: [{ direction: "Output", flow_id: "flow-b-1", short_description: "Recovered solvent" }],
    total_rows: 2,
    truncated: true,
  });

  assertArtifact(
    jsonLines(projection.tasks),
    9463,
    "1425985e9e98ad8224032cf294fa3f166443246702496a5c44a47c180e0f387e",
  );
  assertArtifact(
    jsonLines(projection.templates),
    2791,
    "2e9f8a7181450fcaac5d90cd92aea3c5d250df3e3f6221fc797820f467d86c53",
  );
  assert.deepEqual(
    projection.shards.map((shard) => shard.shardId),
    ["0000", "0001"],
  );
  assertArtifact(
    jsonLines(projection.shards[0]?.tasks ?? []),
    5061,
    "2f9ee9f18a3348935a555e5adfcf9fed843987d9c8fd1df1b6d7586916de51b0",
  );
  assertArtifact(
    jsonLines(projection.shards[0]?.templates ?? []),
    1404,
    "9ee71a737491dbb3eadb922e4d7ee1e37256dca98e4018e738e85b6adac5b851",
  );
  assertArtifact(
    jsonLines(projection.shards[1]?.tasks ?? []),
    4402,
    "f00b3d534fb827e8fce9577e6c853ff2ffc9b0f206f76a8fe3db2ff955500721",
  );
  assertArtifact(
    jsonLines(projection.shards[1]?.templates ?? []),
    1387,
    "4b582338dfc07efa81783e500d503c6dce4fa22fef6f28f8fedce37e0f927126",
  );
  assert.deepEqual(Object.keys(projection.report), [
    "schema_version",
    "generated_at_utc",
    "status",
    "command",
    "inputs",
    "input_hashes",
    "counts",
    "selection",
    "files",
    "expected_ai_output",
    "next_step",
  ]);
  assert.deepEqual(projection.report.counts, {
    blocked_ledger_rows: 5,
    unique_leaf_classification_blocked_processes: 3,
    selected_tasks: 2,
    shards: 2,
    missing_library_entity_rows: 1,
    missing_scope_projection_rows: 1,
    attached_existing_library_decisions: 1,
  });
  assertArtifact(
    `${JSON.stringify(projection.report, null, 2)}\n`,
    3065,
    "342ae57caf82b08c6067184ce84874e119a116508bc0b3a21d04929d3f7d87f2",
  );
});

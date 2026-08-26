import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  categoryKeyForLeafTask,
  categoryKeyForMapDecision,
  classificationDecisionIsBroadFlowProduct,
  classificationRepairCandidate,
  flowProductLeafRepairRule,
  normalizedSourceName,
  processLeafRepairRule,
  repairBroadFlowProductDecision,
  repairProcessLeafDecision,
  taskReferenceUnit,
  type JsonRecord,
  type LeafCategorySchema,
} from "../../scripts/lib/bafu-classification/leaf-repair.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const leafPath = path.join(repoRoot, "scripts/lib/bafu-classification/leaf-repair.ts");
const ownerPath = path.join(repoRoot, "scripts/commands/bafu-leaf-classification-tasks.ts");

function isJsonRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function jsonRecord(value: unknown): JsonRecord {
  return isJsonRecord(value) ? value : {};
}

function categorySchema(entries: Readonly<Record<string, string>>): LeafCategorySchema {
  const schemaEntries = Object.entries(entries).map(([code, label]) => ({
    code,
    level: "4",
    label,
  }));
  return {
    byCode: new Map(schemaEntries.map((entry) => [entry.code, entry])),
    leafCodes: new Set(schemaEntries.map((entry) => entry.code)),
  };
}

function assertFrozen(
  name: string,
  value: unknown,
  expectedBytes: number,
  expectedSha256: string,
): void {
  const serialized = JSON.stringify(value);
  assert.equal(Buffer.byteLength(serialized), expectedBytes, `${name}: byte count`);
  assert.equal(
    createHash("sha256").update(serialized).digest("hex"),
    expectedSha256,
    `${name}: sha256`,
  );
}

const broadFlowDecision: JsonRecord = {
  schema_version: 1,
  dataset_type: "flow",
  dataset_id: "flow-b",
  dataset_version: "00.00.001",
  entity_key: "flow:flow-b:00.00.001",
  category_type: "flow-product",
  selected_code: "9",
  decision_status: "completed",
  classification_decision_level: "broad_section",
  source_name: "Disposal, Li-ions batteries, mixed technology {GLO}",
  basis: "Broad service section selected from disposal wording.",
  used_context_kinds: ["library_entity_index"],
  authoring_context: { context_bundle_sha256: "abc" },
};

const processTask: JsonRecord = {
  schema_version: 1,
  task_kind: "bafu_process_leaf_classification_authoring",
  task_id: "process:p1:00.00.001",
  dataset_type: "process",
  dataset_id: "p1",
  dataset_version: "00.00.001",
  entity_key: "process:p1:00.00.001",
  process_context: {
    name: "Electricity, from biogas and coal, at co-generation plant",
    converted_classification_path: "Other > broad",
    name_parts: { functional_unit_flow_properties: "kWh" },
    general_comment: "Biogas and hard coal generation.",
    source_trace: {
      source_classification: { category: "electricity", subCategory: "fixture" },
      reference_function_attributes: {
        name: "Electricity, from biogas and coal",
        unit: "kWh",
        category: "electricity",
      },
    },
  },
  library_index_context: {
    root_process_file: "root/process.json",
    bundle_process_file: "bundle/process.json",
    payload_sha256: "deadbeef",
  },
  exchange_context: {
    output_flows: { rows: [{ name: "Electricity" }], total_rows: 1, truncated: false },
  },
};

test("BAFU leaf repair is a pure typed leaf and the command owner imports it", () => {
  const moduleSource = fs.readFileSync(leafPath, "utf8");
  const ownerSource = fs.readFileSync(ownerPath, "utf8");

  assert.doesNotMatch(
    moduleSource,
    /from\s+["']node:|\bprocess\.(?:env|cwd|argv|platform)\b|\bfetch\s*\(|\bXMLHttpRequest\b|\bruntime\s*\(/u,
  );
  assert.doesNotMatch(moduleSource, /^(?:let|var|const)\s+/gmu);
  assert.match(moduleSource, /export type JsonRecord = Record<string, unknown>/u);
  assert.match(moduleSource, /export interface LeafCategorySchema\s*\{/u);
  assert.match(ownerSource, /from "\.\.\/lib\/bafu-classification\/leaf-repair\.ts"/u);
  for (const functionName of [
    "normalizedText",
    "classificationDecisionIsBroadFlowProduct",
    "normalizedSourceName",
    "flowProductLeafRepairRule",
    "repairBroadFlowProductDecision",
    "classificationRepairCandidate",
    "categoryKeyFromParts",
    "sourceClassificationFromTask",
    "categoryKeyForLeafTask",
    "categoryKeyForMapDecision",
    "normalizedTaskProcessName",
    "taskSourceTraceText",
    "taskReferenceUnit",
    "processLeafRepairRule",
    "repairProcessLeafDecision",
  ]) {
    assert.doesNotMatch(
      ownerSource,
      new RegExp(`function ${functionName}\\s*\\(`, "u"),
      `${functionName} must not remain implemented in the command owner`,
    );
  }
});

test("flow-product rules preserve normalization and specific-before-general precedence", () => {
  assert.equal(
    normalizedSourceName({ source_name: "  XX Electricity, medium voltage {CH} " }),
    "electricity medium voltage ch",
  );
  assert.equal(
    flowProductLeafRepairRule({ source_name: "Polyethylene terephthalate resin" })?.code,
    "34740",
    "PET must win before the broader polyethylene rule",
  );
  assert.equal(
    flowProductLeafRepairRule({
      source_name: "Pipeline, natural gas, low pressure distribution",
    })?.code,
    "53251",
    "local pipeline must win before the generic pipeline rule",
  );
  assert.equal(
    flowProductLeafRepairRule(broadFlowDecision)?.code,
    "94321",
    "disposal service must not be misclassified as a battery product or scrap flow",
  );
  assert.equal(flowProductLeafRepairRule({ source_name: "Spent battery scrap" })?.code, "39380");
  assert.equal(flowProductLeafRepairRule({ source_name: "Heat pump installation" }), null);
});

test("flow-product repair keeps the broad-only gate and exact candidate decision bytes", () => {
  const schema = categorySchema({ "94321": "Hazardous waste treatment services" });
  assert.equal(classificationDecisionIsBroadFlowProduct(broadFlowDecision), true);
  assert.equal(
    repairBroadFlowProductDecision(
      {
        ...broadFlowDecision,
        selected_code: "94321",
        classification_decision_level: "leaf",
      },
      schema,
    ),
    null,
  );

  const repaired = repairBroadFlowProductDecision(broadFlowDecision, schema);
  assert.ok(repaired);
  const candidate = classificationRepairCandidate(repaired, {
    candidateType: "flow_product_leaf",
    ruleSource: "bafu_flow_product_leaf_repair",
  });
  assert.deepEqual(Object.keys(repaired), [
    "schema_version",
    "dataset_type",
    "dataset_id",
    "dataset_version",
    "entity_key",
    "category_type",
    "selected_code",
    "decision_status",
    "classification_decision_level",
    "source_name",
    "basis",
    "used_context_kinds",
    "authoring_context",
    "code",
    "selected_label",
    "confidence",
    "converted_classification_reference_policy",
    "evidence",
  ]);
  assertFrozen(
    "flow repair",
    repaired,
    1502,
    "724e18c96a112b8dc87a2e194b4074c19e97fb114658d88608e0ba3c0cbc57c0",
  );
  assertFrozen(
    "flow candidate",
    candidate,
    2048,
    "a6b7098d3b8eaa55c1704086816ce6a27f0e28f576495fbd5b878a26c397c9e2",
  );
});

test("process rules preserve trace, unit, ambiguity, and precedence contracts", () => {
  const processContext = jsonRecord(processTask.process_context);
  const sourceTrace = jsonRecord(processContext.source_trace);
  assert.equal(categoryKeyForLeafTask(processTask), "electricity > fixture");
  assert.equal(
    categoryKeyForMapDecision({
      category_key: "explicit > key",
      source_category: "ignored",
      source_subcategory: "ignored",
    }),
    "explicit > key",
  );
  assert.equal(categoryKeyForLeafTask({}), "");
  assert.equal(taskReferenceUnit(processTask), "kwh");
  assert.equal(
    processLeafRepairRule(processTask)?.code,
    "3512",
    "renewable evidence keeps precedence when the same trace also mentions coal",
  );

  const pipelineTask: JsonRecord = {
    ...processTask,
    process_context: {
      ...processContext,
      name: "Natural gas, low pressure distribution",
      general_comment: "Pipeline distribution network",
      name_parts: { functional_unit_flow_properties: "kg" },
    },
  };
  assert.equal(
    processLeafRepairRule(pipelineTask)?.code,
    "4930",
    "pipeline transport keeps precedence over gas distribution evidence",
  );
  assert.equal(
    processLeafRepairRule({
      ...processTask,
      process_context: {
        ...processContext,
        name: "Heat pump operation",
        general_comment: "Heat pump operation",
        name_parts: { functional_unit_flow_properties: "MJ" },
      },
    }),
    null,
  );
  assert.equal(
    processLeafRepairRule({
      ...processTask,
      process_context: {
        ...processContext,
        name_parts: { functional_unit_flow_properties: "kg" },
        source_trace: {
          ...sourceTrace,
          reference_function_attributes: {
            name: "Electricity, from biogas and coal",
            unit: "kg",
            category: "electricity",
          },
        },
      },
    }),
    null,
    "electricity without the required kWh unit remains unresolved",
  );
});

test("process repair and candidate retain exact field order and SHA", () => {
  const schema = categorySchema({
    "3512": "Electric power generation activities from renewable sources",
    "3511": "Electric power generation activities from non-renewable sources",
  });
  const repaired = repairProcessLeafDecision({
    task: processTask,
    categoryKey: categoryKeyForLeafTask(processTask),
    existingDecision: {
      selected_code: "D",
      classification_decision_level: "broad_section",
      basis: "Broad",
    },
    processSchema: schema,
  });
  assert.ok(repaired);
  const candidate = classificationRepairCandidate(repaired, {
    candidateType: "process_leaf",
    ruleSource: "bafu_process_leaf_repair",
  });
  assert.deepEqual(Object.keys(repaired), [
    "schema_version",
    "dataset_type",
    "dataset_id",
    "dataset_version",
    "entity_key",
    "category_type",
    "decision_status",
    "selected_code",
    "code",
    "selected_label",
    "basis",
    "confidence",
    "classification_decision_level",
    "source_name",
    "converted_classification_reference",
    "converted_classification_reference_policy",
    "used_context_kinds",
    "evidence",
  ]);
  assertFrozen(
    "process repair",
    repaired,
    1884,
    "c54f773d52109c2c4f9d20c39f88e6869d4d65c1f49165c75b4f46ccf2ff60c6",
  );
  assertFrozen(
    "process candidate",
    candidate,
    2445,
    "683ee10d9e486511125666555c349547186dfe559515c898354bb7ae295996e9",
  );
});

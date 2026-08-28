import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  buildBafuLeafCategoryMapProjectReport,
  parseBafuFlowProductCategorySchema,
  parseBafuProcessCategorySchema,
  projectBafuLeafCategoryMapArtifacts,
  type BafuLeafCategoryMapHelpers,
  type BafuLeafCategoryMapProjection,
} from "../../scripts/lib/bafu-classification/category-map-projection.ts";
import type { JsonRecord } from "../../scripts/lib/bafu-classification/leaf-repair.ts";

const contextSha = "a".repeat(64);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

function textValue(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

function ensureArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null || value === "") return [];
  return [value];
}

const helpers: BafuLeafCategoryMapHelpers = {
  textValue,
  ensureArray,
  reportPath: (filePath) => filePath.replace(/^\/repo\//u, ""),
};

function schemaEntry(level: string, code: string, label: string): JsonRecord {
  return {
    properties: {
      "@level": { const: level },
      "@classId": { const: code },
      "#text": { const: label },
    },
  };
}

const processSchema = parseBafuProcessCategorySchema({
  path: "/repo/schema/tidas_processes_category.json",
  schema: {
    oneOf: [
      schemaEntry("3", "2013", "Manufacture of plastics and synthetic rubber"),
      schemaEntry("3", "3512", "Renewable electricity generation"),
      schemaEntry("3", "2021", "Manufacture of pesticides and agrochemicals"),
    ],
  },
  helpers,
});

const flowProductSchema = parseBafuFlowProductCategorySchema({
  path: "/repo/schema/tidas_flows_product_category.json",
  schema: {
    oneOf: [
      schemaEntry("1", "17", "Electricity, town gas, steam and hot water"),
      schemaEntry("4", "17100", "Electrical energy"),
    ],
  },
  helpers,
});

function task({
  id,
  name,
  category,
  subcategory,
  unit = "kg",
}: {
  id: string;
  name: string;
  category: string;
  subcategory: string;
  unit?: string;
}): JsonRecord {
  return {
    schema_version: 1,
    task_id: `process:${id}:00.00.001`,
    dataset_id: id,
    dataset_version: "00.00.001",
    entity_key: `process:${id}:00.00.001`,
    process_context: {
      name,
      name_parts: { base_name: name, functional_unit_flow_properties: unit },
      converted_classification_path: "Other service activities > broad placeholder",
      source_trace: {
        source_classification: { category, subCategory: subcategory },
        reference_function_attributes: { name, unit },
      },
    },
    library_index_context: {
      root_process_file: `source/processes/${id}.json`,
      bundle_process_file: `bundles/${id}/tidas/processes/${id}.json`,
      payload_sha256: `payload-${id}`,
    },
    exchange_context: {
      output_flows: { rows: [{ direction: "Output", short_description: `${name} output` }] },
    },
    decision_template: {
      evidence: { broad_decision_replaced: { selected_code: "T", basis: "Broad source hint." } },
    },
  };
}

const tasks: JsonRecord[] = [
  task({
    id: "p-resolved",
    name: "Acrylic coating production",
    category: "chemicals",
    subcategory: "coatings",
  }),
  task({
    id: "p-conflict",
    name: "Electricity, from biogas, at co-generation plant",
    category: "electricity",
    subcategory: "renewable",
    unit: "kWh",
  }),
  task({
    id: "p-invalid",
    name: "Generic transformation",
    category: "industry",
    subcategory: "invalid",
  }),
  task({
    id: "p-context",
    name: "Generic source process",
    category: "industry",
    subcategory: "missing context",
  }),
  task({
    id: "p-pending",
    name: "Generic pending process",
    category: "industry",
    subcategory: "pending",
  }),
  task({
    id: "p-candidate",
    name: "Pesticide manufacture",
    category: "agriculture",
    subcategory: "unmapped",
  }),
];

const resolvedDecision: JsonRecord = {
  schema_version: 1,
  category_key: "chemicals > coatings",
  decision_status: "completed",
  selected_code: "2013",
  selected_label: "ignored decision label",
  confidence: "high",
  basis: "Source category and product context identify chemical manufacturing.",
  authoring_context: { context_bundle_sha256: contextSha },
  used_context_kinds: ["bafu_category_map_authoring_task"],
  evidence: {
    category_semantics: "Coatings and varnishes are manufactured chemical products.",
    examples_used: ["Acrylic coating production"],
  },
};

const categoryDecisionSources = [
  {
    file: "/repo/decisions/category-map-0000.jsonl",
    rows: [
      resolvedDecision,
      {
        category_key: "electricity > renewable",
        decision_status: "completed",
        selected_code: "3512",
        basis: "Renewable electricity evidence.",
        authoring_context: { context_bundle_sha256: "b".repeat(64) },
      },
      {
        category_key: "electricity > renewable",
        decision_status: "completed",
        selected_code: "2021",
        basis: "Conflicting agrochemical code.",
        authoring_context: { context_bundle_sha256: "c".repeat(64) },
      },
    ],
  },
  {
    file: "/repo/decisions/category-map-0001.jsonl",
    rows: [
      {
        category_key: "industry > invalid",
        decision_status: "completed",
        selected_code: "9999",
        basis: "Unknown code.",
        authoring_context: { context_bundle_sha256: "d".repeat(64) },
      },
      {
        category_key: "industry > missing context",
        decision_status: "completed",
        selected_code: "2013",
        basis: "Valid leaf without task binding.",
      },
      {
        category_key: "industry > pending",
        decision_status: "manual_review",
        basis: "No completed semantic choice yet.",
      },
      { decision_status: "completed", selected_code: "2013", basis: "No category key." },
    ],
  },
];

const originalClassificationRows: JsonRecord[] = [
  {
    schema_version: 1,
    dataset_type: "process",
    dataset_id: "p-resolved",
    dataset_version: "00.00.001",
    category_type: "process",
    selected_code: "T",
    decision_status: "completed",
    classification_decision_level: "broad_section",
    basis: "Broad source hint.",
  },
  {
    schema_version: 1,
    dataset_type: "flow",
    dataset_id: "flow-keep",
    dataset_version: "00.00.001",
    category_type: "flow-product",
    selected_code: "17100",
    decision_status: "completed",
    classification_decision_level: "leaf",
    basis: "Already leaf-classified.",
  },
  {
    schema_version: 1,
    dataset_type: "flow",
    dataset_id: "flow-candidate",
    dataset_version: "00.00.001",
    category_type: "flow-product",
    selected_code: "17",
    decision_status: "completed",
    classification_decision_level: "broad_section",
    source_name: "Electricity, medium voltage",
    basis: "Broad electricity product section.",
  },
  {
    schema_version: 1,
    dataset_type: "flow",
    dataset_id: "flow-manual",
    dataset_version: "00.00.001",
    category_type: "flow-product",
    selected_code: "17",
    decision_status: "completed",
    classification_decision_level: "broad_section",
    source_name: "Unrecognized energy carrier",
    basis: "Broad unresolved product section.",
  },
];

function jsonLines(rows: readonly unknown[]): string {
  return rows.length > 0 ? `${rows.map((row) => JSON.stringify(row)).join("\n")}\n` : "";
}

function prettyJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function sha256(bytes: string): string {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function artifactFact(bytes: string): { bytes: number; sha256: string } {
  return { bytes: Buffer.byteLength(bytes), sha256: sha256(bytes) };
}

function semanticSnapshot(projection: BafuLeafCategoryMapProjection): JsonRecord {
  return {
    process_schema: {
      entries: processSchema.entries,
      leaf_codes: [...processSchema.leafCodes],
    },
    flow_product_schema: {
      entries: flowProductSchema.entries,
      leaf_codes: [...flowProductSchema.leafCodes],
    },
    resolved: [...projection.categoryMap.resolved.entries()],
    category_map_manual_review: projection.categoryMap.manualReview,
    classification_rows: projection.classificationRows,
    projection_manual_review: projection.projectionManualReview,
    process_leaf_candidates: projection.processLeafCandidates,
    flow_product_candidates: projection.flowProductCandidates,
    flow_product_manual_review: projection.flowProductManualReview,
    category_manual_review: projection.categoryManualReview,
  };
}

test("category-map semantics stay below the command I/O boundary and module ceilings", () => {
  const moduleSource = fs.readFileSync(
    path.join(repoRoot, "scripts/lib/bafu-classification/category-map-projection.ts"),
    "utf8",
  );
  const ownerSource = fs.readFileSync(
    path.join(repoRoot, "scripts/commands/bafu-leaf-classification-tasks.ts"),
    "utf8",
  );
  assert.ok(moduleSource.trimEnd().split("\n").length <= 800);
  assert.ok(ownerSource.trimEnd().split("\n").length <= 500);
  assert.doesNotMatch(
    moduleSource,
    /from\s+["']node:|\bprocess\.(?:env|cwd|argv|platform)\b|\bfetch\s*\(|\bspawn(?:Sync)?\s*\(/u,
  );
  assert.match(moduleSource, /from "\.\/leaf-repair\.ts"/u);
  assert.match(ownerSource, /from "\.\.\/lib\/bafu-classification\/category-map-projection\.ts"/u);
});

test("category-map projection freezes resolved and fail-closed BAFU leaf artifacts", () => {
  const projection = projectBafuLeafCategoryMapArtifacts({
    tasks,
    originalClassificationRows,
    categoryDecisionSources,
    processSchema,
    flowProductSchema,
    helpers,
  });
  const report = buildBafuLeafCategoryMapProjectReport(projection, {
    generatedAtUtc: "2026-08-26T00:00:00.000Z",
    command: "dataset-bafu-leaf-classification-category-map-project",
    inputs: {
      tasks: "tmp/category-map/tasks.jsonl",
      source_decisions_dir: "tmp/category-map/source-decisions",
      process_category_schema: "schema/tidas_processes_category.json",
      flow_product_category_schema: "schema/tidas_flows_product_category.json",
      category_map_decisions: [
        "decisions/category-map-0000.jsonl",
        "decisions/category-map-0001.jsonl",
      ],
    },
    inputHashes: {
      tasks_sha256: "tasks-sha",
      process_category_schema_sha256: "process-schema-sha",
      flow_product_category_schema_sha256: "flow-schema-sha",
      classification_decisions_sha256: "classification-sha",
      category_map_decisions_sha256: [
        { file: "decisions/category-map-0000.jsonl", sha256: "decision-0-sha" },
        { file: "decisions/category-map-0001.jsonl", sha256: "decision-1-sha" },
      ],
    },
    copiedDecisionFiles: ["identity-decisions.jsonl"],
    files: {
      report: "tmp/category-map/out/bafu-leaf-category-map-project-report.json",
      classificationDecisions: "tmp/category-map/out/classification-decisions.jsonl",
      projectionManualReview: "tmp/category-map/out/classification-decisions.manual-review.jsonl",
      processLeafCandidates: "tmp/category-map/out/process-leaf-classification-candidates.jsonl",
      flowProductCandidates: "tmp/category-map/out/flow-product-classification-candidates.jsonl",
      categoryManualReview: "tmp/category-map/out/category-map-decisions.manual-review.jsonl",
      copiedDecisionFiles: ["tmp/category-map/out/identity-decisions.jsonl"],
    },
    nextStep:
      "Run dataset-library-decisions-apply with this output directory, then continue only ready scopes.",
  });

  assert.deepEqual([...projection.categoryMap.resolved.keys()], ["chemicals > coatings"]);
  assert.deepEqual(
    projection.categoryMap.manualReview.map((row) => row.reason),
    [
      "category_map_decision_conflict",
      "category_map_decision_code_invalid",
      "category_map_decision_context_bundle_missing",
      "category_map_decision_not_completed",
    ],
  );
  assert.deepEqual(
    projection.projectionManualReview.map((row) => [row.dataset_id, row.reason]),
    [
      ["p-conflict", "category_map_decision_missing_with_rule_candidate"],
      ["p-invalid", "category_map_decision_missing_or_unresolved"],
      ["p-context", "category_map_decision_missing_or_unresolved"],
      ["p-pending", "category_map_decision_missing_or_unresolved"],
      ["p-candidate", "category_map_decision_missing_with_rule_candidate"],
    ],
  );
  assert.deepEqual(
    projection.processLeafCandidates.map((row) => [row.dataset_id, row.selected_code]),
    [
      ["p-conflict", "3512"],
      ["p-candidate", "2021"],
    ],
  );
  assert.deepEqual(
    projection.flowProductCandidates.map((row) => [row.dataset_id, row.selected_code]),
    [["flow-candidate", "17100"]],
  );
  assert.deepEqual(
    projection.classificationRows.map((row) => [
      row.dataset_type,
      row.dataset_id,
      row.selected_code,
    ]),
    [
      ["flow", "flow-keep", "17100"],
      ["process", "p-resolved", "2013"],
    ],
  );
  assert.deepEqual(Object.keys(projection.projectedRows[0]), [
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
    "authoring_context",
    "classification_decision_level",
    "source_name",
    "converted_classification_reference",
    "converted_classification_reference_policy",
    "used_context_kinds",
    "evidence",
  ]);
  assert.deepEqual(Object.keys(report), [
    "schema_version",
    "generated_at_utc",
    "status",
    "command",
    "inputs",
    "input_hashes",
    "counts",
    "copied_decision_files",
    "policy",
    "files",
    "next_step",
  ]);

  const semanticBytes = JSON.stringify(semanticSnapshot(projection));
  const artifactFacts = {
    semantic_snapshot: artifactFact(semanticBytes),
    classification_decisions: artifactFact(jsonLines(projection.classificationRows)),
    projection_manual_review: artifactFact(
      jsonLines([...projection.projectionManualReview, ...projection.flowProductManualReview]),
    ),
    process_leaf_candidates: artifactFact(jsonLines(projection.processLeafCandidates)),
    flow_product_candidates: artifactFact(jsonLines(projection.flowProductCandidates)),
    category_manual_review: artifactFact(jsonLines(projection.categoryManualReview)),
    report: artifactFact(prettyJson(report)),
  };
  assert.deepEqual(artifactFacts, {
    semantic_snapshot: {
      bytes: 20_902,
      sha256: "ed074e945bd00f2b8fde2494d36d11e86bd14d307be4edd70455ee2cfa90b46b",
    },
    classification_decisions: {
      bytes: 2348,
      sha256: "f0a2360f2ee59dd45c14b921559ea59d7c361005e1b43346e9790d9d7d236e61",
    },
    projection_manual_review: {
      bytes: 5007,
      sha256: "c5f88c1c02f0a66063930c06a7c5f5bb1ac95a4fc298c475c043e2fd4d12cf1f",
    },
    process_leaf_candidates: {
      bytes: 4934,
      sha256: "fe3a1cb49d142e11b5cfc53a4e0878f43f61e39c48ac601585070103d3d3822d",
    },
    flow_product_candidates: {
      bytes: 1818,
      sha256: "8daec6aa9925b1bbff3859c15d599e31567ce992643399143298b80541e5eed4",
    },
    category_manual_review: {
      bytes: 3645,
      sha256: "5c5b2d728d85ef4a4f4e24b6322660f5ed6e8874525acadad26f8938c1c1fcac",
    },
    report: {
      bytes: 3192,
      sha256: "911305fe67c241ad7388e8849f85ee1c97e3f087f54b62dbcac7246acff02963",
    },
  });
});

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

interface JsonRecord {
  [key: string]: unknown;
}

const processSchema = "/schemas/process.json";
const productSchema = "/schemas/product.json";
const elementarySchema = "/schemas/elementary.json";
const decisionsFile = "/run/classification-decisions.jsonl";
const outDir = "/run/repair";

test("classification schema repair freezes valid-child selection, parent fallback and exact artifacts", async () => {
  const files = new Map<string, unknown>([
    [
      processSchema,
      schema([
        klass("351", "1", "Electricity"),
        klass("3511", "2", "Electricity production"),
        klass("3512", "2", "Renewable electricity"),
        klass("3513", "2", "Electricity transmission and distribution"),
      ]),
    ],
    [productSchema, schema([klass("12", "1", "Material products")])],
    [elementarySchema, schema([klass("88", "1", "Emissions")])],
    [
      decisionsFile,
      [
        decision("distribution", "process", "3510", "electricity distribution network"),
        decision("renewable", "process", "35100", "wind renewable electricity generation"),
        decision("parent", "flow-product", "120", "material product"),
        decision("unresolved", "flow-elementary", "9990", "unknown emission"),
        decision("valid", "process", "3511", "electricity production"),
        decision("unknown-type", "location", "invalid", "location"),
      ],
    ],
  ]);
  const writes = new Map<string, JsonRecord[]>();
  const { createClassificationSchemaRepairService } =
    await import("../../scripts/lib/bafu-classification/schema-repair.ts");
  const service = createClassificationSchemaRepairService({
    fileExists: (filePath) => files.has(filePath),
    readJson: (filePath) => files.get(filePath) ?? {},
    readJsonLines: (filePath) => (files.get(filePath) as JsonRecord[] | undefined) ?? [],
    writeJsonLines: (filePath, rows) => writes.set(filePath, [...rows] as JsonRecord[]),
    repoRelative: (filePath) => filePath.replace(/^\//u, ""),
    normalizeSearchText: (value) =>
      String(value ?? "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/gu, " ")
        .trim(),
    pathJoin: (...parts) => parts.join("/").replace(/\/{2,}/gu, "/"),
  });
  const result = service.repair({
    decisionsFile,
    schemas: {
      processCategory: processSchema,
      flowProductCategory: productSchema,
      flowElementaryCategory: elementarySchema,
      location: "/schemas/location.json",
      allClassification: [],
    },
    outDir,
  });

  assert.deepEqual(
    result.repairs.map((row) => row.repaired_code),
    ["3513", "3512", "12"],
  );
  assert.deepEqual(
    result.unresolved.map((row) => row.dataset_id),
    ["unresolved"],
  );
  assert.deepEqual(
    (writes.get(decisionsFile) ?? []).map((row) => row.code),
    ["3513", "3512", "12", "9990", "3511", "invalid"],
  );
  assert.equal(result.repairPath, "/run/repair/classification-decisions.schema-repairs.jsonl");
  assert.equal(
    result.unresolvedPath,
    "/run/repair/classification-decisions.schema-invalid.manual-review.jsonl",
  );
  const artifactBytes = [decisionsFile, result.repairPath, result.unresolvedPath]
    .map(
      (filePath) =>
        (writes.get(filePath) ?? []).map((row) => JSON.stringify(row)).join("\n") + "\n",
    )
    .join("---\n");
  assert.equal(createHash("sha256").update(artifactBytes).digest("hex"), expectedArtifactsSha256);
  const firstRepaired = (writes.get(decisionsFile) ?? [])[0];
  assert.ok(firstRepaired);
  assert.deepEqual((firstRepaired.evidence as JsonRecord).schema_repair, {
    source: "dataset-bafu-batch-import-run",
    original_code: "3510",
    repaired_code: "3513",
    parent_code: "351",
    schema_file: "schemas/process.json",
    repair_kind: "replace_invalid_trailing_zero_code_with_schema_valid_child_class",
    child_candidates: [
      { code: "3511", label: "Electricity production" },
      { code: "3512", label: "Renewable electricity" },
      { code: "3513", label: "Electricity transmission and distribution" },
    ],
  });
});

test("classification schema repair keeps native rows when schemas or codes are already valid", async () => {
  const writes: JsonRecord[][] = [];
  const { createClassificationSchemaRepairService } =
    await import("../../scripts/lib/bafu-classification/schema-repair.ts");
  const service = createClassificationSchemaRepairService({
    fileExists: () => false,
    readJson: () => ({}),
    readJsonLines: () => [{ dataset_id: "missing", category_type: "process", code: "3510" }],
    writeJsonLines: (_filePath, rows) => writes.push([...rows] as JsonRecord[]),
    repoRelative: (filePath) => filePath,
    normalizeSearchText: (value) => String(value ?? ""),
    pathJoin: (...parts) => parts.join("/"),
  });
  const result = service.repair({
    decisionsFile: "decisions.jsonl",
    schemas: {
      processCategory: "missing.json",
      flowProductCategory: "missing-product.json",
      flowElementaryCategory: "missing-elementary.json",
      location: "missing-location.json",
      allClassification: [],
    },
    outDir: "out",
  });
  assert.deepEqual(writes[0], [{ dataset_id: "missing", category_type: "process", code: "3510" }]);
  assert.deepEqual(result.repairs, []);
  assert.deepEqual(result.unresolved, []);
});

function schema(entries: JsonRecord[]): JsonRecord {
  return { anyOf: entries };
}

function klass(classId: string, level: string, text: string): JsonRecord {
  return {
    properties: {
      "@classId": { const: classId },
      "@level": { const: level },
      "#text": { const: text },
    },
  };
}

function decision(id: string, category_type: string, code: string, basis: string): JsonRecord {
  return {
    schema_version: 1,
    dataset_id: id,
    dataset_version: "01.00.000",
    category_type,
    code,
    basis,
    evidence: { queue: { authoring_context: { technology: basis } } },
  };
}

const expectedArtifactsSha256 = "390781917149bd75dc256f2a0ad314b2f15f963a09736d6f7a87bded5fd19d7d";

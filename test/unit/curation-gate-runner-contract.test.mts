import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { runDatasetCurationGate } from "../../scripts/lib/import-curation/curation-gate.ts";

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord {
  assert.ok(value && typeof value === "object" && !Array.isArray(value));
  return value as JsonRecord;
}

function records(value: unknown): JsonRecord[] {
  assert.ok(Array.isArray(value));
  return value.map(record);
}

function writeJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function writeJsonLines(filePath: string, rows: unknown[]): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, rows.map((row) => JSON.stringify(row)).join("\n") + "\n");
}

function processRow(id: string, label: string): JsonRecord {
  return {
    id,
    version: "00.00.001",
    process: {
      processDataSet: {
        processInformation: {
          dataSetInformation: {
            "common:UUID": id,
            name: {
              baseName: [{ "@xml:lang": "en", "#text": label }],
            },
          },
        },
        administrativeInformation: {
          publicationAndOwnership: {
            "common:dataSetVersion": "00.00.001",
          },
        },
      },
    },
  };
}

function actionCodes(value: unknown): unknown[] {
  return records(value).map((item) => item.code);
}

test("blocked curation preserves entity, blocker, context, package, alias, and byte order", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "foundry-curation-gate-contract-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const processB = "22222222-2222-4222-8222-222222222222";
  const processA = "11111111-1111-4111-8111-111111111111";
  const rows = [processRow(processB, "Second process"), processRow(processA, "First process")];
  const rowsFile = path.join(root, "rows", "processes.jsonl");
  const schemaReport = path.join(root, "schema", "report.json");
  const qaReport = path.join(root, "qa", "report.json");
  const outDir = path.join(root, "out");
  writeJsonLines(rowsFile, rows);
  writeJson(schemaReport, {
    status: "completed",
    rows: [
      {
        id: processA,
        status: "invalid",
        issues: [
          {
            code: "schema_first_ai",
            path: "processDataSet.processInformation.dataSetInformation.name.baseName",
            message: "First process needs source-backed naming.",
          },
        ],
      },
      {
        id: processB,
        status: "invalid",
        issues: [
          {
            code: "schema_second_ai",
            path: "processDataSet.processInformation.quantitativeReference.functionalUnitOrOther",
            message: "Second process needs a functional unit.",
          },
          {
            code: "invalid_type",
            path: "processDataSet.processInformation.dataSetInformation.common:other.tidasimport:sourceTrace",
            message: "Import trace must be externalized before write.",
          },
        ],
      },
    ],
  });
  writeJson(qaReport, {
    status: "needs_review",
    findings: [
      { dataset_id: processB, code: "qa_second_one", message: "Second QA one." },
      { dataset_id: processA, code: "qa_first", message: "First QA." },
      { dataset_id: processB, code: "qa_second_two", message: "Second QA two." },
    ],
  });

  const explicitContext = [
    ["contract.json", "contract"],
    ["schema.json", "schema"],
    ["methodology.yaml", "methodology"],
    ["runtime-ruleset.json", "rules"],
    ["contract.md", "contract markdown"],
  ] as const;
  for (const [name, text] of explicitContext) {
    const filePath = path.join(root, "context-files", name);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, text);
  }
  fs.mkdirSync(path.join(root, "context-dir"), { recursive: true });
  fs.writeFileSync(path.join(root, "context-dir", "z.json"), "z");
  fs.writeFileSync(path.join(root, "context-dir", "a.txt"), "a");

  const result = record(
    runDatasetCurationGate({
      repoRoot: root,
      options: {
        type: "process",
        profile: "generic",
        rowsFile: path.relative(root, rowsFile),
        schemaReport: path.relative(root, schemaReport),
        qaReport: path.relative(root, qaReport),
        contractContext: "context-files/contract.json",
        schemaFile: "context-files/schema.json",
        yamlFile: "context-files/methodology.yaml",
        rulesetFile: "context-files/runtime-ruleset.json",
        contractFile: "context-files/contract.md",
        contextDir: "context-dir",
        outDir: path.relative(root, outDir),
      },
    }),
  );

  assert.equal(result.status, "blocked_needs_foundry_ai_authoring");
  const entities = records(result.entities);
  const processes = records(result.processes);
  assert.deepEqual(
    entities.map((entity) => entity.entity_id),
    [processB, processA],
  );
  assert.deepEqual(processes, entities);
  assert.deepEqual(
    entities.map((entity) => ({
      status: entity.status,
      action_item_count: entity.action_item_count,
      deterministic_cleanup_count: entity.deterministic_cleanup_count,
      blocking_item_count: entity.blocking_item_count,
    })),
    [
      {
        status: "needs_foundry_ai_authoring",
        action_item_count: 3,
        deterministic_cleanup_count: 1,
        blocking_item_count: 4,
      },
      {
        status: "needs_foundry_ai_authoring",
        action_item_count: 2,
        deterministic_cleanup_count: 0,
        blocking_item_count: 2,
      },
    ],
  );

  const counts = record(result.counts);
  assert.deepEqual(
    {
      entities: counts.entities,
      processes: counts.processes,
      action_items: counts.action_items,
      deterministic_cleanup_items: counts.deterministic_cleanup_items,
      blocking_items: counts.blocking_items,
    },
    {
      entities: 2,
      processes: 2,
      action_items: 5,
      deterministic_cleanup_items: 1,
      blocking_items: 6,
    },
  );

  const context = record(result.context);
  assert.deepEqual((context.contract_context_files as unknown[]).slice(0, 7), [
    "context-files/contract.json",
    "context-files/schema.json",
    "context-files/methodology.yaml",
    "context-files/runtime-ruleset.json",
    "context-files/contract.md",
    "context-dir/a.txt",
    "context-dir/z.json",
  ]);

  const packagePath = path.join(root, String(entities[0]?.authoring_package));
  const packageText = fs.readFileSync(packagePath, "utf8");
  const packagePayload = record(JSON.parse(packageText));
  assert.equal(
    entities[0]?.authoring_package_sha256,
    createHash("sha256").update(packageText).digest("hex"),
  );
  assert.equal(packageText, `${JSON.stringify(packagePayload, null, 2)}\n`);
  assert.deepEqual(actionCodes(packagePayload.action_items), [
    "schema_second_ai",
    "qa_second_one",
    "qa_second_two",
  ]);
  assert.deepEqual(actionCodes(packagePayload.deterministic_cleanup_items), ["invalid_type"]);
  assert.deepEqual(
    records(packagePayload.contract_context_files)
      .slice(0, 7)
      .map((item) => [item.kind, item.path]),
    [
      ["contract_context", "context-files/contract.json"],
      ["schema", "context-files/schema.json"],
      ["methodology_yaml", "context-files/methodology.yaml"],
      ["ruleset", "context-files/runtime-ruleset.json"],
      ["contract", "context-files/contract.md"],
      ["context_dir_file", "context-dir/a.txt"],
      ["context_dir_file", "context-dir/z.json"],
    ],
  );

  const files = record(result.files);
  assert.equal(files.processes, files.entities);
  const reportForDisk = { ...result };
  delete reportForDisk.files;
  assert.equal(
    fs.readFileSync(path.join(root, String(files.report)), "utf8"),
    `${JSON.stringify(reportForDisk, null, 2)}\n`,
  );
  assert.equal(
    fs.readFileSync(path.join(root, String(files.entities)), "utf8"),
    entities.map((entity) => JSON.stringify(entity)).join("\n") + "\n",
  );
});

test("malformed readable schema JSON retains native SyntaxError before output", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "foundry-curation-gate-error-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeJsonLines(path.join(root, "rows.jsonl"), [processRow("process-error", "Error")]);
  fs.writeFileSync(path.join(root, "schema.json"), "{");
  writeJson(path.join(root, "qa.json"), { findings: [] });
  assert.throws(
    () =>
      runDatasetCurationGate({
        repoRoot: root,
        options: {
          type: "process",
          rowsFile: "rows.jsonl",
          schemaReport: "schema.json",
          qaReport: "qa.json",
          outDir: "out",
        },
      }),
    SyntaxError,
  );
  assert.equal(fs.existsSync(path.join(root, "out")), false);
});

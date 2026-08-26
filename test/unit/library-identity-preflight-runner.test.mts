import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import { createLibraryIdentityPreflightRunner } from "../../scripts/lib/library-orchestration/identity-preflight-runner.ts";
import type { JsonRecord } from "../../scripts/lib/library-orchestration/entity-projection.ts";
import { testTmpRoot } from "../fixtures/foundry-core.ts";

const fixtureRoot = testTmpRoot("library-identity-preflight-runner-test");

function writeJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function writeJsonLines(filePath: string, rows: readonly unknown[]): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(
    filePath,
    rows.map((row) => JSON.stringify(row)).join("\n") + (rows.length > 0 ? "\n" : ""),
  );
}

function readJson(filePath: string): JsonRecord {
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as JsonRecord;
}

function readJsonLines(filePath: string): JsonRecord[] {
  const value = fs.readFileSync(filePath, "utf8").trim();
  return value ? value.split(/\r?\n/u).map((line) => JSON.parse(line) as JsonRecord) : [];
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function relative(filePath: string | null | undefined): string | null {
  return filePath ? path.relative(fixtureRoot, filePath).replaceAll("\\", "/") : null;
}

function resolveRepoPath(value: unknown): string | null {
  if (value == null || value === "") return null;
  const filePath = String(value);
  return path.isAbsolute(filePath) ? filePath : path.join(fixtureRoot, filePath);
}

function createRunner() {
  return createLibraryIdentityPreflightRunner({
    asText: (value: unknown) => (value == null ? "" : String(value).trim()),
    ensureArray: <T,>(value: T | readonly T[] | null | undefined): T[] =>
      Array.isArray(value) ? ([...value] as T[]) : value == null ? [] : [value as T],
    fileExists: (filePath: string | null | undefined) =>
      Boolean(filePath) && fs.existsSync(filePath!),
    nowIso: () => "2026-08-26T00:00:00.000Z",
    readJson,
    readJsonLines,
    repoRelativeMaybe: relative,
    repoRelativePath: (filePath: string) => relative(filePath)!,
    resolveRepoPath,
    writeJson,
    writeJsonLines,
  });
}

test("identity preflight runner freezes decisions, manual review and report bytes in source order", () => {
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
  const indexDir = path.join(fixtureRoot, "library-index");
  const preflightDir = path.join(fixtureRoot, "preflight");
  const outDir = path.join(fixtureRoot, "decisions");
  const entityRows = [
    {
      entity_key: "flow:ef-accepted:00.00.001",
      dataset_type: "flow",
      dataset_id: "ef-accepted",
      dataset_version: "00.00.001",
      source_file: "sources/accepted.json",
      flow_type: "Elementary flow",
      name: "Methane",
      flow_property_refs: [{ short_description: "Amount in kg" }],
    },
    {
      entity_key: "flow:ef-manual:00.00.001",
      dataset_type: "flow",
      dataset_id: "ef-manual",
      dataset_version: "00.00.001",
      source_file: "sources/manual.json",
      flow_type: "Elementary flow",
      name: "Unknown emission",
      flow_property_refs: [{ short_description: "Amount in kg" }],
    },
  ];
  writeJsonLines(path.join(indexDir, "library-entity-index.jsonl"), entityRows);
  writeJsonLines(path.join(indexDir, "scope-projection.jsonl"), [
    {
      process_id: "process-1",
      process_version: "00.00.001",
      process_entity_key: "process:process-1:00.00.001",
      dependency_ids: {
        flows: entityRows.map((row) => ({ entity_key: row.entity_key })),
        flowproperties: [],
        unitgroups: [],
      },
      usage_refs: {
        process_exchange_flow_refs: [
          {
            flow_id: "ef-accepted",
            flow_version: "00.00.001",
            exchange_index: 0,
            direction: "Input",
          },
          {
            flow_id: "ef-manual",
            flow_version: "00.00.001",
            exchange_index: 1,
            direction: "Output",
          },
        ],
      },
    },
  ]);
  const acceptedReportPath = path.join(preflightDir, "accepted", "identity-decision.json");
  writeJson(acceptedReportPath, {
    status: "needs_review",
    decision: "manual_review",
    target: {
      names: ["Methane"],
      fields: {
        cas: "74-82-8",
        flow_property: "Amount in kg",
        categories: ["Emissions", "Emissions to air", "Emissions to air, unspecified"],
      },
    },
    candidates: [
      {
        id: "aaaaaaaa-aaaa-5aaa-8aaa-aaaaaaaaaaaa",
        version: "03.00.004",
        names: ["methane"],
        fields: {
          type_of_dataset: "Elementary flow",
          cas: "74-82-8",
          flow_property: "Mass",
          categories: ["Emissions", "Emissions to air", "Emissions to air, unspecified"],
        },
      },
    ],
  });
  const candidatesPath = path.join(preflightDir, "accepted", "identity-candidates.jsonl");
  writeJsonLines(candidatesPath, []);
  const preflightIndexPath = path.join(preflightDir, "identity-preflight-requests.jsonl");
  writeJsonLines(preflightIndexPath, [
    {
      dataset_type: "flow",
      dataset_id: "ef-accepted",
      dataset_version: "00.00.001",
      expected_report_file: relative(acceptedReportPath),
      expected_candidates_file: relative(candidatesPath),
    },
  ]);

  const report = createRunner().run({ indexDir, preflightIndexPath, outDir });
  const decisionPath = path.join(outDir, "identity-decisions.jsonl");
  const manualPath = path.join(outDir, "identity-decisions.manual-review.jsonl");
  const reportPath = path.join(
    outDir,
    "dataset-library-identity-decisions-from-preflight-report.json",
  );
  const decisionBytes = fs.readFileSync(decisionPath, "utf8");
  const manualBytes = fs.readFileSync(manualPath, "utf8");
  const reportBytes = fs.readFileSync(reportPath, "utf8");

  assert.equal(
    sha256(decisionBytes),
    "6150fc825cadf0728ac69151581590f5e76d3890972e9b146fd012bd6ff72599",
  );
  assert.equal(
    sha256(manualBytes),
    "2555cd06d72eef1430bc975611c763a5b294d57c30185b037d83fd52ed883e76",
  );
  assert.equal(
    sha256(reportBytes),
    "a355747a3f186aeee83968c34bddd5fa8657e5ddd45b9e109a77a2a33b39656b",
  );
  assert.deepEqual(
    readJsonLines(decisionPath).map((row) => row.source_dataset_id),
    ["ef-accepted"],
  );
  assert.deepEqual(
    readJsonLines(manualPath).map((row) => [row.source_dataset_id, row.reason]),
    [["ef-manual", "identity_preflight_report_missing_or_invalid"]],
  );
  assert.deepEqual(report, readJson(reportPath));
  assert.deepEqual(report.reason_counts, {
    identity_preflight_report_missing_or_invalid: 1,
    single_candidate_passed_physical_guardrails: 1,
  });
});

test("source classification evaluator caches the first trace-backed classification", () => {
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
  const sourceFile = path.join(fixtureRoot, "sources", "water.json");
  writeJson(sourceFile, {
    flowDataSet: {
      flowInformation: {
        dataSetInformation: {
          "common:other": {
            "tidasimport:sourceTrace": {
              payload: {
                sourceClassification: {
                  category: " Emissions   to water ",
                  subCategory: " River ",
                },
              },
            },
          },
        },
      },
    },
  });
  const runner = createRunner();
  const entity = {
    entity_key: "flow:water:00.00.001",
    dataset_type: "flow",
    dataset_id: "water",
    dataset_version: "00.00.001",
    source_file: relative(sourceFile),
    flow_type: "Elementary flow",
    name: "Water",
    flow_property_refs: [{ short_description: "Mass" }],
  };

  assert.deepEqual(runner.entitySourceClassification(entity), {
    category: "emissions to water",
    subCategory: "river",
  });
  writeJson(sourceFile, { flowDataSet: {} });
  assert.deepEqual(runner.entitySourceClassification(entity), {
    category: "emissions to water",
    subCategory: "river",
  });
});

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

import { createBafuBatchImportRunCommands } from "../../scripts/commands/bafu-batch-import-run.ts";
import {
  readJson,
  readJsonLines,
  rel,
  repoRoot,
  writeJson,
  writeJsonLines,
} from "../fixtures/foundry-core.ts";

type JsonRecord = Record<string, unknown>;
type DatasetIdentity = { id: string | null; version: string };

const ownerRelativePath = "scripts/commands/bafu-batch-import-run.ts";
const executionRelativePath = "scripts/lib/batch-orchestration/scope-execution.ts";
const preparationRelativePath = "scripts/lib/batch-orchestration/scope-preparation.ts";
const baselineOwnerLines = 4086;

function textValue(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string" || typeof value === "number") return String(value).trim();
  if (Array.isArray(value)) return value.map(textValue).filter(Boolean).join("; ");
  if (typeof value === "object") {
    const record = value as JsonRecord;
    return textValue(record["#text"] ?? record.value ?? record.id);
  }
  return "";
}

function datasetIdentity(row: unknown, type: string): DatasetIdentity {
  const record = row as JsonRecord;
  const root = (record[`${type}DataSet`] ?? record) as JsonRecord;
  const informationRoot = (root[`${type}Information`] ?? {}) as JsonRecord;
  const information = (informationRoot.dataSetInformation ?? {}) as JsonRecord;
  const administrativeInformation = (root.administrativeInformation ?? {}) as JsonRecord;
  const publication = (administrativeInformation.publicationAndOwnership ?? {}) as JsonRecord;
  return {
    id: textValue(information["common:UUID"] ?? record.dataset_id ?? record.id) || null,
    version:
      textValue(publication["common:dataSetVersion"] ?? record.dataset_version ?? record.version) ||
      "00.00.001",
  };
}

function sha256File(filePath: string): string {
  return createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function physicalLineCount(source: string): number {
  return source.endsWith("\n") ? source.split("\n").length - 1 : source.split("\n").length;
}

function writeRequiredBatchInputs(runDir: string, schemaDir: string): void {
  for (const type of ["flow", "process"]) {
    const contextDir = path.join(runDir, "context", type, "outputs");
    writeJson(path.join(contextDir, "schema.json"), {});
    writeJson(path.join(contextDir, "runtime-ruleset.json"), {});
    fs.writeFileSync(path.join(contextDir, "methodology.yaml"), "rules: []\n");
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
    writeJson(path.join(schemaDir, name), {});
  }
  writeJsonLines(
    path.join(runDir, "decisions-v4-leaf-category-map", "classification-decisions.jsonl"),
    [],
  );
}

test("single-scope execution has coherent typed owners and shrinks the command owner by 700 lines", async () => {
  const ownerPath = path.join(repoRoot, ownerRelativePath);
  const executionPath = path.join(repoRoot, executionRelativePath);
  const preparationPath = path.join(repoRoot, preparationRelativePath);

  assert.equal(fs.existsSync(executionPath), true, executionRelativePath);
  assert.equal(fs.existsSync(preparationPath), true, preparationRelativePath);

  const ownerSource = fs.readFileSync(ownerPath, "utf8");
  assert.match(ownerSource, /createBatchScopeExecutionService/u);
  assert.doesNotMatch(ownerSource, /async function runOneScope\s*\(/u);
  assert.ok(
    physicalLineCount(ownerSource) <= baselineOwnerLines - 700,
    `expected ${ownerRelativePath} to lose at least 700 lines`,
  );

  for (const relativePath of [executionRelativePath, preparationRelativePath]) {
    const source = fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
    assert.ok(physicalLineCount(source) <= 800, `${relativePath} exceeds 800 lines`);
    assert.doesNotMatch(relativePath, /(?:^|[-_/])part[-_]?\d+(?:\.|$)/u);
    assert.doesNotMatch(source, /\bas\s+any\b|:\s*any\b|\bany\s*\[\]|<\s*any\b/u);
    assert.doesNotMatch(source, /@ts-(?:no)?check|@ts-ignore|@ts-expect-error/u);
  }

  const executionModule = (await import(pathToFileURL(executionPath).href)) as Record<
    string,
    unknown
  >;
  const preparationModule = (await import(pathToFileURL(preparationPath).href)) as Record<
    string,
    unknown
  >;
  assert.deepEqual(Object.keys(executionModule), ["createBatchScopeExecutionService"]);
  assert.deepEqual(Object.keys(preparationModule), ["createBatchScopePreparationService"]);
});

test("verified resume keeps exact report and ledger bytes across the single-scope extraction", async () => {
  const fixtureRoot = path.join(
    repoRoot,
    ".foundry",
    "test-characterization",
    "batch-scope-execution",
  );
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
  const runDir = path.join(fixtureRoot, "run");
  const schemaDir = path.join(fixtureRoot, "schemas");
  const processBundlesDir = path.join(fixtureRoot, "process-bundles");
  const outDir = path.join(fixtureRoot, "batch");
  const scopeFile = path.join(fixtureRoot, "ready-scopes.jsonl");
  const processId = "11111111-2222-4333-8444-555555555555";
  fs.mkdirSync(processBundlesDir, { recursive: true });
  writeRequiredBatchInputs(runDir, schemaDir);
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

  const commands = createBafuBatchImportRunCommands(
    {
      asText: textValue,
      booleanOption: (value: unknown) => value === true || value === "true",
      datasetIdentity,
      directoryExists: (filePath: string | null | undefined) =>
        Boolean(filePath) && fs.existsSync(filePath!) && fs.statSync(filePath!).isDirectory(),
      fileExists: (filePath: string | null | undefined) =>
        Boolean(filePath) && fs.existsSync(filePath!) && fs.statSync(filePath!).isFile(),
      integerOption: (value: unknown, fallback: number | null = null) => {
        const parsed = Number.parseInt(String(value ?? ""), 10);
        return Number.isFinite(parsed) ? parsed : fallback;
      },
      normalizedList: (value: unknown) =>
        value == null
          ? []
          : (Array.isArray(value) ? value : String(value).split(","))
              .map((entry) => String(entry).trim())
              .filter(Boolean),
      nowIso: () => "2026-08-26T00:00:00.000Z",
      readJson,
      readJsonLines: (filePath: string) => (fs.existsSync(filePath) ? readJsonLines(filePath) : []),
      repoRelativeMaybe: (filePath: string | null | undefined) => (filePath ? rel(filePath) : null),
      resolveRepoPath: (filePath: unknown) => {
        const text = textValue(filePath);
        return text ? (path.isAbsolute(text) ? text : path.join(repoRoot, text)) : null;
      },
      shellQuote: (value: string) =>
        /^[A-Za-z0-9_./:=@%+-]+$/u.test(value) ? value : `'${value.replace(/'/gu, "'\\''")}'`,
      writeJson,
      writeJsonLines,
    },
    { enableFamilySignatures: false },
  );

  try {
    const report = await commands.runDatasetBafuBatchImportRun({
      scopeFile,
      processBundlesDir,
      runDir,
      outDir,
      tidasSchemaDir: schemaDir,
      targetUserId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
      commit: true,
      parallel: 1,
    });

    assert.equal(report.status, "completed");
    assert.deepEqual(report.counts, {
      selected_scopes: 1,
      pending_candidate_scopes: 1,
      filtered_already_verified_scopes: 0,
      filtered_already_blocked_scopes: 0,
      filtered_classification_missing_scopes: 0,
      filtered_classification_not_leaf_scopes: 0,
      processed_scopes: 1,
      paused_not_started: 0,
      stopped_after_blocked: false,
      verified: 0,
      skipped: 1,
      skipped_blocked: 0,
      blocked: 0,
      failed_retryable: 0,
      ok_scope_ledger_rows: 1,
      ok_flow_ledger_rows: 0,
      human_review_rows: 0,
      historical_human_review_rows: 0,
      resolved_human_review_rows: 0,
      retry_rows: 0,
      already_verified_scopes: 1,
      already_verified_flows: 0,
      already_blocked_scopes: 0,
      verified_support_identities: 0,
      ledger_source_dirs: 0,
      ledger_source_ok_scope_rows: 0,
      ledger_source_ok_flow_rows: 0,
      ledger_source_blocked_scope_rows: 0,
      library_classification_decisions: 0,
      indexed_library_classification_decisions: 0,
      selected_same_amount_vector_scopes: 0,
      selected_same_skeleton_only_scopes: 0,
      selected_standard_scopes: 0,
    });
    assert.deepEqual(
      readJsonLines(path.join(outDir, "scope-checkpoints.jsonl")).map((row) => row.state),
      ["skipped_already_verified"],
    );

    const byteContracts = [
      [
        "dataset-bafu-batch-import-run-report.json",
        4497,
        "15c6f1f19b8df36fe1c8abfe2152b7dfd5716ea36db328470697130540d2a0ff",
      ],
      [
        "import-ledger/run-manifest.json",
        6677,
        "ffb7e70a5d6505a52ee53666812afd4164ea0f6d8c109f6c100267bbbf876bc4",
      ],
      [
        "scope-checkpoints.jsonl",
        405,
        "b86cb0466b3ac51639754260cf967a5bc4db459c2345a3ea3fa448e3c49fa036",
      ],
    ] as const;
    const actualByteContracts = byteContracts.map(([relativePath]) => {
      const filePath = path.join(outDir, relativePath);
      return [relativePath, fs.statSync(filePath).size, sha256File(filePath)] as const;
    });
    assert.deepEqual(actualByteContracts, byteContracts);
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

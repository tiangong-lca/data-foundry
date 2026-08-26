import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  createUniverseCoverageService,
  type JsonRecord,
  type UniverseCoverageRuntimeAdapter,
} from "../../scripts/lib/batch-orchestration/universe-coverage.ts";

const P1 = "11111111-2222-4333-8444-555555555591";
const P2 = "11111111-2222-4333-8444-555555555592";
const F1 = "22222222-3333-4444-8555-666666666691";
const F2 = "22222222-3333-4444-8555-666666666692";
const F3 = "22222222-3333-4444-8555-666666666693";
const VERSION = "00.00.001";

function jsonRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function textValue(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value).trim();
  }
  return "";
}

function ensureParent(filePath: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function writeJson(filePath: string, value: unknown): void {
  ensureParent(filePath);
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function writeJsonLines(filePath: string, rows: readonly unknown[]): void {
  ensureParent(filePath);
  fs.writeFileSync(
    filePath,
    rows.map((row) => JSON.stringify(row)).join("\n") + (rows.length > 0 ? "\n" : ""),
  );
}

function readJsonLines(filePath: string): JsonRecord[] {
  const source = fs.readFileSync(filePath, "utf8").trim();
  return source ? source.split(/\r?\n/u).map((line) => jsonRecord(JSON.parse(line))) : [];
}

function walkFiles(rootDir: string, predicate: (filePath: string) => boolean): string[] {
  if (!fs.existsSync(rootDir)) return [];
  const stack = [rootDir];
  const files: string[] = [];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const next = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(next);
      else if (entry.isFile() && predicate(next)) files.push(next);
    }
  }
  return files.sort();
}

function datasetIdentity(row: unknown, type: string): { id: string | null; version: string } {
  const record = jsonRecord(row);
  const root = jsonRecord(record[`${type}DataSet`]);
  const informationRoot = jsonRecord(root[`${type}Information`]);
  const information = jsonRecord(
    informationRoot.dataSetInformation ?? informationRoot["common:dataSetInformation"],
  );
  const publication = jsonRecord(
    jsonRecord(root.administrativeInformation).publicationAndOwnership,
  );
  return {
    id: textValue(information["common:UUID"] ?? information.UUID) || null,
    version: textValue(publication["common:dataSetVersion"] ?? publication.dataSetVersion) || VERSION,
  };
}

function runtimeFor(root: string): UniverseCoverageRuntimeAdapter {
  const resolveRepoPath = (value: unknown): string | null => {
    if (!value) return null;
    const filePath = value as string;
    return path.isAbsolute(filePath) ? filePath : path.join(root, filePath);
  };
  return Object.freeze({
    nowIso: () => "2026-08-26T12:34:56.000Z",
    resolveRepoPath,
    repoRelative: (filePath: string | null | undefined) =>
      filePath ? path.relative(root, filePath).split(path.sep).join(path.posix.sep) : null,
    fileExists: (filePath: string | null | undefined) =>
      Boolean(filePath && fs.existsSync(filePath) && fs.statSync(filePath).isFile()),
    directoryExists: (filePath: string | null | undefined) =>
      Boolean(filePath && fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()),
    readJson: (filePath: string) => JSON.parse(fs.readFileSync(filePath, "utf8")) as unknown,
    readJsonLines,
    writeJson,
    writeJsonLines,
    ensureDirectory: (directory: string) => fs.mkdirSync(directory, { recursive: true }),
    normalizedList: (value: unknown) =>
      value == null
        ? []
        : (Array.isArray(value) ? value : String(value).split(","))
            .map((entry) => String(entry).trim())
            .filter(Boolean),
    asText: textValue,
    datasetIdentity,
    path: Object.freeze({
      join: (...parts: string[]) => path.join(...parts),
      dirname: (filePath: string) => path.dirname(filePath),
      basename: (filePath: string, suffix?: string) => path.basename(filePath, suffix),
      isAbsolute: (filePath: string) => path.isAbsolute(filePath),
      resolve: (filePath: string) => path.resolve(filePath),
    }),
    walkFiles: (rootDir: unknown, predicate: (filePath: string) => boolean) => {
      const resolved = resolveRepoPath(rootDir);
      return resolved ? walkFiles(resolved, predicate) : [];
    },
  });
}

function processPayload(id: string, flowIds: readonly string[]): JsonRecord {
  return {
    processDataSet: {
      processInformation: {
        dataSetInformation: { "common:UUID": id },
      },
      administrativeInformation: {
        publicationAndOwnership: { "common:dataSetVersion": VERSION },
      },
      exchanges: {
        exchange: flowIds.map((flowId) => ({
          referenceToFlowDataSet: {
            "@refObjectId": flowId,
            "@version": VERSION,
            "common:shortDescription": { "#text": `flow ${flowId}` },
          },
        })),
      },
    },
  };
}

function flowPayload(id: string, typeOfDataSet: string): JsonRecord {
  return {
    flowDataSet: {
      flowInformation: {
        dataSetInformation: {
          "common:UUID": id,
          typeOfDataSet,
        },
      },
      administrativeInformation: {
        publicationAndOwnership: { "common:dataSetVersion": VERSION },
      },
    },
  };
}

function seedCoverageFixture(root: string): void {
  writeJson(path.join(root, "input/process-bundles/index.json"), {
    bundles: [
      { process_id: P1, process_version: VERSION, manifest: `${P1}/manifest.json` },
      { process_id: P2, process_version: VERSION, manifest: `${P2}/manifest.json` },
    ],
  });
  writeJson(path.join(root, `input/tidas/processes/${P1}.json`), processPayload(P1, [F1, F2]));
  writeJson(path.join(root, `input/tidas/processes/${P2}.json`), processPayload(P2, [F3]));
  writeJson(path.join(root, `input/tidas/flows/${F1}.json`), flowPayload(F1, "Product flow"));
  writeJson(path.join(root, `input/tidas/flows/${F2}.json`), flowPayload(F2, "Elementary flow"));
  writeJsonLines(path.join(root, "run/ready-scopes.jsonl"), [
    {
      schema_version: 1,
      process_id: P1,
      process_version: VERSION,
      closure_status: "ready",
    },
  ]);
  const ledgerDir = path.join(root, "previous-batch/import-ledger");
  writeJsonLines(path.join(ledgerDir, "ok.scopes.verified.jsonl"), [
    {
      schema_version: 1,
      dataset_type: "process",
      dataset_id: P1,
      dataset_version: VERSION,
      status: "verified",
    },
  ]);
  writeJsonLines(path.join(ledgerDir, "ok.flows.verified.jsonl"), [
    {
      schema_version: 1,
      dataset_type: "flow",
      dataset_id: F1,
      dataset_version: VERSION,
      status: "verified",
    },
  ]);
  writeJsonLines(path.join(ledgerDir, "blocked.scopes.human-review.jsonl"), [
    {
      schema_version: 1,
      process_id: P2,
      process_version: VERSION,
      code: "classification_apply_stage_failed",
    },
  ]);
  writeJsonLines(path.join(ledgerDir, "failed.scopes.retry.jsonl"), [
    {
      schema_version: 1,
      process_id: P2,
      process_version: VERSION,
      code: "temporary_network_failure",
    },
  ]);
}

test("universe coverage extraction preserves exact report and JSONL bytes", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "foundry-universe-coverage-"));
  try {
    seedCoverageFixture(root);
    const service = createUniverseCoverageService(runtimeFor(root));
    assert.equal(Object.isFrozen(service), true);
    const report = service.runReport(
      {
        inputDir: "input",
        processBundlesDir: "input/process-bundles",
        runDir: "run",
        ledgerSourceDir: ["previous-batch", "previous-batch/import-ledger"],
        outDir: "coverage",
      },
      {
        commandName: "dataset-bafu-universe-coverage-report",
        defaultInputDir: "inputs/BAFU-2025 Version 2 - TIDAS 2026-03-09",
      },
    );

    const processRows = [
      {
        schema_version: 1,
        process_id: P1,
        process_version: VERSION,
        process_key: `${P1}@${VERSION}`,
        in_process_bundles: true,
        in_tidas_processes: true,
        bundle_manifest: `input/process-bundles/${P1}/manifest.json`,
        process_file: `input/tidas/processes/${P1}.json`,
        ready_scope: true,
        verified: true,
        non_importable: false,
        active_human_review: false,
        retry: false,
        coverage_status: "verified",
      },
      {
        schema_version: 1,
        process_id: P2,
        process_version: VERSION,
        process_key: `${P2}@${VERSION}`,
        in_process_bundles: true,
        in_tidas_processes: true,
        bundle_manifest: `input/process-bundles/${P2}/manifest.json`,
        process_file: `input/tidas/processes/${P2}.json`,
        ready_scope: false,
        verified: false,
        non_importable: false,
        active_human_review: true,
        retry: true,
        coverage_status: "retry",
      },
    ];
    const flowRows = [
      {
        schema_version: 1,
        flow_id: F1,
        flow_version: VERSION,
        flow_key: `${F1}@${VERSION}`,
        flow_type: "Product flow",
        flow_file: `input/tidas/flows/${F1}.json`,
        reference_kind: "product_or_waste",
        verified: true,
        referencing_process_count: 1,
        sample_referencing_processes: [`${P1}@${VERSION}`],
      },
      {
        schema_version: 1,
        flow_id: F2,
        flow_version: VERSION,
        flow_key: `${F2}@${VERSION}`,
        flow_type: "Elementary flow",
        flow_file: `input/tidas/flows/${F2}.json`,
        reference_kind: "elementary",
        verified: false,
        referencing_process_count: 1,
        sample_referencing_processes: [`${P1}@${VERSION}`],
      },
      {
        schema_version: 1,
        flow_id: F3,
        flow_version: VERSION,
        flow_key: `${F3}@${VERSION}`,
        flow_type: "unknown",
        flow_file: null,
        reference_kind: "unknown",
        verified: false,
        referencing_process_count: 1,
        sample_referencing_processes: [`${P2}@${VERSION}`],
      },
    ];
    const expectedReport = {
      schema_version: 1,
      generated_at_utc: "2026-08-26T12:34:56.000Z",
      status: "completed_with_coverage_gaps",
      command: "dataset-bafu-universe-coverage-report",
      remote_write_mode: "read-only",
      inputs: {
        input_dir: "input",
        process_bundles_dir: "input/process-bundles",
        processes_dir: "input/tidas/processes",
        flows_dir: "input/tidas/flows",
        run_dir: "run",
        scope_files: ["run/ready-scopes.jsonl"],
        ledger_source_dirs: ["previous-batch/import-ledger"],
        non_importable_scope_files: [],
      },
      counts: {
        process_bundle_entries: 2,
        process_bundle_unique: 2,
        tidas_process_files: 2,
        tidas_process_unique: 2,
        process_universe: 2,
        ready_scope_files: 1,
        ready_scope_rows: 1,
        ready_scope_unique: 1,
        ready_scopes_in_universe: 1,
        missing_ready_scopes: 1,
        verified_process_scopes: 1,
        non_importable_process_scopes: 0,
        active_human_review_scopes: 0,
        retry_scopes: 1,
        pending_ready_scopes: 0,
        process_coverage_gap_rows: 1,
        referenced_flow_rows: 3,
        product_or_unknown_flow_references: 2,
        verified_product_or_unknown_flow_references: 1,
        unverified_product_or_unknown_flow_references: 1,
        flow_coverage_gap_rows: 1,
        ledger_source_dirs: 1,
        ledger_source_ok_scope_rows: 1,
        ledger_source_ok_scope_unique: 1,
        ledger_source_ok_scope_unique_in_universe: 1,
        ledger_source_ok_flow_rows: 1,
        ledger_source_ok_flow_unique: 1,
        ledger_source_ok_flow_unique_product_or_unknown_references: 1,
        ledger_source_blocked_scope_rows: 1,
      },
      ledger_sources: [
        {
          ledger_dir: "previous-batch/import-ledger",
          ok_scope_rows: 1,
          ok_flow_rows: 1,
          blocked_scope_rows: 1,
          verified_support_identity_rows: 0,
        },
      ],
      files: {
        report: "coverage/bafu-universe-coverage-report.json",
        process_universe: "coverage/bafu-process-universe.coverage.jsonl",
        process_coverage_gaps: "coverage/bafu-process-coverage-gaps.jsonl",
        flow_reference_coverage: "coverage/bafu-flow-reference-coverage.jsonl",
        flow_reference_coverage_gaps: "coverage/bafu-flow-reference-coverage-gaps.jsonl",
      },
      policy: {
        ledger_sources_are_explicit:
          "Coverage is computed only from the explicit --ledger-source-dir inputs. Root import-ledger is not assumed to aggregate prior batches.",
        v8_ready_scope_is_not_full_universe:
          "Ready scope files are treated as closure snapshots, not as the full input process universe.",
        read_only: true,
      },
    };

    assert.deepEqual(report, expectedReport);
    assert.equal(
      fs.readFileSync(path.join(root, "coverage/bafu-process-universe.coverage.jsonl"), "utf8"),
      processRows.map((row) => JSON.stringify(row)).join("\n") + "\n",
    );
    assert.equal(
      fs.readFileSync(path.join(root, "coverage/bafu-process-coverage-gaps.jsonl"), "utf8"),
      `${JSON.stringify(processRows[1])}\n`,
    );
    assert.equal(
      fs.readFileSync(path.join(root, "coverage/bafu-flow-reference-coverage.jsonl"), "utf8"),
      flowRows.map((row) => JSON.stringify(row)).join("\n") + "\n",
    );
    assert.equal(
      fs.readFileSync(path.join(root, "coverage/bafu-flow-reference-coverage-gaps.jsonl"), "utf8"),
      `${JSON.stringify(flowRows[2])}\n`,
    );
    assert.equal(
      fs.readFileSync(path.join(root, "coverage/bafu-universe-coverage-report.json"), "utf8"),
      `${JSON.stringify(expectedReport, null, 2)}\n`,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("universe coverage keeps ledger validation and malformed path failures native", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "foundry-universe-coverage-errors-"));
  try {
    const service = createUniverseCoverageService(runtimeFor(root));
    assert.throws(
      () => service.resolveLedgerSourceDirs("missing-ledger"),
      new Error(
        "--ledger-source-dir must point to a batch directory or import-ledger directory: missing-ledger",
      ),
    );
    assert.throws(
      () =>
        service.runReport(
          { inputDir: {} },
          {
            commandName: "dataset-bafu-universe-coverage-report",
            defaultInputDir: "input",
          },
        ),
      (error: unknown) =>
        error instanceof TypeError &&
        "code" in error &&
        error.code === "ERR_INVALID_ARG_TYPE",
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

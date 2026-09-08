import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  resolveTidasInvocation,
  resolveTidasProcessCommand,
  runTidasHandshake,
  runTidasImport,
  runTidasRowsValidation,
} from "../../scripts/lib/tidas-adapter.ts";
import { createFoundryIsolatedChildEnvironment } from "../../scripts/lib/foundry-runtime-environment.ts";

const repoRoot = path.resolve(import.meta.dirname, "..", "..");
const fixture = path.join(repoRoot, "test", "fixtures", "fake-tidas.ts");

function isolatedFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "foundry-tidas-adapter-"));
  const bin = path.join(root, "fake-tidas.ts");
  fs.copyFileSync(fixture, bin);
  fs.chmodSync(bin, 0o755);
  return { root, bin };
}

function withEnvironment<T>(values: Record<string, string | undefined>, fn: () => T): T {
  const previous = new Map(Object.keys(values).map((key) => [key, process.env[key]]));
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return fn();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function processRow(id = "11111111-1111-4111-8111-111111111111") {
  return {
    processDataSet: {
      processInformation: {
        dataSetInformation: {
          "common:UUID": id,
        },
      },
      administrativeInformation: {
        publicationAndOwnership: {
          "common:dataSetVersion": "01.00.000",
        },
      },
    },
  };
}

test("executable/config precedence is option, environment, then PATH", () => {
  assert.deepEqual(
    resolveTidasInvocation(
      { tidasBin: "/option/tidas", tidasConfig: "/option/config" },
      { TIDAS_BIN: "/env/tidas", TIDAS_CONFIG: "/env/config" },
    ),
    {
      executable: "/option/tidas",
      executable_source: "option",
      config: "/option/config",
      config_source: "option",
    },
  );
  assert.equal(
    resolveTidasInvocation({}, { TIDAS_BIN: "/env/tidas" }).executable_source,
    "TIDAS_BIN",
  );
  assert.equal(resolveTidasInvocation({}, {}).executable_source, "PATH");
});

test("script-backed TIDAS commands execute through Node on every platform", () => {
  const script = path.join(repoRoot, "test", "fixtures", "fake-tidas.ts");
  assert.deepEqual(resolveTidasProcessCommand(script), {
    command: process.execPath,
    prefixArgs: [script],
  });
  assert.deepEqual(resolveTidasProcessCommand("tidas"), {
    command: "tidas",
    prefixArgs: [],
  });
});

test("handshake accepts reviewed 0.2.x and 0.3.x contracts and rejects other minor lines", () => {
  const { root, bin } = isolatedFixture();
  try {
    const accepted = withEnvironment({ TIDAS_BIN: bin, FAKE_TIDAS_VERSION: "0.2.99" }, () =>
      runTidasHandshake({ repoRoot: root }),
    );
    assert.equal(accepted.binary_version, "0.2.99");
    const current = withEnvironment({ TIDAS_BIN: bin, FAKE_TIDAS_VERSION: "0.3.0" }, () =>
      runTidasHandshake({ repoRoot: root }),
    );
    assert.equal(current.binary_version, "0.3.0");
    assert.throws(
      () =>
        withEnvironment({ TIDAS_BIN: bin, FAKE_TIDAS_VERSION: "0.4.0" }, () =>
          runTidasHandshake({ repoRoot: root }),
        ),
      /tidas_version_unsupported/u,
    );
    assert.equal(accepted.validation_describe.schema_version, "tidas.validation-describe.v1");
    assert.ok(accepted.validation_describe.protocols);
    assert.ok(accepted.validation_describe.protocols.includes("document-validation-batch.v1"));
    assert.throws(
      () =>
        withEnvironment({ TIDAS_BIN: bin, FAKE_TIDAS_VERSION: "0.1.0" }, () =>
          runTidasHandshake({ repoRoot: root }),
        ),
      /tidas_version_unsupported/u,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("handshake forwards public environment performance budgets", () => {
  const { root, bin } = isolatedFixture();
  try {
    const result = withEnvironment(
      {
        TIDAS_BIN: bin,
        TIDAS_MEMORY_BUDGET_MIB: "768",
        TIDAS_QUEUE_CAPACITY: "384",
      },
      () => runTidasHandshake({ repoRoot: root }),
    );
    assert.deepEqual(result.args.slice(-4), [
      "--memory-budget-mib",
      "768",
      "--queue-capacity",
      "384",
    ]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("handshake can use one explicit isolated environment without ambient TIDAS state", () => {
  const { root, bin } = isolatedFixture();
  try {
    const environment = createFoundryIsolatedChildEnvironment({
      tempRoot: path.join(root, "isolated-environment"),
      sourceEnv: process.env,
      overrides: { TIDAS_BIN: bin },
    });
    environment.FAKE_TIDAS_VERSION = "0.2.88";
    environment.TIDAS_MEMORY_BUDGET_MIB = "256";
    const result = withEnvironment(
      {
        TIDAS_BIN: path.join(root, "ambient-missing"),
        FAKE_TIDAS_VERSION: "0.1.0",
        TIDAS_MEMORY_BUDGET_MIB: "999",
      },
      () => runTidasHandshake({ repoRoot: root, environment }),
    );
    assert.equal(result.binary_version, "0.2.88");
    assert.equal(result.validation_describe_stderr, "");
    assert.equal(result.invocation.executable, bin);
    assert.deepEqual(result.args.slice(-2), ["--memory-budget-mib", "256"]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("native import preserves the Rust report and default process-bundle contract", () => {
  const { root, bin } = isolatedFixture();
  const input = path.join(root, "source");
  const output = path.join(root, "output");
  fs.mkdirSync(input);
  try {
    const result = withEnvironment({ TIDAS_BIN: bin, FAKE_TIDAS_EXIT_CLASS: undefined }, () =>
      runTidasImport({
        repoRoot: root,
        options: { input, output, fromFormat: "openlca-jsonld" },
      }),
    );
    assert.equal(result.exit_code, 0);
    assert.equal(result.binary_version, "0.2.7");
    assert.equal(result.report.schema_version, "tidas.operation-report.v1");
    const importSummary = result.report.summary?.import as Record<string, unknown>;
    assert.equal(importSummary.schema_version, "tidas.import-execution-report.v1");
    assert.ok(fs.existsSync(path.join(output, "process-bundles", "index.json")));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("adapter preserves every stable nonzero Rust exit class", () => {
  const { root, bin } = isolatedFixture();
  const input = path.join(root, "source");
  fs.mkdirSync(input);
  try {
    const exitCases: Array<[string, number]> = [
      ["data-issues", 2],
      ["usage", 64],
      ["unavailable", 69],
      ["internal", 70],
      ["io", 74],
      ["cancelled", 130],
    ];
    for (const [exitClass, exitCode] of exitCases) {
      const output = path.join(root, `output-${exitClass}`);
      const result = withEnvironment({ TIDAS_BIN: bin, FAKE_TIDAS_EXIT_CLASS: exitClass }, () =>
        runTidasImport({ repoRoot: root, options: { input, output } }),
      );
      assert.equal(result.exit_code, exitCode, exitClass);
      assert.equal(result.report.exit_class, exitClass, exitClass);
      assert.equal(fs.existsSync(output), false, exitClass);
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("row validation maps official batch evidence into Foundry compatibility reports", () => {
  const { root, bin } = isolatedFixture();
  const rowsFile = path.join(root, "processes.jsonl");
  const outDir = path.join(root, "validation");
  fs.writeFileSync(rowsFile, `${JSON.stringify(processRow())}\n`);
  try {
    const invalid = withEnvironment(
      { TIDAS_BIN: bin, FAKE_TIDAS_INVALID: "1", FAKE_TIDAS_EXIT_CLASS: undefined },
      () =>
        runTidasRowsValidation({
          repoRoot: root,
          options: { rowsFile, type: "process", outDir },
        }),
    );
    assert.ok("rust_exit_code" in invalid);
    assert.equal(invalid.rust_exit_code, 0);
    assert.equal(invalid.exit_code, 2);
    assert.deepEqual(invalid.report.counts, {
      total: 1,
      valid: 0,
      invalid: 1,
      issues: 1,
      blockers: 1,
    });
    const invalidReport = invalid.report as Record<string, Record<string, unknown>>;
    const invalidIssues = (
      invalid.report.rows as Array<{
        issues: Array<{ code: string; path: string; issue_code: string }>;
      }>
    )[0].issues;
    assert.equal(invalidIssues[0].code, "fixture_invalid");
    assert.equal(invalidIssues[0].issue_code, "fixture_invalid");
    assert.equal(invalidIssues[0].path, "/");
    const wrappedRows = path.join(root, "wrapped-processes.json");
    fs.writeFileSync(
      wrappedRows,
      JSON.stringify([{ id: "11111111-1111-4111-8111-111111111111", json: processRow() }]),
    );
    const wrapped = withEnvironment(
      { TIDAS_BIN: bin, FAKE_TIDAS_INVALID: "1", FAKE_TIDAS_EXIT_CLASS: undefined },
      () =>
        runTidasRowsValidation({
          repoRoot: root,
          options: {
            rowsFile: wrappedRows,
            type: "process",
            outDir: path.join(root, "wrapped-validation"),
          },
        }),
    );
    const wrappedIssues = (
      wrapped.report.rows as Array<{ issues: Array<{ path: string; location: string }> }>
    )[0].issues;
    assert.equal(wrappedIssues[0].path, "/json/");
    assert.equal(wrappedIssues[0].location, "/", "retain the original native location separately");
    assert.equal(invalidReport.rust_contract.batch_final_schema, "tidas.validation-final-event.v1");
    const nativeIssues = withEnvironment(
      {
        TIDAS_BIN: bin,
        FAKE_TIDAS_INVALID: "1",
        FAKE_TIDAS_BATCH_DATA_ISSUES: "1",
        FAKE_TIDAS_EXIT_CLASS: undefined,
      },
      () =>
        runTidasRowsValidation({
          repoRoot: root,
          options: { rowsFile, type: "process", outDir: path.join(root, "native-data-issues") },
        }),
    );
    assert.equal(nativeIssues.rust_exit_code, 2);
    assert.equal(nativeIssues.exit_code, 2);
    assert.deepEqual(nativeIssues.report.counts, invalid.report.counts);
    assert.ok(
      typeof nativeIssues.report_file === "string" && fs.existsSync(nativeIssues.report_file),
    );
    const valid = withEnvironment({ TIDAS_BIN: bin, FAKE_TIDAS_INVALID: undefined }, () =>
      runTidasRowsValidation({
        repoRoot: root,
        options: { rowsFile, type: "process", outDir },
      }),
    );
    assert.equal(valid.exit_code, 0);
    const validReport = valid.report as Record<string, Record<string, unknown>>;
    assert.equal(validReport.counts.valid, 1);
    assert.equal(validReport.counts.invalid, 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("deep validation output preserves atomic replacement without Windows mkdtemp", (t) => {
  const { root, bin } = isolatedFixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const rowsFile = path.join(root, "processes.jsonl");
  // The suffix alone exceeds 260 characters, even when the host temp root is only /tmp.
  const parent = path.join(root, "workspace", "a".repeat(90), "b".repeat(90), "c".repeat(90));
  const outDir = path.join(parent, "validation");
  assert.ok(parent.length > 260);
  fs.writeFileSync(rowsFile, `${JSON.stringify(processRow())}\n`);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "sentinel"), "keep");
  t.mock.method(fs, "mkdtempSync", () => {
    throw Object.assign(new Error("Windows long-prefix mkdtemp"), { code: "ENOENT" });
  });
  const invoke = (exitClass?: string) =>
    withEnvironment(
      { TIDAS_BIN: bin, FAKE_TIDAS_EXIT_CLASS: exitClass, FAKE_TIDAS_INVALID: undefined },
      () =>
        runTidasRowsValidation({ repoRoot: root, options: { rowsFile, type: "process", outDir } }),
    );
  assert.equal(invoke("cancelled").exit_code, 130);
  assert.equal(fs.readFileSync(path.join(outDir, "sentinel"), "utf8"), "keep");
  assert.deepEqual(fs.readdirSync(parent), ["validation"]);
  const completed = invoke();
  assert.equal(completed.exit_code, 0);
  assert.equal(completed.report.status, "completed");
  assert.ok(typeof completed.report_file === "string" && fs.existsSync(completed.report_file));
  assert.equal(fs.existsSync(path.join(outDir, "sentinel")), false);
  assert.deepEqual(fs.readdirSync(parent), ["validation"]);
});

test("cancelled row validation cleans staging and preserves the previous output", () => {
  const { root, bin } = isolatedFixture();
  const rowsFile = path.join(root, "processes.jsonl");
  const outDir = path.join(root, "validation");
  fs.writeFileSync(rowsFile, `${JSON.stringify(processRow())}\n`);
  fs.mkdirSync(outDir);
  fs.writeFileSync(path.join(outDir, "sentinel"), "keep");
  try {
    const cancelled = withEnvironment({ TIDAS_BIN: bin, FAKE_TIDAS_EXIT_CLASS: "cancelled" }, () =>
      runTidasRowsValidation({
        repoRoot: root,
        options: { rowsFile, type: "process", outDir },
      }),
    );
    assert.equal(cancelled.exit_code, 130);
    assert.equal(fs.readFileSync(path.join(outDir, "sentinel"), "utf8"), "keep");
    assert.deepEqual(
      fs.readdirSync(root).filter((name) => name.startsWith(".tidas-validate-stage-")),
      [],
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

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
} from "../../scripts/lib/tidas-adapter.mjs";

const repoRoot = path.resolve(import.meta.dirname, "..", "..");
const fixture = path.join(repoRoot, "test", "fixtures", "fake-tidas.mjs");

function isolatedFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "foundry-tidas-adapter-"));
  const bin = path.join(root, "tidas");
  fs.copyFileSync(fixture, bin);
  fs.chmodSync(bin, 0o755);
  return { root, bin };
}

function withEnvironment(values, fn) {
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
  const script = path.join(repoRoot, "test", "fixtures", "fake-tidas.mjs");
  assert.deepEqual(resolveTidasProcessCommand(script), {
    command: process.execPath,
    prefixArgs: [script],
  });
  assert.deepEqual(resolveTidasProcessCommand("tidas"), {
    command: "tidas",
    prefixArgs: [],
  });
});

test("handshake accepts compatible 0.2.x and rejects another minor line", () => {
  const { root, bin } = isolatedFixture();
  try {
    const accepted = withEnvironment({ TIDAS_BIN: bin, FAKE_TIDAS_VERSION: "0.2.99" }, () =>
      runTidasHandshake({ repoRoot: root }),
    );
    assert.equal(accepted.binary_version, "0.2.99");
    assert.equal(accepted.validation_describe.schema_version, "tidas.validation-describe.v1");
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
    assert.equal(result.report.summary.import.schema_version, "tidas.import-execution-report.v1");
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
    for (const [exitClass, exitCode] of [
      ["data-issues", 2],
      ["usage", 64],
      ["unavailable", 69],
      ["internal", 70],
      ["io", 74],
      ["cancelled", 130],
    ]) {
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
    assert.equal(invalid.rust_exit_code, 0);
    assert.equal(invalid.exit_code, 2);
    assert.deepEqual(invalid.report.counts, {
      total: 1,
      valid: 0,
      invalid: 1,
      issues: 1,
      blockers: 1,
    });
    assert.equal(
      invalid.report.rust_contract.batch_final_schema,
      "tidas.validation-final-event.v1",
    );
    const valid = withEnvironment({ TIDAS_BIN: bin, FAKE_TIDAS_INVALID: undefined }, () =>
      runTidasRowsValidation({
        repoRoot: root,
        options: { rowsFile, type: "process", outDir },
      }),
    );
    assert.equal(valid.exit_code, 0);
    assert.equal(valid.report.counts.valid, 1);
    assert.equal(valid.report.counts.invalid, 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
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

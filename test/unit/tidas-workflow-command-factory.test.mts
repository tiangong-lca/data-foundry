import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createTidasWorkflowCommands } from "../../scripts/commands/tidas-workflow.ts";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, "..", "..");

function readRepoFile(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

function createHarness() {
  const calls: Array<{ name: string; input: unknown }> = [];
  const commands = createTidasWorkflowCommands({
    repoRoot: "/repo",
    runTidasHandshake(input) {
      calls.push({ name: "handshake", input });
      return {
        binary_version: "0.2.9",
        report: { schema: "tidas.operation-report.v1", status: "ok" },
        validation_describe: { schemas: 7 },
        validation_describe_report: { status: "passed" },
      };
    },
    runTidasImport(input) {
      calls.push({ name: "import", input });
      return { report: { schema_version: 3, status: "completed", rows: 4 }, raw: "import" };
    },
    runTidasPackageValidation(input) {
      calls.push({ name: "package-validation", input });
      return { report: { schema_version: 4, status: "valid", kind: "package" }, raw: "package" };
    },
    runTidasRowsValidation(input) {
      calls.push({ name: "rows-validation", input });
      return { report: { schema_version: 4, status: "valid", kind: "rows" }, raw: "rows" };
    },
  });
  return { calls, commands };
}

test("tidas workflow help payloads are exact and never invoke an adapter", () => {
  const { calls, commands } = createHarness();
  assert.deepEqual(commands.runTidasHandshake({ help: true }), {
    schema_version: 1,
    status: "help",
    command: "tidas-handshake",
    usage: [
      "node scripts/foundry.ts tidas-handshake [--tidas-bin /path/to/tidas] [--tidas-config /path/to/config]",
    ],
    owner: "tidas",
    remote_write_mode: "read-only",
  });
  assert.equal(commands.runTidasImport({ help: true }).command, "dataset-tidas-import");
  assert.equal(
    commands.runTidasPackageValidation({ help: true }).command,
    "dataset-tidas-validate",
  );
  assert.deepEqual(calls, []);
});

test("tidas handshake and import preserve exact dependency input and report projection", () => {
  const { calls, commands } = createHarness();
  const handshakeOptions = { tidasBin: "/fake/tidas", marker: "handshake" };
  const handshake = commands.runTidasHandshake(handshakeOptions);
  assert.deepEqual(calls.shift(), {
    name: "handshake",
    input: { repoRoot: "/repo", options: handshakeOptions },
  });
  assert.deepEqual(handshake, {
    schema_version: 1,
    status: "passed",
    command: "tidas-handshake",
    binary_version: "0.2.9",
    operation_report: { schema: "tidas.operation-report.v1", status: "ok" },
    validation_describe: { schemas: 7 },
    validation_describe_report: { status: "passed" },
    foundry_adapter: {
      binary_version: "0.2.9",
      report: { schema: "tidas.operation-report.v1", status: "ok" },
      validation_describe: { schemas: 7 },
      validation_describe_report: { status: "passed" },
    },
  });

  const importOptions = { input: "fixture.zip", output: "out" };
  assert.deepEqual(commands.runTidasImport(importOptions), {
    schema_version: 3,
    status: "completed",
    rows: 4,
    foundry_adapter: {
      report: { schema_version: 3, status: "completed", rows: 4 },
      raw: "import",
    },
  });
  assert.deepEqual(calls.shift(), {
    name: "import",
    input: { repoRoot: "/repo", options: importOptions },
  });
});

test("tidas validation preserves rows-file branch precedence and package fallback", () => {
  const { calls, commands } = createHarness();
  const packageOptions = { input: "package" };
  assert.equal(commands.runTidasPackageValidation(packageOptions).kind, "package");
  assert.deepEqual(calls.shift(), {
    name: "package-validation",
    input: { repoRoot: "/repo", options: packageOptions },
  });

  const rowsOptions = { rowsFile: "rows.jsonl", input: "ignored-package" };
  assert.equal(commands.runTidasPackageValidation(rowsOptions).kind, "rows");
  assert.deepEqual(calls.shift(), {
    name: "rows-validation",
    input: { repoRoot: "/repo", options: rowsOptions },
  });
  assert.deepEqual(calls, []);
});

test("tidas workflow command factory exists only as zero-any native TypeScript", () => {
  const typedPath = path.join(repoRoot, "scripts/commands/tidas-workflow.ts");
  assert.equal(fs.existsSync(typedPath), true);
  assert.equal(fs.existsSync(typedPath.replace(/\.ts$/u, ".mjs")), false);
  const source = readRepoFile("scripts/commands/tidas-workflow.ts");
  assert.doesNotMatch(source, /\bany\b/u);
  assert.deepEqual(
    [...source.matchAll(/export function\s+([A-Za-z0-9_]+)/gu)].map((match) => match[1]),
    ["createTidasWorkflowCommands"],
  );
});

test("all active tidas workflow owner consumers target the typed command factory", () => {
  for (const consumer of [
    "scripts/foundry.ts",
    "scripts/lib/foundry-command-metadata.ts",
    "test/unit/tidas-workflow-command-factory.test.mts",
  ]) {
    const source = readRepoFile(consumer);
    assert.match(source, /(?:commands\/|\.\.\/\.\.\/scripts\/commands\/)tidas-workflow\.ts/u);
    assert.doesNotMatch(source, /commands\/tidas-workflow\.mjs/u);
  }
});

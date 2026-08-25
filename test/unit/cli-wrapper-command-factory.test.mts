import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createCliWrapperCommands } from "../../scripts/commands/cli-wrappers.ts";

type JsonObject = Record<string, unknown>;

interface WrapperReport extends JsonObject {
  foundry_wrapper: JsonObject & {
    command: string;
    executable: string;
    args: string[];
    cli_args: string[];
    cli_package: JsonObject | null;
    exit_code: number;
    stderr: string;
  };
}

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, "..", "..");

function readRepoFile(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

function asList(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(asList);
  if (value === null || value === undefined || value === "") return [];
  return String(value)
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function appendOption(args: string[], name: string, value: unknown): void {
  if (value === null || value === undefined || value === "") return;
  args.push(name, String(value));
}

function appendRepeatedOptions(args: string[], name: string, value: unknown): void {
  for (const entry of asList(value)) args.push(name, entry);
}

function withTempRoot(name: string, run: (root: string) => void): void {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `foundry-${name}-`));
  try {
    run(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function writeExecutableFixture(root: string): string {
  const script = path.join(root, "fixture-cli.mjs");
  fs.writeFileSync(
    script,
    [
      'const mode = process.env.FOUNDRY_WRAPPER_FIXTURE_MODE || "ok";',
      'if (mode === "invalid") { process.stdout.write("not-json\\n"); process.stderr.write("fixture-stderr\\n"); process.exit(3); }',
      'const report = { schema_version: 9, status: mode === "nonzero" ? "blocked" : "passed", observed: { argv: process.argv.slice(2), cwd: process.cwd(), marker: process.env.FOUNDRY_WRAPPER_TEST_MARKER ?? null } };',
      "process.stdout.write(`${JSON.stringify(report)}\\n`);",
      'process.stderr.write("fixture-warning\\n");',
      'if (mode === "nonzero") process.exit(7);',
      "",
    ].join("\n"),
  );
  return script;
}

function createHarness(root: string, script: string) {
  return createCliWrapperCommands({
    appendOption,
    appendRepeatedOptions,
    repoRoot: root,
    resolveTiangongLcaCliCommand() {
      return {
        command: process.execPath,
        args: [script, "--prefix"],
        display: "fixture tiangong-lca",
        package: { name: "@tiangong-lca/cli", version: "0.1.1" },
      };
    },
    resolveTiangongLcaCliBin() {
      return "/unused/fallback";
    },
  });
}

function withFixtureEnvironment<T>(values: Record<string, string | undefined>, run: () => T): T {
  const previous = new Map(Object.keys(values).map((key) => [key, process.env[key]]));
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return run();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("CLI queue wrapper preserves executable prefix, option order, CWD, environment, stderr, and JSON", () => {
  withTempRoot("cli-wrapper-queue", (root) => {
    const script = writeExecutableFixture(root);
    const commands = createHarness(root, script);
    const report = withFixtureEnvironment(
      {
        FOUNDRY_WRAPPER_FIXTURE_MODE: "ok",
        FOUNDRY_WRAPPER_TEST_MARKER: "marker-42",
      },
      () =>
        commands.runDatasetCurationQueueBuild({
          processes: "rows/processes.jsonl",
          flows: "rows/flows.jsonl",
          support: ["rows/sources.jsonl", "rows/contacts.jsonl"],
          externalFlowRefs: "refs/a.jsonl,refs/b.jsonl",
          excludeProcessIds: ["process-b", "process-a"],
          processLimit: 17,
          outDir: "queue-output",
        }) as WrapperReport,
    );

    const expectedCliArgs = [
      "dataset",
      "curation-queue",
      "build",
      "--json",
      "--processes",
      "rows/processes.jsonl",
      "--flows",
      "rows/flows.jsonl",
      "--support",
      "rows/sources.jsonl",
      "--support",
      "rows/contacts.jsonl",
      "--external-flow-ref",
      "refs/a.jsonl",
      "--external-flow-ref",
      "refs/b.jsonl",
      "--exclude-process-id",
      "process-b",
      "--exclude-process-id",
      "process-a",
      "--process-limit",
      "17",
      "--out-dir",
      "queue-output",
    ];
    assert.equal(report.status, "passed");
    assert.deepEqual((report.observed as JsonObject).argv, ["--prefix", ...expectedCliArgs]);
    assert.equal((report.observed as JsonObject).cwd, fs.realpathSync(root));
    assert.equal((report.observed as JsonObject).marker, "marker-42");
    assert.deepEqual(report.foundry_wrapper.cli_args, expectedCliArgs);
    assert.deepEqual(report.foundry_wrapper.args, [script, "--prefix", ...expectedCliArgs]);
    assert.equal(report.foundry_wrapper.command, "fixture tiangong-lca");
    assert.equal(report.foundry_wrapper.executable, process.execPath);
    assert.equal(report.foundry_wrapper.exit_code, 0);
    assert.equal(report.foundry_wrapper.stderr, "fixture-warning\n");
    assert.deepEqual(report.foundry_wrapper.cli_package, {
      name: "@tiangong-lca/cli",
      version: "0.1.1",
    });
  });
});

test("CLI patch wrapper preserves boolean placement and returns valid JSON on nonzero exit", () => {
  withTempRoot("cli-wrapper-patch", (root) => {
    const script = writeExecutableFixture(root);
    const commands = createHarness(root, script);
    const report = withFixtureEnvironment(
      { FOUNDRY_WRAPPER_FIXTURE_MODE: "nonzero" },
      () =>
        commands.runDatasetPatchApply({
          input: "rows.jsonl",
          patch: "patches.json",
          out: "patched.jsonl",
          outDir: "apply",
          authoringPackageDir: "packages",
          requireAuthoringPackage: "true",
          requireActionItemClosure: true,
        }) as WrapperReport,
    );
    assert.equal(report.status, "blocked");
    assert.deepEqual(report.foundry_wrapper.cli_args, [
      "dataset",
      "patch",
      "apply",
      "--json",
      "--input",
      "rows.jsonl",
      "--patch",
      "patches.json",
      "--out",
      "patched.jsonl",
      "--out-dir",
      "apply",
      "--authoring-package-dir",
      "packages",
      "--require-authoring-package",
      "--require-action-item-closure",
    ]);
    assert.equal(report.foundry_wrapper.exit_code, 7);
    assert.equal(report.foundry_wrapper.stderr, "fixture-warning\n");
    assert.equal(report.foundry_wrapper.remote_write_mode, "read-only");
  });
});

test("CLI wrapper keeps diagnostic stdout/stderr and native spawn errors fail closed", () => {
  withTempRoot("cli-wrapper-errors", (root) => {
    const script = writeExecutableFixture(root);
    const commands = createHarness(root, script);
    assert.throws(
      () =>
        withFixtureEnvironment({ FOUNDRY_WRAPPER_FIXTURE_MODE: "invalid" }, () =>
          commands.runDatasetPatchApply({ input: "rows", patch: "patch" }),
        ),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /did not emit JSON/u);
        assert.match(error.message, /stdout:\nnot-json/u);
        assert.match(error.message, /stderr:\nfixture-stderr/u);
        return true;
      },
    );

    const missing = createCliWrapperCommands({
      appendOption,
      appendRepeatedOptions,
      repoRoot: root,
      resolveTiangongLcaCliCommand() {
        return {
          command: path.join(root, "missing-cli"),
          args: [],
          display: "missing",
          package: null,
        };
      },
      resolveTiangongLcaCliBin() {
        return path.join(root, "also-missing");
      },
    });
    assert.throws(
      () => missing.runDatasetCurationQueueBuild({ processes: "rows" }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.equal((error as NodeJS.ErrnoException).code, "ENOENT");
        return true;
      },
    );
  });
});

test("CLI wrapper help is exact and never resolves or spawns the CLI", () => {
  const commands = createCliWrapperCommands({
    appendOption,
    appendRepeatedOptions,
    repoRoot: "/repo",
    resolveTiangongLcaCliCommand() {
      throw new Error("help must not resolve CLI");
    },
    resolveTiangongLcaCliBin() {
      throw new Error("help must not resolve fallback");
    },
  });
  assert.equal(commands.runDatasetCurationQueueBuild({ help: true }).status, "help");
  assert.equal(commands.runDatasetPatchApply({ help: true }).status, "help");
});

test("CLI wrapper exists only as zero-escape native TypeScript with no shell-string authority", () => {
  const typedPath = path.join(repoRoot, "scripts/commands/cli-wrappers.ts");
  assert.equal(fs.existsSync(typedPath), true);
  assert.equal(fs.existsSync(typedPath.replace(/\.ts$/u, ".mjs")), false);
  const source = fs.readFileSync(typedPath, "utf8");
  assert.doesNotMatch(source, /\bas\s+any\b|:\s*any\b|\bany\s*\[\]|<\s*any\b|,\s*any\s*>/u);
  assert.doesNotMatch(source, /@ts-(?:no)?check|@ts-ignore/u);
  assert.doesNotMatch(source, /execSync|execFileSync|shell\s*:\s*true|\bdisplay\s*\)/u);
  assert.match(source, /spawnSync\(cli\.command,\s*spawnArgs/u);
});

test("CLI wrapper consumers target the typed command factory", () => {
  for (const consumer of [
    "scripts/foundry.mjs",
    "scripts/lib/foundry-command-metadata.ts",
    "test/unit/cli-wrapper-command-factory.test.mts",
  ]) {
    const source = readRepoFile(consumer);
    assert.match(source, /(?:commands\/|scripts\/commands\/)cli-wrappers\.ts/u);
    assert.doesNotMatch(source, /(?:commands\/|scripts\/commands\/)cli-wrappers\.mjs/u);
  }
});

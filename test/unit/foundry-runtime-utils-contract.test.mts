import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { parseScalar } from "../../scripts/lib/foundry-args.ts";
import {
  createFoundryRuntimeUtils,
  resolveInstalledTiangongLcaCliPackage,
  resolveTiangongLcaCliRuntimeCommand,
} from "../../scripts/lib/foundry-runtime-utils.ts";

type JsonObject = Record<string, unknown>;

function withTempRoot(name: string, body: (root: string) => void): void {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `${name}-`));
  try {
    body(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function createRuntime(root: string) {
  return createFoundryRuntimeUtils({ parseScalar, repoRoot: root });
}

function withEnvironment(changes: Record<string, string | undefined>, body: () => void): void {
  const previous = Object.fromEntries(Object.keys(changes).map((key) => [key, process.env[key]]));
  try {
    for (const [key, value] of Object.entries(changes)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    body();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("installed CLI resolution and runtime command precedence stay package-pinned and shell-safe", () => {
  withTempRoot("foundry-runtime-command", (root) => {
    const installed = resolveInstalledTiangongLcaCliPackage();
    assert.equal(installed.packageName, "@tiangong-lca/cli");
    assert.equal(installed.packageVersion, "0.1.11");
    assert.equal(installed.packageSpec, "@tiangong-lca/cli@0.1.11");
    assert.equal(path.basename(installed.packageJsonPath), "package.json");
    assert.equal(fs.statSync(installed.binPath).isFile(), true);
    assert.equal(fs.statSync(installed.schemaDir).isDirectory(), true);

    const defaultCommand = resolveTiangongLcaCliRuntimeCommand({});
    assert.equal(defaultCommand.command, process.execPath);
    assert.deepEqual(defaultCommand.args, [installed.binPath]);
    assert.equal(defaultCommand.source, "installed_package");
    assert.equal(defaultCommand.package, "@tiangong-lca/cli@0.1.11");
    assert.equal(defaultCommand.package_version, "0.1.11");
    assert.equal(defaultCommand.bin_path, installed.binPath);

    const overridePath = path.join(root, "CLI folder", "owner-cli.mjs");
    const override = resolveTiangongLcaCliRuntimeCommand({
      TIANGONG_LCA_CLI_BIN: overridePath,
    });
    assert.equal(override.source, "TIANGONG_LCA_CLI_BIN");
    assert.equal(override.package, null);
    assert.equal(override.package_version, null);
    assert.equal(override.bin_path, overridePath);
    if (process.platform === "win32") {
      assert.equal(override.command, process.execPath);
      assert.deepEqual(override.args, [overridePath]);
    } else {
      assert.equal(override.command, overridePath);
      assert.deepEqual(override.args, []);
    }
    assert.match(override.display, /^'.*CLI folder.*'$/u);

    const runtime = createRuntime(root);
    withEnvironment({ TIANGONG_LCA_CLI_BIN: overridePath }, () => {
      const resolved = runtime.resolveTiangongLcaCliCommand();
      assert.equal(resolved.bin_path, overridePath);
      assert.equal(runtime.resolveTiangongLcaCliBin(), resolved.display);
      assert.deepEqual(runtime.resolveTiangongLcaCliCommandPrefix(), [
        resolved.command,
        ...resolved.args,
      ]);
    });
  });
});

test("runtime factory retains its exact helper surface", () => {
  const runtime = createRuntime("/tmp/foundry-runtime-surface");
  assert.deepEqual(Object.keys(runtime), [
    "appendOption",
    "appendRepeatedOptions",
    "asText",
    "blockersFromLocationAuditStage",
    "booleanOption",
    "cloneJson",
    "compactStageReport",
    "countJsonLinesFile",
    "countRowsFile",
    "deterministicUuid",
    "directoryExists",
    "ensureArray",
    "fileExists",
    "findFilesByName",
    "hasUnresolvedAiPlaceholder",
    "hasUsableEnvValue",
    "integerOption",
    "isPlaceholderEnvValue",
    "jsonSha256",
    "loadEnvFile",
    "loadRuntimeEnv",
    "normalizedList",
    "nowIso",
    "positiveIntegerOption",
    "postAuthoringPrewriteGateBlockers",
    "readJson",
    "readJsonArtifactOption",
    "readJsonLines",
    "readJsonOrJsonLines",
    "readRowsFile",
    "readText",
    "replaceFrontmatterField",
    "reportFileFromCliStage",
    "reportInputPath",
    "repoRelativeMaybe",
    "repoRelativePath",
    "resolveRepoPath",
    "resolveTiangongLcaCliCommand",
    "resolveTiangongLcaCliCommandPrefix",
    "resolveTiangongLcaCliBin",
    "runTiangongJsonStage",
    "sameResolvedPath",
    "sha256Text",
    "shellQuote",
    "skippedPrewriteStage",
    "splitFrontmatter",
    "stageExitBlocker",
    "taskMetaFromFile",
    "unique",
    "writeJson",
    "writeText",
  ]);
});

test("runtime file, JSON, JSONL, row, count, search, and portable path helpers preserve exact behavior", () => {
  withTempRoot("foundry-runtime-files", (root) => {
    const runtime = createRuntime(root);
    const textPath = path.join(root, "nested", "plain.txt");
    const jsonPath = path.join(root, "data", "value.json");
    const jsonlPath = path.join(root, "data", "rows.jsonl");
    const envelopePath = path.join(root, "data", "envelope.json");
    const itemsPath = path.join(root, "data", "items.json");
    const scalarPath = path.join(root, "data", "scalar.json");

    runtime.writeText(textPath, "exact text\n");
    runtime.writeJson(jsonPath, { b: 2, a: [1, true, null] });
    fs.writeFileSync(jsonlPath, '{"id":1}\r\n\r\n {"id":2} \n');
    runtime.writeJson(envelopePath, { rows: [{ id: "row" }] });
    runtime.writeJson(itemsPath, { items: [{ id: "item-1" }, { id: "item-2" }] });
    runtime.writeJson(scalarPath, { id: "scalar" });

    assert.equal(runtime.readText(textPath), "exact text\n");
    assert.equal(
      fs.readFileSync(jsonPath, "utf8"),
      '{\n  "b": 2,\n  "a": [\n    1,\n    true,\n    null\n  ]\n}\n',
    );
    assert.deepEqual(runtime.readJson(jsonPath), { b: 2, a: [1, true, null] });
    assert.deepEqual(runtime.readJsonLines(jsonlPath), [{ id: 1 }, { id: 2 }]);
    assert.equal(runtime.fileExists(textPath), true);
    assert.equal(runtime.fileExists(path.dirname(textPath)), false);
    assert.equal(runtime.directoryExists(path.dirname(textPath)), true);
    assert.equal(runtime.directoryExists(textPath), false);
    assert.equal(runtime.resolveRepoPath("data/value.json"), jsonPath);
    assert.equal(runtime.resolveRepoPath(jsonPath), jsonPath);
    assert.equal(runtime.resolveRepoPath(null), null);
    assert.throws(
      () => runtime.resolveRepoPath(7),
      (error: unknown) => error instanceof TypeError,
    );
    assert.equal(runtime.repoRelativePath(jsonPath), "data/value.json");
    assert.equal(runtime.repoRelativeMaybe(null), null);
    assert.equal(
      runtime.sameResolvedPath(jsonPath, path.join(root, "data", ".", "value.json")),
      true,
    );
    assert.equal(runtime.sameResolvedPath(jsonPath, null), false);

    assert.equal(runtime.countJsonLinesFile(jsonlPath), 2);
    assert.equal(runtime.countRowsFile(jsonlPath), 2);
    assert.equal(runtime.countRowsFile(jsonPath), 1);
    assert.equal(runtime.countRowsFile(envelopePath), 1);
    assert.equal(runtime.countRowsFile(itemsPath), 2);
    assert.equal(runtime.countRowsFile(path.join(root, "missing.json")), 0);
    assert.deepEqual(runtime.readRowsFile(jsonlPath), [{ id: 1 }, { id: 2 }]);
    assert.deepEqual(runtime.readRowsFile(envelopePath), [{ id: "row" }]);
    assert.deepEqual(runtime.readRowsFile(itemsPath), [{ id: "item-1" }, { id: "item-2" }]);
    assert.deepEqual(runtime.readRowsFile(scalarPath), [{ id: "scalar" }]);
    assert.deepEqual(runtime.readRowsFile(path.join(root, "missing.json")), []);

    const badJsonl = path.join(root, "data", "bad.jsonl");
    fs.writeFileSync(badJsonl, '{"ok":true}\n{bad}\n');
    assert.throws(
      () => runtime.readJsonLines(badJsonl),
      (error: unknown) =>
        error instanceof Error &&
        error.message.startsWith("Invalid JSONL at data/bad.jsonl:2: SyntaxError"),
    );

    for (const relativePath of [
      "search/a/target.json",
      "search/b/deep/target.json",
      "search/node_modules/target.json",
      "search/.git/target.json",
    ]) {
      runtime.writeJson(path.join(root, relativePath), { relativePath });
    }
    assert.deepEqual(
      runtime.findFilesByName("search", "target.json").map(runtime.repoRelativePath),
      ["search/a/target.json", "search/b/deep/target.json"],
    );
    assert.deepEqual(
      runtime.findFilesByName("search", "target.json", 1).map(runtime.repoRelativePath),
      ["search/a/target.json"],
    );
    assert.deepEqual(runtime.findFilesByName("missing", "target.json"), []);
  });
});

test("runtime scalar, frontmatter, option, hash, clone, UUID, and placeholder helpers retain exact contracts", () => {
  withTempRoot("foundry-runtime-values", (root) => {
    const runtime = createRuntime(root);
    assert.deepEqual(
      [undefined, null, " text ", 7, false, { value: "ignored" }].map(runtime.asText),
      ["", "", "text", "7", "false", ""],
    );
    assert.deepEqual(runtime.splitFrontmatter("body only"), {
      frontmatter: "",
      body: "body only",
    });
    assert.deepEqual(runtime.splitFrontmatter("---\nstate: Todo\ncount: 3\n---\nBody\n"), {
      frontmatter: "state: Todo\ncount: 3",
      body: "Body\n",
    });
    assert.throws(
      () => runtime.splitFrontmatter("---\nstate: Todo\n"),
      new Error("Missing closing frontmatter marker."),
    );
    assert.equal(
      runtime.replaceFrontmatterField("state: Todo\nowner: me\n", "state", "Doing"),
      "state: Doing\nowner: me",
    );
    assert.equal(
      runtime.replaceFrontmatterField("state: Todo", "priority", "P1"),
      "state: Todo\npriority: P1",
    );
    const taskPath = path.join(root, "task.md");
    runtime.writeText(taskPath, "---\nstate: Todo\ncount: 3\nenabled: true\n---\nTask body\n");
    assert.deepEqual(runtime.taskMetaFromFile(taskPath), {
      text: "---\nstate: Todo\ncount: 3\nenabled: true\n---\nTask body\n",
      frontmatter: "state: Todo\ncount: 3\nenabled: true",
      body: "Task body\n",
      meta: { state: "Todo", count: 3, enabled: true },
    });

    assert.deepEqual(runtime.ensureArray(null), []);
    assert.deepEqual(runtime.ensureArray(""), []);
    assert.deepEqual(runtime.ensureArray("x"), ["x"]);
    assert.deepEqual(runtime.normalizedList([" a,b ", 3, "", "c"]), ["a", "b", "3", "c"]);
    assert.deepEqual(runtime.unique(["b", "", "a", "b", null, "a"]), ["b", "a"]);
    const args: string[] = [];
    runtime.appendOption(args, "--zero", 0);
    runtime.appendOption(args, "--false", false);
    runtime.appendOption(args, "--empty", "");
    runtime.appendRepeatedOptions(args, "--tag", [" a,b ", "c"]);
    assert.deepEqual(args, ["--zero", "0", "--tag", "a", "--tag", "b", "--tag", "c"]);
    assert.deepEqual([true, "true", "1", "yes", "TRUE", 1].map(runtime.booleanOption), [
      true,
      true,
      true,
      true,
      false,
      false,
    ]);
    assert.equal(runtime.integerOption("7", null), 7);
    assert.equal(runtime.integerOption("7.5", 4), 4);
    assert.equal(runtime.positiveIntegerOption("0", 4), 4);
    assert.equal(runtime.positiveIntegerOption("8", null), 8);
    assert.equal(runtime.shellQuote("plain/path"), "plain/path");
    assert.equal(runtime.shellQuote("two words' value"), "'two words'\\'' value'");

    assert.equal(runtime.sha256Text("abc"), createHash("sha256").update("abc").digest("hex"));
    assert.equal(
      runtime.jsonSha256({ b: 2, a: 1 }),
      createHash("sha256").update('{"b":2,"a":1}').digest("hex"),
    );
    const original = { nested: [{ value: 1 }] };
    const clone = runtime.cloneJson(original);
    clone.nested[0].value = 2;
    assert.equal(original.nested[0].value, 1);
    assert.equal(runtime.deterministicUuid("fixture-seed"), "f9e95945-05c9-5df7-815f-6cd62998a825");
    assert.equal(runtime.hasUnresolvedAiPlaceholder({ value: "__AI_FILL_NAME__" }), true);
    assert.equal(runtime.hasUnresolvedAiPlaceholder({ value: "complete" }), false);
  });
});

test("runtime env-file helpers preserve explicit-file precedence without reading repository .env", () => {
  withTempRoot("foundry-runtime-env", (root) => {
    const runtime = createRuntime(root);
    const envPath = path.join(root, "explicit-test.env");
    runtime.writeText(
      envPath,
      [
        "# comment",
        "FOUNDRY_RUNTIME_TEST_EXISTING=file-value",
        'export FOUNDRY_RUNTIME_TEST_QUOTED="quoted value"',
        "FOUNDRY_RUNTIME_TEST_PLACEHOLDER=replaced",
        "invalid line",
      ].join("\n"),
    );
    withEnvironment(
      {
        FOUNDRY_RUNTIME_TEST_EXISTING: "process-value",
        FOUNDRY_RUNTIME_TEST_QUOTED: undefined,
        FOUNDRY_RUNTIME_TEST_PLACEHOLDER: "REPLACE_ME",
      },
      () => {
        assert.deepEqual(runtime.loadEnvFile(path.join(root, "missing.env")), {
          file: path.join(root, "missing.env"),
          loaded: false,
          keys: [],
        });
        assert.deepEqual(runtime.loadEnvFile(envPath), {
          file: envPath,
          loaded: true,
          keys: [
            "FOUNDRY_RUNTIME_TEST_EXISTING",
            "FOUNDRY_RUNTIME_TEST_QUOTED",
            "FOUNDRY_RUNTIME_TEST_PLACEHOLDER",
          ],
        });
        assert.equal(process.env.FOUNDRY_RUNTIME_TEST_EXISTING, "process-value");
        assert.equal(process.env.FOUNDRY_RUNTIME_TEST_QUOTED, "quoted value");
        assert.equal(process.env.FOUNDRY_RUNTIME_TEST_PLACEHOLDER, "replaced");
        assert.equal(runtime.hasUsableEnvValue("FOUNDRY_RUNTIME_TEST_QUOTED"), true);
        assert.equal(runtime.isPlaceholderEnvValue("REPLACE_ME"), true);
        assert.equal(runtime.isPlaceholderEnvValue(""), true);
        assert.equal(runtime.isPlaceholderEnvValue("value"), false);
        runtime.loadEnvFile(envPath, { override: true });
        assert.equal(process.env.FOUNDRY_RUNTIME_TEST_EXISTING, "file-value");
      },
    );
  });
});

test("runtime env loading honors the explicit filesystem-disabled policy", () => {
  withTempRoot("foundry-isolated-child-env", (root) => {
    const variable = "FOUNDRY_GOLDEN_ENV_LEAK_TEST";
    fs.writeFileSync(path.join(root, ".env"), `${variable}=must-not-load\n`);
    const runtime = createRuntime(root);
    withEnvironment({ FOUNDRY_RUNTIME_ENV_FILE_POLICY: "disabled", [variable]: undefined }, () => {
      assert.deepEqual(runtime.loadRuntimeEnv(), {
        repoEnv: { file: path.join(root, ".env"), loaded: false, keys: [] },
      });
      assert.equal(process.env[variable], undefined);
    });
    withEnvironment({ FOUNDRY_RUNTIME_ENV_FILE_POLICY: undefined, [variable]: undefined }, () => {
      assert.deepEqual(runtime.loadRuntimeEnv(), {
        repoEnv: { file: path.join(root, ".env"), loaded: true, keys: [variable] },
      });
      assert.equal(process.env[variable], "must-not-load");
    });
  });
});

test("runtime stage, blocker, artifact, and local CLI execution helpers preserve exact envelopes", () => {
  withTempRoot("foundry-runtime-stages", (root) => {
    const runtime = createRuntime(root);
    const reportPath = path.join(root, "reports", "selected.json");
    const fallbackPath = path.join(root, "reports", "fallback.json");
    runtime.writeJson(reportPath, { selected: true });
    runtime.writeJson(fallbackPath, { fallback: true });

    const stage = {
      stage: "qa",
      status: "fallback-status",
      exit_code: 2,
      command: "qa-command",
      args: ["--json"],
      stderr: "qa stderr",
      report: { status: "blocked", files: { selected: "reports/selected.json" } },
      report_file: reportPath,
    };
    assert.deepEqual(runtime.compactStageReport(stage), {
      stage: "qa",
      status: "blocked",
      exit_code: 2,
      command: "qa-command",
      args: ["--json"],
      stderr: "qa stderr",
      report_file: "reports/selected.json",
    });
    assert.equal(runtime.reportInputPath({ input_file: " rows.jsonl " }), "rows.jsonl");
    assert.equal(
      runtime.reportFileFromCliStage(stage, ["files.selected"], fallbackPath),
      reportPath,
    );
    assert.equal(
      runtime.reportFileFromCliStage({ report: {} }, ["missing"], fallbackPath),
      fallbackPath,
    );
    assert.equal(
      runtime.reportFileFromCliStage({ report: {} }, ["missing"], "reports/missing.json"),
      null,
    );

    assert.deepEqual(
      runtime.blockersFromLocationAuditStage({
        exit_code: 1,
        report: { blockers: [{ code: "location_missing", message: "missing" }] },
      }),
      [
        {
          code: "location_missing",
          message: "missing",
          stage: "location_audit",
        },
      ],
    );
    assert.deepEqual(runtime.blockersFromLocationAuditStage({ exit_code: 3, stderr: "boom" }), [
      {
        code: "location_audit_failed",
        stage: "location_audit",
        message:
          "Location audit stage failed before remote write; inspect the stage stderr/report.",
        stderr: "boom",
      },
    ]);
    assert.equal(runtime.stageExitBlocker({ exit_code: 0 }, { code: "x", message: "x" }), null);
    assert.deepEqual(
      runtime.stageExitBlocker(
        { stage: "schema", exit_code: 4, report_file: reportPath },
        { code: "schema_failed", message: "Schema failed." },
      ),
      {
        code: "schema_failed",
        stage: "schema",
        message: "Schema failed.",
        exit_code: 4,
        report_file: "reports/selected.json",
      },
    );
    assert.deepEqual(
      runtime
        .postAuthoringPrewriteGateBlockers({
          schemaStage: { stage: "schema", exit_code: 1 },
          qaStage: { stage: "qa", exit_code: 2 },
          locationAuditBlockers: [{ code: "location_blocked" }],
          curationGate: { status: "blocked" },
          curationGateReportFile: fallbackPath,
        })
        .map((blocker: JsonObject) => blocker.code),
      [
        "schema_validate_not_ready",
        "deterministic_qa_not_ready",
        "location_blocked",
        "post_authoring_curation_gate_not_ready",
      ],
    );
    assert.deepEqual(runtime.skippedPrewriteStage("qa", "blocked upstream"), {
      stage: "qa",
      status: "skipped",
      exit_code: 1,
      command: "skipped",
      args: [],
      stderr: "blocked upstream",
      report: { status: "skipped", reason: "blocked upstream" },
      report_file: null,
    });
    assert.deepEqual(runtime.readJsonArtifactOption("reports/selected.json"), {
      path: reportPath,
      value: { selected: true },
    });
    assert.equal(runtime.readJsonArtifactOption("reports/missing.json"), null);
    const decisionsPath = path.join(root, "reports", "decisions.json");
    const rowsPath = path.join(root, "reports", "rows.jsonl");
    runtime.writeJson(decisionsPath, { decisions: [{ id: 1 }] });
    runtime.writeText(rowsPath, '{"id":2}\n');
    assert.deepEqual(runtime.readJsonOrJsonLines(decisionsPath), [{ id: 1 }]);
    assert.deepEqual(runtime.readJsonOrJsonLines(rowsPath), [{ id: 2 }]);

    withEnvironment({ TIANGONG_LCA_CLI_BIN: process.execPath }, () => {
      const success = runtime.runTiangongJsonStage("local-json", [
        "--input-type=module",
        "-e",
        'console.log(JSON.stringify({status:"completed",value:7}))',
      ]);
      assert.equal(success.stage, "local-json");
      assert.equal(success.executable, process.execPath);
      assert.equal(success.exit_code, 0);
      assert.equal(success.cli_package, null);
      assert.deepEqual(success.report, { status: "completed", value: 7 });
      assert.deepEqual(success.cli_args, [
        "--input-type=module",
        "-e",
        'console.log(JSON.stringify({status:"completed",value:7}))',
      ]);

      const failed = runtime.runTiangongJsonStage("local-failed", [
        "--input-type=module",
        "-e",
        'console.log(JSON.stringify({status:"failed"})); process.exit(5)',
      ]);
      assert.equal(failed.exit_code, 5);
      assert.deepEqual(failed.report, { status: "failed" });
      assert.throws(
        () =>
          runtime.runTiangongJsonStage("local-invalid", [
            "--input-type=module",
            "-e",
            'console.log("not-json")',
          ]),
        /tiangong-lca stage local-invalid did not emit JSON/u,
      );
    });
  });
});

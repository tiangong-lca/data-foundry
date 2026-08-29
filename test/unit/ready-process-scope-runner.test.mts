import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  createFoundryCommandSpec,
  executeFoundryCommandSpec,
  type ExecuteFoundryCommandSpecOptions,
  type FoundryCommandSpec,
} from "@tiangong-lca/cli/command-spec";

import { createReadyProcessScopeRunner } from "../../scripts/lib/library-orchestration/ready-process-scope-runner.ts";
import type { JsonRecord } from "../../scripts/lib/library-orchestration/entity-projection.ts";
import { testTmpRoot } from "../fixtures/foundry-core.ts";

const fixtureRoot = testTmpRoot("ready-process-scope-runner-test");
const fixedEnvironment = { FOUNDRY_TEST_BINDING: "ready-scope-runner" };

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

function relative(filePath: string | null | undefined): string | null {
  return filePath ? path.relative(fixtureRoot, filePath).replaceAll("\\", "/") : null;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function commandSpec(executable: string, argv: string[], artifactPath: string): FoundryCommandSpec {
  const bytes = fs.readFileSync(path.join(fixtureRoot, artifactPath));
  return createFoundryCommandSpec({
    executable,
    argv,
    binding: {
      artifacts: [
        {
          role: "scope_rows",
          path: artifactPath.replaceAll("\\", "/"),
          bytes: bytes.byteLength,
          sha256: createHash("sha256").update(bytes).digest("hex"),
        },
      ],
    },
  });
}

test("ready process runner executes artifact-bound specs concurrently with input-ordered reports", async () => {
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
  const processBundlesDir = path.join(fixtureRoot, "input", "process-bundles");
  const libraryResolutionPath = path.join(fixtureRoot, "input", "library-resolution.json");
  const scopeFile = path.join(fixtureRoot, "input", "scopes.jsonl");
  const outDir = path.join(fixtureRoot, "run");
  fs.mkdirSync(processBundlesDir, { recursive: true });
  const readyOkRows = path.join("input", "ready-ok.jsonl");
  const readyFailRows = path.join("input", "ready-fail.jsonl");
  fs.writeFileSync(path.join(fixtureRoot, readyOkRows), '{"scope":"ready-ok"}\n');
  fs.writeFileSync(path.join(fixtureRoot, readyFailRows), '{"scope":"ready-fail"}\n');
  const resolution = {
    schema_version: 1,
    status: "completed",
    ready_scope_ids: ["ready-ok", "ready-fail"],
    files: {},
  };
  writeJson(libraryResolutionPath, resolution);
  writeJsonLines(scopeFile, [
    {
      process_id: "ready-ok",
      process_version: "00.00.001",
      state: "ready",
      bundle_dir: "bundles/ready-ok",
      rewritten_process_file: "rewritten/ready-ok.json",
      commit_command: commandSpec("commit-tool", ["--scope", "ready-ok"], readyOkRows),
      verify_command: commandSpec("verify-tool", ["--scope", "ready-ok"], readyOkRows),
    },
    {
      process_id: "blocked-one",
      process_version: "00.00.001",
      checkpoint: { state: "blocked" },
    },
    {
      process_id: "ready-fail",
      process_version: "00.00.001",
      bundle_dir: "bundles/ready-fail",
      checkpoint: { state: "ready", rewritten_process_file: null },
      commit_handoff: {
        commit_command: commandSpec("commit-tool", ["--scope", "ready-fail"], readyFailRows),
        verify_command: commandSpec("verify-tool", ["--scope", "ready-fail"], readyFailRows),
      },
    },
  ]);

  const spawnCalls: Array<{
    executable: string;
    argv: readonly string[];
    options: JsonRecord;
  }> = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const dependencies: Parameters<typeof createReadyProcessScopeRunner>[0] & {
    executeCommandSpec: (
      spec: FoundryCommandSpec,
      options: ExecuteFoundryCommandSpecOptions,
    ) => ReturnType<typeof executeFoundryCommandSpec>;
  } = {
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
    resolveArtifactPath: (artifactPath: string) => path.join(fixtureRoot, artifactPath),
    writeJson,
    writeJsonLines,
    blockRow: (scope, dependency, code, message, requiredHumanAction) => ({
      schema_version: 1,
      blocked_process_id: scope.process_id,
      blocked_process_version: scope.process_version,
      blocking_dependency: dependency,
      reason: code,
      message,
      required_human_action: requiredHumanAction,
      rerun_command:
        "node scripts/foundry.ts dataset-library-decisions-apply --library-index <library-index> --decisions-dir <decisions-dir> --out-dir <library-resolution>",
    }),
    buildBlockedScopeReport: ({ command, blockedRows, blockedLedgerPath, reportPath }) => ({
      schema_version: 1,
      generated_at_utc: "2026-08-26T00:00:00.000Z",
      status: blockedRows.length > 0 ? "blocked_scopes_present" : "no_blocked_scopes",
      command,
      counts: { blocked_ledger_rows: blockedRows.length, blocked_scopes: blockedRows.length },
      files: {
        blocked_scope_ledger: relative(blockedLedgerPath),
        blocked_scope_report: relative(reportPath),
      },
    }),
    executeCommandSpec: async (
      spec: FoundryCommandSpec,
      options: ExecuteFoundryCommandSpecOptions,
    ) =>
      executeFoundryCommandSpec(spec, {
        ...options,
        spawnImpl: async (executable, argv, spawnOptions) => {
          inFlight += 1;
          maxInFlight = Math.max(maxInFlight, inFlight);
          spawnCalls.push({ executable, argv: [...argv], options: spawnOptions });
          await new Promise<void>((resolve) => setImmediate(resolve));
          inFlight -= 1;
          const scopeId = argv.at(-1);
          if (executable === "commit-tool" && scopeId === "ready-fail") {
            return {
              status: 7,
              signal: null,
              stdout: "partial\n",
              stderr: "boom\n",
            };
          }
          return {
            status: 0,
            signal: null,
            stdout: executable === "verify-tool" ? "verify ok\n" : "commit ok\n",
            stderr: "",
          };
        },
      }),
  };
  const runner = createReadyProcessScopeRunner(dependencies);

  const report = await Promise.resolve(
    runner.run({
      processBundlesDir,
      libraryResolutionPath,
      resolution,
      scopeFile,
      outDir,
      parallel: 3,
      commit: true,
      dryRun: false,
      commandCwd: "/controlled-cwd",
      commandEnvironment: fixedEnvironment,
      cliPackage: "@tiangong-lca/cli@0.1.3",
    }),
  );

  assert.equal(maxInFlight, 2);
  assert.deepEqual(
    spawnCalls.map(({ executable, argv }) => [executable, argv]),
    [
      ["commit-tool", ["--scope", "ready-ok"]],
      ["commit-tool", ["--scope", "ready-fail"]],
      ["verify-tool", ["--scope", "ready-ok"]],
    ],
  );
  assert.equal(
    spawnCalls.filter(
      ({ executable, argv }) => executable === "commit-tool" && argv.at(-1) === "ready-fail",
    ).length,
    1,
    "a failed mutation spec must never replay",
  );
  for (const call of spawnCalls) {
    assert.equal(call.options.cwd, "/controlled-cwd");
    assert.deepEqual(call.options.env, fixedEnvironment);
    assert.equal(call.options.encoding, "utf8");
    assert.equal(call.options.shell, false);
  }

  const checkpointPath = path.join(outDir, "scope-checkpoints.jsonl");
  const blockedPath = path.join(outDir, "blocked-scope-ledger.jsonl");
  const blockedReportPath = path.join(outDir, "blocked-scope-report.json");
  const reportPath = path.join(outDir, "dataset-process-scope-run-report.json");
  assert.equal(
    sha256(fs.readFileSync(checkpointPath, "utf8")),
    "63399faadeebed93047f88b8a5ed9a2ab73060979f0d97c4d4f1419931eb4a57",
  );
  assert.equal(
    sha256(fs.readFileSync(blockedPath, "utf8")),
    "c66733256f9825b34eb9e1585e5bb6f86d0191979986ef41083ccffd4d385ae6",
  );
  assert.equal(
    sha256(fs.readFileSync(blockedReportPath, "utf8")),
    "9ca2542385a17fbb96b7c11f511b2d328125466bfc60c795ee0c161d8108aa55",
  );
  assert.equal(
    sha256(fs.readFileSync(reportPath, "utf8")),
    "bfa6a32d8c2436611119db485b0b9d3f6386ad8c3a58a7f7460fc066ed25e887",
  );
  assert.deepEqual(
    readJsonLines(checkpointPath).map((row) => [row.process_id, row.state]),
    [
      ["ready-ok", "verified"],
      ["blocked-one", "blocked_deferred"],
      ["ready-fail", "commit_failed"],
    ],
  );
  assert.deepEqual(report, readJson(reportPath));
  assert.equal(
    fs.readFileSync(path.join(outDir, "logs", "ready-ok-00.00.001.commit.stdout.log"), "utf8"),
    "commit ok\n",
  );
  assert.equal(
    fs.readFileSync(path.join(outDir, "logs", "ready-ok-00.00.001.verify.stdout.log"), "utf8"),
    "verify ok\n",
  );
  assert.equal(
    fs.readFileSync(path.join(outDir, "logs", "ready-fail-00.00.001.commit.stderr.log"), "utf8"),
    "boom\n",
  );

  spawnCalls.length = 0;
  fs.writeFileSync(path.join(fixtureRoot, readyOkRows), '{"scope":"drifted"}\n');
  const driftOutDir = path.join(fixtureRoot, "drift-run");
  const driftReport = await runner.run({
    processBundlesDir,
    libraryResolutionPath,
    resolution,
    scopeFile,
    outDir: driftOutDir,
    parallel: 3,
    commit: true,
    dryRun: false,
    commandCwd: "/controlled-cwd",
    commandEnvironment: fixedEnvironment,
    cliPackage: "@tiangong-lca/cli@0.1.3",
  });
  assert.equal(driftReport.status, "failed");
  assert.equal(
    spawnCalls.filter(({ argv }) => argv.at(-1) === "ready-ok").length,
    0,
    "artifact drift must fail before spawn",
  );
  const driftCheckpoints = readJsonLines(path.join(driftOutDir, "scope-checkpoints.jsonl"));
  assert.match(
    String((driftCheckpoints[0].command_stages as JsonRecord[])[0].error),
    /artifact drift/u,
  );

  spawnCalls.length = 0;
  const rawScopeFile = path.join(fixtureRoot, "input", "raw-scopes.jsonl");
  writeJsonLines(rawScopeFile, [
    {
      process_id: "raw-scope",
      process_version: "00.00.001",
      state: "ready",
      commit_command: ["commit-tool", "--scope", "raw-scope"],
    },
  ]);
  const rawOutDir = path.join(fixtureRoot, "raw-run");
  const rawReport = await runner.run({
    processBundlesDir,
    libraryResolutionPath,
    resolution,
    scopeFile: rawScopeFile,
    outDir: rawOutDir,
    parallel: 2,
    commit: true,
    dryRun: false,
    commandCwd: "/controlled-cwd",
    commandEnvironment: fixedEnvironment,
    cliPackage: "@tiangong-lca/cli@0.1.3",
  });
  assert.equal(rawReport.status, "failed");
  assert.deepEqual(spawnCalls, []);
  const rawCheckpoint = readJsonLines(path.join(rawOutDir, "scope-checkpoints.jsonl"))[0];
  assert.equal(rawCheckpoint.state, "commit_failed");
  assert.match(
    String((rawCheckpoint.command_stages as JsonRecord[])[0].error),
    /CommandSpec must contain exact keys/u,
  );
});

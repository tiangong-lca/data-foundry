import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

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

test("ready process runner preserves scope order, argv execution, logs and exact reports", () => {
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
  const processBundlesDir = path.join(fixtureRoot, "input", "process-bundles");
  const libraryResolutionPath = path.join(fixtureRoot, "input", "library-resolution.json");
  const scopeFile = path.join(fixtureRoot, "input", "scopes.jsonl");
  const outDir = path.join(fixtureRoot, "run");
  fs.mkdirSync(processBundlesDir, { recursive: true });
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
      commit_command: ["commit-tool", "--scope", "ready-ok"],
      verify_command: ["verify-tool", "--scope", "ready-ok"],
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
        commit_command: ["commit-tool", "--scope", "ready-fail"],
        verify_command: ["verify-tool", "--scope", "ready-fail"],
      },
    },
  ]);

  const spawnCalls: Array<{
    executable: string;
    argv: readonly string[];
    options: JsonRecord;
  }> = [];
  const runner = createReadyProcessScopeRunner({
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
    spawnCommand: (executable, argv, options) => {
      spawnCalls.push({ executable, argv: [...argv], options });
      const scopeId = argv.at(-1);
      if (executable === "commit-tool" && scopeId === "ready-fail") {
        return { status: 7, stdout: "partial\n", stderr: "boom\n" };
      }
      return {
        status: 0,
        stdout: executable === "verify-tool" ? "verify ok\n" : "commit ok\n",
        stderr: "",
      };
    },
  });

  const report = runner.run({
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
  });

  assert.deepEqual(
    spawnCalls.map(({ executable, argv }) => [executable, argv]),
    [
      ["commit-tool", ["--scope", "ready-ok"]],
      ["verify-tool", ["--scope", "ready-ok"]],
      ["commit-tool", ["--scope", "ready-fail"]],
    ],
  );
  for (const call of spawnCalls) {
    assert.equal(call.options.cwd, "/controlled-cwd");
    assert.deepEqual(call.options.env, fixedEnvironment);
    assert.equal(call.options.encoding, "utf8");
    assert.notEqual(call.options.shell, true, "argv execution must never enable a shell");
  }

  const checkpointPath = path.join(outDir, "scope-checkpoints.jsonl");
  const blockedPath = path.join(outDir, "blocked-scope-ledger.jsonl");
  const blockedReportPath = path.join(outDir, "blocked-scope-report.json");
  const reportPath = path.join(outDir, "dataset-process-scope-run-report.json");
  assert.equal(
    sha256(fs.readFileSync(checkpointPath, "utf8")),
    "4eed63dd28e94f4412dfb5e57614a1b8dabaa904705597c3b516d34d6325fb4f",
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
    "c6ce06249f122855b606bd8d82fd7e4a2b20dcd3a83661e05e9097f4a1a32882",
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
});

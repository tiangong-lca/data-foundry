import { createHash } from "node:crypto";
import test from "node:test";

import {
  assert,
  fs,
  path,
  readJson,
  readJsonLines,
  rel,
  repoRoot,
  runFoundry,
  writeJson,
  writeJsonLines,
  writeText,
} from "../fixtures/foundry-core.mjs";

const root = path.join(repoRoot, "tmp", "identity-preflight-fail-closed");
const FLOW_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function prepare(mode: string) {
  const caseRoot = path.join(root, mode);
  fs.rmSync(caseRoot, { recursive: true, force: true });
  const requestFile = path.join(caseRoot, "requests", "flow.json");
  const outputDir = path.join(caseRoot, "identity-preflight", "flow");
  const reportFile = path.join(outputDir, "outputs", "identity-decision.json");
  const indexFile = path.join(caseRoot, "index", "identity-preflight-requests.jsonl");
  const fakeCli = path.join(caseRoot, "bin", "fake-cli.cjs");
  const marker = path.join(caseRoot, "executions.txt");
  const requestText = `${JSON.stringify({ schema_version: 1, target: { id: FLOW_ID } }, null, 2)}\n`;
  writeText(requestFile, requestText);
  writeJsonLines(indexFile, [
    {
      dataset_type: "flow",
      dataset_id: FLOW_ID,
      dataset_version: "00.00.001",
      target_sha256: sha256(JSON.stringify({ id: FLOW_ID })),
      request_bytes_sha256: sha256(requestText),
      request_file: rel(requestFile),
      output_dir: rel(outputDir),
      expected_report_file: rel(reportFile),
      relevant_input_hashes: { source: "2".repeat(64) },
    },
  ]);
  writeText(
    fakeCli,
    `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const args = process.argv.slice(2);
const outDir = args[args.indexOf("--out-dir") + 1];
const mode = process.env.FAKE_MODE;
const marker = process.env.FAKE_MARKER;
fs.mkdirSync(path.join(outDir, "outputs"), { recursive: true });
fs.appendFileSync(marker, "run\\n");
const disk = { schema_version: 1, status: mode === "failed-status" ? "failed" : "passed", decision: "create_new", ...(mode === "ok-false" ? { ok: false } : { ok: true }) };
const stdout = mode === "mismatch" ? { ...disk, decision: "reuse_existing" } : disk;
if (mode !== "stale") fs.writeFileSync(path.join(outDir, "outputs", "identity-decision.json"), JSON.stringify(disk, null, 2) + "\\n");
if (mode === "malformed-stdout") process.stdout.write("not-json\\n");
else process.stdout.write(JSON.stringify(stdout) + "\\n");
process.exit(mode === "nonzero" ? 1 : 0);
`,
  );
  fs.chmodSync(fakeCli, 0o755);
  return { caseRoot, requestFile, outputDir, reportFile, indexFile, fakeCli, marker };
}

function runCase(mode: string, extraArgs: string[] = []) {
  const fixture = prepare(mode);
  if (mode === "stale") {
    writeJson(fixture.reportFile, {
      schema_version: 1,
      status: "passed",
      decision: "create_new",
      ok: true,
    });
    const old = new Date("2020-01-01T00:00:00.000Z");
    fs.utimesSync(fixture.reportFile, old, old);
  }
  const result = runFoundry(
    [
      "dataset-identity-preflight-run",
      "--index",
      rel(fixture.indexFile),
      "--out-dir",
      rel(path.join(fixture.caseRoot, "run")),
      ...extraArgs,
    ],
    {
      env: { TIANGONG_LCA_CLI_BIN: fixture.fakeCli, FAKE_MODE: mode, FAKE_MARKER: fixture.marker },
    },
  );
  return { fixture, result };
}

test("identity preflight runner fails nonzero, malformed, stale, mismatch, ok:false, and failed status", () => {
  const expected = new Map([
    ["nonzero", "identity_preflight_cli_exit_nonzero"],
    ["malformed-stdout", "identity_preflight_stdout_missing_or_non_json"],
    ["stale", "identity_preflight_disk_report_stale"],
    ["mismatch", "identity_preflight_stdout_disk_mismatch"],
    ["ok-false", "identity_preflight_report_not_ok"],
    ["failed-status", "identity_preflight_report_status_invalid"],
  ]);
  for (const [mode, code] of expected) {
    const { result } = runCase(mode);
    assert.equal(result.code, 1, `${mode}: ${JSON.stringify(result.json)}`);
    assert.equal(result.json.status, "failed");
    assert.equal(result.json.results[0].status, "failed");
    assert.equal(result.json.results[0].failure_code, code);
  }
});

test("only-pending skips only an exact bound execution manifest", () => {
  const { fixture, result } = runCase("valid");
  assert.equal(result.code, 0, JSON.stringify(result.json));
  assert.equal(result.json.status, "completed");
  const manifestFile = path.join(
    fixture.outputDir,
    "outputs",
    "foundry-identity-preflight-execution.json",
  );
  assert.equal(fs.existsSync(manifestFile), true);
  assert.equal(readJson(manifestFile).schema, "tiangong-foundry.identity-preflight-execution.v1");

  const skipped = runFoundry(
    [
      "dataset-identity-preflight-run",
      "--index",
      rel(fixture.indexFile),
      "--out-dir",
      rel(path.join(fixture.caseRoot, "run-2")),
      "--only-pending",
    ],
    {
      env: {
        TIANGONG_LCA_CLI_BIN: fixture.fakeCli,
        FAKE_MODE: "valid",
        FAKE_MARKER: fixture.marker,
      },
    },
  );
  assert.equal(skipped.code, 0);
  assert.equal(skipped.json.counts.skipped_bound_execution, 1);
  assert.equal(fs.readFileSync(fixture.marker, "utf8").trim().split(/\r?\n/u).length, 1);

  const changedRequest = `${JSON.stringify(
    { schema_version: 1, target: { id: FLOW_ID, changed: true } },
    null,
    2,
  )}\n`;
  writeText(fixture.requestFile, changedRequest);
  const changedIndex = readJsonLines(fixture.indexFile);
  changedIndex[0].request_bytes_sha256 = sha256(changedRequest);
  changedIndex[0].target_sha256 = sha256(JSON.stringify({ id: FLOW_ID, changed: true }));
  writeJsonLines(fixture.indexFile, changedIndex);
  const rerun = runFoundry(
    [
      "dataset-identity-preflight-run",
      "--index",
      rel(fixture.indexFile),
      "--out-dir",
      rel(path.join(fixture.caseRoot, "run-3")),
      "--only-pending",
    ],
    {
      env: {
        TIANGONG_LCA_CLI_BIN: fixture.fakeCli,
        FAKE_MODE: "valid",
        FAKE_MARKER: fixture.marker,
      },
    },
  );
  assert.equal(rerun.code, 0);
  assert.equal(rerun.json.counts.skipped_bound_execution, 0);
  assert.equal(fs.readFileSync(fixture.marker, "utf8").trim().split(/\r?\n/u).length, 2);
});

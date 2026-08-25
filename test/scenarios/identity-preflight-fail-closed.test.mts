import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
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
} from "../fixtures/foundry-core.ts";
import { testAuthIdentityReceipt } from "../fixtures/identity-fixtures.ts";

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
  const authReceiptFile = path.join(caseRoot, "auth-identity-receipt.json");
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
if (args[0] === "auth" && args[1] === "identity-receipt") {
  const receipts = JSON.parse(fs.readFileSync(process.env.FAKE_AUTH_RECEIPTS, "utf8"));
  const authMarker = process.env.FAKE_AUTH_MARKER;
  const count = fs.existsSync(authMarker) ? Number(fs.readFileSync(authMarker, "utf8")) : 0;
  fs.writeFileSync(authMarker, String(count + 1));
  process.stdout.write(JSON.stringify(receipts[Math.min(count, receipts.length - 1)]) + "\\n");
  process.exit(0);
}
const outDir = args[args.indexOf("--out-dir") + 1];
const mode = process.env.FAKE_MODE;
const marker = process.env.FAKE_MARKER;
fs.mkdirSync(path.join(outDir, "outputs"), { recursive: true });
fs.appendFileSync(marker, "run\\n");
const disk = {
  schema_version: 1,
  status: mode === "failed-status" ? "failed" : "passed",
  decision: mode === "positive-reuse" ? "reuse_existing_reference" : "create_new",
  candidates: mode === "positive-reuse" ? [{ id: "existing-flow", version: "00.00.001" }] : [],
  ...(mode === "ok-false" ? { ok: false } : { ok: true })
};
const stdout = mode === "mismatch" ? { ...disk, decision: "reuse_existing" } : disk;
if (mode !== "stale") fs.writeFileSync(path.join(outDir, "outputs", "identity-decision.json"), JSON.stringify(disk, null, 2) + "\\n");
if (mode === "malformed-stdout") process.stdout.write("not-json\\n");
else process.stdout.write(JSON.stringify(stdout) + "\\n");
process.exit(mode === "nonzero" ? 1 : 0);
`,
  );
  fs.chmodSync(fakeCli, 0o755);
  writeJson(authReceiptFile, testAuthIdentityReceipt());
  return {
    caseRoot,
    requestFile,
    outputDir,
    reportFile,
    indexFile,
    fakeCli,
    marker,
    authReceiptFile,
  };
}

function receiptArgs(fixture: ReturnType<typeof prepare>): string[] {
  return [
    "--auth-receipt",
    rel(fixture.authReceiptFile),
    "--expected-project-ref",
    "qgzvkongdjqiiamzbbts",
    "--expected-user-id",
    "c536ee37-64ab-427b-b7e3-4e2bb4fdffb7",
  ];
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
      ...receiptArgs(fixture),
      ...extraArgs,
    ],
    {
      env: {
        TIANGONG_LCA_CLI_BIN: fixture.fakeCli,
        FOUNDRY_VERIFIED_PROJECT_REF: "qgzvkongdjqiiamzbbts",
        FOUNDRY_VERIFIED_USER_ID: "c536ee37-64ab-427b-b7e3-4e2bb4fdffb7",
        FAKE_MODE: mode,
        FAKE_MARKER: fixture.marker,
      },
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

test("only-pending skips only exact positive reuse evidence", () => {
  const { fixture, result } = runCase("positive-reuse");
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
      ...receiptArgs(fixture),
    ],
    {
      env: {
        TIANGONG_LCA_CLI_BIN: fixture.fakeCli,
        FOUNDRY_VERIFIED_PROJECT_REF: "qgzvkongdjqiiamzbbts",
        FOUNDRY_VERIFIED_USER_ID: "c536ee37-64ab-427b-b7e3-4e2bb4fdffb7",
        FAKE_MODE: "positive-reuse",
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
      ...receiptArgs(fixture),
    ],
    {
      env: {
        TIANGONG_LCA_CLI_BIN: fixture.fakeCli,
        FOUNDRY_VERIFIED_PROJECT_REF: "qgzvkongdjqiiamzbbts",
        FOUNDRY_VERIFIED_USER_ID: "c536ee37-64ab-427b-b7e3-4e2bb4fdffb7",
        FAKE_MODE: "positive-reuse",
        FAKE_MARKER: fixture.marker,
      },
    },
  );
  assert.equal(rerun.code, 0);
  assert.equal(rerun.json.counts.skipped_bound_execution, 0);
  assert.equal(fs.readFileSync(fixture.marker, "utf8").trim().split(/\r?\n/u).length, 2);
});

test("create-new negative search evidence is never reused across runs", () => {
  const { fixture, result } = runCase("valid");
  assert.equal(result.code, 0, JSON.stringify(result.json));
  const rerun = runFoundry(
    [
      "dataset-identity-preflight-run",
      "--index",
      rel(fixture.indexFile),
      "--out-dir",
      rel(path.join(fixture.caseRoot, "run-negative-rerun")),
      "--only-pending",
      ...receiptArgs(fixture),
    ],
    {
      env: {
        TIANGONG_LCA_CLI_BIN: fixture.fakeCli,
        FOUNDRY_VERIFIED_PROJECT_REF: "qgzvkongdjqiiamzbbts",
        FOUNDRY_VERIFIED_USER_ID: "c536ee37-64ab-427b-b7e3-4e2bb4fdffb7",
        FAKE_MODE: "valid",
        FAKE_MARKER: fixture.marker,
      },
    },
  );
  assert.equal(rerun.code, 0, JSON.stringify(rerun.json));
  assert.equal(rerun.json.counts.skipped_bound_execution, 0);
  assert.equal(fs.readFileSync(fixture.marker, "utf8").trim().split(/\r?\n/u).length, 2);
});

test("shared cache restores positive reuse but never publishes or restores create-new evidence", () => {
  for (const mode of ["positive-reuse", "valid"]) {
    const fixture = prepare(`shared-cache-${mode}`);
    const cacheDir = path.join(fixture.caseRoot, "shared-cache");
    const env = {
      TIANGONG_LCA_CLI_BIN: fixture.fakeCli,
      FOUNDRY_VERIFIED_PROJECT_REF: "qgzvkongdjqiiamzbbts",
      FOUNDRY_VERIFIED_USER_ID: "c536ee37-64ab-427b-b7e3-4e2bb4fdffb7",
      BAFU_IDENTITY_PREFLIGHT_RESULT_CACHE: cacheDir,
      FAKE_MODE: mode,
      FAKE_MARKER: fixture.marker,
    };
    const args = [
      "dataset-identity-preflight-run",
      "--index",
      rel(fixture.indexFile),
      ...receiptArgs(fixture),
    ];
    const first = runFoundry([...args, "--out-dir", rel(path.join(fixture.caseRoot, "run"))], {
      env,
    });
    assert.equal(first.code, 0, JSON.stringify(first.json));
    const bindingSha = first.json.results[0].binding_sha256;
    const cacheEntry = path.join(cacheDir, bindingSha);
    if (mode === "positive-reuse") {
      assert.equal(fs.existsSync(cacheEntry), true);
    } else {
      assert.equal(fs.existsSync(cacheEntry), false);
      fs.mkdirSync(cacheDir, { recursive: true });
      fs.cpSync(path.join(fixture.outputDir, "outputs"), cacheEntry, { recursive: true });
    }
    fs.rmSync(fixture.outputDir, { recursive: true, force: true });
    const second = runFoundry([...args, "--out-dir", rel(path.join(fixture.caseRoot, "run-2"))], {
      env,
    });
    assert.equal(second.code, 0, JSON.stringify(second.json));
    if (mode === "positive-reuse") {
      assert.equal(second.json.counts.restored_from_bound_cache, 1);
      assert.equal(fs.readFileSync(fixture.marker, "utf8").trim().split(/\r?\n/u).length, 1);
    } else {
      assert.equal(second.json.counts.restored_from_bound_cache, 0);
      assert.equal(fs.readFileSync(fixture.marker, "utf8").trim().split(/\r?\n/u).length, 2);
    }
  }
});

test("fresh receipt rotation preserves account-bound only-pending reuse", () => {
  const fixture = prepare("rotating-receipt");
  const receiptsFile = path.join(fixture.caseRoot, "rotating-auth-receipts.json");
  const authMarker = path.join(fixture.caseRoot, "auth-executions.txt");
  const now = Date.now();
  writeJson(receiptsFile, [
    testAuthIdentityReceipt({ capturedAtUtc: new Date(now - 2_000).toISOString() }),
    testAuthIdentityReceipt({ capturedAtUtc: new Date(now - 1_000).toISOString() }),
  ]);
  const args = [
    "dataset-identity-preflight-run",
    "--index",
    rel(fixture.indexFile),
    "--expected-project-ref",
    "qgzvkongdjqiiamzbbts",
    "--expected-user-id",
    "c536ee37-64ab-427b-b7e3-4e2bb4fdffb7",
  ];
  const env = {
    TIANGONG_LCA_CLI_BIN: fixture.fakeCli,
    FOUNDRY_VERIFIED_PROJECT_REF: "qgzvkongdjqiiamzbbts",
    FOUNDRY_VERIFIED_USER_ID: "c536ee37-64ab-427b-b7e3-4e2bb4fdffb7",
    FAKE_MODE: "positive-reuse",
    FAKE_MARKER: fixture.marker,
    FAKE_AUTH_RECEIPTS: receiptsFile,
    FAKE_AUTH_MARKER: authMarker,
  };
  const first = runFoundry([...args, "--out-dir", rel(path.join(fixture.caseRoot, "run"))], {
    env,
  });
  assert.equal(first.code, 0, JSON.stringify(first.json));

  const second = runFoundry(
    [...args, "--out-dir", rel(path.join(fixture.caseRoot, "run-2")), "--only-pending"],
    { env },
  );
  assert.equal(second.code, 0, JSON.stringify(second.json));
  assert.equal(second.json.counts.skipped_bound_execution, 1);
  assert.equal(fs.readFileSync(fixture.marker, "utf8").trim().split(/\r?\n/u).length, 1);
  assert.equal(fs.readFileSync(authMarker, "utf8"), "2");
});

test("explicit receipt cannot substitute another receipt-bound account", () => {
  const fixture = prepare("cross-account-substitution");
  const result = spawnSync(
    process.execPath,
    [
      "scripts/foundry.ts",
      "dataset-identity-preflight-run",
      "--index",
      rel(fixture.indexFile),
      "--auth-receipt",
      rel(fixture.authReceiptFile),
      "--expected-project-ref",
      "qgzvkongdjqiiamzbbts",
      "--expected-user-id",
      "c536ee37-64ab-427b-b7e3-4e2bb4fdffb7",
    ],
    {
      cwd: repoRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        TIANGONG_LCA_CLI_BIN: fixture.fakeCli,
        FOUNDRY_VERIFIED_PROJECT_REF: "anotherprojectref",
        FOUNDRY_VERIFIED_USER_ID: "11111111-1111-4111-8111-111111111111",
      },
    },
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /does not match the receipt-bound env/u);
  assert.equal(fs.existsSync(fixture.marker), false);
});

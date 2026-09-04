import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { readCliSupportExport } from "../../scripts/lib/cli-support-export.ts";
import { sha256Text } from "../../scripts/lib/identity-preflight-proof.ts";
import { testAuthIdentityReceipt } from "../fixtures/auth-identity-receipt.ts";

const project = "exampleprojectref";
const user = "11111111-1111-4111-8111-111111111111";
const now = Date.parse("2026-09-04T12:00:00.000Z");
const cli = { command: process.execPath, args: ["/trusted/cli.js"], package_version: "0.1.10" };
const env = {
  FOUNDRY_EXPECTED_PROJECT_REF: project,
  FOUNDRY_EXPECTED_USER_ID: user,
  TIANGONG_LCA_SESSION_FILE: "/private/session.json",
  TIANGONG_LCA_USERNAME: "secret-user",
  TIANGONG_LCA_PASSWORD: "secret-password",
  TIANGONG_LCA_API_KEY: "legacy-secret",
  UNRELATED_SECRET: "other-secret",
};

function materialize(out: string) {
  fs.mkdirSync(out);
  const fp = {
    id: "fp-1",
    version: "00.00.001",
    state_code: 100,
    json: { flowPropertyDataSet: {} },
  };
  const fpText = JSON.stringify(fp) + "\n";
  fs.writeFileSync(path.join(out, "flowproperties.jsonl"), fpText);
  fs.writeFileSync(path.join(out, "unitgroups.jsonl"), "");
  const identity = testAuthIdentityReceipt({
    projectRef: project,
    userId: user,
    capturedAtUtc: new Date(now).toISOString(),
  });
  fs.writeFileSync(path.join(out, "identity-receipt.json"), JSON.stringify(identity));
  const report = {
    schema_version: 1,
    command: "dataset support-cache export",
    status: "completed",
    remote_write_mode: "read-only",
    project_ref: project,
    account: { user_id: user },
    snapshot: { status: "observed-stable", transactional_snapshot: false, observations: 2 },
    filters: { state_codes: [100] },
    completeness: [0, 1].map(() => ({
      status: "complete",
      complete: true,
      entity_counts: { flowproperties: 1, unitgroups: 0 },
    })),
    tables: {
      flowproperties: { rows: 1, sha256: sha256Text(fpText) },
      unitgroups: { rows: 0, sha256: sha256Text("") },
    },
    artifacts: {
      flowproperties: path.join(out, "flowproperties.jsonl"),
      unitgroups: path.join(out, "unitgroups.jsonl"),
      identity: path.join(out, "identity-receipt.json"),
      report: path.join(out, "export-report.json"),
    },
  };
  fs.writeFileSync(report.artifacts.report, JSON.stringify(report));
  return report;
}

test("support bridge delegates to one trusted CLI in an isolated credential-free cwd", () => {
  let cwd = "";
  const result = readCliSupportExport({
    cli,
    env,
    nowMs: now,
    spawnSyncImpl: (command, args, options) => {
      assert.equal(command, process.execPath);
      assert.equal(options.shell, false);
      assert.equal(options.env?.TIANGONG_LCA_AUTH_MODE, "oauth");
      for (const name of [
        "TIANGONG_LCA_USERNAME",
        "TIANGONG_LCA_PASSWORD",
        "TIANGONG_LCA_API_KEY",
        "UNRELATED_SECRET",
      ])
        assert.equal(options.env?.[name], undefined);
      cwd = String(options.cwd);
      assert.equal(fs.existsSync(path.join(cwd, ".env")), false);
      const out = String(args[args.indexOf("--out-dir") + 1]);
      const report = materialize(out);
      return { status: 0, signal: null, stdout: JSON.stringify(report), stderr: "" };
    },
  });
  assert.equal(result.flowproperties.length, 1);
  assert.equal(result.unitgroups.length, 0);
  assert.equal(result.projectRef, project);
  assert.equal(fs.existsSync(cwd), false);
});

test("support bridge rejects wrong scope, foreign paths and corrupt content", () => {
  for (const mode of ["scope", "path", "hash", "identity", "row-state", "completeness"]) {
    let cwd = "";
    assert.throws(() =>
      readCliSupportExport({
        cli,
        env,
        nowMs: now,
        spawnSyncImpl: (_command, args, options) => {
          cwd = String(options.cwd);
          const report = materialize(String(args[args.indexOf("--out-dir") + 1]));
          if (mode === "scope") report.project_ref = "wrong";
          if (mode === "completeness") report.completeness[0].complete = false;
          if (mode === "path") report.artifacts.flowproperties = "/private/never-read";
          if (mode === "hash") fs.appendFileSync(report.artifacts.flowproperties, "corruption");
          if (mode === "identity") fs.writeFileSync(report.artifacts.identity, "{}");
          if (mode === "row-state") {
            const text =
              JSON.stringify({ id: "fp", version: "00.00.001", state_code: 0, json: {} }) + "\n";
            fs.writeFileSync(report.artifacts.flowproperties, text);
            report.tables.flowproperties.sha256 = sha256Text(text);
          }
          fs.writeFileSync(report.artifacts.report, JSON.stringify(report));
          return { status: 0, signal: null, stdout: JSON.stringify(report), stderr: "" };
        },
      }),
    );
    assert.equal(fs.existsSync(cwd), false);
  }
});

test("support bridge requires explicit intent and does not disclose failed child output", () => {
  assert.throws(
    () =>
      readCliSupportExport({
        cli,
        env: {},
        nowMs: now,
        spawnSyncImpl: () => {
          throw new Error("must not dispatch");
        },
      }),
    /intent/u,
  );
  assert.throws(
    () =>
      readCliSupportExport({
        cli,
        env,
        nowMs: now,
        spawnSyncImpl: () => ({
          status: 1,
          signal: null,
          stdout: "secret-password",
          stderr: "secret-password",
        }),
      }),
    { message: "CLI support export failed." },
  );
});

test(
  "support bridge rejects a symlinked export root before reading its artifacts",
  { skip: process.platform === "win32" },
  () => {
    let cwd = "";
    assert.throws(
      () =>
        readCliSupportExport({
          cli,
          env,
          nowMs: now,
          spawnSyncImpl: (_command, args, options) => {
            cwd = String(options.cwd);
            const out = String(args[args.indexOf("--out-dir") + 1]);
            const report = materialize(out);
            const other = path.join(cwd, "other");
            fs.renameSync(out, other);
            fs.symlinkSync(other, out, "dir");
            return { status: 0, signal: null, stdout: JSON.stringify(report), stderr: "" };
          },
        }),
      /directory is unsafe/u,
    );
    assert.equal(fs.existsSync(cwd), false);
  },
);

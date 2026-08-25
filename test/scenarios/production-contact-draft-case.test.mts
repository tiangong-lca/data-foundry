import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

import {
  parseProductionContactDraftCaseArgs,
  runProductionContactDraftCase,
  type ProductionContactDraftSpawn,
} from "../../scripts/cases/production-contact-draft.ts";
import {
  fs,
  path,
  readJson,
  sha256Text,
  testTmpRoot,
  writeJson,
  writeJsonLines,
  writeText,
} from "../fixtures/foundry-core.mjs";

const require = createRequire(import.meta.url);
const cliAuth = require("@tiangong-lca/cli/dist/src/lib/auth-identity-receipt.js") as {
  __testInternals: {
    requestFingerprint(projectRef: string): string;
    responseFingerprint(input: {
      projectRef: string;
      userId: string;
      displayEmail: string;
    }): string;
    sha256Json(value: unknown): string;
  };
};

const PROJECT_REF = "qgzvkongdjqiiamzbbts";
const USER_ID = "c536ee37-64ab-427b-b7e3-4e2bb4fdffb7";
const CONTACT_ID = "11111111-2222-4333-8444-555555555555";
const TEST_KEY = "fixture-production-test-key-never-persist";

function receipt(capturedAtUtc: string) {
  const scope = {
    schema: "tiangong-lca.auth-identity-receipt.v1",
    status: "passed",
    operation: "current-user-read",
    remote_write_mode: "read-only",
    captured_at_utc: capturedAtUtc,
    cli: { package_name: "@tiangong-lca/cli", package_version: "0.1.1" },
    project: {
      project_ref: PROJECT_REF,
      project_base_url: `https://${PROJECT_REF}.supabase.co`,
    },
    identity: { user_id: USER_ID, display_email: "te****@example.com" },
    session: {
      source: "signin",
      cache_mode: "disabled",
      force_reauth: true,
      expires_at_utc: null,
    },
    bindings: {
      request_sha256: cliAuth.__testInternals.requestFingerprint(PROJECT_REF),
      response_sha256: cliAuth.__testInternals.responseFingerprint({
        projectRef: PROJECT_REF,
        userId: USER_ID,
        displayEmail: "te****@example.com",
      }),
    },
    assertions: {
      mode: "intent-bound",
      requested_count: 2,
      expected_project_ref: PROJECT_REF,
      expected_user_id: USER_ID,
      project_ref_passed: true,
      user_id_passed: true,
      passed: true,
    },
  };
  return { ...scope, receipt_scope_sha256: cliAuth.__testInternals.sha256Json(scope) };
}

function option(args: string[], name: string): string {
  const index = args.indexOf(name);
  assert.notEqual(index, -1, `missing ${name}: ${args.join(" ")}`);
  return args[index + 1];
}

function jsonResult(value: unknown) {
  return {
    status: 0,
    signal: null,
    stdout: `${JSON.stringify(value)}\n`,
    stderr: "",
  };
}

function writeReport(report: Record<string, unknown>, reportPath: string) {
  const value = {
    ...report,
    files: { ...((report.files as Record<string, unknown> | undefined) ?? {}), report: reportPath },
  };
  writeJson(reportPath, value);
  return value;
}

test("production contact case parser accepts only one exact intent tuple", () => {
  const parsed = parseProductionContactDraftCaseArgs([
    "--",
    "--env-file",
    "/private/foundry/.env",
    "--expected-project-ref",
    PROJECT_REF,
    "--expected-user-id",
    USER_ID,
    "--out-dir",
    "/private/cases/contact",
  ]);
  assert.deepEqual(parsed, {
    envFile: path.resolve("/private/foundry/.env"),
    expectedProjectRef: PROJECT_REF,
    expectedUserId: USER_ID,
    outDir: path.resolve("/private/cases/contact"),
  });
  for (const argv of [
    [],
    ["--env-file", "/x", "--expected-project-ref", PROJECT_REF],
    [
      "--env-file",
      "/x",
      "--expected-project-ref",
      PROJECT_REF,
      "--expected-user-id",
      USER_ID,
      "--out-dir",
      "/y",
      "--out-dir",
      "/z",
    ],
    ["--api-key", "forbidden"],
    ["--cli-bin", "/untrusted"],
  ]) {
    assert.throws(() => parseProductionContactDraftCaseArgs(argv));
  }
});

test("production contact case executes one bounded owner-draft mutation and unique readback", async () => {
  const root = testTmpRoot("production-contact-case");
  fs.rmSync(root, { recursive: true, force: true });
  fs.mkdirSync(root, { recursive: true });
  const envFile = path.join(root, "foundry.env");
  const outDir = path.join(root, "case-output");
  writeText(
    envFile,
    [
      `TIANGONG_LCA_API_BASE_URL=https://${PROJECT_REF}.supabase.co/functions/v1`,
      "TIANGONG_LCA_SUPABASE_PUBLISHABLE_KEY=fixture-publishable-key",
      `TIANGONG_LCA_TEST_API_KEY=${TEST_KEY}`,
      "UNRELATED_PRIVATE_SECRET=must-never-reach-child",
      "",
    ].join("\n"),
  );
  const spawns: ProductionContactDraftSpawn[] = [];
  let receiptCount = 0;
  let commitDispatches = 0;
  let runtimeCleanups = 0;

  try {
    const manifest = await runProductionContactDraftCase(
      { envFile, expectedProjectRef: PROJECT_REF, expectedUserId: USER_ID, outDir },
      {
        processEnv: { PATH: "/safe/bin", UNRELATED_AMBIENT_SECRET: "forbidden" },
        now: () => new Date("2026-08-25T12:36:00.000Z"),
        randomUUID: () => CONTACT_ID,
        prepareRuntimeSnapshot: () => ({
          entrypoint: "/trusted/private/cli.js",
          cliPackageName: "@tiangong-lca/cli",
          cliPackageVersion: "0.1.1",
          cliEntrypointSha256: "a".repeat(64),
          cliRuntimeSha256: "b".repeat(64),
          runnerSha256: "c".repeat(64),
          pnpmLockSha256: "d".repeat(64),
          cleanup: () => {
            runtimeCleanups += 1;
          },
        }),
        spawnImpl: (command, args, options) => {
          spawns.push({ command, args, options });
          const cliArgs = args.slice(1);
          const input = cliArgs.includes("--input") ? option(cliArgs, "--input") : null;
          const stageOut = cliArgs.includes("--out-dir") ? option(cliArgs, "--out-dir") : null;
          if (cliArgs[0] === "dataset" && cliArgs[1] === "validate") {
            const reportPath = path.join(stageOut as string, "outputs", "validation-report.json");
            return jsonResult(
              writeReport(
                {
                  status: "completed",
                  input_path: input,
                  requested_type: "contact",
                  counts: { total: 1, valid: 1, invalid: 0, by_type: { contact: 1 } },
                  rows: [
                    {
                      index: 0,
                      id: CONTACT_ID,
                      version: "00.00.001",
                      type: "contact",
                      status: "valid",
                    },
                  ],
                },
                reportPath,
              ),
            );
          }
          if (
            cliArgs[0] === "dataset" &&
            cliArgs[1] === "save-draft" &&
            cliArgs.includes("--dry-run")
          ) {
            const reportPath = path.join(
              stageOut as string,
              "outputs",
              "dataset-save-draft",
              "summary.json",
            );
            return jsonResult(
              writeReport(
                {
                  status: "completed",
                  input_path: input,
                  requested_type: "contact",
                  commit: false,
                  mode: "dry_run",
                  counts: { selected: 1, prepared: 1, executed: 0, failed: 0 },
                  rows: [
                    {
                      index: 0,
                      id: CONTACT_ID,
                      version: "00.00.001",
                      type: "contact",
                      table: "contacts",
                      status: "prepared",
                      operation: "would_sync",
                    },
                  ],
                },
                reportPath,
              ),
            );
          }
          if (cliArgs[0] === "auth") {
            receiptCount += 1;
            return jsonResult(
              receipt(receiptCount === 1 ? "2026-08-25T12:35:50.000Z" : "2026-08-25T12:35:55.000Z"),
            );
          }
          if (cliArgs[0] === "flow" && cliArgs[1] === "list") {
            return jsonResult({
              schema_version: 1,
              status: "listed_remote_flows",
              filters: { requested_state_codes: [100], limit: 1 },
              count: 1,
              rows: [
                {
                  id: "public-flow",
                  version: "00.00.001",
                  user_id: null,
                  state_code: 100,
                  flow: {},
                },
              ],
            });
          }
          if (cliArgs[0] === "process" && cliArgs[1] === "list") {
            return jsonResult({
              schema_version: 1,
              status: "listed_remote_processes",
              filters: { requested_user_id: USER_ID, requested_state_codes: [0], limit: 1 },
              count: 0,
              rows: [],
            });
          }
          if (cliArgs[0] === "dataset" && cliArgs[1] === "verify-remote") {
            const postWrite = cliArgs.includes("--compare-root-payload");
            const checksPath = path.join(
              stageOut as string,
              "outputs",
              "remote-verification.jsonl",
            );
            const payload = JSON.parse(fs.readFileSync(input as string, "utf8").trim());
            const payloadSha = cliAuth.__testInternals.sha256Json(payload);
            writeJsonLines(checksPath, [
              {
                row_index: 0,
                role: "root",
                table: "contacts",
                id: CONTACT_ID,
                version: "00.00.001",
                path: "/contactDataSet",
                status: "ok",
                exact_version: postWrite ? "00.00.001" : null,
                latest_version: postWrite ? "00.00.001" : null,
              },
              ...(postWrite
                ? [
                    {
                      row_index: 0,
                      role: "root",
                      table: "contacts",
                      id: CONTACT_ID,
                      version: "00.00.001",
                      path: "/contactDataSet#readback",
                      status: "ok",
                      remote_user_id: USER_ID,
                      remote_state_code: 0,
                      local_payload_sha256: payloadSha,
                      remote_payload_sha256: payloadSha,
                    },
                  ]
                : []),
            ]);
            const reportPath = path.join(
              stageOut as string,
              "outputs",
              "remote-verification-report.json",
            );
            return jsonResult(
              writeReport(
                {
                  status: "passed_remote_verification",
                  root_policy: "candidate",
                  input_path: input,
                  counts: {
                    rows: 1,
                    blockers: 0,
                    root_readback_checks: postWrite ? 1 : 0,
                    root_payload_mismatches: 0,
                  },
                  blockers: [],
                  files: { checks: checksPath },
                },
                reportPath,
              ),
            );
          }
          if (
            cliArgs[0] === "dataset" &&
            cliArgs[1] === "save-draft" &&
            cliArgs.includes("--commit")
          ) {
            commitDispatches += 1;
            const reportPath = path.join(
              stageOut as string,
              "outputs",
              "dataset-save-draft",
              "summary.json",
            );
            return jsonResult(
              writeReport(
                {
                  status: "completed",
                  input_path: input,
                  requested_type: "contact",
                  commit: true,
                  mode: "commit",
                  counts: { selected: 1, prepared: 0, executed: 1, failed: 0 },
                  rows: [
                    {
                      index: 0,
                      id: CONTACT_ID,
                      version: "00.00.001",
                      type: "contact",
                      table: "contacts",
                      status: "executed",
                      operation: "insert",
                    },
                  ],
                },
                reportPath,
              ),
            );
          }
          throw new Error(`Unexpected fake CLI argv: ${cliArgs.join(" ")}`);
        },
      },
    );

    assert.equal(manifest.status, "passed");
    assert.equal(manifest.contact_id, CONTACT_ID);
    assert.equal(manifest.mutation_dispatch_count, 1);
    assert.equal(manifest.unique_root_readback_checks, 1);
    assert.equal(commitDispatches, 1);
    assert.equal(receiptCount, 2);
    assert.equal(runtimeCleanups, 1);
    assert.equal(spawns.length, 9);
    assert.ok(spawns.every((spawn) => !spawn.options.shell));
    assert.ok(spawns.every((spawn) => spawn.options.cwd === path.join(outDir, "clean-cwd")));
    const remoteSpawns = spawns.slice(2);
    assert.ok(remoteSpawns.every((spawn) => spawn.options.env.TIANGONG_LCA_API_KEY === TEST_KEY));
    assert.ok(
      remoteSpawns.every((spawn) => spawn.options.env.UNRELATED_PRIVATE_SECRET === undefined),
    );
    assert.ok(
      remoteSpawns.every((spawn) => spawn.options.env.UNRELATED_AMBIENT_SECRET === undefined),
    );
    const persisted = fs
      .readdirSync(outDir, { recursive: true, encoding: "utf8" })
      .map((entry) => path.join(outDir, entry))
      .filter((entry) => fs.existsSync(entry) && fs.statSync(entry).isFile())
      .map((entry) => fs.readFileSync(entry, "utf8"))
      .join("\n");
    assert.doesNotMatch(persisted, new RegExp(TEST_KEY, "u"));
    const diskManifest = readJson(path.join(outDir, "case-manifest.json"));
    assert.equal(diskManifest.status, "passed");
    assert.match(diskManifest.manifest_scope_sha256, /^[a-f0-9]{64}$/u);
    assert.equal(
      sha256Text(fs.readFileSync(path.join(outDir, "contact.jsonl"), "utf8")),
      diskManifest.contact_artifact.sha256,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

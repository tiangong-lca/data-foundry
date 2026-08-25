import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import os from "node:os";
import test from "node:test";

import {
  parseProductionContactDraftCaseArgs,
  runProductionContactDraftCase,
  type ProductionContactDraftSpawn,
  type RunProductionContactDraftCaseDeps,
} from "../../scripts/cases/production-contact-draft.ts";
import {
  fs,
  path,
  readJson,
  repoRoot,
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

function receipt(capturedAtUtc: string, packageVersion = "0.1.1") {
  const scope = {
    schema: "tiangong-lca.auth-identity-receipt.v1",
    status: "passed",
    operation: "current-user-read",
    remote_write_mode: "read-only",
    captured_at_utc: capturedAtUtc,
    cli: { package_name: "@tiangong-lca/cli", package_version: packageVersion },
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

test("production contact case direct entry is symlink-safe", () => {
  const root = testTmpRoot("production-contact-symlink-entry");
  fs.rmSync(root, { recursive: true, force: true });
  fs.mkdirSync(root, { recursive: true });
  const link = path.join(root, "production-contact-draft.ts");
  fs.symlinkSync(path.join(repoRoot, "scripts", "cases", "production-contact-draft.ts"), link);
  try {
    const child = spawnSync(process.execPath, [link, "--help"], {
      cwd: repoRoot,
      encoding: "utf8",
    });
    assert.equal(child.status, 0, child.stderr);
    assert.match(child.stdout, /case:production:contact-draft/u);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("production contact case requires POSIX-private ignored output before runtime", async () => {
  const root = testTmpRoot("production-contact-boundary");
  fs.rmSync(root, { recursive: true, force: true });
  fs.mkdirSync(root, { recursive: true });
  let prepared = 0;
  const runtime = () => {
    prepared += 1;
    return {
      entrypoint: "/never/started.js",
      cliPackageName: "@tiangong-lca/cli",
      cliPackageVersion: "0.1.1",
      cliEntrypointSha256: "a".repeat(64),
      cliRuntimeSha256: "b".repeat(64),
      runnerSha256: "c".repeat(64),
      pnpmLockSha256: "d".repeat(64),
      pnpmInstallationSha256: "e".repeat(64),
      verifyCurrent: () => {},
      cleanup: () => {},
    };
  };
  await assert.rejects(
    runProductionContactDraftCase(
      {
        envFile: path.join(root, "missing.env"),
        expectedProjectRef: PROJECT_REF,
        expectedUserId: USER_ID,
        outDir: path.join(root, "windows-case"),
      },
      { platform: "win32", prepareRuntimeSnapshot: runtime } as never,
    ),
    /private case storage is unsupported on Windows/u,
  );
  assert.equal(prepared, 0);

  const nonIgnored = path.join(repoRoot, "test", `production-case-unignored-${process.pid}`);
  try {
    await assert.rejects(
      runProductionContactDraftCase(
        {
          envFile: path.join(root, "missing.env"),
          expectedProjectRef: PROJECT_REF,
          expectedUserId: USER_ID,
          outDir: nonIgnored,
        },
        { prepareRuntimeSnapshot: runtime },
      ),
      /git-ignored per-run directory/u,
    );
    assert.equal(prepared, 0);
  } finally {
    fs.rmSync(nonIgnored, { recursive: true, force: true });
  }

  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "foundry-case-outside-"));
  const linkedParent = path.join(root, "linked-parent");
  fs.symlinkSync(outside, linkedParent);
  try {
    await assert.rejects(
      runProductionContactDraftCase(
        {
          envFile: path.join(root, "missing.env"),
          expectedProjectRef: PROJECT_REF,
          expectedUserId: USER_ID,
          outDir: path.join(linkedParent, "case-output"),
        },
        { prepareRuntimeSnapshot: runtime },
      ),
      /must not traverse a symbolic link/u,
    );
    assert.equal(prepared, 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test("production case source contracts bind dependency bytes and durable private evidence", () => {
  const source = fs.readFileSync(
    path.join(repoRoot, "scripts", "cases", "production-contact-draft.ts"),
    "utf8",
  );
  assert.match(source, /pnpmInstallationSha256/u);
  assert.match(source, /verifyCurrent/u);
  assert.match(source, /fsyncSync/u);
  assert.match(source, /Buffer\.compare/u);
});

test("production contact case default pinned runtime completes offline gates before env access", async () => {
  const root = testTmpRoot("production-contact-offline-runtime");
  fs.rmSync(root, { recursive: true, force: true });
  fs.mkdirSync(root, { recursive: true });
  const outDir = path.join(root, "missing-parent", "case-output");
  try {
    await assert.rejects(
      runProductionContactDraftCase(
        {
          envFile: path.join(root, "missing.env"),
          expectedProjectRef: PROJECT_REF,
          expectedUserId: USER_ID,
          outDir,
        },
        {
          now: () => new Date("2026-08-25T12:36:00.000Z"),
          randomUUID: () => CONTACT_ID,
        },
      ),
      /env file is not readable/u,
    );
    const failure = readJson(path.join(outDir, "case-failure.json"));
    assert.equal(failure.stage, "load-production-env");
    assert.equal(failure.error_code, "CASE_ENV_INVALID");
    assert.equal(failure.mutation_dispatch_count, 0);
    assert.ok(
      fs.existsSync(path.join(outDir, "offline-validate", "outputs", "validation-report.json")),
    );
    assert.ok(
      fs.existsSync(
        path.join(
          outDir,
          "offline-save-draft-dry-run",
          "outputs",
          "dataset-save-draft",
          "summary.json",
        ),
      ),
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
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
  let successfulSpawn: RunProductionContactDraftCaseDeps["spawnImpl"];
  let receiptPackageVersion = "0.1.1";
  let authCallsThisRun = 0;
  let mutateAfterWriteReceipt = false;
  let extraPostwriteCheckStatus: string | null = null;
  let failIdentityReceipt = false;
  let injectSecretInPostwrite = false;
  let injectSecretInPostwriteSidecar = false;
  const fakeRuntime = (
    cleanup = () => {
      runtimeCleanups += 1;
    },
  ) => ({
    entrypoint: "/trusted/private/cli.js",
    cliPackageName: "@tiangong-lca/cli",
    cliPackageVersion: "0.1.1",
    cliEntrypointSha256: "a".repeat(64),
    cliRuntimeSha256: "b".repeat(64),
    runnerSha256: "c".repeat(64),
    pnpmLockSha256: "d".repeat(64),
    pnpmInstallationSha256: "e".repeat(64),
    verifyCurrent: () => {},
    cleanup,
  });

  try {
    const manifest = await runProductionContactDraftCase(
      { envFile, expectedProjectRef: PROJECT_REF, expectedUserId: USER_ID, outDir },
      {
        processEnv: { PATH: "/safe/bin", UNRELATED_AMBIENT_SECRET: "forbidden" },
        now: () => new Date("2026-08-25T12:36:00.000Z"),
        randomUUID: () => CONTACT_ID,
        prepareRuntimeSnapshot: fakeRuntime,
        spawnImpl: (successfulSpawn = (command, args, options) => {
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
            authCallsThisRun += 1;
            if (failIdentityReceipt) {
              return {
                status: 1,
                signal: null,
                stdout: "",
                stderr: `${JSON.stringify({ error: { code: "AUTH_FIXTURE_FAILED" } })}\n`,
              };
            }
            const value = receipt(
              authCallsThisRun === 1 ? "2026-08-25T12:35:50.000Z" : "2026-08-25T12:35:55.000Z",
              receiptPackageVersion,
            );
            if (mutateAfterWriteReceipt && authCallsThisRun === 2) {
              const candidatePath = path.join(path.dirname(options.cwd), "contact.jsonl");
              if (process.platform !== "win32") fs.chmodSync(candidatePath, 0o600);
              writeText(
                candidatePath,
                `${JSON.stringify({ contactDataSet: { drifted: true } })}\n`,
              );
            }
            return jsonResult(value);
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
                ...(postWrite && injectSecretInPostwriteSidecar ? { debug_value: TEST_KEY } : {}),
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
              ...(postWrite && extraPostwriteCheckStatus
                ? [
                    {
                      row_index: 0,
                      role: "reference",
                      table: "sources",
                      id: "unexpected-reference",
                      version: "00.00.001",
                      path: "/contactDataSet/reference",
                      status: extraPostwriteCheckStatus,
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
                  ...(postWrite && injectSecretInPostwrite ? { debug_value: TEST_KEY } : {}),
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
        }),
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

    const ambiguousOutDir = path.join(root, "ambiguous-case-output");
    let ambiguousCommitCalls = 0;
    authCallsThisRun = 0;
    await assert.rejects(
      runProductionContactDraftCase(
        {
          envFile,
          expectedProjectRef: PROJECT_REF,
          expectedUserId: USER_ID,
          outDir: ambiguousOutDir,
        },
        {
          processEnv: { PATH: "/safe/bin", UNRELATED_AMBIENT_SECRET: "forbidden" },
          now: () => new Date("2026-08-25T12:36:00.000Z"),
          randomUUID: () => CONTACT_ID,
          prepareRuntimeSnapshot: fakeRuntime,
          spawnImpl: (command, args, options) => {
            const cliArgs = args.slice(1);
            if (
              cliArgs[0] === "dataset" &&
              cliArgs[1] === "save-draft" &&
              cliArgs.includes("--commit")
            ) {
              ambiguousCommitCalls += 1;
              return { status: null, signal: "SIGTERM", stdout: "", stderr: "" };
            }
            return successfulSpawn!(command, args, options);
          },
        },
      ),
      /CLI failed at commit-contact-draft/u,
    );
    assert.equal(ambiguousCommitCalls, 1);
    assert.equal(runtimeCleanups, 2);
    const failure = readJson(path.join(ambiguousOutDir, "case-failure.json"));
    assert.equal(failure.stage, "commit-contact-draft");
    assert.equal(failure.error_code, "CASE_MUTATION_OUTCOME_AMBIGUOUS");
    assert.equal(failure.mutation_dispatch_count, 1);
    assert.equal(failure.automatic_retry_performed, false);
    assert.equal(fs.existsSync(path.join(ambiguousOutDir, "case-manifest.json")), false);

    const driftOutDir = path.join(root, "drifted-candidate-output");
    authCallsThisRun = 0;
    mutateAfterWriteReceipt = true;
    const commitsBeforeDrift = commitDispatches;
    await assert.rejects(
      runProductionContactDraftCase(
        {
          envFile,
          expectedProjectRef: PROJECT_REF,
          expectedUserId: USER_ID,
          outDir: driftOutDir,
        },
        {
          processEnv: { PATH: "/safe/bin" },
          now: () => new Date("2026-08-25T12:36:00.000Z"),
          randomUUID: () => CONTACT_ID,
          prepareRuntimeSnapshot: fakeRuntime,
          spawnImpl: successfulSpawn,
        },
      ),
      /candidate bytes changed before mutation/u,
    );
    mutateAfterWriteReceipt = false;
    assert.equal(commitDispatches, commitsBeforeDrift);
    assert.equal(readJson(path.join(driftOutDir, "case-failure.json")).mutation_dispatch_count, 0);

    const wrongReceiptOutDir = path.join(root, "wrong-receipt-runtime-output");
    authCallsThisRun = 0;
    receiptPackageVersion = "0.1.2";
    await assert.rejects(
      runProductionContactDraftCase(
        {
          envFile,
          expectedProjectRef: PROJECT_REF,
          expectedUserId: USER_ID,
          outDir: wrongReceiptOutDir,
        },
        {
          processEnv: { PATH: "/safe/bin" },
          now: () => new Date("2026-08-25T12:36:00.000Z"),
          randomUUID: () => CONTACT_ID,
          prepareRuntimeSnapshot: fakeRuntime,
          spawnImpl: successfulSpawn,
        },
      ),
      /receipt CLI does not match the pinned runtime/u,
    );
    receiptPackageVersion = "0.1.1";
    assert.equal(
      readJson(path.join(wrongReceiptOutDir, "case-failure.json")).mutation_dispatch_count,
      0,
    );

    const extraCheckOutDir = path.join(root, "extra-non-ok-check-output");
    authCallsThisRun = 0;
    extraPostwriteCheckStatus = "missing_dataset";
    await assert.rejects(
      runProductionContactDraftCase(
        {
          envFile,
          expectedProjectRef: PROJECT_REF,
          expectedUserId: USER_ID,
          outDir: extraCheckOutDir,
        },
        {
          processEnv: { PATH: "/safe/bin" },
          now: () => new Date("2026-08-25T12:36:00.000Z"),
          randomUUID: () => CONTACT_ID,
          prepareRuntimeSnapshot: fakeRuntime,
          spawnImpl: successfulSpawn,
        },
      ),
      /non-ok verification check/u,
    );
    extraPostwriteCheckStatus = null;

    const secretArtifactOutDir = path.join(root, "secret-artifact-output");
    authCallsThisRun = 0;
    injectSecretInPostwrite = true;
    await assert.rejects(
      runProductionContactDraftCase(
        {
          envFile,
          expectedProjectRef: PROJECT_REF,
          expectedUserId: USER_ID,
          outDir: secretArtifactOutDir,
        },
        {
          processEnv: { PATH: "/safe/bin" },
          now: () => new Date("2026-08-25T12:36:00.000Z"),
          randomUUID: () => CONTACT_ID,
          prepareRuntimeSnapshot: fakeRuntime,
          spawnImpl: successfulSpawn,
        },
      ),
      /Secret material was detected/u,
    );
    injectSecretInPostwrite = false;
    const secretArtifactText = fs
      .readdirSync(secretArtifactOutDir, { recursive: true, encoding: "utf8" })
      .map((entry) => path.join(secretArtifactOutDir, entry))
      .filter((entry) => fs.existsSync(entry) && fs.statSync(entry).isFile())
      .map((entry) => fs.readFileSync(entry, "utf8"))
      .join("\n");
    assert.doesNotMatch(secretArtifactText, new RegExp(TEST_KEY, "u"));
    assert.equal(fs.existsSync(path.join(secretArtifactOutDir, "case-manifest.json")), false);

    const secretSidecarOutDir = path.join(root, "secret-sidecar-output");
    authCallsThisRun = 0;
    injectSecretInPostwriteSidecar = true;
    await assert.rejects(
      runProductionContactDraftCase(
        {
          envFile,
          expectedProjectRef: PROJECT_REF,
          expectedUserId: USER_ID,
          outDir: secretSidecarOutDir,
        },
        {
          processEnv: { PATH: "/safe/bin" },
          now: () => new Date("2026-08-25T12:36:00.000Z"),
          randomUUID: () => CONTACT_ID,
          prepareRuntimeSnapshot: fakeRuntime,
          spawnImpl: successfulSpawn,
        },
      ),
      /Secret material was detected/u,
    );
    injectSecretInPostwriteSidecar = false;
    assert.equal(fs.existsSync(path.join(secretSidecarOutDir, "case-manifest.json")), false);

    const cleanupFailureOutDir = path.join(root, "cleanup-failure-output");
    authCallsThisRun = 0;
    failIdentityReceipt = true;
    await assert.rejects(
      runProductionContactDraftCase(
        {
          envFile,
          expectedProjectRef: PROJECT_REF,
          expectedUserId: USER_ID,
          outDir: cleanupFailureOutDir,
        },
        {
          processEnv: { PATH: "/safe/bin" },
          now: () => new Date("2026-08-25T12:36:00.000Z"),
          randomUUID: () => CONTACT_ID,
          prepareRuntimeSnapshot: () =>
            fakeRuntime(() => {
              throw new Error("fixture cleanup failure");
            }),
          spawnImpl: successfulSpawn,
        },
      ),
      /CLI failed at identity-before-reads/u,
    );
    failIdentityReceipt = false;
    const cleanupFailure = readJson(path.join(cleanupFailureOutDir, "case-failure.json"));
    assert.equal(cleanupFailure.error_code, "AUTH_FIXTURE_FAILED");
    assert.equal(cleanupFailure.runtime_cleanup_error_code, "CASE_RUNTIME_CLEANUP_FAILED");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

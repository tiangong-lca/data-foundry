import assert from "node:assert/strict";
import { spawnSync, type SpawnSyncOptions } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  runWithLcaAccount,
  type WithLcaAccountDependencies,
} from "../../scripts/with-lca-account.ts";

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

const PROJECT_REF = "exampleprojectref";
const USER_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const API_KEY = "fake-test-api-key-never-print";
const NOW_MS = Date.parse("2026-08-25T02:00:00.000Z");
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

type SpawnCall = {
  executable: string;
  argv: string[];
  options: SpawnSyncOptions;
};

function receipt(overrides: Record<string, unknown> = {}) {
  const scope = {
    schema: "tiangong-lca.auth-identity-receipt.v1",
    status: "passed",
    operation: "current-user-read",
    remote_write_mode: "read-only",
    captured_at_utc: "2026-08-25T01:59:45.000Z",
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
    ...overrides,
  };
  return {
    ...scope,
    receipt_scope_sha256: cliAuth.__testInternals.sha256Json(scope),
  };
}

function writeProfile(
  root: string,
  values: Partial<Record<string, string>> = {},
): { profileDir: string; profilePath: string } {
  const profileDir = path.join(root, "profiles");
  const profilePath = path.join(profileDir, "production-test.env");
  fs.mkdirSync(profileDir, { recursive: true });
  const profile = {
    TIANGONG_LCA_API_BASE_URL: `https://${PROJECT_REF}.functions.supabase.co/functions/v1`,
    TIANGONG_LCA_API_KEY: API_KEY,
    TIANGONG_LCA_SUPABASE_PUBLISHABLE_KEY: "publishable-key",
    TIANGONG_LCA_REGION: "global",
    FOUNDRY_ACCOUNT_LABEL: "production-test",
    FOUNDRY_EXPECTED_PROJECT_REF: PROJECT_REF,
    FOUNDRY_EXPECTED_USER_ID: USER_ID,
    ...values,
  };
  fs.writeFileSync(
    profilePath,
    `${Object.entries(profile)
      .filter(([, value]) => value !== "")
      .map(([key, value]) => `${key}=${value}`)
      .join("\n")}\n`,
  );
  return { profileDir, profilePath };
}

function baseDeps(
  root: string,
  profileDir: string,
  calls: SpawnCall[],
  receiptValue = receipt(),
): WithLcaAccountDependencies {
  return {
    repoRoot: root,
    cwd: path.join(root, "work"),
    nowMs: () => NOW_MS,
    processEnv: {
      PATH: "/safe/bin",
      HOME: "/must/not/reach/child",
      UNRELATED_SECRET: "parent-secret-canary",
      FOUNDRY_ACCOUNT_PROFILES_DIR: profileDir,
      FOUNDRY_ACCOUNT_PROFILE_SKIP_AUTH_CHECK: "true",
    },
    resolveInstalledCli: () => ({
      packageName: "@tiangong-lca/cli",
      packageVersion: "0.1.1",
      binPath: path.join(root, "trusted", "tiangong-lca.js"),
    }),
    spawnSyncImpl: (executable: string, argv: readonly string[], options: SpawnCall["options"]) => {
      calls.push({ executable, argv: [...argv], options });
      if (calls.length === 1) {
        return {
          status: 0,
          signal: null,
          stdout: `${JSON.stringify(receiptValue)}\n`,
          stderr: "",
        };
      }
      return { status: 0, signal: null, stdout: "", stderr: "" };
    },
  };
}

test("account wrapper obtains a fresh intent-bound CLI receipt before exact argv execution", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "foundry-account-wrapper-"));
  const { profileDir } = writeProfile(root);
  fs.mkdirSync(path.join(root, "work"));
  const calls: SpawnCall[] = [];
  try {
    const exitCode = runWithLcaAccount(
      ["--", "production-test", "--", process.execPath, "trusted-command.mjs", "--help"],
      baseDeps(root, profileDir, calls),
    );

    assert.equal(exitCode, 0);
    assert.equal(calls.length, 2);
    assert.equal(calls[0].executable, process.execPath);
    assert.deepEqual(calls[0].argv, [
      path.join(root, "trusted", "tiangong-lca.js"),
      "auth",
      "identity-receipt",
      "--expected-project-ref",
      PROJECT_REF,
      "--expected-user-id",
      USER_ID,
      "--timeout-ms",
      "10000",
      "--json",
    ]);
    assert.equal(calls[0].options.shell, false);
    assert.equal(calls[0].options.env?.TIANGONG_LCA_API_KEY, API_KEY);
    assert.equal(calls[0].options.env?.TIANGONG_LCA_DISABLE_SESSION_CACHE, "true");
    assert.equal(calls[0].options.env?.TIANGONG_LCA_FORCE_REAUTH, "true");
    assert.equal(calls[0].options.env?.UNRELATED_SECRET, undefined);
    assert.equal(calls[0].options.env?.HOME, undefined);
    assert.equal(calls[0].options.env?.FOUNDRY_ACCOUNT_PROFILE_SKIP_AUTH_CHECK, undefined);

    assert.equal(calls[1].executable, process.execPath);
    assert.deepEqual(calls[1].argv, ["trusted-command.mjs", "--help"]);
    assert.equal(calls[1].options.shell, false);
    assert.equal(calls[1].options.stdio, "inherit");
    assert.equal(calls[1].options.env?.UNRELATED_SECRET, undefined);
    assert.equal(calls[1].options.env?.FOUNDRY_AUTH_RECEIPT_PROJECT_REF, PROJECT_REF);
    assert.equal(calls[1].options.env?.FOUNDRY_AUTH_RECEIPT_USER_ID, USER_ID);
    assert.equal(calls[1].options.env?.FOUNDRY_VERIFIED_PROJECT_REF, PROJECT_REF);
    assert.equal(calls[1].options.env?.FOUNDRY_VERIFIED_USER_ID, USER_ID);
    assert.equal(calls[1].options.env?.FOUNDRY_ACCOUNT_MODE, "ordinary");
    assert.equal(
      calls[1].options.env?.FOUNDRY_AUTH_RECEIPT_SCOPE_SHA256,
      receipt().receipt_scope_sha256,
    );
    assert.doesNotMatch(JSON.stringify({ exitCode }), new RegExp(API_KEY, "u"));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("account wrapper maps requested child cancellation signals to stable shell exit codes", () => {
  for (const [signal, expectedExitCode] of [
    ["SIGINT", 130],
    ["SIGTERM", 143],
  ] as const) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), `foundry-account-${signal}-`));
    const { profileDir } = writeProfile(root);
    fs.mkdirSync(path.join(root, "work"));
    const calls: SpawnCall[] = [];
    const deps = baseDeps(root, profileDir, calls);
    deps.spawnSyncImpl = (executable, argv, options) => {
      calls.push({ executable, argv: [...argv], options });
      if (calls.length === 1) {
        return {
          status: 0,
          signal: null,
          stdout: `${JSON.stringify(receipt())}\n`,
          stderr: "",
        };
      }
      return { status: null, signal, stdout: "", stderr: "" };
    };
    try {
      assert.equal(
        runWithLcaAccount(["production-test", "--", process.execPath, "trusted-command.mjs"], deps),
        expectedExitCode,
      );
      assert.equal(calls.length, 2);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
});

test("account wrapper package and surface metadata point only at the typed entrypoint", () => {
  const packageJson = JSON.parse(
    fs.readFileSync(path.join(repositoryRoot, "package.json"), "utf8"),
  );
  const surfaceAudit = fs.readFileSync(
    path.join(repositoryRoot, "scripts", "lib", "surface-audit.ts"),
    "utf8",
  );
  const wrapperSource = fs.readFileSync(
    path.join(repositoryRoot, "scripts", "with-lca-account.ts"),
    "utf8",
  );
  assert.equal(packageJson.scripts?.["account:run"], "node scripts/with-lca-account.ts");
  assert.match(surfaceAudit, /scripts\/with-lca-account\.ts/u);
  assert.doesNotMatch(surfaceAudit, /scripts\/with-lca-account\.mjs/u);
  assert.equal(fs.existsSync(path.join(repositoryRoot, "scripts", "with-lca-account.mjs")), false);
  assert.doesNotMatch(wrapperSource, /\bfetch\s*\(/u);
  assert.doesNotMatch(wrapperSource, /base64/iu);
  assert.doesNotMatch(wrapperSource, /shell:\s*true/u);
  assert.doesNotMatch(wrapperSource, /--no-auth-check/u);
});

test("account wrapper executes when invoked through a symlinked entrypoint", (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "foundry-account-symlink-"));
  const wrapperPath = path.join(repositoryRoot, "scripts", "with-lca-account.ts");
  const symlinkPath = path.join(root, "with-lca-account.ts");
  try {
    try {
      fs.symlinkSync(wrapperPath, symlinkPath, "file");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EPERM") {
        context.skip("The current platform does not permit file symlinks.");
        return;
      }
      throw error;
    }
    const result = spawnSync(process.execPath, [symlinkPath, "--help"], {
      cwd: root,
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /fresh, intent-bound CLI 0\.1\.1 identity receipt/u);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("account wrapper rejects legacy bypass and missing project or user intent before spawning", () => {
  for (const [label, profileOverrides, argv] of [
    [
      "legacy-bypass",
      {},
      ["production-test", "--no-auth-check", "--", process.execPath, "command.mjs"],
    ],
    ["missing-project", { FOUNDRY_EXPECTED_PROJECT_REF: "" }, null],
    ["missing-user", { FOUNDRY_EXPECTED_USER_ID: "" }, null],
  ] as const) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), `foundry-account-${label}-`));
    const { profileDir } = writeProfile(root, profileOverrides);
    fs.mkdirSync(path.join(root, "work"));
    const calls: SpawnCall[] = [];
    try {
      assert.throws(
        () =>
          runWithLcaAccount(
            argv ?? ["production-test", "--", process.execPath, "command.mjs"],
            baseDeps(root, profileDir, calls),
          ),
        /(?:does not accept wrapper flags|FOUNDRY_EXPECTED_PROJECT_REF|FOUNDRY_EXPECTED_USER_ID)/u,
      );
      assert.equal(calls.length, 0);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
});

test("account wrapper rejects stale, partial, noisy, or failed identity receipts without leaking output", () => {
  const cases = [
    receipt({ captured_at_utc: "2026-08-25T01:00:00.000Z" }),
    receipt({
      assertions: {
        mode: "partial",
        requested_count: 1,
        expected_project_ref: PROJECT_REF,
        expected_user_id: null,
        project_ref_passed: true,
        user_id_passed: null,
        passed: true,
      },
    }),
  ];
  for (const [index, receiptValue] of cases.entries()) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), `foundry-account-receipt-${index}-`));
    const { profileDir } = writeProfile(root);
    fs.mkdirSync(path.join(root, "work"));
    const calls: SpawnCall[] = [];
    try {
      let thrown: unknown;
      try {
        runWithLcaAccount(
          ["production-test", "--", process.execPath, "command.mjs"],
          baseDeps(root, profileDir, calls, receiptValue),
        );
      } catch (error) {
        thrown = error;
      }
      assert.ok(thrown instanceof Error);
      assert.match(thrown.message, /fresh intent-bound identity receipt/u);
      assert.doesNotMatch(thrown.message, new RegExp(API_KEY, "u"));
      assert.equal(calls.length, 1);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }

  const root = fs.mkdtempSync(path.join(os.tmpdir(), "foundry-account-failed-cli-"));
  const { profileDir } = writeProfile(root);
  fs.mkdirSync(path.join(root, "work"));
  const calls: SpawnCall[] = [];
  const deps = baseDeps(root, profileDir, calls);
  deps.spawnSyncImpl = (executable, argv, options) => {
    calls.push({ executable, argv: [...argv], options });
    return {
      status: 1,
      signal: null,
      stdout: `sensitive stdout ${API_KEY}`,
      stderr: `sensitive stderr ${API_KEY}`,
    };
  };
  try {
    let thrown: unknown;
    try {
      runWithLcaAccount(["production-test", "--", process.execPath, "command.mjs"], deps);
    } catch (error) {
      thrown = error;
    }
    assert.ok(thrown instanceof Error);
    assert.match(thrown.message, /identity-receipt command failed/u);
    assert.doesNotMatch(thrown.message, new RegExp(API_KEY, "u"));
    assert.equal(calls.length, 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("Codex thread account guards require the same profile, project, and user", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "foundry-account-thread-guard-"));
  const { profileDir } = writeProfile(root);
  fs.mkdirSync(path.join(root, "work"));
  const calls: SpawnCall[] = [];
  const deps = baseDeps(root, profileDir, calls);
  (deps.processEnv as NodeJS.ProcessEnv).CODEX_THREAD_ID = "thread-1";
  try {
    assert.throws(
      () => runWithLcaAccount(["production-test", "--", process.execPath, "command.mjs"], deps),
      /Thread account guard is required/u,
    );
    assert.equal(calls.length, 0);

    const guardDir = path.join(root, ".foundry", "state", "thread-account-guards");
    fs.mkdirSync(guardDir, { recursive: true });
    fs.writeFileSync(
      path.join(guardDir, "thread-1.json"),
      `${JSON.stringify({
        schema_version: 2,
        codex_thread_id: "thread-1",
        profile: "production-test",
        expected_project_ref: "wrong-project",
        expected_user_id: USER_ID,
      })}\n`,
    );
    assert.throws(
      () => runWithLcaAccount(["production-test", "--", process.execPath, "command.mjs"], deps),
      /expected project/u,
    );
    assert.equal(calls.length, 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

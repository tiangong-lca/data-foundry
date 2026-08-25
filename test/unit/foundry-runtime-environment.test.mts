import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  copyFoundryIsolatedExecutable,
  createFoundryIsolatedChildEnvironment,
} from "../../scripts/lib/foundry-runtime-environment.ts";

function withTempRoot(body: (root: string) => void): void {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "foundry-runtime-environment-"));
  try {
    body(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test("isolated child environment carries only safe platform keys and controlled paths", () => {
  withTempRoot((root) => {
    const cliPath = path.join(root, "stub-cli.mjs");
    const tidasPath = path.join(root, "fake-tidas.ts");
    const environment = createFoundryIsolatedChildEnvironment({
      sourceEnv: {
        PATH: "/controlled/bin",
        Path: "C:\\controlled\\bin",
        SystemRoot: "C:\\Windows",
        WINDIR: "C:\\Windows",
        ComSpec: "C:\\Windows\\System32\\cmd.exe",
        PATHEXT: ".COM;.EXE;.BAT;.CMD",
        HOME: "/ambient/home",
        TMPDIR: "/ambient/tmp",
        SHELL: "/ambient/shell",
        NODE_OPTIONS: "--require=/ambient/inject.cjs",
        GH_TOKEN: "ambient-github-token",
        AWS_SECRET_ACCESS_KEY: "ambient-aws-secret",
        TIANGONG_LCA_TEST_API_KEY: "ambient-lca-key",
      },
      tempRoot: root,
      overrides: {
        TIANGONG_LCA_CLI_BIN: cliPath,
        TIDAS_BIN: tidasPath,
      },
    });

    assert.deepEqual(
      Object.keys(environment).sort(),
      [
        "APPDATA",
        "CI",
        "COREPACK_HOME",
        "FOUNDRY_RUNTIME_ENV_FILE_POLICY",
        "GIT_CONFIG_GLOBAL",
        "GIT_CONFIG_NOSYSTEM",
        "GIT_TERMINAL_PROMPT",
        "HOME",
        "HUSKY",
        "LANG",
        "LC_ALL",
        "LOCALAPPDATA",
        "NO_COLOR",
        "NPM_CONFIG_AUDIT",
        "NPM_CONFIG_CACHE",
        "NPM_CONFIG_FUND",
        "NPM_CONFIG_UPDATE_NOTIFIER",
        "NPM_CONFIG_USERCONFIG",
        "PATH",
        "PATHEXT",
        "Path",
        "TEMP",
        "TIANGONG_LCA_CLI_BIN",
        "TIDAS_BIN",
        "TMP",
        "TMPDIR",
        "TZ",
        "USERPROFILE",
        "XDG_CACHE_HOME",
        "XDG_CONFIG_HOME",
        "XDG_DATA_HOME",
        "XDG_STATE_HOME",
        "ComSpec",
        "SystemRoot",
        "WINDIR",
      ].sort(),
    );
    assert.equal(environment.PATH, "/controlled/bin");
    assert.equal(environment.Path, "C:\\controlled\\bin");
    assert.equal(environment.SystemRoot, "C:\\Windows");
    assert.equal(environment.WINDIR, "C:\\Windows");
    assert.equal(environment.ComSpec, "C:\\Windows\\System32\\cmd.exe");
    assert.equal(environment.PATHEXT, ".COM;.EXE;.BAT;.CMD");
    assert.equal(environment.HOME, path.join(root, "home"));
    assert.equal(environment.USERPROFILE, path.join(root, "home"));
    assert.equal(environment.TMPDIR, path.join(root, "tmp"));
    assert.equal(environment.TEMP, path.join(root, "tmp"));
    assert.equal(environment.TMP, path.join(root, "tmp"));
    assert.equal(environment.APPDATA, path.join(root, "data", "appdata"));
    assert.equal(environment.LOCALAPPDATA, path.join(root, "data", "local-appdata"));
    assert.equal(environment.XDG_CONFIG_HOME, path.join(root, "config"));
    assert.equal(environment.XDG_CACHE_HOME, path.join(root, "cache"));
    assert.equal(environment.XDG_DATA_HOME, path.join(root, "data"));
    assert.equal(environment.XDG_STATE_HOME, path.join(root, "state"));
    assert.equal(environment.COREPACK_HOME, path.join(root, "corepack"));
    assert.equal(environment.NPM_CONFIG_USERCONFIG, path.join(root, "config", "npmrc"));
    assert.equal(environment.GIT_CONFIG_GLOBAL, path.join(root, "config", "gitconfig"));
    assert.equal(environment.FOUNDRY_RUNTIME_ENV_FILE_POLICY, "disabled");
    assert.equal(environment.TIANGONG_LCA_CLI_BIN, cliPath);
    assert.equal(environment.TIDAS_BIN, tidasPath);
    for (const key of [
      "SHELL",
      "NODE_OPTIONS",
      "GH_TOKEN",
      "AWS_SECRET_ACCESS_KEY",
      "TIANGONG_LCA_TEST_API_KEY",
    ]) {
      assert.equal(environment[key], undefined, key);
    }
  });
});

test("isolated child environment rejects credential and configuration overrides", () => {
  withTempRoot((root) => {
    for (const key of [
      "GH_TOKEN",
      "npm_token",
      "AWS_ACCESS_KEY_ID",
      "AWS_SECRET_ACCESS_KEY",
      "SUPABASE_ANON_KEY",
      "SERVICE_ROLE_KEY",
      "PGPASSWORD",
      "AUTHORIZATION",
      "DATABASE_URL",
      "NODE_TLS_REJECT_UNAUTHORIZED",
      "TIANGONG_LCA_TEST_API_KEY",
      "DATABASE_PASSWORD",
      "SIGNING_PRIVATE_KEY",
      "GOOGLE_APPLICATION_CREDENTIALS",
      "SSH_AUTH_SOCK",
      "NODE_OPTIONS",
      "HOME",
      "NPM_CONFIG_USERCONFIG",
      "SAFE_BUT_UNDECLARED",
    ]) {
      assert.throws(
        () =>
          createFoundryIsolatedChildEnvironment({
            sourceEnv: { PATH: "/controlled/bin" },
            tempRoot: root,
            overrides: { [key]: "must-not-pass" },
          }),
        new RegExp(`non-allowlisted environment override.*${key}`, "iu"),
        key,
      );
    }
  });
});

test("isolated executable copies retain exact bytes and POSIX execution mode", () => {
  withTempRoot((root) => {
    const sourcePath = path.join(root, "source.mjs");
    const targetPath = path.join(root, "isolated", "fake-tidas.mjs");
    const source = "#!/usr/bin/env node\nprocess.stdout.write('isolated-ok');\n";
    fs.writeFileSync(sourcePath, source);
    fs.chmodSync(sourcePath, 0o751);

    copyFoundryIsolatedExecutable(sourcePath, targetPath);
    assert.equal(fs.readFileSync(targetPath, "utf8"), source);
    if (process.platform !== "win32") {
      assert.equal(fs.statSync(targetPath).mode & 0o777, 0o751);
      const direct = spawnSync(targetPath, [], { encoding: "utf8" });
      assert.equal(direct.status, 0, direct.error?.message || direct.stderr);
      assert.equal(direct.stdout, "isolated-ok");
    }
  });
});

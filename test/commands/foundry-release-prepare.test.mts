import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

const source = path.resolve(import.meta.dirname, "../..");

test("OIDC diagnostic refuses ordinary processes and caller arguments without disclosing inputs", () => {
  for (const args of [[], ["--publish", "private-input"]]) {
    const result = spawnSync(
      process.execPath,
      [path.join(source, "scripts/release-diagnose-npm-oidc.ts"), ...args],
      {
        cwd: os.tmpdir(),
        encoding: "utf8",
        timeout: 30_000,
        env: {
          GITHUB_JOB: "ordinary",
          GITHUB_EVENT_PATH: "private-event",
          ACTIONS_ID_TOKEN_REQUEST_TOKEN: "private-token",
        },
      },
    );
    assert.equal(result.status, 1);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /diagnostic could not complete; no publication attempted/u);
    assert.match(result.stderr, /"failure_stage":"admission"/u);
    assert.doesNotMatch(result.stderr, /private/u);
  }
});

test("the diagnostic command returns failing exits for rejected exchanges and never prints credentials", () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "foundry-oidc-diagnostic-"));
  const root = path.join(temporary, "source");
  const env = { ...process.env };
  for (const key of Object.keys(env))
    if (key.startsWith("GIT_") || key === "NODE_OPTIONS") delete env[key];
  try {
    fs.mkdirSync(root);
    fs.cpSync(path.join(source, "scripts"), path.join(root, "scripts"), { recursive: true });
    fs.copyFileSync(path.join(source, "package.json"), path.join(root, "package.json"));
    fs.writeFileSync(path.join(root, ".gitignore"), "node_modules/\n");
    fs.symlinkSync(
      path.join(source, "node_modules"),
      path.join(root, "node_modules"),
      process.platform === "win32" ? "junction" : "dir",
    );
    const git = (args: string[]) => {
      const result = spawnSync("git", ["-C", root, ...args], { encoding: "utf8", env });
      assert.equal(result.status, 0, result.stderr);
      return result.stdout.trim();
    };
    git(["init", "--initial-branch=main"]);
    git(["config", "core.hooksPath", path.join(temporary, "empty-hooks")]);
    git(["add", "."]);
    git([
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.invalid",
      "commit",
      "-m",
      "Diagnostic fixture",
    ]);
    const head = git(["rev-parse", "HEAD"]);
    const event = path.join(temporary, "event.json");
    fs.writeFileSync(event, JSON.stringify({ inputs: { diagnose_npm_oidc: true } }));
    const preload = path.join(temporary, "fetch.mjs");
    for (const variant of ["accepted", "rejected", "http-error"]) {
      fs.writeFileSync(
        preload,
        `
        let calls = 0;
        globalThis.fetch = async () => {
          if (++calls === 1) return Response.json({value: "private.fixture.jwt"});
          if (calls !== 2) throw new Error("Unexpected network request");
          if (${JSON.stringify(variant)} === "http-error") return new Response("private-response", {status: 404});
          return Response.json({token_type: "oidc", token: "private-credential", created: Date.now(), expires: ${JSON.stringify(variant)} === "rejected" ? "private-expiration" : Date.now() + 3600000}, {status: 201});
        };
      `,
      );
      const result = spawnSync(
        process.execPath,
        [
          "--import",
          pathToFileURL(preload).href,
          path.join(root, "scripts/release-diagnose-npm-oidc.ts"),
        ],
        {
          cwd: temporary,
          encoding: "utf8",
          timeout: 30_000,
          env: {
            ...env,
            GITHUB_ACTIONS: "true",
            GITHUB_JOB: "diagnose-npm-oidc",
            GITHUB_EVENT_NAME: "workflow_dispatch",
            RUNNER_ENVIRONMENT: "github-hosted",
            GITHUB_REPOSITORY: "tiangong-lca/foundry",
            GITHUB_REF: "refs/heads/main",
            GITHUB_SHA: head,
            GITHUB_WORKFLOW_SHA: head,
            GITHUB_WORKFLOW_REF:
              "tiangong-lca/foundry/.github/workflows/publish-foundry.yml@refs/heads/main",
            GITHUB_RUN_ID: "12345",
            GITHUB_RUN_ATTEMPT: "1",
            GITHUB_EVENT_PATH: event,
            ACTIONS_ID_TOKEN_REQUEST_URL: "https://fixture.actions.githubusercontent.com/token",
            ACTIONS_ID_TOKEN_REQUEST_TOKEN: "private-request-token",
            SIGSTORE_ID_TOKEN: "",
          },
        },
      );
      assert.equal(result.status, variant === "accepted" ? 0 : 1, result.stderr);
      const report = JSON.parse(result.stdout);
      assert.equal(report.accepted, variant === "accepted");
      assert.equal(report.source, head);
      assert.equal(report.diagnostic_only, true);
      assert.equal(report.publication_attempted, false);
      if (variant === "http-error") {
        assert.equal(report.failure_stage, "npm-exchange");
        assert.equal(report.http_status, 404);
      }
      assert.doesNotMatch(result.stdout + result.stderr, /private|Bearer|https:/u);
    }
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});

test("package preparation rejects other jobs and caller arguments before inspecting source", () => {
  for (const script of ["release-prepare-package.ts", "release-publish-package.ts"])
    for (const [job, args] of [
      ["release-qualification", []],
      ["npm-package", ["--version", "0.1.1"]],
    ] as const) {
      const result = spawnSync(process.execPath, [path.join(source, "scripts", script), ...args], {
        cwd: os.tmpdir(),
        encoding: "utf8",
        timeout: 30_000,
        env: { ...process.env, GITHUB_JOB: job, GITHUB_EVENT_PATH: "missing-event.json" },
      });
      assert.equal(result.status, 1, result.stderr);
      assert.match(result.stderr, /owning npm-package workflow job/u);
      assert.equal(result.stdout, "");
    }
});

test("download verification has a read-only command with explicit source and version", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "foundry-prepared-cli-"));
  try {
    const run = (args: string[]) =>
      spawnSync(
        process.execPath,
        [path.join(source, "scripts/release-verify-prepared.ts"), ...args],
        { cwd: root, encoding: "utf8", timeout: 30_000 },
      );
    const help = run(["--help"]);
    assert.equal(help.status, 0, help.stderr);
    assert.match(help.stdout, /--expected-git-head/u);
    for (const args of [[], ["--directory", root], ["--package", "cli"], ["--publish", "true"]]) {
      const result = run(args);
      assert.equal(result.status, 1, result.stderr);
      assert.match(result.stderr, /Usage:/u);
    }
    const invalid = run(["--directory", root, "--version", "0.1.1", "--expected-git-head", "main"]);
    assert.equal(invalid.status, 1, invalid.stderr);
    assert.match(invalid.stderr, /exact source/u);
    assert.deepEqual(fs.readdirSync(root), []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

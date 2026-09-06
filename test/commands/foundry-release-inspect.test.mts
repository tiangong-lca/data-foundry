import assert from "node:assert/strict";
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  applyFoundryReleaseVersion,
  planFoundryReleaseVersion,
} from "../../scripts/lib/foundry-release-version.ts";

const source = path.resolve(import.meta.dirname, "../..");

function fixture(): {
  root: string;
  initial: string;
  version: string;
  git: (...args: string[]) => string;
  inspect: (
    base: string,
    head: string,
    options?: { env?: NodeJS.ProcessEnv; flags?: string[] },
  ) => SpawnSyncReturns<string>;
} {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "foundry-release-inspect-"));
  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: path.join(root, "empty-git-config"),
  };
  for (const key of Object.keys(environment))
    if (key.startsWith("GIT_") && !["GIT_CONFIG_NOSYSTEM", "GIT_CONFIG_GLOBAL"].includes(key))
      delete environment[key];
  const git = (...args: string[]): string => {
    const result = spawnSync("git", args, {
      cwd: root,
      env: environment,
      encoding: "utf8",
      timeout: 30_000,
    });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  for (const file of [
    "package.json",
    "scripts/lib/foundry-package-contract.ts",
    "specs/schemas/foundry-package-descriptor.schema.json",
    "scripts/lib/foundry-release-version.ts",
    "scripts/lib/foundry-release-contract.ts",
    "scripts/release-inspect.ts",
  ]) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.copyFileSync(path.join(source, file), path.join(root, file));
  }
  git("init", "--initial-branch=main");
  git("config", "user.name", "Release fixture");
  git("config", "user.email", "release-fixture@example.invalid");
  git("config", "commit.gpgsign", "false");
  git("config", "core.hooksPath", path.join(root, "no-hooks"));
  git("config", "core.autocrlf", "false");
  git("add", ".");
  git("commit", "-m", "Initial release fixture");
  const initial = git("rev-parse", "HEAD");
  const current = (
    JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")) as { version: string }
  ).version;
  const version = current.replace(/\d+$/u, (value) => String(BigInt(value) + 1n));
  return {
    root,
    initial,
    version,
    git,
    inspect: (base, head, options = {}) =>
      spawnSync(
        process.execPath,
        [
          path.join(root, "scripts/release-inspect.ts"),
          "--base",
          base,
          "--head",
          head,
          ...(options.flags ?? []),
        ],
        {
          cwd: os.tmpdir(),
          env: { ...environment, ...options.env },
          encoding: "utf8",
          timeout: 30_000,
        },
      ),
  };
}

test("release CLI binds exact Git trees and ignores inherited repository redirection", () => {
  const f = fixture();
  try {
    applyFoundryReleaseVersion(planFoundryReleaseVersion(f.root, f.version));
    f.git("add", ".");
    f.git("commit", "-m", "Prepare release");
    const head = f.git("rev-parse", "HEAD");
    const output = path.join(f.root, "github-output");
    const result = f.inspect(f.initial, head, {
      env: {
        GIT_DIR: path.join(f.root, "absent.git"),
        GIT_WORK_TREE: os.tmpdir(),
        GITHUB_ACTIONS: "true",
        GITHUB_OUTPUT: output,
      },
      flags: ["--github-output"],
    });
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout) as Record<string, unknown>;
    assert.equal(report.release, true);
    assert.equal(report.head, head);
    assert.equal(report.tree, f.git("rev-parse", `${head}^{tree}`));
    assert.equal(report.version, f.version);
    assert.match(fs.readFileSync(output, "utf8"), /^should_release=true\n/u);
    assert.notEqual(f.inspect("HEAD~1", head).status, 0);
    assert.notEqual(f.inspect(head, f.initial).status, 0);
    assert.notEqual(f.inspect(f.initial, head, { flags: ["--head", head] }).status, 0);
  } finally {
    fs.rmSync(f.root, { recursive: true, force: true });
  }
});

test("ordinary manifest edits skip publication without loading unrelated binary blobs", () => {
  const f = fixture();
  try {
    const file = path.join(f.root, "package.json");
    fs.appendFileSync(file, "\n");
    fs.writeFileSync(path.join(f.root, "large-binary.bin"), Buffer.alloc(9 * 1024 * 1024, 0xff));
    f.git("add", ".");
    f.git("commit", "-m", "Ordinary source update");
    const result = f.inspect(f.initial, f.git("rev-parse", "HEAD"));
    assert.equal(result.status, 0, result.stderr);
    assert.equal((JSON.parse(result.stdout) as { release: boolean }).release, false);
  } finally {
    fs.rmSync(f.root, { recursive: true, force: true });
  }
});

test("release CLI rejects a real version commit containing additional source changes", () => {
  const f = fixture();
  try {
    applyFoundryReleaseVersion(planFoundryReleaseVersion(f.root, f.version));
    fs.writeFileSync(path.join(f.root, "unreviewed.ts"), "export const unexpected = true;\n");
    f.git("add", ".");
    f.git("commit", "-m", "Invalid mixed release");
    const result = f.inspect(f.initial, f.git("rev-parse", "HEAD"));
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /release-only/iu);
  } finally {
    fs.rmSync(f.root, { recursive: true, force: true });
  }
});

test("release Git comparison cannot conceal changed non-UTF-8 document bytes", () => {
  const f = fixture();
  try {
    const doc = path.join(f.root, "README.md");
    const header = Buffer.from("---\nlastReviewedCommit: old\ntitle: Rules\n---\n");
    fs.writeFileSync(doc, Buffer.concat([header, Buffer.from([0xfe]), Buffer.from("\n")]));
    f.git("add", ".");
    f.git("commit", "-m", "Add invalid text fixture");
    const base = f.git("rev-parse", "HEAD");
    applyFoundryReleaseVersion(planFoundryReleaseVersion(f.root, f.version));
    fs.writeFileSync(doc, Buffer.concat([header, Buffer.from([0xff]), Buffer.from("\n")]));
    f.git("add", ".");
    f.git("commit", "-m", "Change hidden bytes with a version bump");
    const result = f.inspect(base, f.git("rev-parse", "HEAD"));
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /UTF-8/iu);
  } finally {
    fs.rmSync(f.root, { recursive: true, force: true });
  }
});

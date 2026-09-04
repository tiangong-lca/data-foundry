import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

test(
  "pre-push tests cannot inherit the push repository Git bindings",
  { skip: process.platform === "win32" },
  () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "foundry-hook-isolation-"));
    const parent = path.join(root, "parent");
    const nested = path.join(root, "test-repository");
    const home = path.join(root, "home");
    const bin = path.join(root, "bin");
    const marker = path.join(root, "observed.txt");
    fs.mkdirSync(home);
    fs.mkdirSync(bin);
    const env: NodeJS.ProcessEnv = Object.fromEntries(
      Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")),
    );
    env.HOME = home;
    try {
      execFileSync("git", ["init", "--quiet", parent], { env });
      const gitDir = path.join(parent, ".git");
      execFileSync("git", ["-C", parent, "config", "core.worktree", parent], { env });
      const before = fs.readFileSync(path.join(gitDir, "config"), "utf8");
      fs.writeFileSync(
        path.join(bin, "pnpm"),
        '#!/bin/sh\nset -eu\ntest "$1" = prepush:gate\nprintf "%s|%s|%s" "${GIT_DIR-unset}" "${GIT_WORK_TREE-unset}" "${GIT_INDEX_FILE-unset}" > "$FOUNDRY_HOOK_TEST_MARKER"\ngit init --quiet "$FOUNDRY_HOOK_TEST_REPO"\n',
        { mode: 0o755 },
      );
      const result = spawnSync("sh", [path.join(repoRoot, ".husky/pre-push")], {
        cwd: parent,
        encoding: "utf8",
        env: {
          ...env,
          PATH: `${bin}${path.delimiter}${env.PATH ?? ""}`,
          GIT_DIR: gitDir,
          GIT_WORK_TREE: parent,
          GIT_INDEX_FILE: path.join(gitDir, "index"),
          FOUNDRY_HOOK_TEST_MARKER: marker,
          FOUNDRY_HOOK_TEST_REPO: nested,
        },
      });
      assert.equal(result.status, 0, result.stderr);
      assert.equal(fs.readFileSync(marker, "utf8"), "unset|unset|unset");
      assert.equal(fs.readFileSync(path.join(gitDir, "config"), "utf8"), before);
      assert.equal(fs.existsSync(path.join(nested, ".git")), true);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  },
);

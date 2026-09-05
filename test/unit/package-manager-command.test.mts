import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { resolvePackageManagerCommand } from "../../scripts/lib/package-manager-command.ts";

test("Windows pnpm resolution prefers the native PNPM_HOME and preserves literal arguments", () => {
  const argv = ["pack", "--pack-destination", "C:\\用户 & files\\(artifacts)"];
  const home = "C:\\pnpm home";
  const native = path.win32.join(home, "pnpm.exe");
  const invocation = resolvePackageManagerCommand("pnpm", argv, {
    platform: "win32",
    environment: { PNPM_HOME: home, PATH: "C:\\other", npm_execpath: "pnpm" },
    isFile: (candidate) => candidate.endsWith("pnpm.exe"),
  });
  assert.deepEqual(invocation, { executable: native, argv });
  assert.notEqual(invocation.argv, argv);
});

test("Windows pnpm uses absolute PATH entries when PNPM_HOME is absent or unusable", () => {
  const native = "C:\\tools\\pnpm.exe";
  for (const PNPM_HOME of [undefined, "relative", "C:\\missing"])
    assert.equal(
      resolvePackageManagerCommand("pnpm", [], {
        platform: "win32",
        environment: { PNPM_HOME, Path: ".;relative;C:\\tools" },
        isFile: (candidate) => candidate === native,
      }).executable,
      native,
    );
});

test("Windows npm skips incomplete Node distributions and uses the colocated Node and npm script", () => {
  const root = "C:\\complete Node 中文";
  const files = new Set([
    "C:\\pnpm standalone\\node.exe",
    "C:\\shim only\\npm.cmd",
    path.win32.join(root, "npm.cmd"),
    path.win32.join(root, "node.exe"),
    path.win32.join(root, "node_modules/npm/bin/npm-cli.js"),
  ]);
  const args = ["install", "C:\\package & inputs\\foundry.tgz"];
  assert.deepEqual(
    resolvePackageManagerCommand("npm", args, {
      platform: "win32",
      environment: { PATH: `C:\\pnpm standalone;C:\\shim only;${root}` },
      isFile: (candidate) => files.has(candidate),
    }),
    {
      executable: path.win32.join(root, "node.exe"),
      argv: [path.win32.join(root, "node_modules/npm/bin/npm-cli.js"), ...args],
    },
  );
});

test("Windows package tools fail before execution when only command shims or relative paths exist", () => {
  for (const manager of ["pnpm", "npm"] as const)
    assert.throws(
      () =>
        resolvePackageManagerCommand(manager, [], {
          platform: "win32",
          environment: { PNPM_HOME: "relative", PATH: ".;relative;C:\\shim only" },
          isFile: (candidate) => candidate.endsWith(".cmd"),
        }),
      /Cannot resolve/u,
    );
});

test("POSIX package tools preserve executable lookup and argv without Windows probing", () => {
  for (const platform of ["linux", "darwin"] as const)
    for (const manager of ["pnpm", "npm"] as const) {
      const argv = ["pack", "路径 with space & metacharacters"];
      assert.deepEqual(
        resolvePackageManagerCommand(manager, argv, {
          platform,
          isFile: () => {
            throw new Error("Unexpected Windows lookup");
          },
        }),
        { executable: manager, argv },
      );
    }
});

test("package verification launches native pnpm on Windows without a command shell", () => {
  const verifier = pathToFileURL(
    path.resolve(import.meta.dirname, "../../scripts/verify-foundry-package.ts"),
  ).href;
  const result = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `
    import assert from 'node:assert/strict';
    import childProcess from 'node:child_process';
    import fs from 'node:fs';
    import { syncBuiltinESMExports } from 'node:module';
    const { dryRunPackFiles } = await import(${JSON.stringify(verifier)});
    const native = String.raw\`C:\\tools 中文 & pnpm\\pnpm.exe\`;
    const originalStat = fs.statSync;
    fs.statSync = (candidate, ...rest) => candidate === native
      ? { isFile: () => true } : originalStat(candidate, ...rest);
    Object.defineProperty(process, 'platform', { value: 'win32' });
    process.env.PNPM_HOME = String.raw\`C:\\tools 中文 & pnpm\`;
    childProcess.spawnSync = (executable, argv, options) => {
      assert.equal(executable, native);
      assert.deepEqual(argv, ['pack', '--dry-run', '--json']);
      assert.equal(options.shell, false);
      return { status: 0, stdout: JSON.stringify({files:[{path:'b'},{path:'a'}]}) };
    };
    syncBuiltinESMExports();
    assert.deepEqual(dryRunPackFiles(), ['a', 'b']);
  `,
    ],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

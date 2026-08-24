import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, "..", "..");
const packageJson = readJson("package.json");
const inventory = readJson("specs/typescript-migration-inventory.json");
const packageManager = "pnpm@11.23.0";
const packageManagerVersion = "11.23.0";
const typescriptVersion = "7.0.2";
const lockNames = new Set([
  "bun.lock",
  "bun.lockb",
  "npm-shrinkwrap.json",
  "package-lock.json",
  "pnpm-lock.yaml",
  "pnpm-lock.yml",
  "yarn.lock",
]);
const npmCommandPattern =
  /\b(?:npx|npm\s+(?:add|audit|cache|ci|config|dedupe|exec|fund|i|install|link|list|ls|outdated|pack|pkg|prune|publish|rebuild|remove|run|test|uninstall|unlink|update|version|view|whoami))\b/iu;

test("Foundry declares one exact pnpm workspace and lockfile", () => {
  assert.equal(packageJson.packageManager, packageManager);
  assert.equal(packageJson.engines?.node, ">=24 <25");
  assert.equal(packageJson.engines?.pnpm, packageManagerVersion);
  assert.equal(execFileSync("pnpm", ["--version"], commandOptions()).trim(), packageManagerVersion);

  const trackedLocks = trackedFiles()
    .filter((file) => lockNames.has(path.basename(file)))
    .sort();
  assert.deepEqual(trackedLocks, ["pnpm-lock.yaml"]);

  const workspace = readText("pnpm-workspace.yaml");
  assert.match(workspace, /^packages:\s*\[\]\s*$/mu);
  assert.match(workspace, /strictDepBuilds:\s*true/u);
  assert.match(workspace, /fast-uri:\s*3\.1\.5/u);
});

test("Foundry has one direct and recursive TypeScript 7 compiler graph", () => {
  assert.equal(packageJson.devDependencies?.typescript, typescriptVersion);
  for (const forbidden of [
    "prettier-plugin-organize-imports",
    "typescript-eslint",
    "@typescript-eslint/parser",
    "ts-node",
  ]) {
    assert.equal(packageJson.dependencies?.[forbidden], undefined);
    assert.equal(packageJson.devDependencies?.[forbidden], undefined);
  }

  for (const lockfileOnly of [false, true]) {
    const args = ["list", "typescript", "--recursive", "--depth", "Infinity", "--json"];
    if (lockfileOnly) args.push("--lockfile-only");
    const result = spawnSync("pnpm", args, commandOptions());
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const versions = collectDependencyVersions(JSON.parse(result.stdout || "[]"), "typescript");
    assert.ok(versions.length > 0);
    assert.deepEqual(
      versions.filter((version) => version !== typescriptVersion),
      [],
    );
  }
});

test("Foundry publishes one canonical pnpm TypeScript TDD gate", () => {
  const scripts = packageJson.scripts ?? {};
  for (const required of [
    "lint",
    "typecheck",
    "build",
    "test",
    "test:unit",
    "test:commands",
    "test:scenarios",
    "test:toolchain",
    "prepush:gate",
    "golden:diff",
  ]) {
    assert.equal(typeof scripts[required], "string", `missing scripts.${required}`);
  }
  assert.match(scripts.lint, /oxlint/u);
  assert.match(scripts.typecheck, /tsc/u);
  assert.match(scripts["prepush:gate"], /pnpm\s+(?:run\s+)?test:toolchain/u);
  assert.match(scripts["prepush:gate"], /pnpm\s+(?:run\s+)?test/u);
});

test("active tracked surfaces expose no npm or npx package-management commands", () => {
  const findings = [];
  for (const file of trackedFiles()) {
    if (lockNames.has(path.basename(file))) continue;
    if (!/\.(?:c?js|mjs|cts|mts|ts|json|md|ya?ml)$/u.test(file)) continue;
    for (const [index, line] of readText(file).split(/\r?\n/u).entries()) {
      if (/\bhistorical\b/iu.test(line)) continue;
      if (npmCommandPattern.test(line)) {
        findings.push({ file, line: index + 1, text: line.trim() });
      }
    }
  }
  assert.deepEqual(findings, []);
});

test("the exact tracked JavaScript migration inventory cannot grow or drift silently", () => {
  const paths = trackedFiles()
    .filter((file) => /\.(?:cjs|mjs)$/u.test(file))
    .sort();
  const canonical = paths.map((file) => `${file}\n`).join("");
  const digest = createHash("sha256").update(canonical).digest("hex");

  assert.ok(inventory.remaining_count <= inventory.baseline_count);
  assert.equal(paths.length, inventory.remaining_count);
  assert.equal(digest, inventory.canonical_path_list_sha256);
  assert.deepEqual(
    paths.filter(
      (file) =>
        !file.startsWith("scripts/") &&
        !file.startsWith("test/") &&
        file !== "prettier.config.cjs",
    ),
    [],
  );
});

test("Foundry pins the published CLI runtime and high-risk audit closure", () => {
  assert.equal(packageJson.dependencies?.["@tiangong-lca/cli"], "0.1.0");
  assert.equal(packageJson.dependencies?.ajv, "8.20.0");
  const workspace = readText("pnpm-workspace.yaml");
  assert.match(workspace, /fast-uri:\s*3\.1\.5/u);
});

function trackedFiles() {
  return execFileSync("git", ["ls-files", "-z"], commandOptions())
    .split("\0")
    .filter(Boolean);
}

function readText(relativePath) {
  return readFileSync(path.join(repoRoot, relativePath), "utf8");
}

function readJson(relativePath) {
  return JSON.parse(readText(relativePath));
}

function commandOptions() {
  return {
    cwd: repoRoot,
    encoding: "utf8",
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  };
}

function collectDependencyVersions(tree, dependencyName) {
  const roots = Array.isArray(tree) ? tree : [tree];
  return roots.flatMap((root) => collectVersionsFromNode(root, dependencyName));
}

function collectVersionsFromNode(node, dependencyName) {
  const versions = [];
  for (const section of ["dependencies", "devDependencies", "optionalDependencies"]) {
    for (const [name, metadata] of Object.entries(node?.[section] ?? {})) {
      if (name === dependencyName) versions.push(metadata.version);
      versions.push(...collectVersionsFromNode(metadata, dependencyName));
    }
  }
  return versions;
}

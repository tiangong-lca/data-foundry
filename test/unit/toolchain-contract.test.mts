// This typed contract is the first file in the monotonic Foundry TypeScript migration.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, "..", "..");
type PackageJson = {
  packageManager?: string;
  engines?: Record<string, string>;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};
type PnpmDependencyNode = {
  version?: string;
  dependencies?: Record<string, PnpmDependencyNode>;
  devDependencies?: Record<string, PnpmDependencyNode>;
  optionalDependencies?: Record<string, PnpmDependencyNode>;
};

const packageJson = readJson<PackageJson>("package.json");
const packageManager = "pnpm@11.23.0";
const packageManagerVersion = "11.23.0";
const typescriptVersion = "7.0.2";
const nodeVersion = "24.19.0";
const contractPath = "test/unit/toolchain-contract.test.mts";
const extensionlessPackageCommandFiles = new Set([
  ".env.example",
  ".prettierignore",
  ".husky/pre-commit",
  ".husky/pre-push",
]);
const lockNames = new Set([
  "bun.lock",
  "bun.lockb",
  "npm-shrinkwrap.json",
  "package-lock.json",
  "pnpm-lock.yaml",
  "pnpm-lock.yml",
  "yarn.lock",
]);
const legacyRunnerName = ["n", "px"].join("");
const legacyManagerName = ["n", "pm"].join("");
const legacyPackageCommandPattern = new RegExp(
  `\\b(?:${legacyRunnerName}|${legacyManagerName}\\s+(?:add|audit|cache|ci|config|dedupe|exec|fund|i|install|link|list|ls|outdated|pack|pkg|prune|publish|rebuild|remove|run|test|uninstall|unlink|update|version|view|whoami))\\b`,
  "iu",
);

test("Foundry declares one exact pnpm workspace and lockfile", () => {
  assert.equal(process.version, `v${nodeVersion}`);
  assert.equal(readText(".nvmrc").trim(), nodeVersion);
  assert.equal(packageJson.packageManager, packageManager);
  assert.equal(packageJson.engines?.node, `>=${nodeVersion} <25`);
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

  const dependencyNames = Object.keys({
    ...packageJson.dependencies,
    ...packageJson.devDependencies,
  });
  assert.deepEqual(
    dependencyNames.filter(
      (name) =>
        /^@typescript-eslint\//u.test(name) ||
        /^typescript-eslint$/u.test(name) ||
        /^(?:typescript|ts)[-_]?[56]$/iu.test(name),
    ),
    [],
  );

  const lockfile = readText("pnpm-lock.yaml");
  assert.doesNotMatch(lockfile, /npm:typescript@[~^]?[56]\./iu);
  assert.doesNotMatch(lockfile, /(?:^|\s)(?:typescript|typescript[-_]?[56]|ts[-_]?[56])@[56]\./imu);

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
    "install:frozen",
    "audit:high",
    "prepush:gate",
    "golden:diff",
  ]) {
    assert.equal(typeof scripts[required], "string", `missing scripts.${required}`);
  }
  assert.match(scripts.lint, /oxlint/u);
  assert.match(scripts.typecheck, /tsc/u);
  assert.equal(scripts["install:frozen"], "pnpm install --frozen-lockfile");
  assert.equal(scripts["audit:high"], "pnpm audit --audit-level high");
  assert.match(scripts.test, /\.test\.mts/u);
  assert.match(scripts["test:unit"], /\.test\.mts/u);
  assert.match(scripts["prepush:gate"], /pnpm\s+(?:run\s+)?test:toolchain/u);
  assert.match(scripts["prepush:gate"], /pnpm\s+(?:run\s+)?test/u);
  assert.match(scripts["prepush:gate"], /pnpm\s+(?:run\s+)?audit:high/u);
});

test("active tracked surfaces expose no legacy package-management commands", () => {
  const findings = [];
  for (const file of trackedFiles()) {
    if (lockNames.has(path.basename(file))) continue;
    if (!isActivePackageCommandSurface(file)) continue;
    for (const [index, line] of readText(file).split(/\r?\n/u).entries()) {
      if (/\bhistorical\b/iu.test(line)) continue;
      if (legacyPackageCommandPattern.test(line)) {
        findings.push({ file, line: index + 1, text: line.trim() });
      }
    }
  }
  assert.deepEqual(findings, []);
});

test("tracked first-party JavaScript remains permanently at zero", () => {
  assert.deepEqual(
    trackedFiles().filter((file) => /\.(?:cjs|js|mjs)$/u.test(file)),
    [],
  );
  assert.equal(existsSync(path.join(repoRoot, "prettier.config.ts")), true);
});

test("Foundry pins the published CLI runtime and high-risk audit closure", () => {
  assert.equal(packageJson.dependencies?.["@tiangong-lca/cli"], "0.1.1");
  const runtimeSource = readText("scripts/lib/foundry-runtime-utils.ts");
  assert.match(runtimeSource, /tiangongLcaCliPackageVersion\s*=\s*"0\.1\.1"/u);
  assert.doesNotMatch(runtimeSource, /tiangongLcaCliPackageVersion\s*=\s*"0\.1\.0"/u);
  assert.equal(packageJson.dependencies?.ajv, "8.20.0");
  const workspace = readText("pnpm-workspace.yaml");
  assert.match(workspace, /fast-uri:\s*3\.1\.5/u);
  assert.match(workspace, /minimumReleaseAge:\s*1440/u);
});

test("four-platform CI installs only from the frozen pnpm contract", () => {
  const workflow = readText(".github/workflows/quality-gate.yml");
  assert.match(readText(".gitattributes"), /^\*\s+text=auto\s+eol=lf$/mu);
  for (const expected of [
    "ubuntu-latest",
    "windows-latest",
    "macos-latest",
    "ubuntu-24.04-arm",
    `runtime: node@${nodeVersion}`,
    "fetch-depth: 0",
    "pnpm install --frozen-lockfile",
    "pnpm prepush:gate",
  ]) {
    assert.match(workflow, new RegExp(escapeRegExp(expected), "u"));
  }
});

test("golden comparison is portable and cannot collapse into HEAD self-comparison", () => {
  const source = readText("scripts/foundry-golden-diff.ts");
  assert.match(source, /merge-base/u);
  assert.match(source, /FOUNDRY_GOLDEN_BASE/u);
  assert.match(source, /pnpm["'],\s*\["install",\s*"--frozen-lockfile"/u);
  assert.doesNotMatch(source, /function linkInstalledDependencies/u);
  assert.doesNotMatch(
    source,
    /installPortableBaselineProcessAdapters/u,
    "Golden must execute dependency-bound adapters from the baseline commit, not copy them from HEAD",
  );
  assert.doesNotMatch(source, /spawnSync\(\s*["']diff["']/u);
  assert.doesNotMatch(source, /worktree["'],\s*["']add["'].*["']HEAD["']/su);
});

function trackedFiles(): string[] {
  return execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    commandOptions(),
  )
    .split("\0")
    .filter((file) => Boolean(file) && existsSync(path.join(repoRoot, file)))
    .sort();
}

function isActivePackageCommandSurface(file: string): boolean {
  if (file === contractPath || hasHistoricalFrontmatter(file)) return false;
  return (
    extensionlessPackageCommandFiles.has(file) || /\.(?:cts|mts|ts|json|md|ya?ml|sh)$/u.test(file)
  );
}

function hasHistoricalFrontmatter(file: string): boolean {
  if (!file.endsWith(".md")) return false;
  const header = readText(file).split(/\r?\n/u).slice(0, 40).join("\n");
  return /^status:\s*historical\s*$/imu.test(header);
}

function readText(relativePath: string): string {
  return readFileSync(path.join(repoRoot, relativePath), "utf8");
}

function readJson<T>(relativePath: string): T {
  return JSON.parse(readText(relativePath)) as T;
}

function commandOptions() {
  return {
    cwd: repoRoot,
    encoding: "utf8" as const,
    env: process.env,
  };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function collectDependencyVersions(
  tree: PnpmDependencyNode | PnpmDependencyNode[],
  dependencyName: string,
): string[] {
  const roots = Array.isArray(tree) ? tree : [tree];
  return roots.flatMap((root) => collectVersionsFromNode(root, dependencyName));
}

function collectVersionsFromNode(node: PnpmDependencyNode, dependencyName: string): string[] {
  const versions = [];
  for (const section of ["dependencies", "devDependencies", "optionalDependencies"] as const) {
    for (const [name, metadata] of Object.entries(node?.[section] ?? {})) {
      if (name === dependencyName && metadata.version) versions.push(metadata.version);
      versions.push(...collectVersionsFromNode(metadata, dependencyName));
    }
  }
  return versions;
}

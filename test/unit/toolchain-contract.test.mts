// This typed contract is the first file in the monotonic Foundry TypeScript migration.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { cleanBuildOutput } from "../../scripts/clean-build-output.ts";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, "..", "..");
type PackageJson = {
  packageManager?: string;
  engines?: Record<string, string>;
  scripts?: Record<string, string>;
  "lint-staged"?: Record<string, string | string[]>;
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
const packageManager = "pnpm@11.24.0";
const packageManagerVersion = "11.24.0";
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
  assert.match(workspace, /fast-uri:\s*3\.1\.7/u);
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
    "lint:suppressions",
    "lint:oxlint",
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
  assert.equal(scripts["lint:suppressions"], "node scripts/check-lint-suppressions.ts");
  assert.equal(
    scripts.lint,
    "pnpm lint:suppressions && pnpm lint:oxlint && pnpm lint:prettier && pnpm typecheck",
  );
  assert.match(scripts["lint:oxlint"], /--disable-nested-config/u);
  assert.deepEqual(packageJson["lint-staged"]?.["*.{ts,mts,cts,tsx}"], [
    "node scripts/check-lint-suppressions.ts",
    "oxlint --disable-nested-config --type-aware --format=stylish --deny-warnings",
  ]);
  assert.match(scripts.typecheck, /tsc/u);
  assert.equal(scripts["install:frozen"], "pnpm install --frozen-lockfile");
  assert.equal(scripts["audit:high"], "pnpm audit --audit-level high");
  assert.match(scripts.test, /\.test\.mts/u);
  assert.match(scripts["test:unit"], /\.test\.mts/u);
  assert.match(scripts["prepush:gate"], /pnpm\s+(?:run\s+)?test:toolchain/u);
  assert.match(scripts["prepush:gate"], /pnpm\s+(?:run\s+)?test/u);
  assert.match(scripts["prepush:gate"], /pnpm\s+(?:run\s+)?audit:high/u);
});

test("build removes seeded stale output through a cross-platform Node cleaner", () => {
  const fixtureRoot = mkdtempSync(path.join(os.tmpdir(), "foundry-build-output-contract-"));
  const staleFiles = [
    path.join(fixtureRoot, "dist", "scripts", "foundry.mjs"),
    path.join(fixtureRoot, "dist", "scripts", "foundry.mjs.map"),
  ];
  try {
    const fixtureScripts = path.join(fixtureRoot, "scripts");
    mkdirSync(fixtureScripts, { recursive: true });
    writeFileSync(
      path.join(fixtureScripts, "clean-build-output.ts"),
      readText("scripts/clean-build-output.ts"),
    );
    writeFileSync(path.join(fixtureScripts, "foundry.ts"), "export const current = true;\n");
    writeFileSync(
      path.join(fixtureRoot, "tsconfig.build.json"),
      `${JSON.stringify(
        {
          compilerOptions: {
            target: "ES2024",
            module: "NodeNext",
            moduleResolution: "NodeNext",
            noEmitOnError: true,
            outDir: "./dist",
            rootDir: ".",
            skipLibCheck: true,
          },
          include: ["scripts/foundry.ts"],
        },
        null,
        2,
      )}\n`,
    );
    mkdirSync(path.dirname(staleFiles[0]), { recursive: true });
    writeFileSync(staleFiles[0], "export const retiredEntrypoint = true;\n");
    writeFileSync(staleFiles[1], '{"version":3,"file":"foundry.mjs"}\n');

    const cleanResult = spawnSync(
      process.execPath,
      [path.join(fixtureScripts, "clean-build-output.ts")],
      { ...commandOptions(), cwd: fixtureRoot },
    );
    assert.equal(cleanResult.status, 0, cleanResult.stderr || cleanResult.stdout);
    const buildResult = spawnSync(
      process.execPath,
      [
        path.join(repoRoot, "node_modules", "typescript", "bin", "tsc"),
        "-p",
        path.join(fixtureRoot, "tsconfig.build.json"),
      ],
      { ...commandOptions(), cwd: fixtureRoot },
    );
    assert.equal(buildResult.status, 0, buildResult.stderr || buildResult.stdout);
    assert.deepEqual(
      staleFiles.filter((file) => existsSync(file)),
      [],
      "build must remove retired entrypoint and source-map output",
    );
    assert.equal(existsSync(path.join(fixtureRoot, "dist", "scripts", "foundry.js")), true);
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }

  assert.equal(
    packageJson.scripts?.build,
    "node scripts/clean-build-output.ts && pnpm exec tsc -p tsconfig.build.json",
  );
  const cleaner = readText("scripts/clean-build-output.ts");
  assert.match(cleaner, /rmSync/u);
  assert.doesNotMatch(cleaner, /node:child_process|\brm\s+-rf\b|\brmdir\b/u);
});

test("safe clean and no-emit-on-error leave no stale or misleading failed build", () => {
  const fixtureRoot = mkdtempSync(path.join(os.tmpdir(), "foundry-build-clean-contract-"));
  const staleFile = path.join(fixtureRoot, "dist", "scripts", "foundry.mjs");
  const siblingFile = path.join(fixtureRoot, "keep.txt");
  try {
    mkdirSync(path.dirname(staleFile), { recursive: true });
    writeFileSync(staleFile, "export const retiredEntrypoint = true;\n");
    writeFileSync(siblingFile, "keep\n");

    cleanBuildOutput(fixtureRoot);
    assert.equal(existsSync(staleFile), false);
    assert.equal(existsSync(siblingFile), true, "cleaner must stay inside the exact dist path");
    assert.throws(
      () => cleanBuildOutput(path.parse(fixtureRoot).root),
      /Refusing to clean unsafe build output path/u,
    );

    const invalidSource = path.join(fixtureRoot, "invalid.ts");
    writeFileSync(invalidSource, "export const invalid: string = 1;\n");
    const result = spawnSync(
      process.execPath,
      [
        path.join(repoRoot, "node_modules", "typescript", "bin", "tsc"),
        invalidSource,
        "--ignoreConfig",
        "--target",
        "ES2024",
        "--module",
        "NodeNext",
        "--moduleResolution",
        "NodeNext",
        "--outDir",
        path.join(fixtureRoot, "dist"),
        "--noEmitOnError",
        "--skipLibCheck",
      ],
      commandOptions(),
    );
    assert.notEqual(result.status, 0, "controlled type error must fail tsc");
    assert.match(`${result.stdout}\n${result.stderr}`, /TS2322/u);
    assert.equal(existsSync(path.join(fixtureRoot, "dist", "invalid.js")), false);
    assert.equal(existsSync(staleFile), false, "failed tsc must not restore stale output");
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("TypeScript enforces erasable-only runtime syntax for typecheck and build", () => {
  const sourceConfig = JSON.parse(readText("tsconfig.json")) as {
    compilerOptions?: Record<string, unknown>;
  };
  assert.equal(sourceConfig.compilerOptions?.erasableSyntaxOnly, true);

  for (const configPath of ["tsconfig.json", "tsconfig.build.json"]) {
    const result = spawnSync(
      process.execPath,
      [
        path.join(repoRoot, "node_modules", "typescript", "bin", "tsc"),
        "-p",
        path.join(repoRoot, configPath),
        "--showConfig",
      ],
      commandOptions(),
    );
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const effective = JSON.parse(result.stdout) as {
      compilerOptions?: Record<string, unknown>;
    };
    assert.equal(effective.compilerOptions?.erasableSyntaxOnly, true, configPath);
    if (configPath === "tsconfig.build.json") {
      assert.equal(effective.compilerOptions?.noEmitOnError, true, configPath);
    }
  }
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
    trackedFiles().filter((file) => /\.(?:cjs|js|jsx|mjs)$/u.test(file)),
    [],
  );
  assert.deepEqual(
    trackedFiles().filter((file) => /\.tsx$/u.test(file)),
    [],
    "Foundry does not support a JSX/TSX runtime graph",
  );
  assert.equal(existsSync(path.join(repoRoot, "prettier.config.ts")), true);
});

test("Foundry pins the published CLI runtime and high-risk audit closure", () => {
  assert.equal(packageJson.dependencies?.["@tiangong-lca/cli"], "0.1.10");
  const runtimeSource = readText("scripts/lib/foundry-runtime-utils.ts");
  assert.match(runtimeSource, /tiangongLcaCliPackageVersion\s*=\s*"0\.1\.10"/u);
  assert.doesNotMatch(runtimeSource, /tiangongLcaCliPackageVersion\s*=\s*"0\.1\.[0-2]"/u);
  assert.equal(packageJson.dependencies?.ajv, undefined);
  assert.equal(packageJson.devDependencies?.ajv, "8.20.0");
  const workspace = readText("pnpm-workspace.yaml");
  assert.match(workspace, /fast-uri:\s*3\.1\.7/u);
  assert.match(workspace, /minimumReleaseAge:\s*1440/u);
  assert.doesNotMatch(workspace, /^\s*-\s*["']?@oxlint\/binding-darwin-x64@/mu);
  assert.match(workspace, /-\s+["']?@tiangong-lca\/cli@0\.1\.10["']?/u);
  assert.doesNotMatch(workspace, /-\s+["']?@tiangong-lca\/cli@0\.1\.[0-2](?:["']|\s|$)/u);
  for (const file of trackedFiles().filter((value) => /\.(?:cts|mts|ts)$/u.test(value))) {
    assert.doesNotMatch(readText(file), /@tiangong-lca\/cli\/dist\/src\//u, file);
  }
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
  assert.match(source, /const args = \["install", "--frozen-lockfile", "--ignore-scripts"\]/u);
  assert.match(source, /run\("pnpm", args/u);
  assert.match(source, /commandProcessor, \["\/d", "\/s", "\/c"/u);
  assert.doesNotMatch(source, /function linkInstalledDependencies/u);
  assert.doesNotMatch(
    source,
    /installPortableBaselineProcessAdapters/u,
    "Golden must execute dependency-bound adapters from the baseline commit, not copy them from HEAD",
  );
  assert.doesNotMatch(source, /spawnSync\(\s*["']diff["']/u);
  assert.match(source, /beforeRoot,\s*goldenBase\.commit/u);
  assert.doesNotMatch(source, /beforeRoot,\s*["']HEAD["']/u);
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

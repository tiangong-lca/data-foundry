import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, "..", "..");

function readRepoFile(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

function trackedFiles(): string[] {
  return execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], {
    cwd: repoRoot,
    encoding: "utf8",
  })
    .split("\0")
    .filter((file) => Boolean(file) && fs.existsSync(path.join(repoRoot, file)))
    .sort();
}

test("tracked first-party source and tests have a permanent zero-JavaScript ratchet", () => {
  assert.deepEqual(
    trackedFiles().filter((file) => /\.(?:cjs|js|mjs)$/u.test(file)),
    [],
  );
});

test("Prettier configuration is native TypeScript with no compatibility config", async () => {
  const typedPath = path.join(repoRoot, "prettier.config.ts");
  assert.equal(fs.existsSync(typedPath), true);
  assert.equal(fs.existsSync(path.join(repoRoot, "prettier.config.cjs")), false);
  const source = fs.readFileSync(typedPath, "utf8");
  assert.doesNotMatch(source, /\bany\b|@ts-(?:ignore|nocheck|expect-error)/u);
  const module = (await import(pathToFileURL(typedPath).href)) as Record<string, unknown>;
  assert.deepEqual(Object.keys(module), ["default"]);
  assert.deepEqual(module.default, {
    printWidth: 100,
    trailingComma: "all",
    proseWrap: "never",
    endOfLine: "lf",
  });
});

test("TypeScript and pnpm surfaces contain no JavaScript compatibility graph", () => {
  for (const configPath of ["tsconfig.json", "tsconfig.build.json"]) {
    const config = JSON.parse(readRepoFile(configPath)) as {
      compilerOptions?: Record<string, unknown>;
      include?: string[];
    };
    assert.equal(config.compilerOptions?.allowJs, undefined, configPath);
    assert.equal(config.compilerOptions?.checkJs, undefined, configPath);
    assert.deepEqual(
      (config.include ?? []).filter((pattern) => /\.(?:cjs|js|mjs)/u.test(pattern)),
      [],
      configPath,
    );
  }
  const typecheckConfig = JSON.parse(readRepoFile("tsconfig.json")) as { include?: string[] };
  assert.ok(typecheckConfig.include?.includes("prettier.config.ts"));

  const packageJson = JSON.parse(readRepoFile("package.json")) as {
    scripts?: Record<string, string>;
    "lint-staged"?: Record<string, unknown>;
  };
  assert.equal(packageJson.scripts?.test, 'node --test "test/**/*.test.mts"');
  assert.equal(packageJson.scripts?.["test:unit"], 'node --test "test/unit/*.test.mts"');
  assert.equal(packageJson.scripts?.["test:commands"], 'node --test "test/commands/*.test.mts"');
  assert.equal(packageJson.scripts?.["test:scenarios"], 'node --test "test/scenarios/*.test.mts"');
  for (const pattern of Object.keys(packageJson["lint-staged"] ?? {})) {
    assert.doesNotMatch(pattern, /(?:^|[,{}])(?:c?js|mjs)(?:[,{}]|$)/u);
  }
});

test("completed migration ledger is removed in favor of the permanent ratchet", () => {
  assert.equal(
    fs.existsSync(path.join(repoRoot, "specs", "typescript-migration-inventory.json")),
    false,
  );
  for (const relativePath of [
    ".docpact/config.yaml",
    "AGENTS.md",
    "README.md",
    "WORKFLOW.md",
    "docs/architecture.md",
    "docs/file-location-registry.json",
    "docs/foundry-ai-navigation.md",
    "docs/foundry-command-surface.md",
    "docs/workspace-project-map.md",
    "test/README.md",
    "test/unit/toolchain-contract.test.mts",
    "test/unit/fixture-helpers-contract.test.mts",
  ]) {
    assert.doesNotMatch(
      readRepoFile(relativePath),
      /typescript-migration-inventory\.json/u,
      relativePath,
    );
  }
});

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, "..", "..");

function runGolden(base: string): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, ["scripts/foundry-golden-diff.ts"], {
    cwd: repoRoot,
    encoding: "utf8",
    env: { ...process.env, FOUNDRY_GOLDEN_BASE: base },
    maxBuffer: 64 * 1024 * 1024,
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

test("Golden harness uses a non-HEAD merge-base and emits exact pass JSON", () => {
  const result = runGolden("HEAD^");
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout) as Record<string, unknown>;
  assert.equal(report.schema_version, 1);
  assert.equal(report.status, "passed");
  assert.equal(report.comparison_ref, "HEAD^");
  assert.equal(report.normalized_diff, 0);
  assert.equal(report.artifacts, null);
  assert.deepEqual(report.compared_commands, [
    "help",
    "doctor",
    "profiles-list",
    "capabilities-list",
    "route-task",
    "dataset-authoring-task-build",
    "dataset-curation-gate",
    "dataset-bundle-sample-rows",
    "dataset-post-authoring-finalize",
    "dataset-mutation-manifest",
  ]);
  assert.equal(result.stdout, `${JSON.stringify(report, null, 2)}\n`);
});

test("Golden harness rejects a HEAD self-comparison before producing artifacts", () => {
  const result = runGolden("HEAD");
  assert.notEqual(result.status, 0);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /requires a non-HEAD merge-base/u);
});

test("Golden source preserves Node-native comparison and executable-plus-argv portability", () => {
  const source = fs.readFileSync(path.join(repoRoot, "scripts/foundry-golden-diff.ts"), "utf8");
  assert.match(source, /merge-base/u);
  assert.match(source, /process\.execPath,\s*\["scripts\/foundry\.mjs",\s*\.\.\.args\]/u);
  assert.match(source, /readFileSync\(baselinePath\)\.equals\(readFileSync\(currentPath\)\)/u);
  assert.match(source, /resolveTidasProcessCommand|fake-tidas\.mjs/u);
  assert.doesNotMatch(source, /spawnSync\(\s*["']diff["']/u);
  assert.doesNotMatch(source, /worktree["'],\s*["']add["'].*["']HEAD["']/su);
});

test("Golden harness exists only as zero-escape native TypeScript", () => {
  const typedPath = path.join(repoRoot, "scripts/foundry-golden-diff.ts");
  assert.equal(fs.existsSync(typedPath), true);
  assert.equal(fs.existsSync(typedPath.replace(/\.ts$/u, ".mjs")), false);
  const source = fs.readFileSync(typedPath, "utf8");
  assert.doesNotMatch(source, /\bas\s+any\b|:\s*any\b|\bany\s*\[\]|<\s*any\b|,\s*any\s*>/u);
  assert.doesNotMatch(source, /@ts-(?:no)?check|@ts-ignore/u);
});

test("package, metadata, surface, and toolchain target the typed Golden entrypoint", () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));
  assert.equal(packageJson.scripts["golden:diff"], "node scripts/foundry-golden-diff.ts");
  for (const consumer of [
    "scripts/lib/foundry-command-metadata.ts",
    "scripts/lib/surface-audit.ts",
    "test/unit/foundry-command-metadata.test.mts",
    "test/unit/surface-audit-typescript.test.mts",
    "test/unit/toolchain-contract.test.mts",
    "test/unit/foundry-golden-diff-contract.test.mts",
  ]) {
    const source = fs.readFileSync(path.join(repoRoot, consumer), "utf8");
    assert.match(source, /scripts\/foundry-golden-diff\.ts/u);
    assert.doesNotMatch(source, /foundry-golden-diff\.mjs/u);
  }
});

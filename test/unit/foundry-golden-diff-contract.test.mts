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
  assert.match(source, /path\.join\("scripts",\s*"foundry\.ts"\)/u);
  assert.match(source, /path\.join\("scripts",\s*"foundry\.mjs"\)/u);
  assert.match(source, /scripts\\\/foundry\\\.\(\?:mjs\|ts\)/u);
  assert.match(source, /process\.execPath,\s*\[entry,\s*\.\.\.args\]/u);
  assert.match(source, /readFileSync\(baselinePath\)\.equals\(readFileSync\(currentPath\)\)/u);
  assert.match(source, /resolveTidasProcessCommand|fake-tidas\.(?:mjs|ts)/u);
  assert.doesNotMatch(source, /spawnSync\(\s*["']diff["']/u);
  assert.doesNotMatch(source, /worktree["'],\s*["']add["'].*["']HEAD["']/su);
});

test("Golden baseline and current commands share one explicit credential-free environment", () => {
  const source = fs.readFileSync(path.join(repoRoot, "scripts/foundry-golden-diff.ts"), "utf8");
  assert.match(source, /createFoundryIsolatedChildEnvironment/u);
  assert.match(source, /copyFoundryIsolatedExecutable/u);
  assert.match(source, /process\.platform\s*===\s*["']win32["']/u);
  assert.match(source, /commandProcessor,\s*\["\/d",\s*"\/s",\s*"\/c"/u);
  assert.match(source, /childEnvironmentSnapshot/u);
  assert.match(source, /runSide\("before",\s*beforeRoot,\s*fixture,\s*commandEnvironment\)/u);
  assert.match(source, /runSide\("after",\s*repoRoot,\s*fixture,\s*commandEnvironment\)/u);
  assert.match(source, /baselineEnvironment\s*!==\s*currentEnvironment/u);
  assert.match(source, /env:\s*commandEnvironment/u);
  assert.doesNotMatch(source, /\.\.\.process\.env/u);
  assert.doesNotMatch(source, /env:\s*options\.env\s*\?\?\s*process\.env/u);
});

test("Golden admits only exact reviewed Worldsteel profile-truth contracts", () => {
  const source = fs.readFileSync(path.join(repoRoot, "scripts/foundry-golden-diff.ts"), "utf8");
  assert.match(source, /worldsteelProfileContractMigrations/u);
  for (const sha256 of [
    "3ea8f90134ab5cc6f19ea6825556d1ef21136011b7c35ecd3d949a266de023c7",
    "4d33ab773546d7055db900899e33f4f3179f41b815009fdedf232bfcdf0cd297",
  ]) {
    assert.match(source, new RegExp(sha256, "u"));
  }
  assert.match(source, /expectedDocs !== JSON\.stringify\(value\.docs\)/u);
  assert.match(source, /<worldsteel-profile-truth-contract>/u);
  assert.doesNotMatch(source, /d8943c24ab3f7518451ac9db103e0faf7dd5f760872411910cc977c047049ab5/u);
});

test("Golden admits only exact strict-datetime capability contract pairs", () => {
  const source = fs.readFileSync(path.join(repoRoot, "scripts/foundry-golden-diff.ts"), "utf8");
  assert.match(source, /capabilityContractMigrationHashes/u);
  for (const sha256 of [
    "4d041cb2ce4b0f9b9181a94e44a0569b71ce7101097cb56db51f254460feade9",
    "0c2acbce5acb110348a62dfab4c5d226192567fcae90916b65dc49280e2567cb",
    "27b5aac2d5cee8c0aeb7e7df5e2d361993341a28fce2eecbb796d8a8edcec050",
    "d18a71a2dfa8933e114ea8b5917a7c54e7bd73813601c76133b9f2914c2be5af",
    "ebc54fd890ea7732b69472f16239e6d5ae7553efcab4eb02fef1886ac6072050",
  ]) {
    assert.match(source, new RegExp(sha256, "u"));
  }
  assert.match(source, /createHash\("sha256"\)\s*\.update\(JSON\.stringify\(projection\)\)/su);
  assert.match(source, /capabilityHashes\.has\(projectionSha256\)/u);
  assert.match(source, /<strict-datetime-capability-contract>/u);
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

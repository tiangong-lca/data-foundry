import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { auditTidasCutover } from "../../scripts/check-tidas-cutover.mjs";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, "..", "..");

function negativeFixturePath(): string {
  return path.join(repoRoot, "scripts", `tidas-cutover-negative-${process.pid}.mjs`);
}

function runAuditScript(): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, ["scripts/check-tidas-cutover.mjs"], {
    cwd: repoRoot,
    encoding: "utf8",
    env: process.env,
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

test("TIDAS cutover script emits exact JSON stdout and zero exit for the active inventory", () => {
  const result = runAuditScript();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, "");
  const report = JSON.parse(result.stdout) as Record<string, unknown>;
  assert.equal(report.schema_version, 1);
  assert.equal(report.status, "passed");
  assert.equal((report.findings as unknown[]).length, 0);
  assert.equal(result.stdout, `${JSON.stringify(report, null, 2)}\n`);
});

test("TIDAS cutover detects an untracked authoritative violation with stable line and exit", () => {
  const fixture = negativeFixturePath();
  fs.writeFileSync(
    fixture,
    ["export const safe = true;", 'export const retired = "python -m tidas_tools";', ""].join("\n"),
  );
  try {
    const report = auditTidasCutover();
    assert.equal(report.status, "failed");
    assert.deepEqual(report.findings, [
      {
        file: path.relative(repoRoot, fixture).split(path.sep).join("/"),
        line: 2,
        pattern: "python(?:3)?\\s+-m\\s+tidas_tools",
      },
    ]);
    const result = runAuditScript();
    assert.equal(result.status, 1);
    assert.equal((JSON.parse(result.stdout).findings as unknown[]).length, 1);
  } finally {
    fs.rmSync(fixture, { force: true });
  }
});

test("TIDAS cutover audit exists only as zero-escape native TypeScript", () => {
  const typedPath = path.join(repoRoot, "scripts/check-tidas-cutover.ts");
  assert.equal(fs.existsSync(typedPath), true);
  assert.equal(fs.existsSync(typedPath.replace(/\.ts$/u, ".mjs")), false);
  const source = fs.readFileSync(typedPath, "utf8");
  assert.doesNotMatch(source, /\bas\s+any\b|:\s*any\b|\bany\s*\[\]|<\s*any\b|,\s*any\s*>/u);
  assert.doesNotMatch(source, /@ts-(?:no)?check|@ts-ignore/u);
});

test("package, surface audit, and tests target the typed cutover entrypoint", () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));
  assert.equal(packageJson.scripts["tidas:cutover:audit"], "node scripts/check-tidas-cutover.ts");
  for (const consumer of [
    "scripts/lib/surface-audit.ts",
    "test/unit/tidas-cutover-audit.test.mjs",
    "test/unit/tidas-cutover-script-contract.test.mts",
  ]) {
    const source = fs.readFileSync(path.join(repoRoot, consumer), "utf8");
    assert.match(
      source,
      /scripts\/check-tidas-cutover\.ts|\.\.\/\.\.\/scripts\/check-tidas-cutover\.ts/u,
    );
    assert.doesNotMatch(source, /check-tidas-cutover\.mjs/u);
  }
});

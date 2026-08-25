import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { auditTidasCutover } from "../../scripts/check-tidas-cutover.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

test("active Foundry surfaces contain no retired Python TIDAS invocation paths", () => {
  const report = auditTidasCutover();
  assert.equal(report.status, "passed", JSON.stringify(report.findings, null, 2));
  assert.ok(report.active_files_scanned > 0, "cutover audit must scan active runtime files");
  assert.equal(report.findings.length, 0);
});

test("ignored runtime skill caches cannot pollute the tracked cutover audit", () => {
  const ignoredSkillRoot = path.join(
    repoRoot,
    ".agents",
    "skills",
    `tiangong-kb-issue-63-runtime-${process.pid}`,
  );
  const baseline = auditTidasCutover();
  fs.mkdirSync(ignoredSkillRoot, { recursive: true });
  fs.writeFileSync(
    path.join(ignoredSkillRoot, "SKILL.md"),
    "ignored runtime cache invokes python -m tidas_tools\n",
  );
  try {
    const report = auditTidasCutover();
    assert.equal(report.status, "passed", JSON.stringify(report.findings, null, 2));
    assert.equal(report.active_files_scanned, baseline.active_files_scanned);
  } finally {
    fs.rmSync(ignoredSkillRoot, { recursive: true, force: true });
  }
});

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, "..", "..");
const oxlintEntrypoint = path.join(repoRoot, "node_modules", "oxlint", "bin", "oxlint");

type OxlintDiagnostic = {
  code: string;
  filename: string;
  message: string;
};

type OxlintReport = {
  diagnostics: OxlintDiagnostic[];
  number_of_files: number;
};

const sourceRowTargets = [
  "scripts/lib/source-semantics.ts",
  "scripts/lib/tidas-row-utils.ts",
  "test/unit/source-semantics-contract.test.mts",
  "test/unit/tidas-row-utils.test.mts",
] as const;

test("source and TIDAS row boundaries contain no explicit TypeScript any nodes", () => {
  const result = spawnSync(
    process.execPath,
    [
      oxlintEntrypoint,
      "-A",
      "all",
      "-D",
      "typescript/no-explicit-any",
      "--format",
      "json",
      ...sourceRowTargets,
    ],
    {
      cwd: repoRoot,
      encoding: "utf8",
    },
  );

  assert.equal(result.error, undefined);
  const report = JSON.parse(result.stdout) as OxlintReport;
  const explicitAnyDiagnostics = report.diagnostics.filter(
    (diagnostic) => diagnostic.code === "typescript(no-explicit-any)",
  );

  assert.equal(report.number_of_files, sourceRowTargets.length);
  assert.equal(
    explicitAnyDiagnostics.length,
    0,
    explicitAnyDiagnostics
      .map((diagnostic) => `${diagnostic.filename}: ${diagnostic.message} [${diagnostic.code}]`)
      .join("\n"),
  );
  assert.equal(result.status, 0);
});

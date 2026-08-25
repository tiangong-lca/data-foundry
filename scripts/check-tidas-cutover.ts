import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const historicalDocs = new Set([
  "docs/import-profiles/bafu/bafu-endgame-goal.md",
  "docs/import-profiles/hiq/hiq-import-governance-proposal.md",
  "docs/import-profiles/hiq/hiq-issue-03-source-data-labeling-and-normalization.md",
  "docs/import-profiles/worldsteel/import-plan.md",
  "docs/runner-improvements-from-bafu-cleanup.md",
  "docs/uslci-import-plan.md",
  "docs/uslci-import-runbook.md",
  "inputs/source-packages/uslci-database-public.md",
]);

const forbidden = [
  /TIANGONG_LCA_TIDAS_SDK_DIR/u,
  /TIANGONG_TIDAS_TOOLS_EXECUTABLE/u,
  /tidas-release-tool/u,
  /dataset\s+import-lca/u,
  /--tidas-tools-dir/u,
  /src\/tidas_tools/u,
  /python(?:3)?\s+-m\s+tidas_tools/u,
];

export type TidasCutoverFinding = {
  file: string;
  line: number;
  pattern: string;
};

export type TidasCutoverAuditReport = {
  schema_version: 1;
  status: "passed" | "failed";
  active_files_scanned: number;
  historical_documents_excluded: string[];
  forbidden_patterns: string[];
  findings: TidasCutoverFinding[];
};

function trackedAuthoritativeFiles(): string[] {
  const result = spawnSync(
    "git",
    [
      "-C",
      repoRoot,
      "ls-files",
      "--cached",
      "--others",
      "--exclude-standard",
      "-z",
      "--",
      "AGENTS.md",
      "README.md",
      "WORKFLOW.md",
      ".env.example",
      ".agents/skills",
      "docs",
      "specs",
      "scripts",
    ],
    { encoding: "utf8" },
  );
  if (result.error || result.status !== 0) {
    throw new Error(
      `Unable to enumerate tracked Foundry cutover surfaces: ${result.error?.message || result.stderr || `git exited ${result.status}`}`,
    );
  }
  return result.stdout
    .split("\0")
    .filter(Boolean)
    .filter((file) => fs.existsSync(path.join(repoRoot, file)));
}

export function auditTidasCutover(): TidasCutoverAuditReport {
  const files = trackedAuthoritativeFiles().filter(
    (file) =>
      !historicalDocs.has(file) &&
      file !== "scripts/check-tidas-cutover.ts" &&
      !file.startsWith("reports/") &&
      /\.(?:js|json|md|mjs|ya?ml)$/u.test(file),
  );
  const findings: TidasCutoverFinding[] = [];
  for (const file of files) {
    const lines = fs.readFileSync(path.join(repoRoot, file), "utf8").split(/\r?\n/u);
    lines.forEach((line, index) => {
      for (const pattern of forbidden) {
        if (pattern.test(line)) {
          findings.push({
            file,
            line: index + 1,
            pattern: pattern.source,
          });
        }
      }
    });
  }
  return {
    schema_version: 1,
    status: findings.length === 0 ? "passed" : "failed",
    active_files_scanned: files.length,
    historical_documents_excluded: [...historicalDocs].sort(),
    forbidden_patterns: forbidden.map((pattern) => pattern.source),
    findings,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report = auditTidasCutover();
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (report.status !== "passed") process.exitCode = 1;
}

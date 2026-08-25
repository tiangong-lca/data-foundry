import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const defaultRepoRoot = path.resolve(path.dirname(scriptPath), "..");
const nativeDisableToken = "oxlint-disable";
const forbiddenCommentMarker = "foundry-forbidden-oxlint-disable";
const typeScriptPathPattern = /\.(?:cts|mts|ts|tsx)$/u;
const unixDiagnosticPattern = /^(.*):(\d+):(\d+): .*\[Error\/eslint\(no-warning-comments\)\]$/u;

export type LintSuppressionFinding = {
  path: string;
  line: number;
  column: number;
};

export type LintSuppressionAudit = {
  scanned: number;
  findings: LintSuppressionFinding[];
};

type LintSuppressionAuditOptions = {
  repoRoot?: string;
  oxlintPath?: string;
};

function portablePath(filePath: string): string {
  return filePath.split(path.sep).join(path.posix.sep);
}

function gitVisibleTypeScriptFiles(repoRoot: string): string[] {
  return execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], {
    cwd: repoRoot,
    encoding: "utf8",
  })
    .split("\0")
    .filter((file) => Boolean(file) && typeScriptPathPattern.test(file))
    .filter((file) => fs.existsSync(path.join(repoRoot, file)))
    .map(portablePath)
    .sort();
}

function writeAuditConfig(configPath: string): void {
  fs.writeFileSync(
    configPath,
    `${JSON.stringify(
      {
        categories: {
          correctness: "off",
          suspicious: "off",
          pedantic: "off",
          perf: "off",
          style: "off",
          restriction: "off",
          nursery: "off",
        },
        rules: {
          "eslint/no-warning-comments": [
            "error",
            {
              terms: [forbiddenCommentMarker],
              location: "start",
            },
          ],
        },
      },
      null,
      2,
    )}\n`,
  );
}

function normalizeDiagnosticPath(sourceRoot: string, filePath: string): string {
  const relativePath = path.isAbsolute(filePath) ? path.relative(sourceRoot, filePath) : filePath;
  return portablePath(relativePath).replace(/^\.\//u, "");
}

function parseFindings(output: string, sourceRoot: string): LintSuppressionFinding[] {
  const findings: LintSuppressionFinding[] = [];
  const unexpected: string[] = [];
  for (const line of output
    .split(/\r?\n/u)
    .map((value) => value.trim())
    .filter(Boolean)) {
    if (/^\d+ problems?(?: \(.*\))?$/u.test(line)) continue;
    const match = line.match(unixDiagnosticPattern);
    if (!match) {
      unexpected.push(line);
      continue;
    }
    findings.push({
      path: normalizeDiagnosticPath(sourceRoot, match[1]),
      line: Number.parseInt(match[2], 10),
      column: Number.parseInt(match[3], 10),
    });
  }
  if (unexpected.length > 0) {
    throw new Error(
      `Lint suppression audit received unexpected Oxlint output:\n${unexpected.join("\n")}`,
    );
  }
  return findings.sort(
    (left, right) =>
      left.path.localeCompare(right.path) || left.line - right.line || left.column - right.column,
  );
}

export function auditTrackedTypeScriptSuppressions({
  repoRoot = defaultRepoRoot,
  oxlintPath = path.join(repoRoot, "node_modules", "oxlint", "bin", "oxlint"),
}: LintSuppressionAuditOptions = {}): LintSuppressionAudit {
  const resolvedRoot = path.resolve(repoRoot);
  const files = gitVisibleTypeScriptFiles(resolvedRoot);
  const candidates = files.filter((file) =>
    fs.readFileSync(path.join(resolvedRoot, file), "utf8").includes(nativeDisableToken),
  );
  if (candidates.length === 0) return { scanned: files.length, findings: [] };

  const auditRoot = fs.mkdtempSync(path.join(os.tmpdir(), "foundry-lint-suppressions-"));
  const sourceRoot = path.join(auditRoot, "source");
  const configPath = path.join(auditRoot, "oxlint.json");
  try {
    writeAuditConfig(configPath);
    for (const file of candidates) {
      const sourcePath = path.join(resolvedRoot, file);
      const auditPath = path.join(sourceRoot, ...file.split("/"));
      fs.mkdirSync(path.dirname(auditPath), { recursive: true });
      fs.writeFileSync(
        auditPath,
        fs.readFileSync(sourcePath, "utf8").replaceAll(nativeDisableToken, forbiddenCommentMarker),
      );
    }

    const result = spawnSync(
      process.execPath,
      [
        path.resolve(oxlintPath),
        "--disable-nested-config",
        "--no-ignore",
        "-c",
        configPath,
        "--format=unix",
        ".",
      ],
      { cwd: sourceRoot, encoding: "utf8" },
    );
    if (result.error) throw result.error;
    if (result.status !== 0 && result.status !== 1) {
      throw new Error(
        `Lint suppression audit could not run Oxlint (exit ${String(result.status)}):\n${result.stderr || result.stdout}`,
      );
    }
    const findings = parseFindings(`${result.stdout}\n${result.stderr}`, sourceRoot);
    if (result.status === 1 && findings.length === 0) {
      throw new Error("Lint suppression audit failed without a recognized directive diagnostic.");
    }
    return { scanned: files.length, findings };
  } finally {
    fs.rmSync(auditRoot, { recursive: true, force: true });
  }
}

function runCli(): void {
  const report = auditTrackedTypeScriptSuppressions();
  if (report.findings.length === 0) {
    console.log(`Lint suppression audit passed (${report.scanned} TypeScript files scanned).`);
    return;
  }
  for (const finding of report.findings) {
    console.error(
      `${finding.path}:${finding.line}:${finding.column}: forbidden native Oxlint disable directive`,
    );
  }
  process.exitCode = 1;
}

if (import.meta.main) {
  runCli();
}

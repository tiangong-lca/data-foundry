import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { auditTrackedTypeScriptSuppressions } from "../../scripts/check-lint-suppressions.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const oxlintPath = path.join(repoRoot, "node_modules", "oxlint", "bin", "oxlint");
const parentGitDirectory = execFileSync("git", ["rev-parse", "--absolute-git-dir"], {
  cwd: repoRoot,
  encoding: "utf8",
}).trim();
const gitLocalEnvironmentVariables = execFileSync("git", ["rev-parse", "--local-env-vars"], {
  cwd: repoRoot,
  encoding: "utf8",
})
  .split(/\r?\n/u)
  .filter(Boolean);

function isolatedGitOptions(cwd: string): { cwd: string; env: NodeJS.ProcessEnv } {
  const env = { ...process.env };
  for (const key of gitLocalEnvironmentVariables) delete env[key];
  return { cwd, env };
}

function writeFixtureFile(root: string, relativePath: string, contents: string): void {
  const absolutePath = path.join(root, ...relativePath.split("/"));
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, contents);
}

test("tracked TypeScript suppression audit catches native directives without raw-token false positives", () => {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "foundry-lint-suppression-audit-"));
  try {
    execFileSync("git", ["init", "--quiet"], isolatedGitOptions(fixtureRoot));
    writeFixtureFile(
      fixtureRoot,
      "src/directives.ts",
      [
        "// oxlint-disable-next-line typescript/no-explicit-any",
        "export const first: unknown = 1;",
        "/* oxlint-disable typescript/no-explicit-any */",
        "export const second: unknown = 2;",
        "export const third: unknown = 3; // oxlint-disable-line typescript/no-explicit-any",
        "",
      ].join("\n"),
    );
    writeFixtureFile(
      fixtureRoot,
      "src/raw-tokens.ts",
      [
        "// oxlint-disablement is not a directive.",
        "// This policy sentence mentions oxlint-disable but is not a directive.",
        'export const line = "// oxlint-disable-next-line typescript/no-explicit-any";',
        "export const block = '/* oxlint-disable typescript/no-explicit-any */';",
        "export const template = `// oxlint-disable-line typescript/no-explicit-any`;",
        "export const pattern = /\\/\\/ oxlint-disable-next-line/u;",
        "",
      ].join("\n"),
    );
    writeFixtureFile(
      fixtureRoot,
      "src/directive.tsx",
      [
        "// oxlint-disable-next-line typescript/no-explicit-any",
        "export const unsupportedTsx: unknown = 4;",
        "",
      ].join("\n"),
    );
    writeFixtureFile(
      fixtureRoot,
      "notes.md",
      "// oxlint-disable-next-line typescript/no-explicit-any\n",
    );
    execFileSync(
      "git",
      ["add", "src/directives.ts", "src/directive.tsx", "src/raw-tokens.ts", "notes.md"],
      isolatedGitOptions(fixtureRoot),
    );

    const previousGitDirectory = process.env.GIT_DIR;
    const previousGitWorkTree = process.env.GIT_WORK_TREE;
    try {
      process.env.GIT_DIR = parentGitDirectory;
      process.env.GIT_WORK_TREE = repoRoot;
      assert.deepEqual(auditTrackedTypeScriptSuppressions({ repoRoot: fixtureRoot, oxlintPath }), {
        scanned: 3,
        findings: [
          { path: "src/directive.tsx", line: 1, column: 1 },
          { path: "src/directives.ts", line: 1, column: 1 },
          { path: "src/directives.ts", line: 3, column: 1 },
          { path: "src/directives.ts", line: 5, column: 34 },
        ],
      });
    } finally {
      if (previousGitDirectory === undefined) delete process.env.GIT_DIR;
      else process.env.GIT_DIR = previousGitDirectory;
      if (previousGitWorkTree === undefined) delete process.env.GIT_WORK_TREE;
      else process.env.GIT_WORK_TREE = previousGitWorkTree;
    }
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

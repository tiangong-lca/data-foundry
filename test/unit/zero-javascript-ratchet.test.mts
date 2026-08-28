import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { auditTrackedTypeScriptSuppressions } from "../../scripts/check-lint-suppressions.ts";

// Explicit TypeScript AnyKeyword closures are enforced by Oxlint; this suite remains the
// permanent boundary against reintroducing first-party JavaScript compatibility paths.
// Issue #68's Worldsteel profile-truth contract is native .mts and adds no compatibility path.
// Issue #69's strict datetime cleanup and fail-closed scenarios remain native TypeScript too.
// Issue #70's orchestration stages and post-write handoff cases remain native TypeScript.
// Issue #77's identity-equivalence RED/GREEN cases remain native TypeScript too.
// Issue #79's category-map closure and nonzero-exit cases remain native TypeScript too.
// Issue #81's strict no-replay handoff recovery and helper leaves remain native TypeScript too.
// Issue #82 keeps the pnpm 11.24 package-manager edge exact and adds no compatibility runner.

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

function trackedTypeScriptFiles(): string[] {
  return trackedFiles().filter((file) => /\.(?:cts|mts|ts|tsx)$/u.test(file));
}

function normalizeListedPath(file: string): string {
  const relative = path.isAbsolute(file) ? path.relative(repoRoot, file) : file;
  return relative.replaceAll("\\", "/").replace(/^\.\//u, "");
}

test("tracked first-party source and tests have a permanent zero-JavaScript ratchet", () => {
  assert.deepEqual(
    trackedFiles().filter((file) => /\.(?:cjs|js|jsx|mjs)$/u.test(file)),
    [],
  );
  assert.deepEqual(
    trackedFiles().filter((file) => /\.tsx$/u.test(file)),
    [],
    "Foundry is a non-JSX Node runtime; tracked TSX is unsupported",
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
  assert.deepEqual(typecheckConfig.include, [
    "prettier.config.ts",
    "scripts/**/*.ts",
    "scripts/**/*.mts",
    "scripts/**/*.cts",
    "test/**/*.ts",
    "test/**/*.mts",
    "test/**/*.cts",
  ]);

  const packageJson = JSON.parse(readRepoFile("package.json")) as {
    packageManager?: string;
    engines?: Record<string, string>;
    scripts?: Record<string, string>;
    "lint-staged"?: Record<string, string | string[]>;
  };
  assert.equal(packageJson.packageManager, "pnpm@11.24.0");
  assert.equal(packageJson.engines?.pnpm, "11.24.0");
  assert.equal(packageJson.scripts?.test, 'node --test "test/**/*.test.mts"');
  assert.equal(packageJson.scripts?.["test:unit"], 'node --test "test/unit/*.test.mts"');
  assert.equal(packageJson.scripts?.["test:commands"], 'node --test "test/commands/*.test.mts"');
  assert.equal(packageJson.scripts?.["test:scenarios"], 'node --test "test/scenarios/*.test.mts"');
  assert.equal(
    packageJson.scripts?.["lint:suppressions"],
    "node scripts/check-lint-suppressions.ts",
  );
  assert.match(packageJson.scripts?.lint ?? "", /^pnpm lint:suppressions\s+&&/u);
  assert.match(packageJson.scripts?.["lint:oxlint"] ?? "", /\s\.\s*$/u);
  assert.match(packageJson.scripts?.["lint:oxlint"] ?? "", /--disable-nested-config/u);
  assert.doesNotMatch(packageJson.scripts?.["lint:oxlint"] ?? "", /\.\/scripts\s+\.\/test/u);
  for (const [pattern, commandValue] of Object.entries(packageJson["lint-staged"] ?? {})) {
    assert.doesNotMatch(pattern, /(?:^|[,{}])(?:c?js|jsx|mjs)(?:[,{}]|$)/u);
    const commands = Array.isArray(commandValue) ? commandValue : [commandValue];
    for (const command of commands.filter((value) => /\boxlint\b/u.test(value))) {
      assert.match(command, /--disable-nested-config/u, pattern);
    }
  }
});

test("every tracked TypeScript file is in the repository lint and typecheck graphs", () => {
  const tracked = trackedTypeScriptFiles();
  assert.ok(tracked.length > 0, "tracked TypeScript inventory must be non-empty");
  assert.equal(normalizeListedPath(".\\scripts\\portable.ts"), "scripts/portable.ts");

  const oxlint = path.join(repoRoot, "node_modules", "oxlint", "bin", "oxlint");
  const lintFilesResult = spawnSync(
    process.execPath,
    [
      oxlint,
      "--disable-nested-config",
      "-c",
      path.join(repoRoot, ".oxlintrc.json"),
      "--debug=files",
      ".",
    ],
    { cwd: repoRoot, encoding: "utf8" },
  );
  assert.equal(lintFilesResult.status, 0, lintFilesResult.stderr || lintFilesResult.stdout);
  const linted = new Set(
    lintFilesResult.stdout.split(/\r?\n/u).filter(Boolean).map(normalizeListedPath),
  );
  assert.deepEqual(
    tracked.filter((file) => !linted.has(file)),
    [],
    "tracked TypeScript files missing from the Oxlint graph",
  );

  const tsc = path.join(repoRoot, "node_modules", "typescript", "bin", "tsc");
  const typecheckFilesResult = spawnSync(
    process.execPath,
    [tsc, "-p", path.join(repoRoot, "tsconfig.json"), "--listFilesOnly"],
    { cwd: repoRoot, encoding: "utf8" },
  );
  assert.equal(
    typecheckFilesResult.status,
    0,
    typecheckFilesResult.stderr || typecheckFilesResult.stdout,
  );
  const typechecked = new Set(
    typecheckFilesResult.stdout.split(/\r?\n/u).filter(Boolean).map(normalizeListedPath),
  );
  assert.deepEqual(
    tracked.filter((file) => !typechecked.has(file)),
    [],
    "tracked TypeScript files missing from the TypeScript graph",
  );
});

test("root Oxlint policy wins over nested configuration and nested configs stay untracked", () => {
  assert.deepEqual(
    trackedFiles().filter(
      (file) =>
        file !== ".oxlintrc.json" &&
        /(?:^|\/)(?:\.oxlintrc\.(?:json|jsonc)|oxlint\.config\.(?:[cm]?[jt]s))$/u.test(file),
    ),
    [],
  );

  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "foundry-nested-oxlint-config-"));
  try {
    fs.mkdirSync(path.join(fixtureRoot, "nested"), { recursive: true });
    fs.writeFileSync(
      path.join(fixtureRoot, ".oxlintrc.json"),
      JSON.stringify({
        plugins: ["typescript"],
        rules: { "typescript/no-explicit-any": "error" },
      }),
    );
    fs.writeFileSync(
      path.join(fixtureRoot, "nested", ".oxlintrc.json"),
      JSON.stringify({ rules: { "typescript/no-explicit-any": "off" } }),
    );
    fs.writeFileSync(
      path.join(fixtureRoot, "nested", "controlled.ts"),
      "export const controlled: any = 1;\n",
    );

    const oxlint = path.join(repoRoot, "node_modules", "oxlint", "bin", "oxlint");
    const bypassed = spawnSync(process.execPath, [oxlint, "--format=json", "nested"], {
      cwd: fixtureRoot,
      encoding: "utf8",
    });
    assert.equal(bypassed.status, 0, bypassed.stderr || bypassed.stdout);

    const protectedResult = spawnSync(
      process.execPath,
      [oxlint, "--disable-nested-config", "--format=json", "nested"],
      { cwd: fixtureRoot, encoding: "utf8" },
    );
    assert.equal(protectedResult.status, 1, protectedResult.stderr || protectedResult.stdout);
    assert.match(
      `${protectedResult.stdout}\n${protectedResult.stderr}`,
      /typescript\(no-explicit-any\)/u,
    );
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("suppression inventory cannot inherit a Git hook repository or index", () => {
  const auditSource = readRepoFile("scripts/check-lint-suppressions.ts");
  assert.match(auditSource, /repositoryScopedGitEnvironment/u);
  for (const key of ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_OBJECT_DIRECTORY"]) {
    assert.match(auditSource, new RegExp(`"${key}"`, "u"), key);
  }
  const fixtureSource = readRepoFile("test/unit/lint-suppression-audit.test.mts");
  assert.match(fixtureSource, /isolatedGitOptions/u);
  assert.match(fixtureSource, /process\.env\.GIT_DIR = parentGitDirectory/u);
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

test("focused explicit-any contracts use the installed Oxlint AST rule", () => {
  for (const relativePath of [
    "test/unit/source-row-explicit-any-contract.test.mts",
    "test/unit/identity-rewrite-explicit-any-contract.test.mts",
  ]) {
    const source = readRepoFile(relativePath);
    assert.match(source, /typescript\/no-explicit-any/u, relativePath);
    assert.match(source, /"node_modules", "oxlint", "bin", "oxlint"/u, relativePath);
    assert.match(source, /process\.execPath/u, relativePath);
    assert.doesNotMatch(source, /from\s+["']typescript["']/u, relativePath);
  }
});

test("Oxlint permanently rejects explicit any across the complete TypeScript graph", () => {
  const configPath = path.join(repoRoot, ".oxlintrc.json");
  const config = JSON.parse(fs.readFileSync(configPath, "utf8")) as {
    options?: { respectEslintDisableDirectives?: boolean };
    rules?: Record<string, unknown>;
    overrides?: Array<{ rules?: Record<string, unknown> }>;
  };
  assert.equal(config.options?.respectEslintDisableDirectives, false);
  assert.equal(config.rules?.["typescript/no-explicit-any"], "error");
  assert.deepEqual(config.rules?.["typescript/ban-ts-comment"], [
    "error",
    {
      "ts-expect-error": true,
      "ts-ignore": true,
      "ts-nocheck": true,
      "ts-check": false,
    },
  ]);
  for (const rule of ["typescript/no-explicit-any", "typescript/ban-ts-comment"]) {
    assert.equal(
      (config.overrides ?? []).some((override) => override.rules?.[rule] !== undefined),
      false,
      `${rule} must have no target-specific override`,
    );
  }
  assert.deepEqual(auditTrackedTypeScriptSuppressions({ repoRoot }), {
    scanned: trackedTypeScriptFiles().length,
    findings: [],
  });

  const oxlint = path.join(repoRoot, "node_modules", "oxlint", "bin", "oxlint");
  const printedResult = spawnSync(process.execPath, [oxlint, "--print-config", "-c", configPath], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  assert.equal(printedResult.status, 0, printedResult.stderr || printedResult.stdout);
  const printed = JSON.parse(printedResult.stdout) as {
    options?: { respectEslintDisableDirectives?: boolean };
    rules?: Record<string, unknown>;
    overrides?: Array<{ rules?: Record<string, unknown> | null }>;
  };
  assert.equal(printed.options?.respectEslintDisableDirectives, false);
  assert.equal(printed.rules?.["typescript/no-explicit-any"], "deny");
  for (const rule of ["typescript/no-explicit-any", "typescript/ban-ts-comment"]) {
    assert.equal(
      (printed.overrides ?? []).some((override) => override.rules?.[rule] !== undefined),
      false,
      `${rule} must have no effective target-specific override`,
    );
  }

  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "foundry-explicit-any-ratchet-"));
  try {
    const fixturePath = path.join(fixtureRoot, "controlled-explicit-any.ts");
    fs.writeFileSync(
      fixturePath,
      [
        "// eslint-disable-next-line typescript/no-explicit-any",
        "export const controlled: any = 1;",
        "",
      ].join("\n"),
    );
    const lintResult = spawnSync(
      process.execPath,
      [oxlint, "-c", configPath, "--format", "json", fixturePath],
      { cwd: repoRoot, encoding: "utf8" },
    );
    assert.equal(lintResult.status, 1, lintResult.stderr || lintResult.stdout);
    assert.match(`${lintResult.stdout}\n${lintResult.stderr}`, /typescript\(no-explicit-any\)/u);
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("TypeScript suppression comments cannot bypass erasable-only Node syntax", () => {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "foundry-erasable-suppression-"));
  const tsc = path.join(repoRoot, "node_modules", "typescript", "bin", "tsc");
  const oxlint = path.join(repoRoot, "node_modules", "oxlint", "bin", "oxlint");
  try {
    for (const directive of ["ts-nocheck", "ts-ignore", "ts-expect-error"]) {
      const fixturePath = path.join(fixtureRoot, `${directive}.ts`);
      fs.writeFileSync(
        fixturePath,
        [`// @${directive}`, "enum RuntimeEnum { A }", "export { RuntimeEnum };", ""].join("\n"),
      );
      const suppressedCompiler = spawnSync(
        process.execPath,
        [
          tsc,
          fixturePath,
          "--ignoreConfig",
          "--noEmit",
          "--erasableSyntaxOnly",
          "--target",
          "ES2024",
          "--module",
          "NodeNext",
          "--moduleResolution",
          "NodeNext",
          "--skipLibCheck",
        ],
        { cwd: repoRoot, encoding: "utf8" },
      );
      assert.equal(
        suppressedCompiler.status,
        0,
        `${directive} must characterize the compiler suppression risk`,
      );

      const lintResult = spawnSync(
        process.execPath,
        [
          oxlint,
          "--disable-nested-config",
          "-c",
          path.join(repoRoot, ".oxlintrc.json"),
          "--format=json",
          fixturePath,
        ],
        { cwd: repoRoot, encoding: "utf8" },
      );
      assert.equal(lintResult.status, 1, lintResult.stderr || lintResult.stdout);
      assert.match(`${lintResult.stdout}\n${lintResult.stderr}`, /typescript\(ban-ts-comment\)/u);
    }
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

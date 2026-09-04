import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { commandMetadata } from "../../scripts/lib/foundry-command-metadata.ts";
import { knownCommands } from "../../scripts/lib/foundry-command-registry.ts";
import { resolveFoundryRuntimePaths } from "../../scripts/lib/foundry-runtime-paths.ts";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, "..", "..");
const entryPath = path.join(repoRoot, "scripts", "foundry.ts");
const legacyEntryPath = path.join(repoRoot, "scripts", "foundry.mjs");
const cliPath = path.join(repoRoot, "scripts", "lib", "foundry-cli.ts");
const legacyCliPath = path.join(repoRoot, "scripts", "lib", "foundry-cli.mjs");
const helpBytes = 4961;
const helpSha256 = "502efaffe1f2b5b549eae7e5534744398567a79f72d99ab179245f4a314f59e0";
const unknownBytes = 1929;
const unknownSha256 = "9373e1138674de51c53b842e66ca58d60b985585dc82f1c6ba48793e1a09c6ba";

function readRepoFile(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function runEntry(
  entry: string,
  args: string[],
  cwd = repoRoot,
): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [entry, ...args], {
    cwd,
    encoding: "utf8",
    env: process.env,
  });
  return { status: result.status, stdout: String(result.stdout), stderr: String(result.stderr) };
}

function walkFiles(relativeDirectory: string): string[] {
  const absoluteDirectory = path.join(repoRoot, relativeDirectory);
  if (!fs.existsSync(absoluteDirectory)) return [];
  return fs.readdirSync(absoluteDirectory, { withFileTypes: true }).flatMap((entry) => {
    const relativePath = path.posix.join(relativeDirectory, entry.name);
    return entry.isDirectory() ? walkFiles(relativePath) : entry.isFile() ? [relativePath] : [];
  });
}

function runtimeImportClosure(relativeEntry: string): string[] {
  const pending = [relativeEntry];
  const visited = new Set<string>();
  while (pending.length > 0) {
    const relativePath = pending.pop()!;
    if (visited.has(relativePath)) continue;
    visited.add(relativePath);
    const source = readRepoFile(relativePath);
    for (const match of source.matchAll(
      /(?:\bfrom\s+|\bimport\s*(?:\(\s*)?)["'](\.[^"']+)["']/gu,
    )) {
      const importedPath = path.resolve(repoRoot, path.dirname(relativePath), match[1]);
      if (!fs.existsSync(importedPath) || !fs.statSync(importedPath).isFile()) continue;
      const importedRelativePath = path.relative(repoRoot, importedPath).split(path.sep).join("/");
      if (importedRelativePath.startsWith("scripts/") && /\.[cm]?ts$/u.test(importedRelativePath)) {
        pending.push(importedRelativePath);
      }
    }
  }
  return [...visited].sort();
}

function historicalDocument(relativePath: string): boolean {
  if (!relativePath.endsWith(".md")) return false;
  return /^status:\s*historical\s*$/imu.test(
    readRepoFile(relativePath).split(/\r?\n/u).slice(0, 40).join("\n"),
  );
}

function assertHelpAndUnknown(entry: string, cwd = repoRoot): void {
  const help = runEntry(entry, ["help"], cwd);
  assert.equal(help.status, 0, help.stderr || help.stdout);
  assert.equal(help.stderr, "");
  assert.equal(Buffer.byteLength(help.stdout), helpBytes);
  assert.equal(sha256(help.stdout), helpSha256);
  const parsed = JSON.parse(help.stdout) as { commands?: unknown[] };
  assert.equal(parsed.commands?.length, 63);

  for (const aliasArgs of [[], ["--help"], ["-h"]]) {
    const alias = runEntry(entry, aliasArgs, cwd);
    assert.equal(alias.status, 0, alias.stderr || alias.stdout);
    assert.equal(alias.stdout, help.stdout);
    assert.equal(alias.stderr, "");
  }

  const unknown = runEntry(entry, ["definitely-unknown"], cwd);
  assert.equal(unknown.status, 2);
  assert.equal(unknown.stdout, "");
  assert.equal(Buffer.byteLength(unknown.stderr), unknownBytes);
  assert.equal(sha256(unknown.stderr), unknownSha256);
}

function assertProfilesList(entry: string, cwd: string): string {
  const result = runEntry(entry, ["profiles-list"], cwd);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(result.stderr, "");
  const parsed = JSON.parse(result.stdout) as {
    default_profile?: unknown;
    profiles?: Record<string, unknown>;
  };
  assert.equal(parsed.default_profile, "generic");
  assert.deepEqual(Object.keys(parsed.profiles ?? {}), ["generic", "bafu", "uslci", "worldsteel"]);
  return result.stdout;
}

test("Foundry entry closure exists atomically only as zero-escape native TypeScript", async () => {
  assert.equal(fs.existsSync(entryPath), true);
  assert.equal(fs.existsSync(cliPath), true);
  assert.equal(fs.existsSync(legacyEntryPath), false);
  assert.equal(fs.existsSync(legacyCliPath), false);

  for (const filePath of [entryPath, cliPath]) {
    const source = fs.readFileSync(filePath, "utf8");
    assert.doesNotMatch(source, /\bas\s+any\b|:\s*any\b|\bany\s*\[\]|<\s*any\b|,\s*any\s*>/u);
    assert.doesNotMatch(source, /@ts-(?:no)?check|@ts-ignore|@ts-expect-error/u);
  }

  const cliModule = (await import(pathToFileURL(cliPath).href)) as Record<string, unknown>;
  assert.deepEqual(Object.keys(cliModule), ["createFoundryCommandDispatcher", "runFoundryCli"]);
});

test("runtime path resolution rejects unsupported entry mirrors", () => {
  assert.throws(
    () =>
      resolveFoundryRuntimePaths(
        pathToFileURL(path.join(repoRoot, "scripts", "lib", "unsupported-runtime.mjs")).href,
      ),
    /Unsupported Foundry runtime module extension '\.mjs'/u,
  );
});

test("entry composition preserves all typed owners, registry metadata, and production case wiring", () => {
  assert.equal(knownCommands.length, 63);
  assert.deepEqual(
    knownCommands.filter((command) => !commandMetadata[command]),
    [],
  );

  const entrySource = fs.readFileSync(entryPath, "utf8");
  const cliSource = fs.readFileSync(cliPath, "utf8");
  assert.match(entrySource, /from "\.\/lib\/foundry-cli\.ts"/u);
  for (const owner of [
    "authoring-plan",
    "bafu-auto-authoring",
    "bafu-batch-import-run",
    "bafu-leaf-classification-tasks",
    "bafu-process-scope-e2e",
    "bundle-sample-rows",
    "cli-wrappers",
    "core",
    "execution-capsule",
    "identity-preflight-run",
    "incremental-change-set",
    "library-scope-workflow",
    "post-authoring-finalize",
    "topology-convergence",
  ]) {
    assert.match(entrySource, new RegExp(`from "\\./commands/${owner}\\.ts"`, "u"), owner);
  }
  assert.match(cliSource, /from "\.\.\/commands\/classification-decisions\.ts"/u);
  assert.match(cliSource, /from "\.\.\/commands\/location-decisions\.ts"/u);
  for (const command of knownCommands) {
    const escaped = command.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    assert.match(cliSource, new RegExp(`(?:"${escaped}"|\\b${escaped})\\s*:`, "u"), command);
  }
  assert.match(entrySource, /runFoundryCli\(\{/u);

  const packageJson = JSON.parse(readRepoFile("package.json")) as {
    scripts?: Record<string, string>;
  };
  assert.equal(
    packageJson.scripts?.["case:production:contact-draft"],
    "pnpm build && node dist/scripts/cases/production-contact-draft.js",
  );
  for (const [name, command] of Object.entries(packageJson.scripts ?? {})) {
    assert.doesNotMatch(command, /scripts\/foundry\.mjs/u, name);
  }
  assert.equal(packageJson.scripts?.foundry, "node scripts/foundry.ts");
});

test("Node 24 source and emitted entries preserve repository-backed commands and nested entry identity", async () => {
  const fixtureRoot = path.join(repoRoot, "tmp", `foundry-entry-runtime-${process.pid}`);
  const buildRoot = path.join(fixtureRoot, "dist");
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
  try {
    fs.mkdirSync(path.join(fixtureRoot, "specs"), { recursive: true });
    fs.copyFileSync(path.join(repoRoot, "package.json"), path.join(fixtureRoot, "package.json"));
    fs.copyFileSync(
      path.join(repoRoot, "specs", "import-profiles.json"),
      path.join(fixtureRoot, "specs", "import-profiles.json"),
    );
    fs.cpSync(path.join(repoRoot, "scripts"), path.join(fixtureRoot, "scripts"), {
      recursive: true,
    });
    const executionCwd = path.join(fixtureRoot, "unrelated-working-directory");
    fs.mkdirSync(executionCwd, { recursive: true });
    assert.equal(fs.existsSync(path.join(fixtureRoot, ".env")), false);
    const sourceEntry = path.join(fixtureRoot, "scripts", "foundry.ts");
    assertHelpAndUnknown(sourceEntry, executionCwd);
    const sourceProfiles = assertProfilesList(sourceEntry, executionCwd);

    execFileSync(
      process.execPath,
      [
        path.join(repoRoot, "node_modules", "typescript", "bin", "tsc"),
        "-p",
        "tsconfig.build.json",
        "--outDir",
        buildRoot,
        "--sourceMap",
        "false",
        "--inlineSources",
        "false",
      ],
      { cwd: repoRoot, encoding: "utf8", stdio: "pipe" },
    );
    const emittedEntry = path.join(buildRoot, "scripts", "foundry.js");
    assert.equal(fs.existsSync(emittedEntry), true);
    // A copied manifest alone must not turn the emitted outDir into the trusted repository root.
    fs.writeFileSync(
      path.join(buildRoot, "package.json"),
      `${JSON.stringify({ name: "tiangong-lca-data-foundry", type: "module" })}\n`,
    );
    assert.equal(fs.existsSync(path.join(fixtureRoot, ".env")), false);
    assertHelpAndUnknown(emittedEntry, executionCwd);
    assert.equal(assertProfilesList(emittedEntry, executionCwd), sourceProfiles);

    const emittedBatchModule = (await import(
      pathToFileURL(path.join(buildRoot, "scripts", "commands", "bafu-batch-import-run.js")).href
    )) as {
      bafuBatchImportRunTestHooks?: {
        foundryCommand?: (command: string, options?: Record<string, unknown>) => string[];
      };
    };
    const foundryCommand = emittedBatchModule.bafuBatchImportRunTestHooks?.foundryCommand;
    assert.equal(typeof foundryCommand, "function");
    if (!foundryCommand) throw new Error("emitted BAFU nested command hook is unavailable");
    const nested = foundryCommand("profiles-list", { profile: "worldsteel" });
    assert.equal(nested[0], process.execPath);
    assert.equal(path.resolve(fixtureRoot, nested[1]), emittedEntry);
    assert.deepEqual(nested.slice(2), ["profiles-list", "--profile", "worldsteel"]);

    const emittedFinalizeUtilsModule = (await import(
      pathToFileURL(path.join(buildRoot, "scripts", "lib", "post-authoring-finalize-utils.js")).href
    )) as {
      postAuthoringFinalizeUtilsTestHooks?: { foundryEntryPath?: string };
    };
    const finalizeEntry =
      emittedFinalizeUtilsModule.postAuthoringFinalizeUtilsTestHooks?.foundryEntryPath;
    assert.equal(typeof finalizeEntry, "string");
    assert.equal(path.resolve(fixtureRoot, finalizeEntry!), emittedEntry);

    const emittedProcessScopeModule = (await import(
      pathToFileURL(path.join(buildRoot, "scripts", "commands", "bafu-process-scope-e2e.js")).href
    )) as {
      bafuProcessScopeE2eTestHooks?: { foundryEntryPath?: string };
    };
    const processScopeEntry =
      emittedProcessScopeModule.bafuProcessScopeE2eTestHooks?.foundryEntryPath;
    assert.equal(typeof processScopeEntry, "string");
    assert.equal(path.resolve(fixtureRoot, processScopeEntry!), emittedEntry);
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("emitted CLI runtime closure centralizes repository roots and nested entry paths", () => {
  const runtimeFiles = runtimeImportClosure("scripts/foundry.ts");
  for (const expected of [
    "scripts/commands/bafu-batch-import-run.ts",
    "scripts/commands/bafu-process-scope-e2e.ts",
    "scripts/lib/foundry-runtime-utils.ts",
  ]) {
    assert.equal(
      runtimeFiles.includes(expected),
      true,
      `${expected} must stay in the runtime scan`,
    );
  }
  const findings = runtimeFiles.flatMap((relativePath) => {
    if (relativePath === "scripts/lib/foundry-runtime-paths.ts") return [];
    const source = readRepoFile(relativePath);
    const pattern = /(?:fileURLToPath\(\s*import\.meta\.url\s*\)|import\.meta\.dirname)/u;
    return pattern.test(source) ? [{ relativePath, problem: "module_relative_repo_root" }] : [];
  });
  assert.deepEqual(findings, []);

  const nestedSelfInvocationFindings = [
    "scripts/commands/bafu-batch-import-run.ts",
    "scripts/commands/bafu-process-scope-e2e.ts",
    "scripts/lib/post-authoring-finalize-utils.ts",
  ].filter((relativePath) => /["']scripts\/foundry\.ts["']/u.test(readRepoFile(relativePath)));
  assert.deepEqual(nestedSelfInvocationFindings, []);
});

test("active entry consumers contain no retired Foundry entry path", () => {
  const files = [
    "package.json",
    "AGENTS.md",
    "README.md",
    "WORKFLOW.md",
    ...walkFiles(".agents"),
    ...walkFiles(".codex"),
    ...walkFiles(".docpact"),
    ...walkFiles("docs"),
    ...walkFiles("scripts"),
    ...walkFiles("specs"),
    ...walkFiles("test"),
  ].filter(
    (relativePath) =>
      !historicalDocument(relativePath) &&
      !relativePath.startsWith(".docpact/runs/") &&
      relativePath !== "test/unit/foundry-entry-closure-migration.test.mts" &&
      relativePath !== "test/unit/foundry-cli-spine.test.mts" &&
      /(?:^package\.json$|\.(?:[cm]?[jt]s|json|md|ya?ml|sh))$/u.test(relativePath),
  );
  const findings = files.flatMap((relativePath) => {
    const source = readRepoFile(relativePath);
    return ["scripts/foundry.mjs", "scripts/lib/foundry-cli.mjs", "foundry-cli.mjs"]
      .filter((retiredPath) => source.includes(retiredPath))
      .map((retiredPath) => ({ relativePath, retiredPath }));
  });
  assert.deepEqual(findings, []);
});

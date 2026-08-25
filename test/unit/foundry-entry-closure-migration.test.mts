import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { commandMetadata } from "../../scripts/lib/foundry-command-metadata.ts";
import { knownCommands } from "../../scripts/lib/foundry-command-registry.ts";

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
  assert.deepEqual(Object.keys(cliModule), ["runFoundryCli"]);
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

test("Node 24 source and emitted entries preserve exact help, stderr, and exit behavior", () => {
  const sourceRoot = path.join(repoRoot, "tmp", `foundry-entry-source-${process.pid}`);
  const buildRoot = path.join(repoRoot, "tmp", `foundry-entry-build-${process.pid}`);
  fs.rmSync(sourceRoot, { recursive: true, force: true });
  fs.rmSync(buildRoot, { recursive: true, force: true });
  try {
    fs.mkdirSync(sourceRoot, { recursive: true });
    fs.cpSync(path.join(repoRoot, "scripts"), path.join(sourceRoot, "scripts"), {
      recursive: true,
    });
    assert.equal(fs.existsSync(path.join(sourceRoot, ".env")), false);
    assertHelpAndUnknown(path.join(sourceRoot, "scripts", "foundry.ts"), sourceRoot);

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
    assert.equal(fs.existsSync(path.join(buildRoot, ".env")), false);
    assertHelpAndUnknown(emittedEntry, buildRoot);
  } finally {
    fs.rmSync(sourceRoot, { recursive: true, force: true });
    fs.rmSync(buildRoot, { recursive: true, force: true });
  }
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
      relativePath !== "specs/typescript-migration-inventory.json" &&
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

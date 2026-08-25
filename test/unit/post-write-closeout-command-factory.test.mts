import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createPostWriteCloseoutCommands } from "../../scripts/commands/post-write-closeout.ts";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, "..", "..");

function readRepoFile(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

function throwIfCalled(name: string): never {
  throw new Error(`help must not call ${name}`);
}

test("post-write closeout help is exact and invokes no artifact or verification dependency", () => {
  const commands = createPostWriteCloseoutCommands({
    asText: () => throwIfCalled("asText"),
    countJsonLinesFile: () => throwIfCalled("countJsonLinesFile"),
    countRowsFile: () => throwIfCalled("countRowsFile"),
    datasetIdentity: () => throwIfCalled("datasetIdentity"),
    ensureArray: () => throwIfCalled("ensureArray"),
    fileExists: () => throwIfCalled("fileExists"),
    fullContextProofCheck: () => throwIfCalled("fullContextProofCheck"),
    nowIso: () => throwIfCalled("nowIso"),
    readJsonArtifactOption: () => throwIfCalled("readJsonArtifactOption"),
    readJsonLines: () => throwIfCalled("readJsonLines"),
    readRowsFile: () => throwIfCalled("readRowsFile"),
    repoRelativeMaybe: () => throwIfCalled("repoRelativeMaybe"),
    repoRelativePath: () => throwIfCalled("repoRelativePath"),
    reportInputPath: () => throwIfCalled("reportInputPath"),
    resolveRepoPath: () => throwIfCalled("resolveRepoPath"),
    sameResolvedPath: () => throwIfCalled("sameResolvedPath"),
    validateTraceQueueCoverageForRows: () => throwIfCalled("trace coverage"),
    writeCloseoutImportLedger: () => throwIfCalled("import ledger"),
    writeJson: () => throwIfCalled("writeJson"),
  });
  assert.deepEqual(commands.runDatasetPostWriteCloseout({ help: true }), {
    schema_version: 1,
    status: "help",
    command: "dataset-post-write-closeout",
    usage: [
      "node scripts/foundry.ts dataset-post-write-closeout --handoff-plan <dataset-commit-handoff-plan.json> --commit-report <summary-or-sync-report.json> --post-write-verify-report <remote-verification-report.json> --out-dir <closeout-dir> --ledger-dir <task-import-ledger-dir>",
    ],
    purpose:
      "Close an explicit remote write only after Foundry handoff, CLI commit report, and post-write verify-root-payload evidence prove the exact same final rows were written and read back.",
    remote_write_mode: "read-only",
  });
});

test("post-write closeout keeps accepted-diff and unique-root proof in typed owner modules", () => {
  const source = readRepoFile("scripts/commands/post-write-closeout.ts");
  assert.match(
    source,
    /normalizeAllowedTraceHashDifference\s*\}\s*from\s*["']\.\.\/lib\/remote-verification-accepted-diff\.ts["']/u,
  );
  assert.match(
    source,
    /canonicalPayloadSha256,[\s\S]*validateUniqueRootReadbacks,[\s\S]*from\s*["']\.\.\/lib\/post-write-root-proof\.ts["']/u,
  );
  assert.match(source, /allowTraceHashOnlyNormalization:\s*!productionTestAccount/u);
  assert.match(source, /rootReadbackCount\s*!==\s*expectedRows/u);
  assert.match(source, /final_rows_artifact_sha256_drift/u);
  assert.doesNotMatch(source, /node:child_process|fetch\(|shell\s*:\s*true/u);
});

test("post-write closeout exists only as zero-escape native TypeScript", () => {
  const typedPath = path.join(repoRoot, "scripts/commands/post-write-closeout.ts");
  assert.equal(fs.existsSync(typedPath), true);
  assert.equal(fs.existsSync(typedPath.replace(/\.ts$/u, ".mjs")), false);
  const source = fs.readFileSync(typedPath, "utf8");
  assert.doesNotMatch(source, /\bas\s+any\b|:\s*any\b|\bany\s*\[\]|<\s*any\b|,\s*any\s*>/u);
  assert.doesNotMatch(source, /@ts-(?:no)?check|@ts-ignore/u);
});

test("post-write closeout consumers target the typed command factory", () => {
  for (const consumer of [
    "scripts/foundry.ts",
    "scripts/lib/foundry-command-metadata.ts",
    "test/unit/post-write-closeout-command-factory.test.mts",
  ]) {
    const source = readRepoFile(consumer);
    assert.match(source, /(?:commands\/|scripts\/commands\/)post-write-closeout\.ts/u);
    assert.doesNotMatch(source, /(?:commands\/|scripts\/commands\/)post-write-closeout\.mjs/u);
  }
});

test("unique-root, accepted-diff, and production closeout fixtures remain active", () => {
  for (const fixture of [
    "test/scenarios/post-write-unique-root-closeout.test.mts",
    "test/unit/post-write-root-proof.test.mts",
    "test/unit/remote-verification-accepted-diff.test.mts",
  ]) {
    assert.equal(fs.existsSync(path.join(repoRoot, fixture)), true, fixture);
  }
  const scenario = readRepoFile("test/scenarios/post-write-unique-root-closeout.test.mts");
  assert.match(scenario, /rejects duplicate root checks/u);
  assert.match(scenario, /rejects same-path final-row byte drift/u);
  assert.match(scenario, /accepts CLI canonical payload hashes/u);
  assert.match(scenario, /production-test session cannot resume an ordinary-mode handoff/u);
});

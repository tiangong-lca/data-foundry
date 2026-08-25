import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createIdentityReferenceRewriteCommands } from "../../scripts/commands/identity-reference-rewrites.mjs";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, "..", "..");

function readRepoFile(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

function createHarness() {
  const applyCalls: unknown[] = [];
  const writes: Array<{ filePath: string; value: unknown }> = [];
  const resolvedInputs: unknown[] = [];
  const commands = createIdentityReferenceRewriteCommands({
    applyIdentityReferenceRewrites(input) {
      applyCalls.push(input);
      return {
        status: "completed",
        output_rows_file: "artifacts/flows.identity-rewritten.jsonl",
        reference_rows_file: "artifacts/reference-rows.jsonl",
        rewrite_file: "artifacts/rewrites.jsonl",
        unresolved_references_file: "artifacts/unresolved.jsonl",
        counts: { rewritten: 2 },
      };
    },
    asText(value) {
      return typeof value === "string" ? value.trim() : "";
    },
    datasetRowsFileStem(datasetType) {
      return `${datasetType}s`;
    },
    fileExists(filePath) {
      return filePath === "/repo/input.jsonl";
    },
    nowIso() {
      return "2026-08-25T00:00:00.000Z";
    },
    repoRelativePath(filePath) {
      return path.relative("/repo", filePath).replaceAll("\\", "/");
    },
    resolveRepoPath(value) {
      resolvedInputs.push(value);
      if (typeof value !== "string" || value.length === 0) return null;
      return path.resolve("/repo", value);
    },
    writeJson(filePath, value) {
      writes.push({ filePath, value });
    },
  });
  return { applyCalls, commands, resolvedInputs, writes };
}

test("identity rewrite help is exact and factory construction has no effects", () => {
  const { applyCalls, commands, resolvedInputs, writes } = createHarness();
  assert.deepEqual(commands.runDatasetIdentityReferenceRewritesApply({ help: true }), {
    schema_version: 1,
    status: "help",
    command: "dataset-identity-reference-rewrites-apply",
    usage: [
      "node scripts/foundry.mjs dataset-identity-reference-rewrites-apply --type process --rows-file <processes.jsonl> --identity-preflight-index <identity-preflight-requests.jsonl> --out <rewritten-processes.jsonl>",
    ],
    purpose:
      "Apply completed identity-preflight block_duplicate flow decisions to local process exchange references before validation and write planning.",
  });
  assert.deepEqual(applyCalls, []);
  assert.deepEqual(resolvedInputs, []);
  assert.deepEqual(writes, []);
});

test("identity rewrite preserves option precedence, apply input, report aliases, and write order", () => {
  const { applyCalls, commands, resolvedInputs, writes } = createHarness();
  const options = {
    type: " FLOW ",
    datasetType: "ignored",
    rowsFile: "input.jsonl",
    input: "ignored.jsonl",
    outDir: "artifacts",
  };
  const report = commands.runDatasetIdentityReferenceRewritesApply(options);

  assert.deepEqual(resolvedInputs, [
    "input.jsonl",
    "artifacts",
    "/repo/artifacts/flows.identity-rewritten.jsonl",
  ]);
  assert.deepEqual(applyCalls, [
    {
      datasetType: "flow",
      rowsFile: "/repo/input.jsonl",
      outFile: "/repo/artifacts/flows.identity-rewritten.jsonl",
      outDir: "/repo/artifacts",
      options,
      allowMissingIndex: false,
    },
  ]);
  assert.deepEqual(report, {
    schema_version: 1,
    generated_at_utc: "2026-08-25T00:00:00.000Z",
    command: "dataset-identity-reference-rewrites-apply",
    dataset_type: "flow",
    remote_write_mode: "read-only",
    status: "completed",
    output_rows_file: "artifacts/flows.identity-rewritten.jsonl",
    reference_rows_file: "artifacts/reference-rows.jsonl",
    rewrite_file: "artifacts/rewrites.jsonl",
    unresolved_references_file: "artifacts/unresolved.jsonl",
    counts: { rewritten: 2 },
    files: {
      report: "artifacts/identity-reference-rewrites-apply-report.json",
      output_rows: "artifacts/flows.identity-rewritten.jsonl",
      reference_rows: "artifacts/reference-rows.jsonl",
      identity_reference_rewrites: "artifacts/rewrites.jsonl",
      identity_unresolved_references: "artifacts/unresolved.jsonl",
    },
  });
  assert.deepEqual(writes, [
    {
      filePath: "/repo/artifacts/identity-reference-rewrites-apply-report.json",
      value: report,
    },
  ]);
});

test("identity rewrite rejects a missing rows file before apply or report write", () => {
  const { applyCalls, commands, writes } = createHarness();
  assert.throws(
    () => commands.runDatasetIdentityReferenceRewritesApply({ rowsFile: "missing.jsonl" }),
    /--rows-file is required/u,
  );
  assert.deepEqual(applyCalls, []);
  assert.deepEqual(writes, []);
});

test("identity rewrite command factory exists only as zero-any native TypeScript", () => {
  const typedPath = path.join(repoRoot, "scripts/commands/identity-reference-rewrites.ts");
  assert.equal(fs.existsSync(typedPath), true);
  assert.equal(fs.existsSync(typedPath.replace(/\.ts$/u, ".mjs")), false);
  const source = readRepoFile("scripts/commands/identity-reference-rewrites.ts");
  assert.doesNotMatch(source, /\bany\b/u);
  assert.deepEqual(
    [...source.matchAll(/export function\s+([A-Za-z0-9_]+)/gu)].map((match) => match[1]),
    ["createIdentityReferenceRewriteCommands"],
  );
});

test("all active identity rewrite owner consumers target the typed command factory", () => {
  for (const consumer of [
    "scripts/foundry.mjs",
    "scripts/lib/foundry-command-metadata.ts",
    "test/unit/identity-reference-rewrite-command-factory.test.mts",
  ]) {
    const source = readRepoFile(consumer);
    assert.match(
      source,
      /(?:commands\/|\.\.\/\.\.\/scripts\/commands\/)identity-reference-rewrites\.ts/u,
    );
    assert.doesNotMatch(source, /commands\/identity-reference-rewrites\.mjs/u);
  }
});

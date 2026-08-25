import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, "..", "..");
const typedPath = path.join(repoRoot, "scripts/commands/post-authoring-finalize.ts");
const legacyPath = path.join(repoRoot, "scripts/commands/post-authoring-finalize.mjs");

function implementationSource(): string {
  return fs.readFileSync(fs.existsSync(typedPath) ? typedPath : legacyPath, "utf8");
}

function readRepoFile(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

test("post-authoring finalize help retains exact stage, type, and byte contract", () => {
  const result = spawnSync(
    process.execPath,
    ["scripts/foundry.ts", "dataset-post-authoring-finalize", "--help"],
    { cwd: repoRoot, encoding: null },
  );
  assert.equal(result.status, 0);
  assert.equal(result.stderr.length, 0);
  assert.equal(result.stdout.length, 5606);
  assert.equal(
    createHash("sha256").update(result.stdout).digest("hex"),
    "6919541f20242fdaedce027a9dfb4e39a53fdcad5d99317b06d194707334a0bb",
  );
  const help = JSON.parse(result.stdout.toString()) as Record<string, unknown>;
  assert.deepEqual(help.supported_types, [
    "contact",
    "source",
    "support",
    "process",
    "flow",
    "lifecyclemodel",
  ]);
  assert.equal(help.remote_write_mode, "read-only");
});

test("post-authoring finalize preserves rewrite, evidence, gate, manifest, and handoff order", () => {
  const source = implementationSource();
  const runnerSource = source.slice(source.indexOf("function runDatasetPostAuthoringFinalize"));
  const orderedStages = [
    "applyIdentityReferenceRewrites({",
    "externalizeUnresolvedProcessFlowExchanges({",
    "applySourceContactRewrites({",
    "applyCanonicalSupportRewrites({",
    "runDatasetCurationCleanup({",
    "runFinalizeIdentityPreflightStage({",
    "runFinalizeAutoCurationQueue({",
    "runTidasRowsValidation({",
    "runTiangongJsonStage(`${datasetType}_qa`",
    'runTiangongJsonStage("location_audit"',
    "runDatasetCurationGate({",
    "runTiangongJsonStage(dryRunStageName",
    "runDatasetMutationManifest({",
    "runDatasetCommitHandoffPlan({",
  ];
  let previous = -1;
  for (const token of orderedStages) {
    const index = runnerSource.indexOf(token);
    assert.ok(index > previous, token);
    previous = index;
  }
  for (const contract of [
    "source_reference_rewrites",
    "identity_reference_rewrites",
    "verifiedReferenceLedgerFiles",
    "canonical_unit_group_reference_keys",
    "source_contact_support_finalize",
    "canonical_support_blockers",
    "location_audit_blockers",
    "full_context_scope_blockers",
    "mutation_manifest_blockers",
    "commit_handoff_blockers",
    "final_rows",
    "patch_evidence",
  ]) {
    assert.match(source, new RegExp(contract, "u"));
  }
  assert.match(source, /remote_write_mode:\s*"read-only"/u);
  assert.match(source, /This command never commits rows/u);
  assert.doesNotMatch(source, /spawnSync|execSync|execFileSync|shell:\s*true/u);
});

test("post-authoring finalize owner exists only as zero-escape native TypeScript", () => {
  assert.equal(fs.existsSync(typedPath), true);
  assert.equal(fs.existsSync(legacyPath), false);
  const source = fs.readFileSync(typedPath, "utf8");
  assert.doesNotMatch(source, /\bas\s+any\b|:\s*any\b|\bany\s*\[\]|<\s*any\b|,\s*any\s*>/u);
  assert.doesNotMatch(source, /@ts-(?:no)?check|@ts-ignore/u);
  assert.deepEqual(
    [...source.matchAll(/export function\s+([A-Za-z0-9_]+)/gu)].map((match) => match[1]),
    ["createPostAuthoringFinalizeCommands"],
  );
});

test("post-authoring finalize consumers and metadata target the typed owner", () => {
  for (const consumer of ["scripts/foundry.ts", "scripts/lib/foundry-command-metadata.ts"]) {
    const source = readRepoFile(consumer);
    assert.match(
      source,
      /(?:commands\/|scripts\/commands\/)post-authoring-finalize\.ts/u,
      consumer,
    );
    assert.doesNotMatch(
      source,
      /(?:commands\/|scripts\/commands\/)post-authoring-finalize\.mjs/u,
      consumer,
    );
  }
});

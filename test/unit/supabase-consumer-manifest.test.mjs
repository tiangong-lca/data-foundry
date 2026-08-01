import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  MANIFEST_PATH,
  ManifestError,
  SCHEMA_PATH,
  assertDeliveryTreeEqual,
  assertExactOccurrenceSet,
  canonicalGithubRepository,
  readNoFollowRegular,
  verifyManifest,
} from "../../scripts/audit-supabase-consumers.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const schemaBytes = fs.readFileSync(path.join(root, SCHEMA_PATH));
const schema = JSON.parse(schemaBytes);
const baseline = JSON.parse(fs.readFileSync(path.join(root, MANIFEST_PATH), "utf8"));
const clone = (value) => structuredClone(value);

test("checked-in candidate manifest verifies from exact Git blobs", async () => {
  const result = await verifyManifest(root, baseline, schema, schemaBytes);
  assert.equal(result.sourceCommit, baseline.sourceSnapshot.sourceTreeCommit);
  assert.equal(result.digest, baseline.sourceSnapshot.filteredGitTreeSha256);
  assert.equal(result.occurrences, baseline.occurrences.length);
});

test("CLI verification command succeeds without hosted access", () => {
  const output = execFileSync(
    process.execPath,
    ["scripts/audit-supabase-consumers.mjs", "--verify"],
    {
      cwd: root,
      encoding: "utf8",
    },
  );
  assert.match(output, /verified-candidate-non-authorizing/u);
});

test("bidirectional/global exactly-once rejects omission, duplication, and derived bypass", () => {
  const rows = baseline.occurrences.slice(0, 3);
  assert.throws(() => assertExactOccurrenceSet(rows.slice(1), rows), /bidirectionally exact/u);
  assert.throws(() => assertExactOccurrenceSet([...rows, rows[0]], rows), /repeats an occurrence/u);
  assert.throws(
    () =>
      assertExactOccurrenceSet(rows, [...rows, { ...rows[0], id: "occ-000000000000000000000000" }]),
    /bidirectionally exact/u,
  );
});

test("exact verifier rejects occurrence span/hash and upstream semantic substitution", async () => {
  const span = clone(baseline);
  span.occurrences[0].span.sha256 = "0".repeat(64);
  await assert.rejects(verifyManifest(root, span, schema, schemaBytes), /bidirectionally exact/u);

  const upstream = clone(baseline);
  upstream.occurrences[0].upstream = "attacker/upstream";
  await assert.rejects(
    verifyManifest(root, upstream, schema, schemaBytes),
    /bidirectionally exact/u,
  );
});

test("exact verifier rejects source commit, canonical schema, and schema-origin drift", async () => {
  const commit = clone(baseline);
  commit.sourceSnapshot.sourceTreeCommit = "0".repeat(40);
  await assert.rejects(verifyManifest(root, commit, schema, schemaBytes), /git rev-parse/u);

  const schemaHash = clone(baseline);
  schemaHash.manifestSchema.sha256 = "0".repeat(64);
  await assert.rejects(
    verifyManifest(root, schemaHash, schema, schemaBytes),
    /canonical schema SHA drift/u,
  );

  const schemaOrigin = clone(baseline);
  schemaOrigin.$schema = "https://evil.example/manifest.schema.json";
  await assert.rejects(
    verifyManifest(root, schemaOrigin, schema, schemaBytes),
    /schema validation failed/u,
  );
});

test("candidate authority is permanently non-authorizing", async () => {
  for (const field of [
    "authorizesConsumerZero",
    "authorizesDatabaseFreeze",
    "authorizesDatabaseMigration",
    "authorizesHostedMutation",
    "authorizesProductionMutation",
  ]) {
    const manifest = clone(baseline);
    manifest.authority[field] = true;
    await assert.rejects(
      verifyManifest(root, manifest, schema, schemaBytes),
      /schema validation failed/u,
    );
  }
});

test("canonical origin parser rejects lookalike hosts and paths", () => {
  assert.equal(
    canonicalGithubRepository("git@github.com:tiangong-lca/data-foundry.git"),
    "tiangong-lca/data-foundry",
  );
  assert.throws(
    () => canonicalGithubRepository("https://evil.example/tiangong-lca/data-foundry.git"),
    /canonical github.com/u,
  );
  assert.throws(
    () => canonicalGithubRepository("https://github.com/attacker/data-foundry.git"),
    /canonical github.com/u,
  );
});

test("delivery guard rejects added, removed, changed, symlink-like and type-substituted entries", () => {
  const source = [
    { path: "scripts/runtime.mjs", mode: "100644", type: "blob", oid: "a".repeat(40) },
  ];
  assert.doesNotThrow(() => assertDeliveryTreeEqual(source, clone(source)));
  assert.throws(() => assertDeliveryTreeEqual(source, []), /governed source drifted/u);
  assert.throws(
    () => assertDeliveryTreeEqual(source, [{ ...source[0], oid: "b".repeat(40) }]),
    /governed source drifted/u,
  );
  assert.throws(
    () => assertDeliveryTreeEqual(source, [{ ...source[0], mode: "120000" }]),
    /governed source drifted/u,
  );
  assert.throws(
    () => assertDeliveryTreeEqual(source, [{ ...source[0], type: "tree" }]),
    /governed source drifted/u,
  );
});

test("no-follow artifact reader rejects symlink substitution", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "foundry-manifest-nofollow-"));
  const target = path.join(directory, "target.json");
  const link = path.join(directory, "link.json");
  fs.writeFileSync(target, "{}\n");
  fs.symlinkSync(target, link);
  assert.throws(() => readNoFollowRegular(link), ManifestError);
  fs.rmSync(directory, { recursive: true, force: true });
});

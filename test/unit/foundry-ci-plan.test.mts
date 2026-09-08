import assert from "node:assert/strict";
import test from "node:test";
import { planFoundryTestShards } from "../../scripts/lib/foundry-ci-plan.ts";

const files = [
  "test/unit/a.test.mts",
  "test/unit/b.test.mts",
  "test/scenarios/c.test.mts",
  "test/scenarios/d.test.mts",
];

test("CI partitions every test file once and balances measured heavy cases", () => {
  const plan = planFoundryTestShards(
    files,
    { [files[0]]: 10, [files[1]]: 9, [files[2]]: 2, [files[3]]: 1 },
    2,
  );
  assert.deepEqual(
    plan.shards.map((shard) => shard.estimatedSeconds),
    [11, 11],
  );
  assert.deepEqual(plan.shards.flatMap((shard) => shard.files).sort(), [...files].sort());
  assert.equal(new Set(plan.shards.flatMap((shard) => shard.files)).size, files.length);
  assert.deepEqual(
    plan.shards.map(({ index, total }) => [index, total]),
    [
      [1, 2],
      [2, 2],
    ],
  );
});

test("CI partition is independent of discovery and duration-map insertion order", () => {
  const first = planFoundryTestShards(files, { [files[0]]: 10, [files[1]]: 9 }, 2);
  const second = planFoundryTestShards([...files].reverse(), { [files[1]]: 9, [files[0]]: 10 }, 2);
  assert.deepEqual(first, second);
  assert.notEqual(
    first.planSha256,
    planFoundryTestShards(files, { [files[0]]: 11, [files[1]]: 9 }, 2).planSha256,
  );
});

test("CI partition includes new unprofiled tests instead of silently omitting them", () => {
  const plan = planFoundryTestShards(files, { [files[0]]: 10 }, 2);
  assert.deepEqual(plan.unprofiledFiles, files.slice(1).sort());
  assert.equal(
    plan.shards.reduce((sum, shard) => sum + shard.files.length, 0),
    4,
  );
});

test("CI partition refuses duplicate, unsafe or non-test paths and stale duration entries", () => {
  for (const bad of [
    "../outside.test.mts",
    "test/../outside.test.mts",
    "/tmp/outside.test.mts",
    "test\\unit\\a.test.mts",
    "test/unit/a.ts",
    "test/unit/a\n.test.mts",
  ]) {
    assert.throws(() => planFoundryTestShards([files[0], bad], {}, 2), /test path/);
  }
  assert.throws(() => planFoundryTestShards([files[0], files[0]], {}, 2), /duplicate/);
  assert.throws(
    () => planFoundryTestShards(files, { "test/unit/removed.test.mts": 1 }, 2),
    /unknown/,
  );
  for (const duration of [0, -1, NaN, Infinity])
    assert.throws(() => planFoundryTestShards(files, { [files[0]]: duration }, 2), /duration/);
});

test("CI partition refuses empty shards rather than accidentally running the whole suite", () => {
  for (const count of [0, -1, 1.5, 5, NaN])
    assert.throws(() => planFoundryTestShards(files, {}, count), /shard count/);
  assert.throws(() => planFoundryTestShards([], {}, 1), /shard count/);
});

import fs from "node:fs";
import path from "node:path";
import { selectFoundryCiMode } from "../../scripts/lib/foundry-ci-plan.ts";
import {
  validateFoundryReleaseChange,
  type ReleaseFileChange,
} from "../../scripts/lib/foundry-release-contract.ts";
import {
  foundryReleaseVersionPaths,
  projectFoundryReleaseVersion,
} from "../../scripts/lib/foundry-release-version.ts";

function versionChanges(): ReleaseFileChange[] {
  const root = path.resolve(import.meta.dirname, "../..");
  const before = Object.fromEntries(
    foundryReleaseVersionPaths.map((file) => [
      file,
      fs.readFileSync(path.join(root, file), "utf8"),
    ]),
  );
  const version = JSON.parse(before["package.json"]).version as string;
  const next = version.split(".");
  next[2] = String(Number(next[2]) + 1);
  const projection = projectFoundryReleaseVersion(before, next.join("."));
  return foundryReleaseVersionPaths.map((file) => ({
    path: file,
    before: before[file],
    after: projection.replacements[file],
    beforeMode: "100644",
    afterMode: "100644",
  }));
}

test("only strictly inspected version PRs receive the bounded gate", () => {
  const inspection = validateFoundryReleaseChange(versionChanges());
  assert.equal(selectFoundryCiMode("pull_request", undefined, inspection), "version-only");
  for (const event of ["push", "workflow_dispatch", "workflow_call", "unknown"])
    assert.equal(selectFoundryCiMode(event, undefined, inspection), "full");
  assert.equal(selectFoundryCiMode("pull_request", "a".repeat(40), inspection), "full");
  assert.equal(
    selectFoundryCiMode("pull_request", undefined, {
      release: false,
      changedPaths: ["scripts/runtime-entry.ts"],
    }),
    "full",
  );
});

test("version gate never admits dependency changes, mixed source or changed document bodies", () => {
  const classify = (changes: ReleaseFileChange[]) =>
    selectFoundryCiMode("pull_request", undefined, validateFoundryReleaseChange(changes));
  for (const extra of [
    { path: "pnpm-lock.yaml", before: "old", after: "new" },
    { path: "scripts/runtime-entry.ts", before: "old", after: "new" },
    {
      path: "README.md",
      before: "---\nlastReviewedAt: old\n---\nOld body\n",
      after: "---\nlastReviewedAt: new\n---\nNew body\n",
    },
  ])
    assert.throws(
      () =>
        classify([...versionChanges(), { ...extra, beforeMode: "100644", afterMode: "100644" }]),
      /release-only/,
    );
  const changed = versionChanges();
  changed[0] = {
    ...changed[0],
    after: changed[0].after!.replace(
      '"dependencies": {',
      '"dependencies": { "unexpected": "1.0.0",',
    ),
  };
  assert.throws(() => classify(changed), /projection/);
  assert.equal(classify(versionChanges().slice(1)), "full");
  assert.throws(
    () => classify(versionChanges().filter((_, index) => index !== 1)),
    /Missing release version/,
  );
});

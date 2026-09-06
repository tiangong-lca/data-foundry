import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  applyFoundryReleaseVersion,
  planFoundryReleaseVersion,
} from "../../scripts/lib/foundry-release-version.ts";
import {
  validateFoundryReleaseChange,
  type ReleaseFileChange,
} from "../../scripts/lib/foundry-release-contract.ts";

const root = path.resolve(import.meta.dirname, "../..");
const versionFiles = [
  "package.json",
  "scripts/lib/foundry-package-contract.ts",
  "specs/schemas/foundry-package-descriptor.schema.json",
];

function changes(): ReleaseFileChange[] {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "foundry-release-change-"));
  try {
    const before = versionFiles.map((file) => fs.readFileSync(path.join(root, file), "utf8"));
    for (const [index, file] of versionFiles.entries()) {
      fs.mkdirSync(path.dirname(path.join(fixture, file)), { recursive: true });
      fs.writeFileSync(path.join(fixture, file), before[index]);
    }
    const current = (JSON.parse(before[0]) as { version: string }).version;
    const next = current.replace(/\d+$/u, (value) => String(BigInt(value) + 1n));
    applyFoundryReleaseVersion(planFoundryReleaseVersion(fixture, next));
    return versionFiles.map((file, index) => ({
      path: file,
      before: before[index],
      after: fs.readFileSync(path.join(fixture, file), "utf8"),
      beforeMode: "100644",
      afterMode: "100644",
    }));
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
}

test("release guard accepts only a coherent version projection and existing review metadata", () => {
  const delta = changes();
  delta.push({
    path: "docs/review.md",
    before: "---\nlastReviewedCommit: old\ntitle: Rules\n---\nUnchanged body.\n",
    after: "---\nlastReviewedCommit: new\ntitle: Rules\n---\nUnchanged body.\n",
    beforeMode: "100644",
    afterMode: "100644",
  });
  const result = validateFoundryReleaseChange(delta);
  assert.equal(result.release, true);
  assert.equal(result.tag, `foundry-v${result.version}`);
  assert.deepEqual(result.changedPaths, delta.map((file) => file.path).sort());
});

test("an ordinary implementation change cannot trigger publication", () => {
  const result = validateFoundryReleaseChange([
    {
      path: "scripts/feature.ts",
      before: "before",
      after: "after",
      beforeMode: "100644",
      afterMode: "100644",
    },
  ]);
  assert.equal(result.release, false);
});

test("release guard refuses partial projections, runtime edits, lock changes and new files", () => {
  const delta = changes();
  assert.throws(() => validateFoundryReleaseChange(delta.slice(0, 2)), /projection/iu);
  for (const extra of [
    { path: "scripts/foundry.ts", before: "before", after: "after" },
    { path: "pnpm-lock.yaml", before: "old", after: "new" },
    { path: "README.md", before: null, after: "new file" },
  ])
    assert.throws(
      () =>
        validateFoundryReleaseChange([
          ...delta,
          { ...extra, beforeMode: extra.before === null ? null : "100644", afterMode: "100644" },
        ]),
      /release-only/iu,
    );
  const changed = structuredClone(delta);
  changed[1].after += "\nexport const unreviewed = true;\n";
  assert.throws(() => validateFoundryReleaseChange(changed), /projection/iu);
});

test("review metadata cannot conceal body, contract, mode or comment changes", () => {
  const delta = changes();
  const before = "---\nlastReviewedCommit: old\ntitle: Rules\n---\nBody.\n";
  for (const after of [
    before.replace("Body.", "Changed."),
    before.replace("title: Rules", "title: Other"),
    before + "\n<!-- hidden change -->\n",
    before.replaceAll("\n", "\r\n"),
    before.replace("title: Rules", "lastReviewedNote: newly added\ntitle: Rules"),
  ]) {
    assert.throws(
      () =>
        validateFoundryReleaseChange([
          ...delta,
          { path: "README.md", before, after, beforeMode: "100644", afterMode: "100644" },
        ]),
      /release-only/iu,
    );
  }
  assert.throws(
    () =>
      validateFoundryReleaseChange([
        ...delta,
        { path: "README.md", before, after: before, beforeMode: "100644", afterMode: "100755" },
      ]),
    /mode/iu,
  );
});

test("a package version bump cannot change any other manifest field", () => {
  const delta = changes();
  const manifest = JSON.parse(delta[0].after!) as Record<string, unknown>;
  manifest.dependencies = { "@tiangong-lca/cli": "9.0.0" };
  delta[0].after = JSON.stringify(manifest, null, 2) + "\n";
  assert.throws(() => validateFoundryReleaseChange(delta), /projection/iu);
});

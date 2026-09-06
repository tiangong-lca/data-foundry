import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  applyFoundryReleaseVersion,
  planFoundryReleaseVersion,
} from "../../scripts/lib/foundry-release-version.ts";

const repoRoot = path.resolve(import.meta.dirname, "../..");
const files = [
  "package.json",
  "scripts/lib/foundry-package-contract.ts",
  "specs/schemas/foundry-package-descriptor.schema.json",
] as const;

function fixture(): { root: string; original: Map<string, string>; current: string; next: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "foundry-release-version-"));
  const original = new Map<string, string>();
  for (const file of files) {
    const content = fs.readFileSync(path.join(repoRoot, file), "utf8");
    original.set(file, content);
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), content);
  }
  const current = (JSON.parse(original.get("package.json")!) as { version: string }).version;
  const next = current.replace(/\d+$/u, (patch) => String(BigInt(patch) + 1n));
  return { root, original, current, next };
}

function assertUnchanged(root: string, original: Map<string, string>): void {
  for (const [file, content] of original) {
    assert.equal(fs.readFileSync(path.join(root, file), "utf8"), content, file);
  }
}

test("version planning is read-only and binds all three release identities", () => {
  const { root, original, current, next } = fixture();
  try {
    const plan = planFoundryReleaseVersion(root, next);
    assert.equal(plan.currentVersion, current);
    assert.equal(plan.version, next);
    assert.equal(plan.status, "planned");
    assert.deepEqual(
      plan.files.map((file) => file.path),
      [...files],
    );
    for (const file of plan.files) {
      assert.match(file.beforeSha256, /^[0-9a-f]{64}$/u);
      assert.match(file.afterSha256, /^[0-9a-f]{64}$/u);
      assert.notEqual(file.beforeSha256, file.afterSha256);
    }
    assertUnchanged(root, original);
    assert(Object.isFrozen(plan));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("version apply updates only the manifest and its compiled/schema projections", () => {
  const { root, original, current, next } = fixture();
  try {
    fs.chmodSync(path.join(root, files[0]), 0o660);
    const manifestMode = fs.statSync(path.join(root, files[0])).mode & 0o777;
    const plan = planFoundryReleaseVersion(root, next);
    const result = applyFoundryReleaseVersion(plan);
    assert.equal(result.status, "updated");
    assert.equal(fs.statSync(path.join(root, files[0])).mode & 0o777, manifestMode);
    const manifest = JSON.parse(fs.readFileSync(path.join(root, files[0]), "utf8")) as {
      version: string;
    };
    const schema = JSON.parse(fs.readFileSync(path.join(root, files[2]), "utf8")) as {
      properties: { package: { properties: { version: { const: string } } } };
    };
    assert.equal(manifest.version, next);
    assert.equal(schema.properties.package.properties.version.const, next);
    const contract = fs.readFileSync(path.join(root, files[1]), "utf8");
    assert(contract.includes(`const packageVersion = "${next}";`));
    for (const file of files) {
      const updated = fs.readFileSync(path.join(root, file), "utf8");
      assert.equal(updated.replace(`"${next}"`, `"${current}"`), original.get(file), file);
      assert.deepEqual(
        fs
          .readdirSync(path.dirname(path.join(root, file)))
          .filter((name) => name.includes(".release-")),
        [],
      );
    }
    const unchanged = planFoundryReleaseVersion(root, next);
    assert.equal(unchanged.status, "unchanged");
    assert.equal(applyFoundryReleaseVersion(unchanged).status, "unchanged");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("version planning rejects unstable, malformed and decreasing versions without writes", () => {
  const { root, original } = fixture();
  try {
    for (const version of [
      "v1.2.3",
      "1.2",
      "01.2.3",
      "1.2.3-beta.1",
      "1.2.3+build",
      "../1.2.3",
      "0.0.0",
    ]) {
      assert.throws(() => planFoundryReleaseVersion(root, version), /version/iu, version);
    }
    assertUnchanged(root, original);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("mixed source versions and foreign package identity fail before any write", () => {
  const { root, original, next } = fixture();
  try {
    const manifest = JSON.parse(original.get(files[0])!) as { name: string; version: string };
    manifest.version = next;
    fs.writeFileSync(path.join(root, files[0]), `${JSON.stringify(manifest, null, 2)}\n`);
    assert.throws(() => planFoundryReleaseVersion(root, "9.0.0"), /coherent|match/iu);
    assert.equal(fs.readFileSync(path.join(root, files[1]), "utf8"), original.get(files[1]));
    manifest.name = "@other/package";
    fs.writeFileSync(path.join(root, files[0]), `${JSON.stringify(manifest, null, 2)}\n`);
    assert.throws(() => planFoundryReleaseVersion(root, "9.0.0"), /identity/iu);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("apply rejects a serialized plan and source drift without overwriting any file", () => {
  const { root, original, next } = fixture();
  try {
    const plan = planFoundryReleaseVersion(root, next);
    assert.throws(() => applyFoundryReleaseVersion(JSON.parse(JSON.stringify(plan))), /plan/iu);
    const changed = `${original.get(files[1])}\n// concurrent source edit\n`;
    fs.writeFileSync(path.join(root, files[1]), changed);
    assert.throws(() => applyFoundryReleaseVersion(plan), /changed|drift/iu);
    assert.equal(fs.readFileSync(path.join(root, files[0]), "utf8"), original.get(files[0]));
    assert.equal(fs.readFileSync(path.join(root, files[1]), "utf8"), changed);
    assert.equal(fs.readFileSync(path.join(root, files[2]), "utf8"), original.get(files[2]));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("version planning rejects non-regular source metadata", () => {
  const { root, next } = fixture();
  try {
    fs.rmSync(path.join(root, files[2]));
    fs.mkdirSync(path.join(root, files[2]));
    assert.throws(() => planFoundryReleaseVersion(root, next), /regular file/iu);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("version planning refuses metadata reached through an external directory link", () => {
  const { root, original, next } = fixture();
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "foundry-release-outside-"));
  try {
    const parent = path.join(root, "scripts/lib");
    fs.writeFileSync(path.join(outside, "foundry-package-contract.ts"), original.get(files[1])!);
    fs.rmSync(parent, { recursive: true });
    fs.symlinkSync(outside, parent, "junction");
    assert.throws(() => planFoundryReleaseVersion(root, next), /repository tree/iu);
    assert.equal(
      fs.readFileSync(path.join(outside, "foundry-package-contract.ts"), "utf8"),
      original.get(files[1]),
    );
    assert.equal(fs.readFileSync(path.join(root, files[0]), "utf8"), original.get(files[0]));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test("the source CLI binds its own clean Git root and ignores inherited repository bindings", () => {
  const { root, next } = fixture();
  const environment = { ...process.env };
  for (const key of Object.keys(environment)) {
    if (key.startsWith("GIT_")) delete environment[key];
  }
  try {
    for (const file of ["scripts/release-version.ts", "scripts/lib/foundry-release-version.ts"]) {
      fs.copyFileSync(path.join(repoRoot, file), path.join(root, file));
    }
    for (const argv of [
      ["init", "-b", "version-fixture"],
      ["config", "core.hooksPath", path.join(root, "empty-hooks")],
      ["add", "."],
      [
        "-c",
        "user.name=Version Test",
        "-c",
        "user.email=version@example.invalid",
        "commit",
        "-m",
        "fixture",
      ],
    ]) {
      const result = spawnSync("git", argv, { cwd: root, env: environment, encoding: "utf8" });
      assert.equal(result.status, 0, result.stderr);
    }
    const script = path.join(root, "scripts/release-version.ts");
    const result = spawnSync(process.execPath, [script, "--version", next, "--apply"], {
      cwd: os.tmpdir(),
      env: { ...environment, GIT_DIR: path.join(root, "foreign-git"), GIT_WORK_TREE: os.tmpdir() },
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal((JSON.parse(result.stdout) as { status: string }).status, "updated");
    const after = new Map(
      files.map((file) => [file, fs.readFileSync(path.join(root, file), "utf8")]),
    );
    const another = next.replace(/\d+$/u, (patch) => String(BigInt(patch) + 1n));
    const dirty = spawnSync(process.execPath, [script, "--version", another, "--apply"], {
      cwd: root,
      env: environment,
      encoding: "utf8",
    });
    assert.notEqual(dirty.status, 0);
    assert.match(dirty.stderr, /clean repository/iu);
    assertUnchanged(root, after);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

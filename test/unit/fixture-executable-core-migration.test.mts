import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, "..", "..");
const typedCorePath = path.join(repoRoot, "test/fixtures/foundry-core.ts");
const legacyCorePath = path.join(repoRoot, "test/fixtures/foundry-core.mjs");
const typedFakePath = path.join(repoRoot, "test/fixtures/fake-tidas.ts");
const legacyFakePath = path.join(repoRoot, "test/fixtures/fake-tidas.mjs");

function activePath(typedPath: string, legacyPath: string): string {
  return fs.existsSync(typedPath) ? typedPath : legacyPath;
}

const core = await import(pathToFileURL(activePath(typedCorePath, legacyCorePath)).href);

test("executable and core fixtures exist only as native TypeScript", () => {
  assert.equal(fs.existsSync(typedCorePath), true);
  assert.equal(fs.existsSync(typedFakePath), true);
  assert.equal(fs.existsSync(legacyCorePath), false);
  assert.equal(fs.existsSync(legacyFakePath), false);
  for (const fixturePath of [typedCorePath, typedFakePath]) {
    const source = fs.readFileSync(fixturePath, "utf8");
    assert.doesNotMatch(source, /(?:[:<>,(|]\s*any\b|\bas\s+any\b)/u);
    assert.doesNotMatch(source, /@ts-(?:ignore|nocheck|expect-error)/u);
  }
});

test("core fixture namespace and Node references remain exact", () => {
  assert.deepEqual(Object.keys(core).sort(), [
    "assert",
    "blockerCodes",
    "bundledCategorySchemaNames",
    "contextTextByPathSuffix",
    "crypto",
    "fakeTidasBin",
    "fs",
    "fullContextKinds",
    "fullContextPatterns",
    "itemBlockerCodes",
    "path",
    "readJson",
    "readJsonLines",
    "rel",
    "repoRoot",
    "runFoundry",
    "scopeBlockerCodes",
    "sha256Text",
    "spawnSync",
    "targetUserId",
    "testRunId",
    "testTmpRoot",
    "writeJson",
    "writeJsonLines",
    "writeText",
  ]);
  assert.equal(core.assert, assert);
  assert.equal(core.fs, fs);
  assert.equal(core.path, path);
  assert.equal(core.spawnSync, spawnSync);
  assert.equal(core.fakeTidasBin, typedFakePath);
});

test("core writers preserve exact bytes, order, isolation, and native errors", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "foundry-fixture-core-"));
  try {
    const jsonPath = path.join(tempRoot, "nested", "value.json");
    const jsonlPath = path.join(tempRoot, "rows.jsonl");
    core.writeJson(jsonPath, { second: 2, first: 1 });
    core.writeJsonLines(jsonlPath, [
      { id: "b", value: 2 },
      { id: "a", value: 1 },
    ]);
    assert.equal(fs.readFileSync(jsonPath, "utf8"), '{\n  "second": 2,\n  "first": 1\n}\n');
    assert.equal(
      fs.readFileSync(jsonlPath, "utf8"),
      '{"id":"b","value":2}\n{"id":"a","value":1}\n',
    );
    assert.deepEqual(core.readJsonLines(jsonlPath), [
      { id: "b", value: 2 },
      { id: "a", value: 1 },
    ]);
    fs.writeFileSync(jsonPath, "{");
    assert.throws(() => core.readJson(jsonPath), SyntaxError);
    assert.throws(
      () => core.readJson(path.join(tempRoot, "missing.json")),
      (error: unknown) => error instanceof Error && "code" in error && error.code === "ENOENT",
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("fake tidas is dispatched through Node with exact version report bytes", () => {
  const fakePath = activePath(typedFakePath, legacyFakePath);
  const result = spawnSync(process.execPath, [fakePath, "version"], {
    cwd: os.tmpdir(),
    encoding: "utf8",
    env: { ...process.env, FAKE_TIDAS_VERSION: "0.2.7" },
  });
  assert.equal(result.status, 0);
  assert.equal(result.stderr, "");
  assert.equal(Buffer.byteLength(result.stdout, "utf8"), 606);
  assert.equal(
    createHash("sha256").update(result.stdout).digest("hex"),
    "e664493022c12a1b2eea2459187b274378a64a5bc7664b62ccbf2c2fa56f423a",
  );
  assert.equal(JSON.parse(result.stdout).summary.binary_version, "0.2.7");
});

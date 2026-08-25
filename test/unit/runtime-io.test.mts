import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import * as runtimeIo from "../../scripts/lib/import-curation/internal/runtime-io.ts";

function withFixture<T>(callback: (root: string) => T): T {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "foundry-runtime-io-"));
  try {
    return callback(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test("runtime I/O exposes the complete stable helper surface", () => {
  assert.deepEqual(Object.keys(runtimeIo).sort(), [
    "asText",
    "directoryExists",
    "ensureArray",
    "fileExists",
    "jsonLines",
    "normalizedArtifactPath",
    "nowIso",
    "optionList",
    "readJson",
    "readJsonIfExists",
    "readJsonOrJsonl",
    "readRows",
    "readText",
    "repoRelativeArtifactPath",
    "repoRelativePath",
    "resolveRepoPath",
    "sameArtifactPath",
    "sanitizeFileName",
    "unique",
    "writeJson",
    "writeJsonLines",
    "writeText",
  ]);
});

test("time, array, text, option, unique, and filename helpers preserve coercion behavior", () => {
  const array = ["same"];
  assert.strictEqual(runtimeIo.ensureArray(array), array);
  assert.deepEqual(runtimeIo.ensureArray(null), []);
  assert.deepEqual(runtimeIo.ensureArray(undefined), []);
  assert.deepEqual(runtimeIo.ensureArray("value"), ["value"]);

  assert.deepEqual(runtimeIo.optionList([" alpha, beta ", null, ["gamma", ""]]), [
    "alpha",
    "beta",
    "gamma",
  ]);
  assert.deepEqual(runtimeIo.optionList(false), ["false"]);
  assert.deepEqual(runtimeIo.unique(["a", "a", "", null, 0, "b", false, "b"]), ["a", "b"]);

  assert.equal(runtimeIo.asText(" value "), "value");
  assert.equal(runtimeIo.asText(0), "0");
  assert.equal(runtimeIo.asText(false), "false");
  assert.equal(runtimeIo.asText(null), "");
  assert.equal(runtimeIo.asText(1n), "");
  assert.equal(runtimeIo.asText({ value: 1 }), "");

  assert.equal(runtimeIo.sanitizeFileName(" alpha / beta?.json "), "alpha_beta_.json");
  assert.equal(runtimeIo.sanitizeFileName("___"), "missing");
  assert.equal(runtimeIo.sanitizeFileName(null), "missing");

  const timestamp = runtimeIo.nowIso();
  assert.match(timestamp, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u);
  assert.equal(new Date(timestamp).toISOString(), timestamp);
});

test("text and JSON writers create parents and preserve exact synchronous bytes", () => {
  withFixture((root) => {
    const textFile = path.join(root, "nested", "text.txt");
    const jsonFile = path.join(root, "nested", "report.json");
    runtimeIo.writeText(textFile, "exact text");
    runtimeIo.writeJson(jsonFile, { b: 2, a: 1 });

    assert.equal(runtimeIo.readText(textFile), "exact text");
    assert.equal(runtimeIo.readText(jsonFile), '{\n  "b": 2,\n  "a": 1\n}\n');
    assert.deepEqual(runtimeIo.readJson(jsonFile), { b: 2, a: 1 });
    assert.equal(runtimeIo.fileExists(textFile), true);
    assert.equal(runtimeIo.directoryExists(path.dirname(textFile)), true);
    assert.equal(runtimeIo.fileExists(path.dirname(textFile)), false);
    assert.equal(runtimeIo.directoryExists(textFile), false);
  });
});

test("JSONL writer preserves line order, truncates existing content, and closes before return", () => {
  withFixture((root) => {
    const file = path.join(root, "nested", "rows.jsonl");
    runtimeIo.writeText(file, "stale content that must disappear\n");
    runtimeIo.writeJsonLines(file, [{ id: 1 }, null, "three"]);
    assert.equal(runtimeIo.readText(file), '{"id":1}\nnull\n"three"\n');
    assert.deepEqual(runtimeIo.readJsonOrJsonl(file), [{ id: 1 }, null, "three"]);

    const renamed = path.join(root, "nested", "renamed.jsonl");
    fs.renameSync(file, renamed);
    assert.equal(runtimeIo.fileExists(file), false);
    assert.equal(runtimeIo.fileExists(renamed), true);
  });
});

test("JSONL writer retains partial-prefix and close-on-error behavior", () => {
  withFixture((root) => {
    const file = path.join(root, "rows.jsonl");
    assert.throws(() => runtimeIo.writeJsonLines(file, [{ committed: 1 }, 1n]), TypeError);
    assert.equal(runtimeIo.readText(file), '{"committed":1}\n');

    const renamed = path.join(root, "rows-after-error.jsonl");
    fs.renameSync(file, renamed);
    assert.equal(runtimeIo.readText(renamed), '{"committed":1}\n');
  });
});

test("JSON and JSONL readers preserve empty, CRLF, envelope, and scalar behavior", () => {
  withFixture((root) => {
    const empty = path.join(root, "empty.jsonl");
    const lines = path.join(root, "rows.jsonl");
    const array = path.join(root, "array.json");
    const envelopes = ["rows", "processes", "flows", "lifecyclemodels"];
    runtimeIo.writeText(empty, "  \n");
    runtimeIo.writeText(lines, '{"id":1}\r\n\r\n{"id":2}\r\n');
    runtimeIo.writeText(array, '[{"id":3}]\n');

    assert.deepEqual(runtimeIo.readJsonOrJsonl(empty), []);
    assert.deepEqual(runtimeIo.readJsonOrJsonl(lines), [{ id: 1 }, { id: 2 }]);
    assert.deepEqual(runtimeIo.readJsonOrJsonl(array), [{ id: 3 }]);
    assert.deepEqual(runtimeIo.readRows(array), [{ id: 3 }]);

    for (const envelope of envelopes) {
      const file = path.join(root, `${envelope}.json`);
      runtimeIo.writeJson(file, { [envelope]: [{ envelope }] });
      assert.deepEqual(runtimeIo.readRows(file), [{ envelope }]);
    }
    const scalar = path.join(root, "scalar.json");
    runtimeIo.writeText(scalar, "42\n");
    assert.deepEqual(runtimeIo.readRows(scalar), [42]);
  });
});

test("JSON line rendering and reading preserve exact delimiters and parse failures", () => {
  assert.equal(runtimeIo.jsonLines([]), "");
  assert.equal(runtimeIo.jsonLines([{ id: 1 }, "two"]), '{"id":1}\n"two"\n');
  withFixture((root) => {
    const invalidJson = path.join(root, "invalid.json");
    const invalidJsonl = path.join(root, "invalid.jsonl");
    runtimeIo.writeText(invalidJson, "{invalid}\n");
    runtimeIo.writeText(invalidJsonl, '{"ok":true}\n{invalid}\n');
    assert.throws(() => runtimeIo.readJson(invalidJson), SyntaxError);
    assert.throws(() => runtimeIo.readJsonOrJsonl(invalidJsonl), SyntaxError);
  });
});

test("repository and artifact paths normalize native and POSIX separators without changing scope", () => {
  withFixture((root) => {
    const nativeRelative = path.join("nested", "artifact.json");
    const posixRelative = "nested/artifact.json";
    const absolute = path.join(root, nativeRelative);
    runtimeIo.writeJson(absolute, { ok: true });

    assert.equal(runtimeIo.resolveRepoPath(root, nativeRelative), absolute);
    assert.equal(runtimeIo.resolveRepoPath(root, absolute), absolute);
    assert.equal(runtimeIo.resolveRepoPath(root, ""), null);
    assert.equal(runtimeIo.resolveRepoPath(root, null), null);
    assert.equal(runtimeIo.repoRelativePath(root, absolute), posixRelative);
    assert.equal(runtimeIo.normalizedArtifactPath(root, nativeRelative), absolute);
    assert.equal(runtimeIo.repoRelativeArtifactPath(root, nativeRelative), posixRelative);
    assert.equal(runtimeIo.sameArtifactPath(root, nativeRelative, posixRelative), true);
    assert.equal(runtimeIo.sameArtifactPath(root, nativeRelative, ""), false);
    assert.equal(runtimeIo.normalizedArtifactPath(root, null), null);
    assert.equal(runtimeIo.repoRelativeArtifactPath(root, undefined), null);
    assert.ok(!runtimeIo.repoRelativePath(root, absolute).includes("\\"));
  });
});

test("missing inputs retain null probes and native filesystem error envelopes", () => {
  withFixture((root) => {
    const missing = path.join(root, "missing.json");
    assert.equal(runtimeIo.readJsonIfExists(missing), null);
    assert.equal(runtimeIo.fileExists(missing), false);
    assert.equal(runtimeIo.directoryExists(missing), false);
    assert.equal(runtimeIo.fileExists(null), false);
    assert.equal(runtimeIo.directoryExists(undefined), false);
    assert.throws(
      () => runtimeIo.readText(missing),
      (error: unknown) => (error as NodeJS.ErrnoException).code === "ENOENT",
    );
  });
});

test("runtime I/O is native TypeScript and representative consumers target it", () => {
  const typedPath = path.join(
    path.resolve(import.meta.dirname, "..", ".."),
    "scripts/lib/import-curation/internal/runtime-io.ts",
  );
  assert.equal(fs.existsSync(typedPath), true);
  assert.equal(fs.existsSync(typedPath.replace(/\.ts$/u, ".mjs")), false);

  const repoRoot = path.resolve(import.meta.dirname, "..", "..");
  const expectedConsumers = [
    ["scripts/lib/import-curation/curation-cleanup.ts", "./internal/runtime-io.ts"],
    ["scripts/lib/import-curation/internal/dataset-payload.ts", "./runtime-io.ts"],
    ["scripts/lib/import-curation/internal/workflow-semantic-actions.ts", "./runtime-io.ts"],
    ["test/unit/runtime-io.test.mts", "../../scripts/lib/import-curation/internal/runtime-io.ts"],
  ] as const;
  for (const [consumer, specifier] of expectedConsumers) {
    assert.match(
      fs.readFileSync(path.join(repoRoot, consumer), "utf8"),
      new RegExp(`from ["']${specifier.replaceAll(".", "\\.")}["']`, "u"),
    );
  }
});

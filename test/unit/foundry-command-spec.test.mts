import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  assertFoundryCommandSpecArtifactsCurrent,
  assertFoundryCommandSpecBindsArtifact,
  commandSpecOptionValue,
  createFileArtifactFact,
  createFoundryCommandSpec,
  executeFoundryCommandSpecSync,
  parseFoundryCommandSpec,
} from "../../scripts/lib/foundry-command-spec.ts";

test("CommandSpec binds executable argv and exact artifact facts while display stays non-authoritative", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "foundry-command-spec-"));
  const rowsFile = path.join(root, "rows with spaces.jsonl");
  fs.writeFileSync(rowsFile, '{"id":"row-1"}\n');
  try {
    const artifact = createFileArtifactFact({
      role: "final_rows",
      path: rowsFile,
      filePath: rowsFile,
    });
    const spec = createFoundryCommandSpec({
      executable: process.execPath,
      argv: [
        "fixture.js",
        "--input",
        rowsFile,
        "--out-dir",
        path.join(root, "out; not-a-shell-command"),
        "--commit",
        "--json",
      ],
      binding: { artifacts: [artifact] },
    });

    assert.equal(spec.schema, "tiangong-foundry.command-spec.v1");
    assert.equal(spec.executable, process.execPath);
    assert.deepEqual(spec.argv.slice(0, 3), ["fixture.js", "--input", rowsFile]);
    assert.match(spec.sha256, /^[a-f0-9]{64}$/u);
    assert.match(spec.display, /rows with spaces\.jsonl/u);
    assert.equal(spec.binding.artifacts[0].bytes, Buffer.byteLength('{"id":"row-1"}\n'));
    assert.match(spec.binding.artifacts[0].sha256, /^[a-f0-9]{64}$/u);
    assert.equal(commandSpecOptionValue(spec, "--input"), rowsFile);

    const displayDrift = parseFoundryCommandSpec({
      ...spec,
      display: "printf malicious-display-must-never-run",
    });
    assert.equal(displayDrift.sha256, spec.sha256);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("CommandSpec parser rejects extra keys hash drift and duplicate critical flags", () => {
  const base = createFoundryCommandSpec({
    executable: process.execPath,
    argv: ["fixture.js", "--input", "rows.jsonl", "--commit", "--json"],
    binding: { artifacts: [] },
  });

  assert.throws(
    () => parseFoundryCommandSpec({ ...base, unexpected: true }),
    /exact keys|unexpected/iu,
  );
  assert.throws(
    () => parseFoundryCommandSpec({ ...base, sha256: "0".repeat(64) }),
    /sha-?256|hash/iu,
  );
  assert.throws(
    () =>
      parseFoundryCommandSpec({
        ...base,
        argv: [
          "fixture.js",
          "--input",
          "rows-a.jsonl",
          "--input",
          "rows-b.jsonl",
          "--commit",
          "--json",
        ],
      }),
    /--input.*once|duplicate/iu,
  );
  assert.throws(
    () =>
      parseFoundryCommandSpec({
        ...base,
        argv: [
          "fixture.js",
          "--input",
          "rows.jsonl",
          "--input-file",
          "other.jsonl",
          "--commit",
          "--json",
        ],
      }),
    /input.*alias|--input-file/iu,
  );
  assert.throws(
    () =>
      createFoundryCommandSpec({
        executable: process.execPath,
        argv: ["fixture.js", "--input=", "--commit=false", "--json"],
      }),
    /--input.*value|--commit.*boolean/iu,
  );
});

test("CommandSpec blocks same-path artifact byte drift before spawn and never executes display", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "foundry-command-spec-drift-"));
  const rowsFile = path.join(root, "rows.jsonl");
  fs.writeFileSync(rowsFile, '{"id":"before"}\n');
  let spawnCalls = 0;
  const spawnImpl = (executable: string, argv: readonly string[], options: { shell: false }) => {
    spawnCalls += 1;
    assert.equal(executable, process.execPath);
    assert.deepEqual(argv, ["fixture.js", "--input", rowsFile, "--json"]);
    assert.equal(options.shell, false);
    return {
      pid: 1,
      output: [null, "ok", ""],
      stdout: "ok",
      stderr: "",
      status: 0,
      signal: null,
    };
  };
  try {
    const spec = createFoundryCommandSpec({
      executable: process.execPath,
      argv: ["fixture.js", "--input", rowsFile, "--json"],
      binding: {
        artifacts: [
          createFileArtifactFact({ role: "final_rows", path: rowsFile, filePath: rowsFile }),
        ],
      },
    });
    const displayDrift = { ...spec, display: "touch should-not-exist" };
    assert.doesNotThrow(() =>
      assertFoundryCommandSpecBindsArtifact(displayDrift, spec.binding.artifacts[0]),
    );
    assert.throws(
      () =>
        assertFoundryCommandSpecBindsArtifact(displayDrift, {
          ...spec.binding.artifacts[0],
          sha256: "0".repeat(64),
        }),
      /required.*artifact|binding.*match/iu,
    );
    const result = executeFoundryCommandSpecSync(displayDrift, {
      resolveArtifactPath: (value) => value,
      spawnImpl,
    });
    assert.equal(result.status, 0);
    assert.equal(spawnCalls, 1);

    fs.writeFileSync(rowsFile, '{"id":"after"}\n');
    assert.throws(
      () => assertFoundryCommandSpecArtifactsCurrent(displayDrift, (value) => value),
      /artifact.*drift|bytes|sha-?256/iu,
    );
    assert.throws(
      () =>
        executeFoundryCommandSpecSync(displayDrift, {
          resolveArtifactPath: (value) => value,
          spawnImpl,
        }),
      /artifact.*drift|bytes|sha-?256/iu,
    );
    assert.equal(spawnCalls, 1, "artifact drift must block before spawn");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("handoff runners contain no shell-string parser or shell:true execution path", () => {
  for (const file of [
    "scripts/lib/batch-orchestration/bafu-batch-command-runtime.ts",
    "scripts/commands/bafu-process-scope-e2e.ts",
  ]) {
    const source = fs.readFileSync(path.resolve(file), "utf8");
    assert.doesNotMatch(source, /function shellTokens\s*\(/u, file);
    assert.doesNotMatch(source, /function commandOptionValue\s*\(/u, file);
    assert.doesNotMatch(source, /shell:\s*true/u, file);
    assert.match(source, /assertFoundryCommandSpecBindsArtifact/u, file);
  }
});

test("Foundry CommandSpec facade is the published CLI subpath without a local implementation", async () => {
  const facadePath = path.resolve("scripts/lib/foundry-command-spec.ts");
  const source = fs.readFileSync(facadePath, "utf8");
  assert.match(source, /from\s+["']@tiangong-lca\/cli\/command-spec["']/u);
  assert.doesNotMatch(source, /node:(?:child_process|crypto|fs)/u);
  assert.ok(source.split(/\r?\n/u).length - 1 <= 5);

  const facade = await import(facadePath);
  const published = await import("@tiangong-lca/cli/command-spec");
  for (const name of [
    "createFoundryCommandSpec",
    "parseFoundryCommandSpec",
    "executeFoundryCommandSpec",
    "executeFoundryCommandSpecSync",
    "assertFoundryCommandSpecArtifactsCurrent",
  ]) {
    assert.equal(facade[name], published[name], name);
  }
});

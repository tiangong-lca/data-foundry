import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { resolveTidasProcessCommand, runTidasHandshake } from "../../scripts/lib/tidas-adapter.ts";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, "..", "..");

function readRepoFile(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

function withEnv<T>(values: Record<string, string | undefined>, run: () => T): T {
  const previous = new Map(Object.keys(values).map((key) => [key, process.env[key]]));
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return run();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("TIDAS adapter preserves script executable plus argv dispatch without shell authority", () => {
  const script = path.join(repoRoot, "test/fixtures/fake-tidas.mjs");
  assert.deepEqual(resolveTidasProcessCommand(script), {
    command: process.execPath,
    prefixArgs: [script],
  });
  const source = readRepoFile("scripts/lib/tidas-adapter.ts");
  assert.match(
    source,
    /spawnSync\(processCommand\.command,\s*\[\.\.\.processCommand\.prefixArgs,\s*\.\.\.args\]/u,
  );
  assert.doesNotMatch(source, /shell\s*:\s*true|execSync|execFileSync/u);
});

test("TIDAS adapter preserves native missing-executable errors", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "foundry-tidas-native-error-"));
  try {
    assert.throws(
      () =>
        withEnv({ TIDAS_BIN: path.join(root, "missing-tidas") }, () =>
          runTidasHandshake({ repoRoot: root }),
        ),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.equal((error as NodeJS.ErrnoException).code, "ENOENT");
        return true;
      },
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("TIDAS adapter preserves invalid JSON stdout and stderr diagnostics", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "foundry-tidas-json-error-"));
  const fake = path.join(root, "invalid-tidas.mjs");
  fs.writeFileSync(
    fake,
    [
      'process.stdout.write("not-json\\n");',
      'process.stderr.write("fixture-diagnostic\\n");',
      "process.exit(70);",
      "",
    ].join("\n"),
  );
  try {
    assert.throws(
      () => withEnv({ TIDAS_BIN: fake }, () => runTidasHandshake({ repoRoot: root })),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /tidas version did not emit JSON/u);
        assert.match(error.message, /stdout:\nnot-json/u);
        assert.match(error.message, /stderr:\nfixture-diagnostic/u);
        return true;
      },
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("TIDAS adapter exists only as zero-escape native TypeScript", () => {
  const typedPath = path.join(repoRoot, "scripts/lib/tidas-adapter.ts");
  assert.equal(fs.existsSync(typedPath), true);
  assert.equal(fs.existsSync(typedPath.replace(/\.ts$/u, ".mjs")), false);
  const source = fs.readFileSync(typedPath, "utf8");
  assert.doesNotMatch(source, /\bas\s+any\b|:\s*any\b|\bany\s*\[\]|<\s*any\b|,\s*any\s*>/u);
  assert.doesNotMatch(source, /@ts-(?:no)?check|@ts-ignore/u);
});

test("TIDAS adapter consumers target the typed owner", () => {
  for (const consumer of [
    "scripts/foundry.ts",
    "test/unit/tidas-adapter.test.mjs",
    "test/unit/tidas-adapter-migration-contract.test.mts",
  ]) {
    const source = readRepoFile(consumer);
    assert.match(source, /(?:lib\/|scripts\/lib\/)tidas-adapter\.ts/u);
    assert.doesNotMatch(source, /(?:lib\/|scripts\/lib\/)tidas-adapter\.mjs/u);
  }
});

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, "..", "..");

function readRepoFile(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

test("location quality utilities exist only as native TypeScript", () => {
  assert.equal(fs.existsSync(path.join(repoRoot, "scripts/lib/location-quality-utils.ts")), true);
  assert.equal(fs.existsSync(path.join(repoRoot, "scripts/lib/location-quality-utils.mjs")), false);
});

test("every static location quality consumer targets the typed module explicitly", () => {
  assert.match(
    readRepoFile("scripts/foundry.ts"),
    /from ["']\.\/lib\/location-quality-utils\.ts["']/u,
  );
  assert.match(
    readRepoFile("test/unit/location-quality-utils-contract.test.mts"),
    /from ["']\.\.\/\.\.\/scripts\/lib\/location-quality-utils\.ts["']/u,
  );
});

test("typed location quality factory retains one zero-any named export", () => {
  const source = readRepoFile("scripts/lib/location-quality-utils.ts");
  assert.doesNotMatch(source, /\bany\b/u);
  assert.deepEqual(
    [...source.matchAll(/export function\s+([A-Za-z0-9_]+)/gu)].map((match) => match[1]),
    ["createLocationQualityUtils"],
  );
});

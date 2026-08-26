import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, "..", "..");

test("BAFU name-plan facade delegates bounded acyclic helper modules", async () => {
  const facade = await import("../../scripts/lib/bafu-authoring/name-plan.ts");
  const text = await import("../../scripts/lib/bafu-authoring/name-plan-text.ts");
  const overrides = await import("../../scripts/lib/bafu-authoring/name-plan-overrides.ts");
  const contract = await import("../../scripts/lib/bafu-authoring/name-plan-contract.ts");

  assert.equal(typeof contract, "object");
  for (const name of [
    "cleanProcessFunctionalUnitText",
    "englishText",
    "mergeExistingTreatmentRoute",
    "normalizeIdentityText",
    "normalizeLocationTokenCode",
    "removeTrailingLocationToken",
    "stripGeneratedPrefixText",
    "stripSourceLocatorSuffix",
    "stripTrailingLocationTokenText",
    "textFromMultilang",
  ] as const) {
    assert.strictEqual(facade[name], text[name], `${name} must remain one direct public identity`);
  }
  assert.equal(typeof overrides.splitBafuExactNameOverride, "function");

  const ceilings = new Map([
    ["scripts/lib/bafu-authoring/name-plan.ts", 1200],
    ["scripts/lib/bafu-authoring/name-plan-text.ts", 800],
    ["scripts/lib/bafu-authoring/name-plan-overrides.ts", 800],
    ["scripts/lib/bafu-authoring/name-plan-contract.ts", 800],
  ]);
  for (const [relativePath, ceiling] of ceilings) {
    const source = fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
    const lines = source.endsWith("\n") ? source.split("\n").length - 1 : source.split("\n").length;
    assert.ok(lines <= ceiling, `${relativePath} exceeds ${ceiling} lines`);
    assert.doesNotMatch(source, /from\s+["'][^"']*scripts\/commands\//u);
    assert.doesNotMatch(source, /node:(?:fs|child_process|process)/u);
  }
  assert.doesNotMatch(
    fs.readFileSync(path.join(repoRoot, "scripts/lib/bafu-authoring/name-plan-text.ts"), "utf8"),
    /from\s+["'].\/name-plan\.ts["']/u,
    "helper modules must not create a cycle back to the facade",
  );
});

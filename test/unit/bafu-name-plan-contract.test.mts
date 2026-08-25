import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { bafuAutoAuthoringTestHooks } from "../../scripts/commands/bafu-auto-authoring.ts";
import {
  cleanProcessFunctionalUnitText,
  englishText,
  removeTrailingLocationToken,
  splitBafuNamePlan,
  splitBafuNamePlanFromNameParts,
} from "../../scripts/lib/bafu-authoring/name-plan.ts";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, "..", "..");
const modulePath = path.join(repoRoot, "scripts/lib/bafu-authoring/name-plan.ts");
const ownerPath = path.join(repoRoot, "scripts/commands/bafu-auto-authoring.ts");

interface FrozenCase {
  name: string;
  actual: unknown;
  json: string;
  bytes: number;
  sha256: string;
}

function sha256Text(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

test("BAFU name-plan is a pure typed leaf imported by the command owner and its test hooks", () => {
  const moduleSource = fs.readFileSync(modulePath, "utf8");
  const ownerSource = fs.readFileSync(ownerPath, "utf8");

  assert.doesNotMatch(moduleSource, /^\s*import\s/imu);
  assert.doesNotMatch(moduleSource, /\bprocess\.env\b|\bfetch\s*\(|\bXMLHttpRequest\b/u);
  assert.match(moduleSource, /export interface BafuNamePlan\s*\{/u);
  assert.match(ownerSource, /from "\.\.\/lib\/bafu-authoring\/name-plan\.ts"/u);
  assert.doesNotMatch(ownerSource, /function cleanProcessFunctionalUnitText\s*\(/u);
  assert.doesNotMatch(ownerSource, /function englishText\s*\(/u);
  assert.doesNotMatch(ownerSource, /function normalizeIdentityText\s*\(/u);
  assert.doesNotMatch(ownerSource, /function removeTrailingLocationToken\s*\(/u);
  assert.doesNotMatch(ownerSource, /function splitBafuNamePlan\s*\(/u);
  assert.doesNotMatch(ownerSource, /function splitBafuNamePlanFromNameParts\s*\(/u);
  assert.doesNotMatch(ownerSource, /function textFromMultilang\s*\(/u);

  assert.equal(bafuAutoAuthoringTestHooks.splitBafuNamePlan, splitBafuNamePlan);
  assert.equal(
    bafuAutoAuthoringTestHooks.splitBafuNamePlanFromNameParts,
    splitBafuNamePlanFromNameParts,
  );
  assert.equal(
    bafuAutoAuthoringTestHooks.cleanProcessFunctionalUnitText,
    cleanProcessFunctionalUnitText,
  );
  assert.equal(bafuAutoAuthoringTestHooks.removeTrailingLocationToken, removeTrailingLocationToken);
});

test("BAFU name-plan freezes real null, location, source-locator and recycling bytes", () => {
  const cases: FrozenCase[] = [
    {
      name: "unmatched intrinsic name stays unresolved",
      actual: splitBafuNamePlan("Quartz", null),
      json: "null",
      bytes: 4,
      sha256: "74234e98afe7498fb5daf1f36ac2d78acc339464f950703b8c019892f982b90b",
    },
    {
      name: "matching formal location token is removed",
      actual: splitBafuNamePlan(
        { "@xml:lang": "en", "#text": "Natural gas, burned in boiler {CH}" },
        "CH",
      ),
      json: '{"source":"Natural gas, burned in boiler","base_name":"Natural gas","treatment":"burned in boiler"}',
      bytes: 99,
      sha256: "54f1a055a3ba49adc2362a7729137dcea35987651a4c0091ab557b38cd319314",
    },
    {
      name: "mismatched formal location token is retained",
      actual: splitBafuNamePlan(
        { "@xml:lang": "en", "#text": "Natural gas, burned in boiler {CH}" },
        "RER",
      ),
      json: '{"source":"Natural gas, burned in boiler {CH}","base_name":"Natural gas","treatment":"burned in boiler {CH}"}',
      bytes: 109,
      sha256: "b8889894c7a5d7e1156f6df26ed134b69f4a5446cd1867953bdc8a5464d1545b",
    },
    {
      name: "methodology source locator leaves the water-balance name plan",
      actual: splitBafuNamePlan("Tap water, water balance according to MoeK 2013, at user", null),
      json: '{"source":"Tap water, water balance, at user","base_name":"Tap water","treatment":"water balance","mix_location":"at user"}',
      bytes: 123,
      sha256: "c862dc8634bfba2187917b611660b668f5e06538f821b5b65c191da5b0fa99dd",
    },
    {
      name: "recycling evidence preserves property and cleanup marker order",
      actual: splitBafuNamePlan("Steel profile, tin-coated, recycling share 2000 (37% Rec.)", null),
      json: '{"source":"Steel profile, tin-coated, recycling share 2000 (37% Rec.)","base_name":"Steel profile","treatment":"tin-coated","flow_property":"recycling share 37%","mix_location":"production mix","clean_existing_treatment":true}',
      bytes: 226,
      sha256: "cf22580c55e4c7fb343376ea26aab2e3373156eead57fbab36a95a16b2fe3d06",
    },
    {
      name: "existing name parts keep one location treatment",
      actual: splitBafuNamePlanFromNameParts(
        {
          baseName: {
            "@xml:lang": "en",
            "#text": "Aluminium, production mix for aluminium profiles, SZFF 2014, at plant",
          },
          treatmentStandardsRoutes: { "@xml:lang": "en", "#text": "at plant" },
        },
        "CH",
      ),
      json: '{"source":"Aluminium, production mix for aluminium profiles, SZFF 2014, at plant","base_name":"Aluminium","treatment":"production mix for aluminium profiles","mix_location":"at plant","clean_existing_treatment":true}',
      bytes: 216,
      sha256: "1aaf8b726927ce0ca8e0f1d9b36aaeca14c3223bea9e53ef240db818a6602e6c",
    },
  ];

  for (const item of cases) {
    const serialized = JSON.stringify(item.actual);
    assert.equal(serialized, item.json, `${item.name}: key order and bytes`);
    assert.equal(Buffer.byteLength(serialized), item.bytes, `${item.name}: byte count`);
    assert.equal(sha256Text(serialized), item.sha256, `${item.name}: sha256`);
  }
});

test("BAFU ENTSO storage-pump name planning remains patch-idempotent", () => {
  const first = splitBafuNamePlan(
    "Electricity, mix, operation storage pumps, ENTSO, summer 2018, at plant, at plant, mix, operation storage pumps, ENTSO, summer 2018, at plant",
    null,
  );
  assert.ok(first);
  const replay = splitBafuNamePlan(`${first.base_name}, ${first.treatment}`, null);
  assert.ok(replay);

  assert.deepEqual(
    {
      base_name: replay.base_name,
      treatment: replay.treatment,
      mix_location: replay.mix_location ?? null,
      flow_property: replay.flow_property ?? null,
      clean_existing_treatment: replay.clean_existing_treatment ?? false,
    },
    {
      base_name: first.base_name,
      treatment: first.treatment,
      mix_location: first.mix_location ?? null,
      flow_property: first.flow_property ?? null,
      clean_existing_treatment: first.clean_existing_treatment ?? false,
    },
  );

  const firstJson = JSON.stringify(first);
  const replayJson = JSON.stringify(replay);
  assert.equal(Buffer.byteLength(firstJson), 285);
  assert.equal(
    sha256Text(firstJson),
    "4a37d6cc04071e7822c160a96e78d0e240ec1a46313ada26e0c198e14e6cf51b",
  );
  assert.equal(Buffer.byteLength(replayJson), 215);
  assert.equal(
    sha256Text(replayJson),
    "a16efdef3a9078764c6c7c92cf4b921adae0ab21de0f1fcef18c7fc899e4252d",
  );
});

test("BAFU functional-unit location cleanup preserves exact multilingual bytes and precedence", () => {
  const cases: FrozenCase[] = [
    {
      name: "english text constructor keeps insertion order",
      actual: englishText("Product"),
      json: '{"@xml:lang":"en","#text":"Product"}',
      bytes: 36,
      sha256: "d14a3e9a77cb167deb3b39514163aa3c621f28f98b3345d650635df27831c176",
    },
    {
      name: "matching trailing location becomes English text",
      actual: removeTrailingLocationToken({ "@xml:lang": "en", "#text": "Product {CH}" }, "CH"),
      json: '{"@xml:lang":"en","#text":"Product"}',
      bytes: 36,
      sha256: "d14a3e9a77cb167deb3b39514163aa3c621f28f98b3345d650635df27831c176",
    },
    {
      name: "mismatched trailing location remains unresolved",
      actual: removeTrailingLocationToken({ "@xml:lang": "en", "#text": "Product {CH}" }, "RER"),
      json: "null",
      bytes: 4,
      sha256: "74234e98afe7498fb5daf1f36ac2d78acc339464f950703b8c019892f982b90b",
    },
    {
      name: "matching inline SimaPro locations are removed before whitespace normalization",
      actual: cleanProcessFunctionalUnitText(
        {
          "@xml:lang": "en",
          "#text":
            "1.0 MJ Refined Waste Cooking Oil {RER} | Refining of waste cooking oil Europe | Alloc Rec, U {RER}",
        },
        "RER",
      ),
      json: '{"@xml:lang":"en","#text":"1.0 MJ Refined Waste Cooking Oil | Refining of waste cooking oil Europe | Alloc Rec, U"}',
      bytes: 115,
      sha256: "baef64a5f423a4ffc9629ab2b458e98e9390ee67bc2b4199d5bc5f07790765ff",
    },
    {
      name: "generated prefix and matching trailing location clean in existing order",
      actual: cleanProcessFunctionalUnitText(
        { "@xml:lang": "en", "#text": "xx 1.0 MJ Product {CH}" },
        "CH",
      ),
      json: '{"@xml:lang":"en","#text":"1.0 MJ Product"}',
      bytes: 43,
      sha256: "8bca0a2ef590e247515aba9052531197f302b39e7ec2d19cab078a19596f4736",
    },
    {
      name: "mismatched inline location remains unchanged",
      actual: cleanProcessFunctionalUnitText(
        { "@xml:lang": "en", "#text": "1.0 MJ Product {CH} mix" },
        "RER",
      ),
      json: "null",
      bytes: 4,
      sha256: "74234e98afe7498fb5daf1f36ac2d78acc339464f950703b8c019892f982b90b",
    },
  ];

  for (const item of cases) {
    const serialized = JSON.stringify(item.actual);
    assert.equal(serialized, item.json, `${item.name}: key order and bytes`);
    assert.equal(Buffer.byteLength(serialized), item.bytes, `${item.name}: byte count`);
    assert.equal(sha256Text(serialized), item.sha256, `${item.name}: sha256`);
  }
});

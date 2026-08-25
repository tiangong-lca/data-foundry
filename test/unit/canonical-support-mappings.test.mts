import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";

import { defaultCanonicalFlowPropertyMappings } from "../../scripts/lib/canonical-support-mappings.mjs";

test("canonical flow-property mappings preserve complete bytes, counts, and pending boundaries", () => {
  const mappings = defaultCanonicalFlowPropertyMappings();
  assert.equal(mappings.length, 15);
  assert.equal(mappings.filter((mapping) => mapping.pending_canonical_support).length, 3);
  assert.equal(mappings.flatMap((mapping) => mapping.source_units).length, 83);
  assert.equal(new Set(mappings.flatMap((mapping) => mapping.source_units)).size, 82);
  assert.equal(
    crypto.createHash("sha256").update(JSON.stringify(mappings)).digest("hex"),
    "8dfb141f6712ec38523379ccd81e2596489cf8ce424e45568200464073c908b4",
  );

  for (const mapping of mappings) {
    assert.ok(mapping.reason);
    assert.ok(mapping.canonical_reference_unit);
    assert.deepEqual(
      [...new Set(mapping.source_units)].sort(),
      Object.keys(mapping.source_unit_scales).sort(),
    );
    assert.ok(
      Object.values(mapping.source_unit_scales).every(
        (scale) => typeof scale === "number" && Number.isFinite(scale) && scale > 0,
      ),
    );
    if (mapping.pending_canonical_support) {
      assert.equal(mapping.canonical_flow_property_id, null);
      assert.match(mapping.pending_upstream_note ?? "", /PENDING UPSTREAM/u);
    } else {
      assert.match(mapping.canonical_flow_property_id ?? "", /^[0-9a-f-]{36}$/u);
    }
  }
});

test("canonical mappings preserve exact reference units and scale factors", () => {
  const mappings = defaultCanonicalFlowPropertyMappings();
  const byUnit = new Map(
    mappings.flatMap((mapping) =>
      Object.entries(mapping.source_unit_scales).map(([unit, scale]) => [
        unit,
        {
          scale,
          referenceUnit: mapping.canonical_reference_unit,
          flowPropertyId: mapping.canonical_flow_property_id,
          pending: Boolean(mapping.pending_canonical_support),
        },
      ]),
    ),
  );
  assert.deepEqual(byUnit.get("kg"), {
    scale: 1,
    referenceUnit: "kg",
    flowPropertyId: "93a60a56-a3c8-11da-a746-0800200b9a66",
    pending: false,
  });
  assert.equal(byUnit.get("g")?.scale, 0.001);
  assert.equal(byUnit.get("mg")?.scale, 1e-6);
  assert.equal(byUnit.get("ug")?.scale, 1e-9);
  assert.equal(byUnit.get("kt")?.scale, 0.0002);
  assert.equal(byUnit.get("dozen(s)")?.scale, 12);
  assert.equal(byUnit.get("km")?.scale, 1000);
  assert.equal(byUnit.get("kwh")?.scale, 3.6);
  assert.equal(byUnit.get("tkm")?.scale, 1000);
  assert.equal(byUnit.get("kmy")?.scale, 1000);
  assert.equal(byUnit.get("hr")?.scale, 1 / 8760);
  assert.equal(byUnit.get("personkm")?.pending, true);
});

test("canonical mapping factory returns independent mutable graphs", () => {
  const first = defaultCanonicalFlowPropertyMappings();
  const second = defaultCanonicalFlowPropertyMappings();
  assert.notStrictEqual(first, second);
  assert.notStrictEqual(first[0], second[0]);
  first[0].source_units.push("mutated");
  first[0].source_unit_scales.kg = 99;
  assert.equal(second[0].source_units.includes("mutated"), false);
  assert.equal(second[0].source_unit_scales.kg, 1);
});

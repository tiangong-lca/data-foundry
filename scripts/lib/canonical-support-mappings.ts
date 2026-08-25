export type CanonicalFlowPropertyMapping = {
  source_units: string[];
  canonical_flow_property_id: string | null;
  canonical_reference_unit: string;
  source_unit_scales: Record<string, number>;
  reason: string;
  pending_canonical_support?: boolean;
  pending_upstream_note?: string;
  legacy_support_note?: string;
};

export function defaultCanonicalFlowPropertyMappings(): CanonicalFlowPropertyMapping[] {
  return [
    {
      source_units: ["kg", "g", "mg", "ug", "t", "kt", "mg"],
      canonical_flow_property_id: "93a60a56-a3c8-11da-a746-0800200b9a66",
      canonical_reference_unit: "kg",
      source_unit_scales: { kg: 1, g: 0.001, mg: 1e-6, ug: 1e-9, t: 1000, kt: 0.0002 },
      reason: "Mass units must reuse the public canonical Mass flow property.",
    },
    {
      source_units: ["p", "unit", "item", "items", "item(s)", "dozen(s)"],
      canonical_flow_property_id: "01846770-4cfe-4a25-8ad9-919d8d378345",
      canonical_reference_unit: "Item(s)",
      source_unit_scales: { p: 1, unit: 1, item: 1, items: 1, "item(s)": 1, "dozen(s)": 12 },
      reason: "Countable-item units must reuse the public canonical Number of items flow property.",
    },
    {
      source_units: ["m", "km", "cm", "mm", "ft", "mi", "in", "yd"],
      canonical_flow_property_id: "838aaa23-0117-11db-92e3-0800200c9a66",
      canonical_reference_unit: "m",
      source_unit_scales: {
        m: 1,
        km: 1000,
        cm: 0.01,
        mm: 0.001,
        ft: 0.3048,
        mi: 1609.347,
        in: 0.0254,
        yd: 0.9144,
      },
      reason: "Length units must reuse the public canonical Length flow property.",
    },
    {
      source_units: ["mj", "kwh", "j", "gj", "mwh", "toe", "kcal", "btu", "tce"],
      canonical_flow_property_id: "93a60a56-a3c8-11da-a746-0800200c9a66",
      canonical_reference_unit: "MJ",
      source_unit_scales: {
        mj: 1,
        kwh: 3.6,
        j: 1e-6,
        gj: 1000,
        mwh: 3600,
        toe: 41868,
        kcal: 0.0041867,
        btu: 0.001055056,
        tce: 29307.6,
      },
      reason:
        "Energy units currently reuse the public canonical Net calorific value support row; this is the existing platform canonical available to imports.",
      legacy_support_note:
        "The public library does not yet expose a generic Energy flow property; do not create an account-local replacement.",
    },
    {
      source_units: ["m3", "nm3", "l", "cuft"],
      canonical_flow_property_id: "93a60a56-a3c8-22da-a746-0800200c9a66",
      canonical_reference_unit: "m3",
      source_unit_scales: { m3: 1, nm3: 1, l: 0.001, cuft: 0.028316846592 },
      reason: "Volume units must reuse the public canonical Volume flow property.",
    },
    {
      source_units: ["m2", "km2", "ha", "ft2", "mi2", "cm2"],
      canonical_flow_property_id: "93a60a56-a3c8-19da-a746-0800200c9a66",
      canonical_reference_unit: "m2",
      source_unit_scales: {
        m2: 1,
        km2: 1000000,
        ha: 10000,
        ft2: 0.09290304,
        mi2: 2589988.11,
        cm2: 0.0001,
      },
      reason: "Area units must reuse the public canonical Area flow property.",
    },
    {
      source_units: ["m2a", "m2*a", "km2*a", "ha*a", "ft2*a", "mi2*a", "m2*d"],
      canonical_flow_property_id: "93a60a56-a3c8-21da-a746-0800200c9a66",
      canonical_reference_unit: "m2*a",
      source_unit_scales: {
        m2a: 1,
        "m2*a": 1,
        "km2*a": 1000000,
        "ha*a": 10000,
        "ft2*a": 0.09290304,
        "mi2*a": 2589988.1,
        "m2*d": 0.002739726,
      },
      reason: "Area*time units must reuse the public canonical Area*time flow property.",
    },
    {
      source_units: ["kbq", "bq", "ci", "rutherford"],
      canonical_flow_property_id: "93a60a56-a3c8-17da-a746-0800200c9a66",
      canonical_reference_unit: "kBq",
      source_unit_scales: { kbq: 1, bq: 0.001, ci: 37000000, rutherford: 1000 },
      reason: "Radioactivity units must reuse the public canonical Radioactivity flow property.",
    },
    {
      source_units: ["tkm", "t*km", "kg*km"],
      canonical_flow_property_id: "118f2a40-50ec-457c-aa60-9bc6b6af9931",
      canonical_reference_unit: "kg*km",
      source_unit_scales: { tkm: 1000, "t*km": 1000, "kg*km": 1 },
      reason: "Mass*distance units must reuse the public canonical mass*distance flow property.",
    },
    {
      source_units: ["m3a", "m3y", "m3*a", "m3*y", "l*a"],
      canonical_flow_property_id: "441238a3-ba09-46ec-b35b-c30cfba746d1",
      canonical_reference_unit: "m3*a",
      source_unit_scales: { m3a: 1, m3y: 1, "m3*a": 1, "m3*y": 1, "l*a": 0.001 },
      reason: "Volume*time units must reuse the public canonical Volume*time flow property.",
    },
    {
      source_units: ["mol"],
      canonical_flow_property_id: "341fd786-b2ad-4552-a762-5eafcab45dee",
      canonical_reference_unit: "mol",
      source_unit_scales: { mol: 1 },
      reason: "Mole units must reuse the public canonical Moles flow property.",
    },
    {
      source_units: ["kg*a", "t*a", "kg*d", "t*d", "kga", "ta", "kgd", "td"],
      canonical_flow_property_id: "b3f0f892-c5a3-4c66-a432-c09e3d1e9bd6",
      canonical_reference_unit: "kg*a",
      source_unit_scales: {
        "kg*a": 1,
        "t*a": 1000,
        "kg*d": 0.002739726,
        "t*d": 2.739726,
        kga: 1,
        ta: 1000,
        kgd: 0.002739726,
        td: 2.739726,
      },
      reason: "Mass*time units must reuse the public canonical Mass*time flow property.",
    },
    {
      source_units: ["my", "m*a", "ma", "kmy", "km*a", "kma"],
      canonical_flow_property_id: null,
      pending_canonical_support: true,
      canonical_reference_unit: "m*a",
      source_unit_scales: { my: 1, "m*a": 1, ma: 1, kmy: 1000, "km*a": 1000, kma: 1000 },
      reason:
        "Length*time units (meter-year / kilometer-year) must reuse a public canonical Length*time flow property once created upstream; kmy = 1000 m*a.",
      pending_upstream_note:
        "PENDING UPSTREAM: create canonical Length*time FP + Units of length*time UG (state_code 100, reference unit m*a, members my=1/kmy=1000), refresh cache, then set canonical_flow_property_id.",
    },
    {
      source_units: ["a", "yr", "year", "hr", "h", "hour"],
      canonical_flow_property_id: null,
      pending_canonical_support: true,
      canonical_reference_unit: "a",
      source_unit_scales: { a: 1, yr: 1, year: 1, hr: 1 / 8760, h: 1 / 8760, hour: 1 / 8760 },
      reason:
        "Time units (year/annum + hour) must reuse a public canonical Time flow property once created upstream; hr = 1/8760 a (365-day year). NOTE: BAFU a = year, NOT are (area).",
      pending_upstream_note:
        "PENDING UPSTREAM: create canonical Time FP + Units of time UG (state_code 100, reference unit a=year NOT are=100 m2, member hr=1/8760). Confirm 365 vs 365.25 vs the canonical UG, then set canonical_flow_property_id.",
    },
    {
      source_units: ["personkm", "person*km", "pkm"],
      canonical_flow_property_id: null,
      pending_canonical_support: true,
      canonical_reference_unit: "personkm",
      source_unit_scales: { personkm: 1, "person*km": 1, pkm: 1 },
      reason:
        "Person*distance (passenger-kilometer) units must reuse a public canonical Person*distance flow property once created upstream. NOT mass*distance (kg*km).",
      pending_upstream_note:
        "PENDING UPSTREAM: create canonical Person*distance FP + Units of person*distance UG (state_code 100, reference unit personkm), refresh cache, then set canonical_flow_property_id.",
    },
  ];
}

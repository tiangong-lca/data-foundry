import test from "node:test";
import { createCanonicalSupportRewriteUtils } from "../../scripts/lib/canonical-support-rewrites.ts";
import { assert, fs, path, readJson, testTmpRoot, writeJson } from "../fixtures/foundry-core.ts";

const fixtureRoot = testTmpRoot("canonical-support-rewrites-test");

// Minimal dependency injection (these are simple utilities the module needs).
function makeUtils() {
  const asText = (v) => {
    if (v === undefined || v === null) return "";
    if (typeof v === "string" || typeof v === "number") return String(v).trim();
    if (typeof v === "object") return asText(v["#text"] ?? v.value ?? "");
    return "";
  };
  return createCanonicalSupportRewriteUtils({
    asText,
    booleanOption: (v) => v === true || v === "true" || v === 1 || v === "1",
    cloneJson: (v) => JSON.parse(JSON.stringify(v)),
    datasetIdentity: (row) => {
      const ds = row?.flowDataSet?.flowInformation?.dataSetInformation ?? {};
      return { id: ds["common:UUID"] ?? null, version: "00.00.001" };
    },
    datasetRowsFileStem: (type) => `${type}s`,
    ensureArray: (v) => (Array.isArray(v) ? v : v == null ? [] : [v]),
    fileExists: (p) => Boolean(p) && fs.existsSync(p),
    multiLang: (text, lang = "en") => ({ "@xml:lang": lang, "#text": text }),
    nowIso: () => "2026-06-13T00:00:00.000Z",
    pathExpression: (parts) => parts.join("."),
    readJson: (p) => JSON.parse(fs.readFileSync(p, "utf8")),
    readRowsFile: (p) =>
      fs
        .readFileSync(p, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((l) => JSON.parse(l)),
    repoRelativeMaybe: (p) => p,
    repoRelativePath: (p) => p,
    resolveRepoPath: (p) => p,
    writeJson: (p, v) => {
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, JSON.stringify(v, null, 2));
    },
    writeJsonLines: (p, rows) => {
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(
        p,
        rows.map((r) => JSON.stringify(r)).join("\n") + (rows.length ? "\n" : ""),
      );
    },
  });
}

const MASS_DISTANCE_FP = "118f2a40-50ec-457c-aa60-9bc6b6af9931";
const MASS_DISTANCE_UG = "3620148f-c5db-48ce-9065-a10092089aca";

function writeCache(dir, { pending = false } = {}) {
  const cache = {
    schema_version: 1,
    flow_properties: [
      {
        id: MASS_DISTANCE_FP,
        version: "01.00.000",
        name: "mass*distance",
        short_description: "mass*distance",
        reference_unit_group: { id: MASS_DISTANCE_UG, short_description: "Unit of kg*km" },
      },
    ],
    unit_groups: [
      {
        id: MASS_DISTANCE_UG,
        version: "29.00.000",
        name: "Unit of kg*km",
        units: [
          { name: "kg*km", mean_value: "1" },
          { name: "t*km", mean_value: "1000" },
        ],
      },
    ],
    flow_property_mappings: [
      {
        source_units: ["tkm", "t*km", "kg*km"],
        canonical_flow_property_id: MASS_DISTANCE_FP,
        canonical_reference_unit: "kg*km",
        source_unit_scales: { tkm: 1000, "t*km": 1000, "kg*km": 1 },
        reason: "Mass*distance units must reuse the public canonical mass*distance flow property.",
      },
      ...(pending
        ? [
            {
              source_units: ["personkm", "person*km", "pkm"],
              canonical_flow_property_id: null,
              pending_canonical_support: true,
              canonical_reference_unit: "personkm",
              source_unit_scales: { personkm: 1, "person*km": 1, pkm: 1 },
              reason: "Person*distance units need an upstream canonical flow property.",
              pending_upstream_note: "PENDING UPSTREAM: create Person*distance FP/UG.",
            },
          ]
        : []),
    ],
  };
  const cachePath = path.join(dir, "support-cache.json");
  writeJson(cachePath, cache);
  return cachePath;
}

function flowRow(uuid, unit) {
  return {
    flowDataSet: {
      flowInformation: { dataSetInformation: { "common:UUID": uuid } },
      flowProperties: {
        flowProperty: {
          "@dataSetInternalID": "1",
          referenceToFlowPropertyDataSet: {
            "@type": "flow property data set",
            "@refObjectId": "local-amount-in",
            "@version": "00.00.001",
            "common:shortDescription": { "@xml:lang": "en", "#text": `Amount in ${unit}` },
          },
          meanValue: "1",
        },
      },
    },
  };
}

function run(dir, rows, options = {}) {
  const utils = makeUtils();
  const rowsFile = path.join(dir, "flows.jsonl");
  fs.writeFileSync(rowsFile, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
  const report = utils.applyCanonicalSupportRewrites({
    datasetType: "flow",
    rowsFile,
    outDir: path.join(dir, "out"),
    options: { canonicalSupportCache: writeCache(dir, options), ...options },
  });
  return report;
}

test("canonical support rewrite records scale!=1 and surfaces (does not block by default)", () => {
  const dir = path.join(fixtureRoot, "scale-surface");
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const report = run(dir, [flowRow("11111111-1111-4111-8111-111111111111", "tkm")]);

  assert.equal(report.status, "completed");
  assert.equal(report.counts.canonical_flow_property_reference_rewrites, 1);
  assert.equal(report.counts.amount_scaling_required_rewrites, 1);
  assert.equal(report.counts.amount_scaling_blocked, 0);
  assert.equal(report.counts.blockers, 0);
  assert.equal(report.amount_scaling_requirements.length, 1);
  const req = report.amount_scaling_requirements[0];
  assert.equal(req.source_unit, "tkm");
  assert.equal(req.canonical_reference_unit, "kg*km");
  assert.equal(req.amount_scale_to_canonical_reference, 1000);
});

test("canonical support rewrite blocks scale!=1 under --block-on-unscaled-canonical-support", () => {
  const dir = path.join(fixtureRoot, "scale-block");
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const report = run(dir, [flowRow("22222222-2222-4222-8222-222222222222", "tkm")], {
    blockOnUnscaledCanonicalSupport: true,
  });

  assert.equal(report.status, "blocked");
  assert.equal(report.counts.amount_scaling_blocked, 1);
  const blocker = report.blockers.find(
    (b) => b.code === "canonical_support_amount_scaling_required",
  );
  assert.ok(blocker, "must emit canonical_support_amount_scaling_required blocker");
  assert.equal(blocker.amount_scale_to_canonical_reference, 1000);
  assert.equal(blocker.source_unit, "tkm");
});

test("canonical support rewrite leaves scale==1 units unflagged", () => {
  const dir = path.join(fixtureRoot, "scale-one");
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const report = run(dir, [flowRow("33333333-3333-4333-8333-333333333333", "kg*km")], {
    blockOnUnscaledCanonicalSupport: true,
  });

  assert.equal(report.status, "completed");
  assert.equal(report.counts.canonical_flow_property_reference_rewrites, 1);
  assert.equal(report.counts.amount_scaling_required_rewrites, 0);
  assert.equal(report.counts.blockers, 0);
  const rewrites = readJson(path.join(dir, "out", "canonical-support-rewrite-report.json"));
  assert.equal(rewrites.amount_scaling_requirements.length, 0);
});

test("canonical support rewrite emits a pending-upstream blocker for not-yet-created canonical support", () => {
  const dir = path.join(fixtureRoot, "pending");
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const report = run(dir, [flowRow("44444444-4444-4444-8444-444444444444", "personkm")], {
    pending: true,
  });

  assert.equal(report.status, "blocked");
  const blocker = report.blockers.find((b) => b.code === "canonical_support_pending_upstream");
  assert.ok(blocker, "must emit canonical_support_pending_upstream for pending mapping");
  assert.equal(blocker.source_unit, "personkm");
  assert.equal(blocker.canonical_reference_unit, "personkm");
  assert.match(blocker.pending_upstream_note, /PENDING UPSTREAM/);
});

test("override suppresses the pending-upstream blocker (mint account-local My Data FP/UG)", () => {
  const dir = path.join(fixtureRoot, "override-pending");
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const report = run(dir, [flowRow("55555555-5555-4555-8555-555555555555", "personkm")], {
    pending: true,
    allowAccountLocalSupportAndElementary: true,
  });
  assert.equal(
    report.blockers.find((b) => b.code === "canonical_support_pending_upstream"),
    undefined,
    "override must suppress canonical_support_pending_upstream",
  );
  assert.notEqual(report.status, "blocked");
  assert.match(report.status, /^completed/u);
  assert.equal(report.policy.no_account_local_support_rows, undefined);
  assert.match(report.policy.public_canonical_first, /public canonical/u);
  assert.match(report.policy.account_local_support_rows, /same-owner state_code=0/u);
  assert.match(report.policy.account_local_support_rows, /guarded owner-draft/u);
  assert.match(report.policy.rewrite_command_boundary, /does not mint or publish/u);
});

// A flow that ALREADY references the canonical FP UUID but at a stale version
// (source @00.00.001 while the cache/written canonical is @01.00.000) must be bumped
// to the canonical version under the override, so downstream remote-verify does not
// report the reference as version_outdated.
function flowRowCanonicalStaleVersion(uuid) {
  return {
    flowDataSet: {
      flowInformation: { dataSetInformation: { "common:UUID": uuid } },
      flowProperties: {
        flowProperty: {
          "@dataSetInternalID": "1",
          referenceToFlowPropertyDataSet: {
            "@type": "flow property data set",
            "@refObjectId": MASS_DISTANCE_FP,
            "@version": "00.00.001",
            "common:shortDescription": { "@xml:lang": "en", "#text": "mass*distance" },
          },
          meanValue: "1",
        },
      },
    },
  };
}

test("override bumps an already-canonical FP reference from a stale version to the cached version", () => {
  const dir = path.join(fixtureRoot, "override-version-bump");
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const report = run(dir, [flowRowCanonicalStaleVersion("77777777-7777-4777-8777-777777777777")], {
    allowAccountLocalSupportAndElementary: true,
  });
  assert.match(report.status, /^completed/u);
  assert.equal(report.counts.canonical_flow_property_reference_rewrites, 1);
  const rows = readJson(path.join(dir, "out", "flows.canonical-support-rewritten.jsonl"));
  // out file is JSONL — read the rewritten flow and assert the FP ref version was bumped.
  const rewritten = fs
    .readFileSync(path.join(dir, "out", "flows.canonical-support-rewritten.jsonl"), "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l))[0];
  const ref = rewritten.flowDataSet.flowProperties.flowProperty.referenceToFlowPropertyDataSet;
  assert.equal(ref["@refObjectId"], MASS_DISTANCE_FP);
  assert.equal(ref["@version"], "01.00.000");
  void rows;
});

test("default (no override) leaves an already-canonical stale-version FP reference untouched", () => {
  const dir = path.join(fixtureRoot, "no-override-no-bump");
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const report = run(dir, [flowRowCanonicalStaleVersion("88888888-8888-4888-8888-888888888888")]);
  assert.equal(report.counts.canonical_flow_property_reference_rewrites, 0);
});

test("override does NOT relax the unit-scale safety blocker (kept blocking)", () => {
  const dir = path.join(fixtureRoot, "override-scale");
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const report = run(dir, [flowRow("66666666-6666-4666-8666-666666666666", "tkm")], {
    blockOnUnscaledCanonicalSupport: true,
    allowAccountLocalSupportAndElementary: true,
  });
  const blocker = report.blockers.find(
    (b) => b.code === "canonical_support_amount_scaling_required",
  );
  assert.ok(blocker, "scale blocker must STILL fire under the override (orthogonal safety guard)");
  assert.equal(blocker.amount_scale_to_canonical_reference, 1000);
});

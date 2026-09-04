import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import * as canonicalSupportRewrites from "../../scripts/lib/canonical-support-rewrites.ts";

type JsonObject = Record<string, unknown>;

const { createCanonicalSupportRewriteUtils } = canonicalSupportRewrites;

function isJsonObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asJsonObject(value: unknown): JsonObject {
  return isJsonObject(value) ? value : {};
}

function nestedValue(value: unknown, ...keys: string[]): unknown {
  let current = value;
  for (const key of keys) {
    if (Array.isArray(current) && /^\d+$/u.test(key)) {
      current = current[Number(key)];
      continue;
    }
    if (!isJsonObject(current)) return undefined;
    current = current[key];
  }
  return current;
}

const canonicalFlowPropertyId = "118f2a40-50ec-457c-aa60-9bc6b6af9931";
const canonicalUnitGroupId = "3620148f-c5db-48ce-9065-a10092089aca";

function toPosix(value: string): string {
  return value.replaceAll("\\", "/");
}

function writeJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function writeJsonLines(filePath: string, rows: unknown[]): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(
    filePath,
    rows.map((row) => JSON.stringify(row)).join("\n") + (rows.length > 0 ? "\n" : ""),
  );
}

function readJson(filePath: string): JsonObject {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function readJsonLines(filePath: string): JsonObject[] {
  const text = fs.readFileSync(filePath, "utf8").trim();
  return text ? text.split(/\r?\n/u).map((line) => JSON.parse(line)) : [];
}

function withTempRoot(name: string, body: (root: string) => void): void {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `${name}-`));
  try {
    body(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function makeUtils(root: string, overrides: { readJson?: (filePath: string) => JsonObject } = {}) {
  const asText = (value: unknown): string => {
    if (value == null) return "";
    if (typeof value === "string" || typeof value === "number") return String(value).trim();
    if (isJsonObject(value)) return asText(value["#text"] ?? value.value ?? "");
    return "";
  };
  return createCanonicalSupportRewriteUtils({
    asText,
    booleanOption: (value: unknown) => value === true || value === "true" || value === 1,
    cloneJson: <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T,
    datasetIdentity: (row: JsonObject) => ({
      id:
        asText(
          nestedValue(row, "flowDataSet", "flowInformation", "dataSetInformation", "common:UUID") ??
            nestedValue(
              row,
              "processDataSet",
              "processInformation",
              "dataSetInformation",
              "common:UUID",
            ),
        ) || null,
      version:
        asText(
          nestedValue(
            row,
            "flowDataSet",
            "administrativeInformation",
            "publicationAndOwnership",
            "common:dataSetVersion",
          ),
        ) || "00.00.001",
    }),
    datasetRowsFileStem: (type: string) => `${type}s`,
    ensureArray: (value: unknown) => (Array.isArray(value) ? value : value == null ? [] : [value]),
    fileExists: (filePath: string | null) =>
      Boolean(filePath) && fs.existsSync(filePath!) && fs.statSync(filePath!).isFile(),
    multiLang: (text: string, language = "en") => ({
      "@xml:lang": language,
      "#text": text,
    }),
    nowIso: () => "2026-08-25T09:10:11.000Z",
    pathExpression: (parts: Array<string | number>) => parts.join("."),
    readJson: overrides.readJson ?? readJson,
    readRowsFile: readJsonLines,
    repoRelativeMaybe: (filePath: string | null) =>
      filePath ? toPosix(path.relative(root, filePath)) : null,
    repoRelativePath: (filePath: string) => toPosix(path.relative(root, filePath)),
    resolveRepoPath: (filePath: unknown) => {
      if (!filePath) return null;
      const text = String(filePath);
      return path.isAbsolute(text) ? text : path.join(root, text);
    },
    writeJson,
    writeJsonLines,
  });
}

function canonicalCache({ includeUnitGroup = true }: { includeUnitGroup?: boolean } = {}) {
  return {
    schema_version: 1,
    flow_properties: [
      {
        id: canonicalFlowPropertyId,
        version: "01.00.000",
        name: "mass*distance",
        short_description: "mass*distance | transport work",
        reference_unit_group: {
          id: canonicalUnitGroupId,
          short_description: "Unit of kg*km",
        },
      },
    ],
    unit_groups: includeUnitGroup
      ? [
          {
            id: canonicalUnitGroupId,
            version: "29.00.000",
            name: "Unit of kg*km",
          },
        ]
      : [],
    flow_property_mappings: [
      {
        source_units: ["t·km", "t.km", "kg*km"],
        canonical_flow_property_id: canonicalFlowPropertyId,
        canonical_reference_unit: "kg*km",
        source_unit_scales: { "t*km": 1000, "kg*km": 1 },
        reason: "Mass-distance maps to public canonical support.",
      },
      {
        source_units: ["personkm", "pkm"],
        canonical_flow_property_id: null,
        pending_canonical_support: true,
        canonical_reference_unit: "personkm",
        source_unit_scales: { personkm: 1, pkm: 1 },
        reason: "Person-distance requires upstream canonical support.",
        pending_upstream_note: "PENDING UPSTREAM: publish the public FP/UG pair.",
      },
    ],
  };
}

function flowRow(id: string, units: string[]) {
  return {
    flowDataSet: {
      flowInformation: { dataSetInformation: { "common:UUID": id } },
      flowProperties: {
        flowProperty: units.map((unit, index) => ({
          "@dataSetInternalID": String(index + 1),
          referenceToFlowPropertyDataSet: {
            "@type": "flow property data set",
            "@refObjectId": `local-${unit}`,
            "@version": "00.00.001",
            "common:shortDescription": {
              "@xml:lang": "en",
              "#text": `Amount in ${unit}`,
            },
          },
          meanValue: String(index + 10),
        })),
      },
      administrativeInformation: {
        publicationAndOwnership: { "common:dataSetVersion": "00.00.001" },
      },
    },
  };
}

function staleCanonicalFlowRow(id: string) {
  const row = flowRow(id, ["kg*km"]);
  const reference = row.flowDataSet.flowProperties.flowProperty[0].referenceToFlowPropertyDataSet;
  reference["@refObjectId"] = canonicalFlowPropertyId;
  reference["@version"] = "00.00.001";
  reference["common:shortDescription"]["#text"] = "mass*distance";
  return row;
}

test("canonical support cache lookup preserves normalized unit mappings, ids, and missing-cache defaults", () => {
  withTempRoot("canonical-support-cache", (root) => {
    const utils = makeUtils(root);
    const missing = utils.loadCanonicalSupportCache({ canonicalSupportCache: "missing.json" });
    assert.equal(missing.cache, null);
    assert.equal(missing.cachePath, path.join(root, "missing.json"));
    assert.equal(missing.index.flowPropertyById.size, 0);
    assert.equal(missing.index.flowPropertyMappingByUnit.size, 0);
    assert.equal(missing.index.unitGroupById.size, 0);

    writeJson(path.join(root, "cache.json"), canonicalCache());
    const loaded = utils.loadCanonicalSupportCache({ supportCache: "cache.json" });
    assert.ok(loaded.cache);
    const flowProperty = loaded.index.flowPropertyById.get(canonicalFlowPropertyId);
    const unitGroup = loaded.index.unitGroupById.get(canonicalUnitGroupId);
    const tonneKilometre = loaded.index.flowPropertyMappingByUnit.get("t*km");
    const personKilometre = loaded.index.flowPropertyMappingByUnit.get("personkm");
    assert.ok(flowProperty);
    assert.ok(unitGroup);
    assert.ok(tonneKilometre);
    assert.ok(personKilometre);
    assert.equal(loaded.cache.schema_version, 1);
    assert.equal(flowProperty.version, "01.00.000");
    assert.equal(unitGroup.version, "29.00.000");
    assert.equal(tonneKilometre.canonicalId, canonicalFlowPropertyId);
    assert.equal(asJsonObject(tonneKilometre.source_unit_scales)["t*km"], 1000);
    assert.equal(personKilometre.canonicalId, "");

    assert.equal(
      utils.supportText({ b: [" value ", { "#text": "nested" }], a: 7 }),
      "value | nested | 7",
    );
    assert.equal(utils.supportText(false), "");
  });
});

test("canonical rewrite preserves traversal order, amount bytes, scale evidence, pending and unresolved blockers", () => {
  withTempRoot("canonical-support-order", (root) => {
    const rowsFile = path.join(root, "inputs", "flows.jsonl");
    const cacheFile = path.join(root, "cache.json");
    const outDir = path.join(root, "out");
    writeJson(cacheFile, canonicalCache());
    writeJsonLines(rowsFile, [
      flowRow("flow-scaled", ["t·km", "kg*km"]),
      flowRow("flow-pending", ["personkm"]),
      flowRow("flow-unresolved", ["mystery-unit"]),
      staleCanonicalFlowRow("flow-stale-default"),
    ]);

    const report = makeUtils(root).applyCanonicalSupportRewrites({
      datasetType: "flow",
      rowsFile,
      outDir,
      options: { canonicalSupportCache: cacheFile, language: "de" },
    });

    assert.deepEqual(Object.keys(report), [
      "schema_version",
      "generated_at_utc",
      "command",
      "stage",
      "status",
      "dataset_type",
      "remote_write_mode",
      "rows_file",
      "output_rows_file",
      "policy",
      "counts",
      "amount_scaling_policy",
      "amount_scaling_requirements",
      "files",
      "blockers",
      "deferred_blockers",
    ]);
    assert.equal(report.status, "blocked");
    assert.deepEqual(report.counts, {
      input_rows: 4,
      output_rows: 4,
      deferred_rows: 0,
      canonical_flow_property_reference_rewrites: 2,
      canonical_unit_group_reference_proofs: 2,
      amount_scaling_required_rewrites: 1,
      amount_scaling_blocked: 0,
      blockers: 2,
      deferred_blockers: 0,
    });
    assert.deepEqual(
      report.blockers.map((blocker: JsonObject) => [
        blocker.code,
        blocker.row_index,
        blocker.source_unit,
      ]),
      [
        ["canonical_support_pending_upstream", 1, "personkm"],
        ["canonical_flow_property_reference_unresolved", 2, "mystery-unit"],
      ],
    );
    assert.deepEqual(report.amount_scaling_requirements, [
      {
        dataset_type: "flow",
        dataset_id: "flow-scaled",
        dataset_version: "00.00.001",
        row_index: 0,
        source_file: "inputs/flows.jsonl",
        path: "flowDataSet.flowProperties.flowProperty.0.referenceToFlowPropertyDataSet",
        source_unit: "t·km",
        canonical_reference_unit: "kg*km",
        amount_scale_to_canonical_reference: 1000,
        note: "Exchange amounts referencing this flow must be multiplied by amount_scale_to_canonical_reference to stay physically correct against the canonical reference unit; canonical-support rewrite does not convert amounts.",
      },
    ]);

    const rewrites = readJsonLines(path.join(outDir, "canonical-support-rewrites.jsonl"));
    assert.deepEqual(
      rewrites.map((row) => ({
        row_index: row.row_index,
        path: row.path,
        source_unit: row.source_unit,
        scale: row.amount_scale_to_canonical_reference,
        scaling: row.amount_scaling_required,
      })),
      [
        {
          row_index: 0,
          path: "flowDataSet.flowProperties.flowProperty.0.referenceToFlowPropertyDataSet",
          source_unit: "t·km",
          scale: 1000,
          scaling: true,
        },
        {
          row_index: 0,
          path: "flowDataSet.flowProperties.flowProperty.1.referenceToFlowPropertyDataSet",
          source_unit: "kg*km",
          scale: 1,
          scaling: false,
        },
      ],
    );
    assert.deepEqual(rewrites[0].canonical_reference_unit_group, {
      proven: true,
      ref_object_id: canonicalUnitGroupId,
      version: "29.00.000",
      short_description: "Unit of kg*km",
    });
    assert.equal(nestedValue(rewrites[0], "canonical", "short_description"), "mass*distance");

    const outputRows = readJsonLines(path.join(outDir, "flows.canonical-support-rewritten.jsonl"));
    const rewrittenProperties = nestedValue(
      outputRows[0],
      "flowDataSet",
      "flowProperties",
      "flowProperty",
    ) as JsonObject[];
    assert.deepEqual(
      rewrittenProperties.map((property: JsonObject) => property.meanValue),
      ["10", "11"],
      "canonical support rewrite must never scale amounts",
    );
    assert.deepEqual(
      rewrittenProperties.map((property: JsonObject) =>
        nestedValue(property, "referenceToFlowPropertyDataSet", "@refObjectId"),
      ),
      [canonicalFlowPropertyId, canonicalFlowPropertyId],
    );
    assert.deepEqual(
      rewrittenProperties.map((property: JsonObject) =>
        nestedValue(
          property,
          "referenceToFlowPropertyDataSet",
          "common:shortDescription",
          "@xml:lang",
        ),
      ),
      ["de", "de"],
    );
    assert.equal(
      nestedValue(
        outputRows[3],
        "flowDataSet",
        "flowProperties",
        "flowProperty",
        "0",
        "referenceToFlowPropertyDataSet",
        "@version",
      ),
      "00.00.001",
      "default policy must not bump an already-canonical stale version",
    );
    assert.equal(report.files.report, "out/canonical-support-rewrite-report.json");
    assert.equal(report.files.canonical_support_cache, "cache.json");
    assert.deepEqual(readJson(path.join(outDir, "canonical-support-rewrite-report.json")), report);
  });
});

test("canonical rewrite defers blocked flow rows while retaining blocker and scaling order", () => {
  withTempRoot("canonical-support-defer", (root) => {
    const rowsFile = path.join(root, "flows.jsonl");
    const cacheFile = path.join(root, "cache.json");
    const outDir = path.join(root, "out");
    writeJson(cacheFile, canonicalCache());
    writeJsonLines(rowsFile, [
      flowRow("flow-scale-blocked", ["t·km"]),
      flowRow("flow-unresolved", ["unknown"]),
    ]);

    const report = makeUtils(root).applyCanonicalSupportRewrites({
      datasetType: "flow",
      rowsFile,
      outDir,
      options: {
        canonicalSupportCache: cacheFile,
        blockOnUnscaledCanonicalSupport: true,
        deferBlockedCanonicalSupportRows: true,
      },
    });

    assert.equal(report.status, "completed_with_deferred_rows");
    assert.deepEqual(report.counts, {
      input_rows: 2,
      output_rows: 0,
      deferred_rows: 2,
      canonical_flow_property_reference_rewrites: 1,
      canonical_unit_group_reference_proofs: 1,
      amount_scaling_required_rewrites: 1,
      amount_scaling_blocked: 1,
      blockers: 0,
      deferred_blockers: 2,
    });
    assert.deepEqual(report.blockers, []);
    assert.deepEqual(
      report.deferred_blockers.map((blocker: JsonObject) => blocker.code),
      ["canonical_support_amount_scaling_required", "canonical_flow_property_reference_unresolved"],
    );
    assert.equal(report.files.deferred_rows, "out/flows.canonical-support-deferred.jsonl");
    assert.deepEqual(
      readJsonLines(path.join(outDir, "flows.canonical-support-rewritten.jsonl")),
      [],
    );
    assert.equal(
      readJsonLines(path.join(outDir, "flows.canonical-support-deferred.jsonl")).length,
      2,
    );
  });
});

test("account-local override bumps stale canonical versions but suppresses pending and unresolved blockers", () => {
  withTempRoot("canonical-support-override", (root) => {
    const rowsFile = path.join(root, "flows.jsonl");
    const cacheFile = path.join(root, "cache.json");
    writeJson(cacheFile, canonicalCache());
    writeJsonLines(rowsFile, [
      staleCanonicalFlowRow("flow-stale"),
      flowRow("flow-pending", ["pkm"]),
      flowRow("flow-unresolved", ["unknown"]),
    ]);

    const report = makeUtils(root).applyCanonicalSupportRewrites({
      datasetType: "flow",
      rowsFile,
      outDir: path.join(root, "out"),
      options: {
        canonicalSupportCache: cacheFile,
        prepareAccountLocalSupportCandidates: true,
      },
    });

    assert.equal(report.status, "completed");
    assert.equal(report.counts.canonical_flow_property_reference_rewrites, 1);
    assert.equal(report.counts.blockers, 0);
    assert.deepEqual(report.blockers, []);
    assert.match(String(report.policy.public_canonical_first), /public canonical/u);
    assert.match(String(report.policy.account_local_support_rows), /same-owner state_code=0/u);
    const rewrite = readJsonLines(path.join(root, "out", "canonical-support-rewrites.jsonl"))[0];
    assert.equal(rewrite.relation, "flow_property_reference_version_bump_to_canonical_support");
    assert.equal(nestedValue(rewrite, "original", "version"), "00.00.001");
    assert.equal(nestedValue(rewrite, "canonical", "version"), "01.00.000");
    assert.equal(rewrite.amount_scale_to_canonical_reference, 1);
  });
});

test("unproven canonical Unit Group remains fail-closed unless the account-local override is explicit", () => {
  withTempRoot("canonical-support-proof", (root) => {
    const rowsFile = path.join(root, "flows.jsonl");
    const cacheFile = path.join(root, "cache.json");
    writeJson(cacheFile, canonicalCache({ includeUnitGroup: false }));
    writeJsonLines(rowsFile, [flowRow("flow-unproven", ["kg*km"])]);
    const utils = makeUtils(root);

    const blocked = utils.applyCanonicalSupportRewrites({
      datasetType: "flow",
      rowsFile,
      outDir: path.join(root, "blocked"),
      options: { canonicalSupportCache: cacheFile },
    });
    assert.equal(blocked.status, "blocked");
    assert.deepEqual(
      blocked.blockers.map((row: JsonObject) => row.code),
      ["canonical_flow_property_unit_group_unproven"],
    );
    assert.equal(blocked.blockers[0].canonical_reference_unit_group_id, canonicalUnitGroupId);
    assert.equal(blocked.counts.canonical_flow_property_reference_rewrites, 0);

    const allowed = utils.applyCanonicalSupportRewrites({
      datasetType: "flow",
      rowsFile,
      outDir: path.join(root, "allowed"),
      options: {
        canonicalSupportCache: cacheFile,
        prepareAccountLocalSupportCandidates: true,
      },
    });
    assert.equal(allowed.status, "completed_no_rewrites");
    assert.deepEqual(allowed.blockers, []);
  });
});

test("account-local override leaves an already-canonical stale version unchanged when Unit Group proof is missing", () => {
  withTempRoot("canonical-stale-unproven-override", (root) => {
    const rowsFile = path.join(root, "flows.jsonl");
    const cacheFile = path.join(root, "cache.json");
    writeJson(cacheFile, canonicalCache({ includeUnitGroup: false }));
    writeJsonLines(rowsFile, [staleCanonicalFlowRow("flow-stale-unproven")]);

    const report = makeUtils(root).applyCanonicalSupportRewrites({
      datasetType: "flow",
      rowsFile,
      outDir: path.join(root, "out"),
      options: {
        canonicalSupportCache: cacheFile,
        prepareAccountLocalSupportCandidates: true,
      },
    });

    assert.equal(report.status, "completed_no_rewrites");
    assert.deepEqual(report.blockers, []);
    assert.equal(report.counts.canonical_flow_property_reference_rewrites, 0);
    assert.equal(report.counts.canonical_unit_group_reference_proofs, 0);
    const output = readJsonLines(path.join(root, "out", "flows.canonical-support-rewritten.jsonl"));
    assert.equal(
      nestedValue(
        output[0],
        "flowDataSet",
        "flowProperties",
        "flowProperty",
        "0",
        "referenceToFlowPropertyDataSet",
        "@version",
      ),
      "00.00.001",
    );
  });
});

test("canonical rewrite retains empty-run artifacts and native JSON/filesystem errors", () => {
  withTempRoot("canonical-support-errors", (root) => {
    const rowsFile = path.join(root, "empty.jsonl");
    writeJsonLines(rowsFile, []);
    const utils = makeUtils(root);
    const empty = utils.applyCanonicalSupportRewrites({
      datasetType: "flow",
      rowsFile,
      outDir: path.join(root, "empty-out"),
      options: { canonicalSupportCache: "missing-cache.json" },
    });
    assert.equal(empty.status, "completed_no_rewrites");
    assert.equal(empty.counts.input_rows, 0);
    assert.equal(empty.files.canonical_support_amount_scaling, null);
    assert.equal(
      fs.readFileSync(
        path.join(root, "empty-out", "flows.canonical-support-rewritten.jsonl"),
        "utf8",
      ),
      "",
    );

    fs.writeFileSync(path.join(root, "bad-cache.json"), "{bad-json}\n");
    assert.throws(
      () => utils.loadCanonicalSupportCache({ canonicalSupportCache: "bad-cache.json" }),
      (error: unknown) => error instanceof SyntaxError,
    );
    assert.throws(
      () =>
        utils.applyCanonicalSupportRewrites({
          datasetType: "flow",
          rowsFile: path.join(root, "missing-rows.jsonl"),
          outDir: path.join(root, "missing-out"),
          options: {},
        }),
      (error: unknown) => error instanceof Error && "code" in error && error.code === "ENOENT",
    );
  });
});

test("canonical rewrite fails closed on missing, non-finite, zero, and negative scale only under the block flag", async (t) => {
  const variants = [
    ["missing", undefined],
    ["nan", Number.NaN],
    ["positive-infinity", Number.POSITIVE_INFINITY],
    ["negative-infinity", Number.NEGATIVE_INFINITY],
    ["zero", 0],
    ["negative", -1],
  ] as const;

  for (const [label, scale] of variants) {
    await t.test(label, () => {
      withTempRoot(`canonical-unresolved-scale-${label}`, (root) => {
        const rowsFile = path.join(root, "flows.jsonl");
        const cacheFile = path.join(root, "cache.json");
        writeJson(cacheFile, {});
        writeJsonLines(rowsFile, [flowRow(`flow-${label}`, ["unresolved-scale-unit"])]);
        const cache = canonicalCache();
        const mapping = cache.flow_property_mappings[0] as JsonObject;
        mapping.source_units = ["unresolved-scale-unit"];
        mapping.source_unit_scales = scale === undefined ? {} : { "unresolved-scale-unit": scale };
        const utils = makeUtils(root, {
          readJson: (filePath) => (filePath === cacheFile ? cache : readJson(filePath)),
        });

        const compatible = utils.applyCanonicalSupportRewrites({
          datasetType: "flow",
          rowsFile,
          outDir: path.join(root, "compatible"),
          options: { canonicalSupportCache: cacheFile },
        });
        assert.notEqual(compatible.status, "blocked");
        assert.deepEqual(compatible.blockers, []);

        const blocked = utils.applyCanonicalSupportRewrites({
          datasetType: "flow",
          rowsFile,
          outDir: path.join(root, "blocked"),
          options: {
            canonicalSupportCache: cacheFile,
            blockOnUnscaledCanonicalSupport: true,
            prepareAccountLocalSupportCandidates: label === "missing",
          },
        });
        assert.equal(blocked.status, "blocked");
        assert.equal(blocked.counts.amount_scaling_unresolved, 1);
        assert.deepEqual(
          blocked.blockers.map((row: JsonObject) => row.code),
          ["canonical_support_amount_scale_unresolved"],
        );
        assert.equal(blocked.blockers[0].scale_resolution_status, "unresolved_scale");
        assert.equal(blocked.blockers[0].source_unit, "unresolved-scale-unit");
        assert.equal(blocked.blockers[0].amount_scale_to_canonical_reference, null);
        assert.equal(blocked.amount_scaling_requirements.length, 1);
        assert.equal(
          blocked.amount_scaling_requirements[0].scale_resolution_status,
          "unresolved_scale",
        );
        const output = readJsonLines(
          path.join(root, "blocked", "flows.canonical-support-rewritten.jsonl"),
        );
        const property = asJsonObject(
          nestedValue(output[0], "flowDataSet", "flowProperties", "flowProperty", "0"),
        );
        assert.equal(
          nestedValue(property, "referenceToFlowPropertyDataSet", "@refObjectId"),
          canonicalFlowPropertyId,
        );
        assert.equal(property.meanValue, "10");
      });
    });
  }
});

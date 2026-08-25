import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import * as bundleSampleModule from "../../scripts/lib/bundle-sample-utils.ts";

type JsonObject = Record<string, any>;

const { createBundleSampleUtils } = bundleSampleModule as Record<string, (...args: any[]) => any>;

function toPosix(value: string): string {
  return value.replaceAll("\\", "/");
}

function sha256Json(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function writeJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function withTempRoot(name: string, body: (root: string) => void): void {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `${name}-`));
  try {
    body(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function makeUtils(root: string, canonicalFormatReference: JsonObject | null = null) {
  const asText = (value: any): string => {
    if (value == null) return "";
    if (typeof value === "string" || typeof value === "number") return String(value).trim();
    if (typeof value === "object") return asText(value["#text"] ?? value.value ?? "");
    return "";
  };
  const multiLang = (text: string, language = "en") => ({
    "@xml:lang": language,
    "#text": text,
  });
  const datasetIdentity = (payload: any, type: string) => {
    if (payload?.__identity) return payload.__identity;
    const roots: Record<string, [string, string]> = {
      contact: ["contactDataSet", "contactInformation"],
      flow: ["flowDataSet", "flowInformation"],
      process: ["processDataSet", "processInformation"],
    };
    const [rootKey, informationKey] = roots[type] ?? ["", ""];
    const root = payload?.[rootKey] ?? {};
    const information = root?.[informationKey]?.dataSetInformation ?? {};
    return {
      id: information["common:UUID"] ?? null,
      version:
        root?.administrativeInformation?.publicationAndOwnership?.["common:dataSetVersion"] ?? null,
    };
  };
  const sourceReferenceSnapshot = (reference: any) => ({
    ref_object_id: reference?.["@refObjectId"] ?? null,
    version: reference?.["@version"] ?? null,
    short_description: asText(reference?.["common:shortDescription"]),
  });
  return createBundleSampleUtils({
    asText,
    bundleClassificationPath: (payload: any) => payload?.__classification ?? null,
    canonicalSourceReferenceForRelation: (relation: string) =>
      relation === "dataset_format_source" ? canonicalFormatReference : null,
    cloneJson: (value: any) => JSON.parse(JSON.stringify(value)),
    contactGlobalReference: ({ id, version, shortDescription, language }: JsonObject) => ({
      "@type": "contact data set",
      "@refObjectId": id,
      "@version": version,
      "@uri": `../contacts/${id}.json`,
      "common:shortDescription": multiLang(shortDescription, language),
    }),
    datasetIdentity,
    deterministicUuid: (seed: string) => `deterministic-${sha256Json(seed).slice(0, 16)}`,
    directoryExists: (directory: string | null) =>
      Boolean(directory) && fs.existsSync(directory!) && fs.statSync(directory!).isDirectory(),
    ensureArray: (value: any) => (Array.isArray(value) ? value : value == null ? [] : [value]),
    fileExists: (filePath: string | null) =>
      Boolean(filePath) && fs.existsSync(filePath!) && fs.statSync(filePath!).isFile(),
    flowClassificationSchemaType: (payload: any) => payload?.__schema_type ?? "flow-product",
    flowTypeOfDataSet: (payload: any) => payload?.__flow_type ?? "Product flow",
    isConvertedDefaultClassification: (classification: any) =>
      classification === "converted-default",
    isObjectEmpty: (value: any) =>
      Boolean(value) && typeof value === "object" && Object.keys(value).length === 0,
    jsonSha256: sha256Json,
    languageForText: () => "en",
    multiLang,
    normalizedList: (value: any) =>
      (Array.isArray(value) ? value : value == null ? [] : String(value).split(","))
        .map((entry: any) => String(entry).trim())
        .filter(Boolean),
    nowIso: () => "2026-08-25T10:11:12.000Z",
    pathExpression: (parts: Array<string | number>) => parts.join("."),
    readJson: (filePath: string) => JSON.parse(fs.readFileSync(filePath, "utf8")),
    repoRelativeMaybe: (filePath: string | null) =>
      filePath ? toPosix(path.relative(root, filePath)) : null,
    repoRelativePath: (filePath: string) => toPosix(path.relative(root, filePath)),
    resolveRepoPath: (filePath: string | null | undefined) =>
      filePath ? (path.isAbsolute(filePath) ? filePath : path.join(root, filePath)) : null,
    sanitizePlaceholderText: (text: string, _path: unknown, stats: JsonObject) => {
      if (text === "<placeholder>") {
        stats.placeholder_sanitizations = Number(stats.placeholder_sanitizations ?? 0) + 1;
        return "";
      }
      return text;
    },
    sourceReferenceSnapshot,
    textValue: asText,
  });
}

function sourceTrace(overrides: JsonObject = {}): JsonObject {
  return {
    sourceClassification: {
      category: "Materials",
      subCategory: "Metals",
      localCategory: "Swiss inventory",
      localSubCategory: "Steel",
    },
    attributes: [
      { name: "name", value: "Source process" },
      { name: "localName", value: "Quellprozess" },
      { name: "location", value: "CH-AG" },
      { name: "unit", value: "kg" },
      { name: "generalComment", value: "Measured source context" },
      { name: "includedProcesses", value: "Mining and transport" },
      { name: "text", value: "Electric furnace" },
      { name: "productionVolume", value: "1,234 kg/year" },
      { name: "version", value: "source revision 2019" },
    ],
    children: [{ name: "endYear", text: "2022" }],
    ...overrides,
  };
}

function processPayload(id = "process-1", version = "00.00.001"): JsonObject {
  return {
    processDataSet: {
      "@xmlns:tidasimport": "https://example.invalid/tidasimport",
      processInformation: {
        dataSetInformation: {
          "common:UUID": id,
          "common:other": {
            "tidasimport:sourceTrace": { payload: sourceTrace() },
          },
        },
        time: { "common:referenceYear": 9999 },
      },
      modellingAndValidation: {
        dataSourcesTreatmentAndRepresentativeness: {
          annualSupplyOrProductionVolume: {
            "@xml:lang": "en",
            "#text": "Not declared in source package",
          },
        },
      },
      administrativeInformation: {
        dataEntryBy: { "common:timeStamp": "2025-01-02T03:04:05+02:00" },
        publicationAndOwnership: { "common:dataSetVersion": version },
      },
      note: "<placeholder>",
    },
  };
}

function flowPayload(id: string, schemaType: string, classification: string): JsonObject {
  return {
    __schema_type: schemaType,
    __classification: classification,
    __flow_type: schemaType === "flow-elementary" ? "Elementary flow" : "Product flow",
    flowDataSet: {
      flowInformation: {
        dataSetInformation: {
          "common:UUID": id,
          name: {
            baseName: { "#text": "Steel scrap" },
            treatmentStandardsRoutes: { "#text": "at sorting plant" },
            mixAndLocationTypes: { "#text": "CH" },
            functionalUnitFlowProperties: { "#text": "Mass" },
          },
        },
      },
      administrativeInformation: {
        publicationAndOwnership: { "common:dataSetVersion": "00.00.001" },
      },
    },
  };
}

test("bundle trace helpers preserve DFS order, first matches, classifications, locations, and authoring context", () => {
  withTempRoot("bundle-trace-contract", (root) => {
    const utils = makeUtils(root);
    const first = sourceTrace();
    const second = sourceTrace({
      sourceClassification: null,
      attributes: [
        { name: "name", value: "Second source" },
        { name: "location", value: "Europe west" },
        { name: "category", value: "Fallback category" },
      ],
    });
    const value = {
      before: { "tidasimport:sourceTrace": { payload: first } },
      nested: [{ after: { "tidasimport:sourceTrace": second } }],
    };
    const traces = utils.collectSourceTracePayloads(value);

    assert.deepEqual(traces, [first, second]);
    assert.equal(utils.sourceTraceAttribute(traces, "name"), "Source process");
    assert.equal(utils.sourceTraceChildText(traces, "endYear"), "2022");
    assert.equal(utils.sourceTraceLocationCode(traces), "CH-AG");
    assert.equal(utils.sourceTraceLocationCode([second]), null);
    assert.deepEqual(utils.processSourceClassificationSummary(traces), {
      category: "Materials",
      subCategory: "Metals",
      localCategory: "Swiss inventory",
      localSubCategory: "Steel",
    });
    assert.deepEqual(utils.processSourceClassificationSummary([second]), {
      category: "Fallback category",
      subCategory: null,
      localCategory: null,
      localSubCategory: null,
    });
    assert.deepEqual(utils.processAuthoringContextFromTrace(traces), {
      source_name: "Source process",
      source_local_name: "Quellprozess",
      source_location: "CH-AG",
      source_unit: "kg",
      general_comment: "Measured source context",
      included_processes: "Mining and transport",
      technology: "Electric furnace",
    });
    assert.deepEqual(utils.flowNameParts(flowPayload("flow-1", "flow-product", "other")), {
      base_name: "Steel scrap",
      treatment_standards_routes: "at sorting plant",
      mix_and_location_types: "CH",
      functional_unit_flow_properties: "Mass",
    });
    assert.deepEqual(utils.flowNameParts(null), {
      base_name: "",
      treatment_standards_routes: "",
      mix_and_location_types: "",
      functional_unit_flow_properties: "",
    });
    assert.equal(utils.sourceTraceAttribute([], "missing"), null);
    assert.equal(utils.sourceTraceChildText([], "missing"), null);
  });
});

test("bundle sanitization preserves source evidence while repairing process year, annual volume, timestamps, and placeholders", () => {
  withTempRoot("bundle-sanitize-contract", (root) => {
    const utils = makeUtils(root);
    const payload = processPayload();
    const collected = utils.collectSourceTracePayloads(payload);
    const stats = {
      timestamp_normalizations: 0,
      reference_year_repairs: 0,
      annual_supply_repairs: 0,
      removed_import_traces: 0,
      removed_import_trace_namespaces: 0,
      placeholder_sanitizations: 0,
    };
    const traceRows: JsonObject[] = [];

    const result = utils.sanitizeBundlePayload(
      payload,
      "process",
      path.join(root, "bundle", "process.json"),
      stats,
      traceRows,
      collected,
    );

    assert.equal(result, payload);
    assert.deepEqual(stats, {
      timestamp_normalizations: 1,
      reference_year_repairs: 1,
      annual_supply_repairs: 1,
      removed_import_traces: 1,
      removed_import_trace_namespaces: 1,
      placeholder_sanitizations: 1,
    });
    assert.equal(payload.processDataSet.processInformation.time["common:referenceYear"], 2022);
    assert.equal(
      payload.processDataSet.modellingAndValidation.dataSourcesTreatmentAndRepresentativeness
        .annualSupplyOrProductionVolume["#text"],
      "1234 kg/year",
    );
    assert.equal(
      payload.processDataSet.administrativeInformation.dataEntryBy["common:timeStamp"],
      "2025-01-02T01:04:05.000Z",
    );
    assert.equal(payload.processDataSet.note, "");
    assert.equal(payload.processDataSet["@xmlns:tidasimport"], undefined);
    assert.equal(
      payload.processDataSet.processInformation.dataSetInformation["common:other"],
      undefined,
    );
    assert.deepEqual(traceRows, [
      {
        dataset_type: "process",
        dataset_id: "process-1",
        dataset_version: "00.00.001",
        source_file: "bundle/process.json",
        path: "processDataSet.processInformation.dataSetInformation.common:other.tidasimport:sourceTrace",
        trace: { payload: sourceTrace() },
      },
    ]);

    assert.equal(
      utils.sanitizeBundlePayload(null, "process", "missing.json", stats, traceRows, []),
      null,
    );
  });
});

test("bundle classification and elementary reuse findings retain queue order and profile override boundaries", () => {
  withTempRoot("bundle-quality-contract", (root) => {
    const utils = makeUtils(root);
    const blockers: JsonObject[] = [];
    const classificationQueueRows: JsonObject[] = [];
    const stats = {
      default_process_classification_blockers: 0,
      default_flow_classification_blockers: 0,
      elementary_flow_reuse_blockers: 0,
    };
    const commands = {
      process: ["process-command"],
      "flow-product": ["flow-command"],
    };
    const traces = [sourceTrace()];
    const process = processPayload("process-default");
    process.__classification = "converted-default";
    const product = flowPayload("flow-default", "flow-product", "converted-default");

    for (const [payload, type, sourceFile] of [
      [process, "process", path.join(root, "process.json")],
      [product, "flow", path.join(root, "flow.json")],
    ] as const) {
      utils.collectBundleQualityFindings({
        payload,
        type,
        sourceFile,
        sourceTraces: traces,
        blockers,
        stats,
        classificationQueueRows,
        classificationCommandsByType: commands,
      });
    }

    assert.deepEqual(
      classificationQueueRows.map((row) => ({
        code: row.code,
        dataset_type: row.dataset_type,
        dataset_id: row.dataset_id,
        schema_type: row.classification_workflow.schema_type,
        commands: row.classification_workflow.commands,
      })),
      [
        {
          code: "process_classification_requires_authoring",
          dataset_type: "process",
          dataset_id: "process-default",
          schema_type: "process",
          commands: ["process-command"],
        },
        {
          code: "flow_classification_requires_authoring",
          dataset_type: "flow",
          dataset_id: "flow-default",
          schema_type: "flow-product",
          commands: ["flow-command"],
        },
      ],
    );
    assert.deepEqual(
      blockers.map((row) => row.code),
      ["process_classification_requires_authoring", "flow_classification_requires_authoring"],
    );
    assert.equal(stats.default_process_classification_blockers, 1);
    assert.equal(stats.default_flow_classification_blockers, 1);

    const elementaryRows: JsonObject[] = [];
    const elementary = flowPayload("elementary-default", "flow-elementary", "converted-default");
    utils.collectBundleQualityFindings({
      payload: elementary,
      type: "flow",
      sourceFile: path.join(root, "elementary.json"),
      sourceTraces: traces,
      blockers,
      stats,
      classificationQueueRows,
      classificationCommandsByType: commands,
    });
    utils.collectElementaryFlowReuseFindings({
      payload: elementary,
      type: "flow",
      sourceFile: path.join(root, "elementary.json"),
      sourceTraces: traces,
      blockers,
      stats,
      elementaryFlowReuseRows: elementaryRows,
    });
    assert.equal(classificationQueueRows.length, 2);
    assert.equal(elementaryRows.length, 1);
    assert.equal(elementaryRows[0].code, "elementary_flow_requires_existing_database_match");
    assert.equal(elementaryRows[0].flow_type, "Elementary flow");
    assert.deepEqual(elementaryRows[0].source_name_fields, {
      base_name: "Steel scrap",
      treatment_standards_routes: "at sorting plant",
      mix_and_location_types: "CH",
      functional_unit_flow_properties: "Mass",
    });
    assert.equal(stats.elementary_flow_reuse_blockers, 1);

    const blockerCount = blockers.length;
    utils.collectElementaryFlowReuseFindings({
      payload: elementary,
      type: "flow",
      sourceFile: path.join(root, "elementary.json"),
      sourceTraces: traces,
      blockers,
      stats,
      elementaryFlowReuseRows: elementaryRows,
      allowAccountLocalSupportAndElementary: true,
    });
    assert.equal(blockers.length, blockerCount);
    assert.equal(elementaryRows.length, 1);
  });
});

test("library contact materialization preserves canonical format proof, self ownership, templates, and profile-specific fallbacks", () => {
  withTempRoot("bundle-contact-contract", (root) => {
    const canonicalFormat = {
      "@type": "source data set",
      "@refObjectId": "canonical-ilcd-format",
      "@version": "01.00.000",
      "@uri": "../sources/canonical-ilcd-format.json",
      "common:shortDescription": { "@xml:lang": "en", "#text": "ILCD format" },
    };
    const oldFormat = {
      "@type": "source data set",
      "@refObjectId": "converted-format",
      "@version": "00.00.001",
      "@uri": "../sources/converted-format.json",
      "common:shortDescription": { "@xml:lang": "en", "#text": "Converted format" },
    };
    const template = {
      contactDataSet: {
        "@version": "9.9",
        "@xmlns": "template-contact",
        "@xmlns:common": "template-common",
        "@xmlns:xsi": "template-xsi",
        "@xsi:schemaLocation": "template schema",
        administrativeInformation: {
          dataEntryBy: { "common:referenceToDataSetFormat": oldFormat },
        },
      },
    };
    const rewriteRows: JsonObject[] = [];
    const stats = { source_reference_rewrites: 0 };
    const utils = makeUtils(root, canonicalFormat);
    const payload = utils.buildLibraryContactPayload(
      {
        profile: "worldsteel",
        libraryContactId: "worldsteel-contact",
        libraryContactVersion: "20.20.002",
        libraryName: "World Steel Association",
        libraryShortName: "worldsteel",
        libraryWebsite: "https://worldsteel.example",
        libraryEmail: "contact@worldsteel.example",
        timestamp: "2024-03-04T05:06:07.000Z",
      },
      template,
      { rewriteRows, stats },
    );

    const rootPayload = payload.contactDataSet;
    const information = rootPayload.contactInformation.dataSetInformation;
    assert.equal(rootPayload["@version"], "9.9");
    assert.equal(rootPayload["@xmlns"], "template-contact");
    assert.equal(information["common:UUID"], "worldsteel-contact");
    assert.equal(information.email, "contact@worldsteel.example");
    assert.equal(
      information.classificationInformation["common:classification"]["common:class"][1]["@classId"],
      "2.4",
    );
    assert.deepEqual(
      rootPayload.administrativeInformation.dataEntryBy["common:referenceToDataSetFormat"],
      canonicalFormat,
    );
    assert.equal(
      rootPayload.administrativeInformation.publicationAndOwnership[
        "common:referenceToOwnershipOfDataSet"
      ]["@refObjectId"],
      "worldsteel-contact",
    );
    assert.equal(stats.source_reference_rewrites, 1);
    assert.deepEqual(rewriteRows, [
      {
        dataset_type: "contact",
        dataset_id: "worldsteel-contact",
        dataset_version: "20.20.002",
        source_file: "foundry:library-contact",
        path: "contactDataSet.administrativeInformation.dataEntryBy.common:referenceToDataSetFormat",
        relation: "dataset_format_source",
        original: {
          ref_object_id: "converted-format",
          version: "00.00.001",
          short_description: "Converted format",
        },
        canonical: {
          ref_object_id: "canonical-ilcd-format",
          version: "01.00.000",
          short_description: "ILCD format",
        },
        reason:
          "Library contact data set format uses the public canonical ILCD format source instead of a converted package-local support source.",
      },
    ]);

    const bafu = makeUtils(root).buildLibraryContactPayload({ profile: "bafu" });
    const bafuRoot = bafu.contactDataSet;
    assert.equal(
      bafuRoot.contactInformation.dataSetInformation["common:UUID"],
      "a6db11f5-1cb4-579a-b503-bd17c361b8c2",
    );
    assert.equal(
      bafuRoot.administrativeInformation.dataEntryBy["common:timeStamp"],
      "2025-01-01T00:00:00.000Z",
    );
    assert.equal(
      bafuRoot.administrativeInformation.dataEntryBy["common:referenceToDataSetFormat"][
        "@refObjectId"
      ],
      "16938856-0a35-5654-8aff-56c17e61da4d",
    );
    assert.equal(
      bafuRoot.contactInformation.dataSetInformation["common:other"]["foundry:libraryContactPolicy"]
        .profile,
      "bafu",
    );
  });
});

test("bundle directory discovery, first contact, explicit selection, and seeded sampling remain deterministic", () => {
  withTempRoot("bundle-selection-contract", (root) => {
    const utils = makeUtils(root);
    const bundlesRoot = path.join(root, "bundles");
    for (const bundleName of ["process-b", "process-a", "invalid"]) {
      const bundleDir = path.join(bundlesRoot, bundleName);
      fs.mkdirSync(path.join(bundleDir, "tidas"), { recursive: true });
      if (bundleName !== "invalid") writeJson(path.join(bundleDir, "manifest.json"), {});
    }
    writeJson(path.join(bundlesRoot, "process-b", "tidas", "contacts", "z.json"), {
      selected: "z",
    });
    writeJson(path.join(bundlesRoot, "process-b", "tidas", "contacts", "a.json"), {
      selected: "a",
    });

    const all = utils.listProcessBundleDirs("bundles");
    assert.deepEqual(
      all.map((directory: string) => path.basename(directory)),
      ["process-a", "process-b"],
    );
    assert.deepEqual(utils.findFirstBundleContactTemplate([all[1], all[0]]), { selected: "a" });
    assert.equal(utils.findFirstBundleContactTemplate([all[0]]), null);

    assert.deepEqual(
      utils.selectProcessBundleDirs(all, { processIds: "process-b,missing,process-a" }),
      {
        seed: null,
        selected: [all[1], all[0]],
        missing_process_ids: ["missing"],
      },
    );
    assert.deepEqual(utils.selectProcessBundleDirs(all, { seed: "stable", sampleSize: "all" }), {
      seed: "stable",
      selected: [...all].sort((left, right) =>
        createHash("sha256")
          .update(`stable:${path.basename(left)}`)
          .digest("hex")
          .localeCompare(
            createHash("sha256")
              .update(`stable:${path.basename(right)}`)
              .digest("hex"),
          ),
      ),
      missing_process_ids: [],
    });
    assert.equal(
      utils.selectProcessBundleDirs(all, { seed: "stable", sampleSize: -2 }).selected.length,
      1,
    );
    assert.throws(
      () => utils.selectProcessBundleDirs(all, { seed: "stable", sampleSize: "not-a-number" }),
      new Error("--sample-size must be a positive number or all."),
    );
    assert.throws(
      () => utils.listProcessBundleDirs("missing"),
      new Error("--bundles-dir is required and must point to a process-bundles directory."),
    );
  });
});

test("bundle row materialization preserves identity keys, insertion order, dedupe, conflict, and missing envelopes", () => {
  withTempRoot("bundle-row-contract", (root) => {
    const utils = makeUtils(root);
    const rowsByType = { process: new Map<string, JsonObject>() };
    const sourceByType = { process: new Map<string, string>() };
    const blockers: JsonObject[] = [];
    const first = processPayload("process-a", "01.00.000");
    const same = JSON.parse(JSON.stringify(first));
    const conflict = JSON.parse(JSON.stringify(first));
    conflict.processDataSet.note = "different";

    assert.equal(
      utils.addDedupedBundleRow({
        rowsByType,
        sourceByType,
        blockers,
        type: "process",
        payload: first,
        sourceFile: path.join(root, "first.json"),
      }),
      true,
    );
    assert.equal(
      utils.addDedupedBundleRow({
        rowsByType,
        sourceByType,
        blockers,
        type: "process",
        payload: same,
        sourceFile: path.join(root, "same.json"),
      }),
      false,
    );
    assert.equal(
      utils.addDedupedBundleRow({
        rowsByType,
        sourceByType,
        blockers,
        type: "process",
        payload: conflict,
        sourceFile: path.join(root, "conflict.json"),
      }),
      false,
    );
    assert.deepEqual([...rowsByType.process.keys()], ["process-a::01.00.000"]);
    assert.deepEqual(blockers, [
      {
        code: "bundle_row_duplicate_payload_conflict",
        message: "process process-a@01.00.000 appears with different payloads in sampled bundles.",
        kept_source_file: "first.json",
        conflicting_source_file: "conflict.json",
      },
    ]);

    assert.equal(
      utils.addDedupedBundleRow({
        rowsByType,
        sourceByType,
        blockers,
        type: "process",
        payload: { __identity: { id: null, version: null } },
        sourceFile: path.join(root, "missing.json"),
      }),
      false,
    );
    assert.deepEqual(blockers[1], {
      code: "bundle_row_identity_missing",
      message: "process row is missing common:UUID or common:dataSetVersion.",
      source_file: "missing.json",
      id: null,
      version: null,
    });
  });
});

test("bundle sample factory retains its exact helper surface", () => {
  withTempRoot("bundle-export-contract", (root) => {
    assert.deepEqual(Object.keys(makeUtils(root)), [
      "addDedupedBundleRow",
      "buildLibraryContactPayload",
      "collectBundleQualityFindings",
      "collectElementaryFlowReuseFindings",
      "collectSourceTracePayloads",
      "findFirstBundleContactTemplate",
      "flowNameParts",
      "listProcessBundleDirs",
      "processAuthoringContextFromTrace",
      "processSourceClassificationSummary",
      "sanitizeBundlePayload",
      "selectProcessBundleDirs",
      "sourceTraceAttribute",
      "sourceTraceChildText",
      "sourceTraceLocationCode",
    ]);
  });
});

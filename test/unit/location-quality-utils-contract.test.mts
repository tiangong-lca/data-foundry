import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import * as locationModule from "../../scripts/lib/location-quality-utils.mjs";

type JsonObject = Record<string, any>;

const { createLocationQualityUtils } = locationModule as Record<string, (...args: any[]) => any>;

const bundleRowTypes = {
  contact: { plural: "contacts" },
  source: { plural: "sources" },
  unitgroup: { plural: "unitgroups" },
  flowproperty: { plural: "flowproperties" },
  flow: { plural: "flows" },
  process: { plural: "processes" },
  lifecyclemodel: { plural: "lifecyclemodels" },
};

function shellQuote(value: unknown): string {
  const text = String(value ?? "");
  if (/^[A-Za-z0-9_./:@%+=,-]+$/u.test(text)) return text;
  return `'${text.replace(/'/gu, `'\\''`)}'`;
}

function makeUtils({
  fileExists = (filePath: string) => fs.existsSync(filePath),
  directoryExists = (directory: string) => fs.existsSync(directory),
  readJson = (filePath: string) => JSON.parse(fs.readFileSync(filePath, "utf8")),
}: {
  fileExists?: (filePath: string) => boolean;
  directoryExists?: (directory: string) => boolean;
  readJson?: (filePath: string) => JsonObject;
} = {}) {
  const asText = (value: any): string => {
    if (value == null) return "";
    if (typeof value === "string" || typeof value === "number") return String(value).trim();
    if (typeof value === "object") return asText(value["#text"] ?? value.value ?? "");
    return "";
  };
  return createLocationQualityUtils({
    asText,
    bundleRowTypes,
    datasetIdentity: (payload: JsonObject, type: string) => ({
      id: payload.__identity?.id ?? `${type}-id`,
      version: payload.__identity?.version ?? "00.00.001",
    }),
    directoryExists,
    ensureArray: (value: any) => (Array.isArray(value) ? value : value == null ? [] : [value]),
    fileExists,
    pathExpression: (parts: Array<string | number>) => parts.join("."),
    readJson,
    repoRelativeMaybe: (filePath: string | null) => filePath,
    repoRelativePath: (filePath: string) => filePath.replace(/^\/repo\//u, ""),
    shellQuote,
  });
}

test("classification authoring commands preserve CLI prefix, row-type override, paths, and exact argv rendering", () => {
  const utils = makeUtils();
  assert.deepEqual(
    utils.classificationAuthoringCommands({
      cliBin: ["node", "/cli/tiangong-lca.js"],
      outDir: "/repo/out",
      rowsDir: "/repo/rows",
      type: "flow-product",
      rowType: "flow",
    }),
    {
      children_root:
        "node /cli/tiangong-lca.js dataset classification children --type flow-product --out-dir /repo/out/classification/flow-product --json",
      children_next_template:
        "node /cli/tiangong-lca.js dataset classification children --type flow-product --parent <parent-code> --out-dir /repo/out/classification/flow-product --json",
      path_template:
        "node /cli/tiangong-lca.js dataset classification path --type flow-product --code <selected-code> --out-dir /repo/out/classification/flow-product --json",
      apply:
        "node /cli/tiangong-lca.js dataset classification apply --input /repo/rows/flows.jsonl --decisions /repo/out/flow-product-classification-decisions.jsonl --out /repo/rows/flows.classified.jsonl --type flow-product --out-dir /repo/out/classification/flow-product --json",
      decision_file: "out/flow-product-classification-decisions.jsonl",
      input_rows: "rows/flows.jsonl",
      output_rows: "rows/flows.classified.jsonl",
    },
  );

  const processCommands = utils.classificationAuthoringCommands({
    cliBin: "tiangong-lca",
    outDir: "/repo/out folder",
    rowsDir: "/repo/rows",
    type: "process",
  });
  assert.match(processCommands.children_root, /^tiangong-lca dataset classification children/u);
  assert.match(processCommands.children_root, /'\/repo\/out folder\/classification\/process'/u);
  assert.match(processCommands.apply, /--input \/repo\/rows\/processes\.jsonl/u);
  assert.throws(
    () =>
      utils.classificationAuthoringCommands({
        cliBin: "tiangong-lca",
        outDir: "/repo/out",
        rowsDir: "/repo/rows",
        type: "unknown",
      }),
    (error: unknown) => error instanceof TypeError,
  );
});

test("location authoring commands preserve audit, lookup, apply, and artifact contracts", () => {
  const commands = makeUtils().locationAuthoringCommands({
    cliBin: ["node", "/cli/tiangong-lca.js"],
    outDir: "/repo/out",
    rowsDir: "/repo/rows",
    type: "process",
  });
  assert.deepEqual(commands, {
    audit:
      "node /cli/tiangong-lca.js dataset classification audit --type location --input /repo/rows/processes.jsonl --out-dir /repo/out/classification/location/process --json",
    children_root:
      "node /cli/tiangong-lca.js dataset classification children --type location --out-dir /repo/out/classification/location/process --json",
    path_template:
      "node /cli/tiangong-lca.js dataset classification path --type location --code <selected-location-code> --out-dir /repo/out/classification/location/process --json",
    apply:
      "node /cli/tiangong-lca.js dataset classification apply --input /repo/rows/processes.jsonl --decisions /repo/out/process-location-decisions.jsonl --out /repo/rows/processes.located.jsonl --type location --out-dir /repo/out/classification/location/process --json",
    decision_file: "out/process-location-decisions.jsonl",
    input_rows: "rows/processes.jsonl",
    output_rows: "rows/processes.located.jsonl",
  });
});

test("installed location schema map is complete, trimmed, stable, and missing-safe", () => {
  const loaded = makeUtils().loadTidasLocationCodeMap();
  assert.ok(loaded.size > 100);
  assert.equal(typeof loaded.get("CH"), "string");
  assert.equal(typeof loaded.get("GLO"), "string");
  assert.equal(loaded.has(""), false);
  assert.deepEqual([...loaded.keys()], [...loaded.keys()].filter(Boolean));

  const missing = makeUtils({ fileExists: () => false }).loadTidasLocationCodeMap();
  assert.deepEqual([...missing.entries()], []);
});

test("location findings preserve DFS target order, schema/fallback keys, counts, queues, blockers, and invalid values", () => {
  const utils = makeUtils({ directoryExists: () => false });
  const payload = {
    __identity: { id: "process-1", version: "01.02.003" },
    processDataSet: {
      geography: {
        "@location": " CH ",
        nested: [
          { locationOfSupply: { "#text": "UNKNOWN-A" } },
          { impactLocation: "DE" },
          { impactSubLocation: { "#text": " UNKNOWN-B " } },
          { intervensionSubLocation: "UNKNOWN-C" },
          { location: 7 },
        ],
      },
    },
  };
  const blockers: JsonObject[] = [];
  const locationQueueRows: JsonObject[] = [];
  const stats = { location_code_targets: 0, location_code_valid: 0, location_code_blockers: 0 };
  const locationCommands = { audit: "audit", apply: "apply" };

  utils.collectLocationQualityFindings({
    payload,
    type: "process",
    sourceFile: "/repo/source/process.json",
    blockers,
    stats,
    locationQueueRows,
    locationCodeMap: new Map([
      ["CH", "Switzerland"],
      ["DE", "Germany"],
    ]),
    locationCommands,
  });

  assert.deepEqual(stats, {
    location_code_targets: 5,
    location_code_valid: 2,
    location_code_blockers: 3,
  });
  assert.deepEqual(
    locationQueueRows.map((row) => ({
      path: row.path,
      current_location: row.current_location,
      dataset_id: row.dataset_id,
      dataset_version: row.dataset_version,
      source_file: row.source_file,
    })),
    [
      {
        path: "processDataSet.geography.nested.0.locationOfSupply.#text",
        current_location: "UNKNOWN-A",
        dataset_id: "process-1",
        dataset_version: "01.02.003",
        source_file: "/repo/source/process.json",
      },
      {
        path: "processDataSet.geography.nested.2.impactSubLocation.#text",
        current_location: "UNKNOWN-B",
        dataset_id: "process-1",
        dataset_version: "01.02.003",
        source_file: "/repo/source/process.json",
      },
      {
        path: "processDataSet.geography.nested.3.intervensionSubLocation",
        current_location: "UNKNOWN-C",
        dataset_id: "process-1",
        dataset_version: "01.02.003",
        source_file: "/repo/source/process.json",
      },
    ],
  );
  assert.deepEqual(
    locationQueueRows.map((row) => row.location_workflow),
    locationQueueRows.map(() => ({
      schema_type: "location",
      commands: locationCommands,
      decision_contract: {
        required_selector: "row_index or dataset_id",
        required_location: "code from tidas_locations_category.json",
        required_target_path:
          "target_path is required when a row contains more than one location field",
        optional_fields: ["basis", "evidence"],
      },
    })),
  );
  assert.deepEqual(
    blockers.map((row) => ({
      code: row.code,
      path: row.path,
      current_location: row.current_location,
      queue: row.queue,
    })),
    locationQueueRows.map((row) => ({
      code: "location_code_requires_authoring",
      path: row.path,
      current_location: row.current_location,
      queue: "location-authoring-queue.jsonl",
    })),
  );
});

test("location quality factory retains its exact public helper surface", () => {
  assert.deepEqual(Object.keys(makeUtils()), [
    "classificationAuthoringCommands",
    "collectLocationQualityFindings",
    "loadTidasLocationCodeMap",
    "locationAuthoringCommands",
  ]);
});

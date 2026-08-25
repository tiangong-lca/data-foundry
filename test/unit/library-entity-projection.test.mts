import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  createLibraryEntityProjection,
  type EntityRow,
  type JsonRecord,
} from "../../scripts/lib/library-orchestration/entity-projection.ts";

const version = "00.00.001";
const ids = {
  process: "11111111-1111-5111-8111-111111111111",
  flow: "22222222-2222-5222-8222-222222222222",
  missingFlow: "33333333-3333-5333-8333-333333333333",
  flowProperty: "44444444-4444-5444-8444-444444444444",
  unitGroup: "55555555-5555-5555-8555-555555555555",
};

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : {};
}

function asText(value: unknown): string {
  return String(value ?? "").trim();
}

function textValue(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value)) return value.map(textValue).find(Boolean) ?? "";
  return asText(record(value)["#text"]);
}

function ensureArray<T>(value: T | readonly T[] | null | undefined): T[] {
  if (value === null || value === undefined) return [];
  return Array.isArray(value) ? [...value] : [value as T];
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function datasetRoot(payload: JsonRecord, type: string): JsonRecord {
  const rootKeys: Record<string, string> = {
    process: "processDataSet",
    flow: "flowDataSet",
    flowproperty: "flowPropertyDataSet",
    unitgroup: "unitGroupDataSet",
  };
  return record(payload[rootKeys[type] ?? ""]);
}

function datasetInformation(payload: JsonRecord, type: string): JsonRecord {
  const root = datasetRoot(payload, type);
  if (type === "process") {
    return record(record(root.processInformation).dataSetInformation);
  }
  if (type === "flow") return record(record(root.flowInformation).dataSetInformation);
  if (type === "flowproperty") {
    return record(record(root.flowPropertiesInformation).dataSetInformation);
  }
  return record(record(root.unitGroupInformation).dataSetInformation);
}

function datasetIdentity(payload: JsonRecord, type: string) {
  const root = datasetRoot(payload, type);
  return {
    id: asText(datasetInformation(payload, type)["common:UUID"]),
    version:
      asText(
        record(record(root.administrativeInformation).publicationAndOwnership)[
          "common:dataSetVersion"
        ],
      ) || version,
  };
}

function ml(text: string): JsonRecord {
  return { "@xml:lang": "en", "#text": text };
}

function admin(): JsonRecord {
  return {
    administrativeInformation: {
      publicationAndOwnership: { "common:dataSetVersion": version },
    },
  };
}

function processPayload(): JsonRecord {
  return {
    processDataSet: {
      processInformation: {
        dataSetInformation: {
          "common:UUID": ids.process,
          name: { baseName: ml("Projection process") },
        },
      },
      exchanges: {
        exchange: [
          {
            exchangeDirection: "Output",
            meanAmount: "1",
            referenceToFlowDataSet: {
              "@refObjectId": ids.flow,
              "@version": version,
              "common:shortDescription": ml("Projection product"),
            },
          },
          {
            exchangeDirection: "Input",
            meanAmount: "2",
            referenceToFlowDataSet: {
              "@refObjectId": ids.missingFlow,
              "@version": version,
              "common:shortDescription": ml("Missing dependency"),
            },
          },
        ],
      },
      ...admin(),
    },
  };
}

function flowPayload(): JsonRecord {
  return {
    flowDataSet: {
      flowInformation: {
        dataSetInformation: {
          "common:UUID": ids.flow,
          name: { baseName: ml("Projection product") },
        },
      },
      modellingAndValidation: { LCIMethod: { typeOfDataSet: "Product flow" } },
      flowProperties: {
        flowProperty: {
          "@dataSetInternalID": "1",
          meanValue: "1",
          referenceToFlowPropertyDataSet: {
            "@refObjectId": ids.flowProperty,
            "@version": version,
            "common:shortDescription": ml("Mass"),
          },
        },
      },
      ...admin(),
    },
  };
}

function flowPropertyPayload(): JsonRecord {
  return {
    flowPropertyDataSet: {
      flowPropertiesInformation: {
        dataSetInformation: {
          "common:UUID": ids.flowProperty,
          "common:name": ml("Mass"),
        },
        quantitativeReference: {
          referenceToReferenceUnitGroup: {
            "@refObjectId": ids.unitGroup,
            "@version": version,
            "common:shortDescription": ml("Units of mass"),
          },
        },
      },
      ...admin(),
    },
  };
}

function unitGroupPayload(): JsonRecord {
  return {
    unitGroupDataSet: {
      unitGroupInformation: {
        dataSetInformation: {
          "common:UUID": ids.unitGroup,
          "common:name": ml("Units of mass"),
        },
      },
      units: {
        unit: { "@dataSetInternalID": "1", name: ml("kg"), meanValue: "1" },
      },
      ...admin(),
    },
  };
}

function writeJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "foundry-entity-projection-"));
  const paths = {
    process: path.join(root, "tidas/processes/process.json"),
    flow: path.join(root, "tidas/flows/a-flow.json"),
    flowDuplicate: path.join(root, "tidas/flows/z-flow-copy.json"),
    flowProperty: path.join(root, "tidas/flowproperties/property.json"),
    unitGroup: path.join(root, "tidas/unitgroups/unit-group.json"),
    bundleDir: path.join(root, "process-bundles/bundle-a"),
  };
  writeJson(paths.process, processPayload());
  writeJson(paths.flow, flowPayload());
  writeJson(paths.flowDuplicate, flowPayload());
  writeJson(paths.flowProperty, flowPropertyPayload());
  writeJson(paths.unitGroup, unitGroupPayload());
  const bundleProcess = path.join(paths.bundleDir, "tidas/processes/process.json");
  const bundleFlow = path.join(paths.bundleDir, "tidas/flows/flow.json");
  writeJson(bundleProcess, processPayload());
  writeJson(bundleFlow, flowPayload());
  const manifest = path.join(paths.bundleDir, "manifest.json");
  writeJson(manifest, {
    schema_version: 1,
    files: {
      processes: ["tidas/processes/process.json"],
      flows: ["tidas/flows/flow.json", "tidas/flows/absent.json"],
      flowproperties: [],
      unitgroups: [],
    },
    unresolved_references: [{ type: "flow", id: ids.missingFlow, version, source: "converter" }],
  });
  const relative = (filePath: string): string =>
    path.relative(root, filePath).replaceAll("\\", "/");
  const projection = createLibraryEntityProjection({
    asText,
    bundleClassificationPath: () => "",
    datasetIdentity,
    ensureArray,
    flowTypeOfDataSet: (payload) =>
      asText(
        record(record(record(record(payload).flowDataSet).modellingAndValidation).LCIMethod)
          .typeOfDataSet,
      ),
    jsonSha256: (value) => sha256(JSON.stringify(value)),
    repoRelativeMaybe: (filePath) => (filePath ? relative(filePath) : null),
    repoRelativePath: relative,
    sha256Text: sha256,
    textValue,
    files: {
      fileExists: fs.existsSync,
      readJson: (filePath) => JSON.parse(fs.readFileSync(filePath, "utf8")) as JsonRecord,
    },
  });
  return { root, paths, manifest, projection };
}

test("entity projection deduplicates ordered real TIDAS rows and preserves unresolved closure", (t) => {
  const { root, paths, manifest, projection } = fixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const entityRows = projection.buildEntityIndex([
    { type: "process", sourceFile: paths.process, sourceKind: "root_tidas" },
    { type: "flow", sourceFile: paths.flow, sourceKind: "root_tidas" },
    { type: "flow", sourceFile: paths.flowDuplicate, sourceKind: "root_tidas" },
    { type: "flowproperty", sourceFile: paths.flowProperty, sourceKind: "root_tidas" },
    { type: "unitgroup", sourceFile: paths.unitGroup, sourceKind: "root_tidas" },
  ]);

  assert.deepEqual(
    entityRows.map((row) => row.entity_key),
    [
      `flow:${ids.flow}:${version}`,
      `flowproperty:${ids.flowProperty}:${version}`,
      `process:${ids.process}:${version}`,
      `unitgroup:${ids.unitGroup}:${version}`,
    ],
  );
  const deduplicatedFlow = entityRows[0] as EntityRow;
  assert.deepEqual(deduplicatedFlow.source_files, [
    "tidas/flows/a-flow.json",
    "tidas/flows/z-flow-copy.json",
  ]);
  assert.equal(deduplicatedFlow.duplicate_source_file_count, 2);
  assert.deepEqual(deduplicatedFlow.payload_hashes, [deduplicatedFlow.payload_sha256]);

  const actual = projection.projectionForBundle(
    {
      process_id: ids.process,
      bundle_id: "bundle-a",
      bundle_dir: paths.bundleDir,
      manifest,
      tidas_dir: path.join(paths.bundleDir, "tidas"),
    },
    projection.entityMaps(entityRows),
  );
  const exactJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify({
    schema_version: 1,
    process_id: ids.process,
    process_version: version,
    process_entity_key: `process:${ids.process}:${version}`,
    process_file: "process-bundles/bundle-a/tidas/processes/process.json",
    bundle_dir: "process-bundles/bundle-a",
    manifest: "process-bundles/bundle-a/manifest.json",
    tidas_dir: "process-bundles/bundle-a/tidas",
    dependency_ids: {
      flows: [
        {
          id: ids.flow,
          version,
          source: "process_exchange",
          exchange_index: 0,
          entity_key: `flow:${ids.flow}:${version}`,
          flow_type: "Product flow",
          reference_only: false,
        },
        {
          id: ids.missingFlow,
          version,
          source: "process_exchange",
          exchange_index: 1,
          entity_key: `flow:${ids.missingFlow}:${version}`,
          flow_type: null,
          reference_only: false,
        },
      ],
      flowproperties: [
        {
          id: ids.flowProperty,
          version,
          source: "flow_property_ref",
          parent_flow_id: ids.flow,
          entity_key: `flowproperty:${ids.flowProperty}:${version}`,
          reference_only: true,
        },
      ],
      unitgroups: [
        {
          id: ids.unitGroup,
          version,
          source: "flowproperty_reference_unit_group",
          parent_flow_property_id: ids.flowProperty,
          entity_key: `unitgroup:${ids.unitGroup}:${version}`,
          reference_only: true,
        },
      ],
    },
    usage_refs: {
      process_exchange_flow_refs: [
        {
          exchange_index: 0,
          flow_id: ids.flow,
          flow_version: version,
          direction: "Output",
          amount: "1",
          short_description: "Projection product",
        },
        {
          exchange_index: 1,
          flow_id: ids.missingFlow,
          flow_version: version,
          direction: "Input",
          amount: "2",
          short_description: "Missing dependency",
        },
      ],
    },
    estimated_weight: 7,
    closure_status: "planned",
    unresolved_references: [{ type: "flow", id: ids.missingFlow, version, source: "converter" }],
  });
  assert.equal(exactJson, expectedJson);
  assert.equal(
    sha256(exactJson),
    "4f554a099e83659d7bc539d535dad1996ce64858695a55facbc0911dad474514",
  );
});

test("entity projection preserves native malformed manifest failures", (t) => {
  const { root, paths, manifest, projection } = fixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(manifest, "{not-json\n");
  assert.throws(
    () =>
      projection.projectionForBundle(
        {
          process_id: ids.process,
          bundle_id: "bundle-a",
          bundle_dir: paths.bundleDir,
          manifest,
          tidas_dir: path.join(paths.bundleDir, "tidas"),
        },
        projection.entityMaps([]),
      ),
    SyntaxError,
  );
});

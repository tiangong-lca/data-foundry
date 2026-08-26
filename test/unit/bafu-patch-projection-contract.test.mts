import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  buildNamePatchOperations,
  type JsonRecord,
} from "../../scripts/lib/bafu-authoring/patch-projection.ts";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, "..", "..");
const projectionPath = path.join(
  repoRoot,
  "scripts",
  "lib",
  "bafu-authoring",
  "patch-projection.ts",
);
const ownerPath = path.join(repoRoot, "scripts", "commands", "bafu-auto-authoring.ts");

const flowId = "11111111-2222-4333-8444-555555555555";
const processId = "22222222-3333-4444-8555-666666666666";

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : {};
}

function sha256(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function englishText(value: string): JsonRecord {
  return { "@xml:lang": "en", "#text": value };
}

function flowRow(id: string, baseName: string = "Disposal, flat glass, as building waste") {
  return {
    flowDataSet: {
      flowInformation: {
        dataSetInformation: {
          "common:UUID": id,
          name: {
            baseName: englishText(baseName),
            treatmentStandardsRoutes: englishText("source-described route"),
            mixAndLocationTypes: englishText("CH"),
          },
        },
        geography: { locationOfSupply: "CH" },
        quantitativeReference: { referenceToReferenceFlowProperty: "1" },
      },
      modellingAndValidation: { LCIMethod: { typeOfDataSet: "Product flow" } },
      flowProperties: {
        flowProperty: {
          "@dataSetInternalID": "1",
          referenceToFlowPropertyDataSet: {
            "@refObjectId": "93a60a56-a3c8-11da-a746-0800200b9a66",
            "@version": "03.00.003",
            "common:shortDescription": { "#text": "Mass" },
          },
          meanValue: 1,
        },
      },
      administrativeInformation: {
        publicationAndOwnership: { "common:dataSetVersion": "00.00.001" },
      },
    },
  };
}

function processRow(
  id: string,
  baseName: string = "Disposal, glazing, as building waste",
  locationCode: string = "CH",
) {
  return {
    processDataSet: {
      processInformation: {
        dataSetInformation: {
          "common:UUID": id,
          "common:other": {
            "@xmlns:tidasimport": "https://tiangong.earth/tidas/import-trace/1.0",
            "tidasimport:sourceTrace": {
              payload: {
                format: "ecospold1",
                sourceObject: `process_${id}.xml`,
                sourceClassification: {
                  category: "construction processes",
                  subCategory: "civil engineering",
                },
              },
            },
          },
          name: {
            baseName: englishText(baseName),
            treatmentStandardsRoutes: englishText("source-described route"),
            mixAndLocationTypes: englishText(locationCode),
          },
        },
        geography: {
          locationOfOperationSupplyOrProduction: { "@location": locationCode },
        },
        quantitativeReference: {
          functionalUnitOrOther: englishText(`1.0 m2 ${baseName} {${locationCode}}`),
        },
      },
      exchanges: {
        exchange: [
          {
            referenceToFlowDataSet: {
              "@refObjectId": flowId,
              "@version": "00.00.001",
              "common:shortDescription": englishText(baseName),
            },
            exchangeDirection: "Output",
            meanAmount: 1,
          },
        ],
      },
      administrativeInformation: {
        publicationAndOwnership: { "common:dataSetVersion": "00.00.001" },
      },
    },
  };
}

function flowActions(): JsonRecord[] {
  return [
    {
      code: "semantic_name_treatment_placeholder",
      path: "flowDataSet.flowInformation.dataSetInformation.name.treatmentStandardsRoutes",
      evidence: {
        text: "source-described route",
        current_name: {
          baseName: "Disposal, flat glass, as building waste",
          treatmentStandardsRoutes: "source-described route",
          mixAndLocationTypes: "CH",
        },
      },
      allowed_resolution_modes: ["evidence_backed_completion", "source_language_normalization"],
    },
    {
      code: "semantic_name_mix_location_too_bare",
      path: "flowDataSet.flowInformation.dataSetInformation.name.mixAndLocationTypes",
      evidence: { text: "CH", location_code_candidate: "CH" },
      allowed_resolution_modes: ["location_decision"],
    },
    {
      code: "semantic_content_saturation_flow_quantitative_properties_missing",
      path: "flowDataSet.flowInformation.dataSetInformation.name.flowProperties",
      evidence: {
        reference_flow_properties: ["Mass"],
        suggested_value: englishText("Mass"),
      },
      allowed_resolution_modes: ["evidence_backed_completion"],
    },
  ];
}

function processActions(): JsonRecord[] {
  return [
    {
      code: "semantic_geography_token_in_name",
      path: "processDataSet.processInformation.quantitativeReference.functionalUnitOrOther.#text",
      evidence: { text: "1.0 m2 Disposal, glazing, as building waste {CH}" },
      allowed_resolution_modes: ["source_language_normalization"],
    },
    {
      code: "semantic_name_treatment_placeholder",
      path: "processDataSet.processInformation.dataSetInformation.name.treatmentStandardsRoutes",
      evidence: {
        text: "source-described route",
        current_name: {
          baseName: "Disposal, glazing, as building waste",
          treatmentStandardsRoutes: "source-described route",
          mixAndLocationTypes: "CH",
        },
      },
      allowed_resolution_modes: ["source_language_normalization"],
    },
    {
      code: "semantic_name_mix_location_too_bare",
      path: "processDataSet.processInformation.dataSetInformation.name.mixAndLocationTypes",
      evidence: { text: "CH", location_code_candidate: "CH" },
      allowed_resolution_modes: ["location_decision"],
    },
    {
      code: "semantic_process_only_output_exchange_requires_review",
      path: "processDataSet.exchanges.exchange",
      evidence: { exchange_count: 1, directions: ["Output"] },
      allowed_resolution_modes: ["source_trace_verified", "exchange_set_repaired"],
    },
  ];
}

function task(
  datasetType: "flow" | "process",
  entityId: string,
  sourceRow: JsonRecord,
  actionItems: JsonRecord[],
): JsonRecord {
  return {
    status: "ready_for_ai_authoring",
    entity: {
      dataset_type: datasetType,
      entity_id: entityId,
      version: "00.00.001",
      profile: "bafu",
    },
    context: {
      source_rows_file: `tmp/bafu-patch-projection/${datasetType}s.cleaned.jsonl`,
      authoring_package_sha256: "fixture-authoring-package-sha256",
      full_context_ai_completion: { required: false },
      contract_context_files: [],
      missing_context_files: [],
    },
    action_items: actionItems,
    authoring_package_payload: {
      dataset_type: datasetType,
      entity_id: entityId,
      version: "00.00.001",
      source_row: sourceRow,
    },
  };
}

function operationPaths(operations: JsonRecord[]): unknown[] {
  return operations.map((operation) => operation.path);
}

function evidenceKinds(operations: JsonRecord[]): unknown[] {
  return operations.map((operation) => record(operation.evidence).kind);
}

function actionClosures(operations: JsonRecord[]): unknown[] {
  return operations.map((operation) => operation.closes_action_items);
}

test("patch projection is a pure catalog-injected typed leaf owned by the command adapter", () => {
  const projectionSource = fs.readFileSync(projectionPath, "utf8");
  const ownerSource = fs.readFileSync(ownerPath, "utf8");

  assert.doesNotMatch(
    projectionSource,
    /from\s+["']node:(?:fs|path|child_process|os|net|http|https)["']/u,
  );
  assert.doesNotMatch(
    projectionSource,
    /\bprocess\.(?:env|argv|cwd)|\b(?:fetch|WebSocket|XMLHttpRequest)\s*\(/u,
  );
  assert.doesNotMatch(projectionSource, /locationLabelCache/u);
  assert.match(ownerSource, /from "\.\.\/lib\/bafu-authoring\/patch-projection\.ts"/u);
  assert.match(ownerSource, /buildNamePatchOperations/u);
});

test("real BAFU flow patch projection freezes complete bytes, SHA, evidence, closure and order", () => {
  const operations = buildNamePatchOperations(
    task("flow", flowId, flowRow(flowId), flowActions()),
    { locationLabelCatalog: new Map([["CH", "Switzerland"]]) },
  );
  const bytes = JSON.stringify(operations);

  assert.equal(Buffer.byteLength(bytes, "utf8"), 6028);
  assert.equal(sha256(bytes), "fa9abf7d734508ff9d1915f64ae94eb932227f53095a621a55500588bdc073c5");
  assert.deepEqual(operationPaths(operations), [
    "/flowDataSet/flowInformation/dataSetInformation/name/baseName",
    "/flowDataSet/flowInformation/dataSetInformation/name/treatmentStandardsRoutes",
    "/flowDataSet/flowInformation/dataSetInformation/name/mixAndLocationTypes",
    "/flowDataSet/flowInformation/dataSetInformation/name/flowProperties",
  ]);
  assert.deepEqual(evidenceKinds(operations), [
    "name_plan_split",
    "name_plan_treatment_route",
    "bare_location_name_part_replaced",
    "flow_property_descriptor_from_reference",
  ]);
  assert.deepEqual(actionClosures(operations), [
    [
      {
        code: "semantic_name_treatment_placeholder",
        path: "flowDataSet.flowInformation.dataSetInformation.name.treatmentStandardsRoutes",
      },
    ],
    [
      {
        code: "semantic_name_treatment_placeholder",
        path: "flowDataSet.flowInformation.dataSetInformation.name.treatmentStandardsRoutes",
      },
    ],
    [
      {
        code: "semantic_name_mix_location_too_bare",
        path: "flowDataSet.flowInformation.dataSetInformation.name.mixAndLocationTypes",
      },
    ],
    [
      {
        code: "semantic_content_saturation_flow_quantitative_properties_missing",
        path: "flowDataSet.flowInformation.dataSetInformation.name.flowProperties",
      },
    ],
  ]);
});

test("real BAFU process projection freezes source-completeness bytes and action closure", () => {
  const operations = buildNamePatchOperations(
    task("process", processId, processRow(processId), processActions()),
    { locationLabelCatalog: new Map([["CH", "Switzerland"]]) },
  );
  const bytes = JSON.stringify(operations);

  assert.equal(Buffer.byteLength(bytes, "utf8"), 9625);
  assert.equal(sha256(bytes), "615b5178e4dcf07daf0af6eb34e7b23b96de1bf3f6c62a147e5ddda434295e9a");
  assert.deepEqual(operationPaths(operations), [
    "/processDataSet/processInformation/quantitativeReference/functionalUnitOrOther",
    "/processDataSet/processInformation/dataSetInformation/name/baseName",
    "/processDataSet/processInformation/dataSetInformation/name/treatmentStandardsRoutes",
    "/processDataSet/processInformation/dataSetInformation/name/mixAndLocationTypes",
    "/processDataSet/processInformation/dataSetInformation/common:other",
  ]);
  assert.deepEqual(evidenceKinds(operations), [
    "functional_unit_location_token_removed",
    "name_plan_split",
    "name_plan_treatment_route",
    "bare_location_name_part_replaced",
    "source_only_output_exchange_verified",
  ]);
  const traceRows = record(operations.at(-1)?.value)["tiangongfoundry:sourceExchangeCompleteness"];
  assert.equal(
    Array.isArray(traceRows) ? record(traceRows[0]).status : null,
    "source_only_output_exchange_verified",
  );
  assert.deepEqual(record(operations.at(-1)?.resolution).used_context_kinds, [
    "schema",
    "methodology_yaml",
    "ruleset",
    "classification_schema",
    "location_schema",
  ]);
  assert.deepEqual(operations.at(-1)?.closes_action_items, [
    {
      code: "semantic_process_only_output_exchange_requires_review",
      path: "processDataSet.exchanges.exchange",
    },
  ]);
});

test("bare product and process planning stay source-backed and use the injected catalog per call", () => {
  const productId = "33333333-4444-4555-8666-777777777779";
  const productTask = task("flow", productId, flowRow(productId, "Road, trolleybus"), [
    {
      code: "semantic_name_treatment_placeholder",
      path: "flowDataSet.flowInformation.dataSetInformation.name.treatmentStandardsRoutes",
      evidence: { text: "source-described route" },
    },
    {
      code: "semantic_name_mix_location_too_bare",
      path: "flowDataSet.flowInformation.dataSetInformation.name.mixAndLocationTypes",
      evidence: { text: "CH", location_code_candidate: "CH" },
    },
  ]);
  const processBareId = "44444444-5555-4666-8777-888888888889";
  const bareProcessRow = processRow(processBareId, "Videoconference, laptop, participant", "RER");
  const processTask = task("process", processBareId, bareProcessRow, [
    {
      code: "semantic_name_treatment_placeholder",
      path: "processDataSet.processInformation.dataSetInformation.name.treatmentStandardsRoutes",
      evidence: { text: "source-described route" },
    },
    {
      code: "semantic_name_mix_location_too_bare",
      path: "processDataSet.processInformation.dataSetInformation.name.mixAndLocationTypes",
      evidence: { text: "RER", location_code_candidate: "RER" },
    },
  ]);

  const firstProduct = buildNamePatchOperations(productTask, {
    locationLabelCatalog: new Map([["CH", "Injected Switzerland"]]),
  });
  const secondProduct = buildNamePatchOperations(productTask, {
    locationLabelCatalog: new Map([["CH", "Fresh Switzerland"]]),
  });
  const processOperations = buildNamePatchOperations(processTask, {
    locationLabelCatalog: new Map([["RER", "Europe"]]),
  });

  assert.deepEqual(
    firstProduct.map((operation) => operation.value),
    [
      englishText("Road, trolleybus"),
      englishText("production"),
      englishText("production mix, Injected Switzerland"),
    ],
  );
  assert.equal(record(secondProduct[2]?.value)["#text"], "production mix, Fresh Switzerland");
  assert.deepEqual(
    processOperations.map((operation) => operation.value),
    [
      englishText("Videoconference, laptop, participant"),
      englishText("production"),
      englishText("production process, Europe"),
    ],
  );
});

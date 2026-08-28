import assert from "node:assert/strict";
import test from "node:test";
import { bafuAutoAuthoringTestHooks } from "../../scripts/commands/bafu-auto-authoring.ts";
import {
  fs,
  path,
  readJson,
  readJsonLines,
  rel,
  repoRoot,
  runFoundry,
  sha256Text,
  testTmpRoot,
  writeJson,
  writeJsonLines,
} from "../fixtures/foundry-core.ts";
import type { FixtureRecord } from "../fixtures/foundry-core.ts";

const fixtureRoot = testTmpRoot("bafu-auto-authoring-test");
const flowId = "11111111-2222-4333-8444-555555555555";
const processId = "22222222-3333-4444-8555-666666666666";
const electricityFlowId = "33333333-4444-4555-8666-777777777777";
const electricityProcessId = "44444444-5555-4666-8777-888888888888";

type PatchOperation = FixtureRecord;

type NamePlan = {
  base_name: string;
  treatment: string;
  mix_location?: string;
  flow_property?: string | null;
};

const splitBafuNamePlan = bafuAutoAuthoringTestHooks.splitBafuNamePlan as unknown as (
  name: string,
  locationCode?: string | null,
) => NamePlan;
const splitBafuNamePlanFromNameParts =
  bafuAutoAuthoringTestHooks.splitBafuNamePlanFromNameParts as unknown as (
    parts: Record<string, unknown>,
    locationCode?: string | null,
  ) => NamePlan;
const cleanProcessFunctionalUnitText =
  bafuAutoAuthoringTestHooks.cleanProcessFunctionalUnitText as unknown as (
    value: Record<string, unknown>,
    locationCode?: string | null,
  ) => Record<string, unknown> | null;

function flowRow(id: string = flowId) {
  return {
    flowDataSet: {
      flowInformation: {
        dataSetInformation: {
          "common:UUID": id,
          name: {
            baseName: { "@xml:lang": "en", "#text": "Disposal, flat glass, as building waste" },
            treatmentStandardsRoutes: { "@xml:lang": "en", "#text": "source-described route" },
            mixAndLocationTypes: { "@xml:lang": "en", "#text": "CH" },
          },
        },
        geography: {
          locationOfSupply: "CH",
        },
        quantitativeReference: {
          referenceToReferenceFlowProperty: "1",
        },
      },
      modellingAndValidation: {
        LCIMethod: {
          typeOfDataSet: "Product flow",
        },
      },
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
        publicationAndOwnership: {
          "common:dataSetVersion": "00.00.001",
        },
      },
    },
  };
}

function processRow(id: string = processId) {
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
            baseName: {
              "@xml:lang": "en",
              "#text": "Disposal, glazing, as building waste",
            },
            treatmentStandardsRoutes: { "@xml:lang": "en", "#text": "source-described route" },
            mixAndLocationTypes: { "@xml:lang": "en", "#text": "CH" },
          },
        },
        geography: {
          locationOfOperationSupplyOrProduction: {
            "@location": "CH",
          },
        },
        quantitativeReference: {
          functionalUnitOrOther: {
            "@xml:lang": "en",
            "#text": "1.0 m2 Disposal, glazing, as building waste {CH}",
          },
        },
      },
      exchanges: {
        exchange: [
          {
            referenceToFlowDataSet: {
              "@refObjectId": flowId,
              "@version": "00.00.001",
            },
            exchangeDirection: "Output",
            meanAmount: 1,
          },
        ],
      },
      administrativeInformation: {
        publicationAndOwnership: {
          "common:dataSetVersion": "00.00.001",
        },
      },
    },
  };
}

function identityActionItem(authoringPackage: string, authoringPackageSha256: string) {
  return {
    dataset_type: "flow",
    dataset_id: flowId,
    dataset_version: "00.00.001",
    authoring_package: rel(authoringPackage),
    authoring_package_sha256: authoringPackageSha256,
    evidence: {
      target: {
        id: flowId,
        version: "00.00.001",
        names: ["Disposal, flat glass, as building waste", "source-described route", "CH"],
        fields: {
          type_of_dataset: "Product flow",
          flow_property: "Mass",
          reference_unit: "kg",
          categories: ["waste management", "building demolition"],
          geography: "CH",
        },
      },
      remote_search: { endpoint: "flow_hybrid_search", candidate_count: 1 },
      top_candidates: [
        {
          id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
          version: "01.01.001",
          names: ["plate glass", "production mix, at plant"],
          fields: {
            type_of_dataset: "Product flow",
            flow_property: "Mass",
            geography: "production mix, at plant",
          },
        },
      ],
    },
  };
}

function processIdentityActionItem(authoringPackage: string, authoringPackageSha256: string) {
  return {
    dataset_type: "process",
    dataset_id: processId,
    dataset_version: "00.00.001",
    authoring_package: rel(authoringPackage),
    authoring_package_sha256: authoringPackageSha256,
    evidence: {
      target: {
        id: processId,
        version: "00.00.001",
        names: ["Disposal, glazing, as building waste", "source-described route", "CH"],
        fields: {
          reference_flow_ids: [flowId],
          reference_flow_names: ["Disposal, glazing, as building waste"],
          geography: "CH",
          time: "2020",
          categories: ["waste management", "building demolition"],
        },
        exchange_signature: [`${flowId.replaceAll("-", " ")}:output:1 0`],
      },
      remote_search: { endpoint: "process_hybrid_search", candidate_count: 1 },
      top_candidates: [
        {
          id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
          version: "01.01.001",
          names: ["solid waste disposal", "waste photovoltaic modules"],
          fields: {
            reference_flow_ids: ["bbbbbbbb-cccc-4ddd-8eee-ffffffffffff"],
            reference_flow_names: ["municipal solid waste deposition"],
            geography: "CN",
          },
          exchange_signature: ["bbbbbbbb cccc 4ddd 8eee ffffffffffff:output:56 0"],
        },
      ],
    },
  };
}

function electricityFlowRow(id: string = electricityFlowId) {
  return {
    flowDataSet: {
      flowInformation: {
        dataSetInformation: {
          "common:UUID": id,
          name: {
            baseName: {
              "@xml:lang": "en",
              "#text": "Electricity, at cogen 1MWth, wood chips, allocation exergy",
            },
            treatmentStandardsRoutes: { "@xml:lang": "en", "#text": "source-described route" },
            mixAndLocationTypes: { "@xml:lang": "en", "#text": "CH" },
          },
        },
        geography: {
          locationOfSupply: "CH",
        },
        quantitativeReference: {
          referenceToReferenceFlowProperty: "1",
        },
      },
      modellingAndValidation: {
        LCIMethod: {
          typeOfDataSet: "Product flow",
        },
      },
      flowProperties: {
        flowProperty: {
          "@dataSetInternalID": "1",
          referenceToFlowPropertyDataSet: {
            "@refObjectId": "11111111-a3c8-11da-a746-0800200b9a66",
            "@version": "03.00.003",
            "common:shortDescription": { "#text": "Net calorific value" },
          },
          meanValue: 1,
        },
      },
      administrativeInformation: {
        publicationAndOwnership: {
          "common:dataSetVersion": "00.00.001",
        },
      },
    },
  };
}

function namedFlowRow(id: string, baseName: string, locationCode = "CH") {
  return {
    flowDataSet: {
      flowInformation: {
        dataSetInformation: {
          "common:UUID": id,
          name: {
            baseName: { "@xml:lang": "en", "#text": baseName },
            treatmentStandardsRoutes: { "@xml:lang": "en", "#text": "source-described route" },
            mixAndLocationTypes: { "@xml:lang": "en", "#text": locationCode },
          },
        },
        geography: {
          locationOfSupply: locationCode,
        },
        quantitativeReference: {
          referenceToReferenceFlowProperty: "1",
        },
      },
      modellingAndValidation: {
        LCIMethod: {
          typeOfDataSet: "Product flow",
        },
      },
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
        publicationAndOwnership: {
          "common:dataSetVersion": "00.00.001",
        },
      },
    },
  };
}

function electricityProcessRow(id: string = electricityProcessId) {
  return {
    processDataSet: {
      processInformation: {
        dataSetInformation: {
          "common:UUID": id,
          name: {
            baseName: {
              "@xml:lang": "en",
              "#text": "Electricity production mix MX",
            },
            treatmentStandardsRoutes: {
              "@xml:lang": "en",
              "#text": "cogeneration, wood chips, allocation exergy",
            },
            mixAndLocationTypes: { "@xml:lang": "en", "#text": "MX" },
          },
        },
        geography: {
          locationOfOperationSupplyOrProduction: {
            "@location": "MX",
          },
        },
        quantitativeReference: {
          functionalUnitOrOther: {
            "@xml:lang": "en",
            "#text": "1.0 kWh Electricity production mix MX",
          },
        },
      },
      exchanges: {
        exchange: [
          {
            referenceToFlowDataSet: {
              "@refObjectId": electricityFlowId,
              "@version": "00.00.001",
            },
            meanAmount: 1,
          },
        ],
      },
      administrativeInformation: {
        publicationAndOwnership: {
          "common:dataSetVersion": "00.00.001",
        },
      },
    },
  };
}

function electricityFlowIdentityActionItem(
  authoringPackage: string,
  authoringPackageSha256: string,
) {
  return {
    dataset_type: "flow",
    dataset_id: electricityFlowId,
    dataset_version: "00.00.001",
    authoring_package: rel(authoringPackage),
    authoring_package_sha256: authoringPackageSha256,
    evidence: {
      target: {
        id: electricityFlowId,
        version: "00.00.001",
        names: [
          "Electricity, at cogen 1MWth, wood chips, allocation exergy",
          "source-described route",
          "CH",
        ],
        fields: {
          type_of_dataset: "Product flow",
          flow_property: "Net calorific value",
          reference_unit: "kWh",
          categories: ["electricity by fuel", "wood\\cogeneration"],
          geography: "CH",
        },
      },
      remote_search: { endpoint: "flow_hybrid_search", candidate_count: 2 },
      top_candidates: [
        {
          id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
          version: "01.01.001",
          names: ["alternating current", "electricity mix", "consumption mix, to consumers"],
          fields: {
            type_of_dataset: "Product flow",
            flow_property: "Net calorific value",
            categories: ["Electrical energy"],
            geography: "consumption mix, to consumers",
          },
        },
        {
          id: "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff",
          version: "01.01.000",
          names: ["Electricity, medium voltage", "grid electricity supply", "at plant, GLO"],
          fields: {
            type_of_dataset: "Product flow",
            flow_property: "Net calorific value",
            categories: ["Electrical energy"],
            geography: "at plant, GLO",
          },
        },
      ],
    },
  };
}

function electricityProcessIdentityActionItem(
  authoringPackage: string,
  authoringPackageSha256: string,
) {
  return {
    dataset_type: "process",
    dataset_id: electricityProcessId,
    dataset_version: "00.00.001",
    authoring_package: rel(authoringPackage),
    authoring_package_sha256: authoringPackageSha256,
    evidence: {
      target: {
        id: electricityProcessId,
        version: "00.00.001",
        names: [
          "Electricity production mix MX",
          "cogeneration, wood chips, allocation exergy",
          "MX",
        ],
        fields: {
          reference_flow_ids: [electricityFlowId],
          reference_flow_names: ["Electricity, at cogen 1MWth, wood chips, allocation exergy"],
          geography: "MX",
          categories: ["electricity by fuel", "wood\\cogeneration"],
        },
        exchange_signature: [`${electricityFlowId.replaceAll("-", " ")}:output:1 0`],
      },
      remote_search: { endpoint: "process_hybrid_search", candidate_count: 1 },
      top_candidates: [
        {
          id: "cccccccc-dddd-4eee-8fff-111111111111",
          version: "01.01.001",
          names: ["electricity consumption mix", "grid supply, to consumers"],
          fields: {
            reference_flow_ids: ["dddddddd-eeee-4fff-8111-222222222222"],
            reference_flow_names: ["alternating current, consumption mix"],
            geography: "GLO",
            categories: ["Electrical energy"],
          },
          exchange_signature: ["dddddddd eeee 4fff 8111 222222222222:output:1 0"],
        },
      ],
    },
  };
}

function semanticActionItems() {
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
      evidence: {
        text: "CH",
        location_code_candidate: "CH",
      },
      allowed_resolution_modes: ["location_decision"],
    },
    {
      code: "semantic_content_saturation_flow_quantitative_properties_missing",
      path: "flowDataSet.flowInformation.dataSetInformation.name.flowProperties",
      evidence: {
        reference_flow_properties: ["Mass"],
        suggested_value: { "@xml:lang": "en", "#text": "Mass" },
      },
      allowed_resolution_modes: ["evidence_backed_completion"],
    },
  ];
}

function processSemanticActionItems() {
  return [
    {
      code: "semantic_geography_token_in_name",
      path: "processDataSet.processInformation.quantitativeReference.functionalUnitOrOther.#text",
      evidence: {
        text: "1.0 m2 Disposal, glazing, as building waste {CH}",
      },
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
      evidence: {
        text: "CH",
        location_code_candidate: "CH",
      },
      allowed_resolution_modes: ["location_decision"],
    },
    {
      code: "semantic_process_only_output_exchange_requires_review",
      path: "processDataSet.exchanges.exchange",
      evidence: {
        exchange_count: 1,
        directions: ["Output"],
      },
      allowed_resolution_modes: ["source_trace_verified", "exchange_set_repaired"],
    },
  ];
}

function electricitySemanticActionItems() {
  return [
    {
      code: "semantic_name_base_contains_unsplit_segments",
      path: "flowDataSet.flowInformation.dataSetInformation.name.baseName",
      evidence: {
        text: "Electricity, at cogen 1MWth, wood chips, allocation exergy",
        current_name: {
          baseName: "Electricity, at cogen 1MWth, wood chips, allocation exergy",
          treatmentStandardsRoutes: "source-described route",
          mixAndLocationTypes: "CH",
        },
      },
      allowed_resolution_modes: ["evidence_backed_completion", "source_language_normalization"],
    },
    {
      code: "semantic_name_quantitative_property_not_split",
      path: "flowDataSet.flowInformation.dataSetInformation.name.baseName",
      evidence: {
        text: "Electricity, at cogen 1MWth, wood chips, allocation exergy",
        current_name: {
          baseName: "Electricity, at cogen 1MWth, wood chips, allocation exergy",
          treatmentStandardsRoutes: "source-described route",
          mixAndLocationTypes: "CH",
        },
      },
      allowed_resolution_modes: ["evidence_backed_completion", "source_language_normalization"],
    },
    {
      code: "semantic_name_treatment_placeholder",
      path: "flowDataSet.flowInformation.dataSetInformation.name.treatmentStandardsRoutes",
      evidence: {
        text: "source-described route",
        current_name: {
          baseName: "Electricity, at cogen 1MWth, wood chips, allocation exergy",
          treatmentStandardsRoutes: "source-described route",
          mixAndLocationTypes: "CH",
        },
      },
      allowed_resolution_modes: ["evidence_backed_completion", "source_language_normalization"],
    },
    {
      code: "semantic_name_mix_location_too_bare",
      path: "flowDataSet.flowInformation.dataSetInformation.name.mixAndLocationTypes",
      evidence: {
        text: "CH",
        location_code_candidate: "CH",
      },
      allowed_resolution_modes: ["location_decision"],
    },
    {
      code: "semantic_content_saturation_flow_quantitative_properties_missing",
      path: "flowDataSet.flowInformation.dataSetInformation.name.flowProperties",
      evidence: {
        reference_flow_properties: ["Net calorific value"],
        suggested_value: { "@xml:lang": "en", "#text": "Net calorific value" },
      },
      allowed_resolution_modes: ["evidence_backed_completion"],
    },
  ];
}

function routeSplitSemanticActionItems(baseName: string, locationCode = "CH") {
  return [
    {
      code: "semantic_name_treatment_placeholder",
      path: "flowDataSet.flowInformation.dataSetInformation.name.treatmentStandardsRoutes",
      evidence: {
        text: "source-described route",
        current_name: {
          baseName,
          treatmentStandardsRoutes: "source-described route",
          mixAndLocationTypes: locationCode,
        },
      },
      allowed_resolution_modes: ["source_language_normalization"],
    },
    {
      code: "semantic_name_mix_location_too_bare",
      path: "flowDataSet.flowInformation.dataSetInformation.name.mixAndLocationTypes",
      evidence: {
        text: locationCode,
        location_code_candidate: locationCode,
      },
      allowed_resolution_modes: ["location_decision"],
    },
    {
      code: "semantic_content_saturation_flow_quantitative_properties_missing",
      path: "flowDataSet.flowInformation.dataSetInformation.name.flowProperties",
      evidence: {
        reference_flow_properties: ["Mass"],
        suggested_value: { "@xml:lang": "en", "#text": "Mass" },
      },
      allowed_resolution_modes: ["evidence_backed_completion"],
    },
  ];
}

test("BAFU identity autofill creates product-flow create_new decisions accepted by apply", () => {
  const root = path.join(fixtureRoot, "identity");
  fs.rmSync(root, { recursive: true, force: true });
  const packagePath = path.join(root, "packages", `flow-${flowId}.authoring-package.json`);
  const rowsFile = path.join(root, "flows.jsonl");
  writeJson(packagePath, {
    dataset_type: "flow",
    entity_id: flowId,
    version: "00.00.001",
    source_row: flowRow(),
  });
  const packageSha = sha256Text(fs.readFileSync(packagePath, "utf8"));
  const taskPath = path.join(root, "identity-decision-task.json");
  writeJson(taskPath, {
    schema_version: 1,
    status: "ready_for_ai_identity_decisions",
    identity_action_items: [identityActionItem(packagePath, packageSha)],
    files: {
      expected_decisions: rel(path.join(root, "identity-decisions.jsonl")),
    },
  });
  writeJsonLines(rowsFile, [flowRow()]);

  try {
    const autofill = runFoundry([
      "dataset-bafu-identity-decisions-autofill",
      "--identity-decision-task",
      rel(taskPath),
    ]);
    assert.equal(autofill.code, 0);
    assert.equal(autofill.json.status, "completed");
    const decisions = readJsonLines(path.join(repoRoot, autofill.json.files.decisions));
    assert.equal(decisions[0].identity_decision, "create_new");

    const apply = runFoundry([
      "dataset-identity-decisions-apply",
      "--type",
      "flow",
      "--rows-file",
      rel(rowsFile),
      "--decisions",
      autofill.json.files.decisions,
      "--out-dir",
      rel(path.join(root, "identity-apply")),
      "--authoring-package-dir",
      rel(path.dirname(packagePath)),
    ]);
    assert.equal(apply.code, 0);
    assert.equal(apply.json.status, "completed");
    assert.equal(apply.json.counts.output_rows, 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("BAFU identity autofill reuses physically equivalent product-flow candidates", () => {
  const root = path.join(fixtureRoot, "identity-reuse");
  fs.rmSync(root, { recursive: true, force: true });
  const nylonFlowId = "55555555-1111-4222-8333-444444444444";
  const canonicalFlowId = "66666666-1111-4222-8333-444444444444";
  const packagePath = path.join(root, "packages", `flow-${nylonFlowId}.authoring-package.json`);
  writeJson(packagePath, {
    dataset_type: "flow",
    entity_id: nylonFlowId,
    version: "00.00.001",
    source_row: namedFlowRow(nylonFlowId, "Nylon 6, at plant", "RER"),
  });
  const packageSha = sha256Text(fs.readFileSync(packagePath, "utf8"));
  const taskPath = path.join(root, "identity-decision-task.json");
  writeJson(taskPath, {
    schema_version: 1,
    status: "ready_for_ai_identity_decisions",
    identity_action_items: [
      {
        dataset_type: "flow",
        dataset_id: nylonFlowId,
        dataset_version: "00.00.001",
        authoring_package: rel(packagePath),
        authoring_package_sha256: packageSha,
        evidence: {
          target: {
            id: nylonFlowId,
            version: "00.00.001",
            names: ["Nylon 6", "at plant", "RER"],
            fields: {
              type_of_dataset: "Product flow",
              flow_property: "Mass",
              reference_unit: "kg",
              categories: ["plastics", "thermoplasts"],
              geography: "RER",
            },
          },
          remote_search: { endpoint: "flow_hybrid_search", candidate_count: 1 },
          top_candidates: [
            {
              id: canonicalFlowId,
              version: "01.01.000",
              names: ["Nylon 6", "at plant", "RER"],
              fields: {
                type_of_dataset: "Product flow",
                flow_property: "Mass",
                reference_unit: "kg",
                categories: ["plastics", "thermoplasts"],
                geography: "RER",
              },
            },
          ],
        },
      },
    ],
    files: {
      expected_decisions: rel(path.join(root, "identity-decisions.jsonl")),
    },
  });

  try {
    const autofill = runFoundry([
      "dataset-bafu-identity-decisions-autofill",
      "--identity-decision-task",
      rel(taskPath),
    ]);
    assert.equal(autofill.code, 0);
    assert.equal(autofill.json.status, "completed");
    const decisions = readJsonLines(path.join(repoRoot, autofill.json.files.decisions));
    assert.equal(decisions[0].identity_decision, "reuse_existing_reference");
    assert.equal(decisions[0].canonical.ref_object_id, canonicalFlowId);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("BAFU identity autofill keeps exact-name physical conflicts as create-new evidence", () => {
  const root = path.join(fixtureRoot, "identity-exact-name-physical-conflict");
  fs.rmSync(root, { recursive: true, force: true });
  const targetFlowId = "77777777-1111-4222-8333-444444444444";
  const conflictingFlowId = "88888888-1111-4222-8333-444444444444";
  const packagePath = path.join(root, "packages", `flow-${targetFlowId}.authoring-package.json`);
  const rowsFile = path.join(root, "flows.jsonl");
  const sourceRow = namedFlowRow(targetFlowId, "Nylon 6, at plant", "RER");
  writeJson(packagePath, {
    dataset_type: "flow",
    entity_id: targetFlowId,
    version: "00.00.001",
    source_row: sourceRow,
  });
  const packageSha = sha256Text(fs.readFileSync(packagePath, "utf8"));
  const taskPath = path.join(root, "identity-decision-task.json");
  writeJson(taskPath, {
    schema_version: 1,
    status: "ready_for_ai_identity_decisions",
    identity_action_items: [
      {
        dataset_type: "flow",
        dataset_id: targetFlowId,
        dataset_version: "00.00.001",
        authoring_package: rel(packagePath),
        authoring_package_sha256: packageSha,
        evidence: {
          target: {
            id: targetFlowId,
            version: "00.00.001",
            names: ["Nylon 6", "at plant"],
            fields: {
              type_of_dataset: "Product flow",
              flow_property: "Mass",
              reference_unit: "kg",
              categories: ["plastics"],
              geography: "RER",
            },
          },
          remote_search: { endpoint: "flow_hybrid_search", candidate_count: 1 },
          top_candidates: [
            {
              id: conflictingFlowId,
              version: "01.00.000",
              names: ["Nylon 6", "at plant"],
              fields: {
                type_of_dataset: "Product flow",
                flow_property: "Volume",
                reference_unit: "m3",
                categories: ["chemicals"],
                geography: "GLO",
              },
            },
          ],
        },
      },
    ],
    files: {
      expected_decisions: rel(path.join(root, "identity-decisions.jsonl")),
    },
  });
  writeJsonLines(rowsFile, [sourceRow]);

  try {
    const autofill = runFoundry([
      "dataset-bafu-identity-decisions-autofill",
      "--identity-decision-task",
      rel(taskPath),
    ]);
    assert.equal(autofill.code, 0);
    assert.equal(autofill.json.status, "completed");
    const decisions = readJsonLines(path.join(repoRoot, autofill.json.files.decisions));
    assert.equal(decisions[0].identity_decision, "create_new");
    assert.equal(decisions[0].canonical, null);
    const decisionEvidence = decisions[0].evidence;
    const reviewedCandidates = decisionEvidence.reviewed_top_candidates as FixtureRecord[];
    assert.deepEqual(reviewedCandidates[0].non_equivalence_reasons, [
      "flow property differs",
      "reference unit differs",
      "geography/market context differs",
      "source category/route differs",
    ]);
    assert.equal(decisionEvidence.selected_candidate, undefined);

    const apply = runFoundry([
      "dataset-identity-decisions-apply",
      "--type",
      "flow",
      "--rows-file",
      rel(rowsFile),
      "--decisions",
      autofill.json.files.decisions,
      "--out-dir",
      rel(path.join(root, "identity-apply")),
      "--authoring-package-dir",
      rel(path.dirname(packagePath)),
    ]);
    assert.equal(apply.code, 0);
    assert.equal(apply.json.status, "completed");
    assert.equal(apply.json.counts.output_rows, 1);
    const appliedRows = readJsonLines(path.join(repoRoot, apply.json.files.output_rows));
    assert.equal(
      appliedRows[0].flowDataSet.flowInformation.dataSetInformation["common:UUID"],
      targetFlowId,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("BAFU identity autofill reuses physically equivalent elementary land-use candidates", () => {
  const root = path.join(fixtureRoot, "elementary-land-use-identity");
  fs.rmSync(root, { recursive: true, force: true });
  const occupationFlowId = "6bab0f1b-a7ac-5179-998a-7b90753868cb";
  const transformationFlowId = "a47e10a2-1781-5623-8645-4964cfee3b8c";
  const packagePath = path.join(
    root,
    "packages",
    `flow-${occupationFlowId}.authoring-package.json`,
  );
  writeJson(packagePath, {
    dataset_type: "flow",
    entity_id: occupationFlowId,
    version: "00.00.001",
    source_row: flowRow(occupationFlowId),
  });
  const packageSha = sha256Text(fs.readFileSync(packagePath, "utf8"));
  const taskPath = path.join(root, "identity-decision-task.json");
  writeJson(taskPath, {
    schema_version: 1,
    status: "ready_for_ai_identity_decisions",
    identity_action_items: [
      {
        dataset_type: "flow",
        dataset_id: occupationFlowId,
        dataset_version: "00.00.001",
        authoring_package: rel(packagePath),
        authoring_package_sha256: packageSha,
        evidence: {
          target: {
            id: occupationFlowId,
            version: "00.00.001",
            names: [
              "Occupation, industrial area, vegetation",
              "source-described route",
              "source-described geography",
            ],
            fields: {
              type_of_dataset: "Elementary flow",
              flow_property: "Area*time",
              reference_unit: "m2a",
              categories: ["resources", "land"],
              geography: "source-described geography",
            },
          },
          top_candidates: [
            {
              id: "eb84226d-129f-49d8-8d69-cc484b7a6cbf",
              version: "03.00.004",
              names: ["industrial area", "工业用地占用"],
              fields: {
                type_of_dataset: "Elementary flow",
                flow_property: "Area*time",
                categories: ["Land use", "Land occupation"],
              },
            },
          ],
        },
      },
      {
        dataset_type: "flow",
        dataset_id: transformationFlowId,
        dataset_version: "00.00.001",
        authoring_package: rel(packagePath),
        authoring_package_sha256: packageSha,
        evidence: {
          target: {
            id: transformationFlowId,
            version: "00.00.001",
            names: [
              "Transformation, to industrial area, vegetation",
              "source-described route",
              "source-described geography",
            ],
            fields: {
              type_of_dataset: "Elementary flow",
              flow_property: "Area",
              reference_unit: "m2",
              categories: ["resources", "land"],
              geography: "source-described geography",
            },
          },
          top_candidates: [
            {
              id: "2abdec35-e00d-4760-842c-e63403507b1d",
              version: "03.00.004",
              names: ["from industrial area", "由工业用地转变"],
              fields: {
                type_of_dataset: "Elementary flow",
                flow_property: "Area",
                categories: ["Land use", "Land transformation"],
              },
            },
            {
              id: "2f8cc78f-7f63-4b5c-9010-70a847737d23",
              version: "03.00.004",
              names: ["to industrial area", "转变为工业用地"],
              fields: {
                type_of_dataset: "Elementary flow",
                flow_property: "Area",
                categories: ["Land use", "Land transformation"],
              },
            },
          ],
        },
      },
    ],
    files: {
      expected_decisions: rel(path.join(root, "identity-decisions.jsonl")),
    },
  });

  try {
    const autofill = runFoundry([
      "dataset-bafu-identity-decisions-autofill",
      "--identity-decision-task",
      rel(taskPath),
    ]);
    assert.equal(autofill.code, 0);
    assert.equal(autofill.json.status, "completed");
    const decisions = readJsonLines(path.join(repoRoot, autofill.json.files.decisions));
    assert.equal(decisions.length, 2);
    assert.equal(decisions[0].identity_decision, "reuse_existing_reference");
    assert.equal(decisions[0].canonical.ref_object_id, "eb84226d-129f-49d8-8d69-cc484b7a6cbf");
    assert.equal(decisions[1].identity_decision, "reuse_existing_reference");
    assert.equal(decisions[1].canonical.ref_object_id, "2f8cc78f-7f63-4b5c-9010-70a847737d23");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("BAFU identity autofill creates process create_new decisions accepted by apply", () => {
  const root = path.join(fixtureRoot, "process-identity");
  fs.rmSync(root, { recursive: true, force: true });
  const packagePath = path.join(root, "packages", `process-${processId}.authoring-package.json`);
  const rowsFile = path.join(root, "processes.jsonl");
  writeJson(packagePath, {
    dataset_type: "process",
    entity_id: processId,
    version: "00.00.001",
    source_row: processRow(),
  });
  const packageSha = sha256Text(fs.readFileSync(packagePath, "utf8"));
  const taskPath = path.join(root, "identity-decision-task.json");
  writeJson(taskPath, {
    schema_version: 1,
    status: "ready_for_ai_identity_decisions",
    identity_action_items: [processIdentityActionItem(packagePath, packageSha)],
    files: {
      expected_decisions: rel(path.join(root, "identity-decisions.jsonl")),
    },
  });
  writeJsonLines(rowsFile, [processRow()]);

  try {
    const autofill = runFoundry([
      "dataset-bafu-identity-decisions-autofill",
      "--identity-decision-task",
      rel(taskPath),
    ]);
    assert.equal(autofill.code, 0);
    assert.equal(autofill.json.status, "completed");
    const decisions = readJsonLines(path.join(repoRoot, autofill.json.files.decisions));
    assert.equal(decisions[0].dataset_type, "process");
    assert.equal(decisions[0].identity_decision, "create_new");

    const apply = runFoundry([
      "dataset-identity-decisions-apply",
      "--type",
      "process",
      "--rows-file",
      rel(rowsFile),
      "--decisions",
      autofill.json.files.decisions,
      "--out-dir",
      rel(path.join(root, "identity-apply")),
      "--authoring-package-dir",
      rel(path.dirname(packagePath)),
    ]);
    assert.equal(apply.code, 0);
    assert.equal(apply.json.status, "completed");
    assert.equal(apply.json.counts.evidence_rows, 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("BAFU identity autofill creates non-building-waste electricity flow decisions", () => {
  const root = path.join(fixtureRoot, "electricity-identity");
  fs.rmSync(root, { recursive: true, force: true });
  const packagePath = path.join(
    root,
    "packages",
    `flow-${electricityFlowId}.authoring-package.json`,
  );
  const rowsFile = path.join(root, "flows.jsonl");
  writeJson(packagePath, {
    dataset_type: "flow",
    entity_id: electricityFlowId,
    version: "00.00.001",
    source_row: electricityFlowRow(),
  });
  const packageSha = sha256Text(fs.readFileSync(packagePath, "utf8"));
  const taskPath = path.join(root, "identity-decision-task.json");
  writeJson(taskPath, {
    schema_version: 1,
    status: "ready_for_ai_identity_decisions",
    identity_action_items: [electricityFlowIdentityActionItem(packagePath, packageSha)],
    files: {
      expected_decisions: rel(path.join(root, "identity-decisions.jsonl")),
    },
  });
  writeJsonLines(rowsFile, [electricityFlowRow()]);

  try {
    const autofill = runFoundry([
      "dataset-bafu-identity-decisions-autofill",
      "--identity-decision-task",
      rel(taskPath),
    ]);
    assert.equal(autofill.code, 0);
    assert.equal(autofill.json.status, "completed");
    const decisions = readJsonLines(path.join(repoRoot, autofill.json.files.decisions));
    assert.equal(decisions[0].identity_decision, "create_new");
    assert.match(decisions[0].basis, /no identity-equivalent product\/waste flow/u);

    const apply = runFoundry([
      "dataset-identity-decisions-apply",
      "--type",
      "flow",
      "--rows-file",
      rel(rowsFile),
      "--decisions",
      autofill.json.files.decisions,
      "--out-dir",
      rel(path.join(root, "identity-apply")),
      "--authoring-package-dir",
      rel(path.dirname(packagePath)),
    ]);
    assert.equal(apply.code, 0);
    assert.equal(apply.json.status, "completed");
    assert.equal(apply.json.counts.output_rows, 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("BAFU identity autofill creates non-building-waste electricity process decisions", () => {
  const root = path.join(fixtureRoot, "electricity-process-identity");
  fs.rmSync(root, { recursive: true, force: true });
  const packagePath = path.join(
    root,
    "packages",
    `process-${electricityProcessId}.authoring-package.json`,
  );
  const rowsFile = path.join(root, "processes.jsonl");
  writeJson(packagePath, {
    dataset_type: "process",
    entity_id: electricityProcessId,
    version: "00.00.001",
    source_row: electricityProcessRow(),
  });
  const packageSha = sha256Text(fs.readFileSync(packagePath, "utf8"));
  const taskPath = path.join(root, "identity-decision-task.json");
  writeJson(taskPath, {
    schema_version: 1,
    status: "ready_for_ai_identity_decisions",
    identity_action_items: [electricityProcessIdentityActionItem(packagePath, packageSha)],
    files: {
      expected_decisions: rel(path.join(root, "identity-decisions.jsonl")),
    },
  });
  writeJsonLines(rowsFile, [electricityProcessRow()]);

  try {
    const autofill = runFoundry([
      "dataset-bafu-identity-decisions-autofill",
      "--identity-decision-task",
      rel(taskPath),
    ]);
    assert.equal(autofill.code, 0);
    assert.equal(autofill.json.status, "completed");
    const decisions = readJsonLines(path.join(repoRoot, autofill.json.files.decisions));
    assert.equal(decisions[0].dataset_type, "process");
    assert.equal(decisions[0].identity_decision, "create_new");
    assert.match(decisions[0].basis, /no identity-equivalent process/u);

    const apply = runFoundry([
      "dataset-identity-decisions-apply",
      "--type",
      "process",
      "--rows-file",
      rel(rowsFile),
      "--decisions",
      autofill.json.files.decisions,
      "--out-dir",
      rel(path.join(root, "identity-apply")),
      "--authoring-package-dir",
      rel(path.dirname(packagePath)),
    ]);
    assert.equal(apply.code, 0);
    assert.equal(apply.json.status, "completed");
    assert.equal(apply.json.counts.evidence_rows, 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("BAFU patch autofill writes collectable name-plan and flowProperties patches", () => {
  const root = path.join(fixtureRoot, "patch");
  fs.rmSync(root, { recursive: true, force: true });
  const packagePath = path.join(root, "authoring-package-snapshots", `flow-${flowId}.json`);
  const patchPath = path.join(root, "flow-task", "ai-patches.json");
  writeJson(packagePath, {
    dataset_type: "flow",
    entity_id: flowId,
    version: "00.00.001",
    source_row: flowRow(),
  });
  const packageSha = sha256Text(fs.readFileSync(packagePath, "utf8"));
  const manifestPath = path.join(root, "authoring-task-manifest.json");
  writeJson(manifestPath, {
    schema_version: 1,
    status: "ready_for_ai_authoring_batch",
    tasks: [
      {
        status: "ready_for_ai_authoring",
        entity: {
          dataset_type: "flow",
          entity_id: flowId,
          version: "00.00.001",
          profile: "bafu",
        },
        context: {
          source_rows_file: rel(path.join(root, "flows.cleaned.jsonl")),
          authoring_package_sha256: packageSha,
          full_context_ai_completion: { required: false },
          contract_context_files: [],
          missing_context_files: [],
        },
        action_items: semanticActionItems(),
        files: {
          authoring_package: rel(packagePath),
          output_patch_file: rel(patchPath),
          task_json: rel(path.join(root, "flow-task", "ai-authoring-task.json")),
        },
      },
    ],
  });

  try {
    const autofill = runFoundry([
      "dataset-bafu-authoring-patches-autofill",
      "--task-manifest",
      rel(manifestPath),
    ]);
    assert.equal(autofill.code, 0);
    assert.equal(autofill.json.status, "completed");
    const patch = readJson(patchPath);
    const operations = patch.patch_sets[0].operations;
    assert.equal(operations.length, 4);
    assert.deepEqual(
      new Set(
        operations.flatMap((operation: PatchOperation) =>
          operation.closes_action_items.map((item: { code: string }) => item.code),
        ),
      ),
      new Set([
        "semantic_name_treatment_placeholder",
        "semantic_name_mix_location_too_bare",
        "semantic_content_saturation_flow_quantitative_properties_missing",
      ]),
    );
    assert.equal(
      operations.every((operation: PatchOperation) =>
        ["schema", "methodology_yaml", "ruleset", "classification_schema", "location_schema"].every(
          (kind) => operation.resolution.used_context_kinds.includes(kind),
        ),
      ),
      true,
    );

    const collect = runFoundry([
      "dataset-authoring-patch-collect",
      "--task-manifest",
      rel(manifestPath),
    ]);
    assert.equal(collect.code, 0);
    assert.equal(collect.json.status, "ready_for_patch_apply");
    assert.equal(collect.json.counts.operations, 4);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("BAFU patch autofill splits electricity route names and closes all name-plan actions", () => {
  const root = path.join(fixtureRoot, "electricity-patch");
  fs.rmSync(root, { recursive: true, force: true });
  const packagePath = path.join(
    root,
    "authoring-package-snapshots",
    `flow-${electricityFlowId}.json`,
  );
  const patchPath = path.join(root, "flow-task", "ai-patches.json");
  writeJson(packagePath, {
    dataset_type: "flow",
    entity_id: electricityFlowId,
    version: "00.00.001",
    source_row: electricityFlowRow(),
  });
  const packageSha = sha256Text(fs.readFileSync(packagePath, "utf8"));
  const manifestPath = path.join(root, "authoring-task-manifest.json");
  writeJson(manifestPath, {
    schema_version: 1,
    status: "ready_for_ai_authoring_batch",
    tasks: [
      {
        status: "ready_for_ai_authoring",
        entity: {
          dataset_type: "flow",
          entity_id: electricityFlowId,
          version: "00.00.001",
          profile: "bafu",
        },
        context: {
          source_rows_file: rel(path.join(root, "flows.cleaned.jsonl")),
          authoring_package_sha256: packageSha,
          full_context_ai_completion: { required: false },
          contract_context_files: [],
          missing_context_files: [],
        },
        action_items: electricitySemanticActionItems(),
        files: {
          authoring_package: rel(packagePath),
          output_patch_file: rel(patchPath),
          task_json: rel(path.join(root, "flow-task", "ai-authoring-task.json")),
        },
      },
    ],
  });

  try {
    const autofill = runFoundry([
      "dataset-bafu-authoring-patches-autofill",
      "--task-manifest",
      rel(manifestPath),
    ]);
    assert.equal(autofill.code, 0);
    assert.equal(autofill.json.status, "completed");
    const patch = readJson(patchPath);
    const operations = patch.patch_sets[0].operations;
    assert.equal(operations.length, 4);
    assert.deepEqual(
      operations.find((operation: PatchOperation) => operation.path.endsWith("/baseName")).value,
      {
        "@xml:lang": "en",
        "#text": "Electricity",
      },
    );
    assert.deepEqual(
      operations.find((operation: PatchOperation) =>
        operation.path.endsWith("/treatmentStandardsRoutes"),
      ).value,
      { "@xml:lang": "en", "#text": "at cogen 1MWth, wood chips, allocation exergy" },
    );
    assert.deepEqual(
      operations.find((operation: PatchOperation) =>
        operation.path.endsWith("/mixAndLocationTypes"),
      ).value,
      { "@xml:lang": "en", "#text": "production mix, Switzerland" },
    );
    assert.deepEqual(
      new Set(
        operations.flatMap((operation: PatchOperation) =>
          operation.closes_action_items.map((item: { code: string }) => item.code),
        ),
      ),
      new Set([
        "semantic_name_base_contains_unsplit_segments",
        "semantic_name_quantitative_property_not_split",
        "semantic_name_treatment_placeholder",
        "semantic_name_mix_location_too_bare",
        "semantic_content_saturation_flow_quantitative_properties_missing",
      ]),
    );

    const collect = runFoundry([
      "dataset-authoring-patch-collect",
      "--task-manifest",
      rel(manifestPath),
    ]);
    assert.equal(collect.code, 0);
    assert.equal(collect.json.status, "ready_for_patch_apply");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("BAFU patch autofill removes source locators from recycled metal profile names", () => {
  const root = path.join(fixtureRoot, "source-locator-name-patch");
  fs.rmSync(root, { recursive: true, force: true });
  const id = "99999999-aaaa-4bbb-8ccc-dddddddddddd";
  const packagePath = path.join(root, "authoring-package-snapshots", `flow-${id}.json`);
  const patchPath = path.join(root, "flow-task", "ai-patches.json");
  const row = flowRow(id);
  row.flowDataSet.flowInformation.dataSetInformation.name = {
    baseName: {
      "@xml:lang": "en",
      "#text": "Aluminium profile, uncoated, SZFF 2014, recycling share 52%",
    },
    treatmentStandardsRoutes: { "@xml:lang": "en", "#text": "at plant" },
    mixAndLocationTypes: { "@xml:lang": "en", "#text": "recovered material, Switzerland" },
    flowProperties: { "@xml:lang": "en", "#text": "Mass" },
  } as unknown as typeof row.flowDataSet.flowInformation.dataSetInformation.name;
  writeJson(packagePath, {
    dataset_type: "flow",
    entity_id: id,
    version: "00.00.001",
    source_row: row,
  });
  const packageSha = sha256Text(fs.readFileSync(packagePath, "utf8"));
  const manifestPath = path.join(root, "authoring-task-manifest.json");
  writeJson(manifestPath, {
    schema_version: 1,
    status: "ready_for_ai_authoring_batch",
    tasks: [
      {
        status: "ready_for_ai_authoring",
        entity: {
          dataset_type: "flow",
          entity_id: id,
          version: "00.00.001",
          profile: "bafu",
        },
        context: {
          source_rows_file: rel(path.join(root, "flows.cleaned.jsonl")),
          authoring_package_sha256: packageSha,
          full_context_ai_completion: { required: false },
          contract_context_files: [],
          missing_context_files: [],
        },
        action_items: [
          {
            code: "semantic_name_source_locator_in_name",
            path: "flowDataSet.flowInformation.dataSetInformation.name.baseName",
            evidence: {
              text: "Aluminium profile, uncoated, SZFF 2014, recycling share 52%",
            },
            allowed_resolution_modes: ["source_language_normalization"],
          },
        ],
        files: {
          authoring_package: rel(packagePath),
          output_patch_file: rel(patchPath),
          task_json: rel(path.join(root, "flow-task", "ai-authoring-task.json")),
        },
      },
    ],
  });

  try {
    const autofill = runFoundry([
      "dataset-bafu-authoring-patches-autofill",
      "--task-manifest",
      rel(manifestPath),
    ]);
    assert.equal(autofill.code, 0);
    assert.equal(autofill.json.status, "completed");
    const operations = readJson(patchPath).patch_sets[0].operations;
    assert.deepEqual(
      operations.find((operation: PatchOperation) => operation.path.endsWith("/baseName")).value,
      {
        "@xml:lang": "en",
        "#text": "Aluminium profile",
      },
    );
    assert.deepEqual(
      operations.find((operation: PatchOperation) =>
        operation.path.endsWith("/treatmentStandardsRoutes"),
      ).value,
      { "@xml:lang": "en", "#text": "uncoated" },
    );
    assert.deepEqual(
      operations.find((operation: PatchOperation) =>
        operation.path.endsWith("/mixAndLocationTypes"),
      ).value,
      { "@xml:lang": "en", "#text": "at plant, Switzerland" },
    );
    assert.deepEqual(
      operations.find((operation: PatchOperation) =>
        operation.path.endsWith("/functionalUnitFlowProperties"),
      ).value,
      { "@xml:lang": "en", "#text": "recycling share 52%" },
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("BAFU patch autofill splits disposal/incineration and transport route names", () => {
  const root = path.join(fixtureRoot, "route-split-patch");
  fs.rmSync(root, { recursive: true, force: true });
  const cases = [
    {
      id: "55555555-6666-4777-8888-999999999999",
      baseName: "Disposal, plastics conduits as building waste, to municipal waste incineration",
      expectedBase: "Disposal, plastics conduits",
      expectedTreatment: "as building waste, to municipal waste incineration",
      expectedMix: "disposal service, Switzerland",
    },
    {
      id: "66666666-7777-4888-8999-aaaaaaaaaaaa",
      baseName: "Transport, freight, lorry, 16t-32t gross weight, fleet average",
      expectedBase: "Transport, freight, lorry",
      expectedTreatment: "16t-32t gross weight, fleet average",
      expectedMix: "transport service, Switzerland",
    },
    {
      id: "77777777-8888-4999-8aaa-bbbbbbbbbbbb",
      baseName: "Copper scrap, recovered from c-Si PV module treatment",
      expectedBase: "Copper scrap",
      expectedTreatment: "recovered from c-Si PV module treatment",
      expectedMix: "recovered material, Switzerland",
    },
    {
      id: "88888888-9999-4aaa-8bbb-cccccccccccc",
      baseName: "Electricity, medium voltage, production ENTSO-E, at grid",
      expectedBase: "Electricity, medium voltage",
      expectedTreatment: "production ENTSO-E, at grid",
      expectedMix: "production mix, Switzerland",
    },
    {
      id: "88888888-9999-4aaa-8bbb-cccccccccccd",
      baseName: "Electricity, production mix photovoltaic, at plant",
      locationCode: "MX",
      expectedBase: "Electricity",
      expectedTreatment: "photovoltaic, at plant",
      expectedMix: "production mix, Mexico",
    },
    {
      id: "88888888-9999-4aaa-8bbb-ccccccccccce",
      baseName: "Electricity, photovoltaic, at 3kWp slanted-roof , mc-Si, future",
      locationCode: "CH",
      expectedBase: "Electricity",
      expectedTreatment: "photovoltaic, mc-Si, future",
      expectedMix: "at 3kWp slanted-roof",
    },
    {
      id: "99999999-aaaa-4bbb-8ccc-dddddddddddd",
      baseName: "Disposal, fluorescent lamps",
      expectedBase: "Disposal, fluorescent lamps",
      expectedTreatment: "disposal route",
      expectedMix: "disposal service, Switzerland",
    },
    {
      id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
      baseName: "Shredding, electrical and electronic scrap",
      expectedBase: "electrical and electronic scrap",
      expectedTreatment: "shredding",
      expectedMix: "treatment service, Switzerland",
    },
    {
      id: "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff",
      baseName: "Mounting, surface mount technology, Pb-free solder",
      locationCode: "GLO",
      expectedBase: "Mounting",
      expectedTreatment: "surface mount technology, Pb-free solder",
      expectedMix: "assembly service, global",
    },
    {
      id: "bbbbbbbb-cccc-4ddd-8eee-fffffffffffe",
      baseName: "Fuel cell system assembly, 1 kWe, proton exchange membrane (PEM)",
      locationCode: "GLO",
      expectedBase: "Fuel cell system assembly",
      expectedTreatment: "1 kWe, proton exchange membrane (PEM)",
      expectedMix: "assembly service, global",
    },
    {
      id: "cccccccc-dddd-4eee-8fff-111111111111",
      baseName: "Mounting, through-hole technology, Pb-free solder",
      locationCode: "GLO",
      expectedBase: "Mounting",
      expectedTreatment: "through-hole technology, Pb-free solder",
      expectedMix: "assembly service, global",
    },
    {
      id: "dddddddd-eeee-4fff-8111-222222222222",
      baseName: "Welding, arc, aluminium",
      locationCode: "RER",
      expectedBase: "Welding",
      expectedTreatment: "arc, aluminium",
      expectedMix: "manufacturing service, Europe",
    },
    {
      id: "dddddddd-eeee-4fff-8111-222222222223",
      baseName: "Sheet rolling, chromium steel",
      locationCode: "RER",
      expectedBase: "Sheet rolling",
      expectedTreatment: "chromium steel",
      expectedMix: "manufacturing service, Europe",
    },
    {
      id: "eeeeeeee-ffff-4111-8222-333333333333",
      baseName: "Transport, freight, rail",
      locationCode: "RER",
      expectedBase: "Transport, freight",
      expectedTreatment: "rail",
      expectedMix: "transport service, Europe",
    },
    {
      id: "ffffffff-1111-4222-8333-444444444444",
      baseName: "Aluminium alloy, AlMg3, at plant",
      locationCode: "RER",
      expectedBase: "Aluminium alloy, AlMg3",
      expectedTreatment: "at plant",
      expectedMix: "production mix, Europe",
    },
    {
      id: "ffffffff-1111-4222-8333-444444444445",
      baseName: "Copper, primary, at refinery",
      locationCode: "RLA",
      expectedBase: "Copper",
      expectedTreatment: "primary, at refinery",
      expectedMix: "production mix, Latin America & the Caribbean",
    },
    {
      id: "ffffffff-1111-4222-8333-444444444446",
      baseName: "Anode current collector, LFP",
      locationCode: "JP",
      expectedBase: "Anode current collector",
      expectedTreatment: "LFP",
      expectedMix: "production mix, Japan",
    },
    {
      id: "ffffffff-1111-4222-8333-44444444444a",
      baseName: "Bark, softwood, after debarking, at sawmill {RER}",
      locationCode: "RER",
      expectedBase: "Bark, softwood",
      expectedTreatment: "after debarking, at sawmill",
      expectedMix: "production mix, Europe",
    },
    {
      id: "ffffffff-1111-4222-8333-44444444444b",
      baseName: "Sawnwood, beam, hardwood, raw, kiln dried (u=10%), at sawmill {CH}",
      locationCode: "CH",
      expectedBase: "Sawnwood, beam, hardwood",
      expectedTreatment: "raw, kiln dried (u=10%), at sawmill",
      expectedMix: "production mix, Switzerland",
    },
    {
      id: "ffffffff-1111-4222-8333-44444444444c",
      baseName: "Sawnwood, production mix, hardwood, dried (u=10%), planed, at sawmill {CH}",
      locationCode: "CH",
      expectedBase: "Sawnwood, hardwood",
      expectedTreatment: "dried (u=10%), planed, at sawmill",
      expectedMix: "production mix, Switzerland",
    },
    {
      id: "ffffffff-1111-4222-8333-44444444444d",
      baseName:
        "Sawnwood, softwood, raw, dried (u=20%), planed, Swiss wood, at regional storage, with resource correction {CH}",
      locationCode: "CH",
      expectedBase: "Sawnwood, softwood",
      expectedTreatment:
        "raw, dried (u=20%), planed, Swiss wood, at regional storage, with resource correction",
      expectedMix: "supply mix, Switzerland",
    },
    {
      id: "ffffffff-1111-4222-8333-444444444449",
      baseName: "Photovoltaic laminate, micro-Si, at regional storage",
      locationCode: "RER",
      expectedBase: "Photovoltaic laminate, micro-Si",
      expectedTreatment: "at regional storage",
      expectedMix: "supply mix, Europe",
    },
    {
      id: "ffffffff-1111-4222-8333-444444444447",
      baseName: "Electricity mix, GO cancellations",
      locationCode: "CY",
      expectedBase: "Electricity",
      expectedTreatment: "mix, GO cancellations",
      expectedMix: "supply mix, Cyprus",
    },
    {
      id: "ffffffff-1111-4222-8333-444444444448",
      baseName: "Track bed",
      locationCode: "CH",
      expectedBase: "Track bed",
      expectedTreatment: "rail infrastructure",
      expectedMix: "rail infrastructure, Switzerland",
    },
    {
      id: "11111111-2222-4333-8444-555555555556",
      baseName: "Natural gas, liquefied, production OM, at freight ship {JP}",
      locationCode: "JP",
      expectedBase: "Natural gas, liquefied",
      expectedTreatment: "production OM",
      expectedMix: "at freight ship",
    },
    {
      id: "11111111-2222-4333-8444-555555555557",
      baseName: "Natural gas, burned in boiler modulating <100kW {RER}",
      locationCode: "RER",
      expectedBase: "Natural gas",
      expectedTreatment: "burned in boiler modulating <100kW",
      expectedMix: "production mix, Europe",
    },
    {
      id: "11111111-2222-4333-8444-555555555558",
      baseName: "Mixed construction and demolition waste to sorting",
      locationCode: "CH",
      expectedBase: "Mixed construction and demolition waste",
      expectedTreatment: "to sorting",
      expectedMix: "treatment service, Switzerland",
    },
    {
      id: "11111111-2222-4333-8444-555555555559",
      baseName: "xx Heat, natural gas, at boiler modulating <100kW {RER}",
      locationCode: "RER",
      expectedBase: "Heat, natural gas",
      expectedTreatment: "at boiler modulating <100kW",
      expectedMix: "production mix, Europe",
    },
    {
      id: "11111111-2222-4333-8444-555555555560",
      baseName: "Heat, propane/butane, at boiler condensing modulating 50kW",
      locationCode: "CH",
      expectedBase: "Heat, propane/butane",
      expectedTreatment: "at boiler condensing modulating 50kW",
      expectedMix: "production mix, Switzerland",
    },
    {
      id: "11111111-2222-4333-8444-555555555561",
      baseName: "Lignite briquette, burned in stove 5-15kW",
      locationCode: "RER",
      expectedBase: "Lignite briquette",
      expectedTreatment: "burned in stove 5-15kW",
      expectedMix: "production mix, Europe",
    },
    {
      id: "11111111-2222-4333-8444-555555555562",
      baseName: "Heat, softwood chips from forest, at furnace 5000kW",
      locationCode: "CH",
      expectedBase: "Heat, softwood chips from forest",
      expectedTreatment: "at furnace 5000kW",
      expectedMix: "production mix, Switzerland",
    },
    {
      id: "11111111-2222-4333-8444-555555555565",
      baseName: "Heat, lignite briquette, at stove 5-15kW",
      locationCode: "RER",
      expectedBase: "Heat, lignite briquette",
      expectedTreatment: "at stove 5-15kW",
      expectedMix: "production mix, Europe",
    },
    {
      id: "11111111-2222-4333-8444-555555555566",
      baseName: "Gravel, crushed, at mine",
      locationCode: "CH",
      expectedBase: "Gravel, crushed",
      expectedTreatment: "at mine",
      expectedMix: "production mix, Switzerland",
    },
    {
      id: "11111111-2222-4333-8444-555555555567",
      baseName: "Injection moulding",
      locationCode: "RER",
      expectedBase: "Injection moulding",
      expectedTreatment: "manufacturing service",
      expectedMix: "manufacturing service, Europe",
    },
    {
      id: "11111111-2222-4333-8444-555555555568",
      baseName: "Disposal of heating system, apartment building Ecofaubourg A",
      locationCode: "CH",
      expectedBase: "heating system, apartment building Ecofaubourg A",
      expectedTreatment: "disposal",
      expectedMix: "disposal service, Switzerland",
    },
    {
      id: "11111111-2222-4333-8444-555555555569",
      baseName: "Extrusion, plastic film",
      locationCode: "RER",
      expectedBase: "Extrusion",
      expectedTreatment: "plastic film",
      expectedMix: "manufacturing service, Europe",
    },
    {
      id: "11111111-2222-4333-8444-555555555570",
      baseName: "Mixed rubble to mixed rubble treatment",
      locationCode: "CH",
      expectedBase: "Mixed rubble",
      expectedTreatment: "to mixed rubble treatment",
      expectedMix: "treatment service, Switzerland",
    },
    {
      id: "11111111-2222-4333-8444-555555555596",
      baseName: "Recycling rubber and leather",
      locationCode: "RER",
      expectedBase: "rubber and leather",
      expectedTreatment: "recycling",
      expectedMix: "recovered material, Europe",
    },
    {
      id: "11111111-2222-4333-8444-555555555597",
      baseName: "Gypsum plaster and gypsum fibre board, packaging",
      locationCode: "DE",
      expectedBase: "Gypsum plaster and gypsum fibre board",
      expectedTreatment: "packaging",
      expectedMix: "supply mix, Germany",
    },
    {
      id: "11111111-2222-4333-8444-555555555571",
      baseName: "Convector radiator",
      locationCode: "CH",
      expectedBase: "Convector radiator",
      expectedTreatment: "production",
      expectedMix: "production mix, Switzerland",
    },
    {
      id: "11111111-2222-4333-8444-555555555572",
      baseName: "Various components for heating system",
      locationCode: "CH",
      expectedBase: "Various components for heating system",
      expectedTreatment: "production",
      expectedMix: "production mix, Switzerland",
    },
    {
      id: "11111111-2222-4333-8444-555555555573",
      baseName: "Floor heating tube",
      locationCode: "CH",
      expectedBase: "Floor heating tube",
      expectedTreatment: "production",
      expectedMix: "production mix, Switzerland",
    },
    {
      id: "11111111-2222-4333-8444-555555555574",
      baseName: "LTO electrode material (Li4Ti5O12)",
      locationCode: "GLO",
      expectedBase: "LTO electrode material (Li4Ti5O12)",
      expectedTreatment: "production",
      expectedMix: "production mix, global",
    },
    {
      id: "11111111-2222-4333-8444-555555555575",
      baseName: "Powder coating, aluminium sheet",
      locationCode: "RER",
      expectedBase: "Powder coating",
      expectedTreatment: "aluminium sheet",
      expectedMix: "manufacturing service, Europe",
    },
    {
      id: "11111111-2222-4333-8444-555555555606",
      baseName: "Anodising, aluminium sheet",
      locationCode: "RER",
      expectedBase: "Anodising",
      expectedTreatment: "aluminium sheet",
      expectedMix: "manufacturing service, Europe",
    },
    {
      id: "11111111-2222-4333-8444-555555555613",
      baseName: "Wire drawing, copper {RER}",
      locationCode: "RER",
      expectedBase: "Wire drawing",
      expectedTreatment: "copper",
      expectedMix: "manufacturing service, Europe",
    },
    {
      id: "11111111-2222-4333-8444-555555555576",
      baseName: "Excavation, hydraulic digger, with particle filter",
      locationCode: "CH",
      expectedBase: "Excavation",
      expectedTreatment: "hydraulic digger, with particle filter",
      expectedMix: "construction service, Switzerland",
    },
    {
      id: "11111111-2222-4333-8444-555555555577",
      baseName: "Foaming, expanding",
      locationCode: "RER",
      expectedBase: "Foaming",
      expectedTreatment: "expanding",
      expectedMix: "manufacturing service, Europe",
    },
    {
      id: "11111111-2222-4333-8444-555555555598",
      baseName: "Weeving, bast fibres",
      locationCode: "IN",
      expectedBase: "Weeving",
      expectedTreatment: "bast fibres",
      expectedMix: "manufacturing service, India",
    },
    {
      id: "11111111-2222-4333-8444-555555555579",
      baseName: "Cathode paste, NCA",
      locationCode: "JP",
      expectedBase: "Cathode paste",
      expectedTreatment: "NCA",
      expectedMix: "production mix, Japan",
    },
    {
      id: "11111111-2222-4333-8444-555555555600",
      baseName: "Cathode",
      locationCode: "GLO",
      expectedBase: "Cathode",
      expectedTreatment: "production",
      expectedMix: "production mix, global",
    },
    {
      id: "11111111-2222-4333-8444-555555555601",
      baseName: "Positive current collector Al",
      locationCode: "GLO",
      expectedBase: "Positive current collector Al",
      expectedTreatment: "production",
      expectedMix: "production mix, global",
    },
    {
      id: "11111111-2222-4333-8444-555555555580",
      baseName: "Fuel supply for diesel vehicles",
      locationCode: "RER",
      expectedBase: "Fuel supply",
      expectedTreatment: "for diesel vehicles",
      expectedMix: "supply mix, Europe",
    },
    {
      id: "11111111-2222-4333-8444-555555555599",
      baseName: "Production efforts, resistors",
      locationCode: "GLO",
      expectedBase: "Production efforts",
      expectedTreatment: "resistors",
      expectedMix: "production mix, global",
    },
    {
      id: "11111111-2222-4333-8444-555555555581",
      baseName: "Pushed pile, 113mm MFH Wildbachstrasse Zurich",
      locationCode: "CH",
      expectedBase: "Pushed pile",
      expectedTreatment: "113mm MFH Wildbachstrasse Zurich",
      expectedMix: "construction service, Switzerland",
    },
    {
      id: "11111111-2222-4333-8444-555555555607",
      baseName: "Sheet pile wall, strutted apart, vibrated, MFH Rapperswil",
      locationCode: "CH",
      expectedBase: "Sheet pile wall",
      expectedTreatment: "strutted apart, vibrated, MFH Rapperswil",
      expectedMix: "construction service, Switzerland",
    },
    {
      id: "11111111-2222-4333-8444-555555555608",
      baseName: "Concrete pile, 1200mm, piped, Integra L2 Wallisellen",
      locationCode: "CH",
      expectedBase: "Concrete pile",
      expectedTreatment: "1200mm, piped, Integra L2 Wallisellen",
      expectedMix: "construction service, Switzerland",
    },
    {
      id: "11111111-2222-4333-8444-555555555617",
      baseName:
        "Displacement pile, concrete 620mm, high reinforced, Integra Wohnen Wallisellen {CH}",
      locationCode: "CH",
      expectedBase: "Displacement pile",
      expectedTreatment: "concrete 620mm, high reinforced, Integra Wohnen Wallisellen",
      expectedMix: "construction service, Switzerland",
    },
    {
      id: "11111111-2222-4333-8444-555555555582",
      baseName: "Transport, barge tanker",
      locationCode: "RER",
      expectedBase: "Transport",
      expectedTreatment: "barge tanker",
      expectedMix: "transport service, Europe",
    },
    {
      id: "11111111-2222-4333-8444-555555555614",
      baseName: "Transport, passenger car, gasoline, Medium, 2021, EURO-6d {RER}",
      locationCode: "RER",
      expectedBase: "Transport",
      expectedTreatment: "passenger car, gasoline, Medium, 2021, EURO-6d",
      expectedMix: "transport service, Europe",
    },
    {
      id: "11111111-2222-4333-8444-555555555615",
      baseName: "Natural gas, high pressure, at consumer {GR}",
      locationCode: "GR",
      expectedBase: "Natural gas",
      expectedTreatment: "high pressure, at consumer",
      expectedMix: "supply mix, Greece",
    },
    {
      id: "11111111-2222-4333-8444-555555555616",
      baseName: "Tap water, water balance according to MoeK 2013, at user {TR}",
      locationCode: "TR",
      expectedBase: "Tap water",
      // The "according to MoeK 2013" source-locator citation is stripped (it would
      // otherwise trip the semantic_name_source_locator_in_name gate in any name
      // field), "water balance" becomes the treatment qualifier, "at user" the mix.
      expectedTreatment: "water balance",
      expectedMix: "at user, Türkiye",
    },
    {
      id: "11111111-2222-4333-8444-555555555583",
      baseName: "Bulk goods, construction, combustible, in MSWI",
      locationCode: "CH",
      expectedBase: "Bulk goods",
      expectedTreatment: "construction, combustible, in MSWI",
      expectedMix: "disposal service, Switzerland",
    },
    {
      id: "11111111-2222-4333-8444-555555555584",
      baseName: "Pipe, stainless steel",
      locationCode: "CH",
      expectedBase: "Pipe",
      expectedTreatment: "stainless steel",
      expectedMix: "supply mix, Switzerland",
    },
    {
      id: "11111111-2222-4333-8444-555555555586",
      baseName: "Steel pipe, black, primed",
      locationCode: "CH",
      expectedBase: "Steel pipe",
      expectedTreatment: "black, primed",
      expectedMix: "supply mix, Switzerland",
    },
    {
      id: "11111111-2222-4333-8444-555555555587",
      baseName: "Heat pump, brine-water, per kg",
      locationCode: "CH",
      expectedBase: "Heat pump",
      expectedTreatment: "brine-water, per kg",
      expectedMix: "production mix, Switzerland",
    },
    {
      id: "11111111-2222-4333-8444-555555555588",
      baseName: "Branch connections and fittings, steel",
      locationCode: "CH",
      expectedBase: "Branch connections and fittings",
      expectedTreatment: "steel",
      expectedMix: "supply mix, Switzerland",
    },
    {
      id: "11111111-2222-4333-8444-555555555589",
      baseName: "Mineral wool insulation 100mm, cladding with reinforced alumium foil",
      locationCode: "CH",
      expectedBase: "Mineral wool insulation",
      expectedTreatment: "100mm, cladding with reinforced alumium foil",
      expectedMix: "supply mix, Switzerland",
    },
    {
      id: "11111111-2222-4333-8444-555555555605",
      baseName: "PIR insulation with PVC cladding, insulation thickness 60mm",
      locationCode: "CH",
      expectedBase: "PIR insulation with PVC cladding",
      expectedTreatment: "insulation thickness 60mm",
      expectedMix: "supply mix, Switzerland",
    },
    {
      id: "11111111-2222-4333-8444-555555555618",
      baseName: "Paper, woodfree, coated, at non-integrated mill {RER}",
      locationCode: "RER",
      expectedBase: "Paper",
      expectedTreatment: "woodfree, coated, at non-integrated mill",
      expectedMix: "production mix, Europe",
    },
    {
      id: "11111111-2222-4333-8444-555555555619",
      baseName: "Electrolyte, NCA {JP}",
      locationCode: "JP",
      expectedBase: "Electrolyte",
      expectedTreatment: "NCA",
      expectedMix: "production mix, Japan",
    },
    {
      id: "11111111-2222-4333-8444-555555555620",
      baseName: "Sputtering, ITO, for LCD {RER}",
      locationCode: "RER",
      expectedBase: "Sputtering",
      expectedTreatment: "ITO, for LCD",
      expectedMix: "manufacturing service, Europe",
    },
    {
      id: "11111111-2222-4333-8444-555555555622",
      baseName: "Hot rolling, steel {RER}",
      locationCode: "RER",
      expectedBase: "Hot rolling",
      expectedTreatment: "steel",
      expectedMix: "manufacturing service, Europe",
    },
    {
      id: "11111111-2222-4333-8444-555555555623",
      baseName: "xxx Bark chips, softwood, u=140%, at forest road {RER}",
      locationCode: "RER",
      expectedBase: "Bark chips",
      expectedTreatment: "softwood, u=140%, at forest road",
      expectedMix: "production mix, Europe",
    },
    {
      id: "11111111-2222-4333-8444-555555555624",
      baseName:
        "xx Methane, 96 vol-%, from biogas, from medium pressure network, at service station {CH}",
      locationCode: "CH",
      expectedBase: "Methane",
      expectedTreatment: "96 vol-%, from biogas, from medium pressure network, at service station",
      expectedMix: "supply mix, Switzerland",
    },
    {
      id: "11111111-2222-4333-8444-555555555625",
      baseName:
        "Refined Waste Cooking Oil {RER} | Refining of waste cooking oil Europe | Alloc Rec, U {RER}",
      locationCode: "RER",
      expectedBase: "Refined Waste Cooking Oil",
      expectedTreatment: "Refining of waste cooking oil Europe, Alloc Rec, U",
      expectedMix: "recovered material, Europe",
    },
    {
      id: "11111111-2222-4333-8444-555555555621",
      baseName: "Tray lid {GLO}",
      locationCode: "GLO",
      expectedBase: "Tray lid",
      expectedTreatment: "production",
      expectedMix: "production mix, global",
    },
    {
      id: "11111111-2222-4333-8444-555555555590",
      baseName: "Borehole heat exchanger, per m",
      locationCode: "CH",
      expectedBase: "Borehole heat exchanger",
      expectedTreatment: "per m",
      expectedMix: "production mix, Switzerland",
    },
    {
      id: "11111111-2222-4333-8444-555555555591",
      baseName: "Prefabricated driven pile, concrete, rectangular cross-section 240 x 240 mm",
      locationCode: "CH",
      expectedBase: "Prefabricated driven pile",
      expectedTreatment: "concrete, rectangular cross-section 240 x 240 mm",
      expectedMix: "construction service, Switzerland",
    },
    {
      id: "11111111-2222-4333-8444-555555555592",
      baseName: "Sawn timber, paraná pine (SFM), u=15%, BR, at maritime harbour",
      locationCode: "RER",
      expectedBase: "Sawn timber",
      expectedTreatment: "paraná pine (SFM), u=15%, BR, at maritime harbour",
      expectedMix: "supply mix, Europe",
    },
    {
      id: "11111111-2222-4333-8444-555555555593",
      baseName: "Sawn timber, paraná pine (SFM), kiln dried, u=15%, at sawmill",
      locationCode: "BR",
      expectedBase: "Sawn timber",
      expectedTreatment: "paraná pine (SFM), kiln dried, u=15%, at sawmill",
      expectedMix: "production mix, Brazil",
    },
    {
      id: "11111111-2222-4333-8444-555555555594",
      baseName: "Wood to waste wood sorting",
      locationCode: "CH",
      expectedBase: "Wood",
      expectedTreatment: "to waste wood sorting",
      expectedMix: "treatment service, Switzerland",
    },
    {
      id: "11111111-2222-4333-8444-555555555602",
      baseName: "Wood chips, mixed, u=120%, at forest",
      locationCode: "RER",
      expectedBase: "Wood chips",
      expectedTreatment: "mixed, u=120%, at forest",
      expectedMix: "production mix, Europe",
    },
    {
      id: "11111111-2222-4333-8444-555555555603",
      baseName: "Wood chips, softwood, u=140%, at forest",
      locationCode: "RER",
      expectedBase: "Wood chips",
      expectedTreatment: "softwood, u=140%, at forest",
      expectedMix: "production mix, Europe",
    },
    {
      id: "11111111-2222-4333-8444-555555555604",
      baseName: "Wood chips, hardwood, u=80%, at forest",
      locationCode: "RER",
      expectedBase: "Wood chips",
      expectedTreatment: "hardwood, u=80%, at forest",
      expectedMix: "production mix, Europe",
    },
    {
      id: "11111111-2222-4333-8444-555555555595",
      baseName: "EKG I, sanitary facilities, residental building, deconstruction",
      locationCode: "CH",
      expectedBase: "EKG I",
      expectedTreatment: "sanitary facilities, residental building, deconstruction",
      expectedMix: "deconstruction service, Switzerland",
    },
    {
      id: "11111111-2222-4333-8444-555555555563",
      baseName: "Electricity imports",
      locationCode: "LU",
      expectedBase: "Electricity",
      expectedTreatment: "imports",
      expectedMix: "supply mix, Luxembourg",
    },
    {
      id: "11111111-2222-4333-8444-555555555609",
      baseName: "Electricity imports {LT}",
      locationCode: "LT",
      expectedBase: "Electricity",
      expectedTreatment: "imports",
      expectedMix: "supply mix, Lithuania",
    },
    {
      id: "11111111-2222-4333-8444-555555555564",
      baseName: "Electricity mix",
      locationCode: "PE",
      expectedBase: "Electricity",
      expectedTreatment: "mix",
      expectedMix: "supply mix, Peru",
    },
    {
      id: "11111111-2222-4333-8444-555555555610",
      baseName: "Electricity mix {FI}",
      locationCode: "FI",
      expectedBase: "Electricity",
      expectedTreatment: "mix",
      expectedMix: "supply mix, Finland",
    },
    {
      id: "11111111-2222-4333-8444-555555555611",
      baseName: "xxx Electricity mix, GO cancellations {EE}",
      locationCode: "EE",
      expectedBase: "Electricity",
      expectedTreatment: "mix, GO cancellations",
      expectedMix: "supply mix, Estonia",
    },
    {
      id: "11111111-2222-4333-8444-555555555612",
      baseName: "Hard coal supply mix {AT}",
      locationCode: "AT",
      expectedBase: "Hard coal",
      expectedTreatment: "supply",
      expectedMix: "supply mix, Austria",
    },
    {
      id: "11111111-2222-4333-8444-555555555585",
      baseName: "Electricity, certified eletricity",
      locationCode: "CH",
      expectedBase: "Electricity",
      expectedTreatment: "certified eletricity",
      expectedMix: "supply mix, Switzerland",
    },
  ];
  const tasks = [];
  for (const item of cases) {
    const packagePath = path.join(root, "authoring-package-snapshots", `flow-${item.id}.json`);
    const patchPath = path.join(root, `flow-${item.id}`, "ai-patches.json");
    writeJson(packagePath, {
      dataset_type: "flow",
      entity_id: item.id,
      version: "00.00.001",
      source_row: namedFlowRow(item.id, item.baseName, item.locationCode ?? "CH"),
    });
    tasks.push({
      status: "ready_for_ai_authoring",
      entity: {
        dataset_type: "flow",
        entity_id: item.id,
        version: "00.00.001",
        profile: "bafu",
      },
      context: {
        source_rows_file: rel(path.join(root, "flows.cleaned.jsonl")),
        authoring_package_sha256: sha256Text(fs.readFileSync(packagePath, "utf8")),
        full_context_ai_completion: { required: false },
        contract_context_files: [],
        missing_context_files: [],
      },
      action_items: routeSplitSemanticActionItems(item.baseName, item.locationCode ?? "CH"),
      files: {
        authoring_package: rel(packagePath),
        output_patch_file: rel(patchPath),
        task_json: rel(path.join(root, `flow-${item.id}`, "ai-authoring-task.json")),
      },
    });
  }
  const manifestPath = path.join(root, "authoring-task-manifest.json");
  writeJson(manifestPath, {
    schema_version: 1,
    status: "ready_for_ai_authoring_batch",
    tasks,
  });

  try {
    const autofill = runFoundry([
      "dataset-bafu-authoring-patches-autofill",
      "--task-manifest",
      rel(manifestPath),
    ]);
    assert.equal(autofill.code, 0);
    assert.equal(autofill.json.status, "completed");
    for (const item of cases) {
      const patch = readJson(path.join(root, `flow-${item.id}`, "ai-patches.json"));
      const operations = patch.patch_sets[0].operations;
      assert.deepEqual(
        operations.find((operation: PatchOperation) => operation.path.endsWith("/baseName")).value,
        {
          "@xml:lang": "en",
          "#text": item.expectedBase,
        },
      );
      assert.deepEqual(
        operations.find((operation: PatchOperation) =>
          operation.path.endsWith("/treatmentStandardsRoutes"),
        ).value,
        { "@xml:lang": "en", "#text": item.expectedTreatment },
      );
      assert.deepEqual(
        operations.find((operation: PatchOperation) =>
          operation.path.endsWith("/mixAndLocationTypes"),
        ).value,
        { "@xml:lang": "en", "#text": item.expectedMix },
      );
    }

    const collect = runFoundry([
      "dataset-authoring-patch-collect",
      "--task-manifest",
      rel(manifestPath),
    ]);
    assert.equal(collect.code, 0);
    assert.equal(collect.json.status, "ready_for_patch_apply");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("BAFU patch autofill splits elementary qualifier without inventing mix location", () => {
  const root = path.join(fixtureRoot, "elementary-qualifier-patch");
  fs.rmSync(root, { recursive: true, force: true });
  const id = "11111111-2222-4333-8444-555555555578";
  const packagePath = path.join(root, "authoring-package-snapshots", `flow-${id}.json`);
  const patchPath = path.join(root, `flow-${id}`, "ai-patches.json");
  writeJson(packagePath, {
    dataset_type: "flow",
    entity_id: id,
    version: "00.00.001",
    source_row: namedFlowRow(id, "Carbon dioxide, fossil", "GLO"),
  });
  const manifestPath = path.join(root, "authoring-task-manifest.json");
  writeJson(manifestPath, {
    schema_version: 1,
    status: "ready_for_ai_authoring_batch",
    tasks: [
      {
        status: "ready_for_ai_authoring",
        entity: {
          dataset_type: "flow",
          entity_id: id,
          version: "00.00.001",
          profile: "bafu",
        },
        context: {
          source_rows_file: rel(path.join(root, "flows.cleaned.jsonl")),
          authoring_package_sha256: sha256Text(fs.readFileSync(packagePath, "utf8")),
          full_context_ai_completion: { required: false },
          contract_context_files: [],
          missing_context_files: [],
        },
        action_items: [
          {
            code: "semantic_name_treatment_placeholder",
            path: "flowDataSet.flowInformation.dataSetInformation.name.treatmentStandardsRoutes",
            evidence: {
              text: "source-described route",
              current_name: {
                baseName: "Carbon dioxide, fossil",
                treatmentStandardsRoutes: "source-described route",
                mixAndLocationTypes: "source-described geography",
              },
            },
            allowed_resolution_modes: ["source_language_normalization"],
          },
        ],
        files: {
          authoring_package: rel(packagePath),
          output_patch_file: rel(patchPath),
          task_json: rel(path.join(root, `flow-${id}`, "ai-authoring-task.json")),
        },
      },
    ],
  });

  try {
    const autofill = runFoundry([
      "dataset-bafu-authoring-patches-autofill",
      "--task-manifest",
      rel(manifestPath),
    ]);
    assert.equal(autofill.code, 0);
    assert.equal(autofill.json.status, "completed");
    const operations = readJson(patchPath).patch_sets[0].operations;
    assert.equal(operations.length, 2);
    assert.deepEqual(
      operations.find((operation: PatchOperation) => operation.path.endsWith("/baseName")).value,
      {
        "@xml:lang": "en",
        "#text": "Carbon dioxide",
      },
    );
    assert.deepEqual(
      operations.find((operation: PatchOperation) =>
        operation.path.endsWith("/treatmentStandardsRoutes"),
      ).value,
      { "@xml:lang": "en", "#text": "fossil" },
    );
    assert.equal(
      operations.some((operation: PatchOperation) =>
        operation.path.endsWith("/mixAndLocationTypes"),
      ),
      false,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("BAFU patch autofill cleans post-finalize disposal market-mix residue", () => {
  const root = path.join(fixtureRoot, "flow-post-finalize-disposal-market");
  fs.rmSync(root, { recursive: true, force: true });
  const id = "11111111-2222-4333-8444-555555555626";
  const packagePath = path.join(root, "authoring-package-snapshots", `flow-${id}.json`);
  const patchPath = path.join(root, `flow-${id}`, "ai-patches.json");
  const row = namedFlowRow(
    id,
    "Disposal, building, window frame, wood, market mix, m2 visible",
    "CH",
  );
  row.flowDataSet.flowInformation.dataSetInformation.name.treatmentStandardsRoutes = {
    "@xml:lang": "en",
    "#text": "disposal route, disposal route, to final disposal, market",
  };
  row.flowDataSet.flowInformation.dataSetInformation.name.mixAndLocationTypes = {
    "@xml:lang": "en",
    "#text": "disposal service, Switzerland",
  };
  writeJson(packagePath, {
    dataset_type: "flow",
    entity_id: id,
    version: "00.00.001",
    source_row: row,
  });
  const manifestPath = path.join(root, "authoring-task-manifest.json");
  writeJson(manifestPath, {
    schema_version: 1,
    status: "ready_for_ai_authoring_batch",
    tasks: [
      {
        status: "ready_for_ai_authoring",
        entity: { dataset_type: "flow", entity_id: id, version: "00.00.001", profile: "bafu" },
        context: {
          source_rows_file: rel(path.join(root, "flows.cleaned.jsonl")),
          authoring_package_sha256: sha256Text(fs.readFileSync(packagePath, "utf8")),
          full_context_ai_completion: { required: false },
          contract_context_files: [],
          missing_context_files: [],
        },
        action_items: [
          {
            code: "semantic_name_base_contains_unsplit_segments",
            path: "flowDataSet.flowInformation.dataSetInformation.name.baseName",
            evidence: {
              text: "Disposal, building, window frame, wood, market mix, m2 visible",
              detected_segments: ["mix_phrase"],
            },
          },
        ],
        files: {
          authoring_package: rel(packagePath),
          output_patch_file: rel(patchPath),
          task_json: rel(path.join(root, `flow-${id}`, "ai-authoring-task.json")),
        },
      },
    ],
  });

  try {
    const autofill = runFoundry([
      "dataset-bafu-authoring-patches-autofill",
      "--task-manifest",
      rel(manifestPath),
    ]);
    assert.equal(autofill.code, 0);
    assert.equal(autofill.json.status, "completed");
    const operations = readJson(patchPath).patch_sets[0].operations;
    assert.deepEqual(
      operations.find((operation: PatchOperation) => operation.path.endsWith("/baseName")).value,
      {
        "@xml:lang": "en",
        "#text": "Disposal, building, window frame, wood",
      },
    );
    assert.deepEqual(
      operations.find((operation: PatchOperation) =>
        operation.path.endsWith("/treatmentStandardsRoutes"),
      ).value,
      { "@xml:lang": "en", "#text": "to final disposal, m2 visible" },
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("BAFU patch autofill moves disposal market mix out of flow baseName", () => {
  const root = path.join(fixtureRoot, "flow-disposal-market-mix-wall-opening");
  fs.rmSync(root, { recursive: true, force: true });
  const id = "11111111-2222-4333-8444-555555555627";
  const packagePath = path.join(root, "authoring-package-snapshots", `flow-${id}.json`);
  const patchPath = path.join(root, `flow-${id}`, "ai-patches.json");
  const row = namedFlowRow(
    id,
    "Disposal, building, window frame, wood, market mix, wall opening, to final disposal",
    "CH",
  );
  row.flowDataSet.flowInformation.dataSetInformation.name.treatmentStandardsRoutes = {
    "@xml:lang": "en",
    "#text": "disposal route, disposal route, to final disposal, market",
  };
  row.flowDataSet.flowInformation.dataSetInformation.name.mixAndLocationTypes = {
    "@xml:lang": "en",
    "#text": "disposal service, Switzerland",
  };
  writeJson(packagePath, {
    dataset_type: "flow",
    entity_id: id,
    version: "00.00.001",
    source_row: row,
  });
  const manifestPath = path.join(root, "authoring-task-manifest.json");
  writeJson(manifestPath, {
    schema_version: 1,
    status: "ready_for_ai_authoring_batch",
    tasks: [
      {
        status: "ready_for_ai_authoring",
        entity: { dataset_type: "flow", entity_id: id, version: "00.00.001", profile: "bafu" },
        context: {
          source_rows_file: rel(path.join(root, "flows.cleaned.jsonl")),
          authoring_package_sha256: sha256Text(fs.readFileSync(packagePath, "utf8")),
          full_context_ai_completion: { required: false },
          contract_context_files: [],
          missing_context_files: [],
        },
        action_items: [
          {
            code: "semantic_name_base_contains_unsplit_segments",
            path: "flowDataSet.flowInformation.dataSetInformation.name.baseName",
            evidence: {
              text: "Disposal, building, window frame, wood, market mix, wall opening, to final disposal",
              detected_segments: ["mix_phrase"],
            },
          },
        ],
        files: {
          authoring_package: rel(packagePath),
          output_patch_file: rel(patchPath),
          task_json: rel(path.join(root, `flow-${id}`, "ai-authoring-task.json")),
        },
      },
    ],
  });

  try {
    const autofill = runFoundry([
      "dataset-bafu-authoring-patches-autofill",
      "--task-manifest",
      rel(manifestPath),
    ]);
    assert.equal(autofill.code, 0);
    assert.equal(autofill.json.status, "completed");
    const operations = readJson(patchPath).patch_sets[0].operations;
    assert.deepEqual(
      operations.find((operation: PatchOperation) => operation.path.endsWith("/baseName")).value,
      {
        "@xml:lang": "en",
        "#text": "Disposal, building, window frame, wood, wall opening",
      },
    );
    assert.deepEqual(
      operations.find((operation: PatchOperation) =>
        operation.path.endsWith("/treatmentStandardsRoutes"),
      ).value,
      { "@xml:lang": "en", "#text": "to final disposal" },
    );
    assert.deepEqual(
      operations.find((operation: PatchOperation) =>
        operation.path.endsWith("/mixAndLocationTypes"),
      ).value,
      { "@xml:lang": "en", "#text": "market mix, Switzerland" },
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("BAFU patch autofill writes collectable process name-plan patches", () => {
  const root = path.join(fixtureRoot, "process-patch");
  fs.rmSync(root, { recursive: true, force: true });
  const packagePath = path.join(root, "authoring-package-snapshots", `process-${processId}.json`);
  const patchPath = path.join(root, "process-task", "ai-patches.json");
  writeJson(packagePath, {
    dataset_type: "process",
    entity_id: processId,
    version: "00.00.001",
    source_row: processRow(),
  });
  const packageSha = sha256Text(fs.readFileSync(packagePath, "utf8"));
  const manifestPath = path.join(root, "authoring-task-manifest.json");
  writeJson(manifestPath, {
    schema_version: 1,
    status: "ready_for_ai_authoring_batch",
    tasks: [
      {
        status: "ready_for_ai_authoring",
        entity: {
          dataset_type: "process",
          entity_id: processId,
          version: "00.00.001",
          profile: "bafu",
        },
        context: {
          source_rows_file: rel(path.join(root, "processes.cleaned.jsonl")),
          authoring_package_sha256: packageSha,
          full_context_ai_completion: { required: false },
          contract_context_files: [],
          missing_context_files: [],
        },
        action_items: processSemanticActionItems(),
        files: {
          authoring_package: rel(packagePath),
          output_patch_file: rel(patchPath),
          task_json: rel(path.join(root, "process-task", "ai-authoring-task.json")),
        },
      },
    ],
  });

  try {
    const autofill = runFoundry([
      "dataset-bafu-authoring-patches-autofill",
      "--task-manifest",
      rel(manifestPath),
    ]);
    assert.equal(autofill.code, 0);
    assert.equal(autofill.json.status, "completed");
    const patch = readJson(patchPath);
    const operations = patch.patch_sets[0].operations;
    assert.equal(operations.length, 5);
    assert.equal(
      operations.some(
        (operation: PatchOperation) =>
          operation.path ===
          "/processDataSet/processInformation/quantitativeReference/functionalUnitOrOther",
      ),
      true,
    );
    const exchangeTraceOperation = operations.find((operation: PatchOperation) =>
      operation.path.endsWith("/common:other"),
    );
    assert.equal(exchangeTraceOperation.resolution.mode, "source_trace_verified");
    assert.equal(
      exchangeTraceOperation.value["tiangongfoundry:sourceExchangeCompleteness"][0].status,
      "source_only_output_exchange_verified",
    );

    const collect = runFoundry([
      "dataset-authoring-patch-collect",
      "--task-manifest",
      rel(manifestPath),
    ]);
    assert.equal(collect.code, 0);
    assert.equal(collect.json.status, "ready_for_patch_apply");
    assert.equal(collect.json.counts.operations, 5);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("BAFU patch autofill strips functional unit name-location tokens that differ from geography", () => {
  const root = path.join(fixtureRoot, "process-functional-unit-name-token-patch");
  fs.rmSync(root, { recursive: true, force: true });
  const id = "33333333-4444-4555-8666-777777777782";
  const packagePath = path.join(root, "authoring-package-snapshots", `process-${id}.json`);
  const patchPath = path.join(root, "process-task", "ai-patches.json");
  const row = processRow(id);
  row.processDataSet.processInformation.dataSetInformation.name = {
    baseName: {
      "@xml:lang": "en",
      "#text": "Natural gas, liquefied, production QA, at freight ship {TW}",
    },
    treatmentStandardsRoutes: { "@xml:lang": "en", "#text": "source-described route" },
    mixAndLocationTypes: { "@xml:lang": "en", "#text": "TW" },
  };
  row.processDataSet.processInformation.geography.locationOfOperationSupplyOrProduction = {
    "@location": "GLO",
  };
  row.processDataSet.processInformation.quantitativeReference.functionalUnitOrOther = {
    "@xml:lang": "en",
    "#text": "1 Nm3 Natural gas, liquefied, production QA, at freight ship {TW}",
  };
  writeJson(packagePath, {
    dataset_type: "process",
    entity_id: id,
    version: "00.00.001",
    source_row: row,
  });
  const packageSha = sha256Text(fs.readFileSync(packagePath, "utf8"));
  const manifestPath = path.join(root, "authoring-task-manifest.json");
  writeJson(manifestPath, {
    schema_version: 1,
    status: "ready_for_ai_authoring_batch",
    tasks: [
      {
        status: "ready_for_ai_authoring",
        entity: {
          dataset_type: "process",
          entity_id: id,
          version: "00.00.001",
          profile: "bafu",
        },
        context: {
          source_rows_file: rel(path.join(root, "processes.cleaned.jsonl")),
          authoring_package_sha256: packageSha,
          full_context_ai_completion: { required: false },
          contract_context_files: [],
          missing_context_files: [],
        },
        action_items: [
          {
            code: "semantic_geography_token_in_name",
            path: "processDataSet.processInformation.quantitativeReference.functionalUnitOrOther.#text",
            evidence: {
              text: "1 Nm3 Natural gas, liquefied, production QA, at freight ship {TW}",
            },
          },
        ],
        files: {
          authoring_package: rel(packagePath),
          output_patch_file: rel(patchPath),
          task_json: rel(path.join(root, "process-task", "ai-authoring-task.json")),
        },
      },
    ],
  });

  try {
    const autofill = runFoundry([
      "dataset-bafu-authoring-patches-autofill",
      "--task-manifest",
      rel(manifestPath),
    ]);
    assert.equal(autofill.code, 0);
    assert.equal(autofill.json.status, "completed");
    const patch = readJson(patchPath);
    const operations = patch.patch_sets[0].operations;
    assert.deepEqual(
      operations.find((operation: PatchOperation) =>
        operation.path.endsWith("/quantitativeReference/functionalUnitOrOther"),
      )?.value,
      {
        "@xml:lang": "en",
        "#text": "1 Nm3 Natural gas, liquefied, production QA, at freight ship",
      },
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("BAFU patch autofill removes process functional unit SE suffixes", () => {
  const root = path.join(fixtureRoot, "process-functional-unit-se-patch");
  fs.rmSync(root, { recursive: true, force: true });
  const id = "33333333-4444-4555-8666-777777777781";
  const packagePath = path.join(root, "authoring-package-snapshots", `process-${id}.json`);
  const patchPath = path.join(root, "process-task", "ai-patches.json");
  const row = processRow(id);
  row.processDataSet.processInformation.dataSetInformation.name = {
    baseName: {
      "@xml:lang": "en",
      "#text": "Electricity, natural gas, at CHP power plant {SE} U - SE",
    },
    treatmentStandardsRoutes: { "@xml:lang": "en", "#text": "source-described route" },
    mixAndLocationTypes: { "@xml:lang": "en", "#text": "SE" },
  };
  row.processDataSet.processInformation.geography.locationOfOperationSupplyOrProduction = {
    "@location": "SE",
  };
  row.processDataSet.processInformation.quantitativeReference.functionalUnitOrOther = {
    "@xml:lang": "en",
    "#text": "1.0 kWh Electricity, natural gas, at CHP power plant {SE} U - SE",
  };
  writeJson(packagePath, {
    dataset_type: "process",
    entity_id: id,
    version: "00.00.001",
    source_row: row,
  });
  const packageSha = sha256Text(fs.readFileSync(packagePath, "utf8"));
  const manifestPath = path.join(root, "authoring-task-manifest.json");
  const currentName = {
    baseName: "Electricity, natural gas, at CHP power plant {SE} U - SE",
    treatmentStandardsRoutes: "source-described route",
    mixAndLocationTypes: "SE",
  };
  writeJson(manifestPath, {
    schema_version: 1,
    status: "ready_for_ai_authoring_batch",
    tasks: [
      {
        status: "ready_for_ai_authoring",
        entity: {
          dataset_type: "process",
          entity_id: id,
          version: "00.00.001",
          profile: "bafu",
        },
        context: {
          source_rows_file: rel(path.join(root, "processes.cleaned.jsonl")),
          authoring_package_sha256: packageSha,
          full_context_ai_completion: { required: false },
          contract_context_files: [],
          missing_context_files: [],
        },
        action_items: [
          {
            code: "semantic_geography_token_in_name",
            path: "processDataSet.processInformation.quantitativeReference.functionalUnitOrOther.#text",
            evidence: {
              text: "1.0 kWh Electricity, natural gas, at CHP power plant {SE} U - SE",
            },
          },
          {
            code: "semantic_name_base_contains_unsplit_segments",
            path: "processDataSet.processInformation.dataSetInformation.name.baseName",
            evidence: {
              text: "Electricity, natural gas, at CHP power plant {SE} U - SE",
              current_name: currentName,
            },
          },
          {
            code: "semantic_name_treatment_placeholder",
            path: "processDataSet.processInformation.dataSetInformation.name.treatmentStandardsRoutes",
            evidence: {
              text: "source-described route",
              current_name: currentName,
            },
          },
          {
            code: "semantic_name_mix_location_too_bare",
            path: "processDataSet.processInformation.dataSetInformation.name.mixAndLocationTypes",
            evidence: {
              text: "SE",
              location_code_candidate: "SE",
            },
          },
        ],
        files: {
          authoring_package: rel(packagePath),
          output_patch_file: rel(patchPath),
          task_json: rel(path.join(root, "process-task", "ai-authoring-task.json")),
        },
      },
    ],
  });

  try {
    const autofill = runFoundry([
      "dataset-bafu-authoring-patches-autofill",
      "--task-manifest",
      rel(manifestPath),
    ]);
    assert.equal(autofill.code, 0);
    assert.equal(autofill.json.status, "completed");
    const patch = readJson(patchPath);
    const operations = patch.patch_sets[0].operations;
    assert.equal(operations.length, 4);
    assert.deepEqual(
      operations.find((operation: PatchOperation) =>
        operation.path.endsWith("/quantitativeReference/functionalUnitOrOther"),
      )?.value,
      { "@xml:lang": "en", "#text": "1.0 kWh Electricity, natural gas, at CHP power plant" },
    );
    assert.deepEqual(
      operations.find((operation: PatchOperation) => operation.path.endsWith("/baseName"))?.value,
      {
        "@xml:lang": "en",
        "#text": "Electricity, natural gas",
      },
    );
    assert.deepEqual(
      operations.find((operation: PatchOperation) =>
        operation.path.endsWith("/treatmentStandardsRoutes"),
      )?.value,
      { "@xml:lang": "en", "#text": "at CHP power plant" },
    );
    assert.deepEqual(
      operations.find((operation: PatchOperation) =>
        operation.path.endsWith("/mixAndLocationTypes"),
      )?.value,
      { "@xml:lang": "en", "#text": "production process, Sweden" },
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("BAFU patch autofill does not remove mismatched functional unit location suffixes", () => {
  const root = path.join(fixtureRoot, "process-functional-unit-mismatch-patch");
  fs.rmSync(root, { recursive: true, force: true });
  const id = "33333333-4444-4555-8666-777777777782";
  const packagePath = path.join(root, "authoring-package-snapshots", `process-${id}.json`);
  const patchPath = path.join(root, "process-task", "ai-patches.json");
  const row = processRow(id);
  row.processDataSet.processInformation.geography.locationOfOperationSupplyOrProduction = {
    "@location": "SE",
  };
  row.processDataSet.processInformation.quantitativeReference.functionalUnitOrOther = {
    "@xml:lang": "en",
    "#text": "1.0 kWh Electricity, natural gas, at CHP power plant {NO}",
  };
  writeJson(packagePath, {
    dataset_type: "process",
    entity_id: id,
    version: "00.00.001",
    source_row: row,
  });
  const packageSha = sha256Text(fs.readFileSync(packagePath, "utf8"));
  const manifestPath = path.join(root, "authoring-task-manifest.json");
  writeJson(manifestPath, {
    schema_version: 1,
    status: "ready_for_ai_authoring_batch",
    tasks: [
      {
        status: "ready_for_ai_authoring",
        entity: {
          dataset_type: "process",
          entity_id: id,
          version: "00.00.001",
          profile: "bafu",
        },
        context: {
          source_rows_file: rel(path.join(root, "processes.cleaned.jsonl")),
          authoring_package_sha256: packageSha,
          full_context_ai_completion: { required: false },
          contract_context_files: [],
          missing_context_files: [],
        },
        action_items: [
          {
            code: "semantic_geography_token_in_name",
            path: "processDataSet.processInformation.quantitativeReference.functionalUnitOrOther.#text",
            evidence: {
              text: "1.0 kWh Electricity, natural gas, at CHP power plant {NO}",
            },
          },
        ],
        files: {
          authoring_package: rel(packagePath),
          output_patch_file: rel(patchPath),
          task_json: rel(path.join(root, "process-task", "ai-authoring-task.json")),
        },
      },
    ],
  });

  try {
    const autofill = runFoundry([
      "dataset-bafu-authoring-patches-autofill",
      "--task-manifest",
      rel(manifestPath),
    ]);
    assert.equal(autofill.code, 0);
    assert.equal(autofill.json.status, "completed_with_manual_review");
    assert.equal(autofill.json.counts.patch_files, 0);
    assert.equal(
      autofill.json.blockers[0].code,
      "bafu_process_functional_unit_location_token_unsupported",
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("BAFU patch autofill moves process market mix from baseName into mix location", () => {
  const root = path.join(fixtureRoot, "process-market-mix-patch");
  fs.rmSync(root, { recursive: true, force: true });
  const id = "33333333-4444-4555-8666-777777777778";
  const packagePath = path.join(root, "authoring-package-snapshots", `process-${id}.json`);
  const patchPath = path.join(root, "process-task", "ai-patches.json");
  const row = processRow(id);
  row.processDataSet.processInformation.dataSetInformation.name = {
    baseName: {
      "@xml:lang": "en",
      "#text": "Window frame, wood, U=1.2 W/m2K, market mix, wall opening",
    },
    treatmentStandardsRoutes: { "@xml:lang": "en", "#text": "at plant" },
    mixAndLocationTypes: { "@xml:lang": "en", "#text": "production process, Switzerland" },
  };
  row.processDataSet.processInformation.geography = {
    locationOfOperationSupplyOrProduction: { "@location": "CH" },
  };
  writeJson(packagePath, {
    dataset_type: "process",
    entity_id: id,
    version: "00.00.001",
    source_row: row,
  });
  const packageSha = sha256Text(fs.readFileSync(packagePath, "utf8"));
  const manifestPath = path.join(root, "authoring-task-manifest.json");
  writeJson(manifestPath, {
    schema_version: 1,
    status: "ready_for_ai_authoring_batch",
    tasks: [
      {
        status: "ready_for_ai_authoring",
        entity: {
          dataset_type: "process",
          entity_id: id,
          version: "00.00.001",
          profile: "bafu",
        },
        context: {
          source_rows_file: rel(path.join(root, "processes.cleaned.jsonl")),
          authoring_package_sha256: packageSha,
          full_context_ai_completion: { required: false },
          contract_context_files: [],
          missing_context_files: [],
        },
        action_items: [
          {
            code: "semantic_name_base_contains_unsplit_segments",
            path: "processDataSet.processInformation.dataSetInformation.name.baseName",
            evidence: {
              text: "Window frame, wood, U=1.2 W/m2K, market mix, wall opening",
              detected_segments: ["mix_phrase"],
            },
          },
        ],
        files: {
          authoring_package: rel(packagePath),
          output_patch_file: rel(patchPath),
          task_json: rel(path.join(root, "process-task", "ai-authoring-task.json")),
        },
      },
    ],
  });

  try {
    const autofill = runFoundry([
      "dataset-bafu-authoring-patches-autofill",
      "--task-manifest",
      rel(manifestPath),
    ]);
    assert.equal(autofill.code, 0);
    assert.equal(autofill.json.status, "completed");
    const operations = readJson(patchPath).patch_sets[0].operations;
    assert.deepEqual(
      operations.find((operation: PatchOperation) => operation.path.endsWith("/baseName")).value,
      {
        "@xml:lang": "en",
        "#text": "Window frame",
      },
    );
    assert.deepEqual(
      operations.find((operation: PatchOperation) =>
        operation.path.endsWith("/treatmentStandardsRoutes"),
      ).value,
      { "@xml:lang": "en", "#text": "wood, U=1.2 W/m2K, wall opening, at plant" },
    );
    assert.deepEqual(
      operations.find((operation: PatchOperation) =>
        operation.path.endsWith("/mixAndLocationTypes"),
      ).value,
      { "@xml:lang": "en", "#text": "market mix, Switzerland" },
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("BAFU patch autofill completes bare production process names from output context", () => {
  const root = path.join(fixtureRoot, "process-bare-production-patch");
  fs.rmSync(root, { recursive: true, force: true });
  const id = "33333333-4444-4555-8666-777777777779";
  const packagePath = path.join(root, "authoring-package-snapshots", `process-${id}.json`);
  const patchPath = path.join(root, "process-task", "ai-patches.json");
  const row = processRow(id);
  row.processDataSet.processInformation.dataSetInformation.name = {
    baseName: {
      "@xml:lang": "en",
      "#text": "Tetraethylorthosilicat",
    },
    treatmentStandardsRoutes: { "@xml:lang": "en", "#text": "source-described route" },
    mixAndLocationTypes: { "@xml:lang": "en", "#text": "RER" },
  };
  const processInformation = row.processDataSet.processInformation.dataSetInformation as Record<
    string,
    unknown
  >;
  processInformation.classificationInformation = {
    "common:classification": {
      "common:class": [
        { "@level": "0", "@classId": "C", "#text": "Manufacturing" },
        {
          "@level": "1",
          "@classId": "20",
          "#text": "Manufacture of chemicals and chemical products",
        },
      ],
    },
  };
  row.processDataSet.processInformation.geography = {
    locationOfOperationSupplyOrProduction: { "@location": "RER" },
  };
  const outputFlowReference = row.processDataSet.exchanges.exchange[0]
    .referenceToFlowDataSet as Record<string, unknown>;
  outputFlowReference["common:shortDescription"] = {
    "@xml:lang": "en",
    "#text": "Tetraethylorthosilicat",
  };
  writeJson(packagePath, {
    dataset_type: "process",
    entity_id: id,
    version: "00.00.001",
    source_row: row,
  });
  const packageSha = sha256Text(fs.readFileSync(packagePath, "utf8"));
  const manifestPath = path.join(root, "authoring-task-manifest.json");
  writeJson(manifestPath, {
    schema_version: 1,
    status: "ready_for_ai_authoring_batch",
    tasks: [
      {
        status: "ready_for_ai_authoring",
        entity: {
          dataset_type: "process",
          entity_id: id,
          version: "00.00.001",
          profile: "bafu",
        },
        context: {
          source_rows_file: rel(path.join(root, "processes.cleaned.jsonl")),
          authoring_package_sha256: packageSha,
          full_context_ai_completion: { required: false },
          contract_context_files: [],
          missing_context_files: [],
        },
        action_items: [
          {
            code: "semantic_name_treatment_placeholder",
            path: "processDataSet.processInformation.dataSetInformation.name.treatmentStandardsRoutes",
            evidence: {
              text: "source-described route",
              current_name: {
                baseName: "Tetraethylorthosilicat",
                treatmentStandardsRoutes: "source-described route",
                mixAndLocationTypes: "RER",
              },
            },
          },
          {
            code: "semantic_name_mix_location_too_bare",
            path: "processDataSet.processInformation.dataSetInformation.name.mixAndLocationTypes",
            evidence: {
              text: "RER",
              location_code_candidate: "RER",
            },
          },
        ],
        files: {
          authoring_package: rel(packagePath),
          output_patch_file: rel(patchPath),
          task_json: rel(path.join(root, "process-task", "ai-authoring-task.json")),
        },
      },
    ],
  });

  try {
    const autofill = runFoundry([
      "dataset-bafu-authoring-patches-autofill",
      "--task-manifest",
      rel(manifestPath),
    ]);
    assert.equal(autofill.code, 0);
    assert.equal(autofill.json.status, "completed");
    const operations = readJson(patchPath).patch_sets[0].operations;
    assert.deepEqual(
      operations.find((operation: PatchOperation) => operation.path.endsWith("/baseName")).value,
      {
        "@xml:lang": "en",
        "#text": "Tetraethylorthosilicat",
      },
    );
    assert.deepEqual(
      operations.find((operation: PatchOperation) =>
        operation.path.endsWith("/treatmentStandardsRoutes"),
      ).value,
      { "@xml:lang": "en", "#text": "production" },
    );
    assert.deepEqual(
      operations.find((operation: PatchOperation) =>
        operation.path.endsWith("/mixAndLocationTypes"),
      ).value,
      { "@xml:lang": "en", "#text": "production process, Europe" },
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("BAFU splitBafuNamePlan covers session rule families", () => {
  const cases = [
    {
      input: "xxx Logs, hardwood, at forest",
      base: "Logs",
      treatment: "hardwood, at forest",
    },
    {
      input: "xxx Residual wood, softwood, under bark, air dried, u=20%, at forest road",
      base: "Residual wood",
      treatment: "softwood, under bark, air dried, u=20%, at forest road",
    },
    {
      input: "Ammonia, liquid, at regional storehouse",
      base: "Ammonia, liquid",
      treatment: "at regional storehouse",
    },
    {
      input: "Dried roughage store, air dried, solar",
      base: "Dried roughage store",
      treatment: "air dried, solar",
    },
    {
      input: "Final repository for nuclear waste SF, HLW, and ILW",
      base: "Final repository",
      treatment: "for nuclear waste SF, HLW, and ILW",
    },
    {
      input: "Interim storage, for nuclear waste",
      base: "Interim storage",
      treatment: "for nuclear waste",
    },
    {
      input: "Disposal, concrete demolition, at plant",
      base: "Disposal, concrete demolition",
      treatment: "at plant",
    },
    {
      input: "Disposal, mixed demolition, at plant",
      base: "Disposal, mixed demolition",
      treatment: "at plant",
    },
    {
      input: "Process-specific burdens, residual material landfill",
      base: "Process-specific burdens",
      treatment: "residual material landfill",
    },
    {
      input: "Wrecking, transocean tanker",
      base: "transocean tanker",
      treatment: "wrecking",
    },
    {
      input: "Loose housing system, cattle",
      base: "Loose housing system",
      treatment: "cattle",
    },
    {
      input: "Recultivation, bauxite mine",
      base: "Recultivation",
      treatment: "bauxite mine",
    },
    {
      input: "Tower silo, plastic",
      base: "Tower silo",
      treatment: "plastic",
    },
    {
      input: "Grain drying, high temperature",
      base: "Grain drying",
      treatment: "high temperature",
    },
    {
      input: "Emulsion polymerisation, polyvinylchlorid",
      base: "Emulsion polymerisation",
      treatment: "polyvinylchlorid",
    },
    {
      input: "Natural gas, vented",
      base: "Natural gas",
      treatment: "vented",
    },
    {
      input: "Roads, company, internal",
      base: "Roads",
      treatment: "company, internal",
    },
    {
      input: "Particle board, melamin coated, doubleside coated (200 g",
      base: "Particle board",
      treatment: "melamin coated, doubleside coated (200 g",
    },
    {
      input: "Slanted-roof construction, integrated, on roof",
      base: "Slanted-roof construction",
      treatment: "integrated, on roof",
    },
    {
      input: "Slanted-roof construction, mounted, on roof, Stade de Suisse",
      base: "Slanted-roof construction",
      treatment: "mounted, on roof, Stade de Suisse",
    },
    {
      input: "Facade construction, mounted, at building",
      base: "Facade construction",
      treatment: "mounted, at building",
    },
    {
      input: "xxx Flat roof construction, on roof, m2",
      base: "Flat roof construction",
      treatment: "on roof, m2",
    },
    {
      input: "Production of heat distribution system, apartment building Ecofaubourg A",
      base: "Production of heat distribution system",
      treatment: "apartment building Ecofaubourg A",
    },
    {
      input: "Production of borehole heat exchanger, apartment building MCS Leimbach",
      base: "Production of borehole heat exchanger",
      treatment: "apartment building MCS Leimbach",
    },
    {
      input: "Production of heat distribution system, office building Fribourg",
      base: "Production of heat distribution system",
      treatment: "office building Fribourg",
    },
    {
      input: "Heat treatment, cold impact extrusion, aluminium",
      base: "Heat treatment",
      treatment: "cold impact extrusion, aluminium",
    },
    {
      input: "Charger, for electric scooter",
      base: "Charger",
      treatment: "for electric scooter",
    },
    {
      input: "Generator, for hybrid passenger car",
      base: "Generator",
      treatment: "for hybrid passenger car",
    },
    {
      input: "Steel profile, tin-coated, recycling share 2000 (37% Rec.)",
      base: "Steel profile",
      treatment: "tin-coated",
      flowProperty: "recycling share 37%",
    },
    {
      input: "Sealing sheet, aluminium, recycling share 2000 (32% Rec.)",
      base: "Sealing sheet, aluminium",
      treatment: "recycled content",
      flowProperty: "recycling share 32%",
    },
    {
      input: "Copper sheet, uncoated, high recycling share (85% Rec.)",
      base: "Copper sheet",
      treatment: "uncoated",
      flowProperty: "recycling share 85%",
    },
    {
      input: "Copper sheet, uncoated, secondary production (100% Rec.)",
      base: "Copper sheet, uncoated",
      treatment: "secondary production (100% Rec.)",
    },
    {
      input: "Steel, low alloyed, secondary production (100% Rec.)",
      base: "Steel, low alloyed",
      treatment: "secondary production (100% Rec.)",
    },
    {
      input: "Biogas purification, to methane, 96 vol-%, pressure swing adsorption",
      base: "Biogas purification",
      treatment: "to methane, 96 vol-%, pressure swing adsorption",
    },
    {
      input: "Selective coating, aluminium sheet, nickel pigmented aluminium oxide",
      base: "Selective coating",
      treatment: "aluminium sheet, nickel pigmented aluminium oxide",
    },
    {
      input: "Carbon fiber, weaved, at factory",
      base: "Carbon fiber, weaved",
      treatment: "at factory",
    },
    {
      input: "Calendering, rigid sheets",
      base: "Calendering",
      treatment: "rigid sheets",
    },
    {
      input: "Crushing, rock",
      base: "Crushing",
      treatment: "rock",
    },
    {
      input: "Packing, lime products",
      base: "Packing",
      treatment: "lime products",
    },
    {
      input: "Drawing of pipes, steel",
      base: "Drawing of pipes",
      treatment: "steel",
    },
    {
      input: "Yarn production, bast fibres",
      base: "Yarn production",
      treatment: "bast fibres",
    },
    {
      input: "Spruce wood, chipping and drying",
      base: "Spruce wood",
      treatment: "chipping and drying",
    },
    {
      input: "Operation, electric bicycle",
      base: "electric bicycle",
      treatment: "operation",
    },
    {
      input: "Operation, electric bicycle, certified electricity",
      base: "electric bicycle",
      treatment: "operation, certified electricity",
    },
    {
      input: "Uranium, enriched 4.75% for PWR",
      base: "Uranium",
      treatment: "enriched 4.75% for PWR",
    },
    {
      input: "Ventilated ceiling system, commercial kitchen",
      base: "Ventilated ceiling system",
      treatment: "commercial kitchen",
    },
    {
      input: "Jute fibres, irrigated system, at farm",
      base: "Jute fibres",
      treatment: "irrigated system, at farm",
    },
    {
      input: "Steam brake, polyethylen (PE), flame-protected",
      base: "Steam brake",
      treatment: "polyethylen (PE), flame-protected",
    },
    {
      input: "Methane, 96 vol-%, from biogas, at purification",
      base: "Methane",
      treatment: "96 vol-%, from biogas, at purification",
    },
    {
      input: "Molybdenum concentrate, main product",
      base: "Molybdenum concentrate",
      treatment: "main product",
    },
    {
      input: "Well for exploration and production, onshore",
      base: "Well for exploration and production",
      treatment: "onshore",
    },
    {
      input: "Heating-cooling ceiling, plasterboard",
      base: "Heating-cooling ceiling",
      treatment: "plasterboard",
    },
    {
      input: "Gravel, unspecified, at mine",
      base: "Gravel, unspecified",
      treatment: "at mine",
    },
    {
      input: "Cotton fibres, ginned, at farm",
      base: "Cotton fibres, ginned",
      treatment: "at farm",
    },
    {
      input: "Limestone, crushed, washed",
      base: "Limestone, crushed",
      treatment: "washed",
    },
    {
      input: "Insulated gate bipolar transistor, electric vehicle application",
      base: "Insulated gate bipolar transistor",
      treatment: "electric vehicle application",
    },
    {
      input: "Ground heat exchanger for office buildings, short: 0.267 m",
      base: "Ground heat exchanger for office buildings",
      treatment: "short: 0.267 m",
    },
    {
      input: "Bearing layer, bituminised",
      base: "Bearing layer",
      treatment: "bituminised",
    },
    {
      input: "Solid wood, spruce / fir / larch Switzerland, air-dried, planed",
      base: "Solid wood, spruce / fir / larch Switzerland",
      treatment: "air-dried, planed",
    },
  ];
  for (const item of cases) {
    const plan = splitBafuNamePlan(item.input, null);
    assert.equal(plan.base_name, item.base, `base_name for ${item.input}`);
    assert.equal(plan.treatment, item.treatment, `treatment for ${item.input}`);
    assert.equal(
      plan.flow_property ?? null,
      item.flowProperty ?? null,
      `flow_property for ${item.input}`,
    );
  }
});

test("BAFU process functional unit cleaning strips inline geography tokens matching the dataset location", () => {
  const cleaned = cleanProcessFunctionalUnitText(
    {
      "@xml:lang": "en",
      "#text":
        "1.0 MJ Refined Waste Cooking Oil {RER} | Refining of waste cooking oil Europe | Alloc Rec, U {RER}",
    },
    "RER",
  );
  assert.ok(cleaned, "SimaPro-style FU with inline location token must clean");
  assert.equal(
    cleaned["#text"],
    "1.0 MJ Refined Waste Cooking Oil | Refining of waste cooking oil Europe | Alloc Rec, U",
  );
  const mismatched = cleanProcessFunctionalUnitText(
    { "@xml:lang": "en", "#text": "1.0 MJ Product {CH} mix" },
    "RER",
  );
  assert.equal(mismatched, null, "tokens that do not match the dataset geography must stay");
});

test("BAFU splitBafuNamePlanFromNameParts does not duplicate treatment segments already in baseName", () => {
  const plan = splitBafuNamePlanFromNameParts(
    {
      baseName: {
        "@xml:lang": "en",
        "#text": "Aluminium, production mix for aluminium profiles, SZFF 2014, at plant",
      },
      treatmentStandardsRoutes: { "@xml:lang": "en", "#text": "at plant" },
    },
    "CH",
  );
  assert.ok(plan, "vendor-year locator name must split");
  assert.equal(plan.base_name, "Aluminium");
  assert.equal(plan.treatment, "production mix for aluminium profiles");
  assert.equal(plan.mix_location, "at plant");

  const novelTreatment = splitBafuNamePlanFromNameParts(
    {
      baseName: { "@xml:lang": "en", "#text": "Sawn timber, hardwood, SZH 2010" },
      treatmentStandardsRoutes: { "@xml:lang": "en", "#text": "kiln dried" },
    },
    "CH",
  );
  assert.ok(novelTreatment, "novel treatment segments must still be appended before the split");
  assert.match(novelTreatment.treatment, /kiln dried/u);
});

test("BAFU splitBafuNamePlan reconstructs ENTSO storage pump names idempotently", () => {
  const mixPlan = splitBafuNamePlan(
    "Electricity mix, operation storage pumps, ENTSO, winter 2018, at plant",
    null,
  );
  assert.equal(mixPlan.base_name, "Electricity");
  assert.equal(mixPlan.treatment, "mix, operation storage pumps, ENTSO, winter 2018, at plant");

  const voltagePlan = splitBafuNamePlan(
    "Electricity, high voltage, operation storage pumps, ENTSO, 2020, at grid",
    null,
  );
  assert.equal(voltagePlan.base_name, "Electricity, high voltage");
  assert.equal(voltagePlan.treatment, "operation storage pumps, ENTSO, 2020, at grid");

  const mangledPlan = splitBafuNamePlan(
    "Electricity, mix, operation storage pumps, ENTSO, summer 2018, at plant, at plant, mix, operation storage pumps, ENTSO, summer 2018, at plant",
    null,
  );
  assert.equal(mangledPlan.base_name, "Electricity");
  assert.equal(mangledPlan.treatment, "mix, operation storage pumps, ENTSO, summer 2018, at plant");

  const replayPlan = splitBafuNamePlan(`${mangledPlan.base_name}, ${mangledPlan.treatment}`, null);
  assert.equal(replayPlan.base_name, mangledPlan.base_name);
  assert.equal(replayPlan.treatment, mangledPlan.treatment);
});

test("BAFU splitBafuNamePlan extracts measured-as property ahead of generic at-plant", () => {
  const measuredPlan = splitBafuNamePlan("X, measured as dry mass, at plant", null);
  assert.equal(measuredPlan.base_name, "X");
  assert.equal(measuredPlan.treatment, "at plant");
  assert.equal(measuredPlan.flow_property, "measured as dry mass");

  const alloyPlan = splitBafuNamePlan("Aluminium alloy, AlMg3, at plant", null);
  assert.equal(alloyPlan.base_name, "Aluminium alloy, AlMg3");
  assert.equal(alloyPlan.treatment, "at plant");
  assert.equal(alloyPlan.flow_property ?? null, null);

  const cellulosePlan = splitBafuNamePlan(
    "Cellulose fibres (injected) (isofloc 2012), import, at plant",
    null,
  );
  assert.equal(cellulosePlan.base_name, "Cellulose fibres");
  assert.equal(cellulosePlan.treatment, "injected, import, at plant");
});

test("BAFU flow identity non-equivalence ignores route and geography tokens", () => {
  const target = {
    names: ["Acrylonitrile-butadiene-styrene copolymer, ABS, at plant", "at plant", "RER"],
    fields: {
      geography: "RER",
      flow_property: "Mass",
      categories: ["plastics", "rubbers"],
    },
  };
  const nylonCandidate = {
    id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
    names: ["Nylon 6", "at plant", "RER"],
    fields: {
      geography: "RER",
      flow_property: "Mass",
      categories: ["Rubber and plastics products"],
    },
  };
  const sameSubstanceCandidate = {
    id: "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff",
    names: ["Acrylonitrile-butadiene-styrene (ABS) copolymer, granulate"],
    fields: {
      flow_property: "Mass",
      categories: ["Rubber and plastics products"],
    },
  };

  const { reviewed } = bafuAutoAuthoringTestHooks.nonEquivalentFlowCandidateReasons(target, [
    nylonCandidate,
    sameSubstanceCandidate,
  ]);
  assert.equal(reviewed.length, 2);

  const nylonReview = reviewed.find((candidate) => candidate.id === nylonCandidate.id);
  assert.ok(nylonReview);
  assert.ok(Array.isArray(nylonReview.non_equivalence_reasons));
  assert.ok(nylonReview.non_equivalence_reasons.length > 0);

  const sameSubstanceReview = reviewed.find(
    (candidate) => candidate.id === sameSubstanceCandidate.id,
  );
  assert.ok(sameSubstanceReview);
  assert.ok(Array.isArray(sameSubstanceReview.non_equivalence_reasons));
  assert.equal(
    sameSubstanceReview.non_equivalence_reasons.includes(
      "flow name/physical service meaning differs",
    ),
    false,
  );
});

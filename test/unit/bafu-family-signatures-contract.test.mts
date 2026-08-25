import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import * as bafuFamilySignatures from "../../scripts/lib/bafu-family-signatures.ts";

type JsonObject = Record<string, any>;

const {
  bafuFamilyEntryFromProcess,
  bafuFamilyPlanFields,
  bafuFamilySelectionRank,
  bafuFamilySignatureForScope,
  bafuScopeKey,
  buildBafuFamilySignatureIndex,
  compactBafuFamilySignature,
  normalizeBafuFamilyName,
  summarizeBafuFamilyScopes,
  summarizeBafuFamilySignatures,
} = bafuFamilySignatures as Record<string, (...args: any[]) => any>;

function processRow({
  id,
  name,
  location,
  inputAmount,
  resultingAmount = inputAmount,
  inputFlowName = `Natural gas supply {${location}}`,
  version = "00.00.001",
}: {
  id: string;
  name: string;
  location: string;
  inputAmount: unknown;
  resultingAmount?: unknown;
  inputFlowName?: string;
  version?: string;
}): JsonObject {
  return {
    processDataSet: {
      processInformation: {
        dataSetInformation: {
          "common:UUID": id,
          name: {
            baseName: { "@xml:lang": "en", "#text": name },
            mixAndLocationTypes: { "@xml:lang": "en", "#text": location },
          },
        },
        geography: {
          locationOfOperationSupplyOrProduction: { "@location": location },
        },
      },
      exchanges: {
        exchange: [
          {
            exchangeDirection: "Input",
            referenceToFlowDataSet: {
              "common:shortDescription": { "@xml:lang": "en", "#text": inputFlowName },
            },
            meanAmount: inputAmount,
            resultingAmount,
            uncertaintyDistributionType: "normal",
            dataDerivationTypeStatus: "Measured",
          },
          {
            exchangeDirection: "Output",
            referenceToFlowDataSet: { "@refObjectId": "flow-output" },
            meanAmount: null,
          },
        ],
      },
      administrativeInformation: {
        publicationAndOwnership: { "common:dataSetVersion": version },
      },
    },
  };
}

function writeProcess(processesDir: string, row: JsonObject): string {
  const id = row.processDataSet.processInformation.dataSetInformation["common:UUID"];
  const filePath = path.join(processesDir, `${id}.json`);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(row)}\n`);
  return filePath;
}

test("BAFU signatures preserve normalized names, numeric amount vectors, skeletons, and exact hashes", () => {
  const row = processRow({
    id: "process-1",
    name: "  Heat  production CH {CH}  ",
    location: "CH",
    inputAmount: "1.0000000000000004",
    resultingAmount: "not-a-number",
    version: "01.02.003",
  });
  const signature = bafuFamilyEntryFromProcess(row, {
    filePath: "/tmp/process-1.json",
    scopeIndex: 7,
    locationTokens: ["CH"],
  });

  assert.deepEqual(signature, {
    schema_version: 1,
    process_id: "process-1",
    process_version: "01.02.003",
    scope_index: 7,
    source_file: "/tmp/process-1.json",
    process_name: "Heat  production CH {CH}",
    location: "CH",
    family_name: "Heat production <LOC> {<LOC>}",
    family_hash: "b413bee9af5ffccef1442729424399eb9f5d6a48a4ee7de94977e5af7257a8dc",
    exchange_count: 2,
    exchange_skeleton_hash: "a4e2aa7e1142c5fc0552e11f48074b9e38cefccda762334d82c73999228ac92b",
    exchange_flow_template_hash: "3c4d02236ef94cd482f6363ce8625190fc1ee09229d062f198c4fe1ed3eb7329",
    exchange_amount_vector_hash: "a85416af0bd018991fc47081ea0309eac178a29da0aedd44b44fe27d796a8a2f",
  });

  const numericallyEquivalent = bafuFamilyEntryFromProcess(
    processRow({
      id: "process-2",
      name: "Heat production DE {DE}",
      location: "DE",
      inputAmount: "1.0000000000000000",
      resultingAmount: "not-a-number",
      version: "01.02.003",
    }),
    { locationTokens: ["CH", "DE"] },
  );
  assert.equal(numericallyEquivalent.family_hash, signature.family_hash);
  assert.equal(numericallyEquivalent.exchange_skeleton_hash, signature.exchange_skeleton_hash);
  assert.equal(
    numericallyEquivalent.exchange_amount_vector_hash,
    signature.exchange_amount_vector_hash,
  );

  const changedAmount = bafuFamilyEntryFromProcess(
    processRow({
      id: "process-3",
      name: "Heat production DE {DE}",
      location: "DE",
      inputAmount: "2",
      resultingAmount: "not-a-number",
    }),
    { locationTokens: ["CH", "DE"] },
  );
  assert.equal(changedAmount.exchange_skeleton_hash, signature.exchange_skeleton_hash);
  assert.notEqual(changedAmount.exchange_amount_vector_hash, signature.exchange_amount_vector_hash);

  const reversedRow = structuredClone(row);
  reversedRow.processDataSet.exchanges.exchange.reverse();
  const reversed = bafuFamilyEntryFromProcess(reversedRow, { locationTokens: ["CH"] });
  assert.notEqual(reversed.exchange_skeleton_hash, signature.exchange_skeleton_hash);
  assert.notEqual(reversed.exchange_flow_template_hash, signature.exchange_flow_template_hash);
  assert.notEqual(reversed.exchange_amount_vector_hash, signature.exchange_amount_vector_hash);
});

test("BAFU location normalization removes only contextual and known location tokens", () => {
  assert.equal(
    normalizeBafuFamilyName("Electricity imports RER {RER}", "RER"),
    "Electricity imports <LOC> {<LOC>}",
  );
  assert.equal(
    normalizeBafuFamilyName("Electricity, Europe without Switzerland, at grid", "", {
      locationTokens: ["Europe without Switzerland"],
    }),
    "Electricity, <LOC>, at grid",
  );
  assert.equal(
    normalizeBafuFamilyName("Natural gas, liquefied, production AU, at freight ship {TW}", "GLO", {
      locationTokens: ["AU", "AT", "TW", "GLO", "lowercase", "7"],
    }),
    "Natural gas, liquefied, production <LOC>, at freight ship {<LOC>}",
  );
  assert.equal(normalizeBafuFamilyName(null, null), "");
});

test("BAFU family index preserves scope order, master selection, summaries, and missing-file envelopes", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bafu-signature-contract-"));
  const processesDir = path.join(root, "processes");
  try {
    const rows = [
      processRow({
        id: "same-amount-first",
        name: "Heat production CH {CH}",
        location: "CH",
        inputAmount: 4,
      }),
      processRow({
        id: "same-amount-second",
        name: "Heat production DE {DE}",
        location: "DE",
        inputAmount: "4.0",
      }),
      processRow({
        id: "same-skeleton-first",
        name: "Steam production FR {FR}",
        location: "FR",
        inputAmount: 1,
      }),
      processRow({
        id: "same-skeleton-second",
        name: "Steam production IT {IT}",
        location: "IT",
        inputAmount: 2,
      }),
      processRow({
        id: "standard",
        name: "Glass disposal CH {CH}",
        location: "CH",
        inputAmount: 3,
        inputFlowName: "Waste glass {CH}",
      }),
    ];
    rows.forEach((row) => writeProcess(processesDir, row));
    const scopes = [
      { process_id: "same-amount-first", process_version: "00.00.001" },
      { process_id: "same-amount-second", process_version: "00.00.001" },
      { process_id: "same-skeleton-first", process_version: "00.00.001" },
      { process_id: "same-skeleton-second", process_version: "00.00.001" },
      { process_id: "standard", process_version: "00.00.001" },
      { process_id: "missing" },
      {},
    ];
    const index = buildBafuFamilySignatureIndex({ scopes, processesDir });
    const byId = new Map<string, JsonObject>(
      index.entries.map(
        (entry: JsonObject) => [String(entry.process_id), entry] as [string, JsonObject],
      ),
    );

    assert.deepEqual(
      index.entries.map((entry: JsonObject) => entry.process_id),
      [
        "same-amount-first",
        "same-amount-second",
        "same-skeleton-first",
        "same-skeleton-second",
        "standard",
      ],
    );
    assert.deepEqual(
      index.entries.map((entry: JsonObject) => entry.optimization_role),
      [
        "same_amount_master",
        "same_amount_variant",
        "same_skeleton_master",
        "same_skeleton_variant",
        "standard",
      ],
    );
    assert.equal(byId.get("same-amount-second")?.master_process_id, "same-amount-first");
    assert.equal(byId.get("same-skeleton-second")?.master_process_id, "same-skeleton-first");
    assert.deepEqual(
      index.entries.map((entry: JsonObject) => bafuFamilySelectionRank(entry)),
      [0, 3, 1, 4, 2],
    );
    assert.deepEqual(index.missing, [
      {
        schema_version: 1,
        process_id: "missing",
        process_version: "00.00.001",
        reason: "bafu_process_json_missing",
      },
    ]);
    assert.deepEqual(index.summary, {
      schema_version: 1,
      scoped_processes: 6,
      usable_signatures: 5,
      missing_signatures: 1,
      families: 3,
      same_amount_vector_groups: 1,
      same_amount_vector_scopes: 2,
      same_amount_vector_variant_scopes: 1,
      same_skeleton_groups: 2,
      same_skeleton_scopes: 4,
      same_skeleton_variant_scopes: 2,
      same_skeleton_only_groups: 1,
      same_skeleton_only_scopes: 2,
      same_skeleton_only_variant_scopes: 1,
      standard_scopes: 1,
    });

    assert.equal(
      bafuFamilySignatureForScope(index, { id: "same-amount-first" })?.process_id,
      "same-amount-first",
    );
    assert.equal(bafuFamilySignatureForScope(index, { id: "missing" }), null);
    assert.deepEqual(summarizeBafuFamilyScopes([scopes[0], scopes[5]], index), {
      ...summarizeBafuFamilySignatures([index.entries[0]], [{}]),
      missing_signatures: 1,
    });

    const compact = compactBafuFamilySignature(byId.get("standard"), (value: string) =>
      path.relative(root, value).replaceAll("\\", "/"),
    );
    assert.equal(compact.source_file, "processes/standard.json");
    assert.deepEqual(bafuFamilyPlanFields(byId.get("standard")), {
      bafu_family_optimization_kind: "standard",
      bafu_family_optimization_role: "standard",
      bafu_family_master_process_id: "standard",
      bafu_family_group_size: 1,
      bafu_family_hash: byId.get("standard")?.family_hash,
      bafu_family_skeleton_hash: byId.get("standard")?.exchange_skeleton_hash,
      bafu_family_amount_vector_hash: byId.get("standard")?.exchange_amount_vector_hash,
    });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("BAFU missing inputs retain defaults, null lookups, and unknown planning rank", () => {
  assert.deepEqual(bafuFamilyEntryFromProcess(null), {
    schema_version: 1,
    process_id: "",
    process_version: "00.00.001",
    scope_index: 0,
    source_file: null,
    process_name: "",
    location: "",
    family_name: "",
    family_hash: "12ae32cb1ec02d01eda3581b127c1fee3b0dc53572ed6baf239721a03d82e126",
    exchange_count: 0,
    exchange_skeleton_hash: "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945",
    exchange_flow_template_hash: "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945",
    exchange_amount_vector_hash: "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945",
  });
  assert.equal(bafuScopeKey({ id: 7 }), "7@00.00.001");
  assert.equal(bafuScopeKey(null), null);
  assert.equal(bafuFamilySignatureForScope(null, null), null);
  assert.equal(compactBafuFamilySignature(null), null);
  assert.equal(bafuFamilySelectionRank(null), 5);
  assert.deepEqual(bafuFamilyPlanFields(null), {
    bafu_family_optimization_kind: "unknown",
    bafu_family_optimization_role: "unknown",
    bafu_family_master_process_id: null,
    bafu_family_group_size: null,
  });
  assert.deepEqual(buildBafuFamilySignatureIndex().summary, {
    schema_version: 1,
    scoped_processes: 0,
    usable_signatures: 0,
    missing_signatures: 0,
    families: 0,
    same_amount_vector_groups: 0,
    same_amount_vector_scopes: 0,
    same_amount_vector_variant_scopes: 0,
    same_skeleton_groups: 0,
    same_skeleton_scopes: 0,
    same_skeleton_variant_scopes: 0,
    same_skeleton_only_groups: 0,
    same_skeleton_only_scopes: 0,
    same_skeleton_only_variant_scopes: 0,
    standard_scopes: 0,
  });
});

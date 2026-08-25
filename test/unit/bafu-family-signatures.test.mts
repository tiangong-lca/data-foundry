import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  bafuFamilySelectionRank,
  buildBafuFamilySignatureIndex,
  compactBafuFamilySignature,
  normalizeBafuFamilyName,
} from "../../scripts/lib/bafu-family-signatures.ts";

function processRow({
  id,
  name,
  location,
  inputAmount,
}: {
  id: string;
  name: string;
  location: string;
  inputAmount: number;
}) {
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
          locationOfOperationSupplyOrProduction: {
            "@location": location,
          },
        },
      },
      exchanges: {
        exchange: [
          {
            exchangeDirection: "Output",
            referenceToFlowDataSet: {
              "common:shortDescription": { "@xml:lang": "en", "#text": name },
            },
            meanAmount: "1.0",
            resultingAmount: "1.0",
            uncertaintyDistributionType: "undefined",
            dataDerivationTypeStatus: "Unknown derivation",
          },
          {
            exchangeDirection: "Input",
            referenceToFlowDataSet: {
              "common:shortDescription": {
                "@xml:lang": "en",
                "#text": `Natural gas supply {${location}}`,
              },
            },
            meanAmount: String(inputAmount),
            resultingAmount: String(inputAmount),
            uncertaintyDistributionType: "undefined",
            dataDerivationTypeStatus: "Unknown derivation",
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

function writeBundleProcess(bundlesDir: string, row: ReturnType<typeof processRow>): void {
  const id = row.processDataSet.processInformation.dataSetInformation["common:UUID"];
  const filePath = path.join(bundlesDir, id, "tidas", "processes", `${id}.json`);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(row, null, 2)}\n`);
}

test("BAFU family signatures classify same amount vectors, same skeleton variants, and standard scopes", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bafu-family-signatures-"));
  const bundlesDir = path.join(root, "process-bundles");
  const ids = [
    "aaaaaaaa-0000-4000-8000-000000000001",
    "aaaaaaaa-0000-4000-8000-000000000002",
    "aaaaaaaa-0000-4000-8000-000000000003",
    "aaaaaaaa-0000-4000-8000-000000000004",
    "aaaaaaaa-0000-4000-8000-000000000005",
  ];
  try {
    writeBundleProcess(
      bundlesDir,
      processRow({
        id: ids[0],
        name: "Natural gas, production CH, at long-distance pipeline {CH}",
        location: "CH",
        inputAmount: 5,
      }),
    );
    writeBundleProcess(
      bundlesDir,
      processRow({
        id: ids[1],
        name: "Natural gas, production DE, at long-distance pipeline {DE}",
        location: "DE",
        inputAmount: 5,
      }),
    );
    writeBundleProcess(
      bundlesDir,
      processRow({
        id: ids[2],
        name: "Heat production CH, at boiler {CH}",
        location: "CH",
        inputAmount: 2,
      }),
    );
    writeBundleProcess(
      bundlesDir,
      processRow({
        id: ids[3],
        name: "Heat production DE, at boiler {DE}",
        location: "DE",
        inputAmount: 3,
      }),
    );
    writeBundleProcess(
      bundlesDir,
      processRow({
        id: ids[4],
        name: "Flat glass disposal {CH}",
        location: "CH",
        inputAmount: 7,
      }),
    );

    const index = buildBafuFamilySignatureIndex({
      scopes: ids.map((id) => ({ process_id: id, process_version: "00.00.001" })),
      processBundlesDir: bundlesDir,
    });
    const byId = new Map(index.entries.map((entry) => [entry.process_id, entry]));

    assert.equal(byId.get(ids[0]).optimization_role, "same_amount_master");
    assert.equal(byId.get(ids[1]).optimization_role, "same_amount_variant");
    assert.equal(byId.get(ids[2]).optimization_role, "same_skeleton_master");
    assert.equal(byId.get(ids[3]).optimization_role, "same_skeleton_variant");
    assert.equal(byId.get(ids[4]).optimization_role, "standard");
    assert.equal(byId.get(ids[1]).master_process_id, ids[0]);
    assert.equal(byId.get(ids[3]).master_process_id, ids[2]);
    assert.equal(index.summary.same_amount_vector_scopes, 2);
    assert.equal(index.summary.same_skeleton_scopes, 4);
    assert.equal(index.summary.same_skeleton_only_scopes, 2);
    assert.equal(index.summary.standard_scopes, 1);
    assert.deepEqual(
      [ids[0], ids[2], ids[4], ids[1], ids[3]].map((id) => bafuFamilySelectionRank(byId.get(id))),
      [0, 1, 2, 3, 4],
    );
    assert.equal(
      compactBafuFamilySignature(byId.get(ids[1]))?.source_file.endsWith(`${ids[1]}.json`),
      true,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("BAFU family name normalization does not treat lowercase words as country codes", () => {
  assert.equal(
    normalizeBafuFamilyName("Natural gas, liquefied, production AU, at freight ship {TW}", "GLO", {
      locationTokens: ["AU", "AT", "TW", "GLO"],
    }),
    "Natural gas, liquefied, production <LOC>, at freight ship {<LOC>}",
  );
});

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import { bundleRowTypeOrder, bundleRowTypes } from "../../scripts/lib/bundle-row-types.ts";
import {
  datasetRoot,
  detectDatasetType,
  detectSupportDatasetType,
} from "../../scripts/lib/import-curation/internal/dataset-payload.ts";
import {
  datasetTypeFromOptions,
  datasetTypePlural,
  defaultProfilesFile,
  referenceOnlySupportDatasetTypes,
  supportedDatasetTypes,
  supportDatasetTypes,
} from "../../scripts/lib/import-curation/internal/dataset-types.ts";

const repoRoot = path.resolve(import.meta.dirname, "..", "..");
const datasetTypeFromAliases = datasetTypeFromOptions as unknown as (
  options: Record<string, unknown>,
  forcedType?: string | null,
) => string;
const detectType = detectDatasetType as unknown as (
  value: unknown,
  fallback?: string | null,
) => string | null;

const expectedBundleRowTypes = {
  contact: {
    plural: "contacts",
    rootKey: "contactDataSet",
    informationKey: "contactInformation",
  },
  source: {
    plural: "sources",
    rootKey: "sourceDataSet",
    informationKey: "sourceInformation",
  },
  unitgroup: {
    plural: "unitgroups",
    rootKey: "unitGroupDataSet",
    informationKey: "unitGroupInformation",
  },
  flowproperty: {
    plural: "flowproperties",
    rootKey: "flowPropertyDataSet",
    informationKey: "flowPropertiesInformation",
  },
  flow: {
    plural: "flows",
    rootKey: "flowDataSet",
    informationKey: "flowInformation",
  },
  process: {
    plural: "processes",
    rootKey: "processDataSet",
    informationKey: "processInformation",
  },
  lifecyclemodel: {
    plural: "lifecyclemodels",
    rootKey: "lifeCycleModelDataSet",
    informationKey: "lifeCycleModelInformation",
  },
};

test("bundle row types preserve exact root, information, table, and dependency order mappings", () => {
  assert.deepEqual(bundleRowTypes, expectedBundleRowTypes);
  assert.deepEqual(bundleRowTypeOrder, [
    "contact",
    "source",
    "unitgroup",
    "flowproperty",
    "flow",
    "process",
    "lifecyclemodel",
  ]);
  assert.deepEqual(
    Object.fromEntries(
      Object.values(bundleRowTypes).map((config) => [config.rootKey, config.plural]),
    ),
    {
      contactDataSet: "contacts",
      sourceDataSet: "sources",
      unitGroupDataSet: "unitgroups",
      flowPropertyDataSet: "flowproperties",
      flowDataSet: "flows",
      processDataSet: "processes",
      lifeCycleModelDataSet: "lifecyclemodels",
    },
  );
  assert.equal(new Set(bundleRowTypeOrder).size, bundleRowTypeOrder.length);
  assert.equal(new Set(Object.values(bundleRowTypes).map((config) => config.rootKey)).size, 7);
  assert.equal((bundleRowTypes as Record<string, unknown>).unknown, undefined);
});

test("dataset type aliases preserve precedence, normalization, tables, and support sets", () => {
  assert.equal(datasetTypeFromAliases({}), "process");
  assert.equal(datasetTypeFromAliases({ type: " FLOW " }), "flow");
  assert.equal(datasetTypeFromAliases({ datasetType: "SOURCE" }), "source");
  assert.equal(datasetTypeFromAliases({ kind: "unitgroup" }), "unitgroup");
  assert.equal(
    datasetTypeFromAliases({ type: "flow", datasetType: "source", kind: "contact" }),
    "flow",
  );
  assert.equal(datasetTypeFromAliases({ type: "flow" }, " lifecyclemodel "), "lifecyclemodel");
  assert.deepEqual([...supportedDatasetTypes].sort(), [
    "contact",
    "flow",
    "flowproperty",
    "lifecyclemodel",
    "process",
    "source",
    "support",
    "unitgroup",
  ]);
  assert.deepEqual([...supportDatasetTypes], ["contact", "source"]);
  assert.deepEqual([...referenceOnlySupportDatasetTypes], ["unitgroup", "flowproperty"]);
  assert.deepEqual(datasetTypePlural, {
    contact: "contacts",
    process: "processes",
    flow: "flows",
    flowproperty: "flowproperties",
    lifecyclemodel: "lifecyclemodels",
    source: "sources",
    support: "support",
    unitgroup: "unitgroups",
  });
  assert.equal(defaultProfilesFile, "specs/import-profiles.json");
});

test("dataset type aliases reject empty and unsupported inputs with the stable message", () => {
  for (const options of [{ type: "" }, { type: "lciamethod" }, { datasetType: "unknown" }]) {
    assert.throws(
      () => datasetTypeFromAliases(options),
      /Unsupported dataset type: .*Expected contact, source, unitgroup, flowproperty, support, flow, process, or lifecyclemodel\./u,
    );
  }
});

test("dataset root detection preserves direct roots, lifecycle aliases, support wrappers, and fallbacks", () => {
  for (const [rootKey, datasetType] of [
    ["contactDataSet", "contact"],
    ["sourceDataSet", "source"],
    ["unitGroupDataSet", "unitgroup"],
    ["flowPropertyDataSet", "flowproperty"],
    ["flowDataSet", "flow"],
    ["processDataSet", "process"],
    ["lifeCycleModelDataSet", "lifecyclemodel"],
  ] as const) {
    const root = { marker: rootKey };
    const payload = { [rootKey]: root };
    assert.equal(detectType(payload), datasetType);
    assert.strictEqual(datasetRoot(payload, datasetType), root);
  }
  for (const rootKey of ["lifecycleModelDataSet", "lifecyclemodelDataSet"]) {
    const root = { marker: rootKey };
    const payload = { [rootKey]: root };
    assert.equal(detectType(payload), "lifecyclemodel");
    assert.strictEqual(datasetRoot(payload, "lifecyclemodel"), root);
  }
  assert.equal(detectSupportDatasetType({ contact: { contactDataSet: {} } }), "contact");
  assert.equal(detectSupportDatasetType({ payload: { sourceDataSet: {} } }), "source");
  assert.equal(detectSupportDatasetType({ flowPropertyDataSet: {} }), "flowproperty");
  assert.equal(detectSupportDatasetType({ processDataSet: {} }), null);
  assert.equal(detectType(null, "process"), "process");
  assert.equal(detectType([], "flow"), "flow");
  assert.deepEqual(datasetRoot({}, "unknown"), {});
});

test("four low-level leaves are native TypeScript with representative static consumers", () => {
  const migrations = [
    "scripts/lib/bundle-row-types",
    "scripts/lib/tidas-language-utils",
    "scripts/lib/import-curation/internal/hash-utils",
    "scripts/lib/import-curation/internal/dataset-types",
  ];
  for (const stem of migrations) {
    assert.equal(fs.existsSync(path.join(repoRoot, `${stem}.ts`)), true, `${stem}.ts must exist`);
    assert.equal(
      fs.existsSync(path.join(repoRoot, `${stem}.mjs`)),
      false,
      `${stem}.mjs must be removed`,
    );
  }
  const expectedConsumers = [
    ["scripts/foundry.mjs", "./lib/bundle-row-types.ts"],
    ["scripts/lib/tidas-row-utils.ts", "./tidas-language-utils.ts"],
    ["scripts/lib/import-curation/internal/full-context-proof.mjs", "./hash-utils.ts"],
    ["scripts/lib/import-curation/internal/profiles-config.mjs", "./dataset-types.ts"],
    ["test/unit/tidas-language-utils.test.mjs", "../../scripts/lib/tidas-language-utils.ts"],
    [
      "test/scenarios/mutation-lineage-helpers.test.mjs",
      "../../scripts/lib/import-curation/internal/hash-utils.ts",
    ],
  ] as const;
  for (const [consumer, specifier] of expectedConsumers) {
    const source = fs.readFileSync(path.join(repoRoot, consumer), "utf8");
    assert.match(
      source,
      new RegExp(`from ["']${specifier.replaceAll(".", "\\.")}["']`, "u"),
      `${consumer} must import ${specifier}`,
    );
  }
});

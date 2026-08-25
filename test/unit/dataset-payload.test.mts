import assert from "node:assert/strict";
import test from "node:test";

import {
  curationEntityId,
  dataSetInformation,
  datasetIdentity,
  datasetRoot,
  detectDatasetType,
  detectSupportDatasetType,
  identityFreshnessIdentityKey,
  identityKey,
  mapRowsByIdentity,
  unwrapDatasetPayload,
} from "../../scripts/lib/import-curation/internal/dataset-payload.ts";

const detectType = detectDatasetType;

test("dataset payload unwrapping preserves typed and generic precedence", () => {
  const typed = { flowDataSet: { marker: "typed" } };
  const ordered = { flowDataSet: { marker: "ordered" } };
  const row = {
    flow: typed,
    json_ordered: ordered,
    jsonOrdered: { marker: "camel" },
    json: { marker: "json" },
    payload: { marker: "payload" },
  };
  assert.strictEqual(unwrapDatasetPayload(row, "flow"), typed);
  assert.strictEqual(unwrapDatasetPayload({ json_ordered: ordered }, "flow"), ordered);
  assert.deepEqual(
    unwrapDatasetPayload({ lifecyclemodel: { lifeCycleModelDataSet: {} } }, "lifecyclemodel"),
    { lifeCycleModelDataSet: {} },
  );
  assert.equal(unwrapDatasetPayload(null, "flow"), null);
  assert.equal(unwrapDatasetPayload("scalar", "flow"), "scalar");
  assert.deepEqual(unwrapDatasetPayload({ payload: [] }, "flow"), { payload: [] });
});

test("dataset roots and type detection preserve aliases, support types, and fallbacks", () => {
  for (const [rootKey, type] of [
    ["contactDataSet", "contact"],
    ["processDataSet", "process"],
    ["flowDataSet", "flow"],
    ["flowPropertyDataSet", "flowproperty"],
    ["sourceDataSet", "source"],
    ["unitGroupDataSet", "unitgroup"],
    ["lifeCycleModelDataSet", "lifecyclemodel"],
  ] as const) {
    const root = { marker: rootKey };
    const payload = { [rootKey]: root };
    assert.equal(detectDatasetType(payload), type);
    assert.strictEqual(datasetRoot(payload, type), root);
  }
  for (const alias of ["lifecycleModelDataSet", "lifecyclemodelDataSet"]) {
    const root = { alias };
    assert.strictEqual(datasetRoot({ [alias]: root }, "lifecyclemodel"), root);
    assert.equal(detectDatasetType({ [alias]: root }), "lifecyclemodel");
  }
  assert.equal(detectSupportDatasetType({ payload: { contactDataSet: {} } }), "contact");
  assert.equal(detectSupportDatasetType({ source: { value: true } }), "source");
  assert.equal(detectSupportDatasetType({ unitgroup: { value: true } }), "unitgroup");
  assert.equal(detectSupportDatasetType({ flowproperty: { value: true } }), "flowproperty");
  assert.equal(detectSupportDatasetType({ processDataSet: {} }), null);
  assert.equal(detectType({}, "process"), "process");
  assert.equal(detectType(null, "flow"), "flow");
  assert.deepEqual(datasetRoot({}, "unknown"), {});
});

test("dataSetInformation preserves canonical key precedence and generic fallback", () => {
  const first = { marker: "contact" };
  assert.strictEqual(
    dataSetInformation(
      {
        contactInformation: { dataSetInformation: first },
        processInformation: { dataSetInformation: { marker: "process" } },
      },
      "process",
    ),
    first,
  );
  const custom = { marker: "custom" };
  assert.strictEqual(
    dataSetInformation({ customInformation: { dataSetInformation: custom } }, "custom"),
    custom,
  );
  const direct = { marker: "direct" };
  assert.strictEqual(dataSetInformation({ dataSetInformation: direct }, "flow"), direct);
  assert.deepEqual(dataSetInformation({}, "flow"), {});
});

test("dataset identity preserves id/version precedence, wrappers, support detection, and fallback", () => {
  const payload = {
    processDataSet: {
      processInformation: {
        dataSetInformation: { "common:UUID": "payload-id" },
      },
      administrativeInformation: {
        publicationAndOwnership: { "common:dataSetVersion": "01.02.003" },
      },
    },
  };
  assert.deepEqual(datasetIdentity({ payload }, 0, "process"), {
    id: "payload-id",
    version: "01.02.003",
    payload,
    dataset_type: "process",
  });
  assert.deepEqual(
    datasetIdentity(
      {
        id: "direct-id",
        process_id: "typed-id",
        dataset_id: "dataset-id",
        version: "09.09.009",
        payload,
      },
      2,
      "process",
    ),
    {
      id: "direct-id",
      version: "09.09.009",
      payload,
      dataset_type: "process",
    },
  );
  const supportPayload = {
    sourceDataSet: {
      sourceInformation: { dataSetInformation: { "common:UUID": "source-id" } },
      administrativeInformation: {
        publicationAndOwnership: { "common:dataSetVersion": "02.00.000" },
      },
    },
  };
  assert.deepEqual(datasetIdentity({ json: supportPayload }, 0, "support"), {
    id: "source-id",
    version: "02.00.000",
    payload: supportPayload,
    dataset_type: "source",
  });
  assert.deepEqual(datasetIdentity({}, 4, "flow"), {
    id: "row-5",
    version: "00.00.001",
    payload: {},
    dataset_type: "flow",
  });
});

test("identity helpers preserve aliases, defaults, map keys, order, and duplicate replacement", () => {
  assert.equal(curationEntityId({ entity_id: " entity ", process_id: "process" }), "entity");
  assert.equal(curationEntityId({ process_id: "process", id: "id" }), "process");
  assert.equal(curationEntityId({ id: 42 }), "42");
  assert.equal(curationEntityId(null), "");
  assert.equal(identityKey({ id: "id", version: "01.00.000" }), "id@@01.00.000");
  assert.equal(
    identityFreshnessIdentityKey({ datasetType: "flow", identity: { id: " id ", version: "" } }),
    "flow:id@@00.00.001",
  );
  assert.equal(identityFreshnessIdentityKey({ datasetType: "flow", identity: {} }), null);

  const rows = [
    { id: "same", version: "01.00.000", value: "first" },
    { id: "other", version: "01.00.000" },
    { id: "same", version: "01.00.000", value: "last" },
  ];
  const mapped = mapRowsByIdentity(rows, "flow");
  assert.deepEqual([...mapped.keys()], ["same@@01.00.000", "other@@01.00.000"]);
  assert.deepEqual(mapped.get("same@@01.00.000"), {
    row: rows[2],
    identity: {
      id: "same",
      version: "01.00.000",
      payload: rows[2],
      dataset_type: "flow",
    },
    index: 2,
  });
});

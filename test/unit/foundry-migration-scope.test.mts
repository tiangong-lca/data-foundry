import assert from "node:assert/strict";
import test from "node:test";
import { migrationDatasetScope } from "../../scripts/lib/foundry-migration-authority.ts";

test("migration scope recognizes the official CLI typed-row envelope without losing dataset identity", () => {
  const id = "11111111-1111-4111-8111-111111111111";
  const payload = {
    flowDataSet: {
      flowInformation: { dataSetInformation: { "common:UUID": id } },
      administrativeInformation: {
        publicationAndOwnership: { "common:dataSetVersion": "00.00.001" },
      },
    },
  };
  const expected = { keys: [`flow:${id}@00.00.001`], complete: true };
  assert.deepEqual(
    migrationDatasetScope("native.json", Buffer.from(JSON.stringify(payload))),
    expected,
  );
  assert.deepEqual(
    migrationDatasetScope(
      "cli-response.json",
      Buffer.from(
        JSON.stringify({ status: "passed", rows: [{ id, version: "00.00.001", flow: payload }] }),
      ),
    ),
    expected,
  );
  assert.deepEqual(
    migrationDatasetScope("opaque.json", Buffer.from('{"flow":{"metadata":"not a dataset"}}')),
    { keys: [], complete: false },
  );
});

import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { normalizeProfile } from "../../scripts/lib/import-curation/internal/profiles-config.ts";
import {
  flowPrewriteIdentityBlockers,
  prewriteIdentityBlockers,
} from "../../scripts/lib/import-curation/internal/workflow-identity-preflight.ts";
import { assert } from "../fixtures/foundry-core.ts";

test("legacy profile override evidence is not fresh task authorization", () => {
  const bafu = normalizeProfile(
    {
      id: "bafu",
      allow_account_local_support_and_elementary: { enabled: true, authorized_by: "legacy task" },
    },
    "bafu",
  );
  assert.equal(Object.hasOwn(bafu, "allowAccountLocalSupportAndElementary"), false);
  assert.equal(Object.hasOwn(bafu, "accountLocalSupportOverride"), false);
  const legacyWorldsteel = normalizeProfile(
    {
      id: "worldsteel",
      full_context_ai_completion: {
        required: false,
        scoped_relaxation: "historical decision",
        dataset_types: ["flow", "process"],
      },
    },
    "worldsteel",
  );
  assert.equal(legacyWorldsteel.fullContextAiCompletion.required, true);
});

test("Worldsteel rules require full-context proof and carry no historical approval", () => {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  const { profiles } = JSON.parse(
    readFileSync(path.join(repoRoot, "specs/import-profiles.json"), "utf8"),
  );
  for (const id of ["generic", "bafu", "uslci", "worldsteel"]) {
    assert.equal(profiles[id].allow_account_local_support_and_elementary, undefined);
    assert.equal(profiles[id].waived_qa_codes_by_type, undefined);
  }
  const ws = normalizeProfile(profiles.worldsteel, "worldsteel");
  assert.equal(Object.hasOwn(ws, "allowAccountLocalSupportAndElementary"), false);
  assert.equal(ws.fullContextAiCompletion.required, true);
  assert.equal(profiles.worldsteel.full_context_ai_completion.scoped_relaxation, undefined);
  assert.deepEqual(ws.fullContextAiCompletion.datasetTypes, ["flow", "process", "lifecyclemodel"]);
});

function elementaryFlowPayload() {
  return {
    flowDataSet: {
      flowInformation: {
        dataSetInformation: {
          "common:UUID": "11111111-1111-4111-8111-111111111111",
          name: { baseName: { "@xml:lang": "en", "#text": "Some substance" } },
          classificationInformation: {
            "common:elementaryFlowCategorization": {
              "common:category": [
                { "@level": "0", "@catId": "1", "#text": "Emissions" },
                { "@level": "1", "@catId": "1.3", "#text": "Emissions to air" },
                {
                  "@level": "2",
                  "@catId": "1.3.4",
                  "#text": "Emissions to air, unspecified",
                },
              ],
            },
          },
        },
      },
      modellingAndValidation: { LCIMethod: { typeOfDataSet: "Elementary flow" } },
    },
  };
}

// Default (flag off): elementary flow writes are blocked reference-only.
test("flowPrewriteIdentityBlockers blocks elementary flow writes by default", () => {
  const blockers = flowPrewriteIdentityBlockers(elementaryFlowPayload(), "flow");
  assert.equal(blockers.length, 1);
  assert.equal(blockers[0].code, "elementary_flow_write_blocked");
});

// Override on: elementary flow write is permitted (no prewrite block).
test("flowPrewriteIdentityBlockers permits elementary flow writes under the override", () => {
  const blockers = flowPrewriteIdentityBlockers(elementaryFlowPayload(), "flow", true);
  assert.deepEqual(blockers, []);
});

test("prewriteIdentityBlockers forwards the override flag to the elementary gate", () => {
  const off = prewriteIdentityBlockers(elementaryFlowPayload(), "flow", ".");
  assert.ok(
    off.some((b) => b.code === "elementary_flow_write_blocked"),
    "default keeps the elementary write block",
  );
  const on = prewriteIdentityBlockers(elementaryFlowPayload(), "flow", ".", {
    allowAccountLocalSupportAndElementary: true,
  });
  assert.ok(
    !on.some((b) => b.code === "elementary_flow_write_blocked"),
    "override removes the elementary write block",
  );
});

import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { normalizeProfile } from "../../scripts/lib/import-curation/internal/profiles-config.ts";
import {
  flowPrewriteIdentityBlockers,
  prewriteIdentityBlockers,
} from "../../scripts/lib/import-curation/internal/workflow-identity-preflight.mjs";
import { assert } from "../fixtures/foundry-core.mjs";

// The override authorization flag must surface true ONLY for a profile that declares
// allow_account_local_support_and_elementary.enabled, and false otherwise.
test("normalizeProfile surfaces the account-local override flag per profile", () => {
  const bafu = normalizeProfile(
    {
      id: "bafu",
      allow_account_local_support_and_elementary: {
        enabled: true,
        report_policy:
          "Reports must not emit an unconditional reference-only or no-My-Data policy.",
      },
    },
    "bafu",
  );
  assert.equal(bafu.allowAccountLocalSupportAndElementary, true);
  assert.ok(bafu.accountLocalSupportOverride, "raw override object preserved for audit");
  assert.match(
    bafu.accountLocalSupportOverride.report_policy,
    /must not emit an unconditional reference-only or no-My-Data policy/u,
  );

  const generic = normalizeProfile({ id: "generic" }, "generic");
  assert.equal(generic.allowAccountLocalSupportAndElementary, false);
  assert.equal(generic.accountLocalSupportOverride, null);

  const disabled = normalizeProfile(
    { id: "x", allow_account_local_support_and_elementary: { enabled: false } },
    "x",
  );
  assert.equal(disabled.allowAccountLocalSupportAndElementary, false);
});

// The worldsteel profile must be registered with the capped account-local override
// (for the <=17 GaBi/Sphera pseudo-elementary flows) and full-context AI proof on for
// authored flow/process/lifecyclemodel. The ~1,315 reference flows are reused by UUID.
test("worldsteel profile registers the capped override and full-context proof", () => {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  const { profiles } = JSON.parse(
    readFileSync(path.join(repoRoot, "specs/import-profiles.json"), "utf8"),
  );
  assert.match(
    profiles.bafu.allow_account_local_support_and_elementary.report_policy,
    /must not emit an unconditional reference-only or no-My-Data policy/u,
  );
  assert.ok(profiles.worldsteel, "worldsteel profile is registered");
  const ws = normalizeProfile(profiles.worldsteel, "worldsteel");
  assert.equal(ws.allowAccountLocalSupportAndElementary, true);
  assert.ok(ws.accountLocalSupportOverride, "raw override object preserved for audit");
  // 2026-06-30 user decision: R3's full-context requirement is the reuse-vs-mint IDENTITY
  // decision, satisfied off-line by the adversarially-verified elementary-match + capped-mint
  // workflows plus full-context field authoring. worldsteel new entities are account-local
  // My Data (state_code=0), not published canonical, so the strict per-mint identity
  // authoring-package proof is relaxed (required=false) with a scoped_relaxation rationale.
  assert.equal(profiles.worldsteel.full_context_ai_completion.required, false);
  assert.ok(
    profiles.worldsteel.full_context_ai_completion.scoped_relaxation,
    "scoped_relaxation rationale recorded for the relaxed full-context gate",
  );
  assert.deepEqual(profiles.worldsteel.full_context_ai_completion.dataset_types, [
    "flow",
    "process",
    "lifecyclemodel",
  ]);
  assert.deepEqual(profiles.worldsteel.waived_qa_codes_by_type, {
    process: ["process_material_balance_deviation"],
  });
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

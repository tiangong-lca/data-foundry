import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  normalizeProfile,
  profileFor,
} from "../../scripts/lib/import-curation/internal/profiles-config.ts";
import { prewriteContentQualityBlockers } from "../../scripts/lib/import-curation/internal/workflow-identity-preflight.ts";
import { authorizedProfileOptions } from "../fixtures/task-authorizations.ts";
import { taskAuthorizationAllows } from "../../scripts/lib/task-authorization.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

test("a new task inherits rules but no historical account-local or QA authority", () => {
  for (const id of ["generic", "bafu", "uslci", "worldsteel"]) {
    const profile = profileFor(repoRoot, id);
    assert.equal(Object.hasOwn(profile, "allowAccountLocalSupportAndElementary"), false, id);
    assert.deepEqual(profile.waivedQaCodesByType, {}, id);
    assert.equal(Object.hasOwn(profile, "waivedContentPolicyRulesByType"), false, id);
    assert.equal(Object.hasOwn(profile, "accountLocalSupportOverride"), false, id);
  }
  assert.equal(profileFor(repoRoot, "bafu").fullContextAiCompletion.required, true);
  assert.equal(profileFor(repoRoot, "worldsteel").fullContextAiCompletion.required, true);
});

test("a legacy profile or a waiver flag cannot create task permission", () => {
  const legacy = normalizeProfile(
    {
      allow_account_local_support_and_elementary: { enabled: true, authorized_by: "old task" },
      waived_qa_codes_by_type: { process: ["process_material_balance_deviation"] },
      waived_content_policy_rules_by_type: { process: ["source_locator_in_dataset_name"] },
    },
    "legacy",
  );
  assert.equal(Object.hasOwn(legacy, "allowAccountLocalSupportAndElementary"), false);
  assert.deepEqual(legacy.waivedQaCodesByType, {});
  assert.equal(Object.hasOwn(legacy, "waivedContentPolicyRulesByType"), false);
  const flagged = profileFor(repoRoot, "generic", {
    waiveQa: "process_material_balance_deviation",
    allowAccountLocalSupportAndElementary: true,
  });
  assert.deepEqual(flagged.waivedQaCodesByType, {});
  assert.equal(Object.hasOwn(flagged, "allowAccountLocalSupportAndElementary"), false);
});

test("a profile consumes only in-process validated permission bound to its current rules and task", () => {
  const options = authorizedProfileOptions(repoRoot, "bafu", ["unitgroup_write"]);
  const allowed = profileFor(repoRoot, "bafu", options);
  assert.equal(taskAuthorizationAllows(allowed.authorization, "unitgroup_write"), true);
  assert.equal(taskAuthorizationAllows(allowed.authorization, "flowproperty_write"), false);
  assert.equal(Object.hasOwn(allowed, "allowAccountLocalSupportAndElementary"), false);
  assert.equal(profileFor(repoRoot, "worldsteel", options).authorization, null);
  assert.equal(
    profileFor(repoRoot, "bafu", {
      ...options,
      rowsFile: "missing-task-input-for-authorization.jsonl",
    }).authorization,
    null,
  );
  assert.equal(
    profileFor(repoRoot, "bafu", {
      ...options,
      taskAuthorizationBinding: { ...options.taskAuthorizationBinding, task_id: "different-task" },
    }).authorization,
    null,
  );
  assert.equal(
    profileFor(repoRoot, "bafu", {
      ...options,
      taskAuthorization: JSON.parse(JSON.stringify(options.taskAuthorization)),
    }).authorization,
    null,
  );
});

test("Worldsteel geography/year naming does not exempt citations or other name fields", () => {
  const profile = profileFor(repoRoot, "worldsteel");
  function blockers(baseName: string, route?: string) {
    return prewriteContentQualityBlockers({
      repoRoot,
      datasetType: "process",
      profile: profile as unknown as Record<string, unknown>,
      payload: {
        processDataSet: {
          processInformation: {
            dataSetInformation: {
              name: {
                baseName: { "@xml:lang": "en", "#text": baseName },
                ...(route
                  ? { treatmentStandardsRoutes: { "@xml:lang": "en", "#text": route } }
                  : {}),
              },
            },
          },
        },
      },
    }).filter((row) => row.code === "source_locator_in_dataset_name");
  }
  assert.equal(blockers("Steel rebar Global 2022").length, 0);
  assert.equal(blockers("Steel sections EU 2019").length, 0);
  assert.equal(blockers("Steel ECCS Global 2021 v2").length, 0);
  assert.ok(blockers("Steel rebar Table 2 Global 2022").length > 0);
  assert.ok(blockers("Steel rebar Smith et al. 2022").length > 0);
  assert.ok(blockers("Steel rebar Smith 2022 Global 2022").length > 0);
  assert.ok(blockers("Steel rebar Global 2022", "Smith 2022").length > 0);
});

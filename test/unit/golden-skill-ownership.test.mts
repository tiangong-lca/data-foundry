import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { normalizeGoldenSkillOwnership } from "../../scripts/lib/golden-skill-ownership.ts";

const registry = JSON.parse(
  fs.readFileSync(
    new URL("../../specs/automated-lca-capability-registry.json", import.meta.url),
    "utf8",
  ),
) as {
  capabilities: Array<Record<string, unknown>>;
};
const capability = registry.capabilities.find(
  (value) => value.id === "foundry.skill.tidas-import",
)!;
const route = {
  class: "import-orchestration",
  status: "routed",
  capability_ids: [
    "foundry.skill.tidas-import",
    "foundry.dataset.import-completion-report",
    "foundry.task.complete",
  ],
  owner_projects: ["tiangong-lca-skills", "tiangong-lca-data-foundry"],
};

test("Golden recognizes only the complete reviewed skill owner and derived route transition", () => {
  const before = { ...capability, owner_project: "tiangong-lca-data-foundry" };
  const after = { ...capability, owner_project: "tiangong-lca-skills" };
  assert.deepEqual(normalizeGoldenSkillOwnership(before), normalizeGoldenSkillOwnership(after));
  assert.notDeepEqual(normalizeGoldenSkillOwnership(before), before);
  assert.deepEqual(
    normalizeGoldenSkillOwnership({ ...route, owner_projects: ["tiangong-lca-data-foundry"] }),
    normalizeGoldenSkillOwnership(route),
  );
  assert.deepEqual(
    normalizeGoldenSkillOwnership(Object.fromEntries(Object.entries(after).reverse())),
    normalizeGoldenSkillOwnership(after),
  );
});

test("Golden retains changed gates, unrelated ownership and missing or extra route capabilities as differences", () => {
  for (const changed of [
    { ...capability, verification_gate: "skip verification" },
    { ...capability, owner_project: "unrelated-owner" },
    { ...capability, input_contract: "changed input" },
    { ...capability, unexpected: true },
    { ...route, owner_projects: ["tiangong-lca-skills"] },
    { ...route, capability_ids: route.capability_ids.slice(0, 1) },
    { ...route, capability_ids: [...route.capability_ids, "unreviewed-capability"] },
    { ...route, status: "blocked" },
  ])
    assert.equal(normalizeGoldenSkillOwnership(changed), changed);
});

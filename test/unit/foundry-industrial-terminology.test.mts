import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { bundleRowTypes } from "../../scripts/lib/bundle-row-types.ts";
import { prewriteContentQualityBlockers } from "../../scripts/lib/import-curation/internal/workflow-identity-preflight.ts";

const repoRoot = path.resolve(import.meta.dirname, "../..");
const scientific = [
  "Al-Si-Mg foundry-alloy proxy",
  "foundry alloy",
  "FOUNDRY ALLOYS",
  "steel foundry",
  "steel-foundry",
  "cast iron foundry",
  "alloy foundry",
  "die-casting foundry",
  "aluminium foundry",
  "foundry sand",
  "foundry-sand",
  "foundry castings",
  "(foundry alloy), measured at 3.2 kg",
  "Al–Si–Mg foundry‑alloy（铸造合金）",
  "铸造：Foundry–alloy，实测 3.2 kg",
  "foundry  alloy",
];
const workflow = [
  ["Foundry runtime", "foundry-runtime"],
  ["steel Foundry workspace", "foundry-runtime"],
  ["brass foundry-runtime", "foundry-runtime"],
  ["steel Foundry: workspace", "foundry-runtime"],
  ["alloy Foundry workspace", "foundry-runtime"],
  ["casting Foundry-runtime", "foundry-runtime"],
  ["Foundry_workspace", "foundry-runtime"],
  ["Foundry", "foundry-runtime"],
  ["foundry alloy; Foundry runtime", "foundry-runtime"],
  ["steel foundry；任务 Foundry workspace", "foundry-runtime"],
  ["foundry alloy candidate", "candidate-state"],
  ["foundry alloy / curation gate", "curation-state"],
  ["foundry sand; remote write approved", "remote-write-state"],
  ["foundry alloy — handoff", "handoff-state"],
  ["foundry alloy 候选", "candidate-state-cjk"],
  ["foundry casting：远端写入已批准", "remote-write-state-cjk"],
] as const;

for (const datasetType of ["flow", "process", "lifecyclemodel"] as const) {
  const { rootKey, informationKey } = bundleRowTypes[datasetType];
  const payload = (text: string) => ({
    [rootKey]: {
      [informationKey]: {
        dataSetInformation: {
          generalComment: [
            { "@xml:lang": "en", "#text": "Measured metal input: 3.2 kg." },
            { "@xml:lang": "zh", "#text": text },
          ],
        },
      },
    },
  });
  test(`${datasetType} content policy accepts industrial foundry terms without changing evidence`, () => {
    for (const text of scientific) {
      const value = payload(text),
        before = structuredClone(value);
      assert.deepEqual(
        prewriteContentQualityBlockers({ repoRoot, datasetType, payload: value }),
        [],
        text,
      );
      assert.deepEqual(value, before, "scientific wording and numerical provenance remain intact");
    }
  });
  test(`${datasetType} industrial context cannot hide workflow markers or their exact field path`, () => {
    for (const [text, marker] of workflow) {
      const value = payload(text),
        before = structuredClone(value);
      const blockers = prewriteContentQualityBlockers({ repoRoot, datasetType, payload: value });
      const matched = blockers.filter((item) => item.marker_id === marker);
      assert.equal(matched.length, 1, text);
      assert.equal(matched[0].code, "workflow_state_text_in_write_payload");
      assert.equal(
        matched[0].path,
        `/${rootKey}/${informationKey}/dataSetInformation/generalComment/1/#text`,
      );
      assert.equal(matched[0].text, text);
      assert.deepEqual(value, before);
    }
  });
}

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { bafuAutoAuthoringTestHooks } from "../../scripts/commands/bafu-auto-authoring.ts";
import {
  canCreateBafuProcess,
  canCreateBafuProductFlow,
  flowReferencePropertyActionValue,
  nonEquivalentFlowCandidateReasons,
  nonEquivalentProcessCandidateReasons,
  routeOrTechnologyDiffers,
  strongNameMeaningDiffers,
  type JsonRecord,
} from "../../scripts/lib/bafu-authoring/identity-equivalence.ts";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, "..", "..");
const modulePath = path.join(
  repoRoot,
  "scripts",
  "lib",
  "bafu-authoring",
  "identity-equivalence.ts",
);
const ownerPath = path.join(repoRoot, "scripts", "commands", "bafu-auto-authoring.ts");

interface FrozenCase {
  name: string;
  actual: unknown;
  bytes: number;
  sha256: string;
}

function sha256Text(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function assertFrozen(item: FrozenCase): void {
  const serialized = JSON.stringify(item.actual);
  assert.equal(Buffer.byteLength(serialized), item.bytes, `${item.name}: byte count`);
  assert.equal(sha256Text(serialized), item.sha256, `${item.name}: sha256`);
}

test("BAFU identity equivalence is a pure typed leaf reused by owner and test hooks", () => {
  const moduleSource = fs.readFileSync(modulePath, "utf8");
  const ownerSource = fs.readFileSync(ownerPath, "utf8");

  assert.doesNotMatch(
    moduleSource,
    /node:(?:fs|path|process|child_process)|\bprocess\.env\b|\bfetch\s*\(|\bXMLHttpRequest\b/u,
  );
  assert.match(
    moduleSource,
    /from "\.\/name-plan\.ts"/u,
    "identity text normalization must stay owned by name-plan",
  );
  assert.match(moduleSource, /\bnormalizeIdentityText\b/u);
  assert.match(moduleSource, /export type JsonRecord = Record<string, unknown>/u);
  assert.match(moduleSource, /export interface ReuseCandidateResult\s*\{/u);
  assert.match(ownerSource, /from "\.\.\/lib\/bafu-authoring\/identity-equivalence\.ts"/u);
  for (const functionName of [
    "flowReferencePropertyActionValue",
    "identityTextFromParts",
    "nonEquivalentFlowCandidateReasons",
    "nonEquivalentProcessCandidateReasons",
    "canCreateBafuProductFlow",
    "canCreateBafuProcess",
    "strongNameMeaningDiffers",
    "routeOrTechnologyDiffers",
  ]) {
    assert.doesNotMatch(
      ownerSource,
      new RegExp(`function ${functionName}\\s*\\(`, "u"),
      `${functionName} must not remain implemented in the owner`,
    );
  }

  assert.equal(
    bafuAutoAuthoringTestHooks.nonEquivalentFlowCandidateReasons,
    nonEquivalentFlowCandidateReasons,
  );
  assert.equal(bafuAutoAuthoringTestHooks.strongNameMeaningDiffers, strongNameMeaningDiffers);
  assert.equal(bafuAutoAuthoringTestHooks.routeOrTechnologyDiffers, routeOrTechnologyDiffers);
});

test("flow-property evidence keeps suggested-value then first-reference precedence", () => {
  const suggested = flowReferencePropertyActionValue({
    evidence: {
      suggested_value: { "@xml:lang": "en", "#text": "Mass" },
      reference_flow_properties: ["Area"],
    },
  });
  const fallback = flowReferencePropertyActionValue({
    evidence: {
      suggested_value: { "#text": "  " },
      reference_flow_properties: ["", "Area*time"],
    },
  });

  assert.deepEqual(suggested, { "@xml:lang": "en", "#text": "Mass" });
  assert.deepEqual(fallback, { "@xml:lang": "en", "#text": "Area*time" });
  assertFrozen({
    name: "suggested value wins",
    actual: suggested,
    bytes: 33,
    sha256: "29e5b27c1ab91e47c450d1bd4c6f51654e62829b75100a9145d4e5b01320ab2c",
  });
  assertFrozen({
    name: "empty suggestion falls back",
    actual: fallback,
    bytes: 38,
    sha256: "8ff17b3f0d99ca4c8f9ae756869caaabfaaf64f4f7954905b2b2cab51ac1441b",
  });
});

test("flow and process review reasons preserve exact physical-evidence precedence", () => {
  const flowTarget: JsonRecord = {
    names: ["Electricity, low voltage, production mix", "at plant", "CH"],
    fields: {
      flow_property: "Energy",
      reference_unit: "kWh",
      geography: "CH",
      categories: ["energy", "electricity"],
    },
  };
  const flowReview = nonEquivalentFlowCandidateReasons(flowTarget, [
    {
      id: "flow-candidate",
      version: "01.00.000",
      names: ["Waste plastic, disposal route", "market", "RER"],
      fields: {
        flow_property: "Mass",
        reference_unit: "kg",
        geography: "RER",
        categories: ["waste", "plastics"],
      },
    },
  ]);
  assert.deepEqual(flowReview.reviewed[0]?.non_equivalence_reasons, [
    "flow property differs",
    "reference unit differs",
    "geography/market context differs",
    "source category/route differs",
    "flow name/physical service meaning differs",
    "technology/route qualifier differs",
  ]);
  assertFrozen({
    name: "flow reason order",
    actual: flowReview,
    bytes: 483,
    sha256: "76bb592437d7d21ec84cae5049f5a3329a00acb651e53eefeba4d7849483b21e",
  });

  const processTarget: JsonRecord = {
    names: ["Electricity, low voltage, production mix"],
    fields: {
      geography: "CH",
      reference_flow_ids: ["flow-a"],
      reference_flow_names: ["Electricity"],
      categories: ["energy"],
    },
    exchange_signature: ["flow-a:output:1"],
  };
  const processReview = nonEquivalentProcessCandidateReasons(processTarget, [
    {
      id: "process-candidate",
      version: "01.00.000",
      names: ["Waste plastic, disposal route"],
      fields: {
        geography: "RER",
        reference_flow_ids: ["flow-b"],
        reference_flow_names: ["Waste plastic"],
        categories: ["waste"],
      },
      exchange_signature: ["flow-b:output:2"],
    },
  ]);
  assert.deepEqual(processReview.reviewed[0]?.non_equivalence_reasons, [
    "geography differs",
    "reference flow differs",
    "reference flow meaning differs",
    "exchange signature differs",
    "process classification/route differs",
    "process name/technology meaning differs",
    "process technology/route qualifier differs",
  ]);
  assertFrozen({
    name: "process reason order",
    actual: processReview,
    bytes: 564,
    sha256: "eefbde75ad2ef53088b09c15c642e1354d3ec10415d24f4918206435d415f028",
  });
});

test("elementary, exact-flow, and exact-process decisions keep existing branch precedence", () => {
  const elementary = canCreateBafuProductFlow({
    dataset_type: "flow",
    evidence: {
      target: {
        names: ["Occupation, industrial area, vegetation"],
        fields: {
          type_of_dataset: "Elementary flow",
          flow_property: "Area*time",
          categories: ["resources", "land"],
        },
      },
      top_candidates: [
        {
          id: "canonical-land",
          version: "03.00.004",
          names: ["industrial area"],
          fields: {
            type_of_dataset: "Elementary flow",
            flow_property: "Area*time",
            categories: ["Land use", "Land occupation"],
          },
        },
      ],
    },
  });
  assert.equal(elementary.ok, false);
  assert.equal(elementary.reuse?.id, "canonical-land");
  assertFrozen({
    name: "elementary reuse before product/waste gate",
    actual: elementary,
    bytes: 958,
    sha256: "b87da7059800be37e5c7538175e9bf30df28e30f271c8700c0691d1e8e41b700",
  });

  const exactFlow = canCreateBafuProductFlow({
    dataset_type: "flow",
    evidence: {
      target: {
        names: ["Nylon 6", "at plant"],
        fields: {
          type_of_dataset: "Product flow",
          flow_property: "Mass",
          reference_unit: "kg",
          geography: "RER",
          categories: ["plastics"],
        },
      },
      top_candidates: [
        {
          id: "canonical-nylon",
          version: "01.00.000",
          names: ["Nylon 6", "at plant"],
          fields: {
            type_of_dataset: "Product flow",
            flow_property: "Volume",
            reference_unit: "m3",
            geography: "GLO",
            categories: ["chemicals"],
          },
        },
      ],
    },
  });
  assert.equal(exactFlow.ok, false);
  assert.equal(exactFlow.reuse?.id, "canonical-nylon");
  assertFrozen({
    name: "exact flow name wins before reviewed differences",
    actual: exactFlow,
    bytes: 691,
    sha256: "fffab50fa4a49932953fdc2de583300b3595b13826d4fd37ac1b6e6f43c188c5",
  });

  const exactProcess = canCreateBafuProcess({
    dataset_type: "process",
    evidence: {
      target: {
        names: ["Nylon production", "at plant"],
        fields: {
          geography: "RER",
          reference_flow_ids: ["flow-a"],
          reference_flow_names: ["Nylon 6"],
          categories: ["plastics"],
        },
        exchange_signature: ["flow-a:output:1"],
      },
      top_candidates: [
        {
          id: "canonical-process",
          version: "01.00.000",
          names: ["Nylon production", "at plant"],
          fields: {
            geography: "GLO",
            reference_flow_ids: ["flow-b"],
            reference_flow_names: ["Nylon 66"],
            categories: ["chemicals"],
          },
          exchange_signature: ["flow-b:output:2"],
        },
      ],
    },
  });
  assert.equal(exactProcess.ok, false);
  assert.equal(exactProcess.reuse, undefined);
  assertFrozen({
    name: "exact process name blocks before reviewed differences permit create",
    actual: exactProcess,
    bytes: 548,
    sha256: "440d5f82d0c29097b8361c968967d2081688a46feed7f9842662e9fc94cb5a5b",
  });
});

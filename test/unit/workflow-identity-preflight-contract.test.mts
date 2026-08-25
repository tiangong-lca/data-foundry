import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import * as identity from "../../scripts/lib/import-curation/internal/workflow-identity-preflight.ts";

function writeJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

test("identity preflight path aliases and execution receipts remain fail-closed", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "foundry-w22-identity-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const indexPath = path.join(root, "requests", "index.jsonl");
  const requestPath = path.join(root, "requests", "request.json");
  const reportPath = path.join(root, "requests", "decision.json");
  writeJson(requestPath, { schema_version: 1, target: { id: "flow-1", name: "Flow one" } });
  writeJson(reportPath, {
    status: "completed",
    decision: "manual_review",
    candidates: [{ id: "candidate-1" }],
  });

  assert.equal(
    identity.identityPreflightResultFile(root, indexPath, {
      identityDecisionFile: "decision.json",
    }),
    reportPath,
  );
  assert.equal(
    identity.identityPreflightResultFile(root, indexPath, {
      outputDir: "run-one",
    }),
    path.join(root, "run-one", "outputs", "identity-decision.json"),
  );

  const pending = identity.readIdentityPreflightIndexRow(root, indexPath, {
    type: "flow",
    entity_id: "flow-1",
    request_file: "request.json",
    reportFile: "decision.json",
  });
  assert.equal(pending?.dataset_version, "00.00.001");
  assert.equal(pending?.status, "pending_execution");
  assert.equal(pending?.result, null);
  assert.deepEqual(pending?.execution_evidence, {
    status: "invalid_or_missing",
    code: "identity_preflight_manifest_invalid",
    manifest_file: null,
  });
  assert.equal(pending?.request_file, "requests/request.json");

  fs.writeFileSync(requestPath, "{ malformed\n");
  assert.throws(
    () =>
      identity.readIdentityPreflightIndexRow(root, indexPath, {
        dataset_type: "flow",
        dataset_id: "flow-1",
        request_file: "request.json",
      }),
    SyntaxError,
  );
});

test("identity lookup and freshness preserve exact-version priority and hash scope", () => {
  const exact = { dataset_type: "flow", dataset_id: "f", dataset_version: "01.00.000" };
  const fallback = { dataset_type: "flow", dataset_id: "f", dataset_version: "00.00.001" };
  const context = {
    rowsByIdentity: new Map([
      ["flow:f@@01.00.000", exact],
      ["flow:f", fallback],
    ]),
  };
  assert.equal(
    identity.identityPreflightRowForIdentity(context, "flow", {
      id: "f",
      version: "01.00.000",
    }),
    exact,
  );
  assert.equal(
    identity.identityPreflightRowForIdentity(context, "flow", {
      id: "f",
      version: "02.00.000",
    }),
    fallback,
  );
  assert.equal(identity.identityPreflightRowForIdentity(context, "flow", { version: "x" }), null);

  const payload = { flowDataSet: { id: "f", ordered: [2, 1] } };
  const first = identity.identityPreflightFreshness({}, payload);
  const matching = identity.identityPreflightFreshness(
    { request: { target_sha256: first.current_payload_sha256 } },
    payload,
  );
  assert.equal(matching.current_payload_matches_request, true);
  assert.equal(identity.identityPreflightFreshnessAccepted(matching), true);
  assert.equal(
    identity.identityPreflightFreshnessAccepted({ current_payload_scope_accepted: true }),
    true,
  );
  assert.equal(identity.identityPreflightFreshnessAccepted({}), false);
});

test("source context, dependency aliases, and manual-review actions preserve priority", () => {
  assert.equal(
    identity.identityPreflightSourceContextRequired({
      profile: { id: " BAFU " },
      datasetType: "process",
      curationQueueContext: { status: "attached" },
      context: { rows: [{ source_file: "source.zip" }] },
    }),
    true,
  );
  assert.equal(
    identity.identityPreflightSourceContextRequired({
      profile: { id: "generic" },
      datasetType: "process",
      curationQueueContext: { status: "attached" },
      context: { rows: [{ source_file: "source.zip" }] },
    }),
    false,
  );
  assert.deepEqual(
    identity.dependencyPayloadForFreshness({
      input_rows: [{ selected: "input_rows" }],
      rows: [{ selected: "rows" }],
      payload: { selected: "payload" },
    }),
    { selected: "input_rows" },
  );
  assert.deepEqual(
    identity.dependencyPayloadForFreshness({ input_rows: [], payload: { selected: "payload" } }),
    { selected: "payload" },
  );

  const candidates = Array.from({ length: 12 }, (_, index) => ({ rank: index + 1 }));
  const row = {
    remote_search: { endpoint: "flow_hybrid_search" },
    result: {
      status: "needs_review",
      decision: "manual_review",
      candidates,
      target: { fields: { type_of_dataset: "Elementary flow" } },
    },
  };
  assert.equal(identity.identityPreflightNeedsAiDecision(row), true);
  const action = identity.identityPreflightAiDecisionActionItem({
    datasetType: "flow",
    identity: { id: "f", version: "1", payload: {} },
    row,
  });
  assert.equal(action.code, "elementary_flow_identity_manual_review");
  assert.equal(action.evidence.candidate_count, 12);
  assert.deepEqual(action.evidence.top_candidates, candidates.slice(0, 10));
});

test("identity text, queue action aliases, and source blockers preserve encounter order", () => {
  assert.equal(identity.comparableText("  Mixed\n CASE  "), "mixed case");
  assert.equal(identity.textContent([{ "#text": "alpha" }, { text: "beta" }]), "alpha beta");
  assert.equal(
    identity.valueAtDotPath({ rows: [{ value: "selected" }] }, "rows.0.value"),
    "selected",
  );
  assert.equal(identity.valueAtDotPath({ rows: [] }, "rows.not-an-index.value"), undefined);

  const classification = identity.classificationQueueActionItem({
    dataset_type: "flow",
    ruleId: "ignored",
    code: " classify ",
    current_classification: "old",
    required_resolution: " choose canonical ",
  });
  assert.equal(classification.code, "classify");
  assert.match(classification.path!, /^flowDataSet\./u);
  assert.equal(classification.instruction, "choose canonical");
  const location = identity.locationQueueActionItem({
    path: "flowDataSet.location",
    location: "RER",
  });
  assert.equal(location.path, "flowDataSet.location");
  assert.equal(location.evidence.current_location, "RER");

  const sourcePayload = {
    sourceDataSet: {
      sourceInformation: {
        dataSetInformation: {
          "common:shortName": { "#text": "ILCD format" },
          sourceCitation: { "#text": "Not specified" },
          classificationInformation: {
            "common:classification": {
              "common:class": [{ "#text": "Data set formats" }],
            },
          },
        },
      },
    },
  };
  assert.deepEqual(
    identity.sourcePrewriteIdentityBlockers(sourcePayload, "source").map((item) => item.code),
    [
      "source_identity_not_true_source",
      "source_citation_not_true_source",
      "source_classification_not_true_source",
    ],
  );
});

test("identity preflight keeps its exact runtime export surface", () => {
  assert.equal(Object.keys(identity).length, 33);
});

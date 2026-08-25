import test from "node:test";
import { sha256Json } from "../../scripts/lib/import-curation/internal/hash-utils.ts";
import {
  decisionApplyContextCoversExpectedRowsIdentity,
  decisionApplyContextRelevantToRowsFile,
} from "../../scripts/lib/import-curation/internal/workflow-decision-full-context.mjs";
import { attachIdentityPreflightFreshness } from "../../scripts/lib/import-curation/internal/workflow-identity-preflight.mjs";
import {
  decisionApplyOutputRowsReachableThroughDeterministicTransforms,
  readRowsFileTransformContext,
  rowsFileReachableThroughTransformChain,
  sameRowsArtifact,
} from "../../scripts/lib/import-curation/internal/workflow-row-transform-context.mjs";
import { fixtureRoot } from "../fixtures/fixture-roots.ts";
import {
  assert,
  fs,
  path,
  readJson,
  rel,
  repoRoot,
  writeJson,
  writeJsonLines,
  writeText,
} from "../fixtures/foundry-core.mjs";
import {
  flowRowWithClassification,
  processRowWithDefaultClassification,
} from "../fixtures/row-builders.mjs";

test("rows artifact lineage accepts content-equivalent no-op transform files", () => {
  const root = path.join(fixtureRoot, "content-equivalent-row-artifacts");
  fs.rmSync(root, { recursive: true, force: true });
  fs.mkdirSync(root, { recursive: true });
  const startRows = path.join(root, "rows.start.jsonl");
  const copiedRows = path.join(root, "rows.copied.jsonl");
  const finalRows = path.join(root, "rows.final.jsonl");
  writeText(startRows, '{"id":"same","value":1}\n');
  writeText(copiedRows, '{"id":"same","value":1}\n');
  writeText(finalRows, '{"id":"same","value":2}\n');

  assert.equal(sameRowsArtifact(repoRoot, rel(startRows), rel(copiedRows)), true);
  assert.equal(
    rowsFileReachableThroughTransformChain({
      repoRoot,
      startFiles: [rel(startRows)],
      transforms: [
        {
          inputRowsFile: rel(copiedRows),
          outputRowsFile: rel(finalRows),
        },
      ],
      expectedRowsFile: rel(finalRows),
    }),
    true,
  );
});

test("decision apply context relevance ignores unrelated dataset identities", () => {
  const root = path.join(fixtureRoot, "decision-context-identity-overlap");
  fs.rmSync(root, { recursive: true, force: true });
  fs.mkdirSync(root, { recursive: true });
  const flowId = "aaaaaaaa-bbbb-4ccc-8ddd-000000000911";
  const processId = "aaaaaaaa-bbbb-4ccc-8ddd-000000000912";
  const flowRows = path.join(root, "flows.located.jsonl");
  const processRows = path.join(root, "processes.cleaned.jsonl");
  writeJsonLines(flowRows, [
    flowRowWithClassification({
      flowId,
      typeOfDataSet: "Product flow",
      classification: {
        "common:classification": {
          "common:class": [{ "@level": "0", "@classId": "1", "#text": "Products" }],
        },
      },
    }),
  ]);
  writeJsonLines(processRows, [processRowWithDefaultClassification(processId)]);
  const locationDecisionApplyContext = {
    status: "completed",
    inputRows: [rel(flowRows)],
    outputRows: [rel(flowRows)],
    inputPayloadSha256ByIdentity: new Map([[`flow:${flowId}@@00.00.001`, "input"]]),
    outputPayloadSha256ByIdentity: new Map([[`flow:${flowId}@@00.00.001`, "output"]]),
  };

  assert.equal(
    decisionApplyContextRelevantToRowsFile({
      repoRoot,
      rowsFile: rel(processRows),
      context: locationDecisionApplyContext,
    }),
    false,
  );
  assert.equal(
    decisionApplyContextRelevantToRowsFile({
      repoRoot,
      rowsFile: rel(flowRows),
      context: locationDecisionApplyContext,
    }),
    true,
  );
  assert.equal(
    decisionApplyContextCoversExpectedRowsIdentity({
      repoRoot,
      expectedRowsFile: rel(processRows),
      context: locationDecisionApplyContext,
    }),
    false,
  );
  assert.equal(
    decisionApplyContextCoversExpectedRowsIdentity({
      repoRoot,
      expectedRowsFile: rel(flowRows),
      context: locationDecisionApplyContext,
    }),
    true,
  );
});

test("full-context lineage accepts deterministic location patch source contact support and cleanup transforms", () => {
  const root = path.join(fixtureRoot, "source-contact-transform-lineage");
  fs.rmSync(root, { recursive: true, force: true });
  fs.mkdirSync(root, { recursive: true });
  const flowId = "aaaaaaaa-bbbb-4ccc-8ddd-000000000901";
  const key = `flow:${flowId}@@00.00.001`;
  const classification = {
    "common:classification": {
      "common:class": [
        {
          "@level": "0",
          "@classId": "9",
          "#text": "Community, social and personal services",
        },
      ],
    },
  };
  const classified = flowRowWithClassification({
    flowId,
    typeOfDataSet: "Product flow",
    classification,
  });
  const located = JSON.parse(JSON.stringify(classified));
  located.flowDataSet.flowInformation.geography = {
    locationOfSupply: { "@location": "CH" },
  };
  const patched = JSON.parse(JSON.stringify(located));
  patched.flowDataSet.flowInformation.name = {
    baseName: { "#text": "Electricity" },
    mixAndLocationTypes: { "#text": "Swiss production mix" },
    flowProperties: { "#text": "Net calorific value" },
  };
  const identityApplied = JSON.parse(JSON.stringify(patched));
  const sourceContactRewritten = JSON.parse(JSON.stringify(identityApplied));
  sourceContactRewritten.flowDataSet.administrativeInformation.publicationAndOwnership[
    "common:referenceToOwnershipOfDataSet"
  ] = {
    "@type": "contact data set",
    "@refObjectId": "a6db11f5-1cb4-579a-b503-bd17c361b8c2",
    "@version": "00.00.001",
    "common:shortDescription": {
      "@xml:lang": "en",
      "#text": "Federal Office for the Environment FOEN (BAFU)",
    },
  };
  const canonicalSupportRewritten = JSON.parse(JSON.stringify(sourceContactRewritten));
  canonicalSupportRewritten.flowDataSet.flowProperties = {
    flowProperty: {
      referenceToFlowPropertyDataSet: {
        "@type": "flow property data set",
        "@refObjectId": "838aaa23-0117-11db-92e3-0800200c9a66",
        "@version": "03.00.000",
        "common:shortDescription": {
          "@xml:lang": "en",
          "#text": "Length",
        },
      },
    },
  };
  const cleaned = JSON.parse(JSON.stringify(canonicalSupportRewritten));
  cleaned.flowDataSet.administrativeInformation.dataEntryBy = {
    "common:referenceToDataSetFormat": {
      "@type": "source data set",
      "@refObjectId": "a97a0155-0234-4b87-b4ce-a45da52f2a40",
      "@version": "03.00.003",
    },
  };

  const classifiedRows = path.join(root, "flows.classified.jsonl");
  const locatedRows = path.join(root, "flows.located.jsonl");
  const patchedRows = path.join(root, "flows.patched.jsonl");
  const identityRows = path.join(root, "flows.identity-applied.jsonl");
  const sourceContactRows = path.join(root, "flows.source-contact.jsonl");
  const canonicalRows = path.join(root, "flows.canonical-support.jsonl");
  const cleanedRows = path.join(root, "flows.cleaned.jsonl");
  writeJsonLines(classifiedRows, [classified]);
  writeJsonLines(locatedRows, [located]);
  writeJsonLines(patchedRows, [patched]);
  writeJsonLines(identityRows, [identityApplied]);
  writeJsonLines(sourceContactRows, [sourceContactRewritten]);
  writeJsonLines(canonicalRows, [canonicalSupportRewritten]);
  writeJsonLines(cleanedRows, [cleaned]);

  const sourceContactReport = path.join(root, "source-contact-report.json");
  writeJson(sourceContactReport, {
    status: "completed",
    rows_file: rel(identityRows),
    output_rows_file: rel(sourceContactRows),
    files: { output_rows: rel(sourceContactRows) },
  });
  const canonicalReport = path.join(root, "canonical-support-report.json");
  writeJson(canonicalReport, {
    status: "completed",
    rows_file: rel(sourceContactRows),
    output_rows_file: rel(canonicalRows),
    files: { output_rows: rel(canonicalRows) },
  });
  const cleanupReport = path.join(root, "cleanup-report.json");
  writeJson(cleanupReport, {
    status: "completed",
    rows_file: rel(canonicalRows),
    files: { cleaned_rows: rel(cleanedRows) },
  });

  const sourceContactRewriteContext = readRowsFileTransformContext(
    repoRoot,
    { path: sourceContactReport, value: readJson(sourceContactReport) },
    "source_contact_rewrite",
  );
  const canonicalSupportRewriteContext = readRowsFileTransformContext(
    repoRoot,
    { path: canonicalReport, value: readJson(canonicalReport) },
    "canonical_support_rewrite",
  );
  const cleanupContext = readRowsFileTransformContext(
    repoRoot,
    { path: cleanupReport, value: readJson(cleanupReport) },
    "curation_cleanup",
  );
  const classificationDecisionApplyContext = {
    status: "completed",
    inputRows: [rel(classifiedRows)],
    outputRows: [rel(classifiedRows)],
    inputPayloadSha256ByIdentity: new Map([[key, sha256Json(classified)]]),
    outputPayloadSha256ByIdentity: new Map([[key, sha256Json(classified)]]),
  };
  const locationDecisionApplyContext = {
    status: "completed",
    inputRows: [rel(classifiedRows)],
    outputRows: [rel(locatedRows)],
    inputPayloadSha256ByIdentity: new Map([[key, sha256Json(classified)]]),
    outputPayloadSha256ByIdentity: new Map([[key, sha256Json(located)]]),
  };
  const patchApplyContext = {
    status: "completed",
    inputRowsFile: rel(locatedRows),
    outputRows: [rel(patchedRows)],
    inputPayloadSha256ByIdentity: new Map([[key, sha256Json(located)]]),
    outputPayloadSha256ByIdentity: new Map([[key, sha256Json(patched)]]),
  };
  const identityDecisionApplyContext = {
    status: "completed",
    inputRows: [rel(patchedRows)],
    outputRows: [rel(identityRows)],
    inputPayloadSha256ByIdentity: new Map([[key, sha256Json(patched)]]),
    outputPayloadSha256ByIdentity: new Map([[key, sha256Json(identityApplied)]]),
  };

  assert.equal(
    decisionApplyOutputRowsReachableThroughDeterministicTransforms({
      repoRoot,
      context: classificationDecisionApplyContext,
      expectedRowsFile: rel(cleanedRows),
      locationDecisionApplyContext,
      patchApplyContext,
      identityDecisionApplyContext,
      sourceContactRewriteContext,
      canonicalSupportRewriteContext,
      cleanupContext,
    }),
    true,
  );

  const freshness = attachIdentityPreflightFreshness(
    {
      status: "completed",
      request: { target_sha256: sha256Json(classified) },
    },
    cleaned,
    {
      repoRoot,
      datasetType: "flow",
      identity: { id: flowId, version: "00.00.001" },
      locationDecisionApplyContext,
      patchApplyContext,
      identityDecisionApplyContext,
      sourceContactRewriteContext,
      canonicalSupportRewriteContext,
      cleanupContext,
    },
  ).freshness;
  assert.equal(freshness.current_payload_matches_request, false);
  assert.equal(freshness.current_payload_scope_accepted, true);
  assert.equal(
    freshness.deterministic_transform_allowance.reason,
    "deterministic_rows_file_transform_chain",
  );
});

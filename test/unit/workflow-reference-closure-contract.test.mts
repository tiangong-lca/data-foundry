import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import * as closureModule from "../../scripts/lib/import-curation/internal/workflow-reference-closure.ts";
import {
  datasetIdentity,
  identityKey,
} from "../../scripts/lib/import-curation/internal/dataset-payload.ts";

type JsonRecord = Record<string, unknown>;

function processRow(id: string, references: JsonRecord = {}): JsonRecord {
  return {
    id,
    version: "00.00.001",
    process: {
      processDataSet: {
        processInformation: {
          dataSetInformation: {
            "common:UUID": id,
          },
        },
        references,
      },
    },
  };
}

function flowReference(id: string, version = "00.00.001"): JsonRecord {
  return {
    "@type": "flow data set",
    "@refObjectId": id,
    "@version": version,
  };
}

function sourceReference(id: string, version = "00.00.001"): JsonRecord {
  return {
    "@type": "source data set",
    "@refObjectId": id,
    "@version": version,
  };
}

test("reference closure module preserves its complete export surface", () => {
  assert.deepEqual(Object.keys(closureModule), [
    "buildFullContextAiCompletionBlockers",
    "buildReferenceClosureBlockers",
    "buildReferenceReuseItems",
    "buildWriteCandidateItem",
    "collectDatasetReferences",
    "decisionCounts",
    "failureReasons",
    "identityReferenceRewriteProofKeys",
    "isFoundryTracePathSegments",
    "operationCounts",
    "plannedRootReferenceIds",
    "plannedRootReferenceKeys",
    "referenceKey",
    "referenceTableByPathToken",
    "referenceTableByTypeToken",
    "referenceTableFromPath",
    "referenceTableFromType",
    "remoteVerifiedReferenceKeys",
    "remoteVerifyChecks",
    "sourceContactRewriteSemanticEvidenceCount",
  ]);
});

test("reference discovery preserves DFS order and excludes Foundry trace payloads", () => {
  const row = processRow("process-a", {
    referenceToProcessDataSet: {
      "@type": "process data set",
      "@refObjectId": "process-b",
      "@version": "00.00.001",
    },
    referenceToFlowDataSet: flowReference("flow-a"),
    referenceToDataSource: sourceReference("source-a"),
    "common:other": {
      "tiangongfoundry:unresolvedTrace": {
        referenceToFlowDataSet: flowReference("trace-only-flow"),
      },
    },
  });
  const references = closureModule.collectDatasetReferences(row);
  assert.deepEqual(
    references.map((entry) => [entry.table, entry.id, entry.version]),
    [
      ["processes", "process-b", "00.00.001"],
      ["flows", "flow-a", "00.00.001"],
      ["sources", "source-a", "00.00.001"],
    ],
  );
  assert.equal(closureModule.referenceTableFromType("Global contact data set"), "contacts");
  assert.equal(
    closureModule.referenceTableFromPath(["processDataSet", "referenceToFlowDataSet"]),
    "flows",
  );
  assert.equal(
    closureModule.isFoundryTracePathSegments([
      "common:other",
      "tiangongfoundry:unresolvedTrace",
      "0",
    ]),
    true,
  );
});

test("self, remote, proven, unresolved, and foreign reference partitions retain order", () => {
  const processA = "process-a";
  const processB = "process-b";
  const remoteFlow = "remote-flow";
  const provenSource = "proven-source";
  const unresolvedFlow = "unresolved-flow";
  const missingContact = "foreign-contact";
  const missingSource = "foreign-source";
  const rows = [
    {
      ...processRow(processA, {
        referenceToProcessDataSet: {
          "@type": "process data set",
          "@refObjectId": processB,
          "@version": "00.00.001",
        },
        referenceToFlowDataSet: flowReference(remoteFlow),
        referenceToDataSource: sourceReference(provenSource),
        unresolvedReference: flowReference(unresolvedFlow),
        referenceToPersonOrEntityEnteringTheData: {
          "@type": "contact data set",
          "@refObjectId": missingContact,
          "@version": "00.00.001",
        },
      }),
      unknownReference: {
        "@refObjectId": "unknown-reference",
        "@version": "00.00.001",
      },
    },
    processRow(processB, {
      referenceToDataSource: sourceReference(missingSource),
    }),
  ];
  const remoteVerifyArtifact = {
    value: {
      checks: [
        {
          role: "reference",
          status: "ok",
          table: "flows",
          id: remoteFlow,
          version: "00.00.001",
        },
        {
          role: "reference",
          status: "missing_dataset",
          table: "contacts",
          id: missingContact,
          version: "00.00.001",
        },
      ],
    },
  };
  const blockers = closureModule.buildReferenceClosureBlockers({
    repoRoot: "/unused",
    rows,
    datasetType: "process",
    remoteVerifyArtifact,
    provenReferenceKeys: new Set([
      closureModule.referenceKey({
        table: "sources",
        id: provenSource,
        version: "00.00.001",
      }),
    ]),
    unresolvedReferenceKeys: new Set([
      closureModule.referenceKey({
        table: "flows",
        id: unresolvedFlow,
        version: "00.00.001",
      }),
    ]),
  });
  assert.deepEqual(
    blockers.map((blocker) => [blocker.code, blocker.row_index, blocker.reference_id]),
    [
      ["reference_closure_unproven", 0, missingContact],
      ["reference_closure_type_unresolved", 0, "unknown-reference"],
      ["reference_closure_unproven", 1, missingSource],
    ],
  );
  assert.deepEqual(
    [...closureModule.plannedRootReferenceIds(rows, "process")],
    [processA, processB],
  );
  assert.deepEqual(
    [...closureModule.remoteVerifiedReferenceKeys("/unused", remoteVerifyArtifact)],
    [closureModule.referenceKey({ table: "flows", id: remoteFlow, version: "00.00.001" })],
  );

  const outdatedArtifact = {
    value: {
      checks: [
        {
          role: "reference",
          status: "version_outdated",
          table: "flows",
          id: "account-local-flow",
          version: "00.00.001",
        },
      ],
    },
  };
  assert.equal(closureModule.remoteVerifiedReferenceKeys("/unused", outdatedArtifact).size, 0);
  assert.equal(
    closureModule.remoteVerifiedReferenceKeys("/unused", outdatedArtifact, {
      acceptExactExistingOutdated: true,
    }).size,
    1,
  );
});

test("candidate, blocker, reuse, decision, and operation partitions retain encounter order", () => {
  const root = path.join(os.tmpdir(), "foundry-reference-closure-contract");
  const contactRow = {
    id: "contact-write",
    version: "00.00.001",
    contact: {
      contactDataSet: {
        contactInformation: {
          dataSetInformation: { "common:UUID": "contact-write" },
        },
      },
    },
  };
  const identity = {
    ...datasetIdentity(contactRow, 0, "contact"),
    sourceRowsFile: path.join(root, "contacts.jsonl"),
  };
  const key = identityKey(identity);
  const ready = closureModule.buildWriteCandidateItem({
    repoRoot: root,
    datasetType: "contact",
    row: contactRow,
    identity,
    rowIndex: 0,
    schemaRow: { status: "valid", issues: [] },
    curationEntity: null,
    curationGateProvided: false,
    dryRun: {
      datasetSaveDraft: {
        prepared: new Map([[key, { operation: "would_insert" }]]),
        failures: new Map(),
      },
    },
    remoteVerifyBlockers: new Set(),
    targetUserId: "11111111-1111-4111-8111-111111111111",
    cleanupStatus: "completed",
    patchApplyContext: null,
    sourceReferenceRewritesByKey: new Map(),
    identityReferenceRewritesByKey: new Map(),
    identityDecisionApplyContext: null,
    evidenceScopeBlockers: [],
  });
  assert.deepEqual(
    {
      decision: ready.decision,
      operation: ready.operation,
      dry_run_status: ready.dry_run_status,
      blockers: ready.blockers,
    },
    {
      decision: "write_or_update",
      operation: "insert",
      dry_run_status: "success",
      blockers: [],
    },
  );
  const blocked = closureModule.buildWriteCandidateItem({
    repoRoot: root,
    datasetType: "contact",
    row: contactRow,
    identity,
    rowIndex: 0,
    schemaRow: { status: "valid", issues: [] },
    curationEntity: null,
    curationGateProvided: false,
    dryRun: {},
    remoteVerifyBlockers: new Set(),
    targetUserId: "",
    cleanupStatus: "not_provided",
    patchApplyContext: null,
    sourceReferenceRewritesByKey: new Map(),
    identityReferenceRewritesByKey: new Map(),
    identityDecisionApplyContext: null,
    evidenceScopeBlockers: [{ code: "scope-first" }],
  });
  assert.deepEqual(
    (blocked.blockers as JsonRecord[]).map((blocker) => blocker.code),
    [
      "scope-first",
      "target_user_id_required",
      "curation_cleanup_required",
      "dry_run_evidence_missing",
    ],
  );

  const referenceRows = [
    { id: "reference-a", version: "00.00.001", flow: {} },
    { id: "reference-b", version: "00.00.001", flow: {} },
  ];
  const rewriteByIdentity = new Map([
    [
      "reference-a@@00.00.001",
      [{ canonical: { table: "flows", id: "canonical-a", version: "00.00.001" } }],
    ],
    ["reference-b", [{ canonical: { table: "flows", id: "canonical-b" } }]],
  ]);
  const reuse = closureModule.buildReferenceReuseItems({
    repoRoot: root,
    datasetType: "flow",
    rows: referenceRows,
    writeCandidateKeys: new Set(["reference-b@@00.00.001"]),
    identityReferenceRewritesByKey: rewriteByIdentity,
  });
  assert.deepEqual(
    reuse.map((item) => [item.entity_id, item.decision, item.identity_reference_rewrite_count]),
    [
      ["reference-a", "reuse_existing_reference", 1],
      ["reference-b", "covered_by_write_candidate", 1],
    ],
  );

  const partitionItems = [
    { decision: "blocked", operation: null },
    { decision: "write_or_update", operation: "insert" },
    { decision: "reuse_existing_reference", operation: null },
    { decision: "write_or_update", operation: "insert" },
  ];
  assert.deepEqual(closureModule.decisionCounts(partitionItems), {
    blocked: 1,
    write_or_update: 2,
    reuse_existing_reference: 1,
  });
  assert.deepEqual(closureModule.operationCounts(partitionItems), { insert: 2 });
});

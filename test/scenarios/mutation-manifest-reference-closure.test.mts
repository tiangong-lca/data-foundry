import test from "node:test";
import {
  referenceClosureFixtureRoot,
  supportManifestFixtureRoot,
} from "../fixtures/fixture-roots.ts";
import {
  assert,
  fs,
  itemBlockerCodes,
  path,
  readJsonLines,
  rel,
  repoRoot,
  runFoundry,
  scopeBlockerCodes,
  targetUserId,
  writeJson,
  writeJsonLines,
} from "../fixtures/foundry-core.ts";
import { writeCompletedIdentityPreflightIndex } from "../fixtures/identity-fixtures.ts";
import { processRowWithFlowRef } from "../fixtures/row-builders.ts";

test("mutation manifest blocks process writes when referenced datasets are not proven", () => {
  fs.rmSync(referenceClosureFixtureRoot, { recursive: true, force: true });
  const processId = "cccccccc-dddd-4eee-8fff-000000000001";
  const flowId = "dddddddd-eeee-4fff-8000-000000000002";
  const rowsFile = path.join(referenceClosureFixtureRoot, "rows", "processes.jsonl");
  writeJsonLines(rowsFile, [processRowWithFlowRef(processId, flowId)]);

  const schemaReport = path.join(referenceClosureFixtureRoot, "schema", "validation-report.json");
  writeJson(schemaReport, {
    input_path: rel(rowsFile),
    status: "completed",
    rows: [
      {
        index: 0,
        id: processId,
        version: "00.00.001",
        type: "process",
        status: "valid",
        issues: [],
      },
    ],
  });
  const qaReport = path.join(referenceClosureFixtureRoot, "qa", "process-qa-report.json");
  writeJson(qaReport, {
    rows_file: rel(rowsFile),
    status: "completed_local_process_qa",
    blockers: [],
    findings: [],
  });
  const curationGateReport = path.join(
    referenceClosureFixtureRoot,
    "curation",
    "dataset-curation-gate-report.json",
  );
  writeJson(curationGateReport, {
    schema_version: 2,
    status: "ready",
    profile: "generic",
    dataset_type: "process",
    rows_file: rel(rowsFile),
    schema_report: rel(schemaReport),
    qa_report: rel(qaReport),
    entities: [
      {
        dataset_type: "process",
        entity_id: processId,
        version: "00.00.001",
        status: "ready",
        action_item_count: 0,
      },
    ],
  });
  const cleanupReport = path.join(
    referenceClosureFixtureRoot,
    "cleanup",
    "dataset-curation-cleanup-report.json",
  );
  writeJson(cleanupReport, {
    status: "completed",
    rows_file: rel(rowsFile),
    cleaned_rows_file: rel(rowsFile),
  });
  const progressJsonl = path.join(referenceClosureFixtureRoot, "dry-run", "progress.jsonl");
  const failuresJsonl = path.join(referenceClosureFixtureRoot, "dry-run", "failures.jsonl");
  writeJsonLines(progressJsonl, [
    {
      id: processId,
      version: "00.00.001",
      status: "prepared",
      operation: "would_insert",
    },
  ]);
  writeJsonLines(failuresJsonl, []);
  const dryRunReport = path.join(referenceClosureFixtureRoot, "dry-run", "summary.json");
  writeJson(dryRunReport, {
    status: "completed",
    mode: "dry-run",
    commit: false,
    input_path: rel(rowsFile),
    files: {
      progress_jsonl: rel(progressJsonl),
      failures_jsonl: rel(failuresJsonl),
    },
  });

  try {
    const missingProof = runFoundry([
      "dataset-mutation-manifest",
      "--type",
      "process",
      "--profile",
      "generic",
      "--rows-file",
      rel(rowsFile),
      "--schema-report",
      rel(schemaReport),
      "--curation-gate-report",
      rel(curationGateReport),
      "--cleanup-report",
      rel(cleanupReport),
      "--dry-run-report",
      rel(dryRunReport),
      "--target-user-id",
      targetUserId,
      "--out-dir",
      rel(path.join(referenceClosureFixtureRoot, "missing-proof")),
    ]);
    assert.equal(missingProof.code, 1);
    assert.equal(missingProof.json.status, "blocked");
    assert.ok(scopeBlockerCodes(missingProof.json).has("reference_closure_remote_verify_required"));
    assert.ok(itemBlockerCodes(missingProof.json).has("reference_closure_remote_verify_required"));

    const remoteChecks = path.join(referenceClosureFixtureRoot, "remote-verify", "checks.jsonl");
    writeJsonLines(remoteChecks, [
      {
        row_index: 0,
        role: "reference",
        table: "flows",
        type: "flow data set",
        id: flowId,
        version: "00.00.001",
        path: "/processDataSet/exchanges/exchange/0/referenceToFlowDataSet",
        status: "ok",
        latest_version: "00.00.001",
      },
    ]);
    const remoteVerifyReport = path.join(
      referenceClosureFixtureRoot,
      "remote-verify",
      "remote-verification-report.json",
    );
    writeJson(remoteVerifyReport, {
      schema_version: 1,
      status: "passed_remote_verification",
      root_policy: "candidate",
      input_path: rel(rowsFile),
      counts: {
        rows: 1,
        references: 1,
        checked: 1,
        blockers: 0,
      },
      blockers: [],
      files: {
        checks: rel(remoteChecks),
      },
    });
    const proven = runFoundry([
      "dataset-mutation-manifest",
      "--type",
      "process",
      "--profile",
      "generic",
      "--rows-file",
      rel(rowsFile),
      "--schema-report",
      rel(schemaReport),
      "--curation-gate-report",
      rel(curationGateReport),
      "--cleanup-report",
      rel(cleanupReport),
      "--dry-run-report",
      rel(dryRunReport),
      "--remote-verify-report",
      rel(remoteVerifyReport),
      "--target-user-id",
      targetUserId,
      "--out-dir",
      rel(path.join(referenceClosureFixtureRoot, "proven")),
    ]);
    assert.equal(proven.code, 0);
    assert.equal(proven.json.status, "ready_for_remote_write");
    assert.equal(proven.json.items[0].blockers.length, 0);

    const verifiedReferenceLedger = path.join(
      referenceClosureFixtureRoot,
      "ledger",
      "ok.flows.verified.jsonl",
    );
    writeJsonLines(verifiedReferenceLedger, [
      {
        schema_version: 1,
        dataset_type: "flow",
        dataset_id: flowId,
        dataset_version: "00.00.001",
        status: "verified",
      },
    ]);
    const provenByVerifiedLedger = runFoundry([
      "dataset-mutation-manifest",
      "--type",
      "process",
      "--profile",
      "generic",
      "--rows-file",
      rel(rowsFile),
      "--schema-report",
      rel(schemaReport),
      "--curation-gate-report",
      rel(curationGateReport),
      "--cleanup-report",
      rel(cleanupReport),
      "--dry-run-report",
      rel(dryRunReport),
      "--verified-reference-ledger",
      rel(verifiedReferenceLedger),
      "--target-user-id",
      targetUserId,
      "--out-dir",
      rel(path.join(referenceClosureFixtureRoot, "proven-by-verified-ledger")),
    ]);
    assert.equal(provenByVerifiedLedger.code, 0);
    assert.equal(provenByVerifiedLedger.json.status, "ready_for_remote_write");
    assert.equal(provenByVerifiedLedger.json.counts.verified_reference_ledger_rows, 1);
    assert.equal(provenByVerifiedLedger.json.counts.verified_reference_ledger_proven_keys, 1);
    assert.equal(provenByVerifiedLedger.json.items[0].blockers.length, 0);

    const existingFlowId = "eeeeeeee-ffff-4000-8000-000000000003";
    const identityIndex = writeCompletedIdentityPreflightIndex(referenceClosureFixtureRoot, [
      {
        datasetType: "flow",
        id: flowId,
        name: "Methane",
        decision: "block_duplicate",
        status: "blocked",
        candidates: [
          {
            index: 0,
            id: existingFlowId,
            version: "00.00.001",
            state_code: 100,
            names: ["Methane"],
            fields: { type_of_dataset: "Elementary flow" },
            match_score: 100,
            match_reasons: ["equivalent_flow_core_fields"],
            decision_hint: "block_duplicate",
          },
        ],
      },
    ]);
    const rewriteReport = runFoundry([
      "dataset-identity-reference-rewrites-apply",
      "--type",
      "process",
      "--rows-file",
      rel(rowsFile),
      "--identity-preflight-index",
      rel(identityIndex),
      "--out-dir",
      rel(path.join(referenceClosureFixtureRoot, "identity-rewrites")),
    ]);
    assert.equal(rewriteReport.code, 0);
    assert.equal(rewriteReport.json.status, "completed");
    assert.equal(rewriteReport.json.counts.flow_reference_rewrites, 1);
    const rewrittenRowsFile = path.join(repoRoot, rewriteReport.json.files.output_rows);
    const rewrittenProcess = readJsonLines(rewrittenRowsFile)[0];
    assert.equal(
      rewrittenProcess.processDataSet.exchanges.exchange[0].referenceToFlowDataSet["@refObjectId"],
      existingFlowId,
    );

    const rewrittenSchemaReport = path.join(
      referenceClosureFixtureRoot,
      "rewritten-schema",
      "validation-report.json",
    );
    writeJson(rewrittenSchemaReport, {
      input_path: rel(rewrittenRowsFile),
      status: "completed",
      rows: [
        {
          index: 0,
          id: processId,
          version: "00.00.001",
          type: "process",
          status: "valid",
          issues: [],
        },
      ],
    });
    const rewrittenQaReport = path.join(
      referenceClosureFixtureRoot,
      "rewritten-qa",
      "process-qa-report.json",
    );
    writeJson(rewrittenQaReport, {
      rows_file: rel(rewrittenRowsFile),
      status: "completed_local_process_qa",
      blockers: [],
      findings: [],
    });
    const rewrittenCurationGateReport = path.join(
      referenceClosureFixtureRoot,
      "rewritten-curation",
      "dataset-curation-gate-report.json",
    );
    writeJson(rewrittenCurationGateReport, {
      schema_version: 2,
      status: "ready",
      profile: "generic",
      dataset_type: "process",
      rows_file: rel(rewrittenRowsFile),
      schema_report: rel(rewrittenSchemaReport),
      qa_report: rel(rewrittenQaReport),
      entities: [
        {
          dataset_type: "process",
          entity_id: processId,
          version: "00.00.001",
          status: "ready",
          action_item_count: 0,
        },
      ],
    });
    const rewrittenCleanupReport = path.join(
      referenceClosureFixtureRoot,
      "rewritten-cleanup",
      "dataset-curation-cleanup-report.json",
    );
    writeJson(rewrittenCleanupReport, {
      status: "completed",
      rows_file: rel(rewrittenRowsFile),
      cleaned_rows_file: rel(rewrittenRowsFile),
    });
    const rewrittenProgressJsonl = path.join(
      referenceClosureFixtureRoot,
      "rewritten-dry-run",
      "progress.jsonl",
    );
    const rewrittenFailuresJsonl = path.join(
      referenceClosureFixtureRoot,
      "rewritten-dry-run",
      "failures.jsonl",
    );
    writeJsonLines(rewrittenProgressJsonl, [
      {
        id: processId,
        version: "00.00.001",
        status: "prepared",
        operation: "would_insert",
      },
    ]);
    writeJsonLines(rewrittenFailuresJsonl, []);
    const rewrittenDryRunReport = path.join(
      referenceClosureFixtureRoot,
      "rewritten-dry-run",
      "summary.json",
    );
    writeJson(rewrittenDryRunReport, {
      status: "completed",
      mode: "dry-run",
      commit: false,
      input_path: rel(rewrittenRowsFile),
      files: {
        progress_jsonl: rel(rewrittenProgressJsonl),
        failures_jsonl: rel(rewrittenFailuresJsonl),
      },
    });
    const provenByIdentityRewrite = runFoundry([
      "dataset-mutation-manifest",
      "--type",
      "process",
      "--profile",
      "generic",
      "--rows-file",
      rel(rewrittenRowsFile),
      "--schema-report",
      rel(rewrittenSchemaReport),
      "--curation-gate-report",
      rel(rewrittenCurationGateReport),
      "--cleanup-report",
      rel(rewrittenCleanupReport),
      "--dry-run-report",
      rel(rewrittenDryRunReport),
      "--identity-reference-rewrites",
      rewriteReport.json.files.identity_reference_rewrites,
      "--target-user-id",
      targetUserId,
      "--out-dir",
      rel(path.join(referenceClosureFixtureRoot, "proven-by-identity-rewrite")),
    ]);
    assert.equal(
      provenByIdentityRewrite.code,
      0,
      JSON.stringify(
        {
          status: provenByIdentityRewrite.json.status,
          counts: provenByIdentityRewrite.json.counts,
          scope_blockers: provenByIdentityRewrite.json.evidence?.scope_blockers ?? [],
          item_blockers:
            provenByIdentityRewrite.json.items?.flatMap((item) => item.blockers ?? []) ?? [],
        },
        null,
        2,
      ),
    );
    assert.equal(provenByIdentityRewrite.json.status, "ready_for_remote_write");
    assert.equal(provenByIdentityRewrite.json.counts.identity_reference_rewrites, 1);
    assert.equal(provenByIdentityRewrite.json.items[0].identity_reference_rewrite_count, 1);
    assert.equal(provenByIdentityRewrite.json.items[0].blockers.length, 0);
  } finally {
    fs.rmSync(referenceClosureFixtureRoot, { recursive: true, force: true });
  }
});

test("mutation manifest accepts mixed support rows with internal reference closure", () => {
  fs.rmSync(supportManifestFixtureRoot, { recursive: true, force: true });
  const contactId = "11111111-1111-4111-8111-111111111111";
  const sourceId = "22222222-2222-4222-8222-222222222222";
  const rowsFile = path.join(supportManifestFixtureRoot, "support.jsonl");
  const contactRow = {
    contactDataSet: {
      contactInformation: {
        dataSetInformation: {
          "common:UUID": contactId,
          shortName: { "@xml:lang": "en", "#text": "BAFU" },
        },
      },
      administrativeInformation: {
        dataEntryBy: {
          "common:referenceToDataSetFormat": {
            "@type": "source data set",
            refObjectId: sourceId,
            version: "00.00.001",
            "common:shortDescription": {
              "@xml:lang": "en",
              "#text": "TIDAS",
            },
          },
        },
        publicationAndOwnership: {
          "common:dataSetVersion": "00.00.001",
        },
      },
    },
  };
  const sourceRow = {
    sourceDataSet: {
      sourceInformation: {
        dataSetInformation: {
          "common:UUID": sourceId,
          shortName: { "@xml:lang": "en", "#text": "TIDAS" },
        },
      },
      administrativeInformation: {
        publicationAndOwnership: {
          "common:dataSetVersion": "00.00.001",
          "common:referenceToOwnershipOfDataSet": {
            "@type": "contact data set",
            refObjectId: contactId,
            version: "00.00.001",
            "common:shortDescription": {
              "@xml:lang": "en",
              "#text": "BAFU",
            },
          },
        },
      },
    },
  };
  writeJsonLines(rowsFile, [contactRow, sourceRow]);
  const schemaReport = path.join(supportManifestFixtureRoot, "schema", "validation-report.json");
  writeJson(schemaReport, {
    status: "completed",
    input_path: rel(rowsFile),
    rows: [
      {
        index: 0,
        id: contactId,
        version: "00.00.001",
        status: "valid",
        issues: [],
      },
      {
        index: 1,
        id: sourceId,
        version: "00.00.001",
        status: "valid",
        issues: [],
      },
    ],
  });
  const cleanupReport = path.join(
    supportManifestFixtureRoot,
    "cleanup",
    "dataset-curation-cleanup-report.json",
  );
  writeJson(cleanupReport, {
    status: "completed",
    rows_file: rel(rowsFile),
    cleaned_rows_file: rel(rowsFile),
  });
  const progressJsonl = path.join(supportManifestFixtureRoot, "dry-run", "progress.jsonl");
  const failuresJsonl = path.join(supportManifestFixtureRoot, "dry-run", "failures.jsonl");
  writeJsonLines(progressJsonl, [
    {
      id: contactId,
      version: "00.00.001",
      type: "contact",
      table: "contacts",
      status: "prepared",
      operation: "would_sync",
    },
    {
      id: sourceId,
      version: "00.00.001",
      type: "source",
      table: "sources",
      status: "prepared",
      operation: "would_sync",
    },
  ]);
  writeJsonLines(failuresJsonl, []);
  const dryRunReport = path.join(supportManifestFixtureRoot, "dry-run", "summary.json");
  writeJson(dryRunReport, {
    status: "completed",
    mode: "dry_run",
    commit: false,
    input_path: rel(rowsFile),
    files: {
      progress_jsonl: rel(progressJsonl),
      failures_jsonl: rel(failuresJsonl),
    },
  });

  try {
    const result = runFoundry([
      "dataset-mutation-manifest",
      "--type",
      "support",
      "--profile",
      "generic",
      "--rows-file",
      rel(rowsFile),
      "--schema-report",
      rel(schemaReport),
      "--cleanup-report",
      rel(cleanupReport),
      "--dry-run-report",
      rel(dryRunReport),
      "--target-user-id",
      targetUserId,
      "--out-dir",
      rel(path.join(supportManifestFixtureRoot, "manifest")),
    ]);
    assert.equal(result.code, 0);
    assert.equal(result.json.status, "ready_for_remote_write");
    assert.equal(result.json.counts.write_candidates, 2);
    assert.equal(result.json.items[0].operation, "would_sync");
    assert.equal(result.json.items[0].dry_run_status, "success");
    assert.equal(result.json.items[1].operation, "would_sync");
    assert.equal(result.json.items[1].dry_run_status, "success");
    assert.equal(scopeBlockerCodes(result.json).has("curation_gate_report_required"), false);
    assert.equal(
      scopeBlockerCodes(result.json).has("reference_closure_remote_verify_required"),
      false,
    );

    const remoteVerifyReport = path.join(
      supportManifestFixtureRoot,
      "remote-verify",
      "remote-verification-report.json",
    );
    writeJson(remoteVerifyReport, {
      schema_version: 1,
      status: "blocked_remote_verification",
      root_policy: "candidate",
      input_path: rel(rowsFile),
      counts: {
        rows: 2,
        references: 2,
        checked: 2,
        blockers: 2,
      },
      blockers: [
        {
          code: "missing_dataset",
          role: "reference",
          table: "sources",
          id: sourceId,
          version: "00.00.001",
          path: "/contactDataSet/administrativeInformation/dataEntryBy/common:referenceToDataSetFormat",
        },
        {
          code: "missing_dataset",
          role: "reference",
          table: "contacts",
          id: contactId,
          version: "00.00.001",
          path: "/sourceDataSet/administrativeInformation/publicationAndOwnership/common:referenceToOwnershipOfDataSet",
        },
      ],
    });
    const withInternalRemoteBlockers = runFoundry([
      "dataset-mutation-manifest",
      "--type",
      "support",
      "--profile",
      "generic",
      "--rows-file",
      rel(rowsFile),
      "--schema-report",
      rel(schemaReport),
      "--cleanup-report",
      rel(cleanupReport),
      "--dry-run-report",
      rel(dryRunReport),
      "--remote-verify-report",
      rel(remoteVerifyReport),
      "--target-user-id",
      targetUserId,
      "--out-dir",
      rel(path.join(supportManifestFixtureRoot, "manifest-with-remote")),
    ]);
    assert.equal(withInternalRemoteBlockers.code, 0);
    assert.equal(withInternalRemoteBlockers.json.status, "ready_for_remote_write");
    assert.equal(
      itemBlockerCodes(withInternalRemoteBlockers.json).has("remote_reference_closure_blocked"),
      false,
    );

    const badSourceRowsFile = path.join(supportManifestFixtureRoot, "bad-source-support.jsonl");
    const badSourceRow = JSON.parse(JSON.stringify(sourceRow));
    badSourceRow.sourceDataSet.sourceInformation.dataSetInformation["common:shortName"] = {
      "@xml:lang": "en",
      "#text": "ILCD format",
    };
    delete badSourceRow.sourceDataSet.sourceInformation.dataSetInformation.shortName;
    badSourceRow.sourceDataSet.sourceInformation.dataSetInformation.sourceCitation = "ILCD format";
    badSourceRow.sourceDataSet.sourceInformation.dataSetInformation.classificationInformation = {
      "common:classification": {
        "common:class": [
          {
            "@level": "0",
            "@classId": "data-format",
            "#text": "Data set formats",
          },
        ],
      },
    };
    writeJsonLines(badSourceRowsFile, [contactRow, badSourceRow]);
    const badSchemaReport = path.join(
      supportManifestFixtureRoot,
      "bad-source-schema",
      "validation-report.json",
    );
    writeJson(badSchemaReport, {
      status: "completed",
      input_path: rel(badSourceRowsFile),
      rows: [
        {
          index: 0,
          id: contactId,
          version: "00.00.001",
          status: "valid",
          issues: [],
        },
        {
          index: 1,
          id: sourceId,
          version: "00.00.001",
          status: "valid",
          issues: [],
        },
      ],
    });
    const badCleanupReport = path.join(
      supportManifestFixtureRoot,
      "bad-source-cleanup",
      "dataset-curation-cleanup-report.json",
    );
    writeJson(badCleanupReport, {
      status: "completed",
      rows_file: rel(badSourceRowsFile),
      cleaned_rows_file: rel(badSourceRowsFile),
    });
    const badProgressJsonl = path.join(
      supportManifestFixtureRoot,
      "bad-source-dry-run",
      "progress.jsonl",
    );
    const badFailuresJsonl = path.join(
      supportManifestFixtureRoot,
      "bad-source-dry-run",
      "failures.jsonl",
    );
    writeJsonLines(badProgressJsonl, [
      {
        id: contactId,
        version: "00.00.001",
        type: "contact",
        table: "contacts",
        status: "prepared",
        operation: "would_sync",
      },
      {
        id: sourceId,
        version: "00.00.001",
        type: "source",
        table: "sources",
        status: "prepared",
        operation: "would_sync",
      },
    ]);
    writeJsonLines(badFailuresJsonl, []);
    const badDryRunReport = path.join(
      supportManifestFixtureRoot,
      "bad-source-dry-run",
      "summary.json",
    );
    writeJson(badDryRunReport, {
      status: "completed",
      mode: "dry_run",
      commit: false,
      input_path: rel(badSourceRowsFile),
      files: {
        progress_jsonl: rel(badProgressJsonl),
        failures_jsonl: rel(badFailuresJsonl),
      },
    });
    const badSourceManifest = runFoundry([
      "dataset-mutation-manifest",
      "--type",
      "support",
      "--profile",
      "generic",
      "--rows-file",
      rel(badSourceRowsFile),
      "--schema-report",
      rel(badSchemaReport),
      "--cleanup-report",
      rel(badCleanupReport),
      "--dry-run-report",
      rel(badDryRunReport),
      "--target-user-id",
      targetUserId,
      "--out-dir",
      rel(path.join(supportManifestFixtureRoot, "bad-source-manifest")),
    ]);
    assert.equal(badSourceManifest.code, 1);
    assert.equal(badSourceManifest.json.status, "blocked");
    assert.equal(
      itemBlockerCodes(badSourceManifest.json).has("source_identity_not_true_source"),
      true,
    );
    assert.equal(
      itemBlockerCodes(badSourceManifest.json).has("source_classification_not_true_source"),
      true,
    );
  } finally {
    fs.rmSync(supportManifestFixtureRoot, { recursive: true, force: true });
  }
});

test("mutation manifest accepts public canonical source-reference rewrite as reference closure proof", () => {
  const root = path.join(supportManifestFixtureRoot, "public-source-reference-proof");
  fs.rmSync(root, { recursive: true, force: true });
  const contactId = "77777777-2222-4333-8444-555555555555";
  const canonicalFormatSourceId = "a97a0155-0234-4b87-b4ce-a45da52f2a40";
  const rowsFile = path.join(root, "support.cleaned.jsonl");
  const contactRow = {
    contactDataSet: {
      contactInformation: {
        dataSetInformation: {
          "common:UUID": contactId,
          shortName: { "@xml:lang": "en", "#text": "Federal Office for the Environment FOEN" },
        },
      },
      administrativeInformation: {
        dataEntryBy: {
          "common:referenceToDataSetFormat": {
            "@type": "source data set",
            refObjectId: canonicalFormatSourceId,
            version: "03.00.003",
            "common:shortDescription": { "@xml:lang": "en", "#text": "ILCD format" },
          },
        },
        publicationAndOwnership: {
          "common:dataSetVersion": "00.00.001",
        },
      },
    },
  };
  writeJsonLines(rowsFile, [contactRow]);
  writeJsonLines(path.join(root, "source-reference-rewrites.jsonl"), [
    {
      dataset_type: "contact",
      dataset_id: contactId,
      dataset_version: "00.00.001",
      path: "contactDataSet.administrativeInformation.dataEntryBy.common:referenceToDataSetFormat",
      relation: "dataset_format_source",
      original: {
        ref_object_id: "converted-format-source",
        version: "00.00.001",
        short_description: "ILCD format",
      },
      canonical: {
        ref_object_id: canonicalFormatSourceId,
        version: "03.00.003",
        short_description: "ILCD format",
      },
      reason:
        "Data set format uses the public canonical ILCD format source instead of a converted package-local support source.",
    },
  ]);

  const schemaReport = path.join(root, "schema", "validation-report.json");
  writeJson(schemaReport, {
    status: "completed",
    input_path: rel(rowsFile),
    rows: [{ index: 0, id: contactId, version: "00.00.001", status: "valid", issues: [] }],
  });
  const cleanupReport = path.join(root, "cleanup", "dataset-curation-cleanup-report.json");
  writeJson(cleanupReport, {
    status: "completed",
    rows_file: rel(rowsFile),
    cleaned_rows_file: rel(rowsFile),
  });
  const progressJsonl = path.join(root, "dry-run", "progress.jsonl");
  const failuresJsonl = path.join(root, "dry-run", "failures.jsonl");
  writeJsonLines(progressJsonl, [
    {
      id: contactId,
      version: "00.00.001",
      type: "contact",
      table: "contacts",
      status: "prepared",
      operation: "would_sync",
    },
  ]);
  writeJsonLines(failuresJsonl, []);
  const dryRunReport = path.join(root, "dry-run", "summary.json");
  writeJson(dryRunReport, {
    status: "completed",
    mode: "dry_run",
    commit: false,
    input_path: rel(rowsFile),
    files: {
      progress_jsonl: rel(progressJsonl),
      failures_jsonl: rel(failuresJsonl),
    },
  });

  try {
    const result = runFoundry([
      "dataset-mutation-manifest",
      "--type",
      "support",
      "--profile",
      "bafu",
      "--rows-file",
      rel(rowsFile),
      "--schema-report",
      rel(schemaReport),
      "--cleanup-report",
      rel(cleanupReport),
      "--dry-run-report",
      rel(dryRunReport),
      "--target-user-id",
      targetUserId,
      "--out-dir",
      rel(path.join(root, "manifest")),
    ]);
    assert.equal(result.code, 0, JSON.stringify(result.json, null, 2));
    assert.equal(result.json.status, "ready_for_remote_write");
    assert.equal(result.json.counts.source_reference_rewrites, 1);
    assert.equal(
      scopeBlockerCodes(result.json).has("reference_closure_remote_verify_required"),
      false,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("BAFU support manifest accepts source-contact rewrite as deterministic semantic evidence", () => {
  const root = path.join(supportManifestFixtureRoot, "bafu-source-contact-proof");
  fs.rmSync(root, { recursive: true, force: true });
  const contactId = "11111111-2222-4333-8444-555555555555";
  const sourceId = "22222222-3333-4444-8555-666666666666";
  const originalRowsFile = path.join(root, "original-support.jsonl");
  const rewrittenRowsFile = path.join(root, "source-contact-rewritten.jsonl");
  const finalRowsFile = path.join(root, "support.cleaned.jsonl");
  const contactRow = {
    contactDataSet: {
      contactInformation: {
        dataSetInformation: {
          "common:UUID": contactId,
          shortName: { "@xml:lang": "en", "#text": "BAFU" },
        },
      },
      administrativeInformation: {
        publicationAndOwnership: {
          "common:dataSetVersion": "00.00.001",
        },
      },
    },
  };
  const sourceRow = {
    sourceDataSet: {
      sourceInformation: {
        dataSetInformation: {
          "common:UUID": sourceId,
          shortName: { "@xml:lang": "en", "#text": "BAFU 2025 LCI database" },
          sourceCitation: "Federal Office for the Environment FOEN, BAFU 2025 LCI database.",
          sourceDescriptionOrComment: {
            "@xml:lang": "en",
            "#text":
              "Fallback database-level source for BAFU 2025 Version 2 rows where the converted source trace does not identify a more specific report or publication.",
          },
        },
      },
      administrativeInformation: {
        publicationAndOwnership: {
          "common:dataSetVersion": "00.00.001",
          "common:referenceToOwnershipOfDataSet": {
            "@type": "contact data set",
            refObjectId: contactId,
            version: "00.00.001",
            "common:shortDescription": {
              "@xml:lang": "en",
              "#text": "BAFU",
            },
          },
        },
      },
    },
  };
  writeJsonLines(originalRowsFile, [contactRow, sourceRow]);
  writeJsonLines(rewrittenRowsFile, [contactRow, sourceRow]);
  writeJsonLines(finalRowsFile, [contactRow, sourceRow]);

  const schemaReport = path.join(root, "schema", "validation-report.json");
  writeJson(schemaReport, {
    status: "completed",
    input_path: rel(finalRowsFile),
    rows: [
      { index: 0, id: contactId, version: "00.00.001", status: "valid", issues: [] },
      { index: 1, id: sourceId, version: "00.00.001", status: "valid", issues: [] },
    ],
  });
  const qaReport = path.join(root, "qa", "support-qa-report.json");
  writeJson(qaReport, {
    status: "not_required_for_support_rows",
    rows_file: rel(finalRowsFile),
    blockers: [],
    findings: [],
  });
  const curationGateReport = path.join(root, "curation", "dataset-curation-gate-report.json");
  writeJson(curationGateReport, {
    schema_version: 2,
    status: "ready",
    profile: "bafu",
    dataset_type: "support",
    rows_file: rel(finalRowsFile),
    schema_report: rel(schemaReport),
    qa_report: rel(qaReport),
    context: {
      contract_context_file_details: [],
      contract_context_files: [],
    },
    entities: [
      {
        dataset_type: "contact",
        entity_id: contactId,
        version: "00.00.001",
        status: "ready",
      },
      {
        dataset_type: "source",
        entity_id: sourceId,
        version: "00.00.001",
        status: "ready",
      },
    ],
  });
  const sourceContactRewriteReport = path.join(
    root,
    "source-contact-rewrites",
    "source-contact-rewrites-report.json",
  );
  writeJson(sourceContactRewriteReport, {
    schema_version: 1,
    status: "completed",
    profile: "bafu",
    rows_file: rel(originalRowsFile),
    output_rows_file: rel(rewrittenRowsFile),
    policy: {
      contact: "BAFU imports use one database-level FOEN/BAFU ownership contact.",
      source: "Use true source rows when present; otherwise use the BAFU database-level source.",
    },
    counts: {
      input_rows: 2,
      output_rows: 2,
      contact_reference_rewrites: 1,
      source_reference_rewrites: 1,
    },
    files: {
      output_rows: rel(rewrittenRowsFile),
      report: rel(sourceContactRewriteReport),
    },
  });
  const cleanupReport = path.join(root, "cleanup", "dataset-curation-cleanup-report.json");
  writeJson(cleanupReport, {
    status: "completed",
    rows_file: rel(rewrittenRowsFile),
    cleaned_rows_file: rel(finalRowsFile),
  });
  const progressJsonl = path.join(root, "dry-run", "progress.jsonl");
  const failuresJsonl = path.join(root, "dry-run", "failures.jsonl");
  writeJsonLines(progressJsonl, [
    {
      id: contactId,
      version: "00.00.001",
      type: "contact",
      table: "contacts",
      status: "prepared",
      operation: "would_sync",
    },
    {
      id: sourceId,
      version: "00.00.001",
      type: "source",
      table: "sources",
      status: "prepared",
      operation: "would_sync",
    },
  ]);
  writeJsonLines(failuresJsonl, []);
  const dryRunReport = path.join(root, "dry-run", "summary.json");
  writeJson(dryRunReport, {
    status: "completed",
    mode: "dry_run",
    commit: false,
    input_path: rel(finalRowsFile),
    files: {
      progress_jsonl: rel(progressJsonl),
      failures_jsonl: rel(failuresJsonl),
    },
  });

  try {
    const result = runFoundry([
      "dataset-mutation-manifest",
      "--type",
      "support",
      "--profile",
      "bafu",
      "--rows-file",
      rel(finalRowsFile),
      "--schema-report",
      rel(schemaReport),
      "--qa-report",
      rel(qaReport),
      "--curation-gate-report",
      rel(curationGateReport),
      "--source-contact-rewrite-report",
      rel(sourceContactRewriteReport),
      "--cleanup-report",
      rel(cleanupReport),
      "--dry-run-report",
      rel(dryRunReport),
      "--target-user-id",
      targetUserId,
      "--out-dir",
      rel(path.join(root, "manifest")),
    ]);
    assert.equal(result.code, 0, JSON.stringify(result.json, null, 2));
    assert.equal(result.json.status, "ready_for_remote_write");
    assert.equal(result.json.evidence.full_context_ai_completion_required, false);
    assert.equal(result.json.counts.source_contact_rewrite_semantic_evidence_entries, 2);
    assert.equal(
      scopeBlockerCodes(result.json).has("full_context_ai_completion_output_required"),
      false,
    );
    assert.equal(
      scopeBlockerCodes(result.json).has("full_context_ai_deterministic_apply_required"),
      false,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

import test from "node:test";
import { mutationFixtureRoot } from "../fixtures/fixture-roots.ts";
import {
  assert,
  fs,
  fullContextKinds,
  itemBlockerCodes,
  path,
  readJson,
  readJsonLines,
  rel,
  repoRoot,
  runFoundry,
  scopeBlockerCodes,
  targetUserId,
  writeJson,
  writeJsonLines,
} from "../fixtures/foundry-core.ts";
import { writeDecisionTaskFixture } from "../fixtures/full-context-fixtures.mjs";
import { createMutationManifestFixture } from "../fixtures/mutation-fixtures.mjs";

test("mutation manifest requires full-context AI evidence and preserves deferred trace queues", () => {
  const fixture = createMutationManifestFixture();
  try {
    const blocked = runFoundry([
      "dataset-mutation-manifest",
      "--type",
      "process",
      "--profile",
      "bafu",
      "--rows-file",
      rel(fixture.rowsFile),
      "--schema-report",
      rel(fixture.schemaReport),
      "--curation-gate-report",
      rel(fixture.curationGateReport),
      "--cleanup-report",
      rel(fixture.cleanupReport),
      "--dry-run-report",
      rel(fixture.dryRunReport),
      "--target-user-id",
      targetUserId,
      "--out-dir",
      rel(path.join(mutationFixtureRoot, "blocked-manifest")),
    ]);
    assert.equal(blocked.code, 1);
    assert.equal(blocked.json.status, "blocked");
    assert.equal(blocked.json.evidence.patch_collect_required, true);
    assert.ok(itemBlockerCodes(blocked.json).has("full_context_ai_completion_output_required"));
    assert.ok(itemBlockerCodes(blocked.json).has("full_context_ai_deterministic_apply_required"));

    const blockedMissingDryRun = runFoundry([
      "dataset-mutation-manifest",
      "--type",
      "process",
      "--profile",
      "bafu",
      "--rows-file",
      rel(fixture.rowsFile),
      "--schema-report",
      rel(fixture.schemaReport),
      "--curation-gate-report",
      rel(fixture.curationGateReport),
      "--cleanup-report",
      rel(fixture.cleanupReport),
      "--target-user-id",
      targetUserId,
      "--out-dir",
      rel(path.join(mutationFixtureRoot, "missing-dry-run-manifest")),
    ]);
    assert.equal(blockedMissingDryRun.code, 1);
    assert.equal(blockedMissingDryRun.json.status, "blocked");
    assert.equal(blockedMissingDryRun.json.evidence.dry_run_report, null);
    assert.ok(scopeBlockerCodes(blockedMissingDryRun.json).has("dry_run_report_required"));
    assert.ok(itemBlockerCodes(blockedMissingDryRun.json).has("dry_run_evidence_missing"));

    const dryRunRowsMismatchReport = path.join(
      mutationFixtureRoot,
      "dry-run-mismatch",
      "summary.json",
    );
    writeJson(dryRunRowsMismatchReport, {
      ...readJson(fixture.dryRunReport),
      input_path: rel(path.join(mutationFixtureRoot, "final", "other.jsonl")),
    });
    const mismatchedDryRun = runFoundry([
      "dataset-mutation-manifest",
      "--type",
      "process",
      "--profile",
      "bafu",
      "--rows-file",
      rel(fixture.rowsFile),
      "--schema-report",
      rel(fixture.schemaReport),
      "--curation-gate-report",
      rel(fixture.curationGateReport),
      "--cleanup-report",
      rel(fixture.cleanupReport),
      "--dry-run-report",
      rel(dryRunRowsMismatchReport),
      "--patch-collect-report",
      rel(fixture.patchCollectReport),
      "--require-patch-collect-report",
      "--patch-apply-report",
      rel(fixture.patchApplyReport),
      "--target-user-id",
      targetUserId,
      "--out-dir",
      rel(path.join(mutationFixtureRoot, "dry-run-mismatch-manifest")),
    ]);
    assert.equal(mismatchedDryRun.code, 1);
    assert.ok(itemBlockerCodes(mismatchedDryRun.json).has("dry_run_report_rows_mismatch"));

    const classificationDecisionsFile = path.join(
      mutationFixtureRoot,
      "classification-decisions",
      "classification-decisions.jsonl",
    );
    const classificationQueueFile = path.join(
      mutationFixtureRoot,
      "classification-decisions",
      "classification-authoring-queue.jsonl",
    );
    const decisionOutputBeforeCleanup = path.join(
      mutationFixtureRoot,
      "patch-apply",
      "processes.patched.jsonl",
    );
    writeJsonLines(classificationQueueFile, [
      {
        dataset_type: "process",
        dataset_id: fixture.processId,
        dataset_version: "00.00.001",
        classification_workflow: {
          schema_type: "process",
          row_type: "process",
          commands: {
            input_rows: rel(decisionOutputBeforeCleanup),
            output_rows: rel(decisionOutputBeforeCleanup),
          },
        },
      },
    ]);
    const classificationDecisionTask = writeDecisionTaskFixture({
      root: mutationFixtureRoot,
      kind: "classification",
      queueFile: classificationQueueFile,
      contractContextFiles: fixture.contractContextFiles,
    });
    writeJsonLines(classificationDecisionsFile, [
      {
        dataset_id: fixture.processId,
        dataset_version: "00.00.001",
        category_type: "process",
        code: "1080",
        basis:
          "AI selected the process class from the full schema, methodology YAML, ruleset, classification schema, and location schema context.",
        authoring_context: classificationDecisionTask.authoringContext,
        evidence: {
          source: "classification-authoring-queue",
          quote_or_trace: "process baseName Fixture process",
          used_context_kinds: fullContextKinds,
        },
      },
    ]);
    const classificationDecisionApplyReport = path.join(
      mutationFixtureRoot,
      "classification-decisions",
      "classification-decisions-apply-report.json",
    );
    writeJson(classificationDecisionApplyReport, {
      schema_version: 1,
      status: "completed",
      decisions_file: rel(classificationDecisionsFile),
      decision_task: {
        path: rel(classificationDecisionTask.taskFile),
        sha256: classificationDecisionTask.taskSha256,
        context_bundle_sha256: classificationDecisionTask.contextBundleSha256,
      },
      files: {
        output_rows: [rel(decisionOutputBeforeCleanup)],
      },
      counts: {
        applied: 1,
      },
    });
    const classificationTraceBlocked = runFoundry([
      "dataset-mutation-manifest",
      "--type",
      "process",
      "--profile",
      "bafu",
      "--rows-file",
      rel(fixture.rowsFile),
      "--schema-report",
      rel(fixture.schemaReport),
      "--curation-gate-report",
      rel(fixture.curationGateReport),
      "--cleanup-report",
      rel(fixture.cleanupReport),
      "--dry-run-report",
      rel(fixture.dryRunReport),
      "--classification-decision-apply-report",
      rel(classificationDecisionApplyReport),
      "--target-user-id",
      targetUserId,
      "--out-dir",
      rel(path.join(mutationFixtureRoot, "classification-passed-manifest")),
    ]);
    assert.equal(classificationTraceBlocked.code, 1);
    assert.equal(classificationTraceBlocked.json.status, "blocked");
    assert.equal(classificationTraceBlocked.json.evidence.patch_collect_required, false);
    assert.equal(classificationTraceBlocked.json.counts.ai_classification_decision_entries, 1);
    assert.equal(classificationTraceBlocked.json.counts.ai_patch_evidence_entries, 0);
    assert.ok(
      itemBlockerCodes(classificationTraceBlocked.json).has(
        "unresolved_trace_patch_evidence_required",
      ),
    );

    writeJsonLines(classificationDecisionsFile, [
      {
        dataset_id: fixture.processId,
        dataset_version: "00.00.001",
        category_type: "process",
        code: "1080",
        basis:
          "AI selected the process class from the full schema, methodology YAML, ruleset, classification schema, and location schema context.",
        authoring_context: classificationDecisionTask.authoringContext,
        evidence: {
          source: "classification-authoring-queue",
          quote_or_trace: "process baseName Fixture process",
          used_context_kinds: fullContextKinds,
        },
      },
    ]);
    const classificationStatusBlocked = runFoundry([
      "dataset-mutation-manifest",
      "--type",
      "process",
      "--profile",
      "bafu",
      "--rows-file",
      rel(fixture.rowsFile),
      "--schema-report",
      rel(fixture.schemaReport),
      "--curation-gate-report",
      rel(fixture.curationGateReport),
      "--cleanup-report",
      rel(fixture.cleanupReport),
      "--dry-run-report",
      rel(fixture.dryRunReport),
      "--classification-decision-apply-report",
      rel(classificationDecisionApplyReport),
      "--target-user-id",
      targetUserId,
      "--out-dir",
      rel(path.join(mutationFixtureRoot, "classification-status-blocked-manifest")),
    ]);
    assert.equal(classificationStatusBlocked.code, 1);
    assert.ok(
      scopeBlockerCodes(classificationStatusBlocked.json).has(
        "full_context_ai_classification_decision_status_not_completed",
      ),
    );

    const wrongKindClassificationTask = writeDecisionTaskFixture({
      root: mutationFixtureRoot,
      kind: "location",
      queueFile: classificationQueueFile,
      contractContextFiles: fixture.contractContextFiles,
      dirName: "classification-wrong-kind-decision-task",
    });
    writeJsonLines(classificationDecisionsFile, [
      {
        dataset_id: fixture.processId,
        dataset_version: "00.00.001",
        category_type: "process",
        decision_status: "completed",
        code: "1080",
        basis: "AI selected the process class from a task with the wrong task kind.",
        authoring_context: wrongKindClassificationTask.authoringContext,
        evidence: {
          source: "classification-authoring-queue",
          quote_or_trace: "process baseName Fixture process",
          used_context_kinds: fullContextKinds,
        },
      },
    ]);
    writeJson(classificationDecisionApplyReport, {
      schema_version: 1,
      status: "completed",
      decisions_file: rel(classificationDecisionsFile),
      decision_task: {
        path: rel(wrongKindClassificationTask.taskFile),
        sha256: wrongKindClassificationTask.taskSha256,
        context_bundle_sha256: wrongKindClassificationTask.contextBundleSha256,
      },
      files: {
        output_rows: [rel(decisionOutputBeforeCleanup)],
      },
      counts: {
        applied: 1,
      },
    });
    const classificationWrongTaskKindBlocked = runFoundry([
      "dataset-mutation-manifest",
      "--type",
      "process",
      "--profile",
      "bafu",
      "--rows-file",
      rel(fixture.rowsFile),
      "--schema-report",
      rel(fixture.schemaReport),
      "--curation-gate-report",
      rel(fixture.curationGateReport),
      "--cleanup-report",
      rel(fixture.cleanupReport),
      "--dry-run-report",
      rel(fixture.dryRunReport),
      "--classification-decision-apply-report",
      rel(classificationDecisionApplyReport),
      "--target-user-id",
      targetUserId,
      "--out-dir",
      rel(path.join(mutationFixtureRoot, "classification-wrong-task-kind-manifest")),
    ]);
    assert.equal(classificationWrongTaskKindBlocked.code, 1);
    assert.ok(
      scopeBlockerCodes(classificationWrongTaskKindBlocked.json).has(
        "full_context_ai_classification_decision_task_kind_invalid",
      ),
    );

    const blockedStatusClassificationTask = writeDecisionTaskFixture({
      root: mutationFixtureRoot,
      kind: "classification",
      queueFile: classificationQueueFile,
      contractContextFiles: fixture.contractContextFiles,
      dirName: "classification-blocked-status-decision-task",
      status: "blocked_missing_full_context",
    });
    writeJsonLines(classificationDecisionsFile, [
      {
        dataset_id: fixture.processId,
        dataset_version: "00.00.001",
        category_type: "process",
        decision_status: "completed",
        code: "1080",
        basis: "AI selected the process class from a task that is not ready.",
        authoring_context: blockedStatusClassificationTask.authoringContext,
        evidence: {
          source: "classification-authoring-queue",
          quote_or_trace: "process baseName Fixture process",
          used_context_kinds: fullContextKinds,
        },
      },
    ]);
    writeJson(classificationDecisionApplyReport, {
      schema_version: 1,
      status: "completed",
      decisions_file: rel(classificationDecisionsFile),
      decision_task: {
        path: rel(blockedStatusClassificationTask.taskFile),
        sha256: blockedStatusClassificationTask.taskSha256,
        context_bundle_sha256: blockedStatusClassificationTask.contextBundleSha256,
      },
      files: {
        output_rows: [rel(decisionOutputBeforeCleanup)],
      },
      counts: {
        applied: 1,
      },
    });
    const classificationTaskStatusBlocked = runFoundry([
      "dataset-mutation-manifest",
      "--type",
      "process",
      "--profile",
      "bafu",
      "--rows-file",
      rel(fixture.rowsFile),
      "--schema-report",
      rel(fixture.schemaReport),
      "--curation-gate-report",
      rel(fixture.curationGateReport),
      "--cleanup-report",
      rel(fixture.cleanupReport),
      "--dry-run-report",
      rel(fixture.dryRunReport),
      "--classification-decision-apply-report",
      rel(classificationDecisionApplyReport),
      "--target-user-id",
      targetUserId,
      "--out-dir",
      rel(path.join(mutationFixtureRoot, "classification-task-status-blocked-manifest")),
    ]);
    assert.equal(classificationTaskStatusBlocked.code, 1);
    assert.ok(
      scopeBlockerCodes(classificationTaskStatusBlocked.json).has(
        "full_context_ai_classification_decision_task_status_invalid",
      ),
    );

    writeJson(classificationDecisionApplyReport, {
      schema_version: 1,
      status: "completed",
      decisions_file: rel(classificationDecisionsFile),
      decision_task: {
        path: rel(classificationDecisionTask.taskFile),
        sha256: classificationDecisionTask.taskSha256,
        context_bundle_sha256: classificationDecisionTask.contextBundleSha256,
      },
      files: {
        output_rows: [rel(decisionOutputBeforeCleanup)],
      },
      counts: {
        applied: 1,
      },
    });
    writeJsonLines(classificationDecisionsFile, [
      {
        dataset_id: fixture.processId,
        dataset_version: "00.00.001",
        category_type: "process",
        decision_status: "completed",
        code: "1080",
        basis:
          "AI selected the process class from the full schema, methodology YAML, ruleset, classification schema, and location schema context.",
        authoring_context: classificationDecisionTask.authoringContext,
        evidence: {
          source: "classification-authoring-queue",
          quote_or_trace: "process baseName Fixture process",
          used_context_kinds: fullContextKinds,
        },
      },
    ]);
    const classificationChainedThroughCleanup = runFoundry([
      "dataset-mutation-manifest",
      "--type",
      "process",
      "--profile",
      "bafu",
      "--rows-file",
      rel(fixture.rowsFile),
      "--schema-report",
      rel(fixture.schemaReport),
      "--curation-gate-report",
      rel(fixture.curationGateReport),
      "--cleanup-report",
      rel(fixture.cleanupReport),
      "--dry-run-report",
      rel(fixture.dryRunReport),
      "--classification-decision-apply-report",
      rel(classificationDecisionApplyReport),
      "--target-user-id",
      targetUserId,
      "--out-dir",
      rel(path.join(mutationFixtureRoot, "classification-cleanup-chain")),
    ]);
    assert.equal(classificationChainedThroughCleanup.code, 1);
    assert.equal(classificationChainedThroughCleanup.json.status, "blocked");
    assert.equal(classificationChainedThroughCleanup.json.evidence.patch_collect_required, false);
    assert.equal(
      classificationChainedThroughCleanup.json.counts.ai_classification_decision_entries,
      1,
    );
    assert.ok(
      itemBlockerCodes(classificationChainedThroughCleanup.json).has(
        "unresolved_trace_patch_evidence_required",
      ),
    );

    const chainDir = path.join(mutationFixtureRoot, "identity-classification-chain");
    const identityRowsFile = path.join(chainDir, "processes.identity.jsonl");
    const classifiedRowsFile = path.join(chainDir, "processes.classified.jsonl");
    writeJsonLines(identityRowsFile, readJsonLines(decisionOutputBeforeCleanup));
    writeJsonLines(classifiedRowsFile, readJsonLines(decisionOutputBeforeCleanup));
    const chainQueueFile = path.join(chainDir, "classification-authoring-queue.jsonl");
    const chainClassificationDecisionsFile = path.join(chainDir, "classification-decisions.jsonl");
    writeJsonLines(chainQueueFile, [
      {
        dataset_type: "process",
        dataset_id: fixture.processId,
        dataset_version: "00.00.001",
        classification_workflow: {
          schema_type: "process",
          row_type: "process",
          commands: {
            input_rows: rel(identityRowsFile),
            output_rows: rel(classifiedRowsFile),
          },
        },
      },
    ]);
    const chainClassificationTask = writeDecisionTaskFixture({
      root: mutationFixtureRoot,
      kind: "classification",
      queueFile: chainQueueFile,
      contractContextFiles: fixture.contractContextFiles,
      dirName: "identity-chain-classification-decision-task",
    });
    writeJsonLines(chainClassificationDecisionsFile, [
      {
        dataset_id: fixture.processId,
        dataset_version: "00.00.001",
        category_type: "process",
        decision_status: "completed",
        code: "1080",
        basis:
          "AI selected the process class after reading the full schema, methodology YAML, ruleset, classification schema, and location schema context.",
        authoring_context: chainClassificationTask.authoringContext,
        evidence: {
          source: "classification-authoring-queue",
          quote_or_trace: "process baseName Fixture process",
          used_context_kinds: fullContextKinds,
        },
      },
    ]);
    const chainClassificationApplyReport = path.join(
      chainDir,
      "classification-decisions-apply-report.json",
    );
    writeJson(chainClassificationApplyReport, {
      schema_version: 1,
      status: "completed",
      decisions_file: rel(chainClassificationDecisionsFile),
      decision_task: {
        path: rel(chainClassificationTask.taskFile),
        sha256: chainClassificationTask.taskSha256,
        context_bundle_sha256: chainClassificationTask.contextBundleSha256,
      },
      files: {
        input_rows: [rel(identityRowsFile)],
        output_rows: [rel(classifiedRowsFile)],
      },
      counts: {
        applied: 1,
      },
    });

    const curationGate = readJson(fixture.curationGateReport);
    const packageBinding = curationGate.entities[0];
    const identityDecisionsFile = path.join(chainDir, "identity-decisions.jsonl");
    writeJsonLines(identityDecisionsFile, [
      {
        dataset_type: "process",
        dataset_id: fixture.processId,
        dataset_version: "00.00.001",
        decision_status: "completed",
        identity_decision: "create_new",
        authoring_package: packageBinding.authoring_package,
        authoring_package_sha256: packageBinding.authoring_package_sha256,
        closes_action_items: ["identity_preflight_manual_review"],
        basis:
          "The process identity preflight did not find a reusable public candidate; the row remains a new process write candidate.",
        evidence: {
          source: "identity-preflight",
          quote_or_trace: "No duplicate process candidate exceeded the reuse threshold.",
          used_context_kinds: fullContextKinds,
        },
      },
    ]);
    const identityDecisionApplyReport = path.join(chainDir, "identity-decisions-apply-report.json");
    writeJson(identityDecisionApplyReport, {
      schema_version: 1,
      status: "completed",
      dataset_type: "process",
      decisions_file: rel(identityDecisionsFile),
      files: {
        output_rows: [rel(identityRowsFile)],
      },
      counts: {
        decisions: 1,
        writes: 1,
        reference_reuse: 0,
      },
    });
    const chainCanonicalSupportRowsFile = path.join(
      chainDir,
      "canonical-support-rewrites",
      "processes.canonical-support-rewritten.jsonl",
    );
    writeJsonLines(chainCanonicalSupportRowsFile, readJsonLines(decisionOutputBeforeCleanup));
    const chainCanonicalSupportRewritesFile = path.join(
      chainDir,
      "canonical-support-rewrites",
      "canonical-support-rewrites.jsonl",
    );
    const chainCanonicalSupportBlockersFile = path.join(
      chainDir,
      "canonical-support-rewrites",
      "canonical-support-blockers.jsonl",
    );
    const chainCanonicalSupportDeferredRowsFile = path.join(
      chainDir,
      "canonical-support-rewrites",
      "processes.canonical-support-deferred.jsonl",
    );
    writeJsonLines(chainCanonicalSupportRewritesFile, []);
    writeJsonLines(chainCanonicalSupportDeferredRowsFile, [
      {
        processDataSet: {
          processInformation: {
            dataSetInformation: {
              "common:UUID": "deferred-support-row",
            },
          },
        },
      },
    ]);
    writeJsonLines(chainCanonicalSupportBlockersFile, [
      {
        code: "canonical_flow_property_reference_unresolved",
        dataset_type: "process",
        dataset_id: "deferred-support-row",
        dataset_version: "00.00.001",
        source_unit: "my",
        message:
          "This row is isolated into the canonical support deferred rows file and must not block the ready output rows.",
      },
    ]);
    const chainCanonicalSupportReport = path.join(
      chainDir,
      "canonical-support-rewrites",
      "canonical-support-rewrite-report.json",
    );
    writeJson(chainCanonicalSupportReport, {
      schema_version: 1,
      status: "completed_with_deferred_rows",
      dataset_type: "process",
      rows_file: rel(decisionOutputBeforeCleanup),
      output_rows_file: rel(chainCanonicalSupportRowsFile),
      counts: {
        input_rows: 2,
        output_rows: 1,
        deferred_rows: 1,
        blockers: 0,
        deferred_blockers: 1,
        canonical_flow_property_reference_rewrites: 0,
        canonical_unit_group_reference_proofs: 0,
      },
      files: {
        report: rel(chainCanonicalSupportReport),
        input_rows: rel(decisionOutputBeforeCleanup),
        output_rows: rel(chainCanonicalSupportRowsFile),
        deferred_rows: rel(chainCanonicalSupportDeferredRowsFile),
        canonical_support_rewrites: rel(chainCanonicalSupportRewritesFile),
        canonical_support_blockers: rel(chainCanonicalSupportBlockersFile),
      },
      blockers: [],
      deferred_blockers: readJsonLines(chainCanonicalSupportBlockersFile),
    });
    const cleanupAfterCanonicalSupportReport = path.join(
      chainDir,
      "cleanup",
      "dataset-curation-cleanup-after-canonical-support-report.json",
    );
    writeJson(cleanupAfterCanonicalSupportReport, {
      schema_version: 2,
      status: "completed",
      dataset_type: "process",
      rows_file: rel(chainCanonicalSupportRowsFile),
      cleaned_rows_file: rel(fixture.rowsFile),
      files: {
        cleaned_rows: rel(fixture.rowsFile),
      },
    });
    const chainManifest = runFoundry([
      "dataset-mutation-manifest",
      "--type",
      "process",
      "--profile",
      "bafu",
      "--rows-file",
      rel(fixture.rowsFile),
      "--schema-report",
      rel(fixture.schemaReport),
      "--curation-gate-report",
      rel(fixture.curationGateReport),
      "--cleanup-report",
      rel(cleanupAfterCanonicalSupportReport),
      "--dry-run-report",
      rel(fixture.dryRunReport),
      "--patch-collect-report",
      rel(fixture.patchCollectReport),
      "--require-patch-collect-report",
      "--patch-apply-report",
      rel(fixture.patchApplyReport),
      "--classification-decision-apply-report",
      rel(chainClassificationApplyReport),
      "--identity-decision-apply-report",
      rel(identityDecisionApplyReport),
      "--identity-reference-rewrite-input-rows",
      rel(classifiedRowsFile),
      "--identity-reference-rewrite-output-rows",
      rel(decisionOutputBeforeCleanup),
      "--canonical-support-rewrite-report",
      rel(chainCanonicalSupportReport),
      "--target-user-id",
      targetUserId,
      "--out-dir",
      rel(path.join(chainDir, "manifest")),
    ]);
    assert.equal(chainManifest.code, 0, JSON.stringify(chainManifest.json, null, 2));
    assert.equal(chainManifest.json.status, "ready_for_remote_write");
    assert.equal(
      scopeBlockerCodes(chainManifest.json).has("full_context_ai_identity_rows_mismatch"),
      false,
    );
    assert.equal(
      scopeBlockerCodes(chainManifest.json).has("full_context_ai_classification_rows_mismatch"),
      false,
    );
    assert.equal(
      chainManifest.json.evidence.canonical_support_rewrite_status,
      "completed_with_deferred_rows",
    );
    assert.equal(chainManifest.json.evidence.canonical_support_rewrite_blockers, 0);
    assert.equal(chainManifest.json.evidence.canonical_support_rewrite_deferred_blockers, 1);
    assert.equal(chainManifest.json.evidence.canonical_support_rewrite_deferred_row_count, 1);
    assert.equal(
      chainManifest.json.evidence.canonical_support_rewrite_deferred_rows,
      rel(chainCanonicalSupportDeferredRowsFile),
    );

    const locationDecisionsFile = path.join(
      mutationFixtureRoot,
      "location-decisions",
      "location-decisions.jsonl",
    );
    const locationQueueFile = path.join(
      mutationFixtureRoot,
      "location-decisions",
      "location-authoring-queue.jsonl",
    );
    writeJsonLines(locationQueueFile, [
      {
        dataset_type: "process",
        dataset_id: fixture.processId,
        dataset_version: "00.00.001",
        path: "processDataSet.processInformation.geography.locationOfOperationSupplyOrProduction.@location",
        location_workflow: {
          schema_type: "location",
          commands: {
            input_rows: rel(decisionOutputBeforeCleanup),
            output_rows: rel(decisionOutputBeforeCleanup),
          },
        },
      },
    ]);
    const locationDecisionTask = writeDecisionTaskFixture({
      root: mutationFixtureRoot,
      kind: "location",
      queueFile: locationQueueFile,
      contractContextFiles: fixture.contractContextFiles,
    });
    writeJsonLines(locationDecisionsFile, [
      {
        dataset_id: fixture.processId,
        dataset_version: "00.00.001",
        category_type: "location",
        decision_status: "completed",
        code: "CH",
        target_path:
          "processDataSet.processInformation.geography.locationOfOperationSupplyOrProduction.@location",
        basis:
          "AI selected the location code from the full schema, methodology YAML, ruleset, classification schema, and location schema context.",
        authoring_context: locationDecisionTask.authoringContext,
        evidence: {
          source: "location-authoring-queue",
          quote_or_trace: "source geography Switzerland",
          used_context_kinds: fullContextKinds,
        },
      },
    ]);
    const locationDecisionApplyReport = path.join(
      mutationFixtureRoot,
      "location-decisions",
      "location-decisions-apply-report.json",
    );
    writeJson(locationDecisionApplyReport, {
      schema_version: 1,
      status: "completed",
      decisions_file: rel(locationDecisionsFile),
      decision_task: {
        path: rel(locationDecisionTask.taskFile),
        sha256: locationDecisionTask.taskSha256,
        context_bundle_sha256: locationDecisionTask.contextBundleSha256,
      },
      files: {
        output_rows: [rel(decisionOutputBeforeCleanup)],
      },
      counts: {
        applied: 1,
      },
    });
    const locationTraceBlocked = runFoundry([
      "dataset-mutation-manifest",
      "--type",
      "process",
      "--profile",
      "bafu",
      "--rows-file",
      rel(fixture.rowsFile),
      "--schema-report",
      rel(fixture.schemaReport),
      "--curation-gate-report",
      rel(fixture.curationGateReport),
      "--cleanup-report",
      rel(fixture.cleanupReport),
      "--dry-run-report",
      rel(fixture.dryRunReport),
      "--location-decision-apply-report",
      rel(locationDecisionApplyReport),
      "--target-user-id",
      targetUserId,
      "--out-dir",
      rel(path.join(mutationFixtureRoot, "location-passed-manifest")),
    ]);
    assert.equal(locationTraceBlocked.code, 1);
    assert.equal(locationTraceBlocked.json.status, "blocked");
    assert.equal(locationTraceBlocked.json.evidence.patch_collect_required, false);
    assert.equal(locationTraceBlocked.json.counts.ai_location_decision_entries, 1);
    assert.equal(locationTraceBlocked.json.counts.ai_patch_evidence_entries, 0);
    assert.ok(
      itemBlockerCodes(locationTraceBlocked.json).has("unresolved_trace_patch_evidence_required"),
    );

    writeJsonLines(locationDecisionsFile, [
      {
        dataset_id: fixture.processId,
        dataset_version: "00.00.001",
        category_type: "location",
        code: "CH",
        target_path:
          "processDataSet.processInformation.geography.locationOfOperationSupplyOrProduction.@location",
        basis:
          "AI selected the location code from the full schema, methodology YAML, ruleset, classification schema, and location schema context.",
        authoring_context: locationDecisionTask.authoringContext,
        evidence: {
          source: "location-authoring-queue",
          quote_or_trace: "source geography Switzerland",
          used_context_kinds: fullContextKinds,
        },
      },
    ]);
    const locationStatusBlocked = runFoundry([
      "dataset-mutation-manifest",
      "--type",
      "process",
      "--profile",
      "bafu",
      "--rows-file",
      rel(fixture.rowsFile),
      "--schema-report",
      rel(fixture.schemaReport),
      "--curation-gate-report",
      rel(fixture.curationGateReport),
      "--cleanup-report",
      rel(fixture.cleanupReport),
      "--dry-run-report",
      rel(fixture.dryRunReport),
      "--location-decision-apply-report",
      rel(locationDecisionApplyReport),
      "--target-user-id",
      targetUserId,
      "--out-dir",
      rel(path.join(mutationFixtureRoot, "location-status-blocked-manifest")),
    ]);
    assert.equal(locationStatusBlocked.code, 1);
    assert.ok(
      scopeBlockerCodes(locationStatusBlocked.json).has(
        "full_context_ai_location_decision_status_not_completed",
      ),
    );

    writeJson(locationDecisionApplyReport, {
      schema_version: 1,
      status: "completed",
      decisions_file: rel(locationDecisionsFile),
      decision_task: {
        path: rel(locationDecisionTask.taskFile),
        sha256: locationDecisionTask.taskSha256,
        context_bundle_sha256: locationDecisionTask.contextBundleSha256,
      },
      files: {
        output_rows: [rel(decisionOutputBeforeCleanup)],
      },
      counts: {
        applied: 1,
      },
    });
    writeJsonLines(locationDecisionsFile, [
      {
        dataset_id: fixture.processId,
        dataset_version: "00.00.001",
        category_type: "location",
        decision_status: "completed",
        code: "CH",
        target_path:
          "processDataSet.processInformation.geography.locationOfOperationSupplyOrProduction.@location",
        basis:
          "AI selected the location code from the full schema, methodology YAML, ruleset, classification schema, and location schema context.",
        authoring_context: locationDecisionTask.authoringContext,
        evidence: {
          source: "location-authoring-queue",
          quote_or_trace: "source geography Switzerland",
          used_context_kinds: fullContextKinds,
        },
      },
    ]);
    const locationChainedThroughCleanup = runFoundry([
      "dataset-mutation-manifest",
      "--type",
      "process",
      "--profile",
      "bafu",
      "--rows-file",
      rel(fixture.rowsFile),
      "--schema-report",
      rel(fixture.schemaReport),
      "--curation-gate-report",
      rel(fixture.curationGateReport),
      "--cleanup-report",
      rel(fixture.cleanupReport),
      "--dry-run-report",
      rel(fixture.dryRunReport),
      "--location-decision-apply-report",
      rel(locationDecisionApplyReport),
      "--target-user-id",
      targetUserId,
      "--out-dir",
      rel(path.join(mutationFixtureRoot, "location-cleanup-chain")),
    ]);
    assert.equal(locationChainedThroughCleanup.code, 1);
    assert.equal(locationChainedThroughCleanup.json.status, "blocked");
    assert.equal(locationChainedThroughCleanup.json.evidence.patch_collect_required, false);
    assert.equal(locationChainedThroughCleanup.json.counts.ai_location_decision_entries, 1);
    assert.ok(
      itemBlockerCodes(locationChainedThroughCleanup.json).has(
        "unresolved_trace_patch_evidence_required",
      ),
    );

    const patchApplyInputRows = readJson(fixture.patchApplyReport).input_path;
    writeJson(classificationDecisionApplyReport, {
      schema_version: 1,
      status: "completed",
      decisions_file: rel(classificationDecisionsFile),
      decision_task: {
        path: rel(classificationDecisionTask.taskFile),
        sha256: classificationDecisionTask.taskSha256,
        context_bundle_sha256: classificationDecisionTask.contextBundleSha256,
      },
      files: {
        output_rows: [patchApplyInputRows],
      },
      counts: {
        applied: 1,
      },
    });
    writeJsonLines(classificationDecisionsFile, [
      {
        dataset_id: fixture.processId,
        dataset_version: "00.00.001",
        category_type: "process",
        decision_status: "completed",
        code: "1080",
        basis:
          "AI selected the process class before field patching, using the full schema, methodology YAML, ruleset, classification schema, and location schema context.",
        authoring_context: classificationDecisionTask.authoringContext,
        evidence: {
          source: "classification-authoring-queue",
          quote_or_trace: "process baseName Fixture process",
          used_context_kinds: fullContextKinds,
        },
      },
    ]);
    const classificationChainedThroughPatch = runFoundry([
      "dataset-mutation-manifest",
      "--type",
      "process",
      "--profile",
      "bafu",
      "--rows-file",
      rel(fixture.rowsFile),
      "--schema-report",
      rel(fixture.schemaReport),
      "--curation-gate-report",
      rel(fixture.curationGateReport),
      "--cleanup-report",
      rel(fixture.cleanupReport),
      "--dry-run-report",
      rel(fixture.dryRunReport),
      "--classification-decision-apply-report",
      rel(classificationDecisionApplyReport),
      "--patch-collect-report",
      rel(fixture.patchCollectReport),
      "--require-patch-collect-report",
      "--patch-apply-report",
      rel(fixture.patchApplyReport),
      "--target-user-id",
      targetUserId,
      "--out-dir",
      rel(path.join(mutationFixtureRoot, "classification-patch-chain")),
    ]);
    assert.equal(classificationChainedThroughPatch.code, 0);
    assert.equal(classificationChainedThroughPatch.json.status, "ready_for_remote_write");
    assert.equal(
      scopeBlockerCodes(classificationChainedThroughPatch.json).has(
        "full_context_ai_classification_rows_mismatch",
      ),
      false,
    );

    const patchApplyReportPayload = readJson(fixture.patchApplyReport);
    const patchApplyOutputRows = path.join(repoRoot, patchApplyReportPayload.out_path);
    const identityRewriteOutputRows = path.join(
      mutationFixtureRoot,
      "identity-reference-rewrites",
      "processes.identity-rewritten.jsonl",
    );
    writeJsonLines(identityRewriteOutputRows, readJsonLines(patchApplyOutputRows));
    const identityReferenceRewritesFile = path.join(
      mutationFixtureRoot,
      "identity-reference-rewrites",
      "identity-reference-rewrites.jsonl",
    );
    writeJsonLines(identityReferenceRewritesFile, [
      {
        dataset_type: "process",
        dataset_id: fixture.processId,
        dataset_version: "00.00.001",
        relation: "flow_reference_to_identity_preflight_duplicate",
        path: "processDataSet.exchanges.exchange.0.referenceToFlowDataSet",
        original: {
          ref_object_id: "fixture-original-flow",
          version: "00.00.001",
        },
        canonical: {
          ref_object_id: "fixture-canonical-flow",
          version: "00.00.001",
        },
        reason:
          "Fixture proves patch output was passed through identity reference rewrite before unresolved exchange externalization.",
      },
    ]);
    const externalizedRows = path.join(
      mutationFixtureRoot,
      "unresolved-exchange-externalization",
      "processes.externalized.jsonl",
    );
    writeJsonLines(externalizedRows, readJsonLines(identityRewriteOutputRows));
    const unresolvedExchangeTraces = path.join(
      mutationFixtureRoot,
      "unresolved-exchange-externalization",
      "unresolved-exchanges.jsonl",
    );
    writeJsonLines(unresolvedExchangeTraces, [
      {
        relation: "process_exchange_to_unresolved_elementary_flow_trace",
        action: "externalize_exchange_before_remote_write",
        dataset_type: "process",
        dataset_id: fixture.processId,
        dataset_version: "00.00.001",
        row_index: 0,
        exchange_index: 0,
      },
    ]);
    const unresolvedExchangeExternalizationReport = path.join(
      mutationFixtureRoot,
      "unresolved-exchange-externalization",
      "unresolved-exchange-externalization-report.json",
    );
    writeJson(unresolvedExchangeExternalizationReport, {
      schema_version: 1,
      status: "completed",
      input_rows_file: rel(identityRewriteOutputRows),
      output_rows_file: rel(externalizedRows),
      counts: {
        rows: 1,
        affected_rows: 1,
        externalized_exchanges: 1,
      },
      files: {
        report: rel(unresolvedExchangeExternalizationReport),
        output_rows: rel(externalizedRows),
        traces: rel(unresolvedExchangeTraces),
      },
    });
    const canonicalSupportAfterExternalizationRows = path.join(
      mutationFixtureRoot,
      "canonical-support-after-externalization",
      "processes.canonical-support-rewritten.jsonl",
    );
    writeJsonLines(canonicalSupportAfterExternalizationRows, readJsonLines(externalizedRows));
    const canonicalSupportAfterExternalizationRewrites = path.join(
      mutationFixtureRoot,
      "canonical-support-after-externalization",
      "canonical-support-rewrites.jsonl",
    );
    const canonicalSupportAfterExternalizationBlockers = path.join(
      mutationFixtureRoot,
      "canonical-support-after-externalization",
      "canonical-support-blockers.jsonl",
    );
    writeJsonLines(canonicalSupportAfterExternalizationRewrites, []);
    writeJsonLines(canonicalSupportAfterExternalizationBlockers, []);
    const canonicalSupportAfterExternalizationReport = path.join(
      mutationFixtureRoot,
      "canonical-support-after-externalization",
      "canonical-support-rewrite-report.json",
    );
    writeJson(canonicalSupportAfterExternalizationReport, {
      schema_version: 1,
      status: "completed_no_rewrites",
      dataset_type: "process",
      rows_file: rel(externalizedRows),
      output_rows_file: rel(canonicalSupportAfterExternalizationRows),
      counts: {
        rows: 1,
        blockers: 0,
        canonical_flow_property_reference_rewrites: 0,
        canonical_unit_group_reference_proofs: 0,
      },
      files: {
        report: rel(canonicalSupportAfterExternalizationReport),
        input_rows: rel(externalizedRows),
        output_rows: rel(canonicalSupportAfterExternalizationRows),
        canonical_support_rewrites: rel(canonicalSupportAfterExternalizationRewrites),
        canonical_support_blockers: rel(canonicalSupportAfterExternalizationBlockers),
      },
    });
    const cleanupAfterExternalizationReport = path.join(
      mutationFixtureRoot,
      "cleanup",
      "dataset-curation-cleanup-after-externalization-report.json",
    );
    writeJson(cleanupAfterExternalizationReport, {
      schema_version: 2,
      status: "completed",
      dataset_type: "process",
      rows_file: rel(canonicalSupportAfterExternalizationRows),
      cleaned_rows_file: rel(fixture.rowsFile),
      files: {
        cleaned_rows: rel(fixture.rowsFile),
      },
    });
    const classificationChainedThroughPatchIdentityAndExternalization = runFoundry([
      "dataset-mutation-manifest",
      "--type",
      "process",
      "--profile",
      "bafu",
      "--rows-file",
      rel(fixture.rowsFile),
      "--schema-report",
      rel(fixture.schemaReport),
      "--curation-gate-report",
      rel(fixture.curationGateReport),
      "--cleanup-report",
      rel(cleanupAfterExternalizationReport),
      "--dry-run-report",
      rel(fixture.dryRunReport),
      "--classification-decision-apply-report",
      rel(classificationDecisionApplyReport),
      "--patch-collect-report",
      rel(fixture.patchCollectReport),
      "--require-patch-collect-report",
      "--patch-apply-report",
      rel(fixture.patchApplyReport),
      "--identity-reference-rewrite-status",
      "completed",
      "--identity-reference-rewrite-input-rows",
      rel(patchApplyOutputRows),
      "--identity-reference-rewrite-output-rows",
      rel(identityRewriteOutputRows),
      "--identity-reference-rewrites",
      rel(identityReferenceRewritesFile),
      "--unresolved-exchange-externalization-report",
      rel(unresolvedExchangeExternalizationReport),
      "--canonical-support-rewrite-report",
      rel(canonicalSupportAfterExternalizationReport),
      "--target-user-id",
      targetUserId,
      "--out-dir",
      rel(path.join(mutationFixtureRoot, "classification-patch-identity-externalization-chain")),
    ]);
    assert.equal(classificationChainedThroughPatchIdentityAndExternalization.code, 0);
    assert.equal(
      classificationChainedThroughPatchIdentityAndExternalization.json.status,
      "ready_for_remote_write",
    );
    assert.equal(
      scopeBlockerCodes(classificationChainedThroughPatchIdentityAndExternalization.json).has(
        "patch_apply_cleanup_input_mismatch",
      ),
      false,
    );
    assert.equal(
      scopeBlockerCodes(classificationChainedThroughPatchIdentityAndExternalization.json).has(
        "full_context_ai_classification_rows_mismatch",
      ),
      false,
    );
    assert.equal(
      classificationChainedThroughPatchIdentityAndExternalization.json.evidence
        .unresolved_exchange_externalization_status,
      "completed",
    );
    assert.equal(
      classificationChainedThroughPatchIdentityAndExternalization.json.counts
        .unresolved_exchange_externalized,
      1,
    );

    writeJsonLines(classificationDecisionsFile, [
      {
        dataset_id: fixture.processId,
        dataset_version: "00.00.001",
        category_type: "process",
        code: "1080",
        basis: "Context is intentionally incomplete.",
        evidence: {
          source: "classification-authoring-queue",
          quote_or_trace: "process baseName Fixture process",
          used_context_kinds: ["schema"],
        },
      },
    ]);
    const missingClassificationContext = runFoundry([
      "dataset-mutation-manifest",
      "--type",
      "process",
      "--profile",
      "bafu",
      "--rows-file",
      rel(fixture.rowsFile),
      "--schema-report",
      rel(fixture.schemaReport),
      "--curation-gate-report",
      rel(fixture.curationGateReport),
      "--cleanup-report",
      rel(fixture.cleanupReport),
      "--dry-run-report",
      rel(fixture.dryRunReport),
      "--classification-decision-apply-report",
      rel(classificationDecisionApplyReport),
      "--target-user-id",
      targetUserId,
      "--out-dir",
      rel(path.join(mutationFixtureRoot, "classification-context-blocked-manifest")),
    ]);
    assert.equal(missingClassificationContext.code, 1);
    assert.ok(
      itemBlockerCodes(missingClassificationContext.json).has(
        "full_context_ai_classification_context_missing",
      ),
    );

    writeJsonLines(locationDecisionsFile, [
      {
        dataset_id: fixture.processId,
        dataset_version: "00.00.001",
        category_type: "location",
        code: "CH",
        target_path:
          "processDataSet.processInformation.geography.locationOfOperationSupplyOrProduction.@location",
        basis: "Context is intentionally incomplete.",
        evidence: {
          source: "location-authoring-queue",
          quote_or_trace: "source geography Switzerland",
          used_context_kinds: ["schema"],
        },
      },
    ]);
    const missingLocationContext = runFoundry([
      "dataset-mutation-manifest",
      "--type",
      "process",
      "--profile",
      "bafu",
      "--rows-file",
      rel(fixture.rowsFile),
      "--schema-report",
      rel(fixture.schemaReport),
      "--curation-gate-report",
      rel(fixture.curationGateReport),
      "--cleanup-report",
      rel(fixture.cleanupReport),
      "--dry-run-report",
      rel(fixture.dryRunReport),
      "--location-decision-apply-report",
      rel(locationDecisionApplyReport),
      "--target-user-id",
      targetUserId,
      "--out-dir",
      rel(path.join(mutationFixtureRoot, "location-context-blocked-manifest")),
    ]);
    assert.equal(missingLocationContext.code, 1);
    assert.ok(
      itemBlockerCodes(missingLocationContext.json).has("full_context_ai_location_context_missing"),
    );

    const passed = runFoundry([
      "dataset-mutation-manifest",
      "--type",
      "process",
      "--profile",
      "bafu",
      "--rows-file",
      rel(fixture.rowsFile),
      "--schema-report",
      rel(fixture.schemaReport),
      "--curation-gate-report",
      rel(fixture.curationGateReport),
      "--cleanup-report",
      rel(fixture.cleanupReport),
      "--dry-run-report",
      rel(fixture.dryRunReport),
      "--patch-collect-report",
      rel(fixture.patchCollectReport),
      "--require-patch-collect-report",
      "--patch-apply-report",
      rel(fixture.patchApplyReport),
      "--target-user-id",
      targetUserId,
      "--out-dir",
      rel(path.join(mutationFixtureRoot, "passed-manifest")),
    ]);
    assert.equal(passed.code, 0);
    assert.equal(passed.json.status, "ready_for_remote_write");
    assert.equal(passed.json.counts.ai_patch_evidence_entries, 1);
    assert.equal(passed.json.counts.unresolved_trace_entries, 1);
    assert.equal(passed.json.counts.source_reference_rewrites, 1);
    assert.equal(passed.json.items[0].blockers.length, 0);
    assert.equal(passed.json.items[0].source_reference_rewrite_count, 1);

    const traceRows = readJsonLines(path.join(repoRoot, passed.json.files.unresolved_traces));
    assert.equal(traceRows.length, 1);
    assert.equal(traceRows[0].entity_id, fixture.processId);
    assert.equal(traceRows[0].action_item_code, "source_system_boilerplate");
    assert.equal(traceRows[0].status, "unresolved_deferred");
    assert.equal(
      traceRows[0].evidence.quote_or_trace,
      "source_row.processDataSet.processInformation.dataSetInformation.generalComment absent",
    );
    const rewriteRows = readJsonLines(
      path.join(repoRoot, passed.json.files.source_reference_rewrites),
    );
    assert.equal(rewriteRows.length, 1);
    assert.equal(rewriteRows[0].dataset_id, fixture.processId);
    assert.equal(rewriteRows[0].relation, "dataset_format_source");
    assert.equal(rewriteRows[0].canonical.ref_object_id, "a97a0155-0234-4b87-b4ce-a45da52f2a40");
    assert.equal(rewriteRows[0].action, "rewrite_to_canonical_source_reference");

    const manifest = readJson(path.join(repoRoot, passed.json.files.report));
    assert.equal(manifest.evidence.full_context_ai_completion_required, true);
    assert.equal(manifest.evidence.patch_collect_status, "ready_for_patch_apply");
    assert.equal(manifest.evidence.patch_apply_status, "completed");
    assert.equal(manifest.counts.source_reference_rewrites, 1);
    assert.equal(
      manifest.files.source_reference_rewrites,
      passed.json.files.source_reference_rewrites,
    );
  } finally {
    fs.rmSync(mutationFixtureRoot, { recursive: true, force: true });
  }
});

import test from "node:test";
import { fixtureRoot } from "../fixtures/fixture-roots.mjs";
import {
  assert,
  blockerCodes,
  fs,
  fullContextKinds,
  path,
  readJson,
  readJsonLines,
  rel,
  repoRoot,
  runFoundry,
  sha256Text,
  targetUserId,
  writeJson,
  writeJsonLines,
  writeText,
} from "../fixtures/foundry-core.mjs";
import { createFixture } from "../fixtures/full-context-fixtures.mjs";
import { assertFoundryCommandSpecArtifactsCurrent } from "../../scripts/lib/foundry-command-spec.ts";

test("full-context import completion gates block missing proof and pass evidenced BAFU scopes", () => {
  const fixture = createFixture();
  try {
    const blockedCloseout = runFoundry([
      "dataset-post-write-closeout",
      "--handoff-plan",
      rel(fixture.handoffMissingProof),
      "--commit-report",
      rel(fixture.commitReport),
      "--post-write-verify-report",
      rel(fixture.verifyReport),
      "--out-dir",
      rel(path.join(fixtureRoot, "blocked-closeout")),
    ]);
    assert.equal(blockedCloseout.code, 1);
    assert.equal(blockedCloseout.json.status, "blocked");
    assert.ok(
      blockerCodes(blockedCloseout.json).has(
        "post_write_closeout_full_context_mutation_proof_missing",
      ),
    );

    const blockedCompletion = runFoundry([
      "dataset-import-completion-report",
      "--closeout-report",
      rel(fixture.oldCloseoutMissingProof),
      "--require-type",
      "process",
      "--out-dir",
      rel(path.join(fixtureRoot, "blocked-completion")),
    ]);
    assert.equal(blockedCompletion.code, 1);
    assert.equal(blockedCompletion.json.status, "blocked");
    assert.ok(
      blockerCodes(blockedCompletion.json).has("closeout_full_context_mutation_proof_missing"),
    );

    const commitReportRowsMismatch = path.join(fixtureRoot, "commit-report-rows-mismatch.json");
    writeJson(commitReportRowsMismatch, {
      ...readJson(fixture.commitReport),
      input_path: rel(path.join(fixtureRoot, "other-processes.jsonl")),
    });
    const blockedCommitRowsMismatch = runFoundry([
      "dataset-post-write-closeout",
      "--handoff-plan",
      rel(fixture.handoffWithProof),
      "--commit-report",
      rel(commitReportRowsMismatch),
      "--post-write-verify-report",
      rel(fixture.verifyReport),
      "--out-dir",
      rel(path.join(fixtureRoot, "blocked-commit-rows-mismatch")),
    ]);
    assert.equal(blockedCommitRowsMismatch.code, 1);
    assert.equal(blockedCommitRowsMismatch.json.status, "blocked");
    assert.ok(blockerCodes(blockedCommitRowsMismatch.json).has("commit_report_input_mismatch"));

    const verifyReportRowsMismatch = path.join(fixtureRoot, "verify-report-rows-mismatch.json");
    writeJson(verifyReportRowsMismatch, {
      ...readJson(fixture.verifyReport),
      input_path: rel(path.join(fixtureRoot, "other-processes.jsonl")),
    });
    const blockedVerifyRowsMismatch = runFoundry([
      "dataset-post-write-closeout",
      "--handoff-plan",
      rel(fixture.handoffWithProof),
      "--commit-report",
      rel(fixture.commitReport),
      "--post-write-verify-report",
      rel(verifyReportRowsMismatch),
      "--out-dir",
      rel(path.join(fixtureRoot, "blocked-verify-rows-mismatch")),
    ]);
    assert.equal(blockedVerifyRowsMismatch.code, 1);
    assert.equal(blockedVerifyRowsMismatch.json.status, "blocked");
    assert.ok(blockerCodes(blockedVerifyRowsMismatch.json).has("post_write_verify_input_mismatch"));

    const originalPatchApplyReport = readJson(fixture.patchApplyReport);
    writeJson(fixture.patchApplyReport, {
      ...originalPatchApplyReport,
      status: "failed",
    });
    const blockedHandoffStaleAiProof = runFoundry([
      "dataset-commit-handoff-plan",
      "--type",
      "process",
      "--finalize-report",
      rel(fixture.finalizeReport),
      "--mutation-manifest",
      rel(fixture.mutationWithProof),
      "--target-user-id",
      targetUserId,
      "--state-code",
      "0",
      "--out-dir",
      rel(path.join(fixtureRoot, "blocked-handoff-stale-ai-proof")),
    ]);
    assert.equal(blockedHandoffStaleAiProof.code, 1);
    assert.equal(blockedHandoffStaleAiProof.json.status, "blocked");
    assert.ok(
      blockerCodes(blockedHandoffStaleAiProof.json).has(
        "commit_handoff_full_context_patch_apply_not_completed",
      ),
    );

    const blockedCloseoutStaleAiProof = runFoundry([
      "dataset-post-write-closeout",
      "--handoff-plan",
      rel(fixture.handoffWithProof),
      "--commit-report",
      rel(fixture.commitReport),
      "--post-write-verify-report",
      rel(fixture.verifyReport),
      "--out-dir",
      rel(path.join(fixtureRoot, "blocked-closeout-stale-ai-proof")),
    ]);
    assert.equal(blockedCloseoutStaleAiProof.code, 1);
    assert.equal(blockedCloseoutStaleAiProof.json.status, "blocked");
    assert.ok(
      blockerCodes(blockedCloseoutStaleAiProof.json).has(
        "post_write_closeout_full_context_patch_apply_not_completed",
      ),
    );
    writeJson(fixture.patchApplyReport, originalPatchApplyReport);

    const originalPatchEvidenceRows = readJsonLines(fixture.patchEvidenceFile);
    writeJsonLines(fixture.patchEvidenceFile, [
      {
        ...originalPatchEvidenceRows[0],
        resolution: {
          mode: "evidence_backed_completion",
          used_context_kinds: ["schema"],
        },
      },
    ]);
    const blockedHandoffMissingPatchContext = runFoundry([
      "dataset-commit-handoff-plan",
      "--type",
      "process",
      "--finalize-report",
      rel(fixture.finalizeReport),
      "--mutation-manifest",
      rel(fixture.mutationWithProof),
      "--target-user-id",
      targetUserId,
      "--state-code",
      "0",
      "--out-dir",
      rel(path.join(fixtureRoot, "blocked-handoff-patch-context")),
    ]);
    assert.equal(blockedHandoffMissingPatchContext.code, 1);
    assert.equal(blockedHandoffMissingPatchContext.json.status, "blocked");
    assert.ok(
      blockerCodes(blockedHandoffMissingPatchContext.json).has(
        "commit_handoff_full_context_patch_resolution_context_missing",
      ),
    );
    writeJsonLines(fixture.patchEvidenceFile, originalPatchEvidenceRows);

    writeJsonLines(fixture.patchEvidenceFile, [
      {
        ...originalPatchEvidenceRows[0],
        authoring_package_sha256: "not-a-known-authoring-package-sha256",
      },
    ]);
    const blockedHandoffUnknownPackageHash = runFoundry([
      "dataset-commit-handoff-plan",
      "--type",
      "process",
      "--finalize-report",
      rel(fixture.finalizeReport),
      "--mutation-manifest",
      rel(fixture.mutationWithProof),
      "--target-user-id",
      targetUserId,
      "--state-code",
      "0",
      "--out-dir",
      rel(path.join(fixtureRoot, "blocked-handoff-package-hash")),
    ]);
    assert.equal(blockedHandoffUnknownPackageHash.code, 1);
    assert.equal(blockedHandoffUnknownPackageHash.json.status, "blocked");
    assert.ok(
      blockerCodes(blockedHandoffUnknownPackageHash.json).has(
        "commit_handoff_full_context_patch_package_hash_unknown",
      ),
    );
    writeJsonLines(fixture.patchEvidenceFile, originalPatchEvidenceRows);

    const passedCloseout = runFoundry([
      "dataset-post-write-closeout",
      "--handoff-plan",
      rel(fixture.handoffWithProof),
      "--commit-report",
      rel(fixture.commitReport),
      "--post-write-verify-report",
      rel(fixture.verifyReport),
      "--out-dir",
      rel(path.join(fixtureRoot, "passed-closeout")),
    ]);
    assert.equal(passedCloseout.code, 0);
    assert.equal(passedCloseout.json.status, "completed");
    assert.equal(passedCloseout.json.counts.full_context_ai_completion_required, true);
    assert.equal(passedCloseout.json.counts.ai_patch_evidence_entries, 1);

    const supportCloseoutReport = path.join(fixtureRoot, "support-closeout-report.json");
    const supportFinalizeReport = path.join(fixtureRoot, "support-finalize-ready.json");
    writeJson(supportFinalizeReport, {
      ...readJson(fixture.finalizeReport),
      dataset_type: "support",
    });
    const supportMutationReport = path.join(fixtureRoot, "support-mutation-ready.json");
    writeJson(supportMutationReport, {
      ...readJson(fixture.mutationWithProof),
      dataset_type: "support",
    });
    writeJson(supportCloseoutReport, {
      ...passedCloseout.json,
      dataset_type: "support",
      finalize_report: rel(supportFinalizeReport),
      mutation_manifest: rel(supportMutationReport),
      counts: {
        ...passedCloseout.json.counts,
        full_context_ai_completion_required: true,
        ai_patch_evidence_entries: 1,
      },
    });

    const supportCompletion = runFoundry([
      "dataset-import-completion-report",
      "--closeout-report",
      rel(path.join(fixtureRoot, "passed-closeout", "dataset-post-write-closeout-report.json")),
      "--closeout-report",
      rel(supportCloseoutReport),
      "--require-type",
      "process",
      "--require-type",
      "support",
      "--out-dir",
      rel(path.join(fixtureRoot, "support-completion")),
    ]);
    assert.equal(supportCompletion.code, 0);
    assert.equal(supportCompletion.json.status, "completed");
    assert.deepEqual(
      new Set(supportCompletion.json.dataset_types),
      new Set(["process", "support"]),
    );
    assert.equal(supportCompletion.json.counts.full_context_scopes, 2);

    const passedCompletion = runFoundry([
      "dataset-import-completion-report",
      "--closeout-report",
      rel(path.join(fixtureRoot, "passed-closeout", "dataset-post-write-closeout-report.json")),
      "--require-type",
      "process",
      "--task-id",
      "full-context-gate-test",
      "--out-dir",
      rel(path.join(fixtureRoot, "passed-completion")),
    ]);
    assert.equal(passedCompletion.code, 0);
    assert.equal(passedCompletion.json.status, "completed");
    assert.equal(passedCompletion.json.counts.full_context_scopes, 1);

    const taskId = "full-context-gate-test";
    const activeTask = path.join(repoRoot, "tasks", "active", `${taskId}.md`);
    writeText(
      activeTask,
      `---\nid: ${taskId}\ntitle: Full context gate test\nstate: Active\nkind: external-dataset-curated-import\ndataset_type: process\nprofile: bafu\npriority: P1\nallow_remote_commit: true\n---\n\n## Goal\n\nTest fixture.\n`,
    );
    const taskComplete = runFoundry([
      "task-complete",
      "--task",
      taskId,
      "--completion-report",
      rel(path.join(fixtureRoot, "passed-completion", "dataset-import-completion-report.json")),
    ]);
    assert.equal(taskComplete.code, 0);
    assert.equal(taskComplete.json.status, "completed");
    assert.equal(fs.existsSync(path.join(repoRoot, "tasks", "done", `${taskId}.md`)), true);
  } finally {
    fs.rmSync(path.join(repoRoot, "tasks", "active", "full-context-gate-test.md"), { force: true });
    fs.rmSync(path.join(repoRoot, "tasks", "done", "full-context-gate-test.md"), { force: true });
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("post-write closeout requires common:other trace queues to match final rows", () => {
  const root = path.join(fixtureRoot, "trace-queue-coverage");
  fs.rmSync(root, { recursive: true, force: true });
  fs.mkdirSync(root, { recursive: true });
  const processId = "11111111-2222-3333-8444-555555555555";
  const traceEntry = {
    status: "unresolved_deferred",
    action_item_code: "annual_supply_or_production_volume_invalid",
    blocked_path:
      "processDataSet.modellingAndValidation.dataSourcesTreatmentAndRepresentativeness.annualSupplyOrProductionVolume",
    reason: "No annualized source evidence is present in the source row.",
    evidence: {
      source: "source-row",
      quote_or_trace: "source row has process name and unit, but no annual production quantity",
    },
    next_action: "Review original report or database documentation for annual production volume.",
  };
  const rowsFile = path.join(root, "processes.jsonl");
  writeJsonLines(rowsFile, [
    {
      processDataSet: {
        processInformation: {
          dataSetInformation: {
            "common:UUID": processId,
            "common:other": {
              "tiangongfoundry:unresolvedTrace": [traceEntry],
            },
          },
        },
        administrativeInformation: {
          publicationAndOwnership: {
            "common:dataSetVersion": "00.00.001",
          },
        },
      },
    },
  ]);
  const checksFile = path.join(root, "remote-verification.jsonl");
  const rowPayloadSha256 = sha256Text(JSON.stringify(readJsonLines(rowsFile)[0]));
  writeJsonLines(checksFile, [
    {
      role: "root",
      table: "processes",
      id: processId,
      version: "00.00.001",
      path: "processes/0#readback",
      status: "ok",
      local_payload_sha256: rowPayloadSha256,
      remote_payload_sha256: rowPayloadSha256,
      remote_user_id: targetUserId,
      remote_state_code: 0,
      row_index: 0,
    },
  ]);
  const commitReport = path.join(root, "commit-report.json");
  writeJson(commitReport, {
    status: "completed",
    mode: "commit",
    commit: true,
    input_path: rel(rowsFile),
    counts: { selected: 1, executed: 1, failed: 0 },
  });
  const verifyReport = path.join(root, "remote-verification-report.json");
  writeJson(verifyReport, {
    status: "passed_remote_verification",
    input_path: rel(rowsFile),
    blockers: [],
    counts: {
      blockers: 0,
      root_readback_checks: 1,
      root_payload_mismatches: 0,
    },
    files: { checks: rel(checksFile) },
  });
  const finalizeReport = path.join(root, "finalize-ready.json");
  writeJson(finalizeReport, {
    status: "ready_for_remote_write",
    dataset_type: "process",
    profile: "bafu",
    files: { final_rows: rel(rowsFile) },
    counts: { blockers: 0, unresolved_trace_entries: 1 },
  });
  const unresolvedQueue = path.join(root, "unresolved-traces.jsonl");
  writeJsonLines(unresolvedQueue, [
    {
      dataset_type: "process",
      entity_id: processId,
      version: "00.00.001",
      row_index: 0,
      trace_kind: "unresolved_trace",
      path: "$.processDataSet.processInformation.dataSetInformation.common:other.tiangongfoundry:unresolvedTrace[0]",
      status: "unresolved_deferred",
      action_item_code: "wrong_action_item",
      blocked_path: traceEntry.blocked_path,
      reason: traceEntry.reason,
      next_action: traceEntry.next_action,
      evidence: traceEntry.evidence,
      trace_sha256: sha256Text(JSON.stringify(traceEntry)),
    },
  ]);
  const sourceExchangeQueue = path.join(root, "source-exchange-completeness-traces.jsonl");
  writeJsonLines(sourceExchangeQueue, []);
  const patchCollectReport = path.join(root, "patch-collect-ready.json");
  const authoringPackage = path.join(root, "authoring-package.json");
  writeJson(authoringPackage, {
    schema_version: 2,
    profile: "bafu",
    dataset_type: "process",
    entity_id: processId,
    version: "00.00.001",
    contract_context_files: fullContextKinds.map((kind) => ({
      kind,
      path: `${kind}.fixture`,
      text: `${kind} context`,
    })),
    missing_context_files: [],
  });
  const authoringPackageSha256 = sha256Text(fs.readFileSync(authoringPackage, "utf8"));
  const taskManifest = path.join(root, "authoring-task-manifest.json");
  writeJson(taskManifest, {
    schema_version: 1,
    status: "ready_for_ai_authoring_batch",
    tasks: [
      {
        files: {
          authoring_package: rel(authoringPackage),
        },
        context: {
          authoring_package_sha256: authoringPackageSha256,
        },
      },
    ],
  });
  writeJson(patchCollectReport, {
    status: "ready_for_patch_apply",
    task_manifest: rel(taskManifest),
  });
  const patchEvidenceFile = path.join(root, "patch-evidence.jsonl");
  writeJsonLines(patchEvidenceFile, [
    {
      dataset_id: processId,
      dataset_version: "00.00.001",
      authoring_package_sha256: authoringPackageSha256,
      closes_action_items: [traceEntry.action_item_code],
      resolution: {
        mode: "deferred_to_common_other",
        used_context_kinds: fullContextKinds,
      },
      evidence: traceEntry.evidence,
    },
  ]);
  const patchApplyReport = path.join(root, "patch-apply-completed.json");
  writeJson(patchApplyReport, {
    status: "completed",
    files: {
      patch_evidence: rel(patchEvidenceFile),
    },
  });
  const mutationReport = path.join(root, "mutation-ready.json");
  writeJson(mutationReport, {
    status: "ready_for_remote_write",
    dataset_type: "process",
    profile: "bafu",
    rows_file: rel(rowsFile),
    target_user_id: targetUserId,
    evidence: {
      full_context_ai_completion_required: true,
      full_context_ai_completion_proof:
        "schema/methodology_yaml/ruleset/classification_schema/location_schema authoring package plus AI patch evidence",
      patch_collect_report: rel(patchCollectReport),
      patch_collect_status: "ready_for_patch_apply",
      patch_apply_report: rel(patchApplyReport),
      patch_apply_status: "completed",
      patch_evidence_file: rel(patchEvidenceFile),
    },
    counts: {
      blockers: 0,
      write_candidates: 1,
      unresolved_trace_entries: 1,
      source_exchange_completeness_entries: 0,
      ai_patch_evidence_entries: 1,
    },
    files: {
      unresolved_traces: rel(unresolvedQueue),
      source_exchange_completeness_traces: rel(sourceExchangeQueue),
    },
  });
  writeJson(finalizeReport, {
    status: "ready_for_remote_write",
    dataset_type: "process",
    profile: "bafu",
    target_user_id: targetUserId,
    files: {
      final_rows: rel(rowsFile),
      mutation_manifest: rel(mutationReport),
      unresolved_traces: rel(unresolvedQueue),
      source_exchange_completeness_traces: rel(sourceExchangeQueue),
    },
    counts: {
      blockers: 0,
      location_audit_blockers: 0,
      write_candidates: 1,
      unresolved_trace_entries: 1,
      source_exchange_completeness_entries: 0,
    },
  });
  const handoffReport = path.join(root, "handoff-ready.json");
  writeJson(handoffReport, {
    status: "ready_for_explicit_commit",
    dataset_type: "process",
    profile: "bafu",
    finalize_report: rel(finalizeReport),
    mutation_manifest: rel(mutationReport),
    final_rows_file: rel(rowsFile),
    final_rows_artifact: {
      path: rel(rowsFile),
      bytes: fs.readFileSync(rowsFile).byteLength,
      sha256: sha256Text(fs.readFileSync(rowsFile)),
    },
    target_user_id: targetUserId,
    expected_state_code: "0",
    counts: {
      blockers: 0,
      write_candidates: 1,
      unresolved_trace_entries: 1,
      source_exchange_completeness_entries: 0,
    },
    files: {
      trace_queues: {
        unresolved_traces: rel(unresolvedQueue),
        source_exchange_completeness_traces: rel(sourceExchangeQueue),
      },
    },
  });

  try {
    const blockedHandoff = runFoundry([
      "dataset-commit-handoff-plan",
      "--finalize-report",
      rel(finalizeReport),
      "--state-code",
      "0",
      "--out-dir",
      rel(path.join(root, "blocked-handoff")),
    ]);
    assert.equal(blockedHandoff.code, 1);
    assert.equal(blockedHandoff.json.status, "blocked");
    assert.ok(blockerCodes(blockedHandoff.json).has("trace_queue_final_rows_entry_missing"));
    assert.ok(blockerCodes(blockedHandoff.json).has("trace_queue_stale_or_extra_entry"));

    const blocked = runFoundry([
      "dataset-post-write-closeout",
      "--handoff-plan",
      rel(handoffReport),
      "--commit-report",
      rel(commitReport),
      "--post-write-verify-report",
      rel(verifyReport),
      "--out-dir",
      rel(path.join(root, "blocked-closeout")),
    ]);
    assert.equal(blocked.code, 1);
    assert.equal(blocked.json.status, "blocked");
    assert.ok(blockerCodes(blocked.json).has("trace_queue_final_rows_entry_missing"));
    assert.ok(blockerCodes(blocked.json).has("trace_queue_stale_or_extra_entry"));

    writeJsonLines(unresolvedQueue, [
      {
        dataset_type: "process",
        entity_id: processId,
        version: "00.00.001",
        row_index: 0,
        trace_kind: "unresolved_trace",
        path: "$.processDataSet.processInformation.dataSetInformation.common:other.tiangongfoundry:unresolvedTrace[0]",
        status: "unresolved_deferred",
        action_item_code: traceEntry.action_item_code,
        blocked_path: traceEntry.blocked_path,
        reason: traceEntry.reason,
        next_action: traceEntry.next_action,
        evidence: traceEntry.evidence,
        trace_sha256: sha256Text(JSON.stringify(traceEntry)),
      },
    ]);

    const passed = runFoundry([
      "dataset-commit-handoff-plan",
      "--finalize-report",
      rel(finalizeReport),
      "--state-code",
      "0",
      "--out-dir",
      rel(path.join(root, "passed-handoff")),
    ]);
    assert.equal(passed.code, 0);
    assert.equal(passed.json.status, "ready_for_explicit_commit");
    assert.equal(passed.json.counts.unresolved_trace_entries, 1);

    const passedCloseout = runFoundry([
      "dataset-post-write-closeout",
      "--handoff-plan",
      rel(handoffReport),
      "--commit-report",
      rel(commitReport),
      "--post-write-verify-report",
      rel(verifyReport),
      "--out-dir",
      rel(path.join(root, "passed-closeout")),
    ]);
    assert.equal(passedCloseout.code, 0);
    assert.equal(passedCloseout.json.status, "completed");
    assert.equal(passedCloseout.json.counts.unresolved_trace_entries, 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("commit handoff blocks nonzero location audit blockers", () => {
  const fixture = createFixture();
  try {
    const finalizeWithLocationBlockers = path.join(fixtureRoot, "finalize-location-blocked.json");
    writeJson(finalizeWithLocationBlockers, {
      ...readJson(fixture.finalizeReport),
      files: {
        final_rows: rel(fixture.rowsFile),
        mutation_manifest: rel(fixture.mutationWithProof),
      },
      counts: {
        blockers: 0,
        location_audit_blockers: 1,
      },
    });

    const handoff = runFoundry([
      "dataset-commit-handoff-plan",
      "--finalize-report",
      rel(finalizeWithLocationBlockers),
      "--state-code",
      "0",
      "--out-dir",
      rel(path.join(fixtureRoot, "handoff-location-blocked")),
    ]);
    assert.equal(handoff.code, 1);
    assert.equal(handoff.json.status, "blocked");
    assert.ok(blockerCodes(handoff.json).has("location_audit_blockers_present"));
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("flow commit handoff includes target user id on publish-version command", () => {
  const root = path.join(fixtureRoot, "flow-commit-handoff-target-user");
  fs.rmSync(root, { recursive: true, force: true });
  const rowsFile = path.join(root, "flows.jsonl");
  writeJsonLines(rowsFile, [
    {
      flowDataSet: {
        flowInformation: {
          dataSetInformation: {
            "common:UUID": "f1111111-1111-4111-8111-111111111111",
            "common:dataSetVersion": "00.00.001",
          },
        },
      },
    },
  ]);
  const mutationReport = path.join(root, "dataset-mutation-manifest.json");
  writeJson(mutationReport, {
    status: "ready_for_remote_write",
    dataset_type: "flow",
    profile: "generic",
    target_user_id: targetUserId,
    counts: {
      blockers: 0,
      write_candidates: 1,
      unresolved_trace_entries: 0,
      source_exchange_completeness_entries: 0,
      source_reference_rewrites: 0,
    },
    files: {},
  });
  const finalizeReport = path.join(root, "dataset-post-authoring-finalize-report.json");
  writeJson(finalizeReport, {
    status: "ready_for_remote_write",
    dataset_type: "flow",
    profile: "generic",
    target_user_id: targetUserId,
    files: {
      final_rows: rel(rowsFile),
      mutation_manifest: rel(mutationReport),
    },
    counts: {
      blockers: 0,
      location_audit_blockers: 0,
      write_candidates: 1,
      unresolved_trace_entries: 0,
      source_exchange_completeness_entries: 0,
      source_reference_rewrites: 0,
    },
  });

  try {
    const handoff = runFoundry([
      "dataset-commit-handoff-plan",
      "--finalize-report",
      rel(finalizeReport),
      "--state-code",
      "0",
      "--out-dir",
      rel(path.join(root, "handoff")),
    ]);
    assert.equal(handoff.code, 0, JSON.stringify(handoff.json, null, 2));
    assert.equal(handoff.json.status, "ready_for_explicit_commit");
    assert.equal(handoff.json.commands.commit.schema, "tiangong-foundry.command-spec.v1");
    assert.match(handoff.json.commands.commit.display, / flow publish-version /);
    assert.ok(handoff.json.commands.commit.argv.includes(targetUserId));
    assert.equal(handoff.json.commands.commit.argv.includes("--state-code"), false);
    assert.match(
      handoff.json.commands.post_write_verify.display,
      new RegExp(`--target-user-id ${targetUserId}`),
    );
    assert.match(handoff.json.commands.post_write_verify.display, /--state-code 0/);
    assert.deepEqual(handoff.json.final_rows_artifact, {
      path: rel(rowsFile),
      bytes: fs.readFileSync(rowsFile).byteLength,
      sha256: sha256Text(fs.readFileSync(rowsFile)),
    });
    assert.deepEqual(handoff.json.commands.commit.binding.artifacts, [
      { role: "final_rows", ...handoff.json.final_rows_artifact },
    ]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("process commit handoff defaults draft state code and records account guard", () => {
  const root = path.join(fixtureRoot, "process-commit-handoff-account-guard");
  fs.rmSync(root, { recursive: true, force: true });
  const rowsFile = path.join(root, "processes.jsonl");
  writeJsonLines(rowsFile, [
    {
      processDataSet: {
        processInformation: {
          dataSetInformation: {
            "common:UUID": "11111111-1111-4111-8111-111111111111",
          },
        },
        administrativeInformation: {
          publicationAndOwnership: {
            "common:dataSetVersion": "00.00.001",
          },
        },
      },
    },
  ]);
  const mutationReport = path.join(root, "dataset-mutation-manifest.json");
  writeJson(mutationReport, {
    status: "ready_for_remote_write",
    dataset_type: "process",
    profile: "generic",
    target_user_id: targetUserId,
    counts: {
      blockers: 0,
      write_candidates: 1,
      unresolved_trace_entries: 0,
      source_exchange_completeness_entries: 0,
      source_reference_rewrites: 0,
    },
    files: {},
  });
  const finalizeReport = path.join(root, "dataset-post-authoring-finalize-report.json");
  writeJson(finalizeReport, {
    status: "ready_for_remote_write",
    dataset_type: "process",
    profile: "generic",
    target_user_id: targetUserId,
    files: {
      final_rows: rel(rowsFile),
      mutation_manifest: rel(mutationReport),
    },
    counts: {
      blockers: 0,
      location_audit_blockers: 0,
      write_candidates: 1,
      unresolved_trace_entries: 0,
      source_exchange_completeness_entries: 0,
      source_reference_rewrites: 0,
    },
  });

  try {
    const handoff = runFoundry([
      "dataset-commit-handoff-plan",
      "--finalize-report",
      rel(finalizeReport),
      "--out-dir",
      rel(path.join(root, "handoff")),
    ]);
    assert.equal(handoff.code, 0, JSON.stringify(handoff.json, null, 2));
    assert.equal(handoff.json.status, "ready_for_explicit_commit");
    assert.equal(handoff.json.expected_state_code, "0");
    assert.equal(handoff.json.expected_state_code_source, "default_draft_write_state");
    assert.match(handoff.json.commands.commit.display, / process save-draft /);
    assert.ok(handoff.json.commands.commit.argv.includes(targetUserId));
    assert.equal(handoff.json.commands.commit.argv.includes("--state-code"), false);
    assert.match(
      handoff.json.commands.post_write_verify.display,
      new RegExp(`--target-user-id ${targetUserId}`),
    );
    assert.match(handoff.json.commands.post_write_verify.display, /--state-code 0/);
    assert.equal(handoff.json.account_write_guard.commit_command_supports_target_user_id, true);
    assert.equal(
      handoff.json.account_write_guard.commit_account_binding,
      "target_user_id_cli_argument",
    );
    assert.doesNotThrow(() =>
      assertFoundryCommandSpecArtifactsCurrent(handoff.json.commands.commit, (artifactPath) =>
        path.join(repoRoot, artifactPath),
      ),
    );
    fs.appendFileSync(rowsFile, '{"same_path":"drift"}\n');
    assert.throws(
      () =>
        assertFoundryCommandSpecArtifactsCurrent(handoff.json.commands.commit, (artifactPath) =>
          path.join(repoRoot, artifactPath),
        ),
      /artifact.*drift|bytes|sha-?256/iu,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

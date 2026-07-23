export const publicCommands = [
  "init",
  "doctor",
  "env-check",
  "workflow-check",
  "storage-check",
  "surface-audit",
  "acceptance-check",
  "workspace-map",
  "capabilities-list",
  "profiles-list",
  "route-task",
  "tasks-list",
  "tasks-check",
  "task-complete",
];

export const datasetPolicyCommands = [
  "execution-capsule-admit",
  "final-delivery-promote",
  "dataset-curation-queue-build",
  "dataset-curation-gate",
  "dataset-authoring-plan",
  "dataset-authoring-task-build",
  "dataset-authoring-patch-collect",
  "dataset-identity-decision-task-build",
  "dataset-classification-decision-task-build",
  "dataset-library-classification-decisions-project",
  "dataset-bafu-leaf-classification-tasks-prepare",
  "dataset-bafu-leaf-classification-category-map-project",
  "dataset-bafu-identity-decisions-autofill",
  "dataset-bafu-authoring-patches-autofill",
  "dataset-classification-decisions-apply",
  "dataset-location-decision-task-build",
  "dataset-location-decisions-suggest",
  "dataset-location-decisions-apply",
  "dataset-curation-cleanup",
  "dataset-patch-apply",
  "dataset-support-cache-refresh",
  "dataset-canonical-support-mappings-autofill",
  "dataset-bundle-sample-rows",
  "dataset-identity-preflight-requests-build",
  "dataset-identity-preflight-query-audit",
  "dataset-identity-preflight-run",
  "dataset-identity-preflight-index-merge",
  "dataset-library-index-build",
  "dataset-library-authoring-plan",
  "dataset-library-identity-decisions-from-preflight",
  "dataset-library-decisions-apply",
  "dataset-process-scope-run",
  "dataset-bafu-process-scope-e2e",
  "dataset-bafu-batch-import-run",
  "dataset-uslci-batch-import-run",
  "dataset-worldsteel-batch-import-run",
  "dataset-bafu-universe-coverage-report",
  "dataset-identity-reference-rewrites-apply",
  "dataset-identity-decisions-apply",
  "dataset-post-authoring-finalize",
  "dataset-commit-handoff-plan",
  "dataset-post-write-closeout",
  "dataset-import-completion-report",
  "dataset-import-ledger-report",
  "dataset-mutation-manifest",
];

export const knownCommands = [...publicCommands, ...datasetPolicyCommands];

export function usage() {
  return {
    public_commands: publicCommands,
    dataset_policy_commands: datasetPolicyCommands,
    commands: knownCommands,
    ownership_note:
      "Foundry public surface is task/profile/workspace/gate control. Foundry dataset commands are policy and artifact helpers only; durable conversion, queue state, validation, QA, database write/delete/redo, and readback behavior belongs in tiangong-lca CLI or checked-in skills.",
  };
}

function statusIs(result, allowed) {
  return allowed.includes(result?.status);
}

export function exitCodeForCommand(command, result) {
  switch (command) {
    case "doctor":
      return result?.workflow_check?.ok &&
        result?.storage_check?.ok &&
        result?.env_example_surface?.ok &&
        result?.surface_audit?.status === "passed"
        ? 0
        : 1;
    case "env-check":
      return result?.env_example_surface?.ok ? 0 : 1;
    case "workflow-check":
    case "storage-check":
    case "surface-audit":
    case "tasks-check":
      return result?.ok || result?.status === "passed" ? 0 : 1;
    case "acceptance-check":
      return result?.status === "passed" ? 0 : 1;
    case "route-task":
      return result?.status === "missing_capabilities" ? 1 : 0;
    case "task-complete":
      return statusIs(result, ["help", "ready", "completed"]) ? 0 : 1;
    case "dataset-curation-queue-build":
    case "dataset-patch-apply":
      return result?.foundry_wrapper?.exit_code ?? 1;
    case "execution-capsule-admit":
      return statusIs(result, ["help", "sealed"]) ? 0 : 1;
    case "final-delivery-promote":
      return statusIs(result, ["help", "promoted"]) ? 0 : 1;
    case "dataset-curation-gate":
      return statusIs(result, ["help", "ready", "ready_with_profile_waivers"]) ? 0 : 1;
    case "dataset-authoring-plan":
    case "dataset-library-index-build":
    case "dataset-curation-cleanup":
      return 0;
    case "dataset-library-authoring-plan":
      return statusIs(result, ["help", "ready_for_ai_library_decisions", "ready_no_action_items"])
        ? 0
        : 1;
    case "dataset-library-identity-decisions-from-preflight":
      return statusIs(result, ["help", "completed", "completed_with_manual_review"]) ? 0 : 1;
    case "dataset-authoring-task-build":
      return statusIs(result, [
        "help",
        "ready_for_ai_authoring",
        "ready_for_ai_authoring_batch",
        "ready_no_action_items",
      ])
        ? 0
        : 1;
    case "dataset-authoring-patch-collect":
      return statusIs(result, ["help", "ready_for_patch_apply"]) ? 0 : 1;
    case "dataset-identity-decision-task-build":
      return statusIs(result, [
        "help",
        "ready_for_ai_identity_decisions",
        "ready_no_identity_actions",
      ])
        ? 0
        : 1;
    case "dataset-classification-decision-task-build":
      return statusIs(result, [
        "help",
        "ready_for_ai_classification_decisions",
        "ready_no_classification_actions",
      ])
        ? 0
        : 1;
    case "dataset-classification-decisions-apply":
    case "dataset-library-classification-decisions-project":
    case "dataset-bafu-leaf-classification-tasks-prepare":
    case "dataset-bafu-leaf-classification-category-map-project":
    case "dataset-location-decisions-suggest":
    case "dataset-location-decisions-apply":
    case "dataset-bafu-identity-decisions-autofill":
    case "dataset-bafu-authoring-patches-autofill":
    case "dataset-identity-decisions-apply":
    case "dataset-library-decisions-apply":
    case "dataset-support-cache-refresh":
    case "dataset-canonical-support-mappings-autofill":
    case "dataset-post-write-closeout":
    case "dataset-import-completion-report":
    case "dataset-import-ledger-report":
      return statusIs(result, [
        "help",
        "completed",
        "completed_with_context_gaps",
        "completed_with_manual_blocks",
        "completed_with_manual_review",
        "completed_with_deferred_scopes",
        "completed_with_blocked_scopes",
        "ready_no_leaf_classification_blockers",
      ])
        ? 0
        : 1;
    case "dataset-location-decision-task-build":
      return statusIs(result, [
        "help",
        "ready_for_ai_location_decisions",
        "ready_no_location_actions",
      ])
        ? 0
        : 1;
    case "dataset-bundle-sample-rows":
    case "dataset-identity-preflight-requests-build":
    case "dataset-identity-preflight-index-merge":
      return statusIs(result, ["help", "ready"]) ? 0 : 1;
    case "dataset-identity-preflight-query-audit":
      return statusIs(result, ["help", "passed"]) ? 0 : 1;
    case "dataset-process-scope-run":
      return statusIs(result, ["help", "completed", "completed_with_deferred_scopes"]) ? 0 : 1;
    case "dataset-bafu-process-scope-e2e":
      return statusIs(result, ["help", "planned", "ready_for_explicit_commit", "completed"])
        ? 0
        : 1;
    case "dataset-bafu-batch-import-run":
    case "dataset-uslci-batch-import-run":
    case "dataset-worldsteel-batch-import-run":
      return statusIs(result, [
        "help",
        "preflight_completed",
        "completed",
        "completed_with_deferred_scopes",
        "completed_with_retryable_failures",
        "paused",
        "paused_with_deferred_scopes",
        "paused_with_retryable_failures",
        "stopped_after_blocked",
        "stopped_after_blocked_with_retryable_failures",
      ])
        ? 0
        : 1;
    case "dataset-bafu-universe-coverage-report":
      return statusIs(result, ["help", "completed", "completed_with_coverage_gaps"]) ? 0 : 1;
    case "dataset-identity-preflight-run":
      return statusIs(result, ["help", "planned", "completed", "completed_with_identity_findings"])
        ? 0
        : 1;
    case "dataset-identity-reference-rewrites-apply":
      return statusIs(result, ["help", "completed", "completed_no_rewrites", "completed_no_index"])
        ? 0
        : 1;
    case "dataset-post-authoring-finalize":
    case "dataset-mutation-manifest":
      return statusIs(result, ["help", "ready_for_remote_write", "ready_reference_only"]) ? 0 : 1;
    case "dataset-commit-handoff-plan":
      return statusIs(result, ["help", "ready_for_explicit_commit"]) ? 0 : 1;
    default:
      return 0;
  }
}

export type CommandCategory = "public" | "workflow-internal" | "cli-wrapper";

export type CommandKeyTest =
  | { kind: "command-smoke"; command: string }
  | { kind: "golden-diff"; path: string }
  | { kind: "node-test"; path: string; assertion: string };

export type CommandWorkflowEntry = {
  status: string;
  entry_kind: string;
};

export type FoundryCommandMetadata = {
  category: CommandCategory;
  ownerModule: string;
  ownerExport: string;
  navigationPath: string[];
  inputs: string[];
  outputs: string[];
  keyTests: CommandKeyTest[];
  workflowEntry: CommandWorkflowEntry;
};

type MetadataInput = Omit<FoundryCommandMetadata, "navigationPath" | "workflowEntry"> & {
  workflowEntry?: CommandWorkflowEntry;
};

export const commandCategories: CommandCategory[] = ["public", "workflow-internal", "cli-wrapper"];

const commandSmoke = (command: string): CommandKeyTest => ({
  kind: "command-smoke",
  command: `node scripts/foundry.ts ${command}`,
});

const goldenDiff: CommandKeyTest = {
  kind: "golden-diff",
  path: "scripts/foundry-golden-diff.ts",
};

const nodeTest = (path: string, assertion: string): CommandKeyTest => ({
  kind: "node-test",
  path,
  assertion,
});

const importCurationEntryContract = nodeTest(
  "test/unit/import-curation-entry-barrels-migration.test.mts",
  "import-curation entry preserves the complete owner namespace and live references",
);

const coreCommandContract = nodeTest(
  "test/unit/core-command-factory.test.mts",
  "core runtime, diagnostics, route artifacts, native errors, and exact help remain stable",
);
const identityPreflightRunCommandContract = nodeTest(
  "test/unit/identity-preflight-run-command-factory.test.mts",
  "identity-preflight receipt, binding, cache, disk, failure, argv, and help contracts remain stable",
);
const postAuthoringFinalizeCommandContract = nodeTest(
  "test/unit/post-authoring-finalize-command-factory.test.mts",
  "post-authoring rewrite, evidence, gate, manifest, handoff order, and help remain stable",
);

const coreOwner = "scripts/commands/core.ts";
const taskOwner = "scripts/commands/tasks.ts";
const tidasOwner = "scripts/commands/tidas-workflow.ts";
const typedImportOwner = (moduleName: string): string =>
  `scripts/lib/import-curation/${moduleName}.ts`;

function workflowEntryForCategory(category: string): CommandWorkflowEntry {
  switch (category) {
    case "public":
      return {
        status: "active",
        entry_kind: "operator_control_surface",
      };
    case "workflow-internal":
      return {
        status: "active",
        entry_kind: "dataset_import_workflow_stage",
      };
    case "cli-wrapper":
      return {
        status: "active",
        entry_kind: "sibling_cli_policy_wrapper",
      };
    default:
      return {
        status: "unknown",
        entry_kind: "unknown",
      };
  }
}

function metadata({
  category,
  ownerModule,
  ownerExport,
  inputs,
  outputs,
  keyTests,
  workflowEntry,
}: MetadataInput): FoundryCommandMetadata {
  return {
    category,
    ownerModule,
    ownerExport,
    navigationPath: ["scripts/foundry.ts", "scripts/lib/foundry-cli.ts", ownerModule],
    inputs,
    outputs,
    keyTests,
    workflowEntry: workflowEntry ?? workflowEntryForCategory(category),
  };
}

export const commandMetadata: Record<string, FoundryCommandMetadata> = {
  init: metadata({
    category: "public",
    ownerModule: coreOwner,
    ownerExport: "createCoreCommands().initRuntime",
    inputs: ["repo root runtime directory policy"],
    outputs: [".foundry/logs", ".foundry/state", ".foundry/workspaces", "tasks/*"],
    keyTests: [coreCommandContract, commandSmoke("init"), commandSmoke("doctor")],
  }),
  doctor: metadata({
    category: "public",
    ownerModule: coreOwner,
    ownerExport: "createCoreCommands().doctor",
    inputs: [
      "WORKFLOW.md",
      "docs/file-location-registry.json",
      ".env.example",
      "specs/import-profiles.json",
      "command metadata",
      "script import graph",
    ],
    outputs: ["doctor JSON status report"],
    keyTests: [coreCommandContract, goldenDiff, commandSmoke("doctor")],
  }),
  "env-check": metadata({
    category: "public",
    ownerModule: coreOwner,
    ownerExport: "createCoreCommands().envCheck",
    inputs: [".env.example"],
    outputs: ["env_example_surface JSON status report"],
    keyTests: [coreCommandContract, commandSmoke("env-check"), commandSmoke("doctor")],
  }),
  "workflow-check": metadata({
    category: "public",
    ownerModule: coreOwner,
    ownerExport: "createCoreCommands().workflowCheck",
    inputs: ["WORKFLOW.md"],
    outputs: ["workflow_check JSON status report"],
    keyTests: [coreCommandContract, commandSmoke("workflow-check"), commandSmoke("doctor")],
  }),
  "storage-check": metadata({
    category: "public",
    ownerModule: coreOwner,
    ownerExport: "createCoreCommands().storageCheck",
    inputs: ["docs/file-location-registry.json"],
    outputs: ["storage_check JSON status report"],
    keyTests: [coreCommandContract, commandSmoke("storage-check"), commandSmoke("doctor")],
  }),
  "surface-audit": metadata({
    category: "public",
    ownerModule: coreOwner,
    ownerExport: "createCoreCommands().surfaceAuditCheck",
    inputs: ["command registry", "command metadata", "docs/**/*.md", "scripts/**/*.{ts,mts,cts}"],
    outputs: ["surface audit JSON status report"],
    keyTests: [coreCommandContract, commandSmoke("surface-audit"), commandSmoke("doctor")],
  }),
  "acceptance-check": metadata({
    category: "public",
    ownerModule: coreOwner,
    ownerExport: "createCoreCommands().acceptanceCheck",
    inputs: ["task workspace checkpoints"],
    outputs: ["acceptance JSON status report"],
    keyTests: [coreCommandContract, commandSmoke("acceptance-check")],
  }),
  "workspace-map": metadata({
    category: "public",
    ownerModule: coreOwner,
    ownerExport: "createCoreCommands().workspaceMap",
    inputs: ["docs/workspace-project-map.md", "specs/workspace-capability-adapters.md"],
    outputs: ["workspace map JSON report"],
    keyTests: [coreCommandContract, commandSmoke("workspace-map")],
  }),
  "capabilities-list": metadata({
    category: "public",
    ownerModule: coreOwner,
    ownerExport: "createCoreCommands().capabilitiesList",
    inputs: ["specs/automated-lca-capability-registry.json"],
    outputs: ["capability registry JSON report"],
    keyTests: [coreCommandContract, goldenDiff, commandSmoke("capabilities-list")],
  }),
  "profiles-list": metadata({
    category: "public",
    ownerModule: typedImportOwner("profiles"),
    ownerExport: "listImportProfiles",
    inputs: ["specs/import-profiles.json"],
    outputs: ["import profile JSON report"],
    keyTests: [goldenDiff, commandSmoke("profiles-list"), importCurationEntryContract],
  }),
  "route-task": metadata({
    category: "public",
    ownerModule: coreOwner,
    ownerExport: "createCoreCommands().buildRoutePlan",
    inputs: ["task metadata options", "capability registry"],
    outputs: ["route plan JSON artifact"],
    keyTests: [coreCommandContract, goldenDiff, commandSmoke("route-task")],
  }),
  "tidas-handshake": metadata({
    category: "public",
    ownerModule: tidasOwner,
    ownerExport: "createTidasWorkflowCommands().runTidasHandshake",
    inputs: ["Rust tidas executable", "optional TIDAS_CONFIG"],
    outputs: ["compatible 0.2.x binary and tidas.operation-report.v1 handshake"],
    keyTests: [
      nodeTest("test/unit/tidas-adapter.test.mts", "0.2.x version and operation-report handshake"),
    ],
  }),
  "dataset-tidas-import": metadata({
    category: "cli-wrapper",
    ownerModule: tidasOwner,
    ownerExport: "createTidasWorkflowCommands().runTidasImport",
    inputs: ["supported external LCA package", "Rust tidas executable"],
    outputs: [
      "tidas.operation-report.v1",
      "tidas.import-execution-report.v1",
      "validated TIDAS package and process-bundles",
    ],
    keyTests: [
      nodeTest(
        "test/unit/tidas-adapter.test.mts",
        "native import, stable exit mapping, cancellation, and cleanup",
      ),
    ],
  }),
  "dataset-tidas-validate": metadata({
    category: "cli-wrapper",
    ownerModule: tidasOwner,
    ownerExport: "createTidasWorkflowCommands().runTidasPackageValidation",
    inputs: ["TIDAS package or JSON/JSONL rows", "Rust tidas executable"],
    outputs: [
      "tidas validation report/events",
      "Foundry validation compatibility report and valid/invalid rows",
    ],
    keyTests: [
      nodeTest(
        "test/unit/tidas-adapter.test.mts",
        "official batch validation report mapping and rollback cleanup",
      ),
    ],
  }),
  "tasks-list": metadata({
    category: "public",
    ownerModule: taskOwner,
    ownerExport: "createTaskCommands().tasksList",
    inputs: ["tasks/inbox", "tasks/active", "tasks/done"],
    outputs: ["task list JSON report"],
    keyTests: [commandSmoke("tasks-list")],
  }),
  "tasks-check": metadata({
    category: "public",
    ownerModule: taskOwner,
    ownerExport: "createTaskCommands().tasksCheck",
    inputs: ["tasks/inbox", "tasks/active", "tasks/done"],
    outputs: ["task storage consistency JSON report"],
    keyTests: [commandSmoke("tasks-check"), commandSmoke("doctor")],
  }),
  "task-complete": metadata({
    category: "public",
    ownerModule: taskOwner,
    ownerExport: "createTaskCommands().runTaskComplete",
    inputs: ["tasks/active/<task-id>.md", "task completion options"],
    outputs: ["tasks/done/<task-id>.md", "task completion JSON report"],
    keyTests: [commandSmoke("task-complete")],
  }),
  "execution-capsule-admit": metadata({
    category: "workflow-internal",
    ownerModule: "scripts/commands/execution-capsule.ts",
    ownerExport: "createExecutionCapsuleCommands().runExecutionCapsuleAdmit",
    inputs: [
      "foundry-execution-capsule-stage.v1 manifest",
      "content-addressed stage leaves",
      "materialized consumer boundary contract",
    ],
    outputs: [
      "execution-capsule-stage-revision.json",
      "execution-capsule-admission-ledger.jsonl",
      "execution-capsule-admission-report.json",
      "execution-capsule-seal.json when all checks pass",
    ],
    keyTests: [
      nodeTest(
        "test/commands/execution-capsule.test.mts",
        "execution capsule admission seals exact offline evidence and rejects mutation vectors",
      ),
      nodeTest(
        "test/unit/execution-capsule-attempt-state.test.mts",
        "attempt dispositions distinguish unattempted, recovered success, and unknown no-replay states",
      ),
    ],
  }),
  "dataset-incremental-change-set-compose": metadata({
    category: "workflow-internal",
    ownerModule: "scripts/commands/incremental-change-set.ts",
    ownerExport: "createIncrementalChangeSetCommands().runDatasetIncrementalChangeSetCompose",
    inputs: [
      "SHA-bound incremental change-set request",
      "old/candidate comparison JSONL",
      "owner-draft SELECT-only snapshot JSONL",
      "explicit JSON Pointer preservation policy",
      "optional terminal action exclusions",
    ],
    outputs: [
      "incremental-change-set-request.snapshot.json",
      "incremental-change-set-conversion-events.jsonl",
      "incremental-change-set-delta.jsonl",
      "incremental-change-set-no-write.jsonl",
      "incremental-change-set-holds.jsonl",
      "incremental-change-set-dependency-closure.json",
      "dataset-save-draft-input.jsonl",
      "dataset-save-draft-execution-contract.json",
      "incremental-change-set-report.json",
      "incremental-change-set-manifest.json",
    ],
    keyTests: [
      nodeTest(
        "test/unit/incremental-change-set.test.mts",
        "three-way merge and canonical CLI hashes preserve owner changes only through explicit policy",
      ),
      nodeTest(
        "test/commands/incremental-change-set.test.mts",
        "every conversion receives one terminal event and outputs satisfy action/no-write/hold algebra",
      ),
    ],
  }),
  "dataset-topology-convergence-compose": metadata({
    category: "workflow-internal",
    ownerModule: "scripts/commands/topology-convergence.ts",
    ownerExport: "createTopologyConvergenceCommands().runDatasetTopologyConvergenceCompose",
    inputs: [
      "SHA-bound topology convergence request",
      "candidate flow/process file indexes",
      "fresh owner/public/foreign SELECT-only census",
      "audited target classifications and multilingual overlays",
      "fresh admission receipt with fixed CLI fingerprint",
    ],
    outputs: [
      "F flow-create input and execution contract",
      "P process save-draft input and execution contract",
      "D zero-inbound delete candidate scope",
      "append-only conversion events and no-write/hold ledgers",
      "dependency closure, independent audit, report, and manifest",
    ],
    keyTests: [
      nodeTest(
        "test/unit/topology-convergence.test.mts",
        "occurrence keys and language overlays prevent global flow-id replacement",
      ),
      nodeTest(
        "test/commands/topology-convergence.test.mts",
        "F/P/D artifacts satisfy exact topology algebra and trust boundaries",
      ),
    ],
  }),
  "dataset-curation-queue-build": metadata({
    category: "cli-wrapper",
    ownerModule: "scripts/commands/cli-wrappers.ts",
    ownerExport: "createCliWrapperCommands().runDatasetCurationQueueBuild",
    inputs: ["converted process/flow/support/lifecyclemodel rows"],
    outputs: ["CLI curation queue directory", "Foundry wrapper JSON report"],
    keyTests: [
      nodeTest(
        "test/scenarios/identity-curation-context.test.mts",
        "curation queue build is used before full-context authoring",
      ),
    ],
  }),
  "dataset-curation-gate": metadata({
    category: "workflow-internal",
    ownerModule: typedImportOwner("curation-gate"),
    ownerExport: "runDatasetCurationGate",
    inputs: [
      "rows file",
      "schema report",
      "QA report",
      "profile",
      "context files",
      "queue artifacts",
    ],
    outputs: ["dataset-curation-gate-report.json", "ai-authoring-packages/*"],
    keyTests: [
      goldenDiff,
      nodeTest(
        "test/scenarios/identity-curation-context.test.mts",
        "curation gate authoring package carries full contract text and queue dependency rows",
      ),
      importCurationEntryContract,
    ],
  }),
  "dataset-authoring-plan": metadata({
    category: "workflow-internal",
    ownerModule: "scripts/commands/authoring-plan.ts",
    ownerExport: "createAuthoringPlanCommands().runDatasetAuthoringPlan",
    inputs: ["curation gate reports", "authoring task manifests", "decision task manifests"],
    outputs: ["dataset-authoring-plan JSON report"],
    keyTests: [
      nodeTest(
        "test/unit/foundry-stage-contract.test.mts",
        "complex workflow commands publish AI-readable stage contracts",
      ),
      nodeTest(
        "test/commands/authoring-plan.test.mts",
        "dataset-authoring-plan aggregates missing AI task builds from curation gate",
      ),
    ],
  }),
  "dataset-authoring-task-build": metadata({
    category: "workflow-internal",
    ownerModule: typedImportOwner("authoring-packages"),
    ownerExport: "runDatasetAuthoringTaskBuild",
    inputs: ["curation gate report", "AI authoring package"],
    outputs: [
      "ai-authoring-task.json",
      "ai-authoring-task.md",
      "patch-template.json",
      "authoring-task-manifest.json",
    ],
    keyTests: [
      goldenDiff,
      nodeTest(
        "test/commands/authoring-task-context.test.mts",
        "authoring task build blocks AI patch authoring when full context is incomplete",
      ),
      importCurationEntryContract,
    ],
  }),
  "dataset-authoring-patch-collect": metadata({
    category: "workflow-internal",
    ownerModule: typedImportOwner("patch-collect"),
    ownerExport: "runDatasetAuthoringPatchCollect",
    inputs: ["authoring task manifest", "AI patch files", "authoring packages"],
    outputs: ["authoring-patch-collect-report.json", "ai-patches.batch.json"],
    keyTests: [
      nodeTest(
        "test/commands/authoring-task-context.test.mts",
        "authoring patch collect blocks stale manifests that lack full-context task proof",
      ),
      importCurationEntryContract,
    ],
  }),
  "dataset-identity-decision-task-build": metadata({
    category: "workflow-internal",
    ownerModule: "scripts/commands/identity-decision-task.ts",
    ownerExport: "createIdentityDecisionTaskCommands().runDatasetIdentityDecisionTaskBuild",
    inputs: ["curation gate report", "identity-preflight context"],
    outputs: [
      "identity-decision-task.json",
      "identity-decision-task.md",
      "identity-decisions.template.jsonl",
    ],
    keyTests: [
      nodeTest(
        "test/scenarios/identity-curation-context.test.mts",
        "identity decision task deduplicates repeated targets and keeps source evidence",
      ),
    ],
  }),
  "dataset-classification-decision-task-build": metadata({
    category: "workflow-internal",
    ownerModule: "scripts/commands/classification-decisions.ts",
    ownerExport: "createClassificationDecisionCommands().runDatasetClassificationDecisionTaskBuild",
    inputs: ["classification-authoring-queue.jsonl", "classification schemas", "context files"],
    outputs: [
      "classification-decision-task.json",
      "classification-decision-task.md",
      "classification-decisions.template.jsonl",
    ],
    keyTests: [
      nodeTest(
        "test/commands/classification-decisions.test.mts",
        "classification decision task and apply route AI choices through CLI classification apply",
      ),
    ],
  }),
  "dataset-library-classification-decisions-project": metadata({
    category: "workflow-internal",
    ownerModule: "scripts/commands/classification-decisions.ts",
    ownerExport:
      "createClassificationDecisionCommands().runDatasetLibraryClassificationDecisionsProject",
    inputs: [
      "classification-authoring-queue.jsonl",
      "library classification-decisions.jsonl",
      "classification-decision-task.json",
    ],
    outputs: [
      "dataset-library-classification-decisions-project-report.json",
      "classification-decisions.jsonl",
      "classification-decisions.manual-review.jsonl",
    ],
    keyTests: [
      nodeTest(
        "test/commands/classification-decisions.test.mts",
        "library classification decisions project into task-bound apply decisions",
      ),
    ],
  }),
  "dataset-bafu-leaf-classification-tasks-prepare": metadata({
    category: "workflow-internal",
    ownerModule: "scripts/commands/bafu-leaf-classification-tasks.ts",
    ownerExport:
      "createBafuLeafClassificationTaskCommands().runDatasetBafuLeafClassificationTasksPrepare",
    inputs: [
      "library-entity-index.jsonl",
      "scope-projection.jsonl",
      "blocked-scope-ledger.jsonl",
      "optional library classification-decisions.jsonl",
    ],
    outputs: [
      "leaf-process-classification-task-report.json",
      "leaf-process-classification-tasks.jsonl",
      "classification-decisions.template.jsonl",
      "sharded leaf process classification task/template JSONL",
    ],
    keyTests: [
      nodeTest(
        "test/commands/bafu-leaf-classification-tasks.test.mts",
        "BAFU leaf classification helper prepares sharded process authoring tasks",
      ),
    ],
  }),
  "dataset-bafu-leaf-classification-category-map-project": metadata({
    category: "workflow-internal",
    ownerModule: "scripts/commands/bafu-leaf-classification-tasks.ts",
    ownerExport:
      "createBafuLeafClassificationTaskCommands().runDatasetBafuLeafClassificationCategoryMapProject",
    inputs: [
      "leaf-process-classification-tasks.jsonl",
      "category-map-decisions/*.jsonl",
      "source decisions directory",
      "tidas_processes_category.json",
    ],
    outputs: [
      "classification-decisions.jsonl",
      "classification-decisions.manual-review.jsonl",
      "category-map-decisions.manual-review.jsonl",
      "process-leaf-classification-candidates.jsonl",
      "flow-product-classification-candidates.jsonl",
      "bafu-leaf-category-map-project-report.json",
    ],
    keyTests: [
      nodeTest(
        "test/commands/bafu-leaf-classification-tasks.test.mts",
        "BAFU leaf category-map projection writes task-bound decisions and non-authoritative candidates separately",
      ),
    ],
  }),
  "dataset-bafu-identity-decisions-autofill": metadata({
    category: "workflow-internal",
    ownerModule: "scripts/commands/bafu-auto-authoring.ts",
    ownerExport: "createBafuAutoAuthoringCommands().runDatasetBafuIdentityDecisionsAutofill",
    inputs: ["identity-decision-task.json"],
    outputs: ["identity-decisions.jsonl", "bafu-identity-decisions-autofill-report.json"],
    keyTests: [
      nodeTest(
        "test/commands/bafu-auto-authoring.test.mts",
        "BAFU identity autofill creates product-flow create_new decisions only when candidates are not identity-equivalent",
      ),
    ],
  }),
  "dataset-bafu-authoring-patches-autofill": metadata({
    category: "workflow-internal",
    ownerModule: "scripts/commands/bafu-auto-authoring.ts",
    ownerExport: "createBafuAutoAuthoringCommands().runDatasetBafuAuthoringPatchesAutofill",
    inputs: ["authoring-task-manifest.json", "authoring-package-snapshots"],
    outputs: ["per-task ai-patches.json", "bafu-authoring-patches-autofill-report.json"],
    keyTests: [
      nodeTest(
        "test/commands/bafu-auto-authoring.test.mts",
        "BAFU patch autofill writes collectable name-plan and flowProperties patches",
      ),
      nodeTest(
        "test/commands/bafu-auto-authoring.test.mts",
        "BAFU patch autofill splits disposal/incineration and transport route names",
      ),
    ],
  }),
  "dataset-classification-decisions-apply": metadata({
    category: "workflow-internal",
    ownerModule: "scripts/commands/classification-decisions.ts",
    ownerExport: "createClassificationDecisionCommands().runDatasetClassificationDecisionsApply",
    inputs: ["classification queue", "AI classification decisions", "decision task proof"],
    outputs: ["classification-decisions-apply-report.json", "classified rows or queue outputs"],
    keyTests: [
      nodeTest(
        "test/commands/classification-decisions.test.mts",
        "classification decision task and apply route AI choices through CLI classification apply",
      ),
    ],
  }),
  "dataset-location-decision-task-build": metadata({
    category: "workflow-internal",
    ownerModule: "scripts/commands/location-decisions.ts",
    ownerExport: "createLocationDecisionCommands().runDatasetLocationDecisionTaskBuild",
    inputs: ["location-authoring-queue.jsonl", "tidas_locations_category.json", "context files"],
    outputs: [
      "location-decision-task.json",
      "location-decision-task.md",
      "location-decisions.template.jsonl",
    ],
    keyTests: [
      nodeTest(
        "test/commands/location-decisions.test.mts",
        "location decision task and apply route AI location choices through CLI location apply",
      ),
    ],
  }),
  "dataset-location-decisions-suggest": metadata({
    category: "workflow-internal",
    ownerModule: "scripts/commands/location-decisions.ts",
    ownerExport: "createLocationDecisionCommands().runDatasetLocationDecisionsSuggest",
    inputs: [
      "location-authoring-queue.jsonl",
      "location-decision-task.json",
      "tidas_locations_category.json",
    ],
    outputs: [
      "location-decisions.jsonl",
      "location-decisions.manual-review.jsonl",
      "dataset-location-decisions-suggest-report.json",
    ],
    keyTests: [
      nodeTest(
        "test/commands/location-decisions.test.mts",
        "location decisions suggest creates task-bound decisions for unique valid candidates",
      ),
    ],
  }),
  "dataset-location-decisions-apply": metadata({
    category: "workflow-internal",
    ownerModule: "scripts/commands/location-decisions.ts",
    ownerExport: "createLocationDecisionCommands().runDatasetLocationDecisionsApply",
    inputs: ["location queue", "AI location decisions", "decision task proof"],
    outputs: ["location-decisions-apply-report.json", "location-coded rows or queue outputs"],
    keyTests: [
      nodeTest(
        "test/commands/location-decisions.test.mts",
        "location decision task and apply route AI location choices through CLI location apply",
      ),
    ],
  }),
  "dataset-curation-cleanup": metadata({
    category: "workflow-internal",
    ownerModule: typedImportOwner("curation-cleanup"),
    ownerExport: "runDatasetCurationCleanup",
    inputs: ["curated rows file", "profile cleanup policy"],
    outputs: [
      "dataset-curation-cleanup-report.json",
      "completed: cleaned rows file",
      "blocked_invalid_datetime_metadata: ordered blockers and null cleaned rows",
    ],
    keyTests: [
      nodeTest(
        "test/scenarios/curation-cleanup-quality-gates.test.mts",
        "curation cleanup fills placeholder annual supply with searchable sentinel",
      ),
      nodeTest(
        "test/scenarios/curation-cleanup-quality-gates.test.mts",
        "curation cleanup CLI exits nonzero and emits only blocker evidence for an impossible datetime",
      ),
      nodeTest(
        "test/unit/curation-cleanup-runner-contract.test.mts",
        "impossible datetime blocks the whole cleanup before partial transforms or cleaned-row output",
      ),
      importCurationEntryContract,
    ],
  }),
  "dataset-patch-apply": metadata({
    category: "cli-wrapper",
    ownerModule: "scripts/commands/cli-wrappers.ts",
    ownerExport: "createCliWrapperCommands().runDatasetPatchApply",
    inputs: ["rows file", "AI patch file", "authoring package proof"],
    outputs: ["patched rows file", "dataset-patch-apply-report.json", "patch-evidence.jsonl"],
    keyTests: [
      nodeTest(
        "test/scenarios/flow-reference-reuse-and-traces.test.mts",
        "identity decision apply closes flow identity curation and counts as full-context evidence",
      ),
      nodeTest(
        "test/commands/authoring-task-context.test.mts",
        "authoring patch collect blocks AI patches without completed status",
      ),
    ],
  }),
  "dataset-support-cache-refresh": metadata({
    category: "workflow-internal",
    ownerModule: "scripts/commands/support-cache.ts",
    ownerExport: "createSupportCacheCommands().runDatasetSupportCacheRefresh",
    inputs: ["CLI support lookup command", "canonical support mapping policy"],
    outputs: [
      "specs/canonical-support/flow-properties-unit-groups.json",
      "support cache refresh report",
    ],
    keyTests: [commandSmoke("dataset-support-cache-refresh --help")],
  }),
  "dataset-canonical-support-mappings-autofill": metadata({
    category: "workflow-internal",
    ownerModule: "scripts/commands/support-cache.ts",
    ownerExport: "createSupportCacheCommands().runDatasetCanonicalSupportMappingsAutofill",
    inputs: [
      "canonical-support-mappings.template.jsonl",
      "specs/canonical-support/flow-properties-unit-groups.json",
    ],
    outputs: [
      "canonical-support-mappings.jsonl",
      "canonical-support-blocked.manual-review.jsonl",
      "canonical-support-mappings-report.json",
    ],
    keyTests: [
      nodeTest(
        "test/commands/support-cache.test.mts",
        "canonical support mapping autofill maps only proven units and reports unresolved units",
      ),
    ],
  }),
  "dataset-bundle-sample-rows": metadata({
    category: "workflow-internal",
    ownerModule: "scripts/commands/bundle-sample-rows.ts",
    ownerExport: "createBundleSampleRowsCommands().runDatasetBundleSampleRows",
    inputs: ["process-bundles directory", "sample selection options", "canonical support cache"],
    outputs: [
      "sample rows JSONL",
      "classification-authoring-queue.jsonl",
      "location-authoring-queue.jsonl",
      "identity-preflight-requests.jsonl",
      "process-scope-ledger.jsonl",
      "canonical-support-amount-scaling.jsonl when scale conversion is required",
      "dataset-bundle-sample-rows-report.json",
    ],
    keyTests: [
      goldenDiff,
      nodeTest(
        "test/unit/foundry-stage-contract.test.mts",
        "complex workflow commands publish AI-readable stage contracts",
      ),
      nodeTest(
        "test/commands/bundle-sample-rows.test.mts",
        "dataset-bundle-sample-rows writes executable identity preflight requests for process and elementary flow matching",
      ),
      nodeTest(
        "test/commands/bundle-sample-rows.test.mts",
        "dataset-bundle-sample-rows projects process geography into referenced flow location evidence",
      ),
      nodeTest(
        "test/commands/bundle-sample-rows.test.mts",
        "dataset-bundle-sample-rows retains and blocks canonical amount scaling requirements",
      ),
    ],
  }),
  "dataset-identity-preflight-requests-build": metadata({
    category: "workflow-internal",
    ownerModule: "scripts/commands/identity-preflight-run.ts",
    ownerExport: "createIdentityPreflightRunCommands().runDatasetIdentityPreflightRequestsBuild",
    inputs: ["current process or flow rows file", "optional source identity-preflight index"],
    outputs: [
      "identity-preflight-requests/identity-preflight-requests.jsonl",
      "dataset-identity-preflight-requests-build-report.json",
    ],
    keyTests: [
      identityPreflightRunCommandContract,
      nodeTest(
        "test/commands/bundle-sample-rows.test.mts",
        "dataset-identity-preflight-requests-build creates a fresh exact-row request index",
      ),
    ],
  }),
  "dataset-identity-preflight-query-audit": metadata({
    category: "workflow-internal",
    ownerModule: "scripts/commands/identity-preflight-run.ts",
    ownerExport: "createIdentityPreflightRunCommands().runDatasetIdentityPreflightQueryAudit",
    inputs: ["identity-preflight-requests.jsonl"],
    outputs: [
      "identity-preflight-query-audit.jsonl",
      "dataset-identity-preflight-query-audit-report.json",
    ],
    keyTests: [
      identityPreflightRunCommandContract,
      nodeTest(
        "test/commands/bundle-sample-rows.test.mts",
        "dataset-identity-preflight-query-audit passes complete fielded edge queries",
      ),
    ],
  }),
  "dataset-identity-preflight-run": metadata({
    category: "workflow-internal",
    ownerModule: "scripts/commands/identity-preflight-run.ts",
    ownerExport: "createIdentityPreflightRunCommands().runDatasetIdentityPreflightRun",
    inputs: ["identity-preflight-requests.jsonl", "published tiangong-lca CLI"],
    outputs: ["identity-preflight-run-results.jsonl", "dataset-identity-preflight-run-report.json"],
    keyTests: [
      identityPreflightRunCommandContract,
      nodeTest(
        "test/unit/foundry-stage-contract.test.mts",
        "complex workflow commands publish AI-readable stage contracts",
      ),
      nodeTest(
        "test/commands/bundle-sample-rows.test.mts",
        "dataset-identity-preflight-run executes request indexes and preserves identity blockers as evidence",
      ),
      nodeTest(
        "test/scenarios/identity-preflight-run-and-merge.test.mts",
        "identity preflight batch runner records timed-out CLI rows without hanging",
      ),
    ],
  }),
  "dataset-identity-preflight-index-merge": metadata({
    category: "workflow-internal",
    ownerModule: "scripts/commands/identity-preflight-run.ts",
    ownerExport: "createIdentityPreflightRunCommands().runDatasetIdentityPreflightIndexMerge",
    inputs: ["base identity-preflight index", "refreshed current-scope identity-preflight index"],
    outputs: [
      "identity-preflight-requests.jsonl",
      "dataset-identity-preflight-index-merge-report.json",
    ],
    keyTests: [
      identityPreflightRunCommandContract,
      nodeTest(
        "test/scenarios/identity-preflight-run-and-merge.test.mts",
        "identity preflight index merge preserves dependency rows while refreshing current scope",
      ),
    ],
  }),
  "dataset-library-index-build": metadata({
    category: "workflow-internal",
    ownerModule: "scripts/commands/library-scope-workflow.ts",
    ownerExport: "createLibraryScopeWorkflowCommands().runDatasetLibraryIndexBuild",
    inputs: ["root TIDAS library directory", "process-bundles/index.json"],
    outputs: [
      "library-entity-index.jsonl",
      "scope-projection.jsonl",
      "dataset-library-index-build-report.json",
    ],
    keyTests: [
      nodeTest(
        "test/scenarios/library-scope-workflow.test.mts",
        "library index deduplicates root TIDAS entities and projects shared dependencies to process scopes",
      ),
    ],
  }),
  "dataset-library-authoring-plan": metadata({
    category: "workflow-internal",
    ownerModule: "scripts/commands/library-scope-workflow.ts",
    ownerExport: "createLibraryScopeWorkflowCommands().runDatasetLibraryAuthoringPlan",
    inputs: ["library-entity-index.jsonl", "scope-projection.jsonl"],
    outputs: [
      "identity-decisions.template.jsonl",
      "classification-decisions.template.jsonl",
      "canonical-support-mappings.template.jsonl",
    ],
    keyTests: [
      nodeTest(
        "test/scenarios/library-scope-workflow.test.mts",
        "library authoring plan emits deduplicated semantic decision templates",
      ),
    ],
  }),
  "dataset-library-identity-decisions-from-preflight": metadata({
    category: "workflow-internal",
    ownerModule: "scripts/commands/library-scope-workflow.ts",
    ownerExport:
      "createLibraryScopeWorkflowCommands().runDatasetLibraryIdentityDecisionsFromPreflight",
    inputs: ["library index", "elementary flow identity-preflight request index and reports"],
    outputs: [
      "identity-decisions.jsonl",
      "identity-decisions.manual-review.jsonl",
      "dataset-library-identity-decisions-from-preflight-report.json",
    ],
    keyTests: [
      nodeTest(
        "test/scenarios/library-scope-workflow.test.mts",
        "library identity decisions from preflight emits reuse decisions and manual review rows",
      ),
      nodeTest(
        "test/commands/library-scope-workflow-elementary-identity.test.mts",
        "elementary identity evaluation preserves source/openLCA compartments and conservative candidate matching",
      ),
    ],
  }),
  "dataset-library-decisions-apply": metadata({
    category: "workflow-internal",
    ownerModule: "scripts/commands/library-scope-workflow.ts",
    ownerExport: "createLibraryScopeWorkflowCommands().runDatasetLibraryDecisionsApply",
    inputs: [
      "library index",
      "identity decisions",
      "classification decisions",
      "canonical support mappings",
    ],
    outputs: [
      "library-resolution.json",
      "scope-checkpoints.jsonl",
      "blocked-scope-ledger.jsonl",
      "blocked-scope-report.json",
      "exchange-reference-rewrites.jsonl",
    ],
    keyTests: [
      nodeTest(
        "test/scenarios/library-scope-workflow.test.mts",
        "library decisions apply rewrites only elementary flow references and defers unresolved scopes",
      ),
    ],
  }),
  "dataset-process-scope-run": metadata({
    category: "workflow-internal",
    ownerModule: "scripts/commands/library-scope-workflow.ts",
    ownerExport: "createLibraryScopeWorkflowCommands().runDatasetProcessScopeRun",
    inputs: ["process-bundles directory", "library-resolution.json", "scope file"],
    outputs: [
      "scope-checkpoints.jsonl",
      "blocked-scope-ledger.jsonl",
      "blocked-scope-report.json",
      "dataset-process-scope-run-report.json",
    ],
    keyTests: [
      nodeTest(
        "test/scenarios/library-scope-workflow.test.mts",
        "process scope runner plans only ready scopes and keeps blocked scopes out of the queue",
      ),
    ],
  }),
  "dataset-bafu-process-scope-e2e": metadata({
    category: "workflow-internal",
    ownerModule: "scripts/commands/bafu-process-scope-e2e.ts",
    ownerExport: "createBafuProcessScopeE2eCommands().runDatasetBafuProcessScopeE2e",
    inputs: [
      "one process rows file",
      "optional source support rows file",
      "optional source rows file",
      "post-authoring finalize context options",
      "optional verified support identity cache",
    ],
    outputs: [
      "bafu-process-scope-e2e-report.json",
      "bafu-process-scope-e2e-ledger.jsonl",
      "dataset-post-authoring-finalize-report.json when executed or resumed",
      "reused-support-identities.json when support handoff is skipped from verified cache",
    ],
    keyTests: [
      nodeTest(
        "test/commands/bafu-process-scope-e2e.test.mts",
        "BAFU process scope helper hard-blocks unresolved AI curation items on resume",
      ),
    ],
  }),
  "dataset-bafu-batch-import-run": metadata({
    category: "workflow-internal",
    ownerModule: "scripts/commands/bafu-batch-import-run.ts",
    ownerExport: "createBafuBatchImportRunCommands().runDatasetBafuBatchImportRun",
    inputs: [
      "ready-scopes.jsonl",
      "process-bundles directory",
      "BAFU run directory with context and library decisions",
      "target user id",
      "optional prior batch/import-ledger directories for pending-only carry-forward",
      "optional explicit retry ids via repeated --process-id or --process-id-file (one id per line, # comments and blank lines ignored)",
    ],
    outputs: [
      "dataset-bafu-batch-import-run-report.json",
      "scope-checkpoints.jsonl",
      "import-ledger/ok.*.verified.jsonl",
      "import-ledger/blocked.*.jsonl",
      "import-ledger/failed.scopes.retry.jsonl",
      "import-ledger/verified-support-identities.jsonl",
      "import-ledger/preflight.plan.jsonl when --preflight-only is used",
    ],
    keyTests: [
      nodeTest(
        "test/commands/bafu-batch-import-run.test.mts",
        "BAFU batch import runner skips already verified scopes through resumable ledgers",
      ),
      nodeTest(
        "test/commands/bafu-batch-import-run.test.mts",
        "BAFU batch import runner applies pending-only before limit and honors pause file",
      ),
      nodeTest(
        "test/commands/bafu-batch-import-run.test.mts",
        "BAFU batch import runner carries forward prior ledgers into fresh batch selection",
      ),
      nodeTest(
        "test/commands/bafu-batch-import-run.test.mts",
        "BAFU batch import runner writes read-only preflight plan and primes support identity cache",
      ),
    ],
  }),
  "dataset-uslci-batch-import-run": metadata({
    category: "workflow-internal",
    ownerModule: "scripts/commands/uslci-batch-import-run.ts",
    ownerExport: "createUslciBatchImportRunCommands().runDatasetUslciBatchImportRun",
    inputs: [
      "ready-scopes.jsonl (library-resolution-v8)",
      "process-bundles directory (conversion-v6)",
      "USLCI run directory with context and pre-authored decisions-v4",
      "library classification decisions (decisions-v4/classification-decisions.jsonl)",
      "target user id (USLCI account)",
      "optional prior batch/import-ledger directories for pending-only carry-forward",
      "optional explicit retry ids via repeated --process-id or --process-id-file",
    ],
    outputs: [
      "dataset-uslci-batch-import-run-report.json",
      "scope-checkpoints.jsonl",
      "import-ledger/ok.*.verified.jsonl",
      "import-ledger/blocked.*.jsonl",
      "import-ledger/failed.scopes.retry.jsonl",
      "import-ledger/verified-support-identities.jsonl",
      "import-ledger/preflight.plan.jsonl when --preflight-only is used",
    ],
    keyTests: [
      nodeTest(
        "test/commands/bafu-batch-import-run.test.mts",
        "BAFU batch import runner skips already verified scopes through resumable ledgers",
      ),
    ],
  }),
  "dataset-worldsteel-batch-import-run": metadata({
    category: "workflow-internal",
    ownerModule: "scripts/commands/worldsteel-batch-import-run.ts",
    ownerExport: "createWorldsteelBatchImportRunCommands().runDatasetWorldsteelBatchImportRun",
    inputs: [
      "ready-scopes.jsonl (worldsteel library-resolution)",
      "process-bundles directory (worldsteel conversion)",
      "worldsteel run directory with context and pre-authored decisions",
      "library classification decisions (decisions/classification-decisions.jsonl)",
      "library-resolution directory holding exchange-reference-rewrites.jsonl (UUID reuse)",
      "target user id (worldsteel account: data@worldsteel.org)",
      "optional prior batch/import-ledger directories for pending-only carry-forward",
      "optional explicit retry ids via repeated --process-id or --process-id-file",
    ],
    outputs: [
      "dataset-worldsteel-batch-import-run-report.json",
      "scope-checkpoints.jsonl",
      "import-ledger/ok.*.verified.jsonl",
      "import-ledger/blocked.*.jsonl",
      "import-ledger/failed.scopes.retry.jsonl",
      "import-ledger/verified-support-identities.jsonl",
      "import-ledger/preflight.plan.jsonl when --preflight-only is used",
    ],
    keyTests: [
      nodeTest(
        "test/commands/bafu-batch-import-run.test.mts",
        "BAFU batch import runner skips already verified scopes through resumable ledgers",
      ),
    ],
  }),
  "dataset-bafu-universe-coverage-report": metadata({
    category: "workflow-internal",
    ownerModule: "scripts/commands/bafu-batch-import-run.ts",
    ownerExport: "createBafuBatchImportRunCommands().runDatasetBafuUniverseCoverageReport",
    inputs: [
      "BAFU input directory",
      "process-bundles/index.json",
      "ready-scopes.jsonl files",
      "explicit prior batch/import-ledger directories",
    ],
    outputs: [
      "bafu-universe-coverage-report.json",
      "bafu-process-universe.coverage.jsonl",
      "bafu-process-coverage-gaps.jsonl",
      "bafu-flow-reference-coverage.jsonl",
      "bafu-flow-reference-coverage-gaps.jsonl",
    ],
    keyTests: [
      nodeTest(
        "test/commands/bafu-batch-import-run.test.mts",
        "BAFU universe coverage report compares full process universe with ready scopes and ledgers",
      ),
    ],
  }),
  "dataset-identity-reference-rewrites-apply": metadata({
    category: "workflow-internal",
    ownerModule: "scripts/commands/identity-reference-rewrites.ts",
    ownerExport:
      "createIdentityReferenceRewriteCommands().runDatasetIdentityReferenceRewritesApply",
    inputs: ["process rows file", "identity-preflight index or identity decision rewrites"],
    outputs: [
      "rewritten rows file",
      "identity-reference-rewrites-apply-report.json",
      "reference reuse rows",
    ],
    keyTests: [
      nodeTest(
        "test/scenarios/flow-identity-decisions.test.mts",
        "identity duplicate flow rewrites require high-confidence preflight evidence",
      ),
    ],
  }),
  "dataset-identity-decisions-apply": metadata({
    category: "workflow-internal",
    ownerModule: "scripts/commands/identity-decisions.ts",
    ownerExport: "createIdentityDecisionCommands().runDatasetIdentityDecisionsApply",
    inputs: ["rows file", "AI identity decisions", "identity decision task proof"],
    outputs: [
      "identity-decisions-apply-report.json",
      "write candidate rows",
      "reference reuse rows",
      "reference rewrites",
    ],
    keyTests: [
      nodeTest(
        "test/commands/authoring-plan.test.mts",
        "dataset-identity-decisions-apply filters mixed decisions by requested type",
      ),
      nodeTest(
        "test/scenarios/flow-identity-decisions.test.mts",
        "AI identity decisions apply split flow rows into writes and reference reuse",
      ),
    ],
  }),
  "dataset-post-authoring-finalize": metadata({
    category: "workflow-internal",
    ownerModule: "scripts/commands/post-authoring-finalize.ts",
    ownerExport: "createPostAuthoringFinalizeCommands().runDatasetPostAuthoringFinalize",
    inputs: [
      "patched or decision-applied rows",
      "profile",
      "queue artifacts",
      "schema/context files",
      "decision/patch evidence",
    ],
    outputs: [
      "cleanup-complete: final rows file",
      "cleanup-blocked: ordered blockers, blocked import ledger, null final rows, no CommandSpec",
      "schema report",
      "cleanup report",
      "dry-run report",
      "post-authoring-finalize report",
    ],
    keyTests: [
      goldenDiff,
      postAuthoringFinalizeCommandContract,
      nodeTest(
        "test/unit/foundry-stage-contract.test.mts",
        "complex workflow commands publish AI-readable stage contracts",
      ),
      nodeTest(
        "test/scenarios/post-authoring-finalize-gates.test.mts",
        "post-authoring finalize declares external process flow refs for remote proof",
      ),
      nodeTest(
        "test/scenarios/post-authoring-finalize-gates.test.mts",
        "post-authoring finalize auto-builds curation queue context from sibling process bundle rows",
      ),
      nodeTest(
        "test/scenarios/post-authoring-finalize-gates.test.mts",
        "post-authoring finalize stops after invalid datetime cleanup without downstream evidence",
      ),
    ],
  }),
  "dataset-commit-handoff-plan": metadata({
    category: "workflow-internal",
    ownerModule: "scripts/commands/commit-handoff.ts",
    ownerExport: "createCommitHandoffCommands().runDatasetCommitHandoffPlan",
    inputs: ["mutation manifest", "finalize report", "location audit evidence"],
    outputs: [
      "commit handoff plan JSON report",
      "authoritative commit and post-write verify CommandSpecs with executable, argv, display, binding, and SHA-256",
      "final rows artifact facts with exact path, bytes, and SHA-256",
    ],
    keyTests: [
      nodeTest(
        "test/unit/foundry-command-spec.test.mts",
        "CommandSpec blocks artifact byte drift before spawn and never executes display",
      ),
      nodeTest(
        "test/scenarios/full-context-completion-closeout.test.mts",
        "commit handoff blocks nonzero location audit blockers",
      ),
      nodeTest(
        "test/scenarios/full-context-completion-closeout.test.mts",
        "process commit handoff defaults draft state code and records account guard",
      ),
    ],
  }),
  "dataset-post-write-closeout": metadata({
    category: "workflow-internal",
    ownerModule: "scripts/commands/post-write-closeout.ts",
    ownerExport: "createPostWriteCloseoutCommands().runDatasetPostWriteCloseout",
    inputs: ["final rows", "write result", "trace queues", "readback/verify evidence"],
    outputs: ["post-write-closeout-report.json"],
    keyTests: [
      nodeTest(
        "test/scenarios/full-context-completion-closeout.test.mts",
        "post-write closeout requires common:other trace queues to match final rows",
      ),
    ],
  }),
  "dataset-import-completion-report": metadata({
    category: "workflow-internal",
    ownerModule: "scripts/commands/import-completion.ts",
    ownerExport: "createImportCompletionCommands().runDatasetImportCompletionReport",
    inputs: ["task manifest", "post-write closeout reports", "mutation manifests"],
    outputs: ["dataset-import-completion-report.json"],
    keyTests: [
      nodeTest(
        "test/scenarios/full-context-completion-closeout.test.mts",
        "full-context import completion gates block missing proof and pass evidenced BAFU scopes",
      ),
    ],
  }),
  "dataset-import-ledger-report": metadata({
    category: "workflow-internal",
    ownerModule: "scripts/commands/import-ledger.ts",
    ownerExport: "createImportLedgerCommands().runDatasetImportLedgerReport",
    inputs: ["task import ledger directory with ok/blocked/retry JSONL files"],
    outputs: [
      "dataset-import-ledger-report.json",
      "resume.plan.jsonl",
      "resume.skipped-verified.jsonl",
    ],
    keyTests: [
      nodeTest(
        "test/commands/import-ledger.test.mts",
        "import ledger report separates verified rows from human-review resume scopes",
      ),
    ],
  }),
  "dataset-mutation-manifest": metadata({
    category: "workflow-internal",
    ownerModule: typedImportOwner("mutation-manifest"),
    ownerExport: "runDatasetMutationManifest",
    inputs: [
      "final rows",
      "schema report",
      "cleanup report",
      "dry-run report",
      "decision/patch evidence",
      "remote verify reports",
    ],
    outputs: [
      "dataset-mutation-manifest.json",
      "write candidates",
      "reference reuse items",
      "blockers",
    ],
    keyTests: [
      goldenDiff,
      nodeTest(
        "test/scenarios/mutation-full-context-evidence.test.mts",
        "mutation manifest requires full-context AI evidence and preserves deferred trace queues",
      ),
      nodeTest(
        "test/scenarios/mutation-manifest-reference-closure.test.mts",
        "mutation manifest blocks process writes when referenced datasets are not proven",
      ),
      importCurationEntryContract,
    ],
  }),
};

export function commandMetadataEntries(): Array<FoundryCommandMetadata & { command: string }> {
  return Object.entries(commandMetadata).map(([command, value]) => ({
    command,
    ...value,
  }));
}

export function commandMetadataFor(command: string): FoundryCommandMetadata | null {
  return commandMetadata[command] ?? null;
}

import process from "node:process";
import { createClassificationDecisionCommands } from "../commands/classification-decisions.ts";
import { createLocationDecisionCommands } from "../commands/location-decisions.ts";

interface JsonRecord {
  [key: string]: unknown;
}

type Callable = (...args: unknown[]) => unknown;
type CommandGroup = Record<string, Callable>;
type OptionHandler = (options: never) => unknown;

function invokeHandler<Handler extends OptionHandler>(
  handler: Handler,
  options: unknown,
): ReturnType<Handler> {
  return handler(options as never) as ReturnType<Handler>;
}

interface CommandDependencies {
  authoringPlanCommands: CommandGroup;
  uslciBatchImportRunCommands: CommandGroup;
  worldsteelBatchImportRunCommands: CommandGroup;
  bafuAutoAuthoringCommands: CommandGroup;
  bafuBatchImportRunCommands: CommandGroup;
  bafuLeafClassificationTaskCommands: CommandGroup;
  bafuProcessScopeE2eCommands: CommandGroup;
  bundleSampleRowsCommands: CommandGroup;
  cliWrapperCommands: CommandGroup;
  commitHandoffCommands: CommandGroup;
  coreCommands: CommandGroup;
  executionCapsuleCommands: CommandGroup;
  identityDecisionCommands: CommandGroup;
  identityDecisionTaskCommands: CommandGroup;
  identityPreflightCommands: CommandGroup;
  identityReferenceRewriteCommands: CommandGroup;
  incrementalChangeSetCommands: CommandGroup;
  topologyConvergenceCommands: CommandGroup;
  importCompletionCommands: CommandGroup;
  importLedgerCommands: CommandGroup;
  libraryScopeWorkflowCommands: CommandGroup;
  listImportProfiles: Callable;
  postAuthoringFinalizeCommands: CommandGroup;
  postWriteCloseoutCommands: CommandGroup;
  repoRoot: string;
  runDatasetAuthoringPatchCollect: Callable;
  runDatasetAuthoringTaskBuild: Callable;
  runDatasetCurationCleanup: Callable;
  runDatasetCurationGate: Callable;
  runDatasetMutationManifest: Callable;
  supportCacheCommands: CommandGroup;
  taskCommands: CommandGroup;
  tidasWorkflowCommands: CommandGroup;
}

interface CliRuntime {
  exitCodeForCommand: (command: string, result: unknown) => number;
  parseArgs: (argv: string[]) => JsonRecord;
  printJson: (value: unknown) => void;
  usage: () => { commands: string[]; [key: string]: unknown };
}

interface FoundryCliInput {
  argv?: string[];
  commandDeps: Record<string, unknown>;
  decisionDeps: Record<string, unknown>;
  runtime: Record<string, unknown>;
}

export function runFoundryCli({
  argv = process.argv,
  commandDeps,
  decisionDeps,
  runtime,
}: FoundryCliInput): void {
  runFoundryCliMain({ argv, commandDeps, decisionDeps, runtime }).catch((error) => {
    console.error(error instanceof Error ? error.stack || error.message : String(error));
    process.exit(1);
  });
}

/** One owner registry for both process adapters and in-process orchestration. */
export function createFoundryCommandDispatcher({
  commandDeps: rawCommandDeps,
  decisionDeps,
  runtime: rawRuntime,
}: Omit<FoundryCliInput, "argv">) {
  const commandDeps = rawCommandDeps as unknown as CommandDependencies;
  const runtime = rawRuntime as unknown as CliRuntime;
  const { usage } = runtime;
  const {
    authoringPlanCommands,
    uslciBatchImportRunCommands,
    worldsteelBatchImportRunCommands,
    bafuAutoAuthoringCommands,
    bafuBatchImportRunCommands,
    bafuLeafClassificationTaskCommands,
    bafuProcessScopeE2eCommands,
    bundleSampleRowsCommands,
    cliWrapperCommands,
    commitHandoffCommands,
    coreCommands,
    executionCapsuleCommands,
    identityDecisionCommands,
    identityDecisionTaskCommands,
    identityPreflightCommands,
    identityReferenceRewriteCommands,
    incrementalChangeSetCommands,
    topologyConvergenceCommands,
    importCompletionCommands,
    importLedgerCommands,
    libraryScopeWorkflowCommands,
    listImportProfiles,
    postAuthoringFinalizeCommands,
    postWriteCloseoutCommands,
    repoRoot,
    runDatasetAuthoringPatchCollect,
    runDatasetAuthoringTaskBuild,
    runDatasetCurationCleanup,
    runDatasetCurationGate,
    runDatasetMutationManifest,
    supportCacheCommands,
    taskCommands,
    tidasWorkflowCommands,
  } = commandDeps;
  const locationDecisionCommands = createLocationDecisionCommands(
    decisionDeps as unknown as Parameters<typeof createLocationDecisionCommands>[0],
  );
  const classificationDecisionCommands = createClassificationDecisionCommands(
    decisionDeps as unknown as Parameters<typeof createClassificationDecisionCommands>[0],
  );
  const commandHandlers: Record<string, (options: JsonRecord) => unknown> = {
    help: () => usage(),
    "--help": () => usage(),
    "-h": () => usage(),
    init: () => coreCommands.initRuntime(),
    doctor: () => coreCommands.doctor(),
    "env-check": () => coreCommands.envCheck(),
    "workflow-check": () => coreCommands.workflowCheck(),
    "storage-check": () => coreCommands.storageCheck(),
    "surface-audit": () => coreCommands.surfaceAuditCheck(),
    "acceptance-check": () => coreCommands.acceptanceCheck(),
    "workspace-map": () => coreCommands.workspaceMap(),
    "capabilities-list": (options) => coreCommands.capabilitiesList(options),
    "profiles-list": (options) => listImportProfiles({ repoRoot, options }),
    "route-task": (options) =>
      coreCommands.writeRoutePlan(coreCommands.buildRoutePlan(options), options.outDir),
    "tasks-list": () => taskCommands.tasksList(),
    "tasks-check": () => taskCommands.tasksCheck(),
    "task-complete": (options) => taskCommands.runTaskComplete(options),
    "tidas-handshake": (options) => tidasWorkflowCommands.runTidasHandshake(options),
    "dataset-tidas-import": (options) => tidasWorkflowCommands.runTidasImport(options),
    "dataset-tidas-validate": (options) => tidasWorkflowCommands.runTidasPackageValidation(options),
    "execution-capsule-admit": (options) =>
      executionCapsuleCommands.runExecutionCapsuleAdmit(options),
    "dataset-curation-queue-build": (options) =>
      cliWrapperCommands.runDatasetCurationQueueBuild(options),
    "dataset-curation-gate": (options) => runDatasetCurationGate({ repoRoot, options }),
    "dataset-authoring-plan": (options) => authoringPlanCommands.runDatasetAuthoringPlan(options),
    "dataset-authoring-task-build": (options) =>
      runDatasetAuthoringTaskBuild({ repoRoot, options }),
    "dataset-authoring-patch-collect": (options) =>
      runDatasetAuthoringPatchCollect({ repoRoot, options }),
    "dataset-identity-decision-task-build": (options) =>
      identityDecisionTaskCommands.runDatasetIdentityDecisionTaskBuild(options),
    "dataset-classification-decision-task-build": (options) =>
      invokeHandler(
        classificationDecisionCommands.runDatasetClassificationDecisionTaskBuild,
        options,
      ),
    "dataset-library-classification-decisions-project": (options) =>
      invokeHandler(
        classificationDecisionCommands.runDatasetLibraryClassificationDecisionsProject,
        options,
      ),
    "dataset-bafu-leaf-classification-tasks-prepare": (options) =>
      bafuLeafClassificationTaskCommands.runDatasetBafuLeafClassificationTasksPrepare(options),
    "dataset-bafu-leaf-classification-category-map-project": (options) =>
      bafuLeafClassificationTaskCommands.runDatasetBafuLeafClassificationCategoryMapProject(
        options,
      ),
    "dataset-bafu-identity-decisions-autofill": (options) =>
      bafuAutoAuthoringCommands.runDatasetBafuIdentityDecisionsAutofill(options),
    "dataset-bafu-authoring-patches-autofill": (options) =>
      bafuAutoAuthoringCommands.runDatasetBafuAuthoringPatchesAutofill(options),
    "dataset-classification-decisions-apply": (options) =>
      invokeHandler(classificationDecisionCommands.runDatasetClassificationDecisionsApply, options),
    "dataset-location-decision-task-build": (options) =>
      invokeHandler(locationDecisionCommands.runDatasetLocationDecisionTaskBuild, options),
    "dataset-location-decisions-suggest": (options) =>
      invokeHandler(locationDecisionCommands.runDatasetLocationDecisionsSuggest, options),
    "dataset-location-decisions-apply": (options) =>
      invokeHandler(locationDecisionCommands.runDatasetLocationDecisionsApply, options),
    "dataset-curation-cleanup": (options) => runDatasetCurationCleanup({ repoRoot, options }),
    "dataset-patch-apply": (options) => cliWrapperCommands.runDatasetPatchApply(options),
    "dataset-support-cache-refresh": (options) =>
      supportCacheCommands.runDatasetSupportCacheRefresh(options),
    "dataset-canonical-support-mappings-autofill": (options) =>
      supportCacheCommands.runDatasetCanonicalSupportMappingsAutofill(options),
    "dataset-bundle-sample-rows": (options) =>
      bundleSampleRowsCommands.runDatasetBundleSampleRows(options),
    "dataset-identity-preflight-requests-build": (options) =>
      identityPreflightCommands.runDatasetIdentityPreflightRequestsBuild(options),
    "dataset-identity-preflight-query-audit": (options) =>
      identityPreflightCommands.runDatasetIdentityPreflightQueryAudit(options),
    "dataset-identity-preflight-run": (options) =>
      identityPreflightCommands.runDatasetIdentityPreflightRun(options),
    "dataset-identity-preflight-index-merge": (options) =>
      identityPreflightCommands.runDatasetIdentityPreflightIndexMerge(options),
    "dataset-library-index-build": (options) =>
      libraryScopeWorkflowCommands.runDatasetLibraryIndexBuild(options),
    "dataset-library-authoring-plan": (options) =>
      libraryScopeWorkflowCommands.runDatasetLibraryAuthoringPlan(options),
    "dataset-library-identity-decisions-from-preflight": (options) =>
      libraryScopeWorkflowCommands.runDatasetLibraryIdentityDecisionsFromPreflight(options),
    "dataset-library-decisions-apply": (options) =>
      libraryScopeWorkflowCommands.runDatasetLibraryDecisionsApply(options),
    "dataset-process-scope-run": (options) =>
      libraryScopeWorkflowCommands.runDatasetProcessScopeRun(options),
    "dataset-bafu-process-scope-e2e": (options) =>
      bafuProcessScopeE2eCommands.runDatasetBafuProcessScopeE2e(options),
    "dataset-bafu-batch-import-run": (options) =>
      bafuBatchImportRunCommands.runDatasetBafuBatchImportRun(options),
    "dataset-uslci-batch-import-run": (options) =>
      uslciBatchImportRunCommands.runDatasetUslciBatchImportRun(options),
    "dataset-worldsteel-batch-import-run": (options) =>
      worldsteelBatchImportRunCommands.runDatasetWorldsteelBatchImportRun(options),
    "dataset-bafu-universe-coverage-report": (options) =>
      bafuBatchImportRunCommands.runDatasetBafuUniverseCoverageReport(options),
    "dataset-identity-reference-rewrites-apply": (options) =>
      identityReferenceRewriteCommands.runDatasetIdentityReferenceRewritesApply(options),
    "dataset-incremental-change-set-compose": (options) =>
      incrementalChangeSetCommands.runDatasetIncrementalChangeSetCompose(options),
    "dataset-topology-convergence-compose": (options) =>
      topologyConvergenceCommands.runDatasetTopologyConvergenceCompose(options),
    "dataset-identity-decisions-apply": (options) =>
      identityDecisionCommands.runDatasetIdentityDecisionsApply(options),
    "dataset-post-authoring-finalize": (options) =>
      postAuthoringFinalizeCommands.runDatasetPostAuthoringFinalize(options),
    "dataset-commit-handoff-plan": (options) =>
      commitHandoffCommands.runDatasetCommitHandoffPlan(options),
    "dataset-post-write-closeout": (options) =>
      postWriteCloseoutCommands.runDatasetPostWriteCloseout(options),
    "dataset-import-completion-report": (options) =>
      importCompletionCommands.runDatasetImportCompletionReport(options),
    "dataset-import-ledger-report": (options) =>
      importLedgerCommands.runDatasetImportLedgerReport(options),
    "dataset-mutation-manifest": (options) => runDatasetMutationManifest({ repoRoot, options }),
  };

  return Object.freeze({
    commands: Object.freeze(Object.keys(commandHandlers)),
    async execute(command: string, options: JsonRecord = {}): Promise<unknown> {
      if (!Object.hasOwn(commandHandlers, command))
        throw new Error(`Unknown Foundry command: ${command}`);
      return commandHandlers[command](options);
    },
  });
}

async function runFoundryCliMain({
  argv,
  commandDeps,
  decisionDeps,
  runtime: rawRuntime,
}: Required<FoundryCliInput>): Promise<void> {
  const runtime = rawRuntime as unknown as CliRuntime;
  const { exitCodeForCommand, parseArgs, printJson, usage } = runtime;
  const dispatcher = createFoundryCommandDispatcher({
    commandDeps,
    decisionDeps,
    runtime: rawRuntime,
  });
  const [command = "help", ...rest] = argv.slice(2);
  const options = parseArgs(rest);
  if (!dispatcher.commands.includes(command)) {
    console.error(`Unknown Foundry command: ${command}`);
    console.error(`Known commands: ${usage().commands.join(", ")}`);
    process.exit(2);
  }
  const result = await dispatcher.execute(command, options);
  const exitCode = exitCodeForCommand(command, result);
  printJson(result);
  process.exit(exitCode);
}

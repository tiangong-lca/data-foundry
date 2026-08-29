import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  createLibraryEntityProjection,
  type EntityRow,
  type JsonRecord,
  type ScopeProjection,
} from "../lib/library-orchestration/entity-projection.ts";
import { createLibraryAuthoringPlan } from "../lib/library-orchestration/authoring-plan.ts";
import {
  readyScopeFileValue,
  type LibraryScopeWorkflowDependencies,
} from "../lib/library-orchestration/command-runtime.ts";
import { createLibraryIndexBuild } from "../lib/library-orchestration/index-build.ts";
import { createLibraryIdentityPreflightRunner } from "../lib/library-orchestration/identity-preflight-runner.ts";
import { createReadyProcessScopeRunner } from "../lib/library-orchestration/ready-process-scope-runner.ts";
import {
  createLibraryDecisionApply,
  type ScopeRewriteResult,
} from "../lib/library-orchestration/decision-apply.ts";
import { readOnlyStageContract } from "../lib/stage-contract.ts";

const libraryScopeStageContract = readOnlyStageContract([
  {
    stage: "library_index",
    phase: "prepare",
    purpose:
      "Build one root TIDAS entity index so bundle-local copies do not multiply authoring or identity work.",
    inputs: [
      "root tidas/processes",
      "root tidas/flows",
      "root tidas/flowproperties",
      "root tidas/unitgroups",
    ],
    outputs: ["library-entity-index.jsonl"],
    side_effects: ["writes local Foundry artifacts"],
  },
  {
    stage: "scope_projection",
    phase: "rewrite_cleanup",
    purpose:
      "Project unique library decisions back to process-bundle scopes with dependency closure evidence.",
    inputs: ["process-bundles/index.json", "bundle manifest.json files"],
    outputs: ["scope-projection.jsonl"],
    side_effects: ["writes local Foundry artifacts"],
  },
  {
    stage: "decision_resolution",
    phase: "gate_validate",
    purpose:
      "Merge AI identity/classification decisions and canonical support mappings into ready or blocked process scopes.",
    inputs: [
      "identity-decisions.jsonl",
      "classification-decisions.jsonl",
      "canonical-support-mappings.jsonl",
    ],
    outputs: ["library-resolution.json", "scope-checkpoints.jsonl", "blocked-scope-ledger.jsonl"],
    side_effects: ["writes local Foundry artifacts"],
  },
  {
    stage: "scope_run",
    phase: "report",
    purpose:
      "Run only dependency-closed scopes through the local scope runner and keep blocked scopes out of write queues.",
    inputs: ["library-resolution.json", "scope file"],
    outputs: ["scope-checkpoints.jsonl", "blocked-scope-ledger.jsonl"],
    side_effects: ["writes local Foundry artifacts"],
  },
]);

export function createLibraryScopeWorkflowCommands({
  asText,
  booleanOption,
  profileFor,
  repoRoot,
  bundleClassificationPath,
  cloneJson,
  datasetIdentity,
  directoryExists,
  ensureArray,
  fileExists,
  flowTypeOfDataSet,
  jsonSha256,
  nowIso,
  positiveIntegerOption,
  readJson,
  readJsonLines,
  repoRelativeMaybe,
  repoRelativePath,
  resolveRepoPath,
  sha256Text,
  textValue,
  writeJson,
  writeJsonLines,
}: LibraryScopeWorkflowDependencies) {
  function help(command: string, purpose: string, usage: string[]): JsonRecord {
    return {
      schema_version: 1,
      status: "help",
      command,
      purpose,
      usage,
      ...libraryScopeStageContract,
    };
  }

  function listJsonFiles(dir: string): string[] {
    if (!directoryExists(dir)) return [];
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => path.join(dir, entry.name))
      .sort();
  }

  function listDirectoryNames(dir: string): string[] {
    if (!directoryExists(dir)) return [];
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  }

  function sourceDirOption(options: JsonRecord): string | null {
    return resolveRepoPath(options.sourceDir || options.input || options.root);
  }

  function processBundlesDirOption(
    options: JsonRecord,
    sourceDir: string | null = null,
  ): string | null {
    return resolveRepoPath(
      options.processBundlesDir ||
        options.bundlesDir ||
        (sourceDir ? path.join(sourceDir, "process-bundles") : null),
    );
  }

  function libraryIndexDirOption(options: JsonRecord): string | null {
    const resolved = resolveRepoPath(options.libraryIndex || options.indexDir);
    if (!resolved) return null;
    return fileExists(resolved) ? path.dirname(resolved) : resolved;
  }

  const entityProjection = createLibraryEntityProjection({
    asText,
    bundleClassificationPath,
    datasetIdentity,
    ensureArray,
    flowTypeOfDataSet,
    jsonSha256,
    repoRelativeMaybe,
    repoRelativePath,
    sha256Text,
    textValue,
    files: { fileExists, readJson },
  });
  const { entityMaps, rootEntityForRef } = entityProjection;
  const libraryIndexBuild = createLibraryIndexBuild({
    asText,
    ensureArray,
    nowIso,
    repoRelativePath,
    resolveRepoPath,
    projection: entityProjection,
    files: {
      directoryExists,
      fileExists,
      listDirectoryNames,
      listJsonFiles,
      readJson,
      writeJson,
      writeJsonLines,
    },
  });
  const libraryAuthoringPlan = createLibraryAuthoringPlan({
    ensureArray,
    nowIso,
    repoRelativePath,
    files: { fileExists, readJsonLines, writeJson, writeJsonLines },
  });
  const identityPreflightRunner = createLibraryIdentityPreflightRunner({
    asText,
    ensureArray,
    fileExists,
    nowIso,
    readJson,
    readJsonLines,
    repoRelativeMaybe,
    repoRelativePath,
    resolveRepoPath,
    writeJson,
    writeJsonLines,
  });
  const decisionApply = createLibraryDecisionApply({
    asText,
    cloneJson,
    ensureArray,
    jsonSha256,
    nowIso,
    repoRelativeMaybe,
    repoRelativePath,
    rootEntityForRef,
    textValue,
  });
  const readyProcessScopeRunner = createReadyProcessScopeRunner({
    asText,
    ensureArray,
    fileExists,
    nowIso,
    readJson,
    readJsonLines,
    repoRelativeMaybe,
    repoRelativePath,
    resolveArtifactPath: resolveRepoPath,
    writeJson,
    writeJsonLines,
    blockRow: decisionApply.blockRow,
    buildBlockedScopeReport: decisionApply.buildBlockedScopeReport,
  });

  function runDatasetLibraryIndexBuild(options: JsonRecord): JsonRecord {
    if (options.help) {
      return help(
        "dataset-library-index-build",
        "Build root TIDAS unique entity index and process-scope projection for a process-bundled source library.",
        [
          "node scripts/foundry.ts dataset-library-index-build --source-dir <BAFU-root> --process-bundles-dir <BAFU-root>/process-bundles --out-dir <run-dir>/library-index",
        ],
      );
    }
    const sourceDir = sourceDirOption(options);
    if (!sourceDir || !directoryExists(sourceDir)) {
      throw new Error("--source-dir is required and must point to a source library root.");
    }
    const processBundlesDir = processBundlesDirOption(options, sourceDir);
    if (!processBundlesDir || !directoryExists(processBundlesDir)) {
      throw new Error("--process-bundles-dir is required and must point to process-bundles.");
    }
    const outDir = resolveRepoPath(
      options.outDir || path.join(sourceDir, ".foundry", "library-index"),
    )!;
    return libraryIndexBuild.run({ sourceDir, processBundlesDir, outDir });
  }

  function runDatasetLibraryAuthoringPlan(options: JsonRecord): JsonRecord {
    if (options.help) {
      return help(
        "dataset-library-authoring-plan",
        "Create deduplicated AI authoring templates for library-level identity, classification, and canonical support decisions.",
        [
          "node scripts/foundry.ts dataset-library-authoring-plan --library-index <run-dir>/library-index --out-dir <run-dir>/authoring-plan",
        ],
      );
    }
    const indexDir = libraryIndexDirOption(options);
    if (!indexDir) throw new Error("--library-index is required.");
    const outDir = resolveRepoPath(
      options.outDir || path.join(path.dirname(indexDir), "authoring-plan"),
    )!;
    const chunkSize = positiveIntegerOption(options.chunkSize, 200);
    return libraryAuthoringPlan.run({ indexDir, outDir, chunkSize });
  }

  function readDecisionRows(
    decisionsDir: string,
    fileName: string,
    optionValue: unknown,
  ): JsonRecord[] {
    const explicit = resolveRepoPath(optionValue);
    const filePath = explicit || path.join(decisionsDir, fileName);
    return fileExists(filePath) ? readJsonLines(filePath) : [];
  }

  function runDatasetLibraryIdentityDecisionsFromPreflight(options: JsonRecord): JsonRecord {
    if (options.help) {
      return help(
        "dataset-library-identity-decisions-from-preflight",
        "Aggregate elementary-flow identity preflight reports into library-level reuse decisions and manual-review ledgers.",
        [
          "node scripts/foundry.ts dataset-library-identity-decisions-from-preflight --library-index <run-dir>/library-index --identity-preflight-index <identity-preflight-requests.jsonl> --out-dir <run-dir>/decisions",
        ],
      );
    }
    const indexDir = libraryIndexDirOption(options);
    if (!indexDir || !directoryExists(indexDir)) {
      throw new Error("--library-index is required.");
    }
    const entityIndexPath = path.join(indexDir, "library-entity-index.jsonl");
    const scopeProjectionPath = path.join(indexDir, "scope-projection.jsonl");
    if (!fileExists(entityIndexPath) || !fileExists(scopeProjectionPath)) {
      throw new Error(
        "--library-index must contain library-entity-index.jsonl and scope-projection.jsonl.",
      );
    }
    const preflightIndexPath = resolveRepoPath(
      options.identityPreflightIndex || options.preflightIndex || options.index,
    );
    if (!preflightIndexPath || !fileExists(preflightIndexPath)) {
      throw new Error("--identity-preflight-index is required.");
    }
    const outDir = resolveRepoPath(
      options.outDir || path.join(path.dirname(indexDir), "decisions"),
    )!;
    return identityPreflightRunner.run({ indexDir, preflightIndexPath, outDir });
  }

  function runDatasetLibraryDecisionsApply(options: JsonRecord): JsonRecord {
    if (options.help) {
      return help(
        "dataset-library-decisions-apply",
        "Apply library-level decisions to process scopes and defer only scopes with unresolved closure.",
        [
          "node scripts/foundry.ts dataset-library-decisions-apply --library-index <run-dir>/library-index --decisions-dir <run-dir>/decisions --out-dir <run-dir>/library-resolution",
        ],
      );
    }
    const allowAccountLocalSupportAndElementary =
      typeof profileFor === "function"
        ? Boolean(
            profileFor(
              repoRoot,
              asText(options.profile || "generic")
                .trim()
                .toLowerCase(),
              options,
            )?.allowAccountLocalSupportAndElementary,
          )
        : false;
    const indexDir = libraryIndexDirOption(options);
    if (!indexDir) throw new Error("--library-index is required.");
    const entityIndexPath = path.join(indexDir, "library-entity-index.jsonl");
    const scopeProjectionPath = path.join(indexDir, "scope-projection.jsonl");
    if (!fileExists(entityIndexPath) || !fileExists(scopeProjectionPath)) {
      throw new Error(
        "--library-index must contain library-entity-index.jsonl and scope-projection.jsonl.",
      );
    }
    const decisionsDir = resolveRepoPath(options.decisionsDir || options.decisions) || indexDir;
    const outDir = resolveRepoPath(
      options.outDir || path.join(path.dirname(indexDir), "library-resolution"),
    )!;
    const entityRows = readJsonLines(entityIndexPath) as EntityRow[];
    const scopeRows = readJsonLines(scopeProjectionPath) as ScopeProjection[];
    const maps = entityMaps(entityRows);
    const identityRows = readDecisionRows(
      decisionsDir,
      "identity-decisions.jsonl",
      options.identityDecisions,
    );
    const classificationRows = readDecisionRows(
      decisionsDir,
      "classification-decisions.jsonl",
      options.classificationDecisions,
    );
    const supportRows = readDecisionRows(
      decisionsDir,
      "canonical-support-mappings.jsonl",
      options.canonicalSupportMappings,
    );
    const indexes = decisionApply.decisionIndexes({
      identityRows,
      classificationRows,
      supportRows,
    });
    const rewriteScope = (
      scope: ScopeProjection,
      identityByKey: Map<string, JsonRecord>,
    ): ScopeRewriteResult => {
      const processFile = resolveRepoPath(scope.process_file);
      if (!processFile || !fileExists(processFile)) {
        return { rewritten_process_file: null, rewrite_rows: [] };
      }
      const payload = readJson(processFile);
      const rewrite = decisionApply.rewriteProcessExchangeReferences({
        scope,
        payload,
        identityByKey,
        maps,
      });
      if (!rewrite.changed) {
        return { rewritten_process_file: null, rewrite_rows: [] };
      }
      const rewrittenFile = path.join(outDir, "rewritten-processes", `${scope.process_id}.json`);
      writeJson(rewrittenFile, rewrite.payload);
      return {
        rewritten_process_file: repoRelativePath(rewrittenFile),
        rewrite_rows: rewrite.rewrite_rows,
      };
    };
    const projection = decisionApply.projectDecisionApplication({
      scopeRows,
      maps,
      indexes,
      allowAccountLocalSupportAndElementary,
      rewriteScope,
    });

    const checkpointPath = path.join(outDir, "scope-checkpoints.jsonl");
    const blockedPath = path.join(outDir, "blocked-scope-ledger.jsonl");
    const blockedReportPath = path.join(outDir, "blocked-scope-report.json");
    const readyPath = path.join(outDir, "ready-scopes.jsonl");
    const rewritePath = path.join(outDir, "exchange-reference-rewrites.jsonl");
    const resolutionPath = path.join(outDir, "library-resolution.json");
    writeJsonLines(checkpointPath, projection.checkpoints);
    writeJsonLines(blockedPath, projection.blockedLedger);
    const blockedReport = decisionApply.buildBlockedScopeReport({
      command: "dataset-library-decisions-apply",
      blockedRows: projection.blockedLedger,
      blockedLedgerPath: blockedPath,
      reportPath: blockedReportPath,
    });
    writeJson(blockedReportPath, blockedReport);
    writeJsonLines(readyPath, projection.readyScopes);
    writeJsonLines(rewritePath, projection.rewriteRows);
    const resolution = decisionApply.buildLibraryResolution({
      indexDir,
      decisionsDir,
      resolutionPath,
      checkpointPath,
      blockedPath,
      blockedReportPath,
      readyPath,
      rewritePath,
      projection,
      decisionCounts: {
        identity_decisions: identityRows.length,
        classification_decisions: classificationRows.length,
        canonical_support_mappings: supportRows.length,
      },
    });
    writeJson(resolutionPath, resolution);
    return resolution;
  }
  async function runDatasetProcessScopeRun(options: JsonRecord): Promise<JsonRecord> {
    if (options.help) {
      return help(
        "dataset-process-scope-run",
        "Run only ready process scopes through a scope-locked dry-run or commit handoff queue.",
        [
          "node scripts/foundry.ts dataset-process-scope-run --process-bundles-dir <.../process-bundles> --library-resolution <.../library-resolution.json> --scope-file <ready-scopes.jsonl> --parallel 5 --dry-run",
          "node scripts/foundry.ts dataset-process-scope-run --process-bundles-dir <.../process-bundles> --library-resolution <.../library-resolution.json> --scope-file <ready-scopes.jsonl> --parallel 5 --commit",
        ],
      );
    }
    const processBundlesDir = resolveRepoPath(options.processBundlesDir || options.bundlesDir);
    if (!processBundlesDir || !directoryExists(processBundlesDir)) {
      throw new Error("--process-bundles-dir is required.");
    }
    const libraryResolutionPath = resolveRepoPath(options.libraryResolution || options.resolution);
    if (!libraryResolutionPath || !fileExists(libraryResolutionPath)) {
      throw new Error("--library-resolution is required.");
    }
    const resolution = readJson(libraryResolutionPath);
    const scopeFile = resolveRepoPath(readyScopeFileValue(options, resolution));
    const outDir = resolveRepoPath(
      options.outDir || path.join(path.dirname(libraryResolutionPath), "process-scope-run"),
    )!;
    const parallel = positiveIntegerOption(
      options.parallel,
      Math.min(12, Math.max(1, os.cpus().length - 1)),
    );
    const commit = booleanOption(options.commit);
    const dryRun = booleanOption(options.dryRun) || !commit;
    return readyProcessScopeRunner.run({
      processBundlesDir,
      libraryResolutionPath,
      resolution,
      scopeFile,
      outDir,
      parallel,
      commit,
      dryRun,
      commandCwd: process.cwd(),
      commandEnvironment: process.env,
    });
  }

  return {
    runDatasetLibraryIndexBuild,
    runDatasetLibraryAuthoringPlan,
    runDatasetLibraryIdentityDecisionsFromPreflight,
    runDatasetLibraryDecisionsApply,
    runDatasetProcessScopeRun,
    libraryScopeWorkflowTestHooks: {
      evaluateElementaryIdentityDecision:
        identityPreflightRunner.evaluateElementaryIdentityDecision,
      traceCompartment: identityPreflightRunner.traceCompartment,
      entitySourceClassification: identityPreflightRunner.entitySourceClassification,
      openLcaCompartmentClassification: identityPreflightRunner.openLcaCompartmentClassification,
    },
  };
}

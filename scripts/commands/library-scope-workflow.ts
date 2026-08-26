import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  createLibraryEntityProjection,
  type DatasetIdentity,
  type EntityRow,
  type JsonRecord,
  type ScopeProjection,
} from "../lib/library-orchestration/entity-projection.ts";
import { createLibraryAuthoringPlan } from "../lib/library-orchestration/authoring-plan.ts";
import { createLibraryIndexBuild } from "../lib/library-orchestration/index-build.ts";
import {
  evaluateElementaryIdentityDecision as evaluateElementaryIdentityDecisionPure,
  openLcaCompartmentClassification,
  traceCompartment,
  type ElementaryIdentityEvaluationInput,
  type SourceClassification,
} from "../lib/library-orchestration/elementary-identity.ts";
import {
  identityPreflightArtifactPaths,
  projectLibraryElementaryIdentityDecisions,
  type IdentityPreflightProjectionEntry,
} from "../lib/library-orchestration/identity-preflight-projection.ts";
import {
  createLibraryDecisionApply,
  type ScopeRewriteResult,
} from "../lib/library-orchestration/decision-apply.ts";
import { readOnlyStageContract } from "../lib/stage-contract.ts";

interface SelectedScope extends JsonRecord {
  process_id: string;
  process_version: string;
  state: string;
  bundle_dir: unknown;
  rewritten_process_file: unknown;
  commit_command: string[];
  verify_command: string[];
}

interface ScopeCommandOptions {
  cwd: string;
  logDir: string;
  token: string;
  stage: string;
}

interface LibraryScopeWorkflowDependencies {
  asText: (value: unknown) => string;
  booleanOption: (value: unknown, fallback?: boolean) => boolean;
  profileFor: (repoRoot: string, profileId: string, options?: JsonRecord) => JsonRecord;
  repoRoot: string;
  bundleClassificationPath: (payload: unknown, datasetType: string) => unknown;
  cloneJson: <T>(value: T) => T;
  datasetIdentity: (row: unknown, datasetType: string) => DatasetIdentity;
  directoryExists: (filePath: string | null | undefined) => boolean;
  ensureArray: <T>(value: T | readonly T[] | null | undefined) => T[];
  fileExists: (filePath: string | null | undefined) => boolean;
  flowTypeOfDataSet: (payload: unknown) => string;
  jsonSha256: (value: unknown) => string;
  nowIso: () => string;
  positiveIntegerOption: (value: unknown, fallback: number) => number;
  readJson: (filePath: string) => JsonRecord;
  readJsonLines: (filePath: string) => JsonRecord[];
  repoRelativeMaybe: (filePath: string | null | undefined) => string | null;
  repoRelativePath: (filePath: string) => string;
  resolveRepoPath: (filePath: unknown) => string | null;
  sha256Text: (value: unknown) => string;
  textValue: (value: unknown) => string;
  writeJson: (filePath: string, value: unknown) => void;
  writeJsonLines: (filePath: string, rows: readonly unknown[]) => void;
}

function isJsonRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function jsonRecord(value: unknown): JsonRecord {
  return isJsonRecord(value) ? value : {};
}

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

  function normalizedText(value: unknown): string {
    return String(value ?? "")
      .trim()
      .replace(/\s+/gu, " ")
      .toLowerCase();
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

  const sourceClassificationCache = new Map<string, SourceClassification | null>();

  function entitySourceClassification(entity: EntityRow): SourceClassification | null {
    // The BAFU→TIDAS conversion writes a uniform default elementaryFlowCategorization
    // ("Emissions to air, unspecified") on every elementary flow, but preserves the real
    // ecoinvent compartment in tidasimport:sourceTrace.payload.sourceClassification.
    const sourceFile = asText(entity.source_file) || asText(ensureArray(entity.source_files)[0]);
    if (!sourceFile) return null;
    if (sourceClassificationCache.has(sourceFile)) {
      return sourceClassificationCache.get(sourceFile) ?? null;
    }
    let result: SourceClassification | null = null;
    const resolved = resolveRepoPath(sourceFile);
    if (resolved && fileExists(resolved)) {
      try {
        const payload = readJson(resolved);
        const dataSetInformation = jsonRecord(
          jsonRecord(jsonRecord(payload.flowDataSet).flowInformation).dataSetInformation,
        );
        const sourceTrace = jsonRecord(
          jsonRecord(dataSetInformation["common:other"])["tidasimport:sourceTrace"],
        );
        const tracePayload = jsonRecord(sourceTrace.payload);
        const trace = jsonRecord(tracePayload.sourceClassification);
        if (Object.keys(trace).length > 0) {
          const category = normalizedText(trace.category || trace.localCategory);
          const subCategory = normalizedText(trace.subCategory || trace.localSubCategory);
          if (category) result = { category, subCategory };
        }
        // openLCA JSON-LD lane: the converter writes the same uniform "air, unspecified"
        // default as the BAFU lane and preserves the real FEDEFL compartment only in the
        // entity trace ("Elementary flows/emission/air/troposphere/rural"). Recover it.
        if (!result && normalizedText(tracePayload.format) === "openlca-jsonld") {
          const tracedEntity = jsonRecord(jsonRecord(tracePayload.payload).entity);
          result = openLcaCompartmentClassification(tracedEntity.category);
        }
      } catch {
        result = null;
      }
    }
    sourceClassificationCache.set(sourceFile, result);
    return result;
  }

  function evaluateElementaryIdentityDecision(input: ElementaryIdentityEvaluationInput) {
    return evaluateElementaryIdentityDecisionPure({
      ...input,
      sourceClassification: entitySourceClassification(input.entity),
    });
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
    const entityRows = readJsonLines(entityIndexPath) as EntityRow[];
    const projectionRows = readJsonLines(scopeProjectionPath) as ScopeProjection[];
    const preflightRows = readJsonLines(preflightIndexPath);
    const preflights: IdentityPreflightProjectionEntry[] = preflightRows.map((row) => {
      const { reportPath, candidatesPath } = identityPreflightArtifactPaths(row, resolveRepoPath);
      let report: JsonRecord | null = null;
      if (reportPath && fileExists(reportPath)) {
        try {
          report = readJson(reportPath);
        } catch {
          report = null;
        }
      }
      return { row, report, reportPath, candidatesPath };
    });
    const { elementaryRows, decisions, manualReviewRows, reasonCounts } =
      projectLibraryElementaryIdentityDecisions({
        entityRows,
        projectionRows,
        preflights,
        sourceClassificationForEntity: entitySourceClassification,
        repoRelativeMaybe,
      });

    const decisionPath = path.join(outDir, "identity-decisions.jsonl");
    const manualReviewPath = path.join(outDir, "identity-decisions.manual-review.jsonl");
    const reportPath = path.join(
      outDir,
      "dataset-library-identity-decisions-from-preflight-report.json",
    );
    writeJsonLines(decisionPath, decisions);
    writeJsonLines(manualReviewPath, manualReviewRows);
    const report = {
      schema_version: 1,
      generated_at_utc: nowIso(),
      status: manualReviewRows.length > 0 ? "completed_with_manual_review" : "completed",
      command: "dataset-library-identity-decisions-from-preflight",
      library_index: repoRelativePath(indexDir),
      identity_preflight_index: repoRelativePath(preflightIndexPath),
      counts: {
        elementary_flows: elementaryRows.length,
        reuse_existing_reference: decisions.length,
        manual_review: manualReviewRows.length,
        preflight_rows: preflightRows.length,
      },
      reason_counts: reasonCounts,
      files: {
        report: repoRelativePath(reportPath),
        identity_decisions: repoRelativePath(decisionPath),
        manual_review: repoRelativePath(manualReviewPath),
      },
      policy: {
        elementary_flows_reference_only: true,
        create_new_for_elementary_flows: "forbidden",
        automatic_reuse_requires_physical_equivalence: true,
      },
      blockers: manualReviewRows.slice(0, 25).map((row) => ({
        code: row.reason,
        dataset_id: row.source_dataset_id,
        dataset_version: row.source_dataset_version,
        message:
          "Elementary flow identity requires human review before dependent process scopes can write.",
      })),
    };
    writeJson(reportPath, report);
    return report;
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

  function scopeRowsFromFile(scopeFile: string | null): JsonRecord[] {
    if (!scopeFile || !fileExists(scopeFile)) return [];
    if (scopeFile.toLowerCase().endsWith(".jsonl")) return readJsonLines(scopeFile);
    const value: unknown = readJson(scopeFile);
    if (Array.isArray(value)) return value;
    const record = jsonRecord(value);
    if (Array.isArray(record.rows)) return record.rows.map(jsonRecord);
    if (Array.isArray(record.scopes)) return record.scopes.map(jsonRecord);
    return [record];
  }

  function commandArrayFromScope(scope: JsonRecord, key: string): string[] {
    const value =
      scope[key] ||
      jsonRecord(scope.checkpoint)[key] ||
      jsonRecord(scope.handoff)[key] ||
      jsonRecord(scope.commit_handoff)[key];
    if (Array.isArray(value)) return value.map(String).filter(Boolean);
    return [];
  }

  function runScopeHandoffCommand(
    argv: string[],
    { cwd, logDir, token, stage }: ScopeCommandOptions,
  ): JsonRecord | null {
    if (!Array.isArray(argv) || argv.length === 0) return null;
    const stdoutLog = path.join(logDir, `${token}.${stage}.stdout.log`);
    const stderrLog = path.join(logDir, `${token}.${stage}.stderr.log`);
    const result = spawnSync(argv[0], argv.slice(1), {
      cwd,
      env: process.env,
      encoding: "utf8",
    });
    fs.mkdirSync(logDir, { recursive: true });
    fs.writeFileSync(stdoutLog, result.stdout || "");
    fs.writeFileSync(stderrLog, result.stderr || "");
    const exitCode = typeof result.status === "number" ? result.status : 1;
    if (result.error) {
      return {
        stage,
        command: argv,
        exit_code: exitCode,
        error: String(result.error?.message || result.error),
        stdout_log: repoRelativePath(stdoutLog),
        stderr_log: repoRelativePath(stderrLog),
      };
    }
    return {
      stage,
      command: argv,
      exit_code: exitCode,
      stdout_log: repoRelativePath(stdoutLog),
      stderr_log: repoRelativePath(stderrLog),
    };
  }

  function runDatasetProcessScopeRun(options: JsonRecord): JsonRecord {
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
    const scopeFile = resolveRepoPath(
      options.scopeFile || jsonRecord(resolution.files).ready_scopes,
    );
    const scopeRows = scopeRowsFromFile(scopeFile);
    const readyIds = new Set(ensureArray(resolution.ready_scope_ids).map(asText));
    const outDir = resolveRepoPath(
      options.outDir || path.join(path.dirname(libraryResolutionPath), "process-scope-run"),
    )!;
    const parallel = positiveIntegerOption(
      options.parallel,
      Math.min(12, Math.max(1, os.cpus().length - 1)),
    );
    const commit = booleanOption(options.commit);
    const dryRun = booleanOption(options.dryRun) || !commit;
    const checkpoints: JsonRecord[] = [];
    const blocked: JsonRecord[] = [];
    const selectedScopes: SelectedScope[] = scopeRows.map((scope) => ({
      process_id: asText(scope.process_id || scope.id),
      process_version: asText(scope.process_version || scope.version) || "00.00.001",
      state: asText(scope.state || scope.closure_status || jsonRecord(scope.checkpoint).state),
      bundle_dir: scope.bundle_dir,
      rewritten_process_file:
        scope.rewritten_process_file || jsonRecord(scope.checkpoint).rewritten_process_file,
      commit_command: commandArrayFromScope(scope, "commit_command"),
      verify_command: commandArrayFromScope(scope, "verify_command"),
    }));
    const logDir = path.join(outDir, "logs");
    for (const scope of selectedScopes) {
      const isReady =
        readyIds.has(scope.process_id) || scope.state === "ready" || scope.state === "";
      if (!isReady) {
        const row = decisionApply.blockRow(
          scope,
          { dataset_type: "process", id: scope.process_id, version: scope.process_version },
          "scope_not_ready",
          "Only dependency-closed ready scopes can enter dry-run/write/verify queues.",
          "Resolve this scope in dataset-library-decisions-apply and rerun with the ready scope file.",
        );
        blocked.push(row);
        checkpoints.push({
          schema_version: 1,
          process_id: scope.process_id,
          process_version: scope.process_version,
          state: "blocked_deferred",
          reason: "scope_not_ready",
        });
        continue;
      }
      const commandStages: Array<JsonRecord | null> = [];
      let state = dryRun ? "dry_run_planned" : "commit_handoff_planned";
      if (commit && scope.commit_command.length > 0) {
        const token = `${scope.process_id}-${scope.process_version}`.replace(
          /[^A-Za-z0-9_.-]+/gu,
          "-",
        );
        const commitStage = runScopeHandoffCommand(scope.commit_command, {
          cwd: process.cwd(),
          logDir,
          token,
          stage: "commit",
        });
        commandStages.push(commitStage);
        if (commitStage?.exit_code === 0 && scope.verify_command.length > 0) {
          const verifyStage = runScopeHandoffCommand(scope.verify_command, {
            cwd: process.cwd(),
            logDir,
            token,
            stage: "verify",
          });
          commandStages.push(verifyStage);
          state = verifyStage?.exit_code === 0 ? "verified" : "verify_failed";
        } else {
          state = commitStage?.exit_code === 0 ? "committed" : "commit_failed";
        }
      }
      checkpoints.push({
        schema_version: 1,
        process_id: scope.process_id,
        process_version: scope.process_version,
        state,
        scope_lock: `process:${scope.process_id}:${scope.process_version}`,
        parallel,
        bundle_dir: scope.bundle_dir,
        rewritten_process_file: scope.rewritten_process_file,
        remote_write_mode: commit ? "commit_handoff_required" : "read-only",
        command_stages: commandStages.filter(Boolean),
      });
    }
    const checkpointPath = path.join(outDir, "scope-checkpoints.jsonl");
    const blockedPath = path.join(outDir, "blocked-scope-ledger.jsonl");
    const blockedReportPath = path.join(outDir, "blocked-scope-report.json");
    const reportPath = path.join(outDir, "dataset-process-scope-run-report.json");
    writeJsonLines(checkpointPath, checkpoints);
    writeJsonLines(blockedPath, blocked);
    const blockedReport = decisionApply.buildBlockedScopeReport({
      command: "dataset-process-scope-run",
      blockedRows: blocked,
      blockedLedgerPath: blockedPath,
      reportPath: blockedReportPath,
    });
    writeJson(blockedReportPath, blockedReport);
    const commandFailures = checkpoints.filter((row) =>
      ["commit_failed", "verify_failed"].includes(asText(row.state)),
    );
    const report = {
      schema_version: 1,
      generated_at_utc: nowIso(),
      status:
        commandFailures.length > 0
          ? "failed"
          : blocked.length > 0
            ? "completed_with_deferred_scopes"
            : "completed",
      command: "dataset-process-scope-run",
      process_bundles_dir: repoRelativePath(processBundlesDir),
      library_resolution: repoRelativePath(libraryResolutionPath),
      scope_file: repoRelativeMaybe(scopeFile),
      mode: commit ? "commit" : "dry-run",
      parallel,
      counts: {
        selected_scopes: selectedScopes.length,
        ready_scopes_planned: checkpoints.filter((row) =>
          ["dry_run_planned", "commit_handoff_planned"].includes(asText(row.state)),
        ).length,
        committed: checkpoints.filter((row) => row.state === "committed").length,
        verified: checkpoints.filter((row) => row.state === "verified").length,
        command_failures: commandFailures.length,
        blocked_scopes_deferred: blocked.length,
      },
      files: {
        report: repoRelativePath(reportPath),
        scope_checkpoints: repoRelativePath(checkpointPath),
        blocked_scope_ledger: repoRelativePath(blockedPath),
        blocked_scope_report: repoRelativePath(blockedReportPath),
      },
      policy: {
        ready_only_commit: true,
        blocked_scopes_do_not_enter_write_queue: true,
        process_scope_locking: true,
        commit_mode_requires_existing_finalize_mutation_handoff_verify_chain:
          "This command executes scope-provided commit/verify handoff commands only after the existing finalize/mutation-manifest/commit-handoff/post-write-verify chain has produced them. Without handoff commands, it creates scope-locked commit_handoff_planned checkpoints.",
      },
      blockers: commandFailures.map((row) => ({
        code: row.state,
        message: "Scope handoff command failed; inspect command stage logs.",
        process_id: row.process_id,
        process_version: row.process_version,
        command_stages: row.command_stages,
      })),
    };
    writeJson(reportPath, report);
    return report;
  }

  return {
    runDatasetLibraryIndexBuild,
    runDatasetLibraryAuthoringPlan,
    runDatasetLibraryIdentityDecisionsFromPreflight,
    runDatasetLibraryDecisionsApply,
    runDatasetProcessScopeRun,
    libraryScopeWorkflowTestHooks: {
      evaluateElementaryIdentityDecision,
      traceCompartment,
      entitySourceClassification,
      openLcaCompartmentClassification,
    },
  };
}

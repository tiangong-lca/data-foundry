import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { buildBafuLeafCategoryMapProjectReport } from "../lib/bafu-classification/category-map-report.ts";
import {
  parseBafuFlowProductCategorySchema,
  parseBafuProcessCategorySchema,
  projectBafuLeafCategoryMapArtifacts,
  type BafuLeafCategoryMapHelpers,
  type BafuLeafCategorySchema,
} from "../lib/bafu-classification/category-map-projection.ts";
import {
  extractBafuLeafProcessPayloadContext,
  projectBafuLeafClassificationTaskArtifacts,
  type BafuLeafTaskProjectionHelpers,
} from "../lib/bafu-classification/task-preparation.ts";
import { resolveInstalledTiangongLcaCliPackage } from "../lib/foundry-runtime-utils.ts";

interface JsonRecord {
  [key: string]: unknown;
}

interface BafuLeafRuntime {
  asText: (value: unknown) => string;
  ensureArray: (value: unknown) => unknown[];
  integerOption: (value: unknown, fallback?: number | null) => number | null;
  positiveIntegerOption: (value: unknown, fallback?: number | null) => number | null;
  resolveRepoPath: (filePath: unknown) => string | null;
  repoRelativeMaybe: (filePath: string | null | undefined) => string | null;
  readJson: (filePath: string) => unknown;
  readJsonLines: (filePath: string) => unknown[];
  writeJson: (filePath: string, value: unknown) => void;
  writeJsonLines: (filePath: string, rows: readonly unknown[]) => void;
  nowIso: () => string;
}

const prepareCommandName = "dataset-bafu-leaf-classification-tasks-prepare";
const projectCommandName = "dataset-bafu-leaf-classification-category-map-project";
const DEFAULT_SHARD_SIZE = 100;
const DEFAULT_MAX_EXCHANGE_REFS = 48;
const DEFAULT_MAX_REFERENCES = 48;

function installedCliSchemaPath(fileName: string): string {
  return path.join(resolveInstalledTiangongLcaCliPackage().schemaDir, fileName);
}

const bafuLeafRuntimeKeys = [
  "asText",
  "ensureArray",
  "integerOption",
  "positiveIntegerOption",
  "resolveRepoPath",
  "repoRelativeMaybe",
  "readJson",
  "readJsonLines",
  "writeJson",
  "writeJsonLines",
  "nowIso",
] as const satisfies readonly (keyof BafuLeafRuntime)[];

let bafuLeafRuntime: BafuLeafRuntime | null = null;

function installBafuLeafRuntime(deps: BafuLeafRuntime): void {
  const missing = bafuLeafRuntimeKeys.filter((key) => typeof deps?.[key] !== "function");
  if (missing.length > 0) {
    throw new Error(
      `createBafuLeafClassificationTaskCommands missing dependencies: ${missing.join(", ")}`,
    );
  }
  bafuLeafRuntime = deps;
}

function runtime(): BafuLeafRuntime {
  if (!bafuLeafRuntime) {
    throw new Error("createBafuLeafClassificationTaskCommands must install command dependencies.");
  }
  return bafuLeafRuntime;
}

function asText(value: unknown): string {
  return runtime().asText(value);
}

function ensureArray(value: unknown): unknown[] {
  return runtime().ensureArray(value);
}

function integerOption(value: unknown, fallback: number | null = null): number | null {
  return runtime().integerOption(value, fallback);
}

function positiveIntegerOption(value: unknown, fallback: number | null = null): number | null {
  return runtime().positiveIntegerOption(value, fallback);
}

function resolveRepoPath(filePath: unknown): string | null {
  return runtime().resolveRepoPath(filePath);
}

function repoRelative(filePath: string | null | undefined): string | null {
  return runtime().repoRelativeMaybe(filePath);
}

function readJson(filePath: string): JsonRecord {
  return runtime().readJson(filePath) as JsonRecord;
}

function readJsonLines(filePath: string): JsonRecord[] {
  return runtime().readJsonLines(filePath) as JsonRecord[];
}

function copyFileIfExists(sourcePath: string | null, targetPath: string): boolean {
  if (!sourcePath || !fs.existsSync(sourcePath)) return false;
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.copyFileSync(sourcePath, targetPath);
  return true;
}

function optionList(value: unknown): unknown[] {
  if (value === undefined || value === null || value === true || value === "") return [];
  return Array.isArray(value) ? value : [value];
}

function writeJson(filePath: string, value: unknown): void {
  runtime().writeJson(filePath, value);
}

function writeJsonLines(filePath: string, rows: readonly unknown[]): void {
  runtime().writeJsonLines(filePath, rows);
}

function sha256File(filePath: string): string {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

const bafuLeafTaskProjectionHelpers: BafuLeafTaskProjectionHelpers = {
  textValue: asText,
  ensureArray,
};

const bafuLeafCategoryMapHelpers: BafuLeafCategoryMapHelpers = {
  textValue: asText,
  ensureArray,
  reportPath: (filePath) => repoRelative(filePath),
};

function readOptionalProcessContext(filePath: unknown): JsonRecord | null {
  const resolved = resolveRepoPath(filePath);
  if (!resolved || !fs.existsSync(resolved)) return null;
  try {
    return extractBafuLeafProcessPayloadContext(readJson(resolved), bafuLeafTaskProjectionHelpers);
  } catch {
    return null;
  }
}

function libraryIndexPaths(inputPath: unknown): {
  indexDir: string;
  entityIndex: string;
  scopeProjection: string;
} {
  const resolved = resolveRepoPath(inputPath);
  if (!resolved || !fs.existsSync(resolved)) {
    throw new Error("--library-index must point to a library index directory.");
  }
  const stats = fs.statSync(resolved);
  const indexDir = stats.isDirectory() ? resolved : path.dirname(resolved);
  return {
    indexDir,
    entityIndex: path.join(indexDir, "library-entity-index.jsonl"),
    scopeProjection: path.join(indexDir, "scope-projection.jsonl"),
  };
}

function loadProcessCategorySchema(schemaPath: unknown): BafuLeafCategorySchema {
  const resolved =
    resolveRepoPath(schemaPath) || installedCliSchemaPath("tidas_processes_category.json");
  if (!resolved || !fs.existsSync(resolved)) {
    throw new Error(
      "--process-category-schema is required unless the installed @tiangong-lca/cli@0.1.8 process category schema exists.",
    );
  }
  return parseBafuProcessCategorySchema({
    path: resolved,
    schema: readJson(resolved),
    helpers: bafuLeafCategoryMapHelpers,
  });
}

function loadFlowProductCategorySchema(schemaPath: unknown): BafuLeafCategorySchema {
  const resolved =
    resolveRepoPath(schemaPath) || installedCliSchemaPath("tidas_flows_product_category.json");
  if (!resolved || !fs.existsSync(resolved)) {
    throw new Error(
      "--flow-product-category-schema is required unless the installed @tiangong-lca/cli@0.1.8 flow product category schema exists.",
    );
  }
  return parseBafuFlowProductCategorySchema({
    path: resolved,
    schema: readJson(resolved),
    helpers: bafuLeafCategoryMapHelpers,
  });
}

function categoryMapDecisionFiles(rawOptions: JsonRecord): string[] {
  const explicitFiles = optionList(
    rawOptions.categoryMapDecisions || rawOptions.categoryDecisions || rawOptions.decisions,
  )
    .map(resolveRepoPath)
    .filter((filePath): filePath is string => Boolean(filePath));
  if (explicitFiles.length > 0) return explicitFiles;
  const decisionsDir = resolveRepoPath(
    rawOptions.categoryMapDecisionsDir ||
      rawOptions.categoryDecisionsDir ||
      rawOptions.categoryMapDir,
  );
  if (!decisionsDir || !fs.existsSync(decisionsDir)) {
    throw new Error(
      "--category-map-decisions-dir or --category-map-decisions is required for category-map projection.",
    );
  }
  return fs
    .readdirSync(decisionsDir)
    .filter((name) => name.endsWith(".jsonl"))
    .sort()
    .map((name) => path.join(decisionsDir, name));
}

export function prepareBafuLeafClassificationTasks(rawOptions: JsonRecord): JsonRecord {
  if (rawOptions.help) {
    return {
      schema_version: 1,
      status: "help",
      command: prepareCommandName,
      usage: [
        "node scripts/foundry.ts dataset-bafu-leaf-classification-tasks-prepare --library-index <library-index-dir> --blocked-ledger <blocked-scope-ledger.jsonl> --out-dir <task-dir> [--library-decisions <classification-decisions.jsonl>] [--shard-size 100]",
      ],
      purpose:
        "Prepare sharded AI authoring tasks for BAFU process classifications blocked by leaf gating.",
    };
  }

  const libraryIndexInput = rawOptions.libraryIndex || rawOptions.index;
  const blockedLedgerPath = resolveRepoPath(rawOptions.blockedLedger || rawOptions.ledger);
  if (!libraryIndexInput) throw new Error("--library-index is required.");
  if (!blockedLedgerPath || !fs.existsSync(blockedLedgerPath)) {
    throw new Error("--blocked-ledger must point to blocked-scope-ledger.jsonl.");
  }
  const { indexDir, entityIndex, scopeProjection } = libraryIndexPaths(libraryIndexInput);
  if (!fs.existsSync(entityIndex) || !fs.existsSync(scopeProjection)) {
    throw new Error(
      "--library-index must contain library-entity-index.jsonl and scope-projection.jsonl.",
    );
  }

  const outDir = resolveRepoPath(
    rawOptions.outDir || ".foundry/workspaces/bafu-leaf-classification-authoring",
  )!;
  const shardSize =
    positiveIntegerOption(rawOptions.shardSize, DEFAULT_SHARD_SIZE) ?? DEFAULT_SHARD_SIZE;
  const offset = Math.max(0, integerOption(rawOptions.offset, 0) ?? 0);
  const limit = integerOption(rawOptions.limit, null);
  const options = {
    maxExchangeRefs:
      positiveIntegerOption(rawOptions.maxExchangeRefs, DEFAULT_MAX_EXCHANGE_REFS) ??
      DEFAULT_MAX_EXCHANGE_REFS,
    maxReferences:
      positiveIntegerOption(rawOptions.maxReferences, DEFAULT_MAX_REFERENCES) ??
      DEFAULT_MAX_REFERENCES,
  };

  const entityRows = readJsonLines(entityIndex);
  const scopeRows = readJsonLines(scopeProjection);
  const blockedRows = readJsonLines(blockedLedgerPath);
  const decisionsPath = resolveRepoPath(rawOptions.libraryDecisions || rawOptions.decisions);
  const decisionRows =
    decisionsPath && fs.existsSync(decisionsPath) ? readJsonLines(decisionsPath) : [];

  const taskIndexPath = path.join(outDir, "leaf-process-classification-tasks.jsonl");
  const templatePath = path.join(outDir, "classification-decisions.template.jsonl");
  const reportPath = path.join(outDir, "leaf-process-classification-task-report.json");
  const shardsDir = path.join(outDir, "shards");
  const decisionsExist = Boolean(decisionsPath && fs.existsSync(decisionsPath));
  const projection = projectBafuLeafClassificationTaskArtifacts({
    entityRows,
    scopeRows,
    blockedRows,
    decisionRows,
    helpers: bafuLeafTaskProjectionHelpers,
    readProcessContext: readOptionalProcessContext,
    selection: {
      offset,
      limit,
      shardSize,
      maxExchangeRefs: options.maxExchangeRefs,
      maxReferences: options.maxReferences,
    },
    report: {
      generatedAtUtc: runtime().nowIso(),
      command: prepareCommandName,
      inputs: {
        library_index: repoRelative(indexDir),
        library_entity_index: repoRelative(entityIndex),
        scope_projection: repoRelative(scopeProjection),
        blocked_ledger: repoRelative(blockedLedgerPath),
        library_decisions: decisionsExist ? repoRelative(decisionsPath) : null,
      },
      inputHashes: {
        library_entity_index_sha256: sha256File(entityIndex),
        scope_projection_sha256: sha256File(scopeProjection),
        blocked_ledger_sha256: sha256File(blockedLedgerPath),
        library_decisions_sha256: decisionsExist ? sha256File(decisionsPath!) : null,
      },
      files: {
        report: repoRelative(reportPath),
        tasks: repoRelative(taskIndexPath),
        template: repoRelative(templatePath),
        shardTasks: (shardId) =>
          repoRelative(path.join(shardsDir, `leaf-process-classification-tasks-${shardId}.jsonl`)),
        shardTemplate: (shardId) =>
          repoRelative(path.join(shardsDir, `classification-decisions-${shardId}.template.jsonl`)),
      },
    },
  });

  writeJsonLines(taskIndexPath, projection.tasks);
  writeJsonLines(templatePath, projection.templates);
  for (const shard of projection.shards) {
    writeJsonLines(
      path.join(shardsDir, `leaf-process-classification-tasks-${shard.shardId}.jsonl`),
      shard.tasks,
    );
    writeJsonLines(
      path.join(shardsDir, `classification-decisions-${shard.shardId}.template.jsonl`),
      shard.templates,
    );
  }
  writeJson(reportPath, projection.report);
  return projection.report;
}

export function projectBafuLeafCategoryMapDecisions(rawOptions: JsonRecord): JsonRecord {
  if (rawOptions.help) {
    return {
      schema_version: 1,
      status: "help",
      command: projectCommandName,
      usage: [
        "node scripts/foundry.ts dataset-bafu-leaf-classification-category-map-project --task-dir <leaf-authoring-dir> --category-map-decisions-dir <category-map-decisions-dir> --source-decisions-dir <run-dir>/decisions --out-dir <run-dir>/decisions-v4-leaf-category-map --process-category-schema <tidas_processes_category.json> [--flow-product-category-schema <tidas_flows_product_category.json>]",
      ],
      purpose:
        "Project task-bound BAFU category-cluster process leaf decisions into library-level classification-decisions.jsonl, while writing rule-derived suggestions only as non-authoritative candidate rows.",
    };
  }

  const taskDir = resolveRepoPath(rawOptions.taskDir || rawOptions.authoringDir);
  const tasksPath = resolveRepoPath(
    rawOptions.tasks ||
      rawOptions.leafTasks ||
      (taskDir ? path.join(taskDir, "leaf-process-classification-tasks.jsonl") : null),
  );
  if (!tasksPath || !fs.existsSync(tasksPath)) {
    throw new Error(
      "--task-dir or --tasks is required and must point to leaf-process-classification-tasks.jsonl.",
    );
  }
  const sourceDecisionsDir = resolveRepoPath(
    rawOptions.sourceDecisionsDir ||
      rawOptions.baseDecisionsDir ||
      rawOptions.libraryDecisionsDir ||
      rawOptions.decisionsDir,
  );
  if (!sourceDecisionsDir || !fs.existsSync(sourceDecisionsDir)) {
    throw new Error(
      "--source-decisions-dir must point to the current library decisions directory.",
    );
  }
  const outDir = resolveRepoPath(
    rawOptions.outDir || path.join(path.dirname(sourceDecisionsDir), "decisions-leaf-projected"),
  )!;
  const processSchema = loadProcessCategorySchema(rawOptions.processCategorySchema);
  const flowProductSchema = loadFlowProductCategorySchema(rawOptions.flowProductCategorySchema);
  const tasks = readJsonLines(tasksPath);
  const originalClassificationPath = path.join(
    sourceDecisionsDir,
    "classification-decisions.jsonl",
  );
  const originalClassificationRows = fs.existsSync(originalClassificationPath)
    ? readJsonLines(originalClassificationPath)
    : [];
  const categoryDecisionPaths = categoryMapDecisionFiles(rawOptions);
  const projection = projectBafuLeafCategoryMapArtifacts({
    tasks,
    originalClassificationRows,
    categoryDecisionSources: categoryDecisionPaths.map((file) => ({
      file,
      rows: readJsonLines(file),
    })),
    processSchema,
    flowProductSchema,
    helpers: bafuLeafCategoryMapHelpers,
  });

  const classificationOut = path.join(outDir, "classification-decisions.jsonl");
  const manualReviewOut = path.join(outDir, "classification-decisions.manual-review.jsonl");
  const processLeafCandidatesOut = path.join(
    outDir,
    "process-leaf-classification-candidates.jsonl",
  );
  const flowProductCandidatesOut = path.join(
    outDir,
    "flow-product-classification-candidates.jsonl",
  );
  const categoryManualReviewOut = path.join(outDir, "category-map-decisions.manual-review.jsonl");
  const reportPath = path.join(outDir, "bafu-leaf-category-map-project-report.json");

  writeJsonLines(classificationOut, projection.classificationRows);
  writeJsonLines(manualReviewOut, [
    ...projection.projectionManualReview,
    ...projection.flowProductManualReview,
  ]);
  writeJsonLines(processLeafCandidatesOut, projection.processLeafCandidates);
  writeJsonLines(flowProductCandidatesOut, projection.flowProductCandidates);
  writeJsonLines(categoryManualReviewOut, projection.categoryManualReview);

  const copiedDecisionFiles: string[] = [];
  for (const fileName of ["identity-decisions.jsonl", "canonical-support-mappings.jsonl"]) {
    const copied = copyFileIfExists(
      path.join(sourceDecisionsDir, fileName),
      path.join(outDir, fileName),
    );
    if (copied) copiedDecisionFiles.push(fileName);
  }

  const report = buildBafuLeafCategoryMapProjectReport(projection, {
    generatedAtUtc: runtime().nowIso(),
    command: projectCommandName,
    inputs: {
      tasks: repoRelative(tasksPath),
      source_decisions_dir: repoRelative(sourceDecisionsDir),
      process_category_schema: repoRelative(processSchema.path),
      flow_product_category_schema: repoRelative(flowProductSchema.path),
      category_map_decisions: projection.categoryMap.files.map(repoRelative),
    },
    inputHashes: {
      tasks_sha256: sha256File(tasksPath),
      process_category_schema_sha256: sha256File(processSchema.path),
      flow_product_category_schema_sha256: sha256File(flowProductSchema.path),
      classification_decisions_sha256: fs.existsSync(originalClassificationPath)
        ? sha256File(originalClassificationPath)
        : null,
      category_map_decisions_sha256: projection.categoryMap.files.map((filePath) => ({
        file: repoRelative(filePath),
        sha256: sha256File(filePath),
      })),
    },
    copiedDecisionFiles,
    files: {
      report: repoRelative(reportPath),
      classificationDecisions: repoRelative(classificationOut),
      projectionManualReview: repoRelative(manualReviewOut),
      processLeafCandidates: repoRelative(processLeafCandidatesOut),
      flowProductCandidates: repoRelative(flowProductCandidatesOut),
      categoryManualReview: repoRelative(categoryManualReviewOut),
      copiedDecisionFiles: copiedDecisionFiles.map((fileName) =>
        repoRelative(path.join(outDir, fileName)),
      ),
    },
    nextStep:
      "Run dataset-library-decisions-apply with this output directory, then continue only ready scopes.",
  });
  writeJson(reportPath, report);
  return report;
}

export function createBafuLeafClassificationTaskCommands(deps: BafuLeafRuntime): {
  runDatasetBafuLeafClassificationTasksPrepare: typeof prepareBafuLeafClassificationTasks;
  runDatasetBafuLeafClassificationCategoryMapProject: typeof projectBafuLeafCategoryMapDecisions;
} {
  installBafuLeafRuntime(deps);
  return {
    runDatasetBafuLeafClassificationTasksPrepare: prepareBafuLeafClassificationTasks,
    runDatasetBafuLeafClassificationCategoryMapProject: projectBafuLeafCategoryMapDecisions,
  };
}

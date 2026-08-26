import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  categoryKeyForLeafTask,
  categoryKeyForMapDecision,
  classificationDecisionIsBroadFlowProduct,
  classificationRepairCandidate,
  compactExistingDecision,
  repairBroadFlowProductDecision,
  repairProcessLeafDecision,
  sourceClassificationFromTask,
} from "../lib/bafu-classification/leaf-repair.ts";
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

interface CategoryEntry extends JsonRecord {
  code: string;
  level: string | null;
  label: string | null;
}

interface CategorySchema {
  path: string;
  entries: CategoryEntry[];
  byCode: Map<string, CategoryEntry>;
  leafCodes: Set<string>;
}

interface ProjectedDecisionInput {
  task: JsonRecord;
  categoryKey: string;
  decision: ResolvedCategoryDecision;
}

interface EnrichedCategoryDecision {
  row: JsonRecord;
  categoryKey: string;
  file: string;
  lineIndex: number;
}

interface ResolvedCategoryDecision {
  categoryKey: string;
  code: string;
  label: string | null;
  schemaLevel: string | null;
  row: JsonRecord;
  file: string;
  lineIndex: number;
}

interface CategoryMapDecisionResult {
  files: string[];
  rows: EnrichedCategoryDecision[];
  resolved: Map<string, ResolvedCategoryDecision>;
  manualReview: JsonRecord[];
}

function isJsonRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function jsonRecord(value: unknown): JsonRecord {
  return isJsonRecord(value) ? value : {};
}

const prepareCommandName = "dataset-bafu-leaf-classification-tasks-prepare";
const projectCommandName = "dataset-bafu-leaf-classification-category-map-project";
const DEFAULT_SHARD_SIZE = 100;
const DEFAULT_MAX_EXCHANGE_REFS = 48;
const DEFAULT_MAX_REFERENCES = 48;
const DEFAULT_TEXT_LIMIT = 2400;

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

function truncateText(value: unknown, maxLength = DEFAULT_TEXT_LIMIT): string | null {
  const text = asText(value);
  if (!text || text.length <= maxLength) return text || null;
  return `${text.slice(0, maxLength)}...`;
}

const bafuLeafTaskProjectionHelpers: BafuLeafTaskProjectionHelpers = {
  textValue: asText,
  ensureArray,
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

function entityKey(type: string, id: string, version: string): string {
  return `${type}:${id}:${version}`;
}

function classificationLibraryKey(row: JsonRecord): string {
  const categoryType = asText(row?.category_type ?? row?.schema_type);
  const datasetType =
    asText(row?.dataset_type ?? row?.type) ||
    (categoryType === "process"
      ? "process"
      : categoryType === "flow-product" || categoryType === "flow-elementary"
        ? "flow"
        : categoryType);
  return [
    datasetType,
    asText(row?.dataset_id ?? row?.datasetId ?? row?.id ?? row?.uuid),
    asText(row?.dataset_version ?? row?.datasetVersion ?? row?.version) || "00.00.001",
  ].join(":");
}

function collectCategorySchemaEntries(schema: JsonRecord): CategoryEntry[] {
  const byCode = new Map<string, CategoryEntry>();
  const visit = (value: unknown): void => {
    if (!value || typeof value !== "object") return;
    const record = jsonRecord(value);
    const properties = jsonRecord(record.properties);
    const code = asText(jsonRecord(properties["@classId"]).const);
    if (code && !byCode.has(code)) {
      byCode.set(code, {
        code,
        level: asText(jsonRecord(properties["@level"]).const) || null,
        label: asText(jsonRecord(properties["#text"]).const) || null,
      });
    }
    for (const child of Object.values(value)) visit(child);
  };
  visit(schema);
  return [...byCode.values()];
}

function loadProcessCategorySchema(schemaPath: unknown): CategorySchema {
  const resolved =
    resolveRepoPath(schemaPath) || installedCliSchemaPath("tidas_processes_category.json");
  if (!resolved || !fs.existsSync(resolved)) {
    throw new Error(
      "--process-category-schema is required unless the installed @tiangong-lca/cli@0.1.1 process category schema exists.",
    );
  }
  const schema = readJson(resolved);
  const entries = ensureArray(schema.oneOf ?? schema.anyOf)
    .map(jsonRecord)
    .map((entry): CategoryEntry | null => {
      const properties = jsonRecord(entry.properties);
      const code = asText(jsonRecord(properties["@classId"]).const);
      if (!code) return null;
      return {
        code,
        level: asText(jsonRecord(properties["@level"]).const) || null,
        label: asText(jsonRecord(properties["#text"]).const) || null,
      };
    })
    .filter((entry): entry is CategoryEntry => Boolean(entry));
  const byCode = new Map(entries.map((entry) => [entry.code, entry]));
  const leafCodes = new Set(
    entries
      .filter((entry) => /^\d{4}$/u.test(entry.code) || entry.level === "3")
      .map((entry) => entry.code),
  );
  return {
    path: resolved,
    entries,
    byCode,
    leafCodes,
  };
}

function loadFlowProductCategorySchema(schemaPath: unknown): CategorySchema {
  const resolved =
    resolveRepoPath(schemaPath) || installedCliSchemaPath("tidas_flows_product_category.json");
  if (!resolved || !fs.existsSync(resolved)) {
    throw new Error(
      "--flow-product-category-schema is required unless the installed @tiangong-lca/cli@0.1.1 flow product category schema exists.",
    );
  }
  const entries = collectCategorySchemaEntries(readJson(resolved));
  const byCode = new Map(entries.map((entry) => [entry.code, entry]));
  const leafCodes = new Set(
    entries
      .filter(
        (entry) =>
          !entries.some(
            (candidate) =>
              candidate.code !== entry.code &&
              candidate.code.startsWith(entry.code) &&
              Number(candidate.level) > Number(entry.level),
          ),
      )
      .map((entry) => entry.code),
  );
  return {
    path: resolved,
    entries,
    byCode,
    leafCodes,
  };
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

function completedCategoryMapDecision(row: JsonRecord): boolean {
  return asText(row?.decision_status ?? row?.decisionStatus ?? row?.status) === "completed";
}

function categoryMapDecisionCode(row: JsonRecord): string {
  return asText(row?.selected_code ?? row?.selectedCode ?? row?.code);
}

function readCategoryMapDecisions(
  rawOptions: JsonRecord,
  processSchema: CategorySchema,
): CategoryMapDecisionResult {
  const files = categoryMapDecisionFiles(rawOptions);
  const byCategory = new Map<string, EnrichedCategoryDecision[]>();
  const rows: EnrichedCategoryDecision[] = [];
  for (const filePath of files) {
    for (const [lineIndex, row] of readJsonLines(filePath).entries()) {
      const categoryKey = categoryKeyForMapDecision(row);
      const enriched = {
        row,
        categoryKey,
        file: filePath,
        lineIndex: lineIndex + 1,
      };
      rows.push(enriched);
      if (!categoryKey) continue;
      const entry = byCategory.get(categoryKey) ?? [];
      entry.push(enriched);
      byCategory.set(categoryKey, entry);
    }
  }

  const resolved = new Map<string, ResolvedCategoryDecision>();
  const manualReview: JsonRecord[] = [];
  for (const [categoryKey, decisionRows] of byCategory.entries()) {
    const completedRows = decisionRows.filter(({ row }) => completedCategoryMapDecision(row));
    if (completedRows.length === 0) {
      manualReview.push({
        schema_version: 1,
        category_key: categoryKey,
        status: "manual_review",
        reason: "category_map_decision_not_completed",
        decision_rows: decisionRows.map(({ file, lineIndex, row }) => ({
          file: repoRelative(file),
          line: lineIndex,
          decision_status: asText(row?.decision_status ?? row?.status) || null,
          basis: truncateText(row?.basis),
        })),
        required_human_action:
          "Provide a completed category-map decision with a valid TIDAS process leaf code.",
      });
      continue;
    }
    const uniqueCodes = [...new Set(completedRows.map(({ row }) => categoryMapDecisionCode(row)))];
    if (uniqueCodes.length !== 1) {
      manualReview.push({
        schema_version: 1,
        category_key: categoryKey,
        status: "manual_review",
        reason: "category_map_decision_conflict",
        selected_codes: uniqueCodes,
        decision_rows: completedRows.map(({ file, lineIndex, row }) => ({
          file: repoRelative(file),
          line: lineIndex,
          selected_code: categoryMapDecisionCode(row) || null,
          basis: truncateText(row?.basis),
        })),
        required_human_action:
          "Resolve conflicting category-map decisions to one TIDAS process leaf code.",
      });
      continue;
    }
    const code = uniqueCodes[0] ?? "";
    const schemaEntry = processSchema.byCode.get(code);
    if (!code || !processSchema.leafCodes.has(code) || !schemaEntry) {
      manualReview.push({
        schema_version: 1,
        category_key: categoryKey,
        status: "manual_review",
        reason: "category_map_decision_code_invalid",
        selected_code: code || null,
        decision_rows: completedRows.map(({ file, lineIndex }) => ({
          file: repoRelative(file),
          line: lineIndex,
        })),
        required_human_action:
          "Replace the selected code with a valid TIDAS process leaf code from the process category schema.",
      });
      continue;
    }
    const chosen = completedRows[0];
    const contextBundleSha256 = asText(
      jsonRecord(chosen.row.authoring_context).context_bundle_sha256,
    );
    if (!contextBundleSha256) {
      manualReview.push({
        schema_version: 1,
        category_key: categoryKey,
        status: "manual_review",
        reason: "category_map_decision_context_bundle_missing",
        selected_code: code,
        decision_rows: completedRows.map(({ file, lineIndex }) => ({
          file: repoRelative(file),
          line: lineIndex,
        })),
        required_human_action:
          "Regenerate this category-map decision from an exact AI task bundle and include authoring_context.context_bundle_sha256 before projection.",
      });
      continue;
    }
    resolved.set(categoryKey, {
      categoryKey,
      code,
      label: schemaEntry.label,
      schemaLevel: schemaEntry.level,
      row: chosen.row,
      file: chosen.file,
      lineIndex: chosen.lineIndex,
    });
  }
  return {
    files,
    rows,
    resolved,
    manualReview,
  };
}

function projectedClassificationDecision({
  task,
  categoryKey,
  decision,
}: ProjectedDecisionInput): JsonRecord {
  const processId = asText(task.dataset_id);
  const processVersion = asText(task.dataset_version) || "00.00.001";
  const decisionRow = decision.row;
  const decisionEvidence = jsonRecord(decisionRow.evidence);
  const processContext = jsonRecord(task.process_context);
  const libraryIndexContext = jsonRecord(task.library_index_context);
  const exchangeContext = jsonRecord(task.exchange_context);
  const decisionTemplate = jsonRecord(task.decision_template);
  const templateEvidence = jsonRecord(decisionTemplate.evidence);
  return {
    schema_version: 1,
    dataset_type: "process",
    dataset_id: processId,
    dataset_version: processVersion,
    entity_key: task.entity_key ?? entityKey("process", processId, processVersion),
    category_type: "process",
    decision_status: "completed",
    selected_code: decision.code,
    code: decision.code,
    selected_label: decision.label ?? (asText(decisionRow.selected_label) || null),
    basis:
      asText(decisionRow.basis) ||
      `Projected from completed BAFU source category mapping ${categoryKey}.`,
    confidence: asText(decisionRow.confidence) || null,
    authoring_context: decisionRow.authoring_context ?? null,
    classification_decision_level: "leaf",
    source_name: processContext.name ?? null,
    converted_classification_reference: processContext.converted_classification_path ?? null,
    converted_classification_reference_policy: "weak_hint_only",
    used_context_kinds: [
      ...new Set([
        ...ensureArray(decisionRow.used_context_kinds),
        "library_entity_index",
        "scope_projection",
        "blocked_scope_ledger",
        "process_payload_context",
        "process_exchange_context",
        "bafu_category_map_decision",
        "tidas_process_category_schema",
      ]),
    ],
    evidence: {
      source: "bafu_process_leaf_category_map_projection",
      category_key: categoryKey,
      category_decision: {
        file: repoRelative(decision.file),
        line: decision.lineIndex,
        selected_code: decision.code,
        selected_label: decision.label ?? (asText(decisionRow.selected_label) || null),
        basis: truncateText(decisionRow.basis),
        confidence: asText(decisionRow.confidence) || null,
        category_semantics: truncateText(decisionEvidence.category_semantics),
        examples_used: ensureArray(decisionEvidence.examples_used),
      },
      task: {
        task_id: task.task_id ?? null,
        process_id: processId,
        process_version: processVersion,
        source_file: libraryIndexContext.root_process_file ?? null,
        bundle_process_file: libraryIndexContext.bundle_process_file ?? null,
        payload_sha256: libraryIndexContext.payload_sha256 ?? null,
        name_parts: processContext.name_parts ?? null,
        source_classification: sourceClassificationFromTask(task),
        output_flows: exchangeContext.output_flows ?? null,
      },
      broad_decision_replaced:
        templateEvidence.broad_decision_replaced ?? task.existing_library_decision ?? null,
    },
  };
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
  const categoryMap = readCategoryMapDecisions(rawOptions, processSchema);

  const originalByKey = new Map<string, JsonRecord>(
    originalClassificationRows.map((row) => [classificationLibraryKey(row), row]),
  );
  const projectedRows: JsonRecord[] = [];
  const projectionManualReview: JsonRecord[] = [];
  const processLeafCandidates: JsonRecord[] = [];
  const flowProductCandidates: JsonRecord[] = [];
  const flowProductManualReview: JsonRecord[] = [];
  const categoriesSeenByTasks = new Map();

  for (const task of tasks) {
    const categoryKey = categoryKeyForLeafTask(task);
    if (!categoriesSeenByTasks.has(categoryKey)) {
      categoriesSeenByTasks.set(categoryKey, {
        category_key: categoryKey || null,
        affected_process_count: 0,
        examples: [],
      });
    }
    const categorySummary = categoriesSeenByTasks.get(categoryKey);
    categorySummary.affected_process_count += 1;
    if (categorySummary.examples.length < 8) {
      categorySummary.examples.push({
        dataset_id: task.dataset_id,
        dataset_version: task.dataset_version,
        name: jsonRecord(task.process_context).name ?? null,
      });
    }

    const processKey = classificationLibraryKey({
      dataset_type: "process",
      dataset_id: task.dataset_id,
      dataset_version: task.dataset_version,
      category_type: "process",
    });
    const decision = categoryMap.resolved.get(categoryKey);
    if (!decision) {
      const repaired = repairProcessLeafDecision({
        task,
        categoryKey,
        existingDecision: compactExistingDecision(originalByKey.get(processKey)),
        processSchema,
      });
      if (repaired) {
        const candidate = classificationRepairCandidate(repaired, {
          candidateType: "process_leaf",
          ruleSource: "bafu_process_leaf_repair",
        });
        processLeafCandidates.push(candidate);
      }
      projectionManualReview.push({
        schema_version: 1,
        status: "manual_review",
        reason: repaired
          ? "category_map_decision_missing_with_rule_candidate"
          : categoryKey
            ? "category_map_decision_missing_or_unresolved"
            : "task_source_category_key_missing",
        category_key: categoryKey || null,
        dataset_type: "process",
        dataset_id: task.dataset_id,
        dataset_version: task.dataset_version,
        source_classification: sourceClassificationFromTask(task),
        existing_decision: compactExistingDecision(originalByKey.get(processKey)),
        candidate_decision: repaired
          ? {
              selected_code: repaired.selected_code,
              selected_label: repaired.selected_label,
              repair_rule: jsonRecord(repaired.evidence).repair_rule ?? null,
              candidate_file: "process-leaf-classification-candidates.jsonl",
            }
          : null,
        required_human_action:
          "Provide a completed task-bound category-map/process leaf decision with authoring_context.context_bundle_sha256, then rerun projection and library decisions apply.",
      });
      continue;
    }
    const projected = projectedClassificationDecision({ task, categoryKey, decision });
    originalByKey.set(processKey, projected);
    projectedRows.push(projected);
  }

  for (const [decisionKey, decision] of [...originalByKey.entries()]) {
    if (!classificationDecisionIsBroadFlowProduct(decision)) continue;
    const repaired = repairBroadFlowProductDecision(decision, flowProductSchema);
    if (repaired) {
      flowProductCandidates.push(
        classificationRepairCandidate(repaired, {
          candidateType: "flow_product_leaf",
          ruleSource: "bafu_flow_product_leaf_repair",
        }),
      );
    }
    flowProductManualReview.push({
      schema_version: 1,
      status: "manual_review",
      reason: repaired
        ? "flow_product_classification_decision_not_leaf_with_rule_candidate"
        : "flow_product_classification_decision_not_leaf",
      decision_key: decisionKey,
      dataset_type: decision.dataset_type ?? "flow",
      dataset_id: decision.dataset_id ?? null,
      dataset_version: decision.dataset_version ?? null,
      category_type: decision.category_type ?? "flow-product",
      selected_code: decision.selected_code ?? decision.code ?? null,
      existing_decision: compactExistingDecision(decision),
      candidate_decision: repaired
        ? {
            selected_code: repaired.selected_code,
            selected_label: repaired.selected_label,
            repair_rule: jsonRecord(repaired.evidence).repair_rule ?? null,
            candidate_file: "flow-product-classification-candidates.jsonl",
          }
        : null,
      required_human_action:
        "Replace the broad flow-product classification with a full TIDAS flow-product leaf code selected through dataset classification children/path, include authoring_context.context_bundle_sha256, then rerun this projection.",
    });
    originalByKey.delete(decisionKey);
  }

  const classificationRows = [...originalByKey.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, row]) => row);
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

  writeJsonLines(classificationOut, classificationRows);
  writeJsonLines(manualReviewOut, [...projectionManualReview, ...flowProductManualReview]);
  writeJsonLines(processLeafCandidatesOut, processLeafCandidates);
  writeJsonLines(flowProductCandidatesOut, flowProductCandidates);
  const categoryManualReview = [
    ...categoryMap.manualReview,
    ...[...categoriesSeenByTasks.values()]
      .filter(
        (category) => category.category_key && !categoryMap.resolved.has(category.category_key),
      )
      .map((category) => ({
        schema_version: 1,
        status: "manual_review",
        reason: "category_map_decision_missing_or_unresolved",
        ...category,
        required_human_action:
          "Provide a completed task-bound category-map process leaf decision for this BAFU source category.",
      })),
  ];
  writeJsonLines(categoryManualReviewOut, categoryManualReview);

  const copiedDecisionFiles = [];
  for (const fileName of ["identity-decisions.jsonl", "canonical-support-mappings.jsonl"]) {
    const copied = copyFileIfExists(
      path.join(sourceDecisionsDir, fileName),
      path.join(outDir, fileName),
    );
    if (copied) copiedDecisionFiles.push(fileName);
  }

  const report = {
    schema_version: 1,
    generated_at_utc: runtime().nowIso(),
    status:
      projectionManualReview.length > 0 || flowProductManualReview.length > 0
        ? "completed_with_manual_review"
        : "completed",
    command: projectCommandName,
    inputs: {
      tasks: repoRelative(tasksPath),
      source_decisions_dir: repoRelative(sourceDecisionsDir),
      process_category_schema: repoRelative(processSchema.path),
      flow_product_category_schema: repoRelative(flowProductSchema.path),
      category_map_decisions: categoryMap.files.map(repoRelative),
    },
    input_hashes: {
      tasks_sha256: sha256File(tasksPath),
      process_category_schema_sha256: sha256File(processSchema.path),
      flow_product_category_schema_sha256: sha256File(flowProductSchema.path),
      classification_decisions_sha256: fs.existsSync(originalClassificationPath)
        ? sha256File(originalClassificationPath)
        : null,
      category_map_decisions_sha256: categoryMap.files.map((filePath) => ({
        file: repoRelative(filePath),
        sha256: sha256File(filePath),
      })),
    },
    counts: {
      tasks: tasks.length,
      task_categories: categoriesSeenByTasks.size,
      process_category_schema_entries: processSchema.entries.length,
      process_category_leaf_codes: processSchema.leafCodes.size,
      flow_product_category_schema_entries: flowProductSchema.entries.length,
      flow_product_category_leaf_codes: flowProductSchema.leafCodes.size,
      original_classification_decisions: originalClassificationRows.length,
      category_map_decision_rows: categoryMap.rows.length,
      category_map_resolved: categoryMap.resolved.size,
      category_map_manual_review: categoryMap.manualReview.length,
      projected_process_decisions: projectedRows.length,
      process_leaf_classification_candidates: processLeafCandidates.length,
      flow_product_classification_candidates: flowProductCandidates.length,
      classification_decisions_out: classificationRows.length,
      projection_manual_review_rows: projectionManualReview.length + flowProductManualReview.length,
      flow_product_manual_review_rows: flowProductManualReview.length,
      category_manual_review_rows: categoryManualReview.length,
    },
    copied_decision_files: copiedDecisionFiles,
    policy: {
      tidas_tools_classification_policy: "weak_hint_only",
      ai_decision_boundary:
        "Category-map decisions are semantic AI choices. This command validates task-bound leaf codes and deterministically projects only those choices; BAFU repair rules are emitted as non-authoritative candidates.",
      manual_review_policy:
        "Unresolved, missing, conflicting, invalid, unbound, or rule-candidate-only category decisions are not projected; affected process scopes remain blocked_deferred on the next library decisions apply.",
    },
    files: {
      report: repoRelative(reportPath),
      classification_decisions: repoRelative(classificationOut),
      projection_manual_review: repoRelative(manualReviewOut),
      process_leaf_classification_candidates: repoRelative(processLeafCandidatesOut),
      flow_product_classification_candidates: repoRelative(flowProductCandidatesOut),
      category_manual_review: repoRelative(categoryManualReviewOut),
      copied_decision_files: copiedDecisionFiles.map((fileName) =>
        repoRelative(path.join(outDir, fileName)),
      ),
    },
    next_step:
      "Run dataset-library-decisions-apply with this output directory, then continue only ready scopes.",
  };
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

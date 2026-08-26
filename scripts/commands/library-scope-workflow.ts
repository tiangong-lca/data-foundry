import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  createLibraryEntityProjection,
  type BundleEntry,
  type DatasetIdentity,
  type EntityMaps,
  type EntityRow,
  type JsonRecord,
  type ScopeProjection,
} from "../lib/library-orchestration/entity-projection.ts";
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
import { readOnlyStageContract } from "../lib/stage-contract.ts";

interface RewriteResult extends JsonRecord {
  rewritten_process_file: string | null;
  rewrite_rows: JsonRecord[];
}

interface ReasonAccumulator {
  reason: string;
  blocked_ledger_rows: number;
  blocked_scope_ids: Set<string>;
  blocking_dependency_types: Map<string, number>;
  messages: Set<string>;
  required_human_actions: Set<string>;
  sample_blocking_dependencies: JsonRecord[];
}

interface ScopeAccumulator {
  process_id: string;
  process_version: string;
  blocker_count: number;
  reasons: Map<string, number>;
  sample_blocking_dependencies: JsonRecord[];
  rerun_commands: Set<string>;
}

interface BlockedScopeReportInput {
  command: string;
  blockedRows: JsonRecord[];
  blockedLedgerPath: string;
  reportPath: string;
}

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

interface CanonicalTarget extends JsonRecord {
  id: string;
  version: string;
  uri: string;
  short_description: string;
  type: string;
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

const indexedEntityTypes = ["process", "flow", "flowproperty", "unitgroup"] as const;
type IndexedEntityType = (typeof indexedEntityTypes)[number];

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
  const typePlural: Record<IndexedEntityType, string> = {
    process: "processes",
    flow: "flows",
    flowproperty: "flowproperties",
    unitgroup: "unitgroups",
  };

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
  const { entityMaps, projectionForBundle, rootEntityForRef } = entityProjection;

  function buildEntityIndex(sourceDir: string): EntityRow[] {
    const sourceFiles = indexedEntityTypes.flatMap((type) =>
      listJsonFiles(path.join(sourceDir, "tidas", typePlural[type])).map((sourceFile) => ({
        type,
        sourceFile,
        sourceKind: "root_tidas",
      })),
    );
    return entityProjection.buildEntityIndex(sourceFiles);
  }

  function processBundleEntries(processBundlesDir: string): BundleEntry[] {
    function resolveBundlePath(value: unknown, expectedKind: "file" | "dir"): string | null {
      if (!value) return null;
      const text = asText(value);
      if (path.isAbsolute(text)) return text;
      const fromBundleRoot = path.join(processBundlesDir, text);
      if (
        (expectedKind === "file" && fileExists(fromBundleRoot)) ||
        (expectedKind === "dir" && directoryExists(fromBundleRoot))
      ) {
        return fromBundleRoot;
      }
      return resolveRepoPath(text);
    }
    const indexFile = path.join(processBundlesDir, "index.json");
    if (fileExists(indexFile)) {
      const index = readJson(indexFile);
      return ensureArray(index.bundles).map((value) => {
        const bundle = jsonRecord(value);
        const manifest = resolveBundlePath(bundle.manifest, "file");
        const tidasDir = resolveBundlePath(bundle.tidas_dir, "dir");
        const bundleDir = manifest
          ? path.dirname(manifest)
          : tidasDir
            ? path.dirname(tidasDir)
            : path.join(processBundlesDir, asText(bundle.process_id));
        return {
          process_id: asText(bundle.process_id),
          bundle_id: asText(bundle.bundle_id ?? bundle.process_id),
          bundle_dir: bundleDir,
          manifest: manifest || path.join(bundleDir, "manifest.json"),
          tidas_dir: tidasDir || path.join(bundleDir, "tidas"),
          index_row: bundle,
        };
      });
    }
    if (!directoryExists(processBundlesDir)) return [];
    return fs
      .readdirSync(processBundlesDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => {
        const bundleDir = path.join(processBundlesDir, entry.name);
        return {
          process_id: entry.name,
          bundle_id: entry.name,
          bundle_dir: bundleDir,
          manifest: path.join(bundleDir, "manifest.json"),
          tidas_dir: path.join(bundleDir, "tidas"),
          index_row: null,
        };
      })
      .filter((entry) => fileExists(entry.manifest))
      .sort((left, right) => left.process_id.localeCompare(right.process_id));
  }

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
    const entityRows = buildEntityIndex(sourceDir);
    const maps = entityMaps(entityRows);
    const projectionRows = processBundleEntries(processBundlesDir).map((bundle) =>
      projectionForBundle(bundle, maps),
    );
    const entityIndexPath = path.join(outDir, "library-entity-index.jsonl");
    const scopeProjectionPath = path.join(outDir, "scope-projection.jsonl");
    const reportPath = path.join(outDir, "dataset-library-index-build-report.json");
    writeJsonLines(entityIndexPath, entityRows);
    writeJsonLines(scopeProjectionPath, projectionRows);
    const countsByType = Object.fromEntries(
      indexedEntityTypes.map((type) => [
        type,
        entityRows.filter((row) => row.dataset_type === type).length,
      ]),
    );
    const report = {
      schema_version: 1,
      generated_at_utc: nowIso(),
      status: "completed",
      command: "dataset-library-index-build",
      source_dir: repoRelativePath(sourceDir),
      process_bundles_dir: repoRelativePath(processBundlesDir),
      counts: {
        unique_entities: entityRows.length,
        process_scopes: projectionRows.length,
        ...countsByType,
        elementary_flows: entityRows.filter(
          (row) => row.dataset_type === "flow" && /^elementary flow$/iu.test(row.flow_type ?? ""),
        ).length,
        reference_only_support: entityRows.filter((row) =>
          ["flowproperty", "unitgroup"].includes(row.dataset_type),
        ).length,
      },
      files: {
        report: repoRelativePath(reportPath),
        library_entity_index: repoRelativePath(entityIndexPath),
        scope_projection: repoRelativePath(scopeProjectionPath),
      },
      policy: {
        root_tidas_is_unique_entity_source: true,
        process_bundles_index_is_scope_projection_source: true,
      },
      blockers: [],
    };
    writeJson(reportPath, report);
    return report;
  }

  function chunkRows<T>(rows: T[], chunkSize: number): T[][] {
    const chunks: T[][] = [];
    for (let index = 0; index < rows.length; index += chunkSize) {
      chunks.push(rows.slice(index, index + chunkSize));
    }
    return chunks;
  }

  function writeChunkFiles<T>(
    outDir: string,
    stem: string,
    rows: T[],
    chunkSize: number,
  ): string[] {
    const chunksDir = path.join(outDir, "chunks");
    return chunkRows(rows, chunkSize).map((chunk, index) => {
      const filePath = path.join(
        chunksDir,
        `${stem}.chunk-${String(index + 1).padStart(4, "0")}.jsonl`,
      );
      writeJsonLines(filePath, chunk);
      return repoRelativePath(filePath);
    });
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
    const entityIndexPath = path.join(indexDir, "library-entity-index.jsonl");
    const scopeProjectionPath = path.join(indexDir, "scope-projection.jsonl");
    if (!fileExists(entityIndexPath) || !fileExists(scopeProjectionPath)) {
      throw new Error(
        "--library-index must contain library-entity-index.jsonl and scope-projection.jsonl.",
      );
    }
    const outDir = resolveRepoPath(
      options.outDir || path.join(path.dirname(indexDir), "authoring-plan"),
    )!;
    const chunkSize = positiveIntegerOption(options.chunkSize, 200);
    const entityRows = readJsonLines(entityIndexPath) as EntityRow[];
    const projectionRows = readJsonLines(scopeProjectionPath) as ScopeProjection[];
    const usedEntityKeys = new Set(
      projectionRows.flatMap((scope) => [
        scope.process_entity_key,
        ...ensureArray(scope.dependency_ids?.flows).map((dep) => dep.entity_key),
        ...ensureArray(scope.dependency_ids?.flowproperties).map((dep) => dep.entity_key),
        ...ensureArray(scope.dependency_ids?.unitgroups).map((dep) => dep.entity_key),
      ]),
    );
    const identityTemplateRows = entityRows
      .filter(
        (row) =>
          row.dataset_type === "flow" &&
          /^elementary flow$/iu.test(row.flow_type ?? "") &&
          usedEntityKeys.has(row.entity_key),
      )
      .map((row) => ({
        schema_version: 1,
        decision: "__AI_DECIDE_REUSE_EXISTING_REFERENCE_OR_BLOCK__",
        dataset_type: "flow",
        source_dataset_id: row.dataset_id,
        source_dataset_version: row.dataset_version,
        source_entity_key: row.entity_key,
        source_name: row.name,
        flow_type: row.flow_type,
        classification_path: row.classification_path,
        required_resolution:
          "If physically identity-equivalent to an existing TianGong elementary flow, return reuse_existing_reference with canonical_flow_id/version and evidence. Otherwise return manual_review/block_unresolved.",
      }));
    const classificationTemplateRows = entityRows
      .filter(
        (row) =>
          usedEntityKeys.has(row.entity_key) &&
          (row.dataset_type === "process" ||
            (row.dataset_type === "flow" && !/^elementary flow$/iu.test(row.flow_type ?? ""))),
      )
      .map((row) => ({
        schema_version: 1,
        dataset_type: row.dataset_type,
        dataset_id: row.dataset_id,
        dataset_version: row.dataset_version,
        entity_key: row.entity_key,
        category_type: row.dataset_type === "process" ? "process" : "flow-product",
        selected_code: "__AI_SELECT_CLASSIFICATION_CODE__",
        basis: "__AI_WRITE_MEANING_BASED_BASIS__",
        confidence: "__AI_CONFIDENCE__",
        source_name: row.name,
        converted_classification_reference: row.classification_path,
        required_resolution:
          "Classify from the real meaning of the process/flow. Converter classification is weak reference only.",
      }));
    const supportTemplateRows = entityRows
      .filter(
        (row) =>
          usedEntityKeys.has(row.entity_key) &&
          ["flowproperty", "unitgroup"].includes(row.dataset_type),
      )
      .map((row) => ({
        schema_version: 1,
        support_type: row.dataset_type,
        source_support_id: row.dataset_id,
        source_support_version: row.dataset_version,
        source_entity_key: row.entity_key,
        source_name: row.name,
        source_units: row.units ?? null,
        source_reference_unit_group: row.reference_unit_group ?? null,
        canonical_support_id: "__AI_OR_HUMAN_SELECT_CANONICAL_SUPPORT_ID__",
        canonical_support_version: "__AI_OR_HUMAN_SELECT_CANONICAL_SUPPORT_VERSION__",
        physical_dimension_evidence: "__REQUIRED_FOR_AUTOMATIC_MAPPING_OR_LEAVE_BLOCKED__",
        required_resolution:
          "Map generated support to public canonical support only when unit/physical dimension equivalence is proven; otherwise leave blocked for human support authoring.",
      }));

    const identityPath = path.join(outDir, "identity-decisions.template.jsonl");
    const classificationPathOut = path.join(outDir, "classification-decisions.template.jsonl");
    const supportPath = path.join(outDir, "canonical-support-mappings.template.jsonl");
    writeJsonLines(identityPath, identityTemplateRows);
    writeJsonLines(classificationPathOut, classificationTemplateRows);
    writeJsonLines(supportPath, supportTemplateRows);
    const chunkFiles = [
      ...writeChunkFiles(outDir, "identity-decisions", identityTemplateRows, chunkSize),
      ...writeChunkFiles(outDir, "classification-decisions", classificationTemplateRows, chunkSize),
      ...writeChunkFiles(outDir, "canonical-support-mappings", supportTemplateRows, chunkSize),
    ];
    const reportPath = path.join(outDir, "dataset-library-authoring-plan-report.json");
    const actionItems =
      identityTemplateRows.length + classificationTemplateRows.length + supportTemplateRows.length;
    const report = {
      schema_version: 1,
      generated_at_utc: nowIso(),
      status: actionItems > 0 ? "ready_for_ai_library_decisions" : "ready_no_action_items",
      command: "dataset-library-authoring-plan",
      library_index: repoRelativePath(indexDir),
      counts: {
        identity_decisions: identityTemplateRows.length,
        classification_decisions: classificationTemplateRows.length,
        canonical_support_mappings: supportTemplateRows.length,
        action_items: actionItems,
        chunks: chunkFiles.length,
      },
      files: {
        report: repoRelativePath(reportPath),
        identity_decisions_template: repoRelativePath(identityPath),
        classification_decisions_template: repoRelativePath(classificationPathOut),
        canonical_support_mappings_template: repoRelativePath(supportPath),
        chunks: chunkFiles,
      },
      blockers: [],
    };
    writeJson(reportPath, report);
    return report;
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

  function identityDecisionKey(row: JsonRecord): string {
    return [
      "flow",
      asText(row.source_dataset_id || row.dataset_id || row.source_flow_id || row.id),
      asText(row.source_dataset_version || row.dataset_version || row.version) || "00.00.001",
    ].join(":");
  }

  function classificationDecisionDatasetType(row: JsonRecord): string {
    const explicitType = asText(row.dataset_type || row.type);
    if (explicitType) {
      return explicitType;
    }
    const categoryType = asText(row.category_type || row.schema_type);
    if (categoryType === "process") {
      return "process";
    }
    if (categoryType === "flow-product" || categoryType === "flow-elementary") {
      return "flow";
    }
    return categoryType;
  }

  function classificationDecisionKey(row: JsonRecord): string {
    return [
      classificationDecisionDatasetType(row),
      asText(row.dataset_id || row.id),
      asText(row.dataset_version || row.version) || "00.00.001",
    ].join(":");
  }

  function supportDecisionKey(row: JsonRecord): string {
    return [
      asText(row.support_type || row.dataset_type || row.type),
      asText(row.source_support_id || row.dataset_id || row.id),
      asText(row.source_support_version || row.dataset_version || row.version) || "00.00.001",
    ].join(":");
  }

  function canonicalTarget(row: JsonRecord | null | undefined, type: string): CanonicalTarget {
    const source = row ?? {};
    const target = jsonRecord(source.canonical_target || source.target);
    return {
      id: asText(
        source.canonical_flow_id ||
          source.canonical_support_id ||
          source.canonical_id ||
          source.target_dataset_id ||
          target.id,
      ),
      version:
        asText(
          source.canonical_flow_version ||
            source.canonical_support_version ||
            source.canonical_version ||
            source.target_dataset_version ||
            target.version,
        ) || "00.00.001",
      uri: asText(source.canonical_uri || target.uri),
      short_description: textValue(
        source.canonical_short_description || source.short_description || target.short_description,
      ),
      type,
    };
  }

  function classificationDecisionCode(row: JsonRecord | null | undefined): string {
    const source = row ?? {};
    return asText(
      source.selected_code || source.code || source.leaf_code || source.class_id || source.cat_id,
    );
  }

  function decisionIsCompleteClassification(
    row: JsonRecord | null | undefined,
    { datasetType = null }: { datasetType?: string | null } = {},
  ): boolean {
    const code = classificationDecisionCode(row);
    if (!code) return false;
    const categoryType = asText(row?.category_type ?? row?.categoryType);
    if (datasetType === "process" || categoryType === "process") {
      const level = asText(row?.classification_decision_level ?? row?.classificationDecisionLevel);
      if (level === "broad_section") return false;
      if (/^[A-Z]$/u.test(code) || /^\d{1,3}$/u.test(code)) return false;
    }
    if (categoryType === "flow-product") {
      const level = asText(row?.classification_decision_level ?? row?.classificationDecisionLevel);
      if (level === "broad_section") return false;
      if (/^\d{1,3}$/u.test(code)) return false;
    }
    return true;
  }

  function exchangePreservationHash(exchange: JsonRecord): string {
    const clone = cloneJson(exchange);
    delete clone.referenceToFlowDataSet;
    return jsonSha256(clone);
  }

  function rewriteProcessExchangeReferences(
    scope: ScopeProjection,
    identityByKey: Map<string, JsonRecord>,
    maps: EntityMaps,
    outDir: string,
  ): RewriteResult {
    const processFile = resolveRepoPath(scope.process_file);
    if (!processFile || !fileExists(processFile)) {
      return { rewritten_process_file: null, rewrite_rows: [] };
    }
    const payload = readJson(processFile);
    const exchanges = ensureArray(
      jsonRecord(jsonRecord(payload.processDataSet).exchanges).exchange,
    ).map(jsonRecord);
    const rewriteRows: JsonRecord[] = [];
    exchanges.forEach((exchange, index) => {
      const ref = jsonRecord(exchange.referenceToFlowDataSet);
      const flowId = asText(ref["@refObjectId"]);
      const flowVersion = asText(ref["@version"]) || "00.00.001";
      const rootFlow = rootEntityForRef(maps, "flow", flowId, flowVersion);
      if (!rootFlow) return;
      // Reuse-by-reference is gated by an explicit reuse_existing_reference decision, NOT
      // by flow type. BAFU/USLCI only mint product flows (no reuse decision -> not rewritten
      // here), but a reference import like worldsteel can carry CANONICAL product/waste flows
      // (e.g. Hydrogen, treated water, scrap) that exist under the same UUID and must be
      // referenced, not minted as account-local duplicates. The decision check below is the
      // authoritative gate, so this stays a no-op for any flow without a reuse decision.
      const decision = identityByKey.get(`flow:${flowId}:${flowVersion}`);
      if (asText(decision?.decision) !== "reuse_existing_reference") return;
      if (!decision) return;
      const target = canonicalTarget(decision, "flow data set");
      if (!target.id) return;
      const beforePreservationHash = exchangePreservationHash(exchange);
      const previousReference = cloneJson(ref);
      exchange.referenceToFlowDataSet = {
        "@type": previousReference["@type"] || "flow data set",
        "@refObjectId": target.id,
        "@version": target.version,
        "@uri": target.uri || `../flows/${target.id}.json`,
        "common:shortDescription":
          decision.canonical_short_description ||
          previousReference["common:shortDescription"] ||
          target.short_description ||
          undefined,
      };
      const afterPreservationHash = exchangePreservationHash(exchange);
      rewriteRows.push({
        schema_version: 1,
        process_id: scope.process_id,
        process_version: scope.process_version,
        exchange_index: index,
        source_flow_id: flowId,
        source_flow_version: flowVersion,
        canonical_flow_id: target.id,
        canonical_flow_version: target.version,
        // Carry the canonical flow's display name so downstream consumers (e.g. the
        // batch runner's deterministic identity apply) can set referenceToFlowDataSet
        // common:shortDescription to the real name instead of falling back to the UUID.
        canonical_short_description:
          asText(decision.canonical_short_description) || target.short_description || null,
        changed_path: "referenceToFlowDataSet",
        preserved_exchange_fields: beforePreservationHash === afterPreservationHash,
        before_preservation_hash: beforePreservationHash,
        after_preservation_hash: afterPreservationHash,
      });
    });
    if (rewriteRows.length === 0) {
      return { rewritten_process_file: null, rewrite_rows: [] };
    }
    const rewrittenFile = path.join(outDir, "rewritten-processes", `${scope.process_id}.json`);
    writeJson(rewrittenFile, payload);
    return {
      rewritten_process_file: repoRelativePath(rewrittenFile),
      rewrite_rows: rewriteRows,
    };
  }

  function blockRow(
    scope: JsonRecord,
    dependency: unknown,
    code: string,
    message: string,
    requiredHumanAction: string,
  ): JsonRecord {
    return {
      schema_version: 1,
      blocked_process_id: scope.process_id,
      blocked_process_version: scope.process_version,
      blocking_dependency: dependency,
      reason: code,
      message,
      required_human_action: requiredHumanAction,
      rerun_command:
        "node scripts/foundry.ts dataset-library-decisions-apply --library-index <library-index> --decisions-dir <decisions-dir> --out-dir <library-resolution>",
    };
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

  function increment(map: Map<string, number>, key: unknown, count = 1): void {
    const normalizedKey = asText(key) || "unknown";
    map.set(normalizedKey, (map.get(normalizedKey) ?? 0) + count);
  }

  function sortedCountObject(map: Map<string, number>): Record<string, number> {
    return Object.fromEntries(
      [...map.entries()].sort(([left], [right]) => left.localeCompare(right)),
    );
  }

  function compactBlockingDependency(row: JsonRecord): JsonRecord {
    const dependency = jsonRecord(row.blocking_dependency);
    return {
      dataset_type: asText(dependency.dataset_type || dependency.type) || "unknown",
      id: asText(dependency.id || dependency.dataset_id),
      version: asText(dependency.version || dependency.dataset_version) || "00.00.001",
      reason: asText(row.reason) || "unknown",
      message: asText(row.message),
      required_human_action: asText(row.required_human_action),
    };
  }

  function blockerScopeKey(row: JsonRecord): string {
    return [
      asText(row.blocked_process_id || row.process_id),
      asText(row.blocked_process_version || row.process_version) || "00.00.001",
    ].join(":");
  }

  function buildBlockedScopeReport({
    command,
    blockedRows,
    blockedLedgerPath,
    reportPath,
  }: BlockedScopeReportInput): JsonRecord {
    const sampleLimit = 20;
    const reasonMap = new Map<string, ReasonAccumulator>();
    const scopeMap = new Map<string, ScopeAccumulator>();
    const dependencyTypeCounts = new Map<string, number>();
    for (const row of blockedRows) {
      const reason = asText(row.reason) || "unknown";
      const dependency = compactBlockingDependency(row);
      increment(dependencyTypeCounts, dependency.dataset_type);

      if (!reasonMap.has(reason)) {
        reasonMap.set(reason, {
          reason,
          blocked_ledger_rows: 0,
          blocked_scope_ids: new Set(),
          blocking_dependency_types: new Map(),
          messages: new Set(),
          required_human_actions: new Set(),
          sample_blocking_dependencies: [],
        });
      }
      const reasonEntry = reasonMap.get(reason)!;
      reasonEntry.blocked_ledger_rows += 1;
      reasonEntry.blocked_scope_ids.add(asText(row.blocked_process_id));
      increment(reasonEntry.blocking_dependency_types, dependency.dataset_type);
      if (row.message) reasonEntry.messages.add(asText(row.message));
      if (row.required_human_action) {
        reasonEntry.required_human_actions.add(asText(row.required_human_action));
      }
      if (reasonEntry.sample_blocking_dependencies.length < sampleLimit) {
        reasonEntry.sample_blocking_dependencies.push({
          process_id: asText(row.blocked_process_id),
          process_version: asText(row.blocked_process_version) || "00.00.001",
          ...dependency,
        });
      }

      const scopeKey = blockerScopeKey(row);
      if (!scopeMap.has(scopeKey)) {
        scopeMap.set(scopeKey, {
          process_id: asText(row.blocked_process_id),
          process_version: asText(row.blocked_process_version) || "00.00.001",
          blocker_count: 0,
          reasons: new Map(),
          sample_blocking_dependencies: [],
          rerun_commands: new Set(),
        });
      }
      const scopeEntry = scopeMap.get(scopeKey)!;
      scopeEntry.blocker_count += 1;
      increment(scopeEntry.reasons, reason);
      if (row.rerun_command) scopeEntry.rerun_commands.add(asText(row.rerun_command));
      if (scopeEntry.sample_blocking_dependencies.length < sampleLimit) {
        scopeEntry.sample_blocking_dependencies.push(dependency);
      }
    }

    const reasonSummary = [...reasonMap.values()]
      .sort((left, right) => left.reason.localeCompare(right.reason))
      .map((entry) => ({
        reason: entry.reason,
        blocked_ledger_rows: entry.blocked_ledger_rows,
        blocked_scope_count: entry.blocked_scope_ids.size,
        blocking_dependency_types: sortedCountObject(entry.blocking_dependency_types),
        messages: [...entry.messages].sort(),
        required_human_actions: [...entry.required_human_actions].sort(),
        sample_blocking_dependencies: entry.sample_blocking_dependencies,
      }));
    const scopeSummary = [...scopeMap.values()]
      .sort((left, right) => left.process_id.localeCompare(right.process_id))
      .map((entry) => ({
        process_id: entry.process_id,
        process_version: entry.process_version,
        blocker_count: entry.blocker_count,
        reasons: sortedCountObject(entry.reasons),
        sample_blocking_dependencies: entry.sample_blocking_dependencies,
        sample_limit: sampleLimit,
        full_details_file: repoRelativePath(blockedLedgerPath),
        rerun_commands: [...entry.rerun_commands].sort(),
      }));
    return {
      schema_version: 1,
      generated_at_utc: nowIso(),
      status: blockedRows.length > 0 ? "blocked_scopes_present" : "no_blocked_scopes",
      command,
      counts: {
        blocked_ledger_rows: blockedRows.length,
        blocked_scopes: scopeMap.size,
        blocker_reasons: reasonMap.size,
        blocking_dependency_types: sortedCountObject(dependencyTypeCounts),
      },
      reason_summary: reasonSummary,
      scope_summary: scopeSummary,
      files: {
        blocked_scope_report: repoRelativePath(reportPath),
        blocked_scope_ledger: repoRelativePath(blockedLedgerPath),
      },
      ledger_semantics:
        "blocked-scope-ledger.jsonl is the complete row-level blocker source of truth; this report is the per-run reader-facing summary.",
    };
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
    const identityByKey = new Map(identityRows.map((row) => [identityDecisionKey(row), row]));
    const classificationByKey = new Map(
      classificationRows.map((row) => [classificationDecisionKey(row), row]),
    );
    const supportByKey = new Map(supportRows.map((row) => [supportDecisionKey(row), row]));
    const checkpoints: JsonRecord[] = [];
    const blockedLedger: JsonRecord[] = [];
    const readyScopes: JsonRecord[] = [];
    const rewriteRows: JsonRecord[] = [];

    for (const scope of scopeRows) {
      const blockers: JsonRecord[] = [];
      const processClassification = classificationByKey.get(
        `process:${scope.process_id}:${scope.process_version || "00.00.001"}`,
      );
      if (!decisionIsCompleteClassification(processClassification, { datasetType: "process" })) {
        blockers.push(
          blockRow(
            scope,
            { dataset_type: "process", id: scope.process_id, version: scope.process_version },
            processClassification
              ? "process_classification_requires_leaf_authoring"
              : "process_classification_requires_authoring",
            processClassification
              ? "Process classification decision is only a broad section; BAFU import requires a full-context leaf classification before this scope can write."
              : "Process classification must be authored from full process meaning before this scope can write.",
            "Run semantic classification authoring and provide leaf classification-decisions.jsonl.",
          ),
        );
      }

      for (const dep of scope.dependency_ids.flows) {
        const entity = maps.byKey.get(asText(dep.entity_key));
        if (entity && /^elementary flow$/iu.test(entity.flow_type ?? "")) {
          const decision = identityByKey.get(`flow:${dep.id}:${dep.version || "00.00.001"}`);
          const target = canonicalTarget(decision, "flow data set");
          if (
            !allowAccountLocalSupportAndElementary &&
            (asText(decision?.decision) !== "reuse_existing_reference" || !target.id)
          ) {
            blockers.push(
              blockRow(
                scope,
                { dataset_type: "flow", id: dep.id, version: dep.version },
                decision
                  ? "elementary_flow_reference_unresolved"
                  : "elementary_flow_requires_existing_database_match",
                "Elementary flow is reference-only for BAFU and must reuse an existing canonical TianGong flow when physically equivalent.",
                "Provide identity-decisions.jsonl with reuse_existing_reference and physical-equivalence evidence, or leave this scope deferred for human review.",
              ),
            );
          }
        } else {
          const classification = classificationByKey.get(
            `flow:${dep.id}:${dep.version || "00.00.001"}`,
          );
          if (!decisionIsCompleteClassification(classification)) {
            blockers.push(
              blockRow(
                scope,
                { dataset_type: "flow", id: dep.id, version: dep.version },
                "flow_classification_requires_authoring",
                "Product flow classification must be authored from full flow meaning before this scope can write.",
                "Run semantic classification authoring and provide classification-decisions.jsonl.",
              ),
            );
          }
        }
      }
      for (const dep of scope.dependency_ids.flowproperties) {
        const mapping = supportByKey.get(`flowproperty:${dep.id}:${dep.version || "00.00.001"}`);
        const target = canonicalTarget(mapping, "flow property data set");
        if (!target.id && !allowAccountLocalSupportAndElementary) {
          blockers.push(
            blockRow(
              scope,
              { dataset_type: "flowproperty", id: dep.id, version: dep.version },
              "canonical_flow_property_reference_unresolved",
              "Generated Flow Property support is reference-only and must map to public canonical support before this scope can write.",
              "Add canonical-support-mappings.jsonl with physical-dimension evidence or manually add canonical support to the database and rerun.",
            ),
          );
        }
      }
      for (const dep of scope.dependency_ids.unitgroups) {
        const mapping = supportByKey.get(`unitgroup:${dep.id}:${dep.version || "00.00.001"}`);
        const target = canonicalTarget(mapping, "unit group data set");
        if (!target.id && !allowAccountLocalSupportAndElementary) {
          blockers.push(
            blockRow(
              scope,
              { dataset_type: "unitgroup", id: dep.id, version: dep.version },
              "canonical_unit_group_reference_unresolved",
              "Generated Unit Group support is reference-only and must map to public canonical support before this scope can write.",
              "Add canonical-support-mappings.jsonl with unit evidence or manually add canonical support to the database and rerun.",
            ),
          );
        }
      }
      const rewrite = rewriteProcessExchangeReferences(scope, identityByKey, maps, outDir);
      rewriteRows.push(...rewrite.rewrite_rows);
      const state = blockers.length > 0 ? "blocked_deferred" : "ready";
      const checkpoint = {
        schema_version: 1,
        process_id: scope.process_id,
        process_version: scope.process_version,
        state,
        blocker_count: blockers.length,
        bundle_dir: scope.bundle_dir,
        rewritten_process_file: rewrite.rewritten_process_file,
        dependency_counts: {
          flows: scope.dependency_ids.flows.length,
          flowproperties: scope.dependency_ids.flowproperties.length,
          unitgroups: scope.dependency_ids.unitgroups.length,
        },
      };
      checkpoints.push(checkpoint);
      if (blockers.length > 0) {
        blockedLedger.push(...blockers);
      } else {
        readyScopes.push({ ...scope, closure_status: "ready", checkpoint });
      }
    }

    const checkpointPath = path.join(outDir, "scope-checkpoints.jsonl");
    const blockedPath = path.join(outDir, "blocked-scope-ledger.jsonl");
    const blockedReportPath = path.join(outDir, "blocked-scope-report.json");
    const readyPath = path.join(outDir, "ready-scopes.jsonl");
    const rewritePath = path.join(outDir, "exchange-reference-rewrites.jsonl");
    const resolutionPath = path.join(outDir, "library-resolution.json");
    writeJsonLines(checkpointPath, checkpoints);
    writeJsonLines(blockedPath, blockedLedger);
    const blockedReport = buildBlockedScopeReport({
      command: "dataset-library-decisions-apply",
      blockedRows: blockedLedger,
      blockedLedgerPath: blockedPath,
      reportPath: blockedReportPath,
    });
    writeJson(blockedReportPath, blockedReport);
    writeJsonLines(readyPath, readyScopes);
    writeJsonLines(rewritePath, rewriteRows);
    const resolution = {
      schema_version: 1,
      generated_at_utc: nowIso(),
      status: blockedLedger.length > 0 ? "completed_with_deferred_scopes" : "completed",
      command: "dataset-library-decisions-apply",
      library_index: repoRelativePath(indexDir),
      decisions_dir: repoRelativeMaybe(decisionsDir),
      counts: {
        process_scopes: scopeRows.length,
        ready_scopes: readyScopes.length,
        blocked_scopes: checkpoints.filter((row) => row.state === "blocked_deferred").length,
        blocked_scope_ledger_rows: blockedLedger.length,
        identity_decisions: identityRows.length,
        classification_decisions: classificationRows.length,
        canonical_support_mappings: supportRows.length,
        exchange_reference_rewrites: rewriteRows.length,
      },
      ready_scope_ids: readyScopes.map((scope) => scope.process_id),
      blocked_scope_ids: checkpoints
        .filter((row) => row.state === "blocked_deferred")
        .map((row) => row.process_id),
      files: {
        library_resolution: repoRelativePath(resolutionPath),
        scope_checkpoints: repoRelativePath(checkpointPath),
        blocked_scope_ledger: repoRelativePath(blockedPath),
        blocked_scope_report: repoRelativePath(blockedReportPath),
        ready_scopes: repoRelativePath(readyPath),
        exchange_reference_rewrites: repoRelativePath(rewritePath),
      },
      policy: {
        process_scope_atomic_write: true,
        ready_scopes_do_not_wait_for_blocked_scopes: true,
        elementary_flows_reference_only: true,
        flowproperty_unitgroup_reference_only: true,
      },
      blockers: [],
    };
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
        const row = blockRow(
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
    const blockedReport = buildBlockedScopeReport({
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

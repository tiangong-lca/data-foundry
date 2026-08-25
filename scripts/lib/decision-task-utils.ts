import path from "node:path";

type UnknownRecord = Record<string, unknown>;

interface WorkflowCommands extends UnknownRecord {
  input_rows?: unknown;
  output_rows?: unknown;
}

interface DecisionWorkflow extends UnknownRecord {
  schema_type?: unknown;
  row_type?: unknown;
  commands?: WorkflowCommands;
}

interface DecisionQueueRow extends UnknownRecord {
  dataset_id?: unknown;
  dataset_version?: unknown;
  dataset_type?: unknown;
  schema_type?: unknown;
  category_type?: unknown;
  type?: unknown;
  source_file?: unknown;
  sourceFile?: unknown;
  classification_workflow?: DecisionWorkflow;
  location_workflow?: DecisionWorkflow;
  foundry_selection?: UnknownRecord;
}

interface ContextKindEvidence extends UnknownRecord {
  used_context_kinds?: unknown;
  usedContextKinds?: unknown;
}

interface DecisionRecord extends UnknownRecord {
  category_type?: unknown;
  categoryType?: unknown;
  classification_type?: unknown;
  classificationType?: unknown;
  type?: unknown;
  dataset_id?: unknown;
  datasetId?: unknown;
  id?: unknown;
  uuid?: unknown;
  dataset_version?: unknown;
  datasetVersion?: unknown;
  version?: unknown;
  code?: unknown;
  class_id?: unknown;
  classId?: unknown;
  cat_id?: unknown;
  catId?: unknown;
  leaf_code?: unknown;
  leafCode?: unknown;
  used_context_kinds?: unknown;
  usedContextKinds?: unknown;
  evidence?: ContextKindEvidence;
  resolution?: ContextKindEvidence;
  authoring_context?: ContextKindEvidence;
  authoringContext?: UnknownRecord;
  authoring_context_sha256?: unknown;
  context_bundle_sha256?: unknown;
  contextBundleSha256?: unknown;
  decision_status?: unknown;
  decisionStatus?: unknown;
  status?: unknown;
}

interface DecisionTaskOptions extends UnknownRecord {
  datasetId?: unknown;
  datasetIds?: unknown;
  id?: unknown;
  datasetType?: unknown;
  datasetTypes?: unknown;
  categoryType?: unknown;
  categoryTypes?: unknown;
  schemaType?: unknown;
  schemaTypes?: unknown;
  bundleId?: unknown;
  bundleIds?: unknown;
  processId?: unknown;
  offset?: unknown;
  limit?: unknown;
  count?: unknown;
  chunkLabel?: unknown;
  chunk?: unknown;
  label?: unknown;
  rowsFile?: unknown;
  inputRows?: unknown;
  inputRowsFile?: unknown;
  currentRows?: unknown;
  currentRowsFile?: unknown;
  schemaFile?: unknown;
  yamlFile?: unknown;
  rulesetFile?: unknown;
  contextFile?: unknown;
  classificationSchema?: unknown;
  locationSchema?: unknown;
  decisionTask?: unknown;
  classificationDecisionTask?: unknown;
  classificationTask?: unknown;
  locationDecisionTask?: unknown;
  locationTask?: unknown;
  taskReport?: unknown;
  task?: unknown;
}

interface QueueSelection {
  dataset_ids: string[];
  dataset_types: string[];
  category_types: string[];
  bundle_ids: string[];
  offset: number;
  limit: number | null;
}

interface SelectedQueueRow<Row extends DecisionQueueRow = DecisionQueueRow> {
  row: Row;
  sourceIndex: number;
}

interface ContextFileInput extends UnknownRecord {
  kind?: unknown;
  path?: unknown;
  sha256?: unknown;
  bytes?: unknown;
  text?: unknown;
}

interface DecisionContextFile extends UnknownRecord {
  kind: string;
  path: string | null;
  sha256: string;
  bytes: number;
  text: string;
}

interface MissingContextFile {
  kind: string;
  path: string;
}

interface ContractContext {
  files: ContextFileInput[];
  missing: MissingContextFile[];
}

interface ProvenanceEntry extends UnknownRecord {
  file?: unknown;
  total_rows?: unknown;
  truncated?: unknown;
}

interface AttachedInputRow extends UnknownRecord {
  input_rows?: unknown;
  index?: unknown;
  row_type?: unknown;
  dataset_id?: unknown;
  dataset_version?: unknown;
}

interface SharedContextInput extends UnknownRecord {
  path?: unknown;
  sha256?: unknown;
  counts?: unknown;
}

interface TaskContextInput extends UnknownRecord {
  sha256?: unknown;
  context_bundle_sha256?: unknown;
  shared_context_bundle?: SharedContextInput;
}

interface DecisionTaskInput extends UnknownRecord {
  status?: unknown;
  task_kind?: unknown;
  context_bundle?: TaskContextInput;
  authoring_context?: TaskContextInput;
  shared_context_bundle?: SharedContextInput;
  files?: UnknownRecord;
  classification_queue?: unknown;
  location_queue?: unknown;
  source_classification_queue?: unknown;
  source_location_queue?: unknown;
  contract_context_files?: unknown;
  missing_context_files?: unknown;
}

interface SharedContextProof {
  path: string | null;
  sha256: string | null;
  expected_sha256: string | null;
  counts: unknown;
  files: unknown[];
  blockers: UnknownRecord[];
}

interface DecisionTaskProof {
  path: string;
  sha256: string | null;
  status: string | null;
  task_kind: string | null;
  context_bundle_sha256: string | null;
  queue: string | null;
  source_queue: string | null;
  contract_context_files: ContextFileInput[];
  missing_context_files: unknown[];
  context_bundle?: TaskContextInput | null;
  shared_context_bundle: SharedContextProof | null;
  blockers: UnknownRecord[];
}

interface DecisionTaskUtilsDependencies {
  asText: (value: unknown) => string;
  cloneJson: <Value>(value: Value) => Value;
  ensureArray: <Value>(value: Value | Value[] | null | undefined) => Value[];
  fileExists: (filePath: string) => boolean;
  integerOption: (value: unknown, fallback: number | null) => number | null;
  normalizedList: (value: unknown) => string[];
  nowIso: () => string;
  positiveIntegerOption: (value: unknown, fallback: number | null) => number | null;
  readJson: (filePath: string) => UnknownRecord;
  readJsonLines: (filePath: string) => UnknownRecord[];
  readText: (filePath: string) => string;
  repoRelativePath: (filePath: string) => string;
  resolveRepoPath: (filePath: unknown) => string | null;
  sameResolvedPath: (left: string | null, right: string | null) => boolean;
  sha256Text: (value: unknown) => string;
  unique: <Value>(values: Value[]) => Value[];
  writeJson: (filePath: string, value: unknown) => void;
}

export function createDecisionTaskUtils({
  asText,
  cloneJson,
  ensureArray,
  fileExists,
  integerOption,
  normalizedList,
  nowIso,
  positiveIntegerOption,
  readJson,
  readJsonLines,
  readText,
  repoRelativePath,
  resolveRepoPath,
  sameResolvedPath,
  sha256Text,
  unique,
  writeJson,
}: DecisionTaskUtilsDependencies) {
  function classificationQueueSchemaType(row: DecisionQueueRow) {
    return asText(
      row?.classification_workflow?.schema_type ??
        row?.schema_type ??
        row?.category_type ??
        row?.type,
    );
  }

  function classificationQueueRowType(row: DecisionQueueRow) {
    return asText(row?.classification_workflow?.row_type ?? row?.dataset_type);
  }

  function classificationQueueInputRows(row: DecisionQueueRow) {
    return asText(row?.classification_workflow?.commands?.input_rows);
  }

  function classificationQueueOutputRows(row: DecisionQueueRow) {
    return asText(row?.classification_workflow?.commands?.output_rows);
  }

  function queueRowSourceFile(row: DecisionQueueRow) {
    return asText(row?.source_file ?? row?.sourceFile);
  }

  function queueRowBundleId(row: DecisionQueueRow) {
    const match = queueRowSourceFile(row).match(/(?:^|\/)process-bundles\/([^/]+)\//u);
    return match?.[1] ?? "";
  }

  function hasQueueSelectionOptions(options: DecisionTaskOptions) {
    return Boolean(
      normalizedList(options.datasetId || options.datasetIds || options.id).length ||
      normalizedList(options.datasetType || options.datasetTypes).length ||
      normalizedList(
        options.categoryType || options.categoryTypes || options.schemaType || options.schemaTypes,
      ).length ||
      normalizedList(options.bundleId || options.bundleIds || options.processId).length ||
      integerOption(options.offset, null) !== null ||
      positiveIntegerOption(options.limit || options.count, null) !== null,
    );
  }

  function queueSelectionSummary(options: DecisionTaskOptions): QueueSelection {
    return {
      dataset_ids: normalizedList(options.datasetId || options.datasetIds || options.id),
      dataset_types: normalizedList(options.datasetType || options.datasetTypes),
      category_types: normalizedList(
        options.categoryType || options.categoryTypes || options.schemaType || options.schemaTypes,
      ),
      bundle_ids: normalizedList(options.bundleId || options.bundleIds || options.processId),
      offset: Math.max(0, integerOption(options.offset, 0) ?? 0),
      limit: positiveIntegerOption(options.limit || options.count, null),
    };
  }

  function queueRowMatchesSelection<Row extends DecisionQueueRow>(
    row: Row,
    selection: QueueSelection,
    schemaTypeForRow: (row: Row) => string,
  ) {
    const datasetId = asText(row?.dataset_id);
    const datasetType = asText(row?.dataset_type);
    const categoryType = schemaTypeForRow(row);
    const bundleId = queueRowBundleId(row);
    if (selection.dataset_ids.length > 0 && !selection.dataset_ids.includes(datasetId)) {
      return false;
    }
    if (selection.dataset_types.length > 0 && !selection.dataset_types.includes(datasetType)) {
      return false;
    }
    if (selection.category_types.length > 0 && !selection.category_types.includes(categoryType)) {
      return false;
    }
    if (selection.bundle_ids.length > 0 && !selection.bundle_ids.includes(bundleId)) {
      return false;
    }
    return true;
  }

  function selectDecisionTaskQueueRows<Row extends DecisionQueueRow>(
    queueRows: Row[],
    options: DecisionTaskOptions,
    schemaTypeForRow: (row: Row) => string,
  ) {
    const selection = queueSelectionSummary(options);
    const filtered = queueRows
      .map((row, sourceIndex) => ({ row, sourceIndex }))
      .filter(({ row }) => queueRowMatchesSelection(row, selection, schemaTypeForRow));
    const start = selection.offset;
    const end = selection.limit ? start + selection.limit : undefined;
    const selected = filtered.slice(start, end);
    return {
      selection: {
        ...selection,
        source_queue_rows: queueRows.length,
        matched_queue_rows: filtered.length,
        selected_queue_rows: selected.length,
        source_queue_row_indices: selected.map((item) => item.sourceIndex),
      },
      selected,
    };
  }

  function safeFileToken(value: unknown, fallback: string) {
    const token = asText(value)
      .replace(/[^A-Za-z0-9_.-]+/gu, "-")
      .replace(/^-+|-+$/gu, "");
    return token || fallback;
  }

  function decisionTaskChunkLabel(
    options: DecisionTaskOptions,
    selection: QueueSelection,
    fallback: string,
  ) {
    if (options.chunkLabel || options.chunk || options.label) {
      return safeFileToken(options.chunkLabel || options.chunk || options.label, fallback);
    }
    const bundleIds = ensureArray(selection.bundle_ids);
    const datasetTypes = ensureArray(selection.dataset_types);
    const categoryTypes = ensureArray(selection.category_types);
    if (bundleIds.length === 1) {
      return safeFileToken(`bundle-${bundleIds[0]}`, fallback);
    }
    if (datasetTypes.length === 1 && categoryTypes.length === 1) {
      return safeFileToken(`${datasetTypes[0]}-${categoryTypes[0]}`, fallback);
    }
    if (datasetTypes.length === 1) {
      return safeFileToken(datasetTypes[0], fallback);
    }
    return safeFileToken(`offset-${selection.offset}-limit-${selection.limit ?? "all"}`, fallback);
  }

  function rewriteDecisionTaskQueueRowsForChunk({
    selected,
    sourceQueuePath,
    outDir,
    chunkLabel,
    workflowKey,
    outputSuffix,
    inputRowsForRow,
    inputRowsOverride = null,
  }: {
    selected: SelectedQueueRow[];
    sourceQueuePath: string;
    outDir: string;
    chunkLabel: string;
    workflowKey: string;
    outputSuffix: string;
    inputRowsForRow: (row: DecisionQueueRow) => unknown;
    inputRowsOverride?: string | null;
  }) {
    const outputByInput = new Map<string, string>();
    return selected.map(({ row, sourceIndex }) => {
      const next = cloneJson(row);
      const inputRows = inputRowsOverride || resolveRepoPath(inputRowsForRow(next));
      const inputBase = inputRows
        ? path.basename(inputRows).replace(/\.(jsonl|json)$/iu, "")
        : `rows-${sourceIndex}`;
      if (!outputByInput.has(inputBase)) {
        outputByInput.set(
          inputBase,
          path.join(outDir, "rows", `${inputBase}.${chunkLabel}.${outputSuffix}.jsonl`),
        );
      }
      next.foundry_selection = {
        source_queue: repoRelativePath(sourceQueuePath),
        source_queue_row_index: sourceIndex,
        bundle_id: queueRowBundleId(row) || null,
      };
      next[workflowKey] ??= {};
      const workflow = next[workflowKey] as DecisionWorkflow;
      workflow.commands ??= {};
      if (inputRowsOverride) {
        workflow.commands.input_rows = repoRelativePath(inputRowsOverride);
      }
      workflow.commands.output_rows = repoRelativePath(outputByInput.get(inputBase)!);
      return next;
    });
  }

  function decisionTaskInputRowsOverride(options: DecisionTaskOptions) {
    const optionValue =
      options.rowsFile ||
      options.inputRows ||
      options.inputRowsFile ||
      options.currentRows ||
      options.currentRowsFile;
    if (!optionValue) return null;
    const resolved = resolveRepoPath(optionValue);
    if (!resolved || !fileExists(resolved)) {
      throw new Error(
        "--rows-file/--input-rows must point to a readable current rows JSON/JSONL file.",
      );
    }
    return resolved;
  }

  function classificationDecisionSchemaType(decision: DecisionRecord) {
    return asText(
      decision?.category_type ??
        decision?.categoryType ??
        decision?.classification_type ??
        decision?.classificationType ??
        decision?.type,
    );
  }

  function classificationDecisionTargetKey(decision: DecisionRecord, schemaType = "") {
    const datasetId = asText(
      decision?.dataset_id ?? decision?.datasetId ?? decision?.id ?? decision?.uuid,
    );
    const version = asText(
      decision?.dataset_version ?? decision?.datasetVersion ?? decision?.version,
    );
    const type = classificationDecisionSchemaType(decision) || schemaType;
    return `${type}::${datasetId}::${version}`;
  }

  function classificationQueueTargetKey(row: DecisionQueueRow) {
    return `${classificationQueueSchemaType(row)}::${asText(
      row?.dataset_id,
    )}::${asText(row?.dataset_version)}`;
  }

  function classificationDecisionCode(decision: DecisionRecord) {
    return asText(
      decision?.code ??
        decision?.class_id ??
        decision?.classId ??
        decision?.cat_id ??
        decision?.catId ??
        decision?.leaf_code ??
        decision?.leafCode,
    );
  }

  function classificationDecisionUsedContextKinds(decision: DecisionRecord) {
    return unique([
      ...normalizedList(decision?.used_context_kinds ?? decision?.usedContextKinds),
      ...normalizedList(
        decision?.evidence?.used_context_kinds ?? decision?.evidence?.usedContextKinds,
      ),
      ...normalizedList(
        decision?.resolution?.used_context_kinds ?? decision?.resolution?.usedContextKinds,
      ),
    ]);
  }

  function readClassificationTaskJsonlContextRows(
    baseDir: string,
    fileName: string,
    maxRows = 2000,
  ) {
    const filePath = path.join(baseDir, fileName);
    if (!fileExists(filePath)) return { file: null, rows: [] };
    const rows = readJsonLines(filePath);
    return {
      file: repoRelativePath(filePath),
      rows: rows.slice(0, maxRows),
      truncated: rows.length > maxRows,
      total_rows: rows.length,
    };
  }

  function buildClassificationTaskProvenanceContext(queuePath: string) {
    const baseDir = path.dirname(queuePath);
    const sourceSemantics = readClassificationTaskJsonlContextRows(
      baseDir,
      "source-semantics.jsonl",
    );
    const processSourceReferences = readClassificationTaskJsonlContextRows(
      baseDir,
      "process-source-references.jsonl",
    );
    const sourceReferenceRewrites = readClassificationTaskJsonlContextRows(
      baseDir,
      "source-reference-rewrites.jsonl",
    );
    return {
      source_semantics: sourceSemantics,
      process_source_references: processSourceReferences,
      source_reference_rewrites: sourceReferenceRewrites,
    };
  }

  function decisionTaskContextFileDetails(contractContext: ContractContext) {
    return contractContext.files.map((file) => ({
      kind: file.kind,
      path: file.path,
      sha256: file.sha256,
      bytes: file.bytes,
    }));
  }

  function decisionTaskContextFileWithText(file: ContextFileInput): DecisionContextFile {
    const text = String(file?.text ?? "");
    return {
      kind: asText(file?.kind) || "context",
      path: asText(file?.path) || null,
      sha256: asText(file?.sha256) || sha256Text(text),
      bytes: Number(file?.bytes) || Buffer.byteLength(text, "utf8"),
      text,
    };
  }

  function decisionTaskContextFileSummary(file: ContextFileInput) {
    const withText = decisionTaskContextFileWithText(file);
    return {
      kind: withText.kind,
      path: withText.path,
      sha256: withText.sha256,
      bytes: withText.bytes,
    };
  }

  function dedupeDecisionTaskContextFiles(files: ContextFileInput | ContextFileInput[]) {
    const byKey = new Map<string, DecisionContextFile>();
    for (const file of ensureArray(files).map(decisionTaskContextFileWithText)) {
      const key = JSON.stringify([file.kind, file.path, file.sha256]);
      if (!byKey.has(key)) byKey.set(key, file);
    }
    return [...byKey.values()];
  }

  function writeDecisionTaskSharedContextBundle({
    outDir,
    taskKind,
    files,
    references = [],
    cacheDir = null,
  }: {
    outDir: string;
    taskKind: string;
    files: ContextFileInput | ContextFileInput[];
    references?: UnknownRecord[];
    cacheDir?: unknown;
  }) {
    const uniqueFiles = dedupeDecisionTaskContextFiles(files);
    const uniqueBytes = uniqueFiles.reduce((total, file) => total + (Number(file.bytes) || 0), 0);
    const referenceRows = ensureArray(references);
    const referencedBytes =
      referenceRows.length > 0
        ? referenceRows.reduce((total, ref) => total + (Number(ref.bytes) || 0), 0)
        : uniqueBytes;
    const stablePayload = {
      schema_version: 1,
      kind: "tiangong_foundry_decision_shared_context_bundle",
      task_kind: taskKind,
      counts: {
        files: uniqueFiles.length,
        references: referenceRows.length,
        duplicate_references: Math.max(0, referenceRows.length - uniqueFiles.length),
        unique_context_bytes: uniqueBytes,
        referenced_context_bytes: referencedBytes,
        duplicate_context_bytes_avoided: Math.max(0, referencedBytes - uniqueBytes),
      },
      files: uniqueFiles,
      references: referenceRows,
    };
    const bundle = {
      ...stablePayload,
      generated_at_utc: nowIso(),
      hash_scope:
        "schema_version, kind, task_kind, counts, files, and references; generated_at_utc and output path are excluded so identical decision context keeps a stable hash.",
      sha256: sha256Text(JSON.stringify(stablePayload)),
    };
    const resolvedCacheDir = cacheDir ? resolveRepoPath(cacheDir) : null;
    const bundlePath = resolvedCacheDir
      ? path.join(resolvedCacheDir, `${taskKind}.${bundle.sha256}.json`)
      : path.join(outDir, "shared-context-bundle.json");
    let cacheReused = false;
    if (resolvedCacheDir && fileExists(bundlePath)) {
      try {
        cacheReused = readJson(bundlePath)?.sha256 === bundle.sha256;
      } catch {
        cacheReused = false;
      }
    }
    if (!cacheReused) {
      writeJson(bundlePath, bundle);
    }
    return {
      path: repoRelativePath(bundlePath),
      sha256: bundle.sha256,
      counts: bundle.counts,
      hash_scope: bundle.hash_scope,
      cache: resolvedCacheDir
        ? {
            enabled: true,
            dir: repoRelativePath(resolvedCacheDir),
            reused: cacheReused,
          }
        : {
            enabled: false,
            reused: false,
          },
      instruction:
        "Read this shared bundle once for full schema/YAML/ruleset/category/location text; the decision task carries queue rows, attached payloads, provenance, and the stable context bundle hash used by deterministic apply.",
    };
  }

  function stableDecisionTaskQueueRows(queueRows: DecisionQueueRow | DecisionQueueRow[]) {
    return ensureArray(queueRows).map((row) => {
      const next = cloneJson(row);
      if (next?.classification_workflow?.commands) {
        delete next.classification_workflow.commands.output_rows;
      }
      if (next?.location_workflow?.commands) {
        delete next.location_workflow.commands.output_rows;
      }
      return next;
    });
  }

  function decisionTaskQueueSha256(queueRows: DecisionQueueRow | DecisionQueueRow[]) {
    return sha256Text(JSON.stringify(stableDecisionTaskQueueRows(queueRows)));
  }

  function decisionTaskProvenanceFileDetails(provenanceContext: Record<string, ProvenanceEntry>) {
    return Object.fromEntries(
      Object.entries(provenanceContext).map(([key, value]) => [
        key,
        {
          file: value?.file ?? null,
          total_rows: value?.total_rows ?? 0,
          truncated: Boolean(value?.truncated),
        },
      ]),
    );
  }

  function buildDecisionTaskContextBundle({
    taskKind,
    taskPath,
    outDir,
    sharedContextCacheDir = null,
    queuePath,
    queueRows,
    contractContext,
    provenanceContext,
    attachedInputRows,
  }: {
    taskKind: string;
    taskPath: string;
    outDir?: string | null;
    sharedContextCacheDir?: unknown;
    queuePath: string;
    queueRows: DecisionQueueRow[];
    contractContext: ContractContext;
    provenanceContext: Record<string, ProvenanceEntry>;
    attachedInputRows: AttachedInputRow[];
  }) {
    const contextFiles = dedupeDecisionTaskContextFiles(contractContext.files);
    const contractFiles = contextFiles.map(decisionTaskContextFileSummary);
    const sharedContextBundle = writeDecisionTaskSharedContextBundle({
      outDir: outDir ?? path.dirname(taskPath),
      taskKind,
      files: contextFiles,
      references: contextFiles.map((file) => ({
        kind: file.kind,
        path: file.path,
        sha256: file.sha256,
        bytes: file.bytes,
      })),
      cacheDir: sharedContextCacheDir,
    });
    const stablePayload = {
      task_kind: taskKind,
      queue_sha256: decisionTaskQueueSha256(queueRows),
      queue_rows: queueRows.length,
      contract_context_files: contractFiles,
      missing_context_files: contractContext.missing,
      provenance_context: decisionTaskProvenanceFileDetails(provenanceContext),
      attached_input_rows: attachedInputRows.map((row) => ({
        input_rows: row.input_rows,
        input_row_index: row.index,
        row_type: row.row_type,
        dataset_id: row.dataset_id,
        dataset_version: row.dataset_version,
      })),
      shared_context_bundle_sha256: sharedContextBundle.sha256,
    };
    return {
      ...stablePayload,
      task: repoRelativePath(taskPath),
      queue: repoRelativePath(queuePath),
      shared_context_bundle: sharedContextBundle,
      hash_scope:
        "task_kind, normalized queue_sha256, queue_rows, contract_context_files, missing_context_files, provenance_context, attached_input_rows, and shared_context_bundle_sha256; task path, queue path, and generated output_rows paths are excluded.",
      sha256: sha256Text(JSON.stringify(stablePayload)),
    };
  }

  function decisionAuthoringContext(contextBundle: {
    task: string;
    sha256: string;
    contract_context_files: Array<{
      kind: string;
      path: string | null;
      sha256: string;
      bytes: number;
    }>;
  }) {
    return {
      task: contextBundle.task,
      context_bundle_sha256: contextBundle.sha256,
      required_context_kinds: unique(contextBundle.contract_context_files.map((file) => file.kind)),
      context_files: contextBundle.contract_context_files.map((file) => ({
        kind: file.kind,
        path: file.path,
        sha256: file.sha256,
      })),
    };
  }

  function classificationDecisionTaskContextKind(kind: string, filePath: unknown) {
    const baseName = path.basename(String(filePath || "")).toLowerCase();
    if (baseName === "schema.json") return "schema";
    if (baseName === "methodology.yaml" || baseName === "methodology.yml") {
      return "methodology_yaml";
    }
    if (baseName === "runtime-ruleset.json") return "ruleset";
    if (baseName === "tidas_locations_category.json") return "location_schema";
    if (/^tidas_.*_category\.json$/u.test(baseName)) {
      return "classification_schema";
    }
    return kind;
  }

  function buildClassificationDecisionTaskContextFiles(
    options: DecisionTaskOptions,
  ): ContractContext {
    const inputs: Array<readonly [string, unknown]> = [
      ["schema", options.schemaFile],
      ["methodology_yaml", options.yamlFile],
      ["ruleset", options.rulesetFile],
      ["context", options.contextFile],
      ["classification_schema", options.classificationSchema],
      ["location_schema", options.locationSchema],
    ];
    const files: DecisionContextFile[] = [];
    const missing: MissingContextFile[] = [];
    for (const [defaultKind, optionValue] of inputs) {
      for (const filePath of normalizedList(optionValue)) {
        const resolved = resolveRepoPath(filePath);
        const kind = classificationDecisionTaskContextKind(defaultKind, filePath);
        if (!resolved || !fileExists(resolved)) {
          missing.push({ kind, path: filePath });
          continue;
        }
        const text = readText(resolved);
        files.push({
          kind,
          path: repoRelativePath(resolved),
          sha256: sha256Text(text),
          bytes: Buffer.byteLength(text, "utf8"),
          text,
        });
      }
    }
    return { files, missing };
  }

  function decisionTaskContextBlockers({
    kind,
    queueRows,
    contractContext,
    requiredContextKinds,
    attachedInputRowCount,
  }: {
    kind: string;
    queueRows: DecisionQueueRow[];
    contractContext: ContractContext;
    requiredContextKinds: string[];
    attachedInputRowCount: number;
  }) {
    if (queueRows.length === 0) return [];
    const blockers: UnknownRecord[] = [];
    const availableKinds = new Set(
      contractContext.files.filter((file) => Number(file.bytes) > 0).map((file) => file.kind),
    );
    for (const missingFile of contractContext.missing) {
      blockers.push({
        code: `${kind}_decision_task_context_file_missing`,
        message: "Decision task cannot be sent to AI while a referenced context file is missing.",
        kind: missingFile.kind,
        path: missingFile.path,
      });
    }
    for (const file of contractContext.files) {
      if (Number(file.bytes) === 0) {
        blockers.push({
          code: `${kind}_decision_task_context_file_empty`,
          message: "Decision task cannot be sent to AI with an empty context file.",
          kind: file.kind,
          path: file.path,
        });
      }
    }
    for (const requiredKind of requiredContextKinds) {
      if (!availableKinds.has(requiredKind)) {
        blockers.push({
          code: `${kind}_decision_task_required_context_missing`,
          message:
            "Decision task must include the full schema/YAML/ruleset/category context before AI authoring.",
          kind: requiredKind,
        });
      }
    }
    const missingInputRows = queueRows.length - attachedInputRowCount;
    if (missingInputRows > 0) {
      blockers.push({
        code: `${kind}_decision_task_input_row_payload_missing`,
        message:
          "Decision task must attach the converted TIDAS row payload for every queued item before AI authoring.",
        missing_input_row_payloads: missingInputRows,
        queue_rows: queueRows.length,
      });
    }
    return blockers;
  }

  function decisionTaskBuildStatus({
    queueRows,
    blockers,
    readyStatus,
    emptyStatus,
  }: {
    queueRows: unknown[];
    blockers: unknown[];
    readyStatus: string;
    emptyStatus: string;
  }) {
    if (queueRows.length === 0) return emptyStatus;
    if (blockers.length > 0) return "blocked_missing_full_context";
    return readyStatus;
  }

  function decisionTaskOptionPath(options: DecisionTaskOptions, kind: string) {
    if (kind === "classification") {
      return (
        options.decisionTask ||
        options.classificationDecisionTask ||
        options.classificationTask ||
        options.taskReport ||
        options.task
      );
    }
    return (
      options.decisionTask ||
      options.locationDecisionTask ||
      options.locationTask ||
      options.taskReport ||
      options.task
    );
  }

  function decisionTaskOptionPaths(options: DecisionTaskOptions, kind: string) {
    return normalizedList(decisionTaskOptionPath(options, kind));
  }

  function readDecisionTaskSharedContextBundleProof(
    task: DecisionTaskInput,
    proofPath: string,
  ): SharedContextProof {
    const contextBundle = task?.context_bundle ?? task?.authoring_context ?? {};
    const sharedContext = task?.shared_context_bundle ?? contextBundle?.shared_context_bundle ?? {};
    const sharedPath = asText(sharedContext?.path ?? task?.files?.shared_context_bundle);
    const expectedSha256 = asText(
      sharedContext?.sha256 ?? contextBundle?.shared_context_bundle_sha256,
    );
    const proof: SharedContextProof = {
      path: sharedPath || null,
      sha256: null,
      expected_sha256: expectedSha256 || null,
      counts: sharedContext?.counts ?? null,
      files: [],
      blockers: [],
    };
    if (!sharedPath) return proof;
    const resolved = resolveRepoPath(sharedPath);
    if (!resolved || !fileExists(resolved)) {
      proof.blockers.push({
        code: "decision_task_shared_context_bundle_missing",
        message: "Decision task references an unreadable shared full-context bundle.",
        decision_task: proofPath,
        shared_context_bundle: sharedPath,
      });
      return proof;
    }
    try {
      const bundle = readJson(resolved);
      proof.sha256 = asText(bundle?.sha256);
      proof.files = ensureArray(bundle?.files);
      proof.counts = bundle?.counts ?? proof.counts;
      if (expectedSha256 && proof.sha256 !== expectedSha256) {
        proof.blockers.push({
          code: "decision_task_shared_context_bundle_hash_mismatch",
          message:
            "Decision task shared context bundle sha256 no longer matches the task reference.",
          decision_task: proofPath,
          shared_context_bundle: sharedPath,
          expected_sha256: expectedSha256,
          actual_sha256: proof.sha256 || null,
        });
      }
    } catch (error) {
      proof.blockers.push({
        code: "decision_task_shared_context_bundle_invalid",
        message: error instanceof Error ? error.message : String(error),
        decision_task: proofPath,
        shared_context_bundle: sharedPath,
      });
    }
    return proof;
  }

  function readDecisionTaskProofFromPath(
    taskPathInput: unknown,
    kind: string,
    queuePath: string,
  ): DecisionTaskProof | null {
    const taskPath = resolveRepoPath(taskPathInput);
    if (!taskPath) return null;
    const proof: DecisionTaskProof = {
      path: repoRelativePath(taskPath),
      sha256: null,
      status: null,
      task_kind: null,
      context_bundle_sha256: null,
      queue: null,
      source_queue: null,
      contract_context_files: [],
      missing_context_files: [],
      shared_context_bundle: null,
      blockers: [],
    };
    if (!fileExists(taskPath)) {
      proof.blockers.push({
        code: `${kind}_decision_task_missing`,
        message: "Decision apply was given an unreadable AI decision task file.",
        decision_task: proof.path,
      });
      return proof;
    }
    try {
      const rawText = readText(taskPath);
      proof.sha256 = sha256Text(rawText);
      const task = JSON.parse(rawText) as DecisionTaskInput;
      const contextBundle = task.context_bundle ?? task.authoring_context;
      proof.status = asText(task.status);
      proof.task_kind = asText(task.task_kind);
      proof.context_bundle_sha256 = asText(
        contextBundle?.sha256 ?? contextBundle?.context_bundle_sha256,
      );
      proof.queue = asText(
        kind === "classification" ? task.classification_queue : task.location_queue,
      );
      proof.source_queue = asText(
        kind === "classification" ? task.source_classification_queue : task.source_location_queue,
      );
      proof.contract_context_files = ensureArray(task.contract_context_files) as ContextFileInput[];
      proof.missing_context_files = ensureArray(task.missing_context_files);
      proof.context_bundle = contextBundle ?? null;
      proof.shared_context_bundle = readDecisionTaskSharedContextBundleProof(task, proof.path);
      proof.blockers.push(...proof.shared_context_bundle.blockers);
      if (kind === "classification" && proof.task_kind !== "classification_decision_authoring") {
        proof.blockers.push({
          code: "classification_decision_task_kind_invalid",
          message: "Classification decisions must be bound to a classification decision task.",
          task_kind: proof.task_kind,
          decision_task: proof.path,
        });
      }
      if (kind === "location" && proof.task_kind !== "location_decision_authoring") {
        proof.blockers.push({
          code: "location_decision_task_kind_invalid",
          message: "Location decisions must be bound to a location decision task.",
          task_kind: proof.task_kind,
          decision_task: proof.path,
        });
      }
      const taskQueuePath = resolveRepoPath(proof.queue);
      const sourceQueuePath = resolveRepoPath(proof.source_queue);
      if (
        !sameResolvedPath(taskQueuePath, queuePath) &&
        !sameResolvedPath(sourceQueuePath, queuePath)
      ) {
        proof.blockers.push({
          code: `${kind}_decision_task_queue_mismatch`,
          message: "Decision task queue does not match the queue being applied.",
          decision_task: proof.path,
          task_queue: proof.queue,
          source_queue: proof.source_queue,
          apply_queue: repoRelativePath(queuePath),
        });
      }
      if (!proof.context_bundle_sha256) {
        proof.blockers.push({
          code: `${kind}_decision_task_context_bundle_missing`,
          message:
            "Decision task must include context_bundle.sha256 so AI output can be tied to the exact context bundle.",
          decision_task: proof.path,
        });
      }
      if (proof.missing_context_files.length > 0) {
        proof.blockers.push({
          code: `${kind}_decision_task_context_files_missing`,
          message:
            "Decision task records missing context files and cannot prove full-context AI completion.",
          decision_task: proof.path,
          missing_context_files: proof.missing_context_files,
        });
      }
    } catch (error) {
      proof.blockers.push({
        code: `${kind}_decision_task_invalid`,
        message: error instanceof Error ? error.message : String(error),
        decision_task: proof.path,
      });
    }
    return proof;
  }

  function readDecisionTaskProof(options: DecisionTaskOptions, kind: string, queuePath: string) {
    const [taskPath] = decisionTaskOptionPaths(options, kind);
    return taskPath ? readDecisionTaskProofFromPath(taskPath, kind, queuePath) : null;
  }

  function readDecisionTaskProofs(options: DecisionTaskOptions, kind: string, queuePath: string) {
    return decisionTaskOptionPaths(options, kind)
      .map((taskPath) => readDecisionTaskProofFromPath(taskPath, kind, queuePath))
      .filter((proof): proof is DecisionTaskProof => proof !== null);
  }

  function decisionContextBundleSha256(decision: DecisionRecord) {
    return asText(
      decision?.authoring_context?.context_bundle_sha256 ??
        decision?.authoringContext?.contextBundleSha256 ??
        decision?.authoring_context_sha256 ??
        decision?.context_bundle_sha256 ??
        decision?.contextBundleSha256,
    );
  }

  function decisionCompletionStatus(decision: DecisionRecord) {
    return asText(decision?.decision_status ?? decision?.decisionStatus ?? decision?.status);
  }

  function decisionTaskReportPayload(proof: DecisionTaskProof | null) {
    if (!proof) return null;
    return {
      path: proof.path,
      sha256: proof.sha256,
      status: proof.status,
      task_kind: proof.task_kind,
      queue: proof.queue,
      source_queue: proof.source_queue,
      context_bundle_sha256: proof.context_bundle_sha256,
      contract_context_files: proof.contract_context_files.map((file) => ({
        kind: file.kind,
        path: file.path,
        sha256: file.sha256,
        bytes: file.bytes,
      })),
      missing_context_files: proof.missing_context_files,
      shared_context_bundle: proof.shared_context_bundle
        ? {
            path: proof.shared_context_bundle.path,
            sha256: proof.shared_context_bundle.sha256,
            expected_sha256: proof.shared_context_bundle.expected_sha256,
            counts: proof.shared_context_bundle.counts,
          }
        : null,
    };
  }

  function decisionTaskProofList(
    proofOrProofs: DecisionTaskProof | DecisionTaskProof[] | null | undefined,
  ) {
    return ensureArray(proofOrProofs).filter(
      (proof): proof is DecisionTaskProof => proof !== null && proof !== undefined,
    );
  }

  function decisionTaskContextBundleHashes(
    proofs: DecisionTaskProof | DecisionTaskProof[] | null | undefined,
  ) {
    return unique(decisionTaskProofList(proofs).map((proof) => proof.context_bundle_sha256));
  }

  return {
    classificationQueueSchemaType,
    classificationQueueRowType,
    classificationQueueInputRows,
    classificationQueueOutputRows,
    queueRowSourceFile,
    queueRowBundleId,
    hasQueueSelectionOptions,
    queueSelectionSummary,
    queueRowMatchesSelection,
    selectDecisionTaskQueueRows,
    safeFileToken,
    decisionTaskChunkLabel,
    rewriteDecisionTaskQueueRowsForChunk,
    decisionTaskInputRowsOverride,
    classificationDecisionSchemaType,
    classificationDecisionTargetKey,
    classificationQueueTargetKey,
    classificationDecisionCode,
    classificationDecisionUsedContextKinds,
    readClassificationTaskJsonlContextRows,
    buildClassificationTaskProvenanceContext,
    decisionTaskContextFileDetails,
    decisionTaskContextFileWithText,
    decisionTaskContextFileSummary,
    dedupeDecisionTaskContextFiles,
    writeDecisionTaskSharedContextBundle,
    stableDecisionTaskQueueRows,
    decisionTaskQueueSha256,
    decisionTaskProvenanceFileDetails,
    buildDecisionTaskContextBundle,
    decisionAuthoringContext,
    classificationDecisionTaskContextKind,
    buildClassificationDecisionTaskContextFiles,
    decisionTaskContextBlockers,
    decisionTaskBuildStatus,
    decisionTaskOptionPath,
    decisionTaskOptionPaths,
    readDecisionTaskSharedContextBundleProof,
    readDecisionTaskProofFromPath,
    readDecisionTaskProof,
    readDecisionTaskProofs,
    decisionContextBundleSha256,
    decisionCompletionStatus,
    decisionTaskReportPayload,
    decisionTaskProofList,
    decisionTaskContextBundleHashes,
  };
}

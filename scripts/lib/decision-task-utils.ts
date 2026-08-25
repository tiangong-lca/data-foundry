import path from "node:path";

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
}: any) {
  function classificationQueueSchemaType(row: any) {
    return asText(
      row?.classification_workflow?.schema_type ??
        row?.schema_type ??
        row?.category_type ??
        row?.type,
    );
  }

  function classificationQueueRowType(row: any) {
    return asText(row?.classification_workflow?.row_type ?? row?.dataset_type);
  }

  function classificationQueueInputRows(row: any) {
    return asText(row?.classification_workflow?.commands?.input_rows);
  }

  function classificationQueueOutputRows(row: any) {
    return asText(row?.classification_workflow?.commands?.output_rows);
  }

  function queueRowSourceFile(row: any) {
    return asText(row?.source_file ?? row?.sourceFile);
  }

  function queueRowBundleId(row: any) {
    const match = queueRowSourceFile(row).match(/(?:^|\/)process-bundles\/([^/]+)\//u);
    return match?.[1] ?? "";
  }

  function hasQueueSelectionOptions(options: any) {
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

  function queueSelectionSummary(options: any) {
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

  function queueRowMatchesSelection(row: any, selection: any, schemaTypeForRow: any) {
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

  function selectDecisionTaskQueueRows(queueRows: any[], options: any, schemaTypeForRow: any) {
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

  function safeFileToken(value: any, fallback: any) {
    const token = asText(value)
      .replace(/[^A-Za-z0-9_.-]+/gu, "-")
      .replace(/^-+|-+$/gu, "");
    return token || fallback;
  }

  function decisionTaskChunkLabel(options: any, selection: any, fallback: any) {
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
  }: any) {
    const outputByInput = new Map<string, string>();
    return selected.map(({ row, sourceIndex }: any) => {
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
      next[workflowKey].commands ??= {};
      if (inputRowsOverride) {
        next[workflowKey].commands.input_rows = repoRelativePath(inputRowsOverride);
      }
      next[workflowKey].commands.output_rows = repoRelativePath(outputByInput.get(inputBase));
      return next;
    });
  }

  function decisionTaskInputRowsOverride(options: any) {
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

  function classificationDecisionSchemaType(decision: any) {
    return asText(
      decision?.category_type ??
        decision?.categoryType ??
        decision?.classification_type ??
        decision?.classificationType ??
        decision?.type,
    );
  }

  function classificationDecisionTargetKey(decision: any, schemaType = "") {
    const datasetId = asText(
      decision?.dataset_id ?? decision?.datasetId ?? decision?.id ?? decision?.uuid,
    );
    const version = asText(
      decision?.dataset_version ?? decision?.datasetVersion ?? decision?.version,
    );
    const type = classificationDecisionSchemaType(decision) || schemaType;
    return `${type}::${datasetId}::${version}`;
  }

  function classificationQueueTargetKey(row: any) {
    return `${classificationQueueSchemaType(row)}::${asText(
      row?.dataset_id,
    )}::${asText(row?.dataset_version)}`;
  }

  function classificationDecisionCode(decision: any) {
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

  function classificationDecisionUsedContextKinds(decision: any) {
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

  function readClassificationTaskJsonlContextRows(baseDir: any, fileName: any, maxRows = 2000) {
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

  function buildClassificationTaskProvenanceContext(queuePath: any) {
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

  function decisionTaskContextFileDetails(contractContext: any) {
    return contractContext.files.map((file: any) => ({
      kind: file.kind,
      path: file.path,
      sha256: file.sha256,
      bytes: file.bytes,
    }));
  }

  function decisionTaskContextFileWithText(file: any) {
    const text = String(file?.text ?? "");
    return {
      kind: asText(file?.kind) || "context",
      path: asText(file?.path) || null,
      sha256: asText(file?.sha256) || sha256Text(text),
      bytes: Number(file?.bytes) || Buffer.byteLength(text, "utf8"),
      text,
    };
  }

  function decisionTaskContextFileSummary(file: any) {
    const withText = decisionTaskContextFileWithText(file);
    return {
      kind: withText.kind,
      path: withText.path,
      sha256: withText.sha256,
      bytes: withText.bytes,
    };
  }

  function dedupeDecisionTaskContextFiles(files: any) {
    const byKey = new Map<string, any>();
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
  }: any) {
    const uniqueFiles = dedupeDecisionTaskContextFiles(files);
    const uniqueBytes = uniqueFiles.reduce((total, file) => total + (Number(file.bytes) || 0), 0);
    const referenceRows = ensureArray(references);
    const referencedBytes =
      referenceRows.length > 0
        ? referenceRows.reduce((total: number, ref: any) => total + (Number(ref.bytes) || 0), 0)
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

  function stableDecisionTaskQueueRows(queueRows: any) {
    return ensureArray(queueRows).map((row: any) => {
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

  function decisionTaskQueueSha256(queueRows: any) {
    return sha256Text(JSON.stringify(stableDecisionTaskQueueRows(queueRows)));
  }

  function decisionTaskProvenanceFileDetails(provenanceContext: any) {
    return Object.fromEntries(
      Object.entries(provenanceContext as Record<string, any>).map(([key, value]) => [
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
  }: any) {
    const contextFiles = dedupeDecisionTaskContextFiles(contractContext.files);
    const contractFiles = contextFiles.map(decisionTaskContextFileSummary);
    const sharedContextBundle = writeDecisionTaskSharedContextBundle({
      outDir: outDir ?? path.dirname(taskPath),
      taskKind,
      files: contextFiles,
      references: contextFiles.map((file: any) => ({
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
      attached_input_rows: attachedInputRows.map((row: any) => ({
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

  function decisionAuthoringContext(contextBundle: any) {
    return {
      task: contextBundle.task,
      context_bundle_sha256: contextBundle.sha256,
      required_context_kinds: unique(
        contextBundle.contract_context_files.map((file: any) => file.kind),
      ),
      context_files: contextBundle.contract_context_files.map((file: any) => ({
        kind: file.kind,
        path: file.path,
        sha256: file.sha256,
      })),
    };
  }

  function classificationDecisionTaskContextKind(kind: any, filePath: any) {
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

  function buildClassificationDecisionTaskContextFiles(options: any) {
    const inputs = [
      ["schema", options.schemaFile],
      ["methodology_yaml", options.yamlFile],
      ["ruleset", options.rulesetFile],
      ["context", options.contextFile],
      ["classification_schema", options.classificationSchema],
      ["location_schema", options.locationSchema],
    ];
    const files = [];
    const missing = [];
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
  }: any) {
    if (queueRows.length === 0) return [];
    const blockers = [];
    const availableKinds = new Set(
      contractContext.files
        .filter((file: any) => Number(file.bytes) > 0)
        .map((file: any) => file.kind),
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

  function decisionTaskBuildStatus({ queueRows, blockers, readyStatus, emptyStatus }: any) {
    if (queueRows.length === 0) return emptyStatus;
    if (blockers.length > 0) return "blocked_missing_full_context";
    return readyStatus;
  }

  function decisionTaskOptionPath(options: any, kind: any) {
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

  function decisionTaskOptionPaths(options: any, kind: any) {
    return normalizedList(decisionTaskOptionPath(options, kind));
  }

  function readDecisionTaskSharedContextBundleProof(task: any, proofPath: any) {
    const contextBundle = task?.context_bundle ?? task?.authoring_context ?? {};
    const sharedContext = task?.shared_context_bundle ?? contextBundle?.shared_context_bundle ?? {};
    const sharedPath = asText(sharedContext?.path ?? task?.files?.shared_context_bundle);
    const expectedSha256 = asText(
      sharedContext?.sha256 ?? contextBundle?.shared_context_bundle_sha256,
    );
    const proof: any = {
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

  function readDecisionTaskProofFromPath(taskPathInput: any, kind: any, queuePath: any) {
    const taskPath = resolveRepoPath(taskPathInput);
    if (!taskPath) return null;
    const proof: any = {
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
      const task = JSON.parse(rawText);
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
      proof.contract_context_files = ensureArray(task.contract_context_files);
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

  function readDecisionTaskProof(options: any, kind: any, queuePath: any) {
    const [taskPath] = decisionTaskOptionPaths(options, kind);
    return taskPath ? readDecisionTaskProofFromPath(taskPath, kind, queuePath) : null;
  }

  function readDecisionTaskProofs(options: any, kind: any, queuePath: any) {
    return decisionTaskOptionPaths(options, kind)
      .map((taskPath: any) => readDecisionTaskProofFromPath(taskPath, kind, queuePath))
      .filter(Boolean);
  }

  function decisionContextBundleSha256(decision: any) {
    return asText(
      decision?.authoring_context?.context_bundle_sha256 ??
        decision?.authoringContext?.contextBundleSha256 ??
        decision?.authoring_context_sha256 ??
        decision?.context_bundle_sha256 ??
        decision?.contextBundleSha256,
    );
  }

  function decisionCompletionStatus(decision: any) {
    return asText(decision?.decision_status ?? decision?.decisionStatus ?? decision?.status);
  }

  function decisionTaskReportPayload(proof: any) {
    if (!proof) return null;
    return {
      path: proof.path,
      sha256: proof.sha256,
      status: proof.status,
      task_kind: proof.task_kind,
      queue: proof.queue,
      source_queue: proof.source_queue,
      context_bundle_sha256: proof.context_bundle_sha256,
      contract_context_files: proof.contract_context_files.map((file: any) => ({
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

  function decisionTaskProofList(proofOrProofs: any) {
    return ensureArray(proofOrProofs).filter(Boolean);
  }

  function decisionTaskContextBundleHashes(proofs: any) {
    return unique(decisionTaskProofList(proofs).map((proof: any) => proof.context_bundle_sha256));
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

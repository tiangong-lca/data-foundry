import fs from "node:fs";
import path from "node:path";
import process from "node:process";

interface LooseRecord {
  [key: string]: LooseRecord | undefined;
}

interface ContextFile {
  kind?: string;
  path: string;
  sha256?: string;
  bytes?: number;
}

interface ContractContext {
  files: ContextFile[];
  missing: Array<Record<string, unknown>>;
}

interface ProvenanceFile {
  file: string | null;
}

interface ProvenanceContext {
  source_semantics: ProvenanceFile;
  process_source_references: ProvenanceFile;
  source_reference_rewrites: ProvenanceFile;
  [key: string]: unknown;
}

interface DecisionContextBundle {
  task?: string;
  sha256: string;
  contract_context_files?: ContextFile[];
  shared_context_bundle: { path: string; [key: string]: unknown };
  [key: string]: unknown;
}

interface DecisionTaskProof {
  path: string;
  blockers: Array<Record<string, unknown>>;
  [key: string]: unknown;
}

interface QueueSelection {
  source_queue_rows: number;
  matched_queue_rows: number;
  selected_queue_rows: number;
  source_queue_row_indices: number[];
  input_rows_override?: string | null;
  chunk_label?: string;
  [key: string]: unknown;
}

interface SelectedQueueRow {
  row: LooseRecord;
  sourceIndex: number;
}

interface AttachedInputRow {
  index: number;
  row_type: string;
  dataset_id: string;
  dataset_version: string;
  input_rows: string;
  payload: LooseRecord;
}

interface DecisionTemplateRow {
  evidence: {
    input_row_payload: LooseRecord | null;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

interface RuntimeStage {
  exit_code: number;
  report?: LooseRecord;
  report_file?: string | null;
  [key: string]: unknown;
}

interface StageSummary {
  stderr?: string;
  [key: string]: unknown;
}

interface ClassificationDecisionDependencies {
  asText: (value: unknown) => string;
  buildClassificationDecisionTaskContextFiles: (options: LooseRecord) => ContractContext;
  buildClassificationTaskProvenanceContext: (queuePath: string) => ProvenanceContext;
  buildDecisionTaskContextBundle: (options: Record<string, unknown>) => DecisionContextBundle;
  classificationDecisionCode: (decision: LooseRecord | undefined) => string;
  classificationDecisionSchemaType: (decision: LooseRecord) => string;
  classificationDecisionTargetKey: (decision: LooseRecord) => string;
  classificationDecisionUsedContextKinds: (decision: LooseRecord) => string[];
  classificationQueueInputRows: (row: LooseRecord) => string;
  classificationQueueOutputRows: (row: LooseRecord) => string;
  classificationQueueRowType: (row: LooseRecord) => string;
  classificationQueueSchemaType: (row: LooseRecord) => string;
  classificationQueueTargetKey: (row: LooseRecord) => string;
  compactStageReport: (stage: RuntimeStage) => StageSummary;
  datasetIdentity: (row: LooseRecord, datasetType: string) => { id: string; version: string };
  decisionAuthoringContext: (contextBundle: DecisionContextBundle) => Record<string, unknown>;
  decisionCompletionStatus: (decision: LooseRecord | undefined) => string;
  decisionContextBundleSha256: (decision: LooseRecord) => string;
  decisionTaskBuildStatus: (options: Record<string, unknown>) => string;
  decisionTaskChunkLabel: (
    options: LooseRecord,
    selection: QueueSelection,
    fallback: string,
  ) => string;
  decisionTaskContextBlockers: (options: Record<string, unknown>) => Array<Record<string, unknown>>;
  decisionTaskContextBundleHashes: (proofs: DecisionTaskProof[]) => string[];
  decisionTaskContextFileSummary: (file: ContextFile) => unknown;
  decisionTaskInputRowsOverride: (options: LooseRecord) => string | null;
  decisionTaskProofList: (proof: unknown) => DecisionTaskProof[];
  decisionTaskReportPayload: (proof: DecisionTaskProof | null) => unknown;
  fileExists: (filePath: string | null | undefined) => boolean;
  hasQueueSelectionOptions: (options: LooseRecord) => boolean;
  hasUnresolvedAiPlaceholder: (value: unknown) => boolean;
  nowIso: () => string;
  readDecisionTaskProofs: (
    options: LooseRecord,
    kind: string,
    queuePath: string,
  ) => DecisionTaskProof[];
  readJsonOrJsonLines: (filePath: string) => LooseRecord[];
  repoRelativeMaybe: (filePath: string | null | undefined) => string | null;
  repoRelativePath: (filePath: string) => string;
  repoRoot: string;
  resolveRepoPath: (filePath: unknown) => string | null;
  rewriteDecisionTaskQueueRowsForChunk: (options: Record<string, unknown>) => LooseRecord[];
  runTiangongJsonStage: (stage: string, argv: string[]) => RuntimeStage;
  selectDecisionTaskQueueRows: (
    queueRows: LooseRecord[],
    options: LooseRecord,
    schemaTypeForRow: (row: LooseRecord) => string,
  ) => { selection: QueueSelection; selected: SelectedQueueRow[] };
  shellQuote: (value: string) => string;
  unique: <T>(values: T[]) => T[];
  writeJson: (filePath: string, value: unknown) => void;
  writeJsonLines: (filePath: string, rows: readonly unknown[]) => void;
}

function recordArray(value: unknown): LooseRecord[] {
  return Array.isArray(value)
    ? value.filter(
        (item): item is LooseRecord =>
          Boolean(item) && typeof item === "object" && !Array.isArray(item),
      )
    : [];
}

export function createClassificationDecisionCommands({
  asText,
  buildClassificationDecisionTaskContextFiles,
  buildClassificationTaskProvenanceContext,
  buildDecisionTaskContextBundle,
  classificationDecisionCode,
  classificationDecisionSchemaType,
  classificationDecisionTargetKey,
  classificationDecisionUsedContextKinds,
  classificationQueueInputRows,
  classificationQueueOutputRows,
  classificationQueueRowType,
  classificationQueueSchemaType,
  classificationQueueTargetKey,
  compactStageReport,
  datasetIdentity,
  decisionAuthoringContext,
  decisionCompletionStatus,
  decisionContextBundleSha256,
  decisionTaskBuildStatus,
  decisionTaskChunkLabel,
  decisionTaskContextBlockers,
  decisionTaskContextBundleHashes,
  decisionTaskContextFileSummary,
  decisionTaskInputRowsOverride,
  decisionTaskProofList,
  decisionTaskReportPayload,
  fileExists,
  hasQueueSelectionOptions,
  hasUnresolvedAiPlaceholder,
  nowIso,
  readDecisionTaskProofs,
  readJsonOrJsonLines,
  repoRelativeMaybe,
  repoRelativePath,
  repoRoot,
  resolveRepoPath,
  rewriteDecisionTaskQueueRowsForChunk,
  runTiangongJsonStage,
  selectDecisionTaskQueueRows,
  shellQuote,
  unique,
  writeJson,
  writeJsonLines,
}: ClassificationDecisionDependencies) {
  function classificationTaskQueueKey(row: LooseRecord): string {
    return [
      asText(row?.dataset_id),
      asText(row?.dataset_version),
      asText(row?.dataset_type),
      classificationQueueSchemaType(row),
    ].join("::");
  }

  function classificationTaskRowTypeForQueueRow(row: LooseRecord): string {
    const schemaType = classificationQueueSchemaType(row);
    if (schemaType === "flow-product" || schemaType === "flow-elementary") {
      return "flow";
    }
    return classificationQueueRowType(row) || asText(row?.dataset_type);
  }

  function classificationTaskInputRowIdentity(
    row: LooseRecord,
    queueRow: LooseRecord,
    index: number,
  ) {
    const rowType = classificationTaskRowTypeForQueueRow(queueRow);
    const identity = datasetIdentity(row, rowType);
    return {
      index,
      row_type: rowType,
      dataset_id: identity.id,
      dataset_version: identity.version,
    };
  }

  function buildClassificationTaskInputRowLookup(
    queueRows: LooseRecord[],
  ): Map<string, AttachedInputRow> {
    const byInput = new Map<string, LooseRecord[]>();
    for (const queueRow of queueRows) {
      const inputRows = classificationQueueInputRows(queueRow);
      if (!inputRows) continue;
      const resolved = resolveRepoPath(inputRows);
      if (!resolved || !fileExists(resolved)) continue;
      if (!byInput.has(resolved)) {
        byInput.set(resolved, readJsonOrJsonLines(resolved));
      }
    }
    const lookup = new Map<string, AttachedInputRow>();
    for (const [inputFile, rows] of byInput.entries()) {
      for (const queueRow of queueRows) {
        if (resolveRepoPath(classificationQueueInputRows(queueRow)) !== inputFile) {
          continue;
        }
        for (const [index, row] of rows.entries()) {
          const identity = classificationTaskInputRowIdentity(row, queueRow, index);
          if (
            identity.dataset_id === asText(queueRow.dataset_id) &&
            identity.dataset_version === asText(queueRow.dataset_version)
          ) {
            lookup.set(classificationTaskQueueKey(queueRow), {
              ...identity,
              input_rows: repoRelativePath(inputFile),
              payload: row,
            });
            break;
          }
        }
      }
    }
    return lookup;
  }

  function classificationTaskEvidenceForQueueRow(
    row: LooseRecord,
    index: number,
    rowLookup: Map<string, AttachedInputRow>,
  ) {
    const inputRow = rowLookup.get(classificationTaskQueueKey(row)) ?? null;
    return {
      source: "classification-authoring-queue",
      queue_row_index: index,
      current_classification: row.current_classification ?? null,
      source_classification: row.source_classification ?? null,
      authoring_context: row.authoring_context ?? null,
      source_file: row.source_file ?? null,
      input_rows: classificationQueueInputRows(row) || null,
      output_rows: classificationQueueOutputRows(row) || null,
      input_row_index: inputRow?.index ?? null,
      input_row_identity: inputRow
        ? {
            dataset_id: inputRow.dataset_id,
            dataset_version: inputRow.dataset_version,
            row_type: inputRow.row_type,
          }
        : null,
      input_row_payload: inputRow?.payload ?? null,
    };
  }

  function buildClassificationDecisionTemplateRows(
    queueRows: LooseRecord[],
    rowLookup = new Map<string, AttachedInputRow>(),
    contextBundle: DecisionContextBundle | null = null,
  ): DecisionTemplateRow[] {
    const authoringContext = contextBundle ? decisionAuthoringContext(contextBundle) : null;
    return queueRows.map((row, index) => ({
      dataset_id: row.dataset_id,
      dataset_version: row.dataset_version,
      category_type: classificationQueueSchemaType(row),
      decision_status: "completed",
      code: "__AI_SELECT_TIDAS_CLASSIFICATION_CODE__",
      basis: "__AI_FILL_CLASSIFICATION_DECISION_BASIS__",
      used_context_kinds: ["__AI_FILL_USED_CONTEXT_KINDS__"],
      ...(authoringContext ? { authoring_context: authoringContext } : {}),
      evidence: classificationTaskEvidenceForQueueRow(row, index, rowLookup),
    }));
  }

  function runDatasetClassificationDecisionTaskBuild(options: LooseRecord) {
    if (options.help) {
      return {
        schema_version: 1,
        status: "help",
        command: "dataset-classification-decision-task-build",
        usage: [
          "node scripts/foundry.ts dataset-classification-decision-task-build --classification-queue <classification-authoring-queue.jsonl> --rows-file <current-rows.jsonl> --schema-file <schema.json> --yaml-file <methodology.yaml> --ruleset-file <runtime-ruleset.json> --classification-schema <tidas_*_category.json> --location-schema <tidas_locations_category.json> --out-dir <task-dir> [--shared-context-cache-dir <cache-dir>]",
        ],
        purpose:
          "Build an AI-facing classification decision task from Foundry classification queue rows. AI fills TIDAS category codes; deterministic apply is handled by dataset-classification-decisions-apply.",
      };
    }

    const queuePath = resolveRepoPath(
      options.classificationQueue || options.queue || options.input,
    );
    if (!queuePath || !fileExists(queuePath)) {
      throw new Error(
        "--classification-queue is required and must point to classification-authoring-queue.jsonl.",
      );
    }
    const outDir = resolveRepoPath(
      options.outDir || ".foundry/workspaces/classification-decision-task",
    )!;
    const sharedContextCacheDir = resolveRepoPath(
      options.sharedContextCacheDir || options.contextCacheDir,
    );
    fs.mkdirSync(outDir, { recursive: true });
    const sourceQueueRows = readJsonOrJsonLines(queuePath);
    const useSelection = hasQueueSelectionOptions(options);
    const inputRowsOverride = decisionTaskInputRowsOverride(options);
    const shouldDeriveQueue = useSelection || Boolean(inputRowsOverride);
    let queueRows = sourceQueueRows;
    let taskQueuePath = queuePath;
    let selection: QueueSelection = {
      source_queue_rows: sourceQueueRows.length,
      matched_queue_rows: sourceQueueRows.length,
      selected_queue_rows: sourceQueueRows.length,
      source_queue_row_indices: sourceQueueRows.map((_, index) => index),
    };
    if (shouldDeriveQueue) {
      const selected = useSelection
        ? selectDecisionTaskQueueRows(sourceQueueRows, options, classificationQueueSchemaType)
        : {
            selection,
            selected: sourceQueueRows.map((row, sourceIndex) => ({
              row,
              sourceIndex,
            })),
          };
      selection = {
        ...selected.selection,
        input_rows_override: inputRowsOverride ? repoRelativePath(inputRowsOverride) : null,
      };
      const chunkLabel = decisionTaskChunkLabel(
        options,
        selection,
        inputRowsOverride ? "classification-current-rows" : "classification-chunk",
      );
      queueRows = rewriteDecisionTaskQueueRowsForChunk({
        selected: selected.selected,
        sourceQueuePath: queuePath,
        outDir,
        chunkLabel,
        workflowKey: "classification_workflow",
        outputSuffix: "classified",
        inputRowsForRow: classificationQueueInputRows,
        inputRowsOverride,
      });
      selection.chunk_label = chunkLabel;
      taskQueuePath = path.join(outDir, `classification-authoring-queue.${chunkLabel}.jsonl`);
      writeJsonLines(taskQueuePath, queueRows);
    }
    const rowLookup = buildClassificationTaskInputRowLookup(queueRows);
    const templatePath = path.join(outDir, "classification-decisions.template.jsonl");
    const taskPath = path.join(outDir, "classification-decision-task.json");
    const reportPath = path.join(outDir, "classification-decision-task-report.json");
    const decisionFile = path.join(outDir, "classification-decisions.jsonl");
    const contractContext = buildClassificationDecisionTaskContextFiles(options);
    const provenanceContext = buildClassificationTaskProvenanceContext(queuePath);
    const attachedInputRows = [...rowLookup.values()];
    const contextBundle = buildDecisionTaskContextBundle({
      taskKind: "classification_decision_authoring",
      taskPath,
      outDir,
      sharedContextCacheDir,
      queuePath: taskQueuePath,
      queueRows,
      contractContext,
      provenanceContext,
      attachedInputRows,
    });
    const templateRows = buildClassificationDecisionTemplateRows(
      queueRows,
      rowLookup,
      contextBundle,
    );
    const queueRowsWithAttachedInput = templateRows.filter(
      (row) => row.evidence?.input_row_payload,
    ).length;
    const blockers = decisionTaskContextBlockers({
      kind: "classification",
      queueRows,
      contractContext,
      requiredContextKinds: [
        "schema",
        "methodology_yaml",
        "ruleset",
        "classification_schema",
        "location_schema",
      ],
      attachedInputRowCount: queueRowsWithAttachedInput,
    });
    const contextFiles = contractContext.files.map((file) => file.path);
    const schemaTypes = unique(queueRows.map(classificationQueueSchemaType));
    const rowTypes = unique(queueRows.map(classificationQueueRowType));
    const task = {
      schema_version: 1,
      generated_at_utc: nowIso(),
      status: decisionTaskBuildStatus({
        queueRows,
        blockers,
        readyStatus: "ready_for_ai_classification_decisions",
        emptyStatus: "ready_no_classification_actions",
      }),
      task_kind: "classification_decision_authoring",
      classification_queue: repoRelativePath(taskQueuePath),
      counts: {
        queue_rows: queueRows.length,
        template_decisions: templateRows.length,
        schema_types: schemaTypes.length,
        row_types: rowTypes.length,
        contract_context_files: contractContext.files.length,
        missing_context_files: contractContext.missing.length,
        attached_input_rows: queueRowsWithAttachedInput,
        unique_attached_input_rows: attachedInputRows.length,
        missing_input_row_payloads: queueRows.length - queueRowsWithAttachedInput,
        provenance_context_files: [
          provenanceContext.source_semantics.file,
          provenanceContext.process_source_references.file,
          provenanceContext.source_reference_rewrites.file,
        ].filter(Boolean).length,
        blockers: blockers.length,
      },
      blockers,
      schema_types: schemaTypes,
      row_types: rowTypes,
      selection,
      source_classification_queue: shouldDeriveQueue ? repoRelativePath(queuePath) : null,
      classification_queue_rows: queueRows,
      attached_input_rows: attachedInputRows,
      provenance_context: provenanceContext,
      context_bundle: contextBundle,
      shared_context_bundle: contextBundle.shared_context_bundle,
      context_files: contextFiles,
      contract_context_files: contractContext.files.map(decisionTaskContextFileSummary),
      missing_context_files: contractContext.missing,
      instructions: [
        "Read shared_context_bundle once for full Foundry/SDK schema, methodology YAML, runtime ruleset, classification/location schema text, then use this task's queue rows, attached payloads, provenance, and source trace before choosing codes.",
        "Replace each template code with a valid TIDAS leaf code for category_type; keep source classification as evidence, not target classification.",
        "Every decision must include dataset_id, dataset_version, category_type, code, basis, used_context_kinds, and structured evidence.",
        "Do not write row JSON directly; run dataset-classification-decisions-apply after decisions are complete.",
      ],
      files: {
        task: repoRelativePath(taskPath),
        template: repoRelativePath(templatePath),
        expected_decisions: repoRelativePath(decisionFile),
        report: repoRelativePath(reportPath),
        shared_context_bundle: contextBundle.shared_context_bundle.path,
      },
      commands: {
        apply_decisions: [
          process.execPath,
          path.join(repoRoot, "scripts", "foundry.mjs"),
          "dataset-classification-decisions-apply",
          "--classification-queue",
          taskQueuePath,
          "--decisions",
          decisionFile,
          "--decision-task",
          taskPath,
          "--out-dir",
          path.join(outDir, "apply"),
        ]
          .map(shellQuote)
          .join(" "),
      },
    };
    writeJsonLines(templatePath, templateRows);
    writeJson(taskPath, task);
    writeJson(reportPath, task);
    return task;
  }

  function validateClassificationDecisionsForQueue(
    queueRows: LooseRecord[],
    decisions: LooseRecord[],
    {
      decisionTaskProof = null,
      decisionKind = "classification",
    }: { decisionTaskProof?: unknown; decisionKind?: string } = {},
  ) {
    const blockers: Array<Record<string, unknown>> = [];
    const decisionTaskProofs = decisionTaskProofList(decisionTaskProof);
    for (const proof of decisionTaskProofs) {
      blockers.push(...proof.blockers);
    }
    const contextBundleHashes = decisionTaskContextBundleHashes(decisionTaskProofs);
    const queueByKey = new Map<string, LooseRecord>(
      queueRows.map((row) => [classificationQueueTargetKey(row), row] as const),
    );
    const decisionsByKey = new Map<string, unknown>();
    for (const [index, decision] of decisions.entries()) {
      const schemaType = classificationDecisionSchemaType(decision);
      const key = classificationDecisionTargetKey(decision);
      if (hasUnresolvedAiPlaceholder(decision)) {
        blockers.push({
          code: "classification_decision_template_incomplete",
          message: "Classification decision still contains an AI placeholder.",
          decision_index: index,
        });
        continue;
      }
      if (decisionCompletionStatus(decision) !== "completed") {
        blockers.push({
          code: `${decisionKind}_decision_status_not_completed`,
          message:
            "Classification decision must declare decision_status=completed before deterministic apply.",
          decision_index: index,
          decision_status: decisionCompletionStatus(decision) || null,
        });
      }
      if (!schemaType) {
        blockers.push({
          code: "classification_decision_schema_type_missing",
          message: "Classification decision must include category_type.",
          decision_index: index,
        });
        continue;
      }
      if (!classificationDecisionCode(decision)) {
        blockers.push({
          code: "classification_decision_code_missing",
          message: "Classification decision must include a TIDAS category code.",
          decision_index: index,
        });
      }
      if (!asText(decision.basis)) {
        blockers.push({
          code: "classification_decision_basis_missing",
          message: "Classification decision must include basis.",
          decision_index: index,
        });
      }
      if (!decision.evidence || typeof decision.evidence !== "object") {
        blockers.push({
          code: "classification_decision_evidence_missing",
          message: "Classification decision must include structured evidence.",
          decision_index: index,
        });
      }
      if (classificationDecisionUsedContextKinds(decision).length === 0) {
        blockers.push({
          code: "classification_decision_used_context_missing",
          message:
            "Classification decision must include used_context_kinds so full-context AI evidence is auditable.",
          decision_index: index,
        });
      }
      if (contextBundleHashes.length > 0) {
        const decisionBundleHash = decisionContextBundleSha256(decision);
        if (!decisionBundleHash) {
          blockers.push({
            code: `${decisionKind}_decision_context_bundle_missing`,
            message:
              "Decision must include authoring_context.context_bundle_sha256 from the AI decision task template.",
            decision_index: index,
            decision_tasks: decisionTaskProofs.map((proof) => proof.path),
          });
        } else if (!contextBundleHashes.includes(decisionBundleHash)) {
          blockers.push({
            code: `${decisionKind}_decision_context_bundle_mismatch`,
            message:
              "Decision authoring context hash does not match the AI decision task context bundle.",
            decision_index: index,
            expected_context_bundle_sha256:
              contextBundleHashes.length === 1 ? contextBundleHashes[0] : null,
            expected_context_bundle_sha256_any_of: contextBundleHashes,
            actual_context_bundle_sha256: decisionBundleHash,
            decision_tasks: decisionTaskProofs.map((proof) => proof.path),
          });
        }
      }
      if (!queueByKey.has(key)) {
        blockers.push({
          code: "classification_decision_not_in_queue",
          message:
            "Classification decision does not match a queued dataset_id/version/category_type.",
          decision_index: index,
          decision_key: key,
        });
        continue;
      }
      if (decisionsByKey.has(key)) {
        blockers.push({
          code: "classification_decision_duplicate",
          message: "More than one decision targets the same queue row.",
          decision_index: index,
          decision_key: key,
        });
        continue;
      }
      decisionsByKey.set(key, { ...decision, category_type: schemaType });
    }
    for (const row of queueRows) {
      const key = classificationQueueTargetKey(row);
      if (!decisionsByKey.has(key)) {
        blockers.push({
          code: "classification_queue_item_unclosed",
          message: "Every classification queue row must be closed by one decision.",
          dataset_type: row.dataset_type,
          dataset_id: row.dataset_id,
          dataset_version: row.dataset_version,
          schema_type: classificationQueueSchemaType(row),
        });
      }
    }
    return { blockers, decisionsByKey };
  }

  function libraryClassificationDecisionCode(row: LooseRecord | undefined): string {
    return asText(row?.selected_code ?? row?.selectedCode ?? classificationDecisionCode(row));
  }

  function libraryClassificationDecisionKey(row: LooseRecord): string {
    const schemaType = classificationDecisionSchemaType(row);
    const datasetId = asText(row?.dataset_id ?? row?.datasetId ?? row?.id ?? row?.uuid);
    const version = asText(row?.dataset_version ?? row?.datasetVersion ?? row?.version);
    return `${schemaType}::${datasetId}::${version}`;
  }

  function classificationDecisionIsTooBroad(
    queueRow: LooseRecord,
    decision: LooseRecord,
    code: string,
  ): boolean {
    const schemaType = classificationQueueSchemaType(queueRow);
    if (!["process", "flow-product"].includes(schemaType)) return false;
    const level = asText(
      decision?.classification_decision_level ?? decision?.classificationDecisionLevel,
    );
    if (level === "broad_section") return true;
    if (schemaType === "process") return /^[A-Z]$/u.test(code) || /^\d{1,3}$/u.test(code);
    return /^\d{1,3}$/u.test(code);
  }

  function decisionTaskAuthoringContext(task: LooseRecord, taskPath: string) {
    const contextBundle = task?.context_bundle ?? task?.contextBundle;
    const contractFiles = recordArray(contextBundle?.contract_context_files);
    return {
      task: contextBundle?.task ?? repoRelativePath(taskPath),
      context_bundle_sha256: asText(contextBundle?.sha256),
      required_context_kinds: unique(
        contractFiles.map((file) => asText(file?.kind)).filter(Boolean),
      ),
      context_files: contractFiles.map((file) => ({
        kind: asText(file?.kind) || "context",
        path: asText(file?.path) || null,
        sha256: asText(file?.sha256) || null,
      })),
    };
  }

  function runDatasetLibraryClassificationDecisionsProject(options: LooseRecord) {
    if (options.help) {
      return {
        schema_version: 1,
        status: "help",
        command: "dataset-library-classification-decisions-project",
        usage: [
          "node scripts/foundry.ts dataset-library-classification-decisions-project --classification-queue <classification-authoring-queue.jsonl> --library-decisions <run-dir>/decisions/classification-decisions.jsonl --decision-task <classification-decision-task.json> --out-dir <projection-dir>",
        ],
        purpose:
          "Project library-level semantic classification decisions into a scope-local decision file bound to an exact classification decision task before deterministic apply.",
      };
    }

    const queuePath = resolveRepoPath(options.classificationQueue || options.queue);
    const decisionsDir = resolveRepoPath(options.decisionsDir || options.libraryDecisionsDir);
    const libraryDecisionsPath = resolveRepoPath(
      options.libraryDecisions ||
        options.libraryDecisionFile ||
        options.decisions ||
        (decisionsDir ? path.join(decisionsDir, "classification-decisions.jsonl") : null),
    );
    const decisionTaskPath = resolveRepoPath(
      options.decisionTask || options.classificationDecisionTask || options.task,
    );
    if (!queuePath || !fileExists(queuePath)) {
      throw new Error(
        "--classification-queue is required and must point to classification-authoring-queue.jsonl.",
      );
    }
    if (!libraryDecisionsPath || !fileExists(libraryDecisionsPath)) {
      throw new Error(
        "--library-decisions or --decisions-dir is required and must point to classification-decisions.jsonl.",
      );
    }
    if (!decisionTaskPath || !fileExists(decisionTaskPath)) {
      throw new Error(
        "--decision-task is required so projected decisions can bind to the exact full-context task bundle.",
      );
    }

    const outDir = resolveRepoPath(
      options.outDir || ".foundry/workspaces/library-classification-decisions-project",
    )!;
    const queueRows = readJsonOrJsonLines(queuePath);
    const libraryRows = readJsonOrJsonLines(libraryDecisionsPath);
    const decisionTask = readJsonOrJsonLines(decisionTaskPath);
    const taskPayload = Array.isArray(decisionTask) ? decisionTask[0] : decisionTask;
    const authoringContext = decisionTaskAuthoringContext(taskPayload, decisionTaskPath);
    const requiredContextKinds = unique([
      ...authoringContext.required_context_kinds,
      "schema",
      "methodology_yaml",
      "ruleset",
      "classification_schema",
      "location_schema",
    ]);
    const libraryByKey = new Map<string, LooseRecord>(
      libraryRows.map((row) => [libraryClassificationDecisionKey(row), row] as const),
    );
    const projected = [];
    const manualReview = [];

    for (const [index, queueRow] of queueRows.entries()) {
      const key = classificationQueueTargetKey(queueRow);
      const decision = libraryByKey.get(key);
      const code = libraryClassificationDecisionCode(decision);
      if (
        !decision ||
        decisionCompletionStatus(decision) !== "completed" ||
        !code ||
        hasUnresolvedAiPlaceholder(decision)
      ) {
        manualReview.push({
          schema_version: 1,
          status: "manual_review",
          reason: decision
            ? "library_classification_decision_incomplete"
            : "library_classification_decision_missing",
          queue_row_index: index,
          decision_key: key,
          dataset_type: queueRow.dataset_type ?? null,
          dataset_id: queueRow.dataset_id ?? null,
          dataset_version: queueRow.dataset_version ?? null,
          category_type: classificationQueueSchemaType(queueRow) || null,
          required_human_action:
            "Provide a completed library-level classification decision, then rerun this projection and deterministic classification apply.",
        });
        continue;
      }
      if (classificationDecisionIsTooBroad(queueRow, decision, code)) {
        manualReview.push({
          schema_version: 1,
          status: "manual_review",
          reason: "library_classification_decision_not_leaf",
          queue_row_index: index,
          decision_key: key,
          dataset_type: queueRow.dataset_type ?? null,
          dataset_id: queueRow.dataset_id ?? null,
          dataset_version: queueRow.dataset_version ?? null,
          category_type: classificationQueueSchemaType(queueRow) || null,
          selected_code: code,
          required_human_action:
            "Replace the broad classification with a full TIDAS leaf code selected through dataset classification children/path, then rerun this projection and deterministic classification apply.",
        });
        continue;
      }
      const usedContextKinds = unique([
        ...requiredContextKinds,
        ...classificationDecisionUsedContextKinds(decision),
      ]);
      projected.push({
        schema_version: 1,
        dataset_id: queueRow.dataset_id,
        dataset_version: queueRow.dataset_version,
        category_type: classificationQueueSchemaType(queueRow),
        decision_status: "completed",
        code,
        basis:
          asText(decision.basis) ||
          "Projected from completed library-level classification decision.",
        authoring_context: authoringContext,
        used_context_kinds: usedContextKinds,
        evidence: {
          source: "library-classification-decisions-project",
          projection: "library_decision_to_scope_classification_queue",
          used_context_kinds: usedContextKinds,
          queue: {
            row_index: index,
            dataset_type: queueRow.dataset_type ?? null,
            dataset_id: queueRow.dataset_id ?? null,
            dataset_version: queueRow.dataset_version ?? null,
            category_type: classificationQueueSchemaType(queueRow) || null,
            current_classification: queueRow.current_classification ?? null,
            source_classification: queueRow.source_classification ?? null,
            authoring_context: queueRow.authoring_context ?? null,
            source_file: queueRow.source_file ?? null,
            foundry_selection: queueRow.foundry_selection ?? null,
          },
          library_decision: {
            decision_key: key,
            selected_code: code,
            basis: decision.basis ?? null,
            confidence: decision.confidence ?? null,
            source_name: decision.source_name ?? null,
            converted_classification_reference: decision.converted_classification_reference ?? null,
            converted_classification_reference_policy:
              decision.converted_classification_reference_policy ?? null,
            classification_decision_level: decision.classification_decision_level ?? null,
            rule_hits: decision.rule_hits ?? null,
          },
        },
      });
    }

    const decisionsPath = path.join(outDir, "classification-decisions.jsonl");
    const manualReviewPath = path.join(outDir, "classification-decisions.manual-review.jsonl");
    const reportPath = path.join(
      outDir,
      "dataset-library-classification-decisions-project-report.json",
    );
    writeJsonLines(decisionsPath, projected);
    writeJsonLines(manualReviewPath, manualReview);
    const report = {
      schema_version: 1,
      generated_at_utc: nowIso(),
      status: manualReview.length > 0 ? "blocked" : "completed",
      command: "dataset-library-classification-decisions-project",
      classification_queue: repoRelativePath(queuePath),
      library_decisions: repoRelativePath(libraryDecisionsPath),
      decision_task: repoRelativePath(decisionTaskPath),
      counts: {
        queue_rows: queueRows.length,
        library_decisions: libraryRows.length,
        projected_decisions: projected.length,
        manual_review: manualReview.length,
        blockers: manualReview.length,
      },
      policy: {
        classification_ai_decision_boundary:
          "The library decision contains the semantic choice. This projection only binds it to a scope-local full-context decision task before deterministic CLI classification apply.",
        tidas_tools_classification_policy: "weak_hint_only",
      },
      blockers: manualReview.map((row) => ({
        code: row.reason,
        message: row.required_human_action,
        dataset_id: row.dataset_id,
        dataset_version: row.dataset_version,
        category_type: row.category_type,
      })),
      files: {
        report: repoRelativePath(reportPath),
        decisions: repoRelativePath(decisionsPath),
        manual_review: repoRelativePath(manualReviewPath),
      },
    };
    writeJson(reportPath, report);
    return report;
  }

  function outputRowsForClassificationGroup(
    rows: LooseRecord[],
    outDir: string,
    inputRows: string,
    options: LooseRecord,
  ): string {
    if (options.out && rows.length > 0) return resolveRepoPath(options.out)!;
    const outputRows = unique(rows.map(classificationQueueOutputRows)).filter(Boolean);
    if (outputRows.length === 1) return resolveRepoPath(outputRows[0])!;
    const inputBase = path.basename(inputRows).replace(/\.(jsonl|json)$/iu, "");
    return path.join(outDir, "rows", `${inputBase}.classified.jsonl`);
  }

  function runDatasetClassificationDecisionsApply(options: LooseRecord) {
    if (options.help) {
      return {
        schema_version: 1,
        status: "help",
        command: "dataset-classification-decisions-apply",
        wraps: "tiangong-lca dataset classification apply",
        usage: [
          "node scripts/foundry.ts dataset-classification-decisions-apply --classification-queue <classification-authoring-queue.jsonl> --decisions <classification-decisions.jsonl> --decision-task <classification-decision-task.json> --out-dir <apply-dir>",
        ],
        purpose:
          "Validate AI-authored classification decisions against the Foundry queue and AI context task, then call the CLI classification apply command for each required schema type and row file.",
      };
    }

    const queuePath = resolveRepoPath(options.classificationQueue || options.queue);
    const decisionsPath = resolveRepoPath(
      options.decisions || options.decisionFile || options.input,
    );
    if (!queuePath || !fileExists(queuePath)) {
      throw new Error(
        "--classification-queue is required and must point to classification-authoring-queue.jsonl.",
      );
    }
    if (!decisionsPath || !fileExists(decisionsPath)) {
      throw new Error("--decisions is required and must point to JSON/JSONL decisions.");
    }
    const outDir = resolveRepoPath(
      options.outDir || ".foundry/workspaces/classification-decisions-apply",
    )!;
    const reportPath = path.join(outDir, "classification-decisions-apply-report.json");
    const queueRows = readJsonOrJsonLines(queuePath);
    const decisions = readJsonOrJsonLines(decisionsPath);
    const decisionTaskProofs = readDecisionTaskProofs(options, "classification", queuePath);
    const decisionTaskProof = decisionTaskProofs.length === 1 ? decisionTaskProofs[0] : null;
    const { blockers, decisionsByKey } = validateClassificationDecisionsForQueue(
      queueRows,
      decisions,
      { decisionTaskProof: decisionTaskProofs, decisionKind: "classification" },
    );
    const stages: RuntimeStage[] = [];
    const inputRowsFiles: string[] = [];
    const outputRows: string[] = [];

    if (blockers.length === 0 && queueRows.length > 0) {
      const queueRowsByInput = new Map<string, { inputRows: string; rows: LooseRecord[] }>();
      for (const row of queueRows) {
        const inputRows = resolveRepoPath(
          options.rowsFile || options.inputRows || classificationQueueInputRows(row),
        );
        if (!inputRows || !fileExists(inputRows)) {
          blockers.push({
            code: "classification_input_rows_missing",
            message: "Queued classification workflow input rows file is missing.",
            dataset_id: row.dataset_id,
            schema_type: classificationQueueSchemaType(row),
            input_rows: classificationQueueInputRows(row),
          });
          continue;
        }
        const key = repoRelativePath(inputRows);
        const group = queueRowsByInput.get(key) ?? {
          inputRows,
          rows: [],
        };
        group.rows.push(row);
        queueRowsByInput.set(key, group);
      }

      for (const group of queueRowsByInput.values()) {
        const finalOutputRows = outputRowsForClassificationGroup(
          group.rows,
          outDir,
          group.inputRows,
          options,
        );
        inputRowsFiles.push(repoRelativePath(group.inputRows));
        const schemaTypes = unique(group.rows.map(classificationQueueSchemaType));
        let currentInput = group.inputRows;
        for (const [index, schemaType] of schemaTypes.entries()) {
          const groupRowsForSchema = group.rows.filter(
            (row) => classificationQueueSchemaType(row) === schemaType,
          );
          const groupDecisions = groupRowsForSchema.map((row) =>
            decisionsByKey.get(classificationQueueTargetKey(row)),
          );
          const decisionFile = path.join(
            outDir,
            "decisions",
            `${schemaType}-classification-decisions.jsonl`,
          );
          const isLast = index === schemaTypes.length - 1;
          const stageOutputRows = isLast
            ? finalOutputRows
            : path.join(
                outDir,
                "intermediate",
                `${path.basename(group.inputRows).replace(/\.(jsonl|json)$/iu, "")}.${schemaType}.jsonl`,
              );
          fs.mkdirSync(path.dirname(decisionFile), { recursive: true });
          fs.mkdirSync(path.dirname(stageOutputRows), { recursive: true });
          writeJsonLines(decisionFile, groupDecisions);
          const stage = runTiangongJsonStage(`classification_apply_${schemaType}`, [
            "dataset",
            "classification",
            "apply",
            "--input",
            currentInput,
            "--decisions",
            decisionFile,
            "--out",
            stageOutputRows,
            "--type",
            schemaType,
            "--out-dir",
            path.join(outDir, "classification", schemaType),
            "--json",
          ]);
          stage.report_file = resolveRepoPath(stage.report?.files?.report);
          stages.push(stage);
          if (stage.exit_code !== 0) {
            const stageSummary = compactStageReport(stage);
            blockers.push({
              code: "classification_apply_stage_failed",
              message: `CLI classification apply failed for ${schemaType}.`,
              schema_type: schemaType,
              exit_code: stage.exit_code,
              report_file: repoRelativeMaybe(stage.report_file),
              stage: stageSummary,
              stderr: stageSummary.stderr || "",
            });
            break;
          }
          currentInput = stageOutputRows;
        }
        outputRows.push(repoRelativePath(finalOutputRows));
      }
    }

    const report = {
      schema_version: 1,
      generated_at_utc: nowIso(),
      status: blockers.length > 0 ? "blocked" : "completed",
      command: "dataset-classification-decisions-apply",
      classification_queue: repoRelativePath(queuePath),
      decisions_file: repoRelativePath(decisionsPath),
      decision_task: decisionTaskReportPayload(decisionTaskProof),
      decision_tasks: decisionTaskProofs.map(decisionTaskReportPayload),
      counts: {
        queue_rows: queueRows.length,
        decisions: decisions.length,
        stages: stages.length,
        applied: stages.reduce(
          (total, stage) => total + Number(stage.report?.counts?.applied ?? 0),
          0,
        ),
        blockers: blockers.length,
      },
      blockers,
      stages: stages.map(compactStageReport),
      files: {
        report: repoRelativePath(reportPath),
        input_rows: unique(inputRowsFiles),
        output_rows: outputRows,
      },
    };
    fs.mkdirSync(outDir, { recursive: true });
    writeJson(reportPath, report);
    return report;
  }

  return {
    runDatasetClassificationDecisionTaskBuild,
    runDatasetClassificationDecisionsApply,
    runDatasetLibraryClassificationDecisionsProject,
  };
}

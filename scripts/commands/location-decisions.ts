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

interface LocationDecisionDependencies {
  asText: (value: unknown) => string;
  buildClassificationDecisionTaskContextFiles: (options: LooseRecord) => ContractContext;
  buildClassificationTaskProvenanceContext: (queuePath: string) => ProvenanceContext;
  buildDecisionTaskContextBundle: (options: Record<string, unknown>) => DecisionContextBundle;
  classificationDecisionCode: (decision: LooseRecord | undefined) => string;
  classificationDecisionSchemaType: (decision: LooseRecord) => string;
  classificationDecisionUsedContextKinds: (decision: LooseRecord) => string[];
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
  ensureArray: (value: unknown) => LooseRecord[];
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

export function createLocationDecisionCommands({
  asText,
  buildClassificationDecisionTaskContextFiles,
  buildClassificationTaskProvenanceContext,
  buildDecisionTaskContextBundle,
  classificationDecisionCode,
  classificationDecisionSchemaType,
  classificationDecisionUsedContextKinds,
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
  ensureArray,
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
}: LocationDecisionDependencies) {
  function locationQueueInputRows(row: LooseRecord): string {
    return asText(row?.location_workflow?.commands?.input_rows);
  }

  function locationQueueOutputRows(row: LooseRecord): string {
    return asText(row?.location_workflow?.commands?.output_rows);
  }

  function locationQueueTargetKey(row: LooseRecord): string {
    return `location::${asText(row?.dataset_id)}::${asText(
      row?.dataset_version,
    )}::${asText(row?.path)}`;
  }

  function locationDecisionTargetPath(decision: LooseRecord): string {
    return asText(
      decision?.target_path ??
        decision?.targetPath ??
        decision?.location_path ??
        decision?.locationPath ??
        decision?.path,
    );
  }

  function locationDecisionTargetKey(decision: LooseRecord): string {
    return `location::${asText(
      decision?.dataset_id ?? decision?.datasetId ?? decision?.id,
    )}::${asText(
      decision?.dataset_version ?? decision?.datasetVersion ?? decision?.version,
    )}::${locationDecisionTargetPath(decision)}`;
  }

  function buildLocationTaskInputRowLookup(
    queueRows: LooseRecord[],
  ): Map<string, AttachedInputRow> {
    const byInput = new Map<string, LooseRecord[]>();
    for (const queueRow of queueRows) {
      const inputRows = locationQueueInputRows(queueRow);
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
        if (resolveRepoPath(locationQueueInputRows(queueRow)) !== inputFile) {
          continue;
        }
        const rowType = asText(queueRow.dataset_type);
        for (const [index, row] of rows.entries()) {
          const identity = datasetIdentity(row, rowType);
          if (
            identity.id === asText(queueRow.dataset_id) &&
            identity.version === asText(queueRow.dataset_version)
          ) {
            lookup.set(locationQueueTargetKey(queueRow), {
              index,
              row_type: rowType,
              dataset_id: identity.id,
              dataset_version: identity.version,
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

  function locationTaskEvidenceForQueueRow(
    row: LooseRecord,
    index: number,
    rowLookup: Map<string, AttachedInputRow>,
  ) {
    const inputRow = rowLookup.get(locationQueueTargetKey(row)) ?? null;
    return {
      source: "location-authoring-queue",
      queue_row_index: index,
      current_location: row.current_location ?? null,
      target_path: row.path ?? null,
      source_file: row.source_file ?? null,
      input_rows: locationQueueInputRows(row) || null,
      output_rows: locationQueueOutputRows(row) || null,
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

  function buildLocationDecisionTemplateRows(
    queueRows: LooseRecord[],
    rowLookup = new Map<string, AttachedInputRow>(),
    contextBundle: DecisionContextBundle | null = null,
  ): DecisionTemplateRow[] {
    const authoringContext = contextBundle ? decisionAuthoringContext(contextBundle) : null;
    return queueRows.map((row, index) => ({
      dataset_id: row.dataset_id,
      dataset_version: row.dataset_version,
      category_type: "location",
      decision_status: "completed",
      code: "__AI_SELECT_TIDAS_LOCATION_CODE__",
      target_path: row.path,
      basis: "__AI_FILL_LOCATION_DECISION_BASIS__",
      used_context_kinds: ["__AI_FILL_USED_CONTEXT_KINDS__"],
      ...(authoringContext ? { authoring_context: authoringContext } : {}),
      evidence: locationTaskEvidenceForQueueRow(row, index, rowLookup),
    }));
  }

  function runDatasetLocationDecisionTaskBuild(options: LooseRecord) {
    if (options.help) {
      return {
        schema_version: 1,
        status: "help",
        command: "dataset-location-decision-task-build",
        usage: [
          "node scripts/foundry.ts dataset-location-decision-task-build --location-queue <location-authoring-queue.jsonl> --rows-file <current-rows.jsonl> --schema-file <schema.json> --yaml-file <methodology.yaml> --ruleset-file <runtime-ruleset.json> --classification-schema <tidas_*_category.json> --location-schema <tidas_locations_category.json> --out-dir <task-dir> [--shared-context-cache-dir <cache-dir>]",
        ],
        purpose:
          "Build an AI-facing location coding task from Foundry location queue rows. AI fills TIDAS location codes; deterministic apply is handled by dataset-location-decisions-apply.",
      };
    }

    const queuePath = resolveRepoPath(options.locationQueue || options.queue || options.input);
    if (!queuePath || !fileExists(queuePath)) {
      throw new Error(
        "--location-queue is required and must point to location-authoring-queue.jsonl.",
      );
    }
    const outDir = resolveRepoPath(options.outDir || ".foundry/workspaces/location-decision-task")!;
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
        ? selectDecisionTaskQueueRows(sourceQueueRows, options, () => "location")
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
        inputRowsOverride ? "location-current-rows" : "location-chunk",
      );
      queueRows = rewriteDecisionTaskQueueRowsForChunk({
        selected: selected.selected,
        sourceQueuePath: queuePath,
        outDir,
        chunkLabel,
        workflowKey: "location_workflow",
        outputSuffix: "located",
        inputRowsForRow: locationQueueInputRows,
        inputRowsOverride,
      });
      selection.chunk_label = chunkLabel;
      taskQueuePath = path.join(outDir, `location-authoring-queue.${chunkLabel}.jsonl`);
      writeJsonLines(taskQueuePath, queueRows);
    }
    const rowLookup = buildLocationTaskInputRowLookup(queueRows);
    const templatePath = path.join(outDir, "location-decisions.template.jsonl");
    const taskPath = path.join(outDir, "location-decision-task.json");
    const reportPath = path.join(outDir, "location-decision-task-report.json");
    const decisionFile = path.join(outDir, "location-decisions.jsonl");
    const contractContext = buildClassificationDecisionTaskContextFiles(options);
    const provenanceContext = buildClassificationTaskProvenanceContext(queuePath);
    const attachedInputRows = [...rowLookup.values()];
    const contextBundle = buildDecisionTaskContextBundle({
      taskKind: "location_decision_authoring",
      taskPath,
      outDir,
      sharedContextCacheDir,
      queuePath: taskQueuePath,
      queueRows,
      contractContext,
      provenanceContext,
      attachedInputRows,
    });
    const templateRows = buildLocationDecisionTemplateRows(queueRows, rowLookup, contextBundle);
    const queueRowsWithAttachedInput = templateRows.filter(
      (row) => row.evidence?.input_row_payload,
    ).length;
    const blockers = decisionTaskContextBlockers({
      kind: "location",
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
    const datasetTypes = unique(queueRows.map((row) => asText(row.dataset_type)));
    const task = {
      schema_version: 1,
      generated_at_utc: nowIso(),
      status: decisionTaskBuildStatus({
        queueRows,
        blockers,
        readyStatus: "ready_for_ai_location_decisions",
        emptyStatus: "ready_no_location_actions",
      }),
      task_kind: "location_decision_authoring",
      location_queue: repoRelativePath(taskQueuePath),
      counts: {
        queue_rows: queueRows.length,
        template_decisions: templateRows.length,
        dataset_types: datasetTypes.length,
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
      dataset_types: datasetTypes,
      selection,
      source_location_queue: shouldDeriveQueue ? repoRelativePath(queuePath) : null,
      location_queue_rows: queueRows,
      attached_input_rows: attachedInputRows,
      provenance_context: provenanceContext,
      context_bundle: contextBundle,
      shared_context_bundle: contextBundle.shared_context_bundle,
      context_files: contractContext.files.map((file) => file.path),
      contract_context_files: contractContext.files.map(decisionTaskContextFileSummary),
      missing_context_files: contractContext.missing,
      instructions: [
        "Read shared_context_bundle once for full Foundry/SDK schema, methodology YAML, runtime ruleset, tidas_locations_category.json text, then use this task's queue rows, attached payloads, provenance, and source trace before choosing location codes.",
        "Replace each template code with a valid TIDAS location code; keep source location text as evidence, not target code.",
        "Every decision must include dataset_id, dataset_version, category_type=location, code, target_path, basis, used_context_kinds, and structured evidence.",
        "Do not write row JSON directly; run dataset-location-decisions-apply after decisions are complete.",
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
          "dataset-location-decisions-apply",
          "--location-queue",
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

  function validateLocationDecisionsForQueue(
    queueRows: LooseRecord[],
    decisions: LooseRecord[],
    { decisionTaskProof = null }: { decisionTaskProof?: unknown } = {},
  ) {
    const blockers: Array<Record<string, unknown>> = [];
    const decisionTaskProofs = decisionTaskProofList(decisionTaskProof);
    for (const proof of decisionTaskProofs) {
      blockers.push(...proof.blockers);
    }
    const contextBundleHashes = decisionTaskContextBundleHashes(decisionTaskProofs);
    const queueByKey = new Map<string, LooseRecord>(
      queueRows.map((row) => [locationQueueTargetKey(row), row] as const),
    );
    const decisionsByKey = new Map<string, unknown>();
    for (const [index, decision] of decisions.entries()) {
      const key = locationDecisionTargetKey(decision);
      if (hasUnresolvedAiPlaceholder(decision)) {
        blockers.push({
          code: "location_decision_template_incomplete",
          message: "Location decision still contains an AI placeholder.",
          decision_index: index,
        });
        continue;
      }
      if (decisionCompletionStatus(decision) !== "completed") {
        blockers.push({
          code: "location_decision_status_not_completed",
          message:
            "Location decision must declare decision_status=completed before deterministic apply.",
          decision_index: index,
          decision_status: decisionCompletionStatus(decision) || null,
        });
      }
      if (classificationDecisionSchemaType(decision) !== "location") {
        blockers.push({
          code: "location_decision_schema_type_invalid",
          message: "Location decision must include category_type=location.",
          decision_index: index,
        });
      }
      if (!classificationDecisionCode(decision)) {
        blockers.push({
          code: "location_decision_code_missing",
          message: "Location decision must include a TIDAS location code.",
          decision_index: index,
        });
      }
      if (!locationDecisionTargetPath(decision)) {
        blockers.push({
          code: "location_decision_target_path_missing",
          message: "Location decision must include target_path.",
          decision_index: index,
        });
      }
      if (!asText(decision.basis)) {
        blockers.push({
          code: "location_decision_basis_missing",
          message: "Location decision must include basis.",
          decision_index: index,
        });
      }
      if (!decision.evidence || typeof decision.evidence !== "object") {
        blockers.push({
          code: "location_decision_evidence_missing",
          message: "Location decision must include structured evidence.",
          decision_index: index,
        });
      }
      if (classificationDecisionUsedContextKinds(decision).length === 0) {
        blockers.push({
          code: "location_decision_used_context_missing",
          message:
            "Location decision must include used_context_kinds so full-context AI evidence is auditable.",
          decision_index: index,
        });
      }
      if (contextBundleHashes.length > 0) {
        const decisionBundleHash = decisionContextBundleSha256(decision);
        if (!decisionBundleHash) {
          blockers.push({
            code: "location_decision_context_bundle_missing",
            message:
              "Location decision must include authoring_context.context_bundle_sha256 from the AI decision task template.",
            decision_index: index,
            decision_tasks: decisionTaskProofs.map((proof) => proof.path),
          });
        } else if (!contextBundleHashes.includes(decisionBundleHash)) {
          blockers.push({
            code: "location_decision_context_bundle_mismatch",
            message:
              "Location decision authoring context hash does not match the AI decision task context bundle.",
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
          code: "location_decision_not_in_queue",
          message: "Location decision does not match a queued dataset_id/version/target_path.",
          decision_index: index,
          decision_key: key,
        });
        continue;
      }
      if (decisionsByKey.has(key)) {
        blockers.push({
          code: "location_decision_duplicate",
          message: "More than one location decision targets the same queue row.",
          decision_index: index,
          decision_key: key,
        });
        continue;
      }
      decisionsByKey.set(key, { ...decision, category_type: "location" });
    }
    for (const row of queueRows) {
      const key = locationQueueTargetKey(row);
      if (!decisionsByKey.has(key)) {
        blockers.push({
          code: "location_queue_item_unclosed",
          message: "Every location queue row must be closed by one decision.",
          dataset_type: row.dataset_type,
          dataset_id: row.dataset_id,
          dataset_version: row.dataset_version,
          path: row.path,
        });
      }
    }
    return { blockers, decisionsByKey };
  }

  function locationDecisionTaskAuthoringContext(task: LooseRecord, taskPath: string) {
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

  function locationSchemaCodeSet(options: LooseRecord): Set<string> | null {
    const schemaPath = resolveRepoPath(options.locationSchema || options.locationCategorySchema);
    if (!schemaPath || !fileExists(schemaPath)) return null;
    const schemaRows = readJsonOrJsonLines(schemaPath);
    const schema = Array.isArray(schemaRows) && schemaRows.length === 1 ? schemaRows[0] : {};
    const oneOf = recordArray(schema?.oneOf);
    return new Set(oneOf.map((entry) => asText(entry?.const)).filter(Boolean));
  }

  function collectSuggestedLocationCodes(queueRow: LooseRecord): string[] {
    const values = [
      queueRow?.suggested_location_code,
      queueRow?.suggestedLocationCode,
      queueRow?.suggested_code,
      queueRow?.suggestedCode,
      queueRow?.evidence?.suggested_value,
      queueRow?.evidence?.suggestedValue,
    ];
    for (const candidate of ensureArray(queueRow?.evidence?.candidates)) {
      values.push(candidate?.code);
      values.push(candidate?.suggested_value);
    }
    return unique(values.map(asText).filter(Boolean));
  }

  function runDatasetLocationDecisionsSuggest(options: LooseRecord) {
    if (options.help) {
      return {
        schema_version: 1,
        status: "help",
        command: "dataset-location-decisions-suggest",
        usage: [
          "node scripts/foundry.ts dataset-location-decisions-suggest --location-queue <location-authoring-queue.jsonl> --decision-task <location-decision-task.json> --location-schema <tidas_locations_category.json> --out-dir <decisions-dir>",
        ],
        purpose:
          "Generate completed location decisions only for queue rows that already contain one provable TIDAS location code candidate, binding each decision to the exact location decision task context bundle.",
      };
    }

    const queuePath = resolveRepoPath(options.locationQueue || options.queue);
    const decisionTaskPath = resolveRepoPath(
      options.decisionTask || options.locationDecisionTask || options.task,
    );
    if (!queuePath || !fileExists(queuePath)) {
      throw new Error(
        "--location-queue is required and must point to location-authoring-queue.jsonl.",
      );
    }
    if (!decisionTaskPath || !fileExists(decisionTaskPath)) {
      throw new Error(
        "--decision-task is required so suggested decisions can bind to the exact full-context task bundle.",
      );
    }
    const outDir = resolveRepoPath(options.outDir || ".foundry/workspaces/location-decisions")!;
    const queueRows = readJsonOrJsonLines(queuePath);
    const decisionTask = readJsonOrJsonLines(decisionTaskPath);
    const taskPayload = Array.isArray(decisionTask) ? decisionTask[0] : decisionTask;
    const authoringContext = locationDecisionTaskAuthoringContext(taskPayload, decisionTaskPath);
    const requiredContextKinds = unique([
      ...authoringContext.required_context_kinds,
      "schema",
      "methodology_yaml",
      "ruleset",
      "classification_schema",
      "location_schema",
      "location_authoring_queue",
    ]);
    const validCodes = locationSchemaCodeSet(options);
    const decisions: Array<Record<string, unknown>> = [];
    const manualReview: Array<Record<string, unknown>> = [];

    for (const [index, queueRow] of queueRows.entries()) {
      const candidates = collectSuggestedLocationCodes(queueRow);
      const validCandidates = validCodes
        ? candidates.filter((code) => validCodes.has(code))
        : candidates;
      if (validCandidates.length !== 1) {
        manualReview.push({
          schema_version: 1,
          status: "manual_review",
          reason:
            validCandidates.length === 0
              ? "location_suggestion_missing_or_invalid"
              : "location_suggestion_conflict",
          queue_row_index: index,
          dataset_type: queueRow.dataset_type ?? null,
          dataset_id: queueRow.dataset_id ?? null,
          dataset_version: queueRow.dataset_version ?? null,
          target_path: queueRow.path ?? null,
          candidate_codes: candidates,
          valid_candidate_codes: validCandidates,
          required_human_action:
            "Provide one evidence-backed TIDAS location code decision for this queue row, then rerun deterministic location apply.",
        });
        continue;
      }
      const code = validCandidates[0];
      const usedContextKinds = requiredContextKinds;
      decisions.push({
        schema_version: 1,
        dataset_id: queueRow.dataset_id,
        dataset_version: queueRow.dataset_version,
        category_type: "location",
        decision_status: "completed",
        code,
        target_path: queueRow.path,
        basis: `The location queue contains one valid source-backed TIDAS location code candidate (${code}) for this target path.`,
        authoring_context: authoringContext,
        used_context_kinds: usedContextKinds,
        evidence: {
          source: "dataset-location-decisions-suggest",
          projection: "queue_suggested_location_code_to_decision",
          used_context_kinds: usedContextKinds,
          queue: {
            row_index: index,
            dataset_type: queueRow.dataset_type ?? null,
            dataset_id: queueRow.dataset_id ?? null,
            dataset_version: queueRow.dataset_version ?? null,
            target_path: queueRow.path ?? null,
            current_location: queueRow.current_location ?? null,
            source_file: queueRow.source_file ?? null,
            suggested_location_code: queueRow.suggested_location_code ?? null,
            evidence: queueRow.evidence ?? null,
          },
        },
      });
    }

    const decisionsPath = path.join(outDir, "location-decisions.jsonl");
    const manualReviewPath = path.join(outDir, "location-decisions.manual-review.jsonl");
    const reportPath = path.join(outDir, "dataset-location-decisions-suggest-report.json");
    writeJsonLines(decisionsPath, decisions);
    writeJsonLines(manualReviewPath, manualReview);
    const report = {
      schema_version: 1,
      generated_at_utc: nowIso(),
      status: manualReview.length > 0 ? "blocked" : "completed",
      command: "dataset-location-decisions-suggest",
      location_queue: repoRelativePath(queuePath),
      decision_task: repoRelativePath(decisionTaskPath),
      counts: {
        queue_rows: queueRows.length,
        suggested_decisions: decisions.length,
        manual_review: manualReview.length,
        blockers: manualReview.length,
      },
      policy: {
        automatic_scope:
          "Only queue rows with exactly one valid TIDAS location code candidate are converted to decisions. Conflicts or missing candidates remain blocked for human/AI review.",
        apply_boundary:
          "This command creates decision artifacts only; dataset-location-decisions-apply must perform the deterministic row update.",
      },
      blockers: manualReview.map((row) => ({
        code: row.reason,
        message: row.required_human_action,
        dataset_type: row.dataset_type,
        dataset_id: row.dataset_id,
        dataset_version: row.dataset_version,
        target_path: row.target_path,
        candidate_codes: row.candidate_codes,
        valid_candidate_codes: row.valid_candidate_codes,
      })),
      files: {
        report: repoRelativePath(reportPath),
        decisions: repoRelativePath(decisionsPath),
        manual_review: repoRelativePath(manualReviewPath),
      },
    };
    fs.mkdirSync(outDir, { recursive: true });
    writeJson(reportPath, report);
    return report;
  }

  function outputRowsForLocationGroup(
    rows: LooseRecord[],
    outDir: string,
    inputRows: string,
    options: LooseRecord,
  ): string {
    if (options.out && rows.length > 0) return resolveRepoPath(options.out)!;
    const outputRows = unique(rows.map(locationQueueOutputRows)).filter(Boolean);
    if (outputRows.length === 1) return resolveRepoPath(outputRows[0])!;
    const inputBase = path.basename(inputRows).replace(/\.(jsonl|json)$/iu, "");
    return path.join(outDir, "rows", `${inputBase}.located.jsonl`);
  }

  function runDatasetLocationDecisionsApply(options: LooseRecord) {
    if (options.help) {
      return {
        schema_version: 1,
        status: "help",
        command: "dataset-location-decisions-apply",
        wraps: "tiangong-lca dataset classification apply --type location",
        usage: [
          "node scripts/foundry.ts dataset-location-decisions-apply --location-queue <location-authoring-queue.jsonl> --decisions <location-decisions.jsonl> --decision-task <location-decision-task.json> --out-dir <apply-dir>",
        ],
        purpose:
          "Validate AI-authored location decisions against the Foundry queue and AI context task, then call the CLI location classification apply command for each required row file.",
      };
    }

    const queuePath = resolveRepoPath(options.locationQueue || options.queue);
    const decisionsPath = resolveRepoPath(
      options.decisions || options.decisionFile || options.input,
    );
    if (!queuePath || !fileExists(queuePath)) {
      throw new Error(
        "--location-queue is required and must point to location-authoring-queue.jsonl.",
      );
    }
    if (!decisionsPath || !fileExists(decisionsPath)) {
      throw new Error("--decisions is required and must point to JSON/JSONL location decisions.");
    }
    const outDir = resolveRepoPath(
      options.outDir || ".foundry/workspaces/location-decisions-apply",
    )!;
    const reportPath = path.join(outDir, "location-decisions-apply-report.json");
    const queueRows = readJsonOrJsonLines(queuePath);
    const decisions = readJsonOrJsonLines(decisionsPath);
    const decisionTaskProofs = readDecisionTaskProofs(options, "location", queuePath);
    const decisionTaskProof = decisionTaskProofs.length === 1 ? decisionTaskProofs[0] : null;
    const { blockers, decisionsByKey } = validateLocationDecisionsForQueue(queueRows, decisions, {
      decisionTaskProof: decisionTaskProofs,
    });
    const stages: RuntimeStage[] = [];
    const inputRows: string[] = [];
    const outputRows: string[] = [];

    if (blockers.length === 0 && queueRows.length > 0) {
      const queueRowsByInput = new Map<string, { inputRows: string; rows: LooseRecord[] }>();
      for (const row of queueRows) {
        const inputRows = resolveRepoPath(
          options.rowsFile || options.inputRows || locationQueueInputRows(row),
        );
        if (!inputRows || !fileExists(inputRows)) {
          blockers.push({
            code: "location_input_rows_missing",
            message: "Queued location workflow input rows file is missing.",
            dataset_id: row.dataset_id,
            input_rows: locationQueueInputRows(row),
          });
          continue;
        }
        const key = repoRelativePath(inputRows);
        const group = queueRowsByInput.get(key) ?? { inputRows, rows: [] };
        group.rows.push(row);
        queueRowsByInput.set(key, group);
      }

      for (const group of queueRowsByInput.values()) {
        inputRows.push(repoRelativePath(group.inputRows));
        const finalOutputRows = outputRowsForLocationGroup(
          group.rows,
          outDir,
          group.inputRows,
          options,
        );
        const groupDecisions = group.rows.map((row) =>
          decisionsByKey.get(locationQueueTargetKey(row)),
        );
        const decisionFile = path.join(outDir, "decisions", "location-decisions.jsonl");
        fs.mkdirSync(path.dirname(decisionFile), { recursive: true });
        fs.mkdirSync(path.dirname(finalOutputRows), { recursive: true });
        writeJsonLines(decisionFile, groupDecisions);
        const stage = runTiangongJsonStage("location_apply", [
          "dataset",
          "classification",
          "apply",
          "--input",
          group.inputRows,
          "--decisions",
          decisionFile,
          "--out",
          finalOutputRows,
          "--type",
          "location",
          "--out-dir",
          path.join(outDir, "classification", "location"),
          "--json",
        ]);
        stage.report_file = resolveRepoPath(stage.report?.files?.report);
        stages.push(stage);
        if (stage.exit_code !== 0) {
          blockers.push({
            code: "location_apply_stage_failed",
            message: "CLI location apply failed.",
            exit_code: stage.exit_code,
            report_file: repoRelativeMaybe(stage.report_file),
          });
          break;
        }
        outputRows.push(repoRelativePath(finalOutputRows));
      }
    }

    const report = {
      schema_version: 1,
      generated_at_utc: nowIso(),
      status: blockers.length > 0 ? "blocked" : "completed",
      command: "dataset-location-decisions-apply",
      location_queue: repoRelativePath(queuePath),
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
        input_rows: inputRows,
        output_rows: outputRows,
      },
    };
    fs.mkdirSync(outDir, { recursive: true });
    writeJson(reportPath, report);
    return report;
  }

  return {
    runDatasetLocationDecisionTaskBuild,
    runDatasetLocationDecisionsSuggest,
    runDatasetLocationDecisionsApply,
  };
}

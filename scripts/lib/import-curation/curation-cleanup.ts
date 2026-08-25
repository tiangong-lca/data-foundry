import path from "node:path";
import { datasetTypeFromOptions, datasetTypePlural } from "./internal/dataset-types.ts";
import { datasetIdentity } from "./internal/dataset-payload.ts";
import {
  annualSupplyMissingDataSentinelText,
  applyAnnualSupplyMissingDataSentinel,
  applyDeterministicSourceExchangeCompletenessProofs,
  buildSourceRowsByIdentity,
  ensureFoundryTraceNamespaces,
  externalizeImportTraceMetadata,
  normalizeDateTimeMetadata,
  sanitizeFoundryTraceEvidenceLocators,
} from "./internal/prewrite-cleanup.ts";
import {
  fileExists,
  jsonLines,
  nowIso,
  readRows,
  repoRelativePath,
  resolveRepoPath,
  writeJson,
  writeText,
} from "./internal/runtime-io.ts";

interface JsonRecord {
  [key: string]: unknown;
}

interface CurationCleanupOptions extends JsonRecord {
  help?: unknown;
  type?: unknown;
  datasetType?: unknown;
  kind?: unknown;
  rowsFile?: string | null;
  input?: string | null;
  outDir?: string | null;
  out?: string | null;
  outFile?: string | null;
  sourceRowsFile?: string | null;
  sourceRows?: string | null;
  originalSourceRowsFile?: string | null;
  originalRowsFile?: string | null;
}

interface CurationCleanupArgs {
  repoRoot?: string;
  options?: CurationCleanupOptions;
}

function dateTimeBlockersFromError(error: unknown): JsonRecord[] | null {
  if (!error || typeof error !== "object" || Array.isArray(error)) return null;
  const record = error as JsonRecord;
  if (record.name !== "InvalidDateTimeMetadataError" || !Array.isArray(record.blockers)) {
    return null;
  }
  return record.blockers.filter(
    (blocker): blocker is JsonRecord =>
      Boolean(blocker) && typeof blocker === "object" && !Array.isArray(blocker),
  );
}

export function runDatasetCurationCleanup({
  repoRoot,
  options = {},
}: CurationCleanupArgs = {}): JsonRecord {
  const datasetType = datasetTypeFromOptions(options);
  if (options.help) {
    return {
      schema_version: 2,
      status: "help",
      command: "dataset-curation-cleanup",
      usage: [
        "node scripts/foundry.ts dataset-curation-cleanup --type <process|flow|lifecyclemodel|support|contact|source> --rows-file <rows.jsonl> [--source-rows-file <source-rows.jsonl>] --out-dir <cleanup-dir>",
      ],
      purpose:
        "Run deterministic prewrite cleanup transforms: annual-supply sentinel completion, import trace externalization, Foundry trace namespace repair, local locator redaction, and timestamp normalization.",
      remote_write_mode: "read-only",
      blockers: [],
    };
  }
  const root = repoRoot!;
  const rowsFile = resolveRepoPath(root, options.rowsFile || options.input);
  const defaultOut = `.foundry/workspaces/${datasetType}-dataset-curation-cleanup`;
  const outDir = resolveRepoPath(root, options.outDir || defaultOut)!;
  const defaultOutFile = path.join(outDir, `${datasetTypePlural[datasetType]}.cleaned.jsonl`);
  const explicitOutFile = resolveRepoPath(root, options.out || options.outFile);
  const outFile = explicitOutFile || defaultOutFile;
  if (!rowsFile || !fileExists(rowsFile)) {
    throw new Error("--rows-file is required and must point to a JSON/JSONL dataset row file.");
  }
  const sourceRowsFile = resolveRepoPath(
    root,
    options.sourceRowsFile ||
      options.sourceRows ||
      options.originalSourceRowsFile ||
      options.originalRowsFile,
  );
  const sourceRows =
    datasetType === "process" && sourceRowsFile && fileExists(sourceRowsFile)
      ? readRows(sourceRowsFile)
      : [];
  const sourceRowsByKey = sourceRows.length > 0 ? buildSourceRowsByIdentity(sourceRows) : null;

  const rows = readRows(rowsFile);
  const cleanedRows = rows.map((row) => JSON.parse(JSON.stringify(row)));
  let normalizedDateTimeValues = 0;
  const invalidDateTimeBlockers: JsonRecord[] = [];
  cleanedRows.forEach((cleaned, rowIndex) => {
    try {
      normalizedDateTimeValues += normalizeDateTimeMetadata(cleaned);
    } catch (error) {
      const blockers = dateTimeBlockersFromError(error);
      if (!blockers) throw error;
      const identity = datasetIdentity(cleaned, rowIndex, datasetType);
      for (const blocker of blockers) {
        invalidDateTimeBlockers.push({
          code: blocker.code,
          dataset_type: datasetType,
          dataset_id: identity.id,
          version: identity.version,
          row_index: rowIndex,
          path: blocker.path,
          value: blocker.value,
          reason: blocker.reason,
          action:
            "Correct the source timestamp or provide a schema-valid exact datetime before cleanup.",
        });
      }
    }
  });

  if (invalidDateTimeBlockers.length > 0) {
    let staleDefaultOutputBlocker: JsonRecord | null = null;
    if (!explicitOutFile && outFile !== rowsFile && fileExists(outFile)) {
      staleDefaultOutputBlocker = {
        code: "stale_cleanup_artifact_not_invalidated",
        path: repoRelativePath(root, outFile),
        reason: "blocked_cleanup_preserves_existing_artifacts",
        action:
          "Preserve and inspect the stale cleaned artifact manually; use a new output path for the repaired rerun.",
      };
    }
    const blockers = staleDefaultOutputBlocker
      ? [...invalidDateTimeBlockers, staleDefaultOutputBlocker]
      : invalidDateTimeBlockers;
    const reportFileName = "dataset-curation-cleanup-report.json";
    const reportPath = path.join(outDir, reportFileName);
    const report: JsonRecord = {
      schema_version: 2,
      generated_at_utc: nowIso(),
      command: "dataset-curation-cleanup",
      status: "blocked_invalid_datetime_metadata",
      dataset_type: datasetType,
      remote_write_mode: "read-only",
      rows_file: repoRelativePath(root, rowsFile),
      cleaned_rows_file: null,
      counts: {
        rows: rows.length,
        blockers: blockers.length,
        removed_source_trace_blocks: 0,
        externalized_source_trace_summaries: 0,
        redacted_foundry_trace_evidence_locators: 0,
        added_foundry_trace_namespaces: 0,
        normalized_datetime_values: 0,
        annual_supply_missing_data_sentinels: 0,
        source_exchange_completeness_proofs: 0,
      },
      source_rows_file:
        sourceRowsFile && fileExists(sourceRowsFile)
          ? repoRelativePath(root, sourceRowsFile)
          : null,
      source_exchange_completeness_proofs: [],
      blockers,
      policy: {
        purpose:
          "Reject invalid TIDAS/ILCD datetime metadata before any cleanup transform or cleaned-row output.",
        preserves_payload_semantics: true,
        datetime_policy:
          "Datetime fields require full timezone-qualified syntax, exact Gregorian calendar validity, valid clock fields, and a previously accepted HH:MM offset before UTC normalization.",
      },
      files: {
        report: repoRelativePath(root, reportPath),
        cleaned_rows: null,
      },
    };
    writeJson(reportPath, report);
    return report;
  }

  let removedSourceTraceBlocks = 0;
  let externalizedSourceTraceSummaries = 0;
  let addedFoundryTraceNamespaces = 0;
  let redactedFoundryTraceEvidenceLocators = 0;
  let annualSupplyMissingDataSentinels = 0;
  let sourceExchangeCompletenessProofs = 0;
  const sourceExchangeProofRows: JsonRecord[] = [];
  cleanedRows.forEach((cleaned, rowIndex) => {
    if (applyAnnualSupplyMissingDataSentinel(cleaned, datasetType)) {
      annualSupplyMissingDataSentinels += 1;
    }
    if (
      applyDeterministicSourceExchangeCompletenessProofs(cleaned, datasetType, {
        rowIndex,
        sourceRowsByKey,
        sourceRowsFile: sourceRowsFile ? repoRelativePath(root, sourceRowsFile) : null,
        rowsFile: repoRelativePath(root, rowsFile),
        proofRows: sourceExchangeProofRows,
      })
    ) {
      sourceExchangeCompletenessProofs += 1;
    }
    const traceResult = externalizeImportTraceMetadata(cleaned);
    removedSourceTraceBlocks += traceResult.removed;
    externalizedSourceTraceSummaries += traceResult.summaries;
    redactedFoundryTraceEvidenceLocators += sanitizeFoundryTraceEvidenceLocators(cleaned);
    addedFoundryTraceNamespaces += ensureFoundryTraceNamespaces(cleaned);
  });
  writeText(outFile, jsonLines(cleanedRows));

  const report: JsonRecord = {
    schema_version: 2,
    generated_at_utc: nowIso(),
    command: "dataset-curation-cleanup",
    status: "completed",
    dataset_type: datasetType,
    remote_write_mode: "read-only",
    rows_file: repoRelativePath(root, rowsFile),
    cleaned_rows_file: repoRelativePath(root, outFile),
    counts: {
      rows: cleanedRows.length,
      blockers: 0,
      removed_source_trace_blocks: removedSourceTraceBlocks,
      externalized_source_trace_summaries: externalizedSourceTraceSummaries,
      redacted_foundry_trace_evidence_locators: redactedFoundryTraceEvidenceLocators,
      added_foundry_trace_namespaces: addedFoundryTraceNamespaces,
      normalized_datetime_values: normalizedDateTimeValues,
      annual_supply_missing_data_sentinels: annualSupplyMissingDataSentinels,
      source_exchange_completeness_proofs: sourceExchangeCompletenessProofs,
    },
    source_rows_file:
      sourceRowsFile && fileExists(sourceRowsFile) ? repoRelativePath(root, sourceRowsFile) : null,
    source_exchange_completeness_proofs: sourceExchangeProofRows,
    blockers: [],
    policy: {
      purpose:
        "Normalize write-time metadata and externalize import-only tidasimport:sourceTrace after curation context has been captured and before remote write.",
      preserves_payload_semantics: true,
      source_trace_policy:
        "Original trace remains in the AI authoring package; write payload keeps only a safe hash summary in common:other.",
      foundry_trace_namespace_policy:
        "Any common:other tiangongfoundry:* trace kept in write payload gets @xmlns:tiangongfoundry before Rust tidas validation.",
      foundry_trace_locator_policy:
        "Local machine paths from tiangongfoundry:* trace evidence are redacted from write payloads; authoring packages and patch evidence retain the full local context.",
      datetime_policy:
        "TIDAS/ILCD dateTime values with timezone offsets are normalized to UTC Z form when the UTC projection remains inside the accepted four-digit year grammar; valid year-boundary offsets retain their exact source bytes.",
      annual_supply_placeholder_policy: `annualSupplyOrProductionVolume is schema-required. If source evidence is missing or converted as a placeholder such as 'Not specified', Foundry writes '${annualSupplyMissingDataSentinelText}' so the row remains importable and later database-side curation can bulk-locate the intentionally non-physical sentinel.`,
      source_exchange_completeness_policy:
        "For process rows, if an explicit source rows file is supplied and the source process row is Output-only with the same non-flow-reference exchange signature as the final row, Foundry may write deterministic tiangongfoundry:sourceExchangeCompleteness proof. Otherwise source-only-output acceptance still requires AI source_trace_verified evidence or exchange repair.",
    },
  };
  const reportFileName = "dataset-curation-cleanup-report.json";
  const reportPath = path.join(outDir, reportFileName);
  report.files = {
    report: repoRelativePath(root, reportPath),
    cleaned_rows: repoRelativePath(root, outFile),
  };
  writeJson(reportPath, report);
  return {
    ...report,
  };
}

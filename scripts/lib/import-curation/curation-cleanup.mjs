import path from "node:path";
import { datasetTypeFromOptions, datasetTypePlural } from "./internal/dataset-types.ts";
import {
  annualSupplyMissingDataSentinelText,
  applyAnnualSupplyMissingDataSentinel,
  applyDeterministicSourceExchangeCompletenessProofs,
  buildSourceRowsByIdentity,
  ensureFoundryTraceNamespaces,
  externalizeImportTraceMetadata,
  normalizeDateTimeMetadata,
  sanitizeFoundryTraceEvidenceLocators,
} from "./internal/prewrite-cleanup.mjs";
import {
  fileExists,
  jsonLines,
  nowIso,
  readRows,
  repoRelativePath,
  resolveRepoPath,
  writeJson,
  writeText,
} from "./internal/runtime-io.mjs";

export function runDatasetCurationCleanup({ repoRoot, options = {} } = {}) {
  const datasetType = datasetTypeFromOptions(options);
  if (options.help) {
    return {
      schema_version: 2,
      status: "help",
      command: "dataset-curation-cleanup",
      usage: [
        "node scripts/foundry.mjs dataset-curation-cleanup --type <process|flow|lifecyclemodel|support|contact|source> --rows-file <rows.jsonl> [--source-rows-file <source-rows.jsonl>] --out-dir <cleanup-dir>",
      ],
      purpose:
        "Run deterministic prewrite cleanup transforms: annual-supply sentinel completion, import trace externalization, Foundry trace namespace repair, local locator redaction, and timestamp normalization.",
      remote_write_mode: "read-only",
      blockers: [],
    };
  }
  const rowsFile = resolveRepoPath(repoRoot, options.rowsFile || options.input);
  const defaultOut = `.foundry/workspaces/${datasetType}-dataset-curation-cleanup`;
  const outDir = resolveRepoPath(repoRoot, options.outDir || defaultOut);
  const defaultOutFile = path.join(outDir, `${datasetTypePlural[datasetType]}.cleaned.jsonl`);
  const outFile = resolveRepoPath(repoRoot, options.out || options.outFile) || defaultOutFile;
  if (!rowsFile || !fileExists(rowsFile)) {
    throw new Error("--rows-file is required and must point to a JSON/JSONL dataset row file.");
  }
  const sourceRowsFile = resolveRepoPath(
    repoRoot,
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
  let removedSourceTraceBlocks = 0;
  let externalizedSourceTraceSummaries = 0;
  let normalizedDateTimeValues = 0;
  let addedFoundryTraceNamespaces = 0;
  let redactedFoundryTraceEvidenceLocators = 0;
  let annualSupplyMissingDataSentinels = 0;
  let sourceExchangeCompletenessProofs = 0;
  const sourceExchangeProofRows = [];
  const cleanedRows = rows.map((row, rowIndex) => {
    const cleaned = JSON.parse(JSON.stringify(row));
    if (applyAnnualSupplyMissingDataSentinel(cleaned, datasetType, rowIndex)) {
      annualSupplyMissingDataSentinels += 1;
    }
    if (
      applyDeterministicSourceExchangeCompletenessProofs(cleaned, datasetType, {
        rowIndex,
        sourceRowsByKey,
        sourceRowsFile: sourceRowsFile ? repoRelativePath(repoRoot, sourceRowsFile) : null,
        rowsFile: repoRelativePath(repoRoot, rowsFile),
        proofRows: sourceExchangeProofRows,
      })
    ) {
      sourceExchangeCompletenessProofs += 1;
    }
    normalizedDateTimeValues += normalizeDateTimeMetadata(cleaned);
    const traceResult = externalizeImportTraceMetadata(cleaned);
    removedSourceTraceBlocks += traceResult.removed;
    externalizedSourceTraceSummaries += traceResult.summaries;
    redactedFoundryTraceEvidenceLocators += sanitizeFoundryTraceEvidenceLocators(cleaned);
    addedFoundryTraceNamespaces += ensureFoundryTraceNamespaces(cleaned);
    return cleaned;
  });
  writeText(outFile, jsonLines(cleanedRows));

  const report = {
    schema_version: 2,
    generated_at_utc: nowIso(),
    command: "dataset-curation-cleanup",
    status: "completed",
    dataset_type: datasetType,
    remote_write_mode: "read-only",
    rows_file: repoRelativePath(repoRoot, rowsFile),
    cleaned_rows_file: repoRelativePath(repoRoot, outFile),
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
      sourceRowsFile && fileExists(sourceRowsFile)
        ? repoRelativePath(repoRoot, sourceRowsFile)
        : null,
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
        "TIDAS/ILCD dateTime values with timezone offsets are normalized to UTC Z form.",
      annual_supply_placeholder_policy: `annualSupplyOrProductionVolume is schema-required. If source evidence is missing or converted as a placeholder such as 'Not specified', Foundry writes '${annualSupplyMissingDataSentinelText}' so the row remains importable and later database-side curation can bulk-locate the intentionally non-physical sentinel.`,
      source_exchange_completeness_policy:
        "For process rows, if an explicit source rows file is supplied and the source process row is Output-only with the same non-flow-reference exchange signature as the final row, Foundry may write deterministic tiangongfoundry:sourceExchangeCompleteness proof. Otherwise source-only-output acceptance still requires AI source_trace_verified evidence or exchange repair.",
    },
  };
  const reportFileName = "dataset-curation-cleanup-report.json";
  const reportPath = path.join(outDir, reportFileName);
  report.files = {
    report: repoRelativePath(repoRoot, reportPath),
    cleaned_rows: repoRelativePath(repoRoot, outFile),
  };
  writeJson(reportPath, report);
  return {
    ...report,
  };
}

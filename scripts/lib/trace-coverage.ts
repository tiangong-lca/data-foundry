type JsonRecord = Record<string, unknown>;

interface TraceIdentity {
  id: unknown;
  version: unknown;
}

interface TraceCoverageRow extends JsonRecord {
  dataset_type?: unknown;
  entity_id?: unknown;
  version?: unknown;
  row_index?: unknown;
  trace_kind?: unknown;
  path?: unknown;
  status?: unknown;
  action_item_code?: unknown;
  blocked_path?: unknown;
  trace_sha256?: unknown;
}

interface FoundryTraceSummary {
  unresolved_traces: TraceCoverageRow[];
  source_exchange_completeness: TraceCoverageRow[];
}

type TraceCoverageBlocker = JsonRecord;

function isJsonRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asTraceCoverageRow(value: unknown): TraceCoverageRow {
  return isJsonRecord(value) ? value : {};
}

export type TraceCoverageDependencies = {
  asText: (value: unknown) => string;
  datasetIdentity: (row: JsonRecord, datasetType: string) => TraceIdentity;
  fileExists: (filePath: string) => boolean;
  foundryTraceSummary: (options: {
    datasetType: string;
    identity: TraceIdentity;
    row: JsonRecord;
    rowIndex: number;
  }) => FoundryTraceSummary;
  readJsonLines: (filePath: string) => unknown[];
  readRowsFile: (filePath: string) => unknown[];
  repoRelativePath: (filePath: string) => string;
  resolveRepoPath: (filePath: string | null | undefined) => string | null;
};

export function createTraceCoverageUtils({
  asText,
  datasetIdentity,
  fileExists,
  foundryTraceSummary,
  readJsonLines,
  readRowsFile,
  repoRelativePath,
  resolveRepoPath,
}: TraceCoverageDependencies) {
  function closeoutTraceDatasetType(row: unknown, fallbackType: unknown): string {
    const fallback = asText(fallbackType).toLowerCase();
    if (fallback && fallback !== "support") return fallback;
    const record = isJsonRecord(row) ? row : {};
    if (record.contactDataSet) return "contact";
    if (record.sourceDataSet) return "source";
    if (record.flowDataSet) return "flow";
    if (record.processDataSet) return "process";
    if (record.lifeCycleModelDataSet) return "lifecyclemodel";
    if (record.unitGroupDataSet) return "unitgroup";
    if (record.flowPropertyDataSet) return "flowproperty";
    return fallback || "support";
  }

  function closeoutTraceIdentity(row: JsonRecord, datasetType: string, rowIndex: number) {
    const identity = datasetIdentity(row, datasetType);
    const record = row;
    return {
      id:
        identity.id ||
        asText(record.dataset_id ?? record.entity_id ?? record.id) ||
        `row-${rowIndex + 1}`,
      version: identity.version || asText(record.dataset_version ?? record.version) || "00.00.001",
    };
  }

  function traceQueueCoverageKey(traceValue: unknown): string {
    const trace = asTraceCoverageRow(traceValue);
    return JSON.stringify([
      asText(trace?.dataset_type).toLowerCase(),
      asText(trace?.entity_id),
      asText(trace?.version),
      Number(trace?.row_index ?? -1),
      asText(trace?.trace_kind),
      asText(trace?.path),
      asText(trace?.status),
      asText(trace?.action_item_code),
      asText(trace?.blocked_path),
      asText(trace?.trace_sha256),
    ]);
  }

  function expectedTraceRowsFromFinalRows({
    datasetType,
    finalRowsFile,
  }: {
    datasetType: string;
    finalRowsFile: string;
  }) {
    const rows = readRowsFile(finalRowsFile);
    const unresolved: TraceCoverageRow[] = [];
    const sourceExchangeCompleteness: TraceCoverageRow[] = [];
    rows.forEach((rowValue, rowIndex) => {
      const row = asTraceCoverageRow(rowValue);
      const effectiveType = closeoutTraceDatasetType(row, datasetType);
      const identity = closeoutTraceIdentity(row, effectiveType, rowIndex);
      const summary = foundryTraceSummary({
        datasetType: effectiveType,
        identity,
        row,
        rowIndex,
      });
      unresolved.push(...summary.unresolved_traces);
      sourceExchangeCompleteness.push(...summary.source_exchange_completeness);
    });
    return {
      unresolved_traces: unresolved,
      source_exchange_completeness_traces: sourceExchangeCompleteness,
    };
  }

  function validateOneTraceQueueCoverage({
    traceQueue,
    traceKind,
    expectedRows,
    queuePath,
    blockers,
  }: {
    traceQueue: string;
    traceKind: string;
    expectedRows: TraceCoverageRow[];
    queuePath: string | null | undefined;
    blockers: TraceCoverageBlocker[];
  }): void {
    const resolved = resolveRepoPath(queuePath);
    if (!resolved || !fileExists(resolved)) return;
    const actualRows = readJsonLines(resolved).map(asTraceCoverageRow);
    if (actualRows.length !== expectedRows.length) {
      blockers.push({
        code: "trace_queue_final_rows_count_mismatch",
        message: `${traceQueue} contains ${actualRows.length} rows but final rows contain ${expectedRows.length} ${traceKind} entries.`,
        trace_queue: traceQueue,
        file: repoRelativePath(resolved),
        expected_count: expectedRows.length,
        actual_count: actualRows.length,
      });
    }

    const actualKeys = new Map<string, number[]>();
    actualRows.forEach((row, index) => {
      const key = traceQueueCoverageKey(row);
      const entries = actualKeys.get(key) ?? [];
      entries.push(index);
      actualKeys.set(key, entries);
    });
    const expectedKeys = new Map<string, number[]>();
    expectedRows.forEach((row, index) => {
      const key = traceQueueCoverageKey(row);
      const entries = expectedKeys.get(key) ?? [];
      entries.push(index);
      expectedKeys.set(key, entries);
      if (!actualKeys.has(key)) {
        blockers.push({
          code: "trace_queue_final_rows_entry_missing",
          message: `${traceQueue} is missing a trace entry that exists in the final rows.`,
          trace_queue: traceQueue,
          file: repoRelativePath(resolved),
          row_index: row.row_index ?? null,
          entity_id: row.entity_id ?? null,
          version: row.version ?? null,
          path: row.path ?? null,
          trace_sha256: row.trace_sha256 ?? null,
        });
      }
    });
    actualRows.forEach((row, index) => {
      const key = traceQueueCoverageKey(row);
      if (!expectedKeys.has(key)) {
        blockers.push({
          code: "trace_queue_stale_or_extra_entry",
          message: `${traceQueue} contains a trace entry that is not present in the final rows.`,
          trace_queue: traceQueue,
          file: repoRelativePath(resolved),
          queue_row_index: index,
          row_index: row.row_index ?? null,
          entity_id: row.entity_id ?? null,
          version: row.version ?? null,
          path: row.path ?? null,
          trace_sha256: row.trace_sha256 ?? null,
        });
      }
    });
  }

  function validateTraceQueueCoverageForRows({
    datasetType,
    finalRowsFile,
    traceQueues,
    counts,
    blockers,
  }: {
    datasetType: string;
    finalRowsFile: string;
    traceQueues: {
      unresolved_traces?: string | null;
      source_exchange_completeness_traces?: string | null;
    };
    counts: {
      unresolved_trace_entries: number;
      source_exchange_completeness_entries: number;
    };
    blockers: TraceCoverageBlocker[];
  }): void {
    const expected = expectedTraceRowsFromFinalRows({
      datasetType,
      finalRowsFile,
    });
    if (expected.unresolved_traces.length !== counts.unresolved_trace_entries) {
      blockers.push({
        code: "trace_queue_manifest_count_not_final_rows",
        message: "Mutation/handoff unresolved trace count does not match the exact final rows.",
        trace_queue: "unresolved_traces",
        expected_count: expected.unresolved_traces.length,
        recorded_count: counts.unresolved_trace_entries,
        final_rows_file: repoRelativePath(finalRowsFile),
      });
    }
    if (
      expected.source_exchange_completeness_traces.length !==
      counts.source_exchange_completeness_entries
    ) {
      blockers.push({
        code: "trace_queue_manifest_count_not_final_rows",
        message:
          "Mutation/handoff source exchange completeness trace count does not match the exact final rows.",
        trace_queue: "source_exchange_completeness_traces",
        expected_count: expected.source_exchange_completeness_traces.length,
        recorded_count: counts.source_exchange_completeness_entries,
        final_rows_file: repoRelativePath(finalRowsFile),
      });
    }
    validateOneTraceQueueCoverage({
      traceQueue: "unresolved_traces",
      traceKind: "unresolvedTrace",
      expectedRows: expected.unresolved_traces,
      queuePath: traceQueues.unresolved_traces,
      blockers,
    });
    validateOneTraceQueueCoverage({
      traceQueue: "source_exchange_completeness_traces",
      traceKind: "sourceExchangeCompleteness",
      expectedRows: expected.source_exchange_completeness_traces,
      queuePath: traceQueues.source_exchange_completeness_traces,
      blockers,
    });
  }

  return { validateTraceQueueCoverageForRows };
}

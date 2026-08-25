export type TraceCoverageDependencies = {
  asText: (value: any) => string;
  datasetIdentity: (row: any, datasetType: string) => { id: any; version: any };
  fileExists: (filePath: any) => boolean;
  foundryTraceSummary: (options: any) => any;
  readJsonLines: (filePath: string) => any[];
  readRowsFile: (filePath: string) => any[];
  repoRelativePath: (filePath: string) => string;
  resolveRepoPath: (filePath: any) => string | null;
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
  function closeoutTraceDatasetType(row: any, fallbackType: any) {
    const fallback = asText(fallbackType).toLowerCase();
    if (fallback && fallback !== "support") return fallback;
    if (row?.contactDataSet) return "contact";
    if (row?.sourceDataSet) return "source";
    if (row?.flowDataSet) return "flow";
    if (row?.processDataSet) return "process";
    if (row?.lifeCycleModelDataSet) return "lifecyclemodel";
    if (row?.unitGroupDataSet) return "unitgroup";
    if (row?.flowPropertyDataSet) return "flowproperty";
    return fallback || "support";
  }

  function closeoutTraceIdentity(row: any, datasetType: string, rowIndex: number) {
    const identity = datasetIdentity(row, datasetType);
    return {
      id:
        identity.id ||
        asText(row?.dataset_id ?? row?.entity_id ?? row?.id) ||
        `row-${rowIndex + 1}`,
      version: identity.version || asText(row?.dataset_version ?? row?.version) || "00.00.001",
    };
  }

  function traceQueueCoverageKey(trace: any) {
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

  function expectedTraceRowsFromFinalRows({ datasetType, finalRowsFile }: any) {
    const rows = readRowsFile(finalRowsFile);
    const unresolved: any[] = [];
    const sourceExchangeCompleteness: any[] = [];
    rows.forEach((row: any, rowIndex: number) => {
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
  }: any) {
    const resolved = resolveRepoPath(queuePath);
    if (!resolved || !fileExists(resolved)) return;
    const actualRows = readJsonLines(resolved);
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
    actualRows.forEach((row: any, index: number) => {
      const key = traceQueueCoverageKey(row);
      const entries = actualKeys.get(key) ?? [];
      entries.push(index);
      actualKeys.set(key, entries);
    });
    const expectedKeys = new Map<string, number[]>();
    expectedRows.forEach((row: any, index: number) => {
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
    actualRows.forEach((row: any, index: number) => {
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
  }: any) {
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

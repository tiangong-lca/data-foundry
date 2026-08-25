import { sha256Text } from "./hash-utils.ts";
import { asText, ensureArray } from "./runtime-io.ts";

export type CollectedTraceEntry = {
  path: string;
  entry: unknown;
};

export type CompactFoundryTraceEntry = {
  dataset_type: string;
  entity_id: unknown;
  version: unknown;
  row_index: number;
  trace_kind: string;
  path: string | null;
  status: string | null;
  action_item_code: string | null;
  reference_id: string | null;
  reference_version: string | null;
  blocked_path: string | null;
  reason: string | null;
  next_action: string | null;
  evidence: unknown;
  trace_sha256: string;
};

export function traceSummaryCount(value: unknown): number {
  let count = 0;
  const visit = (node: unknown): void => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }
    const record = node as Record<string, unknown>;
    const other = record["common:other"];
    if (other && typeof other === "object" && !Array.isArray(other)) {
      count += ensureArray(
        (other as Record<string, unknown>)["tiangongfoundry:importTraceSummary"],
      ).length;
    }
    for (const child of Object.values(record)) visit(child);
  };
  visit(value);
  return count;
}

export function collectCommonOtherTraceEntries(
  value: unknown,
  traceKey: string,
  basePath = "$",
): CollectedTraceEntry[] {
  const entries: CollectedTraceEntry[] = [];
  const visit = (node: unknown, currentPath: string): void => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      node.forEach((item, index) => visit(item, `${currentPath}[${index}]`));
      return;
    }
    const record = node as Record<string, unknown>;
    const other = record["common:other"];
    if (other && typeof other === "object" && !Array.isArray(other)) {
      const traceValue = (other as Record<string, unknown>)[traceKey];
      if (traceValue !== undefined) {
        ensureArray(traceValue).forEach((entry, index) => {
          entries.push({
            path: `${currentPath}.common:other.${traceKey}${Array.isArray(traceValue) ? `[${index}]` : ""}`,
            entry,
          });
        });
      }
    }
    Object.entries(record).forEach(([key, child]) => {
      if (key === "common:other") return;
      visit(child, `${currentPath}.${key}`);
    });
  };
  visit(value, basePath);
  return entries;
}

// part-08.mjs
export function compactFoundryTraceEntry({
  datasetType,
  identity,
  rowIndex,
  traceKind,
  trace,
}: {
  datasetType: string;
  identity: { id: unknown; version: unknown };
  rowIndex: number;
  traceKind: string;
  trace: CollectedTraceEntry | { path?: string | null; entry?: unknown };
}): CompactFoundryTraceEntry {
  const entry: Record<string, unknown> =
    trace?.entry && typeof trace.entry === "object" && !Array.isArray(trace.entry)
      ? (trace.entry as Record<string, unknown>)
      : { value: trace?.entry ?? null };
  return {
    dataset_type: datasetType,
    entity_id: identity.id,
    version: identity.version,
    row_index: rowIndex,
    trace_kind: traceKind,
    path: trace?.path ?? null,
    status: asText(entry.status ?? entry.decision_status ?? entry.decisionStatus) || null,
    action_item_code: asText(entry.action_item_code ?? entry.actionItemCode ?? entry.code) || null,
    reference_id:
      asText(entry.reference_id ?? entry.referenceId ?? entry.ref_object_id ?? entry.refObjectId) ||
      null,
    reference_version:
      asText(
        entry.reference_version ?? entry.referenceVersion ?? entry.ref_version ?? entry.refVersion,
      ) || null,
    blocked_path:
      asText(
        entry.blocked_path ??
          entry.blockedPath ??
          entry.field_path ??
          entry.fieldPath ??
          entry.path,
      ) || null,
    reason: asText(entry.reason ?? entry.deferred_reason ?? entry.deferredReason) || null,
    next_action:
      asText(entry.next_action ?? entry.nextAction ?? entry.follow_up ?? entry.followUp) || null,
    evidence:
      entry.evidence ?? entry.source_evidence ?? entry.sourceEvidence ?? entry.trace ?? null,
    trace_sha256: sha256Text(JSON.stringify(entry)),
  };
}

export function foundryTraceSummary({
  datasetType,
  identity,
  row,
  rowIndex,
}: {
  datasetType: string;
  identity: { id: unknown; version: unknown };
  row: unknown;
  rowIndex: number;
}): {
  import_trace_summary_count: number;
  unresolved_trace_count: number;
  unresolved_exchange_trace_count: number;
  source_exchange_completeness_count: number;
  unresolved_traces: CompactFoundryTraceEntry[];
  unresolved_exchange_traces: CompactFoundryTraceEntry[];
  source_exchange_completeness: CompactFoundryTraceEntry[];
} {
  const unresolved = collectCommonOtherTraceEntries(row, "tiangongfoundry:unresolvedTrace").map(
    (trace) =>
      compactFoundryTraceEntry({
        datasetType,
        identity,
        rowIndex,
        traceKind: "unresolved_trace",
        trace,
      }),
  );
  const sourceExchangeCompleteness = collectCommonOtherTraceEntries(
    row,
    "tiangongfoundry:sourceExchangeCompleteness",
  ).map((trace) =>
    compactFoundryTraceEntry({
      datasetType,
      identity,
      rowIndex,
      traceKind: "source_exchange_completeness",
      trace,
    }),
  );
  const unresolvedExchange = collectCommonOtherTraceEntries(
    row,
    "tiangongfoundry:unresolvedExchangeTrace",
  ).map((trace) =>
    compactFoundryTraceEntry({
      datasetType,
      identity,
      rowIndex,
      traceKind: "unresolved_exchange_trace",
      trace,
    }),
  );
  return {
    import_trace_summary_count: traceSummaryCount(row),
    unresolved_trace_count: unresolved.length,
    unresolved_exchange_trace_count: unresolvedExchange.length,
    source_exchange_completeness_count: sourceExchangeCompleteness.length,
    unresolved_traces: unresolved,
    unresolved_exchange_traces: unresolvedExchange,
    source_exchange_completeness: sourceExchangeCompleteness,
  };
}

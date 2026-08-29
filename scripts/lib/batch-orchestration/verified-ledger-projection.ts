export interface JsonRecord {
  [key: string]: unknown;
}

export interface DatasetIdentity {
  readonly id?: string | null;
  readonly version?: string | null;
}

export interface VerifiedLedgerRuntimeAdapter {
  readonly nowIso: () => string;
  readonly asText: (value: unknown) => string;
  readonly datasetIdentity: (row: JsonRecord, datasetType: string) => DatasetIdentity;
  readonly readJsonLines: (filePath: string) => unknown[];
  readonly writeJsonLines: (filePath: string, rows: readonly unknown[]) => void;
  readonly appendJsonLine: (filePath: string, row: unknown) => void;
  readonly repoRelative: (filePath: string | null | undefined) => string;
  readonly pathJoin: (...parts: string[]) => string;
}

export interface FlowVerificationPartition {
  readonly pendingRows: JsonRecord[];
  readonly verifiedRows: JsonRecord[];
  readonly pendingIdentities: JsonRecord[];
  readonly verifiedIdentities: JsonRecord[];
}

export interface CarriedForwardFlowRows extends JsonRecord {
  readonly count: number;
  readonly rows: JsonRecord[];
  readonly ledger: string;
}

export interface BlockedScopeViewPaths {
  readonly okScopes: string;
  readonly blockedHumanReview: string;
  readonly blockedHumanReviewActive: string;
  readonly blockedHumanReviewResolved: string;
}

export interface BatchStatusOptions {
  readonly paused?: boolean;
  readonly stoppedAfterBlocked?: boolean;
}

export interface OkDatasetRowInput {
  readonly type: string;
  readonly id: unknown;
  readonly version: unknown;
  readonly processId: unknown;
  readonly report: string;
  readonly files: unknown;
}

export interface BlockRowInput {
  readonly scope: JsonRecord;
  readonly stage: string;
  readonly blocker: JsonRecord;
  readonly report?: string | null;
  readonly rerunCommand?: string;
}

export interface VerifiedLedgerProjectionService {
  readonly loadVerifiedSetFromFiles: (filePaths: readonly string[], type: string) => Set<string>;
  readonly loadVerifiedRowsByKeyFromFiles: (
    filePaths: readonly string[],
    type: string,
  ) => Map<string, JsonRecord>;
  readonly datasetIdentityKey: (identity: DatasetIdentity) => string | null;
  readonly flowRowsPendingVerification: (
    rows: JsonRecord[],
    verifiedFlows: Set<string>,
  ) => FlowVerificationPartition;
  readonly writeScopeCarriedForwardVerifiedFlowRows: (input: {
    ledgerDir: string;
    processId: string;
    verifiedIdentities: JsonRecord[];
    verifiedFlowRowsByKey: Map<string, JsonRecord>;
  }) => CarriedForwardFlowRows;
  readonly scopeKeyFromLedgerRow: (row: JsonRecord) => string | null;
  readonly writeBlockedScopeViews: (paths: BlockedScopeViewPaths) => JsonRecord;
  readonly loadActiveBlockedScopeSetFromFiles: (
    filePaths: readonly string[],
    verifiedScopes: Set<string>,
  ) => Set<string>;
  readonly batchRunStatus: (results: JsonRecord[], options?: BatchStatusOptions) => string;
  readonly okDatasetRow: (input: OkDatasetRowInput) => JsonRecord;
  readonly blockRow: (input: BlockRowInput) => JsonRecord;
}

const runtimeKeys = [
  "nowIso",
  "asText",
  "datasetIdentity",
  "readJsonLines",
  "writeJsonLines",
  "appendJsonLine",
  "repoRelative",
  "pathJoin",
] as const satisfies readonly (keyof VerifiedLedgerRuntimeAdapter)[];

function assertAdapter(adapter: VerifiedLedgerRuntimeAdapter): VerifiedLedgerRuntimeAdapter {
  const missing = runtimeKeys.filter((key) => typeof adapter?.[key] !== "function");
  if (missing.length > 0) {
    throw new Error(
      `createVerifiedLedgerProjectionService missing dependencies: ${missing.join(", ")}`,
    );
  }
  return Object.freeze({ ...adapter });
}

function ledgerRow(value: unknown): JsonRecord {
  return value as JsonRecord;
}

export function createVerifiedLedgerProjectionService(
  runtimeAdapter: VerifiedLedgerRuntimeAdapter,
): VerifiedLedgerProjectionService {
  const runtime = assertAdapter(runtimeAdapter);

  function identityKeyFromLedgerRow(row: JsonRecord, type: string): string | null {
    const id = row.dataset_id || row.id || row[`${type}_id`] || row.process_id;
    const version =
      row.dataset_version ||
      row.version ||
      row[`${type}_version`] ||
      row.process_version ||
      "00.00.001";
    return id ? `${id}@${version}` : null;
  }

  function loadVerifiedSetFromFiles(filePaths: readonly string[], type: string): Set<string> {
    const set = new Set<string>();
    for (const filePath of filePaths) {
      for (const value of runtime.readJsonLines(filePath)) {
        const key = identityKeyFromLedgerRow(ledgerRow(value), type);
        if (key) set.add(key);
      }
    }
    return set;
  }

  function loadVerifiedRowsByKeyFromFiles(
    filePaths: readonly string[],
    type: string,
  ): Map<string, JsonRecord> {
    const rowsByKey = new Map<string, JsonRecord>();
    for (const filePath of filePaths) {
      for (const value of runtime.readJsonLines(filePath)) {
        const row = ledgerRow(value);
        const key = identityKeyFromLedgerRow(row, type);
        if (!key || rowsByKey.has(key)) continue;
        rowsByKey.set(key, {
          ...row,
          source_ledger_file: runtime.repoRelative(filePath),
        });
      }
    }
    return rowsByKey;
  }

  function datasetIdentityKey(identity: DatasetIdentity): string | null {
    const id = runtime.asText(identity?.id);
    if (!id) return null;
    return `${id}@${runtime.asText(identity?.version) || "00.00.001"}`;
  }

  function flowRowsPendingVerification(
    rows: JsonRecord[],
    verifiedFlows: Set<string>,
  ): FlowVerificationPartition {
    const pendingRows: JsonRecord[] = [];
    const verifiedRows: JsonRecord[] = [];
    const pendingIdentities: JsonRecord[] = [];
    const verifiedIdentities: JsonRecord[] = [];
    for (const row of rows) {
      const identity = runtime.datasetIdentity(row, "flow");
      const key = datasetIdentityKey(identity);
      if (!key) continue;
      const entry = {
        id: identity.id,
        version: runtime.asText(identity.version) || "00.00.001",
        identity_key: key,
      };
      if (verifiedFlows.has(key)) {
        verifiedRows.push(row);
        verifiedIdentities.push(entry);
        continue;
      }
      pendingRows.push(row);
      pendingIdentities.push(entry);
    }
    return {
      pendingRows,
      verifiedRows,
      pendingIdentities,
      verifiedIdentities,
    };
  }

  function writeScopeCarriedForwardVerifiedFlowRows({
    ledgerDir,
    processId,
    verifiedIdentities,
    verifiedFlowRowsByKey,
  }: {
    ledgerDir: string;
    processId: string;
    verifiedIdentities: JsonRecord[];
    verifiedFlowRowsByKey: Map<string, JsonRecord>;
  }): CarriedForwardFlowRows {
    const ledgerPath = runtime.pathJoin(ledgerDir, "ok.flows.verified.jsonl");
    const existing = loadVerifiedSetFromFiles([ledgerPath], "flow");
    const written: JsonRecord[] = [];
    for (const identity of verifiedIdentities) {
      const normalizedIdentity: DatasetIdentity = {
        id: runtime.asText(identity.id) || null,
        version: runtime.asText(identity.version) || "00.00.001",
      };
      const key = runtime.asText(identity.identity_key) || datasetIdentityKey(normalizedIdentity);
      if (!key || existing.has(key)) continue;
      const sourceRow = verifiedFlowRowsByKey.get(key);
      if (!sourceRow) continue;
      const carried: JsonRecord = {
        ...sourceRow,
        schema_version: 1,
        status: "verified",
        carried_forward: true,
        carried_forward_at_utc: runtime.nowIso(),
        carried_forward_for_process_id: processId,
      };
      runtime.appendJsonLine(ledgerPath, carried);
      existing.add(key);
      written.push({
        id: normalizedIdentity.id || carried.dataset_id || carried.flow_id,
        version:
          normalizedIdentity.version ||
          carried.dataset_version ||
          carried.flow_version ||
          "00.00.001",
        identity_key: key,
        source_ledger_file: carried.source_ledger_file ?? null,
      });
    }
    return {
      count: written.length,
      rows: written,
      ledger: ledgerPath,
    };
  }

  function scopeKeyFromLedgerRow(row: JsonRecord): string | null {
    const id = row?.process_id || row?.dataset_id || row?.id;
    const version = row?.process_version || row?.dataset_version || row?.version || "00.00.001";
    return id ? `${id}@${version}` : null;
  }

  function writeBlockedScopeViews(paths: BlockedScopeViewPaths): JsonRecord {
    const verified = new Map<string, JsonRecord>();
    for (const value of runtime.readJsonLines(paths.okScopes)) {
      const row = ledgerRow(value);
      const key = scopeKeyFromLedgerRow(row);
      if (key) verified.set(key, row);
    }
    const historical = runtime.readJsonLines(paths.blockedHumanReview).map(ledgerRow);
    const active: JsonRecord[] = [];
    const resolved: JsonRecord[] = [];
    for (const row of historical) {
      const key = scopeKeyFromLedgerRow(row);
      const ok = key ? verified.get(key) : null;
      if (!ok) {
        active.push(row);
        continue;
      }
      resolved.push({
        ...row,
        resolution_status: "resolved_by_verified_scope",
        resolved_at_utc: ok.generated_at_utc ?? null,
        resolved_report: ok.report ?? null,
      });
    }
    runtime.writeJsonLines(paths.blockedHumanReviewActive, active);
    runtime.writeJsonLines(paths.blockedHumanReviewResolved, resolved);
    return {
      historical: historical.length,
      active: active.length,
      resolved: resolved.length,
    };
  }
  function loadActiveBlockedScopeSetFromFiles(
    filePaths: readonly string[],
    verifiedScopes: Set<string>,
  ): Set<string> {
    const set = new Set<string>();
    for (const filePath of filePaths) {
      for (const value of runtime.readJsonLines(filePath)) {
        const key = scopeKeyFromLedgerRow(ledgerRow(value));
        if (key && !verifiedScopes.has(key)) set.add(key);
      }
    }
    return set;
  }
  function batchRunStatus(
    results: JsonRecord[],
    { paused = false, stoppedAfterBlocked = false }: BatchStatusOptions = {},
  ): string {
    const failed = results.some((row) => row.status === "failed");
    const ambiguous = results.some((row) => row.status === "ambiguous");
    const blocked = results.some((row) => row.status === "blocked");
    if (stoppedAfterBlocked) {
      if (failed) return "stopped_after_blocked_with_retryable_failures";
      return "stopped_after_blocked";
    }
    if (paused) {
      if (ambiguous) return "paused_with_ambiguous_mutations";
      if (failed) return "paused_with_retryable_failures";
      if (blocked) return "paused_with_deferred_scopes";
      return "paused";
    }
    if (ambiguous) return "completed_with_ambiguous_mutations";
    if (failed) return "completed_with_retryable_failures";
    if (blocked) return "completed_with_deferred_scopes";
    return "completed";
  }
  function okDatasetRow({
    type,
    id,
    version,
    processId,
    report,
    files,
  }: OkDatasetRowInput): JsonRecord {
    return {
      schema_version: 1,
      generated_at_utc: runtime.nowIso(),
      dataset_type: type,
      dataset_id: id,
      dataset_version: version || "00.00.001",
      process_id: processId,
      status: "verified",
      report: runtime.repoRelative(report),
      files,
    };
  }

  function blockRow({ scope, stage, blocker, report, rerunCommand }: BlockRowInput): JsonRecord {
    return {
      schema_version: 1,
      generated_at_utc: runtime.nowIso(),
      process_id: scope.process_id || scope.id,
      process_version: scope.process_version || scope.version || "00.00.001",
      stage,
      code: blocker?.code || "blocked",
      message: blocker?.message || "Scope is blocked.",
      blocker,
      report: runtime.repoRelative(report),
      required_human_action:
        blocker?.required_human_action ||
        "Review the stage report, complete missing semantic decisions or references, then rerun this scope.",
      rerun_command: rerunCommand,
    };
  }

  return Object.freeze({
    loadVerifiedSetFromFiles,
    loadVerifiedRowsByKeyFromFiles,
    datasetIdentityKey,
    flowRowsPendingVerification,
    writeScopeCarriedForwardVerifiedFlowRows,
    scopeKeyFromLedgerRow,
    writeBlockedScopeViews,
    loadActiveBlockedScopeSetFromFiles,
    batchRunStatus,
    okDatasetRow,
    blockRow,
  });
}

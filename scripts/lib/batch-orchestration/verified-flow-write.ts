type JsonRecord = Record<string, unknown>;

export interface VerifiedFlowWriteInput {
  rows: JsonRecord[];
  processId: string;
  report: string;
  closeoutReportPath: string | null | undefined;
  ledgerPath: string;
  verifiedFlows: Set<string>;
  verifiedRowsByKey: Map<string, JsonRecord>;
}

export interface VerifiedFlowWriteAdapter {
  asText: (value: unknown) => string;
  datasetIdentity: (row: JsonRecord, type: string) => { id: string | null; version: string };
  datasetIdentityKey: (identity: { id: string | null; version: string }) => string | null;
  payloadSha256: (row: JsonRecord) => string;
  repoRelative: (filePath: string | null | undefined) => string;
  invalidateIdentityPreflightResultCacheEntry: (identityKey: string) => void;
  okDatasetRow: (input: {
    type: string;
    id: string | null;
    version: string;
    processId: string;
    report: string;
    files: JsonRecord;
  }) => JsonRecord;
  appendJsonLine: (filePath: string, row: JsonRecord) => void;
}

export function createVerifiedFlowWriteService(adapter: VerifiedFlowWriteAdapter) {
  function record(input: VerifiedFlowWriteInput): void {
    for (const row of input.rows) {
      const identity = adapter.datasetIdentity(row, "flow");
      if (!identity.id) continue;
      const key = adapter.datasetIdentityKey(identity);
      if (!key) continue;
      const payloadSha256 = adapter.payloadSha256(row);
      const alreadyVerified =
        adapter.asText(input.verifiedRowsByKey.get(key)?.payload_sha256) === payloadSha256;
      input.verifiedFlows.add(key);
      adapter.invalidateIdentityPreflightResultCacheEntry(
        `flow:${identity.id}@${identity.version || "00.00.001"}`,
      );
      const okRow = {
        ...adapter.okDatasetRow({
          type: "flow",
          id: identity.id,
          version: identity.version,
          processId: input.processId,
          report: input.report,
          files: {
            finalize_report: adapter.repoRelative(input.report),
            closeout_report: adapter.repoRelative(input.closeoutReportPath),
          },
        }),
        payload_sha256: payloadSha256,
      };
      input.verifiedRowsByKey.set(key, {
        ...okRow,
        source_ledger_file: adapter.repoRelative(input.ledgerPath),
      });
      if (!alreadyVerified) adapter.appendJsonLine(input.ledgerPath, okRow);
    }
  }
  return Object.freeze({ record });
}

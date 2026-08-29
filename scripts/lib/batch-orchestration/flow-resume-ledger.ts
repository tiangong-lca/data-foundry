import { sha256BatchJson, type BatchJsonValue } from "@tiangong-lca/cli/batch";

type JsonRecord = Record<string, unknown>;

export interface FlowResumeLedgerAdapter {
  asText: (value: unknown) => string;
  datasetIdentity: (
    row: JsonRecord,
    datasetType: string,
  ) => {
    id?: string | null;
    version?: string | null;
  };
  readJsonLines: (filePath: string) => JsonRecord[];
  repoRelative: (filePath: string) => string;
}

export interface FlowResumePartition {
  pendingRows: JsonRecord[];
  verifiedRows: JsonRecord[];
  pendingIdentities: JsonRecord[];
  verifiedIdentities: JsonRecord[];
  invalidatedIdentities: JsonRecord[];
}

function ledgerKey(row: JsonRecord): string | null {
  const id = row.dataset_id ?? row.flow_id ?? row.id;
  const version = row.dataset_version ?? row.flow_version ?? row.version ?? "00.00.001";
  return id ? `${id}@${version}` : null;
}

function batchJson(value: unknown): BatchJsonValue {
  return JSON.parse(JSON.stringify(value)) as BatchJsonValue;
}

export function createFlowResumeLedgerService(adapter: FlowResumeLedgerAdapter) {
  function payloadSha256(row: JsonRecord): string {
    return sha256BatchJson(batchJson(row));
  }

  function loadRowsByKey(filePaths: readonly string[]): Map<string, JsonRecord> {
    const rows = new Map<string, JsonRecord>();
    for (const filePath of filePaths) {
      for (const row of adapter.readJsonLines(filePath)) {
        const key = ledgerKey(row);
        if (key) rows.set(key, { ...row, source_ledger_file: adapter.repoRelative(filePath) });
      }
    }
    return rows;
  }

  function partitionRows(
    rows: JsonRecord[],
    verifiedFlows: Set<string>,
    verifiedRowsByKey: ReadonlyMap<string, JsonRecord>,
  ): FlowResumePartition {
    const result: FlowResumePartition = {
      pendingRows: [],
      verifiedRows: [],
      pendingIdentities: [],
      verifiedIdentities: [],
      invalidatedIdentities: [],
    };
    for (const row of rows) {
      const identity = adapter.datasetIdentity(row, "flow");
      const id = adapter.asText(identity.id);
      if (!id) continue;
      const version = adapter.asText(identity.version) || "00.00.001";
      const key = `${id}@${version}`;
      const currentSha = payloadSha256(row);
      const prior = verifiedRowsByKey.get(key);
      const priorSha = adapter.asText(prior?.payload_sha256);
      const entry = { id, version, identity_key: key, payload_sha256: currentSha };
      if (verifiedFlows.has(key) && priorSha === currentSha) {
        result.verifiedRows.push(row);
        result.verifiedIdentities.push(entry);
        continue;
      }
      result.pendingRows.push(row);
      result.pendingIdentities.push(entry);
      if (verifiedFlows.has(key)) {
        result.invalidatedIdentities.push({
          ...entry,
          prior_payload_sha256: priorSha || null,
          reason: priorSha ? "flow_payload_drift" : "legacy_flow_payload_digest_missing",
        });
      }
    }
    return result;
  }

  return Object.freeze({ payloadSha256, loadRowsByKey, partitionRows });
}

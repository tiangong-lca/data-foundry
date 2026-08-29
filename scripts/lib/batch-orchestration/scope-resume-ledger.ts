import { scopeResumeMismatchReason, type ScopeResumeContract } from "./scope-resume-contract.ts";

type JsonRecord = Record<string, unknown>;

export interface ScopeResumeLedgerAdapter {
  nowIso: () => string;
  readJsonLines: (filePath: string) => unknown[];
  repoRelative: (filePath: string) => string;
}

export interface MatchingVerifiedScopes {
  verifiedScopes: Set<string>;
  invalidatedRows: JsonRecord[];
}

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : {};
}

function scopeKey(row: JsonRecord): string | null {
  const id = row.process_id ?? row.dataset_id ?? row.id;
  const version = row.process_version ?? row.dataset_version ?? row.version ?? "00.00.001";
  return id ? `${id}@${version}` : null;
}

export function loadMatchingVerifiedScopes(
  filePaths: readonly string[],
  contracts: ReadonlyMap<string, ScopeResumeContract>,
  adapter: ScopeResumeLedgerAdapter,
): MatchingVerifiedScopes {
  const latest = new Map<string, JsonRecord>();
  for (const filePath of filePaths) {
    for (const value of adapter.readJsonLines(filePath)) {
      const row = record(value);
      const key = scopeKey(row);
      if (key) latest.set(key, { ...row, source_ledger_file: adapter.repoRelative(filePath) });
    }
  }
  const verifiedScopes = new Set<string>();
  const invalidatedRows: JsonRecord[] = [];
  for (const [key, contract] of contracts) {
    const row = latest.get(key);
    if (!row) continue;
    const reason = scopeResumeMismatchReason(row.resume_contract, contract);
    if (!reason) {
      verifiedScopes.add(key);
      continue;
    }
    invalidatedRows.push({
      schema_version: 1,
      generated_at_utc: adapter.nowIso(),
      status: "invalidated",
      scope_key: key,
      reason,
      expected_resume_contract: contract,
      observed_resume_contract: row.resume_contract ?? null,
      source_ledger_file: row.source_ledger_file,
    });
  }
  return { verifiedScopes, invalidatedRows };
}

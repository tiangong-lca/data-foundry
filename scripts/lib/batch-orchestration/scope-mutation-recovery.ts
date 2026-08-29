import { scopeResumeMismatchReason, type ScopeResumeContract } from "./scope-resume-contract.ts";

type JsonRecord = Record<string, unknown>;

export interface ScopeMutationRecoveryPaths {
  okScopes: string;
  okProcesses: string;
  scopeCheckpoints: string;
  resumeContractsByScopeKey: ReadonlyMap<string, ScopeResumeContract>;
}

export interface ScopeMutationRecoveryAdapter {
  nowIso: () => string;
  asText: (value: unknown) => string;
  readJson: (filePath: string) => JsonRecord;
  readJsonLines: (filePath: string) => JsonRecord[];
  fileExists: (filePath: string | null) => boolean;
  resolveRepoPath: (value: unknown) => string | null;
  repoRelative: (filePath: string | null) => string;
  appendJsonLine: (filePath: string, row: JsonRecord) => void;
}

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : {};
}

function identity(row: JsonRecord): string | null {
  const id = row.process_id ?? row.dataset_id ?? row.id;
  const version = row.process_version ?? row.dataset_version ?? row.version ?? "00.00.001";
  return id ? `${id}@${version}` : null;
}

export function createScopeMutationRecoveryService({
  paths,
  adapter,
}: {
  paths: ScopeMutationRecoveryPaths;
  adapter: ScopeMutationRecoveryAdapter;
}) {
  function recover(scope: JsonRecord, source: string): JsonRecord | null {
    const processId = adapter.asText(scope.process_id ?? scope.id);
    const processVersion = adapter.asText(scope.process_version ?? scope.version) || "00.00.001";
    const key = `${processId}@${processVersion}`;
    const expected = paths.resumeContractsByScopeKey.get(key);
    if (!expected) return null;
    const exactScope = adapter
      .readJsonLines(paths.okScopes)
      .findLast(
        (row) =>
          identity(row) === key &&
          scopeResumeMismatchReason(row.resume_contract, expected) === null,
      );
    if (exactScope) {
      return {
        status: "verified",
        recovery: { source, disposition: "exact_verified_scope_ledger" },
        stages: [],
      };
    }
    const processRow = adapter
      .readJsonLines(paths.okProcesses)
      .findLast(
        (row) =>
          identity(row) === key &&
          scopeResumeMismatchReason(row.resume_contract, expected) === null,
      );
    if (!processRow) return null;
    const files = record(processRow.files);
    const closeoutPath = adapter.resolveRepoPath(
      files.process_closeout_report ?? files.closeout_report,
    );
    if (!adapter.fileExists(closeoutPath)) return null;
    const closeout = adapter.readJson(closeoutPath!);
    if (closeout.status !== "completed") return null;
    const now = adapter.nowIso();
    adapter.appendJsonLine(paths.okScopes, {
      schema_version: 1,
      generated_at_utc: now,
      process_id: processId,
      process_version: processVersion,
      status: "verified",
      report: processRow.report ?? null,
      rows: { flows: null, processes: 1 },
      resume_contract: expected,
      recovery: {
        source,
        disposition: "verified_process_closeout_readback",
        closeout_report: adapter.repoRelative(closeoutPath),
      },
    });
    adapter.appendJsonLine(paths.scopeCheckpoints, {
      schema_version: 1,
      generated_at_utc: now,
      process_id: processId,
      process_version: processVersion,
      state: "verified_recovered_readback",
      resume_contract: expected,
      closeout_report: adapter.repoRelative(closeoutPath),
    });
    return {
      status: "verified",
      recovery: { source, disposition: "verified_process_closeout_readback" },
      stages: [
        {
          stage: "scope.readback_recovery",
          status: "completed",
          report: adapter.repoRelative(closeoutPath),
        },
      ],
    };
  }

  return Object.freeze({ recover });
}

import { curationEntityId, datasetIdentity, identityKey } from "./dataset-payload.ts";
import { asText, ensureArray, resolveRepoPath } from "./runtime-io.ts";
import { readJsonLines, readRowsIfExists } from "./workflow-patch-collect.ts";

interface JsonRecord {
  [key: string]: unknown;
}

interface DryRunFiles extends JsonRecord {
  success_list?: unknown;
  remote_failed?: unknown;
  progress_jsonl?: unknown;
  failures_jsonl?: unknown;
}

interface DryRunReport extends JsonRecord {
  rows?: unknown;
  entities?: unknown;
  processes?: unknown;
  blockers?: unknown;
  files?: unknown;
}

export interface FlowDryRunArtifactMaps {
  success: Map<string, JsonRecord>;
  failures: Map<string, JsonRecord>;
}

export interface ProgressDryRunArtifactMaps {
  prepared: Map<string, JsonRecord>;
  failures: Map<string, JsonRecord>;
}

interface RemoteVerifyBlockerOptions {
  plannedRootKeys?: Set<string>;
  plannedRootIds?: Set<string>;
}

function referenceKey({ table, id, version }: JsonRecord): string {
  return [asText(table), asText(id), asText(version)].join("\u0000");
}

export function mapSchemaRows(schemaReport: unknown): Map<string, JsonRecord> {
  const report = schemaReport as DryRunReport | null | undefined;
  const map = new Map<string, JsonRecord>();
  for (const row of ensureArray(report?.rows)) {
    const record = row as JsonRecord | null | undefined;
    const id = asText(record?.id ?? record?.dataset_id);
    const version = asText(record?.version) || "00.00.001";
    if (!id) continue;
    map.set(`${id}@@${version}`, record!);
    if (!map.has(id)) map.set(id, record!);
  }
  return map;
}

export function mapCurationEntities(curationGateReport: unknown): Map<string, JsonRecord> {
  const report = curationGateReport as DryRunReport | null | undefined;
  const map = new Map<string, JsonRecord>();
  for (const entity of ensureArray(report?.entities ?? report?.processes)) {
    const record = entity as JsonRecord | null | undefined;
    const id = curationEntityId(entity);
    const version = asText(record?.version) || "00.00.001";
    if (!id) continue;
    map.set(`${id}@@${version}`, record!);
    if (!map.has(id)) map.set(id, record!);
  }
  return map;
}

export function normalizeDryRunOperation(operation: unknown): unknown {
  switch (operation) {
    case "would_update_existing":
      return "update_existing";
    case "would_insert":
      return "insert";
    case "would_skip":
      return "skip";
    default:
      return operation || null;
  }
}

export function readFlowDryRunArtifacts(
  repoRoot: string,
  dryRunReport: unknown,
): FlowDryRunArtifactMaps {
  const report = dryRunReport as DryRunReport | null | undefined;
  const files = report?.files as DryRunFiles | null | undefined;
  const successFile = resolveRepoPath(repoRoot, files?.success_list as string | null | undefined);
  const failureFile = resolveRepoPath(repoRoot, files?.remote_failed as string | null | undefined);
  const success = new Map<string, JsonRecord>();
  const failures = new Map<string, JsonRecord>();
  for (const row of readRowsIfExists(successFile)) {
    const record = row as JsonRecord | null | undefined;
    const id = asText(record?.id);
    const version = asText(record?.version) || "00.00.001";
    if (id) success.set(`${id}@@${version}`, record!);
  }
  for (const row of readJsonLines(failureFile)) {
    const record = row as JsonRecord | null | undefined;
    const payload =
      record?.json_ordered ?? record?.jsonOrdered ?? record?.json ?? record?.payload ?? row;
    const identity = datasetIdentity(payload, 0, "flow");
    failures.set(identityKey(identity), record!);
  }
  return { success, failures };
}

export function readProcessDryRunArtifacts(
  repoRoot: string,
  dryRunReport: unknown,
): ProgressDryRunArtifactMaps {
  const report = dryRunReport as DryRunReport | null | undefined;
  const files = report?.files as DryRunFiles | null | undefined;
  const progressFile = resolveRepoPath(
    repoRoot,
    files?.progress_jsonl as string | null | undefined,
  );
  const failuresFile = resolveRepoPath(
    repoRoot,
    files?.failures_jsonl as string | null | undefined,
  );
  const prepared = new Map<string, JsonRecord>();
  const failures = new Map<string, JsonRecord>();
  for (const row of readJsonLines(progressFile)) {
    const record = row as JsonRecord | null | undefined;
    const id = asText(record?.id);
    const version = asText(record?.version) || "00.00.001";
    if (!id) continue;
    if (record?.status === "prepared") {
      prepared.set(`${id}@@${version}`, record);
    } else {
      failures.set(`${id}@@${version}`, record!);
    }
  }
  for (const row of readJsonLines(failuresFile)) {
    const record = row as JsonRecord | null | undefined;
    const id = asText(record?.id);
    const version = asText(record?.version) || "00.00.001";
    if (id) failures.set(`${id}@@${version}`, record!);
  }
  return { prepared, failures };
}

export function readLifecyclemodelDryRunArtifacts(
  repoRoot: string,
  dryRunReport: unknown,
): ProgressDryRunArtifactMaps {
  const report = dryRunReport as DryRunReport | null | undefined;
  const files = report?.files as DryRunFiles | null | undefined;
  const progressFile = resolveRepoPath(
    repoRoot,
    files?.progress_jsonl as string | null | undefined,
  );
  const failuresFile = resolveRepoPath(
    repoRoot,
    files?.failures_jsonl as string | null | undefined,
  );
  const prepared = new Map<string, JsonRecord>();
  const failures = new Map<string, JsonRecord>();
  for (const row of readJsonLines(progressFile)) {
    const record = row as JsonRecord | null | undefined;
    const id = asText(record?.id);
    const version = asText(record?.version) || "00.00.001";
    if (!id) continue;
    if (record?.status === "prepared") {
      prepared.set(`${id}@@${version}`, record);
    } else {
      failures.set(`${id}@@${version}`, record!);
    }
  }
  for (const row of readJsonLines(failuresFile)) {
    const record = row as JsonRecord | null | undefined;
    const id = asText(record?.id);
    const version = asText(record?.version) || "00.00.001";
    if (id) failures.set(`${id}@@${version}`, record!);
  }
  return { prepared, failures };
}

export function readDatasetSaveDraftDryRunArtifacts(
  repoRoot: string,
  dryRunReport: unknown,
): ProgressDryRunArtifactMaps {
  const report = dryRunReport as DryRunReport | null | undefined;
  const files = report?.files as DryRunFiles | null | undefined;
  const progressFile = resolveRepoPath(
    repoRoot,
    files?.progress_jsonl as string | null | undefined,
  );
  const failuresFile = resolveRepoPath(
    repoRoot,
    files?.failures_jsonl as string | null | undefined,
  );
  const prepared = new Map<string, JsonRecord>();
  const failures = new Map<string, JsonRecord>();
  for (const row of readJsonLines(progressFile)) {
    const record = row as JsonRecord | null | undefined;
    const id = asText(record?.id);
    const version = asText(record?.version) || "00.00.001";
    if (!id) continue;
    if (record?.status === "prepared") {
      prepared.set(`${id}@@${version}`, record);
    } else {
      failures.set(`${id}@@${version}`, record!);
    }
  }
  for (const row of readJsonLines(failuresFile)) {
    const record = row as JsonRecord | null | undefined;
    const id = asText(record?.id);
    const version = asText(record?.version) || "00.00.001";
    if (id) failures.set(`${id}@@${version}`, record!);
  }
  return { prepared, failures };
}

export function remoteVerifyBlockerKeys(
  remoteVerifyReport: unknown,
  options: RemoteVerifyBlockerOptions = {},
): Set<string> {
  const report = remoteVerifyReport as DryRunReport | null | undefined;
  const plannedRootKeys = options.plannedRootKeys ?? new Set();
  const plannedRootIds = options.plannedRootIds ?? new Set();
  const keys = new Set<string>();
  for (const blocker of ensureArray(report?.blockers)) {
    const record = blocker as JsonRecord | null | undefined;
    const role = asText(record?.role);
    const table = asText(record?.table);
    const version = asText(
      record?.version ??
        record?.dataset_version ??
        record?.reference_version ??
        record?.ref_version,
    );
    for (const key of [
      record?.root_id,
      record?.dataset_id,
      record?.id,
      record?.refObjectId,
      record?.ref_object_id,
      record?.reference_id,
    ]) {
      const value = asText(key);
      if (
        role === "reference" &&
        value &&
        ((table && plannedRootKeys.has(referenceKey({ table, id: value, version }))) ||
          plannedRootIds.has(value))
      ) {
        continue;
      }
      if (value) keys.add(value);
    }
  }
  return keys;
}

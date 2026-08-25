import { curationEntityId, datasetIdentity, identityKey } from "./dataset-payload.mjs";
import { asText, ensureArray, resolveRepoPath } from "./runtime-io.ts";
import { readJsonLines, readRowsIfExists } from "./workflow-patch-collect.mjs";

function referenceKey({ table, id, version }) {
  return [asText(table), asText(id), asText(version)].join("\u0000");
}

export function mapSchemaRows(schemaReport) {
  const map = new Map();
  for (const row of ensureArray(schemaReport?.rows)) {
    const id = asText(row?.id ?? row?.dataset_id);
    const version = asText(row?.version) || "00.00.001";
    if (!id) continue;
    map.set(`${id}@@${version}`, row);
    if (!map.has(id)) map.set(id, row);
  }
  return map;
}

export function mapCurationEntities(curationGateReport) {
  const map = new Map();
  for (const entity of ensureArray(curationGateReport?.entities ?? curationGateReport?.processes)) {
    const id = curationEntityId(entity);
    const version = asText(entity?.version) || "00.00.001";
    if (!id) continue;
    map.set(`${id}@@${version}`, entity);
    if (!map.has(id)) map.set(id, entity);
  }
  return map;
}

export function normalizeDryRunOperation(operation) {
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

export function readFlowDryRunArtifacts(repoRoot, dryRunReport) {
  const successFile = resolveRepoPath(repoRoot, dryRunReport?.files?.success_list);
  const failureFile = resolveRepoPath(repoRoot, dryRunReport?.files?.remote_failed);
  const success = new Map();
  const failures = new Map();
  for (const row of readRowsIfExists(successFile)) {
    const id = asText(row?.id);
    const version = asText(row?.version) || "00.00.001";
    if (id) success.set(`${id}@@${version}`, row);
  }
  for (const row of readJsonLines(failureFile)) {
    const payload = row?.json_ordered ?? row?.jsonOrdered ?? row?.json ?? row?.payload ?? row;
    const identity = datasetIdentity(payload, 0, "flow");
    failures.set(identityKey(identity), row);
  }
  return { success, failures };
}

export function readProcessDryRunArtifacts(repoRoot, dryRunReport) {
  const progressFile = resolveRepoPath(repoRoot, dryRunReport?.files?.progress_jsonl);
  const failuresFile = resolveRepoPath(repoRoot, dryRunReport?.files?.failures_jsonl);
  const prepared = new Map();
  const failures = new Map();
  for (const row of readJsonLines(progressFile)) {
    const id = asText(row?.id);
    const version = asText(row?.version) || "00.00.001";
    if (!id) continue;
    if (row?.status === "prepared") {
      prepared.set(`${id}@@${version}`, row);
    } else {
      failures.set(`${id}@@${version}`, row);
    }
  }
  for (const row of readJsonLines(failuresFile)) {
    const id = asText(row?.id);
    const version = asText(row?.version) || "00.00.001";
    if (id) failures.set(`${id}@@${version}`, row);
  }
  return { prepared, failures };
}

export function readLifecyclemodelDryRunArtifacts(repoRoot, dryRunReport) {
  const progressFile = resolveRepoPath(repoRoot, dryRunReport?.files?.progress_jsonl);
  const failuresFile = resolveRepoPath(repoRoot, dryRunReport?.files?.failures_jsonl);
  const prepared = new Map();
  const failures = new Map();
  for (const row of readJsonLines(progressFile)) {
    const id = asText(row?.id);
    const version = asText(row?.version) || "00.00.001";
    if (!id) continue;
    if (row?.status === "prepared") {
      prepared.set(`${id}@@${version}`, row);
    } else {
      failures.set(`${id}@@${version}`, row);
    }
  }
  for (const row of readJsonLines(failuresFile)) {
    const id = asText(row?.id);
    const version = asText(row?.version) || "00.00.001";
    if (id) failures.set(`${id}@@${version}`, row);
  }
  return { prepared, failures };
}

export function readDatasetSaveDraftDryRunArtifacts(repoRoot, dryRunReport) {
  const progressFile = resolveRepoPath(repoRoot, dryRunReport?.files?.progress_jsonl);
  const failuresFile = resolveRepoPath(repoRoot, dryRunReport?.files?.failures_jsonl);
  const prepared = new Map();
  const failures = new Map();
  for (const row of readJsonLines(progressFile)) {
    const id = asText(row?.id);
    const version = asText(row?.version) || "00.00.001";
    if (!id) continue;
    if (row?.status === "prepared") {
      prepared.set(`${id}@@${version}`, row);
    } else {
      failures.set(`${id}@@${version}`, row);
    }
  }
  for (const row of readJsonLines(failuresFile)) {
    const id = asText(row?.id);
    const version = asText(row?.version) || "00.00.001";
    if (id) failures.set(`${id}@@${version}`, row);
  }
  return { prepared, failures };
}

export function remoteVerifyBlockerKeys(remoteVerifyReport, options = {}) {
  const plannedRootKeys = options.plannedRootKeys ?? new Set();
  const plannedRootIds = options.plannedRootIds ?? new Set();
  const keys = new Set();
  for (const blocker of ensureArray(remoteVerifyReport?.blockers)) {
    const role = asText(blocker?.role);
    const table = asText(blocker?.table);
    const version = asText(
      blocker?.version ??
        blocker?.dataset_version ??
        blocker?.reference_version ??
        blocker?.ref_version,
    );
    for (const key of [
      blocker?.root_id,
      blocker?.dataset_id,
      blocker?.id,
      blocker?.refObjectId,
      blocker?.ref_object_id,
      blocker?.reference_id,
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

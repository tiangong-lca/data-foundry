import path from "node:path";
import { resolveArtifactPath } from "./artifact-inputs.ts";
import { identityKey } from "./dataset-payload.ts";
import { annualSupplyMissingDataSentinelText } from "./prewrite-cleanup.mjs";
import {
  asText,
  directoryExists,
  ensureArray,
  fileExists,
  readJson,
  readJsonIfExists,
  readRows,
  repoRelativePath,
  resolveRepoPath,
} from "./runtime-io.ts";

// part-00.mjs
export const annualSupplyFieldPath =
  "processDataSet.modellingAndValidation.dataSourcesTreatmentAndRepresentativeness.annualSupplyOrProductionVolume";

export function isAnnualSupplyTarget(code, itemPath) {
  return (
    asText(code).startsWith("annual_supply_or_production_volume") ||
    asText(itemPath).includes("annualSupplyOrProductionVolume")
  );
}

export function isAnnualSupplySchemaIssue(issue) {
  return isAnnualSupplyTarget(issue?.code, issue?.path);
}

export function schemaIssueInstruction(issue) {
  const code = String(issue?.code ?? "");
  const issuePath = String(issue?.path ?? "");
  if (isAnnualSupplyTarget(code, issuePath)) {
    return `Use source evidence or an explicitly documented profile fallback to write annualSupplyOrProductionVolume as a real annualized quantity with unit, for example '<number> <unit>/year'. If no annualized source evidence exists, Foundry deterministic cleanup must write the intentionally non-physical sentinel '${annualSupplyMissingDataSentinelText}' so database-side follow-up can bulk-locate and replace it later.`;
  }
  if (code === "invalid_format") {
    return "Use the SDK schema and methodology YAML for this field to replace the invalid value with a schema-valid source-backed value.";
  }
  return null;
}

export function schemaIssueCurationAction(issue) {
  const code = String(issue?.code ?? "");
  const issuePath = String(issue?.path ?? "");
  const annualSupplyIssue = isAnnualSupplySchemaIssue(issue);
  const base = {
    source: "schema",
    code: issue?.code,
    path: issue?.path ?? null,
    message: issue?.message ?? null,
    instruction: schemaIssueInstruction(issue),
    ...(annualSupplyIssue
      ? {
          sentinel_completion_allowed: true,
          sentinel_cleanup_path: annualSupplyFieldPath,
          sentinel_value: annualSupplyMissingDataSentinelText,
          sentinel_policy:
            "The 9999 missing-data sentinel is intentionally non-physical and easy to bulk-query; later database-side curation owns replacing it with real annual volume evidence.",
        }
      : {}),
  };
  if (annualSupplyIssue) {
    return {
      ...base,
      action_kind: "annual_supply_sentinel_completion",
      required_owner: "foundry_deterministic_cleanup",
      ai_required: false,
      instruction: schemaIssueInstruction(issue),
    };
  }
  if (issuePath.includes("common:other.tidasimport:sourceTrace")) {
    return {
      ...base,
      action_kind: "source_trace_externalization",
      required_owner: "foundry_deterministic_cleanup",
      ai_required: false,
      instruction:
        "Preserve sourceTrace in the authoring package context, then remove or externalize it before remote write.",
    };
  }
  if (code === "invalid_format" && issuePath.endsWith("common:timeStamp")) {
    return {
      ...base,
      action_kind: "timestamp_normalization",
      required_owner: "foundry_deterministic_cleanup",
      ai_required: false,
      instruction: "Normalize the timestamp to the SDK-accepted datetime format before validation.",
    };
  }
  return {
    ...base,
    action_kind: "ai_authoring",
    required_owner: "foundry_ai_authoring",
    ai_required: true,
  };
}

export function readCurationQueueContext(repoRoot, options) {
  const queueDirOption = options.queueDir ?? options.curationQueueDir;
  const queueDir = resolveRepoPath(repoRoot, queueDirOption);
  if (!queueDirOption) return null;
  if (!directoryExists(queueDir)) {
    throw new Error(
      `--queue-dir must point to an existing curation queue directory: ${queueDirOption}`,
    );
  }
  const manifestPath = path.join(queueDir, "outputs", "curation-queue-manifest.json");
  if (!fileExists(manifestPath)) {
    throw new Error(
      `--queue-dir is missing outputs/curation-queue-manifest.json: ${queueDirOption}`,
    );
  }
  const manifest = readJson(manifestPath);
  const tasks = ensureArray(manifest.tasks).filter((task) => task && typeof task === "object");
  return {
    queueDir,
    manifestPath,
    manifest,
    tasks,
    tasksById: new Map(tasks.map((task) => [String(task.task_id ?? ""), task])),
  };
}

export function queueFilePath(repoRoot, queueContext, fileRef) {
  return resolveArtifactPath(repoRoot, fileRef, queueContext.queueDir);
}

export function queueFileRelativePath(repoRoot, queueContext, fileRef) {
  const resolved = queueFilePath(repoRoot, queueContext, fileRef);
  return resolved ? repoRelativePath(repoRoot, resolved) : null;
}

export function summarizeQueueTask(repoRoot, queueContext, task) {
  if (!task) return null;
  return {
    schema_version: task.schema_version ?? 1,
    entity_type: task.entity_type ?? null,
    task_id: task.task_id ?? null,
    entity_id: task.entity_id ?? null,
    version: task.version ?? null,
    lock_key: task.lock_key ?? null,
    depends_on: ensureArray(task.depends_on),
    input_rows_file: queueFileRelativePath(repoRoot, queueContext, task.input_rows_file),
    closure_file: queueFileRelativePath(repoRoot, queueContext, task.closure_file),
    run_plan_file: queueFileRelativePath(repoRoot, queueContext, task.run_plan_file),
  };
}

export function readQueueTaskRows(repoRoot, queueContext, task) {
  const inputRowsPath = queueFilePath(repoRoot, queueContext, task?.input_rows_file);
  return fileExists(inputRowsPath) ? readRows(inputRowsPath) : [];
}

export function findQueueTask(queueContext, datasetType, identity) {
  if (!queueContext || datasetType === "lifecyclemodel") return null;
  const exact = queueContext.tasks.find(
    (task) =>
      task.entity_type === datasetType &&
      task.entity_id === identity.id &&
      task.version === identity.version,
  );
  if (exact) return exact;
  return (
    queueContext.tasks.find(
      (task) => task.entity_type === datasetType && task.entity_id === identity.id,
    ) ?? null
  );
}

export function buildQueueAuthoringContext(repoRoot, queueContext, datasetType, identity) {
  if (!queueContext) return null;
  const base = {
    queue_dir: repoRelativePath(repoRoot, queueContext.queueDir),
    manifest_file: repoRelativePath(repoRoot, queueContext.manifestPath),
    queue_status: queueContext.manifest.status ?? null,
    queue_counts: queueContext.manifest.counts ?? null,
    queue_blockers: ensureArray(queueContext.manifest.blockers),
  };
  if (datasetType === "lifecyclemodel") {
    return {
      ...base,
      status: "not_applicable",
      reason: "curation queue currently attaches entity closure for flow and process rows.",
    };
  }

  const task = findQueueTask(queueContext, datasetType, identity);
  if (!task) {
    return {
      ...base,
      status: "missing_task",
      entity_type: datasetType,
      entity_id: identity.id,
      version: identity.version,
    };
  }

  const closurePath = queueFilePath(repoRoot, queueContext, task.closure_file);
  const closure = readJsonIfExists(closurePath);
  const dependencyRows = ensureArray(closure?.dependencies?.local_tasks).map((dependency) => {
    const dependencyTask = queueContext.tasksById.get(String(dependency.task_id ?? ""));
    return {
      ref: dependency.ref ?? null,
      ref_path: dependency.ref_path ?? null,
      task: summarizeQueueTask(repoRoot, queueContext, dependencyTask),
      input_rows: readQueueTaskRows(repoRoot, queueContext, dependencyTask),
    };
  });
  const supportRows = queueContext.tasks
    .filter((candidate) => candidate.entity_type === "support")
    .map((supportTask) => ({
      task: summarizeQueueTask(repoRoot, queueContext, supportTask),
      input_rows: readQueueTaskRows(repoRoot, queueContext, supportTask),
    }));

  return {
    ...base,
    status: "attached",
    task: summarizeQueueTask(repoRoot, queueContext, task),
    closure_file: closurePath ? repoRelativePath(repoRoot, closurePath) : null,
    closure,
    dependency_rows: dependencyRows,
    support_rows: supportRows,
    notes: [
      "dependency_rows are local flow/support closure inputs for this entity task.",
      "AI output must still be a structured patch or build plan; database writes are not allowed from this package.",
    ],
  };
}

export function readAuthoringQueueContext(repoRoot, optionValue, kind) {
  const queuePath = resolveRepoPath(repoRoot, optionValue);
  if (!optionValue) {
    return null;
  }
  if (!queuePath || !fileExists(queuePath)) {
    throw new Error(`--${kind}-queue must point to a readable JSONL queue file: ${optionValue}`);
  }
  const rows = readRows(queuePath).filter(
    (row) => row && typeof row === "object" && !Array.isArray(row),
  );
  return {
    kind,
    path: queuePath,
    rows,
    rowsByIdentity: new Map(
      rows
        .map((row) => {
          const id = asText(
            row.dataset_id ?? row.entity_id ?? row.process_id ?? row.flow_id ?? row.id,
          );
          const version = asText(row.dataset_version ?? row.version) || "00.00.001";
          return [`${id}@@${version}`, row];
        })
        .filter(([key]) => !key.startsWith("@@")),
    ),
  };
}

export function authoringQueueRowsForIdentity(queueContext, identity) {
  if (!queueContext) return [];
  const exact = queueContext.rowsByIdentity.get(identityKey(identity));
  if (exact) return [exact];
  const idOnly = queueContext.rows.filter(
    (row) =>
      asText(row.dataset_id ?? row.entity_id ?? row.process_id ?? row.flow_id ?? row.id) ===
      identity.id,
  );
  return idOnly;
}

export function identityPreflightIndexPath(repoRoot, options, rowsFile) {
  const explicit =
    options.identityPreflightIndex ??
    options.identityPreflightRequests ??
    options.identityPreflightRequestsIndex ??
    options.identityPreflightFile;
  if (explicit) return resolveRepoPath(repoRoot, explicit);
  if (!rowsFile) return null;
  const defaultPath = path.join(
    path.dirname(path.dirname(rowsFile)),
    "identity-preflight-requests",
    "identity-preflight-requests.jsonl",
  );
  return fileExists(defaultPath) ? defaultPath : null;
}

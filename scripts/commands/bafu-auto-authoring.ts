import fs from "node:fs";
import path from "node:path";
import {
  canCreateBafuProcess,
  canCreateBafuProductFlow,
  identityTextFromParts,
  nonEquivalentFlowCandidateReasons,
  routeOrTechnologyDiffers,
  strongNameMeaningDiffers,
} from "../lib/bafu-authoring/identity-equivalence.ts";
import {
  cleanProcessFunctionalUnitText,
  removeTrailingLocationToken,
  splitBafuNamePlan,
  splitBafuNamePlanFromNameParts,
} from "../lib/bafu-authoring/name-plan.ts";
import {
  buildNamePatchOperations,
  type LocationLabelCatalog,
} from "../lib/bafu-authoring/patch-projection.ts";
import { resolveInstalledTiangongLcaCliPackage } from "../lib/foundry-runtime-utils.ts";

interface JsonRecord {
  [key: string]: unknown;
}

interface BafuAutoAuthoringDependencies {
  ensureArray: (value: unknown) => unknown[];
  fileExists: (filePath: string | null | undefined) => boolean;
  nowIso: () => string;
  readJson: (filePath: string) => JsonRecord;
  readText: (filePath: string) => string;
  repoRelativePath: (filePath: string) => string;
  resolveRepoPath: (filePath: unknown) => string | null;
  resolveLocationLabelCatalog?: () => LocationLabelCatalog;
  writeJson: (filePath: string, value: unknown) => void;
  writeJsonLines: (filePath: string, rows: readonly unknown[]) => void;
}

function isJsonRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function jsonRecord(value: unknown): JsonRecord {
  return isJsonRecord(value) ? value : {};
}

const fullContextKinds = [
  "schema",
  "methodology_yaml",
  "ruleset",
  "classification_schema",
  "location_schema",
];

function ensureDirFor(filePath: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function arrayValues(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  return value == null ? [] : [value];
}

function identityDecisionRow(actionItem: JsonRecord, _task: JsonRecord): JsonRecord {
  const evidence = jsonRecord(actionItem.evidence);
  const target = jsonRecord(evidence.target);
  const datasetType = String(
    actionItem?.dataset_type ?? target.dataset_type ?? "flow",
  ).toLowerCase();
  const createNew =
    datasetType === "process"
      ? canCreateBafuProcess(actionItem)
      : canCreateBafuProductFlow(actionItem);
  const datasetId = String(actionItem?.dataset_id ?? target.id ?? "");
  const datasetVersion = String(actionItem?.dataset_version ?? target.version ?? "00.00.001");
  const base = {
    schema_version: 1,
    dataset_type: datasetType,
    dataset_id: datasetId,
    dataset_version: datasetVersion,
    decision_status: "completed",
    authoring_package: actionItem?.authoring_package ?? null,
    authoring_package_sha256: actionItem?.authoring_package_sha256 ?? null,
    used_context_kinds: fullContextKinds,
    closes_action_items: ["identity_preflight_manual_review"],
  };
  if (!createNew.ok && createNew.reuse) {
    return {
      ...base,
      identity_decision: "reuse_existing_reference",
      canonical: {
        table: datasetType === "process" ? "processes" : "flows",
        ref_object_id: createNew.reuse.id,
        version: createNew.reuse.version,
        short_description: identityTextFromParts(createNew.reuse.names) || createNew.reuse.id,
      },
      basis:
        "A remote candidate was reviewed as physically identity-equivalent to the BAFU target by name, route, geography, flow property, and reference unit evidence, so the existing row is reused.",
      evidence: {
        source: "dataset-bafu-identity-decisions-autofill",
        policy: `reuse_existing_reference_when_${datasetType}_identity_equivalence_is_proven`,
        target,
        remote_search: evidence.remote_search ?? null,
        selected_candidate: createNew.reuse,
        reviewed_top_candidates: createNew.reviewed ?? [],
        physical_equivalence_decision: "identity_equivalent_to_existing_candidate",
      },
    };
  }
  if (!createNew.ok) {
    return {
      ...base,
      identity_decision: "block_unresolved",
      canonical: null,
      basis: createNew.reason,
      evidence: {
        source: "dataset-bafu-identity-decisions-autofill",
        policy: `blocked_when_${datasetType}_identity_equivalence_is_not_proven_safe`,
        target,
        reviewed_top_candidates: createNew.reviewed ?? [],
      },
    };
  }
  return {
    ...base,
    identity_decision: "create_new",
    canonical: null,
    basis:
      datasetType === "process"
        ? "BAFU source process was reviewed against the remote candidates; each candidate differs by reference flow, exchange signature, geography, classification/route, or process meaning, so no identity-equivalent process was found."
        : "BAFU source flow was reviewed against the remote candidates; each candidate differs by physical property, reference unit, geography/market, classification/route, technology, or flow meaning, so no identity-equivalent product/waste flow was found.",
    evidence: {
      source: "dataset-bafu-identity-decisions-autofill",
      policy:
        datasetType === "process"
          ? "create_new_allowed_for_process_when_candidates_are_not_identity_equivalent"
          : "create_new_allowed_for_non_elementary_product_flow_when_candidates_are_not_identity_equivalent",
      target,
      remote_search: evidence.remote_search ?? null,
      reviewed_top_candidates: createNew.reviewed,
      physical_equivalence_decision: "not_identity_equivalent_to_existing_candidates",
    },
  };
}

function loadLocationLabels(): Map<string, string> {
  const labels = new Map([
    ["CH", "Switzerland"],
    ["BR", "Brazil"],
    ["CN", "China"],
    ["CY", "Cyprus"],
    ["DE", "Germany"],
    ["EU", "Europe"],
    ["GLO", "global"],
    ["IN", "India"],
    ["JP", "Japan"],
    ["LU", "Luxembourg"],
    ["MX", "Mexico"],
    ["PE", "Peru"],
    ["RLA", "Latin America"],
    ["RER", "Europe"],
    ["UCTE", "UCTE"],
    ["US", "United States"],
    ["WEU", "Western Europe"],
  ]);
  const schemaPath = path.join(
    resolveInstalledTiangongLcaCliPackage().schemaDir,
    "tidas_locations_category.json",
  );
  try {
    const schema = jsonRecord(JSON.parse(fs.readFileSync(schemaPath, "utf8")));
    for (const item of arrayValues(schema.oneOf).map(jsonRecord)) {
      if (!item.const || !item.description) continue;
      labels.set(String(item.const).toUpperCase(), String(item.description));
    }
  } catch {
    // The stable fallback labels keep suggestions deterministic if an asset is malformed.
  }
  labels.set("GLO", "global");
  return labels;
}

export const bafuAutoAuthoringTestHooks = {
  splitBafuNamePlan,
  splitBafuNamePlanFromNameParts,
  cleanProcessFunctionalUnitText,
  removeTrailingLocationToken,
  nonEquivalentFlowCandidateReasons,
  strongNameMeaningDiffers,
  routeOrTechnologyDiffers,
};

export function createBafuAutoAuthoringCommands({
  ensureArray,
  fileExists,
  nowIso,
  readJson,
  repoRelativePath,
  resolveLocationLabelCatalog = loadLocationLabels,
  resolveRepoPath,
  writeJson,
  writeJsonLines,
}: BafuAutoAuthoringDependencies): {
  runDatasetBafuAuthoringPatchesAutofill: (options?: JsonRecord) => JsonRecord;
  runDatasetBafuIdentityDecisionsAutofill: (options?: JsonRecord) => JsonRecord;
} {
  function runDatasetBafuIdentityDecisionsAutofill(options: JsonRecord = {}): JsonRecord {
    if (options.help) {
      return {
        schema_version: 1,
        status: "help",
        command: "dataset-bafu-identity-decisions-autofill",
        usage: [
          "node scripts/foundry.ts dataset-bafu-identity-decisions-autofill --identity-decision-task <identity-decision-task.json>",
        ],
        purpose:
          "Write BAFU-specific identity-decisions.jsonl for safe, auditable product-flow create_new cases. This command never writes the remote database.",
      };
    }
    const taskPath = resolveRepoPath(options.identityDecisionTask ?? options.task ?? options.input);
    if (!taskPath || !fileExists(taskPath)) {
      throw new Error("--identity-decision-task is required.");
    }
    const task = readJson(taskPath);
    const taskFiles = jsonRecord(task.files);
    const outFile = resolveRepoPath(
      options.out ||
        options.decisions ||
        taskFiles.expected_decisions ||
        path.join(path.dirname(taskPath), "identity-decisions.jsonl"),
    )!;
    const outDir = resolveRepoPath(options.outDir || path.dirname(outFile))!;
    const reportFile = path.join(outDir, "bafu-identity-decisions-autofill-report.json");
    const rows = ensureArray(task.identity_action_items)
      .map(jsonRecord)
      .map((item) => identityDecisionRow(item, task));
    const blockedRows = rows.filter((row) => row.identity_decision === "block_unresolved");
    fs.mkdirSync(outDir, { recursive: true });
    writeJsonLines(outFile, rows);
    const report = {
      schema_version: 1,
      generated_at_utc: nowIso(),
      status: blockedRows.length > 0 ? "completed_with_manual_review" : "completed",
      command: "dataset-bafu-identity-decisions-autofill",
      identity_decision_task: repoRelativePath(taskPath),
      counts: {
        identity_action_items: ensureArray(task.identity_action_items).length,
        decisions: rows.length,
        create_new: rows.filter((row) => row.identity_decision === "create_new").length,
        blocked_unresolved: blockedRows.length,
      },
      blocked: blockedRows.map((row) => ({
        dataset_id: row.dataset_id,
        dataset_version: row.dataset_version,
        reason: row.basis,
      })),
      files: {
        report: repoRelativePath(reportFile),
        decisions: repoRelativePath(outFile),
      },
    };
    writeJson(reportFile, report);
    return report;
  }

  function runDatasetBafuAuthoringPatchesAutofill(options: JsonRecord = {}): JsonRecord {
    if (options.help) {
      return {
        schema_version: 1,
        status: "help",
        command: "dataset-bafu-authoring-patches-autofill",
        usage: [
          "node scripts/foundry.ts dataset-bafu-authoring-patches-autofill --task-manifest <authoring-task-manifest.json>",
        ],
        purpose:
          "Write per-task BAFU AI patch artifacts for supported high-confidence name-plan and flow-property saturation action items. This command never writes the remote database.",
      };
    }
    const manifestPath = resolveRepoPath(options.taskManifest ?? options.manifest ?? options.input);
    if (!manifestPath || !fileExists(manifestPath)) {
      throw new Error("--task-manifest is required.");
    }
    const manifest = readJson(manifestPath);
    const outDir = resolveRepoPath(options.outDir || path.dirname(manifestPath))!;
    const reportFile = path.join(outDir, "bafu-authoring-patches-autofill-report.json");
    const blockers: JsonRecord[] = [];
    const patchFiles: string[] = [];

    for (const task of ensureArray(manifest.tasks).map(jsonRecord)) {
      if (task.status !== "ready_for_ai_authoring") continue;
      const taskFiles = jsonRecord(task.files);
      const taskEntity = jsonRecord(task.entity);
      const taskContext = jsonRecord(task.context);
      const packagePath = resolveRepoPath(taskFiles.authoring_package);
      if (!packagePath || !fileExists(packagePath)) {
        blockers.push({
          code: "authoring_package_missing",
          dataset_id: taskEntity.entity_id ?? null,
          authoring_package: taskFiles.authoring_package ?? null,
        });
        continue;
      }
      const enrichedTask = {
        ...task,
        authoring_package_payload: readJson(packagePath),
      };
      const operations = buildNamePatchOperations(enrichedTask, {
        locationLabelCatalog: resolveLocationLabelCatalog(),
      });
      const operationBlockers = operations.filter((operation) => operation.blocker);
      if (operationBlockers.length > 0) {
        blockers.push(...operationBlockers.map((operation) => jsonRecord(operation.blocker)));
        continue;
      }
      const patchPath = resolveRepoPath(taskFiles.output_patch_file);
      if (!patchPath) {
        blockers.push({
          code: "output_patch_file_missing",
          dataset_id: taskEntity.entity_id ?? null,
        });
        continue;
      }
      const payload = {
        schema_version: 1,
        kind: "tiangong_foundry_dataset_patch",
        patch_status: "completed",
        generated_at_utc: nowIso(),
        task_manifest: repoRelativePath(manifestPath),
        patch_sets: [
          {
            dataset_type: taskEntity.dataset_type,
            dataset_id: taskEntity.entity_id,
            version: taskEntity.version,
            authoring_package: path.basename(packagePath),
            authoring_package_sha256: taskContext.authoring_package_sha256 ?? null,
            operations,
          },
        ],
      };
      ensureDirFor(patchPath);
      writeJson(patchPath, payload);
      patchFiles.push(repoRelativePath(patchPath));
    }

    const report = {
      schema_version: 1,
      generated_at_utc: nowIso(),
      status: blockers.length > 0 ? "completed_with_manual_review" : "completed",
      command: "dataset-bafu-authoring-patches-autofill",
      task_manifest: repoRelativePath(manifestPath),
      counts: {
        tasks: ensureArray(manifest.tasks).length,
        patch_files: patchFiles.length,
        blockers: blockers.length,
      },
      blockers,
      files: {
        report: repoRelativePath(reportFile),
        patch_files: patchFiles,
      },
    };
    fs.mkdirSync(outDir, { recursive: true });
    writeJson(reportFile, report);
    return report;
  }

  return {
    runDatasetBafuAuthoringPatchesAutofill,
    runDatasetBafuIdentityDecisionsAutofill,
  };
}

import path from "node:path";
import { annualSupplyMissingDataSentinelText } from "./prewrite-cleanup.ts";
import {
  asText,
  ensureArray,
  fileExists,
  optionList,
  readJson,
  readRows,
  readText,
  repoRelativePath,
  resolveRepoPath,
  unique,
} from "./runtime-io.ts";
import {
  operationFullContextEvidenceBlockers,
  operationHasEvidence,
  operationResolution,
  operationResolutionMode,
  operationTouchesCommonOther,
  operationUsedContextKinds,
  patchSetAuthoringPackage,
  patchSetDatasetId,
  patchSetDatasetVersion,
  patchSetOperations,
  taskRequiredContextKinds,
  taskRequiresFullContextEvidence,
} from "./workflow-authoring-tasks.mjs";
import {
  containsAiTemplatePlaceholder,
  operationClosesAnnualSupplyTarget,
  operationClosureCodes,
  operationClosureKeys,
  operationTargetsLocationCode,
  taskActionItemKeys,
  taskActionItemsForOperation,
  taskAuthoringPackageName,
  validateDeferredCommonOtherTrace,
  validateFlowClassificationDecisionOperation,
  validateLocationDecisionOperation,
  validateProcessClassificationDecisionOperation,
  validateSourceExchangeCompletenessTrace,
} from "./workflow-patch-evidence.mjs";
import { allowedPatchResolutionModes } from "./workflow-semantic-actions.mjs";

interface JsonRecord {
  [key: string]: unknown;
}

interface PatchTask extends JsonRecord {
  entity?: unknown;
}

interface PatchSet extends JsonRecord {
  row_index?: unknown;
  rowIndex?: unknown;
}

interface PatchOperation extends JsonRecord {
  op?: unknown;
  path?: unknown;
}

interface ValidateCollectedPatchSetOptions {
  repoRoot: string;
  task: PatchTask;
  patchSet: PatchSet;
  patchSetIndex: unknown;
  patchPath: unknown;
}

export interface JsonArtifact {
  path: string;
  value: unknown;
}

interface IdentityDecisionApplyReportOptions {
  identityDecisionApplyReport?: unknown;
  identityDecisionsApplyReport?: unknown;
  identityDecisionApplyReports?: unknown;
  identityDecisionsApplyReports?: unknown;
}

export interface NormalizedSourceReferenceRewriteRow extends JsonRecord {
  dataset_type: string | null;
  dataset_id: string;
  dataset_version: string;
  relation: string | null;
  path: string | null;
  action: string;
  reason: string | null;
  evidence: JsonRecord;
}

// part-05.mjs
export function validateCollectedPatchSet({
  repoRoot,
  task,
  patchSet,
  patchSetIndex,
  patchPath,
}: ValidateCollectedPatchSetOptions): JsonRecord[] {
  const blockers: JsonRecord[] = [];
  const operations = patchSetOperations(patchSet) as PatchOperation[] | null;
  const entity = (task.entity ?? {}) as JsonRecord;
  const datasetId = patchSetDatasetId(patchSet);
  const datasetVersion = patchSetDatasetVersion(patchSet);
  const expectedPackage = taskAuthoringPackageName(repoRoot, task);
  const authoringPackage = patchSetAuthoringPackage(patchSet);
  const patchLocation = repoRelativePath(repoRoot, patchPath as string);

  if (!operations) {
    blockers.push({
      code: "patch_set_invalid",
      message: "AI patch output must contain patch sets with operations[].",
      patch_file: patchLocation,
      patch_set_index: patchSetIndex,
      entity,
    });
    return blockers;
  }
  const nonTestOperations = operations.filter((operation) => asText(operation?.op) !== "test");
  const deferredAnnualSupply = nonTestOperations.some(
    (operation) =>
      operationResolutionMode(operation) === "deferred_to_common_other" &&
      operationClosesAnnualSupplyTarget(operation),
  );
  if (deferredAnnualSupply) {
    blockers.push({
      code: "patch_deferred_annual_supply_not_allowed",
      message:
        "annualSupplyOrProductionVolume is schema-required and must not be deferred to common:other; use Foundry deterministic cleanup to write the searchable 9999 missing-data sentinel when source evidence is missing.",
      sentinel_value: annualSupplyMissingDataSentinelText,
      patch_file: patchLocation,
      patch_set_index: patchSetIndex,
      entity,
    });
  }
  if (nonTestOperations.length === 0) {
    blockers.push({
      code: "patch_effective_operation_missing",
      message: "Patch set must include at least one non-test operation for AI-authored curation.",
      patch_file: patchLocation,
      patch_set_index: patchSetIndex,
      entity,
    });
  }
  if (!datasetId && patchSet.row_index === undefined && patchSet.rowIndex === undefined) {
    blockers.push({
      code: "patch_target_missing",
      message: "Patch set must target a row by dataset_id/id/uuid/entity_id or row_index.",
      patch_file: patchLocation,
      patch_set_index: patchSetIndex,
      entity,
    });
  }
  if (datasetId && datasetId !== entity.entity_id) {
    blockers.push({
      code: "patch_dataset_id_mismatch",
      message: `Patch dataset id ${datasetId} does not match task entity ${entity.entity_id}.`,
      patch_file: patchLocation,
      patch_set_index: patchSetIndex,
      entity,
    });
  }
  if (datasetVersion && datasetVersion !== entity.version) {
    blockers.push({
      code: "patch_dataset_version_mismatch",
      message: `Patch dataset version ${datasetVersion} does not match task version ${entity.version}.`,
      patch_file: patchLocation,
      patch_set_index: patchSetIndex,
      entity,
    });
  }
  if (!authoringPackage) {
    blockers.push({
      code: "patch_authoring_package_missing",
      message: "Patch set must include authoring_package.",
      patch_file: patchLocation,
      patch_set_index: patchSetIndex,
      entity,
    });
  } else if (expectedPackage && path.basename(authoringPackage) !== expectedPackage) {
    blockers.push({
      code: "patch_authoring_package_mismatch",
      message: `Patch authoring_package ${authoringPackage} does not match ${expectedPackage}.`,
      patch_file: patchLocation,
      patch_set_index: patchSetIndex,
      entity,
    });
  }

  const closed = new Set<string>(nonTestOperations.flatMap(operationClosureKeys));
  for (const required of taskActionItemKeys(task)) {
    const [code, itemPath] = required.split("\u0000");
    const matched = [...closed].some((closure) => {
      const [closedCode, closedPath] = closure.split("\u0000");
      return closedCode === code && (!closedPath || !itemPath || closedPath === itemPath);
    });
    if (!matched) {
      blockers.push({
        code: "patch_action_item_unclosed",
        message: `Patch set does not close required action item ${code}.`,
        path: itemPath || null,
        patch_file: patchLocation,
        patch_set_index: patchSetIndex,
        entity,
      });
    }
  }

  operations.forEach((operation, operationIndex) => {
    const op = asText(operation?.op);
    const pointer = asText(operation?.path);
    const mode = operationResolutionMode(operation);
    if (!["add", "replace", "remove", "test"].includes(op)) {
      blockers.push({
        code: "patch_operation_invalid",
        message: `Unsupported or missing patch operation: ${op || "(missing)"}.`,
        patch_file: patchLocation,
        patch_set_index: patchSetIndex,
        operation_index: operationIndex,
        entity,
      });
    }
    if (op !== "test") {
      if (!operationResolution(operation)) {
        blockers.push({
          code: "patch_resolution_missing",
          message:
            "Non-test patch operations must include resolution with mode and used_context_kinds.",
          patch_file: patchLocation,
          patch_set_index: patchSetIndex,
          operation_index: operationIndex,
          entity,
        });
      } else {
        if (!allowedPatchResolutionModes.has(mode)) {
          blockers.push({
            code: "patch_resolution_mode_invalid",
            message: `Unsupported patch resolution mode: ${mode || "(missing)"}.`,
            patch_file: patchLocation,
            patch_set_index: patchSetIndex,
            operation_index: operationIndex,
            entity,
          });
        }
        for (const actionItem of taskActionItemsForOperation(task, operation) as JsonRecord[]) {
          const allowedModes = ensureArray(actionItem?.allowed_resolution_modes)
            .map((item) => asText(item))
            .filter(Boolean);
          if (allowedModes.length > 0 && !allowedModes.includes(mode)) {
            blockers.push({
              code: "patch_resolution_mode_not_allowed_for_action_item",
              message: `Patch resolution mode ${mode || "(missing)"} is not allowed for action item ${asText(actionItem.code) || "(unknown)"}.`,
              allowed_resolution_modes: allowedModes,
              action_item_code: asText(actionItem.code) || null,
              action_item_path: asText(actionItem.path) || null,
              patch_file: patchLocation,
              patch_set_index: patchSetIndex,
              operation_index: operationIndex,
              entity,
            });
          }
        }
        const usedKinds = new Set(operationUsedContextKinds(operation));
        for (const requiredKind of taskRequiredContextKinds(task)) {
          if (!usedKinds.has(requiredKind)) {
            blockers.push({
              code: "patch_resolution_context_kind_missing",
              message: `Patch resolution does not declare use of required context kind '${requiredKind}'.`,
              required_kind: requiredKind,
              patch_file: patchLocation,
              patch_set_index: patchSetIndex,
              operation_index: operationIndex,
              entity,
            });
          }
        }
        if (
          ["deferred_to_common_other", "source_trace_verified"].includes(mode) &&
          !operationTouchesCommonOther(operation)
        ) {
          blockers.push({
            code: "patch_resolution_trace_not_in_common_other",
            message:
              "deferred_to_common_other and source_trace_verified resolutions must add or update common:other provenance.",
            patch_file: patchLocation,
            patch_set_index: patchSetIndex,
            operation_index: operationIndex,
            entity,
          });
        }
        const traceContractBlockers: JsonRecord[] =
          mode === "deferred_to_common_other"
            ? validateDeferredCommonOtherTrace({
                operation,
                actionItems: taskActionItemsForOperation(task, operation),
              })
            : mode === "source_trace_verified"
              ? validateSourceExchangeCompletenessTrace(operation)
              : [];
        traceContractBlockers.forEach((blocker) => {
          blockers.push({
            ...blocker,
            patch_file: patchLocation,
            patch_set_index: patchSetIndex,
            operation_index: operationIndex,
            entity,
          });
        });
        const closureCodes = operationClosureCodes(operation);
        if (
          closureCodes.some((code) => code.includes("only_output_exchange")) &&
          !["source_trace_verified", "exchange_set_repaired"].includes(mode)
        ) {
          blockers.push({
            code: "patch_resolution_mode_mismatch",
            message:
              "Only-output exchange action items must be resolved by source_trace_verified or exchange_set_repaired.",
            patch_file: patchLocation,
            patch_set_index: patchSetIndex,
            operation_index: operationIndex,
            entity,
          });
        }
        if (
          closureCodes.some((code) => code.includes("classification")) &&
          mode !== "classification_decision"
        ) {
          blockers.push({
            code: "patch_resolution_mode_mismatch",
            message: "Classification action items must be resolved by classification_decision.",
            patch_file: patchLocation,
            patch_set_index: patchSetIndex,
            operation_index: operationIndex,
            entity,
          });
        }
        if (
          closureCodes.some((code) => code.includes("classification")) &&
          mode === "classification_decision"
        ) {
          validateProcessClassificationDecisionOperation({
            repoRoot,
            task,
            operation,
          }).forEach((blocker) => {
            blockers.push({
              ...blocker,
              patch_file: patchLocation,
              patch_set_index: patchSetIndex,
              operation_index: operationIndex,
              entity,
            });
          });
          validateFlowClassificationDecisionOperation({
            repoRoot,
            task,
            operation,
          }).forEach((blocker) => {
            blockers.push({
              ...blocker,
              patch_file: patchLocation,
              patch_set_index: patchSetIndex,
              operation_index: operationIndex,
              entity,
            });
          });
        }
        if (
          closureCodes.some((code) => code.includes("location")) &&
          mode !== "location_decision"
        ) {
          blockers.push({
            code: "patch_resolution_mode_mismatch",
            message: "Location action items must be resolved by location_decision.",
            patch_file: patchLocation,
            patch_set_index: patchSetIndex,
            operation_index: operationIndex,
            entity,
          });
        }
        if (
          closureCodes.some((code) => code.includes("location")) &&
          mode === "location_decision" &&
          operationTargetsLocationCode(operation)
        ) {
          validateLocationDecisionOperation({
            repoRoot,
            operation,
          }).forEach((blocker) => {
            blockers.push({
              ...blocker,
              patch_file: patchLocation,
              patch_set_index: patchSetIndex,
              operation_index: operationIndex,
              entity,
            });
          });
        }
      }
    }
    if (!pointer.startsWith("/")) {
      blockers.push({
        code: "patch_path_invalid",
        message: "Patch operation path must be a JSON Pointer.",
        patch_file: patchLocation,
        patch_set_index: patchSetIndex,
        operation_index: operationIndex,
        entity,
      });
    }
    if (op !== "test" && !operationHasEvidence(operation)) {
      blockers.push({
        code: "patch_evidence_missing",
        message: "Non-test patch operations need basis or evidence before collect/apply.",
        patch_file: patchLocation,
        patch_set_index: patchSetIndex,
        operation_index: operationIndex,
        entity,
      });
    }
    if (op !== "test") {
      if (taskRequiresFullContextEvidence(task) && operationClosureKeys(operation).length === 0) {
        blockers.push({
          code: "patch_action_item_closure_missing_full_context",
          message:
            "Full-context AI patch operations must close at least one authoring action item so mutation-manifest evidence remains fully traceable.",
          patch_file: patchLocation,
          patch_set_index: patchSetIndex,
          operation_index: operationIndex,
          entity,
        });
      }
      (operationFullContextEvidenceBlockers({ operation, task }) as JsonRecord[]).forEach(
        (blocker) => {
          blockers.push({
            ...blocker,
            patch_file: patchLocation,
            patch_set_index: patchSetIndex,
            operation_index: operationIndex,
            entity,
          });
        },
      );
    }
    if (containsAiTemplatePlaceholder(operation)) {
      blockers.push({
        code: "patch_template_placeholder_unresolved",
        message: "Patch operation still contains an AI template placeholder.",
        patch_file: patchLocation,
        patch_set_index: patchSetIndex,
        operation_index: operationIndex,
        entity,
      });
    }
  });

  return blockers;
}

export function readJsonLines(filePath: unknown): unknown[] {
  if (!filePath || !fileExists(filePath as string)) return [];
  const text = readText(filePath as string).trim();
  if (!text) return [];
  return text
    .split(/\r?\n/u)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

export function readRowsIfExists(filePath: unknown): unknown[] {
  return filePath && fileExists(filePath as string) ? readRows(filePath as string) : [];
}

export function readJsonIfOption(repoRoot: string, value: unknown): JsonArtifact | null {
  const resolved = resolveRepoPath(repoRoot, value as string | null | undefined);
  return resolved && fileExists(resolved) ? { path: resolved, value: readJson(resolved) } : null;
}

export function readJsonArtifactsIfOption(repoRoot: string, value: unknown): JsonArtifact[] {
  return optionList(value)
    .map((entry) => {
      const resolved = resolveRepoPath(repoRoot, entry);
      return resolved && fileExists(resolved)
        ? { path: resolved, value: readJson(resolved) }
        : null;
    })
    .filter(Boolean) as JsonArtifact[];
}

export function identityDecisionApplyReportOptionValues(options: unknown): string[] {
  const typedOptions = options as IdentityDecisionApplyReportOptions;
  return unique([
    ...optionList(typedOptions.identityDecisionApplyReport),
    ...optionList(typedOptions.identityDecisionsApplyReport),
    ...optionList(typedOptions.identityDecisionApplyReports),
    ...optionList(typedOptions.identityDecisionsApplyReports),
  ]);
}

export function readFileArtifactIfOption(repoRoot: string, value: unknown): string | null {
  const resolved = resolveRepoPath(repoRoot, value as string | null | undefined);
  return resolved && fileExists(resolved) ? resolved : null;
}

export function defaultSourceReferenceRewriteFile(rowsFile: unknown): string | null {
  const rowsDir = path.dirname(rowsFile as string);
  const candidates = [
    path.join(rowsDir, "source-reference-rewrites.jsonl"),
    path.join(path.dirname(rowsDir), "source-reference-rewrites.jsonl"),
  ];
  return candidates.find((candidate) => fileExists(candidate)) ?? null;
}

export function normalizeSourceReferenceRewriteRow(
  row: unknown,
): NormalizedSourceReferenceRewriteRow {
  const record = row as JsonRecord | null | undefined;
  const normalized = {
    ...(row as JsonRecord),
    dataset_type: asText(record?.dataset_type ?? record?.datasetType) || null,
    dataset_id: asText(record?.dataset_id ?? record?.datasetId ?? record?.entity_id),
    dataset_version:
      asText(record?.dataset_version ?? record?.datasetVersion ?? record?.version) || "00.00.001",
    relation: asText(record?.relation) || null,
    path: asText(record?.path) || null,
    action: asText(record?.action) || "rewrite_to_canonical_source_reference",
    reason: asText(record?.reason) || null,
  } as NormalizedSourceReferenceRewriteRow;
  normalized.evidence = {
    source: "source-reference-rewrites.jsonl",
    source_file: asText(record?.source_file ?? record?.sourceFile) || null,
    original: record?.original ?? null,
    canonical: record?.canonical ?? null,
    reason: normalized.reason,
  };
  return normalized;
}

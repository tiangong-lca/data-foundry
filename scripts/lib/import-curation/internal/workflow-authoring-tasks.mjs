import fs from "node:fs";
import path from "node:path";
import { datasetTypePlural, supportedDatasetTypes } from "./dataset-types.ts";
import { sha256Text } from "./hash-utils.ts";
import { annualSupplyMissingDataSentinelText } from "./prewrite-cleanup.mjs";
import {
  asText,
  ensureArray,
  fileExists,
  jsonLines,
  nowIso,
  readJson,
  readText,
  repoRelativePath,
  resolveRepoPath,
  sanitizeFileName,
  unique,
  writeJson,
  writeText,
} from "./runtime-io.ts";
import {
  buildPatchTemplate,
  contextSummaryHasKind,
  contextSummaryHasNonEmptyPayload,
  contextSummaryHasPattern,
  decisionOnlyActionItems,
  fullContextAiConfigRequiresAuthoring,
  markdownList,
  packageContextFileSummary,
  patchAuthoringActionItems,
  relOrNull,
  requiredFullContextFilePatterns,
  requiredFullContextKinds,
  sharedContextBundleReadinessBlockers,
} from "./workflow-semantic-actions.mjs";

// part-03.mjs
export function authoringPackageFullContextReadinessBlockers({
  repoRoot,
  packagePayload,
  actionItems,
  packagePath = null,
}) {
  if (ensureArray(actionItems).length === 0) return [];
  const requirement = packagePayload?.full_context_ai_completion;
  if (!fullContextAiConfigRequiresAuthoring(requirement)) return [];
  const blockers = [];
  const authoringPackage = packagePath ? repoRelativePath(repoRoot, packagePath) : null;
  const contractFiles = ensureArray(packagePayload?.contract_context_files);
  for (const missingContext of ensureArray(packagePayload?.missing_context_files)) {
    blockers.push({
      code: "authoring_task_context_file_missing",
      message:
        "AI authoring task cannot start while its authoring package records missing context files.",
      authoring_package: authoringPackage,
      kind: asText(missingContext?.kind) || null,
      path: asText(missingContext?.path) || null,
    });
  }
  for (const file of contractFiles) {
    if (!contextSummaryHasNonEmptyPayload(file)) {
      blockers.push({
        code: "authoring_task_context_file_empty",
        message: "AI authoring task cannot start with an empty contract context file.",
        authoring_package: authoringPackage,
        kind: asText(file?.kind) || null,
        path: asText(file?.path) || null,
      });
    }
  }
  for (const kind of requiredFullContextKinds(requirement)) {
    if (!contextSummaryHasKind(contractFiles, kind)) {
      blockers.push({
        code: "authoring_task_required_context_missing",
        message:
          "AI authoring task must include full schema/YAML/ruleset/category/location context before patch authoring.",
        authoring_package: authoringPackage,
        required_kind: kind,
      });
    }
  }
  for (const pattern of requiredFullContextFilePatterns(requirement)) {
    if (!contextSummaryHasPattern(contractFiles, pattern)) {
      blockers.push({
        code: "authoring_task_required_context_file_missing",
        message:
          "AI authoring task must include the required full-context file before patch authoring.",
        authoring_package: authoringPackage,
        required_file_pattern: pattern,
      });
    }
  }
  if (
    !packagePayload?.source_row ||
    typeof packagePayload.source_row !== "object" ||
    Array.isArray(packagePayload.source_row)
  ) {
    blockers.push({
      code: "authoring_task_source_row_payload_missing",
      message: "AI authoring task must include the source row payload used as evidence.",
      authoring_package: authoringPackage,
    });
  }
  if (
    !packagePayload?.entity_payload ||
    typeof packagePayload.entity_payload !== "object" ||
    Array.isArray(packagePayload.entity_payload)
  ) {
    blockers.push({
      code: "authoring_task_entity_payload_missing",
      message: "AI authoring task must include the converted TIDAS entity payload to patch.",
      authoring_package: authoringPackage,
    });
  }
  return blockers;
}

export function authoringTaskFullContextReadinessBlockers({ repoRoot, task }) {
  if (ensureArray(task?.action_items).length === 0) return [];
  const requirement = task?.context?.full_context_ai_completion;
  if (!fullContextAiConfigRequiresAuthoring(requirement)) return [];
  const blockers = [];
  const contractFiles = ensureArray(task?.context?.contract_context_files);
  blockers.push(
    ...sharedContextBundleReadinessBlockers({
      repoRoot,
      sharedContextBundle: task?.context?.shared_context_bundle,
      sourceKind: "task",
      sourcePath: task?.files?.task_json,
    }),
  );
  for (const missingContext of ensureArray(task?.context?.missing_context_files)) {
    blockers.push({
      code: "authoring_task_context_file_missing",
      message:
        "AI patch collect cannot accept a task whose context files were missing at authoring time.",
      kind: asText(missingContext?.kind) || null,
      path: asText(missingContext?.path) || null,
    });
  }
  for (const kind of requiredFullContextKinds(requirement)) {
    if (!contextSummaryHasKind(contractFiles, kind)) {
      blockers.push({
        code: "authoring_task_required_context_missing",
        message:
          "AI patch collect requires the authoring task to carry full schema/YAML/ruleset/category/location context.",
        required_kind: kind,
      });
    }
  }
  for (const pattern of requiredFullContextFilePatterns(requirement)) {
    if (!contextSummaryHasPattern(contractFiles, pattern)) {
      blockers.push({
        code: "authoring_task_required_context_file_missing",
        message:
          "AI patch collect requires the authoring task to carry every required full-context file.",
        required_file_pattern: pattern,
      });
    }
  }
  const packagePath = resolveRepoPath(repoRoot, task?.files?.authoring_package);
  if (!packagePath || !fileExists(packagePath)) {
    blockers.push({
      code: "authoring_task_authoring_package_missing",
      message:
        "AI patch collect cannot verify full-context readiness without the authoring package.",
      authoring_package: task?.files?.authoring_package ?? null,
    });
    return blockers;
  }
  try {
    const packagePayload = readJson(packagePath);
    blockers.push(
      ...authoringPackageFullContextReadinessBlockers({
        repoRoot,
        packagePayload,
        actionItems: task.action_items,
        packagePath,
      }),
    );
  } catch (error) {
    blockers.push({
      code: "authoring_task_authoring_package_invalid",
      message: error instanceof Error ? error.message : String(error),
      authoring_package: task?.files?.authoring_package ?? null,
    });
  }
  return blockers;
}

export function shellQuote(value) {
  const text = String(value ?? "");
  if (/^[A-Za-z0-9_./:@%+=,-]+$/u.test(text)) return text;
  return `'${text.replace(/'/gu, `'\\''`)}'`;
}

export function renderAuthoringTaskMarkdown(task) {
  const actionItems = task.action_items.map((item) => {
    const lines = [
      `- [${item.index}] ${item.code}`,
      `  - path: ${item.path ?? "(AI must choose path)"}`,
      `  - json_pointer: ${item.json_pointer}`,
      `  - message: ${item.message ?? "(none)"}`,
    ];
    if (item.instruction) lines.push(`  - instruction: ${item.instruction}`);
    if (ensureArray(item.allowed_resolution_modes).length > 0) {
      lines.push(`  - allowed_resolution_modes: ${item.allowed_resolution_modes.join(", ")}`);
    }
    if (item.evidence !== null && item.evidence !== undefined) {
      lines.push(`  - evidence: ${JSON.stringify(item.evidence)}`);
    }
    return lines.join("\n");
  });
  const contextFiles = [
    ...task.context.profile_context_files,
    ...task.context.contract_context_files,
  ].map((file) => `${file.kind}: ${file.path} (${file.bytes} bytes, sha256=${file.sha256})`);
  const sharedContextBundle = task.context?.shared_context_bundle;
  const sharedContextLines = sharedContextBundle
    ? [
        `- shared context bundle: ${sharedContextBundle.path} (sha256=${sharedContextBundle.sha256})`,
        `- shared context files: ${sharedContextBundle.counts?.files ?? "(unknown)"}`,
        `- duplicate context bytes avoided: ${sharedContextBundle.counts?.duplicate_context_bytes_avoided ?? 0}`,
      ]
    : [];
  const sharedContextInstruction = sharedContextBundle
    ? "\nIf a shared context bundle is listed above, read it once for the batch-level full schema/YAML/ruleset/category/location text. Still read the entity authoring package for source row, entity payload, action items, support rows, queue/dependency closure, and hash-bound proof. Do not treat the shared bundle as a replacement for package lineage or action-item evidence.\n"
    : "";

  return `# Foundry AI Authoring Task

Status: ${task.status}

## Entity

- type: ${task.entity.dataset_type}
- id: ${task.entity.entity_id}
- version: ${task.entity.version}
- profile: ${task.entity.profile}

## Required Inputs

- authoring package: ${task.files.authoring_package}
- source rows file: ${task.context.source_rows_file ?? "(not recorded)"}
- patch template: ${task.files.patch_template}
- output patch file: ${task.files.output_patch_file}
${sharedContextLines.length > 0 ? sharedContextLines.join("\n") : ""}

Read the full authoring package before writing the patch. It contains the converted row, source row, schema issues, QA findings, profile constraints, queue/dependency closure, support rows, bundled TIDAS taxonomy/location schemas, and full contract context text when supplied by the SDK/CLI.
${sharedContextInstruction}

## Context Files

${markdownList(contextFiles)}

## Action Items

${actionItems.length > 0 ? actionItems.join("\n") : "- none"}

## Output Contract

Write a structured patch JSON to:

\`${task.files.output_patch_file}\`

The patch must:

- target this dataset id/version or row_index
- keep \`authoring_package\` set to the package filename
- treat template paths as suggestions and fix JSON Pointers against the actual authoring package row
- provide \`basis\` or \`evidence\` for every non-test operation
- for full-context tasks, provide both \`basis\` and structured \`evidence\` with a source/context identifier plus \`quote_or_trace\`, source path, field path, citation, or equivalent pointer
- provide \`resolution.mode\` for every non-test operation; use one of the action item's allowed modes
- include \`resolution.used_context_kinds\` with every full-context kind required by the task, normally \`schema\`, \`methodology_yaml\`, \`ruleset\`, \`classification_schema\`, and \`location_schema\`
- close every AI-required action item with \`closes_action_items\`
- for full-context import profiles, every non-test operation must include \`closes_action_items\`; supporting cleanup operations should close the same action item they are needed to resolve
- avoid database writes, direct Supabase calls, or hand-edited row files
- preserve source-language content; do not add extra language variants unless the source evidence supports them
- do not use \`common:other\` as a substitute for mandatory schema fields; schema-required values need evidence-backed values or must remain blocked
- if a value cannot be inferred safely and the action item's allowed modes include \`deferred_to_common_other\`, add \`common:other.tiangongfoundry:unresolvedTrace\` with \`status\`, \`action_item_code\`, \`blocked_path\`, \`reason\`, structured \`evidence\`, and \`next_action\`; evidence must include source plus quote/trace/path/citation pointer
- do not defer \`annualSupplyOrProductionVolume\` to \`common:other\`; if source annual volume evidence is missing, Foundry deterministic cleanup writes \`${annualSupplyMissingDataSentinelText}\` into the required field for later database-side curation
- if source exchange completeness is being accepted as source-faithful, use \`resolution.mode=source_trace_verified\` and add \`common:other.tiangongfoundry:sourceExchangeCompleteness\` with accepted \`status\` and structured source trace evidence; evidence must include source plus quote/trace/path/citation pointer

## Deterministic Apply

\`\`\`bash
${task.commands.apply_patch}
\`\`\`

After apply, rerun Rust tidas validation, deterministic CLI QA where relevant, Foundry cleanup, dry-run publish/save, mutation manifest, explicit commit, and post-commit \`dataset verify-remote --compare-root-payload\`.
`;
}

export function buildDatasetAuthoringTaskFromPackage({
  repoRoot,
  packagePath,
  outDir,
  options = {},
}) {
  if (!packagePath || !fileExists(packagePath)) {
    throw new Error(
      "--authoring-package is required and must point to a Foundry AI authoring package JSON file.",
    );
  }

  const packagePayload = readJson(packagePath);
  const datasetType = asText(packagePayload.dataset_type);
  if (!supportedDatasetTypes.has(datasetType)) {
    throw new Error(
      `Authoring package dataset_type must be one of ${[...supportedDatasetTypes].join(", ")}.`,
    );
  }
  const entityId = asText(packagePayload.entity_id ?? packagePayload.process_id);
  if (!entityId) {
    throw new Error("Authoring package is missing entity_id.");
  }

  const patchFile = resolveRepoPath(
    repoRoot,
    options.patchFile || options.patch || path.join(outDir, "ai-patches.json"),
  );
  const patchTemplateFile = path.join(outDir, "patch-template.json");
  const taskFile = path.join(outDir, "ai-authoring-task.json");
  const markdownFile = path.join(outDir, "ai-authoring-task.md");
  const patchedRowsFile = resolveRepoPath(
    repoRoot,
    options.patchedRows ||
      options.out ||
      path.join(outDir, `${datasetTypePlural[datasetType]}.patched.jsonl`),
  );
  const applyDir = resolveRepoPath(repoRoot, options.applyDir || path.join(outDir, "patch-apply"));
  const packageDir = path.dirname(packagePath);
  const actionItems = patchAuthoringActionItems(packagePayload);
  const decisionOnlyItems = decisionOnlyActionItems(packagePayload);
  const contextBlockers = authoringPackageFullContextReadinessBlockers({
    repoRoot,
    packagePayload,
    actionItems,
    packagePath,
  });
  const patchTemplate = buildPatchTemplate(packagePayload, packagePath);
  const sourceRowsFile = packagePayload.source_rows_file
    ? repoRelativePath(repoRoot, resolveRepoPath(repoRoot, packagePayload.source_rows_file))
    : null;
  const applyArgs = [
    "node",
    "scripts/foundry.mjs",
    "dataset-patch-apply",
    "--input",
    sourceRowsFile ?? "<source-rows.jsonl>",
    "--patch",
    relOrNull(repoRoot, patchFile),
    "--out",
    relOrNull(repoRoot, patchedRowsFile),
    "--out-dir",
    relOrNull(repoRoot, applyDir),
    "--authoring-package-dir",
    relOrNull(repoRoot, packageDir),
    "--require-authoring-package",
    "--require-action-item-closure",
  ];
  const task = {
    schema_version: 1,
    generated_at_utc: nowIso(),
    status:
      actionItems.length > 0 && contextBlockers.length > 0
        ? "blocked_missing_full_context"
        : actionItems.length > 0
          ? "ready_for_ai_authoring"
          : "ready_no_action_items",
    purpose:
      "Use Codex/skill semantic judgment to turn one Foundry AI authoring package into a strict structured patch. Deterministic CLI apply and validation remain separate gates.",
    entity: {
      dataset_type: datasetType,
      entity_id: entityId,
      version: asText(packagePayload.version) || "00.00.001",
      profile: asText(packagePayload.profile) || null,
    },
    context: {
      source_rows_file: sourceRowsFile,
      authoring_package_sha256: sha256Text(readText(packagePath)),
      profile_context_files: packageContextFileSummary(packagePayload.profile_context_files),
      contract_context_files: packageContextFileSummary(packagePayload.contract_context_files),
      full_context_ai_completion: packagePayload.full_context_ai_completion ?? {
        required: false,
      },
      missing_context_files: ensureArray(packagePayload.missing_context_files),
      curation_queue_status: packagePayload.curation_queue_context?.status ?? null,
    },
    action_items: actionItems,
    decision_only_action_items: decisionOnlyItems,
    blockers: contextBlockers,
    counts: {
      action_items: actionItems.length,
      decision_only_action_items: decisionOnlyItems.length,
      blockers: contextBlockers.length,
    },
    policy: {
      database_write: "forbidden_in_ai_authoring_task",
      ai_output: "structured_patch_json_only",
      decision_only_action_items:
        "Identity, classification, and location action items are not patchable here; resolve them with the dedicated deterministic decision apply commands.",
      unresolved_trace:
        "If a value cannot be inferred safely and the action item allows deferral, record structured tiangongfoundry:unresolvedTrace under common:other. Mandatory schema fields need evidence-backed values or remain blocked.",
      source_language:
        "Preserve source-language content. For TIDAS-required multilingual fields, add an evidence-backed English variant from full task context before write planning.",
    },
    files: {
      authoring_package: repoRelativePath(repoRoot, packagePath),
      task_json: repoRelativePath(repoRoot, taskFile),
      task_markdown: repoRelativePath(repoRoot, markdownFile),
      patch_template: repoRelativePath(repoRoot, patchTemplateFile),
      output_patch_file: repoRelativePath(repoRoot, patchFile),
      patched_rows: repoRelativePath(repoRoot, patchedRowsFile),
      apply_dir: repoRelativePath(repoRoot, applyDir),
    },
    commands: {
      apply_patch: applyArgs.map(shellQuote).join(" "),
      validate_after_apply: `node scripts/foundry.mjs dataset-tidas-validate --type ${datasetType} --rows-file ${shellQuote(repoRelativePath(repoRoot, patchedRowsFile))} --out-dir ${shellQuote(path.join(repoRelativePath(repoRoot, outDir), "dataset-validate"))}`,
    },
  };

  fs.mkdirSync(outDir, { recursive: true });
  writeJson(patchTemplateFile, patchTemplate);
  writeJson(taskFile, task);
  writeText(markdownFile, renderAuthoringTaskMarkdown(task));
  return {
    ...task,
    files: task.files,
  };
}

export function shouldBuildAuthoringTaskFromEntity(entity, includeReady) {
  if (includeReady) return true;
  const actionItemCount = Number(entity?.action_item_count ?? entity?.actionItemCount ?? 0);
  if (actionItemCount > 0) return true;
  return String(entity?.status ?? "").includes("needs_foundry_ai_authoring");
}

export function authoringPackageEntriesFromGate(repoRoot, reportPath, includeReady) {
  const report = readJson(reportPath);
  const entities = ensureArray(
    report?.entities ?? report?.processes ?? report?.flows ?? report?.items,
  );
  return entities
    .filter((entity) => shouldBuildAuthoringTaskFromEntity(entity, includeReady))
    .map((entity, index) => {
      const packageRef = asText(entity?.authoring_package ?? entity?.authoringPackage);
      const packagePath = resolveRepoPath(repoRoot, packageRef);
      const datasetType = asText(entity?.dataset_type ?? entity?.type) || "dataset";
      const entityId =
        asText(entity?.entity_id ?? entity?.process_id ?? entity?.id) || `entity-${index + 1}`;
      return {
        index,
        entity,
        package_ref: packageRef || null,
        package_path: packagePath,
        task_dir_name: `${sanitizeFileName(datasetType)}-${sanitizeFileName(entityId)}`,
      };
    });
}

export function buildSharedAuthoringContextBundle(repoRoot, outDir, tasks, source, options = {}) {
  const fileMap = new Map();
  const references = [];
  for (const task of tasks) {
    const packageRef = task.files?.authoring_package;
    const packagePath = resolveRepoPath(repoRoot, packageRef);
    if (!packagePath || !fileExists(packagePath)) continue;
    const stablePackageRef = packageRef ? path.basename(packageRef) : null;
    let packagePayload = null;
    try {
      packagePayload = readJson(packagePath);
    } catch {
      continue;
    }
    for (const [scope, contextFiles] of [
      ["profile_context_files", packagePayload.profile_context_files],
      ["contract_context_files", packagePayload.contract_context_files],
    ]) {
      for (const contextFile of ensureArray(contextFiles)) {
        const text = String(contextFile?.text ?? "");
        const sha256 = asText(contextFile?.sha256) || sha256Text(text);
        const bytes = Number(contextFile?.bytes) || Buffer.byteLength(text, "utf8");
        const kind = asText(contextFile?.kind) || "context";
        const contextPath = asText(contextFile?.path) || null;
        const key = JSON.stringify([scope, kind, contextPath, sha256]);
        if (!fileMap.has(key)) {
          fileMap.set(key, {
            scope,
            kind,
            path: contextPath,
            sha256,
            bytes,
            text,
          });
        }
        references.push({
          authoring_package: stablePackageRef,
          authoring_package_sha256: task.context?.authoring_package_sha256 ?? null,
          dataset_type: task.entity?.dataset_type ?? null,
          entity_id: task.entity?.entity_id ?? null,
          dataset_version: task.entity?.version ?? null,
          scope,
          kind,
          path: contextPath,
          sha256,
          bytes,
        });
      }
    }
  }
  const files = [...fileMap.values()];
  const uniqueBytes = files.reduce((total, file) => total + (Number(file.bytes) || 0), 0);
  const referenceBytes = references.reduce((total, ref) => total + (Number(ref.bytes) || 0), 0);
  const stablePayload = {
    schema_version: 1,
    kind: "tiangong_foundry_shared_authoring_context_bundle",
    source,
    counts: {
      tasks: tasks.length,
      authoring_packages: unique(
        tasks.map((task) => path.basename(task.files?.authoring_package ?? "")).filter(Boolean),
      ).length,
      files: files.length,
      references: references.length,
      duplicate_references: Math.max(0, references.length - files.length),
      unique_context_bytes: uniqueBytes,
      referenced_context_bytes: referenceBytes,
      duplicate_context_bytes_avoided: Math.max(0, referenceBytes - uniqueBytes),
    },
    files,
    references,
  };
  const bundle = {
    ...stablePayload,
    generated_at_utc: nowIso(),
    hash_scope:
      "schema_version, kind, source, counts, files, and references; generated_at_utc is excluded so identical batch context keeps a stable hash.",
    sha256: sha256Text(JSON.stringify(stablePayload)),
  };
  const cacheDir = options.sharedContextCacheDir
    ? resolveRepoPath(repoRoot, options.sharedContextCacheDir)
    : null;
  const bundlePath = cacheDir
    ? path.join(cacheDir, `authoring.${bundle.sha256}.json`)
    : path.join(outDir, "shared-context-bundle.json");
  let cacheReused = false;
  if (cacheDir && fileExists(bundlePath)) {
    try {
      cacheReused = readJson(bundlePath)?.sha256 === bundle.sha256;
    } catch {
      cacheReused = false;
    }
  }
  if (!cacheReused) writeJson(bundlePath, bundle);
  return {
    path: bundlePath,
    bundle,
    cache: cacheDir
      ? {
          enabled: true,
          dir: repoRelativePath(repoRoot, cacheDir),
          reused: cacheReused,
        }
      : {
          enabled: false,
          reused: false,
        },
  };
}

export function attachSharedContextBundleToTask(task, sharedContextBundle) {
  return {
    ...task,
    context: {
      ...task.context,
      shared_context_bundle: sharedContextBundle,
    },
  };
}

export function rewriteAuthoringTaskFile(repoRoot, task) {
  const taskFile = resolveRepoPath(repoRoot, task?.files?.task_json);
  const markdownFile = resolveRepoPath(repoRoot, task?.files?.task_markdown);
  if (taskFile) writeJson(taskFile, task);
  if (markdownFile) writeText(markdownFile, renderAuthoringTaskMarkdown(task));
}

export function writeAuthoringTaskBatchManifest(repoRoot, outDir, tasks, source, options = {}) {
  const manifestPath = path.join(outDir, "authoring-task-manifest.json");
  const tasksPath = path.join(outDir, "authoring-tasks.jsonl");
  const batchPatchFile = path.join(outDir, "ai-patches.batch.json");
  const datasetTypes = [...new Set(tasks.map((task) => task.entity.dataset_type).filter(Boolean))];
  const sourceRowsFiles = [
    ...new Set(tasks.map((task) => task.context.source_rows_file).filter(Boolean)),
  ];
  const packageDirs = [
    ...new Set(
      tasks
        .map((task) => resolveRepoPath(repoRoot, task.files.authoring_package))
        .filter(Boolean)
        .map((filePath) => repoRelativePath(repoRoot, path.dirname(filePath))),
    ),
  ];
  const totalActionItems = tasks.reduce(
    (total, task) => total + ensureArray(task.action_items).length,
    0,
  );
  const totalDecisionOnlyActionItems = tasks.reduce(
    (total, task) => total + ensureArray(task.decision_only_action_items).length,
    0,
  );
  const canApplyBatch =
    totalActionItems > 0 &&
    datasetTypes.length === 1 &&
    sourceRowsFiles.length === 1 &&
    packageDirs.length === 1;
  const batchPatchedRows = path.join(
    outDir,
    `${datasetTypePlural[datasetTypes[0]] ?? "datasets"}.patched.jsonl`,
  );
  const batchApplyDir = path.join(outDir, "patch-apply");
  const applyBatchArgs = canApplyBatch
    ? [
        "node",
        "scripts/foundry.mjs",
        "dataset-patch-apply",
        "--input",
        sourceRowsFiles[0],
        "--patch",
        repoRelativePath(repoRoot, batchPatchFile),
        "--out",
        repoRelativePath(repoRoot, batchPatchedRows),
        "--out-dir",
        repoRelativePath(repoRoot, batchApplyDir),
        "--authoring-package-dir",
        packageDirs[0],
        "--require-authoring-package",
        "--require-action-item-closure",
      ]
    : [];
  const blockedTasks = tasks.filter((task) => task.status === "blocked_missing_full_context");
  const taskBlockers = tasks.flatMap((task, taskIndex) =>
    task.status === "blocked_missing_full_context"
      ? ensureArray(task.blockers).map((blocker) => ({
          ...blocker,
          task_index: taskIndex,
          entity: task.entity,
        }))
      : [],
  );
  fs.mkdirSync(outDir, { recursive: true });
  const sharedContext = buildSharedAuthoringContextBundle(repoRoot, outDir, tasks, source, options);
  const sharedContextBundleRef = {
    path: repoRelativePath(repoRoot, sharedContext.path),
    sha256: sharedContext.bundle.sha256,
    counts: sharedContext.bundle.counts,
    cache: sharedContext.cache,
    instruction:
      "Read this shared bundle once per batch for full schema/YAML/ruleset/category/location context; per-entity authoring packages still carry source/entity/action evidence and remain the hash-bound proof records.",
  };
  const tasksWithSharedContext = tasks.map((task) =>
    attachSharedContextBundleToTask(task, sharedContextBundleRef),
  );
  for (const task of tasksWithSharedContext) {
    rewriteAuthoringTaskFile(repoRoot, task);
  }
  const manifest = {
    schema_version: 1,
    generated_at_utc: nowIso(),
    status:
      blockedTasks.length > 0
        ? "blocked_missing_full_context"
        : tasks.some((task) => task.status === "ready_for_ai_authoring")
          ? "ready_for_ai_authoring_batch"
          : "ready_no_action_items",
    source,
    counts: {
      tasks: tasks.length,
      ready_for_ai_authoring: tasks.filter((task) => task.status === "ready_for_ai_authoring")
        .length,
      ready_no_action_items: tasks.filter((task) => task.status === "ready_no_action_items").length,
      blocked_missing_full_context: blockedTasks.length,
      action_items: totalActionItems,
      decision_only_action_items: totalDecisionOnlyActionItems,
      blockers: taskBlockers.length,
      shared_context_files: sharedContext.bundle.counts.files,
      shared_context_references: sharedContext.bundle.counts.references,
      duplicate_context_references: sharedContext.bundle.counts.duplicate_references,
      duplicate_context_bytes_avoided: sharedContext.bundle.counts.duplicate_context_bytes_avoided,
    },
    blockers: taskBlockers,
    batch_patch_contract: {
      status:
        totalActionItems === 0
          ? "not_required_no_patch_action_items"
          : canApplyBatch
            ? "available"
            : "not_available_mixed_inputs",
      output_patch_file: canApplyBatch ? repoRelativePath(repoRoot, batchPatchFile) : null,
      patched_rows: canApplyBatch ? repoRelativePath(repoRoot, batchPatchedRows) : null,
      apply_dir: canApplyBatch ? repoRelativePath(repoRoot, batchApplyDir) : null,
      instruction:
        totalActionItems === 0
          ? "No patch batch is required; resolve decision_only_action_items with the dedicated deterministic decision apply commands."
          : "AI/Codex may combine all per-task patch sets into this batch file, then run apply_all_patches once to produce one patched rows file.",
    },
    commands: {
      apply_all_patches: canApplyBatch ? applyBatchArgs.map(shellQuote).join(" ") : null,
    },
    shared_context_bundle: sharedContextBundleRef,
    tasks: tasksWithSharedContext.map((task) => ({
      status: task.status,
      entity: task.entity,
      context: task.context,
      action_item_count: ensureArray(task.action_items).length,
      action_items: task.action_items,
      decision_only_action_item_count: ensureArray(task.decision_only_action_items).length,
      decision_only_action_items: task.decision_only_action_items,
      blockers: ensureArray(task.blockers),
      files: task.files,
      commands: task.commands,
    })),
  };
  writeJson(manifestPath, manifest);
  writeText(tasksPath, jsonLines(manifest.tasks));
  return {
    ...manifest,
    files: {
      manifest: repoRelativePath(repoRoot, manifestPath),
      tasks: repoRelativePath(repoRoot, tasksPath),
      shared_context_bundle: repoRelativePath(repoRoot, sharedContext.path),
    },
  };
}

export function patchSetOperations(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const operations = Array.isArray(value.operations)
    ? value.operations
    : Array.isArray(value.patches)
      ? value.patches
      : null;
  if (!operations || !operations.every((operation) => operation && typeof operation === "object")) {
    return null;
  }
  return operations;
}

export function patchPayloadPatchSets(rawPatch) {
  if (Array.isArray(rawPatch)) return rawPatch;
  if (!rawPatch || typeof rawPatch !== "object") return [];
  if (patchSetOperations(rawPatch)) return [rawPatch];
  for (const key of ["patch_sets", "patchSets", "patches", "suggestions", "items"]) {
    if (Array.isArray(rawPatch[key])) return rawPatch[key];
  }
  return [];
}

export function patchSetDatasetId(patchSet) {
  return asText(patchSet?.dataset_id ?? patchSet?.id ?? patchSet?.uuid ?? patchSet?.entity_id);
}

export function patchSetDatasetVersion(patchSet) {
  return asText(patchSet?.dataset_version ?? patchSet?.version) || "00.00.001";
}

export function patchSetAuthoringPackage(patchSet) {
  return asText(patchSet?.authoring_package ?? patchSet?.authoringPackage);
}

export function operationHasEvidence(operation) {
  const basis = asText(operation?.basis);
  const evidence = operation?.evidence;
  if (basis) return true;
  if (typeof evidence === "string") return evidence.trim().length > 0;
  if (Array.isArray(evidence)) return evidence.length > 0;
  if (evidence && typeof evidence === "object") return Object.keys(evidence).length > 0;
  return false;
}

export function taskRequiresFullContextEvidence(task) {
  return (
    task?.context?.full_context_ai_completion?.required === true ||
    task?.context?.fullContextAiCompletion?.required === true
  );
}

export function evidenceEntries(value) {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null) return [];
  return [value];
}

export function firstNonEmptyEvidenceValue(entry, keys) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return "";
  for (const key of keys) {
    const value = asText(entry[key]);
    if (value) return value;
  }
  return "";
}

export const evidenceSourceKeys = [
  "source",
  "source_id",
  "sourceId",
  "source_file",
  "sourceFile",
  "context_kind",
  "contextKind",
  "citation",
  "cited_source",
  "citedSource",
  "provenance",
];

export const evidenceTraceKeys = [
  "quote_or_trace",
  "quoteOrTrace",
  "quote",
  "trace",
  "source_trace",
  "sourceTrace",
  "source_path",
  "sourcePath",
  "source_field",
  "sourceField",
  "field_path",
  "fieldPath",
  "json_pointer",
  "jsonPointer",
  "path",
  "evidence_path",
  "evidencePath",
  "pointer",
  "note",
  "excerpt",
];

export function operationFullContextEvidenceBlockers({ operation, task }) {
  if (!taskRequiresFullContextEvidence(task)) return [];
  const blockers = [];
  if (!asText(operation?.basis)) {
    blockers.push({
      code: "patch_basis_required_full_context",
      message:
        "Full-context AI patch operations must include basis explaining why the value follows from the package/context.",
    });
  }
  const structuredEntries = evidenceEntries(operation?.evidence).filter(
    (entry) => entry && typeof entry === "object" && !Array.isArray(entry),
  );
  if (structuredEntries.length === 0) {
    blockers.push({
      code: "patch_structured_evidence_required_full_context",
      message:
        "Full-context AI patch operations require structured evidence; a free-text basis alone is invalid.",
    });
    return blockers;
  }
  const hasEvidencePointer = structuredEntries.some(
    (entry) =>
      firstNonEmptyEvidenceValue(entry, evidenceSourceKeys) &&
      firstNonEmptyEvidenceValue(entry, evidenceTraceKeys),
  );
  if (!hasEvidencePointer) {
    blockers.push({
      code: "patch_structured_evidence_incomplete_full_context",
      message:
        "Full-context AI patch evidence must include both a source/context identifier and a quote, trace, field path, citation, or equivalent pointer.",
    });
  }
  return blockers;
}

export function operationResolution(operation) {
  return operation?.resolution &&
    typeof operation.resolution === "object" &&
    !Array.isArray(operation.resolution)
    ? operation.resolution
    : null;
}

export function operationResolutionMode(operation) {
  return asText(operationResolution(operation)?.mode);
}

export function operationUsedContextKinds(operation) {
  return ensureArray(
    operationResolution(operation)?.used_context_kinds ??
      operationResolution(operation)?.usedContextKinds,
  )
    .map((kind) => asText(kind))
    .filter(Boolean);
}

export function taskRequiredContextKinds(task) {
  const kinds = new Set(
    ensureArray(task?.context?.contract_context_files)
      .map((file) => asText(file?.kind))
      .filter(Boolean),
  );
  const requiredKinds = ensureArray(
    task?.context?.full_context_ai_completion?.required_context_kinds ??
      task?.context?.fullContextAiCompletion?.requiredContextKinds,
  )
    .map((kind) => asText(kind))
    .filter(Boolean);
  const candidates =
    requiredKinds.length > 0
      ? requiredKinds
      : ["schema", "methodology_yaml", "ruleset", "classification_schema", "location_schema"];
  return candidates.filter((kind) => kinds.has(kind) || requiredKinds.includes(kind));
}

export function operationTouchesCommonOther(operation) {
  const pointer = asText(operation?.path);
  if (pointer.includes("/common:other") || pointer.includes("/tiangongfoundry:")) return true;
  return (
    JSON.stringify(operation?.value ?? "").includes("common:other") ||
    JSON.stringify(operation?.value ?? "").includes("tiangongfoundry:")
  );
}

export function hasNonEmptyTraceEvidence(value) {
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.some((item) => hasNonEmptyTraceEvidence(item));
  if (value && typeof value === "object") return Object.keys(value).length > 0;
  return false;
}

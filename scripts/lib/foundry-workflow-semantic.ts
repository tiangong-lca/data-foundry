import fs from "node:fs";
import path from "node:path";
import {
  FoundryContextError,
  readFoundryInput,
  resolveFoundryOutput,
  type FoundryRuntimeContext,
} from "./foundry-runtime-context.ts";
import {
  assertQualifiedFoundryRuntime,
  type QualifiedFoundryRuntime,
} from "./foundry-runtime-qualification.ts";
import {
  assertSelectedSemanticInput,
  readSelectedSemanticBytes,
  type SelectedSemanticInput,
} from "./foundry-semantic-input.ts";
import {
  currentWorkflowState,
  readWorkflowArtifact,
  workflowObject,
  type WorkflowRowSet,
} from "./foundry-workflow-state.ts";
import { runFoundryTaskOperation } from "./foundry-task-store.ts";
import type { ArtifactEntry } from "./foundry-task-types.ts";
import {
  createWorkflowStageDirectory,
  createWorkflowDirectory,
  registerWorkflowStageFiles,
  runWorkflowLocalCliResult,
} from "./foundry-workflow-io.ts";
import { runDatasetAuthoringPatchCollect } from "./import-curation/patch-collect.ts";
import { readJsonOrJsonl, ensureArray, readRows } from "./import-curation/internal/runtime-io.ts";
import { createFoundryDecisionOwners } from "./foundry-decision-owners.ts";
import { applyFoundryIdentityDecisions } from "./foundry-workflow-identity-apply.ts";
import {
  operationFullContextEvidenceBlockers,
  operationUsedContextKinds,
  patchPayloadPatchSets,
  patchSetOperations,
  taskRequiredContextKinds,
} from "./import-curation/internal/workflow-authoring-tasks.ts";

function fail(code: string, message: string): never {
  throw new FoundryContextError(code, message);
}
function text(value: unknown, label: string): string {
  if (typeof value !== "string" || !value) fail("semantic_work_invalid", `${label} is missing.`);
  return value;
}

function priorApplication(
  context: FoundryRuntimeContext,
  entries: readonly ArtifactEntry[],
  submission: SelectedSemanticInput,
): Record<string, unknown> | null {
  for (const entry of [...entries].reverse()) {
    if (
      entry.command !== "dataset-semantic-apply" ||
      path.basename(entry.path) !== "semantic-result.json"
    )
      continue;
    const value = readWorkflowArtifact(context, entry).value;
    if (value.status === "completed" && value.submission_sha256 === submission.descriptor.sha256)
      return value;
  }
  return null;
}

export async function applyFoundrySemanticInput(
  context: FoundryRuntimeContext,
  qualified: QualifiedFoundryRuntime,
  entries: readonly ArtifactEntry[],
  submission: SelectedSemanticInput,
) {
  assertSelectedSemanticInput(submission);
  assertQualifiedFoundryRuntime(context, qualified);
  const prior = priorApplication(context, entries, submission);
  if (prior) return prior;
  const state = currentWorkflowState(context, entries);
  if (
    !state.rows ||
    !state.assessment ||
    state.assessment.entry.sha256 !== submission.spec.assessment_sha256
  )
    fail("semantic_assessment_mismatch", "Submit against the current assessed row version.");
  const rows = state.rows,
    assessment = state.assessment;
  const selected = new Map(
    submission.spec.submissions.map((part, index) => [
      part.authoring_task_sha256,
      { part, fact: submission.files[index] },
    ]),
  );
  const used = new Set<string>();
  const decisionWork: Array<{
    kind: "classification" | "location" | "identity";
    type: string;
    rows: string;
    task: string;
    queue: string | null;
    sha: string;
    fact: typeof submission.descriptor;
  }> = [];
  const work: Array<{
    set: Record<string, unknown>;
    manifest: Record<string, unknown>;
    manifestFile: string;
    tasks: Array<{
      task: Record<string, unknown>;
      sha: string;
      fact: typeof submission.descriptor;
    }>;
  }> = [];
  for (const set of assessment.value.sets) {
    const manifestFile = text(set.authoring_manifest, "Authoring manifest");
    const manifest = workflowObject(
      JSON.parse(readFoundryInput(context, manifestFile).toString("utf8")),
    );
    if (!Array.isArray(manifest.tasks))
      fail("semantic_work_invalid", "Authoring tasks are missing.");
    const tasks: (typeof work)[number]["tasks"] = [];
    for (const raw of manifest.tasks) {
      const task = workflowObject(raw),
        files = workflowObject(task.files);
      const taskFile = path.resolve(
        assessment.value.owner_base,
        text(files.task_json, "Authoring task"),
      );
      const entry = entries.find(
        (candidate) => resolveFoundryOutput(context, candidate.path) === taskFile,
      );
      if (!entry)
        fail("semantic_work_unregistered", "Authoring work is not registered in this task.");
      const chosen = selected.get(entry.sha256);
      if (!chosen || chosen.part.kind !== "patch") continue;
      readFoundryInput(context, taskFile);
      if (task.status !== "ready_for_ai_authoring" || Number(task.action_item_count ?? 0) < 1)
        fail(
          "semantic_work_not_patchable",
          "The selected item requires its dedicated decision owner or more context.",
        );
      if (used.has(entry.sha256))
        fail("semantic_work_ambiguous", "A submitted work item is ambiguous.");
      used.add(entry.sha256);
      tasks.push({ task, sha: entry.sha256, fact: chosen.fact });
    }
    if (tasks.length) work.push({ set, manifest, manifestFile, tasks });
    for (const raw of Array.isArray(set.decisions) ? set.decisions : []) {
      const decision = workflowObject(raw);
      if (
        decision.kind !== "classification" &&
        decision.kind !== "location" &&
        decision.kind !== "identity"
      )
        continue;
      const taskFile = text(decision.task, "Decision task");
      const entry = entries.find(
        (candidate) => resolveFoundryOutput(context, candidate.path) === taskFile,
      );
      if (!entry) fail("semantic_work_unregistered", "Decision work is not registered.");
      const chosen = selected.get(entry.sha256);
      if (!chosen) continue;
      if (chosen.part.kind !== decision.kind || used.has(entry.sha256))
        fail("semantic_work_mismatch", "Submission kind differs from the current decision owner.");
      if (decision.status !== `ready_for_ai_${decision.kind}_decisions`)
        fail(
          "semantic_work_not_ready",
          "Decision work requires its missing context before submission.",
        );
      used.add(entry.sha256);
      decisionWork.push({
        kind: decision.kind,
        type: text(set.type, "Dataset type"),
        rows: text(set.rows, "Rows"),
        task: taskFile,
        queue: decision.kind === "identity" ? null : text(decision.queue, "Decision queue"),
        sha: entry.sha256,
        fact: chosen.fact,
      });
    }
  }
  if (used.size !== selected.size)
    fail(
      "semantic_work_mismatch",
      "Every submitted digest must identify current registered authoring work.",
    );
  const rowOwners = new Set(work.map((group) => text(group.set.type, "Dataset type")));
  if (
    decisionWork.some((item) => item.kind === "identity") &&
    (decisionWork.length !== 1 || work.length)
  )
    fail(
      "task_semantic_owner_conflict",
      "Submit one identity task at a time; reference rewrites may affect multiple row types.",
    );
  for (const item of decisionWork) {
    if (rowOwners.has(item.type))
      fail(
        "task_semantic_owner_conflict",
        "Submit one decision/patch owner per row set, then reassess before the next owner.",
      );
    rowOwners.add(item.type);
  }
  return runFoundryTaskOperation(
    context,
    {
      command: "dataset-semantic-apply",
      options: {
        submission: submission.descriptor,
        files: submission.files,
        assessment: assessment.entry.sha256,
      },
      validateCurrent(index) {
        const current = currentWorkflowState(context, index);
        if (
          current.assessment?.entry.sha256 !== assessment.entry.sha256 ||
          current.rows?.entry.sha256 !== rows.entry.sha256
        )
          fail(
            "semantic_assessment_changed",
            "Assessment advanced before this submission acquired the task lock.",
          );
      },
    },
    (operation) => {
      assertSelectedSemanticInput(submission);
      assertQualifiedFoundryRuntime(context, qualified);
      for (const input of context.inputs) readFoundryInput(context, input.path);
      const output = createWorkflowStageDirectory(context, operation, "semantic");
      fs.mkdirSync(resolveFoundryOutput(context, "tmp"), { recursive: true, mode: 0o700 });
      const temporary = createWorkflowDirectory(context, path.join(context.tempRoot, "semantic-"));
      const updated = new Map<string, WorkflowRowSet>();
      const identityReports = [...rows.value.identity_reports],
        rewriteReports = [...rows.value.identity_rewrite_reports];
      const results: Array<Record<string, unknown>> = [];
      const blockers: Array<Record<string, unknown>> = [];
      try {
        operation.writeText(
          path.join(output, "submission.json"),
          readSelectedSemanticBytes(submission.descriptor),
        );
        for (const group of work) {
          const type = text(group.set.type, "Dataset type");
          const previousBlockers = blockers.length;
          const projected = structuredClone(group.manifest);
          projected.tasks = group.tasks.map(({ task, sha, fact }) => {
            const snapshot = path.join(output, "inputs", `${sha}.json`);
            const bytes = readSelectedSemanticBytes(fact);
            operation.writeText(snapshot, bytes);
            const strictTask = {
              ...task,
              context: {
                ...workflowObject(task.context),
                full_context_ai_completion: { required: true },
              },
            };
            const requiredKinds = taskRequiredContextKinds(task);
            let payload: unknown;
            try {
              payload = JSON.parse(bytes.toString("utf8"));
            } catch {
              blockers.push({ code: "semantic_patch_json_invalid", type, work_item: sha });
            }
            for (const patch of patchPayloadPatchSets(payload)) {
              for (const patchOperation of patchSetOperations(patch) ?? []) {
                if (patchOperation.op === "test") continue;
                blockers.push(
                  ...operationFullContextEvidenceBlockers({
                    operation: patchOperation,
                    task: strictTask,
                  }),
                );
                const usedKinds = operationUsedContextKinds(patchOperation);
                if (requiredKinds.some((kind) => !usedKinds.includes(kind)))
                  blockers.push({
                    code: "semantic_context_evidence_missing",
                    type,
                    work_item: sha,
                  });
              }
            }
            return {
              ...structuredClone(task),
              files: { ...workflowObject(task.files), output_patch_file: snapshot },
            };
          });
          const projectedFile = path.join(output, type, "selected-work.json");
          operation.writeJson(projectedFile, projected);
          if (blockers.length !== previousBlockers) continue;
          const collection = runDatasetAuthoringPatchCollect({
            repoRoot: assessment.value.owner_base,
            options: {
              taskManifest: projectedFile,
              outDir: path.join(output, type, "collect"),
              out: path.join(output, type, "collected-patches.json"),
            },
          });
          if (
            collection.status !== "ready_for_patch_apply" ||
            !Array.isArray(collection.blockers) ||
            collection.blockers.length
          ) {
            blockers.push({ code: "semantic_patch_invalid", type, collection });
            continue;
          }
          const originalRows = text(group.set.rows, "Assessed rows");
          const packageDirectories = new Set(
            group.tasks.map(({ task }) =>
              path.dirname(
                path.resolve(
                  assessment.value.owner_base,
                  text(workflowObject(task.files).authoring_package, "Authoring package"),
                ),
              ),
            ),
          );
          if (packageDirectories.size !== 1)
            fail(
              "semantic_work_invalid",
              "Selected work must share its registered package snapshot directory.",
            );
          const repaired = path.join(output, type, "repaired.rows.jsonl");
          const applied = runWorkflowLocalCliResult(context, qualified, temporary, [
            "dataset",
            "patch",
            "apply",
            "--input",
            originalRows,
            "--patch",
            path.join(output, type, "collected-patches.json"),
            "--out",
            repaired,
            "--out-dir",
            path.join(output, type, "apply"),
            "--authoring-package-dir",
            [...packageDirectories][0],
            "--require-authoring-package",
            "--require-action-item-closure",
            "--json",
          ]);
          if (
            applied.exit !== 0 ||
            applied.report.status !== "completed" ||
            !Array.isArray(applied.report.blockers) ||
            applied.report.blockers.length
          ) {
            blockers.push({ code: "semantic_apply_blocked", type, report: applied.report });
            continue;
          }
          const original = rows.value.sets.find(
            (set) => set.type === type && set.file === originalRows,
          );
          if (!original || Number(applied.report.row_count) !== original.count)
            fail("semantic_row_scope_changed", "Patch application changed the assessed row scope.");
          updated.set(type, { ...original, file: repaired });
          results.push({
            type,
            original_rows: originalRows,
            repaired_rows: repaired,
            applied_operations: applied.report.applied_operation_count,
            closed_actions: applied.report.closed_action_item_count,
          });
        }
        const decisionOwners = createFoundryDecisionOwners(context, qualified, temporary);
        for (const item of decisionWork) {
          const beforeCount = blockers.length;
          const bytes = readSelectedSemanticBytes(item.fact);
          operation.writeText(path.join(output, "inputs", `${item.sha}.submitted`), bytes);
          const task = workflowObject(
            JSON.parse(readFoundryInput(context, item.task).toString("utf8")),
          );
          const requiredKinds = taskRequiredContextKinds({
            context: { contract_context_files: task.contract_context_files },
          });
          let decisions: unknown[] = [];
          try {
            decisions = ensureArray(readJsonOrJsonl(item.fact.path, () => bytes.toString("utf8")));
          } catch {
            blockers.push({ code: "semantic_decisions_invalid_json", type: item.type });
          }
          for (const value of decisions) {
            const decision = workflowObject(value);
            blockers.push(
              ...operationFullContextEvidenceBlockers({
                operation: decision,
                task: { context: { full_context_ai_completion: { required: true } } },
              }),
            );
            const kinds = Array.isArray(decision.used_context_kinds)
              ? decision.used_context_kinds
              : [];
            if (requiredKinds.some((kind) => !kinds.includes(kind)))
              blockers.push({ code: "semantic_context_evidence_missing", type: item.type });
          }
          if (blockers.length !== beforeCount) continue;
          if (item.kind === "identity") {
            const applied = applyFoundryIdentityDecisions(context, qualified, temporary, {
              task,
              decisions,
              sets: rows.value.sets,
              output: path.join(output, "identity"),
            });
            blockers.push(...applied.blockers);
            identityReports.push(...applied.reports);
            rewriteReports.push(...applied.rewriteReports);
            for (const set of applied.sets) updated.set(set.type, set);
            results.push({
              kind: "identity",
              reports: applied.reports,
              rewrite_reports: applied.rewriteReports,
            });
            continue;
          }
          const decisionFile = path.join(output, item.type, `${item.kind}-decisions.jsonl`);
          operation.writeText(
            decisionFile,
            decisions.map((value) => JSON.stringify(value)).join("\n") + "\n",
          );
          const repaired = path.join(output, item.type, "repaired.rows.jsonl");
          const options = {
            [`${item.kind}Queue`]: item.queue,
            decisions: decisionFile,
            decisionTask: item.task,
            rowsFile: item.rows,
            out: repaired,
            outDir: path.join(output, item.type, item.kind),
          };
          const applied = workflowObject(
            decisionOwners.invoke(() =>
              item.kind === "classification"
                ? decisionOwners.classification.runDatasetClassificationDecisionsApply(
                    options as never,
                  )
                : decisionOwners.location.runDatasetLocationDecisionsApply(options as never),
            ),
          );
          if (
            applied.status !== "completed" ||
            !Array.isArray(applied.blockers) ||
            applied.blockers.length
          ) {
            blockers.push({
              code: "semantic_decision_apply_blocked",
              type: item.type,
              kind: item.kind,
              report: applied,
            });
            continue;
          }
          const original = rows.value.sets.find(
            (set) => set.type === item.type && set.file === item.rows,
          );
          if (!original || !fs.existsSync(repaired) || readRows(repaired).length !== original.count)
            fail("semantic_row_scope_changed", "Decision application changed row scope.");
          updated.set(item.type, { ...original, file: repaired });
          results.push({
            kind: item.kind,
            type: item.type,
            original_rows: item.rows,
            repaired_rows: repaired,
            report: applied,
          });
        }
        assertSelectedSemanticInput(submission);
        for (const input of context.inputs) readFoundryInput(context, input.path);
        assertQualifiedFoundryRuntime(context, qualified);
        registerWorkflowStageFiles(context, operation, output);
        if (!blockers.length)
          operation.writeJson(path.join(output, "foundry-rows.json"), {
            schema: "tiangong-foundry.rows-stage.v1",
            status: "completed",
            predecessor: rows.file,
            sets: rows.value.sets
              .map((set) => updated.get(set.type) ?? set)
              .filter((set) => set.count > 0),
            identity_reports: identityReports,
            identity_rewrite_reports: rewriteReports,
          });
        const report = {
          schema: "tiangong-foundry.semantic-result.v1",
          status: blockers.length ? "blocked" : "completed",
          submission_sha256: submission.descriptor.sha256,
          assessment_sha256: assessment.entry.sha256,
          work_items: [...used],
          results,
          blockers,
        };
        operation.writeJson(path.join(output, "semantic-result.json"), report);
        return report;
      } finally {
        fs.rmSync(temporary, { recursive: true, force: true });
      }
    },
  );
}

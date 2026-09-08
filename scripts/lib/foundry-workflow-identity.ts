import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
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
  verifyFoundryRuntimeIdentity,
  type FoundryAuthentication,
} from "./foundry-runtime-identity.ts";
import { createFoundryAuthenticationEnvironment } from "./foundry-authentication-environment.ts";
import { createFoundryIdentityOwners } from "./foundry-identity-owners.ts";
import { currentWorkflowState, workflowObject } from "./foundry-workflow-state.ts";
import { runFoundryTaskOperation, withFoundryTaskMetadata } from "./foundry-task-store.ts";
import { registerWorkflowStageFiles } from "./foundry-workflow-io.ts";
import { datasetIdentity } from "./import-curation/internal/dataset-payload.ts";
import { readRows } from "./import-curation/internal/runtime-io.ts";
import type { ArtifactEntry } from "./foundry-task-types.ts";

/** Run the existing read-only owner first; the local transaction only records its captured evidence. */
export async function runFoundryWorkflowIdentity(
  context: FoundryRuntimeContext,
  qualified: QualifiedFoundryRuntime,
  entries: readonly ArtifactEntry[],
  authentication: FoundryAuthentication = { mode: "oauth" },
) {
  assertQualifiedFoundryRuntime(context, qualified);
  const state = currentWorkflowState(context, entries),
    rows = state.rows;
  if (!rows || !state.assessment)
    throw new FoundryContextError(
      "workflow_rows_required",
      "Assess the current rows before identity preflight.",
    );
  if (!context.accountIntent)
    throw new FoundryContextError(
      "needs_auth",
      "Identity preflight requires a task spec with the intended project and user account.",
    );
  await withFoundryTaskMetadata(context, (_, index) => {
    if (currentWorkflowState(context, index).rows?.entry.sha256 !== rows.entry.sha256)
      throw new FoundryContextError(
        "workflow_identity_rows_changed",
        "Current rows changed before identity preflight.",
      );
  });
  const identity = verifyFoundryRuntimeIdentity(context, authentication, process.env, qualified);
  const nonce = randomUUID();
  const output = resolveFoundryOutput(context, `outputs/identity/${nonce}`);
  const temporary = resolveFoundryOutput(context, `tmp/identity-${nonce}`);
  fs.mkdirSync(output, { recursive: true, mode: 0o700 });
  fs.mkdirSync(temporary, { recursive: true, mode: 0o700 });
  const environment = createFoundryAuthenticationEnvironment(
    authentication,
    context.accountIntent.sessionReference,
    process.env,
  );
  environment.FOUNDRY_VERIFIED_PROJECT_REF = context.accountIntent.projectRef;
  environment.FOUNDRY_VERIFIED_USER_ID = context.accountIntent.userId;
  const receipt = path.join(temporary, "identity-receipt.json");
  fs.writeFileSync(receipt, JSON.stringify(identity.receipt), { mode: 0o600 });
  const sets: Array<Record<string, unknown>> = [],
    blockers: unknown[] = [];
  try {
    for (const input of context.inputs) readFoundryInput(context, input.path);
    for (const set of rows.value.sets) {
      if (set.type !== "flow" && set.type !== "process") continue;
      readFoundryInput(context, set.file);
      const owner = createFoundryIdentityOwners(context, qualified, set.type, {
        environment,
        cwd: temporary,
      });
      const outDir = path.join(output, set.type);
      fs.mkdirSync(outDir, { recursive: true });
      const sourceIndex = path.join(outDir, "source-context.jsonl");
      fs.writeFileSync(
        sourceIndex,
        readRows(set.file)
          .map((row) => {
            const selected = datasetIdentity(row, 0, set.type);
            return JSON.stringify({
              dataset_type: set.type,
              dataset_id: selected.id,
              dataset_version: selected.version,
              source_file: set.file,
            });
          })
          .join("\n") + "\n",
      );
      const prepared = workflowObject(
        owner.invoke(() =>
          owner.preflight.runDatasetIdentityPreflightRequestsBuild({
            type: set.type,
            rowsFile: set.file,
            sourceIndex,
            outDir,
          }),
        ),
      );
      const files = workflowObject(prepared.files);
      const index = path.resolve(context.assetRoot, String(files.identity_preflight_requests));
      const audited = workflowObject(
        owner.invoke(() =>
          owner.preflight.runDatasetIdentityPreflightQueryAudit({
            index,
            outDir: path.join(outDir, "query-audit"),
          }),
        ),
      );
      if (prepared.status !== "ready" || audited.status !== "passed") {
        blockers.push({
          code: "identity_query_requires_input",
          type: set.type,
          prepare: prepared.blockers,
          audit: audited.blockers,
        });
        continue;
      }
      const result = workflowObject(
        owner.invoke(() =>
          owner.preflight.runDatasetIdentityPreflightRun({
            index,
            outDir: path.join(outDir, "run"),
            authReceipt: receipt,
            expectedProjectRef: context.accountIntent!.projectRef,
            expectedUserId: context.accountIntent!.userId,
            maxAttempts: 1,
            timeoutMs: 60_000,
          }),
        ),
      );
      if (!["completed", "completed_with_identity_findings"].includes(String(result.status)))
        blockers.push({ code: "identity_preflight_failed", type: set.type, report: result });
      sets.push({
        type: set.type,
        rows: set.file,
        index,
        status: result.status,
        report: workflowObject(result.files).report,
      });
    }
    for (const input of context.inputs) readFoundryInput(context, input.path);
    assertQualifiedFoundryRuntime(context, qualified);
    let combinedIndex = sets.length ? String(sets[0].index) : null;
    if (!blockers.length && sets.length > 1) {
      const owner = createFoundryIdentityOwners(context, qualified, "flow", {
        environment,
        cwd: temporary,
      });
      const merged = workflowObject(
        owner.invoke(() =>
          owner.preflight.runDatasetIdentityPreflightIndexMerge({
            baseIndex: combinedIndex,
            updateIndex: sets.slice(1).map((set) => set.index),
            outDir: path.join(output, "combined"),
          }),
        ),
      );
      const file = workflowObject(merged.files).merged_index;
      if (typeof file !== "string")
        blockers.push({ code: "identity_index_merge_failed", report: merged });
      else combinedIndex = path.resolve(context.assetRoot, file);
    }
    return await runFoundryTaskOperation(
      context,
      {
        command: "dataset-workflow-identity",
        options: { nonce, rows_report: rows.file },
        validateCurrent(index) {
          if (currentWorkflowState(context, index).rows?.entry.sha256 !== rows.entry.sha256)
            throw new FoundryContextError(
              "workflow_identity_rows_changed",
              "Rows changed during identity preflight; assess and query their current version.",
            );
        },
      },
      (operation) => {
        registerWorkflowStageFiles(context, operation, output);
        const report = {
          schema: "tiangong-foundry.identity-stage.v1",
          status: blockers.length ? "blocked" : "completed",
          rows_report: rows.file,
          account: {
            project_ref: context.accountIntent!.projectRef,
            user_id: context.accountIntent!.userId,
          },
          checked_at_utc: new Date().toISOString(),
          index: combinedIndex,
          sets,
          blockers,
        };
        operation.writeJson(path.join(output, "foundry-identity.json"), report);
        return report;
      },
    );
  } finally {
    delete environment.TIANGONG_LCA_ACCESS_TOKEN;
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

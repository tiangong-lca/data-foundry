import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  captureFoundryInput,
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
import {
  createFoundryIsolatedChildEnvironment,
  copyFoundryIsolatedExecutable,
} from "./foundry-runtime-environment.ts";
import { createFoundryFinalizeOwners } from "./foundry-finalize-owners.ts";
import {
  currentWorkflowState,
  readWorkflowArtifact,
  workflowObject,
} from "./foundry-workflow-state.ts";
import { runFoundryTaskOperation, withFoundryTaskMetadata } from "./foundry-task-store.ts";
import { registerWorkflowStageFiles } from "./foundry-workflow-io.ts";
import type { ArtifactEntry } from "./foundry-task-types.ts";
import { readTaskBytes } from "./foundry-task-io.ts";
import { loadFoundryTaskAuthorization } from "./foundry-task-authorization.ts";
import type { ValidatedTaskAuthorization } from "./task-authorization.ts";
import { taskAuthorizationMatches } from "./task-authorization.ts";
import { createHash } from "node:crypto";

export async function finalizeFoundryWorkflow(
  context: FoundryRuntimeContext,
  qualified: QualifiedFoundryRuntime,
  entries: readonly ArtifactEntry[],
  authentication: FoundryAuthentication = { mode: "oauth" },
  approval?: {
    sourceSha256: string;
    authorizationSha256: string;
    datasetType: string;
    inputFile: string;
  },
  executionProgress?: { sha256: string; scopes: ReadonlyMap<string, Record<string, unknown>> },
) {
  assertQualifiedFoundryRuntime(context, qualified);
  const state = currentWorkflowState(context, entries),
    rows = state.rows;
  if (!rows || !state.assessment)
    throw new FoundryContextError(
      "workflow_assessment_required",
      "Assess the current rows before finalization.",
    );
  const referenceOptions = new Map<
    string,
    { qaReferenceRows?: string[]; referenceIntentFile?: string }
  >();
  for (const set of rows.value.sets) {
    if (executionProgress?.scopes.has(set.type)) continue;
    const selection = state.referenceInputs.get(set.type);
    if (!selection) continue;
    const intended = workflowObject(selection.value.input),
      current = captureFoundryInput(set.file);
    if (current.sha256 !== intended.sha256 || current.bytes !== intended.bytes)
      throw new FoundryContextError(
        "reference_input_stale",
        "Select reference evidence for the current dataset rows before finalization.",
      );
    const paths = (raw: unknown) => {
      if (!Array.isArray(raw))
        throw new FoundryContextError(
          "reference_input_invalid",
          "Registered reference file facts are invalid.",
        );
      return raw.map((value) => {
        const fact = workflowObject(value);
        if (typeof fact.path !== "string")
          throw new FoundryContextError("reference_input_invalid", "Reference path is missing.");
        readFoundryInput(context, fact.path);
        return fact.path;
      });
    };
    const qa = paths(selection.value.qa_files);
    paths(selection.value.review_files);
    const intent = selection.value.intent === null ? [] : paths([selection.value.intent]);
    referenceOptions.set(set.type, {
      ...(qa.length ? { qaReferenceRows: qa } : {}),
      ...(intent.length ? { referenceIntentFile: intent[0] } : {}),
    });
  }
  const profile = await withFoundryTaskMetadata(context, (task, index) => {
    if (currentWorkflowState(context, index).rows?.entry.sha256 !== rows.entry.sha256)
      throw new FoundryContextError(
        "workflow_rows_changed",
        "Current rows changed before finalization.",
      );
    return task.job.target_profile;
  });
  const profileLock = workflowObject(
    JSON.parse(readTaskBytes(context, "profile-lock.json").toString("utf8")),
  );
  const nonce = randomUUID(),
    output = resolveFoundryOutput(context, `outputs/finalize/${nonce}`);
  const temporary = resolveFoundryOutput(context, `tmp/finalize-${nonce}`);
  fs.mkdirSync(output, { recursive: true, mode: 0o700 });
  fs.mkdirSync(temporary, { recursive: true, mode: 0o700 });
  const environment = createFoundryIsolatedChildEnvironment({ tempRoot: temporary });
  environment.FOUNDRY_ACCOUNT_MODE = context.accountIntent?.accountMode ?? "ordinary";
  const sets: Array<Record<string, unknown>> = [],
    blockers: Array<Record<string, unknown>> = [];
  let receiptFile: string | undefined;
  let authorization: ValidatedTaskAuthorization | undefined;
  let approvalPointer: string | undefined;
  try {
    if (context.accountIntent && rows.value.sets.length) {
      const identity = verifyFoundryRuntimeIdentity(
        context,
        authentication,
        process.env,
        qualified,
      );
      if (approval) {
        authorization = await loadFoundryTaskAuthorization(
          context,
          identity,
          approval.inputFile,
          qualified,
        );
        if (authorization.authorization_sha256 !== approval.authorizationSha256)
          throw new FoundryContextError(
            "authorization_update_conflict",
            "Preparation approval changed before re-finalization.",
          );
        approvalPointer = createHash("sha256")
          .update(readTaskBytes(context, "authorization.json"))
          .digest("hex");
      }
      Object.assign(
        environment,
        createFoundryAuthenticationEnvironment(
          authentication,
          context.accountIntent.sessionReference,
          process.env,
        ),
      );
      environment.FOUNDRY_VERIFIED_PROJECT_REF = context.accountIntent.projectRef;
      environment.FOUNDRY_VERIFIED_USER_ID = context.accountIntent.userId;
      receiptFile = path.join(temporary, "identity-receipt.json");
      fs.writeFileSync(receiptFile, JSON.stringify(identity.receipt), { mode: 0o600 });
    }
    const tidasExecutable = path.join(temporary, path.basename(qualified.tidas.executable_path));
    copyFoundryIsolatedExecutable(qualified.tidas.executable_path, tidasExecutable);
    const actual = captureFoundryInput(tidasExecutable),
      expected = qualified.tidas.expectation.executable;
    if (actual.bytes !== expected.bytes || actual.sha256 !== expected.sha256)
      throw new FoundryContextError(
        "runtime_tidas_unqualified",
        "The selected native executable changed.",
      );
    const byPath = new Map(
      entries.map((entry) => [path.resolve(context.taskRoot!, entry.path), entry]),
    );
    const operations = new Set<string>(),
      seen = new Set<string>();
    let ancestor: string | null = rows.file;
    while (ancestor) {
      if (seen.has(ancestor))
        throw new FoundryContextError(
          "workflow_lineage_invalid",
          "Row manifest lineage contains a cycle.",
        );
      seen.add(ancestor);
      const entry = byPath.get(ancestor);
      if (!entry)
        throw new FoundryContextError(
          "workflow_lineage_invalid",
          "Row predecessor is not registered.",
        );
      operations.add(entry.operation_id);
      const value = readWorkflowArtifact(context, entry).value;
      ancestor = typeof value.predecessor === "string" ? value.predecessor : null;
    }
    const reportFor = (name: string, type: string) => {
      const entry = entries.findLast(
        (entry) =>
          operations.has(entry.operation_id) &&
          path.basename(entry.path) === name &&
          entry.path.split("/").includes(type),
      );
      return entry ? path.resolve(context.taskRoot!, entry.path) : undefined;
    };
    const contracts = new Map<string, Record<string, unknown>>();
    for (const entry of entries.filter(
      (entry) =>
        entry.command === "dataset-context-pack" &&
        path.basename(entry.path) === "contract-report.json",
    )) {
      const report = readWorkflowArtifact(context, entry).value;
      contracts.set(String(report.type), workflowObject(report.files));
    }
    const order = [
      "contact",
      "source",
      "unitgroup",
      "flowproperty",
      "flow",
      "process",
      "lifecyclemodel",
    ];
    const scope = [...rows.value.sets].sort(
      (a, b) => order.indexOf(a.type) - order.indexOf(b.type),
    );
    for (const originalSet of scope) {
      const set =
        approval?.datasetType === originalSet.type
          ? { ...originalSet, file: approval.inputFile }
          : originalSet;
      const completed = executionProgress?.scopes.get(set.type);
      if (completed) {
        sets.push(completed);
        continue;
      }
      const owners = createFoundryFinalizeOwners(context, qualified, temporary, {
        environment,
        tidasExecutable,
        receiptFile,
        datasetType: set.type,
      });
      const contract = contracts.get(set.type);
      if (!contract)
        throw new FoundryContextError(
          "workflow_context_required",
          "Finalization requires the current owner contract pack.",
        );
      const needsIdentity = ["flow", "process"].includes(set.type);
      let identityIndex = state.identity?.value.index;
      if (needsIdentity && typeof identityIndex === "string") {
        const prepared = workflowObject(
          owners.preflight.runDatasetIdentityPreflightRequestsBuild({
            type: set.type,
            rowsFile: set.file,
            sourceIndex: identityIndex,
            outDir: path.join(output, set.type, "preflight-inputs"),
          }),
        );
        const file = workflowObject(prepared.files).identity_preflight_requests;
        if (prepared.status !== "ready" || typeof file !== "string")
          throw new FoundryContextError(
            "finalize_identity_inputs_invalid",
            "Finalization needs fresh current-scope identity requests.",
          );
        const merged = workflowObject(
          owners.preflight.runDatasetIdentityPreflightIndexMerge({
            baseIndex: identityIndex,
            updateIndex: path.resolve(context.assetRoot, file),
            outDir: path.join(output, set.type, "preflight-inputs", "merged"),
          }),
        );
        const mergedFile = workflowObject(merged.files).merged_index;
        if (merged.status !== "ready" || typeof mergedFile !== "string")
          throw new FoundryContextError(
            "finalize_identity_inputs_invalid",
            "Finalization identity index could not preserve dependency evidence.",
          );
        identityIndex = path.resolve(context.assetRoot, mergedFile);
      }
      const result = workflowObject(
        owners.invoke(() =>
          owners.finalize.runDatasetPostAuthoringFinalize({
            type: ["unitgroup", "flowproperty"].includes(set.type) ? "support" : set.type,
            rowsFile: set.file,
            ...referenceOptions.get(set.type),
            outDir: path.join(output, set.type),
            profile,
            ...(approval?.datasetType === set.type && authorization
              ? {
                  taskAuthorization: authorization,
                  taskAuthorizationBinding: authorization.binding,
                  mintUnmatchedFpUgSupport:
                    ["unitgroup", "flowproperty"].includes(set.type) &&
                    authorization.allowed_actions.includes("canonical_support_local_mint"),
                }
              : {}),
            schemaFile: contract.schema,
            yamlFile: contract.methodology,
            rulesetFile: contract.ruleset,
            targetUserId: context.accountIntent?.userId,
            expectedProjectRef: context.accountIntent?.projectRef,
            expectedUserId: context.accountIntent?.userId,
            requireIdentityPreflight: needsIdentity,
            runIdentityPreflight: needsIdentity && Boolean(state.identity) && Boolean(receiptFile),
            identityPreflightIndex: identityIndex,
            identityPreflightAuthReceipt: receiptFile,
            identityPreflightConcurrency: 1,
            identityPreflightMaxAttempts: 1,
            identityDecisionApplyReport: rows.value.identity_reports,
            classificationDecisionApplyReport: reportFor(
              "classification-decisions-apply-report.json",
              set.type,
            ),
            locationDecisionApplyReport: reportFor(
              "location-decisions-apply-report.json",
              set.type,
            ),
            patchCollectReport: reportFor("authoring-patch-collect-report.json", set.type),
            patchApplyReport: reportFor("dataset-patch-apply-report.json", set.type),
            processes: rows.value.sets.find((item) => item.type === "process")?.file,
            flows:
              executionProgress?.scopes.get("flow")?.final_rows ??
              rows.value.sets.find((item) => item.type === "flow")?.file,
            verifyRemote: Boolean(context.accountIntent),
            remoteStateCode: "0",
            remoteRootPolicy: "candidate",
          }),
        ),
      );
      const files = workflowObject(result.files);
      sets.push({
        type: set.type,
        input_rows: set.file,
        status: result.status,
        report: path.resolve(context.assetRoot, String(files.report)),
        final_rows:
          typeof files.final_rows === "string"
            ? path.resolve(context.assetRoot, files.final_rows)
            : null,
        mutation_manifest: files.mutation_manifest,
        handoff: files.commit_handoff_plan,
        authorization_inputs: context.accountIntent
          ? [
              { input_kind: "current_rows", file: set.file },
              ...(typeof files.final_rows === "string"
                ? [
                    {
                      input_kind: "final_rows",
                      file: path.resolve(context.assetRoot, files.final_rows),
                    },
                  ]
                : []),
            ].map((input) => {
              const fact = captureFoundryInput(input.file);
              return {
                ...input,
                sha256: fact.sha256,
                binding: {
                  workspace_id: context.workspaceId,
                  task_id: context.taskId,
                  actor_id: context.actorId,
                  project_ref: context.accountIntent!.projectRef,
                  user_id: context.accountIntent!.userId,
                  profile_id: profile,
                  profile_sha256: profileLock.profile_sha256,
                  input_scope_sha256: fact.sha256,
                },
              };
            })
          : [],
      });
      const before = blockers.length;
      if (Array.isArray(result.blockers)) blockers.push(...result.blockers.map(workflowObject));
      if (
        !["ready_for_remote_write", "ready_reference_only"].includes(String(result.status)) &&
        blockers.length === before
      )
        blockers.push({ code: "finalize_owner_not_ready", type: set.type, status: result.status });
    }
    if (!scope.length)
      blockers.push({
        code: "reference_only_verification_required",
        message:
          "Reference-only scopes still require independent canonical reference verification before completion.",
      });
    for (const input of context.inputs) readFoundryInput(context, input.path);
    assertQualifiedFoundryRuntime(context, qualified);
    return await runFoundryTaskOperation(
      context,
      {
        command: "dataset-workflow-finalize",
        options: {
          nonce,
          rows_report: rows.file,
          ...(state.referenceInputsSha256
            ? { reference_inputs_sha256: state.referenceInputsSha256 }
            : {}),
        },
        validateCurrent(index) {
          if (currentWorkflowState(context, index).rows?.entry.sha256 !== rows.entry.sha256)
            throw new FoundryContextError(
              "workflow_rows_changed",
              "Rows changed during finalization.",
            );
          if (
            currentWorkflowState(context, index).referenceInputsSha256 !==
            state.referenceInputsSha256
          )
            throw new FoundryContextError(
              "reference_input_changed",
              "Reference selection changed during finalization.",
            );
          if (
            authorization &&
            (createHash("sha256")
              .update(readTaskBytes(context, "authorization.json"))
              .digest("hex") !== approvalPointer ||
              !taskAuthorizationMatches(authorization, authorization.binding))
          )
            throw new FoundryContextError(
              "authorization_update_conflict",
              "Preparation approval expired or changed during finalization.",
            );
        },
      },
      (operation) => {
        registerWorkflowStageFiles(context, operation, output);
        const result = {
          schema: "tiangong-foundry.finalize-stage.v1",
          status: blockers.length ? "blocked" : "ready_for_authorization",
          rows_report: rows.file,
          ...(state.referenceInputsSha256
            ? { reference_inputs_sha256: state.referenceInputsSha256 }
            : {}),
          assessment_report: state.assessment!.file,
          owner_base: context.assetRoot,
          approval_source_sha256: approval?.sourceSha256 ?? null,
          approval_authorization_sha256: approval?.authorizationSha256 ?? null,
          execution_progress_sha256: executionProgress?.sha256 ?? null,
          sets,
          blockers,
        };
        operation.writeJson(path.join(output, "foundry-finalize.json"), result);
        return result;
      },
    );
  } finally {
    delete environment.TIANGONG_LCA_ACCESS_TOKEN;
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

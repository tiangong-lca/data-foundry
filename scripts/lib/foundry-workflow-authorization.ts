import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  assertSelectedAuthorizationInput,
  type SelectedAuthorizationInput,
} from "./foundry-authorization-input.ts";
import { readSelectedSemanticBytes } from "./foundry-semantic-input.ts";
import {
  FoundryContextError,
  readFoundryInput,
  captureFoundryInput,
  resolveFoundryOutput,
  type FoundryRuntimeContext,
} from "./foundry-runtime-context.ts";
import {
  assertQualifiedFoundryRuntime,
  type QualifiedFoundryRuntime,
} from "./foundry-runtime-qualification.ts";
import { currentWorkflowState, workflowObject } from "./foundry-workflow-state.ts";
import { runFoundryTaskOperation } from "./foundry-task-store.ts";
import {
  verifyFoundryRuntimeIdentity,
  type FoundryAuthentication,
} from "./foundry-runtime-identity.ts";
import {
  registerFoundryTaskAuthorization,
  loadFoundryTaskAuthorization,
} from "./foundry-task-authorization.ts";
import { createFoundryAuthenticationEnvironment } from "./foundry-authentication-environment.ts";
import { createFoundryFinalizeOwners } from "./foundry-finalize-owners.ts";
import { createFoundryExecutionCapsule } from "./foundry-execution-admission.ts";
import { registerWorkflowStageFiles } from "./foundry-workflow-io.ts";
import { createFoundryCommandSpec, createFileArtifactFact } from "./foundry-command-spec.ts";
import { parseFoundryCommandSpec } from "@tiangong-lca/cli/command-spec";
import type { ArtifactEntry } from "./foundry-task-types.ts";

export async function authorizeFoundryWorkflow(
  context: FoundryRuntimeContext,
  qualified: QualifiedFoundryRuntime,
  entries: readonly ArtifactEntry[],
  selected: SelectedAuthorizationInput,
  authentication: FoundryAuthentication = { mode: "oauth" },
) {
  assertSelectedAuthorizationInput(selected);
  assertQualifiedFoundryRuntime(context, qualified);
  const state = currentWorkflowState(context, entries),
    spec = selected.spec;
  const finalization = state.finalization;
  if (!finalization || finalization.entry.sha256 !== spec.finalization_sha256)
    throw new FoundryContextError(
      "authorization_finalization_mismatch",
      "Approval must select the current finalization report.",
    );
  if (state.authorization?.value.submission_sha256 === selected.descriptor.sha256)
    return state.authorization.value;
  const scope = (finalization.value.sets as unknown[])
    .map(workflowObject)
    .find((item) => item.type === spec.dataset_type);
  if (!scope)
    throw new FoundryContextError(
      "authorization_scope_mismatch",
      "Approval dataset type is not in this finalization.",
    );
  const inputFile = spec.input_kind === "final_rows" ? scope.final_rows : scope.input_rows;
  if (typeof inputFile !== "string" || captureFoundryInput(inputFile).sha256 !== spec.input_sha256)
    throw new FoundryContextError(
      "authorization_input_mismatch",
      "Approval input must match the exact current scope bytes.",
    );
  readFoundryInput(context, inputFile);
  if (spec.input_kind === "final_rows" && scope.status !== "ready_for_remote_write")
    throw new FoundryContextError(
      "authorization_scope_not_ready",
      "Final-row approval requires a ready owner scope.",
    );
  const identity = verifyFoundryRuntimeIdentity(context, authentication, process.env, qualified);
  const grant = JSON.parse(readSelectedSemanticBytes(selected.grant).toString("utf8"));
  const current = (index: readonly ArtifactEntry[]) => {
    assertSelectedAuthorizationInput(selected);
    if (
      currentWorkflowState(context, index).finalization?.entry.sha256 !== finalization.entry.sha256
    )
      throw new FoundryContextError(
        "authorization_finalization_changed",
        "Finalization changed before approval activation.",
      );
  };
  const registration = await registerFoundryTaskAuthorization(
    context,
    identity,
    {
      inputFile,
      grant,
      evidence: spec.evidence.map((item, index) => ({
        id: item.id,
        kind: item.kind,
        file: selected.evidence[index],
      })),
      expectedPreviousSha256: spec.expected_previous_sha256,
      validateCurrent: (_, index) => current(index),
    },
    qualified,
  );
  const authorization = await loadFoundryTaskAuthorization(context, identity, inputFile, qualified);
  const nonce = randomUUID(),
    output = resolveFoundryOutput(context, `outputs/authorization/${nonce}`);
  const temporary = resolveFoundryOutput(context, `tmp/authorization-${nonce}`);
  fs.mkdirSync(output, { recursive: true, mode: 0o700 });
  fs.mkdirSync(temporary, { recursive: true, mode: 0o700 });
  let capsule: Awaited<ReturnType<typeof createFoundryExecutionCapsule>> | null = null;
  let handoff: Record<string, unknown> | null = null;
  const environment = createFoundryAuthenticationEnvironment(
    authentication,
    context.accountIntent?.sessionReference,
    process.env,
  );
  try {
    if (spec.input_kind === "final_rows") {
      environment.FOUNDRY_VERIFIED_PROJECT_REF = context.accountIntent!.projectRef;
      environment.FOUNDRY_VERIFIED_USER_ID = context.accountIntent!.userId;
      const owners = createFoundryFinalizeOwners(context, qualified, temporary, {
        environment,
        tidasExecutable: qualified.tidas.executable_path,
      });
      handoff = workflowObject(
        owners.handoff.runDatasetCommitHandoffPlan({
          finalizeReport: scope.report,
          rowsFile: inputFile,
          mutationManifest: scope.mutation_manifest,
          outDir: path.join(output, "handoff"),
          targetUserId: context.accountIntent!.userId,
          taskAuthorization: authorization,
          taskAuthorizationBinding: authorization.binding,
          profile: authorization.binding.profile_id,
        }),
      );
      const commands = workflowObject(handoff.commands);
      for (const key of ["commit", "post_write_verify"]) {
        if (!commands[key]) continue;
        const command = parseFoundryCommandSpec(commands[key]);
        commands[key] = createFoundryCommandSpec({
          executable: command.executable,
          argv: [...command.argv],
          binding: {
            artifacts: [
              createFileArtifactFact({ role: "final_rows", path: inputFile, filePath: inputFile }),
            ],
          },
        });
      }
      fs.writeFileSync(
        path.join(output, "handoff", "dataset-commit-handoff-plan.json"),
        JSON.stringify(handoff, null, 2) + "\n",
      );
      const command = commands.commit;
      if (command) {
        const requiredActions = authorization.allowed_actions.filter((action) =>
          spec.dataset_type === "flow"
            ? action === "elementary_flow_write" || action === "elementary_flow_create_new"
            : ["unitgroup", "flowproperty"].includes(spec.dataset_type)
              ? action === `${spec.dataset_type}_write` || action === "canonical_support_local_mint"
              : false,
        );
        capsule = await createFoundryExecutionCapsule(context, qualified, identity, {
          command: "dataset-commit-handoff-plan",
          approvedInputFile: inputFile,
          finalRowsFile: inputFile,
          commandSpec: command,
          requiredActions,
          requiredQaWaivers: authorization.qa_waivers
            .filter((item) => item.dataset_type === spec.dataset_type)
            .map((item) => item.code),
        });
      }
    }
    return await runFoundryTaskOperation(
      context,
      {
        command: "dataset-workflow-authorization",
        options: {
          submission: selected.descriptor,
          grant: selected.grant,
          evidence: selected.evidence,
          finalization: spec.finalization_sha256,
          authorization: registration.authorization_sha256,
        },
        validateCurrent: current,
      },
      (operation) => {
        registerWorkflowStageFiles(context, operation, output);
        const result = {
          schema: "tiangong-foundry.authorization-stage.v1",
          status: capsule
            ? "sealed"
            : spec.input_kind === "current_rows"
              ? "authorized_current_rows"
              : "handoff_blocked",
          finalization_sha256: spec.finalization_sha256,
          dataset_type: spec.dataset_type,
          input_kind: spec.input_kind,
          input: captureFoundryInput(inputFile),
          authorization_sha256: registration.authorization_sha256,
          pointer_sha256: registration.pointer_sha256,
          expires_at_utc: authorization.expires_at_utc,
          allowed_actions: [...authorization.allowed_actions],
          capsule,
          handoff,
          submission_sha256: selected.descriptor.sha256,
        };
        operation.writeJson(path.join(output, "foundry-authorization.json"), result);
        return result;
      },
    );
  } finally {
    delete environment.TIANGONG_LCA_ACCESS_TOKEN;
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

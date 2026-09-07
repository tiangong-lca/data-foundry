import { createHash } from "node:crypto";
import {
  FoundryContextError,
  captureFoundryInput,
  readFoundryInput,
  type FoundryRuntimeContext,
} from "./foundry-runtime-context.ts";
import type { QualifiedFoundryRuntime } from "./foundry-runtime-qualification.ts";
import {
  verifyFoundryRuntimeIdentity,
  type FoundryAuthentication,
} from "./foundry-runtime-identity.ts";
import {
  currentWorkflowState,
  workflowObject,
  type WorkflowArtifact,
} from "./foundry-workflow-state.ts";
import { finalizeFoundryWorkflow } from "./foundry-workflow-finalize.ts";
import {
  prepareDerivedFoundryTaskAuthorization,
  registerFoundryTaskAuthorization,
  loadFoundryTaskAuthorization,
} from "./foundry-task-authorization.ts";
import { recordFoundryWorkflowAuthorization } from "./foundry-workflow-authorization.ts";
import { assertFoundryTaskInputLineage } from "./foundry-task-store.ts";
import { readTaskBytes } from "./foundry-task-io.ts";
import { deriveTaskAuthorizationGrant, validateTaskAuthorization } from "./task-authorization.ts";
import { sha256Json } from "./identity-preflight-proof.ts";
import type { ArtifactEntry } from "./foundry-task-types.ts";

const digest = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
function invalid(message: string): never {
  throw new FoundryContextError("authorization_continuation_invalid", message);
}

export async function continueFoundryPreparedApproval(
  context: FoundryRuntimeContext,
  qualified: QualifiedFoundryRuntime,
  entries: readonly ArtifactEntry[],
  approval: WorkflowArtifact<Record<string, unknown>>,
  authentication: FoundryAuthentication = { mode: "oauth" },
) {
  const state = currentWorkflowState(context, entries),
    finalization = state.finalization;
  if (!finalization || approval.value.input_kind !== "current_rows")
    invalid("Select current prepared-row approval evidence.");
  const original = workflowObject(approval.value.input);
  if (
    typeof original.path !== "string" ||
    typeof original.sha256 !== "string" ||
    typeof approval.value.dataset_type !== "string"
  )
    invalid("Prepared approval input is invalid.");
  const inputFile = original.path,
    datasetType = approval.value.dataset_type;
  readFoundryInput(context, inputFile);
  if (finalization.value.approval_source_sha256 !== approval.entry.sha256) {
    if (state.authorization?.entry.sha256 !== approval.entry.sha256)
      invalid("Preparation approval is no longer active.");
    return finalizeFoundryWorkflow(context, qualified, entries, authentication, {
      sourceSha256: approval.entry.sha256,
      authorizationSha256: String(approval.value.authorization_sha256),
      datasetType,
      inputFile,
    });
  }
  const scope = (finalization.value.sets as unknown[])
    .map(workflowObject)
    .find((item) => item.type === datasetType);
  if (!scope || scope.status !== "ready_for_remote_write" || typeof scope.final_rows !== "string")
    return finalization.value;
  const finalRows = scope.final_rows;
  readFoundryInput(context, finalRows);
  const identity = verifyFoundryRuntimeIdentity(context, authentication, process.env, qualified);
  const pointer = digest(readTaskBytes(context, "authorization.json"));
  const current = (index: readonly ArtifactEntry[]) => {
    const now = currentWorkflowState(context, index);
    if (now.finalization?.entry.sha256 !== finalization.entry.sha256)
      invalid("Finalization changed during prepared-approval continuation.");
  };
  if (
    pointer === approval.value.pointer_sha256 &&
    captureFoundryInput(finalRows).sha256 !== original.sha256
  ) {
    const derived = await prepareDerivedFoundryTaskAuthorization(context, qualified, identity, {
      approvedInputFile: inputFile,
      derivedInputFile: finalRows,
    });
    await registerFoundryTaskAuthorization(
      context,
      identity,
      {
        inputFile: finalRows,
        grant: derived.grant,
        evidence: derived.evidence,
        expectedPreviousSha256: derived.expected_previous_sha256,
        validateCurrent: (_, index) => current(index),
      },
      qualified,
    );
  }
  const authorization = await loadFoundryTaskAuthorization(context, identity, finalRows, qualified);
  const ancestor = JSON.parse(
    readTaskBytes(
      context,
      `evidence/authorizations/${String(approval.value.authorization_sha256)}/grant.json`,
    ).toString("utf8"),
  );
  const validated = validateTaskAuthorization(ancestor, {
    ...authorization.binding,
    input_scope_sha256: original.sha256,
  });
  if (
    validated.status !== "authorized" ||
    validated.authorization.authorization_sha256 !== approval.value.authorization_sha256
  )
    invalid("Original approval no longer validates for this scope.");
  const expectedSha =
    original.sha256 === authorization.binding.input_scope_sha256
      ? validated.authorization.authorization_sha256
      : sha256Json(deriveTaskAuthorizationGrant(validated.authorization, authorization.binding));
  if (expectedSha !== authorization.authorization_sha256)
    invalid("Active grant is not the approved scope's exact derivation.");
  await assertFoundryTaskInputLineage(context, inputFile, finalRows);
  const registration = {
    authorization_sha256: authorization.authorization_sha256,
    pointer_sha256: digest(readTaskBytes(context, "authorization.json")),
  };
  return recordFoundryWorkflowAuthorization(
    context,
    qualified,
    identity,
    authorization,
    authentication,
    {
      inputFile: finalRows,
      approvedInputFile: inputFile,
      scope,
      finalizationSha256: finalization.entry.sha256,
      datasetType,
      inputKind: "final_rows",
      registration,
      submissionSha256: String(approval.value.submission_sha256),
      validateCurrent: current,
      operationOptions: {
        preparation_approval: approval.entry.sha256,
        finalization: finalization.entry.sha256,
        authorization: authorization.authorization_sha256,
      },
    },
  );
}

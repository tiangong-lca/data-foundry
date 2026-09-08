import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  createBatchContract,
  createBatchItemContract,
  parseBatchItemContract,
  type BatchEvent,
  type BatchJsonValue,
} from "@tiangong-lca/cli/batch";
import { parseFoundryCommandSpec } from "@tiangong-lca/cli/command-spec";
import { createScopeAttemptLedgerService } from "./batch-orchestration/scope-attempt-ledger.ts";
import {
  captureFoundryInput,
  FoundryContextError,
  readFoundryInput,
  resolveFoundryOutput,
  type FoundryRuntimeContext,
} from "./foundry-runtime-context.ts";
import {
  currentWorkflowState,
  readWorkflowArtifact,
  workflowObject,
} from "./foundry-workflow-state.ts";
import { runFoundryTaskOperation } from "./foundry-task-store.ts";
import { sha256Json } from "./identity-preflight-proof.ts";
import type { ArtifactEntry } from "./foundry-task-types.ts";

export type OwnerExecutionRequest = ReturnType<typeof buildRequest>;
function buildRequest(
  context: FoundryRuntimeContext,
  authorization: ReturnType<typeof readWorkflowArtifact>,
) {
  const value = authorization.value,
    input = workflowObject(value.input),
    capsule = workflowObject(value.capsule),
    handoff = workflowObject(value.handoff);
  if (
    value.status !== "sealed" ||
    typeof value.dataset_type !== "string" ||
    typeof input.path !== "string" ||
    !context.accountIntent
  )
    throw new FoundryContextError(
      "execution_request_invalid",
      "Select a sealed current owner scope.",
    );
  readFoundryInput(context, input.path);
  const commands = workflowObject(handoff.commands),
    commit = parseFoundryCommandSpec(commands.commit),
    verify = parseFoundryCommandSpec(commands.post_write_verify);
  const capsuleFile = resolveFoundryOutput(context, String(capsule.capsule_file));
  const capsuleFact = captureFoundryInput(capsuleFile);
  if (capsuleFact.sha256 !== capsule.capsule_sha256)
    throw new FoundryContextError(
      "execution_capsule_changed",
      "The sealed capsule changed before request preparation.",
    );
  const scopeId = sha256Json({ task: context.taskId, type: value.dataset_type });
  if ((handoff.account_mode ?? "ordinary") !== (context.accountIntent.accountMode ?? "ordinary"))
    throw new FoundryContextError(
      "execution_account_mode_mismatch",
      "Sealed handoff must preserve the registered account verification mode.",
    );
  const content = {
    authorization: authorization.entry.sha256,
    input: captureFoundryInput(input.path),
    capsule: capsuleFact,
    commit,
    verify,
  };
  const policy = {
    task_id: context.taskId!,
    actor_id: context.actorId!,
    project_ref: context.accountIntent.projectRef,
    user_id: context.accountIntent.userId,
    state_code: 0,
    dataset_type: value.dataset_type,
    account_mode: String(handoff.account_mode ?? "ordinary"),
  };
  const projection = JSON.parse(JSON.stringify(content)) as BatchJsonValue;
  const contract = createBatchContract({
    identity: { task: context.taskId!, scope: scopeId },
    content: projection,
    policy,
  });
  const itemContract = createBatchItemContract({ item_id: scopeId, content: projection, policy });
  return {
    schema: "tiangong-foundry.owner-execution-request.v1" as const,
    scope_id: scopeId,
    content,
    policy,
    contract,
    item_contract: itemContract,
    handoff_file: path.resolve(context.assetRoot, String(workflowObject(handoff.files).report)),
    finalize_file: path.resolve(context.assetRoot, String(handoff.finalize_report)),
    mutation_file: path.resolve(context.assetRoot, String(handoff.mutation_manifest)),
  };
}

export async function prepareFoundryOwnerExecution(
  context: FoundryRuntimeContext,
  entries: readonly ArtifactEntry[],
) {
  const state = currentWorkflowState(context, entries),
    approval = state.authorization;
  if (!approval || approval.value.status !== "sealed")
    throw new FoundryContextError(
      "execution_approval_required",
      "A current sealed approval is required.",
    );
  const request = buildRequest(context, approval);
  return runFoundryTaskOperation(
    context,
    {
      command: "dataset-workflow-execution-prepare",
      options: { authorization: approval.entry.sha256 },
      validateCurrent(index) {
        if (
          currentWorkflowState(context, index).authorization?.entry.sha256 !== approval.entry.sha256
        )
          throw new FoundryContextError(
            "execution_approval_changed",
            "Approval changed before execution preparation.",
          );
      },
    },
    (operation) => {
      operation.writeJson(
        `outputs/execution-requests/${request.scope_id}/${approval.entry.sha256}/owner-execution-request.json`,
        request,
      );
      return request;
    },
  );
}

export function readOwnerExecutionRequests(
  context: FoundryRuntimeContext,
  entries: readonly ArtifactEntry[],
) {
  return entries
    .filter(
      (entry) =>
        entry.command === "dataset-workflow-execution-prepare" &&
        path.basename(entry.path) === "owner-execution-request.json",
    )
    .map((entry) => {
      const artifact = readWorkflowArtifact(context, entry);
      const request = artifact.value as unknown as OwnerExecutionRequest;
      if (
        request.schema !== "tiangong-foundry.owner-execution-request.v1" ||
        request.policy.task_id !== context.taskId ||
        request.policy.actor_id !== context.actorId
      )
        throw new FoundryContextError(
          "execution_request_invalid",
          "Execution request does not belong to this task.",
        );
      parseBatchItemContract(request.item_contract);
      parseFoundryCommandSpec(request.content.commit);
      parseFoundryCommandSpec(request.content.verify);
      const content = JSON.parse(JSON.stringify(request.content)) as BatchJsonValue;
      if (
        request.scope_id !==
          sha256Json({ task: context.taskId, type: request.policy.dataset_type }) ||
        request.policy.project_ref !== context.accountIntent?.projectRef ||
        request.policy.user_id !== context.accountIntent?.userId ||
        request.policy.account_mode !== (context.accountIntent?.accountMode ?? "ordinary") ||
        request.policy.state_code !== 0 ||
        sha256Json(request.contract) !==
          sha256Json(
            createBatchContract({
              identity: { task: context.taskId, scope: request.scope_id },
              content,
              policy: request.policy,
            }),
          ) ||
        sha256Json(request.item_contract) !==
          sha256Json(
            createBatchItemContract({ item_id: request.scope_id, content, policy: request.policy }),
          )
      )
        throw new FoundryContextError(
          "execution_request_invalid",
          "Owner request scope, account or batch projection changed.",
        );
      return { ...artifact, request };
    });
}

export function ownerAttemptStore(
  context: FoundryRuntimeContext,
  scopeId: string,
  request: { path: string; sha256: string },
) {
  if (!/^[0-9a-f]{64}$/u.test(scopeId))
    throw new FoundryContextError("execution_scope_invalid", "Execution scope id is invalid.");
  const root = resolveFoundryOutput(context, `attempts/owner-v1/${scopeId}`);
  const events = path.join(root, `events-${randomUUID()}.jsonl`),
    state = path.join(root, "state.jsonl");
  const read = (file: string): Record<string, unknown>[] => {
    resolveFoundryOutput(context, file);
    if (!fs.existsSync(file)) return [];
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 64 * 1024 * 1024)
      throw new FoundryContextError(
        "execution_attempt_invalid",
        "Attempt events are not a bounded regular file.",
      );
    const text = fs.readFileSync(file, "utf8");
    if (text && !text.endsWith("\n"))
      throw new FoundryContextError(
        "execution_attempt_invalid",
        "Attempt events are incomplete; mutation replay is forbidden.",
      );
    return text
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const item = workflowObject(JSON.parse(line));
        if (item.schema_version !== 1 || !item.request)
          throw new FoundryContextError(
            "execution_attempt_invalid",
            "Unknown attempt evidence cannot permit a mutation.",
          );
        if (item.item_contract) parseBatchItemContract(item.item_contract);
        return item;
      });
  };
  const ledger = createScopeAttemptLedgerService({
    paths: { state, events },
    adapter: {
      nowIso: () => new Date().toISOString(),
      readJsonLines: read,
      appendJsonLine(file, value) {
        resolveFoundryOutput(context, file);
        fs.mkdirSync(root, { recursive: true, mode: 0o700 });
        const fd = fs.openSync(
          file,
          fs.constants.O_WRONLY |
            fs.constants.O_APPEND |
            fs.constants.O_CREAT |
            fs.constants.O_NOFOLLOW,
          0o600,
        );
        try {
          fs.writeFileSync(fd, JSON.stringify({ ...value, request }) + "\n");
          fs.fsyncSync(fd);
        } finally {
          fs.closeSync(fd);
        }
      },
      writeJsonLines() {
        throw new FoundryContextError(
          "execution_compaction_forbidden",
          "Attempt history remains append-only.",
        );
      },
    },
  });
  return {
    ledger,
    readEvents: () => read(events),
    record: (event: BatchEvent, itemContract: OwnerExecutionRequest["item_contract"]) =>
      ledger.record({ event, itemContract }),
  };
}

export async function markOwnerAttemptConsumed(
  context: FoundryRuntimeContext,
  artifact: ReturnType<typeof readOwnerExecutionRequests>[number],
) {
  const value = {
    schema: "tiangong-foundry.owner-attempt-consumed.v1",
    scope_id: artifact.request.scope_id,
    request: { path: artifact.file, sha256: artifact.entry.sha256 },
    item_contract: artifact.request.item_contract,
    attempts: 1,
  };
  return runFoundryTaskOperation(
    context,
    { command: "dataset-workflow-execution-consume", options: { request: artifact.entry.sha256 } },
    (operation) => {
      operation.writeJson(`attempts/owner-v1/${artifact.request.scope_id}/consumed.json`, value);
      return value;
    },
  );
}

export function inspectOwnerExecutions(
  context: FoundryRuntimeContext,
  entries: readonly ArtifactEntry[],
) {
  const requests = readOwnerExecutionRequests(context, entries),
    bySha = new Map(requests.map((item) => [item.entry.sha256, item]));
  const consumed = new Map<string, (typeof requests)[number]>();
  const consume = (value: Record<string, unknown>) => {
    const ref = workflowObject(value.request),
      item = typeof ref.sha256 === "string" ? bySha.get(ref.sha256) : undefined;
    if (
      !item ||
      ref.path !== item.file ||
      (value.scope_id !== undefined && value.scope_id !== item.request.scope_id)
    )
      throw new FoundryContextError(
        "execution_attempt_invalid",
        "Consumed attempt does not bind a registered owner request.",
      );
    const contract = parseBatchItemContract(value.item_contract);
    if (sha256Json(contract) !== sha256Json(item.request.item_contract))
      throw new FoundryContextError("execution_attempt_invalid", "Consumed item contract changed.");
    const prior = consumed.get(item.request.scope_id);
    if (prior && prior.entry.sha256 !== item.entry.sha256)
      throw new FoundryContextError(
        "execution_attempt_invalid",
        "One scope has conflicting consumed requests.",
      );
    consumed.set(item.request.scope_id, item);
  };
  for (const entry of entries.filter(
    (entry) =>
      entry.command === "dataset-workflow-execution-consume" &&
      path.basename(entry.path) === "consumed.json",
  ))
    consume(readWorkflowArtifact(context, entry).value);
  const root = resolveFoundryOutput(context, "attempts");
  if (fs.existsSync(root)) {
    for (const name of fs.readdirSync(root))
      if (name !== "owner-v1")
        throw new FoundryContextError(
          "execution_legacy_attempts",
          "Existing unknown attempts require their original readback recovery.",
        );
    const ownerRoot = resolveFoundryOutput(context, path.join(root, "owner-v1"));
    if (fs.existsSync(ownerRoot))
      for (const scope of fs.readdirSync(ownerRoot)) {
        if (!/^[0-9a-f]{64}$/u.test(scope))
          throw new FoundryContextError(
            "execution_attempt_invalid",
            "Unknown execution scope directory.",
          );
        const directory = resolveFoundryOutput(context, path.join(ownerRoot, scope));
        for (const name of fs.readdirSync(directory)) {
          const file = resolveFoundryOutput(context, path.join(directory, name)),
            stat = fs.lstatSync(file);
          if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 64 * 1024 * 1024)
            throw new FoundryContextError(
              "execution_attempt_invalid",
              "Attempt state is not a bounded regular file.",
            );
          const bytes = fs.readFileSync(file, "utf8");
          if (name === "consumed.json") {
            const value = workflowObject(JSON.parse(bytes));
            if (value.schema !== "tiangong-foundry.owner-attempt-consumed.v1")
              throw new FoundryContextError(
                "execution_attempt_invalid",
                "Unknown consumed marker.",
              );
            consume(value);
          } else if (/^events-[0-9a-f-]+\.jsonl$/u.test(name)) {
            if (bytes && !bytes.endsWith("\n"))
              throw new FoundryContextError(
                "execution_attempt_invalid",
                "Incomplete attempt history cannot allow replay.",
              );
            for (const line of bytes.split("\n").filter(Boolean)) {
              const event = workflowObject(JSON.parse(line));
              if (event.schema_version !== 1 || !event.request)
                throw new FoundryContextError(
                  "execution_attempt_invalid",
                  "Unknown attempt event.",
                );
              if (
                ["attempt_started", "attempt_failed", "attempt_succeeded"].includes(
                  String(event.type),
                )
              )
                consume(event);
            }
          } else
            throw new FoundryContextError("execution_attempt_invalid", "Unknown attempt file.");
        }
      }
  }
  const results = entries
    .filter(
      (entry) =>
        entry.command === "dataset-workflow-execution-result" &&
        path.basename(entry.path) === "owner-execution-result.json",
    )
    .map((entry) => readWorkflowArtifact(context, entry));
  const verified = new Map<string, (typeof results)[number]>();
  for (const result of results)
    if (result.value.status === "verified" || result.value.status === "recovered") {
      const item = bySha.get(String(result.value.request_sha256));
      if (!item || consumed.get(item.request.scope_id)?.entry.sha256 !== item.entry.sha256)
        throw new FoundryContextError(
          "execution_result_invalid",
          "Execution result has no matching consumed request.",
        );
      const proof = workflowObject(result.value.readback);
      if (
        proof.status !== "verified" ||
        proof.request_scope !== item.request.scope_id ||
        !Array.isArray(proof.blockers) ||
        proof.blockers.length
      )
        throw new FoundryContextError(
          "execution_result_invalid",
          "Execution result has no verified readback.",
        );
      for (const raw of [proof.input, proof.report, proof.checks]) {
        const fact = workflowObject(raw);
        if (typeof fact.path !== "string")
          throw new FoundryContextError(
            "execution_result_invalid",
            "Readback content fact is missing.",
          );
        resolveFoundryOutput(context, fact.path);
        const current = captureFoundryInput(fact.path);
        if (current.sha256 !== fact.sha256 || current.bytes !== fact.bytes)
          throw new FoundryContextError(
            "execution_result_changed",
            "Recorded execution readback evidence changed.",
          );
      }
      verified.set(item.request.scope_id, result);
    }
  return {
    requests,
    consumed,
    verified,
    pending: [...consumed.values()].filter((item) => !verified.has(item.request.scope_id)),
  };
}

export function completedOwnerScopes(
  context: FoundryRuntimeContext,
  entries: readonly ArtifactEntry[],
) {
  const execution = inspectOwnerExecutions(context, entries),
    state = currentWorkflowState(context, entries);
  const completed = new Map<string, Record<string, unknown>>();
  for (const raw of Array.isArray(state.finalization?.value.sets)
    ? state.finalization.value.sets
    : []) {
    const scope = workflowObject(raw),
      type = String(scope.type),
      id = sha256Json({ task: context.taskId, type });
    const done = execution.verified.get(id),
      requested = execution.consumed.get(id);
    if (!done || !requested || typeof scope.final_rows !== "string") continue;
    const input = captureFoundryInput(scope.final_rows);
    if (
      input.sha256 !== requested.request.content.input.sha256 ||
      input.bytes !== requested.request.content.input.bytes
    )
      throw new FoundryContextError(
        "execution_completed_scope_changed",
        "A completed scope cannot acquire different rows through a new finalization.",
      );
    completed.set(type, scope);
  }
  const progressSha256 = sha256Json(
    [...execution.verified.entries()].map(([id, value]) => [id, value.entry.sha256]).sort(),
  );
  return { ...execution, completed, progressSha256 };
}

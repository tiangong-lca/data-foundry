import {
  createBatchItemContract,
  type BatchAttemptedResumeItem,
  type BatchEvent,
  type BatchItemContract,
} from "@tiangong-lca/cli/batch";

import { runLockedCliBatch } from "./cli-bounded-batch-runner.ts";
import type { ScopeResumeContract } from "./scope-resume-contract.ts";

export class FoundryScopeMutationReadbackRequiredError extends Error {
  constructor(itemId: string, options?: ErrorOptions) {
    super(
      `Scope mutation ${itemId} has no exact verified readback and must not be replayed.`,
      options,
    );
    this.name = "FoundryScopeMutationReadbackRequiredError";
  }
}

export interface FoundryScopeBatchFamilyPolicy {
  familyGroupKey: string | null;
  optimizationRole: string;
}

export interface RunFoundryScopeBatchOptions<
  TScope extends Record<string, unknown>,
  TRawResult extends Record<string, unknown>,
  TResult extends Record<string, unknown>,
> {
  runPath: string;
  outDirIdentity: string;
  scopeFileIdentity: string;
  pauseFileIdentity: string | null;
  command: string;
  profile: string;
  targetUserId: string;
  stateCode: number;
  selectionOrder: string;
  stopAfterBlocked: number | null;
  maxConcurrency: number;
  items: readonly TScope[];
  getScopeKey: (scope: TScope) => string;
  getScopeResumeContract: (scope: TScope) => ScopeResumeContract;
  getFamilyPolicy: (scope: TScope) => FoundryScopeBatchFamilyPolicy;
  executeScope: (scope: TScope, inputIndex: number) => Promise<TRawResult>;
  recoverScopeMutation: (
    scope: TScope,
    error: unknown,
    source: "execution_error" | "resume_incomplete",
  ) => Promise<TRawResult | null> | TRawResult | null;
  recoverScopeFailure: (scope: TScope, error: unknown) => TRawResult;
  summarizeScope: (scope: TScope, result: TRawResult) => TResult;
  afterScope: () => void;
  pauseRequested: () => boolean;
  resumeItems?: readonly BatchAttemptedResumeItem[];
  onEvent?: (input: {
    event: BatchEvent;
    itemContract: BatchItemContract | null;
    scopeResumeContract: ScopeResumeContract | null;
  }) => void | Promise<void>;
}

export interface FoundryScopeBatchResult<TResult extends Record<string, unknown>> {
  results: TResult[];
  paused: boolean;
  stoppedAfterBlocked: boolean;
  unclaimedCount: number;
}

export async function runFoundryScopeBatch<
  TScope extends Record<string, unknown>,
  TRawResult extends Record<string, unknown>,
  TResult extends Record<string, unknown>,
>(
  options: RunFoundryScopeBatchOptions<TScope, TRawResult, TResult>,
): Promise<FoundryScopeBatchResult<TResult>> {
  let stoppedAfterBlocked = false;
  const scopeContracts = new Map(
    options.items.map((scope) => [
      options.getScopeKey(scope),
      options.getScopeResumeContract(scope),
    ]),
  );
  const itemContent = (scope: TScope) => ({
    scope_content_sha256: options.getScopeResumeContract(scope).content_sha256,
  });
  const itemPolicy = (scope: TScope) => {
    const family = options.getFamilyPolicy(scope);
    const resume = options.getScopeResumeContract(scope);
    return {
      scope_policy_sha256: resume.policy_sha256,
      scope_executable_sha256: resume.executable_sha256,
      scope_contract_sha256: resume.sha256,
      profile: options.profile,
      family_group_key: family.familyGroupKey,
      optimization_role: family.optimizationRole,
    };
  };
  const itemContracts = new Map(
    options.items.map((scope) => {
      const itemId = options.getScopeKey(scope);
      return [
        itemId,
        createBatchItemContract({
          item_id: itemId,
          content: itemContent(scope),
          policy: itemPolicy(scope),
        }),
      ];
    }),
  );
  const batch = await runLockedCliBatch({
    runPath: options.runPath,
    reason: `${options.profile}-scope-import`,
    identity: {
      schema: "tiangong-foundry.scope-batch.v1",
      command: options.command,
      profile: options.profile,
      out_dir: options.outDirIdentity,
      scope_file: options.scopeFileIdentity,
    },
    content: options.items.map((scope) => options.getScopeResumeContract(scope)),
    policy: {
      mode: "mutation",
      max_concurrency: options.maxConcurrency,
      target_user_id: options.targetUserId,
      state_code: options.stateCode,
      selection_order: options.selectionOrder,
      pause_file: options.pauseFileIdentity,
      stop_after_blocked: options.stopAfterBlocked,
    },
    items: options.items,
    getItemIdentity: options.getScopeKey,
    projectItemContent: itemContent,
    projectItemPolicy: itemPolicy,
    getExclusiveKey: ({ item: scope }) =>
      options.getFamilyPolicy(scope).familyGroupKey ?? `scope:${options.getScopeKey(scope)}`,
    mode: "mutation",
    maxConcurrency: options.maxConcurrency,
    execute: async ({ item: scope, input_index: inputIndex }) => {
      try {
        return options.summarizeScope(scope, await options.executeScope(scope, inputIndex));
      } finally {
        try {
          options.afterScope();
        } catch {
          // Foundry declares this callback best-effort; scheduling and ledgers remain authoritative.
        }
      }
    },
    recoverMutation: async ({ item: scope, item_id: itemId, error, source }) => {
      const recovered = await options.recoverScopeMutation(scope, error, source);
      return recovered
        ? { status: "recovered", value: options.summarizeScope(scope, recovered) }
        : {
            status: "unresolved",
            error: new FoundryScopeMutationReadbackRequiredError(itemId, { cause: error }),
          };
    },
    resumeItems: options.resumeItems,
    eventSink: (event) =>
      options.onEvent?.({
        event,
        itemContract: event.item_id ? (itemContracts.get(event.item_id) ?? null) : null,
        scopeResumeContract: event.item_id ? (scopeContracts.get(event.item_id) ?? null) : null,
      }),
    shouldPauseBeforeClaim: options.pauseRequested,
    shouldStop: ({ results_completion_order: completionResults }) => {
      if (options.stopAfterBlocked == null) return false;
      const blockedCount = completionResults.filter(
        (entry) => entry.status !== "failed" && entry.value.status === "blocked",
      ).length;
      stoppedAfterBlocked = blockedCount >= options.stopAfterBlocked;
      return stoppedAfterBlocked;
    },
  });
  const results = batch.results_completion_order.map((entry) =>
    entry.status === "failed"
      ? options.summarizeScope(entry.item, options.recoverScopeFailure(entry.item, entry.error))
      : entry.value,
  );
  return {
    results,
    paused: batch.status === "paused",
    stoppedAfterBlocked: stoppedAfterBlocked || batch.status === "stopped",
    unclaimedCount: batch.unclaimed_item_ids.length,
  };
}

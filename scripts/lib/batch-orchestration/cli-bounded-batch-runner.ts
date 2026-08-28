import {
  createBatchContract,
  runBoundedBatch,
  sha256BatchBytes,
  withBatchRunLock,
  type BatchJsonValue,
  type BatchRunResult,
  type RunBoundedBatchOptions,
} from "@tiangong-lca/cli/batch";

export type RunLockedCliBatchOptions<
  TInput,
  TOutput,
  TIdentity extends BatchJsonValue,
  TExclusiveKey extends string = string,
> = Omit<RunBoundedBatchOptions<TInput, TOutput, TIdentity, TExclusiveKey>, "contract"> & {
  runPath: string;
  reason: string;
  identity: TIdentity;
  content: BatchJsonValue;
  policy: BatchJsonValue;
};

export async function runLockedCliBatch<
  TInput,
  TOutput,
  TIdentity extends BatchJsonValue,
  TExclusiveKey extends string = string,
>(
  options: RunLockedCliBatchOptions<TInput, TOutput, TIdentity, TExclusiveKey>,
): Promise<BatchRunResult<TInput, TOutput, TIdentity>> {
  const { runPath, reason, identity, content, policy, ...batchOptions } = options;
  const contract = createBatchContract({ identity, content, policy });
  return withBatchRunLock({ runPath, identity: contract.identity, reason }, () =>
    runBoundedBatch<TInput, TOutput, TIdentity, TExclusiveKey>({
      ...batchOptions,
      contract,
    }),
  );
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
  getFamilyPolicy: (scope: TScope) => FoundryScopeBatchFamilyPolicy;
  executeScope: (scope: TScope, inputIndex: number) => Promise<TRawResult>;
  recoverScopeFailure: (scope: TScope, error: unknown) => TRawResult;
  summarizeScope: (scope: TScope, result: TRawResult) => TResult;
  afterScope: () => void;
  pauseRequested: () => boolean;
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
    content: options.items.map((scope) => ({
      scope_key: options.getScopeKey(scope),
      scope_sha256: sha256BatchBytes(JSON.stringify(scope)),
    })),
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
    projectItemContent: (scope) => ({
      scope_key: options.getScopeKey(scope),
      scope_sha256: sha256BatchBytes(JSON.stringify(scope)),
    }),
    projectItemPolicy: (scope) => {
      const family = options.getFamilyPolicy(scope);
      return {
        profile: options.profile,
        family_group_key: family.familyGroupKey,
        optimization_role: family.optimizationRole,
      };
    },
    getExclusiveKey: ({ item: scope }) => {
      const family = options.getFamilyPolicy(scope);
      return family.familyGroupKey ?? `scope:${options.getScopeKey(scope)}`;
    },
    mode: "mutation",
    maxConcurrency: options.maxConcurrency,
    execute: async ({ item: scope, input_index: inputIndex }) => {
      let rawResult: TRawResult;
      try {
        rawResult = await options.executeScope(scope, inputIndex);
      } catch (error) {
        rawResult = options.recoverScopeFailure(scope, error);
      }
      try {
        options.afterScope();
      } catch {
        // Foundry declares this callback best-effort; scheduling and ledgers remain authoritative.
      }
      return options.summarizeScope(scope, rawResult);
    },
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

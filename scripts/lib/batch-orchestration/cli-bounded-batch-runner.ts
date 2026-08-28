import {
  createBatchContract,
  runBoundedBatch,
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
  getScopeContentSha256: (scope: TScope) => string;
  getFamilyPolicy: (scope: TScope) => FoundryScopeBatchFamilyPolicy;
  executeScope: (scope: TScope, inputIndex: number) => Promise<TResult>;
  recoverScopeFailure: (scope: TScope, error: unknown) => TResult;
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
  TResult extends Record<string, unknown>,
>(
  _options: RunFoundryScopeBatchOptions<TScope, TResult>,
): Promise<FoundryScopeBatchResult<TResult>> {
  throw new Error("Foundry scope batch adapter is not implemented.");
}

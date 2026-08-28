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

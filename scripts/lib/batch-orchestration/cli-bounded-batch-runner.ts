import type {
  BatchJsonValue,
  BatchRunResult,
  RunBoundedBatchOptions,
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
  _options: RunLockedCliBatchOptions<TInput, TOutput, TIdentity, TExclusiveKey>,
): Promise<BatchRunResult<TInput, TOutput, TIdentity>> {
  throw new Error("CLI bounded batch runner is not implemented.");
}

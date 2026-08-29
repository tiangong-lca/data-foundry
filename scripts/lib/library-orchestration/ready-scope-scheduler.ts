import type { BatchJsonObject, BatchRunResult } from "@tiangong-lca/cli/batch";

import { runLockedCliBatch } from "../batch-orchestration/cli-bounded-batch-runner.ts";

export interface ReadyScopeScheduleItem extends Record<string, unknown> {
  process_id: string;
  process_version: string;
  state: string;
  input_index: number;
  content_sha256: string;
  commit_spec_sha256: string | null;
  verify_spec_sha256: string | null;
}

interface ScopeBatchIdentity extends BatchJsonObject {
  schema: string;
  scope_file: string | null;
  library_resolution: string;
  cli_package: string;
}

export interface ReadyScopeScheduleOptions<TItem extends ReadyScopeScheduleItem, TResult> {
  runPath: string;
  scopeFile: string | null;
  libraryResolution: string;
  cliPackage: string;
  commit: boolean;
  parallel: number;
  items: TItem[];
  execute: (item: TItem) => Promise<TResult>;
  pauseRequested?: () => boolean;
  shouldStop?: (completedResults: readonly TResult[]) => boolean;
}

export function scheduleReadyScopes<TItem extends ReadyScopeScheduleItem, TResult>({
  runPath,
  scopeFile,
  libraryResolution,
  cliPackage,
  commit,
  parallel,
  items,
  execute,
  pauseRequested,
  shouldStop: stopRequested,
}: ReadyScopeScheduleOptions<TItem, TResult>): Promise<
  BatchRunResult<TItem, TResult, ScopeBatchIdentity>
> {
  return runLockedCliBatch<TItem, TResult, ScopeBatchIdentity>({
    runPath,
    reason: "library-process-scope-run",
    identity: {
      schema: "tiangong-foundry.process-scope-batch.v1",
      scope_file: scopeFile,
      library_resolution: libraryResolution,
      cli_package: cliPackage,
    },
    content: items.map((scope) => ({
      process_id: scope.process_id,
      process_version: scope.process_version,
      content_sha256: scope.content_sha256,
    })),
    policy: { mode: commit ? "mutation" : "read", max_concurrency: parallel },
    items,
    getItemIdentity: (scope) => `${scope.input_index}:${scope.process_id}@${scope.process_version}`,
    projectItemContent: (scope) => ({ content_sha256: scope.content_sha256 }),
    projectItemPolicy: (scope) => ({
      state: scope.state,
      commit_spec_sha256: scope.commit_spec_sha256,
      verify_spec_sha256: scope.verify_spec_sha256,
    }),
    getExclusiveKey: ({ item: scope }) => `process:${scope.process_id}:${scope.process_version}`,
    mode: commit ? "mutation" : "read",
    maxConcurrency: parallel,
    execute: ({ item }) => execute(item),
    ...(pauseRequested ? { shouldPauseBeforeClaim: pauseRequested } : {}),
    ...(stopRequested
      ? {
          shouldStop: ({ results_completion_order: results }) =>
            stopRequested(
              results.reduce<TResult[]>((values, result) => {
                if (result.status === "succeeded") values.push(result.value);
                return values;
              }, []),
            ),
        }
      : {}),
  });
}

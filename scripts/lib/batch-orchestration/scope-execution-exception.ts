type JsonRecord = Record<string, unknown>;

export interface ScopeExecutionExceptionAdapter {
  processExecPath: string;
  foundryEntryPath: string;
  commandName: () => string;
  nowIso: () => string;
  asText: (value: unknown) => string;
  repoRelative: (filePath: string) => string;
  commandString: (argv: string[]) => string;
  familyPlanFields: (signature: unknown) => JsonRecord;
  blockRow: (input: {
    scope: JsonRecord;
    stage: string;
    blocker: JsonRecord;
    report: string | null;
    rerunCommand: string;
  }) => JsonRecord;
  appendJsonLine: (filePath: string, row: JsonRecord) => void;
}

export function createScopeExecutionExceptionRecorder(adapter: ScopeExecutionExceptionAdapter) {
  return ({
    scope,
    familySignature,
    error,
    paths,
  }: {
    scope: JsonRecord;
    familySignature: unknown;
    error: unknown;
    paths: JsonRecord;
  }): JsonRecord => {
    const processId = adapter.asText(scope.process_id || scope.id);
    const processVersion = adapter.asText(scope.process_version || scope.version) || "00.00.001";
    const errorName = error instanceof Error ? error.name : "";
    const ambiguous = [
      "FoundryScopeMutationReadbackRequiredError",
      "BatchItemResumeContractError",
    ].includes(errorName);
    const row = adapter.blockRow({
      scope,
      stage: "scope_execution",
      blocker: {
        code: ambiguous ? "scope_mutation_readback_required" : "scope_execution_exception",
        message: `Uncaught error during scope execution: ${error instanceof Error ? error.message : String(error)}`,
        retryable: !ambiguous,
        retryable_reason_code: ambiguous ? null : "scope_execution_exception",
        required_human_action: ambiguous
          ? "Run exact-account readback recovery for this consumed mutation attempt. Do not replay the mutation or use --force to bypass recovery."
          : "Transient runtime error during scope execution. Rerun the exact scope command; if it persists, retry with --parallel 1.",
      },
      report: null,
      rerunCommand: adapter.commandString([
        adapter.processExecPath,
        adapter.foundryEntryPath,
        adapter.commandName(),
        "--scope-file",
        adapter.repoRelative(adapter.asText(paths.scopeFile)),
        "--process-bundles-dir",
        adapter.repoRelative(adapter.asText(paths.processBundlesDir)),
        "--run-dir",
        adapter.repoRelative(adapter.asText(paths.runDir)),
        "--out-dir",
        adapter.repoRelative(adapter.asText(paths.outDir)),
        "--process-id",
        processId,
        "--commit",
        "--parallel",
        "1",
      ]),
    });
    adapter.appendJsonLine(
      adapter.asText(ambiguous ? paths.ambiguousNoReplay : paths.failedRetry),
      row,
    );
    adapter.appendJsonLine(adapter.asText(paths.blocked_remote_write), row);
    adapter.appendJsonLine(adapter.asText(paths.scopeCheckpoints), {
      schema_version: 1,
      generated_at_utc: adapter.nowIso(),
      process_id: processId,
      process_version: processVersion,
      scope_lock: `process:${processId}:${processVersion}`,
      ...adapter.familyPlanFields(familySignature),
      state: ambiguous ? "ambiguous_readback_required" : "failed_retryable",
      stage: "scope_execution",
      code: row.code,
    });
    return {
      status: ambiguous ? "ambiguous" : "failed",
      checkpoint: { state: ambiguous ? "ambiguous_readback_required" : "failed_retryable" },
      block: row,
      stages: [],
    };
  };
}

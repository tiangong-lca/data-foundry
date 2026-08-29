import type { BatchJsonValue } from "@tiangong-lca/cli/batch";

import {
  createScopeResumeContract,
  scopeResumeMismatchReason,
  type ScopeResumeContract,
} from "../batch-orchestration/scope-resume-contract.ts";

type JsonRecord = Record<string, unknown>;

export const BAFU_PROCESS_SCOPE_STAGE_POLICY =
  "tiangong-foundry.bafu-process-scope-stage-policy.v1" as const;

export interface CreateProcessScopeResumeContractInput {
  commandName: string;
  processScope: JsonRecord;
  inputHashes: JsonRecord;
  options: JsonRecord;
  finalizeCommand: readonly string[];
  cliPackage: string;
  stagePolicy?: string;
}

export interface ProcessScopeCheckpointAdapter {
  exists: (filePath: string | null) => boolean;
  readJsonLines: (filePath: string) => JsonRecord[];
  resolve: (value: unknown) => string | null;
  fileSha256: (filePath: string) => string;
}

function batchJson(value: unknown): BatchJsonValue {
  return JSON.parse(JSON.stringify(value)) as BatchJsonValue;
}

function policyOptions(options: JsonRecord): JsonRecord {
  const policy = { ...options };
  delete policy.force;
  delete policy.resume;
  return policy;
}

export function createProcessScopeResumeContract({
  commandName,
  processScope,
  inputHashes,
  options,
  finalizeCommand,
  cliPackage,
  stagePolicy = BAFU_PROCESS_SCOPE_STAGE_POLICY,
}: CreateProcessScopeResumeContractInput): ScopeResumeContract {
  const id = String(processScope.id ?? processScope.process_id ?? "").trim();
  const version = String(processScope.version ?? processScope.process_version ?? "00.00.001");
  return createScopeResumeContract({
    identityKey: `${id}@${version || "00.00.001"}`,
    content: batchJson({ process_scope: processScope, input_hashes: inputHashes }),
    policy: batchJson({ command: commandName, options: policyOptions(options) }),
    executable: batchJson({
      cli_package: cliPackage,
      stage_policy: stagePolicy,
      finalize_argv: finalizeCommand,
    }),
  });
}

export function latestProcessScopeFinalizeCheckpoint({
  ledgerPath,
  contract,
  adapter,
}: {
  ledgerPath: string;
  contract: ScopeResumeContract;
  adapter: ProcessScopeCheckpointAdapter;
}): JsonRecord | null {
  if (!adapter.exists(ledgerPath)) return null;
  for (const row of adapter.readJsonLines(ledgerPath).toReversed()) {
    if (row.stage !== "post_authoring_finalize") continue;
    if (scopeResumeMismatchReason(row.resume_contract, contract) !== null) continue;
    const reportPath = adapter.resolve((row.files as JsonRecord | undefined)?.finalize_report);
    if (!adapter.exists(reportPath)) continue;
    if (row.finalize_report_sha256 !== adapter.fileSha256(reportPath!)) continue;
    return row;
  }
  return null;
}

export function resolveProcessScopeResume({
  enabled,
  ledgerPath,
  contractInput,
  adapter,
}: {
  enabled: boolean;
  ledgerPath: string;
  contractInput: CreateProcessScopeResumeContractInput;
  adapter: ProcessScopeCheckpointAdapter;
}): { contract: ScopeResumeContract; checkpoint: JsonRecord | null } {
  const contract = createProcessScopeResumeContract(contractInput);
  return {
    contract,
    checkpoint: enabled
      ? latestProcessScopeFinalizeCheckpoint({ ledgerPath, contract, adapter })
      : null,
  };
}

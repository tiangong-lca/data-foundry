import {
  sha256BatchJson,
  type BatchJsonObject,
  type BatchJsonValue,
} from "@tiangong-lca/cli/batch";

export const SCOPE_RESUME_CONTRACT_SCHEMA = "tiangong-foundry.scope-resume-contract.v1" as const;
export const BAFU_SCOPE_STAGE_POLICY = "tiangong-foundry.bafu-scope-stage-policy.v1" as const;

export interface ScopeResumeContract extends BatchJsonObject {
  schema: typeof SCOPE_RESUME_CONTRACT_SCHEMA;
  identity_key: string;
  content_sha256: string;
  policy_sha256: string;
  executable_sha256: string;
  sha256: string;
}

export interface CreateScopeResumeContractInput {
  identityKey: string;
  content: BatchJsonValue;
  policy: BatchJsonValue;
  executable: BatchJsonValue;
}

export interface BafuScopeResumeContext {
  command: string;
  profile: string;
  targetUserId: string;
  stateCode: number;
  commit: boolean;
  parallel: number;
  requireLeafClassification: boolean;
  selectionOrder: string;
  applyResolutionRewrites: boolean;
  familySignatures: boolean;
  mintUnmatchedFpUgSupport: boolean;
  cliPackage: string;
  sourceContent?: BatchJsonValue;
  stagePolicy?: string;
}

type JsonRecord = Record<string, unknown>;

function jsonRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : {};
}

function batchJson(value: unknown): BatchJsonValue {
  const text = JSON.stringify(value);
  if (text === undefined) throw new TypeError("Resume contract input must be JSON serializable.");
  return JSON.parse(text) as BatchJsonValue;
}

function contractAuthority(contract: Omit<ScopeResumeContract, "sha256">): BatchJsonObject {
  return {
    schema: contract.schema,
    identity_key: contract.identity_key,
    content_sha256: contract.content_sha256,
    policy_sha256: contract.policy_sha256,
    executable_sha256: contract.executable_sha256,
  };
}

function scopeContent(scope: JsonRecord): JsonRecord {
  const content = { ...scope };
  delete content.commit_command;
  delete content.verify_command;
  const handoff = jsonRecord(content.commit_handoff);
  if (Object.keys(handoff).length > 0) {
    content.commit_handoff = { ...handoff };
    delete jsonRecord(content.commit_handoff).commit_command;
    delete jsonRecord(content.commit_handoff).verify_command;
  }
  return content;
}

export function createScopeResumeContract({
  identityKey,
  content,
  policy,
  executable,
}: CreateScopeResumeContractInput): ScopeResumeContract {
  const authority = {
    schema: SCOPE_RESUME_CONTRACT_SCHEMA,
    identity_key: identityKey,
    content_sha256: sha256BatchJson(content),
    policy_sha256: sha256BatchJson(policy),
    executable_sha256: sha256BatchJson(executable),
  };
  return { ...authority, sha256: sha256BatchJson(contractAuthority(authority)) };
}

export function createBafuScopeResumeContract(
  scope: JsonRecord,
  context: BafuScopeResumeContext,
): ScopeResumeContract {
  const processId = String(scope.process_id ?? scope.id ?? "").trim();
  const processVersion = String(scope.process_version ?? scope.version ?? "00.00.001").trim();
  const commitSpec = jsonRecord(
    scope.commit_command ?? jsonRecord(scope.commit_handoff).commit_command,
  );
  const verifySpec = jsonRecord(
    scope.verify_command ?? jsonRecord(scope.commit_handoff).verify_command,
  );
  const commandSpecs = batchJson({ commit: commitSpec, verify: verifySpec });
  return createScopeResumeContract({
    identityKey: `${processId}@${processVersion || "00.00.001"}`,
    content: batchJson({ scope: scopeContent(scope), source: context.sourceContent ?? null }),
    policy: batchJson({
      command: context.command,
      profile: context.profile,
      target_user_id: context.targetUserId,
      state_code: context.stateCode,
      commit: context.commit,
      parallel: context.parallel,
      require_leaf_classification: context.requireLeafClassification,
      selection_order: context.selectionOrder,
      apply_resolution_rewrites: context.applyResolutionRewrites,
      family_signatures: context.familySignatures,
      mint_unmatched_fp_ug_support: context.mintUnmatchedFpUgSupport,
    }),
    executable: batchJson({
      cli_package: context.cliPackage,
      stage_policy: context.stagePolicy ?? BAFU_SCOPE_STAGE_POLICY,
      command_specs_sha256:
        Object.keys(commitSpec).length + Object.keys(verifySpec).length > 0
          ? sha256BatchJson(commandSpecs)
          : null,
    }),
  });
}

export function scopeResumeMismatchReason(
  value: unknown,
  expected: ScopeResumeContract,
): string | null {
  const actual = jsonRecord(value);
  if (actual.schema !== SCOPE_RESUME_CONTRACT_SCHEMA) return "legacy_resume_contract_missing";
  if (actual.identity_key !== expected.identity_key) return "resume_identity_drift";
  if (actual.content_sha256 !== expected.content_sha256) return "resume_content_drift";
  if (actual.policy_sha256 !== expected.policy_sha256) return "resume_policy_drift";
  if (actual.executable_sha256 !== expected.executable_sha256) return "resume_executable_drift";
  if (actual.sha256 !== expected.sha256) return "resume_contract_drift";
  return null;
}

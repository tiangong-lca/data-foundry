import fs from "node:fs";
import { createHash } from "node:crypto";
import {
  type FullContextAiCompletion,
  normalizeFullContextAiCompletion,
} from "./context-inputs.ts";
import {
  type DatasetTypeOptions,
  datasetTypeFromOptions,
  defaultProfilesFile,
  fallbackProfiles,
} from "./dataset-types.ts";
import { ensureArray, optionList, readJsonIfExists, resolveRepoPath } from "./runtime-io.ts";
import { sha256Json } from "../../identity-preflight-proof.ts";
import {
  type ValidatedTaskAuthorization,
  taskAuthorizationMatches,
} from "../../task-authorization.ts";

interface JsonRecord {
  [key: string]: unknown;
}

interface RawProfile extends JsonRecord {
  id?: unknown;
  description?: unknown;
  docs?: unknown;
  waivedQaCodesByType?: unknown;
  waived_qa_codes_by_type?: unknown;
  waivedContentPolicyRulesByType?: unknown;
  waived_content_policy_rules_by_type?: unknown;
  waiverReasons?: unknown;
  waiver_reasons?: unknown;
  fullContextAiCompletion?: unknown;
  full_context_ai_completion?: unknown;
  allowAccountLocalSupportAndElementary?: unknown;
  allow_account_local_support_and_elementary?: unknown;
}

interface ProfilesConfig extends JsonRecord {
  schema_version?: unknown;
  default_profile?: unknown;
  profiles?: unknown;
}

interface ProfileOptions extends DatasetTypeOptions, JsonRecord {
  profilesFile?: unknown;
  profileDoc?: unknown;
  profileDocs?: unknown;
  waiveQa?: unknown;
  waiveQaCode?: unknown;
  waivedQaCode?: unknown;
  taskAuthorization?: unknown;
  taskAuthorizationBinding?: unknown;
}

interface ListProfilesInput {
  repoRoot?: string;
  options?: ProfileOptions;
}

export interface NormalizedProfile {
  id: string;
  description: unknown;
  docs: unknown[];
  waivedQaCodesByType: JsonRecord;
  waiverReasons: JsonRecord;
  fullContextAiCompletion: FullContextAiCompletion;
  domainRules: JsonRecord;
  authorization: ValidatedTaskAuthorization | null;
  rulesSha256: string;
}

export interface ImportProfilesList {
  schema_version: unknown;
  profiles_file: unknown;
  default_profile: unknown;
  profiles: Record<string, JsonRecord>;
}

export function normalizeProfile(rawProfile: unknown, profileId: unknown): NormalizedProfile {
  const profile = (rawProfile && typeof rawProfile === "object" ? rawProfile : {}) as RawProfile;
  const fullContext = profile.fullContextAiCompletion ?? profile.full_context_ai_completion;
  const scopedRelaxation =
    fullContext && typeof fullContext === "object" && "scoped_relaxation" in fullContext;
  return {
    id: String(profile.id ?? profileId ?? "generic"),
    description: profile.description ?? "",
    docs: ensureArray(profile.docs),
    // Legacy profile files are readable rule inputs, never executable approval.
    waivedQaCodesByType: {},
    waiverReasons: (profile.waiverReasons ?? profile.waiver_reasons ?? {}) as JsonRecord,
    fullContextAiCompletion: normalizeFullContextAiCompletion(
      scopedRelaxation ? { ...fullContext, required: true } : fullContext,
    ),
    domainRules: (profile.domain_rules ?? {}) as JsonRecord,
    authorization: null,
    rulesSha256: sha256Json(rawProfile ?? {}),
  };
}

export function readProfilesConfig(
  repoRoot: string,
  profilesFile: unknown = defaultProfilesFile,
): ProfilesConfig {
  const resolved = resolveRepoPath(repoRoot, profilesFile as string | null | undefined);
  return readJsonIfExists<ProfilesConfig>(resolved!) ?? fallbackProfiles;
}

// part-06.mjs
export function profileFor(
  repoRoot: string,
  profileId: unknown,
  options: ProfileOptions = {},
): NormalizedProfile {
  const config = readProfilesConfig(repoRoot, options.profilesFile);
  const requestedId = String(profileId || config.default_profile || "generic")
    .trim()
    .toLowerCase();
  const profiles = (config.profiles ?? {}) as Record<string, unknown>;
  const selected = profiles[requestedId] ?? profiles.generic ?? fallbackProfiles.profiles.generic;
  const profile = normalizeProfile(selected, requestedId);
  const extraDocs = optionList(options.profileDoc ?? options.profileDocs);
  const extraWaivers = optionList(options.waiveQa ?? options.waiveQaCode ?? options.waivedQaCode);
  if (extraWaivers.length > 0) datasetTypeFromOptions(options);
  const approval = options.taskAuthorization;
  let authorization =
    taskAuthorizationMatches(approval, options.taskAuthorizationBinding) &&
    approval.binding.profile_id === profile.id &&
    approval.binding.profile_sha256 === sha256Json(selected)
      ? approval
      : null;
  const inputPath = authorization
    ? resolveRepoPath(
        repoRoot,
        (options.rowsFile || options.input || options.rows) as string | null | undefined,
      )
    : null;
  if (authorization && inputPath) {
    const currentInputSha256 = fs.existsSync(inputPath)
      ? createHash("sha256").update(fs.readFileSync(inputPath)).digest("hex")
      : null;
    if (authorization.binding.input_scope_sha256 !== currentInputSha256) authorization = null;
  }
  return {
    ...profile,
    docs: [...profile.docs, ...extraDocs],
    authorization,
    waivedQaCodesByType: authorization?.qa_waivers.length
      ? { process: authorization.qa_waivers.map((waiver) => waiver.code) }
      : {},
  };
}

export function listImportProfiles({
  repoRoot,
  options = {},
}: ListProfilesInput = {}): ImportProfilesList {
  const config = readProfilesConfig(repoRoot!, options.profilesFile);
  const profiles = Object.fromEntries(
    Object.entries((config.profiles ?? {}) as Record<string, unknown>).map(([id, profile]) => {
      const normalized = normalizeProfile(profile, id);
      return [
        id,
        {
          id: normalized.id,
          description: normalized.description,
          docs: normalized.docs,
          waived_qa_codes_by_type: normalized.waivedQaCodesByType,
          full_context_ai_completion: normalized.fullContextAiCompletion,
        },
      ];
    }),
  );
  return {
    schema_version: config.schema_version ?? 1,
    profiles_file: options.profilesFile ?? defaultProfilesFile,
    default_profile: config.default_profile ?? "generic",
    profiles,
  };
}

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

interface AccountLocalSupportOverride extends JsonRecord {
  enabled?: unknown;
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
  waivedContentPolicyRulesByType: JsonRecord;
  waiverReasons: JsonRecord;
  fullContextAiCompletion: FullContextAiCompletion;
  allowAccountLocalSupportAndElementary: boolean;
  accountLocalSupportOverride: unknown;
}

export interface ImportProfilesList {
  schema_version: unknown;
  profiles_file: unknown;
  default_profile: unknown;
  profiles: Record<string, JsonRecord>;
}

export function normalizeProfile(rawProfile: unknown, profileId: unknown): NormalizedProfile {
  const profile = (rawProfile && typeof rawProfile === "object" ? rawProfile : {}) as RawProfile;
  return {
    id: String(profile.id ?? profileId ?? "generic"),
    description: profile.description ?? "",
    docs: ensureArray(profile.docs),
    waivedQaCodesByType: (profile.waivedQaCodesByType ??
      profile.waived_qa_codes_by_type ??
      {}) as JsonRecord,
    // Per-profile waivers for prewrite-content-policy rule codes (e.g.
    // source_locator_in_dataset_name), keyed by dataset type. Distinct from
    // waivedQaCodesByType (deterministic-QA findings): these silence a content-policy
    // marker that is a FALSE POSITIVE for a profile's legitimate naming convention.
    // worldsteel process names are "<product> <route> <geography> <data-year>" (e.g.
    // "Steel rebar Global 2022"); the trailing "<Geo> <Year>" trips the latin-author-year
    // marker even though it is reference metadata, not a citation locator.
    waivedContentPolicyRulesByType: (profile.waivedContentPolicyRulesByType ??
      profile.waived_content_policy_rules_by_type ??
      {}) as JsonRecord,
    waiverReasons: (profile.waiverReasons ?? profile.waiver_reasons ?? {}) as JsonRecord,
    fullContextAiCompletion: normalizeFullContextAiCompletion(
      profile.fullContextAiCompletion ?? profile.full_context_ai_completion,
    ),
    allowAccountLocalSupportAndElementary: Boolean(
      (
        (profile.allow_account_local_support_and_elementary ??
          profile.allowAccountLocalSupportAndElementary) as
          AccountLocalSupportOverride | null | undefined
      )?.enabled,
    ),
    accountLocalSupportOverride:
      profile.allow_account_local_support_and_elementary ??
      profile.allowAccountLocalSupportAndElementary ??
      null,
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
  return {
    ...profile,
    docs: [...profile.docs, ...extraDocs],
    waivedQaCodesByType: {
      ...profile.waivedQaCodesByType,
      ...(extraWaivers.length > 0
        ? {
            [datasetTypeFromOptions(options)]: [
              ...ensureArray(profile.waivedQaCodesByType?.[datasetTypeFromOptions(options)]),
              ...extraWaivers,
            ],
          }
        : {}),
    },
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

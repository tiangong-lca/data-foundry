import { normalizeFullContextAiCompletion } from "./context-inputs.ts";
import { datasetTypeFromOptions, defaultProfilesFile, fallbackProfiles } from "./dataset-types.ts";
import { ensureArray, optionList, readJsonIfExists, resolveRepoPath } from "./runtime-io.ts";

export function normalizeProfile(rawProfile, profileId) {
  const profile = rawProfile && typeof rawProfile === "object" ? rawProfile : {};
  return {
    id: String(profile.id ?? profileId ?? "generic"),
    description: profile.description ?? "",
    docs: ensureArray(profile.docs),
    waivedQaCodesByType: profile.waivedQaCodesByType ?? profile.waived_qa_codes_by_type ?? {},
    // Per-profile waivers for prewrite-content-policy rule codes (e.g.
    // source_locator_in_dataset_name), keyed by dataset type. Distinct from
    // waivedQaCodesByType (deterministic-QA findings): these silence a content-policy
    // marker that is a FALSE POSITIVE for a profile's legitimate naming convention.
    // worldsteel process names are "<product> <route> <geography> <data-year>" (e.g.
    // "Steel rebar Global 2022"); the trailing "<Geo> <Year>" trips the latin-author-year
    // marker even though it is reference metadata, not a citation locator.
    waivedContentPolicyRulesByType:
      profile.waivedContentPolicyRulesByType ?? profile.waived_content_policy_rules_by_type ?? {},
    waiverReasons: profile.waiverReasons ?? profile.waiver_reasons ?? {},
    fullContextAiCompletion: normalizeFullContextAiCompletion(
      profile.fullContextAiCompletion ?? profile.full_context_ai_completion,
    ),
    allowAccountLocalSupportAndElementary: Boolean(
      (
        profile.allow_account_local_support_and_elementary ??
        profile.allowAccountLocalSupportAndElementary
      )?.enabled,
    ),
    accountLocalSupportOverride:
      profile.allow_account_local_support_and_elementary ??
      profile.allowAccountLocalSupportAndElementary ??
      null,
  };
}

export function readProfilesConfig(repoRoot, profilesFile = defaultProfilesFile) {
  const resolved = resolveRepoPath(repoRoot, profilesFile);
  return readJsonIfExists(resolved) ?? fallbackProfiles;
}

// part-06.mjs
export function profileFor(repoRoot, profileId, options = {}) {
  const config = readProfilesConfig(repoRoot, options.profilesFile);
  const requestedId = String(profileId || config.default_profile || "generic")
    .trim()
    .toLowerCase();
  const profiles = config.profiles ?? {};
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

export function listImportProfiles({ repoRoot, options = {} } = {}) {
  const config = readProfilesConfig(repoRoot, options.profilesFile);
  const profiles = Object.fromEntries(
    Object.entries(config.profiles ?? {}).map(([id, profile]) => {
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

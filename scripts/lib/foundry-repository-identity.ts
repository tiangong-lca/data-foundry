/**
 * Release identities are historical facts, not aliases chosen by a caller.
 * CLI #312 / Foundry #161 verified the last pre-transfer releases and GitHub IDs:
 * the legacy owner account (id 199785309, now `tiangong-lca-admin`) published
 * Foundry through 0.1.8 and CLI through 0.1.14 from the pre-transfer repository
 * names; the current organization (id 327771381) owns the renamed repositories.
 * The numeric repository IDs are the continuity anchors and never changed.
 * Keep this module dependency-free so Node 24 loads it without a build step.
 */
export const FOUNDRY_LEGACY_LAST_VERSION = "0.1.8" as const;
export const FOUNDRY_REPOSITORY_ID = "1260957221" as const;
export const CLI_LEGACY_LAST_VERSION = "0.1.14" as const;
export const CLI_REPOSITORY_ID = "1194220834" as const;
export const LEGACY_OWNER_ID = "199785309" as const;
export const CURRENT_OWNER_ID = "327771381" as const;

interface SourceProfile {
  readonly epoch: "legacy" | "current";
  readonly repository: string;
  readonly repositoryId: string;
  readonly ownerId: string;
}

const foundryLegacy: SourceProfile = Object.freeze({
  epoch: "legacy",
  repository: "tiangong-lca/data-foundry",
  repositoryId: FOUNDRY_REPOSITORY_ID,
  ownerId: LEGACY_OWNER_ID,
});
const foundryCurrent: SourceProfile = Object.freeze({
  epoch: "current",
  repository: "tiangong-lca/foundry",
  repositoryId: FOUNDRY_REPOSITORY_ID,
  ownerId: CURRENT_OWNER_ID,
});
const cliLegacy: SourceProfile = Object.freeze({
  epoch: "legacy",
  repository: "tiangong-lca/tiangong-cli",
  repositoryId: CLI_REPOSITORY_ID,
  ownerId: LEGACY_OWNER_ID,
});
const cliCurrent: SourceProfile = Object.freeze({
  epoch: "current",
  repository: "tiangong-lca/cli",
  repositoryId: CLI_REPOSITORY_ID,
  ownerId: CURRENT_OWNER_ID,
});

function stableReleaseVersion(version: string, label: string): [bigint, bigint, bigint] {
  if (
    typeof version !== "string" ||
    version.length > 64 ||
    !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u.test(version)
  )
    throw new Error(`${label} source identity requires a stable canonical release version.`);
  const parts = version.split(".").map((part) => BigInt(part));
  if (parts.length !== 3 || parts.some((part) => part > BigInt(Number.MAX_SAFE_INTEGER)))
    throw new Error(`${label} source identity version is outside the supported range.`);
  return [parts[0], parts[1], parts[2]];
}

/** Legacy ceiling: published through 0.1.8 from `tiangong-lca/data-foundry`. */
export function foundryRepositoryIdentity(version: string): SourceProfile {
  const [major, minor, patch] = stableReleaseVersion(version, "Foundry");
  return major === 0n && (minor === 0n || (minor === 1n && patch <= 8n))
    ? foundryLegacy
    : foundryCurrent;
}

/**
 * Profile of the exact CLI dependency verified by the Foundry release pipeline
 * (CLI #312 decision; no CLI module is imported here).
 */
export function cliDependencyIdentity(version: string): SourceProfile {
  const [major, minor, patch] = stableReleaseVersion(version, "CLI");
  return major === 0n && (minor === 0n || (minor === 1n && patch <= 14n)) ? cliLegacy : cliCurrent;
}

import assert from "node:assert/strict";
import test from "node:test";
import {
  CLI_LEGACY_LAST_VERSION,
  CLI_REPOSITORY_ID,
  CURRENT_OWNER_ID,
  FOUNDRY_LEGACY_LAST_VERSION,
  FOUNDRY_REPOSITORY_ID,
  LEGACY_OWNER_ID,
  cliDependencyIdentity,
  foundryRepositoryIdentity,
} from "../../scripts/lib/foundry-repository-identity.ts";
import { npmReleasePolicy } from "../../scripts/lib/foundry-release-provenance.ts";

test("the verified numeric anchors are the frozen historical facts", () => {
  assert.equal(FOUNDRY_REPOSITORY_ID, "1260957221");
  assert.equal(CLI_REPOSITORY_ID, "1194220834");
  assert.equal(LEGACY_OWNER_ID, "199785309");
  assert.equal(CURRENT_OWNER_ID, "327771381");
  assert.equal(FOUNDRY_LEGACY_LAST_VERSION, "0.1.8");
  assert.equal(CLI_LEGACY_LAST_VERSION, "0.1.14");
});

test("foundry versions through the ceiling keep their legacy source profile", () => {
  for (const version of ["0.0.1", "0.0.33", "0.1.0", "0.1.7", "0.1.8"]) {
    const identity = foundryRepositoryIdentity(version);
    assert.equal(identity.epoch, "legacy", version);
    assert.equal(identity.repository, "tiangong-lca/data-foundry", version);
    assert.equal(identity.repositoryId, "1260957221", version);
    assert.equal(identity.ownerId, "199785309", version);
  }
});

test("foundry versions above the ceiling use only the current source profile", () => {
  for (const version of ["0.1.9", "0.1.10", "0.2.0", "1.0.0"]) {
    const identity = foundryRepositoryIdentity(version);
    assert.equal(identity.epoch, "current", version);
    assert.equal(identity.repository, "tiangong-lca/foundry", version);
    assert.equal(identity.repositoryId, "1260957221", version);
    assert.equal(identity.ownerId, "327771381", version);
  }
});

test("cli dependency profiles follow the CLI #312 version decision", () => {
  for (const version of ["0.0.2", "0.1.9", "0.1.14"]) {
    const identity = cliDependencyIdentity(version);
    assert.equal(identity.epoch, "legacy", version);
    assert.equal(identity.repository, "tiangong-lca/tiangong-cli", version);
    assert.equal(identity.repositoryId, "1194220834", version);
    assert.equal(identity.ownerId, "199785309", version);
  }
  for (const version of ["0.1.15", "0.2.0", "1.0.0"]) {
    const identity = cliDependencyIdentity(version);
    assert.equal(identity.epoch, "current", version);
    assert.equal(identity.repository, "tiangong-lca/cli", version);
    assert.equal(identity.repositoryId, "1194220834", version);
    assert.equal(identity.ownerId, "327771381", version);
  }
});

test("malformed release versions never receive a source identity", () => {
  for (const version of ["latest", "0.1.8-beta", "01.1.8", "0.1.8.1", "", "0.1.8 ".trim() + "x"]) {
    assert.throws(() => foundryRepositoryIdentity(version), /version/iu, version);
    assert.throws(() => cliDependencyIdentity(version), /version/iu, version);
  }
});

test("npm policies carry exactly one version-bound identity across packages", () => {
  const legacyFoundry = npmReleasePolicy({
    package: "foundry",
    version: "0.1.8",
    gitHead: "a".repeat(40),
  });
  assert.equal(legacyFoundry.epoch, "legacy");
  assert.equal(legacyFoundry.repository, "https://github.com/tiangong-lca/data-foundry");
  assert.equal(legacyFoundry.repositoryId, "1260957221");
  assert.equal(legacyFoundry.ownerId, "199785309");
  assert.equal(legacyFoundry.workflow, ".github/workflows/publish.yml");
  const currentFoundry = npmReleasePolicy({
    package: "foundry",
    version: "0.1.9",
    gitHead: "a".repeat(40),
  });
  assert.equal(currentFoundry.epoch, "current");
  assert.equal(currentFoundry.repository, "https://github.com/tiangong-lca/foundry");
  assert.equal(currentFoundry.ownerId, "327771381");
  assert.equal(currentFoundry.workflow, ".github/workflows/publish.yml");
  const legacyCli = npmReleasePolicy({
    package: "cli",
    version: "0.1.14",
    gitHead: "a".repeat(40),
  });
  assert.equal(legacyCli.epoch, "legacy");
  assert.equal(legacyCli.repository, "https://github.com/tiangong-lca/tiangong-cli");
  assert.equal(legacyCli.repositoryId, "1194220834");
  assert.equal(legacyCli.ownerId, "199785309");
  const currentCli = npmReleasePolicy({
    package: "cli",
    version: "0.1.15",
    gitHead: "a".repeat(40),
  });
  assert.equal(currentCli.epoch, "current");
  assert.equal(currentCli.repository, "https://github.com/tiangong-lca/cli");
  assert.equal(currentCli.ownerId, "327771381");
});

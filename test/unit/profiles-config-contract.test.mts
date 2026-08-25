import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import * as profilesConfig from "../../scripts/lib/import-curation/internal/profiles-config.mjs";
import { fallbackProfiles } from "../../scripts/lib/import-curation/internal/dataset-types.ts";

function writeText(filePath: string, text: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, text);
}

function writeJson(filePath: string, value: unknown): void {
  writeText(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function withTempRoot(name: string, body: (root: string) => void): void {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `${name}-`));
  try {
    body(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

const customProfiles = {
  schema_version: 7,
  default_profile: "zeta",
  profiles: {
    zeta: {
      id: "ZETA",
      description: "Zeta profile",
      docs: ["docs/zeta.md", "docs/shared.md"],
      waived_qa_codes_by_type: { process: ["base-waiver"] },
      waived_content_policy_rules_by_type: { process: ["content-waiver"] },
      waiver_reasons: { "process:base-waiver": "source convention" },
      full_context_ai_completion: {
        required: true,
        dataset_types: [" PROCESS ", "flow", "process"],
        required_context_kinds: [" schema ", "ruleset"],
        required_context_file_patterns: ["schema.json", "runtime-ruleset.json"],
        proof: "exact proof",
      },
      allow_account_local_support_and_elementary: {
        enabled: true,
        reason: "bounded override",
      },
    },
    alpha: {
      description: "Alpha profile",
      docs: "docs/alpha.md",
      waivedQaCodesByType: { flow: ["camel-waiver"] },
      fullContextAiCompletion: { require: false },
    },
    primitive: "invalid-profile",
  },
};

test("profile normalization preserves snake/camel precedence, scalar envelopes, aliases, and raw overrides", () => {
  const snakeWaivers = { process: ["snake"] };
  const camelWaivers = { process: ["camel"] };
  const snakeContent = { process: ["snake-content"] };
  const camelContent = { process: ["camel-content"] };
  const snakeReasons = { "process:snake": "reason" };
  const camelReasons = { camel: "preferred" };
  const snakeOverride = { enabled: false, reason: "snake-wins" };
  const normalized = profilesConfig.normalizeProfile(
    {
      id: 42,
      description: { localized: true },
      docs: "docs/one.md",
      waivedQaCodesByType: camelWaivers,
      waived_qa_codes_by_type: snakeWaivers,
      waivedContentPolicyRulesByType: camelContent,
      waived_content_policy_rules_by_type: snakeContent,
      waiverReasons: camelReasons,
      waiver_reasons: snakeReasons,
      fullContextAiCompletion: { required: false },
      full_context_ai_completion: {
        required: true,
        dataset_types: [" FLOW ", "", "flow"],
        required_context_kinds: [" schema ", "schema"],
        required_context_file_patterns: [" Schema.JSON ", "schema.json"],
        proof: " proof text ",
      },
      allowAccountLocalSupportAndElementary: { enabled: true, reason: "camel" },
      allow_account_local_support_and_elementary: snakeOverride,
    },
    "fallback-id",
  );
  assert.equal(normalized.id, "42");
  assert.deepEqual(normalized.description, { localized: true });
  assert.deepEqual(normalized.docs, ["docs/one.md"]);
  assert.equal(normalized.waivedQaCodesByType, camelWaivers);
  assert.equal(normalized.waivedContentPolicyRulesByType, camelContent);
  assert.equal(normalized.waiverReasons, camelReasons);
  assert.deepEqual(normalized.fullContextAiCompletion, {
    required: false,
    datasetTypes: [],
    requiredContextKinds: [],
    requiredContextFilePatterns: [],
    proof:
      "dataset-authoring-patch-collect plus dataset-patch-apply with authoring package closure",
  });
  assert.equal(normalized.allowAccountLocalSupportAndElementary, false);
  assert.equal(normalized.accountLocalSupportOverride, snakeOverride);

  const camelOverride = { enabled: true, reason: "camel-only" };
  const camel = profilesConfig.normalizeProfile(
    { allowAccountLocalSupportAndElementary: camelOverride },
    "camel",
  );
  assert.equal(camel.allowAccountLocalSupportAndElementary, true);
  assert.equal(camel.accountLocalSupportOverride, camelOverride);

  const array = profilesConfig.normalizeProfile([], "array-fallback");
  assert.equal(array.id, "array-fallback");
  assert.deepEqual(array.docs, []);
  const invalid = profilesConfig.normalizeProfile(null, null);
  assert.equal(invalid.id, "generic");
  assert.equal(invalid.description, "");
  assert.deepEqual(invalid.waivedQaCodesByType, {});
  assert.equal(invalid.accountLocalSupportOverride, null);
});

test("profile config loading preserves exact files, fallback identity, and native JSON errors", () => {
  withTempRoot("profiles-config-read", (root) => {
    assert.equal(
      profilesConfig.readProfilesConfig(root, "profiles/missing.json"),
      fallbackProfiles,
    );
    assert.equal(profilesConfig.readProfilesConfig(root, null), fallbackProfiles);

    const configPath = path.join(root, "profiles", "custom.json");
    writeJson(configPath, customProfiles);
    assert.deepEqual(
      profilesConfig.readProfilesConfig(root, "profiles/custom.json"),
      customProfiles,
    );

    writeText(path.join(root, "profiles", "invalid.json"), "{bad\n");
    assert.throws(
      () => profilesConfig.readProfilesConfig(root, "profiles/invalid.json"),
      (error: unknown) => error instanceof SyntaxError,
    );
  });
});

test("profile lookup preserves requested/default/generic fallbacks plus docs and waiver encounter order", () => {
  withTempRoot("profiles-config-lookup", (root) => {
    writeJson(path.join(root, "profiles.json"), customProfiles);
    const selected = profilesConfig.profileFor(root, " ZETA ", {
      profilesFile: "profiles.json",
      profileDoc: "docs/extra-a.md, docs/extra-b.md",
      profileDocs: "docs/ignored.md",
      waiveQa: ["extra-one", "extra-two,extra-three"],
      waiveQaCode: "ignored-waiver",
      type: " PROCESS ",
    });
    assert.equal(selected.id, "ZETA");
    assert.deepEqual(selected.docs, [
      "docs/zeta.md",
      "docs/shared.md",
      "docs/extra-a.md",
      "docs/extra-b.md",
    ]);
    assert.deepEqual(selected.waivedQaCodesByType, {
      process: ["base-waiver", "extra-one", "extra-two", "extra-three"],
    });
    assert.equal(selected.allowAccountLocalSupportAndElementary, true);

    const defaulted = profilesConfig.profileFor(root, "", { profilesFile: "profiles.json" });
    assert.equal(defaulted.id, "ZETA");
    const genericFallback = profilesConfig.profileFor(root, "missing", {
      profilesFile: "profiles.json",
    });
    assert.equal(genericFallback.id, "generic");
    assert.equal(genericFallback.description, "Default profile with no dataset-specific waivers.");
    const primitive = profilesConfig.profileFor(root, "primitive", {
      profilesFile: "profiles.json",
    });
    assert.equal(primitive.id, "primitive");
    assert.equal(primitive.description, "");

    const noExtraWaiver = profilesConfig.profileFor(root, "alpha", {
      profilesFile: "profiles.json",
      waiveQa: "",
      waiveQaCode: "suppressed-by-empty-primary",
      type: "unsupported-but-unused",
    });
    assert.deepEqual(noExtraWaiver.waivedQaCodesByType, { flow: ["camel-waiver"] });
    assert.throws(
      () =>
        profilesConfig.profileFor(root, "alpha", {
          profilesFile: "profiles.json",
          waiveQa: "new-waiver",
          type: "unsupported",
        }),
      new Error(
        "Unsupported dataset type: unsupported. Expected contact, source, unitgroup, flowproperty, support, flow, process, or lifecyclemodel.",
      ),
    );
  });
});

test("profile listing preserves config key order, normalized public fields, defaults, and native argument errors", () => {
  withTempRoot("profiles-config-list", (root) => {
    writeJson(path.join(root, "profiles.json"), customProfiles);
    const listed = profilesConfig.listImportProfiles({
      repoRoot: root,
      options: { profilesFile: "profiles.json" },
    });
    assert.equal(listed.schema_version, 7);
    assert.equal(listed.profiles_file, "profiles.json");
    assert.equal(listed.default_profile, "zeta");
    assert.deepEqual(Object.keys(listed.profiles), ["zeta", "alpha", "primitive"]);
    assert.deepEqual(listed.profiles.zeta, {
      id: "ZETA",
      description: "Zeta profile",
      docs: ["docs/zeta.md", "docs/shared.md"],
      waived_qa_codes_by_type: { process: ["base-waiver"] },
      full_context_ai_completion: {
        required: true,
        datasetTypes: ["process", "flow", "process"],
        requiredContextKinds: ["schema", "ruleset"],
        requiredContextFilePatterns: ["schema.json", "runtime-ruleset.json"],
        proof: "exact proof",
      },
    });
    assert.deepEqual(listed.profiles.primitive, {
      id: "primitive",
      description: "",
      docs: [],
      waived_qa_codes_by_type: {},
      full_context_ai_completion: {
        required: false,
        datasetTypes: [],
        requiredContextKinds: [],
        requiredContextFilePatterns: [],
        proof:
          "dataset-authoring-patch-collect plus dataset-patch-apply with authoring package closure",
      },
    });

    const fallback = profilesConfig.listImportProfiles({
      repoRoot: root,
      options: { profilesFile: "missing.json" },
    });
    assert.deepEqual(Object.keys(fallback.profiles), ["generic"]);
    assert.equal(fallback.schema_version, 1);
    assert.throws(
      () => profilesConfig.listImportProfiles(null),
      (error: unknown) => error instanceof TypeError,
    );
  });
});

test("profiles config retains its exact export surface", () => {
  assert.deepEqual(Object.keys(profilesConfig), [
    "listImportProfiles",
    "normalizeProfile",
    "profileFor",
    "readProfilesConfig",
  ]);
});

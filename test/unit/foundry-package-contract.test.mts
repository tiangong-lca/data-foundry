import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  assertFoundryPackageDescriptor,
  createFoundryPackageDescriptor,
} from "../../scripts/lib/foundry-package-contract.ts";

const repoRoot = path.resolve(import.meta.dirname, "../..");
const readJson = (relative: string) =>
  JSON.parse(fs.readFileSync(path.join(repoRoot, relative), "utf8")) as Record<string, unknown>;

const packageFiles = [
  "package-dist/",
  "specs/import-profiles.json",
  "specs/schemas/authorization-derivation.schema.json",
  "specs/schemas/execution-context.schema.json",
  "specs/schemas/foundry-facade-request-index.schema.json",
  "specs/schemas/foundry-operation-result.schema.json",
  "specs/schemas/foundry-package-descriptor.schema.json",
  "specs/schemas/foundry-task-start.schema.json",
  "specs/schemas/foundry-workspace-migration-plan.schema.json",
  "specs/schemas/foundry-workspace-migration-transfer-plan.schema.json",
  "specs/schemas/foundry-migration-transfer-receipt.schema.json",
  "specs/schemas/foundry-workspace-migration-pending.schema.json",
  "specs/schemas/foundry-migration-adoption-plan.schema.json",
  "specs/schemas/foundry-migration-activation.schema.json",
  "specs/schemas/foundry-workspace-v2.schema.json",
  "specs/schemas/foundry-runtime-selection.schema.json",
  "specs/schemas/runtime-qualification.schema.json",
  "specs/schemas/task-authorization.schema.json",
  "specs/schemas/tidas-runtime-expectation.schema.json",
  "docs/architecture.md",
  "docs/package-distribution-contract.md",
  "docs/foundry-task-contracts.md",
  "docs/public-runtime-contract.md",
  "docs/runtime-context-contract.md",
  "docs/workspace-migration-contract.md",
  "docs/safety-policy.md",
  "docs/task-authorization-contract.md",
  "docs/import-profiles/bafu/constraints.md",
  "docs/import-profiles/bafu/leaf-process-classification-authoring.md",
  "docs/import-profiles/bafu/profile.md",
  "docs/import-profiles/uslci/constraints.md",
  "docs/import-profiles/uslci/profile.md",
  "docs/uslci-import-runbook.md",
  "docs/import-profiles/worldsteel/constraints.md",
  "docs/import-profiles/worldsteel/import-coverage.md",
  "docs/import-profiles/worldsteel/import-plan.md",
  "docs/import-profiles/worldsteel/profile.md",
  "README.md",
  "LICENSE",
] as const;

test("Foundry package metadata exposes only the reviewed public closure", () => {
  const manifest = readJson("package.json");
  assert.equal(manifest.name, "@tiangong-lca/foundry");
  assert.equal(typeof manifest.version, "string");
  assert.match(manifest.version as string, /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u);
  const schemaProperties = readJson("specs/schemas/foundry-package-descriptor.schema.json")
    .properties as Record<string, unknown>;
  const packageProperties = (schemaProperties.package as Record<string, unknown>)
    .properties as Record<string, unknown>;
  assert.equal((packageProperties.version as Record<string, unknown>).const, manifest.version);
  assert.equal(Object.hasOwn(manifest, "private"), false);
  assert.deepEqual(manifest.publishConfig, {
    access: "public",
    registry: "https://registry.npmjs.org/",
  });
  assert.deepEqual(manifest.bin, {
    "tiangong-foundry": "./package-dist/scripts/package-entry.js",
  });
  assert.equal(manifest.types, "./package-dist/scripts/public-api.d.ts");
  assert.deepEqual(manifest.exports, {
    ".": {
      types: "./package-dist/scripts/public-api.d.ts",
      import: "./package-dist/scripts/public-api.js",
    },
    "./runtime": {
      types: "./package-dist/scripts/public-api.d.ts",
      import: "./package-dist/scripts/public-api.js",
    },
  });
  assert.deepEqual(manifest.files, packageFiles);
  assert.deepEqual(manifest.dependencies, { "@tiangong-lca/cli": "0.1.11" });
  assert.equal((manifest.devDependencies as Record<string, string>).ajv, "8.20.0");
  for (const lifecycle of ["preinstall", "install", "postinstall", "prepare"]) {
    assert.equal(Object.hasOwn(manifest.scripts as object, lifecycle), false, lifecycle);
  }
  assert.equal((manifest.scripts as Record<string, string>)["dev:hooks"], "pnpm exec husky");
  assert.equal(
    (manifest.scripts as Record<string, string>)["package:build"],
    "node scripts/build-foundry-package.ts",
  );
  assert.equal(
    (manifest.scripts as Record<string, string>)["package:check"],
    "node scripts/verify-foundry-package.ts",
  );
  assert.equal(
    (manifest.scripts as Record<string, string>)["package:pack"],
    "node scripts/pack-foundry-package.ts",
  );
  assert.deepEqual(manifest.foundryRuntime, {
    schema: "tiangong-foundry.runtime-layout.v2",
    asset_root: ".",
    source_entry: "scripts/foundry.ts",
    emitted_entry: "dist/scripts/foundry.js",
    package_entry: "package-dist/scripts/package-entry.js",
    package_descriptor: "package-dist/assets/foundry-package-descriptor.json",
  });
});

test("package compiler and public entries are explicit and source maps stay disabled", () => {
  const config = readJson("tsconfig.package.json");
  assert.deepEqual(config.files, ["scripts/package-entry.ts", "scripts/public-api.ts"]);
  assert.deepEqual(config.include, []);
  assert.deepEqual(config.exclude, []);
  assert.deepEqual(config.compilerOptions, {
    noEmit: false,
    noEmitOnError: true,
    rootDir: ".",
    outDir: "./package-dist",
    declaration: true,
    declarationMap: false,
    sourceMap: false,
    inlineSources: false,
    newLine: "lf",
  });
  for (const entry of ["scripts/package-entry.ts", "scripts/public-api.ts"]) {
    assert.equal(fs.existsSync(path.join(repoRoot, entry)), true, entry);
  }
  const packageEntry = fs.readFileSync(path.join(repoRoot, "scripts/package-entry.ts"), "utf8");
  assert.match(packageEntry, /^#!\/usr\/bin\/env node\n/u);
  assert.match(packageEntry, /runFoundryPublicCommand/u);
  assert.doesNotMatch(packageEntry, /runFoundryCli|runFoundryRuntimeCommand/u);
  const api = fs.readFileSync(path.join(repoRoot, "scripts/public-api.ts"), "utf8");
  assert.doesNotMatch(api, /foundry-cli|commands\/|production-contact-draft/u);
});

test("generated package output and consumer artifacts stay ignored", () => {
  const ignore = fs.readFileSync(path.join(repoRoot, ".gitignore"), "utf8");
  assert.match(ignore, /^package-dist\/$/mu);
  assert.match(ignore, /^package-stage\/$/mu);
  assert.match(ignore, /^package-artifacts\/$/mu);
});

test("package descriptor rejects platform, path, order and digest drift", () => {
  const sha256 = "1".repeat(64);
  const descriptor = createFoundryPackageDescriptor(
    [
      "README.md",
      "LICENSE",
      "package-dist/scripts/package-entry.js",
      "package-dist/scripts/public-api.js",
      "package-dist/scripts/public-api.d.ts",
    ].map((selectedPath) => ({ path: selectedPath, bytes: 1, sha256 })),
  );
  assert.deepEqual(
    assertFoundryPackageDescriptor(JSON.parse(JSON.stringify(descriptor))),
    descriptor,
  );
  assert.equal(descriptor.package.version, readJson("package.json").version);
  assert.throws(() =>
    assertFoundryPackageDescriptor({
      ...descriptor,
      package: {
        ...descriptor.package,
        version: descriptor.package.version.replace(/\d+$/u, (patch) => String(BigInt(patch) + 1n)),
      },
    }),
  );
  assert.throws(() =>
    assertFoundryPackageDescriptor({
      ...descriptor,
      runtime: {
        ...descriptor.runtime,
        supported_platforms: [...descriptor.runtime.supported_platforms, "darwin-x64"],
      },
    }),
  );
  assert.throws(() =>
    assertFoundryPackageDescriptor({
      ...descriptor,
      files: [{ path: "../outside", bytes: 1, sha256 }, ...descriptor.files.slice(1)],
    }),
  );
  assert.throws(() =>
    assertFoundryPackageDescriptor({
      ...descriptor,
      files: [...descriptor.files].reverse(),
    }),
  );
  assert.throws(() =>
    assertFoundryPackageDescriptor({ ...descriptor, files_sha256: "0".repeat(64) }),
  );
});

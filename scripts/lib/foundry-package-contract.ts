import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { sha256Json } from "./identity-preflight-proof.ts";

export const FOUNDRY_PACKAGE_DESCRIPTOR_SCHEMA = "tiangong-foundry.package-descriptor.v1" as const;
export const foundryPackageDescriptorPath =
  "package-dist/assets/foundry-package-descriptor.json" as const;
export const foundryPackageStaticFiles = Object.freeze([
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
  "specs/schemas/foundry-managed-runtime.schema.json",
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
] as const);

const packageName = "@tiangong-lca/foundry";
const packageVersion = "0.1.0";
const packageDescription =
  "Control plane for TianGong LCA external dataset import and TIDAS authoring work.";
const cliPackageName = "@tiangong-lca/cli";
const cliPackageVersion = "0.1.11";
const packageBin = "package-dist/scripts/package-entry.js";
const packageApi = "package-dist/scripts/public-api.js";
const packageTypes = "package-dist/scripts/public-api.d.ts";
const supportedPlatforms = Object.freeze([
  "linux-x64",
  "linux-arm64",
  "darwin-arm64",
  "win32-x64",
] as const);
const protocolSchemas = Object.freeze([
  "tiangong-foundry.operation-result.v1",
  "tiangong-foundry.task-start.v1",
  "tiangong-foundry.facade-request-index.v1",
  "tiangong-foundry.workspace-migration-plan.v1",
  "tiangong-foundry.workspace-migration-transfer-plan.v2",
  "tiangong-foundry.migration-transfer-receipt.v1",
  "tiangong-foundry.workspace-migration-pending.v1",
  "tiangong-foundry.migration-adoption-plan.v1",
  "tiangong-foundry.migration-activation.v1",
  "tiangong-foundry.workspace.v2",
  "tiangong-foundry.workspace-runtime-selection.v1",
  "tiangong-foundry.managed-runtime.v1",
  "tiangong-foundry.runtime-qualification.v1",
  "tiangong-foundry.tidas-runtime-expectation.v1",
  "tiangong-foundry.execution-context.v1",
  "tiangong-foundry.authorization-derivation.v1",
  "tiangong-foundry.task-authorization.v1",
] as const);
const shaPattern = /^[0-9a-f]{64}$/u;
const maxDescriptorBytes = 8 * 1024 * 1024;
const maxPayloadFiles = 5_000;
const maxPayloadFileBytes = 32 * 1024 * 1024;
const maxPayloadBytes = 64 * 1024 * 1024;

function expectedPackageManifest() {
  return {
    name: packageName,
    version: packageVersion,
    type: "module",
    description: packageDescription,
    repository: {
      type: "git",
      url: "git+https://github.com/tiangong-lca/data-foundry.git",
    },
    homepage: "https://github.com/tiangong-lca/data-foundry#readme",
    bugs: { url: "https://github.com/tiangong-lca/data-foundry/issues" },
    publishConfig: { access: "public", registry: "https://registry.npmjs.org/" },
    types: `./${packageTypes}`,
    bin: { "tiangong-foundry": `./${packageBin}` },
    exports: {
      ".": { types: `./${packageTypes}`, import: `./${packageApi}` },
      "./runtime": { types: `./${packageTypes}`, import: `./${packageApi}` },
    },
    files: [...foundryPackageStaticFiles],
    engines: { node: ">=24.19.0 <25" },
    license: "MIT",
    dependencies: { [cliPackageName]: cliPackageVersion },
    foundryRuntime: {
      schema: "tiangong-foundry.runtime-layout.v2",
      asset_root: ".",
      source_entry: "scripts/foundry.ts",
      emitted_entry: "dist/scripts/foundry.js",
      package_entry: packageBin,
      package_descriptor: foundryPackageDescriptorPath,
    },
  };
}

export interface FoundryPackageFileFact {
  readonly path: string;
  readonly bytes: number;
  readonly sha256: string;
}

export interface FoundryPackageDescriptor {
  readonly schema: typeof FOUNDRY_PACKAGE_DESCRIPTOR_SCHEMA;
  readonly package: Readonly<{
    name: typeof packageName;
    version: typeof packageVersion;
    cli_dependency: Readonly<{ name: typeof cliPackageName; version: typeof cliPackageVersion }>;
    bin: typeof packageBin;
    public_api: typeof packageApi;
    types: typeof packageTypes;
  }>;
  readonly runtime: Readonly<{
    layout_schema: "tiangong-foundry.runtime-layout.v2";
    supported_platforms: readonly (typeof supportedPlatforms)[number][];
    workspace_read_schemas: readonly [
      "tiangong-foundry.workspace.v1",
      "tiangong-foundry.workspace.v2",
    ];
    workspace_write_schemas: readonly [
      "tiangong-foundry.workspace.v1",
      "tiangong-foundry.workspace.v2",
    ];
    workspace_write_schema: "tiangong-foundry.workspace.v1";
    protocol_schemas: readonly (typeof protocolSchemas)[number][];
  }>;
  readonly files: readonly Readonly<FoundryPackageFileFact>[];
  readonly files_sha256: string;
}

export class FoundryPackageError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "FoundryPackageError";
    this.code = code;
  }
}

function fail(code: string, message: string): never {
  throw new FoundryPackageError(code, message);
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    fail("package_descriptor_invalid", `${label} must be an object.`);
  return value as Record<string, unknown>;
}

function exact(value: Record<string, unknown>, keys: readonly string[], label: string): void {
  if (Object.keys(value).length !== keys.length || keys.some((key) => !Object.hasOwn(value, key)))
    fail("package_descriptor_invalid", `${label} has missing or unsupported fields.`);
}

function portableFile(value: unknown): string {
  if (
    typeof value !== "string" ||
    !value ||
    value.length > 4_096 ||
    path.posix.isAbsolute(value) ||
    value.includes("\\") ||
    value.includes(":") ||
    value.includes("\0") ||
    value.split("/").some((part) => !part || part === "." || part === "..")
  )
    fail("package_descriptor_invalid", "Package file path is not portable and contained.");
  return value;
}

function fileFact(value: unknown): Readonly<FoundryPackageFileFact> {
  const item = object(value, "Package file fact");
  exact(item, ["path", "bytes", "sha256"], "Package file fact");
  const selectedPath = portableFile(item.path);
  if (
    selectedPath === foundryPackageDescriptorPath ||
    !Number.isSafeInteger(item.bytes) ||
    Number(item.bytes) < 0 ||
    Number(item.bytes) > maxPayloadFileBytes ||
    typeof item.sha256 !== "string" ||
    !shaPattern.test(item.sha256)
  )
    fail("package_descriptor_invalid", "Package file fact has invalid bytes or SHA-256.");
  return Object.freeze({ path: selectedPath, bytes: Number(item.bytes), sha256: item.sha256 });
}

function sameArray(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function comparePortable(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

export function assertFoundryPackageDescriptor(value: unknown): FoundryPackageDescriptor {
  const item = object(value, "Foundry package descriptor");
  exact(item, ["schema", "package", "runtime", "files", "files_sha256"], "Descriptor");
  const packageIdentity = object(item.package, "Package identity");
  exact(
    packageIdentity,
    ["name", "version", "cli_dependency", "bin", "public_api", "types"],
    "Package identity",
  );
  const cli = object(packageIdentity.cli_dependency, "CLI dependency");
  exact(cli, ["name", "version"], "CLI dependency");
  const runtime = object(item.runtime, "Package runtime");
  exact(
    runtime,
    [
      "layout_schema",
      "supported_platforms",
      "workspace_read_schemas",
      "workspace_write_schema",
      "workspace_write_schemas",
      "protocol_schemas",
    ],
    "Package runtime",
  );
  if (
    item.schema !== FOUNDRY_PACKAGE_DESCRIPTOR_SCHEMA ||
    packageIdentity.name !== packageName ||
    packageIdentity.version !== packageVersion ||
    cli.name !== cliPackageName ||
    cli.version !== cliPackageVersion ||
    packageIdentity.bin !== packageBin ||
    packageIdentity.public_api !== packageApi ||
    packageIdentity.types !== packageTypes ||
    runtime.layout_schema !== "tiangong-foundry.runtime-layout.v2" ||
    !Array.isArray(runtime.supported_platforms) ||
    !sameArray(runtime.supported_platforms as string[], supportedPlatforms) ||
    !Array.isArray(runtime.workspace_read_schemas) ||
    !sameArray(runtime.workspace_read_schemas as string[], [
      "tiangong-foundry.workspace.v1",
      "tiangong-foundry.workspace.v2",
    ]) ||
    !Array.isArray(runtime.workspace_write_schemas) ||
    !sameArray(runtime.workspace_write_schemas as string[], [
      "tiangong-foundry.workspace.v1",
      "tiangong-foundry.workspace.v2",
    ]) ||
    runtime.workspace_write_schema !== "tiangong-foundry.workspace.v1" ||
    !Array.isArray(runtime.protocol_schemas) ||
    !sameArray(runtime.protocol_schemas as string[], protocolSchemas) ||
    !Array.isArray(item.files) ||
    !item.files.length ||
    item.files.length > maxPayloadFiles ||
    typeof item.files_sha256 !== "string" ||
    !shaPattern.test(item.files_sha256)
  )
    fail("package_descriptor_invalid", "Package identity or runtime compatibility is invalid.");
  const files = item.files.map(fileFact);
  const paths = files.map((file) => file.path);
  if (
    !sameArray(paths, [...paths].sort(comparePortable)) ||
    new Set(paths).size !== paths.length ||
    files.reduce((total, file) => total + file.bytes, 0) > maxPayloadBytes ||
    item.files_sha256 !== sha256Json(files)
  )
    fail(
      "package_descriptor_invalid",
      "Package file inventory order, uniqueness or digest is invalid.",
    );
  for (const required of ["README.md", "LICENSE", packageBin, packageApi, packageTypes])
    if (!paths.includes(required))
      fail("package_descriptor_invalid", `Package descriptor omits required payload ${required}.`);
  return deepFreeze({
    schema: FOUNDRY_PACKAGE_DESCRIPTOR_SCHEMA,
    package: {
      name: packageName,
      version: packageVersion,
      cli_dependency: { name: cliPackageName, version: cliPackageVersion },
      bin: packageBin,
      public_api: packageApi,
      types: packageTypes,
    },
    runtime: {
      layout_schema: "tiangong-foundry.runtime-layout.v2",
      supported_platforms: [...supportedPlatforms],
      workspace_read_schemas: ["tiangong-foundry.workspace.v1", "tiangong-foundry.workspace.v2"],
      workspace_write_schemas: ["tiangong-foundry.workspace.v1", "tiangong-foundry.workspace.v2"],
      workspace_write_schema: "tiangong-foundry.workspace.v1",
      protocol_schemas: [...protocolSchemas],
    },
    files,
    files_sha256: item.files_sha256,
  });
}

function readPackageFile(
  root: string,
  relative: string,
): Readonly<{ fact: Readonly<FoundryPackageFileFact>; content: Buffer }> {
  const target = path.resolve(root, relative);
  const within = path.relative(root, target);
  if (path.isAbsolute(within) || within === ".." || within.startsWith(`..${path.sep}`))
    fail("package_file_invalid", "Package payload escapes its root.");
  let fd: number;
  try {
    fd = fs.openSync(target, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  } catch {
    return fail("package_file_invalid", `Package payload is missing or linked: ${relative}.`);
  }
  try {
    const before = fs.fstatSync(fd, { bigint: true });
    if (!before.isFile() || before.size > BigInt(maxPayloadFileBytes))
      fail("package_file_invalid", `Package payload is not a bounded file: ${relative}.`);
    const bytes = fs.readFileSync(fd);
    const after = fs.fstatSync(fd, { bigint: true });
    if (
      before.dev !== after.dev ||
      before.ino !== after.ino ||
      before.size !== after.size ||
      before.mtimeNs !== after.mtimeNs ||
      BigInt(bytes.length) !== after.size
    )
      fail("package_file_invalid", `Package payload changed while read: ${relative}.`);
    return Object.freeze({
      fact: Object.freeze({
        path: relative,
        bytes: bytes.length,
        sha256: createHash("sha256").update(bytes).digest("hex"),
      }),
      content: bytes,
    });
  } finally {
    fs.closeSync(fd);
  }
}

function captureFile(root: string, relative: string): Readonly<FoundryPackageFileFact> {
  return readPackageFile(root, relative).fact;
}

function packageFiles(root: string): string[] {
  const files: string[] = [];
  const walk = (directory: string, relativeDirectory: string, depth: number): void => {
    if (depth > 32) fail("package_file_invalid", "Package payload exceeds its depth limit.");
    for (const entry of fs
      .readdirSync(directory, { withFileTypes: true })
      .sort((a, b) => comparePortable(a.name, b.name))) {
      const relative = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name;
      const target = path.join(directory, entry.name);
      const stat = fs.lstatSync(target);
      if (relativeDirectory === "" && entry.name === "node_modules") {
        if (!stat.isDirectory() || stat.isSymbolicLink())
          fail("package_file_invalid", "Installed package node_modules must be a real directory.");
        continue;
      }
      if (stat.isSymbolicLink())
        fail("package_file_invalid", `Package payload contains a link: ${relative}.`);
      if (stat.isDirectory()) walk(target, relative, depth + 1);
      else if (stat.isFile()) files.push(relative);
      else
        fail("package_file_invalid", `Package payload contains an unsupported entry: ${relative}.`);
      if (files.length > maxPayloadFiles + 1)
        fail("package_file_invalid", "Package payload exceeds its file-count limit.");
    }
  };
  walk(root, "", 0);
  return files.sort(comparePortable);
}

export function assertFoundryPackage(packageRoot: string): FoundryPackageDescriptor {
  const root = fs.realpathSync(packageRoot);
  if (!fs.statSync(root).isDirectory())
    fail("package_root_invalid", "Package root is not a directory.");
  const capturedDescriptor = readPackageFile(root, foundryPackageDescriptorPath);
  if (capturedDescriptor.fact.bytes > maxDescriptorBytes)
    fail("package_descriptor_invalid", "Package descriptor exceeds its byte limit.");
  const descriptor = assertFoundryPackageDescriptor(
    JSON.parse(capturedDescriptor.content.toString("utf8")),
  );
  const actualPaths = packageFiles(root).filter(
    (file) => file !== foundryPackageDescriptorPath && file !== "package.json",
  );
  const expectedPaths = descriptor.files.map((file) => file.path);
  if (!sameArray(actualPaths, expectedPaths))
    fail("package_file_set_changed", "Installed package has missing or extra payload files.");
  for (const expected of descriptor.files) {
    const actual = captureFile(root, expected.path);
    if (actual.bytes !== expected.bytes || actual.sha256 !== expected.sha256)
      fail("package_file_changed", `Installed package payload changed: ${expected.path}.`);
  }
  const manifest = object(
    JSON.parse(readPackageFile(root, "package.json").content.toString("utf8")),
    "Installed package manifest",
  );
  if (sha256Json(manifest) !== sha256Json(expectedPackageManifest()))
    fail("package_manifest_changed", "Installed public package manifest changed.");
  const bin = readPackageFile(root, packageBin).content.toString("utf8");
  if (!bin.startsWith("#!/usr/bin/env node\n"))
    fail("package_bin_invalid", "Installed Foundry bin lacks its portable Node shebang.");
  for (const file of actualPaths) {
    if (
      file.endsWith(".map") ||
      (file.endsWith(".ts") && !file.endsWith(".d.ts")) ||
      /^package-dist\/scripts\/(?:commands|cases)\//u.test(file) ||
      /(?:^|\/)(?:test|tests|\.git|\.github|\.agents|\.env|inputs|outputs|tasks|reports|\.foundry)(?:\/|\.|$)/iu.test(
        file,
      )
    )
      fail("package_private_file", `Installed package exposes a private/source path: ${file}.`);
  }
  return descriptor;
}

export function createFoundryPackageDescriptor(
  files: readonly FoundryPackageFileFact[],
): FoundryPackageDescriptor {
  const ordered = [...files].sort((left, right) => comparePortable(left.path, right.path));
  return assertFoundryPackageDescriptor({
    schema: FOUNDRY_PACKAGE_DESCRIPTOR_SCHEMA,
    package: {
      name: packageName,
      version: packageVersion,
      cli_dependency: { name: cliPackageName, version: cliPackageVersion },
      bin: packageBin,
      public_api: packageApi,
      types: packageTypes,
    },
    runtime: {
      layout_schema: "tiangong-foundry.runtime-layout.v2",
      supported_platforms: [...supportedPlatforms],
      workspace_read_schemas: ["tiangong-foundry.workspace.v1", "tiangong-foundry.workspace.v2"],
      workspace_write_schemas: ["tiangong-foundry.workspace.v1", "tiangong-foundry.workspace.v2"],
      workspace_write_schema: "tiangong-foundry.workspace.v1",
      protocol_schemas: [...protocolSchemas],
    },
    files: ordered,
    files_sha256: sha256Json(ordered),
  });
}

export function captureFoundryPackageFile(
  packageRoot: string,
  relative: string,
): Readonly<FoundryPackageFileFact> {
  return captureFile(fs.realpathSync(packageRoot), portableFile(relative));
}

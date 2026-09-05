import fs from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertFoundryPackage, foundryPackageDescriptorPath } from "./foundry-package-contract.ts";

const foundryPackageName = "@tiangong-lca/foundry";
const supportedEntryExtensions = new Set([".js", ".ts"]);
const layoutSchemaV1 = "tiangong-foundry.runtime-layout.v1";
const layoutSchemaV2 = "tiangong-foundry.runtime-layout.v2";

interface RuntimeLayout {
  schema: typeof layoutSchemaV1 | typeof layoutSchemaV2;
  asset_root: string;
  source_entry: string;
  emitted_entry: string;
  package_entry: string | null;
  package_descriptor: string | null;
}

interface RuntimePackage {
  root: string;
  name: string;
  version: string;
  manifestSha256: string;
  layout: RuntimeLayout;
}

export interface FoundryRuntimePaths {
  repoRoot: string;
  entryPath: string;
  entryRepoRelativePath: string;
}

export interface FoundryRuntimeIdentity extends FoundryRuntimePaths {
  runtimeRoot: string;
  assetRoot: string;
  packageName: string;
  packageVersion: string;
  packageManifestSha256: string;
  entrySha256: string;
  mode: "source" | "emitted";
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function isWithinRoot(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return (
    relative === "" ||
    (!path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`))
  );
}

function layoutPath(value: unknown, directory = false): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    !path.posix.isAbsolute(value) &&
    !value.includes("\\") &&
    !value.includes(":") &&
    !value.includes("\0") &&
    ((directory && value === ".") ||
      value.split("/").every((part) => part !== "" && part !== "." && part !== ".."))
  );
}

function readRuntimePackage(root: string): RuntimePackage | null {
  const manifestPath = path.join(root, "package.json");
  if (!fs.existsSync(manifestPath)) return null;
  const stat = fs.lstatSync(manifestPath);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1024 * 1024) return null;
  const bytes = fs.readFileSync(manifestPath);
  let manifest: Record<string, unknown> | null;
  try {
    manifest = record(JSON.parse(bytes.toString("utf8")));
  } catch {
    return null;
  }
  if (manifest?.name !== foundryPackageName || !manifest.foundryRuntime) return null;
  const layout = record(manifest.foundryRuntime);
  const isV1 = layout?.schema === layoutSchemaV1 && Object.keys(layout).length === 4;
  const isV2 = layout?.schema === layoutSchemaV2 && Object.keys(layout).length === 6;
  if (
    !layout ||
    (!isV1 && !isV2) ||
    !layoutPath(layout.asset_root, true) ||
    !layoutPath(layout.source_entry) ||
    !layoutPath(layout.emitted_entry) ||
    (isV2 && (!layoutPath(layout.package_entry) || !layoutPath(layout.package_descriptor))) ||
    !String(layout.source_entry).endsWith(".ts") ||
    !String(layout.emitted_entry).endsWith(".js") ||
    (isV2 && !String(layout.package_entry).endsWith(".js")) ||
    typeof manifest.version !== "string" ||
    !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(manifest.version)
  ) {
    throw new Error("Invalid Foundry runtime layout descriptor.");
  }
  return {
    root,
    name: manifest.name,
    version: manifest.version,
    manifestSha256: createHash("sha256").update(bytes).digest("hex"),
    layout: {
      schema: layout.schema as RuntimeLayout["schema"],
      asset_root: layout.asset_root,
      source_entry: layout.source_entry,
      emitted_entry: layout.emitted_entry,
      package_entry: isV2 ? String(layout.package_entry) : null,
      package_descriptor: isV2 ? String(layout.package_descriptor) : null,
    },
  };
}

export function describeFoundryRuntime(moduleUrl: string): FoundryRuntimeIdentity {
  const requestedModulePath = fileURLToPath(moduleUrl);
  const extension = path.extname(requestedModulePath);
  if (!supportedEntryExtensions.has(extension)) {
    throw new Error(
      `Unsupported Foundry runtime module extension '${extension}' at ${requestedModulePath}.`,
    );
  }
  const modulePath = fs.realpathSync(requestedModulePath);
  let current = path.dirname(modulePath);
  let runtimePackage: RuntimePackage | null = null;
  while (true) {
    runtimePackage = readRuntimePackage(current);
    if (runtimePackage) break;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  if (!runtimePackage) {
    throw new Error(`Unable to resolve trusted Foundry repository root from ${modulePath}.`);
  }
  const mode = extension === ".ts" ? "source" : "emitted";
  const candidates =
    mode === "source"
      ? [runtimePackage.layout.source_entry]
      : [runtimePackage.layout.emitted_entry, runtimePackage.layout.package_entry].filter(
          (entry): entry is string => Boolean(entry),
        );
  const selected = candidates
    .map((declared) => ({ declared, target: path.resolve(runtimePackage.root, declared) }))
    .filter(({ target }) => fs.existsSync(target) && fs.lstatSync(target).isFile())
    .map(({ declared, target }) => ({ declared, entryPath: fs.realpathSync(target) }))
    .find(({ entryPath: candidate }) => isWithinRoot(path.dirname(candidate), modulePath));
  if (!selected) throw new Error(`Active Foundry entry is missing for ${modulePath}.`);
  const { declared: declaredEntry, entryPath } = selected;
  const assetRoot = fs.realpathSync(
    path.resolve(runtimePackage.root, runtimePackage.layout.asset_root),
  );
  if (
    !isWithinRoot(runtimePackage.root, entryPath) ||
    !isWithinRoot(runtimePackage.root, assetRoot) ||
    !fs.statSync(assetRoot).isDirectory() ||
    !isWithinRoot(path.dirname(entryPath), modulePath)
  ) {
    throw new Error("Foundry runtime module or assets escape the declared package layout.");
  }
  if (declaredEntry === runtimePackage.layout.package_entry) {
    if (runtimePackage.layout.package_descriptor !== foundryPackageDescriptorPath)
      throw new Error("Foundry package descriptor path differs from the public package contract.");
    if (!fs.existsSync(path.resolve(runtimePackage.root, runtimePackage.layout.source_entry)))
      assertFoundryPackage(runtimePackage.root);
  }
  return Object.freeze({
    repoRoot: runtimePackage.root,
    runtimeRoot: runtimePackage.root,
    assetRoot,
    entryPath,
    entryRepoRelativePath: path.relative(runtimePackage.root, entryPath).split(path.sep).join("/"),
    packageName: runtimePackage.name,
    packageVersion: runtimePackage.version,
    packageManifestSha256: runtimePackage.manifestSha256,
    entrySha256: createHash("sha256").update(fs.readFileSync(entryPath)).digest("hex"),
    mode,
  });
}

export function resolveFoundryRuntimePaths(moduleUrl: string): FoundryRuntimePaths {
  const { repoRoot, entryPath, entryRepoRelativePath } = describeFoundryRuntime(moduleUrl);
  return { repoRoot, entryPath, entryRepoRelativePath };
}

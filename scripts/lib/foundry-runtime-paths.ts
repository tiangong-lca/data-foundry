import fs from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const foundryPackageName = "tiangong-lca-data-foundry";
const supportedEntryExtensions = new Set([".js", ".ts"]);
const layoutSchema = "tiangong-foundry.runtime-layout.v1";

interface RuntimeLayout {
  schema: typeof layoutSchema;
  asset_root: string;
  source_entry: string;
  emitted_entry: string;
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
  if (
    !layout ||
    layout.schema !== layoutSchema ||
    Object.keys(layout).length !== 4 ||
    !layoutPath(layout.asset_root, true) ||
    !layoutPath(layout.source_entry) ||
    !layoutPath(layout.emitted_entry) ||
    !String(layout.source_entry).endsWith(".ts") ||
    !String(layout.emitted_entry).endsWith(".js") ||
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
      schema: layoutSchema,
      asset_root: layout.asset_root,
      source_entry: layout.source_entry,
      emitted_entry: layout.emitted_entry,
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
  const declaredEntry =
    mode === "source" ? runtimePackage.layout.source_entry : runtimePackage.layout.emitted_entry;
  const entry = path.resolve(runtimePackage.root, declaredEntry);
  if (!fs.existsSync(entry) || !fs.lstatSync(entry).isFile()) {
    throw new Error(`Active Foundry entry is missing: ${entry}.`);
  }
  const entryPath = fs.realpathSync(entry);
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

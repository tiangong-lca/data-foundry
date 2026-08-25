import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const foundryPackageName = "tiangong-lca-data-foundry";
const supportedEntryExtensions = new Set([".js", ".ts"]);

interface PackageManifest {
  name?: unknown;
}

export interface FoundryRuntimePaths {
  repoRoot: string;
  entryPath: string;
  entryRepoRelativePath: string;
}

function isRegularFile(filePath: string): boolean {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function isTrustedFoundryRoot(directory: string): boolean {
  const packagePath = path.join(directory, "package.json");
  const sourceEntryPath = path.join(directory, "scripts", "foundry.ts");
  if (!isRegularFile(packagePath) || !isRegularFile(sourceEntryPath)) return false;
  try {
    const manifest = JSON.parse(fs.readFileSync(packagePath, "utf8")) as PackageManifest;
    return manifest.name === foundryPackageName;
  } catch {
    return false;
  }
}

function isWithinRoot(repoRoot: string, targetPath: string): boolean {
  const relative = path.relative(repoRoot, targetPath);
  return (
    relative === "" ||
    (!path.isAbsolute(relative) && !relative.startsWith(`..${path.sep}`) && relative !== "..")
  );
}

export function resolveFoundryRuntimePaths(moduleUrl: string): FoundryRuntimePaths {
  const modulePath = fileURLToPath(moduleUrl);
  let current = path.dirname(modulePath);
  let repoRoot: string | null = null;
  while (true) {
    if (isTrustedFoundryRoot(current)) {
      repoRoot = current;
      break;
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  if (!repoRoot) {
    throw new Error(`Unable to resolve trusted Foundry repository root from ${modulePath}.`);
  }

  const extension = path.extname(modulePath);
  if (!supportedEntryExtensions.has(extension)) {
    throw new Error(
      `Unsupported Foundry runtime module extension '${extension}' at ${modulePath}.`,
    );
  }
  current = path.dirname(modulePath);
  while (isWithinRoot(repoRoot, current)) {
    if (path.basename(current) === "scripts") {
      const entryPath = path.join(current, `foundry${extension}`);
      if (!isRegularFile(entryPath)) {
        throw new Error(`Active Foundry entry is missing: ${entryPath}.`);
      }
      return {
        repoRoot,
        entryPath,
        entryRepoRelativePath: path.relative(repoRoot, entryPath).split(path.sep).join("/"),
      };
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  throw new Error(`Unable to resolve active Foundry entry from ${modulePath}.`);
}

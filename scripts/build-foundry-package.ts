import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertFoundryPackage,
  captureFoundryPackageFile,
  createFoundryPackageDescriptor,
  foundryPackageDescriptorPath,
  foundryPackageStaticFiles,
} from "./lib/foundry-package-contract.ts";

export const foundryPackageRepoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
export const foundryPackageOutputRoot = path.join(foundryPackageRepoRoot, "package-dist");
export const foundryPackageStageRoot = path.join(foundryPackageRepoRoot, "package-stage");

function cleanOwnedOutput(target: string, expectedName: string): void {
  if (
    path.dirname(target) !== foundryPackageRepoRoot ||
    path.basename(target) !== expectedName ||
    foundryPackageRepoRoot === path.parse(foundryPackageRepoRoot).root
  )
    throw new Error(`Refusing to clean unsafe package output: ${target}`);
  if (fs.existsSync(target)) {
    const stat = fs.lstatSync(target);
    if (!stat.isDirectory() || stat.isSymbolicLink())
      throw new Error(`${expectedName} must be an owned real directory.`);
  }
  fs.rmSync(target, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
}

function filesUnder(directory: string, relativeDirectory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const relative = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name;
    const target = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Package compiler emitted a link: ${relative}`);
    if (entry.isDirectory()) return filesUnder(target, relative);
    if (!entry.isFile())
      throw new Error(`Package compiler emitted an unsupported entry: ${relative}`);
    return [relative];
  });
}

function runCompiler(): void {
  const compiler = path.join(foundryPackageRepoRoot, "node_modules", "typescript", "bin", "tsc");
  const result = spawnSync(process.execPath, [compiler, "-p", "tsconfig.package.json"], {
    cwd: foundryPackageRepoRoot,
    stdio: "inherit",
    env: process.env,
  });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(`Package compiler failed with exit ${result.status ?? 1}.`);
}

function copyPayload(relative: string): void {
  const source = path.join(foundryPackageRepoRoot, relative);
  const stat = fs.lstatSync(source);
  if (!stat.isFile() || stat.isSymbolicLink())
    throw new Error(`Package payload must be a regular source file: ${relative}`);
  const target = path.join(foundryPackageStageRoot, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o755 });
  fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL);
  fs.chmodSync(target, relative === "package-dist/scripts/package-entry.js" ? 0o755 : 0o644);
}

function publicationManifest(): Record<string, unknown> {
  const source = JSON.parse(
    fs.readFileSync(path.join(foundryPackageRepoRoot, "package.json"), "utf8"),
  ) as Record<string, unknown>;
  if (JSON.stringify(source.files) !== JSON.stringify(foundryPackageStaticFiles))
    throw new Error("package.json files allowlist differs from the reviewed package contract.");
  const engines = source.engines as Record<string, unknown>;
  return {
    name: source.name,
    version: source.version,
    type: source.type,
    description: source.description,
    repository: source.repository,
    homepage: source.homepage,
    bugs: source.bugs,
    publishConfig: source.publishConfig,
    types: source.types,
    bin: source.bin,
    exports: source.exports,
    files: source.files,
    engines: { node: engines.node },
    license: source.license,
    dependencies: source.dependencies,
    foundryRuntime: source.foundryRuntime,
  };
}

function writeAtomic(target: string, bytes: Buffer, mode: number): void {
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o755 });
  const temporary = `${target}.${process.pid}.tmp`;
  const fd = fs.openSync(temporary, "wx", mode);
  try {
    fs.writeFileSync(fd, bytes);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(temporary, target);
}

function assemblePackage(): void {
  const compiled = filesUnder(foundryPackageOutputRoot, "package-dist").sort();
  if (
    !compiled.includes("package-dist/scripts/package-entry.js") ||
    !compiled.includes("package-dist/scripts/public-api.js") ||
    !compiled.includes("package-dist/scripts/public-api.d.ts") ||
    compiled.some((file) => file.endsWith(".map")) ||
    compiled.some((file) => file.includes("/commands/") || file.includes("/cases/")) ||
    compiled.some((file) => !file.endsWith(".js") && !file.endsWith(".d.ts"))
  )
    throw new Error("Package compiler output is incomplete or contains an unsupported file type.");
  const staticFiles = foundryPackageStaticFiles.filter((file) => file !== "package-dist/");
  const payloadPaths = [...new Set([...compiled, ...staticFiles])].sort();
  fs.mkdirSync(foundryPackageStageRoot, { recursive: true, mode: 0o755 });
  for (const relative of payloadPaths) copyPayload(relative);
  writeAtomic(
    path.join(foundryPackageStageRoot, "package.json"),
    Buffer.from(`${JSON.stringify(publicationManifest(), null, 2)}\n`),
    0o644,
  );
  const descriptor = createFoundryPackageDescriptor(
    payloadPaths.map((file) => captureFoundryPackageFile(foundryPackageStageRoot, file)),
  );
  const descriptorBytes = Buffer.from(`${JSON.stringify(descriptor, null, 2)}\n`);
  writeAtomic(
    path.join(foundryPackageStageRoot, foundryPackageDescriptorPath),
    descriptorBytes,
    0o644,
  );
  writeAtomic(
    path.join(foundryPackageRepoRoot, foundryPackageDescriptorPath),
    descriptorBytes,
    0o644,
  );
  assertFoundryPackage(foundryPackageStageRoot);
}

export function buildFoundryPackage(): void {
  cleanOwnedOutput(foundryPackageOutputRoot, "package-dist");
  cleanOwnedOutput(foundryPackageStageRoot, "package-stage");
  runCompiler();
  assemblePackage();
}

if (import.meta.main) buildFoundryPackage();

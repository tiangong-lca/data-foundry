import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  buildFoundryPackage,
  foundryPackageRepoRoot,
  foundryPackageStageRoot,
} from "./build-foundry-package.ts";
import { resolvePackageManagerCommand } from "./lib/package-manager-command.ts";

const archiveName = "tiangong-lca-foundry-0.1.0.tgz";
const maxArchiveBytes = 64 * 1024 * 1024;

function archiveBytes(file: string): Buffer {
  let fd: number;
  try {
    fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  } catch {
    throw new Error(`Package archive must be a regular file: ${file}`);
  }
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.size < 1 || stat.size > maxArchiveBytes)
      throw new Error(`Package archive has an invalid size: ${file}`);
    return fs.readFileSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

export function packFoundryPackage(): void {
  buildFoundryPackage();
  const destination = path.join(foundryPackageRepoRoot, "package-artifacts");
  if (fs.existsSync(destination)) {
    const stat = fs.lstatSync(destination);
    if (!stat.isDirectory() || stat.isSymbolicLink())
      throw new Error("Package artifact destination must be a real directory.");
  } else fs.mkdirSync(destination, { mode: 0o700 });
  const temporaryDirectory = fs.mkdtempSync(path.join(destination, ".pack-"));
  if (
    path.dirname(temporaryDirectory) !== destination ||
    !path.basename(temporaryDirectory).startsWith(".pack-")
  )
    throw new Error("Refusing to use an unsafe package temporary directory.");
  try {
    const invocation = resolvePackageManagerCommand("pnpm", [
      "pack",
      "--json",
      "--pack-destination",
      temporaryDirectory,
    ]);
    const result = spawnSync(invocation.executable, invocation.argv, {
      shell: false,
      cwd: foundryPackageStageRoot,
      encoding: "utf8",
      env: process.env,
      maxBuffer: 16 * 1024 * 1024,
    });
    if (result.error) throw result.error;
    if (result.status !== 0)
      throw new Error(`Package archive failed with exit ${result.status ?? 1}.`);
    const value = JSON.parse(result.stdout) as
      { filename?: unknown } | Array<{ filename?: unknown }>;
    const report = Array.isArray(value) ? value : [value];
    if (report.length !== 1 || typeof report[0]?.filename !== "string")
      throw new Error("Package archive command returned an invalid report.");
    const temporaryArchive = path.resolve(report[0].filename);
    if (
      path.dirname(temporaryArchive) !== fs.realpathSync(temporaryDirectory) ||
      path.basename(temporaryArchive) !== archiveName
    )
      throw new Error("Package archive command returned an unexpected output path.");
    const generated = archiveBytes(temporaryArchive);
    const target = path.join(destination, archiveName);
    try {
      fs.linkSync(temporaryArchive, target);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      if (!archiveBytes(target).equals(generated))
        throw new Error("A different package archive already exists; it was not overwritten.");
    }
    process.stdout.write(`${target}\n`);
  } finally {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}

if (import.meta.main) packFoundryPackage();

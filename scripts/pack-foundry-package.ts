import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  buildFoundryPackage,
  foundryPackageRepoRoot,
  foundryPackageStageRoot,
} from "./build-foundry-package.ts";

export function packFoundryPackage(): void {
  buildFoundryPackage();
  const destination = path.join(foundryPackageRepoRoot, "package-artifacts");
  if (fs.existsSync(destination)) {
    const stat = fs.lstatSync(destination);
    if (!stat.isDirectory() || stat.isSymbolicLink())
      throw new Error("Package artifact destination must be a real directory.");
  } else fs.mkdirSync(destination, { mode: 0o700 });
  const executable = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
  const result = spawnSync(executable, ["pack", "--pack-destination", destination], {
    cwd: foundryPackageStageRoot,
    stdio: "inherit",
    env: process.env,
  });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(`Package archive failed with exit ${result.status ?? 1}.`);
}

if (import.meta.main) packFoundryPackage();

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describeCliRuntime } from "@tiangong-lca/cli/runtime";
import {
  assertFoundryPackage,
  assertFoundryPackageDescriptor,
  captureFoundryPackageFile,
  foundryPackageDescriptorPath,
} from "./lib/foundry-package-contract.ts";
import { foundryPackageRepoRoot, foundryPackageStageRoot } from "./build-foundry-package.ts";

interface PackFile {
  path?: unknown;
}

interface PackReport {
  files?: PackFile[];
}

function readDescriptor() {
  return assertFoundryPackageDescriptor(
    JSON.parse(
      fs.readFileSync(path.join(foundryPackageStageRoot, foundryPackageDescriptorPath), "utf8"),
    ),
  );
}

function dryRunPackFiles(): string[] {
  const result = spawnSync(
    process.platform === "win32" ? "pnpm.cmd" : "pnpm",
    ["pack", "--dry-run", "--json"],
    {
      cwd: foundryPackageStageRoot,
      encoding: "utf8",
      env: { ...process.env, NPM_CONFIG_UPDATE_NOTIFIER: "false", NPM_CONFIG_FUND: "false" },
      maxBuffer: 16 * 1024 * 1024,
    },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error("Package dry-run rejected the Foundry package.");
  const value = JSON.parse(result.stdout) as PackReport | PackReport[];
  const parsed = Array.isArray(value) ? value : [value];
  if (parsed.length !== 1 || !Array.isArray(parsed[0]?.files))
    throw new Error("Package dry-run returned an unsupported report.");
  return parsed[0].files.map((entry) => String(entry.path ?? "")).sort();
}

export function verifyFoundryPackage(): void {
  const descriptor = readDescriptor();
  if (
    !fs
      .readFileSync(path.join(foundryPackageStageRoot, foundryPackageDescriptorPath))
      .equals(fs.readFileSync(path.join(foundryPackageRepoRoot, foundryPackageDescriptorPath)))
  )
    throw new Error("Repository and staged package descriptors differ.");
  assertFoundryPackage(foundryPackageStageRoot);
  for (const expected of descriptor.files) {
    const actual = captureFoundryPackageFile(foundryPackageStageRoot, expected.path);
    if (actual.bytes !== expected.bytes || actual.sha256 !== expected.sha256)
      throw new Error(`Package payload changed after descriptor build: ${expected.path}`);
  }
  const expectedPack = [
    ...descriptor.files.map((file) => file.path),
    foundryPackageDescriptorPath,
    "package.json",
  ].sort();
  const packed = dryRunPackFiles();
  if (JSON.stringify(packed) !== JSON.stringify(expectedPack))
    throw new Error("Packed file set differs from the content-bound descriptor.");
  const cli = describeCliRuntime();
  if (cli.package.name !== "@tiangong-lca/cli" || cli.package.version !== "0.1.10")
    throw new Error("Package verification requires exact public CLI 0.1.10.");
  process.stdout.write(
    `${JSON.stringify({
      schema: "tiangong-foundry.package-verification.v1",
      status: "passed",
      package: `${descriptor.package.name}@${descriptor.package.version}`,
      files: descriptor.files.length + 2,
      files_sha256: descriptor.files_sha256,
      cli_version: cli.package.version,
      supported_platforms: descriptor.runtime.supported_platforms,
    })}\n`,
  );
}

if (import.meta.main) verifyFoundryPackage();

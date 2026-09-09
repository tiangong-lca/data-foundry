import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { readFoundryReleaseArtifact } from "./foundry-release-prepared.ts";
import { readFoundryReleaseGit as git } from "./foundry-release-contract.ts";
import { sameFoundryReleaseDirectory } from "./foundry-release-root.ts";
import { resolvePackageManagerCommand } from "./package-manager-command.ts";
import { freezeFoundryReleaseValue } from "./foundry-release-component-io.ts";
const foundryPackageRepoRoot = path.resolve(import.meta.dirname, "../..");
const hash = (value: Uint8Array) => createHash("sha256").update(value).digest("hex");
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid CI context metadata.");
  return value as Record<string, unknown>;
}
export interface FoundryCiBuildContext {
  readonly source: Readonly<{ commit: string; tree: string }>;
  readonly package: Readonly<{ name: "@tiangong-lca/foundry"; version: string }>;
  readonly toolchain: Readonly<{
    node: string;
    pnpm: string;
    typescript: string;
    lock_sha256: string;
  }>;
  readonly run: Readonly<{ id: string; attempt: string; workflow_ref: string }> | null;
}
export function captureFoundryCiBuildContext(
  environment: NodeJS.ProcessEnv = process.env,
): FoundryCiBuildContext {
  const root = foundryPackageRepoRoot;
  if (
    !sameFoundryReleaseDirectory(root, git(root, ["rev-parse", "--show-toplevel"]).trim()) ||
    git(root, ["status", "--porcelain", "--untracked-files=all"]).trim()
  )
    throw new Error("CI package reuse requires the owning clean source checkout.");
  const manifest = object(
    JSON.parse(
      readFoundryReleaseArtifact(path.join(root, "package.json"), 2 * 1024 * 1024).toString("utf8"),
    ),
  );
  const compiler = object(
    JSON.parse(
      readFoundryReleaseArtifact(
        path.join(root, "node_modules/typescript/package.json"),
        2 * 1024 * 1024,
      ).toString("utf8"),
    ),
  );
  const dev = object(manifest.devDependencies);
  const node = fs.readFileSync(path.join(root, ".nvmrc"), "utf8").trim().replace(/^v/u, "");
  const manager = String(manifest.packageManager).match(/^pnpm@(\d+\.\d+\.\d+)$/u)?.[1];
  if (
    manifest.name !== "@tiangong-lca/foundry" ||
    typeof manifest.version !== "string" ||
    !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u.test(manifest.version) ||
    node !== process.versions.node ||
    !manager ||
    typeof compiler.version !== "string" ||
    compiler.version !== dev.typescript
  )
    throw new Error("CI package build requires the exact owning package and toolchain.");
  const invocation = resolvePackageManagerCommand("pnpm", ["--version"]);
  const version = spawnSync(invocation.executable, invocation.argv, {
    cwd: root,
    encoding: "utf8",
    timeout: 30000,
    shell: false,
  });
  if (version.status !== 0 || version.stdout.trim() !== manager)
    throw new Error("CI package pnpm executable differs from its source pin.");
  const source = {
    commit: git(root, ["rev-parse", "HEAD"]).trim(),
    tree: git(root, ["rev-parse", "HEAD^{tree}"]).trim(),
  };
  let run: FoundryCiBuildContext["run"] = null;
  if (environment.GITHUB_ACTIONS === "true") {
    const id = environment.GITHUB_RUN_ID,
      attempt = environment.GITHUB_RUN_ATTEMPT,
      workflow = environment.GITHUB_WORKFLOW_REF;
    if (
      !id ||
      !/^[1-9]\d*$/u.test(id) ||
      !attempt ||
      !/^[1-9]\d*$/u.test(attempt) ||
      !workflow ||
      workflow.includes("\n")
    )
      throw new Error("CI package workflow binding is missing.");
    run = { id, attempt, workflow_ref: workflow };
  }
  return freezeFoundryReleaseValue({
    source,
    package: { name: "@tiangong-lca/foundry", version: manifest.version },
    toolchain: {
      node,
      pnpm: manager,
      typescript: compiler.version,
      lock_sha256: hash(
        readFoundryReleaseArtifact(path.join(root, "pnpm-lock.yaml"), 16 * 1024 * 1024),
      ),
    },
    run,
  });
}

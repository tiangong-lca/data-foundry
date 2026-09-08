import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { foundryPackageRepoRoot } from "../build-foundry-package.ts";
import { packFoundryPackage, type PackedFoundryPackage } from "../pack-foundry-package.ts";
import { verifyFoundryPackage } from "../verify-foundry-package.ts";
import { assertFoundryPackage, type FoundryPackageDescriptor } from "./foundry-package-contract.ts";
import { extractFoundryNpmTarball } from "./foundry-release-extract.ts";
import { readFoundryReleaseArtifact } from "./foundry-release-prepared.ts";
import { readFoundryReleaseGit as git } from "./foundry-release-contract.ts";
import { sameFoundryReleaseDirectory } from "./foundry-release-root.ts";
import { resolvePackageManagerCommand } from "./package-manager-command.ts";
import { freezeFoundryReleaseValue } from "./foundry-release-component-io.ts";

const hash = (value: Uint8Array) => createHash("sha256").update(value).digest("hex");
const digest = /^[0-9a-f]{64}$/u;
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
interface Artifact {
  readonly file: string;
  readonly bytes: number;
  readonly sha256: string;
  readonly inventory_sha256: string;
}
export interface FoundryCiPackageManifest {
  readonly schema: "tiangong-foundry.ci-package.v1";
  readonly context: FoundryCiBuildContext;
  readonly artifact: Artifact;
}
export interface FoundryCiPackageDigests {
  readonly manifestSha256: string;
  readonly archiveSha256: string;
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid CI package artifact metadata.");
  return value as Record<string, unknown>;
}

/** Expected digests come from the producing job, never from the downloaded manifest itself. */
export function verifyFoundryCiPackageBytes(
  manifestBytes: Buffer,
  archive: Buffer,
  expected: FoundryCiPackageDigests,
  context: FoundryCiBuildContext,
): FoundryCiPackageManifest {
  if (
    !digest.test(expected.manifestSha256) ||
    !digest.test(expected.archiveSha256) ||
    hash(manifestBytes) !== expected.manifestSha256 ||
    hash(archive) !== expected.archiveSha256
  )
    throw new Error("CI package digest differs from the independently selected build.");
  if (manifestBytes.length > 1024 * 1024 || archive.length < 1 || archive.length > 64 * 1024 * 1024)
    throw new Error("CI package artifact exceeds its bounds.");
  const manifest = object(JSON.parse(manifestBytes.toString("utf8")));
  if (
    manifest.schema !== "tiangong-foundry.ci-package.v1" ||
    Object.keys(manifest).sort().join(",") !== "artifact,context,schema"
  )
    throw new Error("Invalid CI package artifact schema.");
  if (JSON.stringify(manifest.context) !== JSON.stringify(context))
    throw new Error("CI package build context differs from the current source, toolchain or run.");
  const artifact = object(manifest.artifact);
  if (
    Object.keys(artifact).sort().join(",") !== "bytes,file,inventory_sha256,sha256" ||
    artifact.file !== `tiangong-lca-foundry-${context.package.version}.tgz` ||
    artifact.bytes !== archive.length ||
    artifact.sha256 !== expected.archiveSha256 ||
    typeof artifact.inventory_sha256 !== "string" ||
    !digest.test(artifact.inventory_sha256)
  )
    throw new Error("CI package artifact metadata differs from its verified bytes.");
  return freezeFoundryReleaseValue({
    schema: "tiangong-foundry.ci-package.v1",
    context,
    artifact: {
      file: String(artifact.file),
      bytes: archive.length,
      sha256: expected.archiveSha256,
      inventory_sha256: artifact.inventory_sha256,
    },
  });
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

export function buildFoundryCiPackage(
  output: string,
): FoundryCiPackageManifest & FoundryCiPackageDigests {
  if (!path.isAbsolute(output) || fs.existsSync(output))
    throw new Error("CI package output must be a new absolute directory.");
  const relative = path.relative(foundryPackageRepoRoot, output);
  if (
    !path.isAbsolute(relative) &&
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !relative.startsWith(`package-artifacts${path.sep}`)
  )
    throw new Error("CI package output must be outside source or under package-artifacts/.");
  const context = captureFoundryCiBuildContext();
  fs.mkdirSync(output, { mode: 0o700 });
  const packed = packFoundryPackage(output);
  verifyFoundryPackage();
  if (JSON.stringify(captureFoundryCiBuildContext()) !== JSON.stringify(context))
    throw new Error("CI package source changed during its build.");
  const manifest: FoundryCiPackageManifest = {
    schema: "tiangong-foundry.ci-package.v1",
    context,
    artifact: {
      file: path.basename(packed.path),
      bytes: packed.bytes.length,
      sha256: hash(packed.bytes),
      inventory_sha256: packed.descriptor.files_sha256,
    },
  };
  const bytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
  fs.writeFileSync(path.join(output, "build-manifest.json"), bytes, { flag: "wx", mode: 0o644 });
  return freezeFoundryReleaseValue({
    ...manifest,
    manifestSha256: hash(bytes),
    archiveSha256: manifest.artifact.sha256,
  });
}

export interface VerifiedFoundryCiPackage {
  readonly manifest: FoundryCiPackageManifest;
}
const snapshots = new WeakMap<
  object,
  Readonly<{ context: FoundryCiBuildContext; bytes: Buffer; descriptor: FoundryPackageDescriptor }>
>();
export function readVerifiedFoundryCiPackage(
  input: string,
  expected: FoundryCiPackageDigests,
): VerifiedFoundryCiPackage {
  if (
    !path.isAbsolute(input) ||
    !fs.lstatSync(input).isDirectory() ||
    fs.lstatSync(input).isSymbolicLink()
  )
    throw new Error("CI package input must be a real absolute directory.");
  const context = captureFoundryCiBuildContext();
  const archiveName = `tiangong-lca-foundry-${context.package.version}.tgz`;
  if (
    fs.readdirSync(input).sort().join("\n") !==
    [archiveName, "build-manifest.json"].sort().join("\n")
  )
    throw new Error("CI package input has unexpected artifacts.");
  const manifestBytes = readFoundryReleaseArtifact(
    path.join(input, "build-manifest.json"),
    1024 * 1024,
  );
  const bytes = readFoundryReleaseArtifact(path.join(input, archiveName), 64 * 1024 * 1024);
  const manifest = verifyFoundryCiPackageBytes(manifestBytes, bytes, expected, context);
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "foundry-ci-package-"));
  try {
    const extracted = extractFoundryNpmTarball(bytes, path.join(temporary, "package"));
    const descriptor = freezeFoundryReleaseValue(assertFoundryPackage(extracted.root));
    if (
      descriptor.package.version !== context.package.version ||
      descriptor.files_sha256 !== manifest.artifact.inventory_sha256
    )
      throw new Error("CI package inventory differs from the verified build.");
    const result = Object.freeze({ manifest });
    snapshots.set(result, { context, bytes: Buffer.from(bytes), descriptor });
    return result;
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
}

export function materializeVerifiedFoundryCiPackage(
  value: VerifiedFoundryCiPackage,
  destination: string,
): PackedFoundryPackage {
  const snapshot = snapshots.get(value);
  if (
    !snapshot ||
    JSON.stringify(captureFoundryCiBuildContext()) !== JSON.stringify(snapshot.context)
  )
    throw new Error("CI package reuse requires a fresh verified build snapshot.");
  if (!path.isAbsolute(destination)) throw new Error("CI package destination must be absolute.");
  if (!fs.existsSync(destination)) fs.mkdirSync(destination, { mode: 0o700 });
  if (!fs.lstatSync(destination).isDirectory() || fs.lstatSync(destination).isSymbolicLink())
    throw new Error("CI package destination must be a real directory.");
  const target = path.join(destination, value.manifest.artifact.file);
  fs.writeFileSync(target, snapshot.bytes, { flag: "wx", mode: 0o644 });
  return Object.freeze({
    path: target,
    bytes: Buffer.from(snapshot.bytes),
    descriptor: snapshot.descriptor,
  });
}

export function selectedFoundryCiPackage(
  environment: NodeJS.ProcessEnv = process.env,
): VerifiedFoundryCiPackage | undefined {
  const input = environment.FOUNDRY_CI_PACKAGE_DIR;
  const manifestSha256 = environment.FOUNDRY_CI_PACKAGE_MANIFEST_SHA256;
  const archiveSha256 = environment.FOUNDRY_CI_PACKAGE_SHA256;
  if (input === undefined && manifestSha256 === undefined && archiveSha256 === undefined)
    return undefined;
  if (!input || !manifestSha256 || !archiveSha256)
    throw new Error("CI package reuse requires the complete independent artifact selection.");
  return readVerifiedFoundryCiPackage(input, { manifestSha256, archiveSha256 });
}

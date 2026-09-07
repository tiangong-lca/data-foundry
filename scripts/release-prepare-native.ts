import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { RuntimePlatform, ComponentFile } from "@tiangong-lca/cli/runtime";
import inputs from "../specs/release/runtime-inputs.json" with { type: "json" };
import { readFoundryReleaseGit as git } from "./lib/foundry-release-contract.ts";
import { sameFoundryReleaseDirectory } from "./lib/foundry-release-root.ts";
import { fetchFoundryNativeBytes, selectFoundryNativeFiles } from "./lib/foundry-release-native.ts";
import { selectFoundryTidasDistribution } from "./lib/foundry-release-tidas.ts";
import {
  createFoundrySpdxDocument,
  type FoundrySbomPackage,
} from "./lib/foundry-release-metadata.ts";
import { runTidasHandshake } from "./lib/tidas-adapter.ts";

import { freezeFoundryReleaseValue } from "./lib/foundry-release-component-io.ts";

export interface PreparedFoundryNativeInput {
  readonly output: string;
  readonly payloadRoot: string;
  readonly source: Readonly<{ commit: string; tree: string; date: string }>;
  readonly version: string;
  readonly platform: RuntimePlatform;
  readonly files: readonly ComponentFile[];
  readonly software: readonly FoundrySbomPackage[];
  readonly licenseCoverage: Readonly<{
    node: "vendor-distribution-notices";
    tidas: "project-license-only" | "owner-inventory-verified";
  }>;
  readonly executables: Readonly<{ node: string; tidas: string }>;
  readonly sources: Readonly<
    Record<"node" | "tidas", Readonly<{ repository: string; commit: string; date: string }>>
  >;
  readonly provenance: Readonly<Record<"node" | "tidas", unknown>>;
  readonly observations: Readonly<{
    node: Readonly<{ version: string; platform: string; arch: string; versions: unknown }>;
    tidas: ReturnType<typeof runTidasHandshake>;
  }>;
}
const preparedNative = new WeakSet<object>();
export function assertPreparedFoundryNativeInput(
  value: unknown,
): asserts value is PreparedFoundryNativeInput {
  if (!value || typeof value !== "object" || !preparedNative.has(value))
    throw new Error(
      "Runtime assembly requires freshly prepared native inputs, not serialized receipts.",
    );
}

const usage = "Usage: release-prepare-native --output <new-absolute-directory>";
const json = (value: unknown): Buffer => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
const hash = (bytes: Buffer): string => createHash("sha256").update(bytes).digest("hex");
function format(value: string): "tar-gzip" | "zip" | "file" {
  if (value === "tar-gzip" || value === "zip" || value === "file") return value;
  throw new Error("Native release archive format is invalid.");
}

export async function prepareFoundryNativeInput(
  selectedOutput: string,
): Promise<PreparedFoundryNativeInput> {
  if (!path.isAbsolute(selectedOutput)) throw new Error("Native input output must be absolute.");
  const output = path.join(
    fs.realpathSync(path.dirname(selectedOutput)),
    path.basename(selectedOutput),
  );
  if (fs.existsSync(output))
    throw new Error("Native input will not replace an existing directory.");
  const root = path.resolve(import.meta.dirname, "..");
  const relative = path.relative(root, output);
  if (
    !path.isAbsolute(relative) &&
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !relative.startsWith(`package-artifacts${path.sep}`)
  )
    throw new Error("Native input output must be outside source or under package-artifacts/.");
  if (
    !sameFoundryReleaseDirectory(root, git(root, ["rev-parse", "--show-toplevel"]).trim()) ||
    git(root, ["status", "--porcelain", "--untracked-files=all"]).trim()
  )
    throw new Error("Native input requires its own clean source checkout.");
  const sourceCommit = git(root, ["rev-parse", "HEAD"]).trim(),
    sourceTree = git(root, ["rev-parse", "HEAD^{tree}"]).trim();
  const sourceDate = new Date(
    git(root, ["show", "-s", "--format=%cI", "HEAD"]).trim(),
  ).toISOString();
  const selected = `${process.platform}-${process.arch}`;
  if (
    !["linux-x64", "linux-arm64", "darwin-arm64", "win32-x64"].includes(selected) ||
    inputs.node.version !==
      fs.readFileSync(path.join(root, ".nvmrc"), "utf8").trim().replace(/^v/u, "") ||
    process.versions.node !== inputs.node.version
  )
    throw new Error("Native input requires the pinned supported host/toolchain.");
  const platform = selected as RuntimePlatform;
  const node = inputs.node.platforms[platform],
    tidas = inputs.tidas.platforms[platform];
  const [nodeArchive, tidasArchive, nodeLicense] = await Promise.all([
    fetchFoundryNativeBytes(node.url, node.sha256),
    fetchFoundryNativeBytes(tidas.url, tidas.sha256),
    fetchFoundryNativeBytes(inputs.node.license.source_url, inputs.node.license.sha256),
  ]);
  const nodeFiles = selectFoundryNativeFiles(nodeArchive, {
    format: format(node.format),
    sha256: node.sha256,
    files: [node.executable, ...(node.license ? [node.license] : [])],
  });
  if (node.license && !nodeFiles.get(node.license)?.equals(nodeLicense))
    throw new Error("Node archive and pinned source license differ.");
  const tidasFormat = format(tidas.format);
  if (tidasFormat === "file") throw new Error("TIDAS input must be a complete native archive.");
  const qualifiedTidas = selectFoundryTidasDistribution(tidasArchive, {
    format: tidasFormat,
    sha256: tidas.sha256,
    version: inputs.tidas.version,
    target: tidas.target,
    sourceCommit: inputs.tidas.source_commit,
  });
  const tidasFiles = qualifiedTidas.files;
  const distributionBytes = tidasFiles.get(tidas.manifest)!;
  const tidasRoot = `tidas-v${inputs.tidas.version}-${tidas.target}/`;
  const noticeFiles = [...tidasFiles].filter(([name]) =>
    name.startsWith(`${tidasRoot}share/licenses/tidas/third-party-notices/`),
  );
  const tidasLicenseFiles = [
    "share/licenses/tidas/LICENSE",
    ...noticeFiles
      .filter(([name]) =>
        name.startsWith(`${tidasRoot}share/licenses/tidas/third-party-notices/texts/`),
      )
      .map(([name]) => name.slice(tidasRoot.length)),
  ].sort();
  fs.mkdirSync(output, { mode: 0o700 });
  const created = fs.lstatSync(output, { bigint: true });
  try {
    const payload = path.join(output, "payload");
    fs.mkdirSync(payload, { mode: 0o700 });
    const executableSuffix = platform === "win32-x64" ? ".exe" : "";
    const nodeExecutable = `bin/node${executableSuffix}`,
      tidasExecutable = `bin/tidas${executableSuffix}`;
    const nativeFiles = [
      { path: nodeExecutable, bytes: nodeFiles.get(node.executable)!, mode: 0o755 as const },
      { path: tidasExecutable, bytes: tidasFiles.get(tidas.executable)!, mode: 0o755 as const },
      { path: "share/licenses/node/LICENSE", bytes: nodeLicense, mode: 0o644 as const },
      {
        path: "share/licenses/tidas/LICENSE",
        bytes: tidasFiles.get(tidas.license)!,
        mode: 0o644 as const,
      },
      { path: "metadata/tidas-distribution.json", bytes: distributionBytes, mode: 0o644 as const },
      {
        path: "share/licenses/tidas/THIRD-PARTY-NOTICES.txt",
        bytes: qualifiedTidas.noticeText,
        mode: 0o644 as const,
      },
      ...noticeFiles.map(([name, bytes]) => ({
        path: name.slice(tidasRoot.length),
        bytes,
        mode: 0o644 as const,
      })),
    ];
    const files: ComponentFile[] = [];
    for (const file of nativeFiles) {
      const target = path.join(payload, file.path);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, file.bytes, { flag: "wx", mode: file.mode });
      files.push({
        path: file.path,
        bytes: file.bytes.length,
        sha256: hash(file.bytes),
        mode: file.mode,
      });
    }
    const privateHome = path.join(output, "inspection-home");
    fs.mkdirSync(privateHome, { mode: 0o700 });
    const environment: NodeJS.ProcessEnv = { HOME: privateHome, USERPROFILE: privateHome };
    for (const key of [
      "PATH",
      "Path",
      "SystemRoot",
      "WINDIR",
      "PATHEXT",
      "TEMP",
      "TMP",
      "TMPDIR",
      "LANG",
      "LC_ALL",
      "TZ",
    ])
      if (process.env[key] !== undefined) environment[key] = process.env[key];
    const nodeObserved = spawnSync(
      path.join(payload, nodeExecutable),
      [
        "--input-type=module",
        "-e",
        "process.stdout.write(JSON.stringify({version:process.versions.node,platform:process.platform,arch:process.arch,versions:process.versions}));",
      ],
      {
        cwd: privateHome,
        env: environment,
        shell: false,
        encoding: "utf8",
        timeout: 60000,
        maxBuffer: 1024 * 1024,
      },
    );
    if (nodeObserved.error || nodeObserved.status !== 0)
      throw new Error("Downloaded Node executable failed native inspection.");
    const nodeObservation = JSON.parse(nodeObserved.stdout) as {
      version: string;
      platform: string;
      arch: string;
      versions: unknown;
    };
    if (
      nodeObservation.version !== inputs.node.version ||
      `${nodeObservation.platform}-${nodeObservation.arch}` !== platform
    )
      throw new Error("Downloaded Node version or architecture differs from the selected target.");
    const tidasObservation = runTidasHandshake({
      repoRoot: privateHome,
      options: { tidasBin: path.join(payload, tidasExecutable) },
      environment,
    });
    if (tidasObservation.binary_version !== inputs.tidas.version)
      throw new Error("Downloaded TIDAS version differs from the selected target.");
    const software: FoundrySbomPackage[] = [
      {
        id: `node@${inputs.node.version}`,
        name: "node",
        version: inputs.node.version,
        download_url: node.url,
        sha256: node.sha256,
        declared_license: "MIT",
        license_files: ["share/licenses/node/LICENSE"],
        dependencies: [],
        source_info: `Official Node release ${inputs.node.tag}; source ${inputs.node.source_commit}; full bundled notices retained.`,
      },
      {
        id: `tidas@${inputs.tidas.version}`,
        name: "tidas",
        version: inputs.tidas.version,
        download_url: tidas.url,
        sha256: tidas.sha256,
        declared_license: "MIT",
        license_files: tidasLicenseFiles,
        dependencies: [],
        source_info: `Qualified TIDAS release ${inputs.tidas.tag}; actual release target ${inputs.tidas.source_commit}; complete owner notice inventory retained with Cargo, native and Rust source scope.`,
      },
    ];
    const version = (
      JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")) as { version: string }
    ).version;
    const sbom = createFoundrySpdxDocument(
      software,
      software.map((pkg) => pkg.id),
      { component: "foundry-native-runtime-input", version, platform, sourceCommit, sourceDate },
    );
    const sbomBytes = json(sbom);
    fs.writeFileSync(path.join(payload, "metadata/sbom.spdx.json"), sbomBytes, {
      flag: "wx",
      mode: 0o644,
    });
    files.push({
      path: "metadata/sbom.spdx.json",
      bytes: sbomBytes.length,
      sha256: hash(sbomBytes),
      mode: 0o644,
    });
    if (
      git(root, ["rev-parse", "HEAD"]).trim() !== sourceCommit ||
      git(root, ["rev-parse", "HEAD^{tree}"]).trim() !== sourceTree ||
      git(root, ["status", "--porcelain", "--untracked-files=all"]).trim()
    )
      throw new Error("Native preparation source changed during inspection.");
    const receipt = {
      schema: "tiangong-foundry.prepared-native-input.v1",
      status: "prepared",
      scope: "native-runtime-input",
      source: { commit: sourceCommit, tree: sourceTree, date: sourceDate },
      platform,
      artifacts: {
        node: { ...node, bytes: nodeArchive.length },
        tidas: { ...tidas, bytes: tidasArchive.length },
      },
      files: files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)),
      software,
      observations: { node: nodeObservation, tidas: tidasObservation },
    };
    const requirements = "requirements" in tidas ? tidas.requirements : undefined;
    const runtimeNote =
      requirements &&
      "external_runtime_dlls" in requirements &&
      requirements.external_runtime_dlls.length > 0
        ? `Current TIDAS ${inputs.tidas.version} requires ${requirements.external_runtime_dlls.join(", ")}; a developer-runner handshake does not qualify clean startup. Owning correction: ${requirements.issue}.\n`
        : "";
    fs.writeFileSync(path.join(output, "native-input.json"), json(receipt), {
      flag: "wx",
      mode: 0o600,
    });
    fs.writeFileSync(
      path.join(output, "README.md"),
      `# Prepared native runtime input\n\nSource: ${sourceCommit}\n\nVerified official Node and TIDAS bytes, licenses and native handshakes for ${platform}. This is an assembly input; final minimum-host ABI, complete Node/CLI/Foundry/TIDAS components and cold-start qualification remain separate gates.\n\n${runtimeNote}`,
      { flag: "wx", mode: 0o600 },
    );
    const prepared = freezeFoundryReleaseValue({
      output,
      payloadRoot: payload,
      source: receipt.source,
      version,
      platform,
      files,
      software,
      executables: { node: nodeExecutable, tidas: tidasExecutable },
      sources: {
        node: {
          repository: inputs.node.repository,
          commit: inputs.node.source_commit,
          date: inputs.node.source_date,
        },
        tidas: {
          repository: inputs.tidas.repository,
          commit: inputs.tidas.source_commit,
          date: inputs.tidas.source_date,
        },
      },
      provenance: {
        node: {
          schema: "tiangong-foundry.native-component-provenance.v1",
          repository: inputs.node.repository,
          source_commit: inputs.node.source_commit,
          source_date: inputs.node.source_date,
          version: inputs.node.version,
          tag: inputs.node.tag,
          artifact: { ...node, bytes: nodeArchive.length },
          license: inputs.node.license,
        },
        tidas: {
          schema: "tiangong-foundry.native-component-provenance.v1",
          repository: inputs.tidas.repository,
          source_commit: inputs.tidas.source_commit,
          source_date: inputs.tidas.source_date,
          version: inputs.tidas.version,
          tag: inputs.tidas.tag,
          artifact: { ...tidas, bytes: tidasArchive.length },
          distribution: qualifiedTidas.distribution,
          third_party_notices: qualifiedTidas.notice,
        },
      },
      observations: receipt.observations,
      licenseCoverage: {
        node: "vendor-distribution-notices" as const,
        tidas: "owner-inventory-verified" as const,
      },
    });
    preparedNative.add(prepared);
    return prepared;
  } catch (error) {
    if (fs.existsSync(output)) {
      const current = fs.lstatSync(output, { bigint: true });
      if (current.isDirectory() && current.dev === created.dev && current.ino === created.ino)
        fs.rmSync(output, { recursive: true, force: true });
    }
    throw error;
  }
}

async function main(args: readonly string[]): Promise<void> {
  if (args.length === 1 && args[0] === "--help") {
    process.stdout.write(`${usage}\n`);
    return;
  }
  if (args.length !== 2 || args[0] !== "--output" || !args[1]) throw new Error(usage);
  const prepared = await prepareFoundryNativeInput(args[1]);
  process.stdout.write(
    `${JSON.stringify({ status: "prepared", scope: "native-runtime-input", output: prepared.output, platform: prepared.platform, node: prepared.observations.node.version, tidas: prepared.observations.tidas.binary_version, files: prepared.files.length })}\n`,
  );
}

if (import.meta.main)
  main(process.argv.slice(2)).catch((error: unknown) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : "Native input preparation failed."}\n`,
    );
    process.exitCode = 1;
  });

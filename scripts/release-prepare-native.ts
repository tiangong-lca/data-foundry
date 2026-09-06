import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { RuntimePlatform, ComponentFile } from "@tiangong-lca/cli/runtime";
import inputs from "../specs/release/runtime-inputs.json" with { type: "json" };
import { readFoundryReleaseGit as git } from "./lib/foundry-release-contract.ts";
import { sameFoundryReleaseDirectory } from "./lib/foundry-release-root.ts";
import { fetchFoundryNativeBytes, selectFoundryNativeFiles } from "./lib/foundry-release-native.ts";
import {
  createFoundrySpdxDocument,
  type FoundrySbomPackage,
} from "./lib/foundry-release-metadata.ts";
import { runTidasHandshake } from "./lib/tidas-adapter.ts";

const usage = "Usage: release-prepare-native --output <new-absolute-directory>";
const json = (value: unknown): Buffer => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
const hash = (bytes: Buffer): string => createHash("sha256").update(bytes).digest("hex");
function format(value: string): "tar-gzip" | "zip" | "file" {
  if (value === "tar-gzip" || value === "zip" || value === "file") return value;
  throw new Error("Native release archive format is invalid.");
}

async function main(args: readonly string[]): Promise<void> {
  if (args.length === 1 && args[0] === "--help") {
    process.stdout.write(`${usage}\n`);
    return;
  }
  if (args.length !== 2 || args[0] !== "--output" || !args[1]) throw new Error(usage);
  if (!path.isAbsolute(args[1])) throw new Error("Native input output must be absolute.");
  const output = path.join(fs.realpathSync(path.dirname(args[1])), path.basename(args[1]));
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
  const tidasFiles = selectFoundryNativeFiles(tidasArchive, {
    format: format(tidas.format),
    sha256: tidas.sha256,
    files: [tidas.executable, tidas.manifest, tidas.license],
  });
  const distributionBytes = tidasFiles.get(tidas.manifest)!;
  const distribution: unknown = JSON.parse(distributionBytes.toString("utf8"));
  const distributionExpected = {
    schema_version: "tidas.distribution-manifest.v1",
    product: "tidas",
    version: inputs.tidas.version,
    target: tidas.target,
    executable: `bin/tidas${platform === "win32-x64" ? ".exe" : ""}`,
    self_contained_native_xml: true,
  };
  if (
    !distribution ||
    typeof distribution !== "object" ||
    Array.isArray(distribution) ||
    Object.keys(distribution).length !== Object.keys(distributionExpected).length ||
    Object.entries(distributionExpected).some(
      ([key, value]) => (distribution as Record<string, unknown>)[key] !== value,
    )
  )
    throw new Error("TIDAS distribution manifest differs from its qualified native target.");
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
        license_files: ["share/licenses/tidas/LICENSE"],
        dependencies: [],
        source_info: `Qualified TIDAS release ${inputs.tidas.tag}; actual release target ${inputs.tidas.source_commit}.`,
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
      requirements && "external_runtime_dlls" in requirements
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
    process.stdout.write(
      `${JSON.stringify({ status: receipt.status, scope: receipt.scope, output, platform, node: nodeObservation.version, tidas: tidasObservation.binary_version, files: files.length })}\n`,
    );
  } catch (error) {
    if (fs.existsSync(output)) {
      const current = fs.lstatSync(output, { bigint: true });
      if (current.isDirectory() && current.dev === created.dev && current.ino === created.ino)
        fs.rmSync(output, { recursive: true, force: true });
    }
    throw error;
  }
}

if (import.meta.main)
  main(process.argv.slice(2)).catch((error: unknown) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : "Native input preparation failed."}\n`,
    );
    process.exitCode = 1;
  });

import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { writeRuntimeComponentArchive, type ComponentFile } from "@tiangong-lca/cli/runtime";
import inputs from "../specs/release/runtime-inputs.json" with { type: "json" };
import { readFoundryReleaseGit as git } from "./lib/foundry-release-contract.ts";
import { sameFoundryReleaseDirectory } from "./lib/foundry-release-root.ts";
import { npmReleasePolicy, verifyPublicNpmRelease } from "./lib/foundry-release-provenance.ts";
import { readFoundryReleaseArtifact } from "./lib/foundry-release-prepared.ts";
import { projectFoundryProductionLock } from "./lib/foundry-release-production.ts";
import { materializeFoundryProductionPackages } from "./lib/foundry-release-production-materialize.ts";
import {
  collectFoundryNpmMetadata,
  createFoundrySpdxDocument,
} from "./lib/foundry-release-metadata.ts";

const usage = "Usage: release-prepare-production --output <new-absolute-directory>";
const json = (value: unknown): Buffer => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);

async function main(args: readonly string[]): Promise<void> {
  if (args.length === 1 && args[0] === "--help") {
    process.stdout.write(`${usage}\n`);
    return;
  }
  if (args.length !== 2 || args[0] !== "--output" || !args[1]) throw new Error(usage);
  if (!path.isAbsolute(args[1])) throw new Error("Production input output must be absolute.");
  const output = path.join(fs.realpathSync(path.dirname(args[1])), path.basename(args[1]));
  if (fs.existsSync(output))
    throw new Error("Production input will not replace an existing directory.");
  const root = path.resolve(import.meta.dirname, "..");
  const relative = path.relative(root, output);
  if (
    !path.isAbsolute(relative) &&
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !relative.startsWith(`package-artifacts${path.sep}`)
  )
    throw new Error(
      "Production input must be outside the source checkout or under package-artifacts/.",
    );
  if (
    !sameFoundryReleaseDirectory(root, git(root, ["rev-parse", "--show-toplevel"]).trim()) ||
    git(root, ["status", "--porcelain", "--untracked-files=all"]).trim()
  )
    throw new Error("Production input requires its own clean source checkout.");
  const sourceCommit = git(root, ["rev-parse", "HEAD"]).trim();
  const sourceTree = git(root, ["rev-parse", "HEAD^{tree}"]).trim();
  const sourceDate = new Date(
    git(root, ["show", "-s", "--format=%cI", "HEAD"]).trim(),
  ).toISOString();
  const manifest = JSON.parse(
    readFoundryReleaseArtifact(path.join(root, "package.json"), 2 * 1024 * 1024).toString("utf8"),
  ) as {
    name: string;
    version: string;
    packageManager: string;
    dependencies: Record<string, string>;
  };
  const platform = `${process.platform}-${process.arch}`;
  if (
    manifest.name !== "@tiangong-lca/foundry" ||
    manifest.packageManager !== "pnpm@11.24.0" ||
    process.versions.node !==
      fs.readFileSync(path.join(root, ".nvmrc"), "utf8").trim().replace(/^v/u, "") ||
    !["linux-x64", "linux-arm64", "darwin-arm64", "win32-x64"].includes(platform)
  )
    throw new Error("Production input requires the owning package and pinned supported toolchain.");
  npmReleasePolicy({ package: "foundry", version: manifest.version, gitHead: sourceCommit });
  const cliExpected = {
    package: "cli" as const,
    version: inputs.cli.version,
    gitHead: inputs.cli.source_commit,
  };
  const cliPolicy = npmReleasePolicy(cliExpected);
  if (
    inputs.schema !== "tiangong-foundry.release-runtime-inputs.v1" ||
    inputs.cli.package !== cliPolicy.name ||
    inputs.cli.repository !== cliPolicy.repository ||
    !cliPolicy.refs.includes(`refs/tags/${inputs.cli.tag}`) ||
    manifest.dependencies[inputs.cli.package] !== inputs.cli.version
  )
    throw new Error("Production CLI input differs from the reviewed package dependency.");
  const lock = projectFoundryProductionLock(
    readFoundryReleaseArtifact(path.join(root, "pnpm-lock.yaml"), 16 * 1024 * 1024),
    manifest.dependencies,
  );
  const cli = await verifyPublicNpmRelease(cliExpected);
  if (
    !lock.packages.some(
      (pkg) => pkg.name === inputs.cli.package && pkg.integrity === cli.evidence.tarball.integrity,
    )
  )
    throw new Error("Production lock differs from the independently verified public CLI artifact.");
  fs.mkdirSync(output, { mode: 0o700 });
  const created = fs.lstatSync(output, { bigint: true });
  try {
    const tree = await materializeFoundryProductionPackages(
      lock,
      path.join(output, "payload"),
      (url, init) =>
        url === cli.evidence.tarball.url
          ? Promise.resolve(new Response(cli.tarballBytes))
          : fetch(url, init),
    );
    const metadata = collectFoundryNpmMetadata(tree);
    const sbom = createFoundrySpdxDocument(metadata.packages, metadata.roots, {
      component: "foundry-npm-production-input",
      version: manifest.version,
      platform,
      sourceCommit,
      sourceDate,
    });
    const additions = [
      ...metadata.files,
      { path: "metadata/production-lock.json", bytes: json(lock) },
      { path: "metadata/licenses.json", bytes: json(metadata.license_index) },
      { path: "metadata/sbom.spdx.json", bytes: json(sbom) },
      {
        path: "metadata/provenance.json",
        bytes: json({
          schema: "tiangong-foundry.production-input-provenance.v1",
          scope: "npm-production-input",
          sourceCommit,
          sourceTree,
          sourceDate,
          sourceLock: lock.source,
          cli: cli.evidence,
          packages: tree.packages,
        }),
      },
    ];
    const files: ComponentFile[] = [...tree.files];
    for (const file of additions) {
      const target = path.join(tree.root, file.path);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, file.bytes, { flag: "wx", mode: 0o644 });
      files.push({
        path: file.path,
        bytes: file.bytes.length,
        sha256: createHash("sha256").update(file.bytes).digest("hex"),
        mode: 0o644,
      });
    }
    files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    const environment: NodeJS.ProcessEnv = {};
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
    const inspected = spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        'import {describeCliRuntime} from "@tiangong-lca/cli/runtime"; process.stdout.write(JSON.stringify(describeCliRuntime()));',
      ],
      {
        cwd: tree.root,
        env: environment,
        shell: false,
        encoding: "utf8",
        timeout: 60000,
        maxBuffer: 8 * 1024 * 1024,
      },
    );
    if (inspected.error || inspected.status !== 0)
      throw new Error("Production input failed public CLI runtime inspection.");
    const observed: unknown = JSON.parse(inspected.stdout);
    const archive = await writeRuntimeComponentArchive(
      tree.root,
      files,
      path.join(output, "npm-production-input.tgz"),
    );
    if (
      git(root, ["rev-parse", "HEAD"]).trim() !== sourceCommit ||
      git(root, ["rev-parse", "HEAD^{tree}"]).trim() !== sourceTree ||
      git(root, ["status", "--porcelain", "--untracked-files=all"]).trim()
    )
      throw new Error("Production input source changed during assembly.");
    const receipt = {
      schema: "tiangong-foundry.prepared-production-input.v1",
      status: "prepared",
      scope: "npm-production-input",
      source: {
        repository: "https://github.com/tiangong-lca/data-foundry",
        commit: sourceCommit,
        tree: sourceTree,
        date: sourceDate,
      },
      package_version: manifest.version,
      platform,
      packages: tree.packages,
      files,
      archive: { file: "npm-production-input.tgz", ...archive },
      sbom: "metadata/sbom.spdx.json",
      licenses: metadata.files.map((file) => file.path),
      cli: cli.evidence,
    };
    fs.writeFileSync(path.join(output, "production-input.json"), json(receipt), {
      flag: "wx",
      mode: 0o600,
    });
    fs.writeFileSync(path.join(output, "cli-runtime.json"), json(observed), {
      flag: "wx",
      mode: 0o600,
    });
    fs.writeFileSync(
      path.join(output, "README.md"),
      `# Prepared Foundry npm production input\n\nSource: ${sourceCommit}\n\nThis contains the locked npm dependency payload, complete retained licenses, SPDX data and independently verified public CLI provenance. It is an input to complete runtime assembly; it is not a released Node/CLI/Foundry/TIDAS component or a product manifest.\n`,
      { flag: "wx", mode: 0o600 },
    );
    process.stdout.write(
      `${JSON.stringify({ status: receipt.status, scope: receipt.scope, output, sourceCommit, packages: tree.packages.length, files: files.length, archive })}\n`,
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
      `${error instanceof Error ? error.message : "Production input preparation failed."}\n`,
    );
    process.exitCode = 1;
  });

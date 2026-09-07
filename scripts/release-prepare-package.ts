import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { packFoundryPackage } from "./pack-foundry-package.ts";
import { loadFoundryReleaseWorkflowContext } from "./lib/foundry-release-workflow.ts";
import { createGitHubFoundryTagStore } from "./lib/foundry-release-tag.ts";
import { signFoundryNpmArtifact } from "./lib/foundry-release-signing.ts";
import { readFoundryReleaseArtifact } from "./lib/foundry-release-prepared.ts";

async function main(args: readonly string[]): Promise<void> {
  if (args.length || process.env.GITHUB_JOB !== "npm-package")
    throw new Error(
      "Package preparation requires the owning npm-package workflow job and accepts no arguments.",
    );
  const root = path.resolve(import.meta.dirname, "..");
  const { context, pr } = await loadFoundryReleaseWorkflowContext(root, process.env);
  if (!context.release || !pr)
    throw new Error("Package preparation requires a merged release-only main PR.");
  const tag = await createGitHubFoundryTagStore(process.env.GITHUB_TOKEN ?? "").read(
    `refs/tags/${context.tag}`,
  );
  if (tag?.head !== context.head)
    throw new Error("Package preparation requires the exact qualified release tag.");
  const artifactRoot = path.join(root, "package-artifacts");
  if (!fs.existsSync(artifactRoot)) fs.mkdirSync(artifactRoot, { mode: 0o700 });
  const parent = fs.lstatSync(artifactRoot);
  if (!parent.isDirectory() || parent.isSymbolicLink())
    throw new Error("Package artifacts require a real owned directory.");
  const output = path.join(artifactRoot, "npm-release");
  fs.mkdirSync(output, { mode: 0o700 });
  const packed = packFoundryPackage(output);
  if (
    packed.descriptor.package.name !== "@tiangong-lca/foundry" ||
    packed.descriptor.package.version !== context.version
  )
    throw new Error("The built package does not match its qualified release context.");
  const fresh = await loadFoundryReleaseWorkflowContext(root, process.env);
  if (
    !fresh.context.release ||
    fresh.context.head !== context.head ||
    fresh.context.tree !== context.tree
  )
    throw new Error("Release source changed while the package was built.");
  const signed = await signFoundryNpmArtifact(context, packed.bytes);
  const archiveName = path.basename(packed.path),
    bundleName = `foundry-${context.version}.sigstore`;
  const observed = readFoundryReleaseArtifact(packed.path, 64 * 1024 * 1024);
  if (!observed.equals(signed.tarballBytes))
    throw new Error("Prepared package bytes changed during signing.");
  fs.writeFileSync(path.join(output, bundleName), signed.bundleBytes, { flag: "wx", mode: 0o600 });
  const receipt = {
    schema: "tiangong-foundry.prepared-npm-release.v1",
    status: "prepared",
    package: { name: "@tiangong-lca/foundry", version: context.version },
    source: {
      repository: "https://github.com/tiangong-lca/data-foundry",
      commit: context.head,
      tree: context.tree,
      tag: context.tag,
      pr,
      ...signed.binding,
    },
    registry: "https://registry.npmjs.org/",
    access: "public",
    package_manager: "pnpm@11.24.0",
    tarball: {
      file: archiveName,
      bytes: signed.tarballBytes.length,
      sha256: signed.sha256,
      sha512: signed.sha512,
    },
    provenance: {
      file: bundleName,
      bytes: signed.bundleBytes.length,
      sha256: createHash("sha256").update(signed.bundleBytes).digest("hex"),
    },
    package_inventory_sha256: packed.descriptor.files_sha256,
  };
  fs.writeFileSync(
    path.join(output, "prepared-release.json"),
    `${JSON.stringify(receipt, null, 2)}\n`,
    { flag: "wx", mode: 0o600 },
  );
  fs.writeFileSync(
    path.join(output, "README.md"),
    [
      `# Prepared ${receipt.package.name}@${receipt.package.version}`,
      "",
      `Source: ${receipt.source.repository}/commit/${context.head}`,
      `Qualified source PR: ${pr.url}`,
      `Signing run: ${signed.binding.invocationId}`,
      "",
      "These files are a CI-built and signed package prepared for publication. Preparation alone does not prove npm publication or complete F1 component qualification.",
      "",
      "Select this version and source commit independently from the reviewed release PR. From that source checkout with its frozen development dependencies installed, verify the downloaded package and signature:",
      "",
      "```text",
      `pnpm release:verify-prepared --directory <absolute-download-directory> --version ${context.version} --expected-git-head ${context.head}`,
      "```",
      "",
      "The verifier checks the signed package bytes and exact source/workflow identity. This receipt and README are informational; they cannot select the trusted source or prove npm publication.",
      "",
      "For the one-time first-package handoff, use an authorized npm account and complete its required 2FA. Keep the downloaded files unchanged and work from their directory outside a Git checkout.",
      "",
      "Use the pinned pnpm 11.24.0 client after verifying the recorded source and artifact digests:",
      "",
      "```text",
      `pnpm publish ./${archiveName} --access public --no-git-checks --config.provenance-file=./${bundleName}`,
      "```",
      "",
      "The registry package identity and Trusted Publisher configuration must be reviewed separately. Routine publication remains owned by the GitHub release workflow.",
      "",
    ].join("\n"),
    { flag: "wx", mode: 0o600 },
  );
  process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
}

if (import.meta.main)
  main(process.argv.slice(2)).catch((error: unknown) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : "Package preparation failed."}\n`,
    );
    process.exitCode = 1;
  });

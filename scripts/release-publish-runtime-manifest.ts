import fs from "node:fs";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { trustRuntimeManifest } from "@tiangong-lca/cli/runtime";
import inputs from "../specs/release/runtime-inputs.json" with { type: "json" };
import { loadFoundryReleaseWorkflowContext } from "./lib/foundry-release-workflow.ts";
import { createGitHubFoundryTagStore, ensureFoundryReleaseTag } from "./lib/foundry-release-tag.ts";
import {
  createGitHubFoundryAssetStore,
  publishFoundryReleaseAssets,
} from "./lib/foundry-release-assets.ts";
import { fetchFoundryNativeBytes } from "./lib/foundry-release-native.ts";
import { createFoundryBootstrapLock } from "./lib/foundry-release-bootstrap.ts";
import { verifyFoundryPublicBootstrapReports } from "./lib/foundry-release-public-qualification.ts";
import { readFoundryReleaseArtifact } from "./lib/foundry-release-prepared.ts";
import { readFoundryReleaseGit as git } from "./lib/foundry-release-contract.ts";
import {
  foundryComponentJson as json,
  foundryComponentHash as hash,
  writeFoundryComponentFile,
} from "./lib/foundry-release-component-io.ts";

async function main(args: readonly string[]) {
  if (args.length)
    throw new Error(
      "Usage: release-publish-runtime-manifest (owning GitHub release workflow only)",
    );
  if (process.env.GITHUB_JOB !== "publish-runtime-manifest")
    throw new Error("Final manifest publication requires its owning job.");
  const root = path.resolve(import.meta.dirname, "..");
  const { context, pr } = await loadFoundryReleaseWorkflowContext(root, process.env);
  if (!context.release || !pr)
    throw new Error("Final manifest requires the exact merged release source.");
  const temporary = process.env.RUNNER_TEMP,
    expectedSha = process.env.EXPECTED_MANIFEST_SHA256;
  if (!temporary || !path.isAbsolute(temporary) || !/^[0-9a-f]{64}$/u.test(expectedSha ?? ""))
    throw new Error("Final manifest requires independently selected workflow inputs.");
  const input = path.join(temporary, "foundry-manifest-publication-input");
  const manifestBytes = readFoundryReleaseArtifact(
    path.join(input, "runtime-manifest.json"),
    32 * 1024 * 1024,
  );
  const trusted = trustRuntimeManifest(manifestBytes, expectedSha!);
  const aggregate = JSON.parse(
    readFoundryReleaseArtifact(
      path.join(input, "runtime-aggregate.json"),
      32 * 1024 * 1024,
    ).toString("utf8"),
  ) as {
    schema: string;
    status: string;
    source: { repository: string; commit: string; tree: string; date: string };
    scope: string;
    manifest_sha256: string;
    version: string;
  };
  const source = {
    repository: "https://github.com/tiangong-lca/foundry",
    commit: context.head,
    tree: context.tree,
    date: new Date(git(root, ["show", "-s", "--format=%cI", "HEAD"]).trim()).toISOString(),
  };
  if (
    aggregate.schema !== "tiangong-foundry.runtime-aggregate.v1" ||
    aggregate.status !== "verified" ||
    !isDeepStrictEqual(aggregate.source, source) ||
    aggregate.scope !== "published-release" ||
    aggregate.version !== context.version ||
    aggregate.manifest_sha256 !== expectedSha ||
    trusted.manifest.product.version !== context.version
  )
    throw new Error("Final manifest aggregate differs from the release.");
  const platforms = Object.keys(inputs.minimum_hosts).sort();
  const reports = platforms.map((platform) =>
    readFoundryReleaseArtifact(
      path.join(
        temporary,
        "foundry-public-bootstrap-reports",
        platform,
        "bootstrap-qualification.json",
      ),
      16 * 1024 * 1024,
    ),
  );
  const parsed = reports.map((bytes) => JSON.parse(bytes.toString("utf8")) as unknown);
  const qualification = verifyFoundryPublicBootstrapReports(parsed, trusted, source);
  const candidateUrl = `https://github.com/tiangong-lca/foundry/releases/download/${context.tag}/runtime-candidate.json`;
  const publicCandidate = await fetchFoundryNativeBytes(candidateUrl, trusted.sha256);
  if (!publicCandidate.equals(manifestBytes))
    throw new Error("Public candidate manifest differs from qualified bytes.");
  const token = process.env.GITHUB_TOKEN ?? "";
  const tags = createGitHubFoundryTagStore(token);
  const sourceTag = await tags.read(`refs/tags/${context.tag}`);
  if (sourceTag?.head !== context.head)
    throw new Error("Component release tag differs from the qualified source.");
  const finalTag = await ensureFoundryReleaseTag(
    { version: context.version, head: context.head, kind: "manifest" },
    tags,
  );
  const tag = finalTag.ref.slice("refs/tags/".length);
  const manifestUrl = `https://github.com/tiangong-lca/foundry/releases/download/${tag}/runtime-manifest.json`;
  const lockBytes = json(createFoundryBootstrapLock(trusted, manifestUrl));
  const scripts = await Promise.all(
    (["posix", "powershell"] as const).map(async (kind) => {
      const spec = inputs.cli.bootstrap[kind];
      const bytes = await fetchFoundryNativeBytes(spec.source_url, spec.sha256);
      if (bytes.length !== spec.bytes)
        throw new Error("Final bootstrap script differs from its exact C1 source.");
      return {
        name: kind === "posix" ? "tiangong-runtime-bootstrap.sh" : "tiangong-runtime-bootstrap.ps1",
        bytes,
      };
    }),
  );
  const evidence = json({
    schema: "tiangong-foundry.public-runtime-qualification.v1",
    source: aggregate.source,
    version: context.version,
    ...qualification,
    run: {
      repository: "tiangong-lca/foundry",
      id: process.env.GITHUB_RUN_ID,
      attempt: process.env.GITHUB_RUN_ATTEMPT,
    },
    reports: platforms.map((platform, index) => ({
      platform,
      bytes: reports[index].length,
      sha256: hash(reports[index]),
    })),
  });
  const assets = [
    { name: "runtime-manifest.json", bytes: manifestBytes },
    { name: "bootstrap-lock.json", bytes: lockBytes },
    { name: "public-qualification.json", bytes: evidence },
    ...scripts,
  ];
  const result = await publishFoundryReleaseAssets(
    { version: context.version, kind: "manifest", sourceCommit: context.head, assets },
    createGitHubFoundryAssetStore(token),
  );
  for (const asset of assets) {
    const downloaded = await fetchFoundryNativeBytes(
      `https://github.com/tiangong-lca/foundry/releases/download/${tag}/${asset.name}`,
      hash(asset.bytes),
    );
    if (!downloaded.equals(asset.bytes))
      throw new Error("Final public release bytes differ from qualification.");
  }
  const output = path.join(root, "package-artifacts", "runtime-manifest-publication");
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.mkdirSync(output, { mode: 0o700 });
  const report = {
    schema: "tiangong-foundry.runtime-manifest-publication.v1",
    status: "published",
    source: aggregate.source,
    version: context.version,
    manifest_url: manifestUrl,
    manifest_sha256: trusted.sha256,
    release: result.release,
    platforms,
  };
  writeFoundryComponentFile(output, "manifest-publication.json", json(report));
  if (process.env.GITHUB_OUTPUT)
    fs.appendFileSync(
      process.env.GITHUB_OUTPUT,
      `runtime_published=true\nmanifest_url=${manifestUrl}\nmanifest_sha256=${trusted.sha256}\n`,
    );
  process.stdout.write(json(report));
}
if (import.meta.main)
  main(process.argv.slice(2)).catch((error: unknown) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : "Final runtime manifest publication failed."}\n`,
    );
    process.exitCode = 1;
  });

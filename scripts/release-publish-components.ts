import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { loadFoundryReleaseWorkflowContext } from "./lib/foundry-release-workflow.ts";
import { createGitHubFoundryTagStore } from "./lib/foundry-release-tag.ts";
import {
  createGitHubFoundryAssetStore,
  publishFoundryReleaseAssets,
} from "./lib/foundry-release-assets.ts";
import { verifyPublicNpmRelease } from "./lib/foundry-release-provenance.ts";
import {
  prepareFoundryRuntimeAggregate,
  readPreparedFoundryRuntimeAggregate,
} from "./release-aggregate-runtime.ts";
import {
  foundryComponentJson as json,
  writeFoundryComponentFile,
} from "./lib/foundry-release-component-io.ts";

const root = path.resolve(import.meta.dirname, "..");
async function main(args: readonly string[]): Promise<void> {
  if (args.length)
    throw new Error("Usage: release-publish-components (owning GitHub release workflow only)");
  if (process.env.GITHUB_JOB !== "publish-components")
    throw new Error("Component publication is restricted to the owning publish-components job.");
  const { context, pr } = await loadFoundryReleaseWorkflowContext(root, process.env);
  if (!context.release || !pr)
    throw new Error("Component publication requires an exact merged release-only source.");
  const temporary = process.env.RUNNER_TEMP;
  if (!temporary || !path.isAbsolute(temporary))
    throw new Error("Component publication requires the runner temporary directory.");
  const token = process.env.GITHUB_TOKEN ?? "";
  const tag = await createGitHubFoundryTagStore(token).read(`refs/tags/${context.tag}`);
  if (tag?.head !== context.head)
    throw new Error("Component publication requires its existing exact source tag.");
  const published = await verifyPublicNpmRelease({
    package: "foundry",
    version: context.version,
    gitHead: context.head,
  });
  const aggregate = await prepareFoundryRuntimeAggregate(
    path.join(temporary, "foundry-published-platforms"),
    path.join(temporary, "foundry-published-aggregate"),
    "published-release",
  );
  if (
    aggregate.source.commit !== context.head ||
    aggregate.source.tree !== context.tree ||
    aggregate.version !== context.version ||
    aggregate.package.bytes !== published.tarballBytes.length ||
    aggregate.package.sha256 !==
      createHash("sha256").update(published.tarballBytes).digest("hex") ||
    aggregate.package.sha512 !== createHash("sha512").update(published.tarballBytes).digest("hex")
  )
    throw new Error(
      "Aggregated runtime package differs from its independently verified public npm release.",
    );
  const bytes = readPreparedFoundryRuntimeAggregate(aggregate);
  const result = await publishFoundryReleaseAssets(
    {
      version: context.version,
      kind: "components",
      sourceCommit: context.head,
      assets: [
        ...bytes.archives,
        { name: "runtime-candidate.json", bytes: bytes.manifestBytes },
        { name: "runtime-aggregate.json", bytes: bytes.reportBytes },
      ],
    },
    createGitHubFoundryAssetStore(token),
  );
  readPreparedFoundryRuntimeAggregate(aggregate);
  const output = path.join(root, "package-artifacts", "runtime-publication");
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.mkdirSync(output, { mode: 0o700 });
  const candidateUrl = `https://github.com/tiangong-lca/data-foundry/releases/download/${context.tag}/runtime-candidate.json`;
  const report = {
    schema: "tiangong-foundry.runtime-component-publication.v1",
    status: "published",
    source: aggregate.source,
    version: context.version,
    release: result.release,
    manifest_sha256: aggregate.manifest_sha256,
    candidate_url: candidateUrl,
    public_download_qualification: "required",
  };
  writeFoundryComponentFile(output, "component-publication.json", json(report));
  if (process.env.GITHUB_OUTPUT)
    fs.appendFileSync(
      process.env.GITHUB_OUTPUT,
      `components_published=true\nmanifest_sha256=${aggregate.manifest_sha256}\ncandidate_url=${candidateUrl}\n`,
    );
  process.stdout.write(json(report));
}
if (import.meta.main)
  main(process.argv.slice(2)).catch((error: unknown) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : "Component publication failed."}\n`,
    );
    process.exitCode = 1;
  });

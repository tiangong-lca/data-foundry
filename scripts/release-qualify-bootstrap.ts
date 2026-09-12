import fs from "node:fs";
import path from "node:path";
import { trustRuntimeManifest } from "@tiangong-lca/cli/runtime";
import { readFoundryReleaseArtifact } from "./lib/foundry-release-prepared.ts";
import { readFoundryReleaseGit as git } from "./lib/foundry-release-contract.ts";
import { sameFoundryReleaseDirectory } from "./lib/foundry-release-root.ts";
import { qualifyFoundryBootstrap } from "./lib/foundry-release-bootstrap-qualification.ts";
import { loadFoundryReleaseWorkflowContext } from "./lib/foundry-release-workflow.ts";

const usage =
  "Usage: release-qualify-bootstrap --input <absolute-aggregate> --manifest-sha256 <independent-sha256> --output <new-absolute-directory> <--archives absolute-directory|--public>";
async function main(args: readonly string[]) {
  if (args.length === 1 && args[0] === "--help") {
    process.stdout.write(`${usage}\n`);
    return;
  }
  if (
    (args.length !== 7 && args.length !== 8) ||
    args[0] !== "--input" ||
    !args[1] ||
    args[2] !== "--manifest-sha256" ||
    !/^[0-9a-f]{64}$/u.test(args[3] ?? "") ||
    args[4] !== "--output" ||
    !args[5] ||
    !(
      (args.length === 7 && args[6] === "--public") ||
      (args.length === 8 && args[6] === "--archives" && args[7])
    )
  )
    throw new Error(usage);
  const root = path.resolve(import.meta.dirname, "..");
  if (![args[1], args[5], ...(args[7] ? [args[7]] : [])].every((value) => path.isAbsolute(value)))
    throw new Error("Bootstrap qualification paths must be absolute.");
  if (
    !sameFoundryReleaseDirectory(root, git(root, ["rev-parse", "--show-toplevel"]).trim()) ||
    git(root, ["status", "--porcelain", "--untracked-files=all"]).trim()
  )
    throw new Error("Bootstrap qualification requires its own clean source checkout.");
  const source = {
    repository: "https://github.com/tiangong-lca/foundry",
    commit: git(root, ["rev-parse", "HEAD"]).trim(),
    tree: git(root, ["rev-parse", "HEAD^{tree}"]).trim(),
    date: new Date(git(root, ["show", "-s", "--format=%cI", "HEAD"]).trim()).toISOString(),
  };
  const input = fs.realpathSync(args[1]);
  const output = path.join(fs.realpathSync(path.dirname(args[5])), path.basename(args[5]));
  const relative = path.relative(root, output);
  if (
    !path.isAbsolute(relative) &&
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !relative.startsWith(`package-artifacts${path.sep}`)
  )
    throw new Error(
      "Bootstrap qualification output must be outside source or under package-artifacts/.",
    );
  const trusted = trustRuntimeManifest(
    readFoundryReleaseArtifact(path.join(input, "runtime-manifest.json"), 32 * 1024 * 1024),
    args[3],
  );
  const aggregate = JSON.parse(
    readFoundryReleaseArtifact(
      path.join(input, "runtime-aggregate.json"),
      32 * 1024 * 1024,
    ).toString("utf8"),
  ) as {
    schema: string;
    status: string;
    scope: string;
    source: typeof source;
    manifest_sha256: string;
  };
  const version = (
    JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")) as { version: string }
  ).version;
  if (
    aggregate.schema !== "tiangong-foundry.runtime-aggregate.v1" ||
    aggregate.status !== "verified" ||
    JSON.stringify(aggregate.source) !== JSON.stringify(source) ||
    aggregate.manifest_sha256 !== trusted.sha256 ||
    trusted.manifest.product.version !== version
  )
    throw new Error("Bootstrap inputs differ from the independently selected source/manifest.");
  const mode = args[6] === "--public" ? "public" : "cached";
  if (mode === "public") {
    if (
      process.env.GITHUB_JOB !== "qualify-bootstrap-public" ||
      aggregate.scope !== "published-release"
    )
      throw new Error("Public bootstrap qualification requires its owning published-release job.");
    const { context, pr } = await loadFoundryReleaseWorkflowContext(root, process.env);
    if (!context.release || !pr || context.head !== source.commit)
      throw new Error("Public bootstrap requires the exact merged release source.");
  } else if (aggregate.scope !== "source-candidate")
    throw new Error("Cached source qualification requires candidate artifacts.");
  const result = await qualifyFoundryBootstrap({
    trusted,
    source,
    mode,
    output,
    ...(mode === "cached" ? { archiveDirectory: args[7] } : {}),
  });
  process.stdout.write(
    `${JSON.stringify({ status: result.status, source: source.commit, platform: result.platform, mode, manifest_sha256: trusted.sha256, checks: result.checks.length })}\n`,
  );
}
if (import.meta.main)
  main(process.argv.slice(2)).catch((error: unknown) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : "Bootstrap qualification failed."}\n`,
    );
    process.exitCode = 1;
  });

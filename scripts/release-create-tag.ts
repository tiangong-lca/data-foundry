import path from "node:path";
import { loadFoundryReleaseWorkflowContext } from "./lib/foundry-release-workflow.ts";
import { createGitHubFoundryTagStore, ensureFoundryReleaseTag } from "./lib/foundry-release-tag.ts";

async function main(args: readonly string[]): Promise<void> {
  if (args.length)
    throw new Error("Usage: release-create-tag (owning GitHub release workflow only)");
  if (process.env.GITHUB_JOB !== "release-tag")
    throw new Error("Foundry tag creation is restricted to the owning release-tag job.");
  const { context, pr } = await loadFoundryReleaseWorkflowContext(
    path.resolve(import.meta.dirname, ".."),
    process.env,
  );
  if (!context.release || !pr)
    throw new Error("Foundry tag creation requires a qualified release-only main PR.");
  const result = await ensureFoundryReleaseTag(
    { version: context.version, head: context.head },
    createGitHubFoundryTagStore(process.env.GITHUB_TOKEN ?? ""),
  );
  process.stdout.write(`${JSON.stringify({ ...result, pr }, null, 2)}\n`);
}

if (import.meta.main)
  main(process.argv.slice(2)).catch((error: unknown) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : "Foundry tag creation failed."}\n`,
    );
    process.exitCode = 1;
  });

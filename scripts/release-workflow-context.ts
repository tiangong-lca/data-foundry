import fs from "node:fs";
import path from "node:path";
import { loadFoundryReleaseWorkflowContext } from "./lib/foundry-release-workflow.ts";

async function main(args: readonly string[]): Promise<void> {
  if (args.length > 1 || (args.length === 1 && args[0] !== "--github-output"))
    throw new Error("Usage: release-workflow-context [--github-output]");
  const { context, pr } = await loadFoundryReleaseWorkflowContext(
    path.resolve(import.meta.dirname, ".."),
    process.env,
  );
  if (args.length) {
    const output = process.env.GITHUB_OUTPUT;
    if (!output) throw new Error("Foundry release workflow output path is missing.");
    fs.appendFileSync(
      output,
      [
        `should_release=${context.release}`,
        `release_head=${context.head}`,
        `release_base=${context.base}`,
        `version=${context.release ? context.version : ""}`,
        `tag=${context.release ? context.tag : ""}`,
        `release_pr=${pr?.number ?? ""}`,
        "",
      ].join("\n"),
    );
  }
  process.stdout.write(`${JSON.stringify({ ...context, pr }, null, 2)}\n`);
}

if (import.meta.main)
  main(process.argv.slice(2)).catch((error: unknown) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : "Foundry release workflow inspection failed."}\n`,
    );
    process.exitCode = 1;
  });

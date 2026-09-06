import fs from "node:fs";
import path from "node:path";
import {
  parseFoundryReleaseWorkflowEvent,
  inspectFoundryReleaseWorkflow,
  fetchMergedFoundryReleasePr,
} from "./lib/foundry-release-workflow.ts";

async function main(args: readonly string[]): Promise<void> {
  if (args.length > 1 || (args.length === 1 && args[0] !== "--github-output"))
    throw new Error("Usage: release-workflow-context [--github-output]");
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath || !path.isAbsolute(eventPath))
    throw new Error("Foundry release requires the workflow event file.");
  const stat = fs.lstatSync(eventPath);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 1 || stat.size > 5 * 1024 * 1024)
    throw new Error("Foundry release event file must be a bounded regular file.");
  const event: unknown = JSON.parse(fs.readFileSync(eventPath, "utf8"));
  const parsed = parseFoundryReleaseWorkflowEvent(process.env, event);
  const context = inspectFoundryReleaseWorkflow(path.resolve(import.meta.dirname, ".."), parsed);
  const pr = context.release
    ? await fetchMergedFoundryReleasePr(context.head, process.env.GITHUB_TOKEN ?? "")
    : null;
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

import fs from "node:fs";
import path from "node:path";
import { loadFoundryTestPlan, selectFoundryCiMode } from "./lib/foundry-ci-plan.ts";
import {
  inspectFoundryRelease,
  readFoundryReleaseGit,
  type FoundryReleaseChange,
} from "./lib/foundry-release-contract.ts";

const root = path.resolve(import.meta.dirname, "..");
function main(args: readonly string[]): void {
  if (args.length > 1 || (args.length === 1 && args[0] !== "--github-output"))
    throw new Error("Usage: ci-plan [--github-output]");
  const source = readFoundryReleaseGit(root, ["rev-parse", "HEAD"]).trim();
  const reusable = process.env.FOUNDRY_CI_SOURCE_SHA || undefined;
  const expected = reusable ?? process.env.GITHUB_SHA;
  if (expected !== undefined && (!/^[0-9a-f]{40}$/u.test(expected) || expected !== source))
    throw new Error("CI checkout does not match its exact source.");
  if (process.env.GITHUB_ACTIONS === "true" && !expected)
    throw new Error("CI source binding is missing.");
  const event = process.env.GITHUB_EVENT_NAME ?? "local";
  const inspection: FoundryReleaseChange =
    event === "pull_request" && reusable === undefined
      ? inspectFoundryRelease(root, process.env.FOUNDRY_CI_BASE_SHA ?? "", source)
      : { release: false, changedPaths: [] };
  const mode = selectFoundryCiMode(event, reusable, inspection);
  const tests = loadFoundryTestPlan(root);
  const result = { schema: "tiangong-foundry.ci-plan.v1", mode, source, inspection, tests };
  if (args.length) {
    const output = process.env.GITHUB_OUTPUT;
    if (process.env.GITHUB_ACTIONS !== "true" || !output || !path.isAbsolute(output))
      throw new Error("CI outputs require the owning GitHub job.");
    fs.appendFileSync(
      output,
      `mode=${mode}\nsource_sha=${source}\ntest_plan_sha256=${tests.planSha256}\nshards=${JSON.stringify(tests.shards.map((shard) => shard.index))}\n`,
      "utf8",
    );
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
if (import.meta.main) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : "CI planning failed."}\n`);
    process.exitCode = 1;
  }
}

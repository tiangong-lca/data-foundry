import fs from "node:fs";
import path from "node:path";
import { inspectFoundryRelease } from "./lib/foundry-release-contract.ts";

function main(args: readonly string[]): void {
  const values = new Map<string, string>();
  let githubOutput = false;
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if (flag === "--github-output" && !githubOutput) {
      githubOutput = true;
      continue;
    }
    if (!["--base", "--head"].includes(flag) || values.has(flag) || !args[index + 1])
      throw new Error("Usage: release-inspect --base <sha> --head <sha> [--github-output]");
    values.set(flag, args[++index]);
  }
  const result = inspectFoundryRelease(
    path.resolve(import.meta.dirname, ".."),
    values.get("--base") ?? "",
    values.get("--head") ?? "",
  );
  if (githubOutput) {
    if (process.env.GITHUB_ACTIONS !== "true" || !process.env.GITHUB_OUTPUT)
      throw new Error("GitHub output is available only inside the owning workflow.");
    fs.appendFileSync(
      process.env.GITHUB_OUTPUT,
      `should_release=${result.release}\nrelease_head=${result.head}\nrelease_base=${result.base}\nversion=${result.release ? result.version : ""}\ntag=${result.release ? result.tag : ""}\n`,
    );
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
if (import.meta.main)
  try {
    main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : "Release inspection failed."}\n`,
    );
    process.exitCode = 1;
  }

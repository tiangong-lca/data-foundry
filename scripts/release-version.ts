import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  applyFoundryReleaseVersion,
  planFoundryReleaseVersion,
} from "./lib/foundry-release-version.ts";

const repoRoot = path.resolve(import.meta.dirname, "..");

function main(argv: readonly string[]): void {
  if (argv.length === 1 && argv[0] === "--help") {
    process.stdout.write("Usage: pnpm release:version --version <major.minor.patch> [--apply]\n");
    return;
  }
  let version: string | undefined;
  let apply = false;
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--version" && version === undefined) version = argv[++index];
    else if (argv[index] === "--apply" && !apply) apply = true;
    else throw new Error("Unsupported release version argument; use --help.");
  }
  if (!version) throw new Error("Release version requires --version <major.minor.patch>.");
  if (apply) {
    const environment = { ...process.env };
    for (const key of Object.keys(environment)) {
      if (key.startsWith("GIT_")) delete environment[key];
    }
    const top = spawnSync("git", ["rev-parse", "--show-toplevel"], {
      cwd: repoRoot,
      encoding: "utf8",
      shell: false,
      env: environment,
    });
    const status = spawnSync("git", ["status", "--porcelain=v1", "--untracked-files=normal"], {
      cwd: repoRoot,
      encoding: "utf8",
      shell: false,
      env: environment,
    });
    if (
      top.status !== 0 ||
      fs.realpathSync(top.stdout.trim()) !== fs.realpathSync(repoRoot) ||
      status.status !== 0 ||
      status.stdout.trim()
    )
      throw new Error("Release version apply requires a clean repository working tree.");
  }
  const plan = planFoundryReleaseVersion(repoRoot, version);
  process.stdout.write(
    `${JSON.stringify(apply ? applyFoundryReleaseVersion(plan) : plan, null, 2)}\n`,
  );
}

if (import.meta.main) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : "Release version failed."}\n`);
    process.exitCode = 1;
  }
}

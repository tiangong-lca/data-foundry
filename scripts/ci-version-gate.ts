import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  inspectFoundryRelease,
  readFoundryReleaseGit as git,
} from "./lib/foundry-release-contract.ts";
import { loadFoundryTestPlan } from "./lib/foundry-ci-plan.ts";
import { resolvePackageManagerCommand } from "./lib/package-manager-command.ts";

const root = path.resolve(import.meta.dirname, "..");
function run(executable: string, argv: readonly string[]): void {
  const result = spawnSync(executable, argv, { cwd: root, shell: false, stdio: "inherit" });
  if (result.status !== 0 || result.error) throw new Error("Version-only CI check failed.");
}
function main(): void {
  if (
    process.argv.length !== 2 ||
    process.env.GITHUB_ACTIONS !== "true" ||
    process.env.GITHUB_EVENT_NAME !== "pull_request" ||
    process.env.FOUNDRY_CI_SOURCE_SHA
  )
    throw new Error("The bounded version gate is only available to an inspected pull request.");
  if (git(root, ["status", "--porcelain", "--untracked-files=all"]).trim())
    throw new Error("Version-only CI requires a clean checkout.");
  const head = git(root, ["rev-parse", "HEAD"]).trim();
  if (head !== process.env.GITHUB_SHA)
    throw new Error("Version-only CI source differs from the pull request checkout.");
  const inspection = inspectFoundryRelease(root, process.env.FOUNDRY_CI_BASE_SHA ?? "", head);
  if (!inspection.release) throw new Error("This is not the exact version-only projection.");
  for (const command of ["lint", "test:toolchain", "surface:audit", "build", "audit:high"]) {
    const invocation = resolvePackageManagerCommand("pnpm", [command]);
    run(invocation.executable, invocation.argv);
  }
  const files = loadFoundryTestPlan(root)
    .shards.flatMap((shard) => shard.files)
    .filter(
      (file) =>
        /^test\/unit\/foundry-(?:release-|ci-)/u.test(file) ||
        file === "test/unit/foundry-package-contract.test.mts" ||
        file === "test/scenarios/foundry-package-consumer.test.mts",
    );
  if (
    !files.includes("test/scenarios/foundry-package-consumer.test.mts") ||
    !files.includes("test/unit/foundry-release-version.test.mts")
  )
    throw new Error("Version-only CI test selection is incomplete.");
  run(process.execPath, ["--test", "--test-concurrency=2", ...files]);
  const after = inspectFoundryRelease(root, process.env.FOUNDRY_CI_BASE_SHA ?? "", head);
  if (
    !after.release ||
    after.tree !== inspection.tree ||
    git(root, ["status", "--porcelain", "--untracked-files=all"]).trim()
  )
    throw new Error("Version-only source changed during qualification.");
  process.stdout.write(
    `${JSON.stringify({ schema: "tiangong-foundry.ci-version-qualification.v1", status: "passed", source: head, tree: inspection.tree, version: inspection.version, tests: files })}\n`,
  );
}
if (import.meta.main) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : "Version-only CI failed."}\n`);
    process.exitCode = 1;
  }
}

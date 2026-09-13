import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { readFoundryReleaseGit as git } from "./lib/foundry-release-contract.ts";
import { readFoundryReleaseArtifact } from "./lib/foundry-release-prepared.ts";
import {
  inspectFoundryReleaseWorkflow,
  fetchMergedFoundryReleasePr,
} from "./lib/foundry-release-workflow.ts";
import { resolvePackageManagerCommand } from "./lib/package-manager-command.ts";
import { foundryCiPlatforms } from "./lib/foundry-ci-results.ts";

export function parsePlatformDiagnostic(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Missing diagnostic inputs.");
  const inputs = value as Record<string, unknown>;
  if (
    !foundryCiPlatforms.includes(inputs.diagnose_platform as (typeof foundryCiPlatforms)[number]) ||
    typeof inputs.diagnose_tag !== "string" ||
    !/^foundry-v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u.test(inputs.diagnose_tag) ||
    inputs.diagnose_tag.length > 80 ||
    ![false, "false"].includes(inputs.diagnose_npm_oidc as boolean | string) ||
    inputs.resume_run_id
  )
    throw new Error(
      "Platform diagnostics require one stable tag and platform, with other modes disabled.",
    );
  return { platform: String(inputs.diagnose_platform), tag: inputs.diagnose_tag };
}
async function main() {
  const env = process.env,
    root = path.resolve(import.meta.dirname, "..");
  if (
    process.argv.length !== 2 ||
    env.GITHUB_ACTIONS !== "true" ||
    env.GITHUB_JOB !== "diagnose-platform" ||
    env.RUNNER_ENVIRONMENT !== "github-hosted" ||
    env.GITHUB_EVENT_NAME !== "workflow_dispatch" ||
    env.GITHUB_REPOSITORY !== "tiangong-lca/foundry" ||
    !/^refs\/heads\/[A-Za-z0-9./_-]{1,200}$/u.test(env.GITHUB_REF ?? "") ||
    env.GITHUB_WORKFLOW_SHA !== env.GITHUB_SHA ||
    env.GITHUB_WORKFLOW_REF !==
      `tiangong-lca/foundry/.github/workflows/publish.yml@${env.GITHUB_REF}` ||
    git(root, ["rev-parse", "HEAD"]).trim() !== env.GITHUB_SHA ||
    git(root, ["status", "--porcelain", "--untracked-files=all"]).trim()
  )
    throw new Error("Platform diagnostic requires its exact clean hosted controller source.");
  const payload = JSON.parse(
    readFoundryReleaseArtifact(env.GITHUB_EVENT_PATH ?? "", 1024 * 1024).toString("utf8"),
  ) as { inputs?: unknown };
  const { platform, tag } = parsePlatformDiagnostic(payload.inputs);
  if (
    platform !== `${process.platform}-${process.arch}` ||
    !env.RUNNER_TEMP ||
    !path.isAbsolute(env.RUNNER_TEMP)
  )
    throw new Error("Diagnostic host or temporary directory differs.");
  const source = path.join(env.RUNNER_TEMP, "foundry-diagnostic-source"),
    output = path.join(env.RUNNER_TEMP, "foundry-platform-diagnostic");
  fs.mkdirSync(output, { mode: 0o700 });
  const head = git(root, ["rev-parse", `refs/tags/${tag}^{commit}`]).trim();
  git(root, ["worktree", "add", "--detach", source, head]);
  try {
    inspectFoundryReleaseWorkflow(source, {
      mode: "tag-recovery",
      ref: `refs/tags/${tag}`,
      base: null,
      head,
    });
    await fetchMergedFoundryReleasePr(head, env.GITHUB_TOKEN ?? "");
    const childEnv = { ...env };
    for (const key of Object.keys(childEnv))
      if (
        /^(?:FOUNDRY_CI_|FOUNDRY_QUALIFICATION_|ACTIONS_ID_TOKEN_|NODE_AUTH_TOKEN$|NPM_TOKEN$|SIGSTORE_ID_TOKEN$)/u.test(
          key,
        )
      )
        delete childEnv[key];
    for (const phase of ["frozen-dependencies", "published-native"] as const) {
      const command =
        phase === "frozen-dependencies"
          ? resolvePackageManagerCommand(
              "pnpm",
              ["install", "--frozen-lockfile", "--ignore-scripts"],
              { environment: childEnv },
            )
          : {
              executable: process.execPath,
              argv: [
                "scripts/release-prepare-runtime.ts",
                "--output",
                path.join(output, "runtime"),
                "--published",
              ],
            };
      const start = Date.now();
      const result = spawnSync(command.executable, command.argv, {
        cwd: source,
        env: childEnv,
        shell: false,
        encoding: "utf8",
        timeout: 15 * 60000,
        maxBuffer: 4 * 1024 * 1024,
      });
      const fixedReason = result.stderr?.match(
        /Assembled runtime launch failed its public result contract \(foundry(?:-read)?, expected exit \d+, observed (?:\d+|null)\)\./u,
      )?.[0];
      const report = {
        schema: "tiangong-foundry.platform-diagnostic.v1",
        controller: env.GITHUB_SHA,
        source: head,
        tag,
        platform,
        phase,
        milliseconds: Date.now() - start,
        exit: result.status,
        signalled: Boolean(result.signal),
        execution_error: Boolean(result.error),
        stderr_present: Boolean(result.stderr),
        reason: fixedReason ?? null,
        publication_attempted: false,
      };
      const text = JSON.stringify(report, null, 2);
      fs.writeFileSync(path.join(output, `${phase}.json`), text + "\n", { flag: "wx" });
      process.stdout.write(text + "\n");
      if (result.status !== 0 || result.error || result.signal)
        throw new Error(`Read-only platform diagnostic failed in ${phase}.`);
    }
  } finally {
    git(root, ["worktree", "remove", "--force", source]);
  }
}
if (import.meta.main)
  main().catch((error: unknown) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : "Platform diagnostic failed."}\n`,
    );
    process.exitCode = 1;
  });

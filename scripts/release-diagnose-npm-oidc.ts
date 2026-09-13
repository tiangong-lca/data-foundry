import path from "node:path";
import { readFoundryReleaseGit as git } from "./lib/foundry-release-contract.ts";
import { readFoundryReleaseArtifact } from "./lib/foundry-release-prepared.ts";
import { sameFoundryReleaseDirectory } from "./lib/foundry-release-root.ts";
import {
  assertFoundryNpmOidcDiagnosticEnvironment,
  diagnoseFoundryNpmOidcExchange,
} from "./lib/foundry-release-publish.ts";

let failureStage: "admission" | "source" | "input" | "exchange" = "admission";

async function main() {
  if (process.argv.length !== 2) throw new Error("OIDC diagnostic accepts no arguments.");
  assertFoundryNpmOidcDiagnosticEnvironment(process.env);
  failureStage = "source";
  const root = path.resolve(import.meta.dirname, "..");
  const head = git(root, ["rev-parse", "HEAD"]).trim();
  if (
    !sameFoundryReleaseDirectory(root, git(root, ["rev-parse", "--show-toplevel"]).trim()) ||
    head !== process.env.GITHUB_SHA ||
    git(root, ["status", "--porcelain", "--untracked-files=all"]).trim()
  )
    throw new Error("OIDC diagnostic requires its exact clean workflow source.");
  failureStage = "input";
  const event = JSON.parse(
    readFoundryReleaseArtifact(process.env.GITHUB_EVENT_PATH ?? "", 1024 * 1024).toString("utf8"),
  ) as {
    inputs?: { diagnose_npm_oidc?: unknown };
  };
  if (![true, "true"].includes(event.inputs?.diagnose_npm_oidc as boolean | string))
    throw new Error("OIDC diagnostic requires the explicit diagnostic input.");
  failureStage = "exchange";
  const result = await diagnoseFoundryNpmOidcExchange(process.env);
  process.stdout.write(
    `${JSON.stringify({
      schema: "tiangong-foundry.npm-oidc-diagnostic.v1",
      source: head,
      run: process.env.GITHUB_RUN_ID,
      attempt: process.env.GITHUB_RUN_ATTEMPT,
      diagnostic_only: true,
      publication_attempted: false,
      ...result,
    })}\n`,
  );
  if (!result.accepted) process.exitCode = 1;
}

if (import.meta.main)
  main().catch(() => {
    // An unexpected dependency/network error must not expose response or credential values.
    process.stderr.write("npm OIDC diagnostic could not complete; no publication attempted.\n");
    process.stderr.write(
      `${JSON.stringify({
        schema: "tiangong-foundry.npm-oidc-diagnostic.v1",
        diagnostic_only: true,
        publication_attempted: false,
        accepted: false,
        failure_stage: failureStage,
      })}\n`,
    );
    process.exitCode = 1;
  });

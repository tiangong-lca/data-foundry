import path from "node:path";
import { readFoundryReleaseGit as git } from "./lib/foundry-release-contract.ts";
import { readFoundryReleaseArtifact } from "./lib/foundry-release-prepared.ts";
import { sameFoundryReleaseDirectory } from "./lib/foundry-release-root.ts";
import {
  assertFoundryNpmOidcDiagnosticEnvironment,
  diagnoseFoundryNpmOidcExchange,
} from "./lib/foundry-release-publish.ts";

async function main() {
  if (process.argv.length !== 2) throw new Error("OIDC diagnostic accepts no arguments.");
  assertFoundryNpmOidcDiagnosticEnvironment(process.env);
  const root = path.resolve(import.meta.dirname, "..");
  const head = git(root, ["rev-parse", "HEAD"]).trim();
  if (
    !sameFoundryReleaseDirectory(root, git(root, ["rev-parse", "--show-toplevel"]).trim()) ||
    head !== process.env.GITHUB_SHA ||
    git(root, ["status", "--porcelain", "--untracked-files=all"]).trim()
  )
    throw new Error("OIDC diagnostic requires its exact clean workflow source.");
  const event = JSON.parse(
    readFoundryReleaseArtifact(process.env.GITHUB_EVENT_PATH ?? "", 1024 * 1024).toString("utf8"),
  ) as {
    inputs?: { diagnose_npm_oidc?: unknown };
  };
  if (![true, "true"].includes(event.inputs?.diagnose_npm_oidc as boolean | string))
    throw new Error("OIDC diagnostic requires the explicit diagnostic input.");
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
}

if (import.meta.main)
  main().catch(() => {
    // An unexpected dependency/network error must not expose response or credential values.
    process.stderr.write("npm OIDC diagnostic could not complete; no publication attempted.\n");
    process.exitCode = 1;
  });

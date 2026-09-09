import fs from "node:fs";
import path from "node:path";
import { loadFoundryReleaseWorkflowContext } from "./lib/foundry-release-workflow.ts";
import {
  inspectFoundryNpmAvailability,
  preflightFoundryNpmOidcExchange,
} from "./lib/foundry-release-publish.ts";
import { verifyPublicNpmRelease } from "./lib/foundry-release-provenance.ts";

async function main() {
  if (process.argv.length !== 2 || process.env.GITHUB_JOB !== "release-preflight")
    throw new Error("Release preflight requires its owning job and no arguments.");
  const { context, pr } = await loadFoundryReleaseWorkflowContext(
    path.resolve(import.meta.dirname, ".."),
    process.env,
  );
  if (!context.release || !pr)
    throw new Error("Release preflight requires the exact merged release source.");
  const availability = await inspectFoundryNpmAvailability(context.version);
  let oidc;
  if (availability === "version-exists")
    await verifyPublicNpmRelease({
      package: "foundry",
      version: context.version,
      gitHead: context.head,
    });
  else if (availability === "version-available")
    oidc = await preflightFoundryNpmOidcExchange(context, process.env);
  // The first identity still reaches the existing prepared-artifact maintainer handoff.
  const result = {
    schema: "tiangong-foundry.release-preflight.v1",
    source: context.head,
    availability,
    oidc,
    publication_attempted: false,
  };
  const text = JSON.stringify(result);
  process.stdout.write(`${text}\n`);
  if (process.env.GITHUB_STEP_SUMMARY)
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `Release preflight: \`${text}\`\n`);
  if (oidc && !oidc.accepted)
    throw new Error("Preflight rejected the redacted OIDC validation facts above.");
}
if (import.meta.main)
  main().catch((error: unknown) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : "Release preflight failed."} No publication attempted.\n`,
    );
    process.exitCode = 1;
  });

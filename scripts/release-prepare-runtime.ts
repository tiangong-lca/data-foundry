import { prepareFoundryRuntimeComponents } from "./lib/foundry-release-components.ts";
import { qualifyFoundryRuntimeComponents } from "./lib/foundry-release-runtime-qualification.ts";
import {
  foundryComponentJson,
  writeFoundryComponentFile,
} from "./lib/foundry-release-component-io.ts";

const usage = "Usage: release-prepare-runtime --output <new-absolute-directory> [--published]";
async function main(args: readonly string[]) {
  if (args.length === 1 && args[0] === "--help") {
    process.stdout.write(`${usage}\n`);
    return;
  }
  if (
    (args.length !== 2 && args.length !== 3) ||
    args[0] !== "--output" ||
    !args[1] ||
    (args.length === 3 && args[2] !== "--published")
  )
    throw new Error(usage);
  const prepared = await prepareFoundryRuntimeComponents(
    args[1],
    args.length === 3 ? "published-release" : "source-candidate",
  );
  const qualification = await qualifyFoundryRuntimeComponents(prepared);
  writeFoundryComponentFile(
    prepared.output,
    "README.md",
    Buffer.from(
      `# Prepared Foundry runtime components\n\nSource: ${prepared.source.commit}\nPlatform: ${prepared.platform}\nPackage source: ${prepared.scope}\n\nThree complete file inventories and tar-gzip-ustar archives were assembled from the exact Foundry package, frozen public CLI dependency graph and verified official native inputs. Native public operations ran with an empty tool PATH, local archive seeds and then a warm cache. This is not proof of published download URLs or a final four-platform product release.\n\nRelease blockers: ${prepared.release_blockers.length ? prepared.release_blockers.join(", ") : "none observed for this platform input"}.\n`,
    ),
  );
  process.stdout.write(
    foundryComponentJson({
      status: "prepared",
      scope: prepared.scope,
      output: prepared.output,
      source: prepared.source.commit,
      platform: prepared.platform,
      manifest_sha256: prepared.manifest.sha256,
      components: prepared.components.map((component) => ({
        id: component.id,
        version: component.version,
        files: component.files.length,
        archive: component.archive,
      })),
      qualification: qualification.status,
      release_blockers: prepared.release_blockers,
    }),
  );
}
if (import.meta.main)
  main(process.argv.slice(2)).catch((error: unknown) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : "Runtime component preparation failed."}\n`,
    );
    process.exitCode = 1;
  });

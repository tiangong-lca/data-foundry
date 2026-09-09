import fs from "node:fs";
import path from "node:path";
import { readFoundryReleaseArtifact } from "./lib/foundry-release-prepared.ts";
import { foundryCiPlatforms } from "./lib/foundry-ci-results.ts";
import { currentCapsuleIdentity } from "./lib/foundry-ci-capsule.ts";

// Layout is fixed by the owning workflow. No caller-selected file list or source.
function main() {
  if (
    process.argv.length !== 2 ||
    process.env.GITHUB_JOB !== "seal-qualification" ||
    process.env.FOUNDRY_STAGE_PASSED !== "true"
  )
    throw new Error("Qualification collection requires its completed owning gate.");
  const temporary = process.env.RUNNER_TEMP;
  if (!temporary || !path.isAbsolute(temporary))
    throw new Error("Missing runner temporary directory.");
  const output = path.join(temporary, "qualified-source");
  if (fs.existsSync(output)) throw new Error("Qualification output already exists.");
  const identity = currentCapsuleIdentity();
  const files = [
    ["source-package/build-manifest.json", "package/build-manifest.json"],
    [
      `source-package/tiangong-lca-foundry-${identity.package.version}.tgz`,
      `package/tiangong-lca-foundry-${identity.package.version}.tgz`,
    ],
    ["source-tests/foundry-tests.json", "test-summary.json"],
    ["source-aggregate/runtime-aggregate.json", "runtime-aggregate.json"],
    ...foundryCiPlatforms.map((platform) => [
      `source-bootstrap/${platform}/bootstrap-qualification.json`,
      `bootstrap/${platform}.json`,
    ]),
  ];
  fs.mkdirSync(output, { mode: 0o700 });
  for (const [from, to] of files) {
    const bytes = readFoundryReleaseArtifact(path.join(temporary, from), 64 * 1024 * 1024);
    const destination = path.join(output, to);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, bytes, { flag: "wx", mode: 0o644 });
  }
}
if (import.meta.main) {
  try {
    main();
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : "Qualification collection failed."}\n`,
    );
    process.exitCode = 1;
  }
}

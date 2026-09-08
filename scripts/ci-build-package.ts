import fs from "node:fs";
import path from "node:path";
import { buildFoundryCiPackage } from "./lib/foundry-ci-package.ts";

function main(args: readonly string[]): void {
  if (
    (args.length !== 2 && args.length !== 3) ||
    args[0] !== "--output" ||
    (args.length === 3 && args[2] !== "--github-output")
  )
    throw new Error("Usage: ci-build-package --output <new-absolute-directory> [--github-output]");
  const result = buildFoundryCiPackage(args[1]);
  if (args.length === 3) {
    const output = process.env.GITHUB_OUTPUT;
    if (process.env.GITHUB_ACTIONS !== "true" || !output || !path.isAbsolute(output))
      throw new Error("CI package outputs require the owning GitHub job.");
    fs.appendFileSync(
      output,
      `package_sha256=${result.archiveSha256}\npackage_manifest_sha256=${result.manifestSha256}\n`,
      "utf8",
    );
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
if (import.meta.main) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : "CI package build failed."}\n`,
    );
    process.exitCode = 1;
  }
}

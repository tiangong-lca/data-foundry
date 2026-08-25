import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const buildOutputName = "dist";

export function cleanBuildOutput(projectRoot = repoRoot): void {
  const resolvedRoot = path.resolve(projectRoot);
  const buildOutput = path.resolve(resolvedRoot, buildOutputName);
  const filesystemRoot = path.parse(resolvedRoot).root;

  if (
    resolvedRoot === filesystemRoot ||
    buildOutput === resolvedRoot ||
    path.dirname(buildOutput) !== resolvedRoot ||
    path.basename(buildOutput) !== buildOutputName
  ) {
    throw new Error(`Refusing to clean unsafe build output path: ${buildOutput}`);
  }

  fs.rmSync(buildOutput, {
    recursive: true,
    force: true,
    maxRetries: 3,
    retryDelay: 100,
  });
}

if (import.meta.main) {
  cleanBuildOutput();
}

import fs from "node:fs";
import path from "node:path";
import {
  npmReleasePolicy,
  verifyPublicNpmRelease,
  type NpmReleaseExpectation,
} from "./lib/foundry-release-provenance.ts";

const usage =
  "Usage: release-verify-npm --package <cli|foundry> --version <x.y.z> --expected-git-head <40-hex-sha> [--output <new-absolute-directory>]";

async function main(args: readonly string[]): Promise<void> {
  if (args.length === 1 && args[0] === "--help") {
    process.stdout.write(`${usage}\n`);
    return;
  }
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index],
      value = args[index + 1];
    if (
      !["--package", "--version", "--expected-git-head", "--output"].includes(flag) ||
      values.has(flag) ||
      !value ||
      value.startsWith("--")
    )
      throw new Error(usage);
    values.set(flag, value);
  }
  const target = values.get("--package");
  if (target !== "cli" && target !== "foundry") throw new Error(usage);
  const expected: NpmReleaseExpectation = {
    package: target,
    version: values.get("--version") ?? "",
    gitHead: values.get("--expected-git-head") ?? "",
  };
  npmReleasePolicy(expected);
  const requestedOutput = values.get("--output");
  let output: string | undefined;
  if (requestedOutput !== undefined) {
    if (!path.isAbsolute(requestedOutput))
      throw new Error("Release evidence output must be a new absolute directory.");
    output = path.join(
      fs.realpathSync(path.dirname(requestedOutput)),
      path.basename(requestedOutput),
    );
    if (fs.existsSync(output))
      throw new Error("Release evidence output already exists; it will not be overwritten.");
  }
  const result = await verifyPublicNpmRelease(expected);
  if (output !== undefined) {
    fs.mkdirSync(output, { mode: 0o700 });
    const files = {
      "registry-metadata.json": result.metadataBytes,
      "registry-attestations.json": result.attestationBytes,
      [`${target}-${expected.version}.tgz`]: result.tarballBytes,
      "verification.json": Buffer.from(`${JSON.stringify(result.evidence, null, 2)}\n`),
    };
    for (const [name, bytes] of Object.entries(files))
      fs.writeFileSync(path.join(output, name), bytes, { flag: "wx", mode: 0o600 });
  }
  process.stdout.write(`${JSON.stringify(result.evidence, null, 2)}\n`);
}

if (import.meta.main)
  main(process.argv.slice(2)).catch((error: unknown) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : "Public npm release verification failed."}\n`,
    );
    process.exitCode = 1;
  });

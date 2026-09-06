import { verifyPreparedFoundryNpm } from "./lib/foundry-release-prepared.ts";

const usage =
  "Usage: release-verify-prepared --directory <absolute-directory> --version <x.y.z> --expected-git-head <40-hex-sha>";

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
      !["--directory", "--version", "--expected-git-head"].includes(flag) ||
      values.has(flag) ||
      !value ||
      value.startsWith("--")
    )
      throw new Error(usage);
    values.set(flag, value);
  }
  if (values.size !== 3) throw new Error(usage);
  const result = await verifyPreparedFoundryNpm(values.get("--directory") ?? "", {
    version: values.get("--version") ?? "",
    gitHead: values.get("--expected-git-head") ?? "",
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (import.meta.main)
  main(process.argv.slice(2)).catch((error: unknown) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : "Prepared package verification failed."}\n`,
    );
    process.exitCode = 1;
  });

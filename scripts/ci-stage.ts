import fs from "node:fs";
import path from "node:path";
import {
  restoreStage,
  sealStage,
  stageExpectation,
  stageArtifactName,
} from "./lib/foundry-ci-stage.ts";
import {
  currentCapsuleOrigin,
  type CapsuleStage,
  type CapsulePlatform,
} from "./lib/foundry-ci-capsule.ts";

const usage =
  "Usage: ci-stage <restore|seal> --stage <source|native|components|bootstrap> --platform <all|platform> --directory <absolute> [--input-sha256 digest] [--from-run id] [--required true]";
function main(args: string[]) {
  const command = args.shift();
  if (!["restore", "seal"].includes(command ?? "") || args.length % 2) throw new Error(usage);
  const values = new Map<string, string>();
  for (let i = 0; i < args.length; i += 2) {
    if (
      ![
        "--stage",
        "--platform",
        "--directory",
        "--input-sha256",
        "--from-run",
        "--required",
      ].includes(args[i]) ||
      values.has(args[i]) ||
      !args[i + 1]
    )
      throw new Error(usage);
    values.set(args[i], args[i + 1]);
  }
  const stage = values.get("--stage"),
    platform = values.get("--platform"),
    directory = values.get("--directory");
  if (
    !["source", "native", "components", "bootstrap"].includes(stage ?? "") ||
    !["all", "linux-x64", "linux-arm64", "darwin-arm64", "win32-x64"].includes(platform ?? "") ||
    !directory ||
    !path.isAbsolute(directory)
  )
    throw new Error(usage);
  const expected = stageExpectation(
    stage as CapsuleStage,
    platform as CapsulePlatform,
    values.get("--input-sha256"),
  );
  let result;
  if (command === "restore") {
    if (values.has("--required") && values.get("--required") !== "true") throw new Error(usage);
    result = restoreStage(
      expected,
      directory,
      values.get("--from-run") || process.env.FOUNDRY_RESUME_RUN || undefined,
    );
    if (values.has("--required") && !result.reused)
      throw new Error("Required completed stage is missing or expired.");
  } else {
    if (values.has("--from-run") || values.has("--required")) throw new Error(usage);
    sealStage(directory, expected);
    result = { artifact_name: stageArtifactName(expected), reused: false };
  }
  const origin = currentCapsuleOrigin();
  if (process.env.GITHUB_OUTPUT) {
    const output = Object.entries({ ...result, run_id: origin.run })
      .map(([key, value]) => {
        const text = String(value);
        if (/[\r\n]/u.test(text)) throw new Error("Invalid stage output.");
        return `${key}=${text}\n`;
      })
      .join("");
    fs.appendFileSync(process.env.GITHUB_OUTPUT, output);
  }
  process.stdout.write(
    `${JSON.stringify({ schema: "tiangong-foundry.ci-stage-result.v1", stage, platform, source: expected.identity.source.commit, ...result })}\n`,
  );
}
if (import.meta.main) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : "Stage operation failed."}\n`);
    process.exitCode = 1;
  }
}

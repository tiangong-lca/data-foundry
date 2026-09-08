import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { loadFoundryTestPlan } from "./lib/foundry-ci-plan.ts";
import { foundryCiReporterPath } from "./ci-test-reporter.ts";
import { readFoundryReleaseGit as git } from "./lib/foundry-release-contract.ts";
import { readFoundryReleaseArtifact } from "./lib/foundry-release-prepared.ts";

const root = path.resolve(import.meta.dirname, "..");
const usage =
  "Usage: ci-test-shard --index <1-4> --plan-sha256 <sha256> --source-sha <commit> --output <new-absolute-directory>";
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid test report record.");
  return value as Record<string, unknown>;
}
async function main(args: readonly string[]): Promise<void> {
  if (
    args.length !== 8 ||
    args[0] !== "--index" ||
    args[2] !== "--plan-sha256" ||
    args[4] !== "--source-sha" ||
    args[6] !== "--output"
  )
    throw new Error(usage);
  const index = Number(args[1]),
    expectedPlan = args[3],
    source = args[5];
  if (
    !/^[1-4]$/u.test(args[1]) ||
    !/^[0-9a-f]{64}$/u.test(expectedPlan) ||
    !/^[0-9a-f]{40}$/u.test(source)
  )
    throw new Error(usage);
  const cleanSource = () => {
    if (
      git(root, ["rev-parse", "HEAD"]).trim() !== source ||
      git(root, ["status", "--porcelain", "--untracked-files=all"]).trim()
    )
      throw new Error("CI tests require the exact clean source checkout.");
  };
  cleanSource();
  const plan = loadFoundryTestPlan(root);
  if (plan.planSha256 !== expectedPlan)
    throw new Error("CI test plan does not match its independently selected digest.");
  const shard = plan.shards.find((candidate) => candidate.index === index);
  if (!shard?.files.length) throw new Error("CI test shard must not be empty.");
  if (!path.isAbsolute(args[7])) throw new Error(usage);
  const output = path.join(fs.realpathSync(path.dirname(args[7])), path.basename(args[7]));
  const relative = path.relative(root, output);
  if (
    relative === "" ||
    (!path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`))
  )
    throw new Error("CI test reports must be outside the source checkout.");
  fs.mkdirSync(output, { mode: 0o700 });
  const eventsFile = path.join(output, "test-events.jsonl");
  const environment = { ...process.env };
  delete environment.NODE_OPTIONS;
  delete environment.NODE_TEST_CONTEXT;
  const started = performance.now();
  const exitCode = await new Promise<number>((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        "--test",
        "--test-concurrency=2",
        "--test-reporter=spec",
        "--test-reporter-destination=stdout",
        `--test-reporter=${foundryCiReporterPath}`,
        `--test-reporter-destination=${eventsFile}`,
        ...shard.files.map((file) => path.join(root, file)),
      ],
      { cwd: root, env: environment, stdio: "inherit", shell: false },
    );
    child.once("error", reject);
    child.once("exit", (code) => resolve(code ?? 1));
  });
  const errors: string[] = [];
  let counts: Record<string, unknown> | null = null;
  let eventsSha256: string | null = null;
  let rows: Record<string, unknown>[] = [];
  try {
    const eventBytes = readFoundryReleaseArtifact(eventsFile, 32 * 1024 * 1024);
    eventsSha256 = createHash("sha256").update(eventBytes).digest("hex");
    rows = eventBytes
      .toString("utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => record(JSON.parse(line)));
    const summaries = rows.filter((row) => row.type === "summary" && row.file === undefined);
    if (summaries.length !== 1)
      throw new Error("CI test run requires one terminal runner summary.");
    const summary = summaries[0];
    counts = record(summary.counts);
    if (
      summary.success !== true ||
      counts.failed !== 0 ||
      counts.cancelled !== 0 ||
      typeof counts.tests !== "number" ||
      counts.tests < 1
    )
      errors.push("Node test run did not complete successfully.");
    const executed = new Set(
      rows
        .filter(
          (row) =>
            typeof row.file === "string" && (row.type === "summary" || row.name === row.file),
        )
        .map((row) => fs.realpathSync(String(row.file))),
    );
    for (const file of shard.files)
      if (!executed.has(fs.realpathSync(path.join(root, file))))
        errors.push(`Test file has no execution summary: ${file}`);
    if (executed.size !== shard.files.length)
      errors.push("Test execution inventory differs from the selected shard.");
    cleanSource();
    if (loadFoundryTestPlan(root).planSha256 !== expectedPlan)
      errors.push("Test inventory changed during execution.");
  } catch (error) {
    errors.push(error instanceof Error ? error.message : "Invalid test execution evidence.");
  }
  if (exitCode !== 0) errors.push(`Node test process exited ${exitCode}.`);
  const receipt = {
    schema: "tiangong-foundry.ci-test-shard.v1",
    status: errors.length ? "failed" : "passed",
    source,
    platform: `${process.platform}-${process.arch}`,
    plan_sha256: expectedPlan,
    index,
    total: plan.shards.length,
    files: shard.files,
    counts,
    test_events_sha256: eventsSha256,
    elapsed_ms: performance.now() - started,
    errors,
  };
  fs.writeFileSync(path.join(output, "test-shard.json"), `${JSON.stringify(receipt, null, 2)}\n`, {
    flag: "wx",
    mode: 0o644,
  });
  if (errors.length) throw new Error(errors.join("\n"));
}
if (import.meta.main)
  main(process.argv.slice(2)).catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : "CI tests failed."}\n`);
    process.exitCode = 1;
  });

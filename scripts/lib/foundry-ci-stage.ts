import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  capsuleHash,
  capsuleIdentity,
  canonicalCapsuleJson,
  currentCapsuleIdentity,
  currentCapsuleOrigin,
  createCapsuleReceipt,
  readVerifiedCapsule,
  materializeCapsule,
  ExpiredCapsuleError,
  type CapsuleExpectation,
  type CapsuleReceipt,
  type CapsuleStage,
  type CapsulePlatform,
} from "./foundry-ci-capsule.ts";
import { readFoundryReleaseArtifact } from "./foundry-release-prepared.ts";
import { foundryCiPlatforms } from "./foundry-ci-results.ts";
import { loadFoundryTestPlan } from "./foundry-ci-plan.ts";
import { readVerifiedFoundryCiPackage } from "./foundry-ci-package.ts";
import { readFoundryReleaseGit } from "./foundry-release-contract.ts";

const repo = "tiangong-lca/data-foundry";
const root = path.resolve(import.meta.dirname, "../..");
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid stage evidence.");
  return value as Record<string, unknown>;
}
function gh(args: string[], json = true): unknown {
  const result = spawnSync("gh", args, {
    encoding: "utf8",
    shell: false,
    timeout: 180000,
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.error || result.status !== 0)
    throw new Error("GitHub stage artifact operation failed.");
  return json ? (JSON.parse(result.stdout) as unknown) : undefined;
}
function parse(file: string): Record<string, unknown> {
  return object(
    JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(
        readFoundryReleaseArtifact(file, 32 * 1024 * 1024),
      ),
    ),
  );
}
export function stageExpectation(
  stage: CapsuleStage,
  platform: CapsulePlatform,
  input?: string,
): CapsuleExpectation {
  const identity = currentCapsuleIdentity(),
    origin = currentCapsuleOrigin();
  return {
    stage,
    platform,
    identity,
    input_sha256: input ?? capsuleIdentity(identity),
    purpose: origin.workflow.endsWith("/publish-foundry.yml") ? "release" : "ci",
  };
}
export function stageArtifactPrefix(expected: CapsuleExpectation) {
  return `foundry-capsule-v1-${expected.stage}-${expected.platform}-${expected.input_sha256.slice(0, 16)}-`;
}
export function stageArtifactName(expected: CapsuleExpectation) {
  const origin = currentCapsuleOrigin();
  return `${stageArtifactPrefix(expected)}${origin.run}-${origin.attempt}`;
}
interface Artifact {
  id: number;
  name: string;
  expired: boolean;
}
/** Run IDs locate candidates; verified certificates and content, not names, grant authority. */
export function selectStageArtifacts(value: unknown, expected: CapsuleExpectation): Artifact[] {
  const data = object(value);
  if (!Array.isArray(data.artifacts)) throw new Error("Invalid stage artifact listing.");
  const prefix = stageArtifactPrefix(expected);
  return data.artifacts
    .map((item) => {
      const row = object(item);
      if (
        !Number.isSafeInteger(row.id) ||
        Number(row.id) < 1 ||
        typeof row.name !== "string" ||
        typeof row.expired !== "boolean"
      )
        throw new Error("Invalid stage artifact metadata.");
      return { id: Number(row.id), name: row.name, expired: row.expired };
    })
    .filter(
      (item) =>
        !item.expired &&
        item.name.startsWith(prefix) &&
        /^\d+-\d+$/u.test(item.name.slice(prefix.length)),
    )
    .sort((a, b) => b.id - a.id);
}
export function restoreStage(expected: CapsuleExpectation, output: string, previousRun?: string) {
  const origin = currentCapsuleOrigin();
  if (expected.purpose !== (origin.workflow.endsWith("/publish-foundry.yml") ? "release" : "ci"))
    throw new Error("Stage purpose differs from its consuming workflow.");
  if (!path.isAbsolute(output) || fs.existsSync(output))
    throw new Error("Stage restoration needs a new absolute output.");
  if (previousRun && !/^[1-9]\d{0,19}$/u.test(previousRun))
    throw new Error("Recovery requires one exact numeric run identifier.");
  const runs = [...new Set([origin.run, ...(previousRun ? [previousRun] : [])])];
  for (const run of runs) {
    const metadata = object(gh(["api", `repos/${repo}/actions/runs/${run}`]));
    const pullMerge =
      expected.purpose === "ci" &&
      metadata.event === "pull_request" &&
      readFoundryReleaseGit(root, ["show", "-s", "--format=%P", expected.identity.source.commit])
        .trim()
        .split(" ")
        .includes(String(metadata.head_sha));
    if (
      (metadata.head_sha !== expected.identity.source.commit && !pullMerge) ||
      typeof metadata.path !== "string" ||
      metadata.path.split("@")[0] !== origin.workflow
    )
      throw new Error("Selected recovery run has a different source or workflow.");
    const artifacts: Artifact[] = [];
    for (let page = 1; page <= 5; page++) {
      const data = object(
        gh(["api", `repos/${repo}/actions/runs/${run}/artifacts?per_page=100&page=${page}`]),
      );
      if (
        !Number.isSafeInteger(data.total_count) ||
        Number(data.total_count) > 500 ||
        Number(data.total_count) < 0
      )
        throw new Error("Recovery artifact discovery exceeded its complete bounded inventory.");
      artifacts.push(...selectStageArtifacts(data, expected));
      if (page * 100 >= Number(data.total_count)) break;
    }
    for (const artifact of artifacts.sort((a, b) => b.id - a.id)) {
      const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "foundry-stage-"));
      try {
        gh(
          ["run", "download", run, "--repo", repo, "--name", artifact.name, "--dir", temporary],
          false,
        );
        let capsule;
        try {
          capsule = readVerifiedCapsule(temporary, expected);
        } catch (error) {
          if (error instanceof ExpiredCapsuleError) continue;
          throw error;
        }
        validateStageEvidence(temporary, expected);
        if (expected.stage === "native") {
          for (const file of capsule.receipt.files.filter(
            (file) => file.path.startsWith("components/") && file.path.endsWith(".tar.gz"),
          ))
            gh(
              [
                "attestation",
                "verify",
                path.join(temporary, file.path),
                "--repo",
                repo,
                "--signer-workflow",
                `${repo}/${capsule.receipt.origin.workflow}`,
                "--source-digest",
                expected.identity.source.commit,
                "--signer-digest",
                expected.identity.source.commit,
                "--source-ref",
                capsule.receipt.origin.ref,
                "--deny-self-hosted-runners",
              ],
              false,
            );
        }
        materializeCapsule(capsule, output, true);
        return {
          reused: true,
          original_run: capsule.receipt.origin.run,
          original_attempt: capsule.receipt.origin.attempt,
          artifact_name: stageArtifactName(expected),
          ...stageDigests(output, expected),
        };
      } finally {
        fs.rmSync(temporary, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
      }
    }
  }
  return { reused: false, artifact_name: stageArtifactName(expected) };
}
function sourceMatches(value: unknown, expected: CapsuleExpectation) {
  const source = object(value);
  if (
    source.commit !== expected.identity.source.commit ||
    source.tree !== expected.identity.source.tree
  )
    throw new Error("Stage report has a different source.");
}
function bootstrapReport(
  report: Record<string, unknown>,
  expected: CapsuleExpectation,
  platform: CapsulePlatform,
  mode: "cached" | "public",
  manifest: string,
) {
  sourceMatches(report.source, expected);
  const phases = [
    ["initial", 0],
    ["warm", 0],
    ["task-start", 0],
    ["returned-action", 0],
    ["developer-command-rejected", 2],
    ["changed-script-rejected", 1],
    ["changed-base-index-rejected", 1],
  ];
  if (
    report.schema !== "tiangong-foundry.bootstrap-qualification.v1" ||
    report.status !== "passed" ||
    report.platform !== platform ||
    report.mode !== mode ||
    report.manifest_sha256 !== manifest ||
    report.cache_status !== "ready" ||
    report.initial_cache !== (mode === "public" ? "empty" : "verified-local-seeds") ||
    !Array.isArray(report.checks) ||
    report.checks.length !== phases.length ||
    report.checks.some((item, index) => {
      const row = object(item);
      return (
        row.phase !== phases[index][0] ||
        row.exit !== phases[index][1] ||
        !Number.isSafeInteger(row.milliseconds) ||
        Number(row.milliseconds) < 0
      );
    })
  )
    throw new Error("Incomplete or failed bootstrap qualification cannot be reused.");
}
export function validateStageEvidence(directory: string, expected: CapsuleExpectation) {
  const read = (name: string) => parse(path.join(directory, name));
  if (expected.stage === "source") {
    const summary = read("test-summary.json"),
      aggregate = read("runtime-aggregate.json");
    sourceMatches(aggregate.source, expected);
    if (
      summary.schema !== "tiangong-foundry.ci-test-summary.v1" ||
      summary.source !== expected.identity.source.commit ||
      summary.plan_sha256 !== expected.identity.test_plan_sha256 ||
      summary.files_per_platform !==
        loadFoundryTestPlan(root).shards.reduce((n, s) => n + s.files.length, 0) ||
      aggregate.schema !== "tiangong-foundry.runtime-aggregate.v1" ||
      aggregate.status !== "verified" ||
      aggregate.scope !== "source-candidate"
    )
      throw new Error("Incomplete source qualification cannot be sealed or reused.");
    const platforms = object(summary.platforms);
    if (Object.keys(platforms).sort().join() !== [...foundryCiPlatforms].sort().join())
      throw new Error("Source qualification is missing platforms.");
    for (const platform of foundryCiPlatforms) {
      const counts = object(platforms[platform]);
      if (
        counts.failed !== 0 ||
        counts.cancelled !== 0 ||
        counts.todo !== 0 ||
        !Number.isSafeInteger(counts.tests) ||
        Number(counts.tests) < 1 ||
        Number(counts.passed) + Number(counts.skipped) !== counts.tests
      )
        throw new Error("Source tests did not finish successfully.");
      bootstrapReport(
        read(`bootstrap/${platform}.json`),
        expected,
        platform,
        "cached",
        String(aggregate.manifest_sha256),
      );
    }
    const manifest = read("package/build-manifest.json"),
      context = object(manifest.context);
    if (
      canonicalCapsuleJson({
        source: context.source,
        package: context.package,
        toolchain: context.toolchain,
      }) !==
      canonicalCapsuleJson({
        source: expected.identity.source,
        package: expected.identity.package,
        toolchain: expected.identity.toolchain,
      })
    )
      throw new Error("Source package context differs.");
    const bytes = readFoundryReleaseArtifact(
      path.join(directory, `package/tiangong-lca-foundry-${expected.identity.package.version}.tgz`),
      64 * 1024 * 1024,
    );
    if (
      object(manifest.artifact).sha256 !== capsuleHash(bytes) ||
      object(aggregate.package).sha256 !== capsuleHash(bytes)
    )
      throw new Error("Qualified package bytes differ from native qualification.");
  } else if (expected.stage === "native") {
    const report = read("runtime-qualification.json"),
      platform = read("runtime-platform.json");
    sourceMatches(report.source, expected);
    sourceMatches(platform.source, expected);
    if (
      report.schema !== "tiangong-foundry.runtime-component-qualification.v1" ||
      report.status !== "passed" ||
      report.platform !== expected.platform ||
      report.package_source !== "published-release" ||
      report.launches !== 13 ||
      report.manager_download_calls !== 0 ||
      !Array.isArray(report.checks) ||
      report.checks.length !== 13 ||
      !Array.isArray(report.release_blockers) ||
      report.release_blockers.length ||
      object(platform.package).sha256 !== expected.input_sha256 ||
      report.manifest_sha256 !==
        capsuleHash(
          readFoundryReleaseArtifact(
            path.join(directory, "runtime-manifest.json"),
            32 * 1024 * 1024,
          ),
        )
    )
      throw new Error("Incomplete or different published native qualification.");
  } else if (expected.stage === "components") {
    const report = read("component-publication.json"),
      aggregate = read("runtime-aggregate.json");
    sourceMatches(report.source, expected);
    if (
      report.status !== "published" ||
      report.schema !== "tiangong-foundry.runtime-component-publication.v1" ||
      object(aggregate.package).sha256 !== expected.input_sha256 ||
      report.manifest_sha256 !==
        capsuleHash(
          readFoundryReleaseArtifact(
            path.join(directory, "runtime-manifest.json"),
            32 * 1024 * 1024,
          ),
        )
    )
      throw new Error("Incomplete component publication evidence.");
  } else
    bootstrapReport(
      read("bootstrap-qualification.json"),
      expected,
      expected.platform,
      "public",
      expected.input_sha256,
    );
}
export function stageDigests(
  directory: string,
  expected: CapsuleExpectation,
): Record<string, string> {
  if (expected.stage === "source")
    return {
      package_sha256: capsuleHash(
        readFoundryReleaseArtifact(
          path.join(
            directory,
            `package/tiangong-lca-foundry-${expected.identity.package.version}.tgz`,
          ),
          64 * 1024 * 1024,
        ),
      ),
      package_manifest_sha256: capsuleHash(
        readFoundryReleaseArtifact(
          path.join(directory, "package/build-manifest.json"),
          1024 * 1024,
        ),
      ),
    };
  if (expected.stage === "components")
    return {
      manifest_sha256: capsuleHash(
        readFoundryReleaseArtifact(path.join(directory, "runtime-manifest.json"), 32 * 1024 * 1024),
      ),
    };
  return {};
}
export function sealStage(directory: string, expected: CapsuleExpectation): CapsuleReceipt {
  if (expected.stage !== "source" && expected.purpose !== "release")
    throw new Error("Publication stages require the release workflow.");
  if (expected.platform !== "all" && expected.platform !== `${process.platform}-${process.arch}`)
    throw new Error("Native stage cannot claim another host.");
  validateStageEvidence(directory, expected);
  if (expected.stage === "source")
    readVerifiedFoundryCiPackage(path.join(directory, "package"), {
      archiveSha256: process.env.FOUNDRY_SOURCE_PACKAGE_SHA256 ?? "",
      manifestSha256: process.env.FOUNDRY_SOURCE_PACKAGE_MANIFEST_SHA256 ?? "",
    });
  return createCapsuleReceipt(directory, expected);
}

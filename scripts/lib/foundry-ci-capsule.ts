import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { captureFoundryCiBuildContext } from "./foundry-ci-identity.ts";
import { loadFoundryTestPlan } from "./foundry-ci-plan.ts";
import { foundryCiPlatforms } from "./foundry-ci-results.ts";
import { readFoundryReleaseArtifact } from "./foundry-release-prepared.ts";
import { freezeFoundryReleaseValue } from "./foundry-release-component-io.ts";

const repository = "tiangong-lca/data-foundry";
const root = path.resolve(import.meta.dirname, "../..");
const sha = /^[a-f0-9]{64}$/u;
const stages = ["source", "native", "components", "bootstrap"] as const;
export type CapsuleStage = (typeof stages)[number];
export type CapsulePlatform = (typeof foundryCiPlatforms)[number] | "all";
export interface CapsuleIdentity {
  readonly repository: { readonly id: string; readonly owner_id: string };
  readonly source: { readonly commit: string; readonly tree: string };
  readonly package: { readonly name: string; readonly version: string };
  readonly toolchain: {
    readonly node: string;
    readonly pnpm: string;
    readonly typescript: string;
    readonly lock_sha256: string;
  };
  readonly runtime_inputs_sha256: string;
  readonly test_plan_sha256: string;
}
interface CapsuleFile {
  readonly path: string;
  readonly bytes: number;
  readonly sha256: string;
}
export interface CapsuleReceipt {
  readonly schema: "tiangong-foundry.ci-capsule.v1";
  readonly stage: CapsuleStage;
  readonly platform: CapsulePlatform;
  readonly purpose: "ci" | "release";
  readonly identity: CapsuleIdentity;
  readonly input_sha256: string;
  readonly origin: {
    readonly run: string;
    readonly attempt: string;
    readonly ref: string;
    readonly workflow: string;
  };
  readonly files: readonly CapsuleFile[];
}
export type CapsuleExpectation = Pick<
  CapsuleReceipt,
  "stage" | "platform" | "purpose" | "identity" | "input_sha256"
>;
export const capsuleHash = (value: Uint8Array) => createHash("sha256").update(value).digest("hex");
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid qualification capsule object.");
  return value as Record<string, unknown>;
}
export function canonicalCapsuleJson(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalCapsuleJson).join(",")}]`;
  const object = record(value);
  return `{${Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalCapsuleJson(object[key])}`)
    .join(",")}}`;
}
export const capsuleIdentity = (identity: CapsuleIdentity) =>
  capsuleHash(Buffer.from(canonicalCapsuleJson(identity)));
export function currentCapsuleIdentity(): CapsuleIdentity {
  const { source, package: pkg, toolchain } = captureFoundryCiBuildContext();
  const id = process.env.GITHUB_REPOSITORY_ID,
    owner = process.env.GITHUB_REPOSITORY_OWNER_ID;
  if (!/^[1-9]\d{0,19}$/u.test(id ?? "") || !/^[1-9]\d{0,19}$/u.test(owner ?? ""))
    throw new Error("Capsule repository identity is missing.");
  return freezeFoundryReleaseValue({
    repository: { id: id!, owner_id: owner! },
    source,
    package: pkg,
    toolchain,
    runtime_inputs_sha256: capsuleHash(
      readFoundryReleaseArtifact(path.join(root, "specs/release/runtime-inputs.json"), 1024 * 1024),
    ),
    test_plan_sha256: loadFoundryTestPlan(root).planSha256,
  });
}
export function currentCapsuleOrigin(): CapsuleReceipt["origin"] {
  const env = process.env;
  const prefix = `${repository}/`;
  const value = env.GITHUB_WORKFLOW_REF ?? "";
  const parts = value.slice(prefix.length).split("@");
  if (
    env.GITHUB_ACTIONS !== "true" ||
    env.RUNNER_ENVIRONMENT !== "github-hosted" ||
    env.GITHUB_REPOSITORY !== repository ||
    !value.startsWith(prefix) ||
    parts.length !== 2 ||
    env.GITHUB_WORKFLOW_SHA !== env.GITHUB_SHA ||
    !/^\d{1,20}$/u.test(env.GITHUB_RUN_ID ?? "") ||
    !/^\d{1,5}$/u.test(env.GITHUB_RUN_ATTEMPT ?? "")
  )
    throw new Error("Qualification capsules require their exact hosted workflow.");
  const origin = {
    run: env.GITHUB_RUN_ID!,
    attempt: env.GITHUB_RUN_ATTEMPT!,
    workflow: parts[0],
    ref: parts[1],
  };
  validateOrigin(origin, origin.workflow.endsWith("/publish-foundry.yml") ? "release" : "ci");
  return origin;
}
export function capsuleSignerWorkflow(receipt: CapsuleReceipt): string {
  return receipt.stage === "source"
    ? ".github/workflows/quality-gate.yml"
    : ".github/workflows/publish-foundry.yml";
}
function validateOrigin(origin: CapsuleReceipt["origin"], purpose: CapsuleReceipt["purpose"]) {
  const workflow =
    purpose === "release"
      ? ".github/workflows/publish-foundry.yml"
      : ".github/workflows/quality-gate.yml";
  if (
    origin.workflow !== workflow ||
    !/^[1-9]\d{0,19}$/u.test(origin.run) ||
    !/^[1-9]\d{0,4}$/u.test(origin.attempt) ||
    !(
      purpose === "release"
        ? /^refs\/(?:heads\/main|tags\/foundry-v\d+\.\d+\.\d+)$/u
        : /^refs\/(?:heads\/[A-Za-z0-9./_-]{1,200}|pull\/\d+\/merge)$/u
    ).test(origin.ref)
  )
    throw new Error("Qualification capsule origin is outside the trusted workflow scope.");
}
function portable(file: string) {
  if (
    !file ||
    file.length > 240 ||
    file === "receipt.json" ||
    /[\\:\p{Cc}]/u.test(file) ||
    path.posix.normalize(file) !== file ||
    file.startsWith("/") ||
    file.split("/").some((part) => !part || part === "." || part === ".." || part.startsWith("."))
  )
    throw new Error("Qualification capsule contains an unsafe path.");
}
export function inventoryCapsuleFiles(directory: string): CapsuleFile[] {
  if (
    !path.isAbsolute(directory) ||
    !fs.lstatSync(directory).isDirectory() ||
    fs.lstatSync(directory).isSymbolicLink()
  )
    throw new Error("Qualification capsule requires a real absolute directory.");
  directory = fs.realpathSync(directory);
  const files: CapsuleFile[] = [],
    names = new Set<string>();
  let total = 0;
  function walk(relative: string) {
    for (const entry of fs.readdirSync(path.join(directory, relative), { withFileTypes: true })) {
      const name = relative ? `${relative}/${entry.name}` : entry.name;
      if (name === "receipt.json") continue;
      portable(name);
      if (entry.isSymbolicLink() || (!entry.isDirectory() && !entry.isFile()))
        throw new Error("Qualification capsule links and special files are forbidden.");
      if (names.has(name.toLowerCase())) throw new Error("Duplicate qualification capsule path.");
      names.add(name.toLowerCase());
      if (entry.isDirectory()) {
        if (!fs.readdirSync(path.join(directory, name)).length)
          throw new Error("Unexpected empty capsule directory.");
        walk(name);
        continue;
      }
      if (fs.realpathSync(path.join(directory, name)) !== path.join(directory, name))
        throw new Error("Capsule file parent changed during inventory.");
      const bytes = readFoundryReleaseArtifact(path.join(directory, name), 256 * 1024 * 1024, true);
      total += bytes.length;
      if (total > 512 * 1024 * 1024 || files.length >= 50000)
        throw new Error("Qualification capsule exceeds its inventory bound.");
      files.push({ path: name, bytes: bytes.length, sha256: capsuleHash(bytes) });
    }
  }
  walk("");
  if (!files.length) throw new Error("Qualification capsule payload is empty.");
  return files.sort((a, b) => a.path.localeCompare(b.path, "en"));
}
export function inspectCapsuleReceipt(bytes: Buffer, expected: CapsuleExpectation): CapsuleReceipt {
  if (
    bytes.length < 1 ||
    bytes.length > 16 * 1024 * 1024 ||
    !Buffer.from(bytes.toString("utf8")).equals(bytes)
  )
    throw new Error("Invalid qualification capsule bytes.");
  const value = record(JSON.parse(bytes.toString("utf8")));
  if (
    Object.keys(value).sort().join(",") !==
      "files,identity,input_sha256,origin,platform,purpose,schema,stage" ||
    value.schema !== "tiangong-foundry.ci-capsule.v1" ||
    !stages.includes(value.stage as CapsuleStage) ||
    value.stage !== expected.stage ||
    value.platform !== expected.platform ||
    value.purpose !== expected.purpose ||
    !sha.test(expected.input_sha256) ||
    value.input_sha256 !== expected.input_sha256 ||
    canonicalCapsuleJson(value.identity) !== canonicalCapsuleJson(expected.identity)
  )
    throw new Error("Qualification capsule differs from the required source, inputs or stage.");
  if (expected.stage !== "source" && expected.purpose !== "release")
    throw new Error("Publication proof requires a release workflow.");
  if (
    (expected.stage === "source" || expected.stage === "components") !==
      (expected.platform === "all") ||
    (expected.platform !== "all" && !foundryCiPlatforms.includes(expected.platform))
  )
    throw new Error("Invalid qualification capsule platform.");
  const origin = record(value.origin);
  if (
    Object.keys(origin).sort().join(",") !== "attempt,ref,run,workflow" ||
    Object.values(origin).some((item) => typeof item !== "string")
  )
    throw new Error("Invalid qualification capsule origin.");
  validateOrigin(origin as unknown as CapsuleReceipt["origin"], expected.purpose);
  if (!Array.isArray(value.files) || !value.files.length || value.files.length > 50000)
    throw new Error("Invalid qualification capsule inventory.");
  const seen = new Set<string>();
  let total = 0;
  for (const item of value.files) {
    const file = record(item);
    if (
      Object.keys(file).sort().join(",") !== "bytes,path,sha256" ||
      typeof file.path !== "string" ||
      typeof file.bytes !== "number" ||
      !Number.isSafeInteger(file.bytes) ||
      file.bytes < 0 ||
      file.bytes > 256 * 1024 * 1024 ||
      typeof file.sha256 !== "string" ||
      !sha.test(file.sha256)
    )
      throw new Error("Invalid qualification capsule file.");
    portable(file.path);
    total += file.bytes;
    if (seen.has(file.path.toLowerCase()) || total > 512 * 1024 * 1024)
      throw new Error("Duplicate or oversized qualification capsule files.");
    seen.add(file.path.toLowerCase());
  }
  return freezeFoundryReleaseValue(value as unknown as CapsuleReceipt);
}

/** Policy over gh's already cryptographically verified output; this function grants no brand. */
export class ExpiredCapsuleError extends Error {}
export function validateCapsuleCertificate(
  verified: unknown,
  receipt: CapsuleReceipt,
  now = Date.now(),
): void {
  if (!Array.isArray(verified) || !verified.length || verified.length > 30)
    throw new Error("Missing verified qualification attestation.");
  const wanted = `https://github.com/${repository}/${capsuleSignerWorkflow(receipt)}@${receipt.origin.ref}`;
  const caller = `https://github.com/${repository}/${receipt.origin.workflow}@${receipt.origin.ref}`;
  const invocation = `https://github.com/${repository}/actions/runs/${receipt.origin.run}/attempts/${receipt.origin.attempt}`;
  let matched = false,
    fresh = false;
  for (const item of verified) {
    const result = record(record(item).verificationResult);
    const certificate = record(record(result.signature).certificate);
    const correct =
      certificate.issuer === "https://token.actions.githubusercontent.com" &&
      certificate.runnerEnvironment === "github-hosted" &&
      certificate.sourceRepositoryURI === `https://github.com/${repository}` &&
      certificate.sourceRepositoryDigest === receipt.identity.source.commit &&
      certificate.sourceRepositoryIdentifier === receipt.identity.repository.id &&
      certificate.sourceRepositoryOwnerIdentifier === receipt.identity.repository.owner_id &&
      certificate.buildSignerDigest === receipt.identity.source.commit &&
      certificate.sourceRepositoryRef === receipt.origin.ref &&
      certificate.buildSignerURI === wanted &&
      certificate.buildConfigURI === caller &&
      certificate.buildConfigDigest === receipt.identity.source.commit &&
      certificate.runInvocationURI === invocation;
    if (!correct) continue;
    matched = true;
    if (!Array.isArray(result.verifiedTimestamps) || !result.verifiedTimestamps.length)
      throw new Error("Missing verified signing time.");
    fresh ||= result.verifiedTimestamps.some((item) => {
      const stamp = record(item).timestamp;
      const time = typeof stamp === "string" ? Date.parse(stamp) : NaN;
      if (!Number.isFinite(time) || time > now + 300000)
        throw new Error("Invalid verified signing time.");
      return now - time <= 24 * 3600000;
    });
  }
  if (!matched)
    throw new Error(
      "Qualification attestation certificate has the wrong source, workflow or original run.",
    );
  if (!fresh)
    throw new ExpiredCapsuleError(
      "Qualification capsule requires fresh validation after 24 hours.",
    );
}
export interface VerifiedCapsule {
  readonly receipt: CapsuleReceipt;
  readonly directory: string;
}
const verifiedCapsules = new WeakMap<
  object,
  { receiptSha256: string; files: readonly CapsuleFile[] }
>();
export function readVerifiedCapsule(
  directory: string,
  expected: CapsuleExpectation,
): VerifiedCapsule {
  if (
    !path.isAbsolute(directory) ||
    !fs.lstatSync(directory).isDirectory() ||
    fs.lstatSync(directory).isSymbolicLink()
  )
    throw new Error("Capsule verification needs a real directory.");
  directory = fs.realpathSync(directory);
  const file = path.join(directory, "receipt.json");
  const bytes = readFoundryReleaseArtifact(file, 16 * 1024 * 1024);
  const receipt = inspectCapsuleReceipt(bytes, expected);
  const result = spawnSync(
    "gh",
    [
      "attestation",
      "verify",
      file,
      "--repo",
      repository,
      "--signer-workflow",
      `${repository}/${capsuleSignerWorkflow(receipt)}`,
      "--source-digest",
      receipt.identity.source.commit,
      "--signer-digest",
      receipt.identity.source.commit,
      "--source-ref",
      receipt.origin.ref,
      "--deny-self-hosted-runners",
      "--format",
      "json",
    ],
    { encoding: "utf8", shell: false, timeout: 120000, maxBuffer: 16 * 1024 * 1024 },
  );
  if (result.status !== 0 || result.error)
    throw new Error("Qualification capsule signature verification failed.");
  validateCapsuleCertificate(JSON.parse(result.stdout), receipt);
  const files = inventoryCapsuleFiles(directory);
  if (
    canonicalCapsuleJson(files) !== canonicalCapsuleJson(receipt.files) ||
    capsuleHash(readFoundryReleaseArtifact(file, 16 * 1024 * 1024)) !== capsuleHash(bytes)
  )
    throw new Error("Qualification capsule files changed or differ from their signed inventory.");
  const value = Object.freeze({ receipt, directory });
  verifiedCapsules.set(value, { receiptSha256: capsuleHash(bytes), files });
  return value;
}
export function assertVerifiedCapsule(value: VerifiedCapsule) {
  const snapshot = verifiedCapsules.get(value);
  if (
    !snapshot ||
    capsuleHash(
      readFoundryReleaseArtifact(path.join(value.directory, "receipt.json"), 16 * 1024 * 1024),
    ) !== snapshot.receiptSha256 ||
    canonicalCapsuleJson(inventoryCapsuleFiles(value.directory)) !==
      canonicalCapsuleJson(snapshot.files)
  )
    throw new Error("A fresh verified qualification capsule is required.");
  return snapshot;
}
export function materializeCapsule(
  value: VerifiedCapsule,
  output: string,
  includeReceipt = false,
): void {
  const snapshot = assertVerifiedCapsule(value);
  if (!path.isAbsolute(output) || fs.existsSync(output))
    throw new Error("Capsule output must be a new absolute directory.");
  const relative = path.relative(root, output);
  if (
    !path.isAbsolute(relative) &&
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !relative.startsWith(`package-artifacts${path.sep}`)
  )
    throw new Error("Capsule materialization cannot modify source.");
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.mkdirSync(output, { mode: 0o700 });
  for (const file of snapshot.files) {
    const bytes = readFoundryReleaseArtifact(
      path.join(value.directory, file.path),
      256 * 1024 * 1024,
      true,
    );
    if (capsuleHash(bytes) !== file.sha256 || bytes.length !== file.bytes)
      throw new Error("Capsule payload changed during materialization.");
    const target = path.join(output, file.path);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, bytes, { flag: "wx", mode: 0o644 });
  }
  if (includeReceipt)
    fs.copyFileSync(
      path.join(value.directory, "receipt.json"),
      path.join(output, "receipt.json"),
      fs.constants.COPYFILE_EXCL,
    );
  assertVerifiedCapsule(value);
}

/** Produces unsigned receipt bytes; owning workflow attestation is mandatory before reuse. */
export function createCapsuleReceipt(
  directory: string,
  expected: CapsuleExpectation,
): CapsuleReceipt {
  const identity = currentCapsuleIdentity(),
    origin = currentCapsuleOrigin();
  if (
    canonicalCapsuleJson(identity) !== canonicalCapsuleJson(expected.identity) ||
    identity.source.commit !== process.env.GITHUB_SHA
  )
    throw new Error("Qualification capsule must describe its actual workflow source.");
  const jobs: Record<CapsuleStage, string> = {
    source: "seal-qualification",
    native: "prepare-runtime",
    components: "publish-components",
    bootstrap: "qualify-bootstrap-public",
  };
  if (
    process.env.GITHUB_JOB !== jobs[expected.stage] ||
    process.env.FOUNDRY_STAGE_PASSED !== "true"
  )
    throw new Error("Qualification sealing requires the completed owning stage.");
  const value: CapsuleReceipt = {
    schema: "tiangong-foundry.ci-capsule.v1",
    ...expected,
    origin,
    files: inventoryCapsuleFiles(directory),
  };
  inspectCapsuleReceipt(Buffer.from(JSON.stringify(value)), expected);
  fs.writeFileSync(path.join(directory, "receipt.json"), `${JSON.stringify(value, null, 2)}\n`, {
    flag: "wx",
    mode: 0o644,
  });
  return freezeFoundryReleaseValue(value);
}

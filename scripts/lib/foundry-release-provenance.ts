import { createHash, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { verify as verifySigstore, type Bundle } from "sigstore";
import {
  FOUNDRY_PUBLISH_WORKFLOW,
  FOUNDRY_RELEASE_REPOSITORY,
} from "./foundry-release-contract.ts";

const registry = "https://registry.npmjs.org";
const predicateType = "https://slsa.dev/provenance/v1";
const issuer = "https://token.actions.githubusercontent.com";
const maxMetadataBytes = 2 * 1024 * 1024;
const maxAttestationBytes = 8 * 1024 * 1024;
const maxTarballBytes = 64 * 1024 * 1024;

export interface NpmReleaseExpectation {
  readonly package: "cli" | "foundry";
  readonly version: string;
  readonly gitHead: string;
}

interface NpmReleasePolicy {
  readonly name: string;
  readonly repository: string;
  readonly workflow: string;
  readonly refs: readonly string[];
}

interface NpmReleaseMetadata {
  readonly tarballUrl: string;
  readonly attestationUrl: string;
  readonly integrity: string;
  readonly sha512: string;
  readonly registryGitHead: string | null;
}

export interface NpmProvenanceBinding {
  readonly ref: string;
  readonly invocationId: string;
  readonly signerIdentity: string;
}

export interface VerifiedNpmRelease {
  readonly schema: "tiangong-foundry.verified-npm-release.v1";
  readonly package: { readonly name: string; readonly version: string };
  readonly source: NpmProvenanceBinding & {
    readonly repository: string;
    readonly workflow: string;
    readonly gitCommit: string;
    readonly registryGitHead: string | null;
  };
  readonly tarball: {
    readonly url: string;
    readonly bytes: number;
    readonly sha256: string;
    readonly sha512: string;
    readonly integrity: string;
  };
  readonly attestations: { readonly url: string; readonly bytes: number; readonly sha256: string };
  readonly metadata: { readonly bytes: number; readonly sha256: string };
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`npm release ${label} must be an object.`);
  return value as Record<string, unknown>;
}

function digest(bytes: Uint8Array, algorithm = "sha256"): string {
  return createHash(algorithm).update(bytes).digest("hex");
}

function parseJson(bytes: Buffer, limit: number, label: string): unknown {
  if (bytes.length < 1 || bytes.length > limit)
    throw new Error(`npm release ${label} size is invalid.`);
  const text = bytes.toString("utf8");
  if (!Buffer.from(text).equals(bytes))
    throw new Error(`npm release ${label} must be valid UTF-8.`);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`npm release ${label} must be valid JSON.`);
  }
}

export function npmReleasePolicy(expected: NpmReleaseExpectation): NpmReleasePolicy {
  if (!["cli", "foundry"].includes(expected.package))
    throw new Error("Unsupported npm release package.");
  if (
    typeof expected.version !== "string" ||
    expected.version.length > 64 ||
    !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u.test(expected.version) ||
    expected.version.split(".").some((part) => BigInt(part) > BigInt(Number.MAX_SAFE_INTEGER))
  )
    throw new Error("npm release requires a stable canonical version.");
  if (!/^[0-9a-f]{40}$/u.test(expected.gitHead))
    throw new Error("npm release requires an exact source commit.");
  const foundry = expected.package === "foundry";
  return Object.freeze({
    name: `@tiangong-lca/${expected.package}`,
    repository: `https://github.com/${foundry ? FOUNDRY_RELEASE_REPOSITORY : "tiangong-lca/tiangong-cli"}`,
    workflow: foundry ? FOUNDRY_PUBLISH_WORKFLOW : ".github/workflows/publish.yml",
    refs: Object.freeze(
      foundry
        ? ["refs/heads/main", `refs/tags/foundry-v${expected.version}`]
        : [`refs/tags/cli-v${expected.version}`],
    ),
  });
}

function requireRegistryUrl(value: unknown, expectedPath: string): string {
  if (typeof value !== "string") throw new Error("npm release registry URL is missing.");
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("npm release registry URL is invalid.");
  }
  if (
    url.origin !== registry ||
    url.username ||
    url.password ||
    url.port ||
    url.search ||
    url.hash ||
    url.href !== value ||
    decodeURIComponent(url.pathname) !== expectedPath
  )
    throw new Error("npm release requires the exact uncredentialed public registry URL.");
  return value;
}

export function validateNpmReleaseMetadata(
  value: unknown,
  expected: NpmReleaseExpectation,
): NpmReleaseMetadata {
  const policy = npmReleasePolicy(expected);
  const metadata = record(value, "metadata");
  if (metadata.name !== policy.name || metadata.version !== expected.version)
    throw new Error("npm release metadata identity does not match the expected package.");
  if (metadata.gitHead !== undefined && metadata.gitHead !== expected.gitHead)
    throw new Error("npm release registry source commit mismatch.");
  const dist = record(metadata.dist, "dist metadata");
  const integrity = dist.integrity;
  if (typeof integrity !== "string" || !integrity.startsWith("sha512-"))
    throw new Error("npm release dist.integrity must use sha512.");
  const bytes = Buffer.from(integrity.slice(7), "base64");
  if (bytes.length !== 64 || `sha512-${bytes.toString("base64")}` !== integrity)
    throw new Error("npm release dist.integrity must contain canonical sha512 bytes.");
  const attestations = record(dist.attestations, "attestation metadata");
  if (record(attestations.provenance, "provenance metadata").predicateType !== predicateType)
    throw new Error("npm release requires SLSA provenance v1.");
  return Object.freeze({
    tarballUrl: requireRegistryUrl(
      dist.tarball,
      `/${policy.name}/-/${expected.package}-${expected.version}.tgz`,
    ),
    attestationUrl: requireRegistryUrl(
      attestations.url,
      `/-/npm/v1/attestations/${policy.name}@${expected.version}`,
    ),
    integrity,
    sha512: bytes.toString("hex"),
    registryGitHead: typeof metadata.gitHead === "string" ? metadata.gitHead : null,
  });
}

// Policy validation alone is not signature verification. The evidence verifier below
// calls this only after Sigstore returns a cryptographically verified signer identity.
export function validateNpmProvenanceStatement(
  value: unknown,
  expected: NpmReleaseExpectation,
  sha512: string,
  signerIdentity: string,
): NpmProvenanceBinding {
  const policy = npmReleasePolicy(expected);
  const statement = record(value, "provenance statement");
  if (
    statement._type !== "https://in-toto.io/Statement/v1" ||
    statement.predicateType !== predicateType
  )
    throw new Error("npm provenance statement type is invalid.");
  const subjects = statement.subject;
  if (!Array.isArray(subjects) || subjects.length !== 1)
    throw new Error("npm provenance must bind one exact package subject.");
  const subject = record(subjects[0], "provenance subject");
  if (
    subject.name !== `pkg:npm/%40tiangong-lca/${expected.package}@${expected.version}` ||
    record(subject.digest, "provenance digest").sha512 !== sha512 ||
    !/^[0-9a-f]{128}$/u.test(sha512)
  )
    throw new Error("npm provenance does not bind the expected package tarball.");
  const predicate = record(statement.predicate, "provenance predicate");
  const build = record(predicate.buildDefinition, "provenance build definition");
  if (build.buildType !== "https://slsa-framework.github.io/github-actions-buildtypes/workflow/v1")
    throw new Error("npm provenance build type must be GitHub Actions workflow v1.");
  const workflow = record(
    record(build.externalParameters, "provenance external parameters").workflow,
    "provenance workflow",
  );
  if (
    workflow.repository !== policy.repository ||
    workflow.path !== policy.workflow ||
    typeof workflow.ref !== "string" ||
    !policy.refs.includes(workflow.ref)
  )
    throw new Error("npm provenance does not bind the canonical publish workflow and ref.");
  const ref = workflow.ref;
  if (signerIdentity !== `${policy.repository}/${policy.workflow}@${ref}`)
    throw new Error("npm provenance signer identity does not match the signed workflow ref.");
  const github = record(
    record(build.internalParameters, "provenance internal parameters").github,
    "provenance GitHub parameters",
  );
  const events =
    expected.package === "foundry"
      ? [ref === "refs/heads/main" ? "push" : "workflow_dispatch"]
      : ["push", "workflow_dispatch"];
  if (typeof github.event_name !== "string" || !events.includes(github.event_name))
    throw new Error("npm provenance event cannot publish this package ref.");
  const dependencies = build.resolvedDependencies;
  if (!Array.isArray(dependencies) || dependencies.length !== 1)
    throw new Error("npm provenance requires one exact resolved source dependency.");
  const dependency = record(dependencies[0], "provenance source dependency");
  if (
    dependency.uri !== `git+${policy.repository}@${ref}` ||
    record(dependency.digest, "provenance source digest").gitCommit !== expected.gitHead
  )
    throw new Error("npm provenance source commit does not match the expected release.");
  const run = record(predicate.runDetails, "provenance run details");
  if (
    record(run.builder, "provenance builder").id !==
    "https://github.com/actions/runner/github-hosted"
  )
    throw new Error("npm provenance requires a GitHub-hosted builder.");
  const invocationId = record(run.metadata, "provenance run metadata").invocationId;
  const prefix = `${policy.repository}/actions/runs/`;
  if (
    typeof invocationId !== "string" ||
    !invocationId.startsWith(prefix) ||
    !/^[1-9]\d*\/attempts\/[1-9]\d*$/u.test(invocationId.slice(prefix.length))
  )
    throw new Error("npm provenance invocation must be a canonical exact GitHub run attempt.");
  return Object.freeze({ ref, invocationId, signerIdentity });
}

function requireProvenanceBundle(value: unknown): Buffer {
  const response = record(value, "attestation response");
  const attestations = response.attestations;
  if (!Array.isArray(attestations)) throw new Error("npm release provenance is missing.");
  const provenances = attestations.filter(
    (item: unknown) => record(item, "attestation").predicateType === predicateType,
  );
  if (provenances.length !== 1)
    throw new Error("npm release requires one unambiguous provenance bundle.");
  return Buffer.from(JSON.stringify(record(provenances[0], "provenance attestation").bundle));
}

function requireProvenanceEnvelope(value: unknown): { bundle: Bundle; payload: Buffer } {
  const bundle = record(value, "DSSE bundle");
  const envelope = record(bundle.dsseEnvelope, "DSSE envelope");
  if (
    envelope.payloadType !== "application/vnd.in-toto+json" ||
    typeof envelope.payload !== "string" ||
    !Array.isArray(envelope.signatures) ||
    envelope.signatures.length !== 1
  )
    throw new Error("npm release DSSE requires one signed in-toto payload.");
  const payload = Buffer.from(envelope.payload, "base64");
  if (!payload.length || payload.toString("base64") !== envelope.payload)
    throw new Error("npm release DSSE payload must use canonical base64.");
  // Sigstore owns complete bundle/protobuf, certificate and transparency-log validation.
  return { bundle: bundle as Bundle, payload };
}

/** Verifies a standalone CI-produced bundle; registry publication is a separate fact. */
export async function verifyNpmProvenanceBundle(
  bundleBytes: Buffer,
  expectation: NpmReleaseExpectation,
  sha512: string,
): Promise<NpmProvenanceBinding> {
  const expected = { ...expectation };
  const policy = npmReleasePolicy(expected);
  if (!/^[0-9a-f]{128}$/u.test(sha512))
    throw new Error("npm release provenance digest is invalid.");
  const { bundle, payload } = requireProvenanceEnvelope(
    parseJson(Buffer.from(bundleBytes), maxAttestationBytes, "provenance bundle"),
  );
  const identities = policy.refs.map((ref) => `${policy.repository}/${policy.workflow}@${ref}`);
  const expression = `^(?:${identities.map((identity) => identity.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")).join("|")})$`;
  const cache = fs.mkdtempSync(path.join(os.tmpdir(), "foundry-npm-trust-"));
  try {
    fs.chmodSync(cache, 0o700);
    const signer = await verifySigstore(bundle, {
      certificateIssuer: issuer,
      certificateIdentityURI: expression,
      ctLogThreshold: 1,
      tlogThreshold: 1,
      timeout: 30_000,
      retry: 2,
      tufCachePath: cache,
    });
    const signerIdentity = signer.identity?.subjectAlternativeName;
    if (typeof signerIdentity !== "string")
      throw new Error("npm release requires a verified certificate signer identity.");
    return validateNpmProvenanceStatement(
      parseJson(payload, maxAttestationBytes, "provenance"),
      expected,
      sha512,
      signerIdentity,
    );
  } finally {
    fs.rmSync(cache, { recursive: true, force: true });
  }
}

export async function verifyNpmReleaseEvidence(input: {
  readonly expected: NpmReleaseExpectation;
  readonly metadataBytes: Buffer;
  readonly tarballBytes: Buffer;
  readonly attestationBytes: Buffer;
}): Promise<VerifiedNpmRelease> {
  const expected = { ...input.expected };
  const policy = npmReleasePolicy(expected);
  const metadataBytes = Buffer.from(input.metadataBytes),
    tarballBytes = Buffer.from(input.tarballBytes),
    attestationBytes = Buffer.from(input.attestationBytes);
  const metadata = validateNpmReleaseMetadata(
    parseJson(metadataBytes, maxMetadataBytes, "metadata"),
    expected,
  );
  if (tarballBytes.length < 1 || tarballBytes.length > maxTarballBytes)
    throw new Error("npm release tarball size is invalid.");
  const actual = createHash("sha512").update(tarballBytes).digest();
  if (!timingSafeEqual(actual, Buffer.from(metadata.sha512, "hex")))
    throw new Error("npm release tarball integrity does not match registry metadata.");
  const bundleBytes = requireProvenanceBundle(
    parseJson(attestationBytes, maxAttestationBytes, "attestations"),
  );
  const binding = await verifyNpmProvenanceBundle(bundleBytes, expected, metadata.sha512);
  return Object.freeze({
    schema: "tiangong-foundry.verified-npm-release.v1",
    package: Object.freeze({ name: policy.name, version: expected.version }),
    source: Object.freeze({
      ...binding,
      repository: policy.repository,
      workflow: policy.workflow,
      gitCommit: expected.gitHead,
      registryGitHead: metadata.registryGitHead,
    }),
    tarball: Object.freeze({
      url: metadata.tarballUrl,
      bytes: tarballBytes.length,
      sha256: digest(tarballBytes),
      sha512: metadata.sha512,
      integrity: metadata.integrity,
    }),
    attestations: Object.freeze({
      url: metadata.attestationUrl,
      bytes: attestationBytes.length,
      sha256: digest(attestationBytes),
    }),
    metadata: Object.freeze({ bytes: metadataBytes.length, sha256: digest(metadataBytes) }),
  });
}

async function fetchPublicBytes(url: string, limit: number): Promise<Buffer> {
  const response = await fetch(url, {
    redirect: "error",
    signal: AbortSignal.timeout(30_000),
    headers: { accept: "application/json, application/octet-stream" },
  });
  if (!response.ok || !response.body) {
    await response.body?.cancel();
    throw new Error(`Public npm release download failed with HTTP ${response.status}.`);
  }
  const length = response.headers.get("content-length");
  if (length !== null && (!/^\d+$/u.test(length) || Number(length) > limit)) {
    await response.body.cancel();
    throw new Error("Public npm release download exceeds its byte bound.");
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      total += next.value.length;
      if (total > limit) throw new Error("Public npm release download exceeds its byte bound.");
      chunks.push(next.value);
    }
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
  return Buffer.concat(chunks, total);
}

export async function verifyPublicNpmRelease(expected: NpmReleaseExpectation): Promise<{
  readonly evidence: VerifiedNpmRelease;
  readonly metadataBytes: Buffer;
  readonly tarballBytes: Buffer;
  readonly attestationBytes: Buffer;
}> {
  const expectation = { ...expected };
  const policy = npmReleasePolicy(expectation);
  const metadataBytes = await fetchPublicBytes(
    `${registry}/${encodeURIComponent(policy.name)}/${expectation.version}`,
    maxMetadataBytes,
  );
  const metadata = validateNpmReleaseMetadata(
    parseJson(metadataBytes, maxMetadataBytes, "metadata"),
    expectation,
  );
  const [tarballBytes, attestationBytes] = await Promise.all([
    fetchPublicBytes(metadata.tarballUrl, maxTarballBytes),
    fetchPublicBytes(metadata.attestationUrl, maxAttestationBytes),
  ]);
  const evidence = await verifyNpmReleaseEvidence({
    expected: expectation,
    metadataBytes,
    tarballBytes,
    attestationBytes,
  });
  return Object.freeze({ evidence, metadataBytes, tarballBytes, attestationBytes });
}

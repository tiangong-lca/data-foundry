import { createHash } from "node:crypto";
import { attest } from "sigstore";
import {
  FOUNDRY_PUBLISH_WORKFLOW,
  FOUNDRY_RELEASE_REPOSITORY,
} from "./foundry-release-contract.ts";
import {
  assertFoundryGitHubOidcEnvironment,
  requestFoundryGitHubOidcToken,
} from "./foundry-release-oidc.ts";
import {
  npmReleasePolicy,
  validateNpmProvenanceStatement,
  verifyNpmProvenanceBundle,
} from "./foundry-release-provenance.ts";
import type { FoundryReleaseWorkflowContext } from "./foundry-release-workflow.ts";

function identifier(value: string | undefined): string {
  if (!value || value.length > 30 || !/^[1-9]\d*$/u.test(value))
    throw new Error("Foundry provenance requires exact GitHub identity and run identifiers.");
  return value;
}

export function assertFoundryNpmWorkflowEnvironment(
  context: FoundryReleaseWorkflowContext,
  environment: Readonly<NodeJS.ProcessEnv>,
): void {
  if (!context.release) throw new Error("Foundry provenance requires a release-only source.");
  const event = context.mode === "main-push" ? "push" : "workflow_dispatch";
  if (
    environment.GITHUB_JOB !== "npm-package" ||
    environment.RUNNER_ENVIRONMENT !== "github-hosted" ||
    environment.GITHUB_REPOSITORY !== FOUNDRY_RELEASE_REPOSITORY ||
    environment.GITHUB_SHA !== context.head ||
    environment.GITHUB_WORKFLOW_SHA !== context.head ||
    environment.GITHUB_REF !== context.ref ||
    environment.GITHUB_EVENT_NAME !== event ||
    environment.GITHUB_WORKFLOW_REF !==
      `${FOUNDRY_RELEASE_REPOSITORY}/${FOUNDRY_PUBLISH_WORKFLOW}@${context.ref}`
  )
    throw new Error(
      "Foundry provenance must describe the exact hosted npm-package workflow source.",
    );
  assertFoundryGitHubOidcEnvironment(environment);
  for (const value of [
    environment.GITHUB_REPOSITORY_ID,
    environment.GITHUB_REPOSITORY_OWNER_ID,
    environment.GITHUB_RUN_ID,
    environment.GITHUB_RUN_ATTEMPT,
  ])
    identifier(value);
}

export function buildFoundryNpmProvenance(
  context: FoundryReleaseWorkflowContext,
  sha512: string,
  environment: Readonly<NodeJS.ProcessEnv>,
) {
  if (!context.release) throw new Error("Foundry provenance requires a release-only source.");
  assertFoundryNpmWorkflowEnvironment(context, environment);
  const expected = { package: "foundry" as const, version: context.version, gitHead: context.head };
  const policy = npmReleasePolicy(expected);
  const event = context.mode === "main-push" ? "push" : "workflow_dispatch";
  if (!/^[0-9a-f]{128}$/u.test(sha512))
    throw new Error("Foundry provenance tarball digest is invalid.");
  const statement = {
    _type: "https://in-toto.io/Statement/v1",
    subject: [{ name: `pkg:npm/%40tiangong-lca/foundry@${context.version}`, digest: { sha512 } }],
    predicateType: "https://slsa.dev/provenance/v1",
    predicate: {
      buildDefinition: {
        buildType: "https://slsa-framework.github.io/github-actions-buildtypes/workflow/v1",
        externalParameters: {
          workflow: { ref: context.ref, repository: policy.repository, path: policy.workflow },
        },
        internalParameters: {
          github: {
            event_name: event,
            repository_id: identifier(environment.GITHUB_REPOSITORY_ID),
            repository_owner_id: identifier(environment.GITHUB_REPOSITORY_OWNER_ID),
          },
        },
        resolvedDependencies: [
          { uri: `git+${policy.repository}@${context.ref}`, digest: { gitCommit: context.head } },
        ],
      },
      runDetails: {
        builder: { id: "https://github.com/actions/runner/github-hosted" },
        metadata: {
          invocationId: `${policy.repository}/actions/runs/${identifier(environment.GITHUB_RUN_ID)}/attempts/${identifier(environment.GITHUB_RUN_ATTEMPT)}`,
        },
      },
    },
  };
  validateNpmProvenanceStatement(
    statement,
    expected,
    sha512,
    `${policy.repository}/${policy.workflow}@${context.ref}`,
  );
  return statement;
}

export async function signFoundryNpmArtifact(
  context: FoundryReleaseWorkflowContext,
  input: Buffer,
) {
  if (!context.release) throw new Error("Foundry provenance requires a release-only source.");
  if (!input.length || input.length > 64 * 1024 * 1024)
    throw new Error("Foundry provenance tarball size is invalid.");
  const tarballBytes = Buffer.from(input);
  const sha512 = createHash("sha512").update(tarballBytes).digest("hex");
  const sha256 = createHash("sha256").update(tarballBytes).digest("hex");
  const environment = { ...process.env };
  const expected = { package: "foundry" as const, version: context.version, gitHead: context.head };
  const statement = buildFoundryNpmProvenance(context, sha512, environment);
  const identityToken = await requestFoundryGitHubOidcToken(environment, "sigstore");
  const bundle = await attest(
    Buffer.from(JSON.stringify(statement)),
    "application/vnd.in-toto+json",
    { identityToken, timeout: 30_000, retry: 2 },
  );
  const bundleBytes = Buffer.from(`${JSON.stringify(bundle, null, 2)}\n`);
  const binding = await verifyNpmProvenanceBundle(bundleBytes, expected, sha512);
  return Object.freeze({ tarballBytes, bundleBytes, sha512, sha256, binding });
}

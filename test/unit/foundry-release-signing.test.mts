import assert from "node:assert/strict";
import test from "node:test";
import {
  buildFoundryNpmProvenance,
  signFoundryNpmArtifact,
} from "../../scripts/lib/foundry-release-signing.ts";
import { requestFoundryGitHubOidcToken } from "../../scripts/lib/foundry-release-oidc.ts";
import { validateNpmProvenanceStatement } from "../../scripts/lib/foundry-release-provenance.ts";
import type { FoundryReleaseWorkflowContext } from "../../scripts/lib/foundry-release-workflow.ts";

const head = "a".repeat(40),
  sha512 = "b".repeat(128);
const context: FoundryReleaseWorkflowContext = {
  schema: "tiangong-foundry.release-workflow-context.v1",
  release: true,
  currentVersion: "0.1.0",
  version: "0.1.1",
  tag: "foundry-v0.1.1",
  changedPaths: ["package.json"],
  mode: "main-push",
  ref: "refs/heads/main",
  base: "c".repeat(40),
  head,
  tree: "d".repeat(40),
};
function environment(): NodeJS.ProcessEnv {
  return {
    GITHUB_ACTIONS: "true",
    GITHUB_JOB: "npm-package",
    RUNNER_ENVIRONMENT: "github-hosted",
    GITHUB_REPOSITORY: "tiangong-lca/data-foundry",
    GITHUB_REF: "refs/heads/main",
    GITHUB_SHA: head,
    GITHUB_WORKFLOW_REF:
      "tiangong-lca/data-foundry/.github/workflows/publish-foundry.yml@refs/heads/main",
    GITHUB_WORKFLOW_SHA: head,
    GITHUB_EVENT_NAME: "push",
    GITHUB_REPOSITORY_ID: "123",
    GITHUB_REPOSITORY_OWNER_ID: "456",
    GITHUB_RUN_ID: "789",
    GITHUB_RUN_ATTEMPT: "1",
    ACTIONS_ID_TOKEN_REQUEST_URL:
      "https://pipelines.actions.githubusercontent.com/test/oidc?api-version=2.0",
    ACTIONS_ID_TOKEN_REQUEST_TOKEN: "unit-workflow-token",
  };
}

test("prepared npm provenance describes exact hosted source and package bytes", () => {
  const statement = buildFoundryNpmProvenance(context, sha512, environment());
  const result = validateNpmProvenanceStatement(
    statement,
    { package: "foundry", version: "0.1.1", gitHead: head },
    sha512,
    "https://github.com/tiangong-lca/data-foundry/.github/workflows/publish-foundry.yml@refs/heads/main",
  );
  assert.equal(
    result.invocationId,
    "https://github.com/tiangong-lca/data-foundry/actions/runs/789/attempts/1",
  );
  assert.equal(statement.predicate.buildDefinition.internalParameters.github.repository_id, "123");
});

test("provenance preparation rejects alternate jobs, identities, hosts and static token input", () => {
  for (const change of [
    { GITHUB_JOB: "quality-gate" },
    { RUNNER_ENVIRONMENT: "self-hosted" },
    { GITHUB_SHA: "c".repeat(40) },
    { GITHUB_WORKFLOW_SHA: "c".repeat(40) },
    { GITHUB_REPOSITORY: "other/data-foundry" },
    { GITHUB_RUN_ID: "../other" },
    { GITHUB_RUN_ATTEMPT: "0" },
    { GITHUB_REPOSITORY_ID: "unknown" },
    { SIGSTORE_ID_TOKEN: "not-a-workflow-token" },
    { ACTIONS_ID_TOKEN_REQUEST_TOKEN: "" },
  ])
    assert.throws(
      () => buildFoundryNpmProvenance(context, sha512, { ...environment(), ...change }),
      /provenance|OIDC/iu,
    );
  assert.throws(() => buildFoundryNpmProvenance(context, "invalid", environment()), /digest/iu);
  assert.throws(
    () => buildFoundryNpmProvenance({ ...context, release: false }, sha512, environment()),
    /release/iu,
  );
});

test("exact-tag recovery retains its own workflow ref in the prepared provenance", () => {
  const ref = "refs/tags/foundry-v0.1.1";
  const value = buildFoundryNpmProvenance({ ...context, mode: "tag-recovery", ref }, sha512, {
    ...environment(),
    GITHUB_REF: ref,
    GITHUB_EVENT_NAME: "workflow_dispatch",
    GITHUB_WORKFLOW_REF: `tiangong-lca/data-foundry/.github/workflows/publish-foundry.yml@${ref}`,
  });
  assert.equal(value.predicate.buildDefinition.externalParameters.workflow.ref, ref);
  assert.equal(
    value.predicate.buildDefinition.internalParameters.github.event_name,
    "workflow_dispatch",
  );
});

test("OIDC requests only the fixed audience through the authenticated Actions endpoint", async () => {
  const token = await requestFoundryGitHubOidcToken(
    environment(),
    "sigstore",
    async (url, init) => {
      const parsed = new URL(url);
      assert.equal(parsed.hostname, "pipelines.actions.githubusercontent.com");
      assert.deepEqual(parsed.searchParams.getAll("audience"), ["sigstore"]);
      assert.equal(init.redirect, "error");
      assert.equal(new Headers(init.headers).get("authorization"), "Bearer unit-workflow-token");
      return Response.json({ value: "unit.fixture.token" });
    },
  );
  assert.equal(token, "unit.fixture.token");
});

test("OIDC rejects alternate endpoints, malformed responses and missing permission without fallback", async () => {
  let calls = 0;
  const unused = async () => {
    calls++;
    return Response.json({ value: "unit.fixture.token" });
  };
  for (const url of [
    "http://pipelines.actions.githubusercontent.com/test",
    "https://actions.githubusercontent.com.evil.invalid/test",
    "https://secret@pipelines.actions.githubusercontent.com/test",
  ])
    await assert.rejects(
      requestFoundryGitHubOidcToken(
        { ...environment(), ACTIONS_ID_TOKEN_REQUEST_URL: url },
        "sigstore",
        unused,
      ),
      /OIDC/iu,
    );
  assert.equal(calls, 0);
  await assert.rejects(
    requestFoundryGitHubOidcToken(environment(), "sigstore", async () =>
      Response.json({ value: "bad-token" }),
    ),
    /OIDC/iu,
  );
  await assert.rejects(
    requestFoundryGitHubOidcToken(
      environment(),
      "sigstore",
      async () => new Response("private body", { status: 403 }),
    ),
    /HTTP 403/u,
  );
  await assert.rejects(
    requestFoundryGitHubOidcToken(
      environment(),
      "sigstore",
      async () => new Response("sensitive malformed body"),
    ),
    (error: unknown) =>
      error instanceof Error && !error.message.includes("sensitive") && /OIDC/u.test(error.message),
  );
  await assert.rejects(
    requestFoundryGitHubOidcToken(
      environment(),
      "sigstore",
      async () =>
        new Response(
          Buffer.concat([
            Buffer.from('{"value":"unit.fixture.token","note":"'),
            Buffer.from([0xff]),
            Buffer.from('"}'),
          ]),
        ),
    ),
    /OIDC.*UTF-8/u,
  );
});

test("the signing entry cannot start outside the owning workflow", async () => {
  await assert.rejects(
    signFoundryNpmArtifact(context, Buffer.from("local fixture")),
    /provenance|OIDC/iu,
  );
});

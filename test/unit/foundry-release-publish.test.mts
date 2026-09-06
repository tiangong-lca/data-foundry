import assert from "node:assert/strict";
import test from "node:test";
import {
  inspectFoundryNpmAvailability,
  exchangeFoundryNpmOidcToken,
  foundryNpmPublishEnvironment,
  publishOnceAndReadBack,
} from "../../scripts/lib/foundry-release-publish.ts";
import type { FoundryReleaseWorkflowContext } from "../../scripts/lib/foundry-release-workflow.ts";

const head = "a".repeat(40);
const context: FoundryReleaseWorkflowContext = {
  schema: "tiangong-foundry.release-workflow-context.v1",
  release: true,
  currentVersion: "0.1.0",
  version: "0.1.1",
  tag: "foundry-v0.1.1",
  changedPaths: ["package.json"],
  mode: "main-push",
  ref: "refs/heads/main",
  base: "b".repeat(40),
  head,
  tree: "c".repeat(40),
};
const now = Date.parse("2026-09-06T08:00:00Z");
function environment(): NodeJS.ProcessEnv {
  return {
    GITHUB_ACTIONS: "true",
    GITHUB_JOB: "npm-package",
    RUNNER_ENVIRONMENT: "github-hosted",
    GITHUB_REPOSITORY: "tiangong-lca/data-foundry",
    GITHUB_REF: "refs/heads/main",
    GITHUB_SHA: head,
    GITHUB_WORKFLOW_SHA: head,
    GITHUB_EVENT_NAME: "push",
    GITHUB_WORKFLOW_REF:
      "tiangong-lca/data-foundry/.github/workflows/publish-foundry.yml@refs/heads/main",
    GITHUB_REPOSITORY_ID: "123",
    GITHUB_REPOSITORY_OWNER_ID: "456",
    GITHUB_RUN_ID: "789",
    GITHUB_RUN_ATTEMPT: "1",
    ACTIONS_ID_TOKEN_REQUEST_URL: "https://pipelines.actions.githubusercontent.com/test/oidc",
    ACTIONS_ID_TOKEN_REQUEST_TOKEN: "unit-workflow-token",
  };
}

test("registry preflight distinguishes an existing version, a new version and first-package setup", async () => {
  for (const variant of [
    "version-exists",
    "version-available",
    "first-package-identity",
  ] as const) {
    const calls: string[] = [];
    const actual = await inspectFoundryNpmAvailability("0.1.1", async (url, init) => {
      calls.push(url);
      assert.equal(init.redirect, "error");
      assert.equal(new Headers(init.headers).has("authorization"), false);
      if (url.endsWith("/0.1.1"))
        return Response.json({}, { status: variant === "version-exists" ? 200 : 404 });
      return Response.json(
        { name: "@tiangong-lca/foundry" },
        { status: variant === "version-available" ? 200 : 404 },
      );
    });
    assert.equal(actual, variant);
    assert.equal(calls.length, variant === "version-exists" ? 1 : 2);
    assert(
      calls.every((url) => url.startsWith("https://registry.npmjs.org/%40tiangong-lca%2Ffoundry")),
    );
  }
  await assert.rejects(inspectFoundryNpmAvailability("../latest"), /version/u);
  await assert.rejects(
    inspectFoundryNpmAvailability("0.1.1", async () => new Response(null, { status: 503 })),
    /HTTP 503/u,
  );
});

test("npm exchange requires the owning workflow and returns only a fresh package-specific OIDC credential", async () => {
  const calls: string[] = [];
  const result = await exchangeFoundryNpmOidcToken(
    context,
    environment(),
    async (url, init) => {
      calls.push(url);
      if (calls.length === 1) {
        assert.equal(new URL(url).searchParams.get("audience"), "npm:registry.npmjs.org");
        return Response.json({ value: "unit.fixture.jwt" });
      }
      assert.equal(
        url,
        "https://registry.npmjs.org/-/npm/v1/oidc/token/exchange/package/%40tiangong-lca%2Ffoundry",
      );
      assert.equal(init.method, "POST");
      assert.equal(init.redirect, "error");
      assert.equal(new Headers(init.headers).get("authorization"), "Bearer unit.fixture.jwt");
      return Response.json(
        {
          token_type: "oidc",
          token: "unit-short-lived-token",
          created: new Date(now).toISOString(),
          expires: new Date(now + 3600000).toISOString(),
        },
        { status: 201 },
      );
    },
    now,
  );
  assert.equal(result.token, "unit-short-lived-token");
  assert.equal(calls.length, 2);
  await assert.rejects(
    exchangeFoundryNpmOidcToken(context, { ...environment(), GITHUB_JOB: "quality-gate" }),
    /workflow/u,
  );
});

test("a release cannot move the public latest tag to an older stable version", async () => {
  await assert.rejects(
    inspectFoundryNpmAvailability("0.1.1", async (url) =>
      url.endsWith("/0.1.1")
        ? Response.json({}, { status: 404 })
        : Response.json({ name: "@tiangong-lca/foundry", "dist-tags": { latest: "0.2.0" } }),
    ),
    /latest/u,
  );
});

test("failed or malformed OIDC exchange has no credential fallback or request replay", async () => {
  for (const response of [
    new Response("private-response-body", { status: 401 }),
    Response.json({ token_type: "automation", token: "private-token" }, { status: 201 }),
    Response.json(
      {
        token_type: "oidc",
        token: "private-token",
        created: new Date(now - 86400000).toISOString(),
        expires: new Date(now - 1000).toISOString(),
      },
      { status: 201 },
    ),
    new Response("private-invalid-json", { status: 201 }),
  ]) {
    let requests = 0;
    await assert.rejects(
      exchangeFoundryNpmOidcToken(
        context,
        environment(),
        async () => {
          requests++;
          return requests === 1 ? Response.json({ value: "unit.fixture.jwt" }) : response;
        },
        now,
      ),
      (error: unknown) =>
        error instanceof Error && /OIDC/u.test(error.message) && !error.message.includes("private"),
    );
    assert.equal(requests, 2);
  }
});

test("publisher child environment contains only selected process settings and the new short-lived credential", () => {
  const value = foundryNpmPublishEnvironment(
    {
      PATH: "/unit/tools",
      HOME: "/unit/home",
      NODE_OPTIONS: "--import untrusted",
      NPM_TOKEN: "unrelated-account",
      NODE_AUTH_TOKEN: "unrelated-auth",
      GITHUB_TOKEN: "unrelated-github",
      ...environment(),
      npm_config_registry: "https://elsewhere.invalid",
      npm_config_userconfig: "untrusted.npmrc",
    },
    "/unit/user.npmrc",
    "/unit/global.npmrc",
    "unit-exchanged-token",
  );
  assert.equal(value.PATH, "/unit/tools");
  assert.equal(value.NODE_AUTH_TOKEN, "unit-exchanged-token");
  assert.equal(value.NPM_CONFIG_USERCONFIG, "/unit/user.npmrc");
  for (const key of [
    "NODE_OPTIONS",
    "NPM_TOKEN",
    "GITHUB_TOKEN",
    "GITHUB_ACTIONS",
    "ACTIONS_ID_TOKEN_REQUEST_TOKEN",
    "npm_config_registry",
  ])
    assert.equal(value[key], undefined);
});

test("one publish attempt is followed by readback even when its response was lost", async () => {
  for (const fails of [false, true]) {
    const calls: string[] = [];
    const result = await publishOnceAndReadBack(
      async () => {
        calls.push("publish");
        if (fails) throw new Error("lost response");
      },
      async () => {
        calls.push("readback");
        return "unit-readback-result";
      },
    );
    assert.deepEqual(calls, ["publish", "readback"]);
    assert.equal(result.evidence, "unit-readback-result");
    assert.equal(result.transport, fails ? "uncertain" : "reported-success");
  }
});

test("readback failure never replays publication or becomes a successful result", async () => {
  let writes = 0;
  await assert.rejects(
    publishOnceAndReadBack(
      async () => {
        writes++;
      },
      async () => {
        throw new Error("public evidence disagrees");
      },
    ),
    /public evidence/u,
  );
  assert.equal(writes, 1);
});

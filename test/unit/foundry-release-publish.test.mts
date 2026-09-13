import assert from "node:assert/strict";
import test from "node:test";
import {
  preflightFoundryNpmOidcExchange,
  inspectFoundryNpmAvailability,
  exchangeFoundryNpmOidcToken,
  foundryNpmPublishEnvironment,
  publishOnceAndReadBack,
  inspectFoundryNpmOidcResponse,
  diagnoseFoundryNpmOidcExchange,
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
    GITHUB_REPOSITORY: "tiangong-lca/foundry",
    GITHUB_REF: "refs/heads/main",
    GITHUB_SHA: head,
    GITHUB_WORKFLOW_SHA: head,
    GITHUB_EVENT_NAME: "push",
    GITHUB_WORKFLOW_REF:
      "tiangong-lca/foundry/.github/workflows/publish-foundry.yml@refs/heads/main",
    GITHUB_REPOSITORY_ID: "1260957221",
    GITHUB_REPOSITORY_OWNER_ID: "327771381",
    GITHUB_RUN_ID: "789",
    GITHUB_RUN_ATTEMPT: "1",
    ACTIONS_ID_TOKEN_REQUEST_URL: "https://pipelines.actions.githubusercontent.com/test/oidc",
    ACTIONS_ID_TOKEN_REQUEST_TOKEN: "unit-workflow-token",
  };
}

test("OIDC diagnostics identify rejected fields without retaining response values", () => {
  const valid = {
    token_type: "oidc",
    token: "private-credential",
    created: new Date(now).toISOString(),
    expires: new Date(now + 3600000).toISOString(),
  };
  assert.equal(inspectFoundryNpmOidcResponse(valid, now).accepted, true);
  for (const [field, value, reason] of [
    ["token_type", "private-type", "token_type"],
    ["token", "private credential", "token_shape"],
    ["created", false, "created_time"],
    ["expires", "private-invalid-date", "expires_time"],
    ["created", new Date(now - 600000).toISOString(), "created_freshness"],
    ["expires", new Date(now + 30000).toISOString(), "remaining_lifetime"],
    ["expires", new Date(now + 10800000).toISOString(), "maximum_lifetime"],
  ] as const) {
    const result = inspectFoundryNpmOidcResponse(
      { ...valid, [field]: value, extra: "private-extra" },
      now,
    );
    assert.equal(result.accepted, false);
    assert.ok(result.reasons.includes(reason));
    assert.doesNotMatch(JSON.stringify(result), /private/u);
  }
});

test("the publisher accepts fresh numeric epoch timestamps returned by the real registry", async () => {
  for (const scale of [1, 1000])
    for (const offset of [0, 123]) {
      let requests = 0;
      const result = await exchangeFoundryNpmOidcToken(
        context,
        environment(),
        async () => {
          requests++;
          return requests === 1
            ? Response.json({ value: "unit.fixture.jwt" })
            : Response.json(
                {
                  token_type: "oidc",
                  token: "private-credential",
                  created: (now + offset) / scale,
                  expires: (now + 3600000 + offset) / scale,
                },
                { status: 201 },
              );
        },
        now,
      );
      assert.equal(requests, 2);
      assert.equal(result.expiresAt, now + 3600000 + offset);
    }
});

test("numeric OIDC timestamps keep the original freshness and lifetime bounds", () => {
  for (const scale of [1, 1000])
    for (const [created, expires] of [
      [now - 600000, now + 3600000],
      [now + 600000, now + 3600000],
      [now, now - 1000],
      [now, now + 30000],
      [now, now + 10800000],
      [NaN, now + 3600000],
      [now, Infinity],
      [Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER],
    ]) {
      const result = inspectFoundryNpmOidcResponse(
        {
          token_type: "oidc",
          token: "private-credential",
          created: created / scale,
          expires: expires / scale,
        },
        now,
      );
      assert.equal(result.accepted, false);
      assert.doesNotMatch(JSON.stringify(result), /private/u);
    }
});

test("the explicit CI diagnostic discards the exchanged credential and never invokes publication", async () => {
  const env = {
    ...environment(),
    GITHUB_JOB: "diagnose-npm-oidc",
    GITHUB_EVENT_NAME: "workflow_dispatch",
  };
  let calls = 0;
  const fetchImpl = async () => {
    calls++;
    return calls === 1
      ? Response.json({ value: "private.fixture.jwt" })
      : Response.json(
          {
            token_type: "oidc",
            token: "private-credential",
            created: 123,
            expires: "private-date",
          },
          { status: 201 },
        );
  };
  const result = await diagnoseFoundryNpmOidcExchange(env, fetchImpl, now);
  assert.equal(calls, 2);
  assert.equal(result.accepted, false);
  assert.ok("created_kind" in result);
  assert.equal(result.created_kind, "number");
  assert.doesNotMatch(JSON.stringify(result), /private/u);
  for (const override of [
    { GITHUB_JOB: "npm-package" },
    { GITHUB_EVENT_NAME: "push" },
    { GITHUB_REPOSITORY: "other/repo" },
    { RUNNER_ENVIRONMENT: "self-hosted" },
    { GITHUB_WORKFLOW_SHA: "b".repeat(40) },
  ])
    await assert.rejects(
      diagnoseFoundryNpmOidcExchange({ ...env, ...override }, fetchImpl, now),
      /diagnostic/u,
    );
  assert.equal(calls, 2);
});

test("OIDC diagnostics identify failed transport stages without exposing upstream errors", async () => {
  const env = {
    ...environment(),
    GITHUB_JOB: "diagnose-npm-oidc",
    GITHUB_EVENT_NAME: "workflow_dispatch",
  };
  for (const failure of ["github-network", "github-http", "npm-network", "npm-http", "npm-json"]) {
    let calls = 0;
    const result = await diagnoseFoundryNpmOidcExchange(
      env,
      async () => {
        calls++;
        if (calls === 1) {
          if (failure === "github-network") throw new Error("private-request-token");
          if (failure === "github-http") return new Response("private-response", { status: 401 });
          return Response.json({ value: "private.fixture.jwt" });
        }
        if (failure === "npm-network") throw new Error("private-registry-token");
        if (failure === "npm-http") return new Response("private-registry-body", { status: 404 });
        return new Response("private-not-json", { status: 201 });
      },
      now,
    );
    assert.equal(result.accepted, false);
    assert.ok("failure_stage" in result);
    assert.equal(
      result.failure_stage,
      failure.startsWith("github")
        ? "github-oidc"
        : failure === "npm-json"
          ? "npm-response"
          : "npm-exchange",
    );
    assert.equal(
      result.http_status,
      failure === "github-http"
        ? 401
        : failure === "npm-http"
          ? 404
          : failure === "npm-json"
            ? 201
            : null,
    );
    assert.equal(calls, failure.startsWith("github") ? 1 : 2);
    assert.doesNotMatch(JSON.stringify(result), /private|Bearer|https:/u);
  }
});

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

test("registry preflight negotiates version JSON separately from abbreviated package metadata", async () => {
  const base = "https://registry.npmjs.org/%40tiangong-lca%2Ffoundry";
  const calls: { url: string; accept: string | null }[] = [];
  const registryFetch = async (url: string, init: RequestInit) => {
    const accept = new Headers(init.headers).get("accept");
    calls.push({ url, accept });
    assert.equal(init.method, "GET");
    assert.equal(init.redirect, "error");
    assert.equal(new Headers(init.headers).has("authorization"), false);
    if (url === `${base}/0.1.2`)
      return Response.json({}, { status: accept === "application/json" ? 200 : 406 });
    if (url === `${base}/0.1.3`) {
      assert.equal(accept, "application/json");
      return Response.json({}, { status: 404 });
    }
    assert.equal(url, base);
    assert.equal(accept, "application/vnd.npm.install-v1+json");
    return Response.json({
      name: "@tiangong-lca/foundry",
      "dist-tags": { latest: "0.1.2" },
    });
  };

  assert.equal(await inspectFoundryNpmAvailability("0.1.2", registryFetch), "version-exists");
  assert.equal(calls.length, 1);
  assert.equal(await inspectFoundryNpmAvailability("0.1.3", registryFetch), "version-available");
  assert.deepEqual(
    calls.map(({ url }) => url),
    [`${base}/0.1.2`, `${base}/0.1.3`, base],
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

test("preflight exchanges a real credential but returns only redacted facts and cannot sign or publish", async () => {
  let requests = 0;
  const fetch = async () =>
    ++requests === 1
      ? Response.json({ value: "unit.fixture.jwt" })
      : Response.json(
          {
            token_type: "oidc",
            token: "private-credential",
            created: now,
            expires: now + 3600000,
          },
          { status: 201 },
        );
  const env = { ...environment(), GITHUB_JOB: "release-preflight" };
  const report = await preflightFoundryNpmOidcExchange(context, env, fetch, now);
  assert.equal(report.accepted, true);
  assert.equal(requests, 2);
  assert.doesNotMatch(JSON.stringify(report), /private-credential/u);
  await assert.rejects(exchangeFoundryNpmOidcToken(context, env, fetch, now));
  await assert.rejects(preflightFoundryNpmOidcExchange(context, environment(), fetch, now));
  assert.equal(requests, 2);
});

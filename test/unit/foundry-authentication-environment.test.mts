import assert from "node:assert/strict";
import test from "node:test";
import { createFoundryAuthenticationEnvironment } from "../../scripts/lib/foundry-authentication-environment.ts";

test("authentication environment retains only explicit credentials and required system keys", () => {
  const inherited = {
    PATH: "/system/bin",
    HOME: "/test/home",
    NODE_OPTIONS: "--untrusted",
    TIANGONG_LCA_ACCESS_TOKEN: "ambient-secret",
    TIANGONG_LCA_CLI_BIN: "/untrusted-cli",
    BAFU_IDENTITY_PREFLIGHT_RESULT_CACHE: "/untrusted-cache",
  };
  const oauth = createFoundryAuthenticationEnvironment(
    { mode: "oauth", configuration: { apiBaseUrl: "https://example.invalid" } },
    null,
    inherited,
  );
  assert.equal(oauth.PATH, inherited.PATH);
  assert.equal(oauth.HOME, inherited.HOME);
  assert.equal(oauth.TIANGONG_LCA_API_BASE_URL, "https://example.invalid");
  assert.equal(oauth.TIANGONG_LCA_AUTH_MODE, "oauth");
  for (const key of [
    "NODE_OPTIONS",
    "TIANGONG_LCA_ACCESS_TOKEN",
    "TIANGONG_LCA_CLI_BIN",
    "BAFU_IDENTITY_PREFLIGHT_RESULT_CACHE",
  ])
    assert.equal(oauth[key], undefined);
  const headless = createFoundryAuthenticationEnvironment(
    {
      mode: "headless",
      accessToken: "explicit-test-token",
      apiBaseUrl: "https://example.invalid",
      publishableKey: "public-test-key",
    },
    null,
    inherited,
  );
  assert.equal(headless.TIANGONG_LCA_ACCESS_TOKEN, "explicit-test-token");
  assert.equal(headless.TIANGONG_LCA_DISABLE_SESSION_CACHE, "true");
  assert.equal(headless.TIANGONG_LCA_AUTH_MODE, "access_token");
  assert.equal(inherited.TIANGONG_LCA_ACCESS_TOKEN, "ambient-secret");
  assert.throws(() =>
    createFoundryAuthenticationEnvironment(
      { mode: "headless", accessToken: "", apiBaseUrl: "", publishableKey: "" },
      null,
      inherited,
    ),
  );
});

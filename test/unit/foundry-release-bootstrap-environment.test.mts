import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import test from "node:test";
import { createFoundryBootstrapEnvironment } from "../../scripts/lib/foundry-release-bootstrap-qualification.ts";

test("copied bootstrap cannot inherit account credentials, Node hooks or execution-policy overrides", () => {
  const keys = [
    "GITHUB_TOKEN",
    "GH_TOKEN",
    "TIANGONG_LCA_ACCESS_TOKEN",
    "TIANGONG_LCA_SESSION_FILE",
    "NODE_OPTIONS",
    "NPM_CONFIG_USERCONFIG",
    "PSExecutionPolicyPreference",
    "HTTPS_PROXY",
    "PATH",
  ];
  const prior = new Map(keys.map((key) => [key, process.env[key]]));
  try {
    for (const key of keys) process.env[key] = "must-not-enter-child";
    const home = path.join(os.tmpdir(), "isolated-bootstrap-home"),
      temp = path.join(os.tmpdir(), "isolated-bootstrap-temp");
    const environment = createFoundryBootstrapEnvironment(home, temp);
    for (const key of keys.filter((key) => key !== "PATH"))
      assert.equal(environment[key], undefined, key);
    assert.equal(environment.HOME, home);
    assert.equal(environment.USERPROFILE, home);
    assert.equal(environment.TMPDIR, temp);
    assert.notEqual(environment.PATH, process.env.PATH);
  } finally {
    for (const [key, value] of prior) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

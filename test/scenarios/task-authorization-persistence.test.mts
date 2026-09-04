import assert from "node:assert/strict";
import childProcess from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createFoundryRuntime } from "../../scripts/foundry-runtime.ts";
import {
  captureFoundryInput,
  createFoundryRuntimeContext,
  initializeFoundryWorkspace,
} from "../../scripts/lib/foundry-runtime-context.ts";
import {
  assertVerifiedFoundryIdentity,
  verifyFoundryRuntimeIdentity,
} from "../../scripts/lib/foundry-runtime-identity.ts";
import { taskAuthorizationAllows } from "../../scripts/lib/task-authorization.ts";
import { sha256Json } from "../../scripts/lib/identity-preflight-proof.ts";
import { testAuthIdentityReceipt } from "../fixtures/auth-identity-receipt.ts";

const moduleUrl = new URL("../../scripts/runtime-entry.ts", import.meta.url).href;
const accountIntent = {
  projectRef: "aaaaaaaaaaaaaaaaaaaa",
  userId: "11111111-1111-4111-8111-111111111111",
};
const hasCode = (code: string) => (error: unknown) =>
  Boolean(error && typeof error === "object" && "code" in error && error.code === code);

test("persisted authorization requires fresh identity and independently bound evidence", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "foundry-approval-persistence-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const input = path.join(root, "input.jsonl");
  fs.writeFileSync(input, '{"flowDataSet":{}}\n');
  const options = {
    moduleUrl,
    workspace: path.join(root, "project"),
    cacheBase: path.join(root, "cache"),
  };
  initializeFoundryWorkspace(createFoundryRuntimeContext(options));
  const context = createFoundryRuntimeContext({
    ...options,
    accountIntent,
    taskId: "task",
    actorId: "agent",
    inputs: [captureFoundryInput(input)],
  });
  const runtime = createFoundryRuntime(context);
  await runtime.cleanup({ input, type: "flow" });
  const receipt = testAuthIdentityReceipt({
    projectRef: accountIntent.projectRef,
    userId: accountIntent.userId,
  });
  let identityCwd = "";
  t.mock.method(
    childProcess,
    "spawnSync",
    (
      _executable: unknown,
      argv: unknown,
      options: { cwd: string; env: NodeJS.ProcessEnv; shell: boolean },
    ) => {
      identityCwd = options.cwd;
      assert.equal(options.shell, false);
      assert.equal(fs.existsSync(path.join(options.cwd, ".env")), false);
      assert.equal(options.env.TIANGONG_LCA_PASSWORD, undefined);
      assert.equal(options.env.GITHUB_TOKEN, undefined);
      assert.equal(options.env.NODE_OPTIONS, undefined);
      assert.ok(Array.isArray(argv) && argv.includes("identity-receipt"));
      return { status: 0, signal: null, stdout: JSON.stringify(receipt), stderr: "" };
    },
  );
  const identity = verifyFoundryRuntimeIdentity(
    context,
    { mode: "oauth" },
    {
      PATH: process.env.PATH,
      TIANGONG_LCA_PASSWORD: "never-forward",
      GITHUB_TOKEN: "never-forward",
      NODE_OPTIONS: "never-forward",
    },
  );
  assert.equal(fs.existsSync(identityCwd), false);
  assert.throws(
    () => assertVerifiedFoundryIdentity(context, JSON.parse(JSON.stringify(identity))),
    hasCode("identity_context_mismatch"),
  );
  const evidencePath = path.join(root, "approval.txt");
  fs.writeFileSync(
    evidencePath,
    "Explicit synthetic fixture approval for the selected task scope.\n",
  );
  const evidence = captureFoundryInput(evidencePath);
  const profileLock = JSON.parse(
    fs.readFileSync(path.join(context.taskRoot!, "profile-lock.json"), "utf8"),
  );
  const now = Date.now();
  const grant = {
    schema: "tiangong-foundry.task-authorization.v1",
    binding: {
      workspace_id: context.workspaceId,
      task_id: context.taskId,
      actor_id: context.actorId,
      project_ref: accountIntent.projectRef,
      user_id: accountIntent.userId,
      profile_id: "generic",
      profile_sha256: profileLock.profile_sha256,
      input_scope_sha256: context.inputs[0].sha256,
    },
    issued_at_utc: new Date(now).toISOString(),
    expires_at_utc: new Date(now + 60_000).toISOString(),
    remote_state_code: 0,
    allowed_actions: ["unitgroup_write"],
    qa_waivers: [],
    evidence: [
      { id: "approval", kind: "user-decision", reference: evidence.path, sha256: evidence.sha256 },
    ],
  };
  await assert.rejects(
    () => runtime.registerAuthorization(identity, { inputFile: input, grant, evidence: [] }),
    hasCode("authorization_evidence_invalid"),
  );
  const selected = [{ id: "approval", kind: "user-decision" as const, file: evidence }];
  const approved = await runtime.registerAuthorization(identity, {
    inputFile: input,
    grant,
    evidence: selected,
  });
  assert.equal(approved.authorization_sha256, sha256Json(grant));
  const loaded = await runtime.loadAuthorization(identity, input);
  assert.equal(taskAuthorizationAllows(loaded, "unitgroup_write"), true);
  assert.equal(taskAuthorizationAllows(loaded, "flowproperty_write"), false);
  assert.deepEqual(
    await runtime.registerAuthorization(identity, { inputFile: input, grant, evidence: selected }),
    approved,
  );
  fs.writeFileSync(evidence.path, "changed approval");
  await assert.rejects(
    () => runtime.loadAuthorization(identity, input),
    hasCode("authorization_evidence_changed"),
  );
});

test("headless identity uses only the existing process token mode and never serializes the token", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "foundry-headless-identity-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const options = {
    moduleUrl,
    workspace: path.join(root, "project"),
    cacheBase: path.join(root, "cache"),
  };
  initializeFoundryWorkspace(createFoundryRuntimeContext(options));
  const context = createFoundryRuntimeContext({
    ...options,
    taskId: "task",
    actorId: "headless-agent",
    accountIntent,
  });
  const token = "unit-test-process-token";
  const receipt = testAuthIdentityReceipt({
    projectRef: accountIntent.projectRef,
    userId: accountIntent.userId,
    scopeOverrides: {
      session: {
        source: "access_token",
        cache_mode: "disabled",
        force_reauth: false,
        expires_at_utc: null,
      },
    },
  });
  let childEnvironment: NodeJS.ProcessEnv | undefined;
  t.mock.method(
    childProcess,
    "spawnSync",
    (_executable: unknown, argv: string[], options: { env: NodeJS.ProcessEnv }) => {
      assert.equal(argv.includes(token), false);
      if (options.env.TIANGONG_LCA_AUTH_MODE === "access_token")
        assert.equal(options.env.TIANGONG_LCA_ACCESS_TOKEN, token);
      else assert.equal(options.env.TIANGONG_LCA_ACCESS_TOKEN, undefined);
      assert.equal(options.env.TIANGONG_LCA_SESSION_FILE, undefined);
      assert.equal(
        options.env.TIANGONG_LCA_DISABLE_SESSION_CACHE,
        options.env.TIANGONG_LCA_AUTH_MODE === "access_token" ? "true" : "false",
      );
      childEnvironment = options.env;
      return { status: 0, signal: null, stdout: JSON.stringify(receipt), stderr: "" };
    },
  );
  const identity = verifyFoundryRuntimeIdentity(context, {
    mode: "headless",
    accessToken: token,
    apiBaseUrl: "https://aaaaaaaaaaaaaaaaaaaa.supabase.co",
    publishableKey: "fixture-public-key",
  });
  assert.equal(JSON.stringify(identity).includes(token), false);
  assert.equal(childEnvironment?.TIANGONG_LCA_ACCESS_TOKEN, undefined);
  assertVerifiedFoundryIdentity(context, identity);
  assert.throws(
    () => verifyFoundryRuntimeIdentity(context, { mode: "oauth" }),
    hasCode("identity_receipt_invalid"),
  );
});

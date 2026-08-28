import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

import {
  createIdentityPreflightBinding,
  parseFreshIntentBoundAuthReceipt,
  sha256Text,
  validateBoundExecutionManifest,
  validateIdentityPreflightEvidence,
  validateIdentityPreflightExecution,
} from "../../scripts/lib/identity-preflight-proof.ts";

const require = createRequire(import.meta.url);
const cliAuth = require("@tiangong-lca/cli/dist/src/lib/auth-identity-receipt.js") as {
  __testInternals: {
    requestFingerprint(projectRef: string): string;
    responseFingerprint(input: {
      projectRef: string;
      userId: string;
      displayEmail: string;
    }): string;
    sha256Json(value: unknown): string;
  };
};

const PROJECT_REF = "qgzvkongdjqiiamzbbts";
const USER_ID = "c536ee37-64ab-427b-b7e3-4e2bb4fdffb7";
const NOW = Date.parse("2026-08-25T01:00:00.000Z");

function authReceipt(overrides: Record<string, unknown> = {}) {
  const scope = {
    schema: "tiangong-lca.auth-identity-receipt.v1",
    status: "passed",
    operation: "current-user-read",
    remote_write_mode: "read-only",
    captured_at_utc: "2026-08-25T00:59:30.000Z",
    cli: { package_name: "@tiangong-lca/cli", package_version: "0.1.2" },
    project: {
      project_ref: PROJECT_REF,
      project_base_url: `https://${PROJECT_REF}.supabase.co`,
    },
    identity: { user_id: USER_ID, display_email: "te****@example.com" },
    session: {
      source: "signin",
      cache_mode: "disabled",
      force_reauth: true,
      expires_at_utc: null,
    },
    bindings: {
      request_sha256: cliAuth.__testInternals.requestFingerprint(PROJECT_REF),
      response_sha256: cliAuth.__testInternals.responseFingerprint({
        projectRef: PROJECT_REF,
        userId: USER_ID,
        displayEmail: "te****@example.com",
      }),
    },
    assertions: {
      mode: "intent-bound",
      requested_count: 2,
      expected_project_ref: PROJECT_REF,
      expected_user_id: USER_ID,
      project_ref_passed: true,
      user_id_passed: true,
      passed: true,
    },
    ...overrides,
  };
  return {
    ...scope,
    receipt_scope_sha256: cliAuth.__testInternals.sha256Json(scope),
  };
}

function parsedReceipt() {
  return parseFreshIntentBoundAuthReceipt(authReceipt(), {
    nowMs: NOW,
    maxAgeMs: 60_000,
    expectedProjectRef: PROJECT_REF,
    expectedUserId: USER_ID,
    requireFreshSignin: true,
  });
}

function binding() {
  return createIdentityPreflightBinding({
    datasetType: "flow",
    datasetId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
    datasetVersion: "00.00.001",
    targetSha256: sha256Text(JSON.stringify({ id: "flow" })),
    requestText: '{"schema_version":1,"target":{"id":"flow"}}\n',
    semanticArgv: ["flow", "identity-preflight", "--json", "--timeout-ms", "60000"],
    cli: {
      packageName: "@tiangong-lca/cli",
      packageVersion: "0.1.2",
      packageIntegrity: "sha512-test",
    },
    authReceipt: parsedReceipt(),
    relevantInputHashes: { source: "2".repeat(64) },
  });
}

test("production auth receipts must be fresh, exact, intent-bound signins", () => {
  const parsed = parsedReceipt();
  assert.equal(parsed.project.project_ref, PROJECT_REF);
  assert.equal(parsed.identity.user_id, USER_ID);

  const stale = authReceipt({ captured_at_utc: "2026-08-24T23:00:00.000Z" });
  assert.throws(() =>
    parseFreshIntentBoundAuthReceipt(stale, {
      nowMs: NOW,
      maxAgeMs: 60_000,
      expectedProjectRef: PROJECT_REF,
      expectedUserId: USER_ID,
      requireFreshSignin: true,
    }),
  );
  for (const changed of [
    { assertions: { ...authReceipt().assertions, mode: "partial" } },
    { session: { ...authReceipt().session, cache_mode: "platform-default" } },
    { session: { ...authReceipt().session, force_reauth: false } },
  ]) {
    const value = authReceipt(changed);
    assert.throws(() =>
      parseFreshIntentBoundAuthReceipt(value, {
        nowMs: NOW,
        maxAgeMs: 60_000,
        expectedProjectRef: PROJECT_REF,
        expectedUserId: USER_ID,
        requireFreshSignin: true,
      }),
    );
  }
});

test("identity preflight binding changes with request, argv, CLI, account, or input hashes", () => {
  const baseline = binding();
  const baselineReceipt = baseline.inputs.authReceipt;
  assert.ok(baselineReceipt);
  assert.equal(baseline.schema, "tiangong-foundry.identity-preflight-binding.v1");
  for (const changed of [
    createIdentityPreflightBinding({ ...baseline.inputs, requestText: "{}\n" }),
    createIdentityPreflightBinding({
      ...baseline.inputs,
      semanticArgv: [...baseline.inputs.semanticArgv, "--extra"],
    }),
    createIdentityPreflightBinding({
      ...baseline.inputs,
      cli: { ...baseline.inputs.cli, packageVersion: "0.1.2" },
    }),
    createIdentityPreflightBinding({
      ...baseline.inputs,
      relevantInputHashes: { source: "3".repeat(64) },
    }),
    createIdentityPreflightBinding({
      ...baseline.inputs,
      authReceipt: {
        ...baselineReceipt,
        identity: {
          ...baselineReceipt.identity,
          user_id: "11111111-1111-4111-8111-111111111111",
        },
      },
    }),
  ]) {
    assert.notEqual(changed.binding_sha256, baseline.binding_sha256);
  }
  const refreshedReceipt = createIdentityPreflightBinding({
    ...baseline.inputs,
    authReceipt: {
      ...baselineReceipt,
      captured_at_utc: "2026-08-25T01:00:00.000Z",
      receipt_scope_sha256: "f".repeat(64),
    },
  });
  assert.equal(refreshedReceipt.binding_sha256, baseline.binding_sha256);
});

test("identity preflight execution fails closed on every enumerated output vector", () => {
  const report = { schema_version: 1, status: "passed", decision: "create_new", ok: true };
  const baseline = {
    binding: binding(),
    exitCode: 0,
    stdoutText: `${JSON.stringify(report)}\n`,
    diskReportText: `${JSON.stringify(report, null, 2)}\n`,
    startedAtMs: NOW,
    diskReportMtimeMs: NOW + 10,
    completedAtUtc: "2026-08-25T01:00:01.000Z",
  };
  const passed = validateIdentityPreflightExecution(baseline);
  assert.equal(passed.ok, true);
  assert.equal(
    validateBoundExecutionManifest(passed.manifest, binding(), baseline.diskReportText).ok,
    true,
  );
  const evidenceInput = {
    requestText: binding().inputs.requestText,
    reportText: baseline.diskReportText,
    datasetType: binding().dataset.type,
    datasetId: binding().dataset.id,
    datasetVersion: binding().dataset.version,
    targetSha256: binding().dataset.target_sha256,
    expectedProjectRef: PROJECT_REF,
    expectedUserId: USER_ID,
  };
  assert.equal(validateIdentityPreflightEvidence(passed.manifest, evidenceInput).ok, true);
  for (const changed of [
    { ...evidenceInput, requestText: "{}\n" },
    { ...evidenceInput, reportText: `${JSON.stringify({ ...report, decision: "reuse" })}\n` },
    { ...evidenceInput, datasetId: "different-flow" },
    { ...evidenceInput, expectedUserId: "11111111-1111-4111-8111-111111111111" },
  ]) {
    assert.equal(validateIdentityPreflightEvidence(passed.manifest, changed).ok, false);
  }

  const cases = [
    { ...baseline, exitCode: 1 },
    { ...baseline, stdoutText: "not-json" },
    { ...baseline, diskReportText: null },
    {
      ...baseline,
      diskReportText: JSON.stringify({ ...report, decision: "reuse_existing" }),
    },
    { ...baseline, diskReportMtimeMs: NOW - 1 },
    {
      ...baseline,
      stdoutText: JSON.stringify({ ...report, ok: false }),
      diskReportText: JSON.stringify({ ...report, ok: false }),
    },
    {
      ...baseline,
      stdoutText: JSON.stringify({ ...report, status: "failed" }),
      diskReportText: JSON.stringify({ ...report, status: "failed" }),
    },
  ];
  for (const candidate of cases) {
    assert.equal(validateIdentityPreflightExecution(candidate).ok, false);
  }

  assert.equal(
    validateBoundExecutionManifest(
      passed.manifest,
      createIdentityPreflightBinding({ ...binding().inputs, requestText: "{}\n" }),
      baseline.diskReportText,
    ).ok,
    false,
  );
});

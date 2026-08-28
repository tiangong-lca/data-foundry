import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { bafuProcessScopeE2eTestHooks } from "../../scripts/commands/bafu-process-scope-e2e.ts";
import {
  canRunPostFinalizeIdentityRecovery,
  canRunPostFinalizeSemanticRecovery,
  curationGateBlockers,
  finalizeBlockers,
  postWriteVerifyRetryReasonFromReport,
  reportCodes,
} from "../../scripts/lib/bafu-orchestration/finalize-recovery-policy.ts";

type JsonRecord = Record<string, unknown>;

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, "..", "..");
const modulePath = path.join(
  repoRoot,
  "scripts",
  "lib",
  "bafu-orchestration",
  "finalize-recovery-policy.ts",
);
const ownerPath = path.join(repoRoot, "scripts", "commands", "bafu-process-scope-e2e.ts");

function sha256Text(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function assertFrozen(
  name: string,
  value: unknown,
  { bytes, sha256 }: { bytes: number; sha256: string },
): void {
  const serialized = JSON.stringify(value);
  assert.equal(Buffer.byteLength(serialized), bytes, `${name}: byte count`);
  assert.equal(sha256Text(serialized), sha256, `${name}: sha256`);
}

function isJsonRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function jsonRecord(value: unknown): JsonRecord {
  return isJsonRecord(value) ? value : {};
}

function recoveryGateReport(overrides: JsonRecord = {}): JsonRecord {
  return {
    schema_version: 2,
    status: "blocked_needs_foundry_ai_authoring",
    counts: {
      action_items: 1,
      identity_action_items: 0,
      semantic_action_items: 0,
      classification_queue_action_items: 0,
      location_queue_action_items: 0,
      deterministic_cleanup_items: 0,
      ...jsonRecord(overrides.counts),
    },
    ...overrides,
  };
}

test("finalize recovery policy is a pure typed leaf reused by the process-scope owner", () => {
  const moduleSource = fs.readFileSync(modulePath, "utf8");
  const ownerSource = fs.readFileSync(ownerPath, "utf8");

  assert.doesNotMatch(
    moduleSource,
    /node:(?:fs|path|process|child_process)|\bprocess\.|\bspawn\b|CommandSpec|\bfetch\s*\(|\bXMLHttpRequest\b|\bAtomics\b/u,
  );
  assert.doesNotMatch(moduleSource, /^let\s+/mu);
  assert.doesNotMatch(moduleSource, /install\w*Runtime|moduleRuntime|runtime\(\)/u);
  assert.match(moduleSource, /export interface CurationGateBlockerInput\s*\{/u);
  assert.match(moduleSource, /export type PostWriteVerifyReportInput\s*=/u);
  assert.match(ownerSource, /from "\.\.\/lib\/bafu-orchestration\/finalize-recovery-policy\.ts"/u);
  for (const functionName of [
    "collectReportCodes",
    "curationGateBlockers",
    "canRunPostFinalizeIdentityRecovery",
    "canRunPostFinalizeSemanticRecovery",
    "finalizeBlockers",
  ]) {
    assert.doesNotMatch(
      ownerSource,
      new RegExp(`function ${functionName}\\s*\\(`, "u"),
      `${functionName} must not remain implemented in the owner`,
    );
  }

  assert.equal(bafuProcessScopeE2eTestHooks.curationGateBlockers, curationGateBlockers);
  assert.equal(bafuProcessScopeE2eTestHooks.finalizeBlockers, finalizeBlockers);
  assert.equal(
    bafuProcessScopeE2eTestHooks.canRunPostFinalizeIdentityRecovery,
    canRunPostFinalizeIdentityRecovery,
  );
  assert.equal(
    bafuProcessScopeE2eTestHooks.canRunPostFinalizeSemanticRecovery,
    canRunPostFinalizeSemanticRecovery,
  );
  assert.equal(bafuProcessScopeE2eTestHooks.reportCodes, reportCodes);
  assert.equal(
    bafuProcessScopeE2eTestHooks.postWriteVerifyRetryReasonFromReport,
    postWriteVerifyRetryReasonFromReport,
  );
});

test("curation blockers preserve AI, deterministic cleanup, then gate-status order and bytes", () => {
  const gateReport: JsonRecord = {
    schema_version: 2,
    status: "blocked_needs_foundry_ai_authoring",
    counts: {
      action_items: 3,
      identity_action_items: 1,
      semantic_action_items: 2,
      classification_queue_action_items: 0,
      location_queue_action_items: 0,
      deterministic_cleanup_items: 1,
    },
    entities: [
      {
        dataset_type: "process",
        entity_id: "process-a",
        action_item_count: 2,
        authoring_package: "authoring/process-a.json",
      },
      {
        dataset_type: "flow",
        entity_id: "flow-a",
        action_item_count: 1,
        authoring_package: "authoring/flow-a.json",
      },
      {
        dataset_type: "flow",
        entity_id: "flow-ignored",
        action_item_count: 0,
        authoring_package: "authoring/flow-ignored.json",
      },
    ],
  };
  const result = curationGateBlockers({
    finalizeReport: { status: "blocked" },
    gateReport,
  });

  assert.equal(result.gateReport, gateReport);
  assert.deepEqual(
    result.blockers.map((blocker) => blocker.code),
    [
      "unresolved_ai_curation_items",
      "unresolved_deterministic_curation_items",
      "curation_gate_not_ready",
    ],
  );
  assertFrozen("curation gate result", result, {
    bytes: 1636,
    sha256: "d86feeb740b5c6b6f505ebe6a4fe5fe1d6daa0aacc17122c091b88f8d56aa84b",
  });

  assert.deepEqual(
    curationGateBlockers({
      finalizeReport: { status: "ready_for_remote_write" },
      gateReport: null,
    }),
    {
      gateReport: null,
      blockers: [
        {
          code: "curation_gate_report_missing",
          severity: "error",
          message: "Ready BAFU process scope is missing a readable curation gate report.",
        },
      ],
    },
  );
  assert.deepEqual(
    curationGateBlockers({ finalizeReport: { status: "blocked" }, gateReport: null }),
    { gateReport: null, blockers: [] },
  );
});

test("identity and semantic recovery remain mutually exclusive and queue-free", () => {
  const identityOnly = recoveryGateReport({
    counts: { identity_action_items: "2" },
  });
  const semanticOnly = recoveryGateReport({
    counts: { semantic_action_items: 1 },
  });
  const mixed = recoveryGateReport({
    counts: { identity_action_items: 1, semantic_action_items: 1 },
  });
  const identityWithClassification = recoveryGateReport({
    counts: { identity_action_items: 1, classification_queue_action_items: 1 },
  });
  const semanticWithLocation = recoveryGateReport({
    counts: { semantic_action_items: 1, location_queue_action_items: 1 },
  });

  assert.deepEqual(
    [identityOnly, semanticOnly, mixed, identityWithClassification, semanticWithLocation, null].map(
      (gateReport) => ({
        identity: canRunPostFinalizeIdentityRecovery(gateReport),
        semantic: canRunPostFinalizeSemanticRecovery(gateReport),
      }),
    ),
    [
      { identity: true, semantic: false },
      { identity: false, semantic: true },
      { identity: false, semantic: false },
      { identity: false, semantic: false },
      { identity: false, semantic: false },
      { identity: false, semantic: false },
    ],
  );
});

test("finalize blockers keep synthesized status blockers before original report blockers", () => {
  const blockers = finalizeBlockers({
    status: "blocked",
    commit_handoff: {
      status: "blocked",
      blockers: [{ code: "manual_review_required" }],
    },
    blockers: [{ code: "post_authoring_curation_gate_not_ready", scope: "process-a" }, "invalid"],
  });

  assert.deepEqual(
    blockers.map((blocker) => blocker.code),
    [
      "post_authoring_finalize_not_ready",
      "commit_handoff_not_ready",
      "post_authoring_curation_gate_not_ready",
      undefined,
    ],
  );
  assertFrozen("finalize blockers", blockers, {
    bytes: 418,
    sha256: "dcd0f6584e8fcb0010001e972dd02b5fb26d506f239be1c54bf069ed6b7c1a18",
  });
});

test("verify report classification preserves code order and separates retry from human review", () => {
  const report: JsonRecord = {
    status: "blocked_remote_verification",
    blockers: [
      { code: "human_review_required" },
      { failure_code: "lookup_failed" },
      { code: "readback_failed" },
    ],
    checks: [{ results: [{ readback_status: "remote_readback_missing" }] }],
  };

  const codes = reportCodes(report);
  assert.deepEqual(codes, [
    "human_review_required",
    "lookup_failed",
    "readback_failed",
    "remote_readback_missing",
  ]);
  assertFrozen("report code order", codes, {
    bytes: 85,
    sha256: "6de89864c833976e07b906e9a6f4e32554f618fb1e521fcd9cb7a2ee91ceeb61",
  });
  assert.equal(
    postWriteVerifyRetryReasonFromReport({ availability: "available", report }),
    "lookup_failed",
  );
  assert.equal(
    postWriteVerifyRetryReasonFromReport({
      availability: "available",
      report: { blockers: [{ code: "manual_review_required" }] },
    }),
    null,
  );
  assert.equal(
    postWriteVerifyRetryReasonFromReport({
      availability: "available",
      report: { counts: { by_status: { remote_readback_missing: 1 } } },
    }),
    "remote_readback_missing",
  );
  assert.equal(
    postWriteVerifyRetryReasonFromReport({ availability: "missing" }),
    "verify_report_missing",
  );
});

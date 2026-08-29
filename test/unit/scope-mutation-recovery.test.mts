import assert from "node:assert/strict";
import test from "node:test";

import { createScopeMutationRecoveryService } from "../../scripts/lib/batch-orchestration/scope-mutation-recovery.ts";
import { createScopeResumeContract } from "../../scripts/lib/batch-orchestration/scope-resume-contract.ts";

type JsonRecord = Record<string, unknown>;

const key = "process-a@00.00.001";
const scope = { process_id: "process-a", process_version: "00.00.001" };
const contract = createScopeResumeContract({
  identityKey: key,
  content: { source: "exact" },
  policy: { profile: "bafu" },
  executable: { cli: "0.1.3" },
});

function harness(processContract = contract) {
  const files = new Map<string, JsonRecord>([["/repo/closeout.json", { status: "completed" }]]);
  const ledgers = new Map<string, JsonRecord[]>([
    ["ok-scopes", []],
    [
      "ok-processes",
      [
        {
          dataset_id: "process-a",
          dataset_version: "00.00.001",
          status: "verified",
          report: "finalize.json",
          files: { process_closeout_report: "closeout.json" },
          resume_contract: processContract,
        },
      ],
    ],
    ["checkpoints", []],
  ]);
  const service = createScopeMutationRecoveryService({
    paths: {
      okScopes: "ok-scopes",
      okProcesses: "ok-processes",
      scopeCheckpoints: "checkpoints",
      resumeContractsByScopeKey: new Map([[key, contract]]),
    },
    adapter: {
      nowIso: () => "2026-08-29T00:00:00.000Z",
      asText: (value) => String(value ?? ""),
      readJson: (filePath) => files.get(filePath) ?? {},
      readJsonLines: (filePath) => [...(ledgers.get(filePath) ?? [])],
      fileExists: (filePath) => Boolean(filePath && files.has(filePath)),
      resolveRepoPath: (value) => (value ? `/repo/${String(value)}` : null),
      repoRelative: (filePath) => String(filePath ?? "").replace("/repo/", ""),
      appendJsonLine: (filePath, row) =>
        ledgers.set(filePath, [...(ledgers.get(filePath) ?? []), row]),
    },
  });
  return { service, ledgers };
}

test("exact process closeout recovers an interrupted scope without mutation replay", () => {
  const { service, ledgers } = harness();
  const recovered = service.recover(scope, "resume_incomplete");
  assert.ok(recovered);
  assert.equal(recovered.status, "verified");
  assert.equal(
    (recovered.recovery as JsonRecord).disposition,
    "verified_process_closeout_readback",
  );
  const okScopes = ledgers.get("ok-scopes") ?? [];
  const checkpoints = ledgers.get("checkpoints") ?? [];
  assert.equal(okScopes.length, 1);
  assert.deepEqual(okScopes[0].resume_contract, contract);
  assert.equal(checkpoints[0].state, "verified_recovered_readback");
});

test("legacy or drifted process receipts never authorize recovery", () => {
  for (const prior of [
    {},
    createScopeResumeContract({
      identityKey: key,
      content: { source: "changed" },
      policy: { profile: "bafu" },
      executable: { cli: "0.1.3" },
    }),
  ]) {
    const { service, ledgers } = harness(prior as typeof contract);
    assert.equal(service.recover(scope, "resume_incomplete"), null);
    assert.deepEqual(ledgers.get("ok-scopes"), []);
    assert.deepEqual(ledgers.get("checkpoints"), []);
  }
});

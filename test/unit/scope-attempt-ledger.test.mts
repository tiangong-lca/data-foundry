import assert from "node:assert/strict";
import test from "node:test";

import { createBatchItemContract, type BatchEvent } from "@tiangong-lca/cli/batch";

import { createScopeAttemptLedgerService } from "../../scripts/lib/batch-orchestration/scope-attempt-ledger.ts";
import { createScopeResumeContract } from "../../scripts/lib/batch-orchestration/scope-resume-contract.ts";

type JsonRecord = Record<string, unknown>;

function event(type: BatchEvent["type"], itemId: string, sequence: number): BatchEvent {
  return { sequence, timestamp_ms: sequence, type, item_id: itemId, attempt: 1 };
}

test("attempt state compacts 1,358 outage scopes without replay growth", () => {
  const files = new Map<string, JsonRecord[]>();
  const statePath = "attempt-state.jsonl";
  const eventsPath = "attempt-events.jsonl";
  const service = createScopeAttemptLedgerService({
    paths: { state: statePath, events: eventsPath },
    adapter: {
      nowIso: () => "2026-08-29T00:00:00.000Z",
      readJsonLines: (filePath) => [...(files.get(filePath) ?? [])],
      appendJsonLine: (filePath, row) => files.set(filePath, [...(files.get(filePath) ?? []), row]),
      writeJsonLines: (filePath, rows) => files.set(filePath, [...rows]),
    },
  });
  const ids = Array.from({ length: 1_358 }, (_, index) => `scope-${index}`);
  for (const [index, itemId] of ids.entries()) {
    const itemContract = createBatchItemContract({
      item_id: itemId,
      content: { index },
      policy: { profile: "uslci" },
    });
    const scopeResumeContract = createScopeResumeContract({
      identityKey: itemId,
      content: { index },
      policy: { profile: "uslci" },
      executable: { cli: "0.1.3" },
    });
    service.record({
      event: event("attempt_started", itemId, index * 2 + 1),
      itemContract,
      scopeResumeContract,
    });
    service.record({
      event: event("recovery_failed", itemId, index * 2 + 2),
      itemContract,
      scopeResumeContract,
    });
  }
  service.compact();
  assert.equal(files.get(statePath)?.length, 1_358);
  assert.deepEqual(files.get(eventsPath), []);
  assert.equal(service.loadResumeItems(new Set(ids)).length, 1_358);

  for (const [index, itemId] of ids.entries()) {
    const resume = service.loadResumeItems(new Set([itemId]))[0];
    service.record({
      event: event("item_resume_rejected", itemId, 3_000 + index),
      itemContract: {
        item_id: itemId,
        content_sha256: "changed-content",
        policy_sha256: "changed-policy",
      },
      scopeResumeContract: null,
    });
    assert.equal(resume.content_sha256 === "changed-content", false);
  }
  service.compact();
  assert.equal(files.get(statePath)?.length, 1_358);
  assert.deepEqual(files.get(eventsPath), []);
});

test("successful attempt or readback recovery clears consumed attempt state", () => {
  const files = new Map<string, JsonRecord[]>();
  const service = createScopeAttemptLedgerService({
    paths: { state: "state", events: "events" },
    adapter: {
      nowIso: () => "2026-08-29T00:00:00.000Z",
      readJsonLines: (filePath) => [...(files.get(filePath) ?? [])],
      appendJsonLine: (filePath, row) => files.set(filePath, [...(files.get(filePath) ?? []), row]),
      writeJsonLines: (filePath, rows) => files.set(filePath, [...rows]),
    },
  });
  const contract = createBatchItemContract({ item_id: "scope-a", content: null, policy: null });
  service.record({ event: event("attempt_started", "scope-a", 1), itemContract: contract });
  service.record({ event: event("attempt_succeeded", "scope-a", 2), itemContract: contract });
  assert.deepEqual(service.loadResumeItems(new Set(["scope-a"])), []);
  service.record({ event: event("attempt_started", "scope-a", 3), itemContract: contract });
  service.record({ event: event("recovery_succeeded", "scope-a", 4), itemContract: contract });
  assert.deepEqual(service.loadResumeItems(new Set(["scope-a"])), []);
});

---
title: Topology Convergence Contract
docType: contract
scope: repo
status: active
authoritative: true
owner: tiangong-lca-data-foundry
language: en
whenToUse:
  - when a newer source release merges, splits, adds, or retires flow identities
  - when every process exchange array must be rebuilt to one exact candidate topology
  - when preparing separate flow-create, process-save, and zero-inbound flow-delete phases
whenToUpdate:
  - when topology request, occurrence identity, language preservation, F/P/D output, or audit behavior changes
checkPaths:
  - docs/topology-convergence-contract.md
  - specs/schemas/topology-convergence.schema.json
  - scripts/commands/topology-convergence.mjs
  - test/fixtures/topology-convergence-fixtures.mjs
  - test/unit/topology-convergence.test.mjs
  - test/commands/topology-convergence.test.mts
  - test/scenarios/topology-convergence-handoff.test.mjs
  - docs/execution-capsule-contract.md
lastReviewedAt: 2026-08-25
lastReviewedCommit: 4d415fac33799011d37094ac79122c1eef3a7855
lastReviewedNote: "Reviewed for Issue #63: the stage-contract module moved to TypeScript without changing topology composition semantics or artifacts."
---

# Topology Convergence Contract

`dataset-topology-convergence-compose` is the offline Foundry planner for a release whose flow identity graph changed. It materializes three separately gated phases:

- F creates only globally absent target flows;
- P inserts or updates owner-draft processes to the candidate ordered exchange topology;
- D lists obsolete owner-draft flows as delete candidates, but does not claim that they are yet safe to delete.

The command never connects to a network or database, invokes the CLI, performs DML, changes schema, or grants production authority.

## Invocation

```bash
node scripts/foundry.mjs dataset-topology-convergence-compose \
  --request .foundry/workspaces/<task>/topology/request.json \
  --out-dir .foundry/workspaces/<task>/topology/composition-0001
```

The output directory must be fresh and inside the repository. The command creates it with mode `0700` and files with mode `0600`; prior evidence is never overwritten.

Durable JSON artifacts are written through one exclusive writable descriptor and fsynced before close, which preserves the contract on Windows as well as POSIX systems. Numeric `0700`/`0600` assertions apply where the filesystem exposes POSIX permission bits; Windows still enforces fresh-path and no-overwrite semantics.

## Bound inputs

The strict `foundry-topology-convergence-request.v1` schema binds:

- candidate package path, SHA-256, and bytes; the composer rereads the actual package before accepting derived indexes;
- owner email/user, project, `state_code=0`, and `owner_draft` visibility;
- candidate flow and process file indexes;
- complete owner flow/process, public-flow, and foreign-flow SELECT-only snapshots;
- occurrence-level flow mappings, one audited classification per candidate flow, approved German synonyms, and protected no-write rows;
- exact existing canonical FlowProperty and UnitGroup identities;
- expected topology/change/language algebra;
- a released CLI version, merge commit, and npm integrity value;
- a fresh admission receipt that binds the complete pre-admission request digest, every input SHA, candidate package, scope, CLI/deployment/RPC/query fingerprints, fresh owner session, SELECT-only mode, and zero queue/fence/residue/P0/P1 guards;
- `production_authority=false`.

Candidate index rows bind each payload file by path, bytes, SHA-256, table, UUID, and version. The composer rereads every payload and recomputes identity and hashes. Snapshot rows likewise bind exact canonical payload hashes. Missing, duplicated, drifted, out-of-scope, public-as-owner, or foreign-as-owner inputs fail closed.

## Flow materialization

Every candidate flow receives exactly one audited classification row. The composer replaces only `classificationInformation` in the candidate payload, validates all FlowProperty/UnitGroup references against the request's canonical allowlists, and classifies the visible target:

| Visible state | Disposition |
| --- | --- |
| one exact owner-draft row | owner no-write |
| no owner row and one exact public row | public read-only reuse |
| no owner/public/foreign row | owner-draft create candidate |
| foreign-only target, non-unique target, or differing owner/public content | hold |

Public and foreign rows can never become actions. Classification conflicts require an explicit request-bound selected leaf; silent predecessor choice is forbidden.

## Occurrence-aware process reconstruction

Exchange identity is the tuple `(process UUID, EcoSpold source exchange number, 1-based occurrence in document order)`. Candidate payloads bind the source number through retained conversion trace. Fresh production snapshots may bind it through the preserved `generalComment` marker after import-metadata cleanup; if both forms exist they must agree exactly. Missing, ambiguous, or conflicting evidence fails closed. A global `old_flow_id -> new_flow_id` replacement is never used.

For an existing process, the current owner payload is the base so all non-exchange content remains byte-semantically preserved. The candidate ordered exchange array supplies only the authorized topology fields:

- order and `@dataSetInternalID`;
- complete flow reference;
- direction;
- semantically changed `meanAmount` and `resultingAmount`;
- candidate additions and removals;
- approved language nodes.

Unchanged decimal spellings remain current bytes. Process inserts use the candidate payload. The German synonym overlay is keyed by process UUID. Existing Chinese flow-reference short descriptions are carried to the matching candidate occurrence. No translation is generated. Protected source-language rows are copied only to the no-write ledger.

The process payload is an update only when its exact canonical desired SHA differs from the fresh owner SHA. Exact rows become no-write; absent rows become inserts. Flow-create and process contracts are separate because phase P is admitted only after phase F exact readback proves the complete target flow closure.

## Delete barrier

Every owner `state_code=0` flow outside the target closure becomes a D candidate with exact before hash, desired-absence hash, and `required_inbound_ref_count=0`. This is not a delete execution contract.

After P, the fixed CLI must perform a fresh all-visible-process inbound scan. Only unique owner targets with zero inbound references may enter a delete-only maintenance plan. Public/foreign flows and nonzero/unknown inbound targets remain excluded while independent zero-inbound targets may continue.

## Logs and artifacts

Every entity disposition and every exchange add/remove/reference/direction/amount/language transformation is appended to `topology-conversion-events.jsonl`. Each event contains:

- `action_id`, entity, optional exchange key, mapping kind, and reason;
- exact before and desired SHA-256 values;
- evidence where applicable;
- sequence, prior-event hash, and current event hash.

The output package contains:

```text
topology-request.snapshot.json
topology-conversion-events.jsonl
flow-create-input.jsonl
flow-create-execution-contract.json              # only when ready and non-empty
flow-no-write.jsonl
process-save-draft-input.jsonl
process-execution-contract.json                  # only when ready and non-empty
process-no-write.jsonl
flow-delete-candidates.jsonl
protected-no-write.jsonl
topology-holds.jsonl
topology-ambiguity-recovery-registry.jsonl
topology-dependency-closure.json
topology-independent-audit-input.json
topology-independent-audit.json
topology-report.json
topology-manifest.json
```

The independent audit rereads every recorded artifact and the full conversion hash chain. The manifest records schema, rows, bytes, and SHA-256 for every output and binds the released CLI fingerprint.

## Algebra and activation

The package is `ready_for_admission` only when every request count is exact, candidate process references cover the candidate flow closure exactly, process and flow disposition partitions close, delete candidates do not exceed the ceiling, machine translation and public/foreign mutations are zero, the event chain passes, and P0=P1=0. Otherwise it is `rejected` and no execution contract is emitted.

Even a passing package remains `production_authority=false`. Independent human/machine review and `execution-capsule-admit` must seal the exact inputs, actions, no-writes, fixed CLI consumer boundary, and F-before-P phase dependency. F and P use protected owner-session save-draft transactions. D uses the fixed delete-only maintenance command after its fresh zero-inbound barrier. Attempt consumption, ambiguity recovery, exact readback, and successful-row no-replay remain CLI/runtime responsibilities.

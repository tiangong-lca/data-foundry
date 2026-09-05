---
title: Execution Capsule Admission Contract
docType: contract
scope: repo
status: active
authoritative: true
owner: tiangong-lca-data-foundry
language: en
whenToUse:
  - when assembling an offline execution package from staged evidence
  - when deciding whether a local package is sealed without consuming a remote attempt
whenToUpdate:
  - when the execution capsule stage, boundary, admission ledger, report, or seal contract changes
checkPaths:
  - docs/execution-capsule-contract.md
  - specs/schemas/execution-capsule-stage.schema.json
  - scripts/commands/execution-capsule.ts
  - test/commands/execution-capsule.test.mts
  - test/unit/execution-capsule-attempt-state.test.mts
  - test/unit/execution-capsule-command-factory.test.mts
  - specs/schemas/execution-context.schema.json
  - scripts/lib/foundry-execution-admission.ts
lastReviewedAt: 2026-09-05
lastReviewedCommit: 9f258f4632c091d2b12834c1699171e6cc714ed7
lastReviewedNote: "Reviewed for #100 W04: this offline zero-attempt seal remains distinct from the qualified current-task child execution context."
---

# Execution Capsule Admission Contract

`execution-capsule-admit` is a Foundry-owned, workflow-internal offline gate. It turns one staged evidence revision into an immutable local admission record. It does not execute the consumer, create a session, access a network or database, dispatch a CLI write, or authorize production work.

This `foundry-execution-capsule-stage.v1` contract is distinct from `tiangong-foundry.execution-context.v1` in `execution-context.schema.json`. The stage contract packages offline evidence and proves an unconsumed attempt. The newer child execution context binds current runtime qualification, identity, task authorization, final-row lineage and one reviewed CommandSpec immediately before handing that spec to the existing no-replay owner. Neither document authorizes replay or replaces the other's checks.

## Fast path

Prepare a `foundry-execution-capsule-stage.v1` manifest and its content-addressed leaves, then run:

```bash
node scripts/foundry.ts execution-capsule-admit \
  --stage-manifest .foundry/workspaces/<task-id>/stage-revisions/revision-0001.json \
  --out-dir .foundry/workspaces/<task-id>/admissions/revision-0001
```

For revision 2 and later, also pass the exact prior revision manifest with `--predecessor-stage-manifest`. The command reads that regular, non-symlink repository file and requires its raw SHA-256, stage ID, producer ID, and immediately preceding revision number to match the current manifest before a seal can be emitted.

The output directory must not already exist. A correction is a new stage revision or a new admission directory; prior snapshots, ledgers, reports, and seals are never overwritten.

## Admission requirements

The command checks all of these in one deterministic pass:

- stage schema, monotonically identified revision, predecessor binding, and exact scope binding;
- an unconsumed attempt state with zero dispatch, mutation, and readback;
- content-addressed leaves with exact raw bytes/SHA-256 and domain-tagged semantic SHA-256;
- confined, regular, non-symlink leaf files and unique leaf IDs and paths;
- complete, acyclic leaf dependencies and explicit freshness classes;
- at least one independent reviewer report;
- a materialized producer/consumer boundary with exact CWD, argv, program path, declared fields, filenames, and disabled network/database dispatch; the consumer program and every named input/output path must also be a content-addressed stage leaf;
- stage-declared and validator-observed `P0=0` and `P1=0`.

Supported semantic canonicalizers are `raw-bytes-v1`, `utf8-lf-v1`, and `canonical-json-v1`. Semantic SHA-256 values are domain-separated as `SHA-256(UTF8(domain) || NUL || canonical_bytes)`, so a leaf cannot be relabeled into another semantic domain without invalidating admission. Supported freshness classes are `SEMANTIC_IMMUTABLE`, `TOOLCHAIN_BOUND`, `LIVE_RECONCILIATION`, `OWNER_SESSION`, and `DERIVED_REPORT`; the two live classes require explicit capture and no-known-mutation attestations.

## Outputs and authority boundary

Every parseable run writes an immutable stage snapshot, JSONL check ledger, and reader-facing report. Only a fully passing run writes `execution-capsule-seal.json`. The seal binds the stage manifest, complete leaf set, snapshot, ledger, report, scope, revision lineage, and zero-attempt state.

The seal is local admission evidence only. `production_authority` is always `false`. Remote operation semantics, owner-session authentication, protected transactions, readback, retry/recovery, and mutation behavior remain owned by their existing CLI and database surfaces.

## Attempt-state model

Pre-seal constructor, parser, validator, auditor, or composer failures do not consume an attempt because no dispatch occurred. Once dispatch is confirmed or becomes unknown, the modeled attempt is consumed. Exact desired readback makes success terminal; any non-exact or missing readback after a confirmed/unknown dispatch is `UNKNOWN_DO_NOT_REPLAY`.

The admission command only accepts the pre-dispatch `UNATTEMPTED` state. The exported attempt-state model exists for deterministic evidence interpretation and performs no remote action.

The pure attempt model is owned by `scripts/lib/foundry-execution-attempt.ts` and re-exported unchanged by the internal command owner. Migration planning reuses this leaf, adds zero-count/dispatch consistency checks, and binds selected stage bytes; it does not ship the command owner or claim a selected historical stage is a fresh admission.

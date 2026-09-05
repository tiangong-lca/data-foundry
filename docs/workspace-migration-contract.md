---
title: Foundry Workspace Migration Contract
docType: contract
scope: workspace-migration
status: active
authoritative: true
owner: tiangong-lca-data-foundry
language: en
whenToUse:
  - when planning or revalidating an explicit legacy workspace migration
  - when interpreting retained attempt evidence without granting replay authority
whenToUpdate:
  - when migration planning, state preservation, application, audit or rollback behavior changes
checkPaths:
  - scripts/lib/foundry-migration-inventory.ts
  - scripts/lib/foundry-migration-plan.ts
  - scripts/lib/foundry-migration-stage.ts
  - scripts/lib/foundry-execution-attempt.ts
  - scripts/foundry-facade.ts
  - scripts/runtime-entry.ts
  - specs/schemas/foundry-workspace-migration-transfer-plan.schema.json
  - test/unit/foundry-migration-plan.test.mts
  - test/scenarios/workspace-migration-planning.test.mts
lastReviewedAt: 2026-09-05
lastReviewedCommit: bed7f3d9d48c462a90211e3675241e12f17d2495
lastReviewedNote: "Reviewed for #108 first W10 slice: read-only bound transfer planning and source revalidation are implemented; apply, task adoption, activation and rollback remain required."
related:
  - docs/public-runtime-contract.md
  - docs/runtime-context-contract.md
  - docs/foundry-task-contracts.md
  - docs/execution-capsule-contract.md
---

# Workspace migration

The first W10 slice implements a reviewable transfer plan and fresh revalidation. Applying a plan, activating a migrated workspace, rebuilding local task revisions and runtime rollback are still required by #108. `--apply` remains unavailable. This planning boundary must not be presented as a completed migration or F1 qualification.

The source remains unchanged. Planning never creates the destination, a lock, a cache, a workspace marker or an authorization. It neither dispatches a command nor changes remote data. Original #95 tasks and operator workspaces are outside the private test scope.

## Explicit transfer planning

The retained inventory-only command remains available. To bind a proposed transfer:

```sh
tiangong-foundry workspace migrate --workspace /absolute/legacy-project \
  --to /absolute/new-project --actor agent/session-001 --request migration-001 \
  --stage-manifest workspaces/issue-123/stage-revisions/revision-0001.json \
  --dry-run --json
```

`--to`, `--actor` and `--request` are required together. `--stage-manifest` may repeat, up to 128 unique source-state-relative paths. Both path separators are accepted; stored paths use `/`, and aliases that normalize to the same file are rejected as duplicates. A selected stage is evidence to interpret, not executable input or proof that every legacy task has been enumerated. The target may be an existing user project, but it must contain no `.foundry` state. Source and target must be physically disjoint. A package, installed skill directory, filesystem root or unsupported platform is rejected before source capture.

`createFoundryFacade(...).migrationDryRun({ destination, actorId, requestId, stageManifests })` returns the same transfer artifact. Host account intent is projected as project/user only; an OAuth session reference is never serialized in the plan. Ordinary arguments and plans do not provide runtime trust anchors.

## Plan identity and preservation

`tiangong-foundry.workspace-migration-transfer-plan.v1` binds request, actor, canonical source and destination, current package/entry/platform identity, optional account intent, the complete bounded `.foundry` inventory, explicitly selected stage evidence and blocker/omission lists. `plan_sha256` is the canonical digest of every other field. Arrays are ordered deterministically. There is no current timestamp that would change an unchanged proposal on retry.

The inventory still uses `workspace-migration-plan.v1` and observational path classes. It hashes at most 256 MiB in total, with a 64 MiB per-file bound, 10,000 entries and 64 directory levels. `.env*`, recognized OAuth/session/token/cookie/credential/private-account storage and the host-selected session reference (including an opaque filename) are metadata-only: no content read or new digest. A selected session that collides with `workspace.json` is not opened as a marker and blocks transfer. Their paths are listed under `omitted_private_paths`; omission is not a claim that their content was verified or copied. Oversized non-private files carry explicit blockers, and unsupported source marker schemas remain blocked. The source itself must always be preserved, including excluded files.

Selected stage JSON is capped at 8 MiB and must match its inventory path/size/hash. Reads reject links and check descriptor identity, size, timestamps and bytes. The entire inventory is observed again before returning a plan; a change rejects the proposal. This detects observed drift but does not claim an atomic filesystem snapshot or protection from arbitrary same-user filesystem tampering.

`revalidateFoundryMigrationPlan` accepts plain JSON only and reconstructs the proposal from independently supplied source, destination context, request, actor and stage selections. Every field must match the fresh result. Runtime manifest/entry facts are observed again before and after planning; installed packages additionally bind the complete descriptor inventory digest. Source or repository-emitted mode is explicitly `entry-only`, not a claim of component provenance. Recomputing a forged plan digest does not select another account, runtime or source. Unknown fields, non-JSON values, accessors and structural/byte overflow fail closed. This is a pre-mutation boundary; later apply/audit must recheck selected source files around each mutation and must not use a past planning result as a permanent authority object.

## Retained attempt evidence

The existing `modelExecutionAttemptDisposition` now lives in the small `foundry-execution-attempt.ts` owner and is re-exported by the internal capsule command. Its original semantics and function identity are preserved. The public package imports this leaf without importing the capsule command or the 63-command developer surface.

Transfer planning adds count/consistency checks before using a declared disposition:

| Retained evidence | Planning action |
| --- | --- |
| Explicit `UNATTEMPTED`, both counts zero, `NOT_DISPATCHED`, `NONE` mutation and `NOT_STARTED` readback | Rebuild local preparation through current owners; old admission is not reused. |
| Confirmed dispatch with exact desired readback | Retain terminal evidence; no mutation replay. |
| Unknown dispatch with exact desired readback | Retain recovered terminal evidence; no mutation replay. |
| Missing, inconsistent or unresolved dispatch/readback facts | Owner readback only; never clear or reseal as unattempted. |

These are interpretations of content-bound historical declarations, not fresh server readback or validation of every capsule leaf. `grants_write_authority` and `remote_write_allowed` are always false. A selected file name, profile waiver, old account proof, new path, runtime or request cannot grant write/replay permission. Full task/capsule/lineage validation and fresh independent identity remain necessary before later task adoption or restricted execution.

## Remaining W10 delivery

#108 still owns exclusive staged copying, immutable predecessor/task mapping, current-owner local preparation regeneration, durable no-replay inheritance across task revisions, interruption recovery, independent destination audit before activation, and separate read/write workspace compatibility plus explicit runtime rollback. Tests and private real-case evidence must cover those behaviors before #108 can close. Successful planning alone does not satisfy them.

The current inventory covers `.foundry` only. Root-level legacy task queues and external source-manifest inputs need their own explicit selection and preservation before full task adoption; they are not implicitly covered by this first planning slice.

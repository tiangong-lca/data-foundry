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
  - scripts/lib/foundry-migration-transfer.ts
  - scripts/lib/foundry-migration-transfer-io.ts
  - scripts/lib/foundry-execution-attempt.ts
  - scripts/foundry-facade.ts
  - scripts/runtime-entry.ts
  - specs/schemas/foundry-workspace-migration-transfer-plan.schema.json
  - specs/schemas/foundry-migration-transfer-receipt.schema.json
  - specs/schemas/foundry-workspace-migration-pending.schema.json
  - test/unit/foundry-migration-plan.test.mts
  - test/scenarios/workspace-migration-planning.test.mts
  - test/unit/foundry-migration-transfer.test.mts
  - test/scenarios/workspace-migration-transfer.test.mts
lastReviewedAt: 2026-09-05
lastReviewedCommit: a74b09c202f0ed48d3ce8bb0810e1e8b15c47603
lastReviewedNote: "Reviewed for #108: facade descendants recheck retained predecessor publications and block on observed attempts or missing history; source credentials, execution ownership, full migration adoption and rollback boundaries remain unchanged."
related:
  - docs/public-runtime-contract.md
  - docs/runtime-context-contract.md
  - docs/foundry-task-contracts.md
  - docs/execution-capsule-contract.md
---

# Workspace migration

W10 now implements a source-bound transfer plan, explicit staging, interruption recovery and independent archive audit. Task adoption, activation and runtime rollback remain required by #108; `--apply` stays unavailable until those gates are implemented. A staged transfer is not an active or completed workspace migration.

The source remains unchanged. Dry-run planning creates no destination, lock, cache, marker or authorization. Explicit staging writes only its owned destination control tree and a destination-scoped cache lock; it never dispatches a business command or changes remote data. Original #95 tasks and operator workspaces are outside the private test scope.

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

`tiangong-foundry.workspace-migration-transfer-plan.v2` binds request, actor, canonical source and destination, current package/entry/platform identity, optional account intent, bounded `.foundry` and root-level `tasks` inventories, independently selected external input facts, explicitly selected stage evidence and blocker/omission lists. `plan_sha256` is the canonical digest of every other field. Arrays are ordered deterministically. There is no current timestamp that would change an unchanged proposal on retry.

The inventory still uses `workspace-migration-plan.v1` and observational path classes. The combined state, queue and external-input selection is limited to 10,000 entries and 256 MiB of hashed bytes; with a 64 MiB per-file bound, 10,000 entries and 64 directory levels. `.env*`, recognized OAuth/session/token/cookie/credential/private-account storage and the host-selected session reference (including an opaque filename) are metadata-only: no content read or new digest. A selected session that collides with `workspace.json` is not opened as a marker and blocks transfer. Their paths are listed under `omitted_private_paths`; omission is not a claim that their content was verified or copied. Oversized non-private files carry explicit blockers, and unsupported source marker schemas remain blocked. The source itself must always be preserved, including excluded files.

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

#108 still owns immutable predecessor/task mapping, current-owner local preparation regeneration, durable no-replay inheritance across task revisions, activation after complete audit, and separate read/write workspace compatibility plus explicit runtime rollback. Tests and private real-case evidence must cover those behaviors before #108 can close. Successful staging alone does not satisfy them.

The v2 plan includes root-level `tasks` automatically and binds each repeated `--input` external file independently. It does not infer external read permission from a path found inside an old manifest. Full task adoption must still prove every referenced external source and later attempt/readback record is accounted for; a snapshot alone does not establish that semantic closure.

As a prerequisite, the current facade now refuses new or existing descendant revisions when a registered predecessor has attempt evidence. It rechecks all earlier task publications and preserves missing/changed history as a blocker. This closes revision-based local continuation around observed attempts; it does not claim cross-workspace migration, external-ledger reconciliation or final mutation no-replay inheritance.

## Explicit staging and audit

Repeat the same independently chosen source, target, actor, request, stage and external-input selections when staging or auditing a saved v2 plan:

```sh
tiangong-foundry workspace migrate --workspace /absolute/legacy-project \
  --to /absolute/new-project --actor agent/session-001 --request migration-001 \
  --input /absolute/original.json --plan /absolute/transfer-plan.json --stage --json
```

Use `--audit` instead of `--stage` to verify an existing transfer without writing. Dry-run accepts the same `--input` selections. Old v1 plans omitted queues/external inputs and cannot authorize staging; regenerate them as v2.

Staging revalidates before taking a version-independent destination lock and again while locked. It prepares a complete control-directory template with a pending marker, immutable claim and exact plan, then publishes that directory only while the target `.foundry` is absent. It never publishes an active workspace marker. Existing state is preserved and rejected. Source files are streamed through hash/descriptor checks into private temporary files, flushed, then installed exclusively; equal bytes may be reused and different existing bytes are never overwritten.

Archived `.foundry` files, root queues and explicit external inputs live under `migrations/<plan-sha>/original/`. Old seals, grants, attempts, queue Markdown and source paths are raw evidence, not current task state. Empty directories are retained; private files remain in the untouched source and their omissions remain bound by the plan. A final `migration-transfer-receipt.v1` binds every copied file and directory after independent destination and source audits. It always records `state=staged`, `activated=false`, and `remote_write_allowed=false`.

`workspace-migration-pending.v1` has only its schema and plan SHA. New `init`/doctor and downlevel runtimes reject normal use; it supplies no workspace id or task authority. The future workspace id is deterministically derived from the full plan identity and recorded in the claim/receipt. Claim, plan, actor, source and destination mismatches stop recovery. Completed transfers are re-audited, not recopied after missing or corrupt history. A recognized partial transfer can resume identical files. Named temporary copy and receipt files live inside its owned scratch directory and are removed on explicit resume, including when interruption occurs after receipt publication; unknown files or links are preserved and block progress. Read-only audit never performs that cleanup.

An interrupted transfer remains pending. Audit and revalidation must pass again before a receipt is written; source drift or destination drift at any tested boundary prevents success. Transfer receipts are bounded to 16 MiB. The migration implementation does not claim an atomic source filesystem snapshot or isolation against arbitrary same-user filesystem tampering. Later task adoption, no-replay inheritance and activation must use these preserved records without treating this receipt as business completion.

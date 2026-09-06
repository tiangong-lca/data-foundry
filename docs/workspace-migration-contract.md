---
title: Foundry Workspace Migration Contract
docType: contract
scope: workspace-migration
status: active
authoritative: true
owner: tiangong-lca-data-foundry
language: en
whenToUse:
  - when planning, applying, auditing or recovering an explicit workspace migration
  - when selecting read/write runtime compatibility or rollback
  - when interpreting retained attempt evidence without granting replay authority
whenToUpdate:
  - when migration planning, state preservation, application, audit or rollback behavior changes
checkPaths:
  - scripts/lib/foundry-migration-inventory.ts
  - scripts/lib/foundry-migration-plan.ts
  - scripts/lib/foundry-migration-stage.ts
  - scripts/lib/foundry-migration-transfer.ts
  - scripts/lib/foundry-migration-transfer-io.ts
  - scripts/lib/foundry-migration-adoption-plan.ts
  - scripts/lib/foundry-migration-adoption.ts
  - scripts/lib/foundry-migration-authority.ts
  - scripts/lib/foundry-migration-replay.ts
  - scripts/lib/foundry-runtime-selection.ts
  - scripts/lib/foundry-runtime-selection-record.ts
  - scripts/lib/foundry-private-path.ts
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
lastReviewedAt: 2026-09-06
lastReviewedCommit: c22bcb2ee562e848e3f36b8d1dc90ab3ccb659ed
lastReviewedNote: "Reviewed for Foundry #112: release roots bind native physical directory identity across Git/Node path casing; migration/current-runtime fixtures follow the executing package version. Different roots, older writers, untrusted manifests, account and no-replay boundaries remain rejected; the production compatibility guard is unchanged."
related:
  - docs/public-runtime-contract.md
  - docs/runtime-context-contract.md
  - docs/foundry-task-contracts.md
  - docs/execution-capsule-contract.md
---

# Workspace migration

Migration is an explicit, source-preserving operation. Install, ordinary init and ordinary resume do not migrate legacy state. The destination becomes active only after copied evidence and regenerated local preparation have passed independent checks. Historical grants, paths, seals and attempts remain evidence; they never become new authorization.

## Transfer and adoption

The public `workspace migrate` operation has five file-operation modes:

1. `--dry-run` binds source, destination, actor, request, selected stage records and explicit external inputs into `workspace-migration-transfer-plan.v2`.
2. `--stage --plan <file>` copies and independently audits the bound control tree, root task queues and external inputs. It publishes only `workspace-migration-pending.v1`.
3. `--adoption-dry-run --plan <file> --task-spec <source-task>=<spec-file>` prepares `migration-adoption-plan.v1`. Repeat `--task-spec` for independently selected tasks.
4. `--apply --plan <file> --adoption-plan <file> --task-spec ...` reconstructs both plans, regenerates eligible preparation through current owners, and publishes an anchored `workspace.v2` marker after audit.
5. `--audit --plan <file>` checks either the pending transfer or the active migration evidence.

Each operation repeats explicit `--workspace <source> --to <destination> --actor <id> --request <id>`, the same repeated `--stage-manifest` selections and the same repeated `--input` files. Task selectors use source-control-relative paths such as `workspaces/issue-123`. A specification is independently selected; paths found in old metadata do not themselves authorize reading another file.

Adoption and active-workspace access require the host's independently trusted CLI product manifest. The public typed factory accepts `workspaceAccess: { manifest, access }`; the CLI host supplies that same boundary. Ordinary argv, task specifications, workspace pointers, environment files and cached observations cannot establish manifest trust. Without a trusted host selection, apply is blocked. `createFoundryFacade(...).migrationAdoption(...)` provides the same preview/apply protocol; `migrationTransfer({ audit: true, ... })` audits the resulting evidence.

## Source and filesystem boundaries

Source and destination are canonical, physically disjoint directories. A new destination may be an existing user project but must have no Foundry control state. Package roots, installed skill roots, filesystem roots, links, traversal and unsupported hosts are rejected. Legacy source records and original inputs remain unchanged, including raw/canonical hashes, CWD, program, argv, profile locks, seals and terminal/attempt evidence.

The transfer inventory covers `.foundry`, root-level `tasks` and independently selected external files. Combined selected state is bounded to 10,000 entries and 256 MiB of hashed bytes, with 64 MiB per file and 64 directory levels. Oversized non-private inputs are blockers. Known credential/session/token/cookie storage and the explicitly selected opaque OAuth session reference are not read or copied; their omissions remain recorded. `account-intent.json` and the registered `state/task-accounts/<id>.json` shape represent identity intent, not OAuth storage.

Plans bind current runtime/package/entry/platform facts. Installed mode also binds the complete package inventory digest; source mode remains explicitly entry-only and is not a provenance claim. Serialized plans must be bounded plain JSON. A fresh reconstruction must match every field, even when a supplied digest has been recomputed. Source, input, runtime, actor or destination drift blocks the operation.

A shared CLI-owned migration lock is keyed by canonical destination and independent of runtime version. Its complete cache path is checked before acquisition, including symlinked cache ancestors, and it cannot be placed in the preserved source. Copies are streamed, hashed and flushed before exclusive publication. Different existing files are preserved and rejected. A completed archive is audited rather than reconstructed after lost or corrupt evidence. Recognized temporary copy/metadata files are confined to owned scratch; unknown state remains a blocker.

## Historical task classes

| Evidence | Adoption behavior |
| --- | --- |
| Complete known local preparation with no retained attempt or unresolved predecessor history | Register a new task identity, remap independently selected sources to verified archive copies, load the current profile and regenerate preparation through current task owners. |
| A terminal report validated through the retained registered task's artifact/receipt lineage | Preserve terminal authority and create no new executable task. |
| Attempted, ambiguous, later, unclassified or incomplete execution history | Keep original-owner status/readback recovery; no local reseal as unattempted. |
| Missing or incompatible source, actor, profile or current task specification | Preserve the evidence and block affected adoption. |

Older job/source-manifest records use `schema_version: 1`; current registrations use the v2 task contracts. The migration keeps their original bytes. Current task specifications must cover the retained source set and preserve lane/profile/entity scope while selecting the current actor and explicit account intent. An old profile waiver or authentication record is never copied into current permission.

A pre-dispatch stage may still declare `UNATTEMPTED` after a later dispatch. Selected stage declarations do not prove complete history or confirmed terminal success. The batch owner can remove successful entries from active attempt state and can clear the event file during compaction; terminal/readback records must therefore remain in the reviewed source closure. Empty or missing compacted logs do not reset authority. Unaccounted shared control records keep affected history under owner recovery.

## Pending preparation and activation

The adoption plan records immutable origin identity, exact task/spec/source mapping, scope evidence and the intended runtime manifest. Source specifications and generated current specifications are preserved separately. Original strings are never rewritten in place.

`target_spec` is a credential-free task template, not an executable task specification. Its account intent contains project/user only. Materialization adds the current task schema and a null session-reference slot; the matching host may supply its CLI-owned reference only in the process context. The original selected specification remains an immutable file snapshot. Session contents are never copied, and inline operation results retain their credential-field rejection.

An internal asynchronous adoption scope supplies the future workspace id only while current owners register and prepare the selected tasks. The physical marker stays pending. The scope admits only the bound local task identities and expires when its callback finishes, including for escaped asynchronous work. Pending state cannot create business authorization or execution admission.

Current source/profile/job registrations, publications, immutable revision pointers and initial source evidence are audited and anchored with the complete archive in `migration-activation.v1`. The active `workspace.v2` marker binds that receipt. Request indexes can append later revisions; each original revision must still match its immutable pointer and fingerprint. Original source facts are checked again immediately before activation. Repeated application verifies the same intent and retained evidence. Interruptions before activation remain pending; interruptions after publication recover from the existing activation instead of creating fresh task history.

A later migration of a v2 workspace retains earlier origin identities and non-executable historical mappings, and rechecks attempts recorded after the first adoption. Missing previously registered tasks are recovery conditions. They cannot be recreated as empty history.

## No-replay admission

Migration scope uses the existing dataset owner's native JSON/JSONL interpretation over content-bound sources and retained native payloads. Scope keys include entity type, UUID and version. Opaque or incomplete source scope remains unknown rather than proving an empty range.

Execution admission rechecks preserved migration evidence independently of the new request, file path or runtime selection. Retained terminal scope cannot re-enter the same mutation scope; unresolved attempts also block version changes for the affected resource. Unknown scope requires original-owner recovery before mutation admission. Independent native dataset scopes can proceed through the ordinary fresh identity, authorization, lineage, QA and CLI no-replay checks. The migration guard grants no permission and does not dispatch, clear or replay an attempt.

Attempts recorded later in an adopted local task remain relevant. Their complete execution-context records and final-row facts are inspected again. Missing or changed history fails closed. The same checks run when a child admission is rehydrated and immediately before it is returned to the existing executor.

## Runtime selection and rollback

Read and write compatibility are separate. V2 requires the `migration-adoption-v1` and `registered-tasks-v2` features and preserves an extension object. The selected writer must match the executing Foundry version, be independently qualified for all required features and understand those write features. Unknown required features cannot be force-written. A read-compatible selection permits diagnostics and verified read-only inspection; it cannot initialize, prepare, register authorization or admit a mutation. Read-only metadata inspection does not acquire a write lock or repair missing state.

`workspace migrate --runtime-use --workspace <project> --actor <id> --request <id> --access read|write` selects a target supplied independently through the trusted host. It cannot be combined with file migration modes. `runtimeUse(...)` is the corresponding typed API. The control-plane selector verifies target compatibility and CLI-managed components, pins current and target component sets with persistent workspace/manifest leases, and saves an immutable selection receipt plus an atomic project pointer. Repeating a request rechecks components. A qualified selector can restore a writer while the project's ordinary task operations remain read-only.

The pointer records intent; it is never its own trust anchor. Subsequent launches still need an independently trusted matching manifest. Previous caches and leases remain available and are not automatically released by rollback. When a managed host supplies runtime-manager options during adoption, the active component set is pinned before activation. Plain source/npm consumers retain their existing package-manager ownership; managed component publication and bootstrap integration are qualified in W08/W09.

Runtime rollback does not rewrite workspace schemas, remove added fields, reset attempts, undo a business mutation or restore macOS Intel support. An older package that cannot read the required schema/features is rejected. Existing task runtime/profile bindings remain additional requirements for task writes.

## Qualification and limits

#108 owns synthetic state-class, source/installed, interruption, forgery, scope and compatibility tests plus fresh official-OAuth frozen-case qualification with zero business writes. Existing #95/214 work and operator workspaces require their own bounded authorization and are not migration fixtures. Final package/component/release qualification and exact workspace integration remain required by workspace #980.

The implementation detects observed drift and preserves source evidence. It does not claim an atomic source filesystem snapshot, isolation from arbitrary same-user filesystem tampering or global revocation of offline historical copies. Operators must select the current owner history and retain the resulting migration references.

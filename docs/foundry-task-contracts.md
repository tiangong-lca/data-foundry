---
title: Foundry Task Contracts
docType: contract
scope: task-ledger
status: active
authoritative: true
owner: tiangong-lca-data-foundry
language: en
whenToUse:
  - when creating or validating Foundry task workspace artifacts
  - when deciding what belongs in foundry-job, source, seed, checkpoint, or artifact ledgers
whenToUpdate:
  - when Foundry task, workspace, checkpoint, or artifact contracts change
  - when new lanes or owner route fields become required
checkPaths:
  - docs/foundry-task-contracts.md
  - AGENTS.md
  - WORKFLOW.md
  - scripts/lib/foundry-task-store.ts
  - scripts/lib/foundry-task-authorization.ts
  - scripts/lib/foundry-execution-admission.ts
  - scripts/foundry-facade.ts
  - scripts/lib/foundry-facade-store.ts
  - scripts/lib/foundry-task-start-spec.ts
  - specs/schemas/authorization-derivation.schema.json
  - specs/schemas/execution-context.schema.json
  - specs/import-profiles.json
  - tasks/**
lastReviewedAt: 2026-09-05
lastReviewedCommit: 4f69b159b473d41bdf99595fe1ba5fe2d9864c5e
lastReviewedNote: "Reviewed for #104 W05: facade request indexes add deterministic retained revisions and task pointers over the unchanged v2 task/attempt authority."
related:
  - AGENTS.md
  - WORKFLOW.md
  - docs/runtime-skill-management.md
  - specs/import-profiles.json
---

# Foundry Task Contracts

The v2 task store is implemented by `foundry-task-registration.ts`, `foundry-task-store.ts`, `foundry-task-io.ts` and `foundry-task-types.ts`. It keeps source/profile/task identity separate from permissions and reuses the published CLI's `withBatchRunLock` for local metadata transactions. It does not perform database mutations or replace the CLI's consumed-attempt/readback recovery contract.

The earlier v1 examples at commit `ad9c885dde64b22f6e0a8e17f9da46bdba5345ef` remain historical input for W10. Existing unregistered directories, v1 jobs, locks and attempts are never relabeled as v2 automatically. Real task #95 remains outside migration scope.

## Layout and authority

```text
<workspace>/.foundry/state/
  task-locks/<task-id>.*
  task-registrations/<task-id>.json
  task-publications/<task-id>.json
  task-accounts/<task-id>.json
  task-authorizations/<task-id>/<authorization-sha256>.json
  task-initialization/<owned-staging-id>/
  facade-requests/<request-sha256>.json
  facade-tasks/<task-id>.json
  facade-request-locks/<request-sha256>.*
<workspace>/.foundry/workspaces/<task-id>/
  foundry-job.json
  source-manifest.json
  profile-lock.json
  seed-manifest.json                 # source-evidence lane only
  account-intent.json                # once an expected account is selected
  authorization.json                # current pointer; not a raw self-authorizing grant
  artifact-index.jsonl
  checkpoints/<operation-id>.plan.json
  checkpoints/<operation-id>.json
  evidence/authorizations/<grant-id>/
  evidence/executions/<execution-context-sha256>.json
  outputs/<operation-revision>/
```

Workspace registration retains the complete intended job/source/profile/seed metadata and a content digest. The task-local copies must match it. Account intent and approved grants also have separate immutable workspace registrations. These records contain no passwords, access tokens or session contents.

Facade request indexes map one explicit request id to retained task revisions. The request key binds workspace id plus request id; a revision fingerprint binds the strict task-start spec and ordered canonical source path/bytes/SHA facts. Task ids derive from the request key and revision ordinal. A changed source path or content, actor/account, lane/profile/entity scope, seed or preparation creates a predecessor-bound task rather than editing the prior job. Same-fingerprint concurrent starts serialize through the CLI-owned lock and return the same task bytes. The immutable task pointer names one exact revision record; status never locates authority by scanning task directories.

## Task creation and recovery

`foundry-job.json` uses `tiangong-foundry.job.v2`. It binds workspace/task/actor/request identity, lane, target profile/entity types, source/profile/optional seed content references, current runtime manifest/entry identity, UTC creation time, and the default `write_policy` of `dry-run` with remote state 0. Task metadata cannot enable a remote write by changing that policy object. Actual permission requires the separate reviewed authorization/execution boundary.

Creation validates selected source bytes and package profile before writing. It builds complete metadata in an owned private staging directory, saves an immutable workspace registration, and publishes the task directory by rename. A publication receipt must exist before operations proceed. A registration without a published task may complete only the same interrupted initialization. Once publication is recorded, a missing task directory is a recovery/audit condition; it must not be recreated with empty operation or attempt history. Missing publication evidence over existing outputs/attempts is ambiguous and remains blocked.

Changed actor, task, workspace, request, profile or target entity intent is rejected. Runtime or profile changes require the pinned version or an explicit migration; they cannot silently invalidate earlier attempts. Same-task local metadata operations serialize under one CLI-owned lock. The lock protects metadata, not permission: acquiring it grants no data authority.

## Frozen inputs and profile

`source-manifest.json` uses `tiangong-foundry.source-manifest.v2` and records the original canonical selected file paths, byte sizes and SHA-256 values, along with workspace/task identity. Current original sources must still match their frozen facts. Unavailable or changed sources require restoration or an explicit new revision. A new revision must retain previous mutation/attempt authority as required by W10; this store does not reset it.

`profile-lock.json` uses `tiangong-foundry.profile-lock.v2` and preserves the selected raw profile and its digest. The lock bytes must match both the registered job reference and the current package's profile. Historical profile authorization flags are not current permission.

The source-evidence lane additionally requires a retained `seed-manifest.json`. The W05 `task-start.v1` spec requires the JSON seed to be one of the independently selected source files. Intake freezes it but does not claim semantic completeness; storing a seed alone does not prove it is ready for authoring.

## Local operation plans and receipts

The first admitted transaction is deterministic local `dataset-curation-cleanup`. Remote mutations, network-driven work and batch execution must not be routed through its replay path.

An operation id binds job bytes, command, exact selected input facts and normalized options. Its immutable plan retains a fixed operation time, so interrupted deterministic preparation can reproduce its artifacts without overwriting prior bytes. A successful operation records all output facts and the exact returned report, then atomically updates `artifact-index.jsonl`. Repeating the same request reads only the matching completed local receipt and revalidates outputs; it does not rerun the command or append duplicate records.

A completed _operation receipt_ means its local invocation produced recorded output. It does not mean the business task is completed or that a blocked cleanup report passed its gates. The facade must interpret the actual result and required completion/readback evidence.

## Artifact lineage

The v2 JSONL index records sequence, previous record digest, operation/command/input-scope identity, producer receipt reference, task-relative artifact path, byte size and SHA-256. The index points to artifacts; it does not copy payloads. It is replaced atomically under the metadata lock, with previous-byte comparison and bounded size. Truncated, malformed or changed chains are rejected.

A derived input must match an indexed output. Its completed producer receipt and plan must match the same job and content digests; every ancestor must lead through earlier index entries to frozen original source. The lineage walk verifies every receipt and plan again and explores every matching earlier producer, so reproducing identical output bytes cannot hide another valid ancestry path. Arbitrary files placed under `outputs/` do not become trusted inputs. Changing a parent receipt or plan invalidates continuation. Current selected input bytes are checked again, including before a local operation receipt is finalized.

## Account and authorization

An expected account may be selected after local preparation. The first selection is registered as project/user intent; subsequent disagreement is rejected. A missing task-local account file may only be restored from its existing workspace registration. This is intent, not proof of authentication.

`verifyFoundryRuntimeIdentity` invokes the exact installed CLI through executable/argv in a fresh private CWD with a restricted environment. The CLI owns OAuth/session refresh and server identity verification. Returned proof is immutable, process-local and bound to workspace/task/actor/runtime, with a 60-second freshness check at permission admission. Serialized proof is not reusable authority. Headless mode uses the CLI's existing explicit target and process-only access token, with cache disabled and no token persistence. CLI 0.1.10 reports no token-expiry timestamp for that mode; Foundry does not invent one or claim a separately verified token lifetime.

`registerFoundryTaskAuthorization` is an explicit host approval operation. It requires fresh identity, current task/input lineage, a valid W03 grant, and independently selected evidence facts supplied by the trusted caller. The grant cannot select its own evidence paths. Each original evidence file is rechecked and copied into an immutable task snapshot; the grant and selection are registered in workspace state. Updating `authorization.json` uses compare-and-swap against its prior digest and preserves historical grants. Unknown legacy authorization files are not overwritten.

`loadFoundryTaskAuthorization` rechecks live identity, task registration, input lineage, active pointer/registration, grant expiry/scope and both evidence snapshots and originals. A previous grant cannot be relabeled for changed or derived inputs. Reusing its approval requires a qualified, process-local derivation that proves ancestry, changes only the input digest, retains authority bounds and records `authorization-derivation.v1` evidence. The active parent pointer is checked around preparation and captured for later compare-and-swap. A separately reviewed approval may instead register the exact derived bytes directly. Login, task creation, local preparation and an empty grant never grant publication, deletion or restricted write actions.

Before a restricted child handoff, the runtime stores a content-addressed `execution-context.v1` under task evidence. A new process must reconstruct the context, qualification and identity, then recheck source ancestry, final bytes, current authorization/QA exceptions, owner CLI path and CommandSpec operation semantics. Only the verified spec is returned to the existing no-replay executor. The execution context never carries credentials and never clears or retries an attempt.

The W05 facade now projects these records through the public result envelope. It automatically resumes only deterministic local cleanup. A nonempty attempt directory returns readback-only recovery; an unindexed copied completion report does not change task status. `completed` requires a current indexed completion report for the same task after source and artifact verification. Other stages remain explicit next actions until their owner evidence is registered; the facade never invents a child command or treats a directory name as task state.

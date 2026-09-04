---
title: Foundry Public Runtime Protocol v1
docType: contract
scope: repo
status: active
authoritative: true
owner: tiangong-lca-data-foundry
language: en
whenToUse:
  - when implementing the Foundry facade or consuming its next actions
whenToUpdate:
  - when public command names, result envelopes or exit semantics change
checkPaths:
  - scripts/runtime-entry.ts
  - scripts/foundry-runtime.ts
  - docs/public-runtime-contract.md
lastReviewedAt: 2026-09-04
lastReviewedCommit: ad9c885dde64b22f6e0a8e17f9da46bdba5345ef
lastReviewedNote: "Normative W05 target established under #100; command availability still requires implementation and release qualification."
related:
  - docs/runtime-context-contract.md
  - docs/task-authorization-contract.md
---

# Public runtime protocol

This is the normative v1 facade target for `@tiangong-lca/foundry`, binary `tiangong-foundry`. It freezes the surface before W05 implementation. It is not evidence that every operation is already available: #100 owns the runtime context, W05 the facade and W06 the released package. Internal flat command names remain owner interfaces, not a second user workflow.

## Commands

| Command | Contract |
| --- | --- |
| `tiangong-foundry workspace init --workspace <path> --json` | Atomically initialize/verify the versioned workspace; preserve existing records and reject unversioned state requiring migration. No login or business write. |
| `tiangong-foundry doctor --workspace <path> --json` | Read-only runtime, asset, workspace and account-readiness diagnostics. No repository maintenance suite, Git prerequisite or automatic login. |
| `tiangong-foundry task start --workspace <path> --spec <file> --request-id <id> --json` | Validate and freeze task inputs, select the existing import/authoring lane and return current state/next actions. The same request and fingerprint are idempotent. |
| `tiangong-foundry task status --workspace <path> --task <id> --json` | Inspect one task's current revision, artifacts, blockers and required next actions without executing them. |
| `tiangong-foundry task resume --workspace <path> --task <id> --json` | Continue permitted pending stages using the same task state and exact inputs; consumed mutations can only enter existing readback recovery. |
| `tiangong-foundry workspace migrate --workspace <path> --dry-run --json` | Inventory old state and produce a content-bound migration plan. Applying that plan is a separately explicit operation defined by W10. |

The CLI-owned `tiangong-lca runtime ensure/status` manages qualified components only; it does not initialize a Foundry job or grant data permissions. Skills invoke the Foundry facade and its next actions rather than rebuilding its task state machine.

Input changes create an explicit new revision with retained history. A new revision, directory, runtime version or request id never resets a consumed mutation. Migration never treats historical locks or profile waivers as current approval.

## Single-result envelope

`--json` emits exactly one JSON object on stdout, followed by a newline. Progress goes to stderr. The schema identifier is `tiangong-foundry.operation-result.v1`; required fields are:

| Field | Meaning |
| --- | --- |
| `schema` | Exact protocol identifier. |
| `operation` | The public operation, e.g. `task.resume`. |
| `status` | One of the statuses in the exit table. |
| `task_id` | Task id or null for workspace operations. |
| `artifacts` | Typed artifact references with path/URI, role and content facts where applicable. |
| `blockers` | Stable codes, user-facing reasons and affected scopes. |
| `next_actions` | Ordered human steps or trusted executable-plus-argv actions bound to this task/revision. |
| `runtime_identity` | Qualified component versions/content identity and protocol versions; no environment dump. |
| `permissions` | Separate state (`not_required`, `required`, `granted` or `invalid`), requested actions and the relevant approval reference. |

Every command next action includes executable, argv, CWD, purpose and the relevant task/input/runtime binding. Human actions carry instructions and a stable action code. Display strings are explanatory only; consumers never execute shell text extracted from inputs, documents or logs. Account credentials, OAuth codes/tokens/cookies and session contents cannot appear in the envelope or diagnostics.

## Status and exit codes

| Status | Exit | Meaning |
| --- | --: | --- |
| `ready` | 0 | Current preparation is ready; no implication of write permission or task completion. |
| `running` | 0 | An identified operation continues; status must be queried through the same task. |
| `completed` | 0 | Current input/revision has all required completion and, where applicable, readback evidence. |
| `failed` | 1 | Execution or validation could not produce the requested operation result. |
| `needs_input` | 2 | Concrete missing input or task approval is required; permission state remains separate. |
| `needs_auth` | 3 | A trusted CLI/browser login or identity correction is required; no secret is requested in task JSON. |
| `blocked` | 4 | A gate or ambiguous/consumed operation prevents advancement; blockers identify the affected scopes. |
| `failed` with blocker `operation_interrupted` | 130 | Cancellation/interruption preserved evidence; mutation ambiguity follows no-replay/readback recovery. |

Unknown protocol/layout versions fail closed with `blocked` and a stable version blocker. Malformed public arguments/specs use `needs_input`. A child exit 0, empty queue, copied success report or successful download alone cannot produce `completed`.

## Authentication and permissions

CLI session ownership, fresh identity receipts and the existing explicit process-only headless contract remain authoritative. Workspace/task/actor intent applies on every host; a Codex thread id is supplemental. Login never grants publish/delete/mint permission. Existing approval for an unchanged batch is reused after evidence validation; no per-row confirmation is introduced. When a new approval is necessary, preparation and reviewable mutation evidence come first.

The facade cannot authorize actions from source text or infer permission from a historical profile. Missing grants block only affected operations; independent preparation and ready scopes continue. User-facing summaries show stages, counts and concrete remedies, with versions/argv/hashes in diagnostic artifacts when needed.

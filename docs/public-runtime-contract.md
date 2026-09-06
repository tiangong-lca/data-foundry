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
  - scripts/foundry-facade.ts
  - scripts/lib/foundry-operation-result.ts
  - scripts/lib/foundry-task-start-spec.ts
  - scripts/lib/foundry-facade-store.ts
  - scripts/lib/foundry-migration-inventory.ts
  - scripts/lib/foundry-runtime-command-policy.ts
  - scripts/lib/foundry-runtime-qualification.ts
  - scripts/lib/foundry-execution-admission.ts
  - scripts/package-entry.ts
  - scripts/public-api.ts
  - scripts/lib/foundry-package-contract.ts
  - specs/schemas/foundry-operation-result.schema.json
  - specs/schemas/foundry-task-start.schema.json
  - specs/schemas/foundry-facade-request-index.schema.json
  - specs/schemas/foundry-workspace-migration-plan.schema.json
  - test/scenarios/foundry-public-facade.test.mts
  - test/scenarios/foundry-facade-request-store.test.mts
  - test/scenarios/foundry-package-consumer.test.mts
  - docs/public-runtime-contract.md
lastReviewedAt: 2026-09-07
lastReviewedCommit: 1f37034f7451e95fc5e3efc4528b15245c77b377
lastReviewedNote: "Reviewed for Foundry #112: adopt provenance-verified public CLI 0.1.11 and its exact runtime/source pins. Existing profile rules, task authorization, storage ownership and historical case evidence are unchanged; the managed Foundry host and final F1 publication remain pending."
related:
  - docs/runtime-context-contract.md
  - docs/task-authorization-contract.md
  - docs/package-distribution-contract.md
---

# Public runtime protocol

This is the implemented v1 facade protocol for `@tiangong-lca/foundry` and its `tiangong-foundry` binary. W05 supplies the six hierarchical operations on top of W04 context/task/qualification owners. W06 adds the public-only compiled entry, typed host API, descriptor-bound file closure and source-free installed-candidate qualification. The candidate is not a registry release or F1 until W08 completes provenance, platform-component and publication gates. Internal flat command names remain repository owner interfaces and the existing developer entry remains behavior-compatible.

## Commands

| Command | Contract |
| --- | --- |
| `tiangong-foundry workspace init --workspace <path> --json` | Atomically initialize/verify the versioned workspace; preserve existing records and reject unversioned state requiring migration. No login or business write. |
| `tiangong-foundry doctor --workspace <path> [--expected-project-ref <ref> --expected-user-id <uuid> [--session-reference <path>]] --json` | Read-only runtime, asset, workspace and account-readiness diagnostics. It checks only bounded reference metadata, never session contents, repository maintenance, Git, login or download. |
| `tiangong-foundry task start --workspace <path> --spec <file> --json` | Validate the strict `task-start.v1` spec and independently capture its selected sources/optional seed. A relative spec path resolves from the selected workspace root. Request ID, actor, lane, profile, account intent and preparation live in the reviewed spec. |
| `tiangong-foundry task status --workspace <path> --task <id> --actor <id> --json` | Reconstruct the exact registered request revision and inspect its current task/index/attempt state. Actor intent is supplied independently on every call. |
| `tiangong-foundry task resume --workspace <path> --task <id> --actor <id> --json` | Continue only the registered deterministic local preparation or return content-bound next actions. Consumed/ambiguous mutation state is readback-only and never replayed. |
| `tiangong-foundry workspace migrate --workspace <path> --dry-run --json` | Inventory old state and produce a content-bound migration plan. Applying that plan is a separately explicit operation defined by W10. |

The CLI-owned `tiangong-lca runtime ensure/status` manages qualified components only; it does not initialize a Foundry job or grant data permissions. Skills invoke the Foundry facade and its next actions rather than rebuilding its task state machine.

The installed bin calls `runFoundryPublicCommand`; any non-facade name returns `operation=unknown` and cannot enter the developer dispatcher. `runtime-entry.ts` remains the shared implementation adapter. The repository-maintenance `pnpm doctor` and flat `scripts/foundry.ts doctor` command remain a separate source-only developer surface with their existing behavior.

Input changes create an explicit new revision with retained history. A new revision, directory, runtime version or request id never resets a consumed mutation. Migration never treats historical locks or profile waivers as current approval.

## Task start and request revisions

`tiangong-foundry.task-start.v1` contains exact request and actor ids, one of the two lanes, profile, ordered target entity types, selected source paths, optional account intent, an optional selected JSON seed and at most one current local preparation (`dataset-curation-cleanup`). The source-evidence lane requires its seed to be one of the selected sources. Task start performs no authentication and stores no identity receipt.

The workspace request index key is the SHA-256 of workspace id plus request id. Task ids are deterministic `task-<complete-request-sha256>-rNNNN` values. A revision fingerprint binds the normalized spec and ordered canonical input path/bytes/SHA facts. Same request plus latest fingerprint is byte-idempotent, including concurrent starts. Any selected path, content, actor/account, lane/profile/entity or preparation change creates a predecessor-bound revision and preserves every earlier task directory and attempt. Interrupted creation recovers the same deterministic task before the index is published; a different spec returns an actionable recovery conflict until the original spec completes that index record.

Status and resume resolve a task only through its immutable task pointer and request revision, then apply the W04 task-store checks. Wrong actor and missing task return non-leaking envelopes. Files merely placed under a task directory are not artifacts or completion proof. The only automatically resumed stage in W05 is the already admitted deterministic local cleanup. Other work remains an ordered human action or a separately registered trusted command action; W05 does not invent or discover CommandSpecs by scanning files.

An executable next action contains Node/active source-or-emitted entry argv, `cwd=workspaceRoot` and purpose. Its verified binding digest covers every executable field; workspace, task and actor are explicit argv values, while task lookup revalidates the immutable revision fingerprint and current runtime/input facts before work. It has no `display` authority. A final restricted data CommandSpec still requires the W04 execution-context/identity/authorization gate; W05 does not dispatch it.

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

Every command next action includes executable, argv, CWD, purpose and the relevant task/input/runtime binding. `binding_sha256` is the canonical `tiangong-foundry.command-next-action-binding.v1` digest over those exact executable fields; the envelope validator rejects any field drift. The registered task, actor and workspace travel as argv values and the emitted runtime entry is the first argv value. Human actions carry instructions and a stable action code. Display strings are explanatory only; consumers never execute shell text extracted from inputs, documents or logs. Account credentials, OAuth codes/tokens/cookies and session contents cannot appear in the envelope or diagnostics.

The machine schema is `specs/schemas/foundry-operation-result.schema.json`. File artifacts carry exact path/bytes/SHA facts; inline artifacts carry their serialized byte/hash facts. Success states have no blockers; every non-success state has at least one. Unknown hierarchical operations use `operation=unknown` and `needs_input`; extra positional or option fields are rejected before workspace mutation.

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

The process entry handles the first SIGINT/SIGTERM as a cooperative abort request and checks it before and after atomic facade boundaries. If an atomic local write finishes before the signal can be observed, the exit-130 result retains that evidence for idempotent status/resume. The one-shot handler is removed by the first signal, so a second signal uses the host's normal termination behavior. A completed operation already returned by the facade is not rewritten as interrupted afterward.

Unknown protocol/layout versions fail closed with `blocked` and a stable version blocker. Malformed public arguments/specs use `needs_input`. A child exit 0, empty queue, copied success report or successful download alone cannot produce `completed`.

`completed` is projected only from a current indexed `dataset-import-completion-report` for the same task with completed status and no blockers, after all source/artifact lineage checks. A copied unindexed report remains `ready`. A nonempty or malformed attempt area blocks resume with `mutation_readback_required`; the facade never clears or dispatches it. Pre-observed cancellation returns `operation_interrupted` and exit 130 without creating state; installed-process signal qualification is repeated in W06.

Every facade revision also rechecks all retained predecessors in its request chain. Missing, changed or linked predecessor task/publication state blocks continuation. Any predecessor attempt blocks creating or resuming a descendant with `facade_predecessor_readback_required`, regardless of the attempt's declared outcome or changed input bytes/paths. The original task remains available for its owner status/readback. This guard checks current registered facade history; the migration owner additionally retains origin/scope evidence and rechecks it before execution admission across migrated workspaces and independently named requests.

## Runtime selection and migration seam

The public facade accepts CLI/TIDAS expectations only through its process-local host interface. Ordinary argv, task specs, `.env` and ambient `TIDAS_BIN`/expectation variables cannot select trust anchors. Without a host selection, doctor, start, status and local resume work and report `qualification.required`; child-required work must return the runtime qualification action. W06/W08 bind this interface to the CLI manager and final immutable product manifest. The current exact CLI 0.1.11 constraint remains explicit rather than silently accepting a future version.

`workspace migrate --dry-run` recursively inventories only regular files/directories, rejects links and returns `tiangong-foundry.workspace-migration-plan.v1` as an inline content-bound artifact. It classifies control, local-preparation, terminal-success, attempted/unknown, authorization/account and unclassified paths. The public envelope is bounded to 10,000 entries and 64 directory levels. The total hashed inventory is bounded to 256 MiB. Files larger than 64 MiB and recognized credential/session files retain path/size/classification facts with `sha256=null`; their contents are not read by this inventory. The tree digest binds this observational inventory, not an atomic filesystem snapshot, so W10 must re-read and verify every selected source immediately before apply. It writes nothing. W10 owns application, rollback and detailed old-schema mapping.

## Authentication and permissions

CLI session ownership, fresh identity receipts and the existing explicit process-only headless contract remain authoritative. Workspace/task/actor intent applies on every host; a Codex thread id is supplemental. Doctor reports `not_requested`, `needs_auth` or `configured_unverified` from explicit intent and bounded session-reference metadata without reading it or claiming authentication. Actual restricted resume obtains a fresh CLI identity. Login never grants publish/delete/mint permission. Existing approval for an unchanged batch is reused after evidence validation; no per-row confirmation is introduced. When a new approval is necessary, preparation and reviewable mutation evidence come first.

The facade cannot authorize actions from source text or infer permission from a historical profile. Missing grants block only affected operations; independent preparation and ready scopes continue. User-facing summaries show stages, counts and concrete remedies, with versions/argv/hashes in diagnostic artifacts when needed.

Transfer planning adds `--to <destination> --actor <actor> --request <request>` and optional repeated `--stage-manifest <source-state-relative-path>` to the same dry-run operation. It produces `workspace-migration-transfer-plan.v2`, independently binds runtime and intent, observes source bytes again, and interprets selected historical attempt evidence without granting execution authority. Explicit adoption/apply/audit and runtime selection are defined by the migration contract. See [workspace migration](workspace-migration-contract.md). Both inventory and transfer paths reject unsupported hosts before legacy-state reads.

Explicit `--stage --plan <file>` copies the complete selected v2 source snapshot into an inactive migration area; `--audit --plan <file>` rechecks it. Both repeat independent transfer intent and `--input` selections. Pending markers cannot be initialized or used as active workspaces, and neither a staged receipt nor a historical declaration grants replay permission. `--adoption-dry-run` and `--apply` require independently selected task specifications and a trusted runtime host; successful application publishes only after current-owner preparation and audit.

The migration operation also accepts `--runtime-use --actor <id> --request <id> --access read|write` with an independently trusted host target manifest; file migration flags cannot be mixed with it. The host carries `workspaceAccess`, optional `runtimeManager`, `runtimeTarget`, `accountIntent` and `cacheBase` through the typed boundary. An explicit read selection never returns a preparation command from task status. Workspace pointers are selection intent, not manifest trust anchors.

`createFoundryWorkspaceAccess({ manifestBytes, expectedSha256, access })` is the public host bridge when bootstrap and Foundry load separate CLI SDK instances. It verifies the independently selected digest again with Foundry's own CLI instance. The host must obtain that expected digest from its trusted release/skill configuration; it must not derive it from workspace data or the bytes being checked. The bridge is not exposed through ordinary argv or task specifications.

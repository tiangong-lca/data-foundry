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
lastReviewedAt: 2026-09-10
lastReviewedCommit: 66fa756cac351ad9cff282141ef7fafe63dfb6e2
lastReviewedNote: "Reviewed for Foundry #151: preserve verified managed launch context in executable next actions and require actual fresh-process qualification in source/public bootstrap proof. Public F1.6 reproduces the failure; the fixed source-free installed candidate passes. Runtime/account/task ownership, existing authorization, no-replay and dependency pins remain unchanged."
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
| `tiangong-foundry task resume --workspace <path> --task <id> --actor <id> [--semantic-input <file> | --authorization-input <file>] --json` | Continue registered preparation, accept bound semantic input/approval, or execute and verify a sealed owner scope through the qualified CLI. Consumed/ambiguous mutation state is readback-only and never replayed. |
| `tiangong-foundry workspace migrate --workspace <path> --dry-run --json` | Inventory old state and produce a content-bound migration plan. Applying that plan is a separately explicit operation defined by W10. |

The CLI-owned `tiangong-lca runtime ensure/status` manages qualified components only; it does not initialize a Foundry job or grant data permissions. Skills invoke the Foundry facade and its next actions rather than rebuilding its task state machine.

The installed bin calls `runFoundryPublicCommand`; any non-facade name returns `operation=unknown` and cannot enter the developer dispatcher. `runtime-entry.ts` remains the shared implementation adapter. The repository-maintenance `pnpm doctor` and flat `scripts/foundry.ts doctor` command remain a separate source-only developer surface with their existing behavior.

For a CLI-managed process, the bin first receives the inherited host context and validates its full manifest, installed entry and inventory-bound Foundry runtime metadata. This completes before any workspace operation. An invalid managed context never falls back to unmanaged execution. Plain installed calls without IPC retain their existing behavior. The package distribution contract owns the metadata shape and read/write/target bindings.

Input changes create an explicit new revision with retained history. A new revision, directory, runtime version or request id never resets a consumed mutation. Migration never treats historical locks or profile waivers as current approval.

## Task start and request revisions

`tiangong-foundry.task-start.v1` contains exact request and actor ids, one of the two lanes, profile, ordered target entity types, selected source paths, optional account intent, an optional selected JSON seed and at most one current local preparation (`dataset-curation-cleanup`). The source-evidence lane requires its seed to be one of the selected sources. Task start performs no authentication and stores no identity receipt.

The workspace request index key is the SHA-256 of workspace id plus request id. Task ids are deterministic `task-<complete-request-sha256>-rNNNN` values. A revision fingerprint binds the normalized spec and ordered canonical input path/bytes/SHA facts. Same request plus latest fingerprint is byte-idempotent, including concurrent starts. Any selected path, content, actor/account, lane/profile/entity or preparation change creates a predecessor-bound revision and preserves every earlier task directory and attempt. Interrupted creation recovers the same deterministic task before the index is published; a different spec returns an actionable recovery conflict until the original spec completes that index record.

Status and resume resolve a task only through its immutable task pointer and request revision, then apply the W04 task-store checks. Wrong actor and missing task return non-leaking envelopes. Files merely placed under a task directory are not artifacts or completion proof. An explicit local preparation retains the deterministic cleanup owner. Without that preparation, a packaged-import request first invokes qualified native conversion, then the exact CLI's contract-context preparation; a source-evidence request begins with contract context. Each resume advances one registered preparation, execution, or readback stage. Other work remains an ordered human action or a separately registered trusted command action; the facade does not invent or discover CommandSpecs by scanning files.

Native conversion uses the selected qualified TIDAS executable with an isolated environment. Automatic format detection omits the native `--from-format` option. Output files, the import report and the adapter result enter the existing content-bound task transaction. A converter-reported failure blocks later stages; successful conversion alone is not task completion. CLI context packs preserve their actual task-contained file references and enter the same index. A new invocation never adopts an interrupted, unindexed context generation.

After context preparation, the facade materializes typed row arrays from the selected seed or the primary native dataset tree. Process-bundle copies remain evidence and are not counted as additional source rows. Derived inputs must have a verified producer in the same task index. Context preparation includes the converted dependency types as well as the requested types.

The assessment stage invokes native schema validation, CLI deterministic QA and the existing curation/authoring owners on the same indexed row files. A process collection also receives a CLI-owned curation queue containing its flow and support closure. Concrete contact/source/unitgroup/flowproperty checks match `support` queue entries only when the underlying row type agrees. A complete native validation batch with data-issues exit code 2 still produces the compatibility report needed for repair.

The compatibility report retains native diagnostic fields and supplies curation's `code` and JSON-pointer `path` from the native issue code/location. Row normalization uses the canonical `json` payload slot for typed API wrappers so native validation, curation and CLI patch application address the same domain payload while preserving row metadata and source lineage.

Curation blockers or authoring tasks produce `needs_input` with references to the registered reports and task manifests. Active row, schema, QA, curation and authoring files are checked before presenting that state; changed bytes block continuation. Public authoring artifacts omit developer-runner execution commands and retain full source/context evidence plus the required English guidance. Assessment readiness is distinct from semantic input acceptance, write authorization and final completion.

After local semantic work is ready, a further resume performs process/flow identity preflight through the qualified CLI. The task spec must already identify the intended project and user; otherwise the result is `needs_auth`. The host may supply explicit OAuth public configuration or process-only headless authentication through `FoundryFacadeOptions.authentication`. Initialization and task start remain credential-free. The facade never inherits ambient tokens, CLI overrides, Node options or preflight result caches.

Preflight reuses the existing request builder, query audit, receipt-bound runner and index merger. Requests target current unwrapped payloads and retain source trace context. Remote reads finish before a local transaction registers their immutable evidence; that transaction cannot replay a remote operation. Registration rechecks current rows under the task lock. Failed reads remain visible as `needs_input` and a later resume may retry the read-only stage. Status never performs a search. Successful preflight invalidates the earlier assessment, and the next resume re-runs curation against its exact identity index. Manual review becomes dedicated identity work even for the generic profile. This read evidence supplies decision context; submitting a bound identity decision remains separate from write authorization.

An executable next action preserves `cwd=workspaceRoot`, the application arguments and purpose. An unmanaged source/emitted host retains its direct Node/package entry. A verified managed host instead selects its exact CLI `runtime exec` command with the original trusted manifest digest, component cache and launch id before the unchanged Foundry arguments. Its verified binding digest covers every executable field; workspace, task and actor are explicit argv values, while task lookup revalidates the immutable revision fingerprint and current runtime/input facts before work. It has no `display` authority. A final restricted data CommandSpec still requires the W04 execution-context/identity/authorization gate; Owner execution validates it immediately before the first dispatch.

After ready assessment and required identity preflight, resume invokes the existing finalize owner. It preserves reference/source/contact/canonical repair, cleanup, native schema, deterministic QA, location audit, curation, dry-run, remote reference verification and mutation/handoff report ordering. Each dataset type uses its own contract pack; Unit Group and Flow Property rows use the owner's support mode separately. Finalization dispatch accepts only local checks, explicit `--dry-run` operations and read-only remote verification, never `--commit`.

Finalization gets a new output generation and fresh current-type identity requests, retaining dependency evidence without overwriting prior indexed reports. Selected producer lineage is verified before remote reads and current rows are rechecked under the capture lock. `foundry-finalize.json` binds the exact rows and assessment. A ready result becomes `needs_input` with `permissions.required` and a current-approval action; blocked results expose their owner reports. Repeating unchanged resume returns the same pending finalization without repeating remote reads. Reference-only scopes continue through independent canonical verification. Sealed approval continues through the owner execution stages described below.

## Owner execution and recovery

A resume after sealed approval first records an immutable owner execution request. It binds the final rows, capsule, exact commit/verify CommandSpecs, account and CLI batch content/policy contracts. The next resume acquires a per-scope lock, obtains fresh identity and revalidates the existing execution admission. No remote mutation runs inside a replayable local task transaction.

Before the first dispatch, the batch attempt-start event durably registers an immutable consumed marker and flushes its append-only event. Only the dedicated consume operation may write that marker under `attempts/owner-v1/<scope>/consumed.json`. The indexed marker preserves no-replay state even if mutable event logs disappear. Unknown, truncated, conflicting or altered attempt evidence cannot permit another write.

Each owner command is dispatched once as executable plus argv with explicit authentication and `shell=false`. Commit stdout must match its contained report. A confirmed success requires the existing closeout checks and fresh independent root, owner, state, payload and reference verification. Lost or unknown responses and narrowly recognized same-identity conflicts use independent readback; known business failures remain unresolved. Recovery does not require the old write grant to remain unexpired and cannot change the original request. The CLI batch item's verified/recovered result determines success; aggregate batch completion alone is insufficient.

Every readback gets a fresh output directory. A verified result binds the exact input, report and JSONL check hashes. Completed scopes preserve their final rows while dependent scopes are finalized again after new verified progress. Reference-only partitions use the separate canonical verification stage below; semantic changes cannot replace consumed scope rows.

## Canonical reference verification

Identity reuse retains original source rows in the reference partition and selects different canonical targets in its rewrite evidence. After current finalization, resume verifies those selected table/id/version targets through the qualified CLI `dataset verify-remote --root-policy existing`. Its generated query contains only reference descriptors. It does not compare the source payload with the reused dataset or construct a write candidate.

The verification scope binds current row metadata, exact identity/partition/rewrite artifact facts, canonical targets and the current account. Each original reference row needs one matching canonical decision. A fresh CLI identity and explicit authentication environment provide the account's current read visibility; missing or hidden targets remain unresolved.

Success requires matching fresh stdout/report bytes and exactly one successful JSONL check for each requested target, with matching row index, table, id, exact version and latest version. Missing, duplicate, substituted or outdated checks cannot establish completion even if the summary claims success. Each attempt has a new output directory; local capture rechecks the current scope under the task lock. No mutation or write grant is involved.

Status performs local evidence verification only. Failed verification exposes `reference_verification_required` and a bound resume action for another read. A successful current result is reused without another remote query. Completion also requires every remaining write scope to have its independent owner readback. Changing an indexed report, query or check invalidates the proof and cannot preserve completed status.

## Authorization input

`--authorization-input` selects a strict `tiangong-foundry.authorization-input.v1` descriptor separately from semantic input. It binds task, actor, current finalization SHA-256, dataset type, `input_kind` (`current_rows` or `final_rows`), input SHA-256 and expected previous authorization-pointer SHA-256 (null for initial registration). It separately selects a grant file and unique user-decision/source-model evidence files with hashes. At least one user-decision item is required; each file is bounded to 8 MiB and the selection to 64 MiB. Credential and linked-file inputs are rejected. The grant's evidence references must use the selected canonical absolute paths, as required by the existing registration contract.

Finalization exposes per-scope `authorization_inputs` with independently computed bindings and input digests. These are review metadata, not grants. The trusted caller must select approval evidence from actual current user authorization; task output or grant text alone cannot supply approval. The existing validator checks the grant, current CLI identity and scope; registration rechecks current finalization while holding the task lock and uses the existing compare-and-swap pointer. Concurrent distinct initial grants cannot both activate.

For a ready `final_rows` scope, the runtime rebuilds the original owner handoff under the validated grant, binds CommandSpec artifacts to absolute final-row paths, and creates the existing execution capsule. It registers a `foundry-authorization.json` result; identical current submissions reuse it without re-authentication or another capsule. Projection requires the matching current finalization, active pointer digest and unexpired record. A sealed result is explicitly pending execution and never dispatches a mutation. `current_rows` registration records preparation approval. Subsequent resume re-finalizes the selected type under that current grant, then proves final-row lineage and derives/activates the exact successor before sealing. Actions, evidence, account/profile binding and expiry are unchanged. Equal-byte derived files reuse the original grant only after lineage proof. A capture interruption after activation resumes from the retained preparation approval and verifies the active grant is its exact derivation; it does not request another approval. Blocked re-finalization retains its reports without repeating remote reads. Existing authorization, capsule and no-replay rules remain authoritative for subsequent execution.

## Single-result envelope

### Semantic input

`--semantic-input` selects a `tiangong-foundry.semantic-input.v1` JSON descriptor. The descriptor binds the same task and actor, the current assessment artifact SHA-256, and a bounded `submissions` array. Each entry has `kind=patch`, `classification`, `location` or `identity`, the registered owner task's SHA-256, a selected input file and its SHA-256. File paths resolve from the explicit workspace. Duplicate work-item digests, unknown fields, credential paths and changed bytes are rejected. Each file is limited to 8 MiB and the complete selection to 64 MiB.

The public runtime independently resolves work through the current task index; a caller cannot supply a replacement manifest or runtime trust anchor. It snapshots the descriptor and selected patch bytes into a new task-owned generation, then uses a projection of the trusted authoring manifest to collect only the selected tasks. Original work items are unchanged. Public acceptance requires structured evidence, basis and the available required context kinds even when the historical profile did not demand them.

Patch inputs use the exact CLI's local `dataset patch apply`, with authoring-package and action-item closure checks. Classification and location inputs use their existing dedicated deterministic owners and exact task context-bundle checks. Assessment prepares their task, schema context, queue and template from current row findings; it does not select codes. Decision files accept the owner's JSON/JSONL forms. One submission may select only one owner per row type, requiring reassessment before another owner uses the changed rows. Public tasks omit developer-runner commands.

An output file alone is insufficient: only successful owner execution, `status=completed`, zero blockers and preserved row count can select repaired rows. Invalid proposals retain diagnostics and leave the current rows unchanged. A successful submission publishes a new indexed row manifest, preserves the predecessor, and makes a subsequent resume assess that new version. Identical accepted submissions are idempotent; different submissions against an old assessment are rejected. The current assessment is revalidated under the task lock before publication so concurrent submissions cannot overwrite each other.

Identity submission selects one task per call because reuse can affect other row types. Every decision must match a current task identity, its exact context bundle and its registered authoring-package snapshot and digest. Snapshot paths are checked before the owner may read them. Reuse requires the matching dataset table and explicit canonical id/version. The existing identity owner produces output, reference-reuse and unresolved partitions; their combined row contents must exactly preserve the input scope. A completed reuse also runs the existing process-reference rewrite owner, retaining original row metadata. Current row manifests retain identity and rewrite report references even when all local write candidates become reference reuse. A later assessment consumes those reports; changed row lineage requires a fresh preflight before write planning.

Unresolved or failed identity application retains its diagnostic partitions and leaves the previous rows current. Resolving or externalizing unresolved references remains necessary before a write handoff. Semantic input is local preparation: it grants no write permission and clears no attempts. Reference-only local resolution is not final task completion.

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

`completed` requires either a current indexed `dataset-import-completion-report`, or verified execution results covering every current write scope with every current reference-only partition independently verified. The task store verifies producer plans, receipts and artifact hashes before either projection. A copied unindexed report cannot prove completion. Recognized consumed owner requests return `mutation_readback_required` and a bound readback continuation; unknown or malformed attempt state remains blocked. The facade never clears attempts or redispatches consumed mutations. Pre-observed cancellation returns `operation_interrupted` and exit 130 without creating state; installed-process signal qualification is repeated in W06.

Every facade revision also rechecks all retained predecessors in its request chain. Missing, changed or linked predecessor task/publication state blocks continuation. Any predecessor attempt blocks creating or resuming a descendant with `facade_predecessor_readback_required`, regardless of the attempt's declared outcome or changed input bytes/paths. The original task remains available for its owner status/readback. This guard checks current registered facade history; the migration owner additionally retains origin/scope evidence and rechecks it before execution admission across migrated workspaces and independently named requests.

## Runtime selection and migration seam

The public facade accepts CLI/TIDAS expectations only through its process-local host interface. Ordinary argv, task specs, `.env` and ambient `TIDAS_BIN`/expectation variables cannot select trust anchors. Without a host selection, doctor, start, status and local resume work and report `qualification.required`; child-required work must return the runtime qualification action. The managed bin now obtains this selection from the CLI IPC context and its verified component metadata. The final immutable production product manifest remains a W08 deliverable. The current exact CLI 0.1.13 constraint remains explicit rather than silently accepting a future version.

`workspace migrate --dry-run` recursively inventories only regular files/directories, rejects links and returns `tiangong-foundry.workspace-migration-plan.v1` as an inline content-bound artifact. It classifies control, local-preparation, terminal-success, attempted/unknown, authorization/account and unclassified paths. The public envelope is bounded to 10,000 entries and 64 directory levels. The total hashed inventory is bounded to 256 MiB. Files larger than 64 MiB and recognized credential/session files retain path/size/classification facts with `sha256=null`; their contents are not read by this inventory. The tree digest binds this observational inventory, not an atomic filesystem snapshot, so W10 must re-read and verify every selected source immediately before apply. It writes nothing. W10 owns application, rollback and detailed old-schema mapping.

## Prepared support authorization

Cleanup may change the byte representation of a Unit Group or Flow Property before its input-bound permission is reapplied. When the selected scope is blocked only by `reference_only_support_type_write_blocked` and the retained approval includes both its exact write action and `canonical_support_local_mint`, resume may derive the grant against the already indexed final-row lineage. It then re-finalizes that scope using the newly bound input and original approval origin. Actions, evidence, account/profile and expiry remain unchanged. Schema, content, reference and other blockers cannot enter this path.

Finalization records which authorization hash it used; a still-blocked result under that same grant is retained instead of repeatedly running the stage. Completed scopes preserve their original reports and final-row generations during both ordinary dependency finalization and later prepared-approval continuation. A ready scope with an already activated derived grant returns a bound continuation command to finish sealing, without requesting another approval.

## Account verification mode

The optional `account_intent.account_mode` task field selects `ordinary` or `production-test`; omission retains the existing ordinary behavior and serialized shape. An explicit mode participates in the request fingerprint. Its workspace/task account registration is immutable, so resuming the same task with a different effective mode is rejected. Migration task templates preserve the explicit mode while omitting session references. An explicitly selected host mode for the same account must agree with the task mode. Ambient `FOUNDRY_ACCOUNT_MODE` cannot set or change public task intent.

Finalization and sealed handoffs receive that registered mode explicitly, and stored execution requests recheck it. In ordinary mode, a failed root payload comparison may use the existing traceHash acceptance owner. The pinned public CLI reports completed remote-verification blockers with exit 1; the adapter distinguishes that data result from usage/native-tool exits before considering acceptance. It obtains a fresh payload through qualified CLI `flow get` or `process get` with explicit authentication, executable/argv and retained command/log artifacts. The fresh payload and selected local domain payload must match the original check's raw hashes; only then may equal payloads after removing `tiangongfoundry:importTraceSummary.traceHash` be accepted. Canonical `json` row envelopes are unwrapped without changing input files. Original failed verification files, fresh reads and separate acceptance evidence remain indexed.

Production-test mode never invokes traceHash acceptance: owner/state/identity/version and complete payload must match exactly. Other payload changes, mismatched fresh-read hashes, missing or hidden references, and unresolved checks remain blocking in every mode. Recovery stays read-only and cannot replay the consumed mutation.

## Authentication and permissions

CLI session ownership, fresh identity receipts and the existing explicit process-only headless contract remain authoritative. Workspace/task/actor intent applies on every host; a Codex thread id is supplemental. Doctor reports `not_requested`, `needs_auth` or `configured_unverified` from explicit intent and bounded session-reference metadata without reading it or claiming authentication. Actual restricted resume obtains a fresh CLI identity. Login never grants publish/delete/mint permission. Existing approval for an unchanged batch is reused after evidence validation; no per-row confirmation is introduced. When a new approval is necessary, preparation and reviewable mutation evidence come first.

The facade cannot authorize actions from source text or infer permission from a historical profile. Missing grants block only affected operations; independent preparation and ready scopes continue. User-facing summaries show stages, counts and concrete remedies, with versions/argv/hashes in diagnostic artifacts when needed.

Transfer planning adds `--to <destination> --actor <actor> --request <request>` and optional repeated `--stage-manifest <source-state-relative-path>` to the same dry-run operation. It produces `workspace-migration-transfer-plan.v2`, independently binds runtime and intent, observes source bytes again, and interprets selected historical attempt evidence without granting execution authority. Explicit adoption/apply/audit and runtime selection are defined by the migration contract. See [workspace migration](workspace-migration-contract.md). Both inventory and transfer paths reject unsupported hosts before legacy-state reads.

Explicit `--stage --plan <file>` copies the complete selected v2 source snapshot into an inactive migration area; `--audit --plan <file>` rechecks it. Both repeat independent transfer intent and `--input` selections. Pending markers cannot be initialized or used as active workspaces, and neither a staged receipt nor a historical declaration grants replay permission. `--adoption-dry-run` and `--apply` require independently selected task specifications and a trusted runtime host; successful application publishes only after current-owner preparation and audit.

The migration operation also accepts `--runtime-use --actor <id> --request <id> --access read|write` with an independently trusted host target manifest; file migration flags cannot be mixed with it. The host carries `workspaceAccess`, optional `runtimeManager`, `runtimeTarget`, `accountIntent` and `cacheBase` through the typed boundary. An explicit read selection never returns a preparation command from task status. Workspace pointers are selection intent, not manifest trust anchors.

Runtime selection from a managed installed package revalidates ownership of its current component cache before leasing current and target components. Rollback does not require the target to contain the executing package; its independently trusted current host manifest remains the ownership authority. A damaged, incomplete or unrelated cache fails before replacement beneath the running package, while ordinary workspace and source exclusions remain enforced.

A managed launch policy can supply a target manifest as a file already bound by the current trusted component inventory. `null` selects the current manifest. This supplies the existing `runtimeTarget` host seam without a manifest-path or digest option in ordinary argv. The same host also supplies its component-cache root, which is excluded from workspace operations before marker reads or writes.

`createFoundryWorkspaceAccess({ manifestBytes, expectedSha256, access })` is the public host bridge when bootstrap and Foundry load separate CLI SDK instances. It verifies the independently selected digest again with Foundry's own CLI instance. The host must obtain that expected digest from its trusted release/skill configuration; it must not derive it from workspace data or the bytes being checked. The bridge is not exposed through ordinary argv or task specifications.

Unexpected runtime failures retain the generic failure code and safe message; recognized filesystem/Node error codes may be included without raw exception text, paths or user data. This helps identify host failures while preserving the non-leaking error envelope.

Context, assessment and semantic stages allocate new task-contained directories with exclusive creation, including long Windows task paths. A prior generation is retained rather than reused after interruption.

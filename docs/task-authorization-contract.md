---
title: Foundry Task Authorization Contract
docType: contract
scope: repo
status: active
authoritative: true
owner: tiangong-lca-data-foundry
language: en
whenToUse:
  - when admitting an account-local support or elementary operation
  - when loading import rules, task permission or historical profile evidence
whenToUpdate:
  - when task binding, allowed actions, waiver evidence or replay boundaries change
checkPaths:
  - scripts/lib/task-authorization.ts
  - scripts/lib/foundry-task-authorization.ts
  - scripts/lib/foundry-execution-admission.ts
  - scripts/lib/foundry-package-contract.ts
  - scripts/public-api.ts
  - docs/package-distribution-contract.md
  - scripts/lib/import-curation/internal/profiles-config.ts
  - scripts/lib/import-curation/mutation-manifest.ts
  - scripts/commands/commit-handoff.ts
  - scripts/commands/identity-decisions.ts
  - specs/import-profiles.json
  - specs/schemas/task-authorization.schema.json
  - specs/schemas/authorization-derivation.schema.json
  - specs/schemas/execution-context.schema.json
  - test/unit/task-authorization.test.mts
  - test/unit/task-profile-authority.test.mts
  - test/scenarios/foundry-execution-admission.test.mts
lastReviewedAt: 2026-09-11
lastReviewedCommit: abc7672f3b3a806caa4219ab5b797f1d92421926
lastReviewedNote: "Reviewed for #122: explicit task reference snapshots, CLI 0.1.14 QA/intent transport, sealed admission/readback evidence and no-replay recovery. Existing profile, permission, environment and historical delivery boundaries remain enforced."
related:
  - docs/architecture.md
  - docs/safety-policy.md
  - docs/foundry-task-contracts.md
---

# Task authorization

The persisted host boundary is implemented in `foundry-task-authorization.ts` and `foundry-runtime-identity.ts`. See `foundry-task-contracts.md` for workspace registration, evidence snapshots, active-pointer compare-and-swap and current-identity revalidation. Registration requires independently selected host evidence; merely writing a grant file or copying a success report grants no authority. `foundry-execution-admission.ts` owns the last internal rehydration gate before the existing no-replay owner receives a CommandSpec. The installed W06 package verifies code/assets and exposes the W05 facade, but package integrity, import success or possession of its public API grants no task action.

Import profiles describe source formats and domain constraints. They do not identify an account or approve an action. Selecting BAFU, USLCI or Worldsteel, loading a historical profile file, passing a waiver flag, or logging in cannot grant an exception.

The task host owns the current workspace/task/actor intent, frozen inputs and fresh CLI identity. It validates a separate `tiangong-foundry.task-authorization.v1` record against those independently assembled facts. `validateTaskAuthorization` returns an immutable, process-local authorization. `profileFor` accepts it only with the same current binding and the digest of the selected rule profile. A serialized report, copied profile object or boolean is never that validated authorization.

The runtime host revalidates persisted authorization through its explicit loader; every new process must obtain current identity and the same stored task/input binding. When qualification is present, registration and loading require an identity bound to that exact qualification. The profile API itself has no ambient file search or environment flag granting permission. Native validation and other public preparation remain available without a restricted action grant; only commands that select or hand off restricted scopes declare the authorization boundary.

The public facade does not authenticate during workspace initialization or task start. A request revision may retain non-secret account intent, but login/session readiness and task permission remain separate. Local preparation and read-only identity preflight report `permissions.not_required`. Any restricted action must first register its requested actions and approval reference, then rehydrate current qualification, identity and this authorization before exposing a child CommandSpec.

The extended public workflow may authenticate for read-only identity preflight after local semantic preparation. Its task account intent and fresh CLI receipt select the read scope. Host authentication is explicit; OAuth configuration is public and headless tokens stay process-only. Query receipts and current-row identity reports are evidence, never an action grant. Preflight does not consume, reset or dispatch a mutation attempt; subsequent permission admission still requires its own current identity and approval checks.

## Required binding and evidence

The public facade accepts explicit approval selection through `--authorization-input`, whose descriptor/schema is owned by `public-runtime-contract.md`. Finalization supplies reviewable bindings and current input digests, never an issued grant. Registration uses an internal current-state check under its metadata lock before activation, so an approval for an older finalization cannot replace current state. The existing expected-previous-pointer compare-and-swap remains mandatory.

Ready final-row approval rebuilds the existing commit handoff and seals a capsule without dispatching it. Host evidence selections remain independent of grant text, and evidence paths are canonical. Prepared-row approval is continued through current-grant re-finalization and the existing derived-grant helper. Activation uses its returned pointer guard; sealing retains the original approved ancestor. Interrupted post-activation capture verifies the active grant against that original approval before recovering. A registered or sealed report does not relax fresh identity/admission checks or clear consumed attempts. An optional native execution contract selected for final Flow, Process or Source rows is an independently hashed control input, not a grant. Handoff and admission bind its immutable task snapshot alongside final rows and recheck insert-only owner/project/state/action intent. The qualified CLI retains native attempt and transaction ownership; completion requires its matching execution receipt plus independent root verification.

The exact v1 binding contains `workspace_id`, `task_id`, `actor_id`, `project_ref`, `user_id`, `profile_id`, `profile_sha256`, and `input_scope_sha256`. The profile digest is the stable, key-sorted JSON digest of the selected raw rule profile. Input scope is independently frozen by the task host; it must prove current source bytes and downstream lineage, rather than copying the digest from the grant. At a row-consuming permission boundary it is the SHA-256 of that exact input file; commit handoff checks the final-row artifact bytes again. A transformed row file needs a newly bound grant supported by the retained task approval and verified lineage, never silent reuse of the old digest. A binding mismatch invalidates every exception in that grant.

The grant is a local approval record, not an authentication credential or server-issued token. It contains no passwords or session contents. The owner CLI verifies current identity; ordinary write policy, schema, context, closure, dry-run, exact final-row hashes, account guards and readback remain separate required checks.

Grant issue/expiry timestamps use exact millisecond UTC format. A grant must be current, cannot be issued more than five seconds in the future, and has a maximum 24-hour lifetime. A running host rechecks expiry before using an exception. Continuing an already approved unchanged batch uses retained approval evidence; it must not invent broader scope or treat an expired serialized result as live permission.

`remote_state_code` is exactly `0`. Each evidence item has a unique id, kind, reference and content SHA-256. At least one `user-decision` item is required. The host must retain the referenced approval/source documents and verify their bytes when assembling the task context. Source-model evidence alone cannot approve a policy exception. Unknown fields, actions, duplicate actions or malformed evidence are rejected.

## Actions

| Action | Permitted exception | Still required |
| --- | --- | --- |
| `elementary_flow_create_new` | Select a new elementary identity in the exact task scope | Full-context identity evidence and canonical-first search; a separate write grant before remote handoff |
| `elementary_flow_write` | Include an elementary row in an owner-draft write plan | All row, account, closure, dry-run and readback gates |
| `flowproperty_write` | Include the exact Flow Property write scope | Unit evidence, same-owner draft state and reference closure |
| `unitgroup_write` | Include the exact Unit Group write scope | Unit evidence, same-owner draft state and reference closure |
| `canonical_support_local_mint` | Admit the task's canonical-gap support mint route | The corresponding FP/UG write action; canonical matches remain reuse-only |

A single action never enables another. A mixed support handoff checks the actual final rows, not just the report's declared `support` type. A ready legacy finalize/mutation report cannot bypass this check. Non-generic handoffs require the mutation manifest to record the current `profile_rules_sha256`; used QA exceptions carry `required_qa_waiver_codes` and must still be authorized at handoff. No action grants publication, deletion, foreign-row visibility, review completion, full-context relaxation or replay.

## Derived input and execution admission

When a selected derived artifact has identical bytes to the registered input, the loader may reuse that same content-bound grant after proving the registered input's producer lineage to the selected path. It rechecks the active pointer, current identity, binding and expiry after the lineage check. An independent equal-byte copy without an indexed derivation is rejected; grant/registration bytes are not rewritten merely to accommodate a new path.

`prepareDerivedFoundryTaskAuthorization` may reuse a current approval only after the indexed receipt/plan graph proves that the selected final rows descend from the approved input. It requires the exact qualified runtime and identity. The successor changes only `input_scope_sha256`; task/account/profile binding, issue and expiry times, actions, QA waivers and evidence remain byte-equivalent in authority. The active pointer must still name the parent before and after preparation, and later activation uses its captured digest as the compare-and-swap base. `authorization-derivation.schema.json` records both content facts and parent/successor digests. It does not activate the successor.

The content-addressed `tiangong-foundry.execution-context.v1` document records the current qualification, authorization, approved ancestor, final rows, sorted required actions and QA waivers, and exact CommandSpec digest. Rehydration accepts it only from the task's `evidence/executions/` root, then independently rechecks all current facts. The owner CLI must be entered through the qualified Node/CLI path, use one exact final-row input, keep outputs inside the task root, and select a reviewed owner-draft commit operation. FP/UG actions must match the requested dataset type and account-local flag; elementary create requires the corresponding write action; a canonical support mint requires the matching FP or UG write action. An unrelated command with a valid hash is still rejected.

This execution context is not the earlier `foundry-execution-capsule-stage.v1` offline admission document. Neither document changes a consumed attempt. The new gate returns the verified CommandSpec to the existing executor; it does not spawn, retry, clear or relabel a mutation.

## Local preparation and domain rules

Preparing candidate JSON, preserving input evidence, deriving public canonical reference proof and normalizing references are local operations. They can run before a task receives restricted write permission. `prepareAccountLocalSupportCandidates` only selects local canonical-gap preparation; it does not authorize a database mint. The retired `allowAccountLocalSupportAndElementary` command option cannot supply task authorization. The Worldsteel adapter's existing `mintUnmatchedFpUgSupport=true` likewise selects a preparation route; final write admission remains action-bound.

Both unit-scale blockers remain active during candidate preparation: `canonical_support_amount_scaling_required` for a known positive non-1 factor, and `canonical_support_amount_scale_unresolved` for missing/non-finite/non-positive scale. Local preparation cannot move private rows into the public canonical cache.

USLCI's `preserve_referenced_review_sources` domain rule retains a source referenced through `referenceToCompleteReviewReport` as preparation evidence. It does not relax true-source content checks or make that source commit-ready. Public canonical UG/source proofs are derived from the checked cache and source semantics regardless of whether the task can write new support rows.

Worldsteel's naming rule classifies only the single trailing `Global` or `EU` plus data-year match, optionally followed by `v<number>`, in a process `baseName`. It applies only to the `latin-author-year` marker. Any additional author/year match, table/figure marker, other name field or other dataset type remains subject to the content policy. Adding another geography requires reviewed source evidence and tests. No whole content-policy rule is waived by a profile.

## QA exceptions

The only v1 QA exception is `process_material_balance_deviation` for `process`. The task must provide both user approval and referenced, content-bound `source-model` evidence demonstrating why this exact source scope is an aggregation/formula observation. The source format name or presence of `LCI_RESULT` alone is insufficient. Other QA codes, schema errors, unit-scale errors, missing references and full-context requirements cannot be waived by this contract.

## Disposition of historical fields

The evidence source is `specs/import-profiles.json` at `1374961f11d46546acc46398bbdbaa9eb0d2b73e`. It remains retrievable in Git; operators' original `profile-lock.json` files are not rewritten.

| Profile / historical field | Classification | Current disposition |
| --- | --- | --- |
| Generic format, docs and no-waiver defaults | Distributable rules | Preserve |
| BAFU full-context/schema/classification/location proof | Distributable rules | Preserve strict requirements |
| BAFU `authorized_by` 2026-06-15 and five enabled mint/write actions | Account/task approval | Remove from distributed defaults; require a current bound grant |
| BAFU process material-balance waiver | Source observation plus policy exception | Keep as an evidence-required candidate; no automatic waiver |
| USLCI D4 2026-06-23 elementary/FP/UG authorization, 1,056-scope and 7/4 counts | Historical delivery and account approval | Retain historical evidence only; counts grant no authority |
| USLCI D3-QA 2026-06-24 aggregation/formula waiver | Exact task decision | Require current approval and source-model evidence |
| USLCI referenced review-source retention | Local source-evidence rule | Preserve only the referenced review field; final content gates still apply |
| Worldsteel R3 2026-06-29 elementary allowance | Historical account/scope approval | No inherited residual-count or mint permission |
| Worldsteel R5 2026-07-01 unmatched FP/UG support and LANCA 10+10 / 11+11 observations | Historical approval plus retained data evidence | Preserve canonical-cache-miss preparation, ordering and evidence; require exact current actions to write |
| Worldsteel process material-balance waiver for 33 LCI-result processes | Exact source/task exception | Current approval and source-model proof required |
| Worldsteel whole `source_locator_in_dataset_name` waiver | Over-broad encoding of a legitimate naming convention | Replace with the field/marker/value rule above |
| Worldsteel `full_context_ai_completion.scoped_relaxation` 2026-06-30 | Historical task approval | New tasks require strict full-context proof; reading the old field cannot relax it |
| `waiveQa` / `waiveQaCode` / `waivedQaCode` options | Unbound operator request | Never grant permission without the supported task QA exception |

## Old tasks and replay

This contract does not edit old locks, task inputs, checkpoints, sealed attempts or already verified records. Migration must produce a separate reviewed mapping, not relabel historical evidence as new authorization. A fresh grant never resets a consumed attempt or permits a second mutation. Existing no-replay/readback recovery remains authoritative. Real task #95 and its records are outside this refactor's migration scope.

Read-only or pending workspace contexts cannot register/derive authorization or admit a business command. After activation, preserved migration scope is checked at execution-capsule creation and before/after admission revalidation. A fresh grant does not reset retained attempt authority. Original profile/account/approval files remain archived evidence, while new permission still needs the independently selected current identity, exact input lineage and reviewed scope.

For public prepared FP/UG input, a captured finalization blocked solely by the support permission gate may derive the existing complete support approval through registered input lineage, then rerun local finalization on those exact approved bytes. Missing write/mint actions and unrelated blockers remain pending. This adds no permission, extends no expiry and cannot replay a consumed scope.

Explicit reference inputs and their review files are control evidence, not authorization or QA waivers. A new selection invalidates the finalization projection; prepared/consumed scopes cannot replace it. Admission requires the same independently selected intent, passing precommit report and review-file facts in both CommandSpecs, alongside final rows and any native contract. Readback rechecks this evidence even when the mutation response is unavailable.

After local handoff preparation, the public workflow validates the earlier identity context and obtains a fresh identity from the same qualified CLI and explicit authentication context before capsule creation. Age expiry of the earlier receipt is tolerated at this boundary; context or runtime mismatches propagate. An unconsumed execution also obtains a fresh identity after initial rehydration and before its second complete pre-dispatch admission. Both full admission passes remain required, and the attempt is not consumed until they pass. Capsule/admission checks independently revalidate the active grant, task/account binding, lineage and evidence. New identity receipts do not extend grant lifetime or reset attempts; the 60-second freshness bound is unchanged.

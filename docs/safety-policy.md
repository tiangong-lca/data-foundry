---
title: Foundry Safety Policy
docType: policy
scope: remote-write-safety
status: active
authoritative: true
owner: tiangong-lca-data-foundry
language: en
whenToUse:
  - when deciding whether a Foundry import scope may proceed from dry-run to remote commit
  - when reviewing task write policy, mutation manifest, commit handoff, readback, or human approval requirements
whenToUpdate:
  - when remote commit gates, human approval boundaries, write policy, or blocked-scope recovery rules change
checkPaths:
  - docs/safety-policy.md
  - WORKFLOW.md
  - README.md
  - AGENTS.md
  - docs/foundry-task-contracts.md
  - docs/import-profiles/bafu/profile.md
  - docs/import-profiles/bafu/constraints.md
  - specs/automated-lca-capability-registry.json
  - specs/workspace-capability-adapters.md
lastReviewedAt: 2026-08-25
lastReviewedCommit: e94db0428e3508e68617bb1878c7e8dbec904def
lastReviewedNote: "Reviewed for Issue #65: authoritative argv handoffs bind final-row bytes, and foreign/RLS-hidden state-0 missing rows never count as successful readback."
---

# Safety Policy

## Default Write Mode

`dry-run`.

## Remote Commit

Remote database writes are blocked unless:

- the task explicitly permits commit
- the workflow policy permits commit
- the exact write scope is included in the task write policy and, for batch runs, was claimed through queue locks within configured `max_parallelism`
- schema validation passes
- deterministic QA and Foundry curation pass
- source evidence is present for authored fields
- profiles that require full-context AI semantic completion have an AI authoring package containing SDK schema, methodology YAML, runtime ruleset, profile constraints, queue/dependency closure, source row, and current entity payload before any semantic field is accepted
- blocked Foundry authoring packages, when present, were converted into explicit `dataset-authoring-task-build` task artifacts before AI output was accepted
- AI-authored patch outputs, when produced as task files, were collected through `dataset-authoring-patch-collect` with a `ready_for_patch_apply` report and no incomplete template, unresolved placeholder, missing evidence, package mismatch, or unclosed action-item blocker
- AI-authored field changes, when present, were applied through `dataset-patch-apply` / `tiangong-lca dataset patch apply` with a completed apply report
- AI-authored patches, when produced from Foundry authoring packages, carry package lineage, close the package action items they resolve, and have an `authoring_package_sha256` that matches a readable full-context authoring package from the patch task manifest or curation gate
- full-context authoring packages must contain non-empty SDK schema, methodology YAML, and runtime ruleset text; path references alone are invalid
- full-context AI patch operations must carry both a basis and structured evidence with source plus quote/trace/path/citation pointer; generic basis-only patches are invalid for remote write planning
- AI-authored patch evidence includes `resolution.mode` and `resolution.used_context_kinds`, so final manifests can distinguish evidence-backed completion, source-language normalization, source-trace verification, and `common:other` deferral; classification and location queue fixes are proven by their dedicated decision-apply reports instead of patch operations
- TIDAS location-like machine fields must contain valid `tidas_locations_category.json` codes, not natural-language place descriptions. Location code repairs for profiles with full-context AI completion must be proven by completed `location-decisions-apply` evidence, while descriptive geography context remains in TIDAS description/name/source-trace fields; rows whose location cannot be confidently coded remain blocked before remote write.
- Full-context profiles must pass content saturation before remote write planning. If source trace, schema, methodology YAML, or profile context contains a provable formal-field value, the row remains blocked until AI patch evidence fills the field or records an allowed structured deferral for action items that explicitly permit deferral. Underfilled synonyms, supply/location descriptors, quantitative flow properties, bibliographic source details, or official contact details are content-saturation blockers.
- `common:other` deferral is allowed only for action items whose allowed resolution modes include `deferred_to_common_other`; it must be produced by AI patch evidence for the same row, write structured `tiangongfoundry:unresolvedTrace` with status, action item code, blocked path, reason, structured evidence, and next action, and close the matching action item; evidence must include source plus quote/trace/path/citation pointer
- mandatory schema fields cannot be marked resolved by moving the missing value to `common:other`; they need evidence-backed values or remain blocked before remote write
- source-only-output exchange acceptance must be produced by same-row AI patch evidence with `resolution.mode=source_trace_verified`, or by deterministic cleanup proof generated from an explicit `source_rows_file` for the same row; both paths must write structured `tiangongfoundry:sourceExchangeCompleteness` with accepted status and structured source trace evidence, and deterministic proof must show the source row is Output-only and that the final row preserves the non-flow-reference exchange signature
- for profiles that require full-context AI semantic completion, deterministic AI evidence is mandatory, not optional: classification queue fixes must carry completed `classification-decisions-apply` evidence, location queue fixes must carry completed `location-decisions-apply` evidence, and other patches must carry patch collect/apply evidence with `authoring_package_sha256` and `closes_action_items`
- reference closure passes in the post-authoring mutation manifest; mutually-referencing writable contact/source rows must be grouped into a mixed `support` write scope when needed, Flow Properties and Unit Groups must resolve through the canonical support cache to existing database rows, and any referenced dataset outside the exact write scope must be proven by `dataset verify-remote` after its row exists remotely, or the dependent write scope remains blocked before commit handoff
- support/source write scopes contain only true source identities for source rows; data-format, compliance-system, and placeholder identities such as `ILCD format` or `Not specified` must remain canonical reference rewrites/provenance and are blocked by the mutation manifest before commit handoff; true source rows with empty or type-only descriptions such as `Report` must be repaired from citation/name evidence before write planning
- missing canonical unitgroups, flowproperties, elementary flows, compliance sources, data-format sources, contacts, or true sources block only the dependent write scope and are recorded for human/database governance; independent scopes with proven closure may continue
- blocked write scopes must append machine-readable import-ledger rows under `blocked.scopes.human-review.jsonl` and categorized `blocked.dependencies.*.jsonl` files with concrete blocker reasons, required human action, and the rerun path; successful readback-verified scopes must append `ok.*.verified.jsonl` rows so later batch reruns can skip already imported rows
- curation cleanup has run and cleaned rows were revalidated
- post-authoring Foundry curation gate passes on the exact final rows and references a deterministic QA report for those rows
- state-code-aware mutation plan exists
- Foundry `dataset-mutation-manifest` is `ready_for_remote_write` for the exact write scope
- blocked mutation manifests must not export executable rows in `*.write-candidates.jsonl`; planned-but-blocked rows belong only in `*.blocked-write-candidates.jsonl`
- when `common:other.tiangongfoundry:unresolvedTrace` or `sourceExchangeCompleteness` entries exist, the mutation manifest exports them as JSONL follow-up queues for later database-side curation
- mutation-manifest evidence reports point to the exact write rows: schema and remote verification `input_path` match the rows file, cleanup `cleaned_rows_file` matches the rows file, and AI patch apply output chains into cleanup input when AI patching was used
- `dataset-commit-handoff-plan` reports `ready_for_explicit_commit` for the exact finalize report, mutation manifest, final rows file, target user id, and expected state_code
- commit and post-write verify are authoritative `tiangong-foundry.command-spec.v1` objects; their SHA-256 binds executable, argv, and the same final-row path/bytes/SHA-256, while display is never executed and every runner rechecks artifact bytes before `shell=false` spawn
- insert/versioned writes have explicit reasons
- state_code=100 rows have source-review records instead of direct overwrite
- a dry-run artifact exists
- the configured remote/readback verification gate passes
- after commit, `tiangong-lca dataset verify-remote --compare-root-payload --target-user-id <id> --state-code <code>` passes for the exact committed rows
- `missing_dataset` for a foreign or RLS-hidden `state_code=0` reference is always a hard blocker; another account's observation, a static trusted key, or a profile exception cannot rewrite the check/report to passed. Production-test accounts accept no post-write difference. Ordinary runs may normalize only an exact root payload mismatch proven to differ solely at `tiangongfoundry:importTraceSummary.traceHash` after a fresh CLI readback.
- after commit and readback, Foundry `dataset-post-write-closeout` reports `completed`; it must prove the handoff was ready, the CLI commit report was a real commit with no row failures, post-write verification used the same final rows, root readback checks have equal local/remote payload hashes, owner/state_code match the handoff, profile-required full schema/YAML/context AI proof and evidence counts remain attached, and any `common:other` trace queues remain attached
- for a task with one or more committed scopes, Foundry `dataset-import-completion-report` reports `completed` after aggregating every closeout report required by the task; missing closeouts, duplicate closeouts for the same dataset type/final rows, non-completed closeouts, mismatched finalize/mutation scopes, missing profile-required full-context proof or evidence counts, unreadable trace queues, or missing required dataset types keep the task blocked
- for resumable batch imports, Foundry `dataset-import-ledger-report` must be able to summarize the append-only import ledger into `resume.skipped-verified.jsonl` and `resume.plan.jsonl`, preserving ready-only execution across reruns
- Foundry task state moves from `tasks/active` to `tasks/done` only through `task-complete`, which requires a matching `dataset-import-completion-report.completed` for the same task id, at least one post-write closeout scope, and profile-required full schema/YAML/context AI completion proof before entry

For `state_code=0`, ordinary account-owned working-data repair should use update-first semantics. For missing or ambiguous `state_code`, stop at dry-run and create a follow-up task.

## Secrets

Never commit:

- `.env`
- API keys
- access tokens
- full database payload dumps
- runtime logs with credentials

## Human Involvement

The goal is batch automation with hard gates and recovery. Humans approve policy changes, exceptional waivers, delete actions, and missing canonical database support decisions. They do not supervise every scan, repair candidate, or gate-passing commit scope when the task write policy permits profile-gated automated batch commit.

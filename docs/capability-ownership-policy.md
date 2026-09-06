---
title: Capability Ownership Policy
docType: policy
scope: workspace-adapters
status: active
authoritative: true
owner: tiangong-lca-data-foundry
language: en
whenToUse:
  - when deciding whether Foundry, CLI, skills, SDK, tools, database, or Edge owns a capability
  - when reviewing capability registry or workspace adapter changes
whenToUpdate:
  - when capability ownership boundaries, routing rules, or follow-up fields change
checkPaths:
  - docs/capability-ownership-policy.md
  - docs/architecture.md
  - docs/workspace-project-map.md
  - docs/foundry-ai-navigation.md
  - docs/foundry-command-surface.md
  - test/README.md
  - specs/capability-ownership-rules.json
  - specs/automated-lca-capability-registry.json
  - specs/workspace-capability-adapters.md
  - docs/safety-policy.md
  - docs/incremental-change-set-contract.md
  - scripts/foundry-golden-diff.ts
  - scripts/check-tidas-cutover.ts
  - scripts/check-lint-suppressions.ts
  - scripts/clean-build-output.ts
  - scripts/build-foundry-package.ts
  - scripts/pack-foundry-package.ts
  - scripts/verify-foundry-package.ts
  - scripts/package-entry.ts
  - scripts/public-api.ts
  - scripts/lib/foundry-package-contract.ts
  - docs/package-distribution-contract.md
  - scripts/lib/foundry-runtime-environment.ts
  - scripts/lib/foundry-runtime-paths.ts
  - scripts/lib/tidas-adapter.ts
  - scripts/lib/post-authoring-finalize-utils.ts
  - scripts/commands/tasks.ts
  - scripts/commands/import-completion.ts
  - scripts/commands/commit-handoff.ts
  - scripts/commands/identity-decision-task.ts
  - scripts/commands/support-cache.ts
  - scripts/commands/cli-wrappers.ts
  - scripts/commands/execution-capsule.ts
  - scripts/commands/post-write-closeout.ts
  - scripts/commands/core.ts
  - scripts/commands/identity-preflight-run.ts
  - scripts/commands/post-authoring-finalize.ts
  - scripts/commands/identity-decisions.ts
  - scripts/commands/classification-decisions.ts
  - scripts/commands/location-decisions.ts
  - scripts/commands/library-scope-workflow.ts
  - scripts/commands/bafu-leaf-classification-tasks.ts
  - scripts/commands/bafu-auto-authoring.ts
  - scripts/commands/bafu-process-scope-e2e.ts
  - scripts/commands/bafu-batch-import-run.ts
  - scripts/lib/import-curation.ts
  - scripts/lib/import-curation/index.ts
  - scripts/lib/import-curation/profiles.ts
  - scripts/lib/import-curation/trace-summary.ts
  - scripts/commands/authoring-plan.ts
  - scripts/commands/bundle-sample-rows.ts
  - scripts/commands/incremental-change-set.ts
  - scripts/commands/topology-convergence.ts
  - scripts/lib/import-curation/internal/workflow-queue-context.ts
  - scripts/lib/import-curation/internal/full-context-proof.ts
  - scripts/lib/import-curation/internal/workflow-decision-apply-context.ts
  - scripts/lib/import-curation/internal/profiles-config.ts
  - scripts/lib/import-curation/internal/workflow-patch-collect.ts
  - scripts/lib/import-curation/internal/workflow-identity-decision-context.ts
  - scripts/lib/import-curation/internal/workflow-patch-evidence-context.ts
  - scripts/lib/import-curation/internal/workflow-row-transform-context.ts
  - scripts/lib/import-curation/internal/workflow-dry-run-context.ts
  - scripts/lib/import-curation/internal/workflow-evidence-scope.ts
  - scripts/lib/import-curation/internal/workflow-decision-full-context.ts
  - scripts/lib/import-curation/internal/workflow-authoring-tasks.ts
  - scripts/lib/import-curation/internal/workflow-semantic-actions.ts
  - scripts/lib/import-curation/internal/workflow-patch-evidence.ts
  - scripts/lib/import-curation/internal/workflow-identity-preflight.ts
  - scripts/lib/import-curation/internal/authoring-task-workflow.ts
  - scripts/lib/import-curation/internal/authoring-patch-workflow.ts
  - scripts/lib/import-curation/internal/curation-gate-workflow.ts
  - scripts/lib/import-curation/authoring-packages.ts
  - scripts/lib/import-curation/patch-collect.ts
  - scripts/lib/import-curation/curation-gate.ts
  - scripts/lib/import-curation/curation-cleanup.ts
  - scripts/lib/import-curation/internal/workflow-reference-closure.ts
  - scripts/lib/import-curation/internal/workflow-source-reference-context.ts
  - scripts/lib/import-curation/internal/mutation-manifest-workflow.ts
  - scripts/lib/import-curation/mutation-manifest.ts
  - test/commands/*.test.mts
lastReviewedAt: 2026-09-06
lastReviewedCommit: 7ff15a24930492475985c8592e5d38e55b2ca096
lastReviewedNote: "Reviewed for Foundry #112: release proof follows the exact commit merged into canonical main and remains valid for a merged fork PR after its source fork is deleted. Unmerged, wrong-target and mismatched commits remain blocked; immutable tags, qualification and runtime permissions are unchanged."
---

# Capability Ownership Policy

Migration transfer planning is governed by [the workspace migration contract](workspace-migration-contract.md). W10 provides explicit source/queue/input staging, current-owner task adoption, audited v2 activation and separate runtime read/write selection. Preserved history blocks replay across requests and migrations; none of these records grants business permission. Operational qualification and release integration remain tracked in #108/#980.

The v2 task store persists registered job/source/profile identity, account intent, producer receipts and artifact lineage; deterministic local retries reuse verified results. Exact C1/TIDAS qualification, all-command disposition, derived authorization and child admission form the W04 authority boundary. The W05 hierarchical facade adds strict result/task schemas, deterministic request revisions, actor-bound status/resume, local preparation and read-only migration inventory. W06 owns its deterministic npm candidate closure; W08 owns F1 publication and components. See `docs/public-runtime-contract.md`, `docs/runtime-context-contract.md`, `docs/package-distribution-contract.md`, `docs/task-authorization-contract.md` and `docs/foundry-task-contracts.md`.

The explicit workspace runtime is defined by `docs/runtime-context-contract.md`: package layout comes from `package.json.foundryRuntime`, emitted execution needs no source TypeScript or Git, and selected inputs/task outputs are bound to an immutable runtime context. `scripts/runtime-entry.ts` now implements workspace init/migration, consumer doctor and task start/status/resume as the separate hierarchical facade. All 63 flat owner commands retain explicit public/internal/excluded, path, child, qualification and authorization dispositions; the facade reaches them only through registered task state and never falls back to the developer runner.

Import profiles distribute source rules only. Historical BAFU/USLCI/Worldsteel account overrides, QA waivers and the Worldsteel full-context relaxation grant no permission to a new task. `docs/task-authorization-contract.md` owns the separate workspace/task/actor/account/profile/input binding and exact action evidence. Local candidate preparation and checked public-reference proofs remain available; current final-row hashes, task permissions and all content/closure/no-replay gates are required before a restricted write handoff.

Foundry must distinguish project-specific orchestration from shared TianGong capabilities before implementing new logic.

## Boundary

Foundry owns:

- its exact pnpm package-manager contract, sole root workspace/lock, and repository-local validation gates;
- its source-free public bin/API compiler graph, sanitized npm staging manifest, explicit file allowlist and package descriptor verification;
- the six hierarchical workspace/task facade operations, strict result/task-spec schemas, request/revision indexes and actor-bound task projection;
- deterministic local task preparation and read-only legacy inventory through existing runtime/task owners;

- task queue and task state;
- per-task workspace layout;
- source manifests, import profiles, curation packages, cleanup reports, and handoff reports;
- root-library entity indexes, process-scope projections, blocked-scope ledgers, blocked-scope reports, and ready-scope checkpoints for packaged imports;
- deterministic resolution of package-local bundle paths before Foundry projects library decisions to process scopes;
- deterministic row-transform evidence reconciliation across source/contact rewrites, canonical support rewrites, identity reference rewrites, unresolved-exchange externalization, and cleanup;
- deterministic source-only-output exchange proof from explicit source rows when the final process row preserves the non-flow-reference exchange signature;
- remote-write policy checks, execution policy records, blocked-scope ledgers and reports, and commit/readback handoff aggregation;
- fail-closed aggregation of CLI readback: foreign or RLS-hidden `state_code=0` `missing_dataset` remains blocking and is not a Foundry-owned acceptance policy;
- projection of the current identity-preflight request contract, including one lexical and one semantic weight, without owning database search semantics;
- support dependency finalize/handoff aggregation for profile-generated writable contact/source rows, without directly mutating the database;
- offline old/candidate/current change-set composition, strict machine validation, entity/path/value/evidence-bound preservation, stable-identity array handling, absent-dependency isolation, immutable artifact manifests, and per-conversion terminal logs, without remote dispatch;
- offline candidate-topology convergence composition, including fresh-census binding, owner/public/foreign target classification, process-local occurrence mapping, approved multilingual preservation, phased F/P/D artifacts, and zero-inbound delete candidates, without remote dispatch or delete authority;
- acceptance checks and Stop-hook feedback loops;
- local test structure for Foundry-owned metadata, command contracts, scenario orchestration, and shared fixtures;
- repository-wide TypeScript lint/typecheck inventory, root-only Oxlint configuration, Git-hook-isolated native-disable audit, erasable-syntax policy, safe stale-output build cleanup, trusted source/emitted entry discovery, and credential-free Golden child isolation;
- thin adapters that select and call stable owner entrypoints, verify their machine contracts, and map reports into Foundry gates without reimplementing domain logic.
- account-profile and Codex-thread intent checks plus a restricted executable/argv process boundary; live session resolution and identity receipt construction remain CLI-owned.

Foundry does not own:

- reusable TianGong data commands;
- shared agent workflow skills;
- database RPC/schema/index behavior;
- Edge Function API behavior;
- TIDAS schema semantics;
- Rust tidas format detection, import/conversion, schema-validation, exit classification, cancellation, or atomic-publication semantics;
- CLI, SDK, database, converter, or Edge behavior reimplemented as local test fixtures;
- user RLS-scoped dataset delete, retirement, redo, repair execution, or database mutation semantics.

The TypeScript migration does not change capability ownership. Foundry may type its entrypoint, command registry/metadata, runtime I/O, artifacts, receipts, and local orchestration modules, but it must not use the migration to absorb CLI, SDK, converter, skill, database, or Edge behavior. The migration ledger and clean-worktree toolchain tests are Foundry-owned evidence; the sibling behavior they invoke remains owned by the sibling project.

Cross-platform Git line-ending and test-harness policy are also Foundry-owned delivery tooling. They may normalize repository text and fixture dispatch, but they do not normalize or redefine any sibling capability output.

Foundry also owns portability and fail-closed handling of its local artifact paths, command-plan parsing, and durable file writes. Separator normalization and writable-descriptor fsync preserve the same Foundry contract on each OS. Blocked cleanup/finalize never delete pre-existing artifacts; they null current output aliases, report stale paths, and require a new output path or deliberate operator-managed archival. These controls do not move CLI execution or Rust validation semantics into Foundry.

Foundry owns the `tiangong-foundry.command-spec.v1` handoff envelope: strict executable/argv validation, duplicate critical-flag rejection, reader-only display rendering, command hashing, and exact input artifact facts. The published CLI still owns the command's remote behavior. Foundry runners may execute only the parsed executable and argv with `shell=false`, after rechecking bound artifact bytes.

Profile-gated batch commit does not change ownership: Foundry may decide that an exact scope has passed policy and handoff gates, but the actual mutation command remains an official CLI/platform command executed under an account guard. Foundry's default platform invocation is the exact installed CLI package, `pnpm exec tiangong-lca ...`; credential-scoped account execution additionally requires its CLI 0.1.10 intent-bound identity receipt. Local CLI binary overrides are only explicit operator/test state, not the workflow contract.

The supported library boundary is `@tiangong-lca/cli/command-spec`, `@tiangong-lca/cli/batch`, and `@tiangong-lca/cli/auth-identity-receipt`. Generic contracts, scheduling, run locks, and strict receipt parsing remain CLI-owned; Foundry owns semantic adapters and test-only fixture materialization. A private package file is never an ownership fallback.

The generic library scope runner now obeys that boundary directly. Foundry retains ready/deferred LCA semantics, input-order checkpoints, blocker/report projection and log locations. The published CLI owns CommandSpec parsing/current-artifact execution and the content/policy/resource-bound scheduler, including pause, stop, exclusivity, exception isolation and mutation no-retry. `foundry-command-spec.ts` must not regain a local implementation.

The real commit-mode batch owner now calls `runFoundryScopeBatch`, whose only scheduler implementation is public CLI `runBoundedBatch` under `withBatchRunLock`. Foundry provides content/family projections, scope execution, retryable ledger mapping, cache-cap callback, and report aggregation. This is delegation, not a copy of CLI scheduling semantics.

High-level library and BAFU orchestration is Foundry-owned composition, not a transfer of sibling behavior. Foundry may order classification, authoring, scope-finalize, ledger, pause/preflight and bounded-parallel stages and may delegate an already-authorized handoff as executable plus argv. The CLI still owns mutation and readback semantics, profiles own dataset-specific policy, and USLCI/Worldsteel wrappers may configure the shared engine only within those existing boundaries.

Foundry owns only the local eligibility classification and orchestration state for a same-id/version lost-success observation. It requires structured `23505` evidence with exact conflict semantics, dispatches no replay, and keeps recovery pending until the CLI/database-owned readback proves exact owner, state, identity, version, payload, and root closure. Classifier acceptance is not mutation success, database truth, or closeout authority.

Candidate retrieval does not own BAFU identity equivalence. Edge Functions and database search return candidate evidence; Foundry's `identity-equivalence.ts` owns the deterministic local physical review used by BAFU auto-authoring. An exact name cannot override a recorded property, unit, geography, category/route, technology, or physical-meaning conflict, and this local decision never grants remote-write authority.

Foundry also owns truthful local completion projection for BAFU category-map decisions. Taxonomy vocabularies and semantic AI choices remain schema/decision-owned; `category-map-projection.ts` retains every supplied manual-review row, `category-map-report.ts` projects closure-wide blockers/status, and `foundry-command-registry.ts` returns nonzero until that closure is empty. These guards cannot invent or apply a category choice.

Foundry owns lossless local transport of a selected canonical description through its rewrite evidence. `canonical-description.ts` validates/clones the JSON value and downstream Foundry stages preserve it; it does not choose the canonical identity, translate or rewrite multilingual content, query remote state, or grant mutation authority. Schema/decision owners still determine the authoritative value, and unsupported/non-JSON evidence fails closed rather than being coerced into display text.

Foundry also owns truthful projection of its local post-finalize recovery invocations. It may record the exact executable/argv it dispatches, derive display text, bind logs/report paths, and reject projection drift before continuing. That report contract does not convert a local recovery command into CommandSpec or remote-write authority; CLI/database owners retain mutation, transaction, and readback semantics.

Foundry owns local continuity of a location task queue between its suggestion and apply orchestration calls. It may bind path/bytes/SHA and stop on drift; it does not choose a location code, interpret the taxonomy, or change CLI apply semantics. Location schema and decision owners retain semantic authority, and no remote-write capability follows from the artifact fact.

Deterministic import/conversion/schema validation follows a separate native-tool boundary. Foundry selects the Rust `tidas` executable with `--tidas-bin`, `TIDAS_BIN`, then `PATH`, and optional config with `--tidas-config` then `TIDAS_CONFIG`. It accepts compatible 0.2.x releases only after a `tidas version` handshake proves `tidas.operation-report.v1`; it does not install a Python package, inspect a Python checkout, or pin one patch release. A script-backed test override is dispatched through Node plus an argv prefix on every platform; that portability adapter does not move Rust validation behavior into Foundry. Foundry may materialize the official validation-batch manifest and map the stable Rust report/exit result into its existing validation report, but must not reproduce schema or converter rules.

Incremental composition follows the same boundary. Foundry may minimize the write set and emit a syntactically compatible CLI execution contract, but current-state reconciliation, authenticated dispatch, transaction semantics, attempt/no-replay state, and readback remain CLI/database responsibilities.

Topology convergence follows that boundary as well. Foundry may compose the exact F flow-create and P process-save actions and identify owner/state-zero D candidates, but only the fixed published CLI may dispatch protected transactions. D cannot activate until a post-P, all-visible-process census proves a unique owner target and zero inbound references.

## Decision Rule

Use this order before adding code:

1. If the change only coordinates existing commands or checks foundry task artifacts, implement it in foundry.
2. If the change is deterministic import, conversion, or schema validation, create a development request for Rust `tidas`; if it is a reusable primitive command with remote access, AI context/curation, or handoff behavior, create a development request for `tiangong-lca-cli`.
3. If the change is a reusable agent workflow that composes CLI commands, create a development request for `tiangong-lca-skills`.
4. If the change is a fast-moving external source-evidence extraction or retrieval workflow, consume it as a runtime `pnpm dlx skills@latest` dependency and record the resolved ref instead of copying it into Foundry.
5. If the change depends on database, Edge Function, Rust tidas, SDK, or schema internals, route it to that owning repo.

Bad-import cleanup and redo must be routed to `tiangong-lca dataset maintenance plan/apply/verify` plus the `$dataset-rls-maintenance` skill. Foundry may store the maintenance scope, plan, and verification reports in the task workspace, but must not own direct delete logic, service-role access, or broad current-account cleanup filters.

When unsure, keep the foundry implementation as a thin adapter or stub, stop at dry-run/curation, and create a follow-up task with an explicit `owner_project`.

## Shared vs Project-Specific

Treat a capability as shared when any of these are true:

- more than one task type will need it;
- another repo or agent runtime should call it;
- it requires authenticated remote reads or writes;
- it defines a stable data contract;
- it changes business logic or runtime semantics.

Treat a capability as foundry-specific when all of these are true:

- it only checks foundry-owned artifacts;
- it only controls task state, workspace layout, or gate reconciliation;
- it does not duplicate CLI, skill, database, Edge, converter, SDK, or schema behavior.

Foundry tests follow the same boundary. Unit tests cover local metadata and helpers, command tests cover Foundry command artifacts, scenario tests cover multi-command orchestration, and fixtures remain local harness data rather than fake implementations of sibling project ownership.

Deletion follows the same ownership rule. Remove Foundry-local aliases, empty categories, draft docs, or helpers only after command metadata, import references, tests, docs, and docpact show no remaining Foundry-owned consumer. If the surface is a shared CLI/skill/database concern, route the cleanup to the owning project instead of deleting local evidence first.

## Follow-Up Requirement

Every missing shared capability follow-up must include:

- `capability_scope`
- `owner_project`
- `shared_or_project_specific`
- `why_not_foundry_local`
- `expected_input_contract`
- `expected_output_contract`
- `suggested_implementation_location`
- `done_criteria`

The machine-readable rules live in `specs/capability-ownership-rules.json`.

Canonical support reads and complete pagination belong to CLI `dataset support-cache export`. Foundry consumes its report/artifacts, validates provenance and public scope, and owns only cache summarization/mapping policy and atomic local replacement. It contains no password-grant or REST implementation for this path.

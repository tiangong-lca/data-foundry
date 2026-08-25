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
lastReviewedAt: 2026-08-25
lastReviewedCommit: dc43513aff4191082c5290d9b8bc726bdce14cb1
lastReviewedNote: "Reviewed for Issue #67 follow-up: strict import-ledger types and typed shared test fixtures remain Foundry-owned evidence/harness boundaries and add no sibling CLI, SDK, converter, database, or Edge behavior."
---

# Capability Ownership Policy

Foundry must distinguish project-specific orchestration from shared TianGong capabilities before implementing new logic.

## Boundary

Foundry owns:

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

Foundry also owns portability of its local artifact paths, command-plan parsing, and durable file writes. Separator normalization and writable-descriptor fsync preserve the same Foundry contract on each OS; they do not move CLI execution or Rust validation semantics into Foundry.

Foundry owns the `tiangong-foundry.command-spec.v1` handoff envelope: strict executable/argv validation, duplicate critical-flag rejection, reader-only display rendering, command hashing, and exact input artifact facts. The published CLI still owns the command's remote behavior. Foundry runners may execute only the parsed executable and argv with `shell=false`, after rechecking bound artifact bytes.

Profile-gated batch commit does not change ownership: Foundry may decide that an exact scope has passed policy and handoff gates, but the actual mutation command remains an official CLI/platform command executed under an account guard. Foundry's default platform invocation is the exact installed CLI package, `pnpm exec tiangong-lca ...`; credential-scoped account execution additionally requires its CLI 0.1.1 intent-bound identity receipt. Local CLI binary overrides are only explicit operator/test state, not the workflow contract.

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

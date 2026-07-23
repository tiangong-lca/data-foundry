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
  - docs/final-delivery-promotion-contract.md
  - test/README.md
  - specs/capability-ownership-rules.json
  - specs/automated-lca-capability-registry.json
  - specs/workspace-capability-adapters.md
  - docs/safety-policy.md
lastReviewedAt: 2026-07-23
lastReviewedCommit: f10932a864e54f3826afc0141f33fbcf9190344e
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
- support dependency finalize/handoff aggregation for profile-generated writable contact/source rows, without directly mutating the database;
- acceptance checks and Stop-hook feedback loops;
- offline final-delivery promotion that checks only Foundry-owned local artifacts, package-declared algebra/workbook/redaction policies, and content-bound independent-review evidence;
- local test structure for Foundry-owned metadata, command contracts, scenario orchestration, and shared fixtures;
- thin adapters that call existing CLI or skill entrypoints.

Foundry does not own:

- reusable TianGong data commands;
- shared agent workflow skills;
- database RPC/schema/index behavior;
- Edge Function API behavior;
- TIDAS schema semantics;
- CLI, SDK, database, converter, or Edge behavior reimplemented as local test fixtures;
- user RLS-scoped dataset delete, retirement, redo, repair execution, or database mutation semantics.

Profile-gated batch commit does not change ownership: Foundry may decide that an exact scope has passed policy and handoff gates, but the actual mutation command remains an official CLI/platform command executed under an account guard. Foundry's default platform invocation is the published CLI package, `npx --yes @tiangong-lca/cli@latest ...`; local binary overrides are only explicit operator/test state, not the workflow contract.

## Decision Rule

Use this order before adding code:

1. If the change only coordinates existing commands or checks foundry task artifacts, implement it in foundry.
2. If the change is a reusable primitive command with stable input/output and remote access, create a development request for `tiangong-lca-cli`.
3. If the change is a reusable agent workflow that composes CLI commands, create a development request for `tiangong-lca-skills`.
4. If the change is a fast-moving external source-evidence extraction or retrieval workflow, consume it as a runtime `npx skills` dependency and record the resolved ref instead of copying it into Foundry.
5. If the change depends on database, Edge Function, converter, SDK, or schema internals, route it to that owning repo.

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

Final-delivery promotion follows this boundary as well. Foundry may aggregate and seal local evidence, but the seal cannot authorize publication, deployment, remote writes, owner sessions, or database behavior. Those actions remain with their owning CLI, release, and database surfaces.

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

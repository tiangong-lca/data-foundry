---
title: Foundry Command Surface
docType: guide
scope: repo
status: active
authoritative: true
owner: tiangong-lca-data-foundry
language: en
whenToUse:
  - when deciding whether a Foundry command is public, workflow-internal, or a CLI wrapper
  - when navigating from a command name to its implementation, artifacts, and tests
whenToUpdate:
  - when adding, removing, renaming, or reclassifying a Foundry command
  - when moving command owner modules or changing command artifact contracts
checkPaths:
  - docs/foundry-command-surface.md
  - test/README.md
  - scripts/lib/foundry-command-registry.mjs
  - scripts/lib/foundry-command-metadata.mjs
  - docs/incremental-change-set-contract.md
  - test/unit/foundry-command-metadata.test.mjs
lastReviewedAt: 2026-07-23
lastReviewedCommit: 849d6ac14d357bd445a9fa75a9c18dc16a2a411a
---

# Foundry Command Surface

Foundry command governance has two layers:

- `scripts/lib/foundry-command-registry.mjs` is the runtime command list and exit-code policy.
- `scripts/lib/foundry-command-metadata.mjs` is the AI-readable navigation and ownership map.

The metadata module must cover every command returned by `node scripts/foundry.mjs help`. It records each command category, owner module, owner export, input artifacts, output artifacts, workflow entry audit state, and key behavior checks.

## Categories

- `public`: stable operator-facing commands for runtime setup, diagnostics, task routing, profile listing, and task state.
- `workflow-internal`: Foundry policy or artifact helpers used inside the import/authoring workflow.
- `cli-wrapper`: compatibility wrappers over stable owner-command behavior that Foundry does not own, including the unified Rust `tidas` machine contract and sibling `tiangong-lca` CLI behavior.

Every command must have `workflowEntry.status: "active"` and at least one key behavior check, so unused surface area cannot hide as an unreviewed command. `surface-audit` is the read-only guard for hidden command aliases, empty metadata categories, unregistered orphan docs, and script modules with no inbound imports; `doctor` and `acceptance-check` include it.

`tidas-handshake`, `dataset-tidas-import`, and `dataset-tidas-validate` are the active deterministic TIDAS boundary. The handshake accepts compatible 0.2.x binaries that advertise `tidas.operation-report.v1`; the import and validation adapters preserve Rust operation status, completeness, exit class/code, diagnostics, artifacts, next actions, cancellation, and atomic-output semantics. Foundry only maps official batch-validation results into its existing validation report and valid/invalid row files. It does not load a Python source tree, install a Python package, or infer a Python checkout/version.

`execution-capsule-admit` is a `workflow-internal` offline evidence gate. Its contract lives in `docs/execution-capsule-contract.md`; it may snapshot, validate, report, and seal local evidence, but it cannot execute the consumer or grant production authority.

`dataset-incremental-change-set-compose` is a `workflow-internal` offline planner. Its contract lives in `docs/incremental-change-set-contract.md`; it strictly validates old/candidate/current plus owner-receipt evidence, applies only entity/path/value/evidence-bound merge rules, isolates absent/held dependency closures, and emits one hash-chained terminal log event per schema-valid conversion plus a non-empty CLI-compatible candidate contract when actions exist. It has no network, database, CLI, or DML dispatch and never grants production authority.

`dataset-topology-convergence-compose` is a `workflow-internal` offline F/P/D planner. Its contract lives in `docs/topology-convergence-contract.md`; it validates a fresh census and exact candidate closure, reconstructs exchanges by source number plus occurrence, preserves approved multilingual nodes, emits separate flow-create/process-save contracts, and leaves obsolete flows behind a later all-visible zero-inbound delete barrier. It has no network, database, CLI, or DML dispatch and never grants production authority.

## Navigation Contract

Every command must be reachable through this path:

```text
scripts/foundry.mjs
  -> scripts/lib/foundry-cli.mjs
  -> owner module in scripts/commands or scripts/lib/import-curation
```

Public command owner paths must be at most two jumps from `scripts/foundry.mjs`. For semantic import-curation commands, prefer owner modules such as `profiles.mjs`, `curation-gate.mjs`, `authoring-packages.mjs`, `patch-collect.mjs`, `curation-cleanup.mjs`, `trace-summary.mjs`, and `mutation-manifest.mjs` over mechanical part names. Reusable import-curation logic should be exposed through focused workflow facets under `scripts/lib/import-curation/internal/*-workflow.mjs`.

## Maintenance Rule

When a command is added, removed, renamed, moved, or reclassified, update both:

1. `scripts/lib/foundry-command-registry.mjs`
2. `scripts/lib/foundry-command-metadata.mjs`

Then run:

```bash
node --test test/unit/foundry-command-metadata.test.mjs
npm run surface:audit
npm run test:commands
npm run golden:diff
```

New command tests belong in `test/commands/` when they exercise one command's report or artifact contract. Multi-command workflow coverage belongs in `test/scenarios/`, and shared setup belongs in `test/fixtures/`.

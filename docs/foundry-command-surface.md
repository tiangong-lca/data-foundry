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
  - test/unit/foundry-command-metadata.test.mjs
  - docs/final-delivery-promotion-contract.md
lastReviewedAt: 2026-07-23
lastReviewedCommit: 2f1e80b02173fc20231f01ac9e6da62c16d63109
---

# Foundry Command Surface

Foundry command governance has two layers:

- `scripts/lib/foundry-command-registry.mjs` is the runtime command list and exit-code policy.
- `scripts/lib/foundry-command-metadata.mjs` is the AI-readable navigation and ownership map.

The metadata module must cover every command returned by `node scripts/foundry.mjs help`. It records each command category, owner module, owner export, input artifacts, output artifacts, workflow entry audit state, and key behavior checks.

## Categories

- `public`: stable operator-facing commands for runtime setup, diagnostics, task routing, profile listing, and task state.
- `workflow-internal`: Foundry policy or artifact helpers used inside the import/authoring workflow.
- `cli-wrapper`: compatibility wrappers over sibling `tiangong-lca` CLI behavior that Foundry does not own.

Every command must have `workflowEntry.status: "active"` and at least one key behavior check, so unused surface area cannot hide as an unreviewed command. `surface-audit` is the read-only guard for hidden command aliases, empty metadata categories, unregistered orphan docs, and script modules with no inbound imports; `doctor` and `acceptance-check` include it.

`execution-capsule-admit` is a `workflow-internal` offline evidence gate. Its contract lives in `docs/execution-capsule-contract.md`; it may snapshot, validate, report, and seal local evidence, but it cannot execute the consumer or grant production authority.

`final-delivery-promote` is a `workflow-internal` offline delivery gate. Its contract lives in `docs/final-delivery-promotion-contract.md`; it validates manifest-bound artifacts, row algebra, workbook layout, redaction, and independent-review coverage, then emits a detached seal only on an all-PASS result. It cannot mutate delivery inputs, dispatch remote work, or grant production authority.

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

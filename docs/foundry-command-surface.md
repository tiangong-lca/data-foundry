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
  - scripts/lib/foundry-args.ts
  - scripts/lib/foundry-command-registry.ts
  - scripts/lib/foundry-command-metadata.ts
  - scripts/lib/surface-audit.ts
  - scripts/lib/bafu-family-signatures.ts
  - scripts/lib/import-ledger.ts
  - scripts/lib/canonical-support-rewrites.ts
  - scripts/lib/bundle-sample-utils.ts
  - docs/incremental-change-set-contract.md
  - test/unit/foundry-command-metadata.test.mts
lastReviewedAt: 2026-08-25
lastReviewedCommit: 1282579aa90016fde378293bfa4b1de11c679b4f
lastReviewedNote: "Reviewed for Issue #67 Wave 11: typing location command-plan and blocker helpers changes no command category, owner/export metadata, help, artifacts, exit mapping, or remote-write mode."
---

# Foundry Command Surface

Foundry CLI-spine and command governance has three checked contracts:

- `scripts/lib/foundry-args.ts` is the typed positional/option/scalar parsing contract.
- `scripts/lib/foundry-command-registry.ts` is the typed runtime command list, help JSON, and exit-code policy.
- `scripts/lib/foundry-command-metadata.ts` is the typed AI-readable navigation and ownership map.
- `scripts/lib/surface-audit.ts` checks hidden handlers, category coverage, orphan docs, declared entrypoints, and script-only inbound imports with portable report paths.

The metadata module must cover every command returned by `node scripts/foundry.mjs help`. It records each command category, owner module, owner export, input artifacts, output artifacts, workflow entry audit state, and key behavior checks.

Issue #63 does not change the public command categories or behavior. It introduces the Node.js 24 / pnpm 11.23 / TypeScript 7.0.2 typed spine underneath the same surface. The argument parser and command registry are native TypeScript leaves; `test/unit/foundry-cli-spine.test.mts` fixes their scalar/argv parsing, exact help JSON, exit mapping, and static consumer contract. Later migration work must preserve the registered command name, help, stdout, exit code, stage contract, input/output artifacts, and remote-write mode before removing a JavaScript implementation from `specs/typescript-migration-inventory.json`. Use focused characterization and real cases; do not treat an extension rename as command migration.

The Wave 8 BAFU family-signature and import-ledger migrations remain supporting typed leaves beneath the existing `dataset-bafu-batch-import-run` and `dataset-import-ledger-report` owners. Their command registry and metadata entries, help JSON, artifact schemas, exit mapping, and remote-write modes are unchanged.

Wave 9 keeps `dataset-bundle-sample-rows` under its existing command owner and read-only mode. Its metadata now advertises the conditional `canonical-support-amount-scaling.jsonl` artifact and its command test: the explicit blocking flag retains known or unresolved scale evidence in the report and process-scope ledger rather than letting an early canonical-reference rewrite erase the source-unit safety decision.

## Categories

- `public`: stable operator-facing commands for runtime setup, diagnostics, task routing, profile listing, and task state.
- `workflow-internal`: Foundry policy or artifact helpers used inside the import/authoring workflow.
- `cli-wrapper`: compatibility wrappers over stable owner-command behavior that Foundry does not own, including the unified Rust `tidas` machine contract and sibling `tiangong-lca` CLI behavior.

Every command must have `workflowEntry.status: "active"` and at least one key behavior check, so unused surface area cannot hide as an unreviewed command. `surface-audit` is the read-only guard for hidden command aliases, empty metadata categories, unregistered orphan docs, and script modules with no inbound imports; `doctor` and `acceptance-check` include it.

`tidas-handshake`, `dataset-tidas-import`, and `dataset-tidas-validate` are the active deterministic TIDAS boundary. The handshake accepts compatible 0.2.x binaries that advertise `tidas.operation-report.v1`; the import and validation adapters preserve Rust operation status, completeness, exit class/code, diagnostics, artifacts, next actions, cancellation, and atomic-output semantics. Foundry only maps official batch-validation results into its existing validation report and valid/invalid row files. It does not load a Python source tree, install a Python package, or infer a Python checkout/version.

`execution-capsule-admit` is a `workflow-internal` offline evidence gate. Its contract lives in `docs/execution-capsule-contract.md`; it may snapshot, validate, report, and seal local evidence, but it cannot execute the consumer or grant production authority.

`dataset-incremental-change-set-compose` is a `workflow-internal` offline planner. Its contract lives in `docs/incremental-change-set-contract.md`; it strictly validates old/candidate/current plus owner-receipt evidence, applies only entity/path/value/evidence-bound merge rules, isolates absent/held dependency closures, and emits one hash-chained terminal log event per schema-valid conversion plus a non-empty CLI-compatible candidate contract when actions exist. It has no network, database, CLI, or DML dispatch and never grants production authority.

`dataset-topology-convergence-compose` is a `workflow-internal` offline F/P/D planner. Its contract lives in `docs/topology-convergence-contract.md`; it validates a fresh census and exact candidate closure, reconstructs exchanges by source number plus occurrence, preserves approved multilingual nodes, emits separate flow-create/process-save contracts, and leaves obsolete flows behind a later all-visible zero-inbound delete barrier. It has no network, database, CLI, or DML dispatch and never grants production authority.

`dataset-commit-handoff-plan` emits authoritative `tiangong-foundry.command-spec.v1` objects for commit and post-write verify. Each spec carries a strict executable/argv contract, reader-only display, SHA-256, and the exact final-row artifact fact. Batch runners reject malformed specs, duplicate critical flags, or artifact drift before spawning without a shell.

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

1. `scripts/lib/foundry-command-registry.ts`
2. `scripts/lib/foundry-command-metadata.ts`

Then run:

```bash
pnpm exec node --test test/unit/foundry-command-metadata.test.mts
pnpm surface:audit
pnpm test:commands
pnpm golden:diff
pnpm test:toolchain
pnpm lint
pnpm typecheck
pnpm build
```

New command tests belong in `test/commands/` when they exercise one command's report or artifact contract. Multi-command workflow coverage belongs in `test/scenarios/`, and shared setup belongs in `test/fixtures/`. The same gates must pass after a frozen install in a clean arbitrary worktree, without another checkout's dependencies or ignored runtime artifacts.

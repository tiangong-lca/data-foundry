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
  - scripts/lib/foundry-runtime-paths.ts
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
  - scripts/lib/bafu-family-signatures.ts
  - scripts/lib/import-ledger.ts
  - scripts/lib/canonical-support-rewrites.ts
  - scripts/lib/bundle-sample-utils.ts
  - scripts/foundry-golden-diff.ts
  - scripts/check-tidas-cutover.ts
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
  - scripts/commands/authoring-plan.ts
  - scripts/commands/bundle-sample-rows.ts
  - scripts/commands/incremental-change-set.ts
  - scripts/commands/topology-convergence.ts
  - scripts/commands/core.ts
  - scripts/commands/identity-preflight-run.ts
  - scripts/commands/post-authoring-finalize.ts
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
  - docs/incremental-change-set-contract.md
  - docs/topology-convergence-contract.md
  - test/unit/foundry-command-metadata.test.mts
  - test/unit/foundry-entry-closure-migration.test.mts
  - test/unit/wave25-identity-decision-command-migration.test.mts
  - test/unit/wave25-classification-location-command-migration.test.mts
  - test/unit/import-curation-entry-barrels-migration.test.mts
  - test/unit/import-curation-leaf-barrels-migration.test.mts
  - test/unit/wave26-library-scope-command-migration.test.mts
  - test/unit/wave26-bafu-leaf-classification-command-migration.test.mts
  - test/unit/wave26-bafu-auto-authoring-command-migration.test.mts
  - test/unit/wave26-bafu-process-scope-command-migration.test.mts
  - test/unit/wave26-bafu-batch-command-migration.test.mts
  - test/unit/core-command-factory.test.mts
  - test/unit/identity-preflight-run-command-factory.test.mts
  - test/unit/post-authoring-finalize-command-factory.test.mts
  - test/commands/*.test.mts
lastReviewedAt: 2026-08-29
lastReviewedCommit: a4aaf55
lastReviewedNote: "Reviewed for Issue #74: dataset-process-scope-run retains its command/help surface while scope command values explicitly migrate from argv arrays to CommandSpecs."
---

# Foundry Command Surface

Foundry CLI-spine and command governance has three checked contracts:

- `scripts/lib/foundry-args.ts` is the typed positional/option/scalar parsing contract.
- `scripts/lib/foundry-command-registry.ts` is the typed runtime command list, help JSON, and exit-code policy.
- `scripts/lib/foundry-command-metadata.ts` is the typed AI-readable navigation and ownership map.
- `scripts/lib/surface-audit.ts` checks hidden handlers, category coverage, orphan docs, declared entrypoints, and script-only inbound imports with portable report paths.

The metadata module must cover every command returned by `node scripts/foundry.ts help`. It records each command category, owner module, owner export, input artifacts, output artifacts, workflow entry audit state, and key behavior checks.

Issue #63 preserved the public command categories and behavior while establishing the Node.js 24 / pnpm 11.23 / TypeScript 7.0.2 spine. The argument parser and command registry are native TypeScript leaves; `test/unit/foundry-cli-spine.test.mts` fixes scalar/argv parsing, exact help JSON, exit mapping, and static consumers. The migration is complete, and `test/unit/zero-javascript-ratchet.test.mts` prevents JavaScript owners or compatibility globs from returning. Later work must still preserve command names, help, stdout, exit codes, stage contracts, artifacts, and remote-write modes through focused characterization and real cases.

Issue #82 updates the current package-manager pin to pnpm 11.24.0 without touching that historical command migration or any command registry, metadata, help, stdout, exit, artifact, profile, or write-mode contract.

Wave 25 moves the existing identity, classification, and location owner factories to `.ts` without changing their command metadata or dispatcher topology. The migration tests fix owner/export identity and exact help bytes, while the existing command/scenario fixtures remain the behavior authority for aliases, defaults, queue/path order, blockers, deterministic CLI apply stages, local artifacts, and fail-closed errors.

The Wave 8 BAFU family-signature and import-ledger migrations remain supporting typed leaves beneath the existing `dataset-bafu-batch-import-run` and `dataset-import-ledger-report` owners. Their command registry and metadata entries, help JSON, artifact schemas, exit mapping, and remote-write modes are unchanged.

Wave 9 keeps `dataset-bundle-sample-rows` under its existing command owner and read-only mode. Its metadata now advertises the conditional `canonical-support-amount-scaling.jsonl` artifact and its command test: the explicit blocking flag retains known or unresolved scale evidence in the report and process-scope ledger rather than letting an early canonical-reference rewrite erase the source-unit safety decision.

Wave 24 moves `tasks`, `import-completion`, `commit-handoff`, `identity-decision-task`, and `support-cache` to native TypeScript. Their registered command names, help payloads, owner exports, artifact lists, output ordering, fail-closed states, and read-only modes are unchanged. Focused tests pin exact Markdown/JSON/JSONL bytes, CommandSpec final-row binding and argv, identity snapshot/dedupe order, support-cache HTTP read order and native errors.

Wave 25 moves `cli-wrappers`, `execution-capsule`, and `post-write-closeout` to native TypeScript. The wrappers still delegate executable plus argv arrays and surface process output/errors; capsule admission remains offline and zero-authority; closeout remains read-only and accepts only exact, unique, account/state-bound readback proof under the existing ordinary/production accepted-diff policy.

Wave 25 moves the import-curation leaf, index, and public barrels to TypeScript while command metadata continues to identify semantic owner modules. Metadata links the entry namespace contract as navigation evidence for profile listing, authoring, curation, cleanup, and mutation commands; the runtime command surface and handler injection remain unchanged.

Wave 26 moves the generic library-scope owner and four BAFU orchestration owners to TypeScript. Registered names, metadata categories/exports, serialized help, option aliases/defaults, blocker and artifact order, exit mapping, resumable preflight/batch behavior and explicit-commit-only modes remain unchanged. The USLCI and Worldsteel wrappers now point directly at the typed batch owner but retain their existing frozen profile configuration.

Issue #74 explicitly migrates `dataset-process-scope-run` execution input without changing its command name, help examples, flags, exit families, or output paths. The retained scope keys `commit_command` and `verify_command` now require full artifact-bound CommandSpec objects rather than argv arrays. Command-stage/report JSON therefore records those exact spec objects; raw arrays fail before spawn. `--parallel` now drives the public CLI bounded scheduler while final checkpoints and reports remain input-ordered.

Wave 26 moves TIDAS/finalize adapters and the cutover/Golden entrypoints to native TypeScript. Public Foundry command names and help remain unchanged; package scripts now call the typed audit and Golden entrypoints while retaining the same JSON, exit, merge-base and normalized-diff contracts.

Wave 26 moves `authoring-plan`, `bundle-sample-rows`, `incremental-change-set`, and `topology-convergence` to native TypeScript. Their registered command names, categories, exports, exact help payloads, artifacts, exit mapping and write modes are unchanged. Realistic fixtures pin deterministic phase/row/sample/F-P-D order, path and hash bytes, scale and graph fail-close, terminal receipt and no-authority handoff semantics, native JSON/filesystem failures, and fresh-output boundaries.

Wave 26 moves `core`, `identity-preflight-run`, and `post-authoring-finalize` to native TypeScript. Core retains all public bootstrap/diagnostic/route commands and exact global help. The identity-preflight family retains its four workflow-internal commands, receipt-bound shell-free argv and fail-closed execution evidence. Finalize retains the existing read-only stage pipeline, report/artifact schema, blocker order and handoff plan. Metadata binds each command to the new focused contract tests without changing registry order or categories.

Wave 27 moves every remaining `test/commands/*.test.mjs` contract to `.test.mts` and makes `pnpm test:commands` a single TypeScript-only glob. Command metadata, retained contracts and file-location references point to the renamed tests; runtime owner modules and the command registry remain unchanged.

The completed emitted-runtime hardening keeps the same command surface while removing an output-directory ambiguity: source `scripts/foundry.ts` and emitted `dist/scripts/foundry.js` resolve one trusted package root independently of CWD, and batch, process-scope and finalize self-invocations use the active entry rather than a hard-coded source path. The entry-closure contract pins full profile discovery, exact help/unknown behavior and nested entry identity for both forms.

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
scripts/foundry.ts
  -> scripts/lib/foundry-cli.ts
  -> owner module in scripts/commands or scripts/lib/import-curation
```

Public command owner paths must be at most two jumps from `scripts/foundry.ts`. For semantic import-curation commands, prefer owner modules such as `profiles.ts`, `curation-gate.ts`, `authoring-packages.ts`, `patch-collect.ts`, `curation-cleanup.ts`, `trace-summary.ts`, and `mutation-manifest.ts` over mechanical part names. Reusable import-curation logic is exposed through focused TypeScript workflow facets under `scripts/lib/import-curation/internal/*-workflow.ts`.

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

---
title: Foundry Workspace Project Map
docType: reference
scope: workspace-adapters
status: active
authoritative: true
owner: tiangong-lca-data-foundry
language: en
whenToUse:
  - when routing Foundry capabilities to sibling TianGong LCA projects
  - when checking whether a missing capability should be implemented in Foundry or another repo
whenToUpdate:
  - when workspace project ownership, normal surfaces, or routing boundaries change
checkPaths:
  - docs/workspace-project-map.md
  - docs/architecture.md
  - docs/capability-ownership-policy.md
  - docs/foundry-ai-navigation.md
  - docs/foundry-command-surface.md
  - test/README.md
  - specs/capability-ownership-rules.json
  - specs/workspace-capability-adapters.md
  - docs/incremental-change-set-contract.md
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
  - scripts/lib/import-curation.ts
  - scripts/lib/import-curation/index.ts
  - scripts/lib/import-curation/profiles.ts
  - scripts/lib/import-curation/trace-summary.ts
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
lastReviewedAt: 2026-08-25
lastReviewedCommit: 898eb5cc5b348095e3ac096804e5271d2203479c
lastReviewedNote: "Reviewed for Issue #67 Wave 27 command tests: the TS7-only command-test surface remains Foundry-local evidence; published CLI behavior, cross-repository ownership, readback, profiles, Worldsteel/Date.parse, and execution boundaries are unchanged."
---

# Workspace Project Map

Foundry should route reusable work to the owning repository instead of copying implementation locally.

| Need | Owning project | Normal surface |
| --- | --- | --- |
| TIDAS schema/methodology runtime contract | Rust `tidas` for deterministic validation; `tidas-sdk`/`tiangong-lca-cli` for AI context | `tidas validate --describe`; `pnpm exec tiangong-lca dataset context-pack` |
| Source package detection/import/conversion | Rust `tidas` (`tidas-tools`) | `node scripts/foundry.mjs dataset-tidas-import` → `tidas import` |
| Entity curation queue state | `tiangong-lca-cli` | `pnpm exec tiangong-lca dataset curation-queue build/next/verify` |
| PDF/Excel/source extraction and authoring setup | `tiangong-lca-cli`, `tiangong-lca-skills`, and `tiangong-ai/skills` | `pnpm exec tiangong-lca dataset author`, `$tidas-data-import`, `pnpm dlx skills@latest use https://github.com/tiangong-ai/skills --skill document-granular-decompose --full-depth` |
| SCI literature evidence retrieval for source-evidence tasks | `tiangong-ai/skills` | `pnpm dlx skills@latest use https://github.com/tiangong-ai/skills --skill tiangong-kb-sci-search --full-depth`; install/update with the `skills` registry package through pnpm |
| Agent workflow instructions | `tiangong-lca-skills` | `$tidas-contract-context`, `$tidas-data-import` |
| Schema validation | Rust `tidas` (`tidas-tools`) | `node scripts/foundry.mjs dataset-tidas-validate` → `tidas validate` |
| Deterministic QA and curation gates | `tiangong-lca-cli` | `pnpm exec tiangong-lca qa`, `dataset curation-queue build/next/verify` |
| Identity-preflight candidate search | Edge Functions for request orchestration; `database-engine` for `extracted_md` lexical and `embedding_ft` semantic execution | Foundry forwards one `lexical_weight` and one `semantic_weight` through `dataset-identity-preflight-run` |
| Remote commit, readback, and publish prep | `tiangong-lca-cli`, Edge Functions, database | `dataset-post-authoring-finalize` and source/contact support handoff artifacts, installed CLI commit commands, `pnpm exec tiangong-lca dataset verify-remote`, `publish run`, Edge verification; Foundry does not override foreign/RLS-hidden `missing_dataset` readback |
| Credential-scoped identity proof and process guard | `tiangong-lca-cli` for live session/receipt; `tiangong-lca-data-foundry` for profile/thread intent and child isolation | `pnpm account:run -- <profile> -- <executable> [args...]` → installed CLI 0.1.1 `auth identity-receipt` |
| Foundry task routing and manifests | `tiangong-lca-data-foundry` | `scripts/foundry.mjs route-task` |
| Write/execution policy and blocked-scope ledgers/reports | `tiangong-lca-data-foundry` | `foundry-job.json`, library entity indexes, index-relative process-scope projections, deterministic transform evidence reconciliation, source-only-output exchange proof reconciliation, checkpoints, `blocked-scope-ledger.jsonl`, `blocked-scope-report.json`, mutation manifest aggregation, closeout reports |
| Incremental release planning and conversion logs | `tiangong-lca-data-foundry` for offline composition; `tiangong-lca-cli` for execution/readback | `dataset-incremental-change-set-compose`, per-conversion JSONL, dependency closure, CLI candidate contract, then fresh reconciliation/capsule admission and published CLI execution |
| Flow-topology convergence and physical retirement | `tiangong-lca-data-foundry` for offline F/P/D composition; `tiangong-lca-cli` for protected execution/readback | `dataset-topology-convergence-compose`, occurrence-keyed conversion logs, F/P contracts, post-P zero-inbound D candidates, then fixed-fingerprint `dataset maintenance apply` |
| Foundry test structure and command navigation checks | `tiangong-lca-data-foundry` | `test/README.md`, `test/unit`, `test/commands`, `test/scenarios`, `test/fixtures`, `scripts/lib/foundry-command-metadata.ts`, `scripts/lib/surface-audit.ts` |
| Foundry package/compiler, portable artifact I/O, and typed migration spine | `tiangong-lca-data-foundry` | Node.js 24, `pnpm@11.23.0`, TypeScript `7.0.2`, Oxlint, `.gitattributes` LF policy, separator-neutral artifact handling, writable-descriptor durability, immutable-baseline `specs/typescript-migration-inventory.json`, clean arbitrary-worktree gates, and merge-base Golden comparison |
| Foundry-local surface cleanup | `tiangong-lca-data-foundry` | remove old aliases, empty command categories, and orphaned draft docs only after metadata, tests, docs, and docpact show no remaining consumer |

Before implementing a missing capability, classify it with `docs/capability-ownership-policy.md` and `specs/capability-ownership-rules.json`.

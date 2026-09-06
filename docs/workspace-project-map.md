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
  - scripts/foundry-golden-diff.ts
  - scripts/check-tidas-cutover.ts
  - scripts/check-lint-suppressions.ts
  - scripts/clean-build-output.ts
  - scripts/build-foundry-package.ts
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

# Workspace Project Map

Migration transfer planning is governed by [the workspace migration contract](workspace-migration-contract.md). W10 provides explicit source/queue/input staging, current-owner task adoption, audited v2 activation and separate runtime read/write selection. Preserved history blocks replay across requests and migrations; none of these records grants business permission. Operational qualification and release integration remain tracked in #108/#980.

The v2 task store persists registered job/source/profile identity, account intent, producer receipts and artifact lineage; deterministic local retries reuse verified results. Exact C1/TIDAS qualification, all-command disposition, derived authorization and child admission form the W04 authority boundary. The W05 hierarchical facade now adds strict result/task schemas, deterministic request revisions, actor-bound status/resume, local preparation and read-only migration inventory. W06 owns the installable candidate closure; W08 owns F1 publication and platform components. See `docs/public-runtime-contract.md`, `docs/runtime-context-contract.md`, `docs/task-authorization-contract.md` and `docs/foundry-task-contracts.md`.

The explicit workspace runtime is defined by `docs/runtime-context-contract.md`: package layout comes from `package.json.foundryRuntime`, emitted execution needs no source TypeScript or Git, and selected inputs/task outputs are bound to an immutable runtime context. `scripts/runtime-entry.ts` now implements workspace init/migration, consumer doctor and task start/status/resume as the separate hierarchical facade. All 63 flat owner commands retain explicit public/internal/excluded, path, child, qualification and authorization dispositions; the facade reaches them only through registered task state and never falls back to the developer runner.

Import profiles distribute source rules only. Historical BAFU/USLCI/Worldsteel account overrides, QA waivers and the Worldsteel full-context relaxation grant no permission to a new task. `docs/task-authorization-contract.md` owns the separate workspace/task/actor/account/profile/input binding and exact action evidence. Local candidate preparation and checked public-reference proofs remain available; current final-row hashes, task permissions and all content/closure/no-replay gates are required before a restricted write handoff.

Foundry should route reusable work to the owning repository instead of copying implementation locally.

The Wave 26 library, classification, authoring, process-scope and batch modules are Foundry-local orchestrators. Their TypeScript migration changes navigation and static ownership only: shared CLI commands, profile policy, database behavior and sibling-project semantics remain with the owners listed below.

| Need | Owning project | Normal surface |
| --- | --- | --- |
| Installed workspace/task facade, request revisions and local task evidence | `tiangong-lca-data-foundry` | W06 candidate `tiangong-foundry workspace ...`, `doctor`, and `task start/status/resume`; W08 publishes F1 |
| TIDAS schema/methodology runtime contract | Rust `tidas` for deterministic validation; `tidas-sdk`/`tiangong-lca-cli` for AI context | `tidas validate --describe`; `pnpm exec tiangong-lca dataset context-pack` |
| Source package detection/import/conversion | Rust `tidas` (`tidas-tools`) | `node scripts/foundry.ts dataset-tidas-import` → `tidas import` |
| Entity curation queue state | `tiangong-lca-cli` | `pnpm exec tiangong-lca dataset curation-queue build/next/verify` |
| PDF/Excel/source extraction and authoring setup | `tiangong-lca-cli`, `tiangong-lca-skills`, and `tiangong-ai/skills` | `pnpm exec tiangong-lca dataset author`, `$tidas-data-import`, `pnpm dlx skills@latest use https://github.com/tiangong-ai/skills --skill document-granular-decompose --full-depth` |
| SCI literature evidence retrieval for source-evidence tasks | `tiangong-ai/skills` | `pnpm dlx skills@latest use https://github.com/tiangong-ai/skills --skill tiangong-kb-sci-search --full-depth`; install/update with the `skills` registry package through pnpm |
| Agent workflow instructions | `tiangong-lca-skills` | `$tidas-contract-context`, `$tidas-data-import` |
| Schema validation | Rust `tidas` (`tidas-tools`) | `node scripts/foundry.ts dataset-tidas-validate` → `tidas validate` |
| Deterministic QA and curation gates | `tiangong-lca-cli` | `pnpm exec tiangong-lca qa`, `dataset curation-queue build/next/verify` |
| Identity-preflight candidate search | Edge Functions for request orchestration; `database-engine` for `extracted_md` lexical and `embedding_ft` semantic execution | Foundry forwards one `lexical_weight` and one `semantic_weight` through `dataset-identity-preflight-run` |
| BAFU candidate physical-equivalence review | `tiangong-lca-data-foundry` for deterministic local decision evidence; Edge/database remain candidate-search owners | `scripts/lib/bafu-authoring/identity-equivalence.ts` → `dataset-bafu-identity-decisions-autofill`; exact names cannot override recorded physical conflicts |
| BAFU category-map completion and manual-review projection | `tiangong-lca-data-foundry` for local closure/status/blockers; TIDAS schema and AI/human decisions retain vocabulary/choice ownership | `category-map-projection.ts` artifacts → `category-map-report.ts` closure report → command nonzero on any emitted manual review |
| Canonical multilingual description transport | `tiangong-lca-data-foundry` for lossless local rewrite/reference/ledger projection; schema and semantic decision owners retain value/identity choice | `canonical-description.ts` validation/clone → library rewrite ledger → identity resolution/apply/carry-forward without display coercion |
| Post-finalize recovery command evidence | `tiangong-lca-data-foundry` for exact local executable/argv dispatch and reader projection; CLI/database retain remote mutation/readback authority | one recovery helper → exact `{ executable, argv, display }` → logs/report path → fail before downstream stage on drift |
| Location task-queue continuity | `tiangong-lca-data-foundry` for local path/bytes/SHA binding; TIDAS schema and location decision/apply tooling retain taxonomy/value semantics | task build → one queue discovery/fact → suggest → exact fact verify → apply only if unchanged |
| Generic ready-scope CommandSpec and bounded scheduling | `tiangong-lca-cli` for public contract, artifact checks, locked claims/pause/stop/no-retry; Foundry for LCA readiness, input-order reports and logs | scope CommandSpecs + full scope/spec/policy/CLI fingerprints → public CLI batch → Foundry checkpoints/blockers |
| Same-id/version lost-success recovery | Foundry for strict structured-evidence eligibility and no-replay orchestration; `tiangong-lca-cli`, Edge Functions, and database for mutation outcome and readback truth | explicit `23505` plus exact conflict semantics → one commit dispatch → content-bound verify of owner/state/id/version/payload/root → closeout only on exact proof |
| Remote commit, readback, and publish prep | `tiangong-lca-cli`, Edge Functions, database | `dataset-post-authoring-finalize` and source/contact support handoff artifacts, installed CLI commit commands, `pnpm exec tiangong-lca dataset verify-remote`, `publish run`, Edge verification; Foundry does not override foreign/RLS-hidden `missing_dataset` readback |
| Credential-scoped identity proof and process guard | `tiangong-lca-cli` for live session/receipt; `tiangong-lca-data-foundry` for profile/thread intent and child isolation | `pnpm account:run -- <profile> -- <executable> [args...]` → installed CLI 0.1.10 `auth identity-receipt` |
| Foundry task routing and manifests | `tiangong-lca-data-foundry` | `scripts/foundry.ts route-task` |
| Write/execution policy and blocked-scope ledgers/reports | `tiangong-lca-data-foundry` | `foundry-job.json`, library entity indexes, index-relative process-scope projections, deterministic transform evidence reconciliation, source-only-output exchange proof reconciliation, checkpoints, `blocked-scope-ledger.jsonl`, `blocked-scope-report.json`, mutation manifest aggregation, closeout reports |
| Incremental release planning and conversion logs | `tiangong-lca-data-foundry` for offline composition; `tiangong-lca-cli` for execution/readback | `dataset-incremental-change-set-compose`, per-conversion JSONL, dependency closure, CLI candidate contract, then fresh reconciliation/capsule admission and published CLI execution |
| Flow-topology convergence and physical retirement | `tiangong-lca-data-foundry` for offline F/P/D composition; `tiangong-lca-cli` for protected execution/readback | `dataset-topology-convergence-compose`, occurrence-keyed conversion logs, F/P contracts, post-P zero-inbound D candidates, then fixed-fingerprint `dataset maintenance apply` |
| Foundry test structure and command navigation checks | `tiangong-lca-data-foundry` | `test/README.md`, `test/unit`, `test/commands`, `test/scenarios`, `test/fixtures`, `scripts/lib/foundry-command-metadata.ts`, `scripts/lib/surface-audit.ts` |
| Foundry package/compiler, portable artifact I/O, and typed runtime | `tiangong-lca-data-foundry` | Node.js 24, `pnpm@11.24.0`, TypeScript `7.0.2`, public-only package entry/API, sanitized staging manifest, descriptor-bound source-free closure, trusted source/emitted/package discovery, credential-free Golden comparison, zero-JavaScript ratchet and four-platform tests |
| Foundry-local surface cleanup | `tiangong-lca-data-foundry` | remove old aliases, empty command categories, and orphaned draft docs only after metadata, tests, docs, and docpact show no remaining consumer |

Before implementing a missing capability, classify it with `docs/capability-ownership-policy.md` and `specs/capability-ownership-rules.json`.

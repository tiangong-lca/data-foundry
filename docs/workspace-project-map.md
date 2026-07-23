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
  - docs/final-delivery-promotion-contract.md
  - test/README.md
  - specs/capability-ownership-rules.json
  - specs/workspace-capability-adapters.md
lastReviewedAt: 2026-07-23
lastReviewedCommit: f10932a864e54f3826afc0141f33fbcf9190344e
---

# Workspace Project Map

Foundry should route reusable work to the owning repository instead of copying implementation locally.

| Need | Owning project | Normal surface |
| --- | --- | --- |
| TIDAS schema, methodology YAML, runtime rulesets | `tidas-sdk` | SDK contract API, `npx --yes @tiangong-lca/cli@latest dataset context-pack` |
| Source package conversion | `tidas-tools` and `tiangong-lca-cli` | `npx --yes @tiangong-lca/cli@latest dataset import-lca convert` |
| Entity curation queue state | `tiangong-lca-cli` | `npx --yes @tiangong-lca/cli@latest dataset curation-queue build/next/verify` |
| PDF/Excel/source extraction and authoring setup | `tiangong-lca-cli`, `tiangong-lca-skills`, and `tiangong-ai/skills` | `npx --yes @tiangong-lca/cli@latest dataset author`, `$tidas-data-import`, `npx --yes skills@latest use https://github.com/tiangong-ai/skills --skill document-granular-decompose --full-depth` |
| SCI literature evidence retrieval for source-evidence tasks | `tiangong-ai/skills` | `npx --yes skills@latest use https://github.com/tiangong-ai/skills --skill tiangong-kb-sci-search --full-depth`; install/update with the npm `skills` package |
| Agent workflow instructions | `tiangong-lca-skills` | `$tidas-contract-context`, `$tidas-data-import` |
| Schema validation and QA gates | `tiangong-lca-cli` | `npx --yes @tiangong-lca/cli@latest dataset validate`, `npx --yes @tiangong-lca/cli@latest qa` |
| Remote commit, readback, and publish prep | `tiangong-lca-cli`, Edge Functions, database | `dataset-post-authoring-finalize` and source/contact support handoff artifacts, published CLI commit commands, `npx --yes @tiangong-lca/cli@latest dataset verify-remote`, `publish run`, Edge verification |
| Foundry task routing and manifests | `tiangong-lca-data-foundry` | `scripts/foundry.mjs route-task` |
| Offline final-delivery promotion and reviewer gate | `tiangong-lca-data-foundry` | `scripts/foundry.mjs final-delivery-promote`, `foundry-final-delivery-manifest.v1`, immutable promotion ledger/report, detached non-production seal |
| Write/execution policy and blocked-scope ledgers/reports | `tiangong-lca-data-foundry` | `foundry-job.json`, library entity indexes, index-relative process-scope projections, deterministic transform evidence reconciliation, source-only-output exchange proof reconciliation, checkpoints, `blocked-scope-ledger.jsonl`, `blocked-scope-report.json`, mutation manifest aggregation, closeout reports |
| Foundry test structure and command navigation checks | `tiangong-lca-data-foundry` | `test/README.md`, `test/unit`, `test/commands`, `test/scenarios`, `test/fixtures`, `scripts/lib/foundry-command-metadata.mjs` |
| Foundry-local surface cleanup | `tiangong-lca-data-foundry` | remove old aliases, empty command categories, and orphaned draft docs only after metadata, tests, docs, and docpact show no remaining consumer |

Before implementing a missing capability, classify it with `docs/capability-ownership-policy.md` and `specs/capability-ownership-rules.json`.

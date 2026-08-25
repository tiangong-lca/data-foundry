---
title: Data Foundry Architecture
docType: guide
scope: repo
status: active
authoritative: true
owner: tiangong-lca-data-foundry
language: en
whenToUse:
  - when deciding what belongs in Foundry versus CLI, skills, tools, SDK, database, or Edge projects
  - when reviewing public Foundry command surface or retired daemon/runtime assumptions
whenToUpdate:
  - when Foundry ownership, lane architecture, runtime model, or cross-project routing changes
checkPaths:
  - docs/architecture.md
  - docs/foundry-ai-navigation.md
  - docs/foundry-command-surface.md
  - AGENTS.md
  - README.md
  - WORKFLOW.md
  - test/README.md
  - docs/capability-ownership-policy.md
  - docs/workspace-project-map.md
  - specs/capability-ownership-rules.json
  - specs/automated-lca-capability-registry.json
  - specs/typescript-migration-inventory.json
  - scripts/lib/foundry-args.ts
  - scripts/lib/foundry-command-registry.ts
  - scripts/lib/foundry-command-metadata.ts
  - scripts/lib/surface-audit.ts
  - scripts/lib/bundle-row-types.ts
  - scripts/lib/tidas-language-utils.ts
  - scripts/lib/import-curation/internal/hash-utils.ts
  - scripts/lib/import-curation/internal/dataset-types.ts
  - scripts/lib/import-curation/internal/runtime-io.ts
  - scripts/lib/import-curation/internal/artifact-inputs.ts
  - scripts/lib/import-curation/internal/context-inputs.ts
  - scripts/lib/import-curation/internal/dataset-payload.ts
  - scripts/lib/import-curation/internal/trace-summary.ts
  - scripts/lib/canonical-support-mappings.ts
  - scripts/lib/source-semantics.ts
  - scripts/lib/trace-coverage.ts
  - scripts/lib/tidas-row-utils.ts
  - .prettierignore
  - package.json
  - pnpm-lock.yaml
  - pnpm-workspace.yaml
  - prettier.config.cjs
  - tsconfig*.json
  - scripts/with-lca-account.ts
  - docs/incremental-change-set-contract.md
lastReviewedAt: 2026-08-25
lastReviewedCommit: cafacf6683810777a91bc1b03e014d708e817b1e
lastReviewedNote: "Reviewed for Issue #67 Wave 5: typed artifact/context/dataset/trace boundaries remain Foundry-local evidence contracts and do not alter CLI schema assets or sibling ownership."
---

# Architecture

## Current Shape

Foundry is a thin local control plane. It owns task intake, profile locks, workspace ledgers, owner routing, and gate aggregation. It does not own reusable dataset execution logic.

For command ownership and navigation, use `docs/foundry-ai-navigation.md`, `docs/foundry-command-surface.md`, and the checked `scripts/lib/foundry-command-metadata.ts` map. Those files classify every Foundry command and link each command to its owner module, artifacts, and tests without changing the runtime `help` output.

The minimum runtime shape is:

```text
Foundry
  = task + workspace + profile + checkpoint + gate aggregator

tiangong-lca-cli
  = conversion + validation + QA + curation queue state + remote write/verify

tiangong-lca-skills
  = top-level workflows + child semantic authoring skills

tiangong-ai/skills
  = floating source-evidence and document-extraction runtime skills resolved with pnpm dlx skills

profiles
  = generic / bafu / uslci constraints
```

## Toolchain And Typed-Spine Boundary

Foundry's Node runtime is standardized on Node.js 24, `pnpm@11.23.0`, TypeScript `7.0.2`, Oxlint, and Prettier. pnpm is the sole dependency manager and owns the only root workspace and lockfile. The compiler graph must contain TypeScript 7.0.2 only; TypeScript 5/6 aliases, `@typescript-eslint`, and formatting plugins that load the TypeScript compiler API are not compatibility paths.

At the Issue #63 baseline, the estate is still 160 tracked JavaScript artifacts: 95 `.mjs` runtime files (59,692 lines), 64 `.mjs` test files (30,273 lines), and one Prettier `.cjs` config. That inventory is explicit in `specs/typescript-migration-inventory.json`. The typed spine is introduced in dependency order:

```text
entrypoint + args
  -> command registry + metadata
  -> runtime I/O + artifact/receipt contracts
  -> semantic command families
  -> scenario and real-case fixtures
```

This boundary avoids a misleading bulk rename. Each module remains in the inventory until a TypeScript replacement preserves its command, artifact, stdout, exit, and safety behavior under focused tests. Completion means no untyped business-runtime modules remain and the full case-driven suite is green.

The native TypeScript leaf set now covers the CLI and internal contracts plus standalone canonical-support, source-semantics, trace-coverage, and TIDAS-row factories. Focused characterization preserves exact mapping bytes/scales, profile defaults and source rewrites, trace queue blocker algebra, root/id/version/multilingual transforms, path/hash/order/error behavior, and every static consumer before higher workflow facets move across the boundary.

Build and test resolution must be worktree-local. A clean arbitrary Git worktree must be able to run `pnpm install --frozen-lockfile`, lint, typecheck, build, toolchain tests, and the full test suite without a superproject-relative dependency, another checkout's `node_modules`, ignored `.foundry` state, or credentials.

Cross-platform characterization is also explicit: the Golden harness compares normalized outputs to a non-`HEAD` merge-base, performs recursive comparison in Node rather than calling an external Unix utility, and uses full Git history in CI. Script-backed executable overrides are represented as an executable plus argv prefix and run through Node on macOS, Linux, and Windows. The root `.gitattributes` fixes text files to LF while allowing Windows launcher exceptions, preventing checkout policy from masquerading as format drift.

The first credential-bearing entrypoint on that spine is `scripts/with-lca-account.ts`. It does not authenticate against Supabase itself. It resolves the exact installed CLI 0.1.1, requests `auth identity-receipt` with both expected project and user assertions, accepts only a fresh intent-bound forced signin, and then launches the requested executable plus argv with `shell:false` and a restricted environment. The CLI owns session and live identity behavior; Foundry owns the profile/thread intent checks and safe process boundary.

The artifact layer treats JSON paths as portable identifiers: scope extraction normalizes separators, transitional command parsers retain native backslashes, and durable writers flush a writable descriptor before close. POSIX file-mode assertions are evidence on POSIX platforms rather than a fabricated Windows contract.

The handoff execution boundary is typed and content-addressed. `scripts/lib/foundry-command-spec.ts` strictly parses `tiangong-foundry.command-spec.v1`, rejects duplicate safety-critical flags, and hashes `executable`, `argv`, and artifact bindings. `display` is derived but non-authoritative. Commit and verify bind the same `final_rows_artifact`; BAFU runners re-read its byte count and SHA-256 before spawning the published CLI without a shell.

## Foundry-Owned Layers

1. Task intake
   - create or classify a task
   - choose `external-dataset-curated-import` or `source-evidence-dataset-development`
   - freeze `source-manifest.json` or `seed-manifest.json`

2. Profile lock
   - resolve profile id
   - freeze constraints hash
   - record account/write policy guard

3. Workspace ledger
   - manage `.foundry/workspaces/<task-id>/`
   - maintain `foundry-job.json`, checkpoints, and `artifact-index.jsonl`
   - record runtime skill resolution when external evidence skills are used

4. Route to owner
   - call published CLI commands or top-level skills
   - do not duplicate owner behavior locally

5. Gate aggregate
   - check that schema, QA, curation, queue verify, dry-run, closeout, and readback artifacts exist
   - verify artifacts point to the same rows scope
   - accept identity/classification/location evidence across deterministic row transforms such as source/contact rewrites, canonical support rewrites, identity reference rewrites, unresolved-exchange externalization, and cleanup
   - reconcile deterministic source-only-output exchange proofs from cleanup against final-row `sourceExchangeCompleteness` traces
   - generate completion reports

6. Whole-library scope orchestration
   - build root TIDAS unique-entity indexes for packaged imports
   - project library-level identity/classification/support decisions back to process scopes
   - resolve bundle manifest and `tidas_dir` paths relative to `process-bundles/index.json`
   - record ready scope checkpoints, blocked-scope ledgers, and reader-facing blocked-scope reports without turning blocked scopes into write candidates

7. Incremental release planning
   - compare old source semantics, new candidate semantics, and a current owner-draft snapshot under one SHA-bound request
   - enforce strict Draft 2020-12 inputs/outputs and entity/path/value/evidence-bound three-way rules, then emit minimal INSERT/UPDATE candidates, complete NOOP/HOLD evidence, stable dependency order, and one hash-chained terminal log event per schema-valid conversion
   - stop at an offline `production_authority=false` CLI candidate contract; fresh reconciliation, owner session, capsule admission, mutation, and readback remain outside Foundry

8. Topology convergence planning
   - bind a complete candidate flow/process closure to one package digest and one fresh owner/public/foreign SELECT-only census
   - classify target flows without overwriting public or foreign rows, reconstruct ordered process exchanges by process-local source number plus occurrence, and preserve only explicitly audited multilingual overlays
   - emit separate F flow-create and P process-save contracts while keeping D as zero-inbound delete candidates; protected transactions, attempt state, post-P inbound proof, and delete execution remain CLI/database responsibilities

9. Local behavior test structure
   - keep unit tests, command contract tests, multi-command scenarios, and shared fixtures in the `test/README.md` layout
   - protect Foundry orchestration and artifact contracts locally without absorbing reusable CLI, skill, SDK, database, or Edge behavior

10. Surface cleanup

- remove compatibility aliases, empty command categories, and draft orchestration references once current commands, metadata, tests, docs, and docpact show no remaining consumer
- keep historical or dataset-specific guidance only when it has an active route, profile, task, or retained reference role

## v0 Runtime

The v0 runtime is intentionally small:

- filesystem task queue
- queue/checkpoint-aware batch execution contracts, including task-scoped `max_parallelism`
- workflow/task validation script
- read-only workspace map diagnostic
- no persistent database
- no direct database commit from Foundry code; remote commit is allowed only through official CLI/platform commands when profile gates, write policy, commit handoff, and post-write verification are satisfied
- profile-authorized owner-draft support maintenance remains a CLI/database responsibility: Foundry freezes the candidate registry and complete-plan evidence, while the CLI submits one database-atomic plan and records its audit/readback proof; Foundry must not split that plan into independently committed dimension batches
- remote verification never treats a foreign or RLS-hidden `state_code=0` row as reusable evidence: `missing_dataset` remains blocking until the importing account can read an allowed public or same-owner reference. The retained normalization is limited to exact root payloads differing only in import-trace `traceHash`, and production-test accounts disable even that acceptance.
- generated source/contact support rows may get Foundry-prepared finalize and commit-handoff artifacts, but dependent process/flow/lifecyclemodel scopes must wait for the CLI commit and readback verification of those support rows
- the exact installed CLI dependency is the default command path: `pnpm exec tiangong-lca ...`
- test execution is local and layered: `pnpm test` runs all behavior layers, while `pnpm test:unit`, `pnpm test:commands`, and `pnpm test:scenarios` target specific Foundry-owned surfaces; `pnpm test:toolchain` protects the pnpm/TS7 graph and migration inventory

## Retired v1 Daemon Direction

Poll loops, persistent daemons, app-server integration, unbounded concurrency orchestration, retry schedulers, and reconciliation workers are not part of the current Foundry architecture. Bounded parallel batch execution is represented as task workspace policy plus CLI queue locks/checkpoints, not as a resident Foundry daemon. Broader runtime workers may be reconsidered only after the two lane workflows are stable and the owner command surfaces are complete.

Retired direction:

```text
poll tasks -> claim -> create workspace -> launch agent -> collect outputs -> update task state -> verify -> repeat
```

## Workspace-Aware Direction

The foundry should call the owning workspace surface instead of absorbing implementation:

- `tidas-tools`: unified Rust `tidas` owner for deterministic format detection, package import/conversion, schema validation, stable machine reports/exits, cancellation, and atomic publication
- `tiangong-lca-cli`: default command surface for contract context, source authoring, QA/curation, remote data operations, and handoff
- `tiangong-lca-skills`: agent-facing wrappers over CLI commands
- `tiangong-ai/skills`: runtime-only source-evidence and document extraction skills such as `document-granular-decompose` and `tiangong-kb-sci-search`, resolved through `pnpm dlx skills@latest`
- `tiangong-lca-edge-functions`: Edge Function runtime, including Hybrid Search request orchestration and `embedding_ft` jobs; Foundry forwards one `lexical_weight` and one `semantic_weight`
- `database-engine`: database RPCs, triggers, vector indexes, and schema governance
- `tidas`: TIDAS specification
- `tidas-sdk`: compatibility SDK and context APIs

See `docs/workspace-project-map.md` and `specs/workspace-capability-adapters.md` for the routing contract.

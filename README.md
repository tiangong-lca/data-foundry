---
title: TianGong LCA Data Foundry
docType: guide
scope: repo
status: active
authoritative: false
owner: tiangong-lca-data-foundry
language: en
whenToUse:
  - when checking Foundry lanes, public commands, runtime skill usage, or repository shape
  - when looking for user-facing examples for route-task, profiles, and owner-routed CLI work
whenToUpdate:
  - when Foundry public commands, lane names, runtime skill policy, or repository layout change
checkPaths:
  - README.md
  - .nvmrc
  - .oxlintrc.json
  - .prettierignore
  - package.json
  - pnpm-lock.yaml
  - pnpm-workspace.yaml
  - prettier.config.cjs
  - tsconfig*.json
  - scripts/foundry.mjs
  - scripts/lib/foundry-args.ts
  - scripts/lib/foundry-command-registry.ts
  - scripts/lib/foundry-command-metadata.ts
  - scripts/lib/surface-audit.ts
  - docs/architecture.md
  - docs/runtime-skill-management.md
  - docs/foundry-task-contracts.md
  - docs/incremental-change-set-contract.md
  - docs/topology-convergence-contract.md
  - specs/import-profiles.json
  - specs/typescript-migration-inventory.json
lastReviewedAt: 2026-08-25
lastReviewedCommit: f5206e37987e7ff8db7f5f207965dcd8b5204201
lastReviewedNote: "Reviewed for Issue #65: typed CommandSpecs bind final-row bytes, foreign hidden drafts stay blocked, and the typed account boundary requires CLI 0.1.1 intent-bound receipts."
---

# TianGong LCA Data Foundry

Control plane for turning external source material into validated, import-ready TIDAS data.

Foundry is intentionally thin. It owns task routing, local workspaces, import profiles, curation packages, cleanup reports, stable owner-command adapters, and policy checks. Deterministic package import/conversion/schema validation belongs to unified Rust `tidas`; contract context, QA, curation, skills, and database behavior belongs in `tiangong-lca-cli`, `tidas-sdk`, `tiangong-lca-skills`, Edge Functions, or database projects.

Identity-preflight candidate requests use the current Hybrid Search contract: one `lexical_weight` for the database `extracted_md` branch and one `semantic_weight` for `embedding_ft`.

Remote verification is visibility-bound. A `missing_dataset` reference that is foreign or hidden by RLS remains a blocker and cannot be converted to passed from a trusted-key list or another account's observation. The only retained accepted-difference mechanism is exact root readback whose sole normalized difference is `tiangongfoundry:importTraceSummary.traceHash`; production-test account cases accept no difference at all.

## Toolchain And Typed Spine

Foundry is a pnpm-only Node.js 24 project. The reproducible toolchain is `pnpm@11.23.0`, TypeScript `7.0.2` as the only compiler anywhere in the dependency graph, Oxlint for linting, and Prettier for formatting. The repository keeps one root `pnpm-workspace.yaml` and `pnpm-lock.yaml`; npm/Yarn lockfiles, TypeScript 5/6 aliases, `@typescript-eslint`, and TypeScript-compiler-backed formatting plugins are outside the supported graph.

Issue #63 starts the typed spine without pretending that the existing JavaScript estate is already migrated. At the baseline commit, 160 tracked JavaScript artifacts comprise 95 runtime `.mjs` files (59,692 lines), 64 `.mjs` tests (30,273 lines), and one Prettier `.cjs` config. `specs/typescript-migration-inventory.json` records that boundary. Entrypoints, command metadata/registry, runtime I/O, and artifact/receipt contracts migrate first; command families and tests follow under characterization and real-case TDD. A module leaves the inventory only when its typed replacement and behavior evidence pass.

The first completed CLI-spine slice migrates `scripts/lib/foundry-args.ts` and `scripts/lib/foundry-command-registry.ts`. Its focused test fixes parser coercion, exact help JSON and command order, exit-code families, and all static consumer imports before later entrypoint and dispatcher slices proceed.

The next slice migrates `scripts/lib/foundry-command-metadata.ts` and `scripts/lib/surface-audit.ts`. Characterization fixes all 63 metadata owner/export/artifact contracts plus TS import discovery, portable report paths, test-only inbound exclusion, orphan docs, declared entrypoints, hidden handlers, report JSON, and static consumers.

Every toolchain or migration change must also pass from a clean arbitrary Git worktree: install with `pnpm install --frozen-lockfile`, then run the canonical lint, typecheck, build, toolchain, and test gates without borrowing sibling checkouts, another worktree's `node_modules`, ignored `.foundry` artifacts, or credentials.

The Golden gate checks normalized command artifacts against a non-`HEAD` merge-base (normally `origin/main`) with a Node-native recursive comparator, so committed PR changes cannot degrade into a self-comparison and Windows runners do not depend on a Unix `diff` binary. Script-backed test executables such as fake TIDAS run through `process.execPath` on every platform, and `.gitattributes` keeps repository text at LF so Prettier observes the same bytes on every checkout.

Artifact paths recorded by fixtures must accept both platform separators. Durable JSON writers fsync the same writable descriptor they opened; POSIX permission-bit assertions apply only where the operating system implements those bits.

Remote handoff commands are machine contracts, not shell snippets. `dataset-commit-handoff-plan` emits `tiangong-foundry.command-spec.v1` objects whose `executable` and `argv` are authoritative. `display` is derived for readers and is excluded from the command hash. Both commit and post-write verify specs bind the exact final rows path, bytes, and SHA-256; batch runners verify the binding immediately before `shell=false` execution.

## Production Case TDD

Production-backed development is an explicit case lane, not an ordinary test or CI secret path. The guarded contact case performs offline TIDAS validation and save-draft dry-run before reading credentials, then runs two fresh intent-bound CLI identity receipts, one bounded public `state_code=100` flow read, one bounded current-owner `state_code=0` process read, one new contact root collision probe, exactly one owner-draft contact mutation, and one unique owner/state/payload readback. A transport-ambiguous mutation is never retried automatically.

```bash
pnpm case:production:contact-draft -- \
  --env-file <ignored-foundry-.env> \
  --expected-project-ref <project-ref> \
  --expected-user-id <user-id> \
  --out-dir .foundry/cases/<new-case-id>
```

The runner accepts no API key or alternate CLI path on argv. It reads only `TIANGONG_LCA_API_BASE_URL`, `TIANGONG_LCA_SUPABASE_PUBLISHABLE_KEY`, and `TIANGONG_LCA_TEST_API_KEY`; the test key exists only in the child environment. The env file must be a regular non-symlink file with POSIX mode `0600` or stricter and, when it is inside this repository, must be git-ignored. The new output directory must also be inside this repository, git-ignored, and reached without a symlinked parent.

This production lane is POSIX-only. Windows execution fails closed until the runner can verify a user-exclusive ACL; Windows CI covers that refusal rather than a live case. On POSIX, the runner snapshots the exact installed CLI 0.1.1 package inside its pnpm dependency island, hashes and rechecks the full pnpm installation plus Foundry source/build/lock facts before every child boundary, executes from a clean directory with `shell=false`, fsyncs create-only private evidence, and publishes a content-addressed case manifest only after the runtime snapshot is removed. Any detected secret in stdout, a report, or a sidecar artifact fails the case and leaves only redacted failure evidence. The created contact remains isolated, unreviewed, and unpublished under the authenticated test account for later case evidence; the lane never performs review/publish transitions or mutates foreign/public/shared rows.

Credential-scoped commands use `pnpm account:run -- <profile> -- <executable> [args...]`. The ignored profile supplies both the expected Supabase project ref and canonical user UUID. The wrapper resolves the installed CLI 0.1.1, obtains a fresh intent-bound `auth identity-receipt`, and then executes the requested argv without a shell and without inheriting unrelated parent environment variables. Authentication bypass flags are unsupported.

## Import Lanes

- `external-dataset-curated-import`: packaged LCA datasets converted through the Foundry adapter over Rust `tidas import`, with default per-process dependency bundles under `process-bundles/`, then validated by Rust tidas, QA checked, curated, cleaned, dry-run, committed, and verified through queue/checkpoint-driven scopes.
- `source-evidence-dataset-development`: PDF, Excel, web exports, images, markdown, or free text extracted through CLI/skills, authored into candidate TIDAS rows with source evidence, then sent through the same validation and curation gates.

Raw rows may preserve source-language text, but final import/write-ready rows must include English for TIDAS-required multilingual fields while preserving non-English source-language variants.

For a newer release over an existing owner-draft import, use the incremental lane instead of rebuilding or rewriting every row. `dataset-incremental-change-set-compose` strictly validates a SHA-bound old/candidate/current request plus owner-snapshot receipt, then emits only INSERT/UPDATE candidates, explicit NOOP/HOLD ledgers, dependency order, a non-empty CLI execution contract when actions exist, and exactly one terminal JSONL log event per schema-valid conversion. Entity/path/value/evidence-bound rules preserve reviewed work without opening whole rows; unstable arrays and absent dependencies hold only their closure. The command is offline and non-authoritative; fresh reconciliation and capsule admission remain separate gates. See `docs/incremental-change-set-contract.md`.

When the release changes flow identities or ordered process exchanges, use `dataset-topology-convergence-compose` after a fresh SELECT-only census. It keys exchanges by process UUID, source exchange number, and occurrence; preserves owner non-exchange content plus approved German/Chinese nodes; emits separate F flow-create and P process-save contracts; and leaves D as zero-inbound delete candidates for the CLI maintenance barrier. See `docs/topology-convergence-contract.md`.

## Core Commands

```bash
pnpm init:runtime
pnpm doctor
pnpm workflow:check
pnpm storage:check
pnpm surface:audit
pnpm acceptance:check
pnpm lint
pnpm typecheck
pnpm build
pnpm test
pnpm test:toolchain
pnpm test:unit
pnpm test:commands
pnpm test:scenarios
pnpm skills:install:shared
pnpm skills:list
pnpm workspace:map
pnpm capabilities:list -- --class tidas-contract-context
pnpm profiles:list
node scripts/foundry.mjs tidas-handshake
pnpm task:route -- --kind external-dataset-curated-import --dataset-type process --required-gates contract,schema,qa,curation
pnpm task:route -- --kind source-evidence-dataset-development --dataset-type process --required-gates context,schema,qa,curation
pnpm skills:source-evidence:use:document
pnpm skills:source-evidence:use:sci
node scripts/foundry.mjs dataset-incremental-change-set-compose --request <request.json> --out-dir <fresh-output-dir>
node scripts/foundry.mjs dataset-topology-convergence-compose --request <request.json> --out-dir <fresh-output-dir>
```

Tests are organized by behavior layer in `test/README.md`. Use `pnpm test` for the full suite and `pnpm test:unit|test:commands|test:scenarios` for targeted checks; `pnpm test:toolchain` protects the pnpm/TS7 contract. Old incident-numbered test aliases are not part of the maintained surface.

Use owner-routed execution commands for dataset work:

```bash
node scripts/foundry.mjs dataset-tidas-import \
  --input ./source-package \
  --output ./.foundry/workspaces/<task-id>/conversion

node scripts/foundry.mjs dataset-tidas-validate \
  --rows-file ./rows/processes.jsonl \
  --type process \
  --out-dir ./schema

pnpm exec tiangong-lca dataset curation-queue build \
  --processes ./rows/processes.jsonl \
  --flows ./rows/flows.jsonl \
  --support ./rows/sources.jsonl \
  --out-dir ./curation-queue

pnpm exec tiangong-lca dataset curation-queue next \
  --queue-dir ./curation-queue \
  --json

pnpm exec tiangong-lca dataset curation-queue verify \
  --queue-dir ./curation-queue \
  --type process \
  --json

node scripts/foundry.mjs dataset-curation-gate \
  --type process \
  --rows-file ./rows/processes.jsonl \
  --schema-report ./schema/report.json \
  --qa-report ./qa/process-qa-report.json \
  --schema-file ./context/process/schema.json \
  --yaml-file ./context/process/methodology.yaml \
  --ruleset-file ./context/process/runtime-ruleset.json \
  --queue-dir ./curation-queue \
  --classification-queue ./classification-authoring-queue.jsonl \
  --location-queue ./location-authoring-queue.jsonl \
  --identity-preflight-index ./identity-preflight-requests/identity-preflight-requests.jsonl \
  --profile bafu
```

Foundry does not expose dataset package-script aliases. Queue state belongs to the exact installed CLI via `pnpm exec tiangong-lca dataset curation-queue build/next/verify`; conversion, validation, QA, remote write/delete/redo, and readback verification belong to CLI-owned commands and checked-in skills. Foundry-local dataset commands are policy and artifact helpers only: curation packages, mutation manifests, commit handoff plans, closeout checks, and task completion reports.

`process-bundles/index.json` is a generic packaged-import contract, not a BAFU-only path. Bundle `manifest` and `tidas_dir` entries may be relative to the index directory; Foundry resolves them before scope projection. A batch runner may process independent bundle/entity tasks in parallel when the queue lock and dependency checks allow it. The configured parallelism belongs in the task workspace policy, and completed scopes should continue through commit and readback automatically when all hard gates pass. Missing public canonical unit groups, flow properties, or elementary flows are blocked by default; a frozen profile may instead authorize an account-local `state_code=0` candidate path that keeps private support outside the public cache and proves owner, unit-scale, closure, audit, and readback. Schema/QA blockers and unresolved reference closure always stay out of executable commit scopes. Each run that defers scopes writes both `blocked-scope-ledger.jsonl` for complete row-level blocker facts and `blocked-scope-report.json` for reason, affected-scope, dependency, human-action, and rerun summaries.

The operational entry point for the BAFU 2025 V2 full import — directory map, full command templates, blocker triage, and the current resume checklist — is `docs/bafu-import-runbook.md`.

For BAFU ready-scope resumes, `dataset-bafu-batch-import-run` supports `--pending-only` to filter already verified and active human-review scopes before `--limit`, `--selection-order estimated-weight-asc` to process lighter scopes first, `--pause-file` for graceful operator pauses, and `--stop-after-blocked <n>` to stop claiming new scopes once a blocker pattern is repeating. When starting a fresh batch directory, pass one or more `--ledger-source-dir <previous-batch-or-import-ledger-dir>` values so `--pending-only` can carry forward prior `ok.scopes.verified`, `ok.flows.verified`, active blocked scopes, and verified support identities while the new batch still writes its own independent ledgers. `--preflight-only` writes a read-only selected-scope plan without requiring `--commit` or starting remote writes. The runner also maintains `import-ledger/verified-support-identities.jsonl`; verified contact/source support closeouts are cached there so later flow/process scopes can reuse already verified support identities instead of repeating support commit and readback. Use `dataset-bafu-universe-coverage-report` with explicit `--ledger-source-dir` values to compare the full input `process-bundles/index.json` and `tidas/processes` universe against ready scopes, verified ledgers, retry ledgers, active blockers, and process-referenced product flow coverage. Retryable tool/network failures such as npm registry lookup failures are written to `failed.scopes.retry.jsonl` instead of active human-review.

Whole-library packaged imports should first deduplicate root TIDAS entities, then project the resulting decisions back to process scopes:

```bash
node scripts/foundry.mjs dataset-library-index-build \
  --source-dir <converted-library-root> \
  --process-bundles-dir <converted-library-root>/process-bundles \
  --out-dir <run-dir>/library-index

node scripts/foundry.mjs dataset-library-authoring-plan \
  --library-index <run-dir>/library-index \
  --out-dir <run-dir>/authoring-plan

node scripts/foundry.mjs dataset-library-decisions-apply \
  --library-index <run-dir>/library-index \
  --decisions-dir <run-dir>/decisions \
  --out-dir <run-dir>/library-resolution

node scripts/foundry.mjs dataset-process-scope-run \
  --process-bundles-dir <converted-library-root>/process-bundles \
  --library-resolution <run-dir>/library-resolution/library-resolution.json \
  --scope-file <run-dir>/library-resolution/scope-checkpoints.jsonl \
  --parallel 5 \
  --dry-run
```

`dataset-library-decisions-apply` writes `<run-dir>/library-resolution/blocked-scope-report.json` every time it evaluates scope closure. `dataset-process-scope-run` writes `<run-dir>/process-scope-run/blocked-scope-report.json` for runner-level deferrals such as non-ready scopes.

`annualSupplyOrProductionVolume` remains a required process field. When source data does not provide it, Foundry uses the deterministic `9999 missing-data-sentinel/year` value rather than AI trace deferral. The sentinel is intentionally non-physical and easy to bulk search so later database-side curation can replace it; that replacement is outside Foundry's import task.

For process rows whose source exchange list is truly output-only, pass the original converted source rows to cleanup with `--source-rows-file`. Foundry may then write deterministic `sourceExchangeCompleteness` proof only when the source row is output-only and the final row preserves the non-flow-reference exchange signature; otherwise AI `source_trace_verified` evidence or exchange repair is still required.

`--profile generic` is the default. Dataset-specific behavior is configured in `specs/import-profiles.json`; BAFU is one profile, not a special code path.

## Runtime Skills

`.agents/skills` is the single project-visible skill root. Foundry-local skills are tracked there by git; shared/runtime skills are also installed there when needed, but their names are managed by `.agents/shared-skills.json` and their installed directories remain ignored unless a task explicitly chooses pinned reproducibility.

Use the `skills` registry package through pnpm before a task needs shared skills:

```bash
pnpm skills:install:shared
pnpm skills:update
pnpm skills:list
```

For deleting, retiring, repairing, or redoing rows from a bad import under current-user RLS, route to the checked-in `tiangong-lca-skills` `$dataset-rls-maintenance` workflow and the CLI-owned `pnpm exec tiangong-lca dataset maintenance plan/apply/verify` surface. Do not add Foundry-local Supabase delete or redo commands.

For document fulltext extraction and SCI literature evidence, use the latest remote skills from `https://github.com/tiangong-ai/skills`:

```bash
pnpm dlx skills@latest use https://github.com/tiangong-ai/skills \
  --skill document-granular-decompose \
  --full-depth

pnpm dlx skills@latest use https://github.com/tiangong-ai/skills \
  --skill tiangong-kb-sci-search \
  --full-depth

git ls-remote https://github.com/tiangong-ai/skills.git refs/heads/main
```

Persistent local installs are optional operator state:

```bash
pnpm dlx skills@latest add https://github.com/tiangong-ai/skills \
  --skill tiangong-kb-sci-search document-granular-decompose \
  --agent '*' \
  --yes \
  --full-depth
pnpm skills:update
```

Installed shared runtime skills such as `.agents/skills/tiangong-kb-sci-search/`, `.agents/skills/document-granular-decompose/`, `.agents/skills/external-dataset-curated-import/`, and `skills-lock.json` remain ignored by default. Source-evidence tasks should record the resolved upstream ref, `pnpm dlx skills` command, and evidence artifacts under `.foundry/workspaces/<task-id>/runtime-skills/`.

## Repository Shape

- `scripts/foundry.mjs`: small Foundry command surface.
- `scripts/lib/import-curation.mjs`: generic dataset curation/cleanup implementation.
- `.agents/shared-skills.json`: configured Foundry-local and shared runtime skills that may appear under `.agents/skills`.
- `specs/automated-lca-capability-registry.json`: capability routing registry.
- `specs/import-profiles.json`: data-driven import profiles.
- `docs/foundry-task-contracts.md`: minimal task, source, seed, checkpoint, and artifact ledger contracts.
- `docs/execution-capsule-contract.md`: reusable offline stage, exact predecessor lineage, content-addressed boundary admission, CAS evidence, and immutable seal contract.
- `docs/runtime-skill-management.md`: `pnpm dlx skills` runtime dependency contract.
- `docs/import-profiles/bafu/`: BAFU profile context and constraints.
- `tasks/`: lightweight task queue and task templates.
- `.foundry/`: ignored runtime state and generated workspaces.

Remote writes are never ungated. A task must pass schema, QA, curation, cleanup, dry-run, mutation-manifest/reference-closure, commit handoff, and post-write verification gates before any database mutation. When deterministic source/contact rewrites create a writable shared contact or source dependency, Foundry may prepare a separate support finalize/handoff artifact, but dependent process/flow/lifecyclemodel scopes remain blocked until that support row is committed through the published CLI and verified. When the task write policy permits automated batch commit, ready scopes may commit without per-row human approval; human input is reserved for policy changes, exceptional waivers, and support gaps not already covered by a frozen profile's explicit account-local policy.

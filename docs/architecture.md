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
  - test/unit/zero-javascript-ratchet.test.mts
  - test/unit/source-row-explicit-any-contract.test.mts
  - test/unit/identity-rewrite-explicit-any-contract.test.mts
  - scripts/foundry-golden-diff.ts
  - scripts/check-tidas-cutover.ts
  - scripts/check-lint-suppressions.ts
  - scripts/clean-build-output.ts
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
  - scripts/lib/foundry-args.ts
  - scripts/commands/identity-decisions.ts
  - scripts/commands/classification-decisions.ts
  - scripts/commands/location-decisions.ts
  - scripts/commands/library-scope-workflow.ts
  - scripts/commands/bafu-leaf-classification-tasks.ts
  - scripts/commands/bafu-auto-authoring.ts
  - scripts/commands/bafu-process-scope-e2e.ts
  - scripts/commands/bafu-batch-import-run.ts
  - scripts/lib/foundry-command-registry.ts
  - scripts/lib/foundry-command-metadata.ts
  - scripts/lib/surface-audit.ts
  - scripts/lib/foundry-runtime-environment.ts
  - scripts/lib/foundry-runtime-paths.ts
  - scripts/lib/foundry-runtime-utils.ts
  - scripts/lib/location-quality-utils.ts
  - scripts/lib/bundle-row-types.ts
  - scripts/lib/tidas-language-utils.ts
  - scripts/lib/import-curation/internal/hash-utils.ts
  - scripts/lib/import-curation.ts
  - scripts/lib/import-curation/index.ts
  - scripts/lib/import-curation/profiles.ts
  - scripts/lib/import-curation/trace-summary.ts
  - scripts/lib/import-curation/internal/dataset-types.ts
  - scripts/lib/import-curation/internal/runtime-io.ts
  - scripts/lib/import-curation/internal/prewrite-cleanup.ts
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
  - scripts/lib/import-curation/internal/artifact-inputs.ts
  - scripts/lib/import-curation/internal/context-inputs.ts
  - scripts/lib/import-curation/internal/dataset-payload.ts
  - scripts/lib/import-curation/internal/trace-summary.ts
  - scripts/lib/canonical-support-mappings.ts
  - scripts/lib/source-semantics.ts
  - scripts/lib/trace-coverage.ts
  - scripts/lib/tidas-row-utils.ts
  - scripts/lib/decision-task-utils.ts
  - scripts/lib/identity-reference-rewrite-utils.ts
  - scripts/lib/full-context-proof.ts
  - scripts/lib/identity-preflight-artifacts.ts
  - scripts/lib/bafu-family-signatures.ts
  - scripts/lib/import-ledger.ts
  - scripts/lib/canonical-support-rewrites.ts
  - scripts/lib/bundle-sample-utils.ts
  - specs/prewrite-content-policy.json
  - test/fixtures/fixture-roots.ts
  - test/fixtures/finalize-fixtures.ts
  - test/commands/*.test.mts
  - test/fixtures/fake-tidas.ts
  - test/fixtures/foundry-core.ts
  - test/fixtures/full-context-fixtures.ts
  - test/fixtures/identity-fixtures.ts
  - test/fixtures/incremental-change-set-fixtures.ts
  - test/fixtures/mutation-fixtures.ts
  - test/fixtures/row-builders.ts
  - test/fixtures/topology-convergence-fixtures.ts
  - test/unit/unit-source-ledger-test-migration.test.mts
  - test/unit/unit-execution-library-test-migration.test.mts
  - test/unit/unit-algorithm-adapter-test-migration.test.mts
  - test/unit/unit-runtime-policy-test-migration.test.mts
  - test/scenarios/scenario-authoring-curation-test-migration.test.mts
  - test/scenarios/scenario-identity-reference-test-migration.test.mts
  - test/scenarios/scenario-mutation-finalize-test-migration.test.mts
  - test/scenarios/scenario-library-algorithm-test-migration.test.mts
  - .prettierignore
  - package.json
  - pnpm-lock.yaml
  - pnpm-workspace.yaml
  - prettier.config.ts
  - tsconfig*.json
  - scripts/with-lca-account.ts
  - test/unit/foundry-entry-closure-migration.test.mts
  - test/unit/foundry-runtime-environment.test.mts
  - test/unit/lint-suppression-audit.test.mts
  - docs/incremental-change-set-contract.md
lastReviewedAt: 2026-08-29
lastReviewedCommit: 363f06b
lastReviewedNote: "Reviewed for Issue #70: the batch public owner is a five-line facade; a separately budgeted composition root wires focused Foundry stages to CLI scheduling."
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

Foundry's non-JSX Node runtime is standardized on Node.js 24, `pnpm@11.24.0`, TypeScript `7.0.2`, Oxlint, and Prettier. pnpm is the sole dependency manager and owns the only root workspace and lockfile. The compiler graph must contain TypeScript 7.0.2 only and enforce erasable-only runtime syntax; tracked `.jsx`/`.tsx`, TypeScript 5/6 aliases, `@typescript-eslint`, and formatting plugins that load the TypeScript compiler API are not compatibility paths. Git inventory is reconciled against intentional first-party Oxlint and typecheck file lists; root lint disables nested configs, bans TypeScript suppression comments, and runs a comment-aware tracked-TypeScript native-disable audit before Oxlint. Repository-local Git environment is stripped before that audit or its fixture commands target another root, keeping hook state out of the parent index. The build removes the exact stale `dist` tree before compilation, and `noEmitOnError` prevents TypeScript diagnostics from emitting replacement JavaScript; arbitrary I/O failures are outside that guarantee. Emitted and source runtimes use one trusted-root/active-entry resolver rather than deriving repository state from an output directory or CWD.

Issue #82 moves only the package-manager compatibility edge from 11.23.0 to 11.24.0. The root workspace, byte-identical lock, resolved graph, Node 24.19.0 / TypeScript 7.0.2 single tracks, CI topology, command runtime, and remote-write ownership remain unchanged.

The historical Issue #63 baseline contained 160 tracked JavaScript artifacts: 95 runtime files, 64 tests, and one Prettier config. The migration is complete. A permanent zero-JavaScript ratchet and TS-only compiler/test/lint graph now replace the retired migration ledger. The typed spine was introduced in dependency order:

```text
entrypoint + args
  -> command registry + metadata
  -> runtime I/O + artifact/receipt contracts
  -> semantic command families
  -> scenario and real-case fixtures
```

This boundary avoids a misleading bulk rename. Each module remains in the inventory until a TypeScript replacement preserves its command, artifact, stdout, exit, and safety behavior under focused tests. Completion means no untyped business-runtime modules remain and the full case-driven suite is green.

The native TypeScript leaf set now also covers decision context, identity reference rewrite, full-context proof, and preflight artifact factories. Focused characterization preserves queue/context SHA scopes, exact reference rows/reports, fail-closed missing evidence, transform relevance, request/report artifact facts, CommandSpec argv, first-bound source indexes, positive-only execution reuse, and every static consumer. `decision-task-utils.ts` and `identity-preflight-artifacts.ts` now model their dependency injection, queue/context/proof, dataset request and source-index shapes directly; external JSON stays `unknown` until its local boundary, and an Oxlint AST contract keeps this family free of explicit `any` without moving search or execution authority.

The source-semantics, reusable TIDAS-row, and identity-reference-rewrite leaves now expose concrete local dependency and evidence shapes with `unknown` narrowed at dynamic JSON boundaries instead of explicit `any`. Worktree-local Oxlint AST contracts guard those exact production/test targets without introducing a compiler-API dependency; the change remains type-only and does not move source policy, reference decisions, filesystem errors, CLI dispatch, or remote-write authority.

After the decision, source and proof families converge, `.oxlintrc.json` promotes `typescript/no-explicit-any` to one global error and removes every family-specific override. `zero-javascript-ratchet.test.mts` validates both raw and printed rule graphs and a controlled failing fixture, so all first-party TypeScript remains covered without a TS6 compatibility compiler.

The typed BAFU family and import-ledger leaves preserve two local control-plane boundaries: deterministic family grouping/ranking over ordered signature hashes, and append-only resume evidence over verified, blocked, dependency, retry, and skipped JSONL rows. `cli-bounded-batch-runner.ts` projects those family group keys into the public CLI scheduler's exclusive-resource queue and wraps the entire run in its cross-process lock; only independent families/scopes claim in parallel. Foundry callbacks still own database-command delegation and every ledger/report byte, so command ownership, public help, profile defaults, and remote authority do not move.

The public `bafu-batch-import-run.ts` file contains only re-exports. `bafu-batch-command-runtime.ts` is a composition root, not a semantic owner: it installs the runtime/profile adapters and combines selection, semantic callbacks, CLI scheduling, and final reports. Its explicit 1,700-line ceiling makes remaining composition density visible; the ordinary semantic-stage target remains 800 lines and applies to the focused modules reached from it.

The typed canonical-support and bundle-sampling leaves own local reference rewriting and source-package materialization, not amount conversion or remote execution. Canonical scale evidence is collected before the package-local FP reference is replaced: the explicit blocking flag distinguishes a known positive non-1 factor from an unresolved missing/non-finite/non-positive factor, and projects either blocker into the report and process-scope ledger. Without that flag, existing profile behavior remains compatible.

The typed import-ledger boundary now models its JSON graph, external dependencies, report state unions, every emitted row family, manifest and write results directly. Unknown external values are narrowed at the boundary and no explicit `any` remains; the emitted append-only schema and byte/order/hash behavior are unchanged. Typed fixture roots/finalize builders remain test-only delivery infrastructure and do not enter the runtime dependency graph.

The high-fan-in runtime utility boundary is native TypeScript and owns only Foundry-local file/path/frontmatter/env-file/stage mechanics plus exact installed-package discovery. The focused runtime-path leaf resolves a trusted package root and the active source/emitted entry; the runtime-environment leaf creates allowlisted child environments with isolated local state. Runtime tests execute only local Node subprocesses and explicit temporary env files or the internal filesystem-env-disabled policy; production credentials and repository `.env` remain outside the test boundary.

The typed location-quality boundary reads the installed CLI location vocabulary and discovers only schema/fallback-declared location fields. It creates local authoring commands, queue context and blockers; the CLI owns classification lookup/apply and the schema package owns valid codes. Missing schema evidence yields an empty valid-code map rather than approving unknown values, and invalid targets remain blocking before finalize.

The typed prewrite-cleanup boundary performs deterministic transformations only after authoring evidence exists. It first plans datetime handling across the complete batch: full timezone-qualified syntax, Gregorian calendar, clock, and offset components must validate before any update is applied. A single invalid value returns ordered blockers, no cleaned rows, and zero sentinel/proof/trace/namespace/redaction counts. Only a blocker-free plan may proceed to required-field sentinel completion, UTC normalization, source/final exchange proof, import-only trace externalization, namespace repair and local locator redaction; four-digit year-boundary offset values remain byte-preserved when a UTC projection would require an extended year. Source and final exchange signatures exclude only permitted flow-reference rewrites; their array and object order remains content-addressed. It cannot invent source evidence or grant write authority.

The typed workflow-queue-context boundary reads local queue manifests, task rows, closure dependencies and optional authoring JSONL indexes without changing their encounter order or evidence bytes. It attaches that evidence to curation packages using exact-version then id-only lookup and retains native missing, malformed and invalid-dependency failures; it does not execute queue work or expand remote-write authority.

The typed internal full-context-proof boundary reads content-addressed authoring packages, decision tasks, shared context bundles and row artifacts. It verifies exact bytes, required non-empty kinds/files, task kind/status and payload identity hashes while preserving evidence encounter order and existing parse envelopes. It constructs blockers only; schema ownership, AI decisions and remote execution remain outside this module.

The typed decision-apply-context boundary projects an existing classification apply report into local evidence: normalized decisions, bound decision-task proof, resolved input/output row paths, content hashes and applied count. It preserves report order and aliases and performs no decision application, schema mutation or remote operation.

The typed profiles-config boundary reads and normalizes the repository's declarative import profiles, then projects profile lookup and listing views. It preserves configuration order, fallbacks, waiver scopes and account-local override evidence; it does not own schema rules or permit a profile to bypass downstream gates beyond its already-declared policy.

The typed workflow-patch-collect boundary validates AI patch-set structure, targets, action closure, resolution/evidence contracts and specialized trace/classification/location decisions, then exposes local artifact readers used by downstream context modules. It neither applies patches nor writes remotely; deterministic blocker order and native malformed-artifact failures remain part of admission evidence.

The typed workflow-identity-decision-context boundary reads identity apply/rewrite artifacts, normalizes their aliases, binds authoring-package and row-payload proof, indexes decisions for later gates and merges multiple reports without reordering first-seen evidence. It does not search, decide identity, rewrite rows or execute remote operations.

The typed workflow-patch-evidence-context boundary indexes deterministic patch-apply evidence, binds input/output row hashes, checks trace evidence alternatives and snapshots active safety/profile policy. It supplies proof to mutation/reference-closure gates without applying patches, performing cleanup or granting remote-write authority.

The typed workflow-row-transform-context boundary projects existing transform reports into content-bound edges and answers whether an expected rows artifact is reachable from decision outputs. It may compare exact bytes for deterministic no-op copies, but it never rewrites rows, invents an edge or grants mutation authority.

The typed dry-run context projects owner-command result files into local identity maps; the typed evidence-scope context compares every required report to the exact final rows and emits ordered blockers. Neither performs validation, curation, patching, dry-run execution, verification or remote writes.

The typed decision-full-context boundary evaluates existing classification, location, identity and deterministic transform proof without applying decisions. Authoring task, semantic action and patch evidence helpers form one existing, characterized SCC; they are compiled as a single native-TypeScript closure so no `.mjs`/`.ts` dual track can split their runtime identity. The typed identity-preflight boundary resolves local request/report artifacts, validates execution receipts and payload freshness, and projects read-only candidate evidence into curation blockers. These modules preserve hashes, encounter order and fail-closed errors; Edge/database search and CLI execution remain outside Foundry.

The typed authoring facades expose that SCC without wrapping or duplicating it. The package runner copies immutable content-addressed authoring snapshots and writes ordered local task manifests; the patch runner classifies local task outputs and writes an ordered batch only after every blocker check passes. Both are filesystem-only Foundry adapters and neither applies patches, invokes the CLI, or grants mutation authority.

The typed curation planning boundary follows those authoring layers. `curation-gate-workflow.ts` is a live-reference aggregate; `curation-gate.ts` reads local rows and evidence into ordered blockers, authoring packages and reports; `curation-cleanup.ts` deep-clones rows, runs the batch-wide strict datetime plan, and only then performs deterministic sentinel, trace, proof and redaction transforms. Its blocked report carries a null cleaned path and never deletes pre-existing bytes; retained default output becomes an explicit blocker, while explicit output remains untouched and unreferenced. Their byte/order contracts are local Foundry evidence only and do not execute or authorize a database mutation.

The typed command-owner layer now includes filesystem task/completion aggregation, commit handoff and identity task preparation, and canonical support-cache refresh/autofill. These factories keep their injected/local orchestration boundaries: task/report bytes and order remain content-stable, handoff only emits artifact-bound CommandSpecs, identity tasks only snapshot and package local evidence, and support refresh performs authenticated read-only queries. No factory implements CLI mutation, database semantics, review, or publication.

The typed mutation reference stack remains an offline planning boundary. Reference closure classifies local roots and externally proven dependencies without querying or mutating the database; source context admits only ordered, in-scope public-canonical proofs; mutation manifest aggregates exact evidence and writes JSON/JSONL partitions. If any item is blocked, no write-candidate payload is emitted for execution.

The typed dataset-orchestration layer composes those owners without absorbing them. The generic library workflow prepares deduplicated library and scope artifacts; BAFU classification, auto-authoring and process-scope owners retain dataset-specific policy; the shared batch engine adds resumable ledgers, bounded parallelism, interruption/preflight modes and explicit handoff delegation. It owns local ordering and checkpoints, not CLI mutation, profile meaning, remote state or publication.

BAFU flow identity equivalence is a narrow semantic boundary inside that layer. Candidate search remains Edge/database-owned, while `scripts/lib/bafu-authoring/identity-equivalence.ts` deterministically reviews returned candidates. Exact normalized names can rank a candidate but cannot suppress an ordered non-equivalence reason; only a zero-conflict exact candidate can be reused. Physically conflicting exact-name candidates flow through local `create_new` evidence and deterministic identity apply without changing the source flow UUID.

BAFU category-map report projection is another fail-closed leaf. `category-map-projection.ts` retains every supplied decision and manual-review artifact independent of task reachability, then derives the reader report from that complete closure. Manual rows add compact source/reason/artifact blockers, produce `completed_with_manual_review`, and force a nonzero command exit; fully resolved inputs preserve the historical report bytes/status. This is local evidence control and does not move taxonomy choice or remote authority.

The batch engine delegates its asynchronous post-write closure to `scripts/lib/batch-orchestration/post-write-handoff.ts`. That stage discovers the exact commit and verification reports, permits only the characterized same-id/version idempotent commit recovery, retries only classified read-only verification failures, delegates ordinary trace-hash normalization policy, and invokes Foundry closeout after successful readback. The command owner continues to supply process isolation, timeouts, paths, and profile context.

`scripts/lib/batch-orchestration/scope-finalize-commit.ts` composes finalize and handoff without absorbing their owners. It holds the support-commit serialization queue and verified identity set adapter, invalidates stale support reuse, reruns finalize after support or evidence recovery, and preserves the exact three-attempt post-finalize recovery ceiling before delegating the content-bound main handoff.

The typed runtime-command layer also includes CLI wrappers, offline capsule admission and post-write closeout. Wrappers delegate to the installed CLI with an executable and argv array; capsule admission writes immutable local evidence with zero dispatch; closeout aggregates already-produced commit/readback proof without issuing a remote operation. Unique-root, owner/state/payload, accepted-diff and production-test rules remain in their typed proof owners rather than moving into transport code.

The typed command-owner layer now also includes `core.ts`, `identity-preflight-run.ts`, and `post-authoring-finalize.ts`. Core owns local runtime/bootstrap and diagnostic projection. Identity preflight invokes only the published read-only CLI through receipt-bound executable/argv arrays and content-bound request evidence. Finalize orders existing rewrite, parent cleanup, nested source/contact support finalize, validation, curation, dry-run, mutation-manifest and handoff adapters; cleanup must return `completed` plus a concrete cleaned artifact before nested support or any later stage is constructed. A blocked attempt preserves every pre-existing downstream artifact, reports the stale paths as blockers, and emits only current blocker/import-ledger evidence. None of these owners implement schema/search semantics, direct database mutation, review, or publication.

The typed decision command boundary now includes `identity-decisions.ts`, `classification-decisions.ts`, and `location-decisions.ts`. Identity validation partitions local rows into write candidates, reference reuse, and unresolved evidence without executing a remote mutation. Classification and location validate task-bound decisions, preserve queue grouping and schema/path order, and delegate deterministic apply through the existing CLI argv boundary only after blockers are empty. Their reports and artifacts remain Foundry-local evidence; schema vocabularies, search, mutation, and readback authority remain with their existing owners.

The import-curation entry topology is typed end to end. `profiles.ts` and `trace-summary.ts` are identity-preserving leaf barrels; `import-curation/index.ts` aggregates the eight semantic owner exports; `import-curation.ts` is the public entry consumed by `foundry.ts`. These modules contain no runtime wrapper or initialization logic. The CLI dispatcher still receives the same injected functions, and command metadata still names the semantic owner modules rather than assigning behavior to a barrel.

The typed adapter/tooling layer keeps external ownership explicit. `tidas-adapter.ts` only selects and validates the Rust machine contract; finalize utilities coordinate existing CLI/identity stages; cutover audit reads the TypeScript-aware Git inventory; Golden comparison creates isolated worktrees and compares normalized local outputs under one identical credential-free environment. None owns converter rules, database behavior or production mutation.

The shared fixture topology is typed end to end but remains outside the production build. `foundry-core.ts` provides worktree-local filesystem and command helpers; `row-builders.ts` feeds full-context, identity and mutation evidence fixtures; incremental and topology packages remain separate algorithm fixtures. The fake tidas process is a published-report/exit harness only and is launched through Node executable-plus-argv even without an executable bit. This layer cannot acquire credentials, network access, schema ownership, or mutation authority.

The unit-test topology is now TypeScript-only. Four migration contracts retain the established behavior families and verify that governed paths no longer name `.test.mjs`; test-local types narrow fixture/report values while the production runtime dependency graph and owner module specifiers remain unchanged.

The scenario topology is also TypeScript-only. Four migration contracts retain authoring/curation, identity/reference, mutation/finalize and library/algorithm workflow evidence; the broad fixture-report vocabulary exists only to type already-produced test JSON and grants no runtime or remote authority.

Build and test resolution must be worktree-local. A clean arbitrary Git worktree must be able to run `pnpm install --frozen-lockfile`, lint, typecheck, build, toolchain tests, and the full test suite without a superproject-relative dependency, another checkout's `node_modules`, ignored `.foundry` state, or credentials.

Cross-platform characterization is also explicit: the Golden harness compares normalized outputs to a non-`HEAD` merge-base, performs recursive comparison in Node rather than calling an external Unix utility, and uses full Git history in CI. Script-backed executable overrides are represented as an executable plus argv prefix and run through Node on macOS, Linux, and Windows. The root `.gitattributes` fixes text files to LF while allowing Windows launcher exceptions, preventing checkout policy from masquerading as format drift.

The first credential-bearing entrypoint on that spine is `scripts/with-lca-account.ts`. It does not authenticate against Supabase itself. It resolves the exact installed CLI 0.1.3, requests `auth identity-receipt` with both expected project and user assertions, accepts only a fresh intent-bound forced signin, and then launches the requested executable plus argv with `shell:false` and a restricted environment. The CLI owns session and live identity behavior; Foundry owns the profile/thread intent checks and safe process boundary.

`scripts/lib/identity-preflight-proof.ts` imports the strict parser from the public `@tiangong-lca/cli/auth-identity-receipt` subpath. `test/fixtures/auth-identity-receipt.ts` is the sole test-only wire-fixture owner and produces bytes that must pass that public parser. No production module or fixture may load CLI `dist/src/**`; the installed-package contract also exercises public batch scheduling/run-lock behavior and proves the private path remains closed.

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
- generated support rows may get Foundry-prepared finalize and commit-handoff artifacts. They are contact/source by default; a frozen adapter/profile pair may add canonical-cache-miss Unit Group/Flow Property candidates through the explicitly enabled generic support path. Canonical rows remain public-cache reuse, candidates remain same-owner drafts, and dependent process/flow/lifecyclemodel scopes must wait for support commit and readback while independent ready scopes may continue
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

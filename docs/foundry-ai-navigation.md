---
title: Foundry AI Navigation
docType: guide
scope: repo
status: active
authoritative: true
owner: tiangong-lca-data-foundry
language: en
whenToUse:
  - when an AI or human maintainer needs to trace a Foundry command to implementation, artifacts, and tests
  - when deciding where new Foundry import-curation code belongs
whenToUpdate:
  - when command routing, semantic module ownership, or internal import-curation layers change
  - when adding or removing Foundry command metadata or core validation gates
checkPaths:
  - docs/foundry-ai-navigation.md
  - docs/foundry-command-surface.md
  - test/README.md
  - scripts/foundry.ts
  - scripts/lib/import-curation.ts
  - scripts/lib/import-curation/index.ts
  - scripts/lib/import-curation/profiles.ts
  - scripts/lib/import-curation/trace-summary.ts
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
  - scripts/commands/library-scope-workflow.ts
  - scripts/commands/bafu-leaf-classification-tasks.ts
  - scripts/commands/bafu-auto-authoring.ts
  - scripts/commands/bafu-process-scope-e2e.ts
  - scripts/commands/bafu-batch-import-run.ts
  - scripts/commands/worldsteel-batch-import-run.ts
  - scripts/commands/authoring-plan.ts
  - scripts/commands/bundle-sample-rows.ts
  - scripts/commands/incremental-change-set.ts
  - scripts/commands/topology-convergence.ts
  - scripts/commands/core.ts
  - scripts/commands/identity-preflight-run.ts
  - scripts/commands/post-authoring-finalize.ts
  - scripts/lib/foundry-args.ts
  - scripts/lib/foundry-cli.ts
  - scripts/lib/foundry-command-registry.ts
  - scripts/lib/foundry-command-metadata.ts
  - scripts/lib/surface-audit.ts
  - scripts/lib/foundry-runtime-environment.ts
  - scripts/lib/foundry-runtime-paths.ts
  - scripts/lib/foundry-runtime-utils.ts
  - scripts/lib/location-quality-utils.ts
  - scripts/lib/bundle-row-types.ts
  - scripts/lib/tidas-language-utils.ts
  - specs/import-profiles.json
  - docs/import-profiles/worldsteel/**
  - test/unit/worldsteel-support-mint-truth.test.mts
  - scripts/lib/import-curation/internal/hash-utils.ts
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
  - test/fixtures/fixture-roots.ts
  - test/fixtures/finalize-fixtures.ts
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
  - test/unit/source-row-explicit-any-contract.test.mts
  - test/unit/identity-rewrite-explicit-any-contract.test.mts
  - test/scenarios/scenario-authoring-curation-test-migration.test.mts
  - test/scenarios/scenario-identity-reference-test-migration.test.mts
  - test/scenarios/scenario-mutation-finalize-test-migration.test.mts
  - test/scenarios/scenario-library-algorithm-test-migration.test.mts
  - scripts/lib/import-curation/**
  - test/unit/foundry-command-metadata.test.mts
  - test/unit/foundry-entry-closure-migration.test.mts
  - test/unit/foundry-runtime-environment.test.mts
  - test/unit/lint-suppression-audit.test.mts
  - test/unit/core-command-factory.test.mts
  - test/unit/identity-preflight-run-command-factory.test.mts
  - test/unit/post-authoring-finalize-command-factory.test.mts
  - test/commands/*.test.mts
lastReviewedAt: 2026-08-26
lastReviewedCommit: 718077a8f8386528e2aba5bf81bf39035bff0230
lastReviewedNote: "Reviewed for Issue #67 independent runtime/toolchain hardening: navigation exposes trusted source/emitted entry resolution, isolated Golden environments and suppression-resistant complete TS coverage without moving semantic ownership."
---

# Foundry AI Navigation

Foundry is a thin control plane. Start from commands and artifacts, then move to the semantic owner module. Do not start from large implementation files.

## Command Path

Every command follows this route:

```text
scripts/foundry.ts
  -> scripts/lib/foundry-cli.ts
  -> command owner module
```

The checked source of truth for command ownership is `scripts/lib/foundry-command-metadata.ts`. It maps every command returned by `node scripts/foundry.ts help` to:

- category
- owner module
- owner export
- input artifacts
- output artifacts
- key tests

`test/unit/foundry-command-metadata.test.mts` enforces that the metadata covers all registered commands, that public commands remain reachable within two jumps from `scripts/foundry.ts`, and that commit handoff metadata advertises the authoritative CommandSpec and final-row artifact evidence.

The incremental lane is owned by `scripts/commands/incremental-change-set.ts`, with its authoritative artifact and activation boundary in `docs/incremental-change-set-contract.md`. It composes Foundry-owned task evidence and stops before the CLI-owned mutation boundary. The related typed algorithm owners are `authoring-plan.ts` for row/task planning, `bundle-sample-rows.ts` for deterministic representative sampling, and `topology-convergence.ts` for occurrence-aware F/P/D convergence; each remains behind the same registered command and write-authority contract.

## TypeScript Migration Navigation

The Issue #63 migration is complete; do not navigate behavior by extension alone. `test/unit/zero-javascript-ratchet.test.mts` prevents tracked JavaScript from returning, while semantic ownership still follows the typed dependency spine:

```text
entrypoint + argument contract
  -> command registry + command metadata
  -> runtime I/O + hashing + artifact/receipt contracts
  -> semantic command owners
  -> command and scenario fixtures
```

Change downward in that order, starting each slice with a failing characterization or realistic case. Preserve help, stdout, exit, stage, artifact, and safety contracts directly in TypeScript; compatibility wrappers and parallel JavaScript owners are forbidden.

The first characterized CLI-spine leaves are `scripts/lib/foundry-args.ts` and `scripts/lib/foundry-command-registry.ts`. Navigate to the former for positional, kebab-to-camel, repeated-option, inline-value, flag, and scalar coercion behavior. Navigate to the latter for the exact public/dataset command order, help JSON ownership note, and exit-code mapping. `test/unit/foundry-cli-spine.test.mts` pins those behaviors and verifies every static consumer imports the native TypeScript modules.

The typed navigation/governance leaves are `scripts/lib/foundry-command-metadata.ts` and `scripts/lib/surface-audit.ts`. The metadata module owns the exact command-to-owner/export/input/output/key-test map. The audit module owns hidden-handler, category, orphan-doc, declared-entrypoint, and script-only inbound checks; it recognizes explicit and dynamic TS imports, emits portable POSIX report paths on every OS, and deliberately excludes test-only imports from runtime reachability evidence. Their focused unit tests also reject active references to removed migration paths.

The typed low-level data leaves are `scripts/lib/bundle-row-types.ts`, `scripts/lib/tidas-language-utils.ts`, `scripts/lib/import-curation/internal/hash-utils.ts`, and `scripts/lib/import-curation/internal/dataset-types.ts`. Navigate there for exact TIDAS root/information/table mappings, language enumeration and CJK fallback, raw `JSON.stringify`/text SHA-256 behavior, or dataset-type aliases/plural/support constants. These are serialization and vocabulary contracts: callers must not silently canonicalize object key order, reorder arrays, widen language tags, or accept unsupported types during migration.

The high-fan-in typed I/O leaf is `scripts/lib/import-curation/internal/runtime-io.ts`. It owns generic coercion, JSON/JSONL/text reading and synchronous writing, filesystem probes, repository/artifact path normalization, row-envelope loading, option lists, unique values, and safe filename fragments. Its current writer contract is direct synchronous overwrite rather than transactional rename: JSONL closes its descriptor on success and error, while a serialization failure after earlier rows leaves the completed prefix visible. Do not change those semantics implicitly during consumer migrations.

The typed contracts immediately above runtime I/O are `artifact-inputs.ts`, `dataset-payload.ts`, `trace-summary.ts`, and `context-inputs.ts`. They own QA/artifact file fallback and dedupe, TIDAS payload/root/type/id/version extraction, ordered `common:other` trace aggregation and compact hashing, and exact installed-CLI schema/methodology/classification/location context resolution. Missing files, duplicate resolved paths, context-byte drift, invalid JSON, trace serialization errors, and fallback identities remain explicit evidence rather than silently repaired input.

The typed standalone policy/row leaves are `canonical-support-mappings.ts`, `source-semantics.ts`, `trace-coverage.ts`, and `tidas-row-utils.ts`. Navigate there for exact canonical FP/UG scales and pending support, profile-aware source kind/fallback/reference decisions, final-row-to-trace-queue coverage keys and blocker envelopes, or reusable root/id/version/multilingual row transforms. These factories retain existing BAFU/USLCI/worldsteel defaults and must not silently normalize units, sources, trace evidence, or row payloads during migration.

The typed evidence/decision leaves are `decision-task-utils.ts`, `identity-reference-rewrite-utils.ts`, `full-context-proof.ts`, and `identity-preflight-artifacts.ts`. They own stable decision selection/context bundles, exact identity reference reuse or unresolved traces, profile-required completion lineage, and content-bound preflight requests/CommandSpecs/source-index attachments. Missing, stale, ambiguous, cross-context, or non-positive evidence remains blocking; display strings and unbound cache candidates never become execution authority.

For the hardened source/row/reference boundary, navigate through `source-row-explicit-any-contract.test.mts` and `identity-rewrite-explicit-any-contract.test.mts`. They run the installed Oxlint TypeScript AST rule over the exact source and directly coupled fixture list, while the existing behavior suites remain authoritative for profile defaults, paths, bytes, encounter order, hashes, native errors, unresolved traces, and fail-closed authority.

The focused contracts are local diagnostics only. The permanent repository boundary is the single global `typescript/no-explicit-any` error in `.oxlintrc.json`, verified by `zero-javascript-ratchet.test.mts`; no TypeScript path or override is exempt.

The typed family/ledger leaves are `bafu-family-signatures.ts` and `import-ledger.ts`. Navigate to the former for location-aware family-name normalization, ordered skeleton/flow-template/amount-vector hashes, scope-order master selection, compact planning fields, and missing-signature summaries. Navigate to the latter for append-only verified/blocked/dependency/retry JSONL, row identity and payload hashes, human-action text, dedupe keys, manifest paths, and read-only resume/skipped reports. Preserve insertion order, exact JSON bytes, and native parse/filesystem failures during caller migrations.

The typed canonical/materialization leaves are `canonical-support-rewrites.ts` and `bundle-sample-utils.ts`. Navigate to the former for normalized source-unit lookup, canonical FP/UG proof, stale-version and account-local precedence, exact rewrite/blocker/scaling artifacts, or deferred rows. Navigate to the latter for source traces and field repair, classification/elementary queues, profile-safe library contacts, bundle selection, and identity-key dedupe. Bundle sampling must pass the same scaling accumulator and block flag into canonical rewrites before the original source-unit reference is lost; known non-1 and unresolved invalid scales have distinct blocker codes.

`import-ledger.ts` exports the typed ledger vocabulary as well as its factory. Navigate there for recursive JSON values, dependency injection, closeout/finalize discriminators, verified/blocked/dependency/retry/resume rows, manifests, write results, and read-only report results. `import-ledger-type-contract.test.mts` compiles positive and negative usage outside the main tsconfig; behavioral tests remain authoritative for bytes and ordering. Test-only shared paths/default report builders live in `test/fixtures/fixture-roots.ts` and `finalize-fixtures.ts`.

The typed runtime leaf is `foundry-runtime-utils.ts`. Navigate there for the pinned installed CLI manifest/bin/schema contract, `TIANGONG_LCA_CLI_BIN` precedence and command rendering, generic text/JSON/JSONL/path/count/search helpers, task frontmatter and scalar fields, explicit env-file loading, list/option/hash/UUID helpers, stage blocker aggregation and CLI JSON subprocess envelopes. `foundry-runtime-utils-contract.test.mts` covers all returned helpers without invoking `loadRuntimeEnv()`; `wave10-runtime-migration.test.mts` pins the zero-any source and every static consumer.

Two focused leaves sit beside that factory. Navigate to `foundry-runtime-paths.ts` when source and emitted commands need the trusted repository root or their active `.ts`/`.js` entry; its closure test runs both forms from an unrelated CWD and pins nested batch/finalize/process argv. Navigate to `foundry-runtime-environment.ts` for credential-free subprocess isolation; Golden uses it to give baseline and current sides byte-identical allowlisted environments while dropping ambient credentials, `NODE_OPTIONS`, user config, and filesystem `.env` loading. Toolchain suppression policy is owned by `check-lint-suppressions.ts`, which uses Oxlint's comment parser to reject native disable directives without confusing strings or regex literals.

The typed location leaf is `location-quality-utils.ts`. Navigate there for classification and location authoring command strings, installed location-code map loading, schema/fallback location target keys, recursive target paths and `location_code_requires_authoring` evidence. It returns four helpers through `foundry.ts`; command/scenario tests cover their bundle, location-decision, curation and finalize consumers while `location-quality-utils-contract.test.mts` pins exact order and envelopes.

The typed deterministic prewrite leaf is `import-curation/internal/prewrite-cleanup.ts`. Navigate there for UTC metadata normalization, annual-supply missing-data sentinel completion, source-row identity indexing, output-only exchange completeness proof, `tidasimport:sourceTrace` hash externalization, Foundry trace namespace repair and local locator redaction. Its proof hashes intentionally preserve exchange array and object insertion order while excluding only `referenceToFlowDataSet`.

The typed queue leaf is `import-curation/internal/workflow-queue-context.ts`. Navigate there for annual-supply schema actions, curation manifest loading, task/artifact path resolution, exact-version and id-only task selection, closure dependency/support attachment, authoring JSONL identity indexes and identity-preflight request paths. Its tests pin encounter order, duplicate-map behavior, portable paths and native fail-closed errors across all static consumers.

The typed internal proof leaf is `import-curation/internal/full-context-proof.ts` (distinct from the reusable `scripts/lib/full-context-proof.ts` factory). Navigate there for curation context aliases, package/task/shared-bundle byte and SHA proof, non-empty required context blockers, classification/location file-pattern selection and per-identity payload hashes. Its consumers are the decision, identity, patch-evidence, reference-closure and row-transform context modules.

The typed decision apply leaf is `import-curation/internal/workflow-decision-apply-context.ts`. Navigate there for classification apply report aliases, normalized decision rows, decision-task proof binding, input/output row path lists, fallback dataset type selection, identity payload hashes and applied counts. Curation and mutation workflow facets re-export it; decision full-context logic consumes it directly.

The typed profile leaf is `import-curation/internal/profiles-config.ts`. Navigate there for profile field alias precedence, full-context policy normalization, account-local override projection, config-file fallback, requested/default/generic lookup, operator-added docs/QA waivers and ordered profile listing. The public profiles facade plus curation and mutation facets consume it; profile defaults remain declarative in `specs/import-profiles.json`.

Worldsteel's frozen adapter/profile policy is a governed cross-file contract. Start with `scripts/commands/worldsteel-batch-import-run.ts` for the executable batch-engine flags, then follow the `worldsteel.docs` list in `specs/import-profiles.json` for current policy, constraints, plan, and retained delivery evidence. `test/unit/worldsteel-support-mint-truth.test.mts` executes the factory, compares its unmatched FP/UG support value with the structured profile value, and requires every declared Worldsteel document to state the same truth. The hard candidate boundary is a materialized canonical-cache miss behind the profile and finalize gates; LANCA names and historical counts are evidence, not a runtime allowlist.

The typed patch collect leaf is `import-curation/internal/workflow-patch-collect.ts`. Navigate there for patch-set admission blockers, action-item closure, resolution/context/evidence validation, JSON/JSONL and optional artifact readers, identity-apply report option aliases, default source-rewrite discovery and normalized source-rewrite evidence. Its nine workflow consumers span authoring, curation, mutation, dry-run, identity, evidence, reference closure and row transforms.

The typed identity decision leaf is `import-curation/internal/workflow-identity-decision-context.ts`. Navigate there for identity-reference rewrite discovery/scoping, decision field and canonical-reference aliases, decision identity keys, apply artifact loading, authoring-package/payload proof, multi-report merge, completed-action/decision predicates and unresolved flow reference keys. It feeds curation, mutation, preflight, patch evidence and decision full-context gates.

The typed patch evidence leaf is `import-curation/internal/workflow-patch-evidence-context.ts`. Navigate there for compact patch evidence, identity/row lookup, patch-apply report and payload hashes, closure codes, deterministic annual/source cleanup proof, unresolved/source trace blockers, policy snapshots and import-only trace detection. Mutation and reference-closure facets consume it.

The typed row lineage leaf is `import-curation/internal/workflow-row-transform-context.ts`. Navigate there for unresolved-exchange, canonical-support, source/contact and cleanup report contexts; deterministic transform-entry aggregation; exact/content-equivalent rows; multi-pass reachability; and direct patch, identity, classification and externalization chain predicates. Curation, mutation, evidence-scope, preflight, decision and reference-closure facets consume it.

The typed dry-run leaf is `import-curation/internal/workflow-dry-run-context.ts`; navigate there for schema/curation identity maps, dry-run operation names, flow/process/lifecycle/save-draft artifacts and remote blocker keys. The typed exact-scope leaf is `import-curation/internal/workflow-evidence-scope.ts`; navigate there for report-row aliases and ordered schema/curation/QA/cleanup/patch/collect/dry-run/remote scope blockers.

The typed decision proof leaf is `import-curation/internal/workflow-decision-full-context.ts`; navigate there for classification/location/identity requirement relevance, package/task proof, deterministic row-chain acceptance and ordered blockers. Patch authoring is one characterized SCC: `workflow-authoring-tasks.ts` owns task/package/shared-context construction and patch evidence helpers, `workflow-semantic-actions.ts` owns semantic/content actions and patch templates, and `workflow-patch-evidence.ts` owns trace/classification/location validation. Migrate or reshape those three only as a closed cycle and keep every edge typed. `workflow-identity-preflight.ts` sits above that SCC; navigate there for result path aliases, execution-receipt validation, exact-version lookup, payload freshness and deterministic allowances, source-context requirements, AI identity actions, prewrite policy blockers, and classification/location queue decisions.

The typed authoring entry layer is split by responsibility. `internal/authoring-task-workflow.ts` and `internal/authoring-patch-workflow.ts` are pure live-reference facades. `authoring-packages.ts` owns gate-entry selection, content-addressed snapshot copies, task directories and manifest/JSONL materialization. `patch-collect.ts` owns task-output admission, invalid-JSON/blocker classification, ordered patch-set aggregation and the blocker-free batch write. Navigate to the underlying workflow modules for validation rules; do not add duplicate logic to the facades or runners.

The typed curation planner is split the same way. `internal/curation-gate-workflow.ts` is a pure live-reference aggregate; `curation-gate.ts` owns ordered local evidence aggregation and authoring-package/report materialization; `curation-cleanup.ts` owns deterministic deep-cloned prewrite rows, sentinel/trace/proof/redaction counts and JSONL/report bytes. Navigate to the typed internal owners for individual rules rather than duplicating them in either runner.

The typed command factories are `scripts/commands/tasks.ts`, `import-completion.ts`, `commit-handoff.ts`, `identity-decision-task.ts`, and `support-cache.ts`. Navigate to them for filesystem task state, closeout aggregation, artifact-bound commit/verify CommandSpecs, content-addressed identity decision tasks, or canonical public-support read/autofill behavior respectively. They preserve the existing command registry and metadata names and must not absorb remote execution semantics.

The typed mutation reference stack starts at `workflow-reference-closure.ts` for reference/table/partition algebra, then `workflow-source-reference-context.ts` for ordered source proof admission, then the pure `mutation-manifest-workflow.ts` aggregate and `mutation-manifest.ts` artifact runner. Navigate downward for individual proof rules; the runner only partitions and reports exact evidence and never executes a write.

The typed high-level orchestration path is `library-scope-workflow.ts` for profile-agnostic library/scope preparation, then `bafu-leaf-classification-tasks.ts` and `bafu-auto-authoring.ts`, then `bafu-process-scope-e2e.ts`, with `bafu-batch-import-run.ts` owning resume, selection, interruption, bounded parallelism and explicit handoff delegation. USLCI and Worldsteel adapters import that same batch owner with frozen profile configuration. Start at command metadata and the Wave 26 migration tests, then navigate to the narrower command owner for blocker and artifact semantics.

The typed runtime command owners are `scripts/commands/cli-wrappers.ts`, `execution-capsule.ts`, and `post-write-closeout.ts`. Navigate to the wrapper for direct executable/argv delegation and process diagnostics, to the capsule for offline immutable admission and attempt-state evidence, and to closeout for already-produced commit/readback aggregation. Root uniqueness and accepted-difference decisions remain in `post-write-root-proof.ts` and `remote-verification-accepted-diff.ts`.

The typed final command owners are `scripts/commands/core.ts`, `identity-preflight-run.ts`, and `post-authoring-finalize.ts`. Navigate to core for local bootstrap, environment/workflow/storage/surface diagnostics and route artifacts; to identity preflight for receipt-bound CLI argv, request/target/binding hashes, positive-only cache and stdout/disk execution evidence; and to finalize for ordered rewrite, cleanup, validation, curation, dry-run, mutation-manifest and handoff aggregation. Finalize utilities live at `post-authoring-finalize-utils.ts`.

The typed import-curation entry chain is `scripts/lib/import-curation.ts` → `import-curation/index.ts` → semantic owners. `profiles.ts` and `trace-summary.ts` are pure typed leaf barrels. Navigate through the public/index barrels to discover the complete namespace, but edit behavior only in the semantic owner named by command metadata.

The typed adapter/tooling owners are `tidas-adapter.ts` for the external Rust machine contract, `post-authoring-finalize-utils.ts` for finalize-stage path/reuse/preflight coordination, `check-tidas-cutover.ts` for authoritative cutover inventory, and `foundry-golden-diff.ts` for isolated non-HEAD normalized comparison. Tests use controlled executables and local Git/filesystem fixtures only.

The typed fixture chain starts at `test/fixtures/foundry-core.ts` and `row-builders.ts`, then branches into full-context/identity/mutation evidence and independent incremental/topology packages. Navigate to `fake-tidas.ts` only for the stable Rust operation-report/exit harness; dispatch it as `process.execPath` plus script argv. Fixture modules preserve runtime export namespaces and artifact bytes but are never semantic command owners.

All unit suites use `.test.mts`. Navigate through the four `unit-*-test-migration.test.mts` contracts for the source/ledger/support, execution/finalize/library, adapter/algorithm, and runtime/content-policy partitions; navigate from each behavior test to its existing semantic owner without treating test-side type narrowing as a new runtime abstraction.

All scenario suites use `.test.mts`. Navigate through the four `scenario-*-test-migration.test.mts` contracts for authoring/curation, identity/reference, mutation/finalize and library/algorithm partitions. Their shared report types describe captured test artifacts only; semantic ownership stays in command metadata and runtime owners.

The supported toolchain is Node.js 24, `pnpm@11.23.0`, TypeScript `7.0.2` only with erasable syntax, root-config Oxlint plus the native-suppression audit, and Prettier. Before merging a migration slice, verify it in a clean arbitrary Git worktree with frozen pnpm install, clean/type-error-no-emit build proof, and no dependency on sibling checkouts, external `node_modules`, credentials, or ignored `.foundry` state.

The typed handoff primitive is `scripts/lib/foundry-command-spec.ts`. Navigate there for exact-key parsing, canonical command hashing, critical-flag uniqueness, final-row artifact facts, or pre-spawn drift checks. Callers must never reconstruct argv from `display`.

## Import-Curation Modules

Use these semantic modules as the import-curation navigation surface:

| Module | Responsibility |
| --- | --- |
| `scripts/lib/import-curation/profiles.ts` | import profile listing and profile lookup |
| `scripts/lib/import-curation/curation-gate.ts` | curation gate report and AI authoring package creation |
| `scripts/lib/import-curation/authoring-packages.ts` | AI authoring task manifest/package preparation |
| `scripts/lib/import-curation/patch-collect.ts` | AI patch collection and patch evidence readiness |
| `scripts/lib/import-curation/curation-cleanup.ts` | deterministic prewrite row cleanup |
| `scripts/lib/import-curation/trace-summary.ts` | Foundry trace summarization |
| `scripts/lib/import-curation/mutation-manifest.ts` | prewrite mutation manifest and blocker aggregation |

Command runners live in the semantic modules above. The remaining reusable workflow logic is exposed through focused internal workflow facets such as `authoring-task-workflow.ts`, `authoring-patch-workflow.ts`, `curation-gate-workflow.ts`, and `mutation-manifest-workflow.ts`. New command behavior should start in the semantic owner module, with reusable helpers placed in focused internal modules.

Complex workflow commands should also publish an AI-readable `stage_pipeline` contract in their help/report payload. The shared helper is `scripts/lib/stage-contract.ts`; it standardizes `remote_write_mode`, `stage_pipeline[].stage`, canonical `phase`, `purpose`, `inputs`, `outputs`, `blockers`, `artifacts`, `side_effects`, and a stable `report_contract` requiring `status`, `counts`, `files`, `blockers`, and read-only `remote_write_mode`. Complex commands should expose the canonical phases `prepare`, `rewrite_cleanup`, `gate_validate`, and `report`. `test/unit/foundry-stage-contract.test.mts` currently enforces this contract for:

- `dataset-bundle-sample-rows`
- `dataset-post-authoring-finalize`
- `dataset-authoring-plan`
- `dataset-identity-preflight-run`
- `dataset-incremental-change-set-compose`

## Internal Layers

The current internal dependency direction is:

```text
semantic import-curation modules
  -> internal/*-workflow.ts
  -> internal/workflow-*.ts
     -> characterized authoring SCC: authoring-tasks.ts <-> semantic-actions.ts <-> patch-evidence.ts
  -> internal/full-context-proof.ts
  -> internal/profiles-config.ts
  -> internal/trace-summary.ts
  -> internal/dataset-payload.ts
  -> internal/dataset-types.ts
  -> internal/runtime-io.ts
```

Layer rules:

- `runtime-io.ts`: generic time, array, text, JSON/JSONL, filesystem, and path helpers.
- `dataset-types.ts`: supported dataset type sets, plural names, and fallback profile constants.
- `dataset-payload.ts`: TIDAS row payload unwrap, dataset root/type detection, dataset identity, and identity map keys.
- `profiles-config.ts`: import profile loading, normalization, listing, and lookup.
- `trace-summary.ts`: Foundry trace entry collection and compact trace summaries.
- `prewrite-cleanup.ts`: deterministic write-preparation transforms such as annual-supply sentinel completion, import trace externalization, Foundry trace namespace repair, local locator redaction, and timestamp normalization.
- `full-context-proof.ts`: full-context package/task proof loading and blocker construction.
- `authoring-task-workflow.ts`: typed facade for AI authoring package to task manifest/template preparation helpers.
- `authoring-patch-workflow.ts`: typed facade for AI patch collection, patch-set validation, and full-context readiness helpers.
- `curation-gate-workflow.ts`: typed aggregate for curation gate queue, identity-preflight, QA/schema action, and authoring context helpers.
- `mutation-manifest-workflow.ts`: typed aggregate for prewrite evidence, reference closure, dry-run proof, and write-candidate planning helpers.
- `workflow-queue-context.ts`, `workflow-identity-preflight.ts`, `workflow-identity-decision-context.ts`, `workflow-semantic-actions.ts`, `workflow-authoring-tasks.ts`, `workflow-patch-evidence.ts`, `workflow-patch-evidence-context.ts`, `workflow-patch-collect.ts`, `workflow-row-transform-context.ts`, `workflow-evidence-scope.ts`, `workflow-decision-apply-context.ts`, `workflow-decision-full-context.ts`, `workflow-dry-run-context.ts`, `workflow-source-reference-context.ts`, and `workflow-reference-closure.ts`: focused domain helpers used by the workflow facets above.

Dependencies should point downward only outside the explicitly characterized authoring SCC above. Do not add another cycle edge or split that SCC across JavaScript and TypeScript. Internal low-level modules must not import semantic command modules.

## Cleanup Checks

Before deleting a Foundry-local surface, prove the current replacement path and check command metadata, tests, docs, and docpact coverage. Safe deletions include old package-script aliases, empty metadata categories, and draft orchestration docs with no remaining consumer. Do not delete runtime skills, task templates, profile docs, or account-safety docs only because they are low-frequency; those may be agent entrypoints rather than code imports. Run `node scripts/foundry.ts surface-audit` to automate the local scan for hidden command aliases, empty metadata categories, unregistered orphan docs, and script modules without inbound imports.

## Behavior Freeze

The test tree is split by behavior layer:

- `test/unit/` protects pure metadata and local helper contracts.
- `test/commands/` protects single-command artifacts, reports, and stage contracts.
- `test/scenarios/` protects multi-command workflow behavior.
- `test/fixtures/` contains focused helper modules for core command runners, fixture roots, row builders, identity/finalize/full-context/mutation workflow fixtures, and similar shared setup.

Before and after structural changes, run:

```bash
pnpm golden:diff
pnpm test
pnpm test:toolchain
pnpm lint
pnpm typecheck
pnpm build
node scripts/foundry.ts doctor
git diff --check
```

Golden diff protects CLI JSON compatibility for the key command set. The full test suite protects workflow-specific artifact and proof behavior. Toolchain tests protect the pnpm/TS7 graph and migration ledger. Command metadata tests protect AI navigation.

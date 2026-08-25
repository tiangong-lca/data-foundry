---
title: Foundry Test Layout
docType: contract
scope: repo
status: active
authoritative: true
owner: tiangong-lca-data-foundry
language: en
whenToUse:
  - when adding, moving, or reviewing Foundry tests
  - when deciding whether a test belongs in unit, commands, scenarios, or fixtures
whenToUpdate:
  - when test directory ownership, naming, scripts, or harness rules change
checkPaths:
  - test/README.md
  - package.json
  - pnpm-lock.yaml
  - pnpm-workspace.yaml
  - tsconfig*.json
  - .oxlintrc.json
  - .prettierignore
  - prettier.config.cjs
  - specs/typescript-migration-inventory.json
  - scripts/commands/tasks.ts
  - scripts/commands/import-completion.ts
  - scripts/commands/commit-handoff.ts
  - scripts/commands/identity-decision-task.ts
  - scripts/commands/support-cache.ts
  - scripts/commands/cli-wrappers.ts
  - scripts/commands/execution-capsule.ts
  - scripts/commands/post-write-closeout.ts
  - scripts/lib/foundry-args.ts
  - scripts/commands/identity-decisions.ts
  - scripts/commands/classification-decisions.ts
  - scripts/commands/location-decisions.ts
  - scripts/lib/foundry-command-registry.ts
  - scripts/lib/foundry-command-metadata.ts
  - scripts/lib/surface-audit.ts
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
  - test/fixtures/fixture-roots.ts
  - test/fixtures/finalize-fixtures.ts
  - test/unit/bafu-family-signatures-contract.test.mts
  - test/unit/import-ledger-contract.test.mts
  - test/unit/wave8-large-leaf-migration.test.mts
  - test/unit/canonical-support-rewrites-contract.test.mts
  - test/unit/bundle-sample-utils-contract.test.mts
  - test/unit/wave9-canonical-bundle-migration.test.mts
  - test/unit/import-ledger-type-contract.test.mts
  - test/unit/fixture-helpers-contract.test.mts
  - test/unit/foundry-runtime-utils-contract.test.mts
  - test/unit/wave10-runtime-migration.test.mts
  - test/unit/location-quality-utils-contract.test.mts
  - test/unit/wave11-location-migration.test.mts
  - test/unit/prewrite-cleanup-contract.test.mts
  - test/unit/wave12-prewrite-migration.test.mts
  - test/unit/workflow-queue-context-contract.test.mts
  - test/unit/workflow-queue-context-native-errors.test.mts
  - test/unit/wave13-queue-context-migration.test.mts
  - test/unit/full-context-proof-contract.test.mts
  - test/unit/wave14-full-context-proof-migration.test.mts
  - test/unit/workflow-decision-apply-context-contract.test.mts
  - test/unit/wave15-decision-apply-context-migration.test.mts
  - test/unit/profiles-config-contract.test.mts
  - test/unit/wave16-profiles-config-migration.test.mts
  - test/unit/workflow-patch-collect-contract.test.mts
  - test/unit/wave17-patch-collect-migration.test.mts
  - test/unit/workflow-identity-decision-context-contract.test.mts
  - test/unit/wave18-identity-decision-context-migration.test.mts
  - test/unit/workflow-patch-evidence-context-contract.test.mts
  - test/unit/wave19-patch-evidence-context-migration.test.mts
  - test/unit/workflow-row-transform-context-contract.test.mts
  - test/unit/wave20-row-transform-context-migration.test.mts
  - test/unit/workflow-dry-run-context-contract.test.mts
  - test/unit/wave21-dry-run-context-migration.test.mts
  - test/unit/workflow-evidence-scope-contract.test.mts
  - test/unit/wave21-evidence-scope-migration.test.mts
  - test/unit/workflow-decision-full-context-contract.test.mts
  - test/unit/wave22-decision-full-context-migration.test.mts
  - test/unit/workflow-authoring-scc-contract.test.mts
  - test/unit/wave22-authoring-scc-migration.test.mts
  - test/unit/workflow-identity-preflight-contract.test.mts
  - test/unit/wave22-identity-preflight-migration.test.mts
  - test/unit/authoring-workflow-facades-contract.test.mts
  - test/unit/wave23-authoring-facades-migration.test.mts
  - test/unit/authoring-packages-runner-contract.test.mts
  - test/unit/wave23-authoring-packages-migration.test.mts
  - test/unit/patch-collect-runner-contract.test.mts
  - test/unit/wave23-patch-collect-runner-migration.test.mts
  - test/unit/curation-gate-workflow-facade-contract.test.mts
  - test/unit/wave24-curation-gate-workflow-migration.test.mts
  - test/unit/curation-gate-runner-contract.test.mts
  - test/unit/wave24-curation-gate-runner-migration.test.mts
  - test/unit/curation-cleanup-runner-contract.test.mts
  - test/unit/wave24-curation-cleanup-runner-migration.test.mts
  - test/unit/cli-wrapper-command-factory.test.mts
  - test/unit/execution-capsule-command-factory.test.mts
  - test/unit/post-write-closeout-command-factory.test.mts
  - test/unit/import-curation-leaf-barrels-migration.test.mts
  - test/unit/import-curation-entry-barrels-migration.test.mts
  - test/unit/task-completion-command-factories.test.mts
  - test/unit/handoff-identity-task-command-factories.test.mts
  - test/unit/support-cache-command-factory.test.mts
  - test/unit/workflow-reference-closure-contract.test.mts
  - test/unit/wave25-reference-closure-migration.test.mts
  - test/unit/workflow-source-reference-context-contract.test.mts
  - test/unit/wave25-source-reference-context-migration.test.mts
  - test/unit/mutation-manifest-workflow-facade-contract.test.mts
  - test/unit/mutation-manifest-runner-contract.test.mts
  - test/unit/wave25-mutation-manifest-migration.test.mts
  - test/unit/wave25-identity-decision-command-migration.test.mts
  - test/unit/wave25-classification-location-command-migration.test.mts
  - test/commands/classification-decisions.test.mjs
  - test/commands/location-decisions.test.mjs
  - test/scenarios/flow-identity-decisions.test.mjs
  - test/unit/foundry-cli-spine.test.mts
  - AGENTS.md
  - docs/foundry-ai-navigation.md
  - docs/foundry-command-surface.md
lastReviewedAt: 2026-08-25
lastReviewedCommit: b033e4897b069d0d3a3ab2f3559ff644a9aa0008
lastReviewedNote: "Reviewed for Issue #67 Wave 25 integration: tests cover reference/mutation fail-close, runtime process/capsule/closeout proof, decision help/queues/stages/artifacts, and native-only import-curation leaf/index/public entries with exact namespaces, live owner identity, consumers/metadata, Node 24 source/emitted loading, and native errors."
---

# Test Layout

Foundry tests are organized by responsibility, not by the date a regression was added.

## Directories

- `unit/`: pure logic and metadata tests. These tests should avoid shelling out to Foundry commands unless the subject is command metadata or command contracts.
- `commands/`: command-level contract tests. These may run `node scripts/foundry.mjs ...` and assert stable artifacts, reports, blockers, and exit behavior for one command family.
- `scenarios/`: multi-command workflow tests. These cover realistic evidence chains such as full-context gates, post-authoring finalize, mutation manifests, and packaged-library process scopes.
- `fixtures/`: shared row builders, report builders, command runners, file helpers, and process-boundary fakes split by behavior surface. Keep common command/file helpers in `foundry-core.mjs`, roots in `fixture-roots.ts`, row payload builders in `row-builders.mjs`, workflow-specific builders in `identity-fixtures.mjs`, `finalize-fixtures.ts`, `full-context-fixtures.mjs`, or `mutation-fixtures.mjs`, and the machine-contract-only Rust tidas process fake in `fake-tidas.mjs`. The fake may model published reports/exits/cancellation but must not reimplement schema or converter logic.

## Naming

Test files should name the behavior surface they cover, for example `post-authoring-finalize-gates.test.mjs` or `mutation-manifest-reference-closure.test.mjs`. Do not add numbered files such as `full-context-gate-07.test.mjs`.

## TDD And TypeScript Migration

Every behavior or migration slice starts with a failing focused test or a realistic case characterization. Preserve command help, stdout, exit, artifacts, receipts, stage contracts, and fail-closed safety before moving implementation across the TypeScript boundary.

`../specs/typescript-migration-inventory.json` records the Issue #63 baseline of 160 tracked JavaScript artifacts. `unit/toolchain-contract.test.mts` enforces pnpm-only locking, Node.js 24, TypeScript `7.0.2` as the sole compiler graph, Oxlint, forbidden legacy bridges, and inventory accounting. Update the inventory in the same change that migrates a module; a wrapper or extension-only rename is not enough.

`unit/foundry-cli-spine.test.mts` characterizes the typed argument parser and command registry: scalar/argv parsing, exact command/help JSON order, exit-code families, and every static consumer import. Keep that focused contract green before relying on broader command or Golden gates.

`unit/foundry-command-metadata.test.mts` and `unit/surface-audit-typescript.test.mts` characterize the typed metadata/audit leaves: every registered command's exact owner/export/artifact/key-test schema, TS import discovery, portable paths, test-only inbound exclusion, orphan/profile docs, declared entrypoints, hidden handlers, and report JSON. The spine guard rejects active docs or source that retain removed module names; immutable inventory history is outside that scan.

`unit/bundle-dataset-types.test.mts`, `unit/hash-utils.test.mts`, and `unit/tidas-language-utils.test.mjs` characterize the low-level data leaves: exact root/information/table mappings and order, dataset aliases/plurals/support sets and root detection, the complete language-code enumeration and fallback rules, exact SHA-256 serialization, object insertion/array order, and stable invalid-input failures.

`unit/runtime-io.test.mts` characterizes every shared I/O export: coercion/list/name helpers, parent creation, exact text/JSON/JSONL bytes, direct overwrite and partial-prefix behavior, close-on-error, immediate rename/read visibility, parse/filesystem errors, missing probes, row envelopes, and separator-neutral repository/artifact paths.

`unit/artifact-inputs.test.mts`, `unit/dataset-payload.test.mts`, `unit/trace-summary.test.mts`, and `unit/context-inputs.test.mts` characterize the next internal contracts: artifact IDs/path fallback/QA dedupe, payload/root/id/version precedence, trace DFS paths/group order/hash/error behavior, and installed schema plus schema/methodology/classification/location context resolution with missing, duplicate, and drift evidence.

`unit/canonical-support-mappings.test.mts`, `unit/source-semantics-contract.test.mts`, `unit/trace-coverage.test.mts`, and `unit/tidas-row-utils.test.mts` characterize standalone leaves: mapping completeness/scales/pending support, source kinds/profile fallbacks/canonical rewrites, trace count/missing/stale/duplicate/evidence blockers, and TIDAS root/id/version/multilingual/cleanup/JSONL helpers with invalid inputs.

`unit/evidence-decision-leaves.test.mts` characterizes decision selection/context SHA/dedupe, missing-index fail-close and exact identity reuse rows, required full-context missing-manifest blockers, preflight request bytes/CommandSpec artifact facts, queue attachment, and source-index first binding/missing context. Existing identity scenarios retain positive-only cache and end-to-end lineage coverage.

`unit/bafu-family-signatures-contract.test.mts` and `unit/import-ledger-contract.test.mts` characterize the Wave 8 leaves independently: exact normalized family and ordered exchange hashes, scope-order grouping/rank/summary/missing envelopes, then append-only verified/blocked/dependency/retry bytes, root-based row identity, payload hashes, human actions, duplicate suppression, latest-row resume ordering, artifact paths, and native errors. `unit/wave8-large-leaf-migration.test.mts` pins both native `.ts` files, their consumers, and named exports.

`unit/canonical-support-rewrites-contract.test.mts` and `unit/bundle-sample-utils-contract.test.mts` characterize Wave 9 independently: normalized cache lookup, traversal/rewrite order, known/unresolved scale contracts, pending/proof/override/stale/defer behavior, exact artifacts/errors, then trace DFS/sanitization, process evidence repair, classification/elementary queues, canonical contact reference proof, profile fallbacks, seeded selection, and identity-key conflicts. `commands/bundle-sample-rows.test.mjs` proves real materialization keeps scaling facts in the report and scope ledger before the source-unit FP is replaced; `unit/wave9-canonical-bundle-migration.test.mts` pins native files, consumers, and exports.

`unit/import-ledger-type-contract.test.mts` runs an isolated TS7 compile fixture for the public ledger type surface and rejects explicit `any`; the existing ledger behavior tests still pin exact schemas, JSONL bytes, hashes, ordering, paths, dedupe, and errors. `unit/fixture-helpers-contract.test.mts` pins all shared root names against the worktree-local test run id plus ready-finalize mutation/report bytes, defaults, overrides, native `.ts` paths, and consumers.

`unit/foundry-runtime-utils-contract.test.mts` characterizes pinned installed-CLI discovery and override rendering, the exact 49-helper factory surface, synchronous file/JSON/JSONL bytes and errors, row counts/search/path portability, scalar/frontmatter/options/hash/UUID behavior, explicit temporary env-file precedence, stage/blocker/artifact envelopes, and local Node subprocess JSON. It intentionally does not call `loadRuntimeEnv()` or read `.env`. `unit/wave10-runtime-migration.test.mts` requires the zero-any native `.ts` module, exact exports, toolchain reference and all static imports.

`unit/location-quality-utils-contract.test.mts` characterizes classification/location command plans, installed and missing schema maps, fallback/schema location keys, nested `#text` paths, depth-first/ascending-array order, exact counters, queue context, blocker order and invalid row-type errors. `unit/wave11-location-migration.test.mts` pins the zero-any factory, named export and static consumers; bundle/location/finalize command scenarios retain integration coverage.

`unit/prewrite-cleanup-contract.test.mts` characterizes UTC rollover/offset bytes, recursive array/object normalization, annual sentinel variants, source-row map precedence, output-only exchange proof and order-sensitive hashes, duplicate proof suppression, trace summary/hash/error behavior, namespace repair and exact local-locator SHA redaction. `unit/wave12-prewrite-migration.test.mts` pins the zero-any native module, ten exports and all six internal consumers.

`unit/workflow-queue-context-contract.test.mts` characterizes annual-supply actions, queue manifest filtering/order/map behavior, task paths and summaries, exact-version then id-only selection, closure dependency/support order, authoring JSONL filtering/last-row binding and identity-preflight paths. `unit/workflow-queue-context-native-errors.test.mts` locks the legacy non-null-object task traversal and native `TypeError` for a null dependency; `unit/wave13-queue-context-migration.test.mts` pins the zero-any native module, exact runtime exports and all static consumers.

`unit/full-context-proof-contract.test.mts` characterizes context alias/pattern detection, UTF-8 text presence, exact package/task bytes and hashes, embedded/shared context order, manifest and apply-report aliases, required-context blocker order, classification/location schema-pattern selection, decision-row envelope precedence, payload identity encounter order/last-write behavior, caught proof parse envelopes and native row parse errors. `unit/wave14-full-context-proof-migration.test.mts` pins the zero-any native module, twenty runtime exports and all six static consumers.

`unit/workflow-decision-apply-context-contract.test.mts` characterizes null/empty reports, snake/camel decision and task aliases, decision/task/path encounter order, flow-before-process fallback inference, decision-task proof binding, input/output identity payload hashes, duplicate last-write behavior, count coercion and native JSON/path errors. `unit/wave15-decision-apply-context-migration.test.mts` pins the zero-any native module, sole runtime export and all three static consumers.

`unit/profiles-config-contract.test.mts` characterizes camel/snake precedence, scalar profile envelopes, full-context normalization, raw account-local overrides, exact config/fallback identity, requested/default/generic selection, docs and waiver addition order, conditional dataset-type errors, profile key/list order and native JSON/argument failures. `unit/wave16-profiles-config-migration.test.mts` pins the zero-any native module, four runtime exports and all five pre-existing static consumers.

`unit/workflow-patch-collect-contract.test.mts` characterizes early invalid returns, valid action closure, top-level and operation blocker order, annual-supply defer rejection, full-context structured evidence, native circular/path errors, JSONL delimiters and row envelopes, artifact option aliases/order/duplicates, source-rewrite candidate priority and normalized evidence. `unit/wave17-patch-collect-migration.test.mts` pins the zero-any native module, nine runtime exports and all nine pre-existing workflow consumers.

`unit/workflow-identity-decision-context-contract.test.mts` characterizes rewrite-file candidate priority, normalized rewrite evidence, scoped exact/bare indexes, decision/canonical/package aliases and values, file/embedded fallback, package-proof dedupe, payload hash last-write, path encounter order, multi-context merge/dedupe, completed-action predicates, unresolved flow reference keys and native JSON/path failures. `unit/wave18-identity-decision-context-migration.test.mts` pins the zero-any native module, nineteen runtime exports and all five pre-existing workflow consumers.

`unit/workflow-patch-evidence-context-contract.test.mts` characterizes compact evidence aliases, identity/row indexes, exact-bare-row query/dedupe order, apply report blockers, output path and payload hash order, closure codes, exact deterministic cleanup proof, unresolved/source trace alternatives, policy snapshot SHA/order, recursive import-only trace detection and native parse/path/cycle failures. `unit/wave19-patch-evidence-context-migration.test.mts` pins the zero-any native module, ten runtime exports and both pre-existing workflow consumers.

`unit/workflow-row-transform-context-contract.test.mts` characterizes unresolved/canonical/generic report aliases, trace/count/blocker/proof order, payload hashes, transform cross-products and fixed aggregation order, status gates, exact/content-equivalent rows, unordered/cyclic graph reachability, cleanup/decision aliases and every direct patch/identity/classification/externalization chain helper. `unit/wave20-row-transform-context-migration.test.mts` pins the zero-any native module, thirty-one runtime exports and all seven workflow plus scenario consumers.

`unit/workflow-dry-run-context-contract.test.mts` pins exact-last/bare-first maps, operation normalization, flow aliases, three progress/failure readers, overwrite order and planned-root blocker suppression. `unit/workflow-evidence-scope-contract.test.mts` pins portable blocker envelopes, row aliases, all-missing/valid/mismatch stage order, deterministic rewrite-chain acceptance, QA parse envelopes and native path errors. Their Wave 21 migration tests pin native zero-any sources and every consumer.

Wave 22 uses three RED/GREEN families that match the runtime topology. `unit/workflow-decision-full-context-contract.test.mts` pins proof relevance, hash/lineage requirements and blocker order. `unit/workflow-authoring-scc-contract.test.mts` pins patch/action/trace aliases, recursive order, shared-context behavior and the exact three-module export surface; its migration test requires every cycle edge to close over `.ts`. `unit/workflow-identity-preflight-contract.test.mts` pins result paths, missing-receipt fail-close, target hash freshness, exact-version lookup, source context, candidate order, queue aliases, blocker order and native JSON errors. Their Wave 22 migration tests reject old-path consumers and type escapes.

Wave 23 covers the authoring entry layer. `unit/authoring-workflow-facades-contract.test.mts` pins exact namespaces and reference equality to the typed SCC owners. `unit/authoring-packages-runner-contract.test.mts` uses a real gate manifest to pin entry/task order, snapshot filename SHA, source bytes, task directories and exact manifest/JSONL bytes. `unit/patch-collect-runner-contract.test.mts` pins task-order blocker and invalid-JSON classes, patch-file/set/operation order, exact ready batch bytes, blocker-free writes and native malformed-manifest errors. The paired migration tests pin `.ts` ownership, static consumers and type-escape guards.

Wave 24 B3 covers curation planning without entering command-family semantics. `unit/curation-gate-workflow-facade-contract.test.mts` pins the exact live aggregate closure; `unit/curation-gate-runner-contract.test.mts` uses a realistic blocked two-process fixture to pin entity, schema/QA blocker, context, authoring-package, alias and report/JSONL byte order plus native JSON failure; `unit/curation-cleanup-runner-contract.test.mts` pins input preservation, deep-cloned row order, annual sentinel, trace externalization, output-only exchange proof, locator redaction, timestamps, counts, exact bytes and native JSON failure. The paired migration tests require native zero-escape TypeScript and every consumer update.

Wave 24 covers five command factories in three RED/GREEN families. `unit/task-completion-command-factories.test.mts` pins queue/file order, duplicate diagnostics, task move bytes, closeout aggregation/dedupe and exact JSON. `unit/handoff-identity-task-command-factories.test.mts` pins final-row artifact SHA/bytes, authoritative CommandSpec argv, no-command blockers, identity snapshot names/bytes and action dedupe order. `unit/support-cache-command-factory.test.mts` uses local HTTP stubs to pin auth/read/paging order, cache summaries, mapping/manual-block order and native failures without reading credentials or production.

Wave 25 covers the reference stack in three dependency-ordered RED/GREEN families. `unit/workflow-reference-closure-contract.test.mts` pins exact exports, DFS/table mapping, Foundry-trace exclusion, planned-self/public-remote/proven/unresolved/foreign closure partitions, write/reuse candidates and decision/operation order. `unit/workflow-source-reference-context-contract.test.mts` pins explicit/default source file precedence, scope/index order, public-canonical filtering and support proof order. `unit/mutation-manifest-workflow-facade-contract.test.mts` pins every live owner reference; `unit/mutation-manifest-runner-contract.test.mts` pins realistic write/reference/blocked partitions, remote proof, report/items and partition JSONL bytes/hashes, native JSON failure, and empty write output whenever the manifest is blocked. Migration tests require atomic native zero-escape TypeScript and every consumer update.

Wave 25 covers three runtime command owners. `unit/cli-wrapper-command-factory.test.mts` executes a real local Node child to pin executable prefixes, argv, CWD/environment, stdout/stderr, nonzero exits and native spawn errors without shell strings. `unit/execution-capsule-command-factory.test.mts` and the existing command fixture pin offline help, attempt/no-replay states, immutable snapshots, predecessor receipts, semantic/raw hashes, reviewer/boundary checks and seals. `unit/post-write-closeout-command-factory.test.mts` routes to realistic unique-root, byte-drift, canonical-hash, accepted-diff and production-mode fixtures.

Wave 25 covers the three decision command factories. `unit/wave25-identity-decision-command-migration.test.mts` and `unit/wave25-classification-location-command-migration.test.mts` pin native-only sources, exact export identity, zero explicit type escapes or suppressions, every dispatcher/metadata consumer, and exact serialized help reports. The realistic command/scenario fixtures continue to pin option aliases/defaults, queue and row path order, task-context and unclosed-item blockers, CLI argv/stage short-circuiting, identity output partitioning, report/JSONL writes, and native malformed-artifact failures.

Wave 25 covers two re-export families. `unit/import-curation-leaf-barrels-migration.test.mts` pins the exact profile/trace namespaces and direct owner references. `unit/import-curation-entry-barrels-migration.test.mts` pins the complete eight-export index/public namespace, every owner reference, Foundry CLI injection keys, metadata owner routes, TS-only atomic entry migration, and a clean temporary TypeScript build loaded by Node 24. No fixture reads credentials, `.env`, production state, or ignored Foundry artifacts.

Toolchain and migration contracts must pass in a clean arbitrary Git worktree after `pnpm install --frozen-lockfile`. Tests must not borrow another worktree's `node_modules`, depend on the workspace superproject, read credentials, or use ignored `.foundry` artifacts as fixtures.

## Commands

- `pnpm test`: run the full suite.
- `pnpm test:toolchain`: verify the pnpm/TS7 graph and migration inventory.
- `pnpm test:unit`: run pure logic and metadata tests.
- `pnpm test:commands`: run command contract tests.
- `pnpm test:scenarios`: run workflow scenario tests.
- `node --test test/unit/tidas-adapter.test.mjs`: verify 0.2.x handshake, invocation precedence, stable report/exit mapping, validation-batch compatibility, cancellation, cleanup, and rollback at the Foundry boundary.

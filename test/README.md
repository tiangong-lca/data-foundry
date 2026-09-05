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
  - prettier.config.ts
  - test/unit/lint-suppression-audit.test.mts
  - test/unit/zero-javascript-ratchet.test.mts
  - test/unit/foundry-package-contract.test.mts
  - test/scenarios/foundry-package-consumer.test.mts
  - test/unit/worldsteel-support-mint-truth.test.mts
  - scripts/foundry-golden-diff.ts
  - scripts/check-tidas-cutover.ts
  - scripts/check-lint-suppressions.ts
  - scripts/clean-build-output.ts
  - scripts/build-foundry-package.ts
  - scripts/verify-foundry-package.ts
  - scripts/lib/foundry-package-contract.ts
  - docs/package-distribution-contract.md
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
  - test/fixtures/fake-tidas.ts
  - test/fixtures/foundry-core.ts
  - test/fixtures/full-context-fixtures.ts
  - test/fixtures/identity-fixtures.ts
  - test/fixtures/incremental-change-set-fixtures.ts
  - test/fixtures/mutation-fixtures.ts
  - test/fixtures/row-builders.ts
  - test/fixtures/topology-convergence-fixtures.ts
  - test/unit/bafu-family-signatures-contract.test.mts
  - test/unit/import-ledger-contract.test.mts
  - test/unit/wave8-large-leaf-migration.test.mts
  - test/unit/canonical-support-rewrites-contract.test.mts
  - test/unit/bundle-sample-utils-contract.test.mts
  - test/unit/wave9-canonical-bundle-migration.test.mts
  - test/unit/import-ledger-type-contract.test.mts
  - test/unit/source-row-explicit-any-contract.test.mts
  - test/unit/identity-rewrite-explicit-any-contract.test.mts
  - test/unit/fixture-helpers-contract.test.mts
  - test/unit/fixture-executable-core-migration.test.mts
  - test/unit/row-builders-fixture-migration.test.mts
  - test/unit/context-identity-mutation-fixture-migration.test.mts
  - test/unit/incremental-fixture-migration.test.mts
  - test/unit/topology-fixture-migration.test.mts
  - test/unit/bafu-family-signatures.test.mts
  - test/unit/canonical-source-review-report-rewrite.test.mts
  - test/unit/content-policy-profile-waiver.test.mts
  - test/unit/execution-capsule-attempt-state.test.mts
  - test/unit/finalize-resolution-reuse-seed.test.mts
  - test/unit/foundry-stage-contract.test.mts
  - test/unit/import-ledger-utils.test.mts
  - test/unit/incremental-change-set.test.mts
  - test/unit/library-contact-reuse.test.mts
  - test/unit/runtime-skill-config.test.mts
  - test/unit/source-semantics.test.mts
  - test/unit/support-closure-proof-keys.test.mts
  - test/unit/tidas-adapter.test.mts
  - test/unit/tidas-cutover-audit.test.mts
  - test/unit/tidas-language-utils.test.mts
  - test/unit/topology-convergence.test.mts
  - test/unit/workflow-semantic-actions.test.mts
  - test/unit/unit-source-ledger-test-migration.test.mts
  - test/unit/unit-execution-library-test-migration.test.mts
  - test/unit/unit-algorithm-adapter-test-migration.test.mts
  - test/unit/unit-runtime-policy-test-migration.test.mts
  - test/scenarios/authoring-shared-context.test.mts
  - test/scenarios/bafu-mydata-override.test.mts
  - test/scenarios/content-saturation-gates.test.mts
  - test/scenarios/curation-cleanup-quality-gates.test.mts
  - test/scenarios/decision-task-context-and-classification.test.mts
  - test/scenarios/flow-classification-authoring.test.mts
  - test/scenarios/flow-identity-decisions.test.mts
  - test/scenarios/flow-reference-reuse-and-traces.test.mts
  - test/scenarios/full-context-completion-closeout.test.mts
  - test/scenarios/identity-curation-context.test.mts
  - test/scenarios/identity-preflight-run-and-merge.test.mts
  - test/scenarios/incremental-change-set-handoff.test.mts
  - test/scenarios/library-scope-workflow.test.mts
  - test/scenarios/location-and-finalize-gates.test.mts
  - test/scenarios/mutation-full-context-evidence.test.mts
  - test/scenarios/mutation-lineage-helpers.test.mts
  - test/scenarios/mutation-manifest-reference-closure.test.mts
  - test/scenarios/post-authoring-finalize-gates.test.mts
  - test/scenarios/topology-convergence-handoff.test.mts
  - test/scenarios/scenario-authoring-curation-test-migration.test.mts
  - test/scenarios/scenario-identity-reference-test-migration.test.mts
  - test/scenarios/scenario-mutation-finalize-test-migration.test.mts
  - test/scenarios/scenario-library-algorithm-test-migration.test.mts
  - test/unit/foundry-entry-closure-migration.test.mts
  - test/unit/foundry-runtime-environment.test.mts
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
  - test/unit/core-command-factory.test.mts
  - test/unit/identity-preflight-run-command-factory.test.mts
  - test/unit/post-authoring-finalize-command-factory.test.mts
  - test/unit/command-tests-core-support-migration.test.mts
  - test/unit/command-tests-authoring-decisions-migration.test.mts
  - test/unit/command-tests-bafu-library-migration.test.mts
  - test/unit/command-tests-offline-planners-migration.test.mts
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
  - test/unit/wave26-library-scope-command-migration.test.mts
  - test/unit/wave26-bafu-leaf-classification-command-migration.test.mts
  - test/unit/wave26-bafu-auto-authoring-command-migration.test.mts
  - test/unit/wave26-bafu-process-scope-command-migration.test.mts
  - test/unit/wave26-bafu-batch-command-migration.test.mts
  - test/commands/classification-decisions.test.mts
  - test/commands/location-decisions.test.mts
  - test/scenarios/flow-identity-decisions.test.mts
  - test/unit/tidas-adapter-migration-contract.test.mts
  - test/unit/post-authoring-finalize-utils-contract.test.mts
  - test/unit/tidas-cutover-script-contract.test.mts
  - test/unit/foundry-golden-diff-contract.test.mts
  - test/unit/authoring-plan-command-migration.test.mts
  - test/unit/bundle-sample-command-migration.test.mts
  - test/unit/incremental-command-migration.test.mts
  - test/unit/topology-command-migration.test.mts
  - test/unit/foundry-cli-spine.test.mts
  - AGENTS.md
  - docs/foundry-ai-navigation.md
  - docs/foundry-command-surface.md
lastReviewedAt: 2026-09-05
lastReviewedCommit: 8cbbddb1a727ff2858918d0ff6d2efb1c8827390
lastReviewedNote: "Reviewed for #106 W06: package metadata/descriptor, deterministic build/pack and two clean installed consumers are covered across the four-platform gate."
---

# Test Layout

The v2 task store persists registered job/source/profile identity, account intent, producer receipts and artifact lineage; deterministic local retries reuse verified results. Exact C1/TIDAS qualification, all-command disposition, derived authorization and child admission form the W04 authority boundary. W05 covers the hierarchical facade. W06 adds the descriptor-bound source-free candidate and installed-consumer suite; W08 still owns F1 publication/components. See `docs/public-runtime-contract.md`, `docs/runtime-context-contract.md`, `docs/package-distribution-contract.md`, `docs/task-authorization-contract.md` and `docs/foundry-task-contracts.md`.

The explicit workspace runtime is defined by `docs/runtime-context-contract.md`: package layout comes from `package.json.foundryRuntime`, emitted execution needs no source TypeScript or Git, and selected inputs/task outputs are bound to an immutable runtime context. `scripts/runtime-entry.ts` now implements workspace init/migration, consumer doctor and task start/status/resume as the separate hierarchical facade. All 63 flat owner commands retain explicit public/internal/excluded, path, child, qualification and authorization dispositions; the facade reaches them only through registered task state and never falls back to the developer runner.

W03 task authorization is covered by `unit/task-authorization.test.mts` (immutable grants, exact binding, expiry, actions and evidence), `unit/task-profile-authority.test.mts` (no inherited legacy permission and scoped Worldsteel naming), and the mixed-support handoff case in `unit/handoff-identity-task-command-factories.test.mts` (actual row types, input-byte drift and account mismatch). `fixtures/task-authorizations.ts` is explicit test-only approval data; tests must opt in and never derive permission from a profile flag. Local candidate/closure regressions remain in the existing command/scenario suites. Real CLI identity plus the frozen private Flow case is exercised outside public CI, without business writes or committed private payloads.

W04 authority tests are split by contract. `unit/foundry-runtime-qualification.test.mts` compares the real installed CLI descriptor and an isolated TIDAS process, including drift and diagnostic rejection. `unit/foundry-runtime-command-policy.test.mts` proves every command is classified exactly once and preparation does not inherit restricted permission. `unit/foundry-runtime-authority-schemas.test.mts` compiles the four machine schemas strictly. `scenarios/foundry-execution-admission.test.mts` reconstructs a child context from a deterministic derived artifact and rejects serialized proofs, unrelated or mislabeled CLI commands, wrong actions/QA, capsule relocation and changed final bytes. Private real-case qualification repeats the same boundary with actual published C1/TIDAS artifacts; public CI keeps only synthetic identity and data fixtures.

W05 facade coverage is split similarly. `unit/foundry-operation-result.test.mts` fixes the exact envelope, statuses, permissions and exit table. `unit/foundry-task-start-spec.test.mts` fixes task intent, selected seed and fingerprint rules. `unit/foundry-facade-schemas.test.mts` compiles all four public/request/migration schemas. `scenarios/foundry-facade-request-store.test.mts` covers concurrent idempotence, changed bytes/path revisions, predecessor preservation, deterministic cleanup reuse, fake completion rejection and attempted-state readback-only behavior. `scenarios/foundry-public-facade.test.mts` exercises one-line CLI JSON, option rejection, account-reference readiness, actor/missing-task errors, migration no-write and exit 130. The entry-closure suite runs workspace init through both source and emitted entries.

W06 package coverage has two layers. `unit/foundry-package-contract.test.mts` freezes identity, exports, allowlist, no-lifecycle metadata, compiler settings and descriptor tamper rejection; the facade schema suite compiles the package descriptor schema strictly. `scenarios/foundry-package-consumer.test.mts` rebuilds and packs twice byte-identically, installs the same tarball into an online then offline clean consumer, compiles a typed consumer, verifies exact C1, runs all six operations from a Unicode CWD against a read-only package, rejects internal commands and tests missing/changed/extra/linked/lifecycle-bearing/Intel-invalid closures. It uses only public synthetic inputs; the official OAuth installed-package case remains private W14 evidence.

`unit/package-manager-command.test.mts` covers Windows native pnpm selection, complete npm/Node installation pairing, literal Unicode/space/metacharacter argv, missing-tool rejection, POSIX lookup and the actual package-verifier dry-run call. The consumer scenario also executes the repository verifier and pack driver, including reuse of an identical archive, on every supported CI platform. Package tools share the repository-only resolver and always spawn without a shell.

Foundry tests are organized by responsibility, not by the date a regression was added.

## Directories

- `unit/`: pure logic and metadata tests. These tests should avoid shelling out to Foundry commands unless the subject is command metadata or command contracts.
- `commands/`: command-level contract tests. These may run `node scripts/foundry.ts ...` and assert stable artifacts, reports, blockers, and exit behavior for one command family.
- `scenarios/`: multi-command workflow tests. These cover realistic evidence chains such as full-context gates, post-authoring finalize, mutation manifests, and packaged-library process scopes.
- `fixtures/`: shared row builders, report builders, command runners, file helpers, and process-boundary fakes split by behavior surface. Keep common command/file helpers in `foundry-core.ts`, roots in `fixture-roots.ts`, row payload builders in `row-builders.ts`, workflow-specific builders in `identity-fixtures.ts`, `finalize-fixtures.ts`, `full-context-fixtures.ts`, or `mutation-fixtures.ts`, and the machine-contract-only Rust tidas process fake in `fake-tidas.ts`. The fake may model published reports/exits/cancellation but must not reimplement schema or converter logic.

## Naming

Test files should name the behavior surface they cover, for example `post-authoring-finalize-gates.test.mts` or `mutation-manifest-reference-closure.test.mts`. Do not add numbered files such as `full-context-gate-07.test.mts`.

## OAuth and private qualification

`unit/oauth-identity-contract.test.mts` preserves the real RC01 failure shape with synthetic identities: persisted OAuth sessions pass fresh live identity admission, while wrong project/user, stale/future/tampered receipts and non-OAuth sessions fail. Account wrapper tests protect session references and exact child dispatch. Historical attempt/resume fixtures keep their original CLI fingerprints and hashes. Golden compares isolated baseline and Git-visible candidate snapshots; the only #97 metadata normalization is the two SHA-bound public env-surface reports for the deliberate 42-to-44-variable OAuth migration.

## TDD And TypeScript Migration

Every behavior or migration slice starts with a failing focused test or a realistic case characterization. Preserve command help, stdout, exit, artifacts, receipts, stage contracts, and fail-closed safety before moving implementation across the TypeScript boundary.

The Issue #63 migration is complete. `unit/zero-javascript-ratchet.test.mts` permanently enforces zero tracked first-party JavaScript, rejects `.jsx`/`.tsx` in this non-JSX Node control plane, and requires native TypeScript configuration plus TS-only compiler/test/lint globs. `unit/toolchain-contract.test.mts` enforces pnpm-only locking, Node.js 24, TypeScript `7.0.2` as the sole compiler graph, Oxlint, and forbidden compatibility bridges.

`unit/foundry-cli-spine.test.mts` characterizes the typed argument parser and command registry: scalar/argv parsing, exact command/help JSON order, exit-code families, and every static consumer import. Keep that focused contract green before relying on broader command or Golden gates.

`unit/foundry-command-metadata.test.mts` and `unit/surface-audit-typescript.test.mts` characterize the typed metadata/audit leaves: every registered command's exact owner/export/artifact/key-test schema, TS import discovery, portable paths, test-only inbound exclusion, orphan/profile docs, declared entrypoints, hidden handlers, and report JSON. The spine guard rejects active docs or source that retain removed module names; immutable inventory history is outside that scan.

`unit/worldsteel-support-mint-truth.test.mts` executes the frozen Worldsteel adapter factory, binds its unmatched FP/UG support flag to the structured profile authorization, and checks every profile-declared Worldsteel document. Keep the runtime, profile scope, canonical-cache-miss boundary, retained delivery evidence, and blocked-dependent/continue-independent batch semantics aligned.

`unit/bundle-dataset-types.test.mts`, `unit/hash-utils.test.mts`, and `unit/tidas-language-utils.test.mts` characterize the low-level data leaves: exact root/information/table mappings and order, dataset aliases/plurals/support sets and root detection, the complete language-code enumeration and fallback rules, exact SHA-256 serialization, object insertion/array order, and stable invalid-input failures.

`unit/runtime-io.test.mts` characterizes every shared I/O export: coercion/list/name helpers, parent creation, exact text/JSON/JSONL bytes, direct overwrite and partial-prefix behavior, close-on-error, immediate rename/read visibility, parse/filesystem errors, missing probes, row envelopes, and separator-neutral repository/artifact paths.

`unit/artifact-inputs.test.mts`, `unit/dataset-payload.test.mts`, `unit/trace-summary.test.mts`, and `unit/context-inputs.test.mts` characterize the next internal contracts: artifact IDs/path fallback/QA dedupe, payload/root/id/version precedence, trace DFS paths/group order/hash/error behavior, and installed schema plus schema/methodology/classification/location context resolution with missing, duplicate, and drift evidence.

`unit/canonical-support-mappings.test.mts`, `unit/source-semantics-contract.test.mts`, `unit/trace-coverage.test.mts`, and `unit/tidas-row-utils.test.mts` characterize standalone leaves: mapping completeness/scales/pending support, source kinds/profile fallbacks/canonical rewrites, trace count/missing/stale/duplicate/evidence blockers, and TIDAS root/id/version/multilingual/cleanup/JSONL helpers with invalid inputs.

`unit/evidence-decision-leaves.test.mts` uses Oxlint's TypeScript AST rule to reject explicit `any` and suppressions across itself, `decision-task-utils.ts`, and `identity-preflight-artifacts.ts`. Its behavior cases characterize decision selection/context SHA/dedupe, missing-index fail-close and exact identity reuse rows, required full-context missing-manifest blockers, preflight request bytes/CommandSpec artifact facts, queue attachment, and source-index first binding/missing context. Existing identity scenarios retain positive-only cache and end-to-end lineage coverage.

`unit/source-row-explicit-any-contract.test.mts` and `unit/identity-rewrite-explicit-any-contract.test.mts` invoke the installed Oxlint TypeScript AST rule through Node over the exact source/direct-fixture targets. They reject explicit `any` without a compiler-API dependency; the existing standalone/evidence unit tests and realistic command/scenario cases continue to pin exact source/profile/reference rows, bytes, order, hashes, native errors, and remote-write fail-close behavior.

`unit/lint-suppression-audit.test.mts` proves the tracked-TypeScript audit catches native line, next-line, and block disable directives while ignoring identical raw tokens in strings, templates, regexes, and non-directive prose comments. It also simulates inherited pre-push `GIT_DIR`/`GIT_WORK_TREE` and proves audit/fixture commands remain bound to the temporary repository rather than the parent index. `unit/zero-javascript-ratchet.test.mts` additionally requires `typescript/no-explicit-any` and `typescript/ban-ts-comment` as global Oxlint errors, rejects nested config and TS-comment suppression bypasses, reconciles every Git-visible `.ts`/`.mts`/`.cts` path with intentional Oxlint and `tsc` inventories, and checks the printed rule graph. `unit/toolchain-contract.test.mts` pins package wiring, `erasableSyntaxOnly`, guarded stale-`dist` cleanup, retired `.mjs`/map removal, and no emit on a controlled TypeScript diagnostic; it deliberately does not claim arbitrary I/O failure atomicity. These are permanent whole-repository boundaries; focused family contracts remain diagnostic TDD evidence.

`unit/bafu-family-signatures-contract.test.mts` and `unit/import-ledger-contract.test.mts` characterize the Wave 8 leaves independently: exact normalized family and ordered exchange hashes, scope-order grouping/rank/summary/missing envelopes, then append-only verified/blocked/dependency/retry bytes, root-based row identity, payload hashes, human actions, duplicate suppression, latest-row resume ordering, artifact paths, and native errors. `unit/wave8-large-leaf-migration.test.mts` pins both native `.ts` files, their consumers, and named exports.

`unit/canonical-support-rewrites-contract.test.mts` and `unit/bundle-sample-utils-contract.test.mts` characterize Wave 9 independently: normalized cache lookup, traversal/rewrite order, known/unresolved scale contracts, pending/proof/override/stale/defer behavior, exact artifacts/errors, then trace DFS/sanitization, process evidence repair, classification/elementary queues, canonical contact reference proof, profile fallbacks, seeded selection, and identity-key conflicts. `commands/bundle-sample-rows.test.mts` proves real materialization keeps scaling facts in the report and scope ledger before the source-unit FP is replaced; `unit/wave9-canonical-bundle-migration.test.mts` pins native files, consumers, and exports.

`unit/import-ledger-type-contract.test.mts` runs an isolated TS7 compile fixture for the public ledger type surface and rejects explicit `any`; the existing ledger behavior tests still pin exact schemas, JSONL bytes, hashes, ordering, paths, dedupe, and errors. `unit/fixture-helpers-contract.test.mts` pins all shared root names against the worktree-local test run id plus ready-finalize mutation/report bytes, defaults, overrides, native `.ts` paths, and consumers.

`unit/foundry-runtime-utils-contract.test.mts` characterizes pinned installed-CLI discovery and override rendering, the exact 49-helper factory surface, synchronous file/JSON/JSONL bytes and errors, row counts/search/path portability, scalar/frontmatter/options/hash/UUID behavior, explicit temporary env-file precedence, stage/blocker/artifact envelopes, and local Node subprocess JSON. Its filesystem-env-disabled case uses only a temporary root. `unit/foundry-runtime-environment.test.mts` pins the credential-free allowlist and protected overrides; `unit/foundry-entry-closure-migration.test.mts` pins source/emitted root, profile and nested-entry parity from an unrelated CWD. None reads repository `.env`; `unit/wave10-runtime-migration.test.mts` retains the exact runtime-utils export contract.

`unit/location-quality-utils-contract.test.mts` characterizes classification/location command plans, installed and missing schema maps, fallback/schema location keys, nested `#text` paths, depth-first/ascending-array order, exact counters, queue context, blocker order and invalid row-type errors. `unit/wave11-location-migration.test.mts` pins the zero-any factory, named export and static consumers; bundle/location/finalize command scenarios retain integration coverage.

`unit/prewrite-cleanup-contract.test.mts` characterizes strict Gregorian/leap-century/clock/offset validation, accepted UTC bytes, four-digit year-boundary preservation, recursive blocker order, all-or-nothing mutation, annual sentinel variants, source-row map precedence, output-only exchange proof and order-sensitive hashes, duplicate proof suppression, trace summary/hash/error behavior, namespace repair and exact local-locator SHA redaction. `unit/curation-cleanup-runner-contract.test.mts` adds the multi-row fail-close: one invalid datetime yields zero transforms, a null cleaned path, and no automatic deletion; managed/custom/replaced/symlink-root stale defaults remain byte-identical and reported, while explicit outputs stay untouched. `unit/wave12-prewrite-migration.test.mts` pins the zero-any native module, ten exports, seven direct consumers and the bundle injection edge (eight runtime consumers total).

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

Wave 24 B3 covers curation planning without entering command-family semantics. `unit/curation-gate-workflow-facade-contract.test.mts` pins the exact live aggregate closure; `unit/curation-gate-runner-contract.test.mts` uses a realistic blocked two-process fixture to pin entity, schema/QA blocker, context, authoring-package, alias and report/JSONL byte order plus native JSON failure; `unit/curation-cleanup-runner-contract.test.mts` pins input preservation, deep-cloned row order, strict datetime preflight, blocker-only/no-cleaned output, annual sentinel, trace externalization, output-only exchange proof, locator redaction, counts, exact bytes and native JSON failure. The paired migration tests require native zero-escape TypeScript and every consumer update.

Wave 24 covers five command factories in three RED/GREEN families. `unit/task-completion-command-factories.test.mts` pins queue/file order, duplicate diagnostics, task move bytes, closeout aggregation/dedupe and exact JSON. `unit/handoff-identity-task-command-factories.test.mts` pins final-row artifact SHA/bytes, authoritative CommandSpec argv, no-command blockers, identity snapshot names/bytes and action dedupe order. `unit/support-cache-command-factory.test.mts` uses local HTTP stubs to pin auth/read/paging order, cache summaries, mapping/manual-block order and native failures without reading credentials or production.

Wave 25 covers the reference stack in three dependency-ordered RED/GREEN families. `unit/workflow-reference-closure-contract.test.mts` pins exact exports, DFS/table mapping, Foundry-trace exclusion, planned-self/public-remote/proven/unresolved/foreign closure partitions, write/reuse candidates and decision/operation order. `unit/workflow-source-reference-context-contract.test.mts` pins explicit/default source file precedence, scope/index order, public-canonical filtering and support proof order. `unit/mutation-manifest-workflow-facade-contract.test.mts` pins every live owner reference; `unit/mutation-manifest-runner-contract.test.mts` pins realistic write/reference/blocked partitions, remote proof, report/items and partition JSONL bytes/hashes, native JSON failure, and empty write output whenever the manifest is blocked. Migration tests require atomic native zero-escape TypeScript and every consumer update.

Wave 25 covers three runtime command owners. `unit/cli-wrapper-command-factory.test.mts` executes a real local Node child to pin executable prefixes, argv, CWD/environment, stdout/stderr, nonzero exits and native spawn errors without shell strings. `unit/execution-capsule-command-factory.test.mts` and the existing command fixture pin offline help, attempt/no-replay states, immutable snapshots, predecessor receipts, semantic/raw hashes, reviewer/boundary checks and seals. `unit/post-write-closeout-command-factory.test.mts` routes to realistic unique-root, byte-drift, canonical-hash, accepted-diff and production-mode fixtures.

Wave 25 covers the three decision command factories. `unit/wave25-identity-decision-command-migration.test.mts` and `unit/wave25-classification-location-command-migration.test.mts` pin native-only sources, exact export identity, zero explicit type escapes or suppressions, every dispatcher/metadata consumer, and exact serialized help reports. The realistic command/scenario fixtures continue to pin option aliases/defaults, queue and row path order, task-context and unclosed-item blockers, CLI argv/stage short-circuiting, identity output partitioning, report/JSONL writes, and native malformed-artifact failures.

Wave 25 covers two re-export families. `unit/import-curation-leaf-barrels-migration.test.mts` pins the exact profile/trace namespaces and direct owner references. `unit/import-curation-entry-barrels-migration.test.mts` pins the complete eight-export index/public namespace, every owner reference, Foundry CLI injection keys, metadata owner routes, TS-only atomic entry migration, and a clean temporary TypeScript build loaded by Node 24. No fixture reads credentials, `.env`, production state, or ignored Foundry artifacts.

Wave 26 covers five dependency-ordered orchestration families. The five `unit/wave26-*-command-migration.test.mts` contracts require one native zero-escape owner, every dispatcher/metadata/wrapper consumer and exact serialized help bytes. Existing command and scenario fixtures remain the behavior authority for generic-versus-BAFU configuration, library/scope/classification/identity blocker and artifact order, resume ledgers, pause/stop, bounded parallel selection, read-only preflight, guarded commit delegation, native errors and deterministic report/JSONL bytes. All fixtures are local and read neither `.env` nor production.

Issue #74 is pinned across three owners. `unit/foundry-command-spec.test.mts` requires the local facade to be a direct public CLI re-export with identical function identity. `unit/ready-process-scope-runner.test.mts` freezes two-way real concurrency, input-order report/checkpoint bytes, shell-free artifact-bound execution, raw-array and byte/SHA drift rejection, independent failure progress and one mutation attempt. `unit/ready-scope-scheduler.test.mts` freezes pause, stop, unclaimed order and exception isolation through the locked CLI engine; `scenarios/library-scope-workflow.test.mts` proves the public command path. Budget/cycle tests track the 494/310/79/below-140 boundaries.

Issue #75 is pinned across resume authority and realistic replay scale. `unit/scope-resume-contract.test.mts` changes real bundle/shared bytes, options, CommandSpec, CLI package, and stage policy. `unit/scope-attempt-ledger.test.mts` uses 1,358 USLCI-shaped scopes to prove one compact active row per consumed outage attempt, zero retained transient events after compaction, and no drifted-contract replacement. `unit/cli-bounded-batch-runner.test.mts` proves a resumed mutation performs zero second executions before readback recovery. `unit/process-scope-resume-contract.test.mts`, `unit/process-scope-run-orchestration.test.mts`, and `commands/bafu-process-scope-e2e.test.mts` bind checkpoint inputs, options, argv, CLI/stage policy, and current finalize-report bytes. `unit/flow-resume-ledger.test.mts` and the scope-execution/BAFU command cases bind canonical Flow payload SHA, exact skip, legacy distrust, blocked-contract repair/re-admission, and deterministic reader bytes. All fixtures are sanitized/local and read no `.env` or production payload.

Issue #76 is pinned by `unit/control-artifact-retention.test.mts` and the BAFU command scratch/cache cases. The unit fixture models 34 repeated Worldsteel pilots and six USLCI rounds over 1,358 scopes, requiring one blob for identical control bytes; it also covers exact receipt self-hash, original/store locator separation, payload fact-only pruning, idempotent reuse, POSIX read-only sealing, hardlink/copy fallback, missing evidence, CAS failure, and scope/store symlinks. The command fixture proves current scope reports expose receipt/prune/store paths before actual deletion and that recomputable cache eviction writes a safe report. `unit/orchestration-module-budget.test.mts` keeps every new module bounded and cycle-free. Fixtures are local and contain no production payload or credential.

Issue #70's `unit/batch-post-write-handoff.test.mts` isolates the asynchronous batch closure stage. It proves process, support, and Flow same-id/version conflicts require successful readback before closeout, retryable verification failures preserve attempt/delay evidence, missing reports exhaust the bounded retry plan without closeout, and other commit failures stop before verification. `unit/orchestration-module-budget.test.mts` keeps the command owner and semantic module ceilings shrink-only and includes the new module in cycle analysis once tracked.

Issue #81 strengthens that boundary in `unit/process-handoff-orchestration.test.mts`, `unit/batch-post-write-handoff.test.mts`, and the command-level `commands/bafu-batch-import-run.test.mts` hook contract. Process lost-success recovery verifies without a second commit; owner, state, payload, unexpected-row, and repeated missing-readback findings fail before closeout. Batch and process both reject text-only, mixed, malformed, and incomplete conflict evidence unless structured code `23505` and exact same-id/version semantics agree. The orchestration budget and cycle contract tracks the shared classifier plus bounded process plan/closeout helpers.

Issue #77 is pinned at two layers. `unit/bafu-identity-equivalence-contract.test.mts` proves an exact product-flow name with property/unit/geography/category conflicts cannot become a reuse candidate, freezes the ordered reasons, and retains exact-name reuse when the physical evidence matches. `commands/bafu-auto-authoring.test.mts` drives a real task/package through autofill and deterministic identity apply, proving the conflicting candidate becomes `create_new` evidence and the source flow UUID survives.

Issue #78 is pinned across the full description transport. `unit/library-decision-apply.test.mts` freezes two-language process-reference and exchange-ledger bytes/SHA, scalar stability, and pre-mutation rejection of function/BigInt/cyclic values. `unit/batch-orchestration-identity-patch.test.mts` freezes resolution-decision bytes/SHA; `scenarios/flow-identity-decisions.test.mts` runs identity apply and the later process rewrite; `unit/bafu-identity-decision-carry-forward.test.mts` freezes carry-forward output/report bytes. `unit/orchestration-module-budget.test.mts` tracks the sub-100-line validator and unchanged 667/618/586 ceilings plus cycle freedom.

Issue #79 is pinned across artifact, report, and CLI boundaries. `unit/bafu-leaf-category-map-projection.test.mts` supplies unreferenced conflict, invalid-code, missing-context, and incomplete decisions to the bounded `category-map-report.ts` leaf; each must produce manual status plus a source/reason/artifact blocker, while resolved-only report bytes remain frozen. `unit/orchestration-module-budget.test.mts` keeps projection/report at 656/140-line shrink-only ceilings and cycle-free. `unit/foundry-cli-spine.test.mts` requires manual status to exit nonzero, and `commands/bafu-leaf-classification-tasks.test.mts` proves the real command still writes its complete JSON/manual-review/candidate artifacts on that nonzero exit.

Issue #80 is pinned in `unit/post-finalize-recovery-orchestration.test.mts`. Captured invocations for every identity/semantic stage must equal the projected command's executable plus argv, with derived display, across success, nonzero, thrown execution, and missing-report paths. A deliberately corrupt projector must throw before the next stage. Exact result bytes/SHA and source-level single-call assertions prevent a later reintroduction of reconstructed or partial command strings; budget/cycle tests keep the owner at 539/540 lines with no new SCC.

Issue #83 is pinned in `unit/batch-orchestration-scope-execution.test.mts`. The stable case requires one task-queue lookup and identical suggest/apply paths; four drift cases freeze expected/observed path/bytes/SHA and prove apply is never invoked after missing, changed-length, same-length changed-hash, or relative-path replacement. The pre-existing verified-resume fixture keeps stable report/ledger bytes exact. Budget/cycle tests track the 89/120 binding leaf and unchanged 532-line preparation ceiling.

`fixtures/auth-identity-receipt.ts` is the only test-only receipt materializer. It recreates the frozen public wire fingerprints and scope hash, then every consumer still passes the bytes through `@tiangong-lca/cli/auth-identity-receipt`. `unit/public-cli-batch-runtime.test.mts` loads exact installed CLI 0.1.10 and exercises public batch/run-lock plus strict receipt parsing. `unit/public-cli-runtime.test.mts` exercises the C1 descriptor, expectation drift rejection, manifest and manager/exec exports. `unit/toolchain-contract.test.mts` rejects every private `@tiangong-lca/cli/dist/src/**` import and binds only the exact provenance-verified current release exception.

`unit/cli-bounded-batch-runner.test.mts` is the Foundry/CLI scheduling boundary: it proves the physical run lock exists only during execution, public contract claims are bounded, pause leaves items unclaimed, stop drains claimed work, one family key is FIFO-serialized while an independent key proceeds, and the composition root has no manual worker/`Promise.all` claim loop. Existing BAFU command cases preserve pending-before-limit, pause report bytes, family-master selection, ledgers, and preflight behavior. `wave26-bafu-batch-command-migration.test.mts` fixes the five-line facade's three exports and exact help bytes; `unit/orchestration-module-budget.test.mts` separately exposes the 20-line facade and 1,700-line composition-root ceilings instead of hiding the move.

`unit/batch-scope-finalize-commit.test.mts` covers the enclosing state machine: a missing finalize report fails before recovery or handoff; verified support is reused before the main handoff; stale reuse is invalidated before fresh support commit/cache evidence; recovered rows and reports feed the next finalize attempt; and failed support never reaches the main handoff.

Wave 26 covers adapters and repository tooling in four RED/GREEN families. `unit/tidas-adapter-migration-contract.test.mts` uses controlled local executables to pin argv, environment, operation reports, version gates, path resolution, hashes and native spawn failures. `unit/post-authoring-finalize-utils-contract.test.mts` pins rewrite resolution, identity reuse, queue/input order and fail-closed preflight behavior. `unit/tidas-cutover-script-contract.test.mts` pins the TypeScript-aware tracked inventory, exact stdout and exit contract. `unit/foundry-golden-diff-contract.test.mts` pins merge-base selection, normalization, cross-platform executable/argv handling, byte-equal credential-free child environments, Node-native comparison, Golden diffs and failure exits. All four require zero-escape native TypeScript and prohibit real external TIDAS or production access.

Wave 26 covers four algorithmic command owners as independent RED/GREEN families. `unit/authoring-plan-command-migration.test.mts` pins the native owner/export, all consumers and exact help while existing authoring command cases preserve phase/row order, lineage, artifacts and hashes. `unit/bundle-sample-command-migration.test.mts` combines that migration contract with realistic selection cases for seed, row type, location and scale fail-close. `unit/incremental-command-migration.test.mts` covers native ownership/help while the existing unit, command and scenario fixtures preserve three-way activation, dependency holds, terminal receipts and no-authority CLI handoff. `unit/topology-command-migration.test.mts` does the same for occurrence-aware graph convergence, cycles, retry/hold behavior and ordered F/P/D handoffs. All four reject explicit type escapes and suppression directives.

Wave 26 covers three final command families. `unit/core-command-factory.test.mts` uses an isolated repository fixture to pin runtime directory order, workflow/storage/environment reports, surface/doctor envelopes, native errors and exact global help. `unit/identity-preflight-run-command-factory.test.mts` plus the existing real local CLI scenarios pin all four help reports, receipt-bound argv, request/target/binding hashes, positive-only cache, stale or mismatched disk/stdout, nonzero/timeout failures and only-pending reuse without shell strings. `unit/post-authoring-finalize-command-factory.test.mts` plus finalize scenarios pin rewrite, parent-cleanup-before-nested-support, output-alias isolation, preflight, queue, schema, QA, location, curation, dry-run, mutation and handoff order; a blocked cleanup must terminate that list, preserve/report every pre-existing downstream artifact without deletion, append the blocked ledger, and expose no final rows or CommandSpec. Source/support/reuse artifacts, hashes and blockers remain fail-closed. No fixture reads credentials, `.env`, production data, or ignored Foundry state.

Wave 27 migrates all sixteen remaining command tests in four coherent families. The original `.mjs` suite passes 173 cases before migration. The typed files preserve the same fixture imports and behavior bodies while adding strict parameter/narrowing contracts; `unit/command-tests-*-migration.test.mts` rejects legacy paths, explicit `any`, TypeScript suppressions and stale metadata/docs. `pnpm test:commands` now runs one `.mts` glob, including the existing typed account-wrapper contract.

Wave 26 covers the remaining eight shared fixtures as five dependency-ordered RED/GREEN families. `unit/fixture-executable-core-migration.test.mts` pins the core namespace/live Node references, exact writer bytes, native errors and a non-executable `fake-tidas.ts` launched only through `process.execPath`. `unit/row-builders-fixture-migration.test.mts` pins every payload family and one combined byte/hash contract. `unit/context-identity-mutation-fixture-migration.test.mts` pins workflow namespaces, receipt and row bytes, context/dependency order and isolated roots. `unit/incremental-fixture-migration.test.mts` and `unit/topology-fixture-migration.test.mts` pin their policy/graph constants, artifact order, stable JSONL/package bytes and native failures. All consumers use `.ts`; no fixture reads credentials, `.env`, production state or historical `.foundry` data.

Wave 26 completes the unit-test boundary in four more RED/GREEN families. `unit/unit-source-ledger-test-migration.test.mts` covers six source/language/ledger/support suites; `unit/unit-execution-library-test-migration.test.mts` covers capsule attempt, finalize reuse and library contact suites; `unit/unit-algorithm-adapter-test-migration.test.mts` covers tidas adapter/cutover plus incremental/topology suites and typed fixture imports; `unit/unit-runtime-policy-test-migration.test.mts` covers runtime skill, stage and content/semantic policy suites. All 17 legacy `.test.mjs` files are gone, all 65 original cases stay green, and explicit test-side narrowing adds no production behavior or authority.

Wave 26 completes the scenario boundary in four RED/GREEN families. `scenarios/scenario-authoring-curation-test-migration.test.mts`, `scenario-identity-reference-test-migration.test.mts`, `scenario-mutation-finalize-test-migration.test.mts`, and `scenario-library-algorithm-test-migration.test.mts` require all 19 suites to be native `.mts` with typed fixture imports and no explicit type escape. All 86 original multi-command cases preserve artifact bytes/order/hashes, blockers, native errors, fail-close and remote-write boundaries; no `.test.mjs` remains under `test/scenarios`.

Toolchain and migration contracts must pass in a clean arbitrary Git worktree after `pnpm install --frozen-lockfile`. Tests must not borrow another worktree's `node_modules`, depend on the workspace superproject, read credentials, or use ignored `.foundry` artifacts as fixtures.

## Commands

- `pnpm test`: run the full suite.
- `pnpm test:toolchain`: verify the pnpm/TS7 graph and migration inventory.
- `pnpm test:unit`: run pure logic and metadata tests.
- `pnpm test:commands`: run command contract tests.
- `pnpm test:scenarios`: run workflow scenario tests.
- `node --test test/unit/tidas-adapter.test.mts`: verify 0.2.x handshake, invocation precedence, stable report/exit mapping, validation-batch compatibility, cancellation, cleanup, and rollback at the Foundry boundary.

`unit/cli-support-export.test.mts` protects the CLI adapter's isolated cwd/environment, exact intent, completion marker, contained regular artifacts and row hashes/public state. `unit/support-cache-command-factory.test.mts` preserves summarization/mappings independently of transport.

`foundry-application-composition.test.mts` intercepts operator-state access before it occurs and verifies two independent command applications, result-returning cleanup, unchanged process environment and unknown-command rejection. The existing entry-closure test retains byte-exact source/emitted help and exit behavior.

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
  - scripts/commands/authoring-plan.ts
  - scripts/commands/bundle-sample-rows.ts
  - scripts/commands/incremental-change-set.ts
  - scripts/commands/topology-convergence.ts
  - scripts/lib/foundry-args.ts
  - scripts/lib/foundry-command-registry.ts
  - scripts/lib/foundry-command-metadata.ts
  - scripts/lib/surface-audit.ts
  - scripts/lib/foundry-runtime-utils.ts
  - scripts/lib/location-quality-utils.ts
  - scripts/lib/bundle-row-types.ts
  - scripts/lib/tidas-language-utils.ts
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
  - test/unit/import-ledger-type-contract.test.mts
  - test/unit/fixture-helpers-contract.test.mts
  - test/commands/*.test.mts
  - test/unit/core-command-factory.test.mts
  - test/unit/identity-preflight-run-command-factory.test.mts
  - test/unit/post-authoring-finalize-command-factory.test.mts
  - test/unit/unit-source-ledger-test-migration.test.mts
  - test/unit/unit-execution-library-test-migration.test.mts
  - test/unit/unit-algorithm-adapter-test-migration.test.mts
  - test/unit/unit-runtime-policy-test-migration.test.mts
  - test/scenarios/scenario-authoring-curation-test-migration.test.mts
  - test/scenarios/scenario-identity-reference-test-migration.test.mts
  - test/scenarios/scenario-mutation-finalize-test-migration.test.mts
  - test/scenarios/scenario-library-algorithm-test-migration.test.mts
  - docs/architecture.md
  - docs/runtime-skill-management.md
  - docs/foundry-task-contracts.md
  - docs/incremental-change-set-contract.md
  - docs/topology-convergence-contract.md
  - specs/import-profiles.json
  - specs/typescript-migration-inventory.json
lastReviewedAt: 2026-08-25
lastReviewedCommit: 3a5bd04827ebdcd028f9c08b86641e7a7d3a94e9
lastReviewedNote: "Reviewed for Issue #67 test integration: native TS7 entry/runtime plus complete command, fixture, unit and scenario surfaces preserve profiles, exact help/artifacts, bytes/order/hashes/errors and authority boundaries."
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

The following low-level slice migrates bundle row/root mappings, the complete TIDAS language enumeration, exact `JSON.stringify`/text SHA-256 helpers, and dataset-type aliases/constants. Characterization preserves invalid-input failures, object insertion and array order, root detection, and every direct import before higher workflow modules migrate.

The runtime I/O slice migrates the shared `runtime-io.ts` leaf without changing its synchronous visible contract: parent creation, exact text/pretty-JSON/JSONL bytes, direct overwrite, JSONL prefix retention on mid-stream serialization failure, descriptor closure, native filesystem/parse errors, JSON row envelopes, and portable repository/artifact paths.

The next internal-contract slice migrates artifact/QA inputs, dataset payload identity, compact trace summaries, and full-context inputs. Characterization preserves path fallback, file/hash facts, dedupe and traversal order, installed CLI schema resolution, missing/duplicate/drift findings, exact trace hashes, and native JSON/filesystem errors.

The standalone-leaf slice migrates canonical FlowProperty mappings, profile-aware source semantics, trace queue coverage, and reusable TIDAS row helpers. Characterization preserves all scale factors and pending defaults, BAFU/USLCI/worldsteel source identities, canonical reference rewrites, trace evidence keys/blockers, multilingual/root/id/version helpers, and invalid-input behavior.

The evidence/decision slice migrates decision-task context and stable hashes, identity reference rewrites, full-context completion proof, and identity-preflight request artifacts. Characterization preserves exact paths/bytes/SHA/ordering, missing or ambiguous evidence blockers, artifact-bound CommandSpecs, source-index first binding, and positive-only cache/execution reuse boundaries.

The family/ledger slice migrates BAFU family signatures and the append-only import ledger. Characterization preserves normalized family names, ordered exchange skeleton/template/amount hashes, scope-order master selection and summaries, verified/blocked/retry row schemas, payload identity hashes, duplicate suppression, human-review ordering, resume/skipped artifacts, relative paths, and native parse/filesystem errors.

The canonical/bundle slice migrates canonical FlowProperty reference rewrites and bundle sampling utilities. Characterization preserves normalized mapping lookup, scale/pending/proof/stale-version decisions, support/source/contact/profile fallbacks, source-trace field repair, reference-closure materialization, deterministic selection/dedupe, exact report ordering, and native errors. Bundle sampling also carries the existing scale contract end to end: under the explicit blocking flag, known non-1 factors and unresolved invalid factors use distinct blockers and remain visible in scaling/report/scope-ledger artifacts; scale 1 and no-flag defaults do not change.

The ledger hardening follow-up removes every explicit `any` from `import-ledger.ts` and publishes concrete JSON, dependency, blocker, manifest, report, row, write-option/result, and report-result types. A separate TypeScript compile fixture proves valid state unions and rejects invalid discriminators or numeric paths, while behavior tests preserve exact JSONL bytes, hashes, ordering, dedupe, paths, and errors. The first test-fixture slice also migrates shared fixture roots and ready-finalize builders with all direct consumers updated; inventory accounting therefore moves from 130 to 128 without changing production code.

The runtime wave migrates `foundry-runtime-utils.ts`, the high-fan-in helper used by the entrypoint, account wrapper, context discovery, BAFU commands, location/remote verification and shared tests. Characterization pins the installed CLI package contract, override command rendering, all 49 factory helpers, exact file/JSON/JSONL/frontmatter/env-file/stage behavior, portable paths, errors, hashes, UUIDs and local subprocess reports. The runtime source has no explicit `any`; migration inventory moves from 128 to 127 without reading `.env` or accessing production.

The location wave migrates `location-quality-utils.ts`, which feeds bundle sampling and location/finalize authoring through the Foundry entrypoint. Characterization pins classification/location command strings and artifacts, installed schema code loading, fallback and recursive location target discovery, depth-first/array order, valid/blocker counts, queue context, blocker envelopes and invalid-input errors. It remains fail-closed and zero-any; inventory moves from 127 to 126.

The prewrite wave migrates `prewrite-cleanup.ts`, a six-consumer deterministic evidence boundary. Characterization pins UTC normalization, process-only annual sentinel completion, source-row identity precedence, output-only exchange proof hashes and order sensitivity, existing-proof dedupe, trace summary externalization, namespace repair, local path redaction hashes and serialization errors. It remains zero-any and byte/fail-closed compatible; inventory moves from 126 to 125.

The queue-context wave migrates `import-curation/internal/workflow-queue-context.ts`, a five-consumer authoring-evidence boundary. Characterization pins annual-supply action envelopes, manifest task order and duplicate-map behavior, exact-identity then id-only selection, queue-relative paths, closure dependency/support order, JSONL filtering and last-row binding, identity-preflight path precedence, and native filesystem/parse/invalid-dependency errors. It remains zero-any and fail-closed; inventory moves from 125 to 124.

The internal full-context wave migrates `import-curation/internal/full-context-proof.ts`, a six-consumer evidence boundary. Characterization pins context aliases and UTF-8 presence, exact authoring-package/decision-task bytes and hashes, embedded-before-shared file order, manifest/task alias fallbacks, required-kind/file blocker order, classification schema-pattern selection, payload identity encounter order and last-write hashes, caught proof parse envelopes, and native row JSON errors. It remains zero-any and fail-closed; inventory moves from 124 to 123.

The decision-apply context wave migrates `import-curation/internal/workflow-decision-apply-context.ts`, the evidence adapter shared by curation, mutation and full-context gates. Characterization pins missing/empty envelopes, snake/camel decision and task aliases, decision/task/path order, flow-before-process fallback selection, exact input/output payload hashes with duplicate last-write behavior, applied-count coercion, and native JSON/path errors. It remains zero-any and read-only; inventory moves from 123 to 122.

The profile-config wave migrates `import-curation/internal/profiles-config.ts`, the shared profile loading/lookup/listing boundary. Characterization pins camel/snake precedence, normalized full-context fields, raw account-local overrides, configured key order, requested/default/generic fallback, base-before-extra docs and waivers, conditional dataset-type validation, fallback object identity, profile-list output, and native JSON/argument errors. Existing generic/BAFU/USLCI/worldsteel defaults remain unchanged; inventory moves from 122 to 121.

The patch-collect wave migrates `import-curation/internal/workflow-patch-collect.ts`, the admission/helper boundary shared by nine workflow modules. Characterization pins early invalid returns, deterministic blocker and operation order, action closure, annual-supply defer rejection, full-context/trace evidence, circular-input failure, JSON/JSONL delimiters and parse errors, artifact-option alias order and duplicates, source-rewrite discovery priority and normalized evidence envelopes. It remains zero-any and fail-closed; inventory moves from 121 to 120.

The identity-decision context wave migrates `import-curation/internal/workflow-identity-decision-context.ts`, the evidence adapter shared by curation, mutation, preflight, patch evidence and full-context gates. Characterization pins rewrite candidate priority, scoped/dual-index encounter order, decision/canonical/package aliases, normalized reuse/create/block values, file-versus-embedded fallback, authoring-package proof dedupe, payload hash last-write, merge/unique order, completion predicates, unresolved flow reference keys and native JSON/path errors. It remains zero-any and fail-closed; inventory moves from 120 to 119.

The patch-evidence context wave migrates `import-curation/internal/workflow-patch-evidence-context.ts`, the apply/trace evidence adapter shared by mutation and reference closure. Characterization pins compact aliases, identity/row indexes, exact-bare-row query/dedupe order, apply blockers, output path priority, payload hash last-write, closure codes, exact deterministic cleanup proof, unresolved-before-source trace blockers, safety/profile snapshot SHA/order, recursive import-only trace detection and native JSON/path/cycle failures. It remains zero-any and fail-closed; inventory moves from 119 to 118.

The row-transform context wave migrates `import-curation/internal/workflow-row-transform-context.ts`, the lineage boundary shared by seven workflow modules. Characterization pins unresolved/canonical/generic report aliases, trace/blocker/proof order, payload hash last-write, transform-entry cross products and fixed family order, allowed status matrices, exact/content-equivalent artifacts, unordered multi-pass/cycle-safe graph reachability, cleanup/decision aliases and every direct patch/identity/classification/externalization chain. It remains zero-any and read-only; inventory moves from 118 to 117.

Wave 21 batches two independent low-fan-in families. `workflow-dry-run-context.ts` preserves schema/curation map precedence, operation normalization, flow payload aliases, progress/failure overwrite order and planned-root blocker suppression; inventory moves 117→116. `workflow-evidence-scope.ts` preserves portable blocker envelopes, dry-run aliases, complete stage blocker order, QA parse envelopes and deterministic patch/rewrite chain acceptance; inventory moves 116→115. Both remain zero-any and fail-closed.

Wave 22 follows the real dependency topology rather than treating connected modules as independent leaves. `workflow-decision-full-context.ts` moves first; the mutually dependent `workflow-authoring-tasks.ts`, `workflow-semantic-actions.ts`, and `workflow-patch-evidence.ts` move as one cycle-safe atomic SCC; `workflow-identity-preflight.ts` follows only after that typed closure exists. Characterization preserves proof relevance and row chains, patch/action/trace ordering, full-context and shared-bundle hashes, identity result aliases, exact-version lookup, execution-receipt fail-close, payload freshness, source context, policy blockers and native JSON/filesystem errors. Inventory moves 115→110 without changing command help, Golden artifacts, profile defaults, or remote-write authority.

Wave 23 migrates the authoring facade and runner layer above that SCC. `authoring-task-workflow.ts` and `authoring-patch-workflow.ts` remain pure live-reference facades; `authoring-packages.ts` preserves gate-entry/task order, content-addressed snapshot names, original package bytes, task directories and exact manifest/JSONL output; `patch-collect.ts` preserves task/blocker classification, patch-file/set/operation order, exact ready batch bytes and native manifest errors. Only a blocker-free collection writes a fresh batch. Inventory moves 105→101 without changing help, profiles, Golden artifacts or remote-write authority.

Wave 24 B3 migrates the curation planning boundary in topology order. `curation-gate-workflow.ts` remains a pure live-reference aggregate; `curation-gate.ts` preserves blocked entity, schema/QA/context/action ordering, authoring-package hashes and report/process aliases; `curation-cleanup.ts` preserves deep-cloned row order, exact JSONL/report bytes, annual sentinel and trace transforms, source-only-output proof, redaction counts and native failures. Inventory moves 101→98 without changing profiles, command help, Golden artifacts, Worldsteel semantics or remote-write authority.

Wave 24 migrates five command factories in three RED/GREEN families. `tasks.ts` and `import-completion.ts` preserve queue/file order, full-context completion gates, task moves and exact Markdown/JSON bytes. `commit-handoff.ts` and `identity-decision-task.ts` preserve final-row artifact SHA/bytes, authoritative CommandSpec argv, package snapshots, action encounter/dedupe order and fail-closed blockers. `support-cache.ts` preserves auth-then-read request order, pagination, public cache row order, unit mapping/manual-block order and native errors; tests stub HTTP locally and read no credentials. Inventory moves 101→96 without changing help, remote-write mode, profiles, or production authority.

Together the parallel Wave 24 lanes reduce the inventory from 101 to 93 without changing public help, Golden artifacts, profiles, Worldsteel semantics, or remote-write authority.

Wave 25 migrates the mutation reference stack in dependency order. `workflow-reference-closure.ts` preserves DFS reference discovery and self/remote/proven/unresolved/foreign closure algebra; `workflow-source-reference-context.ts` preserves explicit/default source-rewrite precedence and public-canonical filtering; `mutation-manifest-workflow.ts` plus `mutation-manifest.ts` preserve ordered write/reference/blocked partitions, report/items JSON bytes and hashes, native failures and the rule that one blocked item leaves the executable write file empty. Inventory moves 93→89 without changing help, profiles, Worldsteel semantics, Date.parse behavior or remote-write authority.

Wave 25 migrates three runtime command owners. `cli-wrappers.ts` preserves installed-CLI executable prefixes, exact argv order, CWD/environment, JSON stdout, stderr, nonzero exits and native spawn errors without a shell-string path. `execution-capsule.ts` preserves exclusive immutable snapshots, predecessor receipts, raw/semantic hashes, reviewer and boundary checks, seal hashes, zero dispatch and no-replay attempt states. `post-write-closeout.ts` preserves artifact binding, exact unique-root readback, ordinary-only traceHash normalization, production-test fail-close and foreign/RLS-hidden `missing_dataset` rejection. Inventory moves 93→90 with no command-help, profile, Worldsteel or remote-authority change.

Wave 25 migrates the three decision command factories in dependency order: standalone `identity-decisions.ts` first, then the shared-dispatch `classification-decisions.ts` and `location-decisions.ts` family. Characterization preserves exact help/report bytes, input aliases and defaults, row/path/order semantics, decision-task and queue closure blockers, deterministic CLI argv/stage failure behavior, read-only identity splitting, artifact write boundaries, and native JSON/filesystem errors. Inventory moves 98→95 without changing command names, profile defaults, Worldsteel behavior, or remote-write authority.

Wave 25 migrates the import-curation re-export topology without wrappers. `profiles.ts` and `trace-summary.ts` retain their exact namespaces and owner function identity; `import-curation/index.ts` and the public `import-curation.ts` entry retain the complete eight-export namespace and direct references to the semantic owners. Node 24 loads both source and emitted entry layers, and command metadata continues to route each command to its semantic owner. Inventory moves 93→89 without changing runtime behavior, command help, profiles, Worldsteel semantics, or remote-write authority.

Wave 26 migrates five dataset-orchestration owners in dependency order: generic `library-scope-workflow.ts`, then BAFU leaf classification and auto-authoring, process-scope E2E, and the shared BAFU batch engine used by the USLCI and Worldsteel adapters. Characterization preserves profile-agnostic versus BAFU configuration, library/scope/identity/classification blocker and artifact order, resume/pause/parallel/preflight/commit delegation, authoritative executable-plus-argv and receipt/hash checks, exact help/report bytes, native errors, and explicit-commit-only authority. Inventory moves 79→74 without changing command names, profile defaults, Golden artifacts, Worldsteel semantics, Date.parse behavior, or production authority; every case is local and reads neither `.env` nor production.

Wave 26 migrates four adapter/tool boundaries. `tidas-adapter.ts` retains executable/config precedence, controlled script argv/env, operation/version/asset reports, batch document hashes and atomic rollback. `post-authoring-finalize-utils.ts` retains rewrite discovery, identity reuse, payload-freshness hashes, external-reference and finalize order. `check-tidas-cutover.ts` retains authoritative Git inventory and JSON/exit behavior; `foundry-golden-diff.ts` retains non-HEAD merge-base selection, cross-platform path/argv normalization and Node-native comparison. Inventory moves 89→85 without changing help, profiles, Worldsteel, Date.parse or remote-write authority.

Wave 26 migrates four algorithmic command owners as four RED/GREEN families. `authoring-plan.ts` preserves phase and row ordering, source/task lineage, content hashes, exact plan artifacts and native input failures. `bundle-sample-rows.ts` preserves seeded selection, row-type/location order and canonical scale fail-close. `incremental-change-set.ts` preserves three-way merge, dependency activation/hold isolation, terminal hash-chained receipts and CLI handoff candidates. `topology-convergence.ts` preserves occurrence-aware graph composition, F/P/D ordering, cycle-safe retry/hold behavior and separate no-authority handoffs. Exact command help remains unchanged, and inventory moves 89→85 without changing profiles, Worldsteel semantics, Date.parse behavior or remote-write authority.

Wave 26 migrates the three remaining non-entry command owners. `core.ts` preserves runtime-directory order, workflow/storage/environment diagnostics, surface aggregation, route artifacts and exact help. `identity-preflight-run.ts` preserves receipt-bound CLI argv, request/target/binding hashes, positive-only cache reuse, stale or mismatched disk/stdout failure, nonzero exits and only-pending semantics without shell authority. `post-authoring-finalize.ts` preserves identity, unresolved-exchange, source/contact and canonical-support rewrite order; cleanup, preflight, queue, schema, QA, location, curation and dry-run gates; mutation evidence and read-only handoff planning. Inventory moves 79→76 without changing profiles, Worldsteel or Date.parse behavior, or remote-write authority.

Wave 27 migrates all sixteen remaining `test/commands` JavaScript contracts in four RED/GREEN families: core/ledger/support, authoring/decisions, BAFU/library, and offline incremental/topology/capsule planners. The original suite passed 173/173 before renames; `pnpm test:commands` now exposes one `.mts` glob and includes the existing typed account-wrapper cases. Inventory moves 76→60 with no runtime owner, fixture, profile, Worldsteel, Date.parse, or authority change.

Wave 26 migrates the remaining eight shared fixtures in dependency order: the fake-tidas/core executable boundary, pure row builders, full-context/identity/mutation evidence fixtures, and incremental/topology algorithm packages. Characterization preserves exact runtime namespaces and live Node references, JSON/JSONL bytes and hashes, row/graph/dependency order, worktree-local temporary isolation and native filesystem/argument failures. `fake-tidas.ts` has no executable-bit contract and is always launched through `process.execPath` plus argv. Inventory moves 79→71 without reading `.env`, accessing production, or changing command help, profiles, Worldsteel/Date.parse behavior, or remote-write authority.

Wave 26 then migrates all 17 remaining `test/unit/*.test.mjs` suites in four behavior-aligned RED/GREEN families. The original suites pass before rename; migration contracts require native `.mts`, zero explicit escapes/suppressions, typed fixture imports and updated governed paths. Their 65 established cases retain exact source/language/ledger/support rules, capsule/finalize/library behavior, adapter/cutover/incremental/topology algebra, runtime-skill/stage/content policy and native errors. Inventory moves 71→54 without changing production modules, help, profiles, Worldsteel/Date.parse behavior or authority.

Wave 26 then migrates all 19 remaining `test/scenarios/*.test.mjs` suites in four multi-command RED/GREEN families. Their 86 original cases pass before rename; migration contracts require `.mts`, typed fixtures and zero explicit escapes/suppressions. Authoring/curation, identity/reference, mutation/finalize and library/incremental/topology packages retain exact artifacts, order, hashes, native failures, fail-close and no-remote-authority boundaries. Inventory moves 54→35 without changing production behavior, help, profiles, Worldsteel/Date.parse semantics or authority.

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
node scripts/foundry.ts tidas-handshake
pnpm task:route -- --kind external-dataset-curated-import --dataset-type process --required-gates contract,schema,qa,curation
pnpm task:route -- --kind source-evidence-dataset-development --dataset-type process --required-gates context,schema,qa,curation
pnpm skills:source-evidence:use:document
pnpm skills:source-evidence:use:sci
node scripts/foundry.ts dataset-incremental-change-set-compose --request <request.json> --out-dir <fresh-output-dir>
node scripts/foundry.ts dataset-topology-convergence-compose --request <request.json> --out-dir <fresh-output-dir>
```

Tests are organized by behavior layer in `test/README.md`. Use `pnpm test` for the full suite and `pnpm test:unit|test:commands|test:scenarios` for targeted checks; `pnpm test:toolchain` protects the pnpm/TS7 contract. Old incident-numbered test aliases are not part of the maintained surface.

Use owner-routed execution commands for dataset work:

```bash
node scripts/foundry.ts dataset-tidas-import \
  --input ./source-package \
  --output ./.foundry/workspaces/<task-id>/conversion

node scripts/foundry.ts dataset-tidas-validate \
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

node scripts/foundry.ts dataset-curation-gate \
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
node scripts/foundry.ts dataset-library-index-build \
  --source-dir <converted-library-root> \
  --process-bundles-dir <converted-library-root>/process-bundles \
  --out-dir <run-dir>/library-index

node scripts/foundry.ts dataset-library-authoring-plan \
  --library-index <run-dir>/library-index \
  --out-dir <run-dir>/authoring-plan

node scripts/foundry.ts dataset-library-decisions-apply \
  --library-index <run-dir>/library-index \
  --decisions-dir <run-dir>/decisions \
  --out-dir <run-dir>/library-resolution

node scripts/foundry.ts dataset-process-scope-run \
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

- `scripts/foundry.ts`: small Foundry command surface.
- `scripts/lib/import-curation.ts`: typed public barrel for generic dataset curation/cleanup owners.
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

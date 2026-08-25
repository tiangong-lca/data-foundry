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
  - scripts/lib/decision-task-utils.ts
  - scripts/lib/identity-reference-rewrite-utils.ts
  - scripts/lib/full-context-proof.ts
  - scripts/lib/identity-preflight-artifacts.ts
  - scripts/lib/bafu-family-signatures.ts
  - scripts/lib/import-ledger.ts
  - test/unit/bafu-family-signatures-contract.test.mts
  - test/unit/import-ledger-contract.test.mts
  - test/unit/wave8-large-leaf-migration.test.mts
  - test/unit/foundry-cli-spine.test.mts
  - AGENTS.md
  - docs/foundry-ai-navigation.md
  - docs/foundry-command-surface.md
lastReviewedAt: 2026-08-25
lastReviewedCommit: 3a8be52f3dfe862fab6c1e0a9aaab5e40f1822b9
lastReviewedNote: "Reviewed for Issue #67 Wave 8: tests cover BAFU name/hash/skeleton/rank/missing behavior plus import-ledger JSONL identity, closeout, blocker, retry, resume, dedupe, path, and error contracts."
---

# Test Layout

Foundry tests are organized by responsibility, not by the date a regression was added.

## Directories

- `unit/`: pure logic and metadata tests. These tests should avoid shelling out to Foundry commands unless the subject is command metadata or command contracts.
- `commands/`: command-level contract tests. These may run `node scripts/foundry.mjs ...` and assert stable artifacts, reports, blockers, and exit behavior for one command family.
- `scenarios/`: multi-command workflow tests. These cover realistic evidence chains such as full-context gates, post-authoring finalize, mutation manifests, and packaged-library process scopes.
- `fixtures/`: shared row builders, report builders, command runners, file helpers, and process-boundary fakes split by behavior surface. Keep common command/file helpers in `foundry-core.mjs`, roots in `fixture-roots.mjs`, row payload builders in `row-builders.mjs`, workflow-specific builders in `identity-fixtures.mjs`, `finalize-fixtures.mjs`, `full-context-fixtures.mjs`, or `mutation-fixtures.mjs`, and the machine-contract-only Rust tidas process fake in `fake-tidas.mjs`. The fake may model published reports/exits/cancellation but must not reimplement schema or converter logic.

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

Toolchain and migration contracts must pass in a clean arbitrary Git worktree after `pnpm install --frozen-lockfile`. Tests must not borrow another worktree's `node_modules`, depend on the workspace superproject, read credentials, or use ignored `.foundry` artifacts as fixtures.

## Commands

- `pnpm test`: run the full suite.
- `pnpm test:toolchain`: verify the pnpm/TS7 graph and migration inventory.
- `pnpm test:unit`: run pure logic and metadata tests.
- `pnpm test:commands`: run command contract tests.
- `pnpm test:scenarios`: run workflow scenario tests.
- `node --test test/unit/tidas-adapter.test.mjs`: verify 0.2.x handshake, invocation precedence, stable report/exit mapping, validation-batch compatibility, cancellation, cleanup, and rollback at the Foundry boundary.

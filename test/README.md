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
  - AGENTS.md
  - docs/foundry-ai-navigation.md
  - docs/foundry-command-surface.md
lastReviewedAt: 2026-08-25
lastReviewedCommit: db0d3129414884234cb24452ba71168c02e64d60
lastReviewedNote: "Reviewed for Issue #65: typed receipt/CommandSpec/root-proof tests, explicit production case TDD outside ordinary CI, TS surface audit, pnpm-only gates, and clean-worktree isolation."
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

Toolchain and migration contracts must pass in a clean arbitrary Git worktree after `pnpm install --frozen-lockfile`. Tests must not borrow another worktree's `node_modules`, depend on the workspace superproject, read credentials, or use ignored `.foundry` artifacts as fixtures.

## Commands

- `pnpm test`: run the full suite.
- `pnpm test:toolchain`: verify the pnpm/TS7 graph and migration inventory.
- `pnpm test:unit`: run pure logic and metadata tests.
- `pnpm test:commands`: run command contract tests.
- `pnpm test:scenarios`: run workflow scenario tests.
- `node --test test/unit/tidas-adapter.test.mjs`: verify 0.2.x handshake, invocation precedence, stable report/exit mapping, validation-batch compatibility, cancellation, cleanup, and rollback at the Foundry boundary.

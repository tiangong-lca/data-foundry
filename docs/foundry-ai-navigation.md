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
  - docs/final-delivery-promotion-contract.md
  - test/README.md
  - scripts/foundry.mjs
  - scripts/lib/foundry-cli.mjs
  - scripts/lib/foundry-command-metadata.mjs
  - scripts/lib/import-curation/**
  - test/unit/foundry-command-metadata.test.mjs
lastReviewedAt: 2026-06-05
lastReviewedCommit: dabd3c9b9841641668caee6fe37cda37d3140739
---

# Foundry AI Navigation

Foundry is a thin control plane. Start from commands and artifacts, then move to the semantic owner module. Do not start from large implementation files.

## Command Path

Every command follows this route:

```text
scripts/foundry.mjs
  -> scripts/lib/foundry-cli.mjs
  -> command owner module
```

The checked source of truth for command ownership is `scripts/lib/foundry-command-metadata.mjs`. It maps every command returned by `node scripts/foundry.mjs help` to:

- category
- owner module
- owner export
- input artifacts
- output artifacts
- key tests

`test/unit/foundry-command-metadata.test.mjs` enforces that the metadata covers all registered commands and that public commands remain reachable within two jumps from `scripts/foundry.mjs`.

For completed delivery packages, navigate directly from `final-delivery-promote` to `scripts/commands/final-delivery-promotion.mjs` and `docs/final-delivery-promotion-contract.md`. This is a local gate aggregator: package-specific counts, sheets, proof columns, and reviewer coverage belong in `foundry-final-delivery-manifest.v1`, not in the command implementation.

## Import-Curation Modules

Use these semantic modules as the import-curation navigation surface:

| Module | Responsibility |
| --- | --- |
| `scripts/lib/import-curation/profiles.mjs` | import profile listing and profile lookup |
| `scripts/lib/import-curation/curation-gate.mjs` | curation gate report and AI authoring package creation |
| `scripts/lib/import-curation/authoring-packages.mjs` | AI authoring task manifest/package preparation |
| `scripts/lib/import-curation/patch-collect.mjs` | AI patch collection and patch evidence readiness |
| `scripts/lib/import-curation/curation-cleanup.mjs` | deterministic prewrite row cleanup |
| `scripts/lib/import-curation/trace-summary.mjs` | Foundry trace summarization |
| `scripts/lib/import-curation/mutation-manifest.mjs` | prewrite mutation manifest and blocker aggregation |

Command runners live in the semantic modules above. The remaining reusable workflow logic is exposed through focused internal workflow facets such as `authoring-task-workflow.mjs`, `authoring-patch-workflow.mjs`, `curation-gate-workflow.mjs`, and `mutation-manifest-workflow.mjs`. New command behavior should start in the semantic owner module, with reusable helpers placed in focused internal modules.

Complex workflow commands should also publish an AI-readable `stage_pipeline` contract in their help/report payload. The shared helper is `scripts/lib/stage-contract.mjs`; it standardizes `remote_write_mode`, `stage_pipeline[].stage`, canonical `phase`, `purpose`, `inputs`, `outputs`, `blockers`, `artifacts`, `side_effects`, and a stable `report_contract` requiring `status`, `counts`, `files`, `blockers`, and read-only `remote_write_mode`. Complex commands should expose the canonical phases `prepare`, `rewrite_cleanup`, `gate_validate`, and `report`. `test/unit/foundry-stage-contract.test.mjs` currently enforces this contract for:

- `dataset-bundle-sample-rows`
- `dataset-post-authoring-finalize`
- `dataset-authoring-plan`
- `dataset-identity-preflight-run`

## Internal Layers

The current internal dependency direction is:

```text
semantic import-curation modules
  -> internal/*-workflow.mjs
  -> internal/workflow-*.mjs
  -> internal/full-context-proof.mjs
  -> internal/profiles-config.mjs
  -> internal/trace-summary.mjs
  -> internal/dataset-payload.mjs
  -> internal/dataset-types.mjs
  -> internal/runtime-io.mjs
```

Layer rules:

- `runtime-io.mjs`: generic time, array, text, JSON/JSONL, filesystem, and path helpers.
- `dataset-types.mjs`: supported dataset type sets, plural names, and fallback profile constants.
- `dataset-payload.mjs`: TIDAS row payload unwrap, dataset root/type detection, dataset identity, and identity map keys.
- `profiles-config.mjs`: import profile loading, normalization, listing, and lookup.
- `trace-summary.mjs`: Foundry trace entry collection and compact trace summaries.
- `prewrite-cleanup.mjs`: deterministic write-preparation transforms such as annual-supply sentinel completion, import trace externalization, Foundry trace namespace repair, local locator redaction, and timestamp normalization.
- `full-context-proof.mjs`: full-context package/task proof loading and blocker construction.
- `authoring-task-workflow.mjs`: AI authoring package to task manifest/template preparation helpers.
- `authoring-patch-workflow.mjs`: AI patch collection, patch-set validation, and full-context readiness helpers.
- `curation-gate-workflow.mjs`: curation gate queue, identity-preflight, QA/schema action, and authoring context helpers.
- `mutation-manifest-workflow.mjs`: prewrite evidence, reference closure, dry-run proof, and write-candidate planning helpers.
- `workflow-queue-context.mjs`, `workflow-identity-preflight.mjs`, `workflow-identity-decision-context.mjs`, `workflow-semantic-actions.mjs`, `workflow-authoring-tasks.mjs`, `workflow-patch-evidence.mjs`, `workflow-patch-evidence-context.mjs`, `workflow-patch-collect.mjs`, `workflow-row-transform-context.mjs`, `workflow-evidence-scope.mjs`, `workflow-decision-apply-context.mjs`, `workflow-decision-full-context.mjs`, `workflow-dry-run-context.mjs`, `workflow-source-reference-context.mjs`, and `workflow-reference-closure.mjs`: focused domain helpers used by the workflow facets above.

Dependencies should point downward only. Internal low-level modules must not import semantic command modules.

## Cleanup Checks

Before deleting a Foundry-local surface, prove the current replacement path and check command metadata, tests, docs, and docpact coverage. Safe deletions include old npm aliases, empty metadata categories, and draft orchestration docs with no remaining consumer. Do not delete runtime skills, task templates, profile docs, or account-safety docs only because they are low-frequency; those may be agent entrypoints rather than code imports. Run `node scripts/foundry.mjs surface-audit` to automate the local scan for hidden command aliases, empty metadata categories, unregistered orphan docs, and script modules without inbound imports.

## Behavior Freeze

The test tree is split by behavior layer:

- `test/unit/` protects pure metadata and local helper contracts.
- `test/commands/` protects single-command artifacts, reports, and stage contracts.
- `test/scenarios/` protects multi-command workflow behavior.
- `test/fixtures/` contains focused helper modules for core command runners, fixture roots, row builders, identity/finalize/full-context/mutation workflow fixtures, and similar shared setup.

Before and after structural changes, run:

```bash
npm run golden:diff
npm test
node scripts/foundry.mjs doctor
git diff --check
```

Golden diff protects CLI JSON compatibility for the key command set. The full test suite protects workflow-specific artifact and proof behavior. Command metadata tests protect AI navigation.

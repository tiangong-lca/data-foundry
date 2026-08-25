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
  - scripts/foundry.mjs
  - scripts/lib/foundry-args.ts
  - scripts/lib/foundry-cli.mjs
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
  - scripts/commands/incremental-change-set.mjs
  - scripts/lib/import-curation/**
  - test/unit/foundry-command-metadata.test.mts
lastReviewedAt: 2026-08-25
lastReviewedCommit: 247e1007a38aff7311ded1d9b8a70898c300b4da
lastReviewedNote: "Reviewed for Issue #67 Wave 17: navigation records typed patch admission, local JSON/artifact readers, report aliases, source rewrite normalization and consumers."
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

The checked source of truth for command ownership is `scripts/lib/foundry-command-metadata.ts`. It maps every command returned by `node scripts/foundry.mjs help` to:

- category
- owner module
- owner export
- input artifacts
- output artifacts
- key tests

`test/unit/foundry-command-metadata.test.mts` enforces that the metadata covers all registered commands, that public commands remain reachable within two jumps from `scripts/foundry.mjs`, and that commit handoff metadata advertises the authoritative CommandSpec and final-row artifact evidence.

The incremental lane is owned by `scripts/commands/incremental-change-set.mjs`, with its authoritative artifact and activation boundary in `docs/incremental-change-set-contract.md`. It composes Foundry-owned task evidence and stops before the CLI-owned mutation boundary.

## TypeScript Migration Navigation

Do not navigate the migration by extension alone. `specs/typescript-migration-inventory.json` records the Issue #63 baseline of 160 tracked JavaScript artifacts. The typed dependency spine is:

```text
entrypoint + argument contract
  -> command registry + command metadata
  -> runtime I/O + hashing + artifact/receipt contracts
  -> semantic command owners
  -> command and scenario fixtures
```

Migrate downward in that order, starting each slice with a failing characterization or realistic case. Keep the existing `.mjs` implementation until the TypeScript replacement preserves help, stdout, exit, stage, artifact, and safety contracts. Update the inventory in the same change; a typed wrapper around an untyped business module does not complete that module.

The first characterized CLI-spine leaves are `scripts/lib/foundry-args.ts` and `scripts/lib/foundry-command-registry.ts`. Navigate to the former for positional, kebab-to-camel, repeated-option, inline-value, flag, and scalar coercion behavior. Navigate to the latter for the exact public/dataset command order, help JSON ownership note, and exit-code mapping. `test/unit/foundry-cli-spine.test.mts` pins those behaviors and verifies every static consumer imports the native TypeScript modules.

The typed navigation/governance leaves are `scripts/lib/foundry-command-metadata.ts` and `scripts/lib/surface-audit.ts`. The metadata module owns the exact command-to-owner/export/input/output/key-test map. The audit module owns hidden-handler, category, orphan-doc, declared-entrypoint, and script-only inbound checks; it recognizes explicit and dynamic TS imports, emits portable POSIX report paths on every OS, and deliberately excludes test-only imports from runtime reachability evidence. Their focused unit tests also reject active references to removed migration paths.

The typed low-level data leaves are `scripts/lib/bundle-row-types.ts`, `scripts/lib/tidas-language-utils.ts`, `scripts/lib/import-curation/internal/hash-utils.ts`, and `scripts/lib/import-curation/internal/dataset-types.ts`. Navigate there for exact TIDAS root/information/table mappings, language enumeration and CJK fallback, raw `JSON.stringify`/text SHA-256 behavior, or dataset-type aliases/plural/support constants. These are serialization and vocabulary contracts: callers must not silently canonicalize object key order, reorder arrays, widen language tags, or accept unsupported types during migration.

The high-fan-in typed I/O leaf is `scripts/lib/import-curation/internal/runtime-io.ts`. It owns generic coercion, JSON/JSONL/text reading and synchronous writing, filesystem probes, repository/artifact path normalization, row-envelope loading, option lists, unique values, and safe filename fragments. Its current writer contract is direct synchronous overwrite rather than transactional rename: JSONL closes its descriptor on success and error, while a serialization failure after earlier rows leaves the completed prefix visible. Do not change those semantics implicitly during consumer migrations.

The typed contracts immediately above runtime I/O are `artifact-inputs.ts`, `dataset-payload.ts`, `trace-summary.ts`, and `context-inputs.ts`. They own QA/artifact file fallback and dedupe, TIDAS payload/root/type/id/version extraction, ordered `common:other` trace aggregation and compact hashing, and exact installed-CLI schema/methodology/classification/location context resolution. Missing files, duplicate resolved paths, context-byte drift, invalid JSON, trace serialization errors, and fallback identities remain explicit evidence rather than silently repaired input.

The typed standalone policy/row leaves are `canonical-support-mappings.ts`, `source-semantics.ts`, `trace-coverage.ts`, and `tidas-row-utils.ts`. Navigate there for exact canonical FP/UG scales and pending support, profile-aware source kind/fallback/reference decisions, final-row-to-trace-queue coverage keys and blocker envelopes, or reusable root/id/version/multilingual row transforms. These factories retain existing BAFU/USLCI/worldsteel defaults and must not silently normalize units, sources, trace evidence, or row payloads during migration.

The typed evidence/decision leaves are `decision-task-utils.ts`, `identity-reference-rewrite-utils.ts`, `full-context-proof.ts`, and `identity-preflight-artifacts.ts`. They own stable decision selection/context bundles, exact identity reference reuse or unresolved traces, profile-required completion lineage, and content-bound preflight requests/CommandSpecs/source-index attachments. Missing, stale, ambiguous, cross-context, or non-positive evidence remains blocking; display strings and unbound cache candidates never become execution authority.

The typed family/ledger leaves are `bafu-family-signatures.ts` and `import-ledger.ts`. Navigate to the former for location-aware family-name normalization, ordered skeleton/flow-template/amount-vector hashes, scope-order master selection, compact planning fields, and missing-signature summaries. Navigate to the latter for append-only verified/blocked/dependency/retry JSONL, row identity and payload hashes, human-action text, dedupe keys, manifest paths, and read-only resume/skipped reports. Preserve insertion order, exact JSON bytes, and native parse/filesystem failures during caller migrations.

The typed canonical/materialization leaves are `canonical-support-rewrites.ts` and `bundle-sample-utils.ts`. Navigate to the former for normalized source-unit lookup, canonical FP/UG proof, stale-version and account-local precedence, exact rewrite/blocker/scaling artifacts, or deferred rows. Navigate to the latter for source traces and field repair, classification/elementary queues, profile-safe library contacts, bundle selection, and identity-key dedupe. Bundle sampling must pass the same scaling accumulator and block flag into canonical rewrites before the original source-unit reference is lost; known non-1 and unresolved invalid scales have distinct blocker codes.

`import-ledger.ts` exports the typed ledger vocabulary as well as its factory. Navigate there for recursive JSON values, dependency injection, closeout/finalize discriminators, verified/blocked/dependency/retry/resume rows, manifests, write results, and read-only report results. `import-ledger-type-contract.test.mts` compiles positive and negative usage outside the main tsconfig; behavioral tests remain authoritative for bytes and ordering. Test-only shared paths/default report builders live in `test/fixtures/fixture-roots.ts` and `finalize-fixtures.ts`.

The typed runtime leaf is `foundry-runtime-utils.ts`. Navigate there for the pinned installed CLI manifest/bin/schema contract, `TIANGONG_LCA_CLI_BIN` precedence and command rendering, generic text/JSON/JSONL/path/count/search helpers, task frontmatter and scalar fields, explicit env-file loading, list/option/hash/UUID helpers, stage blocker aggregation and CLI JSON subprocess envelopes. `foundry-runtime-utils-contract.test.mts` covers all returned helpers without invoking `loadRuntimeEnv()`; `wave10-runtime-migration.test.mts` pins the zero-any source and every static consumer.

The typed location leaf is `location-quality-utils.ts`. Navigate there for classification and location authoring command strings, installed location-code map loading, schema/fallback location target keys, recursive target paths and `location_code_requires_authoring` evidence. It returns four helpers through `foundry.mjs`; command/scenario tests cover their bundle, location-decision, curation and finalize consumers while `location-quality-utils-contract.test.mts` pins exact order and envelopes.

The typed deterministic prewrite leaf is `import-curation/internal/prewrite-cleanup.ts`. Navigate there for UTC metadata normalization, annual-supply missing-data sentinel completion, source-row identity indexing, output-only exchange completeness proof, `tidasimport:sourceTrace` hash externalization, Foundry trace namespace repair and local locator redaction. Its proof hashes intentionally preserve exchange array and object insertion order while excluding only `referenceToFlowDataSet`.

The typed queue leaf is `import-curation/internal/workflow-queue-context.ts`. Navigate there for annual-supply schema actions, curation manifest loading, task/artifact path resolution, exact-version and id-only task selection, closure dependency/support attachment, authoring JSONL identity indexes and identity-preflight request paths. Its tests pin encounter order, duplicate-map behavior, portable paths and native fail-closed errors across all static consumers.

The typed internal proof leaf is `import-curation/internal/full-context-proof.ts` (distinct from the reusable `scripts/lib/full-context-proof.ts` factory). Navigate there for curation context aliases, package/task/shared-bundle byte and SHA proof, non-empty required context blockers, classification/location file-pattern selection and per-identity payload hashes. Its consumers are the decision, identity, patch-evidence, reference-closure and row-transform context modules.

The typed decision apply leaf is `import-curation/internal/workflow-decision-apply-context.ts`. Navigate there for classification apply report aliases, normalized decision rows, decision-task proof binding, input/output row path lists, fallback dataset type selection, identity payload hashes and applied counts. Curation and mutation workflow facets re-export it; decision full-context logic consumes it directly.

The typed profile leaf is `import-curation/internal/profiles-config.ts`. Navigate there for profile field alias precedence, full-context policy normalization, account-local override projection, config-file fallback, requested/default/generic lookup, operator-added docs/QA waivers and ordered profile listing. The public profiles facade plus curation and mutation facets consume it; profile defaults remain declarative in `specs/import-profiles.json`.

The typed patch collect leaf is `import-curation/internal/workflow-patch-collect.ts`. Navigate there for patch-set admission blockers, action-item closure, resolution/context/evidence validation, JSON/JSONL and optional artifact readers, identity-apply report option aliases, default source-rewrite discovery and normalized source-rewrite evidence. Its nine workflow consumers span authoring, curation, mutation, dry-run, identity, evidence, reference closure and row transforms.

The supported toolchain is Node.js 24, `pnpm@11.23.0`, TypeScript `7.0.2` only, Oxlint, and Prettier. Before merging a migration slice, verify it in a clean arbitrary Git worktree with frozen pnpm install and no dependency on sibling checkouts, external `node_modules`, credentials, or ignored `.foundry` state.

The typed handoff primitive is `scripts/lib/foundry-command-spec.ts`. Navigate there for exact-key parsing, canonical command hashing, critical-flag uniqueness, final-row artifact facts, or pre-spawn drift checks. Callers must never reconstruct argv from `display`.

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
- `dataset-incremental-change-set-compose`

## Internal Layers

The current internal dependency direction is:

```text
semantic import-curation modules
  -> internal/*-workflow.mjs
  -> internal/workflow-*.mjs
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
- `authoring-task-workflow.mjs`: AI authoring package to task manifest/template preparation helpers.
- `authoring-patch-workflow.mjs`: AI patch collection, patch-set validation, and full-context readiness helpers.
- `curation-gate-workflow.mjs`: curation gate queue, identity-preflight, QA/schema action, and authoring context helpers.
- `mutation-manifest-workflow.mjs`: prewrite evidence, reference closure, dry-run proof, and write-candidate planning helpers.
- `workflow-queue-context.ts`, `workflow-identity-preflight.mjs`, `workflow-identity-decision-context.mjs`, `workflow-semantic-actions.mjs`, `workflow-authoring-tasks.mjs`, `workflow-patch-evidence.mjs`, `workflow-patch-evidence-context.mjs`, `workflow-patch-collect.ts`, `workflow-row-transform-context.mjs`, `workflow-evidence-scope.mjs`, `workflow-decision-apply-context.ts`, `workflow-decision-full-context.mjs`, `workflow-dry-run-context.mjs`, `workflow-source-reference-context.mjs`, and `workflow-reference-closure.mjs`: focused domain helpers used by the workflow facets above.

Dependencies should point downward only. Internal low-level modules must not import semantic command modules.

## Cleanup Checks

Before deleting a Foundry-local surface, prove the current replacement path and check command metadata, tests, docs, and docpact coverage. Safe deletions include old package-script aliases, empty metadata categories, and draft orchestration docs with no remaining consumer. Do not delete runtime skills, task templates, profile docs, or account-safety docs only because they are low-frequency; those may be agent entrypoints rather than code imports. Run `node scripts/foundry.mjs surface-audit` to automate the local scan for hidden command aliases, empty metadata categories, unregistered orphan docs, and script modules without inbound imports.

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
node scripts/foundry.mjs doctor
git diff --check
```

Golden diff protects CLI JSON compatibility for the key command set. The full test suite protects workflow-specific artifact and proof behavior. Toolchain tests protect the pnpm/TS7 graph and migration ledger. Command metadata tests protect AI navigation.

---
title: TianGong LCA Data Foundry Agent Guide
docType: contract
scope: repo
status: active
authoritative: true
owner: tiangong-lca-data-foundry
language: en
whenToUse:
  - when operating a Foundry import or source-evidence authoring task
  - when deciding which project owns conversion, validation, curation, skill, or write behavior
whenToUpdate:
  - when Foundry ownership boundaries or default operating order change
  - when runtime skill, profile, workspace, or gate contracts change
checkPaths:
  - AGENTS.md
  - README.md
  - WORKFLOW.md
  - docs/architecture.md
  - docs/capability-ownership-policy.md
  - docs/runtime-skill-management.md
  - docs/foundry-task-contracts.md
  - docs/execution-capsule-contract.md
  - docs/incremental-change-set-contract.md
  - docs/topology-convergence-contract.md
  - docs/import-profiles/bafu/leaf-process-classification-authoring.md
  - .nvmrc
  - .oxlintrc.json
  - .prettierignore
  - package.json
  - pnpm-lock.yaml
  - pnpm-workspace.yaml
  - prettier.config.cjs
  - tsconfig*.json
  - scripts/foundry.mjs
  - scripts/with-lca-account.ts
  - scripts/commands/tasks.ts
  - scripts/commands/import-completion.ts
  - scripts/commands/commit-handoff.ts
  - scripts/commands/identity-decision-task.ts
  - scripts/commands/support-cache.ts
  - scripts/commands/cli-wrappers.ts
  - scripts/commands/execution-capsule.ts
  - scripts/commands/post-write-closeout.ts
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
  - test/unit/import-ledger-type-contract.test.mts
  - test/unit/fixture-helpers-contract.test.mts
  - test/unit/curation-gate-workflow-facade-contract.test.mts
  - test/unit/wave24-curation-gate-workflow-migration.test.mts
  - test/unit/curation-gate-runner-contract.test.mts
  - test/unit/wave24-curation-gate-runner-migration.test.mts
  - test/unit/curation-cleanup-runner-contract.test.mts
  - test/unit/wave24-curation-cleanup-runner-migration.test.mts
  - test/unit/workflow-reference-closure-contract.test.mts
  - test/unit/wave25-reference-closure-migration.test.mts
  - test/unit/workflow-source-reference-context-contract.test.mts
  - test/unit/wave25-source-reference-context-migration.test.mts
  - test/unit/mutation-manifest-workflow-facade-contract.test.mts
  - test/unit/mutation-manifest-runner-contract.test.mts
  - test/unit/wave25-mutation-manifest-migration.test.mts
  - test/unit/cli-wrapper-command-factory.test.mts
  - test/unit/execution-capsule-command-factory.test.mts
  - test/unit/post-write-closeout-command-factory.test.mts
  - specs/typescript-migration-inventory.json
  - test/unit/foundry-cli-spine.test.mts
  - specs/**
lastReviewedAt: 2026-08-25
lastReviewedCommit: febf43c6bf901e1a63aed975a2d8b15bd7889818
lastReviewedNote: "Reviewed for Issue #67 Wave 25 integration: the typed reference/mutation stack and runtime command owners preserve partitions, source proofs, fail-closed write authority, argv/process behavior, immutable capsule seals, unique-root/accepted-diff gates, exact bytes/order, blockers, and native failures under local fixtures."
---

# AGENTS.md - TianGong LCA Data Foundry

This repository is the local control plane for external LCA data import and TIDAS authoring work.

## Mission

Receive external LCA packages or source documents, choose the correct import lane, collect SDK-backed TIDAS contract context, produce evidence-backed TIDAS rows, and keep iterating until the task has current validation, curation, dry-run, and verification evidence.

## Boundaries

- Do not store API keys, tokens, `.env`, database dumps, or full private payload exports in git.
- Runtime state belongs under ignored `.foundry/`.
- Foundry owns task routing, local manifests, import profiles, curation packages, cleanup reports, and policy checks.
- Foundry identity-preflight adapters forward the canonical single lexical weight plus semantic weight; database and Edge repositories own search behavior.
- Foundry does not own TIDAS schemas/YAML, package converters, dataset validators, deterministic QA engines, reusable skills, or remote write semantics.
- `.agents/skills` is the single project-visible skill root. Foundry-owned local skills listed in `.agents/shared-skills.json` are tracked with this repository. Shared/runtime skills listed in the same config may also be installed there, but their directories and `skills-lock.json` stay untracked unless a task explicitly changes to a pinned reproducibility policy.
- External source-evidence and document-extraction skills, including `tiangong-kb-sci-search` and `document-granular-decompose`, are installed or read from the `skills` registry package through `pnpm dlx skills@latest ...` at runtime before use. Do not copy their retrieval or extraction logic into Foundry.
- Raw converted rows may preserve source-language text only, but final import/write-ready rows must include `en` for TIDAS-required multilingual fields. When source data is not English, preserve the original language variant and add an evidence-backed English translation from full task context before write planning.
- Do not implement direct database writes in Foundry.
- Never rewrite `missing_dataset` for a foreign or RLS-hidden `state_code=0` reference to passed, even when another account previously observed that row. Production-test account cases reject every accepted remote difference; ordinary runs may retain only the separately proven root-payload `importTraceSummary.traceHash` normalization.
- Runtime `.env` files may provide account credentials and command defaults, but they do not replace the task-local `source-manifest.json`, `profile-lock.json`, account/write guard evidence, checkpoints, or artifact ledger. Durable import facts must live in the task workspace.
- Credential-scoped commands run through `pnpm account:run -- <profile> -- <executable> [args...]`. The profile must declare the exact expected Supabase project and user; the typed wrapper must obtain and validate a fresh, cache-disabled, intent-bound CLI identity receipt before executing the supplied executable and argv without a shell. There is no authentication bypass.

## Toolchain And TypeScript Migration Contract

- pnpm `11.23.0` is the only package manager for this Node project. The repository has one root `pnpm-workspace.yaml` and one root `pnpm-lock.yaml`; do not add npm, Yarn, a nested lockfile, or a package-manager fallback.
- Node.js 24 is the runtime line. TypeScript `7.0.2` is the only compiler allowed in the direct or recursive dependency graph: do not add TypeScript 5/6 aliases, `@typescript-eslint`, `typescript-eslint`, or a formatter plugin that loads the TypeScript compiler API.
- Oxlint owns linting and Prettier owns formatting. Lint and check commands must be read-only; formatting is an explicit write command.
- The owner CLI is installed as the exact project dependency `@tiangong-lca/cli@0.1.1` and invoked with `pnpm exec tiangong-lca`; Foundry runtime adapters and the account wrapper resolve the same installed package manifest and bin directly. Do not use `dlx` or `@latest` for the owner CLI. The external `skills@latest` package remains intentionally floating and its resolved upstream ref must still be recorded in task evidence.
- The pre-migration inventory at commit `c996633832ea23bf7883c7b219f524bf28e6ce7e` contains 160 tracked JavaScript artifacts: 95 runtime `.mjs` files (59,692 lines), 64 `.mjs` tests (30,273 lines), and one Prettier `.cjs` config, with no TypeScript source. `specs/typescript-migration-inventory.json` is the checked migration ledger; update it when a file crosses the boundary rather than claiming the repository is fully typed.
- Issue #63 establishes the pnpm/TS7 toolchain and the typed spine. Migrate entrypoints, command registry/metadata, argument and runtime I/O contracts, artifact/receipt primitives, then command families and tests. Existing `.mjs` modules remain executable until their typed replacements have equivalent characterization and case coverage; the final migration gate is zero untyped business-runtime modules, not a bulk extension rename.
- The characterized TypeScript leaves include the CLI/data/evidence spine plus canonical-support rewrite and bundle-sampling factories. Focused tests pin mapping lookup and traversal order, scale/pending/Unit Group proof blockers, account-local/stale-version precedence, source-trace cleanup, contact/profile fallbacks, support/reference closure materialization, deterministic sampling/dedupe, invalid inputs, and every static consumer.
- Canonical FP rewrites never convert amounts. When bundle sampling uses `--block-on-unscaled-canonical-support`, a known finite positive non-1 factor emits `canonical_support_amount_scaling_required`; a missing, non-finite, zero, or negative factor emits `canonical_support_amount_scale_unresolved`. Both remain in the scaling JSONL, command report, and process-scope ledger before any later stage can lose the source-unit evidence.
- `import-ledger.ts` is a strict compile-time boundary rather than an extension-only migration: it exports recursive JSON types, dependency interfaces, discriminated closeout/finalize reports, verified/blocked/retry/resume row contracts, manifest/write/report results, and uses `unknown` narrowing plus a generic latest-by-key helper with no explicit `any`. The fixture type contract must compile while every JSONL/hash/order/error behavior test stays byte-identical.
- `foundry-runtime-utils.ts` is the typed shared runtime boundary. It preserves the exact installed `@tiangong-lca/cli@0.1.1` package/bin/schema resolution, environment override command prefix, synchronous text/JSON/JSONL and portable path helpers, task frontmatter/scalar parsing, explicit env-file precedence, stage/blocker envelopes, local CLI subprocess JSON parsing, hashes and deterministic UUIDs. Tests must use an explicit temporary env file and local Node subprocess; they must not call `loadRuntimeEnv()` or read repository credentials.
- `location-quality-utils.ts` is the typed location authoring boundary. It preserves classification/location CLI command strings, installed location schema codes plus fallback/schema-derived target keys, ascending-array/depth-first target order, `#text` leaf paths, exact valid/blocker counters and `location_code_requires_authoring` queue/blocker envelopes. Invalid locations never become write candidates merely because a schema file or nested value is missing.
- `prewrite-cleanup.ts` is the typed deterministic evidence-cleanup boundary. It preserves timestamp recursion, annual-supply sentinel policy, output-only source/final exchange signature proof, import-trace hash summaries, Foundry namespaces and local-locator SHA redaction. Exchange arrays and object insertion order remain part of the proof hash; circular/unserializable trace input throws before source evidence is deleted.
- `workflow-queue-context.ts` is the typed queue-attachment boundary. It preserves manifest task order, exact-identity then id-only fallback, last-row JSONL identity binding, dependency/support traversal order, portable artifact paths and native filesystem/parse/invalid-dependency failures. It only assembles local authoring evidence and cannot grant remote-write authority.
- `import-curation/internal/full-context-proof.ts` is the typed proof-reading boundary used by decision, patch, row-transform and reference-closure contexts. It preserves raw-file SHA binding, embedded-then-shared context order, required-kind/file blocker order, classification schema selection, payload identity last-write behavior, caught proof parse envelopes and native row parse failures. Missing, invalid or hash-drifted proof remains blocking.
- `import-curation/internal/workflow-decision-apply-context.ts` is the typed classification-apply evidence adapter. It preserves snake/camel report aliases, decision and task encounter order, flow-before-process fallback selection, resolved input/output path order, per-identity payload last-write hashes, exact applied-count coercion and native JSON/path failures. It reads evidence only and cannot apply a decision or authorize a write.
- `import-curation/internal/profiles-config.ts` is the typed profile selection boundary. It preserves camel-before-snake normalization where established, snake-first account-local override selection, configured profile key order, requested/default/generic fallback, base-before-extra docs and waivers, dataset-type validation only when adding waivers, raw override evidence and native malformed-config/argument errors. Migration must not change a profile default or waiver scope.
- `import-curation/internal/workflow-patch-collect.ts` is the typed patch admission and local artifact-reading boundary. It preserves validation/blocker and operation order, action-item closure, allowed resolution modes, full-context structured evidence, trace/classification/location checks, JSON/JSONL parse behavior, option alias encounter order, duplicate artifact inputs and source-reference rewrite normalization. Missing or malformed evidence remains blocking or raises the established native error before apply.
- `import-curation/internal/workflow-identity-decision-context.ts` is the typed identity decision/rewrite evidence boundary. It preserves rewrite-file priority, scoped row and exact/bare-id index order, decision aliases and normalized values, authoring-package proof dedupe, input/output payload hashes, multi-report merge/unique order, completed-action predicates and unresolved flow reference keys. Missing or malformed decision evidence cannot be promoted into reuse or completion.
- `import-curation/internal/workflow-patch-evidence-context.ts` is the typed apply/trace evidence projection boundary. It preserves compact evidence fields, exact/bare-id/row indexes and query dedupe, report/evidence blockers, input/output payload hashes, deterministic annual/source cleanup proof, unresolved/source trace blocker order, policy snapshot SHA/order and recursive import-only trace detection. Missing or mismatched evidence remains blocking.
- `import-curation/internal/workflow-row-transform-context.ts` is the typed deterministic row-lineage boundary. It preserves unresolved/canonical/source-contact/cleanup report aliases, trace and blocker order, payload hashes, transform-entry status matrices and fixed aggregation order, exact/content-equivalent artifact matching, multi-pass graph reachability and every patch/identity/classification/externalization chain combination. It proves lineage only and never performs a transform.
- `import-curation/internal/workflow-dry-run-context.ts` is the typed dry-run artifact reader. It preserves schema/curation exact-last and bare-first maps, operation normalization, flow/process/lifecycle/save-draft progress/failure overwrite order, payload aliases and planned-root remote blocker suppression.
- `import-curation/internal/workflow-evidence-scope.ts` is the typed exact-scope admission boundary. It preserves schema, curation, QA, cleanup, patch, collect, dry-run and remote blocker order; deterministic rewrite-chain exceptions require explicit content-bound lineage and never bypass missing evidence.
- `import-curation/internal/workflow-decision-full-context.ts` preserves exact classification/location/identity proof relevance and deterministic row-chain blockers. The characterized `workflow-authoring-tasks.ts` / `workflow-semantic-actions.ts` / `workflow-patch-evidence.ts` SCC must migrate and compile atomically; do not split it back into `.mjs`/`.ts` dual tracks or add an uncharacterized cycle edge. `workflow-identity-preflight.ts` remains fail-closed on missing execution receipts, stale payload hashes, missing source context, invalid policy evidence, and native parse/filesystem errors.
- `authoring-task-workflow.ts` and `authoring-patch-workflow.ts` are reference-preserving typed facades over that SCC. `authoring-packages.ts` owns local package snapshots and task manifests; `patch-collect.ts` owns local patch admission and batch materialization. Snapshot bytes/SHA, task and operation order, blocker classification, and native JSON errors are stable contracts; blocked collection must not create a fresh executable batch.
- `curation-gate-workflow.ts` is a reference-preserving typed aggregate over the existing evidence helpers. `curation-gate.ts` preserves source-row entity order, schema/QA/queue/context blocker order, authoring-package bytes and report aliases; `curation-cleanup.ts` preserves deep-cloned row order, JSONL bytes, annual sentinel completion, trace externalization, source-exchange proof, locator redaction and native errors. These remain local read/transform/report stages and grant no remote-write authority.
- `workflow-reference-closure.ts` preserves reference discovery, planned-self, verified-public, proven, unresolved and foreign partition semantics plus write/reuse decision order. `workflow-source-reference-context.ts` preserves explicit/default rewrite-file priority and public-canonical proof filtering. `mutation-manifest-workflow.ts` remains a live-reference aggregate, while `mutation-manifest.ts` preserves ordered write/reference/blocked artifacts and omits executable write authority whenever any blocker remains.
- `scripts/commands/tasks.ts`, `import-completion.ts`, `commit-handoff.ts`, `identity-decision-task.ts`, and `support-cache.ts` are typed command-owner boundaries. They preserve queue/report ordering, exact report and snapshot bytes, CommandSpec executable/argv plus final-row byte/SHA binding, identity action dedupe, public-support cache ordering, fail-closed blockers, and native errors. Their tests use local filesystem fixtures, injected spies, and stubbed read-only HTTP responses only; migration grants no credential, mutation, review, or publish authority.
- `scripts/commands/cli-wrappers.ts`, `execution-capsule.ts`, and `post-write-closeout.ts` are typed runtime command boundaries. CLI wrappers preserve executable-prefix/argv arrays, inherited environment, stdout/stderr, exit mapping and native spawn errors without shell strings. Capsule admission remains offline, exclusive-write, receipt/hash/seal and no-replay evidence only. Closeout remains read-only and fail-closed on artifact drift, non-unique roots, owner/state/payload mismatch, foreign or hidden missing data, and production-test accepted-diff restrictions.
- Toolchain and migration tests must pass from a clean arbitrary Git worktree after `pnpm install --frozen-lockfile`. They must not depend on the superproject checkout, another worktree's `node_modules`, absolute developer paths, ignored `.foundry` state, or credentials.
- The Golden gate must compare against a non-`HEAD` merge-base with full Git history and a Node-native comparator. Cross-platform fixtures use executable-plus-argv dispatch; a `.js`/`.mjs`/`.cjs` test script must run through `process.execPath`, not OS executable-bit behavior. `.gitattributes` keeps repository text at LF on every runner; only Windows launcher files may opt into CRLF.
- Foundry artifact-to-scope matching and transitional command parsers must accept both path separators. Durable JSON/JSONL writers flush the writable descriptor they opened; POSIX permission-bit assertions are not imposed on Windows filesystems.
- Executable handoffs use `tiangong-foundry.command-spec.v1`: `executable` plus `argv` are authoritative, `display` is derived and never executed, and `sha256` binds the authoritative fields plus exact input artifact facts. Commit and post-write verify specs must both bind the handoff `final_rows_artifact` path, byte count, and SHA-256; runners recheck those bytes before every spawn and always use `shell=false`.

## Default Operating Order

1. Read this file and `WORKFLOW.md`.
2. For source-evidence or shared-skill work, read `docs/runtime-skill-management.md` before evidence retrieval.
3. Run `pnpm doctor` before trusting local Foundry commands.
4. Classify the task as `external-dataset-curated-import` or `source-evidence-dataset-development`.
5. Get the target TIDAS contract context through the published CLI:

```bash
pnpm exec tiangong-lca dataset context-pack \
  --type <process|flow|source|contact|unitgroup|flowproperty|lifecyclemodel> \
  --profile ai-import \
  --out-dir .foundry/workspaces/<task-id>/context/<type> \
  --json
```

6. For packaged datasets, run `node scripts/foundry.mjs dataset-tidas-import`, the thin Foundry adapter over unified Rust `tidas import`; do not replace supported converters with AI. Resolve the executable in this order: `--tidas-bin`, `TIDAS_BIN`, then `tidas` on `PATH`; resolve config from `--tidas-config` then `TIDAS_CONFIG`. Require the stable `tidas.operation-report.v1` contract and any compatible 0.2.x binary instead of pinning one patch. Keep per-process bundle generation enabled so `process-bundles/index.json` and one dependency subdirectory per converted process are available for curation. This bundle index is the generic packaged-import entrypoint for process-level dependency closure; dataset profiles may further require a specific converted bundle index. Bundle `manifest` and `tidas_dir` entries may be relative to the index directory and must be resolved before execution.
7. Before using shared skills, run `pnpm skills:install:shared` when configured runtime skills may be missing or stale, and `pnpm skills:update` for already installed project skills. For source-document fulltext extraction, read the latest remote skill with `pnpm dlx skills@latest use https://github.com/tiangong-ai/skills --skill document-granular-decompose --full-depth`; for SCI literature evidence, read `tiangong-kb-sci-search` the same way. Record the upstream ref from `git ls-remote https://github.com/tiangong-ai/skills.git refs/heads/main`, then capture retrieved document text or papers as evidence candidates before field-level extraction.
8. Run `node scripts/foundry.mjs dataset-tidas-validate` for deterministic schema validation, then `pnpm exec tiangong-lca qa <type>` for deterministic QA on converted or authored rows.
9. Build and drive the entity-level queue with `pnpm exec tiangong-lca dataset curation-queue build/next/verify` so support, flow, and process work has stable task, lock, blocker, closure, and run-plan artifacts owned by the CLI state machine. Parallel workers are allowed only across independent queue locks and only at the configured task parallelism; passed tasks continue, blocked tasks are recorded for later support/database repair, and reruns resume from checkpoints.
10. Run `node scripts/foundry.mjs dataset-curation-gate` with the rows, schema report, QA report, profile, full contract context files, and any generated classification/location authoring queues.
11. Use `$foundry-tidas-import` as the Foundry-local orchestration entrypoint for external package or source-document imports. Use `$foundry-tidas-authoring` only after curation-gate authoring tasks, classification decision tasks, or location decision tasks exist and only to produce structured evidence-backed decisions or patches for curation blockers. Apply classification decisions with `dataset-classification-decisions-apply`, apply location decisions with `dataset-location-decisions-apply`, collect field patches with `dataset-authoring-patch-collect`, then after deterministic apply rerun Rust tidas validation, deterministic CLI QA, and the Foundry curation gate on the final rows before mutation manifest.
12. Run `node scripts/foundry.mjs dataset-curation-cleanup` after source trace has been captured in authoring packages and before remote write planning.
13. Remote commit is policy-gated rather than manually supervised by default. A task may allow automated batch commit for scopes whose finalize report, mutation manifest, commit handoff, and post-write verification all pass; human input is required for policy changes, exceptional waivers, or unresolved reference closure. Missing public canonical unit groups, flow properties, or elementary flows remain blockers unless the frozen import profile explicitly authorizes an account-local `state_code=0` candidate path with owner, unit-scale, closure, audit, and readback gates.
14. Do not treat historical `.foundry` artifacts as proof for a current task.
15. For a new package release over existing owner drafts, use `dataset-incremental-change-set-compose` with a SHA-bound old/candidate/current request and owner-snapshot receipt. It may emit candidate INSERT/UPDATE/NOOP/HOLD artifacts and exactly one terminal conversion event per schema-valid input row. Preservation/noise/array rules must bind the exact entity, pointer, old/candidate/current value hashes, and evidence; update scope must use non-root request pointers. A fresh SELECT-only reconciliation, owner session, independent review, capsule seal, and separately authorized published CLI execution remain mandatory.
16. If the release changes flow identity cardinality or ordered process exchanges, use `dataset-topology-convergence-compose`; never simulate mergers with a global flow-id replacement. The request must bind the complete candidate closure, fresh owner/public/foreign census, audited target classifications, occurrence-keyed language overlays, canonical support allowlists, and fixed CLI fingerprint. F flow creates must close before P process saves; D remains a candidate set until a post-P all-visible zero-inbound proof. Foundry emits no DML and never authorizes public/foreign or support writes.

`annualSupplyOrProductionVolume` is schema-required. If source data does not provide a real annual volume, Foundry must use the deterministic `9999 missing-data-sentinel/year` placeholder, not `common:other` deferral. The sentinel is deliberately non-physical and searchable; database-side curation owns replacing it later.

## Implementation Pattern Requirements

These rules are mandatory for code changes in this repository:

- Read the nearby command/module implementation, tests, and routed workflow docs before editing. New behavior must match the existing Foundry pattern instead of adding one-off scripts, hidden state, or task-specific shortcuts.
- Keep Foundry as a deterministic local control plane: it may index, project, package, checkpoint, summarize blockers, aggregate gates, and call published owner commands; it must not absorb CLI, skill, SDK, converter, database, or Edge ownership.
- Packaged-library imports must make semantic decisions at library scope before projecting to process scopes. Converter-generated classifications are weak hints only; process/flow classification, identity reuse, and canonical support mapping must be backed by AI or human semantic decisions from full row context and then applied through deterministic CLI/Foundry apply reports.
- BAFU-specific deterministic classification heuristics may only prepare authoring tasks, evidence summaries, or non-authoritative candidate rows. They must not write completed process/flow classification decisions unless the row already carries the exact AI/human decision task `authoring_context.context_bundle_sha256` required by the classification apply contract. Name-plan heuristics that write patches must remain source-context/evidence backed; default-only guesses should stay blocked for AI/human authoring.
- TIDAS location-like machine fields must use valid TIDAS/ILCD location category codes. For example, `locationOfOperationSupplyOrProduction.@location`, flow `locationOfSupply`, lifecycle model connection locations, and exchange `location` values must be selected from `tidas_locations_category.json` and pass `pnpm exec tiangong-lca dataset classification audit --type location`; natural-language geography evidence belongs in description fields such as `descriptionOfRestrictions`, source trace, or name-plan mix/location text. AI authoring must inspect schema/YAML/context and fill provable location codes proactively; uncertain locations must go through `dataset-location-decision-task-build` and `dataset-location-decisions-apply`, not ad-hoc patches to code fields.
- For packaged process-bundle imports, process geography and exchange location evidence that identifies a referenced product/waste flow supply location must be projected into the flow authoring evidence before flow curation. Flow `locationOfSupply` saturation must consider `name.mixAndLocationTypes`, process `locationOfOperationSupplyOrProduction.@location`, exchange `location`, and source trace together; provable codes are filled through AI/location decisions before write planning, while conflicts remain blocked.
- Full-context AI completion requires content-field saturation before write planning. For BAFU and any profile that requires full-context AI completion, curation gate must block rows when schema/YAML/source trace/context show provable values for formal TIDAS fields that remain empty, placeholder-like, or underdescribed. Typical saturation targets include process `common:synonyms`, percentage supply/production covered, uncertainty adjustments, flow `locationOfSupply`, flow name quantitative properties, source bibliographic descriptions, and official contact fields. AI should resolve these in one evidence-backed patch pass per authoring package whenever possible.
- Name-plan quality is a hard content-saturation gate. `baseName` must not retain unsplit source full-name fragments such as `production mix`, `production OM`, `at freight ship`, `at plant`, `at sawmill`, braced geography codes, or quantitative qualifiers such as `wet, measured as dry mass`; `treatmentStandardsRoutes` must not contain generated placeholders like `source-described route`; `mixAndLocationTypes` must not be only a bare location code when the source gives an availability/mix/location-type phrase. These rows require AI name-plan patch evidence before write planning.
- For BAFU-style packaged imports, converted placeholder support rows must not leak into write scopes. Process `referenceToDataSource` values that point to compliance/data-format/unspecified placeholders must be rewritten first to an unambiguous true report/publication/data source from the bundle context; only when no source evidence exists may Foundry generate the single database-level BAFU fallback source. Whole-database BAFU imports must reuse one canonical FOEN/BAFU contact, not per-bundle tooling contacts.
- BAFU process context can override a converted package-level true source. If process fields such as `common:generalComment`, technology, or data-source treatment text contain an explicit `Original source` with DOI/title/year/authors that is more specific than the referenced converted source row, materialization must generate or reuse that process-context source, rewrite process `referenceToDataSource`, and omit now-unreferenced converted source rows from support writes.
- Source-only-output process exchanges must not be silently accepted. If the source rows file proves the source process row is also Output-only and the final row preserves the non-flow-reference exchange signature, `dataset-curation-cleanup --source-rows-file` may generate deterministic `tiangongfoundry:sourceExchangeCompleteness` proof; otherwise the row must use AI `source_trace_verified` evidence or remain blocked for exchange repair/review.
- Full-context AI evidence remains valid across deterministic Foundry row transforms only when the transform reports prove the exact input/output rows and payload hashes. Source/contact rewrites, canonical support rewrites, identity reference rewrites, unresolved-exchange externalization, and cleanup must be included in curation-gate and mutation-manifest evidence scope checks. If source/contact rewrites create writable shared contact/source dependencies, prepare support finalize/handoff artifacts separately and keep dependent process/flow/lifecyclemodel scopes blocked until the support rows have been committed through the published CLI and readback-verified.
- Classification and location decisions must bind to the exact decision task context bundle. Use the `classification-decision-task.json` or `location-decision-task.json` `context_bundle.sha256` in `authoring_context.context_bundle_sha256`; do not substitute `shared_context_bundle.sha256`. After deterministic classification/location apply, later AI patch, identity decision, finalize, and commit stages must use the apply output rows as their input rows, and any post-patch process/flow finalize must refresh exact-payload identity preflight before write planning.
- Process/flow identity preflight evidence is exact-payload evidence. `dataset-post-authoring-finalize` must compare current row payload hashes with the identity-preflight index and automatically refresh/merge current-scope preflight rows when the index is stale or incomplete; operators must not bypass this except with an explicit stale-evidence escape hatch for diagnostics.
- Draft import handoff defaults to post-write `state_code=0`, matching the current published CLI save-draft/publish-version behavior. Do not use legacy `state_code=20` expectations unless the CLI/database write contract has explicitly changed and tests/docs are updated in the same change.
- Commit handoff must carry an account/write guard. CLI commands that do not support `--target-user-id` (notably `process save-draft`) must be reported as bound to the current CLI auth session, while post-write verify must still prove the recorded `target_user_id` and root payload/state closure.
- Every new or changed Foundry command must keep its stage contract, command metadata, output artifact list, tests, and governed docs in sync with the runtime behavior.
- Do not retain empty compatibility or deprecation scaffolding. Remove old aliases, unused command categories, and orphaned draft docs once command metadata, tests, docs, and docpact show no remaining consumer.
- Tests must follow the repository test layout in `test/README.md`: pure logic in `test/unit`, command contracts in `test/commands`, multi-command workflows in `test/scenarios`, and shared row/report/command helpers in `test/fixtures`. Do not add numbered regression buckets such as `full-context-gate-07.test.mjs`; name scenario files after the behavior surface they cover.
- Development is test-driven. Start with a failing behavior or real-case characterization, make the smallest typed change, and rerun the focused test before the full `pnpm test` and toolchain gates. A rename-only TypeScript migration without stronger boundary assertions is not complete.
- Every command that can block or defer scopes must write both a complete machine ledger and a reader-facing run report. The ledger is the row-level source of truth; the report must summarize concrete blocker reasons, affected scopes, blocking dependency types or examples, required human action, and the rerun path.
- Incremental imports must not fall back to full owner-draft rewrites. The composer may preserve current values only through entity/path/value/evidence-bound policy, must hold unstable arrays and absent dependencies, must emit no delete or empty CLI contract, and must log every schema-valid input conversion exactly once with input hashes, evidence, outcome, duration, and output row binding.
- `dataset-bundle-sample-rows` row files are authoring inputs, not commit-ready payloads. Its report must make the stage order explicit: raw context/validate/QA/curation gate first, then AI/deterministic apply, then `dataset-curation-cleanup`, final validation, dry-run, commit, and readback. Generated dry-run/commit commands must point to cleanup output rows, not raw materialized rows.
- Batch imports must preserve ready-only execution: blocked scopes are recorded and excluded from write queues, while independent ready scopes continue through dry-run/write/verify when their gates pass.

## Commit Rules

Keep commits small and thematic. Do not commit `.foundry/`, `.env`, logs, source packages under `tmp/`, workspace clones, credentials, or downloaded private payloads.

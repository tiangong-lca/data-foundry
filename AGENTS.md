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
  - scripts/lib/foundry-args.ts
  - scripts/lib/foundry-command-registry.ts
  - scripts/lib/foundry-command-metadata.ts
  - scripts/lib/surface-audit.ts
  - scripts/lib/bundle-row-types.ts
  - scripts/lib/tidas-language-utils.ts
  - scripts/lib/import-curation/internal/hash-utils.ts
  - scripts/lib/import-curation/internal/dataset-types.ts
  - scripts/lib/import-curation/internal/runtime-io.ts
  - specs/typescript-migration-inventory.json
  - test/unit/foundry-cli-spine.test.mts
  - specs/**
lastReviewedAt: 2026-08-25
lastReviewedCommit: 73fd7d051e7a4ee3695252d155f908e9dee6d5db
lastReviewedNote: "Reviewed for Issue #67 Wave 4: high-fan-in runtime I/O is native TS7 with exact synchronous bytes, path normalization, row envelopes, native errors, partial-write, close, and consumer behavior preserved."
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
- The characterized TypeScript leaves include the CLI parser/registry/metadata/surface audit plus bundle row types, TIDAS language enumeration, exact JSON/text hashing, dataset-type constants, and high-fan-in runtime I/O. Focused tests pin parser/help/exit behavior, metadata/report schemas, portable import auditing, root/table/type mappings, language/hash contracts, synchronous file/JSON/JSONL/path behavior, invalid inputs, and every static consumer.
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

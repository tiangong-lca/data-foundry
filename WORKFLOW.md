---
title: Foundry Import Workflow Prompt
docType: prompt
scope: repo
status: active
authoritative: true
owner: tiangong-lca-data-foundry
language: en
whenToUse:
  - when a filesystem Foundry task is converted into agent execution instructions
  - when checking required order for external dataset import or source-evidence authoring tasks
whenToUpdate:
  - when Foundry task order, gate sequence, runtime skill policy, or lane definitions change
checkPaths:
  - WORKFLOW.md
  - AGENTS.md
  - README.md
  - docs/architecture.md
  - docs/foundry-ai-navigation.md
  - docs/foundry-command-surface.md
  - docs/runtime-skill-management.md
  - docs/foundry-task-contracts.md
  - docs/incremental-change-set-contract.md
  - specs/automated-lca-capability-registry.json
  - specs/capability-ownership-rules.json
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
  - test/unit/foundry-cli-spine.test.mts
  - test/unit/foundry-command-metadata.test.mts
  - test/unit/surface-audit-typescript.test.mts
  - test/unit/bundle-dataset-types.test.mts
  - test/unit/hash-utils.test.mts
  - test/unit/tidas-language-utils.test.mjs
  - test/unit/runtime-io.test.mts
  - test/unit/artifact-inputs.test.mts
  - test/unit/context-inputs.test.mts
  - test/unit/dataset-payload.test.mts
  - test/unit/trace-summary.test.mts
  - test/unit/canonical-support-mappings.test.mts
  - test/unit/source-semantics-contract.test.mts
  - test/unit/trace-coverage.test.mts
  - test/unit/tidas-row-utils.test.mts
  - test/unit/evidence-decision-leaves.test.mts
  - test/unit/evidence-leaf-migration.test.mts
  - test/unit/bafu-family-signatures-contract.test.mts
  - test/unit/import-ledger-contract.test.mts
  - test/unit/wave8-large-leaf-migration.test.mts
  - test/unit/canonical-support-rewrites-contract.test.mts
  - test/unit/bundle-sample-utils-contract.test.mts
  - test/unit/wave9-canonical-bundle-migration.test.mts
  - test/unit/import-ledger-type-contract.test.mts
  - test/unit/fixture-helpers-contract.test.mts
  - test/README.md
lastReviewedAt: 2026-08-25
lastReviewedCommit: dc43513aff4191082c5290d9b8bc726bdce14cb1
lastReviewedNote: "Reviewed for Issue #67 follow-up: strict ledger state types and typed shared fixtures reinforce characterization-first JSONL/report and test-harness contracts without changing workflow order."
tracker:
  kind: filesystem
  inbox: tasks/inbox
  active: tasks/active
  done: tasks/done
workspace:
  root: .foundry/workspaces
policy:
  default_write_mode: dry-run
  require_write_policy_for_remote_commit: true
  allow_profile_gated_batch_commit: true
  require_human_for_policy_or_exceptional_waiver: true
  require_contract_context_before_ai: true
  require_schema_gate: true
  require_qa_gate: true
  require_location_code_gate: true
  require_curation_gate: true
  require_cleanup_before_remote_write: true
  require_dry_run_before_remote_write: true
  required_multilang_english_before_write: true
  preserve_source_language_variants: true
---

You are working on a TianGong LCA data import task.

Task ID: {{ issue.identifier }} Title: {{ issue.title }}

Body: {{ issue.description }}

## Classify

Choose one lane:

- `external-dataset-curated-import`: packaged LCA data supported by unified Rust `tidas import`.
- `source-evidence-dataset-development`: PDF, Excel, screenshot, web page, markdown, image, or free text that must be authored into TIDAS candidate rows.

## Toolchain Preflight

Use Node.js 24 and the repository-pinned `pnpm@11.23.0`. TypeScript `7.0.2` is the sole compiler, Oxlint is the linter, and Prettier is the formatter. Do not create npm/Yarn lockfiles, TypeScript 5/6 aliases, or compiler-API lint/format bridges.

Issue #63 is the typed-spine foundation, not a declaration that the 160 tracked JavaScript artifacts are already TypeScript. Keep `specs/typescript-migration-inventory.json` synchronized, migrate one characterized boundary or command family at a time, and drive each slice with focused tests plus a realistic case. Toolchain changes must also pass from a clean arbitrary worktree after `pnpm install --frozen-lockfile`, without credentials, ignored `.foundry` artifacts, a sibling checkout, or another worktree's dependencies.

`pnpm golden:diff` compares the current worktree with a non-`HEAD` merge-base using Node-native file comparison; CI must fetch full history. Test-only `.js`/`.mjs`/`.cjs` executable overrides are dispatched as `process.execPath + script path`, never as platform-native binaries. Keep the root `.gitattributes` LF policy intact so Windows, macOS, and Linux format checks consume identical text.

Do not parse or execute rendered command strings. `tiangong-foundry.command-spec.v1` makes `executable` plus `argv` authoritative and keeps `display` reader-only. Its SHA-256 binds the authoritative command and exact artifact facts; commit and verify both bind the final rows path, bytes, and SHA-256, and runners reject same-path drift before `shell=false` spawn. Artifact-to-scope matching still normalizes platform separators. Durable writers fsync writable file descriptors, not read-only reopened handles.

Use the exact installed project dependency as `pnpm exec tiangong-lca ...`. Foundry runtime adapters resolve that same `@tiangong-lca/cli@0.1.1` manifest and bin directly; only the external `skills@latest` source-evidence resolver remains intentionally floating, with the resolved ref recorded in task artifacts.

Credential-scoped operator commands must run through `pnpm account:run -- <profile> -- <executable> [args...]`. The ignored profile must include `FOUNDRY_EXPECTED_PROJECT_REF` and `FOUNDRY_EXPECTED_USER_ID`. Before the requested argv is executed, the wrapper obtains a fresh `auth identity-receipt` from the installed CLI with both expectations, requires an intent-bound cache-disabled forced signin, and uses a restricted child environment. Missing expectations, thread-guard drift, stale or partial receipts, and the retired `--no-auth-check` path all fail before the requested command starts.

## Required Order

1. Create or reuse `.foundry/workspaces/<task-id>/`.
2. Freeze the source package or source document manifest.
3. Fetch SDK-backed contract context before AI repair or authoring:

```bash
pnpm exec tiangong-lca dataset context-pack \
  --type <process|flow|source|contact|lifecyclemodel> \
  --profile ai-import \
  --out-dir .foundry/workspaces/<task-id>/context/<type> \
  --json
```

4. For packaged imports, convert with `node scripts/foundry.mjs dataset-tidas-import --input <source> --output <conversion-dir>`. The adapter delegates format detection/import/conversion to Rust `tidas`, accepts compatible 0.2.x binaries, and enforces the stable operation report and exit contract. Keep the generated `process-bundles/index.json`; this is the generic package-level process-closure manifest used to build or shard downstream entity queues. Bundle `manifest` and `tidas_dir` entries may be relative to the bundle index directory and must be resolved before scope execution.
5. For source-document authoring, extract source evidence first and keep unresolved assumptions explicit. For document fulltext extraction, resolve the latest `document-granular-decompose` skill from `https://github.com/tiangong-ai/skills` with `pnpm dlx skills@latest use https://github.com/tiangong-ai/skills --skill document-granular-decompose --full-depth` before parsing the source file. For SCI paper or scientific journal evidence, resolve the latest `tiangong-kb-sci-search` skill from the same repository before retrieval. Then write `.foundry/workspaces/<task-id>/runtime-skills/runtime-skill-resolution.json` with the `pnpm dlx skills` command, the `git ls-remote https://github.com/tiangong-ai/skills.git refs/heads/main` commit, skill name, timestamp, and evidence channel. Runtime-installed shared skills may live under `.agents/skills`, but their directories and `skills-lock.json` stay untracked unless the task explicitly chooses pinned reproducibility.
6. Validate generated rows with `node scripts/foundry.mjs dataset-tidas-validate --rows-file <rows> --type <type> --out-dir <schema-dir>`.
7. Run deterministic QA with `pnpm exec tiangong-lca qa <type>`.
8. Build the entity-level import curation queue:

```bash
pnpm exec tiangong-lca dataset curation-queue build \
  --processes <process-rows.jsonl> \
  --flows <flow-rows.jsonl> \
  --support <source-or-contact-rows.jsonl> \
  --external-flow-ref <external-flow-ref-rows.jsonl> \
  --out-dir .foundry/workspaces/<task-id>/curation-queue
```

The queue state machine belongs to `pnpm exec tiangong-lca dataset curation-queue build/next/verify`. It writes task, lock, blocker, closure, input, run-plan, and queue status artifacts; it does not run AI or write the database.

After build, workers should call `pnpm exec tiangong-lca dataset curation-queue next --queue-dir .foundry/workspaces/<task-id>/curation-queue --json` and execute only the returned task. Before write planning, call `pnpm exec tiangong-lca dataset curation-queue verify --queue-dir .foundry/workspaces/<task-id>/curation-queue --type <support|flow|process> --json`.

Batch runners may execute multiple ready tasks in parallel only when queue locks and `depends_on` checkpoints prove independence. The task workspace must record configured `max_parallelism` and the runner identity for each claimed task. A blocked task must write its blocker artifact and release unrelated work; it must not stop independent ready tasks from completing, committing, and passing readback when their exact scopes have no blockers. Any workflow stage that defers scopes must write a complete `blocked-scope-ledger.jsonl` plus a reader-facing `blocked-scope-report.json` that names the concrete reasons, affected process scopes, blocking dependency types or examples, required human action, and rerun command.

Before AI curation for process/flow imports, audit and then run the generated identity-preflight request index. The audit checks the exact `flow_hybrid_search` / `process_hybrid_search` Edge request body before any remote call: Edge only parses `query`, `filter`/`filter_condition`, match/page options, and `data_source`, so complete identity and source evidence must be present in the compact fielded `query`. Foundry may include `remote_candidate_search.profile_hints` in the request for source-derived facts such as elementary categories, flow property, reference unit, geography, reference flow names, technology, and system boundary; the CLI uses those hints only for local target profiling and candidate scoring, not as Edge Function request fields.

The remote search contract has one lexical branch over database-owned `extracted_md`. Foundry therefore emits one `lexical_weight` (default `0.8`) plus `semantic_weight` (default `0.2`) and forwards no second lexical control.

```bash
node scripts/foundry.mjs dataset-identity-preflight-query-audit \
  --index .foundry/workspaces/<task-id>/identity-preflight-requests/identity-preflight-requests.jsonl \
  --out-dir .foundry/workspaces/<task-id>/identity-preflight-query-audit
node scripts/foundry.mjs dataset-identity-preflight-run \
  --index .foundry/workspaces/<task-id>/identity-preflight-requests/identity-preflight-requests.jsonl \
  --out-dir .foundry/workspaces/<task-id>/identity-preflight-run \
  --only-pending
```

If a later AI patch or deterministic cleanup changes the current process/flow rows, rebuild and rerun identity preflight for the exact patched rows. Pass the original full index as `--source-index` so refreshed requests inherit the original `source_file` trace context; then merge that refreshed current-scope index back into the original full index so dependency evidence is preserved:

```bash
node scripts/foundry.mjs dataset-identity-preflight-requests-build \
  --type process \
  --rows-file .foundry/workspaces/<task-id>/rows/processes.patched.jsonl \
  --source-index .foundry/workspaces/<task-id>/identity-preflight-requests/identity-preflight-requests.jsonl \
  --out-dir .foundry/workspaces/<task-id>/identity-preflight-refresh
node scripts/foundry.mjs dataset-identity-preflight-query-audit \
  --index .foundry/workspaces/<task-id>/identity-preflight-refresh/identity-preflight-requests/identity-preflight-requests.jsonl \
  --out-dir .foundry/workspaces/<task-id>/identity-preflight-refresh-query-audit
node scripts/foundry.mjs dataset-identity-preflight-run \
  --index .foundry/workspaces/<task-id>/identity-preflight-refresh/identity-preflight-requests/identity-preflight-requests.jsonl \
  --out-dir .foundry/workspaces/<task-id>/identity-preflight-refresh-run
node scripts/foundry.mjs dataset-identity-preflight-index-merge \
  --base-index .foundry/workspaces/<task-id>/identity-preflight-requests/identity-preflight-requests.jsonl \
  --update-index .foundry/workspaces/<task-id>/identity-preflight-refresh/identity-preflight-requests/identity-preflight-requests.jsonl \
  --out-dir .foundry/workspaces/<task-id>/identity-preflight-index-merge
```

9. Run Foundry curation:

```bash
node scripts/foundry.mjs dataset-curation-gate \
  --type <process|flow|lifecyclemodel> \
  --rows-file <rows.jsonl> \
  --schema-report <dataset-validate-report.json> \
  --qa-report <qa-report.json> \
  --schema-file <context/schema.json> \
  --yaml-file <context/methodology.yaml> \
  --ruleset-file <context/runtime-ruleset.json> \
  --queue-dir .foundry/workspaces/<task-id>/curation-queue \
  --classification-queue .foundry/workspaces/<task-id>/classification-authoring-queue.jsonl \
  --location-queue .foundry/workspaces/<task-id>/location-authoring-queue.jsonl \
  --identity-preflight-index .foundry/workspaces/<task-id>/identity-preflight-requests/identity-preflight-requests.jsonl \
  --require-identity-preflight \
  --profile <generic|bafu|custom-profile-id>
```

The classification and location queue files may be empty, but when they exist they must be passed through so taxonomy and `tidas_locations_category.json` blockers enter the AI authoring package. For process/flow imports, the identity-preflight index must also be passed through; full-context process/flow profiles automatically block AI authoring on missing or pending current/dependency identity results until the runner has produced evidence. Foundry also attaches the bundled TIDAS category schemas and location schema as full-text contract context so AI decisions can cite the taxonomy it used. Decision task build must return a ready status before AI authoring; `blocked_missing_full_context` means schema, methodology YAML, runtime ruleset, category/location schema, identity-preflight evidence, authoring package, or converted row payload context is incomplete and must be fixed first. The same full-context rule applies to non-decision authoring tasks built from curation-gate packages; a `blocked_missing_full_context` task manifest is not valid AI input.

Before choosing one of the AI authoring paths below, run `node scripts/foundry.mjs dataset-authoring-plan --curation-gate-report <dataset-curation-gate-report.json>`. The plan is read-only: it aggregates identity/classification/location/field-patch readiness, points to missing task builds or deterministic apply commands, emits `rows_chain` for the required classification/location/patch/identity row lineage, and prevents skipping from a blocked curation gate directly to write planning. When `rows_chain` is present, run chained commands in order and rerun the plan after each deterministic apply so downstream evidence is bound to the current rows file.

10. If curation is blocked on identity manual-review action items, Codex/skills should output structured identity decisions only from a ready `identity-decision-task.json`, preserve each template decision's `decision_status=completed`, `authoring_package`, `authoring_package_sha256`, `used_context_kinds`, structured `evidence`, and `closes_action_items`, then apply them through `node scripts/foundry.mjs dataset-identity-decisions-apply` with the matching `--authoring-package-dir` whenever the package directory is available. `reuse_existing_reference` must include canonical id/version. Product/process rows may choose `create_new` only with full candidate evidence. Elementary flow rows must choose `reuse_existing_reference` or `block_unresolved` by default; they may choose `create_new` only when the frozen profile explicitly authorizes account-local elementary candidates and the decision binds same-owner `state_code=0`, full identity evidence, private closure, and exclusion from the global LCIA cache. Do not patch row JSON directly for identity decisions.
11. If curation is blocked on classification queue rows, Codex/skills should output structured classification decisions only from a ready `classification-decision-task.json`, preserve each template decision's `decision_status=completed` and `authoring_context.context_bundle_sha256`, then apply them through `node scripts/foundry.mjs dataset-classification-decisions-apply --decision-task <classification-decision-task.json>`. Large queues may be split with `--dataset-type`, `--bundle-id`/`--process-id`, `--limit`, `--offset`, and `--chunk-label`; use one `--shared-context-cache-dir` across chunks so repeated schema/YAML/category/location context is read from one stable bundle, and when decisions from multiple chunk tasks are applied to the source queue, pass every task with repeated `--decision-task`. Do not patch classification JSON directly when the classification decision workflow is available.
12. If curation is blocked on location queue rows, Codex/skills should output structured location decisions only from a ready `location-decision-task.json`, preserve each template decision's `decision_status=completed` and `authoring_context.context_bundle_sha256`, then apply them through `node scripts/foundry.mjs dataset-location-decisions-apply --decision-task <location-decision-task.json>`. Large queues may be split with the same chunk flags and the same `--shared-context-cache-dir`; when decisions from multiple chunk tasks are applied to the source queue, pass every task with repeated `--decision-task`. Do not patch location fields directly when the location decision workflow is available.
13. For non-identity/non-classification/non-location curation blockers, first build explicit authoring tasks with `dataset-authoring-task-build`. Use the same `--shared-context-cache-dir` as decision tasks when rebuilding or splitting work so repeated schema/YAML/ruleset/category/location context is read from one stable bundle. The manifest must be `ready_for_ai_authoring_batch`; if it is `blocked_missing_full_context`, fix the missing schema/YAML/ruleset/category/location/source-row context before Codex/skills write patches. AI patch files must declare `patch_status=completed`; `dataset-authoring-patch-collect` rechecks full-context readiness from the manifest/tasks, verifies any referenced shared-context bundle still exists with the recorded stable `sha256`, and blocks stale, draft, incomplete, or non-completed task artifacts. Do not write the database directly from AI output.
14. Apply identity decisions, classification decisions, location decisions, patches, or build plans through deterministic CLI/SDK paths, then rerun schema, QA, queue build when references changed, and curation.
15. Run cleanup after source trace has been captured in authoring packages:

```bash
node scripts/foundry.mjs dataset-curation-cleanup \
  --type <process|flow|lifecyclemodel> \
  --rows-file <rows.jsonl> \
  --source-rows-file <original-source-rows.jsonl> \
  --out-file <cleaned-rows.jsonl>
```

Use `--source-rows-file` for process scopes when the import source row may itself be output-only. Cleanup may generate deterministic `tiangongfoundry:sourceExchangeCompleteness` proof only if the source row is output-only and the final row preserves the non-flow-reference exchange signature.

16. Revalidate cleaned rows before dry-run/publish planning. For every final write scope, including mixed support rows and process/flow/lifecyclemodel rows, run the post-authoring finalizer so `pnpm exec tiangong-lca dataset classification audit --type location` checks schema-derived location-code fields against `tidas_locations_category.json`; `counts.location_audit_blockers` must be `0`.
17. The post-authoring mutation manifest must prove reference closure before commit handoff. For mutually-referencing writable support records, use a mixed `--type support` scope containing only contact/source rows, so the support closure is proven inside one exact scope and committed through `pnpm exec tiangong-lca dataset save-draft --type auto`. For profile-generated source/contact dependencies, `dataset-post-authoring-finalize --finalize-source-contact-support` may prepare the shared contact/source support finalize and commit-handoff artifacts, but dependent process/flow/lifecyclemodel scopes still wait until that support row is actually committed and verified. Flow Properties and Unit Groups reuse `specs/canonical-support/flow-properties-unit-groups.json` public rows by default. Bundle materialization must pass `--block-on-unscaled-canonical-support` when the task requires strict scale proof: known finite positive non-1 factors remain `canonical_support_amount_scaling_required`, while missing, non-finite, zero, or negative factors remain `canonical_support_amount_scale_unresolved`; both must survive in scaling JSONL, the command report, and process-scope ledger before a canonical UUID rewrite can erase source-unit evidence. If the frozen profile explicitly authorizes account-local support and no acceptable public row exists, use a separate candidate registry and only same-owner `state_code=0` FP/UG references through the profile-specific guarded CLI/database path; never insert those candidates into the public cache or mix them with public targets in one alias batch. Source rows in the support scope must be true reports, publications, or traceable source records; `ILCD format`, `Not specified`, data-format, and compliance-system identities are blocked as source rows and should remain only as canonical reference rewrites/provenance. True source rows must not keep empty or type-only descriptions such as `Report`; Foundry repairs those from citation/name evidence during bundle materialization. Missing `annualSupplyOrProductionVolume` source evidence is not deferred to `common:other`; Foundry writes `9999 missing-data-sentinel/year`, an intentionally non-physical searchable sentinel that later database-side curation owns replacing. If final rows contain `common:other.tiangongfoundry:*` trace, the manifest must prove same-row AI patch evidence created or accepted that trace, or a matching deterministic cleanup proof for source-only-output exchange completeness; identity/classification/location decisions alone cannot authorize trace入库. References outside the exact write scope must either already exist in the remote account/public library as proven by `dataset verify-remote`, or their writable rows must be written in an earlier scope and verified before the dependent process/flow/lifecyclemodel scope can proceed. Any blocked finalize must write an import ledger under `--ledger-dir` or the finalize output directory, including `blocked.scopes.human-review.jsonl` plus categorized `blocked.dependencies.*.jsonl` rows with required human action and rerun path.
18. Remote writes require explicit task write policy, dry-run evidence, location-code audit evidence, reference-closure evidence, verification evidence, and a ready commit handoff. Human approval is required for policy changes and exceptional waivers, not for every gate-passing batch when the task policy allows automated commit.
19. When restarting after a successful post-authoring finalize, reuse existing finalize artifacts only if the report is current for the exact rows file, the mutation manifest and full-context proof still pass, and a fresh `dataset-commit-handoff-plan` is generated. Foundry does not own direct database mutation; the handoff plan exposes the CLI commands that a CLI/skill maintenance or publish workflow must execute under the approved account context, followed by post-write verify, closeout, and task completion reporting.
20. After `dataset-commit-handoff-plan` has proven every final-row `common:other.tiangongfoundry:unresolvedTrace` / `sourceExchangeCompleteness` entry matches the retained trace queue JSONL, the batch runner may execute the generated commit CommandSpec for that exact scope when the task write policy permits automated commit. Then execute the post-write verify CommandSpec and run `dataset-post-write-closeout` for each committed write scope; both specs and both reports must bind the same final rows bytes from handoff, profile-required full schema/YAML/context AI proof and evidence counts must still be attached, closeout must recheck the same trace queue coverage for later database-side curation, and successful closeout must append `ok.*.verified.jsonl` import-ledger rows. A foreign or RLS-hidden `state_code=0` reference reported as `missing_dataset` stays blocked; no trusted-reference allowlist or cross-account observation may rewrite it to passed. Production-test account cases accept no normalized difference.
21. A task with committed scopes is done only after `dataset-import-completion-report` aggregates every required closeout, rechecks profile-required full-context proof for every scope, and reports `completed`. For resumable batch work, also run `dataset-import-ledger-report --ledger-dir <task-import-ledger-dir>` so `resume.skipped-verified.jsonl` and `resume.plan.jsonl` separate already imported rows from human-review blockers before the next rerun.
22. Move `tasks/active/<task>.md` to `tasks/done/` only through `task-complete --completion-report <dataset-import-completion-report.json>`, so the task id, closeout scope, and profile-required full schema/YAML/context AI completion proof are checked before the file state changes.

Production case TDD is deliberately separate from the numbered import lane and ordinary `pnpm test`. `pnpm case:production:contact-draft` may use every capability granted to the designated test account only within that account's isolated, unreviewed, unpublished data. It may read public production data for search/readback quality, but it must not mutate public, foreign, or shared rows and must not invoke review or publish transitions. The case requires POSIX private storage, an owner-private env file, a repository-local git-ignored per-run output with no symlink parent, a fresh intent-bound identity receipt before production reads, and another before its single new contact owner-draft mutation. Windows fails closed until user-exclusive ACL verification exists. A missing/malformed/stale receipt, nonzero child exit, secret-bearing artifact, runtime/artifact hash drift, foreign accepted difference, ambiguous mutation, or non-unique readback stops the case without an automatic write retry.

Rows remain source-language before import. Bilingual completion is a separate post-import task only when requested.

## Incremental Release Lane

When the task imports a newer release over existing owner-draft rows, do not restart the whole authoring/write path by default:

1. Project the old release and new release into one SHA-bound comparison row per canonical target; keep UUID/crosswalk decisions outside the composer and auditable.
2. Capture one SELECT-only owner snapshot plus receipt and bind project, owner, `state_code=0`, exact target set, non-root field allowlists, query/deployment fingerprints, CLI version, and evidence-bound policy hashes in `foundry-incremental-change-set-request.v1`.
3. Run `dataset-incremental-change-set-compose` once into a fresh directory. Review its INSERT/UPDATE/NOOP/HOLD algebra and verify that conversion-event rows equal schema-valid input rows, event/decision/output hashes and chain pass, all dispatch counts are zero, absent dependencies are held, and every emitted action dependency points backward.
4. Keep ordinary conflicts or missing dependencies on HOLD while independent actions remain eligible. Any owner/state/scope/hash trust-boundary finding rejects activation globally.
5. Perform a fresh SELECT-only reconciliation and fresh owner session, obtain independent review, and admit the exact manifest/rows/contract with `execution-capsule-admit`.
6. Only after separate execution authorization, pass `dataset-save-draft-input.jsonl` and `dataset-save-draft-execution-contract.json` to the published CLI. The CLI owns transactions, attempt records, no-replay recovery, and exact owner readback.

Every valid comparison row must have one terminal event even when its outcome is NOOP or HOLD. A full rewrite is not a recovery mechanism for incremental conflicts.

## Topology Convergence Lane

Use this lane when the candidate release merges, splits, adds, or retires flow identities:

1. Bind candidate flow/process file indexes, audited target classifications, exact flow mappings, approved language overlays, and canonical support identities to the candidate package SHA.
2. Capture one fresh owner-session SELECT-only census for all owner processes/flows plus visible public and foreign target flows. Bind the census, zero guards, deployment/RPC/query fingerprints, and fixed published CLI fingerprint in the admission receipt.
3. Run `dataset-topology-convergence-compose` into a fresh directory. Require exact candidate-flow/process/exchange and change-count algebra, complete target reference closure, independent audit PASS, and P0=P1=0.
4. Admit and execute F first. Exact-read the complete target flow closure before admitting P. P reconstructs exchanges only by `(process UUID, source exchange number, occurrence)` while preserving current non-exchange content and approved languages.
5. After P exact readback, recapture all visible process inbound references. Convert only unique owner/state-zero, zero-inbound D candidates into a delete-only maintenance plan. Public, foreign, nonzero, or unknown targets never enter that plan.
6. Seal every conversion/no-write/execution/readback event and final full-graph audit. Foundry stays offline; protected transactions, attempt consumption, ambiguity recovery, and no-replay behavior belong to the fixed CLI.

The complete contract is `docs/topology-convergence-contract.md`.

## Maintainer Validation

Foundry tests are organized by behavior layer, not by historical incident number:

- `test/unit/` for pure metadata and contract helpers.
- `test/commands/` for one-command artifact and report contracts.
- `test/scenarios/` for multi-command import workflows and gate behavior.
- `test/fixtures/` for shared Foundry row, report, command, and workflow-specific fixture helpers split by behavior surface.

Use `pnpm test` for the full suite, `pnpm test:unit`, `pnpm test:commands`, and `pnpm test:scenarios` for targeted behavior, and `pnpm test:toolchain` for the pnpm/TS7 contract. New tests should be named after the behavior they protect rather than `full-context-gate-N`. Each typed migration slice starts with a failing characterization or real case, then passes the focused test, full suite, and clean arbitrary-worktree gate.

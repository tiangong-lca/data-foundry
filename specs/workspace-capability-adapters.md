# Workspace Capability Adapters

Foundry adapters are routing records. They identify which shared command or skill should run and what artifacts must exist afterward. They do not own conversion, schema, AI prompt, QA, or database write business logic.

The machine-readable registry is `specs/automated-lca-capability-registry.json`.

The local `$foundry-tidas-import` skill is the Foundry orchestration entrypoint for these routes. It calls Rust `tidas` for deterministic import/conversion/schema validation, shared CLI commands for context/QA/curation/remote operations, and `$foundry-tidas-authoring` for AI decisions instead of copying owner logic into Foundry.

## Core Classes

| Class | Purpose |
| --- | --- |
| `import-orchestration` | Foundry-local skill entrypoint that orders shared CLI, curation, AI patch, dry-run, commit, and readback steps without owning database or converter internals. |
| `tidas-contract-context` | Fetch SDK-backed schema, methodology YAML, runtime ruleset, and AI context artifacts. |
| `external-lca-package-conversion` | Convert supported packaged LCA data through unified Rust `tidas import`. |
| `source-document-authoring` | Extract source documents and prepare target context packs for AI authoring. |
| `source-evidence-review` | Plan and record public/source evidence for field-level facts. |
| `source-evidence-runtime-skill` | Resolve floating external source-evidence skills, such as document fulltext extraction and SCI literature retrieval, as ignored runtime installs/read prompts plus task-level resolution records. |
| `schema-gate` | Validate generated TIDAS rows through Rust `tidas validate` and retain official batch evidence plus the Foundry compatibility report. |
| `process-qa` / `flow-qa` / `lifecyclemodel-qa` | Run target-type deterministic QA gates. |
| `dataset-curation` | Build entity-level import queues, build profile-aware AI authoring packages from rows/schema/QA/context, generate Codex/skill authoring tasks, collect AI patch outputs, and deterministically apply AI-authored structured patches before cleanup/revalidation. |
| `reference-closure` | Refresh or verify local references before publish preparation. |
| `publish-prep` | Prepare exact-scope publish/import bundles, mutation manifests, commit handoff, and closeout evidence; commit execution remains CLI-owned and task write-policy gated. |
| `remote-verification` | Read back remote rows when a task explicitly reaches that stage. |

## Route Examples

```bash
pnpm capabilities:list -- --class tidas-contract-context
pnpm capabilities:list -- --class external-lca-package-conversion
pnpm capabilities:list -- --class source-document-authoring
pnpm capabilities:list -- --class source-evidence-runtime-skill
pnpm task:route -- --kind external-dataset-curated-import --dataset-type process --required-gates contract,schema,qa,curation
node scripts/foundry.ts tidas-handshake
node scripts/foundry.ts dataset-tidas-import --input ./source-package --output ./conversion
node scripts/foundry.ts dataset-tidas-validate --rows-file ./rows/processes.jsonl --type process --out-dir ./schema
pnpm dlx skills@latest use https://github.com/tiangong-ai/skills --skill document-granular-decompose --full-depth
pnpm dlx skills@latest use https://github.com/tiangong-ai/skills --skill tiangong-kb-sci-search --full-depth
pnpm exec tiangong-lca dataset curation-queue build --processes ./rows/processes.jsonl --flows ./rows/flows.jsonl --support ./rows/sources.jsonl --out-dir ./curation-queue
pnpm exec tiangong-lca dataset curation-queue next --queue-dir ./curation-queue --json
pnpm exec tiangong-lca dataset curation-queue verify --queue-dir ./curation-queue --type process --json
node scripts/foundry.ts dataset-curation-gate --type process --rows-file ./rows/processes.jsonl --schema-report ./schema/report.json --qa-report ./qa/process-qa-report.json --schema-file ./contract/schema.json --yaml-file ./contract/methodology.yaml --profile bafu --queue-dir ./curation-queue --classification-queue ./classification-authoring-queue.jsonl --location-queue ./location-authoring-queue.jsonl
node scripts/foundry.ts dataset-authoring-task-build --curation-gate-report ./curation-gate/dataset-curation-gate-report.json --out-dir ./authoring-tasks
node scripts/foundry.ts dataset-authoring-patch-collect --task-manifest ./authoring-tasks/authoring-task-manifest.json
node scripts/foundry.ts dataset-patch-apply --input ./rows/processes.jsonl --patch ./authoring-tasks/ai-patches.batch.json --out ./rows/processes.patched.jsonl --out-dir ./patch-apply --authoring-package-dir ./curation-gate/ai-authoring-packages --require-authoring-package --require-action-item-closure
node scripts/foundry.ts dataset-post-authoring-finalize --type <process|flow|lifecyclemodel> --rows-file ./rows/<type>.patched.jsonl --out-dir ./post-authoring-finalize --profile bafu --queue-dir ./curation-queue --classification-queue ./classification-authoring-queue.jsonl --location-queue ./location-authoring-queue.jsonl --schema-file ./contract/schema.json --yaml-file ./contract/methodology.yaml --ruleset-file ./contract/runtime-ruleset.json --classification-decision-apply-report ./classification-decision-apply/classification-decisions-apply-report.json --location-decision-apply-report ./location-decision-apply/location-decisions-apply-report.json --patch-collect-report ./authoring-tasks/authoring-patch-collect-report.json --require-patch-collect-report --patch-apply-report ./patch-apply/outputs/dataset-patch-apply-report.json --target-user-id <uuid> --verify-remote
node scripts/foundry.ts dataset-commit-handoff-plan --finalize-report ./post-authoring-finalize/dataset-post-authoring-finalize-report.json --state-code <expected-state-code>
node scripts/foundry.ts dataset-post-write-closeout --handoff-plan ./post-authoring-finalize/commit-handoff/dataset-commit-handoff-plan.json --commit-report ./post-authoring-finalize/commit/<type-command>/<summary-or-report>.json --post-write-verify-report ./post-authoring-finalize/commit-handoff/post-write-verify/outputs/remote-verification-report.json --out-dir ./post-write-closeout
node scripts/foundry.ts dataset-import-completion-report --task-dir . --require-type process --out-dir ./import-completion
pnpm task:route -- --kind source-evidence-dataset-development --dataset-type process --required-gates context,schema,qa,curation
```

Missing classes must be resolved in the owning project. Add Foundry-local code only for task routing, manifests, reports, and policy checks.

Runtime source-evidence skills are resolved through `pnpm dlx skills@latest` and treated as external evidence channels. Foundry may install them under `.agents/skills` for local agent access and record their resolution and outputs, but should not commit their `SKILL.md`, scripts, or lockfile unless a task explicitly chooses pinned reproducibility over latest-source behavior.

Import lanes may keep raw converted rows in the source language, but final import/write-ready rows must include English for TIDAS-required multilingual fields while preserving non-English source-language variants. Use contract context, schema, QA, curation, cleanup, reference, dry-run, and verification gates to prove that required translations were completed from full task context before write planning.

For mutually-referencing contact/source rows, use `dataset-post-authoring-finalize --type support` as the mixed support-scope prewrite entrypoint. Flow properties and unit groups are reference-only support choices unless a separate public-canonical governance task has already created them. The finalizer wraps cleanup, Rust tidas validation through the official batch protocol, location audit, generic `dataset save-draft --type auto --dry-run`, mutation manifest generation, commit handoff, and post-write closeout compatibility into one exact scope. For process, flow, and lifecyclemodel rows, `dataset-post-authoring-finalize` remains the preferred post-AI prewrite entrypoint. It wraps cleanup, Rust tidas validation, deterministic CLI QA, post-authoring curation gate, type-specific dry-run (`process save-draft --dry-run`, `flow publish-version --dry-run`, or `lifecyclemodel save-draft --dry-run`), optional `dataset verify-remote`, and mutation manifest generation into one exact-scope report. The mutation manifest is also the prewrite reference-closure gate: referenced rows outside the exact write scope must be proven by a passed remote verification report after support rows exist remotely, otherwise commit handoff is blocked. Foundry still does not write the database directly; a task-policy-gated batch runner may run the generated CLI commit command only after the finalize report and mutation manifest are ready and `dataset-commit-handoff-plan` reports `ready_for_explicit_commit`. Blocked scopes stay in the blocker ledger while independent ready scopes may continue. After commit, `dataset-post-write-closeout` must report `completed` before the write scope is closed; it checks that the CLI commit report is a real commit, post-write verification used the same final rows, root payload hashes match, owner/state_code match, and trace queues remain attached. For a whole task, `dataset-import-completion-report` must then aggregate all closeout reports and report `completed` before the Foundry task is moved to done.

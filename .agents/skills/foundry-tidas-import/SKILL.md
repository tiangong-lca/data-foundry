---
name: foundry-tidas-import
description: Use when TianGong LCA Data Foundry must orchestrate an external LCA package or source-document import into TIDAS rows, route AI authoring through Foundry curation tasks, then hand off only gate-proven rows to CLI-owned dry-run, commit, and post-write verification.
---

# Foundry TIDAS Import

Use this skill as the Foundry-local entrypoint for end-to-end external data import. It coordinates conversion, context, curation, AI identity/classification/location decisions, AI patch authoring, deterministic validation, write planning, and post-write verification. It does not write rows by itself.

## Hard Rules

- Keep Foundry as the control plane: task routing, manifests, curation packages, cleanup, and policy checks live here.
- Do not call Supabase directly, parse raw credentials, or add database CRUD code to this skill.
- Do not copy shared `flow-hybrid-search`, `process-hybrid-search`, `lifecyclemodel-hybrid-search`, remote-ops, schema, YAML, converter, or publish internals into Foundry.
- Do not vendor external source-evidence research skills into Foundry. Resolve fast-moving Tiangong KB skills with `pnpm dlx skills@latest` at runtime and record the upstream ref in the task workspace.
- Use SDK/CLI artifacts for schema, YAML, rulesets, conversion, validation, deterministic QA, dry-run, commit, and remote verification.
- Use `$foundry-tidas-authoring` only for AI semantic repair from Foundry authoring tasks. For identity, classification, and location blockers, AI writes structured decision files; for other field gaps, AI writes structured patch files. AI never writes database rows.
- AI-authored rows can enter the remote-write chain only after AI semantic evidence proves the AI used the full SDK schema, methodology YAML, runtime ruleset, source row, entity payload, profile context, and queue/dependency context. Identity fixes prove this with `identity-decisions-apply`; classification fixes prove this with `classification-decisions-apply`; location fixes prove this with `location-decisions-apply`; other field fixes prove this with authoring patch evidence.
- For process/flow full-context imports, run every generated identity-preflight request through `dataset-identity-preflight-run` before AI authoring, then pass the same index to curation/finalize with `--identity-preflight-index`. Full-context process/flow profiles require this evidence automatically; `--require-identity-preflight` may be used as an explicit hard-gate flag when a profile wants fail-fast behavior. Foundry-generated requests should carry a compact fielded `query` for Edge hybrid search plus local-only `remote_candidate_search.profile_hints` for source-derived target profile facts. The AI package must include completed current/dependency identity-preflight evidence from `process_hybrid_search` / `flow_hybrid_search`, especially for elementary flows that must reuse existing database rows instead of being newly authored.
- After `dataset-curation-gate`, run `dataset-authoring-plan` before hand-authoring decisions or patches. Treat the plan as the current worklist for missing task builds, AI decisions/patches, deterministic apply, and post-authoring finalize readiness.
- Import-ready rows are source-language rows. Bilingual completion is a separate post-import task.
- Never continue to commit from stale historical `.foundry` artifacts. Every gate must point to the exact current final rows file.
- Runtime `.env` values are credentials/defaults only. A task that may write remotely still needs durable source manifest, profile lock, account/write guard evidence, execution policy, checkpoints, and artifact ledger under the task workspace.
- For packaged imports, process bundle execution is queue-driven and may be parallel only across independent locks up to the task `max_parallelism`. Blocked entities write blocker artifacts and are excluded from commit scopes; unrelated ready entities continue through finalize, commit, readback, and closeout when the write policy allows it.
- Source rows must represent reports, publications, datasets, or other traceable evidence records. Data-format and compliance placeholders such as `ILCD format`, `Not specified`, `Data set formats`, and `Compliance systems` are allowed only as canonical reference rewrites/provenance; the mutation manifest blocks them as source identity in support/source write scopes. Empty or type-only true source descriptions such as `Report` must be repaired from citation/name evidence before write planning.

## Lanes

### Packaged LCA Dataset

Use this lane for zipped or directory datasets supported by unified Rust `tidas import`.

```bash
pnpm exec tiangong-lca dataset context-pack \
  --type process \
  --profile ai-import \
  --include schema,methodology,ruleset \
  --out-dir .foundry/workspaces/<task-id>/context/process \
  --json

node scripts/foundry.ts tidas-handshake

node scripts/foundry.ts dataset-tidas-import \
  --input /abs/path/source-package \
  --output .foundry/workspaces/<task-id>/conversion \
  --from-format auto \
  --target tidas
```

The Foundry adapter resolves the executable from `--tidas-bin`, `TIDAS_BIN`, then `PATH`; optional config resolves from `--tidas-config` then `TIDAS_CONFIG`. It accepts compatible 0.1.x releases only after the binary reports `tidas.operation-report.v1`. v0.1.0 is the current test baseline, not a patch pin. Keep deterministic memory/queue budgets in the public Rust config or `TIDAS_MEMORY_BUDGET_MIB` / `TIDAS_QUEUE_CAPACITY`; do not install a Python/PyPI package or inspect a local Python source checkout.

For packaged imports, keep the Rust default process bundle generation enabled. The stable conversion contract includes `.foundry/workspaces/<task-id>/conversion/import-report.json`, `issues.jsonl`, `process-bundles/index.json`, and one subdirectory per converted process so downstream curation can isolate evidence, dependencies, and blockers. The bundle index is a generic packaged-import contract; profile locks such as BAFU may require a specific converted bundle index, but the skill must not hard-code a dataset name or absolute path.

### Source Document Authoring

Use this lane for PDF, Excel, office exports, screenshots, or free text that must become candidate TIDAS rows. Resolve the latest runtime `$document-granular-decompose` skill from `https://github.com/tiangong-ai/skills` when document fulltext extraction is needed, then use CLI/Foundry authoring commands to materialize candidate rows.

```bash
pnpm exec tiangong-lca dataset author \
  --input /abs/path/source.pdf \
  --output-dir .foundry/workspaces/<task-id>/authoring \
  --target-types process,flow \
  --language <source-language> \
  --json
```

For SCI paper or academic journal evidence, resolve the latest external `tiangong-kb-sci-search` skill before retrieval:

```bash
pnpm skills:source-evidence:use:sci
```

Then record the resolution in:

```text
.foundry/workspaces/<task-id>/runtime-skills/runtime-skill-resolution.json
```

The record must include the `pnpm dlx skills` command, source repo `https://github.com/tiangong-ai/skills`, resolved `refs/heads/main` commit from `git ls-remote`, skill name, evidence channel `sci`, timestamp, and output artifact paths. `tiangong-kb-sci-search` is single-source SCI retrieval; do not use it as a report, patent, general web, or all-source search wrapper. Retrieved papers are evidence candidates until field-level evidence records, limitations/conflicts, validation, curation, dry-run, and verification gates accept them.

## Required Import Sequence

1. Create one task directory under `.foundry/workspaces/<task-id>/`.
2. Fetch CLI contract context packs for every target dataset type that will be authored or repaired, and require their stable contract identity to match the Rust `tidas validate --describe` handshake used for deterministic validation.
3. Convert packaged data, or author candidate rows from source documents.
4. Normalize candidate rows into explicit row files such as `rows/processes.jsonl`, `rows/flows.jsonl`, and support rows.
5. Run Rust tidas schema validation on each row file:

```bash
node scripts/foundry.ts dataset-tidas-validate \
  --type <process|flow|source|contact|lifecyclemodel|auto> \
  --rows-file .foundry/workspaces/<task-id>/rows/<type>.jsonl \
  --out-dir .foundry/workspaces/<task-id>/schema/<type>
```

Retain the official `document-validation-batch.v1` evidence and the Foundry compatibility `outputs/validation-report.json`. The adapter must preserve Rust status/completeness/exit class and exact exit code; Foundry exit 2 for invalid rows is a compatibility gate, not a replacement validation engine.

6. Run deterministic QA for target rows where available:

```bash
pnpm exec tiangong-lca qa process \
  --rows-file .foundry/workspaces/<task-id>/rows/processes.jsonl \
  --out-dir .foundry/workspaces/<task-id>/qa/process \
  --json
```

7. Build the entity queue before AI repair:

```bash
pnpm exec tiangong-lca dataset curation-queue build \
  --processes .foundry/workspaces/<task-id>/rows/processes.jsonl \
  --flows .foundry/workspaces/<task-id>/rows/flows.jsonl \
  --support .foundry/workspaces/<task-id>/rows/sources.jsonl \
  --out-dir .foundry/workspaces/<task-id>/curation-queue
```

Drive the queue through the CLI:

```bash
pnpm exec tiangong-lca dataset curation-queue next \
  --queue-dir .foundry/workspaces/<task-id>/curation-queue \
  --json
```

Batch runners may call `curation-queue next` concurrently only when each claimed task has a distinct lock and passed dependencies, and only up to the task execution policy's `max_parallelism`. A worker executes exactly the returned action, writes that task's checkpoint or blocker, releases unrelated work, and then asks `next` again. Do not stop a whole package import because one process bundle is blocked unless the blocker is a shared dependency required by every remaining scope.

Before the next curation gate for process/flow imports, audit then run the generated identity-preflight request index. The audit is read-only and proves the exact Edge request body contains a complete fielded `query` with no placeholder/source-format noise; Edge ignores local-only `profile_hints`. The runner is also read-only; `blocked` and `needs_review` identity findings are retained as evidence rather than treated as tool failures:

```bash
node scripts/foundry.ts dataset-identity-preflight-query-audit \
  --index .foundry/workspaces/<task-id>/identity-preflight-requests/identity-preflight-requests.jsonl \
  --out-dir .foundry/workspaces/<task-id>/identity-preflight-query-audit
node scripts/foundry.ts dataset-identity-preflight-run \
  --index .foundry/workspaces/<task-id>/identity-preflight-requests/identity-preflight-requests.jsonl \
  --out-dir .foundry/workspaces/<task-id>/identity-preflight-run \
  --only-pending
```

If the gate later reports `identity_preflight_index_required`, `identity_preflight_current_result_pending`, or `identity_preflight_dependency_result_pending`, rerun this step before asking AI to author patches or decisions.

If field patches or deterministic cleanup change the current process/flow rows after the original full preflight index was built, do not replace the full index with a small current-only index. Rebuild and rerun identity preflight for the exact patched rows, passing the original full index as `--source-index` so source trace context is retained, then merge the refreshed current rows into the original full index so dependency evidence remains available:

```bash
node scripts/foundry.ts dataset-identity-preflight-requests-build \
  --type process \
  --rows-file .foundry/workspaces/<task-id>/rows/processes.patched.jsonl \
  --source-index .foundry/workspaces/<task-id>/identity-preflight-requests/identity-preflight-requests.jsonl \
  --out-dir .foundry/workspaces/<task-id>/identity-preflight-refresh
node scripts/foundry.ts dataset-identity-preflight-query-audit \
  --index .foundry/workspaces/<task-id>/identity-preflight-refresh/identity-preflight-requests/identity-preflight-requests.jsonl \
  --out-dir .foundry/workspaces/<task-id>/identity-preflight-refresh-query-audit
node scripts/foundry.ts dataset-identity-preflight-run \
  --index .foundry/workspaces/<task-id>/identity-preflight-refresh/identity-preflight-requests/identity-preflight-requests.jsonl \
  --out-dir .foundry/workspaces/<task-id>/identity-preflight-refresh-run
node scripts/foundry.ts dataset-identity-preflight-index-merge \
  --base-index .foundry/workspaces/<task-id>/identity-preflight-requests/identity-preflight-requests.jsonl \
  --update-index .foundry/workspaces/<task-id>/identity-preflight-refresh/identity-preflight-requests/identity-preflight-requests.jsonl \
  --out-dir .foundry/workspaces/<task-id>/identity-preflight-index-merge
```

8. Run the Foundry curation gate with schema, QA, profile, queue, identity-preflight evidence, and full contract context:

```bash
node scripts/foundry.ts dataset-curation-gate \
  --type process \
  --rows-file .foundry/workspaces/<task-id>/rows/processes.jsonl \
  --schema-report .foundry/workspaces/<task-id>/schema/process/outputs/validation-report.json \
  --qa-report .foundry/workspaces/<task-id>/qa/process/process-qa-report.json \
  --queue-dir .foundry/workspaces/<task-id>/curation-queue \
  --classification-queue .foundry/workspaces/<task-id>/classification-authoring-queue.jsonl \
  --location-queue .foundry/workspaces/<task-id>/location-authoring-queue.jsonl \
  --identity-preflight-index .foundry/workspaces/<task-id>/identity-preflight-requests/identity-preflight-requests.jsonl \
  --require-identity-preflight \
  --schema-file .foundry/workspaces/<task-id>/context/<type>/outputs/schema.json \
  --yaml-file .foundry/workspaces/<task-id>/context/<type>/outputs/methodology.yaml \
  --ruleset-file .foundry/workspaces/<task-id>/context/<type>/outputs/runtime-ruleset.json \
  --profile bafu \
  --out-dir .foundry/workspaces/<task-id>/curation-gate
```

9. If curation blocks on identity manual-review action items, build AI identity decision tasks and apply completed decisions through the Foundry wrapper:

```bash
node scripts/foundry.ts dataset-identity-decision-task-build \
  --curation-gate-report .foundry/workspaces/<task-id>/curation-gate/dataset-curation-gate-report.json \
  --out-dir .foundry/workspaces/<task-id>/identity-decision-task

node scripts/foundry.ts dataset-identity-decisions-apply \
  --type <flow|process> \
  --rows-file .foundry/workspaces/<task-id>/rows/<type>.jsonl \
  --decisions .foundry/workspaces/<task-id>/identity-decision-task/identity-decisions.jsonl \
  --out-dir .foundry/workspaces/<task-id>/identity-decision-apply/<type> \
  --authoring-package-dir .foundry/workspaces/<task-id>/curation-gate/ai-authoring-packages
```

Use the generated `files.output_rows` as the next rows file before rerunning schema validation, QA, and curation. `reuse_existing_reference` decisions must carry canonical id/version and produce reference-reuse rows; elementary flows can only reuse existing TianGong flows or remain blocked. Identity choices must be based on the full authoring package, identity-preflight remote candidates, source classification, unit/property, geography, process exchange context, SDK schema/YAML/ruleset, and profile constraints. Do not patch flow/process JSON directly for identity resolution.

10. If curation blocks on classification queue rows, build AI classification decision tasks and apply completed decisions through the CLI wrapper:

```bash
node scripts/foundry.ts dataset-classification-decision-task-build \
  --classification-queue .foundry/workspaces/<task-id>/classification-authoring-queue.jsonl \
  --schema-file .foundry/workspaces/<task-id>/context/<type>/outputs/schema.json \
  --yaml-file .foundry/workspaces/<task-id>/context/<type>/outputs/methodology.yaml \
  --ruleset-file .foundry/workspaces/<task-id>/context/<type>/outputs/runtime-ruleset.json \
  --classification-schema ../tiangong-lca-cli/assets/tidas-schemas/tidas_contacts_category.json \
  --classification-schema ../tiangong-lca-cli/assets/tidas-schemas/tidas_flowproperties_category.json \
  --classification-schema ../tiangong-lca-cli/assets/tidas-schemas/tidas_flows_elementary_category.json \
  --classification-schema ../tiangong-lca-cli/assets/tidas-schemas/tidas_flows_product_category.json \
  --classification-schema ../tiangong-lca-cli/assets/tidas-schemas/tidas_lciamethods_category.json \
  --classification-schema ../tiangong-lca-cli/assets/tidas-schemas/tidas_processes_category.json \
  --classification-schema ../tiangong-lca-cli/assets/tidas-schemas/tidas_sources_category.json \
  --classification-schema ../tiangong-lca-cli/assets/tidas-schemas/tidas_unitgroups_category.json \
  --location-schema ../tiangong-lca-cli/assets/tidas-schemas/tidas_locations_category.json \
  --out-dir .foundry/workspaces/<task-id>/classification-decision-task

node scripts/foundry.ts dataset-classification-decisions-apply \
  --classification-queue .foundry/workspaces/<task-id>/classification-authoring-queue.jsonl \
  --decisions .foundry/workspaces/<task-id>/classification-decision-task/classification-decisions.jsonl \
  --decision-task .foundry/workspaces/<task-id>/classification-decision-task/classification-decision-task.json \
  --out-dir .foundry/workspaces/<task-id>/classification-decision-apply
```

Use the generated classified output rows as the next rows file before rerunning schema validation, QA, and curation. Classification choices must be based on the full context and valid TIDAS classification tree codes; do not patch classification JSON directly when this decision workflow is available. Treat `classification-decision-task.json` as the AI package: it must carry queue rows, attached target row payloads, provenance context, and contract context text. Do not author decisions from the queue path alone. Preserve the template `authoring_context.context_bundle_sha256` in every decision; `dataset-classification-decisions-apply` and the mutation manifest use it to prove the decision is tied to the exact full-context bundle. For large imports, split this task with `--dataset-type`, `--bundle-id`/`--process-id`, `--limit`, `--offset`, and `--chunk-label`, and reuse one `--shared-context-cache-dir` across chunks so repeated schema/YAML/context bundles are cached by stable hash. A chunk task writes a filtered queue and task-scoped output rows. When a complete decisions file is applied to the original queue, pass every chunk task using repeated `--decision-task` so all schema/YAML/context bundles remain proven.

11. If curation blocks on location queue rows, build AI location decision tasks and apply completed decisions through the CLI wrapper:

```bash
node scripts/foundry.ts dataset-location-decision-task-build \
  --location-queue .foundry/workspaces/<task-id>/location-authoring-queue.jsonl \
  --identity-preflight-index .foundry/workspaces/<task-id>/identity-preflight-requests/identity-preflight-requests.jsonl \
  --require-identity-preflight \
  --schema-file .foundry/workspaces/<task-id>/context/<type>/outputs/schema.json \
  --yaml-file .foundry/workspaces/<task-id>/context/<type>/outputs/methodology.yaml \
  --ruleset-file .foundry/workspaces/<task-id>/context/<type>/outputs/runtime-ruleset.json \
  --classification-schema ../tiangong-lca-cli/assets/tidas-schemas/tidas_contacts_category.json \
  --classification-schema ../tiangong-lca-cli/assets/tidas-schemas/tidas_flowproperties_category.json \
  --classification-schema ../tiangong-lca-cli/assets/tidas-schemas/tidas_flows_elementary_category.json \
  --classification-schema ../tiangong-lca-cli/assets/tidas-schemas/tidas_flows_product_category.json \
  --classification-schema ../tiangong-lca-cli/assets/tidas-schemas/tidas_lciamethods_category.json \
  --classification-schema ../tiangong-lca-cli/assets/tidas-schemas/tidas_processes_category.json \
  --classification-schema ../tiangong-lca-cli/assets/tidas-schemas/tidas_sources_category.json \
  --classification-schema ../tiangong-lca-cli/assets/tidas-schemas/tidas_unitgroups_category.json \
  --location-schema ../tiangong-lca-cli/assets/tidas-schemas/tidas_locations_category.json \
  --out-dir .foundry/workspaces/<task-id>/location-decision-task

node scripts/foundry.ts dataset-location-decisions-apply \
  --location-queue .foundry/workspaces/<task-id>/location-authoring-queue.jsonl \
  --decisions .foundry/workspaces/<task-id>/location-decision-task/location-decisions.jsonl \
  --decision-task .foundry/workspaces/<task-id>/location-decision-task/location-decision-task.json \
  --out-dir .foundry/workspaces/<task-id>/location-decision-apply
```

Use the generated located output rows as the next rows file before rerunning schema validation, QA, and curation. Location choices must be based on the full context and valid `tidas_locations_category.json` codes; do not patch location fields directly when this decision workflow is available. Treat `location-decision-task.json` as the AI package: it must carry queue rows, target paths, attached target row payloads, provenance context, and contract context text. Do not author decisions from the queue path alone. Preserve the template `authoring_context.context_bundle_sha256` in every decision; `dataset-location-decisions-apply` and the mutation manifest use it to prove the decision is tied to the exact full-context bundle. For large imports, split this task with `--dataset-type`, `--bundle-id`/`--process-id`, `--limit`, `--offset`, and `--chunk-label`, and reuse one `--shared-context-cache-dir` across chunks so repeated schema/YAML/context bundles are cached by stable hash. A chunk task writes a filtered queue and task-scoped output rows. When a complete decisions file is applied to the original queue, pass every chunk task using repeated `--decision-task` so all schema/YAML/context bundles remain proven.

12. For non-identity/non-classification/non-location curation blockers, build AI authoring tasks and use `$foundry-tidas-authoring`:

```bash
node scripts/foundry.ts dataset-authoring-task-build \
  --curation-gate-report .foundry/workspaces/<task-id>/curation-gate/dataset-curation-gate-report.json \
  --shared-context-cache-dir .foundry/workspaces/<task-id>/shared-context-cache \
  --out-dir .foundry/workspaces/<task-id>/authoring-tasks
```

13. Collect and apply AI patches only after every per-task patch is evidence-backed and complete:

Skip this step when `authoring-task-manifest.json` reports `status=ready_no_action_items` and `batch_patch_contract.status=not_required_no_patch_action_items`; in that case only decision workflows were needed for the current scope.

```bash
node scripts/foundry.ts dataset-authoring-patch-collect \
  --task-manifest .foundry/workspaces/<task-id>/authoring-tasks/authoring-task-manifest.json

node scripts/foundry.ts dataset-patch-apply \
  --input .foundry/workspaces/<task-id>/rows/<type>.jsonl \
  --patch .foundry/workspaces/<task-id>/authoring-tasks/ai-patches.batch.json \
  --out .foundry/workspaces/<task-id>/rows/<type>.patched.jsonl \
  --out-dir .foundry/workspaces/<task-id>/patch-apply \
  --authoring-package-dir .foundry/workspaces/<task-id>/curation-gate/ai-authoring-packages \
  --require-authoring-package \
  --require-action-item-closure
```

14. For support rows that mutually reference each other, first build one mixed support rows file containing only writable contact/source rows, then run `dataset-post-authoring-finalize --type support`. Flow Properties and Unit Groups are reference-only: refresh `specs/canonical-support/flow-properties-unit-groups.json` and rewrite converted references to existing canonical database rows before flow/process curation. The finalizer reruns cleanup, Rust tidas batch validation through `dataset-tidas-validate`, location audit, generic `pnpm exec tiangong-lca dataset save-draft --type auto --dry-run`, mutation manifest, and commit handoff on one exact writable support scope. The mutation manifest must show no source identity blockers and no account-local unitgroup/flowproperty rows before commit. When task write policy allows automated commit, a batch runner may commit it through the generated `dataset save-draft --type auto --commit` handoff, then must run post-write verify and closeout before dependent flow/process scopes.

15. For process, flow, and lifecyclemodel rows, run the post-AI prewrite finalize command. It reruns cleanup, Rust tidas validation, deterministic CLI QA, `pnpm exec tiangong-lca dataset classification audit --type location` for schema-derived location-code fields against `tidas_locations_category.json`, post-authoring curation gate, type-specific dry-run (`process save-draft --dry-run`, `flow publish-version --dry-run`, or `lifecyclemodel save-draft --dry-run`), optional remote reference verification, and mutation manifest generation on one exact rows-file scope:

```bash
node scripts/foundry.ts dataset-post-authoring-finalize \
  --type <process|flow|lifecyclemodel> \
  --rows-file .foundry/workspaces/<task-id>/rows/<type>.patched.jsonl \
  --out-dir .foundry/workspaces/<task-id>/post-authoring-finalize \
  --profile bafu \
  --queue-dir .foundry/workspaces/<task-id>/curation-queue \
  --classification-queue .foundry/workspaces/<task-id>/classification-authoring-queue.jsonl \
  --location-queue .foundry/workspaces/<task-id>/location-authoring-queue.jsonl \
  --schema-file .foundry/workspaces/<task-id>/context/<type>/outputs/schema.json \
  --yaml-file .foundry/workspaces/<task-id>/context/<type>/outputs/methodology.yaml \
  --ruleset-file .foundry/workspaces/<task-id>/context/<type>/outputs/runtime-ruleset.json \
  --classification-decision-apply-report .foundry/workspaces/<task-id>/classification-decision-apply/classification-decisions-apply-report.json \
  --location-decision-apply-report .foundry/workspaces/<task-id>/location-decision-apply/location-decisions-apply-report.json \
  --identity-decision-apply-report .foundry/workspaces/<task-id>/identity-decision-apply/identity-decisions-apply-report.json \
  --target-user-id <uuid> \
  --verify-remote
```

Add `--patch-collect-report ... --require-patch-collect-report --patch-apply-report ...` only when patch collect/apply actually ran for the exact rows file.

16. Inspect or regenerate the commit handoff plan. It is read-only and must report `ready_for_explicit_commit` before any database write:

```bash
node scripts/foundry.ts dataset-commit-handoff-plan \
  --finalize-report .foundry/workspaces/<task-id>/post-authoring-finalize/dataset-post-authoring-finalize-report.json \
  --state-code <expected-state-code>
```

17. Commit only when `dataset-post-authoring-finalize-report.json` and its mutation manifest both report `ready_for_remote_write`, `dataset-commit-handoff-plan.json` reports `ready_for_explicit_commit`, `counts.location_audit_blockers` is `0`, reference closure is proven for the exact write scope, and the task write policy allows the commit mode. If the manifest reports `reference_closure_remote_verify_required`, first write and verify the support scope, then rerun finalize for the dependent scope. If the task policy allows automated batch commit, the runner may run the generated command for that exact scope without per-row human approval; otherwise it stops at handoff.
18. After commit, run the handoff plan's `post_write_verify` command. It must include `pnpm exec tiangong-lca dataset verify-remote --compare-root-payload --target-user-id <uuid> --state-code <code>` on the same final rows file.
19. Close the import only after Foundry verifies the commit and readback artifacts:

```bash
node scripts/foundry.ts dataset-post-write-closeout \
  --handoff-plan .foundry/workspaces/<task-id>/post-authoring-finalize/commit-handoff/dataset-commit-handoff-plan.json \
  --commit-report .foundry/workspaces/<task-id>/post-authoring-finalize/commit/<type-command>/outputs/<summary-or-report>.json \
  --post-write-verify-report .foundry/workspaces/<task-id>/post-authoring-finalize/commit-handoff/post-write-verify/outputs/remote-verification-report.json \
  --out-dir .foundry/workspaces/<task-id>/post-write-closeout
```

`dataset-post-write-closeout` must report `completed`; otherwise the import is not done. It must prove that the CLI commit report and post-write verification report both reference the same final rows file from handoff. For profiles such as BAFU that require full-context AI completion, the closeout must still see the mutation manifest full-context proof and at least one AI semantic evidence entry from classification decisions, location decisions, or field patches.

20. For a task with one or more committed scopes, write the task-level completion report from every closeout:

```bash
node scripts/foundry.ts dataset-import-completion-report \
  --task-dir .foundry/workspaces/<task-id> \
  --require-type process \
  --out-dir .foundry/workspaces/<task-id>/import-completion
```

`dataset-import-completion-report` must report `completed` before moving the Foundry task to done. It must see one closeout per committed write scope; duplicate closeouts for the same dataset type and final rows keep the task blocked. It also rechecks profile-required full schema/YAML/context AI proof and evidence counts for every scope. `task-complete` then checks the active task id, closeout scopes, and the same profile-required proof before moving the filesystem task to done.

21. Move the task to done only through the gated task command:

```bash
pnpm task:complete -- \
  --task <task-id> \
  --completion-report .foundry/workspaces/<task-id>/import-completion/dataset-import-completion-report.json
```

## Database Query And Write Boundary

- Database candidate search, reference refresh, write execution, and readback are CLI or shared-skill responsibilities.
- Use query/search skills only as evidence or candidate-discovery helpers, and only when their outputs are captured into Foundry artifacts.
- Do not harden hybrid-search skills into this Foundry `.agents/skills` tree. If Foundry needs a stable data access capability, add or extend a public CLI command first, then call that command from this skill.
- Completion requires post-write remote verification with root payload comparison, then `dataset-post-write-closeout` with equal local/remote payload hashes and matching owner/state evidence.
- Multi-scope imports require `dataset-import-completion-report` to aggregate all closeouts and preserve trace queues before marking the task complete; duplicate closeouts for the same final rows are not additional scope evidence.

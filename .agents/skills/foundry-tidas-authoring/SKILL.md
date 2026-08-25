---
name: foundry-tidas-authoring
description: Use when TianGong LCA Data Foundry has generated dataset authoring tasks, identity/classification/location decision tasks, or curation-gate AI authoring packages and Codex must read the full package/context, produce evidence-backed structured TIDAS dataset patches or decisions, collect/apply them through deterministic tools, and hand off to validation without writing the database directly.
---

# Foundry TIDAS Authoring

Use this skill for Foundry external dataset curation after `dataset-curation-gate` or `dataset-authoring-task-build` has produced AI authoring packages/tasks.

## Hard Rules

- Read the full `ai-authoring-task.json`, `ai-authoring-task.md`, `identity-decision-task.json`, `classification-decision-task.json`, or `location-decision-task.json` before writing any patch or decision. When an `authoring-task-manifest.json` or task context exposes `shared_context_bundle`, read that bundle once per batch for repeated schema/YAML/ruleset/category/location text, then read each referenced authoring package for entity source evidence, action items, support rows, and hash-bound proof.
- Stop immediately if the task or manifest status is `blocked_missing_full_context`; missing schema, methodology YAML, runtime ruleset, category/location schema, or source-row payload context must be regenerated before AI authoring.
- Treat `context.contract_context_files` and the package's `contract_context_files[].text` as required input, not optional metadata.
- Do not reread duplicate full contract/profile context from every package when `shared_context_bundle` is available. The shared bundle is a token-efficiency aid only; it does not replace `authoring_package`, `authoring_package_sha256`, action-item closure, or entity-specific evidence requirements.
- Treat `identity_preflight_context` as required for process/flow full-context imports. If the current row or dependency context is missing, pending, or not produced by the generated identity-preflight index, stop and rerun the deterministic preflight runner before authoring identity-dependent patches or decisions. Do not decide to create an elementary flow when completed `flow_hybrid_search` evidence has not been reviewed.
- Do not hand-edit row JSONL files.
- Do not call Supabase directly and do not write the database from this skill.
- Do not copy schema/YAML into the skill. Use the context files referenced by the authoring package/task.
- Keep import rows source-language only. Bilingual completion is a separate post-import task.
- Do not leave `template_status=requires_ai_completion`, `__AI_FILL_*`, `__AI_SELECT_*`, local file-path placeholders, trace-only text, or invented values in a final patch or decision file.
- Every AI patch file must declare `patch_status=completed`; draft, missing, or non-completed patch status is not collectable.
- Every identity decision row must declare `decision_status=completed`; draft, missing, or non-completed identity decisions are not deterministically applicable.
- Every classification or location decision row must declare `decision_status=completed`; draft, missing, or non-completed decisions are not deterministically applicable.
- Every non-test operation needs `basis` or `evidence`.
- For full-context tasks, every non-test operation needs both `basis` and structured `evidence` with a source/context identifier plus `quote_or_trace`, source path, field path, citation, or equivalent pointer.
- Every non-test operation needs `resolution.mode` and `resolution.used_context_kinds`; for full-context profiles this must include `schema`, `methodology_yaml`, `ruleset`, `classification_schema`, and `location_schema` when those context kinds are present in the authoring task.
- Identity manual-review action items from curation packages should be authored as `identity-decisions.jsonl` entries with `dataset_type`, `dataset_id`, `dataset_version`, `decision_status=completed`, `identity_decision`, `basis`, `used_context_kinds`, structured `evidence`, `closes_action_items`, `authoring_package`, and `authoring_package_sha256`, then applied through `node scripts/foundry.ts dataset-identity-decisions-apply`. `reuse_existing_reference` decisions must include canonical id/version; elementary flow decisions must never choose `create_new`.
- Classification action items from `classification-authoring-queue.jsonl` should be authored as `classification-decisions.jsonl` entries with `dataset_id`, `dataset_version`, `category_type`, `decision_status=completed`, `code`, `basis`, template `authoring_context.context_bundle_sha256`, and structured `evidence`, then applied through `node scripts/foundry.ts dataset-classification-decisions-apply` with the matching `--decision-task`. Location action items from `location-authoring-queue.jsonl` should be authored as `location-decisions.jsonl` entries with `dataset_id`, `dataset_version`, `category_type=location`, `decision_status=completed`, `code`, `target_path`, `basis`, template `authoring_context.context_bundle_sha256`, and structured `evidence`, then applied through `node scripts/foundry.ts dataset-location-decisions-apply` with the matching `--decision-task`. Only non-identity/non-classification/non-location field gaps should use JSON patch operations.
- For large queues, build per-bundle or per-type decision tasks with `--dataset-type`, `--bundle-id`/`--process-id`, `--limit`, `--offset`, and `--chunk-label`, and pass the same `--shared-context-cache-dir` to every chunk so repeated schema/YAML/category/location text is cached under one stable bundle path. When applying decisions back to the source queue, pass every chunk task with repeated `--decision-task`; the apply report and mutation manifest must preserve all context-bundle proofs.
- Treat source rows as source evidence objects, not format/compliance records. `ILCD format`, `Not specified`, `Data set formats`, and `Compliance systems` may appear in rewrite/provenance traces but must not be authored as BAFU-owned source identity. True source rows must also have evidence-bearing descriptions; empty or type-only values such as `Report` should be repaired from `sourceCitation` / `common:shortName`.
- Every AI-required action item must be closed by `closes_action_items` unless the task remains blocked.
- Remote-write entry is allowed only after full-context AI semantic evidence is collected, deterministically applied, revalidated, and accepted by Foundry finalize/mutation gates. Identity preflight items use `dataset-identity-decisions-apply`; classification queue items use `dataset-classification-decisions-apply`; location queue items use `dataset-location-decisions-apply`; other field fixes use patch collect/apply.

## Identity Decision Workflow

For process / flow identity manual-review action items, build the dedicated decision task from the curation gate report:

```bash
node scripts/foundry.ts dataset-identity-decision-task-build \
  --curation-gate-report .foundry/workspaces/<task-id>/curation-gate/dataset-curation-gate-report.json \
  --out-dir .foundry/workspaces/<task-id>/identity-decision-task
```

Read `identity-decision-task.json` as the primary package. It includes every selected action item, the referenced authoring package, completed identity-preflight evidence, remote candidates from `flow_hybrid_search` / `process_hybrid_search`, a stable `context_bundle.sha256`, and `authoring_package_sha256` proofs. When it exposes `files.shared_context_bundle` or `shared_context_bundle.path`, read that bundle once for schema/YAML/ruleset/category/location text before reviewing the per-entity packages. Fill only `identity-decisions.jsonl`; do not patch flow/process rows directly for identity resolution.

Decision rules:

- `reuse_existing_reference`: use only when the candidate is identity-equivalent after checking name, type, unit/property, geography, source classification, exchange context, and package evidence. Include `canonical.table`, `canonical.ref_object_id`, and `canonical.version`.
- `create_new`: allowed only for non-elementary product/process identities when the evidence shows no database candidate is identity-equivalent.
- `block_unresolved`: use when candidates are insufficient or conflicting; include searched query/candidate evidence and the reason the row cannot proceed.
- Elementary flow identity decisions must be `reuse_existing_reference` or `block_unresolved`; never create a BAFU-owned elementary flow.

Then apply through:

```bash
node scripts/foundry.ts dataset-identity-decisions-apply \
  --type <flow|process> \
  --rows-file .foundry/workspaces/<task-id>/rows/<type>.jsonl \
  --decisions .foundry/workspaces/<task-id>/identity-decision-task/identity-decisions.jsonl \
  --out-dir .foundry/workspaces/<task-id>/identity-decision-apply/<type> \
  --authoring-package-dir .foundry/workspaces/<task-id>/curation-gate/ai-authoring-packages
```

The apply report must be `completed`. Use `files.output_rows` as the next rows file and pass `identity-decisions-apply-report.json` into later curation/finalize/mutation gates. If `files.identity_reference_rewrites` is produced for reused flow references, apply or pass those rewrites before validating dependent process rows.

## Classification Decision Workflow

For process / flow classification queue rows, build the dedicated decision task:

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
```

Read `classification-decision-task.json` as the primary package. It includes queue rows, attached target row payloads, provenance rows such as source semantics/reference rewrites when present, a stable `context_bundle.sha256`, and a shared context bundle reference for schema/YAML/ruleset/category/location text. Read `files.shared_context_bundle` once, then fill only `classification-decisions.jsonl` using valid leaf codes from the CLI classification tree. Every decision must preserve the template `decision_status=completed` and `authoring_context.context_bundle_sha256`, carry `used_context_kinds`, and include evidence that points back to the queue row and target payload. Then apply through:

```bash
node scripts/foundry.ts dataset-classification-decisions-apply \
  --classification-queue .foundry/workspaces/<task-id>/classification-authoring-queue.jsonl \
  --decisions .foundry/workspaces/<task-id>/classification-decision-task/classification-decisions.jsonl \
  --decision-task .foundry/workspaces/<task-id>/classification-decision-task/classification-decision-task.json \
  --out-dir .foundry/workspaces/<task-id>/classification-decision-apply
```

The apply report must be `completed` and include the decision task/context bundle proof; use its output rows as the next rows file for schema validation, QA, curation, and finalize. For chunked runs, use the filtered queue emitted by the task for per-chunk apply, or apply a complete decisions file to the original source queue while passing all chunk task files with repeated `--decision-task`.

## Location Decision Workflow

For location queue rows, build the dedicated decision task:

```bash
node scripts/foundry.ts dataset-location-decision-task-build \
  --location-queue .foundry/workspaces/<task-id>/location-authoring-queue.jsonl \
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
```

Read `location-decision-task.json` as the primary package. It includes queue rows, target paths, attached target row payloads, provenance rows when present, a stable `context_bundle.sha256`, and a shared context bundle reference for schema/YAML/ruleset/location text. Read `files.shared_context_bundle` once, then fill only `location-decisions.jsonl` using valid codes from `tidas_locations_category.json`; each decision must preserve the template `decision_status=completed` and `authoring_context.context_bundle_sha256`, include `target_path`, `used_context_kinds`, and evidence that points back to the queue row and target payload. Then apply through:

```bash
node scripts/foundry.ts dataset-location-decisions-apply \
  --location-queue .foundry/workspaces/<task-id>/location-authoring-queue.jsonl \
  --decisions .foundry/workspaces/<task-id>/location-decision-task/location-decisions.jsonl \
  --decision-task .foundry/workspaces/<task-id>/location-decision-task/location-decision-task.json \
  --out-dir .foundry/workspaces/<task-id>/location-decision-apply
```

The apply report must be `completed` and include the decision task/context bundle proof; use its output rows as the next rows file for schema validation, QA, curation, and finalize. For chunked runs, use the filtered queue emitted by the task for per-chunk apply, or apply a complete decisions file to the original source queue while passing all chunk task files with repeated `--decision-task`.

## Patch Workflow

1. Start from an authoring task manifest:

```bash
node scripts/foundry.ts dataset-authoring-task-build \
  --curation-gate-report .foundry/workspaces/<task-id>/curation-gate/dataset-curation-gate-report.json \
  --shared-context-cache-dir .foundry/workspaces/<task-id>/shared-context-cache \
  --out-dir .foundry/workspaces/<task-id>/authoring-tasks
```

The resulting `authoring-task-manifest.json` must have `status=ready_for_ai_authoring_batch` before patch authoring. If it exposes `files.shared_context_bundle` or `shared_context_bundle.path`, read that bundle first and use its `files[].text` entries as the batch-level schema/YAML/ruleset/category/location context. Reuse the same `--shared-context-cache-dir` when rebuilding tasks so identical context is cached by stable hash. `dataset-authoring-patch-collect` verifies the referenced shared bundle still exists and that its stable `sha256` matches the manifest/task reference before accepting AI patches. If the manifest reports `ready_no_action_items`, there are no patchable field gaps in that scope; resolve any `decision_only_action_items` through the identity/classification/location decision workflows and skip patch collect/apply. If it reports `blocked_missing_full_context`, regenerate the curation gate or task with the missing context files before writing any patch.

2. For each `tasks[]` entry with `status=ready_for_ai_authoring`, read:

- `files.task_markdown`
- `files.task_json`
- `files.authoring_package`
- the manifest/task `shared_context_bundle` when present
- any entity-specific queue, dependency, support, source-row, and QA context referenced by the authoring package

3. Write only the patch file named by `files.output_patch_file`.

Patch shape:

```json
{
  "schema_version": 1,
  "kind": "tiangong_foundry_dataset_patch",
  "patch_status": "completed",
  "patch_sets": [
    {
      "dataset_id": "<uuid>",
      "version": "00.00.001",
      "authoring_package": "<package filename>",
      "operations": [
        {
          "op": "replace",
          "path": "/processDataSet/...",
          "value": "source-language value",
          "basis": "Why this value follows from the package/context.",
          "evidence": {
            "source": "authoring package, source row, YAML/schema/profile, or cited source",
            "quote_or_trace": "short evidence pointer"
          },
          "resolution": {
            "mode": "evidence_backed_completion",
            "used_context_kinds": [
              "schema",
              "methodology_yaml",
              "ruleset",
              "classification_schema",
              "location_schema"
            ],
            "summary": "Why this operation resolves the action item."
          },
          "closes_action_items": [
            {
              "code": "process_placeholder_content",
              "path": "processDataSet..."
            }
          ]
        }
      ]
    }
  ]
}
```

Every full-context non-test operation must include `closes_action_items`; supporting cleanup operations should close the same action item they are needed to resolve. Classification and location queue decisions should not be encoded as patch operations when the dedicated decision workflows are available.

4. If a value cannot be inferred safely:

- do not use `common:other` as a substitute for mandatory schema fields; schema-required values need evidence-backed values or must remain blocked;
- if the action item's allowed modes include `deferred_to_common_other`, write `common:other.tiangongfoundry:unresolvedTrace` with `status`, `action_item_code`, `blocked_path`, `reason`, structured `evidence`, and `next_action`, then close only the action item it truly resolves. Evidence must include source plus quote/trace/path/citation pointer;
- do not defer `annualSupplyOrProductionVolume` to `common:other`; when annual source evidence is missing, Foundry deterministic cleanup writes `9999 missing-data-sentinel/year`, an intentionally non-physical searchable sentinel that later database-side curation owns replacing;
- if source completeness is being accepted as source-faithful, write `common:other.tiangongfoundry:sourceExchangeCompleteness` with an accepted `status`, structured source trace `evidence`, and `resolution.mode=source_trace_verified`. Evidence must include source plus quote/trace/path/citation pointer;
- if a mandatory schema/review blocker cannot be resolved, leave the task blocked by not writing a fake value, and record the blocker in a local note next to the task.

Foundry cleanup adds `@xmlns:tiangongfoundry` to `common:other` containers that keep `tiangongfoundry:*` traces before Rust tidas validation.

5. Collect all per-task patches:

```bash
node scripts/foundry.ts dataset-authoring-patch-collect \
  --task-manifest .foundry/workspaces/<task-id>/authoring-tasks/authoring-task-manifest.json
```

If collect reports `blocked`, repair the per-task patch files or regenerate missing full-context task artifacts before applying.

6. Only after collect reports `ready_for_patch_apply`, run deterministic apply with the manifest command or:

```bash
node scripts/foundry.ts dataset-patch-apply \
  --input .foundry/workspaces/<task-id>/rows/<type>.jsonl \
  --patch .foundry/workspaces/<task-id>/authoring-tasks/ai-patches.batch.json \
  --out .foundry/workspaces/<task-id>/rows/<type>.patched.jsonl \
  --out-dir .foundry/workspaces/<task-id>/patch-apply \
  --authoring-package-dir .foundry/workspaces/<task-id>/curation-gate/ai-authoring-packages \
  --require-authoring-package \
  --require-action-item-closure
```

7. If the patched rows are process or flow rows and an existing full identity-preflight index was used for the previous curation gate, rebuild identity preflight for the exact patched rows with the original full index passed as `--source-index`, run `dataset-identity-preflight-query-audit` on the refreshed index, rerun identity preflight, then merge that refreshed current-scope index into the original full index with `dataset-identity-preflight-index-merge`. Passing only the small refreshed current index to curation drops dependency preflight evidence and source trace context, and should remain blocked.

8. After apply and any required preflight index merge, use `node scripts/foundry.ts dataset-post-authoring-finalize --type <process|flow|lifecyclemodel> ...` for process, flow, or lifecyclemodel rows. It reruns native Rust `tidas` validation, deterministic QA, Foundry cleanup, post-authoring curation gate, type-specific dry-run save/publish, optional remote verification, mutation manifest, and commit handoff plan generation on one exact rows-file scope. For authoring-task patches, pass `--patch-collect-report <authoring-patch-collect-report.json> --require-patch-collect-report --patch-apply-report <dataset-patch-apply-report.json>` and stop on any blocker. Commit remains a CLI-owned step only after `dataset-commit-handoff-plan.json` reports `ready_for_explicit_commit` and the task write policy permits the exact scope; a policy-gated batch runner may execute that generated command. The handoff must prove every final-row `common:other.tiangongfoundry:unresolvedTrace` / `sourceExchangeCompleteness` entry is present in the retained trace queue JSONL. After commit, run post-write remote verification and `node scripts/foundry.ts dataset-post-write-closeout` before treating the import as complete; closeout rechecks the same trace queue coverage so later database-side curation has exact queue entries.

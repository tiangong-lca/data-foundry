---
title: BAFU Leaf Process Classification Authoring
docType: runbook
scope: bafu
status: draft
owner: tiangong-lca-data-foundry
related:
  - docs/import-profiles/bafu/profile.md
  - docs/import-profiles/bafu/constraints.md
---

# BAFU Leaf Process Classification Authoring

Use this helper when `dataset-library-decisions-apply` writes `process_classification_requires_leaf_authoring` rows to a `blocked-scope-ledger.jsonl`. Those rows mean the library-level process classification decision was only a broad placeholder and cannot satisfy BAFU leaf gating.

The helper is a Foundry workflow-internal command. It prepares deterministic, sharded AI authoring inputs; AI or humans author decisions, and Foundry later merges and applies those decisions through the normal library-scope workflow. BAFU-specific repair rules may emit candidate rows, but those candidates are not authoritative decisions and must not be copied into `classification-decisions.jsonl` until reviewed under a full-context task with `authoring_context.context_bundle_sha256`.

## Build Shards

```bash
node scripts/foundry.ts dataset-bafu-leaf-classification-tasks-prepare \
  --library-index .foundry/workspaces/bafu-full-import-20260607T080646Z/library-index \
  --blocked-ledger .foundry/workspaces/bafu-full-import-20260607T080646Z/library-resolution-v3-leaf-gated/blocked-scope-ledger.jsonl \
  --library-decisions .foundry/workspaces/bafu-full-import-20260607T080646Z/decisions/classification-decisions.jsonl \
  --out-dir .foundry/workspaces/bafu-full-import-20260607T080646Z/leaf-process-classification-authoring \
  --shard-size 100
```

Inputs are read-only. The helper joins:

- `library-entity-index.jsonl` for process name, converted classification, references, source file, semantic key, and payload hash.
- `scope-projection.jsonl` for process-bundle path, dependency counts, output exchanges, and exchange-flow context.
- `blocked-scope-ledger.jsonl` for the exact blocked process scopes.
- optional existing `classification-decisions.jsonl` so AI can see and replace the broad placeholder decision.

## Outputs

The output directory contains:

- `leaf-process-classification-task-report.json`
- `leaf-process-classification-tasks.jsonl`
- `classification-decisions.template.jsonl`
- `shards/leaf-process-classification-tasks-0000.jsonl`
- `shards/classification-decisions-0000.template.jsonl`

Each task row is self-contained for an AI author:

```json
{
  "schema_version": 1,
  "task_kind": "bafu_process_leaf_classification_authoring",
  "status": "needs_leaf_classification_decision",
  "dataset_type": "process",
  "dataset_id": "<process uuid>",
  "dataset_version": "00.00.001",
  "blocked_scope": {
    "reason": "process_classification_requires_leaf_authoring"
  },
  "process_context": {
    "name": "<source-language process name>",
    "converted_classification_path": "<weak converted classification>",
    "source_trace": {
      "source_classification": {
        "category": "<source category>",
        "subCategory": "<source subcategory>"
      },
      "reference_function_attributes": {
        "name": "<source reference function>",
        "unit": "<source unit>"
      }
    }
  },
  "exchange_context": {
    "output_flows": {
      "rows": [
        {
          "direction": "Output",
          "short_description": "<reference product/output flow>"
        }
      ]
    }
  },
  "existing_library_decision": {
    "selected_code": "<broad placeholder code>",
    "classification_decision_level": "broad_section"
  },
  "decision_template": {
    "dataset_type": "process",
    "dataset_id": "<process uuid>",
    "category_type": "process",
    "selected_code": "__AI_SELECT_TIDAS_PROCESS_LEAF_CODE__",
    "classification_decision_level": "leaf"
  }
}
```

## AI Output Shape

Each shard author should write completed rows in JSONL. Use the template fields and replace the placeholders:

```json
{
  "schema_version": 1,
  "dataset_type": "process",
  "dataset_id": "<process uuid>",
  "dataset_version": "00.00.001",
  "entity_key": "process:<process uuid>:00.00.001",
  "category_type": "process",
  "decision_status": "completed",
  "selected_code": "<TIDAS process leaf code>",
  "basis": "<why this leaf fits the process name, source trace, output flow, and exchange context>",
  "confidence": "high",
  "classification_decision_level": "leaf",
  "authoring_context": {
    "context_bundle_sha256": "<classification-decision-task context_bundle.sha256>"
  },
  "source_name": "<process name>",
  "converted_classification_reference": "<weak converted classification path>",
  "required_resolution": "Select a full TIDAS process leaf code from process category context. Converted classifications and broad section decisions are weak hints only.",
  "used_context_kinds": [
    "library_entity_index",
    "scope_projection",
    "blocked_scope_ledger",
    "process_payload_context",
    "process_exchange_context",
    "tidas_process_category_schema"
  ],
  "evidence": {
    "source": "bafu_process_leaf_classification_authoring_task",
    "task_id": "process:<process uuid>:00.00.001",
    "source_file": "<process source file>",
    "payload_sha256": "<library-index payload hash>",
    "broad_decision_replaced": {
      "selected_code": "<old broad code>"
    }
  }
}
```

`selected_code` must be a valid TIDAS process leaf. Do not return single-letter section codes or short broad group placeholders. Do not edit process rows directly.

After shard decisions are reviewed, merge them into the run's `decisions/classification-decisions.jsonl` process rows and rerun:

```bash
node scripts/foundry.ts dataset-library-decisions-apply \
  --library-index .foundry/workspaces/bafu-full-import-20260607T080646Z/library-index \
  --decisions-dir .foundry/workspaces/bafu-full-import-20260607T080646Z/decisions \
  --out-dir .foundry/workspaces/bafu-full-import-20260607T080646Z/library-resolution-v4-leaf-gated
```

The rerun should remove `process_classification_requires_leaf_authoring` for processes whose leaf decisions are complete. Other blockers, such as unresolved elementary-flow identity or canonical support mappings, remain separate.

If `dataset-bafu-leaf-classification-category-map-project` writes `process-leaf-classification-candidates.jsonl` or `flow-product-classification-candidates.jsonl`, treat those rows as reviewer aids only. They deliberately use `decision_status=candidate_requires_ai_or_human_review`; affected process scopes remain blocked until a completed, task-bound decision with the exact context bundle hash is written and applied.

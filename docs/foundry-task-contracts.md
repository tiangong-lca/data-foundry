---
title: Foundry Task Contracts
docType: contract
scope: task-ledger
status: active
authoritative: true
owner: tiangong-lca-data-foundry
language: en
whenToUse:
  - when creating or validating Foundry task workspace artifacts
  - when deciding what belongs in foundry-job, source, seed, checkpoint, or artifact ledgers
whenToUpdate:
  - when Foundry task, workspace, checkpoint, or artifact contracts change
  - when new lanes or owner route fields become required
checkPaths:
  - docs/foundry-task-contracts.md
  - AGENTS.md
  - WORKFLOW.md
  - specs/import-profiles.json
  - tasks/**
lastReviewedAt: 2026-08-25
lastReviewedCommit: 58e034847e4d4cf9c94e3cc9fe032752f4436e07
lastReviewedNote: "Reviewed for Issue #65: handoff CommandSpecs and final-row artifact facts extend the remote-write evidence contract."
related:
  - AGENTS.md
  - WORKFLOW.md
  - docs/runtime-skill-management.md
  - specs/import-profiles.json
---

# Foundry Task Contracts

Foundry owns a small task ledger. It records what should happen, which profile and sources are frozen, which owner command or skill produced each artifact, and whether gates agree on the same rows scope. It does not own conversion, validation, QA, queue state, database writes, or remote verification logic.

## Workspace Layout

```text
.foundry/workspaces/<task-id>/
  foundry-job.json
  source-manifest.json
  seed-manifest.json
  profile-lock.json
  artifact-index.jsonl
  runtime-skills/runtime-skill-resolution.json
  checkpoints/<NN>-<stage-id>.json
```

`source-manifest.json` is required for both lanes. `seed-manifest.json` is required for `source-evidence-dataset-development`; packaged imports may omit it unless a source-discovery phase was used.

## foundry-job.json

```json
{
  "schema_version": 1,
  "task_id": "issue-123",
  "lane": "external-dataset-curated-import",
  "target_profile": "bafu",
  "target_entities": ["support", "flow", "process"],
  "workspace_dir": ".foundry/workspaces/issue-123",
  "write_policy": {
    "mode": "dry-run",
    "remote_commit": "profile_gated_batch",
    "requires_human_approval": false,
    "human_approval_required_for": [
      "policy_change",
      "exceptional_waiver",
      "missing_canonical_support_resolution",
      "delete_action"
    ]
  },
  "execution_policy": {
    "max_parallelism": 4,
    "claim_strategy": "queue_lock",
    "blocked_item_policy": "record_and_continue_independent_scopes"
  },
  "owner_routes": {
    "conversion": "tiangong-lca-cli",
    "queue_state": "tiangong-lca-cli",
    "semantic_authoring": "tiangong-lca-skills",
    "gate_aggregation": "tiangong-lca-data-foundry"
  }
}
```

`write_policy.mode=dry-run` remains the default until a task explicitly permits commit. When `remote_commit=profile_gated_batch`, a runner may execute generated CLI commit commands only for exact scopes whose queue verify, finalize report, mutation manifest, commit handoff, and readback closeout gates pass. `.env` values can supply credentials or command defaults, but they do not replace `source-manifest.json`, `profile-lock.json`, account/write guard reports, or checkpoint evidence.

Executable handoff evidence uses `tiangong-foundry.command-spec.v1`. The plan records `final_rows_artifact.path`, `bytes`, and `sha256`; both commit and verify specs bind that fact. `display` is informational only. A runner must parse exact keys, reject duplicated safety-critical flags, recheck the bound bytes, and call only `executable` plus `argv` with `shell=false`.

`execution_policy.max_parallelism` controls queue workers. Workers must claim tasks through CLI queue locks and dependency checkpoints. Blocked entities are written to the task blocker ledger with affected dependency closures and rerun instructions; unrelated ready scopes may continue and may commit if the write policy allows it.

For process-scope batch workflows, blocker artifacts are split by audience. `blocked-scope-ledger.jsonl` is the complete row-level fact source for automation and rerun planning. `blocked-scope-report.json` is required for every closure or runner evaluation and must summarize concrete blocker reasons, affected scopes, dependency types or examples, required human actions, and the rerun command.

## source-manifest.json

```json
{
  "schema_version": 1,
  "source_kind": "package",
  "source_paths": [
    {
      "path": "/abs/path/source.zip",
      "sha256": "<sha256>",
      "access": "local-private"
    }
  ],
  "source_citation": "BAFU 2025 package",
  "captured_at_utc": "2026-06-04T00:00:00Z"
}
```

For URL/API/database sources, replace `source_paths` with stable `retrieval_records` that include URL or API route, request id, provider, captured timestamp, and checksum/snapshot id when available.

## seed-manifest.json

```json
{
  "schema_version": 1,
  "seed_maturity": "execution_seed",
  "seed_type": "product",
  "target_entity": "process",
  "name": "lithium iron phosphate battery pack",
  "functional_intent": "production of 1 kWh battery pack capacity",
  "geography": "CN",
  "time_scope": "2025",
  "source_starting_points": [
    {
      "kind": "sci_query",
      "query": "lithium iron phosphate battery pack production life cycle inventory China"
    }
  ],
  "intended_use": "draft dataset",
  "quality_target": "field evidence required for critical values"
}
```

## checkpoint.json

```json
{
  "schema_version": 1,
  "stage_id": "curation-queue-verify",
  "status": "passed",
  "input_hashes": {
    "rows/processes.final.jsonl": "<sha256>"
  },
  "owner_command": "tiangong-lca dataset curation-queue verify --queue-dir ./curation-queue --type process --json",
  "artifacts": [
    "curation-queue/outputs/curation-queue-tasks.jsonl",
    "curation-queue-verify-report.json"
  ],
  "rows_scope": {
    "type": "process",
    "rows_file": "rows/processes.final.jsonl"
  },
  "decisions": [],
  "blockers": []
}
```

Allowed statuses are `pending`, `running`, `passed`, `failed`, and `waived`. A waiver must include explicit evidence and reviewer intent. A checkpoint is stale when an input hash, profile lock hash, account guard, or dependency readback hash changes.

## artifact-index.jsonl

Each line records one durable artifact:

```json
{
  "schema_version": 1,
  "artifact_id": "schema-process",
  "kind": "schema-report",
  "path": "schema/process/outputs/validation-report.json",
  "owner_command": "node scripts/foundry.mjs dataset-tidas-validate --type process",
  "sha256": "<sha256>",
  "created_at_utc": "2026-06-04T00:00:00Z"
}
```

The artifact index is the bridge between Foundry and owner commands. It should point to artifacts; it should not duplicate the artifact payload.

---
title: Dataset Authoring Skill Architecture
docType: design
scope: skill-orchestration
status: draft
owner: tiangong-lca-data-foundry
lastReviewedAt: 2026-05-29
lastReviewedCommit: 0c39afc18f1f2d8e01d2b33a39bdc0e21cea3a8f
related:
  - docs/runtime-skill-management.md
  - docs/capability-ownership-policy.md
  - docs/workspace-project-map.md
  - specs/automated-lca-capability-registry.json
---

# Dataset Authoring Skill Architecture

This document defines the executable design for TianGong LCA dataset authoring workflows after the current workspace submodules have been bumped to their latest `origin/main` revisions.

The important change from earlier BAFU runtime notes is that many primitives are now already implemented in `tiangong-lca-cli` and `tiangong-lca-skills`. The remaining problem is mostly orchestration: Foundry should call one top-level skill, that skill should select child skills, and child skills should call public CLI commands. Foundry should not keep task-local dataset adapters for reusable authoring behavior.

## Target Layering

```text
Foundry task / user entry
  -> Foundry router, workspace, profile, account context, checkpoint ledger
    -> top-level scenario skill
      -> reusable child skills
        -> Rust tidas plus public tiangong-lca-cli search, QA, curation, and publish commands
```

Foundry owns:

- task routing and workspace isolation;
- source manifests, profile loading, account context, and checkpoint recovery;
- capability registry and follow-up task creation when a shared primitive is missing;
- enforcement that reusable runtime logic belongs in CLI or skills, not in `.foundry/workspaces`.

Top-level skills own:

- scenario order;
- mode selection;
- child-skill invocation plan;
- checkpoint expectations between stages;
- stop/resume behavior.

Child skills own:

- one reusable capability or entity authoring workflow;
- agent-facing semantic decisions and stop rules;
- thin calls to public CLI commands.

CLI and owned runtime repositories own:

- deterministic execution;
- schema validation;
- remote IO and official write paths;
- reference refresh, readback verification, identity preflight, build-plan gates, source-language name-plan gates, and publish behavior.

## Current Implemented Surface

The latest checked-out `tiangong-lca-cli` already implements the following primitives that older BAFU notes treated as missing or Foundry-local:

| Area | Current command surface |
| --- | --- |
| Local schema gates | `node scripts/foundry.ts dataset-tidas-validate` → Rust `tidas validate` |
| Remote readback/reference checks | `tiangong-lca dataset verify-remote` |
| Reference refresh | `tiangong-lca dataset references refresh-remote` |
| Reference rewrite | `tiangong-lca dataset references rewrite` |
| Evidence search artifacting | `tiangong-lca dataset evidence-search plan/run` |
| Flow identity and generation gates | `tiangong-lca flow identity-preflight`, `tiangong-lca flow build-plan validate/materialize` |
| Process identity and generation gates | `tiangong-lca process identity-preflight`, `tiangong-lca process build-plan validate/materialize` |
| Process required fields | `tiangong-lca process complete-required-fields` |
| Entity-level import queue | `tiangong-lca dataset curation-queue build` |
| Flow/process governance and reference repair | `tiangong-lca flow fetch-rows`, `materialize-decisions`, `scan-process-flow-refs`, `plan-process-flow-repairs`, `apply-process-flow-repairs`, `regen-product`, `validate-processes` |
| Official writes already exposed | `tiangong-lca dataset publish-support`, `tiangong-lca publish run`, `process save-draft`, `flow publish-version`, `flow publish-reviewed-data`, lifecyclemodel publish/save-draft commands |

The latest checked-out `tiangong-lca-skills` already has reusable skills that should be composed before creating new ones:

| Skill | Current role in this architecture |
| --- | --- |
| `flow-governance-review` | Current flow child skill. It already wraps flow identity preflight, build-plan, QA, repair, publish-version, and publish-reviewed-data commands. |
| `process-automated-builder` | Current process child skill. It already wraps process identity preflight, evidence search, build-plan, required-field completion, and publish preparation. |
| `tidas-data-import` | Top-level CLI orchestration skill for package conversion and source-document authoring lanes. |
| `lca-publish-executor` | Current unified publish request facade over `tiangong-lca publish run`. |
| `tiangong-lca-remote-ops` | Process-focused remote maintenance and verification wrapper. Use only where process-specific remote maintenance is required. |
| `flow-hybrid-search`, `process-hybrid-search`, `lifecyclemodel-hybrid-search` | Retrieval helpers only. They produce candidates; they do not decide authoring or mapping. |

External source-evidence skills can also be used, but they are a different dependency class. They are resolved through `pnpm dlx skills@latest` at runtime and should not be copied into Foundry:

| Skill | Source | Current role in this architecture |
| --- | --- | --- |
| `document-granular-decompose` | `https://github.com/tiangong-ai/skills` | Floating document fulltext extraction skill for source-evidence dataset development. It returns source text candidates; Foundry/CLI still own field evidence capture, row authoring gates, and publish handoff. |
| `tiangong-kb-sci-search` | `https://github.com/tiangong-ai/skills` | Floating SCI literature evidence retrieval skill for source-evidence dataset development. It returns paper evidence candidates; Foundry/CLI still own evidence capture, field mapping, row authoring gates, and publish handoff. |

## Remaining Gaps

The current gap is not a broad CLI gap. The remaining work should be framed narrowly:

1. Add a top-level `external-dataset-curated-import` skill that composes existing child skills into the full import workflow.
2. Add a later top-level `source-evidence-dataset-development` skill for datasets authored from reports, papers, websites, enterprise documents, or source evidence without a structured LCA package.
3. Decide whether to rename or alias broad existing child skills into clearer authoring names:
   - `flow-governance-review` can serve as current `flow-authoring`, but its name is review-oriented.
   - `process-automated-builder` can serve as current `process-authoring` for evidence-development and generated-process cases, but curated-import process repair may need a clearer mode.
4. Add only the missing shared primitives if a real run requires them:
   - final mapping merge into one `mapping.csv` / JSONL contract;
   - structured source-package flow usage analysis for unused/intermediate/non-intermediate/elementary flow classification;
   - dataset visibility or remote verification expansion if a run needs target-scope readback beyond existing CLI commands.

These gaps should be implemented in `tiangong-lca-cli` first when deterministic, then exposed through thin skills. They should not be reintroduced as Foundry-local dataset scripts.

## Naming Rules

Use names that describe the target ability, not a historical project or one source package.

Top-level scenario skills:

- `external-dataset-curated-import`
- `source-evidence-dataset-development`

Reusable child skills:

- use existing skills first;
- introduce `flow-authoring`, `process-authoring`, `source-authoring`, `contact-authoring`, `unitgroup-authoring`, and `flowproperty-authoring` only when the existing child skill name or scope blocks clear orchestration;
- use cross-entity names for cross-cutting capability: `dataset-mapping`, `dataset-readback-verify`, `dataset-publish`.

Do not put account names, BAFU, project names, or source package names into generic skill names. Those belong in Foundry profiles, constraints, or workspace manifests.

Avoid splitting by source scenario when the target entity and output contract are the same. Use explicit mode values instead.

## Mode Contract

Modes are explicit inputs passed by Foundry or the top-level skill. Child skills must not infer mode from chat history.

Supported modes:

- `curated_import`: start from normalized structured data, trace, conversion mapping, and an import profile.
- `evidence_development`: start from source evidence, target scope, and a design brief.

Example child-skill request:

```json
{
  "mode": "curated_import",
  "entity": "flow",
  "profile": "bafu",
  "inputs": {
    "normalized_rows": "/abs/path/rows/flows.normalized.jsonl",
    "conversion_mapping": "/abs/path/mapping/conversion.csv",
    "remote_snapshot": "/abs/path/remote/flows.snapshot.jsonl"
  },
  "constraints": ["/abs/path/docs/import-profiles/bafu/constraints.md"],
  "out_dir": "/abs/path/.foundry/workspaces/<task-id>/05-flow-authoring"
}
```

## Top-Level Skill: `external-dataset-curated-import`

Use when a structured external LCA package already exists and must be converted, curated, written, and verified.

Default stages:

| Stage | Owner | Current reusable surface |
| --- | --- | --- |
| 1. Source intake | Foundry + top-level skill | Foundry source manifest and checksum checkpoint. |
| 2. Normalize | top-level skill -> normalization child skill | `node scripts/foundry.ts dataset-tidas-import` → Rust `tidas import`. |
| 3. Conversion QA | top-level skill + Rust tidas + CLI QA | `dataset-tidas-validate`, conversion mapping checks, source trace checks, then type-specific CLI QA. |
| 4. Contact/source/unit group/flow property authoring | child skills or top-level until split | Prefer existing records; use public CLI validation and evidence artifacts. |
| 5. Flow authoring | `flow-governance-review` now; future `flow-authoring` alias/name | `flow identity-preflight`, `flow build-plan`, flow candidate search, flow QA/repair, source-language name-plan. |
| 6. Process authoring | `process-automated-builder` plus dataset/process commands | `process identity-preflight`, `process complete-required-fields`, `dataset references refresh-remote`, QA gates. |
| 7. Mapping/report | future `dataset-mapping` | Merge conversion mapping, source-language curation evidence, reference changes, write/readback reports. |
| 8. Remote write | `lca-publish-executor`, `dataset publish-support`, flow/process publish commands | Official CLI/platform write paths only. No direct table writes. |
| 9. Readback verify | CLI/remote verification child skill | `dataset verify-remote`, targeted row fetch/verification, accepted-difference report. |

The top-level skill must not hand-edit entity rows directly. It prepares structured requests, invokes child skills or public CLI commands, records checkpoints, and stops when gates fail.

### Entity Queue Execution

Full structured imports must use entity-level queues rather than one package-sized curation batch. The top-level skill builds the queue after Conversion QA and before support/flow/process authoring:

```bash
pnpm exec tiangong-lca dataset curation-queue build \
  --processes /abs/path/rows/processes.normalized.jsonl \
  --flows /abs/path/rows/flows.normalized.jsonl \
  --support /abs/path/rows/sources.normalized.jsonl \
  --support /abs/path/rows/contacts.normalized.jsonl \
  --out-dir /abs/path/.foundry/workspaces/<task-id>/curation-queue
```

The queue is the contract between Foundry, the top-level skill, child skills, and parallel agents:

- `outputs/curation-queue-tasks.jsonl` is the authoritative task list.
- `outputs/curation-queue-locks.json` defines the exclusive `lock_key` values.
- `outputs/curation-queue-blockers.jsonl` must be empty before remote write.
- `entities/<type>s/<id>__<version>/input.jsonl` is the only row input owned by a task.
- `entities/<type>s/<id>__<version>/checkpoint.json` is the task's resume gate.

Parallelism is per entity, not per arbitrary batch. Five agents can run five independent process closures only after shared support and flow dependencies have passed. A process worker must consume finalized flow/support catalogs and must not repair shared reference rows itself.

The hard order is:

1. support rows first;
2. flow rows second;
3. process rows last;
4. mapping/report after all entity checkpoints pass;
5. official remote write after mapping gates pass;
6. readback verify after write reports exist.

If a run is interrupted, restart from pending, failed, or stale entity checkpoints. Do not restart already passed support/flow/process tasks unless their input hash, constraints hash, or dependency readback hash changed.

## Top-Level Skill: `source-evidence-dataset-development`

Use when there is no structured source dataset. The workflow starts from evidence intake and dataset design rather than format normalization.

Default stages:

1. Runtime source-evidence skill resolution when needed, then evidence intake and source freeze.
2. Goal, scope, system boundary, and entity plan.
3. Contact/source/unit group/flow property authoring.
4. Flow authoring.
5. Process authoring.
6. Lifecycle model authoring when needed.
7. Mapping/provenance report.
8. Remote write.
9. Readback verify.

This skill should reuse the same child skills as `external-dataset-curated-import`, with `mode=evidence_development`.

For document fulltext extraction, resolve the latest `document-granular-decompose` with `pnpm dlx skills@latest` and record the upstream ref under the task workspace before parsing. For SCI literature evidence, resolve `tiangong-kb-sci-search` the same way before retrieval. This keeps fast-moving evidence capability outside Foundry while preserving run-level auditability.

## Child Skill Responsibilities

### Flow Authoring

Use existing `flow-governance-review` until a clearer `flow-authoring` skill is created or aliased.

Responsibilities:

- exact UUID/version lookup first;
- account/public visibility and ownership check;
- semantic candidate generation through hybrid search only after exact lookup fails;
- candidate scoring and reuse/update/create/exception decision;
- classification selection from the TianGong/TIDAS taxonomy;
- name-part construction and cleanup;
- flow property and unit group linking;
- provenance and mapping evidence;
- schema, QA, and publish-readiness gates.

Hybrid search is only a candidate generator. It does not replace exact lookup, support consistency checks, classification decisions, elementary-flow policy, or mapping evidence.

### Process Authoring

Use existing `process-automated-builder` plus dataset/process CLI commands until a clearer `process-authoring` skill is created or aliased.

Responsibilities:

- refresh all global references before final validation or write;
- repair exchanges, directions, units, reference flow, and quantitative references;
- fill required fields from source evidence or documented fallback rules;
- author reference year, annual supply/production, review/source/contact refs, and source-language fields;
- use finalized flow refs rather than reconstructing referenced flow text independently;
- run schema and semantic QA gates;
- produce process rows that reference final authored flows and support records.

### Dataset Publish

Use `lca-publish-executor` and entity-specific publish commands that already exist. Do not publish unless upstream identity, build-plan, schema, QA, reference, mapping, and readback-preflight gates are passed.

Publish gaps should become CLI tasks when the missing entity set cannot be written through the existing public command surface.

### Dataset Readback Verify

Use `tiangong-lca dataset verify-remote` directly or through a child skill.

Responsibilities:

- refetch or verify written rows from the target account/public scope;
- check root rows and referenced records resolve remotely;
- diff against final authored rows and mapping reports where possible;
- produce final verification status and accepted differences.

## Checkpoint Rules

Every top-level workflow stage writes:

```text
.foundry/workspaces/<task-id>/checkpoints/<NN>-<stage-id>.json
```

Each checkpoint includes:

- mode, scenario, profile, and constraints snapshot hash;
- runtime skill resolution details when external source-evidence skills were used;
- input paths and input hashes;
- output paths and output hashes;
- invoked skill and CLI commands;
- validation or gate status;
- remote write mode;
- blockers and follow-up hints.

On restart, the top-level skill resumes from the first missing, failed, stale, or input-mismatched checkpoint. If an upstream checkpoint changes, downstream checkpoints are stale until rerun.

## Current Implementation Order

1. `tiangong-lca-cli` owns `dataset curation-queue build/next/verify`.
2. `tiangong-lca-skills` owns the top-level `external-dataset-curated-import` and `source-evidence-dataset-development` workflow skills.
3. Foundry routes structured import and source-evidence tasks to those skills and CLI commands instead of expanding its public `dataset:*` command surface.
4. Existing child skills remain the first reuse targets: `tidas-contract-context`, `tidas-data-import`, `flow-governance-review`, `process-automated-builder`, and `lca-publish-executor`.
5. New child aliases should be added only where naming or scope blocks clear composition.
6. Source-evidence extraction and research dependencies use `.agents/shared-skills.json` plus runtime `pnpm dlx skills@latest` resolution records instead of committing external skill repositories as Foundry-owned code.
7. Remaining Foundry-local dataset wrappers are migration shims until equivalent CLI/skill owner surfaces exist.

## Retired Local-Adapter Assumption

Older BAFU runtime notes extracted Foundry-local scripts under `scripts/dataset/` for reference refresh, remote verification, batch publish, support publish, flow usage, candidate search, and mapping merge.

That assumption is no longer the target architecture. After the latest CLI/skills updates:

- remote verification belongs to `tiangong-lca dataset verify-remote`;
- remote reference refresh belongs to `tiangong-lca dataset references refresh-remote`;
- evidence search artifacting belongs to `tiangong-lca dataset evidence-search`;
- process/flow identity and build-plan gates belong to `process/flow identity-preflight` and `process/flow build-plan`;
- Foundry-local reusable dataset scripts should not be restored unless they are temporary migration shims with a tracked deletion plan.

Any future missing primitive should be recorded as a capability-development task for the owning repository, not as durable Foundry-local runtime logic.

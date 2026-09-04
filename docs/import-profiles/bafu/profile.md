---
title: BAFU External Dataset Import Profile
docType: import-profile
scope: bafu
status: draft
owner: tiangong-lca-data-foundry
---

# BAFU External Dataset Import Profile

Task authorization follows `docs/task-authorization-contract.md`. Historical account overrides and material-balance observations are evidence for their original task only. New tasks inherit source rules and preparation behavior, with no mint/write action or automatic QA waiver; all required account, unit-scale, context and closure gates remain active.

This profile defines the durable orchestration contract for converting the BAFU source package into TianGong-ready ILCD/TIDAS data and writing it into the approved BAFU account. It is the Foundry-facing profile for the workflow; task-local files under `.foundry/workspaces/` are runtime artifacts, not the source of truth for the workflow.

BAFU-specific data curation rules live in `docs/import-profiles/bafu/constraints.md`. The BAFU leaf process classification authoring helper is documented in `docs/import-profiles/bafu/leaf-process-classification-authoring.md`; it prepares task-bound AI/human classification work and non-authoritative candidates, not final semantic classifications by itself. The Foundry task workspace must lock the constraints snapshot before generating mutation plans, remote write requests, or final mapping reports.

## Execution Layers

The BAFU import must be executed through the normal Foundry stack:

```text
Foundry task / user entry
  -> Foundry task router and workspace state machine
    -> top-level external dataset curated import skill
      -> specialized skills for conversion, flow governance, process governance, publish, and verification
        -> Rust tidas, tiangong-lca-cli, search, QA, and publish commands
```

Foundry owns task state, workspace isolation, source manifests, checkpoints, evidence, and gate reconciliation. The top-level skill owns the agent-facing workflow order and dispatches to the correct specialized skills. Deterministic conversion and schema validation belong in unified Rust `tidas`; contract context, QA/curation, and remote operations belong in `tiangong-lca-cli` and the relevant TianGong skill wrappers, not in task-specific Foundry scripts.

Historical BAFU runtime scripts under `.foundry/workspaces/` may be used as implementation evidence, but reusable execution logic must be promoted into the owning CLI or skill repository before it becomes part of a durable import workflow. The current ownership plan is recorded in `docs/skill-orchestration/dataset-authoring-skill-architecture.md`.

## Execution Entrypoint

This entrypoint is for structured entity curation. It applies after BAFU source material has been normalized into TIDAS/ILCD rows, or after another authoring workflow has produced draft structured rows. It is not a first-pass workflow for raw PDFs, reports, screenshots, web pages, free-text notes, or arbitrary spreadsheets.

For unstructured-only inputs, use an upstream source-evidence and draft-dataset authoring workflow first: extract facts, preserve citations, make source assumptions explicit, and create draft TIDAS rows. After that, build the curation queue and enter the flow below.

After the curation queue exists, every worker must ask the CLI for the next action before changing rows:

```bash
pnpm exec tiangong-lca dataset curation-queue next \
  --queue-dir .foundry/workspaces/<task-id>/curation-queue \
  --entity-type <support|flow|process> \
  --limit 1 \
  --out-dir .foundry/workspaces/<task-id>/execution-next
```

The returned action is the execution contract for that turn. A worker may run the returned CLI command or invoke the returned child skill with the returned input/output artifacts, then it must call `curation-queue next` again. The returned action manifest and its hashes are part of the contract: source-name drafts, apply evidence, and validation reports must carry matching artifact lineage for the current queue task. For import, update, write, or rerun requests, this loop continues until the requested support, flow, and process scopes all return `status=complete`. Workers must not choose arbitrary process batches, select "already clean" rows, or author final names/classifications through task-local scripts. Same-name files and recovered/debug backfills are not publishable completion evidence. This is the execution-time control; the prewrite evidence gate is only the final backstop.

Workers may run in parallel when the queue lock table, `depends_on` checkpoints, and task `max_parallelism` policy prove that returned tasks are independent. A blocked entity must write its blocker artifact and keep the blocked dependency closure out of commit scopes, but it must not stop unrelated ready bundle/process tasks from continuing through finalize, commit, readback, and closeout. A retry after human or database support repair resumes from the same queue/checkpoint state and claims only tasks that are not already completed.

If `curation-queue verify` is `blocked` while any `curation-queue next` scope still returns `status=ready`, the correct action is to continue the queue, not to stop the run or report a final blocker. Stop only when `next` itself is blocked, when there is no runnable next action but verify remains blocked, or when another profile gate requires human input.

Codex can still create or revise a run-level plan when the profile is new or the source is not yet structured. That plan must be persisted as profile constraints, source manifests, queue tasks, entity run plans, and checkpoints before execution starts. During entity execution, the CLI state machine provides stable order and artifact contracts; Codex provides semantic decisions only at the child-skill steps that explicitly request them.

## User Launch Contract

The user-facing trigger should be short. In Codex or Foundry, a user may write:

```text
把 BAFU 数据写入数据库
```

or:

```text
导入 BAFU 数据到 TianGong
```

Foundry/Codex should route these requests to `external-dataset-curated-import`, then resolve this BAFU profile, the BAFU constraints file, the source manifest, the BAFU account profile, and any existing checkpoints. The user should not need to paste the stage list, account guard command, source paths, or detailed constraints in the prompt when those durable files exist.

Runtime `.env` values may supply credentials or CLI defaults, but they are not the durable launch contract. The task workspace must still contain or generate `source-manifest.json`, `profile-lock.json`, account/write guard evidence, the selected BAFU source directory, and the selected converted bundle index. For the current BAFU package, the source manifest/profile lock should point downstream execution at the converted `process-bundles/index.json` and per-process bundle directories; the root `tidas/` directory is retained as conversion output/evidence, not the normal starting point for process-level curation.

If the source manifest or account context cannot be resolved, stop and ask only for the missing item. Do not ask the user to restate the full workflow.

## Closed-Loop Regression Contract

When a BAFU import attempt exposes a reusable defect in Rust tidas, the CLI/SDK context surface, shared skills, or this profile, the next run must be treated as a regression cycle rather than an isolated manual retry:

1. Fix the defect in the owning repository and rebuild the affected local tool before invoking it from Foundry.
2. Start a fresh downstream workspace from this BAFU profile, the current source manifest, and the selected converted `process-bundles/index.json`.
3. Build a fresh entity queue with `pnpm exec tiangong-lca dataset curation-queue build`, using the current support, flow, process, external-flow-ref, and packaged bundle closure files.
4. Run `curation-queue next` through support, flow, and process scopes until the requested scope returns `complete`; multiple workers may claim independent tasks up to the task `max_parallelism`.
5. If a task is blocked, report the exact entity task, command, input artifact, output artifact, validation report, owning repository defect or missing canonical database support, and affected dependency closure. Keep unrelated runnable tasks moving instead of summarizing a prewrite gate with remaining runnable `next` actions as the final blocker.
6. For scopes that are not blocked, run prewrite verify, policy-gated formal BAFU account write, and readback verify.

This lets a user start from a short instruction such as `把 BAFU 数据写入数据库`; the durable profile, constraints, account guard, queue, and checkpoints carry the detailed workflow.

## Resume Contract

The workflow is a resumable nine-stage state machine. Every stage must write a checkpoint before the next stage starts:

```text
.foundry/workspaces/<task-id>/checkpoints/<NN>-<stage-id>.json
```

Each checkpoint must include:

- `stage_id`, `stage_number`, `status`, and timestamps.
- input file paths plus content hashes or source record ids.
- output file paths plus content hashes.
- commands or skills invoked, including project root and version/commit when available.
- gate report path and pass/fail counts.
- remote-write mode, if relevant.
- execution policy fields such as `max_parallelism`, claimed worker id, and blocker isolation status when the stage was run by a batch runner.
- residual blockers and follow-up task hints.

Allowed checkpoint statuses are `pending`, `running`, `passed`, `failed`, and `waived`. A waiver must include explicit evidence and reviewer intent. On restart, the Foundry run resumes from the first stage whose checkpoint is absent, failed, running-stale, waived-with-expired-inputs, or whose input hashes no longer match. If any upstream stage is invalidated, all downstream stages must be treated as invalid until rerun.

## Prewrite Evidence Gate

Before stage 8 may commit anything to the BAFU account, Foundry must run:

```bash
pnpm exec tiangong-lca dataset curation-queue verify \
  --queue-dir .foundry/workspaces/<task-id>/curation-queue \
  --out-dir .foundry/workspaces/<task-id>/prewrite-evidence-gate
```

The gate report must be `passed` and referenced by the stage 8 checkpoint. It must check action lineage for the current queue task. Artifact filenames, runtime-written `checkpoints/*.json`, schema validation, name-quality validation, remote dry-run, and readback verification cannot substitute for required entity closure and name-plan authoring proof.

If the gate is blocked, do not publish. Resume the missing support/flow/process entity tasks from their queue work directories and regenerate the affected stage checkpoints. Task-local report finalizers may summarize completed gates, but they must not synthesize passed checkpoints without the child artifacts named by the prewrite evidence gate.

## Stage Order

| No. | Stage | Purpose | Required output | Gate before next stage |
| --- | --- | --- | --- | --- |
| 1 | Source intake | Freeze source package identity. | source manifest with zip path, checksum, source URL/evidence, package version, extraction directory, and license/source notes. | checksum and extraction manifest present; source identity is unambiguous. |
| 2 | Normalize | Convert source formats into working ILCD/TIDAS artifacts. | TIDAS JSON, ILCD output, mapping CSV, Rust operation/import reports, command manifest, and `process-bundles/index.json` with one dependency bundle per converted process. | `dataset-tidas-import` completed with a compatible Rust 0.2.x handshake and complete operation report; outputs exist; the BAFU execution source manifest points to the converted bundle index for process-level curation. |
| 3 | Conversion QA | Check conversion quality before curation. | QA report for exchange direction, EcoSpold trace, schema validation, and mapping completeness. | exchange direction and trace are usable; schema/mapping blockers are zero or explicitly recorded for repair. |
| 4 | Support curation | Curate writable contact/source records and select compliance, unit group, and flow property references first. | source-language contact/source rows, public canonical mapping, account-local support candidate registry, validation report, and reuse decisions. | all required support refs resolve; public FP/UG are reused where possible; task-authorized account-local FP/UG are same-owner `state_code=0`, carry scale/closure evidence, and remain outside the public cache. |
| 5 | Flow curation | Curate all referenced flows before process curation. | source-language flow rows with public-flow matching, account-local candidate evidence, classification, name split, property/unit refs, provenance, and validation reports. | every process-referenced flow has `curated_pass`; elementary flows reuse public canonical where proven, while task-authorized unmatched candidates remain same-owner `state_code=0` and outside the global LCIA cache; unresolved identity decisions block dependent writes. |
| 6 | Process curation | Curate processes against finalized support and flow refs. | source-language process rows with refreshed global refs, exchanges, reference year, annual supply/production, review/source/contact, provenance, and validation reports. | all process refs point to finalized support/flow rows; required fields are filled with traceable evidence; schema and semantic gates pass, except profile-declared QA-code waivers recorded in the checkpoint. |
| 7 | Mapping/report | Record every material difference from source to final TianGong TIDAS payload. | final `mapping.csv`, methodology report, unresolved issue reports, and principles-new-add file if new rules were discovered. | mapping covers source ids, final ids, field-level changed values, reuse decisions, and unresolved exceptions. |
| 8 | Remote write | Commit approved rows to the formal BAFU account. | prewrite evidence gate report, official source/contact handoff, profile-specific owner-draft support maintenance report when applicable, flow/process save-draft/upsert reports, retry reports, and duration metrics. | `dataset curation-queue verify` passed for the committed scope; write uses official account-guarded CLI/platform paths only; task write policy permits the exact commit scope; no direct table writes; account-local FP/UG remain current-owner `state_code=0` unless a separate expert-approved promotion plan applies; failures are isolated for targeted retry. |
| 9 | Readback verify | Verify the remote account state after commit. | remote readback snapshots, diff report against stage 7 outputs, final write status, and final verification summary. | every committed row is found remotely and matches the intended final payload or has a documented accepted difference. |

## Stage Rules

### 1. Source Intake

Record the exact source zip, checksum, source location, package title/version, and extraction directory. The source package itself remains runtime/private input unless separately approved for tracking.

### 2. Normalize

Use `node scripts/foundry.ts dataset-tidas-import` as the conversion entrypoint so unified Rust `tidas` owns the stable conversion contract. Produce ILCD output when requested, TIDAS JSON, mapping CSV, `import-report.json`, `issues.jsonl`, and default per-process dependency bundles under `process-bundles/` in the task workspace. The normalized output is not yet TianGong-ready data. For BAFU whole-package imports, downstream process curation starts from the bundle index and per-process bundle directories so each process closure can be claimed, blocked, retried, or committed independently; direct traversal of the root `tidas/` tree is only a fallback for conversion audit or rebuilding bundle-derived row files.

### 3. Conversion QA

Check conversion artifacts before any data curation. Known BAFU conversion risks include exchange direction, EcoSpold source trace retention, schema validity, and source-to-target mapping coverage.

### 4. Support Curation

Support records are upstream dependencies. Curate them before flows and processes so later global references are materialized from approved support records, not regenerated inside each process.

### 5. Flow Curation

Flow curation must include identity matching, classification, source-language name-part construction, flow property/unit group selection, and provenance. Flow classification must use the TianGong/TIDAS taxonomy selected through curation; source classifications must be preserved as provenance, not copied as final target taxonomy when they are not valid TianGong classifications.

### 6. Process Curation

Process curation must consume finalized flow and support records. It must refresh global references before validation instead of failing late on stale refs. Required process fields such as reference year and annual supply/production must be filled from traceable source evidence or an explicitly documented package-level fallback rule. For `annualSupplyOrProductionVolume`, missing source evidence uses Foundry's deterministic `9999 missing-data-sentinel/year` placeholder rather than `common:other` deferral; the value is intentionally non-physical and searchable so database-side curation can replace it later.

CLI process/flow/lifecyclemodel QA is a deterministic QA report, not the profile policy decision point. Foundry owns dataset curation, AI authoring packages, deterministic prewrite cleanup, waiver decisions, and final prewrite status. The BAFU full-context gate applies to flow/process/lifecyclemodel scopes; contact and true-source rows remain governed by source/contact policy, while task-authorized account-local FP/UG require a separate candidate registry with exact owner/state, unit-scale, closure, immutable-plan, audit, and readback proof. Curation must still use SDK schema/YAML, classification/location tasks, exact-payload identity preflight, and deterministic patch/cleanup lineage. Before commit, the mutation manifest must prove the exact reference closure: public support resolves through the public canonical cache; account-local FP/UG resolve through the same-owner `state_code=0` candidate registry and remote verify; mixed visibility or cross-owner closure blocks. Data-format, compliance, or placeholder sources remain invalid as true source rows. Profile-specific QA waivers are allowed only when named in `docs/import-profiles/bafu/constraints.md`; `process_material_balance_deviation` remains an account-level observation and all other schema/content issues remain action items unless explicitly updated.

### 7. Mapping And Report

The final mapping must combine format conversion mapping and TianGong curation mapping. It must show where final TianGong TIDAS payloads differ from the source-derived TIDAS artifacts, including ids, versions, refs, source-language names, classifications, support refs, and documented exceptions.

### 8. Remote Write

Remote writes must use the approved account context and official CLI/platform write paths. Direct table writes, RLS bypasses, or task-local database shortcuts are not allowed. When the task write policy allows automated batch commit, a batch runner may run the generated commit command for exact scopes whose finalize report, mutation manifest, commit handoff, and prewrite queue verify all pass. Blocked scopes are recorded and excluded from commit; independent scopes continue. `delete` is not part of the automated write workflow; rows that should be removed must be listed for human action.

### 9. Readback Verify

The workflow is not complete when the write command succeeds. It is complete only after remote readback confirms that all intended rows exist in the BAFU account and match the final curated payloads or an explicitly documented accepted difference. Use `pnpm exec tiangong-lca dataset verify-remote --compare-root-payload --target-user-id <bafu-user-id> --state-code <expected-code>` for the committed root rows and retain its `remote-verification-report.json`.

For large BAFU resumes, the ready-scope batch runner should use the resumable controls instead of restarting from the original ready order: `--pending-only`, `--selection-order estimated-weight-asc`, a fresh `--pause-file`, and an operator-chosen `--stop-after-blocked` threshold. `--preflight-only` is the read-only way to inspect the next selected scopes and the active skip/blocker state before opening the writer. The batch support identity cache (`import-ledger/verified-support-identities.jsonl`) is part of the run ledger: once a support contact/source closeout is verified, later scopes may reuse that identity and skip duplicate support handoff while preserving the process/flow commit and post-write verification requirements.

## New Principle Capture

If a run discovers a new rule that should become durable policy, write it to the task workspace as `principles-new-add.md` and reference it from the stage 7 checkpoint. Do not silently fold new rules into the run without review.

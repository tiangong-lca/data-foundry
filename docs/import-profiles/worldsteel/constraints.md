---
lastReviewedAt: 2026-09-07
lastReviewedCommit: 1f37034f7451e95fc5e3efc4528b15245c77b377
lastReviewedNote: "Reviewed for Foundry #112: adopt provenance-verified public CLI 0.1.11 and its exact runtime/source pins. Existing profile rules, task authorization, storage ownership and historical case evidence are unchanged; the managed Foundry host and final F1 publication remain pending."
title: worldsteel Import Constraints
docType: constraints
scope: import-profile
status: draft
authoritative: true
owner: tiangong-lca-data-foundry
language: en
whenToUse:
  - when deciding whether a Worldsteel canonical-cache miss may enter an owner-draft support scope
  - when evaluating unit-scale, closure, handoff, or readback blockers for Worldsteel
whenToUpdate:
  - when Worldsteel support authorization, ordering, or blocking semantics change
  - when the shared support/finalize engine changes the enforceable candidate boundary
checkPaths:
  - specs/import-profiles.json
  - scripts/commands/worldsteel-batch-import-run.ts
  - scripts/commands/bafu-batch-import-run.ts
  - scripts/commands/post-authoring-finalize.ts
  - docs/import-profiles/worldsteel/profile.md
  - docs/import-profiles/worldsteel/constraints.md
  - docs/import-profiles/worldsteel/import-plan.md
  - docs/import-profiles/worldsteel/import-coverage.md
  - test/unit/worldsteel-support-mint-truth.test.mts
related:
  - docs/import-profiles/worldsteel/profile.md
  - docs/import-profiles/worldsteel/import-plan.md
  - specs/import-profiles.json
---

# worldsteel Import Constraints

Current task authorization is defined by `docs/task-authorization-contract.md`. Distributed profiles grant no mint/write action or QA waiver. The dated R1–R5 decisions and inventories below are historical case evidence; new tasks require their own exact binding and action evidence. Local candidate preparation remains available, and old locks/seals/attempts are not rewritten or replayed.

## Reference-by-UUID first (the dominant policy)

The ~1,315 EF3.1 reference elementary flows + every FP/UG present in the canonical-support cache are **reused by their original canonical UUID** through the offline library-resolution `exchange-reference-rewrites.jsonl` (applied by the runner's `applyResolutionRewrites`). A canonical row is **never minted**. Each rewrite row must carry `canonical_short_description` so committed exchanges show the flow name, not the UUID.

## Authorized account-local exceptions (2026-06-29 and 2026-07-01)

The distributed Worldsteel profile grants no account-local exception. The historical 2026-06-29 decision authorized the small residual of **GaBi/Sphera pseudo-elementary flows** (dataSetVersion 20.25.x) that have no canonical match — **expected at most 17** — as account-local My Data (`state_code=0`). The 2026-07-01 delivery decision separately supersedes the earlier FP/UG reference-only statement: `mintUnmatchedFpUgSupport=true` admits materialized FP/UG whose UUID is absent from the canonical-support cache into the same task-gated support path.

- These residual flows are **NOT** matched by UUID; the AI judges reuse-vs-mint from **full context**.
- The final elementary mint count is reviewed **after** the UUID-reuse pass. New tasks start with no elementary or support write actions; select each required action through task authorization.
- Canonical FP/UG are always reused. For cache misses, Unit Groups are ordered before Flow Properties and candidates are normalized to same-owner My Data version `00.00.001`; they never enter the public canonical cache.
- The retained 10+10 EF3.1 LANCA gap explains why the support flag was enabled, and the historical delivery inventory records 11+11 owner rows. The runtime has no LANCA name whitelist or numeric hard cap: its enforceable candidate boundary is the canonical-cache miss inside the materialized ready-scope closure.
- Support preparation/commit/readback failure blocks and defers the dependent flow/process scope. Independent ready scopes may continue, but no failed support scope may be treated as complete.

## Gates that REMAIN blocking (NOT relaxed)

- both unit-scale safety blockers: `canonical_support_amount_scaling_required` and `canonical_support_amount_scale_unresolved`;
- schema validation through Rust tidas against its locked corrected eILCD schemas (not raw EF3.1), deterministic QA (a process material-balance observation requires current approval and source-model evidence), curation, and full-context AI proof for `flow`/`process`/`lifecyclemodel`;
- remote write requires dry-run, queue verify, commit handoff, closeout, and readback verification, **and account/write-policy approval before any remote commit** — `allow_remote_commit` stays false until then.

## worldsteel-specific identity & attribution

- **Library contact:** packaged id `d5710976@20.20.002` is occupied by another account and is not a usable public reference. Mint one deterministic same-owner contact at `00.00.001` from the runner's real World Steel Association identity fields; never substitute BAFU/FOEN defaults.
- **Database fallback source:** processes whose data source resolves to a placeholder cite the synthesized `worldsteel LCI database` source — never the BAFU 2025 default.
- **Version:** preserve source `dataSetVersion` inside the ILCD/TIDAS payload for provenance. New Worldsteel-owned DB rows use key `00.00.001`; canonical references keep their current published versions.
- **LCIA methods:** the 25 EF3.1 LCIA method datasets are reference/provenance only and are NOT written inline by the import.
- **External documents:** the 13 `referenceToDigitalFile` binaries are uploaded to the `external_docs` bucket and the source `@uri` rewritten by `tiangong-lca dataset source upload-attachments` (authenticated as `data@worldsteel.org`) before write; plain `http(s)` referenceToDigitalFile URIs are left untouched.

## Runtime governance additions (2026-07-01)

Landed while committing the first worldsteel processes; all are gated to the worldsteel profile so BAFU/USLCI are byte-for-byte unchanged.

- **Process-name source metadata.** Source names such as `Steel rebar Global 2022`, `Steel sections EU 2019` and `Steel ECCS Global 2021 v2` retain their trailing geography/year metadata. Only that single `latin-author-year` match in a process `baseName` is classified as source naming metadata. Additional author/year matches, table/figure markers, other name fields and all flow/lifecyclemodel names remain checked. There is no `waived_content_policy_rules_by_type` permission.

- **Foreign/RLS-hidden drafts are not references.** The historical process exchange pointing at `3c4b0e5d "Slag (deposited)" @00.00.001` resolved only under a different account at `state_code=0` and is invisible to `data@worldsteel.org`. That cross-account observation is not valid readback evidence. Current runs must keep `missing_dataset` blocking and replace the exchange with an allowed public or same-owner visible reference; no trusted-key list may convert it to passed. Production-test account runs are unconditionally fail-closed.
- **Canonical reuse pinned to latest published version.** Reuse-by-UUID decisions are swept to the latest `state_code=100` version before commit (the post-write readback rejects references below a flow's latest published version). Only flows that drifted are updated.

### Corrections to the initial plan

The contact and version bullets above are the current contract and supersede the initial packaged-contact reuse and native DB-row-version assumptions. The deterministic contact uses `steel@worldsteel.org`, classification `Organisations > Other organisations`, and `Avenue de Tervueren 270, 1150 Brussels`; new owner-draft rows use `00.00.001`, while source versions remain inside the payload as provenance.

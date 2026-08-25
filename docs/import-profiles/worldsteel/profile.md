---
lastReviewedAt: 2026-08-26
lastReviewedCommit: 38f1291d99571c7af377b8dca89d39fd690eb8d0
lastReviewedNote: "Reviewed for Issue #68 against the frozen executable factory, PR #20 delivery rationale, retained coverage, and current shared support/finalize behavior."
title: worldsteel Import Profile
docType: profile
scope: import-profile
status: draft
authoritative: true
owner: tiangong-lca-data-foundry
language: en
whenToUse:
  - when selecting the Worldsteel import profile, runner flags, or account-local support policy
  - when interpreting which canonical references are reused and which candidates remain gated
whenToUpdate:
  - when the frozen Worldsteel adapter/profile value or support candidate boundary changes
  - when a retained delivery decision changes the Worldsteel import policy
checkPaths:
  - specs/import-profiles.json
  - scripts/commands/worldsteel-batch-import-run.ts
  - docs/import-profiles/worldsteel/profile.md
  - docs/import-profiles/worldsteel/constraints.md
  - docs/import-profiles/worldsteel/import-plan.md
  - docs/import-profiles/worldsteel/import-coverage.md
  - test/unit/worldsteel-support-mint-truth.test.mts
related:
  - specs/import-profiles.json
  - docs/import-profiles/worldsteel/import-plan.md
  - docs/import-profiles/worldsteel/constraints.md
  - docs/foundry-task-contracts.md
  - inputs/CUP2025-2_2022b_v10_worldsteel_products_Tiangong_v1 EF3.1 2026_01_27
---

# worldsteel Import Profile

Profile for the worldsteel EF3.1 native ILCD 1.1 package (`inputs/CUP2025-2_2022b_v10_worldsteel_products_Tiangong_v1 EF3.1 2026_01_27`). worldsteel stays data/profile configuration plus the small, reusable code touchpoints documented in `docs/import-profiles/worldsteel/import-plan.md` §5 — not a bespoke Foundry code path.

## Lane

`external-dataset-curated-import` for a native ILCD package. Unified Rust `tidas` owns ILCD→TIDAS conversion and schema validation; the `tiangong-lca` CLI retains QA/curation and remote handoff. The reference data is validated against the locked schemas shipped by Rust tidas, never raw EF3.1.

## Scope

- **New payload (authored):** 33 steel LCI-result processes (mass-based, GLO/Europe/EU, 2022; LCIAResult=0 on all 33 — expected for LCI results) + ~57 product/waste/other flows + up to 17 GaBi/Sphera pseudo-elementary flows + a thin worldsteel contact/source/flow-property overlay.
- **Reference payload (canonical-first):** ~1,315 EF3.1 reference elementary flows + most flowproperties/unitgroups, reused **by their original canonical UUID** via the offline library-resolution `exchange-reference-rewrites.jsonl` (`applyResolutionRewrites`). A canonical row is never minted. Materialized FP/UG absent from the canonical-support cache follow the separately gated account-local path below. The 25 LCIA methods are out of scope (reference/provenance only).

## Resolved Decisions (2026-06-29, superseded where noted on 2026-07-01)

- **Account:** `data@worldsteel.org` (API key in the foundry `.env` active `WORLDSTEEL ACCOUNT` block). Writes are state_code=0 (My Data).
- **Reuse by UUID:** the canonical DB already holds the EF3.1 flows under their original UUIDs, so the ~1,315 reference flows are reused deterministically by UUID (no semantic search). See `docs/import-profiles/worldsteel/import-plan.md` §7.
- **Capped elementary mint:** `allow_account_local_support_and_elementary` authorizes the ≤17 GaBi/Sphera pseudo-elementary flows (dataSetVersion 20.25.x) with no canonical match. These are NOT matched by UUID — the AI judges reuse-vs-mint from full context. Final elementary mint count is reviewed after the UUID-reuse pass.
- **Unmatched FP/UG support (2026-07-01):** the later delivery decision supersedes the earlier FP/UG reference-only statement. The executable contract is `mintUnmatchedFpUgSupport=true`: each materialized flow property or unit group whose UUID is absent from the canonical-support cache enters the profile-authorized account-local support candidate set. The observed reason was 10+10 EF3.1 LANCA rows and the retained owner inventory was 11+11; neither the names nor the counts are a runtime whitelist/cap.
- **Library/attribution contact (2026-06-30 correction):** packaged id `d5710976@20.20.002` is occupied by another account and is neither public nor visible to the Worldsteel account. The runner therefore omits `contactId`/`contactVersion` and mints one deterministic same-owner `00.00.001` contact carrying the real World Steel Association name, address, classification, website, phone, and `steel@worldsteel.org` identity.
- **Database fallback source:** worldsteel processes whose data source resolves to a placeholder cite the synthesized `worldsteel LCI database` source (`source-semantics.ts` worldsteel branch), never the BAFU default.
- **External documents:** the 13 `referenceToDigitalFile` binaries are uploaded to the `external_docs` storage bucket and the source `@uri` rewritten by the `tiangong-lca dataset source upload-attachments` CLI command, authenticated as `data@worldsteel.org`, before write.
- **Version (2026-06-30 correction):** preserve source `dataSetVersion` inside the ILCD/TIDAS dataset for provenance. New Worldsteel-owned flows, support, processes, sources, and contact use DB row-version key `00.00.001` because native slots are occupied by other accounts; canonical references retain their current published versions.

## Initial Policy

- QA waiver: `process_material_balance_deviation` (warning, not a remote-write blocker), mirroring BAFU/USLCI.
- Full-context AI completion required for authored `flow`/`process`/`lifecyclemodel` scopes (identity/classification/location decision tasks with sha-bound proof).
- Build entity queues with `tiangong-lca dataset curation-queue build`; require `curation-queue verify` before write planning.

## Support mint / blocked-review boundary

Canonical FP/UG are always reused. An unmatched candidate remains same-owner My Data (`state_code=0`, row version `00.00.001`), is ordered Unit Group before Flow Property, and never enters the public canonical cache. Unit-scale (`canonical_support_amount_scaling_required` and `canonical_support_amount_scale_unresolved`), schema, QA, curation, reference closure, dry-run, commit-handoff, and readback gates are unchanged. If support preparation, commit, or verification fails, the dependent flow/process scope is blocked and deferred; independent ready scopes may continue. This flag grants neither review nor publish authority.

## Runner

`scripts/commands/worldsteel-batch-import-run.ts` (`dataset-worldsteel-batch-import-run`) wraps the BAFU per-scope engine with: `enableBafuAutofill=false`, `enableFamilySignatures=false`, `commitFlowSupportInline=true`, `mintUnmatchedFpUgSupport=true`, `applyResolutionRewrites=true`, and the real World Steel Association `libraryContact` identity fields used to derive the deterministic owner-draft contact.

## Open Decisions

- The exact residual count of GaBi/Sphera pseudo-elementary flows that mint (≤17) — decided after the UUID-reuse pass. Set `allow_account_local_support_and_elementary.enabled=false` only when both this R3 elementary residual and the R5 unmatched FP/UG support path are no longer required.
- Whether to land the finalize-trusts-resolution-rewrites speed-up before the full run (all 33 processes are ~2,000–2,543-exchange mega-scopes). See `docs/import-profiles/worldsteel/import-plan.md` §8.
- `allow_remote_commit` stays human-gated until the pilot scope is verified.

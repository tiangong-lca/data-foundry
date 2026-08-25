---
lastReviewedAt: 2026-08-26
lastReviewedCommit: cc3505e7d8c7fe531dc3f8c0f2787b5b3a7398e8
lastReviewedNote: "Reviewed for Issue #68 against the frozen executable factory, PR #20 delivery rationale, retained coverage, and current shared support/finalize behavior."
title: worldsteel Import Profile
docType: profile
scope: import-profile
status: draft
owner: tiangong-lca-data-foundry
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
- **Library/attribution contact:** the package's own worldsteel contact `d5710976-d600-11da-a94d-0800200c9a66` (World Steel Association) is **reused** as the single shared library contact, not minted fresh. Threaded via the runner's `libraryContact.contactId`/`contactVersion`.
- **Database fallback source:** worldsteel processes whose data source resolves to a placeholder cite the synthesized `worldsteel LCI database` source (`source-semantics.ts` worldsteel branch), never the BAFU default.
- **External documents:** the 13 `referenceToDigitalFile` binaries are uploaded to the `external_docs` storage bucket and the source `@uri` rewritten by the `tiangong-lca dataset source upload-attachments` CLI command, authenticated as `data@worldsteel.org`, before write.
- **Version:** preserve the source `dataSetVersion` (e.g. `20.25.x` products / `03.00.004` reference) — do NOT renumber to `00.00.001`.

## Initial Policy

- QA waiver: `process_material_balance_deviation` (warning, not a remote-write blocker), mirroring BAFU/USLCI.
- Full-context AI completion required for authored `flow`/`process`/`lifecyclemodel` scopes (identity/classification/location decision tasks with sha-bound proof).
- Build entity queues with `tiangong-lca dataset curation-queue build`; require `curation-queue verify` before write planning.

## Support mint / blocked-review boundary

Canonical FP/UG are always reused. An unmatched candidate remains same-owner My Data (`state_code=0`, row version `00.00.001`), is ordered Unit Group before Flow Property, and never enters the public canonical cache. Unit-scale (`canonical_support_amount_scaling_required` and `canonical_support_amount_scale_unresolved`), schema, QA, curation, reference closure, dry-run, commit-handoff, and readback gates are unchanged. If support preparation, commit, or verification fails, the dependent flow/process scope is blocked and deferred; independent ready scopes may continue. This flag grants neither review nor publish authority.

## Runner

`scripts/commands/worldsteel-batch-import-run.ts` (`dataset-worldsteel-batch-import-run`) wraps the BAFU per-scope engine with: `enableBafuAutofill=false`, `enableFamilySignatures=false`, `commitFlowSupportInline=true`, `mintUnmatchedFpUgSupport=true`, `applyResolutionRewrites=true`, and the reused worldsteel `libraryContact`.

## Open Decisions

- The exact residual count of GaBi/Sphera pseudo-elementary flows that mint (≤17) — decided after the UUID-reuse pass; if zero, set `allow_account_local_support_and_elementary.enabled=false`.
- Whether to land the finalize-trusts-resolution-rewrites speed-up before the full run (all 33 processes are ~2,000–2,543-exchange mega-scopes). See `docs/import-profiles/worldsteel/import-plan.md` §8.
- `allow_remote_commit` stays human-gated until the pilot scope is verified.

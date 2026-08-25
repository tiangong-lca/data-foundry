---
title: worldsteel Import Constraints
docType: constraints
scope: import-profile
status: draft
owner: tiangong-lca-data-foundry
related:
  - docs/import-profiles/worldsteel/profile.md
  - docs/import-profiles/worldsteel/import-plan.md
  - specs/import-profiles.json
---

# worldsteel Import Constraints

## Reference-by-UUID first (the dominant policy)

The ~1,315 EF3.1 reference elementary flows + canonical flowproperties/unitgroups are **reused by their original canonical UUID** through the offline library-resolution `exchange-reference-rewrites.jsonl` (applied by the runner's `applyResolutionRewrites`). They are **never minted**. Each rewrite row must carry `canonical_short_description` so committed exchanges show the flow name, not the UUID.

## Authorized: capped account-local elementary mint (2026-06-29, requirement 3)

`allow_account_local_support_and_elementary` is enabled for the worldsteel profile (`specs/import-profiles.json`) **only** as a capped escape hatch. Unlike BAFU/USLCI (which mint reference support at scale), worldsteel's reference support is canonical and reused by UUID. The override is scoped to the small residual of **GaBi/Sphera pseudo-elementary flows** (dataSetVersion 20.25.x) that have no canonical match — **expected at most 17** — minted as account-local My Data (state_code=0) so the 33 steel processes stay complete.

- These residual flows are **NOT** matched by UUID; the AI judges reuse-vs-mint from **full context**.
- The final mint count is reviewed **after** the UUID-reuse pass. If the residual is zero, set `enabled=false`.
- Flow properties / unit groups are reference-only (`mintUnmatchedFpUgSupport=false`); only elementary flows may mint under this allowance.

## Gates that REMAIN blocking (NOT relaxed)

- the unit-scale safety blocker `canonical_support_amount_scaling_required`;
- schema validation through Rust tidas against its locked corrected eILCD schemas (not raw EF3.1), deterministic QA (except the waived `process_material_balance_deviation`), curation, and full-context AI proof for `flow`/`process`/`lifecyclemodel`;
- remote write requires dry-run, queue verify, commit handoff, closeout, and readback verification, **and account/write-policy approval before any remote commit** — `allow_remote_commit` stays false until then.

## worldsteel-specific identity & attribution

- **Library contact:** reuse the packaged worldsteel contact `d5710976-d600-11da-a94d-0800200c9a66` (World Steel Association, v20.20.002) as the single shared library contact. Do not mint a synthetic foundry contact.
- **Database fallback source:** processes whose data source resolves to a placeholder cite the synthesized `worldsteel LCI database` source — never the BAFU 2025 default.
- **Version:** preserve the source `dataSetVersion`; do not renumber to `00.00.001`.
- **LCIA methods:** the 25 EF3.1 LCIA method datasets are reference/provenance only and are NOT written inline by the import.
- **External documents:** the 13 `referenceToDigitalFile` binaries are uploaded to the `external_docs` bucket and the source `@uri` rewritten by `tiangong-lca dataset source upload-attachments` (authenticated as `data@worldsteel.org`) before write; plain `http(s)` referenceToDigitalFile URIs are left untouched.

## Runtime governance additions (2026-07-01)

Landed while committing the first worldsteel processes; all are gated to the worldsteel profile so BAFU/USLCI are byte-for-byte unchanged.

- **Process-name content-policy waiver.** worldsteel source process names follow `"<product> <route> <geography> <data-year>"` (e.g. `Steel rebar Global 2022`, `Steel sections EU 2019`, `Steel ECCS Global 2021 v2`). The trailing `<Geography> <Year>` is reference metadata, not a citation, but it matches the prewrite-content-policy `latin-author-year` marker. The worldsteel profile therefore waives rule `source_locator_in_dataset_name` for `process` names via `waived_content_policy_rules_by_type` (a new per-profile mechanism parallel to `waived_qa_codes_by_type`). All 33 baseNames carry the pattern and are preserved verbatim. The waiver is scoped to processes only — worldsteel flows/lifecyclemodels and every other content-policy rule stay enforced.
- **Foreign/RLS-hidden drafts are not references.** The historical process exchange pointing at `3c4b0e5d "Slag (deposited)" @00.00.001` resolved only under a different account at `state_code=0` and is invisible to `data@worldsteel.org`. That cross-account observation is not valid readback evidence. Current runs must keep `missing_dataset` blocking and replace the exchange with an allowed public or same-owner visible reference; no trusted-key list may convert it to passed. Production-test account runs are unconditionally fail-closed.
- **Canonical reuse pinned to latest published version.** Reuse-by-UUID decisions are swept to the latest `state_code=100` version before commit (the post-write readback rejects references below a flow's latest published version). Only flows that drifted are updated.

### Corrections to earlier notes

- **Contact (supersedes the identity note above).** The packaged contact id `d5710976@20.20.002` turned out to be occupied by a different account in the target database (not published canonical, not visible to `data@worldsteel.org`), so it can neither be created nor referenced. Per the 2026-06-30 decision the library contact is **minted under a fresh deterministic foundry-owned UUID that carries the real worldsteel identity** — email `steel@worldsteel.org`, classification `Organisations > Other organisations` (a private industry association, not governmental), address `Avenue de Tervueren 270, 1150 Brussels`. worldsteel contact fields are never BAFU/FOEN defaults.
- **Version (supersedes the "preserve dataSetVersion" note for NEW entities).** worldsteel-specific new flows/mints/processes are committed as account-local My Data at `00.00.001` (their source versions `20.25.x`/`00.00.000` are occupied by other test-import accounts). The ILCD `common:dataSetVersion` inside each dataset still carries the source version for provenance; only the DB row-version key is `00.00.001`. Canonical reference flows keep their real published versions (reused by UUID).

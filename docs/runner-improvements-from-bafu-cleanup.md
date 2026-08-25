---
title: Runner Improvements from BAFU Cleanup Debt
docType: reference
scope: import-curation-history
status: historical
authoritative: false
owner: tiangong-lca-data-foundry
language: en
whenToUse:
  - when investigating the historical BAFU and USLCI cleanup evidence that motivated current import safeguards
whenToUpdate:
  - when a current contract changes how this historical evidence should be interpreted
checkPaths:
  - docs/runner-improvements-from-bafu-cleanup.md
  - docs/import-profiles/bafu/**
  - docs/import-profiles/uslci/**
  - scripts/lib/import-curation/**
lastReviewedAt: 2026-08-25
lastReviewedCommit: a2b66448599df0106ee8e03da94e6f6eeb5a878e
lastReviewedNote: "Reviewed for Issue #67 Wave 22b: the USLCI wrapper's TypeScript path and frozen injected profile do not change this historical cleanup evidence or its current-owner interpretation."
related:
  - docs/import-profiles/bafu/profile.md
  - docs/import-profiles/uslci/profile.md
  - specs/import-profiles.json
---

# Runner improvements distilled from the BAFU post-import cleanup debt

> **Historical converter references:** Python `tidas-tools` module/file references below document the 2026-06 root-cause evidence only. Current deterministic import/conversion/schema validation runs through the Foundry adapter over Rust `tidas` 0.2.x; any reusable defect now routes to that Rust owner rather than a Foundry-local patch.
>
> Source evidence (read-only, not executed by any runner): `inputs/BAFU-2025 Version 2 - TIDAS 2026-03-09/BAFU-需要确认事项.xlsx` (81 owner-confirmation flow decisions) and `inputs/BAFU-2025 Version 2 - TIDAS 2026-03-09/BAFU-AI清洗执行任务.xlsx` (10 FP/UG actions + 224 elementary flow remaps + validation).
>
> These workbooks describe cleanup the BAFU import created **after the fact**. Reversed, each cleanup bucket points at an import-time pitfall. This doc is the shared backlog (P1–P6) for **both** the BAFU runner (`dataset-bafu-batch-import-run`) and the USLCI runner (`dataset-uslci-batch-import-run`). Every fix lands in its owning project (tidas-tools converter / foundry runner+finalize / tiangong-lca-cli) and is BAFU-gated so the verified BAFU run is never regressed.

## Why this matters now

The USLCI runner is about to mint unmatched FP/UG/elementary as account-local "My Data" across 1,358 scopes. The BAFU cleanup is the preview of what naive minting produces at scale: alias-dimension duplicate support, un-scaled amounts, and hundreds of minted flows that already existed publicly. Fixing P1 also **unblocks the current USLCI per-scope FP reference-closure block** (mint-needing scopes fail because unmatched FP/UG are not committed as canonical support before the dependent flows).

## Issue → import-time root cause → fix (both runners)

| # | BAFU cleanup debt (evidence / scale) | Import-time root cause | Fix | Owner | USLCI status |
| --- | --- | --- | --- | --- | --- |
| **P1** | **FPUG-001/002** (10 actions): `Units of hr` / `Amount in hr` / `Units of kmy` / `Amount in kmy` minted as **separate dimensions**; cleanup must merge them into `Time` / `Length*time` / `Person*distance` with **amount scaling** (hr→yr ×1/8760, kmy→m·a ×1000, personkm ×1). Touches 96+19+169 flows, thousands of exchange refs. Some dimensions had **no public canonical** → must publish-once. | FP/UG minted per source name+unit, not normalized to **dimension**; alias units not folded into one canonical UnitGroup with conversion factors; exchange amounts not scaled to the reference unit. | At mint: resolve to **dimension**; reuse existing public canonical FP/UG if present; for a genuinely-new dimension publish **once** as the canonical; add alias units into the canonical UnitGroup with conversion factors; **scale exchange amounts to the reference unit**. | runner (materialize/finalize support selection) + converter (unit normalization, half-done) | **Current USLCI FP block** (`838aaa20` "Goods transport" = standard openLCA mass×distance FP). Naive per-scope mint replicates BAFU debt across 1,358. |
| **P2** | **FLOW-001** (224 reviewed maps): elementary minted as new flows that should map to existing public flows — `1-Methyl-2-pyrrolidinone`→`1-methyl-2-pyrrolidone`, `2-Propanol`→`isopropanol`, `Barite`→`baryte`, `Alachlor`→`lasso` (trade name); ecoSpold `water/river`+`groundwater` → ILCD `fresh water`. | Reuse matching too literal: misses synonyms / CAS / spelling variants, and does not canonicalize **source compartment → ILCD compartment** before matching. | Reuse key = **CAS + synonym set + spelling normalization + normalized compartment**, not literal name. Run this reuse check before minting. | converter / runner identity-preflight scoring | FEDEFL+CAS gives 76% reuse, but residual ~931 still risks false mints. **Data-quality-affecting (reuse boundary) — confirm threshold.** |
| **P3** | **no_create_orphan_delete** (3) + ELEM-003: orphan flows (0 refs) minted, then deleted in cleanup. | Mint does not check for a live in-scope referrer. | Reference closure: **do not mint support with zero in-scope referrers.** | runner | applies |
| **P4** | **map_to_published_bafu_duplicate** (3) + **SRC-001**: same semantic flow/source minted under multiple UUIDs. | No intra-batch dedup. | Dedup by semantic key within the batch: mint one, rewrite the rest. | runner | applies (USLCI sources/FP recur) |
| **P5** | **PROV-001/002/003**: provenance mixed into display comments; durable provenance should use IDs/hashes. | Converter writes sourceTrace/provenance into general comment fields. | Provenance only in structured fields, never display comments; consistent sourceTrace stripping. | converter (tidas-tools) + D2 curation-cleanup (strips `tidasimport:sourceTrace`) | USLCI D2 measured clean (NREL×22 / FOEN×0 / openLCA×0); recheck comment fields. |
| **P6** | **EXCH-001 / VAL-004**: alias-unit scaling + amountFormula amounts need recorded evidence. | Unit/alias rewrites leave no scaling-evidence trail; some amountFormula amounts un-rescaled. | Emit a machine-readable scaling-evidence row per rewritten exchange; fold into post_write_verify / QA. | converter + runner | USLCI 1,425 amountFormula are trace-only (runbook §7.1). |

## Avoidable vs. inherently owner-gated

- **Automatable (P1/P3/P4 + most of P2/P5/P6)** — program logic; both runners should fix.
- **Owner-gated** — the 81 BAFU-confirmation rows split as 48 `map_existing_public_flow`, **27 `publish_bafu_flow_as_public`** (legit new flows: "Noise, road, passenger car", "Acidity, unspecified", "Anhydrite" — no public equivalent), 3 `map_to_published_bafu_duplicate`, 3 `no_create_orphan_delete`. Whether a flow is "a new public flow" vs "the same as an existing one" needs the data owner. The import can't eliminate these, but it **can surface them as structured decisions during import** (like the existing classification/identity decision rounds) instead of leaving them to be reverse-engineered from the database afterward.

## Recommended order

1. **P1** — FP/UG dimension normalization + scaling. Highest impact: unblocks USLCI now **and** removes the #1 BAFU cleanup bucket. Make it a shared helper, BAFU-gated.
2. **P3** + **P4** — small, runner-local, stable.
3. **P2** — reuse improvement (changes reuse-vs-mint boundary → data-quality decision; confirm thresholds).
4. **P5** / **P6** — converter-side hygiene + QA evidence.

P1 and P2 change the **data actually imported** (scaled amounts, reuse boundary) → "affects import result/quality" → require explicit sign-off before applying.

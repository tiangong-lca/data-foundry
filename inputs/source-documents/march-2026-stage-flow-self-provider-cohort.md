---
id: march-2026-stage-flow-self-provider-cohort
title: March 2026 exact stage-flow self-provider cohort repair source brief
source_type: utilities-handoff
created_at: 2026-08-31
tracked_issue: tiangong-lca/data-foundry#95
---

# March 2026 exact stage-flow self-provider cohort

## Bound Utilities handoff

Utilities reproduced the adjudicated cohort from frozen production-read-only artifacts and wrote a content-addressed handoff under:

- `../tiangong-lca-utilities/reports/2026-08-30/production-lcia-health-audit/cycle-1-result-1b4f14f6/round-7-stage-flow-repair-handoff/`
- result: `1b4f14f6-39f3-4828-887b-c32469454d39`
- snapshot: `97602ae4-317f-434f-b458-98ff07b66dd9`
- `stage-flow-cohort.csv`: SHA-256 `ac2aa324db6e977bf6c4d2c17d50972bc9e043719ef113fa3ca21232ebcbe7b9`
- `stage-flow-repair-decisions.csv`: SHA-256 `7b73b1e5af9b83d58c56cfc952e43fe7607784ad42c87780844236ddac824fdc`
- `stage-flow-handoff.json`: SHA-256 `ff627a2ecde5e1e070fa0f97623c03f6acebcbae2035947863741a58a26d2e46`
- `stage-flow-acceptance.json`: SHA-256 `115fe3f19e0d72816c2d3e4eac083322703f6f8d03e499b0e3d26d037af439eb`

The handoff proves that all 214 rows consume the exact UUID and version of their quantitative-reference Output flow. It does not infer the intended predecessor identity and does not authorize a write.

## Cohort facts

- 214 process versions, all `01.01.000`.
- entered from 2026-03-01 through 2026-03-04 by `f4b4c314-8c4c-4c83-968f-5b3c7724f6a8`.
- no dataset generator id and no model id in the frozen rows.
- 6 rows have `A[i,i] >= 1` and negative Climate-change results.
- 28 rows have at least one negative impact.
- priority partition from the frozen handoff: 6 P0, 62 P1, 146 P2.

## P0 source-review wave

- `433` `1642ecb3-ba58-4d8d-807b-e43b8b3b532d@01.01.000` — Paper and paperboard used as a base for sensitive paper; exact flow `a0b357fa-9e43-483e-806d-6a2f5c9c6357@01.01.000`.
- `576` `1c3849ba-b3c2-4bf5-b257-7f49b134d859@01.01.000` — Wild ornamental fish; exact flow `a5c37adb-7879-4b2d-9c14-cf826f4bf668@01.01.000`.
- `3151` `90b63603-bd5d-4fd2-9f38-1492d6b18295@01.01.000` — Rice milk; exact flow `9f4c117d-e8ff-488f-89f6-c2ab7ca763e1@01.01.000`.
- `4088` `ba4fad86-2f59-4ba0-af5a-50c6f0b01f78@01.01.000` — Hearing aids and compensating appliances; exact flow `702d21c4-fc45-412a-8beb-e685dd9a623a@01.01.000`.
- `4247` `c0a34922-022b-478a-a855-c524371f7db9@01.01.000` — Solar water heaters; exact flow `9ede182c-cfec-4513-a405-b17db74ed710@01.01.000`.
- `4513` `cd4b37ef-6af1-49e2-a2de-2835e8a50105@01.01.000` — Soups, broths and preparations; exact flow `6cd389be-4748-4401-96a4-ecdc07c041a3@01.01.000`.

## Required decision for every row

Choose exactly one decision in the Utilities scaffold:

- `reuse_existing_intermediate`: source and physical identity support an existing predecessor/intermediate flow version.
- `create_intermediate_flow`: the stage is source-supported but no physically equivalent flow exists; author the missing flow and complete its provider chain.
- `collapse_unsupported_stage`: available sources do not support an independently modeled stage; rebuild the process boundary without inventing an intermediate.
- `HOLD`: evidence is insufficient or contradictory; record the precise missing claim and do not create a candidate write row.

A non-HOLD decision must record source ids, locators, the supported stage claim, predecessor/replacement flow identity, modeling justification, and a durable review-decision id. Current comments and matching names are discovery context, not sufficient evidence of physical equivalence.

## Build and validation contract

For each evidence-supported chain:

1. Reconstruct predecessor, current stage, and final-product roles as one chain; do not repair only the currently negative row.
2. Reuse an existing flow only after unit, physical meaning, geography/market, category/route, technology, and stage position are compatible.
3. Create a distinct intermediate only when sources support the stage and its reference unit; complete source/contact/reference closure.
4. Run schema validation, the deterministic CLI process QA blocker, Foundry curation, cleanup/finalize, and mutation-manifest dry-run.
5. Return exact changed process/flow identities to Utilities for provider re-resolution, SCC/A-diagonal replay, unmatched-residual checks, rebuilt-snapshot validation, and fresh recompute comparison.

## Non-goals and authority

- Do not patch a matrix coefficient or select a replacement from names alone.
- Do not reinterpret the six negative rows as the complete scope; all 214 remain in scope.
- Do not include the deferred location-aware factor issue.
- Do not write production data under this task. `allow_remote_commit` remains false; any later production execution requires a separate explicit authorization and the ordinary guarded handoff/readback path.

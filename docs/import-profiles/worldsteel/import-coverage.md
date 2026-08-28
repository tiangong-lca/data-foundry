---
lastReviewedAt: 2026-08-29
lastReviewedCommit: 05fdeaf22520efb2325ffcde44f86b925e0a7b8a
lastReviewedNote: "Reviewed for Issue #70: CLI 0.1.3 operational binding does not alter retained 10+10 LANCA evidence, 11+11 historical inventory, or their non-cap interpretation."
title: worldsteel EF3.1 Import Coverage Evidence
docType: report
scope: import-profile/worldsteel
status: retained
authoritative: true
owner: tiangong-lca-data-foundry
language: en
whenToUse:
  - when establishing the retained 2026-07-01 reason for enabling unmatched FP/UG support
  - when distinguishing historical owner inventory from current runtime policy and verification
whenToUpdate:
  - when a later durable delivery supersedes these retained counts or their interpretation
  - when hardening changes whether any historical result still qualifies as current evidence
checkPaths:
  - specs/import-profiles.json
  - scripts/commands/worldsteel-batch-import-run.ts
  - docs/import-profiles/worldsteel/profile.md
  - docs/import-profiles/worldsteel/constraints.md
  - docs/import-profiles/worldsteel/import-plan.md
  - docs/import-profiles/worldsteel/import-coverage.md
  - test/unit/worldsteel-support-mint-truth.test.mts
---

# worldsteel EF3.1 import — coverage report

Imported under account **data@worldsteel.org** (uid 7d6d550a). Generated 2026-07-01.

> Historical pre-hardening report. It records the 2026-07-01 run, but its accepted foreign `state_code=0` reference is no longer valid verification evidence. Current runs must remain blocked until that dependency resolves to an allowed public or same-owner visible row.

Current executable policy, reviewed 2026-08-26: `mintUnmatchedFpUgSupport=true`. This retained report supplies the delivery reason (10+10 LANCA rows) and observed owner inventory (11+11), not a runtime name whitelist or numeric cap. Runtime admits materialized FP/UG canonical-cache misses only as same-owner `state_code=0` support candidates; Unit Groups precede Flow Properties, canonical matches are reused, and any unit-scale, schema, QA, curation, closure, handoff, or readback failure defers the dependent scope while independent ready scopes may continue.

## Historical result: 33 / 33 processes committed; 1 reference no longer qualifies as verified

| Entity (owned by data@worldsteel.org, state_code=0 My Data)                  | Count |
| ---------------------------------------------------------------------------- | ----- |
| Processes                                                                    | 33    |
| Flows (worldsteel-specific: products, wastes, GaBi/Sphera pseudo-elementary) | 75    |
| Flow properties (EF3.1 LANCA land-use LCIA indicators, account-local mint)   | 11    |
| Unit groups (EF3.1 LANCA, account-local mint)                                | 11    |
| Library contact (World Steel Association)                                    | 1     |
| Database fallback source (worldsteel LCI database)                           | 1     |

Plus **~1,315 EF3.1 reference elementary flows + canonical flow properties / unit groups reused by their original canonical UUID** (never minted). The historical USLCI-owned `3c4b0e5d "Slag (deposited)"` reference is foreign/RLS-hidden `state_code=0`; it is now a hard `missing_dataset` blocker and must be replaced before a current run can pass.

## Processes (33)

1.  `4e6abaf8` Steel cold rolled coil Europe 2022
2.  `cafd9e0e` Steel cold rolled coil Global 2022
3.  `b7f40b84` Steel ECCS Global 2021 v2
4.  `75ea4c0b` Steel Electrogalvanized EU 2020
5.  `a833e462` Steel Electrogalvanized Global 2022
6.  `861e63cb` Steel Engineering steel EU 2019
7.  `d37ae520` Steel Engineering steel Global 2022
8.  `1f966ba7` Steel finished cold rolled coil Europe 2022
9.  `c42afcc0` Steel finished cold rolled coil Global 2022
10. `bb79ebdb` Steel hot dip galvanised Europe 2022
11. `2c3799bd` Steel hot dip galvanised Global 2022
12. `d780460f` Steel Hot Rolled Coil Europe 2022
13. `c1bcd3c7` Steel Hot Rolled Coil Global 2022
14. `01e6ea67` Steel organic coated Europe 2022
15. `4670e025` Steel organic coated Global 2022
16. `02c63472` Steel pickled hot rolled coil Europe 2022
17. `5e31796f` Steel pickled hot rolled coil Global 2022
18. `90c8be70` Steel plate Europe 2022
19. `1ce4c3fc` Steel plate Global 2022
20. `f777c438` Steel rebar EU 2019
21. `0f288aaa` Steel rebar Global 2022
22. `d3de9d64` Steel seamless pipe Europe 2022
23. `18b4ada3` Steel seamless pipe Global 2022
24. `4134d8b8` Steel sections EU 2019
25. `da04b3b6` Steel sections Global 2022
26. `aeadf929` Steel tinplated Europe 2022
27. `9d9ff205` Steel tinplated Global 2022
28. `b68b9d77` Steel UO pipe Global 2022
29. `6e57b16e` Steel welded pipe EU 2019
30. `416058da` Steel welded pipe Global 2022
31. `7d9fa1e1` Steel wire rod Europe 2022
32. `c5c31a54` Steel wire rod Global 2022
33. `91bd5958` Value of Scrap 2022

## Governance decisions applied

- **Reference-only EF3.1 layer** reused by canonical UUID (deterministic exchange-reference-rewrites); canonical reuse pinned to the latest published version.
- **Foreign reference correction** — the prior USLCI-owned state-0 reuse is retired. A current worldsteel run cannot accept that hidden row and must select an allowed public or same-owner visible dependency.
- **Account-local mint** for the residual with no canonical match: worldsteel-specific product/waste/pseudo-elementary flows, and the 10+10 EF3.1 LANCA land-use LCIA indicator flow-properties/unit-groups (Erosion Resistance, Mechanical/Physicochemical Filtration, Biotic Production, Groundwater Replenishment — Occupation & Transformation), all written as My Data at 00.00.001 (their native EF3.1 versions were occupied by other accounts).
- **Content-policy waiver** (process names only): source_locator_in_dataset_name is waived because worldsteel names are "<product> <route> <geography> <data-year>" — reference metadata, not a citation.
- **Contact** minted under a fresh foundry-owned UUID carrying the real World Steel Association identity (steel@worldsteel.org, Avenue de Tervueren 270; classification Organisations > Other organisations) — never BAFU/FOEN defaults.

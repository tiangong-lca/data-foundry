---
title: HiQLCD Source Data Labeling And Normalization Issues
docType: issue-archive
scope: import-profile/hiq
status: draft
owner: tiangong-lca-data-foundry
related:
  - docs/import-profiles/hiq/hiq-import-governance-proposal.md
  - docs/import-profiles/hiq/hiq-issue-01-reference-delivery-gaps.md
  - docs/import-profiles/hiq/hiq-issue-02-required-governance-metadata-gaps.md
---

# HiQLCD Source Data Labeling And Normalization Issues

> Historical tool-path note: Python `tidas-tools` source references below are evidence for the archived diagnosis, not active implementation or invocation paths. Current deterministic validation/conversion routes to Rust `tidas` 0.2.x.

This archive records source-data labeling and normalization defects in `inputs/HIQ-ILCD`. These are not reasons to make a generic adapter absorb HiQLCD-specific source mistakes. The preferred remediation is source repair, a temporary HiQLCD normalization script, or profile-scoped normalization with explicit trace.

## HIQ-LABEL-001: Chinese Text Is Marked As `xml:lang="en"`

| Field | Detail |
| --- | --- |
| Issue type | Source labeling error / normalization issue. |
| Affected objects | 214 localized text nodes across delivered XML: 183 in `processes`, 14 in `flows`, 8 in `flowproperties`, 7 in `unitgroups`, and 2 in `contacts`. |
| Evidence location | Contact examples: `inputs/HIQ-ILCD/contacts/d76fde52-9e57-3831-9829-85e75ad7ea9b.xml:6-7`. Flow examples: `inputs/HIQ-ILCD/flows/fffbe9bc-2513-3f84-b5d2-e0d35567f4c6.xml:7`, `inputs/HIQ-ILCD/flows/b7e7d46f-740a-3843-8de1-f64a3df9b19b.xml:7`. Process examples: `inputs/HIQ-ILCD/processes/826beb40-f152-4dd2-be5f-0788235b1691.xml:7-12`, `inputs/HIQ-ILCD/processes/9c864d02-025d-46e4-98c3-96ac58cb863b.xml:9-12`, `inputs/HIQ-ILCD/processes/2937aa4a-4339-4534-ade6-9b76cb2caf1c.xml:25`. Flow property/unit examples: `inputs/HIQ-ILCD/flowproperties/30e90779-8721-4f1e-bd2a-410d6c938b32.xml:10`, `inputs/HIQ-ILCD/unitgroups/838aaa21-0117-11db-92e3-0800200c9a66.xml:6`. |
| Impact | TIDAS validation rejects English-labeled text that contains Chinese. If a converter/writer copies or emits these strings as `en`, validation will fail or later language QA will block curation. |
| Suggested handling | Normalize only the affected HiQLCD source fields by assigning the TIDAS language code `zh` when the string contains CJK and is not an English technical name. Preserve the original language attribute in source trace. Do not use this issue as the justification for a generic ILCD adapter feature; generic writer multilingual support is a separate toolchain improvement. |
| Blocks import? | Yes until normalized or source package is corrected. |

Affected node categories:

| Directory | Count | Typical tags | Examples | Suggested handling |
| --- | --: | --- | --- | --- |
| `processes` | 183 | `baseName`, `generalComment`, `technologyDescriptionAndIncludedProcesses`, exchange `shortDescription` | `inputs/HIQ-ILCD/processes/826beb40-f152-4dd2-be5f-0788235b1691.xml:7`, `:9`, `:25`; `inputs/HIQ-ILCD/processes/2937aa4a-4339-4534-ade6-9b76cb2caf1c.xml:60` | Profile normalization to `zh` for Chinese process names/comments; keep English chemical names as `en`. |
| `flows` | 14 | `f:baseName` | `inputs/HIQ-ILCD/flows/fffbe9bc-2513-3f84-b5d2-e0d35567f4c6.xml:7`, `inputs/HIQ-ILCD/flows/a588dec8-0e04-3502-95e8-3492dc4f2263.xml:7`, `inputs/HIQ-ILCD/flows/fc2bb0dc-b80c-4eae-b0a1-a9c162d5d03c.xml:7` | Normalize Chinese flow names to `zh`; preserve source flow UUID/name trace. |
| `flowproperties` | 8 | `common:shortDescription` | `inputs/HIQ-ILCD/flowproperties/115b2bb8-fb65-4e86-b246-8104666aba8e.xml:10`, `inputs/HIQ-ILCD/flowproperties/30e90779-8721-4f1e-bd2a-410d6c938b32.xml:10` | Normalize labels; final write should preferably reuse canonical support records rather than write these rows. |
| `unitgroups` | 7 | `common:name`, sometimes `common:generalComment` | `inputs/HIQ-ILCD/unitgroups/838aaa21-0117-11db-92e3-0800200c9a66.xml:6`, `inputs/HIQ-ILCD/unitgroups/93a60a57-a4c8-11da-a746-0800200c9a66.xml:6` | Normalize labels; final write should preferably use canonical support mappings. |
| `contacts` | 2 | `common:shortName`, `common:name` | `inputs/HIQ-ILCD/contacts/d76fde52-9e57-3831-9829-85e75ad7ea9b.xml:6-7` | Normalize to `zh`; confirm legal contact/owner before support write. |

## HIQ-LABEL-002: Process `baseName` Under-Identifies Reference Product And Market Semantics

| Field | Detail |
| --- | --- |
| Issue type | Source naming/normalization issue. |
| Affected objects | All 10 process datasets. Several rows share the same baseName even though the reference product differs. The market process also uses production-style baseName. |
| Evidence location | Process names at `inputs/HIQ-ILCD/processes/*xml:7`; quantitative reference flow values in exchange lists. Examples: `inputs/HIQ-ILCD/processes/9c864d02-025d-46e4-98c3-96ac58cb863b.xml:7` names the row `1,3-丁二烯,一步法`, while reference flow at `:158-160` is `氢气`; market process `inputs/HIQ-ILCD/processes/826beb40-f152-4dd2-be5f-0788235b1691.xml:7-12` describes a market dataset but has baseName `1,3-丁二烯,一步法`. |
| Impact | Identity matching, duplicate detection, process name-plan quality, and user-facing process selection can be wrong if final names are generated only from source baseName. |
| Suggested handling | Use a HiQLCD name normalization/name-plan rule that includes production route, reference flow, and market/production role. Do this in profile normalization or AI/human name-plan curation, not as generic adapter behavior. |
| Blocks import? | Blocks final name-plan/identity quality; conversion can preserve raw names as trace. |

Process naming inventory:

| Process UUID | Source baseName | Reference flow | Evidence | Normalization need |
| --- | --- | --- | --- | --- |
| `2937aa4a-4339-4534-ade6-9b76cb2caf1c` | `1,3-丁二烯,两步法` | `乙烯` | `inputs/HIQ-ILCD/processes/2937aa4a-4339-4534-ade6-9b76cb2caf1c.xml:7`; ref flow at `:99-101` | Include two-step route and ethylene reference product. |
| `35f1f2bc-cd0f-4b68-ba01-39b24892cdf2` | `1,3-丁二烯,一步法` | `丁烯` | `inputs/HIQ-ILCD/processes/35f1f2bc-cd0f-4b68-ba01-39b24892cdf2.xml:7`; ref flow at `:86-88` | Include one-step route and butene reference product. |
| `51e9f6c0-74af-4e15-b982-d5ec93be5224` | `1,3-丁二烯,一步法` | `乙烯` | `inputs/HIQ-ILCD/processes/51e9f6c0-74af-4e15-b982-d5ec93be5224.xml:7`; ref flow at `:60-62` | Include one-step route and ethylene reference product. |
| `55d6ddfa-e306-42a4-b4bc-61cdf7c1e164` | `1,3-丁二烯,两步法` | `丁二烯` | `inputs/HIQ-ILCD/processes/55d6ddfa-e306-42a4-b4bc-61cdf7c1e164.xml:7`; ref flow in exchange 0 | Include two-step route and main product. |
| `62f3e2ee-ea8d-4c87-9ca2-1c7cc220fcbf` | `1,3-丁二烯,一步法` | `丙烯` | `inputs/HIQ-ILCD/processes/62f3e2ee-ea8d-4c87-9ca2-1c7cc220fcbf.xml:7`; ref flow at `:96-98` | Include one-step route and propylene reference product. |
| `6512756f-8582-46f2-b246-fd7f446eae98` | `1,3-丁二烯,一步法` | `丁二烯` | `inputs/HIQ-ILCD/processes/6512756f-8582-46f2-b246-fd7f446eae98.xml:7`; ref flow in exchange 0 | Include one-step route and main product. |
| `79b93c08-3757-42d4-9512-5fff48b5bf48` | `1,3-丁二烯,一步法` | `乙醛` | `inputs/HIQ-ILCD/processes/79b93c08-3757-42d4-9512-5fff48b5bf48.xml:7`; ref flow in exchange 0 | Include one-step route and acetaldehyde reference product. |
| `7a24fac2-aa8e-4c9b-90d9-7d83fc71c068` | `1,3-丁二烯,两步法` | `丁烯` | `inputs/HIQ-ILCD/processes/7a24fac2-aa8e-4c9b-90d9-7d83fc71c068.xml:7`; ref flow in exchange 0 | Include two-step route and butene reference product. |
| `826beb40-f152-4dd2-be5f-0788235b1691` | `1,3-丁二烯,一步法` | `丁二烯` market | `inputs/HIQ-ILCD/processes/826beb40-f152-4dd2-be5f-0788235b1691.xml:7-12`; provider link at `:104` | Mark as market/consumption process, not only production. |
| `9c864d02-025d-46e4-98c3-96ac58cb863b` | `1,3-丁二烯,一步法` | `氢气` | `inputs/HIQ-ILCD/processes/9c864d02-025d-46e4-98c3-96ac58cb863b.xml:7`; ref flow at `:158-160` | Include one-step route and hydrogen co-product. |

## HIQ-LABEL-003: Citation-Like Year Tokens Are Inconsistent Or Implausible

| Field | Detail |
| --- | --- |
| Issue type | Source text quality/citation normalization issue. |
| Affected objects | Process comments used as source evidence. |
| Evidence location | Process comments contain citation-like years such as `2030`, `2031`, `2032`, `2033`, `2034`, `2068`, `2075`, and `2092` in otherwise 2016/2019/2020 literature narratives. Examples include `inputs/HIQ-ILCD/processes/9c864d02-025d-46e4-98c3-96ac58cb863b.xml:111` with a `2034`-style citation pattern and `inputs/HIQ-ILCD/processes/35f1f2bc-cd0f-4b68-ba01-39b24892cdf2.xml:58` with 2020-style text; the extracted inventory flags future-year tokens in most production process files. |
| Impact | AI/source authoring may produce incorrect source rows or citations if these years are trusted. |
| Suggested handling | Treat future-year citation tokens as source-data anomalies. Ask data provider for original references or openLCA JSON-LD/source rows. If source rows are unavailable, author source citations from verified external bibliographic evidence, not from these malformed tokens alone. |
| Blocks import? | Blocks source-row authoring where the malformed comments are the only evidence. |

Detected suspicious year inventory:

| Process UUID | Reference flow | Suspicious tokens found in process text | Suggested handling |
| --- | --- | --- | --- |
| `2937aa4a-4339-4534-ade6-9b76cb2caf1c` | `乙烯` | `2031`, `2034`, `2092` | Verify against original source/export; do not cite as-is. |
| `35f1f2bc-cd0f-4b68-ba01-39b24892cdf2` | `丁烯` | `2031`, `2032`, `2033`, `2034`, `2075` | Same. |
| `51e9f6c0-74af-4e15-b982-d5ec93be5224` | `乙烯` | `2031`, `2032`, `2033`, `2034`, `2068` | Same. |
| `55d6ddfa-e306-42a4-b4bc-61cdf7c1e164` | `丁二烯` | `2031`, `2034`, `2092` | Same. |
| `62f3e2ee-ea8d-4c87-9ca2-1c7cc220fcbf` | `丙烯` | `2031`, `2032`, `2033`, `2034`, `2068` | Same. |
| `6512756f-8582-46f2-b246-fd7f446eae98` | `丁二烯` | `2031`, `2032`, `2033`, `2034` | Same. |
| `79b93c08-3757-42d4-9512-5fff48b5bf48` | `乙醛` | `2030`, `2031`, `2032`, `2033`, `2034` | Same. |
| `7a24fac2-aa8e-4c9b-90d9-7d83fc71c068` | `丁烯` | `2031`, `2034` | Same. |
| `9c864d02-025d-46e4-98c3-96ac58cb863b` | `氢气` | `2030`, `2031`, `2032`, `2033`, `2034` | Same. |

The market process `826beb40-f152-4dd2-be5f-0788235b1691` did not show the same future-year token pattern in the extracted scan, but it still lacks formal source rows.

## HIQ-LABEL-004: Support Entity Labels Need Source-Language Normalization But Should Usually Be Reference-Only

| Field | Detail |
| --- | --- |
| Issue type | Support normalization issue. |
| Affected objects | Flow properties, unit groups, and contact rows. |
| Evidence location | Flow property `30e90779-8721-4f1e-bd2a-410d6c938b32` has Chinese short description under `en` at `inputs/HIQ-ILCD/flowproperties/30e90779-8721-4f1e-bd2a-410d6c938b32.xml:10`. Unit group `838aaa21-0117-11db-92e3-0800200c9a66` has Chinese name under `en` at `inputs/HIQ-ILCD/unitgroups/838aaa21-0117-11db-92e3-0800200c9a66.xml:6`. Contact `d76fde52-9e57-3831-9829-85e75ad7ea9b` has Chinese name under `en` at `inputs/HIQ-ILCD/contacts/d76fde52-9e57-3831-9829-85e75ad7ea9b.xml:6-7`. |
| Impact | If these support rows are written directly, language validation and support identity quality fail. |
| Suggested handling | For flow properties and unit groups, prefer canonical reference-only support mapping instead of writing HiQLCD-owned support rows. For contact, normalize language only after ownership/write governance confirms whether the contact should be written or mapped to an existing contact. |
| Blocks import? | Blocks direct support write; not blocking if canonical reference mapping is used and source labels are kept as trace. |

## Non-Data-Package Toolchain Gaps

The following are real toolchain work items, but they are not HiQLCD package defects:

| Toolchain item | Evidence | Relationship to source labeling issue | Should it absorb Chinese-in-`en`? |
| --- | --- | --- | --- |
| tidas-tools writer multilingual output | `tidas-tools/src/tidas_tools/import_lca/writers/tidas_json.py:137-144` defaults generated multilingual text to `en`; TIDAS validator checks language/content consistency at `tidas-tools/src/tidas_tools/validate.py:299-319`. | Generic writer support is useful for all multilingual imports. | No. It should emit correct language when upstream canonical text carries language metadata, but HiQLCD's wrong source labels should be normalized at source/profile level first. |
| Optional ILCD adapter | `tidas-import` currently detects `inputs/HIQ-ILCD` as `unknown`; the adapter registry has no ILCD source adapter. | An adapter may preserve language attributes and source trace, but source labels remain incorrect. | No. Adapter should not silently relabel all Chinese text as a generic rule without profile trace. |
| Classification passthrough | tidas-tools writer has default process and product-flow classifications at `tidas-tools/src/tidas_tools/import_lca/writers/tidas_json.py:925-957` and `:1568-1624`. | HiQLCD source flows carry CPC classifications that may be valuable hints. | No. Classification passthrough is independent from language-label cleanup. |

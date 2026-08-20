---
title: HiQLCD Import Governance Proposal
docType: proposal
scope: import-profile/hiq
status: draft
owner: tiangong-lca-data-foundry
related:
  - docs/import-profiles/hiq/hiq-issue-01-reference-delivery-gaps.md
  - docs/import-profiles/hiq/hiq-issue-02-required-governance-metadata-gaps.md
  - docs/import-profiles/hiq/hiq-issue-03-source-data-labeling-and-normalization.md
  - docs/import-profiles/bafu/profile.md
  - specs/import-profiles.json
  - WORKFLOW.md
---

# HiQLCD Import Governance Proposal

> Historical tool-path note: Python `tidas-tools` modules and the old CLI import wrapper named below describe the capability state when this proposal was written. New deterministic import/conversion/schema-validation work routes to Rust `tidas` 0.2.x; the underlying data-package governance findings remain applicable.

Current judgment: HiQLCD's problem is not simply "ILCD cannot be parsed." The delivered package has three separable data problems: reference delivery is incomplete, TIDAS import/governance-required metadata is missing, and some source fields are incorrectly labeled or not normalized, especially Chinese text stored under `xml:lang="en"`. Separately, there are toolchain capability gaps such as writer multilingual output, classification passthrough, and a possible ILCD adapter. Those toolchain items should not be mixed into the data-package issue list.

## Recommended Governance Boundary

The adapter boundary should be narrow: an adapter converts source format semantics into canonical TIDAS-ready rows and preserves source trace. It should not absorb HiQLCD source-data errors, invent allocation methods, choose substitute background providers, or decide fallback citations.

Foundry/profile governance should own HiQLCD-specific decisions:

- source package manifest and immutable evidence;
- profile-scoped normalization rules;
- true-source/fallback citation policy;
- source/contact/account/write guard;
- background provider mapping policy;
- name-plan and language normalization evidence;
- unresolved trace/fallback policy before write planning.

tidas-tools/CLI should own reusable conversion and validation mechanics:

- optional ILCD/openLCA-ILCD source adapter if JSON-LD is unavailable and the import volume justifies it;
- writer multilingual output that respects language metadata already present in canonical rows;
- source classification trace/passthrough where adapter input contains useful source taxonomy;
- process-bundles, mapping CSV, schema validation, and format detection behavior.

## HiQLCD-Specific Normalization Scope

These items are appropriate for a temporary HiQLCD script or profile-scoped normalization:

| Normalization item | Source issue | Handling | Blocks import? |
| --- | --- | --- | --- |
| Relabel Chinese text currently marked `xml:lang="en"` | 214 affected localized text nodes; see `hiq-issue-03-source-data-labeling-and-normalization.md`. | Detect CJK-bearing text and write the TIDAS language code `zh` or task-approved source-language metadata while preserving original XML language as trace. | Yes until normalized. |
| Generate process name plans from route + reference product + role | Process `baseName` under-identifies co-products and market semantics. | Profile rule or AI/human name-plan decision; final names should distinguish one-step/two-step, reference product, and market vs production. | Yes for final identity/name quality. |
| Crop process-reachable scope | 762 LCIA methods and 4,311 unreferenced flows are sidecar payload for this import. | Keep full package as source evidence; build working import scope from 10 processes, 21 exchange-referenced flows, required support, source/provider trace. | No, but needed for efficient curation. |
| Natural gas unit recovery from openLCA extension | Flow `fffbe9bc...` has empty `flowProperties`, but exchanges carry `olca:propertyId` volume and `olca:unitId` m3. | Use profile/adapter trace to recover m3 only after confirmation. | Blocks quantity finalization until accepted. |
| Freight unit conversion policy | Market transport uses metric ton*km/t*km source unit; target canonical may be kg\*km. | Apply explicit scaling decision in canonical support mapping, not silently. | Yes for market quantities. |

Do not treat "Chinese in `en`" as a reason to broaden generic adapter behavior. That defect belongs first to source repair or HiQLCD profile normalization. A generic writer fix can help after normalized language metadata exists.

## Questions That Must Go Back To The Data Provider

| Question | Why adapter cannot infer it | Where answer should be recorded | Blocks import? |
| --- | --- | --- | --- |
| Can the provider re-export the original openLCA library as JSON-LD? | The package contains openLCA ILCD extensions, but not the source JSON-LD graph. JSON-LD may recover sources, providers, flow properties, and metadata lost in ILCD export. | Task source manifest and import route decision. | Not a hard blocker if ILCD route is later approved, but this should be requested first. |
| Can the provider deliver the missing `sources/` directory or source dataset `0eb0c1f6-05aa-4a5a-9599-1d0444b8f640` version `1.2.0`? | Source rows are absent; inline comments are insufficient for durable source records. | Source manifest, source rows, and process `referenceToDataSource` mapping. | Yes |
| What allocation method/factors were used for co-products? | The XML only says `Attributional`; it does not encode allocation approach or factors. | HiQLCD constraints and process method fields/trace. | Yes |
| Who owns the data and which TianGong account should receive drafts? | The package only delivers contact `李昭君`; this does not establish legal owner or target account. | Account/write guard, source manifest, support contact policy. | Yes for remote write |
| Are natural gas amounts intended as m3 volume? | Pure flow metadata is incomplete; exchange extension suggests m3. | Unit normalization decision and conversion report. | Yes for quantity finalization |
| Are market transport assumptions and provider UUIDs complete? | Market process references package-external transport default providers and narrative statistics, but no source/provider rows. | Provider mapping table, market source row, process trace. | Yes for market process |

## Problems Solvable By Remote Query Or Manual Mapping

| Problem | Candidate resolution | Evidence source | Governance note |
| --- | --- | --- | --- |
| Source UUID `0eb0c1f6-05aa-4a5a-9599-1d0444b8f640` | Query existing TianGong/openLCA source by UUID and version. | Inline two-step process comments; see `hiq-issue-01`. | If remote match exists, rewrite process source refs to the verified source row. |
| 13 missing defaultProvider UUIDs | Query remote by provider UUID, then manually map unresolved provider/flow contexts to existing TianGong backgrounds. | `olca:defaultProvider` attributes; see `hiq-issue-01`. | Preserve original provider UUIDs in trace. No silent substitution. |
| Canonical flow property/unit group reuse | Map 8 flow properties and 7 unit groups to canonical support rows. | `inputs/HIQ-ILCD/flowproperties/`, `inputs/HIQ-ILCD/unitgroups/`. | Prefer reference-only support reuse; do not write HiQLCD-owned FP/UG unless governance approves. |
| CPC classification hints on product flows | Use source CPC chain as evidence for TIDAS classification decisions. | Flow classificationInformation, e.g. natural gas at `inputs/HIQ-ILCD/flows/fffbe9bc-2513-3f84-b5d2-e0d35567f4c6.xml:9-17`. | Classification passthrough is a tool capability, but final target classification remains a curation decision. |

## Toolchain Capability Items: Non-Data-Package Problems

| Capability | Owner | Evidence | Priority | Notes |
| --- | --- | --- | --- | --- |
| Writer multilingual output | `tidas-tools` | `_ml` defaults generated text to `en` at `tidas-tools/src/tidas_tools/import_lca/writers/tidas_json.py:137-144`; validation rejects `en` text containing Chinese at `tidas-tools/src/tidas_tools/validate.py:299-319`. | Necessary before broad Chinese-source imports. | This should consume normalized language metadata; it should not hide HiQLCD source labeling errors. |
| Product/process classification passthrough or stronger source classification trace | `tidas-tools` plus Foundry curation | Current writer default product-flow classification is hard-coded at `tidas-tools/src/tidas_tools/import_lca/writers/tidas_json.py:1568-1624`; default process classification at `:925-957`. | Useful but not sufficient for import. | Source classification may become curation evidence, not automatic final taxonomy. |
| Optional ILCD/openLCA-ILCD adapter | `tidas-tools` | `tidas-import` detects `inputs/HIQ-ILCD` as `unknown`; adapter registry lacks an ILCD source adapter. CLI returns unsupported-format before process-bundles. | Only after JSON-LD request fails or future HiQLCD volume justifies it. | Adapter should parse ILCD namespaces, openLCA extension properties/units/default providers, and process-reachable scope; it should preserve unresolved provider/source trace. |
| Process-bundle generation and mapping CSV | `tidas-tools` | Existing CLI writes TIDAS package, validates, then writes process bundles and optional mapping CSV at `tidas-tools/src/tidas_tools/import_lca/cli.py:263-327`. | Existing reusable layer. | Once an adapter produces canonical store entities, this layer should be reused. |

## JSON-LD First Recommendation

The first request to the data provider should include openLCA JSON-LD re-export. The package already carries openLCA ILCD extension attributes such as `olca:unitId`, `olca:propertyId`, and `olca:defaultProvider`, so JSON-LD is likely the native or less lossy source format.

Preferred route:

1. Ask data provider for openLCA JSON-LD export, missing `sources/`, source UUID `0eb0c1f6...`, allocation method/factors, ownership/target account, and natural-gas unit confirmation in one message.
2. Query remote for `0eb0c1f6...` and provider UUIDs in parallel.
3. If JSON-LD is received, try the existing openLCA JSON-LD adapter first, while keeping HiQLCD profile normalization for language/source/name/provider governance.
4. If JSON-LD is unavailable, only then consider an ILCD adapter or temporary HiQLCD normalization pipeline.

## ILCD Adapter Preconditions And Scope If JSON-LD Is Not Available

An ILCD adapter should be considered only if these preconditions are met:

- the provider cannot or will not supply JSON-LD;
- the import owner accepts profile-level normalization and unresolved-source/provider policies;
- true source, allocation, ownership/account, and unit decisions are resolved or explicitly blocked;
- the work is expected to recur beyond one small package, or the adapter is justified as a reusable openLCA-ILCD capability.

Minimum adapter scope:

- detect ILCD process/flow/contact/unitgroup/flowproperty directories by namespace URI, not prefix;
- parse 10 process exchange lists, quantitative references, geography/time, contacts, flow properties, unit groups, and flow classifications;
- preserve openLCA extension attributes for unit/property/defaultProvider recovery;
- report missing `sources/` and package-external default providers as data blockers;
- support process-reachable cropping instead of importing all sidecar LCIA methods and unreferenced flows;
- hand off generated rows to existing TIDAS writer, validation, process-bundles, and mapping CSV layers;
- avoid hard-coded HiQLCD source repairs inside the adapter.

## Short Conclusion

HiQLCD should proceed as data补齐/governance confirmation plus temporary normalization plus necessary generic writer fixes. The current package is convertible as structured evidence, but it is not directly import-ready. The work should not put every source problem into an ILCD adapter: source delivery, source citation, allocation, ownership, unit confirmation, and language/name normalization need explicit profile governance before final database write.

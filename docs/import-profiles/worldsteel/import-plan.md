---
lastReviewedAt: 2026-09-05
lastReviewedCommit: 7867b3d9293d9435386c68a256a2498ec492f834
lastReviewedNote: "Reviewed for #100 CLI 0.1.10 adoption without changing Worldsteel R1-R5 decisions, account authority or retained evidence."
title: worldsteel EF3.1 ILCD Import Plan
docType: plan
scope: import-profile/worldsteel
status: draft
authoritative: true
revision: 4 (decisions D1–D4 + refinements R1–R5; R5 superseded FP/UG reference-only on 2026-07-01)
owner: tiangong-lca-data-foundry
language: en
whenToUse:
  - when executing or revising the sequenced Worldsteel import workflow
  - when tracing a current decision back to D1-D4 or refinements R1-R5
whenToUpdate:
  - when a Worldsteel workflow stage, dependency, resolved decision, or operational blocker changes
  - when a historical implementation path gains or loses current executable authority
checkPaths:
  - specs/import-profiles.json
  - scripts/commands/worldsteel-batch-import-run.ts
  - docs/import-profiles/worldsteel/profile.md
  - docs/import-profiles/worldsteel/constraints.md
  - docs/import-profiles/worldsteel/import-plan.md
  - docs/import-profiles/worldsteel/import-coverage.md
  - test/unit/worldsteel-support-mint-truth.test.mts
created_utc: 2026-06-29
related:
  - docs/uslci-import-plan.md
  - docs/uslci-import-runbook.md
  - docs/bafu-import-runbook.md
  - docs/import-profiles/hiq/hiq-import-governance-proposal.md
  - docs/import-profiles/bafu/profile.md
  - docs/import-profiles/bafu/constraints.md
  - specs/import-profiles.json
  - specs/canonical-support/flow-properties-unit-groups.json
  - WORKFLOW.md
  - AGENTS.md
input_package: inputs/CUP2025-2_2022b_v10_worldsteel_products_Tiangong_v1 EF3.1 2026_01_27
---

> **Rust cutover note:** Python `tidas-tools` source paths, virtualenv flags, package-release prerequisites, and legacy CLI conversion commands in this plan are frozen implementation history. They are not current blockers or TODOs. Active ILCD import and schema validation use the Foundry `dataset-tidas-import` / `dataset-tidas-validate` adapters over a compatible Rust `tidas` 0.2.x binary; CLI remains responsible for QA/curation, attachments, and remote handoff.

# worldsteel EF3.1 ILCD Import Plan

Current task authorization is defined by `docs/task-authorization-contract.md`. Distributed profiles grant no mint/write action or QA waiver. The dated R1–R5 decisions and inventories below are historical case evidence; new tasks require their own exact binding and action evidence. Local candidate preparation remains available, and old locks/seals/attempts are not rewritten or replayed.

## 0. TL;DR

The worldsteel package is a **native ILCD 1.1 / EF3.1 package** (Sphera/GaBi origin, converted to EF/EPLCA ILCD) with a **small new payload** (33 steel processes + ~74 genuinely new flows + a thin worldsteel contact/source/flow-property overlay) sitting on a **large EF3.1 reference layer** (~1,315 reference elementary flows + most flowproperties/unitgroups + 25 LCIA methods + EF/PEF/OEF/ILCD compliance boilerplate). Canonical reference rows are **reused, not minted**. The new payload is authored, and a materialized FP/UG absent from the canonical-support cache may enter the separately gated account-local support path recorded by R5.

The pipeline reuses the BAFU/USLCI foundry machinery almost entirely. **Two things block a literal copy of the USLCI plan, and they must be resolved first:**

1. **There is no ILCD _source_ adapter** in tidas-tools or the CLI. `import-lca convert --from-format` only accepts `ecospold1|ecospold2|openlca-jsonld|openlca-process-xlsx|simapro-csv`; a native ILCD package auto-detects as `FORMAT_UNKNOWN` and exits 2. → **Build an ILCD→TIDAS source adapter in `tidas-tools/import_lca`** (the HiQLCD proposal already scoped this; worldsteel + HiQ + future EF3.1/ILCD packages justify the reusable capability). This is the single biggest work item and gates the whole pipeline.
2. **External binary docs (`referenceToDigitalFile`) have no import-side handling.** The converter _deliberately drops_ the field (`tidas_json.py:493-498`); the only storage code is an **export-direction** S3 download. → Add attachment management **in `tiangong-lca-cli`** (NOT tidas-tools): a new command uploads the 13 binaries to the Supabase `external_docs` bucket **authenticated as the `data@worldsteel.org` account** (the same authenticated-user path the web app uses) and rewrites each source's `referenceToDigitalFile @uri` to `../external_docs/<key>`.

Everything downstream is the proven generic chain. Confirmed decisions (D1–D4 + refinements R1–R5, see Decision Log): the canonical DB **already holds the EF3.1 flows under their original UUIDs**, so the ~1,315-flow reference layer is **reused by UUID**; governance remains canonical-first, with a **capped escape hatch to mint at most 17 GaBi/Sphera pseudo-elementary flows** plus R5's profile-gated canonical-cache-miss FP/UG support path; the account is **`data@worldsteel.org`**; packaged contact id `d5710976` is unavailable, so one deterministic owner-draft contact carries the real World Steel Association identity; source versions remain in payload provenance while new owner-draft DB row keys use `00.00.001`. All 33 processes are ~2,000–2,543-exchange mega-scopes. Deterministic resolution rewrites still reduce authoring work, but unbound synthetic preflight seeding is disabled; live identity-preflight remains required until a dedicated request/resolution/provenance-bound seed manifest exists.

> **Implementation status, corrected 2026-08-25:** conversion/upload/profile prerequisites are landed and tested. The former `IDENTITY_PREFLIGHT_REUSE_MAP` preseed wrote an unbound synthetic decision and is now fail-closed instead of masquerading as CLI execution evidence. Mega-scope optimization remains open until it emits a dedicated hash-bound library-resolution seed manifest; current runs perform live identity-preflight for rows without valid execution evidence.

## Decision Log (answered 2026-06-29; R5 added 2026-07-01)

| # | Question | Answer |
| --- | --- | --- |
| **D1** | Account | **`data@worldsteel.org`** — use its dedicated ignored `.foundry/account-profiles/worldsteel.env` with exact project/user intent and the receipt-gated account wrapper. Do not select it through active/commented repository `.env` blocks. |
| **D2** | `external_docs` write-auth + owner | Use the **`data@worldsteel.org` account's authenticated session** (same INSERT permission the web app's authenticated users have). Implement attachment upload **in `tiangong-lca-cli`**, **not** tidas-tools. |
| **D3** | Land prerequisites before the import? | **Yes.** tidas-tools: **ILCD adapter** + **eilcd XSD fix**. tiangong-lca-cli: **external-doc upload** (NOT tidas-tools). foundry: **finalize perf optimization**. |
| **D4** | Does the canonical DB hold EF3.1 flows under original UUIDs? | **Yes.** → **Reuse by UUID directly** (fastest); semantic matching is reserved only for the 17 GaBi/Sphera pseudo-elementary flows + any residual. |
| **R1** | Library/attribution contact | **Corrected 2026-06-30:** packaged id `d5710976@20.20.002` is occupied by another account and is not public/visible. Omit explicit contact id/version so the runner derives one deterministic same-owner `00.00.001` contact from the real World Steel Association identity fields. |
| **R2** | Source attribution | **Add a `worldsteel` branch** to `source-semantics.ts` `databaseFallbackSourceConfig` (synthesized `worldsteel LCI database` source), so processes never inherit the BAFU citation. |
| **R3** | Residual elementary flows | **Allow minting at most 17 elementary flows** to keep the processes complete. These are NOT matched by UUID — give the AI full context to judge reuse-vs-mint. After the UUID-reuse pass, review how many remain; set the shared `enabled=false` only when both this R3 residual and R5 FP/UG support no longer require account-local authorization. |
| **R4** | Version numbering | **Corrected 2026-06-30:** preserve source versions inside the ILCD/TIDAS payload for provenance; new Worldsteel-owned DB row keys use `00.00.001`, while reused canonical references retain their current published versions. |
| **R5** | Unmatched FP/UG support | **Supersedes the earlier FP/UG reference-only plan.** Freeze `mintUnmatchedFpUgSupport=true`. A materialized FP/UG absent from the canonical-support cache enters the task-authorized same-owner My Data support set at `00.00.001`; Unit Groups precede Flow Properties and dependent rows wait for support closeout/readback. The retained 10+10 LANCA gap motivated the decision, but the runtime has no LANCA name whitelist or numeric cap. Canonical matches are always reused. |

---

## 1. Scope: new payload vs reference payload

Input: `inputs/CUP2025-2_2022b_v10_worldsteel_products_Tiangong_v1 EF3.1 2026_01_27/` — standard ILCD zip (`META-INF/MANIFEST.MF` ILCD-Version 1.1). Counts: **processes 33, flows 1389, sources 76, contacts 44, flowproperties 198, unitgroups 146, lciamethods 25, external_docs 13.**

### 1a. NEW payload — author / profile-gated account-local mint

| Entity | Count | Notes |
| --- | --- | --- |
| **Processes** | **33** | All LCI-result, attributional, mass-based (`1 kg`), GLO/Europe/EU, reference year 2022 (a few EU 2019/2020/2021). ~2,000–2,543 exchanges each. **LCIAResult = 0 on all 33** (expected for LCI-result; corroborated by `REPORT_PR.xlsx` "Doesn't have LCIA results"). Classification = ILCD `Materials production / Other materials` (no CPC). `Value of Scrap 2022` (`91bd5958`) is an economic/allocation dataset, not a physical product. |
| **Product flows** | 26 (12 distinct steel products reused across geo variants) | e.g. Steel rebar `aeaa3016`, Hot rolled coil `2126a80d`, Plate `b5bb65d3`, Sections `f46cd45b`, Wire rod `7299bf50`, pipes (welded/seamless/UO), galvanised/tinplated/organic-coated/ECCS. Plus intermediate materials (Water variants, Chalk, Hydrogen, Gypsum, etc.). dataSetVersion `20.25.x`. |
| **Waste flows** | 25 | scrap variants, slag/scoria/jarosite, overburden/tailings, hazardous/demolition waste, treated wastewater, oil sludge. |
| **Other flows** | 6 | transport carriers (river freight, tanker, rail-electric, bulk carrier). |
| **GaBi/Sphera "elementary" flows** | **17** | Typed `Elementary flow` at version `20.25.x` but **not** in the EF/ILCD reference set (Aktinide general, Radioactive isotopes unspecific, Heavy metals to water unspecified, scarcity-tiered water, etc.). **Must reuse-match-or-mint** — do NOT blanket-reuse them with the 1,315 reference elementaries. |
| **worldsteel contacts** | ~6 | worldsteel, Sphera Solutions GmbH, thinkstep (×2), IABP-GaBi, Finkbeiner, Ramboll Italy. |
| **worldsteel sources** | ~5 | 2017 worldsteel Critical Review Report (`b86f1fd8`, citation-only, no binary), Sphera MLC (`61875b4e`), Sphera Land Use LCI (`5d8c535d`), LCWE doc (`10e645f5`), ISO 14040/14044. |
| **worldsteel flowproperties** | thin overlay | "Energy (net calorific value) – worldsteel balance", "Steel and iron materials (unspecified)" `29b03f81`, element-content / resin properties. Reuse canonical where one exists; the genuine worldsteel-specific ones are support. |

**Genuinely new authorable flows ≈ 74** (57 non-elementary + 17 GaBi pseudo-elementary).

### 1b. REFERENCE payload — reuse-match to existing canonical, never mint

- **~1,315 of 1,332 elementary flows** are EF/ILCD reference flows (versions `03.x/01.x/00.00.002/02.x/04.x`). **1,278 carry `permanentDataSetURI` at `lca.jrc.ec.europa.eu` (legacy ILCD reference network)**, only 21 at `eplca.jrc.ec.europa.eu`. → These are _legacy ILCD reference_ flows carried into the EF3.1 package — **the same situation as the USLCI land-flow case**. Reuse-match by identity, do not assume EF3.1 UUID identity.
- **Mass FP `93a60a56-a3c8-11da-a746-0800200b9a66`** (canonical) is the reference flow property for **1,061 of 1,332** elementary flows; ~95%+ of all flow→FP edges hit canonical FP UUIDs already in `specs/canonical-support/flow-properties-unit-groups.json`.
- Most of the **198 flowproperties / 146 unitgroups** are EF/ILCD reference + LCIA-method unit groups → reuse.
- **25 LCIA methods** = EF3.1 reference LCIA boilerplate → **out of import scope** (reference/provenance only, mirroring the BAFU rule "must not write lciamethods inline").
- EF/PEF/OEF/ILCD compliance + LCIA-citation sources/contacts → reuse-by-identity (see §6 canonical source rewrites). The ILCD-format source `a97a0155-...@03.00.00x` is shipped and is the exact UUID hardcoded in `source-semantics.ts`.

### 1c. EXCLUDED — not import payload

`other/converter/Mapping_UUID.xlsx` (EF3.0/GaBi→EF3.1 **process-level** UUID crosswalk — **not** a flow-identity map; zero overlap with `ILCD/flows`), `other/converter/REPORT_PR.xlsx` (generic EF3.0→EF3.1 conversion-QA report; none of the 33 steel UUIDs appear), `other/converter/*.xml` (6 EF LCIAMethod XMLs), `other/Normalisation_Weighting_Factors_EF_3.1.xlsx`, `other/lookLciMethodInformation.config`, the raw `schemas/` (use tidas-tools' _corrected_ eilcd schemas instead). Keep all as provenance evidence in the source manifest.

---

## 2. Foundational decision D1 — ILCD ingestion path (gates everything)

**Problem (verified at 3 layers):** `tidas-tools/src/tidas_tools/import_lca/detect.py:29-35` `SUPPORTED_FORMATS` has no ILCD member; `import_lca/cli.py` `_adapter_for` has no ILCD branch; `tiangong-lca-cli/src/cli.ts:946` `--from-format` enumerates only the five non-ILCD formats. Worldsteel root namespaces are `http://lca.jrc.it/ILCD/*` → `FORMAT_UNKNOWN` → `unsupported_format` exit 2. This is the **same wall HiQLCD hit** (`docs/import-profiles/hiq/hiq-import-governance-proposal.md`).

**Decision framework (from the HiQLCD proposal):** the adapter boundary is _narrow_ — it converts source-format semantics into canonical TIDAS rows and preserves trace; it must NOT absorb source-data errors, invent allocation, choose backgrounds, or decide fallback citations (those are profile governance). The proposal prefers "ask the provider for openLCA JSON-LD first" and treats an ILCD adapter as justified only when JSON-LD is unavailable **and** the work recurs.

**Recommendation: build the ILCD→TIDAS source adapter in `tidas-tools/import_lca` (Option A).** Rationale specific to worldsteel:

- Worldsteel's native origin is **Sphera/GaBi** (`thinkstepio:` extension namespace), not openLCA — there is **no JSON-LD re-export to request**. The "JSON-LD first" escape hatch does not apply.
- The package is **self-contained** (ships its own sources/, FP/UG, elementary flows, contacts) — unlike HiQ it has no missing-references blocker, English-only (no CJK-in-`en` defect), and a **recognized standard publisher** → meets the proposal's adapter preconditions cleanly.
- The need **recurs** (HiQ + worldsteel + future EF3.1/ILCD deliveries), so a reusable adapter is the correct owner per `specs/capability-ownership-rules.json` (conversion mechanics belong to tidas-tools, never patched in foundry).

**Adapter minimum scope** (crib HiQ "Minimum adapter scope" + EF3.1 specifics):

1. `detect.py`: add `FORMAT_ILCD`, sniff by **root namespace URI** `http://lca.jrc.it/ILCD/*` (process/flow/flowproperty/unitgroup/source/contact roots), not by file prefix; add `ilcd` to the CLI `--from-format` enum.
2. `IlcdAdapter.read(input, MemoryCanonicalStore, report)`: parse process exchange lists, quantitative reference, geography/time, modelling/validation (reviews + `referenceToCompleteReviewReport`), compliance declarations, contacts, sources, flow properties, unit groups, flow classifications. **Preserve native UUIDs and versions** (critical for reuse — see §7).
3. **Preserve `referenceToDigitalFile`** through to the TIDAS source rows (the existing writer drops it — see D2). The corrected `tidas_sources.json:111-137` already models the field as `{@uri}` object|array, so emitting it is schema-legal.
4. **Preserve** the `thinkstepio:`/`ext:` extension elements (or drop them safely) — confirm they don't fail corrected-eilcd validation.
5. Apply the EF3.1 corrections the writer already owns: `Perc` totalDigits=5/fractionDigits=3 (strip trailing zeros), version pattern `NN.NN(.NNN)`, GlobalReferenceType `@type` enum, language enum, UnitGroup reference-unit selection, CAS-checksum surfacing.
6. **Process-reachable cropping**: build the working scope from the 33 processes' exchange-referenced flows + required support + source/contact trace; keep the full package as evidence but do not import the LCIA methods / unreferenced sidecar.
7. Hand off to the existing `write_tidas_package` → `scan_conversion_gaps` → `validate_package_dir` → `write_process_bundles` layers (reuse, don't fork).
8. Do **not** hard-code any worldsteel-specific repair inside the adapter.

**Fallback (Option B):** a bespoke one-off `ilcd→tidas` reader script under `docs/import-profiles/worldsteel/` if landing the adapter in tidas-tools is deferred. Disfavored — it duplicates the writer/validation/bundle layers and won't help HiQ.

> `tidas-convert --to-tidas` is **not** a substitute: it is a dumb `xmltodict` transcoder (no schema correction, no canonical resolution, no validation). Output would fail TIDAS validation and lack reuse.

**EF3.1-correction handoff:** the conversion's corrections come from the **local `--tidas-tools-dir` / `--python` venv (0.0.36)**, not the published CLI (foundry's CLI shells to python; the bundled tidas-tools must be ≥0.0.35 — the local checkout is 0.0.36, so pass `--tidas-tools-dir /Users/davidli/projects/workspace/tidas-tools --python <its .venv>`). The corrected schemas under `tidas-tools/src/tidas_tools/eilcd/schemas` + `tidas/schemas` (locked by `schema.lock.json`) are the source of truth — **not** raw EF3.1, and not the (possibly stale) `linancn/EF-reference-package-3.1-Correction` XSLT repo.

**Validator-crash patch (do before any eILCD validation):** `validate.py:975 schema.validate()` is **not** wrapped in try/except, and the bundled `ILCD_Common_DataTypes.xsd:181/191/201` `<xs:attribute ref="xml:lang" default="en"/>` triggers a libxml2 internal error (`xmlSchemaVAttributesComplex`) on ~230 multilang files (empirically reproduced). This **aborts** `validate_ilcd_package_dir` mid-run. Fix in tidas-tools: strip `default` from the `xml:lang`/`name` attribute uses (and the `name="name" default="ILCD"` in `ILCD_Common_Groups.xsd:92/267`) or guard `schema.validate`. The schema _content_ is clean (only 1/76 sources had a real issue), so this is a tooling bug, not a data problem.

---

## 3. Foundational decision D2 — external-doc storage contract (the user's concern #1)

**Verified state:** the foundry CLI has **zero** storage/upload code; `tidas_json.py:493-498` **deliberately drops** `referenceToDigitalFile`; the only storage code is **export-direction** (`export.py:147 download_external_docs`, boto3 against `AWS_EXTERNAL_DOCS_BUCKET`). The working _upload_ path exists only in the **web app**: `tiangong-lca-next/src/services/supabase/storage.ts uploadFile()` → `supabase.storage.from('external_docs').upload(<key>)`, with the source JSON storing `referenceToDigitalFile = [{"@uri":"../external_docs/<key>"}]` (`Sources/Components/create.tsx:114-156`). `external_docs` is a **private** bucket (reads via `createSignedUrl`). `AWS_EXTERNAL_DOCS_BUCKET` is **unset** in foundry `.env`.

**The 13 binaries and how they're referenced (ground truth):**

| Binary | size | referencing source UUID(s) |
| --- | --- | --- |
| bof+route+pic.jpg | 121 KB | 109bed9b |
| bof+route.png | 21 KB | 89744403 |
| eaf+route+pic.jpg | 54 KB | c2fd9baf |
| eaf.png | 11 KB | c86a2586 |
| full+lca.png | 19 KB | fe35a7c7 |
| worldsteel+blast+furnace.jpg | 92 KB | c4173b23 |
| worldsteel+electric+arc+furnace.jpg | 38 KB | 1d4ed9fd |
| ILCD-Data-Network*Compliance-Entry-level*…pdf | 604 KB | 9ba3ac1e |
| ILCD*Compliance_Rules_Draft*…pdf | 79 KB | 88d4f8d9 |
| oefsr_guidance_v6.3.pdf | 3.75 MB | bb3e3630 |
| pefcr_guidance_v6.3-2.pdf | 4.07 MB | e2ecfeb8 |
| **pef_method.pdf** | 4.29 MB | **37d1d84f, 4622beed, 779fb9ea, 909ae358, afc1ce43, cbeab91f, cec792b1** (shared by 7) |
| European*Commission_EPLCA_logo*…jpg | 29 KB | **417b6710** (`..\external_docs\…`, correct case) **and 99d22639** (`../external_docs/…`, all-lowercase) — one binary, two sources, two encodings |

**Recommended contract (per D2 — owner is `tiangong-lca-cli`, auth is the account session):**

- **Owner + transport:** a **new `tiangong-lca-cli` command** uploads via the existing **authenticated** Supabase client — `supabase.storage.from('external_docs').upload(<key>, <bytes>)` using the **`data@worldsteel.org` access token** (`SupabaseDataRuntime.getAccessToken()` in `src/lib/supabase-client.ts`). This is the **same authenticated-user path the web app uses** (`tiangong-lca-next/src/services/supabase/storage.ts`), so the account already has the INSERT permission — **no service-role key, no boto3/AWS, no tidas-tools change.** (`tidas-tools` stays read/convert-only.)
- **Bucket:** `external_docs` (private; the web app hardcodes it at `key.ts:5`). Reads are signed-URL only.
- **Object-key convention:** keep the **original on-disk filename** as the key (human-readable; round-trips with `export.py`'s download-by-raw-key), **percent-encode** `+`/spaces. The stored `@uri` must stay the **3-part `../external_docs/<key>`** form so the web viewer's `resolveStorageFilePath` resolves it.
- **Dedupe:** upload each physical binary **once** (pef_method.pdf once, logo once) but keep all referencing source rows.
- **URI normalization (must handle):** (a) backslash `..\external_docs\…` → forward slash; (b) case-insensitive filename resolution (the `99d22639` all-lowercase ref must map to the capitalized on-disk file or it 404s); (c) **leave plain `http(s)://` `referenceToDigitalFile` URIs untouched** (e.g. `http://lca.jrc.ec.europa.eu`, ecoinvent/quantis/thinkstep node URLs) — those are pointers, not binaries; do not upload them.
- **Idempotency:** stable keys → re-runs overwrite, not duplicate; mirror the web app's delete-on-source-delete cleanup if a source is later removed.

**Pipeline insertion point** — a **new step between conversion and save-draft/publish:**

1. Adapter (D1) preserves the local `../external_docs/*` refs into the TIDAS source rows.
2. New CLI command — e.g. `tiangong-lca dataset source upload-attachments --tidas-dir <conversion>/tidas --external-docs-dir "inputs/.../ILCD/external_docs"` (or an `--upload-external-docs` flag on `dataset save-draft --type source`) — enumerates each source's local `referenceToDigitalFile` refs, resolves to the on-disk binary (case/slash-tolerant), uploads each once, then rewrites the `@uri` to the normalized `../external_docs/<key>`.
3. `save-draft`/`publish` then persists the rewritten JSON unchanged (the `app_dataset_create` edge command carries JSON only — binaries never travel through it).

> Reconcile with the prior intentional fix (`67548bf`) that _stopped_ writing source URLs into `referenceToDigitalFile`: that fix targets _URL_ sources (keep as description text). Worldsteel's local-binary refs are the legitimate case for emitting `referenceToDigitalFile`. The upload step must **distinguish a true uploaded binary from a mere URL** — exactly the normalization rule above.

---

## 4. Governance & profile decisions

| Decision | Decision (implemented) | Why |
| --- | --- | --- |
| **Reuse vs mint** | Canonical-first for the ~1,315-flow reference layer and FP/UG. **R3:** a capped allowance to mint **≤17** GaBi/Sphera pseudo-elementary flows. **R5:** `mintUnmatchedFpUgSupport=true` sends materialized FP/UG canonical-cache misses through the gated account-local support path. | Canonical rows are reused, never minted. R5 was prompted by the 10+10 LANCA gap but is enforced by cache-miss + profile/gate semantics, not a name/count whitelist. Support failure defers the dependent scope while independent ready scopes may continue. **Do not copy another profile wholesale.** |
| **17 GaBi pseudo-elementary (R3)** | Reuse-match first **with full AI context** (NOT by UUID); mint the residual as account-local My Data (state_code=0), capped at ≤17. **Review the actual residual count after the UUID-reuse pass**; require separate current task authorization for both elementary and FP/UG actions that are actually needed. | Keeps canonical clean while guaranteeing the 33 steel processes stay complete. |
| **Profile** | `worldsteel` entry in `specs/import-profiles.json`: source rules, strict full-context proof and conditional naming semantics. Task authorization separately binds R3/R5 write actions and any source-model QA exception; `mintUnmatchedFpUgSupport=true` selects local preparation. The wrapper independently freezes that executable flag. | The contract test freezes runtime `true`, checks that structured profiles grant no authorization, and compares the preparation declaration against every active Worldsteel document without pretending an unconsumed JSON mirror is an execution gate. |
| **Account** | **`data@worldsteel.org`** (dedicated). Create ignored `.foundry/account-profiles/worldsteel.env` with the three CLI credential values plus `FOUNDRY_EXPECTED_PROJECT_REF` and the canonical `FOUNDRY_EXPECTED_USER_ID`. Do not select accounts by commenting blocks in the repository `.env`. | Account identity is **not** in profile JSON; it lives in the runtime account profile, Codex thread guard when applicable, and the fresh CLI 0.1.3 intent-bound receipt. The same receipt-gated account context authenticates the external-doc upload (D2). |
| **State / version (R4)** | `state_code=0` (My Data draft) and DB row-version key `00.00.001` for new Worldsteel-owned rows; reused canonical refs stay `state_code=100` at their published versions. Preserve the source `dataSetVersion` inside the payload as provenance. | Native DB slots are occupied by other accounts. Separating payload provenance from the DB row key preserves source evidence without collisions. |
| **Library/attribution contact (R1)** | Mint one deterministic same-owner `00.00.001` contact from the runner's real World Steel Association identity fields; do not pass the unavailable packaged `d5710976` id/version and never use NREL/FOEN/GaBi-software defaults. | The first-import bootstrap (`commitFlowSupportInline:true`) needs a visible owner-draft contact; the deterministic identity is stable and faithful. |
| **DB-fallback source (R2)** | `worldsteel` branch added to `source-semantics.ts databaseFallbackSourceConfig` (shortName "worldsteel LCI database", worldsteel citation, `worldsteel.org/lci/<id>` URI). | **Without it, worldsteel processes silently inherit the BAFU 2025 default fallback source — a data-integrity corruption, not an error.** |
| **LCIA methods** | Out of scope (reference/provenance only). | Same rule as BAFU "must not write lciamethods inline." |

---

## 5. Code touchpoints

✅ = landed + tested (2026-06-29, not committed/pushed). ⏳ = still to do.

1. ✅ **tidas-tools `import_lca`** (D1): `adapters/ilcd.py` `IlcdAdapter` (parses all 6 entity types by root namespace, preserves UUIDs/versions/classification/exchanges, skips LCIA methods); `detect.py FORMAT_ILCD` + namespace sniff; `cli.py _adapter_for` dispatch; `tiangong-lca-cli` `--from-format ilcd` documented. Tests: `tests/test_import_lca_ilcd.py` (3).
2. ✅ **tiangong-lca-cli** (D2, NOT tidas-tools): `dataset source upload-attachments` (`src/lib/dataset-source-upload-attachments.ts` + `src/cli.ts` dispatch) — authenticated `external_docs` upload + `referenceToDigitalFile` rewrite, dedup, backslash/case normalization, http-URI passthrough. 25 tests, 100% coverage.
3. ✅ **tidas-tools eilcd XSD + writer** (D1/D2): removed `default` from the 5 `xml:lang`/`name` attribute uses (`ILCD_Common_DataTypes.xsd`, `ILCD_Common_Groups.xsd`) — libxml2 crash fixed (validate regression test added); `writers/tidas_json.py` `_source_payload` now emits `referenceToDigitalFile` for local file refs (`_digital_file_refs`).
4. ✅ **`scripts/lib/source-semantics.ts`** (R2): `worldsteel` `databaseFallbackSourceConfig` branch (test added: "worldsteel database fallback source cites worldsteel, never BAFU").
5. ✅ **`scripts/commands/post-authoring-finalize.ts`**: widened the `source_contact_rewrites` gate to include `'worldsteel'`.
6. ✅ **`specs/import-profiles.json`** + **`docs/import-profiles/worldsteel/{profile.md,constraints.md}`**: `worldsteel` profile (capped ≤17 mint, full-context on) + docs. Test added (profile registration).
7. ✅ **`scripts/commands/worldsteel-batch-import-run.ts`** + **`bundle-sample-utils.ts`** (R1/R5): runner wrapper (`mintUnmatchedFpUgSupport:true`, `applyResolutionRewrites:true`, real World Steel Association `libraryContact` fields with no explicit id/version so identity is derived deterministically); registered in `foundry.ts`, `foundry-cli.ts`, `foundry-command-registry.ts`, `foundry-command-metadata.ts`. Factory and profile-truth contracts cover the frozen value.
8. ⏳ **Mega-scope speed-up (§8)**: unbound synthetic preseed reports are disabled. A replacement must bind request bytes, library-resolution bytes, canonical target, producer provenance, and report bytes before `onlyPending` may skip live identity-preflight.
9. ⏳ **context-pack**: generate `tiangong-lca dataset context-pack --type process|flow --profile ai-import` outputs (schema.json/methodology.yaml/runtime-ruleset.json + `tidas_*_category.json`) for the classification round.

---

## 6. End-to-end pipeline (ordered)

Environment for every step:

```bash
pnpm install --frozen-lockfile   # installs the exact @tiangong-lca/cli@0.1.3 project dependency
RUN=".foundry/workspaces/worldsteel-full-import-$(date -u +%Y%m%dT%H%M%SZ)"   # stamp once; the runtime forbids Date.now in workflows but the shell is fine
TUID="<worldsteel target user id>"   # in zsh, NOT UID (reserved)
```

### Phase 0 — source intake + closure

- Freeze the immutable source manifest (`source-manifest.json`, `profile-lock.json`, account-write-guard) under `$RUN/`. Worldsteel is self-contained (no external library merge needed, unlike USLCI), but verify **0 dangling references** in the package's own closure first.

### Phase 1 — conversion (NEW ILCD adapter; tidas-tools owns)

```bash
./node_modules/.bin/tiangong-lca dataset import-lca convert \
  --input "inputs/CUP2025-2_2022b_v10_worldsteel_products_Tiangong_v1 EF3.1 2026_01_27" \
  --output-dir "$RUN/conversion-v1" \
  --from-format ilcd --target tidas --validation-jobs 0 \
  --python /Users/davidli/projects/workspace/tidas-tools/.venv/bin/python \
  --tidas-tools-dir /Users/davidli/projects/workspace/tidas-tools --json
```

Produces `$RUN/conversion-v1/{tidas/, process-bundles/, conversion-report.json}`. **Exit gates:** conversion-report 0 error; TIDAS validation 0 (expect Perc-overflow + CAS-checksum surfacing on EF3.1 rows — confirm corrected); bundle `unresolved_references == 0`; **confirm LCIAResult=0 is tolerated** (writer/finalize/mutation-manifest must not require an LCIA block); confirm `thinkstepio:`/`ext:` extensions preserved-or-dropped without validation failure.

### Phase 1.5 — external-docs upload + URI rewrite (NEW; D2 — runs in `tiangong-lca-cli`, authenticated as `data@worldsteel.org`)

```bash
pnpm account:run -- worldsteel -- \
  node node_modules/@tiangong-lca/cli/bin/tiangong-lca.js dataset source upload-attachments \
    --tidas-dir "$RUN/conversion-v1/tidas" \
    --external-docs-dir "inputs/CUP2025-2_2022b_v10_worldsteel_products_Tiangong_v1 EF3.1 2026_01_27/ILCD/external_docs" \
    --bucket external_docs --json
```

Uploads each of the 13 binaries once (dedupe; percent-encode keys), then rewrites the converted TIDAS sources' `referenceToDigitalFile @uri` to `../external_docs/<key>` (normalize backslash/case; leave `http(s)` URIs). **Gate:** verify each rewritten `@uri` resolves via a signed URL before proceeding.

### Phase 2 — library index

```bash
node scripts/foundry.ts dataset-library-index-build   # → $RUN/library-index-v1  (entity index + scope-projection.jsonl)
```

### Phase 3 — decision rounds (author on the FINAL conversion only)

> The #1 USLCI bug was re-projecting compartment-fingerprinted elementary reuse decisions onto a newer conversion. Author identity/elementary decisions **against `conversion-v1`** and never re-project.

- **3a. Identity preflight** — `dataset-identity-preflight-requests-build` → `-query-audit` → `dataset-identity-preflight-run` (CLI `flow|process identity-preflight`, semantic `flow_hybrid_search` on name + EF3.1 compartment path + CAS + reference FP) → `-index-merge`.
- **3b. Elementary reuse (D4 = reuse-by-UUID confirmed):** the canonical DB already holds the EF3.1 reference flows under their **original UUIDs**, so:
  - **Reference layer (~1,315 flows) → deterministic reuse-by-UUID.** Build an offline library-resolution producing `exchange-reference-rewrites.jsonl`; each row must carry `canonical_short_description`. Apply rewrites with `applyResolutionRewrites:true`. Until a bound seed-manifest contract is implemented, do not treat the rewrite file as identity-preflight execution evidence: live preflight still runs where the workflow requires it.
  - **17 GaBi/Sphera pseudo-elementary + any UUID miss → semantic + AI matching only.** Run identity-preflight + the **AI-first physical-equivalence round** (mirror `$RUN/ai-elementary-match-v1/`: slim ~14-candidate tasks, explicit per-batch id files, adversarial verify) for just this small tail. The historical R3 approval covered that original residual; new task authorization must explicitly admit the current residual as account-local My Data; it remains subject to the full profile/finalize gates.
- **3c. Classification** (the one hard AI round): `context-pack --profile ai-import` → `dataset-bundle-sample-rows --profile worldsteel` → `dataset-classification-decision-task-build` → AI authors process→ISIC4 leaf, product-flow→CPC level-4 leaf → `dataset-library-classification-decisions-project` → `dataset-classification-decisions-apply`. **Keep the queue file byte-identical at build/project/apply** (sha binding → `classification_decision_task_queue_mismatch`). Note: worldsteel processes ship no CPC; classification is authored fresh.
- **3d. Location** — `dataset-location-decision-task-build/-suggest/-apply` (GLO/Europe/EU; preserve, don't collapse).
- **3e. Canonical-support** — `dataset-support-cache-refresh --out specs/canonical-support/flow-properties-unit-groups.json` (state_code=100 only) first; then reuse FP/UG by exact UUID via `canonical-support-rewrites.ts`. **Never** write account-local FP/UG UUIDs into the shared cache. Pass `--block-on-unscaled-canonical-support` through bundle sampling so any scale≠1 rewrite remains in `canonical-support-amount-scaling.jsonl`, the report, and the process-scope ledger; known positive non-1 factors use `canonical_support_amount_scaling_required`, while a missing/non-finite/non-positive factor uses `canonical_support_amount_scale_unresolved`. Watch `canonical_flow_property_unit_group_unproven` (EF3.1 FP family `93a60a56-a3c8-*` vs its reference UG family `93a60a57-a4c8-*`) and do not relax either scale blocker.

### Phase 3-apply — resolution

```bash
node scripts/foundry.ts dataset-library-decisions-apply \
  --library-index "$RUN/library-index-v1" --decisions-dir "$RUN/decisions-v1" --profile worldsteel
# → ready-scopes.jsonl, blocked-scope-ledger, rewritten-processes/<id>.json, exchange-reference-rewrites.jsonl
```

Archive any stale `decisions-*` dirs **out of `$RUN`** so the runner's carry-forward glob can't merge them (the USLCI over-mint root cause).

### Phase 4 — per-scope finalize + commit (the runner)

```bash
node scripts/foundry.ts dataset-worldsteel-batch-import-run \
  --run-dir "$RUN" \
  --process-bundles-dir "$RUN/conversion-v1/process-bundles" \
  --library-resolution "$RUN/library-resolution-v1" \
  --scope-file "$RUN/library-resolution-v1/ready-scopes.jsonl" \
  --library-classification-decisions "$RUN/decisions-v1/classification-decisions.jsonl" \
  --target-user-id "$TUID" --state-code 0 --profile worldsteel \
  --out-dir "$RUN/batch-import-v1" --commit --parallel 8
```

Per-scope stages (inside `scope_commit_gate`, flows-first then process): `finalize_ready` → `finalize_after_support[_reuse]` (commits library contact/source support inline — the new-library bootstrap) → `commit` → `post_write_verify` (+retry/accepted-diff) → `closeout`. Run a **resumable loop** (verified scopes skip; blocked stay pending); expect ~10% transient support-commit-race blocks that recover on re-run.

### Phase 5 — coverage + delivery

- `node scripts/foundry.ts dataset-import-ledger-report --ledger-dir <dir>` (the BAFU `universe-coverage-report` is BAFU-hardcoded — do not use). Target: verified + minimal registered-non-importable = universe, gap 0.
- Trace workbook: fork `reports/uslci-import/` (BAFU/USLCI builders are path-hardcoded, not drop-in) → `reports/worldsteel-import/`.
- Delivery: one PR to `tiangong-lca/data-foundry` main with final rows + validation/QA/curation reports + mutation-manifest + commit-handoff + post-write verify + completeness snapshot; pass the **docpact** pre-push gate (review-mark + commit doc, covering AGENTS.md/WORKFLOW.md/docs/specs/scripts); then bump the `tiangong-lca-data-foundry` submodule pointer in the meta-repo. The tidas-tools adapter + export changes ship as their own PR/release (≥ the version the CLI bundles) **before** the foundry import runs.

---

## 7. Reuse mechanics (D4 = reuse-by-UUID)

The canonical DB **already holds the EF3.1 reference flows under their original UUIDs**, so the reference layer is reused **by UUID**, deterministically — the cheapest and most reliable path, and it sidesteps the mega-scope per-flow remote-search cost entirely.

**Mechanism** (the foundry has no by-UUID elementary matcher today, so this is a small new offline helper, not a pipeline change):

1. From the converted process bundles, collect the distinct `(flow_id, version)` referenced by the 33 processes' exchanges.
2. Batch-look-up each canonically (`flow get` by `id`+`version`, or a direct read of the canonical/state_code=100 set). **Resolve the version:** worldsteel ships e.g. `03.00.004` for reference flows; point the rewrite at whatever canonical version actually exists (capture `short_description` for the display name).
3. Emit `exchange-reference-rewrites.jsonl` rows → canonical `{id, version, short_description}`, **always including `canonical_short_description`** (else committed exchanges show the UUID, not the name — the USLCI reused-flow-name bug).
4. The runner applies rewrites deterministically with `applyResolutionRewrites:true`; identity-preflight remains independently receipt/report-bound and cannot be skipped by an unbound rewrite file.

**Still to verify during the run (not blockers, but cheap insurance):**

- Cross-reference which of the 1,332 elementary flows are actually referenced by the 33 processes (rebar alone references ~2,496 reference-elementary exchanges, so coverage is near-total — confirm to size the resolution).
- Spot-check version alignment on a ~20-flow sample (worldsteel ships _legacy_ ILCD versions like `03.00.004`; confirm the canonical rows carry a matching/expected version).
- Audit the ~97 non-canonical chemical-content FPs / ~135 unitgroups + amount-scaling dimensions. Under R5, a materialized canonical-cache miss is a task-authorized account-local candidate; there is no LANCA/name/count whitelist. Keep both `canonical_support_amount_scaling_required` and `canonical_support_amount_scale_unresolved` active, and defer the dependent scope on any support/closure/readback failure.

---

## 8. Mega-scope reality (worldsteel-specific)

**Every one of the 33 processes is a "mega-scope" by USLCI's definition** (~2,000–2,543 exchanges each; USLCI deferred scopes at 1,191–2,429 flows). The runner's serial per-flow **remote** identity-preflight costs tens of minutes to ~1 hr per scope. USLCI deferred 11 such; worldsteel has **33 — all of them.**

The vast majority of those exchanges point at EF3.1 reference flows that will reuse canonical. Deterministic rewrites reduce downstream authoring, but they no longer suppress live identity-preflight without a bound seed manifest. Treat the extra remote searches as the safe current cost; run megas at `--parallel 1` if needed and tune `IDENTITY_PREFLIGHT_CONCURRENCY`/`BAFU_BATCH_STAGE_TIMEOUT_MS` while the bound seed optimization is tracked separately.

---

## 9. Risk register (consolidated gotchas)

- **Use the project-installed CLI** — leave `TIANGONG_LCA_CLI_BIN` blank so Foundry resolves exact `@tiangong-lca/cli@0.1.10`; an override is only for an explicit local test binary. Credential-scoped execution still goes through the receipt-gated `pnpm account:run` wrapper.
- **Don't copy BAFU/USLCI profile wholesale** — Worldsteel reuses every canonical row by UUID, caps the R3 elementary tail, and enables R5 only for materialized FP/UG canonical-cache misses behind the full account-local support gates.
- **`databaseFallbackSourceConfig` silently inherits BAFU** for any unknown profile → ✅ worldsteel branch added.
- **`source_contact_rewrites` gated to bafu/uslci** → ✅ widened to include `worldsteel`.
- **Converter drops `referenceToDigitalFile`** → ✅ adapter preserves local refs + writer emits them; the CLI upload step runs before save-draft (ordering still matters operationally).
- **libxml2 XSD crash** on ~230 multilang files → ✅ eilcd XSD `default` attributes removed; validates cleanly.
- **`functionalUnitOrOther` is boilerplate** ("Steel hot rolled coil - 1kg (Mass)") on all 33 — never use it for product identity; use the reference exchange's flow shortDescription.
- **`Value of Scrap 2022` (91bd5958)** is economic/allocation, not a product — handle distinctly.
- **EPLCA-logo case/slash collision + pef_method.pdf shared ×7** — dedupe binary, normalize URIs, keep all source refs.
- **Classification queue sha binding** — same queue file at build/project/apply.
- **Over-mint carry-forward** — archive stale `decisions-*` out of `$RUN`; reuse-only governance makes this largely moot (unmatched block, not mint) but keep the discipline for process-level decisions.
- **No silent amount scaling** — `canonical-support-rewrites.ts` repoints FP refs but never converts amounts; keep the scale-mismatch blocker active.
- **Delete-reimport is a dead-end** — ledgers are append-only/deduped; reruns skip verified scopes. Fix code, don't delete to re-import.

---

## 10. Open questions

**All resolved (Decision Log):** ✅ D1 account = `data@worldsteel.org` · ✅ D2 upload owner = `tiangong-lca-cli` + account session · ✅ D3 land prereqs first · ✅ D4 reuse-by-UUID · ✅ R1 deterministic owner-draft World Steel Association contact (packaged id unavailable) · ✅ R2 worldsteel source branch · ✅ R3 capped ≤17 elementary mint (count decided after the UUID-reuse pass) · ✅ R4 source version in payload provenance + new DB row key `00.00.001` · ✅ R5 unmatched materialized FP/UG support mint enabled under canonical-first gates.

**Remaining operational decisions (not blocking the build):**

1. **Final residual mint count (R3 follow-up):** after the UUID-reuse pass + AI matching, review how many of the ≤17 GaBi/Sphera pseudo-elementary flows actually have no canonical match. Set `allow_account_local_support_and_elementary.enabled=false` only when both the R3 elementary residual and R5 unmatched FP/UG support no longer require account-local authorization.
2. **`allow_remote_commit`:** stays human-gated until the pilot scope is verified end-to-end (dry-run → commit → readback).

---

## 11. Sequenced checklist

1. [x] **tidas-tools** ILCD adapter + `detect.py FORMAT_ILCD` + `cli.py` dispatch + `--from-format ilcd`; preserves UUIDs/versions/classification/exchanges/`referenceToDigitalFile`; skips LCIA. Tests green; full worldsteel package → valid TIDAS.
2. [x] **tidas-tools** eilcd XSD `xml:lang`/`name` default-attribute fix + writer `referenceToDigitalFile` emission. Validate regression test green.
3. [x] **tiangong-lca-cli** `dataset source upload-attachments` — authenticated `external_docs` upload + `referenceToDigitalFile` rewrite. 25 tests, 100% coverage.
4. [x] **foundry** `worldsteel` profile (R3 capped elementary mint + R5 unmatched FP/UG support, full-context policy) + docs; `source-semantics.ts` worldsteel branch; widened `post-authoring-finalize.ts` gate; `worldsteel-batch-import-run.ts` wrapper (deterministic owner-draft World Steel Association contact) + registrations. New tests green.
5. [ ] Implement a dedicated hash-bound library-resolution seed manifest before restoring any identity-preflight skip; unbound synthetic decisions remain disabled.
6. [ ] `.foundry/account-profiles/worldsteel.env` with the exact expected project ref and canonical expected user id for `data@worldsteel.org`; obtain a fresh CLI 0.1.3 intent-bound receipt before the run. Library contact = deterministic same-owner World Steel Association identity at `00.00.001` (packaged id `d5710976` is unavailable). _(needs a live session)_
7. [ ] Publish tidas-tools (≥ the version the CLI bundles) + the CLI, so the foundry run picks up the adapter + upload command. _(release action)_
8. [ ] **Phase 1** convert (`--from-format ilcd`) → gates (0 error, LCIA=0 tolerated, extensions OK, Perc/CAS corrected, source versions preserved).
9. [ ] **Phase 1.5** upload 13 external_docs + rewrite source URIs → signed-URL verify (CLI command, account-wrapped).
10. [ ] **Reuse-by-UUID resolution** (§7): batch-look-up referenced flow UUIDs → `exchange-reference-rewrites.jsonl` (with `canonical_short_description`); author all decisions on conversion-v1 only.
11. [ ] **Phase 2-3** index + decision rounds (identity / ≤17 GaBi semantic+AI tail / classification / location / canonical-support). Then review the actual residual mint count (R3).
12. [ ] **Phase 3-apply** resolution (archive stale decisions out of `$RUN`) → **Phase 4** runner: dry-run → resumable `--commit` loop → post-write readback verify.
13. [ ] **Phase 5** coverage gap 0 → trace workbook → PR per submodule to main (docpact gate) → meta-repo submodule bump.

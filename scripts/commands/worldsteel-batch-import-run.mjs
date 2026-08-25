// worldsteel batch import runner — reuses the proven BAFU per-scope commit engine
// (materialize -> dependency flow commit -> support mint -> process commit ->
// readback verify -> resumable ledgers) with a worldsteel profile config:
//   - profile "worldsteel" so the (capped) account-local override activates only
//     for the <=17 GaBi/Sphera pseudo-elementary flows with no canonical match;
//     the ~1,315 EF3.1 reference flows are reused by their ORIGINAL UUID via the
//     offline library-resolution exchange-reference-rewrites and never minted;
//   - BAFU autofill OFF (worldsteel identity/classification decisions are pre-authored;
//     un-authored action items block instead of being mis-authored by BAFU logic);
//   - BAFU family-signature ordering OFF (worldsteel has no ecoSpold name-family concept);
//   - mintUnmatchedFpUgSupport OFF: worldsteel FP/UG are EF3.1 canonical and reused by
//     reference (the opposite of USLCI, whose FEDEFL FP/UG had no canonical equivalent).
// BAFU behavior is unchanged: the engine's defaults reproduce the BAFU runner exactly,
// and each run re-installs its own profile config (runs are sequential, race-free).
import { createBafuBatchImportRunCommands } from "./bafu-batch-import-run.mjs";

export function createWorldsteelBatchImportRunCommands(deps) {
  const { runDatasetBafuBatchImportRun } = createBafuBatchImportRunCommands(deps, {
    profile: "worldsteel",
    commandName: "dataset-worldsteel-batch-import-run",
    enableBafuAutofill: false,
    enableFamilySignatures: false,
    // First-import of a brand-new library: the worldsteel library contact is not yet
    // remote, so the dependency-flow finalize must commit its source/contact support
    // inline (right after pre-finalize) to satisfy its own reference closure. Once
    // committed, the support-identity cache + precommit remote verify let every later
    // scope reuse it. BAFU does not need this (FOEN already remote).
    commitFlowSupportInline: true,
    // FP/UG are reused-by-reference wherever an EF3.1 canonical exists (the dominant case:
    // Mass, Volume, and the standard indicator FPs all resolve by UUID). BUT the older EU
    // 2019/2020-vintage worldsteel processes carry the EF3.1 LANCA land-use LCIA indicators
    // (Erosion Resistance, Mechanical/Physicochemical Filtration, Biotic Production,
    // Groundwater Replenishment/Regeneration — Occupation & Transformation variants): 10
    // flow properties + 10 unit groups that were never published canonical in TianGong
    // (verified absent under worldsteel, USLCI, and the main 2f478d92 account). Per the
    // 2026-07-01 user decision, these genuinely-missing EF3.1 indicator FP/UG are minted as
    // account-local My Data (state_code=0) so the 4 EU-vintage processes stay complete —
    // the profile's allow_account_local_support_and_elementary.scope already authorizes
    // flowproperty_write + unitgroup_write. Only unmatched FP/UG are minted; every FP/UG with
    // a canonical match is still reused by reference (so the 28 already-verified processes,
    // whose FP/UG are all canonical, are unaffected). USLCI still mints its FEDEFL FP/UG the
    // same way; BAFU keeps this OFF (reference-only), so BAFU is unchanged.
    mintUnmatchedFpUgSupport: true,
    // FIX A: apply the authoritative library-resolution exchange-reference-rewrites
    // deterministically at the flow-identity step. The worldsteel resolution is built
    // by UUID (the canonical DB already holds the EF3.1 flows under their original
    // UUIDs), so every reference flow becomes a canonical reference; only the residual
    // GaBi/Sphera pseudo-elementary flows with no rewrite reach the (capped) mint path.
    // Requires --library-resolution <dir> at runtime holding exchange-reference-rewrites.jsonl.
    applyResolutionRewrites: true,
    // Foreign or RLS-hidden state_code=0 rows are never accepted as reusable references.
    // If the importing account cannot read a dependency, post-write verification keeps its
    // missing_dataset blocker until a public or same-owner visible reference is selected.
    // Requirement 1 (2026-06-29): use the World Steel Association identity (not a generic
    // synthetic foundry contact) as the single shared library contact. The package's own
    // contact id d5710976@20.20.002 turned out to be occupied by a different account in
    // the target database (not published canonical, not visible to data@worldsteel.org)
    // so it can neither be created (HTTP 409 / 23505) nor referenced. Per the 2026-06-30
    // user decision, MINT the contact under a fresh, deterministic foundry-owned UUID that
    // carries the real worldsteel identity (name/address/website/phone), and let the
    // source-contact rewrites repoint every process ownership reference to it. Omitting
    // contactId/contactVersion makes buildLibraryContactPayload derive a stable UUID from
    // the profile + libraryName + website and own it at version 00.00.001 (My Data).
    // Contact identity fields are the REAL worldsteel details (never BAFU/FOEN defaults):
    // organisation category and address come from the package's own contact metadata
    // (classification "Organisations > Other organisations" — a private industry
    // association, NOT governmental), and the email + current HQ address were verified by
    // web research of worldsteel.org (2026-06-30): the package's Rue Colonel Bourg address
    // is outdated; worldsteel now sits at Avenue de Tervueren 270, 1150 Brussels, and the
    // general email is steel@worldsteel.org (there is no info@ address). Phone/fax/website
    // match the package. buildLibraryContactPayload no longer leaks BAFU contact strings
    // for non-bafu profiles.
    libraryContact: {
      libraryName: "World Steel Association",
      shortName: "worldsteel",
      website: "https://www.worldsteel.org",
      email: "steel@worldsteel.org",
      contactClassification: [
        { "@level": "0", "@classId": "2", "#text": "Organisations" },
        { "@level": "1", "@classId": "2.4", "#text": "Other organisations" },
      ],
      contactAddress: "worldsteel, Avenue de Tervueren 270, 1150 Brussels, Belgium",
      telephone: "+32 (0) 2 702 8900",
      centralContactPoint:
        "worldsteel, Avenue de Tervueren 270, 1150 Brussels, Belgium; steel@worldsteel.org; +32 (0) 2 702 8900",
      description:
        "Library-level contact for the worldsteel EF3.1 LCI data package, the World Steel Association (worldsteel) — a non-profit international steel industry association.",
    },
  });
  return { runDatasetWorldsteelBatchImportRun: runDatasetBafuBatchImportRun };
}

// USLCI batch import runner — reuses the proven BAFU per-scope commit engine
// (materialize -> dependency flow commit -> support/My-Data mint -> process commit
// -> readback verify -> resumable ledgers) with a USLCI profile config:
//   - profile "uslci" so the account-local My Data override activates at finalize /
//     commit-handoff (unmatched FEDEFL elementary flows + local FP/UG mint as
//     state_code=0 My Data);
//   - BAFU autofill OFF (USLCI identity/classification decisions are pre-authored;
//     un-authored action items block instead of being mis-authored by BAFU logic);
//   - BAFU family-signature ordering OFF (USLCI has no ecoSpold name-family concept).
// BAFU behavior is unchanged: the engine's defaults reproduce the BAFU runner exactly,
// and each run re-installs its own profile config (runs are sequential, race-free).
import { createBafuBatchImportRunCommands } from "./bafu-batch-import-run.mjs";

export type LibraryBatchImportRunner = (...args: unknown[]) => unknown;
export type LibraryBatchImportCommandSet = {
  runDatasetBafuBatchImportRun: LibraryBatchImportRunner;
};
export type LibraryBatchImportFactory = (
  deps: unknown,
  config: Record<string, unknown>,
) => LibraryBatchImportCommandSet;
export type LibraryBatchImportFactoryOverrides = {
  createBafuBatchImportRunCommands?: LibraryBatchImportFactory;
};

const defaultBatchImportFactory =
  createBafuBatchImportRunCommands as unknown as LibraryBatchImportFactory;

export function createUslciBatchImportRunCommands(
  deps: unknown,
  overrides: LibraryBatchImportFactoryOverrides = {},
): { runDatasetUslciBatchImportRun: LibraryBatchImportRunner } {
  const factory = overrides.createBafuBatchImportRunCommands ?? defaultBatchImportFactory;
  const { runDatasetBafuBatchImportRun } = factory(deps, {
    profile: "uslci",
    commandName: "dataset-uslci-batch-import-run",
    enableBafuAutofill: false,
    enableFamilySignatures: false,
    // First-import of a brand-new library: the shared NREL library contact is not
    // yet remote, so the dependency-flow finalize must commit its source/contact
    // support inline (right after pre-finalize) to satisfy its own reference
    // closure. Once committed, the support-identity cache + precommit remote verify
    // let every later scope reuse it. BAFU does not need this (FOEN already remote).
    commitFlowSupportInline: true,
    // P1a (BAFU-cleanup backlog): mint the scope's unmatched (non-canonical)
    // Unit Groups + Flow Properties as account-local My Data ONCE, committed as
    // support before the flows that reference them. USLCI's unmatched FP/UG are
    // standard openLCA reference FPs (e.g. mass*distance 838aaa20) that use US
    // units absent from the public canonical mappings, so they are minted (not
    // reused-with-scaling) per the user's 2026-06-24 P1c decision. BAFU keeps
    // FP/UG reference-only (this flag stays off there).
    mintUnmatchedFpUgSupport: true,
    // FIX A: apply the authoritative library-resolution exchange-reference-rewrites
    // deterministically at the flow-identity step. Every flow the offline resolution
    // proved reusable becomes a canonical reference; only flows with no rewrite mint.
    // Requires --library-resolution <dir> at runtime to point at the resolution that
    // holds exchange-reference-rewrites.jsonl. BAFU never sets this flag.
    applyResolutionRewrites: true,
    // D2 source attribution: USLCI rows must NOT inherit the BAFU FOEN library
    // contact (nor an openLCA software identity). The materialize stage stamps
    // this NREL / U.S. Federal LCA Commons contact as the shared library contact.
    libraryContact: {
      libraryName: "National Renewable Energy Laboratory (NREL)",
      shortName: "NREL",
      website: "https://www.lcacommons.gov",
      email: "lci@nrel.gov",
      telephone: "+1 303-275-3000",
      contactAddress:
        "National Renewable Energy Laboratory, 15013 Denver West Parkway, Golden, CO 80401, USA",
      centralContactPoint: "U.S. Federal LCA Commons (https://www.lcacommons.gov); lci@nrel.gov",
      description:
        "Library-level contact for the USLCI Database Public package, published by the National Renewable Energy Laboratory (NREL) on the U.S. Federal LCA Commons.",
    },
  });
  return { runDatasetUslciBatchImportRun: runDatasetBafuBatchImportRun };
}

import { asText, fileExists, resolveRepoPath } from "./runtime-io.ts";
import {
  defaultSourceReferenceRewriteFile,
  normalizeSourceReferenceRewriteRow,
  readJsonLines,
} from "./workflow-patch-collect.mjs";
import { referenceKey } from "./workflow-reference-closure.mjs";

export function readSourceReferenceRewriteContext({ repoRoot, rowsFile, options, writeRows }) {
  const configuredFile = resolveRepoPath(
    repoRoot,
    options.sourceReferenceRewrites ??
      options.sourceReferenceRewritesFile ??
      options.sourceReferenceRewriteFile ??
      options.referenceRewrites ??
      options.referenceRewritesFile,
  );
  const sourceFile =
    configuredFile && fileExists(configuredFile)
      ? configuredFile
      : defaultSourceReferenceRewriteFile(rowsFile);
  const sourceRows = sourceFile ? readJsonLines(sourceFile) : [];
  const writeKeys = new Set(writeRows.keys());
  const writeIds = new Set(
    [...writeRows.values()].map(({ identity }) => identity.id).filter(Boolean),
  );
  const scopedRows = sourceRows.map(normalizeSourceReferenceRewriteRow).filter((row) => {
    if (!row.dataset_id) return false;
    const key = `${row.dataset_id}@@${row.dataset_version || "00.00.001"}`;
    return writeKeys.has(key) || writeIds.has(row.dataset_id);
  });
  const byIdentity = new Map();
  for (const row of scopedRows) {
    const key = `${row.dataset_id}@@${row.dataset_version || "00.00.001"}`;
    if (!byIdentity.has(key)) byIdentity.set(key, []);
    byIdentity.get(key).push(row);
  }
  return {
    sourceFile,
    sourceRows,
    scopedRows,
    byIdentity,
  };
}

export const publicCanonicalSourceReferenceKeys = new Set([
  referenceKey({
    table: "sources",
    id: "a97a0155-0234-4b87-b4ce-a45da52f2a40",
    version: "03.00.003",
  }),
  referenceKey({
    table: "sources",
    id: "d92a1a12-2545-49e2-a585-55c259997756",
    version: "20.20.002",
  }),
]);

// FIX C: the source/contact-rewrite stage commits every referenced true source into
// the scope's support set (including review-report sources defensively harvested even
// when their kind did not classify as true_source). Surface those committed sources'
// reference keys so the FIRST process.finalize reference-closure proof passes for them
// once they are in the support commit. This can ONLY prove sources the stage actually
// committed into the support set, so it cannot loosen closure for any other source.
export function sourceContactSupportTrueSourceProofKeys(context) {
  const sourceSupport = context?.artifact?.value?.source_support;
  const keys = new Set();
  if (!sourceSupport) return keys;
  const entries = Array.isArray(sourceSupport.referenced_true_source_keys)
    ? sourceSupport.referenced_true_source_keys
    : [];
  for (const entry of entries) {
    const id = asText(entry?.id);
    if (!id) continue;
    keys.add(
      referenceKey({
        table: "sources",
        id,
        version: asText(entry?.version) || "00.00.001",
      }),
    );
  }
  return keys;
}

// CLASS 1 fix: the source/contact-rewrite stage rewrites a minted (account-local) Flow
// Property's referenceToReferenceUnitGroup to the canonical PUBLISHED version when that
// Unit Group is a public canonical dataset, and never writes the canonical UG. Surface
// that canonical UG id@published-version as a reusable remote reference key so the first
// finalize reference-closure proof passes for the FP->canonical-UG edge without writing
// the UG. The keys come only from UGs the stage proved against the canonical support
// cache, so this cannot prove a UG that is not a published canonical dataset.
export function sourceContactSupportCanonicalUnitGroupProofKeys(context) {
  const canonicalSupport = context?.artifact?.value?.canonical_support;
  const keys = new Set();
  if (!canonicalSupport) return keys;
  const entries = Array.isArray(canonicalSupport.canonical_unit_group_reference_keys)
    ? canonicalSupport.canonical_unit_group_reference_keys
    : [];
  for (const entry of entries) {
    const id = asText(entry?.id);
    const version = asText(entry?.version);
    if (!id || !version) continue;
    keys.add(referenceKey({ table: "unitgroups", id, version }));
  }
  return keys;
}

export function sourceReferenceRewriteProofKeys(context) {
  const scopedCanonicalKeys = new Set(
    (context?.scopedRows ?? [])
      .filter((row) =>
        ["dataset_format_source", "compliance_system_source"].includes(asText(row?.relation)),
      )
      .map((row) => row?.canonical)
      .filter(Boolean)
      .map((canonical) => ({
        table: "sources",
        id: asText(canonical.ref_object_id ?? canonical.refObjectId ?? canonical.id),
        version: asText(canonical.version ?? canonical["@version"]) || "00.00.001",
      }))
      .filter((reference) => reference.id)
      .map(referenceKey),
  );
  return new Set(
    [...scopedCanonicalKeys].filter((key) => publicCanonicalSourceReferenceKeys.has(key)),
  );
}

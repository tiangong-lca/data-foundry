import type { ScopeResumeContract } from "./scope-resume-contract.ts";
import {
  loadMatchingBlockedScopes,
  loadMatchingVerifiedScopes,
  type ScopeResumeLedgerAdapter,
} from "./scope-resume-ledger.ts";

export function loadScopeResumeProjection({
  verifiedFiles,
  blockedFiles,
  contracts,
  adapter,
}: {
  verifiedFiles: readonly string[];
  blockedFiles: readonly string[];
  contracts: ReadonlyMap<string, ScopeResumeContract>;
  adapter: ScopeResumeLedgerAdapter;
}) {
  const verified = loadMatchingVerifiedScopes(verifiedFiles, contracts, adapter);
  const blocked = loadMatchingBlockedScopes(
    blockedFiles,
    contracts,
    verified.verifiedScopes,
    adapter,
  );
  return {
    verifiedScopes: verified.verifiedScopes,
    blockedScopes: blocked.blockedScopes,
    invalidatedRows: [...verified.invalidatedRows, ...blocked.invalidatedRows],
  };
}

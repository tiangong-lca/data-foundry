import fs from "node:fs";
import path from "node:path";

import { createScopeControlRetentionService } from "./scope-control-retention.ts";
import { createSharedContextCachePruner } from "./shared-context-cache-prune.ts";

type JsonRecord = Record<string, unknown>;

export interface ScopeScratchPolicyAdapter {
  booleanOption: (value: unknown) => boolean;
  nowIso: () => string;
  processEnv: NodeJS.ProcessEnv;
  repoRelative: (filePath: string) => string;
  resolveRepoPath: (value: unknown) => string | null;
}

export function createScopeScratchPolicy(adapter: ScopeScratchPolicyAdapter) {
  const retention = createScopeControlRetentionService(adapter);
  const cachePruner = createSharedContextCachePruner(adapter);
  function keepScratchRequested(options: JsonRecord): boolean {
    return (
      adapter.booleanOption(options.keepScratch) ||
      adapter.processEnv.BAFU_KEEP_SCOPE_SCRATCH === "1"
    );
  }

  function trimVerifiedScopeScratch(
    scopeDir: string,
    options: JsonRecord,
    runDir = path.resolve(scopeDir, "..", "..", ".."),
  ) {
    if (!adapter.booleanOption(options.commit) || keepScratchRequested(options)) return;
    if (!fs.existsSync(scopeDir)) return;
    const configuredStore = adapter.resolveRepoPath(options.controlArtifactStoreDir);
    retention.retainAndPrune({
      scopeDir,
      storeDir: configuredStore || path.join(runDir, "control-artifact-store"),
    });
  }

  const configuredCacheMaxEntries = (() => {
    const raw = Number(adapter.processEnv.BAFU_CONTEXT_CACHE_MAX_ENTRIES);
    return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 6000;
  })();

  function enforceSharedContextCacheCap(
    runDir: string,
    options: JsonRecord,
    maxEntries = configuredCacheMaxEntries,
  ): void {
    if (keepScratchRequested(options)) return;
    cachePruner.prune({ runDir, maxEntries });
  }

  return {
    enforceSharedContextCacheCap,
    trimVerifiedScopeScratch,
    verifyControlReceipt: retention.verifyReceipt,
  };
}

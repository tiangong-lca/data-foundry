import fs from "node:fs";
import path from "node:path";

type JsonRecord = Record<string, unknown>;

export interface ScopeScratchPolicyAdapter {
  booleanOption: (value: unknown) => boolean;
  processEnv: NodeJS.ProcessEnv;
}

const VERIFIED_SCOPE_KEEP = new Set(["import-ledger", "scope-run-report.json"]);

export function createScopeScratchPolicy(adapter: ScopeScratchPolicyAdapter) {
  function keepScratchRequested(options: JsonRecord): boolean {
    return (
      adapter.booleanOption(options.keepScratch) ||
      adapter.processEnv.BAFU_KEEP_SCOPE_SCRATCH === "1"
    );
  }

  function trimVerifiedScopeScratch(scopeDir: string, options: JsonRecord): void {
    if (!adapter.booleanOption(options.commit) || keepScratchRequested(options)) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(scopeDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (VERIFIED_SCOPE_KEEP.has(entry.name)) continue;
      try {
        fs.rmSync(path.join(scopeDir, entry.name), { recursive: true, force: true });
      } catch {
        // Verified-scope reclamation is best-effort and never changes ledger authority.
      }
    }
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
    const cacheDir = path.join(runDir, "shared-context-cache");
    let names: string[];
    try {
      names = fs.readdirSync(cacheDir);
    } catch {
      return;
    }
    if (names.length <= maxEntries) return;
    for (const name of names) {
      try {
        fs.rmSync(path.join(cacheDir, name), { recursive: true, force: true });
      } catch {
        // Cache eviction is best-effort; a miss only recomputes immutable context.
      }
    }
  }

  return { enforceSharedContextCacheCap, trimVerifiedScopeScratch };
}

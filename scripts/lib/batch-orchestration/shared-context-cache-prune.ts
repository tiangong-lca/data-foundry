import fs from "node:fs";
import path from "node:path";

import { firstSymlinkOnPath, firstUnsafeScopeEntry, pathIsInside } from "./scope-safe-prune.ts";

export interface SharedContextCachePruneAdapter {
  nowIso: () => string;
  repoRelative: (filePath: string) => string;
  resolveRepoPath: (value: unknown) => string | null;
}

function writeJson(filePath: string, value: unknown): void {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
}

export function createSharedContextCachePruner(adapter: SharedContextCachePruneAdapter) {
  function prune({ runDir, maxEntries }: { runDir: string; maxEntries: number }) {
    const cacheDir = path.join(runDir, "shared-context-cache");
    let names: string[];
    try {
      names = fs.readdirSync(cacheDir).sort();
    } catch {
      return;
    }
    if (names.length <= maxEntries) return;
    const reportPath = path.join(runDir, "shared-context-cache-prune-report.json");
    const repoRoot = adapter.resolveRepoPath(".");
    const unsafe =
      !repoRoot ||
      !pathIsInside(repoRoot, runDir) ||
      firstSymlinkOnPath(repoRoot, runDir) ||
      firstUnsafeScopeEntry(cacheDir);
    if (unsafe) {
      writeJson(reportPath, {
        schema: "tiangong-foundry.shared-context-cache-prune-report.v1",
        generated_at_utc: adapter.nowIso(),
        status: "blocked_unsafe_cache_path",
        cache_dir: adapter.repoRelative(cacheDir),
        automatic_prune_performed: false,
        findings: [{ code: "unsafe_cache_path", path: adapter.repoRelative(String(unsafe)) }],
        counts: { input_entries: names.length, removed_entries: 0, failed_entries: 0 },
      });
      return;
    }
    const removed: string[] = [];
    const failed: string[] = [];
    for (const name of names) {
      try {
        fs.rmSync(path.join(cacheDir, name), { recursive: true, force: true });
        removed.push(name);
      } catch {
        failed.push(name);
      }
    }
    writeJson(reportPath, {
      schema: "tiangong-foundry.shared-context-cache-prune-report.v1",
      generated_at_utc: adapter.nowIso(),
      status: failed.length === 0 ? "completed" : "completed_with_findings",
      cache_dir: adapter.repoRelative(cacheDir),
      disposition: "recomputable_immutable_cache_evicted",
      automatic_prune_performed: true,
      counts: {
        input_entries: names.length,
        removed_entries: removed.length,
        failed_entries: failed.length,
      },
      removed_entries: removed,
      failed_entries: failed,
    });
  }

  return Object.freeze({ prune });
}

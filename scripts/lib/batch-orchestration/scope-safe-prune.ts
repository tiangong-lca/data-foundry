import fs from "node:fs";
import path from "node:path";

export const RETAINED_SCOPE_FILES = new Set([
  "import-ledger",
  "scope-control-receipt.json",
  "scope-prune-report.json",
  "scope-run-report.json",
]);

export interface ScopePruneResult {
  removed_entries: string[];
  removed_bytes: number;
  failed_entries: string[];
}

export function pathIsInside(directory: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(directory), path.resolve(candidate));
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

export function firstUnsafeScopeEntry(scopeDir: string): string | null {
  const root = fs.lstatSync(scopeDir);
  if (!root.isDirectory() || root.isSymbolicLink()) return scopeDir;
  const pending = [scopeDir];
  while (pending.length > 0) {
    const current = pending.pop()!;
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const next = path.join(current, entry.name);
      if (entry.isSymbolicLink()) return next;
      if (entry.isDirectory()) pending.push(next);
    }
  }
  return null;
}

function treeBytes(root: string): number {
  const stat = fs.lstatSync(root);
  if (stat.isSymbolicLink()) throw new Error(`Refusing to size symlinked scratch: ${root}`);
  if (stat.isFile()) return stat.size;
  if (!stat.isDirectory()) return 0;
  return fs.readdirSync(root).reduce((total, name) => total + treeBytes(path.join(root, name)), 0);
}

export function pruneScopeScratch(scopeDir: string): ScopePruneResult {
  const removedEntries: string[] = [];
  const failedEntries: string[] = [];
  let removedBytes = 0;
  for (const entry of fs.readdirSync(scopeDir, { withFileTypes: true })) {
    if (RETAINED_SCOPE_FILES.has(entry.name)) continue;
    const target = path.join(scopeDir, entry.name);
    try {
      removedBytes += treeBytes(target);
      fs.rmSync(target, { recursive: true, force: true });
      removedEntries.push(entry.name);
    } catch {
      failedEntries.push(entry.name);
    }
  }
  return {
    removed_entries: removedEntries.sort(),
    removed_bytes: removedBytes,
    failed_entries: failedEntries.sort(),
  };
}

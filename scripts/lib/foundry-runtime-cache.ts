import fs from "node:fs";
import path from "node:path";
import { FoundryContextError } from "./foundry-runtime-error.ts";

export function foundryPathContains(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return !path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`);
}

export function canonicalFoundryCachePath(selected: string): string {
  let current = path.resolve(selected);
  const tail: string[] = [];
  while (!fs.existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current)
      throw new FoundryContextError(
        "runtime_cache_boundary",
        "Managed cache paths require an accessible filesystem root.",
      );
    tail.unshift(path.basename(current));
    current = parent;
  }
  return path.join(fs.realpathSync(current), ...tail);
}

export function assertFoundryCacheRootSeparated(cache: string, protectedRoot: string): void {
  const selected = canonicalFoundryCachePath(cache);
  const root = canonicalFoundryCachePath(protectedRoot);
  if (foundryPathContains(root, selected) || foundryPathContains(selected, root))
    throw new FoundryContextError(
      "runtime_cache_boundary",
      "Managed components must stay outside workspace, source and package data.",
    );
}

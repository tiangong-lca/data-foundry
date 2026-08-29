import fs from "node:fs";
import path from "node:path";

type JsonRecord = Record<string, unknown>;

export interface ControlReferenceProjectionAdapter {
  repoRelative: (filePath: string) => string;
  resolveRepoPath: (value: unknown) => string | null;
}

export interface ProjectedControlReference {
  role: string;
  roles: string[];
  absolute_path: string;
  original_locator: string;
  inside_scope: boolean;
  exists: boolean;
  required_for_control: boolean;
  reference_kind: "control" | "payload" | "unmanaged";
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function inside(directory: string, candidate: string): boolean {
  const relative = path.relative(directory, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function looksLikeFileLocator(value: string): boolean {
  return (
    !/^[a-z]+:\/\//iu.test(value) &&
    (/[\\/]/u.test(value) || /\.(?:json|jsonl|log|md|txt|ya?ml)$/iu.test(value))
  );
}

function roleKind(role: string, filePath: string): "control" | "payload" {
  const normalized = `${role} ${path.basename(filePath)}`.toLowerCase();
  if (/(?:report|plan|ledger|log|manifest|receipt|checkpoint)/u.test(normalized)) {
    return "control";
  }
  return "payload";
}

function walkLocators(
  value: unknown,
  visit: (role: string, locator: string) => void,
  role = "artifact",
): void {
  if (typeof value === "string") {
    if (looksLikeFileLocator(value)) visit(role, value);
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) walkLocators(entry, visit, role);
    return;
  }
  if (!isRecord(value)) return;
  for (const [key, entry] of Object.entries(value)) walkLocators(entry, visit, key);
}

export function projectScopeControlReferences({
  scopeDir,
  report,
  adapter,
}: {
  scopeDir: string;
  report: JsonRecord;
  adapter: ControlReferenceProjectionAdapter;
}): ProjectedControlReference[] {
  const absoluteScope = path.resolve(scopeDir);
  const rolesByPath = new Map<string, Set<string>>();
  const parsedControlFiles = new Set<string>();
  const pending: JsonRecord[] = [report];
  while (pending.length > 0) {
    const current = pending.shift()!;
    walkLocators(current, (role, locator) => {
      const resolved = adapter.resolveRepoPath(locator);
      if (!resolved) return;
      const absolute = path.resolve(resolved);
      const roles = rolesByPath.get(absolute) ?? new Set<string>();
      roles.add(role);
      rolesByPath.set(absolute, roles);
      if (
        roleKind(role, absolute) === "control" &&
        inside(absoluteScope, absolute) &&
        fs.existsSync(absolute) &&
        !parsedControlFiles.has(absolute) &&
        path.extname(absolute).toLowerCase() === ".json" &&
        fs.statSync(absolute).size <= 10 * 1024 * 1024
      ) {
        parsedControlFiles.add(absolute);
        try {
          const parsed: unknown = JSON.parse(fs.readFileSync(absolute, "utf8"));
          if (isRecord(parsed)) pending.push(parsed);
        } catch {
          // Exact storage still retains malformed control bytes; the caller records verification.
        }
      }
    });
  }
  return [...rolesByPath]
    .map(([absolutePath, roleSet]) => {
      const roles = [...roleSet].sort();
      const insideScope = inside(absoluteScope, absolutePath);
      const kind = insideScope
        ? roles.some((role) => roleKind(role, absolutePath) === "control")
          ? "control"
          : "payload"
        : "unmanaged";
      return {
        role: roles[0] ?? "artifact",
        roles,
        absolute_path: absolutePath,
        original_locator: adapter.repoRelative(absolutePath),
        inside_scope: insideScope,
        exists: fs.existsSync(absolutePath),
        required_for_control: kind === "control",
        reference_kind: kind,
      } satisfies ProjectedControlReference;
    })
    .sort((left, right) => left.original_locator.localeCompare(right.original_locator));
}

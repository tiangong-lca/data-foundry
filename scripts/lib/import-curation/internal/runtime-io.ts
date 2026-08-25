import fs from "node:fs";
import path from "node:path";

export function nowIso(): string {
  return new Date().toISOString();
}

export function ensureArray<T>(value: T | T[] | null | undefined): T[] {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null) return [];
  return [value];
}

export function readText(filePath: string): string {
  return fs.readFileSync(filePath, "utf8");
}

export function writeText(filePath: string, text: string | NodeJS.ArrayBufferView): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, text);
}

// Stream rows to a JSONL file one line at a time. Equivalent output to
// writeText(filePath, jsonLines(rows)), but never materializes the whole file
// as a single JS string — mega-scopes (thousands of large mutation items) can
// exceed V8's max string length (RangeError: Invalid string length) when the
// rows are JSON.stringify-joined in memory.
export function writeJsonLines(filePath: string, rows: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const fd = fs.openSync(filePath, "w");
  try {
    for (const row of ensureArray(rows)) {
      fs.writeSync(fd, `${JSON.stringify(row)}\n`);
    }
  } finally {
    fs.closeSync(fd);
  }
}

export function readJson<T = unknown>(filePath: string): T {
  return JSON.parse(readText(filePath)) as T;
}

export function readJsonIfExists<T = unknown>(filePath: string): T | null {
  return fileExists(filePath) ? readJson<T>(filePath) : null;
}

export function writeJson(filePath: string, data: unknown): void {
  writeText(filePath, `${JSON.stringify(data, null, 2)}\n`);
}

export function fileExists(filePath: fs.PathLike | null | undefined): boolean {
  return Boolean(filePath && fs.existsSync(filePath) && fs.statSync(filePath).isFile());
}

export function directoryExists(filePath: fs.PathLike | null | undefined): boolean {
  return Boolean(filePath && fs.existsSync(filePath) && fs.statSync(filePath).isDirectory());
}

export function resolveRepoPath(
  repoRoot: string,
  filePath: string | null | undefined,
): string | null {
  if (!filePath) return null;
  return path.isAbsolute(filePath) ? filePath : path.join(repoRoot, filePath);
}

export function repoRelativePath(repoRoot: string, filePath: string): string {
  return path.relative(repoRoot, filePath).split(path.sep).join(path.posix.sep);
}

export function normalizedArtifactPath(repoRoot: string, value: unknown): string | null {
  const text = asText(value);
  if (!text) return null;
  return path.resolve(resolveRepoPath(repoRoot, text)!);
}

export function sameArtifactPath(repoRoot: string, left: unknown, right: unknown): boolean {
  const resolvedLeft = normalizedArtifactPath(repoRoot, left);
  const resolvedRight = normalizedArtifactPath(repoRoot, right);
  return Boolean(resolvedLeft && resolvedRight && resolvedLeft === resolvedRight);
}

export function repoRelativeArtifactPath(repoRoot: string, value: unknown): string | null {
  const resolved = normalizedArtifactPath(repoRoot, value);
  return resolved ? repoRelativePath(repoRoot, resolved) : null;
}

export function readJsonOrJsonl(filePath: string): unknown {
  const text = readText(filePath).trim();
  if (!text) return [];
  if (filePath.endsWith(".jsonl")) {
    return text
      .split(/\r?\n/u)
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  }
  return readJson(filePath);
}

export function readRows(filePath: string): unknown[] {
  const parsed = readJsonOrJsonl(filePath);
  if (Array.isArray(parsed)) return parsed;
  const record =
    parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : undefined;
  if (Array.isArray(record?.rows)) return record.rows;
  if (Array.isArray(record?.processes)) return record.processes;
  if (Array.isArray(record?.flows)) return record.flows;
  if (Array.isArray(record?.lifecyclemodels)) return record.lifecyclemodels;
  return [parsed];
}

export function optionList(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap((item) => optionList(item));
  if (value === undefined || value === null || value === "") return [];
  return String(value)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function jsonLines(rows: unknown[]): string {
  return rows.map((row) => JSON.stringify(row)).join("\n") + (rows.length ? "\n" : "");
}

export function unique<T>(values: T | T[] | null | undefined): T[] {
  return [...new Set(ensureArray(values).filter(Boolean))];
}

export function sanitizeFileName(value: unknown): string {
  return (
    String(value ?? "missing")
      .replace(/[^A-Za-z0-9._-]+/gu, "_")
      .replace(/^_+|_+$/gu, "") || "missing"
  );
}

export function asText(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return "";
}

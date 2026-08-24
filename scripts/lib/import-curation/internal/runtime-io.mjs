import fs from "node:fs";
import path from "node:path";

export function nowIso() {
  return new Date().toISOString();
}

export function ensureArray(value) {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null) return [];
  return [value];
}

export function readText(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

export function writeText(filePath, text) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, text);
}

// Stream rows to a JSONL file one line at a time. Equivalent output to
// writeText(filePath, jsonLines(rows)), but never materializes the whole file
// as a single JS string — mega-scopes (thousands of large mutation items) can
// exceed V8's max string length (RangeError: Invalid string length) when the
// rows are JSON.stringify-joined in memory.
export function writeJsonLines(filePath, rows) {
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

export function readJson(filePath) {
  return JSON.parse(readText(filePath));
}

export function readJsonIfExists(filePath) {
  return fileExists(filePath) ? readJson(filePath) : null;
}

export function writeJson(filePath, data) {
  writeText(filePath, `${JSON.stringify(data, null, 2)}\n`);
}

export function fileExists(filePath) {
  return Boolean(filePath && fs.existsSync(filePath) && fs.statSync(filePath).isFile());
}

export function directoryExists(filePath) {
  return Boolean(filePath && fs.existsSync(filePath) && fs.statSync(filePath).isDirectory());
}

export function resolveRepoPath(repoRoot, filePath) {
  if (!filePath) return null;
  return path.isAbsolute(filePath) ? filePath : path.join(repoRoot, filePath);
}

export function repoRelativePath(repoRoot, filePath) {
  return path.relative(repoRoot, filePath).split(path.sep).join(path.posix.sep);
}

export function normalizedArtifactPath(repoRoot, value) {
  const text = asText(value);
  if (!text) return null;
  return path.resolve(resolveRepoPath(repoRoot, text));
}

export function sameArtifactPath(repoRoot, left, right) {
  const resolvedLeft = normalizedArtifactPath(repoRoot, left);
  const resolvedRight = normalizedArtifactPath(repoRoot, right);
  return Boolean(resolvedLeft && resolvedRight && resolvedLeft === resolvedRight);
}

export function repoRelativeArtifactPath(repoRoot, value) {
  const resolved = normalizedArtifactPath(repoRoot, value);
  return resolved ? repoRelativePath(repoRoot, resolved) : null;
}

export function readJsonOrJsonl(filePath) {
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

export function readRows(filePath) {
  const parsed = readJsonOrJsonl(filePath);
  if (Array.isArray(parsed)) return parsed;
  if (Array.isArray(parsed?.rows)) return parsed.rows;
  if (Array.isArray(parsed?.processes)) return parsed.processes;
  if (Array.isArray(parsed?.flows)) return parsed.flows;
  if (Array.isArray(parsed?.lifecyclemodels)) return parsed.lifecyclemodels;
  return [parsed];
}

export function optionList(value) {
  if (Array.isArray(value)) return value.flatMap((item) => optionList(item));
  if (value === undefined || value === null || value === "") return [];
  return String(value)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function jsonLines(rows) {
  return rows.map((row) => JSON.stringify(row)).join("\n") + (rows.length ? "\n" : "");
}

export function unique(values) {
  return [...new Set(ensureArray(values).filter(Boolean))];
}

export function sanitizeFileName(value) {
  return (
    String(value ?? "missing")
      .replace(/[^A-Za-z0-9._-]+/gu, "_")
      .replace(/^_+|_+$/gu, "") || "missing"
  );
}

export function asText(value) {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return "";
}

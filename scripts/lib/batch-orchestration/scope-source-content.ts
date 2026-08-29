import fs from "node:fs";
import path from "node:path";

import {
  sha256BatchBytes,
  sha256BatchJson,
  type BatchJsonObject,
  type BatchJsonValue,
} from "@tiangong-lca/cli/batch";

type JsonRecord = Record<string, unknown>;

export interface BafuScopeSourceContentInput {
  scope: JsonRecord;
  processBundlesDir: string;
  sharedFiles: readonly string[];
  resolutionRewriteRows: readonly JsonRecord[];
  repoRelative: (filePath: string) => string;
}

function filesBelow(directory: string): string[] {
  if (!fs.existsSync(directory) || !fs.statSync(directory).isDirectory()) return [];
  const pending = [directory];
  const files: string[] = [];
  while (pending.length > 0) {
    const current = pending.pop()!;
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const next = path.join(current, entry.name);
      if (entry.isDirectory()) pending.push(next);
      else if (entry.isFile()) files.push(next);
    }
  }
  return files.sort();
}

function fileFact(filePath: string, name: string): BatchJsonObject {
  const bytes = fs.readFileSync(filePath);
  return { name, bytes: bytes.byteLength, sha256: sha256BatchBytes(bytes) };
}

function bundleFact(directory: string): BatchJsonObject | null {
  const files = filesBelow(directory).map((filePath) =>
    fileFact(filePath, path.relative(directory, filePath).split(path.sep).join("/")),
  );
  return files.length === 0
    ? null
    : {
        file_count: files.length,
        bytes: files.reduce((sum, row) => sum + Number(row.bytes), 0),
        sha256: sha256BatchJson(files),
        files,
      };
}

export function createBafuScopeSourceContent({
  scope,
  processBundlesDir,
  sharedFiles,
  resolutionRewriteRows,
  repoRelative,
}: BafuScopeSourceContentInput): BatchJsonValue {
  const processId = String(scope.process_id ?? scope.id ?? "").trim();
  const shared = [...new Set(sharedFiles)]
    .filter((filePath) => fs.existsSync(filePath) && fs.statSync(filePath).isFile())
    .sort()
    .map((filePath) => fileFact(filePath, repoRelative(filePath)));
  return {
    process_bundle: bundleFact(path.join(processBundlesDir, processId)),
    shared_files_sha256: sha256BatchJson(shared),
    resolution_rewrites_sha256: sha256BatchJson(
      JSON.parse(JSON.stringify(resolutionRewriteRows)) as BatchJsonValue,
    ),
  };
}

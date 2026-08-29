type JsonRecord = Record<string, unknown>;

interface ProcessHandoffPlanAdapter {
  resolveRepoPath: (value: unknown) => string | null;
  fileExists: (filePath: string | null | undefined) => boolean;
  readJson: (filePath: string) => JsonRecord;
}

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : {};
}

export function readHandoffPlan(
  finalizeReport: JsonRecord,
  key: string,
  adapter: ProcessHandoffPlanAdapter,
): { path: string | null; value: JsonRecord | null } {
  const handoffPath = adapter.resolveRepoPath(record(finalizeReport.files)[key]);
  if (!handoffPath || !adapter.fileExists(handoffPath)) return { path: null, value: null };
  return { path: handoffPath, value: adapter.readJson(handoffPath) };
}

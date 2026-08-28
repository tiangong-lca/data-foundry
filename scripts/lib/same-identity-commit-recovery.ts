export interface SameIdentityCommitFailureSummary {
  accepted: boolean;
  alreadyExists: number;
  otherFailures: number;
}

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : {};
}

function values(value: unknown): unknown[] {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function text(value: unknown): string {
  return typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
}

function reportFailureEntries(report: JsonRecord): { entries: unknown[]; missingDetails: number } {
  const rowFailures = values(report.rows)
    .map(record)
    .filter((row) => text(row.status).toLowerCase() === "failed")
    .map((row) => row.error);
  const entries = rowFailures.length > 0 ? rowFailures : values(report.failures);
  const declaredFailed = Number(record(report.counts).failed ?? 0);
  return {
    entries,
    missingDetails:
      Number.isSafeInteger(declaredFailed) && declaredFailed > entries.length
        ? declaredFailed - entries.length
        : 0,
  };
}

export function summarizeSameIdentityCommitFailures(
  reports: readonly JsonRecord[],
): SameIdentityCommitFailureSummary {
  let alreadyExists = 0;
  let otherFailures = 0;
  for (const report of reports) {
    const { entries, missingDetails } = reportFailureEntries(report);
    otherFailures += missingDetails;
    for (const value of entries) {
      const failure = record(value);
      const code = text(failure.code ?? failure.status_code).toLowerCase();
      const message = `${text(failure.message)} ${text(failure.details)}`
        .toLowerCase()
        .replace(/\s+/gu, " ")
        .trim();
      if (code === "23505" && message.includes("same id and version already exists")) {
        alreadyExists += 1;
      } else {
        otherFailures += 1;
      }
    }
  }
  return {
    accepted: alreadyExists > 0 && otherFailures === 0,
    alreadyExists,
    otherFailures,
  };
}

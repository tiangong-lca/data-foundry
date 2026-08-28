import path from "node:path";

type JsonRecord = Record<string, unknown>;

export interface ScopeRecoveryEvidenceAdapter {
  resolveRepoPath: (value: unknown) => string | null;
  fileExists: (filePath: string | null | undefined) => boolean;
  readJson: (filePath: string) => JsonRecord;
  readJsonLines: (filePath: string | null | undefined) => JsonRecord[];
  findFiles: (rootDir: unknown, predicate: (filePath: string) => boolean) => string[];
  uniqueExistingPaths: (paths: unknown[]) => string[];
  repoRelative: (filePath: string | null | undefined) => string;
}

function jsonRecord(value: unknown): JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function recordArray(value: unknown): JsonRecord[] {
  return Array.isArray(value) ? value.map(jsonRecord) : [];
}

export function createScopeRecoveryEvidenceService(adapter: ScopeRecoveryEvidenceAdapter) {
  function reportFile(stageJson: JsonRecord | null, fallback: string): string | null {
    const value = jsonRecord(stageJson?.files).report ?? stageJson?.report;
    return adapter.resolveRepoPath(value) || fallback;
  }

  function outputRowsByStem(report: JsonRecord | null, stem: string): string | null {
    const files = jsonRecord(report?.files);
    const rows = Array.isArray(files.output_rows)
      ? files.output_rows
      : [files.output_rows].filter(Boolean);
    return adapter.resolveRepoPath(
      rows.find((entry) => path.basename(String(entry)).startsWith(stem)) ?? rows[0],
    );
  }

  function identityApplyReportHasReferenceRewrites(reportPath: string): boolean {
    if (!adapter.fileExists(reportPath)) return false;
    const report = adapter.readJson(reportPath);
    const rewritesFile = adapter.resolveRepoPath(
      jsonRecord(report.files).identity_reference_rewrites,
    );
    return adapter.readJsonLines(rewritesFile).length > 0;
  }

  function existingIdentityApplyReportsWithReferenceRewrites(
    scopeDir: string,
    label: string,
  ): string[] {
    const candidates = [
      path.join(scopeDir, `${label}-identity-apply`, "identity-decisions-apply-report.json"),
      ...adapter.findFiles(
        scopeDir,
        (filePath) => path.basename(filePath) === "identity-decisions-apply-report.json",
      ),
    ];
    return adapter.uniqueExistingPaths(candidates).filter(identityApplyReportHasReferenceRewrites);
  }

  function categoryForBlocker(code: unknown): string {
    const text = String(code || "");
    if (/classification|location|identity|authoring|patch|curation/u.test(text)) {
      return "human-review";
    }
    if (/reference|closure|support/u.test(text)) return "reference-closure";
    if (/commit|verify|remote|timeout|network/u.test(text)) return "remote-write";
    return "other";
  }

  function firstBlocker(
    report: JsonRecord | null,
    fallbackCode: string,
    fallbackMessage: string,
  ): JsonRecord {
    return (
      recordArray(report?.blockers)[0] ?? {
        code: fallbackCode,
        message: fallbackMessage,
      }
    );
  }

  function statusIs(report: JsonRecord | null, values: string[]): boolean {
    return values.includes(String(report?.status || ""));
  }

  function preFinalizeRecoveryBlocker({
    type,
    finalizeReport,
    recovery,
  }: {
    type: string;
    finalizeReport: JsonRecord;
    recovery: JsonRecord | null;
  }): JsonRecord | null {
    if (finalizeReport.status === "ready_for_remote_write") return null;
    if (
      recovery?.identityApplyReport ||
      recovery?.patchCollectReport ||
      recovery?.patchApplyReport
    ) {
      return null;
    }
    return firstBlocker(
      finalizeReport,
      `${type}_pre_finalize_not_ready`,
      `${type} pre-finalize status is ${finalizeReport.status || "missing"} and no automatic authoring evidence was produced.`,
    );
  }

  function identityUnresolvedReferenceBlocker({
    type,
    report,
  }: {
    type: string;
    report: JsonRecord;
  }): JsonRecord | null {
    const files = jsonRecord(report.files);
    const counts = jsonRecord(report.counts);
    const unresolvedRowsFile = adapter.resolveRepoPath(
      files.identity_unresolved_references || files.unresolved_reference_rows,
    );
    const unresolvedRows = adapter.readJsonLines(unresolvedRowsFile);
    const unresolvedCount =
      unresolvedRows.length ||
      Number(counts.identity_unresolved_references ?? counts.unresolved_reference_rows ?? 0);
    if (!unresolvedCount) return null;
    return {
      code: `${type}_identity_unresolved_references`,
      message: `${type} identity decisions still leave ${unresolvedCount} unresolved reference row(s).`,
      unresolved_reference_rows: adapter.repoRelative(unresolvedRowsFile),
    };
  }

  return {
    categoryForBlocker,
    existingIdentityApplyReportsWithReferenceRewrites,
    firstBlocker,
    identityUnresolvedReferenceBlocker,
    outputRowsByStem,
    preFinalizeRecoveryBlocker,
    reportFile,
    statusIs,
  };
}

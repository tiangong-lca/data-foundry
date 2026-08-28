import path from "node:path";

import {
  evaluateElementaryIdentityDecision as evaluateElementaryIdentityDecisionPure,
  openLcaCompartmentClassification,
  traceCompartment,
  type ElementaryIdentityEvaluationInput,
  type SourceClassification,
} from "./elementary-identity.ts";
import type { EntityRow, JsonRecord, ScopeProjection } from "./entity-projection.ts";
import {
  identityPreflightArtifactPaths,
  projectLibraryElementaryIdentityDecisions,
  type IdentityPreflightProjectionEntry,
} from "./identity-preflight-projection.ts";

interface LibraryIdentityPreflightRunnerDependencies {
  asText: (value: unknown) => string;
  ensureArray: <T>(value: T | readonly T[] | null | undefined) => T[];
  fileExists: (filePath: string | null | undefined) => boolean;
  nowIso: () => string;
  readJson: (filePath: string) => JsonRecord;
  readJsonLines: (filePath: string) => JsonRecord[];
  repoRelativeMaybe: (filePath: string | null | undefined) => string | null;
  repoRelativePath: (filePath: string) => string;
  resolveRepoPath: (filePath: unknown) => string | null;
  writeJson: (filePath: string, value: unknown) => void;
  writeJsonLines: (filePath: string, rows: readonly unknown[]) => void;
}

export interface LibraryIdentityPreflightRunInput {
  indexDir: string;
  preflightIndexPath: string;
  outDir: string;
}

function isJsonRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function jsonRecord(value: unknown): JsonRecord {
  return isJsonRecord(value) ? value : {};
}

function normalizedText(value: unknown): string {
  return String(value ?? "")
    .trim()
    .replace(/\s+/gu, " ")
    .toLowerCase();
}

export function createLibraryIdentityPreflightRunner({
  asText,
  ensureArray,
  fileExists,
  nowIso,
  readJson,
  readJsonLines,
  repoRelativeMaybe,
  repoRelativePath,
  resolveRepoPath,
  writeJson,
  writeJsonLines,
}: LibraryIdentityPreflightRunnerDependencies) {
  const sourceClassificationCache = new Map<string, SourceClassification | null>();

  function entitySourceClassification(entity: EntityRow): SourceClassification | null {
    // The BAFU→TIDAS conversion writes a uniform default elementaryFlowCategorization
    // ("Emissions to air, unspecified") on every elementary flow, but preserves the real
    // ecoinvent compartment in tidasimport:sourceTrace.payload.sourceClassification.
    const sourceFile = asText(entity.source_file) || asText(ensureArray(entity.source_files)[0]);
    if (!sourceFile) return null;
    if (sourceClassificationCache.has(sourceFile)) {
      return sourceClassificationCache.get(sourceFile) ?? null;
    }
    let result: SourceClassification | null = null;
    const resolved = resolveRepoPath(sourceFile);
    if (resolved && fileExists(resolved)) {
      try {
        const payload = readJson(resolved);
        const dataSetInformation = jsonRecord(
          jsonRecord(jsonRecord(payload.flowDataSet).flowInformation).dataSetInformation,
        );
        const sourceTrace = jsonRecord(
          jsonRecord(dataSetInformation["common:other"])["tidasimport:sourceTrace"],
        );
        const tracePayload = jsonRecord(sourceTrace.payload);
        const trace = jsonRecord(tracePayload.sourceClassification);
        if (Object.keys(trace).length > 0) {
          const category = normalizedText(trace.category || trace.localCategory);
          const subCategory = normalizedText(trace.subCategory || trace.localSubCategory);
          if (category) result = { category, subCategory };
        }
        // openLCA JSON-LD lane: the converter writes the same uniform "air, unspecified"
        // default as the BAFU lane and preserves the real FEDEFL compartment only in the
        // entity trace ("Elementary flows/emission/air/troposphere/rural"). Recover it.
        if (!result && normalizedText(tracePayload.format) === "openlca-jsonld") {
          const tracedEntity = jsonRecord(jsonRecord(tracePayload.payload).entity);
          result = openLcaCompartmentClassification(tracedEntity.category);
        }
      } catch {
        result = null;
      }
    }
    sourceClassificationCache.set(sourceFile, result);
    return result;
  }

  function evaluateElementaryIdentityDecision(input: ElementaryIdentityEvaluationInput) {
    return evaluateElementaryIdentityDecisionPure({
      ...input,
      sourceClassification: entitySourceClassification(input.entity),
    });
  }

  function run({
    indexDir,
    preflightIndexPath,
    outDir,
  }: LibraryIdentityPreflightRunInput): JsonRecord {
    const entityIndexPath = path.join(indexDir, "library-entity-index.jsonl");
    const scopeProjectionPath = path.join(indexDir, "scope-projection.jsonl");
    const entityRows = readJsonLines(entityIndexPath) as EntityRow[];
    const projectionRows = readJsonLines(scopeProjectionPath) as ScopeProjection[];
    const preflightRows = readJsonLines(preflightIndexPath);
    const preflights: IdentityPreflightProjectionEntry[] = preflightRows.map((row) => {
      const { reportPath, candidatesPath } = identityPreflightArtifactPaths(row, resolveRepoPath);
      let report: JsonRecord | null = null;
      if (reportPath && fileExists(reportPath)) {
        try {
          report = readJson(reportPath);
        } catch {
          report = null;
        }
      }
      return { row, report, reportPath, candidatesPath };
    });
    const { elementaryRows, decisions, manualReviewRows, reasonCounts } =
      projectLibraryElementaryIdentityDecisions({
        entityRows,
        projectionRows,
        preflights,
        sourceClassificationForEntity: entitySourceClassification,
        repoRelativeMaybe,
      });

    const decisionPath = path.join(outDir, "identity-decisions.jsonl");
    const manualReviewPath = path.join(outDir, "identity-decisions.manual-review.jsonl");
    const reportPath = path.join(
      outDir,
      "dataset-library-identity-decisions-from-preflight-report.json",
    );
    writeJsonLines(decisionPath, decisions);
    writeJsonLines(manualReviewPath, manualReviewRows);
    const report = {
      schema_version: 1,
      generated_at_utc: nowIso(),
      status: manualReviewRows.length > 0 ? "completed_with_manual_review" : "completed",
      command: "dataset-library-identity-decisions-from-preflight",
      library_index: repoRelativePath(indexDir),
      identity_preflight_index: repoRelativePath(preflightIndexPath),
      counts: {
        elementary_flows: elementaryRows.length,
        reuse_existing_reference: decisions.length,
        manual_review: manualReviewRows.length,
        preflight_rows: preflightRows.length,
      },
      reason_counts: reasonCounts,
      files: {
        report: repoRelativePath(reportPath),
        identity_decisions: repoRelativePath(decisionPath),
        manual_review: repoRelativePath(manualReviewPath),
      },
      policy: {
        elementary_flows_reference_only: true,
        create_new_for_elementary_flows: "forbidden",
        automatic_reuse_requires_physical_equivalence: true,
      },
      blockers: manualReviewRows.slice(0, 25).map((row) => ({
        code: row.reason,
        dataset_id: row.source_dataset_id,
        dataset_version: row.source_dataset_version,
        message:
          "Elementary flow identity requires human review before dependent process scopes can write.",
      })),
    };
    writeJson(reportPath, report);
    return report;
  }

  return {
    run,
    evaluateElementaryIdentityDecision,
    entitySourceClassification,
    traceCompartment,
    openLcaCompartmentClassification,
  };
}

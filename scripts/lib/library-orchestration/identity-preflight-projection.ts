import path from "node:path";
import {
  evaluateElementaryIdentityDecision,
  type SourceClassification,
  type UsageStats,
} from "./elementary-identity.ts";
import type {
  EntityRow,
  JsonRecord,
  ProcessExchangeReference,
  ScopeProjection,
} from "./entity-projection.ts";

interface MutableUsageStats extends Omit<UsageStats, "process_ids"> {
  process_ids: Set<string>;
}

export interface IdentityPreflightProjectionEntry {
  row: JsonRecord;
  report: JsonRecord | null;
  reportPath: string | null;
  candidatesPath: string | null;
}

export interface IdentityPreflightProjectionInput {
  entityRows: EntityRow[];
  projectionRows: ScopeProjection[];
  preflights: IdentityPreflightProjectionEntry[];
  sourceClassificationForEntity: (entity: EntityRow) => SourceClassification | null;
  repoRelativeMaybe: (filePath: string | null | undefined) => string | null;
}

export interface IdentityPreflightProjection {
  elementaryRows: EntityRow[];
  decisions: JsonRecord[];
  manualReviewRows: JsonRecord[];
  reasonCounts: Record<string, number>;
}

export interface IdentityPreflightArtifactPaths {
  reportPath: string | null;
  candidatesPath: string | null;
}

type ResolveRepoPath = (filePath: unknown) => string | null;

function isJsonRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function jsonRecord(value: unknown): JsonRecord {
  return isJsonRecord(value) ? value : {};
}

function ensureArray<T>(value: T | readonly T[] | null | undefined): T[] {
  if (Array.isArray(value)) return [...value] as T[];
  return value == null ? [] : [value as T];
}

function asText(value: unknown): string {
  return value == null ? "" : String(value).trim();
}

function normalizedText(value: unknown): string {
  return String(value ?? "")
    .trim()
    .replace(/\s+/gu, " ")
    .toLowerCase();
}

export function identityPreflightArtifactPaths(
  row: JsonRecord,
  resolveRepoPath: ResolveRepoPath,
): IdentityPreflightArtifactPaths {
  const explicitReport =
    row.expected_report_file ||
    row.identity_decision_file ||
    row.identityDecisionFile ||
    row.report_file ||
    row.reportFile;
  let reportPath: string | null;
  if (explicitReport) {
    reportPath = resolveRepoPath(explicitReport);
  } else {
    const resolvedOutputDir = resolveRepoPath(row.output_dir || row.outputDir);
    reportPath = resolvedOutputDir
      ? path.join(resolvedOutputDir, "outputs", "identity-decision.json")
      : null;
  }

  const explicitCandidates =
    row.expected_candidates_file || row.candidates_file || row.candidatesFile;
  let candidatesPath: string | null;
  if (explicitCandidates) {
    candidatesPath = resolveRepoPath(explicitCandidates);
  } else {
    const resolvedOutputDir = resolveRepoPath(row.output_dir || row.outputDir);
    candidatesPath = resolvedOutputDir
      ? path.join(resolvedOutputDir, "outputs", "identity-candidates.jsonl")
      : null;
  }

  return { reportPath, candidatesPath };
}

export function identityPreflightKey(row: JsonRecord): string {
  return [
    asText(row.dataset_type || row.type || "flow"),
    asText(row.dataset_id || row.source_dataset_id || row.entity_id || row.id),
    asText(row.dataset_version || row.source_dataset_version || row.version) || "00.00.001",
  ].join(":");
}

function targetUsageStats(projectionRows: ScopeProjection[]): Map<string, UsageStats> {
  const byFlow = new Map<string, MutableUsageStats>();
  for (const scope of projectionRows) {
    for (const ref of scope.usage_refs.process_exchange_flow_refs as ProcessExchangeReference[]) {
      const key = `flow:${ref.flow_id}:${ref.flow_version || "00.00.001"}`;
      const stats = byFlow.get(key) ?? {
        input: 0,
        output: 0,
        other: 0,
        process_ids: new Set<string>(),
      };
      const direction = normalizedText(ref.direction);
      if (direction === "input") stats.input += 1;
      else if (direction === "output") stats.output += 1;
      else stats.other += 1;
      if (scope.process_id) stats.process_ids.add(scope.process_id);
      byFlow.set(key, stats);
    }
  }
  return new Map<string, UsageStats>(
    [...byFlow.entries()].map(([key, value]) => [
      key,
      { ...value, process_ids: [...value.process_ids].sort() },
    ]),
  );
}

function candidateShortDescription(candidate: JsonRecord): unknown {
  return ensureArray(candidate.names).find(Boolean) || candidate.id || "";
}

function increment(map: Map<string, number>, key: unknown, count = 1): void {
  const normalizedKey = asText(key) || "unknown";
  map.set(normalizedKey, (map.get(normalizedKey) ?? 0) + count);
}

function sortedCountObject(map: Map<string, number>): Record<string, number> {
  return Object.fromEntries(
    [...map.entries()].sort(([left], [right]) => left.localeCompare(right)),
  );
}

export function projectLibraryElementaryIdentityDecisions({
  entityRows,
  projectionRows,
  preflights,
  sourceClassificationForEntity,
  repoRelativeMaybe,
}: IdentityPreflightProjectionInput): IdentityPreflightProjection {
  const usedEntityKeys = new Set(
    projectionRows.flatMap((scope) => scope.dependency_ids.flows.map((dep) => dep.entity_key)),
  );
  const usageByFlow = targetUsageStats(projectionRows);
  const preflightByKey = new Map(
    preflights.map((preflight) => [identityPreflightKey(preflight.row), preflight]),
  );
  const elementaryRows = entityRows.filter(
    (row) =>
      row.dataset_type === "flow" &&
      /^elementary flow$/iu.test(row.flow_type ?? "") &&
      usedEntityKeys.has(row.entity_key),
  );

  const decisions: JsonRecord[] = [];
  const manualReviewRows: JsonRecord[] = [];
  const reasonCounts = new Map<string, number>();
  for (const entity of elementaryRows) {
    const key = `flow:${entity.dataset_id}:${entity.dataset_version || "00.00.001"}`;
    const preflight = preflightByKey.get(key);
    const evaluation = evaluateElementaryIdentityDecision({
      entity,
      report: preflight?.report ?? null,
      usage: usageByFlow.get(key),
      sourceClassification: sourceClassificationForEntity(entity),
    });
    increment(reasonCounts, evaluation.reason);
    if (evaluation.decision === "reuse_existing_reference") {
      const candidate = jsonRecord(evaluation.candidate);
      decisions.push({
        schema_version: 1,
        dataset_type: "flow",
        source_dataset_id: entity.dataset_id,
        source_dataset_version: entity.dataset_version || "00.00.001",
        dataset_id: entity.dataset_id,
        dataset_version: entity.dataset_version || "00.00.001",
        source_entity_key: entity.entity_key,
        decision: "reuse_existing_reference",
        identity_decision: "reuse_existing_reference",
        decision_status: "completed",
        canonical_flow_id: candidate?.id,
        canonical_flow_version: candidate?.version || "00.00.001",
        canonical_short_description: candidateShortDescription(candidate),
        canonical: {
          table: "flows",
          ref_object_id: candidate?.id,
          version: candidate?.version || "00.00.001",
          short_description: candidateShortDescription(candidate),
        },
        basis:
          "Selected from identity-preflight candidates because exactly one existing elementary flow passed physical-equivalence guardrails.",
        confidence:
          Number(jsonRecord(evaluation.evidence.selected_candidate).score) >= 95
            ? "high"
            : "medium",
        used_context_kinds: ["library_index", "scope_projection", "identity_preflight"],
        closes_action_items: ["elementary_flow_identity_manual_review"],
        physical_equivalence_evidence: evaluation.reason,
        evidence: {
          ...evaluation.evidence,
          identity_preflight_report: repoRelativeMaybe(preflight?.reportPath),
          identity_preflight_candidates: repoRelativeMaybe(preflight?.candidatesPath),
        },
      });
    } else {
      manualReviewRows.push({
        schema_version: 1,
        dataset_type: "flow",
        source_dataset_id: entity.dataset_id,
        source_dataset_version: entity.dataset_version || "00.00.001",
        dataset_id: entity.dataset_id,
        dataset_version: entity.dataset_version || "00.00.001",
        source_entity_key: entity.entity_key,
        source_name: entity.name,
        decision: "block_unresolved",
        identity_decision: "block_unresolved",
        decision_status: "blocked_manual_review",
        reason: evaluation.reason,
        required_human_action:
          "Review identity-preflight candidates and provide reuse_existing_reference only when physical equivalence is proven; otherwise keep dependent process scopes deferred.",
        evidence: {
          ...evaluation.evidence,
          identity_preflight_report: repoRelativeMaybe(preflight?.reportPath),
          identity_preflight_candidates: repoRelativeMaybe(preflight?.candidatesPath),
        },
      });
    }
  }

  return {
    elementaryRows,
    decisions,
    manualReviewRows,
    reasonCounts: sortedCountObject(reasonCounts),
  };
}

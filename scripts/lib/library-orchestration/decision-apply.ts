import { canonicalDescriptionPair } from "../canonical-description.ts";
import type { EntityMaps, JsonRecord, ScopeProjection } from "./entity-projection.ts";

export interface CanonicalTarget extends JsonRecord {
  id: string;
  version: string;
  uri: string;
  short_description: string;
  type: string;
}

export interface DecisionIndexes {
  identityByKey: Map<string, JsonRecord>;
  classificationByKey: Map<string, JsonRecord>;
  supportByKey: Map<string, JsonRecord>;
}

export interface PayloadRewriteResult {
  payload: JsonRecord;
  changed: boolean;
  rewrite_rows: JsonRecord[];
}

export interface ScopeRewriteResult extends JsonRecord {
  rewritten_process_file: string | null;
  rewrite_rows: JsonRecord[];
}

export interface DecisionApplicationProjection {
  checkpoints: JsonRecord[];
  blockedLedger: JsonRecord[];
  readyScopes: JsonRecord[];
  rewriteRows: JsonRecord[];
}

export interface DecisionRowsInput {
  identityRows: JsonRecord[];
  classificationRows: JsonRecord[];
  supportRows: JsonRecord[];
}

export interface RewriteProcessExchangeReferencesInput {
  scope: ScopeProjection;
  payload: JsonRecord;
  identityByKey: Map<string, JsonRecord>;
  maps: EntityMaps;
}

export interface ProjectDecisionApplicationInput {
  scopeRows: ScopeProjection[];
  maps: EntityMaps;
  indexes: DecisionIndexes;
  allowAccountLocalSupportAndElementary: boolean;
  rewriteScope: (
    scope: ScopeProjection,
    identityByKey: Map<string, JsonRecord>,
  ) => ScopeRewriteResult;
}

export interface BlockedScopeReportInput {
  command: string;
  blockedRows: JsonRecord[];
  blockedLedgerPath: string;
  reportPath: string;
}

export interface LibraryResolutionInput {
  indexDir: string;
  decisionsDir: string | null;
  resolutionPath: string;
  checkpointPath: string;
  blockedPath: string;
  blockedReportPath: string;
  readyPath: string;
  rewritePath: string;
  projection: DecisionApplicationProjection;
  decisionCounts: {
    identity_decisions: number;
    classification_decisions: number;
    canonical_support_mappings: number;
  };
}

export interface LibraryDecisionApplyDependencies {
  asText: (value: unknown) => string;
  cloneJson: <T>(value: T) => T;
  ensureArray: <T>(value: T | readonly T[] | null | undefined) => T[];
  jsonSha256: (value: unknown) => string;
  nowIso: () => string;
  repoRelativeMaybe: (filePath: string | null | undefined) => string | null;
  repoRelativePath: (filePath: string) => string;
  rootEntityForRef: (
    maps: EntityMaps,
    type: string,
    id: string,
    version?: string,
  ) => JsonRecord | null;
  textValue: (value: unknown) => string;
}

interface ReasonAccumulator {
  reason: string;
  blocked_ledger_rows: number;
  blocked_scope_ids: Set<string>;
  blocking_dependency_types: Map<string, number>;
  messages: Set<string>;
  required_human_actions: Set<string>;
  sample_blocking_dependencies: JsonRecord[];
}

interface ScopeAccumulator {
  process_id: string;
  process_version: string;
  blocker_count: number;
  reasons: Map<string, number>;
  sample_blocking_dependencies: JsonRecord[];
  rerun_commands: Set<string>;
}

export interface LibraryDecisionApply {
  decisionIndexes: (input: DecisionRowsInput) => DecisionIndexes;
  rewriteProcessExchangeReferences: (
    input: RewriteProcessExchangeReferencesInput,
  ) => PayloadRewriteResult;
  projectDecisionApplication: (
    input: ProjectDecisionApplicationInput,
  ) => DecisionApplicationProjection;
  blockRow: (
    scope: JsonRecord,
    dependency: unknown,
    code: string,
    message: string,
    requiredHumanAction: string,
  ) => JsonRecord;
  buildBlockedScopeReport: (input: BlockedScopeReportInput) => JsonRecord;
  buildLibraryResolution: (input: LibraryResolutionInput) => JsonRecord;
}

function isJsonRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function jsonRecord(value: unknown): JsonRecord {
  return isJsonRecord(value) ? value : {};
}

export function createLibraryDecisionApply({
  asText,
  cloneJson,
  ensureArray,
  jsonSha256,
  nowIso,
  repoRelativeMaybe,
  repoRelativePath,
  rootEntityForRef,
  textValue,
}: LibraryDecisionApplyDependencies): LibraryDecisionApply {
  function identityDecisionKey(row: JsonRecord): string {
    return [
      "flow",
      asText(row.source_dataset_id || row.dataset_id || row.source_flow_id || row.id),
      asText(row.source_dataset_version || row.dataset_version || row.version) || "00.00.001",
    ].join(":");
  }

  function classificationDecisionDatasetType(row: JsonRecord): string {
    const explicitType = asText(row.dataset_type || row.type);
    if (explicitType) return explicitType;
    const categoryType = asText(row.category_type || row.schema_type);
    if (categoryType === "process") return "process";
    if (categoryType === "flow-product" || categoryType === "flow-elementary") return "flow";
    return categoryType;
  }

  function classificationDecisionKey(row: JsonRecord): string {
    return [
      classificationDecisionDatasetType(row),
      asText(row.dataset_id || row.id),
      asText(row.dataset_version || row.version) || "00.00.001",
    ].join(":");
  }

  function supportDecisionKey(row: JsonRecord): string {
    return [
      asText(row.support_type || row.dataset_type || row.type),
      asText(row.source_support_id || row.dataset_id || row.id),
      asText(row.source_support_version || row.dataset_version || row.version) || "00.00.001",
    ].join(":");
  }

  function canonicalTarget(row: JsonRecord | null | undefined, type: string): CanonicalTarget {
    const source = row ?? {};
    const target = jsonRecord(source.canonical_target || source.target);
    return {
      id: asText(
        source.canonical_flow_id ||
          source.canonical_support_id ||
          source.canonical_id ||
          source.target_dataset_id ||
          target.id,
      ),
      version:
        asText(
          source.canonical_flow_version ||
            source.canonical_support_version ||
            source.canonical_version ||
            source.target_dataset_version ||
            target.version,
        ) || "00.00.001",
      uri: asText(source.canonical_uri || target.uri),
      short_description: textValue(
        source.canonical_short_description || source.short_description || target.short_description,
      ),
      type,
    };
  }

  function classificationDecisionCode(row: JsonRecord | null | undefined): string {
    const source = row ?? {};
    return asText(
      source.selected_code || source.code || source.leaf_code || source.class_id || source.cat_id,
    );
  }

  function decisionIsCompleteClassification(
    row: JsonRecord | null | undefined,
    { datasetType = null }: { datasetType?: string | null } = {},
  ): boolean {
    const code = classificationDecisionCode(row);
    if (!code) return false;
    const categoryType = asText(row?.category_type ?? row?.categoryType);
    if (datasetType === "process" || categoryType === "process") {
      const level = asText(row?.classification_decision_level ?? row?.classificationDecisionLevel);
      if (level === "broad_section") return false;
      if (/^[A-Z]$/u.test(code) || /^\d{1,3}$/u.test(code)) return false;
    }
    if (categoryType === "flow-product") {
      const level = asText(row?.classification_decision_level ?? row?.classificationDecisionLevel);
      if (level === "broad_section") return false;
      if (/^\d{1,3}$/u.test(code)) return false;
    }
    return true;
  }

  function exchangePreservationHash(exchange: JsonRecord): string {
    const clone = cloneJson(exchange);
    delete clone.referenceToFlowDataSet;
    return jsonSha256(clone);
  }

  function decisionIndexes({
    identityRows,
    classificationRows,
    supportRows,
  }: DecisionRowsInput): DecisionIndexes {
    return {
      identityByKey: new Map(identityRows.map((row) => [identityDecisionKey(row), row])),
      classificationByKey: new Map(
        classificationRows.map((row) => [classificationDecisionKey(row), row]),
      ),
      supportByKey: new Map(supportRows.map((row) => [supportDecisionKey(row), row])),
    };
  }

  function rewriteProcessExchangeReferences({
    scope,
    payload,
    identityByKey,
    maps,
  }: RewriteProcessExchangeReferencesInput): PayloadRewriteResult {
    const exchanges = ensureArray(
      jsonRecord(jsonRecord(payload.processDataSet).exchanges).exchange,
    ).map(jsonRecord);
    const rewriteRows: JsonRecord[] = [];
    exchanges.forEach((exchange, index) => {
      const ref = jsonRecord(exchange.referenceToFlowDataSet);
      const flowId = asText(ref["@refObjectId"]);
      const flowVersion = asText(ref["@version"]) || "00.00.001";
      const rootFlow = rootEntityForRef(maps, "flow", flowId, flowVersion);
      if (!rootFlow) return;
      const decision = identityByKey.get(`flow:${flowId}:${flowVersion}`);
      if (asText(decision?.decision) !== "reuse_existing_reference") return;
      if (!decision) return;
      const target = canonicalTarget(decision, "flow data set");
      if (!target.id) return;
      const descriptions = canonicalDescriptionPair(decision.canonical_short_description, asText);
      const beforePreservationHash = exchangePreservationHash(exchange);
      const previousReference = cloneJson(ref);
      exchange.referenceToFlowDataSet = {
        "@type": previousReference["@type"] || "flow data set",
        "@refObjectId": target.id,
        "@version": target.version,
        "@uri": target.uri || `../flows/${target.id}.json`,
        "common:shortDescription":
          descriptions.reference ||
          previousReference["common:shortDescription"] ||
          target.short_description ||
          undefined,
      };
      const afterPreservationHash = exchangePreservationHash(exchange);
      rewriteRows.push({
        schema_version: 1,
        process_id: scope.process_id,
        process_version: scope.process_version,
        exchange_index: index,
        source_flow_id: flowId,
        source_flow_version: flowVersion,
        canonical_flow_id: target.id,
        canonical_flow_version: target.version,
        // Downstream deterministic identity apply consumes this display name when present.
        canonical_short_description: descriptions.ledger || target.short_description || null,
        changed_path: "referenceToFlowDataSet",
        preserved_exchange_fields: beforePreservationHash === afterPreservationHash,
        before_preservation_hash: beforePreservationHash,
        after_preservation_hash: afterPreservationHash,
      });
    });
    return { payload, changed: rewriteRows.length > 0, rewrite_rows: rewriteRows };
  }

  function blockRow(
    scope: JsonRecord,
    dependency: unknown,
    code: string,
    message: string,
    requiredHumanAction: string,
  ): JsonRecord {
    return {
      schema_version: 1,
      blocked_process_id: scope.process_id,
      blocked_process_version: scope.process_version,
      blocking_dependency: dependency,
      reason: code,
      message,
      required_human_action: requiredHumanAction,
      rerun_command:
        "node scripts/foundry.ts dataset-library-decisions-apply --library-index <library-index> --decisions-dir <decisions-dir> --out-dir <library-resolution>",
    };
  }

  function projectDecisionApplication({
    scopeRows,
    maps,
    indexes,
    allowAccountLocalSupportAndElementary,
    rewriteScope,
  }: ProjectDecisionApplicationInput): DecisionApplicationProjection {
    const checkpoints: JsonRecord[] = [];
    const blockedLedger: JsonRecord[] = [];
    const readyScopes: JsonRecord[] = [];
    const rewriteRows: JsonRecord[] = [];
    for (const scope of scopeRows) {
      const blockers: JsonRecord[] = [];
      const processClassification = indexes.classificationByKey.get(
        `process:${scope.process_id}:${scope.process_version || "00.00.001"}`,
      );
      if (!decisionIsCompleteClassification(processClassification, { datasetType: "process" })) {
        blockers.push(
          blockRow(
            scope,
            { dataset_type: "process", id: scope.process_id, version: scope.process_version },
            processClassification
              ? "process_classification_requires_leaf_authoring"
              : "process_classification_requires_authoring",
            processClassification
              ? "Process classification decision is only a broad section; BAFU import requires a full-context leaf classification before this scope can write."
              : "Process classification must be authored from full process meaning before this scope can write.",
            "Run semantic classification authoring and provide leaf classification-decisions.jsonl.",
          ),
        );
      }

      for (const dep of scope.dependency_ids.flows) {
        const entity = maps.byKey.get(asText(dep.entity_key));
        if (entity && /^elementary flow$/iu.test(entity.flow_type ?? "")) {
          const decision = indexes.identityByKey.get(
            `flow:${dep.id}:${dep.version || "00.00.001"}`,
          );
          const target = canonicalTarget(decision, "flow data set");
          if (
            !allowAccountLocalSupportAndElementary &&
            (asText(decision?.decision) !== "reuse_existing_reference" || !target.id)
          ) {
            blockers.push(
              blockRow(
                scope,
                { dataset_type: "flow", id: dep.id, version: dep.version },
                decision
                  ? "elementary_flow_reference_unresolved"
                  : "elementary_flow_requires_existing_database_match",
                "Elementary flow is reference-only for BAFU and must reuse an existing canonical TianGong flow when physically equivalent.",
                "Provide identity-decisions.jsonl with reuse_existing_reference and physical-equivalence evidence, or leave this scope deferred for human review.",
              ),
            );
          }
        } else {
          const classification = indexes.classificationByKey.get(
            `flow:${dep.id}:${dep.version || "00.00.001"}`,
          );
          if (!decisionIsCompleteClassification(classification)) {
            blockers.push(
              blockRow(
                scope,
                { dataset_type: "flow", id: dep.id, version: dep.version },
                "flow_classification_requires_authoring",
                "Product flow classification must be authored from full flow meaning before this scope can write.",
                "Run semantic classification authoring and provide classification-decisions.jsonl.",
              ),
            );
          }
        }
      }
      for (const dep of scope.dependency_ids.flowproperties) {
        const mapping = indexes.supportByKey.get(
          `flowproperty:${dep.id}:${dep.version || "00.00.001"}`,
        );
        const target = canonicalTarget(mapping, "flow property data set");
        if (!target.id && !allowAccountLocalSupportAndElementary) {
          blockers.push(
            blockRow(
              scope,
              { dataset_type: "flowproperty", id: dep.id, version: dep.version },
              "canonical_flow_property_reference_unresolved",
              "Generated Flow Property support is reference-only and must map to public canonical support before this scope can write.",
              "Add canonical-support-mappings.jsonl with physical-dimension evidence or manually add canonical support to the database and rerun.",
            ),
          );
        }
      }
      for (const dep of scope.dependency_ids.unitgroups) {
        const mapping = indexes.supportByKey.get(
          `unitgroup:${dep.id}:${dep.version || "00.00.001"}`,
        );
        const target = canonicalTarget(mapping, "unit group data set");
        if (!target.id && !allowAccountLocalSupportAndElementary) {
          blockers.push(
            blockRow(
              scope,
              { dataset_type: "unitgroup", id: dep.id, version: dep.version },
              "canonical_unit_group_reference_unresolved",
              "Generated Unit Group support is reference-only and must map to public canonical support before this scope can write.",
              "Add canonical-support-mappings.jsonl with unit evidence or manually add canonical support to the database and rerun.",
            ),
          );
        }
      }
      const rewrite = rewriteScope(scope, indexes.identityByKey);
      rewriteRows.push(...rewrite.rewrite_rows);
      const state = blockers.length > 0 ? "blocked_deferred" : "ready";
      const checkpoint = {
        schema_version: 1,
        process_id: scope.process_id,
        process_version: scope.process_version,
        state,
        blocker_count: blockers.length,
        bundle_dir: scope.bundle_dir,
        rewritten_process_file: rewrite.rewritten_process_file,
        dependency_counts: {
          flows: scope.dependency_ids.flows.length,
          flowproperties: scope.dependency_ids.flowproperties.length,
          unitgroups: scope.dependency_ids.unitgroups.length,
        },
      };
      checkpoints.push(checkpoint);
      if (blockers.length > 0) blockedLedger.push(...blockers);
      else readyScopes.push({ ...scope, closure_status: "ready", checkpoint });
    }
    return { checkpoints, blockedLedger, readyScopes, rewriteRows };
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

  function compactBlockingDependency(row: JsonRecord): JsonRecord {
    const dependency = jsonRecord(row.blocking_dependency);
    return {
      dataset_type: asText(dependency.dataset_type || dependency.type) || "unknown",
      id: asText(dependency.id || dependency.dataset_id),
      version: asText(dependency.version || dependency.dataset_version) || "00.00.001",
      reason: asText(row.reason) || "unknown",
      message: asText(row.message),
      required_human_action: asText(row.required_human_action),
    };
  }

  function blockerScopeKey(row: JsonRecord): string {
    return [
      asText(row.blocked_process_id || row.process_id),
      asText(row.blocked_process_version || row.process_version) || "00.00.001",
    ].join(":");
  }

  function buildBlockedScopeReport({
    command,
    blockedRows,
    blockedLedgerPath,
    reportPath,
  }: BlockedScopeReportInput): JsonRecord {
    const sampleLimit = 20;
    const reasonMap = new Map<string, ReasonAccumulator>();
    const scopeMap = new Map<string, ScopeAccumulator>();
    const dependencyTypeCounts = new Map<string, number>();
    for (const row of blockedRows) {
      const reason = asText(row.reason) || "unknown";
      const dependency = compactBlockingDependency(row);
      increment(dependencyTypeCounts, dependency.dataset_type);
      if (!reasonMap.has(reason)) {
        reasonMap.set(reason, {
          reason,
          blocked_ledger_rows: 0,
          blocked_scope_ids: new Set(),
          blocking_dependency_types: new Map(),
          messages: new Set(),
          required_human_actions: new Set(),
          sample_blocking_dependencies: [],
        });
      }
      const reasonEntry = reasonMap.get(reason)!;
      reasonEntry.blocked_ledger_rows += 1;
      reasonEntry.blocked_scope_ids.add(asText(row.blocked_process_id));
      increment(reasonEntry.blocking_dependency_types, dependency.dataset_type);
      if (row.message) reasonEntry.messages.add(asText(row.message));
      if (row.required_human_action) {
        reasonEntry.required_human_actions.add(asText(row.required_human_action));
      }
      if (reasonEntry.sample_blocking_dependencies.length < sampleLimit) {
        reasonEntry.sample_blocking_dependencies.push({
          process_id: asText(row.blocked_process_id),
          process_version: asText(row.blocked_process_version) || "00.00.001",
          ...dependency,
        });
      }

      const scopeKey = blockerScopeKey(row);
      if (!scopeMap.has(scopeKey)) {
        scopeMap.set(scopeKey, {
          process_id: asText(row.blocked_process_id),
          process_version: asText(row.blocked_process_version) || "00.00.001",
          blocker_count: 0,
          reasons: new Map(),
          sample_blocking_dependencies: [],
          rerun_commands: new Set(),
        });
      }
      const scopeEntry = scopeMap.get(scopeKey)!;
      scopeEntry.blocker_count += 1;
      increment(scopeEntry.reasons, reason);
      if (row.rerun_command) scopeEntry.rerun_commands.add(asText(row.rerun_command));
      if (scopeEntry.sample_blocking_dependencies.length < sampleLimit) {
        scopeEntry.sample_blocking_dependencies.push(dependency);
      }
    }

    const reasonSummary = [...reasonMap.values()]
      .sort((left, right) => left.reason.localeCompare(right.reason))
      .map((entry) => ({
        reason: entry.reason,
        blocked_ledger_rows: entry.blocked_ledger_rows,
        blocked_scope_count: entry.blocked_scope_ids.size,
        blocking_dependency_types: sortedCountObject(entry.blocking_dependency_types),
        messages: [...entry.messages].sort(),
        required_human_actions: [...entry.required_human_actions].sort(),
        sample_blocking_dependencies: entry.sample_blocking_dependencies,
      }));
    const scopeSummary = [...scopeMap.values()]
      .sort((left, right) => left.process_id.localeCompare(right.process_id))
      .map((entry) => ({
        process_id: entry.process_id,
        process_version: entry.process_version,
        blocker_count: entry.blocker_count,
        reasons: sortedCountObject(entry.reasons),
        sample_blocking_dependencies: entry.sample_blocking_dependencies,
        sample_limit: sampleLimit,
        full_details_file: repoRelativePath(blockedLedgerPath),
        rerun_commands: [...entry.rerun_commands].sort(),
      }));
    return {
      schema_version: 1,
      generated_at_utc: nowIso(),
      status: blockedRows.length > 0 ? "blocked_scopes_present" : "no_blocked_scopes",
      command,
      counts: {
        blocked_ledger_rows: blockedRows.length,
        blocked_scopes: scopeMap.size,
        blocker_reasons: reasonMap.size,
        blocking_dependency_types: sortedCountObject(dependencyTypeCounts),
      },
      reason_summary: reasonSummary,
      scope_summary: scopeSummary,
      files: {
        blocked_scope_report: repoRelativePath(reportPath),
        blocked_scope_ledger: repoRelativePath(blockedLedgerPath),
      },
      ledger_semantics:
        "blocked-scope-ledger.jsonl is the complete row-level blocker source of truth; this report is the per-run reader-facing summary.",
    };
  }

  function buildLibraryResolution({
    indexDir,
    decisionsDir,
    resolutionPath,
    checkpointPath,
    blockedPath,
    blockedReportPath,
    readyPath,
    rewritePath,
    projection,
    decisionCounts,
  }: LibraryResolutionInput): JsonRecord {
    return {
      schema_version: 1,
      generated_at_utc: nowIso(),
      status: projection.blockedLedger.length > 0 ? "completed_with_deferred_scopes" : "completed",
      command: "dataset-library-decisions-apply",
      library_index: repoRelativePath(indexDir),
      decisions_dir: repoRelativeMaybe(decisionsDir),
      counts: {
        process_scopes: projection.checkpoints.length,
        ready_scopes: projection.readyScopes.length,
        blocked_scopes: projection.checkpoints.filter((row) => row.state === "blocked_deferred")
          .length,
        blocked_scope_ledger_rows: projection.blockedLedger.length,
        ...decisionCounts,
        exchange_reference_rewrites: projection.rewriteRows.length,
      },
      ready_scope_ids: projection.readyScopes.map((scope) => scope.process_id),
      blocked_scope_ids: projection.checkpoints
        .filter((row) => row.state === "blocked_deferred")
        .map((row) => row.process_id),
      files: {
        library_resolution: repoRelativePath(resolutionPath),
        scope_checkpoints: repoRelativePath(checkpointPath),
        blocked_scope_ledger: repoRelativePath(blockedPath),
        blocked_scope_report: repoRelativePath(blockedReportPath),
        ready_scopes: repoRelativePath(readyPath),
        exchange_reference_rewrites: repoRelativePath(rewritePath),
      },
      policy: {
        process_scope_atomic_write: true,
        ready_scopes_do_not_wait_for_blocked_scopes: true,
        elementary_flows_reference_only: true,
        flowproperty_unitgroup_reference_only: true,
      },
      blockers: [],
    };
  }

  return {
    decisionIndexes,
    rewriteProcessExchangeReferences,
    projectDecisionApplication,
    blockRow,
    buildBlockedScopeReport,
    buildLibraryResolution,
  };
}

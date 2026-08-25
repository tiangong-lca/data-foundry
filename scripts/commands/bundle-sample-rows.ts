import fs from "node:fs";
import path from "node:path";
import { bundleRowTypeOrder, bundleRowTypes, type BundleRowType } from "../lib/bundle-row-types.ts";
import { readOnlyStageContract } from "../lib/stage-contract.ts";

interface LooseRecord {
  [key: string]: unknown;
  processDataSet?: LooseRecord;
  processInformation?: LooseRecord;
  flowDataSet?: LooseRecord;
  flowInformation?: LooseRecord;
  contactDataSet?: LooseRecord;
  contactInformation?: LooseRecord;
  dataSetInformation?: LooseRecord;
  name?: LooseRecord;
  mixAndLocationTypes?: unknown;
  geography?: LooseRecord;
  locationOfOperationSupplyOrProduction?: LooseRecord;
  exchanges?: LooseRecord;
  referenceToFlowDataSet?: LooseRecord;
  files?: LooseRecord;
  inputs?: LooseRecord;
  commands?: LooseRecord;
  batch_patch_contract?: LooseRecord;
  payload?: LooseRecord;
  "common:name"?: LooseRecord;
  "common:other"?: LooseRecord;
}

interface BundleSelection {
  seed: unknown;
  selected: string[];
  missing_process_ids: string[];
  [key: string]: unknown;
}

interface DatasetIdentity {
  id: string;
  version: string;
}

interface LocationCandidate {
  code: string;
  [key: string]: unknown;
}

interface ProcessFlowEvidence {
  flow_id: string;
  flow_version: string;
  process_id: string;
  process_version: string;
  process_source_file: string | null;
  process_location: string | null;
  exchange_location: string | null;
}

interface SemanticSummary {
  dataset_id: string;
  kind: string;
  materialized_as_source_row?: boolean;
  [key: string]: unknown;
}

interface SourceReferenceRow {
  relation: string;
  referenced_source_kind: string;
  ref_object_id: string;
  short_description: unknown;
  [key: string]: unknown;
}

interface IdentityPreflightArtifacts {
  rows: unknown[];
  indexPath: string;
  [key: string]: unknown;
}

interface CanonicalSupportCache {
  cachePath: string | null;
  [key: string]: unknown;
}

interface SelectedBundle {
  process_id: string;
  bundle_dir: string | null;
  manifest: string | null;
}

interface BundleSampleDependencies {
  addDedupedBundleRow: (options: Record<string, unknown>) => void;
  asText: (value: unknown) => string;
  attachIdentityPreflightRows: (
    rows: LooseRecord[],
    artifacts: IdentityPreflightArtifacts,
  ) => unknown;
  booleanOption: (value: unknown) => boolean;
  profileFor: (repoRoot: string, profile: string, options: LooseRecord) => LooseRecord;
  repoRoot: string;
  buildBafuFallbackSourcePayload: (options: Record<string, unknown>) => LooseRecord;
  buildDatabaseFallbackSourcePayload: (options: Record<string, unknown>) => LooseRecord;
  buildBafuProcessContextSourcePayload: (options: Record<string, unknown>) => LooseRecord | null;
  buildIdentityPreflightArtifacts: (options: Record<string, unknown>) => IdentityPreflightArtifacts;
  buildLibraryContactPayload: (
    options: LooseRecord,
    template: unknown,
    context: Record<string, unknown>,
  ) => LooseRecord;
  classificationAuthoringCommands: (options: Record<string, unknown>) => LooseRecord;
  cloneJson: (value: LooseRecord) => LooseRecord;
  collectBundleQualityFindings: (options: Record<string, unknown>) => void;
  collectElementaryFlowReuseFindings: (options: Record<string, unknown>) => void;
  collectLocationQualityFindings: (options: Record<string, unknown>) => void;
  collectSourceTracePayloads: (payload: LooseRecord) => LooseRecord[];
  contactGlobalReference: (options: Record<string, unknown>) => LooseRecord;
  datasetIdentity: (payload: LooseRecord, type: string) => DatasetIdentity;
  ensureArray: (value: unknown) => LooseRecord[];
  fileExists: (filePath: string | null | undefined) => boolean;
  findFirstBundleContactTemplate: (bundleDirs: string[]) => unknown;
  listProcessBundleDirs: (bundlesDir: unknown) => string[];
  loadCanonicalSupportCache: (options: LooseRecord) => CanonicalSupportCache;
  loadTidasLocationCodeMap: () => Map<string, unknown>;
  locationAuthoringCommands: (options: Record<string, unknown>) => LooseRecord;
  nowIso: () => string;
  processOriginalSourceMetadata: (payload: LooseRecord) => LooseRecord | null;
  processSourceReferenceRows: (
    payload: LooseRecord,
    sourceLookup: Map<string, SemanticSummary>,
    sourceFile: unknown,
  ) => SourceReferenceRow[];
  readJson: (filePath: string) => LooseRecord;
  repairTrueSourceClassification: (payload: LooseRecord, options: Record<string, unknown>) => void;
  repairTrueSourceDescription: (payload: LooseRecord, options: Record<string, unknown>) => void;
  repairTrueSourceIdentity: (payload: LooseRecord, options: Record<string, unknown>) => void;
  repoRelativeMaybe: (filePath: unknown) => string | null;
  repoRelativePath: (filePath: string) => string;
  resolveRepoPath: (filePath: unknown) => string;
  resolveTiangongLcaCliCommandPrefix?: () => string[];
  resolveTiangongLcaCliBin: () => string;
  rewriteCanonicalFlowPropertyReferences: (
    payload: LooseRecord,
    options: Record<string, unknown>,
  ) => void;
  rewriteCanonicalSourceReferences: (
    payload: LooseRecord,
    options: Record<string, unknown>,
  ) => void;
  rewriteProcessDataSourceReferences: (
    payload: LooseRecord,
    options: Record<string, unknown>,
  ) => void;
  rewriteContactReferences: (
    payload: LooseRecord,
    reference: LooseRecord,
    stats: Record<string, unknown>,
  ) => void;
  rewriteTrueSourceReferenceDescriptions: (options: Record<string, unknown>) => void;
  sanitizeBundlePayload: (
    payload: LooseRecord,
    type: BundleRowType,
    sourceFile: string,
    stats: Record<string, number>,
    traceRows: LooseRecord[],
    sourceTraces: LooseRecord[],
  ) => void;
  selectProcessBundleDirs: (bundleDirs: string[], options: LooseRecord) => BundleSelection;
  shellQuote: (value: unknown) => string;
  sourceReferenceSemanticBlockers: (rows: SourceReferenceRow[]) => LooseRecord[];
  sourceSummaryMatchesOriginalMetadata: (
    summary: SemanticSummary | undefined,
    metadata: LooseRecord,
  ) => boolean;
  sourceSemanticSummary: (payload: LooseRecord, sourceFile: unknown) => SemanticSummary;
  textValue: (value: unknown) => string;
  writeJson: (filePath: string, value: unknown) => void;
  writeJsonLines: (filePath: string, rows: readonly unknown[]) => void;
}

const bundleSampleStageContract = readOnlyStageContract([
  {
    stage: "select_bundles",
    phase: "prepare",
    purpose: "Resolve requested process ids or deterministic sample selection.",
    inputs: ["process-bundles directory", "process id or sample options"],
    outputs: ["selected bundle manifest list"],
    side_effects: [],
  },
  {
    stage: "materialize_rows",
    phase: "rewrite_cleanup",
    purpose: "Read selected bundle dependencies and materialize source-language JSONL rows.",
    inputs: ["selected manifests", "bundle TIDAS payload files"],
    outputs: ["rows/*.jsonl", "support.jsonl"],
    side_effects: ["writes local .foundry artifact files"],
  },
  {
    stage: "deterministic_rewrites",
    phase: "rewrite_cleanup",
    purpose:
      "Apply library contact, canonical source, canonical support, trace, source semantics, and placeholder repairs before write planning.",
    inputs: ["materialized row payloads", "canonical support cache"],
    outputs: [
      "source-reference-rewrites.jsonl",
      "canonical-support-rewrites.jsonl",
      "canonical-support-amount-scaling.jsonl when scale conversion is required",
      "source-semantics.jsonl",
      "flow location context traces embedded in flow rows",
    ],
    side_effects: ["writes local .foundry artifact files"],
  },
  {
    stage: "authoring_queues",
    phase: "gate_validate",
    purpose:
      "Produce classification, location, identity-preflight, and elementary-flow reuse queues for unresolved policy work.",
    inputs: ["rewritten rows", "TIDAS classification/location schemas"],
    outputs: [
      "classification-authoring-queue.jsonl",
      "location-authoring-queue.jsonl",
      "identity-preflight-requests.jsonl",
      "elementary-flow-reuse-queue.jsonl",
    ],
    side_effects: ["writes local .foundry artifact files"],
  },
  {
    stage: "report",
    phase: "report",
    purpose:
      "Emit a command report with row files, generated handoff commands, counts, and blockers.",
    inputs: ["all generated local artifacts"],
    outputs: ["dataset-bundle-sample-rows-report.json", "process-scope-ledger.jsonl"],
    side_effects: ["writes local .foundry artifact files"],
  },
]);

export function createBundleSampleRowsCommands({
  addDedupedBundleRow,
  asText,
  attachIdentityPreflightRows,
  booleanOption,
  profileFor,
  repoRoot,
  buildDatabaseFallbackSourcePayload,
  buildBafuProcessContextSourcePayload,
  buildIdentityPreflightArtifacts,
  buildLibraryContactPayload,
  classificationAuthoringCommands,
  cloneJson,
  collectBundleQualityFindings,
  collectElementaryFlowReuseFindings,
  collectLocationQualityFindings,
  collectSourceTracePayloads,
  contactGlobalReference,
  datasetIdentity,
  ensureArray,
  fileExists,
  findFirstBundleContactTemplate,
  listProcessBundleDirs,
  loadCanonicalSupportCache,
  loadTidasLocationCodeMap,
  locationAuthoringCommands,
  nowIso,
  processOriginalSourceMetadata,
  processSourceReferenceRows,
  readJson,
  repairTrueSourceClassification,
  repairTrueSourceDescription,
  repairTrueSourceIdentity,
  repoRelativeMaybe,
  repoRelativePath,
  resolveRepoPath,
  resolveTiangongLcaCliCommandPrefix,
  resolveTiangongLcaCliBin,
  rewriteCanonicalFlowPropertyReferences,
  rewriteCanonicalSourceReferences,
  rewriteProcessDataSourceReferences,
  rewriteContactReferences,
  sanitizeBundlePayload,
  selectProcessBundleDirs,
  shellQuote,
  sourceReferenceSemanticBlockers,
  sourceSummaryMatchesOriginalMetadata,
  sourceSemanticSummary,
  textValue,
  writeJson,
  writeJsonLines,
}: BundleSampleDependencies) {
  function locationCodeFromValue(value: unknown, locationCodeMap: Map<string, unknown>) {
    const code = asText(value);
    return code && locationCodeMap.has(code) ? code : null;
  }

  function processLocationCode(payload: LooseRecord, locationCodeMap: Map<string, unknown>) {
    return locationCodeFromValue(
      payload?.processDataSet?.processInformation?.geography
        ?.locationOfOperationSupplyOrProduction?.["@location"],
      locationCodeMap,
    );
  }

  function exchangeLocationCode(exchange: LooseRecord, locationCodeMap: Map<string, unknown>) {
    return locationCodeFromValue(
      exchange?.location ?? exchange?.["@location"] ?? exchange?.locationOfSupply,
      locationCodeMap,
    );
  }

  function flowLocationOfSupply(payload: LooseRecord): string {
    return asText(payload?.flowDataSet?.flowInformation?.geography?.locationOfSupply);
  }

  function flowNameMixAndLocationTypes(payload: LooseRecord): string {
    return textValue(
      payload?.flowDataSet?.flowInformation?.dataSetInformation?.name?.mixAndLocationTypes,
    );
  }

  function locationCodeCandidatesFromText(
    value: unknown,
    locationCodeMap: Map<string, unknown>,
  ): LocationCandidate[] {
    const text = asText(value);
    if (!text) return [];
    const candidates: LocationCandidate[] = [];
    const normalized = text.replace(/[{}]/gu, "").trim();
    if (locationCodeMap.has(normalized)) {
      candidates.push({
        code: normalized,
        source_kind: "exact_text",
        source_value: text,
      });
    }
    for (const match of text.matchAll(/\{([A-Z0-9][A-Z0-9+&-]*)\}/gu)) {
      const code = match[1];
      if (locationCodeMap.has(code)) {
        candidates.push({
          code,
          source_kind: "braced_code",
          source_value: text,
        });
      }
    }
    return candidates;
  }

  function uniqueLocationCandidates(candidates: LocationCandidate[]): LocationCandidate[] {
    const byKey = new Map<string, LocationCandidate>();
    for (const candidate of candidates) {
      if (!candidate?.code || byKey.has(candidate.code)) continue;
      byKey.set(candidate.code, candidate);
    }
    return [...byKey.values()];
  }

  function buildFlowLocationQueueRow({
    flowPayload,
    flowKey,
    sourceFile,
    candidates,
    locationCommands,
    reason,
  }: {
    flowPayload: LooseRecord;
    flowKey: string;
    sourceFile: string | null;
    candidates: LocationCandidate[];
    locationCommands: LooseRecord;
    reason: string;
  }) {
    const identity = datasetIdentity(flowPayload, "flow");
    const uniqueCandidates = uniqueLocationCandidates(candidates);
    return {
      dataset_type: "flow",
      dataset_id: identity.id,
      dataset_version: identity.version,
      source_file: repoRelativeMaybe(sourceFile),
      code: "flow_location_of_supply_requires_authoring",
      path: "flowDataSet.flowInformation.geography.locationOfSupply",
      current_location: null,
      suggested_location_code: uniqueCandidates.length === 1 ? uniqueCandidates[0].code : null,
      evidence: {
        source: "bafu_packaged_bundle_location_projection",
        reason,
        flow_key: flowKey,
        candidates: uniqueCandidates,
      },
      location_workflow: {
        schema_type: "location",
        commands: locationCommands,
        decision_contract: {
          required_selector: "row_index or dataset_id",
          required_location: "code from tidas_locations_category.json",
          required_target_path:
            "target_path is required when a row contains more than one location field",
          optional_fields: ["basis", "evidence"],
        },
      },
      required_resolution:
        "Use full flow/process/exchange context to fill locationOfSupply with a valid TIDAS location code, apply the location decision through the CLI, then rerun validation before remote write.",
    };
  }

  function collectFlowLocationOfSupplyAuthoringRows({
    rowsByType,
    sourceByType,
    processFlowEvidenceRows,
    locationCodeMap,
    locationQueueRows,
    locationCommands,
    blockers,
    stats,
  }: {
    rowsByType: Record<BundleRowType, Map<string, LooseRecord>>;
    sourceByType: Record<BundleRowType, Map<string, string>>;
    processFlowEvidenceRows: ProcessFlowEvidence[];
    locationCodeMap: Map<string, unknown>;
    locationQueueRows: Array<Record<string, unknown>>;
    locationCommands: LooseRecord;
    blockers: Array<Record<string, unknown>>;
    stats: Record<string, number>;
  }): void {
    const processEvidenceByFlow = new Map<string, ProcessFlowEvidence>(
      processFlowEvidenceRows.map((row) => [`${row.flow_id}::${row.flow_version}`, row]),
    );
    const queuedKeys = new Set(
      locationQueueRows.map(
        (row) => `${asText(row.dataset_id)}::${asText(row.dataset_version)}::${asText(row.path)}`,
      ),
    );
    for (const [flowKey, flowPayload] of rowsByType.flow.entries()) {
      if (flowLocationOfSupply(flowPayload)) continue;
      const flowNameCandidates = locationCodeCandidatesFromText(
        flowNameMixAndLocationTypes(flowPayload),
        locationCodeMap,
      ).map((candidate) => ({
        ...candidate,
        evidence_source: "flowDataSet.flowInformation.dataSetInformation.name.mixAndLocationTypes",
      }));
      const processEvidence = processEvidenceByFlow.get(flowKey);
      const exchangeCandidates: LocationCandidate[] = [];
      if (
        processEvidence?.exchange_location &&
        locationCodeMap.has(processEvidence.exchange_location)
      ) {
        exchangeCandidates.push({
          code: processEvidence.exchange_location,
          source_kind: "exchange_location",
          source_value: processEvidence.exchange_location,
          evidence_source: "processDataSet.exchanges.exchange.location",
          process_id: processEvidence.process_id,
          process_version: processEvidence.process_version,
        });
      }
      const processFallbackCandidates: LocationCandidate[] = [];
      if (
        processEvidence?.process_location &&
        locationCodeMap.has(processEvidence.process_location)
      ) {
        processFallbackCandidates.push({
          code: processEvidence.process_location,
          source_kind: "process_location_fallback",
          source_value: processEvidence.process_location,
          evidence_source:
            "processDataSet.processInformation.geography.locationOfOperationSupplyOrProduction.@location",
          process_id: processEvidence.process_id,
          process_version: processEvidence.process_version,
        });
      }
      const candidates =
        flowNameCandidates.length > 0 || exchangeCandidates.length > 0
          ? [...flowNameCandidates, ...exchangeCandidates]
          : processFallbackCandidates;
      const uniqueCandidates = uniqueLocationCandidates(candidates);
      if (uniqueCandidates.length === 0) continue;
      const identity = datasetIdentity(flowPayload, "flow");
      const queueKey = `${identity.id}::${identity.version}::flowDataSet.flowInformation.geography.locationOfSupply`;
      if (queuedKeys.has(queueKey)) continue;
      const reason =
        uniqueCandidates.length === 1
          ? "single_valid_location_candidate"
          : "multiple_valid_location_candidates";
      const sourceFile = sourceByType.flow.get(flowKey) ?? null;
      const queueRow = buildFlowLocationQueueRow({
        flowPayload,
        flowKey,
        sourceFile,
        candidates,
        locationCommands,
        reason,
      });
      locationQueueRows.push(queueRow);
      queuedKeys.add(queueKey);
      stats.flow_location_of_supply_missing_with_evidence += 1;
      if (uniqueCandidates.length === 1) {
        stats.flow_location_of_supply_auto_decision_candidates += 1;
      } else {
        stats.flow_location_of_supply_conflict_blockers += 1;
      }
      blockers.push({
        code: "flow_location_of_supply_requires_authoring",
        message:
          uniqueCandidates.length === 1
            ? "Flow locationOfSupply is empty but source context has a valid location code candidate that must be applied through location decisions before commit."
            : "Flow locationOfSupply is empty and source context has conflicting valid location code candidates.",
        dataset_type: "flow",
        dataset_id: identity.id,
        dataset_version: identity.version,
        source_file: repoRelativeMaybe(sourceFile),
        path: "flowDataSet.flowInformation.geography.locationOfSupply",
        suggested_location_code: queueRow.suggested_location_code,
        candidate_codes: uniqueCandidates.map((candidate) => candidate.code),
        queue: "location-authoring-queue.jsonl",
      });
    }
  }

  function flowDataSetInformation(payload: LooseRecord): LooseRecord | null {
    return payload?.flowDataSet?.flowInformation?.dataSetInformation ?? null;
  }

  function buildFlowLocationTracePayload(evidence: ProcessFlowEvidence) {
    return {
      process: {
        name: "process",
        attributes: [
          { name: "processId", value: evidence.process_id },
          { name: "processVersion", value: evidence.process_version },
        ].filter((item) => item.value),
      },
      geography: evidence.process_location
        ? {
            name: "geography",
            attributes: [
              {
                name: "locationOfOperationSupplyOrProduction",
                value: evidence.process_location,
              },
            ],
          }
        : undefined,
      exchange: {
        name: "exchange",
        attributes: [
          { name: "referenceToFlowDataSet", value: evidence.flow_id },
          { name: "referenceToFlowDataSetVersion", value: evidence.flow_version },
          evidence.exchange_location
            ? { name: "location", value: evidence.exchange_location }
            : null,
        ].filter(Boolean),
      },
    };
  }

  function appendFlowLocationSourceTrace(
    flowPayload: LooseRecord,
    evidence: ProcessFlowEvidence,
  ): boolean {
    if (!flowPayload?.flowDataSet || flowLocationOfSupply(flowPayload)) return false;
    const dataSetInformation = flowDataSetInformation(flowPayload);
    if (!dataSetInformation || typeof dataSetInformation !== "object") return false;
    if (
      dataSetInformation["common:other"] &&
      (typeof dataSetInformation["common:other"] !== "object" ||
        Array.isArray(dataSetInformation["common:other"]))
    ) {
      return false;
    }
    const commonOther = (dataSetInformation["common:other"] ??= {});
    commonOther["@xmlns:tidasimport"] = "https://tiangong.earth/tidas/import-trace/1.0";
    const locationTrace = buildFlowLocationTracePayload(evidence);
    if (commonOther["tidasimport:sourceTrace"]) {
      const existingTrace = commonOther["tidasimport:sourceTrace"];
      if (!existingTrace || typeof existingTrace !== "object" || Array.isArray(existingTrace)) {
        return false;
      }
      const payload = (existingTrace as LooseRecord).payload;
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) return false;
      const payloadRecord = payload;
      if (payloadRecord.flowLocationEvidence) return false;
      payloadRecord.flowLocationEvidence = locationTrace;
      return true;
    }
    commonOther["tidasimport:sourceTrace"] = {
      "@marker": "TIDAS_IMPORT_TRACE_V1",
      payload: locationTrace,
    };
    return true;
  }

  function projectProcessFlowLocationEvidence({
    rowsByType,
    sourceByType,
    locationCodeMap,
    stats,
  }: {
    rowsByType: Record<BundleRowType, Map<string, LooseRecord>>;
    sourceByType: Record<BundleRowType, Map<string, string>>;
    locationCodeMap: Map<string, unknown>;
    stats: Record<string, number>;
  }): ProcessFlowEvidence[] {
    const evidenceByFlowKey = new Map<string, ProcessFlowEvidence>();
    for (const [processKey, processPayload] of rowsByType.process.entries()) {
      const processIdentity = datasetIdentity(processPayload, "process");
      const processLocation = processLocationCode(processPayload, locationCodeMap);
      const exchanges = ensureArray(processPayload?.processDataSet?.exchanges?.exchange).filter(
        (exchange) => exchange && typeof exchange === "object",
      );
      for (const exchange of exchanges) {
        const reference = exchange.referenceToFlowDataSet ?? {};
        const flowId = asText(reference["@refObjectId"]);
        const flowVersion = asText(reference["@version"]) || "00.00.001";
        if (!flowId) continue;
        const exchangeLocation = exchangeLocationCode(exchange, locationCodeMap);
        if (!exchangeLocation && !processLocation) continue;
        const flowKey = `${flowId}::${flowVersion}`;
        if (evidenceByFlowKey.has(flowKey)) continue;
        evidenceByFlowKey.set(flowKey, {
          flow_id: flowId,
          flow_version: flowVersion,
          process_id: processIdentity.id,
          process_version: processIdentity.version,
          process_source_file: sourceByType.process.get(processKey) ?? null,
          process_location: processLocation,
          exchange_location: exchangeLocation,
        });
      }
    }

    for (const [flowKey, evidence] of evidenceByFlowKey.entries()) {
      const flowPayload = rowsByType.flow.get(flowKey);
      if (!flowPayload) continue;
      if (appendFlowLocationSourceTrace(flowPayload, evidence)) {
        stats.flow_location_context_traces += 1;
      }
    }
    return [...evidenceByFlowKey.values()];
  }

  function processIdFromBundleRef(value: unknown): string {
    const text = asText(value).replaceAll("\\", "/");
    if (!text) return "";
    const match = text.match(/(?:^|\/)process-bundles\/([^/]+)/u);
    return match?.[1] ?? "";
  }

  function blockerProcessId(blocker: LooseRecord): string {
    return (
      asText(blocker?.process_id) ||
      processIdFromBundleRef(blocker?.source_file) ||
      processIdFromBundleRef(blocker?.bundle) ||
      processIdFromBundleRef(blocker?.file) ||
      processIdFromBundleRef(blocker?.manifest)
    );
  }

  function blockerCountsByCode(blockersForScope: LooseRecord[]) {
    const counts = new Map<string, number>();
    for (const blocker of blockersForScope) {
      const code = asText(blocker?.code) || "unknown_blocker";
      counts.set(code, (counts.get(code) ?? 0) + 1);
    }
    return Object.fromEntries(
      [...counts.entries()].sort(([left], [right]) => left.localeCompare(right)),
    );
  }

  function isHumanDependencyBlocker(blocker: LooseRecord): boolean {
    const code = asText(blocker?.code);
    return [
      "canonical_flow_property_reference_unresolved",
      "canonical_unit_group_reference_unresolved",
      "flow_property_reference_unresolved",
      "unit_group_reference_unresolved",
      "library_contact_count_invalid",
      "library_contact_identity_missing",
      "source_reference_semantics_unresolved",
      "process_data_source_reference_unresolved",
      "bundle_manifest_file_missing",
      "process_rows_missing",
    ].includes(code);
  }

  function scopeRerunCommand({
    bundlesDir,
    outDir,
    profile,
    processId,
  }: {
    bundlesDir: unknown;
    outDir: string;
    profile: string;
    processId: string;
  }): string {
    return [
      "node",
      "scripts/foundry.mjs",
      "dataset-bundle-sample-rows",
      "--bundles-dir",
      repoRelativeMaybe(resolveRepoPath(bundlesDir)) || bundlesDir,
      "--process-id",
      processId,
      "--out-dir",
      repoRelativePath(path.join(outDir, "scopes", processId)),
      "--profile",
      profile,
    ]
      .map(shellQuote)
      .join(" ");
  }

  function buildProcessScopeLedger({
    selectedBundles,
    blockers,
    bundlesDir,
    outDir,
    profile,
  }: {
    selectedBundles: SelectedBundle[];
    blockers: LooseRecord[];
    bundlesDir: unknown;
    outDir: string;
    profile: string;
  }): {
    ledger: LooseRecord[];
    summary: {
      ready: number;
      needs_ai_authoring: number;
      blocked_deferred: number;
      selected_scopes: number;
      global_blockers: number;
      recommended_next_process_ids: string[];
    };
  } {
    const blockersByProcess = new Map<string, LooseRecord[]>();
    const globalBlockers: LooseRecord[] = [];
    for (const blocker of blockers) {
      const processId = blockerProcessId(blocker);
      if (!processId) {
        globalBlockers.push(blocker);
        continue;
      }
      const rows = blockersByProcess.get(processId) ?? [];
      rows.push(blocker);
      blockersByProcess.set(processId, rows);
    }
    const ledger = selectedBundles.map((bundle) => {
      const processBlockers = blockersByProcess.get(bundle.process_id) ?? [];
      const humanDependencyBlockers = processBlockers.filter(isHumanDependencyBlocker);
      const scopedGlobalBlockers =
        globalBlockers.length > 0
          ? globalBlockers.map((blocker) => ({
              code: blocker.code,
              message: blocker.message,
            }))
          : [];
      const status =
        processBlockers.length === 0 && globalBlockers.length === 0
          ? "ready"
          : humanDependencyBlockers.length > 0 || globalBlockers.length > 0
            ? "blocked_deferred"
            : "needs_ai_authoring";
      return {
        process_id: bundle.process_id,
        bundle_dir: bundle.bundle_dir,
        manifest: bundle.manifest,
        status,
        blocker_count: processBlockers.length + globalBlockers.length,
        ai_authoring_blockers: processBlockers.length - humanDependencyBlockers.length,
        human_dependency_blockers: humanDependencyBlockers.length + globalBlockers.length,
        blocker_counts_by_code: blockerCountsByCode([...processBlockers, ...globalBlockers]),
        blocker_examples: processBlockers.slice(0, 5).map((blocker) => ({
          code: blocker.code,
          dataset_type: blocker.dataset_type ?? null,
          dataset_id: blocker.dataset_id ?? null,
          message: blocker.message,
        })),
        global_blockers: scopedGlobalBlockers,
        next_step:
          status === "ready"
            ? "run raw-row validation, QA, curation gate, post-authoring cleanup, final validation, then write planning"
            : status === "needs_ai_authoring"
              ? "run classification/location/identity authoring, deterministic apply, then rerun this process scope"
              : "defer this scope until human/canonical dependency blockers are resolved",
        rerun_command: scopeRerunCommand({
          bundlesDir,
          outDir,
          profile,
          processId: bundle.process_id,
        }),
      };
    });
    const summaryCounts = ledger.reduce<Record<string, number>>(
      (counts, row) => {
        counts[row.status] = (counts[row.status] ?? 0) + 1;
        return counts;
      },
      { ready: 0, needs_ai_authoring: 0, blocked_deferred: 0 },
    );
    return {
      ledger,
      summary: {
        ready: summaryCounts.ready ?? 0,
        needs_ai_authoring: summaryCounts.needs_ai_authoring ?? 0,
        blocked_deferred: summaryCounts.blocked_deferred ?? 0,
        selected_scopes: ledger.length,
        global_blockers: globalBlockers.length,
        recommended_next_process_ids: [...ledger]
          .filter((row) => row.status !== "blocked_deferred")
          .sort((left, right) => {
            const statusRank: Record<string, number> = {
              ready: 0,
              needs_ai_authoring: 1,
              blocked_deferred: 2,
            };
            return (
              (statusRank[left.status] ?? 99) - (statusRank[right.status] ?? 99) ||
              left.blocker_count - right.blocker_count ||
              left.process_id.localeCompare(right.process_id)
            );
          })
          .map((row) => row.process_id),
      },
    };
  }

  function runDatasetBundleSampleRows(options: LooseRecord) {
    if (options.help) {
      return {
        schema_version: 1,
        status: "help",
        command: "dataset-bundle-sample-rows",
        usage: [
          "node scripts/foundry.mjs dataset-bundle-sample-rows --bundles-dir tmp/bafu-2025-v2-tidas/process-bundles --sample-size 3 --out-dir .foundry/workspaces/bafu-sample-rows",
        ],
        purpose:
          "Sample process bundles, materialize support/process JSONL rows, replace all converted tool contacts with one library-level contact, and write authoring input row files.",
        ...bundleSampleStageContract,
      };
    }

    const bundlesDir =
      options.bundlesDir || options.input || "tmp/bafu-2025-v2-tidas/process-bundles";
    const allBundleDirs = listProcessBundleDirs(bundlesDir);
    const selection = selectProcessBundleDirs(allBundleDirs, options);
    const outDir = resolveRepoPath(
      options.outDir || `.foundry/workspaces/bafu-bundle-sample-rows/${Date.now()}`,
    );
    const rowsDir = path.join(outDir, "rows");
    const cliBin = resolveTiangongLcaCliCommandPrefix
      ? resolveTiangongLcaCliCommandPrefix()
      : [resolveTiangongLcaCliBin()];
    const canonicalSupportCache = loadCanonicalSupportCache(options);
    // The override only applies to an EXPLICITLY selected profile (e.g. --profile bafu,
    // which the orchestrator passes). An unspecified profile defaults to generic so the
    // reference-only governance stays the safe default for ad-hoc runs.
    const allowAccountLocalSupportAndElementary =
      typeof profileFor === "function"
        ? Boolean(
            profileFor(
              repoRoot,
              asText(options.profile || "generic")
                .trim()
                .toLowerCase(),
              options,
            )?.allowAccountLocalSupportAndElementary,
          )
        : false;
    const blockOnUnscaledCanonicalSupport = booleanOption(
      options.blockOnUnscaledCanonicalSupport || options.blockUnscaledCanonicalSupport,
    );
    const classificationCommandsByType = {
      process: classificationAuthoringCommands({
        cliBin,
        outDir,
        rowsDir,
        type: "process",
      }),
      "flow-product": classificationAuthoringCommands({
        cliBin,
        outDir,
        rowsDir,
        type: "flow-product",
        rowType: "flow",
      }),
      "flow-elementary": classificationAuthoringCommands({
        cliBin,
        outDir,
        rowsDir,
        type: "flow-elementary",
        rowType: "flow",
      }),
    };
    const locationCommandsByType = Object.fromEntries(
      bundleRowTypeOrder.map((type) => [
        type,
        locationAuthoringCommands({ cliBin, outDir, rowsDir, type }),
      ]),
    );
    const locationCodeMap = loadTidasLocationCodeMap();
    fs.mkdirSync(rowsDir, { recursive: true });

    const blockers = [];
    for (const missingId of selection.missing_process_ids) {
      blockers.push({
        code: "requested_process_bundle_missing",
        message: `Requested process bundle ${missingId} was not found.`,
        process_id: missingId,
      });
    }

    const sanitizeStats: Record<string, number> = {
      removed_import_traces: 0,
      removed_import_trace_namespaces: 0,
      placeholder_text_replacements: 0,
      timestamp_normalizations: 0,
      reference_year_repairs: 0,
      annual_supply_repairs: 0,
      true_source_classification_repairs: 0,
      default_process_classification_blockers: 0,
      default_flow_classification_blockers: 0,
      location_code_targets: 0,
      location_code_valid: 0,
      location_code_blockers: 0,
      flow_location_of_supply_missing_with_evidence: 0,
      flow_location_of_supply_auto_decision_candidates: 0,
      flow_location_of_supply_conflict_blockers: 0,
      source_reference_rewrites: 0,
      process_source_reference_rewrites: 0,
      process_source_reference_fallback_rewrites: 0,
      process_source_context_rewrites: 0,
      omitted_unreferenced_true_source_rows: 0,
      true_source_identity_repairs: 0,
      true_source_description_repairs: 0,
      true_source_reference_description_repairs: 0,
      canonical_flow_property_reference_rewrites: 0,
      canonical_unit_group_reference_proofs: 0,
      elementary_flow_reuse_blockers: 0,
      flow_location_context_traces: 0,
    };
    const sourceReferenceRewriteRows: LooseRecord[] = [];
    const canonicalSupportRewriteRows: LooseRecord[] = [];
    const canonicalSupportScalingRequirements: LooseRecord[] = [];
    const canonicalSupportStats = {
      canonical_flow_property_reference_rewrites: 0,
      canonical_unit_group_reference_proofs: 0,
      amount_scaling_required_rewrites: 0,
      amount_scaling_blocked: 0,
      amount_scaling_unresolved: 0,
    };
    const sourceClassificationRepairRows: LooseRecord[] = [];
    const templateContact = findFirstBundleContactTemplate(selection.selected);
    const libraryContact = buildLibraryContactPayload(options, templateContact, {
      rewriteRows: sourceReferenceRewriteRows,
      stats: sanitizeStats,
    });
    const libraryContactIdentity = datasetIdentity(libraryContact, "contact");
    const libraryContactName = asText(
      libraryContact.contactDataSet?.contactInformation?.dataSetInformation?.["common:name"]?.[
        "#text"
      ],
    );
    const libraryContactRef = contactGlobalReference({
      id: libraryContactIdentity.id,
      version: libraryContactIdentity.version,
      shortDescription: libraryContactName,
      language: asText(options.language || options.lang || "en") || "en",
    });

    const rowsByType = Object.fromEntries(
      bundleRowTypeOrder.map((type) => [type, new Map<string, LooseRecord>()]),
    ) as Record<BundleRowType, Map<string, LooseRecord>>;
    const sourceByType = Object.fromEntries(
      bundleRowTypeOrder.map((type) => [type, new Map<string, string>()]),
    ) as Record<BundleRowType, Map<string, string>>;
    rowsByType.contact.set(
      `${libraryContactIdentity.id}::${libraryContactIdentity.version}`,
      libraryContact,
    );
    sourceByType.contact.set(
      `${libraryContactIdentity.id}::${libraryContactIdentity.version}`,
      "foundry:library-contact",
    );

    const rewriteStats = {
      rewritten: 0,
      previous_ids: new Set<string>(),
      previous_descriptions: new Set<string>(),
    };
    const traceRows: LooseRecord[] = [];
    const classificationQueueRows: LooseRecord[] = [];
    const locationQueueRows: LooseRecord[] = [];
    const elementaryFlowReuseRows: LooseRecord[] = [];
    const selectedBundles: SelectedBundle[] = [];
    for (const bundleDir of selection.selected) {
      const manifestPath = path.join(bundleDir, "manifest.json");
      const manifest = readJson(manifestPath);
      selectedBundles.push({
        process_id: asText(manifest.process_id) || path.basename(bundleDir),
        bundle_dir: repoRelativeMaybe(bundleDir),
        manifest: repoRelativeMaybe(manifestPath),
      });
      for (const type of bundleRowTypeOrder.filter((rowType) => rowType !== "contact")) {
        const plural = bundleRowTypes[type].plural;
        for (const relativeFileValue of ensureArray(manifest.files?.[plural])) {
          const relativeFile = asText(relativeFileValue);
          const sourceFile = path.join(bundleDir, relativeFile);
          if (!fileExists(sourceFile)) {
            blockers.push({
              code: "bundle_manifest_file_missing",
              message: `${type} file listed in bundle manifest is not readable.`,
              bundle: repoRelativeMaybe(bundleDir),
              file: relativeFile,
            });
            continue;
          }
          const payload = cloneJson(readJson(sourceFile));
          const sourceTraces = collectSourceTracePayloads(payload);
          rewriteContactReferences(payload, libraryContactRef, rewriteStats);
          sanitizeBundlePayload(payload, type, sourceFile, sanitizeStats, traceRows, sourceTraces);
          if (type === "source") {
            repairTrueSourceIdentity(payload, {
              sourceFile,
              stats: sanitizeStats,
              repairRows: sourceClassificationRepairRows,
            });
            repairTrueSourceDescription(payload, {
              sourceFile,
              stats: sanitizeStats,
              repairRows: sourceClassificationRepairRows,
            });
            repairTrueSourceClassification(payload, {
              sourceFile,
              stats: sanitizeStats,
              repairRows: sourceClassificationRepairRows,
            });
          }
          rewriteCanonicalSourceReferences(payload, {
            datasetType: type,
            sourceFile,
            stats: sanitizeStats,
            rewriteRows: sourceReferenceRewriteRows,
            datasetIdentityCache: datasetIdentity(payload, type),
          });
          rewriteCanonicalFlowPropertyReferences(payload, {
            cacheContext: canonicalSupportCache,
            datasetType: type,
            sourceFile,
            stats: canonicalSupportStats,
            rewriteRows: canonicalSupportRewriteRows,
            blockers,
            scalingRequirements: canonicalSupportScalingRequirements,
            blockOnUnscaled: blockOnUnscaledCanonicalSupport,
            datasetIdentityCache: datasetIdentity(payload, type),
            language: asText(options.language || options.lang || "en") || "en",
            allowAccountLocalSupportAndElementary,
          });
          collectBundleQualityFindings({
            payload,
            type,
            sourceFile,
            sourceTraces,
            blockers,
            stats: sanitizeStats,
            classificationQueueRows,
            classificationCommandsByType,
          });
          collectElementaryFlowReuseFindings({
            payload,
            type,
            sourceFile,
            sourceTraces,
            blockers,
            stats: sanitizeStats,
            elementaryFlowReuseRows,
            allowAccountLocalSupportAndElementary,
          });
          collectLocationQualityFindings({
            payload,
            type,
            sourceFile,
            blockers,
            stats: sanitizeStats,
            locationQueueRows,
            locationCodeMap,
            locationCommands: locationCommandsByType[type],
          });
          addDedupedBundleRow({
            rowsByType,
            sourceByType,
            blockers,
            type,
            payload,
            sourceFile,
          });
        }
      }
    }

    let sourceSemanticsRows = [...rowsByType.source.entries()].map(([key, payload]) =>
      sourceSemanticSummary(payload, sourceByType.source.get(key)),
    );
    const sourceLookup = new Map<string, SemanticSummary>(
      sourceSemanticsRows
        .filter((row) => row.dataset_id)
        .map((row) => [row.dataset_id, row] as const),
    );
    for (const [key, payload] of rowsByType.process.entries()) {
      const metadata = processOriginalSourceMetadata(payload);
      if (!metadata) continue;
      const processIdentity = datasetIdentity(payload, "process");
      const processSourceRefs = processSourceReferenceRows(
        payload,
        sourceLookup,
        sourceByType.process.get(key),
      ).filter((row) => row.relation === "process_data_source");
      if (processSourceRefs.length === 0) continue;
      for (const sourceRef of processSourceRefs) {
        const referencedSource = sourceLookup.get(sourceRef.ref_object_id);
        if (sourceSummaryMatchesOriginalMetadata(referencedSource, metadata)) continue;
        const sourcePayload = buildBafuProcessContextSourcePayload({
          metadata,
          contactReference: libraryContactRef,
          language: asText(options.language || options.lang || "en") || "en",
          timestamp: nowIso(),
        });
        if (!sourcePayload) continue;
        const sourceIdentity = datasetIdentity(sourcePayload, "source");
        const sourceKey = `${sourceIdentity.id}::${sourceIdentity.version}`;
        if (!rowsByType.source.has(sourceKey)) {
          rowsByType.source.set(sourceKey, sourcePayload);
          sourceByType.source.set(
            sourceKey,
            `foundry:process-context-source:${processIdentity.id}`,
          );
          const summary: SemanticSummary = {
            ...sourceSemanticSummary(sourcePayload, sourceByType.source.get(sourceKey)),
            process_context_source: true,
            source_context_process_id: processIdentity.id,
          };
          sourceSemanticsRows = [...sourceSemanticsRows, summary];
          sourceLookup.set(summary.dataset_id, summary);
          sourceClassificationRepairRows.push({
            dataset_id: sourceIdentity.id,
            dataset_version: sourceIdentity.version,
            source_file: repoRelativeMaybe(sourceByType.process.get(key)),
            relation: "true_source_identity_from_process_context",
            original_ref_object_id: sourceRef.ref_object_id,
            original_short_description: sourceRef.short_description,
            repaired_short_name: metadata.shortName,
            repaired_source_citation: metadata.citation,
            doi: metadata.doi,
            basis:
              "Process context contains an explicit Original source and DOI that is more specific than the converted process data source reference.",
          });
        }
        const replacementSource = sourceLookup.get(sourceIdentity.id);
        rewriteProcessDataSourceReferences(payload.processDataSet!, {
          sourceLookup,
          replacementSource,
          forceReplacementSource: true,
          replacementRelation: "process_data_source_context_source",
          replacementReason:
            "Process context contains an explicit Original source/DOI that is more specific than the converted process data source reference.",
          sourceFile: sourceByType.process.get(key),
          stats: sanitizeStats,
          rewriteRows: sourceReferenceRewriteRows,
          datasetIdentityCache: processIdentity,
          language: asText(options.language || options.lang || "en") || "en",
        });
      }
    }
    const processSourceReplacement = (() => {
      const trueSources = sourceSemanticsRows.filter((row) => row.kind === "true_source");
      if (trueSources.length === 1) return trueSources[0];
      return null;
    })();
    const needsFallbackSource = [...rowsByType.process.entries()].some(([key, payload]) =>
      processSourceReferenceRows(payload, sourceLookup, sourceByType.process.get(key)).some(
        (row) =>
          row.relation === "process_data_source" && row.referenced_source_kind !== "true_source",
      ),
    );
    let fallbackSourceSummary: SemanticSummary | null = null;
    if (!processSourceReplacement && needsFallbackSource) {
      const fallbackSource = buildDatabaseFallbackSourcePayload({
        profile: asText(options.profile) || "bafu",
        contactReference: libraryContactRef,
        language: asText(options.language || options.lang || "en") || "en",
        timestamp: nowIso(),
      });
      const fallbackIdentity = datasetIdentity(fallbackSource, "source");
      const fallbackKey = `${fallbackIdentity.id}::${fallbackIdentity.version}`;
      const fallbackProvenance = `foundry:${asText(options.profile) || "bafu"}-database-fallback-source`;
      rowsByType.source.set(fallbackKey, fallbackSource);
      sourceByType.source.set(fallbackKey, fallbackProvenance);
      fallbackSourceSummary = {
        ...sourceSemanticSummary(fallbackSource, fallbackProvenance),
        fallback_database_source: true,
      };
      sourceSemanticsRows = [...sourceSemanticsRows, fallbackSourceSummary];
      sourceLookup.set(fallbackSourceSummary.dataset_id, fallbackSourceSummary);
    }
    for (const [key, payload] of rowsByType.process.entries()) {
      rewriteProcessDataSourceReferences(payload.processDataSet!, {
        sourceLookup,
        replacementSource: processSourceReplacement || fallbackSourceSummary,
        sourceFile: sourceByType.process.get(key),
        stats: sanitizeStats,
        rewriteRows: sourceReferenceRewriteRows,
        datasetIdentityCache: datasetIdentity(payload, "process"),
        language: asText(options.language || options.lang || "en") || "en",
      });
    }
    const allProcessSourceReferenceRows: SourceReferenceRow[] = [];
    for (const [key, payload] of rowsByType.process.entries()) {
      allProcessSourceReferenceRows.push(
        ...processSourceReferenceRows(payload, sourceLookup, sourceByType.process.get(key)),
      );
    }
    const processSourceReferenceQueueRows = allProcessSourceReferenceRows.filter(
      (row) => row.relation === "process_data_source",
    );
    blockers.push(...sourceReferenceSemanticBlockers(allProcessSourceReferenceRows));
    // A true source is "referenced" (and must stay in the materialized support set
    // so it commits before the process) if ANY process field points at it — not
    // only referenceToDataSource. USLCI processes cite a review-report source via
    // validation/review/referenceToCompleteReviewReport; counting only
    // process_data_source wrongly dropped it, blocking the process on reference
    // closure. The data-source-only queue above is still used for the
    // process_data_source semantic checks; this set governs support retention.
    const referencedProcessSourceKeys = new Set(
      allProcessSourceReferenceRows
        .filter((row) => row.ref_object_id)
        .map((row) => `${row.ref_object_id}::${row.version || "00.00.001"}`),
    );
    const unreferencedTrueSourceRows = sourceSemanticsRows.filter(
      (row) =>
        row.kind === "true_source" &&
        row.materialized_as_source_row !== false &&
        !referencedProcessSourceKeys.has(
          `${row.dataset_id}::${row.dataset_version || "00.00.001"}`,
        ),
    );
    for (const row of unreferencedTrueSourceRows) {
      if (!row.dataset_id) continue;
      rowsByType.source.delete(`${row.dataset_id}::${row.dataset_version || ""}`);
      sourceByType.source.delete(`${row.dataset_id}::${row.dataset_version || ""}`);
      row.materialized_as_source_row = false;
      row.omitted_reason = "unreferenced_by_selected_process_scope";
      sanitizeStats.omitted_unreferenced_true_source_rows += 1;
    }
    // FIX C (support closure): a non-true_source (e.g. a "Data set formats" review
    // report cited via validation/review/referenceToCompleteReviewReport) is normally
    // dropped from the materialized source/support set, because for BAFU such format/
    // compliance references are rewritten to canonical public rows and the process no
    // longer points at the original. USLCI cites a review-report source that has NO
    // canonical mapping, so the process keeps a hard reference to it; dropping it left
    // a dangling dependency and blocked process.finalize on reference_closure_unproven.
    // Under the account-local override (USLCI; BAFU has it false → unchanged), retain
    // any source still referenced by a process in this scope so it is committed as
    // account-local support BEFORE the process finalize. This can only KEEP a source
    // the scope already collected and the process already references, so it never
    // loosens closure for an unreferenced source.
    const omittedSourceSemanticsRows = sourceSemanticsRows.filter((row) => {
      if (row.kind === "true_source") return false;
      if (
        allowAccountLocalSupportAndElementary &&
        row.dataset_id &&
        referencedProcessSourceKeys.has(`${row.dataset_id}::${row.dataset_version || "00.00.001"}`)
      ) {
        // Retain (do NOT add to the omitted set): the process keeps a hard reference to
        // this source, so it must travel as account-local support and commit first.
        row.materialized_as_source_row = true;
        row.retained_reason = "referenced_account_local_support_source";
        sanitizeStats.retained_referenced_account_local_support_source_rows =
          Number(sanitizeStats.retained_referenced_account_local_support_source_rows ?? 0) + 1;
        return false;
      }
      return true;
    });
    for (const row of omittedSourceSemanticsRows) {
      if (!row.dataset_id) continue;
      rowsByType.source.delete(`${row.dataset_id}::${row.dataset_version || ""}`);
      sourceByType.source.delete(`${row.dataset_id}::${row.dataset_version || ""}`);
    }

    const processFlowLocationEvidenceRows = projectProcessFlowLocationEvidence({
      rowsByType,
      sourceByType,
      locationCodeMap,
      stats: sanitizeStats,
    });
    collectFlowLocationOfSupplyAuthoringRows({
      rowsByType,
      sourceByType,
      processFlowEvidenceRows: processFlowLocationEvidenceRows,
      locationCodeMap,
      locationQueueRows,
      locationCommands: locationCommandsByType.flow,
      blockers,
      stats: sanitizeStats,
    });

    const identityPreflightArtifacts = buildIdentityPreflightArtifacts({
      rowsByType,
      sourceByType,
      outDir,
      cliBin,
    });
    attachIdentityPreflightRows(elementaryFlowReuseRows, identityPreflightArtifacts);

    const traceQueuePath = path.join(outDir, "import-traces.jsonl");
    writeJsonLines(traceQueuePath, traceRows);
    const classificationQueuePath = path.join(outDir, "classification-authoring-queue.jsonl");
    writeJsonLines(classificationQueuePath, classificationQueueRows);
    const locationQueuePath = path.join(outDir, "location-authoring-queue.jsonl");
    writeJsonLines(locationQueuePath, locationQueueRows);
    const elementaryFlowReuseQueuePath = path.join(outDir, "elementary-flow-reuse-queue.jsonl");
    writeJsonLines(elementaryFlowReuseQueuePath, elementaryFlowReuseRows);
    const sourceSemanticsPath = path.join(outDir, "source-semantics.jsonl");
    writeJsonLines(sourceSemanticsPath, sourceSemanticsRows);
    const sourceClassificationRepairsPath = path.join(
      outDir,
      "source-classification-repairs.jsonl",
    );
    writeJsonLines(sourceClassificationRepairsPath, sourceClassificationRepairRows);
    const processSourceReferencesPath = path.join(outDir, "process-source-references.jsonl");
    writeJsonLines(processSourceReferencesPath, processSourceReferenceQueueRows);
    const sourceReferenceRewritesPath = path.join(outDir, "source-reference-rewrites.jsonl");
    writeJsonLines(sourceReferenceRewritesPath, sourceReferenceRewriteRows);
    const canonicalSupportRewritesPath = path.join(outDir, "canonical-support-rewrites.jsonl");
    writeJsonLines(canonicalSupportRewritesPath, canonicalSupportRewriteRows);
    const canonicalSupportScalingPath = path.join(outDir, "canonical-support-amount-scaling.jsonl");
    if (canonicalSupportScalingRequirements.length > 0) {
      writeJsonLines(canonicalSupportScalingPath, canonicalSupportScalingRequirements);
    }
    sanitizeStats.canonical_flow_property_reference_rewrites =
      canonicalSupportStats.canonical_flow_property_reference_rewrites;
    sanitizeStats.canonical_unit_group_reference_proofs =
      canonicalSupportStats.canonical_unit_group_reference_proofs;
    if (canonicalSupportStats.amount_scaling_required_rewrites > 0) {
      sanitizeStats.amount_scaling_required_rewrites =
        canonicalSupportStats.amount_scaling_required_rewrites;
    }
    if (canonicalSupportStats.amount_scaling_blocked > 0) {
      sanitizeStats.amount_scaling_blocked = canonicalSupportStats.amount_scaling_blocked;
    }
    if (canonicalSupportStats.amount_scaling_unresolved > 0) {
      sanitizeStats.amount_scaling_unresolved = canonicalSupportStats.amount_scaling_unresolved;
    }

    const rowFiles: Partial<Record<BundleRowType | "support", string>> = {};
    const countsByType: Record<string, number> = {};
    for (const type of bundleRowTypeOrder) {
      const rows = [...rowsByType[type].values()];
      countsByType[type] = rows.length;
      const filePath = path.join(rowsDir, `${bundleRowTypes[type].plural}.jsonl`);
      writeJsonLines(filePath, rows);
      rowFiles[type] = repoRelativePath(filePath);
    }
    const supportRows = (["contact", "source"] as BundleRowType[]).flatMap((type) => [
      ...rowsByType[type].values(),
    ]);
    countsByType.support = supportRows.length;
    const supportRowsPath = path.join(rowsDir, "support.jsonl");
    writeJsonLines(supportRowsPath, supportRows);
    rowFiles.support = repoRelativePath(supportRowsPath);

    if (countsByType.contact !== 1) {
      blockers.push({
        code: "library_contact_count_invalid",
        message: `Expected exactly one shared contact row, got ${countsByType.contact}.`,
        actual: countsByType.contact,
      });
    }
    if (!libraryContactIdentity.id || !libraryContactIdentity.version) {
      blockers.push({
        code: "library_contact_identity_missing",
        message: "Generated library contact is missing common:UUID or common:dataSetVersion.",
        id: libraryContactIdentity.id,
        version: libraryContactIdentity.version,
      });
    }
    if (selection.selected.length === 0) {
      blockers.push({
        code: "process_bundle_selection_empty",
        message: "No process bundles were selected.",
      });
    }
    if (countsByType.process < selection.selected.length) {
      blockers.push({
        code: "process_rows_missing",
        message: `Selected ${selection.selected.length} bundles but materialized ${countsByType.process} process rows.`,
        selected_bundles: selection.selected.length,
        process_rows: countsByType.process,
      });
    }

    const profile = asText(options.profile || "bafu");
    const processScopeProjection = buildProcessScopeLedger({
      selectedBundles,
      blockers,
      bundlesDir,
      outDir,
      profile,
    });
    const processScopeLedgerPath = path.join(outDir, "process-scope-ledger.jsonl");
    writeJsonLines(processScopeLedgerPath, processScopeProjection.ledger);

    const cleanupRowsPath = (type: BundleRowType) =>
      path.join(outDir, "cleanup", type, `${bundleRowTypes[type].plural}.cleaned.jsonl`);
    const cleanupCommand = (
      type: BundleRowType | "support",
      inputFile = resolveRepoPath(rowFiles[type]),
    ) =>
      [
        "node",
        "scripts/foundry.mjs",
        "dataset-curation-cleanup",
        "--type",
        type,
        "--rows-file",
        inputFile,
        "--out-dir",
        path.join(outDir, "cleanup", type),
      ]
        .map(shellQuote)
        .join(" ");
    const schemaValidateCommand = (
      type: BundleRowType,
      inputFile = resolveRepoPath(rowFiles[type]),
    ) =>
      [
        "node",
        "scripts/foundry.mjs",
        "dataset-tidas-validate",
        "--rows-file",
        inputFile,
        "--type",
        type,
        "--out-dir",
        path.join(outDir, "validate", type),
      ]
        .map(shellQuote)
        .join(" ");
    const contextPackCommand = (type: BundleRowType) =>
      [
        ...cliBin,
        "dataset",
        "context-pack",
        "--type",
        type,
        "--profile",
        "ai-import",
        "--out-dir",
        path.join(outDir, "context", type),
        "--json",
      ]
        .map(shellQuote)
        .join(" ");
    const qaReportPath = (type: BundleRowType) =>
      type === "flow"
        ? path.join(outDir, "qa", type, "flow_qa_report.json")
        : path.join(outDir, "qa", type, "process-qa-report.json");
    const qaCommand = (type: BundleRowType, inputFile = resolveRepoPath(rowFiles[type])) =>
      [
        ...cliBin,
        "qa",
        type,
        "--rows-file",
        inputFile,
        "--out-dir",
        path.join(outDir, "qa", type),
        "--json",
      ]
        .map(shellQuote)
        .join(" ");
    const curationGateCommand = (type: BundleRowType) =>
      [
        "node",
        "scripts/foundry.mjs",
        "dataset-curation-gate",
        "--type",
        type,
        "--profile",
        profile,
        "--rows-file",
        resolveRepoPath(rowFiles[type]),
        "--schema-report",
        path.join(outDir, "validate", type, "outputs", "validation-report.json"),
        "--qa-report",
        qaReportPath(type),
        "--schema-file",
        path.join(outDir, "context", type, "outputs", "schema.json"),
        "--yaml-file",
        path.join(outDir, "context", type, "outputs", "methodology.yaml"),
        "--ruleset-file",
        path.join(outDir, "context", type, "outputs", "runtime-ruleset.json"),
        "--classification-queue",
        classificationQueuePath,
        "--location-queue",
        locationQueuePath,
        "--identity-preflight-index",
        identityPreflightArtifacts.indexPath,
        "--out-dir",
        path.join(outDir, "curation-gate", type),
      ]
        .map(shellQuote)
        .join(" ");
    const saveDraftCommand = (
      type: BundleRowType,
      mode: "commit" | "validate",
      inputFile = cleanupRowsPath(type),
    ) => {
      const modeFlag = mode === "commit" ? "--commit" : "--dry-run";
      if (type === "lifecyclemodel") {
        return [
          ...cliBin,
          "lifecyclemodel",
          "save-draft",
          "--input",
          inputFile,
          "--out-dir",
          path.join(outDir, mode === "commit" ? "commit" : "dry-run", type),
          modeFlag,
          "--json",
        ]
          .map(shellQuote)
          .join(" ");
      }
      return [
        ...cliBin,
        "dataset",
        "save-draft",
        "--input",
        inputFile,
        "--type",
        type,
        "--out-dir",
        path.join(outDir, mode === "commit" ? "commit" : "dry-run", type),
        modeFlag,
        "--json",
      ]
        .map(shellQuote)
        .join(" ");
    };
    const commands: Record<string, Record<string, unknown>> = Object.fromEntries(
      bundleRowTypeOrder
        .filter((type) => !["unitgroup", "flowproperty"].includes(type))
        .map((type) => [
          type,
          {
            context_pack: contextPackCommand(type),
            schema_validate: schemaValidateCommand(type),
            qa: ["process", "flow"].includes(type) ? qaCommand(type) : null,
            curation_gate: ["process", "flow"].includes(type) ? curationGateCommand(type) : null,
            cleanup: cleanupCommand(type),
            dry_run: saveDraftCommand(type, "validate"),
            commit: saveDraftCommand(type, "commit"),
            prerequisites: [
              "Raw rows are authoring inputs, not commit-ready rows.",
              "Run schema_validate, QA where available, and dataset-curation-gate on raw rows before AI authoring.",
              "Run dataset-curation-cleanup only after curation source trace has been captured and AI/deterministic apply evidence is complete.",
              "Run dry_run/commit only on cleanup output rows after all gate blockers are closed.",
            ],
          },
        ]),
    );
    commands.unitgroup = {
      context_pack: null,
      schema_validate: null,
      qa: null,
      curation_gate: null,
      cleanup: null,
      dry_run: null,
      commit: null,
      policy: "reference_only_existing_database_rows",
    };
    commands.flowproperty = {
      context_pack: null,
      schema_validate: null,
      qa: null,
      curation_gate: null,
      cleanup: null,
      dry_run: null,
      commit: null,
      policy: "reference_only_existing_database_rows",
    };
    commands.support = {
      context_pack: null,
      schema_validate: null,
      qa: null,
      curation_gate: null,
      cleanup: cleanupCommand("support", resolveRepoPath(rowFiles.support)),
      dry_run: [
        ...cliBin,
        "dataset",
        "save-draft",
        "--input",
        path.join(outDir, "cleanup", "support", "support.cleaned.jsonl"),
        "--type",
        "auto",
        "--out-dir",
        path.join(outDir, "dry-run", "support"),
        "--dry-run",
        "--json",
      ]
        .map(shellQuote)
        .join(" "),
      commit: [
        ...cliBin,
        "dataset",
        "save-draft",
        "--input",
        path.join(outDir, "cleanup", "support", "support.cleaned.jsonl"),
        "--type",
        "auto",
        "--out-dir",
        path.join(outDir, "commit", "support"),
        "--commit",
        "--json",
      ]
        .map(shellQuote)
        .join(" "),
      prerequisites: [
        "Support rows are contact/source only; unitgroup and flowproperty stay reference-only.",
        "Run cleanup before support dry_run/commit.",
        "Commit support only when dependent process/flow scopes have passed reference closure planning.",
      ],
    };

    const reportPath = path.join(outDir, "dataset-bundle-sample-rows-report.json");
    const report = {
      schema_version: 1,
      generated_at_utc: nowIso(),
      status: blockers.length === 0 ? "ready" : "blocked",
      command: "dataset-bundle-sample-rows",
      profile,
      source_bundles_dir: repoRelativeMaybe(resolveRepoPath(bundlesDir)),
      sample: {
        seed: selection.seed,
        requested_count: selection.selected.length + selection.missing_process_ids.length,
        selected_count: selection.selected.length,
        selected_bundles: selectedBundles,
        missing_process_ids: selection.missing_process_ids,
      },
      library_contact: {
        id: libraryContactIdentity.id,
        version: libraryContactIdentity.version,
        name: libraryContactName,
        website:
          libraryContact.contactDataSet?.contactInformation?.dataSetInformation?.WWWAddress ?? null,
        policy: "one_shared_contact_per_source_library",
        replaced_contact_ids: [...rewriteStats.previous_ids].sort(),
        replaced_contact_descriptions: [...rewriteStats.previous_descriptions].sort(),
      },
      policy: {
        raw_sample_rows_are_not_write_ready: true,
        required_multilang_english_before_write: true,
        preserve_source_language_variants: true,
        tidas_tools_conversion_boundary:
          "The converter may emit a generic conversion contact; Foundry replaces it during library import materialization.",
        support_rows_before_process_rows: true,
        source_rows_only_true_sources: true,
        unitgroup_rows_reference_only: true,
        flowproperty_rows_reference_only: true,
        canonical_support_cache: repoRelativeMaybe(canonicalSupportCache.cachePath),
        source_rows_exclude:
          "Converted data-format, compliance-system, placeholder, and Not specified support sources are omitted from source/support rows; they remain only in source-semantics provenance.",
        unitgroup_flowproperty_write_policy:
          "Unit Groups and Flow Properties are selected from existing canonical database rows. Converted rows may be kept for audit, but support.jsonl and generated commit commands never write them to My Data.",
        elementary_flow_write_policy:
          "Elementary flows are selected from existing TianGong database rows and are never written as BAFU-owned flow rows. Unresolved elementary matches remain in elementary-flow-reuse-queue.jsonl and block referencing process writes.",
        identity_preflight_search_policy:
          "Process and flow matching uses CLI identity-preflight with complete fielded search briefs. The CLI sends query, filter, match_count, page_size, and data_source to process_hybrid_search or flow_hybrid_search, then applies deterministic local identity decisions to returned candidates.",
        canonical_flow_property_reference_rewrite:
          "Flow referenceToFlowPropertyDataSet values are rewritten from converted package-local Amount-in-unit rows to canonical Flow Property rows listed in the local support cache.",
        ...(canonicalSupportScalingRequirements.length > 0 || blockOnUnscaledCanonicalSupport
          ? {
              canonical_support_amount_scaling:
                "Canonical support rewrites never convert amounts. Scale!=1 requirements remain explicit local evidence; under --block-on-unscaled-canonical-support, known positive factors use canonical_support_amount_scaling_required while missing, non-finite, zero, or negative factors use canonical_support_amount_scale_unresolved.",
            }
          : {}),
        true_source_classification_repair:
          "Report/publication sources with sourceCitation and converted Other source types classification are repaired to TIDAS Publications and communications before dry-run/write planning.",
        true_source_identity_repair:
          "Report/publication sources with generic EcoSpold compatibility names are repaired from sourceDescriptionOrComment metadata before dry-run/write planning.",
        true_source_description_repair:
          "Report/publication sources with empty or generic sourceDescriptionOrComment values are repaired from sourceCitation/shortName evidence before dry-run/write planning.",
        true_source_reference_description_repair:
          "Process data source reference shortDescription values are synchronized to curated true source row names before dry-run/write planning.",
        process_context_source_repair:
          "When process context contains a clear Original source with DOI that is more specific than the converted source reference, Foundry creates a process-context source row, rewrites referenceToDataSource to it, and omits unreferenced converted source rows from support writes.",
        canonical_source_reference_rewrite:
          "referenceToDataSetFormat and referenceToComplianceSystem are rewritten to public canonical source references before dry-run/write planning.",
        rust_tidas_validation_before_remote_write:
          "Raw materialized rows are authoring inputs. Capture curation context first, close AI/deterministic gates, run dataset-curation-cleanup, then validate the cleanup output through dataset-tidas-validate before save-draft dry-run/commit. Remote CLI commands keep their own defensive validation.",
      },
      counts: {
        blockers: blockers.length,
        total_available_bundles: allBundleDirs.length,
        selected_bundles: selection.selected.length,
        process_scopes_ready: processScopeProjection.summary.ready,
        process_scopes_needs_ai_authoring: processScopeProjection.summary.needs_ai_authoring,
        process_scopes_blocked_deferred: processScopeProjection.summary.blocked_deferred,
        rewritten_contact_refs: rewriteStats.rewritten,
        import_trace_queue_rows: traceRows.length,
        classification_authoring_queue_rows: classificationQueueRows.length,
        location_authoring_queue_rows: locationQueueRows.length,
        elementary_flow_reuse_queue_rows: elementaryFlowReuseRows.length,
        identity_preflight_request_rows: identityPreflightArtifacts.rows.length,
        source_semantics_rows: sourceSemanticsRows.length,
        source_classification_repair_rows: sourceClassificationRepairRows.length,
        true_source_rows: sourceSemanticsRows.filter((row) => row.kind === "true_source").length,
        format_support_source_rows: sourceSemanticsRows.filter(
          (row) => row.kind === "format_support_source",
        ).length,
        compliance_support_source_rows: sourceSemanticsRows.filter(
          (row) => row.kind === "compliance_support_source",
        ).length,
        placeholder_or_unspecified_source_rows: sourceSemanticsRows.filter(
          (row) => row.kind === "placeholder_or_unspecified_source",
        ).length,
        omitted_non_true_source_rows: omittedSourceSemanticsRows.length,
        process_source_reference_rows: processSourceReferenceQueueRows.length,
        source_reference_rewrite_rows: sourceReferenceRewriteRows.length,
        canonical_support_rewrite_rows: canonicalSupportRewriteRows.length,
        ...(canonicalSupportScalingRequirements.length > 0
          ? {
              canonical_support_amount_scaling_rows: canonicalSupportScalingRequirements.length,
            }
          : {}),
        materialized_true_source_rows: sourceSemanticsRows.filter(
          (row) => row.kind === "true_source" && row.materialized_as_source_row !== false,
        ).length,
        reference_only_unitgroup_rows: countsByType.unitgroup,
        reference_only_flowproperty_rows: countsByType.flowproperty,
        true_source_identity_repairs: sanitizeStats.true_source_identity_repairs,
        true_source_description_repairs: sanitizeStats.true_source_description_repairs,
        true_source_reference_description_repairs:
          sanitizeStats.true_source_reference_description_repairs,
        ...sanitizeStats,
        ...Object.fromEntries(
          Object.entries(countsByType).map(([type, count]) => [`${type}_rows`, count]),
        ),
      },
      process_scope_summary: processScopeProjection.summary,
      ...(canonicalSupportScalingRequirements.length > 0
        ? { amount_scaling_requirements: canonicalSupportScalingRequirements }
        : {}),
      files: {
        report: repoRelativePath(reportPath),
        rows: rowFiles,
        process_scope_ledger: repoRelativePath(processScopeLedgerPath),
        import_traces: repoRelativePath(traceQueuePath),
        classification_authoring_queue: repoRelativePath(classificationQueuePath),
        location_authoring_queue: repoRelativePath(locationQueuePath),
        elementary_flow_reuse_queue: repoRelativePath(elementaryFlowReuseQueuePath),
        identity_preflight_requests: repoRelativePath(identityPreflightArtifacts.indexPath),
        source_semantics: repoRelativePath(sourceSemanticsPath),
        source_classification_repairs: repoRelativePath(sourceClassificationRepairsPath),
        process_source_references: repoRelativePath(processSourceReferencesPath),
        source_reference_rewrites: repoRelativePath(sourceReferenceRewritesPath),
        canonical_support_rewrites: repoRelativePath(canonicalSupportRewritesPath),
        ...(canonicalSupportScalingRequirements.length > 0
          ? {
              canonical_support_amount_scaling: repoRelativePath(canonicalSupportScalingPath),
            }
          : {}),
      },
      commands,
      blockers,
    };
    writeJson(reportPath, report);
    return report;
  }

  return { runDatasetBundleSampleRows };
}

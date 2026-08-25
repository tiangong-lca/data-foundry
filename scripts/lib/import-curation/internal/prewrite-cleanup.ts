import { datasetIdentity, datasetRoot, unwrapDatasetPayload } from "./dataset-payload.ts";
import { sha256Json, sha256Text } from "./hash-utils.ts";
import { asText, ensureArray } from "./runtime-io.ts";

export const annualSupplyMissingDataSentinelText = "9999 missing-data-sentinel/year";

export const foundryTraceNamespace = "https://tiangong-lca.dev/foundry/import-curation/1";

const datetimeFieldsToNormalize = new Set(["common:timeStamp", "common:dateOfLastRevision"]);

const foundryTraceKeys = [
  "tiangongfoundry:unresolvedTrace",
  "tiangongfoundry:sourceExchangeCompleteness",
];

const localSourceLocatorKeys = new Set([
  "source_path",
  "sourcePath",
  "local_source_path",
  "localSourcePath",
  "package_path",
  "packagePath",
  "source_object",
  "sourceObject",
]);

interface JsonRecord {
  [key: string]: unknown;
}

interface SourceRowEntry {
  row: unknown;
  index: number;
  identity: ReturnType<typeof datasetIdentity>;
}

export type SourceRowsByIdentity = Map<string, SourceRowEntry>;

interface SourceExchangeProofOptions {
  rowIndex?: number | null;
  sourceRowsByKey?: SourceRowsByIdentity | null;
  sourceRowsFile?: string | null;
  rowsFile?: string | null;
  proofRows?: JsonRecord[];
}

interface LocatorStats {
  redacted: number;
}

type DateTimeValidationReason =
  | "invalid_datetime_value_type"
  | "invalid_datetime_syntax"
  | "invalid_calendar_date"
  | "invalid_time"
  | "invalid_timezone_offset";

interface DateTimeMetadataBlocker {
  code: "invalid_datetime_metadata";
  path: string;
  value: unknown;
  reason: DateTimeValidationReason;
}

interface DateTimeInspection {
  normalized: string | null;
  reason: DateTimeValidationReason | null;
}

interface DateTimeUpdate {
  parent: JsonRecord;
  key: string;
  normalized: string;
}

class InvalidDateTimeMetadataError extends Error {
  readonly blockers: DateTimeMetadataBlocker[];

  constructor(blockers: DateTimeMetadataBlocker[]) {
    super("TIDAS/ILCD datetime metadata contains invalid values.");
    this.name = "InvalidDateTimeMetadataError";
    this.blockers = blockers;
  }
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function inspectUtcDateTimeString(value: unknown): DateTimeInspection {
  if (typeof value !== "string") {
    return { normalized: null, reason: "invalid_datetime_value_type" };
  }
  const trimmed = value.trim();
  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|([+-])(\d{2}):(\d{2}))$/u.exec(
      trimmed,
    );
  if (!match) {
    return { normalized: null, reason: "invalid_datetime_syntax" };
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const zone = match[7];
  const offsetHour = Number(match[9] ?? 0);
  const offsetMinute = Number(match[10] ?? 0);

  const calendarProbe = new Date(0);
  calendarProbe.setUTCHours(0, 0, 0, 0);
  calendarProbe.setUTCFullYear(year, month - 1, day);
  if (
    calendarProbe.getUTCFullYear() !== year ||
    calendarProbe.getUTCMonth() !== month - 1 ||
    calendarProbe.getUTCDate() !== day
  ) {
    return { normalized: null, reason: "invalid_calendar_date" };
  }
  if (hour > 23 || minute > 59 || second > 59) {
    return { normalized: null, reason: "invalid_time" };
  }
  if (zone !== "Z" && (offsetHour > 23 || offsetMinute > 59)) {
    return { normalized: null, reason: "invalid_timezone_offset" };
  }
  const time = Date.parse(trimmed);
  if (Number.isNaN(time)) {
    return { normalized: null, reason: "invalid_datetime_syntax" };
  }
  const normalized = new Date(time).toISOString();
  return { normalized: normalized === value ? null : normalized, reason: null };
}

export function normalizeUtcDateTimeString(value: unknown): string | null {
  const inspection = inspectUtcDateTimeString(value);
  return inspection.reason ? null : inspection.normalized;
}

export function normalizeDateTimeMetadata(value: unknown): number {
  const updates: DateTimeUpdate[] = [];
  const blockers: DateTimeMetadataBlocker[] = [];
  const visit = (node: unknown, currentPath: string): void => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      node.forEach((item, index) => visit(item, `${currentPath}[${index}]`));
      return;
    }

    if (!isRecord(node)) return;
    for (const [key, child] of Object.entries(node)) {
      const childPath = `${currentPath}.${key}`;
      if (datetimeFieldsToNormalize.has(key)) {
        const inspection = inspectUtcDateTimeString(child);
        if (inspection.reason) {
          blockers.push({
            code: "invalid_datetime_metadata",
            path: childPath,
            value: child,
            reason: inspection.reason,
          });
        } else if (inspection.normalized) {
          updates.push({ parent: node, key, normalized: inspection.normalized });
        }
        continue;
      }
      visit(child, childPath);
    }
  };
  visit(value, "$");
  if (blockers.length > 0) throw new InvalidDateTimeMetadataError(blockers);
  for (const update of updates) update.parent[update.key] = update.normalized;
  return updates.length;
}

function annualSupplyTextValue(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (isRecord(value)) {
    return asText(value["#text"] ?? value.value);
  }
  return "";
}

function isPlaceholderAnnualSupplyValue(value: unknown): boolean {
  const text = annualSupplyTextValue(value);
  const normalized = text.toLowerCase();
  return (
    !text ||
    /^9999$/u.test(text) ||
    /^not\s+specified\.?$/iu.test(text) ||
    /^not\s+declared\s+in\s+source\s+package\.?$/iu.test(text) ||
    normalized.includes("source production volume unavailable") ||
    normalized.includes("production volume unavailable") ||
    normalized.includes("source evidence unavailable")
  );
}

function annualSupplySentinelValue(): JsonRecord {
  return {
    "@xml:lang": "en",
    "#text": annualSupplyMissingDataSentinelText,
  };
}

export function applyAnnualSupplyMissingDataSentinel(row: unknown, datasetType: string): boolean {
  if (datasetType !== "process") return false;
  const payload = unwrapDatasetPayload(row, datasetType);
  const root = datasetRoot(payload, datasetType);
  const modelling = isRecord(root.modellingAndValidation) ? root.modellingAndValidation : {};
  const dataSources = modelling.dataSourcesTreatmentAndRepresentativeness;
  if (!isRecord(dataSources)) return false;
  const current = dataSources.annualSupplyOrProductionVolume;
  if (current !== undefined && !isPlaceholderAnnualSupplyValue(current)) {
    return false;
  }
  dataSources.annualSupplyOrProductionVolume = annualSupplySentinelValue();
  return true;
}

function processDataSetInformation(row: unknown): JsonRecord | null {
  const payload = unwrapDatasetPayload(row, "process");
  const root = datasetRoot(payload, "process");
  const processInformation = isRecord(root.processInformation) ? root.processInformation : {};
  return isRecord(processInformation.dataSetInformation)
    ? processInformation.dataSetInformation
    : null;
}

function processExchanges(row: unknown): unknown[] {
  const payload = unwrapDatasetPayload(row, "process");
  const root = datasetRoot(payload, "process");
  const exchanges = isRecord(root.exchanges) ? root.exchanges : {};
  return ensureArray(exchanges.exchange);
}

function exchangeDirection(exchange: unknown): string {
  return asText(isRecord(exchange) ? exchange.exchangeDirection : undefined).toLowerCase();
}

function stripFlowReferenceFromExchange(value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  if (Array.isArray(value)) {
    return value.map((item) => stripFlowReferenceFromExchange(item));
  }
  if (!isRecord(value)) return value;
  const next: JsonRecord = {};
  for (const [key, child] of Object.entries(value)) {
    if (key === "referenceToFlowDataSet") continue;
    next[key] = stripFlowReferenceFromExchange(child);
  }
  return next;
}

function outputOnlyExchangeProofCandidate({
  row,
  sourceRow,
}: {
  row: unknown;
  sourceRow: unknown;
}) {
  const finalExchanges = processExchanges(row);
  const sourceExchanges = processExchanges(sourceRow);
  if (finalExchanges.length === 0 || sourceExchanges.length === 0) return null;
  const finalDirections = finalExchanges.map(exchangeDirection);
  const sourceDirections = sourceExchanges.map(exchangeDirection);
  const finalOutputOnly = finalDirections.every((item) => item === "output");
  const sourceOutputOnly = sourceDirections.every((item) => item === "output");
  if (!finalOutputOnly || !sourceOutputOnly) return null;
  if (finalExchanges.length !== sourceExchanges.length) return null;
  const sourceExchangeSignature = sourceExchanges.map((exchange) =>
    stripFlowReferenceFromExchange(exchange),
  );
  const finalExchangeSignature = finalExchanges.map((exchange) =>
    stripFlowReferenceFromExchange(exchange),
  );
  const sourceExchangeSignatureHash = sha256Json(sourceExchangeSignature);
  const finalExchangeSignatureHash = sha256Json(finalExchangeSignature);
  if (sourceExchangeSignatureHash !== finalExchangeSignatureHash) return null;
  return {
    exchange_count: finalExchanges.length,
    directions: finalDirections.map((item) => item || null),
    source_exchange_signature_hash: sourceExchangeSignatureHash,
    final_exchange_signature_hash: finalExchangeSignatureHash,
  };
}

function acceptedSourceExchangeTraceExists(row: unknown): boolean {
  const info = processDataSetInformation(row);
  const traces = ensureArray(
    isRecord(info?.["common:other"])
      ? info["common:other"]["tiangongfoundry:sourceExchangeCompleteness"]
      : undefined,
  );
  return traces.some((trace) => {
    const record = isRecord(trace) ? trace : {};
    return [
      "source_only_output_exchange_verified",
      "accepted_source_only_output",
      "verified",
    ].includes(asText(record.status ?? record.decision_status ?? record.decisionStatus));
  });
}

function sourceRowsByIdentity(sourceRows: unknown[]): SourceRowsByIdentity {
  const byIdentity: SourceRowsByIdentity = new Map();
  sourceRows.forEach((row, index) => {
    const identity = datasetIdentity(row, index, "process");
    byIdentity.set(`${identity.id}@@${identity.version}`, {
      row,
      index,
      identity,
    });
    if (!byIdentity.has(identity.id)) {
      byIdentity.set(identity.id, { row, index, identity });
    }
  });
  return byIdentity;
}

export function applyDeterministicSourceExchangeCompletenessProofs(
  row: unknown,
  datasetType: string,
  {
    rowIndex,
    sourceRowsByKey,
    sourceRowsFile,
    rowsFile,
    proofRows,
  }: SourceExchangeProofOptions = {},
): boolean {
  if (datasetType !== "process" || !sourceRowsByKey) return false;
  if (acceptedSourceExchangeTraceExists(row)) return false;
  const identity = datasetIdentity(row, rowIndex ?? 0, "process");
  const sourceEntry =
    sourceRowsByKey.get(`${identity.id}@@${identity.version}`) ?? sourceRowsByKey.get(identity.id);
  if (!sourceEntry) return false;
  const proof = outputOnlyExchangeProofCandidate({
    row,
    sourceRow: sourceEntry.row,
  });
  if (!proof) return false;
  const info = processDataSetInformation(row);
  if (!info) return false;
  const commonOther = isRecord(info["common:other"]) ? info["common:other"] : {};
  commonOther["@xmlns:tiangongfoundry"] =
    commonOther["@xmlns:tiangongfoundry"] ?? foundryTraceNamespace;
  const trace = {
    status: "source_only_output_exchange_verified",
    action_item_code: "semantic_process_only_output_exchange_requires_review",
    source: "foundry_deterministic_cleanup",
    summary:
      "Foundry verified that the source process row itself contains only Output exchanges and that the final row preserves the non-flow-reference exchange signature.",
    evidence: {
      source: "foundry_deterministic_cleanup",
      source_rows_file: sourceRowsFile || null,
      rows_file: rowsFile || null,
      source_row_index: sourceEntry.index,
      final_row_index: rowIndex ?? null,
      field_path: "processDataSet.exchanges.exchange",
      quote_or_trace:
        "Source and final exchange lists are Output-only, have the same length, and have matching exchange signatures after excluding allowed referenceToFlowDataSet rewrites.",
      exchange_count: proof.exchange_count,
      directions: proof.directions,
      source_exchange_signature_hash: proof.source_exchange_signature_hash,
      final_exchange_signature_hash: proof.final_exchange_signature_hash,
      proof_kind: "source_output_only_non_flow_reference_exchange_signature_match",
    },
  };
  const traceHash = sha256Text(JSON.stringify(trace));
  const existing = commonOther["tiangongfoundry:sourceExchangeCompleteness"];
  if (existing === undefined) {
    commonOther["tiangongfoundry:sourceExchangeCompleteness"] = [trace];
  } else if (Array.isArray(existing)) {
    existing.push(trace);
  } else {
    commonOther["tiangongfoundry:sourceExchangeCompleteness"] = [existing, trace];
  }
  info["common:other"] = commonOther;
  proofRows?.push({
    dataset_type: "process",
    dataset_id: identity.id,
    version: identity.version,
    row_index: rowIndex ?? null,
    source_row_index: sourceEntry.index,
    status: trace.status,
    trace_hash: traceHash,
    source_rows_file: sourceRowsFile || null,
    rows_file: rowsFile || null,
    source_exchange_signature_hash: proof.source_exchange_signature_hash,
    final_exchange_signature_hash: proof.final_exchange_signature_hash,
    exchange_count: proof.exchange_count,
    directions: proof.directions,
  });
  return true;
}

export function buildSourceRowsByIdentity(sourceRows: unknown[]): SourceRowsByIdentity {
  return sourceRowsByIdentity(sourceRows);
}

function appendImportTraceSummary(commonOther: JsonRecord, sourceTrace: unknown): void {
  commonOther["@xmlns:tiangongfoundry"] =
    commonOther["@xmlns:tiangongfoundry"] ?? foundryTraceNamespace;
  const summary = {
    "@sourceExtension": "tidasimport:sourceTrace",
    "@status": "externalized_before_remote_write",
    traceHash: sha256Json(sourceTrace),
    note: "Original import trace was captured in the Foundry AI authoring package and removed from the write payload.",
  };
  const existing = commonOther["tiangongfoundry:importTraceSummary"];
  if (existing === undefined) {
    commonOther["tiangongfoundry:importTraceSummary"] = summary;
  } else if (Array.isArray(existing)) {
    existing.push(summary);
  } else {
    commonOther["tiangongfoundry:importTraceSummary"] = [existing, summary];
  }
}

export function externalizeImportTraceMetadata(value: unknown): {
  removed: number;
  summaries: number;
} {
  let removed = 0;
  let summaries = 0;
  const visit = (node: unknown): void => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }

    if (!isRecord(node)) return;
    const commonOther = node["common:other"];
    if (isRecord(commonOther)) {
      if (Object.hasOwn(commonOther, "tidasimport:sourceTrace")) {
        appendImportTraceSummary(commonOther, commonOther["tidasimport:sourceTrace"]);
        delete commonOther["tidasimport:sourceTrace"];
        removed += 1;
        summaries += 1;
      }
      if (Object.hasOwn(commonOther, "@xmlns:tidasimport")) {
        delete commonOther["@xmlns:tidasimport"];
      }
      if (Object.keys(commonOther).length === 0) {
        delete node["common:other"];
      }
    }

    for (const child of Object.values(node)) visit(child);
  };
  visit(value);
  return { removed, summaries };
}

export function ensureFoundryTraceNamespaces(value: unknown): number {
  let added = 0;
  const visit = (node: unknown): void => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }

    if (!isRecord(node)) return;
    const commonOther = node["common:other"];
    if (isRecord(commonOther)) {
      const hasFoundryExtension = Object.keys(commonOther).some((key) =>
        key.startsWith("tiangongfoundry:"),
      );
      if (hasFoundryExtension && !Object.hasOwn(commonOther, "@xmlns:tiangongfoundry")) {
        commonOther["@xmlns:tiangongfoundry"] = foundryTraceNamespace;
        added += 1;
      }
    }

    for (const child of Object.values(node)) visit(child);
  };
  visit(value);
  return added;
}

function containsLocalSourceLocator(value: unknown): boolean {
  const text = asText(value);
  return Boolean(
    text &&
    /(?:^|["'\s])(?:\/Users\/|\/Volumes\/|\/private\/|\/tmp\/|file:\/\/|[A-Za-z]:\\)|\.zip:|LCI ecoSpold version2 Files/iu.test(
      text,
    ),
  );
}

function sanitizeTraceEvidenceValue(value: unknown, stats: LocatorStats): void {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) sanitizeTraceEvidenceValue(item, stats);
    return;
  }

  if (!isRecord(value)) return;
  for (const [key, child] of Object.entries(value)) {
    if (child && typeof child === "object") {
      sanitizeTraceEvidenceValue(child, stats);
      continue;
    }
    if (!containsLocalSourceLocator(child)) continue;

    const hash = sha256Text(String(child));
    if (localSourceLocatorKeys.has(key)) {
      delete value[key];
    } else {
      value[key] = `redacted local source locator sha256:${hash}`;
    }
    value.source_locator_sha256 = value.source_locator_sha256 ?? hash;
    value.source_locator_status = value.source_locator_status ?? "redacted_before_remote_write";
    stats.redacted += 1;
  }
}

export function sanitizeFoundryTraceEvidenceLocators(value: unknown): number {
  const stats = { redacted: 0 };
  const visit = (node: unknown): void => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }

    if (!isRecord(node)) return;
    const commonOther = node["common:other"];
    if (isRecord(commonOther)) {
      for (const traceKey of foundryTraceKeys) {
        for (const traceEntry of ensureArray(commonOther[traceKey])) {
          if (!traceEntry || typeof traceEntry !== "object" || Array.isArray(traceEntry)) {
            continue;
          }
          const record = traceEntry as JsonRecord;
          const evidence = record.evidence ?? record.source_evidence ?? record.sourceEvidence;
          sanitizeTraceEvidenceValue(evidence, stats);
        }
      }
    }

    for (const child of Object.values(node)) visit(child);
  };
  visit(value);
  return stats.redacted;
}

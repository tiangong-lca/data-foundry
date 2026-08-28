export type JsonRecord = Record<string, unknown>;

export interface CurationGateBlockerInput {
  finalizeReport: JsonRecord;
  gateReport: JsonRecord | null;
}

export interface GateBlockerResult {
  gateReport: JsonRecord | null;
  blockers: JsonRecord[];
}

export type PostWriteVerifyReportInput =
  { availability: "missing" } | { availability: "available"; report: JsonRecord };

function isJsonRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function jsonRecord(value: unknown): JsonRecord {
  return isJsonRecord(value) ? value : {};
}

function scalarText(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

function reportCodeText(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (isJsonRecord(value)) {
    return scalarText(value["#text"]) || scalarText(value.value);
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const text = reportCodeText(item);
      if (text) return text;
    }
  }
  return "";
}

function collectReportCodes(
  value: unknown,
  codes: Set<string> = new Set(),
  depth = 0,
): Set<string> {
  if (value == null || depth > 6) return codes;
  if (Array.isArray(value)) {
    for (const entry of value) collectReportCodes(entry, codes, depth + 1);
    return codes;
  }
  if (typeof value !== "object") return codes;
  const record = jsonRecord(value);
  for (const key of ["code", "failure_code", "status_code", "readback_status"]) {
    const text = reportCodeText(record[key]);
    if (text) codes.add(text);
  }
  for (const key of ["blockers", "findings", "checks", "results", "rows", "items"]) {
    collectReportCodes(record[key], codes, depth + 1);
  }
  return codes;
}

export function reportCodes(value: unknown): string[] {
  return [...collectReportCodes(value)];
}

const postWriteVerifyRetryableCodes = [
  "lookup_failed",
  "remote_lookup_failed",
  "readback_failed",
  "remote_readback_failed",
  "remote_readback_missing",
  "root_readback_incomplete",
  "post_write_verify_root_readback_incomplete",
  "verify_report_missing",
] as const;

export function postWriteVerifyRetryReasonFromReport(
  input: PostWriteVerifyReportInput,
): string | null {
  if (input.availability === "missing") return "verify_report_missing";
  const retryableCodes = new Set<string>(postWriteVerifyRetryableCodes);
  for (const code of reportCodes(input.report)) {
    if (retryableCodes.has(code)) return code;
  }
  const counts = jsonRecord(input.report.counts);
  const byStatus = jsonRecord(counts.by_status || counts.statuses);
  for (const code of postWriteVerifyRetryableCodes) {
    if (Number(byStatus[code] ?? 0) > 0) return code;
  }
  return null;
}

export function curationGateBlockers({
  finalizeReport,
  gateReport,
}: CurationGateBlockerInput): GateBlockerResult {
  const blockers: JsonRecord[] = [];
  if (!gateReport) {
    if (finalizeReport.status === "ready_for_remote_write") {
      blockers.push({
        code: "curation_gate_report_missing",
        severity: "error",
        message: "Ready BAFU process scope is missing a readable curation gate report.",
      });
    }
    return { gateReport: null, blockers };
  }
  const counts = jsonRecord(gateReport.counts);
  const actionItems = Number(counts.action_items ?? 0);
  if (actionItems > 0) {
    blockers.push({
      code: "unresolved_ai_curation_items",
      severity: "error",
      message:
        "BAFU process scope still has unresolved AI curation action items; rerun authoring/apply stages before write planning.",
      action_items: actionItems,
      identity_action_items: Number(counts.identity_action_items ?? 0),
      semantic_action_items: Number(counts.semantic_action_items ?? 0),
      classification_queue_action_items: Number(counts.classification_queue_action_items ?? 0),
      location_queue_action_items: Number(counts.location_queue_action_items ?? 0),
      examples: (Array.isArray(gateReport.entities)
        ? gateReport.entities
        : Array.isArray(gateReport.processes)
          ? gateReport.processes
          : []
      )
        .map(jsonRecord)
        .filter((entity) => Number(entity.action_item_count ?? 0) > 0)
        .slice(0, 5)
        .map((entity) => ({
          dataset_type: entity.dataset_type,
          dataset_id: entity.entity_id ?? entity.process_id,
          action_item_count: entity.action_item_count,
          authoring_package: entity.authoring_package,
        })),
    });
  }
  const deterministicCleanupItems = Number(counts.deterministic_cleanup_items ?? 0);
  if (deterministicCleanupItems > 0) {
    blockers.push({
      code: "unresolved_deterministic_curation_items",
      severity: "error",
      message:
        "BAFU process scope still has deterministic cleanup items; rerun cleanup/finalize before write planning.",
      deterministic_cleanup_items: deterministicCleanupItems,
    });
  }
  if (!["ready", "ready_with_profile_waivers"].includes(String(gateReport.status))) {
    blockers.push({
      code: "curation_gate_not_ready",
      severity: "error",
      message: `Post-authoring curation gate status is ${gateReport.status || "missing"}.`,
      curation_gate_status: gateReport.status ?? null,
    });
  }
  return { gateReport, blockers };
}

export function canRunPostFinalizeIdentityRecovery(gateReport: JsonRecord | null): boolean {
  if (!gateReport) return false;
  const counts = jsonRecord(gateReport.counts);
  return (
    Number(counts.identity_action_items ?? 0) > 0 &&
    Number(counts.semantic_action_items ?? 0) === 0 &&
    Number(counts.classification_queue_action_items ?? 0) === 0 &&
    Number(counts.location_queue_action_items ?? 0) === 0
  );
}

export function canRunPostFinalizeSemanticRecovery(gateReport: JsonRecord | null): boolean {
  if (!gateReport) return false;
  const counts = jsonRecord(gateReport.counts);
  return (
    Number(counts.semantic_action_items ?? 0) > 0 &&
    Number(counts.identity_action_items ?? 0) === 0 &&
    Number(counts.classification_queue_action_items ?? 0) === 0 &&
    Number(counts.location_queue_action_items ?? 0) === 0
  );
}

export function finalizeBlockers(finalizeReport: JsonRecord): JsonRecord[] {
  const blockers: JsonRecord[] = [];
  const commitHandoff = jsonRecord(finalizeReport.commit_handoff);
  if (finalizeReport.status !== "ready_for_remote_write") {
    blockers.push({
      code: "post_authoring_finalize_not_ready",
      severity: "error",
      message: `Post-authoring finalize status is ${finalizeReport.status || "missing"}.`,
      finalize_status: finalizeReport.status ?? null,
    });
  }
  if (commitHandoff.status !== "ready_for_explicit_commit") {
    blockers.push({
      code: "commit_handoff_not_ready",
      severity: "error",
      message: `Commit handoff status is ${commitHandoff.status || "missing"}.`,
      commit_handoff_status: commitHandoff.status ?? null,
      commit_handoff_blockers: commitHandoff.blockers ?? [],
    });
  }
  return blockers.concat(
    Array.isArray(finalizeReport.blockers) ? finalizeReport.blockers.map(jsonRecord) : [],
  );
}

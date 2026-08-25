import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { bundleRowTypes } from "./bundle-row-types.ts";

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonRecord | JsonValue[];
export interface JsonRecord {
  [key: string]: JsonValue | undefined;
}

export type LedgerDatasetType = keyof typeof bundleRowTypes | "support" | "unknown";
export type BlockerBucket =
  | "elementary-flow"
  | "canonical-support"
  | "classification"
  | "content-saturation"
  | "reference-closure"
  | "identity"
  | "remote-write"
  | "other";

export interface DatasetIdentity {
  id?: string | null;
  version?: string | null;
}

export interface BlockingDependency extends JsonRecord {
  dataset_type?: string | null;
  id?: string | null;
  version?: string | null;
  path?: string | null;
}

export interface ImportLedgerBlocker extends JsonRecord {
  code?: string | null;
  stage?: string | null;
  message?: string | null;
  dataset_type?: string | null;
  blocking_dependency?: BlockingDependency;
  reference_type?: string | null;
  table?: string | null;
  reference_id?: string | null;
  entity_id?: string | null;
  id?: string | null;
  reference_version?: string | null;
  version?: string | null;
  path?: string | null;
}

export interface ImportLedgerDependencies {
  asText: (value: unknown) => string;
  datasetIdentity: (payload: JsonValue, datasetType: string) => DatasetIdentity;
  fileExists: (filePath: string) => boolean;
  nowIso: () => string;
  readJson: (filePath: string) => JsonValue;
  readJsonLines: (filePath: string) => JsonValue[];
  repoRelativePath: (filePath: string) => string;
  resolveRepoPath: (filePath: unknown) => string | null;
  writeJson: (filePath: string, value: JsonValue) => void;
}

export interface ImportLedgerManifest extends JsonRecord {
  schema_version: 1;
  created_at_utc: string;
  updated_at_utc: string;
  ledger_dir: string;
  event_kinds: string[];
  latest_report: string | null;
  files: Record<string, string>;
  contract: {
    ok_prefix: "ok.*.verified.jsonl";
    blocked_prefix: "blocked.*.jsonl";
    retry_prefix: "retry.*.jsonl";
    resume_prefix: "resume.*.jsonl";
    append_only: true;
    dedup_key: "ledger_key";
  };
}

interface ImportLedgerRowBase extends JsonRecord {
  schema_version: 1;
  ledger_kind: "ok" | "blocked" | "resume";
  status: string;
  ledger_key?: string;
}

export interface VerifiedImportLedgerRow extends ImportLedgerRowBase {
  ledger_kind: "ok";
  status: "verified";
  verified_at_utc: string;
  row_index: number;
  row_dataset_type: string;
  dataset_id: string | null;
  version: string | null;
  payload_hash: string;
  dataset_key: string;
  scope_key: string;
  ledger_key: string;
  scope_dataset_type?: string | null;
  profile?: string | null;
  target_user_id?: string | null;
  expected_state_code?: number | null;
  final_rows_file?: string | null;
  finalize_report?: string | null;
  mutation_manifest?: string | null;
  commit_report?: string | null;
  post_write_verify_report?: string | null;
  closeout_report?: string | null;
  root_payload_mismatches?: number;
}

export interface BlockedScopeImportLedgerRow extends ImportLedgerRowBase {
  ledger_kind: "blocked";
  status: "blocked_human_review";
  blocked_at_utc: string;
  scope_dataset_type: string | null;
  scope_ids: string[];
  scope_versions: string[];
  scope_key: string;
  blocker_codes: string[];
  blocker_count: number;
  required_human_action: string;
  ledger_key: string;
  profile?: string | null;
  final_rows_file?: string | null;
  finalize_report?: string | null;
  mutation_manifest?: string | null;
  closeout_report?: string | null;
  curation_gate_report?: string | null;
  commit_handoff_plan?: string | null;
  rerun_command?: string | null;
}

export interface BlockedDependencyImportLedgerRow extends ImportLedgerRowBase {
  ledger_kind: "blocked";
  status: "blocked_human_review";
  blocked_at_utc: string;
  blocker_bucket: BlockerBucket;
  reason_code: string;
  message?: string | null;
  blocking_stage?: string | null;
  scope_dataset_type: string | null;
  scope_ids: string[];
  scope_key: string;
  blocking_dependency: BlockingDependency;
  required_human_action: string;
  ledger_key: string;
  final_rows_file?: string | null;
  finalize_report?: string | null;
  mutation_manifest?: string | null;
  closeout_report?: string | null;
  raw_blocker?: JsonValue;
}

export interface RetryImportLedgerRow extends BlockedDependencyImportLedgerRow {}

export interface ResumePendingImportLedgerRow extends JsonRecord {
  schema_version: 1;
  ledger_kind: "resume";
  status: "pending_human_review";
  source_ledger_key: string | null;
  scope_key: string | null;
  scope_dataset_type: string | null;
  scope_ids: string[];
  blocker_codes: string[];
  blocker_count?: number | null;
  required_human_action?: string | null;
  final_rows_file?: string | null;
  finalize_report?: string | null;
  rerun_command?: string | null;
}

export interface ResumeSkippedImportLedgerRow extends JsonRecord {
  schema_version: 1;
  ledger_kind: "resume";
  status: "skipped_verified";
  source_ledger_key: string | null;
  dataset_key: string | null;
  row_dataset_type: string | null;
  dataset_id: string | null;
  version: string | null;
  verified_at_utc?: string | null;
  closeout_report?: string | null;
}

export type ImportLedgerRow =
  | VerifiedImportLedgerRow
  | BlockedScopeImportLedgerRow
  | BlockedDependencyImportLedgerRow
  | RetryImportLedgerRow
  | ResumePendingImportLedgerRow
  | ResumeSkippedImportLedgerRow;

interface ReportArtifactFields extends JsonRecord {
  dataset_type?: string | null;
  profile?: string | null;
  final_rows_file?: string | null;
  rows_file?: string | null;
  finalize_report?: string | null;
  mutation_manifest?: string | null;
}

export interface CompletedCloseoutReport extends ReportArtifactFields {
  status: "completed";
  target_user_id?: string | null;
  expected_state_code?: number | null;
  commit_report?: string | null;
  post_write_verify_report?: string | null;
  counts?: { root_payload_mismatches?: number };
}

export interface BlockedCloseoutReport extends ReportArtifactFields {
  status: "blocked" | "failed";
  blockers?: ImportLedgerBlocker[];
}

export type CloseoutReport = CompletedCloseoutReport | BlockedCloseoutReport;

export interface FinalizeArtifactFiles extends JsonRecord {
  curation_gate_report?: string | null;
  mutation_manifest?: string | null;
  commit_handoff_plan?: string | null;
}

export interface ReadyFinalizeReport extends ReportArtifactFields {
  status: "ready_for_remote_write" | "ready_reference_only";
}

export interface BlockedFinalizeReport extends ReportArtifactFields {
  status: "blocked" | "failed";
  blockers?: ImportLedgerBlocker[];
  files?: FinalizeArtifactFiles;
}

export type FinalizeReport = ReadyFinalizeReport | BlockedFinalizeReport;

export interface CloseoutLedgerWriteOptions {
  report: CloseoutReport | null;
  reportPath: string;
  ledgerDir: string | null;
}

export interface FinalizeLedgerWriteOptions {
  report: FinalizeReport | null;
  reportPath: string;
  ledgerDir: string | null;
}

export interface LedgerWriteCounts extends JsonRecord {
  entries_written: number;
  entries_skipped_existing?: number;
  blockers?: number;
  blocked_scopes?: number;
  rows?: number;
}

export interface SkippedImportLedgerWriteResult {
  status: "skipped";
  reason:
    | "ledger_dir_missing"
    | "report_missing"
    | "closeout_not_completed_without_blockers"
    | "finalize_ready"
    | "no_blockers";
  files: Record<string, never>;
  counts: { entries_written: 0 };
}

export interface CompletedImportLedgerWriteResult {
  status: "completed";
  files: Record<string, string>;
  counts: LedgerWriteCounts;
}

export type ImportLedgerWriteResult =
  SkippedImportLedgerWriteResult | CompletedImportLedgerWriteResult;

export interface DatasetImportLedgerReportOptions {
  help?: boolean;
  ledgerDir?: string;
  importLedgerDir?: string;
  outDir?: string;
}

export interface DatasetImportLedgerHelpReport {
  schema_version: 1;
  status: "help";
  command: "dataset-import-ledger-report";
  usage: string[];
  purpose: string;
  remote_write_mode: "read-only";
}

export interface DatasetImportLedgerReport extends JsonRecord {
  schema_version: 1;
  generated_at_utc: string;
  status: "completed" | "completed_with_blocked_scopes";
  ledger_dir: string;
  remote_write_mode: "read-only";
  policy: { resume_boundary: string };
  counts: {
    ok_rows: number;
    blocked_rows: number;
    retry_rows: number;
    resume_rows: number;
    skipped_verified_rows: number;
  };
  files: {
    report: string;
    resume_plan: string;
    resume_skipped_verified: string;
  };
}

export interface ImportLedgerUtils {
  runDatasetImportLedgerReport: (
    options: DatasetImportLedgerReportOptions,
  ) => DatasetImportLedgerHelpReport | DatasetImportLedgerReport;
  writeCloseoutImportLedger: (options: CloseoutLedgerWriteOptions) => ImportLedgerWriteResult;
  writeFinalizeImportLedger: (options: FinalizeLedgerWriteOptions) => ImportLedgerWriteResult;
}

interface RowIdentity {
  payload: JsonValue;
  dataset_type: string;
  dataset_id: string | null;
  version: string | null;
  payload_hash: string;
}

interface AppendJsonLinesResult {
  file: string;
  appended: number;
  skipped_existing: number;
}

interface ManifestUpdateOptions {
  ledgerDir: string;
  eventKind: string;
  files?: Record<string, string | null | undefined>;
  reportPath?: string | null;
}

interface NormalizedBlockerInput {
  raw: JsonValue;
  blocker: ImportLedgerBlocker;
}

const LEDGER_FILES = {
  manifest: "run-manifest.json",
  okScopes: "ok.scopes.verified.jsonl",
  blockedScopes: "blocked.scopes.human-review.jsonl",
  resumePlan: "resume.plan.jsonl",
  resumeSkipped: "resume.skipped-verified.jsonl",
  report: "dataset-import-ledger-report.json",
};

const BLOCKER_BUCKETS = [
  "elementary-flow",
  "canonical-support",
  "classification",
  "content-saturation",
  "reference-closure",
  "identity",
  "remote-write",
  "other",
];

function sha256(value: unknown): string {
  return createHash("sha256")
    .update(String(value ?? ""))
    .digest("hex");
}

function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

function jsonLine(row: JsonRecord): string {
  return `${JSON.stringify(row)}\n`;
}

function readJsonLinesIfExists<T extends JsonRecord = JsonRecord>(filePath: string | null): T[] {
  if (!filePath || !fs.existsSync(filePath)) return [];
  const text = fs.readFileSync(filePath, "utf8").trim();
  return text ? text.split(/\r?\n/u).map((line) => JSON.parse(line) as T) : [];
}

function writeJsonLinesFile(filePath: string, rows: readonly JsonRecord[]): void {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(
    filePath,
    rows.map((row) => JSON.stringify(row)).join("\n") + (rows.length ? "\n" : ""),
  );
}

function appendJsonLinesDedup<T extends JsonRecord & { ledger_key?: string }>(
  filePath: string,
  rows: readonly T[],
): AppendJsonLinesResult {
  ensureDir(path.dirname(filePath));
  const seen = new Set(
    readJsonLinesIfExists<T>(filePath)
      .map((row) => String(row?.ledger_key ?? ""))
      .filter(Boolean),
  );
  const pending: T[] = [];
  for (const row of rows) {
    const key = String(row?.ledger_key ?? "");
    if (!key || seen.has(key)) continue;
    seen.add(key);
    pending.push(row);
  }
  if (pending.length > 0) {
    fs.appendFileSync(filePath, pending.map(jsonLine).join(""));
  }
  return {
    file: filePath,
    appended: pending.length,
    skipped_existing: rows.length - pending.length,
  };
}

function supportPluralForType(datasetType: string): string {
  return (
    (bundleRowTypes as Record<string, { plural: string }>)[datasetType]?.plural ??
    `${datasetType || "unknown"}s`
  );
}

function isJsonRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizedBlockerInputs(value: unknown): NormalizedBlockerInput[] {
  if (!Array.isArray(value)) return [];
  return value.map((raw) => ({
    raw: raw as JsonValue,
    blocker: isJsonRecord(raw) ? (raw as ImportLedgerBlocker) : {},
  }));
}

function rowPayload(row: JsonValue): JsonValue {
  return isJsonRecord(row) && isJsonRecord(row.payload) ? row.payload : row;
}

function inferRowDatasetType(payload: JsonValue, fallbackType: unknown): string {
  for (const [datasetType, config] of Object.entries(bundleRowTypes)) {
    if (isJsonRecord(payload) && payload[config.rootKey]) return datasetType;
  }
  return fallbackType === "support"
    ? "support"
    : typeof fallbackType === "string" && fallbackType
      ? fallbackType
      : "unknown";
}

function rowsFromValue(value: JsonValue): JsonValue[] {
  if (Array.isArray(value)) return value;
  if (isJsonRecord(value) && Array.isArray(value.rows)) return value.rows;
  if (isJsonRecord(value) && Array.isArray(value.items)) return value.items;
  return value && typeof value === "object" ? [value] : [];
}

function blockerBucket(blocker: ImportLedgerBlocker): BlockerBucket {
  const text = [
    blocker?.code,
    blocker?.stage,
    blocker?.message,
    blocker?.dataset_type,
    blocker?.blocking_dependency?.dataset_type,
    blocker?.reference_type,
    blocker?.table,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  if (/(elementary|flow_?elementary)/u.test(text)) return "elementary-flow";
  if (
    /(canonical_?support|flow_?property|flowproperty|unit_?group|unitgroup|reference_only_support)/u.test(
      text,
    )
  ) {
    return "canonical-support";
  }
  if (/classification/u.test(text)) return "classification";
  if (/(identity|preflight|candidate)/u.test(text)) return "identity";
  if (/(remote_write|commit|post_write|readback|write failure|save-draft|publish)/u.test(text)) {
    return "remote-write";
  }
  if (
    /(reference_closure|reference closure|remote_verify|verify_remote|unproven|source|contact)/u.test(
      text,
    )
  ) {
    return "reference-closure";
  }
  if (
    /(saturation|full_context|semantic|curation|location|name_plan|synonym|placeholder|authoring)/u.test(
      text,
    )
  ) {
    return "content-saturation";
  }
  return "other";
}

function humanActionForBlocker(blocker: ImportLedgerBlocker): string {
  const bucket = blockerBucket(blocker);
  const code = String(blocker?.code ?? "").toLowerCase();
  if (bucket === "classification") {
    return "Produce full-context semantic classification decisions and apply them through the deterministic classification-decision command, then rerun finalize.";
  }
  if (bucket === "elementary-flow") {
    return "Resolve physical-equivalence evidence against an existing canonical elementary flow, or keep the affected scope blocked for human review.";
  }
  if (bucket === "canonical-support") {
    return "Map the generated flowproperty/unitgroup support reference to an existing canonical support row, or add database governance data before rerun.";
  }
  if (bucket === "reference-closure") {
    return "Commit and verify the referenced writable source/contact/flow scope first, or replace placeholder references with true canonical provenance.";
  }
  if (bucket === "identity") {
    return code.includes("timeout")
      ? "Retry only the failed identity/preflight request rows, then merge the refreshed index and rerun finalize."
      : "Produce or refresh exact-payload identity reuse decisions, then rerun finalize.";
  }
  if (bucket === "content-saturation") {
    return "Patch provable schema fields from full context in one AI completion pass, apply deterministically, then rerun validation and finalize.";
  }
  if (bucket === "remote-write") {
    return "Inspect the CLI commit/readback artifact, repair the write or account guard issue, then rerun closeout for the same final rows.";
  }
  return "Review the blocker evidence, repair the affected dependency or row content, and rerun only the affected scope.";
}

export function createImportLedgerUtils({
  asText,
  datasetIdentity,
  fileExists,
  nowIso,
  readJson,
  readJsonLines,
  repoRelativePath,
  resolveRepoPath,
  writeJson,
}: ImportLedgerDependencies): ImportLedgerUtils {
  function relativeInput(value: unknown): string | null {
    const resolved = resolveRepoPath(value);
    return resolved ? repoRelativePath(resolved) : null;
  }

  function readRowsFileMaybe(filePath: unknown): JsonValue[] {
    const resolved = resolveRepoPath(filePath);
    if (!resolved || !fileExists(resolved)) return [];
    if (resolved.toLowerCase().endsWith(".jsonl")) return readJsonLines(resolved);
    return rowsFromValue(readJson(resolved));
  }

  function rowIdentity(row: JsonValue, fallbackType: unknown): RowIdentity {
    const payload = rowPayload(row);
    const datasetType = inferRowDatasetType(payload, fallbackType);
    const identity =
      datasetType && datasetType !== "support" ? datasetIdentity(payload, datasetType) : {};
    const rowRecord = isJsonRecord(row) ? row : {};
    return {
      payload,
      dataset_type: datasetType,
      dataset_id:
        identity.id ||
        asText(rowRecord.dataset_id) ||
        asText(rowRecord.id) ||
        asText(rowRecord.entity_id) ||
        null,
      version: identity.version || asText(rowRecord.version) || null,
      payload_hash: sha256(JSON.stringify(payload ?? row ?? null)),
    };
  }

  function updateManifest({
    ledgerDir,
    eventKind,
    files = {},
    reportPath = null,
  }: ManifestUpdateOptions): string {
    ensureDir(ledgerDir);
    const manifestPath = path.join(ledgerDir, LEDGER_FILES.manifest);
    const previous = (
      fs.existsSync(manifestPath) ? readJson(manifestPath) : {}
    ) as Partial<ImportLedgerManifest>;
    const previousEventKinds = previous.event_kinds ?? [];
    const previousFiles = previous.files ?? {};
    const manifest: ImportLedgerManifest = {
      schema_version: 1,
      created_at_utc: previous.created_at_utc ?? nowIso(),
      updated_at_utc: nowIso(),
      ledger_dir: repoRelativePath(ledgerDir),
      event_kinds: [...new Set([...previousEventKinds, eventKind].filter(Boolean))],
      latest_report: reportPath ? repoRelativePath(reportPath) : (previous.latest_report ?? null),
      files: {
        ...previousFiles,
        ...Object.fromEntries(
          Object.entries(files)
            .filter(([, file]) => file)
            .map(([key, file]) => [key, repoRelativePath(file!)]),
        ),
      },
      contract: {
        ok_prefix: "ok.*.verified.jsonl",
        blocked_prefix: "blocked.*.jsonl",
        retry_prefix: "retry.*.jsonl",
        resume_prefix: "resume.*.jsonl",
        append_only: true,
        dedup_key: "ledger_key",
      },
    };
    writeJson(manifestPath, manifest);
    return manifestPath;
  }

  function writeCloseoutImportLedger({
    report,
    reportPath,
    ledgerDir,
  }: CloseoutLedgerWriteOptions): ImportLedgerWriteResult {
    if (!ledgerDir || !report) {
      return {
        status: "skipped",
        reason: !ledgerDir ? "ledger_dir_missing" : "report_missing",
        files: {},
        counts: { entries_written: 0 },
      };
    }
    if (report.status !== "completed") {
      const blockerInputs = normalizedBlockerInputs(report.blockers);
      const blockers = blockerInputs.map(({ blocker }) => blocker);
      if (blockers.length === 0) {
        return {
          status: "skipped",
          reason: "closeout_not_completed_without_blockers",
          files: {},
          counts: { entries_written: 0 },
        };
      }
      const generatedAt = nowIso();
      const rowIdentities = readRowsFileMaybe(report.final_rows_file).map((row) =>
        rowIdentity(row, report.dataset_type),
      );
      const scopeKey = `${report.dataset_type ?? "unknown"}:${relativeInput(report.final_rows_file) ?? repoRelativePath(reportPath)}`;
      const scopeIds = rowIdentities
        .map((identity) => identity.dataset_id)
        .filter((value): value is string => Boolean(value));
      const scopeVersions = rowIdentities
        .map((identity) => identity.version)
        .filter((value): value is string => Boolean(value));
      const blockerCodes = blockers
        .map((blocker) => blocker.code)
        .filter((value): value is string => Boolean(value));
      const uniqueBlockerCodes = [...new Set(blockerCodes)];
      const summaryRow: BlockedScopeImportLedgerRow = {
        schema_version: 1,
        ledger_kind: "blocked",
        status: "blocked_human_review",
        blocked_at_utc: generatedAt,
        scope_dataset_type: report.dataset_type ?? null,
        profile: report.profile ?? null,
        scope_ids: [...new Set(scopeIds)],
        scope_versions: [...new Set(scopeVersions)],
        scope_key: scopeKey,
        blocker_codes: uniqueBlockerCodes,
        blocker_count: blockers.length,
        required_human_action:
          "Repair the commit/readback/account guard blocker for this exact final rows scope, then rerun post-write verification and closeout.",
        final_rows_file: relativeInput(report.final_rows_file),
        finalize_report: relativeInput(report.finalize_report),
        mutation_manifest: relativeInput(report.mutation_manifest),
        closeout_report: repoRelativePath(reportPath),
        rerun_command: `node scripts/foundry.ts dataset-post-write-closeout --handoff-plan <dataset-commit-handoff-plan.json> --commit-report <commit-report.json> --post-write-verify-report <remote-verification-report.json> --ledger-dir ${repoRelativePath(ledgerDir)}`,
        ledger_key: `blocked:closeout:${scopeKey}:${sha256(
          JSON.stringify(uniqueBlockerCodes),
        )}:${repoRelativePath(reportPath)}`,
      };
      const dependencyRows: BlockedDependencyImportLedgerRow[] = blockerInputs.map(
        ({ blocker, raw }, index) => {
          const bucket =
            blockerBucket(blocker) === "other" ? "remote-write" : blockerBucket(blocker);
          const reasonCode = blocker.code ?? "closeout_blocker";
          return {
            schema_version: 1,
            ledger_kind: "blocked",
            status: "blocked_human_review",
            blocked_at_utc: generatedAt,
            blocker_bucket: bucket,
            reason_code: reasonCode,
            message: blocker.message ?? null,
            blocking_stage: "post_write_closeout",
            scope_dataset_type: report.dataset_type ?? null,
            scope_ids: summaryRow.scope_ids,
            scope_key: summaryRow.scope_key,
            blocking_dependency: {
              dataset_type: blocker.dataset_type ?? null,
              id: blocker.reference_id || blocker.entity_id || blocker.id || null,
              version: blocker.reference_version || blocker.version || null,
              path: blocker.path ?? null,
            },
            required_human_action: humanActionForBlocker({
              ...blocker,
              code: blocker.code ?? "remote_write_blocker",
            }),
            final_rows_file: summaryRow.final_rows_file,
            closeout_report: repoRelativePath(reportPath),
            raw_blocker: raw,
            ledger_key: `blocked:closeout-dependency:${bucket}:${reasonCode}:${summaryRow.scope_key}:${index}:${repoRelativePath(reportPath)}`,
          };
        },
      );
      const writes: AppendJsonLinesResult[] = [
        appendJsonLinesDedup(path.join(ledgerDir, LEDGER_FILES.blockedScopes), [summaryRow]),
      ];
      for (const bucket of BLOCKER_BUCKETS) {
        const bucketRows = dependencyRows.filter((row) => row.blocker_bucket === bucket);
        if (bucketRows.length === 0) continue;
        writes.push(
          appendJsonLinesDedup(
            path.join(ledgerDir, `blocked.dependencies.${bucket}.jsonl`),
            bucketRows,
          ),
        );
      }
      const manifestPath = updateManifest({
        ledgerDir,
        eventKind: "post_write_closeout_blocked",
        files: { blocked_scopes: path.join(ledgerDir, LEDGER_FILES.blockedScopes) },
        reportPath,
      });
      return {
        status: "completed",
        files: {
          manifest: repoRelativePath(manifestPath),
          blocked_scopes: repoRelativePath(path.join(ledgerDir, LEDGER_FILES.blockedScopes)),
        },
        counts: {
          blockers: blockers.length,
          blocked_scopes: 1,
          entries_written: writes.reduce((total, write) => total + write.appended, 0),
          entries_skipped_existing: writes.reduce(
            (total, write) => total + write.skipped_existing,
            0,
          ),
        },
      };
    }
    const rows = readRowsFileMaybe(report.final_rows_file);
    const generatedAt = nowIso();
    const common = {
      schema_version: 1 as const,
      ledger_kind: "ok" as const,
      status: "verified" as const,
      verified_at_utc: generatedAt,
      scope_dataset_type: report.dataset_type ?? null,
      profile: report.profile ?? null,
      target_user_id: report.target_user_id ?? null,
      expected_state_code: report.expected_state_code ?? null,
      final_rows_file: relativeInput(report.final_rows_file),
      finalize_report: relativeInput(report.finalize_report),
      mutation_manifest: relativeInput(report.mutation_manifest),
      commit_report: relativeInput(report.commit_report),
      post_write_verify_report: relativeInput(report.post_write_verify_report),
      closeout_report: repoRelativePath(reportPath),
      root_payload_mismatches: Number(report.counts?.root_payload_mismatches ?? -1),
    };
    const ledgerRows: VerifiedImportLedgerRow[] = rows.map((row, index) => {
      const identity = rowIdentity(row, report.dataset_type);
      const datasetKey = `${identity.dataset_type}:${identity.dataset_id ?? "missing"}:${identity.version ?? "missing"}`;
      return {
        ...common,
        row_index: index,
        row_dataset_type: identity.dataset_type,
        dataset_id: identity.dataset_id,
        version: identity.version,
        payload_hash: identity.payload_hash,
        dataset_key: datasetKey,
        scope_key: `${report.dataset_type ?? identity.dataset_type}:${common.final_rows_file ?? datasetKey}`,
        ledger_key: `ok:${datasetKey}:${identity.payload_hash}:${repoRelativePath(reportPath)}`,
      };
    });
    const writes: AppendJsonLinesResult[] = [];
    writes.push(appendJsonLinesDedup(path.join(ledgerDir, LEDGER_FILES.okScopes), ledgerRows));
    for (const [datasetType, typeRows] of Map.groupBy(
      ledgerRows,
      (row) => row.row_dataset_type || "unknown",
    )) {
      writes.push(
        appendJsonLinesDedup(
          path.join(ledgerDir, `ok.${supportPluralForType(datasetType)}.verified.jsonl`),
          typeRows,
        ),
      );
    }
    const files = Object.fromEntries(
      writes.map((write) => [path.basename(write.file).replace(/[.-]/gu, "_"), write.file]),
    );
    const manifestPath = updateManifest({
      ledgerDir,
      eventKind: "post_write_closeout_verified",
      files: { ...files, ok_scopes: path.join(ledgerDir, LEDGER_FILES.okScopes) },
      reportPath,
    });
    return {
      status: "completed",
      files: {
        manifest: repoRelativePath(manifestPath),
        ok_scopes: repoRelativePath(path.join(ledgerDir, LEDGER_FILES.okScopes)),
      },
      counts: {
        rows: rows.length,
        entries_written: writes.reduce((total, write) => total + write.appended, 0),
        entries_skipped_existing: writes.reduce(
          (total, write) => total + write.skipped_existing,
          0,
        ),
      },
    };
  }

  function writeFinalizeImportLedger({
    report,
    reportPath,
    ledgerDir,
  }: FinalizeLedgerWriteOptions): ImportLedgerWriteResult {
    if (
      !ledgerDir ||
      !report ||
      report.status === "ready_for_remote_write" ||
      report.status === "ready_reference_only"
    ) {
      return {
        status: "skipped",
        reason: !ledgerDir ? "ledger_dir_missing" : "finalize_ready",
        files: {},
        counts: { entries_written: 0 },
      };
    }
    const blockerInputs = normalizedBlockerInputs(report.blockers);
    const blockers = blockerInputs.map(({ blocker }) => blocker);
    if (blockers.length === 0) {
      return {
        status: "skipped",
        reason: "no_blockers",
        files: {},
        counts: { entries_written: 0 },
      };
    }
    const rows = readRowsFileMaybe(report.final_rows_file || report.rows_file);
    const rowIdentities = rows.map((row) => rowIdentity(row, report.dataset_type));
    const scopeIds = rowIdentities
      .map((identity) => identity.dataset_id)
      .filter((value): value is string => Boolean(value));
    const scopeVersions = rowIdentities
      .map((identity) => identity.version)
      .filter((value): value is string => Boolean(value));
    const blockerCodes = blockers
      .map((blocker) => blocker.code)
      .filter((value): value is string => Boolean(value));
    const generatedAt = nowIso();
    const reportFiles = report.files as FinalizeArtifactFiles | undefined;
    const scopeKey = `${report.dataset_type ?? "unknown"}:${relativeInput(report.final_rows_file || report.rows_file) ?? sha256(JSON.stringify(scopeIds))}`;
    const uniqueBlockerCodes = [...new Set(blockerCodes)];
    const summaryRow: BlockedScopeImportLedgerRow = {
      schema_version: 1,
      ledger_kind: "blocked",
      status: "blocked_human_review",
      blocked_at_utc: generatedAt,
      scope_dataset_type: report.dataset_type ?? null,
      profile: report.profile ?? null,
      scope_ids: [...new Set(scopeIds)],
      scope_versions: [...new Set(scopeVersions)],
      scope_key: scopeKey,
      blocker_codes: uniqueBlockerCodes,
      blocker_count: blockers.length,
      required_human_action:
        "Repair the listed blocker dependencies or content fields, then rerun only this affected scope. Verified scopes in ok.* ledgers should be skipped.",
      final_rows_file: relativeInput(report.final_rows_file || report.rows_file),
      finalize_report: repoRelativePath(reportPath),
      curation_gate_report: relativeInput(reportFiles?.curation_gate_report),
      mutation_manifest: relativeInput(reportFiles?.mutation_manifest),
      commit_handoff_plan: relativeInput(reportFiles?.commit_handoff_plan),
      rerun_command: `node scripts/foundry.ts dataset-post-authoring-finalize --rows-file ${relativeInput(report.rows_file) ?? "<rows.jsonl>"} --type ${report.dataset_type ?? "<type>"} --out-dir <finalize-dir>`,
      ledger_key: `blocked:scope:${scopeKey}:${sha256(
        JSON.stringify(uniqueBlockerCodes),
      )}:${repoRelativePath(reportPath)}`,
    };

    const dependencyRows: BlockedDependencyImportLedgerRow[] = blockerInputs.map(
      ({ blocker, raw }, index) => {
        const bucket = blockerBucket(blocker);
        const reasonCode = blocker.code ?? "unknown_blocker";
        return {
          schema_version: 1,
          ledger_kind: "blocked",
          status: "blocked_human_review",
          blocked_at_utc: generatedAt,
          blocker_bucket: bucket,
          reason_code: reasonCode,
          message: blocker.message ?? null,
          blocking_stage: blocker.stage ?? null,
          scope_dataset_type: report.dataset_type ?? null,
          scope_ids: summaryRow.scope_ids,
          scope_key: summaryRow.scope_key,
          blocking_dependency: {
            dataset_type:
              blocker.blocking_dependency?.dataset_type ||
              blocker.dataset_type ||
              blocker.reference_type ||
              blocker.table ||
              null,
            id:
              blocker.blocking_dependency?.id ||
              blocker.reference_id ||
              blocker.entity_id ||
              blocker.id ||
              null,
            version:
              blocker.blocking_dependency?.version ||
              blocker.reference_version ||
              blocker.version ||
              null,
            path: blocker.path ?? null,
          },
          required_human_action: humanActionForBlocker(blocker),
          final_rows_file: summaryRow.final_rows_file,
          finalize_report: repoRelativePath(reportPath),
          mutation_manifest: summaryRow.mutation_manifest,
          raw_blocker: raw,
          ledger_key: `blocked:dependency:${bucket}:${reasonCode}:${summaryRow.scope_key}:${index}:${repoRelativePath(reportPath)}`,
        };
      },
    );

    const writes: AppendJsonLinesResult[] = [
      appendJsonLinesDedup(path.join(ledgerDir, LEDGER_FILES.blockedScopes), [summaryRow]),
    ];
    for (const bucket of BLOCKER_BUCKETS) {
      const bucketRows = dependencyRows.filter((row) => row.blocker_bucket === bucket);
      if (bucketRows.length === 0) continue;
      writes.push(
        appendJsonLinesDedup(
          path.join(ledgerDir, `blocked.dependencies.${bucket}.jsonl`),
          bucketRows,
        ),
      );
    }
    const identityRetryRows = dependencyRows.filter(
      (row) =>
        row.blocker_bucket === "identity" &&
        /(timeout|429|network|rate)/iu.test(`${row.reason_code} ${row.message ?? ""}`),
    );
    if (identityRetryRows.length > 0) {
      writes.push(
        appendJsonLinesDedup(
          path.join(ledgerDir, "retry.identity-failed.jsonl"),
          identityRetryRows,
        ),
      );
    }
    const files = Object.fromEntries(
      writes.map((write) => [path.basename(write.file).replace(/[.-]/gu, "_"), write.file]),
    );
    const manifestPath = updateManifest({
      ledgerDir,
      eventKind: "post_authoring_finalize_blocked",
      files: { ...files, blocked_scopes: path.join(ledgerDir, LEDGER_FILES.blockedScopes) },
      reportPath,
    });
    return {
      status: "completed",
      files: {
        manifest: repoRelativePath(manifestPath),
        blocked_scopes: repoRelativePath(path.join(ledgerDir, LEDGER_FILES.blockedScopes)),
      },
      counts: {
        blockers: blockers.length,
        blocked_scopes: 1,
        entries_written: writes.reduce((total, write) => total + write.appended, 0),
        entries_skipped_existing: writes.reduce(
          (total, write) => total + write.skipped_existing,
          0,
        ),
      },
    };
  }

  function latestByKey<T, K>(rows: readonly T[], keyFn: (row: T) => K): T[] {
    const latest = new Map<K, T>();
    for (const row of rows) {
      latest.set(keyFn(row), row);
    }
    return [...latest.values()];
  }

  function runDatasetImportLedgerReport(
    options: DatasetImportLedgerReportOptions,
  ): DatasetImportLedgerHelpReport | DatasetImportLedgerReport {
    if (options.help) {
      return {
        schema_version: 1,
        status: "help",
        command: "dataset-import-ledger-report",
        usage: [
          "node scripts/foundry.ts dataset-import-ledger-report --ledger-dir .foundry/workspaces/<task-id>/import-ledger --out-dir .foundry/workspaces/<task-id>/import-ledger",
        ],
        purpose:
          "Build a read-only resume report from append-only ok/blocked/retry import ledgers. It never writes the database.",
        remote_write_mode: "read-only",
      };
    }
    const ledgerDir = resolveRepoPath(options.ledgerDir || options.importLedgerDir);
    if (!ledgerDir || !fs.existsSync(ledgerDir) || !fs.statSync(ledgerDir).isDirectory()) {
      throw new Error("--ledger-dir is required and must point to an import ledger directory.");
    }
    const outDir = resolveRepoPath(options.outDir || ledgerDir);
    ensureDir(outDir!);
    const okScopePath = path.join(ledgerDir, LEDGER_FILES.okScopes);
    const okRows: VerifiedImportLedgerRow[] = fs.existsSync(okScopePath)
      ? readJsonLinesIfExists<VerifiedImportLedgerRow>(okScopePath)
      : fs
          .readdirSync(ledgerDir)
          .filter((name) => /^ok\..*\.verified\.jsonl$/u.test(name))
          .flatMap((name) =>
            readJsonLinesIfExists<VerifiedImportLedgerRow>(path.join(ledgerDir, name)),
          );
    const blockedScopeRows = readJsonLinesIfExists<BlockedScopeImportLedgerRow>(
      path.join(ledgerDir, LEDGER_FILES.blockedScopes),
    );
    const blockedDependencyRows = fs
      .readdirSync(ledgerDir)
      .filter((name) => /^blocked\.dependencies\..*\.jsonl$/u.test(name))
      .flatMap((name) =>
        readJsonLinesIfExists<BlockedDependencyImportLedgerRow>(path.join(ledgerDir, name)),
      );
    const blockedRows = [...blockedScopeRows, ...blockedDependencyRows];
    const retryRows = fs
      .readdirSync(ledgerDir)
      .filter((name) => /^(?:retry\..*|failed\..*\.retry)\.jsonl$/u.test(name))
      .flatMap((name) => readJsonLinesIfExists<RetryImportLedgerRow>(path.join(ledgerDir, name)));
    const verifiedKeys = new Set<string>(
      okRows
        .map((row) => row.dataset_key || `${row.row_dataset_type}:${row.dataset_id}:${row.version}`)
        .filter(Boolean),
    );
    const latestBlockedScopes = latestByKey(blockedScopeRows, (row) => row.scope_key);
    const resumeRows = latestBlockedScopes
      .filter((row) => {
        const keys = Array.isArray(row.scope_ids)
          ? row.scope_ids.map(
              (id) => `${row.scope_dataset_type}:${id}:${row.scope_versions?.[0] ?? "missing"}`,
            )
          : [];
        return keys.length === 0 || keys.some((key) => !verifiedKeys.has(key));
      })
      .map<ResumePendingImportLedgerRow>((row) => ({
        schema_version: 1,
        ledger_kind: "resume",
        status: "pending_human_review",
        source_ledger_key: row.ledger_key ?? null,
        scope_key: row.scope_key ?? null,
        scope_dataset_type: row.scope_dataset_type ?? null,
        scope_ids: row.scope_ids ?? [],
        blocker_codes: row.blocker_codes ?? [],
        blocker_count: row.blocker_count ?? null,
        required_human_action: row.required_human_action ?? null,
        final_rows_file: row.final_rows_file ?? null,
        finalize_report: row.finalize_report ?? null,
        rerun_command: row.rerun_command ?? null,
      }));
    const skippedRows = latestByKey(okRows, (row) => row.dataset_key || row.ledger_key).map(
      (row): ResumeSkippedImportLedgerRow => ({
        schema_version: 1,
        ledger_kind: "resume",
        status: "skipped_verified",
        source_ledger_key: row.ledger_key ?? null,
        dataset_key: row.dataset_key ?? null,
        row_dataset_type: row.row_dataset_type ?? null,
        dataset_id: row.dataset_id ?? null,
        version: row.version ?? null,
        verified_at_utc: row.verified_at_utc ?? null,
        closeout_report: row.closeout_report ?? null,
      }),
    );
    const resumePath = path.join(outDir!, LEDGER_FILES.resumePlan);
    const skippedPath = path.join(outDir!, LEDGER_FILES.resumeSkipped);
    writeJsonLinesFile(resumePath, resumeRows);
    writeJsonLinesFile(skippedPath, skippedRows);
    const reportPath = path.join(outDir!, LEDGER_FILES.report);
    const report: DatasetImportLedgerReport = {
      schema_version: 1,
      generated_at_utc: nowIso(),
      status: resumeRows.length > 0 ? "completed_with_blocked_scopes" : "completed",
      ledger_dir: repoRelativePath(ledgerDir),
      remote_write_mode: "read-only",
      policy: {
        resume_boundary:
          "The ledger report is read-only. Verified scopes are skipped; blocked scopes remain pending until human/database governance repairs their dependencies and reruns only affected scopes.",
      },
      counts: {
        ok_rows: okRows.length,
        blocked_rows: blockedRows.length,
        retry_rows: retryRows.length,
        resume_rows: resumeRows.length,
        skipped_verified_rows: skippedRows.length,
      },
      files: {
        report: repoRelativePath(reportPath),
        resume_plan: repoRelativePath(resumePath),
        resume_skipped_verified: repoRelativePath(skippedPath),
      },
    };
    writeJson(reportPath, report);
    updateManifest({
      ledgerDir,
      eventKind: "ledger_report",
      files: { report: reportPath, resume_plan: resumePath, resume_skipped_verified: skippedPath },
      reportPath,
    });
    return report;
  }

  return {
    runDatasetImportLedgerReport,
    writeCloseoutImportLedger,
    writeFinalizeImportLedger,
  };
}

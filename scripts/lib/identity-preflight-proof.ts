import { createHash } from "node:crypto";
import { createRequire } from "node:module";

type JsonRecord = Record<string, unknown>;

export type AuthIdentityReceipt = {
  schema: string;
  status: "passed";
  captured_at_utc: string;
  cli: { package_name: string; package_version: string };
  project: { project_ref: string; project_base_url: string };
  identity: { user_id: string; display_email: string };
  session: {
    source: string;
    cache_mode: string;
    force_reauth: boolean;
    expires_at_utc: string | null;
  };
  assertions: {
    mode: string;
    expected_project_ref: string | null;
    expected_user_id: string | null;
    passed: boolean;
  };
  receipt_scope_sha256: string;
  [key: string]: unknown;
};

export type CliIdentity = {
  packageName: string;
  packageVersion: string;
  packageIntegrity: string | null;
};

export type IdentityPreflightBindingInput = {
  datasetType: string;
  datasetId: string;
  datasetVersion: string;
  targetSha256: string;
  requestText: string;
  semanticArgv: string[];
  cli: CliIdentity;
  authReceipt: AuthIdentityReceipt | null;
  relevantInputHashes: Record<string, string>;
};

export type IdentityPreflightBinding = {
  schema: "tiangong-foundry.identity-preflight-binding.v1";
  dataset: { type: string; id: string; version: string; target_sha256: string };
  request: { bytes_sha256: string; canonical_sha256: string };
  command: { semantic_argv: string[]; argv_sha256: string };
  cli: {
    package_name: string;
    package_version: string;
    package_integrity: string | null;
  };
  account: {
    project_ref: string;
    user_id: string;
  } | null;
  relevant_input_hashes: Record<string, string>;
  binding_sha256: string;
  inputs: IdentityPreflightBindingInput;
};

export type IdentityPreflightBindingEvidence = Omit<IdentityPreflightBinding, "inputs">;

export type ExecutionManifest = {
  schema: "tiangong-foundry.identity-preflight-execution.v1";
  binding_sha256: string;
  binding: IdentityPreflightBindingEvidence;
  producer_auth: {
    project_ref: string;
    user_id: string;
    receipt_scope_sha256: string;
    captured_at_utc: string;
  };
  report: {
    bytes_sha256: string;
    canonical_sha256: string;
    status: string;
    decision: string | null;
  };
  completed_at_utc: string;
  manifest_sha256: string;
};

type ValidationFailure = { ok: false; code: string; message: string };
type ValidationSuccess = { ok: true; report: JsonRecord; manifest: ExecutionManifest };

const require = createRequire(import.meta.url);
const cliAuth = require("@tiangong-lca/cli/dist/src/lib/auth-identity-receipt.js") as {
  parseAuthIdentityReceipt(value: unknown): AuthIdentityReceipt;
};
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const ALLOWED_REPORT_STATUSES = new Set(["passed", "blocked", "needs_review"]);

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stableJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableJsonValue);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, stableJsonValue(value[key])]),
  );
}

export function stableJson(value: unknown): string {
  return JSON.stringify(stableJsonValue(value));
}

export function sha256Text(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function sha256Json(value: unknown): string {
  return sha256Text(stableJson(value));
}

function exactRecord(value: unknown, label: string): JsonRecord {
  if (!isRecord(value)) throw new Error(`${label} must be an object.`);
  return value;
}

export function parseFreshIntentBoundAuthReceipt(
  value: unknown,
  options: {
    nowMs: number;
    maxAgeMs: number;
    expectedProjectRef: string;
    expectedUserId: string;
    requireFreshSignin: boolean;
  },
): AuthIdentityReceipt {
  if (
    !Number.isFinite(options.nowMs) ||
    !Number.isFinite(options.maxAgeMs) ||
    options.maxAgeMs <= 0
  ) {
    throw new Error("Auth receipt freshness options are invalid.");
  }
  const receipt = cliAuth.parseAuthIdentityReceipt(value);
  const capturedAtMs = Date.parse(receipt.captured_at_utc);
  const ageMs = options.nowMs - capturedAtMs;
  if (!Number.isFinite(capturedAtMs) || ageMs < -5_000 || ageMs > options.maxAgeMs) {
    throw new Error("Auth identity receipt is stale or future-dated.");
  }
  if (
    receipt.assertions.mode !== "intent-bound" ||
    !receipt.assertions.passed ||
    receipt.assertions.expected_project_ref !== options.expectedProjectRef ||
    receipt.assertions.expected_user_id !== options.expectedUserId ||
    receipt.project.project_ref !== options.expectedProjectRef ||
    receipt.identity.user_id !== options.expectedUserId
  ) {
    throw new Error("Auth identity receipt is not bound to the expected project and user.");
  }
  if (
    options.requireFreshSignin &&
    (receipt.session.source !== "signin" ||
      receipt.session.cache_mode !== "disabled" ||
      !receipt.session.force_reauth)
  ) {
    throw new Error("Production auth receipt must be a cache-disabled forced fresh signin.");
  }
  return receipt;
}

function validatedHash(value: string, label: string): string {
  if (!SHA256_PATTERN.test(value)) throw new Error(`${label} must be a lowercase SHA-256.`);
  return value;
}

function validatedToken(value: string, label: string): string {
  const token = String(value).trim();
  if (!token) throw new Error(`${label} is required.`);
  return token;
}

export function createIdentityPreflightBinding(
  input: IdentityPreflightBindingInput,
): IdentityPreflightBinding {
  const request = exactRecord(JSON.parse(input.requestText), "Identity-preflight request");
  const semanticArgv = input.semanticArgv.map((value) => validatedToken(value, "argv token"));
  if (semanticArgv.length === 0) throw new Error("Identity-preflight semantic argv is required.");
  const relevantInputHashes = Object.fromEntries(
    Object.entries(input.relevantInputHashes)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, hash]) => [validatedToken(key, "input hash key"), validatedHash(hash, key)]),
  );
  const scope = {
    schema: "tiangong-foundry.identity-preflight-binding.v1" as const,
    dataset: {
      type: validatedToken(input.datasetType, "dataset type"),
      id: validatedToken(input.datasetId, "dataset id"),
      version: validatedToken(input.datasetVersion, "dataset version"),
      target_sha256: validatedHash(input.targetSha256, "target_sha256"),
    },
    request: {
      bytes_sha256: sha256Text(input.requestText),
      canonical_sha256: sha256Json(request),
    },
    command: {
      semantic_argv: semanticArgv,
      argv_sha256: sha256Json(semanticArgv),
    },
    cli: {
      package_name: validatedToken(input.cli.packageName, "CLI package name"),
      package_version: validatedToken(input.cli.packageVersion, "CLI package version"),
      package_integrity: input.cli.packageIntegrity
        ? validatedToken(input.cli.packageIntegrity, "CLI package integrity")
        : null,
    },
    account: input.authReceipt
      ? {
          project_ref: input.authReceipt.project.project_ref,
          user_id: input.authReceipt.identity.user_id,
        }
      : null,
    relevant_input_hashes: relevantInputHashes,
  };
  return {
    ...scope,
    binding_sha256: sha256Json(scope),
    inputs: {
      ...input,
      semanticArgv,
      relevantInputHashes,
    },
  };
}

function bindingEvidence(binding: IdentityPreflightBinding): IdentityPreflightBindingEvidence {
  const { inputs: _inputs, ...evidence } = binding;
  return evidence;
}

function failure(code: string, message: string): ValidationFailure {
  return { ok: false, code, message };
}

function parseReport(text: string | null, code: string): JsonRecord | ValidationFailure {
  if (text === null || !String(text).trim()) return failure(code, "Identity report is missing.");
  try {
    const value = JSON.parse(String(text).trim());
    return isRecord(value) ? value : failure(code, "Identity report must be a JSON object.");
  } catch {
    return failure(code, "Identity report is not exact JSON.");
  }
}

function isFailure(value: JsonRecord | ValidationFailure): value is ValidationFailure {
  return value.ok === false && typeof value.code === "string" && typeof value.message === "string";
}

export function validateIdentityPreflightExecution(input: {
  binding: IdentityPreflightBinding;
  exitCode: number;
  stdoutText: string;
  diskReportText: string | null;
  startedAtMs: number;
  diskReportMtimeMs: number | null;
  completedAtUtc: string;
}): ValidationFailure | ValidationSuccess {
  if (input.exitCode !== 0) {
    return failure("identity_preflight_cli_exit_nonzero", "Identity-preflight CLI exited nonzero.");
  }
  const stdoutReport = parseReport(
    input.stdoutText,
    "identity_preflight_stdout_missing_or_non_json",
  );
  if (isFailure(stdoutReport)) return stdoutReport;
  const diskReport = parseReport(
    input.diskReportText,
    "identity_preflight_disk_report_missing_or_non_json",
  );
  if (isFailure(diskReport)) return diskReport;
  if (input.diskReportMtimeMs === null || input.diskReportMtimeMs < input.startedAtMs) {
    return failure(
      "identity_preflight_disk_report_stale",
      "Identity-preflight disk report is stale.",
    );
  }
  if (stableJson(stdoutReport) !== stableJson(diskReport)) {
    return failure(
      "identity_preflight_stdout_disk_mismatch",
      "Identity-preflight stdout and disk reports differ.",
    );
  }
  if (Object.hasOwn(diskReport, "ok") && diskReport.ok !== true) {
    return failure("identity_preflight_report_not_ok", "Identity-preflight report has ok != true.");
  }
  const status = typeof diskReport.status === "string" ? diskReport.status : "";
  if (!ALLOWED_REPORT_STATUSES.has(status)) {
    return failure(
      "identity_preflight_report_status_invalid",
      `Identity-preflight report status ${status || "missing"} is not accepted.`,
    );
  }
  const authReceipt = input.binding.inputs.authReceipt;
  if (!authReceipt || !input.binding.account) {
    return failure(
      "identity_preflight_auth_receipt_missing",
      "Identity-preflight execution requires account receipt evidence.",
    );
  }
  const manifestScope = {
    schema: "tiangong-foundry.identity-preflight-execution.v1" as const,
    binding_sha256: input.binding.binding_sha256,
    binding: bindingEvidence(input.binding),
    producer_auth: {
      project_ref: authReceipt.project.project_ref,
      user_id: authReceipt.identity.user_id,
      receipt_scope_sha256: validatedHash(authReceipt.receipt_scope_sha256, "receipt_scope_sha256"),
      captured_at_utc: authReceipt.captured_at_utc,
    },
    report: {
      bytes_sha256: sha256Text(input.diskReportText ?? ""),
      canonical_sha256: sha256Json(diskReport),
      status,
      decision: typeof diskReport.decision === "string" ? diskReport.decision : null,
    },
    completed_at_utc: input.completedAtUtc,
  };
  return {
    ok: true,
    report: diskReport,
    manifest: { ...manifestScope, manifest_sha256: sha256Json(manifestScope) },
  };
}

export function validateBoundExecutionManifest(
  value: unknown,
  binding: IdentityPreflightBinding,
  reportText: string | null,
): { ok: boolean; code?: string } {
  if (!isRecord(value) || value.schema !== "tiangong-foundry.identity-preflight-execution.v1") {
    return { ok: false, code: "identity_preflight_manifest_invalid" };
  }
  const report = isRecord(value.report) ? value.report : null;
  const manifestScope = {
    schema: value.schema,
    binding_sha256: value.binding_sha256,
    binding: value.binding,
    producer_auth: value.producer_auth,
    report: value.report,
    completed_at_utc: value.completed_at_utc,
  };
  if (
    value.binding_sha256 !== binding.binding_sha256 ||
    stableJson(value.binding) !== stableJson(bindingEvidence(binding)) ||
    typeof value.manifest_sha256 !== "string" ||
    value.manifest_sha256 !== sha256Json(manifestScope) ||
    !report ||
    reportText === null ||
    report.bytes_sha256 !== sha256Text(reportText)
  ) {
    return { ok: false, code: "identity_preflight_manifest_binding_mismatch" };
  }
  if (
    !isRecord(value.producer_auth) ||
    value.producer_auth.project_ref !== binding.account?.project_ref ||
    value.producer_auth.user_id !== binding.account?.user_id ||
    typeof value.producer_auth.receipt_scope_sha256 !== "string" ||
    !SHA256_PATTERN.test(value.producer_auth.receipt_scope_sha256) ||
    typeof value.producer_auth.captured_at_utc !== "string" ||
    !Number.isFinite(Date.parse(value.producer_auth.captured_at_utc))
  ) {
    return { ok: false, code: "identity_preflight_manifest_account_mismatch" };
  }
  try {
    if (report.canonical_sha256 !== sha256Json(JSON.parse(reportText))) {
      return { ok: false, code: "identity_preflight_manifest_report_mismatch" };
    }
  } catch {
    return { ok: false, code: "identity_preflight_manifest_report_invalid" };
  }
  return { ok: true };
}

export function validateIdentityPreflightEvidence(
  value: unknown,
  input: {
    requestText: string | null;
    reportText: string | null;
    datasetType: string;
    datasetId: string;
    datasetVersion: string;
    targetSha256: string;
    expectedProjectRef?: string | null;
    expectedUserId?: string | null;
  },
): { ok: boolean; code?: string; binding?: IdentityPreflightBindingEvidence } {
  if (!isRecord(value) || value.schema !== "tiangong-foundry.identity-preflight-execution.v1") {
    return { ok: false, code: "identity_preflight_manifest_invalid" };
  }
  if (!isRecord(value.binding) || !isRecord(value.producer_auth) || !isRecord(value.report)) {
    return { ok: false, code: "identity_preflight_manifest_invalid" };
  }
  const binding = value.binding;
  if (
    binding.schema !== "tiangong-foundry.identity-preflight-binding.v1" ||
    !isRecord(binding.dataset) ||
    !isRecord(binding.request) ||
    !isRecord(binding.command) ||
    !isRecord(binding.cli) ||
    !isRecord(binding.account) ||
    !isRecord(binding.relevant_input_hashes) ||
    typeof binding.binding_sha256 !== "string"
  ) {
    return { ok: false, code: "identity_preflight_manifest_binding_invalid" };
  }
  if (
    typeof binding.account.project_ref !== "string" ||
    !binding.account.project_ref ||
    typeof binding.account.user_id !== "string" ||
    !binding.account.user_id ||
    value.producer_auth.project_ref !== binding.account.project_ref ||
    value.producer_auth.user_id !== binding.account.user_id ||
    typeof value.producer_auth.receipt_scope_sha256 !== "string" ||
    !SHA256_PATTERN.test(value.producer_auth.receipt_scope_sha256) ||
    typeof value.producer_auth.captured_at_utc !== "string" ||
    !Number.isFinite(Date.parse(value.producer_auth.captured_at_utc))
  ) {
    return { ok: false, code: "identity_preflight_manifest_account_invalid" };
  }
  const bindingScope = {
    schema: binding.schema,
    dataset: binding.dataset,
    request: binding.request,
    command: binding.command,
    cli: binding.cli,
    account: binding.account,
    relevant_input_hashes: binding.relevant_input_hashes,
  };
  if (
    binding.binding_sha256 !== sha256Json(bindingScope) ||
    value.binding_sha256 !== binding.binding_sha256
  ) {
    return { ok: false, code: "identity_preflight_manifest_binding_mismatch" };
  }
  if (
    binding.dataset.type !== input.datasetType ||
    binding.dataset.id !== input.datasetId ||
    binding.dataset.version !== input.datasetVersion ||
    binding.dataset.target_sha256 !== input.targetSha256
  ) {
    return { ok: false, code: "identity_preflight_manifest_dataset_mismatch" };
  }
  if (input.requestText === null || input.reportText === null) {
    return { ok: false, code: "identity_preflight_manifest_artifact_missing" };
  }
  let request: JsonRecord;
  let reportValue: JsonRecord;
  try {
    const parsedRequest = JSON.parse(input.requestText);
    const parsedReport = JSON.parse(input.reportText);
    if (!isRecord(parsedRequest) || !isRecord(parsedReport)) throw new Error("not an object");
    request = parsedRequest;
    reportValue = parsedReport;
  } catch {
    return { ok: false, code: "identity_preflight_manifest_artifact_invalid" };
  }
  if (
    binding.request.bytes_sha256 !== sha256Text(input.requestText) ||
    binding.request.canonical_sha256 !== sha256Json(request) ||
    sha256Text(JSON.stringify(request.target)) !== input.targetSha256
  ) {
    return { ok: false, code: "identity_preflight_manifest_request_mismatch" };
  }
  const report = value.report;
  if (
    report.bytes_sha256 !== sha256Text(input.reportText) ||
    report.canonical_sha256 !== sha256Json(reportValue) ||
    report.status !== reportValue.status ||
    report.decision !== (typeof reportValue.decision === "string" ? reportValue.decision : null) ||
    !ALLOWED_REPORT_STATUSES.has(String(report.status ?? "")) ||
    (Object.hasOwn(reportValue, "ok") && reportValue.ok !== true)
  ) {
    return { ok: false, code: "identity_preflight_manifest_report_mismatch" };
  }
  const manifestScope = {
    schema: value.schema,
    binding_sha256: value.binding_sha256,
    binding: value.binding,
    producer_auth: value.producer_auth,
    report: value.report,
    completed_at_utc: value.completed_at_utc,
  };
  if (
    typeof value.manifest_sha256 !== "string" ||
    value.manifest_sha256 !== sha256Json(manifestScope) ||
    typeof value.completed_at_utc !== "string" ||
    !Number.isFinite(Date.parse(value.completed_at_utc))
  ) {
    return { ok: false, code: "identity_preflight_manifest_integrity_invalid" };
  }
  if (input.expectedProjectRef || input.expectedUserId) {
    if (
      (input.expectedProjectRef && binding.account.project_ref !== input.expectedProjectRef) ||
      (input.expectedUserId && binding.account.user_id !== input.expectedUserId)
    ) {
      return { ok: false, code: "identity_preflight_manifest_account_mismatch" };
    }
  }
  return { ok: true, binding: binding as IdentityPreflightBindingEvidence };
}

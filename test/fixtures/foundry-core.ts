import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import type { BinaryLike } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveInstalledTiangongLcaCliPackage } from "../../scripts/lib/foundry-runtime-utils.ts";

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const testRunId = process.env.FOUNDRY_FULL_CONTEXT_TEST_RUN_ID || process.pid;

export type FixtureFiles = Record<string, string> & FixtureRecord[];
export interface FixtureCommands extends Array<FixtureRecord> {
  commit: FixtureRecord;
  post_write_verify: FixtureRecord;
  apply_all_patches: string | null;
  build_task: string;
}

export interface FixtureRecord {
  [key: string]: unknown;
  schema: string;
  schema_version: string | number;
  status: string;
  code: string;
  field: string;
  kind: string;
  path: string;
  text: string;
  sha256: string;
  phase: string;
  purpose: string;
  command: string;
  decision: string;
  reason: string;
  source: string;
  "@classId": string;
  role: string;
  entity_id: string;
  id: string;
  version: string;
  ref_object_id: string;
  short_description_source: string;
  action_item_code: string;
  reference_id: string;
  authoring_package_sha256: string;
  dataset_type: string;
  dataset_id: string;
  dataset_version: string;
  stdout_log: string;
  stderr_log: string;
  request_file: string;
  source_file: string;
  merge_source: string;
  rewrite_file: string;
  report_policy: string;
  query: string;
  display: string;
  out_path: string;
  expected_state_code: string;
  expected_state_code_source: string;
  commit_account_binding: string;
  sourceCitation: string;
  authoring_package: string;
  json_pointer: string;
  action_kind: string;
  sentinel_value: string;
  shared_context_cache_dir: string;
  bytes: number;
  row_index: number;
  enabled: boolean;
  reused: boolean;
  common_other_deferral_allowed: boolean;
  candidate_count: number;
  source_action_item_count: number;
  deterministic_cleanup_count: number;
  timeout_ms: number;
  spawn_timeout_ms: number;
  exit_code: number;
  duration_ms: number;
  commit_command_supports_target_user_id: boolean;
  files: FixtureFiles;
  counts: Record<string, number>;
  policy: Record<string, boolean>;
  commands: FixtureCommands;
  blockers: FixtureBlocker[];
  scope_blockers: FixtureBlocker[];
  tasks: FixtureRecord[];
  entities: FixtureRecord[];
  processes: FixtureRecord[];
  items: FixtureRecord[];
  action_items: FixtureRecord[];
  deterministic_cleanup_items: FixtureRecord[];
  contract_context_files: FixtureRecord[];
  patch_sets: FixtureRecord[];
  phases: FixtureRecord[];
  stages: FixtureRecord[];
  timings: FixtureRecord[];
  findings: FixtureRecord[];
  candidate_sources: FixtureRecord[];
  canonical_references: FixtureRecord[];
  identity_action_items: FixtureRecord[];
  related_authoring_packages: FixtureRecord[];
  source_action_items: FixtureRecord[];
  dependencies: FixtureRecord[] & FixtureRecord;
  dependency_rows: FixtureRecord[];
  support_rows: FixtureRecord[];
  candidates: FixtureRecord[];
  names: string[];
  dataset_types: string[];
  argv: string[];
  args: string[];
  decision_only_action_items: FixtureRecord[];
  operations: FixtureRecord[];
  rows: FixtureRecord[];
  allowed_resolution_modes: string[];
  required_context_file_patterns: string[];
  closes_action_items: string[];
  detected_segments: string[];
  context: FixtureRecord;
  context_bundle: FixtureRecord;
  shared_context_bundle: FixtureRecord;
  batch_patch_contract: FixtureRecord;
  report_contract: FixtureRecord;
  evidence: FixtureRecord;
  result: FixtureRecord;
  final_rows_artifact: FixtureRecord;
  binding: FixtureRecord;
  account_write_guard: FixtureRecord;
  artifacts: FixtureRecord[];
  cache: FixtureRecord;
  chunk_plan: FixtureRecord;
  classification_authoring_context: FixtureRecord;
  location_authoring_context: FixtureRecord;
  full_context_ai_completion: FixtureRecord;
  identity_preflight: FixtureRecord;
  identity_reference_rewrites: FixtureRecord;
  identity_preflight_context: FixtureRecord;
  identity_reference_rewrite_context: FixtureRecord;
  curation_queue_context: FixtureRecord;
  curation_queue: FixtureRecord;
  authoring_context: FixtureRecord;
  current: FixtureRecord;
  remote_search: FixtureRecord;
  execution_evidence: FixtureRecord;
  runtime_options: FixtureRecord;
  remote_candidate_search: FixtureRecord;
  canonical: FixtureRecord;
  canonical_support: FixtureRecord;
  closure: FixtureRecord;
  external_refs: FixtureRecord[];
  canonical_unit_group_reference_keys: FixtureRecord[];
  processDataSet: FixtureRecord;
  flowDataSet: FixtureRecord;
  sourceDataSet: FixtureRecord;
  unitGroupDataSet: FixtureRecord;
  flowPropertyDataSet: FixtureRecord;
  processInformation: FixtureRecord;
  flowInformation: FixtureRecord;
  sourceInformation: FixtureRecord;
  contactInformation: FixtureRecord;
  unitGroupInformation: FixtureRecord;
  flowPropertiesInformation: FixtureRecord;
  dataSetInformation: FixtureRecord;
  modellingAndValidation: FixtureRecord;
  exchanges: FixtureRecord;
  exchange: FixtureRecord[];
  referenceToFlowDataSet: FixtureRecord;
  "common:shortDescription": FixtureRecord;
  dataSourcesTreatmentAndRepresentativeness: FixtureRecord;
  classificationInformation: FixtureRecord;
  annualSupplyOrProductionVolume: FixtureRecord;
  quantitativeReference: FixtureRecord;
  referenceToReferenceUnitGroup: FixtureRecord;
  referenceToDataSource: FixtureRecord;
  validation: FixtureRecord;
  review: FixtureRecord;
  "common:referenceToCompleteReviewReport": FixtureRecord;
  original_exchange: FixtureRecord;
  upstream_flow_blockers: FixtureRecord[];
  publicationAndOwnership: FixtureRecord;
  "common:other": FixtureRecord;
  "common:classification": FixtureRecord;
  "common:class": FixtureRecord[];
  "tiangongfoundry:sourceExchangeCompleteness": FixtureRecord[];
  "tiangongfoundry:unresolvedTrace": FixtureRecord[];
  "tiangongfoundry:unresolvedExchangeTrace": FixtureRecord[];
}

export interface FixtureBlocker extends FixtureRecord {
  code: string;
}

export interface FixtureFoundryReport extends FixtureRecord {
  status: string;
  failure_code: string;
  binding_sha256: string;
  counts: Record<string, number>;
  policy: Record<string, boolean>;
  results: FixtureFoundryReport[];
  blockers: FixtureBlocker[];
  items: FixtureRecord[];
  evidence: FixtureRecord;
  scope_blockers: FixtureBlocker[];
}

export interface FixtureJsonDocument extends FixtureRecord {
  schema: string;
  status: string;
  stage: string;
  error_code: string;
  runtime_cleanup_error_code: string;
  mutation_dispatch_count: number;
  manifest_scope_sha256: string;
  account_mode: string;
  contact_artifact: FixtureRecord;
}

export interface FixtureJsonLine extends FixtureRecord {
  request_bytes_sha256: string;
  target_sha256: string;
}

export interface RunFoundryOptions {
  env?: NodeJS.ProcessEnv;
  timeout?: number;
}

export function testTmpRoot(name: string): string {
  return path.join(repoRoot, "tmp", `${name}-${testRunId}`);
}
export const fakeTidasBin = path.join(repoRoot, "test", "fixtures", "fake-tidas.ts");
export const targetUserId = "00000000-0000-4000-8000-000000000001";
export const fullContextKinds = [
  "schema",
  "methodology_yaml",
  "ruleset",
  "classification_schema",
  "location_schema",
];
export const fullContextPatterns = [
  "schema.json",
  "methodology.yaml",
  "runtime-ruleset.json",
  "tidas_contacts_category.json",
  "tidas_flowproperties_category.json",
  "tidas_flows_elementary_category.json",
  "tidas_flows_product_category.json",
  "tidas_lciamethods_category.json",
  "tidas_processes_category.json",
  "tidas_sources_category.json",
  "tidas_unitgroups_category.json",
  "tidas_locations_category.json",
];
export function rel(filePath: string): string {
  return path.relative(repoRoot, filePath).replaceAll("\\", "/");
}

export function writeJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

export function writeText(filePath: string, text: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, text);
}

export function writeJsonLines(filePath: string, rows: readonly unknown[]): void {
  writeText(
    filePath,
    rows.map((row) => JSON.stringify(row)).join("\n") + (rows.length ? "\n" : ""),
  );
}

export function sha256Text(text: BinaryLike): string {
  return crypto.createHash("sha256").update(text).digest("hex");
}

export function readJson(filePath: string): FixtureJsonDocument {
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as FixtureJsonDocument;
}

export function readJsonLines(filePath: string): FixtureJsonLine[] {
  const text = fs.readFileSync(filePath, "utf8").trim();
  return text ? text.split(/\r?\n/u).map((line) => JSON.parse(line) as FixtureJsonLine) : [];
}

export function runFoundry(
  args: readonly string[],
  options: RunFoundryOptions = {},
): { code: number | null; json: FixtureFoundryReport } {
  const result = spawnSync(process.execPath, ["scripts/foundry.mjs", ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      TIDAS_BIN: fakeTidasBin,
      ...(options.env ?? {}),
    },
    timeout: options.timeout,
  });
  const stdout = result.stdout.trim();
  assert.notEqual(
    stdout,
    "",
    `Expected JSON stdout for ${args.join(" ")}; status=${result.status}; stderr=${result.stderr}`,
  );
  return {
    code: result.status,
    json: JSON.parse(stdout) as FixtureFoundryReport,
  };
}

export function blockerCodes(report: { blockers?: FixtureBlocker[] }): Set<string> {
  return new Set((report.blockers ?? []).map((blocker) => blocker.code));
}

export function itemBlockerCodes(report: {
  items?: Array<{ blockers?: FixtureBlocker[] }>;
}): Set<string> {
  return new Set(
    (report.items ?? []).flatMap((item) => (item.blockers ?? []).map((blocker) => blocker.code)),
  );
}

export function scopeBlockerCodes(report: {
  evidence?: { scope_blockers?: FixtureBlocker[] };
  scope_blockers?: FixtureBlocker[];
}): Set<string> {
  return new Set(
    (report.evidence?.scope_blockers ?? report.scope_blockers ?? []).map((blocker) => blocker.code),
  );
}

export function contextTextByPathSuffix(
  authoringPackage: {
    contract_context_files: Array<{ path?: unknown; text?: string }>;
  },
  suffix: string,
): string {
  return (
    authoringPackage.contract_context_files.find((file) => String(file.path ?? "").endsWith(suffix))
      ?.text ?? ""
  );
}

export function bundledCategorySchemaNames(): string[] {
  return fs
    .readdirSync(resolveInstalledTiangongLcaCliPackage().schemaDir)
    .filter((name) => /^tidas_.*_category\.json$/u.test(name))
    .sort();
}

export { assert, crypto, fs, path, spawnSync };

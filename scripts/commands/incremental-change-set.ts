import Ajv2020 from "ajv/dist/2020.js";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { ErrorObject, ValidateFunction } from "ajv";
import { readOnlyStageContract } from "../lib/stage-contract.ts";

type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
interface JsonObject {
  [key: string]: JsonValue | undefined;
}

interface Entity extends JsonObject {
  table: string;
  id: string;
  version: string;
}

interface EvidenceRule extends JsonObject {
  entity_key: string;
  pointer: string;
  old_value_sha256: string;
  candidate_value_sha256: string;
  current_value_sha256: string;
  evidence_sha256: string;
  transform_id?: string;
  mode?: string;
  element_identity_pointer?: string;
}

interface TablePolicy extends JsonObject {
  allow_insert: boolean;
  allow_update: boolean;
  semantic_noise_rules: EvidenceRule[];
  conflict_rules: EvidenceRule[];
  array_merge_rules: EvidenceRule[];
}

interface PreservationPolicy extends JsonObject {
  schema_version: string;
  semantic_domain?: string;
  type_rank: string[];
  table_policies: Record<string, TablePolicy>;
}

interface RequestScope extends JsonObject {
  allowed_tables: string[];
  allowed_target_keys: string[];
  allowed_update_pointer_prefixes: Record<string, string[]>;
  allow_account_local_support?: boolean;
}

interface IncrementalRequest extends JsonObject {
  schema_version: string;
  target_mode: string;
  production_authority: boolean;
  change_set_id: string;
  producer_id: string;
  project_ref: string;
  owner: { user_id: string; email: string } & JsonObject;
  scope: RequestScope;
  consumer: {
    schema_version: string;
    cli_version: string;
    toolchain_fingerprint_sha256: string;
  } & JsonObject;
  input_artifacts: {
    comparisons: ArtifactReference;
    owner_snapshot: ArtifactReference;
    owner_snapshot_receipt: ArtifactReference;
    preservation_policy: ArtifactReference;
    terminal_exclusions?: ArtifactReference;
  } & JsonObject;
}

interface ComparisonRow extends JsonObject {
  __line: number;
  __raw_sha256: string;
  schema_version: string;
  conversion_id: string;
  entity: Entity;
  dependency_conversion_ids: string[];
  old_payload: JsonValue;
  new_payload: JsonValue;
  old_payload_sha256: string | null;
  new_payload_sha256: string | null;
}

interface ComposeOptions extends JsonObject {
  help?: boolean;
  request?: string;
  outDir?: string;
}

interface OwnerRow extends JsonObject {
  schema_version: string;
  role: string;
  project_ref: string;
  owner: { user_id: string; email: string } & JsonObject;
  state_code: number;
  payload_sha256: string | null;
  json_ordered: JsonValue;
  entity: Entity;
}

interface MergeConflict extends JsonObject {
  pointer: string;
  reason: string;
}

interface MergeResult {
  value: JsonValue | typeof MISSING;
  conflicts: MergeConflict[];
  preserved_paths: string[];
  applied_paths: string[];
  noise_paths: string[];
  noise_evidence_sha256: string[];
  preserve_owner_evidence_sha256: string[];
  take_candidate_evidence_sha256: string[];
  stable_array_evidence_sha256: string[];
  forbidden_paths?: string[];
}

interface HashPair extends JsonObject {
  payload_sha256: string | null;
  semantic_sha256: string | null;
}

interface ExecutionContract extends JsonObject {
  actions: JsonObject[];
}

interface InputFacts {
  request: ArtifactFacts;
  comparisons: ArtifactFacts;
  owner_snapshot: ArtifactFacts;
  owner_snapshot_receipt: ArtifactFacts;
  policy: ArtifactFacts;
  terminal_exclusions: ArtifactFacts | null;
}

interface ConversionResult {
  input_sequence: number;
  source_line: number;
  source_raw_sha256: string;
  conversion_id: string;
  requested_conversion_id: string;
  entity: Entity;
  key: string;
  dependencies: string[];
  old_payload: JsonValue;
  candidate_payload: JsonValue;
  current_payload: JsonValue;
  desired_payload: JsonValue | null;
  hashes: Record<string, HashPair>;
  merge: MergeResult;
  evidence: JsonObject;
  terminal_success: TerminalSuccessBinding | null;
  disposition: string;
  reason_codes: string[];
  expected_operation: string | null;
  before_sha256: string | null;
  desired_sha256: string | null;
  action_id: string | null;
  dependency_action_ids: string[];
  dependency_dispositions: JsonObject[];
  duration_ms: number;
}

interface ArtifactReference extends JsonObject {
  path: string;
  sha256: string;
  bytes: number;
  rows?: number;
  schema_version?: string;
}

interface TerminalExclusion extends JsonObject {
  action_id: string;
  desired_sha256: string;
  success_receipt: ArtifactReference;
}

interface TerminalSuccessBinding extends JsonObject {
  action_id: string;
  desired_sha256: string;
  receipt_path: string;
  receipt_schema_version: string;
  receipt_status: string;
  receipt_bytes: number;
  receipt_sha256: string;
}

interface ArtifactFacts {
  path: string;
  bytes: number;
  sha256: string;
  rows: number | null;
  schema_version: string | null;
}

interface JsonLineMeta<T extends JsonObject = JsonObject> {
  value: T;
  line: number;
  raw_sha256: string;
}

interface SchemaRuntime {
  validators: Record<string, ValidateFunction>;
}

interface OwnerSnapshotReceipt extends JsonObject {
  schema_version: string;
  project_ref: string;
  owner: { user_id: string; email: string; state_code: number } & JsonObject;
  snapshot: { sha256: string; bytes: number; rows: number } & JsonObject;
  scope_binding: {
    allowed_target_keys: string[];
    allowed_target_keys_sha256: string;
    canonical_scope_sha256: string;
  } & JsonObject;
  target_ledger: JsonValue[];
  captured_at_utc: string;
}

interface ConversionEvent extends JsonObject {
  previous_event_sha256: string | null;
  event_sha256: string;
  evidence: JsonObject;
  outcome: { terminal_success: TerminalSuccessBinding | null } & JsonObject;
  decision_binding_sha256: string;
}

interface AjvRuntime {
  addSchema: (schema: object) => unknown;
  compile: (schema: object) => ValidateFunction;
}

const REQUEST_SCHEMA = "foundry-incremental-change-set-request.v1";
const COMPARISON_SCHEMA = "foundry-incremental-change-set-comparison-row.v1";
const OWNER_ROW_SCHEMA = "foundry-incremental-change-set-owner-row.v1";
const OWNER_SNAPSHOT_RECEIPT_SCHEMA = "foundry-incremental-change-set-owner-snapshot-receipt.v1";
const POLICY_SCHEMA = "foundry-incremental-change-set-preservation-policy.v1";
const TERMINAL_SUCCESS_RECEIPT_SCHEMA =
  "foundry-incremental-change-set-terminal-success-receipt.v1";
const EVENT_SCHEMA = "foundry-incremental-change-set-conversion-event.v1";
const REPORT_SCHEMA = "foundry-incremental-change-set-report.v1";
const MANIFEST_SCHEMA = "foundry-incremental-change-set-manifest.v1";
const DEPENDENCY_SCHEMA = "foundry-incremental-change-set-dependency-closure.v1";
const CLI_CONTRACT_SCHEMA = "dataset-save-draft-execution-contract.v1";
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const SAFE_TABLES = new Set([
  "contacts",
  "sources",
  "unitgroups",
  "flowproperties",
  "flows",
  "processes",
]);
const TRUST_BOUNDARY_REASONS = new Set([
  "HOLD_DUPLICATE_CONVERSION_ID",
  "HOLD_DUPLICATE_TARGET",
  "HOLD_FOREIGN_OWNER",
  "HOLD_IDENTITY_MISMATCH",
  "HOLD_MULTIPLE_VISIBLE_ROWS",
  "HOLD_PAYLOAD_HASH_MISMATCH",
  "HOLD_PUBLIC_OR_FOREIGN_STATE",
  "HOLD_SCOPE_WIDENING",
  "HOLD_UNKNOWN_TABLE",
]);
const MISSING = Symbol("missing");

const TABLE_IDENTITIES: Record<string, readonly [string, string]> = {
  contacts: ["contactDataSet", "contactInformation"],
  sources: ["sourceDataSet", "sourceInformation"],
  unitgroups: ["unitGroupDataSet", "unitGroupInformation"],
  flowproperties: ["flowPropertyDataSet", "flowPropertiesInformation"],
  flows: ["flowDataSet", "flowInformation"],
  processes: ["processDataSet", "processInformation"],
};

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => compareText(left, right))
        .map(([key, child]) => [key, stableValue(child)]),
    );
  }
  return value;
}

export function stableJson(value: unknown): string {
  return JSON.stringify(stableValue(value));
}

function sha256Bytes(value: crypto.BinaryLike): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function sha256Json(value: unknown): string {
  return sha256Bytes(stableJson(value));
}

function semanticSha256(domain: string, value: unknown): string {
  return sha256Bytes(`${domain}\0${stableJson(value)}`);
}

function isObject(value: unknown): value is JsonObject {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function clone<T>(value: T): T {
  return (value === MISSING ? MISSING : structuredClone(value)) as T;
}

function exact(left: unknown, right: unknown): boolean {
  if (left === MISSING || right === MISSING) return left === right;
  return stableJson(left) === stableJson(right);
}

function asToken(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function entityKey(entity: Entity): string {
  return `${entity.table}/${entity.id}@${entity.version}`;
}

function normalizedEntity(value: Entity | JsonObject | undefined): Entity {
  return {
    table: asToken(value?.table),
    id: asToken(value?.id),
    version: asToken(value?.version),
  };
}

function pointerSegment(value: unknown): string {
  return String(value).replaceAll("~", "~0").replaceAll("/", "~1");
}

function childPointer(pointer: string, key: unknown): string {
  return `${pointer}/${pointerSegment(key)}`;
}

function pointerMatches(prefix: string, pointer: string): boolean {
  return (
    prefix !== "" && prefix !== "/" && (pointer === prefix || pointer.startsWith(`${prefix}/`))
  );
}

function matchingPrefix(prefixes: Iterable<string>, pointer: string): string | undefined {
  return [...prefixes]
    .filter((prefix) => pointerMatches(prefix, pointer))
    .sort((left, right) => right.length - left.length)[0];
}

function policyForTable(policy: PreservationPolicy, table: string): TablePolicy {
  const value = policy?.table_policies?.[table];
  return isObject(value)
    ? value
    : {
        allow_insert: false,
        allow_update: false,
        semantic_noise_rules: [],
        conflict_rules: [],
        array_merge_rules: [],
      };
}

function presentValue(value: unknown): boolean {
  return value !== MISSING && value !== undefined;
}

export function valueSha256(value: unknown): string {
  return sha256Json(
    presentValue(value)
      ? { schema_version: "foundry-bound-value.v1", presence: "present", value }
      : { schema_version: "foundry-bound-value.v1", presence: "missing" },
  );
}

function ruleMatchesValues(
  rule: EvidenceRule,
  entityKeyValue: string,
  pointer: string,
  oldValue: unknown,
  candidateValue: unknown,
  currentValue: unknown,
): boolean {
  return (
    rule.entity_key === entityKeyValue &&
    rule.pointer === pointer &&
    rule.old_value_sha256 === valueSha256(oldValue) &&
    rule.candidate_value_sha256 === valueSha256(candidateValue) &&
    rule.current_value_sha256 === valueSha256(currentValue)
  );
}

function boundRule(
  rules: EvidenceRule[] | undefined,
  entityKeyValue: string,
  pointer: string,
  oldValue: unknown,
  candidateValue: unknown,
  currentValue: unknown,
): EvidenceRule | undefined {
  return (rules ?? []).find((rule) =>
    ruleMatchesValues(rule, entityKeyValue, pointer, oldValue, candidateValue, currentValue),
  );
}

function canonicalDecimal(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  if (typeof value === "number" && !Number.isFinite(value)) return null;
  const token = String(value).trim();
  const match = /^([+-]?)(\d+)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/u.exec(token);
  if (!match) return null;
  const sign = match[1] === "-" ? "-" : "";
  const integer = match[2];
  const fraction = match[3] ?? "";
  const exponent = Number(match[4] ?? "0");
  if (!Number.isSafeInteger(exponent)) return null;
  const digits = `${integer}${fraction}`;
  const point = integer.length + exponent;
  const expanded =
    point <= 0
      ? `0.${"0".repeat(-point)}${digits}`
      : point >= digits.length
        ? `${digits}${"0".repeat(point - digits.length)}`
        : `${digits.slice(0, point)}.${digits.slice(point)}`;
  const [rawWhole, rawFraction = ""] = expanded.split(".");
  const whole = rawWhole.replace(/^0+(?=\d)/u, "") || "0";
  const trimmedFraction = rawFraction.replace(/0+$/u, "");
  const magnitude = trimmedFraction ? `${whole}.${trimmedFraction}` : whole;
  return /^0(?:\.0+)?$/u.test(magnitude) ? "0" : `${sign}${magnitude}`;
}

function noiseRuleFor(
  tablePolicy: TablePolicy,
  entityKeyValue: string,
  pointer: string,
  oldValue: unknown,
  candidateValue: unknown,
  currentValue: unknown,
): EvidenceRule | null {
  const rule = boundRule(
    tablePolicy.semantic_noise_rules,
    entityKeyValue,
    pointer,
    oldValue,
    candidateValue,
    currentValue,
  );
  if (!rule || rule.transform_id !== "decimal_lexical_equivalence_v1") return null;
  const values = [oldValue, candidateValue, currentValue].map(canonicalDecimal);
  return values.every((value) => value != null && value === values[0]) ? rule : null;
}

function matchingNoiseRules(
  tablePolicy: TablePolicy,
  entityKeyValue: string,
  oldValue: unknown,
  candidateValue: unknown,
  currentValue: unknown,
): EvidenceRule[] {
  return (tablePolicy.semantic_noise_rules ?? [])
    .filter(
      (rule) =>
        noiseRuleFor(
          tablePolicy,
          entityKeyValue,
          rule.pointer,
          pointerValue(oldValue, rule.pointer),
          pointerValue(candidateValue, rule.pointer),
          pointerValue(currentValue, rule.pointer),
        ) === rule,
    )
    .sort((left, right) => compareText(left.pointer, right.pointer));
}

function normalizedDecimalMarker(value: unknown): JsonObject {
  return {
    schema_version: "foundry-normalized-decimal.v1",
    canonical_decimal: canonicalDecimal(value),
  };
}

function replacePointer<T>(value: T, pointer: string, replacement: unknown): T {
  const output = clone(value);
  const segments = pointer
    .slice(1)
    .split("/")
    .map((segment) => segment.replaceAll("~1", "/").replaceAll("~0", "~"));
  let current = output as unknown as Record<string, unknown>;
  for (const segment of segments.slice(0, -1)) {
    current = current[segment] as Record<string, unknown>;
  }
  current[segments.at(-1)!] = replacement;
  return output;
}

function normalizedSemanticProjection(payload: JsonValue, rules: EvidenceRule[]): JsonValue {
  if (payload == null) return null;
  return rules.reduce(
    (projection, rule) =>
      replacePointer(
        projection,
        rule.pointer,
        normalizedDecimalMarker(pointerValue(payload, rule.pointer)),
      ),
    payload,
  );
}

export function conversionHashSets({
  oldValue,
  candidateValue,
  currentValue,
  tablePolicy,
  entityKey: entityKeyValue,
  domain,
}: {
  oldValue: JsonValue;
  candidateValue: JsonValue;
  currentValue: JsonValue;
  tablePolicy: TablePolicy;
  entityKey: string;
  domain: string;
}) {
  const noiseRules = matchingNoiseRules(
    tablePolicy,
    entityKeyValue,
    oldValue,
    candidateValue,
    currentValue,
  );
  const hashSet = (payload: JsonValue): HashPair => {
    if (payload == null) return { payload_sha256: null, semantic_sha256: null };
    return {
      payload_sha256: sha256Json(payload),
      semantic_sha256: semanticSha256(domain, normalizedSemanticProjection(payload, noiseRules)),
    };
  };
  return {
    hashes: {
      old: hashSet(oldValue),
      candidate: hashSet(candidateValue),
      current: hashSet(currentValue),
    },
    noise_rules: noiseRules,
  };
}

function pointerValue(value: unknown, pointer: string): unknown {
  if (!pointer || pointer === "/") return value;
  let current = value;
  for (const encoded of pointer.slice(1).split("/")) {
    const segment = encoded.replaceAll("~1", "/").replaceAll("~0", "~");
    if (!isObject(current) && !Array.isArray(current)) return MISSING;
    if (!Object.hasOwn(current, segment)) return MISSING;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function stableArrayIdentity(
  rule: EvidenceRule | undefined,
  oldArray: unknown,
  candidateArray: unknown,
  currentArray: unknown,
): boolean {
  if (
    rule?.mode !== "stable_identity_by_index_v1" ||
    !Array.isArray(oldArray) ||
    !Array.isArray(candidateArray) ||
    !Array.isArray(currentArray) ||
    oldArray.length !== candidateArray.length ||
    oldArray.length !== currentArray.length
  ) {
    return false;
  }
  const seen = new Set<string>();
  for (let index = 0; index < oldArray.length; index += 1) {
    const identities = [oldArray[index], candidateArray[index], currentArray[index]].map((entry) =>
      pointerValue(entry, rule.element_identity_pointer ?? ""),
    );
    if (
      identities.some((identity) => !presentValue(identity)) ||
      !identities.every((identity) => exact(identity, identities[0]))
    ) {
      return false;
    }
    const identitySha256 = valueSha256(identities[0]);
    if (seen.has(identitySha256)) return false;
    seen.add(identitySha256);
  }
  return true;
}

function valueAt(value: unknown, key: string): unknown {
  return isObject(value) && Object.hasOwn(value, key) ? value[key] : MISSING;
}

export function mergeThreeWay({
  oldValue,
  candidateValue,
  currentValue,
  tablePolicy,
  entityKey: entityKeyValue = "",
}: {
  oldValue: JsonValue;
  candidateValue: JsonValue;
  currentValue: JsonValue;
  tablePolicy: TablePolicy;
  entityKey?: string;
}): MergeResult {
  const conflicts: MergeConflict[] = [];
  const preservedPaths: string[] = [];
  const appliedPaths: string[] = [];
  const normalizationRules = matchingNoiseRules(
    tablePolicy,
    entityKeyValue,
    oldValue,
    candidateValue,
    currentValue,
  );
  const noisePaths = normalizationRules.map((rule) => rule.pointer);
  const noiseEvidence = normalizationRules.map((rule) => rule.evidence_sha256);
  const preserveOwnerEvidence: string[] = [];
  const takeCandidateEvidence: string[] = [];
  const stableArrayEvidence: string[] = [];

  function merge(
    oldChild: unknown,
    candidateChild: unknown,
    currentChild: unknown,
    pointer: string,
    arrayAuthority: EvidenceRule | null = null,
  ): unknown {
    const noiseRule = noiseRuleFor(
      tablePolicy,
      entityKeyValue,
      pointer,
      oldChild,
      candidateChild,
      currentChild,
    );
    if (pointer && noiseRule) {
      return clone(currentChild === MISSING ? candidateChild : currentChild);
    }
    if (Array.isArray(oldChild) || Array.isArray(candidateChild) || Array.isArray(currentChild)) {
      if (exact(candidateChild, oldChild) && exact(currentChild, oldChild))
        return clone(currentChild);
      if (exact(currentChild, candidateChild)) return clone(currentChild);
      if (exact(currentChild, oldChild) && !exact(candidateChild, oldChild)) {
        appliedPaths.push(pointer || "");
        return clone(candidateChild);
      }
      const arrayRule = boundRule(
        tablePolicy.array_merge_rules,
        entityKeyValue,
        pointer,
        oldChild,
        candidateChild,
        currentChild,
      );
      if (!stableArrayIdentity(arrayRule, oldChild, candidateChild, currentChild)) {
        conflicts.push({ pointer: pointer || "", reason: "array_identity_unstable" });
        return clone(currentChild);
      }
      stableArrayEvidence.push(arrayRule!.evidence_sha256);
      const oldArray = oldChild as unknown[];
      const candidateArray = candidateChild as unknown[];
      const currentArray = currentChild as unknown[];
      return oldArray.map((entry, index) =>
        merge(
          entry,
          candidateArray[index],
          currentArray[index],
          childPointer(pointer, index),
          arrayRule,
        ),
      );
    }
    if (
      isObject(oldChild === MISSING ? {} : oldChild) &&
      isObject(candidateChild === MISSING ? {} : candidateChild) &&
      isObject(currentChild === MISSING ? {} : currentChild)
    ) {
      const oldObject = isObject(oldChild) ? oldChild : {};
      const candidateObject = isObject(candidateChild) ? candidateChild : {};
      const currentObject = isObject(currentChild) ? currentChild : {};
      const keys = new Set([
        ...Object.keys(oldObject),
        ...Object.keys(candidateObject),
        ...Object.keys(currentObject),
      ]);
      const output: JsonObject = {};
      for (const key of [...keys].sort(compareText)) {
        const merged = merge(
          valueAt(oldChild, key),
          valueAt(candidateChild, key),
          valueAt(currentChild, key),
          childPointer(pointer, key),
          arrayAuthority,
        );
        if (merged !== MISSING) output[key] = merged as JsonValue;
      }
      return output;
    }
    if (exact(candidateChild, oldChild) && exact(currentChild, oldChild)) {
      return clone(currentChild);
    }
    if (exact(currentChild, candidateChild)) return clone(currentChild);
    if (exact(currentChild, oldChild) && !exact(candidateChild, oldChild)) {
      appliedPaths.push(pointer || "");
      return clone(candidateChild);
    }

    const resolution = boundRule(
      tablePolicy.conflict_rules,
      entityKeyValue,
      pointer,
      oldChild,
      candidateChild,
      currentChild,
    );
    if (exact(candidateChild, oldChild) && !exact(currentChild, oldChild)) {
      if (resolution?.mode === "preserve_owner") {
        preservedPaths.push(pointer || "");
        preserveOwnerEvidence.push(resolution.evidence_sha256);
        return clone(currentChild);
      }
      if (resolution?.mode === "take_candidate") {
        appliedPaths.push(pointer || "");
        takeCandidateEvidence.push(resolution.evidence_sha256);
        return clone(candidateChild);
      }
      if (arrayAuthority) {
        preservedPaths.push(pointer || "");
        return clone(currentChild);
      }
      conflicts.push({ pointer: pointer || "", reason: "unattributed_current_drift" });
      return clone(currentChild);
    }
    if (resolution?.mode === "preserve_owner") {
      preservedPaths.push(pointer || "");
      preserveOwnerEvidence.push(resolution.evidence_sha256);
      return clone(currentChild);
    }
    if (resolution?.mode === "take_candidate") {
      appliedPaths.push(pointer || "");
      takeCandidateEvidence.push(resolution.evidence_sha256);
      return clone(candidateChild);
    }
    conflicts.push({ pointer: pointer || "", reason: "three_way_conflict" });
    return clone(currentChild);
  }

  return {
    value: merge(oldValue, candidateValue, currentValue, "") as JsonValue,
    conflicts,
    preserved_paths: [...new Set(preservedPaths)].sort(compareText),
    applied_paths: [...new Set(appliedPaths)].sort(compareText),
    noise_paths: [...new Set(noisePaths)].sort(compareText),
    noise_evidence_sha256: [...new Set(noiseEvidence)].sort(compareText),
    preserve_owner_evidence_sha256: [...new Set(preserveOwnerEvidence)].sort(compareText),
    take_candidate_evidence_sha256: [...new Set(takeCandidateEvidence)].sort(compareText),
    stable_array_evidence_sha256: [...new Set(stableArrayEvidence)].sort(compareText),
  };
}

function diffPointers(
  left: unknown,
  right: unknown,
  pointer = "",
  output: string[] = [],
): string[] {
  if (exact(left, right)) return output;
  if (isObject(left) && isObject(right)) {
    const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
    for (const key of [...keys].sort(compareText)) {
      diffPointers(valueAt(left, key), valueAt(right, key), childPointer(pointer, key), output);
    }
    return output;
  }
  output.push(pointer || "");
  return output;
}

function evidenceForMerge(policySha256: string, merge: MergeResult): JsonObject {
  return {
    policy_sha256: policySha256,
    noise_evidence_sha256: [...new Set(merge.noise_evidence_sha256 ?? [])].sort(compareText),
    preserve_owner_evidence_sha256: [...new Set(merge.preserve_owner_evidence_sha256 ?? [])].sort(
      compareText,
    ),
    take_candidate_evidence_sha256: [...new Set(merge.take_candidate_evidence_sha256 ?? [])].sort(
      compareText,
    ),
    stable_array_evidence_sha256: [...new Set(merge.stable_array_evidence_sha256 ?? [])].sort(
      compareText,
    ),
  };
}

function extractIdentity(payload: JsonValue, table: string): { id: string; version: string } {
  const [rootKey, informationKey] = TABLE_IDENTITIES[table] ?? [];
  const payloadRecord = isObject(payload) ? payload : {};
  const rootValue = rootKey ? payloadRecord[rootKey] : undefined;
  const root = isObject(rootValue) ? rootValue : payloadRecord;
  const informationValue = informationKey ? root[informationKey] : undefined;
  const information = isObject(informationValue) ? informationValue : {};
  const dataSetInformation = isObject(information.dataSetInformation)
    ? information.dataSetInformation
    : {};
  const administrative = isObject(root.administrativeInformation)
    ? root.administrativeInformation
    : {};
  const publication = isObject(administrative.publicationAndOwnership)
    ? administrative.publicationAndOwnership
    : {};
  return {
    id: asToken(dataSetInformation["common:UUID"] ?? dataSetInformation.UUID),
    version: asToken(publication["common:dataSetVersion"] ?? publication.dataSetVersion),
  };
}

function pathInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function resolveLexicalInside(repoRoot: string, value: unknown, label: string): string {
  const token = asToken(value);
  if (!token) throw new Error(`${label} is required.`);
  const resolved = path.resolve(repoRoot, token);
  if (!pathInside(repoRoot, resolved)) throw new Error(`${label} must be inside the repository.`);
  return resolved;
}

function resolveInputInside(repoRoot: string, value: unknown, label: string): string {
  const resolved = resolveLexicalInside(repoRoot, value, label);
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
    throw new Error(`${label} file not found.`);
  }
  const realRepoRoot = fs.realpathSync(repoRoot);
  const realPath = fs.realpathSync(resolved);
  if (!pathInside(realRepoRoot, realPath) || !fs.statSync(realPath).isFile()) {
    throw new Error(`${label} must resolve to a regular file inside the repository.`);
  }
  return realPath;
}

function resolveFreshOutputInside(repoRoot: string, value: unknown, label: string): string {
  const resolved = resolveLexicalInside(repoRoot, value, label);
  if (fs.existsSync(resolved)) throw new Error(`${label} must not already exist.`);
  const realRepoRoot = fs.realpathSync(repoRoot);
  const parent = fs.realpathSync(path.dirname(resolved));
  if (!pathInside(realRepoRoot, parent) || !fs.statSync(parent).isDirectory()) {
    throw new Error(`${label} parent must resolve inside the repository.`);
  }
  return path.join(parent, path.basename(resolved));
}

function readJson(filePath: string): JsonObject {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function createSchemaValidators(repoRoot: string): SchemaRuntime {
  const schemaPath = path.join(repoRoot, "specs", "schemas", "incremental-change-set.schema.json");
  const schema = readJson(schemaPath);
  const Ajv2020Constructor = Ajv2020 as unknown as new (
    options: Record<string, unknown>,
  ) => AjvRuntime;
  const ajv = new Ajv2020Constructor({ allErrors: true, strict: true });
  ajv.addSchema(schema);
  const names = [
    "request",
    "comparisonRow",
    "ownerRow",
    "ownerSnapshotReceipt",
    "preservationPolicy",
    "terminalExclusion",
    "terminalSuccessReceipt",
    "conversionEvent",
    "noWriteRow",
    "holdRow",
    "dependencyClosure",
    "cliContract",
    "report",
    "manifest",
  ];
  return {
    validators: Object.fromEntries(
      names.map((name) => [name, ajv.compile({ $ref: `${schema.$id}#/$defs/${name}` })]),
    ),
  };
}

function assertSchema(
  schemaRuntime: SchemaRuntime,
  name: string,
  value: unknown,
  label: string,
): void {
  const validate = schemaRuntime.validators[name];
  if (!validate(value)) {
    const errors = (validate.errors ?? [])
      .map((error: ErrorObject) => `${error.instancePath || "/"} ${error.message ?? error.keyword}`)
      .join("; ");
    throw new Error(`${label} does not match ${name}: ${errors}`);
  }
}

export function readJsonLinesWithMeta<T extends JsonObject = JsonObject>(
  filePath: string,
): JsonLineMeta<T>[] {
  const buffer = fs.readFileSync(filePath);
  const rows: JsonLineMeta<T>[] = [];
  let line = 1;
  let start = 0;
  while (start <= buffer.length) {
    const newline = buffer.indexOf(0x0a, start);
    let end = newline === -1 ? buffer.length : newline;
    if (end > start && buffer[end - 1] === 0x0d) end -= 1;
    const raw = buffer.toString("utf8", start, end);
    if (raw.trim()) {
      rows.push({ value: JSON.parse(raw) as T, line, raw_sha256: sha256Bytes(raw) });
    }
    if (newline === -1) break;
    start = newline + 1;
    line += 1;
  }
  return rows;
}

function artifactFacts(
  filePath: string,
  rows: number | null = null,
  schemaVersion: string | null = null,
): ArtifactFacts {
  const buffer = fs.readFileSync(filePath);
  return {
    path: path.basename(filePath),
    schema_version: schemaVersion,
    rows,
    bytes: buffer.byteLength,
    sha256: sha256Bytes(buffer),
  };
}

function verifyArtifactRef(
  repoRoot: string,
  reference: unknown,
  label: string,
  jsonLines: boolean,
): { filePath: string; facts: ArtifactFacts } {
  if (!isObject(reference)) throw new Error(`${label} artifact reference is required.`);
  const typedReference = reference as unknown as ArtifactReference;
  const filePath = resolveInputInside(repoRoot, typedReference.path, `${label}.path`);
  const facts = artifactFacts(filePath, jsonLines ? readJsonLinesWithMeta(filePath).length : null);
  if (!SHA256_PATTERN.test(typedReference.sha256) || typedReference.sha256 !== facts.sha256) {
    throw new Error(`${label} SHA-256 mismatch.`);
  }
  if (!Number.isInteger(typedReference.bytes) || typedReference.bytes !== facts.bytes) {
    throw new Error(`${label} byte count mismatch.`);
  }
  if (jsonLines && (!Number.isInteger(typedReference.rows) || typedReference.rows !== facts.rows)) {
    throw new Error(`${label} row count mismatch.`);
  }
  return { filePath, facts };
}

function verifyTerminalSuccessReceipt(
  repoRoot: string,
  exclusion: TerminalExclusion,
  line: number,
  schemaRuntime: SchemaRuntime,
): TerminalSuccessBinding {
  const reference = exclusion.success_receipt;
  const label = `terminal exclusion line ${line} success receipt`;
  const filePath = resolveInputInside(repoRoot, reference.path, `${label}.path`);
  const facts = artifactFacts(filePath, 1, reference.schema_version);
  if (
    reference.schema_version !== TERMINAL_SUCCESS_RECEIPT_SCHEMA ||
    reference.status !== "success" ||
    reference.sha256 !== facts.sha256 ||
    reference.bytes !== facts.bytes
  ) {
    throw new Error(`${label} path/schema/status/bytes/SHA binding is invalid.`);
  }
  const receipt = readJson(filePath);
  assertSchema(schemaRuntime, "terminalSuccessReceipt", receipt, label);
  if (
    receipt.schema_version !== reference.schema_version ||
    receipt.status !== reference.status ||
    receipt.action_id !== exclusion.action_id ||
    receipt.desired_sha256 !== exclusion.desired_sha256
  ) {
    throw new Error(`${label} does not bind the excluded action and desired payload.`);
  }
  return {
    action_id: exclusion.action_id,
    desired_sha256: exclusion.desired_sha256,
    receipt_path: reference.path,
    receipt_schema_version: reference.schema_version,
    receipt_status: reference.status,
    receipt_bytes: facts.bytes,
    receipt_sha256: facts.sha256,
  };
}

function writeJson(filePath: string, value: unknown): void {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.chmodSync(filePath, 0o600);
}

function writeJsonLines(filePath: string, rows: readonly unknown[]): void {
  fs.writeFileSync(
    filePath,
    rows.map((row) => JSON.stringify(row)).join("\n") + (rows.length ? "\n" : ""),
    { mode: 0o600 },
  );
  fs.chmodSync(filePath, 0o600);
}

function preliminaryResult({
  comparison,
  inputSequence,
  ownerRows,
  policy,
  request,
  policySha256,
  duplicateConversions,
  duplicateTargets,
}: {
  comparison: ComparisonRow;
  inputSequence: number;
  ownerRows: Map<string, OwnerRow[]>;
  policy: PreservationPolicy;
  request: IncrementalRequest;
  policySha256: string;
  duplicateConversions: Set<string>;
  duplicateTargets: Set<string>;
}): ConversionResult {
  const started = performance.now();
  const entity = normalizedEntity(comparison.entity);
  const key = entityKey(entity);
  const requestedConversionId =
    asToken(comparison.conversion_id) || `invalid-line-${comparison.__line}`;
  const conversionId = duplicateConversions.has(requestedConversionId)
    ? `duplicate-line-${comparison.__line}-${comparison.__raw_sha256.slice(0, 12)}`
    : requestedConversionId;
  const tablePolicy = policyForTable(policy, entity.table);
  const oldPayload = comparison.old_payload ?? null;
  const candidatePayload = comparison.new_payload;
  const visibleRows = ownerRows.get(key) ?? [];
  const currentRow = visibleRows.length === 1 ? visibleRows[0] : null;
  const currentPayload = currentRow?.json_ordered ?? null;
  const domain = asToken(policy.semantic_domain) || "foundry-incremental-change-set-semantic.v1";
  const { hashes, noise_rules: normalizationRules } = conversionHashSets({
    oldValue: oldPayload,
    candidateValue: candidatePayload,
    currentValue: currentPayload,
    tablePolicy,
    entityKey: key,
    domain,
  });
  const result: ConversionResult = {
    input_sequence: inputSequence,
    source_line: comparison.__line,
    source_raw_sha256: comparison.__raw_sha256,
    conversion_id: conversionId,
    requested_conversion_id: requestedConversionId,
    entity,
    key,
    dependencies: [...comparison.dependency_conversion_ids],
    old_payload: oldPayload,
    candidate_payload: candidatePayload,
    current_payload: currentPayload,
    desired_payload: null,
    hashes,
    merge: {
      value: currentPayload,
      conflicts: [],
      preserved_paths: [],
      applied_paths: [],
      noise_paths: normalizationRules.map((rule) => rule.pointer),
      noise_evidence_sha256: normalizationRules.map((rule) => rule.evidence_sha256),
      preserve_owner_evidence_sha256: [],
      take_candidate_evidence_sha256: [],
      stable_array_evidence_sha256: [],
    },
    evidence: {
      policy_sha256: policySha256,
      noise_evidence_sha256: normalizationRules.map((rule) => rule.evidence_sha256),
      preserve_owner_evidence_sha256: [],
      take_candidate_evidence_sha256: [],
      stable_array_evidence_sha256: [],
    },
    terminal_success: null,
    disposition: "HOLD",
    reason_codes: [],
    expected_operation: null,
    before_sha256: null,
    desired_sha256: null,
    action_id: null,
    dependency_action_ids: [],
    dependency_dispositions: [],
    duration_ms: 0,
  };
  const hold = (reason: string): ConversionResult => {
    result.reason_codes.push(reason);
    result.duration_ms = Math.max(0, performance.now() - started);
    return result;
  };

  if (comparison.schema_version !== COMPARISON_SCHEMA) return hold("HOLD_SCHEMA_MISMATCH");
  if (!SAFE_TABLES.has(entity.table)) return hold("HOLD_UNKNOWN_TABLE");
  if (!request.scope.allowed_tables.includes(entity.table)) return hold("HOLD_SCOPE_WIDENING");
  if (!request.scope.allowed_target_keys.includes(key)) return hold("HOLD_SCOPE_WIDENING");
  if (!entity.id || !entity.version) return hold("HOLD_IDENTITY_MISMATCH");
  if (duplicateConversions.has(result.requested_conversion_id)) {
    return hold("HOLD_DUPLICATE_CONVERSION_ID");
  }
  if (duplicateTargets.has(key)) return hold("HOLD_DUPLICATE_TARGET");
  for (const [label, payload] of [
    ["old", oldPayload],
    ["candidate", candidatePayload],
  ] as const) {
    const expectedHash = comparison[`${label}_payload_sha256`];
    if (expectedHash !== hashes[label].payload_sha256) {
      return hold("HOLD_PAYLOAD_HASH_MISMATCH");
    }
    if (payload == null) continue;
    const identity = extractIdentity(payload, entity.table);
    if (identity.id !== entity.id || identity.version !== entity.version) {
      return hold("HOLD_IDENTITY_MISMATCH");
    }
  }
  if (visibleRows.length > 1) return hold("HOLD_MULTIPLE_VISIBLE_ROWS");
  if (currentRow) {
    if (currentRow.schema_version !== OWNER_ROW_SCHEMA || currentRow.role !== "writable_target") {
      return hold("HOLD_FOREIGN_OWNER");
    }
    if (
      currentRow.project_ref !== request.project_ref ||
      currentRow.owner?.user_id !== request.owner.user_id ||
      String(currentRow.owner?.email ?? "").toLowerCase() !== request.owner.email.toLowerCase()
    ) {
      return hold("HOLD_FOREIGN_OWNER");
    }
    if (currentRow.state_code !== 0) return hold("HOLD_PUBLIC_OR_FOREIGN_STATE");
    if (
      currentRow.payload_sha256 != null &&
      currentRow.payload_sha256 !== hashes.current.payload_sha256
    ) {
      return hold("HOLD_PAYLOAD_HASH_MISMATCH");
    }
    const identity = extractIdentity(currentPayload, entity.table);
    if (identity.id !== entity.id || identity.version !== entity.version) {
      return hold("HOLD_IDENTITY_MISMATCH");
    }
  }

  if (candidatePayload == null) {
    if (currentPayload == null) {
      result.disposition = "NOOP";
      result.reason_codes = ["NOOP_ALREADY_ABSENT"];
    } else {
      return hold("HOLD_DELETE_FORBIDDEN");
    }
  } else if (oldPayload == null && currentPayload == null) {
    if (!tablePolicy.allow_insert) return hold("HOLD_INSERT_NOT_ALLOWED");
    result.desired_payload = clone(candidatePayload);
    result.disposition = "INSERT";
    result.reason_codes = ["INSERT_NEW_ENTITY"];
    result.expected_operation = "insert";
  } else if (oldPayload != null && currentPayload == null) {
    return hold("HOLD_HISTORICAL_OWNER_GAP");
  } else if (oldPayload == null && currentPayload != null) {
    if (exact(candidatePayload, currentPayload)) {
      result.desired_payload = clone(currentPayload);
      result.disposition = "NOOP";
      result.reason_codes = ["NOOP_EXACT_DESIRED"];
    } else {
      return hold("HOLD_IDENTITY_COLLISION");
    }
  } else {
    const merged = mergeThreeWay({
      oldValue: oldPayload,
      candidateValue: candidatePayload,
      currentValue: currentPayload,
      tablePolicy,
      entityKey: key,
    });
    result.merge = merged;
    result.evidence = evidenceForMerge(policySha256, merged);
    if (merged.conflicts.length) {
      result.reason_codes = [
        ...new Set(
          merged.conflicts.map((conflict) =>
            conflict.reason === "unattributed_current_drift"
              ? "HOLD_UNATTRIBUTED_CURRENT_DRIFT"
              : conflict.reason === "array_identity_unstable"
                ? "HOLD_ARRAY_IDENTITY_UNSTABLE"
                : "HOLD_THREE_WAY_CONFLICT",
          ),
        ),
      ];
      result.duration_ms = Math.max(0, performance.now() - started);
      return result;
    }
    result.desired_payload = merged.value as JsonValue;
    if (exact(result.desired_payload, currentPayload)) {
      result.disposition = "NOOP";
      result.reason_codes = [
        merged.preserved_paths.length ? "NOOP_PRESERVED_OWNER" : "NOOP_EXACT_DESIRED",
      ];
    } else {
      const changedPointers = diffPointers(currentPayload, result.desired_payload);
      const allowedPrefixes = request.scope.allowed_update_pointer_prefixes[entity.table] ?? [];
      const forbidden = changedPointers.filter(
        (pointer) => matchingPrefix(allowedPrefixes, pointer) == null,
      );
      if (!tablePolicy.allow_update || forbidden.length) {
        result.reason_codes = ["HOLD_UPDATE_SCOPE_FORBIDDEN"];
        result.merge.forbidden_paths = forbidden;
        result.duration_ms = Math.max(0, performance.now() - started);
        return result;
      }
      result.disposition = "UPDATE";
      result.reason_codes = ["UPDATE_THREE_WAY_MERGE"];
      result.expected_operation = "save_draft";
    }
  }

  if (result.disposition === "INSERT" || result.disposition === "UPDATE") {
    if (
      ["unitgroups", "flowproperties"].includes(entity.table) &&
      request.scope.allow_account_local_support !== true
    ) {
      result.disposition = "HOLD";
      result.reason_codes = ["HOLD_SUPPORT_ACTION_NOT_AUTHORIZED"];
      result.expected_operation = null;
      result.desired_payload = null;
      result.duration_ms = Math.max(0, performance.now() - started);
      return result;
    }
    const desiredIdentity = extractIdentity(result.desired_payload, entity.table);
    if (desiredIdentity.id !== entity.id || desiredIdentity.version !== entity.version) {
      result.disposition = "HOLD";
      result.reason_codes = ["HOLD_DESIRED_IDENTITY_MISMATCH"];
      result.expected_operation = null;
      result.desired_payload = null;
      result.duration_ms = Math.max(0, performance.now() - started);
      return result;
    }
    result.before_sha256 = result.disposition === "UPDATE" ? hashes.current.payload_sha256 : null;
    result.desired_sha256 = sha256Json(result.desired_payload);
    result.action_id = `${result.conversion_id}@${result.desired_sha256}`;
  } else if (result.disposition === "NOOP" && result.desired_payload != null) {
    result.desired_sha256 = sha256Json(result.desired_payload);
  }
  result.duration_ms = Math.max(0, performance.now() - started);
  return result;
}

function duplicateValues(values: Iterable<string>): Set<string> {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return duplicates;
}

function actionComparator(policy: PreservationPolicy) {
  const ranks = new Map<string, number>(
    (policy.type_rank ?? []).map((table, index) => [table, index]),
  );
  return (left: ConversionResult, right: ConversionResult): number =>
    (ranks.get(left.entity.table) ?? Number.MAX_SAFE_INTEGER) -
      (ranks.get(right.entity.table) ?? Number.MAX_SAFE_INTEGER) ||
    compareText(left.key, right.key) ||
    compareText(left.conversion_id, right.conversion_id);
}

function terminalPairKey(actionId: string, desiredSha256: string): string {
  return `${actionId}\0${desiredSha256}`;
}

function noopSatisfiesDependency(result: ConversionResult | undefined): boolean {
  return (
    result?.disposition === "NOOP" &&
    (result.terminal_success != null ||
      (result.current_payload != null &&
        result.desired_payload != null &&
        exact(result.current_payload, result.desired_payload)))
  );
}

function consumeTerminalExclusions(
  results: ConversionResult[],
  exclusions: TerminalSuccessBinding[],
): Set<string> {
  const consumedConversions = new Set<string>();
  for (const exclusion of exclusions) {
    const matches = results.filter((result) => {
      const candidatePair =
        ["INSERT", "UPDATE"].includes(result.disposition) &&
        result.action_id === exclusion.action_id &&
        result.desired_sha256 === exclusion.desired_sha256;
      const exactCurrentRecovery =
        noopSatisfiesDependency(result) &&
        result.terminal_success == null &&
        result.desired_sha256 === exclusion.desired_sha256 &&
        `${result.conversion_id}@${result.desired_sha256}` === exclusion.action_id;
      return candidatePair || exactCurrentRecovery;
    });
    if (matches.length !== 1) {
      throw new Error(
        `Terminal exclusion ${exclusion.action_id} must consume exactly one candidate action or exact-current recovery NOOP.`,
      );
    }
    const result = matches[0];
    if (consumedConversions.has(result.conversion_id)) {
      throw new Error(`Terminal exclusion duplicates conversion ${result.conversion_id}.`);
    }
    consumedConversions.add(result.conversion_id);
    const wasAction = ["INSERT", "UPDATE"].includes(result.disposition);
    result.disposition = "NOOP";
    result.reason_codes = [wasAction ? "NOOP_TERMINAL_SUCCESS" : "NOOP_TERMINAL_SUCCESS_RECOVERED"];
    result.expected_operation = null;
    result.action_id = null;
    result.dependency_action_ids = [];
    result.terminal_success = exclusion;
  }
  return consumedConversions;
}

function assignDependencyDispositions(results: ConversionResult[]): void {
  const byId = new Map<string, ConversionResult>(
    results.map((result) => [result.conversion_id, result]),
  );
  const isAction = (result: ConversionResult | undefined) =>
    result?.disposition === "INSERT" || result?.disposition === "UPDATE";
  for (const result of results) {
    result.dependency_dispositions = result.dependencies.map((dependencyId) => {
      const dependency = byId.get(dependencyId);
      let disposition = "held_missing";
      if (dependency?.disposition === "HOLD") disposition = "held_dependency";
      else if (isAction(dependency)) disposition = "satisfied_by_action";
      else if (dependency?.terminal_success != null) disposition = "satisfied_terminal_success";
      else if (noopSatisfiesDependency(dependency)) disposition = "satisfied_current_exact";
      return { dependency_conversion_id: dependencyId, disposition };
    });
  }
}

function orderAndCloseDependencies(
  results: ConversionResult[],
  policy: PreservationPolicy,
): ConversionResult[] {
  const byId = new Map<string, ConversionResult>(
    results.map((result) => [result.conversion_id, result]),
  );
  const isAction = (result: ConversionResult) =>
    result.disposition === "INSERT" || result.disposition === "UPDATE";

  let changed = true;
  while (changed) {
    changed = false;
    for (const result of results) {
      if (!isAction(result)) continue;
      const missing = result.dependencies.filter((dependencyId) => !byId.has(dependencyId));
      const held = result.dependencies.filter(
        (dependencyId) => byId.get(dependencyId)?.disposition === "HOLD",
      );
      const absent = result.dependencies.filter((dependencyId) => {
        const dependency = byId.get(dependencyId);
        return dependency?.disposition === "NOOP" && !noopSatisfiesDependency(dependency);
      });
      if (missing.length || held.length || absent.length) {
        result.disposition = "HOLD";
        result.reason_codes = [
          missing.length
            ? "HOLD_MISSING_DEPENDENCY"
            : absent.length
              ? "HOLD_DEPENDENCY_ABSENT"
              : "HOLD_DEPENDENCY",
        ];
        result.expected_operation = null;
        result.action_id = null;
        changed = true;
      }
    }
  }

  const comparator = actionComparator(policy);
  function topological(): { actions: ConversionResult[]; ordered: ConversionResult[] } {
    const actions = results.filter(isAction);
    const actionIds = new Set<string>(actions.map((result) => result.conversion_id));
    const indegree = new Map<string, number>(actions.map((result) => [result.conversion_id, 0]));
    const dependants = new Map<string, string[]>(
      actions.map((result) => [result.conversion_id, []]),
    );
    for (const result of actions) {
      for (const dependencyId of result.dependencies.filter((id) => actionIds.has(id))) {
        indegree.set(result.conversion_id, (indegree.get(result.conversion_id) ?? 0) + 1);
        dependants.get(dependencyId)!.push(result.conversion_id);
      }
    }
    const ready = actions
      .filter((result) => indegree.get(result.conversion_id) === 0)
      .sort(comparator);
    const ordered: ConversionResult[] = [];
    while (ready.length) {
      const next = ready.shift();
      ordered.push(next!);
      for (const dependantId of dependants.get(next!.conversion_id) ?? []) {
        indegree.set(dependantId, (indegree.get(dependantId) ?? 0) - 1);
        if (indegree.get(dependantId) === 0) {
          ready.push(byId.get(dependantId)!);
          ready.sort(comparator);
        }
      }
    }
    return { actions, ordered };
  }

  let topology = topological();
  if (topology.ordered.length !== topology.actions.length) {
    const orderedIds = new Set(topology.ordered.map((result) => result.conversion_id));
    for (const result of topology.actions.filter((value) => !orderedIds.has(value.conversion_id))) {
      result.disposition = "HOLD";
      result.reason_codes = ["HOLD_DEPENDENCY_CYCLE"];
      result.expected_operation = null;
      result.action_id = null;
    }
    changed = true;
    while (changed) {
      changed = false;
      for (const result of results) {
        if (!isAction(result)) continue;
        if (result.dependencies.some((id) => byId.get(id)?.disposition === "HOLD")) {
          result.disposition = "HOLD";
          result.reason_codes = ["HOLD_DEPENDENCY"];
          result.expected_operation = null;
          result.action_id = null;
          changed = true;
        }
      }
    }
    topology = topological();
  }

  const orderedIds = new Set<string>();
  for (const result of topology.ordered) {
    result.dependency_action_ids = result.dependencies
      .map((dependencyId) => byId.get(dependencyId))
      .filter((dependency): dependency is ConversionResult =>
        Boolean(dependency && isAction(dependency)),
      )
      .map((dependency) => dependency.action_id!);
    if (result.dependency_action_ids.some((id) => !orderedIds.has(id))) {
      throw new Error(`Internal dependency order failure for ${result.conversion_id}.`);
    }
    orderedIds.add(result.action_id!);
  }

  assignDependencyDispositions(results);
  return topology.ordered;
}

function commandHelp() {
  const contract = readOnlyStageContract([
    {
      stage: "load-and-verify",
      phase: "prepare",
      purpose: "Verify the SHA-bound request, comparison ledger, owner snapshot, and policy.",
      inputs: ["request", "comparison ledger", "owner snapshot", "preservation policy"],
      outputs: ["verified in-memory inputs"],
      blockers: ["hash, byte, row, schema, scope, owner, or state mismatch"],
      side_effects: [],
    },
    {
      stage: "normalize-and-merge",
      phase: "rewrite_cleanup",
      purpose: "Perform explicit-policy semantic normalization and three-way merge.",
      inputs: ["old", "candidate", "current owner payload", "pointer policy"],
      outputs: ["INSERT, UPDATE, NOOP, or HOLD per conversion"],
      blockers: ["unattributed owner drift", "three-way conflict", "forbidden delete"],
      side_effects: [],
    },
    {
      stage: "classify-order-validate",
      phase: "gate_validate",
      purpose: "Propagate required dependency holds and produce a stable action order.",
      inputs: ["conversion dispositions", "declared dependency graph"],
      outputs: ["ordered candidate actions", "dependency closure"],
      blockers: ["missing dependency", "cycle", "terminal replay", "trust-boundary finding"],
      side_effects: [],
    },
    {
      stage: "materialize-report",
      phase: "report",
      purpose: "Write immutable private artifacts and one terminal log event per conversion.",
      inputs: ["ordered conversions"],
      outputs: ["ledgers", "CLI candidate contract", "report", "SHA manifest"],
      blockers: ["existing output directory", "artifact algebra mismatch"],
      side_effects: ["local files only; no network, database, CLI, or DML dispatch"],
    },
  ]);
  return {
    status: "help",
    command: "dataset-incremental-change-set-compose",
    usage:
      "node scripts/foundry.ts dataset-incremental-change-set-compose --request <file> --out-dir <fresh-directory>",
    ...contract,
    production_authority: false,
  };
}

function isNonRootJsonPointer(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value !== "" &&
    value !== "/" &&
    /^(?:\/(?:[^~/]|~[01])*)+$/u.test(value)
  );
}

function validateRequest(request: IncrementalRequest): void {
  if (
    request?.schema_version !== REQUEST_SCHEMA ||
    request?.target_mode !== "owner_draft" ||
    !Object.is(request?.production_authority, false) ||
    !asToken(request.change_set_id) ||
    !asToken(request.producer_id) ||
    !asToken(request.project_ref) ||
    !asToken(request.owner?.user_id) ||
    !asToken(request.owner?.email) ||
    request.owner?.state_code !== 0 ||
    !isObject(request.scope) ||
    !Array.isArray(request.scope.allowed_tables) ||
    !Array.isArray(request.scope.allowed_target_keys) ||
    !isObject(request.scope.allowed_update_pointer_prefixes) ||
    typeof request.scope.allow_account_local_support !== "boolean"
  ) {
    throw new Error("Incremental change-set request header is invalid.");
  }
  if (
    request.scope.allowed_tables.length === 0 ||
    request.scope.allowed_tables.some((table) => !SAFE_TABLES.has(table)) ||
    new Set(request.scope.allowed_tables).size !== request.scope.allowed_tables.length ||
    new Set(request.scope.allowed_target_keys).size !== request.scope.allowed_target_keys.length
  ) {
    throw new Error("Incremental change-set request scope is invalid.");
  }
  const allowedTableSet = new Set(request.scope.allowed_tables);
  const pointerTables = Object.keys(request.scope.allowed_update_pointer_prefixes);
  if (
    pointerTables.length !== allowedTableSet.size ||
    pointerTables.some((table) => !allowedTableSet.has(table)) ||
    request.scope.allowed_target_keys.some((key) => {
      const table = key.split("/", 1)[0];
      return !allowedTableSet.has(table) || !key.includes("@") || !key.includes("/");
    })
  ) {
    throw new Error("Incremental change-set request scope bindings are incomplete.");
  }
  for (const [table, pointers] of Object.entries(request.scope.allowed_update_pointer_prefixes)) {
    if (
      !Array.isArray(pointers) ||
      new Set(pointers).size !== pointers.length ||
      pointers.some((pointer) => !isNonRootJsonPointer(pointer))
    ) {
      throw new Error(`${table} update pointer scope must contain unique non-root JSON pointers.`);
    }
  }
  if (
    request.consumer?.schema_version !== CLI_CONTRACT_SCHEMA ||
    !asToken(request.consumer?.cli_version) ||
    !SHA256_PATTERN.test(request.consumer?.toolchain_fingerprint_sha256 ?? "")
  ) {
    throw new Error("Incremental change-set CLI consumer binding is invalid.");
  }
}

function validatePolicy(policy: PreservationPolicy, request: IncrementalRequest): void {
  if (policy?.schema_version !== POLICY_SCHEMA || !isObject(policy.table_policies)) {
    throw new Error("Incremental change-set preservation policy is invalid.");
  }
  const policyTables = Object.keys(policy.table_policies);
  if (
    policyTables.length !== request.scope.allowed_tables.length ||
    policyTables.some((table) => !request.scope.allowed_tables.includes(table))
  ) {
    throw new Error("Preservation policy tables must exactly match request allowed tables.");
  }
  if (
    !Array.isArray(policy.type_rank) ||
    new Set(policy.type_rank).size !== policy.type_rank.length ||
    policy.type_rank.some((table) => !request.scope.allowed_tables.includes(table))
  ) {
    throw new Error("Preservation policy type_rank is invalid.");
  }
  const requestedTargets = new Set(request.scope.allowed_target_keys);
  const ruleFields = ["semantic_noise_rules", "conflict_rules", "array_merge_rules"] as const;
  for (const [table, tablePolicy] of Object.entries(policy.table_policies)) {
    if (!SAFE_TABLES.has(table) || !isObject(tablePolicy)) {
      throw new Error(`Invalid preservation policy table: ${table}`);
    }
    for (const field of ruleFields) {
      if (!Array.isArray(tablePolicy[field]))
        throw new Error(`${table}.${field} must be an array.`);
    }
    for (const field of ruleFields) {
      const identities = new Set<string>();
      for (const rule of tablePolicy[field]) {
        if (
          !requestedTargets.has(rule.entity_key) ||
          !rule.entity_key.startsWith(`${table}/`) ||
          !isNonRootJsonPointer(rule.pointer) ||
          !SHA256_PATTERN.test(rule.evidence_sha256)
        ) {
          throw new Error(`${table}.${field} contains an out-of-scope or unbound rule.`);
        }
        const identity = `${rule.entity_key}\0${rule.pointer}`;
        if (identities.has(identity)) {
          throw new Error(`${table}.${field} contains a duplicate entity/path rule.`);
        }
        identities.add(identity);
        if (field === "array_merge_rules" && !isNonRootJsonPointer(rule.element_identity_pointer)) {
          throw new Error(`${table}.array_merge_rules requires a non-root identity pointer.`);
        }
      }
    }
  }
}

function canonicalRequestScope(scope: RequestScope): JsonObject {
  return {
    allowed_tables: [...scope.allowed_tables].sort(compareText),
    allowed_target_keys: [...scope.allowed_target_keys].sort(compareText),
    allowed_update_pointer_prefixes: Object.fromEntries(
      Object.entries(scope.allowed_update_pointer_prefixes)
        .sort(([left], [right]) => compareText(left, right))
        .map(([table, pointers]) => [table, [...pointers].sort(compareText)]),
    ),
    allow_account_local_support: scope.allow_account_local_support,
  };
}

function validateOwnerSnapshotReceipt(
  receipt: OwnerSnapshotReceipt,
  request: IncrementalRequest,
  ownerFacts: ArtifactFacts,
  ownerSnapshotLines: Map<string, Array<{ raw_sha256: string }>>,
): void {
  const canonicalTargetKeys = [...request.scope.allowed_target_keys].sort(compareText);
  const expectedLedger = canonicalTargetKeys.map((key) => {
    const lines = ownerSnapshotLines.get(key) ?? [];
    if (lines.length > 1) {
      throw new Error(`Owner snapshot has multiple rows for target ${key}.`);
    }
    return {
      entity_key: key,
      presence: lines.length === 1 ? "present" : "absent",
      snapshot_row_sha256: lines.length === 1 ? lines[0].raw_sha256 : null,
    };
  });
  if (
    receipt.schema_version !== OWNER_SNAPSHOT_RECEIPT_SCHEMA ||
    receipt.project_ref !== request.project_ref ||
    receipt.owner.user_id !== request.owner.user_id ||
    receipt.owner.email.toLowerCase() !== request.owner.email.toLowerCase() ||
    receipt.owner.state_code !== 0 ||
    receipt.snapshot.sha256 !== ownerFacts.sha256 ||
    receipt.snapshot.bytes !== ownerFacts.bytes ||
    receipt.snapshot.rows !== ownerFacts.rows ||
    !exact(receipt.scope_binding.allowed_target_keys, canonicalTargetKeys) ||
    receipt.scope_binding.allowed_target_keys_sha256 !== sha256Json(canonicalTargetKeys) ||
    receipt.scope_binding.canonical_scope_sha256 !==
      sha256Json(canonicalRequestScope(request.scope)) ||
    !exact(receipt.target_ledger, expectedLedger) ||
    !Number.isFinite(Date.parse(receipt.captured_at_utc))
  ) {
    throw new Error(
      "Owner snapshot receipt does not bind the requested owner/project/scope/target ledger.",
    );
  }
}

function decisionForResult(result: ConversionResult): JsonObject {
  return {
    conversion_id: result.conversion_id,
    entity: result.entity,
    input_hashes: result.hashes,
    disposition: result.disposition,
    reason_codes: result.reason_codes,
    expected_operation: result.expected_operation,
    before_sha256: result.before_sha256,
    desired_sha256: result.desired_sha256,
    dependencies: result.dependencies,
    dependency_action_ids: result.dependency_action_ids,
    evidence: result.evidence,
    terminal_success: result.terminal_success,
    preserved_paths: result.merge.preserved_paths,
    applied_paths: result.merge.applied_paths,
    noise_paths: result.merge.noise_paths,
  };
}

function validateCompositionAlgebra({
  schemaRuntime,
  results,
  orderedActions,
  noWrites,
  holds,
  delta,
  contract,
  dependencyClosure,
  events,
  terminalExclusions,
}: {
  schemaRuntime: SchemaRuntime;
  results: ConversionResult[];
  orderedActions: ConversionResult[];
  noWrites: JsonObject[];
  holds: JsonObject[];
  delta: JsonValue[];
  contract: ExecutionContract | null;
  dependencyClosure: JsonObject;
  events: ConversionEvent[];
  terminalExclusions: TerminalSuccessBinding[];
}): { terminal_replay_zero: boolean } {
  noWrites.forEach((row, index) =>
    assertSchema(schemaRuntime, "noWriteRow", row, `no-write[${index}]`),
  );
  holds.forEach((row, index) => assertSchema(schemaRuntime, "holdRow", row, `hold[${index}]`));
  assertSchema(schemaRuntime, "dependencyClosure", dependencyClosure, "dependency closure");
  if (contract) assertSchema(schemaRuntime, "cliContract", contract, "CLI execution contract");
  events.forEach((event, index) =>
    assertSchema(schemaRuntime, "conversionEvent", event, `event[${index}]`),
  );

  if (
    results.length !== noWrites.length + holds.length + orderedActions.length ||
    orderedActions.length !== delta.length ||
    events.length !== results.length ||
    new Set(results.map((result) => result.conversion_id)).size !== results.length
  ) {
    throw new Error("Incremental change-set disposition algebra failed.");
  }
  const terminalPairs = new Set<string>(
    terminalExclusions.map((entry) => terminalPairKey(entry.action_id, entry.desired_sha256)),
  );
  const consumedTerminalPairs = new Set<string>(
    results
      .filter((result) => result.terminal_success != null)
      .map((result) =>
        terminalPairKey(
          result.terminal_success!.action_id,
          result.terminal_success!.desired_sha256,
        ),
      ),
  );
  const replayedTerminalActions = orderedActions.filter((result) =>
    terminalPairs.has(terminalPairKey(result.action_id!, result.desired_sha256!)),
  );
  const terminalReplayZero =
    terminalPairs.size === terminalExclusions.length &&
    consumedTerminalPairs.size === terminalExclusions.length &&
    [...terminalPairs].every((pair) => consumedTerminalPairs.has(pair)) &&
    replayedTerminalActions.length === 0;
  if (!terminalReplayZero) {
    throw new Error("Terminal exclusion consumption/replay algebra failed.");
  }
  const earlierActionIds = new Set<string>();
  for (const [index, result] of orderedActions.entries()) {
    if (
      !["INSERT", "UPDATE"].includes(result.disposition) ||
      sha256Json(delta[index]) !== result.desired_sha256 ||
      result.action_id == null ||
      terminalPairs.has(terminalPairKey(result.action_id, result.desired_sha256)) ||
      (result.disposition === "INSERT" && result.before_sha256 !== null) ||
      (result.disposition === "UPDATE" && !SHA256_PATTERN.test(result.before_sha256 ?? "")) ||
      result.dependency_action_ids.some((actionId) => !earlierActionIds.has(actionId))
    ) {
      throw new Error(`Action algebra failed for ${result.conversion_id}.`);
    }
    earlierActionIds.add(result.action_id);
  }
  for (const result of results) {
    if (result.disposition === "NOOP") {
      const validAbsent =
        result.reason_codes.includes("NOOP_ALREADY_ABSENT") &&
        result.current_payload == null &&
        result.desired_payload == null;
      const validExact =
        result.current_payload != null &&
        result.desired_payload != null &&
        exact(result.current_payload, result.desired_payload);
      const validTerminal = result.terminal_success != null;
      if (!validAbsent && !validExact && !validTerminal) {
        throw new Error(`NOOP algebra failed for ${result.conversion_id}.`);
      }
    }
    if (
      result.disposition === "HOLD" &&
      (result.action_id !== null || result.expected_operation !== null)
    ) {
      throw new Error(`HOLD algebra failed for ${result.conversion_id}.`);
    }
  }
  let previous = null;
  for (const [index, event] of events.entries()) {
    const result = results[index];
    const { event_sha256: eventSha256, ...unsignedEvent } = event;
    if (
      event.previous_event_sha256 !== previous ||
      !exact(event.evidence, result.evidence) ||
      !exact(event.outcome.terminal_success, result.terminal_success) ||
      event.decision_binding_sha256 !== sha256Json(decisionForResult(result)) ||
      eventSha256 !== sha256Json(unsignedEvent)
    ) {
      throw new Error(`Conversion event hash chain failed at sequence ${index + 1}.`);
    }
    previous = eventSha256;
  }
  return { terminal_replay_zero: terminalReplayZero };
}

function materializeArtifacts({
  outDir,
  request,
  results,
  orderedActions,
  inputFacts,
  schemaRuntime,
  terminalExclusions,
}: {
  outDir: string;
  request: IncrementalRequest;
  results: ConversionResult[];
  orderedActions: ConversionResult[];
  inputFacts: InputFacts;
  schemaRuntime: SchemaRuntime;
  terminalExclusions: TerminalSuccessBinding[];
}) {
  const paths = {
    request: path.join(outDir, "incremental-change-set-request.snapshot.json"),
    events: path.join(outDir, "incremental-change-set-conversion-events.jsonl"),
    delta: path.join(outDir, "incremental-change-set-delta.jsonl"),
    noWrite: path.join(outDir, "incremental-change-set-no-write.jsonl"),
    holds: path.join(outDir, "incremental-change-set-holds.jsonl"),
    dependencies: path.join(outDir, "incremental-change-set-dependency-closure.json"),
    cliInput: path.join(outDir, "dataset-save-draft-input.jsonl"),
    contract: path.join(outDir, "dataset-save-draft-execution-contract.json"),
    report: path.join(outDir, "incremental-change-set-report.json"),
    manifest: path.join(outDir, "incremental-change-set-manifest.json"),
  };
  const noWrites = results
    .filter((result) => result.disposition === "NOOP")
    .map((result) => ({
      schema_version: "foundry-incremental-change-set-no-write-row.v1",
      conversion_id: result.conversion_id,
      entity: result.entity,
      reason_codes: result.reason_codes,
      current_sha256: result.hashes.current.payload_sha256,
      desired_sha256: result.desired_sha256,
    }));
  const holds = results
    .filter((result) => result.disposition === "HOLD")
    .map((result) => ({
      schema_version: "foundry-incremental-change-set-hold-row.v1",
      conversion_id: result.conversion_id,
      entity: result.entity,
      reason_codes: result.reason_codes,
      dependency_dispositions: result.dependency_dispositions,
      conflicts: result.merge.conflicts,
      forbidden_paths: result.merge.forbidden_paths ?? [],
    }));
  const delta: JsonValue[] = orderedActions.map((result) => result.desired_payload!);
  const contract: ExecutionContract | null = orderedActions.length
    ? {
        schema_version: CLI_CONTRACT_SCHEMA,
        execution_id: request.change_set_id,
        project_ref: request.project_ref,
        target_mode: "owner_draft",
        owner: {
          user_id: request.owner.user_id,
          email: request.owner.email.toLowerCase(),
          state_code: 0,
        },
        actions: orderedActions.map((result) => ({
          action_id: result.action_id,
          desired_sha256: result.desired_sha256,
          expected_operation: result.expected_operation,
          table: result.entity.table,
          id: result.entity.id,
          version: result.entity.version,
          before_sha256: result.before_sha256,
          dependency_action_ids: result.dependency_action_ids,
        })),
      }
    : null;
  const dependencyRows = results.flatMap((result) =>
    result.dependency_dispositions.map((dependency) => ({
      conversion_id: result.conversion_id,
      ...dependency,
    })),
  );
  const dependencyClosure: JsonObject = {
    schema_version: DEPENDENCY_SCHEMA,
    ordered_conversion_ids: orderedActions.map((result) => result.conversion_id),
    edges: dependencyRows,
  };

  const outputRows = new Map<string, JsonObject>();
  orderedActions.forEach((result, index) =>
    outputRows.set(result.conversion_id, {
      artifact: path.basename(paths.delta),
      line: index + 1,
      row_sha256: sha256Json(delta[index]),
    }),
  );
  noWrites.forEach((row, index) =>
    outputRows.set(row.conversion_id, {
      artifact: path.basename(paths.noWrite),
      line: index + 1,
      row_sha256: sha256Json(row),
    }),
  );
  holds.forEach((row, index) =>
    outputRows.set(row.conversion_id, {
      artifact: path.basename(paths.holds),
      line: index + 1,
      row_sha256: sha256Json(row),
    }),
  );

  let previousEventSha256: string | null = null;
  const events: ConversionEvent[] = results
    .sort((left, right) => left.input_sequence - right.input_sequence)
    .map((result, index) => {
      const decision = decisionForResult(result);
      const event = {
        schema_version: EVENT_SCHEMA,
        sequence: index + 1,
        terminal: true,
        input_sequence: result.input_sequence,
        conversion_id: result.conversion_id,
        entity: result.entity,
        input_refs: {
          comparison_line: result.source_line,
          comparison_raw_sha256: result.source_raw_sha256,
          owner_snapshot_receipt_sha256: inputFacts.owner_snapshot_receipt.sha256,
          ...result.hashes,
        },
        normalization: {
          noise_paths: result.merge.noise_paths,
        },
        curation: {
          preserved_paths: result.merge.preserved_paths,
          conflict_paths: result.merge.conflicts.map((conflict) => conflict.pointer),
        },
        evidence: result.evidence,
        diff: {
          applied_paths: result.merge.applied_paths,
          forbidden_paths: result.merge.forbidden_paths ?? [],
        },
        outcome: {
          disposition: result.disposition,
          reason_codes: result.reason_codes,
          expected_operation: result.expected_operation,
          before_sha256: result.before_sha256,
          desired_sha256: result.desired_sha256,
          action_id: result.action_id,
          terminal_success: result.terminal_success,
          executable: false,
        },
        dependencies: {
          declared_conversion_ids: result.dependencies,
          dispositions: result.dependency_dispositions,
          dependency_action_ids: result.dependency_action_ids,
        },
        duration_ms: result.duration_ms,
        recorded_at_utc: new Date().toISOString(),
        output: outputRows.get(result.conversion_id),
        decision_binding_sha256: sha256Json(decision),
        previous_event_sha256: previousEventSha256,
      } as Omit<ConversionEvent, "event_sha256"> & { event_sha256?: string };
      event.event_sha256 = sha256Json(event);
      previousEventSha256 = event.event_sha256;
      return event as ConversionEvent;
    });
  const counts = {
    universe: results.length,
    insert: results.filter((result) => result.disposition === "INSERT").length,
    update: results.filter((result) => result.disposition === "UPDATE").length,
    no_write: noWrites.length,
    hold: holds.length,
    actions: orderedActions.length,
    delta_rows: delta.length,
    conversion_log_rows: events.length,
    delete_actions: 0,
  };
  const trustReasons = results
    .flatMap((result) => result.reason_codes)
    .filter((reason) => TRUST_BOUNDARY_REASONS.has(reason));
  const findings = { p0: [...new Set(trustReasons)].length, p1: 0 };
  const validatedAlgebra = validateCompositionAlgebra({
    schemaRuntime,
    results,
    orderedActions,
    noWrites,
    holds,
    delta,
    contract,
    dependencyClosure,
    events,
    terminalExclusions,
  });
  const algebraPassed = true;
  const status =
    !algebraPassed || findings.p0 > 0
      ? "rejected"
      : counts.hold > 0
        ? "completed_with_holds"
        : counts.actions === 0
          ? "completed_no_actions"
          : "completed";
  const report = {
    schema_version: REPORT_SCHEMA,
    status,
    production_authority: false,
    change_set_id: request.change_set_id,
    project_ref: request.project_ref,
    target_mode: "owner_draft",
    owner: request.owner,
    consumer: request.consumer,
    counts,
    findings,
    algebra: {
      passed: algebraPassed,
      equation: "insert + update + no_write + hold = universe",
      actions_equal_delta: counts.actions === counts.delta_rows,
      events_equal_universe: counts.conversion_log_rows === counts.universe,
      delete_actions_zero: true,
      terminal_replay_zero: validatedAlgebra.terminal_replay_zero,
      hash_chain_valid: true,
    },
    blockers: [
      ...new Set(
        results
          .filter((result) => result.disposition === "HOLD")
          .flatMap((result) => result.reason_codes),
      ),
    ],
    files: {
      request: path.basename(paths.request),
      events: path.basename(paths.events),
      delta: path.basename(paths.delta),
      no_write: path.basename(paths.noWrite),
      holds: path.basename(paths.holds),
      dependency_closure: path.basename(paths.dependencies),
      cli_input: contract ? path.basename(paths.cliInput) : null,
      execution_contract: contract ? path.basename(paths.contract) : null,
      manifest: path.basename(paths.manifest),
    },
    examples: Object.fromEntries(
      ["INSERT", "UPDATE", "NOOP", "HOLD"].map((disposition) => [
        disposition.toLowerCase(),
        results
          .filter((result) => result.disposition === disposition)
          .slice(0, 5)
          .map((result) => result.conversion_id),
      ]),
    ),
    execution_requirements: {
      cli_contract_present: contract != null,
      ordered_batch: true,
      support_action_count: orderedActions.filter((result) =>
        ["unitgroups", "flowproperties"].includes(result.entity.table),
      ).length,
      allow_account_local_support: orderedActions.some((result) =>
        ["unitgroups", "flowproperties"].includes(result.entity.table),
      ),
    },
    rerun: {
      allowed: true,
      condition:
        "Only offline inputs or policy may be corrected; a fresh output directory is required.",
      command:
        "node scripts/foundry.ts dataset-incremental-change-set-compose --request <file> --out-dir <fresh-directory>",
    },
    next_gate:
      "Fresh SELECT-only reconciliation, fresh owner session, independent review, and execution-capsule admission are required before separately authorized CLI execution.",
    dispatch_counts: { network: 0, database: 0, cli: 0, dml: 0 },
  };
  assertSchema(schemaRuntime, "report", report, "incremental change-set report");

  fs.mkdirSync(outDir, { recursive: false, mode: 0o700 });
  fs.chmodSync(outDir, 0o700);
  writeJson(paths.request, request);
  writeJsonLines(paths.delta, delta);
  writeJsonLines(paths.noWrite, noWrites);
  writeJsonLines(paths.holds, holds);
  writeJson(paths.dependencies, dependencyClosure);
  writeJsonLines(paths.events, events);
  if (contract) {
    writeJsonLines(paths.cliInput, delta);
    writeJson(paths.contract, contract);
  }
  writeJson(paths.report, report);

  const artifacts = [
    artifactFacts(paths.request, 1, REQUEST_SCHEMA),
    artifactFacts(paths.events, events.length, EVENT_SCHEMA),
    artifactFacts(paths.delta, delta.length, "tidas-payload-jsonl.v1"),
    artifactFacts(paths.noWrite, noWrites.length, "foundry-incremental-change-set-no-write-row.v1"),
    artifactFacts(paths.holds, holds.length, "foundry-incremental-change-set-hold-row.v1"),
    artifactFacts(paths.dependencies, dependencyRows.length, DEPENDENCY_SCHEMA),
    ...(contract
      ? [
          artifactFacts(paths.cliInput, delta.length, "tidas-payload-jsonl.v1"),
          artifactFacts(paths.contract, contract.actions.length, CLI_CONTRACT_SCHEMA),
        ]
      : []),
    artifactFacts(paths.report, 1, REPORT_SCHEMA),
  ];
  const manifest = {
    schema_version: MANIFEST_SCHEMA,
    status,
    production_authority: false,
    change_set_id: request.change_set_id,
    input_artifacts: inputFacts,
    output_artifacts: artifacts,
    output_binding_sha256: sha256Json(artifacts),
    counts,
    findings,
  };
  assertSchema(schemaRuntime, "manifest", manifest, "incremental change-set manifest");
  writeJson(paths.manifest, manifest);
  for (const artifact of artifacts) {
    const actual = artifactFacts(
      path.join(outDir, artifact.path),
      artifact.rows,
      artifact.schema_version,
    );
    if (
      actual.bytes !== artifact.bytes ||
      actual.sha256 !== artifact.sha256 ||
      actual.rows !== artifact.rows
    ) {
      throw new Error(`Post-write artifact verification failed for ${artifact.path}.`);
    }
  }
  const manifestFacts = artifactFacts(paths.manifest, 1, MANIFEST_SCHEMA);
  return { report, manifest: manifestFacts, paths };
}

export function createIncrementalChangeSetCommands({ repoRoot }: { repoRoot: string }) {
  async function runDatasetIncrementalChangeSetCompose(options: ComposeOptions = {}) {
    if (options.help) return commandHelp();
    const schemaRuntime = createSchemaValidators(repoRoot);
    const requestPath = resolveInputInside(repoRoot, options.request, "--request");
    const outDir = resolveFreshOutputInside(repoRoot, options.outDir, "--out-dir");
    const request = readJson(requestPath) as unknown as IncrementalRequest;
    assertSchema(schemaRuntime, "request", request, "incremental change-set request");
    validateRequest(request);
    const comparisonsRef = verifyArtifactRef(
      repoRoot,
      request.input_artifacts?.comparisons,
      "comparisons",
      true,
    );
    const ownerRef = verifyArtifactRef(
      repoRoot,
      request.input_artifacts?.owner_snapshot,
      "owner_snapshot",
      true,
    );
    const ownerReceiptRef = verifyArtifactRef(
      repoRoot,
      request.input_artifacts?.owner_snapshot_receipt,
      "owner_snapshot_receipt",
      false,
    );
    const policyRef = verifyArtifactRef(
      repoRoot,
      request.input_artifacts?.preservation_policy,
      "preservation_policy",
      false,
    );
    const terminalRef = request.input_artifacts?.terminal_exclusions
      ? verifyArtifactRef(
          repoRoot,
          request.input_artifacts.terminal_exclusions,
          "terminal_exclusions",
          true,
        )
      : null;
    const policy = readJson(policyRef.filePath) as unknown as PreservationPolicy;
    assertSchema(schemaRuntime, "preservationPolicy", policy, "preservation policy");
    validatePolicy(policy, request);
    const ownerReceipt = readJson(ownerReceiptRef.filePath) as unknown as OwnerSnapshotReceipt;
    assertSchema(schemaRuntime, "ownerSnapshotReceipt", ownerReceipt, "owner snapshot receipt");
    const comparisonRows = readJsonLinesWithMeta<ComparisonRow>(comparisonsRef.filePath).map(
      ({ value, line, raw_sha256: rawSha256 }) => {
        assertSchema(schemaRuntime, "comparisonRow", value, `comparison line ${line}`);
        return { ...value, __line: line, __raw_sha256: rawSha256 };
      },
    );
    const ownerRows = new Map<string, OwnerRow[]>();
    const ownerSnapshotLines = new Map<string, Array<{ line: number; raw_sha256: string }>>();
    for (const { value, line, raw_sha256: rawSha256 } of readJsonLinesWithMeta<OwnerRow>(
      ownerRef.filePath,
    )) {
      assertSchema(schemaRuntime, "ownerRow", value, `owner snapshot line ${line}`);
      if (
        value.project_ref !== request.project_ref ||
        value.payload_sha256 !== sha256Json(value.json_ordered)
      ) {
        throw new Error(`Owner snapshot line ${line} has a project or payload binding mismatch.`);
      }
      const key = entityKey(normalizedEntity(value.entity));
      const rows = ownerRows.get(key) ?? [];
      rows.push(value);
      ownerRows.set(key, rows);
      const lines = ownerSnapshotLines.get(key) ?? [];
      lines.push({ line, raw_sha256: rawSha256 });
      ownerSnapshotLines.set(key, lines);
    }
    const conversionIds = comparisonRows.map((row) => asToken(row.conversion_id));
    const targetKeys = comparisonRows.map((row) => entityKey(normalizedEntity(row.entity)));
    const duplicateConversions = duplicateValues(conversionIds);
    const duplicateTargets = duplicateValues(targetKeys);
    const requestedTargets = new Set(request.scope.allowed_target_keys);
    const inputTargets = new Set(targetKeys);
    if (
      requestedTargets.size !== inputTargets.size ||
      [...requestedTargets].some((key) => !inputTargets.has(key))
    ) {
      throw new Error("Request allowed_target_keys must exactly equal comparison targets.");
    }
    for (const key of ownerRows.keys()) {
      if (!requestedTargets.has(key)) {
        throw new Error(`Owner snapshot contains an out-of-scope target: ${key}`);
      }
    }
    validateOwnerSnapshotReceipt(ownerReceipt, request, ownerRef.facts, ownerSnapshotLines);
    const results = comparisonRows.map((comparison, index) =>
      preliminaryResult({
        comparison,
        inputSequence: index + 1,
        ownerRows,
        policy,
        request,
        policySha256: policyRef.facts.sha256,
        duplicateConversions,
        duplicateTargets,
      }),
    );
    const terminalPairs = new Set<string>();
    const terminalActionIds = new Set<string>();
    const terminalExclusions: TerminalSuccessBinding[] = [];
    if (terminalRef) {
      for (const { value, line } of readJsonLinesWithMeta<TerminalExclusion>(
        terminalRef.filePath,
      )) {
        assertSchema(schemaRuntime, "terminalExclusion", value, `terminal exclusion line ${line}`);
        if (!value.action_id.endsWith(`@${value.desired_sha256}`)) {
          throw new Error(
            `Terminal exclusion line ${line} does not bind action_id to desired_sha256.`,
          );
        }
        const pair = terminalPairKey(value.action_id, value.desired_sha256);
        if (terminalPairs.has(pair) || terminalActionIds.has(value.action_id)) {
          throw new Error(`Terminal exclusion line ${line} is duplicated or contradictory.`);
        }
        const successReceipt = verifyTerminalSuccessReceipt(repoRoot, value, line, schemaRuntime);
        terminalPairs.add(pair);
        terminalActionIds.add(value.action_id);
        terminalExclusions.push(successReceipt);
      }
    }
    consumeTerminalExclusions(results, terminalExclusions);
    let orderedActions = orderAndCloseDependencies(results, policy);
    const hasTrustBoundaryFailure = results.some((result) =>
      result.reason_codes.some((reason) => TRUST_BOUNDARY_REASONS.has(reason)),
    );
    if (hasTrustBoundaryFailure) {
      for (const result of orderedActions) {
        result.disposition = "HOLD";
        result.reason_codes = ["HOLD_GLOBAL_ADMISSION_REJECTED"];
        result.expected_operation = null;
        result.action_id = null;
        result.dependency_action_ids = [];
      }
      orderedActions = [];
      assignDependencyDispositions(results);
    }
    const inputFacts = {
      request: artifactFacts(requestPath, 1, REQUEST_SCHEMA),
      comparisons: comparisonsRef.facts,
      owner_snapshot: ownerRef.facts,
      owner_snapshot_receipt: ownerReceiptRef.facts,
      policy: policyRef.facts,
      terminal_exclusions: terminalRef?.facts ?? null,
    };
    const materialized = materializeArtifacts({
      outDir,
      request,
      results,
      orderedActions,
      inputFacts,
      schemaRuntime,
      terminalExclusions,
    });
    return {
      status: materialized.report.status,
      production_authority: false,
      out_dir: path.relative(repoRoot, outDir).split(path.sep).join(path.posix.sep),
      counts: materialized.report.counts,
      findings: materialized.report.findings,
      manifest: materialized.manifest,
      remote_write_mode: "read-only",
      dispatch_counts: materialized.report.dispatch_counts,
    };
  }

  return { runDatasetIncrementalChangeSetCompose };
}

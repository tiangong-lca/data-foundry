import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { repoRoot, testTmpRoot, writeJson, writeJsonLines } from "./foundry-core.ts";

const version = "01.00.000";
const allTables = [
  "contacts",
  "unitgroups",
  "flowproperties",
  "sources",
  "flows",
  "processes",
] as const;

type FixtureTable = keyof typeof tableShape;
type JsonRecord = Record<string, unknown>;

interface FixtureScope {
  allowed_tables: string[];
  allowed_target_keys: string[];
  allowed_update_pointer_prefixes: Record<string, string[]>;
  allow_account_local_support: boolean;
}

interface FileFacts {
  path: string;
  sha256: string;
  bytes: number;
  rows?: number;
}

interface FixtureComparisonRow extends JsonRecord {
  schema_version: string;
  conversion_id: string;
  entity: { table: FixtureTable; id: string; version: string };
  old_payload: unknown;
  new_payload: unknown;
  old_payload_sha256: string | null;
  candidate_payload_sha256: string | null;
  dependency_conversion_ids: string[];
}

interface FixtureOwner {
  user_id: string;
  email: string;
  [key: string]: unknown;
}

interface FixtureOwnerRow extends JsonRecord {
  schema_version: string;
  project_ref: string;
  entity: { table: FixtureTable; id: string; version: string };
  json_ordered: unknown;
  payload_sha256: string;
  role: string;
  owner: FixtureOwner;
  state_code: number;
}

interface FixtureBoundRule extends JsonRecord {
  entity_key: string;
  pointer: string;
  old_value_sha256: string;
  candidate_value_sha256: string;
  current_value_sha256: string;
  evidence_sha256: string;
}

interface FixtureBoundRuleInput extends JsonRecord {
  entityKey: string;
  pointer: string;
  oldValue: unknown;
  candidateValue: unknown;
  currentValue: unknown;
  evidence?: unknown;
}

interface FixtureTablePolicy {
  allow_insert: boolean;
  allow_update: boolean;
  semantic_noise_rules: FixtureBoundRule[];
  conflict_rules: FixtureBoundRule[];
  array_merge_rules: FixtureBoundRule[];
}

interface FixturePolicy extends JsonRecord {
  schema_version: string;
  semantic_domain: string;
  type_rank: string[];
  table_policies: Record<string, FixtureTablePolicy>;
}

interface TerminalSuccessReceiptReference extends JsonRecord {
  path: string;
  schema_version: string;
  status: string;
  bytes: number;
  sha256: string;
}

interface TerminalExclusion extends JsonRecord {
  action_id?: unknown;
  desired_sha256?: unknown;
  evidence_sha256?: unknown;
  success_receipt?: TerminalSuccessReceiptReference | null;
}

interface FixtureSettings {
  allowAccountLocalSupport: boolean;
  allowedTables: FixtureTable[] | null;
  allowedUpdatePointerPrefixes: Record<string, string[]>;
  receiptOverrides: JsonRecord;
  terminalReceiptReferenceOverrides: JsonRecord;
  requestOverrides: JsonRecord;
}

interface FixtureMutationContext {
  comparisons: FixtureComparisonRow[];
  ids: Record<string, string>;
  owner: FixtureOwner;
  ownerRows: FixtureOwnerRow[];
  policy: FixturePolicy;
  projectRef: string;
  settings: FixtureSettings;
  terminalExclusions: TerminalExclusion[];
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([key, child]) => [key, stableValue(child)]),
    );
  }
  return value;
}

export function fixtureSha256Json(value: unknown): string {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(stableValue(value)))
    .digest("hex");
}

function rawJsonLineSha256(value: unknown): string {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function canonicalScope(scope: FixtureScope): FixtureScope {
  return {
    allowed_tables: [...scope.allowed_tables].sort(),
    allowed_target_keys: [...scope.allowed_target_keys].sort(),
    allowed_update_pointer_prefixes: Object.fromEntries(
      Object.entries(scope.allowed_update_pointer_prefixes)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([table, pointers]) => [table, [...pointers].sort()]),
    ),
    allow_account_local_support: scope.allow_account_local_support,
  };
}

export function fixtureValueSha256(value: unknown): string {
  return fixtureSha256Json(
    value === undefined
      ? { schema_version: "foundry-bound-value.v1", presence: "missing" }
      : { schema_version: "foundry-bound-value.v1", presence: "present", value },
  );
}

function fileFacts(filePath: string, jsonLines: boolean): FileFacts {
  const bytes = fs.readFileSync(filePath);
  const rows = jsonLines
    ? fs
        .readFileSync(filePath, "utf8")
        .split(/\r?\n/u)
        .filter((line) => line.trim()).length
    : undefined;
  return {
    path: path.relative(repoRoot, filePath),
    sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
    bytes: bytes.byteLength,
    ...(jsonLines ? { rows } : {}),
  };
}

const tableShape = {
  contacts: ["contactDataSet", "contactInformation"],
  unitgroups: ["unitGroupDataSet", "unitGroupInformation"],
  flowproperties: ["flowPropertyDataSet", "flowPropertiesInformation"],
  sources: ["sourceDataSet", "sourceInformation"],
  flows: ["flowDataSet", "flowInformation"],
  processes: ["processDataSet", "processInformation"],
} as const;

function dataSetInformationPointer(table: FixtureTable): string {
  const [rootKey, informationKey] = tableShape[table];
  return `/${rootKey}/${informationKey}/dataSetInformation`;
}

export function fixtureEntityKey(table: FixtureTable, id: string, entityVersion = version): string {
  return `${table}/${id}@${entityVersion}`;
}

export function fixturePayload(
  table: FixtureTable,
  id: string,
  fields: JsonRecord = {},
  entityVersion = version,
) {
  const [rootKey, informationKey] = tableShape[table];
  return {
    [rootKey]: {
      [informationKey]: {
        dataSetInformation: {
          "common:UUID": id,
          ...fields,
        },
      },
      administrativeInformation: {
        publicationAndOwnership: { "common:dataSetVersion": entityVersion },
      },
    },
  };
}

export function fixtureComparison(
  conversionId: string,
  table: FixtureTable,
  id: string,
  oldPayload: unknown,
  newPayload: unknown,
  dependencies: string[] = [],
  entityVersion = version,
): FixtureComparisonRow {
  return {
    schema_version: "foundry-incremental-change-set-comparison-row.v1",
    conversion_id: conversionId,
    entity: { table, id, version: entityVersion },
    old_payload: oldPayload,
    new_payload: newPayload,
    old_payload_sha256: oldPayload == null ? null : fixtureSha256Json(oldPayload),
    candidate_payload_sha256: newPayload == null ? null : fixtureSha256Json(newPayload),
    dependency_conversion_ids: dependencies,
  };
}

export function fixtureOwnerRow(
  table: FixtureTable,
  id: string,
  payload: unknown,
  owner: FixtureOwner,
  projectRef = "fixture-project-ref",
  stateCode = 0,
  entityVersion = version,
): FixtureOwnerRow {
  return {
    schema_version: "foundry-incremental-change-set-owner-row.v1",
    project_ref: projectRef,
    entity: { table, id, version: entityVersion },
    json_ordered: payload,
    payload_sha256: fixtureSha256Json(payload),
    role: "writable_target",
    owner: { ...owner },
    state_code: stateCode,
  };
}

export function fixtureBoundRule({
  entityKey,
  pointer,
  oldValue,
  candidateValue,
  currentValue,
  evidence = { source: "fixture-policy-evidence" },
  ...rest
}: FixtureBoundRuleInput): FixtureBoundRule {
  return {
    entity_key: entityKey,
    pointer,
    old_value_sha256: fixtureValueSha256(oldValue),
    candidate_value_sha256: fixtureValueSha256(candidateValue),
    current_value_sha256: fixtureValueSha256(currentValue),
    evidence_sha256: fixtureSha256Json(evidence),
    ...rest,
  };
}

function emptyTablePolicy(): FixtureTablePolicy {
  return {
    allow_insert: true,
    allow_update: true,
    semantic_noise_rules: [],
    conflict_rules: [],
    array_merge_rules: [],
  };
}

export function createIncrementalChangeSetFixture(
  name: string,
  mutate: (context: FixtureMutationContext) => void = () => {},
) {
  const root = testTmpRoot(`incremental-change-set-${name}`);
  fs.rmSync(root, { recursive: true, force: true });
  fs.mkdirSync(root, { recursive: true });
  const projectRef = "fixture-project-ref";
  const owner = {
    user_id: "10000000-0000-4000-8000-000000000001",
    email: "fixture-owner@example.test",
  };
  const ids = {
    contact: "10000000-0000-4000-8000-000000000010",
    unitgroup: "10000000-0000-4000-8000-000000000011",
    flowproperty: "10000000-0000-4000-8000-000000000019",
    flow: "10000000-0000-4000-8000-000000000012",
    newProcess: "10000000-0000-4000-8000-000000000013",
    noiseSource: "10000000-0000-4000-8000-000000000014",
    numericProcess: "10000000-0000-4000-8000-000000000015",
    curatedSource: "10000000-0000-4000-8000-000000000016",
    deletedSource: "10000000-0000-4000-8000-000000000017",
    independentProcess: "10000000-0000-4000-8000-000000000018",
  };
  const ug = fixturePayload("unitgroups", ids.unitgroup, { name: "Mass" });
  const flow = fixturePayload("flows", ids.flow, { name: "Product flow" });
  const newProcess = fixturePayload("processes", ids.newProcess, { name: "New process" });
  const noiseOld = fixturePayload("sources", ids.noiseSource, {
    name: "Noise source",
    amount: "1",
  });
  const noiseNew = fixturePayload("sources", ids.noiseSource, {
    name: "Noise source",
    amount: "1.0",
  });
  const numericOld = fixturePayload("processes", ids.numericProcess, {
    name: "Numeric process",
    amount: 1,
  });
  const numericNew = fixturePayload("processes", ids.numericProcess, {
    name: "Numeric process",
    amount: 2,
  });
  const curatedOld = fixturePayload("sources", ids.curatedSource, {
    name: "Original",
    curatedName: "Original",
  });
  const curatedCurrent = fixturePayload("sources", ids.curatedSource, {
    name: "Original",
    curatedName: "Reviewed owner value",
  });
  const deleted = fixturePayload("sources", ids.deletedSource, { name: "Retained source" });
  const independentOld = fixturePayload("processes", ids.independentProcess, {
    name: "Independent",
    amount: 10,
  });
  const independentNew = fixturePayload("processes", ids.independentProcess, {
    name: "Independent",
    amount: 11,
  });

  const comparisons = [
    fixtureComparison("ug-exact", "unitgroups", ids.unitgroup, ug, ug),
    fixtureComparison("flow-create", "flows", ids.flow, null, flow, ["ug-exact"]),
    fixtureComparison("process-create", "processes", ids.newProcess, null, newProcess, [
      "flow-create",
    ]),
    fixtureComparison("source-noise", "sources", ids.noiseSource, noiseOld, noiseNew),
    fixtureComparison(
      "process-numeric-update",
      "processes",
      ids.numericProcess,
      numericOld,
      numericNew,
    ),
    fixtureComparison("source-curated", "sources", ids.curatedSource, curatedOld, curatedOld),
    fixtureComparison("source-delete", "sources", ids.deletedSource, deleted, null),
    fixtureComparison(
      "process-independent-update",
      "processes",
      ids.independentProcess,
      independentOld,
      independentNew,
    ),
  ];
  const ownerRows = [
    fixtureOwnerRow("unitgroups", ids.unitgroup, ug, owner, projectRef),
    fixtureOwnerRow("sources", ids.noiseSource, noiseOld, owner, projectRef),
    fixtureOwnerRow("processes", ids.numericProcess, numericOld, owner, projectRef),
    fixtureOwnerRow("sources", ids.curatedSource, curatedCurrent, owner, projectRef),
    fixtureOwnerRow("sources", ids.deletedSource, deleted, owner, projectRef),
    fixtureOwnerRow("processes", ids.independentProcess, independentOld, owner, projectRef),
  ];
  const noisePointer = `${dataSetInformationPointer("sources")}/amount`;
  const curatedPointer = `${dataSetInformationPointer("sources")}/curatedName`;
  const policy: FixturePolicy = {
    schema_version: "foundry-incremental-change-set-preservation-policy.v1",
    semantic_domain: "fixture-incremental-semantic.v1",
    type_rank: [...allTables],
    table_policies: Object.fromEntries(allTables.map((table) => [table, emptyTablePolicy()])),
  };
  policy.table_policies.sources.semantic_noise_rules.push(
    fixtureBoundRule({
      entityKey: fixtureEntityKey("sources", ids.noiseSource),
      pointer: noisePointer,
      oldValue: "1",
      candidateValue: "1.0",
      currentValue: "1",
      transform_id: "decimal_lexical_equivalence_v1",
      evidence: { reason: "decimal lexical spelling only" },
    }),
  );
  policy.table_policies.sources.conflict_rules.push(
    fixtureBoundRule({
      entityKey: fixtureEntityKey("sources", ids.curatedSource),
      pointer: curatedPointer,
      oldValue: "Original",
      candidateValue: "Original",
      currentValue: "Reviewed owner value",
      mode: "preserve_owner",
      evidence: { reason: "reviewed owner curation" },
    }),
  );
  const terminalExclusions: TerminalExclusion[] = [];
  const settings: FixtureSettings = {
    allowAccountLocalSupport: false,
    allowedTables: null,
    allowedUpdatePointerPrefixes: Object.fromEntries(
      allTables.map((table) => [table, [dataSetInformationPointer(table)]]),
    ),
    receiptOverrides: {},
    terminalReceiptReferenceOverrides: {},
    requestOverrides: {},
  };

  mutate({
    comparisons,
    ids,
    owner,
    ownerRows,
    policy,
    projectRef,
    settings,
    terminalExclusions,
  });

  const allowedTables = settings.allowedTables ?? [
    ...new Set(comparisons.map((row) => row.entity.table)),
  ];
  for (const table of Object.keys(policy.table_policies)) {
    if (!allowedTables.includes(table as FixtureTable)) delete policy.table_policies[table];
  }
  policy.type_rank = policy.type_rank.filter((table) =>
    allowedTables.includes(table as FixtureTable),
  );
  const allowedTargetKeys = new Set(
    comparisons.map((row) => fixtureEntityKey(row.entity.table, row.entity.id, row.entity.version)),
  );
  for (const tablePolicy of Object.values(policy.table_policies)) {
    for (const field of ["semantic_noise_rules", "conflict_rules", "array_merge_rules"] as const) {
      tablePolicy[field] = tablePolicy[field].filter((rule) =>
        allowedTargetKeys.has(rule.entity_key),
      );
    }
  }

  const scope = {
    allowed_tables: allowedTables,
    allowed_target_keys: [...allowedTargetKeys],
    allowed_update_pointer_prefixes: Object.fromEntries(
      allowedTables.map((table) => [table, settings.allowedUpdatePointerPrefixes[table] ?? []]),
    ),
    allow_account_local_support: settings.allowAccountLocalSupport,
  };

  const comparisonsPath = path.join(root, "comparisons.jsonl");
  const ownerPath = path.join(root, "owner.jsonl");
  const policyPath = path.join(root, "policy.json");
  const receiptPath = path.join(root, "owner-snapshot-receipt.json");
  const requestPath = path.join(root, "request.json");
  const outDir = path.join(root, "out");
  writeJsonLines(comparisonsPath, comparisons);
  writeJsonLines(ownerPath, ownerRows);
  writeJson(policyPath, policy);
  const ownerFacts = fileFacts(ownerPath, true);
  const canonicalTargetKeys = [...allowedTargetKeys].sort();
  const ownerRowsByKey = new Map<string, FixtureOwnerRow[]>();
  for (const row of ownerRows) {
    const key = fixtureEntityKey(row.entity.table, row.entity.id, row.entity.version);
    const rows = ownerRowsByKey.get(key) ?? [];
    rows.push(row);
    ownerRowsByKey.set(key, rows);
  }
  const receipt = {
    schema_version: "foundry-incremental-change-set-owner-snapshot-receipt.v1",
    project_ref: projectRef,
    owner: { ...owner, state_code: 0 },
    snapshot: {
      sha256: ownerFacts.sha256,
      bytes: ownerFacts.bytes,
      rows: ownerFacts.rows,
    },
    scope_binding: {
      allowed_target_keys: canonicalTargetKeys,
      allowed_target_keys_sha256: fixtureSha256Json(canonicalTargetKeys),
      canonical_scope_sha256: fixtureSha256Json(canonicalScope(scope)),
    },
    target_ledger: canonicalTargetKeys.map((key) => {
      const rows = ownerRowsByKey.get(key) ?? [];
      return {
        entity_key: key,
        presence: rows.length === 1 ? "present" : "absent",
        snapshot_row_sha256: rows.length === 1 ? rawJsonLineSha256(rows[0]) : null,
      };
    }),
    captured_at_utc: "2026-07-23T00:00:00.000Z",
    query_fingerprint_sha256: fixtureSha256Json({ query: "fixture-owner-select-v1" }),
    deployment_fingerprint_sha256: fixtureSha256Json({ deployment: "fixture-deployment-v1" }),
    ...settings.receiptOverrides,
  };
  writeJson(receiptPath, receipt);
  const inputArtifacts: Record<string, FileFacts> = {
    comparisons: fileFacts(comparisonsPath, true),
    owner_snapshot: ownerFacts,
    owner_snapshot_receipt: fileFacts(receiptPath, false),
    preservation_policy: fileFacts(policyPath, false),
  };
  const request: JsonRecord & { input_artifacts: Record<string, FileFacts> } = {
    schema_version: "foundry-incremental-change-set-request.v1",
    change_set_id: `fixture-${name}`,
    producer_id: "fixture-projector",
    project_ref: projectRef,
    target_mode: "owner_draft",
    production_authority: false,
    owner: { ...owner, state_code: 0 },
    scope,
    input_artifacts: inputArtifacts,
    consumer: {
      schema_version: "dataset-save-draft-execution-contract.v1",
      cli_version: "0.0.31",
      toolchain_fingerprint_sha256: crypto.createHash("sha256").update("fixture-cli").digest("hex"),
    },
    ...settings.requestOverrides,
  };
  if (terminalExclusions.length) {
    terminalExclusions.forEach((row, index) => {
      if (row.success_receipt == null) {
        const successReceiptPath = path.join(root, `terminal-success-${index + 1}.json`);
        const successReceipt = {
          schema_version: "foundry-incremental-change-set-terminal-success-receipt.v1",
          status: "success",
          action_id: row.action_id,
          desired_sha256: row.desired_sha256,
        };
        writeJson(successReceiptPath, successReceipt);
        const facts = fileFacts(successReceiptPath, false);
        row.success_receipt = {
          path: facts.path,
          schema_version: successReceipt.schema_version,
          status: successReceipt.status,
          bytes: facts.bytes,
          sha256: facts.sha256,
          ...settings.terminalReceiptReferenceOverrides,
        };
      }
      delete row.evidence_sha256;
    });
    const terminalPath = path.join(root, "terminal-exclusions.jsonl");
    writeJsonLines(terminalPath, terminalExclusions);
    request.input_artifacts.terminal_exclusions = fileFacts(terminalPath, true);
  }
  writeJson(requestPath, request);
  return {
    comparisons,
    comparisonsPath,
    ids,
    outDir,
    owner,
    ownerPath,
    ownerRows,
    policy,
    policyPath,
    projectRef,
    receipt,
    receiptPath,
    request,
    requestPath,
    root,
  };
}

export {
  allTables as fixtureTables,
  dataSetInformationPointer as fixtureUpdatePointer,
  version as fixtureVersion,
};

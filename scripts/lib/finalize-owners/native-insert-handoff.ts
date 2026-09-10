import fs from "node:fs";
import path from "node:path";
import { createFileArtifactFact } from "../foundry-command-spec.ts";
import { sha256Json, sha256Text } from "../identity-preflight-proof.ts";
import { datasetIdentity } from "../import-curation/internal/dataset-payload.ts";
import { readRows } from "../import-curation/internal/runtime-io.ts";

type JsonRecord = Record<string, unknown>;

function fail(message: string): never {
  throw new Error(`--execution-contract-file: ${message}`);
}

function object(value: unknown): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return fail("Expected a native contract object.");
  return value as JsonRecord;
}

function token(value: unknown): string {
  if (typeof value !== "string" || !value.trim())
    return fail("Contract identity fields must be non-empty strings.");
  return value.trim();
}

export function assertExecutionContractSelection(options: JsonRecord): void {
  if (
    Object.keys(options).some(
      (key) => key.startsWith("executionContract") && key !== "executionContractFile",
    ) ||
    (Object.hasOwn(options, "executionContractFile") &&
      (typeof options.executionContractFile !== "string" ||
        options.executionContractFile.trim().length === 0))
  )
    fail("Use one non-empty string selection; unsupported options or repeated values are invalid.");
}

/** Consumer admission only; CLI owns parsing at execution, attempts and readback. */
export function readNativeInsertHandoff(input: {
  contractFile: string;
  rowsFile: string;
  datasetType: string;
  targetUserId: string;
  verifiedProjectRef: string;
  stateCode: string;
  relativePath: (file: string) => string;
}) {
  const tables: Record<string, string> = { flow: "flows", process: "processes", source: "sources" };
  if (!Object.hasOwn(tables, input.datasetType) || input.stateCode !== "0")
    fail("Native insert handoffs support only Flow, Process and Source owner drafts.");
  if (!fs.lstatSync(input.contractFile).isFile()) fail("Select a regular contract file.");
  const bytes = fs.readFileSync(input.contractFile, "utf8");
  const raw = object(JSON.parse(bytes));
  const owner = object(raw.owner);
  if (
    raw.schema_version !== "dataset-save-draft-execution-contract.v1" ||
    raw.target_mode !== "owner_draft" ||
    owner.state_code !== 0 ||
    token(owner.user_id) !== input.targetUserId
  )
    fail("Contract protocol, owner or draft scope does not match the handoff.");
  const projectRef = token(raw.project_ref);
  if (input.verifiedProjectRef && projectRef !== input.verifiedProjectRef)
    fail("Contract project does not match the verified account context.");
  const rowsText = fs.readFileSync(input.rowsFile, "utf8");
  const rows = readRows(input.rowsFile, () => rowsText);
  if (!Array.isArray(raw.actions) || !rows.length || raw.actions.length !== rows.length)
    fail("Contract actions must match every selected final row exactly once.");
  const actionIds = new Set<string>();
  const targets = new Set<string>();
  const actions = raw.actions.map((value: unknown, index: number) => {
    const action = object(value);
    const actionId = token(action.action_id);
    const identity = datasetIdentity(rows[index], index, input.datasetType);
    const root = object(object(identity.payload)[`${input.datasetType}DataSet`]);
    const info = object(object(root[`${input.datasetType}Information`]).dataSetInformation);
    const publication = object(object(root.administrativeInformation).publicationAndOwnership);
    const id = token(info["common:UUID"]);
    const version = token(publication["common:dataSetVersion"]);
    const target = JSON.stringify([id, version]);
    if (
      actionIds.has(actionId) ||
      targets.has(target) ||
      action.expected_operation !== "insert" ||
      action.before_sha256 !== null ||
      action.table !== tables[input.datasetType] ||
      token(action.id) !== id ||
      token(action.version) !== version ||
      identity.id !== id ||
      identity.version !== version ||
      action.desired_sha256 !== sha256Json(identity.payload)
    )
      fail("Contract insert action does not bind the exact final payload and identity.");
    if (!Array.isArray(action.dependency_action_ids)) fail("Action dependencies must be explicit.");
    const dependencies = action.dependency_action_ids.map(token);
    if (
      new Set(dependencies).size !== dependencies.length ||
      dependencies.some((id) => !actionIds.has(id))
    )
      fail("Dependencies must identify unique earlier contract actions.");
    actionIds.add(actionId);
    targets.add(target);
    return {
      action_id: actionId,
      desired_sha256: action.desired_sha256,
      expected_operation: "insert" as const,
      table: tables[input.datasetType],
      id,
      version,
      before_sha256: null,
      dependency_action_ids: dependencies,
    };
  });
  // Project the native owner's normalized wire fields for its report digest.
  // Raw file bytes are bound separately, so ignored metadata cannot drift.
  const contract = {
    schema_version: "dataset-save-draft-execution-contract.v1",
    execution_id: token(raw.execution_id),
    project_ref: projectRef,
    target_mode: "owner_draft",
    owner: {
      user_id: token(owner.user_id),
      email: token(owner.email).toLowerCase(),
      state_code: 0,
    },
    actions,
  };
  const artifact = createFileArtifactFact({
    role: "execution_contract",
    path: input.relativePath(input.contractFile),
    filePath: input.contractFile,
  });
  if (artifact.sha256 !== sha256Text(bytes)) fail("Contract bytes changed during admission.");
  return {
    artifact,
    contract,
    canonical_sha256: sha256Json(contract),
    rows_sha256: sha256Text(rowsText),
  };
}

export function reserveNativeHandoffDirectory(directory: string): void {
  fs.mkdirSync(path.dirname(directory), { recursive: true });
  fs.mkdirSync(directory);
}

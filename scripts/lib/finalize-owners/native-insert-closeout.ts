import { parseFoundryCommandSpec } from "../foundry-command-spec.ts";
import { sha256Json } from "../identity-preflight-proof.ts";
import { readNativeInsertHandoff } from "./native-insert-handoff.ts";

type JsonRecord = Record<string, unknown>;

function requireEvidence(condition: unknown): asserts condition {
  if (!condition) throw new Error("Native insert completion evidence is missing or inconsistent.");
}

function object(value: unknown): JsonRecord {
  requireEvidence(value && typeof value === "object" && !Array.isArray(value));
  return value as JsonRecord;
}

export function validateNativeInsertCloseout(input: {
  handoff: JsonRecord;
  report: JsonRecord;
  rowsFile: string;
  datasetType: string;
  targetUserId: string;
  stateCode: string;
  expectedRows: number;
  resolveFile: (value: unknown) => string | null;
  relativePath: (file: string) => string;
}): boolean {
  if (!Object.hasOwn(input.handoff, "execution_contract")) {
    requireEvidence(!Object.hasOwn(input.report, "execution_contract"));
    return false;
  }
  const binding = object(input.handoff.execution_contract);
  const artifact = object(binding.artifact);
  const contractFile = input.resolveFile(artifact.path);
  requireEvidence(contractFile && binding.operation === "insert");
  const native = readNativeInsertHandoff({
    contractFile,
    rowsFile: input.rowsFile,
    datasetType: input.datasetType,
    targetUserId: input.targetUserId,
    verifiedProjectRef: String(input.handoff.verified_project_ref ?? ""),
    stateCode: input.stateCode,
    relativePath: input.relativePath,
  });
  requireEvidence(
    sha256Json(artifact) === sha256Json(native.artifact) &&
      binding.canonical_sha256 === native.canonical_sha256 &&
      binding.execution_id === native.contract.execution_id &&
      binding.project_ref === native.contract.project_ref,
  );
  const rowsArtifact = object(input.handoff.final_rows_artifact);
  requireEvidence(rowsArtifact.sha256 === native.rows_sha256);
  const commands = object(input.handoff.commands);
  for (const key of ["commit", "post_write_verify"]) {
    const spec = parseFoundryCommandSpec(commands[key]);
    for (const expected of [artifact, rowsArtifact]) {
      const matching = spec.binding.artifacts.filter(
        (fact) => input.resolveFile(fact.path) === input.resolveFile(expected.path),
      );
      requireEvidence(
        matching.length === 1 &&
          matching[0].sha256 === expected.sha256 &&
          matching[0].bytes === expected.bytes,
      );
    }
    if (key === "commit") {
      const positions = spec.argv.flatMap((value, index) =>
        value === "--execution-contract" ? [index] : [],
      );
      requireEvidence(
        positions.length === 1 && input.resolveFile(spec.argv[positions[0] + 1]) === contractFile,
      );
      const typeFlag = spec.argv.indexOf("--type");
      requireEvidence(
        typeFlag >= 2 &&
          spec.argv[typeFlag - 2] === "dataset" &&
          spec.argv[typeFlag - 1] === "save-draft" &&
          spec.argv[typeFlag + 1] === input.datasetType,
      );
    }
  }
  const report = input.report;
  const contractReport = object(report.execution_contract);
  const counts = object(report.counts);
  const actions = native.contract.actions;
  requireEvidence(actions.length === input.expectedRows && input.expectedRows > 0);
  requireEvidence(
    report.schema_version === 2 &&
      report.mode === "commit" &&
      report.commit === true &&
      report.status === "completed" &&
      report.requested_type === input.datasetType &&
      input.resolveFile(report.input_path) === input.resolveFile(input.rowsFile) &&
      input.resolveFile(contractReport.path) === contractFile &&
      contractReport.sha256 === native.canonical_sha256 &&
      contractReport.execution_id === native.contract.execution_id &&
      contractReport.target_mode === "owner_draft" &&
      counts.selected === actions.length &&
      counts.executed === actions.length &&
      counts.attempts_consumed === actions.length &&
      counts.failed === 0 &&
      counts.unknown === 0 &&
      counts.blocked === 0 &&
      Array.isArray(report.rows) &&
      report.rows.length === actions.length,
  );
  for (const [index, action] of actions.entries()) {
    const row = object(report.rows[index]);
    requireEvidence(
      row.index === index &&
        row.type === input.datasetType &&
        row.table === action.table &&
        row.id === action.id &&
        row.version === action.version &&
        row.action_id === action.action_id &&
        row.desired_sha256 === action.desired_sha256 &&
        row.status === "executed" &&
        row.operation === "insert" &&
        row.attempt_consumed === true &&
        row.replayed === false &&
        row.readback === "desired_exact",
    );
  }
  return true;
}

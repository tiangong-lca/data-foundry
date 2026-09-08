import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import {
  FoundryContextError,
  resolveFoundryOutput,
  type FoundryRuntimeContext,
} from "./foundry-runtime-context.ts";
import type { ArtifactEntry } from "./foundry-task-types.ts";
import { readTaskBytes } from "./foundry-task-io.ts";

export interface WorkflowRowSet {
  type: string;
  file: string;
  count: number;
}
export interface WorkflowArtifact<T> {
  entry: ArtifactEntry;
  file: string;
  value: T;
}
export interface WorkflowRows {
  schema: "tiangong-foundry.rows-stage.v1";
  status: "completed";
  sets: WorkflowRowSet[];
  identity_reports: string[];
  identity_rewrite_reports: string[];
}
export interface WorkflowAssessment {
  schema: "tiangong-foundry.assessment-stage.v1";
  status: string;
  owner_base: string;
  rows_report?: string;
  identity_report?: string | null;
  sets: Array<Record<string, unknown>>;
}

export function workflowObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new FoundryContextError(
      "workflow_report_invalid",
      "Workflow metadata must be an object.",
    );
  return value as Record<string, unknown>;
}

export function readWorkflowArtifact(
  context: FoundryRuntimeContext,
  entry: ArtifactEntry,
): WorkflowArtifact<Record<string, unknown>> {
  const file = resolveFoundryOutput(context, entry.path);
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.size > 8 * 1024 * 1024 || stat.size !== entry.bytes)
      throw new FoundryContextError(
        "workflow_artifact_changed",
        "Workflow artifact size or identity changed.",
      );
    const bytes = fs.readFileSync(fd);
    if (
      bytes.length !== entry.bytes ||
      createHash("sha256").update(bytes).digest("hex") !== entry.sha256
    )
      throw new FoundryContextError(
        "workflow_artifact_changed",
        "Workflow artifact content changed.",
      );
    return { entry, file, value: workflowObject(JSON.parse(bytes.toString("utf8"))) };
  } finally {
    fs.closeSync(fd);
  }
}

export function currentWorkflowState(
  context: FoundryRuntimeContext,
  entries: readonly ArtifactEntry[],
) {
  const rowEntry = entries.findLast(
    (entry) =>
      ["dataset-workflow-rows", "dataset-semantic-apply"].includes(entry.command) &&
      path.basename(entry.path) === "foundry-rows.json",
  );
  let rows: WorkflowArtifact<WorkflowRows> | null = null;
  if (rowEntry) {
    const found = readWorkflowArtifact(context, rowEntry);
    if (
      found.value.schema !== "tiangong-foundry.rows-stage.v1" ||
      found.value.status !== "completed" ||
      !Array.isArray(found.value.sets)
    )
      throw new FoundryContextError("workflow_rows_invalid", "Registered row metadata is invalid.");
    const sets = found.value.sets.map((value) => {
      const set = workflowObject(value);
      if (
        typeof set.type !== "string" ||
        typeof set.file !== "string" ||
        !Number.isSafeInteger(set.count) ||
        Number(set.count) < 0
      )
        throw new FoundryContextError("workflow_rows_invalid", "A registered row set is invalid.");
      return { type: set.type, file: set.file, count: Number(set.count) };
    });
    const retainedReports = (key: string): string[] => {
      const value = found.value[key] ?? [];
      if (!Array.isArray(value) || value.some((item) => typeof item !== "string"))
        throw new FoundryContextError(
          "workflow_rows_invalid",
          "Identity report references are invalid.",
        );
      return value as string[];
    };
    rows = {
      ...found,
      value: {
        schema: "tiangong-foundry.rows-stage.v1",
        status: "completed",
        sets,
        identity_reports: retainedReports("identity_reports"),
        identity_rewrite_reports: retainedReports("identity_rewrite_reports"),
      },
    };
  }
  let identity: WorkflowArtifact<Record<string, unknown>> | null = null;
  if (rows) {
    for (const entry of [...entries].reverse()) {
      if (
        entry.command !== "dataset-workflow-identity" ||
        path.basename(entry.path) !== "foundry-identity.json"
      )
        continue;
      const found = readWorkflowArtifact(context, entry);
      if (
        found.value.schema !== "tiangong-foundry.identity-stage.v1" ||
        !Array.isArray(found.value.sets)
      )
        throw new FoundryContextError(
          "workflow_identity_invalid",
          "Registered identity metadata is invalid.",
        );
      if (found.value.rows_report === rows.file) {
        identity = found;
        break;
      }
    }
  }
  let assessment: WorkflowArtifact<WorkflowAssessment> | null = null;
  if (rows) {
    for (const entry of [...entries].reverse()) {
      if (
        entry.command !== "dataset-workflow-assessment" ||
        path.basename(entry.path) !== "foundry-assessment.json"
      )
        continue;
      const found = readWorkflowArtifact(context, entry),
        value = found.value;
      if (
        value.schema !== "tiangong-foundry.assessment-stage.v1" ||
        typeof value.owner_base !== "string" ||
        !Array.isArray(value.sets)
      )
        throw new FoundryContextError(
          "workflow_assessment_invalid",
          "Registered assessment metadata is invalid.",
        );
      const sets = value.sets.map(workflowObject);
      const matchingRows =
        sets.length === rows.value.sets.length &&
        rows.value.sets.every((row) =>
          sets.some((set) => set.type === row.type && set.rows === row.file),
        );
      if (
        (value.rows_report === undefined || value.rows_report === rows.file) &&
        matchingRows &&
        (value.identity_report ?? null) ===
          (identity?.value.status === "completed" ? identity.file : null)
      ) {
        assessment = {
          ...found,
          value: {
            schema: "tiangong-foundry.assessment-stage.v1",
            status: String(value.status),
            owner_base: value.owner_base,
            rows_report: rows.file,
            identity_report: identity?.value.status === "completed" ? identity.file : null,
            sets,
          },
        };
        break;
      }
    }
  }
  let finalization: WorkflowArtifact<Record<string, unknown>> | null = null;
  if (rows && assessment) {
    for (const entry of [...entries].reverse()) {
      if (
        entry.command !== "dataset-workflow-finalize" ||
        path.basename(entry.path) !== "foundry-finalize.json"
      )
        continue;
      const found = readWorkflowArtifact(context, entry);
      if (
        found.value.schema !== "tiangong-foundry.finalize-stage.v1" ||
        !Array.isArray(found.value.sets) ||
        !Array.isArray(found.value.blockers)
      )
        throw new FoundryContextError(
          "workflow_finalize_invalid",
          "Registered finalization metadata is invalid.",
        );
      if (
        found.value.rows_report === rows.file &&
        found.value.assessment_report === assessment.file
      ) {
        finalization = found;
        break;
      }
    }
  }
  let authorization: WorkflowArtifact<Record<string, unknown>> | null = null;
  let preparedApproval: WorkflowArtifact<Record<string, unknown>> | null = null;
  if (finalization && fs.existsSync(path.join(context.taskRoot!, "authorization.json"))) {
    const pointer = createHash("sha256")
      .update(readTaskBytes(context, "authorization.json"))
      .digest("hex");
    for (const entry of [...entries].reverse()) {
      if (
        entry.command !== "dataset-workflow-authorization" ||
        path.basename(entry.path) !== "foundry-authorization.json"
      )
        continue;
      const found = readWorkflowArtifact(context, entry);
      if (found.value.schema !== "tiangong-foundry.authorization-stage.v1")
        throw new FoundryContextError(
          "workflow_authorization_invalid",
          "Registered approval metadata is invalid.",
        );
      const prepared =
        finalization.value.approval_source_sha256 === entry.sha256 &&
        found.value.input_kind === "current_rows";
      if (prepared) preparedApproval = found;
      if (
        (found.value.finalization_sha256 === finalization.entry.sha256 || prepared) &&
        found.value.pointer_sha256 === pointer &&
        typeof found.value.expires_at_utc === "string" &&
        Date.parse(found.value.expires_at_utc) > Date.now()
      ) {
        authorization = found;
        break;
      }
    }
  }
  return { rows, assessment, identity, finalization, authorization, preparedApproval };
}

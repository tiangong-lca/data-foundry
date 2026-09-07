import fs from "node:fs";
import path from "node:path";
import { createFoundryDecisionOwners } from "./foundry-decision-owners.ts";
import { decisionTargetPath } from "./foundry-decision-routing.ts";
import { resolveInstalledTiangongLcaCliPackage } from "./foundry-runtime-utils.ts";
import { workflowObject } from "./foundry-workflow-state.ts";
import { unwrapDatasetPayload } from "./import-curation/internal/dataset-payload.ts";
import type { FoundryRuntimeContext } from "./foundry-runtime-context.ts";
import type { QualifiedFoundryRuntime } from "./foundry-runtime-qualification.ts";

export interface FoundryDecisionWork {
  kind: "classification" | "location" | "identity";
  type: string;
  rows: string;
  task: string;
  queue: string | null;
  status: string;
  blockers: unknown[];
}

export function prepareFoundryDecisionWork(
  context: FoundryRuntimeContext,
  qualified: QualifiedFoundryRuntime,
  temporary: string,
  request: {
    type: string;
    rows: string;
    gateReport: string;
    contract: Record<string, unknown>;
    outDir: string;
  },
): FoundryDecisionWork[] {
  const owners = createFoundryDecisionOwners(context, qualified, temporary);
  const gate = workflowObject(JSON.parse(fs.readFileSync(request.gateReport, "utf8")));
  const classification = new Map<string, Record<string, unknown>>(),
    locations = new Map<string, Record<string, unknown>>();
  let needsIdentity = false;
  for (const value of Array.isArray(gate.entities) ? gate.entities : []) {
    const entity = workflowObject(value);
    if (typeof entity.authoring_package !== "string") continue;
    const file = path.resolve(context.assetRoot, entity.authoring_package);
    const pkg = workflowObject(JSON.parse(fs.readFileSync(file, "utf8")));
    const payload = workflowObject(unwrapDatasetPayload(pkg.source_row, request.type));
    for (const actionValue of Array.isArray(pkg.action_items) ? pkg.action_items : []) {
      const action = workflowObject(actionValue),
        kind = action.action_kind;
      if (kind === "identity_decision_authoring") {
        needsIdentity = true;
        continue;
      }
      const base = {
        dataset_type: request.type,
        dataset_id: entity.entity_id,
        dataset_version: entity.version,
        source_file: request.rows,
        code: action.code,
        evidence: action.evidence ?? null,
      };
      if (kind === "classification_decision_authoring") {
        const schemaType =
          request.type === "flow" ? owners.flowClassificationSchemaType(payload) : request.type;
        classification.set(`${String(entity.entity_id)}:${String(entity.version)}:${schemaType}`, {
          ...base,
          current_classification: action.evidence ?? null,
          classification_workflow: {
            schema_type: schemaType,
            row_type: request.type,
            commands: {
              input_rows: request.rows,
              output_rows: path.join(request.outDir, "classification", "classified.rows.json"),
            },
          },
        });
      } else if (kind === "location_decision_authoring" && typeof action.path === "string") {
        const target = decisionTargetPath(action.path);
        locations.set(`${String(entity.entity_id)}:${String(entity.version)}:${target}`, {
          ...base,
          path: target,
          location_workflow: {
            schema_type: "location",
            commands: {
              input_rows: request.rows,
              output_rows: path.join(request.outDir, "location", "located.rows.json"),
            },
          },
        });
      }
    }
  }
  const cli = resolveInstalledTiangongLcaCliPackage();
  const schemas = fs
    .readdirSync(cli.schemaDir)
    .filter((name) => /^tidas_.*_category\.json$/u.test(name))
    .map((name) => path.join(cli.schemaDir, name));
  const result: FoundryDecisionWork[] = [];
  for (const [kind, rows] of [
    ["classification", [...classification.values()]],
    ["location", [...locations.values()]],
  ] as const) {
    if (!rows.length) continue;
    const outDir = path.join(request.outDir, kind);
    fs.mkdirSync(outDir, { recursive: true });
    const queue = path.join(outDir, `${kind}-queue.jsonl`);
    fs.writeFileSync(queue, rows.map((row) => JSON.stringify(row)).join("\n") + "\n");
    const options = {
      [`${kind}Queue`]: queue,
      rowsFile: request.rows,
      outDir,
      schemaFile: request.contract.schema,
      yamlFile: request.contract.methodology,
      rulesetFile: request.contract.ruleset,
      classificationSchema: schemas.filter(
        (file) => !file.endsWith("tidas_locations_category.json"),
      ),
      locationSchema: path.join(cli.schemaDir, "tidas_locations_category.json"),
    };
    const built = owners.invoke(() =>
      kind === "classification"
        ? owners.classification.runDatasetClassificationDecisionTaskBuild(options as never)
        : owners.location.runDatasetLocationDecisionTaskBuild(options as never),
    );
    const task = workflowObject(built),
      files = workflowObject(task.files);
    result.push({
      kind,
      type: request.type,
      rows: request.rows,
      task: path.resolve(context.assetRoot, String(files.task)),
      queue: path.resolve(context.assetRoot, String(task[`${kind}_queue`])),
      status: String(task.status),
      blockers: Array.isArray(task.blockers) ? task.blockers : [],
    });
  }
  if (needsIdentity) {
    const task = workflowObject(
      owners.invoke(() =>
        owners.identityTask.runDatasetIdentityDecisionTaskBuild({
          curationGateReport: request.gateReport,
          rowsFile: request.rows,
          outDir: path.join(request.outDir, "identity"),
        }),
      ),
    );
    const files = workflowObject(task.files);
    result.push({
      kind: "identity",
      type: request.type,
      rows: request.rows,
      task: path.resolve(context.assetRoot, String(files.task)),
      queue: null,
      status: String(task.status),
      blockers: Array.isArray(task.blockers) ? task.blockers : [],
    });
  }
  return result;
}

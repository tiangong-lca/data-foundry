import fs from "node:fs";
import path from "node:path";
import {
  FoundryContextError,
  readFoundryInput,
  resolveFoundryAsset,
  resolveFoundryOutput,
  captureFoundryInput,
  type FoundryRuntimeContext,
} from "./foundry-runtime-context.ts";
import {
  assertQualifiedFoundryRuntime,
  type QualifiedFoundryRuntime,
} from "./foundry-runtime-qualification.ts";
import { copyFoundryIsolatedExecutable } from "./foundry-runtime-environment.ts";
import { createFoundryIsolatedChildEnvironment } from "./foundry-runtime-environment.ts";
import { runFoundryTaskOperation } from "./foundry-task-store.ts";
import { runTidasRowsValidation } from "./tidas-adapter.ts";
import { runDatasetCurationGate } from "./import-curation/curation-gate.ts";
import { runDatasetAuthoringTaskBuild } from "./import-curation/authoring-packages.ts";
import {
  createWorkflowStageDirectory,
  registerWorkflowStageFiles,
  runWorkflowLocalCli,
} from "./foundry-workflow-io.ts";

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new FoundryContextError("workflow_report_invalid", "Stage metadata must be an object.");
  return value as Record<string, unknown>;
}

export function assessFoundryWorkflowRows(
  context: FoundryRuntimeContext,
  qualified: QualifiedFoundryRuntime,
  rowsReport: string,
  contextReports: readonly string[],
) {
  assertQualifiedFoundryRuntime(context, qualified);
  resolveFoundryAsset(context, "specs/prewrite-content-policy.json");
  resolveFoundryAsset(context, "specs/import-profiles.json");
  return runFoundryTaskOperation(
    context,
    {
      command: "dataset-workflow-assessment",
      options: { rows_report: rowsReport, context_reports: contextReports },
    },
    (operation) => {
      for (const input of context.inputs) readFoundryInput(context, input.path);
      const rows = record(JSON.parse(readFoundryInput(context, rowsReport).toString("utf8")));
      if (rows.schema !== "tiangong-foundry.rows-stage.v1" || !Array.isArray(rows.sets))
        throw new FoundryContextError(
          "workflow_rows_invalid",
          "Select the current registered row sets.",
        );
      const contracts = new Map<string, Record<string, unknown>>();
      for (const file of contextReports) {
        const value = record(JSON.parse(readFoundryInput(context, file).toString("utf8")));
        if (value.status !== "completed" || typeof value.type !== "string")
          throw new FoundryContextError(
            "workflow_context_invalid",
            "A contract pack is incomplete.",
          );
        contracts.set(value.type, record(value.files));
      }
      const output = createWorkflowStageDirectory(context, operation, "assessment");
      fs.mkdirSync(resolveFoundryOutput(context, "tmp"), { recursive: true, mode: 0o700 });
      const temporary = fs.mkdtempSync(path.join(context.tempRoot, "assessment-"));
      try {
        const executable = path.join(temporary, path.basename(qualified.tidas.executable_path));
        copyFoundryIsolatedExecutable(qualified.tidas.executable_path, executable);
        const actual = captureFoundryInput(executable),
          expected = qualified.tidas.expectation.executable;
        if (actual.bytes !== expected.bytes || actual.sha256 !== expected.sha256)
          throw new FoundryContextError(
            "runtime_tidas_unqualified",
            "Selected native bytes changed.",
          );
        const environment = createFoundryIsolatedChildEnvironment({ tempRoot: temporary });
        const selectedSets = rows.sets.map(record);
        const processes = selectedSets.find((set) => set.type === "process");
        let queueDir: string | undefined;
        if (processes) {
          if (typeof processes.file !== "string")
            throw new FoundryContextError("workflow_rows_invalid", "Process rows are missing.");
          queueDir = path.join(output, "queue");
          const args = [
            "dataset",
            "curation-queue",
            "build",
            "--processes",
            processes.file,
            "--out-dir",
            queueDir,
            "--json",
          ];
          for (const set of selectedSets) {
            if (typeof set.file !== "string")
              throw new FoundryContextError("workflow_rows_invalid", "A row set file is missing.");
            readFoundryInput(context, set.file);
            if (set.type === "flow") args.push("--flows", set.file);
            else if (["contact", "source", "unitgroup", "flowproperty"].includes(String(set.type)))
              args.push("--support", set.file);
          }
          runWorkflowLocalCli(context, qualified, temporary, args);
        }
        const assessed: Array<Record<string, unknown>> = [];
        for (const candidate of rows.sets) {
          const set = record(candidate);
          if (
            typeof set.type !== "string" ||
            typeof set.file !== "string" ||
            !contracts.has(set.type)
          )
            throw new FoundryContextError(
              "workflow_context_required",
              "Every row set needs its matching contract pack.",
            );
          readFoundryInput(context, set.file);
          const contract = contracts.get(set.type)!;
          const contractPath = (key: string) => {
            const file = contract[key];
            if (file === null || file === undefined) return null;
            if (typeof file !== "string")
              throw new FoundryContextError(
                "workflow_context_invalid",
                "Contract file reference is invalid.",
              );
            readFoundryInput(context, file);
            return file;
          };
          const schema = runTidasRowsValidation({
            repoRoot: context.assetRoot,
            options: {
              tidasBin: executable,
              rowsFile: set.file,
              type: set.type,
              outDir: path.join(output, set.type, "schema"),
            },
            environment,
          });
          if (typeof schema.report_file !== "string")
            throw new FoundryContextError(
              "workflow_schema_failed",
              "Native validation returned no compatible report.",
            );
          const qaDir = path.join(output, set.type, "qa");
          let qaReport: string;
          if (["flow", "process", "lifecyclemodel"].includes(set.type)) {
            const qa = runWorkflowLocalCli(context, qualified, temporary, [
              "qa",
              set.type,
              "--rows-file",
              set.file,
              "--out-dir",
              qaDir,
              "--json",
            ]);
            const file = record(qa.files).report;
            if (typeof file !== "string")
              throw new FoundryContextError("workflow_qa_failed", "QA returned no report file.");
            qaReport = file;
          } else {
            qaReport = path.join(qaDir, "qa-not-required.json");
            operation.writeJson(qaReport, {
              status: "not_required_for_support_rows",
              dataset_type: set.type,
            });
          }
          const gateDir = path.join(output, set.type, "curation");
          const gate = runDatasetCurationGate({
            repoRoot: context.assetRoot,
            options: {
              type: set.type,
              rowsFile: set.file,
              schemaReport: schema.report_file,
              qaReport,
              outDir: gateDir,
              includeExecutionCommands: false,
              profile: operation.job.target_profile,
              queueDir,
              requireQueueContext: Boolean(queueDir) && ["flow", "process"].includes(set.type),
              schemaFile: contractPath("schema"),
              yamlFile: contractPath("methodology"),
              rulesetFile: contractPath("ruleset"),
            },
          });
          const gateReport = path.join(gateDir, "dataset-curation-gate-report.json");
          const authoringDir = path.join(output, set.type, "authoring");
          const authoring = runDatasetAuthoringTaskBuild({
            repoRoot: context.assetRoot,
            options: {
              curationGateReport: gateReport,
              outDir: authoringDir,
              includeExecutionCommands: false,
            },
          });
          assessed.push({
            type: set.type,
            rows: set.file,
            schema_report: schema.report_file,
            qa_report: qaReport,
            curation_report: gateReport,
            curation_status: gate.status,
            curation_counts: gate.counts,
            authoring_manifest: path.join(authoringDir, "authoring-task-manifest.json"),
            authoring_status: authoring.status,
            authoring_counts: authoring.counts,
          });
        }
        for (const input of context.inputs) readFoundryInput(context, input.path);
        assertQualifiedFoundryRuntime(context, qualified);
        registerWorkflowStageFiles(context, operation, output);
        const report = {
          schema: "tiangong-foundry.assessment-stage.v1",
          status: "completed",
          owner_base: context.assetRoot,
          sets: assessed,
        };
        operation.writeJson(path.join(output, "foundry-assessment.json"), report);
        return report;
      } finally {
        fs.rmSync(temporary, { recursive: true, force: true });
      }
    },
  );
}

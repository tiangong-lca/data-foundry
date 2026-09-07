import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import {
  FoundryContextError,
  readFoundryInput,
  type FoundryRuntimeContext,
} from "./foundry-runtime-context.ts";
import type { QualifiedFoundryRuntime } from "./foundry-runtime-qualification.ts";
import { createFoundryDecisionOwners } from "./foundry-decision-owners.ts";
import { createFoundryIdentityOwners } from "./foundry-identity-owners.ts";
import { createFoundryRuntimeUtils } from "./foundry-runtime-utils.ts";
import { parseScalar } from "./foundry-args.ts";
import { createTidasRowUtils } from "./tidas-row-utils.ts";
import { bundleRowTypes } from "./bundle-row-types.ts";
import { createCanonicalSupportRewriteUtils } from "./canonical-support-rewrites.ts";
import { createIdentityReferenceRewriteUtils } from "./identity-reference-rewrite-utils.ts";
import { datasetIdentity } from "./import-curation/internal/dataset-payload.ts";
import { readRows, ensureArray } from "./import-curation/internal/runtime-io.ts";
import { workflowObject, type WorkflowRowSet } from "./foundry-workflow-state.ts";

const sha = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
function invalid(message: string): never {
  throw new FoundryContextError("task_semantic_identity_invalid", message);
}
function key(item: Record<string, unknown>) {
  return `${String(item.dataset_type)}:${String(item.dataset_id)}:${String(item.dataset_version)}`;
}

export function applyFoundryIdentityDecisions(
  context: FoundryRuntimeContext,
  qualified: QualifiedFoundryRuntime,
  temporary: string,
  request: {
    task: Record<string, unknown>;
    decisions: unknown[];
    sets: readonly WorkflowRowSet[];
    output: string;
  },
) {
  const task = request.task;
  const roster = new Map(
    ensureArray(task.identity_action_items).map((item) => {
      const value = workflowObject(item);
      return [key(value), value] as const;
    }),
  );
  const expectedContext = workflowObject(task.context_bundle).sha256;
  if (
    !roster.size ||
    typeof expectedContext !== "string" ||
    request.decisions.length !== roster.size
  )
    invalid("Submit every identity in the selected task with its current context bundle.");
  const seen = new Set<string>();
  const decisions: Record<string, unknown>[] = request.decisions.map((raw) => {
    const decision = workflowObject(raw),
      selected = roster.get(key(decision));
    if (!selected || seen.has(key(decision)))
      invalid("Identity submission scope differs from its task.");
    seen.add(key(decision));
    const authoring = workflowObject(decision.authoring_context);
    if (authoring.context_bundle_sha256 !== expectedContext)
      invalid("Identity decision context bundle differs from the current task.");
    const expectedPackage = path.resolve(context.assetRoot, String(selected.authoring_package));
    if (
      typeof decision.authoring_package !== "string" ||
      path.resolve(context.assetRoot, decision.authoring_package) !== expectedPackage ||
      decision.authoring_package_sha256 !== selected.authoring_package_sha256
    )
      invalid("Identity decisions must use their registered task snapshot and digest.");
    if (sha(readFoundryInput(context, expectedPackage)) !== selected.authoring_package_sha256)
      invalid("Identity authoring snapshot changed.");
    if (!request.sets.some((set) => set.type === decision.dataset_type))
      invalid("Identity decision has no current local row scope.");
    return { ...decision, authoring_package: expectedPackage };
  });
  const owners = createFoundryDecisionOwners(context, qualified, temporary);
  const next = new Map(request.sets.map((set) => [set.type, set]));
  const reports: string[] = [],
    rewriteReports: string[] = [],
    blockers: Record<string, unknown>[] = [];
  const decisionFile = path.join(request.output, "identity-decisions.jsonl");
  fs.mkdirSync(request.output, { recursive: true });
  fs.writeFileSync(decisionFile, decisions.map((item) => JSON.stringify(item)).join("\n") + "\n");
  for (const type of new Set(decisions.map((item) => String(item.dataset_type)))) {
    const set = next.get(type)!;
    readFoundryInput(context, set.file);
    const original = readRows(set.file);
    const rowKeys = new Set(
      original.map((row) => {
        const id = datasetIdentity(row, 0, type);
        return `${type}:${id.id}:${id.version}`;
      }),
    );
    if (decisions.some((item) => item.dataset_type === type && !rowKeys.has(key(item))))
      invalid("An identity decision does not identify a current row.");
    const result = workflowObject(
      owners.invoke(() =>
        owners.identity.runDatasetIdentityDecisionsApply({
          type,
          rowsFile: set.file,
          decisions: decisionFile,
          outDir: path.join(request.output, type),
          authoringPackageDir: path.resolve(
            context.assetRoot,
            String(workflowObject(task.files).authoring_package_snapshots_dir),
          ),
        } as never),
      ),
    );
    const files = workflowObject(result.files);
    const report = path.resolve(context.assetRoot, String(files.report));
    reports.push(report);
    const output = path.resolve(context.assetRoot, String(files.output_rows));
    const references = path.resolve(context.assetRoot, String(files.reference_rows));
    const unresolved = path.resolve(context.assetRoot, String(files.unresolved_reference_rows));
    const outputRows = readRows(output),
      referenceRows = readRows(references),
      unresolvedRows = readRows(unresolved);
    const inventory = (rows: unknown[]) => rows.map((row) => sha(JSON.stringify(row))).sort();
    if (
      JSON.stringify(inventory(original)) !==
      JSON.stringify(inventory([...outputRows, ...referenceRows, ...unresolvedRows]))
    )
      invalid("Identity output/reference/unresolved partitions do not preserve the input rows.");
    if (result.status !== "completed" || !Array.isArray(result.blockers) || result.blockers.length)
      blockers.push({ code: "semantic_identity_apply_blocked", type, report: result });
    if (unresolvedRows.length)
      blockers.push({
        code: "semantic_identity_unresolved",
        type,
        rows: unresolvedRows.length,
        report,
      });
    next.set(type, { ...set, file: output, count: outputRows.length });
  }
  if (blockers.length) return { sets: [...next.values()], reports, rewriteReports, blockers };
  const flowReport = reports.find(
    (file) => workflowObject(JSON.parse(fs.readFileSync(file, "utf8"))).dataset_type === "flow",
  );
  if (flowReport && next.has("process")) {
    const flow = workflowObject(JSON.parse(fs.readFileSync(flowReport, "utf8")));
    if (Number(workflowObject(flow.counts).identity_reference_rewrites) > 0) {
      const runtime = createFoundryRuntimeUtils({ parseScalar, repoRoot: context.assetRoot });
      const rows = createTidasRowUtils({ ...runtime, bundleRowTypes });
      const support = createCanonicalSupportRewriteUtils({
        ...runtime,
        ...rows,
      } as unknown as Parameters<typeof createCanonicalSupportRewriteUtils>[0]);
      const preflight = createFoundryIdentityOwners(context, qualified, "flow", {
        environment: {},
        cwd: temporary,
      }).preflight;
      const dependencies = {
        ...runtime,
        ...rows,
        ensureArray,
        supportText: support.supportText,
        foundryTraceNamespace: "https://tiangong-lca.dev/foundry/import-curation/1",
        identityPreflightCommands: preflight,
        datasetIdentity: (row: unknown, type: string) => datasetIdentity(row, 0, type),
      };
      const rewrites = createIdentityReferenceRewriteUtils(
        dependencies satisfies Record<
          keyof Parameters<typeof createIdentityReferenceRewriteUtils>[0],
          unknown
        > as unknown as Parameters<typeof createIdentityReferenceRewriteUtils>[0],
      );
      const set = next.get("process")!,
        outDir = path.join(request.output, "process-references");
      const result = workflowObject(
        rewrites.applyIdentityReferenceRewrites({
          datasetType: "process",
          rowsFile: set.file,
          outFile: path.join(outDir, "process.rows.jsonl"),
          outDir,
          options: { identityDecisionApplyReport: flowReport },
        }),
      );
      const report = path.join(outDir, "identity-reference-rewrites-report.json");
      fs.writeFileSync(
        report,
        JSON.stringify({ ...result, dataset_type: "process" }, null, 2) + "\n",
      );
      rewriteReports.push(report);
      const file = path.resolve(context.assetRoot, String(result.output_rows_file));
      if (
        !String(result.status).startsWith("completed") ||
        !Array.isArray(result.blockers) ||
        result.blockers.length ||
        readRows(file).length !== set.count
      )
        blockers.push({ code: "semantic_identity_rewrite_blocked", report: result });
      else next.set("process", { ...set, file });
    }
  }
  return { sets: [...next.values()], reports, rewriteReports, blockers };
}

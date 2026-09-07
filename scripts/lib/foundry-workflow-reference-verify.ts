import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  captureFoundryInput,
  FoundryContextError,
  readFoundryInput,
  resolveFoundryOutput,
  type FoundryRuntimeContext,
} from "./foundry-runtime-context.ts";
import {
  assertQualifiedFoundryRuntime,
  type QualifiedFoundryRuntime,
} from "./foundry-runtime-qualification.ts";
import {
  verifyFoundryRuntimeIdentity,
  type FoundryAuthentication,
} from "./foundry-runtime-identity.ts";
import { createFoundryAuthenticationEnvironment } from "./foundry-authentication-environment.ts";
import { resolveInstalledTiangongLcaCliPackage } from "./foundry-runtime-utils.ts";
import { createFoundryCommandSpec } from "./foundry-command-spec.ts";
import {
  currentWorkflowState,
  readWorkflowArtifact,
  workflowObject,
} from "./foundry-workflow-state.ts";
import { runFoundryTaskOperation } from "./foundry-task-store.ts";
import { registerWorkflowStageFiles } from "./foundry-workflow-io.ts";
import { sha256Json } from "./identity-preflight-proof.ts";
import { readRows } from "./import-curation/internal/runtime-io.ts";
import {
  datasetIdentity,
  unwrapDatasetPayload,
} from "./import-curation/internal/dataset-payload.ts";
import { bundleRowTypes, type BundleRowType } from "./bundle-row-types.ts";
import type { ArtifactEntry } from "./foundry-task-types.ts";

function invalid(message: string): never {
  throw new FoundryContextError("reference_evidence_invalid", message);
}

function indexedFile(
  context: FoundryRuntimeContext,
  entries: readonly ArtifactEntry[],
  file: string,
) {
  const resolved = resolveFoundryOutput(context, file);
  const entry = entries.find((item) => path.resolve(context.taskRoot!, item.path) === resolved);
  if (!entry) return invalid("Reference scope requires registered owner evidence.");
  const fact = captureFoundryInput(resolved);
  if (fact.sha256 !== entry.sha256 || fact.bytes !== entry.bytes)
    return invalid("Reference owner evidence changed.");
  return { entry, fact };
}

export function foundryReferenceScope(
  context: FoundryRuntimeContext,
  entries: readonly ArtifactEntry[],
) {
  const state = currentWorkflowState(context, entries);
  if (!state.rows) return null;
  const sources: ReturnType<typeof captureFoundryInput>[] = [];
  const targets = new Map<string, { table: string; id: string; version: string }>();
  for (const file of state.rows.value.identity_reports) {
    const source = indexedFile(context, entries, file);
    const report = readWorkflowArtifact(context, source.entry).value;
    const counts = workflowObject(report.counts),
      count = Number(counts.reference_rows ?? 0);
    if (!Number.isSafeInteger(count) || count < 0) invalid("Reference partition count is invalid.");
    if (!count) continue;
    if (report.status !== "completed" || !Array.isArray(report.blockers) || report.blockers.length)
      invalid("Reference partition has no successful identity decision.");
    const files = workflowObject(report.files),
      type = String(report.dataset_type) as BundleRowType;
    if (!Object.hasOwn(bundleRowTypes, type))
      invalid("Reference partition has an unsupported dataset type.");
    const references = indexedFile(
      context,
      entries,
      path.resolve(context.assetRoot, String(files.reference_rows)),
    );
    const rewrites = indexedFile(
      context,
      entries,
      path.resolve(context.assetRoot, String(files.identity_reference_rewrites)),
    );
    const rows = readRows(references.fact.path),
      decisions = readRows(rewrites.fact.path).map(workflowObject);
    if (rows.length !== count || decisions.length !== count)
      invalid("Every reference row needs exactly one canonical decision.");
    const original = rows
      .map((row, index) => {
        const id = datasetIdentity(unwrapDatasetPayload(row, type), index, type);
        return `${id.id}@${id.version}`;
      })
      .sort();
    const selected: string[] = [];
    for (const decision of decisions) {
      const canonical = workflowObject(decision.canonical),
        previous = workflowObject(decision.original);
      if (
        decision.action !== "reuse_ai_selected_existing_reference" ||
        decision.dataset_type !== type ||
        canonical.table !== bundleRowTypes[type].plural ||
        previous.table !== canonical.table ||
        typeof canonical.ref_object_id !== "string" ||
        !canonical.ref_object_id ||
        typeof canonical.version !== "string" ||
        !canonical.version
      )
        invalid("Canonical reference decision does not match its owning partition.");
      selected.push(`${String(previous.ref_object_id)}@${String(previous.version)}`);
      const target = {
        table: canonical.table,
        id: canonical.ref_object_id,
        version: canonical.version,
      };
      targets.set(sha256Json(target), target);
    }
    if (sha256Json(original) !== sha256Json(selected.sort()))
      invalid("Canonical decisions do not cover the original reference rows.");
    sources.push(source.fact, references.fact, rewrites.fact);
  }
  if (!targets.size) return null;
  const intended = [...targets.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, target]) => target);
  const binding = {
    rows: state.rows.entry.sha256,
    sources,
    targets: intended,
    account: context.accountIntent
      ? { project_ref: context.accountIntent.projectRef, user_id: context.accountIntent.userId }
      : null,
  };
  return { sha256: sha256Json(binding), ...binding };
}

export function inspectFoundryReferences(
  context: FoundryRuntimeContext,
  entries: readonly ArtifactEntry[],
) {
  const scope = foundryReferenceScope(context, entries);
  if (!scope) return { scope, verified: false, result: null };
  const result =
    entries
      .filter(
        (entry) =>
          entry.command === "dataset-workflow-reference-verify" &&
          path.basename(entry.path) === "foundry-reference-verification.json",
      )
      .map((entry) => readWorkflowArtifact(context, entry))
      .findLast((item) => item.value.scope_sha256 === scope.sha256) ?? null;
  if (result && result.value.schema !== "tiangong-foundry.reference-verification.v1")
    invalid("Unknown reference verification result.");
  const verified = result?.value.status === "verified";
  if (verified) {
    if (
      !Array.isArray(result.value.blockers) ||
      result.value.blockers.length ||
      sha256Json(result.value.targets) !== sha256Json(scope.targets)
    )
      invalid("Reference verification does not cover the current scope.");
    for (const raw of [result.value.input, result.value.report, result.value.checks]) {
      const fact = workflowObject(raw);
      if (typeof fact.path !== "string") invalid("Reference verification artifact is missing.");
      const current = indexedFile(context, entries, fact.path).fact;
      if (current.sha256 !== fact.sha256 || current.bytes !== fact.bytes)
        invalid("Reference verification artifact changed.");
    }
  }
  return { scope, verified, result };
}

export async function verifyFoundryReferences(
  context: FoundryRuntimeContext,
  qualified: QualifiedFoundryRuntime,
  entries: readonly ArtifactEntry[],
  authentication: FoundryAuthentication = { mode: "oauth" },
) {
  assertQualifiedFoundryRuntime(context, qualified);
  const current = inspectFoundryReferences(context, entries);
  if (current.verified) return current.result!.value;
  const scope = current.scope;
  if (!scope) invalid("No current canonical reference partition exists.");
  verifyFoundryRuntimeIdentity(context, authentication, process.env, qualified);
  for (const fact of scope.sources) readFoundryInput(context, fact.path);
  const output = resolveFoundryOutput(context, `outputs/reference-verification/${randomUUID()}`);
  fs.mkdirSync(output, { recursive: true, mode: 0o700 });
  const input = path.join(output, "canonical-references.jsonl");
  fs.writeFileSync(
    input,
    scope.targets
      .map((item) =>
        JSON.stringify({ "@type": item.table, "@refObjectId": item.id, "@version": item.version }),
      )
      .join("\n") + "\n",
    { mode: 0o600 },
  );
  const inputFact = captureFoundryInput(input),
    cli = resolveInstalledTiangongLcaCliPackage();
  const command = createFoundryCommandSpec({
    executable: process.execPath,
    argv: [
      cli.binPath,
      "dataset",
      "verify-remote",
      "--input",
      input,
      "--root-policy",
      "existing",
      "--out-dir",
      path.join(output, "verify"),
      "--json",
    ],
    binding: { artifacts: [{ ...inputFact, role: "canonical_references" }] },
  });
  const environment = createFoundryAuthenticationEnvironment(
    authentication,
    context.accountIntent?.sessionReference,
    process.env,
  );
  try {
    const run = spawnSync(command.executable, [...command.argv], {
      cwd: output,
      env: environment,
      shell: false,
      windowsHide: true,
      encoding: "utf8",
      timeout: 120_000,
      maxBuffer: 16 * 1024 * 1024,
    });
    fs.writeFileSync(path.join(output, "stdout.json"), run.stdout ?? "");
    fs.writeFileSync(path.join(output, "stderr.log"), run.stderr ?? "");
    const blockers: Record<string, unknown>[] = [];
    let reportFact: ReturnType<typeof captureFoundryInput> | null = null,
      checksFact: ReturnType<typeof captureFoundryInput> | null = null;
    try {
      const report = workflowObject(JSON.parse(run.stdout)),
        files = workflowObject(report.files);
      for (const key of ["report", "checks"]) {
        if (typeof files[key] !== "string") invalid("Reference verification output is missing.");
        const file = resolveFoundryOutput(context, files[key]);
        if (path.relative(path.join(output, "verify"), file).startsWith(".."))
          invalid("Reference verification output is outside its fresh directory.");
        const fact = captureFoundryInput(file);
        if (key === "report") reportFact = fact;
        else checksFact = fact;
      }
      if (sha256Json(JSON.parse(fs.readFileSync(reportFact!.path, "utf8"))) !== sha256Json(report))
        invalid("Reference verification stdout and report differ.");
      const checks = readRows(checksFact!.path).map(workflowObject),
        counts = workflowObject(report.counts);
      const byRow = new Map<unknown, Record<string, unknown>[]>();
      for (const check of checks) {
        const row = byRow.get(check.row_index) ?? [];
        row.push(check);
        byRow.set(check.row_index, row);
      }
      if (
        report.status !== "passed_remote_verification" ||
        report.root_policy !== "existing" ||
        report.input_path !== input ||
        !Array.isArray(report.blockers) ||
        report.blockers.length ||
        counts.blockers !== 0 ||
        counts.checked !== scope.targets.length ||
        counts.references !== scope.targets.length ||
        counts.rows !== scope.targets.length ||
        checks.length !== scope.targets.length
      )
        blockers.push({
          code: "reference_verification_incomplete",
          report_blockers: report.blockers ?? null,
        });
      for (const [index, target] of scope.targets.entries()) {
        const matched = (byRow.get(index) ?? []).filter(
          (item) =>
            item.role === "reference" &&
            item.row_index === index &&
            item.path === "" &&
            item.table === target.table &&
            item.id === target.id &&
            item.version === target.version,
        );
        if (
          matched.length !== 1 ||
          matched[0].status !== "ok" ||
          matched[0].exact_version !== target.version ||
          matched[0].latest_version !== target.version
        )
          blockers.push({ code: "canonical_reference_not_verified", target, checks: matched });
      }
    } catch (error) {
      blockers.push({
        code: error instanceof FoundryContextError ? error.code : "reference_report_invalid",
      });
    }
    if (run.error || run.signal || run.status !== 0)
      blockers.push({ code: "reference_cli_failed", exit_code: run.status });
    if (captureFoundryInput(input).sha256 !== inputFact.sha256)
      invalid("Reference query changed during verification.");
    for (const fact of scope.sources) readFoundryInput(context, fact.path);
    return runFoundryTaskOperation(
      context,
      {
        command: "dataset-workflow-reference-verify",
        options: { scope: scope.sha256, nonce: path.basename(output) },
        validateCurrent(index) {
          if (foundryReferenceScope(context, index)?.sha256 !== scope.sha256)
            invalid("Reference scope changed during verification.");
        },
      },
      (operation) => {
        registerWorkflowStageFiles(context, operation, output);
        const result = {
          schema: "tiangong-foundry.reference-verification.v1",
          status: blockers.length ? "unresolved" : "verified",
          scope_sha256: scope.sha256,
          targets: scope.targets,
          input: inputFact,
          report: reportFact,
          checks: checksFact,
          command,
          blockers,
        };
        operation.writeJson(path.join(output, "foundry-reference-verification.json"), result);
        return result;
      },
    );
  } finally {
    delete environment.TIANGONG_LCA_ACCESS_TOKEN;
  }
}

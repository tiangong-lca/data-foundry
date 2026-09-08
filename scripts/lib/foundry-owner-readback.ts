import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { parseFoundryCommandSpec, commandSpecOptionValue } from "@tiangong-lca/cli/command-spec";
import { createFoundryCommandSpec } from "./foundry-command-spec.ts";
import {
  FoundryContextError,
  resolveFoundryOutput,
  readFoundryInput,
  captureFoundryInput,
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
import { createFoundryFinalizeOwners } from "./foundry-finalize-owners.ts";
import { canonicalPayloadSha256 } from "./post-write-root-proof.ts";
import { normalizeAllowedTraceHashDifference } from "./remote-verification-accepted-diff.ts";
import {
  datasetIdentity,
  unwrapDatasetPayload,
} from "./import-curation/internal/dataset-payload.ts";
import { buildReferenceClosureBlockers } from "./import-curation/internal/workflow-reference-closure.ts";
import { readRows } from "./import-curation/internal/runtime-io.ts";
import { bundleRowTypes, type BundleRowType } from "./bundle-row-types.ts";
import { workflowObject } from "./foundry-workflow-state.ts";
import type { OwnerExecutionRequest } from "./foundry-owner-execution-store.ts";
import { acceptFoundryOwnerTraceDifference } from "./foundry-owner-trace-acceptance.ts";

export async function readbackFoundryOwner(
  context: FoundryRuntimeContext,
  qualified: QualifiedFoundryRuntime,
  request: OwnerExecutionRequest,
  authentication: FoundryAuthentication = { mode: "oauth" },
  commitReport?: string,
) {
  assertQualifiedFoundryRuntime(context, qualified);
  const identity = verifyFoundryRuntimeIdentity(context, authentication, process.env, qualified);
  if (
    identity.receipt.project.project_ref !== request.policy.project_ref ||
    identity.receipt.identity.user_id !== request.policy.user_id
  )
    throw new FoundryContextError(
      "execution_account_mismatch",
      "Readback account differs from the recorded owner intent.",
    );
  const source = parseFoundryCommandSpec(request.content.verify),
    cli = resolveInstalledTiangongLcaCliPackage();
  if (
    source.executable !== process.execPath ||
    source.argv[0] !== cli.binPath ||
    source.argv[1] !== "dataset" ||
    source.argv[2] !== "verify-remote" ||
    !source.argv.includes("--compare-root-payload") ||
    source.argv.includes("--commit") ||
    commandSpecOptionValue(source, "--input") !== request.content.input.path ||
    commandSpecOptionValue(source, "--target-user-id") !== request.policy.user_id ||
    commandSpecOptionValue(source, "--state-code") !== "0"
  )
    throw new FoundryContextError(
      "execution_readback_invalid",
      "Readback must use the recorded exact owner rows, account and state.",
    );
  readFoundryInput(context, request.content.input.path);
  const output = resolveFoundryOutput(context, `outputs/owner-readback/${randomUUID()}`);
  fs.mkdirSync(output, { recursive: true, mode: 0o700 });
  const argv = [...source.argv],
    outIndex = argv.indexOf("--out-dir");
  if (outIndex < 0 || argv.lastIndexOf("--out-dir") !== outIndex)
    throw new FoundryContextError(
      "execution_readback_invalid",
      "Readback output must be explicit.",
    );
  argv[outIndex + 1] = output;
  const spec = createFoundryCommandSpec({
    executable: source.executable,
    argv,
    binding: { artifacts: [...source.binding.artifacts] },
  });
  const environment = createFoundryAuthenticationEnvironment(
    authentication,
    context.accountIntent?.sessionReference,
    process.env,
  );
  environment.FOUNDRY_ACCOUNT_MODE = request.policy.account_mode;
  try {
    const result = spawnSync(spec.executable, [...spec.argv], {
      cwd: output,
      env: environment,
      shell: false,
      windowsHide: true,
      encoding: "utf8",
      timeout: 120_000,
      maxBuffer: 16 * 1024 * 1024,
    });
    fs.writeFileSync(path.join(output, "stdout.json"), result.stdout ?? "");
    fs.writeFileSync(path.join(output, "stderr.log"), result.stderr ?? "");
    const blockers: Record<string, unknown>[] = [];
    let report: Record<string, unknown> = {},
      reportFile: string | null = null,
      checksFile: string | null = null;
    try {
      report = workflowObject(JSON.parse(result.stdout));
      const files = workflowObject(report.files);
      for (const name of ["report", "checks"]) {
        const file =
          typeof files[name] === "string" ? resolveFoundryOutput(context, files[name]) : null;
        if (
          !file ||
          path.relative(output, file).startsWith("..") ||
          !fs.lstatSync(file).isFile() ||
          fs.lstatSync(file).isSymbolicLink()
        )
          throw new Error("Readback files must be fresh and contained.");
        if (name === "report") reportFile = file;
        else checksFile = file;
      }
      if (
        canonicalPayloadSha256(JSON.parse(fs.readFileSync(reportFile!, "utf8"))) !==
        canonicalPayloadSha256(report)
      )
        throw new Error("Readback stdout and report differ.");
    } catch {
      blockers.push({
        code: "readback_report_invalid",
        message: "Readback needs matching fresh stdout, report and check artifacts.",
      });
    }
    const original = {
      report: reportFile ? captureFoundryInput(reportFile) : null,
      checks: checksFile ? captureFoundryInput(checksFile) : null,
    };
    let acceptance: ReturnType<typeof captureFoundryInput> | null = null;
    if (
      !blockers.length &&
      reportFile &&
      !result.error &&
      !result.signal &&
      result.status === 2 &&
      request.policy.account_mode === "ordinary"
    ) {
      const accepted = acceptFoundryOwnerTraceDifference(
        context,
        qualified,
        request,
        reportFile,
        output,
        environment,
      );
      if (accepted.accepted) {
        reportFile = resolveFoundryOutput(context, accepted.verifyReportPath);
        report = workflowObject(JSON.parse(fs.readFileSync(reportFile, "utf8")));
        checksFile = resolveFoundryOutput(context, String(workflowObject(report.files).checks));
        acceptance = captureFoundryInput(
          resolveFoundryOutput(context, accepted.acceptanceReportPath),
        );
      }
    }
    if (result.error || result.signal || (result.status !== 0 && !acceptance))
      blockers.push({ code: "readback_cli_failed", exit_code: result.status });
    if (!blockers.length && reportFile) {
      const rows = readRows(request.content.input.path).map((row) =>
        unwrapDatasetPayload(row, request.policy.dataset_type),
      );
      const type = request.policy.dataset_type as BundleRowType;
      if (!Object.hasOwn(bundleRowTypes, type))
        throw new FoundryContextError(
          "execution_readback_invalid",
          "Unsupported recorded dataset type.",
        );
      const intended = rows.map((row, rowIndex) => {
        const id = datasetIdentity(row, rowIndex, type),
          normalized = normalizeAllowedTraceHashDifference(row);
        return {
          rowIndex,
          table: bundleRowTypes[type].plural,
          id: id.id,
          version: id.version,
          payloadSha256: canonicalPayloadSha256(row),
          acceptedNormalizedPayloadSha256: normalized.removed_paths.length
            ? normalized.normalized_sha256
            : null,
          acceptedNormalizedRemovedPaths: normalized.removed_paths,
        };
      });
      const owners = createFoundryFinalizeOwners(context, qualified, output, {
        environment,
        tidasExecutable: qualified.tidas.executable_path,
      });
      owners.closeout.validatePostWriteVerifyForCloseout({
        verifyReport: report,
        verifyReportPath: reportFile,
        finalRowsFile: request.content.input.path,
        expectedRows: rows.length,
        targetUserId: request.policy.user_id,
        expectedStateCode: 0,
        intendedRoots: intended,
        allowTraceHashOnlyNormalization: request.policy.account_mode !== "production-test",
        blockers,
      });
      blockers.push(
        ...buildReferenceClosureBlockers({
          repoRoot: context.assetRoot,
          rows,
          datasetType: type,
          remoteVerifyArtifact: { value: report },
          allowAccountLocalSupportAndElementary: false,
        }),
      );
      if (commitReport) {
        const closed = workflowObject(
          owners.closeout.runDatasetPostWriteCloseout({
            handoffPlan: request.handoff_file,
            commitReport,
            postWriteVerifyReport: reportFile,
            rowsFile: request.content.input.path,
            finalizeReport: request.finalize_file,
            mutationManifest: request.mutation_file,
            outDir: path.join(output, "closeout"),
            targetUserId: request.policy.user_id,
            stateCode: "0",
          }),
        );
        if (closed.status !== "completed")
          blockers.push({ code: "owner_closeout_blocked", report: closed });
      }
    }
    readFoundryInput(context, request.content.input.path);
    const proof = {
      schema: "tiangong-foundry.owner-readback.v1",
      status: blockers.length ? "unresolved" : "verified",
      request_scope: request.scope_id,
      input: request.content.input,
      command: spec,
      report: reportFile ? captureFoundryInput(reportFile) : null,
      checks: checksFile ? captureFoundryInput(checksFile) : null,
      original_verification: original,
      acceptance,
      blockers,
    };
    fs.writeFileSync(
      path.join(output, "owner-readback.json"),
      JSON.stringify(proof, null, 2) + "\n",
    );
    return { output, proof };
  } finally {
    delete environment.TIANGONG_LCA_ACCESS_TOKEN;
  }
}
